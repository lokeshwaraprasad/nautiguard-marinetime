// Map layer for NautiGuard.
//
// Two interchangeable "adapters" expose the same methods:
//   GoogleMapAdapter  - used when GOOGLE_MAPS_API_KEY is configured
//   LeafletMapAdapter - free fallback using OpenStreetMap / CARTO tiles
// app.js only talks to the common interface, so either map can be used.

const COLORS = {
  boundary: "#ff3b5c",
  zone50: "#facc15",
  ring: { 25: "#f59e0b", 10: "#f97316", 5: "#ef4444" },
  trail: "#2dd4bf",
  fished: "#a78bfa",
  ground: "#38bdf8",
  measure: "#e2e8f0",
  playback: "#c084fc",
};
const METRES_PER_NM = 1852;
const REGION_BOUNDS = [[7.4, 77.6], [10.6, 80.6]]; // Gulf of Mannar - Palk Strait - Rameswaram
const DEFAULT_CENTER = [9.35, 79.3];

function boatHtml(source) {
  const label = source === "gps" ? "DEVICE GPS" : "SIMULATED GPS";
  return `<div class="boat-marker ${source === "gps" ? "gps" : ""}">
    <div class="boat-rot"><img src="/assets/boat.svg" alt=""></div>
    <span class="boat-label">${label}</span></div>`;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src; s.async = true; s.crossOrigin = "anonymous";
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(s);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// =====================================================================
// Leaflet adapter
// =====================================================================
export class LeafletMapAdapter {
  constructor() { this.provider = "leaflet"; }

  async init(el) {
    if (!window.L) await loadScript("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js");
    const L = window.L;
    this.L = L;
    this.map = L.map(el, { zoomControl: true, attributionControl: true, minZoom: 5, maxZoom: 15 })
      .setView(DEFAULT_CENTER, 9);

    // Free tile layers. Respect each provider's usage policy (see README).
    const voyager = L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: "abcd", maxZoom: 19,
    });
    const dark = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: "abcd", maxZoom: 19,
    });
    const osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    });
    voyager.addTo(this.map);

    this.layers = {
      zones: L.layerGroup().addTo(this.map),
      grounds: L.layerGroup().addTo(this.map),
      fished: L.layerGroup().addTo(this.map),
      boundary: L.layerGroup().addTo(this.map),
      trail: L.layerGroup().addTo(this.map),
      measure: L.layerGroup().addTo(this.map),
      playback: L.layerGroup().addTo(this.map),
      boat: L.layerGroup().addTo(this.map),
    };
    L.control.layers(
      { "Ocean (CARTO Voyager)": voyager, "Night (CARTO Dark)": dark, "OpenStreetMap": osm },
      {
        "Treaty boundary": this.layers.boundary,
        "Advisory zones": this.layers.zones,
        "Fishing grounds (demo)": this.layers.grounds,
        "Recently fished": this.layers.fished,
        "Route trail": this.layers.trail,
      },
      { position: "topleft", collapsed: true },
    ).addTo(this.map);
    L.control.scale({ position: "bottomright", metric: true, imperial: false, maxWidth: 140 }).addTo(this.map);
    return this;
  }

  setBoundary(fc) {
    const L = this.L;
    this.layers.boundary.clearLayers();
    for (const f of fc.features) {
      const latlngs = f.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
      L.polyline(latlngs, { color: "#0a1324", weight: 7, opacity: 0.55, interactive: false }).addTo(this.layers.boundary);
      L.polyline(latlngs, { color: COLORS.boundary, weight: 3.5, opacity: 1 })
        .bindTooltip(escapeHtml(f.properties.name), { sticky: true, className: "ng-tip" })
        .addTo(this.layers.boundary);
      for (const p of f.properties.points || []) {
        L.circleMarker([p.lat, p.lon], { radius: 3.5, color: "#fff", weight: 1.5, fillColor: COLORS.boundary, fillOpacity: 1 })
          .bindTooltip(`${escapeHtml(p.label)}<br>${escapeHtml(p.as_printed)}`, { className: "ng-tip" })
          .addTo(this.layers.boundary);
      }
    }
  }

  setZones(fc) {
    const L = this.L;
    this.layers.zones.clearLayers();
    const feats = [...(fc?.features || [])].sort((a, b) => b.properties.radius_nm - a.properties.radius_nm);
    feats.forEach((f, i) => {
      const r = f.properties.radius_nm;
      const ring = f.geometry.coordinates[0].map(([lon, lat]) => [lat, lon]);
      if (i === 0) {
        L.polygon(ring, { color: COLORS.zone50, weight: 1.5, fillColor: COLORS.zone50, fillOpacity: 0.07, interactive: false })
          .addTo(this.layers.zones);
      } else {
        L.polyline(ring, { color: COLORS.ring[r] || "#f59e0b", weight: 1.6, dashArray: "6 6", opacity: 0.9, interactive: false })
          .addTo(this.layers.zones);
      }
    });
  }

  setHomePort(port) {
    if (!port) return;
    const L = this.L;
    L.marker([port.lat, port.lon], {
      icon: L.divIcon({ className: "ng-icon", html: '<div class="port-dot"></div>', iconSize: [12, 12], iconAnchor: [6, 6] }),
      keyboard: false,
    }).bindTooltip(escapeHtml(port.name), { className: "ng-tip", direction: "right", offset: [8, 0] })
      .addTo(this.layers.grounds);
  }

  setGrounds(grounds) {
    const L = this.L;
    this.layers.grounds.eachLayer((l) => { if (l.options && l.options.ngGround) this.layers.grounds.removeLayer(l); });
    for (const g of grounds) {
      L.circle([g.lat, g.lon], {
        radius: g.radius_nm * METRES_PER_NM, color: COLORS.ground, weight: 1.5, dashArray: "4 5",
        fillColor: COLORS.ground, fillOpacity: 0.08, ngGround: true,
      }).bindTooltip(escapeHtml(g.name), { className: "ng-tip" }).addTo(this.layers.grounds);
    }
  }

  updateBoat({ lat, lon, heading, source }) {
    const L = this.L;
    if (!this.boat || this.boatSource !== source) {
      this.layers.boat.clearLayers();
      this.boat = L.marker([lat, lon], {
        icon: L.divIcon({ className: "ng-icon", html: boatHtml(source), iconSize: [44, 44], iconAnchor: [22, 22] }),
        interactive: false, keyboard: false, zIndexOffset: 1000,
      }).addTo(this.layers.boat);
      this.boatSource = source;
    } else {
      this.boat.setLatLng([lat, lon]);
    }
    const rot = this.boat.getElement()?.querySelector(".boat-rot");
    if (rot && Number.isFinite(heading)) rot.style.transform = `rotate(${heading}deg)`;
  }

  clearBoat() { this.layers.boat.clearLayers(); this.boat = null; }

  setTrail(points) {
    const L = this.L;
    if (!this.trail) {
      this.trail = L.polyline([], { color: COLORS.trail, weight: 3, opacity: 0.85 }).addTo(this.layers.trail);
    }
    this.trail.setLatLngs(points);
  }

  setMeasurement(from, to, label) {
    const L = this.L;
    this.layers.measure.clearLayers();
    if (!from || !to) return;
    L.polyline([from, to], { color: COLORS.measure, weight: 2, dashArray: "2 6", opacity: 0.95, interactive: false })
      .addTo(this.layers.measure);
    L.circleMarker(to, { radius: 4, color: "#fff", weight: 2, fillColor: COLORS.boundary, fillOpacity: 1, interactive: false })
      .addTo(this.layers.measure);
    const mid = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
    L.marker(mid, {
      icon: L.divIcon({ className: "ng-icon", html: `<span class="map-label dark">${escapeHtml(label)}</span>`, iconSize: null }),
      interactive: false, keyboard: false,
    }).addTo(this.layers.measure);
  }

  setFishingSessions(sessions) {
    const L = this.L;
    this.layers.fished.clearLayers();
    for (const s of sessions) {
      const r = (s.radius_nm || 0.6) * METRES_PER_NM;
      L.circle([s.center.lat, s.center.lon], {
        radius: r, color: COLORS.fished, weight: 1.5, fillColor: COLORS.fished, fillOpacity: 0.22,
      }).bindTooltip(escapeHtml(s.label), { className: "ng-tip", permanent: false })
        .addTo(this.layers.fished);
    }
  }

  playRoute(points, durationMs = 6000) {
    const L = this.L;
    this.layers.playback.clearLayers();
    if (!points || points.length < 2) return;
    const line = L.polyline(points, { color: COLORS.playback, weight: 3, dashArray: "8 6" }).addTo(this.layers.playback);
    const dot = L.circleMarker(points[0], { radius: 7, color: "#fff", weight: 2, fillColor: COLORS.playback, fillOpacity: 1 })
      .addTo(this.layers.playback);
    this.map.fitBounds(line.getBounds(), { padding: [60, 60], maxZoom: 12 });
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / durationMs);
      const idx = k * (points.length - 1);
      const i = Math.floor(idx), f = idx - i;
      const a = points[i], b = points[Math.min(i + 1, points.length - 1)];
      dot.setLatLng([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  centerOn(lat, lon, zoom) { this.map.setView([lat, lon], zoom || Math.max(this.map.getZoom(), 10)); }
  fitRegion() { this.map.fitBounds(REGION_BOUNDS); }
  invalidate() { setTimeout(() => this.map.invalidateSize(), 60); }
  destroy() { this.map?.remove(); }
}

// =====================================================================
// Google Maps adapter
// =====================================================================
const GOOGLE_DARK_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#13213b" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#9fb0cc" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0a1324" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0d3b66" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#7dd3fc" }] },
  { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#1c2b45" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#2a3b5c" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "administrative.country", elementType: "geometry.stroke", stylers: [{ color: "#4b6596" }] },
];

export class GoogleMapAdapter {
  constructor(apiKey) { this.provider = "google"; this.apiKey = apiKey; this.items = {}; }

  async init(el, { onAuthFailure } = {}) {
    if (!window.google?.maps) {
      await new Promise((resolve, reject) => {
        window.__ngGoogleReady = resolve;
        window.gm_authFailure = () => { if (onAuthFailure) onAuthFailure(); };
        loadScript(`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(this.apiKey)}&v=weekly&callback=__ngGoogleReady`)
          .catch(reject);
      });
    }
    const g = window.google.maps;
    this.g = g;
    this.map = new g.Map(el, {
      center: { lat: DEFAULT_CENTER[0], lng: DEFAULT_CENTER[1] }, zoom: 9,
      styles: GOOGLE_DARK_STYLE, mapTypeControl: true, streetViewControl: false, fullscreenControl: false,
      mapTypeControlOptions: { mapTypeIds: ["roadmap", "hybrid"] }, gestureHandling: "greedy",
    });

    // Minimal HTML overlay (works without a Map ID)
    class HtmlOverlay extends g.OverlayView {
      constructor(position, html, anchor = [0.5, 0.5]) {
        super(); this.position = position; this.anchor = anchor;
        this.div = document.createElement("div");
        this.div.style.position = "absolute"; this.div.innerHTML = html;
      }
      onAdd() { this.getPanes().overlayMouseTarget.appendChild(this.div); }
      draw() {
        const p = this.getProjection()?.fromLatLngToDivPixel(this.position);
        if (!p) return;
        this.div.style.left = `${p.x - this.div.offsetWidth * this.anchor[0]}px`;
        this.div.style.top = `${p.y - this.div.offsetHeight * this.anchor[1]}px`;
      }
      onRemove() { this.div.remove(); }
      setPosition(pos) { this.position = pos; this.draw(); }
    }
    this.HtmlOverlay = HtmlOverlay;
    return this;
  }

  _clear(key) { (this.items[key] || []).forEach((o) => o.setMap(null)); this.items[key] = []; }
  _add(key, obj) { (this.items[key] ||= []).push(obj); return obj; }
  _ll(lat, lon) { return { lat, lng: lon }; }
  _dashed(color, weight = 2, gap = "10px") {
    return {
      strokeOpacity: 0,
      icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 1, strokeColor: color, strokeWeight: weight, scale: 2 }, offset: "0", repeat: gap }],
    };
  }

  setBoundary(fc) {
    const g = this.g;
    this._clear("boundary");
    for (const f of fc.features) {
      const path = f.geometry.coordinates.map(([lon, lat]) => this._ll(lat, lon));
      this._add("boundary", new g.Polyline({ map: this.map, path, strokeColor: "#0a1324", strokeWeight: 7, strokeOpacity: 0.5, clickable: false }));
      const line = this._add("boundary", new g.Polyline({ map: this.map, path, strokeColor: COLORS.boundary, strokeWeight: 3.5 }));
      const info = new g.InfoWindow({ content: escapeHtml(f.properties.name) });
      line.addListener("click", (e) => { info.setPosition(e.latLng); info.open({ map: this.map }); });
      for (const p of f.properties.points || []) {
        const m = this._add("boundary", new g.Marker({
          map: this.map, position: this._ll(p.lat, p.lon), title: `${p.label} — ${p.as_printed}`,
          icon: { path: g.SymbolPath.CIRCLE, scale: 4, fillColor: COLORS.boundary, fillOpacity: 1, strokeColor: "#fff", strokeWeight: 1.5 },
        }));
        m.addListener("click", () => { info.setContent(`${escapeHtml(p.label)}<br>${escapeHtml(p.as_printed)}`); info.open({ map: this.map, anchor: m }); });
      }
    }
  }

  setZones(fc) {
    const g = this.g;
    this._clear("zones");
    const feats = [...(fc?.features || [])].sort((a, b) => b.properties.radius_nm - a.properties.radius_nm);
    feats.forEach((f, i) => {
      const r = f.properties.radius_nm;
      const path = f.geometry.coordinates[0].map(([lon, lat]) => this._ll(lat, lon));
      if (i === 0) {
        this._add("zones", new g.Polygon({ map: this.map, paths: path, strokeColor: COLORS.zone50, strokeWeight: 1.5,
          fillColor: COLORS.zone50, fillOpacity: 0.07, clickable: false }));
      } else {
        this._add("zones", new g.Polyline({ map: this.map, path, clickable: false, ...this._dashed(COLORS.ring[r] || "#f59e0b", 1.5, "9px") }));
      }
    });
  }

  setHomePort(port) {
    if (!port) return;
    this._add("port", new this.g.Marker({
      map: this.map, position: this._ll(port.lat, port.lon), title: port.name,
      icon: { path: this.g.SymbolPath.CIRCLE, scale: 5, fillColor: "#fff", fillOpacity: 1, strokeColor: "#0ea5e9", strokeWeight: 3 },
    }));
  }

  setGrounds(grounds) {
    this._clear("grounds");
    for (const gr of grounds) {
      this._add("grounds", new this.g.Circle({
        map: this.map, center: this._ll(gr.lat, gr.lon), radius: gr.radius_nm * METRES_PER_NM,
        strokeColor: COLORS.ground, strokeWeight: 1.5, fillColor: COLORS.ground, fillOpacity: 0.08, clickable: false,
      }));
    }
  }

  updateBoat({ lat, lon, heading, source }) {
    const pos = new this.g.LatLng(lat, lon);
    if (!this.boat || this.boatSource !== source) {
      this.boat?.setMap(null);
      this.boat = new this.HtmlOverlay(pos, boatHtml(source), [0.5, 0.27]);
      this.boat.setMap(this.map);
      this.boatSource = source;
    } else {
      this.boat.setPosition(pos);
    }
    const rot = this.boat.div.querySelector(".boat-rot");
    if (rot && Number.isFinite(heading)) rot.style.transform = `rotate(${heading}deg)`;
  }

  clearBoat() { this.boat?.setMap(null); this.boat = null; }

  setTrail(points) {
    const path = points.map(([lat, lon]) => this._ll(lat, lon));
    if (!this.trail) {
      this.trail = new this.g.Polyline({ map: this.map, path, strokeColor: COLORS.trail, strokeWeight: 3, strokeOpacity: 0.85, clickable: false });
    } else this.trail.setPath(path);
  }

  setMeasurement(from, to, label) {
    this._clear("measure");
    if (!from || !to) return;
    this._add("measure", new this.g.Polyline({ map: this.map, path: [this._ll(...from), this._ll(...to)], clickable: false,
      ...this._dashed(COLORS.measure, 2, "8px") }));
    this._add("measure", new this.g.Marker({ map: this.map, position: this._ll(...to), clickable: false,
      icon: { path: this.g.SymbolPath.CIRCLE, scale: 4, fillColor: COLORS.boundary, fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2 } }));
    const mid = new this.g.LatLng((from[0] + to[0]) / 2, (from[1] + to[1]) / 2);
    const lbl = new this.HtmlOverlay(mid, `<span class="map-label dark">${escapeHtml(label)}</span>`);
    lbl.setMap(this.map);
    this._add("measure", lbl);
  }

  setFishingSessions(sessions) {
    this._clear("fished");
    for (const s of sessions) {
      const c = this._add("fished", new this.g.Circle({
        map: this.map, center: this._ll(s.center.lat, s.center.lon), radius: (s.radius_nm || 0.6) * METRES_PER_NM,
        strokeColor: COLORS.fished, strokeWeight: 1.5, fillColor: COLORS.fished, fillOpacity: 0.22,
      }));
      const info = new this.g.InfoWindow({ content: escapeHtml(s.label) });
      c.addListener("click", (e) => { info.setPosition(e.latLng); info.open({ map: this.map }); });
    }
  }

  playRoute(points, durationMs = 6000) {
    this._clear("playback");
    if (!points || points.length < 2) return;
    const path = points.map(([lat, lon]) => this._ll(lat, lon));
    this._add("playback", new this.g.Polyline({ map: this.map, path, clickable: false, ...this._dashed(COLORS.playback, 3, "12px") }));
    const dot = this._add("playback", new this.g.Marker({ map: this.map, position: path[0], clickable: false,
      icon: { path: this.g.SymbolPath.CIRCLE, scale: 7, fillColor: COLORS.playback, fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2 } }));
    const b = new this.g.LatLngBounds(); path.forEach((p) => b.extend(p));
    this.map.fitBounds(b, 60);
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / durationMs);
      const idx = k * (points.length - 1);
      const i = Math.floor(idx), f = idx - i;
      const a = points[i], c = points[Math.min(i + 1, points.length - 1)];
      dot.setPosition(this._ll(a[0] + (c[0] - a[0]) * f, a[1] + (c[1] - a[1]) * f));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  centerOn(lat, lon, zoom) { this.map.panTo(this._ll(lat, lon)); if (zoom || this.map.getZoom() < 10) this.map.setZoom(zoom || 10); }
  fitRegion() {
    const b = new this.g.LatLngBounds(this._ll(...REGION_BOUNDS[0]), this._ll(...REGION_BOUNDS[1]));
    this.map.fitBounds(b);
  }
  invalidate() { /* Google Maps resizes itself */ }
  destroy() { Object.keys(this.items).forEach((k) => this._clear(k)); this.boat?.setMap(null); this.trail?.setMap(null); }
}

/** Create the configured map, falling back to Leaflet if Google cannot load. */
export async function createMap(el, config, { onFallback } = {}) {
  if (config.map_provider === "google" && config.google_maps_api_key) {
    try {
      const gmap = new GoogleMapAdapter(config.google_maps_api_key);
      await gmap.init(el, { onAuthFailure: () => onFallback && onFallback("Google Maps rejected the API key. Switched to the free OpenStreetMap map.") });
      return gmap;
    } catch (e) {
      console.warn("[NautiGuard] Google Maps failed, using Leaflet:", e);
      onFallback && onFallback("Google Maps could not load. Using the free OpenStreetMap map instead.", true);
      el.innerHTML = "";
    }
  }
  return new LeafletMapAdapter().init(el);
}
