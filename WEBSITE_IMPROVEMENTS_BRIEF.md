# OceanGuard — remaining improvements

Reviewed: 19 September 2026; expanded after checking every current page, shared navigation, and API feature. Source-based checklist; browser, hardware, and deployment checks still need execution.

**Current position:** 3D monitoring is a sample scene. Espada already runs a trained model, image/camera inference, frame annotation, and reviewed-data retraining. Its saved general-litter benchmark is 35.3% precision, 23.1% recall, and 28.0% F1; only `Mixed Waste` is learned. Marine reliability is unproven.

## 1. Essential fixes — first

- **Real login:** Replace password-free demo login and predictable tokens; add account recovery, session expiry/logout, and isolate quick-demo accounts.
- **Permissions:** Enforce roles on every protected server action, including users, reports, missions, and training reviews.
- **Honest data:** Carry source/timestamp labels throughout; fix sample alerts/reports marked live and invented login/header/settings fleet, coverage, latency, and health claims.
- **Permanent records:** Replace operational mock arrays with stored detections, devices, alerts, missions, and users; retain existing reviewed-image storage.
- **Consistent records:** Use shared IDs, coordinates, units, and timestamps across pages; show “not found” for invalid records instead of another sample.
- **Privacy and limits:** Restrict image access, define retention/deletion, limit request rates and storage, and record sensitive changes.

## 2. 3D monitoring

- **Visual realism:** Refine horizon glare, water/shore transitions, boat materials, wakes, debris detail, underwater light, and visibility.
- **Physical consistency:** Verify wave motion, boat/debris movement, seabed contact, depth readings, and camera limits agree in every mode.
- **Live scene:** Replace fixed contacts with time-stamped detections and vessel/device positions when real feeds exist; preserve explicit demo mode.
- **Accurate positioning:** Calibrate camera/GPS/depth inputs before placing detections in 3D; show position uncertainty and unavailable measurements.
- **Sonar:** Keep the current stylized sonar labeled as simulated; real sonar/bathymetry needs actual sensors, ingestion, and calibration.
- **Operator controls:** Validate selection, inspection, presets, orbit, zoom, pause, compass, fullscreen, and touch; fade obstructed labels and add live tracking/history.
- **Performance:** Measure frame rate and memory on weaker devices; add adjustable quality, cheaper effects, and hidden-tab rendering suspension.
- **Recovery:** Test existing WebGL recovery and cleanup, repeated navigation, resizing, and a usable fallback when 3D cannot run.

## 3. Datasets, model training, and learning

- **Marine dataset:** Collect licensed, representative surface/underwater images across locations, cameras, weather, glare, turbidity, and debris sizes.
- **Label quality:** Review complete frames, including missed debris and empty water; agree class definitions and retain annotation/source history.
- **Honest classes:** Add nets, plastic, metal, and other classes only after enough labeled examples and measured per-class performance exist.
- **Clean splits:** Separate training, validation, and untouched final tests by mission/video/location; exclude duplicates, adjacent frames, and cropped copies.
- **Improve recall:** Inspect missed objects and false alarms; tune sampling, augmentation, image resolution, and training before replacing the architecture.
- **Repeatable training:** Version datasets/configuration/results; save optimizer and scheduler state so interrupted training resumes fully.
- **Useful evaluation:** Report per-class precision, recall, F1, mAP, condition-specific errors, and device latency; agree release thresholds before training.
- **Confidence and risk:** Calibrate scores on marine data, tune alert thresholds, and distinguish model confidence from rule-based environmental risk.
- **Safe retraining:** Keep human-approved labels; verify revised reviews trigger training, worker failures recover, and training does not slow inference.
- **Safe releases:** Exercise real candidate acceptance/rejection, export equivalence, metadata consistency, and rollback in isolated storage; monitor field accuracy drift.

## 4. Complete every page and workflow

- **Public portal:** Store/track access requests before confirming receipt; label sample globe markers and static metrics; verify globe controls and public links.
- **Command Center:** Derive totals, trends, recent detections, alerts, and subsystem health from shared records; show freshness and working drill-down links.
- **Alerts and notifications:** Provide a complete alert list, acknowledge/assign/resolve actions, and deduplicated notifications; connect the bell, sound, and notification preferences.
- **Camera and uploads:** Test permissions, disconnects, rapid restart, slow inference, and queued uploads; add retry/cancel and camera selection where supported.
- **Media history:** Persist uploaded/captured analyses with searchable history and processing status; make advertised processing endpoints perform real jobs or disable them.
- **Annotation review:** Restore saved reviews, retain drafts across navigation, recover conflicting edits, support precise touch/keyboard boxes, and verify empty-frame approval.
- **Espada model status:** Keep one model entry; expose class names, dataset scope, release identity, runtime, training progress/errors, and promotion history in `/data`.
- **Detections list:** Connect search, status/risk filters, sorting, and pagination to saved inference records; prevent duplicate incident counts.
- **Detection detail:** Show the real analyzed image, boxes, track/location uncertainty, risk factors, and timeline; persist false-positive decisions and mission links.
- **Sensors and fleet:** Connect camera, drone, GPS, AIS, and radar feeds where configured; add device details/configuration, last-seen times, failures, and reconnect status.
- **Hotspots:** Compute verified clusters; synchronize risk filters across map/list, validate basemaps/layers/legends and tile failures, and pass selected hotspots into cleanup planning.
- **Environmental AI:** Make Today/7 Days/30 Days/Custom actually filter all charts; use current model metrics and comparable detection/cleanup units.
- **Cleanup queue:** Persist creation, assignment, priority, schedule, zone, and source detection/hotspot; preserve filters/sorting and prevent duplicate submissions.
- **Cleanup detail:** Persist progress, pause/cancel/completion, real evidence uploads, recovered quantities, and timeline; replace timer-based success with server confirmation.
- **Reports and export:** Implement daily/weekly/monthly/incident/cleanup selection, date/zone scope, real PDF/CSV/JSON downloads, and saved report history.
- **Administration:** Implement Add/Edit/Deactivate User, role changes, zone boundaries/camera assignments, and validated threshold saves with change history.
- **Settings:** Save/apply profile, theme, map style, default page, sound, and notification choices; implement Reset to Defaults and honest system information.

## 5. Usability and reliability

- **Navigation:** Verify role-aware menus, mobile drawer, back/deep links, missing-record pages, and legacy redirects; move needed registry details into `/data`.
- **Responsive layout:** Check every page from 320px phones to desktop; fix clipped panels, dense text, tables, and small touch targets.
- **Accessibility:** Add keyboard camera controls; verify focus, dialogs, contrast, chart summaries, and changing reduced-motion preferences; keep contacts usable without 3D.
- **Clear states:** Make loading, empty, stale, offline, denied, and failed states consistent; add recoverable page errors and truthful save confirmations.
- **Live updates:** Distinguish API, stream, sensor, and model connectivity; handle reconnect/backoff, missed events, stale values, and polling-only hosting.
- **API completeness:** Reconcile frontend calls with server routes, fix `/hotspots/heatmap` being caught as an ID, and validate filters, payloads, and errors.
- **Performance:** Measure route loading, bound large lists, preserve lazy loading, and check cleanup of timers, streams, images, and listeners.

## 6. Testing and delivery

- **End-to-end checks:** Test every page's controls plus login permissions, upload → review → training → release, and detection → cleanup → export, including failures.
- **Deployment:** Verify a fresh full-stack installation with HTTPS, private inference access, persistent storage, and hosting-compatible live updates.
- **Operations:** Add actionable health/error monitoring, resource limits, backup/restore drills, and model/data recovery; preserve ignored model artifacts.
- **Documentation:** Reconcile stale setup/model/API instructions with current code and identify the canonical source before any deployment-copy synchronization.

**Order:** Essential fixes → real data and marine validation → complete operational workflows → 3D refinement and usability → release verification. Mark an item complete only after its behavior is verified.

Coverage: all 16 page modules, including both detail pages and the legacy AIModels page, shared layout/navigation, media/alerts APIs, 3D monitoring, and AI training. `/sonar-3d` and `/ai-models` currently redirect to Monitoring and Data respectively.

Evidence: `server.ts`, `src/pages/`, `src/App.tsx`, `src/lib/api.ts`, shared layout/context/annotation/monitoring components, `ai_service/training/`, active model metadata, and current project checkpoints. This checklist changes no application behavior.
