"""Feasibility eval. Run: python eval.py [--llm]

Sections:
  1. Corpus coverage (rows with full text, FR pages)
  2. SYNTHETIC applicability tests generated from the Model column
  3. SYNTHETIC retrieval recall@5: query = a summary sentence, target = its own docket
  4. Hand-written questions (questions.jsonl): expected status per category
  5. Retrieval latency p50/p95 across everything above
  --llm additionally calls Claude on answerable questions and reports citation coverage.
"""
import argparse
import json
import random
import re
import statistics
import time
from collections import Counter, defaultdict
from pathlib import Path

import engine

ROOT = Path(__file__).parent
latencies = []


def timed_search(q, model=None):
    res = engine.search(q, model=model)
    latencies.append(res["ms"])
    return res


def corpus():
    ads = engine.all_ads().values()
    full = [a for a in ads if a["fulltext"]]
    pages = sum((a["page_end"] - a["page_start"] + 1) for a in full if a["page_start"] and a["page_end"])
    n_chunks = engine._con().execute("SELECT count(*) FROM chunks").fetchone()[0]
    print(f"[1] corpus: {len(ads)} rows, {n_chunks} chunks, full text for {len(full)} rows (~{pages} FR pages), "
          f"applicability paragraph parsed for {sum(1 for a in ads if a['applicability_text'])} rows")
    print(f"    status: {dict(Counter(a['status'] for a in ads))}")


def synthetic_applicability():
    ads = list(engine.all_ads().values())
    by_make = defaultdict(set)
    for a in ads:
        for m in engine.effective_models(a):
            by_make[a["make"]].add(m)
    pos, neg, pos_results = [0, 0], [0, 0], Counter()
    for a in ads:
        models = engine.effective_models(a)
        if not models:
            continue
        r = engine.check_applicability(a, models[0])["result"]
        pos_results[r] += 1
        pos[0] += r != "DOES_NOT_APPLY"
        pos[1] += 1
        listed = {engine.norm_model(m) for m in models}
        others = [m for m in sorted(by_make[a["make"]])
                  if not any(engine.norm_model(m).startswith(l) or l.startswith(engine.norm_model(m)) for l in listed)]
        if others:
            r = engine.check_applicability(a, others[0])["result"]
            neg[0] += r == "DOES_NOT_APPLY"
            neg[1] += 1
    print(f"[2] SYNTHETIC applicability (model-level, generated from the Model column):")
    print(f"    listed model never wrongly excluded: {pos[0]}/{pos[1]}; outcome mix {dict(pos_results)}")
    print(f"    sibling model (same make, not listed) correctly excluded: {neg[0]}/{neg[1]}")
    print(f"    -> UNKNOWN = serial/config condition the rules could not parse ({pos_results['UNKNOWN']}/{pos[1]})")


def synthetic_retrieval(n=80):
    rnd = random.Random(7)
    ads = [a for a in engine.all_ads().values() if len(a["summary"]) > 200]
    hit = 0
    sample = rnd.sample(ads, min(n, len(ads)))
    for a in sample:
        sents = [s for s in re.split(r"(?<=\.)\s+", " ".join(a["summary"].split())) if len(s) > 60]
        q = sents[min(1, len(sents) - 1)][:300]
        dockets = {engine.all_ads()[h["ad_id"]]["docket"] for h in timed_search(q)["hits"][:5]}
        hit += a["docket"] in dockets
    print(f"[3] SYNTHETIC retrieval recall@5 (summary sentence -> own docket): {hit}/{len(sample)} = {hit / len(sample):.0%}")


def handwritten(use_llm):
    path = ROOT / "questions.jsonl"
    qs = [json.loads(l) for l in path.read_text().splitlines() if l.strip()]
    per_cat = defaultdict(lambda: [0, 0])
    cited = [0, 0]
    failures = []
    for q in qs:
        t0 = time.perf_counter()
        status, reason, res, _ = engine.gate(q["query"], q.get("model"), q.get("serial"))
        latencies.append((time.perf_counter() - t0) * 1000)
        status = "answered" if status == "ok" else status
        ok = status == q["expect"]
        if ok and q.get("docket") and res:
            ok = q["docket"] in {engine.all_ads()[h["ad_id"]]["docket"] for h in res["hits"][:5]}
        per_cat[q["category"]][0] += ok
        per_cat[q["category"]][1] += 1
        if not ok:
            failures.append((q, status, reason))
        if use_llm and status == "answered":
            import llm
            mode, blocks, note = llm.answer(q["query"], res["hits"][:6])
            cited[0] += sum(1 for b in blocks if b["citations"])
            cited[1] += len(blocks)
            print(f"    [{mode}] {q['query'][:60]!r}: {len(blocks)} blocks. {note}")
    print("[4] hand-written questions (expected status, and expected docket in top 5 where given):")
    for cat, (a, b) in sorted(per_cat.items()):
        print(f"    {cat:15s} {a}/{b}")
    for q, status, reason in failures:
        print(f"    FAIL {q['category']}: {q['query'][:70]!r} expected {q['expect']}, got {status} {reason[:80]}")
    if use_llm and cited[1]:
        print(f"    citation coverage of answer blocks: {cited[0]}/{cited[1]}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--llm", action="store_true")
    args = ap.parse_args()
    corpus()
    synthetic_applicability()
    synthetic_retrieval()
    handwritten(args.llm)
    lat = sorted(latencies)
    print(f"[5] retrieval latency over {len(lat)} queries: p50 {statistics.median(lat):.1f} ms, "
          f"p95 {lat[int(len(lat) * 0.95) - 1]:.1f} ms, max {lat[-1]:.1f} ms (target < 3000 ms)")


if __name__ == "__main__":
    main()
