# Documentation index

Start here. The root [README](../README.md) covers the problem, setup and headline results; the pages below go deeper.

| Document | What it is | Audience |
|---|---|---|
| [../README.md](../README.md) | Project overview, quickstart, corpus, assumptions, results, limits | Everyone |
| [API.md](API.md) | Frozen HTTP contract (`/ask`, `/search`, `/ad`, `/corpus`, `/fleet`, `/ad/{id}/text`), v1.3 | Backend and frontend |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Modules, data pipeline, retrieval/answer flow, deterministic-vs-LLM boundary | Contributors |
| [EVAL.md](EVAL.md) | How each metric is measured, which sets are synthetic, how to reproduce | Judges and contributors |
| [TEAM_PLAN.md](TEAM_PLAN.md) | Historical 4-person split and workstream plan | Team, for context |
| [PLAN.md](PLAN.md) | Pre-build research note: dataset audit and original scoping | Team, for context |
| [../evaluation/README.md](../evaluation/README.md) | Eval scripts and the question sets they read | Contributors |
| [../frontend/README.md](../frontend/README.md) | Frontend setup, mocks and layout | UI contributors |
| [../frontend/src/features/README.md](../frontend/src/features/README.md) | How P4 features plug into the shell | Feature contributors |

## Status of each document

- **Current:** root README, API.md, ARCHITECTURE.md, EVAL.md, evaluation/README.md, the two frontend READMEs.
- **Historical:** TEAM_PLAN.md and PLAN.md are kept as a record of how the build was planned. Their file paths and numbers may lag the code; trust the current docs and `git log` instead.

## Keeping docs in sync

| If you change... | Update... |
|---|---|
| A request/response field or limit | `docs/API.md` **and** `frontend/src/api/types.ts` together |
| A module, pipeline stage or data file | `docs/ARCHITECTURE.md` (and the layout tree in the root README if paths move) |
| An eval script, question set or headline number | `docs/EVAL.md` and the results table in the root README |
| Setup commands | The root README, and any command in `docs/` that would now fail |

Command convention: run Python from the repo root. Eval scripts live in `evaluation/` and add the repo root to `sys.path` themselves, e.g. `python evaluation/eval.py`.
