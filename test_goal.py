"""Goal-backtracking layer tests (engine/goal.py).

Run from the project root:  python3 test_goal.py
The layer must be deterministic, must never modify the web it reads, must
reuse existing nodes instead of duplicating them, and must refuse to fabricate
connections that do not exist.
"""
import copy
import json

from engine import goal

WEB = {
    "nodes": [
        {"id": "n000", "text": "Free public transportation", "type": "root", "level": 0, "polarity": 0.6, "probability": 0.9},
        {"id": "n001", "text": "Transportation cost decreases", "type": "consequence", "level": 1, "polarity": 0.5, "probability": 0.8},
        {"id": "n002", "text": "Public transit usage increases", "type": "consequence", "level": 2, "polarity": 0.6, "probability": 0.7},
        {"id": "n003", "text": "Vehicle traffic decreases", "type": "consequence", "level": 3, "polarity": 0.5, "probability": 0.6},
        {"id": "n004", "text": "Transit ridership grows", "type": "consequence", "level": 2, "polarity": 0.4, "probability": 0.6},
        {"id": "n005", "text": "City debt rises", "type": "consequence", "level": 2, "polarity": -0.5, "probability": 0.5},
    ],
    "edges": [
        {"source": "n000", "target": "n001", "relation": "causes", "weight": 0.8},
        {"source": "n001", "target": "n002", "relation": "causes", "weight": 0.7},
        {"source": "n002", "target": "n003", "relation": "causes", "weight": 0.7},
        {"source": "n002", "target": "n004", "relation": "causes", "weight": 0.6},
        {"source": "n000", "target": "n005", "relation": "causes", "weight": 0.5},
    ],
}

passed = []


def check(name, cond):
    assert cond, f"FAIL: {name}"
    passed.append(name)


# ---- Test 1: target already exists -> no duplicate, upstream path ----------
r = goal.goal_backtrack(WEB, "vehicle traffic decreases", lang="en")
check("existing case", r["case"] == "existing")
check("existing node id", r["target_node_id"] == "n003")
check("no paths generated for existing", not r.get("paths"))
up = r["upstream_paths"][0]
check("upstream ends at target", up[-1] == "n003")
check("upstream starts at root", up[0] == "n000")
check("upstream is a real chain", len(up) >= 3)

# ---- Test 2: new target -> generated, visually distinct, connected ---------
frozen = copy.deepcopy(WEB)
r = goal.goal_backtrack(WEB, "air pollution decreases by 40%", lang="en")
check("generated case", r["case"] == "generated")
check("web untouched", WEB == frozen)
check("connected to network", r["connected"] is True)
p0 = r["paths"][0]
check("connects at deepest reusable node", p0["connects_to"] == "n003")
types = {n["type"] for n in p0["nodes"]}
check("target type present", "target" in types)
check("all generated flagged proposed", all(n.get("proposed") for n in p0["nodes"]))
check("all edges flagged proposed", all(e.get("proposed") for e in p0["edges"]))
check("exactly one target node per path", sum(1 for n in p0["nodes"] if n["type"] == "target") == 1)
check("target keeps user wording", any(n["text"] == "air pollution decreases by 40%" for n in p0["nodes"]))
# chain direction: edges flow connection -> requirement -> target
src_chain = [e["source"] for e in p0["edges"]]
check("edge chain starts at connection", src_chain[0] == "n003")
check("edge chain ends at target", p0["edges"][-1]["target"] == p0["nodes"][-1]["id"])
check("levels grow outward", [n["level"] for n in p0["nodes"]] == sorted(n["level"] for n in p0["nodes"]))
check("assumptions disclosed", len(p0["assumptions"]) >= 1)
check("confidence labelled", p0["confidence"] in ("plausible", "conditional"))

# ---- Test 3: multiple paths when the knowledge layer offers them -----------
r = goal.goal_backtrack(WEB, "public health improves", lang="en")
check("health generated", r["case"] == "generated")
check("multiple paths offered", len(r["paths"]) >= 2)
check("paths connect to existing nodes", all(p["connects_to"] for p in r["paths"]))
check("no fabricated node duplicates existing text",
      all(gen["text"] not in {n["text"] for n in WEB["nodes"]} or gen["type"] == "target"
          for p in r["paths"] for gen in p["nodes"]))

# ---- Test 4: depth control -------------------------------------------------
r2 = goal.goal_backtrack(WEB, "air pollution decreases by 40%", lang="en", max_back=1)
depths = max((len(p["chain"]) for p in r2["paths"]), default=0)
check("max_back respected", depths <= 2)  # 1 hop backward + the target itself

# ---- Test 5: unsupported target -> honest refusal, nothing invented --------
r = goal.goal_backtrack(WEB, "alien spaceship lands downtown", lang="en")
check("unsupported case", r["case"] == "unsupported")
check("no fabricated paths", r["paths"] == [])
check("honest message", "outside the current causal knowledge" in r["message"])

# ---- Test 6: Indonesian ----------------------------------------------------
r = goal.goal_backtrack(WEB, "polusi udara turun 40%", lang="id")
check("id generated", r["case"] == "generated")
texts = " ".join(c["text"] for c in r["paths"][0]["chain"])
check("id phrasing", "polusi udara menurun" in texts and "meningkat" in texts)

# ---- Test 7: determinism ---------------------------------------------------
a = goal.goal_backtrack(WEB, "air pollution decreases by 40%", lang="en")
b = goal.goal_backtrack(WEB, "air pollution decreases by 40%", lang="en")
check("deterministic", json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True))

# ---- Test 8: input validation ----------------------------------------------
try:
    goal.goal_backtrack(WEB, "", lang="en")
    check("empty target rejected", False)
except ValueError:
    check("empty target rejected", True)
try:
    goal.goal_backtrack({"nodes": [], "edges": []}, "x", lang="en")
    check("empty web rejected", False)
except ValueError:
    check("empty web rejected", True)

print(f"OK ({len(passed)} checks)")
