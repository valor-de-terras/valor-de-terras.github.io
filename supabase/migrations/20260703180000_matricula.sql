-- Frente E: análise de matrícula (due diligence dominial).
-- Upload em bucket PRIVADO (LGPD: matrícula tem dado pessoal); extração de texto e
-- detecção de passivos (hipoteca, alienação fiduciária, penhora, ônus, cláusulas) por
-- regras, sem depender de LLM. Acesso: dono (sessão que enviou) + técnico responsável.

-- bucket privado
insert into storage.buckets (id, name, public) values ('matriculas', 'matriculas', false)
  on conflict (id) do nothing;

-- RLS de storage: cada um vê só o que enviou; escrita autenticada; leitura ampla via
-- service role (edge) e função SECURITY DEFINER.
drop policy if exists matriculas_insert on storage.objects;
create policy matriculas_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'matriculas');
drop policy if exists matriculas_select_own on storage.objects;
create policy matriculas_select_own on storage.objects
  for select to authenticated using (bucket_id = 'matriculas' and owner = auth.uid());

create table if not exists public.matricula_documents (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid references public.appraisal_requests (id) on delete cascade,
  owner_id     uuid default auth.uid(),
  storage_path text not null,
  filename     text,
  consent      boolean not null default false,   -- consentimento LGPD p/ processar
  created_at   timestamptz not null default now()
);
create index if not exists matricula_docs_req_ix on public.matricula_documents (request_id);
alter table public.matricula_documents enable row level security;

create table if not exists public.matricula_analyses (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid references public.matricula_documents (id) on delete cascade,
  request_id  uuid references public.appraisal_requests (id) on delete cascade,
  markdown    text,               -- texto extraído (normalizado)
  passivos    jsonb not null default '[]'::jsonb, -- [{tipo,status,trecho}]
  n_passivos  integer not null default 0,
  n_ativos    integer not null default 0,
  engine      text not null default 'rule-based-0.1',
  created_at  timestamptz not null default now()
);
create index if not exists matricula_analyses_req_ix on public.matricula_analyses (request_id);
alter table public.matricula_analyses enable row level security;

-- Dono lê os próprios; técnico responsável e admin leem via papel (evita expor a todos).
drop policy if exists matricula_docs_read on public.matricula_documents;
create policy matricula_docs_read on public.matricula_documents for select to authenticated
  using (owner_id = auth.uid() or public.is_technician() or public.is_admin());

drop policy if exists matricula_analyses_read on public.matricula_analyses;
create policy matricula_analyses_read on public.matricula_analyses for select to authenticated
  using (
    public.is_technician() or public.is_admin()
    or exists (select 1 from public.matricula_documents d
               where d.id = matricula_analyses.document_id and d.owner_id = auth.uid())
  );

-- Registro do upload pelo cliente (valida consentimento e posse do pedido).
create or replace function public.register_matricula(
  p_request_id uuid, p_storage_path text, p_filename text, p_consent boolean
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id uuid; v_owner uuid;
begin
  if v_uid is null then raise exception 'Autenticação necessária'; end if;
  if not coalesce(p_consent, false) then raise exception 'Consentimento LGPD é obrigatório'; end if;
  select requester_id into v_owner from public.appraisal_requests where id = p_request_id;
  if v_owner is null then raise exception 'Pedido não encontrado'; end if;
  if v_owner <> v_uid and not public.is_admin() then raise exception 'Sem permissão para este pedido'; end if;
  insert into public.matricula_documents (request_id, owner_id, storage_path, filename, consent)
  values (p_request_id, v_uid, p_storage_path, p_filename, p_consent)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.register_matricula(uuid, text, text, boolean) from public, anon;
grant execute on function public.register_matricula(uuid, text, text, boolean) to authenticated;

-- Leitura da análise (dono ou técnico), sem expor o arquivo bruto.
create or replace function public.get_matricula_analysis(p_request_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'filename', d.filename, 'engine', a.engine,
    'n_passivos', a.n_passivos, 'n_ativos', a.n_ativos, 'passivos', a.passivos,
    'created_at', a.created_at) order by a.created_at desc), '[]'::jsonb)
  from public.matricula_analyses a
  join public.matricula_documents d on d.id = a.document_id
  where a.request_id = p_request_id
    and (d.owner_id = auth.uid() or public.is_technician() or public.is_admin());
$$;
revoke all on function public.get_matricula_analysis(uuid) from public, anon;
grant execute on function public.get_matricula_analysis(uuid) to authenticated;
