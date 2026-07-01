import { useCallback, useEffect, useState } from "react";
import { getSessionUser, signOut, changePassword, type SessionUser } from "../lib/portal";
import Login from "./Login";
import Queue from "./Queue";
import RequestDetail from "./RequestDetail";
import AdminTeam from "./AdminTeam";
import styles from "./portal.module.css";

export default function PortalApp() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<"queue" | "team">("queue");
  const [pwOpen, setPwOpen] = useState(false);

  const refresh = useCallback(async () => {
    setReady(false);
    try { setUser(await getSessionUser()); }
    finally { setReady(true); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const isTech = user && (user.role === "technician" || user.role === "admin");
  const isAdmin = user?.role === "admin";

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.brandBlock}>
          <span className={styles.brand}>Valor de Terras</span>
          <span className={styles.brandSub}>Painel técnico</span>
        </div>

        {isTech && !selected && (
          <nav className={styles.navTabs} aria-label="Seções">
            <button className={`${styles.linkBtn} ${tab === "queue" ? styles.linkBtnOn : ""}`} onClick={() => setTab("queue")}>Fila</button>
            {isAdmin && (
              <button className={`${styles.linkBtn} ${tab === "team" ? styles.linkBtnOn : ""}`} onClick={() => setTab("team")}>Equipe</button>
            )}
          </nav>
        )}

        <div className={styles.spacer} />
        {isTech && user && (
          <div className={styles.userChip}>
            <strong>{user.full_name ?? user.email}</strong>
            <span>{user.role === "admin" ? "administrador" : "engenheiro"}</span>
          </div>
        )}
        {isTech && <button className={styles.linkBtn} onClick={() => setPwOpen((v) => !v)}>Trocar senha</button>}
        {isTech && <button className={styles.linkBtn} onClick={() => void signOut().then(refresh)}>Sair</button>}
        <a className={styles.linkBtn} href="#/">Voltar ao site</a>
      </header>

      <main className={styles.body}>
        {!ready && <div className={styles.subtle}>Carregando…</div>}

        {ready && !isTech && (
          <Login loggedNonTech={user && !isTech ? user : null} onSignedIn={() => void refresh()} />
        )}

        {ready && isTech && pwOpen && <ChangePassword onClose={() => setPwOpen(false)} />}

        {ready && isTech && user && (
          selected ? (
            <RequestDetail requestId={selected} currentUserId={user.id} onBack={() => setSelected(null)} />
          ) : isAdmin && tab === "team" ? (
            <AdminTeam />
          ) : (
            <Queue onSelect={(id) => setSelected(id)} />
          )
        )}
      </main>
    </div>
  );
}

function ChangePassword({ onClose }: { onClose: () => void }) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (pw.length < 8) { setErr("A senha precisa de ao menos 8 caracteres."); return; }
    setBusy(true);
    try { await changePassword(pw); setOk(true); setPw(""); }
    catch (e) { setErr(e instanceof Error ? e.message : "Falha ao trocar a senha."); }
    finally { setBusy(false); }
  };

  return (
    <div className={styles.card2}>
      <div className={styles.sectionTitle}>Trocar senha</div>
      {ok ? (
        <div className={styles.okMsg}>Senha atualizada. <button className="vt-btn vt-btn-ghost" onClick={onClose}>Fechar</button></div>
      ) : (
        <form onSubmit={submit}>
          <div className={styles.field}>
            <label className={styles.label}>Nova senha (mín. 8 caracteres)</label>
            <input className={styles.input} type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
          </div>
          {err && <div className={styles.errMsg}>{err}</div>}
          <div className={styles.actions}>
            <button type="submit" className="vt-btn vt-btn-primary" disabled={busy}>{busy ? "Salvando…" : "Salvar nova senha"}</button>
            <button type="button" className="vt-btn vt-btn-ghost" onClick={onClose}>Cancelar</button>
          </div>
        </form>
      )}
    </div>
  );
}
