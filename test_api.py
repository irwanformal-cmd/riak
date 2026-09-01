"""HTTP integration test suite for server.py (stdlib only).

Run:  python3 test_api.py

Boots server.py's ThreadingHTTPServer on an ephemeral port in a background
thread, with DATA_DIR redirected to a TemporaryDirectory and the projects
store swapped out, so the real data/ directory is never touched. The server
thread is shut down cleanly in tearDownClass.
"""
import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# force the offline rule-based engine even if the shell exports LLM credentials
for _k in ("LLM_BASE_URL", "LLM_MODEL_NAME", "LLM_API_KEY"):
    os.environ.pop(_k, None)

import server  # noqa: E402
from engine import llm  # noqa: E402

llm.set_runtime_config({})


class QuietHandler(server.Handler):
    """server.Handler without the per-request stdout logging."""

    def log_message(self, fmt, *args):
        pass


class TestAPI(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        # isolate storage: temp data dir + a private projects dict
        cls._tmp = tempfile.TemporaryDirectory(prefix="wanion-test-")
        cls._orig_data_dir = server.DATA_DIR
        cls._orig_llm_config_path = server.LLM_CONFIG_PATH
        server.DATA_DIR = cls._tmp.name
        server.LLM_CONFIG_PATH = os.path.join(cls._tmp.name, "llm_config.json")
        cls._saved_projects = dict(server.projects)
        server.projects.clear()

        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
        cls.httpd.daemon_threads = True
        cls.port = cls.httpd.server_address[1]
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join(timeout=10)
        server.projects.clear()
        server.projects.update(cls._saved_projects)
        server.DATA_DIR = cls._orig_data_dir
        server.LLM_CONFIG_PATH = cls._orig_llm_config_path
        cls._tmp.cleanup()

    # ------------------------------------------------------------ helpers
    def _request(self, method, path, body=None):
        url = "http://127.0.0.1:%d%s" % (self.port, path)
        data = None
        headers = {}
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                return resp.status, json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            try:
                raw = exc.read().decode("utf-8")
                try:
                    return exc.code, json.loads(raw)
                except json.JSONDecodeError:
                    return exc.code, {"_raw": raw}
            finally:
                exc.close()

    def _get(self, path):
        return self._request("GET", path)

    def _post(self, path, body):
        return self._request("POST", path, body)

    def _create_project(self):
        status, p = self._post("/api/projects", {
            "name": "API test scenario",
            "seed_text": "Fuel prices rise sharply in the city.",
            "seed": 5,
            "config": {"branching": 2, "depth": 1, "max_nodes": 20},
            "lang": "en",
        })
        self.assertEqual(status, 200, p)
        self.assertIn("id", p)
        return p

    # ------------------------------------------------------------ tests
    def test_health(self):
        status, body = self._get("/api/health")
        self.assertEqual(status, 200)
        self.assertTrue(body.get("ok"))

    def test_samples_returns_list(self):
        status, body = self._get("/api/samples")
        self.assertEqual(status, 200)
        self.assertIsInstance(body, list)
        self.assertTrue(body, "samples/ ships with the app; expected at least one sample")

    def test_create_and_list_project(self):
        p = self._create_project()
        self.assertIn("web", p)
        self.assertGreater(p["web"]["n_nodes"], 0)
        status, listing = self._get("/api/projects")
        self.assertEqual(status, 200)
        self.assertIsInstance(listing, list)
        self.assertIn(p["id"], [item["id"] for item in listing])

    def test_get_project_by_id(self):
        p = self._create_project()
        status, got = self._get("/api/projects/%s" % p["id"])
        self.assertEqual(status, 200)
        self.assertEqual(got["id"], p["id"])
        status, body = self._get("/api/projects/no_such_project")
        self.assertEqual(status, 404)
        self.assertIn("error", body)

    def test_simulate_returns_prediction(self):
        p = self._create_project()
        status, body = self._post("/api/simulate", {"project_id": p["id"]})
        self.assertEqual(status, 200, body)
        pred = body.get("prediction")
        self.assertIsInstance(pred, dict)
        for key in ("most_likely_chain", "confidence", "top_outcomes", "summary"):
            self.assertIn(key, pred)
        self.assertGreaterEqual(pred["confidence"], 0.0)
        self.assertLessEqual(pred["confidence"], 1.0)
        self.assertIn("web", body)

    def test_simulate_unknown_project_400(self):
        status, body = self._post("/api/simulate", {"project_id": "nope"})
        self.assertEqual(status, 400)
        self.assertIn("error", body)

    def test_export_json(self):
        p = self._create_project()
        status, body = self._post("/api/export", {"project_id": p["id"], "format": "json"})
        self.assertEqual(status, 200, body)
        self.assertEqual(body["format"], "json")
        self.assertTrue(body["filename"].endswith(".json"))
        exported = json.loads(body["content"])
        self.assertEqual(exported["id"], p["id"])

    def test_export_markdown(self):
        p = self._create_project()
        status, body = self._post("/api/export", {"project_id": p["id"], "format": "markdown"})
        self.assertEqual(status, 200, body)
        self.assertEqual(body["format"], "markdown")
        self.assertIn("# ", body["content"])

    def test_create_project_requires_seed_text(self):
        status, body = self._post("/api/projects", {"name": "empty"})
        self.assertEqual(status, 400)
        self.assertIn("error", body)

    def test_post_invalid_path_404_json(self):
        status, body = self._post("/api/definitely-not-a-route", {"x": 1})
        self.assertEqual(status, 404)
        self.assertIn("error", body)

    def test_get_invalid_api_path_404_json(self):
        status, body = self._get("/api/definitely-not-a-route")
        self.assertEqual(status, 404)
        self.assertIn("error", body)

    def test_project_persisted_to_temp_data_dir(self):
        p = self._create_project()
        path = os.path.join(server.DATA_DIR, "%s.json" % p["id"])
        self.assertTrue(os.path.isfile(path), "project must be saved under the temp DATA_DIR")
        self.assertTrue(path.startswith(self._tmp.name),
                        "test must never write into the real data/ dir")


if __name__ == "__main__":
    unittest.main(verbosity=2)
