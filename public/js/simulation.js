// Boat movement for the demonstration, plus the optional real device-GPS source.
//
// The browser animates the boat (smooth 60 fps movement). The OFFICIAL distance
// and warning level always come from the Python backend; the spherical maths
// here is only used to move the boat icon and to detect demo fishing grounds.

const R_EARTH = 6371008.8; // mean Earth radius (m), animation only
const NM = 1852; // metres per nautical mile
const KN_TO_MS = NM / 3600; // 1 knot = 1852 m per hour
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

export function haversineM(a, b) {
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearingDeg(a, b) {
  const φ1 = toRad(a[0]), φ2 = toRad(b[0]), Δλ = toRad(b[1] - a[1]);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Point a fraction f (0..1) of the way along the great circle from a to b. */
export function interpolate(a, b, f) {
  const d = haversineM(a, b) / R_EARTH;
  if (d === 0) return [a[0], a[1]];
  const φ1 = toRad(a[0]), λ1 = toRad(a[1]), φ2 = toRad(b[0]), λ2 = toRad(b[1]);
  const A = Math.sin((1 - f) * d) / Math.sin(d);
  const B = Math.sin(f * d) / Math.sin(d);
  const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
  const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
  const z = A * Math.sin(φ1) + B * Math.sin(φ2);
  return [toDeg(Math.atan2(z, Math.hypot(x, y))), toDeg(Math.atan2(y, x))];
}

function turnToward(current, target, maxStep) {
  const diff = ((target - current + 540) % 360) - 180;
  if (Math.abs(diff) <= maxStep) return (target + 360) % 360;
  return (current + Math.sign(diff) * maxStep + 360) % 360;
}

export class Simulation {
  constructor(handlers = {}) {
    this.h = handlers; // onUpdate(state), onGroundEnter(g, state), onGroundExit(g, state), onComplete(state)
    this.multiplier = 300;
    this.raf = null;
    this.status = "idle";
    this.route = null;
  }

  load({ route, grounds, transitKn, fishingKn }) {
    this.stopLoop();
    this.route = route;
    this.waypoints = route.waypoints.map(([lat, lon]) => [lat, lon]);
    this.grounds = grounds || [];
    this.transitKn = transitKn || 8;
    this.fishingKn = fishingKn || 3;
    this.legs = [];
    for (let i = 0; i < this.waypoints.length - 1; i++) {
      const a = this.waypoints[i], b = this.waypoints[i + 1];
      this.legs.push({ a, b, len: haversineM(a, b), brg: bearingDeg(a, b) });
    }
    this.resetState();
  }

  resetState() {
    this.leg = 0;
    this.legPos = 0; // metres along current leg
    this.position = [...this.waypoints[0]];
    this.heading = this.legs[0]?.brg ?? 0;
    this.speedKn = 0;
    this.simSeconds = 0;
    this.trail = [[...this.position]];
    this.insideGround = null;
    this.status = "idle";
    this.emit();
  }

  get totalLengthNm() { return this.legs.reduce((s, l) => s + l.len, 0) / NM; }

  setMultiplier(x) { this.multiplier = Math.max(1, Number(x) || 300); }

  start() {
    if (!this.route) return;
    if (this.status === "done") this.resetState();
    this.status = "underway";
    this.lastTs = null;
    this.loop();
  }

  pause() {
    if (this.status === "underway" || this.status === "fishing") {
      this.prevStatus = this.status;
      this.status = "paused";
      this.stopLoop();
      this.emit();
    }
  }

  resume() {
    if (this.status !== "paused") return;
    this.status = this.prevStatus || "underway";
    this.lastTs = null;
    this.loop();
  }

  reset() { this.stopLoop(); if (this.route) this.resetState(); }

  stopLoop() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = null; }

  get running() { return this.status === "underway" || this.status === "fishing"; }

  loop() {
    this.stopLoop();
    const frame = (ts) => {
      if (!this.running) return;
      if (this.lastTs == null) this.lastTs = ts;
      const dtReal = Math.min(0.25, (ts - this.lastTs) / 1000); // clamp after tab sleeps
      this.lastTs = ts;
      this.step(dtReal);
      if (this.running) this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  step(dtReal) {
    const dt = dtReal * this.multiplier; // simulated seconds
    this.simSeconds += dt;

    // Speed: slow down inside fishing grounds, accelerate gently (~2 kn per simulated minute).
    const target = this.insideGround ? this.fishingKn : this.transitKn;
    const maxDelta = (2 / 60) * dt;
    this.speedKn += Math.max(-maxDelta, Math.min(maxDelta, target - this.speedKn));

    let remaining = this.speedKn * KN_TO_MS * dt;
    while (remaining > 0 && this.leg < this.legs.length) {
      const leg = this.legs[this.leg];
      const left = leg.len - this.legPos;
      if (remaining < left) { this.legPos += remaining; remaining = 0; }
      else { remaining -= left; this.leg += 1; this.legPos = 0; }
    }

    if (this.leg >= this.legs.length) {
      this.position = [...this.waypoints[this.waypoints.length - 1]];
      this.speedKn = 0;
      this.status = "done";
      this.trail.push([...this.position]);
      this.checkGrounds();
      this.emit();
      this.h.onComplete && this.h.onComplete(this.snapshot());
      return;
    }

    const leg = this.legs[this.leg];
    this.position = interpolate(leg.a, leg.b, leg.len ? this.legPos / leg.len : 0);
    // Rotate the bow smoothly towards the leg bearing (max 120 deg per real second).
    this.heading = turnToward(this.heading, bearingDeg(this.position, leg.b), 120 * dtReal);

    const last = this.trail[this.trail.length - 1];
    if (haversineM(last, this.position) > 0.1 * NM) this.trail.push([...this.position]);

    this.checkGrounds();
    this.status = this.insideGround ? "fishing" : "underway";
    this.emit();
  }

  checkGrounds() {
    let inside = null;
    for (const g of this.grounds) {
      if (haversineM(this.position, [g.lat, g.lon]) <= g.radius_nm * NM) { inside = g; break; }
    }
    if (inside?.id !== this.insideGround?.id) {
      if (this.insideGround && this.h.onGroundExit) this.h.onGroundExit(this.insideGround, this.snapshot());
      this.insideGround = inside;
      if (inside && this.h.onGroundEnter) this.h.onGroundEnter(inside, this.snapshot());
    }
  }

  snapshot() {
    return {
      lat: this.position[0], lon: this.position[1], heading: this.heading, speedKn: this.speedKn,
      status: this.status, simSeconds: this.simSeconds, trail: this.trail,
      ground: this.insideGround, routeId: this.route?.id, source: "sim",
    };
  }

  emit() { this.h.onUpdate && this.h.onUpdate(this.snapshot()); }
}

/** Real device GPS through the browser Geolocation API (needs HTTPS or localhost). */
export class GpsTracker {
  constructor({ onPosition, onError }) { this.onPosition = onPosition; this.onError = onError; this.watchId = null; this.trail = []; }

  static supported() { return "geolocation" in navigator; }

  start() {
    if (!GpsTracker.supported()) { this.onError({ code: "unsupported" }); return; }
    this.trail = [];
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lon, accuracy, speed, heading } = pos.coords;
        const p = [lat, lon];
        const last = this.trail[this.trail.length - 1];
        if (!last || haversineM(last, p) > 20) this.trail.push(p);
        this.onPosition({
          lat, lon, accuracy,
          speedKn: Number.isFinite(speed) && speed !== null ? speed / KN_TO_MS : null,
          heading: Number.isFinite(heading) && heading !== null ? heading : null,
          status: "gps", trail: this.trail, source: "gps", time: pos.timestamp,
        });
      },
      (err) => this.onError(err),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 },
    );
  }

  stop() {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
  }
}
