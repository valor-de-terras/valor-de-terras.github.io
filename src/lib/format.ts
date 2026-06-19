const brl0 = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

const num0 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const num1 = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const num2 = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const fmtBRL = (v: number) => brl0.format(v);

/** Valores grandes em formato compacto: R$ 1,2 mi / R$ 980 mil */
export function fmtBRLCompact(v: number): string {
  if (v >= 1_000_000) return `R$ ${num1.format(v / 1_000_000)} mi`;
  if (v >= 1_000) return `R$ ${num0.format(v / 1_000)} mil`;
  return brl0.format(v);
}

export const fmtNum = (v: number) => num0.format(v);
export const fmtArea = (ha: number) => `${ha >= 100 ? num0.format(ha) : num1.format(ha)} ha`;
export const fmtKm = (km: number) => `${num1.format(km)} km`;
export const fmtCoord = (v: number) => num2.format(v);
