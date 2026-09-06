"""Deterministic analysis/aggregation layer for the Riak report.

ONE pass over the existing causal web + prediction + ensemble output.
Nothing here invents numbers: every metric is either
  · graph      — counted/derived from nodes/edges/levels
  · simulation — produced by engine predict()/predict_ensemble()
  · timeline   — engine per-edge delays, normalized to seconds
  · derived    — structural walks (strongest-parent chains, reachability)

The causal/prediction engines are untouched; this module only READS.
"""

from __future__ import annotations

from . import timeutil as T


def _index(web: dict):
    nodes = web.get("nodes") or []
    edges = web.get("edges") or []
    by_id = {n["id"]: n for n in nodes}
    children: dict[str, list[dict]] = {}
    parents: dict[str, list[dict]] = {}
    for e in edges:
        if e.get("source") in by_id and e.get("target") in by_id:
            children.setdefault(e["source"], []).append(e)
            parents.setdefault(e["target"], []).append(e)
    return nodes, edges, by_id, children, parents


def _components(nodes, edges) -> int:
    parent = {n["id"]: n["id"] for n in nodes}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for e in edges:
        a, b = e.get("source"), e.get("target")
        if a in parent and b in parent:
            ra, rb = find(a), find(b)
            if ra != rb:
                parent[ra] = rb
    return len({find(x) for x in parent}) if parent else 0


def _descendant_count(start: str, children) -> int:
    seen, stack = set(), [start]
    while stack:
        cur = stack.pop()
        for e in children.get(cur, []):
            t = e["target"]
            if t not in seen:
                seen.add(t)
                stack.append(t)
    return len(seen)


def _longest_chain(nodes, children, by_id) -> list[str]:
    """Structural longest path (cycle-safe DFS with memo)."""
    memo: dict[str, list[str]] = {}

    def dfs(nid: str, active: set) -> list[str]:
        if nid in memo:
            return memo[nid]
        best = [nid]
        for e in children.get(nid, []):
            t = e["target"]
            if t in active or t not in by_id:
                continue
            cand = [nid] + dfs(t, active | {t})
            if len(cand) > len(best):
                best = cand
        memo[nid] = best
        return best

    longest: list[str] = []
    for n in nodes:
        cand = dfs(n["id"], {n["id"]})
        if len(cand) > len(longest):
            longest = cand
    return longest


def _strongest_chain_to(node_id: str, parents, by_id, limit: int = 40) -> list[str]:
    """Root-ward walk along the heaviest incoming edges (the engine's own
    chain semantics, used for tree previews)."""
    chain, cur, seen = [node_id], node_id, {node_id}
    while len(chain) < limit:
        ps = parents.get(cur)
        if not ps:
            break
        best = max(ps, key=lambda e: e.get("weight", 0.5))
        if best["source"] in seen:
            break
        chain.append(best["source"])
        seen.add(best["source"])
        cur = best["source"]
    chain.reverse()
    return chain


def analyze(web: dict, prediction: dict | None = None, lang: str = "en") -> dict:
    nodes, edges, by_id, children, parents = _index(web)
    n = len(nodes)
    out: dict = {"lang": lang, "source": "graph+simulation+timeline"}

    # ------------------------------------------------ network statistics
    roots = [x for x in nodes if x.get("type") == "root"]
    interventions = [x for x in nodes if x.get("type") == "intervention"]
    terminals = [x for x in nodes if not children.get(x["id"])]
    branching = [(x, len(children[x["id"]])) for x in nodes if len(children.get(x["id"], [])) >= 2]
    convergence = [(x, len(parents[x["id"]])) for x in nodes if len(parents.get(x["id"], [])) >= 2]
    levels = [int(x.get("level", 0)) for x in nodes]
    out["stats"] = {
        "nodes": n,
        "edges": len(edges),
        "roots": len(roots),
        "interventions": len(interventions),
        "terminals": len(terminals),
        "branching_points": len(branching),
        "convergence_points": len(convergence),
        "max_depth": max(levels) if levels else 0,
        "avg_depth": round(sum(levels) / n, 2) if n else 0,
        "components": _components(nodes, edges),
    }

    # ------------------------------------------------ ripple depth histogram
    hist: dict[int, int] = {}
    for lv in levels:
        hist[lv] = hist.get(lv, 0) + 1
    out["depth_histogram"] = [{"level": lv, "count": hist[lv]} for lv in sorted(hist)]

    # ------------------------------------------------ branching / convergence
    branching.sort(key=lambda kv: -kv[1])
    convergence.sort(key=lambda kv: -kv[1])
    out["branching"] = [
        {"id": x["id"], "text": x["text"], "count": c,
         "children": [{"id": e["target"], "text": by_id[e["target"]]["text"]}
                      for e in sorted(children[x["id"]], key=lambda e: -e.get("weight", 0.5))[:4]]}
        for x, c in branching[:5]
    ]
    out["convergence"] = [
        {"id": x["id"], "text": x["text"], "count": c,
         "parents": [{"id": e["source"], "text": by_id[e["source"]]["text"]}
                     for e in sorted(parents[x["id"]], key=lambda e: -e.get("weight", 0.5))[:4]]}
        for x, c in convergence[:5]
    ]

    # ------------------------------------------------ key nodes (structural)
    cand = sorted(nodes, key=lambda x: -len(children.get(x["id"], [])))[:20]
    influence = sorted(
        ({"id": x["id"], "text": x["text"], "descendants": _descendant_count(x["id"], children)}
         for x in cand),
        key=lambda d: -d["descendants"],
    )[:5]
    influence = [d for d in influence if d["descendants"] > 0]
    longest = _longest_chain(nodes, children, by_id)
    out["key_nodes"] = {
        "influence": influence,
        "branching": [{"id": x["id"], "text": x["text"], "count": c} for x, c in branching[:5]],
        "convergence": [{"id": x["id"], "text": x["text"], "count": c} for x, c in convergence[:5]],
        "terminals": [{"id": x["id"], "text": x["text"],
                       "probability": round(float(x.get("probability") or 0), 3)}
                      for x in sorted(terminals, key=lambda x: -(x.get("probability") or 0))[:6]],
    }
    out["longest_path"] = {
        "node_ids": longest,
        "texts": [by_id[i]["text"] for i in longest],
        "length": len(longest),
    }

    # ------------------------------------------------ simulation-backed part
    pred = prediction or {}
    chain = pred.get("most_likely_chain") or []
    timeline = pred.get("timeline") or []
    offset_by_id = {}
    for step in timeline:
        off = T.days_to_seconds(step.get("day"))
        offset_by_id[step.get("id")] = off
    out["timeline"] = [
        {"id": s.get("id"), "text": s.get("text", ""),
         "offset_seconds": T.days_to_seconds(s.get("day")),
         "offset": T.format_offset(T.days_to_seconds(s.get("day")))}
        for s in timeline
    ]
    end = out["timeline"][-1]["offset_seconds"] if out["timeline"] else 0
    out["temporal_span"] = {
        "start_seconds": 0,
        "end_seconds": end,
        "duration_seconds": end,
        "duration": T.format_duration(end),
        "scale": T.choose_scale(end),
    }

    if chain:
        out["critical_path"] = {
            "node_ids": [c for c in chain],
            "texts": [by_id[c]["text"] for c in chain if c in by_id],
            "length": len(chain),
            "probability": pred.get("confidence"),
            "offsets_seconds": [offset_by_id.get(c, 0) for c in chain],
            "temporal_span": T.format_duration(offset_by_id.get(chain[-1], 0)),
            "stability": (pred.get("ensemble") or {}).get("chain_stability"),
        }
    out["top_outcomes"] = pred.get("top_outcomes") or []
    out["feedback_loop"] = bool(pred.get("feedback_loop"))
    ens = pred.get("ensemble")
    if ens and isinstance(ens.get("confidence"), dict):
        out["simulation"] = {
            "runs": ens.get("runs"),
            "confidence": ens.get("confidence"),
            "chain_stability": ens.get("chain_stability"),
        }

    # ------------------------------------------------ causal structure preview
    term_sorted = sorted(terminals, key=lambda x: -(x.get("probability") or 0))[:4]
    out["structure_chains"] = [
        {"terminal": x["id"],
         "chain": [{"id": c, "text": by_id[c]["text"]}
                   for c in _strongest_chain_to(x["id"], parents, by_id)]}
        for x in term_sorted
    ]
    out["roots"] = [{"id": x["id"], "text": x["text"]} for x in (roots or interventions)[:4]]
    return out
