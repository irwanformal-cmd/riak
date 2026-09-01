"""Local episodic + semantic memory for simulated agents.

MiroFish delegates long-term memory to Zep Cloud (an external paid service).
Wanion keeps memory fully local and dependency-free, while preserving the
same conceptual split (episodic events vs. semantic facts) so agent behaviour
can be driven by what an agent has "lived through".
"""

from __future__ import annotations

import time


class Memory:
    """A bounded, priority-ordered episodic buffer plus a semantic fact store."""

    def __init__(self, capacity: int = 120):
        self.capacity = capacity
        self.episodic: list[dict] = []   # {"t","type","text","valence","importance"}
        self.semantic: list[str] = []    # durable facts

    def remember(self, t: int, mtype: str, text: str, valence: float = 0.0, importance: float = 0.5):
        importance = max(0.0, min(1.0, importance))
        valence = max(-1.0, min(1.0, valence))
        self.episodic.append({
            "t": t,
            "type": mtype,
            "text": text,
            "valence": valence,
            "importance": importance,
            "ts": time.time(),
        })
        # keep most important / most recent
        self.episodic.sort(key=lambda m: (m["importance"], m["t"]), reverse=True)
        if len(self.episodic) > self.capacity:
            self.episodic = self.episodic[: self.capacity]

    def learn_fact(self, fact: str):
        fact = fact.strip()
        if fact and fact not in self.semantic:
            self.semantic.append(fact)

    def recent(self, n: int = 6) -> list[dict]:
        return sorted(self.episodic, key=lambda m: -m["t"])[:n]

    def salient_facts(self, n: int = 5) -> list[str]:
        return self.semantic[:n]

    def valence_bias(self) -> float:
        """Net emotional colour of recent memories in [-1, 1]."""
        recent = self.recent(8)
        if not recent:
            return 0.0
        return sum(m["valence"] for m in recent) / len(recent)

    def to_dict(self) -> dict:
        return {
            "episodic": self.episodic[:40],
            "semantic": self.semantic[:40],
        }
