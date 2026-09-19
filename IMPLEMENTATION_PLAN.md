# OceanGuard realism and Espada implementation plan

Updated: 2026-09-14

## Current checkpoint — 2026-09-14: Backend Hardening & Frontend Truth Pass Complete

**Latest Status:** All core follow-up items from the 2026-09-13 checkpoint have been implemented and verified end-to-end.
- **Backend & Gateway Hardened:**
  - Retired legacy per-box review endpoint `POST /v1/feedback` and `POST /api/ai/feedback` with HTTP 410 Gone and descriptive guidance to `PUT /v1/analyses/{analysis_id}/review`.
  - Hardened `create_dataset_snapshot` in `ai_service/training/continual_worker.py` to fail closed on missing/corrupt images, malformed JSON, or unknown class names.
  - Added optimistic locking concurrency race test (`test_frame_review_concurrency_race_condition`) verifying SQLite WAL behavior: exactly one reviewer commits revision 1, concurrent updates raise `RevisionConflictError`.
  - Added worker fail-closed test (`test_worker_fails_closed_on_corrupt_and_missing_data`) and legacy feedback 410 test (`test_legacy_feedback_endpoint_returns_410_gone`). Total Python unit tests: **24 tests passing** in 3.98s.
  - Standardized gateway auth error to `{ message: 'Invalid or expired session' }` (matching `api.ts`), cleaned FastAPI array-shaped validation errors in `server.ts`, and reconciled offline model status defaults (`SSDLite320 MobileNetV3`, input size 320, threshold 0.25).
- **Frontend Truth & Provenance Deployed:**
  - Implemented reusable `<DataProvenanceBadge />` component (`src/components/ui/DataProvenanceBadge.tsx` and re-exported from `Badge.tsx`) supporting `LIVE`, `SAMPLE`, `USER PROVIDED`, and `UNAVAILABLE` statuses with accessible tooltips and `role="status"`.
  - Purged hardcoded fake metrics from `src/context/SystemContext.tsx` (`1284`, `14/15`, `7`, etc.) replaced with honest `null`, setting `isOnline: false` on failed fetch.
  - Reorganized navigation in `src/components/layout/Sidebar.tsx` into 4 semantic groups (`Observe`, `Analyze`, `Respond`, `Admin`), added accessible names/tooltips, fixed route prefix collision (`item.path + '/'`), and replaced fallback counters with `'—'`.
  - Overhauled `src/pages/Landing.tsx`: eliminated all unsupported claims (14.8M transformer, 99.4% recall, 428 gliders, 16-band live ingestion) and truthfully presented the active Espada v1 SSDLite320 MobileNetV3 pilot with verified TACO metrics (494 train / 200 val) and 100% self-hosted ownership.
  - Hardened `src/pages/CommandCenter.tsx`: added honest `'—'` indicators, provenance badges on all metric cards, and honest telemetry warnings when offline.
  - Hardened `src/pages/EnvironmentalAI.tsx`: added persistent `SAMPLE ANALYTICS` badges and updated model capability descriptions.
  - Hardened `src/pages/Reports.tsx`: replaced silent fallback demo on API failure with honest `ErrorState` + retry, separated sample report preview with `SAMPLE` badge, and marked history as `SAMPLE ARCHIVE`.
- **Build & Test Verification:**
  - `node node_modules/typescript/bin/tsc --noEmit`: 0 errors.
  - `vite build` + `esbuild server.ts`: production builds passed cleanly.
  - `node scripts/dev.test.mjs`: 3/3 tests passed.
  - `python -m unittest discover -s ai_service/tests`: 24/24 tests passed.
- All code is saved locally and uncommitted. Operational `ai_service/data` is protected. No paid AI APIs, no background training started, no changes to sibling `oceanguard-vercel-upload`.

## Latest checkpoint — resumed work paused at usage cutoff

**Read `BRAIN.md` first. Its Resume handoff supersedes the older checkpoint below.** User requested stopping at 10% remaining usage; checks moved from 13% to 8%, so work stopped at the first below-threshold reading. Latest weekly remaining: 71%. Local web/Espada listeners were stopped.

- Monitoring surface now visibly renders at about 30 FPS without browser errors. Water geometry now shares the wave function used for boat motion; lighting, seabed placement and underwater presets were improved. Other modes/mobile/interaction QA remain.
- Latest TypeScript and Vite frontend build pass; all 10 Python tests pass.
- Espada's verified ONNX **pilot is now active**, unlike the older checkpoint below. One class: Mixed Waste. 8-image PyTorch/ONNX parity passed; 200-image ONNX validation: precision 35.31%, recall 23.14%, F1 27.95%. This is weak general-litter performance and is clearly disclosed.
- Active release: `ai_service/models/releases/20260912T174755-1789235275137599000/`; pointer: `ai_service/models/current.json`. Checkpoint and verification report are bundled. Artifact files are Git-ignored and must be preserved separately.
- Direct ONNX execution and Express model-status forwarding passed. Binary gateway upload/feedback, camera, full continual-training cycle and Docker verification remain outstanding.
- No further training was started. All code is saved locally and uncommitted. Follow the exact next steps in `BRAIN.md`; do not automatically restart work.

## PAUSED — user requested saving progress and stopping

**This checkpoint supersedes the earlier in-progress notes below. Do not automatically resume work.**

All source edits are saved locally and uncommitted. Training and local preview services were stopped on the user's request. No deployment or model promotion was performed.

### Saved implementation

- Replaced `src/pages/Monitoring.tsx`; added `Monitoring.css` and `src/components/monitoring/oceanScene.ts`. Surface/underwater/sonar modes, selection, camera presets, wave intensity, pause, zoom and fullscreen are coded.
- Added the local stack launcher, request timeouts, model input-shape loading, retained incumbent session on load failure, image orientation/size handling, inference thread-pool dispatch, trainer status UI and runtime notices.
- Added resume training, fixed original validation holdout, same-holdout incumbent evaluation and atomic release-pointer publication in the continual worker. **These last changes are not yet tested.**
- Limited Vite dependency discovery/watching and Tailwind source scanning to avoid crawling Python/training directories.

### Training artifacts and measured state

- Initial 12-epoch pilot completed: 156 train / 57 validation images, F1 0.2168 at IoU .50 and score threshold .25 in the final epoch. This is weak pilot performance.
- Expanded TACO dataset: **494 train / 200 validation images**, 694 successful downloads of 1,000 attempts; 306 unavailable files. Capture batches separate train and validation.
- Refinement was stopped during its 15-epoch run, after **epoch 5 completed**. Epoch 5 precision .4712, recall .2034, F1 .2842 on 200 held-out images. This is general litter, not marine validation.
- `training_runs/espada-refined/best.pt` and `last.pt` are saved (about 18 MB each). `last.pt` is the completed epoch-5 checkpoint; partial work after that is not saved. Read checkpoint metadata for the best epoch/metrics before resuming. The run did not finish, so its final `metrics.json` may not exist.
- Log: `training_runs/refinement.log`. Dataset and source manifest: `datasets/taco/`.
- **No trained ONNX file has been exported or activated. Espada's inference service is still configured for the old bootstrap fallback.**

### Verification already performed

- `node node_modules/typescript/bin/tsc --noEmit` passed after wiring the monitoring page, before the subsequent runtime/UI/worker edits.
- Vite production build passed (2,315 modules; expected Three.js chunk-size warning), before the final edits. Existing `dist/` should be treated as an intermediate build.
- The local dev launcher successfully started FastAPI, trainer and Express. The first sandbox run failed on filesystem restrictions; the approved local run started.
- The in-app browser at `http://localhost:3000/monitoring` remained blank during inspection, with no captured browser errors; **visual verification is not complete**. A production preview at port 3001 was started but not inspected before the stop request.
- No final Python test run, ONNX comparison, gateway inference/review smoke test or camera test has been performed for these changes.

### First actions when the user asks to resume

1. Read this checkpoint and inspect the uncommitted changes; do not start over or assume the intermediate build is current.
2. Run TypeScript and Python checks, update the existing publication test (it still expects three flat files, while publication now uses `releases/` plus `current.json`), and address any actual failures.
3. Finish runtime review: confidence-bin reporting, concurrent model loading, trainer heartbeat while training, fixed-holdout contamination from re-uploaded examples, and matching Docker settings. The Docker base dataset still points to `marine_debris`; the pilot uses `taco`.
4. Build and inspect the production monitoring view; fix the blank dev preview and visually verify water, boat, controls, mobile layout and cleanup. The analytical water slopes currently affect reflections; the rendered surface geometry is flat while vessel bobbing uses a separate wave-height function. Improve this before claiming fully coupled surface physics.
5. Inspect/restart refinement only on user instruction. Resume from `training_runs/espada-refined/last.pt` into a new run directory. The current `--resume` loads model weights but resets optimizer/scheduler/epoch numbering; it is fine-tuning continuation, not exact interrupted-run recovery.
6. Evaluate model quality honestly, export/compare ONNX, preserve checkpoint in the release bundle, then test real inference and feedback end to end. Do not promote weak/unverified weights as production-ready.
7. Update README, deployment notes and this checklist with verified results.

Stopped services used ports 3000, 3001 and 8000. The user's browser tab may still point at the now-stopped preview.

## User intent

1. Make the 3D monitoring tab look substantially more realistic, including the ocean and objects, rather than a neon diagram with primitive shapes.
2. Make Espada work as a locally owned, self-hosted machine-learning system with autonomous inference and a reproducible improvement pipeline. No paid inference API or API key.
3. Keep this plan on disk so later work can resume without losing decisions or overstating progress.

Active source project: `OceanGuard-main/`. The sibling `oceanguard-vercel-upload/` is a separate upload copy. Do not silently replace it or assume it is the running source.

## Findings before implementation

- Monitoring was a single large Three.js component. The sea was translucent, target geometry was simplistic, and random timers changed fabricated confidence and telemetry. No live maritime sensor feed is configured.
- Espada had inference, feedback storage, training scaffolding and an ONNX runtime, but **no trained model file**. Its working fallback was a deterministic image anomaly detector, not a trained debris classifier.
- Starting the website did not start its Python service. If the service stopped, upload and camera inference failed.
- An earlier IWHR download was incomplete. Public TACO litter imagery is available in smaller individual files, enabling an initial local learned model now. TACO validation is not evidence of offshore/underwater accuracy.

## Implementation sequence and acceptance criteria

### 1. Rebuild the monitoring scene

- [x] Inspect existing rendering, UI, data provenance, and available dependencies.
- [x] Add a separate `src/components/monitoring/oceanScene.ts` renderer with atmospheric sky, reflective water, procedural wave normals, distant islands, physically based boat materials, weathered textures and detailed debris models.
- [x] Replace the monitoring page with a clearer interface that gives the scene most of the screen (coded; visual QA pending).
- [x] Provide surface, underwater and sonar views, useful camera presets, target selection, wave strength, pause, zoom, reset and fullscreen (coded; interaction QA pending).
- [ ] Couple floating objects to the same wave function; keep seabed objects stationary.
- [x] Label the scene as a sample mission. Remove fabricated model confidence, live sensor claims and thermal/bathymetric mode claims.
- [ ] Verify rendering in the actual browser, including mobile layout, mode switches, controls, resizing, and route cleanup.
- [ ] Verify TypeScript and production build; fix shader/runtime failures and obvious visual defects.

Acceptance: a visibly improved ocean scene with working controls, readable UI, responsive sizing, and clear sample-data provenance. A procedural reconstruction cannot substitute for a real camera feed or measured 3D environment.

### 2. Make Espada available and reliable

- [x] Trace the frontend → Express → FastAPI path and identify missing service startup.
- [x] Add a project-local development launcher that starts FastAPI, waits for readiness, starts the trainer, and starts the web server. Reuse a running service and respect an explicitly configured remote URL.
- [ ] Add bounded request timeouts and actionable offline diagnostics.
- [ ] Keep CPU inference off FastAPI's async event loop.
- [ ] Read actual model input shape and metadata; avoid a hard-coded 640 input for a 320 model.
- [ ] Normalize image orientation and handle corrupt/oversized input consistently.
- [ ] Show actual model engine, training scope, learned classes, measured validation and current learning state.
- [ ] Test upload → boxes → review → persistent feedback through the Express gateway.
- [ ] Verify camera UI behavior and report whether actual camera permission/testing was performed.

Acceptance: one local start command brings up a functional website and detector. Real image bytes produce model output, feedback persists, and failures are understandable.

### 3. Train and package owned model artifacts

- [x] Install project-local PyTorch, TorchVision and ONNX training dependencies.
- [x] Add reproducible TACO download/conversion with source manifest and capture-batch-separated training/validation splits.
- [x] Download a pilot subset: **156 training images, 57 validation images**. 87 of 300 attempted public image downloads were unavailable. Preserve this fact in provenance.
- [x] Add an SSDLite320 MobileNetV3 training option, resume support, and configurable training parameters.
- [x] Start a 12-epoch pilot training run using COCO initialization and a new litter head; freeze the backbone for affordable CPU training.
- [ ] Inspect completed training and validation results. Do not assume training completion or useful performance from process startup.
- [ ] Export the best checkpoint to ONNX and compare PyTorch/ONNX outputs on real images.
- [ ] Promote only a complete, working candidate with meaningful held-out detections; retain checkpoint, classes, metadata and provenance.
- [ ] Describe the initial model as a **general litter pilot**. Its single class is `Mixed Waste`; do not claim it distinguishes plastics, nets, metals, animals or marine hazards.
- [ ] Document which code/checkpoint belongs to this project and which open-source initialization/data it derives from. Self-hosted ownership does not mean the base architecture was invented here.

Acceptance: local checkpoint and ONNX artifacts exist, inference works offline after setup, metrics come from actual held-out images, and model limitations are visible. If the pilot is weak, continue improving it or report its measured limitation; never substitute invented scores.

### 4. Make continual learning operational

- [ ] Keep inference and training in separate processes.
- [ ] Resume from the current model checkpoint rather than restarting from generic weights each time.
- [ ] Train only fully reviewed examples; retain hard negatives and original dataset context.
- [ ] Use stable data partitions and compare candidate and incumbent on the same validation set.
- [ ] Reject non-finite, empty, incomplete, non-improving or otherwise invalid candidates.
- [ ] Publish a complete model bundle and hot-reload it while preserving a working incumbent if loading fails.
- [ ] Expose trainer heartbeat, review threshold, last attempt and promotion/rejection in the UI.
- [ ] Test both promotion and rejection and document what has actually been exercised end to end.

Autonomy means automated detection and scheduled candidate training/evaluation. It does not mean teaching the model that all its own predictions are correct. Human review remains the source of new training labels.

### 5. Delivery and deployment

- [ ] Run the appropriate Python tests, TypeScript check and production build.
- [ ] Inspect the finished monitoring view and Espada interface in the in-app browser.
- [ ] Save commands, artifact locations, actual metrics, known limitations and restart steps in this plan and the README.
- [ ] Keep Docker/runtime requirements consistent with the exported ONNX path.
- [ ] Deployment is separate from local implementation. A static/serverless web upload alone cannot provide a persistent Python inference/training service. Do not claim the hosted website is fixed without verifying its configured AI service.

## Current checkpoint / resuming work

New files: `src/components/monitoring/oceanScene.ts`, `scripts/dev.mjs`, `ai_service/training/prepare_taco.py`.

Modified: `package.json`, `ai_service/training/detector.py`, `ai_service/training/train.py`, `ai_service/training/export_onnx.py`.

Training output: `training_runs/espada-pilot/`. Source manifest and images: `datasets/taco/`. Official starting-weight cache: `training_runs/torch-cache/`.

Do not assume an old process is still running. Inspect `training_runs/espada-pilot/metrics.json`, checkpoint timestamps and process output before restarting training.

Training command used:

```powershell
$env:TORCH_HOME = Join-Path (Get-Location) 'training_runs/torch-cache'
.\.venv\Scripts\python.exe -m ai_service.training.train --dataset datasets/taco --classes datasets/taco/classes.json --output training_runs/espada-pilot --epochs 12 --batch-size 4 --workers 0 --learning-rate 0.008 --score-threshold 0.25 --freeze-backbone
```

Next: connect and verify the new monitoring renderer; collect training results; harden runtime/promotion and integrate the resulting model. Update the checkboxes from evidence, not intention.
