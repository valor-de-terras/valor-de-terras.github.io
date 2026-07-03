import { supabase, ensureAnonSession } from "./supabase";

export interface Passivo {
  tipo: string;
  status: "ativo" | "cancelado" | "indeterminado";
  ocorrencias: number;
  trecho: string;
}

export interface MatriculaResult {
  n_passivos: number;
  n_ativos: number;
  passivos: Passivo[];
}

/**
 * Envia a matrícula (PDF) para o bucket privado, registra (com consentimento LGPD) e roda
 * a análise de passivos por regras. Retorna os passivos encontrados.
 */
export async function uploadAndAnalyzeMatricula(
  requestId: string,
  file: File
): Promise<MatriculaResult> {
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
    p_consent: true,
  });
  if (regErr) throw new Error(regErr.message);

  const { data, error } = await supabase.functions.invoke("analyze-matricula", {
    body: { document_id: docId },
  });
  if (error) throw error;
  if (!data || data.error) throw new Error(data?.error ?? "Falha na análise da matrícula.");
  return data as MatriculaResult;
}
