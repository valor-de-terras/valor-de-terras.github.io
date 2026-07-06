import { useState } from "react";
import { saveFieldVisit, type FieldVisitData, type Benfeitoria } from "../lib/portal";
import styles from "./portal.module.css";

const ESTADOS = [
  { v: "", l: "—" },
  { v: "otimo", l: "Ótimo" },
  { v: "bom", l: "Bom" },
  { v: "regular", l: "Regular" },
  { v: "ruim", l: "Ruim" },
  { v: "na", l: "N/A" },
];

interface Props {
  requestId: string;
  initial: FieldVisitData | null | undefined;
  onSaved: () => Promise<void> | void;
}

export default function FieldVisit({ requestId, initial, onSaved }: Props) {
  const [visitedAt, setVisitedAt] = useState(initial?.visited_at ?? "");
  const [areaConf, setAreaConf] = useState<string>(
    initial?.area_confirmada == null ? "" : initial.area_confirmada ? "sim" : "nao"
  );
  const [areaObs, setAreaObs] = useState(initial?.area_observacao ?? "");
  const [estado, setEstado] = useState(initial?.estado_conservacao ?? "");
  const [uso, setUso] = useState(initial?.uso_observado ?? "");
  const [acesso, setAcesso] = useState(initial?.acesso_observado ?? "");
  const [hidro, setHidro] = useState(initial?.recursos_hidricos ?? "");
  const [ressalvas, setRessalvas] = useState(initial?.ressalvas ?? "");
  const [benf, setBenf] = useState<Benfeitoria[]>(initial?.benfeitorias ?? []);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const addBenf = () =>
    setBenf((b) => (b.length >= 30 ? b : [...b, { tipo: "", descricao: "", area_m2: "", estado: "" }]));
  const setBenfField = (i: number, k: keyof Benfeitoria, val: string) =>
    setBenf((b) => b.map((x, j) => (j === i ? { ...x, [k]: val } : x)));
  const removeBenf = (i: number) => setBenf((b) => b.filter((_, j) => j !== i));

  const onSave = async () => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const data: FieldVisitData = {
        visited_at: visitedAt || null,
        area_confirmada: areaConf === "" ? null : areaConf === "sim",
        area_observacao: areaObs || null,
        estado_conservacao: estado || null,
        uso_observado: uso || null,
        acesso_observado: acesso || null,
        recursos_hidricos: hidro || null,
        ressalvas: ressalvas || null,
        benfeitorias: benf.filter((x) => x.tipo.trim() || x.descricao.trim()),
      };
      await saveFieldVisit(requestId, data);
      setMsg("Vistoria salva. Entra na seção 'Vistoria in loco' do laudo ao gerar o PDF.");
      await onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Falha ao salvar a vistoria.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.visitBox}>
      <div className={styles.sectionTitle}>Vistoria in loco (presencial)</div>
      <p className={styles.subtle}>
        Registro da inspeção presencial (NBR 14.653, exigência de crédito rural). Eleva o Grau de
        fundamentação e entra no laudo. Use com o relatório fotográfico acima.
      </p>

      <div className={styles.row2}>
        <div className={styles.field}>
          <label className={styles.label}>Data da vistoria</label>
          <input className={styles.input} type="date" value={visitedAt ?? ""} onChange={(e) => setVisitedAt(e.target.value)} />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Estado de conservação</label>
          <select className={styles.select} value={estado ?? ""} onChange={(e) => setEstado(e.target.value)}>
            {ESTADOS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
        </div>
      </div>

      <div className={styles.row2}>
        <div className={styles.field}>
          <label className={styles.label}>Área confere com a geometria?</label>
          <select className={styles.select} value={areaConf} onChange={(e) => setAreaConf(e.target.value)}>
            <option value="">—</option>
            <option value="sim">Sim</option>
            <option value="nao">Não</option>
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Observação de área</label>
          <input className={styles.input} value={areaObs ?? ""} onChange={(e) => setAreaObs(e.target.value)} maxLength={500} placeholder="ex.: confere com o CAR" />
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Uso observado</label>
        <input className={styles.input} value={uso ?? ""} onChange={(e) => setUso(e.target.value)} maxLength={500} placeholder="ex.: lavoura de soja em plantio direto" />
      </div>
      <div className={styles.field}>
        <label className={styles.label}>Acesso observado</label>
        <input className={styles.input} value={acesso ?? ""} onChange={(e) => setAcesso(e.target.value)} maxLength={500} placeholder="ex.: estrada municipal cascalhada" />
      </div>
      <div className={styles.field}>
        <label className={styles.label}>Recursos hídricos</label>
        <input className={styles.input} value={hidro ?? ""} onChange={(e) => setHidro(e.target.value)} maxLength={500} placeholder="ex.: córrego perene na divisa sul" />
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Benfeitorias ({benf.length}/30)</label>
        {benf.map((b, i) => (
          <div key={i} className={styles.benfRow}>
            <input className={styles.input} value={b.tipo} onChange={(e) => setBenfField(i, "tipo", e.target.value)} placeholder="Tipo (sede, galpão…)" maxLength={60} />
            <input className={styles.input} value={b.descricao} onChange={(e) => setBenfField(i, "descricao", e.target.value)} placeholder="Descrição" maxLength={200} />
            <input className={styles.input} value={b.area_m2} onChange={(e) => setBenfField(i, "area_m2", e.target.value)} placeholder="m²" inputMode="numeric" style={{ maxWidth: "5rem" }} />
            <select className={styles.select} value={b.estado} onChange={(e) => setBenfField(i, "estado", e.target.value)} style={{ maxWidth: "6rem" }}>
              {ESTADOS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
            <button className={styles.photoDel} onClick={() => removeBenf(i)} title="Remover" type="button">✕</button>
          </div>
        ))}
        {benf.length < 30 && (
          <button className="vt-btn vt-btn-ghost" onClick={addBenf} type="button" style={{ marginTop: "0.4rem" }}>+ Benfeitoria</button>
        )}
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Ressalvas da vistoria</label>
        <textarea className={styles.textarea} value={ressalvas ?? ""} onChange={(e) => setRessalvas(e.target.value)} maxLength={1000} placeholder="Ressalvas, pendências, itens não considerados…" />
      </div>

      <div className={styles.actions}>
        <button className="vt-btn" onClick={onSave} disabled={busy}>{busy ? "Salvando…" : "Salvar vistoria"}</button>
      </div>
      {msg && <div className={styles.okMsg}>{msg}</div>}
      {err && <div className={styles.errMsg}>{err}</div>}
    </div>
  );
}
