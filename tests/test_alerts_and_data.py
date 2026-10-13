"""Warning levels, alert de-duplication, boundary-data validation and Gemini config."""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from services import alert_service as A  # noqa: E402
from services import gemini_service as G  # noqa: E402
from services.boundary_service import (  # noqa: E402
    BoundaryDataError, is_verified, load_boundary, load_metadata, parse_boundary,
)


class TestLevels(unittest.TestCase):
    def test_threshold_boundaries_are_at_or_below(self):
        cases = [(80, A.SAFE), (50.01, A.SAFE), (50, A.EARLY_WARNING), (25.01, A.EARLY_WARNING),
                 (25, A.CAUTION), (10.01, A.CAUTION), (10, A.HIGH_ALERT), (5.01, A.HIGH_ALERT),
                 (5, A.CRITICAL), (0, A.CRITICAL)]
        for d, lvl in cases:
            with self.subTest(d=d):
                self.assertEqual(A.raw_level(d), lvl)

    def test_escalation_is_immediate(self):
        self.assertEqual(A.classify(24.99, A.EARLY_WARNING), A.CAUTION)
        self.assertEqual(A.classify(4.0, A.CAUTION), A.CRITICAL)  # skipping levels is allowed

    def test_hysteresis_on_de_escalation(self):
        # Just past the 5 NM threshold: stays CRITICAL until more than 5.2 NM
        self.assertEqual(A.classify(5.1, A.CRITICAL), A.CRITICAL)
        self.assertEqual(A.classify(5.3, A.CRITICAL), A.HIGH_ALERT)
        self.assertEqual(A.classify(50.1, A.EARLY_WARNING), A.EARLY_WARNING)
        self.assertEqual(A.classify(50.3, A.EARLY_WARNING), A.SAFE)
        self.assertEqual(A.classify(70, A.CRITICAL), A.SAFE)

    def test_unknown_previous_level_is_ignored(self):
        self.assertEqual(A.classify(30, "BOGUS"), A.EARLY_WARNING)

    def test_custom_thresholds_from_env(self):
        with mock.patch.dict(os.environ, {"NAUTIGUARD_THRESHOLDS_NM": "40,20,8,3"}):
            t = A.load_thresholds()
        self.assertEqual(t[A.EARLY_WARNING], 40)
        self.assertEqual(A.raw_level(19, t), A.CAUTION)

    def test_bad_threshold_env_falls_back(self):
        for raw in ("abc", "10,20,30,40", "50,25,10", "50,25,10,-1", "50,25,25,5"):
            with self.subTest(raw=raw), mock.patch.dict(os.environ, {"NAUTIGUARD_THRESHOLDS_NM": raw}):
                self.assertEqual(A.load_thresholds(), A.DEFAULT_THRESHOLDS_NM)


class TestDeduplication(unittest.TestCase):
    def simulate(self, distances):
        prev, fired = None, []
        for d in distances:
            lvl = A.classify(d, prev)
            if A.should_alert(lvl, prev):
                fired.append(lvl)
            prev = lvl
        return fired

    def test_no_repeat_while_level_unchanged(self):
        self.assertEqual(self.simulate([30, 29, 28, 27, 26]), [A.EARLY_WARNING])

    def test_each_new_level_alerts_once(self):
        approach = [60, 55, 49, 40, 24, 15, 9, 6, 4.5, 3]
        self.assertEqual(self.simulate(approach),
                         [A.EARLY_WARNING, A.CAUTION, A.HIGH_ALERT, A.CRITICAL])

    def test_exit_and_re_enter_alerts_again(self):
        fired = self.simulate([45, 55, 45])
        self.assertEqual(fired, [A.EARLY_WARNING, A.SAFE, A.EARLY_WARNING])

    def test_jitter_around_threshold_does_not_spam(self):
        fired = self.simulate([10.5, 9.95, 10.05, 9.98, 10.1, 9.9, 10.15])
        self.assertEqual(fired, [A.CAUTION, A.HIGH_ALERT])

    def test_first_reading_safe_is_silent(self):
        self.assertFalse(A.should_alert(A.SAFE, None))
        self.assertTrue(A.should_alert(A.CAUTION, None))


class TestMessages(unittest.TestCase):
    def test_bilingual_with_distance(self):
        m = A.build_message(A.CAUTION, 24.83)
        self.assertIn("24.8 NM", m["en"])
        self.assertIn("24.8", m["ta"])
        self.assertIn("கடல் மைல்", m["ta"])

    def test_messages_never_claim_official(self):
        for lvl in A.LEVEL_ORDER:
            text = A.build_message(lvl, 10)["en"].lower()
            self.assertNotIn("coast guard warning", text)

    def test_sms_is_simulated(self):
        rec = A.make_alert(A.CAUTION, "NG-001", 9.5, 79.2, 24.8, simulated_position=True)
        self.assertEqual(rec.sms_preview["status"], "SIMULATED_NOT_SENT")
        self.assertIn("NG-001", rec.sms_preview["text_en"])
        self.assertIn("24.8 NM", rec.sms_preview["text_en"])


class TestBoundaryData(unittest.TestCase):
    def test_real_file_is_valid_and_verified(self):
        b = load_boundary()
        self.assertEqual(len(b["geojson"]["features"]), 3)
        self.assertTrue(is_verified(load_metadata()))

    def test_sectors_join_up(self):
        lines = load_boundary()["lines"]
        bob, palk, gom = [l["coords"] for l in lines]
        self.assertEqual(bob[0], palk[0])  # 1b == 1974 Position 1
        self.assertEqual(palk[-1], gom[0])  # 1974 Position 6 == 1m

    def test_missing_file(self):
        with self.assertRaises(BoundaryDataError):
            load_boundary(str(ROOT / "data" / "does-not-exist.geojson"))

    def test_invalid_json(self):
        with tempfile.NamedTemporaryFile("w", suffix=".geojson", delete=False) as f:
            f.write("{not json")
        try:
            with self.assertRaises(BoundaryDataError):
                load_boundary(f.name)
        finally:
            os.unlink(f.name)

    def test_invalid_structures(self):
        bad = [
            {},
            {"type": "FeatureCollection", "features": []},
            {"type": "FeatureCollection", "features": [{"geometry": {"type": "Point", "coordinates": [79, 9]}}]},
            {"type": "FeatureCollection", "features": [{"geometry": {"type": "LineString", "coordinates": [[79, 9]]}}]},
            {"type": "FeatureCollection", "features": [{"geometry": {"type": "LineString", "coordinates": [[79, 9], [200, 9]]}}]},
            {"type": "FeatureCollection", "features": [{"geometry": {"type": "LineString", "coordinates": [[79, 9], ["x", 9]]}}]},
        ]
        for g in bad:
            with self.subTest(g=json.dumps(g)[:60]):
                with self.assertRaises(BoundaryDataError):
                    parse_boundary(g)

    def test_missing_metadata_means_unverified(self):
        load_metadata.cache_clear()
        meta = load_metadata(str(ROOT / "data" / "nope.json"))
        self.assertFalse(is_verified(meta))
        self.assertIn("ILLUSTRATIVE", meta["display_label"])
        load_metadata.cache_clear()


class FakeClient:
    def __init__(self, reply="Hello", exc=None):
        self.calls = []
        outer = self

        class Models:
            def generate_content(self, model, contents, config):
                outer.calls.append({"model": model, "contents": contents, "config": config})
                if exc:
                    raise exc
                return type("R", (), {"text": reply})()

        self.models = Models()


class TestGemini(unittest.TestCase):
    def test_missing_key_gives_503(self):
        with mock.patch.dict(os.environ, {"GEMINI_API_KEY": ""}):
            self.assertFalse(G.is_configured())
            with self.assertRaises(G.AssistantError) as cm:
                G.chat("hi", [], "")
        self.assertEqual(cm.exception.status, 503)

    def test_validation(self):
        for payload in (None, [], {}, {"message": ""}, {"message": "   "}, {"message": 5},
                        {"message": "x" * 1001}, {"message": "hi", "history": "nope"},
                        {"message": "hi", "context": 5}):
            with self.subTest(payload=str(payload)[:40]):
                with self.assertRaises(G.AssistantError) as cm:
                    G.validate_chat_payload(payload)
                self.assertEqual(cm.exception.status, 400)

    def test_history_is_trimmed_and_filtered(self):
        hist = [{"role": "user", "text": f"q{i}"} for i in range(50)] + [{"role": "system", "text": "evil"}]
        _, h, _ = G.validate_chat_payload({"message": "hi", "history": hist})
        self.assertLessEqual(len(h), G.MAX_HISTORY_TURNS * 2)
        self.assertTrue(all(x["role"] in ("user", "model") for x in h))

    def test_chat_with_fake_client(self):
        fake = FakeClient("Stay safe.")
        with mock.patch.dict(os.environ, {"GEMINI_API_KEY": "test-key", "GEMINI_MODEL": "test-model"}):
            out = G.chat("What is a nautical mile?", [{"role": "user", "text": "hi"}], "Distance 12 NM",
                         client_factory=lambda key: fake)
        self.assertEqual(out, {"reply": "Stay safe.", "model": "test-model"})
        sent = fake.calls[0]["contents"]
        self.assertIn("Distance 12 NM", sent[-1]["parts"][0]["text"])

    def test_quota_error_maps_to_429(self):
        fake = FakeClient(exc=RuntimeError("429 RESOURCE_EXHAUSTED quota"))
        with mock.patch.dict(os.environ, {"GEMINI_API_KEY": "k"}):
            with self.assertRaises(G.AssistantError) as cm:
                G.chat("hi", [], "", client_factory=lambda key: fake)
        self.assertEqual(cm.exception.status, 429)

    def test_default_model_configurable(self):
        with mock.patch.dict(os.environ, {"GEMINI_MODEL": ""}):
            self.assertEqual(G.get_model_name(), G.DEFAULT_MODEL)


if __name__ == "__main__":
    unittest.main()
