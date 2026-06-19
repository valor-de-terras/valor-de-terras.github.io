import { useReveal } from "../../lib/useReveal";
import styles from "./Problem.module.css";

type Pain = {
  glyph: JSX.Element;
  title: string;
  body: string;
};

const PAINS: Pain[] = [
  {
    glyph: <GlyphCoin />,
    title: "Custo elevado",
    body: "Honorários de laudo individual pesam no orçamento e inviabilizam avaliar muitos imóveis ou reavaliar com frequência.",
  },
  {
    glyph: <GlyphClock />,
    title: "Semanas de prazo",
    body: "Coleta de dados, visita, pesquisa de comparáveis e redação se arrastam por semanas, atrasando crédito, partilha ou negócio.",
  },
  {
    glyph: <GlyphScatter />,
    title: "Variabilidade metodológica",
    body: "Dois avaliadores, dois resultados. Critérios de homogeneização mudam de pessoa para pessoa e o valor final fica frágil.",
  },
  {
    glyph: <GlyphTrace />,
    title: "Baixa rastreabilidade",
    body: "Fontes, premissas e cálculos ficam dispersos em planilhas e PDFs, difíceis de auditar e de defender em uma contestação.",
  },
];

export default function Problem() {
  const head = useReveal<HTMLDivElement>();
  const grid = useReveal<HTMLUListElement>();

  return (
    <section className={styles.section} id="problema" aria-labelledby="problema-title">
      <Grid />
      <div className={`vt-container ${styles.inner}`}>
        <div ref={head} className={`vt-reveal ${styles.head}`}>
          <span className="vt-eyebrow">Contexto e problema</span>
          <h2 id="problema-title" className={styles.title}>
            Laudos rurais ainda são manuais, caros e lentos.
          </h2>
          <p className={styles.lede}>
            O mercado brasileiro de avaliação rural e imobiliária ainda é dominado por laudos
            manuais, com custos elevados, prazos longos e alta variabilidade metodológica entre
            avaliadores. Produtores rurais, bancos, cooperativas de crédito, escritórios de
            advocacia, peritos judiciais e investidores precisam de avaliações robustas,
            rastreáveis e objetivas para garantia bancária, partilha, ITR, desapropriação,
            herança, CPR e operações de M&amp;A agrícola.
          </p>
          <p className={styles.note}>
            A ABNT NBR 14.653 é o padrão técnico reconhecido, mas sua aplicação é trabalhosa e
            pouco automatizada. A oportunidade está em automatizar a coleta de dados abertos, a
            homogeneização de atributos e a geração de relatórios defensáveis.
          </p>
        </div>

        <ul ref={grid} className={`vt-reveal ${styles.cards}`}>
          {PAINS.map((pain) => (
            <li key={pain.title} className={styles.card}>
              <span className={styles.icon} aria-hidden="true">
                {pain.glyph}
              </span>
              <h3 className={styles.cardTitle}>{pain.title}</h3>
              <p className={styles.cardBody}>{pain.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* Malha de grade cartográfica de fundo, sutil. */
function Grid() {
  return (
    <svg className={styles.gridSvg} viewBox="0 0 1440 520" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <pattern id="problemGrid" width="56" height="56" patternUnits="userSpaceOnUse">
          <path d="M56 0 H0 V56" fill="none" stroke="currentColor" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="1440" height="520" fill="url(#problemGrid)" />
    </svg>
  );
}

/* ---- Glifos SVG sóbrios, traço fino estilo técnico ---- */

function GlyphCoin() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M14.5 9.2c-.6-.9-1.6-1.4-2.7-1.4-1.6 0-2.6.8-2.6 2 0 2.6 5.4 1.3 5.4 4 0 1.3-1.1 2.2-2.8 2.2-1.2 0-2.3-.5-2.9-1.5" />
      <path d="M12 6.4v1.4M12 16.2v1.4" />
    </svg>
  );
}

function GlyphClock() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

function GlyphScatter() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19V5M4 19h15" />
      <circle cx="8" cy="14" r="1.3" />
      <circle cx="11.5" cy="9.5" r="1.3" />
      <circle cx="14.5" cy="15" r="1.3" />
      <circle cx="17.5" cy="8" r="1.3" />
    </svg>
  );
}

function GlyphTrace() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 4h8l4 4v12H6z" />
      <path d="M14 4v4h4" />
      <path d="M9 13h6M9 16h4" strokeDasharray="2 2.2" />
    </svg>
  );
}
