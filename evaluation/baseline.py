"""Hallucination baseline: Claude with NO documents vs the same questions through /ask.
Run: python evaluation/baseline.py run      (needs ANTHROPIC_API_KEY; calls the API; writes evaluation/baseline_raw.jsonl)
     python evaluation/baseline.py score    (deterministic; reads the raw file, writes evaluation/baseline_scored.json)

Method
  Arm A (no documents): the question alone, plain system prompt, no tools, no retrieval. Same model/effort as /ask.
  Arm B (/ask): the FastAPI handler called in-process via TestClient, with ADF_NO_CACHE=1 so each answer is fresh.
        The question's model is passed as the aircraft model. mode must be 'generated'; any other outcome is recorded
        as-is (a refusal is NOT counted as a hallucination, but is reported).
Scoring (automatic, a floor on invented claims; a human then reads every raw answer)
  Extracted claim types: AD numbers (YYYY-NN-NN), FAA docket numbers, compliance intervals (N hours/cycles/months/days/
  years/landings), serial-number lists. A claim is SUPPORTED if it appears in the full text of the question's target
  docket (all chunks + its metadata), otherwise UNSUPPORTED. For arm B the claims are taken from answer text only.
  A claim can be true yet unsupported here (the model recalls a real AD that is not in the corpus); the manual column
  in the scored file lets the reviewer re-classify those, which is why both counts are reported.
"""
import json
import os
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
RAW, SCORED = HERE / "baseline_raw.jsonl", HERE / "baseline_scored.json"
QS = [json.loads(l) for l in (HERE / "baseline_questions.jsonl").read_text().splitlines() if l.strip()]

AD_RE = re.compile(r"\b(?:19|20)\d{2}-\d{2}-\d{2}\b")
DOCKET_RE = re.compile(r"\bFAA-\d{4}-\d{3,6}\b")
INTERVAL_RE = re.compile(r"\b(\d[\d,]*(?:\.\d+)?)\s*(flight hours|flight cycles|hours time-in-service|hours TIS|hours|cycles|months|days|years|landings|FH|FC)\b", re.I)
SERIAL_RE = re.compile(r"\b(?:serial numbers?|S/N|MSN)s?\s+([\w\-]+(?:(?:,|\s+and|\s+through|\s+to)\s*[\w\-]+)*)", re.I)


def claims(text):
    out = [("ad_number", m) for m in AD_RE.findall(text)] + [("docket", m) for m in DOCKET_RE.findall(text)]
    out += [("interval", f"{n.replace(',', '')} {u.lower()}") for n, u in INTERVAL_RE.findall(text)]
    out += [("serial", m.strip()) for m in SERIAL_RE.findall(text)]
    return list(dict.fromkeys(out))


def norm(s):
    return re.sub(r"[\s,]+", " ", s.lower())


def target_text(docket):
    import engine
    ids = [a["id"] for a in engine.all_ads().values() if a["docket"] == docket]
    parts = [json.dumps(engine.all_ads()[i], default=str) for i in ids]
    marks = ",".join("?" * len(ids))
    parts += [r[0] for r in engine._con().execute(f"SELECT text FROM chunks WHERE ad_id IN ({marks})", ids)]
    return norm(" ".join(parts))


def supported(kind, val, tt):
    v = norm(val)
    if kind == "interval":  # "125 flight hours" ~ "125 hours"; compare number + first unit word
        num, unit = v.split(" ", 1)
        unit = unit.split()[-1].rstrip("s")
        return re.search(rf"\b{re.escape(num)}\s+(?:[\w\-]+\s+){{0,3}}{re.escape(unit)}", tt) is not None
    return v in tt


def run():
    if not os.environ.get("ANTHROPIC_API_KEY"):
        env = HERE.parent / ".env"
        if not (env.exists() and "ANTHROPIC_API_KEY=" in env.read_text()):
            sys.exit("ANTHROPIC_API_KEY not set (env or .env): cannot run the baseline.")
    os.environ["ADF_NO_CACHE"] = "1"
    import anthropic
    from fastapi.testclient import TestClient
    import llm
    from app import app
    client, api = anthropic.Anthropic(timeout=60, max_retries=2), TestClient(app)
    with RAW.open("w") as f:
        for q in QS:
            resp = client.messages.create(
                model=llm.MODEL, max_tokens=8000, output_config={"effort": llm.EFFORT},
                system="You answer questions about FAA airworthiness directives for aviation maintenance staff.",
                messages=[{"role": "user", "content": q["query"]}])
            a = "".join(b.text for b in resp.content if b.type == "text")
            b = api.post("/ask", json={"query": q["query"], "model": q["model"]}).json()
            f.write(json.dumps({"id": q["id"], "query": q["query"], "model": q["model"], "docket": q["docket"],
                                "llm_model": llm.MODEL, "arm_a_no_docs": a, "arm_b_ask": b}) + "\n")
            print(q["id"], "done", flush=True)


def score():
    rows = [json.loads(l) for l in RAW.read_text().splitlines()]
    tally = {"A": {"claims": 0, "unsupported": 0, "answers_with_unsupported": 0},
             "B": {"claims": 0, "unsupported": 0, "answers_with_unsupported": 0, "not_generated": 0}}
    per = []
    for r in rows:
        tt = target_text(r["docket"])
        b = r["arm_b_ask"]
        b_text = " ".join(x["text"] for x in b.get("answer_blocks", []))
        entry = {"id": r["id"], "docket": r["docket"], "arm_b_status": b["status"], "arm_b_mode": b["mode"]}
        for arm, text in (("A", r["arm_a_no_docs"]), ("B", b_text)):
            cs = claims(text)
            bad = [(k, v) for k, v in cs if not supported(k, v, tt)]
            t = tally[arm]
            t["claims"] += len(cs)
            t["unsupported"] += len(bad)
            t["answers_with_unsupported"] += bool(bad)
            entry[f"arm_{arm}"] = {"claims": cs, "unsupported": bad, "manual_review": None}
        tally["B"]["not_generated"] += b["mode"] != "generated"
        per.append(entry)
    SCORED.write_text(json.dumps({"n": len(rows), "tally": tally, "per_question": per}, indent=1))
    print(json.dumps({"n": len(rows), **tally}, indent=1))


if __name__ == "__main__":
    {"run": run, "score": score}[sys.argv[1] if len(sys.argv) > 1 else "score"]()
