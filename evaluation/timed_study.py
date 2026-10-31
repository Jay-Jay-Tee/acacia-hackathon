"""Timed manual-vs-tool study: 5 applicability tasks, same person, stopwatch.

Each task asks whether the latest notice on a topic applies to one aircraft/engine serial. The task gives the
topic and the serial, not the docket, so the person has to find the notice first. Ground truth is in
timed_study_tasks.jsonl (each verdict was checked against the quoted (c) Applicability paragraph).

  manual   federalregister.gov search and reading only. No AD Finder.
  tool     AD Finder UI with the aircraft profile set; time until the verdict is read off the screen.
           For T2 and T3 (serial outside the range) the tool answers with a refusal whose reason says no matching
           document applies to that serial; that reason is the verdict (DOES_NOT_APPLY).

Run:   python evaluation/timed_study.py run --arm manual --who NAME
       python evaluation/timed_study.py run --arm tool   --who NAME
       python evaluation/timed_study.py report
Results append to evaluation/results/timed_study.jsonl. Nothing is generated: every row is a stopwatch reading.
For the tool arm, `machine_ms` is the time the engine spent on retrieval + the applicability check, shown only
to separate system time from the person's reading time (it excludes the Claude answer, about 4-5 s).
"""
import argparse
import json
import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

TASKS = [json.loads(l) for l in (HERE / "timed_study_tasks.jsonl").read_text().splitlines() if l.strip()]
OUT = HERE / "results" / "timed_study.jsonl"
VERDICTS = {"a": "APPLIES", "n": "DOES_NOT_APPLY", "u": "UNKNOWN"}


def machine_ms(task):
    import engine
    engine._search_cached.cache_clear()  # a cold retrieval, not an LRU hit
    t0 = time.perf_counter()
    status, _, res, _ = engine.gate(task["topic"], task["model"], task["serial"])
    hits = res["hits"] if res else engine.search(task["topic"], model=task["model"])["hits"]
    if hits:
        ad = engine.all_ads()[engine.revisions(engine.all_ads()[hits[0]["ad_id"]]["docket"])["latest_id"]]
        engine.check_applicability(ad, task["model"], task["serial"])
    return (time.perf_counter() - t0) * 1000


def run(arm, who):
    OUT.parent.mkdir(exist_ok=True)
    done = {(r["arm"], r["who"], r["task"]) for r in rows()}
    order = [t for t in TASKS if (arm, who, t["id"]) not in done]
    print(f"{arm} arm, {who}: {len(order)} task(s) left. Do not look at the answers. Ctrl-C to stop; finished tasks are kept.")
    for t in order:
        print(f"\n== {t['id']}: does the latest notice on '{t['topic']}' apply to {t['make_model']}, serial {t['serial']}?")
        input("   Press Enter to START the clock... ")
        t0 = time.perf_counter()
        input("   Press Enter the moment you have your verdict... ")
        secs = time.perf_counter() - t0
        v = ""
        while v not in VERDICTS:
            v = input("   Verdict [a]pplies / [n]ot apply / [u]nknown: ").strip().lower()[:1]
        notes = input("   Notes (optional, e.g. interruptions): ").strip()
        row = {"arm": arm, "who": who, "task": t["id"], "seconds": round(secs, 1), "verdict": VERDICTS[v],
               "correct": VERDICTS[v] == t["truth"], "notes": notes,
               "at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
        if arm == "tool":
            row["machine_ms"] = round(machine_ms(t), 1)
        with OUT.open("a") as f:
            f.write(json.dumps(row) + "\n")
        print(f"   recorded {secs:.1f} s, {'correct' if row['correct'] else 'WRONG'}")


def rows():
    return [json.loads(l) for l in OUT.read_text().splitlines() if l.strip()] if OUT.exists() else []


def report():
    data = rows()
    by = {}
    for r in data:
        by.setdefault((r["arm"], r["who"]), {})[r["task"]] = r
    complete = {k: v for k, v in by.items() if len(v) == len(TASKS)}
    for k, v in by.items():
        if k not in complete:
            print(f"ignored: {k[0]} / {k[1]} has {len(v)}/{len(TASKS)} tasks")
    people = sorted({w for _, w in complete})
    for who in people:
        m, t = complete.get(("manual", who)), complete.get(("tool", who))
        if not (m and t):
            print(f"{who}: needs both arms complete before a comparison is reported")
            continue
        print(f"\n{who}: n={len(TASKS)} tasks per arm (measured, one participant, not projected)")
        print(f"{'task':5s} {'manual s':>9s} {'tool s':>7s}  manual ok  tool ok")
        for x in TASKS:
            a, b = m[x["id"]], t[x["id"]]
            print(f"{x['id']:5s} {a['seconds']:9.1f} {b['seconds']:7.1f}  {str(a['correct']):9s}  {b['correct']}")
        ms, ts = [m[x['id']]["seconds"] for x in TASKS], [t[x['id']]["seconds"] for x in TASKS]
        print(f"total   manual {sum(ms):.0f} s, tool {sum(ts):.0f} s; median per task {statistics.median(ms):.0f} s vs "
              f"{statistics.median(ts):.0f} s; correct {sum(r['correct'] for r in m.values())}/{len(TASKS)} vs "
              f"{sum(r['correct'] for r in t.values())}/{len(TASKS)}")
        print(f"tool/manual time ratio {sum(ts) / sum(ms):.2f}; engine time inside the tool arm: "
              f"{statistics.median(r['machine_ms'] for r in t.values()):.0f} ms median")
    print("\nCaveats to quote with any number: n=5 tasks, one or few people; the tasks are straightforward "
          "serial-range cases from the corpus (no UNKNOWN cases); the second arm benefits from having already read the notice "
          "(record which arm went first).")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--arm", choices=["manual", "tool"], required=True)
    r.add_argument("--who", required=True)
    sub.add_parser("report")
    a = ap.parse_args()
    run(a.arm, a.who) if a.cmd == "run" else report()
