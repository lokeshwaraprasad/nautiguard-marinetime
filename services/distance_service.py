"""
Geodesic distance calculations for NautiGuard.

All maths runs on the WGS84 ellipsoid using Vincenty's formulae
(T. Vincenty, "Direct and inverse solutions of geodesics on the ellipsoid
with application of nested equations", Survey Review, 1975). Vincenty is
accurate to well under a millimetre for the distances used here. It can fail
to converge only for nearly antipodal points (opposite sides of the Earth),
which never happens for a boat in the Palk Strait region.

No third-party packages are needed, which keeps the Vercel function small.

Units: metres internally. 1 nautical mile (NM) = 1,852 metres exactly.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
METRES_PER_NM = 1852.0  # international nautical mile (exact, by definition)

WGS84_A = 6378137.0  # semi-major axis (m)
WGS84_F = 1 / 298.257223563  # flattening
WGS84_B = WGS84_A * (1 - WGS84_F)  # semi-minor axis (m)

_GOLDEN = (math.sqrt(5) - 1) / 2  # 0.618...


class InvalidCoordinateError(ValueError):
    """Raised when a latitude/longitude is missing, not numeric or out of range."""


# ---------------------------------------------------------------------------
# Unit conversion
# ---------------------------------------------------------------------------
def nm_to_metres(nm: float) -> float:
    return float(nm) * METRES_PER_NM


def metres_to_nm(metres: float) -> float:
    return float(metres) / METRES_PER_NM


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------
def validate_coordinates(lat, lon) -> tuple[float, float]:
    """Return (lat, lon) as floats or raise InvalidCoordinateError."""
    if lat is None or lon is None:
        raise InvalidCoordinateError("Both 'lat' and 'lon' are required.")
    if isinstance(lat, bool) or isinstance(lon, bool):
        raise InvalidCoordinateError("Coordinates must be numbers, not true/false.")
    try:
        lat_f = float(lat)
        lon_f = float(lon)
    except (TypeError, ValueError):
        raise InvalidCoordinateError("Coordinates must be numbers.") from None
    if not (math.isfinite(lat_f) and math.isfinite(lon_f)):
        raise InvalidCoordinateError("Coordinates must be finite numbers.")
    if not -90.0 <= lat_f <= 90.0:
        raise InvalidCoordinateError("Latitude must be between -90 and 90 degrees.")
    if not -180.0 <= lon_f <= 180.0:
        raise InvalidCoordinateError("Longitude must be between -180 and 180 degrees.")
    return lat_f, lon_f


# ---------------------------------------------------------------------------
# Vincenty inverse and direct problems
# ---------------------------------------------------------------------------
def _normalise_lon(lon: float) -> float:
    return (lon + 540.0) % 360.0 - 180.0


def geodesic_inverse(lat1: float, lon1: float, lat2: float, lon2: float):
    """Distance (m), initial bearing and final bearing (degrees) from point 1 to 2."""
    if lat1 == lat2 and lon1 == lon2:
        return 0.0, 0.0, 0.0

    a, b, f = WGS84_A, WGS84_B, WGS84_F
    L = math.radians(lon2 - lon1)
    U1 = math.atan((1 - f) * math.tan(math.radians(lat1)))
    U2 = math.atan((1 - f) * math.tan(math.radians(lat2)))
    sinU1, cosU1 = math.sin(U1), math.cos(U1)
    sinU2, cosU2 = math.sin(U2), math.cos(U2)

    lam = L
    for _ in range(200):
        sin_lam, cos_lam = math.sin(lam), math.cos(lam)
        sin_sigma = math.hypot(cosU2 * sin_lam, cosU1 * sinU2 - sinU1 * cosU2 * cos_lam)
        if sin_sigma == 0:
            return 0.0, 0.0, 0.0  # coincident points
        cos_sigma = sinU1 * sinU2 + cosU1 * cosU2 * cos_lam
        sigma = math.atan2(sin_sigma, cos_sigma)
        sin_alpha = cosU1 * cosU2 * sin_lam / sin_sigma
        cos2_alpha = 1 - sin_alpha * sin_alpha
        cos_2sigma_m = (cos_sigma - 2 * sinU1 * sinU2 / cos2_alpha) if cos2_alpha != 0 else 0.0
        C = f / 16 * cos2_alpha * (4 + f * (4 - 3 * cos2_alpha))
        lam_prev = lam
        lam = L + (1 - C) * f * sin_alpha * (
            sigma + C * sin_sigma * (cos_2sigma_m + C * cos_sigma * (-1 + 2 * cos_2sigma_m ** 2))
        )
        if abs(lam - lam_prev) < 1e-12:
            break
    else:  # pragma: no cover - only for near-antipodal points
        raise ArithmeticError("Vincenty inverse formula failed to converge.")

    u2 = cos2_alpha * (a * a - b * b) / (b * b)
    A = 1 + u2 / 16384 * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)))
    B = u2 / 1024 * (256 + u2 * (-128 + u2 * (74 - 47 * u2)))
    delta_sigma = B * sin_sigma * (
        cos_2sigma_m
        + B / 4 * (
            cos_sigma * (-1 + 2 * cos_2sigma_m ** 2)
            - B / 6 * cos_2sigma_m * (-3 + 4 * sin_sigma ** 2) * (-3 + 4 * cos_2sigma_m ** 2)
        )
    )
    s = b * A * (sigma - delta_sigma)
    az1 = math.degrees(math.atan2(cosU2 * sin_lam, cosU1 * sinU2 - sinU1 * cosU2 * cos_lam))
    az2 = math.degrees(math.atan2(cosU1 * sin_lam, -sinU1 * cosU2 + cosU1 * sinU2 * cos_lam))
    return s, az1 % 360.0, az2 % 360.0


def geodesic_direct(lat1: float, lon1: float, bearing_deg: float, distance_m: float):
    """Destination (lat, lon) and final bearing after travelling distance_m on bearing_deg."""
    a, b, f = WGS84_A, WGS84_B, WGS84_F
    alpha1 = math.radians(bearing_deg)
    sin_a1, cos_a1 = math.sin(alpha1), math.cos(alpha1)
    tanU1 = (1 - f) * math.tan(math.radians(lat1))
    cosU1 = 1 / math.sqrt(1 + tanU1 * tanU1)
    sinU1 = tanU1 * cosU1
    sigma1 = math.atan2(tanU1, cos_a1)
    sin_alpha = cosU1 * sin_a1
    cos2_alpha = 1 - sin_alpha * sin_alpha
    u2 = cos2_alpha * (a * a - b * b) / (b * b)
    A = 1 + u2 / 16384 * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)))
    B = u2 / 1024 * (256 + u2 * (-128 + u2 * (74 - 47 * u2)))

    sigma = distance_m / (b * A)
    for _ in range(200):
        cos_2sigma_m = math.cos(2 * sigma1 + sigma)
        sin_sigma, cos_sigma = math.sin(sigma), math.cos(sigma)
        delta_sigma = B * sin_sigma * (
            cos_2sigma_m
            + B / 4 * (
                cos_sigma * (-1 + 2 * cos_2sigma_m ** 2)
                - B / 6 * cos_2sigma_m * (-3 + 4 * sin_sigma ** 2) * (-3 + 4 * cos_2sigma_m ** 2)
            )
        )
        sigma_prev = sigma
        sigma = distance_m / (b * A) + delta_sigma
        if abs(sigma - sigma_prev) < 1e-12:
            break

    cos_2sigma_m = math.cos(2 * sigma1 + sigma)
    sin_sigma, cos_sigma = math.sin(sigma), math.cos(sigma)
    x = sinU1 * sin_sigma - cosU1 * cos_sigma * cos_a1
    lat2 = math.atan2(sinU1 * cos_sigma + cosU1 * sin_sigma * cos_a1, (1 - f) * math.hypot(sin_alpha, x))
    lam = math.atan2(sin_sigma * sin_a1, cosU1 * cos_sigma - sinU1 * sin_sigma * cos_a1)
    C = f / 16 * cos2_alpha * (4 + f * (4 - 3 * cos2_alpha))
    L = lam - (1 - C) * f * sin_alpha * (
        sigma + C * sin_sigma * (cos_2sigma_m + C * cos_sigma * (-1 + 2 * cos_2sigma_m ** 2))
    )
    lon2 = _normalise_lon(lon1 + math.degrees(L))
    az2 = math.degrees(math.atan2(sin_alpha, -x)) % 360.0
    return math.degrees(lat2), lon2, az2


def distance_m(lat1, lon1, lat2, lon2) -> float:
    return geodesic_inverse(lat1, lon1, lat2, lon2)[0]


# ---------------------------------------------------------------------------
# Distance from a point to a polyline (the boundary)
# ---------------------------------------------------------------------------
@dataclass
class NearestResult:
    distance_m: float
    nearest_lat: float
    nearest_lon: float
    bearing_to_boundary_deg: float  # bearing from the boat towards the nearest point
    segment_index: int  # index into the flat segment list
    segment_label: str  # human readable, e.g. "Palk Strait (1974) Position 3 -> Position 4"

    @property
    def distance_nm(self) -> float:
        return metres_to_nm(self.distance_m)


def _approx_segment_distance_m(lat, lon, a, b) -> float:
    """Fast flat-earth estimate used only to pick candidate segments."""
    k_lat = 111_320.0
    k_lon = 111_320.0 * math.cos(math.radians(lat))
    ax, ay = (a[1] - lon) * k_lon, (a[0] - lat) * k_lat
    bx, by = (b[1] - lon) * k_lon, (b[0] - lat) * k_lat
    dx, dy = bx - ax, by - ay
    seg_len2 = dx * dx + dy * dy
    t = 0.0 if seg_len2 == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / seg_len2))
    px, py = ax + t * dx, ay + t * dy
    return math.hypot(px, py)


def nearest_point_on_geodesic_segment(lat, lon, a, b, iterations: int = 60):
    """
    Minimum geodesic distance from P(lat, lon) to the geodesic segment a->b.

    a and b are (lat, lon) tuples. The treaties define the boundary as
    "arcs of great circles" between positions; on the ellipsoid the closest
    equivalent is the geodesic, which is what we walk along here.
    Returns (distance_m, nearest_lat, nearest_lon).
    """
    seg_len, az, _ = geodesic_inverse(a[0], a[1], b[0], b[1])
    if seg_len == 0:
        return distance_m(lat, lon, a[0], a[1]), a[0], a[1]

    def dist_at(s):
        q_lat, q_lon, _ = geodesic_direct(a[0], a[1], az, s)
        return geodesic_inverse(lat, lon, q_lat, q_lon)[0], q_lat, q_lon

    # Golden-section search: distance along a short geodesic is unimodal.
    lo, hi = 0.0, seg_len
    x1 = hi - _GOLDEN * (hi - lo)
    x2 = lo + _GOLDEN * (hi - lo)
    f1, f2 = dist_at(x1)[0], dist_at(x2)[0]
    for _ in range(iterations):
        if f1 < f2:
            hi, x2, f2 = x2, x1, f1
            x1 = hi - _GOLDEN * (hi - lo)
            f1 = dist_at(x1)[0]
        else:
            lo, x1, f1 = x1, x2, f2
            x2 = lo + _GOLDEN * (hi - lo)
            f2 = dist_at(x2)[0]
        if hi - lo < 0.01:  # 1 cm
            break

    best = min(
        (dist_at((lo + hi) / 2), (distance_m(lat, lon, a[0], a[1]), a[0], a[1]),
         (distance_m(lat, lon, b[0], b[1]), b[0], b[1])),
        key=lambda r: r[0],
    )
    return best


def nearest_point_on_polyline(lat, lon, segments) -> NearestResult:
    """
    segments: list of dicts {"a": (lat, lon), "b": (lat, lon), "label": str}
    Returns the NearestResult for the closest point on any segment.
    """
    lat, lon = validate_coordinates(lat, lon)
    if not segments:
        raise ValueError("Boundary has no segments.")

    approx = [_approx_segment_distance_m(lat, lon, s["a"], s["b"]) for s in segments]
    best_approx = min(approx)
    # The flat-earth estimate is within a few percent at these latitudes, so
    # any segment within 10 % + 5 km of the best estimate is checked exactly.
    margin = best_approx * 0.10 + 5_000
    candidates = [i for i, d in enumerate(approx) if d <= best_approx + margin]

    best = None
    for i in candidates:
        seg = segments[i]
        d, n_lat, n_lon = nearest_point_on_geodesic_segment(lat, lon, seg["a"], seg["b"])
        if best is None or d < best[0]:
            best = (d, n_lat, n_lon, i)

    d, n_lat, n_lon, i = best
    bearing = geodesic_inverse(lat, lon, n_lat, n_lon)[1] if d > 0 else 0.0
    return NearestResult(
        distance_m=d,
        nearest_lat=n_lat,
        nearest_lon=n_lon,
        bearing_to_boundary_deg=bearing,
        segment_index=i,
        segment_label=segments[i]["label"],
    )
