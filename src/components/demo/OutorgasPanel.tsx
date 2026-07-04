import type { Outorgas } from "../../lib/signals";
import styles from "./SignalsPanels.module.css";

export default function OutorgasPanel({ data }: { data: Outorgas | null }) {
  if (!data || !data.available) return null;
  const agua = data.agua;
  const min = data.mineracao;
  const nadaAgua = !agua || !agua.n_2km;
  const nadaMin = !min || (!min.n_intersecta && !min.n_2km);
  if (nadaAgua && nadaMin) return null;

  return (
    <section className={styles.panel}>
      <header className={styles.head}>
        <span className={styles.badge}>Água e mineração</span>
        <span className={styles.scope}>outorgas e direitos no entorno (2 km)</span>
      </header>

      {min && min.n_intersecta > 0 && (
        <div className={styles.alert}>
          <strong>
            {min.n_intersecta} processo{min.n_intersecta > 1 ? "s" : ""} minerário
            {min.n_intersecta > 1 ? "s" : ""} da ANM incide{min.n_intersecta > 1 ? "m" : ""} sobre a
            área informada
          </strong>
          {min.processos?.slice(0, 3).map((p) => (
            <span key={p.processo}>
              {" "}
              · {p.fase.toLowerCase()} ({p.substancia.toLowerCase()}, proc. {p.processo})
            </span>
          ))}
          . Direitos minerários de terceiros podem restringir o uso; verificar na ANM.
        </div>
      )}

      <div className={styles.rows}>
        {agua && agua.n_2km > 0 && (
          <div className={styles.row}>
            <span className={styles.rowName}>Uso de água no entorno</span>
            <span>
              {agua.n_2km} outorga{agua.n_2km > 1 ? "s" : ""}/uso{agua.n_2km > 1 ? "s" : ""} em 2 km
              {agua.vazao_m3h_2km ? ` · ${agua.vazao_m3h_2km} m³/h somados` : ""}
            </span>
            {agua.tipos?.length ? (
              <span className={styles.rowMeta}>
                {agua.tipos.map((t) => `${t.tipo} (${t.n})`).join(" · ")}
              </span>
            ) : null}
          </div>
        )}
        {min && min.n_2km > 0 && min.n_intersecta === 0 && (
          <div className={styles.row}>
            <span className={styles.rowName}>Mineração no entorno</span>
            <span>
              {min.n_2km} processo{min.n_2km > 1 ? "s" : ""} minerário{min.n_2km > 1 ? "s" : ""} em
              2 km (nenhum sobre a área)
            </span>
          </div>
        )}
      </div>

      <p className={styles.note}>
        Outorgas e usos de água ({data.fontes ?? "SIGARH/IAT-PR · ANM/SIGMINE"}). Água outorgada
        no entorno sinaliza disponibilidade hídrica consolidada (irrigação); processo minerário
        pode ser ativo ou restrição. Screening geométrico preliminar; não substitui certidões.
        Não altera o valor estimado.
      </p>
    </section>
  );
}
