// Edge Function: appraise
// Orquestra o fluxo síncrono "geometria -> estimativa preliminar" em uma única chamada.
// É onde, na evolução do produto, entram os conectores reais de dados abertos
// (MapBiomas STAC, INMET, ANA, EMBRAPA WMS, OSM Overpass) antes de rodar o motor NBR.
// Hoje o enriquecimento é feito (em stub) dentro da RPC run_preliminary_estimate.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

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

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Use POST" }, origin, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "Autenticação necessária" }, origin, 401);
  }

  let body: AppraiseBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "JSON inválido no corpo da requisição" }, origin, 400);
  }
  if (!body?.geojson) {
    return jsonResponse({ error: "Campo 'geojson' é obrigatório" }, origin, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: requestId, error: createErr } = await supabase.rpc(
    "create_appraisal_request",
    {
      p_geojson: body.geojson,
      p_purpose: body.purpose ?? "outro",
      p_origin: body.origin ?? "geojson",
      p_car_code: body.car_code ?? null,
      p_municipality: body.municipality ?? null,
      p_uf: body.uf ?? null,
    },
  );
  if (createErr) {
    return jsonResponse({ error: createErr.message }, origin, 400);
  }

  const { data: estimate, error: estErr } = await supabase.rpc(
    "run_preliminary_estimate",
    { p_request_id: requestId },
  );
  if (estErr) {
    return jsonResponse({ error: estErr.message, request_id: requestId }, origin, 400);
  }

  return jsonResponse({ request_id: requestId, estimate }, origin);
});
