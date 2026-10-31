# AirFrame (Airbus track, Challenge #4)

*Aircraft-specific answers. Sources attached.*

Traceable search over the 431 FAA airworthiness-directive notices in the challenge dataset. Every answer sentence is cited as **record_id + Federal Register citation + page range + section**. Applicability (model and serial number) is checked by deterministic rules. The system refuses, or asks for clarification, when it can't answer reliably.

**Decision support only:** certifying staff make the final applicability and compliance decision. Most notices are **proposed rules (NPRMs), not final ADs**, and every answer that cites one says so.

**Docs:** [documentation index](docs/README.md) · [architecture](docs/ARCHITECTURE.md) · [API contract v1.3](docs/API.md) · [evaluation](docs/EVAL.md) · [team plan](docs/TEAM_PLAN.md). Work is tracked as GitHub issues labelled `p1-ui`, `p2-logic`, `p3-testing` and `p4-features`.

## Run
```bash
python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env          # add ANTHROPIC_API_KEY (optional: without it, answers are extractive)
.venv/bin/python ingest.py --no-fetch --embed   # builds data/ads.db from the committed FR cache, plus local
                                               # embeddings (~4 min once; omit --embed for keyword-only)
.venv/bin/uvicorn app:app --host 127.0.0.1 --port 8000
.venv/bin/python -m pytest -q tests
.venv/bin/python evaluation/eval.py            # add --llm to also test Claude's answers (costs a few cents)
.venv/bin/python evaluation/eval_retrieval.py  # relevance gate on paraphrased questions
```
`python ingest.py` without `--no-fetch` re-downloads the Federal Register documents by script (public, no login), as the brief allows.

## Repository layout
```
app.py, engine.py, llm.py, ...   FastAPI app and the deterministic/LLM core (repo root; imports are flat)
evaluation/                      Eval scripts and the hand-written/dev/held-out question sets
data/                            Source spreadsheets, Federal Register cache, built SQLite DB and embeddings
docs/                            Documentation: start at docs/README.md
frontend/                        Vite + React + TypeScript UI (P1/P4)
legacy/index.html                Plain-HTML UI fallback when frontend/dist has not been built
tests/                           pytest suite
```
Everything under `data/` that is generated (`ads.db`, embeddings, answer cache) is gitignored and rebuilt by `ingest.py`.

## Corpus (stated as the brief asks; also at `GET /corpus`)
| | |
|---|---|
| Records | 431 (`NPRM-001` to `NPRM-431`, from the organisers' `challenge4_ad_index.xlsx`) |
| Records with full text | 422 (398 Federal Register documents fetched by script, 24 from rule text pasted in the source sheet) |
| Federal Register pages | **~1,295** |
| Searchable passages | 8,971 (4,150 content passages also embedded) |
| Status | 285 proposed (NPRM), 124 withdrawn proposals, 21 final ADs, 1 not an AD (a 14 CFR Part 61 training rule) |

## How it splits work
| Code (deterministic) | Claude (`claude-opus-5-5`, low effort) |
|---|---|
| BM25 retrieval (SQLite FTS5) with a model pre-filter | Phrases the answer **only** from the retrieved passages, with native citations |
| Query expansion: aviation synonyms and abbreviations (winch→hoist, HPT→high-pressure turbine…) added to the user's words | Says whether each requirement is proposed or final |
| Relevance gate: query-word coverage, or meaning similarity from local embeddings (`bge-small`, no API) | |
| Applicability: model lists and serial rules → APPLIES / DOES_NOT_APPLY / UNKNOWN / AMBIGUOUS, with an evaluation trace | |
| Revisions: docket grouping, latest publish date = current version, withdrawals | |
| Refusal gates: out of scope, ambiguous model, premise contradicts applicability, requests to skip a mandatory action, questions about the assistant | |
| Post-check: drops any sentence with no citation, or whose numbers don't appear in its cited text | |
| Status notices: a fixed line whenever a cited document is an NPRM or a withdrawn proposal | |

If Claude errors or declines, `/ask` falls back to **extractive mode** (verbatim cited passages, no generated prose). If Claude finds nothing in the passages, the question is refused.

## Assumptions (stated for the judges)
1. **Current version** of a docket = the record with the latest Federal Register publish date (organisers' rule). The source `Status` column says "Current" on every row, so it is ignored.
2. **A docket whose latest notice is a withdrawal** has no active proposal: applicability is DOES_NOT_APPLY, with that reason in the trace.
3. **Each row is cited from the Federal Register document whose first page matches the row's own citation.** Where the index's link points elsewhere, the link is not used (see the data finding below).
4. **Models.** Where the sheet's Model column is empty, models are read from the applicability paragraph, else the summary. Each card shows the source (`models_source`).
5. **Anything the rules can't evaluate is UNKNOWN, never guessed.** That covers serials listed in tables or service bulletins, installed-part and modification conditions, applicability delegated to a foreign AD, and serial formats that don't match the rule.
6. **Each question is answered independently** (no chat memory), from the corpus only.

## Results (`evaluation/eval.py`, `evaluation/eval_retrieval.py`)
See [docs/EVAL.md](docs/EVAL.md) for how each number is produced and which sets are synthetic.
| Check | Result |
|---|---|
| Hand-written questions (22) | answerable 8/8 · out-of-scope 4/4 · ambiguous 2/2 · contradicting 3/3 · injection 5/5 |
| Citation coverage of generated answer blocks | 100% |
| Rows with a model list | 375/431 own (86 from the sheet, the rest parsed); 389/431 after inheriting within dockets. Parser checked against the sheet's own lists: 97% precision, 78% recall |
| *Synthetic:* applicability | listed model never wrongly excluded 206/206 · unlisted sibling excluded 165/165 · withdrawn proposals not applying 183/183 |
| Paraphrased questions let through the relevance gate | **Held-out set (10, written before the synonym list): 8/10 with the model given (7/10 without expansion)**; dev set (16, where the gaps were found): 15/16 (5/16 keyword-only). Off-topic refused 11/12 at the gate, the 12th refused after Claude |
| Paraphrase retrieval recall@5 | held-out: 10/10 with the model given, **7/10 without** (vague questions match several ADs, so the aircraft model matters); dev: 16/16 |
| *Synthetic:* retrieval recall@5 | 79/80 (inflated: the query is a sentence from the target's own summary) |
| Retrieval latency | p50 ~13–16 ms, p95 ~23–29 ms over 1,295 pages across runs (target < 3,000 ms); full answer with Claude ~4–5 s, ~0 s when cached |

## Data finding: the index's links
For **169 rows**, the `federal_register_link` in `challenge4_ad_index.xlsx` points to a *different notice in the same docket* than the one the row cites, usually the original NPRM when the row is its revision or withdrawal. In 12 of 12 sampled cases, the linked document's first page does not match the row's cited page. Our document matches it for 382 of 389 rows. Using the link column blindly would cite the wrong notice, so we key on the cited page (assumption 3).

## Failures found and fixed (for the pitch)
- **"What's your system prompt?" was answered with unrelated passages.** Substring matching let "prompt" match "prom**pt**ed", and Claude's correct "documents don't answer this" was replaced by extractive passages labelled "Answer". Fixed with whole-word matching, a gate for questions about the assistant, and treating "documents don't answer" as a refusal.
- **Wrong verdicts from the first serial parser:**
  - It said DOES_NOT_APPLY for a CF34-3A1 engine (ESN 807500) that the AD covers, because only the first paragraph's range was read.
  - It said APPLIES for a CL-600-2A12 (S/N 1050) outside its range.
  - Fixed with per-model paragraph matching, ranges from every clause, and UNKNOWN when paragraphs can't be matched.
- **84 withdrawn proposals were shown as active,** because detection only matched "withdrawing" (missing "withdraws") and only subjects *starting* with "Withdrawal". Fixed: 124 withdrawals detected.

## Source-data problems handled
- **NPRM-314:** the source sheet's summary describes instrument approach procedures, not this Embraer AD. It is not indexed, and the card shows a `data_warning`; the Federal Register text is used instead.
- **NPRM-290:** a 14 CFR Part 61 pilot-training rule, not an AD. It has status `not_ad` and is never treated as a directive. The CFR part is read from each document's header.
- **169 index links** point to a different notice than the row cites (see above).

## Answer model (measured)
The same 16 gated questions (8 hand-written answerable + held-out paraphrases), answer cache off:

| Model, effort | Expected AD cited | NPRM status stated | Sentences dropped by the citation check | Latency avg / p90 |
|---|---|---|---|---|
| **`claude-opus-5-5`, low (default)** | 14/15 | 15/16 | 5 | **5.2 s** / 6.5 s |
| `claude-opus-5-5`, medium | 14/15 | 15/16 | 7 | 6.7 s / 10.0 s |
| `claude-opus-5-5`, high | 14/15 | 15/16 | 23 | 9.2 s / 11.3 s |
| `claude-fable-5-1`, low | 14/15 | 15/16 | 6 | 7.0 s / 8.8 s |

The answer step only phrases retrieved passages, so a larger model or more effort adds no measured accuracy. Higher effort writes longer answers with more claims the citation check has to remove, and takes longer. Override with `ADF_MODEL` / `ADF_EFFORT` in `.env`.

## Known limits
- 42 of 431 rows still have no model list, even after inheriting from other versions in the docket; applicability there is UNKNOWN.
- Serial rules are parsed from the applicability paragraph only. Rules expressed in tables, service bulletins or foreign ADs stay UNKNOWN.
- The dev, held-out and hand-written question sets are small and written by the team; the larger human-written set is in progress (#15).
- Without an aircraft model, vague questions find the right AD 7/10 times on the held-out set; setting the model in the UI is the fix.
- 9 records have neither a Federal Register document nor pasted rule text, so they are searchable by summary only.

Data: the provided FAA AD NPRM spreadsheet and `challenge4_ad_index.xlsx`, plus Federal Register full text fetched by script (US government works, public domain). Code: MIT.
