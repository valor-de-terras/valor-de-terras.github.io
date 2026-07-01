// Edge Function: report-link
// Devolve uma URL assinada (1h) para baixar o PDF do laudo. Verifica o escopo pelo
// JWT do chamador (get_request_bundle lanca se nao for solicitante/tecnico/admin) e
// so entao assina via service role — assim o solicitante baixa sem ser dono do objeto.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return jsonResponse({ error: "Use POST" }, origin, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "Autenticação necessária" }, origin, 401);

  let body: { request_id?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "JSON inválido" }, origin, 400);
  }
  const requestId = body?.request_id;
  if (!requestId) return jsonResponse({ error: "Campo 'request_id' é obrigatório" }, origin, 400);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const user = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: bundle, error: bErr } = await user.rpc("get_request_bundle", { p_request_id: requestId });
  if (bErr) return jsonResponse({ error: bErr.message }, origin, 403);

  const path = bundle?.report?.report_pdf_path as string | undefined;
  if (!path) return jsonResponse({ error: "Laudo ainda não disponível para este pedido" }, origin, 404);
  // defesa em profundidade: o objeto tem que estar sob o prefixo do próprio pedido
  if (!path.startsWith(`${requestId}/`)) {
    return jsonResponse({ error: "Caminho do laudo inválido" }, origin, 400);
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: signed, error: sErr } = await admin.storage.from("report-pdfs").createSignedUrl(path, 3600);
  if (sErr) return jsonResponse({ error: sErr.message }, origin, 400);

  return jsonResponse({ ok: true, url: signed?.signedUrl ?? null, path }, origin);
});
