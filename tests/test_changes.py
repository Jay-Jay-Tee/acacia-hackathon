import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app  # noqa: E402
import changes  # noqa: E402


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    return TestClient(app.app)


def ad_id(record_id):
    return next(i for i, a in app.engine.all_ads().items() if a.get("record_id") == record_id)


def rejoin(ops, side):
    return " ".join(o[side] for o in ops if o[side])


# ---------- diff_text ----------

def test_identical_text_is_all_equal():
    ops = changes.diff_text("This AD applies to model A. It covers serial 1 to 5.", "This AD applies to model A. It covers serial 1 to 5.")
    assert {o["op"] for o in ops} == {"equal"}


def test_changed_sentence_gets_a_word_level_diff():
    old = "This AD applies to model A. Comply by October 1, 2024."
    new = "This AD applies to model A. Comply by December 19, 2025."
    changed = [o for o in changes.diff_text(old, new) if o["op"] != "equal"]
    assert len(changed) == 1 and changed[0]["op"] == "replace"
    assert [(w["old"], w["new"]) for w in changed[0]["inline"] if w["op"] != "equal"] == [("October 1, 2024.", "December 19, 2025.")]


def test_inserted_and_deleted_sentences():
    ops = changes.diff_text("Inspect the pump. Replace the seal.", "Inspect the pump. Replace the seal. Report the findings.")
    assert [o["op"] for o in ops] == ["equal", "insert"] and ops[1]["new"] == "Report the findings."
    ops = changes.diff_text("Inspect the pump. Replace the seal.", "Inspect the pump.")
    assert [o["op"] for o in ops] == ["equal", "delete"] and ops[1]["old"] == "Replace the seal."


@pytest.mark.parametrize("old,new", [
    ("", "New text appears. Another sentence (a) follows; and more."),
    ("Only old text here. Second one.", ""),
    ("A. B (1) is here; C continues. D", "A. B (1) is changed; C continues. E. F"),
])
def test_ops_reconstruct_both_texts_exactly(old, new):
    ops = changes.diff_text(old, new)
    assert rejoin(ops, "old") == " ".join(old.split()) and rejoin(ops, "new") == " ".join(new.split())


# ---------- GET /diff ----------

def test_diff_defaults_to_the_previous_notice_and_reconstructs_the_text(client):
    new = ad_id("NPRM-011")   # FAA-2026-1338: NPRM-121 (older) -> NPRM-011 (newer)
    d = client.get(f"/diff?new_id={new}").json()
    assert d["comparable"] and d["same_docket"] and d["old"]["record_id"] == "NPRM-121" and d["new"]["record_id"] == "NPRM-011"
    app_sec = next(s for s in d["sections"] if s["key"] == "applicability")
    assert app_sec["changed"] is True and app_sec["available_old"] and app_sec["available_new"]
    ads = app.engine.all_ads()
    assert rejoin(app_sec["ops"], "old") == " ".join(ads[ad_id("NPRM-121")]["applicability_text"].split())
    assert rejoin(app_sec["ops"], "new") == " ".join(ads[ad_id("NPRM-011")]["applicability_text"].split())
    assert d["summary"].startswith("Applicability changed")


def test_diff_models_match_the_corpus(client):
    new, old = ad_id("NPRM-011"), ad_id("NPRM-121")
    d = client.get(f"/diff?new_id={new}&old_id={old}").json()
    ads = app.engine.all_ads()
    o, n = app.engine.effective_models(ads[old]), app.engine.effective_models(ads[new])
    assert d["models"]["added"] == [m for m in n if m not in o] and d["models"]["removed"] == [m for m in o if m not in n]


def test_diff_unavailable_text_is_not_reported_as_removed(client):
    # a withdrawal notice carries no rule text: the sections must say "cannot be compared", not "changed"
    new = ad_id("NPRM-252")   # FAA-2011-0033: latest notice is a withdrawal
    d = client.get(f"/diff?new_id={new}").json()
    assert d["comparable"]
    for s in d["sections"]:
        if not (s["available_old"] and s["available_new"]):
            assert s["changed"] is None and s["ops"] == [] and "cannot be compared" in s["note"]


def test_diff_for_the_earliest_notice_has_nothing_to_compare(client):
    d = client.get(f"/diff?new_id={ad_id('NPRM-278')}").json()   # oldest of FAA-2011-0033
    assert d["comparable"] is False and "earliest" in d["reason"]


def test_diff_input_errors(client):
    assert client.get("/diff?new_id=999999").status_code == 404
    assert client.get(f"/diff?new_id={ad_id('NPRM-011')}&old_id=999999").status_code == 404
    assert client.get(f"/diff?new_id={ad_id('NPRM-011')}&old_id={ad_id('NPRM-011')}").status_code == 422


# ---------- POST /watchlist/status ----------

def status(client, items):
    r = client.post("/watchlist/status", json=items)
    assert r.status_code == 200
    return r.json()["items"]


def test_watchlist_reports_new_notices_since_last_review(client):
    # FAA-2011-0033 has NPRM-278 (oldest), NPRM-271, NPRM-252 (newest, a withdrawal)
    cur, old, mid, none = status(client, [{"docket": "FAA-2011-0033", "seen_record_id": "NPRM-252"},
                                          {"docket": "FAA-2011-0033", "seen_record_id": "NPRM-278"},
                                          {"docket": "FAA-2011-0033", "seen_record_id": "NPRM-271"},
                                          {"docket": "FAA-2011-0033"}])
    assert (cur["changed"], cur["new_notices"]) == (False, 0)
    assert (old["changed"], old["new_notices"]) == (True, 2)
    assert (mid["changed"], mid["new_notices"]) == (True, 1)
    assert (none["changed"], none["new_notices"]) == (False, 0)      # nothing reviewed yet: nothing to flag
    assert cur["headline"] == "Withdrawn: no action required." and cur["current"]["record_id"] == "NPRM-252"
    assert old["seen_ad_id"] == ad_id("NPRM-278") and none["seen_ad_id"] is None


def test_watchlist_unknown_docket_and_unknown_last_reviewed_notice(client):
    gone, stale = status(client, [{"docket": "NOT-A-DOCKET"}, {"docket": "FAA-2011-0033", "seen_record_id": "NPRM-999"}])
    assert gone == {"docket": "NOT-A-DOCKET", "found": False, "note": "This docket is not in the corpus."}
    assert stale["seen_known"] is False and stale["changed"] is True   # never silently hide a possible change


def test_watchlist_limits(client):
    assert client.post("/watchlist/status", json=[{"docket": "x"}] * 101).status_code == 422
    assert client.post("/watchlist/status", json=[{"docket": "x" * 41}]).status_code == 422
    assert status(client, []) == []
