import { useState } from "react";
import type { Comparable, EstimateResult } from "../../types";
import { fmtArea, fmtBRL, fmtBRLCompact, fmtNum } from "../../lib/format";
import styles from "./EstimateCard.module.css";

interface Props {
  result: EstimateResult;
  comparables: Comparable[];
  area: number;
  onOpenReport: () => void;
}

export default function EstimateCard({ result, comparables, area, onOpenReport }: Props) {
  const [showComps, setShowComps] = useState(false);

  return (
    <section className={styles.card}>
      <div className={styles.flag}>
        <span className={styles.badge}>Estimativa preliminar</span>
        <span className={styles.grau}>
          Grau de fundamentação: <strong>{result.grau}</strong> · modelo {result.modelVersion}
        </span>
      </div>

      <div className={styles.headline}>
        <span className={styles.bigLabel}>Valor total estimado</span>
        <span className={styles.big}>{fmtBRL(result.avg)}</span>
        <span className={styles.range}>
          intervalo {fmtBRLCompact(result.min)} — {fmtBRLCompact(result.max)}
        </span>
      </div>

      <div className={styles.metrics}>
        <div className={styles.metric}>
          <span className={styles.mLabel}>R$/ha (médio)</span>
          <span className={styles.mValue}>{fmtBRL(result.pricePerHaAvg)}</span>
        </div>
        <div className={styles.metric}>
          <span className={styles.mLabel}>Área avaliada</span>
          <span className={styles.mValue}>{fmtArea(area)}</span>
        </div>
        <div className={styles.metric}>
          <span className={styles.mLabel}>Comparáveis</span>
          <span className={styles.mValue}>{result.comparablesUsed}</span>
        </div>
      </div>

      <button
        className={styles.compsToggle}
        onClick={() => setShowComps((v) => !v)}
        aria-expanded={showComps}
      >
        {showComps ? "Ocultar" : "Ver"} comparáveis de mercado ({comparables.length})
        <span className={showComps ? styles.chevUp : styles.chev}>⌄</span>
      </button>

      {showComps && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Dist.</th>
                <th>Área</th>
                <th>Uso</th>
                <th className={styles.num}>R$/ha</th>
                <th className={styles.num}>Homog.</th>
                <th>Fonte</th>
              </tr>
            </thead>
            <tbody>
              {comparables.map((c) => (
                <tr key={c.id}>
                  <td>{c.distanceKm} km</td>
                  <td>{fmtNum(c.areaHa)} ha</td>
                  <td>{c.use}</td>
                  <td className={styles.num}>{fmtBRL(c.pricePerHa)}</td>
                  <td className={styles.num}>{fmtBRL(c.homogenizedPricePerHa)}</td>
                  <td className={styles.src}>{c.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className={styles.actions}>
        <button className="vt-btn vt-btn-accent" onClick={onOpenReport}>
          Ver prévia do laudo (NBR 14.653)
        </button>
        <button className="vt-btn vt-btn-ghost" onClick={onOpenReport}>
          Prosseguir para laudo com ART
        </button>
      </div>

      <p className={styles.disclaimer}>
        Simulação ilustrativa com dados sintéticos para demonstração do produto. Não
        constitui laudo nem parecer técnico. O laudo formal exige enriquecimento com
        fontes oficiais e responsabilidade técnica (ART) de profissional habilitado.
      </p>
    </section>
  );
}
