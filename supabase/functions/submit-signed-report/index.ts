// Edge Function: submit-signed-report
// O responsável técnico envia o PDF do laudo JÁ ASSINADO digitalmente (Gov.br ou
// certificado ICP-Brasil). A função valida o escopo pelo JWT, confere que é um PDF
// e que contém uma assinatura (dicionário /Sig), grava no bucket privado e registra
// via register_signed_report (trava: engenheiro responsável, pedido DELIVERED).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

const MAX_BYTES = 25 * 1024 * 1024;

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return jsonResponse({ error: "Use POST" }, origin, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "Autenticação necessária" }, origin, 401);

  let body: { request_id?: string; pdf_base64?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "JSON inválido" }, origin, 400);
  }
  const requestId = body?.request_id;
  const b64 = body?.pdf_base64;
  if (!requestId || !b64) {
    return jsonResponse({ error: "Campos 'request_id' e 'pdf_base64' são obrigatórios" }, origin, 400);
  }

  // decodifica e valida o PDF assinado
  let bytes: Uint8Array;
  try {
    const bin = atob(b64.includes(",") ? b64.split(",")[1] : b64);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    return jsonResponse({ error: "PDF (base64) inválido" }, origin, 400);
  }
  if (bytes.length === 0 || bytes.length > MAX_BYTES) {
    return jsonResponse({ error: "Arquivo vazio ou maior que 25 MB" }, origin, 400);
  }
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 5));
  if (head !== "%PDF-") {
    return jsonResponse({ error: "O arquivo enviado não é um PDF" }, origin, 400);
  }
  // exige estrutura de assinatura digital: dicionário /Sig, /ByteRange com array
  // numérico e /Contents com blob hexadecimal. Não é validação criptográfica
  // (exigiria parser PKCS7/CAdES), mas rejeita PDFs sem a estrutura de assinatura,
  // reduzindo falsos positivos triviais. A validade jurídica plena é aferida pela
  // instituição (ex.: validar.iti.gov.br) sobre o certificado ICP-Brasil do RT.
  const asText = new TextDecoder("latin1").decode(bytes);
  const hasSigDict = /\/Type\s*\/Sig\b/.test(asText) || /\/SubFilter\s*\/(adbe\.pkcs7|ETSI\.CAdES)/.test(asText);
  const hasByteRange = /\/ByteRange\s*\[\s*\d+\s+\d+\s+\d+\s+\d+\s*\]/.test(asText);
  const hasContents = /\/Contents\s*<[0-9A-Fa-f]{64,}>/.test(asText);
  if (!(hasSigDict && hasByteRange && hasContents)) {
    return jsonResponse({
      error: "O PDF não contém uma assinatura digital válida. Assine pelo Gov.br (gov.br/assinatura-eletronica) ou com certificado ICP-Brasil e reenvie.",
    }, origin, 422);
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const user = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });

  // escopo/autorização: só o ENGENHEIRO RESPONSÁVEL (ou admin) pode gravar. A
  // checagem tem de vir ANTES do upload (o upload usa service role e ignora RLS):
  // do contrário um técnico não-responsável, ou o cliente, sobrescreveria o PDF
  // assinado antes de a RPC de registro rejeitar. Mesmo padrão do generate-report.
  const { data: bundle, error: bErr } = await user.rpc("get_request_bundle", { p_request_id: requestId });
  if (bErr) return jsonResponse({ error: bErr.message }, origin, 403);
  if (bundle?.request?.status !== "DELIVERED") {
    return jsonResponse({ error: "O laudo precisa estar entregue antes de registrar a assinatura." }, origin, 409);
  }
  const { data: authData } = await user.auth.getUser();
  const callerId = authData?.user?.id ?? null;
  if (bundle.request.technician_id !== callerId) {
    const { data: isAdmin } = await user.rpc("is_admin");
    if (!isAdmin) {
      return jsonResponse({ error: "Apenas o engenheiro responsável pode registrar a assinatura." }, origin, 403);
    }
  }

  // grava via service role (dono determinístico; upsert idempotente)
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const path = `${requestId}/laudo-assinado-${requestId.slice(0, 8)}.pdf`;
  const up = await admin.storage.from("report-pdfs").upload(path, bytes, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (up.error) {
    console.error("signed upload failed:", up.error.message);
    return jsonResponse({ error: "Falha ao gravar o PDF assinado." }, origin, 400);
  }

  // registra (trava de responsável na RPC)
  const { error: rErr } = await user.rpc("register_signed_report", {
    p_request_id: requestId,
    p_signed_pdf_path: path,
  });
  if (rErr) return jsonResponse({ error: rErr.message }, origin, 400);

  return jsonResponse({ ok: true, request_id: requestId, path }, origin);
});
