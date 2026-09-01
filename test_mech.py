"""Mechanism-operator test suite for engine/mech.py.

Run:  python3 test_mech.py

Calls every mechanism operator directly and asserts numeric sanity: speeds,
distances and times are non-negative, probabilities and uncertainties stay in
[0, 1], and every Derivation is dict-shaped like the existing mechanisms
return. Edge cases: zero speed, missing state keys (defaults + recorded
assumptions kick in), and bad specs that must never crash `derive`.
"""
import unittest

from engine import mech

# Every operator returns a Derivation with exactly this shape (see mech.py docstring).
DERIV_KEYS = {
    "child_state", "child_text", "probability", "formula_latex", "formula_plain",
    "uncertainty", "assumptions", "mechanism", "domain", "scale", "operator",
}


class MechTestCase(unittest.TestCase):

    def assert_derivation(self, d, operator=None):
        """Common shape + range invariants for any Derivation."""
        self.assertIsInstance(d, dict)
        self.assertTrue(DERIV_KEYS <= set(d.keys()),
                        "missing keys: %s" % (DERIV_KEYS - set(d.keys())))
        self.assertIsInstance(d["child_state"], dict)
        self.assertIsInstance(d["child_text"], str)
        self.assertTrue(d["child_text"].strip(), "child_text must be non-empty")
        self.assertIsInstance(d["probability"], float)
        self.assertGreaterEqual(d["probability"], 0.0)
        self.assertLessEqual(d["probability"], 1.0)
        self.assertGreaterEqual(d["uncertainty"], 0.0)
        self.assertLessEqual(d["uncertainty"], 1.0)
        self.assertIsInstance(d["assumptions"], list)
        self.assertIsInstance(d["formula_latex"], str)
        self.assertIsInstance(d["formula_plain"], str)
        self.assertIsInstance(d["mechanism"], str)
        if operator is not None:
            self.assertEqual(d["operator"], operator)
        return d


class TestKineticBraking(MechTestCase):

    def test_basic_dry(self):
        d = mech.kinetic_braking({"speed_kmh": 60.0}, {}, {})
        self.assert_derivation(d, "kinetic_braking")
        # d = v^2 / (2*mu*g) = 16.67^2 / (2*0.7*9.81) ~ 20.2 m
        self.assertAlmostEqual(d["child_state"]["braking_distance_m"], 20.2, places=1)
        self.assertGreaterEqual(d["child_state"]["braking_distance_m"], 0.0)
        self.assertEqual(d["child_state"]["friction_mu"], mech._DEFAULTS["friction_dry"])

    def test_wet_road_lengthens_distance(self):
        dry = mech.kinetic_braking({"speed_kmh": 60.0}, {}, {})
        wet = mech.kinetic_braking({"speed_kmh": 60.0}, {"road_wet": True}, {})
        self.assertGreater(wet["child_state"]["braking_distance_m"],
                           dry["child_state"]["braking_distance_m"])
        self.assertEqual(wet["child_state"]["friction_mu"], mech._DEFAULTS["friction_wet"])

    def test_zero_speed(self):
        d = mech.kinetic_braking({"speed_kmh": 0.0}, {}, {})
        self.assert_derivation(d)
        self.assertEqual(d["child_state"]["braking_distance_m"], 0.0)

    def test_missing_state_defaults_kick_in(self):
        d = mech.kinetic_braking({}, {}, {})
        self.assert_derivation(d)
        # default speed 60 km/h assumed, and the assumption is recorded honestly
        self.assertTrue(d["assumptions"], "missing inputs must record assumptions")
        self.assertGreater(d["uncertainty"], 0.1)
        self.assertAlmostEqual(d["child_state"]["speed_kmh"], mech._DEFAULTS["speed_kmh"], places=1)

    def test_parent_state_overrides_spec(self):
        # _pick prefers the parent's quantitative state over the LLM's spec
        d = mech.kinetic_braking({"speed_kmh": 30.0, "friction_mu": 0.7},
                                 {"friction_mu": 0.1}, {})
        self.assertEqual(d["child_state"]["friction_mu"], 0.7)


class TestWetRoadTraction(MechTestCase):

    def test_basic(self):
        d = mech.wet_road_traction({"speed_kmh": 60.0}, {}, {})
        self.assert_derivation(d, "wet_road_traction")
        safe = d["child_state"]["safe_speed_kmh"]
        self.assertGreaterEqual(safe, 0.0)
        self.assertLess(safe, 60.0, "wet road must lower the safe speed")
        self.assertTrue(d["child_state"]["road_wet"])

    def test_zero_speed(self):
        d = mech.wet_road_traction({"speed_kmh": 0.0}, {}, {})
        self.assert_derivation(d)
        self.assertEqual(d["child_state"]["safe_speed_kmh"], 0.0)

    def test_icy_friction_lower_than_wet(self):
        wet = mech.wet_road_traction({"speed_kmh": 60.0}, {"friction_mu": 0.4}, {})
        icy = mech.wet_road_traction({"speed_kmh": 60.0}, {"friction_mu": 0.1}, {})
        self.assertLess(icy["child_state"]["safe_speed_kmh"],
                        wet["child_state"]["safe_speed_kmh"])


class TestTravelTime(MechTestCase):

    def test_basic_rain_delay(self):
        d = mech.travel_time({"speed_kmh": 60.0, "distance_km": 5.0},
                             {"speed_reduction": 0.3}, {})
        self.assert_derivation(d, "travel_time")
        cs = d["child_state"]
        self.assertGreaterEqual(cs["travel_time_min"], 0.0)
        self.assertGreater(cs["delay_min"], 0.0, "rain must add delay")
        # t0 = 5/60 h = 5 min; v_eff = 42 -> t1 ~ 7.1 min; delay ~ 2.1 min
        self.assertAlmostEqual(cs["delay_min"], 2.1, places=1)
        self.assertAlmostEqual(cs["speed_effective_kmh"], 42.0, places=1)

    def test_zero_speed_returns_none(self):
        # v_eff <= 0 has no valid kinematic basis -> operator refuses (no crash)
        self.assertIsNone(mech.travel_time({"speed_kmh": 0.0, "distance_km": 5.0}, {}, {}))

    def test_full_speed_reduction_returns_none(self):
        self.assertIsNone(mech.travel_time({"speed_kmh": 60.0, "distance_km": 5.0},
                                           {"speed_reduction": 1.0}, {}))

    def test_missing_state_defaults_kick_in(self):
        d = mech.travel_time({}, {}, {})
        self.assert_derivation(d)
        self.assertTrue(d["assumptions"])
        self.assertGreaterEqual(d["child_state"]["travel_time_min"], 0.0)
        self.assertGreaterEqual(d["child_state"]["delay_min"], 0.0)


class TestMomentumTransfer(MechTestCase):

    def test_basic(self):
        d = mech.momentum_transfer({"speed_kmh": 36.0}, {"mass_kg": 80.0}, {})
        self.assert_derivation(d, "momentum_transfer")
        # p = m*v = 80 * 10 m/s = 800 kg*m/s
        self.assertAlmostEqual(d["child_state"]["momentum_kgms"], 800.0, places=1)
        self.assertGreaterEqual(d["child_state"]["momentum_kgms"], 0.0)

    def test_default_mass(self):
        d = mech.momentum_transfer({"speed_kmh": 36.0}, {}, {})
        self.assertAlmostEqual(d["child_state"]["momentum_kgms"], 70.0 * 10.0, places=1)

    def test_zero_speed(self):
        d = mech.momentum_transfer({"speed_kmh": 0.0}, {"mass_kg": 80.0}, {})
        self.assertEqual(d["child_state"]["momentum_kgms"], 0.0)


class TestAssumptionBased(MechTestCase):

    def test_basic(self):
        d = mech.assumption_based({}, {"child_text": "public concern grows",
                                       "confidence": 0.6, "uncertainty": 0.5}, {})
        self.assert_derivation(d, "assumption_based")
        self.assertEqual(d["child_text"], "public concern grows")
        # no fabricated formula for a non-quantitative phenomenon
        self.assertEqual(d["formula_latex"], "")

    def test_empty_text_returns_none(self):
        self.assertIsNone(mech.assumption_based({}, {"child_text": " "}, {}))
        self.assertIsNone(mech.assumption_based({}, {}, {}))

    def test_state_changes_applied_and_parent_state_carried(self):
        d = mech.assumption_based({"weather": "rainy"},
                                  {"child_text": "roads get busier",
                                   "state_changes": [{"variable": "traffic", "to": "heavy"}]}, {})
        self.assertEqual(d["child_state"]["weather"], "rainy")  # path dependency
        self.assertEqual(d["child_state"]["traffic"], "heavy")

    def test_probability_derived_from_confidence_and_uncertainty(self):
        d = mech.assumption_based({}, {"child_text": "x happens",
                                       "confidence": 1.0, "uncertainty": 0.0}, {})
        self.assertGreaterEqual(d["probability"], 0.9)
        weak = mech.assumption_based({}, {"child_text": "x happens",
                                          "confidence": 0.3, "uncertainty": 0.8}, {})
        self.assertLess(weak["probability"], d["probability"])


class TestDeriveDispatch(MechTestCase):

    def test_dispatch_by_operator(self):
        d = mech.derive({"state": {"speed_kmh": 50.0}}, {"operator": "kinetic_braking"})
        self.assertIsNotNone(d)
        self.assertEqual(d["operator"], "kinetic_braking")

    def test_unknown_operator_falls_back_to_assumption(self):
        d = mech.derive({"state": {}}, {"operator": "no_such_operator",
                                        "child_text": "something happens"})
        self.assertIsNotNone(d)
        self.assertEqual(d["operator"], "assumption_based")

    def test_bad_spec_never_crashes(self):
        # friction_mu = 0 -> division by zero inside the operator; derive must
        # swallow it and return None rather than crash the web build.
        self.assertIsNone(mech.derive({"state": {"speed_kmh": 60.0}},
                                      {"operator": "kinetic_braking", "friction_mu": 0}))
        # no usable text anywhere -> assumption fallback also refuses
        self.assertIsNone(mech.derive({"state": {}}, {"operator": "unknown_op"}))

    def test_derive_result_shape(self):
        d = mech.derive({"state": {"speed_kmh": 60.0, "distance_km": 5.0}},
                        {"operator": "travel_time", "speed_reduction": 0.3})
        self.assert_derivation(d, "travel_time")


class TestInitState(MechTestCase):

    def test_defaults_present(self):
        st = mech.init_state({})
        self.assertEqual(st["speed_kmh"], mech._DEFAULTS["speed_kmh"])
        self.assertEqual(st["distance_km"], mech._DEFAULTS["distance_km"])

    def test_numeric_initial_state_kept_non_numeric_dropped(self):
        st = mech.init_state({"initial_state": {"speed_kmh": 90.0, "note": "fast"}})
        self.assertEqual(st["speed_kmh"], 90.0)
        self.assertNotIn("note", st)

    def test_road_wet_sets_friction(self):
        st = mech.init_state({"road_wet": True})
        self.assertTrue(st["road_wet"])
        self.assertEqual(st["friction_mu"], mech._DEFAULTS["friction_wet"])


class TestExtremeInputBounds(MechTestCase):
    """Probabilities/uncertainties must stay in [0,1] and quantities non-negative
    even under extreme (but valid) inputs."""

    def test_extreme_speed(self):
        for op, spec in ((mech.kinetic_braking, {}),
                         (mech.wet_road_traction, {}),
                         (mech.momentum_transfer, {}),
                         (mech.travel_time, {"speed_reduction": 0.9})):
            d = op({"speed_kmh": 300.0, "distance_km": 100.0}, spec, {})
            self.assert_derivation(d)
            for key, val in d["child_state"].items():
                if isinstance(val, (int, float)) and not isinstance(val, bool):
                    self.assertGreaterEqual(val, 0.0, "%s produced negative %s" % (op.__name__, key))

    def test_helpers_clamp(self):
        self.assertEqual(mech._clamp(5.0, 0.0, 1.0), 1.0)
        self.assertEqual(mech._clamp(-5.0, 0.0, 1.0), 0.0)
        self.assertGreaterEqual(mech._prob(1.0, 0.0), 0.0)
        self.assertLessEqual(mech._prob(1.0, 0.0), 1.0)
        self.assertGreater(mech._prob(0.0, 1.0), 0.0)  # floored at 0.02, never exactly 0

    def test_unit_conversions_roundtrip(self):
        self.assertAlmostEqual(mech._ms_to_kmh(mech._kmh_to_ms(72.0)), 72.0)
        self.assertAlmostEqual(mech._kmh_to_ms(36.0), 10.0)

    def test_num_coercion(self):
        self.assertEqual(mech._num("3.5"), 3.5)
        self.assertEqual(mech._num("banana", 1.25), 1.25)
        self.assertEqual(mech._num(None, 2.5), 2.5)


if __name__ == "__main__":
    unittest.main(verbosity=2)
