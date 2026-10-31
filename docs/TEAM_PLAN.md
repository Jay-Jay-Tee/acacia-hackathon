# AD Finder: 4-person team plan (Challenge #4, Airbus track)

## Context
We're going with Challenge #4. A working lightweight build is on `main`, at the repo root:
- `ingest.py`: xlsx + Federal Register full text → SQLite FTS5
- `engine.py`: search, applicability, revisions, refusal gates
- `llm.py`: Claude with native citations, a post-check and an extractive fallback
- `app.py`: FastAPI `/ask`, `/search`, `/ad/{id}`
- `index.html`: a plain UI
- `eval.py` and `questions.jsonl`: 22 questions, all passing
- `tests/`: 11 unit tests passing

We now split into 4 parallel workstreams: **UI, Logic, Testing, Features**. Time is short, so every workstream is tiered **MUST / SHOULD / COULD** and we freeze early. Time discipline is 5% of the score and earlier submission scores higher.

**Known gaps to close** (from the Phase 0 eval):
- only 89 of 431 rows have models, so applicability is mostly UNKNOWN
- the regex parses only simple serial ranges
- the 99% retrieval recall is inflated (synthetic queries)
- there's no hallucination baseline and no timed manual-vs-tool study

---

## How we avoid stepping on each other

### 1. Freeze the API contract first (everyone, first 30 min)
The `/ask` response stays the backbone. Write it down in `docs/API.md`, owned jointly by Logic and UI. Changes go through a PR that both review.
```
POST /ask {query, model?, serial?}
→ {status: answered|refused|needs_clarification, mode: generated|extractive|no_answer|null,
   refusal_reason, note, retrieval_ms, total_ms, disclaimer,
   answer_blocks: [{text, citations: [{docket, ad_number, revision_date, section, fr_citation, page, url, cited_text, ad_id, chunk_id}]}],
   documents: [{ad_id, docket, subject, status, issue_date, make, models, supersedes, fulltext, url,
                revision: {count, is_latest, latest_id, versions[]},
                applicability: {result, trace[], candidates?} | null}]}
```
The only addition right now is `chunk_id` on each citation, which Features needs to jump to the passage. Testing commits sample responses as `fixtures/ask_*.json`, so the UI can be built against fixtures without the backend running.

### 2. File ownership
| Owner | Owns | Must not edit without asking |
|---|---|---|
| **P1 UI** | `frontend/**` (new: Vite + React + TS + Tailwind) | Python files |
| **P2 Logic** | `engine.py`, `llm.py`, `ingest.py`, and new `retrieval/` modules if `engine.py` gets split | `frontend/`, `tests/` (except adding unit tests for own code) |
| **P3 Testing** | `tests/`, `eval.py`, `questions.jsonl`, `fixtures/`, `.github/workflows/`, `docs/EVAL.md` | product code (file issues or PRs to the owner instead) |
| **P4 Features** | `features.py` (a new FastAPI `APIRouter` mounted in `app.py` with one line) and `frontend/src/features/**` | `engine.py` internals (call its public functions) |

`app.py` changes stay tiny: mount the router, and serve `frontend/dist` instead of `index.html`. Whoever needs a change says so in chat first.

### 3. Branches and integration
- Branches: `ui/*`, `logic/*`, `test/*`, `feat/*` → PR into `main`. Rebase on `main` before opening the PR.
- **Every PR must pass** `pytest` and `python eval.py`, without lowering any category score. P3 sets this up as a GitHub Action (no LLM calls, so no key needed in CI).
- **Integration checkpoints:** about 3 h in (merge all MUSTs, run the full eval with `--llm`), and at feature freeze.

---

## P1: UI (sleek, modernist, "chat with grounded documents")
**Goal:** it feels like prompting an AI, but visibly grounded. The design language is "every claim has a receipt".

**MUST**
- Scaffold `frontend/` with Vite, React, TS and Tailwind. In dev, Vite proxies `/ask`, `/ad` and `/search` to `127.0.0.1:8000`. For production, `npm run build` → `frontend/dist`, served by FastAPI at `/`.
- **Chat layout:**
  - a thread of question → answer turns, with an input bar at the bottom
  - an **aircraft profile** chip (model and serial) that sticks across turns and is editable in a popover
  - an empty state with 3 example prompts (the P.68 demo, an ambiguous A320, an off-topic question)
- **Answer bubble:**
  - inline citation chips [1][2] on each sentence; hovering shows the quoted source text and docket/page
  - a clear status design: answered, needs clarification with clickable candidate models that re-ask, and refused with the reason
  - a `mode` pill (generated / extractive)
  - the latency readout
  - the disclaimer
- **Documents rail** (a side panel on desktop, collapsible on mobile): document cards showing status badges (PROPOSED / FINAL / WITHDRAWN), revision badges (latest of N / OUTDATED), the applicability verdict and an expandable evaluation trace.
- **Safety:** no `dangerouslySetInnerHTML`. Render only fields from the contract. Only allow links to `https://www.federalregister.gov/`.
- Light and dark themes, responsive down to phone width.

**SHOULD**
- Loading skeleton plus a "searching 8,918 passages…" micro-state. If P2 ships streaming, handle that too.
- Keyboard shortcuts (Enter sends, ⌘K focuses the input), and a copy button on answers.
- **Each turn is answered independently** (the backend has no chat memory). Label it subtly ("each question is answered from documents only") so nobody expects memory to carry context.

**COULD:** motion polish, a filter bar (status, make) that P4 provides the data for.

**Done when:** all fixture responses render correctly, the live backend works end to end, and the page passes a quick mobile check.

---

## P2: Logic (retrieval, RAG, answers, performance)
**MUST**
1. **Extract models from the applicability text.** This is the biggest gap.
   - In `ingest.py`, parse "Model X, Y, and Z airplanes/helicopters/engines" out of the `(c) Applicability` paragraph and expand suffix lists ("A330-243, -243F" → A330-243, A330-243F).
   - Fill `models` when the spreadsheet column is empty, and record the source (`models_source: sheet|parsed`) so the UI can show it.
   - Target: from 89 rows with models to most of the 197 parsed rows. Measure it.
2. **A stronger serial and applicability parser** in `engine.check_applicability`:
   - lists ("S/N 101, 105, and 110")
   - "and subsequent" / "and higher"
   - MSN prefixes
   - "except" clauses that subtract ranges
   - part-number conditions → UNKNOWN with the reason
   - "as identified in EASA AD …" → UNKNOWN, "delegated to a foreign AD"
   - Every new rule gets a unit test and a trace line.
3. **Small refactor:** add `chunk_id` to citations (contract change, coordinated with UI).

**SHOULD**
- **Hybrid retrieval:**
  - local embeddings (`fastembed` with `BAAI/bge-small-en-v1.5`, no extra API key), stored as a numpy matrix in `data/`
  - BM25 and the embeddings combined with **RRF** (reciprocal rank fusion)
  - kept **only if** P3's human-written paraphrase set shows better recall@5 with p95 still under 3 s
- **Caching:** an LRU cache on (query, model) → retrieval, and an answer cache keyed on (query, model, serial, corpus version), so demo re-runs are instant.
**COULD:** streaming (an SSE endpoint `/ask/stream` that sends the gate result and documents first, then the answer; needs UI to agree), a Haiku reranker on the top 20 (only if eval shows a gain), and query rewriting (abbreviations like "HPT" → "high-pressure turbine").

**Rules:**
- The LLM never decides applicability or legality.
- Every change re-runs `eval.py`, and the PR description includes the before/after numbers.

---

## P3: Testing and evaluation (red team plus the numbers for the pitch)
**MUST**
- **A CI workflow** (`.github/workflows/ci.yml`): `pip install`, `python ingest.py --no-fetch` against the committed `data/fr_cache/`, `pytest`, `python eval.py`. It fails on any category regression.
- **Expand `questions.jsonl` to about 100,** each tagged by category and with an expected docket where relevant:
  - answerable, written as *paraphrases* (not copied from summaries); this replaces the inflated 99% recall
  - out-of-scope, ambiguous, contradicting
  - revision ("what's the latest version of FAA-2026-1338?")
  - withdrawn ("is the X NPRM still active?")
  - multi-document, plus serial edge cases
- **Injection and red-team suite:**
  - direct overrides, system-prompt extraction, role-play and encoded or reworded variants
  - XSS payloads in the query, oversized input
  - **indirect injection:** a test fixture DB with a planted chunk saying "ignore previous instructions…", asserting the answer is still cited and still constrained
- **Hallucination baseline:** 20 questions asked to Claude with *no* retrieval versus our system. Count unsupported claims. This is the headline "before/after" for the Impact and Honest-evaluation criteria.
- **`docs/EVAL.md`:** a metrics table, with synthetic and human-written results labelled separately, and **at least one real failure** explained (cause and fix).

**SHOULD**
- A latency benchmark across the full corpus, plus a ~5× duplicated corpus to show headroom.
- **A timed manual-vs-tool study:** 5 applicability tasks done by hand (FR site plus reading) versus with the tool. Report the measured result honestly (n=5).
- Fixture JSON files for P1 (`fixtures/ask_answered.json`, `ask_refused.json`, `ask_clarify.json`, `ask_extractive.json`).

**COULD:** property-based tests for the serial parser (hypothesis), and a load test.

**P3 also owns the pitch's evaluation slide** and the answer to the judges' question "where does it fail and how would the user know?"

---

## P4: Features (verify, navigate, act)
Everything here reinforces "a qualified person can verify before acting", which the trust and traceability criterion (20%) rewards.

**MUST**
- **Source viewer:**
  - `GET /ad/{ad_id}/text` returns the full text with page markers and section anchors
  - clicking a citation opens a side panel scrolled to the cited passage, with the cited span **highlighted** (match `cited_text` within the chunk via `chunk_id`)
  - "Open on federalregister.gov" link
- **Fleet check (pure code, no LLM):**
  - `POST /fleet` with a list of {model, serial} → a table of every AD/NPRM per aircraft with APPLIES / UNKNOWN / DOES NOT APPLY and the trace
  - CSV paste or upload
  - This is the strongest "real user workflow" for the problem-realism criterion: a CAMO planner screening a fleet.
- **Revision timeline:** a visual timeline per docket (proposed → revised → withdrawn/final), with the current one highlighted. It includes **supersession links**: map `supersedes` AD numbers to dockets in the corpus where possible, otherwise show "not in corpus". A withdrawn latest version reads "withdrawn: no action required".

**SHOULD**
- **"Copy as compliance note":** Markdown or PDF with the question, the answer, citations (docket, revision, section, page, URL), the applicability trace, a timestamp and a "for review by certifying staff" line.
- **Filters:** status, make, product type, date range. Exposed to search as optional params, which needs P2 to add the filter arguments.
- **Generic document upload:** `POST /upload` (PDF via `pypdf`) → page-aware chunks into a separate "uploaded" collection, so the system works beyond ADs. Applicability rules on uploads that can't be parsed come out as UNKNOWN.

**COULD:** bookmarks/watchlist, and a "what changed between revisions" diff of two versions' applicability and actions.

---

## Review fixes (applied to the sections above)
1. **P2 was overloaded.** Streaming moves to COULD. Supersession linking moves to **P4**, since the revision timeline is the thing that consumes it. P2 keeps model extraction, the parser, hybrid retrieval and caching.
2. **P1 and P4 share the frontend**, so P1 publishes the shared pieces by **T+0:30**: `frontend/src/api/types.ts` (the contract as TS types), `frontend/src/api/client.ts`, and an empty `<SidePanel>` slot. After that, P4's components in `frontend/src/features/` plug into the panel without either person editing the other's files.
3. **The index isn't in git** (`data/ads.db` is gitignored). After every pull that touches `ingest.py`, run `python ingest.py --no-fetch` (offline; it uses the committed `data/fr_cache/`, `_resolved.json` and `data/raw/ad_nprm.xlsx`). CI does the same.
4. **API key and cost:** one shared key across four people, each running `eval.py --llm`. Answer caching (P2) comes first so repeated runs are free. Only P3 runs the full `--llm` eval, and only at the checkpoints; everyone else uses the default eval with no LLM.
5. **Demo machine:** one laptop and one owner (P3). From T+5:00 it runs the built `frontend/dist` from `main` with the extractive fallback tested, plus a backup screen recording of the demo script in case of Wi-Fi or API trouble.
6. **One submitter (P3), with a checklist:** repo public with an MIT LICENSE; README covering the problem, user, setup, metrics, failure case and limits; `docs/EVAL.md`; the demo video if the organisers want one; submit right at freeze.

## Timeline (T = start of the team build)
| When | Everyone |
|---|---|
| T+0:00–0:30 | Pull `main`. Freeze `docs/API.md` and add `chunk_id`. P3 commits fixtures and the CI skeleton. P1 scaffolds Vite. |
| T+0:30–3:00 | Build the MUSTs on branches. |
| **T+3:00** | **Integration #1:** merge MUSTs, full `eval.py --llm`, fix breakages together (30 min). |
| T+3:30–5:00 | SHOULDs. P3 runs the baseline and the timed study, and drafts `docs/EVAL.md`. |
| **T+5:00** | **Feature freeze.** Only bug fixes after this. |
| T+5:00–6:00 | README and pitch (problem 30 s → live demo 90 s → eval and failure 45 s → limits 15 s), two rehearsals, **submit**. |

If time runs short, cut SHOULD and COULD and submit at feature freeze. MUSTs alone already cover every rubric line.

## Verification (at each checkpoint)
- `pytest -q` passes, and `python eval.py` shows no category below the previous run, with retrieval p95 under 3 s.
- `python eval.py --llm`: 100% citation coverage, and all injection cases refused or still cited.
- Manual demo script on the integrated build: P.68 S/N 100 (APPLIES, cited) → S/N 200 (refused, trace) → A320 (clarify, click candidate) → a fleet check of 3 aircraft → open a citation in the source viewer → copy the compliance note.
- `npm run build` works, and FastAPI serves `frontend/dist` from `/`.
