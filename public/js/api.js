// Tiny fetch wrapper for the Flask API. Every call returns parsed JSON or
// throws an Error whose message is safe to show to the user.

async function request(method, path, body, { timeoutMs = 15000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  } catch (e) {
    if (e.name === "AbortError") throw new Error("The server took too long to respond.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  config: () => request("GET", "/api/config"),
  boundary: () => request("GET", "/api/boundary"),
  routes: () => request("GET", "/api/simulation/routes"),
  startSimulation: (routeId) => request("POST", "/api/simulation/start", { route_id: routeId }),
  pauseSimulation: () => request("POST", "/api/simulation/pause", {}),
  resumeSimulation: () => request("POST", "/api/simulation/resume", {}),
  resetSimulation: () => request("POST", "/api/simulation/reset", {}),
  calculate: (payload) => request("POST", "/api/calculate-distance", payload, { timeoutMs: 8000 }),
  testAlert: (payload) => request("POST", "/api/alerts/test", payload),
  saveFishing: (session) => request("POST", "/api/fishing-history", session),
  chat: (payload) => request("POST", "/api/ai/chat", payload, { timeoutMs: 45000 }),
};
