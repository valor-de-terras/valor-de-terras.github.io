import type { Logistics } from "../../lib/logistics";
import styles from "./LogisticsPanel.module.css";

function fmtCap(t: number): string {
  if (t >= 1_000_000) return `${(t / 1_000_000).toFixed(1)} mi t`;
  if (t >= 1_000) return `${Math.round(t / 1_000)} mil t`;
  return `${t} t`;
}

function scoreLabel(s: number): string {
  if (s >= 75) return "excelente";
  if (s >= 55) return "bom";
  if (s >= 35) return "regular";
  return "restrito";
}

export default function LogisticsPanel({ data }: { data: Logistics | null }) {
  if (!data || !data.available || data.score == null) return null;

  const nearest = data.nearest ?? [];

  return (
    <section className={styles.panel}>
      <header className={styles.head}>
        <span className={styles.badge}>Escoamento · grãos</span>
        <span className={styles.scope}>
          acesso {scoreLabel(data.score)} · score {Math.round(data.score)}/100
        </span>
      </header>

      <div className={styles.metrics}>
        <div className={styles.metric}>
          <span className={styles.mLabel}>Armazém mais próximo</span>
          <span className={styles.mValue}>
            {nearest[0] ? `${nearest[0].dist_km} km` : "—"}
          </span>
          {nearest[0] && (
            <span className={styles.mSub}>
              {nearest[0].municipio ?? ""}
              {nearest[0].cap_t ? ` · ${fmtCap(nearest[0].cap_t)}` : ""}
            </span>
          )}
        </div>
        <div className={styles.metric}>
          <span className={styles.mLabel}>Armazenagem num raio de 50 km</span>
          <span className={styles.mValue}>{fmtCap(data.cap_50km_t ?? 0)}</span>
          <span className={styles.mSub}>{data.n_50km ?? 0} armazéns cadastrados</span>
        </div>
        <div className={styles.metric}>
          <span className={styles.mLabel}>{data.port_name ?? "Porto"}</span>
          <span className={styles.mValue}>
            {data.port_dist_km != null ? `${data.port_dist_km} km` : "—"}
          </span>
          <span className={styles.mSub}>distância em linha reta</span>
        </div>
      </div>

      <p className={styles.note}>
        Sinal logístico da cadeia de grãos: proximidade e capacidade de armazenagem
        ({data.fonte ?? "CONAB"}) e distância ao porto exportador. O score reflete a
        proximidade à infraestrutura de escoamento, não a vocação produtiva da região.
        Distâncias em linha reta; a análise por tempo de rota e por outras cadeias
        (madeira, pecuária, leite) entra nas próximas versões. Não altera o valor estimado.
      </p>
    </section>
  );
}
