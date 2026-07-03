import { useState } from "react";
import type { Comparable, EstimateResult } from "../../types";
import { fmtArea, fmtNum } from "../../lib/format";
import styles from "./EstimateCard.module.css";

interface Props {
  result: EstimateResult;
  comparables: Comparable[];
  area: number;
  serverSide?: boolean;
  canRequestReport?: boolean;
  onOpenReport: () => void;
  onRequestReport: () => void;
}

export default function EstimateCard({
  result,
  comparables,
  area,
  serverSide,
  canRequestReport,
  onOpenReport,
  onRequestReport,
}: Props) {
  const [showComps, setShowComps] = useState(false);

  return (
    <section className={styles.card}>
      <div className={styles.flag}>
        <span className={styles.badge}>Estimativa preliminar</span>
        {serverSide && (
          <span
            className={styles.serverTag}
            title="Calculada no backend (Supabase + PostGIS) com dados abertos"
          >
            <span className={styles.serverDot} /> servidor + dados abertos
          </span>
        )}
        <span className={styles.grau}>
          Fundamentação NBR 14.653-3: <strong>Grau {result.grau}</strong> (preliminar) · modelo{" "}
          {result.modelVersion}
        </span>
      </div>

      <div className={styles.headline}>
        <span className={styles.bigLabel}>Valor total estimado</span>
        <div className={styles.locked} title="O valor é liberado no laudo formal (com ART)">
          <span className={styles.lockIcon} aria-hidden>🔒</span>
          <span className={styles.lockText}>Liberado no laudo com ART</span>
        </div>
        <span className={styles.lockNote}>
          A estimativa foi calculada sobre a sua geometria e {result.comparablesUsed} comparáveis.
          O valor fechado e o intervalo integram o laudo formal, assinado por responsável técnico.
        </span>
      </div>

      <div className={styles.metrics}>
        <div className={styles.metric}>
          <span className={styles.mLabel}>R$/ha (médio)</span>
          <span className={styles.mValue}>
            <span className={styles.masked} aria-label="disponível no laudo">🔒 •••</span>
          </span>
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
                  <td className={styles.num}><span className={styles.masked}>•••</span></td>
                  <td className={styles.num}><span className={styles.masked}>•••</span></td>
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
        <button
          className="vt-btn vt-btn-primary"
          onClick={onRequestReport}
          disabled={!canRequestReport}
          title={canRequestReport ? undefined : "Rode a estimativa no servidor para solicitar o laudo formal"}
        >
          Solicitar laudo com ART
        </button>
      </div>

      <p className={styles.disclaimer}>
        Estimativa preliminar (Grau I da NBR 14.653-3), calculada sobre a geometria informada
        (CAR real do SICAR ou arquivo enviado) e dados abertos reais (relevo, solo, uso, clima,
        acesso e referências DERAL/SEAB-PR). Não constitui laudo nem parecer técnico: a avaliação
        de imóvel rural é atribuição privativa de Engenheiro Agrônomo ou Florestal com CREA e ART.
        Os Graus II e III dependem da revisão técnica.
      </p>
    </section>
  );
}
