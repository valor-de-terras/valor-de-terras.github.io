import { supabase, ensureAnonSession } from "./supabase";

export interface LogisticsPoi {
  name: string;
  municipio: string | null;
  tipo: string | null;
  cap_t: number | null;
  dist_km: number;
}

export interface GraosPrice {
  produto: string;
  preco: number;
  unidade: string;
  regional: string;
  ref_month: string;
  frete_ate_armazem: number | null;
  frete_pct: number | null;
}

export interface Logistics {
  available: boolean;
  score?: number;
  nearest?: LogisticsPoi[];
  cap_50km_t?: number;
  n_50km?: number;
  port_dist_km?: number | null;
  port_name?: string;
  graos?: GraosPrice[];
  graos_regional?: string | null;
  fonte?: string;
}

/**
 * Sinal logístico da cadeia de grãos (Frente H): armazéns CONAB mais próximos,
 * capacidade em 50 km, distância ao porto, score de acesso 0-100 e, na v2, o
 * preço regional SIMA com o frete estimado até o armazém. Preço de commodity é
 * dado público de mercado; nada do valor do imóvel sai daqui (gating Frente A).
 */
export async function getLogistics(
  lon: number,
  lat: number,
  municipality?: string
): Promise<Logistics | null> {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  try {
    await ensureAnonSession();
    const { data, error } = await supabase.rpc("get_logistics", {
      p_lon: lon,
      p_lat: lat,
      p_municipio: municipality ?? null,
    });
    if (error || !data || !(data as Logistics).available) return null;
    return data as Logistics;
  } catch {
    return null;
  }
}
