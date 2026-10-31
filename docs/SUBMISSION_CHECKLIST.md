# Submission checklist

Status as of 31 Oct 2026, checked against branch `test/p3-checklist`.

| Item | Status |
|---|---|
| Repo public | ✅ The GitHub URL returns 200 without logging in. |
| LICENSE | ✅ MIT. The copyright line names only "Jay-Jay-Tee", so consider adding the team. |
| `docs/EVAL.md`, `API.md`, `TEAM_PLAN.md` | ✅ All three exist. EVAL.md has metrics, the timed study, failure modes and a real failure with its fix. |
| README | ⚠️ The content is mostly there but the headings don't match the checklist. See below. |
| Laptop running `frontend/dist` from main | ❌ Not ready. `frontend/dist` doesn't exist, and `node` and `npm` aren't installed on the machine checked. |
| Extractive fallback tested | ⚠️ The code handles it (`llm.py:103-104`), but it hasn't been confirmed end to end. There's no `.env`, so the key is currently unset. |
| Backup screen recording | ❌ Nothing in the repo. This is a manual step. |
| Submit at freeze | ⚠️ `test/p3-checklist` is five commits ahead of main (injection tests, hallucination baseline, eval metrics, latency benchmark). Those commits are only on the branch, and `origin/main` moves quickly. |

## README gaps

There is no explicit Problem or User section. Metrics are under "Results", failures under "Failures found and fixed", and limits under "Known limits". Add a short "Problem and user" section near the top, and rename or link the headings so a judge can find setup, metrics, failure and limits straight away.

## Next steps

Code and docs:
1. Add the Problem and User section to the README.
2. Run `uvicorn` with the key unset and check that `/ask` returns `mode: extractive`.

Manual:
1. Install Node, run `npm ci && npm run build` on the demo laptop, and check that FastAPI serves `frontend/dist` at `/`.
2. Merge or open a PR for this branch into main.
3. Record the backup demo.
