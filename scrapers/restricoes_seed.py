# -*- coding: utf-8 -*-
"""Gera o seed SQL de restricted_areas (UCs, TIs, embargos IBAMA) para o
screening preliminar de restrições (Frente K / EUDR).

Uso:
  py -3 restricoes_seed.py --dir <scratchpad>\restricoes --out seed_restricoes.sql

Fontes (recorte bbox PR, EPSG:4326):
  - ucs_cnuc_pr.geojson      CNUC/MMA via INDE (camada cnuc_2026_03)
  - tis_funai_pr.geojson     FUNAI via CMR (lim_terra_indigena_a)
  - embargos_ibama_pr.geojson SICAFI/IBAMA via PAMGIA (adm_embargo, 2026-02)

Minimização (LGPD): nome do embargado e CPF/CNPJ são DESCARTADOS; fica o nº do
termo (ato público), data, município, tipo e área. Geometrias simplificadas com
tolerância 1e-4 grau (~11 m) — suficiente p/ screening, não p/ demarcação.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import sys

CHUNK = 40
TOL = 1e-4
# a API de query do Supabase CLI rejeita payloads grandes (~1 MB); nenhum WKT
# pode passar disso. Polígonos enormes (grandes UCs) recebem simplificação
# adaptativa (só o necessário p/ caber), o que é aceitável p/ screening.
MAX_WKT = 150_000


def esc(s) -> str:
    return str(s or "").replace("'", "''").strip()


def load(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)["features"]


def prep(geom_json):
    from shapely.geometry import shape as shp_shape
    from shapely import force_2d, make_valid

    g = make_valid(force_2d(shp_shape(geom_json)))
    g = g.simplify(TOL, preserve_topology=True)
    if g.is_empty or g.geom_type not in ("Polygon", "MultiPolygon"):
        return None
    w = g.wkt
    for tol in (1e-3, 3e-3, 1e-2, 3e-2):
        if len(w) <= MAX_WKT:
            break
        gs = g.simplify(tol, preserve_topology=True)
        if not gs.is_empty and gs.geom_type in ("Polygon", "MultiPolygon"):
            w = gs.wkt
    return w


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    rows = []
    skipped = 0

    for f in load(os.path.join(args.dir, "ucs_cnuc_pr.geojson")):
        p = f.get("properties", {})
        wkt = prep(f.get("geometry"))
        if not wkt:
            skipped += 1
            continue
        rows.append({
            "kind": "uc",
            "nome": esc(p.get("nome_uc")),
            "categoria": esc(f"{p.get('categoria') or ''} ({p.get('esfera') or ''})"),
            "detalhe": esc(f"{p.get('grupo') or ''} · gestor {p.get('org_gestor') or '-'}"),
            "ref_doc": esc(p.get("cd_cnuc")),
            "area_ha": p.get("ha_total"),
            "wkt": wkt,
        })

    for f in load(os.path.join(args.dir, "tis_funai_pr.geojson")):
        p = f.get("properties", {})
        wkt = prep(f.get("geometry"))
        if not wkt:
            skipped += 1
            continue
        rows.append({
            "kind": "ti",
            "nome": esc(f"TI {p.get('no_ti') or ''}"),
            "categoria": esc(p.get("ds_fase_ti")),
            "detalhe": esc(f"etnia {p.get('no_grupo_etnico') or '-'}"),
            "ref_doc": esc(p.get("co_funai")),
            "area_ha": p.get("nu_area_ha"),
            "wkt": wkt,
        })

    for f in load(os.path.join(args.dir, "embargos_ibama_pr.geojson")):
        p = f.get("properties", {})
        wkt = prep(f.get("geometry"))
        if not wkt:
            skipped += 1
            continue
        # PII fora: nome_embar / cpf_cnpj_e / nome_imove NÃO entram
        data = esc(str(p.get("dat_embarg") or "")[:8])
        rows.append({
            "kind": "embargo",
            "nome": esc(f"Embargo IBAMA {p.get('num_tad') or ''}"),
            "categoria": esc(p.get("tipo_area")),
            "detalhe": esc(f"{data} · {p.get('municipio') or ''}/{p.get('uf') or ''}"),
            "ref_doc": esc(p.get("num_tad")),
            "area_ha": p.get("qtd_area_e"),
            "wkt": wkt,
        })

    print(f"{len(rows)} restrições; {skipped} geometrias puladas", file=sys.stderr)
    if not rows:
        return 1

    out = io.StringIO()
    out.write("-- Frente K · seed restricted_areas — gerado por scrapers/restricoes_seed.py\n")
    out.write("-- Fontes: CNUC/MMA 2026-03 (UCs), FUNAI/CMR (TIs), SICAFI/IBAMA 2026-02\n")
    out.write(f"-- (embargos). {len(rows)} feições, bbox PR, simplificação ~11 m (screening).\n")
    out.write("-- Sem PII do embargado (minimização LGPD).\n\n")
    for i in range(0, len(rows), CHUNK):
        out.write("insert into public.restricted_areas (kind, nome, categoria, detalhe, ref_doc, area_ha, geom) values\n")
        vals = []
        for r in rows[i : i + CHUNK]:
            try:
                area = f"{float(r['area_ha']):.2f}" if r["area_ha"] not in (None, "") else "null"
            except (TypeError, ValueError):
                area = "null"
            vals.append(
                f"('{r['kind']}','{r['nome']}','{r['categoria']}','{r['detalhe']}','{r['ref_doc']}',{area},"
                f"extensions.st_multi(extensions.st_geomfromtext('{r['wkt']}', 4326)))"
            )
        out.write(",\n".join(vals))
        out.write("\non conflict do nothing;\n\n")

    with open(args.out, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(out.getvalue())
    print(f"{len(rows)} restrições -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
