"""P4 generic document upload: PDF -> page-aware chunks in a separate "uploaded" collection, plus cited Q&A over it.

Mounted in app.py with one line: app.include_router(uploads.router)

- The corpus (data/ads.db) is never touched; uploads live in data/uploads.db. Only extracted text is stored, never the PDF.
- Answers are extractive quotes from the uploaded text (no LLM), so an uploaded document cannot inject instructions.
- Applicability is always UNKNOWN: uploaded documents are not ADs and their rules are not evaluated.
- Page numbers are PDF page numbers (1-based), which can differ from the numbers printed on the pages.
"""
import hashlib
import io
import re
import sqlite3
import time
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from pypdf import PdfReader

import engine

router = APIRouter()

DB = Path(engine.DB).parent / "uploads.db"
MAX_BYTES = 20 * 1024 * 1024
MAX_PAGES = 300
MAX_DOCS = 50
CHUNK_CHARS = 1500
ANSWER_CHUNKS = 3
SNIPPET_CHARS = 600
NOTICE = ("This answer quotes a user-uploaded document, not an official FAA or Federal Register source. "
          "Verify it against the controlled original before acting.")
DISCLAIMER = ("Decision support only. Check the quoted passage in the uploaded document; "
              "certifying staff make the final decision.")


# ---------- storage ----------

def _con():
    DB.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    con.executescript("""
        CREATE TABLE IF NOT EXISTS docs (id INTEGER PRIMARY KEY, filename TEXT, sha256 TEXT UNIQUE, pages INTEGER,
                                         empty_pages TEXT, uploaded_at TEXT);
        CREATE TABLE IF NOT EXISTS chunks (id INTEGER PRIMARY KEY, doc_id INTEGER, section TEXT, page INTEGER, text TEXT);
        CREATE INDEX IF NOT EXISTS chunks_doc ON chunks(doc_id);
        CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(text, section, tokenize='porter unicode61');""")
    return con


def _record_id(doc_id):
    return f"UPLOAD-{doc_id:03d}"


def _applicability(con, doc_id):
    trace = ["Uploaded documents are not Airworthiness Directives; model and serial applicability rules in them "
             "are not evaluated automatically."]
    row = con.execute("SELECT page, text FROM chunks WHERE doc_id = ? AND section LIKE '%applicab%' ORDER BY id LIMIT 1",
                      (doc_id,)).fetchone()
    if row:
        flat = " ".join(row["text"].split())
        trace.append(f"An 'Applicability' section was found on page {row['page']}. Read it and decide manually: "
                     f"\"{flat[:300]}{'...' if len(flat) > 300 else ''}\"")
    return {"result": "UNKNOWN", "trace": trace}


def _summary(con, doc_id):
    d = con.execute("SELECT * FROM docs WHERE id = ?", (doc_id,)).fetchone()
    rows = con.execute("SELECT section FROM chunks WHERE doc_id = ? ORDER BY id", (doc_id,)).fetchall()
    return {"doc_id": doc_id, "record_id": _record_id(doc_id), "filename": d["filename"], "pages": d["pages"],
            "chunks": len(rows), "sections": list(dict.fromkeys(r["section"] for r in rows)),
            "collection": "uploaded", "uploaded_at": d["uploaded_at"], "applicability": _applicability(con, doc_id),
            "warnings": [f"No extractable text on page(s) {d['empty_pages']}; scanned images are not read."]
            if d["empty_pages"] else []}


def _require(con, doc_id):
    if not con.execute("SELECT 1 FROM docs WHERE id = ?", (doc_id,)).fetchone():
        raise HTTPException(404, "unknown upload")


# ---------- parsing: PDF -> page-aware, heading-split chunks ----------

KEYWORD_HEAD = re.compile(r"^(chapter|section|part|appendix)\s+[\w.-]+\b.{0,70}$", re.I)
NUMBER_HEAD = re.compile(r"^\d+(\.\d+){0,3}[.)]?\s+[A-Z][^\n]{2,80}$")
# Title-case headings common in maintenance manuals and accident reports (short lines that start with one of these)
COMMON_HEAD = re.compile(
    r"^(applicability|introduction|scope|summary|abstract|synopsis|description|procedures?|compliance|references|"
    r"background|findings|analysis|conclusions?|recommendations|probable cause|history of flight|factual information|"
    r"safety recommendations|inspection|maintenance|warning|caution)\b", re.I)


def is_heading(line):
    s = line.strip()
    if not 3 <= len(s) <= 90 or s.endswith((".", ",", ";", ":")):
        return False
    if KEYWORD_HEAD.match(s) or NUMBER_HEAD.match(s) or (COMMON_HEAD.match(s) and len(s.split()) <= 5):
        return True
    letters = [c for c in s if c.isalpha()]
    return len(letters) >= 4 and sum(c.isupper() for c in letters) / len(letters) >= 0.8 and len(s.split()) <= 10


def _norm(line):
    return re.sub(r"\d+", "#", " ".join(line.split())).lower()


def _running_lines(pages):
    """Header/footer lines repeated on most pages ("ACME MANUAL", "Page 3 of 40"): dropped so they are not sections."""
    if len(pages) < 4:
        return set()
    seen = {}
    for text in pages:
        for n in {_norm(ln) for ln in text.splitlines() if ln.strip()}:
            seen[n] = seen.get(n, 0) + 1
    return {n for n, c in seen.items() if c >= 0.7 * len(pages)}


def split_pages(pages):
    """Yield (section, page, text). A chunk never spans pages, so its page is exact; a new heading starts a new section."""
    running, section, out = _running_lines(pages), "Document start", []
    for pno, text in enumerate(pages, 1):
        buf = []

        def flush():
            body = "\n".join(buf).strip()
            if body and body != section:
                out.append((section, pno, body))

        for raw in text.splitlines():
            line = " ".join(raw.split())
            if not line or _norm(line) in running:
                continue
            if is_heading(line):
                flush()
                section, buf = line, [line]
            else:
                if sum(len(b) for b in buf) + len(line) > CHUNK_CHARS:
                    flush()
                    buf = []
                buf.append(line)
        flush()
    return out


def parse_pdf(data):
    if not data.startswith(b"%PDF-"):
        raise HTTPException(415, "not a PDF file")
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            raise HTTPException(422, "encrypted PDFs are not supported")
        if len(reader.pages) > MAX_PAGES:
            raise HTTPException(413, f"more than {MAX_PAGES} pages")
        return [p.extract_text() or "" for p in reader.pages]
    except HTTPException:
        raise
    except Exception:  # pypdf raises many types on malformed input; all mean "unreadable"
        raise HTTPException(422, "could not read this PDF")


# ---------- endpoints ----------

@router.post("/upload")
def upload(file: UploadFile = File(...)):
    """Index a PDF into the "uploaded" collection. Re-uploading identical bytes returns the existing document."""
    data = file.file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(413, f"file is larger than {MAX_BYTES // (1024 * 1024)} MB")
    sha = hashlib.sha256(data).hexdigest()
    with closing(_con()) as con:
        dup = con.execute("SELECT id FROM docs WHERE sha256 = ?", (sha,)).fetchone()
        if dup:
            return {**_summary(con, dup["id"]), "duplicate": True}
        if con.execute("SELECT count(*) FROM docs").fetchone()[0] >= MAX_DOCS:
            raise HTTPException(409, f"upload limit reached ({MAX_DOCS}); remove a document first")
        pages = parse_pdf(data)
        chunks = split_pages(pages)
        if not chunks:
            raise HTTPException(422, "no extractable text (scanned images are not supported)")
        empty = [str(i) for i, t in enumerate(pages, 1) if not t.strip()]
        name = re.sub(r"[^\w .()\-]", "_", Path(file.filename or "upload.pdf").name)[:120] or "upload.pdf"
        cur = con.execute("INSERT INTO docs (filename, sha256, pages, empty_pages, uploaded_at) VALUES (?,?,?,?,?)",
                          (name, sha, len(pages), ", ".join(empty),
                           datetime.now(timezone.utc).isoformat(timespec="seconds")))
        doc_id = cur.lastrowid
        for section, page, text in chunks:
            c = con.execute("INSERT INTO chunks (doc_id, section, page, text) VALUES (?,?,?,?)",
                            (doc_id, section, page, text))
            con.execute("INSERT INTO chunks_fts (rowid, text, section) VALUES (?,?,?)", (c.lastrowid, text, section))
        con.commit()
        return {**_summary(con, doc_id), "duplicate": False}


@router.get("/uploads")
def uploads():
    with closing(_con()) as con:
        return {"docs": [_summary(con, r["id"]) for r in con.execute("SELECT id FROM docs ORDER BY id DESC")]}


@router.get("/upload/{doc_id}/text")
def upload_text(doc_id: int):
    """Same shape as GET /ad/{ad_id}/text, so the source viewer can show an uploaded document."""
    with closing(_con()) as con:
        _require(con, doc_id)
        s = _summary(con, doc_id)
        chunks = [{"chunk_id": r["id"], "section": r["section"], "page": r["page"], "anchor": f"chunk-{r['id']}",
                   "text": r["text"]} for r in con.execute(
                       "SELECT id, section, page, text FROM chunks WHERE doc_id = ? ORDER BY id", (doc_id,))]
    anchors, last = [], None
    for c in chunks:
        if c["section"] != last:
            anchors.append({k: c[k] for k in ("section", "page", "chunk_id", "anchor")})
            last = c["section"]
    return {"ad_id": -1, "doc_id": doc_id, "record_id": s["record_id"], "docket": "", "subject": s["filename"],
            "status": "uploaded", "status_label": "Uploaded document, not an official source",
            "pages": f"1-{s['pages']}", "citation": s["filename"], "url": "", "chunks": chunks, "anchors": anchors}


@router.delete("/upload/{doc_id}")
def delete_upload(doc_id: int):
    with closing(_con()) as con:
        _require(con, doc_id)
        con.execute("DELETE FROM chunks_fts WHERE rowid IN (SELECT id FROM chunks WHERE doc_id = ?)", (doc_id,))
        con.execute("DELETE FROM chunks WHERE doc_id = ?", (doc_id,))
        con.execute("DELETE FROM docs WHERE id = ?", (doc_id,))
        con.commit()
    return {"deleted": doc_id}


# ---------- cited question answering ----------

class UploadAsk(BaseModel):
    query: str = Field(min_length=1, max_length=engine.MAX_QUERY)


def _has_word(token, text):
    return re.search(r"\b" + re.escape(token), text, re.I) is not None


def _best_quote(text, tokens):
    """The best-matching sentence plus the one after it, as an exact slice of the chunk (so it can be highlighted)."""
    spans = [m.span() for m in re.finditer(r"[^.!?]+[.!?]*\s*", text)]
    scores = [sum(_has_word(t, text[a:b]) for t in tokens) for a, b in spans]
    i = scores.index(max(scores))
    start, end = spans[i][0], spans[min(i + 1, len(spans) - 1)][1]
    quote = text[start:end].strip()
    if len(quote) > SNIPPET_CHARS:
        quote = quote[:SNIPPET_CHARS].rstrip() + "..."
    return quote


def _reply(status, reason="", blocks=None, docs=None, retrieval_ms=0.0, t0=None):
    return {"status": status, "mode": "extractive" if blocks else None, "refusal_reason": reason, "note": "",
            "retrieval_ms": retrieval_ms, "total_ms": round((time.perf_counter() - t0) * 1000, 1),
            "disclaimer": DISCLAIMER, "candidates": [], "notices": [NOTICE] if blocks else [],
            "answer_blocks": blocks or [], "documents": docs or []}


@router.post("/upload/{doc_id}/ask")
def ask_upload(doc_id: int, body: UploadAsk):
    """Answer from one uploaded document with quoted, page-cited passages, or refuse when it has no answer."""
    t0 = time.perf_counter()
    with closing(_con()) as con:
        _require(con, doc_id)
        summary = _summary(con, doc_id)
        tokens = engine.content_tokens(body.query)
        if not tokens:
            return _reply("refused", "Ask a more specific question about the document.", t0=t0)
        match = " OR ".join(f'"{t}"' for t in tokens)
        r0 = time.perf_counter()
        rows = con.execute(
            "SELECT c.id, c.section, c.page, c.text FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid "
            "WHERE chunks_fts MATCH ? AND c.doc_id = ? ORDER BY bm25(chunks_fts) LIMIT 20", (match, doc_id)).fetchall()
        retrieval_ms = round((time.perf_counter() - r0) * 1000, 1)
    need = 1.0 if len(tokens) <= 2 else engine.MIN_COVERAGE   # short queries must match every word, as in the corpus
    scored = [(sum(_has_word(t, r["section"] + " " + r["text"]) for t in tokens) / len(tokens), i, r)
              for i, r in enumerate(rows)]
    hits = [r for cov, _, r in sorted((s for s in scored if s[0] >= need), key=lambda s: (-s[0], s[1]))][:ANSWER_CHUNKS]
    if not hits:
        return _reply("refused", "The uploaded document does not appear to contain an answer to this question.",
                      retrieval_ms=retrieval_ms, t0=t0)
    blocks = []
    for r in hits:
        quote = _best_quote(r["text"], tokens)
        blocks.append({"text": quote, "citations": [{
            "source": "upload", "doc_id": doc_id, "record_id": summary["record_id"], "docket": "", "ad_number": "",
            "status": "uploaded", "revision_date": "", "section": r["section"], "fr_citation": summary["filename"],
            "pages": f"1-{summary['pages']}", "page": r["page"], "url": "", "cited_text": quote, "ad_id": -1,
            "chunk_id": r["id"]}]})
    return _reply("answered", blocks=blocks, docs=[summary], retrieval_ms=retrieval_ms, t0=t0)
