"""
Pre-computes the 50 / 25 / 10 / 5 NM advisory zones around the boundary and
writes data/advisory_zones.geojson.

Method (pure Python, no GIS library needed):
1. Walk along the boundary every few hundred metres and step out sideways
   (perpendicular to the line) by the zone radius using the geodesic
   "direct" formula. Round the outside corners and the two ends with arcs.
2. That outline loops back on itself on the inside of bends. Every outline
   point is therefore re-measured against the WHOLE boundary; points closer
   than the radius are inside the zone and are dropped.
3. What is left is the zone edge. tests/test_distance.py re-measures sample
   vertices to prove they lie at the stated distance.

The zone is a pure distance band. It includes land and does not represent
any legal buffer or fishing restriction.

Run:  python scripts/build_advisory_zones.py
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from services.boundary_service import load_boundary  # noqa: E402
from services.distance_service import (  # noqa: E402
    METRES_PER_NM, geodesic_direct, geodesic_inverse, nearest_point_on_polyline,
)

RADII_NM = [50, 25, 10, 5]
ARC_STEP_DEG = 4.0


def chain(lines):
    """Join the sector lines into one continuous (lat, lon) list."""
    # Order: Bay of Bengal reversed (6b -> 1b), Palk Strait (1 -> 6), Gulf of Mannar (1m -> 13m)
    bob, palk, gom = [l["coords"] for l in lines]
    pts = list(reversed(bob)) + palk[1:] + gom[1:]
    return pts


def left_side(points, radius_m, step_m):
    """Offset points on the left of the travel direction, with round outer joins and an end cap."""
    out = []
    n = len(points)
    prev_end_az = None
    for i in range(n - 1):
        a, b = points[i], points[i + 1]
        seg_len, az_start, _ = geodesic_inverse(a[0], a[1], b[0], b[1])
        if prev_end_az is not None:
            turn = ((az_start - prev_end_az + 540) % 360) - 180
            if turn > 0:  # line turns right -> left side is the outside of the bend -> round join
                k = 1
                while k * ARC_STEP_DEG < turn:
                    az = prev_end_az + k * ARC_STEP_DEG - 90
                    out.append(geodesic_direct(a[0], a[1], az, radius_m)[:2])
                    k += 1
        steps = max(1, int(seg_len // step_m))
        for k in range(steps + 1):
            s = seg_len * k / steps
            p_lat, p_lon, az_here = geodesic_direct(a[0], a[1], az_start, s)
            out.append(geodesic_direct(p_lat, p_lon, az_here - 90, radius_m)[:2])
        prev_end_az = geodesic_inverse(a[0], a[1], b[0], b[1])[2]
    # end cap: sweep 180 degrees around the last point
    end = points[-1]
    deg = ARC_STEP_DEG
    while deg < 180:
        out.append(geodesic_direct(end[0], end[1], prev_end_az - 90 + deg, radius_m)[:2])
        deg += ARC_STEP_DEG
    return out


def build_zone(points, segments, radius_nm):
    radius_m = radius_nm * METRES_PER_NM
    step_m = max(1500.0, radius_m / 25)
    ring = left_side(points, radius_m, step_m) + left_side(list(reversed(points)), radius_m, step_m)
    tolerance = 5.0  # metres
    kept = []
    for lat, lon in ring:
        d = nearest_point_on_polyline(lat, lon, segments).distance_m
        if d >= radius_m - tolerance:
            kept.append([round(lon, 5), round(lat, 5)])
    kept.append(kept[0])
    return kept


def main():
    boundary = load_boundary()
    points = chain(boundary["lines"])
    features = []
    for r in RADII_NM:
        ring = build_zone(points, boundary["segments"], r)
        print(f"{r} NM zone: {len(ring)} vertices")
        features.append({
            "type": "Feature",
            "properties": {
                "radius_nm": r,
                "description": f"Area within {r} NM of the mapped treaty boundary (demonstration threshold, includes land)",
            },
            "geometry": {"type": "Polygon", "coordinates": [ring]},
        })
    out = ROOT / "data" / "advisory_zones.geojson"
    out.write_text(json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")) + "\n")
    print(f"Wrote {out} ({out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
