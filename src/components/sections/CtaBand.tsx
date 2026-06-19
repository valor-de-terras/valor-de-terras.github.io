import { useReveal } from "../../lib/useReveal";
import styles from "./CtaBand.module.css";

export default function CtaBand() {
  const ref = useReveal<HTMLDivElement>();
  return (
    <section className={styles.cta} id="cta" aria-labelledby="cta-title">
      <Contours />
      <div className={styles.grid} aria-hidden="true" />
      <div className={`vt-container ${styles.inner}`}>
        <div ref={ref} className={`vt-reveal ${styles.copy}`}>
          <span className={`vt-eyebrow ${styles.eyebrow}`}>
            Sem cadastro · direto no navegador
          </span>
          <h2 id="cta-title" className={styles.title}>
            Avalie um imóvel <span className={styles.accent}>agora</span>.
          </h2>
          <p className={styles.lede}>
            Experimente a estimativa preliminar do valor de uma propriedade rural na
            própria página, em poucos passos. Nada para instalar, nada para preencher
            antes de ver o resultado.
          </p>
          <div className={styles.actions}>
            <a href="#demo" className={`vt-btn ${styles.primary}`}>
              Testar a demo
              <span className={styles.arrow} aria-hidden="true">
                →
              </span>
            </a>
            <a
              href="https://github.com/valor-de-terras"
              target="_blank"
              rel="noopener noreferrer"
              className={`vt-btn vt-btn-ghost ${styles.ghost}`}
            >
              <GithubGlyph />
              Ver no GitHub
            </a>
          </div>
          <p className={styles.note}>
            Estimativa preliminar para fins exploratórios. O laudo formal segue a ABNT NBR
            14.653, com ART e responsável técnico.
          </p>
        </div>
      </div>
    </section>
  );
}

function Contours() {
  return (
    <svg
      className={styles.contours}
      viewBox="0 0 1440 460"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <g fill="none" stroke="currentColor" strokeWidth="1.1">
        <path d="M-40 130 C 260 70, 460 180, 760 120 S 1220 40, 1500 110" />
        <path d="M-40 200 C 260 140, 460 250, 760 190 S 1220 110, 1500 180" />
        <path d="M-40 280 C 280 200, 500 330, 800 250 S 1240 150, 1500 260" />
        <path d="M-40 370 C 280 280, 520 420, 820 330 S 1260 220, 1500 350" />
      </g>
    </svg>
  );
}

function GithubGlyph() {
  return (
    <svg
      className={styles.glyph}
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
      />
    </svg>
  );
}
