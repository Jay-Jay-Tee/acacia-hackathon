"""Elementary multi-agent disruption-recovery model (ATC / Pilot / Ground).

Principle: agents PROPOSE and VETO; deterministic code (check_plan) decides validity.
All operational numbers below are labeled SIMULATION ASSUMPTIONS, not dataset facts.
Swap ground_propose / the review functions for LLM calls later; keep check_plan as the judge.
"""
from dataclasses import dataclass

# ---- simulation assumptions (tunable) --------------------------------------
IDLE_BURN = 0.5       # fuel-minutes burned per minute spent waiting
RESERVE = 2           # fuel-minutes that must remain
TOW_TIME = 15         # minutes to tow along the approved alternative route
MAX_ROUNDS = 2        # negotiation cap; a round = propose -> review
STEP = 5              # start-time granularity (minutes)
MAX_WAIT = 60         # longest deliberate wait considered
CHURN_PENALTY = 5     # delay-minute equivalent of changing a gate/method (plan stability)
LABELS = ["NONE", "MINOR", "MAJOR", "CRITICAL"]


@dataclass
class Flight:
    id: str; size: str; ready: int; sched_arrival: int; turnaround: int
    fuel: float; latest_arrival: int; connections: int


@dataclass
class State:
    flights: dict
    gates: dict       # id -> {"sizes": set, "busy": [(start, end)], "ok": bool}
    routes: dict      # gate -> {"taxi": minutes, "open": bool}
    tow_open: bool = True
    tug_free_at: int = 0


@dataclass
class V:              # a violated constraint, owned by one domain
    domain: str       # ATC | PILOT | GROUND
    key: tuple        # (flight, gate, method)
    kind: str
    msg: str


# ---- deterministic core -----------------------------------------------------
def timing(st, f, gate, method, start):
    s = max(start, f.ready)
    if method == "tow":
        s, travel = max(s, st.tug_free_at), TOW_TIME
    else:
        travel = st.routes[gate]["taxi"]
    used = (s - f.ready) * IDLE_BURN + (travel if method == "taxi" else 0)
    return s, s + travel, used


def check_plan(st, plan):
    """Mandatory constraints. Never traded off against efficiency."""
    rows = []
    for fid, (gate, method, start) in plan.items():
        s, arrive, used = timing(st, st.flights[fid], gate, method, start)
        rows.append((arrive, fid, gate, method, s, used))
    rows.sort()
    out, seen, tows = [], [], []
    for arrive, fid, gate, method, s, used in rows:
        f, g, key = st.flights[fid], st.gates[gate], (fid, gate, method)
        if method == "taxi" and not st.routes[gate]["open"]:
            out.append(V("ATC", key, "route", f"{fid}: taxi route to {gate} is blocked"))
        if method == "tow" and not st.tow_open:
            out.append(V("ATC", key, "route", f"{fid}: tow route is closed"))
        margin = f.fuel - used - RESERVE
        if margin < 0:
            out.append(V("PILOT", key, "fuel", f"{fid}: {method} to {gate} breaks fuel reserve by {-margin:.1f} min"))
        if arrive > f.latest_arrival:
            out.append(V("PILOT", key, "latest", f"{fid}: arrival {arrive} after latest allowable {f.latest_arrival}"))
        if f.size not in g["sizes"] or not g["ok"]:
            out.append(V("GROUND", key, "gate", f"{fid}: {gate} unusable (size/equipment)"))
        end = arrive + f.turnaround
        for b, e in g["busy"]:
            if arrive < e and b < end:
                out.append(V("GROUND", key, "gate", f"{fid}: {gate} occupied {b}-{e}"))
        for og, b, e, ofid in seen:
            if og == gate and arrive < e and b < end:
                out.append(V("GROUND", key, "gate", f"{fid}: {gate} overlaps {ofid}"))
        seen.append((gate, arrive, end, fid))
        if method == "tow":
            if any(s < te and tb < s + TOW_TIME for tb, te in tows):
                out.append(V("GROUND", key, "tug", f"{fid}: tug already busy at {s}"))
            tows.append((s, s + TOW_TIME))
    return out


# ---- severity rubric --------------------------------------------------------
def up(x, cuts):   return sum(x > c for c in cuts)    # bigger is worse
def down(x, cuts): return sum(x < c for c in cuts)    # smaller is worse


def rubric(st, plan):
    """Five dimensions, each scored 0-3. Overall = WORST dimension (no averaging away a safety issue)."""
    delays, slacks, margins, conn = [], [], [], 0
    for fid, (gate, method, start) in plan.items():
        f = st.flights[fid]
        _, arrive, _ = timing(st, f, gate, method, start)
        d = max(0, arrive - f.sched_arrival)
        delays.append(d)
        slacks.append(f.latest_arrival - arrive)
        conn += f.connections if d > 15 else 0
        open_taxi = [f.fuel - st.routes[g]["taxi"] - RESERVE for g in st.routes if st.routes[g]["open"]]
        margins.append(max(open_taxi) if open_taxi else -99)   # best unassisted option
    viol = check_plan(st, plan)
    dims = {
        "hard-constraint violations": (len(viol), 2 if viol else 0),
        "worst delay (min)": (max(delays), up(max(delays), (5, 15, 30))),
        "slack to latest arrival (min)": (min(slacks), down(min(slacks), (30, 15, 5))),
        "best fuel margin (min)": (min(margins), down(min(margins), (15, 8, 0))),
        "connections at risk (pax)": (conn, up(conn, (0, 20, 50))),
    }
    return dims, max(lvl for _, lvl in dims.values()), viol


# ---- agents -----------------------------------------------------------------
def vetoes(st, domain, fid):
    """Every option this domain would reject for a flight (agent publishes its constraint, not just a verdict)."""
    f, out = st.flights[fid], {}
    for g in st.gates:
        for m in ("taxi", "tow"):
            vs = [v for v in check_plan(st, {fid: (g, m, f.ready)}) if v.domain == domain and v.kind != "gate"]
            if vs:
                out[(fid, g, m)] = vs[0].msg
    return out


def review(st, domain, proposal, scope):
    """ATC / PILOT review: objections to the proposal + all options they would veto."""
    objections = [v for v in check_plan(st, proposal) if v.domain == domain]
    banned = {v.key for v in objections}
    for fid in scope:
        banned |= set(vetoes(st, domain, fid))
    return objections, banned


def ground_propose(st, plan, scope, banned):
    """Ground sees gates/tugs only. Greedy: per flight, cheapest option = delay + churn penalty."""
    new = {fid: a for fid, a in plan.items() if fid not in scope}
    for fid in sorted(scope, key=lambda i: st.flights[i].ready):
        f, best = st.flights[fid], None
        for gate in st.gates:
            for method in ("taxi", "tow"):
                if (fid, gate, method) in banned:
                    continue
                for k in range(MAX_WAIT // STEP + 1):
                    start = f.ready + k * STEP
                    cand = {**new, fid: (gate, method, start)}
                    if any(v.domain == "GROUND" for v in check_plan(st, cand)):
                        continue
                    _, arrive, _ = timing(st, f, gate, method, start)
                    churn = 0 if plan.get(fid, (0, 0))[:2] == (gate, method) else CHURN_PENALTY
                    cost = max(0, arrive - f.sched_arrival) + churn
                    if best is None or (cost, gate) < best[0]:
                        best = ((cost, gate), (gate, method, start))
                    break  # earliest feasible start for this gate/method
        if best is None:
            return None
        new[fid] = best[1]
    return new


def fallback(st, plan, scope):
    """Deterministic, no AI: first-come-first-served, taxi only, full constraint check."""
    new = {fid: a for fid, a in plan.items() if fid not in scope}
    for fid in sorted(scope, key=lambda i: st.flights[i].ready):
        f, best = st.flights[fid], None
        for gate in st.gates:
            for k in range(MAX_WAIT // STEP + 1):
                cand = {**new, fid: (gate, "taxi", f.ready + k * STEP)}
                if not check_plan(st, cand):
                    arrive = timing(st, f, gate, "taxi", f.ready + k * STEP)[1]
                    if best is None or arrive < best[0]:
                        best = (arrive, cand[fid])
                    break
        if best is None:
            return None
        new[fid] = best[1]
    return new


def negotiate(st, plan, scope):
    banned = set()
    for rnd in range(1, MAX_ROUNDS + 1):
        proposal = ground_propose(st, plan, scope, banned)
        if proposal is None:
            print(f"  [R{rnd}] GROUND  no candidate left after vetoes")
            return None
        print(f"  [R{rnd}] GROUND  PROPOSE {fmt(proposal, scope)}")
        rejected = False
        for domain in ("ATC", "PILOT"):
            objs, bans = review(st, domain, proposal, scope)
            banned |= bans
            if objs:
                rejected = True
                for o in objs:
                    print(f"  [R{rnd}] {domain:<6} REJECT   {o.msg}")
            else:
                note = f" (vetoes {len(bans)} other option(s))" if bans else ""
                print(f"  [R{rnd}] {domain:<6} ACCEPT{note}")
        if not rejected:
            return proposal
    return None


# ---- driver -----------------------------------------------------------------
def fmt(plan, ids=None):
    return ", ".join(f"{i}:{g}/{m}@{s}" for i, (g, m, s) in plan.items() if ids is None or i in ids)


def run(title, st, plan):
    print(f"\n{'=' * 72}\n{title}\n{'=' * 72}")
    dims, sev, viol = rubric(st, plan)
    for name, (val, lvl) in dims.items():
        print(f"  {name:<32} {val!s:>6}   level {lvl}")
    print(f"  => SEVERITY: {LABELS[sev]}")
    if sev == 0:
        print("  ACTION: none."); return "no action"
    if sev == 1 and not viol:
        print("  ACTION: absorb the delay, keep current plan unchanged, keep monitoring.")
        return "absorbed (0 changes)"
    scope = {v.key[0] for v in viol} if sev == 2 else set(plan)
    print(f"  ACTION: negotiate. Allowed to change: {sorted(scope)}"
          f"{'' if sev == 2 else ' (CRITICAL: whole schedule open)'}")
    result, via = negotiate(st, plan, scope), "negotiation"
    if result is None:
        print("  Negotiation failed -> deterministic fallback (taxi only, FCFS)")
        result, via = fallback(st, plan, scope), "fallback"
    if result is None or check_plan(st, result):   # independent final validation
        print("  No valid plan exists. ESCALATE to human duty manager.")
        for fid in sorted(scope):
            opts = {}
            for dom in ("ATC", "PILOT"):
                opts.update({k: m for k, m in vetoes(st, dom, fid).items()})
            for (_, g, m), msg in sorted(opts.items()):
                print(f"    blocked: {m} to {g} - {msg}")
        print("  Suggested assistance: expedite tug / fuel support for the aircraft, "
              "inspect or clear blocked taxiway. Current plan left untouched.")
        return "ESCALATED to human"
    changed = [i for i in plan if plan[i][:2] != result[i][:2] or plan[i][2] != result[i][2]]
    print(f"  VALIDATED via {via}. Changed: {changed or 'none'}  Unchanged: {sorted(set(plan) - set(changed))}")
    print(f"  NEW PLAN: {fmt(result)}")
    print("  >> AWAITING HUMAN APPROVAL (recommendation only)")
    return f"{via}, {len(changed)} change(s)"


# ---- scenarios (SIMULATED data; swap in a real DOT row for the delay) -------
def base(flights):
    return State(
        flights={f.id: f for f in flights},
        gates={"G1": {"sizes": {"M", "L"}, "busy": [], "ok": True},
               "G2": {"sizes": {"M", "L"}, "busy": [], "ok": True},
               "G3": {"sizes": {"M"}, "busy": [], "ok": True}},
        routes={"G1": {"taxi": 5, "open": True}, "G2": {"taxi": 12, "open": True},
                "G3": {"taxi": 8, "open": True}})


def scenarios():
    s0 = base([Flight("F1", "L", 25, 20, 40, 60, 90, 30),    # ready slipped 15 -> 25
               Flight("F2", "M", 85, 90, 40, 60, 140, 20)])
    p0 = {"F1": ("G1", "taxi", 15), "F2": ("G1", "taxi", 85)}

    s1 = base([Flight("F1", "L", 30, 20, 40, 60, 90, 30),    # ready slipped 15 -> 30
               Flight("F2", "M", 55, 60, 40, 60, 140, 60),
               Flight("F3", "M", 120, 125, 40, 60, 200, 10)])
    s1.gates["G3"]["busy"] = [(0, 70)]
    p1 = {"F1": ("G1", "taxi", 15), "F2": ("G1", "taxi", 55), "F3": ("G2", "taxi", 120)}

    s2 = base([Flight("F4", "M", 0, 5, 40, 11, 120, 40),     # landed, low fuel
               Flight("F7", "M", 100, 112, 40, 60, 200, 10)])
    s2.routes["G1"]["open"] = s2.routes["G3"]["open"] = False
    s2.tug_free_at = 12
    p2 = {"F4": ("G1", "taxi", 0), "F7": ("G2", "taxi", 100)}

    s3 = base([Flight("F5", "M", 0, 5, 40, 6, 120, 80)])     # fuel too low even to wait for tug
    s3.routes["G1"]["open"] = s3.routes["G3"]["open"] = False
    s3.tug_free_at = 30
    p3 = {"F5": ("G1", "taxi", 0)}

    return [("S0  Small slip, plan still valid", s0, p0),
            ("S1  Two flights compete for gate G1", s1, p1),
            ("S2  Blocked taxiway + low fuel (landed) -> tow", s2, p2),
            ("S3  No feasible plan -> human", s3, p3)]


if __name__ == "__main__":
    summary = [(t, run(t, st, pl)) for t, st, pl in scenarios()]
    print(f"\n{'=' * 72}\nSUMMARY")
    for t, r in summary:
        print(f"  {t:<50} {r}")
