import json
import re
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import app  # noqa: E402


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)  # extractive mode: deterministic, no API cost
    return TestClient(app.app)


def locate(text, cited):
    """Same rule as frontend/src/features/highlight.ts: words with flexible whitespace, trailing ellipsis ignored."""
    words = re.sub(r"(\.{3}|…)\s*$", "", cited).split()
    m = re.search(r"\s+".join(re.escape(w) for w in words), text) if words else None
    return m.span() if m else None


def test_text_endpoint_shape(client):
    t = client.get("/ad/1/text").json()
    assert t["ad_id"] == 1 and t["url"].startswith("https://www.federalregister.gov/")
    assert t["chunks"] and t["anchors"]
    ids = [c["chunk_id"] for c in t["chunks"]]
    assert ids == sorted(ids) and len(set(ids)) == len(ids)
    assert all(c["anchor"] == f"chunk-{c['chunk_id']}" and c["text"] and c["page"] for c in t["chunks"])
    assert {a["chunk_id"] for a in t["anchors"]} <= set(ids)


def test_unknown_ad_is_404(client):
    assert client.get("/ad/999999/text").status_code == 404


def test_every_citation_opens_the_exact_quoted_passage(client):
    checked = 0
    for line in (ROOT / "evaluation" / "questions.jsonl").read_text().splitlines():
        q = json.loads(line)
        r = client.post("/ask", json={"query": q["query"], "model": q.get("model"), "serial": q.get("serial")}).json()
        for block in r["answer_blocks"]:
            for cit in block["citations"]:
                chunks = {c["chunk_id"]: c for c in client.get(f"/ad/{cit['ad_id']}/text").json()["chunks"]}
                assert cit["chunk_id"] in chunks, cit
                assert locate(chunks[cit["chunk_id"]]["text"], cit["cited_text"]), cit
                checked += 1
    assert checked >= 20


# ---------- POST /fleet ----------

def fleet(client, rows):
    r = client.post("/fleet", json=rows)
    assert r.status_code == 200
    return r.json()


def test_fleet_verdict_depends_on_serial(client):
    a, b = fleet(client, [{"model": "P.68", "serial": "100"}, {"model": "P.68", "serial": "200"}])["aircraft"]
    assert a["results"][0]["applicability"]["result"] == "APPLIES"
    assert b["results"][0]["applicability"]["result"] == "DOES_NOT_APPLY"
    assert a["results"][0]["applicability"]["trace"] and a["results"][0]["url"].startswith("https://www.federalregister.gov/")


def test_fleet_matches_engine_and_is_sorted(client):
    row = fleet(client, [{"model": "AS350B3", "serial": "1"}])["aircraft"][0]
    order = ["APPLIES", "AMBIGUOUS", "UNKNOWN", "DOES_NOT_APPLY"]
    verdicts = [r["applicability"]["result"] for r in row["results"]]
    assert verdicts == sorted(verdicts, key=order.index)
    assert sum(row["counts"].values()) == len(row["results"]) > 0
    for r in row["results"]:
        ad = app.engine.all_ads()[r["ad_id"]]
        assert r["applicability"] == app.engine.check_applicability(ad, "AS350B3", "1")


def test_fleet_unknown_model_is_flagged_not_silent(client):
    row = fleet(client, [{"model": "ZZ-99"}])["aircraft"][0]
    assert row["status"] == "model_not_in_corpus" and row["results"] == [] and "not evidence" in row["note"]


def test_fleet_blank_model_does_not_sink_the_batch(client):
    rows = fleet(client, [{"model": "  "}, {"model": "P.68", "serial": "100"}])["aircraft"]
    assert rows[0]["status"] == "invalid" and rows[1]["status"] == "ok"


def test_fleet_ambiguous_model_asks_for_exact_variant(client):
    row = fleet(client, [{"model": "A320", "serial": "1"}])["aircraft"][0]
    amb = [r for r in row["results"] if r["applicability"]["result"] == "AMBIGUOUS"]
    assert amb and amb[0]["applicability"]["candidates"]


def test_fleet_limits(client):
    assert client.post("/fleet", json=[{"model": "P.68"}] * 501).status_code == 422
    assert client.post("/fleet", json=[{"model": "x" * 41}]).status_code == 422
    assert fleet(client, [])["aircraft"] == []
