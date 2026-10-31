"""FastAPI app. Run: .venv/bin/uvicorn app:app --host 127.0.0.1 --port 8000"""
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import engine
import features
import llm

app = FastAPI(title="AD Finder")
app.include_router(features.router)




@app.on_event("startup")
def warm_up():
    engine.hybrid_enabled()  # loads embeddings and the embedding model once (~9 s) instead of on the first request


DISCLAIMER = ("Decision support only. Verify against the cited Federal Register text; "
              "certifying staff make the final applicability and compliance decision.")


class Ask(BaseModel):
    query: str = Field(max_length=engine.MAX_QUERY)
    model: str | None = Field(default=None, max_length=40)
    serial: str | None = Field(default=None, max_length=40)


DIST = Path(__file__).parent / "frontend" / "dist"  # built by `npm run build` in frontend/
if (DIST / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")


@app.get("/")
def index():
    built = DIST / "index.html"
    return FileResponse(built if built.is_file() else Path(__file__).parent / "index.html")


@app.get("/search")
def search(q: str, model: str | None = None):
    res = engine.search(q[:engine.MAX_QUERY], model=model)
    return {"retrieval_ms": round(res["ms"], 1),
            "hits": [{**h, "card": engine.ad_card(h["ad_id"])} for h in res["hits"]]}


@app.get("/ad/{ad_id}")
def ad(ad_id: int):
    if ad_id not in engine.all_ads():
        raise HTTPException(404)
    a = engine.all_ads()[ad_id]
    return {**engine.ad_card(ad_id), "summary": a["summary"], "applicability_text": a["applicability_text"]}


@app.get("/corpus")
def corpus():
    """Corpus size (the brief asks teams to state it) and whether embeddings are loaded."""
    return engine.corpus_stats()


def status_notices(blocks):
    """Deterministic reminders based on the status of the documents actually cited."""
    cited = {c["status"] for b in blocks for c in b["citations"]}
    notices = []
    if "proposed" in cited:
        notices.append("Cited documents include proposed rules (NPRMs). They are not in effect until the FAA "
                       "issues a final AD.")
    if "withdrawn" in cited:
        notices.append("Cited documents include withdrawn proposals; no action is required under them.")
    return notices


@app.post("/ask")
def ask(body: Ask):
    t0 = time.perf_counter()
    status, reason, res, appl = engine.gate(body.query, body.model or None, body.serial or None)
    retrieval_ms = round(res["ms"], 1) if res else 0.0
    hits = res["hits"] if res else []
    cards, seen = [], set()
    for h in hits:
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
        if mode == "no_answer":
            out.update(status="refused", mode=mode, refusal_reason=note)
        else:
            out.update(status="answered", mode=mode, answer_blocks=blocks, note=note, notices=status_notices(blocks))
    out["total_ms"] = round((time.perf_counter() - t0) * 1000, 1)
    return out
