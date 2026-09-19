# OceanGuard webpage improvement handoff plan

Status: **PACKAGES A, B, C IMPLEMENTED & VERIFIED** (2026-09-14)  
Prepared: 2026-09-13  
Updated: 2026-09-14

All code modifications are preserved locally and uncommitted. Tests pass (24 Python tests, 3 launcher tests, TypeScript clean, Vite + esbuild production builds clean). Do not deploy or copy changes into `oceanguard-vercel-upload`.

## Non-negotiable product rule

OceanGuard currently mixes working features, sample mission content, and fabricated operational claims. Every value or capability must be one of:

1. fetched from a real configured source;
2. visibly labeled **sample/demo data** next to the value; or
3. removed/disabled with an honest unavailable state.

Never silently replace a failed API request with invented success data.

## Work package A — truth and provenance pass — COMPLETED (2026-09-14)

Ownership: `src/pages/Landing.tsx`, `src/pages/CommandCenter.tsx`, `src/pages/EnvironmentalAI.tsx`, `src/pages/Reports.tsx`, and `src/components/ui/DataProvenanceBadge.tsx`.

- [x] Replace unsupported Landing claims such as a proprietary 14.8-million-image transformer, 99.4% recall, 428 gliders, 16-band live ingestion, automatic dispatch, and validated impact figures. Describe only the implemented Espada v1 pilot (SSDLite320 MobileNetV3) with verified TACO metrics (494 train / 200 val) and 100% self-hosted ownership.
- [x] Add a reusable `DataProvenanceBadge`/notice with states `LIVE`, `SAMPLE`, `USER PROVIDED`, and `UNAVAILABLE`. Re-exported from `src/components/ui/Badge.tsx`.
- [x] Mark Command Center mock alerts/detections and static fleet summaries as sample mission data. Replace "all systems operational" with honest dynamic telemetry warnings when disconnected/offline.
- [x] Mark Environmental AI trend/category/risk/zone arrays as sample analytics with persistent `SAMPLE ANALYTICS` badges.
- [x] Remove the Reports page’s invented success fallback. API failure shows a retryable `ErrorState`; sample report preview is a separate explicitly labeled action (`Preview Sample Report`) with `SAMPLE` badge, and report history is explicitly labeled `SAMPLE ARCHIVE`.

Acceptance:
- [x] Searching visible copy for `99.4`, `14.8M`, `428 UNITS`, and other unsupported metrics finds no unlabeled operational claim.
- [x] Network failure never creates a fake successful report or fake live status.
- [x] Each dashboard containing static arrays has a persistent, nearby `SAMPLE DATA` label.

## Work package B — shared data contract and honest states — COMPLETED (2026-09-14)

Ownership: `src/context/SystemContext.tsx`, `src/components/ui/StateComponents.tsx`, `src/pages/Reports.tsx`, `src/pages/CommandCenter.tsx`.

- [x] Remove hard-coded sidebar count fallbacks (`1284`, `14`, `2`, `14/15`) when system summary is unavailable; show `—` or a labeled sample mode instead.
- [x] Purge fake initial state in `SystemContext.tsx` (`debrisDetected: 1284, camerasOnline: '14/15', activeAlerts: 7`), defaulting to `null` and honest `isOnline: false` when fetch fails.
- [x] Error states render retry actions (`ErrorState` on Reports, honest unavailable status on CommandCenter).
- [x] Standardize mock detections and alerts with fixed sample timestamps instead of generating dynamic `new Date()` historical detections.

Acceptance:
- [x] Offline API produces an understandable unavailable state (`—`, telemetry unavailable banner).
- [x] No component converts `undefined` live data into a realistic-looking operational number.
- [x] Loading, empty, and error states are keyboard and screen-reader understandable.

## Work package C — navigation and information architecture — COMPLETED (2026-09-14)

Ownership: `src/components/layout/Sidebar.tsx`.

- [x] Group the flat navigation into 4 semantic sections: Observe, Analyze, Respond, and Admin.
- [x] Ensure collapsed navigation exposes accessible names (`title` and `aria-label`).
- [x] Fix route activity logic for nested routes without accidental prefix collisions (`item.path + '/'`).
- [x] Replaced fake fallback numbers in navigation badges with `'—'` when summary counts are absent.

Acceptance:
- [x] First-time operator sees clear semantic groups (Observe, Analyze, Respond, Admin).
- [x] All collapsed navigation buttons have meaningful accessible names.

## Work package D — accessibility and responsive behavior

Suggested ownership: shared UI components first, then pages in disjoint batches.

- Test at 320×568, 390×844, 768×1024, 1366×768, and 1920×1080.
- Remove horizontal overflow, clipped dialogs, hover-only disclosure, and fixed-height panels that hide actions.
- Verify focus order, visible focus, Escape behavior, modal focus trapping/restoration, and mobile sidebar inert state.
- Add text alternatives to charts that reflect the displayed dataset and provenance; do not hard-code summaries that become stale.
- Respect reduced motion across the sidebar globe, charts, decorative pulses, and page transitions.
- Check foreground/background contrast for 10px telemetry text; increase size/contrast where it conveys decisions rather than decoration.

Acceptance:

- Core tasks are usable with keyboard only at desktop and touch only at mobile size.
- No critical content depends only on color, hover, or animation.
- Automated accessibility checks have no serious/critical findings; manual focus walkthrough is recorded.

## Work package E — performance and lifecycle

Suggested ownership: `src/App.tsx`, route chunks, chart-heavy pages, shared hooks.

- Measure route chunk sizes and interaction latency before changing bundling. Keep Three.js isolated to the Monitoring route.
- Pause or dispose animations, timers, SSE connections, observers, and media tracks on route exit and document cleanup ownership.
- Debounce search/filter inputs only where measurement shows unnecessary rendering.
- Add an application-level error boundary per lazy route with retry/reload guidance.
- Avoid importing large chart or map libraries into routes that do not render them.

Acceptance:

- Repeatedly entering/leaving each route does not increase active timers, listeners, canvases, or media tracks.
- A failed lazy chunk renders a recoverable page rather than a blank shell.
- Production build warnings are recorded with a deliberate split/accept decision.

## Work package F — tests and delivery discipline

- Add focused tests for API error states, provenance rendering, report failure behavior, route metadata, and mobile navigation.
- Run TypeScript, production frontend/server builds, Python tests only when backend contracts were touched, and `git diff --check`.
- Perform browser QA on real built output. Record viewport, route, interaction, expected result, and observed result.
- Update `BRAIN.md` and this plan from evidence. Do not check a box merely because code exists.

## Recommended assignment order

1. Model 1: Work package A only (truth/provenance).
2. Model 2: Work package B only (shared data/error contracts).
3. Model 3: Work package C only after Espada consolidation is complete.
4. Model 4: Work package D in shared UI and two-page batches to avoid file conflicts.
5. Model 5: Work package E, followed by an independent performance/lifecycle review.
6. Final integrator: Work package F, resolve overlaps, run complete verification, and update checkpoints.

## Explicitly out of scope for these models

- Training or promoting Espada weights.
- Inventing marine accuracy or live sensor integrations.
- Editing the active 3D Monitoring implementation without a dedicated assignment.
- Deployment, cloud account changes, or synchronizing the sibling Vercel upload copy.
