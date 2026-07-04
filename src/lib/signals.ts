import type { Feature, FeatureCollection, Geometry } from "geojson";
import { supabase, ensureAnonSession } from "./supabase";
import type { ParsedGeo } from "./parseGeo";

/** Sinais não-monetários das Frentes I (ZARC), J (outorgas) e K (restrições). */

export interface ZarcCultura {
  cultura: string;
  n_dec20: number;
  n_dec_ok: number;
  janela: string | null;
  safra: string;
  portaria: string | null;
}
export interface Zarc {
  available: boolean;
  culturas?: ZarcCultura[];
  criterio?: string;
  fonte?: string;
}

export interface OutorgasAgua {
  n_2km: number;
  vazao_m3h_2km?: number;
  nearest_km?: number | null;
  tipos?: { tipo: string; n: number }[];
}
export interface ProcessoMinerario {
  fase: string;
  substancia: string;
  uso: string;
  processo: string;
  area_ha: number | null;
}
export interface Outorgas {
  available: boolean;
  agua?: OutorgasAgua;
  mineracao?: { n_intersecta: number; processos: ProcessoMinerario[]; n_2km: number };
  fontes?: string;
}

export interface RestricaoHit {
  kind: "uc" | "ti" | "embargo";
  nome: string | null;
  categoria: string | null;
  detalhe?: string | null;
  dist_km?: number;
}
export interface Compliance {
  available: boolean;
  intersecta?: RestricaoHit[];
  proximas_2km?: RestricaoHit[];
  urbano?: { dentro: boolean; perimetro?: string; municipio?: string; lei?: string };
  fontes?: string;
  nota?: string;
}

/** Extrai a geometria (Multi)Polygon do imóvel p/ intersecção server-side. */
export function parcelGeometry(parcel: ParsedGeo | null): Geometry | null {
  if (!parcel) return null;
  const features: Feature[] =
    parcel.type === "FeatureCollection"
      ? (parcel as FeatureCollection).features
      : [parcel as Feature];
  const hit = features.find(
    (f) => f.geometry && (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon")
  );
  return hit?.geometry ?? null;
}

async function callRpc<T extends { available: boolean }>(
  fn: string,
  args: Record<string, unknown>
): Promise<T | null> {
  try {
    await ensureAnonSession();
    const { data, error } = await supabase.rpc(fn, args);
    if (error || !data || !(data as T).available) return null;
    return data as T;
  } catch {
    return null;
  }
}

export function getZarc(municipality: string, uf = "PR"): Promise<Zarc | null> {
  if (!municipality) return Promise.resolve(null);
  return callRpc<Zarc>("get_zarc", { p_municipio: municipality, p_uf: uf });
}

export function getOutorgas(
  lon: number,
  lat: number,
  geometry: Geometry | null
): Promise<Outorgas | null> {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return Promise.resolve(null);
  return callRpc<Outorgas>("get_outorgas", { p_lon: lon, p_lat: lat, p_geojson: geometry });
}

export function getCompliance(
  lon: number,
  lat: number,
  geometry: Geometry | null
): Promise<Compliance | null> {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return Promise.resolve(null);
  return callRpc<Compliance>("get_compliance", { p_lon: lon, p_lat: lat, p_geojson: geometry });
}
