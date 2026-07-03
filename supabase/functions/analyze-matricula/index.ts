// Edge Function: analyze-matricula
// Lê a matrícula (PDF) do bucket privado, extrai o texto e roda o detector de passivos
// por regras. Persiste a análise (sem reexpor o arquivo). Chamado após o upload/registro.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { extractText, getDocumentProxy } from "https://esm.sh/unpdf@0.12.1";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { analisarMatricula } from "../_shared/matricula.ts";

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
    .select("id, request_id, storage_path, owner_id")
    .eq("id", body.document_id)
    .single();
  if (docErr || !doc) return jsonResponse({ error: "Documento não encontrado ou sem acesso" }, origin, 403);

  // defesa em profundidade: o download abaixo usa service_role (bypass da RLS de
  // storage), então o path registrado PRECISA estar no prefixo do dono do documento
  if (!doc.owner_id || !String(doc.storage_path).startsWith(`${doc.owner_id}/`)) {
    return jsonResponse({ error: "Caminho de arquivo inválido para este documento" }, origin, 403);
  }

  // service role para baixar o arquivo (bypass RLS de storage) e persistir a análise
  const svc = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: file, error: dlErr } = await svc.storage.from("matriculas").download(doc.storage_path);
  if (dlErr || !file) return jsonResponse({ error: "Falha ao ler o arquivo da matrícula" }, origin, 400);

  let text = "";
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    const pdf = await getDocumentProxy(buf);
    const res = await extractText(pdf, { mergePages: true });
    text = Array.isArray(res.text) ? res.text.join("\n") : String(res.text ?? "");
  } catch (e) {
    return jsonResponse(
      { error: "Não foi possível extrair texto (matrícula pode ser imagem/escaneada; OCR não disponível)", detail: String(e) },
      origin,
      422,
    );
  }
  if (text.replace(/\s/g, "").length < 40) {
    return jsonResponse(
      { error: "Texto insuficiente (matrícula provavelmente escaneada como imagem; requer OCR)" },
      origin,
      422,
    );
  }

  const analise = analisarMatricula(text);
  const markdown = text.replace(/\r/g, "").replace(/[ \t]+/g, " ").slice(0, 20000);

  const { data: ins, error: insErr } = await svc
    .from("matricula_analyses")
    .insert({
      document_id: doc.id,
      request_id: doc.request_id,
      markdown,
      passivos: analise.passivos,
      n_passivos: analise.n_passivos,
      n_ativos: analise.n_ativos,
      engine: "rule-based-0.1",
    })
    .select("id")
    .single();
  if (insErr) return jsonResponse({ error: insErr.message }, origin, 400);

  return jsonResponse(
    {
      analysis_id: ins.id,
      n_passivos: analise.n_passivos,
      n_ativos: analise.n_ativos,
      passivos: analise.passivos,
    },
    origin,
  );
});
