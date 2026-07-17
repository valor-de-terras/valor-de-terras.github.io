import { supabase, ensureAnonSession } from "./supabase";

export interface Passivo {
  tipo: string;
  status: "ativo" | "cancelado" | "indeterminado";
  ocorrencias: number;
  trecho: string;
}

/** Leitura contextual devolvida pelo LLM. Sem PII por construção: confrontantes vêm
 *  como quantidade, nunca como nomes. */
export interface LeituraMatricula {
  matricula_numero: string | null;
  cartorio: string | null;
  municipio_uf: string | null;
  denominacao: string | null;
  area_registrada_ha: number | null;
  area_texto: string | null;
  georreferenciada: boolean | null;
  confrontantes_n: number | null;
  transmissoes_n: number | null;
  reserva_legal_averbada: boolean | null;
  reserva_legal_detalhe: string | null;
  onus: Array<{ tipo: string; status: Passivo["status"]; ato: string | null; resumo: string }>;
  observacoes: string | null;
  confianca: "alta" | "media" | "baixa";
}

export interface MatriculaResult {
  n_passivos: number;
  n_ativos: number;
  passivos: Passivo[];
  /** Null quando só as regras rodaram (sem chave de LLM ou consentimento antigo). */
  leitura?: LeituraMatricula | null;
  /** True quando o texto veio de OCR na nuvem (matrícula escaneada). */
  ocr?: boolean;
  engine?: string;
}

/** Versão do texto de consentimento exibido em MatriculaBox. A Edge Function só envia a
 *  matrícula ao provedor de nuvem (OCR/LLM) se o documento foi registrado sob esta
 *  redação, que declara esse envio. Mudou o texto -> muda a versão. */
export const CONSENT_VERSION = "v2-cloud-ocr";

/**
 * Envia a matrícula (PDF) para o bucket privado, registra (com consentimento LGPD) e roda
 * a análise dominial: regras + OCR/leitura assistida quando disponível.
 */
export async function uploadAndAnalyzeMatricula(
  requestId: string,
  file: File,
  consent: boolean
): Promise<MatriculaResult> {
  if (!consent) throw new Error("O consentimento LGPD é obrigatório para processar a matrícula.");
  const session = await ensureAnonSession();
  const uid = session?.user?.id;
  if (!uid) throw new Error("Sessão não encontrada.");

  const path = `${uid}/${requestId}-${Date.now()}.pdf`;
  const { error: upErr } = await supabase.storage
    .from("matriculas")
    .upload(path, file, { contentType: file.type || "application/pdf", upsert: true });
  if (upErr) throw new Error("Falha no envio do arquivo: " + upErr.message);

  const { data: docId, error: regErr } = await supabase.rpc("register_matricula", {
    p_request_id: requestId,
    p_storage_path: path,
    p_filename: file.name,
    p_consent: consent,
    p_consent_version: CONSENT_VERSION,
  });
  if (regErr) throw new Error(regErr.message);

  const { data, error } = await supabase.functions.invoke("analyze-matricula", {
    body: { document_id: docId },
  });
  if (error) throw error;
  if (!data || data.error) throw new Error(data?.error ?? "Falha na análise da matrícula.");
  return data as MatriculaResult;
}
