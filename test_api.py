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
import time
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# force the offline rule-based engine even if the shell exports LLM credentials
for _k in ("LLM_BASE_URL", "LLM_MODEL_NAME", "LLM_API_KEY"):
    os.environ.pop(_k, None)

import server  # noqa: E402
from engine import fetch, llm  # noqa: E402

llm.set_runtime_config({})


class QuietHandler(server.Handler):
    """server.Handler without the per-request stdout logging."""

    def log_message(self, fmt, *args):
        pass


class TestAPI(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        # isolate storage: temp data dir + a private projects dict
        cls._tmp = tempfile.TemporaryDirectory(prefix="riak-test-")
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
    def setUp(self):
        # keep rate-limit buckets hermetic between tests
        server._RATE.clear()
        server._HEAVY_RATE.clear()

    def _request(self, method, path, body=None, headers=None):
        url = "http://127.0.0.1:%d%s" % (self.port, path)
        data = None
        headers = dict(headers or {})
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

    # ------------------------------------------------ new feature endpoints
    def test_simulate_includes_ensemble_and_timeline(self):
        p = self._create_project()
        status, body = self._post("/api/simulate", {"project_id": p["id"]})
        self.assertEqual(status, 200, body)
        pred = body["prediction"]
        self.assertIn("timeline", pred)
        self.assertIn("feedback_loop", pred)
        ens = pred.get("ensemble")
        self.assertIsInstance(ens, dict, "simulate runs a Monte-Carlo ensemble by default")
        self.assertGreater(ens["runs"], 1)
        conf = ens["confidence"]
        self.assertLessEqual(conf["lo"], conf["mean"])
        self.assertLessEqual(conf["mean"], conf["hi"])
        self.assertGreaterEqual(ens["chain_stability"], 0.0)
        self.assertLessEqual(ens["chain_stability"], 1.0)

    def test_compare_scenarios(self):
        p = self._create_project()
        status, body = self._post("/api/compare", {
            "project_id": p["id"],
            "scenarios": [
                {"name": "no action", "interventions": []},
                {"name": "subsidy", "interventions": [{"text": "the government adds a subsidy"}]},
            ],
        })
        self.assertEqual(status, 200, body)
        self.assertEqual(len(body["scenarios"]), 2)
        for sc in body["scenarios"]:
            self.assertIn("prediction", sc)
            self.assertIn("confidence", sc["prediction"])
        status, body = self._post("/api/compare", {"project_id": p["id"], "scenarios": []})
        self.assertEqual(status, 400)

    def test_sensitivity_sweep(self):
        p = self._create_project()
        edge = p["web"]["edges"][0]
        status, body = self._post("/api/sensitivity", {
            "project_id": p["id"], "source": edge["source"], "target": edge["target"],
            "weights": [0.2, 0.5, 0.9],
        })
        self.assertEqual(status, 200, body)
        self.assertEqual(len(body["points"]), 3)
        self.assertEqual([pt["weight"] for pt in body["points"]], [0.2, 0.5, 0.9])
        status, body = self._post("/api/sensitivity", {
            "project_id": p["id"], "source": "nope", "target": "nada", "weights": [0.5]})
        self.assertEqual(status, 400)

    def test_undo_redo_cycle(self):
        p = self._create_project()
        # nothing to undo yet
        status, body = self._post("/api/undo", {"project_id": p["id"]})
        self.assertEqual(status, 400)
        # make an edit, then undo it, then redo it
        status, body = self._post("/api/graph", {
            "project_id": p["id"],
            "mutations": [{"op": "add_root", "text": "a brand new intervention root"}],
        })
        self.assertEqual(status, 200, body)
        status, body = self._post("/api/undo", {"project_id": p["id"]})
        self.assertEqual(status, 200, body)
        self.assertTrue(body["can_redo"])
        status, body = self._post("/api/redo", {"project_id": p["id"]})
        self.assertEqual(status, 200, body)
        self.assertTrue(body["can_undo"])
        self.assertFalse(body["can_redo"])

    def test_export_html(self):
        p = self._create_project()
        self._post("/api/simulate", {"project_id": p["id"]})
        status, body = self._post("/api/export", {"project_id": p["id"], "format": "html"})
        self.assertEqual(status, 200, body)
        self.assertEqual(body["format"], "html")
        self.assertTrue(body["filename"].endswith(".html"))
        self.assertIn("<!doctype html>", body["content"].lower())
        self.assertIn("Riak", body["content"])

    def test_async_job_pattern(self):
        status, body = self._post("/api/projects", {
            "name": "async test", "seed_text": "Fuel prices rise sharply in the city.",
            "seed": 9, "config": {"branching": 2, "depth": 1, "max_nodes": 20},
            "async": True,
        })
        self.assertEqual(status, 202, body)
        self.assertIn("job_id", body)
        job_id = body["job_id"]
        result = None
        for _ in range(50):  # poll up to ~5s
            status, job = self._get("/api/jobs/%s" % job_id)
            self.assertEqual(status, 200)
            if job["status"] != "running":
                result = job
                break
            time.sleep(0.1)
        self.assertIsNotNone(result, "async job never finished")
        self.assertEqual(result["status"], "done", result.get("error"))
        self.assertIn("web", result["result"])
        status, body = self._get("/api/jobs/does-not-exist")
        self.assertEqual(status, 404)

    def test_body_size_limit_413(self):
        # the server rejects >2MB payloads without reading them; urllib may either
        # receive the clean 413 or hit a broken pipe while still uploading — both
        # prove the rejection works.
        try:
            status, body = self._post("/api/simulate", {"project_id": "x" * (3 * 1024 * 1024)})
        except urllib.error.URLError:
            return  # connection cut mid-upload: the server refused the payload
        self.assertEqual(status, 413)
        self.assertIn("error", body)

    # ---------------------------------------------------- security hardening
    def test_no_cors_wildcard_and_security_headers(self):
        """The API must not be readable cross-origin (drive-by protection):
        no Access-Control-Allow-Origin, plus the standard hardening headers."""
        url = "http://127.0.0.1:%d/api/health" % self.port
        with urllib.request.urlopen(url, timeout=10) as resp:
            hdrs = resp.headers
            self.assertNotIn("Access-Control-Allow-Origin", hdrs)
            self.assertEqual(hdrs.get("X-Content-Type-Options"), "nosniff")
            self.assertEqual(hdrs.get("Referrer-Policy"), "no-referrer")
            self.assertEqual(hdrs.get("X-Frame-Options"), "DENY")

    def test_cross_origin_request_rejected(self):
        status, body = self._get_headers("/api/projects", {"Origin": "http://evil.example"})
        self.assertEqual(status, 403)
        self.assertIn("cross-origin", body.get("error", ""))

    def test_same_origin_request_allowed(self):
        origin = "http://127.0.0.1:%d" % self.port
        status, _ = self._get_headers("/api/health", {"Origin": origin})
        self.assertEqual(status, 200)

    def _get_headers(self, path, headers):
        url = "http://127.0.0.1:%d%s" % (self.port, path)
        req = urllib.request.Request(url, headers=headers, method="GET")
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                return resp.status, json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            try:
                return exc.code, json.loads(exc.read().decode("utf-8"))
            finally:
                exc.close()

    def test_origin_and_auth_helpers(self):
        # no Origin (curl/scripts) is fine; foreign Origin is not
        self.assertTrue(server._origin_ok(None, "127.0.0.1:8000"))
        self.assertTrue(server._origin_ok("http://127.0.0.1:8000", "127.0.0.1:8000"))
        self.assertFalse(server._origin_ok("http://evil.example", "127.0.0.1:8000"))
        self.assertFalse(server._origin_ok("not a url", "127.0.0.1:8000"))
        # without RIAK_TOKEN configured everything is allowed (localhost mode)
        self.assertTrue(server._auth_ok(None))
        self.assertTrue(server._auth_ok("Bearer anything"))

    def test_heavy_rate_limiter_bucket(self):
        ip = "10.9.9.9"  # unique ip — never collides with the HTTP tests
        for _ in range(server._HEAVY_RATE_LIMIT):
            self.assertTrue(server._heavy_rate_ok(ip))
        self.assertFalse(server._heavy_rate_ok(ip))

    # ---------------------------------------------------- URL import / SSRF
    def test_fetch_url_rejects_localhost(self):
        """The endpoint must refuse loopback targets (SSRF protection)."""
        status, body = self._post("/api/fetch-url", {"url": "http://127.0.0.1:%d/api/health" % self.port})
        self.assertEqual(status, 400)
        self.assertIn("private", body.get("error", ""))

    def test_fetch_url_rejects_cloud_metadata(self):
        status, body = self._post("/api/fetch-url", {"url": "http://169.254.169.254/latest/meta-data"})
        self.assertEqual(status, 400)
        self.assertIn("private", body.get("error", ""))

    def test_fetch_url_rejects_bad_scheme(self):
        for url in ("file:///etc/passwd", "ftp://example.com/x", "gopher://x"):
            status, body = self._post("/api/fetch-url", {"url": url})
            self.assertEqual(status, 400, url)
            self.assertIn("http", body.get("error", ""))

    def test_fetch_url_requires_url(self):
        status, body = self._post("/api/fetch-url", {})
        self.assertEqual(status, 400)

    def test_fetch_validate_url_unit(self):
        # direct unit checks of the SSRF guard (no network needed)
        self.assertRaises(fetch.FetchError, fetch.validate_url, "http://127.0.0.1/x")
        self.assertRaises(fetch.FetchError, fetch.validate_url, "http://192.168.1.1/x")
        self.assertRaises(fetch.FetchError, fetch.validate_url, "http://10.0.0.5/x")
        self.assertRaises(fetch.FetchError, fetch.validate_url, "http://[::1]/x")
        self.assertRaises(fetch.FetchError, fetch.validate_url, "http://169.254.169.254/")
        self.assertRaises(fetch.FetchError, fetch.validate_url, "javascript:alert(1)")
        # allow_private bypass is honoured (used by stub-server tests)
        ok = fetch.validate_url("http://127.0.0.1:9/x", allow_private=True)
        self.assertTrue(ok.startswith("http://127.0.0.1"))

    def test_fetch_extract_text_unit(self):
        raw = ("<html><head><title> Fuel prices rise </title>"
               "<style>body{color:red}</style></head><body>"
               "<nav>menu junk</nav><script>evil()</script>"
               "<h1>Fuel prices rise sharply</h1>"
               "<p>The government raised fuel prices by 30 percent overnight, "
               "sparking immediate reactions from transport workers.</p>"
               "<footer>junk</footer></body></html>")
        title, text = fetch.extract_text(raw)
        self.assertEqual(title, "Fuel prices rise")
        self.assertIn("raised fuel prices by 30 percent", text)
        self.assertNotIn("evil()", text)
        self.assertNotIn("menu junk", text)
        self.assertNotIn("color:red", text)


if __name__ == "__main__":
    unittest.main(verbosity=2)
