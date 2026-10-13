"""
NautiGuard AI Assistant - server-side Gemini integration.

The API key is read from the GEMINI_API_KEY environment variable and never
leaves the server. The browser only talks to /api/ai/chat.
"""

from __future__ import annotations

import os

DEFAULT_MODEL = "gemini-3.5-flash-lite"
MAX_MESSAGE_CHARS = 1000
MAX_HISTORY_TURNS = 10
MAX_CONTEXT_CHARS = 4000

SYSTEM_INSTRUCTION = """You are the NautiGuard AI Assistant inside a college demonstration app for fishermen
operating from Rameswaram, Tamil Nadu, India. Reply in simple, clear sentences. If the user writes in Tamil,
reply in simple Tamil. Keep answers short (under about 180 words) unless asked for detail.

You can help with:
- explaining the dashboard status and the NautiGuard warning levels (SAFE, EARLY WARNING <=50 NM,
  CAUTION <=25 NM, HIGH ALERT <=10 NM, CRITICAL <=5 NM). These are demonstration thresholds chosen by the
  app, NOT official government warning levels and NOT legal buffers;
- nautical miles (1 NM = 1,852 metres) and how map distances are measured;
- summarising the recent fishing history that is provided to you;
- translating safety messages between Tamil and English;
- general fishing-trip safety checklists (life jackets, VHF radio, fuel, weather check, informing family,
  distress procedures);
- why GPS accuracy and verified boundary data matter.

Strict rules:
- Only use vessel data that appears in the "Dashboard context" block. That data comes from the user's
  browser and is usually SIMULATED. Never claim you can see live vessel positions, AIS, radar or satellites.
- Never invent or recite boundary coordinates. If asked, say the app uses the turning points of the
  1974 and 1976 India-Sri Lanka agreements as transcribed in its data file, and that official charts govern.
- Never say whether a particular fishing activity or location is legal or illegal. Being near or far from the
  boundary line does not decide legality; fishing rules are separate. Refer users to the Tamil Nadu Fisheries
  Department, the Indian Coast Guard and official charts.
- Never present NautiGuard alerts as official Coast Guard warnings.
- In an emergency, tell the user to contact the Indian Coast Guard (maritime distress toll-free number 1554)
  or use VHF channel 16, and to follow official instructions.
"""


class AssistantError(Exception):
    def __init__(self, message: str, status: int = 500):
        super().__init__(message)
        self.status = status


def _env(name: str) -> str:
    """Read an env var, treating the .env.example placeholders ("your_...") as empty."""
    value = os.getenv(name, "").strip()
    return "" if value.lower().startswith("your_") else value


def get_model_name() -> str:
    return os.getenv("GEMINI_MODEL", "").strip() or DEFAULT_MODEL


def is_configured() -> bool:
    return bool(_env("GEMINI_API_KEY"))


def validate_chat_payload(payload) -> tuple[str, list, str]:
    """Return (message, history, context) or raise AssistantError(400)."""
    if not isinstance(payload, dict):
        raise AssistantError("Request body must be a JSON object.", 400)
    message = payload.get("message")
    if not isinstance(message, str) or not message.strip():
        raise AssistantError("'message' must be a non-empty string.", 400)
    message = message.strip()
    if len(message) > MAX_MESSAGE_CHARS:
        raise AssistantError(f"Message is too long (max {MAX_MESSAGE_CHARS} characters).", 400)

    history_in = payload.get("history") or []
    if not isinstance(history_in, list):
        raise AssistantError("'history' must be a list.", 400)
    history = []
    for item in history_in[-MAX_HISTORY_TURNS * 2:]:
        if not isinstance(item, dict):
            continue
        role = item.get("role")
        text = item.get("text")
        if role in ("user", "model") and isinstance(text, str) and text.strip():
            history.append({"role": role, "text": text.strip()[:MAX_MESSAGE_CHARS * 2]})

    context = payload.get("context") or ""
    if not isinstance(context, str):
        raise AssistantError("'context' must be a string.", 400)
    return message, history, context[:MAX_CONTEXT_CHARS]


def _default_client_factory(api_key: str):
    try:
        from google import genai  # official Google Gen AI SDK (package: google-genai)
    except ImportError as exc:  # pragma: no cover - depends on environment
        raise AssistantError("The google-genai package is not installed on the server.", 500) from exc
    return genai.Client(api_key=api_key)


def chat(message: str, history: list, context: str, client_factory=None) -> dict:
    """Send one chat turn to Gemini. client_factory is injectable for tests."""
    api_key = _env("GEMINI_API_KEY")
    if not api_key:
        raise AssistantError(
            "The AI assistant is not configured. Set GEMINI_API_KEY on the server to enable it.", 503
        )

    factory = client_factory or _default_client_factory
    client = factory(api_key)
    model = get_model_name()

    contents = []
    for turn in history:
        contents.append({"role": turn["role"], "parts": [{"text": turn["text"]}]})
    user_text = message
    if context:
        user_text = (
            "Dashboard context (from the user's browser; may be simulated):\n"
            f"{context}\n\nUser question:\n{message}"
        )
    contents.append({"role": "user", "parts": [{"text": user_text}]})

    try:
        from google.genai import types  # noqa: WPS433

        config = types.GenerateContentConfig(
            system_instruction=SYSTEM_INSTRUCTION,
            temperature=0.4,
            max_output_tokens=700,
        )
    except ImportError:
        # Test doubles do not need the real config type.
        config = {"system_instruction": SYSTEM_INSTRUCTION, "temperature": 0.4, "max_output_tokens": 700}

    try:
        response = client.models.generate_content(model=model, contents=contents, config=config)
    except AssistantError:
        raise
    except Exception as exc:  # network errors, quota, invalid key, unknown model ...
        text = str(exc)
        status = 502
        lowered = text.lower()
        if "api key" in lowered or "permission" in lowered or "401" in text or "403" in text:
            status = 502
            hint = "Gemini rejected the request (check that GEMINI_API_KEY is valid)."
        elif "429" in text or "quota" in lowered or "resource_exhausted" in lowered:
            status = 429
            hint = "Gemini quota or rate limit reached. Wait a minute and try again."
        elif "not found" in lowered or "404" in text:
            hint = f"Model '{model}' was not found. Set GEMINI_MODEL to a model your key can use."
        else:
            hint = "The AI service could not be reached. Please try again."
        raise AssistantError(hint, status) from exc

    reply = (getattr(response, "text", None) or "").strip()
    if not reply:
        reply = "Sorry, I could not produce an answer for that. Please rephrase your question."
    return {"reply": reply, "model": model}
