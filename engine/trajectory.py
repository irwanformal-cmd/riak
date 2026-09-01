"""Trajectory tracker — record what the engine is doing as it builds/simulates,
so the UI can show live progress (a bit like the DeepSeek Harness trajectory view).

The engine modules (llm.py, causal.py) call push() with lightweight step events. The
server wires a sink that stores events per job id. The frontend polls an endpoint and
renders the running list, including which step is active.

This module has NO dependencies on the rest of the engine, so importing it anywhere is
safe (no circular imports).
"""

from __future__ import annotations

import threading
import time

_lock = threading.Lock()
_sink = None          # callable(event: dict) -> None, set by the server
_running = 0          # increment when a job begins, decrement when it ends


def set_sink(fn) -> None:
    """The server installs a sink callable to receive every trajectory event."""
    global _sink
    with _lock:
        _sink = fn


def push(kind: str, detail: str, **extra) -> None:
    """Record one step. `kind` is a short tag like 'llm', 'tool', 'derive', 'bash'...
    which the UI turns into an icon/colour. `detail` is the human-readable label.
    Events are cheap; the sink may filter/decorate them."""
    fn = _sink
    if fn is None:
        return
    ev = {
        "t": time.time(),
        "kind": kind,
        "detail": detail,
    }
    ev.update(extra)
    try:
        fn(ev)
    except Exception:  # noqa: BLE001 — a broken sink must never crash the engine
        pass


def begin() -> None:
    global _running
    with _lock:
        _running += 1


def end() -> None:
    global _running
    with _lock:
        _running = max(0, _running - 1)


def is_active() -> bool:
    with _lock:
        return _running > 0


# ---------------------------------------------------------------- job context
# The server routes events to a trajectory record by job id. Engine code now
# makes PARALLEL LLM calls from worker threads (fast builds, parallel compare)
# — threading.local means a worker would lose the routing context unless the
# parent explicitly hands it over. These helpers make that hand-off one line.
_tl = threading.local()


def set_job(job) -> None:
    _tl.job = job


def get_job():
    return getattr(_tl, "job", None)


def inherit_job(parent_job):
    """Decorator-free context copier: returns a wrapper that runs fn with the
    parent's job context installed on the current (worker) thread."""
    def wrap(fn):
        def inner(*a, **kw):
            set_job(parent_job)
            return fn(*a, **kw)
        return inner
    return wrap
