import type { Spread } from "../../lib/signals";
import styles from "./SignalsPanels.module.css";

const pct = (x: number | null | undefined) =>
  x == null ? "-" : `${(x * 100).toFixed(1)}% a.a.`;

export default function SpreadPanel({ data }: { data: Spread | null }) {
  if (!data || !data.available || data.cagr_recente == null) return null;
  const ref = data.ref;
  const terra = data.cagr_recente;
  const max = Math.max(terra, ref?.cdi ?? 0, ref?.ipca ?? 0, 0.01);
  const bar = (v: number | undefined) => `${Math.round(((v ?? 0) / max) * 100)}%`;

  const spreadCdi = data.spread_vs_cdi ?? 0;

  return (
    <section className={styles.panel}>
      <header className={styles.head}>
        <span className={styles.badge}>Spread da terra</span>
        <span className={styles.scope}>
          {data.regiao ? `${data.regiao} · ` : ""}
          {data.periodo_recente ?? ""}
        </span>
      </header>

      <div className={styles.rows}>
        <div className={styles.row}>
          <span className={styles.rowName}>Terra na região (valorização)</span>
          <span>{pct(terra)}</span>
        </div>
        <div style={{ height: 6, borderRadius: 3, background: "var(--vt-green-600, #2f6b3f)", width: bar(terra) }} />
        {ref && (
          <>
            <div className={styles.row}>
              <span className={styles.rowMeta}>CDI (renda fixa)</span>
              <span className={styles.rowMeta}>{pct(ref.cdi)}</span>
            </div>
            <div style={{ height: 4, borderRadius: 2, background: "var(--vt-ink-faint, #999)", width: bar(ref.cdi) }} />
            <div className={styles.row}>
              <span className={styles.rowMeta}>IPCA (inflação)</span>
              <span className={styles.rowMeta}>{pct(ref.ipca)}</span>
            </div>
            <div style={{ height: 4, borderRadius: 2, background: "var(--vt-line, #ccc)", width: bar(ref.ipca) }} />
          </>
        )}
      </div>

      <p className={styles.note}>
        A terra da região valorizou <strong>{pct(terra)}</strong> nominal no período, um spread de{" "}
        <strong>{spreadCdi >= 0 ? "+" : ""}{(spreadCdi * 100).toFixed(1)} p.p.</strong> sobre o CDI.
        {data.nota ? ` ${data.nota}` : ""} Fonte: {data.fonte ?? "DERAL/SEAB-PR"}.
      </p>
    </section>
  );
}
