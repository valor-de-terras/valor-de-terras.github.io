// Edge Function: analyze-matricula
// Lê a matrícula (PDF) do bucket privado e produz a triagem dominial em duas camadas:
//   1) detector de passivos por REGRAS (_shared/matricula.ts) — sempre roda, é a base;
//   2) OCR + leitura contextual por LLM (_shared/gemini.ts) — quando há GEMINI_API_KEY.
// Se o PDF não tem camada de texto (escaneado), o OCR na nuvem entra no lugar dela e o
// mesmo texto alimenta as duas camadas. Sem a chave, o comportamento é o anterior:
// regras no PDF pesquisável e 422 no escaneado. Persiste a análise (sem reexpor o arquivo).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { extractText, getDocumentProxy } from "https://esm.sh/unpdf@0.12.1";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { analisarMatricula } from "../_shared/matricula.ts";
import { geminiEnabled, geminiModel, lerMatricula, ocrPdf, MAX_OCR_BYTES } from "../_shared/gemini.ts";

/** Abaixo disso o PDF não tem camada de texto útil: é digitalização e precisa de OCR. */
const MIN_TEXT_CHARS = 40;

const semTexto = (s: string) => s.replace(/\s/g, "").length < MIN_TEXT_CHARS;

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return jsonResponse({ error: "Use POST" }, origin, 405);

  const auth = req.headers.get("Authorization");
  if (!auth) return jsonResponse({ error: "Autenticação necessária" }, origin, 401);

  let body: { document_id?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "JSON inválido" }, origin, 400);
  }
  if (!body?.document_id) return jsonResponse({ error: "document_id é obrigatório" }, origin, 400);

  const url = Deno.env.get("SUPABASE_URL")!;
  // cliente com o JWT do chamador: só lê o documento se RLS permitir (dono ou técnico)
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: doc, error: docErr } = await asUser
    .from("matricula_documents")
    .select("id, request_id, storage_path, owner_id, consent, consent_version")
    .eq("id", body.document_id)
    .single();
  if (docErr || !doc) return jsonResponse({ error: "Documento não encontrado ou sem acesso" }, origin, 403);

  // defesa em profundidade: o download abaixo usa service_role (bypass da RLS de
  // storage), então o path registrado PRECISA estar no prefixo do dono do documento
  if (!doc.owner_id || !String(doc.storage_path).startsWith(`${doc.owner_id}/`)) {
    return jsonResponse({ error: "Caminho de arquivo inválido para este documento" }, origin, 403);
  }

  // O envio à nuvem só é lícito sob o consentimento que declara esse envio. Documentos
  // registrados sob a redação antiga (consent_version null) ficam restritos às regras
  // locais, mesmo com a chave configurada: consentir com "análise de ônus" não é
  // consentir com "enviar a matrícula ao Google".
  const podeNuvem = geminiEnabled() && doc.consent === true && doc.consent_version === "v2-cloud-ocr";

  // service role para baixar o arquivo (bypass RLS de storage) e persistir a análise
  const svc = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: file, error: dlErr } = await svc.storage.from("matriculas").download(doc.storage_path);
  if (dlErr || !file) return jsonResponse({ error: "Falha ao ler o arquivo da matrícula" }, origin, 400);

  const bytes = new Uint8Array(await file.arrayBuffer());

  let text = "";
  try {
    const pdf = await getDocumentProxy(bytes);
    const res = await extractText(pdf, { mergePages: true });
    text = Array.isArray(res.text) ? res.text.join("\n") : String(res.text ?? "");
  } catch (e) {
    // PDF só-imagem costuma extrair vazio em vez de lançar, mas um PDF corrompido cai
    // aqui; o OCR abaixo ainda tem chance, então não aborta já.
    console.error("pdf text extraction failed:", String(e));
  }

  // ── OCR: a digitalização passa a ser lida, não recusada ─────────────────────
  let ocrUsado = false;
  if (semTexto(text) && podeNuvem) {
    if (bytes.length > MAX_OCR_BYTES) {
      return jsonResponse(
        { error: "PDF grande demais para leitura automática. Reenvie com resolução menor (300 dpi bastam)." },
        origin,
        422,
      );
    }
    const ocr = await ocrPdf(bytes);
    if (ocr && !semTexto(ocr)) {
      text = ocr;
      ocrUsado = true;
    }
  }

  if (semTexto(text)) {
    return jsonResponse(
      {
        error: podeNuvem
          ? "Não foi possível ler a matrícula. Verifique se o PDF está legível, reto e nítido, e tente de novo."
          : "Texto insuficiente (matrícula provavelmente escaneada como imagem; leitura automática indisponível).",
      },
      origin,
      422,
    );
  }

  // Regras sempre rodam: são a triagem primária e o piso de qualidade se o LLM falhar.
  const analise = analisarMatricula(text);
  const leitura = podeNuvem ? await lerMatricula(text) : null;

  const markdown = text.replace(/\r/g, "").replace(/[ \t]+/g, " ").slice(0, 20000);
  const engine = leitura ? (ocrUsado ? "ocr+llm+rules-0.2" : "llm+rules-0.2") : "rule-based-0.1";

  const { data: ins, error: insErr } = await svc
    .from("matricula_analyses")
    .insert({
      document_id: doc.id,
      request_id: doc.request_id,
      markdown,
      passivos: analise.passivos,
      n_passivos: analise.n_passivos,
      n_ativos: analise.n_ativos,
      leitura,
      ocr: ocrUsado,
      llm_model: leitura ? geminiModel() : null,
      engine,
    })
    .select("id")
    .single();
  if (insErr) {
    console.error("analysis insert failed:", insErr.message);
    return jsonResponse({ error: "Falha ao salvar a análise da matrícula." }, origin, 400);
  }

  return jsonResponse(
    {
      analysis_id: ins.id,
      n_passivos: analise.n_passivos,
      n_ativos: analise.n_ativos,
      passivos: analise.passivos,
      leitura,
      ocr: ocrUsado,
      engine,
    },
    origin,
  );
});
