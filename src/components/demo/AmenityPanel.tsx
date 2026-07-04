import type { Amenities } from "../../lib/signals";
import styles from "./SignalsPanels.module.css";

export default function AmenityPanel({ data }: { data: Amenities | null }) {
  if (!data || !data.available) return null;
  const fator = Math.round((data.fator_sugerido ?? 0) * 100);
  const dest = data.destaques ?? [];
  if (!fator && !dest.length) return null;

  return (
    <section className={styles.panel}>
      <header className={styles.head}>
        <span className={styles.badge}>Atratividade locacional</span>
        <span className={styles.scope}>fator sugerido +{fator}% (arbítrio ABNT)</span>
      </header>

      <div className={styles.rows}>
        {data.cidade_polo && (
          <div className={styles.row}>
            <span className={styles.rowName}>Cidade-polo</span>
            <span>{data.cidade_polo}</span>
          </div>
        )}
        {data.cenico_km != null && (
          <div className={styles.row}>
            <span className={styles.rowName}>Atrativo cênico mais próximo</span>
            <span>{data.cenico_km} km</span>
          </div>
        )}
        {dest.length > 0 && (
          <div className={styles.row}>
            <span className={styles.rowName}>
              {data.n_atrativos_15km ?? dest.length} atrativos em 15 km
            </span>
            <span className={styles.rowMeta}>
              {dest.slice(0, 3).map((d) => d.nome).join(" · ")}
            </span>
          </div>
        )}
      </div>

      <p className={styles.note}>
        Proximidade a atrativos turísticos/cênicos e a centros urbanos ({data.fonte ?? "OSM"}).
        Sustenta um <strong>fator de valorização locacional de até +15%</strong> no campo de
        arbítrio da NBR 14.653; a aplicação é decisão do responsável técnico no laudo. Não altera
        a estimativa preliminar.
      </p>
    </section>
  );
}
