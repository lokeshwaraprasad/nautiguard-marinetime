"""Unit conversion, geodesic maths and boundary-distance tests.

Run with:  python -m pytest      (or: python -m unittest discover tests)
"""
import json
import math
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from services.boundary_service import load_boundary  # noqa: E402
from services.distance_service import (  # noqa: E402
    METRES_PER_NM, InvalidCoordinateError, geodesic_direct, geodesic_inverse,
    metres_to_nm, nearest_point_on_polyline, nm_to_metres, validate_coordinates,
)


def dms(d, m, s, negative=False):
    v = d + m / 60 + s / 3600
    return -v if negative else v


class TestConversions(unittest.TestCase):
    def test_one_nm_is_1852_m(self):
        self.assertEqual(METRES_PER_NM, 1852.0)
        self.assertEqual(nm_to_metres(1), 1852.0)
        self.assertEqual(metres_to_nm(1852), 1.0)

    def test_round_trip(self):
        for nm in (0, 0.5, 5, 10, 25, 50, 123.456):
            self.assertAlmostEqual(metres_to_nm(nm_to_metres(nm)), nm, places=9)

    def test_50_nm_in_km(self):
        self.assertAlmostEqual(nm_to_metres(50) / 1000, 92.6, places=6)


class TestGeodesy(unittest.TestCase):
    """Published reference values for Vincenty's formulae."""

    FLINDERS = (dms(37, 57, 3.72030, True), dms(144, 25, 29.52440))
    BUNINYONG = (dms(37, 39, 10.15610, True), dms(143, 55, 35.38390))

    def test_inverse_flinders_peak_buninyong(self):
        # Geoscience Australia worked example: 54,972.271 m, azimuth 306° 52' 05.37"
        s, az1, _ = geodesic_inverse(*self.FLINDERS, *self.BUNINYONG)
        self.assertAlmostEqual(s, 54972.271, delta=0.001)
        self.assertAlmostEqual(az1, dms(306, 52, 5.37), delta=1 / 3600)

    def test_direct_flinders_peak_buninyong(self):
        lat, lon, _ = geodesic_direct(*self.FLINDERS, dms(306, 52, 5.37), 54972.271)
        self.assertAlmostEqual(lat, self.BUNINYONG[0], delta=1e-6)
        self.assertAlmostEqual(lon, self.BUNINYONG[1], delta=1e-6)

    def test_one_degree_along_equator(self):
        # Along the equator the geodesic is the equator itself: a * pi / 180
        s, _, _ = geodesic_inverse(0, 0, 0, 1)
        self.assertAlmostEqual(s, 6378137.0 * math.pi / 180, delta=0.001)

    def test_direct_then_inverse_round_trip(self):
        lat, lon, _ = geodesic_direct(9.3, 79.3, 45, nm_to_metres(20))
        s, az, _ = geodesic_inverse(9.3, 79.3, lat, lon)
        self.assertAlmostEqual(s, nm_to_metres(20), delta=0.001)
        self.assertAlmostEqual(az, 45, delta=1e-6)

    def test_same_point(self):
        self.assertEqual(geodesic_inverse(9.0, 79.0, 9.0, 79.0)[0], 0.0)


class TestValidation(unittest.TestCase):
    def test_valid(self):
        self.assertEqual(validate_coordinates("9.3", 79.3), (9.3, 79.3))

    def test_invalid(self):
        for lat, lon in [(None, 79), (9, None), ("abc", 79), (91, 79), (-91, 79), (9, 181),
                         (9, -181), (float("nan"), 79), (float("inf"), 79), (True, 79), ([], 79)]:
            with self.subTest(lat=lat, lon=lon):
                with self.assertRaises(InvalidCoordinateError):
                    validate_coordinates(lat, lon)


class TestBoundaryDistance(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.boundary = load_boundary()
        cls.segments = cls.boundary["segments"]

    def test_treaty_positions_loaded(self):
        # 8 Bay of Bengal + 6 Palk Strait + 13 Gulf of Mannar positions -> 7 + 5 + 12 segments
        self.assertEqual(len(self.segments), 24)

    def test_point_on_a_treaty_position_is_zero(self):
        # 1974 Position 3: 09° 40.15' N, 79° 22.60' E
        r = nearest_point_on_polyline(9 + 40.15 / 60, 79 + 22.60 / 60, self.segments)
        self.assertLess(r.distance_m, 0.05)

    def test_point_on_segment_midpoint_is_zero(self):
        a, b = (9 + 40.15 / 60, 79 + 22.60 / 60), (9 + 21.80 / 60, 79 + 30.70 / 60)
        s, az, _ = geodesic_inverse(*a, *b)
        mid = geodesic_direct(*a, az, s / 2)
        r = nearest_point_on_polyline(mid[0], mid[1], self.segments)
        self.assertLess(r.distance_m, 0.05)

    def test_known_perpendicular_offsets(self):
        """Step out exactly N nautical miles at right angles from the middle of a
        segment; the measured distance must be N (to within a few metres)."""
        a, b = (7 + 35.3 / 60, 78 + 45.7 / 60), (7 + 21.0 / 60, 78 + 38.8 / 60)  # 9m -> 10m
        s, az, _ = geodesic_inverse(*a, *b)
        m_lat, m_lon, az_mid = geodesic_direct(*a, az, s / 2)
        for nm in (1, 5, 10):  # small enough that no other segment is closer
            for side in (-90, 90):
                p = geodesic_direct(m_lat, m_lon, az_mid + side, nm_to_metres(nm))
                r = nearest_point_on_polyline(p[0], p[1], self.segments)
                with self.subTest(nm=nm, side=side):
                    self.assertAlmostEqual(r.distance_nm, nm, delta=0.005)
                    self.assertIn("Position 9m", r.segment_label)

    def test_distance_beyond_endpoint_is_distance_to_endpoint(self):
        # South-west of 13m (05° 00.0' N, 77° 10.6' E), heading away from the line
        end = (5.0, 77 + 10.6 / 60)
        p = geodesic_direct(*end, 225, nm_to_metres(30))
        r = nearest_point_on_polyline(p[0], p[1], self.segments)
        self.assertAlmostEqual(r.distance_nm, 30, delta=0.01)
        self.assertAlmostEqual(r.nearest_lat, end[0], delta=1e-4)

    def test_rameswaram_reference_distance(self):
        # Rameswaram town (approx 9.2885 N, 79.3129 E) is roughly 12 NM from the line
        r = nearest_point_on_polyline(9.2885, 79.3129, self.segments)
        self.assertTrue(10 < r.distance_nm < 14, r.distance_nm)
        self.assertIn("1974", r.segment_label)

    def test_demo_routes_cover_expected_levels(self):
        routes = json.loads((ROOT / "data" / "demo_routes.json").read_text(encoding="utf-8"))
        full = next(r for r in routes["routes"] if r["id"] == "gulf-of-mannar-full")
        d = [nearest_point_on_polyline(lat, lon, self.segments).distance_nm for lat, lon in full["waypoints"]]
        self.assertGreater(d[0], 50)  # starts SAFE
        self.assertLess(min(d), 5)  # reaches CRITICAL

    def test_advisory_zone_vertices_lie_at_their_radius(self):
        zones = json.loads((ROOT / "data" / "advisory_zones.geojson").read_text())
        for f in zones["features"]:
            radius = f["properties"]["radius_nm"]
            ring = f["geometry"]["coordinates"][0]
            sample = ring[:: max(1, len(ring) // 25)]
            for lon, lat in sample:
                d = nearest_point_on_polyline(lat, lon, self.segments).distance_nm
                with self.subTest(radius=radius, lat=lat, lon=lon):
                    self.assertAlmostEqual(d, radius, delta=0.02)


if __name__ == "__main__":
    unittest.main()
