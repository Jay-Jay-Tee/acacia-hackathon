"""Deterministic core: retrieval, applicability, revisions, refusal gates. No LLM in this file."""
import json
import re
import sqlite3
import time
from functools import lru_cache
from pathlib import Path

import rules

DB = Path(__file__).parent / "data/ads.db"
MAX_QUERY = 500

STOPWORDS = set("""a an and are as at be by can do does for from has have how i if in is it its me my of on or
our should that the their them there these this to was what when where which who why will with would you your
any all about tell show give list please need know get applies apply ad ads airworthiness directive directives
aircraft faa""".split())
TOKEN_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9\-/.]*[A-Za-z0-9]|[A-Za-z0-9]")
# Questions about the assistant itself, or attempts to override its rules, are out of scope.
META_RE = re.compile(r"system prompt|your (instructions|rules|prompt)|ignore (all |any |the |your )?(previous|prior|above)"
                     r"|disregard|jailbreak|pretend (to be|you)|you are now|act as|<\s*/?\s*(script|question)", re.I)
NONCOMPLY_RE = re.compile(r"\b(skip|avoid|ignore|bypass|defer|waive|get around|not comply|without (doing|complying))\b", re.I)


@lru_cache(maxsize=1)
def _con():
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, check_same_thread=False)
    con.row_factory = sqlite3.Row
    return con


@lru_cache(maxsize=1)
def all_ads():
    return {r["id"]: json.loads(r["data"]) for r in _con().execute("SELECT id, data FROM ads")}


norm_model = rules.norm_model


def content_tokens(q):
    return [t for t in TOKEN_RE.findall(q.lower()) if t not in STOPWORDS and len(t) > 1]


def _has_word(token, text):
    """Whole-word match ('prompt' must not match 'prompted')."""
    return re.search(r"(?<![a-z0-9])" + re.escape(token) + r"(?![a-z0-9])", text) is not None


# ---------- revisions ----------

def revisions(docket):
    rows = sorted((a for a in all_ads().values() if a["docket"] == docket),
                  key=lambda a: a["issue_date"] or "", reverse=True)
    return {
        "docket": docket,
        "count": len(rows),
        "latest_id": rows[0]["id"] if rows else None,
        "versions": [{"id": a["id"], "issue_date": a["issue_date"], "status": a["status"],
                      "citation": a["citation"], "url": a["url"]} for a in rows],
    }


def docket_withdrawn(ad):
    """True when the newest notice in this AD's docket is a withdrawal."""
    if ad.get("status") == "withdrawn":
        return True
    if "id" not in ad:
        return False
    latest = revisions(ad["docket"])["latest_id"]
    return all_ads()[latest].get("status") == "withdrawn"


def effective_models(ad):
    """Older revisions often have an empty Model field; inherit from the latest version in the docket."""
    if ad["models"]:
        return ad["models"]
    for v in revisions(ad["docket"])["versions"]:
        m = all_ads()[v["id"]]["models"]
        if m:
            return m
    return []


# ---------- applicability ----------

def check_applicability(ad, model=None, serial=None):
    """Return {result: APPLIES|DOES_NOT_APPLY|UNKNOWN|AMBIGUOUS, trace: [...], candidates?}."""
    models = effective_models(ad)
    trace = []
    if docket_withdrawn(ad):
        return {"result": "DOES_NOT_APPLY",
                "trace": ["This proposal was withdrawn (latest notice in its docket is a withdrawal); no action is required."]}
    if not model:
        return {"result": "UNKNOWN", "trace": ["No aircraft/engine model given."]}
    nm = norm_model(model)
    listed = {norm_model(m): m for m in models}
    if not listed:
        return {"result": "UNKNOWN", "trace": ["This document lists no models in the dataset."]}
    if nm in listed:
        trace.append(f"Model {model} is listed: {', '.join(models)}.")
    else:
        partial = [m for k, m in listed.items() if k.startswith(nm) or nm.startswith(k)]
        if partial:
            return {"result": "AMBIGUOUS", "candidates": partial,
                    "trace": [f"'{model}' matches several listed variants: {', '.join(partial)}. Specify the exact model."]}
        return {"result": "DOES_NOT_APPLY",
                "trace": [f"Model {model} is not in the applicability list: {', '.join(models)}."]}

    text = ad.get("applicability_text") or ""
    if not text:
        scope = ad["summary"][:300].lower()
        if re.search(r"\bfor all\b|\bapplies to all\b|\ball\b[^.]{0,80}\bmodel", scope):
            trace.append("Summary says the AD covers all units of the listed models (full applicability text not available).")
            return {"result": "APPLIES", "trace": trace}
        trace.append("Full applicability text unavailable; summary says 'certain' units. Cannot confirm serial scope.")
        return {"result": "UNKNOWN", "trace": trace}

    flat = rules.clean(text)
    trace.append(f"Applicability text: \"{flat[:400]}{'...' if len(flat) > 400 else ''}\"")
    unknown = lambda why: {"result": "UNKNOWN", "trace": trace + [why]}
    scope = rules.scope_for_model(flat, model)
    if scope is None:
        return unknown(f"Serial rules are given per model in numbered paragraphs, and none clearly matches {model}; "
                       "check the source.")
    if scope is not flat:
        trace.append(f"Using the paragraph for {model}: \"{scope[:200]}\"")

    if rules.CONFIG_COND_RE.search(scope):
        return unknown(f"Applies only with a specific configuration (\"{rules.CONFIG_COND_RE.search(scope).group(0)}\"); "
                       "check the aircraft's installed parts/modifications against the source.")
    rule = rules.parse_serial_rule(scope)
    if rule and rule["kind"] == "external":
        return unknown("Affected serial numbers are listed in a table or service bulletin that is not in the text.")
    exc_note = f"Exception: \"{rule['config_exception'][:160]}\"; verify manually." if rule and rule["config_exception"] else None

    if rule is None:
        if re.search(r"\bcertain\b", scope, re.I):
            return unknown("Text says 'certain' units without a parsable serial or configuration rule.")
        trace.append("No serial or configuration restriction found in the applicability text.")
        return {"result": "APPLIES", "trace": trace}
    if rule["kind"] == "all":
        trace.append("Rule: all serial numbers of the listed models"
                     + (f", except {', '.join(rule['excepted'])}" if rule["excepted"] else "") + ".")
        if serial and rule["excepted"] and rules.serial_in_rule(serial, {**rule, "values": [], "ranges": []}) is False:
            trace.append(f"S/N {serial} is excluded.")
            return {"result": "DOES_NOT_APPLY", "trace": trace}
        return unknown(exc_note) if exc_note else {"result": "APPLIES", "trace": trace}

    trace.append(f"Rule: serial numbers {rules.describe(rule)}.")
    if not serial:
        return unknown("Applicability depends on the serial number; enter one to check.")
    inside = rules.serial_in_rule(serial, rule)
    if inside is None:
        return unknown(f"S/N {serial} uses a different format from the rule's serial numbers; compare manually.")
    if not inside:
        trace.append(f"S/N {serial} is outside the rule.")
        return {"result": "DOES_NOT_APPLY", "trace": trace}
    trace.append(f"S/N {serial} is covered.")
    return unknown(exc_note) if exc_note else {"result": "APPLIES", "trace": trace}


# ---------- retrieval ----------

def search(query, model=None, k=8):
    t0 = time.perf_counter()
    toks = content_tokens(query[:MAX_QUERY])
    if not toks:
        return {"hits": [], "tokens": [], "ms": 0.0}
    match = " OR ".join('"' + t.replace('"', "") + '"' for t in toks)
    allowed = None
    if model:
        nm = norm_model(model)
        allowed = {a["id"] for a in all_ads().values()
                   if any(norm_model(m) == nm or norm_model(m).startswith(nm) for m in effective_models(a))}
    rows = _con().execute(
        "SELECT c.id, c.ad_id, c.section, c.page, c.text, bm25(chunks_fts) AS score "
        "FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid "
        "WHERE chunks_fts MATCH ? ORDER BY score LIMIT 400", (match,)).fetchall()
    hits = []
    for r in rows:
        if allowed is not None and r["ad_id"] not in allowed:
            continue
        low = r["text"].lower()
        ad = all_ads()[r["ad_id"]]
        meta = (ad["subject"] + " " + " ".join(ad["models"])).lower()
        covered = [t for t in toks if _has_word(t, low) or _has_word(t, meta)]
        hits.append({"chunk_id": r["id"], "ad_id": r["ad_id"], "section": r["section"], "page": r["page"],
                     "text": r["text"], "score": -r["score"], "coverage": len(covered) / len(toks)})
        if len(hits) >= k * 3:
            break
    hits.sort(key=lambda h: (h["coverage"], h["score"]), reverse=True)
    return {"hits": hits[:k], "tokens": toks, "ms": (time.perf_counter() - t0) * 1000}


def ad_card(ad_id):
    ad = all_ads()[ad_id]
    rev = revisions(ad["docket"])
    return {
        "ad_id": ad_id, "docket": ad["docket"], "subject": ad["subject"], "ad_number": ad["ad_number"],
        "status": ad["status"], "issue_date": ad["issue_date"], "make": ad["make"],
        "models": effective_models(ad), "models_source": ad.get("models_source"),
        "citation": ad["citation"], "url": ad["url"],
        "supersedes": ad["supersedes"], "fulltext": ad["fulltext"],
        "revision": {"count": rev["count"], "is_latest": rev["latest_id"] == ad_id,
                     "latest_id": rev["latest_id"], "versions": rev["versions"]},
    }


# ---------- gates ----------

MIN_COVERAGE = 0.6  # short queries (<= 2 content words) need every word present


def gate(query, model=None, serial=None):
    """Pre-LLM checks. Returns (status, reason, search_result, applicability_by_ad)."""
    if not query.strip():
        return "refused", "Empty query.", None, {}
    if len(query) > MAX_QUERY:
        return "refused", f"Query longer than {MAX_QUERY} characters.", None, {}
    if META_RE.search(query):
        return "refused", ("This question is about the assistant or tries to change its rules. It only answers "
                           "questions about the airworthiness-directive documents in the corpus."), None, {}
    if model:
        nm = norm_model(model)
        known = {m for a in all_ads().values() for m in effective_models(a)}
        if not any(norm_model(m) == nm for m in known):
            cands = sorted(m for m in known if norm_model(m).startswith(nm))
            if len(cands) > 1:
                return ("needs_clarification",
                        f"Model '{model}' is ambiguous. Did you mean one of: {', '.join(cands[:12])}?", None, {})
    res = search(query, model=model)
    need = 1.0 if len(res["tokens"]) <= 2 else MIN_COVERAGE
    if not res["hits"] or res["hits"][0]["coverage"] < need:
        return "refused", ("No document in the corpus matches this question well enough to answer it. "
                           "The corpus covers 431 FAA airworthiness-directive Federal Register notices."), res, {}
    appl = {}
    for h in res["hits"]:
        if h["ad_id"] not in appl:
            appl[h["ad_id"]] = check_applicability(all_ads()[h["ad_id"]], model, serial)
    if model and all(a["result"] == "AMBIGUOUS" for a in appl.values()):
        cands = sorted({c for a in appl.values() for c in a.get("candidates", [])})
        return "needs_clarification", f"Model '{model}' is ambiguous. Did you mean one of: {', '.join(cands[:12])}?", res, appl
    if NONCOMPLY_RE.search(query):
        return "refused", ("This request conflicts with the mandatory nature of airworthiness directives. "
                           "Deviations are only possible through an approved Alternative Method of Compliance (AMOC) "
                           "described in the AD's AMOC paragraph."), res, appl
    if model and serial and all(a["result"] == "DOES_NOT_APPLY" for a in appl.values()):
        return "refused", (f"None of the matching documents apply to {model} S/N {serial}, so the question's premise "
                           "contradicts their applicability rules. See the applicability trace for each document."), res, appl
    return "ok", "", res, appl
