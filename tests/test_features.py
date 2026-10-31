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
