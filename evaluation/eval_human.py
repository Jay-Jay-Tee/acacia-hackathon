"""Human-written question set (evaluation/human_questions.jsonl). Run: python evaluation/eval_human.py [-v]

Every question was written by hand against the corpus, not copied from a document summary, so these numbers
are separate from the SYNTHETIC recall in eval.py (which uses a sentence from the target's own summary).
No LLM calls; deterministic.

Per row it checks, when the field is present:
  recall@5      the expected docket (or, for multi_document, every docket) is among the top-5 retrieved dockets,
                searched with the row's model, independent of the gate
  status        engine.gate() outcome equals `expect` (rows without `expect` skip this) (answered | refused | needs_clarification)
  revision      the retrieved docket's newest notice has `latest_publish` / `latest_status`
  applicability check_applicability() on the docket's newest notice equals `expect_applicability`
"""
import json
import sys
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import engine  # noqa: E402

VERBOSE = "-v" in sys.argv


def top5_dockets(query, model):
    ads = engine.all_ads()
    res = engine.search(query, model=model)
    return list(dict.fromkeys(ads[h["ad_id"]]["docket"] for h in res["hits"]))[:5]


def newest(docket):
    return engine.all_ads()[engine.revisions(docket)["latest_id"]]


def check(q):
    """Return {check_name: bool} for the checks this row defines."""
    out = {}
    model = q.get("model")
    wanted = q.get("dockets") or ([q["docket"]] if q.get("docket") else [])
    known = {a["docket"] for a in engine.all_ads().values()}
    assert all(d in known for d in wanted), f"{q['id']}: expected docket not in corpus: {wanted}"
    if wanted:
        top = top5_dockets(q["query"], model)
        out["recall@5"] = all(d in top for d in wanted)
        if not out["recall@5"] and VERBOSE:
            print(f"   MISS {q['id']} want {wanted} got {top}  {q['query'][:60]!r}")
        if model:  # the harder case: the user has not set an aircraft profile
            out["recall@5 no model"] = all(d in top5_dockets(q["query"], None) for d in wanted)
    if q.get("expect"):
        status = engine.gate(q["query"], model, q.get("serial"))[0]
        status = "answered" if status == "ok" else status
        out["status"] = status == q["expect"]
        if not out["status"] and VERBOSE:
            print(f"   STATUS {q['id']} want {q['expect']} got {status}  {q['query'][:60]!r}")
    if q.get("latest_publish") or q.get("latest_status"):
        n = newest(q["docket"])
        out["revision"] = (n["publish_date"] == q.get("latest_publish", n["publish_date"])
                           and n["status"] == q.get("latest_status", n["status"]))
        if not out["revision"] and VERBOSE:
            print(f"   REVISION {q['id']} want {q.get('latest_publish')}/{q.get('latest_status')} "
                  f"got {n['publish_date']}/{n['status']}")
    if q.get("expect_applicability"):
        got = engine.check_applicability(newest(q["docket"]), model, q.get("serial"))["result"]
        out["applicability"] = got == q["expect_applicability"]
        if not out["applicability"] and VERBOSE:
            print(f"   APPLIC {q['id']} want {q['expect_applicability']} got {got}  {model} S/N {q.get('serial')}")
    return out


def main():
    qs = [json.loads(l) for l in (HERE / "human_questions.jsonl").read_text().splitlines() if l.strip()]
    table = defaultdict(lambda: defaultdict(lambda: [0, 0]))
    for q in qs:
        for name, ok in check(q).items():
            table[q["category"]][name][0] += ok
            table[q["category"]][name][1] += 1
            table["ALL"][name][0] += ok
            table["ALL"][name][1] += 1
    print(f"== human-written set: {len(qs)} questions (NOT synthetic; see eval.py for the synthetic recall)")
    for cat in [c for c in table if c != "ALL"] + ["ALL"]:
        cells = "  ".join(f"{n} {a}/{b}" for n, (a, b) in sorted(table[cat].items()))
        print(f"  {cat:15s} {cells}")
    r, rn = table["ALL"]["recall@5"], table["ALL"]["recall@5 no model"]
    print(f"HUMAN-WRITTEN recall@5: {r[0]}/{r[1]} = {r[0] / r[1]:.0%} with the row's model; "
          f"{rn[0]}/{rn[1]} = {rn[0] / rn[1]:.0%} with the model withheld (rows that give one)"
          + ("" if VERBOSE else "   (run with -v to list misses)"))


if __name__ == "__main__":
    main()
