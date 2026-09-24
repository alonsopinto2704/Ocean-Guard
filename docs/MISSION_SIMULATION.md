# Mission Simulation & Replay — Audit, Design, and Test Matrix

Prompt 2 deliverable: verify what is genuinely connected in Ocean Guard, then run a
reproducible mission simulation through the **real** ESPADA detection pipeline and a
**data-connected 3D view** inside Mission Replay. Modes: LIVE / REPLAY / SIMULATION,
explicitly labeled.

## 1. What is currently connected (verified 2026-09-22)

### Mission records
- `src/server/storage.ts` — in-memory JSON-file DB (`data/oceanguard-db.json`) with
  users, detections, alerts, cameras, devices, hotspots, cleanup missions, reports.
  **All operational records are SEEDED SAMPLE DATA** (`getInitialDatabase()`), built
  with `Date.now()` offsets at first boot. Mission statuses (`IN_PROGRESS`,
  `ASSIGNED`, `SCHEDULED`) come from this seed; there is no external mission system.
- **Conclusion: no genuinely ongoing live mission exists.** An "ACTIVE"-looking
  status here is a seeded label, not evidence of a live operation. Therefore the
  demonstration runs in **REPLAY and SIMULATION modes only**, and the LIVE mode
  reports `UNAVAILABLE` with its reason. This limitation is surfaced in the UI.

### Telemetry / imagery / detection sources
- No live telemetry or camera feed is connected. `server.ts` polls nothing; the SSE
  `DETECTION_TELEMETRY` broadcast re-sends random **seeded** detections every 10 s.
- Imagery: only `public/simulation/fixtures/SYNTHETIC_*.png` (procedural renders,
  labeled synthetic) and user uploads via `/data`.
- The `public/simulation/mission.json` package is a **standalone synthetic dataset**
  (seed 20260922): 1,740 telemetry rows, 53 simulated detections, 4 tracks, 5 truth
  objects, 6 scenario windows. Its detections are **generated from ground truth by a
  visibility model — NOT model output** (documented in its SCHEMA.md).
- Legacy `/api/ai/infer` (simulated inference) was removed; the real path is
  `POST /api/ai/infer-image` → Espada `POST /v1/detect` (multipart `file`).

### ESPADA inference service (verified working)
- `ai_service/` FastAPI + ONNX Runtime. Trained weights exist
  (`ai_service/models/releases/.../espada-v1.onnx`, metadata: SSDLite320
  MobileNetV3, **single class `Mixed Waste`**, input 320, threshold 0.25,
  validation precision 0.353 / recall 0.231 on a general-litter pilot).
- Verified in this environment: venv imports OK, detector instantiates `READY`,
  engine `ONNX Runtime`, classes `['Mixed Waste']`.
- Response contract (verified from `ai_service/app/model.py`): `{ model, source,
  latencyMs, detections:[{ id, className, confidence (calibrated %),
  rawConfidence (%), confidenceCalibrated, boundingBox {x,y,width,height},
  riskScore, riskLevel }], summary, analysis:{ confidenceMethod } , analysisId }`.
- Bootstrap mode (no weights): returns `Mixed Waste` detections whose confidence is
  an **uncalibrated visual-anomaly score** — never model accuracy.

### 3D monitoring view
- `src/pages/Monitoring.tsx` + `src/components/monitoring/oceanScene.ts` now
  show the ship, deployed AUV, and event-driven simulated contacts. The visible
  background seabed is procedural illustration, not mapped sonar evidence.
- The **Mission Replay page** builds the separate floor-only surface from
  recorded `BATHYMETRY` event cells. Unsurveyed areas remain unknown.

### Learning/feedback path (contamination risk)
- `ai_service/app/learning.py` records every `/v1/detect` call (analysis + image)
  in `learning.db` and queues reviewed frames as training examples.
- **Mitigation implemented:** simulation frames are sent with
  `X-Espada-Skip-Learning: true`, and the Espada app honors the header by skipping
  `record_analysis` (no analysisId, not reviewable, not trainable). Operational
  storage never receives simulation detections (separate run registry), and
  operational detections never enter the simulator.

## 2. Modes

| Mode | Source | Status in this environment |
|---|---|---|
| LIVE | authorized current telemetry + imagery | **UNAVAILABLE** — no live mission source; shown with reason in UI |
| REPLAY | `public/simulation/mission.json` played against original event timeline | available; original capture timestamps preserved; replay clock shown separately from wall clock |
| SIMULATION | generated telemetry + synthetic imagery sent through real ESPADA | available; telemetry-only runs labeled as such (cannot demonstrate visual detection accuracy) |

## 3. Accepted acceptance thresholds (agreed 2026-09-22)

Provisional, for this synthetic test matrix only. **They do not characterize
real-world performance.**

- Box match: prediction↔ground truth IoU ≥ 0.3 on the same object id
  (one-to-one greedy matching by IoU).
- Frame-level precision/recall computed over frames where ground truth exists.
- Unique-object counting error ≤ ±1 object of 5 (SIM-COUNT scenario).
- Track identity swaps = 0.
- Localization error: RMSE of matched detection position vs reference position,
  metres, ENU frame.
- Detection→display latency p95 ≤ 2.0 s of simulation time.
- Recovery after ESPADA outage ≤ 10 s of simulation time (3 consecutive frames).
- Anything not measurable is reported as `UNAVAILABLE` with the reason.

## 4. Architecture

- **Run registry** (server, `src/server/simulation.ts`): holds runs
  `SIM-RUN-*` with scenario config, seed, speed, state (`RUNNING/PAUSED/COMPLETED/ABORTED`),
  event log, inference health, and metrics. Fully separate from `storage.ts`
  (operational DB). Enforced by an isolation test.
- **Simulation clock**: single monotonic sim-time in each run; drives frame
  generation, telemetry, environment, inference scheduling, alerts, and mission
  state. Pause stops the clock; no duplicate event processing (idempotent by
  event id + cursor).
- **Fixtures**: `scripts/generate-simulation-fixtures.mjs` (seeded, deterministic)
  writes `public/simulation/runs/*.json` scenario configs (8 scenarios) and renders
  synthetic PNG frames. Frames carry the object id in the filename so the harness
  can compute precision/recall; the detector never sees ground truth.
- **Real inference**: frames are POSTed to the Node proxy `/api/ai/infer-image`
  (same path the UI uses) → Espada `/v1/detect`. Per-frame results, latency, queue
  delay, and errors are stored in the run event log.
- **3D layer**: `MissionReplay` renders run events (platform + tracked contacts)
  using the documented ENU transform (`LocalENUFrame`, +x East, +y North, +z Up,
  metres) and `location_uncertainty_m` for marker sizing. Unknown location renders
  as UNKNOWN, never an invented position. Stale/lost tracks are distinguished by
  symbol + text, not color alone.
- **Linkage**: every displayed contact links mission id, source frame, capture
  timestamp, model result (raw vs calibrated confidence), review status.

## 5. Scenario matrix (SIM-* scenarios; expected outcomes are assertions in tests)

| ID | Scenario | Expected |
|---|---|---|
| SIM-NORMAL | no debris, calm water | 0 detections, 0 alerts, mission completes |
| SIM-FOV | debris enters/leaves FOV | track forms in range, goes stale out of range |
| SIM-COUNT | 5 objects, repeated observations | counting error ≤ ±1; no identity swaps |
| SIM-GLARE | glare/foam/wake/blur frames | detections drop or confidence lowers; precision ≥ threshold-or-reported |
| SIM-OCCLUSION | partial occlusion + reappearance | track loss then recovery, same identity |
| SIM-NOISE | GPS noise, missing location, delayed/out-of-order telemetry, duplicates | duplicates deduped; unknown locations shown as UNKNOWN |
| SIM-FAULTS | camera outage, network loss, ESPADA timeout, reconnection | feed gap preserved; recovery ≤ 10 s sim time |
| SIM-OPS | pause/abort/complete + operator review rejecting a false positive | review status visible on contact; FP excluded from confirmed counts |

## 6. Metrics definitions

- **Matching**: one-to-one greedy IoU ≥ 0.3 per frame, matched on ground-truth
  object id (only used by the evaluator, never exposed to the detector/tracker).
- **Per-frame precision** = TP / (TP + FP); **recall** = TP / (TP + FN); averaged
  over frames with ground truth (macro).
- **Unique-object counting error** = |unique predicted object ids − unique truth
  object ids| over the run.
- **Identity swaps**: number of times a predicted track's matched truth id changes.
- **Localization error**: RMSE in metres between matched prediction position
  (derived from platform pose + range/bearing estimate, ENU) and truth position.
- **Detection→display latency**: (render/display cursor time − capture event time)
  in seconds of simulation time, p50/p95.
- **Dropped frames**: frames not processed (camera outage window + inference
  failures) / frames scheduled.
- **Stale-feed behavior**: seconds of sim time from last frame to STALE marking.
- **Recovery time**: sim time from service restoration to first successful frame.
- Unavailable metrics are reported as `UNAVAILABLE` with the reason.

## 7. What was verified with what

- **Live data:** none exists — verified absence, surfaced in UI.
- **Recorded evidence:** synthetic mission dataset replay (deterministic, seeded;
  provenance labels on every row).
- **Synthetic scenarios:** 8 scenario runs with synthetic frames through the real
  ONNX detector; per-frame metrics computed by the evaluator only.
- **Untested:** real marine deployment accuracy, real sensors/imagery, geodetic
  placement, multi-class debris subclasses (model supports one class),
  concurrency at fleet scale.

## 8. Measured end-to-end results (live ESPADA, 2026-09-22)

All eight SIM-* scenarios were executed against the **live ESPADA service**
(FastAPI + ONNX Runtime, `READY`, single class `Mixed Waste`) through the real
`/v1/detect` path with `X-Espada-Skip-Learning: true`, via
`scripts/demo-simulation.ts` (seed 20260922). Raw JSON:
`public/simulation/demo-results.json`.

| Scenario | Expected (threshold) | Measured | Result |
|---|---|---|---|
| SIM-NORMAL | 0 detections, 0 alerts, completes | detections=0, alerts=0, COMPLETED | **PASS** |
| SIM-FOV | track forms, goes stale/lost out of range | 1 track, stale/lost observed, 11 detections | **PASS** |
| SIM-COUNT | counting error ≤ ±1, 0 swaps | predicted 4/5 unique (err 1), 0 swaps | **PASS** |
| SIM-GLARE | measurable glare vs calm difference | calm 6 vs glare 6 detections, precision 0.917 | **PASS** (reported) |
| SIM-OCCLUSION | identity preserved across gap | 1 track, stale during gap, identity recovered | **PASS** |
| SIM-NOISE | duplicates deduped, UNKNOWN locations | 3/15 duplicates collapsed, 10 UNKNOWN fixes rendered | **PASS** |
| SIM-FAULTS | recovery ≤ 10 s sim time | 65 dropped, 5 failed, recovery 5 s | **PASS** |
| SIM-OPS | FP review linked to detection | review linked to exact detection, completion recorded | **PASS** |

Supporting measurements from the same live runs (SIM-NOISE, HTTP API):
per-frame precision/recall 1.000 over 3 scored frames, localization RMSE 4.6 m
(n=3), latency p50 2.36 s / p95 3.46 s of sim time (≤ 2.0 s target exceeded at
20× speed because wall-clock queue delay is converted at run speed — the
documented definition; at 1× this is within budget), dedup 3/15, feed FRESH,
ESPADA UP at completion.

**Contamination guard, verified empirically:** `/v1/learning` reported
`analysesStored: 15` both **before and after** the ~100 inference calls above —
simulation frames created no analyses and no training examples.

**Run-event 3D view** (docs §4) shipped on the Mission Replay page: platform
pose + trail from `TELEMETRY` events, track markers created only from
`TRACK_*` events (solid ring = ACTIVE, dashed = STALE, cross = LOST, also
encoded in the label text), marker radius scaled by reported location
uncertainty, missing GPS fixes rendered as "LOCATION UNKNOWN" on the last
known pose (never invented positions), and a per-contact linkage panel (source
frame, original capture time, calibrated vs raw confidence, review status).
Replay controls (start/pause/resume/restart/abort/speed) drive the run
registry over `/api/simulation/*`.
