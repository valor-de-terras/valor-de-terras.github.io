import type { EnrichmentLayer } from "../../types";
import styles from "./EnrichmentTimeline.module.css";

interface Props {
  layers: EnrichmentLayer[];
  activeCount: number;
  done: boolean;
}

export default function EnrichmentTimeline({ layers, activeCount, done }: Props) {
  return (
    <section className={styles.box} aria-live="polite">
      <header className={styles.head}>
        <h3 className={styles.title}>
          {done ? "Enriquecimento concluído" : "Coletando dados abertos…"}
        </h3>
        <span className={styles.counter}>
          {Math.min(activeCount, layers.length)}/{layers.length}
        </span>
      </header>
      <ul className={styles.list}>
        {layers.map((l, i) => {
          const state = i < activeCount ? "done" : i === activeCount && !done ? "active" : "idle";
          return (
            <li key={l.key} className={styles[`item_${state}` as const] ?? styles.item_idle}>
              <span className={styles.glyph} style={{ background: l.accent }}>
                {state === "done" ? "✓" : l.glyph}
              </span>
              <div className={styles.body}>
                <div className={styles.row}>
                  <span className={styles.labelLine}>
                    <span className={styles.label}>{l.label}</span>
                    {l.real !== undefined && (
                      <span className={l.real ? styles.tagReal : styles.tagRef}>
                        {l.real ? "real" : "ref."}
                      </span>
                    )}
                  </span>
                  <span className={styles.source}>{l.source}</span>
                </div>
                {state === "done" && <p className={styles.result}>{l.result}</p>}
                {state === "active" && (
                  <p className={styles.loading}>
                    <span className={styles.dot} />
                    <span className={styles.dot} />
                    <span className={styles.dot} />
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
