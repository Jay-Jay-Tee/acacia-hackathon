# Architecture

AirFrame (formerly AD Finder) is a small, single-process FastAPI app with a deterministic core and one optional LLM step. The design rule is simple: **code decides retrieval, applicability, revisions and refusals; the LLM only phrases an answer from retrieved passages.**

## Repository layout

```
app.py              FastAPI app, request/response models, /ask orchestration, static UI
engine.py           Deterministic core: FTS5/embedding search, gate, applicability, revisions, cards
rules.py            Shared text rules: model-list and serial-number parsing, query expansion
llm.py              Claude call, citation post-check, extractive fallback, answer cache
ingest.py           Builds data/ads.db from the source spreadsheet + Federal Register text
features.py         P4 router: /ad/{id}/text source viewer, /fleet fleet check
evaluation/         Eval scripts + hand-written, dev and held-out question sets
data/               Source xlsx, FR text cache, built SQLite DB, optional embeddings, answer cache
frontend/           Vite + React + TypeScript UI; production build goes to frontend/dist
legacy/index.html   Plain-HTML fallback served when frontend/dist is absent
tests/              pytest suite (API, engine, rules, cache, features)
docs/               This documentation
```

The Python modules are imported as flat top-level modules (`import engine`), so they stay at the repo root. Run commands from the repo root.

## Request flow: `POST /ask`

1. **Validate** the body (`app.py`): `query` ≤ 500 chars; optional `model` and `serial` ≤ 40 chars each.
2. **Gate** (`engine.gate`): deterministically decide `ok`, `refused` or `needs_clarification`.
   - Refuses questions about the assistant, instruction-override attempts, requests to skip a mandatory action, and out-of-scope questions.
   - Refuses a premise that contradicts the applicability verdict (e.g. a serial outside the rule).
   - Returns `needs_clarification` plus candidate models when the model name is ambiguous.
3. **Retrieve** (`engine.search`): BM25 over SQLite FTS5, optionally fused with local `bge-small` embeddings. A model pre-filter narrows the candidate documents.
4. **Check applicability** (`engine.check_applicability`) for each retrieved document: `APPLIES`, `DOES_NOT_APPLY`, `UNKNOWN` or `AMBIGUOUS`, with a human-readable trace.
5. **Answer** (`llm.answer`): if a key is configured, Claude phrases at most five sentences using native citations. A post-check drops every sentence without a citation, or whose numbers do not appear in the cited text. If the LLM is unavailable, errors, declines, or cites nothing, fall back to **extractive mode**: verbatim cited passages and no generated prose.
6. **Assemble** (`app.py`): answer blocks, document cards, deterministic NPRM/withdrawn/not-AD notices, latency, disclaimer.

Answers are per-question; there is no chat memory. `data/answer_cache/` caches full answers (bypass with `ADF_NO_CACHE=1`).

## Deterministic core

| Module | Responsibility |
|---|---|
| `rules.py` | Parse model lists from "Model X, Y and Z airplanes"; expand suffix lists; parse serial ranges, lists and "and subsequent"; normalise model/serial strings; expand aviation synonyms in queries. Anything unparseable returns `None`, never a guess. |
| `engine.py` | Search (BM25 + optional embeddings + RRF), relevance gate, docket revisions and withdrawals, model effective across a docket, applicability verdicts and traces, document cards, corpus stats, model candidates. |
| `features.py` | Read-only `/ad/{id}/text` chunks for the source viewer; `/fleet` batch screening. Both call `engine` public functions and never the LLM. |

Serial or configuration conditions that the rules cannot evaluate (tables, service bulletins, foreign-AD delegation, unmatched serial formats) produce **UNKNOWN** with the reason in the trace. Withdrawn latest notices produce **DOES_NOT_APPLY**.

## Data pipeline

`ingest.py`:

1. Read `data/raw/ad_nprm.xlsx` and `data/raw/challenge4_ad_index.xlsx`.
2. Resolve each row to a Federal Register document (cache in `data/fr_cache/`, index in `_resolved.json`). Network fetch is only needed without `--no-fetch`.
3. Split full text into section/page-aware chunks; extract the `(c) Applicability` paragraph; detect final ADs, withdrawals and non-AD rules (e.g. 14 CFR Part 61).
4. Fill `models` from the sheet, else the applicability paragraph, else the summary, recording `models_source`.
5. Write `data/ads.db`:
   - `ads(id, docket, data)`: one JSON record per row.
   - `chunks(id, ad_id, section, page, text)`: searchable passages.
   - `chunks_fts`: FTS5 external-content index over chunk text, subject and models.
6. With `--embed`, write `data/emb.npy` + `data/emb_meta.json` for hybrid retrieval (gitignored, rebuilt when chunk text changes).

Generated data is gitignored: `data/ads.db`, `data/emb.npy`, `data/emb_meta.json`, `data/answer_cache/`. The Federal Register cache and source spreadsheets are committed so `--no-fetch` works offline and in CI.

## API surface

The contract is in [API.md](API.md) and mirrored in `frontend/src/api/types.ts`. In short:

- `POST /ask` — the Q&A contract.
- `GET /search`, `GET /ad/{id}`, `GET /corpus` — retrieval and metadata.
- `GET /ad/{id}/text` — full text chunks for citation highlighting.
- `POST /fleet` — deterministic fleet screening, no LLM.
- `GET /` — `frontend/dist` if built, else `legacy/index.html`.

## Trust boundaries

- Document text and user input are data, never instructions; the system prompt says so.
- The UI renders only contract fields as plain text (no `dangerouslySetInnerHTML`) and allows links only to `https://www.federalregister.gov/`.
- Applicability verdicts come from `engine`, never the LLM.
- Every generated sentence must carry a citation and pass the numeric post-check, or it is dropped; if nothing remains, the request is refused or falls back to extractive mode.

## Where to change what

- Retrieval, gate, applicability, revisions: `engine.py` (rules in `rules.py`).
- Prompting, citation post-check, cache: `llm.py`.
- Ingestion or parsing: `ingest.py` / `rules.py`; rebuild with `python ingest.py --no-fetch`.
- HTTP shapes: `app.py` / `features.py`, then [API.md](API.md) and the TS types together.
- UI: `frontend/src/`.
