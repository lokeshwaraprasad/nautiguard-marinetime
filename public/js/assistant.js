// NautiGuard AI Assistant chat panel. The browser never sees the Gemini key:
// it only calls /api/ai/chat on our own server.

import { api } from "./api.js";
import { t } from "./i18n.js";

const MAX_TURNS = 10;
const $ = (id) => document.getElementById(id);

export class Assistant {
  constructor({ getContext, configured, model }) {
    this.getContext = getContext;
    this.configured = configured;
    this.model = model;
    this.history = [];
    this.busy = false;
    $("chat-form").addEventListener("submit", (e) => { e.preventDefault(); this.send($("chat-input").value); });
    $("chat-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); this.send($("chat-input").value); }
    });
    document.querySelectorAll("#chat-suggest .chip").forEach((c) => { c.onclick = () => this.send(c.dataset.q); });
    this.welcome();
  }

  welcome() {
    $("chat-log").innerHTML = "";
    this.bubble("bot", t("ai.welcome"));
    if (!this.configured) this.bubble("err", t("ai.notConfigured"));
  }

  bubble(kind, text, meta) {
    const el = document.createElement("div");
    el.className = `msg ${kind}`;
    el.textContent = text;
    if (meta) { const m = document.createElement("span"); m.className = "meta"; m.textContent = meta; el.appendChild(m); }
    $("chat-log").appendChild(el);
    $("chat-log").scrollTop = $("chat-log").scrollHeight;
    return el;
  }

  async send(raw) {
    const text = (raw || "").trim();
    if (!text || this.busy) return;
    if (text.length > 1000) { this.bubble("err", "Message is too long (max 1000 characters)."); return; }
    $("chat-input").value = "";
    this.bubble("user", text);
    this.busy = true;
    $("chat-send").disabled = true;
    const typing = this.bubble("bot", "");
    typing.innerHTML = '<span class="typing"><span></span><span></span><span></span></span>';
    try {
      const res = await api.chat({ message: text, history: this.history.slice(-MAX_TURNS * 2), context: this.getContext() });
      typing.remove();
      this.bubble("bot", res.reply, `Gemini · ${res.model}`);
      this.history.push({ role: "user", text }, { role: "model", text: res.reply });
      this.history = this.history.slice(-MAX_TURNS * 2);
    } catch (e) {
      typing.remove();
      this.bubble("err", e.status === 503 ? t("ai.notConfigured") : e.message);
    } finally {
      this.busy = false;
      $("chat-send").disabled = false;
      $("chat-input").focus();
    }
  }
}
