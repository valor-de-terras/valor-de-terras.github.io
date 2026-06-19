import { useReveal } from "../../lib/useReveal";
import styles from "./Audience.module.css";

type Glyph = "bank" | "report" | "scale" | "tag" | "field" | "fund";

interface AudienceItem {
  glyph: Glyph;
  title: string;
  useCase: string;
}

const ITEMS: AudienceItem[] = [
  {
    glyph: "bank",
    title: "Bancos e cooperativas de crédito rural",
    useCase:
      "Avaliação de garantia real e renovação de limites com valor rastreável até a fonte do dado.",
  },
  {
    glyph: "report",
    title: "Escritórios de avaliação e peritos judiciais",
    useCase:
      "Laudos e perícias com método comparativo, homogeneização e memória de cálculo prontos para citação.",
  },
  {
    glyph: "scale",
    title: "Cartórios e advocacia especializada",
    useCase:
      "Sucessões, partilhas e disputas fundiárias com base de valor defensável e documentada.",
  },
  {
    glyph: "tag",
    title: "Imobiliárias rurais e consultorias agro",
    useCase:
      "Precificação de imóveis e prospecção de oportunidades a partir da geometria e do uso do solo.",
  },
  {
    glyph: "field",
    title: "Produtores rurais",
    useCase:
      "Argumentos sólidos para negociar CPR, arrendamento ou venda sem depender de palpite de terceiros.",
  },
  {
    glyph: "fund",
    title: "Fundos de investimento agrícola",
    useCase:
      "Originação e gestão de portfólio de farmland com valuation padronizada entre ativos e regiões.",
  },
];

export default function Audience() {
  const headRef = useReveal<HTMLDivElement>();
  const gridRef = useReveal<HTMLUListElement>();

  return (
    <section className={styles.section} id="publico" aria-labelledby="publico-title">
      <div className="vt-container vt-container-wide">
        <div ref={headRef} className={`vt-reveal ${styles.head}`}>
          <span className="vt-eyebrow">Para quem</span>
          <h2 id="publico-title" className={styles.title}>
            Feito para quem precisa de valor defensável
          </h2>
          <p className={styles.lede}>
            Quando um número de avaliação vira garantia, laudo, herança ou tese, ele precisa
            sustentar a discussão. A plataforma entrega esse valor com a fonte, o método e a
            memória de cálculo ao lado. Veja onde isso resolve.
          </p>
        </div>

        <ul ref={gridRef} className={`vt-reveal ${styles.grid}`}>
          {ITEMS.map((item) => (
            <li key={item.title} className={styles.card}>
              <span className={styles.glyph} aria-hidden="true">
                <GlyphIcon name={item.glyph} />
              </span>
              <h3 className={styles.cardTitle}>{item.title}</h3>
              <p className={styles.cardUse}>{item.useCase}</p>
            </li>
          ))}
        </ul>

        <p className={styles.note}>
          Não encontrou o seu caso? O motor de avaliação é o mesmo; muda só a forma de entregar
          o resultado.
        </p>
      </div>
    </section>
  );
}

function GlyphIcon({ name }: { name: Glyph }) {
  switch (name) {
    case "bank":
      return (
        <svg viewBox="0 0 24 24" className={styles.svg} role="presentation">
          <path d="M3 9.5 12 4l9 5.5" />
          <path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8" />
          <path d="M3.5 18.5h17" />
        </svg>
      );
    case "report":
      return (
        <svg viewBox="0 0 24 24" className={styles.svg} role="presentation">
          <path d="M6 3h8l4 4v14H6z" />
          <path d="M14 3v4h4" />
          <path d="M9 12h6M9 15.5h6M9 8.5h2.5" />
        </svg>
      );
    case "scale":
      return (
        <svg viewBox="0 0 24 24" className={styles.svg} role="presentation">
          <path d="M12 4v16M7 20h10" />
          <path d="M5 8h14M5 8l-2.5 5h5zM19 8l-2.5 5h5z" />
        </svg>
      );
    case "tag":
      return (
        <svg viewBox="0 0 24 24" className={styles.svg} role="presentation">
          <path d="M4 4h7l9 9-7 7-9-9z" />
          <circle cx="8.5" cy="8.5" r="1.4" />
        </svg>
      );
    case "field":
      return (
        <svg viewBox="0 0 24 24" className={styles.svg} role="presentation">
          <path d="M3 18.5h18" />
          <path d="M5 18.5c0-4 1-7 3-7M11 18.5c0-5 1-9 3-11M17 18.5c0-3 1-5 2.5-5" />
        </svg>
      );
    case "fund":
      return (
        <svg viewBox="0 0 24 24" className={styles.svg} role="presentation">
          <path d="M4 19.5h16" />
          <path d="M5 17l4-5 3.5 3 5.5-8" />
          <path d="M18 4.5h2v3" />
        </svg>
      );
  }
}
