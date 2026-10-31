# API contract (frozen v1)

Owned jointly by **P1 (UI)** and **P2 (Logic)**. Any change needs a PR reviewed by both. The frontend renders only these fields.

## `POST /ask`
Request:
```json
{"query": "fuel starvation engine shutdown", "model": "P.68", "serial": "100"}
```
`query` is required (≤ 500 chars). `model` and `serial` are optional (≤ 40 chars each).

Response:
```jsonc
{
  "status": "answered" | "refused" | "needs_clarification",
  "mode": "generated" | "extractive" | "no_answer" | null,   // null when refused before the LLM
  "refusal_reason": "string",            // "" when answered
  "note": "string",                      // e.g. "1 uncited sentence(s) removed."
  "retrieval_ms": 6.1,
  "total_ms": 4352.2,
  "disclaimer": "Decision support only. ...",
  "answer_blocks": [
    {
      "text": "string",                  // one cited claim
      "citations": [
        {
          "docket": "FAA-2026-11794",
          "ad_number": "",               // "" for NPRMs
          "revision_date": "2026-10-09",
          "section": "(c) Applicability",
          "fr_citation": "Federal Register, Volume 91 ...",
          "page": 61797,
          "url": "https://www.federalregister.gov/d/2026-xxxxx",
          "cited_text": "exact quoted source text",
          "ad_id": 12,
          "chunk_id": 345                // v1 addition (P2): lets P4 jump to the passage
        }
      ]
    }
  ],
  "documents": [
    {
      "ad_id": 12, "docket": "FAA-2026-11794", "subject": "string",
      "status": "proposed" | "final" | "withdrawn",
      "issue_date": "2026-10-09", "make": "string", "models": ["P.68", "P.68B"],
      "models_source": "sheet" | "applicability" | "summary" | null,   // v1.1 (P2): where the model list came from
      "supersedes": ["2021-12-10"], "fulltext": true,
      "url": "https://www.federalregister.gov/d/...",
      "citation": "string", "ad_number": "",
      "revision": {
        "count": 2, "is_latest": true, "latest_id": 12,
        "versions": [{"id": 12, "issue_date": "...", "status": "...", "citation": "...", "url": "..."}]
      },
      "applicability": {
        "result": "APPLIES" | "DOES_NOT_APPLY" | "UNKNOWN" | "AMBIGUOUS",
        "trace": ["Model P.68 is listed: ...", "Rule: serial 1 to 182. S/N 100 is in range."],
        "candidates": ["A320-211", "..."]   // only when AMBIGUOUS
      } | null
    }
  ]
}
```

## Other endpoints
| Endpoint | Owner | Status |
|---|---|---|
| `GET /search?q=&model=` | P2 | exists |
| `GET /ad/{ad_id}` | P2 | exists (card plus summary and applicability_text) |
| `GET /ad/{ad_id}/text` | P4 | planned: full text with page markers and section anchors |
| `POST /fleet` | P4 | planned: `[{model, serial}]` → per-aircraft applicability table |
| `POST /upload` | P4 | planned (SHOULD): generic PDF ingest |

## Rules
- Links rendered by the UI must start with `https://www.federalregister.gov/`.
- No `dangerouslySetInnerHTML`; all text is rendered as plain text.
- Applicability verdicts come from code, never from the LLM.
