# OceanGuard project brain

This file is the short, persistent working memory for the project. Read it first when resuming; use `IMPLEMENTATION_PLAN.md` for the detailed checklist. Update both before stopping. Evidence and measured results take precedence over older plans.

## Current instruction

User resumed work on 2026-09-12 and explicitly supplied multi-agent delegation instructions. The full instructions are saved in `AGENTS.md` and apply to future work in this repository. Delegate useful independent tasks with bounded context and disjoint file ownership; select lighter models for simple work, standard coding models for implementation, and stronger reasoning for difficult work. Use independent verification for important changes. The main agent integrates, tests, reviews, and remains responsible. Avoid trivial delegation and repeated retries without a changed approach.

PAUSED on the user's final instruction to wind up fast. Latest cutoff was **20% remaining**, explicitly replacing 40%. Do not resume automatically, redeem credits or create automations. Delegation preferences remain in AGENTS.md.

Latest resumed-session usage check: five-hour window 10% used / 90% remaining; weekly window 31% used / 69% remaining. Check fresh usage at milestones and more frequently near the threshold. Account usage is shared, so it can change outside this task. Stop implementation at the threshold, checkpoint, and stop task-owned processes.

## Latest checkpoint — 2026-09-14 (supersedes historical notes below)

### Backend Hardening, Concurrency Testing & Frontend Truth/Provenance Pass Complete

- **Resolved all 6 follow-up items from 2026-09-13 checkpoint:**
  1. *Whole-frame concurrency & rollback verified:* Implemented `test_frame_review_concurrency_race_condition` running concurrent ThreadPoolExecutor reviews on the same frame. Exactly one commits revision 1, while the other raises `RevisionConflictError`, validating SQLite WAL optimistic concurrency.
  2. *Worker fail-closed on corrupt/missing data:* Hardened `create_dataset_snapshot` in `ai_service/training/continual_worker.py` with explicit PIL image verification (`img.verify()`), safe JSON parsing of detections/boxes, and valid class lookup. Exercised and verified via `test_worker_fails_closed_on_corrupt_and_missing_data`.
  3. *Pruning preservation confirmed:* Confirmed pruning logic in `learning.py` purges unreviewed frames while strictly preserving reviewed analyses and legacy feedback rows.
  4. *Gateway validation error formatting cleaned:* Express gateway in `server.ts` now strips Pydantic "Value error, " prefixes, joins array-shaped 422 detail items cleanly, and provides structured `details: payload.detail`.
  5. *Response type fields reconciled:* Standardized gateway auth failure message to `{ message: 'Invalid or expired session' }` matching frontend `api.ts`. Updated offline model status defaults to match the active pilot (`SSDLite320 MobileNetV3`, 320 input size, 0.25 threshold).
  6. *Legacy per-box endpoint retired:* `POST /v1/feedback` and `POST /api/ai/feedback` now return HTTP 410 Gone with explicit direction to `PUT /v1/analyses/{analysis_id}/review`. Verified via unit and integration tests.
- **Frontend Truth & Provenance Deployed Across All Target Pages:**
  - Added reusable `DataProvenanceBadge` (`src/components/ui/DataProvenanceBadge.tsx`, exported from `Badge.tsx`) with statuses `LIVE`, `SAMPLE`, `USER PROVIDED`, `UNAVAILABLE`.
  - `src/context/SystemContext.tsx`: Eliminated hardcoded fake telemetry fallbacks (`debrisDetected: 1284`, `camerasOnline: '14/15'`, `activeAlerts: 7`), defaulting to `null` and setting `isOnline: false` on fetch errors.
  - `src/components/layout/Sidebar.tsx`: Grouped navigation into `Observe`, `Analyze`, `Respond`, `Admin`; added accessible titles/labels; fixed route prefix collisions; replaced fake fallback numbers with honest `'—'`.
  - `src/pages/Landing.tsx`: Purged fake claims (14.8M transformer, 99.4% recall, 428 gliders, 16-band glint suppression); accurately documented the self-hosted Espada v1 SSDLite320 MobileNetV3 pilot with verified TACO benchmark numbers (494 train / 200 val).
  - `src/pages/CommandCenter.tsx`: Rendered honest `'—'` and telemetry unavailable warnings when disconnected; labeled all metric cards with provenance badges.
  - `src/pages/EnvironmentalAI.tsx`: Added persistent `SAMPLE ANALYTICS` badges and updated model capability descriptions.
  - `src/pages/Reports.tsx`: Replaced silent fallback demo with honest `ErrorState` + retry; added explicit "Preview Sample Report" action with `SAMPLE` badge; labeled history as `SAMPLE ARCHIVE`.
- **Integrity Checks Passed:**
  - TypeScript (`tsc --noEmit`): 0 errors.
  - Vite production build + esbuild `server.ts` bundle: 0 errors.
  - Dev launcher test suite (`scripts/dev.test.mjs`): 3/3 tests pass.
  - Python test discovery (`ai_service/tests`): **24 tests pass** in 3.98s.
- Source is local, saved, and uncommitted. No training was initiated and no deployment was made. Operational data is protected.

## Historical checkpoint — 2026-09-13

### Emergency wind-up — user reported quota near 20%

- Stopped immediately on the user's instruction; no deployment, training, model promotion, or sibling-copy sync.
- Monitoring workstream completed code-level hardening: init-failure WebGL cleanup, guarded reduced-motion detection, bounded camera/target/zoom, corrected NET-01 wave depth, live camera-heading compass, and <=360px camera-bar compaction. TypeScript and Vite build passed. Root visual browser QA remains outstanding.
- Espada gateway milestone completed: configurable upstream timeouts and a black-box isolated real PNG upload -> Express -> FastAPI bootstrap inference -> SQLite frame review test, including corrupt, oversized, offline, and timeout cases. Operational `ai_service/data` is byte-for-byte protected by the test.
- Atomic whole-frame review is now implemented across FastAPI, SQLite, Express, worker selection, and the frontend editor. Reviewers can resolve predictions, drag/resize boxes, draw missed objects, explicitly approve empty frames, and commit one optimistic/idempotent revision. Legacy per-box feedback is retained but excluded from committed learning.
- Final integrity checks before wind-up: TypeScript passed; Vite production build passed (expected Three.js chunk warning); Python discovery passed **16 tests**, including the real gateway integration. The interrupted backend agent's independent review identified additional hardening still needed (below).
- Known follow-ups before treating frame review as production-hardened: add a complete validation/rollback/concurrency matrix for the whole-frame transaction; fail closed on malformed committed worker rows instead of silently skipping them; confirm pruning preserves legacy feedback-bearing analyses; improve gateway rendering of FastAPI array-shaped validation errors; reconcile all response type fields; retire or return 410 from the legacy per-box endpoint; visually exercise the annotation editor at desktop/mobile sizes and visually recheck Monitoring.
- No preview or test services should remain. Source is local, saved, and uncommitted.

- Saved user's complete delegation instructions verbatim in AGENTS.md and applied them with separate backend implementation and integration review agents. Root integrated/reviewed the work. Everything remains local, saved and uncommitted; no deployment or new training/promotion this session.
- Monitoring: softer lighting, distant-wave filtering, animated underwater ceiling, seabed light patterns, camera medium/floor constraints, compact contacts and fullscreen sizing. Header explicitly says sample mission. Visually verified surface, underwater, sonar, drum selection/inspection and 390x844 mobile layout; no captured browser errors. Dev preview works. Procedural graphics still need realism/performance refinement (observed roughly 15–60 FPS, not a stable benchmark).
- Camera: each result retains the exact analyzed image and overlays boxes on that image. Stopped-camera review keeps the captured frame. Requests abort on stop/cleanup, busy state is session-local, duplicate starts guarded. Real hardware camera flow remains untested.
- Espada: actual ONNX evaluation updates candidate metrics/calibration with model/checkpoint hashes. Complete bundles are checked and smoke-run before atomic publication. Long subprocesses refresh trainer heartbeat; stale TRAINING expires; edits to processed feedback trigger learning via ID/content revision cursor.
- Launcher: strict health identity throughout startup, named supervisor, no late spawns after stopping, unexpected exits fail nonzero, awaited Windows owned-tree teardown. scripts/dev.mjs and scripts/dev.test.mjs.
- Checks: root TypeScript, Vite frontend build and Express/esbuild server bundle passed. Backend agent reported 15 Python tests plus compile/diff checks passed; launcher agent reported 3 Node tests plus syntax/diff checks passed. Redundant repeat Python tests hung at teardown and were interrupted; no matching unittest process remained in final process inspection.
- Active model unchanged: ai_service/models/releases/20260912T174755-1789235275137599000/ includes checkpoint.pt. Precision .353081, recall .231366, F1 .279550 on 200 general-litter images; only Mixed Waste. Low recall, no marine validation. Artifacts ignored by Git; preserve separately.
- Implementation stopped at 26% remaining to reserve checkpoint room; the next quota reading during cleanup had fallen to 10% remaining. User also reported 12% and requested immediate winding up. No more implementation after that request. Quota checks lag/change quickly; future runs must reserve substantially more margin and avoid redundant agent test runs.
- Verified preview root PID22540 (node scripts/dev.mjs) and its descendants 23728/21484 (uvicorn), 34604/29120 (web) were terminated successfully via taskkill /T. Do not kill processes by start time alone: an agent initially misattributed the preview Python PIDs to tests. Browser mobile viewport override was reset. All agents finished.

Remaining work, in order:

1. Isolated actual binary upload → Express → inference → feedback persistence integration checks, with invalid image/size/offline/timeout cases. Do not write test feedback to operational storage.
2. Real camera verification with permission, delayed inference and rapid restart. Handle track-ended/hardware revocation; separate model-status errors from liveError. Add bounded multi-file upload concurrency.
3. Missed-object annotation and corrected boxes across UI/API/storage/training. Current feedback only reviews predicted boxes; missed debris cannot enter learning, limiting recall improvement. Keep limitation visible.
4. Real candidate validation/promotion/rejection in isolated storage. Expand threshold/calibration/output-shape schema checks and fixed base-class mapping; prevent near-duplicate/cropped holdout leakage. Current release DOES contain checkpoint.pt. No real candidate was trained/exported in this session.
5. Monitoring: all presets/orbit/pan/zoom bounds, pause/waves/labels/fullscreen and route lifecycle QA; cleanup if initialization throws before controller creation; mobile framing, compass orientation, seafloor contact seating, horizon/boat realism.
6. Actual revised Windows launcher startup/shutdown with worker grandchildren. Non-Windows teardown currently handles direct children only. Update README/DEPLOYMENT/training docs; fresh Docker remains unverified.

## Product goals and boundaries

- Make the monitoring scene visually convincing: natural ocean, boat, marine debris, atmosphere, underwater visibility, useful camera and contact controls.
- Keep sample data labeled. There is no live maritime feed, measured bathymetry, thermal sensor or 3D detection localization configured.
- Make Espada a working self-hosted ML detector with local weights, training code, feedback storage, and automated candidate evaluation/promotion. No paid inference API or API key.
- Preserve the name Espada, version 1, as the only registry entry.
- Ownership means the user controls the code, checkpoints, data and hosting. Disclose TorchVision initialization and public dataset provenance; do not claim an original foundation model or validated marine accuracy.
- Autonomous inference/learning must not turn unreviewed predictions into training truth. Human review supplies labels; validated candidates can replace the incumbent.
- Do not deploy, overwrite the separate upload copy, or claim the public website is fixed without verifying hosting and its AI service.

## Workspace

- Active source: `C:\Users\alonso\Documents\ocean guard\OceanGuard-main`.
- Sibling `oceanguard-vercel-upload` is a separate copy; do not silently synchronize it.
- Current edits are saved but uncommitted. Preserve existing work.
- Stack: React / TypeScript / Vite / Three.js; Express gateway; Python FastAPI / ONNX Runtime; PyTorch / TorchVision training; SQLite feedback.
- Python executable: `.venv/Scripts/python.exe`.
- Direct TypeScript check: `node node_modules/typescript/bin/tsc --noEmit`.
- `pnpm run` previously tried reinstalling dependencies because of the host pnpm wrapper; direct local binaries avoided that issue.
- The Windows sandbox previously blocked Vite's dependency resolution. Approved execution outside the sandbox worked. Scope escalations to the required local build/preview command.

## Saved state on resume

### Monitoring

Files: `src/pages/Monitoring.tsx`, `src/pages/Monitoring.css`, `src/components/monitoring/oceanScene.ts`.

Implemented but not visually verified: reflective Three.js Water, procedural normal slopes, Sky atmosphere, islands, custom detailed hull/deck/windows/railings, weathered textures, debris models, surface/underwater/sonar modes, camera presets, selected-contact inspection, motion/waves/zoom/fullscreen controls, sample labels.

Known unfinished issues: dev preview was blank; production preview not inspected; water geometry is flat while objects bob; seabed contacts may not rest on the actual terrain; need browser verification, responsive checks, lifecycle cleanup and actual shader checks.

### Espada

- Runtime still falls back to deterministic anomaly mode because no trained ONNX artifact has been exported/promoted yet.
- Initial pilot: 156 train / 57 validation TACO images, 12 epochs. Final F1 .2168 (weak).
- Expanded dataset: 494 train / 200 validation images. 694 successful public downloads of 1,000 attempts; 306 unavailable. `datasets/taco/manifest.json` records sources and capture-batch holdout.
- Refinement stopped after epoch 5 of 15. Epoch-5 precision .4712, recall .2034, F1 .2842 at IoU .50 / threshold .25. These are general-litter results, not marine validation.
- Saved `training_runs/espada-refined/best.pt`, `last.pt` (~18 MB each), and `training_runs/refinement.log`. Inspect checkpoint metadata before choosing the model. No final metrics.json from the interrupted refinement.
- One supported learned class: `Mixed Waste`. Do not present the old eleven-class list as learned capabilities.
- SSDLite320 MobileNetV3 is initialized from TorchVision COCO and fine-tuned locally. The current resume option restores weights only; optimizer/scheduler restart.

Recent unverified changes: bounded API timeouts, ONNX input shape discovery, image orientation/size handling, inference off FastAPI's event loop, retained incumbent session on failed reload, trainer status UI, immutable release directory plus atomic `current.json` pointer, checkpoint continuation, same-holdout incumbent evaluation, reviewed frames restricted to training.

Known follow-ups: existing publication test expects old flat files; Docker base dataset points to marine_debris rather than taco; training heartbeat can become stale; validation reuploads can contaminate training; calibration labels require review; release/checkpoint/metadata must agree; tests and final build need rerunning.

## Working order

1. Inspect current diff and run appropriate checks. Fix broken tests and actual runtime issues.
2. Get a reliable local preview; visually inspect monitoring and fix realism, camera, resizing and accessibility problems.
3. Inspect saved checkpoints, export a candidate and compare PyTorch/ONNX outputs on real held-out imagery. Improve training only when justified by measured errors and available budget.
4. Make model availability, learned scope, validation metrics and learning status accurate in the UI. Verify upload → boxes → review → persistence through Express.
5. Harden continual learning/promotion and exercise rejection/valid promotion without polluting operational feedback with test data.
6. Update docs, run final scoped checks, checkpoint at the usage threshold or completion. Record exactly what remains unverified.

## Session log

### 2026-09-12 resumed session

- Created this file before new implementation work.
- Read the paused implementation checkpoint.
- Confirmed 47% five-hour and 77% weekly usage remaining at start.
- No processes have been restarted yet in this resumed session.

## Resume handoff

Status: RESUMED by the user on 2026-09-12. The handoff below records the previous checkpoint; current instructions above supersede its usage cutoff. Delegation preferences are persisted in `AGENTS.md`.

Latest usage: five-hour 92% used / **8% remaining**, weekly 29% used / 71% remaining. The last two checks moved from 13% to 8% remaining. Implementation stopped as soon as that reading arrived; only checkpointing and process shutdown followed.

Completed this session:

- Created this file first. Source edits remain saved and uncommitted.
- Production monitoring now renders in the browser, approximately 30 FPS, with no captured errors. Added real vertex wave displacement matching boat motion, changed sun position/specularity, placed drum/tire/rocks on the terrain, corrected underwater camera presets, and removed deprecated shadow filtering. Final surface screenshot was visually inspected. It remains a procedural sample scene; horizon glare/boat detail can still improve.
- TypeScript passes. Vite production build passes (expected large Three.js chunk warning). Python suite: **10 tests pass**, including retained incumbent on invalid candidate metadata, complete release-pointer switching, and rejection of invalid metrics.
- Exported the saved epoch-3 best checkpoint and verified PyTorch/ONNX parity on **8 real validation images**. Re-evaluated deployed preprocessing across **200** held-out images: precision **0.353081**, recall **0.231366**, F1 **0.279550**, 149 TP / 273 FP / 495 FN, raw threshold .25 and IoU .50.
- Activated this as a clearly described **limited general-litter pilot** with one `Mixed Waste` class. It is NOT production-quality marine detection. No training resumed in this session.
- Active bundle: `ai_service/models/releases/20260912T174755-1789235275137599000/`, selected by `ai_service/models/current.json`. Contains ONNX, classes, metadata, `verification.json`, and the owned `checkpoint.pt`. These artifacts are ignored by Git: preserve/back them up separately.
- Direct inference loaded ONNX at 320x320; sample `1302.jpg` returned 0 candidates in 8.57 ms. This confirms execution, not detection correctness. Gateway `/api/ai/status` returned READY, ONNX Runtime, Mixed Waste, input 320, and the pilot limitation notice.
- Corrected candidate/incumbent comparison to evaluate both ONNX files with the same Pillow preprocessing. Added exact decoded-image deduplication against validation images, fixed waiting trainer-state persistence, and updated Docker's base dataset to taco.
- Stopped the local web listener PID 24472 and reused Espada listener PID 10228; ports 3000/8000 no longer showed listeners. No training process was started.

Next work, only after the user resumes:

1. Test underwater/sonar, contact selection, pause/zoom/fullscreen, responsive/mobile sizing and route cleanup; only the surface view was visually verified this session. The contact panel needs scrolling on a 720px-high viewport.
2. Add gateway binary upload → detection → feedback integration coverage in isolated test storage; check the real camera flow with permission. Gateway status alone has been verified after activation.
3. Resolve trainer heartbeat during long training, update handling for changed existing reviews, near-duplicate/cropped validation leakage, checkpoint/metadata schema checks, and bundle validation before publication. Exact validation reuploads are excluded; near-duplicates are not.
4. Propagate actual ONNX evaluation/calibration back into candidate metadata before automatic promotion; the worker now compares the correct ONNX F1, but exported metadata/calibration can still describe PyTorch evaluation. Test both candidate promotion and rejection end to end.
5. Improve model quality with measured error analysis and representative marine labels. The active pilot has low recall and must not be presented as a reliable autonomous marine agent.
6. Update README/DEPLOYMENT and training docs for active release bundles, checkpoint ownership and restart commands. Full Express bundle build and fresh Docker runs remain unverified; Vite frontend build and TypeScript passed.
7. Inspect preview startup/shutdown ownership: production preview works; dev mode after the prior blank screen has not been reverified. Restart the full stack with `node scripts/dev.mjs` from the project directory. Verify services actually stop, including the Windows venv child process.
