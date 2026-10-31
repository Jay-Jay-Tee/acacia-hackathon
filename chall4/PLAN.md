# Acacia Hackathon — Challenge #4 Plan Review & Build Spec

**Repo:** `Jay-Jay-Tee/acacia-hackathon` (branch `chall4`, currently empty apart from README)
**Event:** Autonomous SG 2026 — Acacia Hackathon Society × NUS Product Club, 31 Oct 2026
**Track:** AI & Aerospace (Airbus problem statements)

---

## 1. What is actually in the Downloads folder

| Item | Present? | Notes |
|---|---|---|
| Airbus track problem statements (5 challenges) + rubric | Yes | `Autonomous SG 2026_Airbus Track.pdf` (8 pp) |
| NUS Hackers problem statement + rubric | Yes | `Autonomous SG 2026_NUS Hackers.pdf` (3 pp) |
| Challenge #1 data (Collision Avoidance) | **No** | Only a Drive link in the PDF |
| Challenge #2 data (US DOT 2015 delays) | **No** | Only a Drive link in the PDF |
| Challenge #3 data (Kalimantan SAF) | **No** | Only a Drive link in the PDF |
| Challenge #4 data (FAA Airworthiness Directives) | **Yes** | `432 Entries of FFA Airworthiness Directive ... .zip` |
| Challenge #5 data (ATL/DFW weather + flights) | **No** | Only a Drive link in the PDF |

So the only challenge we can build today without another download is **#4** — consistent with the
`chall4` branch. If a different challenge is intended, its dataset must be pulled from the Drive
folder first.

---

## 2. Data audit — the plan's biggest risk

The xlsx contains **431 usable rows** (not 432; one blank/trailing row), 22 columns. It is a
**metadata index of AD NPRMs, not the multi-page AD documents** the problem statement describes.

| Column | Coverage | Consequence |
|---|---|---|
| Docket Number | 431/431 (323 unique) | Good join key; duplicates = related/revision families |
| Subject Heading | 431/431 (216 unique) | Good for topic routing |
| Status | 431/431 — **all "Current"** | **Revision logic cannot be derived from Status** |
| CFR Part Reference | 431/431 (2 values) | Weak filter |
| Issue Date | 431/431 (2001–2026) | Usable |
| AD Number | **21/431** | Cannot key answers on AD number reliably |
| Make | 428/431 (92 unique) | Core applicability filter |
| Model | **86/431** (66 unique) | **Configuration filtering is mostly impossible from this file** |
| Product Type / Subtype | 428 / 370 | Usable coarse filter |
| AC / AIR Policy / Additional Reference | **0/431** | Empty columns — do not promise them |
| Comment link | 406 (174 are direct federalregister.gov doc links, 3 regulations.gov) | Full-text fetch is possible but not turnkey |
| Citation + Page Number | 431/431 | Good citation metadata (FR volume/issue/page) |
| Summary | 430/431, median 753 chars, max 1,947 | The only body text available |
| Comments | 5/431 | Noise |

Other findings:

- 100/431 summaries explicitly mention **superseding** an earlier AD — a usable revision graph,
  but only if we parse it; `Status` is not enough.
- 19/431 summaries mention serial numbers / configurations. The PS example
  ("Directive A applies to serial numbers S-1000 to S-1500") is largely **not present** in this
  dataset. It would require fetching the full AD text.
- PS asks for "1000+ pages" and sub-3s retrieval. The supplied corpus is ~431 × 0.8 KB ≈ **340 KB
  of text**, nowhere near 1000 pages. We either (a) fetch full Federal Register documents to grow
  the corpus, or (b) state honestly that retrieval is over the provided index.

**Implication for judging:** the "Trust and traceability" (20%) and "Honest evaluation" (20%)
criteria reward exactly this kind of explicit handling. Do not hand-wave it — make the corpus
boundary a visible product feature ("index covers 431 NPRMs; full text for N of them").

---

## 3. Why Challenge #4 is the right pick

- **Rubric fit:** 60% of the Airbus rubric is technical soundness + trust/traceability + honest
  evaluation. A citation-backed retrieval system with deterministic applicability checks and a
  refusal path hits all three directly. It is the challenge where non-LLM logic is the star, which
  the rubric explicitly rewards ("use solvers, rules and statistics for compliance logic").
- **Data is real, small, and self-contained** — no training, no API keys required for the core demo.
- **Demoable in 3 minutes** with a clear before/after (keyword search vs. cited, filtered, refusing
  assistant).
- Risks are manageable: the main one is corpus depth, not modelling.

---

## 4. Proposed architecture

```
                 ┌─────────────────────────────────────────────┐
 User query ───▶ │ 1. Query understanding (LLM, constrained)   │
 (NL + profile)  │    → intent, entities, filters, ambiguity  │
                 └───────────────┬─────────────────────────────┘
                                 ▼
                 ┌─────────────────────────────────────────────┐
                 │ 2. Deterministic pre-filter (SQL)           │
                 │    make / model / product type / date /     │
                 │    status / revision family                 │
                 └───────────────┬─────────────────────────────┘
                                 ▼
                 ┌─────────────────────────────────────────────┐
                 │ 3. Hybrid retrieval                         │
                 │    SQLite FTS5 (BM25) + embeddings + RRF    │
                 └───────────────┬─────────────────────────────┘
                                 ▼
                 ┌─────────────────────────────────────────────┐
                 │ 4. Applicability engine (rules, no LLM)     │
                 │    applies / does-not-apply / unknown       │
                 └───────────────┬─────────────────────────────┘
                                 ▼
                 ┌─────────────────────────────────────────────┐
                 │ 5. Answer composer + verifier               │
                 │    extractive, one citation per claim       │
                 │    refusal gate if unsupported/ambiguous    │
                 └───────────────┬─────────────────────────────┘
                                 ▼
                 ┌─────────────────────────────────────────────┐
                 │ 6. UI: results, filters, citation drawer,   │
                 │    revision badge, refusal state, latency   │
                 └─────────────────────────────────────────────┘
```

**Stack (boring on purpose):** Python + FastAPI, SQLite (FTS5) + `sqlite-vec` or FAISS for
embeddings, a small local/cheap embedding model, React or plain server-rendered UI. Ingestion is a
repeatable script, not a notebook. No agent framework needed.

**LLM / non-LLM split (explicit, judges will ask):**

| Job | Method |
|---|---|
| Parse query, detect make/model/serial/date, flag ambiguity | LLM, JSON-schema constrained, or regex fallback |
| Metadata filtering | SQL — deterministic |
| Applicability (make/model/serial/date windows) | Rules/DSL — deterministic |
| Retrieval ranking | BM25 + vector cosine, RRF — statistics |
| Answer text | Extractive spans from retrieved text, optional LLM rewrite constrained to spans |
| Citation verification | String/offset check against source — deterministic |
| Refusal | Threshold + constraint-conflict check — deterministic |
| Revision "latest" | Supersede graph parsed from summaries/FR text — deterministic |

**Hard rule:** the LLM never decides applicability, never computes dates, never invents an AD
number, and never emits a sentence without a span that passes the verifier.

---

## 5. Data pipeline

1. Extract xlsx → `data/ad_index.parquet` (one row per docket; keep duplicates as a family).
2. Normalise: split pipe-delimited `Model`, parse dates, derive FR document URL from the comment
   link where present; otherwise search FR API by docket number.
3. Fetch full text for as many dockets as possible (FR API / public AD PDFs), cache locally with
   provenance; record which rows have full text vs summary-only.
4. Chunk full text by section (Applicability, Required Actions, Compliance, Effective Date,
   Supersedes). Summary-only rows get a single chunk labelled `summary`.
5. Extract structured applicability: make, model, serial ranges, part numbers, effective/compliance
   dates. Store as rules with source offsets.
6. Build supersede/revision edges (`supersedes`, `superseded_by`) from parsed text; compute
   `is_latest` and a revision chain.
7. Index into FTS5 + vector store; persist `doc_id, section, page, revision, url, fetched_at`.

**Fallback:** if fetching fails, ship the summary-only index and surface coverage in the UI/README.
Do not silently pretend the corpus is complete.

---

## 6. Trust & refusal design (the scoring core)

- Every result card shows: AD/docket, make/model, issue date, revision badge, FR citation
  (volume/issue/page), and the exact supporting snippet.
- Answer sentences are assembled from retrieved spans with inline `[n]` markers; clicking opens the
  source section and offset.
- **Refusal triggers:**
  - top rerank score below threshold;
  - query names a make/model absent from the index;
  - query asks for a serial range the source does not contain (return "unknown, source does not
    specify" rather than guessing);
  - conflicting constraints (e.g., model/date mismatch);
  - out-of-scope (non-AD) questions.
- Refusal message is structured: `status: insufficient_evidence`, what was searched, why it failed,
  what would help.
- Show a **confidence/limitations panel** per answer: corpus coverage, retrieval scores, whether
  full text or summary-only.

---

## 7. Evaluation protocol

Build a small gold set from the corpus (40–60 items):

- 20 direct lookups ("Which AD applies to Boeing 737-800?").
- 10 filter/composition questions (make + model + date).
- 10 revision questions (supersedes / latest).
- 10 adversarial: wrong make, non-existent serial range, ambiguous model, out-of-scope, conflicting
  dates, typo.

Metrics:

- Retrieval Recall@5 and MRR vs. a keyword baseline (SQLite `LIKE`/BM25 only).
- Citation correctness: % of answer sentences whose cited span supports the claim (manual/LLM-assisted
  audit on the gold set).
- Refusal precision/recall on the adversarial set.
- End-to-end p50/p95 latency (target < 3s).
- Coverage: % of corpus with full text vs summary.

Report at least one **visible failure** (e.g., summary-only row cannot answer serial applicability)
and the mitigation. This is explicitly worth marks.

---

## 8. 3-minute demo script

1. **0:00–0:20** — Named user: a B1 licensed engineer / continuing-airworthiness engineer at an
   MRO. Today: keyword-search FAA site, read PDFs, manually check applicability, risk of applying the
   wrong AD.
2. **0:20–0:50** — Ask: "Does any AD apply to an Airbus A330-941, and what action is required?"
   Show citation drawer + revision badge.
3. **0:50–1:20** — Filter by make/model/date; show deterministic applicability result with reason.
4. **1:20–1:50** — Ask something the data cannot answer ("serial number S-1234"). Show structured
   refusal, not a guess.
5. **1:50–2:20** — Show evaluation numbers vs keyword baseline; state coverage limits.
6. **2:20–2:50** — Architecture slide: LLM vs rules/solver split; why the LLM never does arithmetic
   or legality.
7. **2:50–3:00** — Open-source repo + license + one-line ask.

---

## 9. Rubric mapping (Airbus track)

| Criterion | Weight | How we score |
|---|---|---|
| Problem realism | 20% | Named user, current manual workflow, wrong-AD risk, time cost |
| Technical soundness | 25% | Working end-to-end, deterministic applicability, hybrid retrieval, explicit LLM/non-LLM split |
| Honest evaluation | 20% | Gold set, baseline, metrics, visible failure, corpus coverage |
| Trust & traceability | 20% | Per-claim citations, revision badge, structured refusal, human decides |
| Impact | 10% | Minutes→seconds per lookup; false-applicability reduction; adoption path |
| Time discipline | 5% | Submit early; 3-min script rehearsed |

---

## 10. Build order (time-boxed)

1. **Hour 0–1:** ingest + normalise + FTS5; CLI search that returns cited rows.
2. **Hour 1–3:** applicability rules + filters; refusal gate.
3. **Hour 3–5:** hybrid retrieval + embeddings; answer composer + verifier.
4. **Hour 5–7:** UI (search, filters, citation drawer, refusal state, latency, coverage).
5. **Hour 7–8:** gold set + metrics + baseline; record failure cases.
6. **Hour 8–9:** README (setup, license, limits), demo script, rehearsal, submit.

If full-text fetch is not ready by hour 2, proceed summary-only and treat full text as a stretch
goal. Do not let ingestion block the demo.

---

## 11. Open questions / decisions needed

1. Confirm **Challenge #4** is the target (branch + dataset suggest yes; other datasets are absent).
2. Do we fetch full Federal Register text, or ship summary-only and document the boundary?
3. Stack preference: FastAPI + React, or a single-file Python/Streamlit demo for speed?
4. Team size / time remaining — affects whether we attempt the revision graph and full-text fetch.
5. Public repo + OSI license (MIT/Apache-2.0) required for the open-source criterion; confirm the
   repo will be public at submission.

---

## 12. Bottom line

The plan is viable and well-matched to the rubric, **but the provided dataset does not support two
of the five stated requirements as written** (revision logic and fine-grained configuration/serial
filtering). The winning move is to build the citation-first, deterministic-applicability core,
fetch full text where possible, and make the coverage boundary loudly visible. That turns the data
gap from a weakness into evidence for the "honest evaluation" and "trust" criteria.
