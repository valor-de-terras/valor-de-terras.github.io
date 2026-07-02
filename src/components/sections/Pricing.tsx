import { useReveal } from "../../lib/useReveal";
import styles from "./Pricing.module.css";

type Plan = {
  id: string;
  eyebrow: string;
  name: string;
  price: string;
  priceNote?: string;
  unit?: string;
  blurb: string;
  features: string[];
  cta: { label: string; href: string; variant: string };
  featured?: boolean;
};

const PLANS: Plan[] = [
  {
    id: "estimativa",
    eyebrow: "Para experimentar",
    name: "Estimativa",
    price: "Grátis",
    priceNote: "estimativa preliminar (Grau I)",
    blurb:
      "Estimativa automatizada do valor, em minutos, sem cadastro. É a triagem antes do laudo formal.",
    features: [
      "Estimativa preliminar de valor (Grau I)",
      "Geometria por CAR, KMZ, SHP ou ponto no mapa",
      "Dados abertos reais (relevo, solo, uso, clima)",
      "Sem cartão de crédito",
    ],
    cta: { label: "Avaliar grátis", href: "#/avaliar", variant: "vt-btn-ghost" },
  },
  {
    id: "laudo",
    eyebrow: "Laudo formal · NBR 14.653-3",
    name: "Laudo com ART",
    price: "A partir de R$ 2.500",
    unit: "por laudo assinado",
    blurb:
      "Laudo formal assinado por engenheiro habilitado (Agrônomo ou Florestal), com ART registrada no CREA. O valor varia conforme a complexidade e a área.",
    features: [
      "Assinado por engenheiro com CREA + ART",
      "Fundamentação NBR 14.653-3 (Grau I a III)",
      "Enriquecimento com fontes oficiais",
      "Entregue em horas, não em semanas",
    ],
    cta: { label: "Solicitar laudo", href: "#/avaliar", variant: "vt-btn-primary" },
    featured: true,
  },
  {
    id: "assinatura",
    eyebrow: "Volume recorrente",
    name: "Assinatura B2B",
    price: "Sob proposta",
    priceNote: "Desconto progressivo por volume",
    blurb:
      "Para bancos, escritórios de avaliação e cooperativas que emitem laudos com frequência.",
    features: [
      "Desconto progressivo por volume",
      "Fluxo de trabalho em equipe",
      "Histórico e padronização de laudos",
      "Suporte dedicado",
    ],
    cta: { label: "Fale conosco", href: "#contato", variant: "vt-btn-ghost" },
  },
  {
    id: "api",
    eyebrow: "Integração técnica",
    name: "API",
    price: "Sob demanda",
    priceNote: "Crédito rural e ERPs agro",
    blurb:
      "Integre a avaliação aos seus sistemas de crédito rural e plataformas de gestão agro.",
    features: [
      "Endpoints de estimativa e laudo",
      "Integração com crédito rural",
      "Conexão com ERPs do agronegócio",
      "Escopo e SLA combinados",
    ],
    cta: { label: "Falar com o time", href: "#contato", variant: "vt-btn-ghost" },
  },
];

export default function Pricing() {
  const headRef = useReveal<HTMLDivElement>();
  const gridRef = useReveal<HTMLDivElement>();

  return (
    <section className={styles.section} id="precos" aria-labelledby="precos-title">
      <Grid />
      <div className="vt-container vt-container-wide">
        <div ref={headRef} className={`vt-reveal ${styles.head}`}>
          <span className="vt-eyebrow">Modelo de negócio · valores preliminares</span>
          <h2 id="precos-title" className={styles.title}>
            Preços que acompanham o uso
          </h2>
          <p className={styles.lede}>
            Comece de graça e pague apenas quando precisar de um laudo formal. Os valores
            abaixo são preliminares e podem mudar conforme a região e o tipo de imóvel.
          </p>
        </div>

        <div ref={gridRef} className={`vt-reveal ${styles.grid}`}>
          {PLANS.map((plan) => (
            <PriceCard key={plan.id} plan={plan} />
          ))}
        </div>

        <p className={styles.note}>
          <span className={styles.noteMark} aria-hidden="true">
            ◆
          </span>
          A estimativa preliminar pode ser gratuita. O pagamento ocorre apenas na emissão do
          laudo formal, sem surpresas no caminho.
        </p>
      </div>
    </section>
  );
}

function PriceCard({ plan }: { plan: Plan }) {
  const cardClass = plan.featured ? `${styles.card} ${styles.cardFeatured}` : styles.card;
  return (
    <article className={cardClass}>
      {plan.featured && (
        <span className={styles.popular}>★ Mais popular</span>
      )}
      <span className={styles.cardEyebrow}>{plan.eyebrow}</span>
      <h3 className={styles.cardName}>{plan.name}</h3>

      <div className={styles.priceBlock}>
        <span className={styles.price}>{plan.price}</span>
        {plan.unit && <span className={styles.priceUnit}>{plan.unit}</span>}
        {plan.priceNote && <span className={styles.priceNote}>{plan.priceNote}</span>}
      </div>

      <p className={styles.blurb}>{plan.blurb}</p>

      <ul className={styles.features}>
        {plan.features.map((feat) => (
          <li key={feat}>
            <span className={styles.check} aria-hidden="true">
              ✓
            </span>
            {feat}
          </li>
        ))}
      </ul>

      <a
        href={plan.cta.href}
        className={`vt-btn ${plan.cta.variant} ${styles.cardCta}`}
      >
        {plan.cta.label}
      </a>
    </article>
  );
}

function Grid() {
  return (
    <svg
      className={styles.gridArt}
      viewBox="0 0 1440 600"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <g fill="none" stroke="currentColor" strokeWidth="1">
        <path d="M0 80 H1440 M0 200 H1440 M0 320 H1440 M0 440 H1440 M0 560 H1440" />
        <path d="M120 0 V600 M360 0 V600 M600 0 V600 M840 0 V600 M1080 0 V600 M1320 0 V600" />
      </g>
    </svg>
  );
}
