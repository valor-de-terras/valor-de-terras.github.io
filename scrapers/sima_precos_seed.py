# -*- coding: utf-8 -*-
"""Gera o seed SQL de chain_prices (preços regionais SIMA/SEAB) a partir dos
dados processados do dashboard precos-diarios (ecossistema Datageo do Avner).
Frente H v2 (preço da cadeia na regional; frete come quanto do preço).

Uso:
  py -3 sima_precos_seed.py --json <path>\regional_prices.json --out seed_precos.sql

Fonte primária: SIMA/SEAB-PR (cotações diárias por praça), via pipeline do
repo avnergomes/precos-diarios (data/json/regional_prices.json). Pega o último
mês disponível por produto x regional. Preço de commodity é dado público de
mercado (não é o valor do imóvel; fora do gating da tarja).

Atualização: re-rodar quando o repo atualizar (ETL diário via GitHub Actions)
ou consumir a API própria (precos-diarios-api.onrender.com, exige X-API-Key).
"""

from __future__ import annotations

import argparse
import io
import json
import sys

# cotações anteriores a este mês são descartadas (evita preço obsoleto no painel)
MIN_REF_MONTH = "2024-01"

PRODUTOS = {
    "Soja industrial tipo 1": ("graos", "saca 60 kg"),
    "Milho amarelo tipo 1": ("graos", "saca 60 kg"),
    "Trigo pão": ("graos", "saca 60 kg"),
    "Boi em pé": ("pecuaria", "arroba"),
    "Vaca em pé": ("pecuaria", "arroba"),
    "Suíno vivo": ("pecuaria", "arroba"),
    "Erva-mate folha em barranco": ("florestal", "arroba"),
}


def esc(s) -> str:
    return str(s or "").replace("'", "''").strip()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", required=True, help="regional_prices.json do precos-diarios")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    data = json.load(open(args.json, encoding="utf-8"))
    bpr = data.get("by_product_regional") or {}
    vals = []
    for produto, (cadeia, unidade) in PRODUTOS.items():
        regs = bpr.get(produto)
        if not regs:
            print(f"AVISO: produto ausente na fonte: {produto}", file=sys.stderr)
            continue
        for regional, serie in regs.items():
            if not serie:
                continue
            last = serie[-1]
            preco = last.get("v")
            ref = last.get("p")
            if preco is None or not ref:
                continue
            # recência: descarta cotação antiga (produto que deixou de ser cotado na
            # regional, ex. erva-mate em Maringá parou em 2011) p/ não virar contexto
            # enganoso no painel de viabilidade. ref_month é 'YYYY-MM'.
            if str(ref) < MIN_REF_MONTH:
                continue
            vals.append(
                f"('{cadeia}','{esc(produto)}','{esc(regional)}','{unidade}',{float(preco):.2f},'{esc(ref)}','SIMA/SEAB-PR')"
            )

    if not vals:
        print("nenhum preço extraído", file=sys.stderr)
        return 1

    out = io.StringIO()
    out.write("-- Frente H v2 · seed chain_prices — gerado por scrapers/sima_precos_seed.py\n")
    out.write("-- Fonte: SIMA/SEAB-PR via pipeline precos-diarios (Datageo). Último mês por\n")
    out.write(f"-- produto x regional; {len(vals)} linhas. ref_month declara a vigência.\n\n")
    out.write("insert into public.chain_prices (cadeia, produto, regional, unidade, preco, ref_month, fonte) values\n")
    out.write(",\n".join(vals))
    out.write("\non conflict (produto, regional) do update set preco = excluded.preco, ref_month = excluded.ref_month;\n")

    with open(args.out, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(out.getvalue())
    print(f"{len(vals)} preços -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
