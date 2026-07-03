-- Fix (revisão 2026-07-03), dois furos LGPD na Frente E:
-- 1) As policies e a RPC get_matricula_analysis liberavam leitura para QUALQUER técnico
--    (is_technician), não só o responsável pelo pedido. Matrícula é dado pessoal;
--    o escopo declarado na própria migration era "dono + técnico responsável".
-- 2) register_matricula aceitava storage_path arbitrário e analyze-matricula baixa esse
--    path com service_role (bypass de RLS de storage) -> exfiltração entre sessões.
--    Agora o path precisa estar no prefixo do próprio uploader (uid/...), no registro e
--    na policy de INSERT do bucket.

-- Leitura de documentos: dono, admin ou o técnico RESPONSÁVEL pelo pedido.
drop policy if exists matricula_docs_read on public.matricula_documents;
create policy matricula_docs_read on public.matricula_documents for select to authenticated
  using (
    owner_id = auth.uid() or public.is_admin()
    or exists (select 1 from public.appraisal_requests r
               where r.id = matricula_documents.request_id
                 and r.technician_id = auth.uid())
  );

-- Leitura de análises: dono do documento, admin ou técnico responsável.
drop policy if exists matricula_analyses_read on public.matricula_analyses;
create policy matricula_analyses_read on public.matricula_analyses for select to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.matricula_documents d
               where d.id = matricula_analyses.document_id and d.owner_id = auth.uid())
    or exists (select 1 from public.appraisal_requests r
               where r.id = matricula_analyses.request_id
                 and r.technician_id = auth.uid())
  );

-- INSERT no bucket confinado ao prefixo do próprio usuário (uid/...).
drop policy if exists matriculas_insert on storage.objects;
create policy matriculas_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'matriculas'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Registro valida que o path pertence ao chamador (quebra a exfiltração via
-- analyze-matricula, que baixa o path com service_role).
create or replace function public.register_matricula(
  p_request_id uuid, p_storage_path text, p_filename text, p_consent boolean
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id uuid; v_owner uuid;
begin
  if v_uid is null then raise exception 'Autenticação necessária'; end if;
  if not coalesce(p_consent, false) then raise exception 'Consentimento LGPD é obrigatório'; end if;
  if p_storage_path is null or p_storage_path not like v_uid::text || '/%' then
    raise exception 'Caminho de arquivo inválido';
  end if;
  select requester_id into v_owner from public.appraisal_requests where id = p_request_id;
  if v_owner is null then raise exception 'Pedido não encontrado'; end if;
  if v_owner <> v_uid and not public.is_admin() then raise exception 'Sem permissão para este pedido'; end if;
  insert into public.matricula_documents (request_id, owner_id, storage_path, filename, consent)
  values (p_request_id, v_uid, p_storage_path, p_filename, p_consent)
  returning id into v_id;
  return v_id;
end $$;

-- Leitura agregada: mesmo escopo restrito (dono, admin, técnico responsável).
create or replace function public.get_matricula_analysis(p_request_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'filename', d.filename, 'engine', a.engine,
    'n_passivos', a.n_passivos, 'n_ativos', a.n_ativos, 'passivos', a.passivos,
    'created_at', a.created_at) order by a.created_at desc), '[]'::jsonb)
  from public.matricula_analyses a
  join public.matricula_documents d on d.id = a.document_id
  where a.request_id = p_request_id
    and (d.owner_id = auth.uid() or public.is_admin()
         or exists (select 1 from public.appraisal_requests r
                    where r.id = a.request_id and r.technician_id = auth.uid()));
$$;
