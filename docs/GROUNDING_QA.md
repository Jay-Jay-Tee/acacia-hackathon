# Grounding failures: judge Q&A prep (Challenge #4)

Likely judge questions about when and how grounding fails, and how AD Finder handles each case. The answers come from the code ([engine.py](../engine.py), [llm.py](../llm.py), [rules.py](../rules.py)) and [EVAL.md](EVAL.md). Questions are grouped by the rubric criterion they test.

The last section lists two weak spots found by testing the code directly. They are not yet in EVAL.md.

---

## Trust and traceability (20%)

### Q1. How do you stop Claude from answering from its own memory?

There are three layers, and none of them depends on Claude behaving well:

1. **Before any LLM call**, the relevance gate ([engine.py:369](../engine.py#L369)) refuses unless a top passage contains enough of the query's words (60% coverage, or every word for short queries) or has embedding similarity ≥ 0.70. Off-topic questions never reach Claude.
2. **During the call**, Claude only sees the retrieved passages, as documents with citations turned on. The system prompt says to use only those documents and to reply "The provided documents do not answer this" otherwise ([llm.py:13](../llm.py#L13)).
3. **After the call**, code deletes any sentence that has no citation. It also deletes any sentence with a number, part number or serial that doesn't appear in its cited text ([llm.py:126-136](../llm.py#L126-L136)). If nothing survives, the question is refused ([llm.py:141](../llm.py#L141)).

### Q2. What does "every claim is cited" mean in practice?

Each answer block carries its record_id, docket, Federal Register citation and page, section, revision date and the verbatim quote ([llm.py:51](../llm.py#L51)). Coverage was 100% in the last `--llm` run. The user can hover or open the source viewer to read the exact passage.

### Q3. What if Claude cites a real passage but misreads it?

The post-check only catches mismatched numbers and identifiers. A wrong verb or condition ("replace" when the source says "inspect", or "before" when it says "after") gets through. The mitigation is that the quote sits next to every sentence, so the certifying engineer checks the claim against the text. That's why every answer is labelled "decision support only".

### Q4. Who decides applicability: the LLM or code?

Code, in [rules.py](../rules.py) and `check_applicability`. The verdict is APPLIES, DOES_NOT_APPLY, UNKNOWN or AMBIGUOUS, with an evaluation trace. Claude never decides legality, which matches the rubric's LLM / non-LLM split.

---

## Honest evaluation (20%): where does it fail, and how would the user know?

### Q5. When does grounding fail most often?

Mostly by refusing a question it could answer, not by answering wrongly. The gate wrongly refuses **11 of 39 answerable human-written questions**, mostly symptom-style wording such as "stick shaker firing for no reason". The user sees an explicit refusal, never a wrong answer. The risk is that they conclude no AD exists. The workaround today is to set the aircraft model or search by docket or AD number.

### Q6. Does anything off-topic get through?

Yes, **4 of 12** aviation-adjacent questions: an EASA AD, a pilot licence, how a turbofan works, and a translation request. They pass because aviation words raise word coverage. The user sees *extractive* passages with a mode pill and quotes, so it's visible that the passages don't address the question. No made-up claim is shown.

### Q7. What happens when the parser can't read applicability?

It returns UNKNOWN, with a trace line giving the reason. That covers 54 of 206 synthetic cases: serials in tables or service bulletins, part or modification conditions, and "as identified in EASA AD…". It never guesses (README assumption 5).

### Q8. What if the user's model is ambiguous, like "A320"?

The system returns `needs_clarification` with candidate models to click: 8/8 on the human-written set. It gives no verdict until the user picks one.

### Q9. What if the question asks to skip or defer an AD?

The non-compliance gate refuses and points to the AMOC paragraph. It **misses "postpone" and "not do"** (6/8 on the human-written set), and "delay" also gets through. See weak spot B below.

### Q10. What if the source data itself is wrong?

Two cases are handled:

- NPRM-314's summary describes a different rule. It isn't indexed and the card carries a `data_warning`.
- 169 index links point to a different notice in the same docket. Citations are keyed on the cited page instead, which matches for 382 of 389 rows.

This is a strong answer to "where does it fail?", because the failure is in the input data, not the model, and the user is told.

### Q11. What if Claude is down, refuses, or there's no API key?

The system falls back to extractive mode: verbatim passages, no generated prose, clearly labelled ([llm.py:103-106](../llm.py#L103-L106)). If Claude says the documents don't answer, the question is **refused** rather than shown as passages labelled "Answer". That was a real bug, since fixed (the "system prompt" / "prom**pt**ed" case).

**Open item:** [SUBMISSION_CHECKLIST.md](SUBMISSION_CHECKLIST.md) says this fallback hasn't been run end to end yet. Run it before the demo.

### Q12. Can a document inject instructions?

The prompt treats document text and the question as data, and `META_RE` refuses questions about the assistant (5/5, plus `tests/test_injection.py`). Uploaded PDFs never reach the LLM at all: answers over them are extractive only ([uploads.py:6](../uploads.py#L6)).

### Q13. Can a cached answer go stale?

No. The cache key hashes the model, effort, system prompt, query and every passage's id and text ([llm.py:75](../llm.py#L75)), so a re-ingest or a prompt change misses the cache.

### Q14. Have you shown that grounding actually reduces hallucination?

Not yet. `evaluation/baseline.py` is committed, but the baseline (Claude with no documents vs `/ask`) **hasn't been run**. Say so plainly. Don't claim "zero hallucination"; say "every surviving sentence has a verified quote".

---

## Impact and problem realism

### Q15. Is refusing too often a safety risk?

Over-refusal costs the B1 technician time, not safety: they fall back to searching federalregister.gov by hand, which is today's process. A confident wrong "does not apply" is the dangerous error, and the design steers away from it.

---

## Weak spots found by testing (not yet in EVAL.md)

### A. The number check matches substrings, so it can pass a wrong number

`_supported` checks `tok in flat` ([llm.py:68-71](../llm.py#L68-L71)). Both of these pass the check:

| Claim | Source | Result |
|---|---|---|
| "Inspect within **50** flight hours" | "within **500** flight hours" | passes |
| "S/N **1050**" | "S/N **10500** through 10600" | passes |

The cited text also includes the document title (dates, page numbers, docket), so a number that happens to appear there passes too.

**Fix:** match whole tokens with `\b` boundaries, and check against `cited_text` only, not the title.

### B. The non-compliance gate refuses some legitimate questions and misses some it should catch

| Question | Result | Expected |
|---|---|---|
| "What inspection is proposed to **avoid** fuel tank ignition?" | refused | answered |
| "Can I **postpone** the inspection?" | not caught | refused |
| "Is it OK to **delay** the inspection?" | not caught | refused |
| "Can I **not do** the AD?" | not caught | refused |

The false refusal comes from `avoid` in `NONCOMPLY_RE` ([engine.py:26](../engine.py#L26)). The word appears in only 5 of 405 cached documents, but users phrase safety questions this way.

**Fix:** remove `avoid`, or only match it near "AD", "inspection" or "compliance". Add `postpone`, `delay` and `not (do|perform)`.

**Status:** neither A nor B is fixed yet. Once fixed and covered by regression tests, both can go under "Failures found and fixed" in the root README.
