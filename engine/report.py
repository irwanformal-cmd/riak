"""Report generator: distill simulation results into a concrete narrative.

The rule-based path is deliberately grounded in the actual numbers, agent names
and events — no generic corporate filler. When an LLM is configured it writes
the summary + recommendations, and the deterministic numeric analysis stays.
"""

from __future__ import annotations

import json

from . import llm
from .simulator import OUTCOME_LABELS


def generate_report(world: dict, result: dict, ensemble: dict | None = None) -> dict:
    timeline = result["timeline"]
    final = result["final"]
    events = result.get("events", [])
    topic = world.get("topic", "this issue")

    start = timeline[0]
    pol_start, pol_end = start["polarization"], final["polarization"]
    outcome = result["outcome"]

    flips = [e for e in events if e["type"] == "leader_flip"]
    interventions = [e for e in events if e["type"] == "intervention"]
    turning = _turning_points(timeline)

    # ---- findings (concrete, named, numbered) -----------------------------
    findings = [
        f"Final split: {final['pro']} support ({final['pro_share']*100:.0f}%), "
        f"{final['con']} oppose ({final['con_share']*100:.0f}%), "
        f"{final['undecided']} undecided ({final['undecided_share']*100:.0f}%).",
        _pol_sentence(pol_start, pol_end),
    ]
    if final.get("top_influencers"):
        findings.append(
            "Most influential: " + ", ".join(final["top_influencers"]) + "."
        )
    for f in flips[:2]:
        findings.append(
            f"Turning point at t={f['t']}: {f['agent']} switched to the {f['camp']} camp "
            f"and pulled their network with them (influence {f['magnitude']:.2f})."
        )
    if not flips:
        tp = turning[0] if turning else None
        if tp:
            findings.append(
                f"The biggest single swing was at t={tp[1]} (mean opinion moved "
                f"{tp[2]:+.2f}); otherwise change was gradual."
            )
        else:
            findings.append("No sharp tipping point — opinion shifted gradually.")

    # ---- phases -------------------------------------------------------------
    phases = _phases(timeline)

    # ---- outcome + ensemble ---------------------------------------------------
    scenario = {"outcome": outcome, "label": OUTCOME_LABELS.get(outcome, outcome)}
    ensemble_block = None
    if ensemble:
        ensemble_block = {
            "runs": ensemble["runs"],
            "distribution": {
                OUTCOME_LABELS.get(k, k): f"{v*100:.0f}%"
                for k, v in sorted(ensemble["outcome_distribution"].items(), key=lambda kv: -kv[1])
            },
            "top_outcome": OUTCOME_LABELS.get(ensemble["top_outcome"], ensemble["top_outcome"]),
            "confidence": ensemble["confidence"],
        }

    # ---- counterfactual ------------------------------------------------------
    counterfactual = None
    if interventions:
        counterfactual = {
            "count": len(interventions),
            "list": [{"t": e["t"], "text": e["text"], "hit": e["hit"], "effect": e.get("effect", 0)} for e in interventions],
            "note": _counterfactual_note(interventions, timeline, final),
        }

    report = {
        "topic": topic,
        "summary": _summary(topic, timeline, final, outcome, flips, turning),
        "findings": findings,
        "phases": phases,
        "events": list(events),
        "scenario": scenario,
        "ensemble": ensemble_block,
        "counterfactual": counterfactual,
        "recommendations": _recommendations(outcome, final, flips),
        "generated_by": "llm" if llm.is_configured() else "rule-based",
    }

    if llm.is_configured():
        report = _llm_enhance(report, world, result)
    return report


# ------------------------------------------------------------------ helpers
def _turning_points(timeline: list[dict]) -> list[tuple]:
    """(magnitude, tick, delta) sorted by biggest single-tick mean-opinion move."""
    pts = []
    for i in range(1, len(timeline)):
        d = timeline[i]["mean_opinion"] - timeline[i - 1]["mean_opinion"]
        pts.append((abs(d), i, d))
    pts.sort(key=lambda x: -x[0])
    return pts


def _pol_sentence(p0, p1) -> str:
    if p1 > p0 + 0.03:
        verb = "hardened"
    elif p1 < p0 - 0.03:
        verb = "eased"
    else:
        verb = "held roughly flat"
    return f"Polarization {verb} ({p0:.2f} → {p1:.2f})."


def _summary(topic, timeline, final, outcome, flips, turning):
    label = OUTCOME_LABELS.get(outcome, outcome)
    m0, m1 = timeline[0]["mean_opinion"], final["mean_opinion"]
    shift = m1 - m0
    if shift > 0.3:
        dirp = "swung hard toward support"
    elif shift > 0.08:
        dirp = "drifted toward support"
    elif shift < -0.3:
        dirp = "swung hard toward opposition"
    elif shift < -0.08:
        dirp = "drifted toward opposition"
    else:
        dirp = "held roughly steady"
    parts = [
        f'Over {len(timeline)} rounds, opinion on "{topic}" {dirp} '
        f"({m0:+.2f} → {m1:+.2f})."
    ]
    parts.append(
        f"By the end: {final['pro_share']*100:.0f}% support, "
        f"{final['con_share']*100:.0f}% oppose, {final['undecided_share']*100:.0f}% undecided."
    )
    if flips:
        f = flips[0]
        parts.append(
            f"The decisive moment was at t={f['t']}, when {f['agent']} flipped to the {f['camp']} camp."
        )
    elif turning:
        parts.append(f"The sharpest move happened at t={turning[0][1]}.")
    parts.append(f"Most likely outcome: {label}.")
    return " ".join(parts)


def _recommendations(outcome, final, flips):
    pro, con, und = final["pro_share"], final["con_share"], final["undecided_share"]
    recs = []
    if outcome == "consensus_support":
        recs.append(
            f"Support is consolidating ({pro*100:.0f}%). Lock it in by acting on the core "
            f"promise now, rather than re-litigating it."
        )
    elif outcome == "consensus_oppose":
        recs.append(
            f"Opposition is consolidating ({con*100:.0f}%). This needs a concrete concession, "
            f"not more messaging."
        )
    elif outcome == "polarized":
        if min(pro, con) < 0.1:
            leader = "Support" if pro > con else "Opposition"
            lshare = max(pro, con)
            recs.append(
                f"{leader} leads at {lshare*100:.0f}% with {und*100:.0f}% undecided — "
                f"it's the undecided bloc, not the rival camp, that will decide this."
            )
        else:
            recs.append(
                f"The public is split {pro*100:.0f}%–{con*100:.0f}%. A compromise aimed at the "
                f"{und*100:.0f}% undecided middle is the only path that avoids a deadlock."
            )
    else:
        recs.append(
            f"With {und*100:.0f}% still undecided, the outcome is open — whoever makes a "
            f"specific, credible offer first wins them."
        )
    if final.get("top_influencers"):
        recs.append(
            f"Keep an eye on {final['top_influencers'][0]} — the most influential voice "
            f"and the one who can still move the middle."
        )
    if flips:
        f = flips[0]
        recs.append(
            f"{f['agent']}'s flip at t={f['t']} shows the debate is volatile; expect further swings."
        )
    return recs[:4]


def _counterfactual_note(interventions, timeline, final):
    """Estimate each intervention's impact by comparing pre/post mean opinion."""
    notes = []
    for inv in interventions:
        t = inv["t"]
        before = next((p for p in timeline if p["t"] <= t), timeline[0])
        after = timeline[-1]
        shift = after["mean_opinion"] - before["mean_opinion"]
        sign = "toward support" if shift > 0.05 else "toward opposition" if shift < -0.05 else "without much net effect"
        notes.append(
            f"'{inv['text']}' at t={t} reached {inv['hit']} agents; from that point the "
            f"mean moved {shift:+.2f} ({sign})."
        )
    return " ".join(notes)


def _phases(timeline: list[dict]) -> list[dict]:
    """Split the run into narrative phases based on the polarization trend."""
    if len(timeline) < 3:
        return []
    phases = []
    a = timeline[0]
    cur = {"start": 0, "end": 0, "trend": "stable", "start_pol": a["polarization"]}
    for t in timeline[1:]:
        dp = t["polarization"] - a["polarization"]
        trend = "rising" if dp > 0.02 else "falling" if dp < -0.02 else "stable"
        if trend != cur["trend"]:
            cur["end"] = a["t"]
            phases.append(_phase_dict(cur, timeline))
            cur = {"start": a["t"], "end": a["t"], "trend": trend, "start_pol": t["polarization"]}
        a = t
    cur["end"] = a["t"]
    phases.append(_phase_dict(cur, timeline))
    return phases


def _phase_dict(cur, timeline):
    s, e = cur["start"], cur["end"]
    seg = [p for p in timeline if s <= p["t"] <= e] or [timeline[-1]]
    label = {
        "rising": "Polarization rising",
        "falling": "De-escalation",
        "stable": "Stable period",
    }[cur["trend"]]
    return {
        "start": s, "end": e, "trend": cur["trend"], "label": label,
        "peak_polarization": round(max(p["polarization"] for p in seg), 3),
    }


def _llm_enhance(report: dict, world: dict, result: dict) -> dict:
    """Ask the LLM for a summary + recommendations grounded in the numbers.

    Instructed explicitly to avoid generic filler and use the specific agents,
    numbers and events that actually happened in this run.
    """
    final = result["final"]
    compact = {
        "topic": world.get("topic"),
        "final": {k: final[k] for k in ("pro_share", "con_share", "undecided_share", "polarization", "sentiment", "mean_opinion")},
        "top_influencers": final.get("top_influencers", []),
        "events": [
            {"t": e.get("t"), "type": e.get("type"), "text": e.get("text")}
            for e in result.get("events", []) if e.get("type") != "viral"
        ][:12],
    }
    prompt = (
        "You are a scenario analyst. Write (1) a 3-4 sentence summary and (2) 3 "
        "recommendations. Rules: be specific — name the actual agents, numbers and "
        "events below; no generic platitudes like \"prioritize dialogue\" or \"address "
        "stakeholder concerns\"; one concrete sentence each. Respond in English.\n\n"
        f"DATA:\n{json.dumps(compact, ensure_ascii=False, indent=2)}"
    )
    text = llm.chat([
        {"role": "system", "content": "You write tight, evidence-based scenario analysis. No filler."},
        {"role": "user", "content": prompt},
    ])
    if text:
        # best-effort split of the LLM answer into summary + recommendations
        report["summary"] = text
        report["generated_by"] = "llm"
    return report


def agent_reply(agent: dict, question: str, topic: str | None = None, events: list | None = None) -> str:
    """Generate an in-character reply for a simulated agent."""
    persona = agent.get("personality", {})
    if llm.is_configured():
        notable = [
            {"t": e.get("t"), "text": e.get("text")}
            for e in (events or [])
            if e.get("type") in ("leader_flip", "consensus", "backlash", "intervention")
        ][-4:]
        prompt = (
            f"You are {agent['name']}, a {agent.get('role_label')}. "
            f"Personality (OCEAN 0-1): {persona}. "
            f"Stance on the issue: {agent.get('opinion', 0.0):+.2f} (-1 oppose, +1 support).\n"
            f"The issue: {topic}\n"
            f"Things you personally witnessed: {json.dumps(notable, ensure_ascii=False)}\n\n"
            f"Answer this question in character, 2-3 sentences, plain spoken language, "
            f"no clichés and no hedging boilerplate.\nQuestion: {question}"
        )
        out = llm.chat([
            {"role": "system", "content": "You are a realistic, specific person inside a social simulation."},
            {"role": "user", "content": prompt},
        ], temperature=0.9)
        if out:
            return out

    # ---- rule-based fallback: grounded in stance + traits + a real event ----
    op = agent.get("opinion", 0.0)
    mag = abs(op)
    if mag > 0.55:
        stance = "strongly support" if op > 0 else "strongly oppose"
    elif mag > 0.2:
        stance = "mostly support" if op > 0 else "mostly oppose"
    else:
        stance = "am still torn on"

    parts = [f"I {stance} it."]
    n = persona.get("n", 0.5)
    a = persona.get("a", 0.5)
    e = persona.get("e", 0.5)
    if n > 0.65:
        parts.append("I won't lie — the back-and-forth has left me on edge.")
    elif a < 0.35:
        parts.append("I'm not going to sugarcoat where I stand.")
    elif a > 0.65:
        parts.append("That said, I do get why the other side disagrees.")
    elif e > 0.65:
        parts.append("I've been talking to everyone I know about this.")

    notable = [ev for ev in (events or [])
               if ev.get("type") in ("leader_flip", "consensus", "backlash", "intervention")]
    if notable:
        ev = notable[-1]
        parts.append(f"The thing I keep coming back to happened at t={ev['t']}: {ev['text'].rstrip('.')}.")
    return " ".join(parts)
