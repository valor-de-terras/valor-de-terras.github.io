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
            {data.armazem_estrada_km != null
              ? `${data.armazem_estrada_km} km`
              : nearest[0]
              ? `${nearest[0].dist_km} km`
              : "—"}
          </span>
          {nearest[0] && (
            <span className={styles.mSub}>
              {nearest[0].municipio ?? ""}
              {data.armazem_tempo_min != null ? ` · ~${data.armazem_tempo_min} min` : ""}
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

      {data.graos && data.graos.length > 0 && (
        <div className={styles.graos}>
          <span className={styles.graosHead}>
            Preço da cadeia de grãos
            {data.graos_regional ? ` · regional ${data.graos_regional}` : ""}
          </span>
          <div className={styles.graosRows}>
            {data.graos.map((g) => (
              <div className={styles.graosRow} key={g.produto}>
                <span className={styles.graosProd}>{g.produto.replace(/ tipo 1$/, "")}</span>
                <span className={styles.graosPrice}>
                  R$ {g.preco.toFixed(2)}/{g.unidade.replace("saca 60 kg", "sc")}
                </span>
                {g.frete_ate_armazem != null && (
                  <span className={styles.graosFreight}>
                    frete ao armazém ~R$ {g.frete_ate_armazem.toFixed(2)}/sc
                    {g.frete_pct != null ? ` (${g.frete_pct}%)` : ""}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <p className={styles.note}>
        Sinal logístico da cadeia de grãos: proximidade e capacidade de armazenagem
        ({data.fonte ?? "CONAB"}) e distância ao porto exportador. O score reflete a
        proximidade à infraestrutura de escoamento, não a vocação produtiva da região.
        Preços regionais SIMA/SEAB-PR; o frete estimado usa a distância até o armazém e um
        custo paramétrico (calibrar com SIFRECA). Distâncias em linha reta; tempo de rota e
        outras cadeias (madeira, pecuária, leite) entram nas próximas versões. Não altera o
        valor estimado.
      </p>
    </section>
  );
}
