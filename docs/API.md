# API contract (v1.3)

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
  "candidates": ["A320-211", "A320-214"],  // v1.1 (P2): exact models to choose from when status is needs_clarification, else []
  "notices": ["Cited documents include proposed rules (NPRMs). ..."],  // v1.2 (P2): show prominently when non-empty
  "answer_blocks": [
    {
      "text": "string",                  // one cited claim
      "citations": [
        {
          "record_id": "NPRM-019",       // v1.2: official citation key from challenge4_ad_index.xlsx
          "docket": "FAA-2026-11794",
          "ad_number": "",               // "" for NPRMs
          "status": "proposed" | "final" | "withdrawn" | "not_ad",   // v1.2; not_ad added v1.3
          "revision_date": "2026-10-09", // FR publish date of this version
          "section": "(c) Applicability",
          "fr_citation": "Federal Register, Volume 91 ...",
          "pages": "61796-61799",        // v1.2: page range of the whole notice
          "page": 61797,                 // page of the cited passage
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
      "ad_id": 12, "record_id": "NPRM-019", "docket": "FAA-2026-11794", "subject": "string",
      "status": "proposed" | "final" | "withdrawn" | "not_ad",   // not_ad (v1.3): a non-AD rule in the sheet, e.g. 14 CFR Part 61
      "data_warning": "string" | null,   // v1.3: a known problem with the source data for this record; show it
      "status_label": "Proposed rule (NPRM), not in effect",   // v1.2: display text for the status
      "issue_date": "2026-10-05", "publish_date": "2026-10-09", "pages": "61796-61799",
      "make": "string", "models": ["P.68", "P.68B"],
      "models_source": "sheet" | "applicability" | "summary" | null,   // v1.1 (P2): where the model list came from
      "supersedes": ["2021-12-10"], "fulltext": true,
      "url": "https://www.federalregister.gov/d/...",
      "citation": "string", "ad_number": "",
      "revision": {
        "count": 2, "is_latest": true, "latest_id": 12,
        // newest first; the current version is the one with the latest publish date
        "versions": [{"id": 12, "record_id": "NPRM-019", "publish_date": "...", "issue_date": "...",
                      "status": "...", "citation": "...", "url": "..."}]
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
| `GET /corpus` | P2 | exists: corpus size to display (records, full-text records, FR pages, passages, status counts) |
| `GET /ad/{ad_id}/text` | P4 | exists: `{ad_id, record_id, docket, subject, status, status_label, pages, citation, url, chunks: [{chunk_id, section, page, anchor, text}], anchors: [{section, page, chunk_id, anchor}]}`. `page` is where the chunk starts; draw a page marker when it changes. Extractive `cited_text` is cut at 600 chars plus `...`, so match on the prefix. |
| `POST /note` | P4 | exists: body `{query, model?, serial?, status, mode?, refusal_reason?, answer_blocks: [{text, citations: [{ad_id, chunk_id, cited_text}]}]}` → `{markdown, filename, generated_at}`. Builds the compliance note: question, answer, every citation (docket, revision, section, page, URL, quote with a source check), applicability trace, UTC timestamp and "For review by certifying staff: decision support only." Document details, verdicts and source checks are recomputed server-side from `ad_id`/`chunk_id`, so only the question and answer text come from the client. Unknown `ad_id` returns 422. |
| `POST /upload` | P4 | exists: multipart `file` (PDF, ≤ 20 MB, ≤ 300 pages, ≤ 50 documents) → `{doc_id, record_id: "UPLOAD-001", filename, pages, chunks, sections[], collection: "uploaded", uploaded_at, applicability: {result: "UNKNOWN", trace[]}, warnings[], duplicate}`. Text is split by page, then by heading (numbered, `CHAPTER/SECTION/PART/APPENDIX`, ALL CAPS, and common titles such as Applicability or Findings); running headers and footers are dropped. Only extracted text is stored, in a separate `data/uploads.db`; the corpus is untouched. Identical bytes return the existing document (`duplicate: true`). Errors: 415 not a PDF, 422 unreadable, encrypted or no extractable text, 413 too large, 409 limit reached. Page numbers are PDF pages (1-based). Applicability is always UNKNOWN. |
| `GET /uploads` | P4 | exists: `{docs: [summary]}`, newest first |
| `GET /upload/{doc_id}/text` | P4 | exists: same shape as `GET /ad/{ad_id}/text` (`ad_id` is -1, `url` is `""`) |
| `DELETE /upload/{doc_id}` | P4 | exists: removes the document and its indexed text |
| `POST /upload/{doc_id}/ask` | P4 | exists: body `{query}` → the `/ask` shape with `mode: "extractive"` (no LLM, so an uploaded document cannot inject instructions): `answer_blocks[].citations[]` carry `source: "upload"`, `doc_id`, `record_id`, `section`, `page`, `cited_text` (an exact slice of the passage), `chunk_id`, `status: "uploaded"`, `url: ""`. Refused with a reason when the document has no answer (same word-coverage gate as the corpus). `notices` always warns that the source is not official. |
| `GET /diff?new_id=&old_id=` | P4 | exists: what changed between two notices' **Applicability** and **Required actions** text. Without `old_id`, `new_id` is compared with the previous notice in its docket (`{comparable: false, reason}` for the earliest). Otherwise `{comparable: true, same_docket, old, new, models: {added, removed, unchanged}, sections: [{key, name, available_old, available_new, changed: true \| false \| null, ops: [{op: "equal" \| "replace" \| "delete" \| "insert", old, new, inline?: [{op, old, new}]}], note}], summary}`. `ops` are sentences; joining every `old` side gives the old text and every `new` side the new text. `inline` is a word-level diff on `replace`. `changed: null` means a notice has no text for that section in the dataset (for example a withdrawal): show "cannot be compared", never "removed". 404 unknown id, 422 `old_id == new_id`. |
| `POST /watchlist/status` | P4 | exists: body `[{docket, seen_record_id?}]` (≤ 100) → `{items: [{docket, found: false, note} \| {docket, found: true, subject, make, models, count, current, headline, new_notices, seen_known, seen_ad_id, changed}]}`. The watchlist itself lives in the browser (localStorage); the server only reports. `seen_record_id` is the notice the user last reviewed; `new_notices` counts notices newer than it. `changed` is also true when that notice is no longer in the corpus (`seen_known: false`), so a change is never hidden. |
| `GET /ad/{ad_id}/timeline` | P4 | exists: every notice in the document's docket, oldest first. `{docket, requested_ad_id, current_id, count, headline, events: [{ad_id, record_id, kind: "proposed" \| "revised" \| "withdrawn" \| "final", label, status, status_label, publish_date, issue_date, pages, citation, url, ad_number, is_current, supersedes: [{ad_number, in_corpus, ad_id?, record_id?, docket?}]}]}`. `is_current` is the latest publish date. `headline` reads "Withdrawn: no action required." when the latest notice is a withdrawal. A superseded AD number maps to a corpus document when one carries it, else `in_corpus: false` (show "not in corpus"). |
| `POST /fleet` | P4 | exists: body `[{model, serial?}]` (≤ 500, fields ≤ 40 chars) → `{aircraft: [{model, serial, status: "ok" \| "invalid" \| "model_not_in_corpus", note, candidates, counts, results: [{ad_id, record_id, docket, ad_number, subject, status, status_label, publish_date, url, is_latest, revision_count, applicability: {result, trace, candidates?}}]}], totals_latest, disclaimer}`. Results per aircraft are sorted APPLIES, AMBIGUOUS, UNKNOWN, DOES_NOT_APPLY; superseded revisions are included with `is_latest: false`. A model absent from the corpus is flagged, never silently empty. |
| `POST /upload` | P4 | planned (SHOULD): generic PDF ingest |

## Rules
- Links rendered by the UI must start with `https://www.federalregister.gov/`.
- No `dangerouslySetInnerHTML`; all text is rendered as plain text.
- Applicability verdicts come from code, never from the LLM.
- Cite as `record_id` + FR citation + page range + section (organisers' required format, 31 Oct update).
