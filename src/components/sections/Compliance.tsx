import { useReveal } from "../../lib/useReveal";
import styles from "./Compliance.module.css";

function Check() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
function Cross() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export default function Compliance() {
  const head = useReveal<HTMLDivElement>();
  const cards = useReveal<HTMLDivElement>();

  return (
    <section className={styles.section} id="responsabilidade" aria-labelledby="resp-title">
      <div className="vt-container">
        <div ref={head} className={`vt-reveal ${styles.head}`}>
          <span className="vt-eyebrow">Responsabilidade técnica · NBR 14.653-3</span>
          <h2 id="resp-title" className={styles.title}>
            Quem pode assinar o laudo
          </h2>
          <p className={styles.lede}>
            A avaliação de imóveis rurais é atribuição <strong>privativa</strong> de Engenheiro
            Agrônomo ou Engenheiro Florestal com registro ativo no CREA, mediante Anotação de
            Responsabilidade Técnica (ART), conforme a NBR 14.653-3 e as Resoluções 218 e 345 do
            CONFEA. A estimativa automatizada é triagem; o laudo é sempre humano e assinado.
          </p>
        </div>

        <div ref={cards} className={`vt-reveal ${styles.cards}`}>
          <article className={`${styles.card} ${styles.cardYes}`}>
            <header className={styles.cardHead}>
              <span className={styles.iconYes}>
                <Check />
              </span>
              <h3 className={styles.cardTitle}>Habilitado a assinar</h3>
            </header>
            <ul className={styles.list}>
              <li>
                <strong>Engenheiro Agrônomo</strong> — responsável principal por imóveis rurais
                em geral.
              </li>
              <li>
                <strong>Engenheiro Florestal</strong> — em especial quando há componente
                florestal relevante.
              </li>
              <li>
                Outras engenharias agrárias, conforme o escopo, desde que com CREA ativo e
                atribuições compatíveis.
              </li>
            </ul>
            <p className={styles.cardFoot}>Sempre com registro ativo no CREA e ART emitida.</p>
          </article>

          <article className={`${styles.card} ${styles.cardNo}`}>
            <header className={styles.cardHead}>
              <span className={styles.iconNo}>
                <Cross />
              </span>
              <h3 className={styles.cardTitle}>Não alcança imóvel rural</h3>
            </header>
            <ul className={styles.list}>
              <li>
                <strong>Corretor de imóveis</strong> (CRECI/COFECI) pode emitir parecer técnico
                de avaliação mercadológica apenas de imóveis <strong>urbanos</strong>.
              </li>
              <li>
                Imóvel com características mistas (urbano e rural) exige atuação conjunta:
                engenheiro civil ou arquiteto na parte urbana e agrônomo ou florestal na rural.
              </li>
            </ul>
            <p className={styles.cardFoot}>
              Avaliação rural fora dessa atribuição não tem validade técnica nem jurídica.
            </p>
          </article>
        </div>

        <div className={styles.grauStrip}>
          <div className={styles.grauItem}>
            <span className={styles.grauTag}>Grau I</span>
            <span className={styles.grauDesc}>Estimativa automatizada (preliminar), em minutos</span>
          </div>
          <span className={styles.grauArrow} aria-hidden="true">→</span>
          <div className={styles.grauItem}>
            <span className={`${styles.grauTag} ${styles.grauTagHi}`}>Grau II / III</span>
            <span className={styles.grauDesc}>
              Revisão técnica + qualificação do responsável (histórico de ART, experiência) e
              emissão do laudo assinado
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
