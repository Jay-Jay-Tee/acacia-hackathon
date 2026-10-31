"""Deterministic text rules shared by ingest and engine: model lists and serial-number applicability.
No LLM here. Anything that can't be parsed reliably returns None / UNKNOWN rather than a guess."""
import re

# ---------- model lists ----------

# "Model A310-203, -204, and -221 airplanes" / "Models 401, 401A and 402 airplanes" (never spans a second "Model")
MODEL_LIST_RE = re.compile(
    r"\bModels?\s+((?:(?!\bModels?\b).){1,400}?)\s+(?:series\s+)?(?:airplanes?|helicopters?|rotorcraft|gliders?|"
    r"(?:turbo\w+\s+)?engines?|propellers?)\b", re.I)
# "PW210A and PW210S model turboshaft engines" (model name before the word "model")
MODEL_AFTER_RE = re.compile(r"applies to (?:all |certain )?(.{1,200}?)\s+model\s+(?:turbo\w+\s+)?engines", re.I)
MODEL_TOKEN_RE = re.compile(r"^[A-Z0-9][A-Za-z0-9 .\-/+]{0,28}$")
BARE_SUFFIX_RE = re.compile(r"^\d{2,3}[A-Z]{0,3}$")  # '253N' in '-252N, 253N' (hyphen missing in source)
NOT_MODEL = re.compile(r"\b(certificated|category|all|certain|with|installed|identified|serial|series|the|and|or)\b", re.I)


def clean(text):
    """Collapse whitespace and repair PDF line-wrap artifacts like 'B4- 622' and ', - 300'."""
    return re.sub(r"-\s+(?=[A-Za-z0-9])", "-", " ".join(text.split()))


def _split_list(s):
    return re.split(r",\s*(?:and\s+|or\s+)?|;\s*|\s+(?:and|or)\s+", s)


def _expand(parts, take_last_word=False):
    """Expand a split model list: '-204' inherits the base of the previous model ('A310-203' -> 'A310-204');
    a bare token after a spaced first model inherits its prefix ('A300 B4-601, B4-603' -> 'A300 B4-603')."""
    out, base, prefix = [], None, None
    for i, p in enumerate(parts):
        p = re.sub(r"^(?:all|certain)\s+", "", p.strip(" ;:()"), flags=re.I)
        p = re.sub(r"\s+(?:series|variant\b.*)$", "", p, flags=re.I)
        if take_last_word and p:
            p = p.split()[-1]
        if not p:
            continue
        if p.startswith("-") and base:
            p = base + p
        elif base and out and BARE_SUFFIX_RE.match(p) and out[-1].startswith(base + "-"):
            p = f"{base}-{p}"
        elif i > 0 and prefix and " " not in p and not p.startswith(prefix.split()[0]):
            p = f"{prefix} {p}"
        if "-" in p.lstrip("-"):
            base = p.split("-")[0]
        if i == 0 and " " in p:
            prefix = p.rsplit(" ", 1)[0]
        if MODEL_TOKEN_RE.match(p) and re.search(r"\d", p) and not NOT_MODEL.search(p):
            out.append(p)
    return out


def parse_models(text):
    """Model designations named in an applicability paragraph or summary. Returns [] when nothing reliable."""
    text = clean(text)
    models = []
    for m in MODEL_LIST_RE.finditer(text):
        # drop parentheticals like 'CL-600-1A11 (600)' or '(601-3A, 601-3R, and 604 Variants)' before splitting
        models += _expand(_split_list(re.sub(r"\s*\([^)]*\)", "", m.group(1))))
    if not models:
        m = MODEL_AFTER_RE.search(text)
        if m:
            models = _expand(_split_list(m.group(1)), take_last_word=True)
    return list(dict.fromkeys(models))


EMBED_SECTIONS = re.compile(r"summary|applicability|unsafe condition|reason|required actions|requirements|"
                            r"exceptions|definitions|modifications|provisions", re.I)


def embed_text(subject, section, text):
    """Text embedded for a chunk, or None to skip it (ingest and engine must agree).
    Only content sections are embedded; boilerplate (addresses, contacts, dates, AMOC procedures,
    incorporation by reference) is left to BM25. Long background passages are truncated."""
    if section == "Supplementary Information":
        return f"{subject}. {section}. {text[:800]}"
    if EMBED_SECTIONS.search(section):
        return f"{subject}. {section}. {text}"
    return None


# ---------- query expansion ----------

# How mechanics say it -> how AD text says it. General aviation vocabulary and standard abbreviations;
# alternatives are added to the search (never replace the user's words) and count toward word coverage.
SYNONYMS = {
    # phrases
    "fire handle": ["fire switch"], "ran dry": ["fuel starvation"], "ran out of fuel": ["fuel starvation"],
    "out of fuel": ["fuel starvation"], "engine quit": ["engine shutdown", "in-flight shutdown"],
    "let go": ["release", "uncommanded release"], "on its own": ["uncommanded"], "by itself": ["uncommanded"],
    "on their own": ["uncommanded"], "warning sign": ["placard"], "fuel gauge": ["fuel quantity indicator"],
    "nose gear": ["nose landing gear"], "main gear": ["main landing gear"], "tail boom": ["tailboom"],
    # words
    "winch": ["hoist"], "gearbox": ["transmission"], "actuator": ["servo-control", "servo"],
    "rust": ["corrosion"], "rusted": ["corrosion", "corroded"], "rusty": ["corrosion"],
    "screen": ["monitor", "display"], "screens": ["monitors", "displays"], "broken": ["fractured", "failure"],
    "worn": ["wear", "chafing"], "wires": ["wiring", "harness"], "wire": ["wiring"],
    "overheating": ["excessive heat"], "overheat": ["excessive heat"], "loose": ["torque", "loosening"],
    "stretcher": ["litter"], "cowl": ["cowling"], "sign": ["placard"], "gauge": ["indicator"],
    "quit": ["shutdown"], "leaking": ["leak"],
    # abbreviations
    "hpt": ["high-pressure turbine"], "lpt": ["low-pressure turbine"], "hpc": ["high-pressure compressor"],
    "lpc": ["low-pressure compressor"], "mlg": ["main landing gear"], "nlg": ["nose landing gear"],
    "apu": ["auxiliary power unit"], "rat": ["ram air turbine"], "eec": ["electronic engine control"],
    "fadec": ["full authority digital engine control"], "psu": ["passenger service unit"],
    "elt": ["emergency locator transmitter"], "ice": ["icing"], "ndt": ["non-destructive"],
}
_PHRASES = sorted((k for k in SYNONYMS if " " in k), key=len, reverse=True)


def expand_query(query, tokenize):
    """[(term, [alternatives])] for a query: known phrases first, then the remaining content words
    (tokenize = the engine's stopword-filtering tokenizer)."""
    q = query.lower()
    units = []
    for p in _PHRASES:
        pat = r"(?<![a-z0-9])" + re.escape(p) + r"(?![a-z0-9])"
        if re.search(pat, q):
            units.append((p, SYNONYMS[p]))
            q = re.sub(pat, " ", q)
    units += [(t, SYNONYMS.get(t, [])) for t in tokenize(q)]
    return units


def norm_model(s):
    return re.sub(r"[\s_]", "", s or "").upper()


# ---------- serial-number rules ----------

SER = r"-?(?=[A-Z0-9-]*\d)[A-Z0-9]+(?:-[A-Z0-9]+)*"  # S-1000, 34-7250001, -0012, 0005; must contain a digit
SERIAL_KW = r"(?:manufacturer serial numbers?|engine serial numbers?|serial numbers?|S/Ns?|MSNs?|ESNs?)(?:\s*\((?:S/Ns?|MSNs?|ESNs?)\))?"
EXTERNAL_RE = re.compile(r"(?:serial[^.]{0,80}(?:table|service bulletin|\bSB\b|appendix|listed in)"
                         r"|(?:table|appendix)[^.]{0,80}serial)", re.I)
ALL_SERIALS_RE = re.compile(r"\ball (?:manufacturer |engine )?(?:serial numbers|S/Ns|MSNs|ESNs)\b", re.I)
EXCEPT_SERIALS_RE = re.compile(r"\bexcept (?:for )?" + SERIAL_KW + r"\s+(" + SER + r"(?:(?:,\s*|\s+and\s+|,\s*and\s+)" + SER + r")*)", re.I)
CONFIG_EXCEPT_RE = re.compile(r"\bexcept\b(?!\s+(?:for\s+)?(?:S/N|serial|MSN|ESN))[^.]{0,200}", re.I)
CONFIG_COND_RE = re.compile(
    r"\b(?:with|equipped with|having|that have)\b(?!\s+(?:an?\s+)?(?:manufacturer\s+|engine\s+)?(?:serial|S/N|ESN|MSN))"
    r"[^.]{0,120}?\b(?:installed|incorporated|modified|embodied|part numbers?|P/N)\b", re.I)
RANGE_RE = re.compile(r"(" + SER + r")\s+(?:through|to)\s+(" + SER + r")(?:\s+inclusive)?", re.I)
UPTO_RE = re.compile(r"up to(?: and including)?\s+(" + SER + r")", re.I)
FROM_RE = re.compile(r"(" + SER + r")\s+and\s+(?:subsequent|higher|on|up)\b", re.I)
SER_TOKEN_RE = re.compile(r"(?<![A-Za-z0-9/])(" + SER + r")(?![A-Za-z0-9/])")


def serial_key(s):
    """('PREFIX', number) so 'S-1200' compares with 'S-1000'..'S-1500' and '34-7250001' with '34-7450220'."""
    m = re.match(r"^(.*?)(\d+)$", s.strip().strip("-").upper())
    return (m.group(1).rstrip("-"), int(m.group(2))) if m else None


# numbered paragraph markers only at sentence starts: not "(c)(1) through (3)" or "CL-600-1A11 (600)"
PARA_RE = re.compile(r"(?:^|(?<=[.:;] ))\(\d+\)\s+")


def scope_for_model(text, model):
    """When applicability is split into numbered paragraphs with their own serial ranges
    ('(1) Model CL-600-1A11 ... serial numbers 1001 through 1085. (2) Model CL-600-2A12 ...'),
    return the paragraph that names this model; otherwise the whole text.
    Returns None when per-model paragraphs exist but none (or several) match, so the caller can say UNKNOWN
    instead of applying another model's serial range."""
    parts = PARA_RE.split(text)
    if len(parts) < 3:
        return text
    nm = norm_model(model)
    word = re.compile(r"(?<![A-Za-z0-9-])" + re.escape(model.strip()) + r"(?![A-Za-z0-9-])", re.I)
    hits = [p for p in parts[1:] if any(norm_model(m) == nm for m in parse_models(p)) or word.search(p)]
    if len(hits) == 1:
        return hits[0]
    serial_paras = [p for p in parts[1:] if re.search(SERIAL_KW, p, re.I)]
    return None if len(serial_paras) >= 2 else text


def parse_serial_rule(text):
    """Structured serial rule, or None when the text sets no serial restriction.
    {kind: 'all'|'set'|'external', ranges: [(lo|None, hi|None)], values: [...], excepted: [...], config_exception: str|None}"""
    t = clean(text)
    config_exc = CONFIG_EXCEPT_RE.search(t)
    rule = {"kind": None, "ranges": [], "values": [], "excepted": [],
            "config_exception": config_exc.group(0) if config_exc else None}
    exc = EXCEPT_SERIALS_RE.search(t)
    if exc:
        rule["excepted"] = SER_TOKEN_RE.findall(exc.group(1))
        t = t[:exc.start()] + t[exc.end():]
    if EXTERNAL_RE.search(t):
        rule["kind"] = "external"
        return rule
    if ALL_SERIALS_RE.search(t):
        rule["kind"] = "all"
        return rule
    kws = list(re.finditer(SERIAL_KW, t, re.I))
    if not kws:
        return None if not rule["excepted"] else {**rule, "kind": "all"}
    # collect from every serial clause, not just the first, so a later range is never silently ignored
    for kw in kws:
        seg = re.split(r"\.\s|;|\bcertificated\b|\(\d+\)", t[kw.end():], maxsplit=1)[0]
        rule["ranges"] += RANGE_RE.findall(seg)
        rule["ranges"] += [(None, hi) for hi in UPTO_RE.findall(seg)]
        rule["ranges"] += [(lo, None) for lo in FROM_RE.findall(seg)]
        rest = FROM_RE.sub(" ", UPTO_RE.sub(" ", RANGE_RE.sub(" ", seg)))
        rule["values"] += [v for v in SER_TOKEN_RE.findall(rest) if serial_key(v)]
    rule["ranges"] = list(dict.fromkeys(rule["ranges"]))
    rule["values"] = list(dict.fromkeys(rule["values"]))
    if not rule["ranges"] and not rule["values"]:
        return None
    rule["kind"] = "set"
    return rule


def describe(rule):
    parts = [f"{lo or 'start'} to {hi or 'end'}" for lo, hi in rule["ranges"]]
    if rule["values"]:
        parts.append(", ".join(rule["values"][:12]) + (" ..." if len(rule["values"]) > 12 else ""))
    s = "; ".join(parts)
    if rule["excepted"]:
        s += f" (except {', '.join(rule['excepted'])})"
    return s


def serial_in_rule(serial, rule):
    """True / False, or None when the serial format can't be compared with the rule."""
    sk = serial_key(serial)
    if not sk:
        return None
    if any(serial_key(e) == sk for e in rule["excepted"]):
        return False
    comparable = False
    for v in rule["values"]:
        vk = serial_key(v)
        if vk and vk[0] == sk[0]:
            comparable = True
            if vk == sk:
                return True
    for lo, hi in rule["ranges"]:
        klo, khi = serial_key(lo) if lo else None, serial_key(hi) if hi else None
        prefix = (klo or khi)[0]
        if prefix != sk[0] or (klo and khi and klo[0] != khi[0]):
            continue
        comparable = True
        if (not klo or klo[1] <= sk[1]) and (not khi or sk[1] <= khi[1]):
            return True
    return False if comparable else None
