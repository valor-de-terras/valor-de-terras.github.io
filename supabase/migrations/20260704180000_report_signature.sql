-- Assinatura digital do laudo (gap nº 1 do Sicoob, art. II.12): a assinatura
-- QUALIFICADA (validade jurídica) é a do responsável técnico via Gov.br/ICP-Brasil
-- (a plataforma não segura a chave privada do RT). A plataforma faz sua parte:
--   1) emite o laudo com CÓDIGO DE VERIFICAÇÃO + SHA-256 do PDF (autenticidade/
--      integridade, padrão SEI/e-CAC): qualquer um confere que o documento é
--      genuíno e não foi alterado;
--   2) registra o PDF ASSINADO pelo RT (upload do arquivo assinado no Gov.br);
--   3) expõe verificação pública por código.

alter table public.appraisal_reports
  add column if not exists verification_code text,
  add column if not exists report_sha256 text,
  add column if not exists signed_pdf_path text,
  add column if not exists signed_at timestamptz,
  add column if not exists signature_status text not null default 'unsigned'
    check (signature_status in ('unsigned', 'rt_signed'));
create unique index if not exists appraisal_reports_verif_code_ux
  on public.appraisal_reports (verification_code) where verification_code is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- finalize_report_delivery ganha o hash do PDF e o código de verificação.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.finalize_report_delivery(
  p_request_id uuid,
  p_report_pdf_path text,
  p_sha256 text default null,
  p_verification_code text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_req public.appraisal_requests;
begin
  if not (select public.is_technician()) then
    raise exception 'Apenas a equipe técnica pode finalizar o laudo';
  end if;
  if coalesce(btrim(p_report_pdf_path), '') = '' then
    raise exception 'Caminho do PDF é obrigatório';
  end if;
  select * into v_req from public.appraisal_requests where id = p_request_id for update;
  if not found then raise exception 'Pedido não encontrado'; end if;
  if v_req.technician_id is distinct from v_uid and not (select public.is_admin()) then
    raise exception 'Apenas o engenheiro responsável pode finalizar este laudo';
  end if;
  if v_req.status <> 'REPORT_GENERATING' then
    raise exception 'Transição inválida a partir de %', v_req.status;
  end if;

  update public.appraisal_reports
     set report_pdf_path = p_report_pdf_path,
         report_sha256 = coalesce(p_sha256, report_sha256),
         verification_code = coalesce(p_verification_code, verification_code)
   where request_id = p_request_id;
  update public.appraisal_requests set status = 'DELIVERED' where id = p_request_id;
  insert into public.audit_logs (request_id, actor_id, from_status, to_status, action, detail)
  values (p_request_id, v_uid, 'REPORT_GENERATING', 'DELIVERED', 'report_delivered',
          jsonb_build_object('pdf', p_report_pdf_path, 'sha256', p_sha256));
end $$;
revoke all on function public.finalize_report_delivery(uuid, text, text, text) from public, anon;
grant execute on function public.finalize_report_delivery(uuid, text, text, text) to authenticated;
-- remove o overload antigo de 2 params (senão finalizaria sem hash/código e sem lock)
drop function if exists public.finalize_report_delivery(uuid, text);

-- ─────────────────────────────────────────────────────────────────────────────
-- register_signed_report: o RT registra o PDF assinado (Gov.br/ICP-Brasil).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.register_signed_report(
  p_request_id uuid,
  p_signed_pdf_path text
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_req public.appraisal_requests;
begin
  if not (select public.is_technician()) then
    raise exception 'Apenas a equipe técnica pode registrar o laudo assinado';
  end if;
  if coalesce(btrim(p_signed_pdf_path), '') = '' then
    raise exception 'Caminho do PDF assinado é obrigatório';
  end if;
  select * into v_req from public.appraisal_requests where id = p_request_id for update;
  if not found then raise exception 'Pedido não encontrado'; end if;
  if v_req.technician_id is distinct from v_uid and not (select public.is_admin()) then
    raise exception 'Apenas o engenheiro responsável pode registrar a assinatura';
  end if;
  if v_req.status <> 'DELIVERED' then
    raise exception 'O laudo precisa estar entregue (DELIVERED) para registrar a assinatura';
  end if;

  update public.appraisal_reports
     set signed_pdf_path = p_signed_pdf_path,
         signed_at = now(),
         signature_status = 'rt_signed'
   where request_id = p_request_id;
  insert into public.audit_logs (request_id, actor_id, from_status, to_status, action, detail)
  values (p_request_id, v_uid, 'DELIVERED', 'DELIVERED', 'report_signed',
          jsonb_build_object('signed_pdf', p_signed_pdf_path));
end $$;
revoke all on function public.register_signed_report(uuid, text) from public, anon;
grant execute on function public.register_signed_report(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- verify_report: verificação PÚBLICA por código. Devolve só atestação (RT, CREA,
-- ART, município, área, datas, hash, status de assinatura) — nada monetário.
-- Permite a uma cooperativa confirmar autenticidade/integridade do laudo.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.verify_report(
  p_code text
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_out jsonb;
begin
  if coalesce(btrim(p_code), '') = '' then
    return jsonb_build_object('found', false);
  end if;
  select jsonb_build_object(
    'found', true,
    'laudo', upper(substr(rep.request_id::text, 1, 8)),
    'municipio', pr.municipality,
    'uf', pr.uf,
    'area_ha', pr.area_ha,
    'car_code', pr.car_code,
    'grau', rep.grade,
    'art', rep.art_number,
    'responsavel', prof.full_name,
    'crea', tm.crea_number,
    'crea_uf', tm.uf,
    'emitido_em', rep.created_at,
    'sha256', rep.report_sha256,
    'assinatura', rep.signature_status,
    'assinado_em', rep.signed_at
  ) into v_out
  from public.appraisal_reports rep
  join public.appraisal_requests req on req.id = rep.request_id
  join public.properties pr on pr.id = req.property_id
  left join public.profiles prof on prof.id = rep.technician_id
  left join public.technical_team_members tm on tm.profile_id = rep.technician_id
  where rep.verification_code = btrim(p_code)
    and req.status = 'DELIVERED'
  limit 1;

  return coalesce(v_out, jsonb_build_object('found', false));
end $$;
revoke all on function public.verify_report(text) from public;
grant execute on function public.verify_report(text) to anon, authenticated;
