"""
Loads and validates the maritime boundary data files.

Boundary geometry lives in data/boundary.geojson (separate from code) so it can
be corrected or replaced without touching any Python. Every load is validated;
if the file is missing or malformed the API reports the problem instead of
silently drawing a wrong line.
"""

from __future__ import annotations

import json
import math
from functools import lru_cache
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
BOUNDARY_FILE = DATA_DIR / "boundary.geojson"
METADATA_FILE = DATA_DIR / "boundary_metadata.json"
ZONES_FILE = DATA_DIR / "advisory_zones.geojson"

VERIFIED_STATUSES = {"transcribed_from_treaty_text", "verified_official_geodata"}


class BoundaryDataError(RuntimeError):
    """Raised when the boundary data file is missing or invalid."""


def _check_position(pos, where: str):
    if not isinstance(pos, (list, tuple)) or len(pos) < 2:
        raise BoundaryDataError(f"{where}: each position must be [longitude, latitude].")
    lon, lat = pos[0], pos[1]
    for v in (lon, lat):
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
            raise BoundaryDataError(f"{where}: coordinates must be finite numbers.")
    if not (-180 <= lon <= 180 and -90 <= lat <= 90):
        raise BoundaryDataError(f"{where}: coordinate out of range ({lon}, {lat}).")


def parse_boundary(geojson: dict) -> dict:
    """
    Validate a GeoJSON FeatureCollection of LineString / MultiLineString
    features and return {"geojson": ..., "segments": [...], "lines": [...]}.
    Segments use (lat, lon) tuples for the distance service.
    """
    if not isinstance(geojson, dict) or geojson.get("type") != "FeatureCollection":
        raise BoundaryDataError("Boundary file must be a GeoJSON FeatureCollection.")
    features = geojson.get("features")
    if not isinstance(features, list) or not features:
        raise BoundaryDataError("Boundary file has no features.")

    segments, lines = [], []
    for fi, feat in enumerate(features):
        geom = (feat or {}).get("geometry") or {}
        props = (feat or {}).get("properties") or {}
        name = props.get("name") or f"feature {fi}"
        gtype = geom.get("type")
        if gtype == "LineString":
            parts = [geom.get("coordinates")]
        elif gtype == "MultiLineString":
            parts = geom.get("coordinates")
        else:
            raise BoundaryDataError(f"{name}: geometry must be LineString or MultiLineString.")
        if not isinstance(parts, list):
            raise BoundaryDataError(f"{name}: missing coordinates.")

        point_labels = [p.get("label") for p in props.get("points", [])] if isinstance(props.get("points"), list) else []
        for part in parts:
            if not isinstance(part, list) or len(part) < 2:
                raise BoundaryDataError(f"{name}: a line needs at least two positions.")
            for pi, pos in enumerate(part):
                _check_position(pos, f"{name} position {pi}")
            lines.append({"name": name, "coords": [(p[1], p[0]) for p in part]})
            for i in range(len(part) - 1):
                a, b = part[i], part[i + 1]
                la = point_labels[i] if i < len(point_labels) else f"#{i}"
                lb = point_labels[i + 1] if i + 1 < len(point_labels) else f"#{i + 1}"
                segments.append({
                    "a": (a[1], a[0]),
                    "b": (b[1], b[0]),
                    "label": f"{name}: {la} → {lb}",
                    "sector": props.get("id", name),
                })
    return {"geojson": geojson, "segments": segments, "lines": lines}


def _read_json(path: Path) -> dict:
    if not path.exists():
        raise BoundaryDataError(f"Data file not found: {path.name}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise BoundaryDataError(f"{path.name} is not valid JSON: {exc}") from None


@lru_cache(maxsize=4)
def load_boundary(path: str | None = None) -> dict:
    """Load + validate the boundary (cached per path for speed on warm functions)."""
    p = Path(path) if path else BOUNDARY_FILE
    return parse_boundary(_read_json(p))


@lru_cache(maxsize=2)
def load_metadata(path: str | None = None) -> dict:
    p = Path(path) if path else METADATA_FILE
    try:
        meta = _read_json(p)
    except BoundaryDataError:
        # Without provenance we must not present the line as verified.
        return {
            "verification_status": "unverified",
            "display_label": "ILLUSTRATIVE boundary - source metadata missing; alerts are not verified",
            "sources": [],
        }
    return meta


def is_verified(meta: dict) -> bool:
    return meta.get("verification_status") in VERIFIED_STATUSES


@lru_cache(maxsize=2)
def load_advisory_zones(path: str | None = None) -> dict | None:
    """Pre-computed buffer polygons (see scripts/build_advisory_zones.py). Optional."""
    p = Path(path) if path else ZONES_FILE
    try:
        return _read_json(p)
    except BoundaryDataError:
        return None
