import type { Zarc } from "../../lib/signals";
import styles from "./SignalsPanels.module.css";

function aptidao(n20: number): string {
  if (n20 >= 10) return "ampla";
  if (n20 >= 5) return "boa";
  if (n20 >= 1) return "restrita";
  return "sem janela a 20%";
}

export default function ZarcPanel({ data }: { data: Zarc | null }) {
  if (!data || !data.available || !data.culturas?.length) return null;

  return (
    <section className={styles.panel}>
      <header className={styles.head}>
        <span className={styles.badge}>Aptidão climática · ZARC</span>
        <span className={styles.scope}>{data.culturas[0].safra} · sequeiro</span>
      </header>

      <div className={styles.rows}>
        {data.culturas.map((c) => (
          <div className={styles.row} key={c.cultura}>
            <span className={styles.rowName}>{c.cultura}</span>
            <span>
              {c.n_dec20 > 0
                ? `${c.n_dec20} decêndio${c.n_dec20 > 1 ? "s" : ""} com risco 20%`
                : "sem janela com risco 20%"}
              {" · "}aptidão {aptidao(c.n_dec20)}
            </span>
            {c.janela && <span className={styles.rowMeta}>janela: {c.janela}</span>}
          </div>
        ))}
      </div>

      <p className={styles.note}>
        Zoneamento Agrícola de Risco Climático (portarias MAPA, {data.fonte ?? "dados abertos"}),
        melhor combinação de solo e ciclo em sequeiro. Indica em quantos decêndios do ano o
        plantio tem risco climático de 20% (o nível exigido pelo Proagro/crédito na maioria
        dos casos). Não altera o valor estimado.
      </p>
    </section>
  );
}
