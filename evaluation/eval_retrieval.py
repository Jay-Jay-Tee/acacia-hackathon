"""P2 retrieval dev check on human-written paraphrases (dev_paraphrases.jsonl).

Reports, with and without the aircraft model given:
  recall@5   target docket among the top-5 retrieved dockets
  passes gate   the relevance gate lets the question through (a refusal here is a false refusal)
This is a small dev set written by P2; P3's larger set is the real test.
"""
import json
import sys
from pathlib import Path

import engine

ROOT = Path(__file__).parent


def run(path=ROOT / "dev_paraphrases.jsonl", verbose="-v" in sys.argv):
    qs = [json.loads(l) for l in path.read_text().splitlines() if l.strip()]
    for with_model in (True, False):
        hit = passed = 0
        for q in qs:
            model = q["model"] if with_model else None
            res = engine.search(q["query"], model=model)
            dockets = [engine.all_ads()[h["ad_id"]]["docket"] for h in res["hits"]]
            top5 = list(dict.fromkeys(dockets))[:5]
            ok = q["docket"] in top5
            status = engine.gate(q["query"], model)[0]
            hit += ok
            passed += status == "ok"
            if verbose and (not ok or status != "ok"):
                cov = res["hits"][0]["coverage"] if res["hits"] else 0
                print(f"   {'MISS' if not ok else 'hit '} gate={status:20s} cov={cov:.2f} {q['query'][:60]!r} want {q['docket']}")
        label = "with model" if with_model else "no model  "
        print(f"{label}: recall@5 {hit}/{len(qs)}  |  passes gate {passed}/{len(qs)}")
    negs = [json.loads(l)["query"] for l in (ROOT / "dev_negatives.jsonl").read_text().splitlines() if l.strip()]
    leaked = [q for q in negs if engine.gate(q)[0] == "ok"]
    print(f"off-topic questions refused by the gate: {len(negs) - len(leaked)}/{len(negs)}"
          + (f"  (passed: {leaked})" if verbose and leaked else ""))
    print(f"embeddings: {'on (relevance gate' + (' + ranking' if engine.VEC_WEIGHT else '') + ')' if engine.hybrid_enabled() else 'off (BM25 only)'}")


def sim_table():
    """Top-3 cosine similarity for positives vs negatives, to pick MIN_SIM."""
    pos = [json.loads(l)["query"] for l in (ROOT / "dev_paraphrases.jsonl").read_text().splitlines() if l.strip()]
    neg = [json.loads(l)["query"] for l in (ROOT / "dev_negatives.jsonl").read_text().splitlines() if l.strip()]
    top = lambda q: max((h["sim"] or 0) for h in engine.search(q)["hits"][:3] or [{"sim": 0}])
    p, n = sorted(map(top, pos)), sorted(map(top, neg))
    print("positives (should pass):", [f"{x:.2f}" for x in p])
    print("negatives (should fail):", [f"{x:.2f}" for x in n])


if __name__ == "__main__":
    if "--sims" in sys.argv:
        sim_table()
    else:
        print("== dev set (dev_paraphrases.jsonl)")
        run()
        print("== held-out set (dev_paraphrases_holdout.jsonl, written before the synonym list)")
        run(ROOT / "dev_paraphrases_holdout.jsonl")
