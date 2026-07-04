import { supabase, ensureAnonSession } from "./supabase";

export interface LogisticsPoi {
  name: string;
  municipio: string | null;
  tipo: string | null;
  cap_t: number | null;
  dist_km: number;
}

export interface Logistics {
  available: boolean;
  score?: number;
  nearest?: LogisticsPoi[];
  cap_50km_t?: number;
  n_50km?: number;
  port_dist_km?: number | null;
  port_name?: string;
  fonte?: string;
}

/**
 * Sinal logístico da cadeia de grãos (Frente H, piloto): armazéns CONAB mais
 * próximos, capacidade em 50 km, distância ao porto e score de acesso 0-100.
 * Saída não-monetária (coerente com o gating da Frente A).
 */
export async function getLogistics(lon: number, lat: number): Promise<Logistics | null> {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  try {
    await ensureAnonSession();
    const { data, error } = await supabase.rpc("get_logistics", {
      p_lon: lon,
      p_lat: lat,
    });
    if (error || !data || !(data as Logistics).available) return null;
    return data as Logistics;
  } catch {
    return null;
  }
}
