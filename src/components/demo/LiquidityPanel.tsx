import type { Liquidity } from "../../lib/liquidity";
import styles from "./LiquidityPanel.module.css";

const MATURE_DAYS = 14; // abaixo disso a mediana não é confiável (base recém-coletada)

function scopeLabel(e: string): string {
  if (e === "municipio") return "neste município";
  if (e === "uf") return "no Paraná, mesma faixa de área";
  return "no Paraná, imóveis rurais";
}

export default function LiquidityPanel({ data }: { data: Liquidity | null }) {
  if (!data || data.escopo === "vazio" || !data.n) return null;

  const mature = (data.max_dias ?? 0) >= MATURE_DAYS;
  const dias = data.mediana_dias ?? 0;
  const meses = dias / 30;
  const tempo = dias < 45 ? `${Math.round(dias)} dias` : `~${meses.toFixed(1)} meses`;

  return (
    <section className={styles.panel}>
      <header className={styles.head}>
        <span className={styles.badge}>Liquidez de mercado</span>
        <span className={styles.scope}>
          {scopeLabel(data.escopo)} · {data.n} anúncios
        </span>
      </header>

      {mature ? (
        <div className={styles.metrics}>
          <div className={styles.metric}>
            <span className={styles.mLabel}>Tempo no mercado (mediana)</span>
            <span className={styles.mValue}>{tempo}</span>
          </div>
          <div className={styles.metric}>
            <span className={styles.mLabel}>Já saíram do mercado</span>
            <span className={styles.mValue}>
              {Math.round((data.taxa_inativos ?? 0) * 100)}%
            </span>
          </div>
        </div>
      ) : (
        <p className={styles.forming}>
          Base de <strong>{data.n} anúncios</strong> em coleta diária. O tempo mediano no
          mercado (sinal de iliquidez) da região aparece aqui conforme o histórico amadurece.
        </p>
      )}

      <p className={styles.note}>
        Indicador de mercado da região a partir de anúncios públicos (imóveis à venda). A mediana
        inclui anúncios ainda ativos, então o tempo real até vender tende a ser maior. Não é o
        valor do imóvel; ajuda a entender a facilidade de vender na localidade.
      </p>
    </section>
  );
}
