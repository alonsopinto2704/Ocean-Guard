# Schema & Data Dictionary

> Historical schema for the imported standalone `mission.json` replay dataset. The current OceanGuard AUV simulation and Espada integration live in `src/server/simulation.ts`; the statements below about an unconnected model apply only to this legacy source package.

**Schema version:** `0.1.0-unverified` (see `oceanguard_sim/schema.py::SCHEMA_VERSION`)
`-unverified` means: written from scratch for this standalone package, not
checked against the real OceanGuard repository's models. See
`INTEGRATION_CHECKLIST.md`.

Every table has a `provenance` column. Values used in this package:
- `synthetic_simulation` -- fabricated for this package, seeded/reproducible
- `simulated_ground_truth` -- the "true" state the simulator itself defines
- `derived_estimate` -- computed from simulated_ground_truth (e.g. a heuristic bbox)
- `model_prediction` -- reserved; **never appears** in this package (no model connected)
- `real_observation` -- **never appears** in this package (no real data exists here)

All timestamps are ISO 8601 UTC with millisecond precision and a trailing `Z`
(e.g. `2026-01-15T02:00:42.000Z`). `sim_time_s` is seconds since mission start.

---

## Part A -- mission dataset (`output/mission_dataset/*.csv`)

### missions.csv
| Field | Type | Unit | Meaning | Null? | Notes |
|---|---|---|---|---|---|
| mission_id | string | -- | stable ID, e.g. `MSN-0001` | no | primary key |
| name | string | -- | human label | no | |
| status | enum | -- | planned/active/paused/completed/aborted | no | this sample is always `completed` |
| mission_type | string | -- | e.g. `surface_debris_survey` | no | |
| region_label | string | -- | e.g. `offshore_chennai_study_area_SIMULATED` | no | |
| start_time_utc / end_time_utc | string | ISO8601 UTC | mission bounds | no | |
| timezone_display | string | -- | display-only, e.g. `Asia/Kolkata` | no | storage is always UTC |
| origin_lat / origin_lon | float | degrees | local ENU frame origin | no | **unverified placement**, see ASSUMPTIONS.md |
| scene_scale_m_per_unit | float | m/unit | always `1.0` here (scene units are metres) | no | |
| axis_convention | string | -- | `"ENU: +x=East(m), +y=North(m), +z=Up(m)"` | no | |
| seed | int | -- | RNG seed used | no | full reproducibility |

### platforms.csv
| Field | Type | Meaning | Null? |
|---|---|---|---|
| platform_id | string | FK target, e.g. `PLT-0001` | no |
| mission_id | string | FK -> missions.mission_id | no |
| platform_type | string | e.g. `simulated_surface_usv` | no |
| name | string | display name | no |

### sensors.csv
| Field | Type | Meaning | Null? |
|---|---|---|---|
| sensor_id | string | FK target, e.g. `SNS-CAM-01` | no |
| platform_id | string | FK -> platforms.platform_id | no |
| sensor_type | enum | `camera_rgb` \| `gps` \| `imu_compass` | no |
| model_label | string | simulated model name (not a real part number) | no |
| sample_rate_hz | float | nominal sampling rate | yes (event-driven sensors) |

### telemetry.csv (1740 rows in the default sample = 1800s - 60s interruption + 1)
| Field | Type | Unit | Meaning | Null? | Valid range |
|---|---|---|---|---|---|
| telemetry_id | string | -- | PK | no | |
| mission_id, platform_id | string | -- | FKs | no | |
| seq | int | -- | monotonic sequence number; **gaps = feed_interruption**, by design | no | see scenario_events |
| event_time_utc | string | ISO8601 | when the sample was "taken" | no | |
| ingestion_time_utc | string | ISO8601 | when it was "received" | no | always ≥ event_time_utc |
| sim_time_s | float | s | seconds since mission start | no | 0-1800 |
| lat, lon | float | degrees | reported position (includes simulated GPS error) | no | |
| altitude_m | float | m | ~0, small simulated wave heave | no | -1 to 1 (heuristic) |
| heading_deg | float | degrees | 0-360, true heading + noise | no | 0-360 |
| speed_mps | float | m/s | reported speed | no | ≥0 |
| roll_deg, pitch_deg | float | degrees | small simulated platform motion | no | |
| location_uncertainty_m | float | m | 1-sigma; inflated during `gps_noise` | no | 2.5 nominal, 15 during gps_noise |
| scenario_type | enum | -- | active named scenario at this instant | no | see scenarios.py |
| provenance | enum | -- | always `synthetic_simulation` | no | |

### environmental_observations.csv
Wave height (m), wind speed (m/s) and direction (deg), visibility class,
turbidity index (0=clear..1=opaque), all `provenance=synthetic_simulation`
with `uncertainty_note="Assumption-driven scenario dressing, not a measurement."`
Sampled every 60s (`env_obs_interval_s`), skipped during feed_interruption.

### object_truth.csv
The simulator's own ground truth -- **a real perception system would not
have this table.** Kept only so this sample is self-checkable.
| Field | Type | Meaning |
|---|---|---|
| object_id | string | PK |
| class_id, class_name_provisional | int, string | provisional class, see `espada_dataset/classes.json` |
| first_appearance_time_utc | string | when the object enters the scenario |
| origin_east_m, origin_north_m | float | ENU position at appearance time |
| drift_east_mps, drift_north_mps | float | 0.0 for static objects |
| provenance | enum | always `simulated_ground_truth` |

### detections.csv
A simulated sensor detection of an object_truth row -- **stands in for
perception-pipeline output but is generated directly from ground truth
plus a visibility/probability model. It is NOT a trained model's output**
and must never be reported as detector accuracy.
| Field | Type | Meaning | Notes |
|---|---|---|---|
| detection_id | string | PK | |
| sensor_id | string | FK -> sensors.sensor_id | always `SNS-CAM-01` here |
| telemetry_seq | int | FK -> telemetry.seq | platform pose at detection time |
| object_id | string, nullable | FK -> object_truth.object_id | sim-only traceability field |
| bbox_x_center, bbox_y_center, bbox_width, bbox_height | float | normalized YOLO-style, [0,1] | heuristic, not photogrammetric |
| range_m_estimate, bearing_deg_estimate | float | planar-range assumption | no depth/altitude/range sensor exists |
| review_status | string | always `unreviewed` | no simulated data is ever "reviewed" |
| provenance | enum | always `derived_estimate` | |

### tracks.csv
| Field | Type | Meaning |
|---|---|---|
| track_id | string | PK |
| ground_truth_object_id | string, nullable | **sim-only field**; a real tracker output would not carry this |
| status | enum | active (last obs ≤60s before mission end) / stale / lost -- `lost` is not exercised by the default sample |
| position_uncertainty_m | float | nominal GPS uncertainty + range-based term |
| movement_estimate_mps | float | magnitude of the (known, simulated) drift vector |
| detection_count | int | number of detections in this track |

### alerts.csv
| Field | Type | Meaning |
|---|---|---|
| alert_id | string | PK |
| alert_type | string | `new_debris_detected` or `delayed_event_demo` |
| related_track_id | string, nullable | null for the standalone delayed-event demo alert |
| status | enum | open / acknowledged / resolved (`resolved` unused by default sample) |

### scenario_events.csv
One row per scenario window actually exercised in this mission: `scenario_type`,
`window_start_utc`/`window_end_utc`, `related_ids` (semicolon-separated), and a
plain-language `description`.

---

## Part B -- ESPADA image dataset (`output/espada_images/`)

```
espada_images/
  classes.json                 provisional class map, verified_against_repository=false
  images/{train,val,test}/     REAL data only -- empty until you import some
  labels/{train,val,test}/     matching normalized YOLO .txt files
  images/synthetic_fixtures/   procedurally rendered illustrative renders (NOT real, NOT training evidence)
  labels/synthetic_fixtures/   matching YOLO labels for the fixtures above
  splits/split_manifest.json   split policy + (currently empty) split membership
  missing_imagery_report.md    explains why there is no real imagery here
  dataset_manifest.json        fixture list + YOLO validation results
```

YOLO label line format (unchanged from the standard convention):
`class_id x_center y_center width height`, all normalized to [0,1] relative
to image width/height, one object per line, an absent or empty `.txt` file
means "no objects" (used for negative/empty-scene fixtures here).

## Geographic / scene transform
See `oceanguard_sim/coordinate_utils.py::LocalENUFrame`. Equirectangular
flat-earth approximation around a local origin; adequate for a
hundreds-of-metres survey box, not geodetic-grade. The **local ENU grid
(metres, +x=East, +y=North, +z=Up) is authoritative**; lat/lon is derived
from it for display/interop only.
