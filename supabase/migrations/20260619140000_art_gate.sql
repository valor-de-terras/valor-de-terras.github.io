-- Valor de Terras — backend
-- 11 · Trava da ART (anti-desacoplamento) + validade anual do CREA.
-- Impede que "um gera o laudo e outro assina a ART": o laudo só é finalizado pelo MESMO
-- engenheiro que assumiu a revisão, com CREA ativo/dentro da validade e ART informada.

alter table public.technical_team_members
  add column if not exists crea_active boolean not null default true,
  add column if not exists crea_valid_until date;

comment on column public.technical_team_members.crea_valid_until is
  'Validade da anuidade/registro do CREA. Renovação anual; null = não validado (bloqueia emissão).';

-- caller é técnico ativo com CREA válido (ou admin)
create or replace function public.caller_crea_ok()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.technical_team_members t
    where t.profile_id = auth.uid()
      and t.active and t.crea_active
      and t.crea_valid_until is not null
      and t.crea_valid_until >= current_date
  );
$$;
revoke all on function public.caller_crea_ok() from public;
revoke all on function public.caller_crea_ok() from anon;
grant execute on function public.caller_crea_ok() to authenticated;

-- nova versão de submit_art_and_finish (com PDF da ART e travas); remove a antiga
drop function if exists public.submit_art_and_finish(uuid, text, text);

create or replace function public.submit_art_and_finish(
  p_request_id uuid,
  p_art_number text,
  p_narrative text default null,
  p_art_pdf_path text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_req public.appraisal_requests;
  v_report uuid;
begin
  if not (select public.is_technician()) then
    raise exception 'Apenas a equipe técnica pode emitir o laudo';
  end if;
  if coalesce(btrim(p_art_number), '') = '' then
    raise exception 'Número da ART é obrigatório para emitir o laudo';
  end if;
  if not (select public.caller_crea_ok()) then
    raise exception 'CREA inativo ou validade vencida. Atualize o cadastro (anuidade do CREA) antes de emitir o laudo.';
  end if;

  select * into v_req from public.appraisal_requests where id = p_request_id;
  if not found then raise exception 'Pedido não encontrado'; end if;
  if v_req.status <> 'TECHNICAL_REVIEW_IN_PROGRESS' then
    raise exception 'Transição inválida a partir de %', v_req.status;
  end if;
  -- anti-desacoplamento: o responsável pela ART deve ser o MESMO que assumiu a revisão
  if v_req.technician_id is distinct from v_uid and not (select public.is_admin()) then
    raise exception 'Apenas o engenheiro responsável que assumiu a revisão pode emitir a ART e finalizar o laudo';
  end if;

  insert into public.appraisal_reports (request_id, technician_id, art_number, art_pdf_path, narrative)
  values (p_request_id, v_uid, p_art_number, p_art_pdf_path, p_narrative)
  on conflict (request_id) do update
    set art_number = excluded.art_number,
        art_pdf_path = excluded.art_pdf_path,
        narrative = excluded.narrative,
        technician_id = excluded.technician_id
  returning id into v_report;

  update public.appraisal_requests set status = 'DELIVERED' where id = p_request_id;
  insert into public.audit_logs (request_id, actor_id, from_status, to_status, action, detail)
  values (p_request_id, v_uid, 'TECHNICAL_REVIEW_IN_PROGRESS', 'DELIVERED', 'submit_art',
          jsonb_build_object('art_number', p_art_number, 'art_pdf', p_art_pdf_path is not null));
  return v_report;
end $$;

revoke all on function public.submit_art_and_finish(uuid, text, text, text) from public;
revoke all on function public.submit_art_and_finish(uuid, text, text, text) from anon;
grant execute on function public.submit_art_and_finish(uuid, text, text, text) to authenticated;
