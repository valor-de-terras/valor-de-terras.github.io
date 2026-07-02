import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { changePassword } from "../lib/portal";
import { navigate } from "../lib/router";
import styles from "./portal.module.css";

/** Tela de "definir nova senha" após o link de recuperação (evento PASSWORD_RECOVERY). */
export default function RecoverPassword() {
  const [ready, setReady] = useState(false);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    let mounted = true;
    // o cliente supabase (detectSessionInUrl) processa o link; captamos a sessão de recuperação
    supabase.auth.getSession().then(({ data }) => { if (mounted && data.session) setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && session)) setReady(true);
    });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (pw.length < 8) { setErr("A senha precisa de ao menos 8 caracteres."); return; }
    setBusy(true);
    try { await changePassword(pw); setOk(true); }
    catch (e) { setErr(e instanceof Error ? e.message : "Falha ao definir a senha."); }
    finally { setBusy(false); }
  };

  return (
    <div className={styles.authWrap}>
      <div className={styles.authCard}>
        <span className={styles.authEyebrow}>Recuperação de acesso</span>
        <h1 className={styles.authTitle}>Definir nova senha</h1>

        {ok ? (
          <>
            <div className={styles.okMsg}>Senha atualizada com sucesso.</div>
            <button className={`vt-btn vt-btn-primary ${styles.wFull}`} onClick={() => { navigate("#portal"); window.location.reload(); }}>
              Ir para o painel
            </button>
          </>
        ) : !ready ? (
          <p className={styles.authLede}>
            Validando o link de recuperação… Se demorar, o link pode ter expirado. Volte ao{" "}
            <a href="#portal" style={{ textDecoration: "underline" }}>login</a> e peça um novo, ou
            solicite a um administrador que redefina sua senha.
          </p>
        ) : (
          <form onSubmit={submit}>
            <p className={styles.authLede}>Escolha uma nova senha para sua conta.</p>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="rec-pw">Nova senha (mín. 8 caracteres)</label>
              <input id="rec-pw" className={styles.input} type="password" autoComplete="new-password"
                value={pw} onChange={(e) => setPw(e.target.value)} required />
            </div>
            {err && <div className={styles.authErr}>{err}</div>}
            <button type="submit" className={`vt-btn vt-btn-primary ${styles.wFull}`} disabled={busy}>
              {busy ? "Salvando…" : "Salvar nova senha"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
