#!/usr/bin/env python3
"""Backtest Wanion's predictions against historical scenarios with known outcomes.

Each case in backtests/*.json describes a real historical episode and the kind of
outcome that actually materialised (as keyword alternatives). The engine runs
fully offline (deterministic rule-based mode) and we score:

  - hit@6   : does any of the top-6 predicted outcomes match an expected keyword?
  - Brier   : (1 - p)^2 where p = probability of the best-matching predicted node
              (0 = perfect; lower is better)

Usage:
    python3 backtest.py            # run all cases, print a report table
    python3 backtest.py -v         # also print the matching node per case

This is a reporting tool, not a gate: it always exits 0 unless something crashes.
"""

from __future__ import annotations

import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# force offline mode: backtests must be deterministic and network-free
for var in ("LLM_BASE_URL", "LLM_MODEL_NAME", "LLM_API_KEY"):
    os.environ.pop(var, None)

from engine import causal  # noqa: E402

CASES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "backtests")


def _match_prob(web: dict, patterns: list[str]) -> tuple[float, str]:
    """Highest-probability node whose text matches any expected pattern."""
    best_p, best_t = 0.0, ""
    for n in web["nodes"]:
        if any(re.search(pat, n["text"], re.I) for pat in patterns):
            if n.get("probability", 0.0) > best_p:
                best_p, best_t = n["probability"], n["text"]
    return best_p, best_t


def run_case(case: dict, verbose: bool = False) -> dict:
    lang = case.get("lang", "en")
    web = causal.build_web(case["seed_text"], int(case.get("seed", 42)),
                           case.get("config") or {"branching": 5, "depth": 3, "max_nodes": 300},
                           lang=lang)
    pred = causal.predict(web, lang=lang)
    patterns = case["expect_any"]
    p_exp, match_text = _match_prob(web, patterns)
    top_texts = [o["text"] for o in pred.get("top_outcomes", [])]
    hit = any(re.search(pat, t, re.I) for t in top_texts for pat in patterns)
    brier = (1.0 - p_exp) ** 2
    row = {"name": case["name"], "p_expected": round(p_exp, 3),
           "hit_at_6": hit, "brier": round(brier, 3), "match": match_text}
    if verbose:
        row["top_outcomes"] = top_texts
    return row


def main() -> int:
    verbose = "-v" in sys.argv or "--verbose" in sys.argv
    cases = []
    for fn in sorted(os.listdir(CASES_DIR)):
        if fn.endswith(".json"):
            with open(os.path.join(CASES_DIR, fn), encoding="utf-8") as f:
                cases.append(json.load(f))
    if not cases:
        print("no backtest cases found in", CASES_DIR)
        return 0

    rows = []
    for case in cases:
        try:
            rows.append(run_case(case, verbose=verbose))
        except Exception as exc:  # noqa: BLE001 — report and continue
            rows.append({"name": case.get("name", "?"), "p_expected": 0.0,
                         "hit_at_6": False, "brier": 1.0, "match": f"ERROR: {exc}"})

    print(f"\nWanion backtest — {len(rows)} historical scenario(s), offline rule-based mode\n")
    print(f"{'scenario':<42} {'P(expected)':>11} {'hit@6':>6} {'Brier':>7}")
    print("-" * 70)
    for r in rows:
        print(f"{r['name'][:42]:<42} {r['p_expected']:>11.3f} "
              f"{('yes' if r['hit_at_6'] else 'no'):>6} {r['brier']:>7.3f}")
        if verbose and r.get("match"):
            print(f"{'':<42} └─ {r['match'][:60]}")
    print("-" * 70)
    hits = sum(1 for r in rows if r["hit_at_6"])
    mean_brier = sum(r["brier"] for r in rows) / len(rows)
    print(f"hit@6: {hits}/{len(rows)} ({round(100 * hits / len(rows))}%)   "
          f"mean Brier: {mean_brier:.3f}   (0.0 = perfect, 0.25 = coin flip)\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
