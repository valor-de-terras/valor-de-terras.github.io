import { useEffect, useState } from "react";
import { ensureAnonSession } from "../lib/supabase";
import { getMyRequests, reportLink, type MyRequestItem } from "../lib/portal";
import { fmtArea } from "../lib/format";
import MatriculaBox from "./MatriculaBox";
import styles from "./tracking.module.css";

interface StatusView { label: string; cls: string; }

function statusView(s: string): StatusView {
  switch (s) {
    case "ESTIMATE_DELIVERED": return { label: "Estimativa pronta", cls: styles.stNeutral };
    case "TECHNICAL_REVIEW_QUEUED": return { label: "Na fila de revisão", cls: styles.stWait };
    case "TECHNICAL_REVIEW_IN_PROGRESS": return { label: "Em revisão técnica", cls: styles.stWork };
    case "NEEDS_MORE_INFO": return { label: "Aguardando dados", cls: styles.stWait };
    case "REPORT_GENERATING": return { label: "Gerando laudo", cls: styles.stWork };
    case "DELIVERED": return { label: "Laudo pronto", cls: styles.stDone };
    case "CANCELLED_BY_USER": return { label: "Cancelado", cls: styles.stNeutral };
    default: return { label: s.replace(/_/g, " ").toLowerCase(), cls: styles.stNeutral };
  }
}

export default function MyRequests() {
  const [rows, setRows] = useState<MyRequestItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [download, setDownload] = useState<{ id: string; url: string } | null>(null);

  const load = async () => {
    setErr(null);
    try {
      await ensureAnonSession();
      setRows(await getMyRequests());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Falha ao carregar seus pedidos.");
    }
  };

  useEffect(() => { void load(); }, []);

  const onDownload = async (id: string) => {
    setBusyId(id);
    setErr(null);
    try {
      const url = await reportLink(id);
      // popup blockers barram window.open depois de um await; o link abaixo
      // do botão é o caminho garantido de download
      setDownload({ id, url });
      window.open(url, "_blank", "noopener");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Falha ao gerar o link do laudo.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <span className={styles.brand}>Valor de Terras</span>
        <div className={styles.spacer} />
        <a className={styles.linkBtn} href="#/avaliar">Nova avaliação</a>
        <a className={styles.linkBtn} href="#/">Voltar ao site</a>
      </header>

      <main className={styles.body}>
        <h1 className={styles.title}>Meus pedidos</h1>
        <p className={styles.lede}>
          Acompanhe suas avaliações e baixe o laudo quando estiver pronto.
        </p>

        {err && <div className={styles.err}>{err}</div>}

        {rows && rows.length === 0 && !err && (
          <div className={styles.empty}>
            Você ainda não tem pedidos neste navegador.{" "}
            <a href="#/avaliar" style={{ textDecoration: "underline" }}>Avalie sua propriedade</a> para começar.
          </div>
        )}

        {rows && rows.length > 0 && (
          <div className={styles.cards}>
            {rows.map((r) => {
              const sv = statusView(r.status);
              return (
                <div key={r.request_id} className={styles.card}>
                  <div className={styles.cardTop}>
                    <div className={styles.info}>
                      <div className={styles.muni}>
                        {r.municipality ?? "Imóvel"}{r.uf ? `/${r.uf}` : ""}
                      </div>
                      <div className={styles.meta}>
                        <span>{fmtArea(r.area_ha)}</span>
                        <span className={styles.mono}>· #{r.request_id.slice(0, 8).toUpperCase()}</span>
                      </div>
                    </div>
                    <div className={styles.right}>
                      <span className={`${styles.badge} ${sv.cls}`}>{sv.label}</span>
                      {r.status === "DELIVERED" && r.has_report && (
                        <button
                          className="vt-btn vt-btn-primary"
                          onClick={() => void onDownload(r.request_id)}
                          disabled={busyId === r.request_id}
                        >
                          {busyId === r.request_id ? "Abrindo…" : "Baixar laudo (PDF)"}
                        </button>
                      )}
                    </div>
                  </div>
                  {download?.id === r.request_id && (
                    <div className={styles.meta}>
                      PDF pronto:{" "}
                      <a href={download.url} target="_blank" rel="noopener" style={{ textDecoration: "underline" }}>
                        abrir o laudo
                      </a>{" "}
                      (se não abriu sozinho, o navegador bloqueou o popup)
                    </div>
                  )}
                  {r.status !== "CANCELLED_BY_USER" && (
                    <MatriculaBox requestId={r.request_id} />
                  )}
                </div>
              );
            })}
          </div>
        )}

        <p className={styles.note}>
          O acompanhamento é vinculado a este navegador (sessão anônima). Para não perder o acesso
          ao laudo, baixe o PDF assim que ficar pronto. Precisa de ajuda? A equipe entra em contato
          pelos dados informados ao solicitar o laudo.
        </p>
      </main>
    </div>
  );
}
