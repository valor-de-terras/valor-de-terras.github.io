import { useCallback, useEffect, useState } from "react";
import { getSessionUser, signOut, type SessionUser } from "../lib/portal";
import Login from "./Login";
import Queue from "./Queue";
import RequestDetail from "./RequestDetail";
import styles from "./portal.module.css";

export default function PortalApp() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setReady(false);
    try {
      setUser(await getSessionUser());
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isTech = user && (user.role === "technician" || user.role === "admin");

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.brandBlock}>
          <span className={styles.brand}>Valor de Terras</span>
          <span className={styles.brandSub}>Painel técnico</span>
        </div>
        <div className={styles.spacer} />
        {isTech && user && (
          <div className={styles.userChip}>
            <strong>{user.full_name ?? user.email}</strong>
            <span>{user.role === "admin" ? "administrador" : "engenheiro"}</span>
          </div>
        )}
        {isTech && (
          <button className={styles.linkBtn} onClick={() => void signOut().then(refresh)}>Sair</button>
        )}
        <a className={styles.linkBtn} href="#/">Voltar ao site</a>
      </header>

      <main className={styles.body}>
        {!ready && <div className={styles.subtle}>Carregando…</div>}

        {ready && !isTech && (
          <Login loggedNonTech={user && !isTech ? user : null} onSignedIn={() => void refresh()} />
        )}

        {ready && isTech && user && (
          selected ? (
            <RequestDetail
              requestId={selected}
              currentUserId={user.id}
              onBack={() => setSelected(null)}
            />
          ) : (
            <Queue onSelect={(id) => setSelected(id)} />
          )
        )}
      </main>
    </div>
  );
}
