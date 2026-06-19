// Conectores de enriquecimento — fontes abertas consultadas server-side (sem chave).
// Reais: relevo (DEM Copernicus via Open-Meteo), clima (ERA5 via Open-Meteo archive),
// acesso e hidrografia (OpenStreetMap via Overpass). Referência (ainda não conectado):
// solo (EMBRAPA), uso do solo (MapBiomas), embargos (IBAMA), comparáveis (DERAL/CEPEA).

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
  const { signal, clear } = withTimeout(8000);
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
  const { signal, clear } = withTimeout(9000);
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
  const { signal, clear } = withTimeout(14000);
  const q =
    `[out:json][timeout:12];(` +
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

const REF_SOLO = ref("solo", "Solo & aptidão agrícola", "EMBRAPA SiBCS (referência)", 1.12, "Aptidão estimada para lavoura (referência regional; conector EMBRAPA em desenvolvimento)");
const REF_USO = ref("uso", "Uso e cobertura do solo", "MapBiomas (referência)", 1.06, "Predomínio agropecuário (referência regional; conector MapBiomas em desenvolvimento)");
const REF_EMBARGO = ref("embargo", "Restrições & embargos", "IBAMA / ICMBio (referência)", 1.0, "Sem embargos conhecidos (verificação oficial recomendada)");
const REF_COMP = ref("comp", "Comparáveis de mercado", "DERAL/SEAB-PR + CEPEA (referência)", 1.0, "Comparáveis de referência regional");

/** Monta as 8 camadas (ordem do catálogo): relevo, solo, uso, clima, hidro, acesso, embargo, comp. */
export async function buildEnrichment(lon: number, lat: number): Promise<Layer[]> {
  const [rel, cli, o] = await Promise.all([relevo(lon, lat), clima(lon, lat), osm(lon, lat)]);
  return [rel, REF_SOLO, REF_USO, cli, o.hidro, o.acesso, REF_EMBARGO, REF_COMP];
}
