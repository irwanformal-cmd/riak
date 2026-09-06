"""Analysis layer + temporal utility tests (engine/analysis.py, engine/timeutil.py).

Run from the project root:  python3 test_analysis.py
Rules under test: deterministic metrics from real graph data, lossless
seconds-based time, adaptive formatting, and NO fabricated values
(missing data must surface as absent/None, never invented numbers).
"""
from engine import analysis, timeutil as T

passed = []


def check(name, cond):
    assert cond, f"FAIL: {name}"
    passed.append(name)


# ================= temporal formatting (spec cases) =================
CASES = {
    0: "0s", 1: "1s", 59: "59s", 60: "1m", 61: "1m 1s", 138: "2m 18s",
    3599: "59m 59s", 3600: "1h", 3601: "1h 1s", 86399: "23h 59m",
    86400: "1d", 93720: "1d 2h", 604800: "1w", 2592000: "1mo",
    31536000: "1y", 39679200: "1y 3mo",
}
for sec, want in CASES.items():
    check(f"format {sec}s = '{want}'", T.format_duration(sec) == want)
check("offset label", T.format_offset(93720) == "T+1d 2h")
check("days_to_seconds lossless", T.days_to_seconds(21) == 21 * 86400)
check("normalize hours", T.normalize_seconds(2, "h") == 7200)
check("scale seconds", T.choose_scale(1800) == "seconds")
check("scale hours", T.choose_scale(72000) == "hours")
check("scale days", T.choose_scale(20 * 86400) == "days")
check("scale months", T.choose_scale(200 * 86400) == "months")
check("scale years", T.choose_scale(3 * 31536000) == "years")
check("no awkward decimals", all("." not in T.format_duration(s) for s in
      (3, 138, 3601, 93720, 39679200, 123456789)))

# ================= graph analysis =================
WEB = {
    "n_nodes": 6, "n_edges": 6,
    "nodes": [
        {"id": "r0", "text": "root event", "type": "root", "level": 0, "polarity": 0.5, "probability": 1.0},
        {"id": "a", "text": "consequence A", "type": "consequence", "level": 1, "polarity": 0.3, "probability": 0.7},
        {"id": "b", "text": "consequence B", "type": "consequence", "level": 1, "polarity": -0.3, "probability": 0.6},
        {"id": "c", "text": "shared outcome C", "type": "consequence", "level": 2, "polarity": 0.4, "probability": 0.4},
        {"id": "d", "text": "outcome D", "type": "consequence", "level": 2, "polarity": -0.2, "probability": 0.3},
        {"id": "e", "text": "terminal E", "type": "consequence", "level": 3, "polarity": 0.1, "probability": 0.2},
    ],
    "edges": [
        {"source": "r0", "target": "a", "relation": "causes", "weight": 0.7, "delay_days": 2},
        {"source": "r0", "target": "b", "relation": "causes", "weight": 0.6, "delay_days": 2},
        {"source": "a", "target": "c", "relation": "causes", "weight": 0.6, "delay_days": 3},
        {"source": "b", "target": "c", "relation": "causes", "weight": 0.7, "delay_days": 3},
        {"source": "b", "target": "d", "relation": "weakens", "weight": 0.5, "delay_days": 4},
        {"source": "c", "target": "e", "relation": "leads_to", "weight": 0.6, "delay_days": 4},
    ],
}
PRED = {
    "most_likely_chain": ["r0", "b", "c", "e"],
    "confidence": 0.2,
    "feedback_loop": False,
    "timeline": [
        {"id": "r0", "text": "root event", "day": 0},
        {"id": "b", "text": "consequence B", "day": 2},
        {"id": "c", "text": "shared outcome C", "day": 5},
        {"id": "e", "text": "terminal E", "day": 9},
    ],
    "horizon_days": 9,
    "top_outcomes": [{"id": "e", "text": "terminal E", "probability": 0.2}],
}

a = analysis.analyze(WEB, PRED, lang="en")
s = a["stats"]
check("nodes", s["nodes"] == 6)
check("edges", s["edges"] == 6)
check("roots", s["roots"] == 1)
check("terminals", s["terminals"] == 2)          # d, e
check("branching points", s["branching_points"] == 2)   # r0, b
check("convergence points", s["convergence_points"] == 1)  # c
check("max depth", s["max_depth"] == 3)
check("avg depth", s["avg_depth"] == 1.5)
check("components", s["components"] == 1)

hist = {d["level"]: d["count"] for d in a["depth_histogram"]}
check("depth histogram", hist == {0: 1, 1: 2, 2: 2, 3: 1})

br = {b["id"]: b for b in a["branching"]}
check("branching r0", br["r0"]["count"] == 2)
cv = {c["id"]: c for c in a["convergence"]}
check("convergence c has 2 parents", cv["c"]["count"] == 2)
check("convergence parents real ids", {p["id"] for p in cv["c"]["parents"]} == {"a", "b"})

check("longest path length", a["longest_path"]["length"] == 4)
check("longest path ids real", all(i in {n["id"] for n in WEB["nodes"]} for i in a["longest_path"]["node_ids"]))

infl = a["key_nodes"]["influence"]
check("influence ranked", infl[0]["id"] in ("r0", "b") and infl[0]["descendants"] >= 3)

cp = a["critical_path"]
check("critical path from prediction", cp["node_ids"] == ["r0", "b", "c", "e"])
check("critical length", cp["length"] == 4)
check("critical probability real", cp["probability"] == 0.2)
check("critical offsets seconds", cp["offsets_seconds"] == [0, 172800, 432000, 777600])
check("critical span formatted", cp["temporal_span"] == "1w 2d")
check("stability NOT fabricated", cp["stability"] is None)

ts = a["temporal_span"]
check("span seconds", ts["end_seconds"] == 9 * 86400)
check("span duration", ts["duration"] == "1w 2d")
check("span scale", ts["scale"] == "days")
check("timeline offsets", a["timeline"][1]["offset"] == "T+2d")

# no ensemble -> no simulation block (never invented)
check("simulation absent without ensemble", "simulation" not in a)

# with ensemble -> simulation block mirrors engine values exactly
pred2 = dict(PRED)
pred2["ensemble"] = {"runs": 25, "confidence": {"mean": 0.31, "lo": 0.1, "hi": 0.5},
                     "chain_stability": 0.84}
a2 = analysis.analyze(WEB, pred2, lang="en")
check("simulation runs real", a2["simulation"]["runs"] == 25)
check("simulation confidence real", a2["simulation"]["confidence"]["mean"] == 0.31)
check("stability real when present", a2["critical_path"]["stability"] == 0.84)

# structure chains use only real node ids and reach terminals
ids = {n["id"] for n in WEB["nodes"]}
check("structure chains real ids",
      all(c["id"] in ids for sc in a["structure_chains"] for c in sc["chain"]))
check("structure chains end at terminals",
      all(sc["terminal"] in ("d", "e") for sc in a["structure_chains"]))

# markdown export includes analysis and never crashes without prediction
import server  # noqa: E402  (imports only; server not started)
proj = {"name": "fixture", "created": "now", "lang": "en", "web": WEB,
        "result_web": None, "prediction": PRED,
        "report": {"summary": "s", "chain": ["x"], "findings": []}}
md = server._to_markdown(proj)
check("markdown has network analysis", "## Network analysis" in md)
check("markdown has ripple depth", "## Ripple depth" in md)
check("markdown has critical path", "## Critical path" in md)
check("markdown span line", "Duration: 1w 2d" in md)
proj2 = dict(proj); proj2["prediction"] = None
md2 = server._to_markdown(proj2)
check("markdown robust without prediction", "## Network analysis" in md2)
html = server._to_html(proj)
check("html has analysis", "Network analysis" in html and "Ripple depth" in html)
check("html timeline formatted", "T+2d" in html)

print(f"OK ({len(passed)} checks)")
