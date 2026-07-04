# -*- coding: utf-8 -*-
"""Gera o seed SQL de outorgas (kind='mineracao') a partir do shapefile SIGMINE
da ANM (processos minerários por UF). Frente J do roadmap.

Uso:
  py -3 sigmine_seed.py --shp sigmine_pr/PR --out seed_mineracao.sql

Fonte: https://dadosabertos.anm.gov.br/SIGMINE/PROCESSOS_MINERARIOS/PR.zip
(regenerada diariamente pela ANM). Geometria PolygonZ em SIRGAS 2000 geográfico
(EPSG:4674 ~ 4326 p/ esta finalidade); o Z é descartado. O nome do titular é
DESCARTADO (minimização; a consulta pública da ANM dá o titular pelo processo).
Gotcha: o campo UF não é confiável (processos de fronteira vêm com SP/SC/"DADO
NÃO CADASTRADO"); o recorte espacial do arquivo por UF é que vale.

Requer pyshp + shapely (montagem correta de anéis/furos).
"""

from __future__ import annotations

import argparse
import io
import sys

CHUNK = 800


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

    sf = shapefile.Reader(args.shp, encoding="utf-8")
    names = [f[0] for f in sf.fields[1:]]
    rows = []
    skipped = 0
    for srec in sf.iterShapeRecords():
        d = dict(zip(names, srec.record))
        try:
            geom = make_valid(force_2d(shp_shape(srec.shape.__geo_interface__)))
        except Exception:
            skipped += 1
            continue
        if geom.is_empty or geom.geom_type not in ("Polygon", "MultiPolygon"):
            skipped += 1
            continue
        area = d.get("AREA_HA")
        try:
            area = round(float(area), 2) if area not in (None, "") else None
        except (TypeError, ValueError):
            area = None
        rows.append({
            "fase": esc(d.get("FASE")),
            "uso": esc(d.get("USO")),
            "subs": esc(d.get("SUBS")),
            "ref": esc(d.get("DSProcesso") or d.get("PROCESSO")),
            "area": area,
            "wkt": geom.wkt,
        })

    print(f"{len(rows)} processos válidos; {skipped} pulados", file=sys.stderr)
    if not rows:
        return 1

    out = io.StringIO()
    out.write("-- Frente J · seed outorgas (mineração) — gerado por scrapers/sigmine_seed.py\n")
    out.write(f"-- Fonte: ANM/SIGMINE PR.zip (base regenerada diariamente). {len(rows)} processos.\n")
    out.write("-- Sem nome do titular (minimização). FASE indica o estágio do direito minerário.\n\n")
    for i in range(0, len(rows), CHUNK):
        out.write("insert into public.outorgas (kind, tipo, doc, uso, finalidade, municipio, detalhe, ref_doc, area_ha, geom) values\n")
        vals = []
        for r in rows[i : i + CHUNK]:
            area = "null" if r["area"] is None else f"{r['area']}"
            vals.append(
                f"('mineracao','{r['fase']}','processo ANM','{r['uso']}','{r['subs']}',"
                f"null,'ANM/SIGMINE','{r['ref']}',{area},"
                f"extensions.st_multi(extensions.st_geomfromtext('{r['wkt']}', 4326)))"
            )
        out.write(",\n".join(vals))
        out.write("\non conflict do nothing;\n\n")

    with open(args.out, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(out.getvalue())
    print(f"{len(rows)} processos -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
