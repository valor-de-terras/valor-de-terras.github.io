// Edge Function: appraise
// Fluxo síncrono real: geometria -> pedido (PostGIS) -> enriquecimento com fontes abertas
// (relevo/clima/acesso/hidro reais; solo/uso/embargo/comparáveis em referência) ->
// homogeneização NBR -> estimativa preliminar persistida. Tudo em uma chamada.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { buildEnrichment, centroidOf } from "../_shared/enrich.ts";

interface AppraiseBody {
  geojson: unknown;
  purpose?: string;
  origin?: string;
  car_code?: string | null;
  municipality?: string | null;
  uf?: string | null;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return jsonResponse({ error: "Use POST" }, origin, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "Autenticação necessária" }, origin, 401);

  let body: AppraiseBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "JSON inválido no corpo da requisição" }, origin, 400);
  }
  if (!body?.geojson) return jsonResponse({ error: "Campo 'geojson' é obrigatório" }, origin, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  // 1) cria o pedido (mede área/centroide via PostGIS, valida topologia)
  const { data: requestId, error: createErr } = await supabase.rpc("create_appraisal_request", {
    p_geojson: body.geojson,
    p_purpose: body.purpose ?? "outro",
    p_origin: body.origin ?? "geojson",
    p_car_code: body.car_code ?? null,
    p_municipality: body.municipality ?? null,
    p_uf: body.uf ?? null,
  });
  if (createErr) return jsonResponse({ error: createErr.message }, origin, 400);

  // 2) enriquecimento real a partir do centroide
  const [lon, lat] = centroidOf(body.geojson);
  let enrichment;
  try {
    enrichment = await buildEnrichment(lon, lat);
  } catch (e) {
    enrichment = null; // RPC cairá no catálogo de referência
    console.error("enrichment failed:", String(e));
  }

  // 3) homogeneização NBR + estimativa (persistida)
  const { data: estimate, error: estErr } = await supabase.rpc("run_estimate_with_enrichment", {
    p_request_id: requestId,
    p_enrichment: enrichment,
  });
  if (estErr) return jsonResponse({ error: estErr.message, request_id: requestId }, origin, 400);

  // mescla o comparável real (DERAL/SEAB-PR) calculado na RPC de volta no enriquecimento
  if (estimate?.comp && Array.isArray(enrichment)) {
    const c = enrichment.find((l) => l.key === "comp");
    if (c) {
      c.result = estimate.comp.result;
      c.source = estimate.comp.source;
      c.factor = estimate.comp.factor;
      c.real = estimate.comp.real;
    }
  }

  // FRENTE A (gating): o valor estimado NÃO vai para o cliente na prévia. Ele fica
  // persistido no servidor (pela RPC) e só é revelado no laudo formal, com ART. Aqui
  // removemos todos os campos monetários da resposta e mascaramos R$ no enriquecimento,
  // para que o número não chegue ao navegador nem possa ser reconstruído.
  const maskMoney = (s: unknown) =>
    typeof s === "string" ? s.replace(/R\$\s?\d[\d.,]*/g, "R$ •••") : s;

  const safeEnrichment = Array.isArray(enrichment)
    ? enrichment.map((l: Record<string, unknown>) => {
        const c = { ...l, result: maskMoney(l.result) };
        delete (c as Record<string, unknown>).payload; // pode conter preço-base
        return c;
      })
    : enrichment;

  let safeEstimate: unknown = estimate;
  if (estimate && typeof estimate === "object") {
    const e = { ...(estimate as Record<string, unknown>) };
    delete e.price_per_ha;
    delete e.total;
    delete e.comp;
    if (Array.isArray(e.comparables)) {
      e.comparables = e.comparables.map((c: Record<string, unknown>) => {
        const cc = { ...c };
        delete cc.price_per_ha;
        delete cc.homogenized_price_per_ha;
        return cc;
      });
    }
    e.locked = true; // sinaliza ao front que o valor está retido para o laudo formal
    safeEstimate = e;
  }

  return jsonResponse(
    { request_id: requestId, estimate: safeEstimate, enrichment: safeEnrichment },
    origin,
  );
});
