// CORS com allow-list de origens (evita "*"). Sobrescreva via env ALLOWED_ORIGINS
// (lista separada por vírgula). Default: site em produção + dev local.
const DEFAULT_ALLOWED = [
  "https://valor-de-terras.github.io",
  "http://localhost:5173",
  "http://localhost:4178",
];

function allowedOrigins(): string[] {
  const env = Deno.env.get("ALLOWED_ORIGINS");
  if (env) return env.split(",").map((s) => s.trim()).filter(Boolean);
  return DEFAULT_ALLOWED;
}

export function corsHeaders(origin: string | null): Record<string, string> {
  const list = allowedOrigins();
  const allow = origin && list.includes(origin) ? origin : list[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

export function jsonResponse(
  body: unknown,
  origin: string | null,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}
