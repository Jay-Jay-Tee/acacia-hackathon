"""P4 change tracking: a "what changed" diff between two versions of a docket, and watchlist status.

Mounted in app.py with one line: app.include_router(changes.router)

- The diff compares the Applicability and Required actions text of two notices, sentence by sentence, with a
  word-level diff inside changed sentences. A section the dataset has no text for is "cannot be compared",
  never "removed" (withdrawal notices, for example, carry no rule text).
- The watchlist is kept in the browser (localStorage). The server is stateless: it reports, for each watched
  docket, whether notices newer than the one the user last reviewed (by record_id) have appeared.
"""
import difflib
import re
from typing import Annotated

from fastapi import APIRouter, Body, HTTPException
from pydantic import BaseModel, Field

import engine
from features import _chunks, _headline

router = APIRouter()

MAX_WATCH = 100
REQUIRED_RE = re.compile(r"^\([a-z]\)\s+(required actions|requirements)\b", re.I)
SECTIONS = [("applicability", "Applicability"), ("required_actions", "Required actions")]


# ---------- diff ----------

def _flat(text):
    return " ".join((text or "").split())


def _sentences(text):
    return [s for s in re.split(r"(?<=[.;])\s+(?=[A-Z(\d])", text) if s]


def _section_text(ad_id, key):
    if key == "applicability":
        return _flat(engine.all_ads()[ad_id].get("applicability_text"))
    return _flat(" ".join(text for _, section, _, text in _chunks(ad_id) if REQUIRED_RE.match(section)))


def _word_diff(old, new):
    a, b = old.split(), new.split()
    return [{"op": tag, "old": " ".join(a[i1:i2]), "new": " ".join(b[j1:j2])}
            for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes()]


def diff_text(old, new):
    """Sentence-level ops (equal | replace | delete | insert). Joining the `old` sides of every op gives the old
    text back and joining the `new` sides gives the new text, so nothing is lost. Replaced sentences also carry
    a word-level `inline` diff."""
    a, b = _sentences(_flat(old)), _sentences(_flat(new))
    ops = []
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        op = {"op": tag, "old": " ".join(a[i1:i2]), "new": " ".join(b[j1:j2])}
        if tag == "replace":
            op["inline"] = _word_diff(op["old"], op["new"])
        ops.append(op)
    return ops


def _ref(ad_id):
    card = engine.ad_card(ad_id)
    return {"ad_id": ad_id, "record_id": card["record_id"], "docket": card["docket"], "status": card["status"],
            "status_label": card["status_label"], "publish_date": card["publish_date"], "url": card["url"]}


def _section(old_id, new_id, key, name):
    old_t, new_t = _section_text(old_id, key), _section_text(new_id, key)
    out = {"key": key, "name": name, "available_old": bool(old_t), "available_new": bool(new_t),
           "changed": None, "ops": [], "note": ""}
    if old_t and new_t:
        out["ops"] = diff_text(old_t, new_t)
        out["changed"] = any(o["op"] != "equal" for o in out["ops"])
    elif old_t or new_t:
        out["note"] = (f"Only the {'older' if old_t else 'newer'} notice has this section's text in the dataset, "
                       "so the two cannot be compared.")
    else:
        out["note"] = "Neither notice has this section's text in the dataset, so they cannot be compared."
    return out


@router.get("/diff")
def diff(new_id: int, old_id: int | None = None):
    """What changed between two notices' Applicability and Required actions text. Without `old_id`, `new_id` is
    compared with the notice before it in the same docket."""
    ads = engine.all_ads()
    if new_id not in ads or (old_id is not None and old_id not in ads):
        raise HTTPException(404, "unknown ad_id")
    if old_id is None:
        ids = [v["id"] for v in engine.revisions(ads[new_id]["docket"])["versions"]]   # newest first
        k = ids.index(new_id)
        if k + 1 >= len(ids):
            return {"comparable": False, "new": _ref(new_id),
                    "reason": "This is the earliest notice in its docket, so there is nothing earlier to compare."}
        old_id = ids[k + 1]
    if old_id == new_id:
        raise HTTPException(422, "old_id and new_id must differ")

    old_m, new_m = engine.effective_models(ads[old_id]), engine.effective_models(ads[new_id])
    models = {"added": [m for m in new_m if m not in old_m], "removed": [m for m in old_m if m not in new_m],
              "unchanged": [m for m in new_m if m in old_m]}
    sections = [_section(old_id, new_id, key, name) for key, name in SECTIONS]
    parts = [f"{s['name']} " + ("changed" if s["changed"] else "unchanged" if s["changed"] is False
                                else "cannot be compared") for s in sections]
    if models["added"] or models["removed"]:
        parts.append(f"Models: {len(models['added'])} added, {len(models['removed'])} removed")
    return {"comparable": True, "same_docket": ads[old_id]["docket"] == ads[new_id]["docket"],
            "old": _ref(old_id), "new": _ref(new_id), "models": models, "sections": sections,
            "summary": "; ".join(parts) + "."}


# ---------- watchlist ----------

class Watch(BaseModel):
    docket: str = Field(max_length=40)
    seen_record_id: str | None = Field(default=None, max_length=40)   # the notice the user last reviewed


@router.post("/watchlist/status")
def watchlist_status(items: Annotated[list[Watch], Body(max_length=MAX_WATCH)]):
    """For each watched docket: the current notice, its headline, and whether notices newer than the one the user
    last reviewed (`seen_record_id`) have appeared. Unknown dockets are reported, not dropped."""
    ads, out = engine.all_ads(), []
    for w in items:
        docket = w.docket.strip()
        rev = engine.revisions(docket)
        if not rev["count"]:
            out.append({"docket": docket, "found": False, "note": "This docket is not in the corpus."})
            continue
        current = ads[rev["latest_id"]]
        records = [v["record_id"] for v in rev["versions"]]   # newest first
        id_of = {v["record_id"]: v["id"] for v in rev["versions"]}
        seen_known = w.seen_record_id is None or w.seen_record_id in records
        new_notices = records.index(w.seen_record_id) if w.seen_record_id in records else 0
        out.append({"docket": docket, "found": True, "subject": current["subject"], "make": current["make"],
                    "models": engine.effective_models(current), "count": rev["count"],
                    "current": _ref(rev["latest_id"]), "headline": _headline(current),
                    "new_notices": new_notices, "seen_known": seen_known,
                    "seen_ad_id": id_of.get(w.seen_record_id),   # lets the UI diff "since you last reviewed"
                    # an unknown last-reviewed notice (index rebuilt) is treated as a change, so nothing is missed
                    "changed": new_notices > 0 or not seen_known})
    return {"items": out}
