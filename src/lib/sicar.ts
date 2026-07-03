// Integração real com o SICAR (Cadastro Ambiental Rural) via GeoServer oficial.
// geoserver.car.gov.br expõe, por UF, a camada sicar_imoveis_<uf> em WMS (com CORS),
// permitindo exibir os imóveis no mapa (GetMap) e selecionar um imóvel real ao clicar
// (GetFeatureInfo, que devolve a geometria + atributos oficiais: cod_imovel, município,
// área, módulos fiscais, etc.).

import type { Feature, MultiPolygon, Polygon } from "geojson";

const GEOSERVER = "https://geoserver.car.gov.br/geoserver/sicar/wms";

export interface CarProperties {
  cod_imovel?: string;
  municipio?: string;
  uf?: string;
  area?: number; // área registrada (ha)
  m_fiscal?: number; // módulos fiscais
  tipo_imovel?: string;
  condicao?: string;
  status_imovel?: string;
  [k: string]: unknown;
}

export interface CarHit {
  feature: Feature<Polygon | MultiPolygon, CarProperties>;
  codImovel: string;
  municipio: string;
  uf: string;
  areaHa: number;
}

// Bounding boxes aproximadas das UFs [minLon, minLat, maxLon, maxLat].
// Usadas só para escolher a(s) camada(s) candidata(s) ao clicar; camada errada
// devolve vazio e a próxima candidata é tentada.
const BR_UF_BBOX: Record<string, [number, number, number, number]> = {
  ac: [-74.0, -11.2, -66.6, -7.1], al: [-38.3, -10.6, -35.1, -8.8],
  am: [-73.8, -9.9, -56.0, 2.3], ap: [-54.9, -1.3, -49.8, 4.5],
  ba: [-46.7, -18.4, -37.3, -8.5], ce: [-41.5, -7.9, -37.2, -2.7],
  df: [-48.3, -16.1, -47.3, -15.5], es: [-41.9, -21.4, -39.6, -17.8],
  go: [-53.3, -19.6, -45.9, -12.3], ma: [-48.8, -10.3, -41.7, -1.0],
  mg: [-51.1, -22.95, -39.8, -14.2], ms: [-58.2, -24.1, -50.9, -17.1],
  mt: [-61.7, -18.1, -50.1, -7.3], pa: [-58.9, -9.9, -45.9, 2.6],
  pb: [-38.8, -8.3, -34.7, -6.0], pe: [-41.4, -9.5, -34.8, -7.2],
  pi: [-45.9, -11.0, -40.3, -2.7], pr: [-54.7, -26.8, -48.0, -22.4],
  rj: [-44.9, -23.4, -40.9, -20.7], rn: [-38.6, -6.6, -34.9, -4.8],
  ro: [-66.9, -13.7, -59.7, -7.9], rr: [-64.9, -1.6, -58.8, 5.3],
  rs: [-57.7, -33.8, -49.6, -27.0], sc: [-53.9, -29.5, -48.3, -25.9],
  se: [-38.3, -11.6, -36.3, -9.5], sp: [-53.2, -25.4, -44.1, -19.7],
  to: [-50.8, -13.6, -45.6, -5.1],
};

function bboxArea(b: [number, number, number, number]) {
  return (b[2] - b[0]) * (b[3] - b[1]);
}

/** UFs cuja bbox contém o ponto, das mais específicas (menor área) para as maiores. */
export function candidateUfs(lng: number, lat: number): string[] {
  const hits = Object.entries(BR_UF_BBOX)
    .filter(([, b]) => lng >= b[0] && lng <= b[2] && lat >= b[1] && lat <= b[3])
    .sort((a, b) => bboxArea(a[1]) - bboxArea(b[1]))
    .map(([uf]) => uf);
  return hits.length ? hits.slice(0, 4) : ["pr"];
}

export function ufForCenter(lng: number, lat: number): string {
  return candidateUfs(lng, lat)[0] ?? "pr";
}

/**
 * URL de tiles WMS (MapLibre) para a camada de imóveis CAR de uma UF.
 * Tiles de 512px (metade das requisições ao GeoServer, que é lento) — combina com
 * `tileSize: 512` na source do MapView.
 */
export function wmsTiles(uf: string): string {
  const params = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.1.1",
    REQUEST: "GetMap",
    LAYERS: `sicar_imoveis_${uf}`,
    SRS: "EPSG:3857",
    BBOX: "{bbox-epsg-3857}",
    WIDTH: "512",
    HEIGHT: "512",
    FORMAT: "image/png",
    TRANSPARENT: "true",
  });
  // {bbox-epsg-3857} não pode ser url-encoded; reinsere literal
  return `${GEOSERVER}?${params.toString()}`.replace(
    encodeURIComponent("{bbox-epsg-3857}"),
    "{bbox-epsg-3857}"
  );
}

async function queryCarUf(
  lng: number,
  lat: number,
  uf: string,
  signal?: AbortSignal
): Promise<CarHit | null> {
  const d = 0.0016;
  const bbox = `${lng - d},${lat - d},${lng + d},${lat + d}`;
  const url =
    `${GEOSERVER}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo` +
    `&LAYERS=sicar_imoveis_${uf}&QUERY_LAYERS=sicar_imoveis_${uf}` +
    `&SRS=EPSG:4326&BBOX=${bbox}&WIDTH=101&HEIGHT=101&X=50&Y=50` +
    `&INFO_FORMAT=application/json&FEATURE_COUNT=1&BUFFER=10`;
  const res = await fetch(url, { signal });
  if (!res.ok) return null;
  const fc = await res.json();
  const f = fc?.features?.[0];
  if (!f || !f.geometry) return null;
  const p: CarProperties = f.properties ?? {};
  return {
    feature: { type: "Feature", geometry: f.geometry, properties: p },
    codImovel: p.cod_imovel ?? "—",
    municipio: p.municipio ?? "—",
    uf: (p.uf ?? uf).toUpperCase(),
    areaHa: typeof p.area === "number" ? p.area : 0,
  };
}

/** Busca o imóvel CAR sob o ponto, tentando as UFs candidatas. */
export async function fetchCarAtPoint(
  lng: number,
  lat: number,
  signal?: AbortSignal
): Promise<CarHit | null> {
  for (const uf of candidateUfs(lng, lat)) {
    try {
      const hit = await queryCarUf(lng, lat, uf, signal);
      if (hit) return hit;
    } catch (e) {
      if ((e as Error)?.name === "AbortError") throw e;
    }
  }
  return null;
}

// Preço-base de referência por município (R$/ha). Ilustrativo (DERAL/CEPEA).
const MUNI_BASE: Record<string, number> = {
  guarapuava: 62000, castro: 88000, "ponta grossa": 84000, cascavel: 105000,
  "campo mourao": 98000, londrina: 112000, maringa: 115000, toledo: 108000,
  "pato branco": 76000, "francisco beltrao": 72000, "guarapuava ": 62000,
};
const UF_BASE: Record<string, number> = {
  PR: 75000, SC: 82000, RS: 70000, SP: 95000, MS: 48000, MT: 42000, GO: 52000, MG: 58000,
};

export function municipioBasePrice(municipio: string, uf: string): number {
  const key = municipio.trim().toLowerCase();
  return MUNI_BASE[key] ?? UF_BASE[uf.toUpperCase()] ?? 60000;
}

export interface MuniLocation {
  /** [oeste, sul, leste, norte] em graus (lon/lat) */
  bbox: [number, number, number, number];
  center: [number, number]; // [lon, lat]
}

/**
 * Geocodifica um município do Paraná (Nominatim/OSM) para levar o mapa até a região.
 * Retorna a bounding box do município para dar zoom (fitBounds).
 */
export async function geocodeMunicipioPR(
  nome: string,
  signal?: AbortSignal
): Promise<MuniLocation | null> {
  const q = encodeURIComponent(`${nome}, Paraná, Brasil`);
  const url =
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1` +
    `&countrycodes=br&q=${q}`;
  const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const arr = (await res.json()) as Array<{
    boundingbox?: [string, string, string, string];
    lat?: string;
    lon?: string;
  }>;
  const hit = Array.isArray(arr) ? arr[0] : null;
  if (!hit?.boundingbox || hit.lon == null || hit.lat == null) return null;
  // Nominatim: boundingbox = [sul, norte, oeste, leste]
  const [south, north, west, east] = hit.boundingbox.map(Number);
  if ([south, north, west, east].some((n) => !Number.isFinite(n))) return null;
  return { bbox: [west, south, east, north], center: [Number(hit.lon), Number(hit.lat)] };
}
