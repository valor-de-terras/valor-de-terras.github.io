import { useEffect, useState } from "react";
import { supabase, ensureAnonSession } from "../lib/supabase";
import styles from "./VerifyReport.module.css";

interface Attestation {
  found: boolean;
  laudo?: string;
  municipio?: string | null;
  uf?: string | null;
  area_ha?: number;
  car_code?: string | null;
  grau?: string | null;
  art?: string | null;
  responsavel?: string | null;
  crea?: string | null;
  crea_uf?: string | null;
  emitido_em?: string;
  sha256?: string | null;
  assinatura?: string;
  assinado_em?: string | null;
}

function codeFromHash(): string {
  const h = window.location.hash || "";
  const q = h.includes("?") ? h.slice(h.indexOf("?") + 1) : "";
  return new URLSearchParams(q).get("c")?.trim().toUpperCase() ?? "";
}

export default function VerifyReport() {
  const [code, setCode] = useState(() => codeFromHash());
  const [input, setInput] = useState(code);
  const [data, setData] = useState<Attestation | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!code) {
      setData(null);
      return;
    }
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        await ensureAnonSession();
        const { data: res, error } = await supabase.rpc("verify_report", { p_code: code });
        if (alive) setData(error ? { found: false } : (res as Attestation));
      } catch {
        if (alive) setData({ found: false });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [code]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const c = input.trim().toUpperCase();
    window.location.hash = `#/verificar?c=${c}`;
    setCode(c);
  };

  const fmtDate = (s?: string | null) =>
    s ? new Date(s).toLocaleDateString("pt-BR") : "-";

  return (
    <div className={styles.wrap}>
      <a href="#/" className={styles.back}>← Valor de Terras</a>
      <h1 className={styles.title}>Verificação de autenticidade do laudo</h1>
      <p className={styles.lead}>
        Informe o código de verificação impresso no rodapé do laudo para conferir sua
        autenticidade, o responsável técnico e a situação da assinatura digital.
      </p>

      <form className={styles.form} onSubmit={submit}>
        <input
          className={styles.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Código de verificação (ex.: A1B2C3D4E5)"
          maxLength={16}
          spellCheck={false}
        />
        <button className={styles.btn} type="submit">Verificar</button>
      </form>

      {loading && <p className={styles.muted}>Consultando…</p>}

      {!loading && data && !data.found && code && (
        <div className={styles.notFound}>
          Nenhum laudo encontrado para o código <strong>{code}</strong>. Confira o código no
          rodapé do documento.
        </div>
      )}

      {!loading && data?.found && (
        <div className={styles.card}>
          <div className={styles.badgeOk}>Laudo autêntico · emitido pela plataforma</div>
          <dl className={styles.kv}>
            <dt>Laudo nº</dt><dd>{data.laudo}</dd>
            <dt>Imóvel</dt><dd>{data.municipio}{data.uf ? `/${data.uf}` : ""}{data.car_code ? ` · CAR ${data.car_code}` : ""}</dd>
            <dt>Área</dt><dd>{data.area_ha != null ? `${data.area_ha} ha` : "-"}</dd>
            <dt>Responsável técnico</dt><dd>{data.responsavel ?? "-"}{data.crea ? ` · CREA ${data.crea}${data.crea_uf ? "/" + data.crea_uf : ""}` : ""}</dd>
            <dt>ART</dt><dd>{data.art ?? "-"}</dd>
            <dt>Grau (NBR 14.653)</dt><dd>{data.grau ?? "-"}</dd>
            <dt>Emitido em</dt><dd>{fmtDate(data.emitido_em)}</dd>
            <dt>Assinatura digital</dt>
            <dd>
              {data.assinatura === "rt_signed" ? (
                <span className={styles.sigOk}>Assinado pelo responsável técnico em {fmtDate(data.assinado_em)}</span>
              ) : (
                <span className={styles.sigPend}>Pendente de assinatura digital do responsável técnico (Gov.br / ICP-Brasil)</span>
              )}
            </dd>
          </dl>
          {data.sha256 && (
            <div className={styles.hash}>
              <span className={styles.hashLabel}>Hash SHA-256 do documento (confira contra o arquivo recebido):</span>
              <code className={styles.hashVal}>{data.sha256}</code>
            </div>
          )}
          <p className={styles.note}>
            Esta página confirma que o código corresponde a um laudo emitido pela plataforma,
            com os dados acima. A validade jurídica plena depende da assinatura digital do
            responsável técnico (padrão ICP-Brasil / Gov.br). Não são exibidos valores do imóvel.
          </p>
        </div>
      )}
    </div>
  );
}
