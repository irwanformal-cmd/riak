"""Causal-engine test suite (spec section 36, tests A-L).

Run:  python3 test_causal.py
The engine is the causal authority; these tests exercise the validator directly plus
a few integration checks on build_web / apply_interventions.
"""
import json
import random
import unittest

from engine import causal, llm


def parent_node(text, scale="individual", state=None):
    return {"text": text, "scale": scale, "state": state or {}}


def llm_cand(text, mechanism="direct mechanism", temporal="immediate", scale=None,
             domain=None, state_changes=None, likelihood=0.7):
    return {"text": text, "mechanism": mechanism, "temporal_relation": temporal,
            "scale": scale, "domain": domain, "state_changes": state_changes,
            "source": "llm", "relation": "leads_to", "probability": likelihood,
            "polarity": 0.0}


class TestCausalValidator(unittest.TestCase):

    def test_A_direct_consequence(self):
        """A simple state must generate immediate consequences (accepted)."""
        cand = llm_cand("braking distance grows", mechanism="higher speed cuts reaction margin",
                        temporal="immediate", scale="individual", domain="physical",
                        state_changes=[{"variable": "speed", "from": "normal", "to": "high"}])
        ok, reason = causal.validate_candidate(cand, parent_node("I ride faster"), "en")
        self.assertTrue(ok, reason)

    def test_B_teleportation(self):
        """A->D is rejected when it needs intermediate states (non-immediate temporal)."""
        cand = llm_cand("national labor market changes", mechanism="eventual knock-on", temporal="long_term")
        ok, _ = causal.validate_candidate(cand, parent_node("I ride faster"))
        self.assertFalse(ok)

    def test_C_semantic_association(self):
        """Unrelated topical events (macro keyword) are rejected."""
        cand = llm_cand("skills gaps in the workforce widen", mechanism="related topic", scale="national")
        ok, reason = causal.validate_candidate(cand, parent_node("I go to school"))
        self.assertFalse(ok)
        self.assertIn("scale jump", reason)

    def test_D_ancestor_contamination(self):
        """An ancestor's macro consequence must not be reused from a local descendant."""
        cand = llm_cand("consumer spending softens", mechanism="reused from ancestor", scale="national")
        ok, _ = causal.validate_candidate(cand, parent_node("I ride faster"))
        self.assertFalse(ok)

    def test_E_domain_jump(self):
        """Unsupported domain transition (individual event -> national policy) rejected."""
        cand = llm_cand("national education policy changes", mechanism="school mention", scale="national")
        ok, _ = causal.validate_candidate(cand, parent_node("I ride faster"))
        self.assertFalse(ok)

    def test_F_scale_jump(self):
        """individual -> global in one hop is rejected."""
        cand = llm_cand("global geopolitics shifts", mechanism="...", scale="global")
        ok, reason = causal.validate_candidate(cand, parent_node("I ride faster"))
        self.assertFalse(ok)
        self.assertIn("scale jump", reason)

    def test_G_physics(self):
        """Physically impossible outcome (negative speed) rejected."""
        cand = llm_cand("bike stops instantly", mechanism="braking",
                        state_changes=[{"variable": "speed", "from": 40, "to": -10}])
        ok, reason = causal.validate_candidate(cand, parent_node("I brake"))
        self.assertFalse(ok)
        self.assertIn("negative", reason)

    def test_H_mathematics(self):
        """Mathematically inconsistent quantity (negative time) rejected."""
        cand = llm_cand("travel time inverts", mechanism="...",
                        state_changes=[{"variable": "time", "from": 10, "to": -3}])
        ok, _ = causal.validate_candidate(cand, parent_node("I ride"))
        self.assertFalse(ok)

    def test_I_probability_no_rescue(self):
        """Probability cannot make an invalid causal edge valid."""
        cand = llm_cand("national labor market changes", mechanism="...", scale="national", likelihood=0.99)
        ok, _ = causal.validate_candidate(cand, parent_node("I ride faster"))
        self.assertFalse(ok)

    def test_J_intervention_local_resim(self):
        """Intervention adds/expands but preserves the untouched existing graph."""
        web = causal.build_web("A factory closes and lays off workers.", 2,
                               {"branching": 4, "depth": 2, "max_nodes": 60}, "en")
        before_ids = {n["id"] for n in web["nodes"]}
        web2 = causal.apply_interventions(web, [{"text": "workers retrain in new skills"}],
                                          random.Random(3), {"branching": 3, "depth": 1, "max_nodes": 100}, "en")
        after_ids = {n["id"] for n in web2["nodes"]}
        self.assertTrue(before_ids <= after_ids, "existing nodes must be preserved")
        self.assertGreater(len(after_ids), len(before_ids), "intervention must expand")

    def test_K_path_dependency(self):
        """State is carried forward and updated (path dependency / state differencing)."""
        s = causal._state_merge({"weather": "rainy", "speed": "normal"},
                                [{"variable": "speed", "from": "normal", "to": "high"}])
        self.assertEqual(s["weather"], "rainy")  # ancestor state preserved
        self.assertEqual(s["speed"], "high")      # new state applied

    def test_L_multiple_outcomes(self):
        """One node can yield multiple valid futures."""
        cands = [
            llm_cand("braking distance grows", mechanism="higher speed"),
            llm_cand("reaction margin shrinks", mechanism="less time to react"),
            llm_cand("traction matters more", mechanism="wet road"),
        ]
        kept = [c for c in cands if causal.validate_candidate(c, parent_node("I speed up in rain"))[0]]
        self.assertGreaterEqual(len(kept), 2)

    def test_M_offline_no_teleportation(self):
        """Integration: offline build must not emit the KB's macro teleportation nodes."""
        web = causal.build_web("Aku berangkat sekolah dan berkendara cepat.", 1,
                               {"branching": 6, "depth": 2, "max_nodes": 100}, "id")
        texts = " ".join(n["text"] for n in web["nodes"])
        self.assertNotIn("kesenjangan", texts)
        self.assertNotIn("tenaga kerja", texts)
        self.assertNotIn("belanja konsumen", texts)

    def test_S_personal_travel_no_teleport(self):
        """A personal 'I go to school / I'm late' act must yield relevant personal
        consequences (won't be late), never the KB's education-policy teleport
        ('kurangnya tenaga pendidikan')."""
        web = causal.build_web(
            "hari ini aku pergi ke sekolah jam 7 pagi dan telat, apa yang terjadi bila aku pergi jam 6 pagi",
            42, {"branching": 5, "depth": 2, "max_nodes": 100}, "id")
        texts = [n["text"] for n in web["nodes"] if n["type"] == "consequence"]
        joined = " ".join(texts).lower()
        # relevant personal outcomes are present
        self.assertTrue(any("tidak akan telat" in t or "lebih awal" in t for t in texts),
                        "expected a relevant 'won't be late' consequence, got: %s" % texts)
        # the education-policy teleport nodes are absent
        self.assertNotIn("tenaga pengajar", joined)
        self.assertNotIn("tenaga pendidik", joined)
        self.assertNotIn("kurikulum", joined)
        self.assertNotIn("kesenjangan", joined)

    def test_N_duplicate_rejected(self):
        """Duplicate candidate texts are collapsed to one node (no duplicate edges)."""
        saved = causal._use_llm
        causal._use_llm = lambda fn, *a: (
            [[{"text": "braking distance grows", "mechanism": "m", "likelihood": 0.7},
              {"text": "braking distance grows", "mechanism": "m", "likelihood": 0.8}]]
            if getattr(fn, "__name__", "") == "batch_expand" else None
        )
        try:
            res = causal._expand_many([("n0", "I ride fast", "")], 3, random.Random(0), "en",
                                      {"n0": {"text": "I ride fast", "scale": "individual"}})
            self.assertEqual(len(res["n0"]), 1, "duplicate candidates must be collapsed")
        finally:
            causal._use_llm = saved

    def test_O_institutional_domain_jump(self):
        """Institutional/political consequence from an individual event is rejected."""
        cand = {"text": "perdebatan reformasi kurikulum menguat", "mechanism": "rule-based knowledge base",
                "temporal_relation": "immediate", "scale": None, "source": "rule", "relation": "leads_to",
                "probability": 0.6, "polarity": 0.0}
        ok, reason = causal.validate_candidate(cand, parent_node("Aku berangkat sekolah"), "id")
        self.assertFalse(ok)
        self.assertIn("scale jump", reason)

    def test_P_empty_mechanism(self):
        """An LLM candidate with no causal mechanism is rejected."""
        cand = llm_cand("traffic slows", mechanism=None)
        ok, reason = causal.validate_candidate(cand, parent_node("I ride faster"))
        self.assertFalse(ok)
        self.assertIn("mechanism", reason)

    def test_Q_math_derivation_authority(self):
        """The engine (not the LLM) derives child state + probability + formula."""
        d = causal.mech.derive(
            {"state": {"speed_kmh": 60, "distance_km": 5, "road_wet": True}},
            {"operator": "travel_time", "speed_reduction": 0.3, "road_wet": True})
        self.assertIsNotNone(d)
        self.assertAlmostEqual(d["child_state"]["delay_min"], 2.1, places=1)
        self.assertGreater(d["probability"], 0.5)  # physics -> a strong link
        self.assertIn("frac", d["formula_latex"])

    def test_R_intervention_propagates_through_math(self):
        """A targeted intervention patches parent state; re-derived children reflect it."""
        saved = causal._use_llm
        causal._use_llm = lambda fn, *a: (
            [[{"text": "waktu tempuh naik", "operator": "travel_time", "speed_reduction": 0.3,
               "road_wet": True, "mechanism": "rain", "confidence": 0.8, "domain": "physical",
               "scale": "individual", "temporal_relation": "immediate", "likelihood": 0.9}]]
            if getattr(fn, "__name__", "") == "batch_expand" else None)
        try:
            web = causal.build_web("Aku pergi ke sekolah", 1,
                                   {"branching": 2, "depth": 2, "max_nodes": 20}, "id")
            root = web["nodes"][0]
            # snapshot ids BEFORE apply: apply_interventions mutates web["nodes"] in place
            old_ids = {x["id"] for x in web["nodes"]}
            web2 = causal.apply_interventions(web,
                [{"text": "hujan deras", "target": root["id"],
                  "state": {"road_wet": True, "speed_reduction": 0.5}}],
                random.Random(3), {"branching": 2, "depth": 2, "max_nodes": 30}, "id")
            new = [n for n in web2["nodes"] if n["id"] not in old_ids
                   and n.get("operator") == "travel_time"]
            self.assertTrue(new, "intervention must re-derive children")
            self.assertEqual(new[0]["state"]["speed_reduction"], 0.5)  # patched value propagated
            self.assertGreater(new[0]["state"]["delay_min"], 3.0)      # 0.5 -> ~5 min, not ~2
        finally:
            causal._use_llm = saved


    def test_T_llm_json_strict(self):
        """LLM response parsing must handle a trailing 'data: [DONE]' sentinel AND braces
        embedded inside a string value (a code-fenced JSON in `content`)."""
        # trailing streaming sentinel after a valid completion object
        ok = {"choices": [{"message": {"content": "ok"}}]}
        raw = json.dumps(ok) + "data: [DONE]\n\n"
        self.assertEqual(llm._load_json_strict(raw)["choices"][0]["message"]["content"], "ok")
        # braces inside a string value must not break parsing (old brace-depth code failed)
        raw2 = '{"choices":[{"message":{"content":"```json\\n{\\"a\\":1}\\n```"}}]}' + "data: [DONE]"
        d2 = llm._load_json_strict(raw2)
        self.assertIsNotNone(d2)
        self.assertIn("a", d2["choices"][0]["message"]["content"])
        # truncated/fenced JSON that failed to parse -> _parse_outcomes refuses (no garbage)
        self.assertIsNone(llm._parse_outcomes("```json\n{\"outcomes\":[{\"text\":\"x\",", 3))
        # a clean fenced JSON parses fine
        clean = '```json\n{"outcomes":[{"text":"won\\u0027t be late","mechanism":"leave earlier",' \
                '"temporal_relation":"immediate","scale":"individual","likelihood":0.8}]}\n```'
        out = llm._parse_outcomes(clean, 3)
        self.assertTrue(out)
        self.assertTrue(any("won" in o["text"] or "late" in o["text"] for o in out))



class TestTurboBuild(unittest.TestCase):
    """Turbo mode: one parallel subtree call per root instead of per-level calls."""

    def setUp(self):
        self._cfg = llm.is_configured
        self._sub = getattr(llm, "build_subtree", None)
        causal.trajectory.set_sink(None)

    def tearDown(self):
        llm.is_configured = self._cfg
        if self._sub is not None:
            llm.build_subtree = self._sub

    def _fake_llm(self):
        llm.is_configured = lambda: True
        def fake(root_text, topic, depth, branching, lang="en"):
            def lvl(pref, d):
                if d > depth:
                    return []
                return [{"text": f"{pref} outcome {d}.{i}", "mechanism": "direct effect",
                         "likelihood": 0.6, "relation": "causes",
                         "children": lvl(f"{pref}.{i}", d + 1)} for i in range(branching)]
            return {"text": root_text, "children": lvl("r", 1)}
        llm.build_subtree = fake

    def test_turbo_full_depth_and_waves(self):
        self._fake_llm()
        snaps = []
        web = causal.build_web("the central bank doubles interest rates overnight", 11,
                               {"branching": 2, "depth": 3, "max_nodes": 100, "turbo": True},
                               lang="en", on_progress=snaps.append)
        levels = {}
        for n in web["nodes"]:
            levels[n["level"]] = levels.get(n["level"], 0) + 1
        self.assertGreater(levels.get(3, 0), 0)
        ids = {n["id"] for n in web["nodes"]}
        for e in web["edges"]:
            self.assertIn(e["source"], ids)
            self.assertIn(e["target"], ids)
        # snapshots grow wave by wave and finish at the final web
        sizes = [x["n_nodes"] for x in snaps]
        self.assertEqual(sizes, sorted(sizes))
        self.assertEqual(sizes[-1], web["n_nodes"])

    def test_turbo_falls_back_to_rules_when_call_fails(self):
        llm.is_configured = lambda: True
        llm.build_subtree = lambda *a, **k: None
        web = causal.build_web("fuel prices rise sharply", 5,
                               {"branching": 2, "depth": 3, "max_nodes": 60, "turbo": True}, lang="en")
        self.assertGreaterEqual(max(n["level"] for n in web["nodes"]), 1)

    def test_turbo_flag_ignored_without_llm(self):
        a = causal.build_web("fuel prices rise sharply", 5,
                             {"branching": 2, "depth": 2, "max_nodes": 40, "turbo": True}, lang="en")
        b = causal.build_web("fuel prices rise sharply", 5,
                             {"branching": 2, "depth": 2, "max_nodes": 40}, lang="en")
        self.assertEqual(a["n_nodes"], b["n_nodes"])
        self.assertEqual([n["text"] for n in a["nodes"]], [n["text"] for n in b["nodes"]])


if __name__ == "__main__":
    unittest.main(verbosity=2)
