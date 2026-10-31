"""Build the AD index: xlsx -> records -> Federal Register full text -> section chunks -> SQLite FTS5.

Usage:
    python ingest.py             # fetch full text (cached in data/fr_cache/) and build data/ads.db
    python ingest.py --no-fetch  # summaries only (offline)
"""
import argparse
import html
import json
import re
import sqlite3
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

import httpx
import openpyxl

ROOT = Path(__file__).parent
XLSX = ROOT / "data/raw/ad_nprm.xlsx"
CACHE = ROOT / "data/fr_cache"
DB = ROOT / "data/ads.db"

FR_API = "https://www.federalregister.gov/api/v1/documents/{}.json"
FR_SEARCH = "https://www.federalregister.gov/api/v1/documents.json"
FR_HOST = "https://www.federalregister.gov/"
RESOLVED = CACHE / "_resolved.json"
MAX_BYTES = 2_000_000
CHUNK_CHARS = 1500

SUPERSEDE_RE = re.compile(r"\bAD\)?\s*(\d{4}-\d{2}-\d{2})")
# The link column holds full URLs, short /d/ URLs, "original + Withdrawal:" pairs, or pasted rule text.
DOCNO_RE = re.compile(r"federalregister\.gov/(?:documents/\d{4}/\d{2}/\d{2}/|d/)(\d{4}-\d+)")
PAGES_RE = re.compile(r"(\d+)\s*-\s*(\d+)")
PAGE_MARK_RE = re.compile(r"^\[\[Page (\d+)\]\]$")
AD_SECTION_RE = re.compile(r"^\(([a-z]{1,2})\) ([A-Z][^.]{2,80})$")
PREAMBLE_HEAD_RE = re.compile(r"^([A-Z][A-Z ,'/-]{3,60}):")
WITHDRAW_RE = re.compile(r"\bwithdraw(?:s|ing)\b[^.]{0,80}?\b(?:notices? of proposed rulemaking|S?NPRMs?)", re.I)

# "Model A310-203, -204, and -221 airplanes" / "Models 401, 401A and 402 airplanes"
MODEL_LIST_RE = re.compile(
    r"\bModels?\s+((?:(?!\bModels?\b).){1,400}?)\s+(?:series\s+)?(?:airplanes?|helicopters?|rotorcraft|gliders?|"
    r"(?:turbo\w+\s+)?engines?|propellers?)\b", re.I)
# "PW210A and PW210S model turboshaft engines" (model name before the word "model")
MODEL_AFTER_RE = re.compile(r"applies to (?:all |certain )?(.{1,200}?)\s+model\s+(?:turbo\w+\s+)?engines", re.I)
MODEL_TOKEN_RE = re.compile(r"^[A-Z0-9][A-Za-z0-9 .\-/+]{0,28}$")
BARE_SUFFIX_RE = re.compile(r"^\d{2,3}[A-Z]{0,3}$")  # '253N' in '-252N, 253N' (hyphen missing in source)
NOT_MODEL = re.compile(r"\b(certificated|category|all|certain|with|installed|identified|serial|series|the|and|or)\b", re.I)


def parse_date(s):
    try:
        return datetime.strptime(s.strip(), "%m/%d/%Y").date().isoformat()
    except (ValueError, AttributeError):
        return None


def _clean(text):
    """Collapse whitespace and repair PDF line-wrap artifacts like 'B4- 622' and ', - 300'."""
    return re.sub(r"-\s+(?=[A-Za-z0-9])", "-", " ".join(text.split()))


def _expand(parts, take_last_word=False):
    """Expand a split model list: '-204' inherits the base of the previous model ('A310-203' -> 'A310-204');
    a bare token after a spaced first model inherits its prefix ('A300 B4-601, B4-603' -> 'A300 B4-603')."""
    out, base, prefix = [], None, None
    for i, p in enumerate(parts):
        p = re.sub(r"^(?:all|certain)\s+", "", p.strip(" ;:()"), flags=re.I)
        p = re.sub(r"\s+(?:series|variant\b.*)$", "", p, flags=re.I)
        if take_last_word and p:
            p = p.split()[-1]
        if not p:
            continue
        if p.startswith("-") and base:
            p = base + p
        elif base and out and BARE_SUFFIX_RE.match(p) and out[-1].startswith(base + "-"):
            p = f"{base}-{p}"
        elif i > 0 and prefix and " " not in p and not p.startswith(prefix.split()[0]):
            p = f"{prefix} {p}"
        if "-" in p.lstrip("-"):
            base = p.split("-")[0]
        if i == 0 and " " in p:
            prefix = p.rsplit(" ", 1)[0]
        if MODEL_TOKEN_RE.match(p) and re.search(r"\d", p) and not NOT_MODEL.search(p):
            out.append(p)
    return out


def parse_models(text):
    """Model designations named in an applicability paragraph or summary. Returns [] when nothing reliable."""
    text = _clean(text)
    split = lambda s: re.split(r",\s*(?:and\s+|or\s+)?|;\s*|\s+(?:and|or)\s+", s)
    models = []
    for m in MODEL_LIST_RE.finditer(text):
        models += _expand(split(m.group(1)))
    if not models:
        m = MODEL_AFTER_RE.search(text)
        if m:
            models = _expand(split(m.group(1)), take_last_word=True)
    return list(dict.fromkeys(models))


def is_withdrawal(subject, summary):
    return subject.lower().startswith("withdrawal") or bool(WITHDRAW_RE.search(" ".join(summary.split())[:300]))


def load_rows():
    wb = openpyxl.load_workbook(XLSX, read_only=True)
    ws = wb.worksheets[0]
    it = ws.iter_rows(values_only=True)
    header = [h.strip() if isinstance(h, str) else h for h in next(it)]
    rows = []
    for i, vals in enumerate(it):
        r = {h: ("" if v is None else str(v).strip()) for h, v in zip(header, vals)}
        if not r.get("Docket Number"):
            continue
        link = r.get("Link for Submitting Public Comment", "")
        docnos = DOCNO_RE.findall(link)
        p = PAGES_RE.search(r.get("Page Number", ""))
        summary = r.get("Summary", "")
        pasted = link.replace("\\n", "\n").replace("\\t", "\t")
        pasted = pasted[pasted.find("The "):] if "The Proposed Amendment" in pasted or "The Withdrawal" in pasted else ""
        rows.append({
            "id": len(rows),
            "docket": r["Docket Number"],
            "subject": r.get("Subject Heading", ""),
            "issue_date": parse_date(r.get("Issue Date", "")),
            "publish_date": parse_date(r.get("Citation Publish Date", "")),
            "comments_due": parse_date(r.get("Comments Due Date", "")),
            "ad_number": r.get("AD Number", ""),
            "make": r.get("Make", ""),
            "models": [m_.strip() for m_ in r.get("Model", "").split("|") if m_.strip()],
            "product_type": r.get("Product Type", ""),
            "product_subtype": r.get("Product Subtype", ""),
            # the row describes the last notice linked (e.g. the withdrawal, not the original NPRM)
            "fr_doc": docnos[-1] if docnos else "",
            "related_docs": docnos[:-1],
            "pasted_text": pasted,
            "withdrawn": is_withdrawal(r.get("Subject Heading", ""), summary),
            "citation": r.get("Citation", ""),
            "page_start": int(p.group(1)) if p else None,
            "page_end": int(p.group(2)) if p else None,
            "summary": summary,
            "supersedes": sorted(set(SUPERSEDE_RE.findall(summary))) if "supersede" in summary.lower() else [],
            "is_revision_notice": "revising a notice of proposed rulemaking" in summary.lower(),
        })
    return rows


def get(client, url, **kw):
    """GET with backoff on FR rate limiting (HTTP 429)."""
    for attempt in range(6):
        resp = client.get(url, **kw)
        if resp.status_code != 429:
            return resp
        time.sleep(5 * 2 ** attempt)
    return resp


def fetch_one(client, docno):
    out = CACHE / f"{docno}.txt"
    if out.exists():
        return docno, True
    try:
        meta = get(client, FR_API.format(docno), params={"fields[]": "raw_text_url"}).json()
        url = meta.get("raw_text_url") or ""
        if not url.startswith(FR_HOST):
            return docno, False
        resp = get(client, url)
        if resp.status_code != 200 or len(resp.content) > MAX_BYTES:
            return docno, False
        body = resp.text
        pre = re.search(r"<pre>(.*)</pre>", body, re.S)
        text = re.sub(r"<[^>]+>", "", pre.group(1) if pre else body)
        out.write_text(html.unescape(text))
        return docno, True
    except (httpx.HTTPError, ValueError):
        return docno, False


def resolve_one(client, row):
    """Find the FR document number for a row with no usable link: same docket, same start page."""
    try:
        res = get(client, FR_SEARCH, params={"conditions[docket_id]": row["docket"], "per_page": 50,
                                            "fields[]": ["document_number", "start_page", "publication_date"]}).json()
    except (httpx.HTTPError, ValueError):
        return None
    for d in res.get("results", []):
        if row["page_start"] and d.get("start_page") == row["page_start"]:
            return d["document_number"]
    return None


def resolve_missing(rows):
    resolved = json.loads(RESOLVED.read_text()) if RESOLVED.exists() else {}
    todo = [r for r in rows if not r["fr_doc"] and not resolved.get(f"{r['docket']}|{r['page_start']}")]
    if todo:
        with httpx.Client(timeout=20, follow_redirects=False) as client, ThreadPoolExecutor(2) as ex:
            for r, doc in zip(todo, ex.map(lambda r: resolve_one(client, r), todo)):
                resolved[f"{r['docket']}|{r['page_start']}"] = doc
        RESOLVED.write_text(json.dumps(resolved, indent=1, sort_keys=True))
    n = 0
    for r in rows:
        if not r["fr_doc"]:
            r["fr_doc"] = resolved.get(f"{r['docket']}|{r['page_start']}") or ""
            n += bool(r["fr_doc"])
    print(f"resolved {n} rows without a usable link via FR docket search")


def finalize_urls(rows):
    for r in rows:
        r["url"] = f"{FR_HOST}d/{r['fr_doc']}" if r["fr_doc"] else ""


def fetch_all(rows):
    CACHE.mkdir(parents=True, exist_ok=True)
    resolve_missing(rows)
    docs = sorted({r["fr_doc"] for r in rows if r["fr_doc"]})
    with httpx.Client(timeout=20, follow_redirects=False) as client, ThreadPoolExecutor(2) as ex:
        results = list(ex.map(lambda d: fetch_one(client, d), docs))
    ok = sum(1 for _, good in results if good)
    print(f"fetched/cached {ok}/{len(docs)} Federal Register documents")


def split_sections(text, first_page):
    """Yield (section, page, text) from FR full text. AD rule paragraphs (a), (b)... become their own sections."""
    page = first_page
    section = "Preamble"
    buf, buf_page = [], page
    in_rule = False

    def flush():
        body = "\n".join(buf).strip()
        if body:
            yield section, buf_page, body

    for line in text.splitlines():
        s = line.strip()
        pm = PAGE_MARK_RE.match(s)
        if pm:
            page = int(pm.group(1))
            continue
        if "amends Sec.  39.13" in s or "amend 14 CFR part 39" in s:
            in_rule = True
        new_section = None
        am = AD_SECTION_RE.match(s) if in_rule else None
        if am:
            new_section = f"({am.group(1)}) {am.group(2)}"
        elif not in_rule:
            hm = PREAMBLE_HEAD_RE.match(s)
            if hm:
                new_section = hm.group(1).title()
        if new_section or sum(len(b) for b in buf) > CHUNK_CHARS:
            yield from flush()
            buf, buf_page = [], page
            if new_section:
                section = new_section
        buf.append(line.rstrip())
    yield from flush()


def build(rows, use_fulltext):
    DB.parent.mkdir(parents=True, exist_ok=True)
    if DB.exists():
        DB.unlink()
    con = sqlite3.connect(DB)
    con.executescript("""
        CREATE TABLE ads (id INTEGER PRIMARY KEY, docket TEXT, data TEXT);
        CREATE TABLE chunks (id INTEGER PRIMARY KEY, ad_id INTEGER, section TEXT, page INTEGER, text TEXT);
        CREATE VIRTUAL TABLE chunks_fts USING fts5(text, subject, models, content='', tokenize='porter unicode61');
    """)
    n_full = pages = 0
    for r in rows:
        status = "proposed"
        cached = CACHE / f"{r['fr_doc']}.txt" if r["fr_doc"] else None
        chunks = []
        if use_fulltext and cached and cached.exists():
            text = cached.read_text()
            if "[Rules and Regulations]" in text[:600]:
                status = "final"
            chunks = list(split_sections(text, r["page_start"]))
            n_full += 1
            if r["page_start"] and r["page_end"]:
                pages += r["page_end"] - r["page_start"] + 1
            appl = next((t for s, _, t in chunks if s.endswith("Applicability")), "")
        else:
            appl = ""
        if not chunks and r["pasted_text"]:
            chunks = list(split_sections(r["pasted_text"], r["page_start"]))
            for s, _, t in chunks:
                if not appl and "Applicability" in t[:400]:
                    appl = t
        if not chunks:
            chunks = [("Summary", r["page_start"], r["summary"])]
        else:
            chunks.insert(0, ("Summary", r["page_start"], r["summary"]))
        if r["ad_number"] and status == "proposed":
            status = "final"
        if r["withdrawn"]:
            status = "withdrawn"
        r["status"] = status
        r["applicability_text"] = appl
        r["models_source"] = "sheet" if r["models"] else None
        if not r["models"]:
            for source, text in (("applicability", appl), ("summary", r["summary"])):
                parsed = parse_models(text) if text else []
                if parsed:
                    r["models"], r["models_source"] = parsed, source
                    break
        r["fulltext"] = bool(appl) or len(chunks) > 1
        con.execute("INSERT INTO ads VALUES (?,?,?)", (r["id"], r["docket"], json.dumps(r)))
        for section, page, body in chunks:
            cur = con.execute("INSERT INTO chunks (ad_id, section, page, text) VALUES (?,?,?,?)",
                              (r["id"], section, page, body))
            con.execute("INSERT INTO chunks_fts (rowid, text, subject, models) VALUES (?,?,?,?)",
                        (cur.lastrowid, body, r["subject"], " ".join(r["models"])))
    con.commit()
    n_chunks = con.execute("SELECT count(*) FROM chunks").fetchone()[0]
    print(f"indexed {len(rows)} rows, {n_chunks} chunks; full text for {n_full} rows (~{pages} FR pages)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-fetch", action="store_true", help="skip Federal Register download")
    args = ap.parse_args()
    if not XLSX.exists():
        sys.exit(f"missing {XLSX}")
    rows = load_rows()
    if not args.no_fetch:
        fetch_all(rows)
    elif RESOLVED.exists():
        resolved = json.loads(RESOLVED.read_text())
        for r in rows:
            r["fr_doc"] = r["fr_doc"] or resolved.get(f"{r['docket']}|{r['page_start']}") or ""
    finalize_urls(rows)
    build(rows, use_fulltext=CACHE.exists())


if __name__ == "__main__":
    main()
