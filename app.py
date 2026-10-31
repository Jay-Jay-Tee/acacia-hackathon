"""FastAPI app. Run: .venv/bin/uvicorn app:app --host 127.0.0.1 --port 8000"""
import time
from contextlib import asynccontextmanager
from pathlib import Path

from typing import Annotated

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import changes
import engine
import features
import llm
import uploads

@asynccontextmanager
async def lifespan(_app):
    engine.hybrid_enabled()  # loads embeddings and the embedding model once (~9 s) instead of on the first request
    yield


app = FastAPI(title="AirFrame", lifespan=lifespan)
app.include_router(changes.router)
app.include_router(features.router)
app.include_router(uploads.router)


DISCLAIMER = ("Decision support only. Verify against the cited Federal Register text; "
              "certifying staff make the final applicability and compliance decision.")


class Filters(BaseModel):
    status: list[str] | None = Field(default=None, max_length=4)
    make: str | None = Field(default=None, max_length=60)
    product_type: str | None = Field(default=None, max_length=40)
    published_from: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    published_to: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")


class Ask(BaseModel):
    query: str = Field(max_length=engine.MAX_QUERY)
    model: str | None = Field(default=None, max_length=40)
    serial: str | None = Field(default=None, max_length=40)
    filters: Filters | None = None  # v1.5


DIST = Path(__file__).parent / "frontend" / "dist"  # built by `npm run build` in frontend/
if (DIST / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")


@app.get("/")
def index():
    built = DIST / "index.html"
    return FileResponse(built if built.is_file() else Path(__file__).parent / "legacy" / "index.html")


@app.get("/airframe.svg", include_in_schema=False)
def favicon():
    """The favicon lives in frontend/public/, which Vite copies to the root of dist/ (not under /assets)."""
    icon = DIST / "airframe.svg"
    if not icon.is_file():
        raise HTTPException(404)
    return FileResponse(icon, media_type="image/svg+xml")


@app.get("/search")
def search(q: str, model: str | None = None, status: Annotated[list[str] | None, Query()] = None,
           make: str | None = None, product_type: str | None = None,
           published_from: str | None = None, published_to: str | None = None):
    filters = {"status": status, "make": make, "product_type": product_type,
               "published_from": published_from, "published_to": published_to}
    res = engine.search(q[:engine.MAX_QUERY], model=model, filters=filters)
    return {"retrieval_ms": round(res["ms"], 1),
            "hits": [{**h, "card": engine.ad_card(h["ad_id"])} for h in res["hits"]]}


@app.get("/ad/{ad_id}")
def ad(ad_id: int):
    if ad_id not in engine.all_ads():
        raise HTTPException(404)
    a = engine.all_ads()[ad_id]
    return {**engine.ad_card(ad_id), "summary": a["summary"], "applicability_text": a["applicability_text"]}


@app.get("/facets")
def facets():
    """Values for the filter bar: statuses with counts, makes, product types, publish-date range."""
    return engine.facets()


@app.get("/corpus")
def corpus():
    """Corpus size (the brief asks teams to state it) and whether embeddings are loaded."""
    return engine.corpus_stats()


def filter_notice(filters):
    active = engine.describe_filters(engine.clean_filters(filters))
    return [f"Filtered: only notices with {active}."] if active else []


def status_notices(blocks, model=None):
    """Deterministic reminders based on the documents actually cited."""
    cited = {c["status"] for b in blocks for c in b["citations"]}
    notices = []
    families = {engine.aircraft_family(engine.all_ads()[c["ad_id"]]) for b in blocks for c in b["citations"]}
    # a record with no model list is labelled by make alone; don't count it separately from that make's models
    families = sorted(f for f in families if not any(o != f and o.startswith(f + " ") for o in families))
    if not model and len(families) > 1:
        shown = ", ".join(families[:4]) + (" and others" if len(families) > 4 else "")
        notices.append(f"This answer draws on notices for different aircraft types ({shown}). Requirements for one "
                       "type do not apply to another; set your aircraft to see only the notices for it.")
    if "proposed" in cited:
        notices.append("Cited documents include proposed rules (NPRMs). They are not in effect until the FAA "
                       "issues a final AD.")
    if "withdrawn" in cited:
        notices.append("Cited documents include withdrawn proposals; no action is required under them.")
    if "not_ad" in cited:
        notices.append("Cited documents include a rule that is not an airworthiness directive.")
    return notices


@app.post("/ask")
def ask(body: Ask):
    t0 = time.perf_counter()
    filters = body.filters.model_dump() if body.filters else None
    status, reason, res, appl = engine.gate(body.query, body.model or None, body.serial or None, filters)
    retrieval_ms = round(res["ms"], 1) if res else 0.0
    hits = res["hits"] if res else []
    # Show documents only when applicability was evaluated for them: a relevance refusal ("nothing in the
    # corpus matches") must not list unrelated notices, while e.g. "S/N outside the rule" keeps its evidence.
    cards, seen = [], set()
    for h in hits if appl else []:
        if h["ad_id"] not in seen:
            seen.add(h["ad_id"])
            cards.append({**engine.ad_card(h["ad_id"]), "applicability": appl.get(h["ad_id"])})
    candidates = []
    if status == "needs_clarification" and body.model:
        # from the per-document check when it raised the ambiguity, else from the corpus-wide model list
        candidates = sorted({c for a in appl.values() for c in a.get("candidates", [])}) or engine.model_candidates(body.model)
    out = {"status": status, "refusal_reason": reason, "answer_blocks": [], "mode": None, "note": "",
           "notices": [], "candidates": candidates, "documents": cards, "retrieval_ms": retrieval_ms, "disclaimer": DISCLAIMER}
    if status == "ok":
        mode, blocks, note = llm.answer(body.query, hits[:6])
        if mode == "no_answer":  # the passages don't answer it, so don't present them as matches
            out.update(status="refused", mode=mode, refusal_reason=note, documents=[])
        else:
            out.update(status="answered", mode=mode, answer_blocks=blocks, note=note, notices=filter_notice(filters) + status_notices(blocks, body.model))
    out["total_ms"] = round((time.perf_counter() - t0) * 1000, 1)
    return out
