# -*- coding: utf-8 -*-
"""Gera o seed SQL de zarc_summary a partir da Tábua de Risco do ZARC
(dados.agricultura.gov.br, CSV aberto das portarias). Frente I do roadmap.

Uso:
  py -3 zarc_seed.py --csv zarc-pr-2025-2026-culturas-alvo.csv --out seed_zarc.sql

Entrada: CSV nacional (ou extrato) da "Tábua de Risco" com colunas
Nome_cultura;SafraIni;SafraFin;...;Cod_Solo;geocodigo;UF;municipio;...;
Nome_Outros_Manejos;...;Portaria;dec1..dec36 (célula = risco %: 0/20/30/40).

Agregação (sinal de produto, v1): por município x cultura, SÓ SEQUEIRO,
melhor caso entre solos/ciclos: risco mínimo por decêndio; conta decêndios
com risco 20% e monta a janela de plantio (primeiro-último decêndio com
risco <= 40%). Uma linha por município x cultura (399 x 6 ~ 2.4k linhas).

Gotchas (dicionário oficial): decêndios são colunas; usar geocodigo (IBGE 7
dígitos) como chave; solo em escalas diferentes por cultura (AD1-6 vs 1/2/3);
"Feijão" sem sufixo = 1ª safra; células vazias = não indicado (0).
Encoding utf-8-sig, separador ';'.
"""

from __future__ import annotations

import argparse
import csv
import io
import sys

MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]


def dec_label(i: int) -> str:
    """1-36 -> '1º dec jan' .. '3º dec dez'."""
    m = (i - 1) // 3
    d = (i - 1) % 3 + 1
    return f"{d}º dec {MESES[m]}"


def esc(s) -> str:
    return str(s or "").replace("'", "''").strip()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True)
    ap.add_argument("--uf", default="PR")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    # melhor risco por decêndio: chave (geocodigo, cultura)
    best: dict[tuple[str, str], dict] = {}
    with open(args.csv, encoding="utf-8-sig", newline="") as fh:
        rd = csv.DictReader(fh, delimiter=";")
        for row in rd:
            if (row.get("UF") or "").strip() != args.uf:
                continue
            if (row.get("Nome_Outros_Manejos") or "").strip().lower() != "sequeiro":
                continue
            geo = (row.get("geocodigo") or "").strip()
            cult = (row.get("Nome_cultura") or "").strip()
            if not geo or not cult:
                continue
            key = (geo, cult)
            entry = best.setdefault(key, {
                "municipio": (row.get("municipio") or "").strip(),
                "safra": f"{(row.get('SafraIni') or '').strip()}/{(row.get('SafraFin') or '').strip()}",
                "portaria": (row.get("Portaria") or "").strip(),
                "riscos": [0] * 36,
            })
            for i in range(36):
                raw = (row.get(f"dec{i + 1}") or "").strip()
                try:
                    r = int(float(raw)) if raw else 0
                except ValueError:
                    r = 0
                if r > 0:
                    cur = entry["riscos"][i]
                    entry["riscos"][i] = r if cur == 0 else min(cur, r)

    if not best:
        print("nenhuma linha agregada; confira UF/estrutura do CSV", file=sys.stderr)
        return 1

    out = io.StringIO()
    out.write("-- Frente I · seed zarc_summary — gerado por scrapers/zarc_seed.py\n")
    out.write("-- Fonte: Tábua de Risco ZARC (dados.agricultura.gov.br, portarias MAPA),\n")
    out.write(f"-- só sequeiro, melhor caso entre solos/ciclos. {len(best)} município x cultura.\n\n")
    out.write("insert into public.zarc_summary (cod_ibge, municipio_norm, municipio, cultura, safra, portaria, n_dec20, n_dec_ok, janela) values\n")
    vals = []
    for (geo, cult), e in sorted(best.items()):
        riscos = e["riscos"]
        n20 = sum(1 for r in riscos if r == 20)
        oks = [i + 1 for i, r in enumerate(riscos) if 0 < r <= 40]
        janela = f"{dec_label(oks[0])} a {dec_label(oks[-1])}" if oks else ""
        muni = e["municipio"]
        muni_norm = muni.upper()
        for a, b in zip("ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ", "AAAAAEEEEIIIIOOOOOUUUUC"):
            muni_norm = muni_norm.replace(a, b)
        muni_norm = muni_norm.replace("'", "")
        vals.append(
            f"('{esc(geo)}','{esc(muni_norm)}','{esc(muni)}','{esc(cult)}','{esc(e['safra'])}',"
            f"'{esc(e['portaria'])}',{n20},{len(oks)},'{esc(janela)}')"
        )
    out.write(",\n".join(vals))
    out.write("\non conflict do nothing;\n")

    with open(args.out, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(out.getvalue())
    print(f"{len(best)} município x cultura -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
