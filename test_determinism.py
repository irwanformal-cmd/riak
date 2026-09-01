"""Determinism test suite — Wanion advertises "deterministic per seed".

Run:  python3 test_determinism.py

Same (seed_text, seed, config, lang) must rebuild the identical web — node
texts, edges and weights — and `predict` must return identical results on
repeated calls. A DIFFERENT seed must change at least something (weights or
structure). Tests force the offline (rule-based) path so no network access
can sneak in and break reproducibility.
"""
import os
import unittest

# force the offline rule-based engine even if the shell exports LLM credentials
for _k in ("LLM_BASE_URL", "LLM_MODEL_NAME", "LLM_API_KEY"):
    os.environ.pop(_k, None)

from engine import causal, llm  # noqa: E402

llm.set_runtime_config({})  # no runtime override either

SEED_TEXT = "Fuel prices rise sharply and workers protest in the capital."
CONFIG = {"branching": 3, "depth": 2, "max_nodes": 100}
LANG = "en"
SEED = 7


def signature(web):
    """Everything that must be reproducible: node texts in order, and the
    edges with their relations and weights. (web['id'] is a uuid and is
    intentionally excluded — identity, not content.)"""
    return (
        [n["text"] for n in web["nodes"]],
        [(e["source"], e["target"], e["relation"], e["weight"]) for e in web["edges"]],
    )


class TestDeterminism(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.web_a = causal.build_web(SEED_TEXT, SEED, dict(CONFIG), LANG)
        cls.web_b = causal.build_web(SEED_TEXT, SEED, dict(CONFIG), LANG)

    def test_web_has_content(self):
        self.assertGreater(self.web_a["n_nodes"], 1)
        self.assertGreater(self.web_a["n_edges"], 0)

    def test_same_seed_identical_nodes(self):
        self.assertEqual([n["text"] for n in self.web_a["nodes"]],
                         [n["text"] for n in self.web_b["nodes"]])

    def test_same_seed_identical_node_details(self):
        # full node dicts (states, polarities, levels...) must match too
        self.assertEqual(self.web_a["nodes"], self.web_b["nodes"])

    def test_same_seed_identical_edges_and_weights(self):
        ea = [(e["source"], e["target"], e["relation"], e["weight"]) for e in self.web_a["edges"]]
        eb = [(e["source"], e["target"], e["relation"], e["weight"]) for e in self.web_b["edges"]]
        self.assertEqual(ea, eb)

    def test_same_seed_identical_full_signature(self):
        self.assertEqual(signature(self.web_a), signature(self.web_b))

    def test_predict_identical_twice_same_web(self):
        web = causal.build_web(SEED_TEXT, SEED, dict(CONFIG), LANG)
        p1 = causal.predict(web, LANG)
        p2 = causal.predict(web, LANG)  # second call on the same (mutated) web
        self.assertEqual(p1, p2)

    def test_predict_identical_across_rebuilds(self):
        p1 = causal.predict(causal.build_web(SEED_TEXT, SEED, dict(CONFIG), LANG), LANG)
        p2 = causal.predict(causal.build_web(SEED_TEXT, SEED, dict(CONFIG), LANG), LANG)
        self.assertEqual(p1, p2)
        self.assertEqual(p1["most_likely_chain"], p2["most_likely_chain"])
        self.assertEqual(p1["confidence"], p2["confidence"])
        self.assertEqual(p1["summary"], p2["summary"])

    def test_different_seed_gives_some_difference(self):
        base = signature(causal.build_web(SEED_TEXT, SEED, dict(CONFIG), LANG))
        others = [signature(causal.build_web(SEED_TEXT, s, dict(CONFIG), LANG))
                  for s in (SEED + 1, SEED + 2, SEED + 3, SEED + 4)]
        self.assertTrue(any(sig != base for sig in others),
                        "a different seed must change weights or structure")

    def test_deterministic_across_languages(self):
        w1 = causal.build_web(SEED_TEXT, SEED, dict(CONFIG), "id")
        w2 = causal.build_web(SEED_TEXT, SEED, dict(CONFIG), "id")
        self.assertEqual(signature(w1), signature(w2))


if __name__ == "__main__":
    unittest.main(verbosity=2)
