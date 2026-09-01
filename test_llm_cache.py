"""Regression tests for the LLM response cache in engine/llm.py.

Run:  python3 test_llm_cache.py

Background: the first cache implementation used a plain threading.Lock and
chat() called _cache_load() while already holding it — a self-deadlock that
froze /api/config (and any other cache-touching path) on the very first LLM
call. These tests exercise the real code paths against a stub OpenAI-compatible
server, including concurrent cache access, so a regression fails loudly here.
"""
import json
import os
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from engine import llm  # noqa: E402


class _StubHandler(BaseHTTPRequestHandler):
    """Minimal OpenAI-compatible /chat/completions stub."""

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        self.rfile.read(length)
        self.server.hits += 1
        body = json.dumps({
            "choices": [{"message": {"content": "stub reply"}}]
        }).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


class TestLlmCache(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), _StubHandler)
        cls.httpd.hits = 0
        cls.httpd.daemon_threads = True
        cls.port = cls.httpd.server_address[1]
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()
        # redirect the cache to a temp file — never touch the real data/ dir
        cls._tmp = tempfile.TemporaryDirectory(prefix="wanion-cache-test-")
        cls._orig_cache_path = llm._CACHE_PATH
        llm._CACHE_PATH = os.path.join(cls._tmp.name, "llm_cache.json")
        llm.set_runtime_config({
            "base_url": "http://127.0.0.1:%d/v1" % cls.port,
            "model": "stub-model", "api_key": "", "auth_type": "none",
        })

    @classmethod
    def tearDownClass(cls):
        llm.set_runtime_config({})
        llm._CACHE_PATH = cls._orig_cache_path
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls._tmp.cleanup()

    def setUp(self):
        llm.clear_cache()
        self.httpd.hits = 0

    def test_chat_returns_and_caches(self):
        msgs = [{"role": "user", "content": "hello"}]
        r1 = llm.chat(msgs)
        self.assertEqual(r1, "stub reply")
        self.assertEqual(self.httpd.hits, 1)
        # identical call must be served from cache — no second HTTP hit
        r2 = llm.chat(msgs)
        self.assertEqual(r2, "stub reply")
        self.assertEqual(self.httpd.hits, 1)
        stats = llm.cache_stats()
        self.assertEqual(stats["entries"], 1)
        self.assertEqual(stats["hits"], 1)

    def test_different_prompts_are_separate_entries(self):
        llm.chat([{"role": "user", "content": "a"}])
        llm.chat([{"role": "user", "content": "b"}])
        self.assertEqual(self.httpd.hits, 2)
        self.assertEqual(llm.cache_stats()["entries"], 2)

    def test_no_deadlock_under_concurrent_access(self):
        """Many threads hitting chat()+cache_stats() together must all finish."""
        errors = []

        def worker(i):
            try:
                llm.chat([{"role": "user", "content": "shared prompt"}])
                llm.cache_stats()
            except Exception as exc:  # noqa: BLE001
                errors.append(exc)

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(10)]
        for th in threads:
            th.start()
        deadline = time.time() + 20
        for th in threads:
            th.join(timeout=max(0.1, deadline - time.time()))
        alive = [th for th in threads if th.is_alive()]
        self.assertFalse(alive, "deadlock: %d thread(s) still stuck" % len(alive))
        self.assertFalse(errors)
        # in-flight requests are not deduped (acceptable), but the result must be
        # cached afterwards: one more identical call adds no new HTTP hit.
        hits_before = self.httpd.hits
        llm.chat([{"role": "user", "content": "shared prompt"}])
        self.assertEqual(self.httpd.hits, hits_before)

    def test_cache_persists_to_disk(self):
        llm.chat([{"role": "user", "content": "persist me"}])
        self.assertTrue(os.path.isfile(llm._CACHE_PATH))
        with open(llm._CACHE_PATH, encoding="utf-8") as f:
            data = json.load(f)
        self.assertEqual(len(data), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
