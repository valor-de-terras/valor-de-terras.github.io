import { useReveal } from "../../lib/useReveal";
import styles from "./Roadmap.module.css";

type Phase = {
  id: string;
  weeks: string;
  phase: string;
  title: string;
  text: string;
};

const PHASES: Phase[] = [
  {
    id: "f0",
    weeks: "sem. 1–2",
    phase: "Fase 0",
    title: "Fundações",
    text: "ADRs, schema do banco com migrations Alembic, monorepo, Docker Compose (Postgres + PostGIS + MinIO + Redis), CI básico e autenticação com gestão da equipe técnica e papéis.",
  },
  {
    id: "f1",
    weeks: "sem. 3",
    phase: "Fase 1",
    title: "Ingestão geométrica",
    text: "Upload de KML, KMZ e SHP com validação topológica, clique no mapa e busca de CAR sobreposto, com visualização no MapLibre.",
  },
  {
    id: "f2",
    weeks: "sem. 4–6",
    phase: "Fase 2",
    title: "Pipeline de enriquecimento",
    text: "Um conector por sprint (relevo, solo, uso, clima, hidrografia e comparáveis), persistência de DataSnapshot e painel-resumo dos atributos.",
  },
  {
    id: "f3",
    weeks: "sem. 7–8",
    phase: "Fase 3",
    title: "Engine de avaliação",
    text: "Fatores de homogeneização da NBR 14.653, estimativa em faixa (mínimo, médio e máximo), exposta por API e na interface.",
  },
  {
    id: "f4",
    weeks: "sem. 9–10",
    phase: "Fase 4",
    title: "Revisão técnica",
    text: "Fila de revisão, painel do engenheiro com ajustes e narrativa, captura do número e do PDF da ART.",
  },
  {
    id: "f5",
    weeks: "sem. 11–12",
    phase: "Fase 5",
    title: "Geração do laudo",
    text: "Template WeasyPrint aderente à NBR 14.653, render final, storage e entrega do PDF, com notificações ao cliente.",
  },
  {
    id: "f6",
    weeks: "sem. 13–14",
    phase: "Fase 6",
    title: "Hardening e piloto",
    text: "Observabilidade, rate limit e testes E2E, mais um piloto com 3 a 5 imóveis reais comparados a laudos manuais.",
  },
];

export default function Roadmap() {
  const headRef = useReveal<HTMLDivElement>();
  return (
    <section className={styles.roadmap} id="roadmap" aria-labelledby="roadmap-title">
      <Grid />
      <div className={`vt-container ${styles.inner}`}>
        <div ref={headRef} className={`vt-reveal ${styles.head}`}>
          <span className="vt-eyebrow">Roteiro de produto · do MVP ao piloto</span>
          <h2 id="roadmap-title" className={styles.title}>
            14 semanas até o MVP, <span className={styles.accent}>com piloto real</span>.
          </h2>
          <p className={styles.lede}>
            Sete fases enxutas, da infraestrutura à entrega do laudo. Cada bloco fecha um
            incremento testável; a última etapa valida a estimativa contra laudos feitos à mão.
          </p>
        </div>

        <ol className={styles.timeline} aria-label="Fases do roadmap, em ordem cronológica">
          {PHASES.map((p, i) => (
            <PhaseItem key={p.id} phase={p} index={i} last={i === PHASES.length - 1} />
          ))}
        </ol>
      </div>
    </section>
  );
}

function PhaseItem({
  phase,
  index,
  last,
}: {
  phase: Phase;
  index: number;
  last: boolean;
}) {
  const ref = useReveal<HTMLLIElement>();
  return (
    <li
      ref={ref}
      className={`vt-reveal ${styles.item} ${last ? styles.itemPilot : ""}`}
      style={{ transitionDelay: `${Math.min(index * 60, 320)}ms` }}
    >
      <span className={styles.marker} aria-hidden="true">
        <span className={styles.markerNum}>{index}</span>
      </span>
      <div className={styles.body}>
        <div className={styles.metaRow}>
          <span className={styles.weeks}>{phase.weeks}</span>
          <span className={styles.phaseTag}>{phase.phase}</span>
          {last && <span className={styles.pilotTag}>piloto</span>}
        </div>
        <h3 className={styles.cardTitle}>{phase.title}</h3>
        <p className={styles.cardText}>{phase.text}</p>
      </div>
    </li>
  );
}

function Grid() {
  return (
    <svg
      className={styles.grid}
      viewBox="0 0 1440 600"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <g fill="none" stroke="currentColor" strokeWidth="1">
        <path d="M0 120 H1440 M0 240 H1440 M0 360 H1440 M0 480 H1440" />
        <path d="M240 0 V600 M480 0 V600 M720 0 V600 M960 0 V600 M1200 0 V600" />
      </g>
    </svg>
  );
}
