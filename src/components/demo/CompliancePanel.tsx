import type { Compliance } from "../../lib/signals";
import styles from "./SignalsPanels.module.css";

const KIND_LABEL: Record<string, string> = {
  uc: "Unidade de Conservação",
  ti: "Terra Indígena",
  embargo: "Embargo IBAMA",
};

export default function CompliancePanel({ data }: { data: Compliance | null }) {
  if (!data || !data.available) return null;
  const hits = data.intersecta ?? [];
  const near = data.proximas_2km ?? [];
  const urb = data.urbano;
  if (!hits.length && !near.length && !urb?.dentro) return null;

  return (
    <section className={styles.panel}>
      <header className={styles.head}>
        <span className={`${styles.badge} ${hits.length ? styles.badgeWarn : ""}`}>
          Restrições · screening
        </span>
        <span className={styles.scope}>UCs · TIs · embargos · perímetro urbano</span>
      </header>

      {urb?.dentro && (
        <div className={styles.alert}>
          <strong>Área dentro de perímetro urbano</strong> ({urb.perimetro ?? urb.municipio}
          {urb.lei ? `, lei ${urb.lei}` : ""}). A estimativa usa metodologia rural
          (NBR 14.653-3); para imóvel urbano a referência é a NBR 14.653-2 e o resultado pode
          não se aplicar.
        </div>
      )}

      {hits.length > 0 ? (
        <div className={styles.rows}>
          {hits.map((h, i) => (
            <div className={styles.row} key={`${h.kind}-${i}`}>
              <span className={styles.rowName}>{KIND_LABEL[h.kind] ?? h.kind}</span>
              <span>
                sobrepõe a área informada · {h.nome ?? "-"}
                {h.categoria ? ` (${h.categoria})` : ""}
              </span>
            </div>
          ))}
        </div>
      ) : (
        !urb?.dentro && (
          <p className={styles.ok}>
            Nenhuma UC, TI ou embargo IBAMA sobrepõe a área informada nas bases consultadas.
          </p>
        )
      )}

      {near.length > 0 && (
        <div className={styles.rows} style={{ marginTop: "0.45rem" }}>
          {near.map((h, i) => (
            <div className={styles.row} key={`n-${h.kind}-${i}`}>
              <span className={styles.rowName}>{KIND_LABEL[h.kind] ?? h.kind} próxima</span>
              <span>
                a {h.dist_km} km · {h.nome ?? "-"}
              </span>
            </div>
          ))}
        </div>
      )}

      <p className={styles.note}>
        {data.nota ?? "Screening preliminar por sobreposição geométrica."} Fontes:{" "}
        {data.fontes ?? "CNUC/MMA · FUNAI · IBAMA"}. Relevante para protocolos de mercado
        (EUDR: livre de desmatamento e de sobreposições). Não altera o valor estimado.
      </p>
    </section>
  );
}
