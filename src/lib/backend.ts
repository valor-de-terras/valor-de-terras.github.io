import type { Feature, FeatureCollection, Geometry } from "geojson";
import { supabase, ensureAnonSession } from "./supabase";
import { centroid as centroidOf } from "./geo";
import { ENRICHMENT_LAYERS } from "../data/demo";
import type { Comparable, EnrichmentLayer, EstimateResult } from "../types";

type AnyGeo = Feature<Geometry> | FeatureCollection;

interface BackendLayer {
  key: string;
  label: string;
  source: string;
  factor: number;
  result: string;
  real: boolean;
}

export interface AppraiseResult {
  area: number;
  centroid: [number, number];
  estimate: EstimateResult;
  comparables: Comparable[];
  layers: EnrichmentLayer[];
  requestId: string;
}

export interface AppraiseMeta {
  municipality: string;
  uf: string;
  carCode: string;
  origin: string;
}

const PLACEHOLDER_MUNI = ["—", "Importado do arquivo", "Paraná (ponto)"];

/** Chama a Edge Function `appraise` (cria pedido + enriquece + estima no servidor). */
export async function appraiseViaBackend(
  parcel: AnyGeo,
  meta: AppraiseMeta
): Promise<AppraiseResult> {
  await ensureAnonSession();

  const { data, error } = await supabase.functions.invoke("appraise", {
    body: {
      geojson: parcel,
      uf: meta.uf && meta.uf !== "—" ? meta.uf : null,
      municipality:
        meta.municipality && !PLACEHOLDER_MUNI.includes(meta.municipality)
          ? meta.municipality
          : null,
      origin: meta.origin || "geojson",
      car_code: meta.carCode && meta.carCode !== "—" ? meta.carCode : null,
    },
  });

  if (error) throw error;
  if (!data || data.error) throw new Error(data?.error ?? "Resposta inválida do backend");

  const est = data.estimate;
  // A estimativa automatizada corresponde, no máximo, ao Grau I (preliminar) da
  // NBR 14.653-3. Graus II/III dependem da revisão e qualificação do responsável técnico.
  const grau: EstimateResult["grau"] =
    est.grade === "iii" ? "III" : est.grade === "ii" ? "II" : "I";

  const estimate: EstimateResult = {
    min: est.total.min,
    avg: est.total.avg,
    max: est.total.max,
    pricePerHaMin: est.price_per_ha.min,
    pricePerHaAvg: est.price_per_ha.avg,
    pricePerHaMax: est.price_per_ha.max,
    grau,
    comparablesUsed: est.comparables_used,
    modelVersion: est.model_version,
  };

  const comparables: Comparable[] = (est.comparables ?? []).map(
    (c: Record<string, number | string>, i: number) => ({
      id: `cmp-${i + 1}`,
      distanceKm: Number(c.distance_km),
      areaHa: Number(c.area_ha),
      pricePerHa: Number(c.price_per_ha),
      homogenizedPricePerHa: Number(c.homogenized_price_per_ha),
      use: String(c.land_use),
      source: String(c.source),
    })
  );

  const back: BackendLayer[] = data.enrichment ?? [];
  const layers: EnrichmentLayer[] = ENRICHMENT_LAYERS.map((l) => {
    const b = back.find((x) => x.key === l.key);
    return b
      ? { ...l, result: b.result, source: b.source, factor: b.factor, real: b.real }
      : l;
  });

  return {
    area: est.area_ha,
    centroid: centroidOf(parcel),
    estimate,
    comparables,
    layers,
    requestId: data.request_id,
  };
}
