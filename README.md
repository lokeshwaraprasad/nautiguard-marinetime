# NautiGuard

**Know Your Waters. Return Home Safely.**

NautiGuard is a marine boundary-awareness and fishing-trip safety demonstration for fishermen operating from Rameswaram, Tamil Nadu. It shows an animated fishing boat on a live map, measures its distance to the India–Sri Lanka maritime boundary using treaty coordinates, raises Tamil/English warnings as the boat gets closer, records fishing sessions and includes a Gemini-powered assistant.

> **Not for navigation.** NautiGuard is a college/hackathon demonstration. The warning thresholds are NautiGuard's own demo values, not official government warning levels, and the alerts are not Coast Guard warnings. Fishermen must use official charts, approved equipment and guidance from the Indian Coast Guard and the Tamil Nadu Fisheries Department. Emergency: Indian Coast Guard **1554**, VHF channel **16**.

---

## Contents
1. [Architecture](#1-architecture)
2. [Maritime boundary data (read this)](#2-maritime-boundary-data)
3. [Project structure](#3-project-structure)
4. [Run locally on Windows](#4-run-locally-on-windows)
5. [Environment variables, keys and costs](#5-environment-variables-keys-and-costs)
6. [Tests](#6-tests)
7. [Deploy to Vercel](#7-deploy-to-vercel)
8. [Verify the deployed site](#8-verify-the-deployed-site)
9. [Troubleshooting](#9-troubleshooting)
10. [API reference](#10-api-reference)
11. [How the main features work](#11-how-the-main-features-work)
12. [Limitations](#12-limitations)

---

## 1. Architecture

```
 Browser (HTML/CSS/vanilla JS modules)                    Flask backend (Python, stateless)
 ┌────────────────────────────────────────┐   JSON/HTTPS   ┌──────────────────────────────────────┐
 │ map.js        Leaflet or Google Maps   │ ─────────────▶ │ app.py            REST endpoints     │
 │ simulation.js boat movement / GPS      │  position      │ boundary_service  loads + validates  │
 │ alerts.js     banner, sound, log, SMS  │ ◀───────────── │ distance_service  WGS84 geodesics    │
 │ fishing-history.js  localStorage       │  distance,     │ alert_service     levels, dedup,     │
 │ assistant.js  chat UI                  │  level, alert  │                   Tamil/English, SMS │
 │ i18n.js       Tamil / English          │                │ gemini_service    Gemini (key here)  │
 └────────────────────────────────────────┘                └──────────────────────────────────────┘
                                                                 data/boundary.geojson (+ metadata)
```

* The **browser** animates the boat (smooth 60 fps) and, about every 0.7 s, posts the current position to `POST /api/calculate-distance`.
* The **server** calculates the exact distance on the WGS84 ellipsoid to the nearest point of the boundary, decides the warning level and whether a *new* alert is needed, and returns bilingual messages plus a simulated SMS preview.
* There is **no background loop** on the server. That makes it work on Vercel's serverless functions. It also means NautiGuard monitors a vessel only while the browser tab is open; it is not a continuous monitoring service.
* The **Gemini API key never reaches the browser**. The browser only calls `/api/ai/chat` on our own server.

## 2. Maritime boundary data

The boundary is **not** hand-drawn. It is built from the turning points printed in the two treaties:

| Sector | Treaty | Positions |
|---|---|---|
| Palk Strait (historic waters) | Agreement between Sri Lanka and India on the Boundary in Historic Waters…, signed 26/28 June 1974, in force 8 July 1974, **Art. 1** | Positions 1–6 |
| Gulf of Mannar | Agreement… on the Maritime Boundary… in the Gulf of Mannar and the Bay of Bengal…, signed 23 March 1976, in force 10 May 1976, **Art. 1** | Positions 1m–13m |
| Bay of Bengal | same 1976 Agreement, **Art. 2** | Positions 1b, 1ba, 1bb, 2b–6b |

Sources (UN Division for Ocean Affairs and the Law of the Sea):
* 1974: https://www.un.org/Depts/los/LEGISLATIONANDTREATIES/PDFFILES/TREATIES/LKA-IND1974BW.PDF
* 1976: https://www.un.org/Depts/los/LEGISLATIONANDTREATIES/PDFFILES/TREATIES/LKA-IND1976MB.PDF

How it is stored and used:
* `scripts/build_boundary.py` contains every position **exactly as printed** (degrees and decimal minutes) so it can be checked line by line against the PDFs. Running it writes `data/boundary.geojson` (three `LineString` features, longitude/latitude order).
* `data/boundary_metadata.json` records the sources, retrieval date (2026-10-13), coordinate system, verification status and transcription notes.
* The three sectors join into one line: 1976 Position 1b = 1974 Position 1, and 1974 Position 6 = 1976 Position 1m. A test checks this.
* The treaties join positions with "arcs of great circles". NautiGuard measures along WGS84 geodesics, which differ from that by only metres over these segment lengths.

**Verification status: `transcribed_from_treaty_text`.** Be clear about what this does and does not mean:
* ✅ The coordinates match the treaty texts published by the UN.
* ⚠️ The treaties **do not state a geodetic datum**. NautiGuard treats the values as WGS84. If the original charts used an older local datum, the true line can be offset from the drawn line by up to a few hundred metres.
* ⚠️ The coordinates were not checked against the signed charts annexed to the treaties or an official WGS84 conversion.
* Two printing quirks in the UN copy are documented in the metadata: Position 4m's longitude is printed with "N" (it is East), and Position 2b is printed "10° 33' 0 N".

If `boundary_metadata.json` is missing, the app automatically labels the line **ILLUSTRATIVE** and says alerts are not verified.

**A boundary is not a fishing rule.** Being near the line does not by itself make fishing unlawful, and being far from it does not make fishing lawful. The app never says otherwise.

**Geography note:** Rameswaram town is only about **12 NM** from the treaty line, so the whole of Palk Bay is inside the 50 NM band. A boat leaving Rameswaram therefore starts in **CAUTION**. To show every level from SAFE to CRITICAL, use the demo route **"Full-range demo: Gulf of Mannar (south of Thoothukudi)"**, which starts about 60 NM from the line.

The 50/25/10/5 NM zones drawn on the map are pre-computed by `scripts/build_advisory_zones.py` (pure Python). A test re-measures their vertices to prove they lie at the stated distance (±0.02 NM). The zones are pure distance bands: they include land and are not legal buffers.

## 3. Project structure

```
nautiguard/
├── app.py                     Flask app + REST API (Vercel finds `app` here)
├── requirements.txt           Runtime deps: Flask, google-genai, python-dotenv
├── requirements-dev.txt       + pytest, for running tests locally
├── .python-version            Python 3.12 (used by Vercel)
├── .env.example               Copy to .env for local secrets
├── .gitignore
├── pytest.ini
├── README.md
├── data/
│   ├── boundary.geojson       Treaty boundary (generated from scripts/build_boundary.py)
│   ├── boundary_metadata.json Sources, datum, verification status, notes
│   ├── advisory_zones.geojson 50/25/10/5 NM zones (generated)
│   └── demo_routes.json       Demo routes, home port, demo fishing grounds
├── scripts/
│   ├── build_boundary.py      Treaty positions → GeoJSON
│   └── build_advisory_zones.py  Geodesic distance bands around the boundary
├── services/
│   ├── boundary_service.py    Load/validate boundary + metadata
│   ├── distance_service.py    Vincenty geodesics, point-to-boundary distance, NM conversion
│   ├── alert_service.py       Levels, hysteresis, de-duplication, Tamil/English text, SMS module
│   └── gemini_service.py      Gemini assistant (server-side key, validation, guardrails)
├── templates/
│   └── index.html             The single-page dashboard
├── public/                    Static files (served by Vercel's CDN)
│   ├── css/styles.css
│   ├── js/app.js              Main controller
│   ├── js/map.js              Google Maps + Leaflet adapters
│   ├── js/simulation.js       Boat simulation + device GPS
│   ├── js/alerts.js           Banner, sound, notifications, alert log, SMS preview
│   ├── js/fishing-history.js  Fishing sessions (localStorage)
│   ├── js/assistant.js        AI chat panel
│   ├── js/i18n.js             Tamil / English text
│   ├── js/api.js              Fetch helper
│   └── assets/boat.svg, logo.svg
└── tests/                     59 automated tests
```

Differences from the suggested structure, and why:
* **`vercel.json` is not included.** Vercel now detects a Flask app named `app` in `app.py` automatically, and serves `public/**` from its CDN. No configuration file is needed. (See Troubleshooting if you ever need one.)
* **Extra JS files** (`i18n.js`, `api.js`, `assistant.js`) keep each job small and easy to explain.
* **`scripts/`** holds the tools that generate the data files, so the boundary can be regenerated and audited.
* **No Shapely/pyproj.** The geodesic maths is written in plain Python (Vincenty's formulae, tested against published reference values). This keeps the Vercel bundle small and avoids compiled dependencies on Windows.

## 4. Run locally on Windows

You need **Python 3.12 or newer** (https://www.python.org/downloads/ — tick "Add python.exe to PATH" during install) and optionally **Git** (https://git-scm.com/download/win).

Open **PowerShell** and run:

```powershell
cd C:\Users\DELL\Desktop\nautiguard

# 1. Create and activate a virtual environment
python -m venv .venv
.venv\Scripts\Activate.ps1
#   If PowerShell says "running scripts is disabled", run this once and retry:
#   Set-ExecutionPolicy -Scope CurrentUser RemoteSigned

# 2. Install dependencies
pip install -r requirements.txt

# 3. Create your local settings file and add your Gemini key
copy .env.example .env
notepad .env

# 4. Start the app
python app.py
```

Open **http://127.0.0.1:5000** in Chrome or Edge.

Command Prompt (cmd.exe) users: activate with `.venv\Scripts\activate.bat` instead.

Without any keys the app still works: the map uses free OpenStreetMap/CARTO tiles, and the AI tab shows "not configured".

### Quick demo script (for faculty / interviews)
1. Route → **Full-range demo: Gulf of Mannar**, speed **600×**, press **Start**.
2. Watch the banner go SAFE → EARLY WARNING → CAUTION → HIGH ALERT → CRITICAL, then back as the boat turns away. One alert per level change; nothing repeats every tick.
3. The boat slows to 3 kn inside the demo fishing ground; a fishing session is recorded automatically.
4. Press **தமிழ்** to switch all text and alerts to Tamil.
5. Open **Safety Alerts** to show the log and the simulated SMS preview; press **Send test alert**.
6. Open **Fishing History** → **Replay route**.
7. Hover a red dot on the boundary to show the treaty position and its printed coordinates.

## 5. Environment variables, keys and costs

| Variable | Required | Where it is used | Notes |
|---|---|---|---|
| `GEMINI_API_KEY` | For the AI tab | Server only | Get one at https://aistudio.google.com/apikey |
| `GEMINI_MODEL` | No | Server | Defaults to `gemini-3.5-flash-lite`. Google retires models over time; if you see "model not found", set this to a current model listed at https://ai.google.dev/gemini-api/docs/models |
| `GOOGLE_MAPS_API_KEY` | No | **Sent to the browser** | Only needed for Google Maps. Without it the free Leaflet map is used. |
| `MAP_PROVIDER` | No | Server | `auto` (default), `google` or `leaflet` |
| `NAUTIGUARD_THRESHOLDS_NM` | No | Server | e.g. `50,25,10,5`. Invalid values fall back to the defaults. The map draws only the zones that match pre-computed radii. |
| `SMS_PROVIDER` | No | Server | Only `none` (simulated) is implemented |

**Keeping secrets safe**
* `.env` is in `.gitignore`. Check `git status` never lists `.env` before you push.
* The Gemini key is read only by `services/gemini_service.py`. It is never placed in HTML, JavaScript, browser storage or API responses (a test checks `/api/config` does not leak it).
* A **Google Maps browser key is visible to anyone** who opens the page; that is how Google Maps works. Protect it in Google Cloud Console → APIs & Services → Credentials:
  * *API restrictions:* **Maps JavaScript API** only.
  * *Application restrictions:* **Websites**, e.g. `http://127.0.0.1:5000/*`, `http://localhost:5000/*`, `https://YOUR-PROJECT.vercel.app/*`.

**Costs and quotas (no guarantees)**
* **Gemini:** Google offers a free tier with rate limits that change over time; heavy use or some models may need billing. Free-tier prompts may be used by Google to improve its products, so do not send personal data.
* **Google Maps:** requires a Google Cloud project **with billing enabled**, even though Google provides monthly free usage. Set budget alerts. If you do not want billing, leave the key empty and use Leaflet.
* **Map tiles (Leaflet mode):** CARTO basemaps and the OpenStreetMap tile server are free for light, non-commercial use and require the attribution shown on the map. They are not for heavy traffic; see https://operations.osmfoundation.org/policies/tiles/ and CARTO's terms.
* **Vercel Hobby:** free for personal, non-commercial projects, with usage limits.

## 6. Tests

```powershell
pip install -r requirements-dev.txt
python -m pytest -v
```
(Without pytest: `python -m unittest discover -s tests -v`.)

What is covered (59 tests):
* **Conversions:** 1 NM = 1,852 m, round trips, 50 NM = 92.6 km.
* **Geodesy:** Vincenty inverse and direct against the published Flinders Peak → Buninyong example (54,972.271 m), 1° along the equator, round trips.
* **Boundary distance:** zero on treaty positions and mid-segment; points placed exactly 1, 5 and 10 NM at right angles from a segment measure back to within 0.005 NM; beyond-endpoint behaviour; Rameswaram ≈ 12 NM; demo route covers SAFE→CRITICAL; zone polygons lie at their radius.
* **Warning levels:** "at or below" thresholds, immediate escalation, hysteresis on the way down, custom/invalid threshold settings.
* **De-duplication:** no repeats while the level is unchanged, one alert per new level, exit-and-re-enter alerts again, no spam from GPS jitter at a threshold.
* **Invalid input:** bad coordinates (out of range, text, NaN, booleans), missing/invalid/malformed boundary files, missing metadata → "illustrative".
* **Gemini:** missing key → HTTP 503, message validation and length limit, history trimming, fake client round trip, quota error → 429.
* **API:** response structure for every endpoint, JSON 404s, key not leaked in `/api/config`.

### Manual testing checklist
| Area | Check |
|---|---|
| Boat movement | Start/Pause/Resume/Reset work; boat icon turns to its heading; speed shows 8 kn in transit and 3 kn in fishing grounds; trail grows; boat stays at sea on all three routes; "SIMULATED GPS" label is visible. |
| Boundary overlay | Red treaty line from the Bay of Bengal through the Palk Strait to the Gulf of Mannar; hover the red dots to see each treaty position; 50 NM shaded zone and 25/10/5 NM dashed rings; legend shows the source and the "not for navigation" note. |
| Distance | Dotted line from the boat to the nearest boundary point, with a NM label; sidebar distance and the bottom-right measure box agree. |
| Alert messages | Full-range route produces each level once; banner colour and text change; toast appears; sound plays after "Enable sound"; a browser notification appears after "Enable notifications" (switch to another tab to see it). |
| Tamil toggle | Navigation, panels, banner, alert log and SMS preview switch to Tamil and back. Ask a Tamil speaker to review the wording. |
| Fishing history | Entering a demo ground creates a session; "Mark fishing spot" saves notes and kg; sessions appear as purple circles; Replay animates the route; Clear history asks for confirmation. |
| Gemini assistant | Without a key: clear "not configured" message. With a key: suggestion chips answer; it refuses to give legal verdicts and does not invent coordinates. |
| Mobile | At phone width (Chrome DevTools, 390 px) the map comes first, panels collapse, there is no sideways scrolling. |
| Device GPS | On HTTPS (Vercel) or localhost, "Device GPS" asks for permission, shows accuracy and the "DEVICE GPS" label. |
| Deployment | `/api/health` returns `"ok": true` and 24 boundary segments on the live URL. |

## 7. Deploy to Vercel

I could not deploy this for you (no GitHub/Vercel access from here), so there is no live URL yet. Follow these steps to get your own.

### 7.1 Push the code to GitHub
1. Create an empty repository at https://github.com/new (e.g. `nautiguard`, no README).
2. In PowerShell:
   ```powershell
   cd C:\Users\DELL\Desktop\nautiguard
   git init
   git add .
   git status          # make sure .env and .venv are NOT listed
   git commit -m "NautiGuard first version"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/nautiguard.git
   git push -u origin main
   ```

### 7.2 Import into Vercel
1. Sign in at https://vercel.com with GitHub (Hobby plan).
2. **Add New… → Project → Import** your `nautiguard` repository.
3. Framework preset: Vercel should detect **Flask**. Leave Build and Output settings empty. Root directory: the repository root.
4. Open **Environment Variables** and add:
   * `GEMINI_API_KEY` = your key
   * optional: `GEMINI_MODEL`, `GOOGLE_MAPS_API_KEY`, `MAP_PROVIDER`
5. Click **Deploy**. When it finishes, Vercel shows your URL, e.g. `https://nautiguard-xxxx.vercel.app`.
6. If you use Google Maps, add that URL to the key's allowed websites (`https://nautiguard-xxxx.vercel.app/*`).

You can also deploy from the command line: `npm i -g vercel`, then `vercel` (preview) and `vercel --prod`.

### 7.3 Redeploy after changes
* Code changes: `git add . && git commit -m "describe change" && git push` → Vercel redeploys automatically.
* Environment-variable changes: Vercel → Project → Settings → Environment Variables → edit, then **Deployments → ⋯ → Redeploy** (variables only apply to new deployments).

## 8. Verify the deployed site

Replace `YOUR-URL` with your Vercel URL.

1. `https://YOUR-URL/api/health` → `"ok": true`, `"segments": 24`, `"verification_status": "transcribed_from_treaty_text"`, and `"ai": {"configured": true}` if you set the key.
2. `https://YOUR-URL/api/boundary` → a FeatureCollection with 3 features and 4 advisory zones.
3. In PowerShell:
   ```powershell
   Invoke-RestMethod -Method Post -Uri https://YOUR-URL/api/calculate-distance -ContentType "application/json" -Body '{"lat":9.5,"lon":79.2}'
   ```
   Expect about **13.6 NM** and `level = CAUTION`.
4. Open the home page: map loads, boundary visible, run the full-range demo route.
5. AI tab: ask "What does CAUTION mean?" and confirm a reply appears.
6. On your phone: open the URL, try the Tamil toggle and Device GPS (needs HTTPS, which Vercel provides).

## 9. Troubleshooting

| Problem | Fix |
|---|---|
| `python` not found on Windows | Reinstall Python with "Add to PATH", or use `py -3.12` instead of `python`. |
| `Activate.ps1 cannot be loaded` | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| Port 5000 busy | `$env:PORT=5050; python app.py` then open http://127.0.0.1:5050 |
| Map is blank | Check internet access to unpkg.com and the tile servers; open DevTools → Console. Distances and alerts still work without the map. |
| "Google Maps rejected the API key" | Billing not enabled, Maps JavaScript API not enabled, or the site URL is not in the key's allowed websites. The app switches to Leaflet automatically. |
| AI tab says not configured | `GEMINI_API_KEY` missing. Locally: edit `.env` and restart. On Vercel: add the variable, then redeploy. |
| AI says model not found | Set `GEMINI_MODEL` to a current model from Google's model list. |
| AI says quota reached (429) | Free-tier rate limit; wait and retry, or enable billing. |
| Vercel build fails installing packages | Check the build log; make sure `requirements.txt` is at the repo root and `.python-version` says `3.12`. |
| Vercel: 404 on `/css/...` or `/js/...` | Static files must stay in `public/`. |
| Vercel: "Boundary data unavailable" | The `data/` folder must be committed. If Vercel ever leaves it out of the function bundle, add a `vercel.json` with `{"functions": {"app.py": {"includeFiles": "data/**"}}}` and redeploy. |
| Device GPS does nothing | GPS needs HTTPS (or localhost) and location permission. Desktop browsers often estimate location from Wi-Fi, which can be kilometres off. |
| Notifications do not appear | Allow notifications for the site; some phone browsers only show them for installed web apps. |
| Old version still showing | Hard refresh with Ctrl + F5. |

## 10. API reference

All responses are JSON with `"ok": true/false`. Errors use proper status codes (400 invalid input, 404 unknown, 413 too large, 429 AI quota, 503 not configured or data missing).

| Method & path | Purpose |
|---|---|
| `GET /api/health` | Service, boundary and AI status |
| `GET /api/config` | Public settings for the browser (thresholds, labels, map provider, Maps browser key) |
| `GET /api/boundary` | Boundary GeoJSON, metadata, advisory zones |
| `POST /api/calculate-distance` | Body `{lat, lon, previous_level?, vessel_id?, simulated?}` → distance (NM and m), nearest point, bearing, segment, level, bilingual message, and `alert` (only when the level changed) |
| `GET /api/vessel/status?lat=&lon=` | Same calculation without logging an alert. The server keeps no vessel state, so coordinates are required. |
| `GET /api/simulation/routes` | Demo routes, fishing grounds, speeds |
| `POST /api/simulation/start` | Body `{route_id}` → route data. The browser runs the animation. |
| `POST /api/simulation/pause` / `resume` / `reset` | Acknowledge state changes (stateless) |
| `GET /api/alerts` | In-memory alert log of this server instance |
| `POST /api/alerts/test` | Body `{lat?, lon?}` → test alert with simulated SMS preview |
| `GET /api/fishing-history` / `POST /api/fishing-history` | In-memory demo store with validation (browser localStorage is primary) |
| `POST /api/ai/chat` | Body `{message (≤1000 chars), history?, context?}` → `{reply, model}` |

## 11. How the main features work

* **Distance:** for each boundary segment, the server walks along the WGS84 geodesic between the two treaty positions and finds the closest point to the boat using a golden-section search. Vincenty's formulae give distances accurate to well under a millimetre. A quick flat-earth estimate first picks the few segments worth checking exactly.
* **Warning levels:** SAFE > 50 NM, EARLY WARNING ≤ 50, CAUTION ≤ 25, HIGH ALERT ≤ 10, CRITICAL ≤ 5. Escalation is immediate; to drop back down, the boat must be 0.2 NM past the threshold (hysteresis), so GPS jitter cannot cause flickering alerts.
* **De-duplication:** the browser sends the previous level with each position. The server raises an alert only when the level changes (entering a higher or lower warning level, or returning to SAFE). Leaving and re-entering a zone alerts again.
* **SMS:** `alert_service.get_sms_provider()` always returns the simulated provider, which reports `SIMULATED_NOT_SENT`. A real provider (e.g. an Indian DLT-registered SMS gateway) can be added there, reading credentials from server-side environment variables, and must report "sent" only after the provider confirms delivery.
* **Fishing history:** saved in `localStorage` through a small `store` object in `fishing-history.js`; swapping it for API calls to a database is a contained change. Durations in demo mode are in *simulated* time and are labelled as such.
* **AI assistant:** the browser sends a short text summary of what the dashboard shows (marked as simulated). The system instruction forbids inventing coordinates, claiming live data, giving legality verdicts or presenting alerts as official.

## 12. Limitations

* **Not a navigation or enforcement tool.** Demo thresholds; not official warnings; not legal advice.
* **Boundary accuracy:** transcribed from treaty text; datum not stated in the treaties (possible offset of up to a few hundred metres); not checked against the annexed charts.
* **Monitoring stops when the tab closes.** Serverless functions cannot run a continuous background loop, and a phone may pause a background tab.
* **Server-side logs are not durable.** `/api/alerts` and `/api/fishing-history` live in one function instance's memory and disappear when Vercel recycles it. Alert and fishing history are kept in each browser's `localStorage` (one device, can be cleared).
* **Browser GPS** is not marine-grade and may come from Wi-Fi or cell towers.
* **No real SMS** is sent.
* **Demo fishing grounds are illustrative** circles, not survey data; recorded fishing never implies an area is safe or lawful.
* **Tamil text** was written for simplicity; please have it reviewed by a native Tamil speaker from the fishing community before any real use.
* **Gemini** answers can be wrong; the model id may need updating as Google retires models; free-tier limits apply.
* **Testing scope:** automated tests cover the Python side. The browser UI was exercised end to end in headless Chromium, but external map tiles and the live Gemini API could not be reached from the build environment, so check the map rendering and the AI replies yourself after deployment.
