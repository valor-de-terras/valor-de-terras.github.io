# -*- coding: utf-8 -*-
"""Gera seed de logistics_pois para os destinos das cadeias pecuária, leite e
silvicultura (frigoríficos, laticínios, indústria florestal). Frente H completa.

Uso:
  py -3 cadeias_pois_seed.py --geojson pts.geojson --kind frigorifico --out seed.sql
  py -3 cadeias_pois_seed.py --csv sif.csv --kind laticinio --lat-col lat ... --out seed.sql

Entrada flexível: GeoJSON (Overpass/OSM) ou CSV com colunas de nome/município/
lat/long. Só carregar cadeia com COBERTURA ESTADUAL — cobertura parcial enviesa o
ranking do get_viability (melhor o fallback neutro). Sem dados de contato (LGPD).

kind ∈ {frigorifico, laticinio, serraria}. Fonte é registrada em `tipo`.
"""

from __future__ import annotations

import argparse
import io
import json
import sys


def esc(s) -> str:
    return str(s or "").replace("'", "''").strip()[:180]


def from_geojson(path: str, name_keys, muni_keys):
    with open(path, encoding="utf-8") as fh:
        gj = json.load(fh)
    feats = gj.get("features", gj if isinstance(gj, list) else [])
    for f in feats:
        props = f.get("properties", f.get("tags", {})) or {}
        geom = f.get("geometry") or {}
        lon = lat = None
        if geom.get("type") == "Point":
            lon, lat = geom["coordinates"][:2]
        elif "lat" in f and "lon" in f:  # overpass center
            lat, lon = f["lat"], f["lon"]
        elif "center" in f:
            lat, lon = f["center"]["lat"], f["center"]["lon"]
        if lon is None or lat is None:
            continue
        name = next((props[k] for k in name_keys if props.get(k)), "")
        muni = next((props[k] for k in muni_keys if props.get(k)), "")
        yield name, muni, float(lon), float(lat)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--geojson")
    ap.add_argument("--kind", required=True, choices=["frigorifico", "laticinio", "serraria"])
    ap.add_argument("--fonte", default="OSM")
    ap.add_argument("--name-keys", default="name,razao_social,RazaoSocial,nome")
    ap.add_argument("--muni-keys", default="municipio,Municipio,addr:city,city,cidade")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    if not args.geojson:
        print("informe --geojson", file=sys.stderr)
        return 2

    rows = []
    seen = set()
    for name, muni, lon, lat in from_geojson(
        args.geojson, args.name_keys.split(","), args.muni_keys.split(",")
    ):
        if not (-27.5 <= lat <= -22.0 and -55.5 <= lon <= -47.5):
            continue
        key = (round(lon, 4), round(lat, 4))
        if key in seen:
            continue
        seen.add(key)
        rows.append((esc(name) or f"{args.kind} s/ nome", esc(muni), lon, lat))

    print(f"{len(rows)} pontos ({args.kind})", file=sys.stderr)
    if not rows:
        return 1

    out = io.StringIO()
    out.write(f"-- Frente H · seed logistics_pois ({args.kind}) — cadeias_pois_seed.py\n")
    out.write(f"-- Fonte: {args.fonte}. {len(rows)} pontos. Sem dados de contato (LGPD).\n\n")
    out.write("insert into public.logistics_pois (kind, name, municipio, uf, tipo, geom) values\n")
    vals = [
        f"('{args.kind}','{nm}','{mu}','PR','{esc(args.fonte)}',"
        f"extensions.st_setsrid(extensions.st_makepoint({lon:.6f}, {lat:.6f}), 4326))"
        for nm, mu, lon, lat in rows
    ]
    out.write(",\n".join(vals))
    out.write("\non conflict do nothing;\n")

    with open(args.out, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(out.getvalue())
    print(f"{len(rows)} -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
