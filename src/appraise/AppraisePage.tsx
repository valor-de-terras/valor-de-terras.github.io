import MapDemo from "../components/demo/MapDemo";
import styles from "./appraise.module.css";

/** Tela dedicada da ferramenta de avaliação (antes embutida na landing como "demo"). */
export default function AppraisePage() {
  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <a href="#/" className={styles.brand}>
          Valor<span>de</span>Terras
        </a>
        <div className={styles.spacer} />
        <a className={styles.linkBtn} href="#/pedidos">Meus pedidos</a>
        <a className={styles.linkBtn} href="#/">Voltar ao site</a>
      </header>

      <main className={styles.body}>
        <div className={styles.head}>
          <span className={styles.eyebrow}>Avaliação · NBR 14.653 · dados abertos</span>
          <h1 className={styles.title}>Avalie sua propriedade</h1>
          <p className={styles.lede}>
            Informe a área do imóvel (arquivo geográfico, ponto no mapa ou CAR) e receba uma
            estimativa de valor em minutos, a partir de dados abertos reais. Se quiser, prossiga
            para o laudo formal com ART.
          </p>
        </div>

        <div className="vt-container vt-container-wide">
          <MapDemo />
        </div>

        <p className={styles.disclaimer}>
          Estimativa preliminar (Grau I da NBR 14.653-3), calculada sobre a geometria informada e
          dados abertos reais. Não constitui laudo nem parecer técnico: a avaliação de imóvel rural
          é atribuição privativa de Engenheiro Agrônomo ou Florestal com CREA e ART.
        </p>
      </main>
    </div>
  );
}
