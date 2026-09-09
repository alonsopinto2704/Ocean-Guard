# OceanGuard UI/UX audit — 2026-09-06

## Audit scope

Combined desktop UX and screenshot-based accessibility review of sign-in, command center, live monitoring, detection triage, detection detail, cleanup missions, mobile reflow, and the 3D portal.

User goal: understand the operational picture quickly, triage debris, and turn a high-risk detection into a cleanup response with minimal friction.

## Overall verdict

The visual direction is strong and distinctive, and the detection-to-response story is already understandable. The next pass should focus on responsive structure, hierarchy, trustworthy actions, and performance. These improvements will make the interface feel calmer and faster without losing the tactical marine identity.

## Flow steps

1. **Sign-in — Good foundation.** The split layout and demo roles are clear. The marketing copy is denser than the task requires, labels are not programmatically connected to inputs, and the icon-only password control has no accessible name.
2. **Command center — Good, but crowded.** The status cards and charts create a useful overview. The persistent telemetry header competes with the page title, many colors carry meaning at once, and the lower panels begin below the fold with no priority cue.
3. **Live monitoring — Needs restructuring.** The 3D canvas is impressive and filters work, but overlapping mode controls, a wide classifier panel, low-contrast scene content, and multiple simultaneous animations reduce readability. The measured display was about 27 FPS.
4. **Detection triage — Strongest operational screen.** Search, filters, and risk/status columns are useful. The table rows are mouse-only, filter controls lack visible labels, and confidence plus risk are easy to confuse because both appear as colored severity badges.
5. **Detection detail — Needs better evidence and action safety.** Risk factors and the main response action are prominent. The frame is visually empty, the primary action jumps directly to cleanup without a review step, and “Flag False Positive” has no visible workflow or confirmation.
6. **Cleanup missions — Good scanability.** Status, assignment, mass, and progress are easy to compare. The list lacks urgency sorting/filtering, created-from-detection context is not visible, and the new mission form is separate from the detection handoff.
7. **Mobile reflow — Critical issue.** At 390 px, the fixed 260 px sidebar remains open and the main experience is clipped to a narrow strip. Core tasks are unusable on phones and small tablets.
8. **Public 3D portal — Visually strong, strategically unclear.** The hero is compelling, but it is behind authentication despite being named public. Dense telemetry language delays the value proposition, and the access form appears to generate a token without explaining privacy, review, or delivery.

## Highest-impact improvements

1. Build a responsive shell: mobile drawer, compact top bar, responsive cards, and table-to-card reflow.
2. Simplify the command center around “what needs attention now,” with one primary alert queue and progressive disclosure for telemetry.
3. Rework monitoring for stable 55–60 FPS: shader-based waves or lower geometry detail, adaptive pixel ratio, lighter shadows, pause rendering when hidden, and a compact/collapsible inspector.
4. Add a reviewed detection-to-mission flow with prefilled fields, assignment, ETA, validation, confirmation, and a success state.
5. Improve accessibility: connected labels, named icon buttons, keyboard-operable rows/cards, visible focus, larger targets, reduced-motion support, and non-color status cues.

## Feature opportunities

- Alert-to-action inbox with acknowledge, assign, and escalation states.
- Mission map showing detections, drift prediction, crew ETA, and recommended intercept point.
- Saved views and filters for operators, environmental officers, and cleanup teams.
- Evidence history with real frame thumbnails, model version, confidence changes, and audit trail.
- Command palette/global search for detection IDs, vessels, zones, and missions.
- Offline/reconnecting states with “last updated” timestamps instead of silently retaining stale values.

## Evidence limits

This was a screenshot and code-level review of the local prototype. It is not a full WCAG conformance audit. Screen-reader behavior, complete keyboard order, network throttling, touch ergonomics on physical devices, and production data accuracy still need dedicated testing.

