// Edge Function: admin-create-technician
// Cria a conta de auth (confirmada) de um engenheiro e o promove a técnico. A criação
// de usuário exige service role, por isso vive no servidor; o chamador precisa ser ADMIN
// (checado pelo próprio JWT). A promoção reusa a RPC auditada admin_upsert_technician,
// que resolve o alvo pela tabela autoritativa auth.users.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

interface Body {
  name?: string;
  email?: string;
  password?: string;
  crea?: string;
  uf?: string;
  specialty?: string;
  valid_months?: number;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return jsonResponse({ error: "Use POST" }, origin, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "Autenticação necessária" }, origin, 401);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "JSON inválido" }, origin, 400);
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  const crea = (body.crea ?? "").trim();
  const uf = (body.uf ?? "").trim();
  const name = (body.name ?? "").trim();
  const specialty = (body.specialty ?? "").trim() || null;
  const validMonths = Number.isFinite(body.valid_months) ? Number(body.valid_months) : 12;

  if (!email || !email.includes("@")) return jsonResponse({ error: "E-mail inválido" }, origin, 400);
  if (password.length < 8) return jsonResponse({ error: "A senha temporária precisa de ao menos 8 caracteres" }, origin, 400);
  if (!crea) return jsonResponse({ error: "Número do CREA é obrigatório" }, origin, 400);
  if (!uf) return jsonResponse({ error: "UF é obrigatória" }, origin, 400);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // 1) o chamador precisa ser admin (checado pelo próprio JWT)
  const user = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: isAdmin, error: aErr } = await user.rpc("is_admin");
  if (aErr) return jsonResponse({ error: aErr.message }, origin, 400);
  if (!isAdmin) return jsonResponse({ error: "Apenas administradores podem cadastrar a equipe técnica" }, origin, 403);

  // 2) cria a conta confirmada (service role); se já existir, apenas promove
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  let createdNew = true;
  const { error: cErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name || email },
  });
  if (cErr) {
    const msg = (cErr.message || "").toLowerCase();
    if (msg.includes("already") || msg.includes("registered") || msg.includes("exist")) {
      createdNew = false; // conta já existe: seguimos só com a promoção
    } else {
      return jsonResponse({ error: "Falha ao criar a conta: " + cErr.message }, origin, 400);
    }
  }

  // 3) promove a técnico via RPC auditada (admin-guarded, resolve por auth.users)
  const { error: pErr } = await user.rpc("admin_upsert_technician", {
    p_email: email,
    p_crea: crea,
    p_uf: uf,
    p_specialty: specialty,
    p_valid_months: validMonths,
  });
  if (pErr) return jsonResponse({ error: pErr.message }, origin, 400);

  return jsonResponse({ ok: true, created: createdNew, email }, origin);
});
