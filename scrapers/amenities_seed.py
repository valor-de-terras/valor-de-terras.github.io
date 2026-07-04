# -*- coding: utf-8 -*-
"""Consolida os pontos de atração do OSM (15 CSVs por categoria) num seed
amenity_pois. Frente L (pontos de atração: turísticos, cênicos, cidades →
fator de valorização até +15% ABNT, campo de arbítrio).

Uso:
  py -3 amenities_seed.py --dir <scratchpad>\atracao --out seed_amenities.sql

Mapeia as categorias OSM p/ 4 kinds usados no fator:
  cenico    = cachoeira, mirante, represa, pico, gruta, parque/reserva natural
  turistico = atração, parque temático, museu, patrimônio, resort, marina
  cidade    = place=city (serviços/amenidades)
  vila      = place=town
Só pontos nomeados, coord no bbox do PR. Sem contato.
"""

from __future__ import annotations

import argparse
import csv
import io
import sys

KIND_MAP = {
    "natural_waterfall.csv": "cenico",
    "tourism_viewpoint.csv": "cenico",
    "water_reservoir.csv": "cenico",
    "natural_peak.csv": "cenico",
    "natural_cave.csv": "cenico",
    "national_park.csv": "cenico",
    "nature_reserve.csv": "cenico",
    "tourism_attraction.csv": "turistico",
    "tourism_theme_park.csv": "turistico",
    "tourism_museum.csv": "turistico",
    "historic.csv": "turistico",
    "tourism_resort.csv": "turistico",
    "marina.csv": "turistico",
    "place_city.csv": "cidade",
    "place_town.csv": "vila",
}


def esc(s) -> str:
    return str(s or "").replace("'", "''").strip()[:160]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    rows = []
    seen = set()
    for fname, kind in KIND_MAP.items():
        path = f"{args.dir}\\{fname}"
        try:
            with open(path, encoding="utf-8") as fh:
                for r in csv.DictReader(fh):
                    try:
                        lon, lat = float(r["lon"]), float(r["lat"])
                    except (ValueError, KeyError):
                        continue
                    if not (-27.5 <= lat <= -22.0 and -55.5 <= lon <= -47.5):
                        continue
                    nome = (r.get("nome") or "").strip()
                    if not nome:
                        continue
                    key = (kind, round(lon, 4), round(lat, 4))
                    if key in seen:
                        continue
                    seen.add(key)
                    pop = r.get("populacao") or ""
                    try:
                        pop = int(float(pop)) if pop else None
                    except ValueError:
                        pop = None
                    rows.append((kind, esc(nome), esc(r.get("tipo")), esc(r.get("municipio")), pop, lon, lat))
        except FileNotFoundError:
            print(f"AVISO: ausente {fname}", file=sys.stderr)

    from collections import Counter
    print("por kind:", dict(Counter(r[0] for r in rows)), file=sys.stderr)
    if not rows:
        return 1

    out = io.StringIO()
    out.write("-- Frente L · seed amenity_pois — gerado por scrapers/amenities_seed.py\n")
    out.write(f"-- Fonte: OpenStreetMap (Overpass). {len(rows)} pontos de atração do PR.\n")
    out.write("-- cenico/turistico/cidade/vila p/ o fator locacional ABNT (até +15%).\n\n")
    CH = 400
    for i in range(0, len(rows), CH):
        out.write("insert into public.amenity_pois (kind, nome, tipo, municipio, populacao, geom) values\n")
        vals = []
        for k, nome, tipo, mu, pop, lon, lat in rows[i : i + CH]:
            popv = "null" if pop is None else str(pop)
            vals.append(
                f"('{k}','{nome}','{tipo}','{mu}',{popv},"
                f"extensions.st_setsrid(extensions.st_makepoint({lon:.6f}, {lat:.6f}), 4326))"
            )
        out.write(",\n".join(vals))
        out.write("\non conflict do nothing;\n\n")

    with open(args.out, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(out.getvalue())
    print(f"{len(rows)} pontos -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
