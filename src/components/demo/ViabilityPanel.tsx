import type { Viability } from "../../lib/signals";
import styles from "./ViabilityPanel.module.css";

function grade(score: number): string {
  if (score >= 65) return "alta";
  if (score >= 45) return "média";
  if (score >= 25) return "baixa";
  return "marginal";
}

function fmtPreco(p: NonNullable<Viability["atividades"]>[number]["preco"]): string {
  if (!p) return "";
  const unid = p.unidade.replace("saca 60 kg", "sc").replace("arroba", "@");
  return `R$ ${p.preco.toFixed(2)}/${unid}`;
}

export default function ViabilityPanel({ data }: { data: Viability | null }) {
  if (!data || !data.available || !data.atividades?.length) return null;
  const max = Math.max(...data.atividades.map((a) => a.score), 1);

  return (
    <section className={styles.panel}>
      <header className={styles.head}>
        <span className={styles.badge}>Viabilidade por atividade</span>
        <span className={styles.scope}>
          {data.regional ? `regional ${data.regional} · ` : ""}acesso ao mercado × aptidão
        </span>
      </header>

      <div className={styles.rows}>
        {data.atividades.map((a) => (
          <div className={styles.row} key={a.cadeia}>
            <div className={styles.rowTop}>
              <span className={styles.name}>{a.label}</span>
              <span className={styles.grade}>
                {a.receita_ha != null
                  ? `~R$ ${a.receita_ha.toLocaleString("pt-BR")}/ha · `
                  : ""}
                viabilidade {grade(a.score)} · {a.score}/100
              </span>
            </div>
            <div className={styles.bar}>
              <div
                className={styles.barFill}
                style={{ width: `${Math.round((a.score / max) * 100)}%` }}
              />
            </div>
            <div className={styles.meta}>
              {a.destino
                ? `comprador: ${a.destino_municipio ?? a.destino} a ${
                    a.destino_estrada_km ?? a.destino_km
                  } km${a.destino_tempo_min != null ? ` (~${a.destino_tempo_min} min)` : ""}`
                : "comprador não cadastrado nesta base"}
              {a.preco ? ` · ${fmtPreco(a.preco)}` : ""}
              {a.cadeia === "graos" ? ` · aptidão ZARC ${a.aptidao}%` : ""}
            </div>
          </div>
        ))}
      </div>

      <p className={styles.note}>
        Ranking de atividades que viabilizam o investimento na área: combina a{" "}
        <strong>distância por estrada (estimada) ao comprador da cadeia</strong> (armazém,
        frigorífico, laticínio, indústria florestal) com a <strong>aptidão</strong> (grãos pelo
        ZARC do município; as
        demais pela tolerância da atividade a solo e relevo). O <strong>R$/ha</strong> é a receita
        bruta potencial de referência (produtividade × preço regional), não a margem líquida.
        Distância por estrada estimada (fator de sinuosidade sobre a linha reta), não roteamento
        GPS. Sinal de mercado e logística; não altera o valor estimado.
      </p>
    </section>
  );
}
