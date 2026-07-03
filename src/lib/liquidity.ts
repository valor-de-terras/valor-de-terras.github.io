import { supabase, ensureAnonSession } from "./supabase";

export interface Liquidity {
  escopo: "municipio" | "uf" | "uf_rural" | "vazio";
  faixa_area: string;
  n: number;
  mediana_dias: number | null;
  max_dias: number | null;
  taxa_inativos: number | null;
}

/**
 * Sinal de liquidez de mercado (tempo típico de venda na região) para o imóvel avaliando.
 * Só devolve tempo/contagem, nunca preço (coerente com o gating da Frente A).
 */
export async function getLiquidity(
  municipality: string,
  uf: string,
  areaHa: number,
  rural = true
): Promise<Liquidity | null> {
  if (!uf || uf === "—" || !municipality) return null;
  try {
    await ensureAnonSession();
    const { data, error } = await supabase.rpc("get_liquidity", {
      p_municipio: municipality,
      p_uf: uf,
      p_area_ha: areaHa,
      p_rural: rural,
    });
    if (error || !data) return null;
    return data as Liquidity;
  } catch {
    return null;
  }
}
