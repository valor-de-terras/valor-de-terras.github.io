import { useReveal } from "../../lib/useReveal";
import styles from "./DataSources.module.css";

type Source = {
  name: string;
  detail: string;
};

type Category = {
  key: string;
  label: string;
  glyph: string;
  sources: Source[];
};

const CATEGORIES: Category[] = [
  {
    key: "cadastro",
    label: "Cadastro fundiário",
    glyph: "▦",
    sources: [
      { name: "INCRA / SIGEF", detail: "geometria e malha de parcelas" },
      { name: "SICAR (CAR)", detail: "cadastro ambiental rural" },
      { name: "CCIR", detail: "certificado de imóvel rural" },
    ],
  },
  {
    key: "ambiental",
    label: "Ambiental e uso do solo",
    glyph: "❧",
    sources: [
      { name: "MapBiomas", detail: "cobertura e uso da terra" },
      { name: "IBAMA", detail: "áreas embargadas" },
      { name: "ICMBio", detail: "unidades de conservação" },
    ],
  },
  {
    key: "fisico",
    label: "Físico e climático",
    glyph: "△",
    sources: [
      { name: "EMBRAPA", detail: "solo · SiBCS" },
      { name: "CPRM", detail: "geologia" },
      { name: "INMET", detail: "clima" },
      { name: "ANA / SNIRH", detail: "hidrografia" },
      { name: "DEM SRTM / AW3D30", detail: "relevo" },
    ],
  },
  {
    key: "mercado",
    label: "Localização e mercado",
    glyph: "✶",
    sources: [
      { name: "IBGE", detail: "limites e setores" },
      { name: "OpenStreetMap", detail: "acesso e logística" },
      { name: "DERAL / SEAB-PR", detail: "preços de referência" },
      { name: "INCRA / PPR", detail: "preços referenciais por MRT" },
      { name: "Receita Federal / VTN", detail: "valor da terra nua (SIPT)" },
      { name: "CEPEA / ESALQ", detail: "preços de referência" },
    ],
  },
];

export default function DataSources() {
  const head = useReveal<HTMLDivElement>();
  const snapshot = useReveal<HTMLDivElement>();

  return (
    <section className={styles.section} id="dados" aria-labelledby="dados-title">
      <div className="vt-container vt-container-wide">
        <div ref={head} className={`vt-reveal ${styles.head}`}>
          <span className="vt-eyebrow">Dados abertos integrados</span>
          <h2 id="dados-title" className={styles.title}>
            Dados abertos, congelados e rastreáveis
          </h2>
          <p className={styles.lede}>
            Cada avaliação reúne mais de uma dezena de bases públicas oficiais, do cadastro
            fundiário ao mercado de terras. Nada de fontes opacas; tudo é citável, auditável e
            preso à versão exata consultada no dia do laudo.
          </p>
        </div>

        <div className={styles.grid}>
          {CATEGORIES.map((cat) => (
            <article key={cat.key} className={styles.group}>
              <header className={styles.groupHead}>
                <span className={styles.groupGlyph} aria-hidden="true">
                  {cat.glyph}
                </span>
                <h3 className={styles.groupLabel}>{cat.label}</h3>
                <span className={styles.groupCount}>{cat.sources.length}</span>
              </header>
              <ul className={styles.chips}>
                {cat.sources.map((src) => (
                  <li key={src.name} className={styles.chip}>
                    <span className={styles.chipName}>{src.name}</span>
                    <span className={styles.chipDetail}>{src.detail}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>

        <div ref={snapshot} className={`vt-reveal ${styles.snapshot}`}>
          <div className={styles.snapGrid} aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className={styles.snapBody}>
            <span className={styles.snapBadge}>
              <span className={styles.snapDot} /> DataSnapshot
            </span>
            <h3 className={styles.snapTitle}>
              A fonte de hoje fica disponível daqui a cinco anos
            </h3>
            <p className={styles.snapText}>
              No momento da avaliação, toda base consultada é congelada em uma versão
              identificada e armazenada com o laudo. Se a fonte original mudar, for atualizada
              ou sair do ar, o documento permanece defensável; é possível reabrir exatamente os
              dados que sustentaram cada número.
            </p>
            <dl className={styles.snapStats}>
              <div className={styles.snapStat}>
                <dt>Versão</dt>
                <dd>fonte + data + hash do recorte</dd>
              </div>
              <div className={styles.snapStat}>
                <dt>Rastreio</dt>
                <dd>cada valor liga à base de origem</dd>
              </div>
              <div className={styles.snapStat}>
                <dt>Validade</dt>
                <dd>reabre o estado original do dado</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </section>
  );
}
