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

  return jsonResponse({ request_id: requestId, estimate, enrichment }, origin);
});
