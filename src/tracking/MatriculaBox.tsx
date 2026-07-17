import { useState } from "react";
import { uploadAndAnalyzeMatricula, type MatriculaResult } from "../lib/matricula";
import styles from "./tracking.module.css";

export default function MatriculaBox({ requestId }: { requestId: string }) {
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<MatriculaResult | null>(null);

  // Alinhado ao limite de OCR da Edge Function (MAX_OCR_BYTES em _shared/gemini.ts):
  // aceitar acima disso só empurraria o usuário para um 422 depois do upload.
  const MAX_MB = 14;

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // reseta o input já aqui: re-selecionar o MESMO arquivo após uma falha
    // precisa disparar onChange de novo (senão o retry fica morto)
    e.target.value = "";
    if (!file) return;
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    if (!isPdf) {
      setErr("Envie a matrícula em PDF.");
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      setErr(`Arquivo muito grande (máx. ${MAX_MB} MB).`);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      setResult(await uploadAndAnalyzeMatricula(requestId, file, consent));
    } catch (err2) {
      setErr(err2 instanceof Error ? err2.message : "Falha ao analisar a matrícula.");
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    const L = result.leitura;
    const fatos: string[] = [];
    if (L) {
      if (L.area_registrada_ha !== null) fatos.push(`Área registrada: ${L.area_registrada_ha} ha`);
      if (L.denominacao) fatos.push(`Denominação: ${L.denominacao}`);
      if (L.confrontantes_n !== null) fatos.push(`Confrontantes citados: ${L.confrontantes_n}`);
      if (L.transmissoes_n !== null) fatos.push(`Transmissões: ${L.transmissoes_n}`);
      if (L.reserva_legal_averbada !== null) {
        fatos.push(
          `Reserva legal averbada: ${L.reserva_legal_averbada ? "sim" : "não"}` +
            (L.reserva_legal_detalhe ? ` (${L.reserva_legal_detalhe})` : "")
        );
      }
      if (L.georreferenciada !== null) fatos.push(`Georreferenciada (INCRA): ${L.georreferenciada ? "sim" : "não"}`);
    }
    return (
      <div className={styles.matricula}>
        <strong className={styles.mHead}>
          {result.n_passivos === 0
            ? "Nenhum ônus aparente detectado na matrícula."
            : `${result.n_passivos} apontamento(s); ${result.n_ativos} possivelmente ativo(s).`}
        </strong>
        {result.passivos.length > 0 && (
          <ul className={styles.mList}>
            {result.passivos.map((p, i) => (
              <li key={i} className={p.status === "ativo" ? styles.mAtivo : styles.mCancel}>
                {p.tipo} - {p.status}
              </li>
            ))}
          </ul>
        )}
        {fatos.length > 0 && (
          <ul className={styles.mList}>
            {fatos.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        )}
        <span className={styles.mNote}>
          {L
            ? `Leitura automática${result.ocr ? " (OCR)" : ""} conferida por regras. ` +
              (L.confianca === "baixa"
                ? "Confiança baixa: o documento ficou pouco legível, confira a matrícula original. "
                : L.confianca === "media"
                ? "Confiança média: vale conferir a matrícula original. "
                : "")
            : "Triagem automática por regras. "}
          Não substitui a análise jurídica; o responsável técnico confere a matrícula.
        </span>
      </div>
    );
  }

  return (
    <div className={styles.matricula}>
      <label className={styles.mConsent}>
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        Autorizo o processamento da matrícula (PDF) para análise de ônus, conforme a LGPD,
        incluindo o envio do documento ao Google (Gemini API) para leitura automática. Estou
        ciente de que, no plano gratuito dessa API, o documento pode ser lido por revisores
        humanos do provedor e usado para treinar modelos de IA, e de que a matrícula contém
        dados pessoais (nome, CPF e endereço).
      </label>
      <label className={consent && !busy ? styles.mUpload : `${styles.mUpload} ${styles.mDisabled}`}>
        {busy ? "Analisando matrícula…" : "Anexar matrícula (PDF) para checar ônus"}
        <input
          type="file"
          accept="application/pdf"
          disabled={!consent || busy}
          style={{ display: "none" }}
          onChange={(e) => void onFile(e)}
        />
      </label>
      <span className={styles.mNote}>
        Aceita o PDF pesquisável do cartório e também a digitalização: nesse caso o texto é
        lido por OCR. Para a leitura sair boa, escaneie em 300 dpi ou mais, com o documento
        reto e nítido.
      </span>
      {err && <p className={styles.err}>{err}</p>}
    </div>
  );
}
