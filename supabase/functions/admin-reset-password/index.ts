// Edge Function: admin-reset-password
// Um ADMIN define uma nova senha temporária para um engenheiro (recuperação de acesso
// sem depender de SMTP). Checa is_admin pelo JWT do chamador e aplica via service role.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return jsonResponse({ error: "Use POST" }, origin, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "Autenticação necessária" }, origin, 401);

  let body: { profile_id?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "JSON inválido" }, origin, 400);
  }
  const profileId = (body.profile_id ?? "").trim();
  const password = body.password ?? "";
  if (!profileId) return jsonResponse({ error: "Campo 'profile_id' é obrigatório" }, origin, 400);
  if (password.length < 8) return jsonResponse({ error: "A senha temporária precisa de ao menos 8 caracteres" }, origin, 400);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const user = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: isAdmin, error: aErr } = await user.rpc("is_admin");
  if (aErr) return jsonResponse({ error: aErr.message }, origin, 400);
  if (!isAdmin) return jsonResponse({ error: "Apenas administradores podem redefinir senhas" }, origin, 403);

  // confirma que o alvo é de fato um técnico cadastrado (evita mexer em contas arbitrárias)
  const { data: tech } = await user.rpc("admin_list_technicians");
  const isTeam = Array.isArray(tech) && tech.some((t: { profile_id: string }) => t.profile_id === profileId);
  if (!isTeam) return jsonResponse({ error: "Perfil não é da equipe técnica" }, origin, 400);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { error: uErr } = await admin.auth.admin.updateUserById(profileId, { password });
  if (uErr) return jsonResponse({ error: "Falha ao redefinir a senha: " + uErr.message }, origin, 400);

  return jsonResponse({ ok: true }, origin);
});
