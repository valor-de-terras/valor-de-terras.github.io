-- Frente E, 2ª etapa: OCR + leitura assistida por LLM da matrícula.
-- Até aqui a análise era só o detector por regras (engine = 'rule-based-0.1') e matrícula
-- escaneada era recusada com 422. Agora:
--   1) PDF sem texto -> OCR na nuvem (Gemini) -> o mesmo texto alimenta regras e LLM;
--   2) o LLM devolve leitura CONTEXTUAL estruturada e SEM dado pessoal (coluna leitura).
-- As regras continuam sendo a triagem primária; o LLM é segunda opinião. Por isso as
-- colunas são aditivas: análises antigas seguem legíveis com leitura = null.

-- ── proveniência da análise ───────────────────────────────────────────────────
alter table public.matricula_analyses
  add column if not exists leitura jsonb,
  add column if not exists ocr boolean not null default false,
  add column if not exists llm_model text;

comment on column public.matricula_analyses.leitura is
  'Leitura contextual estruturada devolvida pelo LLM, sem PII (área, confrontantes em quantidade, ônus). Null quando só as regras rodaram.';
comment on column public.matricula_analyses.ocr is
  'True quando o texto veio de OCR na nuvem (PDF escaneado), não da camada de texto do PDF.';
comment on column public.matricula_analyses.llm_model is
  'Modelo usado na leitura, para rastreabilidade do laudo (NBR 14.653-1, item 9-e). Null se só regras.';

-- ── consentimento LGPD: registrar A QUE o titular consentiu ───────────────────
-- O tier gratuito do Gemini usa o conteúdo enviado para treinar modelos e admite revisão
-- humana. O consentimento anterior ("processamento para análise de ônus") não cobria envio
-- a terceiro, então o texto mudou e a versão passa a ser gravada junto do documento: sem
-- isso não há como provar, depois, sob qual redação cada matrícula foi processada.
alter table public.matricula_documents
  add column if not exists consent_version text;

comment on column public.matricula_documents.consent_version is
  'Versão do texto de consentimento aceito no upload. v2-cloud-ocr = ciente do envio a provedor de nuvem (OCR/LLM). Null = upload anterior a essa exigência (só regras locais).';

-- Assinatura antiga precisa sair antes: manter as duas tornaria a chamada de 4 args
-- ambígua (a nova tem default no 5º parâmetro).
drop function if exists public.register_matricula(uuid, text, text, boolean);

create or replace function public.register_matricula(
  p_request_id uuid,
  p_storage_path text,
  p_filename text,
  p_consent boolean,
  p_consent_version text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id uuid; v_owner uuid;
begin
  if v_uid is null then raise exception 'Autenticação necessária'; end if;
  if not coalesce(p_consent, false) then raise exception 'Consentimento LGPD é obrigatório'; end if;
  -- mantém a trava anti-exfiltração: analyze-matricula baixa esse path com service_role
  if p_storage_path is null or p_storage_path not like v_uid::text || '/%' then
    raise exception 'Caminho de arquivo inválido';
  end if;
  select requester_id into v_owner from public.appraisal_requests where id = p_request_id;
  if v_owner is null then raise exception 'Pedido não encontrado'; end if;
  if v_owner <> v_uid and not public.is_admin() then raise exception 'Sem permissão para este pedido'; end if;
  insert into public.matricula_documents (request_id, owner_id, storage_path, filename, consent, consent_version)
  values (p_request_id, v_uid, p_storage_path, p_filename, p_consent, p_consent_version)
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.register_matricula(uuid, text, text, boolean, text) from public, anon;
grant execute on function public.register_matricula(uuid, text, text, boolean, text) to authenticated;

-- ── leitura agregada: expõe os campos novos ao laudo ──────────────────────────
-- Escopo de leitura inalterado (dono, admin ou técnico RESPONSÁVEL pelo pedido).
create or replace function public.get_matricula_analysis(p_request_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'filename', d.filename, 'engine', a.engine,
    'n_passivos', a.n_passivos, 'n_ativos', a.n_ativos, 'passivos', a.passivos,
    'leitura', a.leitura, 'ocr', a.ocr, 'llm_model', a.llm_model,
    'created_at', a.created_at) order by a.created_at desc), '[]'::jsonb)
  from public.matricula_analyses a
  join public.matricula_documents d on d.id = a.document_id
  where a.request_id = p_request_id
    and (d.owner_id = auth.uid() or public.is_admin()
         or exists (select 1 from public.appraisal_requests r
                    where r.id = a.request_id and r.technician_id = auth.uid()));
$$;

revoke all on function public.get_matricula_analysis(uuid) from public, anon;
grant execute on function public.get_matricula_analysis(uuid) to authenticated;
