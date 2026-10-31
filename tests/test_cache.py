import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import engine  # noqa: E402
import llm  # noqa: E402


def hits():
    return [dict(h) for h in engine.search("fuel starvation engine shutdown", model="P.68")["hits"][:3]]


def test_cache_key_stable_for_same_input():
    assert llm._cache_key("q", hits()) == llm._cache_key("q", hits())


def test_cache_key_changes_with_question_text_or_ids():
    base = llm._cache_key("q", hits())
    assert llm._cache_key("q2", hits()) != base
    h = hits(); h[0]["text"] += " changed"
    assert llm._cache_key("q", h) != base
    h = hits(); h[0]["chunk_id"] += 1
    assert llm._cache_key("q", h) != base


def test_search_cache_returns_independent_copies():
    a = engine.search("fuel starvation engine shutdown", model="P.68")
    a["hits"][0]["text"] = "mutated"
    b = engine.search("fuel starvation engine shutdown", model="P.68")
    assert b["hits"][0]["text"] != "mutated"


def test_relevance_gate_words_or_meaning():
    res = lambda cov, sim, n=4: {"tokens": ["t"] * n, "hits": [{"coverage": cov, "sim": sim}]}
    assert engine.relevant(res(0.75, None))            # enough query words present
    assert not engine.relevant(res(0.5, None))         # too few words, no embeddings
    assert engine.relevant(res(0.25, 0.80))            # few shared words but close in meaning
    assert not engine.relevant(res(0.25, 0.60))        # neither
    assert not engine.relevant(res(0.5, None, n=2))    # short queries need every word
    assert not engine.relevant({"tokens": ["t"], "hits": []})
