#!/usr/bin/env python3
"""Riak — self-contained swarm-intelligence engine server.

Zero third-party dependencies: uses only the Python standard library, so it
runs anywhere Python 3.9+ is available:

    python3 server.py            # serves http://127.0.0.1:8000
    RIAK_PORT=8080 python3 server.py

Optional LLM integration is enabled by environment variables (see .env.example).
"""

from __future__ import annotations

import copy
import json
import logging
import os
import random
import sys
import threading
import time
import traceback
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from logging.handlers import RotatingFileHandler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from engine import causal, llm, trajectory  # noqa: E402

ROOT = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(ROOT, "static")
SAMPLES_DIR = os.path.join(ROOT, "samples")
DATA_DIR = os.path.join(ROOT, "data")

MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
}

_lock = threading.Lock()
projects: dict[str, dict] = {}

# ---------------------------------------------------------------- logging
# Structured logs go to stderr AND a rotating server.log next to this file, so
# production issues can be traced after the fact instead of vanishing in stdout.
log = logging.getLogger("riak")


def _setup_logging() -> None:
    if log.handlers:  # idempotent (tests may re-import)
        return
    log.setLevel((os.environ.get("RIAK_LOG_LEVEL") or
                  os.environ.get("WANION_LOG_LEVEL", "INFO")).upper())
    fmt = logging.Formatter("%(asctime)s %(levelname)-5s %(message)s")
    sh = logging.StreamHandler()
    sh.setFormatter(fmt)
    log.addHandler(sh)
    try:
        fh = RotatingFileHandler(os.path.join(ROOT, "server.log"), maxBytes=1_000_000,
                                 backupCount=2, encoding="utf-8")
        fh.setFormatter(fmt)
        log.addHandler(fh)
    except OSError:  # a read-only dir must never block startup
        pass


# ------------------------------------------------------------- rate limiting
# Token-bucket per client IP. Default 600 req/min — comfortably above the UI's
# trajectory polling, but stops a hostile client from hammering heavy endpoints.
_RATE: dict[str, list] = {}   # ip -> [count, window_start]
_RATE_LIMIT = int(os.environ.get("RIAK_RATE_LIMIT") or
                  os.environ.get("WANION_RATE_LIMIT", "600"))
_RATE_WINDOW = 60.0


def _rate_ok(ip: str) -> bool:
    now = time.time()
    with _lock:
        rec = _RATE.get(ip)
        if not rec or now - rec[1] > _RATE_WINDOW:
            _RATE[ip] = [1, now]
            return True
        rec[0] += 1
        return rec[0] <= _RATE_LIMIT


# ------------------------------------------------------------------ job store
# Long-running endpoints (simulate/develop/projects) can be executed in the
# background: POST with {"async": true} returns {"job_id": ...} immediately and
# the client polls GET /api/jobs/<id> for the result. Sync stays the default.
_jobs: dict[str, dict] = {}
_MAX_JOBS = 200

# ---- live trajectory (progress) store -------------------------------
# Each in-flight build/simulate records steps under a job id so the UI can poll
# "what is the engine doing right now". A thread-local binds events (pushed from
# engine modules via trajectory.push) to the job being processed by THIS thread.
_trajectories: dict[str, dict] = {}   # job_id -> {events:[...], active:bool, started:float}
_tl = threading.local()
_MAX_TRAJECTORY = 500


def _traj_sink(ev: dict):
    job = getattr(_tl, "job", None)
    if not job:
        return
    rec = _trajectories.get(job)
    if rec is None:
        return
    ev = dict(ev)
    ev["t_str"] = time.strftime("%H:%M:%S", time.localtime(ev.get("t", time.time())))
    with _lock:
        rec["events"].append(ev)
        if len(rec["events"]) > _MAX_TRAJECTORY:
            rec["events"] = rec["events"][-_MAX_TRAJECTORY:]


def _start_trajectory(job: str):
    with _lock:
        _trajectories[job] = {"events": [], "active": True, "started": time.time()}
    _tl.job = job


def _finish_trajectory(job: str, ok: bool = True):
    with _lock:
        rec = _trajectories.get(job)
        if rec:
            rec["active"] = False
            rec["ok"] = ok
    if getattr(_tl, "job", None) == job:
        _tl.job = None


def get_trajectory(job: str) -> dict | None:
    with _lock:
        rec = _trajectories.get(job)
        return dict(rec) if rec else None


# ---------------------------------------------------------------- storage
def _load_projects():
    os.makedirs(DATA_DIR, exist_ok=True)
    for fn in sorted(os.listdir(DATA_DIR)):
        if not fn.endswith(".json"):
            continue
        try:
            with open(os.path.join(DATA_DIR, fn), encoding="utf-8") as f:
                p = json.load(f)
            if "web" not in p:  # skip legacy agent-based projects
                continue
            projects[p["id"]] = p
        except Exception as exc:  # noqa: BLE001
            log.warning("store: skip %s: %s", fn, exc)


def _save_project(p: dict):
    os.makedirs(DATA_DIR, exist_ok=True)
    # underscore-prefixed keys (undo/redo stacks) are session state — never persisted
    clean = {k: v for k, v in p.items() if not k.startswith("_")}
    with open(os.path.join(DATA_DIR, f"{p['id']}.json"), "w", encoding="utf-8") as f:
        json.dump(clean, f, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------- llm config
LLM_CONFIG_PATH = os.path.join(DATA_DIR, "llm_config.json")
_LLM_FIELDS = ("base_url", "model", "endpoint", "auth_type", "header_name", "api_key")


def _load_dotenv(path: str = ".env") -> None:
    """Minimal .env loader (stdlib only). Populates os.environ so the engine's
    env-fallback (LLM_BASE_URL / LLM_MODEL_NAME / LLM_API_KEY) actually works when
    run via ./run.sh — run.sh copies .env but never sources it. Existing env wins."""
    if not os.path.exists(path):
        return
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                k = k.strip()
                v = v.strip().strip('"').strip("'")
                if k and k not in os.environ:
                    os.environ[k] = v
    except Exception:  # noqa: BLE001 — a bad .env must never block startup
        pass


def _load_llm_config():
    if os.path.exists(LLM_CONFIG_PATH):
        try:
            with open(LLM_CONFIG_PATH, encoding="utf-8") as f:
                llm.set_runtime_config(json.load(f))
        except Exception as exc:  # noqa: BLE001
            log.warning("llm-config: load failed: %s", exc)


def _save_llm_config(cfg: dict):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(LLM_CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


def _masked_llm_config() -> dict:
    c = llm.get_config()
    key = c.get("api_key", "")
    return {
        "base_url": c.get("base_url", ""),
        "model": c.get("model", ""),
        "endpoint": c.get("endpoint", "/chat/completions"),
        "auth_type": c.get("auth_type", "bearer"),
        "header_name": c.get("header_name", ""),
        "api_key": ("••••••••" + key[-4:]) if key else "",
        "has_key": bool(key),
        "configured": llm.is_configured(),
        "reasoning_level": c.get("reasoning_level") or "",
    }


def handle_llm_config_save(body: dict) -> dict:
    cur = llm.get_config()
    endpoint = str(body.get("endpoint") or "").strip()
    if endpoint and not endpoint.startswith("/"):
        endpoint = "/" + endpoint
    auth_type = str(body.get("auth_type") or "bearer").strip()
    if auth_type not in ("bearer", "api-key", "none"):
        auth_type = "bearer"
    level = str(body.get("reasoning_level") or "").strip().lower()
    if level not in llm.REASONING_LEVELS:
        level = ""
    cfg = {
        "base_url": str(body.get("base_url") or "").strip(),
        "model": str(body.get("model") or "").strip(),
        "endpoint": endpoint,
        "auth_type": auth_type,
        "header_name": str(body.get("header_name") or "").strip(),
        "api_key": cur.get("api_key", ""),
        "reasoning_level": level,
    }
    new_key = str(body.get("api_key") or "").strip()
    if new_key and not new_key.startswith("••"):
        cfg["api_key"] = new_key
    llm.set_runtime_config(cfg)
    _save_llm_config(cfg)
    return _masked_llm_config()


def handle_llm_test() -> dict:
    if not llm.is_configured():
        raise ValueError("LLM not configured — set base URL and model first")
    reply = llm.test()
    if reply is None:
        raise ValueError(f"connection failed: {llm.get_last_error() or 'no response'}")
    return {"ok": True, "reply": reply}


def handle_llm_cache_clear(body: dict) -> dict:
    return {"ok": True, "cleared": llm.clear_cache()}


# ---------------------------------------------------------------- helpers
def _project_view(p: dict) -> dict:
    # full detail view (list view is lean via list_projects())
    return dict(p)


def list_projects() -> list[dict]:
    out = []
    for p in projects.values():
        out.append({
            "id": p["id"],
            "name": p["name"],
            "created": p["created"],
            "n_nodes": p["web"].get("n_nodes", 0),
            "topic": p["web"].get("topic", ""),
            "has_result": p.get("prediction") is not None,
            "has_report": p.get("report") is not None,
        })
    return sorted(out, key=lambda x: x["created"], reverse=True)


def _load_samples() -> list[dict]:
    samples = []
    if not os.path.isdir(SAMPLES_DIR):
        return samples
    for fn in sorted(os.listdir(SAMPLES_DIR)):
        if not fn.endswith(".json"):
            continue
        try:
            with open(os.path.join(SAMPLES_DIR, fn), encoding="utf-8") as f:
                samples.append(json.load(f))
        except Exception as exc:  # noqa: BLE001
            log.warning("samples: skip %s: %s", fn, exc)
    return samples


# ---------------------------------------------------------------- endpoints
def handle_create_project(body: dict) -> dict:
    name = (body.get("name") or "Untitled scenario").strip()[:120]
    seed_text = (body.get("seed_text") or "").strip()
    if not seed_text:
        raise ValueError("seed_text is required")
    seed = int(body.get("seed", int(time.time()) % 2**31))
    config = body.get("config") or {}
    lang = str(body.get("lang") or "en").strip()
    if lang not in ("id", "en"):
        lang = "en"
    job = str(body.get("job") or "").strip() or f"j{int(time.time()*1000)}"
    _start_trajectory(job)
    trajectory.push("phase", f"building world from scenario")
    try:
        web = causal.build_web(seed_text, seed, config, lang=lang)
        _finish_trajectory(job, ok=True)
    except Exception:
        _finish_trajectory(job, ok=False)
        raise
    pid = f"p{int(time.time()*1000)}"
    p = {
        "id": pid,
        "name": name,
        "created": time.strftime("%Y-%m-%d %H:%M:%S"),
        "seed_text": seed_text,
        "seed": seed,
        "lang": lang,
        "build_config": config,
        "web": web,
        "prediction": None,
        "report": None,
        "job": job,
    }
    with _lock:
        projects[pid] = p
        _save_project(p)
    view = _project_view(p)
    view["job"] = job
    return view


def handle_simulate(body: dict) -> dict:
    pid = body.get("project_id")
    with _lock:
        p = projects.get(pid)
    if not p:
        raise ValueError("project not found")

    config = dict(p.get("build_config", {}))
    config.update(body.get("config") or {})
    config["seed"] = int(config.get("seed", p["seed"]))
    lang = str(body.get("lang") or p.get("lang") or "en").strip()
    if lang not in ("id", "en"):
        lang = "en"

    # start from the stored baseline web (deterministic, no re-reasoning)
    web = copy.deepcopy(p["web"])
    interventions = config.get("interventions") or []
    job = str(body.get("job") or "").strip() or f"j{int(time.time()*1000)}"
    _start_trajectory(job)
    trajectory.push("phase", "applying counterfactual intervention(s)" if interventions else "propagating likelihoods")
    try:
        if interventions:
            web = causal.apply_interventions(web, interventions, random.Random(config["seed"] + 104729), config, lang=lang)

        prediction = causal.predict(web, lang=lang)
        # Monte-Carlo confidence intervals over edge-weight uncertainty
        ens_runs = int(config.get("ensemble_runs", 25) or 0)
        if ens_runs > 1:
            trajectory.push("phase", f"monte-carlo ensemble ({ens_runs} runs)")
            prediction["ensemble"] = causal.predict_ensemble(web, lang=lang, runs=ens_runs)
        _finish_trajectory(job, ok=True)
    except Exception:
        _finish_trajectory(job, ok=False)
        raise

    _store_result(p, web, prediction)   # also snapshots history for undo/redo

    return {"web": web, "prediction": prediction, "job": job}


def handle_report(body: dict) -> dict:
    pid = body.get("project_id")
    with _lock:
        p = projects.get(pid)
    if not p:
        raise ValueError("project not found")
    if p.get("prediction") is None:
        raise ValueError("run a prediction first")
    lang = str(body.get("lang") or p.get("lang") or "en").strip()
    rep = causal.causal_report(p.get("result_web") or p["web"], p["prediction"], lang=lang)
    with _lock:
        p["report"] = rep
        _save_project(p)
    return rep


def handle_chat(body: dict) -> dict:
    pid = body.get("project_id")
    with _lock:
        p = projects.get(pid)
    if not p:
        raise ValueError("project not found")
    node_id = body.get("node_id")
    lang = str(body.get("lang") or p.get("lang") or "en").strip()
    return causal.explain_node(p.get("result_web") or p["web"], node_id, lang=lang)


def handle_derive(body: dict) -> dict:
    """AI-driven qualitative causal-mathematical derivation for an event.

    The frontend may optionally pass a project_id + node_id to pull ancestry from the
    stored web; otherwise it can pass the text/ancestry directly. Either way the
    engine is asked to *derive* a qualitative mathematical model (signs, ∂, f()).
    """
    pid = body.get("project_id")
    p = projects.get(pid) if pid else None
    node_id = body.get("node_id")
    event = body.get("text", "")
    if not event and p and node_id:
        node = next((n for n in p["web"]["nodes"] if n.get("id") == node_id), None)
        if node:
            event = node.get("text", "")
    lang = body.get("lang")
    if not lang and p:
        lang = p.get("lang")
    if not lang:
        lang = "en"
    lang = str(lang).strip()
    if lang not in ("id", "en"):
        lang = "en"
    ancestry = list(body.get("ancestry") or [])
    if not ancestry and p and node_id:
        ancestry = causal.ancestry_texts(p.get("result_web") or p["web"], node_id)
    job = "derive-" + node_id if node_id else ("derive-" + str(int(time.time() * 1000)))
    _start_trajectory(job)
    try:
        result = llm.derive_math(event, ancestry, lang=lang, timeout=150.0) or {}
    finally:
        _finish_trajectory(job, ok=bool(result))
    if not result:
        # graceful fallback: qualitative mechanistic derivation (no LLM, no invented numbers)
        result = causal.mecher_derive_qualitative(event, ancestry, lang=lang) or {
            "variables": [], "symbolic_relationships": [], "qualitative_equations": [],
            "propagation_chains": [], "feedback_loop": False, "time_horizon": {"short_term": [], "medium_term": [], "long_term": []},
            "conflicting_effects": False, "scenarios": [], "conclusion": {"math": "", "nl": "(no derivation available)"},
            "domain": causal.detect_domain(event), "units": {}, "source": "mech",
        }
    # always fill in context-derived fields so the UI has a complete derivation
    web_ref = (p.get("result_web") or p.get("web", {})) if p else {}
    result["probabilities"] = causal.compute_risks(event, ancestry, web_ref, lang=lang)
    result["domain"] = result.get("domain") or causal.detect_domain(event)
    result["node_id"] = node_id or ""
    return result


def _active_web(p: dict) -> dict:
    """The editable web: the simulated result if present, else the baseline."""
    return copy.deepcopy(p.get("result_web") or p["web"])


def _node_context(web: dict, node_id: str, limit: int = 12) -> list[str]:
    """Compact "id: text" context for the LLM: the node, its neighbours, + top nodes."""
    nodes = {n["id"]: n for n in web["nodes"]}
    out: dict[str, str] = {}
    for e in web["edges"]:
        if e["source"] == node_id and e["target"] in nodes:
            out[e["target"]] = nodes[e["target"]]["text"]
        elif e["target"] == node_id and e["source"] in nodes:
            out[e["source"]] = nodes[e["source"]]["text"]
    for n in sorted((n for n in web["nodes"] if n["id"] != node_id),
                    key=lambda n: -(n.get("probability") or 0))[:limit]:
        out.setdefault(n["id"], n["text"])
    return [f"[{nid}] {txt}" for nid, txt in out.items()]


def _store_result(p: dict, web: dict, prediction: dict):
    with _lock:
        _push_history(p)
        p["result_web"] = web
        p["prediction"] = prediction
        _save_project(p)


def handle_develop(body: dict) -> dict:
    """AI co-develops the network around a node (chat + graph mutations)."""
    pid = body.get("project_id")
    with _lock:
        p = projects.get(pid)
    if not p:
        raise ValueError("project not found")
    node_id = body.get("node_id")
    message = str(body.get("message") or "").strip()
    lang = str(body.get("lang") or p.get("lang") or "en").strip()
    if lang not in ("id", "en"):
        lang = "en"
    if not node_id:
        raise ValueError("node_id is required")

    web = _active_web(p)
    nodes = {n["id"]: n for n in web["nodes"]}
    node = nodes.get(node_id)
    if not node:
        raise ValueError("node not found")

    if not message:
        return causal.explain_node(web, node_id, lang=lang)

    rng = random.Random(int(p["seed"]) + 104729 + len(web["nodes"]))
    context = _node_context(web, node_id)
    reply, mutations = llm.chat_develop_network(node["text"], node_id, context, message, lang)

    applied: list[dict] = []
    if reply is not None:
        web, applied = causal.apply_mutations(web, mutations or [], node_id, lang, rng)
    else:
        web, reply, applied = causal.offline_develop(web, node_id, lang, rng)

    prediction = causal.predict(web, lang=lang)
    _store_result(p, web, prediction)
    return {"reply": reply, "mutations": applied, "web": web, "prediction": prediction}


def handle_edit(body: dict) -> dict:
    """Apply explicit user graph edits (drag is client-side; add/remove/rename/link)."""
    pid = body.get("project_id")
    with _lock:
        p = projects.get(pid)
    if not p:
        raise ValueError("project not found")
    lang = str(body.get("lang") or p.get("lang") or "en").strip()
    if lang not in ("id", "en"):
        lang = "en"
    node_id = body.get("node_id")
    web = _active_web(p)
    mutations = body.get("mutations") or []
    rng = random.Random(int(p["seed"]) + 104729 + len(web["nodes"]))
    web, applied = causal.apply_mutations(web, mutations, node_id, lang, rng)
    prediction = causal.predict(web, lang=lang)
    _store_result(p, web, prediction)
    return {"mutations": applied, "web": web, "prediction": prediction}


# ------------------------------------------------------------------ undo/redo
# Every result mutation (simulate/develop/edit) snapshots the previous state, so
# the UI can offer real undo/redo across all graph-changing operations.
_HISTORY_MAX = 20


def _push_history(p: dict):
    snap = {"result_web": p.get("result_web"), "prediction": p.get("prediction")}
    p.setdefault("_history", []).append(snap)
    p["_history"] = p["_history"][-_HISTORY_MAX:]
    p["_future"] = []  # a new edit invalidates the redo stack


def handle_undo(body: dict) -> dict:
    pid = body.get("project_id")
    with _lock:
        p = projects.get(pid)
        if not p:
            raise ValueError("project not found")
        hist = p.get("_history") or []
        if not hist:
            raise ValueError("nothing to undo")
        p.setdefault("_future", []).append(
            {"result_web": p.get("result_web"), "prediction": p.get("prediction")})
        snap = hist.pop()
        p["result_web"] = snap["result_web"]
        p["prediction"] = snap["prediction"]
        _save_project(p)
        can_undo, can_redo = bool(hist), bool(p.get("_future"))
    return {"web": _active_web(p), "prediction": p.get("prediction"),
            "can_undo": can_undo, "can_redo": can_redo}


def handle_redo(body: dict) -> dict:
    pid = body.get("project_id")
    with _lock:
        p = projects.get(pid)
        if not p:
            raise ValueError("project not found")
        fut = p.get("_future") or []
        if not fut:
            raise ValueError("nothing to redo")
        p.setdefault("_history", []).append(
            {"result_web": p.get("result_web"), "prediction": p.get("prediction")})
        snap = fut.pop()
        p["result_web"] = snap["result_web"]
        p["prediction"] = snap["prediction"]
        _save_project(p)
        can_undo, can_redo = bool(p.get("_history")), bool(fut)
    return {"web": _active_web(p), "prediction": p.get("prediction"),
            "can_undo": can_undo, "can_redo": can_redo}


def handle_compare(body: dict) -> dict:
    """A/B-compare intervention scenarios side by side.

    body: {project_id, scenarios: [{name, interventions: [...]}, ...], config?}
    Returns one prediction per scenario (baseline web is never modified).
    """
    pid = body.get("project_id")
    with _lock:
        p = projects.get(pid)
    if not p:
        raise ValueError("project not found")
    scenarios = body.get("scenarios") or []
    if not (1 <= len(scenarios) <= 4):
        raise ValueError("provide 1–4 scenarios to compare")
    config = dict(p.get("build_config", {}))
    config.update(body.get("config") or {})
    seed = int(config.get("seed", p["seed"]))
    lang = str(body.get("lang") or p.get("lang") or "en").strip()
    if lang not in ("id", "en"):
        lang = "en"
    ens_runs = int(config.get("ensemble_runs", 25) or 0)

    out = []
    for i, sc in enumerate(scenarios):
        web = copy.deepcopy(p["web"])
        interventions = sc.get("interventions") or []
        if interventions:
            web = causal.apply_interventions(web, interventions,
                                             random.Random(seed + 104729 + i * 7919),
                                             config, lang=lang)
        prediction = causal.predict(web, lang=lang)
        if ens_runs > 1:
            prediction["ensemble"] = causal.predict_ensemble(web, lang=lang, runs=ens_runs)
        out.append({"name": str(sc.get("name") or f"Scenario {i + 1}")[:80],
                    "prediction": prediction, "n_nodes": web["n_nodes"]})
    return {"scenarios": out}


def handle_sensitivity(body: dict) -> dict:
    """Sweep one edge's weight and report how the prediction responds.

    body: {project_id, source, target, weights: [0.1, ...]} (max 25 sweep points)
    Returns [{weight, confidence, top_outcome_id, top_outcome_text}] — the UI draws
    the response curve and sees which assumption the prediction hinges on.
    """
    pid = body.get("project_id")
    with _lock:
        p = projects.get(pid)
    if not p:
        raise ValueError("project not found")
    source, target = body.get("source"), body.get("target")
    weights = [clamp_w(float(w)) for w in (body.get("weights") or [])][:25]
    if not weights:
        raise ValueError("weights must be a non-empty list of 0..1 values")
    lang = str(body.get("lang") or p.get("lang") or "en").strip()
    if lang not in ("id", "en"):
        lang = "en"

    base_web = _active_web(p)
    matched = [i for i, e in enumerate(base_web["edges"])
               if e["source"] == source and e["target"] == target]
    if not matched:
        raise ValueError("edge not found")

    points = []
    for w in weights:
        web = copy.deepcopy(base_web)
        for i in matched:
            web["edges"][i]["weight"] = w
        pred = causal.predict(web, lang=lang)
        top = (pred.get("top_outcomes") or [{}])[0]
        points.append({"weight": round(w, 3), "confidence": pred["confidence"],
                       "top_outcome_id": top.get("id"), "top_outcome_text": top.get("text")})
    return {"source": source, "target": target, "points": points}


def clamp_w(v: float) -> float:
    return max(0.0, min(1.0, v))


def handle_export(body: dict) -> dict:
    pid = body.get("project_id")
    with _lock:
        p = projects.get(pid)
    if not p:
        raise ValueError("project not found")
    fmt = body.get("format", "json").lower()
    if fmt == "json":
        content = json.dumps({k: v for k, v in p.items() if not k.startswith("_")},
                             ensure_ascii=False, indent=2)
        return {"format": "json", "filename": f"{p['name']}.json", "content": content}
    if fmt == "markdown":
        content = _to_markdown(p)
        return {"format": "markdown", "filename": f"{p['name']}.md", "content": content}
    if fmt == "html":
        content = _to_html(p)
        return {"format": "html", "filename": f"{p['name']}.html", "content": content}
    raise ValueError("format must be json, markdown, or html")


def _to_markdown(p: dict) -> str:
    lines = [f"# {p['name']}", "", f"*Generated by Riak — {p['created']}*", ""]
    lines += [f"## Scenario", "", p["web"].get("topic", ""), ""]
    if p.get("report"):
        r = p["report"]
        lines += ["## Prediction", "", r.get("summary", ""), ""]
        if r.get("chain"):
            lines += ["## Most likely path", ""]
            lines.append(" → ".join(r["chain"]))
            lines.append("")
        lines += ["## Key outcomes", ""]
        lines += [f"- {f}" for f in r.get("findings", [])]
        lines.append("")
    else:
        lines += ["## Prediction", "", "*(no prediction run yet)*", ""]
    lines += [f"## Causal web", "", f"{p['web']['n_nodes']} events, {p['web']['n_edges']} causal links", ""]
    return "\n".join(lines)


def _esc(s) -> str:
    """Minimal HTML-escaping for user/scenario text."""
    return (str(s if s is not None else "")
            .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;"))


def _to_html(p: dict) -> str:
    """Self-contained, shareable static HTML report (inline CSS, no JS, no network)."""
    pred = p.get("prediction") or {}
    rep = p.get("report") or {}
    web = p.get("result_web") or p["web"]

    def pct(x):
        try:
            return f"{round(float(x) * 100)}%"
        except (TypeError, ValueError):
            return "–"

    rows_out = "".join(
        f"<tr><td>{_esc(o.get('text'))}</td><td class='num'>{pct(o.get('probability', o.get('mean')))}</td></tr>"
        for o in (pred.get("top_outcomes") or []))
    steps = "".join(
        f"<li><span class='day'>day {t.get('day', 0)}</span>{_esc(t.get('text'))}</li>"
        for t in (pred.get("timeline") or []))
    ens = pred.get("ensemble") or {}
    ens_html = ""
    if ens:
        conf = ens.get("confidence") or {}
        ens_html = f"""
  <section><h2>Confidence (Monte-Carlo, {ens.get('runs', '?')} runs)</h2>
  <p>Mean <strong>{pct(conf.get('mean'))}</strong> · P10–P90 interval
     <strong>{pct(conf.get('lo'))} – {pct(conf.get('hi'))}</strong> ·
     chain stability <strong>{pct(ens.get('chain_stability'))}</strong></p></section>"""
    findings = "".join(f"<li>{_esc(f)}</li>" for f in (rep.get("findings") or []))
    fb = pred.get("feedback_loop")
    fb_html = ("<p class='fb'>⚠ The web contains an active feedback loop; "
               "probabilities include its amplification.</p>") if fb else ""

    return f"""<!doctype html>
<html lang="{_esc(p.get('lang') or 'en')}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{_esc(p['name'])} · Riak report</title>
<style>
 body{{font:16px/1.6 -apple-system,'Segoe UI',sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem;color:#1F2320;background:#F5F4F0}}
 h1{{font-size:1.6rem;margin-bottom:.2rem}} h2{{font-size:1.1rem;margin-top:2rem;border-bottom:1px solid #DDD9D0;padding-bottom:.3rem}}
 .meta,.day{{color:#6E746B;font-size:.85rem}} .day{{display:inline-block;min-width:4.5rem;font-weight:600}}
 .summary{{background:#fff;border:1px solid #DDD9D0;border-radius:10px;padding:1rem 1.2rem;white-space:pre-wrap}}
 table{{border-collapse:collapse;width:100%}} td,th{{border-bottom:1px solid #DDD9D0;padding:.45rem .6rem;text-align:left}}
 .num{{text-align:right;font-variant-numeric:tabular-nums}} .fb{{background:#FDF3E3;border:1px solid #E8D5B0;border-radius:8px;padding:.6rem .9rem}}
 footer{{margin-top:3rem;color:#6E746B;font-size:.8rem}}
</style></head><body>
<h1>◈ {_esc(p['name'])}</h1>
<p class="meta">Generated by Riak · {_esc(p.get('created'))} · {web.get('n_nodes', '?')} events, {web.get('n_edges', '?')} causal links</p>
<section><h2>Scenario</h2><p>{_esc(p['web'].get('topic'))}</p></section>
<section><h2>Prediction</h2><div class="summary">{_esc(pred.get('summary') or rep.get('summary') or '(no prediction run yet)')}</div>{fb_html}</section>
{f"<section><h2>Most likely timeline</h2><ol>{steps}</ol></section>" if steps else ""}
{f"<section><h2>Top outcomes</h2><table><tr><th>Outcome</th><th class='num'>Probability</th></tr>{rows_out}</table></section>" if rows_out else ""}
{ens_html}
{f"<section><h2>Key findings</h2><ul>{findings}</ul></section>" if findings else ""}
<footer>Riak · causal prediction engine — static export, no live data.</footer>
</body></html>"""


# ---------------------------------------------------------------- http
_POST_ROUTES = {
    "/api/projects": "handle_create_project",
    "/api/simulate": "handle_simulate",
    "/api/report": "handle_report",
    "/api/chat": "handle_chat",
    "/api/develop": "handle_develop",
    "/api/derive": "handle_derive",
    "/api/graph": "handle_edit",
    "/api/undo": "handle_undo",
    "/api/redo": "handle_redo",
    "/api/compare": "handle_compare",
    "/api/sensitivity": "handle_sensitivity",
    "/api/export": "handle_export",
    "/api/llm-config": "handle_llm_config_save",
    "/api/llm-test": "handle_llm_test",
    "/api/llm-cache-clear": "handle_llm_cache_clear",
}

# endpoints allowed to run in the background via {"async": true}
_ASYNC_ENDPOINTS = {"/api/projects", "/api/simulate", "/api/develop", "/api/compare"}


def _dispatch_post(path: str, body: dict) -> dict:
    return globals()[_POST_ROUTES[path]](body)


def _run_async(path: str, body: dict) -> dict:
    """Execute a heavy endpoint on a daemon thread; client polls /api/jobs/<id>."""
    job_id = f"a{int(time.time() * 1000)}{random.randint(100, 999)}"
    with _lock:
        # drop oldest finished jobs so the store stays bounded
        if len(_jobs) >= _MAX_JOBS:
            done = sorted((j for j in _jobs.values() if j["status"] != "running"),
                          key=lambda j: j.get("finished", 0))
            for j in done[: len(_jobs) - _MAX_JOBS + 1]:
                _jobs.pop(j["id"], None)
        _jobs[job_id] = {"id": job_id, "status": "running", "started": time.time(),
                         "finished": None, "result": None, "error": None}

    def work():
        try:
            out = _dispatch_post(path, body)
            with _lock:
                _jobs[job_id].update(status="done", result=out, finished=time.time())
        except Exception as exc:  # noqa: BLE001 — surfaced via the job record
            log.error("async job %s failed\n%s", job_id, traceback.format_exc())
            with _lock:
                _jobs[job_id].update(status="error", error=str(exc), finished=time.time())

    threading.Thread(target=work, daemon=True).start()
    return {"job_id": job_id, "status": "running"}


_MAX_BODY = 2 * 1024 * 1024   # 2 MB — scenarios are text; anything bigger is abuse


class _HttpError(Exception):
    """An error that maps to a specific HTTP status code."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


class Handler(BaseHTTPRequestHandler):
    server_version = "Riak/1.0.0"

    def _send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _send_bytes(self, data: bytes, ctype: str, status=200):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)

    def _read_body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length > _MAX_BODY:
            raise _HttpError(413, f"payload too large (max {_MAX_BODY // 1024} KB)")
        if not length:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8")) or {}
        except json.JSONDecodeError as exc:
            raise ValueError(f"invalid JSON: {exc}")

    def _route(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        method = self.command

        if not _rate_ok(self.client_address[0]):
            return self._send_json({"error": "rate limit exceeded — slow down"}, 429)

        if method == "OPTIONS":
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()
            return

        # API
        if path == "/api/health":
            return self._send_json({"ok": True, "version": "1.0.0"})
        if path == "/api/config":
            c = llm.get_config()
            return self._send_json({
                "llm_configured": llm.is_configured(),
                "model": c["model"],
                "llm_failed": causal._llm_failed,
                "llm_calls": causal._llm_calls,
                "llm_budget": causal._LLM_BUDGET,
                "llm_cache": llm.cache_stats(),
                "llm_last_error": (llm.get_last_error() or "")[:200],
            })
        if path == "/api/llm-config" and method == "GET":
            return self._send_json(_masked_llm_config())
        if path == "/api/samples":
            return self._send_json(_load_samples())

        if path.startswith("/api/"):
            # ---- GET endpoints ----
            if method == "GET":
                if path == "/api/trajectory":
                    job = (urllib.parse.parse_qs(parsed.query).get("job") or [""])[0]
                    if not job:
                        return self._send_json({"error": "job required"}, 400)
                    rec = get_trajectory(job)
                    if rec is None:
                        return self._send_json({"error": "job not found", "active": False}, 404)
                    return self._send_json(rec)
                if path == "/api/projects":
                    return self._send_json(list_projects())
                if path.startswith("/api/projects/"):
                    pid = path.rsplit("/", 1)[-1]
                    with _lock:
                        p = projects.get(pid)
                    if not p:
                        return self._send_json({"error": "project not found"}, 404)
                    return self._send_json(_project_view(p))
                if path.startswith("/api/jobs/"):
                    jid = path.rsplit("/", 1)[-1]
                    with _lock:
                        j = _jobs.get(jid)
                        rec = dict(j) if j else None
                    if rec is None:
                        return self._send_json({"error": "job not found"}, 404)
                    return self._send_json(rec)
                return self._send_json({"error": "not found"}, 404)

            if method != "POST":
                return self._send_json({"error": "method not allowed"}, 405)
            try:
                body = self._read_body()
                if path not in _POST_ROUTES:
                    return self._send_json({"error": "not found"}, 404)
                if body.get("async") and path in _ASYNC_ENDPOINTS:
                    return self._send_json(_run_async(path, body), 202)
                out = _dispatch_post(path, body)
                return self._send_json(out)
            except _HttpError as exc:
                return self._send_json({"error": str(exc)}, exc.status)
            except ValueError as exc:
                return self._send_json({"error": str(exc)}, 400)
            except Exception as exc:  # noqa: BLE001
                log.error("unhandled error on %s %s\n%s", method, path, traceback.format_exc())
                return self._send_json({"error": f"server error: {exc}"}, 500)

        # static
        if method != "GET":
            return self._send_json({"error": "method not allowed"}, 405)
        return self._serve_static(path)

    def _serve_static(self, path: str):
        rel = path.lstrip("/") or "index.html"
        # prevent path traversal
        full = os.path.normpath(os.path.join(STATIC_DIR, rel))
        if not full.startswith(STATIC_DIR):
            return self._send_json({"error": "forbidden"}, 403)
        if not os.path.isfile(full):
            return self._send_json({"error": "not found"}, 404)
        ext = os.path.splitext(full)[1].lower()
        with open(full, "rb") as f:
            return self._send_bytes(f.read(), MIME.get(ext, "application/octet-stream"))

    def do_GET(self):
        self._route()

    def do_POST(self):
        self._route()

    def do_OPTIONS(self):
        self._route()

    def log_message(self, fmt, *args):  # per-request noise goes to DEBUG
        log.debug("http %s %s", self.address_string(), fmt % args)


def main():
    _setup_logging()
    _load_dotenv()
    _load_projects()
    _load_llm_config()
    trajectory.set_sink(_traj_sink)
    # RIAK_* is the canonical name; legacy MIROFISH_* still honoured for compat
    port = int(os.environ.get("RIAK_PORT") or os.environ.get("MIROFISH_PORT", "8000"))
    host = os.environ.get("RIAK_HOST") or os.environ.get("MIROFISH_HOST", "127.0.0.1")
    httpd = ThreadingHTTPServer((host, port), Handler)
    c = llm.get_config()
    llm_state = f"LLM: {c['model']} @ {c['base_url']}" if llm.is_configured() else "LLM: offline (rule-based)"
    print(f"\n  Riak is running")
    print(f"  →  http://{host}:{port}")
    print(f"  →  {llm_state}")
    print(f"  →  projects on disk: {DATA_DIR}\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")


if __name__ == "__main__":
    main()
