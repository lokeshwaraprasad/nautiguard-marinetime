// Fishing activity tracking. Version 1 stores sessions in this browser's
// localStorage. All storage goes through the small `store` object below, so a
// real database (via the /api/fishing-history endpoint) can replace it later.

import { t, getLang } from "./i18n.js";
import { api } from "./api.js";

const STORE_KEY = "nautiguard.fishing.v1";
const MAX_SESSIONS = 100;
const $ = (id) => document.getElementById(id);

const store = {
  load() {
    try { const v = JSON.parse(localStorage.getItem(STORE_KEY) || "[]"); return Array.isArray(v) ? v : []; }
    catch { return []; }
  },
  save(list) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(list.slice(0, MAX_SESSIONS))); } catch { /* storage full / blocked */ }
  },
};

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const newId = () => `FS-${Date.now().toString(36).toUpperCase().slice(-5)}${Math.random().toString(36).slice(2, 4).toUpperCase()}`;

/** Ask for notes + catch with the <dialog>. Resolves to {notes, catch_kg} or null. */
function askDetails({ title, lat, lon, notes = "", qty = "" }) {
  const dlg = $("fish-dialog");
  $("fish-dialog-title").textContent = title;
  $("fish-dialog-pos").textContent = lat != null ? `${lat.toFixed(5)}, ${lon.toFixed(5)}` : "";
  $("fish-notes").value = notes;
  $("fish-qty").value = qty ?? "";
  return new Promise((resolve) => {
    dlg.addEventListener("close", function onClose() {
      dlg.removeEventListener("close", onClose);
      if (dlg.returnValue !== "save") return resolve(null);
      const q = $("fish-qty").value.trim();
      const n = q === "" ? null : Number(q);
      resolve({ notes: $("fish-notes").value.trim().slice(0, 500), catch_kg: Number.isFinite(n) && n >= 0 ? n : null });
    });
    dlg.returnValue = "";
    dlg.showModal();
  });
}

export function confirmDialog(text) {
  const dlg = $("confirm-dialog");
  $("confirm-title").textContent = t("common.areYouSure");
  $("confirm-text").textContent = text;
  return new Promise((resolve) => {
    dlg.addEventListener("close", function onClose() {
      dlg.removeEventListener("close", onClose);
      resolve(dlg.returnValue === "ok");
    });
    dlg.returnValue = "";
    dlg.showModal();
  });
}

export class FishingHistory {
  constructor({ onChange, onReplay, toast }) {
    this.sessions = store.load();
    this.active = null;
    this.onChange = onChange || (() => {});
    this.onReplay = onReplay || (() => {});
    this.toast = toast || (() => {});
  }

  // ---------- automatic sessions (boat enters / leaves a demo ground) ----------
  startSession(ground, pos) {
    this.active = {
      id: newId(), kind: "auto", started_at: new Date().toISOString(), ended_at: null,
      startSim: pos.simSeconds || 0, ground: ground.id, ground_name: ground.name,
      radius_nm: Math.min(1.5, ground.radius_nm), route: [[pos.lat, pos.lon]],
      notes: "", catch_kg: null, simulated: pos.source !== "gps",
    };
    this.toast(t("fish.started"), ground.name);
    this.render();
  }

  addPoint(lat, lon) {
    if (!this.active) return;
    const r = this.active.route;
    const last = r[r.length - 1];
    if (Math.abs(last[0] - lat) + Math.abs(last[1] - lon) > 0.002) r.push([+lat.toFixed(5), +lon.toFixed(5)]);
    if (r.length > 1500) r.splice(1, 1); // keep it bounded
  }

  endSession(pos) {
    const s = this.active;
    if (!s) return;
    this.active = null;
    s.ended_at = new Date().toISOString();
    s.duration_min = Math.max(1, Math.round(((pos.simSeconds || 0) - s.startSim) / 60));
    s.sim_time = s.simulated;
    delete s.startSim;
    const lat = s.route.reduce((a, p) => a + p[0], 0) / s.route.length;
    const lon = s.route.reduce((a, p) => a + p[1], 0) / s.route.length;
    s.center = { lat: +lat.toFixed(5), lon: +lon.toFixed(5) };
    this.sessions.unshift(s);
    this.persist(s);
    this.toast(t("fish.ended"), `${s.ground_name} · ${s.duration_min} ${t("unit.min")}`);
  }

  // ---------- manual "Mark fishing spot" ----------
  async markSpot(pos) {
    if (!pos) { this.toast(t("fish.noPos"), ""); return; }
    const details = await askDetails({ title: t("fish.title"), lat: pos.lat, lon: pos.lon });
    if (!details) return;
    const s = {
      id: newId(), kind: "spot", started_at: new Date().toISOString(), ended_at: new Date().toISOString(),
      duration_min: 0, center: { lat: +pos.lat.toFixed(5), lon: +pos.lon.toFixed(5) },
      route: (pos.trail || []).slice(-200).map(([a, b]) => [+a.toFixed(5), +b.toFixed(5)]),
      radius_nm: 0.5, ground: "", ground_name: t("history.spot"),
      notes: details.notes, catch_kg: details.catch_kg, simulated: pos.source !== "gps", sim_time: false,
    };
    this.sessions.unshift(s);
    this.persist(s);
    this.toast(t("fish.saved"), `${s.center.lat}, ${s.center.lon}`);
  }

  async edit(id) {
    const s = this.sessions.find((x) => x.id === id);
    if (!s) return;
    const d = await askDetails({ title: `${t("history.edit")} · ${s.id}`, lat: s.center.lat, lon: s.center.lon, notes: s.notes, qty: s.catch_kg });
    if (!d) return;
    Object.assign(s, d);
    this.persist(null);
  }

  async clear() {
    if (!(await confirmDialog(t("history.clearQ")))) return;
    this.sessions = [];
    this.active = null;
    this.persist(null);
  }

  persist(newSession) {
    this.sessions = this.sessions.slice(0, MAX_SESSIONS);
    store.save(this.sessions);
    this.render();
    if (newSession) {
      // Best-effort copy to the backend (demo, in-memory there). Failure is fine.
      api.saveFishing({ ...newSession, route: newSession.route.slice(0, 2000) }).catch(() => {});
    }
  }

  // ---------- rendering ----------
  mapItems() {
    return this.sessions.map((s, i) => ({
      center: s.center, radius_nm: s.radius_nm || 0.6,
      label: `${s.ground_name || s.id} · ${this.dateStr(s.started_at)}${i === 0 ? " (latest)" : ""}`,
    }));
  }

  dateStr(iso) {
    try {
      return new Date(iso).toLocaleString(getLang() === "ta" ? "ta-IN" : "en-IN",
        { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch { return iso; }
  }

  durationStr(s) {
    if (s.kind === "spot") return "—";
    return `${s.duration_min} ${t("unit.min")}${s.sim_time ? ` (${t("history.simTime")})` : ""}`;
  }

  render() {
    // Mini list on the dashboard
    const mini = $("recent-fishing");
    const items = [];
    if (this.active) {
      items.push(`<li class="lv" style="--c: var(--teal)"><div class="row"><strong>${esc(this.active.ground_name)}</strong>
        <span class="muted">${esc(t("history.inProgress"))}</span></div></li>`);
    }
    for (const s of this.sessions.slice(0, 4)) {
      items.push(`<li><div class="row"><strong>${esc(s.ground_name || s.id)}</strong><span class="mono">${esc(this.durationStr(s))}</span></div>
        <span class="muted">${esc(this.dateStr(s.started_at))} · ${s.center.lat.toFixed(3)}, ${s.center.lon.toFixed(3)}</span></li>`);
    }
    mini.innerHTML = items.length ? items.join("") : `<li class="empty-item">${esc(t("recent.empty"))}</li>`;

    // Full table
    const tbody = document.querySelector("#history-table tbody");
    $("history-empty").hidden = this.sessions.length > 0;
    tbody.innerHTML = this.sessions.map((s) => `
      <tr>
        <td><strong class="mono">${esc(s.id)}</strong>${s.simulated ? '<span class="sim-tag">SIM</span>' : ""}<br>
          <span class="muted small">${esc(s.ground_name || "")}</span></td>
        <td>${esc(this.dateStr(s.started_at))}</td>
        <td>${esc(this.durationStr(s))}</td>
        <td class="mono">${s.center.lat.toFixed(4)}, ${s.center.lon.toFixed(4)}</td>
        <td>${s.catch_kg != null ? `${s.catch_kg} ${esc(t("unit.kg"))}` : "—"}</td>
        <td>${esc(s.notes || "—")}</td>
        <td><div class="actions">
          <button class="btn btn-ghost btn-sm" type="button" data-replay="${esc(s.id)}" title="${esc(t("history.replay"))}" ${s.route.length < 2 ? "disabled" : ""}>
            <svg class="ic"><use href="#i-replay"/></svg></button>
          <button class="btn btn-ghost btn-sm" type="button" data-edit="${esc(s.id)}" title="${esc(t("history.edit"))}">
            <svg class="ic"><use href="#i-edit"/></svg></button>
        </div></td>
      </tr>`).join("");
    tbody.querySelectorAll("[data-replay]").forEach((b) => {
      b.onclick = () => { const s = this.sessions.find((x) => x.id === b.dataset.replay); if (s) this.onReplay(s); };
    });
    tbody.querySelectorAll("[data-edit]").forEach((b) => { b.onclick = () => this.edit(b.dataset.edit); });

    this.onChange(this.mapItems());
  }

  /** Short text summary for the AI assistant. */
  summary(limit = 8) {
    if (!this.sessions.length) return "No fishing sessions recorded yet.";
    return this.sessions.slice(0, limit).map((s) =>
      `- ${s.id} (${s.simulated ? "simulated" : "device GPS"}): ${s.ground_name || "spot"}, ${s.started_at.slice(0, 16).replace("T", " ")} UTC, ` +
      `${s.kind === "spot" ? "marked spot" : `${s.duration_min} min${s.sim_time ? " simulated time" : ""}`}, ` +
      `at ${s.center.lat.toFixed(3)}, ${s.center.lon.toFixed(3)}` +
      `${s.catch_kg != null ? `, catch ${s.catch_kg} kg` : ""}${s.notes ? `, notes: ${s.notes.slice(0, 80)}` : ""}`).join("\n");
  }
}
