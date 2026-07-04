# -*- coding: utf-8 -*-
"""Gera o seed SQL de urban_perimeters a partir do shapefile de perímetros
urbanos municipais do PR (acervo IDR; base ITCG/municípios com lei de criação).
Extensão da Frente D: classificador rural x urbano (a metodologia do motor é a
NBR 14.653-3, rural; imóvel dentro de perímetro urbano recebe aviso).

Uso:
  py -3 perimetros_urbanos_seed.py --shp "D:\\...\\perímetros_urbanos" --out seed_urb.sql

O shapefile vem em SIRGAS 2000 UTM 22S (EPSG:31982); reprojetado p/ 4326 com
pyproj. Guarda só identificação (perímetro, lei, município IBGE, área); os
demais ~100 campos de infraestrutura ficam de fora.
"""

from __future__ import annotations

import argparse
import io
import sys

CHUNK = 100


def esc(s) -> str:
    return str(s or "").replace("'", "''").strip()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--shp", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    import shapefile  # pyshp
    from shapely.geometry import shape as shp_shape
    from shapely import force_2d, make_valid
    from shapely.ops import transform as shp_transform
    import pyproj

    tr = pyproj.Transformer.from_crs("EPSG:31982", "EPSG:4326", always_xy=True)

    sf = shapefile.Reader(args.shp, encoding="utf-8")
    names = [f[0] for f in sf.fields[1:]]
    rows = []
    skipped = 0
    for srec in sf.iterShapeRecords():
        d = dict(zip(names, srec.record))
        try:
            geom = make_valid(force_2d(shp_shape(srec.shape.__geo_interface__)))
            geom = shp_transform(tr.transform, geom)
        except Exception:
            skipped += 1
            continue
        if geom.is_empty or geom.geom_type not in ("Polygon", "MultiPolygon"):
            skipped += 1
            continue
        area = d.get("AreaHa")
        try:
            area = round(float(area), 2) if area not in (None, "") else None
        except (TypeError, ValueError):
            area = None
        rows.append({
            "cod": esc(d.get("CdPerimetr")),
            "nome": esc(d.get("NmPerimetr")),
            "lei": esc(d.get("Lei")),
            "cod_ibge": esc(d.get("CdMunicipi")),
            "municipio": esc(d.get("NmMunicipi")),
            "area": area,
            "wkt": geom.wkt,
        })

    print(f"{len(rows)} perímetros válidos; {skipped} pulados", file=sys.stderr)
    if not rows:
        return 1

    out = io.StringIO()
    out.write("-- Ext. Frente D · seed urban_perimeters — gerado por scrapers/perimetros_urbanos_seed.py\n")
    out.write(f"-- Fonte: perímetros urbanos municipais do PR (com lei), {len(rows)} feições,\n")
    out.write("-- reprojetadas de EPSG:31982 p/ 4326. Uso: aviso rural x urbano no fluxo.\n\n")
    for i in range(0, len(rows), CHUNK):
        out.write("insert into public.urban_perimeters (cod, nome, lei, cod_ibge, municipio, area_ha, geom) values\n")
        vals = []
        for r in rows[i : i + CHUNK]:
            area = "null" if r["area"] is None else f"{r['area']}"
            vals.append(
                f"('{r['cod']}','{r['nome']}','{r['lei']}','{r['cod_ibge']}','{r['municipio']}',{area},"
                f"extensions.st_multi(extensions.st_geomfromtext('{r['wkt']}', 4326)))"
            )
        out.write(",\n".join(vals))
        out.write("\non conflict do nothing;\n\n")

    with open(args.out, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(out.getvalue())
    print(f"{len(rows)} perímetros -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
