-- Relatório fotográfico do laudo (gap nº 2 do Sicoob, art. II.7: obrigatório,
-- imagens nítidas). O responsável técnico sobe as fotos da vistoria (upload direto
-- ao bucket com RLS por dono, padrão da matrícula), com legenda e ordem; o
-- generate-report embute as imagens numa seção "Relatório fotográfico" do PDF.

-- bucket privado, com teto de tamanho e tipos de imagem permitidos
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('report-photos', 'report-photos', false, 8388608,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- INSERT só por TÉCNICO e como dono (evita que visitante anônimo/qualquer usuário
-- grave no bucket); mesmo padrão de storage_insert_technical dos demais buckets.
-- A trava de "responsável pelo pedido" fica na RPC register_report_photo.
drop policy if exists report_photos_insert on storage.objects;
create policy report_photos_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'report-photos' and owner = auth.uid() and (select public.is_technician())
  );
drop policy if exists report_photos_select_own on storage.objects;
create policy report_photos_select_own on storage.objects
  for select to authenticated using (bucket_id = 'report-photos' and owner = auth.uid());
drop policy if exists report_photos_delete_own on storage.objects;
create policy report_photos_delete_own on storage.objects
  for delete to authenticated using (bucket_id = 'report-photos' and owner = auth.uid());

-- metadados das fotos
create table if not exists public.report_photos (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.appraisal_requests (id) on delete cascade,
  storage_path text not null,
  caption text,
  sort int not null default 0,
  lat numeric,
  lon numeric,
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists report_photos_req_ix on public.report_photos (request_id, sort);
alter table public.report_photos enable row level security;
-- leitura: dono do pedido, técnico responsável ou admin (as escritas vão por RPC)
drop policy if exists report_photos_read on public.report_photos;
create policy report_photos_read on public.report_photos for select to authenticated
  using (
    exists (
      select 1 from public.appraisal_requests r
      where r.id = report_photos.request_id
        and (r.requester_id = auth.uid() or r.technician_id = auth.uid() or (select public.is_admin()))
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- register_report_photo: o RT registra a foto (após o upload ao storage).
-- Trava: engenheiro responsável (ou admin), máx. 12 fotos por pedido, caminho
-- sob o prefixo do próprio pedido.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.register_report_photo(
  p_request_id uuid,
  p_storage_path text,
  p_caption text default null,
  p_sort int default 0,
  p_lat numeric default null,
  p_lon numeric default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_req public.appraisal_requests;
  v_n int;
  v_id uuid;
begin
  if not (select public.is_technician()) then
    raise exception 'Apenas a equipe técnica pode anexar fotos';
  end if;
  if coalesce(btrim(p_storage_path), '') = '' then
    raise exception 'Caminho da foto é obrigatório';
  end if;
  select * into v_req from public.appraisal_requests where id = p_request_id for update;
  if not found then raise exception 'Pedido não encontrado'; end if;
  if v_req.technician_id is distinct from v_uid and not (select public.is_admin()) then
    raise exception 'Apenas o engenheiro responsável pode anexar fotos a este pedido';
  end if;
  if p_storage_path not like (p_request_id::text || '/%') then
    raise exception 'Caminho da foto inválido';
  end if;
  select count(*) into v_n from public.report_photos where request_id = p_request_id;
  if v_n >= 12 then
    raise exception 'Limite de 12 fotos por laudo atingido';
  end if;

  insert into public.report_photos (request_id, storage_path, caption, sort, lat, lon, uploaded_by)
  values (p_request_id, p_storage_path, nullif(left(btrim(p_caption), 200), ''),
          coalesce(p_sort, v_n), p_lat, p_lon, v_uid)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.register_report_photo(uuid, text, text, int, numeric, numeric) from public, anon;
grant execute on function public.register_report_photo(uuid, text, text, int, numeric, numeric) to authenticated;

create or replace function public.delete_report_photo(p_photo_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_req public.appraisal_requests;
  v_ph public.report_photos;
begin
  select * into v_ph from public.report_photos where id = p_photo_id;
  if not found then return; end if;
  select * into v_req from public.appraisal_requests where id = v_ph.request_id for update;
  if v_req.technician_id is distinct from v_uid and not (select public.is_admin()) then
    raise exception 'Apenas o engenheiro responsável pode remover fotos deste pedido';
  end if;
  delete from public.report_photos where id = p_photo_id;
end $$;
revoke all on function public.delete_report_photo(uuid) from public, anon;
grant execute on function public.delete_report_photo(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- get_request_bundle: acrescenta 'photos' (escopo restrito, como enrichment).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.get_request_bundle(p_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_req public.appraisal_requests;
  v_est_id uuid;
  v_scoped boolean;
  v_out jsonb;
begin
  if v_uid is null then raise exception 'Autenticação necessária'; end if;
  select * into v_req from public.appraisal_requests where id = p_request_id;
  if not found then raise exception 'Pedido não encontrado'; end if;
  if not (
    v_req.requester_id = v_uid
    or v_req.technician_id = v_uid
    or (select public.is_technician())
    or (select public.is_admin())
  ) then
    raise exception 'Sem permissão para este pedido';
  end if;

  v_scoped := (v_req.requester_id = v_uid or v_req.technician_id = v_uid or (select public.is_admin()));

  select id into v_est_id from public.appraisal_estimates
   where request_id = p_request_id order by created_at desc limit 1;

  select jsonb_build_object(
    'request', to_jsonb(v_req),
    'property', (
      select jsonb_build_object(
        'area_ha', p.area_ha, 'perimeter_km', p.perimeter_km,
        'municipality', p.municipality, 'uf', p.uf, 'car_code', p.car_code,
        'origin', p.origin,
        'centroid', jsonb_build_array(ST_X(p.centroid), ST_Y(p.centroid)),
        'geometry', ST_AsGeoJSON(p.geom)::jsonb
      ) from public.properties p where p.id = v_req.property_id
    ),
    'estimate', (select to_jsonb(e) from public.appraisal_estimates e where e.id = v_est_id),
    'comparables', (
      select coalesce(jsonb_agg(to_jsonb(c) order by c.distance_km), '[]'::jsonb)
      from public.comparables c where c.estimate_id = v_est_id
    ),
    'enrichment', case when v_scoped then (
      select coalesce(jsonb_agg(jsonb_build_object(
        'key', source_key, 'source', source_label, 'payload', payload
      ) order by captured_at), '[]'::jsonb)
      from public.data_snapshots s where s.request_id = p_request_id
    ) else '[]'::jsonb end,
    'report', (select to_jsonb(rep) from public.appraisal_reports rep where rep.request_id = p_request_id),
    'photos', case when v_scoped then (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'path', storage_path, 'caption', caption, 'sort', sort,
        'lat', lat, 'lon', lon
      ) order by sort, created_at), '[]'::jsonb)
      from public.report_photos ph where ph.request_id = p_request_id
    ) else '[]'::jsonb end,
    'technician', (
      select jsonb_build_object(
        'full_name', pr.full_name, 'email', pr.email,
        'crea_number', t.crea_number, 'uf', t.uf, 'specialty', t.specialty,
        'crea_valid_until', t.crea_valid_until
      )
      from public.profiles pr
      left join public.technical_team_members t on t.profile_id = pr.id
      where pr.id = v_req.technician_id
    ),
    'audit', case when v_scoped then (
      select coalesce(jsonb_agg(jsonb_build_object(
        'action', action, 'from', from_status, 'to', to_status, 'at', created_at
      ) order by created_at), '[]'::jsonb)
      from public.audit_logs a where a.request_id = p_request_id
    ) else '[]'::jsonb end
  ) into v_out;

  return v_out;
end $$;
