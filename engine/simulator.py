"""The simulation engine.

Implements a hybrid bounded-confidence / social-influence opinion dynamics
model with emotional valence, episodic memory, emergent events, counterfactual
interventions, and ensemble (Monte-Carlo) aggregation. Fully deterministic per
seed and dependency-free.
"""

from __future__ import annotations

import copy
import random
import statistics
import uuid

from .agents import Agent, clamp

OUTCOME_LABELS = {
    "consensus_support": "Consensus — majority support",
    "consensus_oppose": "Consensus — majority opposition",
    "polarized": "Polarized stalemate",
    "stalemate": "Indecisive stalemate",
}


class Simulation:
    def __init__(self, world: dict, config: dict | None = None):
        # deep-copy so a run never mutates the shared world (keeps ensemble runs independent)
        self.world = copy.deepcopy(world)
        self.agents: list[Agent] = self.world["_agents"]
        self.config = config or {}
        self.seed = int(self.config.get("seed", world.get("seed", 0)))
        self.rng = random.Random(self.seed)
        self.rounds = self._int("rounds", 30, 4, 200)
        self.media_bias = clamp(float(self.config.get("media_bias", 0.0)))
        self.interventions = self.config.get("interventions", []) or []
        # build adjacency: agent_id -> [(neighbor_id, weight), ...]
        self.adj: dict[str, list[tuple[str, float]]] = {a.id: [] for a in self.agents}
        id_to_idx = {a.id: i for i, a in enumerate(self.agents)}
        for rel in world.get("relationships", []):
            s, t, w = rel["source"], rel["target"], float(rel.get("weight", 0.5))
            if s in self.adj and t in self.adj:
                self.adj[s].append((t, w))
                self.adj[t].append((s, w))
        self._index = id_to_idx
        self.events: list[dict] = []
        self._camp_history = {a.id: a.camp for a in self.agents}
        self._prev_polarization = 0.0
        self._last_consensus: str | None = None
        self._last_protest = -999

    def _int(self, key, default, lo, hi):
        try:
            v = int(self.config.get(key, default))
        except (TypeError, ValueError):
            v = default
        return max(lo, min(hi, v))

    # ------------------------------------------------------------------ run
    def run(self) -> dict:
        timeline = []
        for t in range(self.rounds):
            self._apply_interventions(t)
            self._step_opinions()
            self._step_valence()
            if self.rng.random() < 0.25:
                self._evolve_network()
            self._detect_events(t)
            timeline.append(self._metrics(t))
        return self._result(timeline)

    # ------------------------------------------------------------- dynamics
    def _step_opinions(self):
        cur = [a.opinion for a in self.agents]
        new = cur[:]
        for i, a in enumerate(self.agents):
            acc_w, acc_o = 0.0, 0.0
            radius = a.confidence_radius
            for (nid, w) in self.adj[a.id]:
                j = self._index.get(nid)
                if j is None:
                    continue
                b = self.agents[j]
                if abs(b.opinion - a.opinion) < radius:
                    weight = w * (0.5 + b.influence)
                    acc_w += weight
                    acc_o += weight * b.opinion
            if acc_w > 0:
                target = acc_o / acc_w
                sus = a.susceptibility * (1.0 - 0.3 * a.influence)
                new[i] = a.opinion + sus * (target - a.opinion)
            # media bias: nudges everyone toward a global slant
            new[i] += self.media_bias * 0.02 * (1.0 - abs(new[i]))
            # individual noise
            new[i] += self.rng.gauss(0.0, a.noise)
            new[i] = clamp(new[i])
        for i, a in enumerate(self.agents):
            a.opinion = new[i]
            a.history.append(new[i])

    def _step_valence(self):
        majority = statistics.fmean(a.opinion for a in self.agents)
        for a in self.agents:
            # agree with the winning side -> feels better
            agree_bonus = 0.2 * a.opinion * majority
            mem_bias = a.memory.valence_bias() * 0.1
            a.valence = clamp(a.valence * 0.7 + agree_bonus + mem_bias + self.rng.gauss(0, 0.05))

    def _evolve_network(self):
        """Rewire a few edges: homophily strengthens, disagreement weakens."""
        rels = self.world["relationships"]
        if not rels:
            return
        idx = self._index
        for _ in range(max(1, len(rels) // 8)):
            rel = self.rng.choice(rels)
            i, j = idx.get(rel["source"]), idx.get(rel["target"])
            if i is None or j is None:
                continue
            gap = abs(self.agents[i].opinion - self.agents[j].opinion)
            delta = (0.3 - gap) * 0.06
            rel["weight"] = round(clamp(rel.get("weight", 0.5) + delta, 0.05, 1.0), 3)

    # -------------------------------------------------------------- events
    def _apply_interventions(self, t: int):
        for inv in self.interventions:
            if int(inv.get("tick", -1)) != t:
                continue
            effect = clamp(float(inv.get("effect", 0.0)), -1.0, 1.0)
            target = (inv.get("target") or "all").strip()
            text = inv.get("text") or f"Intervention: {target}"
            hit = 0
            for a in self.agents:
                if self._match_target(a, target):
                    sus = a.susceptibility
                    a.opinion = clamp(a.opinion + effect * (0.4 + sus))
                    a.valence = clamp(a.valence + effect * 0.4)
                    a.memory.remember(t, "event", text, valence=effect, importance=0.9)
                    hit += 1
            self.events.append({
                "t": t, "type": "intervention", "text": text,
                "effect": effect, "target": target, "hit": hit,
            })

    def _match_target(self, a: Agent, target: str) -> bool:
        t = target.lower()
        if t in ("all", "*", ""):
            return True
        if t in ("pro", "support", "for"):
            return a.camp == "pro"
        if t in ("con", "oppose", "against"):
            return a.camp == "con"
        if t in ("undecided", "neutral"):
            return a.camp == "undecided"
        if t == a.id or t == a.name.lower() or t == a.persona.role or t == a.persona.role_label.lower():
            return True
        return False

    def _detect_events(self, t: int):
        m = self._metrics(t)
        prev_pol = self._prev_polarization
        self._prev_polarization = m["polarization"]

        # opinion-leader flip
        leaders = sorted(self.agents, key=lambda a: -a.influence)[:3]
        for a in leaders:
            prev = self._camp_history.get(a.id, a.camp)
            if prev != a.camp and prev != "undecided" and a.camp != "undecided":
                camp_word = "pro" if a.camp == "pro" else "con"
                self.events.append({
                    "t": t, "type": "leader_flip", "agent": a.name, "camp": camp_word,
                    "text": f"{a.name} ({a.persona.role_label}) switches to the "
                            f"{camp_word} camp, cascading through their network.",
                    "magnitude": a.influence,
                })
                # cascade: mildly pull neighbours
                for (nid, w) in self.adj[a.id]:
                    j = self._index.get(nid)
                    if j is not None:
                        self.agents[j].opinion = clamp(
                            self.agents[j].opinion + (a.opinion - self.agents[j].opinion) * 0.05 * a.influence)
            self._camp_history[a.id] = a.camp

        # polarization onset
        if prev_pol < 0.55 <= m["polarization"] and t > 3:
            self.events.append({
                "t": t, "type": "polarization",
                "text": "Opinions harden: the population splits into two entrenched camps.",
            })

        # consensus
        if m["pro_share"] > 0.62 and self._last_consensus != "pro":
            self.events.append({"t": t, "type": "consensus", "text": "A pro-side consensus is emerging."})
            self._last_consensus = "pro"
        if m["con_share"] > 0.62 and self._last_consensus != "con":
            self.events.append({"t": t, "type": "consensus", "text": "An opposition consensus is emerging."})
            self._last_consensus = "con"

        # protest / backlash risk
        if m["con_share"] > 0.4 and m["sentiment"] < -0.15 and self._last_protest < t - 3:
            self.events.append({"t": t, "type": "backlash",
                                "text": "Growing discontent: protest/backlash risk rises."})
            self._last_protest = t

        # viral post by an active agent
        if self.rng.random() < 0.18:
            a = self.rng.choice(self.agents)
            sign = 1 if a.opinion > 0 else -1
            self.events.append({
                "t": t, "type": "viral", "agent": a.name,
                "text": f"{a.name}'s post goes viral, swaying their followers.",
            })
            for (nid, w) in self.adj[a.id]:
                j = self._index.get(nid)
                if j is not None:
                    self.agents[j].opinion = clamp(self.agents[j].opinion + sign * 0.03 * a.influence)

    # -------------------------------------------------------------- metrics
    def _metrics(self, t: int) -> dict:
        ops = [a.opinion for a in self.agents]
        vals = [a.valence for a in self.agents]
        mean = statistics.fmean(ops)
        std = statistics.pstdev(ops) if len(ops) > 1 else 0.0
        n = len(self.agents)
        pro = sum(1 for a in self.agents if a.camp == "pro")
        con = sum(1 for a in self.agents if a.camp == "con")
        und = n - pro - con
        leaders = sorted(self.agents, key=lambda a: -a.influence)[:5]
        return {
            "t": t,
            "mean_opinion": round(mean, 4),
            "std": round(std, 4),
            "polarization": round(clamp(std / 0.58), 4),
            "sentiment": round(statistics.fmean(vals) if vals else 0.0, 4),
            "pro_share": round(pro / n, 4),
            "con_share": round(con / n, 4),
            "undecided_share": round(und / n, 4),
            "pro": pro, "con": con, "undecided": und,
            "top_influencers": [a.name for a in leaders],
        }

    # -------------------------------------------------------------- result
    def _outcome(self, final: dict) -> str:
        if final["pro_share"] > 0.6:
            return "consensus_support"
        if final["con_share"] > 0.6:
            return "consensus_oppose"
        if final["polarization"] > 0.55:
            return "polarized"
        return "stalemate"

    def _result(self, timeline: list[dict]) -> dict:
        final = timeline[-1]
        return {
            "id": uuid.uuid4().hex[:12],
            "seed": self.seed,
            "rounds": self.rounds,
            "config": {
                "rounds": self.rounds,
                "media_bias": self.media_bias,
                "n_agents": len(self.agents),
            },
            "timeline": timeline,
            "events": self.events,
            "final": final,
            "outcome": self._outcome(final),
            "agents_final": [a.snapshot() for a in self.agents],
            "opinions_history": _pack_history(self.agents, self.rounds),
        }


def _pack_history(agents: list[Agent], rounds: int) -> dict:
    """Compact per-agent opinion history for the replay view."""
    out = {}
    for a in agents:
        if a.history:
            out[a.id] = [round(x, 4) for x in a.history]
    return out


def run_ensemble(world: dict, config: dict | None = None, runs: int = 20) -> dict:
    """Monte-Carlo ensemble: run `runs` simulations with varied seeds and aggregate."""
    config = dict(config or {})
    runs = max(1, min(int(runs or 20), 200))
    base_seed = int(config.get("seed", world.get("seed", 0)))
    series: list[list[dict]] = []
    outcomes: dict[str, int] = {}
    finals: list[dict] = []
    agent_camps: dict[str, dict[str, int]] = {}

    for k in range(runs):
        cfg = dict(config)
        cfg["seed"] = base_seed + k * 7919 + 13
        sim = Simulation(world, cfg)
        res = sim.run()
        series.append(res["timeline"])
        outcomes[res["outcome"]] = outcomes.get(res["outcome"], 0) + 1
        finals.append(res["final"])
        # per-agent possible final camps (for the "possibility fan" in the UI)
        for a in res["agents_final"]:
            bucket = agent_camps.setdefault(a["id"], {"pro": 0, "con": 0, "undecided": 0})
            bucket[a["camp"]] = bucket.get(a["camp"], 0) + 1

    # align lengths
    length = max(len(s) for s in series)
    agg = []
    for t in range(length):
        pts = [s[t] for s in series if t < len(s)]
        agg.append(_aggregate_tick(pts))
    outcome_dist = {k: round(v / runs, 4) for k, v in outcomes.items()}
    return {
        "runs": runs,
        "aggregate_timeline": agg,
        "outcome_distribution": outcome_dist,
        "top_outcome": max(outcomes, key=outcomes.get) if outcomes else "stalemate",
        "confidence": round(max(outcomes.values()) / runs, 4) if outcomes else 0.0,
        "agent_possibilities": agent_camps,
    }


def _aggregate_tick(pts: list[dict]) -> dict:
    def agg(key):
        vals = [p[key] for p in pts]
        return {
            "mean": round(statistics.fmean(vals), 4),
            "lo": round(statistics.fmean(vals) - statistics.pstdev(vals), 4),
            "hi": round(statistics.fmean(vals) + statistics.pstdev(vals), 4),
        }
    return {
        "t": pts[0]["t"],
        "mean_opinion": agg("mean_opinion"),
        "polarization": agg("polarization"),
        "sentiment": agg("sentiment"),
        "pro_share": agg("pro_share"),
        "con_share": agg("con_share"),
        "undecided_share": agg("undecided_share"),
    }
