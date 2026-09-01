"""World builder: turn a seed text into a simulated social world.

Without an LLM this uses lightweight rule-based extraction; with an LLM key it
can optionally delegate entity/persona extraction (see engine.llm). The result
is always deterministic given a seed, which keeps runs reproducible.
"""

from __future__ import annotations

import hashlib
import random
import re
import uuid

from .agents import Agent, GENERIC_NAMES, ROLE_PROFILES, clamp

_SENTENCE_RE = re.compile(r"(?<=[.!?。！？\n])\s+")
_QUOTE_RE = re.compile(r"[\u201c\u201d\u2018\u2019\"']([^\"'\u201c\u201d]{3,80})[\u201c\u201d\u2018\u2019\"']")
_TITLE_RE = re.compile(
    r"\b(?:Prof\.?|Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Minister|President|CEO|Director|"
    r"Governor|Mayor|Chairman|Spokesperson|Analyst|Expert)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)"
)
_NAME_RE = re.compile(r"\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)\b")

# Capitalised words that are common nouns / determiners, not people.
_NAME_STOP = {
    "The", "This", "That", "These", "Those", "A", "An", "It", "He", "She", "They",
    "We", "You", "I", "In", "On", "At", "To", "Of", "For", "And", "Or", "But",
    "As", "If", "By", "With", "From", "Into", "After", "Before", "During", "While",
    "When", "Then", "Than", "So", "Because", "Although", "Despite", "However",
    "Meanwhile", "Currently", "Recently", "According", "About", "Over", "Under",
    "Between", "Against", "Without", "Within", "Several", "Some", "Many", "Few",
    "Most", "All", "Both", "Each", "Every", "Any", "No", "One", "Two", "Three",
    "Media", "Student", "Students", "Resident", "Residents", "Local", "Government",
    "Officials", "Official", "Analysts", "Analyst", "Investors", "Investor",
    "Workers", "Worker", "Savers", "Experts", "Expert", "Professor", "Professors",
    "Faculty", "Servants", "Villagers", "Rumors", "Rumours", "Tempers", "Social",
    "Financial", "Online", "Public", "Mayor", "Central", "Bank", "Opposition",
    "Business", "Shop", "Activist", "Leader", "Traders", "Scientist", "Scholar",
    "Spokesperson", "Director", "Minister", "President", "Governor", "Chairman",
    "Its", "Our", "Their", "There", "Here", "Now", "Today", "Yesterday",
    # plural / common nouns that frequently open sentences in news text
    "Religious", "Skeptics", "Civil", "Digital", "Young", "Parents", "Small",
    "Fishermen", "Environmentalists", "Engineers", "Politicians", "Supporters",
    "Opponents", "Citizens", "Healthcare", "Community", "Communities", "Groups",
    "Group", "Users", "People", "Families", "Businesses", "Rights", "Union",
    "Management", "Youth", "Veterans", "Villages", "Factories", "Farmers",
}

_ROLE_HINTS = {
    "opinion_leader": re.compile(r"\b(leader|influencer|celebrity|activist|founder)\b", re.I),
    "media": re.compile(r"\b(media|journalist|reporter|news|press|outlet)\b", re.I),
    "official": re.compile(r"\b(official|government|minister|mayor|governor|authority|policy|regulation)\b", re.I),
    "expert": re.compile(r"\b(expert|professor|scientist|researcher|doctor|academic|scholar)\b", re.I),
    "investor": re.compile(r"\b(investor|market|stock|fund|finance|economy|trade)\b", re.I),
    "student": re.compile(r"\b(student|university|campus|college|school)\b", re.I),
    "worker": re.compile(r"\b(worker|employee|factory|union|labour|labor|job)\b", re.I),
    "resident": re.compile(r"\b(resident|citizen|community|village|city|local|public)\b", re.I),
    "analyst": re.compile(r"\b(analyst|strategist|consultant|advisor)\b", re.I),
}

_STANCE_POS = re.compile(r"\b(support|approve|agree|welcome|benefit|positive|in favor|endorse|celebrate)\b", re.I)
_STANCE_NEG = re.compile(r"\b(oppose|reject|against|protest|criticize|condemn|negative|harm|fear|anger|boycott)\b", re.I)


def _slug(s: str, n: int = 8) -> str:
    return hashlib.sha1(s.encode("utf-8")).hexdigest()[:n]


def _sentences(text: str) -> list[str]:
    parts = _SENTENCE_RE.split(text.strip())
    return [p.strip() for p in parts if p.strip()]


def extract_topic(text: str) -> str:
    """Heuristic central topic from the first meaningful sentence."""
    for s in _sentences(text):
        if len(s) >= 12:
            return s[:160]
    return (text.strip()[:160] or "Untitled scenario")


def _detect_role(sentence: str, rng: random.Random) -> str:
    best, best_score = "netizen", 0
    for role, pat in _ROLE_HINTS.items():
        if pat.search(sentence):
            # longer match => more specific
            score = len(pat.findall(sentence))
            if score > best_score:
                best, best_score = role, score
    if best_score == 0:
        # fall back to a distribution biased toward ordinary citizens
        best = rng.choices(
            ["netizen", "resident", "worker", "student", "analyst"],
            weights=[35, 25, 15, 15, 10],
        )[0]
    return best


def extract_entities(text: str, rng: random.Random, min_agents: int = 8, max_agents: int = 40) -> list[dict]:
    """Return a list of {name, role, stance} extracted from the seed text."""
    found: dict[str, dict] = {}

    def add(name: str, role: str, stance: float):
        name = re.sub(r"\s+", " ", name).strip()
        if not name or len(name) < 2:
            return
        if name not in found:
            found[name] = {"name": name, "role": role, "stance": stance}

    for sentence in _sentences(text):
        stance = 0.0
        if _STANCE_POS.search(sentence):
            stance += 1.0
        if _STANCE_NEG.search(sentence):
            stance -= 1.0
        stance = clamp(stance)

        # quoted speaker -> strong signal
        for m in _QUOTE_RE.finditer(sentence):
            quote = m.group(1)
            q_stance = 0.0
            if _STANCE_POS.search(quote):
                q_stance += 1.0
            if _STANCE_NEG.search(quote):
                q_stance -= 1.0
            add("Voice", _detect_role(sentence, rng), clamp(q_stance or stance))

        # titled persons
        for m in _TITLE_RE.finditer(sentence):
            add(m.group(1), _detect_role(sentence, rng), stance)

        # capitalized proper-noun candidates (skip common sentence-start words)
        for m in _NAME_RE.finditer(sentence):
            name = m.group(1)
            if name in _NAME_STOP or name.split()[0] in _NAME_STOP:
                continue
            add(name, _detect_role(sentence, rng), stance)

    entities = list(found.values())
    # de-duplicate generic "Voice" entries into numbered speakers
    voices = [e for e in entities if e["name"] == "Voice"]
    for i, v in enumerate(voices, 1):
        v["name"] = f"Voice {i}"

    rng.shuffle(entities)
    return entities[:max_agents]


def build_world(seed_text: str, seed: int, config: dict | None = None) -> dict:
    """Construct the simulated world: agents, relationships, facts, topic."""
    config = config or {}
    rng = random.Random(seed)
    n_agents = clamp_int(config.get("agents", 60), 4, 300)
    min_agents = min(n_agents, 8)

    entities = extract_entities(seed_text, rng, min_agents=min_agents, max_agents=n_agents)
    topic = extract_topic(seed_text)

    # overall stance of the source material: drives the padding distribution so
    # scenarios genuinely diverge into support / opposition / polarization.
    pos_hits = len(_STANCE_POS.findall(seed_text))
    neg_hits = len(_STANCE_NEG.findall(seed_text))
    text_slant = clamp((pos_hits - neg_hits) / max(1, pos_hits + neg_hits))

    world_id = uuid.uuid4().hex[:12]
    agents: list[Agent] = []
    used_names: set[str] = set()

    # --- create agents from extracted entities -----------------------------
    for ent in entities[:n_agents]:
        if len(agents) >= n_agents:
            break
        name = ent["name"]
        if name in used_names:
            continue
        used_names.add(name)
        a = Agent(f"a{len(agents):03d}", name, ent["role"], rng)
        # extracted actors hold strong, identifiable convictions
        a.opinion = clamp(ent["stance"] * 0.9 + rng.gauss(0, 0.1))
        a.valence = clamp(ent["stance"] * 0.5 + rng.gauss(0, 0.2))
        a.memory.learn_fact(f"{name} was identified in the source material.")
        agents.append(a)

    # --- pad with archetypal agents if the seed was sparse ------------------
    name_idx = 0
    while len(agents) < n_agents:
        if name_idx < len(GENERIC_NAMES):
            name = GENERIC_NAMES[name_idx]
        else:
            name = f"Person {name_idx - len(GENERIC_NAMES) + 1}"
        name_idx += 1
        if name in used_names:
            continue
        used_names.add(name)
        role = rng.choices(
            list(ROLE_PROFILES.keys()),
            weights=[6, 6, 8, 8, 7, 18, 14, 16, 9, 8],
        )[0]
        a = Agent(f"a{len(agents):03d}", name, role, rng)
        # wider spread + a bias inherited from the overall source stance
        a.opinion = clamp(rng.gauss(text_slant * 0.7, 0.55))
        a.valence = clamp(rng.gauss(text_slant * 0.2, 0.25))
        agents.append(a)

    # --- social graph: small-world + homophily -----------------------------
    relationships: list[dict] = []
    n = len(agents)
    positions = _layout(n, rng)
    opinions = [a.opinion for a in agents]
    edges: dict[tuple, float] = {}

    # ring lattice (Watts–Strogatz style) — denser than a bare ring
    k = 12
    for i in range(n):
        for j in range(1, k // 2 + 1):
            a, b = i, (i + j) % n
            if a == b:
                continue
            key = tuple(sorted((a, b)))
            edges[key] = rng.uniform(0.3, 0.7)

    # random long-range links (small-world shortcuts)
    for i in range(n):
        for _ in range(3):
            if rng.random() < 0.5:
                j = rng.choice([x for x in range(n) if x != i])
                key = tuple(sorted((i, j)))
                if key not in edges:
                    edges[key] = rng.uniform(0.2, 0.6)

    # homophily links: bind each agent to its closest-opinion neighbours,
    # which is what creates the visible clusters in the web.
    for i in range(n):
        sims = sorted((j for j in range(n) if j != i),
                      key=lambda j: abs(opinions[i] - opinions[j]))
        for j in sims[:3]:
            key = tuple(sorted((i, j)))
            if key not in edges:
                edges[key] = rng.uniform(0.55, 0.95)  # strong ties

    for (a, b), w in edges.items():
        relationships.append({
            "source": agents[a].id,
            "target": agents[b].id,
            "weight": round(clamp(w), 3),
            "type": "social",
        })

    # --- extracted facts ---------------------------------------------------
    facts = []
    for s in _sentences(seed_text)[:12]:
        if len(s) > 8:
            facts.append(s[:240])
    for a in agents:
        a.memory.learn_fact(facts[0][:160]) if facts else None

    return {
        "id": world_id,
        "seed": seed,
        "topic": topic,
        "n_agents": n,
        "agents": [a.snapshot() for a in agents],
        "relationships": relationships,
        "positions": positions,
        "facts": facts[:20],
        "_agents": agents,  # runtime-only, stripped before serialization
    }


def _layout(n: int, rng: random.Random) -> list[dict]:
    """Deterministic force-ish ring layout with jitter."""
    import math
    pos = []
    radius = 180
    cx, cy = 200, 200
    for i in range(n):
        ang = (2 * math.pi * i) / n + rng.uniform(-0.08, 0.08)
        r = radius * rng.uniform(0.75, 1.0)
        pos.append({
            "id": f"a{i:03d}",
            "x": round(cx + r * math.cos(ang), 2),
            "y": round(cy + r * math.sin(ang), 2),
        })
    return pos


def clamp_int(v, lo, hi):
    try:
        v = int(v)
    except (TypeError, ValueError):
        v = lo
    return max(lo, min(hi, v))
