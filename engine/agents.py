"""Agent and persona model for the social simulation.

Each agent has an OCEAN personality, an opinion on the central issue, an
emotional valence, an influence score, and a local Memory. Behaviour is fully
deterministic given a random seed, so runs are reproducible (a feature MiroFish
cannot offer because every LLM call is non-deterministic).
"""

from __future__ import annotations

import math
import random

from .memory import Memory


# Candidate social roles with archetype priors. Each role tunes influence,
# base openness and typical stance.
ROLE_PROFILES = {
    "opinion_leader": {"influence": 0.85, "label": "Opinion Leader", "open": 0.55},
    "media":         {"influence": 0.80, "label": "Media",          "open": 0.60},
    "official":      {"influence": 0.70, "label": "Official",       "open": 0.35},
    "expert":        {"influence": 0.60, "label": "Expert",         "open": 0.50},
    "investor":      {"influence": 0.45, "label": "Investor",       "open": 0.50},
    "resident":      {"influence": 0.25, "label": "Resident",       "open": 0.45},
    "student":       {"influence": 0.30, "label": "Student",        "open": 0.60},
    "netizen":       {"influence": 0.20, "label": "Netizen",        "open": 0.50},
    "worker":        {"influence": 0.22, "label": "Worker",         "open": 0.40},
    "analyst":       {"influence": 0.55, "label": "Analyst",        "open": 0.55},
}

# Human-readable names used when the seed does not provide real names.
GENERIC_NAMES = [
    "Aisha", "Budi", "Chen", "Dewi", "Eko", "Fatimah", "Gita", "Hasan",
    "Indah", "Joko", "Kai", "Lina", "Maya", "Nadia", "Omar", "Putri",
    "Qori", "Rizky", "Sari", "Taufik", "Umar", "Vina", "Wawan", "Xiu",
    "Yusuf", "Zara", "Adi", "Bella", "Citra", "Dimas", "Eka", "Fajar",
]


def clamp(x: float, lo: float = -1.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


class Persona:
    """OCEAN personality + social role."""

    def __init__(self, rng: random.Random, role: str = "netizen"):
        profile = ROLE_PROFILES.get(role, ROLE_PROFILES["netizen"])
        self.role = role
        self.role_label = profile["label"]
        # OCEAN traits in [0, 1]
        self.openness = clamp(rng.gauss(profile["open"], 0.15))
        self.conscientiousness = clamp(rng.gauss(0.5, 0.15))
        self.extraversion = clamp(rng.gauss(0.5, 0.18))
        self.agreeableness = clamp(rng.gauss(0.5, 0.15))
        self.neuroticism = clamp(rng.gauss(0.5, 0.18))

    def to_dict(self) -> dict:
        return {
            "role": self.role,
            "role_label": self.role_label,
            "o": round(self.openness, 3),
            "c": round(self.conscientiousness, 3),
            "e": round(self.extraversion, 3),
            "a": round(self.agreeableness, 3),
            "n": round(self.neuroticism, 3),
        }


class Agent:
    def __init__(self, agent_id: str, name: str, role: str, rng: random.Random,
                 influence: float | None = None):
        self.id = agent_id
        self.name = name
        self.persona = Persona(rng, role)
        self.rng = rng
        profile = ROLE_PROFILES.get(role, ROLE_PROFILES["netizen"])
        self.influence = clamp(profile["influence"] if influence is None else influence)
        # opinion on the central issue in [-1, 1]
        self.opinion = 0.0
        # emotional valence in [-1, 1]
        self.valence = 0.0
        self.activity = clamp(0.3 + self.persona.extraversion * 0.6)
        self.memory = Memory()
        self.history: list[float] = []

    # --- behaviour knobs derived from personality --------------------------
    @property
    def confidence_radius(self) -> float:
        """How far away an opinion can be before it is ignored (bounded confidence)."""
        return clamp(0.15 + self.persona.openness * 0.45)

    @property
    def susceptibility(self) -> float:
        """How easily the agent is swayed by neighbours / events."""
        return clamp(0.15 + self.persona.agreeableness * 0.35 - self.persona.conscientiousness * 0.2)

    @property
    def noise(self) -> float:
        """Opinion volatility driven by neuroticism."""
        return 0.005 + self.persona.neuroticism * 0.04

    @property
    def camp(self) -> str:
        if self.opinion > 0.33:
            return "pro"
        if self.opinion < -0.33:
            return "con"
        return "undecided"

    def describe(self) -> str:
        """A specific, human-readable explanation of who this agent is and what
        drives them — shown on each node in the network view."""
        p = self.persona
        traits = []
        if p.openness > 0.65:
            traits.append("open to new ideas")
        elif p.openness < 0.35:
            traits.append("sceptical of change")
        if p.conscientiousness > 0.65:
            traits.append("principled and consistent")
        elif p.conscientiousness < 0.35:
            traits.append("flexible to a fault")
        if p.extraversion > 0.65:
            traits.append("outspoken")
        elif p.extraversion < 0.35:
            traits.append("reserved")
        if p.agreeableness > 0.65:
            traits.append("conciliatory")
        elif p.agreeableness < 0.35:
            traits.append("combative")
        if p.neuroticism > 0.65:
            traits.append("anxious")
        elif p.neuroticism < 0.35:
            traits.append("composed")
        trait_s = ", ".join(traits[:3]) or "even-keeled"
        if self.influence > 0.6:
            inf = "high influence"
        elif self.influence > 0.3:
            inf = "moderate influence"
        else:
            inf = "low influence"
        role = self.persona.role_label.lower()
        article = "an" if role[0] in "aeiou" else "a"
        return f"{self.name} is {article} {role} with {inf} — {trait_s}."

    def snapshot(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "role": self.persona.role,
            "role_label": self.persona.role_label,
            "influence": round(self.influence, 3),
            "opinion": round(self.opinion, 4),
            "valence": round(self.valence, 4),
            "camp": self.camp,
            "personality": self.persona.to_dict(),
            "description": self.describe(),
        }

    def detail(self) -> dict:
        d = self.snapshot()
        d["memory"] = self.memory.to_dict()
        return d

    def __repr__(self) -> str:
        return f"<Agent {self.name} ({self.persona.role_label}) opinion={self.opinion:.2f}>"
