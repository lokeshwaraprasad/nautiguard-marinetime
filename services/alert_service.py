"""
Warning levels, bilingual alert messages, alert de-duplication and the
simulated SMS / notification module.

IMPORTANT: the thresholds below are NautiGuard DEMONSTRATION thresholds. They
are not official government warning levels and do not mark where fishing
becomes unlawful.
"""

from __future__ import annotations

import os
import threading
import uuid
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone

# ---------------------------------------------------------------------------
# Levels (most severe last). Distance thresholds are "at or below" values in NM.
# ---------------------------------------------------------------------------
SAFE = "SAFE"
EARLY_WARNING = "EARLY_WARNING"
CAUTION = "CAUTION"
HIGH_ALERT = "HIGH_ALERT"
CRITICAL = "CRITICAL"

LEVEL_ORDER = [SAFE, EARLY_WARNING, CAUTION, HIGH_ALERT, CRITICAL]
SEVERITY = {lvl: i for i, lvl in enumerate(LEVEL_ORDER)}

DEFAULT_THRESHOLDS_NM = {EARLY_WARNING: 50.0, CAUTION: 25.0, HIGH_ALERT: 10.0, CRITICAL: 5.0}

# To step DOWN to a less severe level the boat must be this far past the
# threshold. Stops alerts flickering when a boat drifts along a threshold line.
HYSTERESIS_NM = 0.2

LEVEL_LABELS = {
    SAFE: {"en": "Safe", "ta": "பாதுகாப்பு"},
    EARLY_WARNING: {"en": "Early warning", "ta": "முன்னெச்சரிக்கை"},
    CAUTION: {"en": "Caution", "ta": "கவனம்"},
    HIGH_ALERT: {"en": "High alert", "ta": "அதிக எச்சரிக்கை"},
    CRITICAL: {"en": "Critical", "ta": "மிக அவசரம்"},
}

MESSAGES = {
    SAFE: {
        "en": "Your vessel is currently outside the {zone} NM advisory zone.",
        "ta": "உங்கள் படகு தற்போது {zone} கடல் மைல் எச்சரிக்கை மண்டலத்திற்கு வெளியே உள்ளது.",
    },
    EARLY_WARNING: {
        "en": "Warning: Your boat is approaching the maritime boundary advisory zone. "
              "Please check your position and follow official navigation guidance.",
        "ta": "எச்சரிக்கை: உங்கள் படகு கடல் எல்லை எச்சரிக்கை மண்டலத்திற்குள் வந்துள்ளது. "
              "உங்கள் இருப்பிடத்தைச் சரிபார்த்து, அதிகாரப்பூர்வ வழிகாட்டுதலைப் பின்பற்றவும்.",
    },
    CAUTION: {
        "en": "Caution: Your vessel is getting closer to the maritime boundary. "
              "Review your course and consult official navigation information.",
        "ta": "கவனம்: உங்கள் படகு கடல் எல்லைக்கு அருகில் வருகிறது. "
              "உங்கள் பாதையைச் சரிபார்த்து, அதிகாரப்பூர்வ வழிசெலுத்தல் தகவலைப் பார்க்கவும்.",
    },
    HIGH_ALERT: {
        "en": "High alert: Your vessel is very close to the mapped boundary. "
              "Verify your location and take appropriate action under official guidance.",
        "ta": "அதிக எச்சரிக்கை: உங்கள் படகு வரைபடத்தில் உள்ள எல்லைக்கு மிக அருகில் உள்ளது. "
              "உங்கள் இருப்பிடத்தை உறுதிசெய்து, அதிகாரப்பூர்வ வழிகாட்டுதலின்படி செயல்படவும்.",
    },
    CRITICAL: {
        "en": "Critical proximity alert: Your vessel is extremely close to the mapped boundary. "
              "Immediately verify your position and follow applicable maritime safety instructions.",
        "ta": "மிக அவசர எச்சரிக்கை: உங்கள் படகு வரைபடத்தில் உள்ள எல்லைக்கு மிக மிக அருகில் உள்ளது. "
              "உடனே உங்கள் இருப்பிடத்தைச் சரிபார்த்து, கடல் பாதுகாப்பு வழிமுறைகளைப் பின்பற்றவும்.",
    },
}

DISTANCE_SENTENCE = {
    "en": "Distance to the mapped boundary: {d} NM.",
    "ta": "வரைபட எல்லைக்கான தூரம்: {d} கடல் மைல்.",
}

DISCLAIMER = {
    "en": "NautiGuard demonstration alert - not an official Coast Guard warning.",
    "ta": "இது NautiGuard செயல்விளக்க எச்சரிக்கை - அதிகாரப்பூர்வ கடலோர காவல்படை எச்சரிக்கை அல்ல.",
}


def load_thresholds() -> dict:
    """
    Thresholds can be overridden with NAUTIGUARD_THRESHOLDS_NM="50,25,10,5"
    (early warning, caution, high alert, critical). Values must strictly decrease.
    """
    raw = os.getenv("NAUTIGUARD_THRESHOLDS_NM", "").strip()
    if not raw:
        return dict(DEFAULT_THRESHOLDS_NM)
    try:
        vals = [float(v) for v in raw.split(",")]
    except ValueError:
        return dict(DEFAULT_THRESHOLDS_NM)
    if len(vals) != 4 or any(v <= 0 for v in vals) or vals != sorted(vals, reverse=True) or len(set(vals)) != 4:
        return dict(DEFAULT_THRESHOLDS_NM)
    return dict(zip([EARLY_WARNING, CAUTION, HIGH_ALERT, CRITICAL], vals))


def raw_level(distance_nm: float, thresholds: dict | None = None) -> str:
    """Level purely from distance (no hysteresis)."""
    t = thresholds or DEFAULT_THRESHOLDS_NM
    level = SAFE
    for lvl in (EARLY_WARNING, CAUTION, HIGH_ALERT, CRITICAL):
        if distance_nm <= t[lvl]:
            level = lvl
    return level


def classify(distance_nm: float, previous_level: str | None = None,
             thresholds: dict | None = None, hysteresis_nm: float = HYSTERESIS_NM) -> str:
    """
    Level with hysteresis. Escalation is immediate. De-escalation from the
    previous level only happens once the boat is hysteresis_nm beyond the
    threshold of that previous level.
    """
    t = thresholds or DEFAULT_THRESHOLDS_NM
    level = raw_level(distance_nm, t)
    if previous_level in SEVERITY and SEVERITY[level] < SEVERITY[previous_level]:
        # Stay at the previous level until clearly past its threshold.
        if distance_nm <= t[previous_level] + hysteresis_nm:
            return previous_level
        # Possibly drop several levels; re-apply hysteresis to the level above the new one.
        return raw_level(distance_nm - hysteresis_nm, t)
    return level


def should_alert(new_level: str, previous_level: str | None) -> bool:
    """
    De-duplication rule: alert only when the level CHANGES.
    - entering any warning level (higher or lower than before) -> alert
    - returning to SAFE from a warning level -> an informational "all clear"
    - the same level as last tick -> no alert (prevents spam)
    - very first reading -> alert only if it is already a warning level
    """
    if previous_level not in SEVERITY:
        return new_level != SAFE
    return new_level != previous_level


def format_distance(distance_nm: float) -> str:
    return f"{distance_nm:.1f}"


def build_message(level: str, distance_nm: float | None, thresholds: dict | None = None) -> dict:
    t = thresholds or DEFAULT_THRESHOLDS_NM
    zone = format_distance(t[EARLY_WARNING]).rstrip("0").rstrip(".")
    out = {}
    for lang in ("en", "ta"):
        text = MESSAGES[level][lang].format(zone=zone)
        if distance_nm is not None:
            text += " " + DISTANCE_SENTENCE[lang].format(d=format_distance(distance_nm))
        out[lang] = text
    return out


def build_sms_text(vessel_id: str, distance_nm: float, level: str) -> dict:
    d = format_distance(distance_nm)
    return {
        "en": f"NAUTIGUARD ALERT ({LEVEL_LABELS[level]['en'].upper()}): Vessel {vessel_id} is approximately "
              f"{d} NM from the mapped maritime boundary. Verify your position and follow official navigation guidance.",
        "ta": f"NAUTIGUARD எச்சரிக்கை ({LEVEL_LABELS[level]['ta']}): படகு {vessel_id} வரைபட கடல் எல்லையிலிருந்து "
              f"சுமார் {d} கடல் மைல் தொலைவில் உள்ளது. உங்கள் இருப்பிடத்தைச் சரிபார்த்து அதிகாரப்பூர்வ வழிகாட்டுதலைப் பின்பற்றவும்.",
    }


# ---------------------------------------------------------------------------
# Notification providers (extensible). Only the simulated provider ships.
# A real provider must read its credentials from server-side environment
# variables and must report "sent" only after the provider confirms it.
# ---------------------------------------------------------------------------
SAMPLE_RECIPIENT = {
    "name": "Sample contact (demo)",
    "role": "Boat owner / family contact",
    "phone": "+91 00000 00000",
    "language": "ta",
    "note": "Placeholder profile for demonstration. No real phone number is stored.",
}


class SimulatedSmsProvider:
    name = "simulated"

    def send(self, to: str, text: str) -> dict:
        return {
            "provider": self.name,
            "status": "SIMULATED_NOT_SENT",
            "detail": "Preview only. No SMS was sent because no SMS provider is configured.",
            "to": to,
            "text": text,
        }


def get_sms_provider():
    provider = os.getenv("SMS_PROVIDER", "none").strip().lower()
    # Hook for the future: e.g. if provider == "twilio": return TwilioProvider(...)
    # Until a real provider is implemented and configured, always simulate.
    return SimulatedSmsProvider()


# ---------------------------------------------------------------------------
# Alert records + in-memory log
# ---------------------------------------------------------------------------
@dataclass
class AlertRecord:
    id: str
    timestamp: str
    level: str
    severity: int
    vessel_id: str
    lat: float
    lon: float
    distance_nm: float
    message: dict
    sms_preview: dict
    simulated_position: bool
    is_test: bool = False

    def to_dict(self) -> dict:
        return dict(self.__dict__)


def make_alert(level: str, vessel_id: str, lat: float, lon: float, distance_nm: float,
               simulated_position: bool, thresholds: dict | None = None, is_test: bool = False) -> AlertRecord:
    sms_text = build_sms_text(vessel_id, distance_nm, level)
    provider = get_sms_provider()
    sms = provider.send(SAMPLE_RECIPIENT["phone"], sms_text[SAMPLE_RECIPIENT["language"]])
    sms["text_en"] = sms_text["en"]
    sms["text_ta"] = sms_text["ta"]
    return AlertRecord(
        id=uuid.uuid4().hex[:12],
        timestamp=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        level=level,
        severity=SEVERITY[level],
        vessel_id=vessel_id,
        lat=round(lat, 6),
        lon=round(lon, 6),
        distance_nm=round(distance_nm, 2),
        message=build_message(level, distance_nm, thresholds),
        sms_preview=sms,
        simulated_position=simulated_position,
        is_test=is_test,
    )


class AlertLog:
    """
    Small in-memory log. On Vercel each serverless instance has its own memory
    and instances are recycled, so this log is NOT durable. The browser keeps
    the authoritative alert history in localStorage for the demo.
    """

    def __init__(self, maxlen: int = 200):
        self._items: deque = deque(maxlen=maxlen)
        self._lock = threading.Lock()

    def add(self, alert: AlertRecord):
        with self._lock:
            self._items.appendleft(alert.to_dict())

    def list(self, limit: int = 50) -> list:
        with self._lock:
            return list(self._items)[:limit]

    def clear(self):
        with self._lock:
            self._items.clear()


ALERT_LOG = AlertLog()
