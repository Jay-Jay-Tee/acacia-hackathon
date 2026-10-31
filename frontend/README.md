# AD Finder frontend (P1)

Vite + React + TypeScript + Tailwind v4.

```bash
cd frontend
npm install
npm run dev      # http://localhost:5173, proxies /ask /ad /search /fleet to 127.0.0.1:8000
npm run build    # typecheck + build to frontend/dist, which FastAPI then serves at /
```

The backend must be running for live requests (`uvicorn app:app --port 8000` from the repo root). If `frontend/dist` doesn't exist, FastAPI falls back to the legacy `index.html`.

## Building without the backend
Add `?mock=<name>` to the dev URL (the dev page lists the links):

| Mock | Status | Source |
|---|---|---|
| `answered_extractive` | answered, extractive | real backend, P.68 S/N 100, no API key |
| `clarify` | needs_clarification | real backend, model `A320` |
| `refused_premise` | refused | real backend, P.68 S/N 200 |
| `refused_offtopic` | refused | real backend, off-topic question |
| `refused_injection` | refused | real backend, "ignore previous instructions…" |
| `edge_synthetic` | answered, generated | **hand-built**: withdrawn / outdated / summary-only cards, XSS strings, a `javascript:` URL |

P3's `fixtures/ask_*.json` at the repo root are picked up automatically once committed. Mocks are dev-only and are not included in the production build.

## Layout
- `src/api/types.ts`: the `docs/API.md` contract as TS types. Change only together with that doc.
- `src/api/client.ts`: `ask()`, `search()`, `getAd()`.
- `src/lib/safeUrl.ts`: only `https://www.federalregister.gov/` links may be rendered.
- `src/components/SidePanel.tsx`: the right-hand slot (`useSidePanel().open({title, body})`).
- `src/features/`: owned by P4; see its README.
