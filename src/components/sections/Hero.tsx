import { useReveal } from "../../lib/useReveal";
import styles from "./Hero.module.css";

export default function Hero() {
  const ref = useReveal<HTMLDivElement>();
  return (
    <section className={styles.hero} id="produto" aria-labelledby="hero-title">
      <Topo />
      <div className={`vt-container ${styles.inner}`}>
        <div ref={ref} className={`vt-reveal ${styles.copy}`}>
          <span className="vt-eyebrow">Avaliação rural · NBR 14.653 · dados abertos</span>
          <h1 id="hero-title" className={styles.title}>
            Do mapa ao <span className={styles.accent}>valor do imóvel</span>, em minutos.
          </h1>
          <p className={styles.lede}>
            Plataforma que gera estimativas e laudos de avaliação de terras e propriedades
            fundamentados em dados abertos (SIGEF, SICAR, MapBiomas, IBGE, EMBRAPA) e na
            ABNT NBR 14.653. Da geometria do imóvel à estimativa, sem semanas de trabalho manual.
          </p>
          <div className={styles.actions}>
            <a href="#/avaliar" className="vt-btn vt-btn-primary">
              Avalie sua propriedade →
            </a>
            <a href="#como-funciona" className="vt-btn vt-btn-ghost">
              Como funciona
            </a>
          </div>
          <ul className={styles.trust}>
            <li>
              <strong>10+</strong> fontes de dados abertos integradas
            </li>
            <li>
              <strong>NBR 14.653</strong> método comparativo e homogeneização
            </li>
            <li>
              <strong>Estimativa</strong> em minutos · laudo formal com ART
            </li>
          </ul>
        </div>

        <div className={styles.visual} aria-hidden="true">
          <div className={styles.card}>
            <div className={styles.cardMap}>
              <svg viewBox="0 0 320 220" className={styles.parcelSvg}>
                <defs>
                  <pattern id="hatch" width="8" height="8" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
                    <line x1="0" y1="0" x2="0" y2="8" stroke="#1f7551" strokeWidth="1" opacity="0.25" />
                  </pattern>
                </defs>
                <rect width="320" height="220" fill="#eef1ea" />
                <g stroke="#cdd6cb" strokeWidth="1" fill="none">
                  <path d="M0 60 H320 M0 120 H320 M0 180 H320 M80 0 V220 M160 0 V220 M240 0 V220" />
                </g>
                <path
                  d="M60 150 L70 70 L150 50 L230 78 L250 150 L180 185 L100 178 Z"
                  fill="url(#hatch)"
                  stroke="#0b2e23"
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                />
                <circle cx="156" cy="118" r="5" fill="#d2843a" stroke="#fff" strokeWidth="2" />
                <g fill="#c79a2e" stroke="#fff" strokeWidth="1.4">
                  <circle cx="40" cy="40" r="4" />
                  <circle cx="285" cy="55" r="4" />
                  <circle cx="278" cy="180" r="4" />
                  <circle cx="55" cy="195" r="4" />
                </g>
              </svg>
            </div>
            <div className={styles.cardBody}>
              <div className={styles.cardRow}>
                <span className={styles.cardLabel}>Fazenda Campos do Cará · Guarapuava/PR</span>
                <span className={styles.cardArea}>312 ha</span>
              </div>
              <div className={styles.cardEstimate}>
                <span className={styles.cardEstLabel}>Valor total estimado</span>
                <span className={styles.cardEstValue}>R$ 22,4 mi</span>
              </div>
              <div className={styles.chips}>
                <span>⛰ relevo</span>
                <span>🟤 solo</span>
                <span>🛰 uso</span>
                <span>💧 hidro</span>
                <span>📊 comparáveis</span>
              </div>
            </div>
          </div>
          <div className={styles.floatBadge}>
            <span className={styles.floatDot} /> estimativa em ~2 min
          </div>
        </div>
      </div>
    </section>
  );
}

function Topo() {
  return (
    <svg className={styles.topo} viewBox="0 0 1440 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.2">
        <path d="M-40 180 C 240 120, 420 220, 700 170 S 1180 90, 1500 160" />
        <path d="M-40 250 C 240 190, 420 300, 700 240 S 1180 150, 1500 230" />
        <path d="M-40 330 C 260 250, 460 380, 760 300 S 1220 200, 1500 300" />
        <path d="M-40 420 C 260 330, 480 470, 780 380 S 1240 270, 1500 380" />
        <path d="M-40 520 C 280 420, 520 560, 820 460 S 1260 340, 1500 470" />
      </g>
    </svg>
  );
}
