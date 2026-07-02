import { useState } from "react";
import { signInTech, signOut, sendPasswordReset, type SessionUser } from "../lib/portal";
import styles from "./portal.module.css";

interface Props {
  /** já logado, mas sem papel técnico (mostra aviso + sair) */
  loggedNonTech?: SessionUser | null;
  onSignedIn: () => void;
}

export default function Login({ loggedNonTech, onSignedIn }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [forgot, setForgot] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await signInTech(email, password);
      onSignedIn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Falha no login.");
    } finally {
      setBusy(false);
    }
  };

  const sendReset = async () => {
    setErr(null);
    setResetMsg(null);
    if (!email.includes("@")) { setErr("Informe seu e-mail para recuperar a senha."); return; }
    setResetBusy(true);
    try {
      await sendPasswordReset(email);
      setResetMsg("Se houver uma conta com este e-mail, enviamos um link para redefinir a senha. Se o e-mail não chegar, peça a um administrador para redefinir no painel (Equipe).");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Falha ao enviar o link de recuperação.");
    } finally {
      setResetBusy(false);
    }
  };

  return (
    <div className={styles.authWrap}>
      <div className={styles.authCard}>
        <span className={styles.authEyebrow}>Painel técnico</span>
        <h1 className={styles.authTitle}>Acesso da equipe técnica</h1>
        <p className={styles.authLede}>
          Área restrita aos engenheiros responsáveis (Agrônomo ou Florestal) para revisar
          estimativas, registrar a ART e emitir o laudo.
        </p>

        {loggedNonTech && (
          <div className={styles.authErr}>
            A conta <strong>{loggedNonTech.email}</strong> não está cadastrada como equipe
            técnica. Peça a um administrador para habilitá-la, ou entre com outra conta.
            <div style={{ marginTop: "0.6rem" }}>
              <button
                type="button"
                className={`vt-btn vt-btn-ghost ${styles.wFull}`}
                onClick={() => void signOut().then(onSignedIn)}
              >
                Sair desta conta
              </button>
            </div>
          </div>
        )}

        <form onSubmit={submit}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="pt-email">E-mail</label>
            <input
              id="pt-email"
              className={styles.input}
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="pt-pass">Senha</label>
            <input
              id="pt-pass"
              className={styles.input}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {err && <div className={styles.authErr}>{err}</div>}

          <button type="submit" className={`vt-btn vt-btn-primary ${styles.wFull}`} disabled={busy}>
            {busy ? "Entrando…" : "Entrar"}
          </button>
        </form>

        <div style={{ marginTop: "0.9rem" }}>
          {!forgot ? (
            <button type="button" className={styles.linkText} onClick={() => { setForgot(true); setResetMsg(null); }}>
              Esqueci minha senha
            </button>
          ) : (
            <div className={styles.forgotBox}>
              <p className={styles.forgotHint}>
                Enviaremos um link de recuperação para o e-mail acima.
              </p>
              <div className={styles.field}>
                <button type="button" className={`vt-btn vt-btn-ghost ${styles.wFull}`} onClick={() => void sendReset()} disabled={resetBusy}>
                  {resetBusy ? "Enviando…" : "Enviar link de recuperação"}
                </button>
              </div>
              {resetMsg && <div className={styles.okMsg}>{resetMsg}</div>}
            </div>
          )}
        </div>

        <p className={styles.authNote}>
          O cadastro de novos engenheiros é feito por um administrador. As contas exigem CREA
          ativo, com validade anual, para poder emitir a ART.
        </p>
      </div>
    </div>
  );
}
