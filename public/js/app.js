// NautiGuard - main controller. Wires the map, simulation / GPS, backend
// distance calculations, alerts, fishing history and the AI assistant.

import { api } from "./api.js";
import { t, setLang, getLang, applyTranslations, onLangChange, pick } from "./i18n.js";
import { createMap, LeafletMapAdapter } from "./map.js";
import { Simulation, GpsTracker } from "./simulation.js";
import { AlertManager, cssLevel } from "./alerts.js";
import { FishingHistory, confirmDialog } from "./fishing-history.js";
import { Assistant } from "./assistant.js";

const $ = (id) => document.getElementById(id);
const CALC_INTERVAL_MS = 700; // how often the current position is sent to the backend

const state = {
  config: null,
  boundary: null,
  routesData: null,
  map: null,
  mode: "demo", // "demo" | "gps"
  pos: null, // latest position snapshot (sim or gps)
  status: null, // latest backend result
  previousLevel: null, // used by the backend for de-duplication + hysteresis
  inFlight: false,
  lastSentKey: "",
  failures: 0,
  followBoat: true,
};

let sim, gps, alerts, history, assistant;

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------
function toDM(value, pos, neg) {
  const hemi = value >= 0 ? pos : neg;
  const v = Math.abs(value);
  const d = Math.floor(v);
  const m = (v - d) * 60;
  return `${String(d).padStart(2, "0")}° ${m.toFixed(2).padStart(5, "0")}′ ${hemi}`;
}
const fmtLat = (v) => `${v.toFixed(5)}° (${toDM(v, "N", "S")})`;
const fmtLon = (v) => `${v.toFixed(5)}° (${toDM(v, "E", "W")})`;

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
async function boot() {
  applyTranslations();
  startClock();
  wireNavigation();
  wireCollapsibles();

  try {
    state.config = await api.config();
  } catch (e) {
    $("banner-title").textContent = "NautiGuard server not reachable";
    $("banner-text").textContent = `${e.message} — start the backend with "python app.py".`;
    return;
  }
  const cfg = state.config;

  alerts = new AlertManager(cfg);
  alerts.showWaiting();
  alerts.renderAll();
  alerts.renderRecipient();
  alerts.renderSms();

  history = new FishingHistory({
    onChange: (items) => state.map && state.map.setFishingSessions(items),
    onReplay: (s) => { location.hash = "#map"; setTimeout(() => state.map.playRoute(s.route), 150); },
    toast: (title, body) => alerts.toast(title, body, "NONE"),
  });

  sim = new Simulation({
    onUpdate: onSimUpdate,
    onGroundEnter: (g, p) => history.startSession(g, p),
    onGroundExit: (g, p) => history.endSession(p),
    onComplete: () => { setPill("done"); alerts.toast(t("sim.done"), pick(state.routesData?.routes.find((r) => r.id === sim.route.id)?.name) || ""); updateButtons(); },
  });
  gps = new GpsTracker({ onPosition: onGpsPosition, onError: onGpsError });

  assistant = new Assistant({ getContext: buildAiContext, configured: cfg.ai_configured, model: cfg.ai_model });

  if (!cfg.boundary_verified) {
    document.querySelector(".banner-tag").textContent = "ILLUSTRATIVE boundary · alerts not verified";
  }
  $("footer-boundary").textContent = `Boundary: ${cfg.boundary_label}`;

  await buildMap();
  await loadRoutes();
  wireControls();
  history.render();
  onLangChange(refreshLanguage);
  routeFromHash();

  // Calculation loop: send the latest position to the backend.
  setInterval(() => sendPosition(false), CALC_INTERVAL_MS);
}

async function buildMap() {
  const el = $("map");
  const onFallback = async (msg, handled) => {
    showMapNotice(msg);
    if (handled) return;
    try { state.map?.destroy(); } catch { /* ignore */ }
    el.innerHTML = "";
    state.map = await new LeafletMapAdapter().init(el);
    drawStaticLayers();
  };
  try {
    state.map = await createMap(el, state.config, { onFallback });
  } catch (e) {
    showMapNotice(`The map could not be loaded (${e.message}). Distances and alerts still work.`);
    state.map = null;
  }
  try {
    const b = await api.boundary();
    state.boundary = b;
    const src = (b.metadata.sources || []).map((s) => s.title.split(" between")[0] + ` (${s.signed.slice(-4)})`).join("; ");
    $("legend-source").textContent = b.verified
      ? `Source: ${src}. UN DOALOS treaty texts, retrieved ${b.metadata.date_retrieved}. Datum not stated in the treaties — line may be offset by up to a few hundred metres. Not for navigation.`
      : "ILLUSTRATIVE boundary — source not verified. Alerts are for demonstration only.";
  } catch (e) {
    showMapNotice(`Boundary data unavailable: ${e.message}. Distance alerts are disabled.`);
  }
  drawStaticLayers();
}

function drawStaticLayers() {
  const m = state.map;
  if (!m) return;
  if (state.boundary) {
    m.setZones(state.boundary.advisory_zones);
    m.setBoundary(state.boundary.boundary);
  }
  if (state.routesData) {
    m.setGrounds(state.routesData.fishing_grounds);
    m.setHomePort(state.routesData.home_port);
  }
  if (history) m.setFishingSessions(history.mapItems());
  if (state.pos) {
    m.updateBoat({ ...state.pos, heading: state.pos.heading ?? 0 });
    m.setTrail(state.pos.trail || []);
  }
  if (state.status) drawMeasurement(state.status);
}

function showMapNotice(msg) {
  const box = $("map-error");
  box.textContent = msg;
  box.hidden = false;
  setTimeout(() => { box.hidden = true; }, 12000);
}

async function loadRoutes() {
  try {
    state.routesData = await api.routes();
  } catch (e) {
    showMapNotice(`Could not load demo routes: ${e.message}`);
    return;
  }
  const sel = $("route-select");
  sel.innerHTML = state.routesData.routes.map((r) => `<option value="${r.id}">${r.name}</option>`).join("");
  drawStaticLayers();
  loadRoute(sel.value);
}

function loadRoute(routeId) {
  const d = state.routesData;
  const route = d.routes.find((r) => r.id === routeId) || d.routes[0];
  if (history.active) history.endSession(sim.snapshot());
  sim.load({ route, grounds: d.fishing_grounds, transitKn: d.transit_speed_kn, fishingKn: d.fishing_speed_kn });
  $("route-desc").textContent = `${route.description} (${sim.totalLengthNm.toFixed(0)} NM)`;
  state.previousLevel = null;
  state.status = null;
  state.lastSentKey = "";
  state.map?.setMeasurement(null);
  $("map-measure").hidden = true;
  alerts.showWaiting();
  clearDistanceUI();
  if (state.map) {
    state.map.centerOn(route.waypoints[0][0], route.waypoints[0][1], 9);
    state.map.setTrail([]);
  }
  setPill("idle");
  updateButtons();
}

// ---------------------------------------------------------------------------
// Position sources
// ---------------------------------------------------------------------------
function onSimUpdate(snap) {
  if (state.mode !== "demo") return;
  state.pos = snap;
  renderPosition(snap);
  if (history?.active) history.addPoint(snap.lat, snap.lon);
}

function onGpsPosition(p) {
  state.pos = p;
  renderPosition(p);
  $("gps-accuracy").hidden = false;
  $("gps-accuracy").textContent = t("gps.accuracy", { m: Math.round(p.accuracy) });
  if (state.followBoat && state.map && p.trail.length === 1) state.map.centerOn(p.lat, p.lon, 10);
  sendPosition(false);
}

function onGpsError(err) {
  const msg = err.code === "unsupported" ? t("gps.unsupported") : err.code === 1 ? t("gps.denied") : `GPS: ${err.message || "error"}`;
  alerts.toast("GPS", msg, "CAUTION");
  if (err.code === "unsupported" || err.code === 1) setMode("demo");
}

function setMode(mode) {
  if (mode === state.mode) return;
  state.mode = mode;
  $("mode-demo").classList.toggle("active", mode === "demo");
  $("mode-gps").classList.toggle("active", mode === "gps");
  $("mode-demo").setAttribute("aria-checked", String(mode === "demo"));
  $("mode-gps").setAttribute("aria-checked", String(mode === "gps"));
  const badge = $("source-badge");
  badge.dataset.source = mode === "gps" ? "gps" : "sim";
  badge.textContent = mode === "gps" ? "DEVICE GPS" : "SIMULATED GPS";
  state.previousLevel = null;
  state.status = null;
  state.lastSentKey = "";
  state.pos = null;
  clearDistanceUI();
  alerts.showWaiting();
  state.map?.setMeasurement(null);
  state.map?.setTrail([]);
  state.map?.clearBoat();

  if (mode === "gps") {
    sim.pause();
    setPill("gps");
    $("gps-accuracy").hidden = false;
    $("gps-accuracy").textContent = t("gps.waiting");
    gps.start();
  } else {
    gps.stop();
    $("gps-accuracy").hidden = true;
    sim.reset();
    setPill("idle");
  }
  updateButtons();
}

// ---------------------------------------------------------------------------
// Backend calculation
// ---------------------------------------------------------------------------
async function sendPosition(force) {
  const p = state.pos;
  if (!p || state.inFlight || !state.boundary) return;
  if (state.mode === "demo" && sim.status === "idle" && !force) return;
  const key = `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
  if (!force && key === state.lastSentKey) return;

  state.inFlight = true;
  try {
    const st = await api.calculate({
      lat: p.lat, lon: p.lon, previous_level: state.previousLevel,
      vessel_id: state.config.vessel_id, simulated: state.mode === "demo",
    });
    state.lastSentKey = key;
    state.failures = 0;
    state.previousLevel = st.level;
    state.status = st;
    renderStatus(st);
    if (st.alert) alerts.add(st.alert);
  } catch (e) {
    state.failures += 1;
    if (state.failures >= 3) { alerts.showOffline(); clearDistanceUI(); }
  } finally {
    state.inFlight = false;
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function stateText(status) {
  return t({ idle: "state.idle", underway: "state.underway", fishing: "state.fishing", paused: "state.paused", done: "state.done", gps: "state.gps" }[status] || "state.idle");
}

function renderPosition(p) {
  $("v-status").textContent = stateText(p.status);
  $("v-lat").textContent = fmtLat(p.lat);
  $("v-lon").textContent = fmtLon(p.lon);
  $("v-speed").textContent = p.speedKn == null ? "—" : `${p.speedKn.toFixed(1)} kn`;
  $("v-heading").textContent = p.heading == null ? "—" : `${Math.round(p.heading).toString().padStart(3, "0")}°`;
  $("s-coords").textContent = `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`;
  if (state.map) {
    state.map.updateBoat({ lat: p.lat, lon: p.lon, heading: p.heading ?? 0, source: p.source });
    state.map.setTrail(p.trail || []);
  }
}

function renderStatus(st) {
  alerts.showStatus(st);
  $("v-distance").textContent = st.distance_nm.toFixed(1);
  $("v-distance-km").textContent = `≈ ${(st.distance_m / 1000).toFixed(1)} km · ${Math.round(st.distance_m).toLocaleString("en-IN")} m`;
  $("distance-card").dataset.level = st.level;
  $("v-segment").textContent = st.nearest_segment;
  $("v-bearing").textContent = `${Math.round(st.bearing_to_boundary_deg).toString().padStart(3, "0")}°`;
  const chip = $("v-level");
  chip.dataset.level = st.level;
  chip.textContent = alerts.label(st.level);
  $("s-proximity").textContent = `${st.distance_nm.toFixed(2)} NM`;
  drawMeasurement(st);
}

function drawMeasurement(st) {
  const label = `${st.distance_nm.toFixed(1)} NM`;
  state.map?.setMeasurement([st.position.lat, st.position.lon], [st.nearest_point.lat, st.nearest_point.lon], label);
  $("map-measure").hidden = false;
  $("map-measure-text").textContent = `${st.distance_nm.toFixed(2)} NM (${(st.distance_m / 1000).toFixed(1)} km) → ${st.nearest_point.lat.toFixed(4)}, ${st.nearest_point.lon.toFixed(4)}`;
}

function clearDistanceUI() {
  ["v-distance", "v-segment", "v-bearing", "s-proximity"].forEach((id) => { $(id).textContent = "—"; });
  $("v-distance-km").textContent = "";
  $("distance-card").dataset.level = "NONE";
  $("v-level").dataset.level = "NONE";
  $("v-level").textContent = "—";
}

function setPill(s) {
  const pill = $("sim-pill");
  pill.dataset.state = s;
  const key = { idle: "sim.idle", running: "sim.running", paused: "sim.paused", done: "sim.done", gps: "sim.gps" }[s];
  $("sim-pill-text").dataset.i18n = key;
  $("sim-pill-text").textContent = t(key);
}

function updateButtons() {
  const demo = state.mode === "demo";
  const st = sim.status;
  $("btn-start").disabled = !demo || st === "underway" || st === "fishing" || st === "paused";
  $("btn-pause").disabled = !demo || !(st === "underway" || st === "fishing" || st === "paused");
  $("btn-reset").disabled = !demo;
  $("route-select").disabled = !demo || sim.running || st === "paused";
  const key = st === "paused" ? "controls.resume" : "controls.pause";
  $("btn-pause-text").dataset.i18n = key;
  $("btn-pause-text").textContent = t(key);
  $("btn-pause").querySelector("use").setAttribute("href", st === "paused" ? "#i-play" : "#i-pause");
}

function refreshLanguage() {
  alerts.refreshLanguage();
  history.render();
  if (state.pos) renderPosition(state.pos);
  if (state.status) renderStatus(state.status);
  updateButtons();
  alerts.renderRecipient();
  alerts.renderSms();
  assistant.welcome();
}

// ---------------------------------------------------------------------------
// Controls & navigation
// ---------------------------------------------------------------------------
function wireControls() {
  $("btn-start").onclick = async () => {
    if (state.mode !== "demo") return;
    sim.setMultiplier($("speed-select").value);
    if (sim.status === "done") { state.previousLevel = null; state.lastSentKey = ""; }
    sim.start();
    setPill("running");
    updateButtons();
    if (state.map && state.pos) state.map.centerOn(state.pos.lat, state.pos.lon, 10);
    sendPosition(true);
    api.startSimulation(sim.route.id).catch(() => {});
  };
  $("btn-pause").onclick = () => {
    if (sim.status === "paused") { sim.resume(); setPill("running"); api.resumeSimulation().catch(() => {}); }
    else { sim.pause(); setPill("paused"); api.pauseSimulation().catch(() => {}); }
    updateButtons();
  };
  $("btn-reset").onclick = () => {
    if (history.active) history.endSession(sim.snapshot());
    sim.reset();
    loadRoute($("route-select").value);
    api.resetSimulation().catch(() => {});
  };
  $("route-select").onchange = (e) => loadRoute(e.target.value);
  $("speed-select").onchange = (e) => sim.setMultiplier(e.target.value);
  $("mode-demo").onclick = () => setMode("demo");
  $("mode-gps").onclick = () => setMode("gps");
  $("btn-mark").onclick = () => history.markSpot(state.pos);
  $("btn-center").onclick = () => {
    if (state.pos) state.map?.centerOn(state.pos.lat, state.pos.lon, 11);
    else state.map?.fitRegion();
  };
  $("btn-fit").onclick = () => state.map?.fitRegion();

  $("btn-sound").onclick = () => {
    const on = alerts.enableSound();
    $("btn-sound").setAttribute("aria-pressed", String(on));
    const span = $("btn-sound").querySelector("span");
    span.dataset.i18n = on ? "controls.soundOn" : "controls.sound";
    span.textContent = t(span.dataset.i18n);
  };
  $("btn-notify").onclick = async () => {
    const res = await alerts.enableNotifications();
    const span = $("btn-notify").querySelector("span");
    span.dataset.i18n = res === "granted" ? "controls.notifyOn" : "controls.notifyBlocked";
    span.textContent = res === "unsupported" ? "Not supported" : t(span.dataset.i18n);
    $("btn-notify").setAttribute("aria-pressed", String(res === "granted"));
  };

  $("btn-test-alert").onclick = async () => {
    const p = state.pos || { lat: 9.60, lon: 79.25 };
    try {
      const res = await api.testAlert({ lat: p.lat, lon: p.lon, vessel_id: state.config.vessel_id });
      alerts.add(res.alert);
    } catch (e) { alerts.toast("Test alert failed", e.message, "CAUTION"); }
  };
  $("btn-clear-alerts").onclick = async () => { if (await confirmDialog(t("alerts.clearQ"))) alerts.clear(); };
  $("btn-clear-history").onclick = () => history.clear();
  $("lang-toggle").onclick = () => setLang(getLang() === "en" ? "ta" : "en");
}

const VIEWS = ["dashboard", "map", "history", "alerts", "assistant"];
function routeFromHash() {
  const v = (location.hash || "#dashboard").slice(1);
  const view = VIEWS.includes(v) ? v : "dashboard";
  $("app").dataset.view = view;
  document.querySelectorAll("#mainnav a").forEach((a) => a.classList.toggle("active", a.dataset.viewLink === view));
  if (view === "dashboard" || view === "map") state.map?.invalidate();
  if (view === "alerts") alerts?.markRead();
  window.scrollTo(0, 0);
}

function wireNavigation() {
  window.addEventListener("hashchange", routeFromHash);
}

function wireCollapsibles() {
  document.querySelectorAll(".collapsible .panel-head").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (window.innerWidth > 1100) return; // panels are always open on wide screens
      btn.setAttribute("aria-expanded", String(btn.getAttribute("aria-expanded") !== "true"));
    });
  });
  if (window.innerWidth <= 640) {
    $("legend").open = false;
    // Small phones: start with the long panels collapsed so the map stays in view.
    ["panel-recent", "panel-alerts-mini"].forEach((id) => $(id).querySelector(".panel-head").setAttribute("aria-expanded", "false"));
  }
}

function startClock() {
  const tick = () => {
    const now = new Date();
    $("clock").textContent = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZoneName: "short" });
  };
  tick();
  setInterval(tick, 1000);
}

// ---------------------------------------------------------------------------
// AI context (only what the dashboard shows; clearly labelled as simulated)
// ---------------------------------------------------------------------------
function buildAiContext() {
  const p = state.pos, st = state.status;
  const lines = [
    `Position source: ${state.mode === "gps" ? "browser device GPS (not marine-grade)" : "SIMULATED GPS (demonstration route)"}`,
    `Language preference: ${getLang() === "ta" ? "Tamil" : "English"}`,
  ];
  if (state.mode === "demo" && sim?.route) lines.push(`Demo route: ${sim.route.name}; simulation status: ${sim.status}`);
  if (p) lines.push(`Vessel NG-001 at ${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}; speed ${p.speedKn == null ? "unknown" : p.speedKn.toFixed(1) + " kn"}; heading ${p.heading == null ? "unknown" : Math.round(p.heading) + " deg"}`);
  else lines.push("No position yet.");
  if (st) {
    lines.push(`Distance to mapped treaty boundary: ${st.distance_nm.toFixed(2)} NM; level: ${st.level}; nearest segment: ${st.nearest_segment}`);
    lines.push(`Current warning message (English): ${st.message.en}`);
  }
  const th = state.config.thresholds_nm;
  lines.push(`App thresholds (demo, not official): early warning <= ${th.EARLY_WARNING} NM, caution <= ${th.CAUTION}, high alert <= ${th.HIGH_ALERT}, critical <= ${th.CRITICAL}`);
  const recent = alerts.alerts.slice(0, 3).map((a) => `${a.level} at ${a.distance_nm.toFixed(1)} NM (${a.timestamp})`);
  if (recent.length) lines.push(`Recent alerts: ${recent.join("; ")}`);
  lines.push(`Recent fishing history:\n${history.summary()}`);
  return lines.join("\n");
}

boot();
