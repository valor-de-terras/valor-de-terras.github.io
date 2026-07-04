# -*- coding: utf-8 -*-
"""Gera o seed SQL de logistics_pois (armazéns CONAB + porto) a partir do
shapefile do cadastro de armazéns da CONAB (SICARM/CDA). Frente H do roadmap
(simulador de viabilidade por atividade — piloto da cadeia de grãos).

Uso:
  py -3 conab_armazens_seed.py --shp "D:\\...\\Armazens_CONAB" --out seed_logistics.sql

Fonte: cadastro público de armazéns da CONAB (consulta CDA), extração do projeto
FOMENTO ARENITO (IDR-Paraná, ~2023-11). Dado factual de pessoa jurídica; telefone
e e-mail são descartados (minimização LGPD).

Requer pyshp (import shapefile).
"""

from __future__ import annotations

import argparse
import io
import sys


def esc(s: str) -> str:
    return str(s).replace("'", "''").strip()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--shp", required=True, help="caminho base do shapefile (sem extensão)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--extracao", default="2023-11", help="vigência/da extração da fonte")
    args = ap.parse_args()

    import shapefile  # pyshp

    sf = shapefile.Reader(args.shp, encoding="utf-8")
    names = [f[0] for f in sf.fields[1:]]
    rows = []
    skipped = 0
    for rec in sf.iterRecords():
        d = dict(zip(names, rec))
        lat, lon = d.get("Latitude"), d.get("Longitude")
        cap = d.get("CAP(t)") or 0
        try:
            lat, lon = float(lat), float(lon)
            cap = int(cap)
        except (TypeError, ValueError):
            skipped += 1
            continue
        # sanidade geográfica (PR + borda): lat -27..-22, lon -55..-48
        if not (-27.5 <= lat <= -22.0 and -55.5 <= lon <= -47.5) or cap <= 0:
            skipped += 1
            continue
        rows.append({
            "cda": esc(d.get("CDA", "")),
            "nome": esc(d.get("Armazenado", "")),
            "municipio": esc(d.get("Município", d.get("Municipio", ""))),
            "uf": esc(d.get("UF", "PR")) or "PR",
            "tipo": esc(d.get("Tipo", "")),
            "cap_t": cap,
            "lat": lat,
            "lon": lon,
        })

    if skipped:
        print(f"AVISO: {skipped} registros pulados (coordenada/capacidade inválida)", file=sys.stderr)
    if not rows:
        print("nenhum registro válido", file=sys.stderr)
        return 1

    out = io.StringIO()
    out.write("-- Frente H · seed logistics_pois — gerado por scrapers/conab_armazens_seed.py\n")
    out.write(f"-- Fonte: cadastro de armazéns CONAB (CDA), extração {args.extracao} (projeto\n")
    out.write(f"-- FOMENTO ARENITO/IDR). {len(rows)} armazéns + porto de Paranaguá. Sem dados de\n")
    out.write("-- contato (minimização LGPD). Capacidade em toneladas.\n\n")
    out.write("insert into public.logistics_pois (kind, ref_code, name, municipio, uf, tipo, cap_t, geom) values\n")
    vals = [
        "('porto',null,'Porto de Paranaguá (D. Pedro II)','Paranaguá','PR','porto graneleiro',null,"
        "extensions.st_setsrid(extensions.st_makepoint(-48.5148, -25.5021), 4326))"
    ]
    for r in rows:
        vals.append(
            f"('armazem_conab','{r['cda']}','{r['nome']}','{r['municipio']}','{r['uf']}',"
            f"'{r['tipo']}',{r['cap_t']},"
            f"extensions.st_setsrid(extensions.st_makepoint({r['lon']:.6f}, {r['lat']:.6f}), 4326))"
        )
    out.write(",\n".join(vals))
    out.write("\non conflict do nothing;\n")

    with open(args.out, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(out.getvalue())
    print(f"{len(rows)} armazéns + 1 porto -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
