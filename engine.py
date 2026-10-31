"""Deterministic core: retrieval, applicability, revisions, refusal gates. No LLM in this file."""
import copy
import hashlib
import json
import re
import sqlite3
import time
from functools import lru_cache
from pathlib import Path

import rules

DB = Path(__file__).parent / "data/ads.db"
EMB = Path(__file__).parent / "data/emb.npy"
EMB_META = Path(__file__).parent / "data/emb_meta.json"
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
    """Versions of a docket, newest first. The current version is the one with the latest Federal Register
    publish date (the organisers' rule; the source Status column says "Current" on every row)."""
    rows = sorted((a for a in all_ads().values() if a["docket"] == docket),
                  key=lambda a: (a.get("publish_date") or "", a["issue_date"] or ""), reverse=True)
    return {
        "docket": docket,
        "count": len(rows),
        "latest_id": rows[0]["id"] if rows else None,
        "versions": [{"id": a["id"], "record_id": a.get("record_id"), "publish_date": a.get("publish_date"),
                      "issue_date": a["issue_date"], "status": a["status"],
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

    if ad.get("status") == "not_ad":  # model matched, but this record is not an AD (e.g. a Part 61 training rule)
        return {"result": "UNKNOWN", "trace": trace + [f"{status_label(ad)}; airworthiness applicability rules do "
                                                       "not apply. Read the source."]}
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

FILTER_KEYS = ("status", "make", "product_type", "published_from", "published_to")
STATUSES = ("proposed", "final", "withdrawn", "not_ad")


def clean_filters(filters):
    """Normalise a filters dict to a hashable tuple of (key, value) pairs; empty values are dropped."""
    out = []
    for k in FILTER_KEYS:
        v = (filters or {}).get(k)
        if k == "status":
            v = tuple(sorted({x for x in (v or []) if x in STATUSES}))
        elif isinstance(v, str):
            v = v.strip()[:60]
        if v:
            out.append((k, v))
    return tuple(out)


def filter_ids(filters):
    """Record ids passing the filters, or None when no filter is set."""
    f = dict(filters)
    if not f:
        return None
    make, ptype = f.get("make", "").lower(), f.get("product_type", "").lower()
    return {a["id"] for a in all_ads().values()
            if (not f.get("status") or a["status"] in f["status"])
            and (not make or make in (a.get("make") or "").lower())
            and (not ptype or ptype in (a.get("product_type") or "").lower())
            and (not f.get("published_from") or (a.get("publish_date") or "") >= f["published_from"])
            and (not f.get("published_to") or (a.get("publish_date") or "9999") <= f["published_to"])}


def describe_filters(filters):
    f = dict(filters)
    parts = []
    if f.get("status"):
        parts.append("status " + " or ".join(f["status"]))
    if f.get("make"):
        parts.append(f"make contains '{f['make']}'")
    if f.get("product_type"):
        parts.append(f"product type {f['product_type']}")
    if f.get("published_from") or f.get("published_to"):
        parts.append(f"published {f.get('published_from', '…')} to {f.get('published_to', '…')}")
    return "; ".join(parts)


@lru_cache(maxsize=1)
def facets():
    """Values the filter UI offers, from the corpus itself."""
    ads = all_ads().values()
    dates = sorted(a["publish_date"] for a in ads if a.get("publish_date"))
    types = sorted({t.strip() for a in ads for t in (a.get("product_type") or "").split("|") if t.strip()})
    return {"status": {s: sum(1 for a in ads if a["status"] == s) for s in STATUSES},
            "makes": sorted({a["make"] for a in ads if a.get("make")}, key=str.lower),
            "product_types": types,
            "published": {"min": dates[0] if dates else None, "max": dates[-1] if dates else None}}


def search(query, model=None, k=8, filters=None):
    """BM25 search with an in-memory LRU cache. 'ms' is the real time of this call (a cache hit is near 0)."""
    t0 = time.perf_counter()
    res = copy.deepcopy(_search_cached(query[:MAX_QUERY], model or None, k, clean_filters(filters)))
    res["ms"] = (time.perf_counter() - t0) * 1000
    return res


@lru_cache(maxsize=1)
def _vectors():
    """Chunk embeddings for hybrid retrieval, or None (BM25 only) when the optional files or library are
    missing, or the embeddings were built for a different index."""
    try:
        import numpy as np
        from fastembed import TextEmbedding
    except ImportError:
        return None
    if not (EMB.exists() and EMB_META.exists()):
        return None
    meta = json.loads(EMB_META.read_text())
    picked = []
    for r in _con().execute("SELECT c.id, c.ad_id, c.section, c.text FROM chunks c ORDER BY c.id"):
        txt = rules.embed_text(all_ads()[r["ad_id"]]["subject"], r["section"], r["text"])
        if txt:
            picked.append((r["id"], r["ad_id"], txt))
    if hashlib.sha256("\x00".join(t for _, _, t in picked).encode()).hexdigest() != meta.get("digest") \
            or [cid for cid, _, _ in picked] != meta["ids"]:
        print("engine: embeddings are stale (run `python ingest.py --no-fetch --embed`); using BM25 only")
        return None
    mat = np.load(EMB).astype(np.float32)
    return {"np": np, "mat": mat, "ids": np.array(meta["ids"]), "ad_of": np.array([a for _, a, _ in picked]),
            "pos": {cid: i for i, cid in enumerate(meta["ids"])}, "model": TextEmbedding(meta["model"])}


def hybrid_enabled():
    return _vectors() is not None


RRF_K = 60
EXPAND = True  # query expansion with aviation synonyms/abbreviations (rules.SYNONYMS)
# Vector ranking weight in the fusion (BM25 = 1.0). Off by default: on this corpus fusion gave no recall gain
# (synthetic recall@5 78/80 hybrid vs 79/80 BM25; paraphrase dev set 16/16 either way), so embeddings are used
# only for the relevance gate's similarity check, where they let 13/16 paraphrased questions through vs 5/16.
VEC_WEIGHT = 0.0
COV_BONUS = 0.02  # hybrid re-rank bonus per unit of query-word coverage (1/(60+rank) is ~0.016 at the top)


@lru_cache(maxsize=512)
def _search_cached(query, model, k, filters=()):
    """BM25 (and, when embeddings exist, vector search) fused with reciprocal rank fusion.
    Each hit carries 'coverage' (share of query words present) and 'sim' (cosine, or None)."""
    t0 = time.perf_counter()
    # each unit is a query term plus synonyms/expanded abbreviations (rules.SYNONYMS); a unit counts as
    # covered when any of its forms appears, and every form is searched
    units = rules.expand_query(query, content_tokens) if EXPAND else [(t, []) for t in content_tokens(query)]
    toks = [t for t, _ in units]
    if not toks:
        return {"hits": [], "tokens": [], "ms": 0.0}
    forms = list(dict.fromkeys(f for t, alts in units for f in [t, *alts]))
    match = " OR ".join('"' + f.replace('"', "") + '"' for f in forms)
    allowed = filter_ids(filters)
    if model:
        nm = norm_model(model)
        by_model = {a["id"] for a in all_ads().values()
                    if any(norm_model(m) == nm or norm_model(m).startswith(nm) for m in effective_models(a))}
        allowed = by_model if allowed is None else allowed & by_model
    bm = [r["id"] for r in _con().execute(
        "SELECT c.id, c.ad_id FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid "
        "WHERE chunks_fts MATCH ? ORDER BY bm25(chunks_fts) LIMIT 400", (match,)).fetchall()
        if allowed is None or r["ad_id"] in allowed]
    fused = {cid: 1 / (RRF_K + rank) for rank, cid in enumerate(bm)}
    vec, sims = _vectors(), {}
    if vec:
        np = vec["np"]
        extra = [a for _, alts in units for a in alts]
        qtext = f"{query} ({', '.join(extra)})" if extra else query
        q = np.array(next(iter(vec["model"].query_embed([qtext]))), dtype=np.float32)
        scores = vec["mat"] @ (q / np.linalg.norm(q))
        if allowed is not None:
            scores = np.where(np.isin(vec["ad_of"], list(allowed)), scores, -1.0)
        if VEC_WEIGHT:
            for rank, i in enumerate(np.argsort(-scores)[:200]):
                if scores[i] > -1:
                    cid = int(vec["ids"][i])
                    fused[cid] = fused.get(cid, 0) + VEC_WEIGHT / (RRF_K + rank)
        sims = lambda cid: float(scores[vec["pos"][cid]]) if cid in vec["pos"] else None  # boilerplate: no vector
    order = sorted(fused, key=fused.get, reverse=True)[:k * 3]
    if not order:
        return {"hits": [], "tokens": toks, "ms": (time.perf_counter() - t0) * 1000}
    rows = {r["id"]: r for r in _con().execute(
        f"SELECT id, ad_id, section, page, text FROM chunks WHERE id IN ({','.join('?' * len(order))})", order)}
    hits = []
    for cid in order:
        r = rows[cid]
        ad = all_ads()[r["ad_id"]]
        low, meta = r["text"].lower(), (ad["subject"] + " " + " ".join(ad["models"])).lower()
        covered = [t for t, alts in units if any(_has_word(f, low) or _has_word(f, meta) for f in [t, *alts])]
        hits.append({"chunk_id": cid, "ad_id": r["ad_id"], "section": r["section"], "page": r["page"],
                     "text": r["text"], "score": fused[cid], "coverage": len(covered) / len(toks),
                     "sim": sims(cid) if vec else None})
    if not (vec and VEC_WEIGHT):  # BM25 ranking: prefer chunks containing more of the query's words
        hits = sorted(hits, key=lambda h: (h["coverage"], h["score"]), reverse=True)[:k]
    else:  # hybrid: fused rank plus a small bonus for chunks containing the query's actual words
        hits = sorted(hits, key=lambda h: h["score"] + COV_BONUS * h["coverage"], reverse=True)[:k]
    return {"hits": hits, "tokens": toks, "ms": (time.perf_counter() - t0) * 1000}


def aircraft_family(ad):
    """Short aircraft-type label for a record, e.g. 'Boeing 737' or 'Airbus Helicopters AS350'.
    Used to warn when one answer draws on notices for different aircraft types."""
    models = effective_models(ad)
    make = re.sub(r"[.,]", "", (ad.get("make") or "").replace("The Boeing Company", "Boeing")).strip()
    if not models:
        return make or ad["docket"]
    # keep a type letter that ends the designation ('Falcon 6X'), drop variant suffixes ('737-800' -> '737')
    m = re.match(r"[A-Za-z.]*[ -]?\d+[A-Za-z]?(?=$|[\s-])", models[0]) or re.match(r"[A-Za-z.]*[ -]?\d+", models[0])
    return f"{make} {m.group(0) if m else models[0]}".strip()


def status_label(ad):
    if ad["status"] == "final":
        return f"Final AD {ad['ad_number']}".strip()
    if ad["status"] == "withdrawn":
        return "Withdrawn proposal (no action required)"
    if ad["status"] == "not_ad":
        return f"Not an airworthiness directive (14 CFR Part {ad.get('cfr_part')})"
    return "Proposed rule (NPRM), not in effect"


def page_range(ad):
    if ad["page_start"] and ad["page_end"] and ad["page_end"] != ad["page_start"]:
        return f"{ad['page_start']}-{ad['page_end']}"
    return str(ad["page_start"] or "")


def fr_cite(ad, page=None):
    """Standard Federal Register citation, e.g. '91 FR 61797' (a passage) or '91 FR 61796-61799' (the notice).
    The volume is the publish year minus 1935 (volume 1 = 1936); it agrees with the sheet's text on every row
    that states a volume, and fills in the 12 that don't."""
    year = (ad.get("publish_date") or ad.get("issue_date") or "")[:4]
    where = str(page) if page else page_range(ad)
    if not (year.isdigit() and where):
        return ""
    return f"{int(year) - 1935} FR {where}"


def corpus_stats():
    """Corpus size, stated as the brief asks."""
    ads = all_ads().values()
    full = [a for a in ads if a["fulltext"]]
    return {
        "records": len(all_ads()),
        "records_with_full_text": len(full),
        "federal_register_pages": sum(a["page_end"] - a["page_start"] + 1 for a in full if a["page_start"] and a["page_end"]),
        "passages": _con().execute("SELECT count(*) FROM chunks").fetchone()[0],
        "status": {s: sum(1 for a in ads if a["status"] == s) for s in ("proposed", "withdrawn", "final", "not_ad")},
        "embeddings": hybrid_enabled(),
    }


def ad_card(ad_id):
    ad = all_ads()[ad_id]
    rev = revisions(ad["docket"])
    return {
        "ad_id": ad_id, "record_id": ad.get("record_id"), "docket": ad["docket"], "subject": ad["subject"],
        "ad_number": ad["ad_number"], "status": ad["status"], "status_label": status_label(ad),
        "issue_date": ad["issue_date"], "publish_date": ad.get("publish_date"), "pages": page_range(ad),
        "make": ad["make"],
        "models": effective_models(ad), "models_source": ad.get("models_source"),
        "citation": ad["citation"], "fr_cite": fr_cite(ad), "url": ad["url"],
        "supersedes": ad["supersedes"], "fulltext": ad["fulltext"], "data_warning": ad.get("data_warning"),
        "revision": {"count": rev["count"], "is_latest": rev["latest_id"] == ad_id,
                     "latest_id": rev["latest_id"], "versions": rev["versions"]},
    }


# ---------- gates ----------

@lru_cache(maxsize=1)
def known_models():
    return sorted({m for a in all_ads().values() for m in effective_models(a)})


def model_candidates(model):
    """Exact corpus models this (possibly partial) model could mean; [] when it is already exact."""
    nm = norm_model(model)
    known = known_models()
    if any(norm_model(m) == nm for m in known):
        return []
    return [m for m in known if norm_model(m).startswith(nm)]


MIN_COVERAGE = 0.6  # short queries (<= 2 content words) need every word present
MIN_SIM = 0.70      # cosine similarity that counts as on-topic when words differ (tuned in evaluation/eval_retrieval.py)


def relevant(res, top=3):
    """Relevance gate: a top hit must contain enough of the query's words, or (with embeddings) be close
    enough in meaning. Off-topic questions are refused before any LLM call."""
    hits = res["hits"][:top]
    if not hits:
        return False
    need = 1.0 if len(res["tokens"]) <= 2 else MIN_COVERAGE
    if max(h["coverage"] for h in hits) >= need:
        return True
    sims = [h["sim"] for h in hits if h["sim"] is not None]
    return bool(sims) and max(sims) >= MIN_SIM


def gate(query, model=None, serial=None, filters=None):
    """Pre-LLM checks. Returns (status, reason, search_result, applicability_by_ad)."""
    if not query.strip():
        return "refused", "Empty query.", None, {}
    if len(query) > MAX_QUERY:
        return "refused", f"Query longer than {MAX_QUERY} characters.", None, {}
    if META_RE.search(query):
        return "refused", ("This question is about the assistant or tries to change its rules. It only answers "
                           "questions about the airworthiness-directive documents in the corpus."), None, {}
    if model and len(model_candidates(model)) > 1:
        cands = model_candidates(model)
        return ("needs_clarification",
                f"Model '{model}' is ambiguous. Did you mean one of: {', '.join(cands[:12])}?", None, {})
    res = search(query, model=model, filters=filters)
    if not relevant(res):
        active = describe_filters(clean_filters(filters))
        if active:
            return "refused", (f"No document matching your filters ({active}) answers this question. "
                               "Clear or widen the filters to search the whole corpus."), res, {}
        return "refused", ("No document in the corpus matches this question well enough to answer it. "
                           "The corpus covers 431 FAA airworthiness-directive Federal Register notices."), res, {}
    appl = {}
    for h in res["hits"]:
        if h["ad_id"] not in appl:
            appl[h["ad_id"]] = check_applicability(all_ads()[h["ad_id"]], model, serial)
    # the most relevant document decides: if it can't tell which variant was meant, ask
    if model and appl[res["hits"][0]["ad_id"]]["result"] == "AMBIGUOUS":
        cands = sorted({c for a in appl.values() if a["result"] == "AMBIGUOUS" for c in a.get("candidates", [])})
        return "needs_clarification", f"Model '{model}' is ambiguous. Did you mean one of: {', '.join(cands[:12])}?", res, appl
    if NONCOMPLY_RE.search(query):
        return "refused", ("This request conflicts with the mandatory nature of airworthiness directives. "
                           "Deviations are only possible through an approved Alternative Method of Compliance (AMOC) "
                           "described in the AD's AMOC paragraph."), res, appl
    if model and serial and all(a["result"] == "DOES_NOT_APPLY" for a in appl.values()):
        return "refused", (f"None of the matching documents apply to {model} S/N {serial}, so the question's premise "
                           "contradicts their applicability rules. See the applicability trace for each document."), res, appl
    return "ok", "", res, appl
