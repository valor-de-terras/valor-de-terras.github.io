# -*- coding: utf-8 -*-
"""Gera o seed SQL de outorgas (kind='agua') a partir do shapefile de outorgas
do SIGARH/IAT-PR. Frente J do roadmap (outorgas de água e mineração).

Uso:
  py -3 sigarh_outorgas_seed.py --shp "D:\\...\\Outorgas_SIGARH" --out seed_agua.sql

Minimização (LGPD): nome do requerente e do empreendimento são DESCARTADOS;
ficam só o ato público (nº da portaria/protocolo), tipo, uso, finalidade,
localização e vazão. Atos negativos/cancelados/revogados ficam fora, assim
como interferências de infraestrutura viária (bueiro, travessia, ponte).
Fonte: SIGARH/IAT-PR (snapshot do acervo IDR; re-baixar da fonte ao atualizar).
"""

from __future__ import annotations

import argparse
import io
import sys

DOC_EXCLUIR = {
    "Parecer Negativo",
    "Declaração de cancelamento",
    "Portaria de revogação",
}
TIPO_EXCLUIR_PREFIX = ("Bueiro", "Travessia", "Ponte")
CHUNK = 5000


def esc(s) -> str:
    return str(s or "").replace("'", "''").strip()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--shp", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--extracao", default="2025-05")
    args = ap.parse_args()

    import shapefile  # pyshp

    sf = shapefile.Reader(args.shp, encoding="utf-8")
    names = [f[0] for f in sf.fields[1:]]
    rows = []
    skipped = 0
    for rec in sf.iterRecords():
        d = dict(zip(names, rec))
        doc = str(d.get("nm_tipo_do") or "")
        tipo = str(d.get("nm_tipo_in") or "")
        if doc in DOC_EXCLUIR or tipo.startswith(TIPO_EXCLUIR_PREFIX):
            skipped += 1
            continue
        try:
            lat = float(d.get("coord_lati"))
            lon = float(d.get("coord_long"))
        except (TypeError, ValueError):
            skipped += 1
            continue
        if not (-27.5 <= lat <= -22.0 and -55.5 <= lon <= -47.5):
            skipped += 1
            continue
        vaz = d.get("vlr_vazao_")
        try:
            vaz = round(float(vaz), 3) if vaz not in (None, "") else None
        except (TypeError, ValueError):
            vaz = None
        rows.append({
            "tipo": esc(tipo),
            "doc": esc(doc),
            "uso": esc(d.get("nm_tipo_us")),
            "finalidade": esc(d.get("desc_final")),
            "municipio": esc(d.get("nm_municip")),
            "detalhe": esc(d.get("nm_bacia_h") or d.get("nm_aquifer")),
            "ref_doc": esc(d.get("nr_portari") or d.get("nr_e_proto")),
            "vazao": vaz,
            "lat": lat,
            "lon": lon,
        })

    print(f"{len(rows)} outorgas válidas; {skipped} excluídas (negativas/viárias/coord)", file=sys.stderr)
    if not rows:
        return 1

    out = io.StringIO()
    out.write("-- Frente J · seed outorgas (água) — gerado por scrapers/sigarh_outorgas_seed.py\n")
    out.write(f"-- Fonte: SIGARH/IAT-PR (snapshot {args.extracao}, acervo IDR). {len(rows)} atos.\n")
    out.write("-- Sem nome de requerente/empreendimento (minimização LGPD); sem atos negativos,\n")
    out.write("-- cancelados ou revogados; sem interferências viárias (bueiro/travessia/ponte).\n\n")
    for i in range(0, len(rows), CHUNK):
        out.write("insert into public.outorgas (kind, tipo, doc, uso, finalidade, municipio, detalhe, ref_doc, vazao_m3h, geom) values\n")
        vals = []
        for r in rows[i : i + CHUNK]:
            vaz = "null" if r["vazao"] is None else f"{r['vazao']}"
            vals.append(
                f"('agua','{r['tipo']}','{r['doc']}','{r['uso']}','{r['finalidade']}',"
                f"'{r['municipio']}','{r['detalhe']}','{r['ref_doc']}',{vaz},"
                f"extensions.st_setsrid(extensions.st_makepoint({r['lon']:.6f}, {r['lat']:.6f}), 4326))"
            )
        out.write(",\n".join(vals))
        out.write("\non conflict do nothing;\n\n")

    with open(args.out, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(out.getvalue())
    print(f"{len(rows)} outorgas de água -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
