import { useReveal } from "../../lib/useReveal";
import styles from "./ValueProp.module.css";

type Pillar = {
  glyph: JSX.Element;
  index: string;
  title: string;
  body: string;
};

const PILLARS: Pillar[] = [
  {
    index: "01",
    title: "Dados abertos integrados",
    body: "INCRA/SIGEF, SICAR, MapBiomas, IBGE, CPRM e EMBRAPA, mais cartórios, ITR da Receita e séries de clima e solo. Tudo reunido a partir da geometria do imóvel.",
    glyph: (
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
          <path d="M8 13 L20 8 L32 13 L20 18 Z" />
          <path d="M8 20 L20 25 L32 20" opacity="0.7" />
          <path d="M8 27 L20 32 L32 27" opacity="0.45" />
        </g>
      </svg>
    ),
  },
  {
    index: "02",
    title: "Comparáveis por raio",
    body: "Análise de mercado em um raio geográfico configurável a partir do imóvel avaliando, selecionando transações e ofertas pertinentes ao recorte.",
    glyph: (
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <g fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="20" cy="20" r="11" strokeDasharray="3 3" />
          <circle cx="20" cy="20" r="3" fill="currentColor" stroke="none" />
          <circle cx="29" cy="13" r="2" fill="currentColor" stroke="none" />
          <circle cx="12" cy="26" r="2" fill="currentColor" stroke="none" />
          <circle cx="28" cy="27" r="2" fill="currentColor" stroke="none" />
        </g>
      </svg>
    ),
  },
  {
    index: "03",
    title: "Homogeneização de atributos",
    body: "Ajuste por área, aptidão agrícola, relevo, acesso, infraestrutura e distância a polos logísticos, alinhando os comparáveis ao imóvel em avaliação.",
    glyph: (
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <path d="M11 12 H29 M11 20 H29 M11 28 H29" />
          <circle cx="16" cy="12" r="3" fill="var(--vt-paper)" />
          <circle cx="24" cy="20" r="3" fill="var(--vt-paper)" />
          <circle cx="18" cy="28" r="3" fill="var(--vt-paper)" />
        </g>
      </svg>
    ),
  },
  {
    index: "04",
    title: "Laudo técnico em PDF",
    body: "Saída de cerca de 40 páginas aderente à NBR 14.653, com metodologia detalhada, memorial de cálculo e anexos cartográficos.",
    glyph: (
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
          <path d="M13 7 H24 L29 12 V33 H13 Z" />
          <path d="M24 7 V12 H29" />
          <path d="M16 19 H26 M16 23 H26 M16 27 H22" strokeWidth="1.3" opacity="0.7" />
        </g>
      </svg>
    ),
  },
];

export default function ValueProp() {
  const headRef = useReveal<HTMLDivElement>();
  const gridRef = useReveal<HTMLDivElement>();

  return (
    <section className={styles.section} id="proposta" aria-labelledby="proposta-title">
      <div className="vt-container vt-container-wide">
        <div className={styles.layout}>
          <div ref={headRef} className={`vt-reveal ${styles.intro}`}>
            <span className="vt-eyebrow">Proposta de valor</span>
            <h2 id="proposta-title" className={styles.title}>
              De semanas para horas, com base <span className={styles.accent}>defensável</span>.
            </h2>
            <p className={styles.lede}>
              Uma plataforma web que produz estimativas e laudos de avaliação de terras e
              propriedades, rurais e urbanas, sobre quatro pilares metodológicos. O laudo
              preliminar deixa de levar semanas e passa a levar horas, sustentado por uma base
              que se mantém em instâncias técnicas e judiciais.
            </p>

            <dl className={styles.statRow}>
              <div className={styles.stat}>
                <dt className={styles.statLabel}>Tempo do laudo preliminar</dt>
                <dd className={styles.statValue}>
                  Semanas <span className={styles.statArrow} aria-hidden="true">→</span> horas
                </dd>
              </div>
              <div className={styles.stat}>
                <dt className={styles.statLabel}>Norma de referência</dt>
                <dd className={styles.statValue}>NBR 14.653</dd>
              </div>
            </dl>

            <p className={styles.note}>
              Escopo e prazos preliminares; o laudo formal acompanha responsabilidade técnica.
            </p>
          </div>

          <div ref={gridRef} className={`vt-reveal ${styles.grid}`}>
            {PILLARS.map((pillar) => (
              <article key={pillar.index} className={styles.cardItem}>
                <div className={styles.cardTop}>
                  <span className={styles.cardGlyph}>{pillar.glyph}</span>
                  <span className={styles.cardIndex}>{pillar.index}</span>
                </div>
                <h3 className={styles.cardTitle}>{pillar.title}</h3>
                <p className={styles.cardBody}>{pillar.body}</p>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
