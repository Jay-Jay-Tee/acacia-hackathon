# Evaluation

Scripts and question sets for measuring retrieval, applicability and refusal behaviour. Metrics and interpretation live in [../docs/EVAL.md](../docs/EVAL.md).

## Files

| File | What it is |
|---|---|
| `eval.py` | Main eval: corpus, synthetic applicability, synthetic retrieval, hand-written questions, latency. `--llm` adds Claude answers and citation coverage. |
| `eval_retrieval.py` | Dev + held-out paraphrase recall@5 and relevance-gate pass rate; off-topic refusal. `-v` prints misses, `--sims` prints similarity tables. |
| `questions.jsonl` | 22 hand-written questions, tagged by category with expected status and docket. |
| `dev_paraphrases.jsonl` | 16 development paraphrases (where synonym gaps were found). |
| `dev_paraphrases_holdout.jsonl` | 10 held-out paraphrases, written before the synonym list. |
| `dev_negatives.jsonl` | 12 off-topic questions for the refusal gate. |
| `eval_human.py` | Scores `human_questions.jsonl`: recall@5 (with and without the model), gate status, revision/withdrawn, serial verdicts. `-v` lists every miss. |
| `bench_latency.py` | Retrieval p50/p95/p99 on the real index and a copy scaled N× (`--scale 5`), cache cleared per query. `--bm25-only` skips vector scoring. |
| `timed_study.py`, `timed_study_tasks.jsonl` | Stopwatch harness and 5 tasks for the manual-vs-tool study (`run --arm manual|tool --who NAME`, `report`). Holds no results until a person runs it. |
| `human_questions.jsonl` | 107 hand-written questions (answerable, out-of-scope, ambiguous, contradicting, revision, withdrawn, multi-document, serial edge cases). Reported separately from the synthetic recall. |

## Run

From the repo root (the scripts add the repo root to `sys.path` themselves, so `import engine` works):

```bash
.venv/bin/python evaluation/eval.py
.venv/bin/python evaluation/eval.py --llm
.venv/bin/python evaluation/eval_retrieval.py
.venv/bin/python evaluation/eval_retrieval.py -v
.venv/bin/python evaluation/eval_human.py -v
```

`eval.py` needs `data/ads.db`; build it with `python ingest.py --no-fetch` (or `--embed` for hybrid retrieval). `--llm` needs `ANTHROPIC_API_KEY` in `.env`.

## Row formats

`questions.jsonl`:
```json
{"category": "answerable", "query": "...", "model": "P.68", "serial": "100", "expect": "answered", "docket": "FAA-2026-11794"}
```
`expect` is `answered`, `refused` or `needs_clarification`; `docket` is optional and checked in the top 5 when present.

`dev_paraphrases*.jsonl`:
```json
{"query": "...", "model": "787-8", "docket": "FAA-2026-1335"}
```

`dev_negatives.jsonl`:
```json
{"query": "What is the weather forecast for Paris tomorrow?"}
```

## Adding questions

- Keep them **paraphrased**, not copied from a document summary; a copied sentence inflates recall.
- Keep the synthetic/hand-written distinction visible. New human-written rows belong in `questions.jsonl`; new paraphrase probes in the dev set; a new holdout should be written before tuning against it.
- Update the counts in [../docs/EVAL.md](../docs/EVAL.md) and the README results table if a headline number changes.
