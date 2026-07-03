// Conectores de enriquecimento — fontes abertas consultadas server-side (sem chave).
// Reais: relevo (DEM Copernicus via Open-Meteo), clima (ERA5 via Open-Meteo archive),
// acesso e hidrografia (OSM Overpass), uso do solo (MapBiomas Coleção 9 — COG lido por
// range request com geotiff.js), solo (EMBRAPA SiBCS — WMS GetFeatureInfo).
// Referência: embargos (IBAMA), comparáveis (DERAL/CEPEA).

import { fromUrl } from "https://esm.sh/geotiff@2.1.3?target=deno";

export interface Layer {
  key: string;
  label: string;
  source: string;
  factor: number;
  result: string;
  real: boolean;
  payload?: Record<string, unknown>;
}

function ref(key: string, label: string, source: string, factor: number, result: string): Layer {
  return { key, label, source, factor, result, real: false };
}

function withTimeout(ms: number) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, clear: () => clearTimeout(t) };
}

const toRad = (d: number) => (d * Math.PI) / 180;
function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(toRad(a[1])) * Math.cos(toRad(b[1]));
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function centroidOf(geojson: any): [number, number] {
  const coords: number[][] = [];
  const walk = (c: any) => {
    if (Array.isArray(c) && typeof c[0] === "number") coords.push(c as number[]);
    else if (Array.isArray(c)) c.forEach(walk);
  };
  let geom = geojson;
  if (geojson?.type === "FeatureCollection") geom = geojson.features?.[0]?.geometry;
  else if (geojson?.type === "Feature") geom = geojson.geometry;
  if (geom?.coordinates) walk(geom.coordinates);
  if (!coords.length) return [-51.5, -24.9];
  const sx = coords.reduce((a, c) => a + c[0], 0) / coords.length;
  const sy = coords.reduce((a, c) => a + c[1], 0) / coords.length;
  return [sx, sy];
}

async function relevo(lon: number, lat: number): Promise<Layer> {
  const d = 0.005;
  const lats = [lat, lat + d, lat - d, lat, lat].join(",");
  const lons = [lon, lon, lon, lon + d, lon - d].join(",");
  const { signal, clear } = withTimeout(6000);
  try {
    const r = await fetch(
      `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`,
      { signal },
    );
    const j = await r.json();
    clear();
    const e: number[] = j.elevation;
    const center = e[0];
    const maxDiff = Math.max(...e.slice(1).map((x) => Math.abs(x - center)));
    const distM = d * 111000;
    const slope = (maxDiff / distM) * 100;
    const classe =
      slope < 8 ? "suave/mecanizável" : slope < 15 ? "ondulado" : slope < 25 ? "forte ondulado" : "montanhoso";
    const factor = slope < 8 ? 1.05 : slope < 15 ? 1.02 : slope < 25 ? 0.97 : 0.9;
    return {
      key: "relevo",
      label: "Relevo & declividade",
      source: "Open-Meteo DEM (Copernicus GLO-90)",
      factor,
      result: `Altitude ${Math.round(center)} m, declividade ~${slope.toFixed(1)}% (${classe})`,
      real: true,
      payload: { elevation_m: center, slope_pct: Number(slope.toFixed(2)) },
    };
  } catch (_) {
    clear();
    return ref("relevo", "Relevo & declividade", "DEM (indisponível, referência)", 1.03, "Relevo não consultado");
  }
}

async function clima(lon: number, lat: number): Promise<Layer> {
  const { signal, clear } = withTimeout(7000);
  try {
    const r = await fetch(
      `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=2023-01-01&end_date=2023-12-31&daily=precipitation_sum,temperature_2m_mean&timezone=auto`,
      { signal },
    );
    const j = await r.json();
    clear();
    const p = (j.daily?.precipitation_sum ?? []).filter((x: number) => x != null);
    const t = (j.daily?.temperature_2m_mean ?? []).filter((x: number) => x != null);
    const precip = Math.round(p.reduce((a: number, b: number) => a + b, 0));
    const temp = t.length ? t.reduce((a: number, b: number) => a + b, 0) / t.length : 0;
    const factor = precip >= 1200 && precip <= 2200 ? 1.04 : precip < 900 ? 0.93 : precip > 2800 ? 0.97 : 1.0;
    const risco = precip < 900 ? "risco de déficit hídrico" : "baixo risco de déficit";
    return {
      key: "clima",
      label: "Clima & balanço hídrico",
      source: "Open-Meteo / ERA5 (compat. INMET)",
      factor,
      result: `${precip} mm/ano, temp média ${temp.toFixed(1)}°C, ${risco}`,
      real: true,
      payload: { precip_mm: precip, temp_c: Number(temp.toFixed(1)) },
    };
  } catch (_) {
    clear();
    return ref("clima", "Clima & balanço hídrico", "Clima (indisponível, referência)", 1.03, "Clima não consultado");
  }
}

async function osm(lon: number, lat: number): Promise<{ acesso: Layer; hidro: Layer }> {
  const { signal, clear } = withTimeout(8000);
  const q =
    `[out:json][timeout:7];(` +
    `way(around:8000,${lat},${lon})[highway~"motorway|trunk|primary|secondary|tertiary"];` +
    `way(around:3000,${lat},${lon})[waterway~"river|stream|canal"];` +
    `);out tags center 60;`;
  try {
    const r = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      signal,
      headers: { "User-Agent": "valor-de-terras/1.0", "Content-Type": "application/x-www-form-urlencoded" },
      body: "data=" + encodeURIComponent(q),
    });
    const j = await r.json();
    clear();
    const els: any[] = j.elements ?? [];
    const roads = els.filter((e) => e.tags?.highway && e.center);
    const waters = els.filter((e) => e.tags?.waterway && e.center);

    let nr: any = null, nrd = Infinity;
    for (const w of roads) {
      const dkm = haversineKm([lon, lat], [w.center.lon, w.center.lat]);
      if (dkm < nrd) { nrd = dkm; nr = w; }
    }
    let acesso: Layer;
    if (nr) {
      const f = nrd < 2 ? 1.06 : nrd < 8 ? 1.02 : nrd < 20 ? 0.97 : 0.93;
      const nm = nr.tags.ref || nr.tags.name || nr.tags.highway;
      acesso = {
        key: "acesso", label: "Acesso & logística", source: "OpenStreetMap (Overpass)",
        factor: f, result: `Via ${nm} a ${nrd.toFixed(1)} km`, real: true,
        payload: { nearest_road: nm, dist_km: Number(nrd.toFixed(2)), class: nr.tags.highway },
      };
    } else {
      acesso = { key: "acesso", label: "Acesso & logística", source: "OpenStreetMap (Overpass)", factor: 0.93, result: "Sem rodovia pavimentada num raio de 8 km", real: true, payload: { dist_km: null } };
    }

    let nwd = Infinity;
    for (const w of waters) {
      const dkm = haversineKm([lon, lat], [w.center.lon, w.center.lat]);
      if (dkm < nwd) nwd = dkm;
    }
    const hidro: Layer = waters.length
      ? { key: "hidro", label: "Hidrografia & APP", source: "OpenStreetMap (Overpass)", factor: 1.01, result: `Curso d'água a ${nwd.toFixed(1)} km (disponibilidade hídrica; APP a observar)`, real: true, payload: { count: waters.length, nearest_km: Number(nwd.toFixed(2)) } }
      : { key: "hidro", label: "Hidrografia & APP", source: "OpenStreetMap (Overpass)", factor: 0.99, result: "Sem curso d'água mapeado num raio de 3 km", real: true, payload: { count: 0 } };

    return { acesso, hidro };
  } catch (_) {
    clear();
    return {
      acesso: ref("acesso", "Acesso & logística", "OSM (indisponível, referência)", 1.0, "Acesso não consultado"),
      hidro: ref("hidro", "Hidrografia & APP", "OSM (indisponível, referência)", 0.99, "Hidrografia não consultada"),
    };
  }
}

// ---- Uso do solo: MapBiomas Coleção 9 (COG nacional 30 m, lido por range request) ----
const MB_URL =
  "https://storage.googleapis.com/mapbiomas-public/initiatives/brasil/collection_9/lclu/coverage/brasil_coverage_2023.tif";

// classe MapBiomas -> [nome, fator, é uso agropecuário?]
const MB: Record<number, [string, number, boolean]> = {
  3: ["Formação Florestal", 0.96, false], 4: ["Formação Savânica", 0.97, false],
  5: ["Mangue", 0.85, false], 6: ["Floresta Alagável", 0.9, false],
  9: ["Silvicultura", 1.05, true], 11: ["Área Úmida", 0.88, false],
  12: ["Formação Campestre", 0.98, false], 15: ["Pastagem", 1.04, true],
  18: ["Agricultura", 1.08, true], 19: ["Lavoura Temporária", 1.08, true],
  20: ["Cana", 1.06, true], 21: ["Mosaico de Usos", 1.05, true],
  23: ["Praia/Duna", 0.85, false], 24: ["Área Urbanizada", 0.9, false],
  25: ["Outra Área não Vegetada", 0.9, false], 29: ["Afloramento Rochoso", 0.85, false],
  30: ["Mineração", 0.9, false], 31: ["Aquicultura", 0.9, false],
  33: ["Rio/Lago/Oceano", 0.85, false], 35: ["Dendê", 1.05, true],
  36: ["Lavoura Perene", 1.06, true], 39: ["Soja", 1.1, true],
  40: ["Arroz", 1.05, true], 41: ["Outra Lavoura Temporária", 1.06, true],
  46: ["Café", 1.08, true], 47: ["Citrus", 1.07, true],
  48: ["Outra Lavoura Perene", 1.05, true], 62: ["Algodão", 1.07, true],
};

async function uso(lon: number, lat: number): Promise<Layer> {
  const { signal, clear } = withTimeout(12000);
  try {
    const tiff = await fromUrl(MB_URL, { signal } as any);
    const img = await tiff.getImage();
    const [ox, oy] = img.getOrigin();
    const [rx, ry] = img.getResolution();
    const W = img.getWidth();
    const H = img.getHeight();
    const dd = 0.004;
    const pts: [number, number][] = [
      [lon, lat], [lon + dd, lat], [lon - dd, lat], [lon, lat + dd], [lon, lat - dd],
    ];
    // lê os 5 pixels em paralelo (range requests concorrentes) — corta o maior rabo da estimativa
    const reads = await Promise.all(
      pts.map(async ([x, y]) => {
        const px = Math.floor((x - ox) / rx);
        const py = Math.floor((y - oy) / ry);
        if (px < 0 || py < 0 || px >= W || py >= H) return 0;
        const d = await img.readRasters({ window: [px, py, px + 1, py + 1] });
        return Number((d[0] as ArrayLike<number>)[0]);
      }),
    );
    clear();
    const classes: number[] = reads.filter((v) => v && v > 0);
    if (!classes.length) throw new Error("sem dados MapBiomas");
    const counts: Record<number, number> = {};
    for (const c of classes) counts[c] = (counts[c] ?? 0) + 1;
    const dom = Number(Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]);
    const agPct = Math.round((classes.filter((c) => MB[c]?.[2]).length / classes.length) * 100);
    const info = MB[dom] ?? [`Classe ${dom}`, 1.0, false];
    return {
      key: "uso", label: "Uso e cobertura do solo", source: "MapBiomas Coleção 9 (2023)",
      factor: info[1] as number,
      result: `Predomínio: ${info[0]} (${agPct}% agropecuário na amostra)`,
      real: true, payload: { dominant_class: dom, ag_pct: agPct, samples: classes },
    };
  } catch (_) {
    clear();
    return ref("uso", "Uso e cobertura do solo", "MapBiomas (indisponível, referência)", 1.06, "Uso não consultado (fonte indisponível)");
  }
}

// ---- Solo: EMBRAPA SiBCS (WMS GetFeatureInfo, mapa 1:5M) ----
const SOLO: Record<string, [number, string]> = {
  LATOSSOLOS: [1.1, "boa aptidão, profundo e mecanizável"],
  NITOSSOLOS: [1.12, "alta aptidão agrícola"],
  ARGISSOLOS: [1.04, "aptidão moderada"],
  CHERNOSSOLOS: [1.1, "alta fertilidade natural"],
  CAMBISSOLOS: [1.0, "aptidão moderada (pouco profundo)"],
  NEOSSOLOS: [0.95, "aptidão restrita (variável)"],
  GLEISSOLOS: [0.92, "hidromórfico, restrição de drenagem"],
  ORGANOSSOLOS: [0.9, "orgânico, restrição p/ lavoura convencional"],
  PLANOSSOLOS: [0.95, "restrição de drenagem"],
  PLINTOSSOLOS: [0.9, "restrição por plintita"],
  ESPODOSSOLOS: [0.9, "arenoso, baixa fertilidade"],
  VERTISSOLOS: [0.98, "argiloso, exige manejo"],
  LUVISSOLOS: [1.0, "aptidão moderada"],
};

async function solo(lon: number, lat: number): Promise<Layer> {
  const { signal, clear } = withTimeout(8000);
  const d = 0.02;
  const bbox = `${lon - d},${lat - d},${lon + d},${lat + d}`;
  const url =
    `https://geoinfo.dados.embrapa.br/geoserver/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo` +
    `&LAYERS=geonode:brasil_solos_5m_20201104&QUERY_LAYERS=geonode:brasil_solos_5m_20201104` +
    `&SRS=EPSG:4326&BBOX=${bbox}&WIDTH=101&HEIGHT=101&X=50&Y=50&INFO_FORMAT=application/json&FEATURE_COUNT=1&BUFFER=10`;
  try {
    const r = await fetch(url, { signal });
    const j = await r.json();
    clear();
    const p = j.features?.[0]?.properties;
    if (!p) throw new Error("sem solo EMBRAPA");
    const ordem = String(p.ordem1 ?? "").toUpperCase();
    const comp = String(p.comp1 ?? p.leg_sinot ?? ordem ?? "Solo");
    const info = SOLO[ordem] ?? [1.0, "aptidão moderada"];
    return {
      key: "solo", label: "Solo & aptidão agrícola", source: "EMBRAPA SiBCS (1:5M)",
      factor: info[0], result: `${comp} — ${info[1]}`, real: true,
      payload: { ordem, simbolo: p.classe_dom, comp1: p.comp1 },
    };
  } catch (_) {
    clear();
    return ref("solo", "Solo & aptidão agrícola", "EMBRAPA (indisponível, referência)", 1.12, "Solo não consultado (fonte indisponível)");
  }
}

// ---- Embargos: IBAMA Áreas Embargadas (WMS GetFeatureInfo) ----
async function embargo(lon: number, lat: number): Promise<Layer> {
  const { signal, clear } = withTimeout(7000);
  const d = 0.01;
  const bbox = `${lon - d},${lat - d},${lon + d},${lat + d}`;
  const url =
    `https://siscom.ibama.gov.br/geoserver/publica/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo` +
    `&LAYERS=publica:vw_brasil_adm_embargo_a&QUERY_LAYERS=publica:vw_brasil_adm_embargo_a` +
    `&SRS=EPSG:4326&BBOX=${bbox}&WIDTH=101&HEIGHT=101&X=50&Y=50&INFO_FORMAT=application/json&FEATURE_COUNT=1&BUFFER=10`;
  try {
    const r = await fetch(url, { signal });
    if (!r.ok) throw new Error("ibama " + r.status);
    const j = await r.json();
    clear();
    const f = j.features?.[0];
    if (f) {
      const p = f.properties ?? {};
      const motivo = p.des_infrac ?? p.des_tad ?? p.julgamento ?? "";
      return {
        key: "embargo", label: "Restrições & embargos", source: "IBAMA — Áreas Embargadas",
        factor: 0.6, real: true,
        result: `Sobreposição com área embargada do IBAMA${motivo ? ` (${String(motivo).slice(0, 40)})` : ""}`,
        payload: p,
      };
    }
    return {
      key: "embargo", label: "Restrições & embargos", source: "IBAMA — Áreas Embargadas",
      factor: 1.0, real: true, result: "Sem sobreposição com áreas embargadas do IBAMA",
    };
  } catch (_) {
    clear();
    return ref("embargo", "Restrições & embargos", "IBAMA (indisponível, referência)", 1.0, "Embargos não verificados (serviço IBAMA indisponível no momento)");
  }
}

// Placeholder de comparáveis; o valor real (DERAL/SEAB-PR) é preenchido pela RPC e
// mesclado de volta na Edge Function após a estimativa.
const REF_COMP = ref("comp", "Comparáveis de mercado", "DERAL/SEAB-PR", 1.0, "Referência DERAL/SEAB-PR");

/** Monta as 8 camadas (ordem do catálogo): relevo, solo, uso, clima, hidro, acesso, embargo, comp. */
export async function buildEnrichment(lon: number, lat: number): Promise<Layer[]> {
  const [rel, so, us, cli, o, emb] = await Promise.all([
    relevo(lon, lat), solo(lon, lat), uso(lon, lat), clima(lon, lat), osm(lon, lat), embargo(lon, lat),
  ]);
  return [rel, so, us, cli, o.hidro, o.acesso, emb, REF_COMP];
}
