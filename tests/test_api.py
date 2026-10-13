"""Flask API response-structure tests (uses Flask's built-in test client)."""
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app import app  # noqa: E402
from services import alert_service  # noqa: E402


class TestApi(unittest.TestCase):
    def setUp(self):
        self.c = app.test_client()
        alert_service.ALERT_LOG.clear()

    def test_index_page(self):
        r = self.c.get("/")
        self.assertEqual(r.status_code, 200)
        self.assertIn(b"NautiGuard", r.data)

    def test_health(self):
        j = self.c.get("/api/health").get_json()
        self.assertTrue(j["ok"])
        self.assertEqual(j["boundary"]["segments"], 24)
        self.assertIn("configured", j["ai"])

    def test_config_never_exposes_gemini_key(self):
        with mock.patch.dict(os.environ, {"GEMINI_API_KEY": "SECRET-123", "GOOGLE_MAPS_API_KEY": ""}):
            r = self.c.get("/api/config")
        self.assertNotIn(b"SECRET-123", r.data)
        j = r.get_json()
        self.assertEqual(j["map_provider"], "leaflet")
        self.assertTrue(j["ai_configured"])

    def test_config_google_when_key_present(self):
        with mock.patch.dict(os.environ, {"GOOGLE_MAPS_API_KEY": "browser-key", "MAP_PROVIDER": "auto"}):
            j = self.c.get("/api/config").get_json()
        self.assertEqual(j["map_provider"], "google")

    def test_boundary(self):
        j = self.c.get("/api/boundary").get_json()
        self.assertTrue(j["ok"])
        self.assertEqual(j["boundary"]["type"], "FeatureCollection")
        self.assertTrue(j["verified"])
        radii = sorted(f["properties"]["radius_nm"] for f in j["advisory_zones"]["features"])
        self.assertEqual(radii, [5, 10, 25, 50])
        self.assertIn("sources", j["metadata"])

    def test_calculate_distance_structure(self):
        r = self.c.post("/api/calculate-distance", json={"lat": 9.5, "lon": 79.2})
        self.assertEqual(r.status_code, 200)
        j = r.get_json()
        for key in ("distance_nm", "distance_m", "nearest_point", "level", "message", "alert",
                    "bearing_to_boundary_deg", "nearest_segment", "thresholds_nm", "disclaimer"):
            self.assertIn(key, j)
        self.assertAlmostEqual(j["distance_m"] / 1852, j["distance_nm"], places=2)
        self.assertEqual(j["level"], "CAUTION")
        self.assertIsNotNone(j["alert"])  # first reading inside a warning zone
        self.assertIn("en", j["message"])
        self.assertIn("ta", j["message"])

    def test_calculate_distance_dedup_via_previous_level(self):
        j = self.c.post("/api/calculate-distance", json={"lat": 9.5, "lon": 79.2, "previous_level": "CAUTION"}).get_json()
        self.assertIsNone(j["alert"])
        self.assertEqual(len(self.c.get("/api/alerts").get_json()["alerts"]), 0)

    def test_calculate_distance_invalid(self):
        for body in ({}, {"lat": 95, "lon": 79}, {"lat": "x", "lon": 79}, {"lat": 9}):
            with self.subTest(body=body):
                r = self.c.post("/api/calculate-distance", json=body)
                self.assertEqual(r.status_code, 400)
                self.assertFalse(r.get_json()["ok"])

    def test_vessel_status(self):
        self.assertEqual(self.c.get("/api/vessel/status").status_code, 400)
        j = self.c.get("/api/vessel/status?lat=9.3&lon=79.3").get_json()
        self.assertTrue(j["ok"])
        self.assertEqual(j["vessel_id"], "NG-001")

    def test_simulation_endpoints(self):
        j = self.c.post("/api/simulation/start", json={"route_id": "gulf-of-mannar-full"}).get_json()
        self.assertEqual(j["state"], "running")
        self.assertGreater(len(j["route"]["waypoints"]), 2)
        self.assertEqual(self.c.post("/api/simulation/start", json={"route_id": "nope"}).status_code, 404)
        for ep, state in (("pause", "paused"), ("resume", "running"), ("reset", "reset")):
            self.assertEqual(self.c.post(f"/api/simulation/{ep}").get_json()["state"], state)

    def test_alert_test_and_log(self):
        j = self.c.post("/api/alerts/test", json={"lat": 9.6, "lon": 79.25}).get_json()
        self.assertTrue(j["alert"]["is_test"])
        self.assertEqual(j["alert"]["sms_preview"]["status"], "SIMULATED_NOT_SENT")
        self.assertEqual(len(self.c.get("/api/alerts").get_json()["alerts"]), 1)

    def test_fishing_history(self):
        ok = {"center": {"lat": 9.5, "lon": 79.2}, "route": [[9.5, 79.2], [9.51, 79.21]], "notes": "prawns", "catch_kg": 12}
        r = self.c.post("/api/fishing-history", json=ok)
        self.assertEqual(r.status_code, 201)
        self.assertTrue(r.get_json()["session"]["simulated"])
        self.assertGreaterEqual(len(self.c.get("/api/fishing-history").get_json()["sessions"]), 1)
        for bad in ({}, {"center": {"lat": 99, "lon": 79}}, {**ok, "catch_kg": -1}, {**ok, "notes": "x" * 600},
                    {**ok, "route": [[9.5]]}):
            with self.subTest(bad=str(bad)[:50]):
                self.assertEqual(self.c.post("/api/fishing-history", json=bad).status_code, 400)

    def test_ai_chat_without_key(self):
        with mock.patch.dict(os.environ, {"GEMINI_API_KEY": ""}):
            r = self.c.post("/api/ai/chat", json={"message": "hello"})
        self.assertEqual(r.status_code, 503)
        self.assertFalse(r.get_json()["ok"])

    def test_ai_chat_validation(self):
        r = self.c.post("/api/ai/chat", json={"message": ""})
        self.assertEqual(r.status_code, 400)

    def test_unknown_api_route_is_json_404(self):
        r = self.c.get("/api/nope")
        self.assertEqual(r.status_code, 404)
        self.assertFalse(r.get_json()["ok"])


if __name__ == "__main__":
    unittest.main()
