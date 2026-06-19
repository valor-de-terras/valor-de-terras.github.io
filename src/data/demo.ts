// Dados mockados da demonstração. NADA aqui é um laudo real — é uma simulação
// client-side do fluxo descrito no plano para ilustrar o produto.

import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { Comparable, EnrichmentLayer, EstimateResult } from "../types";
import { areaHa, centroid } from "../lib/geo";

type AnyGeo = Feature<Geometry> | FeatureCollection;

export interface SampleParcel {
  id: string;
  name: string;
  municipality: string;
  uf: string;
  carCode: string;
  basePricePerHa: number; // referência regional R$/ha (mock DERAL/CEPEA)
  feature: Feature<Geometry>;
}

function poly(coords: [number, number][]): Feature<Geometry> {
  const ring = [...coords];
  if (
    ring[0][0] !== ring[ring.length - 1][0] ||
    ring[0][1] !== ring[ring.length - 1][1]
  )
    ring.push(ring[0]);
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [ring] },
  };
}

export const SAMPLE_PARCELS: SampleParcel[] = [
  {
    id: "gpv",
    name: "Fazenda Campos do Cará",
    municipality: "Guarapuava",
    uf: "PR",
    carCode: "PR-4109401-A1B2C3D4",
    basePricePerHa: 62000,
    feature: poly([
      [-51.498, -25.372],
      [-51.47, -25.366],
      [-51.452, -25.381],
      [-51.458, -25.401],
      [-51.487, -25.408],
      [-51.505, -25.392],
    ]),
  },
  {
    id: "cst",
    name: "Sítio Boa Vista dos Campos Gerais",
    municipality: "Castro",
    uf: "PR",
    carCode: "PR-4105805-9F8E7D6C",
    basePricePerHa: 88000,
    feature: poly([
      [-49.972, -24.78],
      [-49.949, -24.776],
      [-49.938, -24.79],
      [-49.948, -24.806],
      [-49.97, -24.804],
    ]),
  },
  {
    id: "csc",
    name: "Gleba Oeste — Cascavel",
    municipality: "Cascavel",
    uf: "PR",
    carCode: "PR-4104808-1A2B3C4D",
    basePricePerHa: 105000,
    feature: poly([
      [-53.49, -24.94],
      [-53.46, -24.936],
      [-53.444, -24.952],
      [-53.452, -24.972],
      [-53.481, -24.974],
      [-53.496, -24.957],
    ]),
  },
];

// Camadas de enriquecimento (fan-out do worker no plano). Os "factor" são
// multiplicadores ilustrativos de homogeneização NBR 14.653.
export const ENRICHMENT_LAYERS: EnrichmentLayer[] = [
  {
    key: "relevo",
    label: "Relevo & declividade",
    source: "DEM SRTM / AW3D30",
    glyph: "⛰",
    result: "Declividade média 7,2% — relevo suave-ondulado, mecanizável",
    factor: 1.04,
    accent: "var(--vt-green-600)",
  },
  {
    key: "solo",
    label: "Solo & aptidão agrícola",
    source: "EMBRAPA WMS / SiBCS",
    glyph: "🟤",
    result: "Latossolo Vermelho distroférrico — aptidão boa p/ lavoura",
    factor: 1.12,
    accent: "var(--vt-ochre-600)",
  },
  {
    key: "uso",
    label: "Uso e cobertura do solo",
    source: "MapBiomas (STAC)",
    glyph: "🛰",
    result: "78% agricultura anual, 14% pastagem, 8% vegetação nativa",
    factor: 1.06,
    accent: "var(--vt-green-700)",
  },
  {
    key: "clima",
    label: "Clima & balanço hídrico",
    source: "INMET / BDMEP",
    glyph: "🌦",
    result: "Cfb — 1.850 mm/ano, baixo risco de déficit hídrico",
    factor: 1.03,
    accent: "var(--vt-sky)",
  },
  {
    key: "hidro",
    label: "Hidrografia & APP",
    source: "ANA SNIRH",
    glyph: "💧",
    result: "2 cursos d'água; 6,1% em APP (reserva legal averbada)",
    factor: 0.97,
    accent: "var(--vt-sky)",
  },
  {
    key: "acesso",
    label: "Acesso & logística",
    source: "OSM Overpass",
    glyph: "🛣",
    result: "4,2 km de rodovia asfaltada; 38 km a armazém/porto seco",
    factor: 1.05,
    accent: "var(--vt-ink-soft)",
  },
  {
    key: "embargo",
    label: "Restrições & embargos",
    source: "IBAMA / ICMBio",
    glyph: "⚠",
    result: "Sem embargos ativos; fora de UC e terra indígena",
    factor: 1.0,
    accent: "var(--vt-clay)",
  },
  {
    key: "comp",
    label: "Comparáveis de mercado",
    source: "DERAL/SEAB + CEPEA",
    glyph: "📊",
    result: "11 transações no raio de 25 km (últimos 24 meses)",
    factor: 1.0,
    accent: "var(--vt-gold)",
  },
];

export function buildComparables(area: number, base: number): Comparable[] {
  const uses = ["Lavoura anual", "Lavoura/pecuária", "Pastagem formada", "Lavoura irrigada"];
  const sources = ["DERAL/SEAB-PR", "CEPEA/ESALQ", "Cartório (parceria)", "DERAL/SEAB-PR"];
  return Array.from({ length: 6 }, (_, i) => {
    const dist = 3 + i * 3.4 + ((i * 7) % 5);
    const a = area * (0.55 + ((i * 13) % 9) / 10);
    const raw = base * (0.86 + ((i * 17) % 28) / 100);
    const homog = raw * (0.94 + ((i * 11) % 13) / 100);
    return {
      id: `cmp-${i + 1}`,
      distanceKm: Math.round(dist * 10) / 10,
      areaHa: Math.round(a),
      pricePerHa: Math.round(raw / 100) * 100,
      homogenizedPricePerHa: Math.round(homog / 100) * 100,
      use: uses[i % uses.length],
      source: sources[i % sources.length],
    };
  });
}

export function computeEstimate(
  feature: AnyGeo,
  base: number,
  layers: EnrichmentLayer[]
): { area: number; centroid: [number, number]; estimate: EstimateResult; comparables: Comparable[] } {
  const area = areaHa(feature);
  const c = centroid(feature);
  const combined = layers.reduce((acc, l) => acc * l.factor, 1);
  const pricePerHaAvg = Math.round((base * combined) / 100) * 100;
  const pricePerHaMin = Math.round((pricePerHaAvg * 0.88) / 100) * 100;
  const pricePerHaMax = Math.round((pricePerHaAvg * 1.13) / 100) * 100;
  const comparables = buildComparables(area, base);
  return {
    area,
    centroid: c,
    comparables,
    estimate: {
      min: Math.round(pricePerHaMin * area),
      avg: Math.round(pricePerHaAvg * area),
      max: Math.round(pricePerHaMax * area),
      pricePerHaMin,
      pricePerHaAvg,
      pricePerHaMax,
      grau: "Normal",
      comparablesUsed: comparables.length,
      modelVersion: "homog-nbr-0.3.1",
    },
  };
}
