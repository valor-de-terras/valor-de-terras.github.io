import { useEffect } from "react";
import type { Comparable, EnrichmentLayer, EstimateResult } from "../../types";
import { fmtArea, fmtCoord, fmtNum } from "../../lib/format";
import styles from "./ReportPreview.module.css";

interface Meta {
  name: string;
  municipality: string;
  uf: string;
  carCode: string;
}

interface Props {
  onClose: () => void;
  meta: Meta;
  area: number;
  centroid: [number, number];
  estimate: EstimateResult;
  comparables: Comparable[];
  layers: EnrichmentLayer[];
}

export default function ReportPreview({
  onClose,
  meta,
  area,
  centroid,
  estimate,
  comparables,
  layers,
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div className={styles.backdrop} onClick={onClose} role="dialog" aria-modal="true">
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <header className={styles.toolbar}>
          <span className={styles.toolbarTitle}>Prévia do laudo · NBR 14.653</span>
          <div className={styles.toolbarActions}>
            <button className="vt-btn vt-btn-accent" onClick={() => window.print()}>
              Imprimir / PDF
            </button>
            <button className={styles.close} onClick={onClose} aria-label="Fechar">
              ✕
            </button>
          </div>
        </header>

        <div className={styles.scroll}>
          <article className={styles.doc}>
            <div className={styles.watermark}>PRÉVIA DO LAUDO</div>

            {/* Capa */}
            <div className={styles.cover}>
              <div className={styles.coverBrand}>VALOR DE TERRAS</div>
              <h1 className={styles.coverTitle}>
                Laudo de Avaliação de Imóvel Rural
              </h1>
              <p className={styles.coverSub}>
                Conforme ABNT NBR 14.653-1 / 14.653-3 · Método comparativo direto de dados de
                mercado
              </p>
              <dl className={styles.coverMeta}>
                <div>
                  <dt>Imóvel</dt>
                  <dd>{meta.name}</dd>
                </div>
                <div>
                  <dt>Município/UF</dt>
                  <dd>
                    {meta.municipality}
                    {meta.uf !== "—" ? `/${meta.uf}` : ""}
                  </dd>
                </div>
                <div>
                  <dt>CAR</dt>
                  <dd className={styles.mono}>{meta.carCode}</dd>
                </div>
                <div>
                  <dt>Grau de fundamentação</dt>
                  <dd>Grau {estimate.grau} (preliminar)</dd>
                </div>
              </dl>
            </div>

            <Section n="1" title="Objeto e finalidade">
              <p>
                O presente trabalho tem por objeto a determinação do valor de mercado do imóvel
                rural denominado <strong>{meta.name}</strong>, situado em {meta.municipality}
                {meta.uf !== "—" ? `/${meta.uf}` : ""}, com área de {fmtArea(area)}. A finalidade
                declarada é a estimativa preliminar de valor para subsídio à decisão, sem prejuízo
                da emissão de laudo formal com Anotação de Responsabilidade Técnica (ART).
              </p>
            </Section>

            <Section n="2" title="Pressupostos, ressalvas e fontes de dados">
              <p>
                A avaliação apoia-se em dados públicos abertos, congelados na data-base
                (DataSnapshot) para garantir rastreabilidade e defensabilidade futura:
              </p>
              <ul className={styles.sources}>
                {layers.map((l) => (
                  <li key={l.key}>
                    <span className={styles.sourceName}>{l.label}</span>
                    <span className={styles.sourceOrg}>{l.source}</span>
                  </li>
                ))}
              </ul>
            </Section>

            <Section n="3" title="Caracterização e diagnóstico do imóvel">
              <table className={styles.kv}>
                <tbody>
                  <tr>
                    <th>Área (medida sobre a geometria)</th>
                    <td>{fmtArea(area)}</td>
                  </tr>
                  <tr>
                    <th>Centroide (lon, lat)</th>
                    <td className={styles.mono}>
                      {fmtCoord(centroid[0])}, {fmtCoord(centroid[1])}
                    </td>
                  </tr>
                  {layers
                    .filter((l) => l.key !== "comp")
                    .map((l) => (
                      <tr key={l.key}>
                        <th>{l.label}</th>
                        <td>{l.result}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </Section>

            <Section n="4" title="Metodologia e homogeneização">
              <p>
                Adotou-se o <strong>método comparativo direto de dados de mercado</strong>
                (NBR 14.653-2/3, item 8). Os elementos comparativos foram homogeneizados por
                fatores relativos a relevo, solo/aptidão, uso, acesso e situação, conforme tabela:
              </p>
              <table className={styles.factors}>
                <thead>
                  <tr>
                    <th>Atributo</th>
                    <th>Diagnóstico</th>
                    <th className={styles.num}>Fator</th>
                  </tr>
                </thead>
                <tbody>
                  {layers
                    .filter((l) => l.factor !== 1.0)
                    .map((l) => (
                      <tr key={l.key}>
                        <td>{l.label}</td>
                        <td>{l.result}</td>
                        <td className={styles.num}>{l.factor.toFixed(2)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </Section>

            <Section n="5" title="Tratamento dos elementos comparativos">
              <table className={styles.factors}>
                <thead>
                  <tr>
                    <th>#</th>
                    <th className={styles.num}>Dist.</th>
                    <th className={styles.num}>Área</th>
                    <th>Uso</th>
                    <th className={styles.num}>R$/ha</th>
                    <th className={styles.num}>Homog.</th>
                  </tr>
                </thead>
                <tbody>
                  {comparables.map((c, i) => (
                    <tr key={c.id}>
                      <td>{i + 1}</td>
                      <td className={styles.num}>{c.distanceKm} km</td>
                      <td className={styles.num}>{fmtNum(c.areaHa)} ha</td>
                      <td>{c.use}</td>
                      <td className={styles.num}>•••</td>
                      <td className={styles.num}>•••</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>

            <Section n="6" title="Conclusão — valor de mercado">
              <div className={styles.conclusionLocked}>
                <span className={styles.lockGlyph} aria-hidden>🔒</span>
                <div>
                  <strong>Valor de mercado disponível no laudo formal.</strong>
                  <p>
                    O valor unitário (R$/ha), o valor total estimado e o campo de arbítrio são
                    apresentados no laudo assinado por Engenheiro Agrônomo ou Florestal, com ART.
                    Esta prévia demonstra a metodologia e a rastreabilidade dos dados; o resultado
                    monetário integra o documento formal.
                  </p>
                </div>
              </div>
            </Section>

            <Section n="7" title="Responsabilidade técnica">
              <p className={styles.warn}>
                <strong>Estimativa preliminar (Grau I).</strong> Esta prévia é automatizada,
                a partir de geometria e dados abertos reais, e corresponde no máximo ao Grau I de
                fundamentação da NBR 14.653-3. <strong>Não</strong> constitui laudo de avaliação.
                A avaliação de imóveis rurais é atribuição privativa de Engenheiro Agrônomo ou
                Engenheiro Florestal com registro ativo no CREA, mediante Anotação de
                Responsabilidade Técnica (ART). Os Graus II e III, de maior fundamentação,
                dependem da revisão e da qualificação do responsável técnico.
              </p>
            </Section>
          </article>
        </div>
      </div>
    </div>
  );
}

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>
        <span className={styles.sectionNum}>{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}
