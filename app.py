"""
NautiGuard - Flask backend.

Run locally:   python app.py        (then open http://127.0.0.1:5000)
On Vercel:     Vercel detects the Flask instance named `app` in app.py.

Design note for serverless hosting: there is NO background loop here. The
browser moves the simulated boat and posts each position to
/api/calculate-distance; the server does the geodesic maths and alert
decision for that single request and keeps nothing it depends on later.
"""

from __future__ import annotations

import json
import os
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, render_template, request

try:  # optional: load .env when running locally
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:  # pragma: no cover
    pass

from services import alert_service, gemini_service
from services.boundary_service import (
    BoundaryDataError, is_verified, load_advisory_zones, load_boundary, load_metadata,
)
from services.distance_service import (
    METRES_PER_NM, InvalidCoordinateError, nearest_point_on_polyline, validate_coordinates,
)

BASE_DIR = Path(__file__).resolve().parent
ROUTES_FILE = BASE_DIR / "data" / "demo_routes.json"
APP_VERSION = "1.0.0"

app = Flask(
    __name__,
    static_folder="public",  # used for local runs; on Vercel the CDN serves public/**
    static_url_path="",
    template_folder="templates",
)
app.config["MAX_CONTENT_LENGTH"] = 256 * 1024  # 256 KB request limit
app.json.ensure_ascii = False  # keep Tamil readable in JSON responses


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def error(message: str, status: int, **extra):
    body = {"ok": False, "error": message}
    body.update(extra)
    return jsonify(body), status


def json_body() -> dict:
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load_routes() -> dict:
    return json.loads(ROUTES_FILE.read_text(encoding="utf-8"))


def compute_status(lat, lon, previous_level=None) -> dict:
    """Distance + warning level for one position. Raises on bad input / data."""
    lat, lon = validate_coordinates(lat, lon)
    boundary = load_boundary()
    meta = load_metadata()
    thresholds = alert_service.load_thresholds()
    nearest = nearest_point_on_polyline(lat, lon, boundary["segments"])
    if previous_level is not None and previous_level not in alert_service.SEVERITY:
        previous_level = None
    level = alert_service.classify(nearest.distance_nm, previous_level, thresholds)
    return {
        "position": {"lat": lat, "lon": lon},
        "distance_nm": round(nearest.distance_nm, 3),
        "distance_m": round(nearest.distance_m, 1),
        "nearest_point": {"lat": round(nearest.nearest_lat, 6), "lon": round(nearest.nearest_lon, 6)},
        "bearing_to_boundary_deg": round(nearest.bearing_to_boundary_deg, 1),
        "nearest_segment": nearest.segment_label,
        "level": level,
        "severity": alert_service.SEVERITY[level],
        "level_label": alert_service.LEVEL_LABELS[level],
        "message": alert_service.build_message(level, nearest.distance_nm, thresholds),
        "thresholds_nm": thresholds,
        "boundary_verified": is_verified(meta),
        "boundary_label": meta.get("display_label", ""),
        "disclaimer": alert_service.DISCLAIMER,
    }


# ---------------------------------------------------------------------------
# Pages
# ---------------------------------------------------------------------------
@app.get("/")
def index():
    return render_template("index.html", version=APP_VERSION)


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------
@app.get("/api/health")
def health():
    boundary_ok, boundary_error, segments = True, None, 0
    try:
        segments = len(load_boundary()["segments"])
    except BoundaryDataError as exc:
        boundary_ok, boundary_error = False, str(exc)
    meta = load_metadata()
    return jsonify({
        "ok": boundary_ok,
        "service": "NautiGuard API",
        "version": APP_VERSION,
        "time": now_iso(),
        "boundary": {
            "loaded": boundary_ok,
            "segments": segments,
            "verification_status": meta.get("verification_status"),
            "error": boundary_error,
        },
        "ai": {"configured": gemini_service.is_configured(), "model": gemini_service.get_model_name()},
        "sms": {"mode": "simulated"},
    }), (200 if boundary_ok else 503)


@app.get("/api/config")
def config():
    """Public, non-secret settings for the browser."""
    maps_key = os.getenv("GOOGLE_MAPS_API_KEY", "").strip()
    if maps_key.lower().startswith("your_"):  # placeholder from .env.example
        maps_key = ""
    provider_pref = os.getenv("MAP_PROVIDER", "auto").strip().lower()
    use_google = bool(maps_key) and provider_pref in ("auto", "google")
    meta = load_metadata()
    return jsonify({
        "ok": True,
        "map_provider": "google" if use_google else "leaflet",
        # A Google Maps *browser* key is visible to every visitor by design.
        # Restrict it to the Maps JavaScript API + your site's referrers.
        "google_maps_api_key": maps_key if use_google else "",
        "thresholds_nm": alert_service.load_thresholds(),
        "hysteresis_nm": alert_service.HYSTERESIS_NM,
        "level_order": alert_service.LEVEL_ORDER,
        "level_labels": alert_service.LEVEL_LABELS,
        "metres_per_nm": METRES_PER_NM,
        "vessel_id": "NG-001",
        "sample_recipient": alert_service.SAMPLE_RECIPIENT,
        "sms_mode": "simulated",
        "ai_configured": gemini_service.is_configured(),
        "ai_model": gemini_service.get_model_name(),
        "boundary_verified": is_verified(meta),
        "boundary_label": meta.get("display_label", ""),
    })


@app.get("/api/boundary")
def boundary():
    try:
        b = load_boundary()
    except BoundaryDataError as exc:
        return error(str(exc), 503)
    meta = load_metadata()
    thresholds = alert_service.load_thresholds()
    zones = load_advisory_zones()
    zone_features = []
    if zones:
        wanted = {float(v) for v in thresholds.values()}
        zone_features = [f for f in zones.get("features", [])
                         if float(f.get("properties", {}).get("radius_nm", -1)) in wanted]
    return jsonify({
        "ok": True,
        "boundary": b["geojson"],
        "metadata": meta,
        "verified": is_verified(meta),
        "advisory_zones": {"type": "FeatureCollection", "features": zone_features},
    })


@app.post("/api/calculate-distance")
def calculate_distance():
    body = json_body()
    previous = body.get("previous_level")
    try:
        status = compute_status(body.get("lat"), body.get("lon"), previous)
    except InvalidCoordinateError as exc:
        return error(str(exc), 400)
    except BoundaryDataError as exc:
        return error(f"Boundary data unavailable: {exc}", 503)

    alert = None
    if alert_service.should_alert(status["level"], previous if previous in alert_service.SEVERITY else None):
        rec = alert_service.make_alert(
            status["level"],
            str(body.get("vessel_id") or "NG-001")[:20],
            status["position"]["lat"], status["position"]["lon"], status["distance_nm"],
            simulated_position=bool(body.get("simulated", True)),
            thresholds=status["thresholds_nm"],
        )
        alert_service.ALERT_LOG.add(rec)
        alert = rec.to_dict()
    status["alert"] = alert
    status["ok"] = True
    return jsonify(status)


@app.get("/api/vessel/status")
def vessel_status():
    """
    Stateless: the server does not track the vessel between requests.
    Pass ?lat=..&lon=..[&previous_level=..] to get the status for a position.
    """
    lat, lon = request.args.get("lat"), request.args.get("lon")
    if lat is None or lon is None:
        return error("Provide lat and lon query parameters. The server keeps no vessel state "
                     "between requests (serverless design); the browser sends each position.", 400)
    try:
        status = compute_status(lat, lon, request.args.get("previous_level"))
    except InvalidCoordinateError as exc:
        return error(str(exc), 400)
    except BoundaryDataError as exc:
        return error(f"Boundary data unavailable: {exc}", 503)
    status.update({"ok": True, "vessel_id": "NG-001",
                   "source": request.args.get("source", "simulated"), "time": now_iso()})
    return jsonify(status)


@app.get("/api/simulation/routes")
def simulation_routes():
    return jsonify({"ok": True, **load_routes()})


@app.post("/api/simulation/start")
def simulation_start():
    body = json_body()
    data = load_routes()
    route_id = body.get("route_id") or data["routes"][0]["id"]
    route = next((r for r in data["routes"] if r["id"] == route_id), None)
    if route is None:
        return error(f"Unknown route_id '{route_id}'.", 404,
                     available=[r["id"] for r in data["routes"]])
    return jsonify({
        "ok": True,
        "state": "running",
        "session_id": uuid.uuid4().hex[:10],
        "started_at": now_iso(),
        "route": route,
        "fishing_grounds": data["fishing_grounds"],
        "transit_speed_kn": data["transit_speed_kn"],
        "fishing_speed_kn": data["fishing_speed_kn"],
        "note": "The browser animates the boat. The server only calculates distance and alerts per position.",
    })


@app.post("/api/simulation/pause")
def simulation_pause():
    return jsonify({"ok": True, "state": "paused", "time": now_iso(),
                    "note": "Acknowledged. Simulation timing runs in the browser."})


@app.post("/api/simulation/resume")
def simulation_resume():
    return jsonify({"ok": True, "state": "running", "time": now_iso()})


@app.post("/api/simulation/reset")
def simulation_reset():
    return jsonify({"ok": True, "state": "reset", "time": now_iso()})


@app.get("/api/alerts")
def alerts():
    try:
        limit = max(1, min(200, int(request.args.get("limit", 50))))
    except ValueError:
        limit = 50
    return jsonify({
        "ok": True,
        "alerts": alert_service.ALERT_LOG.list(limit),
        "note": "In-memory log of this server instance only. Serverless instances are recycled, "
                "so the browser keeps the durable demo history.",
    })


@app.post("/api/alerts/test")
def alerts_test():
    body = json_body()
    lat, lon = body.get("lat", 9.60), body.get("lon", 79.25)
    try:
        status = compute_status(lat, lon)
    except InvalidCoordinateError as exc:
        return error(str(exc), 400)
    except BoundaryDataError as exc:
        return error(f"Boundary data unavailable: {exc}", 503)
    level = status["level"] if status["level"] != alert_service.SAFE else alert_service.EARLY_WARNING
    rec = alert_service.make_alert(level, str(body.get("vessel_id") or "NG-001")[:20],
                                   status["position"]["lat"], status["position"]["lon"],
                                   status["distance_nm"], simulated_position=True,
                                   thresholds=status["thresholds_nm"], is_test=True)
    alert_service.ALERT_LOG.add(rec)
    return jsonify({"ok": True, "alert": rec.to_dict(), "recipient": alert_service.SAMPLE_RECIPIENT})


# --- Fishing history (in-memory demo store; browser localStorage is primary) ---
_FISHING = []
_FISHING_LOCK = threading.Lock()
MAX_FISHING_RECORDS = 200


def _validate_fishing(body: dict) -> dict:
    try:
        clat, clon = validate_coordinates((body.get("center") or {}).get("lat"),
                                          (body.get("center") or {}).get("lon"))
    except InvalidCoordinateError as exc:
        raise ValueError(f"center: {exc}") from None
    route = body.get("route") or []
    if not isinstance(route, list) or len(route) > 2000:
        raise ValueError("route must be a list of at most 2000 [lat, lon] points.")
    clean_route = []
    for p in route:
        if not isinstance(p, (list, tuple)) or len(p) != 2:
            raise ValueError("each route point must be [lat, lon].")
        try:
            clean_route.append(list(validate_coordinates(p[0], p[1])))
        except InvalidCoordinateError as exc:
            raise ValueError(f"route: {exc}") from None
    notes = body.get("notes") or ""
    if not isinstance(notes, str) or len(notes) > 500:
        raise ValueError("notes must be text of at most 500 characters.")
    qty = body.get("catch_kg")
    if qty not in (None, ""):
        try:
            qty = float(qty)
        except (TypeError, ValueError):
            raise ValueError("catch_kg must be a number.") from None
        if qty < 0 or qty > 100000:
            raise ValueError("catch_kg must be between 0 and 100000.")
    else:
        qty = None
    return {
        "id": str(body.get("id") or uuid.uuid4().hex[:10])[:40],
        "started_at": str(body.get("started_at") or now_iso())[:40],
        "ended_at": str(body.get("ended_at") or "")[:40] or None,
        "duration_min": body.get("duration_min") if isinstance(body.get("duration_min"), (int, float)) else None,
        "center": {"lat": clat, "lon": clon},
        "route": clean_route,
        "notes": notes,
        "catch_kg": qty,
        "ground": str(body.get("ground") or "")[:80],
        "simulated": bool(body.get("simulated", True)),
        "saved_at": now_iso(),
    }


@app.get("/api/fishing-history")
def fishing_history_list():
    with _FISHING_LOCK:
        items = list(_FISHING)
    return jsonify({"ok": True, "sessions": items,
                    "note": "Demo store in server memory (not durable on serverless). "
                            "Recording a session never implies an area is safe or lawful."})


@app.post("/api/fishing-history")
def fishing_history_add():
    try:
        rec = _validate_fishing(json_body())
    except ValueError as exc:
        return error(str(exc), 400)
    with _FISHING_LOCK:
        _FISHING.insert(0, rec)
        del _FISHING[MAX_FISHING_RECORDS:]
    return jsonify({"ok": True, "session": rec}), 201


@app.post("/api/ai/chat")
def ai_chat():
    try:
        message, history, context = gemini_service.validate_chat_payload(request.get_json(silent=True))
        result = gemini_service.chat(message, history, context)
    except gemini_service.AssistantError as exc:
        return error(str(exc), exc.status)
    return jsonify({"ok": True, **result})


# ---------------------------------------------------------------------------
# Error handlers (JSON for the API)
# ---------------------------------------------------------------------------
@app.errorhandler(404)
def not_found(exc):
    if request.path.startswith("/api/"):
        return error("Endpoint not found.", 404)
    return exc


@app.errorhandler(405)
def method_not_allowed(exc):
    if request.path.startswith("/api/"):
        return error("Method not allowed for this endpoint.", 405)
    return exc


@app.errorhandler(413)
def too_large(exc):
    return error("Request body too large.", 413)


@app.errorhandler(500)
def server_error(exc):
    if request.path.startswith("/api/"):
        return error("Internal server error.", 500)
    return exc


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    app.run(host="127.0.0.1", port=port, debug=os.getenv("FLASK_DEBUG") == "1")
