#!/usr/bin/env python3
"""
Scraper piloto (Frente B) — imóveis à venda da CAIXA (fonte pública).

A CAIXA publica, por estado, uma lista CSV pública de imóveis à venda (muitos de
leilão/retomada). É estruturada, atualizada diariamente e legal de usar. Serve para
alimentar a base própria de comparáveis (market_listings) com preço, área, município,
tipo e modalidade — e, ao reexecutar ao longo do tempo, o tempo de anúncio (iliquidez).

Somente stdlib. Preserva acentos pt-BR (fonte em latin-1 -> str Unicode).

Uso:
  # valida o parse sem tocar o banco (imprime amostra + estatísticas)
  py -3 scrapers/caixa_imoveis.py --uf PR --dry-run --limit 5

  # carrega no Supabase (precisa das env vars abaixo); service role NUNCA vai pro git
  set SUPABASE_URL=https://ejwzqrrudgweglxkktan.supabase.co
  set SUPABASE_SERVICE_ROLE_KEY=****
  py -3 scrapers/caixa_imoveis.py --uf PR --upsert
"""
import argparse
import csv
import datetime
import hashlib
import io
import json
import os
import re
import sys
import unicodedata
import urllib.request

CSV_URL = "https://venda-imoveis.caixa.gov.br/listaweb/Lista_imoveis_{uf}.csv"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) valor-de-terras-pesquisa/1.0"

# tipos que tratamos como terra/rural (candidatos a comparável rural)
RURAL_TIPOS = {
    "terreno", "gleba", "lote", "area", "área", "fazenda", "sitio", "sítio",
    "chacara", "chácara", "rural", "gleba rural", "terreno rural",
}


def strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def norm_muni(s: str) -> str:
    return strip_accents((s or "").strip()).lower()


def to_num(s):
    """Converte número BR ('1.331.000,00') ou ponto-decimal ('197270.00') em float."""
    s = (s or "").strip()
    s = re.sub(r"[^\d.,-]", "", s)
    if not s:
        return None
    if "," in s and "." in s:          # BR: '.' milhar, ',' decimal
        s = s.replace(".", "").replace(",", ".")
    elif "," in s:                       # só vírgula = decimal
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def listing_kind_of(modalidade: str) -> str:
    m = norm_muni(modalidade)
    if "leilao" in m:
        return "leilao_sfi"
    if "licitacao" in m:
        return "licitacao"
    if "direta" in m:
        return "venda_direta"
    if "online" in m:
        return "venda_online"
    return m or None


def parse_desc(desc: str):
    """Extrai tipo e áreas da coluna Descrição da CAIXA.
    Ex.: 'Terreno, 0.00 de área total, 0.00 de área privativa, 197270.00 de área do terreno.'
    """
    desc = (desc or "").strip()
    tipo = desc.split(",")[0].strip() if desc else ""
    m_total = re.search(r"([\d.,]+)\s+de\s+[áa]rea\s+total", desc, re.I)
    m_terr = re.search(r"([\d.,]+)\s+de\s+[áa]rea\s+do\s+terreno", desc, re.I)
    area_total = to_num(m_total.group(1)) if m_total else None
    area_terreno = to_num(m_terr.group(1)) if m_terr else None
    return tipo, area_total, area_terreno


def fetch_csv(uf: str) -> str:
    url = CSV_URL.format(uf=uf.upper())
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=90) as resp:
        raw = resp.read()
    return raw.decode("latin-1")  # fonte é latin-1; vira str Unicode (acentos ok)


def parse_listing(text: str):
    """Localiza o cabeçalho real e devolve dicts com as colunas da CAIXA."""
    lines = text.splitlines()
    hidx = None
    for i, ln in enumerate(lines):
        if ln.count(";") >= 6 and re.search(r"do\s+im[oó]vel", ln, re.I):
            hidx = i
            break
    if hidx is None:
        raise RuntimeError("cabeçalho não encontrado no CSV da CAIXA")
    reader = csv.reader(io.StringIO("\n".join(lines[hidx:])), delimiter=";")
    header = [h.strip() for h in next(reader)]
    for row in reader:
        if not row or not any(c.strip() for c in row):
            continue
        yield dict(zip(header, [c.strip() for c in row]))


def col(d: dict, *cands):
    for k in d:
        kn = norm_muni(k)
        for c in cands:
            if c in kn:
                return d[k]
    return ""


def normalize(d: dict):
    source_id = col(d, "no do imovel", "imovel").strip()
    if not source_id:
        return None
    uf = col(d, "uf").strip().upper()
    municipio = col(d, "cidade").strip()
    bairro = col(d, "bairro").strip()
    endereco = col(d, "endereco").strip()
    preco = to_num(col(d, "preco"))
    preco_aval = to_num(col(d, "valor de avaliacao", "avaliacao"))
    desconto = to_num(col(d, "desconto"))
    modalidade = col(d, "modalidade").strip()
    url = col(d, "link").strip()
    tipo, area_total, area_terreno = parse_desc(col(d, "descricao"))

    area_m2 = area_terreno if (area_terreno or 0) > 0 else area_total
    area_ha = round(area_m2 / 10000.0, 4) if area_m2 else None
    preco_m2 = round(preco / area_m2, 2) if (preco and area_m2 and area_m2 > 0) else None
    rural = norm_muni(tipo) in RURAL_TIPOS
    kind = listing_kind_of(modalidade)
    price_basis = "lance_leilao" if kind == "leilao_sfi" else "oferta"
    fin = col(d, "financiamento").strip().lower()
    financiamento = True if fin.startswith("s") else (False if fin.startswith("n") else None)
    content_hash = hashlib.sha256(
        f"caixa|{source_id}|{preco}|{area_m2}|{preco_m2}".encode("utf-8")
    ).hexdigest()

    return {
        "source": "caixa",
        "source_id": source_id,
        "url": url or None,
        "listing_kind": kind,
        "price_basis": price_basis,
        "tipo_imovel": tipo or None,
        "rural": rural,
        "uf": uf or None,
        "municipio": municipio or None,
        "municipio_norm": norm_muni(municipio) or None,
        "bairro": bairro or None,
        "endereco": endereco or None,
        "area_m2": area_m2,
        "area_ha": area_ha,
        "area_origin": "regex_descricao",
        "preco": preco,
        "preco_avaliacao": preco_aval,
        "desconto_pct": desconto,
        "preco_m2": preco_m2,
        "financiamento": financiamento,
        "content_hash": content_hash,
        "payload_raw": d,
    }


def _rest(url, key, path, method, body=None, prefer=None):
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    req = urllib.request.Request(f"{url}/rest/v1/{path}", data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=90) as resp:
        raw = resp.read()
        if resp.status not in (200, 201, 204):
            raise RuntimeError(f"{method} {path}: HTTP {resp.status}")
        return json.loads(raw) if raw else None


def load(records, source="caixa", uf=None, batch=200):
    """Grava a coleta: scrape_run -> market_listings (upsert) -> listing_snapshots (1/anúncio/dia)."""
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        sys.exit("Faltam SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no ambiente.")
    today = datetime.date.today().isoformat()

    run = _rest(url, key, "scrape_runs", "POST",
                {"source": source, "uf": uf, "n_rows": len(records)}, "return=representation")
    run_id = run[0]["id"] if run else None

    total = 0
    for i in range(0, len(records), batch):
        chunk = records[i : i + batch]
        _rest(url, key, "market_listings?on_conflict=source,source_id", "POST", chunk,
              "resolution=merge-duplicates,return=minimal")
        total += len(chunk)
        print(f"  market_listings {total}/{len(records)}")

    snaps = [{
        "source": r["source"], "source_id": r["source_id"], "snapshot_date": today,
        "run_id": run_id, "preco": r["preco"], "area_m2": r["area_m2"],
        "content_hash": r["content_hash"], "present": True,
    } for r in records]
    sn = 0
    for i in range(0, len(snaps), batch):
        chunk = snaps[i : i + batch]
        _rest(url, key, "listing_snapshots?on_conflict=source,source_id,snapshot_date", "POST",
              chunk, "resolution=merge-duplicates,return=minimal")
        sn += len(chunk)
        print(f"  listing_snapshots {sn}/{len(snaps)}")

    if run_id:
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        _rest(url, key, f"scrape_runs?id=eq.{run_id}", "PATCH", {"finished_at": now_iso}, "return=minimal")
    return total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--uf", default="PR", help="UF(s) separadas por vírgula, ou 'all'")
    ap.add_argument("--dry-run", action="store_true", help="parseia e mostra amostra, sem gravar")
    ap.add_argument("--upsert", action="store_true", help="grava no Supabase (service role)")
    ap.add_argument("--rural-only", action="store_true", help="só imóveis do tipo terra/rural")
    ap.add_argument("--limit", type=int, default=0, help="mostra N amostras no dry-run")
    args = ap.parse_args()

    ALL = ("AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO").split()
    ufs = ALL if args.uf.lower() == "all" else [u.strip().upper() for u in args.uf.split(",")]

    records = []
    for uf in ufs:
        try:
            text = fetch_csv(uf)
        except Exception as e:
            print(f"[{uf}] falha ao baixar: {e}", file=sys.stderr)
            continue
        n_uf = 0
        for d in parse_listing(text):
            rec = normalize(d)
            if not rec:
                continue
            if args.rural_only and not rec["rural"]:
                continue
            records.append(rec)
            n_uf += 1
        print(f"[{uf}] {n_uf} registros")

    total = len(records)
    rurais = sum(1 for r in records if r["rural"])
    com_area = sum(1 for r in records if r["area_m2"])
    com_preco = sum(1 for r in records if r["preco"])
    print(f"\nTOTAL: {total} | rural(terra): {rurais} | com área: {com_area} | com preço: {com_preco}")

    if args.dry_run:
        n = args.limit or 3
        print(f"\n--- {n} amostras (rural primeiro) ---")
        sample = sorted(records, key=lambda r: (not r["rural"], -(r["area_ha"] or 0)))[:n]
        for r in sample:
            slim = {k: v for k, v in r.items() if k != "payload_raw"}
            print(json.dumps(slim, ensure_ascii=False, indent=2))
        return

    if args.upsert:
        if total == 0:
            sys.exit("ERRO: nenhum registro coletado (a fonte pode ter bloqueado o IP). Upsert abortado.")
        print(f"\nGravando {total} registros no Supabase...")
        n = load(records, uf=",".join(ufs))
        print(f"OK: {n} registros gravados (market_listings + listing_snapshots).")
        return

    print("\nNada gravado (use --dry-run ou --upsert).")


if __name__ == "__main__":
    main()
