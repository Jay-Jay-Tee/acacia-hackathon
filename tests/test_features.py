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
    for line in (ROOT / "questions.jsonl").read_text().splitlines():
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


# ---------- GET /ad/{ad_id}/timeline ----------

def ad_id_for(record_id):
    return next(i for i, a in app.engine.all_ads().items() if a.get("record_id") == record_id)


def test_timeline_orders_notices_and_flags_withdrawn_current(client):
    t = client.get(f"/ad/{ad_id_for('NPRM-278')}/timeline").json()  # FAA-2011-0033: proposed, proposed, withdrawn
    assert [e["kind"] for e in t["events"]] == ["proposed", "revised", "withdrawn"]
    dates = [e["publish_date"] for e in t["events"]]
    assert dates == sorted(dates)
    assert [e["is_current"] for e in t["events"]] == [False, False, True]
    assert t["headline"] == "Withdrawn: no action required."
    assert t["count"] == 3 == len(t["events"])


def test_timeline_same_for_every_notice_in_a_docket(client):
    ids = [i for i, a in app.engine.all_ads().items() if a["docket"] == "FAA-2011-0033"]
    assert len({tuple(e["ad_id"] for e in client.get(f"/ad/{i}/timeline").json()["events"]) for i in ids}) == 1


def test_timeline_single_notice_proposed_is_not_in_effect(client):
    ad_id = next(i for i, a in app.engine.all_ads().items()
                 if a["status"] == "proposed" and app.engine.revisions(a["docket"])["count"] == 1)
    t = client.get(f"/ad/{ad_id}/timeline").json()
    assert [e["kind"] for e in t["events"]] == ["proposed"] and t["events"][0]["is_current"]
    assert "not in effect" in t["headline"]


def test_every_superseded_number_is_mapped_or_marked_not_in_corpus(client):
    seen = 0
    for ad_id, ad in app.engine.all_ads().items():
        if not ad["supersedes"]:
            continue
        ev = next(e for e in client.get(f"/ad/{ad_id}/timeline").json()["events"] if e["ad_id"] == ad_id)
        assert [s["ad_number"] for s in ev["supersedes"]] == ad["supersedes"]
        assert all(isinstance(s["in_corpus"], bool) for s in ev["supersedes"])
        seen += 1
    assert seen > 0


def test_supersession_links_to_corpus_document_when_number_matches():
    from features import _supersession
    ad = next(a for a in app.engine.all_ads().values() if a["ad_number"])
    link = _supersession(ad["ad_number"])
    assert link["in_corpus"] and link["docket"] == ad["docket"] and link["ad_id"]
    assert _supersession("0000-00-00") == {"ad_number": "0000-00-00", "in_corpus": False}


def test_timeline_unknown_ad_is_404(client):
    assert client.get("/ad/999999/timeline").status_code == 404
