import { useEffect, useState } from "react";
import { getQueue, type QueueItem } from "../lib/portal";
import { fmtArea, fmtBRLCompact } from "../lib/format";
import { statusView, PURPOSE_LABELS } from "./status";
import styles from "./portal.module.css";

interface Props {
  onSelect: (requestId: string) => void;
}

export default function Queue({ onSelect }: Props) {
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      setItems(await getQueue());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Falha ao carregar a fila.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div>
      <div className={styles.head}>
        <div>
          <h1 className={styles.h1}>Fila de revisão técnica</h1>
          <p className={styles.subtle}>
            Pedidos que solicitaram o laudo formal com ART. Assuma um para revisar e emitir.
          </p>
        </div>
        <button className="vt-btn vt-btn-ghost" onClick={() => void load()} disabled={loading}>
          {loading ? "Atualizando…" : "Atualizar"}
        </button>
      </div>

      {err && <div className={styles.errMsg}>{err}</div>}

      {items && items.length === 0 && !err && (
        <div className={styles.empty}>
          Nenhum pedido na fila no momento. Quando um cliente solicitar o laudo formal, ele
          aparecerá aqui.
        </div>
      )}

      {items && items.length > 0 && (
        <div className={styles.cards}>
          {items.map((it) => {
            const sv = statusView(it.status);
            return (
              <button key={it.request_id} className={styles.card} onClick={() => onSelect(it.request_id)}>
                <div className={styles.cardTop}>
                  <span className={styles.cardMuni}>
                    {it.municipality ?? "Imóvel"}{it.uf ? `/${it.uf}` : ""}
                  </span>
                  <span className={`${styles.badge} ${sv.cls}`}>{sv.label}</span>
                </div>
                <div className={styles.cardMeta}>
                  <span>{fmtArea(it.area_ha)}</span>
                  <span>{PURPOSE_LABELS[it.purpose] ?? it.purpose}</span>
                  {it.contact_name && <span>· {it.contact_name}</span>}
                </div>
                {it.total_avg != null && (
                  <div className={styles.cardVal}>Estimativa {fmtBRLCompact(it.total_avg)}</div>
                )}
                {it.mine && <div style={{ marginTop: "0.5rem" }}><span className={styles.mineTag}>minha revisão</span></div>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
