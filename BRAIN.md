# 🌊 OceanGuard AI — System Brain & Architecture Manual

> **Document Version:** 2.1.0 (source-verified)
> **Last Verified Against Source:** 2026-09-23
> **Repository:** `OceanGuard-main`
> **Status:** Local stack — Express + Vite + FastAPI/ONNX + Three.js. Operational data is seeded
> sample data; **no real ocean sensor, camera, or AUV feed is connected.**
> **Purpose:** Architectural blueprint and codebase reference for every subsystem, page, API
> contract, 3D pipeline, simulation engine, and ML workflow.
>
> **What changed in 2.1.0.** Version 2.0.0 contained several claims that do not match the source
> (PBKDF2 password hashing, `PublicPortal.tsx`/`SensorsFleet.tsx`, "16 pages", 8 scenarios,
> a 0.5–4.5 m wave slider, demo-login shortcuts, and benchmark numbers displayed on the landing
> page). Every claim below was re-read from the file that implements it. Where a fact could not be
> traced to source it is marked **⚠️ unverified**. This file is the single architecture reference.

---

## 1. Executive Overview & Core Philosophy

**OceanGuard AI** is a maritime environmental-intelligence application for detecting, tracking,
modelling, and coordinating the remediation of ocean debris and marine pollution. It combines
locally hosted edge inference (Espada), procedural 3D maritime visualisation (Three.js),
mission replay and simulation, geospatial analysis (Leaflet), and response logistics in one
operator interface.

What it is **not**: it is not wired to live sensors. `server.ts` polls nothing; the SSE
`DETECTION_TELEMETRY` broadcast re-sends seeded detections. The `LIVE` source mode reports
`UNAVAILABLE` with its reason rather than fabricating a feed. This is deliberate and documented
in `docs/MISSION_SIMULATION.md` §1.

```
+-------------------------------------------------------------------------------------+
|                                 OPERATOR BROWSER CLIENT                             |
|  React 19 + TS 5.8 + Vite 6 + Tailwind 4 + Three.js 0.185 + Leaflet 1.9 + Recharts 3 |
+-------------------------------------------------------------------------------------+
                                  |                        ^
                     HTTP / REST  |                        |  SSE  GET /api/events
                                  v                        |
+-------------------------------------------------------------------------------------+
|                       NODE.JS EXPRESS GATEWAY  (server.ts — port 3000)               |
|                       dev: `node --import tsx server.ts`  (Vite middleware)          |
|                                                                                      |
|  * Auth: HMAC-SHA256(password, per-user salt)   * Sessions: og_sess_* bearer token   |
|  * RBAC: 4 roles                                * JSON DB: data/oceanguard-db.json   |
|  * Simulation + replay router: /api/simulation  * Espada proxy: /api/ai/*            |
+-------------------------------------------------------------------------------------+
                                  |                        ^
               multipart image    |                        |  detections / models / stats
                                  v                        |
+-------------------------------------------------------------------------------------+
|                    ESPADA AI MICROSERVICE  (ai_service/app/main.py)                   |
|                    FastAPI + Uvicorn on 127.0.0.1:8000                               |
|                                                                                      |
|  * SSDLite320 MobileNetV3  * ONNX Runtime  * 1 class: "Mixed Waste"                   |
|  * SQLite WAL store: analyses · feedback · frame_reviews                              |
+-------------------------------------------------------------------------------------+
                                  |                        ^
                     committed frames |                        | promoted ONNX bundle
                                  v                        |
+-------------------------------------------------------------------------------------+
|              CONTINUAL LEARNING WORKER  (ai_service/training/continual_worker.py)     |
|  * PIL fail-closed validation  * PyTorch fine-tune  * 200-image holdout validation    |
|  * F1-gated promotion + atomic current.json pointer                                   |
+-------------------------------------------------------------------------------------+
```

### Core Engineering Principles

1. **Truth & provenance is non-negotiable.** No operational metric may be invented. Every value is
   either fetched from a connected source, tagged with `<DataProvenanceBadge />`
   (status union: `'LIVE' | 'SAMPLE' | 'USER PROVIDED' | 'UNAVAILABLE'` —
   `src/components/ui/DataProvenanceBadge.tsx:5`), or rendered as an honest null (`'—'`) with a
   reason. Failure never produces silent mock success.
2. **100% self-hosted intelligence.** No OpenAI / Gemini / Anthropic / cloud-vision tokens.
   `package.json` dependencies are React, Three.js, Leaflet, Recharts, Express, Lucide, `dotenv`,
   and their types.
3. **Autonomous inference, human-governed truth.** The model never trains on its own raw
   predictions. Only human-reviewed whole frames enter the learning store, and simulation frames
   are sent with `X-Espada-Skip-Learning: true` so they can never contaminate `learning.db`.
4. **Synthetic data is labelled as synthetic.** Row and event provenance strings
   (`synthetic_simulation`, `simulated_ground_truth`, `derived_estimate`, `SIMULATED`,
   `RECORDED`, `MODEL_OUTPUT`) are part of the contract, not decoration.
5. **Strict RBAC.** Four discrete roles: `ADMIN`, `FIELD_OPERATOR`, `ENVIRONMENTAL_OFFICER`,
   `CLEANUP_TEAM` (`server.ts:122`).
6. **Simulation isolation.** Runs and replays live in a separate in-memory/JSON registry and never
   enter the operational DB; an isolation test enforces this.

---

## 2. Technology Stack & Process Topology

| Subsystem | Technology | Notes (version read from `package.json`) |
|---|---|---|
| Frontend | React `^19.0.1` + `react-dom` | Lazy-loaded route components behind one `<Suspense>`. |
| Language | TypeScript `~5.8.2` | `tsconfig.json` targets `ES2022` — no `Array.prototype.findLast` etc. |
| Build / dev | Vite `^6.2.3` + `@vitejs/plugin-react` | Dev server + HMR; production SPA bundle. |
| Styling | Tailwind CSS v4 (`@tailwindcss/vite` `^4.1`) | Token layer in `src/index.css` (`--color-*` palette + `--ocean-*` aliases). |
| 3D graphics | Three.js `^0.185.1` | Custom GLSL displacement, procedural geometry and canvas textures. |
| GIS | Leaflet `^1.9.4` + `@types/leaflet` | Esri base layer + ocean-reference overlay, `L.circle` markers. |
| Charts | Recharts `^3.10.1` | Analytics/telemetry charts. |
| Icons | Lucide React `^0.546.0` | Accessible icon set. |
| Gateway | Node.js (ESM — `"type": "module"`) + Express `^4.21.2` | API, RBAC, SSE, Espada proxy, SPA hosting. No `engines` field constrains the Node major. |
| Server bundle | esbuild `^0.25.0` | `esbuild server.ts --bundle --platform=node --format=cjs --packages=external`. |
| Inference service | Python 3.10+ / FastAPI / Uvicorn | `ai_service/app/main.py`, `127.0.0.1:8000`. |
| Inference runtime | ONNX Runtime | SSDLite320 MobileNetV3 graph execution. |
| Training | PyTorch + TorchVision | Fine-tuning from `checkpoint.pt`. |
| Learning DB | SQLite 3 (WAL) | `ai_service/data/learning.db`; optimistic revision locking. |
| Supervisor | `scripts/dev.mjs` (Node ESM) | Probes Espada, starts Uvicorn + trainer, starts the gateway. |

**Package manager: pnpm.** `pnpm-lock.yaml` + `pnpm-workspace.yaml` are present and `README.md`
documents `pnpm install` / `pnpm run dev`. (Version 2.0.0 of this file said `npm run dev`.)

**npm scripts** (`package.json`): `dev` (`node scripts/dev.mjs`), `dev:web` (`tsx server.ts`),
`build` (`vite build` + esbuild), `start` (`node build/server.cjs`), `preview`, `clean`,
`lint` (**`tsc --noEmit` — a typecheck, not eslint**). There is **no `test` script**.

---

## 3. Page-by-Page Architectural Breakdown

The app has **16 page components and 22 routes** (4 of which are redirects). The legacy
`/demo-3d`, `/monitoring-demo`, and `/sonar-3d` routes redirect to `/monitoring`, the single
3D survey workspace.

```
                   +---------------------------------------------------------+
                   |                 OCEANGUARD NAVIGATION                    |
                   +---------------------------------------------------------+
                                                |
         +--------------------+-----------------+--------------------+--------------------+
         v                    v                                      v                    v
    [ OBSERVE ]          [ ANALYZE ]                            [ RESPOND ]           [ ADMIN ]
  00 Public Portal     05 Debris Detections                   09 Cleanup Missions   11 Admin Governance
  01 Command Center    06 Pollution Hotspots                  10 Reports & Export   12 System Settings
  02 3D Monitoring     07 Environmental AI
  03 Mission Replay    08 Espada AI & Data
  04 Sensors & Fleet
```

Not in the sidebar: `/login`, `/demo-3d` (standalone 3D showcase), and redirects
`/monitoring-demo`, `/sonar-3d` → `/demo-3d`, `/ai-models` → `/data`.

---

### Page 00: Public 3D Portal (`/portal` — `src/pages/Landing.tsx`)

* **Access:** public (unauthenticated). `RootRedirect` at `/` sends signed-in users to `/command`
  and everyone else to `/login`; **`/portal` is the only route that renders `Landing`.**
* **Purpose:** public transparency / institutional presentation.
* **Verified components:**
  * An interactive Three.js **`GlobeCanvas`** (`Landing.tsx:207`) showing **10 sample monitoring
    zones** (`HS-01` … `HS-10`: Gulf of Kachchh, Mumbai, Konkan, Goa, Mangaluru, Gulf of Mannar,
    Chennai, Odisha, Sundarbans, Lakshadweep) with lat/lng, risk band, risk score, estimated mass,
    survey radius, confidence %, and dominant class. Keyboard focusable with a full `aria-label`
    description; `prefers-reduced-motion` is honoured.
  * Stats strip and an aggregate metrics bar that render only from available data.
  * A **"Request Access" form** (`handleAuthRequest`) that posts to `POST /api/access-requests` —
    this is an evaluator access request, **not** a citizen incident-report submission.
* **Not present:** an "ocean health scorecard", a photo/GPS incident submission form, or demo-login
  shortcuts. Those were claimed in version 2.0.0 and do not exist.
* **Provenance:** no live public sensor feed exists, so public figures are sample/derived — not
  measurements.

---

### Page 01: Command Center (`/command` — `src/pages/CommandCenter.tsx`)

* **Access:** all authenticated roles.
* **Purpose:** operational overview of incidents, alerts, and subsystem health from
  `useSystem().summary` / `health` plus the SSE stream.
* **Verified content:** "Verified incident trajectory across coastal monitoring sectors"; active
  sector accumulation; an alerts card ("… anomalies awaiting response") with actions through
  `PATCH /api/alerts/:id/status` and `POST /api/alerts/:id/assign`; a "Latest verified items from
  sensor mesh" feed; and a "Mesh connectivity & inference nodes" grid.
* **Failure handling:** the connectivity row renders `Coastal telemetry connected` /
  `Telemetry temporarily unavailable` from `isOnline` (`CommandCenter.tsx:441`). There is **no**
  "Live Telemetry Stream Interrupted — Displaying Cached Snapshot" banner; the equivalent honest
  message for the event feed lives in the replay console
  ("Event feed interrupted. Last received observations remain visible.").
* **⚠️ Unverified:** any "trigger drone scan" shortcut.

---

### Page 02: 3D Ocean Monitoring (`/monitoring` — `src/pages/Monitoring.tsx` + `oceanScene.ts`)

* **Access:** all authenticated roles.
* **Purpose:** the 3D tactical twin **and** the simulation control surface.

**Verified scene facts (`oceanScene.ts`):**

```
+-------------------------------------------------------------------------------------------+
| THREE.JS SCENE — VERIFIED COMPONENTS                                                      |
|                                                                                           |
|  * waveHeight(x,z,t,strength)  — analytic sum of two sine terms, shared GPU (GLSL) + CPU   |
|  * terrainHeight(x,z)          — nominal seabed at -16 m (NOT -40 m to -120 m)             |
|  * weatheredTexture('deck'|'rust'|'sand') — canvas-synthesised maps, RepeatWrapping (36x  |
|    for sand)                                                                              |
|  * vessel() — procedural hull/deck/bridge/mast group; hull MeshStandardMaterial #183e48,   |
|    roughness 0.4, metalness 0.28                                                          |
|  * CONTACTS[8] — static sample contacts; seabed items anchored to terrainHeight()          |
+-------------------------------------------------------------------------------------------+
```

* **Observation modes:** `Surface` (Eye) · `Underwater` (Waves) · `Sonar` (Radar) — `Monitoring.tsx:56`.
* **Camera views:** `orbit` · `bridge` · `overhead` · `seabed` · `inspect`. Selecting a contact
  switches mode by depth (`> 0.5 m` → underwater) and moves the camera to `inspect`.
* **Wave slider:** label `WAVE INTENSITY`, `type="range"`, **`min="0.15"`, `max="2"`,
  `step="0.05"`**, default `1` (`Monitoring.tsx:1278`). Version 2.0.0's "0.5 m to 4.5 m" is wrong.
* **Simulation control bar** (`role="toolbar"`, shown only when `sourceMode === 'SIMULATION'`):
  scenario picker, `Pause`/`Resume`, `Restart`, `Abort`, speed `1×/2×/5×`, a
  `SIM CLOCK: T+…s / …s` badge with the active `SEED`, a health bar (`FEED: FRESH|STALE|
  INTERRUPTED`, `ESPADA: UP|DEGRADED|DOWN`), a `GPS UNKNOWN` indicator, and a **Run metrics**
  drawer.
* **Contact quickview / panel:** name, risk badge, status, review badge, and position as
  `E: …m N: …m (±…m)`. Operator review posts to `POST /api/simulation/runs/:id/review`.
* **⚠️ Unverified in version 2.0.0 (removed):** camera FOV 55°, far plane 5000, "sun elevation
  22°, turbidity 10", directional light intensity 1.8, a 2048×2048 / 128×128 water plane, seabed
  −40 m to −120 m, fog density 0.015, "wake particle system", labelled presets
  "Vessel Orbit / Bridge Cockpit / Top-Down Tactical / Debris Target Focus".

---

### Page 03: Mission Replay (`/replay` — `src/pages/MissionReplay.tsx` + `src/components/replay/`)

* **Access:** all authenticated roles.
* **Purpose:** forensic replay of a **recorded** run. `MissionReplay.tsx` is a thin header; the real
  UI is `RunEventConsole.tsx` ("Run event 3D view").
* **Verified features:**
  * **Saved surveys** selector from `GET /api/simulation/replays` (the legacy `REPLAY-01` fixture is
    filtered out of the list).
  * **Run a survey or follow an active session** (collapsible): scenario picker, `Start survey`,
    `Follow existing session`, `Pause`/`Resume`, `Save snapshot`
    (`POST /api/simulation/runs/:id/save-replay`).
  * **3D viewport** with `Ocean floor`, `Reset view`, and a `Cell outlines` toggle. Overlay shows
    `REPLAY`/`RUN` clock, `Recorded sonar` vs `Simulated sonar` + mapped-cell count, a min–max depth
    readout, **"Blank areas = unknown"**, and **"Location unknown · last fix retained"**.
  * **Replay transport:** play/pause, `HH:MM:SS / HH:MM:SS`, a range scrubber, and speed
    **`1× / 2× / 4× / 8×`** (version 2.0.0 said 1/2/5/10×).
  * **Detected objects** list with class, confidence ("Confidence is uncalibrated" when
    applicable), `E … · N … m`, `± … m` uncertainty, review status, and the recorded source frame
    with its capture time.
  * **Observed event log** (last 80, newest first) with per-event `HH:MM:SS`.
* **Packet-arrival fidelity:** the console is driven by `replayFeedAt(...)`, so scrubbing restores
  only the observations that had been *ingested* by that moment. The dataset's delayed alert does
  carry a ~45 s ingestion offset.
* **Feed interruption:** the dataset's intentional gap is **1500–1560 s — a 60-second window**
  (version 2.0.0 said "61-second"). Sequence numbers skip the window entirely.
* **⚠️ Removed claim:** there is no "Scenario Jump Selector" and no "6 scripted scenario windows"
  on this page. Scenarios are started from `/monitoring` or the replay console's run panel.
* **Isolation:** replay events are hydrated from the saved recording
  (`data/simulation-replays/*.json`, `SIM_REPLAY_DIR`) — nothing is regenerated and nothing reaches
  the operational DB.

---

### Page 04: Sensors & Fleet (`/sensors` — `src/pages/Sensors.tsx`)

* **Access:** any authenticated user (the route is inside `ProtectedRoute` with no role filter).
* **Purpose:** inventory and status of cameras and telemetry nodes — seeded sample data.
* **Verified content:**
  * **Coastal Optical Sensor Network:** camera card grid with `id`, `name`, `location`, `status`,
    `fps`, `resolution`; statuses `STREAMING | ONLINE | LOW_FPS | CONNECTING | DISCONNECTED |
    ERROR`. Clicking a card opens a **configuration modal** → `PATCH /api/monitoring/cameras/:id`.
  * **Telemetry Nodes & Fleet Sensor Mesh:** table of Device Node, Type, Status, Signal %, Power /
    Battery %, Uptime, Last Contact, Actions; clicking a row opens a modal →
    `PATCH /api/devices/:id`.
  * Summary stats: `n/N` cameras, `n/N` nodes, "7 Sectors", and Mesh Health (`NOMINAL` when ≥ 12
    cameras online, else `DEGRADED`).
* **⚠️ Removed claims:** RSSI/solar-charge/CPU-temperature/storage gauges, and the
  "asset ping / return-to-base / camera reboot" actions. No live video modal exists — nothing on
  this page streams video.

---

### Page 05: Debris Detections (`/detections` — `src/pages/Detections.tsx`)

* **Access:** all authenticated roles.
* **Purpose:** searchable, filterable, sortable, paginated sighting ledger from `/api/detections`,
  linking to the detail canvas.
* **Verified filters:** status (`STATUS_FILTERS`, `Detections.tsx:15`) is the real detection
  lifecycle — **`NEW | VALIDATING | CONFIRMED | TRACKING | LOST | FALSE_POSITIVE | EXPIRED`** —
  plus risk-level and free-text search. Version 2.0.0's `PENDING_REVIEW / VERIFIED /
  CLEANUP_QUEUED` values do not exist in the data model.
* **Verified summary cards:** Critical Risk, Active Tracking, New Unconfirmed.
* **⚠️ Removed claim:** the CSV / JSON / GeoJSON batch export. No export handler exists on this page.

---

### Page 06: Detection Detail (`/detections/:id` — `src/pages/DetectionDetail.tsx`)

* **Access:** all authenticated roles.
* **Purpose:** deep-dive review of one sighting.
* **Verified sections:** "Neural & Environmental Risk Breakdown" and "Tracking History & Drift"
  (labelled with `Track ID`).
* **Status changes:** `PATCH /api/detections/:id/status`, gated to
  `ADMIN | FIELD_OPERATOR | ENVIRONMENTAL_OFFICER`, and broadcast to SSE as `DETECTION_UPDATE`.
* **Relevant model shape:** `StoredDetection` carries `confidence`, `riskScore`, `riskLevel`,
  `riskFactors[]`, `boundingBox`, `trackPoints[]`, `estimatedMassKg`, `cameraName`, `zoneName`, and
  `notes` (`src/server/storage.ts:28`).
* **⚠️ Unverified:** an "Audit Timeline" component and the example score percentages.

---

### Page 07: Pollution Hotspots (`/hotspots` — `src/pages/Hotspots.tsx`)

* **Access:** all authenticated roles.
* **Purpose:** map-based hotspot visualisation.
* **Verified:** real **Leaflet** integration (`L.map` at `Hotspots.tsx:106`) with a switchable base
  tile layer (Esri `World_Topo_Map`) and an ocean reference overlay (`World_Ocean_Reference`,
  `Hotspots.tsx:241`), `L.circle` hotspot markers, and custom dark styling layered over
  `.leaflet-container`. Data from `GET /api/hotspots/heatmap` and `/api/hotspots`.
* **⚠️ Removed claims:** "kernel density estimation", and vector polygon overlays for specific
  marine parks, and the total-mass / drift-vector detail drawer. If those are added later, document
  the real implementation rather than the assumption.

---

### Page 08: Environmental AI (`/ai` — `src/pages/EnvironmentalAI.tsx`)

* **Access:** all authenticated roles (route-level; the earlier "restricted" note was wrong).
* **Purpose:** environmental analytics with a period selector, powered by
  `GET /api/analytics/overview | trends | categories`.
* **Verified cards:** classified debris contacts; **"Verified validation metrics"** (explicitly
  labelled, and degrading to "Live model metrics are temporarily unavailable"); categorical
  distribution; severity buckets; per-sector breakdown.
* **Provenance:** environmental readings (wave height, wind, turbidity, visibility) are synthetic
  functions of time and are labelled "assumption-driven, not measured" in the dataset's
  `ASSUMPTIONS.md`, so this page is a **SAMPLE DATA** surface.
* **⚠️ Unverified:** a dedicated "drift vector field" visualisation.

---

### Page 09: Espada AI & Data (`/data` — `src/pages/DataIngestion.tsx`)

* **Access:** all authenticated roles at the route level; the review endpoints themselves are gated
  to `ESPADA_REVIEW_ROLES`.
* **Purpose:** MLOps status, direct inference testbed, live camera inference, and the annotation
  studio.

```
+-------------------------------------------------------------------------------------------+
| ESPADA MLOPS & REVIEW WORKFLOW                                                            |
|                                                                                           |
|  1. INGESTION            2. INFERENCE              3. ANNOTATION        4. LEARNING         |
|  [upload / camera]  -->  POST /api/ai/infer-image --> [AnnotationEditor] -> PUT /api/ai/    |
|  (camera loop 1500 ms)   -> Espada /v1/detect        * move/resize boxes    analyses/:id/    |
|     raw bytes <= 4 MB    * raw vs calibrated conf    * add missed boxes      review         |
|                          * class: Mixed Waste         * approve empty frame  -> SQLite WAL    |
+-------------------------------------------------------------------------------------------+
```

* **Verified workflows:**
  1. **Model status** from `GET /api/ai/status` + `/api/ai/models` (name, architecture, input size,
     engine, `learning.framesReviewed`, class list).
  2. **Upload worker:** validates type/size client-side, keeps **at most 2 analyses in flight**, and
     POSTs raw bytes to `POST /api/ai/infer-image` (`image/jpeg|png|webp`, limit 4 MB), which the
     gateway forwards to Espada as a multipart `file` field at `/v1/detect`.
  3. **Live camera:** `getUserMedia` (environment-facing, 1280 ideal) then **one frame every
     1500 ms** through the same endpoint (`DataIngestion.tsx:291`); pausing retains the frame.
     A clear error is shown when camera access is unavailable (needs HTTPS or localhost).
  4. **Annotation editor** (`src/components/ai/AnnotationEditor.tsx`): move/resize predicted boxes,
     draw missed objects, approve an empty frame, and commit a **whole-frame** review to
     `PUT /api/ai/analyses/:analysisId/review` → Espada `PUT /v1/analyses/{id}/review`.
* **Retired paths:** `POST /api/ai/infer` and `POST /api/ai/feedback` are **410 tombstones**.
* **⚠️ Removed claim:** the "8–25 ms inference latency" figure. No source in the repository states a
  latency budget; the measured pipeline latency documented in `docs/MISSION_SIMULATION.md` §8 is
  p50 2.36 s / p95 3.46 s of *simulation* time through the full HTTP + queue path at 20× speed.

---

### Page 10: Cleanup Missions (`/cleanup` — `src/pages/Cleanup.tsx`)

* **Access:** `ADMIN | FIELD_OPERATOR | CLEANUP_TEAM` (enforced on the write endpoints via
  `CLEANUP_MANAGE_ROLES`).
* **Purpose:** mission queue with filter/sort and a create/edit dispatch dialog.
* **Verified KPI bar:** Total Missions, In Progress, Assigned, Completed.
* **Mission statuses actually present in the seeded data:
  `IN_PROGRESS | ASSIGNED | SCHEDULED | COMPLETED`.** Version 2.0.0's
  `EN_ROUTE / ACTIVE_COLLECTION / CANCELLED` set does not appear.
* **API:** `GET|POST /api/cleanup/missions`, `PATCH /api/cleanup/missions/:id`.

---

### Page 11: Cleanup Detail (`/cleanup/:id` — `src/pages/CleanupDetail.tsx`)

* **Access:** as above.
* **Purpose:** execution record for one mission.
* **Verified sections:** **Operational Brief**, **Evidence & Recovery Manifest**,
  **Deployment Details**, **Mission Log & Timeline**.
* **Evidence upload:** `POST /api/cleanup/missions/:id/evidence`.
* **⚠️ Unverified:** the specific checklist steps, material-category recovery log, and automatic
  debrief generation claimed in version 2.0.0.

---

### Page 12: Reports & Export (`/reports` — `src/pages/Reports.tsx`)

* **Access:** `REPORT_GENERATE_ROLES` for listing/generation; `ALL_ROLES` for download.
* **Purpose:** regulatory/audit reporting.
* **Verified report types:** `DAILY | WEEKLY | MONTHLY | INCIDENT | CLEANUP`.
* **Verified scope selector:** `ALL` plus seven named zones — `Z1` Gulf of Kachchh Marine Park,
  `Z2` Mumbai Offshore & Harbour, `Z3` Goa Shelf & Estuary, `Z4` Konkan Coastal Corridor,
  `Z5` Odisha Offshore Shelf, `Z6` Chennai Marine Corridor, `Z7` Gulf of Mannar Biosphere.
* **Verified generation modes:** live generation via `POST /api/reports/generate`, and an
  explicitly labelled sample preview when telemetry is unavailable.
* **Verified exports:** `pdf | csv | json` (`Reports.tsx:128`) — where **PDF is an HTML print view**
  opened in a new window, with an explicit pop-up-blocked error message.
  (`GET /api/reports/:id/download`.)

---

### Page 13: Admin Governance (`/admin` — `src/pages/Admin.tsx`)

* **Access:** `ADMIN` only (enforced by a nested `<ProtectedRoute allowedRoles={['ADMIN']}>`).
* **Purpose:** governance, users, thresholds, access requests, audit trail.
* **Verified tabs (5): User Management · Monitoring Zones · Alert Thresholds · Sentinel Requests ·
  Audit Log.**
* **API:** `GET|POST /api/admin/users`, `PATCH /api/admin/users/:id`,
  `GET|PUT /api/admin/thresholds`, `GET /api/admin/access-requests`, `GET /api/admin/audit-log`.
* **Security note:** `GET /api/admin/thresholds` is currently **not** role-gated while `PUT` is
  (`server.ts:940`). Treat it as a known hardening item rather than intended design.

---

### Page 14: System Settings (`/settings` — `src/pages/Settings.tsx`)

* **Access:** all authenticated roles.
* **Purpose:** profile, display/map preferences, notification toggles, and service status.
* **Verified cards:** authenticated profile (name/email/organization); display preferences (themes,
  map style, audio telemetry); anomaly notification toggles; and a **"Honest status of backend
  services, sensor mesh, and inference workers"** card driven by live health endpoints.
* **Version caveat: the page hardcodes `Platform Version: OceanGuard AI v1.4.0`**
  (`Settings.tsx:286`) while `package.json` declares `0.0.0`. Treat the displayed string as a label
  only; read build metadata when a real version matters.

---

### Page 15: Public Landing (`/portal` — `src/pages/Landing.tsx`)

* **Access:** public.
* **Purpose:** the same `Landing.tsx` page described as Page 00 above. Note the route correction:
  it is mounted at **`/portal`**, and `/` redirects.
* **Honest provenance highlights (verified):**
  * It does **not** repeat the historical marketing claims (14.8M-parameter transformer, 99.4%
    recall, 428 autonomous gliders).
  * It shows a conservative **"Training Samples: 494+"** figure sourced from the model metadata.
* **Corrected claim — the important one.** Version 2.0.0 stated that this page "presents measured
  benchmark numbers … precision 35.3%, recall 23.1%, F1 28.0%". **It does not.** The precision /
  recall / F1 values exist only in machine-readable and technical documents —
  `ai_service/models/model-metadata.json` (`iou50Precision` 0.35308056872037913,
  `iou50Recall` 0.23136645962732919, `iou50F1` 0.2795497185741088) and
  `docs/MISSION_SIMULATION.md` §1. The landing page renders the sample count and a globe, not a
  metrics table.
* The "Quick Demo Login shortcuts" claim is also false — there are no demo-login buttons. Demo
  credentials are documented in §4.4 below for manual use.

---

## 4. Backend Gateway Architecture (`server.ts`)

```
+--------------------------------------------------------------------------------------------+
| EXPRESS GATEWAY ROUTE MAP (verified against server.ts)                                     |
+--------------------------------------------------------------------------------------------+
| AUTHENTICATION & SESSIONS                                                                  |
|   POST /api/auth/login            -> verifies HMAC-SHA256(password, salt); issues token     |
|   POST /api/auth/logout           -> revokes the session token                              |
|   GET  /api/auth/me               -> sanitised profile for the current bearer token         |
|   POST /api/auth/recover          -> account recovery                                       |
|   POST /api/auth/reset-password   -> password reset                                         |
|   POST /api/access-requests       -> public access request (used by the landing page)       |
|   GET  /api/admin/access-requests -> ADMIN review queue                                     |
|   GET|POST /api/admin/users       -> ADMIN user management       (NOT /api/users)            |
|   PATCH /api/admin/users/:id      -> ADMIN user update                                      |
+--------------------------------------------------------------------------------------------+
| TELEMETRY, HEALTH & SSE                                                                    |
|   GET  /api/health                      -> gateway + Espada health                          |
|   GET  /api/source-modes                -> LIVE / REPLAY / SIMULATION availability          |
|   GET  /api/events                      -> SSE stream (returns 204 under VERCEL)            |
|   GET  /api/dashboard/summary           -> aggregated counts                                |
|   GET  /api/dashboard/trends            -> time series                                      |
|   GET  /api/dashboard/system-health     -> subsystem matrix  (NOT /dashboard/health)        |
|   GET  /api/dashboard/recent-detections -> latest sightings                                 |
|   GET  /api/dashboard/alerts            -> active alerts                                    |
+--------------------------------------------------------------------------------------------+
| CORE ENTITIES                                                                              |
|   GET  /api/detections | /:id | /:id/track        -> ledger, detail, track history           |
|   PATCH /api/detections/:id/status                -> confirm/reject (ESPADA_REVIEW_ROLES)    |
|   GET  /api/alerts | /:id                         -> alert feed                              |
|   PATCH /api/alerts/:id/status                    -> acknowledge (ALL_ROLES)                 |
|   POST /api/alerts/:id/assign                     -> assign (ALL_ROLES)                      |
|   GET  /api/hotspots | /heatmap | /:id            -> hotspot data                            |
|   GET  /api/cleanup/missions | /:id               -> cleanup missions      (NOT /api/cleanup) |
|   POST /api/cleanup/missions                      -> dispatch (CLEANUP_MANAGE_ROLES)         |
|   PATCH /api/cleanup/missions/:id                 -> update (CLEANUP_MANAGE_ROLES)           |
|   POST /api/cleanup/missions/:id/evidence         -> evidence upload                         |
|   GET  /api/monitoring/cameras | /:id             -> camera inventory   (NO /api/sensors)    |
|   PATCH /api/monitoring/cameras/:id               -> status update                           |
|   GET  /api/devices | /:id   ·  PATCH /api/devices/:id                                       |
|   GET  /api/media   ·  POST /api/media/:id/process                                           |
|   GET  /api/reports | /:id | /:id/download        -> report archive + export                 |
|   POST /api/reports/generate                      -> compile a report                        |
|   GET|PUT /api/admin/thresholds                   -> read (ungated) / write (ADMIN)          |
|   GET  /api/admin/audit-log                       -> ADMIN audit trail                        |
+--------------------------------------------------------------------------------------------+
| SIMULATION & REPLAY  (router mounted at /api/simulation)                                    |
|   GET   /modes | /scenarios | /runs | /runs/:id                                              |
|   POST  /runs                                        -> start a run                          |
|   POST  /runs/:id/pause | /resume | /restart | /abort                                        |
|   PATCH /runs/:id                                    -> change speed  (NOT /runs/:id/speed)  |
|   GET   /runs/:id/events?since=                      -> incremental batch + cursor           |
|   POST  /runs/:id/review                             -> operator verdict on a live track     |
|   GET   /runs/:id/metrics                            -> evaluator metrics                    |
|   POST  /runs/:id/save-replay                        -> persist the recording                |
|   GET   /replays | /replays/:id                      -> replay archive + one recording       |
+--------------------------------------------------------------------------------------------+
| ESPADA PROXY (forwarded to FastAPI :8000)                                                  |
|   GET  /api/ai/status                   -> /v1/model + health                               |
|   GET  /api/ai/models                   -> model registry / active release                  |
|   GET  /api/ai/learning                 -> /v1/learning statistics                          |
|   POST /api/ai/infer-image              -> raw image -> multipart -> /v1/detect             |
|   PUT  /api/ai/analyses/:id/review      -> whole-frame review -> /v1/analyses/:id/review     |
|   POST /api/ai/infer   ·  /api/ai/feedback -> 410 tombstones (retired paths)                 |
+--------------------------------------------------------------------------------------------+
```

**Read-access note.** Many read endpoints above are intentionally unauthenticated in this codebase
(auth is applied selectively with `requireApiUser(...)`). Do not assume a route is protected because
it looks operational — check `server.ts`.

### 4.1 Authentication & Cryptographic Security

* **Password hashing:** `hashPassword(password, salt) = HMAC-SHA256(salt, password)` implemented as
  `crypto.createHmac('sha256', salt).update(password).digest('hex')`
  (`src/server/storage.ts:209`). Salts come from `crypto.randomBytes(16).toString('hex')`.
  There is **no** PBKDF2 / SHA-512 / 100,000-iteration derivation. Version 2.0.0's claim (and its
  "64-byte salt") was wrong.
* **Seeded demo accounts share one hardcoded salt.** `DEFAULT_SALT = 'oceanguard_demo_salt_2026'`
  and `DEFAULT_HASH = hashPassword('demo1234', DEFAULT_SALT)` are used for all four seed users
  (`storage.ts:217`). Newly created users get a fresh random salt via `generateSalt()`. If this
  moves beyond a demo, seeded salts should be rotated.
* **Sessions:** two mechanisms coexist.
  1. An opaque bearer token `og_sess_<24 random bytes hex>` recorded in the JSON DB with an expiry
     (`storage.ts:849`) — the API path used by the SPA.
  2. An HMAC-SHA256-signed value (`createHmac('sha256', SESSION_SECRET)`) validated with
     `timingSafeEqual` (`server.ts:31,44`) — the browser/cookie path.
  Note only the signature comparison is constant-time; the token lookup itself is a map lookup.
* **Demo accounts** (password `demo1234` for all four):

  | Email | Role |
  |---|---|
  | `admin@oceanguard.ai` | `ADMIN` |
  | `operator@oceanguard.ai` | `FIELD_OPERATOR` |
  | `officer@oceanguard.ai` | `ENVIRONMENTAL_OFFICER` |
  | `cleanup@oceanguard.ai` | `CLEANUP_TEAM` |

### 4.2 Storage Subsystem (`src/server/storage.ts`)

* Persistent JSON at `data/oceanguard-db.json` — path overridable with `OCEANGUARD_WEB_DATA_DIR`;
  under Vercel it falls back to the OS temp dir (`storage.ts:740`).
* **Atomic writes:** the DB is dumped to `<db>.tmp.<timestamp>` and then `fs.renameSync`-d over the
  live file so a crash cannot leave a half-written database (`storage.ts:765`).
* **Sanitisation:** `sanitizeUser()` strips `passwordHash` and `salt` from every outbound user
  object.
* **All operational records are seeded.** `getInitialDatabase()` builds users, detections, alerts,
  cameras, devices, hotspots, cleanup missions, and reports with `Date.now()`-relative timestamps.
  A mission showing `IN_PROGRESS` is a seed label, not evidence of a live operation.

---

## 5. Espada AI Microservice Architecture (`ai_service/`)

```
+--------------------------------------------------------------------------------------------+
| ESPADA DETECTOR SUBSYSTEM                                                                  |
|                                                                                            |
|   INPUT                    ONNX RUNTIME GRAPH                    OUTPUT PARSING             |
|  [320x320x3 RGB]     +-------------------------------+     [raw box offsets + logits]       |
|   normalised         | SSDLite320 (MobileNetV3)      |              |                       |
|   letterboxed        | single class: "Mixed Waste"   |     [anchor decoding]               |
|        |             +-------------------------------+              |                       |
|        v                          |                          [non-max suppression]         |
|  [Pillow preprocess]              +----------------------------------> [calibrated prob]  |
+--------------------------------------------------------------------------------------------+
```

### 5.1 Model Specification & Metrics (`ai_service/models/model-metadata.json`)

| Field | Verified value |
|---|---|
| Name / version | `Espada` / `1` |
| Architecture | `SSDLite320 MobileNetV3` (TorchVision COCO transfer-learning initialisation) |
| Training status | `TRAINED`, trained `2026-09-12T17:39:50Z` |
| Input / threshold | `320 × 320` / `confidenceThreshold 0.25` |
| Training / validation images | `494` / `200` |
| Learned classes | **exactly one:** `Mixed Waste` (class id `0`) |
| Precision @ IoU 0.50 | `35.31%` (`0.35308056872037913`) |
| Recall @ IoU 0.50 | `23.14%` (`0.23136645962732919`) |
| F1 @ IoU 0.50 | `27.95%` (`0.2795497185741088`) |
| TP / FP / FN | `149` / `273` / `495` |
| `validationScope` (verbatim) | "General-litter pilot: limited recall, one Mixed Waste class. **Not validated for marine deployment; review every result.**" |

Calibration bins (observed precision per confidence band) are published alongside the metrics and
consumed by the frontend, which is why the UI can show "calibrated" vs "raw" confidence.

### 5.2 Service Endpoints (`ai_service/app/main.py`)

```
GET  /health
GET  /v1/model
GET  /v1/learning
POST /v1/detect                     (multipart `file`)
POST /v1/feedback                   (410 tombstone — per-box feedback retired)
PUT  /v1/analyses/{analysis_id}/review
```

Both the Espada route and the gateway proxy for per-box feedback return **410** with the message
"Per-box feedback has been retired. Submit whole-frame reviews via
PUT /v1/analyses/{analysis_id}/review."

### 5.3 SQLite Learning Store (`ai_service/app/learning.py`)

* SQLite 3 in **WAL** mode with `PRAGMA foreign_keys=ON` (`learning.py:35`).
* **Tables (verified): `analyses`, `feedback`, `frame_reviews`** — plus indexes
  `idx_feedback_created_at` and `idx_frame_reviews_updated_at`. Version 2.0.0 listed
  `reviews` / `snapshots`, which do not exist under those names.
* **Optimistic concurrency:** `save_frame_review(...)` takes `expected_revision`, reads the current
  `frame_reviews.revision`, and raises **`RevisionConflictError`** when they differ, instead of
  overwriting another operator's edit (`learning.py:17,413`). On success it writes
  `revision = next_revision` and returns the new revision.
* **Contamination guard:** `record_analysis()` stores the image and result for every `/v1/detect`
  call **unless** the request carries `X-Espada-Skip-Learning: true`, which the simulation harness
  sets. `docs/MISSION_SIMULATION.md` §8 records the empirical check: `/v1/learning`
  `analysesStored` stayed at 15 across ~100 simulation inference calls.

### 5.4 Continual Learning Worker (`ai_service/training/continual_worker.py`)

* Started by `scripts/dev.mjs` as the "Espada trainer" child process
  (`python -m ai_service.training.continual_worker`).
* **Environment-driven thresholds (verified defaults):**

  | Env var | Default |
  |---|---|
  | `OCEANGUARD_MIN_NEW_REVIEWS` | `50` |
  | `OCEANGUARD_RETRAIN_POLL_SECONDS` | `300` |
  | `OCEANGUARD_MIN_F1_IMPROVEMENT` | `0.005` |
  | `OCEANGUARD_RETRAIN_EPOCHS` | `12` |
  | `OCEANGUARD_TRAINING_HEARTBEAT_SECONDS` | `30` |

  Version 2.0.0 called the threshold `MIN_REVIEWED_FOR_TRAIN`; that name does not exist.
* **Lifecycle:** poll for untrained reviews → validate every image (fail closed) → fine-tune a
  candidate from `checkpoint.pt` → score against the unchanged 200-image holdout → **only publish
  if F1 strictly improves by more than `OCEANGUARD_MIN_F1_IMPROVEMENT`** → write a release bundle to
  `ai_service/models/releases/{timestamp}/` and atomically update the `current.json` pointer.
* **Release resolution:** the detector reads `current.json` and resolves
  `release/espada-v1.onnx`, `classes.json`, and `model-metadata.json`, rejecting release paths that
  escape the model root (`ai_service/app/model.py:105`). Version 2.0.0's "hot-reloads the new ONNX
  model without dropping live requests" is **not verified** in source — describe it as pointer
  re-resolution rather than a guaranteed zero-downtime swap.

---

## 6. Simulation & Replay Engine (`src/server/simulation.ts`)

The engine generates deterministic maritime contacts, telemetry, environment series, and synthetic
camera frames so the pipeline can be exercised without deploying a boat.

### 6.1 Determinism

* **Mulberry32 PRNG** (`makeRng`, `simulation.ts:17`) seeded with **`20260922`** for the dataset and
  default run seed. `platformTrack(durationS, seed)` and `patrolSectorTrack(durationS, seed = 42)`
  build the survey paths. Same seed → identical telemetry, detections, and wave conditions.

### 6.2 Scenario catalogue — **11 factories**, not 8

`SCENARIO_FACTORIES` (`simulation.ts:326`):

| ID | Name | Duration | Faults / operator script |
|---|---|---|---|
| `SIM-NORMAL` | Normal progression, no debris | 120 s | none — expects 0 detections, 0 alerts |
| `SIM-FOV` | Coastal Harbor Patrol (8 Demo Contacts) | 240 s | none |
| `SIM-HARBOR-01` | Extended Harbor Patrol (6 min, 8 Demo Contacts) | 360 s | none |
| `SIM-BENTHIC-02` | Deep Benthic Shelf Survey (8 Submerged Objects) | 360 s | none |
| `SIM-SURGE-03` | Storm Surge & Drifter Field (8 High-Turbidity Objects) | 360 s | degraded environment |
| `SIM-COUNT` | Five objects, repeated observations | 300 s | none — unique-object counting test |
| `SIM-GLARE` | Glare windows and degraded conditions | 240 s | `glareWindows` 60–120 s and 180–220 s |
| `SIM-OCCLUSION` | Partial occlusion and reappearance | 300 s | visibility 15–80 s and 150–290 s |
| `SIM-NOISE` | GPS noise, missing location, delayed/out-of-order telemetry, duplicates | 240 s | `GPS_NOISE` 60 s, `MISSING_LOCATION` 100 s, `DELAYED_TELEMETRY` 120 s, `OUT_OF_ORDER` 150 s, `DUPLICATE_EVENTS` 180 s |
| `SIM-FAULTS` | Camera outage, network loss, ESPADA timeout, reconnection, recovery | 360 s | `CAMERA_OUTAGE` 80 s, `NETWORK_LOSS` 150 s, `ESPADA_TIMEOUT` 220 s |
| `SIM-OPS` | Mission pause, review workflow, completion | 300 s | operator script at 60 s pause, 90 s resume, 130 s false-positive review, 160 s correction, 290 s complete |

**Do not confuse the catalogue with the test matrix.** `docs/MISSION_SIMULATION.md` §5 scores a
**subset of 8** (`SIM-NORMAL`, `SIM-FOV`, `SIM-COUNT`, `SIM-GLARE`, `SIM-OCCLUSION`, `SIM-NOISE`,
`SIM-FAULTS`, `SIM-OPS`) against acceptance thresholds. The three extra
`SIM-HARBOR-01` / `SIM-BENTHIC-02` / `SIM-SURGE-03` scenarios exist to exercise the demo contact
sets.

Version 2.0.0's descriptions for `SIM-NORMAL` ("30-minute patrol"), `SIM-COUNT` ("occlusion"),
`SIM-NOISE` ("fog and grain"), `SIM-FAULTS` ("intermittent GPS drift … the 61-second communication
gap"), and `SIM-OPS` were wrong on both names and semantics. The 61-second figure does not exist
anywhere in the repository.

### 6.3 Run lifecycle

* Runs are `SIM-RUN-####` ids held in module-local memory, **fully separate from `storage.ts`** (an
  isolation test enforces it). States: `RUNNING | PAUSED | COMPLETED | ABORTED`.
* A single monotonic sim clock drives frames, telemetry, environment, inference scheduling, alerts,
  and mission state. Pausing stops the clock; event processing is idempotent by event id + cursor.
* Feed health is reported per run as `FRESH | STALE | INTERRUPTED` and inference as
  `UP | DEGRADED | DOWN`.

### 6.4 Replay fidelity guarantees

These are the properties that make replay trustworthy, and each is covered by a test or check:

1. **Replay reads, never regenerates.** `POST /runs/:id/save-replay` persists the run's event log to
   `data/simulation-replays/*.json` (`SIM_REPLAY_DIR`); `GET /replays/:id` streams it back.
2. **The cursor spans the whole recorded timeline.** The replay clock derives from the last recorded
   *ingestion* time, not the mission's declared duration — the dataset's final fix is ingested at
   1800.2 s, and capping at 1800 s silently dropped one of 1,740 fixes.
3. **`advanceRun` advances recorded replays** through `advanceReplayClock` rather than re-running the
   scenario path.
4. **Alerts resolve to real tracks** via `related_track_id → ground_truth_object_id → TRK-REC-<object>`.
5. **Unknown GPS fixes stay unknown** — exported as `lat:''`, `lon:''`, `location_unknown:'true'`,
   never a coordinate at the ENU origin.
6. **De-duplication is durable across ticks** (the ingestion set persists between ticks).
7. **Seabed coverage is honest** — replay bathymetry cells carry a `source` (`SENSOR` →
   "Recorded sonar", `SIMULATED_SONAR` → "Simulated sonar") and the UI states
   **"Blank areas = unknown"**, so unmapped seabed is never implied to be measured.

* (Historical fix lists lived in the now-removed agent handoff documents; do not re-break
  the honesty invariants described above.)

---

## 7. Developer Operations & Verification Playbook

### 7.1 Starting the full stack

Run from the `OceanGuard-main` root:

```bash
pnpm install
pnpm run dev
```

`scripts/dev.mjs` (Node ESM supervisor):
1. Probes `AI_SERVICE_URL` (default `http://127.0.0.1:8000`) for an existing Espada service.
2. If none, starts Uvicorn from the venv —
   `.venv/Scripts/python.exe -m uvicorn ai_service.app.main:app --host 127.0.0.1 --port 8000`.
3. Starts the continual-learning worker —
   `.venv/Scripts/python.exe -m ai_service.training.continual_worker`.
4. Starts the gateway with `node --import tsx server.ts` on port 3000; **`server.ts` itself adds
   Vite middleware in dev** (the supervisor does not inject it) and serves the built SPA in
   production.

⚠️ On Windows, terminate the whole process tree (`taskkill /PID <pid> /T /F`) — an orphaned Uvicorn
keeps port 8000 bound.

### 7.2 Verification commands

```bash
# 1. TypeScript typecheck — must be clean. (`pnpm run lint` runs exactly this.)
pnpm run lint

# 2. Unit / integration tests (there is no `test` script)
node --import tsx --test tests/*.test.ts

# 3. Simulation dataset integrity (manifest, hashes, rows, timestamps)
node --import tsx scripts/check-simulation.mjs

# 4. Replay bounds / ingestion-time visibility / path geometry
node --import tsx scripts/check-replay.mjs

# 5. Scenario registry -> run creation -> events -> pause/resume/restart/abort
node --import tsx scripts/check-monitoring-pipeline.mjs

# 6. Seabed instanced-mesh counts + terrain-anchored station
node --import tsx scripts/check-ocean-elements.mjs

# 7. Python AI unit & concurrency tests
.venv/Scripts/python.exe -m unittest discover -s ai_service/tests

# 8. Production bundle (Vite frontend + esbuild server)
pnpm run build
```

Version 2.0.0's list used `npm run dev` and bare `node scripts/check-*.mjs` (which fails without
`--import tsx`). Both are corrected above.

### 7.3 Test and check inventory

| File | Covers |
|---|---|
| `tests/simulation.test.ts` | Scenario catalogue, run lifecycle, determinism, storage isolation. |
| `tests/simulation-engine.test.ts` | Clock advance, event emission, metrics. |
| `tests/replay.test.ts` | Dataset projection / ingestion-time visibility helpers. |
| `tests/recording.test.ts` | Save/load round-trip of a recording (temp `SIM_REPLAY_DIR`). |
| `tests/replay-run.test.ts` | Replay fidelity — every recorded observation replayed exactly once. |
| `ai_service/tests/test_espada.py` | Espada detector behaviour. |
| `ai_service/tests/test_gateway_integration.py` | Gateway ↔ Espada integration. |

### 7.4 Ports

* **3000** — OceanGuard web server (SPA + API gateway).
* **8000** — Espada microservice (FastAPI + Uvicorn), `AI_SERVICE_URL`.

---

## 8. Simulation Dataset Recap (`public/simulation/mission.json`)

The replay demo is driven by a standalone synthetic package (schema version
`0.1.0-unverified`, seed `20260922`, mission `MSN-0001`, 30 minutes, ENU origin near
13.02 N / 80.34 E — **unverified placement; the local ENU grid is authoritative**):

| Table | Rows |
|---|---|
| `telemetry` | 1740 |
| `detections` | 53 |
| `tracks` | 4 |
| `alerts` | 5 |
| `object_truth` | 5 |
| `scenario_events` | 6 |
| `environmental_observations` | 29 |
| `sensors` / `platforms` / `missions` | 3 / 1 / 1 |

Row provenance: telemetry and alerts `synthetic_simulation`; tracks `simulated_ground_truth`;
detections `derived_estimate` (a range/bearing heuristic — **not** a camera projection).
The six scenario windows are `debris_appearance` 600–605 s, `repeated_observation` 200–260 s,
`occlusion` 900–960 s, `gps_noise` 1100–1160 s, `delayed_event` at 1300 s (~45 s ingestion
offset), and `feed_interruption` **1500–1560 s**.

---

## 9. Active Documentation Hierarchy

| Document | Authority & scope |
|---|---|
| [BRAIN.md](BRAIN.md) *(this file)* | System brain: architecture, stack, pages, APIs, ML, simulation, dev ops. |
| [README.md](README.md) | Quick-start, stack summary, honest capability notes. |
| [AGENTS.md](AGENTS.md) | Multi-agent collaboration, delegation, and safety rules. |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Docker Compose deployment and hosted-storage notes. |
| [docs/MISSION_SIMULATION.md](docs/MISSION_SIMULATION.md) | **Authoritative** simulation audit: connected/unconnected inventory, modes, acceptance thresholds, measured results. |
| [public/simulation/SCHEMA.md](public/simulation/SCHEMA.md) · [ASSUMPTIONS.md](public/simulation/ASSUMPTIONS.md) | Field-level schema and the dataset's documented defaults and gaps. |

*(Links are relative so they resolve from the repository root on any machine. Version 2.0.0 used
absolute `file:///c:/Users/alonso/...` URLs, which break for anyone else.)*

---

## 10. Known Gaps & Rules for Contributors

**Gaps that must stay visible, not papered over**

* No live sensors, cameras, or AUV telemetry; `LIVE` mode reports `UNAVAILABLE`.
* No real marine imagery (only `public/simulation/fixtures/SYNTHETIC_*.png` and user uploads).
* No camera calibration; bounding boxes are heuristic and marked `derived_estimate`.
* Geodetic placement is unverified; the ENU grid is authoritative.
* One learned class (`Mixed Waste`) with pilot-level precision/recall (0.353 / 0.231).
* In the recorded dataset, detections are generated from ground truth by a visibility model — they
  are **not** model output. Only runs that POST frames to the live Espada service produce
  `MODEL_OUTPUT`.
* No sonar hardware; replay cells marked `SIMULATED_SONAR` are synthetic.

**Rules**

1. Never fabricate a metric — use `'—'`, an explicit reason, or `<DataProvenanceBadge status="UNAVAILABLE" />`.
2. Keep synthetic/derived provenance labels intact, and keep `X-Espada-Skip-Learning` on evaluation traffic.
3. Do not rewrite the 3D scenes; fix defects in place.
4. Replay must read recorded observations — never regenerate them.
5. Do not invent coordinates for missing GPS fixes.
6. Run `pnpm run lint`, the relevant tests, and the relevant `check-*` scripts before claiming success, and never report a check you did not run.
7. Read files from disk immediately before editing; this tree has concurrent editors.
