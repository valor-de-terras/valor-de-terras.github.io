// Cliente Gemini (Google Generative Language API) para a Frente E: OCR de matrículas
// escaneadas e leitura contextual do texto. Complementa o detector por regras de
// _shared/matricula.ts, que continua sendo a triagem primária: o LLM é segunda opinião.
//
// LGPD: a matrícula contém dado pessoal (nome, CPF, endereço). O tier GRATUITO do Gemini
// usa o conteúdo enviado para treinar modelos e admite revisão humana. Por isso o envio
// só acontece com o consentimento explícito registrado no upload (consent_version), e o
// schema abaixo PROÍBE o modelo de devolver dado pessoal: o laudo só recebe fatos
// técnicos (área, confrontantes, ônus). Ativar billing no projeto Google migra a chave
// para os termos pagos (sem treino, sem revisão humana) sem tocar neste código.

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-2.5-flash";

/** Limite do corpo inline da API (~20 MB). base64 infla ~4/3, então o PDF cru precisa
 *  ficar bem abaixo disso. Acima do limite o OCR é recusado (o Files API seria o caminho). */
export const MAX_OCR_BYTES = 14 * 1024 * 1024;

// Orçamento de tempo: OCR e leitura rodam em sequência na MESMA invocação, então o pior
// caso somado (90s) precisa caber no wall-clock da Edge Function com folga para o
// download e o insert. Estourar significaria matar a request sem persistir nem a análise
// por regras, que é justamente o piso que não pode se perder.
const OCR_TIMEOUT_MS = 60_000;
const READ_TIMEOUT_MS = 30_000;

/** Leitura estruturada da matrícula, deliberadamente SEM dado pessoal. */
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
  onus: Array<{
    tipo: string;
    status: "ativo" | "cancelado" | "indeterminado";
    ato: string | null;
    resumo: string;
  }>;
  observacoes: string | null;
  confianca: "alta" | "media" | "baixa";
}

// Subconjunto OpenAPI aceito pelo responseSchema do Gemini (nullable, sem anyOf).
const LEITURA_SCHEMA = {
  type: "object",
  properties: {
    matricula_numero: { type: "string", nullable: true, description: "Número da matrícula" },
    cartorio: { type: "string", nullable: true, description: "Cartório/Ofício de Registro de Imóveis" },
    municipio_uf: { type: "string", nullable: true, description: "Município e UF do imóvel" },
    denominacao: { type: "string", nullable: true, description: "Denominação do imóvel (ex: Fazenda Santa Rita)" },
    area_registrada_ha: { type: "number", nullable: true, description: "Área registrada convertida para hectares" },
    area_texto: { type: "string", nullable: true, description: "Área exatamente como escrita na matrícula" },
    georreferenciada: { type: "boolean", nullable: true, description: "Há certificação de georreferenciamento pelo INCRA" },
    confrontantes_n: { type: "integer", nullable: true, description: "QUANTIDADE de confrontantes citados. Nunca os nomes." },
    transmissoes_n: { type: "integer", nullable: true, description: "Quantidade de transmissões de propriedade registradas" },
    reserva_legal_averbada: { type: "boolean", nullable: true },
    reserva_legal_detalhe: { type: "string", nullable: true, description: "Percentual/área e ato da averbação, ex: '20%, R-7'" },
    onus: {
      type: "array",
      description: "Ônus, gravames, cláusulas restritivas e ações judiciais",
      items: {
        type: "object",
        properties: {
          tipo: { type: "string", description: "Ex: Hipoteca, Alienação fiduciária, Penhora, Usufruto, Servidão" },
          status: { type: "string", enum: ["ativo", "cancelado", "indeterminado"] },
          ato: { type: "string", nullable: true, description: "Ato do registro, ex: R-12, Av-3" },
          resumo: { type: "string", description: "Resumo técnico SEM nomes, CPF ou endereços" },
        },
        required: ["tipo", "status", "resumo"],
      },
    },
    observacoes: { type: "string", nullable: true, description: "Observações técnicas relevantes à avaliação" },
    confianca: { type: "string", enum: ["alta", "media", "baixa"], description: "Confiança na leitura do documento" },
  },
  required: ["onus", "confianca"],
} as const;

const REGRA_PII =
  "REGRA ABSOLUTA DE PRIVACIDADE: nunca inclua na resposta nome de pessoa física ou jurídica, " +
  "CPF, CNPJ, RG, estado civil, profissão, endereço residencial ou qualquer dado que identifique " +
  "pessoas. Onde a matrícula citar pessoas, responda apenas com o fato técnico ou a quantidade. " +
  "Para confrontantes devolva somente quantos são, jamais quem são.";

const PROMPT_LEITURA =
  "Você é assistente de um engenheiro avaliador de imóveis rurais no Brasil, trabalhando sob a " +
  "NBR 14.653. Leia a matrícula de imóvel abaixo e extraia os fatos técnicos que importam para a " +
  "avaliação: área registrada, denominação, georreferenciamento, ônus e gravames (distinguindo os " +
  "ATIVOS dos CANCELADOS/baixados), cláusulas restritivas, reserva legal averbada e quantidade de " +
  "transmissões.\n\n" +
  "Um ônus só é 'cancelado' se a própria matrícula registrar o cancelamento, a baixa ou a " +
  "liberação. Na dúvida use 'indeterminado'. Não invente: o que não estiver no documento é null. " +
  "Se o texto estiver ilegível ou truncado, use confianca 'baixa'.\n\n" +
  REGRA_PII;

const PROMPT_OCR =
  "Transcreva integralmente e literalmente todo o texto desta matrícula de imóvel, incluindo " +
  "registros (R-), averbações (Av-) e datas, preservando a ordem do documento. Não resuma, não " +
  "interprete e não comente. Devolva apenas a transcrição.";

export function geminiEnabled(): boolean {
  return Boolean(Deno.env.get("GEMINI_API_KEY"));
}

export function geminiModel(): string {
  return Deno.env.get("GEMINI_MODEL") || DEFAULT_MODEL;
}

interface GeminiPart {
  text?: string;
  inline_data?: { mime_type: string; data: string };
}

async function callGemini(
  parts: GeminiPart[],
  opts: { json: boolean; timeoutMs: number },
): Promise<string | null> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return null;

  const body: Record<string, unknown> = {
    contents: [{ parts }],
    generationConfig: {
      temperature: 0,
      ...(opts.json ? { responseMimeType: "application/json", responseSchema: LEITURA_SCHEMA } : {}),
    },
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  try {
    const res = await fetch(`${ENDPOINT}/${geminiModel()}:generateContent`, {
      method: "POST",
      // chave no header, não na URL: evita vazar o segredo em logs de request
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      // não ecoa o corpo da resposta: pode conter trechos do documento enviado
      console.error(`gemini http ${res.status} ${res.statusText}`);
      return null;
    }
    const data = await res.json();
    const cand = data?.candidates?.[0];
    if (cand?.finishReason && cand.finishReason !== "STOP") {
      console.error(`gemini finishReason=${cand.finishReason}`);
      if (cand.finishReason !== "MAX_TOKENS") return null;
    }
    const text = (cand?.content?.parts ?? [])
      .map((p: GeminiPart) => p.text ?? "")
      .join("")
      .trim();
    return text || null;
  } catch (e) {
    console.error("gemini call failed:", e instanceof Error ? e.message : String(e));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function toBase64(bytes: Uint8Array): string {
  // btoa em chunks: String.fromCharCode(...bytes) estoura a pilha em PDFs grandes
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/**
 * OCR de matrícula escaneada: manda o PDF inline para o Gemini transcrever.
 * Devolve null se a chave não estiver configurada, o PDF for grande demais ou a API falhar.
 */
export async function ocrPdf(bytes: Uint8Array): Promise<string | null> {
  if (!geminiEnabled()) return null;
  if (bytes.length > MAX_OCR_BYTES) {
    console.error(`ocr skipped: pdf too large (${bytes.length} bytes)`);
    return null;
  }
  return await callGemini(
    [
      { text: PROMPT_OCR },
      { inline_data: { mime_type: "application/pdf", data: toBase64(bytes) } },
    ],
    { json: false, timeoutMs: OCR_TIMEOUT_MS },
  );
}

/**
 * Leitura contextual do texto da matrícula, em JSON estruturado e sem PII.
 * Devolve null se o LLM não estiver disponível ou a resposta não for utilizável.
 */
export async function lerMatricula(texto: string): Promise<LeituraMatricula | null> {
  if (!geminiEnabled()) return null;
  const corpo = texto.slice(0, 120_000); // guarda de custo/latência; matrícula típica cabe folgado
  const raw = await callGemini(
    [{ text: `${PROMPT_LEITURA}\n\n--- MATRÍCULA ---\n${corpo}` }],
    { json: true, timeoutMs: READ_TIMEOUT_MS },
  );
  if (!raw) return null;
  try {
    return sanitizeLeitura(JSON.parse(raw));
  } catch {
    console.error("gemini returned non-json for leitura");
    return null;
  }
}

const CPF_RE = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const CNPJ_RE = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;

// Papéis que, numa matrícula, são SEMPRE seguidos da qualificação de alguém. O prompt
// proíbe nomes, mas prompt não é contrato: o modelo escorrega justamente em campo livre
// ("Hipoteca em favor de Banco X", "Usufruto em favor de Maria de Souza"). Estes marcadores
// são o gancho para remover o nome no código, antes de virar linha de laudo.
const PAPEIS =
  "em\\s+nome\\s+de|em\\s+favor\\s+de|propriet[áa]ri[oa]s?|outorgante[s]?|outorgad[oa]s?|" +
  "adquirente[s]?|transmitente[s]?|alienante[s]?|vendedor(?:a|es)?|comprador(?:a|es)?|" +
  "credor(?:a|es)?|devedor(?:a|es)?|exequente[s]?|executad[oa]s?|usufrutu[áa]ri[oa]s?|" +
  "nu-propriet[áa]ri[oa]s?|fiduci[áa]ri[oa]|fiduciante|titular(?:es)?|herdeir[oa]s?|" +
  "invent[áa]riante|cess?ion[áa]ri[oa]s?|cedente[s]?|confrontante[s]?|Sr\\.?|Sra\\.?|Dr\\.?|Dra\\.?";

// Sequência de palavras Capitalizadas com as conectivas de nome próprio pt-BR
// ("João da Silva Neto", "Banco do Brasil S/A").
const NOME_RUN = "[A-ZÀ-Ý][\\wÀ-ÿ'´`.-]*(?:\\s+(?:d[aeo]s?|e|von|van|del)\\s+[A-ZÀ-Ý\\wÀ-ÿ'´`.-]+|\\s+[A-ZÀ-Ý][\\wÀ-ÿ'´`.-]*){0,5}";

// 'i' para casar o papel em qualquer caixa; a exigência de nome Capitalizado é conferida
// no callback (um único regex não pode ser insensível no marcador e sensível no nome).
const NOME_APOS_PAPEL = new RegExp(`\\b(${PAPEIS})\\s*:?\\s+(${NOME_RUN})`, "gi");

/**
 * Última barreira de PII antes do laudo. O schema já impede o pior (confrontante é
 * QUANTIDADE, nunca nome), mas os campos livres dependeriam só da obediência do modelo.
 * Aqui o nome que vier atrelado a um papel do registro morre no código.
 */
function stripNomes(s: string): string {
  return s.replace(NOME_APOS_PAPEL, (m, papel, nome) =>
    // só remove se o que segue o papel é nome próprio (Capitalizado): "proprietário
    // rural" continua inteiro, "proprietário João da Silva" vira "[nome removido]".
    /^[A-ZÀ-Ý]/.test(nome) ? `${papel} [nome removido]` : m
  );
}

function scrub(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = stripNomes(s)
    .replace(CPF_RE, "[removido]")
    .replace(CNPJ_RE, "[removido]")
    .trim();
  return t ? t.slice(0, 400) : null;
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(",", ".")) : NaN;
  return Number.isFinite(n) ? n : null;
}

function bool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

/**
 * Normaliza a resposta do modelo e faz a última barreira de PII: o schema proíbe nome e
 * CPF, mas o modelo não é contrato. Números documentais que escaparem morrem aqui.
 */
function sanitizeLeitura(raw: Record<string, unknown>): LeituraMatricula {
  const onusRaw = Array.isArray(raw.onus) ? raw.onus : [];
  const status = new Set(["ativo", "cancelado", "indeterminado"]);
  const onus = onusRaw.slice(0, 40).map((o) => {
    const r = (o ?? {}) as Record<string, unknown>;
    const st = String(r.status ?? "indeterminado");
    return {
      tipo: scrub(r.tipo) ?? "Apontamento",
      status: (status.has(st) ? st : "indeterminado") as LeituraMatricula["onus"][number]["status"],
      ato: scrub(r.ato),
      resumo: scrub(r.resumo) ?? "",
    };
  });
  const conf = String(raw.confianca ?? "baixa");
  return {
    matricula_numero: scrub(raw.matricula_numero),
    cartorio: scrub(raw.cartorio),
    municipio_uf: scrub(raw.municipio_uf),
    denominacao: scrub(raw.denominacao),
    area_registrada_ha: num(raw.area_registrada_ha),
    area_texto: scrub(raw.area_texto),
    georreferenciada: bool(raw.georreferenciada),
    confrontantes_n: num(raw.confrontantes_n) === null ? null : Math.trunc(num(raw.confrontantes_n)!),
    transmissoes_n: num(raw.transmissoes_n) === null ? null : Math.trunc(num(raw.transmissoes_n)!),
    reserva_legal_averbada: bool(raw.reserva_legal_averbada),
    reserva_legal_detalhe: scrub(raw.reserva_legal_detalhe),
    onus,
    observacoes: scrub(raw.observacoes),
    confianca: (["alta", "media", "baixa"].includes(conf) ? conf : "baixa") as LeituraMatricula["confianca"],
  };
}
