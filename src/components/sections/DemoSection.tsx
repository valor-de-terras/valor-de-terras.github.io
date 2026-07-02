import { useReveal } from "../../lib/useReveal";
import styles from "./DemoSection.module.css";

// Fontes abertas usadas na avaliação (prova de credibilidade na landing).
const SOURCES = ["SICAR", "MapBiomas", "EMBRAPA", "Open-Meteo", "OpenStreetMap", "DERAL/SEAB-PR"];

export default function DemoSection() {
  const ref = useReveal<HTMLDivElement>();

  return (
    <section className={styles.section} id="demo" aria-labelledby="demo-title">
      <div className="vt-container">
        <div ref={ref} className={`vt-reveal ${styles.card}`}>
          <span className="vt-eyebrow">Avaliação em minutos · sem cadastro</span>
          <h2 id="demo-title" className={styles.title}>Avalie sua propriedade</h2>
          <p className={styles.lede}>
            Informe a área por arquivo, ponto no mapa (CAR real) ou imóvel de exemplo e receba uma
            estimativa de valor a partir de dados abertos reais. Se precisar, prossiga para o laudo
            formal com ART.
          </p>
          <div className={styles.ctaRow}>
            <a href="#/avaliar" className="vt-btn vt-btn-primary">Avalie sua propriedade →</a>
            <a href="#como-funciona" className="vt-btn vt-btn-ghost">Como funciona</a>
          </div>
          <div className={styles.trust}>
            {SOURCES.map((s) => (
              <span key={s} className={styles.chip}>{s}</span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
