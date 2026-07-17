// Gerador do laudo de avaliação (NBR 14.653-1 / 14.653-3) em PDF, server-side.
// Monta o documento programaticamente com pdf-lib (sem headless Chrome): capa com
// croqui vetorial do imóvel, seções NBR, tabela de homogeneização, comparativos,
// conclusão de valor, responsável técnico + ART e trilha de defensabilidade (hash).
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
  type RGB,
} from "https://esm.sh/pdf-lib@1.17.1?target=deno";

// ── paleta ───────────────────────────────────────────────────────────────────
const INK = rgb(0.11, 0.13, 0.12);
const MUTED = rgb(0.42, 0.45, 0.43);
const BRAND = rgb(0.09, 0.29, 0.21);
const ACCENT = rgb(0.72, 0.53, 0.04);
const LINE = rgb(0.82, 0.84, 0.82);
const BG = rgb(0.96, 0.97, 0.96);

// A4 em pontos
const PW = 595.28;
const PH = 841.89;
const M = 54; // margem
const BOTTOM = 70; // limite inferior do corpo (acima do rodapé)

// ── helpers de texto/número ──────────────────────────────────────────────────
/** Remove caracteres fora do Latin-1 (StandardFonts usa WinAnsi). */
function san(s: unknown): string {
  let t = String(s ?? "");
  t = t
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/→/g, "->")
    .replace(/≈/g, "~")
    .replace(/…/g, "...")
    .replace(/ /g, " ");
  // WinAnsi (Helvetica) deixa alguns pontos de código indefinidos; se chegarem ao encoder
  // do pdf-lib ele lança e aborta o laudo. Removemos controles C0/C1 e os slots indefinidos
  // (mantendo espaços); acentos do português (0xC0-0xFF) passam normalmente.
  const WINANSI_UNDEFINED = new Set([0x81, 0x8d, 0x8f, 0x90, 0x9d]);
  let out = "";
  for (const ch of t) {
    const cp = ch.charCodeAt(0);
    if (cp === 0x09 || cp === 0x0a || cp === 0x0d) { out += " "; continue; }
    if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) || WINANSI_UNDEFINED.has(cp)) continue;
    out += cp <= 255 ? ch : "?";
  }
  return out;
}

function fmtBRL(n: number | null | undefined, dec = 0): string {
  const v = Number(n ?? 0);
  const fixed = v.toFixed(dec);
  const [int, frac] = fixed.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return "R$ " + (frac ? `${grouped},${frac}` : grouped);
}

function fmtNum(n: number | null | undefined, dec = 0): string {
  const v = Number(n ?? 0);
  const fixed = v.toFixed(dec);
  const [int, frac] = fixed.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return frac ? `${grouped},${frac}` : grouped;
}

function fmtDate(iso?: string | null): string {
  if (!iso) return new Date().toISOString().slice(0, 10);
  return String(iso).slice(0, 10);
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── tipos de entrada (do get_request_bundle) ─────────────────────────────────
interface Bundle {
  request: Record<string, unknown>;
  property: {
    area_ha: number;
    perimeter_km: number;
    municipality: string | null;
    uf: string | null;
    car_code: string | null;
    origin: string | null;
    centroid: [number, number];
    geometry: { type: string; coordinates: unknown };
  };
  estimate: Record<string, unknown> | null;
  comparables: Array<Record<string, unknown>>;
  enrichment: Array<{ key: string; source: string | null; payload: Record<string, unknown> }>;
  report: Record<string, unknown> | null;
  technician: {
    full_name?: string | null;
    email?: string | null;
    crea_number?: string | null;
    uf?: string | null;
    specialty?: string | null;
    crea_valid_until?: string | null;
  } | null;
  // sinais de enriquecimento (Frentes H/I/J/K/L), calculados na geração do laudo.
  // pós-ART: podem expor valores; aparecem só no PDF formal, não na prévia.
  signals?: {
    viability?: Record<string, unknown> | null;
    zarc?: Record<string, unknown> | null;
    outorgas?: Record<string, unknown> | null;
    compliance?: Record<string, unknown> | null;
    logistics?: Record<string, unknown> | null;
    amenities?: Record<string, unknown> | null;
    spread?: Record<string, unknown> | null;
  } | null;
  // código de verificação pública + URL (assinatura/autenticidade).
  verification?: { code: string; url: string } | null;
  // fotos do relatório fotográfico (art. II.7), já baixadas do storage.
  photos?: Array<{ bytes: Uint8Array; caption?: string | null }>;
  // vistoria in loco (Frente F, art. II.11): registro estruturado da inspeção.
  field_visit?: Record<string, unknown> | null;
  // liquidez / tempo de exposição de mercado (Frente C): mediana de dias no mercado
  // na região: sinal de "tempo e expectativa" para realização do valor (NBR 14.653-1).
  liquidity?: Record<string, unknown> | null;
  // análise da matrícula (Frente E): ônus/gravames apurados por regras, para compor a
  // "documentação utilizada" (NBR 14.653-1, item 9-e).
  matricula?: Array<Record<string, unknown>> | null;
}

// ── cursor de layout com quebra automática de página ─────────────────────────
class Doc {
  pdf!: PDFDocument;
  font!: PDFFont;
  bold!: PDFFont;
  page!: PDFPage;
  y = PH - M;
  pageNo = 0;
  footer = "";

  static async create(): Promise<Doc> {
    const d = new Doc();
    d.pdf = await PDFDocument.create();
    d.font = await d.pdf.embedFont(StandardFonts.Helvetica);
    d.bold = await d.pdf.embedFont(StandardFonts.HelveticaBold);
    return d;
  }

  newPage() {
    this.page = this.pdf.addPage([PW, PH]);
    this.pageNo += 1;
    this.y = PH - M;
    this.drawFooter();
  }

  drawFooter() {
    const p = this.page;
    p.drawLine({ start: { x: M, y: BOTTOM - 12 }, end: { x: PW - M, y: BOTTOM - 12 }, thickness: 0.5, color: LINE });
    p.drawText(san(this.footer), { x: M, y: BOTTOM - 24, size: 6.5, font: this.font, color: MUTED });
    const pn = `${this.pageNo}`;
    p.drawText(pn, { x: PW - M - this.font.widthOfTextAtSize(pn, 6.5), y: BOTTOM - 24, size: 6.5, font: this.font, color: MUTED });
  }

  ensure(h: number) {
    if (this.y - h < BOTTOM) this.newPage();
  }

  wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
    const words = san(text).split(/\s+/);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const test = cur ? cur + " " + w : w;
      if (font.widthOfTextAtSize(test, size) > maxW && cur) {
        lines.push(cur);
        cur = w;
      } else {
        cur = test;
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  paragraph(text: string, opts: { size?: number; color?: RGB; gap?: number; font?: PDFFont } = {}) {
    const size = opts.size ?? 9.5;
    const color = opts.color ?? INK;
    const font = opts.font ?? this.font;
    const lh = size * 1.42;
    for (const line of this.wrap(text, font, size, PW - 2 * M)) {
      this.ensure(lh);
      this.page.drawText(line, { x: M, y: this.y, size, font, color });
      this.y -= lh;
    }
    this.y -= opts.gap ?? 4;
  }

  heading(n: string, title: string) {
    this.ensure(26);
    this.y -= 6;
    this.page.drawText(san(n), { x: M, y: this.y, size: 11, font: this.bold, color: ACCENT });
    this.page.drawText(san(title), { x: M + 22, y: this.y, size: 11, font: this.bold, color: BRAND });
    this.y -= 6;
    this.page.drawLine({ start: { x: M, y: this.y }, end: { x: PW - M, y: this.y }, thickness: 0.6, color: LINE });
    this.y -= 12;
  }

  /** tabela simples com colunas de largura fixa (fração da largura útil). */
  table(headers: string[], rows: string[][], widths: number[], aligns: ("l" | "r")[] = []) {
    const usable = PW - 2 * M;
    const cols = widths.map((w) => w * usable);
    const size = 8.2;
    const rowH = 16;
    const drawRow = (cells: string[], font: PDFFont, color: RGB, bg?: RGB) => {
      this.ensure(rowH);
      const yTop = this.y;
      if (bg) this.page.drawRectangle({ x: M, y: yTop - rowH + 4, width: usable, height: rowH, color: bg });
      let x = M + 4;
      cells.forEach((c, i) => {
        const w = cols[i] - 8;
        let str = san(c);
        // trunca célula longa preservando legibilidade
        if (font.widthOfTextAtSize(str, size) > w) {
          while (str.length > 1 && font.widthOfTextAtSize(str + "..", size) > w) str = str.slice(0, -1);
          str = str + "..";
        }
        const tw = font.widthOfTextAtSize(str, size);
        const tx = aligns[i] === "r" ? x + w - tw : x;
        this.page.drawText(str, { x: tx, y: yTop - rowH + 9, size, font, color });
        x += cols[i];
      });
      this.y -= rowH;
    };
    drawRow(headers, this.bold, rgb(1, 1, 1), BRAND);
    rows.forEach((r, i) => drawRow(r, this.font, INK, i % 2 ? BG : undefined));
    this.page.drawLine({ start: { x: M, y: this.y + 3 }, end: { x: PW - M, y: this.y + 3 }, thickness: 0.5, color: LINE });
    this.y -= 8;
  }

  kv(rows: [string, string][]) {
    const size = 9.2;
    const rowH = 15;
    const labelW = 200;
    rows.forEach(([k, v]) => {
      this.ensure(rowH);
      this.page.drawText(san(k), { x: M, y: this.y - 10, size, font: this.bold, color: MUTED });
      for (const line of this.wrap(v, this.font, size, PW - 2 * M - labelW)) {
        this.page.drawText(line, { x: M + labelW, y: this.y - 10, size, font: this.font, color: INK });
        this.y -= rowH;
        break; // uma linha por valor (kv compacto)
      }
    });
    this.y -= 6;
  }
}

// ── croqui vetorial do imóvel ────────────────────────────────────────────────
function exteriorRings(geom: { type: string; coordinates: unknown }): number[][][] {
  const rings: number[][][] = [];
  if (geom.type === "Polygon") {
    const c = geom.coordinates as number[][][];
    if (c[0]) rings.push(c[0]);
  } else if (geom.type === "MultiPolygon") {
    const c = geom.coordinates as number[][][][];
    for (const poly of c) if (poly[0]) rings.push(poly[0]);
  }
  return rings;
}

function drawSketch(doc: Doc, geom: { type: string; coordinates: unknown }, box: { x: number; y: number; w: number; h: number }) {
  const p = doc.page;
  p.drawRectangle({ x: box.x, y: box.y, width: box.w, height: box.h, borderColor: LINE, borderWidth: 1, color: rgb(0.985, 0.99, 0.985) });
  const rings = exteriorRings(geom);
  if (!rings.length) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rings) for (const [x, y] of r) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const pad = 14;
  const gw = maxX - minX || 1e-6;
  const gh = maxY - minY || 1e-6;
  const scale = Math.min((box.w - 2 * pad) / gw, (box.h - 2 * pad) / gh);
  const offX = box.x + (box.w - gw * scale) / 2;
  const offY = box.y + (box.h - gh * scale) / 2;
  const tx = (lon: number) => offX + (lon - minX) * scale;
  const ty = (lat: number) => offY + (lat - minY) * scale; // lat maior = mais acima (y-up do PDF)
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i], b = ring[i + 1];
      p.drawLine({ start: { x: tx(a[0]), y: ty(a[1]) }, end: { x: tx(b[0]), y: ty(b[1]) }, thickness: 1.3, color: BRAND });
    }
  }
  p.drawText("Croqui (geometria informada, sem escala)", { x: box.x + 6, y: box.y + 5, size: 6.5, font: doc.font, color: MUTED });
}

// ── extração robusta de camadas de enriquecimento ────────────────────────────
function layerInfo(l: { key: string; source: string | null; payload: Record<string, unknown> }) {
  const pl = l.payload || {};
  const label = String(pl.label ?? LAYER_LABELS[l.key] ?? l.key);
  const result = String(pl.result ?? "");
  const factor = Number(pl.factor ?? 1);
  return { key: l.key, label, result, factor, source: l.source ?? "" };
}

const LAYER_LABELS: Record<string, string> = {
  relevo: "Relevo / declividade",
  solo: "Solo / aptidão agrícola",
  uso: "Uso e cobertura da terra",
  clima: "Clima / regime hídrico",
  hidro: "Hidrografia",
  acesso: "Acesso viário",
  embargo: "Restrições ambientais (embargo)",
  comp: "Comparativos de mercado",
};

const PURPOSE_LABELS: Record<string, string> = {
  garantia_bancaria: "Garantia bancária",
  partilha: "Partilha / inventário",
  venda: "Compra e venda",
  judicial: "Judicial / perícia",
  itr: "ITR / fiscal",
  arrendamento: "Arrendamento",
  cpr: "CPR / crédito rural",
  outro: "Outro",
};

// Finalidades para as quais a boa prática pericial e a jurisprudência recomendam buscar
// o Grau III (Rigoroso): perícias judiciais, desapropriações e operações complexas.
// (A NBR 14.653 não vincula grau a finalidade; o grau decorre dos dados e do tratamento.)
const RIGOROUS_PURPOSES = new Set(["judicial"]);

// ── Grau de Fundamentação (NBR 14.653): tabela-referência de graus de precisão ──
// A quantidade de "dados de mercado efetivamente utilizados" e o tratamento aplicado
// enquadram o laudo em um dos três graus. O enquadramento definitivo é ato do RT.
interface FundGrade { g: string; nome: string; amostras: string; uso: string }
const FUND_GRADES: FundGrade[] = [
  { g: "I", nome: "Expedito", amostras: "3 a 5",
    uso: "Estimativas rápidas; maior margem de erro." },
  { g: "II", nome: "Normal", amostras: "5 a 6",
    uso: "Garantias bancárias e inventários; dados validados pelo profissional." },
  { g: "III", nome: "Rigoroso", amostras: "12 a 18",
    uso: "Ações judiciais, desapropriações e operações complexas; maior quantidade de dados e rigor de identificação e ajuste. A inferência estatística, quando adotada, habilita o grau de precisão." },
];

/** Grau de fundamentação sugerido a partir do nº de dados de mercado (informativo). */
function suggestFundGrade(n: number): string {
  if (n >= 12) return "III";
  if (n >= 5) return "II";
  if (n >= 3) return "I";
  return "";
}

// ── Anexo: classes de capacidade de uso do solo (SBCS, adaptado de Lepsch) ──────
// Referência técnica fixa citada na caracterização do bem (NBR 14.653-1, item 9-d);
// oito classes agrupadas (A cultiváveis, B pastagem/reflorestamento, C preservação).
interface SoilClass { classe: string; grupo: string; desc: string }
const SOIL_CLASSES: SoilClass[] = [
  { classe: "I", grupo: "A",
    desc: "Cultiváveis, sem problemas especiais de conservação. Grãos com altas produtividades." },
  { classe: "II", grupo: "A",
    desc: "Cultiváveis com problemas simples de conservação. Grãos com produtividades acima da média." },
  { classe: "III", grupo: "A",
    desc: "Cultiváveis com problemas complexos de conservação. Grãos com produtividades médias." },
  { classe: "IV", grupo: "A",
    desc: "Cultiváveis ocasionalmente ou em extensão limitada, com sérios problemas de conservação. Grãos (médias) e pastagem para gado de leite." },
  { classe: "V", grupo: "B",
    desc: "Pastagens e/ou reflorestamento sem prática especial; cultiváveis só em casos muito especiais. Áreas alagáveis não sistematizadas." },
  { classe: "VI", grupo: "B",
    desc: "Pastagens e/ou reflorestamento com problemas simples; culturas permanentes protetoras. Pastagem de corte em áreas planas a suave onduladas, porém frágeis." },
  { classe: "VII", grupo: "B",
    desc: "Pastagens ou reflorestamento com problemas complexos. Pastagens degradadas ou declivosas e reflorestamentos." },
  { classe: "VIII", grupo: "C",
    desc: "Impróprias para cultura, pastagem ou reflorestamento; abrigo e proteção da fauna e flora, recreação ou armazenamento de água. Vegetação natural." },
];

// ── seção: documentação utilizada (NBR 14.653-1, item 9-e) ────────────────────
// Lista objetiva dos documentos que embasaram a avaliação (origem da geometria, CAR,
// ART e, quando enviada, a matrícula com o resultado da triagem de ônus da Frente E).
function renderDocumentos(
  doc: Doc,
  args: { origin: string | null; carCode: string; artNumber: string; matricula: Bundle["matricula"] },
  sec: string,
): void {
  doc.heading(sec, "Documentação utilizada");
  doc.paragraph(
    "Relação dos documentos e bases que embasaram a avaliação, para rastreabilidade e defensabilidade (NBR 14.653-1, item 9-e).",
    { size: 8.8 }
  );
  const rows: string[][] = [];
  rows.push([
    "Geometria do imóvel",
    args.origin === "car"
      ? "Perímetro do CAR/SICAR (base georreferenciada oficial)"
      : "Arquivo georreferenciado informado pelo solicitante",
  ]);
  rows.push(["Cadastro Ambiental Rural (CAR)", args.carCode && args.carCode !== "-" ? args.carCode : "Não informado"]);
  rows.push(["ART - Anotação de Responsabilidade Técnica", args.artNumber || "A informar pelo responsável técnico"]);

  const mats = Array.isArray(args.matricula) ? args.matricula : [];
  if (mats.length) {
    mats.forEach((m, i) => {
      const rec = m as Record<string, unknown>;
      const nP = Number(rec.n_passivos ?? 0);
      const nA = Number(rec.n_ativos ?? 0);
      const metodo = rec.leitura
        ? rec.ocr === true
          ? "OCR + leitura assistida e regras"
          : "leitura assistida e regras"
        : "triagem automática por regras";
      const resumo = nP === 0
        ? `Sem ônus/gravame aparente na triagem (${metodo})`
        : `${nP} apontamento(s), ${nA} possivelmente ativo(s) (${metodo})`;
      // não ecoa o nome do arquivo enviado (pode conter PII); rótulo genérico + índice
      rows.push([`Matrícula do imóvel${mats.length > 1 ? ` (documento ${i + 1})` : ""}`, resumo]);
    });
  } else {
    rows.push(["Matrícula do imóvel", "Não anexada / análise dominial a cargo do responsável técnico"]);
  }
  doc.table(["Documento", "Descrição / situação"], rows, [0.34, 0.66]);

  // Leitura contextual da matrícula mais recente que tenha uma. Só fato técnico: a
  // extração é instruída e saneada para não trazer nome, CPF nem endereço de pessoas,
  // e os confrontantes entram como QUANTIDADE, nunca como identificação.
  const comLeitura = mats.find((m) => (m as Record<string, unknown>).leitura) as
    | Record<string, unknown>
    | undefined;
  if (comLeitura) renderLeituraMatricula(doc, comLeitura);

  if (mats.length) {
    const temLlm = mats.some((m) => (m as Record<string, unknown>).leitura);
    doc.paragraph(
      temLlm
        ? "A leitura da matrícula é automática (transcrição e interpretação assistidas por IA, conferidas por regras) e não substitui a análise jurídica; a leitura dominial definitiva é do responsável técnico, que confere o documento original."
        : "A triagem de ônus da matrícula é automática (por regras) e não substitui a análise jurídica; a leitura dominial definitiva é do responsável técnico.",
      { size: 8, color: MUTED }
    );
  }
}

/** Tabela "o que a matrícula diz", a partir da leitura estruturada (sem PII). */
function renderLeituraMatricula(doc: Doc, analise: Record<string, unknown>): void {
  const L = analise.leitura as Record<string, unknown>;
  const rows: string[][] = [];
  const add = (label: string, v: unknown) => {
    const s = typeof v === "string" ? v.trim() : v === null || v === undefined ? "" : String(v);
    if (s) rows.push([label, s]);
  };
  const simNao = (v: unknown) => (v === true ? "Sim" : v === false ? "Não" : "");

  const numero = L.matricula_numero as string | null;
  const cartorio = L.cartorio as string | null;
  add("Matrícula", [numero ? `nº ${numero}` : "", cartorio].filter(Boolean).join(" - "));
  add("Município / UF", L.municipio_uf);
  add("Denominação do imóvel", L.denominacao);

  const areaHa = typeof L.area_registrada_ha === "number" ? L.area_registrada_ha : null;
  const areaTxt = (L.area_texto as string | null) ?? "";
  add(
    "Área registrada",
    areaHa !== null
      ? `${fmtNum(areaHa, 4)} ha${areaTxt ? ` (na matrícula: ${areaTxt})` : ""}`
      : areaTxt
  );
  add("Georreferenciamento (INCRA)", simNao(L.georreferenciada));
  add("Confrontantes citados", typeof L.confrontantes_n === "number" ? `${L.confrontantes_n}` : "");
  add("Transmissões registradas", typeof L.transmissoes_n === "number" ? `${L.transmissoes_n}` : "");

  const rlDet = (L.reserva_legal_detalhe as string | null) ?? "";
  const rlAv = simNao(L.reserva_legal_averbada);
  add("Reserva legal averbada", [rlAv, rlDet].filter(Boolean).join(rlAv && rlDet ? " - " : ""));

  const onus = Array.isArray(L.onus) ? (L.onus as Array<Record<string, unknown>>) : [];
  const ativos = onus.filter((o) => o.status === "ativo");
  const indet = onus.filter((o) => o.status === "indeterminado");
  const descOnus = (o: Record<string, unknown>) =>
    `${String(o.tipo ?? "")}${o.ato ? ` (${String(o.ato)})` : ""}`;
  add("Ônus/gravames ativos", ativos.length ? ativos.map(descOnus).join("; ") : onus.length ? "Nenhum" : "");
  if (indet.length) add("Situação indeterminada", indet.map(descOnus).join("; "));
  add("Observações", L.observacoes);

  if (!rows.length) return;
  doc.paragraph("Leitura da matrícula (extração automática):", { size: 8.8 });
  doc.table(["Elemento", "Constatação"], rows, [0.34, 0.66]);

  // Regras e LLM são camadas independentes: segunda opinião só serve se a DIVERGÊNCIA
  // aparecer. Sem isto o laudo imprimiria dois números contraditórios sobre o mesmo
  // documento, lado a lado, sem dizer que discordam.
  const nAtivosRegras = Number(analise.n_ativos ?? 0);
  if ((nAtivosRegras > 0) !== (ativos.length > 0)) {
    doc.paragraph(
      `Atenção: as duas camadas de triagem divergem sobre este documento (regras: ${nAtivosRegras} ônus ativo(s); ` +
        `leitura assistida: ${ativos.length}). Conferência do responsável técnico na matrícula original é indispensável.`,
      { size: 8, color: MUTED }
    );
  }

  // A confiança precisa aparecer: uma digitalização ruim produz leitura fraca, e quem
  // assina o laudo tem que saber quando desconfiar dela.
  const conf = String(L.confianca ?? "");
  if (conf && conf !== "alta") {
    doc.paragraph(
      conf === "baixa"
        ? "Atenção: confiança BAIXA na leitura automática (documento pouco legível). Confira a matrícula original antes de usar estes dados."
        : "Confiança média na leitura automática; recomenda-se conferência na matrícula original.",
      { size: 8, color: MUTED }
    );
  }
}

// ── seção: memória de cálculo e especificação da avaliação (NBR 9-h, 9-j) ──────
// Consolida o tratamento estatístico (saneamento + IC80 + CV) como memória de cálculo
// e apresenta a tabela dos graus de fundamentação/precisão, com o enquadramento
// sugerido pelo nº de dados de mercado e o alerta de Grau III para finalidades rigorosas.
function renderEspecificacao(
  doc: Doc,
  args: {
    sec: string;
    nComps: number;
    nSan: number | null;
    nOut: number | null;
    precisao: string;
    cvPct: number | null;
    ic80Low: number | null;
    ic80High: number | null;
    grade: string;
    purposeKey: string;
  },
): void {
  doc.heading(args.sec, "Memória de cálculo e especificação da avaliação");

  // memória de cálculo (9-h): descreve o caminho do valor central e da faixa
  const memParts: string[] = [];
  memParts.push(
    `O valor unitário resulta do preço-base regional homogeneizado pelos fatores da seção anterior sobre ${args.nComps} dado(s) de mercado.`
  );
  if (args.nSan != null && args.nComps >= 3) {
    memParts.push(
      `Aplicou-se o critério de Chauvenet para saneamento da amostra (${args.nSan} dado(s) mantido(s)${args.nOut ? `, ${args.nOut} excluído(s) como discrepante(s)` : ", nenhum excluído"}).`
    );
  }
  if (args.precisao) {
    const icTxt = args.ic80Low != null && args.ic80High != null
      ? ` (${fmtBRL(args.ic80Low)} a ${fmtBRL(args.ic80High)} no valor total)`
      : "";
    memParts.push(
      `A dispersão foi medida pelo coeficiente de variação${args.cvPct != null ? ` (CV ${args.cvPct.toFixed(1)}%)` : ""} e por intervalo de confiança de 80% pela distribuição t de Student${icTxt}.`
    );
  } else if (args.nComps < 3) {
    memParts.push(
      "Com menos de três dados de mercado não se aplica tratamento estatístico inferencial; a faixa apresentada é comercial (heurística), sem enquadramento de precisão."
    );
  }
  doc.paragraph(memParts.join(" "), { size: 8.8 });

  // especificação (9-j): tabela de graus + enquadramento
  doc.paragraph("Graus de fundamentação e precisão (NBR 14.653)", { font: doc.bold, size: 9.5, gap: 2 });
  doc.table(
    ["Grau", "Denominação", "Nº de dados", "Aplicação típica"],
    FUND_GRADES.map((f) => [`Grau ${f.g}`, f.nome, f.amostras, f.uso]),
    [0.1, 0.15, 0.15, 0.6],
    ["l", "l", "l", "l"]
  );
  doc.paragraph(
    "As denominações (Expedito/Normal/Rigoroso) e as faixas de quantidade são referência didática usual; a NBR 14.653 identifica os graus como I, II e III e fixa a quantidade mínima de dados (respectivamente 3, 5 e 12 no tratamento por fatores) além da pontuação de fundamentação. O grau efetivo é enquadrado pelo responsável técnico.",
    { size: 8, color: MUTED }
  );

  const sug = suggestFundGrade(args.nComps);
  const especLinhas: [string, string][] = [];
  especLinhas.push(["Dados de mercado efetivamente utilizados", `${args.nComps}`]);
  especLinhas.push([
    "Grau de fundamentação (RT)",
    args.grade ? `Grau ${args.grade}` : (sug ? `sugerido Grau ${sug} pelo nº de dados; a enquadrar pelo RT` : "a enquadrar pelo responsável técnico"),
  ]);
  if (args.precisao) {
    especLinhas.push(["Grau de precisão (calculado)", `Grau ${args.precisao}${args.cvPct != null ? ` - CV ${args.cvPct.toFixed(1)}%` : ""}`]);
  }
  doc.kv(especLinhas);

  if (RIGOROUS_PURPOSES.has(args.purposeKey)) {
    const atendeIII = (args.grade && args.grade.toUpperCase() === "III") || args.precisao === "III";
    doc.paragraph(
      atendeIII
        ? "Para uso judicial (perícia / desapropriação / operações complexas), a boa prática pericial e a jurisprudência recomendam o Grau III (Rigoroso), com maior quantidade de dados (tipicamente 12 a 18) e rigor de tratamento. Confirme o enquadramento no ato da assinatura."
        : "Atenção: para uso judicial (perícia / desapropriação / operações complexas), a boa prática pericial e a jurisprudência recomendam buscar o Grau III (Rigoroso), com maior quantidade de dados (tipicamente 12 a 18) e rigor de tratamento. O enquadramento no grau decorre dos dados e do tratamento e é ato do responsável técnico; a amostra atual pode ser insuficiente. Amplie a pesquisa de dados de mercado antes de firmar o laudo para uso judicial.",
      { size: 8.5, color: !atendeIII ? ACCENT : MUTED }
    );
  }
}

// ── anexo: classes de capacidade de uso do solo (SBCS / Lepsch) ────────────────
function renderClassesSolo(doc: Doc): void {
  // n vazio: "Anexo I" é largo demais para o recuo fixo de heading() e sobreporia o título
  doc.heading("", "Anexo I - Classes de capacidade de uso do solo");
  doc.paragraph(
    "Referência para a caracterização agronômica do bem (NBR 14.653-1, item 9-d). Sistema de capacidade de uso das terras (SBCS, adaptado de Lepsch), amplamente difundido no Brasil; a Classe V é de uso bastante restrito pela legislação. As demais classes orientam a aptidão e a produtividade esperadas.",
    { size: 8.8 }
  );
  // parágrafos (não doc.table): a descrição excede a largura da célula e seria truncada com ".."
  for (const s of SOIL_CLASSES) {
    doc.paragraph(`Classe ${s.classe} - Grupo ${s.grupo}`, { font: doc.bold, size: 8.8, gap: 1 });
    doc.paragraph(s.desc, { size: 8.5, gap: 5 });
  }
  doc.paragraph(
    "Grupo A: terras cultiváveis (Classes I a IV). Grupo B: adaptadas a pastagem e/ou reflorestamento (Classes V a VII). Grupo C: preservação da fauna e flora (Classe VIII).",
    { size: 8, color: MUTED }
  );
}

// ── seção de sinais: aptidão, escoamento e conformidade (tese de investimento) ──
// Retorna true se desenhou a seção (para o chamador numerar a seção seguinte).
function renderSignals(doc: Doc, signals: Bundle["signals"], sec: string): boolean {
  if (!signals) return false;
  const via = signals.viability as Record<string, unknown> | null | undefined;
  const zarc = signals.zarc as Record<string, unknown> | null | undefined;
  const logi = signals.logistics as Record<string, unknown> | null | undefined;
  const outo = signals.outorgas as Record<string, unknown> | null | undefined;
  const comp = signals.compliance as Record<string, unknown> | null | undefined;
  const amen = signals.amenities as Record<string, unknown> | null | undefined;
  const spread = signals.spread as Record<string, unknown> | null | undefined;

  const hasAny =
    (via && (via.atividades as unknown[])?.length) ||
    (zarc && (zarc.culturas as unknown[])?.length) ||
    (logi && logi.available) ||
    (outo && outo.available) ||
    (comp && comp.available) ||
    (amen && amen.available) ||
    (spread && spread.available);
  if (!hasAny) return false;

  doc.heading(sec, "Aptidão, escoamento e conformidade");
  doc.paragraph(
    "Fatores de contexto econômico e socioambiental do imóvel, apurados sobre dados públicos abertos na data-base. Complementam o valor de mercado com a leitura de vocação produtiva, logística de escoamento e conformidade regulatória (relevante para protocolos de mercado e crédito).",
    { size: 8.8 }
  );

  // 8.1 Vocação e viabilidade por atividade (Frente H)
  const ativ = (via?.atividades as Array<Record<string, unknown>>) ?? [];
  if (ativ.length) {
    doc.paragraph("Vocação e viabilidade por atividade", { font: doc.bold, size: 9.5, gap: 2 });
    doc.table(
      ["Atividade", "Viab.", "R$/ha bruto", "Comprador (estrada est.)"],
      ativ.map((a) => {
        const km = a.destino_estrada_km ?? a.destino_km;
        const tempo = a.destino_tempo_min != null ? `, ~${a.destino_tempo_min} min` : "";
        const dest = a.destino_municipio ?? a.destino ?? "-";
        return [
          String(a.label ?? a.cadeia ?? "-"),
          `${a.score}/100`,
          a.receita_ha != null ? fmtBRL(Number(a.receita_ha)) : "-",
          a.destino ? `${dest} (${km} km${tempo})` : "não cadastrado",
        ];
      }),
      [0.24, 0.12, 0.2, 0.44],
      ["l", "r", "r", "l"]
    );
    doc.paragraph(
      "Viabilidade = acesso ao comprador (distância por estrada estimada) × aptidão (grãos pelo ZARC; demais pela tolerância a solo/relevo). R$/ha = receita bruta potencial de referência (produtividade × preço regional), não margem líquida.",
      { size: 8, color: MUTED }
    );
  }

  // 8.2 Aptidão climática ZARC (Frente I)
  const culturas = (zarc?.culturas as Array<Record<string, unknown>>) ?? [];
  if (culturas.length) {
    doc.paragraph("Aptidão climática (ZARC / MAPA)", { font: doc.bold, size: 9.5, gap: 2 });
    doc.table(
      ["Cultura", "Decêndios com risco 20%", "Janela de plantio"],
      culturas.slice(0, 6).map((c) => [
        String(c.cultura ?? "-"),
        `${c.n_dec20 ?? 0}`,
        String(c.janela ?? "-"),
      ]),
      [0.32, 0.28, 0.4],
      ["l", "r", "l"]
    );
  }

  // 8.3 Escoamento (Frente H)
  if (logi?.available) {
    const nearest = (logi.nearest as Array<Record<string, unknown>>) ?? [];
    const road = logi.armazem_estrada_km;
    const tempo = logi.armazem_tempo_min;
    const distTxt = road != null
      ? `${road} km${tempo != null ? ` (~${tempo} min)` : ""} por estrada`
      : nearest[0] ? `${nearest[0].dist_km} km` : "-";
    doc.kv([
      ["Escoamento de grãos - armazém mais próximo",
        nearest[0] ? `${nearest[0].municipio ?? nearest[0].name} - ${distTxt}` : "-"],
      ["Capacidade de armazenagem em 50 km",
        logi.cap_50km_t != null ? `${Math.round(Number(logi.cap_50km_t) / 1000)} mil t (${logi.n_50km ?? 0} armazéns)` : "-"],
      ["Distância ao porto de Paranaguá",
        logi.port_dist_km != null ? `${logi.port_dist_km} km (linha reta)` : "-"],
    ]);
    const graos = (logi.graos as Array<Record<string, unknown>>) ?? [];
    if (graos.length) {
      doc.table(
        ["Grão", "Preço regional", "Frete ao armazém (est.)"],
        graos.map((g) => [
          String(g.produto ?? "").replace(/ tipo 1$/, ""),
          `${fmtBRL(Number(g.preco))}/${String(g.unidade ?? "").replace("saca 60 kg", "sc")}`,
          g.frete_ate_armazem != null
            ? `${fmtBRL(Number(g.frete_ate_armazem))}/sc${g.frete_pct != null ? ` (${g.frete_pct}%)` : ""}`
            : "-",
        ]),
        [0.34, 0.33, 0.33],
        ["l", "r", "r"]
      );
    }
  }

  // 8.4 Água e mineração (Frente J)
  if (outo?.available) {
    const agua = outo.agua as Record<string, unknown> | null;
    const min = outo.mineracao as Record<string, unknown> | null;
    const linhas: [string, string][] = [];
    if (agua && Number(agua.n_2km) > 0) {
      linhas.push(["Outorgas de água no entorno (2 km)",
        `${agua.n_2km} uso(s)${agua.vazao_m3h_2km ? ` · ${agua.vazao_m3h_2km} m³/h` : ""}`]);
    }
    if (min && Number(min.n_intersecta) > 0) {
      linhas.push(["Processos minerários incidentes na área",
        `${min.n_intersecta} (ANM/SIGMINE) - verificar direitos de terceiro`]);
    } else if (min && Number(min.n_2km) > 0) {
      linhas.push(["Processos minerários no entorno (2 km)", `${min.n_2km}`]);
    }
    if (linhas.length) {
      doc.paragraph("Direitos de água e mineração", { font: doc.bold, size: 9.5, gap: 2 });
      doc.kv(linhas);
    }
  }

  // 8.5 Conformidade socioambiental / EUDR (Frente K)
  if (comp?.available) {
    const hits = (comp.intersecta as Array<Record<string, unknown>>) ?? [];
    const urb = comp.urbano as Record<string, unknown> | null;
    doc.paragraph("Conformidade socioambiental (EUDR)", { font: doc.bold, size: 9.5, gap: 2 });
    if (hits.length) {
      doc.table(
        ["Restrição", "Descrição"],
        hits.slice(0, 6).map((h) => [
          String(h.kind === "uc" ? "Unidade de Conservação" : h.kind === "ti" ? "Terra Indígena" : "Embargo IBAMA"),
          `${h.nome ?? "-"}${h.categoria ? ` (${h.categoria})` : ""}`,
        ]),
        [0.3, 0.7],
        ["l", "l"]
      );
    } else {
      doc.paragraph(
        "Nenhuma Unidade de Conservação, Terra Indígena ou embargo IBAMA sobrepõe a área nas bases consultadas (screening preliminar; não substitui certidões).",
        { size: 8.8 }
      );
    }
    if (urb?.dentro) {
      doc.paragraph(
        `Atenção: área dentro de perímetro urbano (${urb.perimetro ?? urb.municipio}); a metodologia rural NBR 14.653-3 pode não se aplicar integralmente.`,
        { size: 8.5, color: MUTED }
      );
    }
  }

  // 8.6 Pontos de atração / fator locacional (Frente L)
  if (amen?.available) {
    const fator = Number(amen.fator_sugerido ?? 0);
    const itens = (amen.destaques as Array<Record<string, unknown>>) ?? [];
    doc.paragraph("Atratividade locacional (campo de arbítrio)", { font: doc.bold, size: 9.5, gap: 2 });
    const linhas: [string, string][] = [];
    if (amen.cidade_polo) linhas.push(["Cidade-polo mais próxima", String(amen.cidade_polo)]);
    if (itens.length) linhas.push(["Atrativos turísticos/cênicos (15 km)", itens.map((i) => String(i.tipo ?? "")).join(", ")]);
    linhas.push(["Fator locacional sugerido (ABNT, até +15%)", `+${(fator * 100).toFixed(0)}%`]);
    doc.kv(linhas);
    doc.paragraph(
      "Fator de valorização locacional sugerido dentro do campo de arbítrio da NBR 14.653; sua aplicação é decisão fundamentada do responsável técnico.",
      { size: 8, color: MUTED }
    );
  }

  // 8.7 Spread da terra (terra como classe de ativo)
  if (spread?.available) {
    const ref = (spread.ref as Record<string, unknown>) ?? {};
    const pct = (x: unknown) => (x == null ? "-" : `${(Number(x) * 100).toFixed(1)}% a.a.`);
    doc.paragraph("A terra como classe de ativo (spread)", { font: doc.bold, size: 9.5, gap: 2 });
    doc.table(
      ["Indicador", "Valorização/rendimento nominal"],
      [
        [`Terra na região (${String(spread.periodo_recente ?? "")})`, pct(spread.cagr_recente)],
        ["CDI (renda fixa, referência)", pct(ref.cdi)],
        ["IPCA (inflação, referência)", pct(ref.ipca)],
        ["Poupança (referência)", pct(ref.poupanca)],
      ],
      [0.6, 0.4],
      ["l", "r"]
    );
    doc.paragraph(String(spread.nota ?? ""), { size: 8, color: MUTED });
  }
  return true;
}

// ── seção: vistoria in loco (Frente F, art. II.11) ────────────────────────────
const ESTADO_LABEL: Record<string, string> = {
  otimo: "Ótimo", bom: "Bom", regular: "Regular", ruim: "Ruim", na: "Não se aplica",
};

function renderVisit(doc: Doc, visit: Bundle["field_visit"], sec: string): boolean {
  if (!visit) return false;
  const v = visit as Record<string, unknown>;
  // sem nenhum dado preenchido, não renderiza
  const benf = Array.isArray(v.benfeitorias) ? (v.benfeitorias as Array<Record<string, unknown>>) : [];
  const hasAny = v.visited_at || v.area_confirmada != null || v.estado_conservacao ||
    v.uso_observado || v.acesso_observado || v.recursos_hidricos || v.ressalvas || benf.length;
  if (!hasAny) return false;

  doc.heading(sec, "Vistoria in loco");
  doc.paragraph(
    "Inspeção presencial do imóvel pelo responsável técnico (NBR 14.653), verificando área, benfeitorias, estado de conservação e uso, atendendo à exigência de vistoria das instituições de crédito.",
    { size: 8.8 }
  );

  const kv: [string, string][] = [];
  if (v.visited_at) kv.push(["Data da vistoria", fmtDate(String(v.visited_at))]);
  if (v.area_confirmada != null) {
    kv.push(["Área confirmada em campo",
      (v.area_confirmada ? "Sim" : "Não") + (v.area_observacao ? ` - ${String(v.area_observacao)}` : "")]);
  }
  if (v.estado_conservacao) kv.push(["Estado de conservação", ESTADO_LABEL[String(v.estado_conservacao)] ?? String(v.estado_conservacao)]);
  if (v.uso_observado) kv.push(["Uso observado", String(v.uso_observado)]);
  if (v.acesso_observado) kv.push(["Acesso observado", String(v.acesso_observado)]);
  if (v.recursos_hidricos) kv.push(["Recursos hídricos", String(v.recursos_hidricos)]);
  if (kv.length) doc.kv(kv);

  if (benf.length) {
    doc.paragraph("Benfeitorias identificadas", { font: doc.bold, size: 9.5, gap: 2 });
    doc.table(
      ["Tipo", "Descrição", "Área", "Estado"],
      benf.slice(0, 30).map((b) => [
        String(b.tipo ?? "-"),
        String(b.descricao ?? "-"),
        b.area_m2 != null && b.area_m2 !== "" ? `${b.area_m2} m²` : "-",
        b.estado ? (ESTADO_LABEL[String(b.estado)] ?? String(b.estado)) : "-",
      ]),
      [0.22, 0.46, 0.14, 0.18],
      ["l", "l", "r", "l"]
    );
  }

  if (v.ressalvas) {
    doc.paragraph("Ressalvas da vistoria", { font: doc.bold, size: 9.5, gap: 2 });
    doc.paragraph(String(v.ressalvas), { size: 8.8 });
  }
  return true;
}

// ── seção: relatório fotográfico (art. II.7; imagens da vistoria) ─────────────
async function renderPhotos(doc: Doc, photos: Bundle["photos"], sec: string): Promise<boolean> {
  const list = (photos ?? []).filter((p) => p?.bytes?.length);
  if (!list.length) return false;

  doc.heading(sec, "Relatório fotográfico");
  doc.paragraph(
    "Registro fotográfico da vistoria e caracterização do imóvel (NBR 14.653), com imagens nítidas, atendendo à exigência de relatório fotográfico das instituições de crédito.",
    { size: 8.8 }
  );

  const gap = 12;
  const cellW = (PW - 2 * M - gap) / 2;
  const imgH = cellW * 0.7;
  const capH = 15;

  for (let i = 0; i < list.length; i += 2) {
    doc.ensure(imgH + capH + gap);
    const rowTop = doc.y;
    for (let c = 0; c < 2 && i + c < list.length; c++) {
      const ph = list[i + c];
      const b = ph.bytes;
      let img;
      try {
        if (b[0] === 0xff && b[1] === 0xd8) img = await doc.pdf.embedJpg(b);
        else if (b[0] === 0x89 && b[1] === 0x50) img = await doc.pdf.embedPng(b);
        else continue;
      } catch (_) {
        continue; // imagem corrompida: pula a célula
      }
      const x = M + c * (cellW + gap);
      const scale = Math.min(cellW / img.width, imgH / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      doc.page.drawRectangle({ x, y: rowTop - imgH, width: cellW, height: imgH, borderColor: LINE, borderWidth: 0.6, color: rgb(0.98, 0.98, 0.98) });
      doc.page.drawImage(img, { x: x + (cellW - w) / 2, y: rowTop - imgH + (imgH - h) / 2, width: w, height: h });
      const cap = ph.caption ? san(ph.caption) : `Foto ${i + c + 1}`;
      doc.page.drawText(cap.slice(0, 74), { x, y: rowTop - imgH - 11, size: 7.2, font: doc.font, color: MUTED });
    }
    doc.y = rowTop - imgH - capH;
  }
  return true;
}

// ── documento ────────────────────────────────────────────────────────────────
export async function buildLaudoPdf(bundle: Bundle): Promise<Uint8Array> {
  const doc = await Doc.create();
  const prop = bundle.property;
  const est = (bundle.estimate ?? {}) as Record<string, unknown>;
  const rep = (bundle.report ?? {}) as Record<string, unknown>;
  const tech = bundle.technician ?? {};
  const req = (bundle.request ?? {}) as Record<string, unknown>;

  const reqId = String(req.id ?? "");
  const shortId = reqId.slice(0, 8).toUpperCase();
  // Grau de Fundamentação é enquadramento do responsável técnico; sem ele o laudo
  // não afirma grau nenhum (nada de default silencioso)
  const grade = rep.grade ? String(rep.grade) : "";
  const artNumber = String(rep.art_number ?? "");
  const genAt = new Date().toISOString();
  const modelVersion = String(est.model_version ?? "homog-nbr-0.5.0");
  // Tratamento estatístico (Frente D): saneamento Chauvenet + IC 80% -> Grau de Precisão.
  const precisao = String(est.grau_precisao ?? "").toUpperCase();
  const cvPct = est.cv != null ? Number(est.cv) * 100 : null;
  const nSan = est.n_sanitized != null ? Number(est.n_sanitized) : null;
  const nOut = est.n_outliers != null ? Number(est.n_outliers) : null;
  const ic80Low = est.ic80_low != null ? Number(est.ic80_low) : null;
  const ic80High = est.ic80_high != null ? Number(est.ic80_high) : null;

  const total = Number(rep.final_total ?? est.total_avg ?? 0);
  const areaHa = Number(prop.area_ha ?? 0);
  // R$/ha reconciliado com o total CONCLUÍDO: o laudo nunca quebra total = R$/ha x área
  const ppha = areaHa > 0 && total > 0
    ? total / areaHa
    : Number(rep.final_price_per_ha ?? est.price_per_ha_avg ?? 0);

  // Campo de arbítrio (NBR 14.653): ±15% em torno da estimativa central do MODELO
  // (persistido pelo motor), nunca do valor concluído - senão o arbitrado jamais
  // cai fora do próprio campo.
  const estTotalAvg = Number(est.total_avg ?? 0);
  const totalMin = est.arbitrio_low != null
    ? Number(est.arbitrio_low)
    : (estTotalAvg > 0 ? estTotalAvg * 0.85 : total * 0.85);
  const totalMax = est.arbitrio_high != null
    ? Number(est.arbitrio_high)
    : (estTotalAvg > 0 ? estTotalAvg * 1.15 : total * 1.15);

  const locality = `${prop.municipality ?? "-"}${prop.uf ? "/" + prop.uf : ""}`;
  const purposeKey = String(req.purpose ?? "outro");
  const purpose = PURPOSE_LABELS[purposeKey] ?? purposeKey;

  const hash = (await sha256Hex(JSON.stringify({
    reqId, area: prop.area_ha, ppha, total, grade, artNumber, model: modelVersion,
    comps: bundle.comparables.length, centroid: prop.centroid,
  }))).slice(0, 16);

  const verifCode = bundle.verification?.code ?? "";
  doc.footer = `Laudo ${shortId} - gerado em ${genAt.slice(0, 19).replace("T", " ")} UTC - modelo ${modelVersion} - hash ${hash}${verifCode ? ` - verificacao ${verifCode}` : ""}`;

  // ── CAPA ──
  doc.newPage();
  const p = doc.page;
  p.drawRectangle({ x: 0, y: PH - 150, width: PW, height: 150, color: BRAND });
  p.drawText("VALOR DE TERRAS", { x: M, y: PH - 58, size: 13, font: doc.bold, color: rgb(1, 1, 1) });
  p.drawText(san("Avaliação de imóveis rurais com dados abertos"), { x: M, y: PH - 74, size: 8.5, font: doc.font, color: rgb(0.85, 0.92, 0.87) });
  p.drawText(san("Laudo de Avaliação de Imóvel Rural"), { x: M, y: PH - 108, size: 19, font: doc.bold, color: rgb(1, 1, 1) });
  p.drawText(san("ABNT NBR 14.653-1 / 14.653-3 - Método comparativo direto de dados de mercado"), { x: M, y: PH - 128, size: 8.5, font: doc.font, color: rgb(0.9, 0.95, 0.91) });

  doc.y = PH - 172;
  // faixa do grau
  p.drawRectangle({ x: M, y: doc.y - 26, width: PW - 2 * M, height: 30, color: BG, borderColor: LINE, borderWidth: 1 });
  let fundTxt = grade
    ? `Fundamentação NBR 14.653-3: Grau ${grade}`
    : "Fundamentação NBR 14.653-3: a enquadrar pelo RT";
  if (precisao) fundTxt += ` - Precisão Grau ${precisao}`;
  if (cvPct != null) fundTxt += ` - CV ${cvPct.toFixed(1)}%`;
  // trunca para nunca colidir com o rótulo "Laudo No" à direita
  const fundMaxW = (PW - M - 120) - (M + 10) - 8;
  let fundStr = san(fundTxt);
  while (fundStr.length > 4 && doc.bold.widthOfTextAtSize(fundStr + "..", 8) > fundMaxW) fundStr = fundStr.slice(0, -1);
  if (fundStr !== san(fundTxt)) fundStr += "..";
  p.drawText(fundStr, { x: M + 10, y: doc.y - 15, size: 8, font: doc.bold, color: BRAND });
  p.drawText(san(`Laudo No ${shortId}`), { x: PW - M - 120, y: doc.y - 15, size: 10, font: doc.bold, color: INK });
  doc.y -= 44;

  // metadados da capa
  const coverKV: [string, string][] = [
    ["Imóvel / denominação", req.contact_name ? `Solicitante: ${req.contact_name}` : `Imóvel em ${locality}`],
    ["Município / UF", locality],
    ["Área (medida sobre a geometria)", `${fmtNum(prop.area_ha, 4)} ha  (perímetro ${fmtNum(prop.perimeter_km, 3)} km)`],
    ["Código CAR", String(prop.car_code ?? "-")],
    ["Finalidade da avaliação", purpose],
    ["Data-base", fmtDate(genAt)],
    ["ART", artNumber || "(a informar)"],
  ];
  doc.kv(coverKV);

  // croqui
  doc.ensure(210);
  drawSketch(doc, prop.geometry, { x: M, y: doc.y - 200, w: PW - 2 * M, h: 200 });
  doc.y -= 210;

  // ── 1. Objeto e finalidade ──
  doc.newPage();
  doc.heading("1", "Objeto e finalidade");
  doc.paragraph(
    `O presente laudo tem por objeto a determinação do valor de mercado do imóvel rural situado em ${locality}, com área de ${fmtNum(prop.area_ha, 4)} ha medida sobre a geometria informada (${prop.origin === "car" ? "CAR real do SICAR" : "arquivo georreferenciado"}). A finalidade declarada é: ${purpose}. Adota-se o método comparativo direto de dados de mercado, com tratamento por fatores, conforme a ABNT NBR 14.653-1 e 14.653-3.`
  );

  // ── 2. Identificação ──
  doc.heading("2", "Identificação do imóvel e do solicitante");
  const contactName = String(req.contact_name ?? "");
  const contactEmail = String(req.contact_email ?? "");
  const contactPhone = String(req.contact_phone ?? "");
  doc.kv([
    ["Município / UF", locality],
    ["Área medida (geometria)", `${fmtNum(prop.area_ha, 4)} ha`],
    ["Código CAR", String(prop.car_code ?? "-")],
    ["Centróide (lon, lat)", `${fmtNum(prop.centroid[0], 5)}, ${fmtNum(prop.centroid[1], 5)}`],
    ["Solicitante", contactName || "-"],
    ["Contato", [contactEmail, contactPhone].filter(Boolean).join("  -  ") || "-"],
  ]);

  // ── 3. Documentação utilizada (NBR 9-e) ── (renderDocumentos imprime o próprio heading)
  renderDocumentos(
    doc,
    { origin: prop.origin, carCode: String(prop.car_code ?? "-"), artNumber, matricula: bundle.matricula },
    "3",
  );

  // ── 4. Fontes de dados ──
  doc.heading("4", "Pressupostos, ressalvas e fontes de dados");
  doc.paragraph(
    "A avaliação apoia-se em dados públicos abertos, congelados na data-base (DataSnapshot) para rastreabilidade e defensabilidade. Fontes consultadas:"
  );
  const layers = bundle.enrichment.map(layerInfo).filter((l) => l.key !== "comp");
  doc.table(
    ["Camada", "Fonte", "Diagnóstico"],
    layers.map((l) => [l.label, l.source, l.result || "-"]),
    [0.22, 0.26, 0.52]
  );

  // ── 5. Diagnóstico ──
  doc.heading("5", "Caracterização e diagnóstico do imóvel");
  doc.kv(layers.map((l) => [l.label, l.result || "-"] as [string, string]));
  doc.paragraph(
    "A aptidão agronômica do bem é lida à luz das classes de capacidade de uso do solo (SBCS/Lepsch) reproduzidas no Anexo I.",
    { size: 8, color: MUTED }
  );

  // ── 6. Metodologia e justificativa do método ──
  doc.heading("6", "Metodologia e justificativa do método");
  doc.paragraph(
    "Adotou-se o método comparativo direto de dados de mercado (NBR 14.653-2/3), preferencial sempre que há dados de mercado semelhantes em quantidade e qualidade suficientes, como é o caso de imóveis rurais em região com oferta observável. Justifica-se a escolha e a não adoção dos demais métodos:"
  );
  // parágrafos (não doc.kv): kv desenha só a 1ª linha do valor e truncaria a justificativa
  const metodos: [string, string][] = [
    ["Comparativo direto (adotado)", "Confronta o bem com dados de mercado semelhantes, homogeneizados por fatores; é o método de eleição quando há amostra de mercado."],
    ["Involutivo (não adotado)", "Estima o valor pelo potencial de um empreendimento no melhor uso (receita de venda menos custos, prazo e lucro); aplica-se a glebas com vocação de incorporação/loteamento, não à terra rural em uso corrente."],
    ["Evolutivo (não adotado)", "Soma terreno, construções e benfeitorias com fator de comercialização; usa-se quando o valor das partes edificadas domina, o que não é o caso do imóvel rural avaliando."],
  ];
  for (const [label, body] of metodos) {
    doc.paragraph(label, { font: doc.bold, size: 9.2, gap: 1 });
    doc.paragraph(body, { size: 9, gap: 6 });
  }
  doc.paragraph(
    "Os elementos foram homogeneizados por fatores relativos a relevo, solo/aptidão, uso, clima, acesso e situação. Fatores aplicados:"
  );
  const factorRows = layers
    .filter((l) => Math.abs(l.factor - 1) > 1e-9)
    .map((l) => [l.label, l.result || "-", l.factor.toFixed(2)]);
  if (factorRows.length) {
    doc.table(["Atributo", "Diagnóstico", "Fator"], factorRows, [0.26, 0.56, 0.18], ["l", "l", "r"]);
  } else {
    doc.paragraph("Nenhum fator relevante desviou da unidade nesta amostra.", { color: MUTED, size: 9 });
  }

  // ── 7. Comparativos (dados de mercado) ──
  doc.heading("7", "Tratamento dos elementos comparativos");
  const comps = bundle.comparables;
  doc.paragraph(
    "Elementos comparativos (dados de mercado) tratados por homogeneização. Referência indica a fonte e o ano do dado utilizado:",
    { size: 8.8 }
  );
  doc.table(
    ["#", "Dist.", "Área", "Uso", "Referência", "R$/ha", "Homog."],
    comps.map((c, i) => [
      String(i + 1),
      `${fmtNum(c.distance_km as number, 1)} km`,
      `${fmtNum(c.area_ha as number)} ha`,
      String(c.land_use ?? "-"),
      String(c.source ?? "-"),
      fmtBRL(c.price_per_ha as number),
      fmtBRL(c.homogenized_price_per_ha as number),
    ]),
    [0.05, 0.1, 0.11, 0.22, 0.22, 0.15, 0.15],
    ["l", "r", "r", "l", "l", "r", "r"]
  );
  // Nota NBR 14.653-1, item 3.1.12: definição de "dado de mercado".
  doc.paragraph(
    "Nota (NBR 14.653-1, item 3.1.12): dado de mercado é o elemento ou informação disponível em determinado mercado, acompanhado de suas características. Pode ser obtido em anúncios regionais, sites agregadores de imóveis e leilões, entre outras fontes de referência.",
    { size: 8, color: MUTED }
  );
  let statTxt = `Dados de mercado utilizados: ${comps.length}. Fonte predominante: ${String(comps[0]?.source ?? "DERAL/SEAB-PR")}.`;
  if (nSan != null && comps.length >= 3) {
    statTxt += ` Saneamento por critério de Chauvenet: ${nSan} dado(s) mantido(s)${nOut ? `, ${nOut} excluído(s)` : ", nenhum excluído"}.`;
  }
  if (precisao) {
    const icTxt = ic80Low != null && ic80High != null
      ? `: ${fmtBRL(ic80Low)} a ${fmtBRL(ic80High)} (valor total)`
      : "";
    statTxt += ` Intervalo de confiança de 80% (t de Student)${icTxt}${cvPct != null ? `, CV ${cvPct.toFixed(1)}%` : ""}; Grau de Precisão ${precisao} conforme NBR 14.653.`;
  }
  doc.paragraph(statTxt, { size: 8.5, color: MUTED });

  // Liquidez / tempo de exposição (Frente C): "tempo e expectativa" para realizar o valor.
  const liq = bundle.liquidity as Record<string, unknown> | null | undefined;
  if (liq && Number(liq.n ?? 0) >= 3 && liq.mediana_dias != null) {
    const escopo = String(liq.escopo ?? "");
    const escopoTxt = escopo === "municipio" ? "no município" : escopo === "uf" ? "no estado (faixa de área)" : "no estado";
    const meses = Math.round((Number(liq.mediana_dias) / 30) * 10) / 10;
    const inativos = liq.taxa_inativos != null ? ` Cerca de ${Math.round(Number(liq.taxa_inativos) * 100)}% dos anúncios saíram do ar sem confirmação de venda.` : "";
    doc.paragraph("Liquidez e tempo de exposição de mercado", { font: doc.bold, size: 9.5, gap: 2 });
    doc.paragraph(
      `A mediana de tempo de anúncio de imóveis semelhantes ${escopoTxt} é de ${Math.round(Number(liq.mediana_dias))} dias (~${meses} meses), estimada sobre ${liq.n} anúncio(s).${inativos} Trata-se de indicador de liquidez da região (tempo e expectativa para realização do valor), não do valor do imóvel; complementa a leitura de risco para inventários, quitação de dívidas e prazos de negociação.`,
      { size: 8.8 }
    );
  }

  // Frente G: preço-base multi-fonte — declara cada fonte oficial e o peso
  // aplicado (transparência exigida para defensabilidade ABNT)
  const compLayers = bundle.enrichment.filter((l) => l.key === "comp");
  const compLayer = compLayers.find((l) => Array.isArray(l.payload?.sources)) ?? compLayers[0];
  const rawSources = compLayer?.payload?.sources;
  const priceSources = Array.isArray(rawSources)
    ? (rawSources as Array<Record<string, unknown>>)
    : [];
  if (priceSources.length) {
    const totalPeso = priceSources.reduce((acc, s) => acc + Number(s.peso ?? 0), 0);
    doc.paragraph(
      "O preço-base unitário que ancora os comparativos é a média ponderada das referências oficiais abaixo (pesos renormalizados entre as fontes com cobertura para o município):"
    );
    doc.table(
      ["Fonte", "Ano", "Peso", "R$/ha base", "Referência"],
      priceSources.map((s) => [
        String(s.source ?? "-"),
        String(s.ano ?? "-"),
        totalPeso > 0 ? `${((Number(s.peso ?? 0) / totalPeso) * 100).toFixed(0)}%` : "-",
        fmtBRL(Number(s.valor_ha ?? 0)),
        String(s.detalhe ?? "-"),
      ]),
      [0.30, 0.08, 0.08, 0.16, 0.38],
      ["l", "l", "r", "r", "l"]
    );
    if (priceSources.some((s) => String(s.source ?? "").includes("VTN"))) {
      doc.paragraph(
        "Nota: o VTN/Receita Federal (SIPT) é referencial de natureza fiscal (ITR), declarado por municípios e órgãos estaduais, e tende a se situar abaixo do valor de transação de mercado; o peso atribuído reflete essa natureza.",
        { size: 8.5, color: MUTED }
      );
    }
  }

  // ── 8. Memória de cálculo e especificação da avaliação (NBR 9-h, 9-j) ──
  renderEspecificacao(doc, {
    sec: "8",
    nComps: comps.length,
    nSan,
    nOut,
    precisao,
    cvPct,
    ic80Low,
    ic80High,
    grade,
    purposeKey,
  });

  // ── 9. Conclusão ──
  doc.heading("9", "Conclusão - valor de mercado");
  doc.ensure(88);
  const boxY = doc.y - 78;
  doc.page.drawRectangle({ x: M, y: boxY, width: PW - 2 * M, height: 78, color: BG, borderColor: BRAND, borderWidth: 1.2 });
  doc.page.drawText(san("Valor unitário (R$/ha)"), { x: M + 14, y: boxY + 56, size: 8.5, font: doc.font, color: MUTED });
  doc.page.drawText(fmtBRL(ppha), { x: M + 14, y: boxY + 38, size: 14, font: doc.bold, color: INK });
  doc.page.drawText(san("Valor total de mercado"), { x: M + 14, y: boxY + 22, size: 8.5, font: doc.font, color: MUTED });
  doc.page.drawText(fmtBRL(total), { x: M + 14, y: boxY + 4, size: 20, font: doc.bold, color: BRAND });
  const rangeTxt = san(`Campo de arbítrio: ${fmtBRL(totalMin)} a ${fmtBRL(totalMax)}`);
  doc.page.drawText(rangeTxt, { x: PW - M - 14 - doc.font.widthOfTextAtSize(rangeTxt, 9), y: boxY + 10, size: 9, font: doc.font, color: MUTED });
  if (grade) {
    doc.page.drawText(san(`Grau ${grade}`), { x: PW - M - 14 - doc.bold.widthOfTextAtSize(san(`Grau ${grade}`), 11), y: boxY + 56, size: 11, font: doc.bold, color: ACCENT });
  }
  doc.y = boxY - 14;
  if (total > 0 && totalMax > 0 && (total < totalMin || total > totalMax)) {
    doc.paragraph(
      "Atenção: o valor concluído está fora do campo de arbítrio da estimativa central (NBR 14.653); a justificativa deve constar do parecer do responsável técnico.",
      { size: 8.5, color: MUTED }
    );
  }
  const narrative = String(rep.narrative ?? "");
  if (narrative.trim()) {
    doc.paragraph("Parecer do responsável técnico:", { font: doc.bold, size: 9.5, gap: 2 });
    doc.paragraph(narrative, { size: 9.2 });
  }

  // ── Seções finais com numeração dinâmica (sinais → vistoria → fotos → RT) ──
  let sec = 10;
  if (renderSignals(doc, bundle.signals, String(sec))) sec++;
  if (renderVisit(doc, bundle.field_visit, String(sec))) sec++;
  if (await renderPhotos(doc, bundle.photos, String(sec))) sec++;

  // ── Responsabilidade técnica ──
  doc.heading(String(sec), "Responsabilidade técnica");
  doc.kv([
    ["Responsável técnico", String(tech.full_name ?? "-")],
    ["Registro CREA", `${String(tech.crea_number ?? "-")}${tech.uf ? " / " + tech.uf : ""}`],
    ["Modalidade", String(tech.specialty ?? "-")],
    ["ART", artNumber || "-"],
    ["Validade do registro (CREA)", fmtDate(tech.crea_valid_until)],
  ]);
  doc.y -= 26;
  doc.ensure(40);
  doc.page.drawLine({ start: { x: M, y: doc.y }, end: { x: M + 240, y: doc.y }, thickness: 0.8, color: INK });
  doc.y -= 12;
  doc.page.drawText(san(String(tech.full_name ?? "Responsável técnico")), { x: M, y: doc.y, size: 9, font: doc.bold, color: INK });
  doc.y -= 12;
  doc.page.drawText(san(`${tech.specialty ?? "Eng."} - CREA ${tech.crea_number ?? ""} - ART ${artNumber || "-"}`), { x: M, y: doc.y, size: 8, font: doc.font, color: MUTED });
  doc.y -= 22;
  doc.paragraph(
    "Este laudo foi emitido com base em geometria e dados abertos reais, homogeneizados conforme a NBR 14.653, sob responsabilidade técnica do profissional acima, habilitado no CREA e com ART registrada. A defensabilidade é assegurada pelo congelamento das fontes (DataSnapshot) e pelo código de verificação (hash) no rodapé.",
    { size: 8, color: MUTED }
  );
  // Local e data da elaboração do laudo (NBR 14.653-1, item 9-m).
  doc.y -= 4;
  doc.paragraph(
    `Local e data de emissão: ${locality !== "-" ? locality : "(local a informar)"}, ${fmtDate(genAt)}.`,
    { size: 8.5, font: doc.bold }
  );

  // ── Assinatura digital e verificação de autenticidade ──
  if (bundle.verification?.code) {
    doc.y -= 6;
    doc.paragraph("Assinatura digital e verificação", { font: doc.bold, size: 9.5, gap: 2 });
    doc.kv([
      ["Código de verificação", bundle.verification.code],
      ["Verifique a autenticidade em", bundle.verification.url],
    ]);
    doc.paragraph(
      "Assinatura digital do responsável técnico: assine este PDF com certificado digital ICP-Brasil ou pela plataforma oficial do Gov.br (gov.br/assinatura-eletronica), conferindo validade jurídica equivalente à assinatura manuscrita (MP 2.200-2/2001 e Lei 14.063/2020), conforme exigido pelas instituições de crédito (ex.: Política de Credenciamento de Avaliadores - Sicoob). A autenticidade e a integridade deste documento podem ser conferidas por qualquer interessado no endereço acima, com o código de verificação, comparando o hash SHA-256 do arquivo recebido.",
      { size: 8, color: MUTED }
    );
  }

  // ── Anexo I: classes de capacidade de uso do solo (referência da caracterização) ──
  renderClassesSolo(doc);

  return await doc.pdf.save();
}
