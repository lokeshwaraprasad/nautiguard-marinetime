// Alert presentation: banner, level ladder, toasts, optional sound, optional
// browser notifications, the alert log (localStorage) and the SMS preview.
// WHEN to alert is decided by the backend (services/alert_service.py).

import { t, pick, getLang } from "./i18n.js";

const STORE_KEY = "nautiguard.alerts.v1";
const MAX_ALERTS = 200;
const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function loadStore() {
  try { const v = JSON.parse(localStorage.getItem(STORE_KEY) || "[]"); return Array.isArray(v) ? v : []; }
  catch { return []; }
}

export class AlertManager {
  constructor(config) {
    this.config = config;
    this.labels = config.level_labels;
    this.alerts = loadStore();
    this.unread = 0;
    this.soundOn = false;
    this.audio = null;
    this.lastStatus = null;
  }

  label(level) { return pick(this.labels[level]) || level; }

  save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.alerts.slice(0, MAX_ALERTS))); } catch { /* full or blocked */ }
  }

  // ---------------- Level ladder & banner ----------------
  renderLadder(level) {
    const th = this.config.thresholds_nm;
    const rows = [
      ["CRITICAL", `≤ ${th.CRITICAL} NM`], ["HIGH_ALERT", `≤ ${th.HIGH_ALERT} NM`],
      ["CAUTION", `≤ ${th.CAUTION} NM`], ["EARLY_WARNING", `≤ ${th.EARLY_WARNING} NM`],
      ["SAFE", `> ${th.EARLY_WARNING} NM`],
    ];
    $("ladder").innerHTML = rows.map(([lv, txt]) =>
      `<li data-level="${lv}" class="${lv === level ? "current" : ""}"><span>${esc(this.label(lv))}</span><span>${txt}</span></li>`).join("");
  }

  showStatus(status) {
    this.lastStatus = status;
    const banner = $("banner");
    banner.dataset.level = status.level;
    $("banner-title").textContent = `${this.label(status.level)} · ${status.distance_nm.toFixed(1)} NM`;
    $("banner-title").removeAttribute("data-i18n");
    $("banner-text").textContent = pick(status.message);
    $("banner-text").removeAttribute("data-i18n");
    this.renderLadder(status.level);
  }

  showOffline() {
    const banner = $("banner");
    banner.dataset.level = "NONE";
    $("banner-title").textContent = t("banner.offline");
    $("banner-text").textContent = "";
  }

  showWaiting() {
    $("banner").dataset.level = "NONE";
    $("banner-title").textContent = t("banner.waiting");
    $("banner-text").textContent = t("banner.start");
    this.renderLadder(null);
  }

  refreshLanguage() {
    if (this.lastStatus) this.showStatus(this.lastStatus); else this.showWaiting();
    this.renderAll();
  }

  // ---------------- New alerts ----------------
  add(alert, { silent = false } = {}) {
    this.alerts.unshift(alert);
    this.alerts = this.alerts.slice(0, MAX_ALERTS);
    this.save();
    if (!document.querySelector('.layout[data-view="alerts"]')) this.unread += 1;
    this.renderAll();
    this.renderSms(alert);
    if (silent) return;

    const msg = pick(alert.message);
    const isClear = alert.level === "SAFE";
    this.toast(isClear ? t("toast.allClear") : `${this.label(alert.level)} · ${alert.distance_nm.toFixed(1)} NM`, msg, alert.level);
    const banner = $("banner");
    banner.classList.remove("flash"); void banner.offsetWidth; banner.classList.add("flash");
    if (!isClear) this.beep(alert.severity);
    this.notify(alert);
  }

  toast(title, body, level = "NONE") {
    const box = $("toasts");
    const el = document.createElement("div");
    el.className = "toast";
    el.dataset.level = level;
    el.style.setProperty("--c", `var(--lv-${{ SAFE: "safe", EARLY_WARNING: "early", CAUTION: "caution", HIGH_ALERT: "high", CRITICAL: "critical" }[level] || "none"})`);
    el.innerHTML = `<div><strong>${esc(title)}</strong><p>${esc(body)}</p></div>
      <button type="button" aria-label="Close"><svg class="ic"><use href="#i-x"/></svg></button>`;
    el.querySelector("button").onclick = () => el.remove();
    box.prepend(el);
    while (box.children.length > 3) box.lastChild.remove();
    setTimeout(() => el.remove(), level === "CRITICAL" ? 12000 : 7000);
  }

  // ---------------- Sound (needs a user click first, browser rule) ----------------
  enableSound() {
    try {
      this.audio = this.audio || new (window.AudioContext || window.webkitAudioContext)();
      this.audio.resume();
      this.soundOn = !this.soundOn;
      if (this.soundOn) this.beep(1);
    } catch { this.soundOn = false; }
    return this.soundOn;
  }

  beep(severity = 1) {
    if (!this.soundOn || !this.audio) return;
    const n = Math.max(1, Math.min(4, severity));
    const freq = 520 + n * 140;
    for (let i = 0; i < n; i++) {
      const start = this.audio.currentTime + i * 0.28;
      const osc = this.audio.createOscillator();
      const gain = this.audio.createGain();
      osc.type = "sine"; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
      osc.connect(gain).connect(this.audio.destination);
      osc.start(start); osc.stop(start + 0.24);
    }
  }

  // ---------------- Browser notifications ----------------
  async enableNotifications() {
    if (!("Notification" in window)) return "unsupported";
    if (Notification.permission === "granted") return "granted";
    try { return await Notification.requestPermission(); } catch { return "denied"; }
  }

  notify(alert) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    if (document.visibilityState === "visible" && alert.level === "SAFE") return;
    try {
      new Notification(`NautiGuard · ${this.label(alert.level)}`, {
        body: pick(alert.message), tag: "nautiguard-level", icon: "/assets/logo.svg", renotify: true,
      });
    } catch { /* some mobile browsers only allow notifications from a service worker */ }
  }

  // ---------------- Rendering ----------------
  renderAll() {
    this.renderMini();
    this.renderTable();
    const badge = $("alert-badge");
    badge.hidden = this.unread === 0;
    badge.textContent = this.unread > 99 ? "99+" : String(this.unread);
  }

  markRead() { this.unread = 0; this.renderAll(); }

  timeStr(iso) {
    try {
      return new Date(iso).toLocaleString(getLang() === "ta" ? "ta-IN" : "en-IN",
        { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch { return iso; }
  }

  renderMini() {
    const ul = $("recent-alerts");
    if (!this.alerts.length) { ul.innerHTML = `<li class="empty-item">${esc(t("alerts.none"))}</li>`; return; }
    ul.innerHTML = this.alerts.slice(0, 5).map((a) => `
      <li class="lv" data-level="${a.level}" style="--c: var(--lv-${cssLevel(a.level)})">
        <div class="row"><strong>${esc(this.label(a.level))}${a.is_test ? ` <span class="muted">(${esc(t("alerts.testTag"))})</span>` : ""}</strong>
        <span class="mono">${a.distance_nm.toFixed(1)} NM</span></div>
        <span class="muted">${esc(this.timeStr(a.timestamp))}</span>
      </li>`).join("");
  }

  renderTable() {
    const tbody = document.querySelector("#alerts-table tbody");
    $("alerts-empty").hidden = this.alerts.length > 0;
    tbody.innerHTML = this.alerts.map((a) => `
      <tr class="lv" style="--c: var(--lv-${cssLevel(a.level)})">
        <td><span class="level-chip" data-level="${a.level}">${esc(this.label(a.level))}</span>
          ${a.is_test ? `<span class="sim-tag">${esc(t("alerts.testTag"))}</span>` : ""}
          ${a.simulated_position ? '<span class="sim-tag">SIM</span>' : ""}</td>
        <td class="mono">${esc(this.timeStr(a.timestamp))}</td>
        <td class="mono">${a.lat.toFixed(4)}, ${a.lon.toFixed(4)}</td>
        <td class="mono">${a.distance_nm.toFixed(2)} NM</td>
        <td>${esc(pick(a.message))}</td>
      </tr>`).join("");
  }

  renderRecipient() {
    const r = this.config.sample_recipient;
    $("sms-recipient").innerHTML = `${esc(t("sms.to"))}: <strong>${esc(r.name)}</strong> · ${esc(r.role)}<br>
      <span class="mono">${esc(r.phone)}</span> · ${esc(r.note)}`;
  }

  renderSms(alert) {
    if (!alert) { alert = this.alerts[0]; if (!alert) return; }
    const sms = alert.sms_preview || {};
    $("sms-bubble").textContent = getLang() === "ta" ? (sms.text_ta || sms.text) : (sms.text_en || sms.text);
    $("sms-bubble").removeAttribute("data-i18n");
    $("sms-meta").textContent = `${this.timeStr(alert.timestamp)} · ${t("sms.status")}`;
  }

  clear() {
    this.alerts = []; this.unread = 0; this.save(); this.renderAll();
    $("sms-bubble").textContent = t("sms.none");
    $("sms-meta").textContent = "";
  }
}

export function cssLevel(level) {
  return { SAFE: "safe", EARLY_WARNING: "early", CAUTION: "caution", HIGH_ALERT: "high", CRITICAL: "critical" }[level] || "none";
}
