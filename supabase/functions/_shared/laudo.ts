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

  doc.footer = `Laudo ${shortId} - gerado em ${genAt.slice(0, 19).replace("T", " ")} UTC - modelo ${modelVersion} - hash ${hash}`;

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
    : "Fundamentação NBR 14.653-3: a enquadrar pelo responsável técnico";
  if (precisao) fundTxt += ` - Precisão Grau ${precisao}`;
  if (cvPct != null) fundTxt += ` - CV ${cvPct.toFixed(1)}%`;
  p.drawText(san(fundTxt), { x: M + 10, y: doc.y - 15, size: 9, font: doc.bold, color: BRAND });
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

  // ── 3. Fontes de dados ──
  doc.heading("3", "Pressupostos, ressalvas e fontes de dados");
  doc.paragraph(
    "A avaliação apoia-se em dados públicos abertos, congelados na data-base (DataSnapshot) para rastreabilidade e defensabilidade. Fontes consultadas:"
  );
  const layers = bundle.enrichment.map(layerInfo).filter((l) => l.key !== "comp");
  doc.table(
    ["Camada", "Fonte", "Diagnóstico"],
    layers.map((l) => [l.label, l.source, l.result || "-"]),
    [0.22, 0.26, 0.52]
  );

  // ── 4. Diagnóstico ──
  doc.heading("4", "Caracterização e diagnóstico do imóvel");
  doc.kv(layers.map((l) => [l.label, l.result || "-"] as [string, string]));

  // ── 5. Metodologia e homogeneização ──
  doc.heading("5", "Metodologia e homogeneização");
  doc.paragraph(
    "Adotou-se o método comparativo direto de dados de mercado (NBR 14.653-2/3). Os elementos foram homogeneizados por fatores relativos a relevo, solo/aptidão, uso, clima, acesso e situação. Fatores aplicados:"
  );
  const factorRows = layers
    .filter((l) => Math.abs(l.factor - 1) > 1e-9)
    .map((l) => [l.label, l.result || "-", l.factor.toFixed(2)]);
  if (factorRows.length) {
    doc.table(["Atributo", "Diagnóstico", "Fator"], factorRows, [0.26, 0.56, 0.18], ["l", "l", "r"]);
  } else {
    doc.paragraph("Nenhum fator relevante desviou da unidade nesta amostra.", { color: MUTED, size: 9 });
  }

  // ── 6. Comparativos ──
  doc.heading("6", "Tratamento dos elementos comparativos");
  const comps = bundle.comparables;
  doc.table(
    ["#", "Dist.", "Área", "Uso", "R$/ha", "Homog."],
    comps.map((c, i) => [
      String(i + 1),
      `${fmtNum(c.distance_km as number, 1)} km`,
      `${fmtNum(c.area_ha as number)} ha`,
      String(c.land_use ?? "-"),
      fmtBRL(c.price_per_ha as number),
      fmtBRL(c.homogenized_price_per_ha as number),
    ]),
    [0.06, 0.12, 0.14, 0.32, 0.18, 0.18],
    ["l", "r", "r", "l", "r", "r"]
  );
  let statTxt = `Comparativos utilizados: ${comps.length}. Fonte predominante: ${String(comps[0]?.source ?? "DERAL/SEAB-PR")}.`;
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

  // ── 7. Conclusão ──
  doc.heading("7", "Conclusão - valor de mercado");
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

  // ── 8. Responsabilidade técnica ──
  doc.heading("8", "Responsabilidade técnica");
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

  return await doc.pdf.save();
}
