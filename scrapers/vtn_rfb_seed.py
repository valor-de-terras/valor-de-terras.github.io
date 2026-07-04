# -*- coding: utf-8 -*-
"""Gera o seed SQL de price_refs (fonte VTN_RFB) a partir do PDF oficial da
Receita Federal (SIPT). Frente G do roadmap (preço multi-fonte com pesos).

Uso:
  py -3 vtn_rfb_seed.py --pdf vtn2025.pdf --ano 2025 --uf PR --out seed_vtn.sql

O PDF é a "planilha VTN" nacional (gov.br/receitafederal → documentos técnicos →
VTN). Estrutura extraída (PyMuPDF, texto sequencial): UF, NOME MUNICIPIO,
6 valores R$/ha (lavoura boa/regular/restrita, pastagem plantada, silvicultura
ou pastagem natural, preservação), fonte (1=município, 2=órgão estadual).

Mapeamento p/ categorias do motor (deral_ref usa A/B/C):
  A (lavoura)        <- Lavoura Aptidão Boa
  B (pastagem)       <- Pastagem Plantada
  C (campo/floresta) <- Silvicultura ou Pastagem Natural

Gotchas:
  - gov.br exige User-Agent de navegador (403 sem ele); use --url p/ baixar.
  - Nomes vêm em caixa alta sem acento; normalizamos apóstrofos p/ casar com
    o municipio_norm do deral_ref (ex.: DIAMANTE D'OESTE -> DIAMANTE DOESTE).
"""

from __future__ import annotations

import argparse
import io
import re
import sys
import urllib.request

UFS = {
    "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS",
    "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC",
    "SE", "SP", "TO",
}
HEADER_TOKENS = {
    "UF", "Fonte", "Nome Município", "Nome Munic", "Lavoura", "Pastagem",
    "Silvicultura ou", "Preservação da", "Aptidão Boa", "Aptidão Restrita",
}
NUM_RE = re.compile(r"^\d{1,3}(\.\d{3})*(,\d{2})?$")
SEM_INFO_RE = re.compile(r"^s/\s*informa\S*\s*$", re.IGNORECASE)
# coluna sem dado colada no valor seguinte pelo extrator ("s/informação 53.655,00")
SEM_INFO_MERGED_RE = re.compile(r"^(s/\s*informa\S*)\s+(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)$", re.IGNORECASE)

# Colunas na ordem do PDF -> (categoria do motor, rótulo da fonte)
COLMAP = [
    ("A", "Lavoura Aptidão Boa"),
    (None, "Lavoura Aptidão Regular"),
    (None, "Lavoura Aptidão Restrita"),
    ("B", "Pastagem Plantada"),
    ("C", "Silvicultura ou Pastagem Natural"),
    (None, "Preservação da Fauna e da Flora"),
]


def br_to_float(s: str) -> float:
    return float(s.replace(".", "").replace(",", "."))


def norm_muni(name: str) -> str:
    """Normaliza como o deral_ref: caixa alta, sem acento, sem apóstrofo."""
    n = name.upper().strip()
    n = n.replace("'", "").replace("`", "").replace("’", "")
    n = re.sub(r"\s+", " ", n)
    return n


def is_header_line(line: str) -> bool:
    stripped = line.strip()
    return any(stripped.startswith(tok) for tok in HEADER_TOKENS) and not NUM_RE.match(stripped)


def parse_pdf(pdf_bytes: bytes, uf_filter: str) -> list[dict]:
    import fitz  # PyMuPDF

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    lines: list[str] = []
    for page in doc:
        for raw in page.get_text().splitlines():
            raw = raw.strip()
            merged = SEM_INFO_MERGED_RE.match(raw)
            if merged:
                # separa "s/informação 53.655,00" em dois tokens de coluna
                lines.append(merged.group(1))
                lines.append(merged.group(2))
            else:
                lines.append(raw)

    def is_value(tok: str) -> bool:
        return bool(NUM_RE.match(tok) or SEM_INFO_RE.match(tok))

    rows: list[dict] = []
    i = 0
    n = len(lines)
    while i < n:
        line = lines[i]
        if line in UFS:
            # candidato a registro: UF, nome, 6 valores (número ou s/informação), fonte
            if i + 8 < n:
                name = lines[i + 1]
                vals = [lines[i + 2 + k] for k in range(6)]
                fonte = lines[i + 8]
                if (
                    name
                    and not is_value(name)
                    and all(is_value(v) for v in vals)
                    and fonte in ("1", "2")
                ):
                    if line == uf_filter:
                        rows.append({
                            "uf": line,
                            "municipio": name,
                            "valores": [
                                br_to_float(v) if NUM_RE.match(v) else None
                                for v in vals
                            ],
                            "fonte": fonte,
                        })
                    i += 9
                    continue
                if line == uf_filter and name and not is_value(name) and name not in ("UF", "Fonte"):
                    # registro com colunas faltando sem marcador (célula em branco no
                    # PDF): impossível saber qual coluna sumiu; pula com aviso em vez
                    # de chutar (o blend do motor renormaliza sem esta fonte)
                    print(f"AVISO: registro ambíguo pulado: {line} {name}", file=sys.stderr)
        i += 1
    return rows


def build_sql(rows: list[dict], ano: int, uf: str) -> str:
    out = io.StringIO()
    out.write("-- Frente G · seed VTN/Receita Federal (SIPT) — gerado por scrapers/vtn_rfb_seed.py\n")
    out.write(f"-- Fonte: planilha VTN {ano} da RFB (PDF oficial). Valores em R$/ha, terra nua.\n")
    out.write(f"-- {len(rows)} municípios de {uf}; categorias A=lavoura boa, B=pastagem plantada,\n")
    out.write("-- C=silvicultura/pastagem natural. Fonte 1=município, 2=órgão estadual (SIPT).\n\n")
    out.write("insert into public.price_refs (source, uf, municipio_norm, categoria, aptidao_fonte, valor_ha, ano) values\n")
    values = []
    for row in rows:
        muni = norm_muni(row["municipio"]).replace("'", "''")
        for idx, (cat, label) in enumerate(COLMAP):
            if cat is None:
                continue
            val = row["valores"][idx]
            if val is None or val <= 0:
                continue
            origem = "município" if row["fonte"] == "1" else "órgão estadual"
            values.append(
                f"('VTN_RFB','{row['uf']}','{muni}','{cat}','{label} ({origem})',{val:.2f},{ano})"
            )
    out.write(",\n".join(values))
    out.write("\non conflict do nothing;\n")
    return out.getvalue()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", help="caminho local do PDF")
    ap.add_argument("--url", help="URL do PDF (gov.br exige UA de navegador)")
    ap.add_argument("--ano", type=int, required=True)
    ap.add_argument("--uf", default="PR")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    if args.pdf:
        with open(args.pdf, "rb") as fh:
            pdf_bytes = fh.read()
    elif args.url:
        req = urllib.request.Request(args.url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
        })
        with urllib.request.urlopen(req, timeout=120) as resp:
            pdf_bytes = resp.read()
    else:
        print("informe --pdf ou --url", file=sys.stderr)
        return 2

    rows = parse_pdf(pdf_bytes, args.uf)
    if not rows:
        print("nenhum registro extraído; layout do PDF pode ter mudado", file=sys.stderr)
        return 1

    sql = build_sql(rows, args.ano, args.uf)
    with open(args.out, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(sql)
    print(f"{len(rows)} municípios de {args.uf} -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
