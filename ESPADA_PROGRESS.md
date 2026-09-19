# Espada v1 continuation checkpoint

> **Latest 2026-09-14:** Backend hardening, fail-closed continual worker snapshotting, optimistic concurrency race testing, and legacy endpoint 410 retirement complete. 24 Python unit tests pass (in 3.98s); 3 dev launcher tests pass; TypeScript and production Vite + esbuild bundles pass without errors. Active pilot: SSDLite320 MobileNetV3 (single class: `Mixed Waste`), self-hosted, 100% owned weights and pipeline. All four tracking files synchronized. Read `BRAIN.md` → Latest checkpoint — 2026-09-14.

> **Latest 2026-09-13:** PAUSED. Read BRAIN.md → Latest checkpoint — 2026-09-13 and IMPLEMENTATION_PLAN.md first; they supersede all notes below. Delegation rules saved in AGENTS.md; monitoring/camera/trainer/launcher improvements saved. TypeScript and both builds passed; 15 Python and 3 launcher tests reported passing. Active low-recall pilot unchanged. Preview services stopped. Remaining tasks and validation gaps are recorded in BRAIN.md.

> **Latest 2026-09-12 checkpoint:** Read `BRAIN.md` → Resume handoff first. Work resumed, a verified limited ONNX litter pilot was activated, and progress was saved again at the usage cutoff (8% remaining on the last check). Monitoring surface rendering, TypeScript, Vite build, and 10 Python tests passed. Further work is paused; do not resume automatically. This supersedes the older notes below.

> **2026-09-12 update:** Work is paused at the user's explicit request. Read `IMPLEMENTATION_PLAN.md` first; its PAUSED checkpoint supersedes this older document. New monitoring code and ML runtime/training changes are saved but not fully verified. Refinement checkpoints are in `training_runs/espada-refined/`, stopped after epoch 5. No new ONNX model was exported or promoted. Local training and preview processes were stopped. Do not resume automatically.

Saved: 2026-09-09 (Asia/Calcutta)

## User requirements captured

- Build a real-time AI for OceanGuard data analysis, object detection, confidence output, and risk analysis.
- It must improve continuously.
- It must work for website visitors after deployment, not only on this laptop.
- The model registry must contain only one model: **Espada**, **version 1**.
- No paid AI API or API key may be used.
- Keep the AI code reusable for another project.

## Completed

- Removed every fake entry from the AI model registry; Espada v1 is the sole model.
- Removed the simulated `/api/ai/infer` behavior. It now returns HTTP 410 instead of fabricated detections.
- Added the standalone `ai_service/` package:
  - FastAPI inference service.
  - ONNX Runtime production inference.
  - PyTorch/TorchVision training code.
  - Standard normalized YOLO-label dataset reader without an Ultralytics dependency.
  - Held-out IoU-0.50 precision, recall, F1, and confidence-calibration bins.
  - ONNX exporter producing `ai_service/models/espada-v1.onnx`.
  - SQLite analysis/review store.
  - Continual-learning worker that creates snapshots, retrains asynchronously, validates candidates, and atomically promotes only improved models.
  - Preservation of live inference while the separate trainer works.
- Added a no-cost deterministic visual-anomaly cold-start mode:
  - It makes the interface testable before trained weights exist.
  - It reports `Mixed Waste` candidates and clearly labels scores as uncalibrated visual-anomaly scores.
  - It is not presented as trained accuracy.
- Added real website integration:
  - Express proxy routes: `/api/ai/status`, `/api/ai/models`, `/api/ai/infer-image`, `/api/ai/feedback`, and `/api/ai/learning`.
  - Image upload with real output, measured latency, normalized boxes, confidence meters, and risk levels.
  - Browser-camera capture and repeated inference every 1.5 seconds.
  - Review actions: confirm, false positive, or corrected class.
  - Latest camera frame can be reviewed after stopping the stream.
- Added bounded storage for unreviewed frames (`OCEANGUARD_MAX_UNREVIEWED_ANALYSES`, default 500); reviewed samples are retained.
- Hardened continual promotion: candidates must exceed the configured held-out F1 threshold and all three artifacts must exist before metadata/classes and, last, the ONNX model are published.
- Added a tested Pascal VOC inspection/conversion tool for the official IWHR dataset. It requires an explicit label mapping, preserves background frames, clamps boxes, creates a deterministic split, and records a manifest.
- Added Docker Compose for the web gateway, inference service, and background trainer. Browser clients need no Python/model installation.
- Isolated all reusable AI implementation in `ai_service/`; it has no frontend imports.
- Removed the unused `@google/genai` package, Gemini capability metadata, and Gemini API-key setup.
- Updated stale YOLO labels in the visible UI to Espada v1 and removed the fabricated performance chart/accuracy claim.
- Rewrote `README.md` and `DEPLOYMENT.md` for the new architecture and no-paid-API policy.

## Verification already completed

- Python syntax compilation passed.
- Eight Python unit tests pass:
  - normalized box clamping;
  - validation-bin confidence calibration;
  - cold-start anomaly detection;
  - feedback persistence.
  - candidate improvement/rejection;
  - complete atomic candidate publication;
  - safe continual-learning snapshot selection and hard negatives;
  - VOC label inspection and normalized-box conversion.
- TypeScript `pnpm run lint` passed before the final camera-review/confidence-label tweak.
- Production `pnpm run build` passed.
- TypeScript and a fresh production build passed again on 2026-09-09 after the dataset/continual-learning additions.
- Docker Compose structure, build contexts, dependency, healthcheck, and internal AI URL were statically validated. Docker is not installed on this host, so an actual container build remains unverified here.
- Direct Espada API smoke test passed:
  - `/v1/model` returned `BOOTSTRAP`, `ready: true`, model `Espada`, version `1`.
  - `/v1/detect` returned real deterministic candidates and measured latency.
- Express gateway smoke test passed for model status, the single-model registry, binary image inference, corrected-label feedback, and learning statistics.
- Browser review passed for the registry and test screen. Both rendered cleanly and showed Espada as the only model.

## Important current truth

- `ai_service/models/espada-v1.onnx` does **not** exist yet because no representative labeled marine-debris dataset was supplied.
- The selected public training source is IWHR_AI_Lable_Floater_V1 (Apache-2.0; 3,000 annotated images). Its two archives total about 2.2 GB. The first archive download is resumable at `datasets/_downloads/IWHR-package1.zip`, but only about 2 MB has arrived because this host's Figshare transfer is extremely slow.
- Espada therefore runs in clearly marked `BOOTSTRAP` mode. This is suitable for trying the workflow and collecting reviewed candidates, but it is not yet a trustworthy class-specific learned detector.
- Validation metrics intentionally display `Awaiting validation`; no scores are invented.
- The model/API software is free and self-hosted. A cloud provider may still charge for CPU, GPU, storage, or bandwidth.

## Current local trial state

- Python virtual environment: `.venv/` (ignored by Git).
- Open-source runtime requirements are installed there.
- Espada was started on `http://127.0.0.1:8000`.
- OceanGuard was started on `http://localhost:3000`.
- The in-app browser is on `/data` and authenticated from an existing demo session.
- The gateway integration test created two stored analyses and one corrected review in `ai_service/data/`. This is disposable test data and should be cleared before a pristine user trial.

If the local processes are no longer running, restart them in separate terminals:

```powershell
.\.venv\Scripts\python.exe -m uvicorn ai_service.app.main:app --host 127.0.0.1 --port 8000
pnpm run dev
```

## Exact next starting point

1. Resume both official IWHR archives into `datasets/_downloads/`, extract them to `datasets/iwhr_raw`, inspect their actual labels with `prepare_voc --inspect`, and write the explicit label map.
2. Convert the dataset, review capture groups to prevent train/validation leakage, then train and export Espada using `ai_service/training/README.md`.
3. Do not publish accuracy until held-out validation results exist. Inspect class balance, precision, recall, F1, calibration, and representative false positives before promotion.
4. When Docker is available, build/start the complete Compose stack and repeat status/inference/feedback through port 3000.
5. Run a staged end-to-end continual retraining cycle with enough fully reviewed samples, confirming a worse candidate is rejected and a genuinely improved ONNX candidate hot-reloads.

## Main changed files

- `server.ts`
- `src/lib/api.ts`
- `src/types/index.ts`
- `src/pages/AIModels.tsx`
- `src/pages/DataIngestion.tsx`
- `src/components/ai/DetectionOverlay.tsx`
- `ai_service/app/bootstrap.py`
- `ai_service/app/core.py`
- `ai_service/app/learning.py`
- `ai_service/app/main.py`
- `ai_service/app/model.py`
- `ai_service/training/*`
- `datasets/README.md`
- `ai_service/tests/test_espada.py`
- `ai_service/Dockerfile`
- `ai_service/Dockerfile.trainer`
- `docker-compose.yml`
- `README.md`
- `DEPLOYMENT.md`
- `.env.example`
- `.gitignore`
- `.dockerignore`
- `package.json`, `pnpm-lock.yaml`, `bun.lock`
- `metadata.json`

## Design/technical rationale to preserve

- Do not update live weights from raw camera frames. Only reviewed examples may train a candidate.
- Keep inference and training in separate processes so real-time service remains stable.
- Publish metadata/classes before atomically replacing the ONNX file; inference watches the ONNX modification time.
- Do not train from partially reviewed frames: an unreviewed prediction is not proof of background.
- Keep cold-start anomaly scores visibly distinct from calibrated learned-model confidence.
- Keep the browser talking to the Express gateway, never directly to the internal Python service.
