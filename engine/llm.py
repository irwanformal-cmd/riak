"""Optional LLM integration using only the standard library.

Works with any OpenAI-compatible endpoint and a few common auth schemes, so you
can point Riak at OpenAI, DeepSeek, Qwen/DashScope, Ollama, LM Studio, or any
custom provider (including a self-hosted harness).

Configuration can come from two places, merged in priority order:
  1. runtime config (set from the web UI, persisted to data/llm_config.json)
  2. environment variables (see .env.example)

If nothing is configured, every function returns None and Riak transparently
falls back to its deterministic rule-based engine — the app always runs.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import threading
import urllib.request

from . import trajectory

_runtime: dict = {}
_last_error: str = ""

# --------------------------------------------------------------- response cache
# Identical prompts (same model, messages, temperature, reasoning effort) hit the
# provider only once — re-running a seed or rebuilding a web becomes instant and
# free. Persisted to data/llm_cache.json, capped, thread-safe.
_CACHE_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                           "data", "llm_cache.json")
_CACHE_MAX = 500
# RLock, not Lock: chat() holds the lock while calling _cache_load(), which takes
# it again — a plain Lock self-deadlocks the whole server on the first LLM call.
_cache_lock = threading.RLock()
_cache: dict | None = None        # lazy-loaded {key: content}
_cache_stats = {"hits": 0, "misses": 0}


def _cache_load() -> dict:
    global _cache
    with _cache_lock:
        if _cache is None:
            _cache = {}
            try:
                with open(_CACHE_PATH, encoding="utf-8") as f:
                    data = json.load(f)
                if isinstance(data, dict):
                    _cache = data
            except Exception:  # noqa: BLE001 — a corrupt cache just starts empty
                pass
        return _cache


def _cache_save() -> None:
    try:
        os.makedirs(os.path.dirname(_CACHE_PATH), exist_ok=True)
        tmp = _CACHE_PATH + ".tmp"
        # owner-only file: cached prompts can contain private scenario text
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(_cache, f, ensure_ascii=False)
        os.replace(tmp, _CACHE_PATH)
        try:
            os.chmod(_CACHE_PATH, 0o600)
        except OSError:
            pass
    except Exception:  # noqa: BLE001 — caching is best-effort
        pass


def cache_stats() -> dict:
    _cache_load()
    return {"entries": len(_cache or {}), **_cache_stats}


def clear_cache() -> int:
    """Drop all cached responses; returns how many entries were removed."""
    global _cache
    with _cache_lock:
        n = len(_cache_load())
        _cache = {}
        _cache_save()
        return n


def _cache_key(c: dict, messages: list[dict], temperature: float | None,
               max_tokens: int | None) -> str:
    payload = {
        "u": c["base_url"], "m": c["model"], "msgs": messages,
        "t": c["temperature"] if temperature is None else temperature,
        "x": c["max_tokens"] if max_tokens is None else max_tokens,
        "r": c.get("reasoning_effort") or "",
    }
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True)
                          .encode("utf-8")).hexdigest()


def set_runtime_config(cfg: dict | None):
    global _runtime
    _runtime = dict(cfg or {})


def get_last_error() -> str:
    return _last_error


# Reasoning effort levels: how hard the model may think before answering.
# Each level maps to a provider `reasoning_effort` value AND its own per-call
# timeout floor — deeper thinking needs much more time ("max" waits 3 hours).
REASONING_LEVELS = {
    "low":       {"effort": "low",    "timeout": 120.0},
    "medium":    {"effort": "medium", "timeout": 300.0},
    "high":      {"effort": "high",   "timeout": 900.0},
    "extra":     {"effort": "xhigh",  "timeout": 1800.0},
    "max":       {"effort": "xhigh",  "timeout": 10800.0},
    "ultra max": {"effort": "xhigh",  "timeout": 14400.0},
}


def get_config() -> dict:
    """Merged, effective config (runtime overrides environment)."""
    c = dict(_runtime)
    base = c.get("base_url") or os.environ.get("LLM_BASE_URL", "").strip().rstrip("/")
    model = c.get("model") or os.environ.get("LLM_MODEL_NAME", "").strip()
    key = c.get("api_key") or os.environ.get("LLM_API_KEY", "").strip()
    endpoint = c.get("endpoint") or "/chat/completions"
    if not endpoint.startswith("/"):
        endpoint = "/" + endpoint
    try:
        timeout = float(c.get("timeout") or os.environ.get("LLM_TIMEOUT", "60"))
    except (TypeError, ValueError):
        timeout = 60.0
    level = (str(c.get("reasoning_level") or os.environ.get("LLM_REASONING_LEVEL", "")).strip().lower() or None)
    lvl = REASONING_LEVELS.get(level or "")
    return {
        "base_url": base,
        "api_key": key,
        "model": model,
        "endpoint": endpoint,
        "auth_type": c.get("auth_type", "bearer") or "bearer",
        "header_name": c.get("header_name", "").strip(),
        "temperature": float(c.get("temperature", 0.6)),
        "max_tokens": int(c.get("max_tokens", 1024)),
        "timeout": timeout,
        # user-selectable reasoning level: sets the provider reasoning_effort and
        # raises the per-call timeout floor so slow deep thinking can finish.
        "reasoning_level": (level if lvl else None),
        "reasoning_effort": (lvl["effort"] if lvl else (str(c.get("reasoning_effort") or os.environ.get("LLM_REASONING_EFFORT", "")).strip() or None)),
        "level_timeout": (lvl["timeout"] if lvl else None),
    }


def is_configured() -> bool:
    c = get_config()
    return bool(c["base_url"] and c["model"])


def _auth_header(c: dict) -> tuple[str | None, str | None]:
    key = c["api_key"]
    t = c.get("auth_type", "bearer")
    if t == "none" or not key:
        return None, None
    if t == "api-key":
        return (c.get("header_name") or "x-api-key"), key
    return "Authorization", f"Bearer {key}"


def _load_json_strict(text: str) -> dict | None:
    """Parse a provider response that may carry trailing streaming sentinels such as
    'data: [DONE]' after the JSON object (some proxies append them even in non-stream
    mode). Some responses also embed a JSON object inside a string value (e.g. a
    code-fenced JSON in `content`), whose braces must NOT disturb brace tracking — so we
    use json.JSONDecoder.raw_decode(), which is fully string/escape-aware and returns the
    first complete JSON value regardless of any trailing bytes. Returns None if no valid
    JSON value is found."""
    text = (text or "").strip()
    if not text:
        return None
    decoder = json.JSONDecoder()
    start = 0
    # skip any leading non-JSON gunk (streaming prefixes like "data: ")
    while start < len(text):
        try:
            obj, end = decoder.raw_decode(text, start)
            return obj if isinstance(obj, dict) else None
        except json.JSONDecodeError:
            start = text.find("{", start + 1)
            if start < 0:
                return None
    return None


def chat(messages: list[dict], temperature: float | None = None, max_tokens: int | None = None, timeout: float | None = None) -> str | None:
    """Send a chat completion request. Returns text or None on any failure."""
    c = get_config()
    if not c["base_url"]:
        return None
    # short label for the trajectory view: name the operation from the last user message
    last = ""
    for m in reversed(messages or []):
        if isinstance(m, dict) and m.get("role") == "user":
            last = str(m.get("content") or "")[:70]
            break
    detail = f"{last}…" if len(last) >= 70 and last else last
    trajectory.push("llm", detail or "LLM call", model=c.get("model") or "?")
    payload = {
        "model": c["model"],
        "messages": messages,
        "temperature": c["temperature"] if temperature is None else temperature,
        "max_tokens": c["max_tokens"] if max_tokens is None else max_tokens,
    }
    if c.get("reasoning_effort"):
        payload["reasoning_effort"] = c["reasoning_effort"]
    body_url = c["base_url"] + c["endpoint"]
    headers = {"Content-Type": "application/json"}
    name, val = _auth_header(c)
    if name:
        headers[name] = val
    # the selected reasoning level raises the per-call timeout floor — deep
    # thinking (high/max/ultra max) is allowed to run for hours by design.
    eff_timeout = timeout if timeout is not None else c["timeout"]
    if c.get("level_timeout"):
        eff_timeout = max(eff_timeout, c["level_timeout"])

    # cache lookup: identical calls never hit the provider twice
    key = _cache_key(c, messages, temperature, max_tokens)
    with _cache_lock:
        cached = _cache_load().get(key)
    if cached is not None:
        _cache_stats["hits"] += 1
        trajectory.push("llm_done", f"{detail or 'LLM call'} (cached)", model=c.get("model") or "?", ok=True)
        return cached
    _cache_stats["misses"] += 1

    def _send(pl: dict) -> str | None:
        body = json.dumps(pl).encode("utf-8")
        req = urllib.request.Request(body_url, data=body, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=eff_timeout) as resp:
            raw = resp.read().decode("utf-8")
            data = _load_json_strict(raw)
        if not data or not data.get("choices"):
            raise ValueError("provider returned no choices")
        content = (data["choices"][0].get("message", {}).get("content") or "").strip()
        # Some reasoning models put the answer only in `reasoning_content` when the token
        # budget was used up by internal thinking. When content is empty but reasoning
        # exists, surface that reasoning so the caller still has something to use.
        if not content:
            reasoning = (data["choices"][0].get("message", {}) or {}).get("reasoning_content")
            if isinstance(reasoning, str) and reasoning.strip():
                content = reasoning.strip()
        return content or None

    def _store(content: str | None) -> str | None:
        if content:
            with _cache_lock:
                cache = _cache_load()
                if key not in cache:
                    cache[key] = content
                    while len(cache) > _CACHE_MAX:  # FIFO eviction (dicts keep order)
                        cache.pop(next(iter(cache)))
                    _cache_save()
        return content

    try:
        content = _send(payload)
        trajectory.push("llm_done", detail or "LLM call", model=c.get("model") or "?", ok=True)
        return _store(content)
    except Exception as exc:  # noqa: BLE001 — never let LLM failures break the app
        # some providers reject unknown params (reasoning_effort) with a 400 —
        # retry once without it, keeping the level's generous timeout.
        if "reasoning_effort" in payload:
            try:
                content = _send({k: v for k, v in payload.items() if k != "reasoning_effort"})
                trajectory.push("llm_done", detail or "LLM call", model=c.get("model") or "?", ok=True)
                return _store(content)
            except Exception as exc2:  # noqa: BLE001
                exc = exc2
        global _last_error
        _last_error = str(exc)
        trajectory.push("llm_done", f"{detail or 'LLM call'} → {exc}", ok=False)
        print(f"[llm] request failed: {exc}")
        return None


def test() -> str | None:
    """Send a tiny request to verify the configured provider works."""
    return chat([{"role": "user", "content": "Reply with exactly: ok"}], temperature=0, max_tokens=8)


# --------------------------------------------------------------- causal web
_REL_VERB = {
    "en": {"causes": "causes", "leads_to": "leads to", "increases": "increases",
           "decreases": "decreases", "enables": "enables", "prevents": "prevents",
           "weakens": "weakens", "triggers": "triggers"},
    "id": {"causes": "menyebabkan", "leads_to": "mengarah ke", "increases": "meningkatkan",
           "decreases": "menurunkan", "enables": "memungkinkan", "prevents": "mencegah",
           "weakens": "melemahkan", "triggers": "memicu"},
}


def rel_verb(rel: str, lang: str = "en") -> str:
    lang = lang if lang in _REL_VERB else "en"
    return _REL_VERB[lang].get(rel, _REL_VERB["en"].get(rel, "causes"))


def _parse_lines(reply: str, n: int) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for line in reply.splitlines():
        line = re.sub(r"^\s*(?:[-*•\u2022]|\d+[.)])\s*", "", line).strip()
        if not line:
            continue
        line = re.split(r"[.;:]\s", line)[0].strip()
        line = line.strip(" \t\"'")
        key = line.lower()
        if 2 <= len(line) <= 80 and key not in seen:
            seen.add(key)
            out.append(line)
        if len(out) >= n:
            break
    return out


def _parse_scored_lines(reply: str, n: int) -> list[tuple[str, float]] | None:
    """Parse 'consequence | 0.72' lines into (text, conditional likelihood).
    A missing/unreadable likelihood yields None (the caller then decides)."""
    out: list[tuple[str, float | None]] = []
    seen: set[str] = set()
    for line in reply.splitlines():
        raw = re.sub(r"^\s*(?:[-*•\u2022]|\d+[.)])\s*", "", line).strip()
        if not raw:
            continue
        text, sep, tail = raw.partition("|")
        text = re.split(r"[.;:]\s", text.strip())[0].strip(" \t\"'")
        prob = None
        if sep:
            m = re.search(r"(\d+(?:[.,]\d+)?)\s*%?", tail.strip())
            if m:
                try:
                    v = float(m.group(1).replace(",", "."))
                    if "%" in tail or v > 1.0:
                        prob = max(0.02, min(0.99, v / 100.0))
                    else:
                        prob = max(0.02, min(0.99, v))
                except ValueError:
                    prob = None
        key = text.lower()
        if 2 <= len(text) <= 80 and key not in seen:
            seen.add(key)
            out.append((text, prob))
        if len(out) >= n:
            break
    return out or None


# The engine — not the LLM — computes the child's state, probability, and formula
# from the parent's quantitative state. The LLM ONLY PROPOSES which operator applies
# plus its parameters/assumptions. Available operators (mechanics.py):
#   kinetic_braking  - braking distance d=v^2/(2*mu*g)   (params: friction_mu, road_wet)
#   wet_road_traction - wet road lowers mu -> safe speed drops (params: friction_mu, road_wet)
#   travel_time      - t=d/v_eff, rain cuts speed        (params: speed_reduction, road_wet)
#   momentum_transfer - p=m*v                           (params: mass_kg)
#   assumption_based  - NO quantitative basis; explicit assumptions + uncertainty only
_JSON_SCHEMA = (
    '{"outcomes":[{"text":"short 2-7 word phrase","mechanism":"direct causal mechanism",'
    '"operator":"travel_time|kinetic_braking|wet_road_traction|momentum_transfer|assumption_based",'
    '"speed_reduction":0.0,"friction_mu":0.0,"road_wet":false,"mass_kg":0,'
    '"state_changes":[{"variable":"name","from":"value","to":"value"}],'
    '"temporal_relation":"immediate","domain":"physical","scale":"individual",'
    '"uncertainty":0.0,"assumptions":["explicit assumption"],"likelihood":0.0}]}'
)


def _as_prob(v) -> float | None:
    """Coerce a likelihood/confidence to a clamped 0.02..0.99 float, or None."""
    if v is None or isinstance(v, bool):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if f <= 0:
        return None
    if f > 1.0:
        f = f / 100.0  # assume percentage
    return round(max(0.02, min(0.99, f)), 3)


def _as_num(v) -> float | None:
    """Coerce any numeric value to a float, or None. No clamping (keeps raw params)."""
    if v is None or isinstance(v, bool):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return round(f, 4)


def _norm_outcome(o) -> dict | None:
    """Normalize one structured LLM outcome into a canonical candidate dict."""
    if not isinstance(o, dict):
        return None
    text = str(o.get("text") or "").strip()
    if len(text) < 2 or len(text) > 80:
        return None
    mech = str(o.get("mechanism") or "").strip() or None
    sc = o.get("state_changes")
    if isinstance(sc, list):
        sc = [{"variable": str(s.get("variable") or "").strip(),
               "from": s.get("from"), "to": s.get("to")}
              for s in sc if isinstance(s, dict) and s.get("variable")]
        sc = sc or None
    else:
        sc = None
    tr = str(o["temporal_relation"]).strip().lower() if isinstance(o.get("temporal_relation"), str) else None
    dom = str(o.get("domain") or "").strip().lower() or None
    scale = str(o.get("scale") or "").strip().lower() or None
    return {
        "text": text,
        "mechanism": mech,
        "state_changes": sc,
        "temporal_relation": tr,
        "domain": dom,
        "scale": scale,
        "confidence": _as_prob(o.get("confidence")),
        "probability": _as_prob(o.get("likelihood")),
        "operator": (str(o.get("operator") or "").strip().lower() or None),
        "speed_reduction": _as_num(o.get("speed_reduction")),
        "friction_mu": _as_num(o.get("friction_mu")),
        "road_wet": bool(o.get("road_wet")) if o.get("road_wet") is not None else None,
        "mass_kg": _as_num(o.get("mass_kg")),
        "uncertainty": _as_num(o.get("uncertainty")),
        "assumptions": [str(x) for x in o.get("assumptions") or [] if x] or None,
    }


def _flat_candidate(text: str, prob: float | None) -> dict:
    return {"text": text, "probability": prob, "mechanism": None, "state_changes": None,
            "temporal_relation": None, "domain": None, "scale": None, "confidence": None,
            "operator": None, "speed_reduction": None, "friction_mu": None, "road_wet": None,
            "mass_kg": None, "uncertainty": None, "assumptions": None}


def _parse_outcomes(reply: str, n: int) -> list[dict] | None:
    """Parse a single-node expansion reply into candidate dicts (JSON-first,
    flat 'phrase | likelihood' fallback)."""
    data = _extract_json(reply)
    if isinstance(data, dict):
        items = data.get("outcomes") or data.get("events")
        if isinstance(items, list):
            out, seen = [], set()
            for it in items:
                cand = _norm_outcome(it)
                if not cand and isinstance(it, dict) and isinstance(it.get("outcomes"), list):
                    for sub in it["outcomes"]:
                        c2 = _norm_outcome(sub)
                        if c2 and c2["text"].lower() not in seen:
                            seen.add(c2["text"].lower())
                            out.append(c2)
                    continue
                if cand and cand["text"].lower() not in seen:
                    seen.add(cand["text"].lower())
                    out.append(cand)
                if len(out) >= n:
                    break
            if out:
                return out
    # The model clearly tried to emit structured JSON (fenced) but it did not parse —
    # likely truncated by finish_reason=length. Splitting such a body line-by-line yields
    # garbage tokens ("```json", "outcomes", "text"), so refuse instead of polluting the graph.
    if re.search(r"```(?:json)?\s*\{", reply or "", re.I) or (reply or "").lstrip().startswith("{"):
        return None
    lines = _parse_scored_lines(reply or "", n)
    if not lines:
        return None
    return [_flat_candidate(t, p) for t, p in lines]


def _parse_batch_outcomes(reply: str, n_events: int, n: int) -> list[list[dict]] | None:
    """Parse a batched expansion reply into per-event lists of candidate dicts."""
    data = _extract_json(reply)
    if isinstance(data, dict) and isinstance(data.get("events"), list):
        evs = data["events"]
        out: list[list[dict]] = []
        for i in range(n_events):
            bucket: list[dict] = []
            if i < len(evs) and isinstance(evs[i], dict) and isinstance(evs[i].get("outcomes"), list):
                seen = set()
                for it in evs[i]["outcomes"]:
                    c = _norm_outcome(it)
                    if c and c["text"].lower() not in seen:
                        seen.add(c["text"].lower())
                        bucket.append(c)
                        if len(bucket) >= n:
                            break
            out.append(bucket)
        if any(out):
            return out
    # Structured-JSON reply that failed to parse (truncated) -> refuse rather than
    # fall back to garbage line-splitting.
    if re.search(r"```(?:json)?\s*\{", reply or "", re.I) or (reply or "").lstrip().startswith("{"):
        return None
    blocks = _parse_blocks(reply, n_events, n)
    if not blocks:
        return None
    return [[_flat_candidate(t, p) for t, p in b] for b in blocks]


CAUSAL_SPEC = """\
You are RIAK, a physics- and mathematics-constrained causal simulation engine.

YOUR ONLY JOB PER CALL: list the IMMEDIATE plausible next states of the CURRENT node. You answer
ONE question: "Given this exact current state and its history, what can happen NEXT, one causal
step away?" You are NOT building the whole future tree — the engine handles recursion, depth,
branching, and re-simulation across many separate calls.

HARD RULE — ONE-HOP / CAUSAL DISTANCE = 1:
- Generate ONLY consequences that could happen as a DIRECT, immediate result of the CURRENT node.
- NEVER skip steps. If an outcome needs A -> B -> C -> D, from node A you may output only A -> B.
  Do NOT output A -> D. The engine will expand B, then C, then D in later calls.
- If an outcome "is possible but only after several intermediate events exist", DO NOT generate it
  yet — reject it until the engine creates those intermediates.

NO BACKWARD CAUSAL REUSE:
- The ancestor path shown is CONTEXT ONLY — it explains WHY the current node exists and the
  accumulated state/constraints.
- It is NOT a menu of outputs. Do NOT generate consequences of an ancestor or of the overall
  scenario topic. Generate consequences of the CURRENT node only.

DOMAIN LOCK & SCALE LOCK:
- Stay in the current node's domain and scale (e.g. motor / road / traffic / driver -> keep to
  physical state, traction, braking distance, reaction time, travel time, vehicle state, immediate
  safety).
- Do NOT jump to macroeconomic, labor, political, societal, institutional, media, national, or
  global effects unless the CURRENT node DIRECTLY creates those conditions.
- individual -> nearby people -> local -> community -> institution -> regional -> national ->
  global: every scale jump REQUIRES a real causal bridge already present in the graph.

PHYSICS & MATH are hard constraints:
- Physical outcomes obey real-world physics; use F=ma, Ek=1/2*m*v^2, p=m*v, F_friction~=u*N,
  v=dx/dt only when they actually govern the situation.
- Never invent formulas or fake precision. If an exact number is impossible, express uncertainty
  (a lower, qualitative likelihood) instead of fabricating.
- Separate deterministic physical effects (e.g. speed up -> kinetic energy up) from probabilistic
  outcomes (e.g. "a crash occurs").

DYNAMIC PROBABILITY: P(outcome | state, context, history) — conditional, never fixed templates,
never claim certainty. A probability value is NOT a causal relationship: assigning a number never
makes an otherwise-unrelated event valid. Do not emit a likelihood just because every line needs one.

EDGE VALIDATION (apply to every candidate CURRENT -> B before outputting). Ask internally:
  1) can B happen immediately after the current state?  2) is there a DIRECT causal mechanism?
  3) does it depend on an intermediate event?  4) is it caused by the CURRENT node, not an ancestor?
  5) is it consistent with the current physical/temporal/spatial/resource state?  6) is it physically
  and mathematically possible?
Decision: YES + DIRECT -> KEEP.  POSSIBLE BUT REQUIRES AN INTERMEDIATE STATE -> REJECT FOR NOW.
ONLY THEMATICALLY RELATED -> REJECT.  CAUSED BY AN ANCESTOR -> REJECT.  PHYSICALLY/MATHEMATICALLY
IMPOSSIBLE -> REJECT.

MULTIPLE OUTCOMES: give genuinely DIFFERENT possible next states (different futures), not
paraphrases of one outcome.

STATE TRANSITION: every output is a meaningful change CURRENT STATE -> NEXT STATE, never
CURRENT TOPIC -> interesting consequence. If you cannot explain the direct mechanism from the
current node to the outcome, reject it.

ANTI-HALLUCINATION: when uncertain whether an outcome is an immediate consequence, prefer NOT to
generate it. A smaller graph with strong causal validity beats a larger graph of speculative links
— never add a node just to look richer. PRUNING: omit duplicates, causally unsupported, physically
impossible, or absurd outcomes; rare-but-plausible high-impact events are allowed.

OPERATOR PROPOSAL (your main job): for EACH outcome pick the ENGINE operator that derives it, and
supply that operator's parameters + explicit assumptions. You PROPOSE; the engine computes the
actual numbers, state, and probability from the parent's quantitative state. Available operators:
  - "kinetic_braking"    : braking distance d=v^2/(2*mu*g).  params: friction_mu (0..1), road_wet (bool)
  - "wet_road_traction"  : wet road lowers mu -> safe speed drops. params: friction_mu, road_wet
  - "travel_time"        : t=d/v_eff; rain cuts effective speed. params: speed_reduction (0..1), road_wet
  - "momentum_transfer"  : p=m*v. params: mass_kg
  - "assumption_based"   : use ONLY when NO valid quantitative model exists (social/behavioral);
                           then record explicit assumptions + an uncertainty (0..1) and a lower likelihood.
Rules: pick a PHYSICS operator whenever the consequence is genuinely governed by it; do NOT force a
formula onto a phenomenon it does not describe (use assumption_based instead, with high uncertainty).
State any assumed input value in "assumptions" (e.g. "speed=60 km/h assumed") — never fabricate precision.

OUTPUT: reply STRICTLY as ONE JSON object with an "outcomes" array (no prose, no code fence).
Each outcome is an object with keys: text, mechanism, operator (one of the operators above),
speed_reduction, friction_mu, road_wet, mass_kg, state_changes (array of {variable, from, to}),
temporal_relation ("immediate"|"short_term"|"medium_term"|"long_term"|"unknown"), domain, scale,
uncertainty (0..1), assumptions (array of strings), likelihood (0..1). Leave any unknown field null —
never invent values just to fill a field. Only ONE-HOP consequences of the current node — never
recurse, never output a multi-level tree.
"""


def extract_events(text: str, n: int = 4, lang: str = "en") -> list[str] | None:
    """Distill the key events/propositions from a scenario. Returns None offline."""
    if not is_configured():
        return None
    if lang == "id":
        system = ("Anda mengekstrak peristiwa atau proposisi kunci dari sebuah skenario. "
                  "Output hanya frasa peristiwa singkat dan konkret, satu per baris.")
        user = (f"Ekstrak {n} peristiwa/proposisi paling penting dari skenario ini, "
                f"masing-masing frasa singkat dan konkret (2-8 kata):\n\n{text[:1500]}")
    else:
        system = ("You extract the key events or propositions from a scenario. "
                  "Output only short concrete event phrases, one per line.")
        user = (f"Extract the {n} most important events/propositions from this scenario, "
                f"each a short concrete phrase (2-8 words):\n\n{text[:1500]}")
    msgs = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    reply = chat(msgs, temperature=0.3, max_tokens=1500, timeout=120.0)
    out = _parse_lines(reply or "", n) if reply else None
    if not out and reply is not None:  # reasoning model may have truncated
        reply = chat(msgs, temperature=0.3, max_tokens=2500, timeout=150.0)
        out = _parse_lines(reply or "", n) if reply else None
    return out or None


def causal_expand(event: str, n: int = 5, lang: str = "en", context: str | None = None) -> list[dict] | None:
    """Propose plausible IMMEDIATE causal next-states of `event` as candidate dicts
    (text, mechanism, state_changes, temporal_relation, domain, scale, likelihood).
    `context` is the node's causal ancestry (path dependency). None offline."""
    if not is_configured():
        return None
    path = context.strip() if context and context.strip() else ""
    if lang == "id":
        fmt = ("Hasilkan tepat %d kemungkinan state BERIKUTNYA (one-hop) dari node di bawah, "
               "dalam bahasa Indonesia. Jawab STRICT satu objek JSON persis seperti:\n%s\n"
               "text & mechanism dalam bahasa Indonesia. mechanism harus mekanisme kausal LANGSUNG "
               "dari node ini (bukan dari ancestor/topik). Field tak-diketahui pakai null. "
               "Jangan mengarang angka. Hanya satu langkah kausal." % (n, _JSON_SCHEMA))
        user = (f"{fmt}\n\n"
                + (f"Riwayat (hanya konteks, BUKAN daftar output): {path}\n" if path else "Node ini peristiwa baru (seed).\n")
                + f"Node yang dikembangkan (hanya state BERIKUTNYA): {event}")
    else:
        fmt = ("Propose exactly %d plausible IMMEDIATE next states (one-hop) of the node below, in "
               "English. Reply STRICTLY as ONE JSON object exactly like:\n%s\n"
               "mechanism must be the DIRECT causal mechanism from THIS node (not an ancestor or the "
               "general topic). Leave unknown fields null. Never invent numbers. One causal step only."
               % (n, _JSON_SCHEMA))
        user = (f"{fmt}\n\n"
                + (f"History (context only, NOT outputs to reuse): {path}\n" if path else "This node is a new seed event.\n")
                + f"Node to expand (generate its NEXT states only): {event}")
    msgs = [{"role": "system", "content": CAUSAL_SPEC}, {"role": "user", "content": user}]
    reply = chat(msgs, temperature=0.5, max_tokens=4000, timeout=150.0)
    out = _parse_outcomes(reply or "", n) if reply else None
    if not out and reply is not None:  # reasoning model may have truncated the JSON body
        reply = chat(msgs, temperature=0.5, max_tokens=7000, timeout=180.0)
        out = _parse_outcomes(reply or "", n) if reply else None
    return out


def batch_expand(events: list[str], n: int = 5, lang: str = "en", contexts: list[str] | None = None) -> list[list[dict]] | None:
    """Expand several events in ONE call. Returns per-event lists of candidate dicts
    (text, mechanism, state_changes, temporal_relation, domain, scale, likelihood).
    `contexts` (aligned with `events`) carries each node's causal ancestry."""
    if not is_configured() or not events:
        return None
    rows = [(i + 1, (contexts[i].strip() if contexts and i < len(contexts) and contexts[i] else ""), e)
            for i, e in enumerate(events)]
    json_example = ('{"events":[{"outcomes":[{"text":"short phrase","mechanism":"direct mechanism",'
                    '"operator":"travel_time|kinetic_braking|wet_road_traction|momentum_transfer|assumption_based",'
                    '"speed_reduction":0.3,"friction_mu":0.4,"road_wet":true,"mass_kg":0,'
                    '"state_changes":[{"variable":"name","from":"value","to":"value"}],'
                    '"temporal_relation":"immediate","domain":"physical","scale":"individual",'
                    '"uncertainty":0.3,"assumptions":["explicit assumption"],"likelihood":0.7}]}]}')
    NL = chr(10)
    if lang == "id":
        fmt = (("Untuk tiap peristiwa bernomor, hasilkan tepat %d state BERIKUTNYA (one-hop) dalam "
                "bahasa Indonesia. Jawab STRICT satu objek JSON persis seperti:" + NL + "%s" + NL +
                "mechanism = mekanisme kausal LANGSUNG dari node itu (bukan ancestor/topik). "
                "Field tak-diketahui null. Jangan mengarang angka. Hanya satu langkah kausal.")
               % (n, json_example))
        body = NL.join(f"{i}. [riwayat, hanya konteks: {c}] kembangkan state BERIKUTNYA dari: {e}" if c
                       else f"{i}. [peristiwa baru] kembangkan state BERIKUTNYA dari: {e}" for i, c, e in rows)
        user = fmt + NL + NL + "Peristiwa:" + NL + body
    else:
        fmt = (("For each numbered event, propose exactly %d IMMEDIATE next states (one-hop) in "
                "English. Reply STRICTLY as ONE JSON object exactly like:" + NL + "%s" + NL +
                "mechanism = the DIRECT causal mechanism from THAT node (not an ancestor or topic). "
                "Leave unknown fields null. Never invent numbers. One causal step only.")
               % (n, json_example))
        body = NL.join(f"{i}. [history, context only: {c}] expand NEXT state of: {e}" if c
                       else f"{i}. [new seed] expand NEXT state of: {e}" for i, c, e in rows)
        user = fmt + NL + NL + "Events:" + NL + body
    msgs = [{"role": "system", "content": CAUSAL_SPEC}, {"role": "user", "content": user}]
    mt = 3500 + n * 500 * len(events)
    reply = chat(msgs, temperature=0.5, max_tokens=mt, timeout=180.0)
    blocks = _parse_batch_outcomes(reply or "", len(events), n) if reply else None
    # reasoning models (e.g. glm-5.2) sometimes spend the token budget on internal
    # reasoning and emit a truncated JSON body -> parse fails. That is transient, not a
    # hard failure: retry once with a larger budget instead of tripping the engine's
    # circuit breaker and silently falling back to rule-based output.
    if (blocks is None or any(not b for b in blocks)) and reply is not None:
        reply = chat(msgs, temperature=0.5, max_tokens=mt + 3000, timeout=240.0)
        blocks = _parse_batch_outcomes(reply or "", len(events), n) if reply else None
    if blocks is None or any(not b for b in blocks):
        return None
    return blocks




def _parse_blocks(reply: str, n_events: int, n: int) -> list[list[tuple[str, float]]] | None:
    """Parse a batched scored reply into one list of (text, likelihood) per event."""
    blocks: list[list[tuple[str, float | None]]] = [[] for _ in range(n_events)]
    cur = -1
    for line in reply.splitlines():
        s = line.strip()
        if not s:
            continue
        m = re.match(r"^(?:EVENT|PERISTIWA)\s+(\d+)\s*:?", s, re.I)
        if m:
            cur = int(m.group(1)) - 1
            continue
        m2 = re.match(r"^(\d+)[.)]\s*$", s)
        if m2 and 0 <= int(m2.group(1)) - 1 < n_events:
            cur = int(m2.group(1)) - 1
            continue
        item = re.sub(r"^\s*(?:[-*\u2022]|\d+[.)])\s*", "", s).strip()
        if item and 0 <= cur < n_events:
            text, sep, tail = item.partition("|")
            text = text.strip()
            prob = None
            if sep:
                m3 = re.search(r"(\d+(?:[.,]\d+)?)\s*%?", tail.strip())
                if m3:
                    try:
                        v = float(m3.group(1).replace(",", "."))
                        if "%" in tail or v > 1.0:
                            prob = max(0.02, min(0.99, v / 100.0))
                        else:
                            prob = max(0.02, min(0.99, v))
                    except ValueError:
                        prob = None
            blocks[cur].append((text, prob))
    out: list[list[tuple[str, float]]] = []
    for b in blocks:
        seen: set[str] = set()
        r: list[tuple[str, float]] = []
        for text, prob in b:
            key = text.lower()
            if key in seen:
                continue
            seen.add(key)
            r.append((text, prob))
            if len(r) >= n:
                break
        out.append(r)
    return out if all(out) else None


def explain_node(node_text: str, causes: list[tuple[str, str]], effects: list[tuple[str, str]], lang: str = "en") -> str | None:
    """Explain why a node exists. `causes`/`effects` are (text, relation) pairs.
    None offline."""
    if not is_configured():
        return None
    if lang == "id":
        cause_str = "; ".join(f"{t} ({rel_verb(r, 'id')})" for t, r in causes) or "skenario awal"
        effect_str = "; ".join(f"{t} ({rel_verb(r, 'id')})" for t, r in effects) or "belum diketahui"
        system = ("Anda menjelaskan hubungan sebab-akibat dengan jelas dan konkret, "
                  "berlandaskan mekanisme nyata. Jika ada besaran atau efek fisik (kecepatan, "
                  "jarak, waktu, biaya, energi, gesekan), sebutkan fisika/matematika yang "
                  "menentukan (mis. energi kinetik sebanding dengan kuadrat kecepatan, jarak "
                  "pengereman, gesekan, momentum, hitungan anggaran), nyatakan asumsi yang Anda "
                  "gunakan, dan pisahkan dengan tegas yang pasti (deterministik) dari yang sekadar "
                  "mungkin (probabilistik). Jangan pernah menyatakan kepastian untuk hasil yang "
                  "tidak pasti.")
        user = (f"Jelaskan dalam 2-4 kalimat bagaimana peristiwa ini masuk ke dalam rantai "
                f"sebab-akibat, mekanisme logisnya, dan mengapa itu masuk akal.\n\n"
                f"Peristiwa: {node_text}\n\n"
                f"Disebabkan oleh: {cause_str}\nBerujung pada: {effect_str}")
    else:
        cause_str = "; ".join(f"{t} ({rel_verb(r, 'en')})" for t, r in causes) or "the initial scenario"
        effect_str = "; ".join(f"{t} ({rel_verb(r, 'en')})" for t, r in effects) or "unknown"
        system = ("You explain causal relationships clearly and concretely, grounded in the real "
                  "mechanism. When quantities or physical effects are involved (speed, distance, "
                  "time, cost, energy, friction), name the determining physics or math (e.g. "
                  "kinetic energy scales with the square of speed, braking distance, friction, "
                  "momentum, budget arithmetic), state the assumption you rely on, and clearly "
                  "separate what is deterministic from what is merely likely. Never claim "
                  "certainty for an uncertain outcome.")
        user = (f"Explain in 2-4 sentences how this event fits in the causal chain, the "
                f"logical mechanism, and why it is plausible.\n\n"
                f"Event: {node_text}\n\n"
                f"Caused by: {cause_str}\nLeads to: {effect_str}")
    reply = chat([{"role": "system", "content": system}, {"role": "user", "content": user}],
                 temperature=0.5, max_tokens=300, timeout=10.0)
    return reply or None


# ------------------------------------------------------- network co-development
def build_subtree(root_text: str, topic: str, depth: int, branching: int,
                  lang: str = "en") -> dict | None:
    """TURBO path: generate a root event's ENTIRE cause→effect subtree in ONE call
    (nested JSON, `depth` levels, up to `branching` children per node) instead of
    one call per level. The engine still validates/normalizes every node; this
    only changes how many round-trips the model needs. Returns the parsed tree
    dict or None on failure (caller falls back to rule-based expansion)."""
    if not is_configured():
        return None
    schema = ('{"text":"root","children":[{"text":"short consequence phrase",'
              '"mechanism":"direct causal mechanism","likelihood":0.7,'
              '"polarity":-0.5,"relation":"causes","children":[...]}]}')
    if lang == "id":
        user = (f"Bangun pohon sebab→akibat LENGKAP untuk peristiwa akar berikut: "
                f"{depth} level ke dalam, maksimal {branching} anak per node, dalam bahasa Indonesia.\n\n"
                f"Peristiwa akar: {root_text}\nKonteks skenario: {topic}\n\n"
                f"Jawab STRICT satu objek JSON bersarang persis seperti:\n{schema}\n\n"
                f"Aturan: frasa singkat dan konkret; tiap anak HARUS akibat langsung dari "
                f"induknya; likelihood 0-1; polarity -1 (buruk) s/d 1 (baik); relation salah "
                f"satu dari causes|amplifies|reduces|prevents|triggers; lebih sedikit anak "
                f"tidak apa-apa jika ragu; capai {depth} level penuh.")
    else:
        user = (f"Build a COMPLETE cause→effect tree for the root event below: {depth} levels "
                f"deep, at most {branching} children per node.\n\n"
                f"Root event: {root_text}\nScenario context: {topic}\n\n"
                f"Reply STRICTLY as ONE nested JSON object exactly like:\n{schema}\n\n"
                f"Rules: short concrete phrases; every child MUST be a DIRECT consequence of "
                f"its parent; mechanism = the DIRECT causal mechanism from its parent; "
                f"likelihood 0-1; polarity -1 (bad) to 1 (good); relation one of "
                f"causes|amplifies|reduces|prevents|triggers; fewer children is fine when "
                f"uncertain; reach the full {depth} levels.")
    reply = chat([{"role": "system", "content": "You are RIAK, a causal simulation engine. Output STRICT JSON only."},
                  {"role": "user", "content": user}],
                 temperature=0.4, max_tokens=6000, timeout=180.0)
    if not reply:
        return None
    data = _extract_json(reply)
    if isinstance(data, dict) and isinstance(data.get("children"), list):
        return data
    return None


def _extract_json(text: str):
    """Best-effort: pull a JSON object out of an LLM reply.
    Uses json.JSONDecoder.raw_decode so braces inside string values (e.g. a JSON object
    fenced in `content`) do not corrupt parsing; also tolerant of trailing bytes."""
    text = (text or "").strip()
    if not text:
        return None
    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", text, re.I)
    if m:
        text = m.group(1).strip()
    decoder = json.JSONDecoder()
    start = text.find("{")
    while 0 <= start < len(text):
        try:
            obj, _end = decoder.raw_decode(text, start)
            return obj
        except json.JSONDecodeError:
            start = text.find("{", start + 1)
    return None


# Qualitative derivation JSON schema (no numbers — only ↑/↓/∂ + symbolic f())
_QUAL_SCHEMA = (
    '{"variables":["public_transit_usage","vehicle_traffic","congestion","air_pollution",'
    '"city_debt","private_operator_revenue"],'
    '"symbolic_relationships":["public_transit_usage \\u21d1\\u2192 vehicle_traffic \\u21d3",'
    '"vehicle_traffic \\u21d3\\u2192 congestion \\u21d3","congestion \\u21d3\\u2192 air_pollution \\u21d3"],'
    '"qualitative_equations":["\\\\frac{\\\\partial congestion}{\\\\partial vehicle_traffic} > 0",'
    '"\\\\frac{\\\\partial city_debt}{\\\\partial operating_cost} > 0"],'
    '"propagation_chains":["public_transit_usage \\u21d1 \\u2192 vehicle_traffic \\u21d3 \\u2192 congestion \\u21d3 \\u2192 air_pollution \\u21d3"],'
    '"feedback_loop":false,'
    '"time_horizon":{"short_term":["congestion \\u2192 pollution cut"],"medium_term":["operating cost accumulation"],"long_term":["debt service"]},'
    '"conflicting_effects":true,'
    '"scenarios":[{"if":"public_transit_usage \\u21d1","then":"vehicle_traffic \\u21d3 \\u2192 congestion \\u21d3 \\u2192 air_pollution \\u21d3",'
    '"equations":["\\\\frac{\\\\partial congestion}{\\\\partial traffic} > 0"]}],'
    '"conclusion":{"math":"\\\\partial congestion / \\\\partial traffic > 0  \\\\wedge  \\\\partial city_debt / \\\\partial operating_cost > 0",'
    '"nl":"More transit use lowers traffic and pollution but raises city debt and hurts operator revenue."}}'
)

_QUAL_SYSTEM_EN = ("You are a qualitative causal-mathematics modeler. Given an event and its direct "
"causal ancestors, derive a QUALITATIVE mathematical model that links them. "
"The input carries NO numbers — it is purely directional — so you must NEVER invent "
"numeric values or fixed probabilities. Use ONLY: up/down signs (↑/↓), partial-derivative "
"direction signs (∂), symbolic functions f(...), and qualitative words (e.g. slight, moderate, strong). "
"Express every relationship as a sign or a symbolic f() relationship.")

_QUAL_USER_EN = ("Event: \"%s\"\nDirect causal ancestors (id: text): %s\n\n"
"Output ONLY one valid JSON object with exactly these fields:\n%s\n\n"
"RULE: the input is qualitative — NO numbers. NEVER invent numeric values. "
"Use ONLY ↑/↓ signs, ∂ partial derivatives, and symbolic f(...). Do not add text outside JSON.")

_QUAL_SYSTEM_ID = ("Anda adalah modeler kausal-matematik kualitatif. Diberikan sebuah peristiwa dan "
"leluhur sebab-akibatnya, hasilkan model matematis KUALITATIF yang menghubungkan keduanya. "
"Input TANPA angka — murni arah — jadi JANGAN PERNAH mengarang nilai numerik atau probabilitas tetap. "
"HANYA gunakan: tanda naik/turun (↑/↓), tanda turunan parsial (∂), fungsi simbolik f(...), dan "
"kata kualitatif (mis. sedikit, sedang, kuat). Nyatakan setiap hubungan sebagai tanda atau f().")

_QUAL_USER_ID = ("Peristiwa: \"%s\"\nLeluhur sebab-akibat (id: teks): %s\n\n"
"Keluarkan HANYA satu objek JSON valid dengan persis field:\n%s\n\n"
"ATURAN: input kualitatif — TIDAK ADA angka. JANGAN mengarang angka. "
"HANYA gunakan ↑/↓, ∂, dan f(...). Tidak ada teks di luar JSON.")


def _norm_qualitative(data: dict) -> dict | None:
    """Normalize LLM qualitative output to the canonical shape."""
    if not isinstance(data, dict):
        return None
    # required keys
    req = ["variables", "symbolic_relationships", "qualitative_equations",
           "propagation_chains", "feedback_loop", "time_horizon",
           "conflicting_effects", "scenarios", "conclusion"]
    for k in req:
        if k not in data:
            return None
    # coerce types
    out = {
        "variables": [str(v) for v in data.get("variables", []) if v],
        "symbolic_relationships": [str(r) for r in data.get("symbolic_relationships", []) if r],
        "qualitative_equations": [str(e) for e in data.get("qualitative_equations", []) if e],
        "propagation_chains": [str(c) for c in data.get("propagation_chains", []) if c],
        "feedback_loop": bool(data.get("feedback_loop")),
        "time_horizon": {
            "short_term": [str(x) for x in (data.get("time_horizon") or {}).get("short_term", [])],
            "medium_term": [str(x) for x in (data.get("time_horizon") or {}).get("medium_term", [])],
            "long_term": [str(x) for x in (data.get("time_horizon") or {}).get("long_term", [])],
        },
        "conflicting_effects": bool(data.get("conflicting_effects")),
        "scenarios": [
            {
                "if": str(s.get("if", "")),
                "then": str(s.get("then", "")),
                "equations": [str(eq) for eq in s.get("equations", []) if eq],
            }
            for s in data.get("scenarios", []) if isinstance(s, dict)
        ],
        "conclusion": {
            "math": str((data.get("conclusion") or {}).get("math", "")),
            "nl": str((data.get("conclusion") or {}).get("nl", "")),
        },
        "domain": str(data.get("domain") or ""),
        "units": data.get("units") if isinstance(data.get("units"), dict) else {},
        "source": "llm",
    }
    return out


def derive_math(event: str, ancestors: list[str] | None = None, lang: str = "en",
               timeout: float = 60.0) -> dict | None:
    """Generate an AI-driven *qualitative* causal-mathematical derivation for a node.

    Unlike a fixed template this is conditioned on the node's *actual* text and its
    real causal ancestors, so the derivation is scenario-specific. Returns a dict with
    keys: variables, symbolic_relationships, qualitative_equations, propagation_chains,
    feedback_loop, time_horizon, conflicting_effects, scenarios, conclusion, domain,
    units — or None when offline / LLM unavailable (caller falls back to the mechanistic
    qualitative derivation).
    """
    if not is_configured():
        return None
    ancestors = ancestors or []
    if lang == "id":
        system = _QUAL_SYSTEM_ID
        user = _QUAL_USER_ID % (event, " ; ".join(ancestors) if ancestors else "(tidak ada leluhur kausal)", _QUAL_SCHEMA)
    else:
        system = _QUAL_SYSTEM_EN
        user = _QUAL_USER_EN % (event, " ; ".join(ancestors) if ancestors else "(no causal ancestors)", _QUAL_SCHEMA)
    detail = (event[:70] + "…") if len(event) > 70 else event
    trajectory.push("llm", "derive math: " + detail, model=get_config().get("model") or "?")
    reply = chat([{"role": "system", "content": system}, {"role": "user", "content": user}],
                 temperature=0.5, max_tokens=3000, timeout=timeout)
    trajectory.push("llm_done", "derive math: " + detail, ok=reply is not None)
    if not reply:
        return None
    data = _extract_json(reply)
    out = _norm_qualitative(data)
    return out


def chat_develop_network(node_text: str, node_id: str, context: list[str], user_message: str,
                         lang: str = "en") -> tuple[str | None, list | None]:
    """Ask the LLM to co-develop the causal web around a node.

    Returns (reply, mutations) or (None, None) when offline/failed. `context` is
    a list of "id: text" strings for the nodes the model may reference.
    """
    if not is_configured():
        return None, None
    ctx = "\n".join(context) if context else "(none)"
    schema = ("Each mutation is exactly one of: "
              '{"op":"add_node","text":"…","to":"<node_id>","relation":"leads_to"}, '
              '{"op":"add_root","text":"…","type":"intervention"}, '
              '{"op":"add_edge","from":"<id>","to":"<id>","relation":"causes"}, '
              '{"op":"remove_edge","from":"<id>","to":"<id>"}, '
              '{"op":"remove_node","id":"<id>"}, '
              '{"op":"update_node","id":"<id>","text":"…"}. '
              'Relation ∈ causes|leads_to|increases|decreases|enables|prevents|weakens|triggers. '
              '"to"/"from"/"id" must be ids listed in the context (or the selected node id).')
    if lang == "id":
        system = ("Anda adalah mesin pengembang jaringan sebab-akibat. Anda menjawab pengguna "
                  "dan memutuskan cara mengembangkan jaringan: tambah konsekuensi, cabang, "
                  "hubungan, atau ubah/hapus node. Output HANYA satu objek JSON valid. "
                  "Setiap mutasi harus menghormati validitas kausal dan kewajaran dunia nyata: "
                  "hanya tambah konsekuensi yang benar-benar terhubung sebab-akibat, jaga "
                  "kendala waktu/ruang/sumber daya tetap masuk akal, dan jangan tambah kejadian "
                  "absurd atau dramatis belaka. Jika pengguna mengubah node, perlakukan sebagai "
                  "perubahan counterfactual pada keadaan dunia: bagian jaringan yang tidak "
                  "bergantung kausal biarkan utuh, hanya regenerasi bagian masa depan yang "
                  "terpengaruh.")
        user = (f"Anda sedang mendiskusikan node ini dengan pengguna.\n\n"
                f"Node terpilih: [{node_id}] {node_text}\n\n"
                f"Node lain yang relevan (id: teks):\n{ctx}\n\n"
                f"Pesan pengguna: {user_message}\n\n"
                f"Jawab STRICT dalam JSON persis seperti ini:\n"
                f'{{"reply": "penjelasan singkat bahasa Indonesia tentang yang Anda lakukan", '
                f'"mutations": [ … ]}}\n\n'
                f"Aturan mutasi:\n{schema}\n"
                f"Jika pengguna mengajukan kejadian/intervensi baru, gunakan add_root atau add_node. "
                f"Jangan hapus node kecuali diminta. Maksimal 6 mutasi per giliran.")
    else:
        system = ("You are a causal-web co-developer. You answer the user and decide how to "
                  "grow the network: add consequences, branches, links, or edit/remove nodes. "
                  "Output ONLY one valid JSON object. Every mutation must respect causal validity "
                  "and real-world plausibility: only add consequences causally connected to the "
                  "node, keep time/space/resource constraints plausible, and never add absurd or "
                  "purely dramatic events. When the user modifies a node, treat it as a "
                  "counterfactual change of world state: leave parts of the network with no causal "
                  "dependency intact, and only regenerate the affected future.")
        user = (f"You are discussing this node with the user.\n\n"
                f"Selected node: [{node_id}] {node_text}\n\n"
                f"Other relevant nodes (id: text):\n{ctx}\n\n"
                f"User message: {user_message}\n\n"
                f"Reply STRICTLY in this JSON shape:\n"
                f'{{"reply": "short explanation of what you did", "mutations": [ … ]}}\n\n'
                f"Mutation rules:\n{schema}\n"
                f"If the user proposes a new event/intervention, use add_root or add_node. "
                f"Do not delete nodes unless asked. Cap at 6 mutations per turn.")
    reply = chat([{"role": "system", "content": system}, {"role": "user", "content": user}],
                 temperature=0.6, max_tokens=900, timeout=12.0)
    if not reply:
        return None, None
    data = _extract_json(reply)
    if isinstance(data, dict):
        return data.get("reply") or reply, data.get("mutations") or []
    return reply, None
