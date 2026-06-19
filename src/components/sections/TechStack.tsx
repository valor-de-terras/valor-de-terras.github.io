import { useReveal } from "../../lib/useReveal";
import styles from "./TechStack.module.css";

type Layer = {
  layer: string;
  tech: string;
  why: string;
};

const LAYERS: Layer[] = [
  {
    layer: "Backend / API",
    tech: "FastAPI · Python 3.12",
    why: "Async nativo e ecossistema geo maduro (geopandas, rasterio, shapely).",
  },
  {
    layer: "Banco de dados",
    tech: "PostgreSQL 16 · PostGIS 3.4",
    why: "Padrão de fato para dados geoespaciais, consultas espaciais sob índice.",
  },
  {
    layer: "ORM",
    tech: "SQLAlchemy 2.0 · GeoAlchemy2",
    why: "Suporte robusto a tipos geo, modelagem tipada de geometrias.",
  },
  {
    layer: "Tarefas assíncronas",
    tech: "ARQ (Redis)",
    why: "Asyncio nativo, leve e suficiente para o escopo do MVP.",
  },
  {
    layer: "Geoprocessamento",
    tech: "rasterio · geopandas · GDAL · PDAL · Earth Engine",
    why: "Coleta e cruzamento de relevo, solo, uso do solo e nuvens de pontos.",
  },
  {
    layer: "Storage de objetos",
    tech: "S3-compatível · MinIO (dev) · Cloudflare R2 (prod)",
    why: "R2 sem custo de egress; mesma API em desenvolvimento e produção.",
  },
  {
    layer: "Geração de PDF",
    tech: "WeasyPrint (HTML/CSS para PDF)",
    why: "Iteração rápida no laudo a partir de templates versionados.",
  },
  {
    layer: "Frontend",
    tech: "React · Vite · TypeScript · MapLibre GL JS",
    why: "Sem vendor lock e sem custo por map view exibido.",
  },
  {
    layer: "CI/CD e infraestrutura",
    tech: "GitHub Actions · Docker Compose (dev) · Fly.io / Railway (prod)",
    why: "Pipelines reprodutíveis; mesma imagem da máquina local ao deploy.",
  },
  {
    layer: "Observabilidade",
    tech: "Sentry · structlog · Grafana Cloud",
    why: "Erros rastreáveis, logs estruturados e métricas em um só painel.",
  },
];

type Stage = {
  code: string;
  label: string;
};

const FLOW: Stage[] = [
  { code: "fe", label: "Frontend" },
  { code: "api", label: "API" },
  { code: "worker", label: "Worker fan-out" },
  { code: "est", label: "Estimativa" },
  { code: "rev", label: "Revisão técnica" },
  { code: "laudo", label: "Laudo + ART" },
];

const STATES: string[] = [
  "DRAFT",
  "enriquecimento",
  "estimativa",
  "revisão técnica",
  "ART",
  "laudo",
];

export default function TechStack() {
  const headRef = useReveal<HTMLDivElement>();
  const tableRef = useReveal<HTMLDivElement>();
  const flowRef = useReveal<HTMLDivElement>();

  return (
    <section className={styles.section} id="tecnologia" aria-labelledby="tech-title">
      <div className="vt-container vt-container-wide">
        <div ref={headRef} className={`vt-reveal ${styles.head}`}>
          <span className="vt-eyebrow">Arquitetura e tecnologia</span>
          <h2 id="tech-title" className={styles.title}>
            Construído para escala e auditoria
          </h2>
          <p className={styles.lede}>
            Cada camada foi escolhida para um pipeline geoespacial sério, com fontes
            rastreáveis e trilha de auditoria de ponta a ponta. Tecnologia aberta,
            reprodutível e sem amarras de fornecedor, do navegador ao laudo assinado.
          </p>
        </div>

        <div className={styles.grid}>
          <div ref={tableRef} className={`vt-reveal ${styles.tableCol}`}>
            <div className={styles.tableWrap} role="region" aria-label="Stack tecnológica por camada">
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Camada</th>
                    <th scope="col">Tecnologia</th>
                    <th scope="col" className={styles.whyHead}>
                      Por quê
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {LAYERS.map((row) => (
                    <tr key={row.layer}>
                      <th scope="row" className={styles.layerCell}>
                        {row.layer}
                      </th>
                      <td className={styles.techCell}>{row.tech}</td>
                      <td className={styles.whyCell}>{row.why}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <aside className={styles.side} aria-label="Garantias de auditoria">
            <article className={styles.concept}>
              <span className={styles.conceptTag}>DataSnapshot</span>
              <h3 className={styles.conceptTitle}>Auditoria das fontes</h3>
              <p className={styles.conceptText}>
                Cada estimativa congela um retrato das fontes usadas, com versão e data de
                coleta. Quem ler o laudo amanhã enxerga exatamente os dados de hoje.
              </p>
            </article>
            <article className={styles.concept}>
              <span className={styles.conceptTag}>AuditLog</span>
              <h3 className={styles.conceptTitle}>Trilha completa</h3>
              <p className={styles.conceptText}>
                Toda mudança de estado do pedido e toda edição manual ficam registradas,
                com autor e carimbo de tempo. Nada acontece fora do registro.
              </p>
            </article>
          </aside>
        </div>

        <div ref={flowRef} className={`vt-reveal ${styles.flowBlock}`}>
          <div className={styles.flowHeader}>
            <span className={styles.flowLabel}>Fluxo de dados</span>
            <span className={styles.flowNote}>do navegador ao laudo</span>
          </div>

          <ol className={styles.flow} aria-label="Fluxo de dados do pedido">
            {FLOW.map((stage, i) => (
              <li key={stage.code} className={styles.flowStep}>
                <span className={styles.flowNode}>
                  <span className={styles.flowCode}>{stage.code}</span>
                  <span className={styles.flowName}>{stage.label}</span>
                </span>
                {i < FLOW.length - 1 && (
                  <span className={styles.flowArrow} aria-hidden="true">
                    ›
                  </span>
                )}
              </li>
            ))}
          </ol>

          <div className={styles.machine}>
            <span className={styles.machineLabel}>Máquina de estados do pedido</span>
            <ol className={styles.states} aria-label="Estados do pedido">
              {STATES.map((state, i) => (
                <li key={state} className={styles.state}>
                  <span className={styles.stateNum}>{String(i + 1).padStart(2, "0")}</span>
                  <span className={styles.stateName}>{state}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}
