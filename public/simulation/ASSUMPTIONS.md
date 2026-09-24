# Assumptions & Missing-Input Register

> Historical assumptions for the imported standalone replay dataset. The current OceanGuard AUV simulation has a separate event/sonar path in `src/server/simulation.ts`. Do not apply these old surface-only assumptions to new AUV runs.

This package is a **standalone simulation**, built without access to the real
OceanGuard repository. Everything below is either a documented default this
package chose, or a gap that is explicitly left open rather than silently
filled in.

## Simulation defaults used (as instructed)

| Parameter | Default used | Status |
|---|---|---|
| Region | Offshore study area near Chennai, India | **Unverified placement.** Origin (13.02N, 80.34E) is based on general knowledge of the Chennai coastline, not checked against a coastline/bathymetry dataset. This environment's network access is limited to a small allow-list of package/code registries (PyPI, npm, GitHub, crates.io, Ubuntu archives) and does not reach GIS or coastline-data providers, so no such check was possible. The **local ENU grid is authoritative**; lat/lon is a display convenience derived from it (see `oceanguard_sim/coordinate_utils.py`). |
| Mission | 30-minute (1800s) surface-debris survey, simulated camera-equipped platform | As specified. Lawnmower survey pattern, 5 legs x 700m, nominal speed ≈2.14 m/s (derived so one full survey completes in exactly 1800s). |
| Time | Storage in UTC, display timezone Asia/Kolkata | As specified. `timezone_display` is a label only -- all timestamps stored are UTC ISO 8601. |
| Sampling | Telemetry 1 Hz; imagery sampling configurable | Telemetry sampled every 1s (`telemetry_hz=1.0` in config.json). Imagery/frame sampling is not a per-second full-video capture in this package -- see "What this package does NOT do" below. |
| Resources | CPU-only preparation/replay; 500 MB output budget | Confirmed: the generated sample is ~2 MB (see `validation_report.md`, "Output budget" section). No GPU-only code paths are used anywhere. |
| Live feeds / private imagery | Unavailable unless supplied | Confirmed unavailable. `inference_adapter/espada_adapter.py` stays disconnected by construction; `espada_dataset/importer.py` only imports images you explicitly point it at. |
| Visual class | Provisional `Mixed Waste`, class_id 0 | Mirrors what was previously reported for the real repository's `ai_service/models/classes.json`, but **not checked against that file in this session** -- the repository was not available. Marked `"verified_against_repository": false` in `espada_dataset/classes.json`. |
| Scope | Surface monitoring only | Confirmed. No underwater/sonar tables, fields, or synthetic data exist anywhere in this package. |

## Scenario windows (fixed, seeded, documented in `oceanguard_sim/scenarios.py`)

| Scenario | Window (sim seconds) | What it does |
|---|---|---|
| `debris_appearance` | 600-605 | OBJ-0004 first appears mid-mission rather than at t=0. |
| `repeated_observation` | 200-260 | OBJ-0002 sits close to the survey path, producing ~15 consecutive detections in one track. |
| `occlusion` | 900-960 | OBJ-0003 is in range but every would-be detection in this window is deliberately suppressed -- it ends up with **zero** detections and no track row. This is expected, not a data-quality defect. |
| `gps_noise` | 1100-1160 | Platform GPS error process's target std jumps from 2.5m to 15m, plus one single ~20m position discontinuity at t=1130. A documented ~40s settling tail after t=1160 is allowed for before residuals must return to nominal (GPS error doesn't reset instantly; see `oceanguard_sim/validate.py`). |
| `delayed_event` | 1300 (instant) | A standalone demo alert (`delayed_event_demo`), not tied to any detection, with `ingestion_time_utc` ~45s after `event_time_utc`. |
| `feed_interruption` | 1500-1560 | No telemetry, environmental, or detection rows exist for this window at all -- an intentional sequence-number gap, not corrupted data. |

## Other documented assumptions

- **Detection model**: range-only (≤20m camera_detection_range_m) with a flat 0.85 per-second detection probability while in range. No field-of-view/heading cone is modeled -- a documented simplification, not a claim about a real camera's coverage.
- **Bounding boxes**: derived from a simple range/bearing heuristic (closer → bigger box; relative bearing → left/right position), not a calibrated camera projection. Marked `provenance="derived_estimate"` everywhere, never presented as ground truth a real camera produced.
- **Environmental readings** (wave height, wind, turbidity, visibility): smooth synthetic functions of time, explicitly "assumption-driven, not measured" per row.
- **Object placement**: 5 hand-placed simulated objects, timed against the survey path so each lands in its intended scenario window. Positions are otherwise arbitrary.
- **GPS error model**: mean-reverting (AR(1)) process rather than independent per-second noise, because real GNSS fixes are smoothed/correlated and i.i.d. noise at multi-metre accuracy would imply physically nonsensical frame-to-frame speeds for a ~2 m/s survey platform. This is a modeling choice made to keep the "physically consistent movement" requirement satisfiable, not a claim about any real receiver's error spectrum.
- **Class mapping**: single class, `0: "Mixed Waste"`, kept intentionally minimal and explicitly unverified (see `espada_dataset/classes.json`).

## What this package does NOT do (missing inputs, left as gaps)

- **No real imagery of any kind.** No licensed marine-debris image dataset was downloaded -- this environment's network allow-list does not include general image-hosting or dataset domains (e.g. Flickr-hosted TACO images). See `espada_dataset/missing_imagery_report.md`.
- **No real OceanGuard repository access.** Class mapping, DB schemas, YOLO writer conventions, and the 3D scene's actual data contract are all unverified against the real code. See `INTEGRATION_CHECKLIST.md`.
- **No camera calibration** (intrinsics, extrinsics, lens distortion, mounting geometry) exists anywhere in this package. Bounding boxes are a heuristic, not a photogrammetric result, and no 3D position is ever derived from them.
- **No real ESPADA inference.** `inference_adapter/espada_adapter.py` raises `NotConnectedError` until you supply a real endpoint and confirm its response contract.
- **No measured detection accuracy.** There is nothing to score a model against, so none is reported anywhere in this package.
