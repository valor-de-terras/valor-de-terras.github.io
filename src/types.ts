// Tipos de domínio — espelham o modelo central descrito no plano (Notion).
// Usados pela demo interativa (estimativa preliminar) e por componentes de UI.

import type { Feature, FeatureCollection, Geometry } from "geojson";

export type PropertyOrigin = "kml" | "kmz" | "shp" | "geojson" | "car" | "point";

export interface PropertyGeometry {
  origin: PropertyOrigin;
  geojson: Feature<Geometry> | FeatureCollection;
  /** área em hectares */
  areaHa: number;
  /** perímetro em km */
  perimeterKm: number;
  centroid: [number, number]; // [lng, lat]
  carCode?: string;
  municipality?: string;
  uf?: string;
}

export type EnrichmentStatus = "idle" | "running" | "done";

export interface EnrichmentLayer {
  key: string;
  label: string;
  source: string;
  /** ícone curto (emoji/sigla) só para a demo */
  glyph: string;
  /** resultado textual (real do backend, ou referência) */
  result: string;
  /** fator de homogeneização NBR aplicado a partir desta camada (multiplicador) */
  factor: number;
  accent: string;
  /** true quando o valor veio de uma fonte aberta consultada de verdade */
  real?: boolean;
}

export interface Comparable {
  id: string;
  distanceKm: number;
  areaHa: number;
  pricePerHa: number; // R$/ha bruto
  homogenizedPricePerHa: number; // após fatores
  use: string;
  source: string;
}

export interface EstimateResult {
  min: number;
  avg: number;
  max: number;
  pricePerHaMin: number;
  pricePerHaAvg: number;
  pricePerHaMax: number;
  grau: "Expedito" | "Normal" | "Rigoroso";
  comparablesUsed: number;
  modelVersion: string;
}

export type AppraisalStatus =
  | "DRAFT"
  | "GEOMETRY_VALIDATING"
  | "DATA_ENRICHING"
  | "ESTIMATING"
  | "ESTIMATE_DELIVERED";
