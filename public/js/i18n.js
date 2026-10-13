// Tamil / English interface text. Alert sentences themselves come from the
// server (services/alert_service.py) in both languages.

const STRINGS = {
  en: {
    tagline: "Know Your Waters. Return Home Safely.",
    "nav.dashboard": "Dashboard", "nav.map": "Marine Map", "nav.history": "Fishing History",
    "nav.alerts": "Safety Alerts", "nav.assistant": "AI Assistant",
    "sim.idle": "Simulation idle", "sim.running": "Simulation running", "sim.paused": "Paused",
    "sim.done": "Route complete", "sim.gps": "Device GPS live",
    "banner.waiting": "Waiting for position",
    "banner.start": "Start the simulation or switch on device GPS to calculate the distance to the mapped boundary.",
    "banner.demo": "Demo thresholds · not official",
    "banner.offline": "Distance unavailable — the server could not be reached. Do not rely on this screen.",
    "vessel.title": "Vessel", "vessel.selected": "Selected boat", "vessel.status": "Vessel status",
    "vessel.lat": "Latitude", "vessel.lon": "Longitude", "vessel.speed": "Speed", "vessel.heading": "Heading",
    "vessel.distance": "Distance to maritime boundary", "vessel.segment": "Nearest boundary segment",
    "vessel.bearing": "Bearing to line", "vessel.warning": "Warning status",
    "state.idle": "In harbour (idle)", "state.underway": "Underway", "state.fishing": "Fishing",
    "state.paused": "Paused", "state.done": "Route complete", "state.gps": "Live device GPS",
    "map.center": "Center on boat", "map.region": "Region",
    "legend.title": "Legend", "legend.boundary": "Treaty boundary (1974/1976)", "legend.zone50": "50 NM advisory zone",
    "legend.ring25": "25 NM caution ring", "legend.ring10": "10 NM high-alert ring", "legend.ring5": "5 NM critical ring",
    "legend.boat": "Boat (simulated position)", "legend.trail": "Route trail", "legend.fished": "Recently fished area",
    "legend.ground": "Demo fishing ground", "legend.measure": "Distance to nearest point",
    "status.title": "Safety status",
    "status.note": "Demonstration thresholds chosen by NautiGuard. They are not official government warning levels and do not mark where fishing becomes unlawful.",
    "status.coords": "Coordinates", "status.proximity": "Boundary proximity",
    "controls.title": "Simulation controls", "controls.demo": "Demonstration", "controls.gps": "Device GPS",
    "controls.route": "Route", "controls.speed": "Simulation speed", "controls.start": "Start",
    "controls.pause": "Pause", "controls.resume": "Resume", "controls.reset": "Reset",
    "controls.mark": "Mark fishing spot", "controls.sound": "Enable sound", "controls.soundOn": "Sound on",
    "controls.notify": "Enable notifications", "controls.notifyOn": "Notifications on",
    "controls.notifyBlocked": "Notifications blocked",
    "recent.title": "Recent fishing activity", "recent.empty": "No fishing sessions yet.",
    "alerts.recent": "Alert history", "alerts.viewAll": "View full alert log →", "alerts.none": "No alerts yet.",
    "alerts.title": "Safety alerts",
    "alerts.sub": "A new alert is raised only when the warning level changes, so the log is not flooded on every update.",
    "alerts.test": "Send test alert", "alerts.clear": "Clear log", "alerts.severity": "Severity", "alerts.time": "Time",
    "alerts.coords": "Coordinates", "alerts.distance": "Distance", "alerts.message": "Message", "alerts.empty": "No alerts yet.",
    "alerts.testTag": "TEST", "alerts.clearQ": "Clear the alert log stored in this browser?",
    "sms.title": "SMS notification preview", "sms.none": "No alert generated yet.",
    "sms.note": "No SMS provider is configured, so messages are only previewed here. A real provider can be added on the server using protected environment variables.",
    "sms.to": "To", "sms.status": "Status: simulated — not sent",
    "history.title": "Fishing history",
    "history.sub": "Sessions are recorded automatically when the boat enters a demo fishing ground, or when you mark a spot. Stored in this browser only.",
    "history.clear": "Clear history", "history.session": "Session", "history.date": "Date", "history.duration": "Duration",
    "history.position": "Position", "history.catch": "Catch", "history.notes": "Notes",
    "history.empty": "No fishing sessions yet. Start the simulation, or press “Mark fishing spot”.",
    "history.legal": "A recorded fishing session does not mean the area is safe or lawful to fish. Always follow official rules.",
    "history.replay": "Replay route", "history.edit": "Edit notes", "history.clearQ": "Delete all fishing sessions stored in this browser? This cannot be undone.",
    "history.simTime": "simulated time", "history.inProgress": "in progress", "history.spot": "Marked spot",
    "fish.title": "Fishing spot", "fish.notes": "Catch notes", "fish.qty": "Catch quantity (kg, optional)",
    "fish.saved": "Fishing spot saved", "fish.started": "Fishing started", "fish.ended": "Fishing session saved",
    "fish.noPos": "No position yet — start the simulation or GPS first.",
    "common.cancel": "Cancel", "common.save": "Save", "common.confirm": "Yes, clear", "common.areYouSure": "Are you sure?",
    "ai.title": "NautiGuard AI Assistant",
    "ai.sub": "Ask about the dashboard, warning levels, nautical miles, your fishing history or a safety checklist. Answers are generated by Google Gemini.",
    "ai.q1": "Explain my current status", "ai.q2": "What do the warning levels mean?", "ai.q3": "Summarise my fishing history",
    "ai.q4": "Pre-trip safety checklist", "ai.q5": "Translate warning to Tamil",
    "ai.placeholder": "Type your question…", "ai.send": "Send",
    "ai.disclaimer": "The assistant only sees the dashboard summary your browser sends. It cannot see live vessels and does not give legal advice.",
    "ai.welcome": "Vanakkam! I'm the NautiGuard assistant. Ask me about your dashboard, the warning levels or trip safety.",
    "ai.notConfigured": "The AI assistant is not configured on this server yet (GEMINI_API_KEY is missing). Everything else in NautiGuard still works.",
    "gps.unsupported": "This browser does not support GPS location.",
    "gps.denied": "Location permission was denied. Switched back to demonstration mode.",
    "gps.waiting": "Waiting for a GPS fix…", "gps.accuracy": "GPS accuracy ±{m} m (browser location — may use Wi-Fi/cell, not marine-grade GPS).",
    "toast.allClear": "Back outside the advisory zone",
    "footer.nav": "Not for navigation. Use official charts and Indian Coast Guard / Fisheries Department guidance. Emergency: Coast Guard 1554 · VHF Ch 16.",
    "unit.nm": "NM", "unit.min": "min", "unit.kg": "kg",
  },
  ta: {
    tagline: "உங்கள் கடலை அறியுங்கள். பாதுகாப்பாக வீடு திரும்புங்கள்.",
    "nav.dashboard": "முகப்பு", "nav.map": "வரைபடம்", "nav.history": "மீன்பிடி வரலாறு",
    "nav.alerts": "எச்சரிக்கைகள்", "nav.assistant": "AI உதவி",
    "sim.idle": "நிறுத்தத்தில்", "sim.running": "இயங்குகிறது", "sim.paused": "இடைநிறுத்தம்",
    "sim.done": "பயணம் முடிந்தது", "sim.gps": "சாதன GPS இயக்கத்தில்",
    "banner.waiting": "இருப்பிடத்திற்காக காத்திருக்கிறது",
    "banner.start": "எல்லைக்கான தூரத்தைக் கணக்கிட, உருவகப்படுத்தலைத் தொடங்கவும் அல்லது சாதன GPS-ஐ இயக்கவும்.",
    "banner.demo": "செயல்விளக்க அளவுகள் · அதிகாரப்பூர்வமல்ல",
    "banner.offline": "தூரம் கிடைக்கவில்லை — சேவையகத்தை அணுக முடியவில்லை. இந்தத் திரையை நம்ப வேண்டாம்.",
    "vessel.title": "படகு", "vessel.selected": "தேர்ந்தெடுத்த படகு", "vessel.status": "படகு நிலை",
    "vessel.lat": "அட்சரேகை", "vessel.lon": "தீர்க்கரேகை", "vessel.speed": "வேகம்", "vessel.heading": "திசை",
    "vessel.distance": "கடல் எல்லைக்கான தூரம்", "vessel.segment": "அருகிலுள்ள எல்லைப் பகுதி",
    "vessel.bearing": "எல்லையை நோக்கிய திசை", "vessel.warning": "எச்சரிக்கை நிலை",
    "state.idle": "துறைமுகத்தில் (நிறுத்தம்)", "state.underway": "பயணத்தில்", "state.fishing": "மீன்பிடிக்கிறது",
    "state.paused": "இடைநிறுத்தம்", "state.done": "பயணம் முடிந்தது", "state.gps": "நேரடி சாதன GPS",
    "map.center": "படகை மையப்படுத்து", "map.region": "பகுதி",
    "legend.title": "குறியீடுகள்", "legend.boundary": "ஒப்பந்த எல்லை (1974/1976)", "legend.zone50": "50 கடல் மைல் எச்சரிக்கை மண்டலம்",
    "legend.ring25": "25 கடல் மைல் கவன வளையம்", "legend.ring10": "10 கடல் மைல் அதிக எச்சரிக்கை வளையம்", "legend.ring5": "5 கடல் மைல் அவசர வளையம்",
    "legend.boat": "படகு (உருவக இருப்பிடம்)", "legend.trail": "பயணப் பாதை", "legend.fished": "சமீபத்தில் மீன்பிடித்த பகுதி",
    "legend.ground": "மாதிரி மீன்பிடி பகுதி", "legend.measure": "அருகிலுள்ள புள்ளிக்கான தூரம்",
    "status.title": "பாதுகாப்பு நிலை",
    "status.note": "இவை NautiGuard தேர்ந்தெடுத்த செயல்விளக்க அளவுகள். இவை அதிகாரப்பூர்வ அரசு எச்சரிக்கை நிலைகள் அல்ல; மீன்பிடித்தல் எங்கு சட்டவிரோதம் என்பதையும் குறிக்கவில்லை.",
    "status.coords": "ஆயத்தொலைவுகள்", "status.proximity": "எல்லை அருகாமை",
    "controls.title": "உருவகப்படுத்தல் கட்டுப்பாடுகள்", "controls.demo": "செயல்விளக்கம்", "controls.gps": "சாதன GPS",
    "controls.route": "பாதை", "controls.speed": "உருவகப்படுத்தல் வேகம்", "controls.start": "தொடங்கு",
    "controls.pause": "இடைநிறுத்து", "controls.resume": "தொடர்", "controls.reset": "மீட்டமை",
    "controls.mark": "மீன்பிடி இடத்தைக் குறி", "controls.sound": "ஒலியை இயக்கு", "controls.soundOn": "ஒலி இயக்கத்தில்",
    "controls.notify": "அறிவிப்புகளை இயக்கு", "controls.notifyOn": "அறிவிப்புகள் இயக்கத்தில்",
    "controls.notifyBlocked": "அறிவிப்புகள் தடுக்கப்பட்டுள்ளன",
    "recent.title": "சமீபத்திய மீன்பிடி", "recent.empty": "இதுவரை மீன்பிடி அமர்வுகள் இல்லை.",
    "alerts.recent": "எச்சரிக்கை வரலாறு", "alerts.viewAll": "முழு எச்சரிக்கைப் பதிவைப் பார் →", "alerts.none": "இதுவரை எச்சரிக்கைகள் இல்லை.",
    "alerts.title": "பாதுகாப்பு எச்சரிக்கைகள்",
    "alerts.sub": "எச்சரிக்கை நிலை மாறும்போது மட்டுமே புதிய எச்சரிக்கை உருவாகும்; ஒவ்வொரு புதுப்பிப்பிலும் அல்ல.",
    "alerts.test": "சோதனை எச்சரிக்கை", "alerts.clear": "பதிவை அழி", "alerts.severity": "தீவிரம்", "alerts.time": "நேரம்",
    "alerts.coords": "ஆயத்தொலைவுகள்", "alerts.distance": "தூரம்", "alerts.message": "செய்தி", "alerts.empty": "இதுவரை எச்சரிக்கைகள் இல்லை.",
    "alerts.testTag": "சோதனை", "alerts.clearQ": "இந்த உலாவியில் சேமித்த எச்சரிக்கைப் பதிவை அழிக்கவா?",
    "sms.title": "SMS அறிவிப்பு முன்னோட்டம்", "sms.none": "இதுவரை எச்சரிக்கை உருவாகவில்லை.",
    "sms.note": "SMS சேவை அமைக்கப்படவில்லை; எனவே செய்திகள் இங்கு முன்னோட்டமாக மட்டுமே காட்டப்படுகின்றன. உண்மையான சேவையைப் பாதுகாப்பான சூழல் மாறிகள் மூலம் சேவையகத்தில் சேர்க்கலாம்.",
    "sms.to": "பெறுநர்", "sms.status": "நிலை: உருவகம் — அனுப்பப்படவில்லை",
    "history.title": "மீன்பிடி வரலாறு",
    "history.sub": "படகு மாதிரி மீன்பிடி பகுதிக்குள் நுழையும்போது அல்லது நீங்கள் இடத்தைக் குறிக்கும்போது அமர்வுகள் தானாகப் பதிவாகும். இந்த உலாவியில் மட்டுமே சேமிக்கப்படும்.",
    "history.clear": "வரலாற்றை அழி", "history.session": "அமர்வு", "history.date": "தேதி", "history.duration": "கால அளவு",
    "history.position": "இருப்பிடம்", "history.catch": "பிடிப்பு", "history.notes": "குறிப்புகள்",
    "history.empty": "இதுவரை மீன்பிடி அமர்வுகள் இல்லை. உருவகப்படுத்தலைத் தொடங்கவும் அல்லது “மீன்பிடி இடத்தைக் குறி” அழுத்தவும்.",
    "history.legal": "மீன்பிடி அமர்வு பதிவானதால், அந்தப் பகுதி பாதுகாப்பானது அல்லது சட்டப்படி அனுமதிக்கப்பட்டது என்று பொருள் அல்ல. எப்போதும் அதிகாரப்பூர்வ விதிகளைப் பின்பற்றவும்.",
    "history.replay": "பாதையை மீண்டும் காட்டு", "history.edit": "குறிப்புகளைத் திருத்து", "history.clearQ": "இந்த உலாவியில் உள்ள அனைத்து மீன்பிடி அமர்வுகளையும் நீக்கவா? இதைத் திரும்பப் பெற முடியாது.",
    "history.simTime": "உருவக நேரம்", "history.inProgress": "நடைபெறுகிறது", "history.spot": "குறித்த இடம்",
    "fish.title": "மீன்பிடி இடம்", "fish.notes": "பிடிப்புக் குறிப்புகள்", "fish.qty": "பிடிப்பு அளவு (கிலோ, விருப்பம்)",
    "fish.saved": "மீன்பிடி இடம் சேமிக்கப்பட்டது", "fish.started": "மீன்பிடி தொடங்கியது", "fish.ended": "மீன்பிடி அமர்வு சேமிக்கப்பட்டது",
    "fish.noPos": "இன்னும் இருப்பிடம் இல்லை — முதலில் உருவகப்படுத்தல் அல்லது GPS-ஐத் தொடங்கவும்.",
    "common.cancel": "ரத்து", "common.save": "சேமி", "common.confirm": "ஆம், அழி", "common.areYouSure": "உறுதியாக உள்ளீர்களா?",
    "ai.title": "NautiGuard AI உதவியாளர்",
    "ai.sub": "முகப்புத் திரை, எச்சரிக்கை நிலைகள், கடல் மைல், உங்கள் மீன்பிடி வரலாறு அல்லது பாதுகாப்புச் சரிபார்ப்புப் பட்டியல் பற்றிக் கேளுங்கள். பதில்கள் Google Gemini மூலம் உருவாக்கப்படுகின்றன.",
    "ai.q1": "என் தற்போதைய நிலையை விளக்கு", "ai.q2": "எச்சரிக்கை நிலைகளின் பொருள் என்ன?", "ai.q3": "என் மீன்பிடி வரலாற்றைச் சுருக்கு",
    "ai.q4": "பயணத்திற்கு முன் பாதுகாப்புப் பட்டியல்", "ai.q5": "எச்சரிக்கையைத் தமிழில் மொழிபெயர்",
    "ai.placeholder": "உங்கள் கேள்வியைத் தட்டச்சு செய்யவும்…", "ai.send": "அனுப்பு",
    "ai.disclaimer": "உங்கள் உலாவி அனுப்பும் முகப்புச் சுருக்கத்தை மட்டுமே உதவியாளர் பார்க்கும். நேரடி படகுகளைப் பார்க்க முடியாது; சட்ட ஆலோசனை வழங்காது.",
    "ai.welcome": "வணக்கம்! நான் NautiGuard உதவியாளர். உங்கள் முகப்புத் திரை, எச்சரிக்கை நிலைகள் அல்லது பயணப் பாதுகாப்பு பற்றிக் கேளுங்கள்.",
    "ai.notConfigured": "இந்தச் சேவையகத்தில் AI உதவியாளர் இன்னும் அமைக்கப்படவில்லை (GEMINI_API_KEY இல்லை). NautiGuard-இன் மற்ற அனைத்தும் வேலை செய்யும்.",
    "gps.unsupported": "இந்த உலாவி GPS இருப்பிடத்தை ஆதரிக்கவில்லை.",
    "gps.denied": "இருப்பிட அனுமதி மறுக்கப்பட்டது. செயல்விளக்க முறைக்குத் திரும்பியது.",
    "gps.waiting": "GPS இருப்பிடத்திற்காக காத்திருக்கிறது…", "gps.accuracy": "GPS துல்லியம் ±{m} மீ (உலாவி இருப்பிடம் — கடல் தர GPS அல்ல).",
    "toast.allClear": "எச்சரிக்கை மண்டலத்திற்கு வெளியே திரும்பியது",
    "footer.nav": "வழிசெலுத்தலுக்கு அல்ல. அதிகாரப்பூர்வ வரைபடங்கள் மற்றும் இந்திய கடலோர காவல்படை / மீன்வளத் துறை வழிகாட்டுதலைப் பயன்படுத்தவும். அவசரம்: கடலோர காவல்படை 1554 · VHF சேனல் 16.",
    "unit.nm": "கடல் மைல்", "unit.min": "நிமி", "unit.kg": "கிலோ",
  },
};

const LANG_KEY = "nautiguard.lang";
let current = "en";
try { current = localStorage.getItem(LANG_KEY) === "ta" ? "ta" : "en"; } catch { /* storage blocked */ }
const listeners = [];

export function getLang() { return current; }

export function t(key, vars = {}) {
  const s = STRINGS[current][key] ?? STRINGS.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`));
}

export function applyTranslations(root = document) {
  document.documentElement.lang = current;
  root.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  const toggle = document.getElementById("lang-toggle-text");
  if (toggle) toggle.textContent = current === "en" ? "தமிழ்" : "English";
}

export function setLang(lang) {
  current = lang === "ta" ? "ta" : "en";
  try { localStorage.setItem(LANG_KEY, current); } catch { /* ignore */ }
  applyTranslations();
  listeners.forEach((fn) => fn(current));
}

export function onLangChange(fn) { listeners.push(fn); }

/** Pick the right language from a server {en, ta} object. */
export function pick(obj) {
  if (!obj) return "";
  if (typeof obj === "string") return obj;
  return obj[current] || obj.en || "";
}
