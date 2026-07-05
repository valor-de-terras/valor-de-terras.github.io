// Edge Function: generate-report
// Gera o PDF do laudo NBR 14.653-3 server-side (pdf-lib), grava no bucket privado
// `report-pdfs` e finaliza o pedido (REPORT_GENERATING -> DELIVERED). Exige JWT do
// engenheiro RESPONSÁVEL (ou admin) e o pedido em REPORT_GENERATING; o upload usa o
// service role para dar dono determinístico ao objeto (nenhum técnico pode "sentar" no
// caminho nem adulterar um laudo já entregue). As travas finais ficam nas RPCs SECURITY DEFINER.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { buildLaudoPdf } from "../_shared/laudo.ts";

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

  // cliente com o JWT do engenheiro (RLS + RPCs autorizam)
  const user = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });

  // 1) pacote completo do pedido (get_request_bundle valida o escopo de leitura)
  const { data: bundle, error: bErr } = await user.rpc("get_request_bundle", { p_request_id: requestId });
  if (bErr) return jsonResponse({ error: bErr.message }, origin, 403);
  if (!bundle?.property) return jsonResponse({ error: "Pedido sem geometria" }, origin, 400);

  // 2) autorização de ESCRITA: só o engenheiro responsável (ou admin) e só em REPORT_GENERATING
  const request = bundle.request ?? {};
  if (request.status !== "REPORT_GENERATING") {
    return jsonResponse({ error: "O pedido não está em geração de laudo (REPORT_GENERATING)." }, origin, 409);
  }
  const { data: authData } = await user.auth.getUser();
  const callerId = authData?.user?.id ?? null;
  if (request.technician_id !== callerId) {
    const { data: isAdmin } = await user.rpc("is_admin");
    if (!isAdmin) {
      return jsonResponse({ error: "Apenas o engenheiro responsável pode gerar este laudo." }, origin, 403);
    }
  }

  // 2b) sinais de enriquecimento (Frentes H/I/J/K/L) para a seção 8 do laudo.
  // Pós-ART (laudo formal): podem expor valores. Calculados aqui a partir da
  // geometria; falhas individuais não abortam o laudo (best-effort).
  const prop = bundle.property as Record<string, unknown>;
  const centroid = (prop.centroid as [number, number]) ?? [null, null];
  const [lon, lat] = centroid;
  const muni = (prop.municipality as string | null) ?? null;
  const geom = prop.geometry ?? null;
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    try {
      const { data, error } = await user.rpc(fn, args);
      return error ? null : data;
    } catch {
      return null;
    }
  };
  const hasPoint = typeof lon === "number" && typeof lat === "number";
  const [viability, zarc, outorgas, compliance, logistics, amenities, spread] = await Promise.all([
    hasPoint ? rpc("get_viability", { p_lon: lon, p_lat: lat, p_municipio: muni }) : null,
    muni ? rpc("get_zarc", { p_municipio: muni }) : null,
    hasPoint ? rpc("get_outorgas", { p_lon: lon, p_lat: lat, p_geojson: geom }) : null,
    hasPoint ? rpc("get_compliance", { p_lon: lon, p_lat: lat, p_geojson: geom }) : null,
    hasPoint ? rpc("get_logistics", { p_lon: lon, p_lat: lat, p_municipio: muni }) : null,
    hasPoint ? rpc("get_amenities", { p_lon: lon, p_lat: lat }) : null,
    muni ? rpc("get_spread", { p_municipio: muni }) : null,
  ]);
  // código de verificação ALEATÓRIO (não derivável do request_id): entra no PDF
  // ANTES do hash, para o SHA-256 ser do documento final já com o código.
  const B32 = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem 0/O/1/I
  const rnd = crypto.getRandomValues(new Uint8Array(10));
  let verificationCode = "";
  for (let i = 0; i < 10; i++) verificationCode += B32[rnd[i] % 32];
  const origin2 = req.headers.get("Origin") ?? "";
  const verifyBase = origin2.includes("valor-de-terras")
    ? `${origin2}/#/verificar`
    : "https://valor-de-terras.github.io/#/verificar";

  const bundleWithSignals = {
    ...bundle,
    signals: { viability, zarc, outorgas, compliance, logistics, amenities, spread },
    verification: { code: verificationCode, url: `${verifyBase}?c=${verificationCode}` },
  };

  // 3) monta o PDF
  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await buildLaudoPdf(bundleWithSignals);
  } catch (e) {
    console.error("pdf build failed:", String(e));
    return jsonResponse({ error: "Falha ao gerar o PDF do laudo" }, origin, 500);
  }

  // 4) grava no bucket privado via SERVICE ROLE (dono determinístico; upsert idempotente)
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const path = `${requestId}/laudo-${requestId.slice(0, 8)}.pdf`;
  const up = await admin.storage.from("report-pdfs").upload(path, pdfBytes, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (up.error) {
    console.error("report pdf upload failed:", up.error.message);
    return jsonResponse({ error: "Falha ao gravar o PDF do laudo." }, origin, 400);
  }

  // hash do PDF final (integridade) — a mesma verificação pode ser refeita por
  // qualquer um sobre o arquivo entregue.
  const shaBuf = await crypto.subtle.digest("SHA-256", pdfBytes as unknown as BufferSource);
  const sha256 = Array.from(new Uint8Array(shaBuf))
    .map((b) => b.toString(16).padStart(2, "0")).join("");

  // 5) finaliza (REPORT_GENERATING -> DELIVERED) com o JWT do engenheiro (trava de responsável + caminho)
  const { error: fErr } = await user.rpc("finalize_report_delivery", {
    p_request_id: requestId,
    p_report_pdf_path: path,
    p_sha256: sha256,
    p_verification_code: verificationCode,
  });
  if (fErr) return jsonResponse({ error: fErr.message }, origin, 400);

  // 6) URL assinada para visualização imediata (service role)
  const { data: signed } = await admin.storage.from("report-pdfs").createSignedUrl(path, 3600);

  return jsonResponse({ ok: true, request_id: requestId, path, url: signed?.signedUrl ?? null }, origin);
});
