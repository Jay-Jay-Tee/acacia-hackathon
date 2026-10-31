import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app  # noqa: E402


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)  # extractive mode: deterministic, no API cost
    return TestClient(app.app)


def test_citations_carry_record_id_and_page_range(client):
    r = client.post("/ask", json={"query": "fuel starvation engine shutdown", "model": "P.68", "serial": "100"}).json()
    assert r["status"] == "answered" and r["mode"] == "extractive"
    cit = r["answer_blocks"][0]["citations"][0]
    assert cit["record_id"].startswith("NPRM-") and cit["fr_citation"] and cit["pages"] and cit["section"]
    doc = r["documents"][0]
    assert doc["record_id"].startswith("NPRM-") and doc["status_label"] and doc["publish_date"]


def test_proposed_rules_get_a_notice(client):
    r = client.post("/ask", json={"query": "fuel starvation engine shutdown", "model": "P.68", "serial": "100"}).json()
    assert any("proposed rules (NPRMs)" in n for n in r["notices"])


def test_refusals_have_no_notices(client):
    r = client.post("/ask", json={"query": "who won the world cup"}).json()
    assert r["status"] == "refused" and r["notices"] == []


def test_corpus_stats(client):
    c = client.get("/corpus").json()
    assert c["records"] == 431 and c["federal_register_pages"] > 1000 and c["passages"] > 1000


def test_revisions_ordered_by_publish_date():
    import engine
    for docket in ["FAA-2026-1338", "FAA-2025-2277"]:
        dates = [v["publish_date"] for v in engine.revisions(docket)["versions"]]
        assert dates == sorted(dates, reverse=True)
