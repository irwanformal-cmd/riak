"""Causal mechanism operators — the mathematical/physical derivation layer.

The LLM is ONLY a proposer: it suggests WHICH mechanism applies and the
parameters/assumptions (often because the seed text carries no numbers). The
ENGINE is the authority: it runs the actual formula against the parent node's
quantitative state and derives the child node's state, its human-readable text,
its edge probability, and the formula to render. This is the math→network
half of the two-way sync (network state → model → calculation → update network).

Every operator is a pure function:

    fn(parent_state: dict, spec: dict, parent: dict) -> dict | None

returning a Derivation:
    {
      "child_state": {...},       # new quantitative state (carried forward = path dependency)
      "child_text":  "...",        # consequence text DERIVED from the numbers
      "probability": float,        # math-derived edge weight (NOT random / NOT LLM-assigned)
      "formula_latex": r"...",     # real formula, for the math panel
      "formula_plain": "...",      # plain-text form
      "uncertainty":  float,       # 0..1; high when inputs are assumed, not measured
      "assumptions":  [str],       # explicit assumptions (spec compliance)
      "mechanism":    str,         # verbal causal mechanism
      "domain":       str,
      "scale":        str,
      "operator":     str,         # which operator produced this
    }

Design rules (spec compliance):
  * Use a model genuinely relevant to the phenomenon; do NOT force a formula
    when there is no valid basis -> fall back to `assumption_based` and MARK
    the uncertainty.
  * Probability is derived from how strongly the parent state drives the
    child, scaled by mechanism confidence and (1 - input uncertainty). A
    deterministic physical law with hard inputs yields a strong link; a
    hand-wavy social assumption yields a weak one. This is what lets math
    steer branching/propagation.
  * When inputs are unavailable, assume explicit numeric defaults and record
    them as assumptions + uncertainty — never silently fabricate precision.
"""

from __future__ import annotations

import math

# physical constants
G = 9.81  # m/s^2

# typical/assumed defaults (always recorded as assumptions + uncertainty)
_DEFAULTS = {
    "speed_kmh": 60.0,        # urban driving, assumed
    "friction_dry": 0.7,      # dry asphalt, assumed
    "friction_wet": 0.4,      # wet asphalt, assumed
    "friction_ice": 0.1,
    "distance_km": 5.0,       # commute, assumed
    "rain_speed_reduction": 0.3,  # rain cuts effective speed by ~30%, assumed
    "reaction_time_s": 1.5,
}


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _prob(mech_confidence: float, uncertainty: float) -> float:
    """Derive an edge weight: mechanism confidence damped by input uncertainty."""
    return round(_clamp(mech_confidence * (1.0 - uncertainty), 0.02, 0.99), 3)


def _kmh_to_ms(kmh: float) -> float:
    return kmh / 3.6


def _ms_to_kmh(ms: float) -> float:
    return ms * 3.6


def _num(v, default=0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return float(default)


def _state_get(state: dict, key: str, default: float, assumptions: list, label: str) -> float:
    """Read a quantitative variable from the parent state; if absent, assume the
    default and record it as an explicit assumption with uncertainty contribution."""
    if key in state and isinstance(state[key], (int, float)):
        return float(state[key])
    assumptions.append(f"{label} = {default} (asumsi, data tidak tersedia)")
    return default


def _pick(parent_state: dict, spec: dict, key: str, default=None):
    """Resolve a condition/parameter preferring the parent's QUANTITATIVE STATE
    (the ground truth — possibly patched by an intervention) over the LLM's
    proposed spec. This is what lets an intervention propagate through the math
    model: a patched parent state overrides the LLM's generic proposal."""
    v = parent_state.get(key)
    if v is not None and isinstance(v, (int, float)):
        return v
    v = spec.get(key)
    if v is not None and isinstance(v, (int, float)):
        return v
    return default


# ----------------------------------------------------------------- operators


def kinetic_braking(parent_state: dict, spec: dict, parent: dict) -> dict | None:
    """Braking distance from kinetic friction: d = v^2 / (2 * mu * g).

    A wet road lowers mu, lengthening the distance — the canonical 'rain ->
    longer braking distance' derivation, not a semantic association."""
    a = []
    v_kmh = _state_get(parent_state, "speed_kmh", _DEFAULTS["speed_kmh"], a, "speed")
    road_wet = bool(_pick(parent_state, spec, "road_wet"))
    mu = _pick(parent_state, spec, "friction_mu",
               _DEFAULTS["friction_wet"] if road_wet else _DEFAULTS["friction_dry"])
    if road_wet:
        mu = _num(mu, _DEFAULTS["friction_wet"])
        a.append("jalan basah -> mu turun (asumsi mu_wet=0.4)")
    v = _kmh_to_ms(v_kmh)
    d = (v * v) / (2.0 * mu * G)  # metres
    uncertainty = 0.25 if a else 0.05
    wet = road_wet
    mu_dry = _DEFAULTS["friction_dry"]
    d_dry = (v * v) / (2.0 * mu_dry * G)
    pct = (d / d_dry - 1.0) * 100.0 if d_dry > 0 else 0.0
    child_state = dict(parent_state)
    child_state["braking_distance_m"] = round(d, 1)
    child_state["friction_mu"] = round(mu, 3)
    child_state["speed_kmh"] = round(v_kmh, 1)
    text = (f"jarak pengereman memanjang ≈ {d:.0f} m ({'jalan basah, ' if wet else ''}"
            f"+{pct:.0f}% vs kering)" if wet else f"jarak pengereman ≈ {d:.0f} m")
    return {
        "child_state": child_state,
        "child_text": text,
        "probability": _prob(0.9, uncertainty),
        "formula_latex": r"d_{\text{brake}}=\frac{v^{2}}{2\,\mu\,g}",
        "formula_plain": f"d = v^2 / (2*mu*g) = {v:.1f}^2 / (2*{mu:.2f}*{G}) = {d:.1f} m",
        "uncertainty": uncertainty,
        "assumptions": a,
        "mechanism": "kinetik gesek: energi kinetik diubah jadi kerja gesek (mg*d)",
        "domain": "physical",
        "scale": "individual",
        "operator": "kinetic_braking",
    }


def wet_road_traction(parent_state: dict, spec: dict, parent: dict) -> dict | None:
    """Wet/icy road reduces friction -> the safe (no-skid) speed drops.

    Derived from v_safe = sqrt(mu * g * d_safe) for a target stopping distance,
    or simply: lower mu -> must lower v. Rain -> safe speed cut."""
    a = []
    v_kmh = _state_get(parent_state, "speed_kmh", _DEFAULTS["speed_kmh"], a, "speed")
    mu = _pick(parent_state, spec, "friction_mu", _DEFAULTS["friction_wet"])
    if mu is None:
        mu = _DEFAULTS["friction_wet"]
    a.append(f"mu basah = {mu} (asumsi)")
    v = _kmh_to_ms(v_kmh)
    # ratio of safe-speed wet vs dry, holding stopping distance constant:
    mu_dry = _DEFAULTS["friction_dry"]
    ratio = math.sqrt(mu / mu_dry) if mu_dry > 0 else 1.0
    v_safe = v * ratio
    reduction = (1.0 - ratio) * 100.0
    child_state = dict(parent_state)
    child_state["friction_mu"] = round(mu, 3)
    child_state["safe_speed_kmh"] = round(_ms_to_kmh(v_safe), 1)
    child_state["road_wet"] = True
    text = (f"traksi turun (mu {mu}); kecepatan aman turun ≈ {reduction:.0f}% "
            f"(≈ {_ms_to_kmh(v_safe):.0f} km/jam)")
    return {
        "child_state": child_state,
        "child_text": text,
        "probability": _prob(0.88, 0.2 if a else 0.05),
        "formula_latex": r"v_{\text{safe}}\propto\sqrt{\mu}\;\Rightarrow\;\Delta v\approx(1-\sqrt{\mu/\mu_0})v",
        "formula_plain": f"v_safe ~ sqrt(mu); ratio=sqrt({mu}/{mu_dry})={ratio:.2f}; -{reduction:.0f}%",
        "uncertainty": 0.2 if a else 0.05,
        "assumptions": a,
        "mechanism": "gesekan menurun di permukaan basah -> batas kecepatan aman turun",
        "domain": "physical",
        "scale": "individual",
        "operator": "wet_road_traction",
    }


def travel_time(parent_state: dict, spec: dict, parent: dict) -> dict | None:
    """Kinematics: t = d / v. Rain cuts effective speed -> travel time up -> arrival later.

    This is the 'aku pergi sekolah telat + hujan -> makin telat' derivation:
    deterministic once a base distance and a rain speed-reduction are assumed."""
    a = []
    d_km = _state_get(parent_state, "distance_km", _DEFAULTS["distance_km"], a, "jarak")
    v_kmh = _state_get(parent_state, "speed_kmh", _DEFAULTS["speed_kmh"], a, "kecepatan")
    reduction = _pick(parent_state, spec, "speed_reduction", _DEFAULTS["rain_speed_reduction"])
    if reduction is None:
        reduction = _DEFAULTS["rain_speed_reduction"]
    a.append(f"reduksi kecepatan hujan = {reduction:.0%} (asumsi)")
    v_eff = v_kmh * (1.0 - reduction)
    if v_eff <= 0:
        return None
    t0 = (d_km / v_kmh) * 60.0  # minutes
    t1 = (d_km / v_eff) * 60.0
    delay = t1 - t0
    child_state = dict(parent_state)
    child_state["travel_time_min"] = round(t1, 1)
    child_state["delay_min"] = round(delay, 1)
    child_state["speed_effective_kmh"] = round(v_eff, 1)
    child_state["speed_reduction"] = round(reduction, 3)
    text = (f"waktu tempuh naik {t0:.0f}→{t1:.0f} menit (telat +{delay:.0f} menit "
            f"karena kecepatan efektif turun ke {v_eff:.0f} km/jam)")
    return {
        "child_state": child_state,
        "child_text": text,
        "probability": _prob(0.92, 0.3 if a else 0.05),
        "formula_latex": r"t=\frac{d}{v_{\text{eff}}},\quad v_{\text{eff}}=v(1-r)",
        "formula_plain": f"t = d/v_eff = {d_km}/{v_eff:.1f} = {t1:.1f} min (delay +{delay:.1f})",
        "uncertainty": 0.3 if a else 0.05,
        "assumptions": a,
        "mechanism": "hujan menurunkan kecepatan efektif -> waktu tempuh naik -> tiba lebih telat",
        "domain": "physical",
        "scale": "individual",
        "operator": "travel_time",
    }


def momentum_transfer(parent_state: dict, spec: dict, parent: dict) -> dict | None:
    """Conservation of momentum for a collision/transfer: p = m*v. A heavier or faster
    body imparts more momentum -> larger impulse on the receiver."""
    a = []
    m = _num(spec.get("mass_kg") or parent_state.get("mass_kg"), 70.0)
    v_kmh = _state_get(parent_state, "speed_kmh", _DEFAULTS["speed_kmh"], a, "kecepatan")
    v = _kmh_to_ms(v_kmh)
    p = m * v  # kg*m/s
    child_state = dict(parent_state)
    child_state["momentum_kgms"] = round(p, 1)
    text = f"momentum P = m·v = {m:.0f}·{v:.1f} = {p:.0f} kg·m/s (impak membesar)"
    return {
        "child_state": child_state,
        "child_text": text,
        "probability": _prob(0.85, 0.25 if a else 0.05),
        "formula_latex": r"p=m\,v",
        "formula_plain": f"p = m*v = {m}*{v:.1f} = {p:.0f}",
        "uncertainty": 0.25 if a else 0.05,
        "assumptions": a,
        "mechanism": "kekekalan momentum: m dan v lebih besar -> impuls lebih besar",
        "domain": "physical",
        "scale": "individual",
        "operator": "momentum_transfer",
    }


def assumption_based(parent_state: dict, spec: dict, parent: dict) -> dict | None:
    """Fallback for phenomena with NO valid quantitative basis (social/behavioral
    without measured variables). Records explicit assumptions and a HIGH
    uncertainty — never fabricates a formula."""
    text = str(spec.get("child_text") or spec.get("text") or "").strip()
    if len(text) < 2:
        return None
    assumptions = list(spec.get("assumptions") or [])
    if not assumptions:
        assumptions.append("tidak ada model kuantitatif yang valid; hubungan berbasis asumsi")
    confidence = _clamp(_num(spec.get("confidence"), 0.5), 0.0, 1.0)
    uncertainty = _clamp(_num(spec.get("uncertainty"), 0.6), 0.0, 1.0)
    # carry forward parent state (path dependency) + apply any declared state changes
    child_state = dict(parent_state)
    for sc in spec.get("state_changes") or []:
        if isinstance(sc, dict) and sc.get("variable"):
            child_state[str(sc["variable"])] = sc.get("to")
    return {
        "child_state": child_state,
        "child_text": text,
        "probability": _prob(confidence, uncertainty),
        "formula_latex": "",  # no fabricated formula — uncertainty is marked instead
        "formula_plain": "(asumsi; tidak ada rumus kuantitatif)",
        "uncertainty": uncertainty,
        "assumptions": assumptions,
        "mechanism": str(spec.get("mechanism") or "asumsi kausal eksplisit"),
        "domain": str(spec.get("domain") or "social"),
        "scale": str(spec.get("scale") or "individual"),
        "operator": "assumption_based",
    }


_OPERATORS = {
    "kinetic_braking": kinetic_braking,
    "wet_road_traction": wet_road_traction,
    "travel_time": travel_time,
    "momentum_transfer": momentum_transfer,
    "assumption_based": assumption_based,
}


def derive(parent: dict, spec: dict) -> dict | None:
    """Dispatch a mechanism spec against a parent node's state. The LLM proposes
    the spec (operator + params + assumptions); the engine computes. Returns a
    Derivation or None if the operator cannot derive a child from the inputs."""
    op = str(spec.get("operator") or spec.get("mechanism_id") or "assumption_based")
    fn = _OPERATORS.get(op, assumption_based)
    parent_state = (parent or {}).get("state") or {}
    try:
        return fn(parent_state, spec, parent or {})
    except Exception:  # noqa: BLE001 — a bad spec must never crash the build
        return None


def init_state(spec: dict) -> dict:
    """Build the initial quantitative state for a SEED node from an LLM/rule spec.
    Seeds carry no numbers, so every value is an explicit assumption."""
    st = {}
    for k, v in (spec.get("initial_state") or {}).items():
        if isinstance(v, (int, float)):
            st[k] = v
    # sensible defaults so physics operators can run even from a bare seed
    st.setdefault("speed_kmh", _DEFAULTS["speed_kmh"])
    st.setdefault("distance_km", _DEFAULTS["distance_km"])
    if spec.get("road_wet"):
        st["road_wet"] = True
        st["friction_mu"] = _DEFAULTS["friction_wet"]
    return st
