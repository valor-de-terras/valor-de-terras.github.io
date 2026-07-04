# -*- coding: utf-8 -*-
"""Gera o seed land_appreciation (valorização histórica da terra por município)
a partir da série DERAL de preços de terras (repo precos-de-terras, 1998+).
"Spread da terra": valorização nominal da terra vs alternativas (CDI/IPCA).

Uso:
  py -3 land_spread_seed.py --json <path>\detailed.json --out seed_spread.sql

Categoria A (lavoura). CAGR recente (janela de ~10 anos) e de longo prazo (desde
1998). Percentuais; o painel/laudo compara com taxas de referência documentadas.
"""

from __future__ import annotations

import argparse
import io
import json
import re
import statistics
import sys
import unicodedata
from collections import defaultdict

RECENT_WINDOW = 10


def norm(s) -> str:
    s = unicodedata.normalize("NFD", str(s or ""))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").upper()
    return re.sub(r"\s+", " ", s.replace("'", "")).strip()


def esc(s) -> str:
    return str(s or "").replace("'", "''").strip()


def cagr(p_ini: float, p_fim: float, anos: int):
    if p_ini <= 0 or p_fim <= 0 or anos <= 0:
        return None
    return round((p_fim / p_ini) ** (1 / anos) - 1, 4)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    rows = json.load(open(args.json, encoding="utf-8"))
    agg: dict[str, dict[int, list]] = defaultdict(lambda: defaultdict(list))
    meta: dict[str, tuple] = {}
    for r in rows:
        if r.get("nivel") != "Municipio" or r.get("categoria") != "A":
            continue
        m, a, p = r.get("territorio"), r.get("ano"), r.get("preco")
        if not m or not a or not p:
            continue
        agg[m][int(a)].append(float(p))
        meta[m] = (r.get("regiao"), r.get("mesorregiao"))

    out_rows = []
    for m, ys in agg.items():
        anos = sorted(ys)
        if len(anos) < 5:
            continue
        y_fim = anos[-1]
        p_fim = statistics.mean(ys[y_fim])
        # janela recente: ano mais próximo de (y_fim - 10)
        alvo = y_fim - RECENT_WINDOW
        y_ini_r = min(anos, key=lambda y: abs(y - alvo))
        p_ini_r = statistics.mean(ys[y_ini_r])
        # longo prazo: primeiro ano
        y_ini_f = anos[0]
        p_ini_f = statistics.mean(ys[y_ini_f])
        cagr_r = cagr(p_ini_r, p_fim, y_fim - y_ini_r)
        cagr_f = cagr(p_ini_f, p_fim, y_fim - y_ini_f)
        if cagr_r is None:
            continue
        reg, meso = meta[m]
        out_rows.append({
            "municipio_norm": norm(m),
            "municipio": esc(m),
            "regiao": esc(reg),
            "y_ini_r": y_ini_r, "y_fim": y_fim,
            "cagr_recente": cagr_r,
            "cagr_longo": cagr_f if cagr_f is not None else "null",
            "y_ini_f": y_ini_f,
        })

    if not out_rows:
        print("nenhuma linha", file=sys.stderr)
        return 1

    out = io.StringIO()
    out.write("-- Frente 'spread da terra' · seed land_appreciation — land_spread_seed.py\n")
    out.write("-- Fonte: série DERAL/SEAB-PR de preços de terras (categoria A/lavoura), via\n")
    out.write(f"-- repo precos-de-terras (Datageo). {len(out_rows)} municípios. CAGR nominal.\n\n")
    out.write("insert into public.land_appreciation "
              "(municipio_norm, municipio, regiao, ano_ini_recente, ano_fim, cagr_recente, ano_ini_longo, cagr_longo) values\n")
    vals = [
        f"('{r['municipio_norm']}','{r['municipio']}','{r['regiao']}',"
        f"{r['y_ini_r']},{r['y_fim']},{r['cagr_recente']},{r['y_ini_f']},{r['cagr_longo']})"
        for r in out_rows
    ]
    out.write(",\n".join(vals))
    out.write("\non conflict (municipio_norm) do update set "
              "cagr_recente = excluded.cagr_recente, cagr_longo = excluded.cagr_longo, ano_fim = excluded.ano_fim;\n")

    with open(args.out, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(out.getvalue())
    print(f"{len(out_rows)} municípios -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
