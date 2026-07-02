import { useReveal } from "../../lib/useReveal";
import styles from "./HowItWorks.module.css";

type Modo = {
  n: string;
  titulo: string;
  desc: string;
  glifo: JSX.Element;
};

const modos: Modo[] = [
  {
    n: "01",
    titulo: "Suba a geometria",
    desc: "Importe a área a avaliar em arquivo geográfico: KML, KMZ ou SHP. O perímetro é lido e validado na hora.",
    glifo: <GlifoUpload />,
  },
  {
    n: "02",
    titulo: "Marque um ponto",
    desc: "Clique no mapa e o sistema identifica automaticamente o CAR, ou os CARs, sobrepostos àquele ponto.",
    glifo: <GlifoPino />,
  },
  {
    n: "03",
    titulo: "Selecione um CAR",
    desc: "Escolha um Cadastro Ambiental Rural diretamente no mapa e aproveite o perímetro já cadastrado.",
    glifo: <GlifoCar />,
  },
];

type Passo = {
  n: number;
  rotulo: string;
  titulo: string;
  desc: string;
  via: "auto" | "art";
};

const passos: Passo[] = [
  {
    n: 1,
    rotulo: "Entrada",
    titulo: "Geometria",
    desc: "A área entra por arquivo, ponto no mapa ou CAR selecionado. O imóvel ganha um perímetro georreferenciado.",
    via: "auto",
  },
  {
    n: 2,
    rotulo: "Pipeline",
    titulo: "Enriquecimento",
    desc: "Cruzamento com dados abertos: relevo, solo, uso e cobertura, hidrografia e transações comparáveis.",
    via: "auto",
  },
  {
    n: 3,
    rotulo: "Resultado",
    titulo: "Estimativa em minutos",
    desc: "Homogeneização pela NBR 14.653 e uma estimativa preliminar de valor entregue de forma síncrona.",
    via: "auto",
  },
  {
    n: 4,
    rotulo: "Decisão",
    titulo: "Você decide",
    desc: "Pare na estimativa ou solicite o laudo formal. A partir daqui entra a responsabilidade técnica humana.",
    via: "art",
  },
  {
    n: 5,
    rotulo: "Revisão",
    titulo: "Revisão técnica + ART",
    desc: "A equipe é notificada. Um engenheiro avaliador habilitado no CREA revisa, conclui e emite a ART.",
    via: "art",
  },
  {
    n: 6,
    rotulo: "Entrega",
    titulo: "Laudo entregue",
    desc: "O laudo final, assinado, fica disponível no painel do cliente para download e consulta.",
    via: "art",
  },
];

export default function HowItWorks() {
  const head = useReveal<HTMLDivElement>();
  const modosRef = useReveal<HTMLDivElement>();
  const trilhos = useReveal<HTMLDivElement>();
  const stepper = useReveal<HTMLOListElement>();

  return (
    <section
      className={styles.section}
      id="como-funciona"
      aria-labelledby="como-funciona-title"
    >
      <Malha />
      <div className={`vt-container ${styles.inner}`}>
        <div ref={head} className={`vt-reveal ${styles.head}`}>
          <span className="vt-eyebrow">Como funciona</span>
          <h2 id="como-funciona-title" className={styles.title}>
            Da geometria ao laudo, em <span className={styles.accent}>duas vias</span>.
          </h2>
          <p className={styles.lede}>
            Você entra com a área a avaliar e o resto é pipeline. A estimativa preliminar
            chega em minutos; o laudo formal, com ART, segue por uma via separada, sob
            responsabilidade técnica humana.
          </p>
        </div>

        {/* Modos de entrada */}
        <div ref={modosRef} className={`vt-reveal ${styles.modos}`}>
          <span className={styles.modosLabel}>Três formas de entrar com a área</span>
          <div className={styles.modosGrid}>
            {modos.map((m) => (
              <article key={m.n} className={styles.modo}>
                <span className={styles.modoGlifo} aria-hidden="true">
                  {m.glifo}
                </span>
                <span className={styles.modoNum}>{m.n}</span>
                <h3 className={styles.modoTitulo}>{m.titulo}</h3>
                <p className={styles.modoDesc}>{m.desc}</p>
              </article>
            ))}
          </div>
        </div>

        {/* Duas vias contrastadas */}
        <div ref={trilhos} className={`vt-reveal ${styles.trilhos}`}>
          <article className={`${styles.trilho} ${styles.trilhoAuto}`}>
            <header className={styles.trilhoHead}>
              <span className={styles.trilhoTag}>Via A</span>
              <span className={styles.trilhoSync}>
                <span className={styles.dot} /> síncrono
              </span>
            </header>
            <h3 className={styles.trilhoTitulo}>Estimativa automatizada</h3>
            <p className={styles.trilhoDesc}>
              Produto digital, gerado pela plataforma em minutos. Sem espera, sem fila.
              Ideal para triagem, primeira leitura de valor e decisão rápida.
            </p>
            <ul className={styles.trilhoMeta}>
              <li>
                <span>Entrega</span>
                <strong>~minutos</strong>
              </li>
              <li>
                <span>Natureza</span>
                <strong>preliminar</strong>
              </li>
              <li>
                <span>Origem</span>
                <strong>algoritmo</strong>
              </li>
            </ul>
          </article>

          <span className={styles.bifurca} aria-hidden="true">
            ↘ você decide ↗
          </span>

          <article className={`${styles.trilho} ${styles.trilhoArt}`}>
            <header className={styles.trilhoHead}>
              <span className={`${styles.trilhoTag} ${styles.trilhoTagArt}`}>Via B</span>
              <span className={styles.trilhoAsync}>
                <span className={styles.dotArt} /> assíncrono
              </span>
            </header>
            <h3 className={styles.trilhoTitulo}>Laudo formal com ART</h3>
            <p className={styles.trilhoDesc}>
              Produto profissional, com responsabilidade técnica de engenheiro avaliador
              habilitado no CREA. Revisão humana, conclusão fundamentada e ART emitida.
            </p>
            <ul className={styles.trilhoMeta}>
              <li>
                <span>Entrega</span>
                <strong>sob análise</strong>
              </li>
              <li>
                <span>Natureza</span>
                <strong>laudo NBR</strong>
              </li>
              <li>
                <span>Origem</span>
                <strong>engenheiro</strong>
              </li>
            </ul>
          </article>
        </div>

        {/* Stepper numerado */}
        <ol ref={stepper} className={`vt-reveal ${styles.stepper}`}>
          {passos.map((p) => (
            <li
              key={p.n}
              className={`${styles.passo} ${
                p.via === "art" ? styles.passoArt : styles.passoAuto
              }`}
            >
              <span className={styles.passoNum} aria-hidden="true">
                {p.n}
              </span>
              <div className={styles.passoCorpo}>
                <span className={styles.passoRotulo}>{p.rotulo}</span>
                <h3 className={styles.passoTitulo}>{p.titulo}</h3>
                <p className={styles.passoDesc}>{p.desc}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className={styles.cta}>
          <a href="#/avaliar" className="vt-btn vt-btn-primary">
            Avalie sua propriedade →
          </a>
          <p className={styles.ctaNota}>
            Escopo e prazos do laudo formal são preliminares e confirmados na análise técnica
            de cada caso.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ---- Ornamento cartográfico de fundo (malha de grade + curva de nível) ---- */
function Malha() {
  return (
    <svg
      className={styles.malha}
      viewBox="0 0 1440 520"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <pattern
          id="hiw-grid"
          width="48"
          height="48"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M48 0 H0 V48"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
          />
        </pattern>
      </defs>
      <rect width="1440" height="520" fill="url(#hiw-grid)" opacity="0.5" />
      <g fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.7">
        <path d="M-40 360 C 260 280, 520 420, 820 330 S 1260 220, 1500 320" />
        <path d="M-40 430 C 280 350, 540 500, 860 400 S 1280 290, 1500 400" />
      </g>
    </svg>
  );
}

/* ---- Glifos inline, estilo cartográfico sóbrio ---- */
function GlifoUpload() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 16V5" />
      <path d="M7.5 9.5 12 5l4.5 4.5" />
      <path d="M4 17.5v1A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-1" />
    </svg>
  );
}

function GlifoPino() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 21s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10Z" />
      <circle cx="12" cy="11" r="2.2" />
    </svg>
  );
}

function GlifoCar() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8.5 9 6l6 2.5L20 6v9.5L15 18l-6-2.5L4 18Z" />
      <path d="M9 6v9.5M15 8.5V18" />
    </svg>
  );
}
