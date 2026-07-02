import styles from "./Footer.module.css";

const YEAR = 2026;

export default function Footer() {
  return (
    <footer className={styles.footer} id="contato">
      <div className={`vt-container ${styles.inner}`}>
        <div className={styles.brandCol}>
          <a href="#top" className={styles.brand}>
            <img src="/favicon.svg" alt="" width={32} height={32} className={styles.mark} />
            <span>
              Valor<span className={styles.accent}>de</span>Terras
            </span>
          </a>
          <p className={styles.tagline}>
            Avaliação de terras e propriedades fundamentada em dados abertos e na
            NBR 14.653. Da geometria ao valor em minutos.
          </p>
        </div>

        <nav className={styles.col} aria-label="Produto">
          <h4>Produto</h4>
          <a href="#produto">Visão geral</a>
          <a href="#como-funciona">Como funciona</a>
          <a href="#/avaliar">Avaliar propriedade</a>
          <a href="#precos">Preços</a>
        </nav>

        <nav className={styles.col} aria-label="Fontes de dados">
          <h4>Dados abertos</h4>
          <a href="https://www.car.gov.br/" target="_blank" rel="noopener noreferrer">SICAR / CAR</a>
          <a href="https://sigef.incra.gov.br/" target="_blank" rel="noopener noreferrer">INCRA / SIGEF</a>
          <a href="https://mapbiomas.org/" target="_blank" rel="noopener noreferrer">MapBiomas</a>
          <a href="https://www.gov.br/agricultura/" target="_blank" rel="noopener noreferrer">EMBRAPA</a>
        </nav>

        <nav className={styles.col} aria-label="Institucional">
          <h4>Institucional</h4>
          <a href="#publico">Para quem</a>
          <a href="#faq">Dúvidas</a>
          <a href="#/privacidade">Privacidade e Termos</a>
        </nav>
      </div>

      <div className={`vt-container ${styles.bottom}`}>
        <span>
          © {YEAR} Valor de Terras · Feito no Paraná 🌲 ·{" "}
          <a href="#/privacidade">Privacidade e Termos</a>
        </span>
        <span className={styles.legal}>
          Avaliação de imóveis rurais fundamentada na ABNT NBR 14.653 e em dados abertos. O laudo
          formal exige responsabilidade técnica (ART) de profissional habilitado junto ao CREA.
        </span>
      </div>
    </footer>
  );
}
