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
            Obtenha a estimativa preliminar do valor de uma propriedade rural em poucos
            passos. Nada para instalar, nada para preencher antes de ver o resultado.
          </p>
          <div className={styles.actions}>
            <a href="#/avaliar" className={`vt-btn ${styles.primary}`}>
              Avalie sua propriedade
              <span className={styles.arrow} aria-hidden="true">
                →
              </span>
            </a>
            <a href="#precos" className={`vt-btn vt-btn-ghost ${styles.ghost}`}>
              Ver preços
            </a>
          </div>
          <p className={styles.note}>
            Estimativa preliminar (Grau I da NBR 14.653-3), imediata. O laudo formal segue a
            ABNT NBR 14.653, com ART e responsável técnico habilitado no CREA.
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

