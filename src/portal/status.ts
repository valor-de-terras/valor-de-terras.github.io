import styles from "./portal.module.css";
import type { AppraisalStatusFull } from "../lib/portal";

interface StatusView {
  label: string;
  cls: string;
}

export function statusView(s: string): StatusView {
  switch (s as AppraisalStatusFull) {
    case "TECHNICAL_REVIEW_QUEUED":
      return { label: "Na fila", cls: styles.stQueued };
    case "TECHNICAL_REVIEW_IN_PROGRESS":
      return { label: "Em revisão", cls: styles.stProgress };
    case "REPORT_GENERATING":
      return { label: "Gerando laudo", cls: styles.stGenerating };
    case "DELIVERED":
      return { label: "Laudo entregue", cls: styles.stDelivered };
    case "ESTIMATE_DELIVERED":
      return { label: "Estimativa pronta", cls: styles.stOther };
    case "NEEDS_MORE_INFO":
      return { label: "Aguardando dados", cls: styles.stQueued };
    case "CANCELLED_BY_USER":
      return { label: "Cancelado", cls: styles.stOther };
    default:
      return { label: s.replace(/_/g, " ").toLowerCase(), cls: styles.stOther };
  }
}

export const PURPOSE_LABELS: Record<string, string> = {
  garantia_bancaria: "Garantia bancária",
  partilha: "Partilha / inventário",
  venda: "Compra e venda",
  judicial: "Judicial / perícia",
  itr: "ITR / fiscal",
  arrendamento: "Arrendamento",
  cpr: "CPR / crédito rural",
  outro: "Outro",
};
