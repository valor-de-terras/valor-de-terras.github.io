import { useEffect, useMemo, useRef, useState } from "react";
import MapView from "../components/demo/MapView";
import {
  assignReview, generateReport, getBundle, reportLink, saveReview, submitArt,
  uploadArtPdf, submitSignedReport, geometryToFeature, type RequestBundle,
} from "../lib/portal";
import { fmtArea, fmtBRL, fmtNum } from "../lib/format";
import { statusView, PURPOSE_LABELS } from "./status";
import styles from "./portal.module.css";

interface Props {
  requestId: string;
  currentUserId: string;
  onBack: () => void;
}

function layerRows(b: RequestBundle) {
  return b.enrichment
    .filter((l) => l.key !== "comp")
    .map((l) => ({
      key: l.key,
      label: String(l.payload?.label ?? l.key),
      result: String(l.payload?.result ?? ""),
      factor: Number(l.payload?.factor ?? 1),
      source: l.source ?? "",
    }));
}

export default function RequestDetail({ requestId, currentUserId, onBack }: Props) {
  const [b, setB] = useState<RequestBundle | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  // form da revisão
  const [grade, setGrade] = useState("II");
  const [ppha, setPpha] = useState<string>("");
  const [total, setTotal] = useState<string>("");
  const [totalTouched, setTotalTouched] = useState(false);
  const [narrative, setNarrative] = useState("");
  const [artNumber, setArtNumber] = useState("");
  const artFileRef = useRef<HTMLInputElement | null>(null);
  const signedFileRef = useRef<HTMLInputElement | null>(null);

  const area = b?.property.area_ha ?? 0;

  const load = async () => {
    setErr(null);
    try {
      const data = await getBundle(requestId);
      setB(data);
      const rep = (data.report ?? {}) as Record<string, unknown>;
      const est = (data.estimate ?? {}) as Record<string, unknown>;
      setGrade(String(rep.grade ?? "II"));
      const p = Number(rep.final_price_per_ha ?? est.price_per_ha_avg ?? 0);
      const t = Number(rep.final_total ?? est.total_avg ?? p * (data.property.area_ha ?? 0));
      setPpha(p ? String(p) : "");
      setTotal(t ? String(Math.round(t)) : "");
      setTotalTouched(rep.final_total != null);
      setNarrative(String(rep.narrative ?? ""));
      setArtNumber(String(rep.art_number ?? ""));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Falha ao carregar o pedido.");
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId]);

  // total acompanha R$/ha x área, a menos que o engenheiro edite o total manualmente
  useEffect(() => {
    if (!totalTouched) {
      const p = Number(ppha);
      if (p > 0 && area > 0) setTotal(String(Math.round(p * area)));
    }
  }, [ppha, area, totalTouched]);

  const parcel = useMemo(() => (b ? geometryToFeature(b.property.geometry) : null), [b]);

  if (err && !b) return (
    <div>
      <button className={styles.back} onClick={onBack}>← Voltar à fila</button>
      <div className={styles.errMsg}>{err}</div>
    </div>
  );
  if (!b) return <div className={styles.subtle}>Carregando pedido…</div>;

  const status = b.request.status;
  const mine = b.request.technician_id === currentUserId;
  const sv = statusView(status);
  const est = (b.estimate ?? {}) as Record<string, unknown>;
  const rep = (b.report ?? {}) as Record<string, unknown>;
  const layers = layerRows(b);

  const run = async (fn: () => Promise<void>, okMsg?: string) => {
    setBusy(true); setErr(null); setMsg(null);
    try { await fn(); if (okMsg) setMsg(okMsg); }
    catch (e) { setErr(e instanceof Error ? e.message : "Falha na operação."); }
    finally { setBusy(false); }
  };

  const onAssign = () => run(async () => { await assignReview(requestId); await load(); }, "Revisão assumida. Você é o responsável técnico deste pedido.");

  // par R$/ha x total sempre consistente (total = R$/ha x área), evitando laudo com valores que não fecham
  const consistentFinals = () => {
    const p = Number(ppha) || 0;
    const t = Number(total) || 0;
    if (totalTouched && t > 0 && area > 0) return { finalPricePerHa: t / area, finalTotal: t };
    if (p > 0 && area > 0) return { finalPricePerHa: p, finalTotal: p * area };
    return { finalPricePerHa: p || undefined, finalTotal: t || undefined };
  };

  const onSaveDraft = () => run(async () => {
    await saveReview(requestId, { narrative, grade, ...consistentFinals() });
  }, "Rascunho salvo.");

  const onEmit = () => run(async () => {
    if (!artNumber.trim()) throw new Error("Informe o número da ART para emitir o laudo.");
    let artPdfPath: string | undefined;
    const file = artFileRef.current?.files?.[0];
    if (file) {
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
      if (!isPdf) throw new Error("O arquivo da ART precisa ser um PDF.");
      if (file.size > 10 * 1024 * 1024) throw new Error("PDF da ART muito grande (máx. 10 MB).");
      artPdfPath = await uploadArtPdf(requestId, file);
    }
    await submitArt(requestId, { artNumber: artNumber.trim(), artPdfPath, narrative, grade, ...consistentFinals() });
    // reflete REPORT_GENERATING antes de gerar o PDF: se a geração falhar, a UI mostra "Gerar PDF"
    await load();
    const { url } = await generateReport(requestId);
    setDownloadUrl(url);
    await load();
  }, "Laudo emitido e PDF gerado.");

  const onGenerate = () => run(async () => {
    const { url } = await generateReport(requestId);
    setDownloadUrl(url);
    await load();
  }, "PDF do laudo gerado.");

  const onDownload = () => run(async () => {
    const url = await reportLink(requestId);
    setDownloadUrl(url);
    window.open(url, "_blank", "noopener");
  });

  const onSubmitSigned = () => run(async () => {
    const file = signedFileRef.current?.files?.[0];
    if (!file) throw new Error("Selecione o PDF do laudo assinado.");
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    if (!isPdf) throw new Error("O arquivo precisa ser um PDF.");
    if (file.size > 25 * 1024 * 1024) throw new Error("PDF muito grande (máx. 25 MB).");
    await submitSignedReport(requestId, file);
    if (signedFileRef.current) signedFileRef.current.value = "";
    await load();
  }, "Laudo assinado registrado com sucesso.");

  return (
    <div>
      <button className={styles.back} onClick={onBack}>← Voltar à fila</button>
      <div className={styles.detailHead}>
        <h1 className={styles.h1}>{b.property.municipality ?? "Imóvel"}{b.property.uf ? `/${b.property.uf}` : ""}</h1>
        <span className={`${styles.badge} ${sv.cls}`}>{sv.label}</span>
        <span className={styles.subtle}>#{requestId.slice(0, 8).toUpperCase()}</span>
      </div>

      <div className={styles.detailGrid}>
        {/* Coluna esquerda: imóvel + dados */}
        <div>
          <div className={styles.mapBox}><MapView parcel={parcel} /></div>

          <div className={styles.card2}>
            <div className={styles.sectionTitle}>Imóvel</div>
            <div className={styles.kv}>
              <div className={styles.kvRow}><span>Área medida</span><strong>{fmtArea(area)}</strong></div>
              <div className={styles.kvRow}><span>Perímetro</span><strong>{fmtNum(b.property.perimeter_km)} km</strong></div>
              <div className={styles.kvRow}><span>Município/UF</span><strong>{b.property.municipality ?? "—"}{b.property.uf ? `/${b.property.uf}` : ""}</strong></div>
              <div className={styles.kvRow}><span>CAR</span><strong className={styles.mono}>{b.property.car_code ?? "—"}</strong></div>
              <div className={styles.kvRow}><span>Finalidade</span><strong>{PURPOSE_LABELS[b.request.purpose] ?? b.request.purpose}</strong></div>
            </div>
          </div>

          <div className={styles.card2}>
            <div className={styles.sectionTitle}>Solicitante</div>
            <div className={styles.kv}>
              <div className={styles.kvRow}><span>Nome</span><strong>{String(b.request.contact_name ?? "—")}</strong></div>
              <div className={styles.kvRow}><span>E-mail</span><strong>{String(b.request.contact_email ?? "—")}</strong></div>
              <div className={styles.kvRow}><span>Telefone</span><strong>{String(b.request.contact_phone ?? "—")}</strong></div>
            </div>
          </div>

          <div className={styles.card2}>
            <div className={styles.sectionTitle}>Enriquecimento (dados abertos)</div>
            <table className={styles.miniTable}>
              <tbody>
                {layers.map((l) => (
                  <tr key={l.key}>
                    <th>{l.label}</th>
                    <td>{l.result || "—"}</td>
                    <td className={styles.num}>{l.factor.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={styles.card2}>
            <div className={styles.sectionTitle}>Comparáveis</div>
            <table className={styles.miniTable}>
              <thead>
                <tr><th>Uso</th><th className={styles.num}>Dist.</th><th className={styles.num}>R$/ha</th><th className={styles.num}>Homog.</th></tr>
              </thead>
              <tbody>
                {b.comparables.map((c, i) => (
                  <tr key={i}>
                    <td>{String(c.land_use ?? "—")}</td>
                    <td className={styles.num}>{fmtNum(Number(c.distance_km))} km</td>
                    <td className={styles.num}>{fmtBRL(Number(c.price_per_ha))}</td>
                    <td className={styles.num}>{fmtBRL(Number(c.homogenized_price_per_ha))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Coluna direita: revisão técnica */}
        <div>
          <div className={styles.card2}>
            <div className={styles.sectionTitle}>Estimativa preliminar (Grau I)</div>
            <div className={styles.kv}>
              <div className={styles.kvRow}><span>R$/ha (médio)</span><strong>{fmtBRL(Number(est.price_per_ha_avg ?? 0))}</strong></div>
              <div className={styles.kvRow}><span>Total (médio)</span><strong>{fmtBRL(Number(est.total_avg ?? 0))}</strong></div>
              <div className={styles.kvRow}><span>Modelo</span><strong className={styles.mono}>{String(est.model_version ?? "—")}</strong></div>
            </div>
          </div>

          {status === "TECHNICAL_REVIEW_QUEUED" && (
            <div className={styles.card2}>
              <div className={styles.sectionTitle}>Ação</div>
              <p className={styles.hint}>Assuma a revisão para se tornar o responsável técnico deste laudo. A ART só poderá ser emitida por quem assumir.</p>
              <div className={styles.actions}>
                <button className="vt-btn vt-btn-primary" onClick={onAssign} disabled={busy}>
                  {busy ? "Processando…" : "Assumir revisão"}
                </button>
              </div>
            </div>
          )}

          {(status === "TECHNICAL_REVIEW_IN_PROGRESS" || status === "REPORT_GENERATING") && (
            mine ? (
              status === "TECHNICAL_REVIEW_IN_PROGRESS" ? (
                <div className={styles.card2}>
                  <div className={styles.sectionTitle}>Revisão técnica e emissão</div>

                  <div className={styles.row2}>
                    <div className={styles.field}>
                      <label className={styles.label}>Grau de fundamentação</label>
                      <select className={styles.select} value={grade} onChange={(e) => setGrade(e.target.value)}>
                        <option value="I">Grau I</option>
                        <option value="II">Grau II</option>
                        <option value="III">Grau III</option>
                      </select>
                    </div>
                    <div className={styles.field}>
                      <label className={styles.label}>Valor R$/ha (concluído)</label>
                      <input className={styles.input} type="number" min="0" step="100" value={ppha} onChange={(e) => setPpha(e.target.value)} />
                    </div>
                  </div>

                  <div className={styles.field}>
                    <label className={styles.label}>Valor total (R$) {totalTouched
                      ? <span className={styles.subtle}>· R$/ha efetivo {area > 0 && Number(total) > 0 ? fmtBRL(Number(total) / area) : "—"}</span>
                      : <span className={styles.subtle}>· auto = R$/ha × {fmtArea(area)}</span>}</label>
                    <input className={styles.input} type="number" min="0" step="1000" value={total}
                      onChange={(e) => { setTotal(e.target.value); setTotalTouched(true); }} />
                  </div>

                  <div className={styles.field}>
                    <label className={styles.label}>Parecer / narrativa</label>
                    <textarea className={styles.textarea} value={narrative} onChange={(e) => setNarrative(e.target.value)}
                      placeholder="Observações da vistoria, ajustes de homogeneização, ressalvas…" />
                  </div>

                  <div className={styles.actions}>
                    <button className="vt-btn vt-btn-ghost" onClick={onSaveDraft} disabled={busy}>Salvar rascunho</button>
                  </div>

                  <div style={{ borderTop: "1px solid var(--vt-line)", margin: "1rem 0 0.9rem" }} />

                  <div className={styles.field}>
                    <label className={styles.label}>Número da ART (obrigatório)</label>
                    <input className={styles.input} value={artNumber} onChange={(e) => setArtNumber(e.target.value)} placeholder="Ex.: PR20260701..." />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>PDF da ART (opcional)</label>
                    <input ref={artFileRef} className={styles.input} type="file" accept="application/pdf" />
                  </div>

                  <div className={styles.actions}>
                    <button className="vt-btn vt-btn-primary" onClick={onEmit} disabled={busy}>
                      {busy ? "Emitindo…" : "Emitir laudo com ART"}
                    </button>
                  </div>
                  <p className={styles.hint}>
                    Ao emitir, a ART fica vinculada a você (CREA ativo) e o PDF do laudo NBR 14.653-3 é
                    gerado no servidor. Só o engenheiro que assumiu a revisão pode emitir.
                  </p>
                </div>
              ) : (
                <div className={styles.card2}>
                  <div className={styles.sectionTitle}>Geração do laudo</div>
                  <p className={styles.hint}>
                    ART registrada. Gere (ou regenere) o PDF do laudo NBR 14.653-3. Ao concluir, o
                    pedido é entregue ao solicitante.
                  </p>
                  <div className={styles.actions}>
                    <button className="vt-btn vt-btn-primary" onClick={onGenerate} disabled={busy}>
                      {busy ? "Gerando…" : "Gerar PDF do laudo"}
                    </button>
                  </div>
                </div>
              )
            ) : (
              <div className={styles.card2}>
                <div className={styles.sectionTitle}>Revisão em andamento</div>
                <p className={styles.readonly}>
                  Este pedido está sob responsabilidade de outro engenheiro. Apenas quem assumiu a
                  revisão pode editá-lo e emitir a ART.
                </p>
              </div>
            )
          )}

          {status === "DELIVERED" && (
            <div className={styles.card2}>
              <div className={styles.sectionTitle}>Laudo entregue</div>
              <div className={styles.kv}>
                <div className={styles.kvRow}><span>Grau</span><strong>Grau {String(rep.grade ?? "—")}</strong></div>
                <div className={styles.kvRow}><span>ART</span><strong className={styles.mono}>{String(rep.art_number ?? "—")}</strong></div>
                <div className={styles.kvRow}><span>Valor concluído</span><strong>{fmtBRL(Number(rep.final_total ?? est.total_avg ?? 0))}</strong></div>
              </div>
              <div className={styles.actions}>
                <button className="vt-btn vt-btn-primary" onClick={onDownload} disabled={busy}>Baixar laudo (PDF)</button>
              </div>

              {mine && (
                <div className={styles.signBox}>
                  <div className={styles.sectionTitle}>Assinatura digital</div>
                  {rep.signature_status === "rt_signed" ? (
                    <p className={styles.hint}>
                      ✓ Laudo assinado digitalmente e registrado
                      {rep.signed_at ? ` em ${new Date(String(rep.signed_at)).toLocaleDateString("pt-BR")}` : ""}.
                    </p>
                  ) : (
                    <>
                      <p className={styles.hint}>
                        Baixe o PDF acima, assine com seu certificado ICP-Brasil ou pela plataforma
                        oficial do <a href="https://www.gov.br/pt-br/servicos/assinatura-eletronica" target="_blank" rel="noopener" style={{ textDecoration: "underline" }}>Gov.br</a> (validade
                        jurídica, exigida por instituições de crédito), e reenvie o arquivo assinado aqui.
                        A autenticidade fica verificável pelo código impresso no rodapé.
                      </p>
                      <input ref={signedFileRef} type="file" accept="application/pdf" className={styles.fileInput} />
                      <button className="vt-btn" onClick={onSubmitSigned} disabled={busy}>
                        {busy ? "Enviando…" : "Registrar laudo assinado"}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {msg && <div className={styles.okMsg}>{msg}</div>}
          {err && <div className={styles.errMsg}>{err}</div>}
          {downloadUrl && (
            <div className={styles.okMsg}>
              PDF pronto: <a href={downloadUrl} target="_blank" rel="noopener" style={{ textDecoration: "underline" }}>abrir laudo</a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
