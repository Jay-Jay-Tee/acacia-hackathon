"""Retrieval latency on the real corpus and on a duplicated corpus (headroom check).

Every question in the evaluation sets is searched with the LRU cache cleared first, so each timing is a
real retrieval (BM25 + vector scoring for the relevance gate), not a cache hit. The scaled corpus is the
real index copied N times (ads, chunks, FTS rows, embeddings) into a temp directory; the committed data
is never touched. Duplicates keep the original text and models, so BM25 scans N times as many postings
and the vector matrix is N times as tall. That shows headroom, not accuracy on a larger real corpus.

Run: python evaluation/bench_latency.py [--scale 5] [--rounds 3] [--bm25-only] [--json out.json]
"""
import argparse
import hashlib
import json
import platform
import shutil
import sqlite3
import statistics
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT))

import engine  # noqa: E402
import rules  # noqa: E402

ID_STRIDE = 1_000_000  # copy k gets ids offset by k * ID_STRIDE; keeps chunk id order (copy by copy)


def load_queries():
    seen, out = set(), []
    for name in ("questions", "human_questions", "dev_paraphrases", "dev_paraphrases_holdout", "dev_negatives"):
        for line in (HERE / f"{name}.jsonl").read_text().splitlines():
            if not line.strip():
                continue
            q = json.loads(line)
            key = (q["query"], q.get("model"))
            if key not in seen:
                seen.add(key)
                out.append(key)
    return out


_VECTORS = engine._vectors


def reset_engine():
    engine._vectors = _VECTORS  # undo the --bm25-only patch
    for fn in (engine._con, engine.all_ads, engine._vectors, engine._search_cached, engine.known_models):
        fn.cache_clear()


def build_scaled(scale, tmp):
    """Copy the index `scale` times into tmp and point the engine at it. Returns (chunks, passages with vectors)."""
    import numpy as np

    db = tmp / "ads.db"
    shutil.copy(engine.DB, db)
    con = sqlite3.connect(db)
    ads = con.execute("SELECT id, docket, data FROM ads").fetchall()
    chunks = con.execute("SELECT id, ad_id, section, page, text FROM chunks ORDER BY id").fetchall()
    subj = {a[0]: json.loads(a[2]) for a in ads}
    for k in range(1, scale):
        off = k * ID_STRIDE
        for ad_id, docket, data in ads:
            d = json.loads(data)
            d["id"] = ad_id + off
            con.execute("INSERT INTO ads VALUES (?,?,?)", (ad_id + off, docket, json.dumps(d)))
        for cid, ad_id, section, page, text in chunks:
            con.execute("INSERT INTO chunks (id, ad_id, section, page, text) VALUES (?,?,?,?,?)",
                        (cid + off, ad_id + off, section, page, text))
            d = subj[ad_id]
            con.execute("INSERT INTO chunks_fts (rowid, text, subject, models) VALUES (?,?,?,?)",
                        (cid + off, text, d["subject"], " ".join(d["models"])))
    con.commit()
    n_chunks = con.execute("SELECT count(*) FROM chunks").fetchone()[0]
    con.close()

    n_vec = 0
    if engine.EMB.exists() and engine.EMB_META.exists():
        meta = json.loads(engine.EMB_META.read_text())
        mat = np.load(engine.EMB)
        texts = []
        for k in range(scale):
            for cid, ad_id, section, _, text in chunks:
                t = rules.embed_text(subj[ad_id]["subject"], section, text)
                if t:
                    texts.append(t)
        ids = [cid + k * ID_STRIDE for k in range(scale) for cid in meta["ids"]]
        np.save(tmp / "emb.npy", np.tile(mat, (scale, 1)))
        (tmp / "emb_meta.json").write_text(json.dumps({
            "digest": hashlib.sha256("\x00".join(texts).encode()).hexdigest(), "model": meta["model"], "ids": ids}))
        n_vec = len(ids)
    engine.DB, engine.EMB, engine.EMB_META = db, tmp / "emb.npy", tmp / "emb_meta.json"
    return n_chunks, n_vec


def measure(queries, rounds, bm25_only):
    reset_engine()
    if bm25_only:
        engine._vectors = lambda: None
    elif not engine.hybrid_enabled():
        print("  warning: embeddings not available, BM25 only")
    for q, m in queries[:5]:  # warm-up: loads the embedding model and the SQLite page cache
        engine._search_cached.cache_clear()
        engine.search(q, model=m)
    lat = []
    for _ in range(rounds):
        for q, m in queries:
            engine._search_cached.cache_clear()
            lat.append(engine.search(q, model=m)["ms"])
    lat.sort()
    pct = lambda p: lat[min(len(lat) - 1, int(round(p * len(lat) + 0.5)) - 1)]
    return {"n": len(lat), "p50": statistics.median(lat), "p95": pct(0.95), "p99": pct(0.99), "max": lat[-1],
            "mean": statistics.fmean(lat)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scale", type=int, default=5)
    ap.add_argument("--rounds", type=int, default=3)
    ap.add_argument("--bm25-only", action="store_true", help="skip the vector scoring step")
    ap.add_argument("--json", help="also write the results to this file")
    args = ap.parse_args()
    queries = load_queries()
    real = (engine.DB, engine.EMB, engine.EMB_META)
    print(f"{len(queries)} distinct (query, model) pairs x {args.rounds} rounds, cache cleared before each; "
          f"{platform.platform()}, Python {platform.python_version()}")
    out = {}

    reset_engine()
    n_chunks = engine._con().execute("SELECT count(*) FROM chunks").fetchone()[0]
    out["1x"] = {"chunks": n_chunks, **measure(queries, args.rounds, args.bm25_only)}
    out["1x"]["hybrid"] = not args.bm25_only and engine.hybrid_enabled()

    with tempfile.TemporaryDirectory() as t:
        n_chunks_s, n_vec = build_scaled(args.scale, Path(t))
        out[f"{args.scale}x"] = {"chunks": n_chunks_s, **measure(queries, args.rounds, args.bm25_only)}
        out[f"{args.scale}x"]["hybrid"] = not args.bm25_only and engine.hybrid_enabled()
        out[f"{args.scale}x"]["vectors"] = n_vec
    engine.DB, engine.EMB, engine.EMB_META = real
    reset_engine()

    print(f"\n{'corpus':8s} {'chunks':>7s} {'queries':>8s} {'p50 ms':>8s} {'p95 ms':>8s} {'p99 ms':>8s} {'max ms':>8s}  vectors")
    for name, r in out.items():
        print(f"{name:8s} {r['chunks']:7d} {r['n']:8d} {r['p50']:8.1f} {r['p95']:8.1f} {r['p99']:8.1f} {r['max']:8.1f}  "
              f"{'on' if r['hybrid'] else 'off'}")
    base = out["1x"]
    big = out[f"{args.scale}x"]
    print(f"\n{args.scale}x corpus: p50 x{big['p50'] / base['p50']:.1f}, p95 x{big['p95'] / base['p95']:.1f}; "
          f"p95 {big['p95']:.0f} ms vs the 3000 ms target")
    if args.json:
        Path(args.json).write_text(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
