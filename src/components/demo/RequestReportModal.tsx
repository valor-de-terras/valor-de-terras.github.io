import { useEffect, useState } from "react";
import { proceedToReview } from "../../lib/portal";
import { fmtArea } from "../../lib/format";
import styles from "./RequestReportModal.module.css";

interface Props {
  requestId: string | null;
  municipality: string;
  uf: string;
  area: number;
  onClose: () => void;
}

const PURPOSES: { value: string; label: string }[] = [
  { value: "garantia_bancaria", label: "Garantia bancária / crédito rural" },
  { value: "venda", label: "Compra e venda" },
  { value: "partilha", label: "Partilha / inventário" },
  { value: "judicial", label: "Judicial / perícia" },
  { value: "itr", label: "ITR / fiscal" },
  { value: "arrendamento", label: "Arrendamento" },
  { value: "outro", label: "Outro" },
];

export default function RequestReportModal({ requestId, municipality, uf, area, onClose }: Props) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [purpose, setPurpose] = useState("garantia_bancaria");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!requestId) { setErr("Rode a estimativa no servidor antes de solicitar o laudo formal."); return; }
    if (!consent) { setErr("É necessário concordar com o uso dos dados para contato."); return; }
    setBusy(true);
    try {
      await proceedToReview(requestId, { name, email, phone, purpose });
      setDone(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Falha ao enviar a solicitação.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.backdrop} onClick={onClose} role="dialog" aria-modal="true">
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button className={styles.close} onClick={onClose} aria-label="Fechar">✕</button>

        {done ? (
          <div className={styles.doneWrap}>
            <div className={styles.doneMark}>✓</div>
            <h2 className={styles.title}>Solicitação enviada</h2>
            <p className={styles.lede}>
              Seu pedido entrou na fila de revisão técnica. Um engenheiro habilitado (Agrônomo ou
              Florestal, com CREA e ART) vai revisar a avaliação e emitir o laudo formal.
            </p>
            {requestId && (
              <p className={styles.code}>
                Código do pedido: <strong>#{requestId.slice(0, 8).toUpperCase()}</strong>
              </p>
            )}
            <p className={styles.finePrint}>
              Guardamos seu contato apenas para tratar deste pedido. Retornaremos por e-mail ou
              telefone com o laudo e a cobrança (a partir de R$ 2.500, conforme complexidade).
              Você também pode acompanhar o status e baixar o laudo em{" "}
              <a href="#/pedidos" style={{ textDecoration: "underline" }}>Meus pedidos</a>.
            </p>
            <a className={`vt-btn vt-btn-primary ${styles.wFull}`} href="#/pedidos" onClick={onClose}>
              Acompanhar meus pedidos
            </a>
          </div>
        ) : (
          <>
            <span className={styles.eyebrow}>Laudo formal · NBR 14.653-3</span>
            <h2 className={styles.title}>Solicitar laudo com ART</h2>
            <p className={styles.lede}>
              Imóvel em <strong>{municipality}{uf && uf !== "—" ? `/${uf}` : ""}</strong> · {fmtArea(area)}.
              Deixe seu contato que um engenheiro responsável assume a revisão e emite o laudo
              assinado com ART.
            </p>

            <form onSubmit={submit}>
              <div className={styles.field}>
                <label className={styles.label}>Nome</label>
                <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className={styles.row2}>
                <div className={styles.field}>
                  <label className={styles.label}>E-mail</label>
                  <input className={styles.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Telefone / WhatsApp</label>
                  <input className={styles.input} value={phone} onChange={(e) => setPhone(e.target.value)} />
                </div>
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Finalidade da avaliação</label>
                <select className={styles.input} value={purpose} onChange={(e) => setPurpose(e.target.value)}>
                  {PURPOSES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>

              <label className={styles.consent}>
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span>Concordo que meus dados sejam usados para contato sobre este pedido de laudo.</span>
              </label>

              {err && <div className={styles.err}>{err}</div>}

              <button type="submit" className={`vt-btn vt-btn-primary ${styles.wFull}`} disabled={busy}>
                {busy ? "Enviando…" : "Enviar solicitação"}
              </button>
              <p className={styles.finePrint}>
                Sem cobrança agora. O laudo formal (Grau II/III) é orçado conforme a área e a
                complexidade, a partir de R$ 2.500.
              </p>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
