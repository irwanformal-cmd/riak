"""Goal backtracking — "How can this happen?"

A goal-oriented reasoning layer ON TOP of the existing causal network. It does
not modify prediction/simulation logic and never touches the stored web: it
consumes a web + a desired outcome and returns a PROPOSAL (hypothesis layer)
that the user explicitly accepts or dismisses.

  forward:  cause → consequences            (engine/causal.py)
  backward: desired outcome → required conditions → possible paths   (here)

Deterministic and offline: backward chaining runs over the engine's existing
qualitative causal layer (_QVAR / _QGRAPH / _VERB_SIGN in engine/causal.py) —
the same signed variable graph used by the mathematical derivation — with
QSIM-style sign propagation. Nothing is fabricated: a chain is only reported
when the knowledge layer supports it, and a connection to the existing network
is only claimed when a generated condition genuinely matches an existing node.
"""

from __future__ import annotations

from . import causal as C

# human-readable labels for the qualitative variables (en / id)
_QVAR_LABEL = {
    "public_transit_usage": ("public transit usage", "penggunaan transportasi umum"),
    "vehicle_traffic": ("vehicle traffic", "lalu lintas kendaraan"),
    "congestion": ("traffic congestion", "kemacetan lalu lintas"),
    "air_pollution": ("air pollution", "polusi udara"),
    "city_debt": ("city debt", "utang kota"),
    "private_operator_revenue": ("private operator revenue", "pendapatan operator swasta"),
    "operating_cost": ("operating cost", "biaya operasional"),
    "ridership": ("transit ridership", "jumlah penumpang"),
    "fare": ("fares", "tarif"),
    "budget": ("public budget", "anggaran publik"),
    "cost_of_living": ("cost of living", "biaya hidup"),
    "public_health": ("public health", "kesehatan masyarakat"),
}

_DIR_WORD = {
    ("en", 1): "increases", ("en", -1): "decreases",
    ("id", 1): "meningkat", ("id", -1): "menurun",
}

_MSG = {
    "existing": {
        "en": "This target already exists in the network — here is how the current causal web leads to it.",
        "id": "Target ini sudah ada di jaringan — beginilah jaringan kausal saat ini mengarah ke sana.",
    },
    "generated": {
        "en": "Proposed prerequisite paths (hypotheses, not predictions). Review, then add or dismiss.",
        "id": "Usulan jalur prasyarat (hipotesis, bukan prediksi). Tinjau, lalu tambahkan atau abaikan.",
    },
    "no_connection": {
        "en": "No strong causal connection to the existing network was found.",
        "id": "Tidak ditemukan hubungan kausal yang kuat dengan jaringan yang ada.",
    },
    "unsupported": {
        "en": "This outcome is outside the current causal knowledge layer, so no honest path can be derived.",
        "id": "Hasil ini di luar lapisan pengetahuan kausal saat ini, sehingga tidak ada jalur yang dapat diturunkan dengan jujur.",
    },
}

# tokens that mark a DESIRED DIRECTION in the target phrase
_DOWN_HINT = ("decrease", "reduce", "cut", "lower", "drop", "less", "turun",
              "menurun", "mengurangi", "berkurang", "rendah", "↓")
_UP_HINT = ("increase", "raise", "grow", "boost", "improve", "more", "naik",
            "meningkat", "meningkatkan", "menaikkan", "tinggi", "↑")


def _tokens(s: str) -> set[str]:
    return {t for t in C._norm(s).split() if len(t) > 2}


def _sim(a: str, b: str) -> float:
    """Token Jaccard + containment boost — deterministic semantic-ish match."""
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return 0.0
    inter = len(ta & tb)
    j = inter / len(ta | tb)
    contain = inter / min(len(ta), len(tb))
    return 0.6 * j + 0.4 * contain


def _desired_sign(text: str, tvar: str) -> int:
    """Which way should the target variable move? Verb clauses first, then hints."""
    for _verb, var, osign in C._verb_objects(text):
        if var == tvar:
            return 1 if osign == "up" else -1
    t = (text or "").lower()
    if any(h in t for h in _DOWN_HINT):
        return -1
    if any(h in t for h in _UP_HINT):
        return 1
    return 1


def _label(var: str, lang: str) -> str:
    pair = _QVAR_LABEL.get(var)
    if pair:
        return pair[0] if lang == "en" else pair[1]
    return var.replace("_", " ")


def _condition_text(var: str, sign: int, lang: str) -> str:
    return f"{_label(var, lang)} {_DIR_WORD[(lang, 1 if sign >= 0 else -1)]}"


def _upstream_paths(web: dict, node_id: str, limit: int = 2) -> list[list[str]]:
    """Strongest root→node causal chains that already exist in the web."""
    nodes = {n["id"]: n for n in web.get("nodes", [])}
    parents: dict[str, list[tuple[str, float]]] = {}
    for e in web.get("edges", []):
        parents.setdefault(e["target"], []).append((e["source"], e.get("weight", 0.5)))
    paths: list[list[str]] = []

    def walk(nid: str, trail: tuple[str, ...]):
        ps = sorted(parents.get(nid, []), key=lambda x: -x[1])
        if not ps or len(paths) >= limit:
            if len(trail) > 1:
                paths.append(list(trail))
            return
        for src, _w in ps[:2]:
            if src in trail or src not in nodes:
                continue
            walk(src, (src,) + trail)

    walk(node_id, (node_id,))
    return paths[:limit]


def _match_existing(web: dict, var: str, cond_text: str) -> dict | None:
    """An existing node genuinely expressing this variable condition, if any."""
    best, best_s = None, 0.0
    for n in web.get("nodes", []):
        if var not in C._vars_in(n.get("text", "")):
            continue
        s = _sim(cond_text, n.get("text", "")) + 0.3   # same variable = strong base
        if s > best_s:
            best, best_s = n, s
    # a node surfaced by the engine's own variable layer is already a strong
    # candidate — paraphrased wording ("kemacetan berubah") must not block the
    # connection, so the bar is lower than free-text similarity
    return best if best and best_s >= 0.45 else None


def goal_backtrack(web: dict, target_text: str, lang: str = "en",
                   max_back: int = 3, max_paths: int = 3) -> dict:
    """Backward reasoning from a desired outcome. Returns a proposal only —
    the web is never modified here."""
    lang = C._lang(lang)
    target_text = (target_text or "").strip()
    max_back = C.clamp_int(max_back, 1, 5)
    max_paths = C.clamp_int(max_paths, 1, 4)
    if not target_text:
        raise ValueError("target is required")
    nodes = web.get("nodes") or []
    if not nodes:
        raise ValueError("project has no causal web")

    out = {"target_text": target_text, "lang": lang}

    # ---------- CASE A: the target already exists in the network ----------
    tvars = C._vars_in(target_text)
    best, best_s = None, 0.0
    for n in nodes:
        s = _sim(target_text, n.get("text", ""))
        if tvars and set(tvars) & set(C._vars_in(n.get("text", ""))):
            s += 0.25
        if s > best_s:
            best, best_s = n, s
    if best is not None and best_s >= 0.72:
        out.update({
            "case": "existing",
            "target_node_id": best["id"],
            "matched_text": best.get("text", ""),
            "upstream_paths": _upstream_paths(web, best["id"]),
            "message": _MSG["existing"][lang],
        })
        return out

    # ---------- CASE B: backward chaining over the qualitative layer ------
    if not tvars:
        out.update({
            "case": "unsupported",
            "paths": [],
            "message": _MSG["unsupported"][lang],
        })
        return out

    tvar = tvars[0]
    desired = _desired_sign(target_text, tvar)

    # reverse BFS on the signed variable graph with QSIM sign propagation
    preds: dict[str, list[tuple[str, int]]] = {}
    for a, e, s in C._QGRAPH:
        preds.setdefault(e, []).append((a, s))

    chains: list[list[tuple[str, int]]] = [[(tvar, desired)]]
    for _depth in range(max_back):
        grew = False
        nxt: list[list[tuple[str, int]]] = []
        for ch in chains:
            last_var, last_sign = ch[-1]
            expanded = False
            for p, s in preds.get(last_var, []):
                if any(v == p for v, _ in ch):
                    continue                    # never loop through a cycle
                nxt.append(ch + [(p, last_sign * s)])
                expanded = True
            if not expanded:
                nxt.append(ch)
            grew = grew or expanded
        chains = nxt
        if not grew:
            break

    # diverse, meaningful paths: longest first, distinct outermost variable
    chains.sort(key=lambda c: -len(c))
    picked, seen_heads = [], set()
    for ch in chains:
        head = ch[-1][0]
        if head in seen_heads and len(picked) >= 1:
            continue
        seen_heads.add(head)
        picked.append(ch)
        if len(picked) >= max_paths:
            break

    max_level = max((n.get("level", 0) for n in nodes), default=0)
    paths, any_connected, path_sigs = [], False, set()
    for pi, chain in enumerate(picked):
        seq = list(reversed(chain))            # prerequisite-first → target last
        conn_node, conn_i = None, -1
        # search from the target outward (target var included): reuse as MUCH
        # of the existing network as possible — if the web already expresses
        # the target variable, the path attaches straight to that node
        for i in range(len(seq) - 1, -1, -1):
            v, sg = seq[i]
            m = _match_existing(web, v, _condition_text(v, sg, lang))
            if m:
                conn_node, conn_i = m, i
                break

        gen = seq[conn_i + 1:]                 # vars still needing generated nodes
        base_level = (conn_node.get("level", 0) if conn_node else max_level)
        pnodes, pedges = [], []
        prev_id = conn_node["id"] if conn_node else None
        for gi, (v, sg) in enumerate(gen[:-1] if len(gen) > 1 else []):
            # intermediate requirements (all but the target variable itself)
            nid = f"g_p{pi}_{gi}"
            pnodes.append({
                "id": nid, "text": _condition_text(v, sg, lang),
                "type": "requirement", "level": base_level + gi + 1,
                "polarity": round(0.4 * (1 if sg > 0 else -1), 2),
                "probability": 0.3, "proposed": True,
                "var": v, "direction": sg,
            })
            if prev_id is not None:
                pedges.append({"source": prev_id, "target": nid,
                               "relation": "enables", "weight": 0.55, "proposed": True})
            prev_id = nid

        tv, tsign = gen[-1] if gen else (tvar, desired)
        target_id = f"g_p{pi}_target"
        pnodes.append({
            "id": target_id, "text": target_text,
            "type": "target", "level": base_level + len(pnodes) + 1,
            "polarity": round(0.5 * (1 if tsign > 0 else -1), 2),
            "probability": 0.35, "proposed": True,
            "var": tv, "direction": tsign,
        })
        if prev_id is not None:
            pedges.append({"source": prev_id, "target": target_id,
                           "relation": "enables", "weight": 0.6, "proposed": True})

        any_connected = any_connected or conn_node is not None
        # collapse paths that degenerate to the same single-hop attachment
        sig = (conn_node["id"] if conn_node else None, len(pnodes))
        if sig in path_sigs:
            continue
        path_sigs.add(sig)
        assumptions = []
        if conn_node is None:
            assumptions.append(_MSG["no_connection"][lang])
        if lang == "en":
            assumptions.append("Qualitative (directional) reasoning — magnitudes are not estimated.")
        else:
            assumptions.append("Penalaran kualitatif (arah hubungan) — besaran tidak diestimasi.")
        paths.append({
            "id": f"path_{pi}",
            "chain": [{"var": v, "direction": sg, "text": _condition_text(v, sg, lang)}
                      for v, sg in seq],
            "nodes": pnodes,
            "edges": pedges,
            "connects_to": conn_node["id"] if conn_node else None,
            "connects_text": conn_node.get("text", "") if conn_node else None,
            "confidence": "plausible" if conn_node else "conditional",
            "assumptions": assumptions,
        })

    out.update({
        "case": "generated",
        "target_var": tvar,
        "desired_direction": desired,
        "connected": any_connected,
        "paths": paths,
        "message": _MSG["generated"][lang] if any_connected
                   else _MSG["generated"][lang] + " " + _MSG["no_connection"][lang],
    })
    return out
