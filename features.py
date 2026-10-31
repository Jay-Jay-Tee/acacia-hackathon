"""P4 feature endpoints. Mounted in app.py with one line: app.include_router(features.router)"""
import re
import sqlite3
from datetime import datetime, timezone
from functools import lru_cache
from typing import Annotated, Literal

from fastapi import APIRouter, Body, HTTPException
from pydantic import BaseModel, Field

import engine

router = APIRouter()


def _chunks(ad_id):
    # Own read-only connection: engine keeps its connection private, and the chunks table is the contract.
    con = sqlite3.connect(f"file:{engine.DB}?mode=ro", uri=True)
    try:
        return con.execute("SELECT id, section, page, text FROM chunks WHERE ad_id = ? ORDER BY id",
                           (ad_id,)).fetchall()
    finally:
        con.close()


@router.get("/ad/{ad_id}/text")
def ad_text(ad_id: int):
    """Full text of one document as ordered chunks, so the UI can scroll to a citation's `chunk_id`.

    `page` is the Federal Register page where the chunk starts; the client draws a page marker whenever it
    changes. `anchors` lists one entry per section, in reading order, for navigation.
    """
    if ad_id not in engine.all_ads():
        raise HTTPException(404, "unknown ad_id")
    card = engine.ad_card(ad_id)
    chunks = [{"chunk_id": cid, "section": section, "page": page, "anchor": f"chunk-{cid}", "text": text}
              for cid, section, page, text in _chunks(ad_id)]
    anchors, last = [], None
    for c in chunks:
        if c["section"] != last:
            anchors.append({"section": c["section"], "page": c["page"], "chunk_id": c["chunk_id"],
                            "anchor": c["anchor"]})
            last = c["section"]
    return {"ad_id": ad_id, "record_id": card["record_id"], "docket": card["docket"], "subject": card["subject"],
            "status": card["status"], "status_label": card["status_label"], "pages": card["pages"],
            "citation": card["citation"], "url": card["url"], "chunks": chunks, "anchors": anchors}


# ---------- fleet check (pure code, no LLM) ----------

MAX_FLEET = 500
VERDICT_ORDER = {"APPLIES": 0, "AMBIGUOUS": 1, "UNKNOWN": 2, "DOES_NOT_APPLY": 3}
FLEET_DISCLAIMER = ("Decision support only. Verdicts come from deterministic rules applied to the Federal Register "
                    "text, not from an LLM. UNKNOWN means the text cannot settle it and needs a manual check; "
                    "certifying staff make the final applicability decision.")


class Aircraft(BaseModel):
    model: str = Field(max_length=40)
    serial: str | None = Field(default=None, max_length=40)


def _lists_model(ad, nm):
    """Same matching as engine.check_applicability: exact, or a partial match either way (ambiguous)."""
    for m in engine.effective_models(ad):
        k = engine.norm_model(m)
        if k == nm or k.startswith(nm) or nm.startswith(k):
            return True
    return False


def _check_aircraft(a):
    model, serial = a.model.strip(), (a.serial or "").strip() or None
    row = {"model": model, "serial": serial, "status": "ok", "note": "", "candidates": [], "results": [], "counts": {}}
    if not model:
        return {**row, "status": "invalid", "note": "Model is required."}
    nm = engine.norm_model(model)
    for ad_id, ad in engine.all_ads().items():
        if not _lists_model(ad, nm):
            continue
        card = engine.ad_card(ad_id)
        row["results"].append({
            "ad_id": ad_id, "record_id": card["record_id"], "docket": card["docket"], "ad_number": card["ad_number"],
            "subject": card["subject"], "status": card["status"], "status_label": card["status_label"],
            "publish_date": card["publish_date"], "url": card["url"], "is_latest": card["revision"]["is_latest"],
            "revision_count": card["revision"]["count"],
            "applicability": engine.check_applicability(ad, model, serial)})
    row["results"].sort(key=lambda r: (VERDICT_ORDER[r["applicability"]["result"]], not r["is_latest"],
                                       r["record_id"] or ""))
    for r in row["results"]:
        v = r["applicability"]["result"]
        row["counts"][v] = row["counts"].get(v, 0) + 1
    row["candidates"] = engine.model_candidates(model)
    if not row["results"]:
        row.update(status="model_not_in_corpus",
                   note="No AD or NPRM in the dataset lists this model. That is not evidence that none apply; "
                        "check the model spelling and the source.")
    return row


@router.post("/fleet")
def fleet(aircraft: Annotated[list[Aircraft], Body(max_length=MAX_FLEET)]):
    """Screen a fleet: for each {model, serial}, every AD/NPRM listing that model with the verdict and trace
    from engine.check_applicability. Results are sorted APPLIES, AMBIGUOUS, UNKNOWN, DOES_NOT_APPLY; superseded
    revisions are included but flagged with is_latest=false."""
    rows = [_check_aircraft(a) for a in aircraft]
    totals = {}
    for row in rows:
        for r in row["results"]:
            if r["is_latest"]:
                v = r["applicability"]["result"]
                totals[v] = totals.get(v, 0) + 1
    return {"aircraft": rows, "totals_latest": totals, "disclaimer": FLEET_DISCLAIMER}


# ---------- revision timeline ----------

KIND_LABEL = {"proposed": "Proposed", "revised": "Revised proposal", "withdrawn": "Withdrawn", "final": "Final AD"}


@lru_cache(maxsize=1)
def _by_ad_number():
    idx = {}
    for ad in engine.all_ads().values():
        if ad["ad_number"]:
            idx.setdefault(ad["ad_number"], []).append(ad)
    return idx


def _supersession(ad_number):
    """Map a superseded AD number to a document in the corpus when one carries that number."""
    hits = _by_ad_number().get(ad_number)
    if not hits:
        return {"ad_number": ad_number, "in_corpus": False}
    ad = max(hits, key=lambda a: (a.get("publish_date") or "", a["id"]))
    return {"ad_number": ad_number, "in_corpus": True, "ad_id": ad["id"], "record_id": ad.get("record_id"),
            "docket": ad["docket"]}


def _headline(current):
    if engine.docket_withdrawn(current):
        return "Withdrawn: no action required."
    return engine.status_label(current)


@router.get("/ad/{ad_id}/timeline")
def ad_timeline(ad_id: int):
    """Every notice in this document's docket, oldest first, with the current version flagged.

    `kind` is proposed | revised | withdrawn | final. The current version is the one with the latest publish
    date (engine.revisions). `supersedes` maps each superseded AD number to a corpus document, or in_corpus=false.
    """
    if ad_id not in engine.all_ads():
        raise HTTPException(404, "unknown ad_id")
    ads = engine.all_ads()
    docket = ads[ad_id]["docket"]
    rev = engine.revisions(docket)
    events = []
    for i, v in enumerate(reversed(rev["versions"])):  # versions are newest first
        ad, card = ads[v["id"]], engine.ad_card(v["id"])
        if ad["status"] in ("withdrawn", "final"):
            kind = ad["status"]
        else:
            kind = "revised" if i > 0 or ad.get("is_revision_notice") else "proposed"
        events.append({
            "ad_id": v["id"], "record_id": card["record_id"], "kind": kind, "label": KIND_LABEL[kind],
            "status": card["status"], "status_label": card["status_label"], "publish_date": card["publish_date"],
            "issue_date": card["issue_date"], "pages": card["pages"], "citation": card["citation"],
            "url": card["url"], "ad_number": card["ad_number"], "is_current": v["id"] == rev["latest_id"],
            "supersedes": [_supersession(n) for n in ad["supersedes"]]})
    return {"docket": docket, "requested_ad_id": ad_id, "current_id": rev["latest_id"], "count": rev["count"],
            "headline": _headline(ads[rev["latest_id"]]), "events": events}


# ---------- compliance note ----------

NOTE_REVIEW_LINE = "For review by certifying staff: decision support only."
NOTE_FOOTER = ("Document details, applicability verdicts and source checks were recomputed from the indexed Federal "
               "Register text when this note was generated. The question and answer text are as displayed to the user. "
               "Verify every citation against the cited Federal Register notice before acting; certifying staff make "
               "the final applicability and compliance decision.")


def locate(text, cited):
    """Span of `cited` inside `text`, or None. Words are matched with flexible whitespace, and the "..." that
    extractive mode appends to a cut quote is ignored. Mirrors frontend/src/features/highlight.ts."""
    words = re.sub(r"(\.{3}|\u2026)\s*$", "", cited).split()
    m = re.search(r"\s+".join(re.escape(w) for w in words), text) if words else None
    return m.span() if m else None


class NoteCitation(BaseModel):
    ad_id: int
    chunk_id: int
    cited_text: str = Field(max_length=2000)


class NoteBlock(BaseModel):
    text: str = Field(max_length=4000)
    citations: list[NoteCitation] = Field(default_factory=list, max_length=20)


class NoteRequest(BaseModel):
    query: str = Field(max_length=engine.MAX_QUERY)
    model: str | None = Field(default=None, max_length=40)
    serial: str | None = Field(default=None, max_length=40)
    status: Literal["answered", "refused", "needs_clarification"]
    mode: str | None = Field(default=None, max_length=20)
    refusal_reason: str = Field(default="", max_length=1000)
    answer_blocks: list[NoteBlock] = Field(default_factory=list, max_length=30)


def _line(s):
    """One line of plain text: collapse whitespace so user text can't start new Markdown blocks."""
    return " ".join(str(s or "").split())


def render_note(req, now=None):
    now = now or datetime.now(timezone.utc)
    ads, chunks = engine.all_ads(), {}
    model, serial = _line(req.model), _line(req.serial)

    refs, cites, answer = {}, [], []  # refs: (ad_id, chunk_id) -> citation number
    for i, block in enumerate(req.answer_blocks, 1):
        marks = ""
        for c in block.citations:
            key = (c.ad_id, c.chunk_id)
            if key not in refs:
                refs[key] = len(refs) + 1
                cites.append(c)
            marks += f"[{refs[key]}]"
        answer.append(f"{i}. {_line(block.text)} {marks}".rstrip())

    out = ["# Compliance note", "", f"> **{NOTE_REVIEW_LINE}**", "",
           f"- **Generated:** {now.strftime('%Y-%m-%d %H:%M:%S')} UTC",
           f"- **Question:** {_line(req.query)}",
           f"- **Aircraft:** {('model ' + model) if model else 'model not given'}"
           f"{(', serial ' + serial) if serial else ''}",
           f"- **Outcome:** {req.status}{(' (' + _line(req.mode) + ')') if req.mode else ''}", ""]

    out += ["## Answer", ""]
    if answer:
        out += answer
    else:
        out.append(f"No answer was produced. {_line(req.refusal_reason)}".strip())
    out.append("")

    if cites:
        out += ["## Citations", ""]
    for c in cites:
        n, card, ad = refs[(c.ad_id, c.chunk_id)], engine.ad_card(c.ad_id), ads[c.ad_id]
        if c.ad_id not in chunks:
            chunks[c.ad_id] = {cid: (section, page, text) for cid, section, page, text in _chunks(c.ad_id)}
        passage = chunks[c.ad_id].get(c.chunk_id)
        rev = card["revision"]
        if engine.docket_withdrawn(ad):
            revision = "docket withdrawn: no action required"
        elif rev["is_latest"]:
            revision = f"latest of {rev['count']} notice(s) in this docket"
        else:
            newest = ads[rev["latest_id"]]
            revision = (f"OUTDATED: superseded by {newest.get('record_id')} (published {newest.get('publish_date')}); "
                        "check the newer notice")
        out += [f"**[{n}] {card['record_id'] or card['docket']}** ({card['status_label']})", "",
                f"- Docket: {card['docket']}" + (f" · AD {card['ad_number']}" if card["ad_number"] else ""),
                f"- Revision: published {card['publish_date']}; {revision}"]
        if passage:
            section, page, text = passage
            out.append(f"- Section: {_line(section)} · Federal Register page {page} (notice pages {card['pages']})")
        out += [f"- Citation: {_line(card['citation'])}", f"- URL: {card['url']}"]
        out.append("- Quote:")
        out += [f"  > {ln}" for ln in (c.cited_text.strip().splitlines() or [""])]
        if passage and locate(passage[2], c.cited_text):
            out.append("- Source check: ✓ quote found in the indexed passage")
        elif passage:
            out.append("- Source check: ⚠ quote NOT found in the indexed passage; verify manually")
        else:
            out.append("- Source check: ⚠ passage not found in the indexed document; verify manually")
        out.append("")

    if cites:
        out += ["## Applicability", ""]
        if not model:
            out.append("No aircraft model was given, so applicability was not assessed.")
        for ad_id in dict.fromkeys(c.ad_id for c in cites if model):
            card, appl = engine.ad_card(ad_id), engine.check_applicability(ads[ad_id], model, serial or None)
            out += [f"### {card['record_id'] or card['docket']}: {appl['result'].replace('_', ' ')}", ""]
            out += [f"{i}. {_line(t)}" for i, t in enumerate(appl["trace"], 1)]
            if appl.get("candidates"):
                out.append(f"Specify one of: {', '.join(appl['candidates'])}")
            out.append("")

    out += ["---", "", f"**{NOTE_REVIEW_LINE}**", "", NOTE_FOOTER, ""]
    return "\n".join(out)


@router.post("/note")
def note(body: NoteRequest):
    """Markdown compliance note for an answer: question, answer, every citation (docket, revision, section, page,
    URL, quote with a source check), the applicability trace, a timestamp and the certifying-staff line."""
    ads = engine.all_ads()
    for b in body.answer_blocks:
        for c in b.citations:
            if c.ad_id not in ads:
                raise HTTPException(422, f"unknown ad_id {c.ad_id}")
    now = datetime.now(timezone.utc)
    return {"markdown": render_note(body, now), "filename": f"compliance-note-{now.strftime('%Y%m%d-%H%M%S')}.md",
            "generated_at": now.isoformat(timespec="seconds")}
