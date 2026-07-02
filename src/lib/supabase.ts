import { createClient, type Session } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  // detectSessionInUrl: true para processar o link de recuperação de senha (evento
  // PASSWORD_RECOVERY) quando o usuário volta do e-mail de "esqueci minha senha".
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

/** Garante uma sessão (login anônimo) para o fluxo "testar sem cadastro". */
export async function ensureAnonSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session;
  const { data: signedIn, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  return signedIn.session;
}
