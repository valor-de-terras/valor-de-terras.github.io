# -*- coding: utf-8 -*-
"""Gera o seed SQL de price_refs (fonte INCRA) a partir da PPR da SR(09)PR.
Frente G do roadmap (preço multi-fonte com pesos).

Uso:
  py -3 incra_ppr_seed.py --pdf PPR_SR09_2024_real.pdf --ano 2024 --out seed_incra.sql

A PPR (Planilha de Preços Referenciais de Terras) publica valores por MRT
(Mercado Regional de Terras), não por município. Cada MRT tem uma página VTI
e uma VTN; usamos APENAS a página VTN (terra nua, comparável ao motor).
A lista de "Abrangência" da página é expandida para um registro por município.

Mapeamento p/ categorias do motor:
  A (lavoura)        <- média VTN da tipologia "Agrícola"
  B (pastagem)       <- média VTN da tipologia "Pecuária"
  C (campo/floresta) <- "Vegetação Nativa" (se houver), senão "Floresta Plantada"

Gotchas:
  - PPR 2024 cobre 6 dos 8 MRTs do PR (sem Litoral/RMC e Norte Pioneiro núcleo);
    municípios fora ficam sem INCRA e o blend do motor renormaliza os pesos.
  - URLs .pdf do Plone (gov.br/incra) servem viewer HTML; baixar com sufixo
    /@@download/file.
  - Nomes com apóstrofo (Itapejara D'Oeste) normalizam p/ o padrão do deral_ref
    (ITAPEJARA DOESTE).
"""

from __future__ import annotations

import argparse
import io
import re
import sys
import unicodedata

TIPOLOGIAS_1N = {
    "Geral",
    "Agrícola",
    "Exploração Mista",
    "Pecuária",
    "Floresta Plantada",
    "Vegetação Nativa",
}
NUM_DEC_RE = re.compile(r"^\d{1,3}(\.\d{3})*,\d{2}$")
NUM_INT_RE = re.compile(r"^\d+$")
MRT_RE = re.compile(r"MRT:\s*(\d+)\s*-\s*(.+)")

# grafias divergentes do INCRA -> nome oficial IBGE (padrão do deral_ref)
ALIASES = {
    "MUNHOZ DE MELLO": "MUNHOZ DE MELO",
}


def br_to_float(s: str) -> float:
    return float(s.replace(".", "").replace(",", "."))


def norm_muni(name: str) -> str:
    """Normaliza como o deral_ref: caixa alta, sem acento, sem apóstrofo."""
    n = unicodedata.normalize("NFD", name)
    n = "".join(c for c in n if unicodedata.category(c) != "Mn")
    n = n.upper().strip()
    for apos in ("'", "`", "’", "‘", "´"):
        n = n.replace(apos, "")
    n = re.sub(r"\s+", " ", n)
    return ALIASES.get(n, n)


def parse_vtn_pages(pdf_path: str) -> list[dict]:
    import fitz  # PyMuPDF

    doc = fitz.open(pdf_path)
    mrts: list[dict] = []
    for page in doc:
        text = page.get_text()
        if "Planilha VTN" not in text:
            continue  # página VTI, capa ou ofício
        lines = [l.strip() for l in text.splitlines()]

        m = next((MRT_RE.search(l) for l in lines if MRT_RE.search(l)), None)
        if not m:
            print("AVISO: página VTN sem cabeçalho MRT; pulada", file=sys.stderr)
            continue
        mrt_num, mrt_nome = int(m.group(1)), m.group(2).strip()

        # abrangência: linhas entre "Planilha VTN..." e o próximo "Estatísticas"
        start = next(i for i, l in enumerate(lines) if l.startswith("Planilha VTN"))
        end = next(
            (i for i in range(start + 1, len(lines)) if l_starts_stats(lines[i])),
            len(lines),
        )
        abr_text = re.sub(r"\s+", " ", " ".join(lines[start + 1 : end])).strip()
        abr_text = abr_text.rstrip(".")
        # último item vem como "... , Uniflor e Xambrê"
        abr_text = re.sub(r"\s+e\s+(?=[^,]+$)", ", ", abr_text)
        municipios = [p.strip() for p in abr_text.split(",") if p.strip()]

        # médias por tipologia de 1º nível: label seguido de
        # pré-san(int), discrepantes(int), pós-san(int), Média(dec)
        medias: dict[str, float] = {}
        for i, l in enumerate(lines):
            if l in TIPOLOGIAS_1N and i + 4 < len(lines):
                nums = lines[i + 1 : i + 5]
                if (
                    all(NUM_INT_RE.match(x) for x in nums[:3])
                    and NUM_DEC_RE.match(nums[3])
                ):
                    medias[l] = br_to_float(nums[3])

        mrts.append({
            "mrt": mrt_num,
            "nome": mrt_nome,
            "municipios": municipios,
            "medias": medias,
        })
    return mrts


def l_starts_stats(line: str) -> bool:
    return line.startswith("Estatísticas descritivas") or line.startswith("Estat")


def build_sql(mrts: list[dict], ano: int, uf: str) -> str:
    out = io.StringIO()
    total_munis = sum(len(m["municipios"]) for m in mrts)
    out.write("-- Frente G · seed INCRA PPR SR(09)PR — gerado por scrapers/incra_ppr_seed.py\n")
    out.write(f"-- Fonte: Planilha de Preços Referenciais de Terras {ano} (VTN/ha por MRT),\n")
    out.write("-- expandida por município via lista de abrangência de cada MRT.\n")
    out.write(f"-- {len(mrts)} MRTs, {total_munis} municípios. A=Agrícola, B=Pecuária,\n")
    out.write("-- C=Vegetação Nativa (fallback Floresta Plantada). MRTs ausentes da PPR\n")
    out.write("-- (Litoral/RMC, Norte Pioneiro núcleo) ficam sem INCRA; o blend renormaliza.\n\n")
    out.write("insert into public.price_refs (source, uf, municipio_norm, regiao, categoria, aptidao_fonte, valor_ha, ano) values\n")

    values = []
    for m in mrts:
        regiao = f"MRT {m['mrt']:02d} - {m['nome']}".replace("'", "''")
        cats: list[tuple[str, str, float]] = []
        if m["medias"].get("Agrícola"):
            cats.append(("A", "VTN médio tipologia Agrícola", m["medias"]["Agrícola"]))
        if m["medias"].get("Pecuária"):
            cats.append(("B", "VTN médio tipologia Pecuária", m["medias"]["Pecuária"]))
        if m["medias"].get("Vegetação Nativa"):
            cats.append(("C", "VTN médio tipologia Vegetação Nativa", m["medias"]["Vegetação Nativa"]))
        elif m["medias"].get("Floresta Plantada"):
            cats.append(("C", "VTN médio tipologia Floresta Plantada", m["medias"]["Floresta Plantada"]))
        if not cats:
            print(f"AVISO: MRT {m['mrt']} sem médias parseadas; pulado", file=sys.stderr)
            continue
        for muni in m["municipios"]:
            muni_norm = norm_muni(muni).replace("'", "''")
            for cat, label, val in cats:
                values.append(
                    f"('INCRA','{uf}','{muni_norm}','{regiao}','{cat}','{label} (PPR {ano})',{val:.2f},{ano})"
                )
    out.write(",\n".join(values))
    out.write("\non conflict do nothing;\n")
    return out.getvalue()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", required=True, help="caminho local do PDF da PPR")
    ap.add_argument("--ano", type=int, required=True)
    ap.add_argument("--uf", default="PR")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    mrts = parse_vtn_pages(args.pdf)
    if not mrts:
        print("nenhuma página VTN parseada; layout do PDF pode ter mudado", file=sys.stderr)
        return 1

    for m in mrts:
        print(
            f"MRT {m['mrt']:02d} {m['nome']}: {len(m['municipios'])} municípios, "
            f"médias {sorted(m['medias'])}"
        )

    sql = build_sql(mrts, args.ano, args.uf)
    with open(args.out, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(sql)
    print(f"{sum(len(m['municipios']) for m in mrts)} municípios -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
