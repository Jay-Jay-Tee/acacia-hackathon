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

from rules import embed_text, parse_models  # noqa: F401  (parse_models re-exported for tests)

ROOT = Path(__file__).parent
XLSX = ROOT / "data/raw/ad_nprm.xlsx"
CACHE = ROOT / "data/fr_cache"
DB = ROOT / "data/ads.db"
EMB = ROOT / "data/emb.npy"            # gitignored; built by --embed
EMB_META = ROOT / "data/emb_meta.json"
EMB_MODEL = "BAAI/bge-small-en-v1.5"

FR_API = "https://www.federalregister.gov/api/v1/documents/{}.json"
FR_SEARCH = "https://www.federalregister.gov/api/v1/documents.json"
FR_HOST = "https://www.federalregister.gov/"
RESOLVED = CACHE / "_resolved.json"
MAX_BYTES = 2_000_000
CHUNK_CHARS = 1500

SUPERSEDE_RE = re.compile(r"\bAD\)?\s*(\d{4}-\d{2}-\d{2})")
# The link column holds full URLs, short /d/ URLs, "original + Withdrawal:" pairs, or pasted rule text.
DOCNO_RE = re.compile(r"federalregister\.gov/(?:documents/\d{4}/\d{2}/\d{2}/|d/|a/)((?:R\d-)?\d{4}-\d+)")
INDEX = ROOT / "data/raw/challenge4_ad_index.xlsx"  # organisers' index (31 Oct update): record_id, ISO dates
PAGES_RE = re.compile(r"(\d+)\s*-\s*(\d+)")
PAGE_MARK_RE = re.compile(r"^\[\[Page (\d+)\]\]$")
AD_SECTION_RE = re.compile(r"^\(([a-z]{1,2})\) ([A-Z][^.]{2,80})$")
PREAMBLE_HEAD_RE = re.compile(r"^([A-Z][A-Z ,'/-]{3,60}):")
CFR_PART_RE = re.compile(r"\b14 CFR Parts? (\d+)")
AD_WORDS_RE = re.compile(r"airworthiness directive|\bAD\b|\bADs\b|NPRM|proposed rulemaking", re.I)
WITHDRAW_RE = re.compile(r"\bwithdraw(?:s|ing)\b[^.]{0,80}?\b(?:notices? of proposed rulemaking|S?NPRMs?)", re.I)


def parse_date(s):
    try:
        return datetime.strptime(s.strip(), "%m/%d/%Y").date().isoformat()
    except (ValueError, AttributeError):
        return None


def is_withdrawal(subject, summary):
    # 'Withdrawal - ...' or 'Airworthiness Directives; Withdrawal - ...' in the subject, or the summary says so
    return "withdrawal" in subject.lower() or bool(WITHDRAW_RE.search(" ".join(summary.split())[:300]))


def load_rows():
    wb = openpyxl.load_workbook(XLSX, read_only=True)
    ws = wb.worksheets[0]
    it = ws.iter_rows(values_only=True)
    header = [h.strip() if isinstance(h, str) else h for h in next(it)]
    rows = []
    for vals in it:
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


def load_index():
    """Rows of the organisers' challenge4_ad_index.xlsx (header on the third row), in source-sheet order."""
    ws = openpyxl.load_workbook(INDEX, read_only=True)["nprm_index"]
    it = ws.iter_rows(values_only=True)
    next(it), next(it)
    header = next(it)
    return [dict(zip(header, r)) for r in it if r and r[0]]


def apply_index(rows):
    """Attach record_id (the official citation key) and the index's publish date and FR link to each row.
    Rows are matched by position and must agree on docket number."""
    if not INDEX.exists():
        print(f"warning: {INDEX.name} missing; record_id falls back to row position")
        for r in rows:
            r.update(record_id=f"NPRM-{r['id'] + 1:03d}", index_doc="")
        return
    index = load_index()
    if len(index) != len(rows):
        sys.exit(f"{INDEX.name} has {len(index)} rows, source sheet has {len(rows)}")
    for r, x in zip(rows, index):
        if x["docket_number"] != r["docket"]:
            sys.exit(f"{x['record_id']}: docket {x['docket_number']} != {r['docket']} (row order changed?)")
        m = DOCNO_RE.search(x.get("federal_register_link") or "")
        r["record_id"] = x["record_id"]
        r["publish_date"] = str(x["publish_date"] or "")[:10] or r["publish_date"]
        r["index_doc"] = m.group(1) if m else ""


def verify_index_doc(client, row):
    """The index's link is used only when its first page matches the row's cited page: for many rows it points
    at an earlier notice in the docket (e.g. the original NPRM when the row is its withdrawal)."""
    try:
        meta = get(client, FR_API.format(row["index_doc"]), params={"fields[]": "start_page"}).json()
    except (httpx.HTTPError, ValueError):
        return None
    if row["page_start"] is None or meta.get("start_page") == row["page_start"]:
        return row["index_doc"]
    return None


def resolve_missing(rows):
    resolved = json.loads(RESOLVED.read_text()) if RESOLVED.exists() else {}
    todo = [r for r in rows if not r["fr_doc"] and not resolved.get(f"{r['docket']}|{r['page_start']}")]
    if todo:
        with httpx.Client(timeout=20, follow_redirects=False) as client, ThreadPoolExecutor(2) as ex:
            # 1) same docket, same start page; 2) else the organisers' index link, if its first page matches
            for r, doc in zip(todo, ex.map(lambda r: resolve_one(client, r), todo)):
                resolved[f"{r['docket']}|{r['page_start']}"] = doc
            left = [r for r in todo if not resolved[f"{r['docket']}|{r['page_start']}"] and r.get("index_doc")]
            for r, doc in zip(left, ex.map(lambda r: verify_index_doc(client, r), left)):
                resolved[f"{r['docket']}|{r['page_start']}"] = doc
        RESOLVED.write_text(json.dumps(resolved, indent=1, sort_keys=True))
    apply_resolved(rows, resolved)


def apply_resolved(rows, resolved):
    n = 0
    for r in rows:
        if not r["fr_doc"]:
            r["fr_doc"] = resolved.get(f"{r['docket']}|{r['page_start']}") or ""
            n += bool(r["fr_doc"])
    print(f"resolved {n} rows without a usable link (FR docket search, or index link with matching page)")


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


def is_heading(title):
    """Section titles are title-cased ('Parts Installation Limitations'); sub-paragraph lines are sentences."""
    words = [w for w in re.findall(r"[A-Za-z][A-Za-z'-]*", title) if len(w) > 3]
    return bool(words) and sum(w[0].isupper() for w in words) / len(words) >= 0.6


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
        if am and not is_heading(am.group(2)):
            am = None  # '(i) Modify and calibrate each ... in': a sub-paragraph line, not a section title
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
        r["cfr_part"], r["data_warning"] = None, None
        if use_fulltext and cached and cached.exists():
            text = cached.read_text()
            if "[Rules and Regulations]" in text[:600]:
                status = "final"
            part = CFR_PART_RE.search(text[:3000])
            r["cfr_part"] = part.group(1) if part else None
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
        # the source sheet's summary occasionally belongs to a different rule (e.g. NPRM-314's describes
        # instrument approach procedures); keep it out of the index when the full text is an AD and it isn't
        if r["cfr_part"] == "39" and r["summary"] and not AD_WORDS_RE.search(r["summary"]):
            r["data_warning"] = ("The source sheet's summary for this record does not describe an airworthiness "
                                 "directive; it is not used. Rely on the Federal Register text.")
        elif not chunks:
            chunks = [("Summary", r["page_start"], r["summary"])]
        else:
            chunks.insert(0, ("Summary", r["page_start"], r["summary"]))
        if r["ad_number"] and status == "proposed":
            status = "final"
        if r["withdrawn"]:
            status = "withdrawn"
        if r["cfr_part"] and r["cfr_part"] != "39":  # e.g. a Part 61 pilot-training rule in the sheet
            status = "not_ad"
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


def build_embeddings():
    """Optional: embed every chunk with a local model (no API key) for hybrid retrieval.
    Skips the work when the chunk texts are unchanged since the last run."""
    import hashlib

    import numpy as np
    from fastembed import TextEmbedding

    con = sqlite3.connect(DB)
    rows = con.execute(
        "SELECT c.id, c.section, c.text, a.data FROM chunks c JOIN ads a ON a.id = c.ad_id ORDER BY c.id").fetchall()
    # subject + section give short passages the context they lack on their own
    picked = [(cid, embed_text(json.loads(d)["subject"], s, t)) for cid, s, t, d in rows]
    picked = [(cid, txt) for cid, txt in picked if txt]
    rows, texts = [(cid,) for cid, _ in picked], [txt for _, txt in picked]
    digest = hashlib.sha256("\x00".join(texts).encode()).hexdigest()
    if EMB_META.exists() and json.loads(EMB_META.read_text()).get("digest") == digest and EMB.exists():
        print("embeddings up to date")
        return
    t0 = time.time()
    model = TextEmbedding(EMB_MODEL)
    vecs = np.array(list(model.embed(texts, batch_size=64)), dtype=np.float32)
    vecs /= np.linalg.norm(vecs, axis=1, keepdims=True)
    np.save(EMB, vecs.astype(np.float16))
    EMB_META.write_text(json.dumps({"digest": digest, "model": EMB_MODEL, "ids": [r[0] for r in rows]}))
    print(f"embedded {len(texts)} chunks in {time.time() - t0:.0f}s")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-fetch", action="store_true", help="skip Federal Register download")
    ap.add_argument("--embed", action="store_true", help="also build local embeddings for hybrid retrieval")
    args = ap.parse_args()
    if not XLSX.exists():
        sys.exit(f"missing {XLSX}")
    rows = load_rows()
    apply_index(rows)
    if not args.no_fetch:
        fetch_all(rows)
    elif RESOLVED.exists():
        apply_resolved(rows, json.loads(RESOLVED.read_text()))
    finalize_urls(rows)
    build(rows, use_fulltext=CACHE.exists())
    if args.embed:
        build_embeddings()


if __name__ == "__main__":
    main()
