import { useState } from "react";
import { uploadAndAnalyzeMatricula, type MatriculaResult } from "../lib/matricula";
import styles from "./tracking.module.css";

export default function MatriculaBox({ requestId }: { requestId: string }) {
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<MatriculaResult | null>(null);

  const MAX_MB = 20;

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
                {p.tipo} — {p.status}
              </li>
            ))}
          </ul>
        )}
        <span className={styles.mNote}>
          Triagem automática por regras. Não substitui a análise jurídica; o responsável
          técnico confere a matrícula.
        </span>
      </div>
    );
  }

  return (
    <div className={styles.matricula}>
      <label className={styles.mConsent}>
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        Autorizo o processamento da matrícula (PDF) para análise de ônus, conforme a LGPD.
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
      {err && <p className={styles.err}>{err}</p>}
    </div>
  );
}
