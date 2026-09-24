/**
 * Mission simulation & replay run registry.
 *
 * Isolation contract (verified by tests/simulation.test.ts):
 * - This module NEVER imports src/server/storage.ts; operational records are untouched.
 * - Runs live in module-local memory with SIM-RUN- prefixed ids.
 * - Frames are sent to ESPADA with `X-Espada-Skip-Learning: true`, so no analysis,
 *   image, or training example is created for simulation frames.
 * - Ground truth never reaches the detector or the tracker: requests contain image
 *   bytes + filename only; truth boxes are used exclusively by this evaluator.
 */
import { Router, Request, Response } from 'express';
import { getPositiveDepth } from '../lib/bathymetry.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

// ── Seeded RNG (mulberry32) ──────────────────────────────────────────────────
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Documented camera/geolocation model (assumptions, not a real lens) ──────
export const CAMERA = {
  detectionRangeM: 30,        // documented range-only model (mirrors mission.json)
  fovHDeg: 60,                // horizontal FOV; objects outside ±30° bearing are not captured
  boxRangeK: 5.4,             // boxHeightFrac = K / rangeM (render + inverse)
  /** Bearing → pixel mapping: the 60° FOV spans the central 50% of the frame,
   *  so bearingDeg = (boxCenterX − 0.5) × fovHDeg × 2. Renderer + decoder share it. */
  bearingPixelsFactor: 2,
  variantRangesM: [8, 12, 18, 26],
  variantBearingsDeg: [-30, -20, -10, 0, 10, 20, 30],
} as const;

export const TIMING = { staleAfterS: 15, lostAfterS: 45, trackGateM: 15, trackMaxGapS: 30, reassociationGateM: 22 } as const;

export type SourceMode = 'LIVE' | 'REPLAY' | 'SIMULATION';
export type RunState = 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'ABORTED';
export type FeedStatus = 'FRESH' | 'STALE' | 'INTERRUPTED';

export interface ScenarioObject {
  id: string;
  name: string;
  truthClass: 'Mixed Waste';
  /** ENU ground-truth position over time: [simTimeS, eastM, northM, depthM]. */
  track: Array<[number, number, number, number]>;
  /** Visibility windows in sim seconds (the simulated camera renders the object). */
  visibleS: Array<[number, number]>;
  /** Nominal depth below the surface in metres (drives depth-aware contacts + 3D placement). */
  depthM: number;
}

export interface ScenarioFault {
  atS: number;
  durationS: number;
  kind: 'CAMERA_OUTAGE' | 'NETWORK_LOSS' | 'ESPADA_TIMEOUT' | 'DUPLICATE_EVENTS' | 'OUT_OF_ORDER' | 'GPS_NOISE' | 'MISSING_LOCATION' | 'DELAYED_TELEMETRY';
}

export interface OperatorAction {
  tS: number;
  action: 'MISSION_PAUSE' | 'MISSION_RESUME' | 'MISSION_ABORT' | 'MISSION_COMPLETE' | 'REVIEW_FALSE_POSITIVE' | 'REVIEW_CORRECT';
  note: string;
}

export interface ScenarioConfig {
  id: string;
  name: string;
  description: string;
  mode: SourceMode;
  durationS: number;
  seed: number;
  frameHz: number;
  origin: { lat: number; lng: number };
  /** Platform ENU track: [simTimeS, eastM, northM, headingDeg]. */
  platform: Array<[number, number, number, number]>;
  objects: ScenarioObject[];
  faults: ScenarioFault[];
  environment: Array<{ tS: number; waveHeightM: number; windMps: number; visibilityClass: string; turbidity: number }>;
  /** Telemetry-only runs cannot demonstrate visual detection accuracy. */
  telemetryOnly?: boolean;
  operatorScript?: OperatorAction[];
  /** True when the scenario exercises glare variants (rendered degraded frames). */
  glareWindows?: Array<[number, number]>;
}

export interface SimEvent {
  id: number;
  tS: number;
  wallTime: string;
  captureTime: string | null;
  type: 'FRAME_CAPTURED' | 'FRAME_INFERRED' | 'FRAME_FAILED' | 'TELEMETRY' | 'ENVIRONMENT'
  | 'TRACK_CREATED' | 'TRACK_UPDATED' | 'TRACK_STALE' | 'TRACK_LOST'
  | 'BATHYMETRY' | 'ALERT' | 'MISSION_STATE' | 'FAULT' | 'OPERATOR_ACTION' | 'RUN_STATE';
  provenance: 'SIMULATED' | 'RECORDED' | 'MODEL_OUTPUT';
  bathymetry?: { samples: Array<{ eastM: number; northM: number; depthM: number }>; cellSizeM: number; source: 'SIMULATED_SONAR' | 'SENSOR' };
  depthEstimated?: boolean;
  detectionId?: string;
  trackId?: string;
  frameUrl?: string;
  /** Scenario asset for visualisation only; never a model classification or measured depth. */
  scenarioObjectId?: string;
  scenarioObjectName?: string;
  scenarioDepthM?: number;
  className?: string;
  /** Calibrated confidence (%) when the model provides calibration. */
  confidence?: number;
  /** Raw model score (%) — always kept distinct from calibrated confidence. */
  rawConfidence?: number;
  confidenceCalibrated?: boolean;
  analysisId?: string | null;
  position?: { eastM: number; northM: number; depthM: number; uncertaintyM: number };
  lat?: number | null;
  lng?: number | null;
  locationUnknown?: boolean;
  reviewStatus?: 'UNREVIEWED' | 'CONFIRMED' | 'FALSE_POSITIVE' | 'CORRECTED';
  message?: string;
  latencyMs?: number;
  queueDelayMs?: number;
  /** True when `confidence` is an uncalibrated visual-anomaly score (bootstrap mode). */
  anomalyScore?: boolean;
  environment?: { waveHeightM: number; windMps: number; visibilityClass: string; turbidity: number };
  platform?: { eastM: number; northM: number; headingDeg: number; speedMps: number };
}

export interface RunMetrics {
  available: boolean;
  partial?: boolean;
  reason?: string;
  frames: { scheduled: number; captured: number; dropped: number; failed: number };
  perFrame: { precision: number | 'UNAVAILABLE'; recall: number | 'UNAVAILABLE'; framesScored: number; iouThreshold: number };
  uniqueObjectCount: { truth: number; predicted: number; error: number | 'UNAVAILABLE' };
  identitySwaps: number | 'UNAVAILABLE';
  localization: { rmseM: number | 'UNAVAILABLE'; n: number };
  latency: { p50S: number | 'UNAVAILABLE'; p95S: number | 'UNAVAILABLE'; definition: string };
  droppedFrameRate: number | 'UNAVAILABLE';
  staleFeedBehaviorS: number;
  recoveryTimeS: number | 'UNAVAILABLE';
  alertCount: number;
  dedup: { duplicatesReceived: number; duplicatesDropped: number };
}

interface FrameRecord {
  frameId: string;
  tS: number;
  variant: string;
  glare: boolean;
  scenarioObjectId?: string;
  scenarioObjectName?: string;
  scenarioDepthM?: number;
  truthBoxes: Array<{ objectId: string; bbox: { x: number; y: number; width: number; height: number }; eastM: number; northM: number }>;
  preds: Array<{ bbox: { x: number; y: number; width: number; height: number }; trackId: string; estEastM: number; estNorthM: number }>;
}

interface TrackState {
  trackId: string;
  lastTS: number;
  eastM: number;
  northM: number;
  depthM: number;
  uncertaintyM: number;
  status: 'ACTIVE' | 'STALE' | 'LOST';
  reviewStatus: 'UNREVIEWED' | 'CONFIRMED' | 'FALSE_POSITIVE' | 'CORRECTED';
  lastConfidence: number | null;
  lastFrameUrl: string | null;
  lastCaptureTime: string | null;
  alertKeyFired: Set<string>;
}

export interface SimRun {
  id: string;
  scenario: ScenarioConfig;
  mode: SourceMode;
  state: RunState;
  /** Simulation clock (seconds since scenario start). Advances only while RUNNING. */
  tS: number;
  speed: number;
  restartCount: number;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  events: SimEvent[];
  health: {
    espada: 'UP' | 'DOWN' | 'DEGRADED';
    espadaLastOkAt: string | null;
    espadaLastError: string | null;
    feed: FeedStatus;
    lastFrameAtS: number | null;
    queueDelayMs: number;
    droppedFrames: number;
    consecutiveEspadaFailures: number;
    lastFailureTS: number | null;
    lastRecoveryS: number | null;
  };
  metrics?: RunMetrics | null;
  /** Injection point for tests (defaults to the real ESPADA HTTP path). */
  _inference?: InferenceFn;
  _ticking?: boolean;
  recordingError?: string;
  /** Internal harness-only state; truth never leaves this section. */
  internal: {
    lastProcessedS: number;
    nextEventId: number;
    detectionCounter: number;
    trackSeq: number;
    tracks: Map<string, TrackState>;
    frameRecords: FrameRecord[];
    missionPausedUntilS: number;
    lastNegativeCaptureS: number;
    duplicatesReceived: number;
    duplicatesDropped: number;
    replay?: {
      tables: Record<string, Array<Record<string, string>>>;
      startMs: number;
      endMs: number;
      cursors: Record<string, number>;
      missionId: string;
      /** Recorded detection ids already emitted. Durable across ticks so a
       *  duplicate row later in the file cannot be ingested twice. */
      seenDetections: Set<string>;
    };
    aborted: boolean;
  };
}

// ── Scenario library ─────────────────────────────────────────────────────────
const ENU_ORIGIN = { lat: 13.02, lng: 80.34 }; // display-only origin (matches mission.json; unverified placement)
const PLATFORM_SPEED_MPS = 2.1;

/** Circular survey loop (radius 60 m at 2.1 m/s) so object passes sweep range+bearing. */
export function platformTrack(durationS: number, seed: number): Array<[number, number, number, number]> {
  const rng = makeRng(seed);
  const radius = 60;
  const omega = PLATFORM_SPEED_MPS / radius;
  const out: Array<[number, number, number, number]> = [];
  for (let t = 0; t <= durationS; t++) {
    const ang = omega * t;
    const east = radius * Math.sin(ang);
    const north = 60 - radius * Math.cos(ang);
    const heading = ((90 - (ang * 180) / Math.PI) % 360 + 360) % 360;
    out.push([t, east, north, (heading + (rng() - 0.5) * 3 + 360) % 360]);
  }
  return out;
}

/** Patrol sector survey track for 3D monitoring (radius 17m, 100s period, sweeps 28° camera scan across 8 demo contacts). */
export function patrolSectorTrack(durationS: number, seed = 42): Array<[number, number, number, number]> {
  const rng = makeRng(seed);
  const radius = 17;
  const omega = (2 * Math.PI) / 100;
  const out: Array<[number, number, number, number]> = [];
  for (let t = 0; t <= durationS; t++) {
    const ang = omega * t;
    const east = radius * Math.sin(ang);
    const north = -radius * Math.cos(ang);
    const forwardHeading = ((Math.atan2(Math.cos(ang), Math.sin(ang)) * 180 / Math.PI) % 360 + 360) % 360;
    const cameraScan = Math.sin(t * 0.4) * 28;
    out.push([t, east, north, (forwardHeading + cameraScan + (rng() - 0.5) * 1.2 + 360) % 360]);
  }
  return out;
}

function staticTrack(durationS: number, eastM: number, northM: number, driftEMps = 0, driftNMps = 0): Array<[number, number, number, number]> {
  const out: Array<[number, number, number, number]> = [];
  for (let t = 0; t <= durationS; t++) out.push([t, eastM + driftEMps * t, northM + driftNMps * t, 0]);
  return out;
}

export const DEMO_OBJECTS: ScenarioObject[] = [
  { id: 'NET-01', name: 'Drifting fishing net (NET-01)', truthClass: 'Mixed Waste', track: staticTrack(360, 12, 17, 0.01, -0.01), visibleS: [[0, 360]], depthM: 1.8 },
  { id: 'PET-02', name: 'Floating bottles (PET-02)', truthClass: 'Mixed Waste', track: staticTrack(360, -10, 12, -0.01, 0.01), visibleS: [[0, 360]], depthM: 0 },
  { id: 'DRM-03', name: 'Discarded steel drum (DRM-03)', truthClass: 'Mixed Waste', track: staticTrack(360, 15, -9, 0, 0), visibleS: [[0, 360]], depthM: 13.9 },
  { id: 'TYR-04', name: 'Seabed tire (TYR-04)', truthClass: 'Mixed Waste', track: staticTrack(360, -11, -8, 0, 0), visibleS: [[0, 360]], depthM: 16.4 },
  { id: 'BUO-05', name: 'Smart telemetry buoy (BUO-05)', truthClass: 'Mixed Waste', track: staticTrack(360, 22, 8, 0, 0), visibleS: [[0, 360]], depthM: 0 },
  { id: 'BAG-07', name: 'Ghost gear & polymer mass (BAG-07)', truthClass: 'Mixed Waste', track: staticTrack(360, -5, 23, 0.02, -0.01), visibleS: [[0, 360]], depthM: 0.9 },
  { id: 'WRE-08', name: 'Sunken cargo container (WRE-08)', truthClass: 'Mixed Waste', track: staticTrack(360, 3, -24, 0, 0), visibleS: [[0, 360]], depthM: 14.7 },
];

// Scenario 2: Deep Benthic Shelf
export const BENTHIC_OBJECTS: ScenarioObject[] = [
  { id: 'BTH-01', name: 'Submerged industrial cylinder (BTH-01)', truthClass: 'Mixed Waste', track: staticTrack(360, 14, 15, 0, 0), visibleS: [[0, 360]], depthM: 8.5 },
  { id: 'BTH-02', name: 'Entangled trawl net on reef (BTH-02)', truthClass: 'Mixed Waste', track: staticTrack(360, -12, 10, 0.005, 0.005), visibleS: [[0, 360]], depthM: 5.2 },
  { id: 'BTH-03', name: 'Submerged battery housing (BTH-03)', truthClass: 'Mixed Waste', track: staticTrack(360, 16, -11, 0, 0), visibleS: [[0, 360]], depthM: 7.1 },
  { id: 'BTH-04', name: 'Heavy seabed tractor tire (BTH-04)', truthClass: 'Mixed Waste', track: staticTrack(360, -13, -9, 0, 0), visibleS: [[0, 360]], depthM: 9.0 },
  { id: 'BTH-05', name: 'Acoustic benthic transponder (BTH-05)', truthClass: 'Mixed Waste', track: staticTrack(360, 20, 6, 0, 0), visibleS: [[0, 360]], depthM: 3.4 },
  { id: 'BTH-07', name: 'Sunken reinforced crate (BTH-07)', truthClass: 'Mixed Waste', track: staticTrack(360, -7, 21, 0, 0), visibleS: [[0, 360]], depthM: 11.2 },
  { id: 'BTH-08', name: 'Sediment sampling core pipe (BTH-08)', truthClass: 'Mixed Waste', track: staticTrack(360, 5, -22, 0, 0), visibleS: [[0, 360]], depthM: 4.0 },
];

// Scenario 3: Storm Surge & High-Turbidity Drifter Cluster
export const SURGE_OBJECTS: ScenarioObject[] = [
  { id: 'SRG-01', name: 'Storm drift ghost net (SRG-01)', truthClass: 'Mixed Waste', track: staticTrack(360, 11, 16, 0.04, -0.02), visibleS: [[0, 360]], depthM: 0 },
  { id: 'SRG-02', name: 'Dispersed bottle cluster (SRG-02)', truthClass: 'Mixed Waste', track: staticTrack(360, -9, 13, -0.03, 0.03), visibleS: [[0, 360]], depthM: 0 },
  { id: 'SRG-03', name: 'Semi-submerged chemical drum (SRG-03)', truthClass: 'Mixed Waste', track: staticTrack(360, 17, -8, 0.02, -0.01), visibleS: [[0, 360]], depthM: 1.5 },
  { id: 'SRG-04', name: 'Sinking heavy dock fender (SRG-04)', truthClass: 'Mixed Waste', track: staticTrack(360, -10, -10, 0.01, 0.01), visibleS: [[0, 360]], depthM: 3.1 },
  { id: 'SRG-05', name: 'High-seas storm drifter buoy (SRG-05)', truthClass: 'Mixed Waste', track: staticTrack(360, 21, 9, 0.05, 0.01), visibleS: [[0, 360]], depthM: 0 },
  { id: 'SRG-06', name: 'Autonomous storm-rider USV (SRG-06)', truthClass: 'Mixed Waste', track: staticTrack(360, -17, -15, 0.04, 0.03), visibleS: [[0, 360]], depthM: 0 },
  { id: 'SRG-07', name: 'Subsurface polymer slick mass (SRG-07)', truthClass: 'Mixed Waste', track: staticTrack(360, -6, 22, 0.03, -0.02), visibleS: [[0, 360]], depthM: 0.8 },
  { id: 'SRG-08', name: 'Submerged vessel hull fragment (SRG-08)', truthClass: 'Mixed Waste', track: staticTrack(360, 4, -23, 0.01, -0.01), visibleS: [[0, 360]], depthM: 5.4 },
];

function envSeries(durationS: number, seed: number, degraded = false) {
  const rng = makeRng(seed + 7);
  const out: ScenarioConfig['environment'] = [];
  for (let t = 0; t <= durationS; t += 30) {
    out.push({
      tS: t,
      waveHeightM: Math.round((0.3 + rng() * (degraded ? 1.5 : 0.6)) * 100) / 100,
      windMps: Math.round((3 + rng() * (degraded ? 9 : 4)) * 10) / 10,
      visibilityClass: degraded ? (Math.floor(t / 45) % 2 === 0 ? 'MODERATE' : 'LOW') : 'GOOD',
      turbidity: degraded ? Math.round((0.4 + rng() * 0.4) * 100) / 100 : Math.round(rng() * 25) / 100,
    });
  }
  return out;
}

function objectAtAngle(id: string, name: string, durationS: number, angleDeg: number, radialOffsetM: number, drift: [number, number] = [0, 0]): ScenarioObject {
  // Object placed just outside the 60 m survey ring at bearing angleDeg, so the
  // circling platform sweeps its range/bearing naturally (closest approach =
  // radialOffsetM, inside the documented 30 m detection range).
  const rad = (angleDeg * Math.PI) / 180;
  const radius = 60 + radialOffsetM;
  const eastM = radius * Math.sin(rad);
  const northM = 60 - radius * Math.cos(rad);
  return { id, name, truthClass: 'Mixed Waste', track: staticTrack(durationS, eastM, northM, drift[0], drift[1]), visibleS: [[0, durationS]], depthM: 0 };
}

export const SCENARIO_FACTORIES: Record<string, (seed: number) => ScenarioConfig> = {
  'SIM-NORMAL': seed => ({
    id: 'SIM-NORMAL',
    name: 'Normal progression, no debris',
    description: 'Calm-water survey with zero debris. Expected: no detections, no alerts, mission completes.',
    mode: 'SIMULATION', durationS: 120, seed, frameHz: 1,
    origin: ENU_ORIGIN, platform: platformTrack(120, seed), objects: [], faults: [],
    environment: envSeries(120, seed),
  }),
  'SIM-FOV': seed => ({
    id: 'SIM-FOV',
    name: 'Coastal Harbor AUV Survey',
    description: 'Ship-deployed AUV surveys the coastal sector and detects debris across the water column and seabed.',
    mode: 'SIMULATION', durationS: 240, seed, frameHz: 1,
    origin: ENU_ORIGIN, platform: patrolSectorTrack(240, seed),
    objects: DEMO_OBJECTS,
    faults: [], environment: envSeries(240, seed),
  }),
  'SIM-HARBOR-01': seed => ({
    id: 'SIM-HARBOR-01',
    // Named for its longer sweep so the scenario pickers cannot show two
    // identically labelled entries next to SIM-FOV (same 8 demo contacts).
    name: 'Extended Harbor AUV Survey (6 min)',
    description: 'The SIM-FOV patrol run over a 360 s sweep, encountering and tracking 8 mixed surface and submerged coastal debris contacts.',
    mode: 'SIMULATION', durationS: 360, seed, frameHz: 1,
    origin: ENU_ORIGIN, platform: patrolSectorTrack(360, seed),
    objects: DEMO_OBJECTS,
    faults: [], environment: envSeries(360, seed),
  }),
  'SIM-BENTHIC-02': seed => ({
    id: 'SIM-BENTHIC-02',
    name: 'Deep Benthic AUV Survey',
    description: 'Deep-water benthic reconnaissance targeting seabed tires, chemical cylinders, battery housings, and submerged AUV gliders.',
    mode: 'SIMULATION', durationS: 360, seed, frameHz: 1,
    origin: ENU_ORIGIN, platform: patrolSectorTrack(360, seed),
    objects: BENTHIC_OBJECTS,
    faults: [], environment: envSeries(360, seed),
  }),
  'SIM-SURGE-03': seed => ({
    id: 'SIM-SURGE-03',
    name: 'Storm Surge & Drifter Field (8 High-Turbidity Objects)',
    description: 'Storm surge reconnaissance tracking drifting ghost gear, flotsam bottles, surface buoys, and semi-submerged drums in rough sea.',
    mode: 'SIMULATION', durationS: 360, seed, frameHz: 1,
    origin: ENU_ORIGIN, platform: patrolSectorTrack(360, seed),
    objects: SURGE_OBJECTS,
    faults: [], environment: envSeries(360, seed, true),
  }),
  'SIM-COUNT': seed => ({
    id: 'SIM-COUNT',
    name: 'Five objects, repeated observations',
    description: 'Five nearby objects observed on repeated passes. Expected: unique-object counting error ≤ ±1, no identity swaps.',
    mode: 'SIMULATION', durationS: 300, seed, frameHz: 1,
    origin: ENU_ORIGIN, platform: platformTrack(300, seed),
    objects: [
      objectAtAngle('OBJ-0001', 'Cluster item 1', 300, 0, 12),
      objectAtAngle('OBJ-0002', 'Cluster item 2', 300, 40, 16),
      objectAtAngle('OBJ-0003', 'Cluster item 3', 300, 80, 20),
      objectAtAngle('OBJ-0004', 'Cluster item 4', 300, 120, 16),
      objectAtAngle('OBJ-0005', 'Cluster item 5', 300, 160, 12, [0.05, 0.02]),
    ],
    faults: [], environment: envSeries(300, seed),
  }),
  'SIM-GLARE': seed => ({
    id: 'SIM-GLARE',
    name: 'Glare windows and degraded conditions',
    description: 'Same object observed through rendered glare variants and calm variants. Expected: measurable detection difference between glare and calm frames.',
    mode: 'SIMULATION', durationS: 240, seed, frameHz: 1,
    origin: ENU_ORIGIN, platform: platformTrack(240, seed),
    objects: [objectAtAngle('OBJ-0001', 'Debris under glare', 240, 40, 12)],
    faults: [], environment: envSeries(240, seed, true),
    glareWindows: [[60, 120], [180, 220]],
  }),
  'SIM-OCCLUSION': seed => ({
    id: 'SIM-OCCLUSION',
    name: 'Partial occlusion and reappearance',
    description: 'Object visible, occluded mid-run, then reappearing. Expected: track loss then recovery with preserved identity.',
    mode: 'SIMULATION', durationS: 300, seed, frameHz: 1,
    origin: ENU_ORIGIN, platform: platformTrack(300, seed),
    objects: [{ ...objectAtAngle('OBJ-0001', 'Buoyed debris (occluded)', 300, 50, 12), visibleS: [[15, 80], [150, 290]] }],
    faults: [], environment: envSeries(300, seed),
  }),
  'SIM-NOISE': seed => ({
    id: 'SIM-NOISE',
    name: 'GPS noise, missing location, delayed/out-of-order telemetry, duplicates',
    description: 'One object plus sensor-quality faults. Expected: duplicates deduped, missing locations shown UNKNOWN, out-of-order handled without crashes.',
    mode: 'SIMULATION', durationS: 240, seed, frameHz: 1,
    origin: ENU_ORIGIN, platform: platformTrack(240, seed),
    objects: [objectAtAngle('OBJ-0001', 'Drifting bag', 240, 55, 14, [0.15, 0.05])],
    faults: [
      { atS: 60, durationS: 30, kind: 'GPS_NOISE' },
      { atS: 100, durationS: 10, kind: 'MISSING_LOCATION' },
      { atS: 120, durationS: 20, kind: 'DELAYED_TELEMETRY' },
      { atS: 150, durationS: 15, kind: 'OUT_OF_ORDER' },
      { atS: 180, durationS: 15, kind: 'DUPLICATE_EVENTS' },
    ],
    environment: envSeries(240, seed),
  }),
  'SIM-FAULTS': seed => ({
    id: 'SIM-FAULTS',
    name: 'Camera outage, network loss, ESPADA timeout, reconnection, recovery',
    description: 'Service-fault ladder. Expected: feed gaps preserved, inference health degrades and recovers within 10 s of sim time.',
    mode: 'SIMULATION', durationS: 360, seed, frameHz: 1,
    origin: ENU_ORIGIN, platform: platformTrack(360, seed),
    objects: [objectAtAngle('OBJ-0001', 'Persistent debris across faults', 360, 60, 12)],
    faults: [
      { atS: 80, durationS: 30, kind: 'CAMERA_OUTAGE' },
      { atS: 150, durationS: 30, kind: 'NETWORK_LOSS' },
      { atS: 220, durationS: 25, kind: 'ESPADA_TIMEOUT' },
    ],
    environment: envSeries(360, seed),
  }),
  'SIM-OPS': seed => ({
    id: 'SIM-OPS',
    name: 'Mission pause, review workflow, completion',
    description: 'One object with scripted operator actions: mission pause/resume, false-positive review workflow (applied to whichever detection is live), correction, completion.',
    mode: 'SIMULATION', durationS: 300, seed, frameHz: 1,
    origin: ENU_ORIGIN, platform: platformTrack(300, seed),
    objects: [objectAtAngle('OBJ-0001', 'Reviewed debris item', 300, 45, 12)],
    faults: [],
    environment: envSeries(300, seed),
    operatorScript: [
      { tS: 60, action: 'MISSION_PAUSE', note: 'Operator pauses the mission (capture halts)' },
      { tS: 90, action: 'MISSION_RESUME', note: 'Operator resumes the mission' },
      { tS: 130, action: 'REVIEW_FALSE_POSITIVE', note: 'Operator review workflow: reject one live detection as false positive' },
      { tS: 160, action: 'REVIEW_CORRECT', note: 'Operator review workflow: apply a correction to a live detection' },
      { tS: 290, action: 'MISSION_COMPLETE', note: 'Mission completes' },
    ],
  }),
};

export const SCENARIO_IDS = Object.keys(SCENARIO_FACTORIES);

// ── ENU ↔ lat/lng (documented equirectangular approximation, display only) ───
const M_PER_DEG_LAT = 111_320;
export function enuToLatLng(eastM: number, northM: number): { lat: number; lng: number } {
  return {
    lat: ENU_ORIGIN.lat + northM / M_PER_DEG_LAT,
    lng: ENU_ORIGIN.lng + eastM / (M_PER_DEG_LAT * Math.cos((ENU_ORIGIN.lat * Math.PI) / 180)),
  };
}
export function latLngToEnu(lat: number, lng: number): { eastM: number; northM: number } {
  return {
    northM: (lat - ENU_ORIGIN.lat) * M_PER_DEG_LAT,
    eastM: (lng - ENU_ORIGIN.lng) * M_PER_DEG_LAT * Math.cos((ENU_ORIGIN.lat * Math.PI) / 180),
  };
}

// ── Geometry helpers ─────────────────────────────────────────────────────────
export function positionAt(track: Array<[number, number, number, number]>, tS: number): [number, number, number] | null {
  if (!track.length) return null;
  if (tS <= track[0][0]) return [track[0][1], track[0][2], track[0][3]];
  const last = track[track.length - 1];
  if (tS >= last[0]) return [last[1], last[2], last[3]];
  for (let i = 1; i < track.length; i++) {
    if (track[i][0] >= tS) {
      const [t0, x0, y0, z0] = track[i - 1];
      const [t1, x1, y1, z1] = track[i];
      const f = (tS - t0) / (t1 - t0 || 1);
      return [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, z0 + (z1 - z0) * f];
    }
  }
  return null;
}

function platformAt(run: SimRun, tS: number): { eastM: number; northM: number; headingDeg: number } | null {
  const p = positionAt(run.scenario.platform, tS);
  return p ? { eastM: p[0], northM: p[1], headingDeg: p[2] } : null;
}

function inWindows(windows: Array<[number, number]>, tS: number): boolean {
  return windows.some(([a, b]) => tS >= a && tS <= b);
}

// ── Truth-box manifest (written by scripts/generate-simulation-fixtures.tsx) ─
interface FixtureManifest {
  fovHDeg: number;
  boxRangeK: number;
  variants: Record<string, { objectId: string; rangeM: number; bearingDeg: number; bbox: { x: number; y: number; width: number; height: number } }>;
  negatives: string[];
}
let manifestCache: FixtureManifest | null = null;
function loadManifest(): FixtureManifest {
  if (manifestCache) return manifestCache;
  const p = path.resolve(process.cwd(), 'public/simulation/runs/manifest.json');
  try {
    manifestCache = JSON.parse(fs.readFileSync(p, 'utf-8')) as FixtureManifest;
  } catch {
    // Missing manifest: runs still work, but truth-scoped scoring is unavailable.
    manifestCache = { fovHDeg: CAMERA.fovHDeg, boxRangeK: CAMERA.boxRangeK, variants: {}, negatives: [] };
  }
  return manifestCache;
}

export const DEMO_FIXTURE_MAP: Record<string, string> = {
  'NET-01': 'OBJ-0001',
  'PET-02': 'OBJ-0002',
  'DRM-03': 'OBJ-0003',
  'TYR-04': 'OBJ-0004',
  'BUO-05': 'OBJ-0005',
  'DRN-06': 'OBJ-0001',
  'BAG-07': 'OBJ-0002',
  'WRE-08': 'OBJ-0003',
  // Benthic scenario objects
  'BTH-01': 'OBJ-0003',
  'BTH-02': 'OBJ-0001',
  'BTH-03': 'OBJ-0004',
  'BTH-04': 'OBJ-0004',
  'BTH-05': 'OBJ-0005',
  'BTH-06': 'OBJ-0001',
  'BTH-07': 'OBJ-0003',
  'BTH-08': 'OBJ-0002',
  // Surge scenario objects
  'SRG-01': 'OBJ-0001',
  'SRG-02': 'OBJ-0002',
  'SRG-03': 'OBJ-0003',
  'SRG-04': 'OBJ-0004',
  'SRG-05': 'OBJ-0005',
  'SRG-06': 'OBJ-0001',
  'SRG-07': 'OBJ-0002',
  'SRG-08': 'OBJ-0003',
};

export function variantPath(objectId: string, rangeBucket: number, bearingBucket: number, glare: boolean): string {
  const mappedId = DEMO_FIXTURE_MAP[objectId] || (objectId.startsWith('OBJ-') ? objectId : 'OBJ-0001');
  const b = bearingBucket >= 0 ? `${bearingBucket}` : `neg${-bearingBucket}`;
  return `/simulation/runs/frames/${mappedId}_${rangeBucket}m_${b}deg${glare ? '_glare' : ''}.png`;
}

export function pickVariant(rangeM: number, bearingDeg: number): { rangeBucket: number; bearingBucket: number } {
  const rangeBucket = CAMERA.variantRangesM.reduce((best, r) => (Math.abs(r - rangeM) < Math.abs(best - rangeM) ? r : best), CAMERA.variantRangesM[0]);
  const bearingBucket = CAMERA.variantBearingsDeg.reduce((best, b) => (Math.abs(b - bearingDeg) < Math.abs(best - bearingDeg) ? b : best), CAMERA.variantBearingsDeg[0]);
  return { rangeBucket, bearingBucket };
}

/** Box → geolocation via the documented inverse heuristic (truth-free).
 *  Reads the box CENTER for bearing: bearing = (centerX − 0.5) × FOV × 2. */
export function geolocateBox(bbox: { x: number; y: number; width: number; height: number }, pose: { eastM: number; northM: number; headingDeg: number }): { eastM: number; northM: number; rangeM: number; bearingDeg: number } {
  const heightFrac = Math.max(bbox.height, 0.02);
  const rangeM = Math.min(60, Math.max(2, CAMERA.boxRangeK / heightFrac));
  const bearingDeg = (bbox.x + bbox.width / 2 - 0.5) * CAMERA.fovHDeg * CAMERA.bearingPixelsFactor;
  const absolute = ((pose.headingDeg + bearingDeg) * Math.PI) / 180;
  return {
    eastM: pose.eastM + rangeM * Math.sin(absolute),
    northM: pose.northM + rangeM * Math.cos(absolute),
    rangeM,
    bearingDeg,
  };
}

// ── Run registry ─────────────────────────────────────────────────────────────
const runs = new Map<string, SimRun>();
const timers = new Map<string, NodeJS.Timeout>();
let runCounter = 0;

export type InferenceFn = (frameUrl: string, timeoutMs: number) => Promise<EspadaResult>;
export interface EspadaResult {
  latencyMs: number;
  detections: Array<{ className: string; confidence: number; rawConfidence: number; confidenceCalibrated: boolean; boundingBox: { x: number; y: number; width: number; height: number }; engine?: string }>;
  analysisId?: string | null;
}

const AI_SERVICE_URL = (process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');

/** Real ESPADA inference through the documented /v1/detect contract. */
export const realInference: InferenceFn = async (frameUrl, timeoutMs) => {
  const filePath = path.resolve(process.cwd(), 'public', frameUrl.replace(/^\//, ''));
  const bytes = fs.readFileSync(filePath);
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), filePath.split(/[\\/]/).pop() || 'frame.png');
  const started = Date.now();
  const response = await fetch(`${AI_SERVICE_URL}/v1/detect`, {
    method: 'POST',
    body: form,
    headers: {
      'X-Espada-Skip-Learning': 'true', // isolation: never enter the learning store
      ...(process.env.ESPADA_SERVICE_TOKEN ? { 'X-Espada-Service-Token': process.env.ESPADA_SERVICE_TOKEN } : {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`ESPADA /v1/detect returned HTTP ${response.status}`);
  const payload = await response.json() as {
    latencyMs?: number;
    analysisId?: string | null;
    detections?: Array<{ className: string; confidence: number; rawConfidence: number; confidenceCalibrated: boolean; boundingBox: { x: number; y: number; width: number; height: number } }>;
  };
  return {
    latencyMs: payload.latencyMs ?? Date.now() - started,
    detections: (payload.detections || []).map(d => ({
      className: d.className,
      confidence: d.confidence,
      rawConfidence: d.rawConfidence,
      confidenceCalibrated: Boolean(d.confidenceCalibrated),
      boundingBox: d.boundingBox,
    })),
    analysisId: payload.analysisId ?? null,
  };
};

function push(run: SimRun, event: Omit<SimEvent, 'id' | 'wallTime'>): SimEvent {
  const full: SimEvent = { ...event, id: run.internal.nextEventId++, wallTime: new Date().toISOString() };
  run.events.push(full);
  run.updatedAt = full.wallTime;
  return full;
}

function faultActive(run: SimRun, tS: number, kind: ScenarioFault['kind']): boolean {
  return run.scenario.faults.some(f => f.kind === kind && tS >= f.atS && tS < f.atS + f.durationS);
}

function envAt(run: SimRun, tS: number): ScenarioConfig['environment'][number] | undefined {
  const series = run.scenario.environment;
  return series.length ? series.reduce((acc, e) => (e.tS <= tS ? e : acc), series[0]) : undefined;
}

// ── Tracking (truth-free: nearest-neighbour on estimated ENU positions) ─────
function assignTrack(run: SimRun, tS: number, eastM: number, northM: number, depthM: number, uncertaintyM: number): TrackState {
  let best: TrackState | null = null;
  let bestDist = Infinity;
  for (const track of run.internal.tracks.values()) {
    // Gating: ACTIVE/STALE tracks within the gate; LOST tracks may re-associate
    // within a slightly wider gate so reappearance keeps the same identity
    // (coasts are stationary/slow in these scenarios).
    const gate = track.status === 'LOST' ? TIMING.reassociationGateM : TIMING.trackGateM;
    if (tS - track.lastTS > TIMING.trackMaxGapS && track.status !== 'LOST') continue;
    const d = Math.hypot(track.eastM - eastM, track.northM - northM);
    if (d < bestDist && d <= gate) { best = track; bestDist = d; }
  }
  if (best) {
    best.lastTS = tS;
    best.eastM = eastM; best.northM = northM; best.depthM = depthM; best.uncertaintyM = uncertaintyM;
    if (best.status !== 'ACTIVE') {
      best.status = 'ACTIVE';
      push(run, { tS, captureTime: null, type: 'TRACK_UPDATED', provenance: 'SIMULATED', trackId: best.trackId, position: { eastM, northM, depthM, uncertaintyM }, message: 'Track recovered' });
    }
    return best;
  }
  const trackId = `TRK-SIM-${String(++run.internal.trackSeq).padStart(3, '0')}`;
  const track: TrackState = {
    trackId, lastTS: tS, eastM, northM, depthM, uncertaintyM,
    status: 'ACTIVE', reviewStatus: 'UNREVIEWED', lastConfidence: null, lastFrameUrl: null, lastCaptureTime: null,
    alertKeyFired: new Set(),
  };
  run.internal.tracks.set(trackId, track);
  push(run, { tS, captureTime: null, type: 'TRACK_CREATED', provenance: 'SIMULATED', trackId, position: { eastM, northM, depthM, uncertaintyM } });
  push(run, {
    tS, captureTime: null, type: 'ALERT', provenance: 'SIMULATED', trackId,
    message: `New debris track ${trackId} formed from model detections`,
  });
  return track;
}

function maintainTracks(run: SimRun, tS: number): void {
  for (const track of run.internal.tracks.values()) {
    if (tS - track.lastTS > TIMING.lostAfterS && track.status !== 'LOST') {
      track.status = 'LOST';
      push(run, { tS, captureTime: null, type: 'TRACK_LOST', provenance: 'SIMULATED', trackId: track.trackId, position: { eastM: track.eastM, northM: track.northM, depthM: track.depthM, uncertaintyM: track.uncertaintyM }, message: 'Track expired after extended loss' });
    } else if (track.status === 'ACTIVE' && tS - track.lastTS > TIMING.staleAfterS) {
      track.status = 'STALE';
      push(run, { tS, captureTime: null, type: 'TRACK_STALE', provenance: 'SIMULATED', trackId: track.trackId, position: { eastM: track.eastM, northM: track.northM, depthM: track.depthM, uncertaintyM: track.uncertaintyM }, message: `No updates for > ${TIMING.staleAfterS}s of sim time` });
    }
  }
}

// ── Frame dispatch (real inference) ──────────────────────────────────────────
async function dispatchFrame(run: SimRun, record: FrameRecord, inference: InferenceFn): Promise<void> {
  // Deterministic simulated hang: the request never completes during the fault.
  if (faultActive(run, record.tS, 'ESPADA_TIMEOUT')) {
    run.health.consecutiveEspadaFailures++;
    run.health.espada = run.health.consecutiveEspadaFailures >= 2 ? 'DOWN' : 'DEGRADED';
    run.health.lastFailureTS = record.tS;
    run.health.droppedFrames++;
    push(run, { tS: record.tS, captureTime: null, type: 'FRAME_FAILED', provenance: 'SIMULATED', frameUrl: record.variant, message: 'Inference failed: ESPADA_TIMEOUT (simulated hang — no response within budget)' });
    return;
  }
  const timeoutMs = 8000;
  const captureWallMs = Date.now();
  const generation = run.restartCount;
  try {
    const result = await inference(record.variant, timeoutMs);
    if (run.restartCount !== generation || run.state === 'ABORTED') return;
    const queueDelayMs = Date.now() - captureWallMs;
    const pose = platformAt(run, record.tS) ?? { eastM: 0, northM: 0, headingDeg: 0 };
    run.health.espada = 'UP';
    run.health.espadaLastOkAt = new Date().toISOString();
    run.health.espadaLastError = null;
    run.health.consecutiveEspadaFailures = 0;
    run.health.queueDelayMs = queueDelayMs;
    run.health.lastFrameAtS = record.tS;
    if (run.health.lastFailureTS !== null) {
      run.health.lastRecoveryS = record.tS - run.health.lastFailureTS;
      run.health.lastFailureTS = null;
    }

    const { lat, lng } = enuToLatLng(pose.eastM, pose.northM);
    push(run, {
      tS: record.tS, captureTime: new Date(captureWallMs).toISOString(), type: 'FRAME_CAPTURED', provenance: 'SIMULATED',
      frameUrl: record.variant, scenarioObjectId: record.scenarioObjectId, scenarioObjectName: record.scenarioObjectName, scenarioDepthM: record.scenarioDepthM,
      message: record.glare ? 'AUV frame captured (glare variant)' : 'AUV frame captured',
      lat, lng, platform: { eastM: pose.eastM, northM: pose.northM, headingDeg: pose.headingDeg, speedMps: PLATFORM_SPEED_MPS },
    });

    record.preds = result.detections.map(detection => {
      const geo = geolocateBox(detection.boundingBox, pose);
      // RGB boxes cannot measure depth; never leak scenario ground truth.
      const depthM = 0;
      const track = assignTrack(run, record.tS, geo.eastM, geo.northM, depthM, Math.round(geo.rangeM * 0.15 + 2.5));
      track.lastConfidence = detection.confidence;
      track.lastFrameUrl = record.variant;
      track.lastCaptureTime = new Date().toISOString();
      const detectionId = `DET-SIM-${String(++run.internal.detectionCounter).padStart(4, '0')}`;
      const isBootstrap = !detection.confidenceCalibrated;
      push(run, {
        tS: record.tS, captureTime: new Date(captureWallMs).toISOString(), type: 'FRAME_INFERRED', provenance: 'MODEL_OUTPUT',
        detectionId, trackId: track.trackId, frameUrl: record.variant,
        scenarioObjectId: record.scenarioObjectId, scenarioObjectName: record.scenarioObjectName, scenarioDepthM: record.scenarioDepthM,
        className: detection.className,
        confidence: detection.confidence,
        rawConfidence: detection.rawConfidence,
        anomalyScore: isBootstrap,
        confidenceCalibrated: detection.confidenceCalibrated,
        analysisId: result.analysisId ?? null,
        reviewStatus: track.reviewStatus,
        position: { eastM: geo.eastM, northM: geo.northM, depthM, uncertaintyM: Math.round(geo.rangeM * 0.15 + 2.5) },
        lat: enuToLatLng(geo.eastM, geo.northM).lat,
        lng: enuToLatLng(geo.eastM, geo.northM).lng,
        latencyMs: result.latencyMs,
        depthEstimated: true,
        queueDelayMs,
        message: isBootstrap ? 'Bootstrap anomaly score (uncalibrated) — not model accuracy' : 'Model output',
      });
      return {
        bbox: detection.boundingBox, trackId: track.trackId,
        estEastM: geo.eastM, estNorthM: geo.northM,
      };
    });
  } catch (error) {
    if (run.restartCount !== generation || run.state === 'ABORTED') return;
    run.health.consecutiveEspadaFailures++;
    run.health.espadaLastError = error instanceof Error ? error.message : String(error);
    if (run.health.consecutiveEspadaFailures >= 2) run.health.espada = 'DOWN';
    else run.health.espada = 'DEGRADED';
    run.health.lastFailureTS = record.tS;
    run.health.droppedFrames++;
    push(run, {
      tS: record.tS, captureTime: null, type: 'FRAME_FAILED', provenance: 'SIMULATED',
      frameUrl: record.variant, message: `Inference failed: ${run.health.espadaLastError}`,
    });
  }
}

// ── Per-second simulation processing ─────────────────────────────────────────
function processSecond(run: SimRun, tS: number, inference: InferenceFn): Array<Promise<void>> {
  const s = run.scenario;
  const pose = platformAt(run, tS);

  // Operator script (mission-level events, distinct from run pause/resume).
  for (const action of s.operatorScript ?? []) {
    if (action.tS !== tS) continue;
    if (action.action === 'MISSION_PAUSE') {
      run.internal.missionPausedUntilS = tS + 30;
      push(run, { tS, captureTime: null, type: 'OPERATOR_ACTION', provenance: 'SIMULATED', message: action.note });
    } else if (action.action === 'MISSION_RESUME') {
      run.internal.missionPausedUntilS = Math.min(run.internal.missionPausedUntilS, tS);
      push(run, { tS, captureTime: null, type: 'OPERATOR_ACTION', provenance: 'SIMULATED', message: action.note });
    } else if (action.action === 'MISSION_ABORT' || action.action === 'MISSION_COMPLETE') {
      push(run, { tS, captureTime: null, type: 'MISSION_STATE', provenance: 'SIMULATED', message: action.note });
    } else {
      // Review workflow: apply the disposition to the most recent live detection.
      const lastDetection = [...run.events].reverse().find(e => e.type === 'FRAME_INFERRED' && e.reviewStatus === 'UNREVIEWED');
      if (lastDetection && lastDetection.trackId) {
        const track = run.internal.tracks.get(lastDetection.trackId);
        const reviewStatus: 'FALSE_POSITIVE' | 'CORRECTED' = action.action === 'REVIEW_FALSE_POSITIVE' ? 'FALSE_POSITIVE' : 'CORRECTED';
        lastDetection.reviewStatus = reviewStatus;
        if (track) track.reviewStatus = reviewStatus;
        push(run, { tS, captureTime: null, type: 'OPERATOR_ACTION', provenance: 'SIMULATED', trackId: lastDetection.trackId, detectionId: lastDetection.detectionId, reviewStatus, message: `${action.note} → ${reviewStatus}` });
      } else {
        push(run, { tS, captureTime: null, type: 'OPERATOR_ACTION', provenance: 'SIMULATED', message: `${action.note} — no unreviewed detection available; workflow step recorded` });
      }
    }
  }

  const missionPaused = tS < run.internal.missionPausedUntilS;

  // Telemetry each second (with sensor-quality faults).
  if (pose) {
    const rng = makeRng(s.seed + tS);
    const gpsNoise = faultActive(run, tS, 'GPS_NOISE');
    const missingLocation = faultActive(run, tS, 'MISSING_LOCATION');
    const delayed = faultActive(run, tS, 'DELAYED_TELEMETRY');
    const outOfOrder = faultActive(run, tS, 'OUT_OF_ORDER');
    const noiseEast = gpsNoise ? (rng() - 0.5) * 30 : 0;
    const noiseNorth = gpsNoise ? (rng() - 0.5) * 30 : 0;
    const { lat, lng } = enuToLatLng(pose.eastM + noiseEast, pose.northM + noiseNorth);
    const telemetryEvent: Omit<SimEvent, 'id' | 'wallTime'> = {
      tS,
      captureTime: delayed ? new Date(Date.now() - 20_000).toISOString() : null,
      type: 'TELEMETRY',
      provenance: 'SIMULATED',
      platform: { eastM: pose.eastM, northM: pose.northM, headingDeg: pose.headingDeg, speedMps: PLATFORM_SPEED_MPS },
      lat: missingLocation ? null : lat,
      lng: missingLocation ? null : lng,
      locationUnknown: missingLocation,
      message: missingLocation ? 'GPS fix unavailable — location UNKNOWN' : gpsNoise ? 'GPS noise active (±15 m)' : undefined,
    };
    push(run, telemetryEvent);
    if (!missingLocation && !missionPaused && !faultActive(run, tS, 'NETWORK_LOSS')) {
      const heading = pose.headingDeg * Math.PI / 180;
      const samples = Array.from({ length: 11 }, (_, i) => {
        const eastM = Math.round((pose.eastM + (i - 5) * 2 * Math.cos(heading)) / 2) * 2;
        const northM = Math.round((pose.northM - (i - 5) * 2 * Math.sin(heading)) / 2) * 2;
        // The AUV samples the same synthetic terrain drawn in 3D monitoring.
        // Scene z points south while run events use north-positive ENU.
        const depthM = Number(getPositiveDepth(eastM, -northM).toFixed(2));
        return { eastM, northM, depthM };
      });
      push(run, {
        tS, captureTime: new Date().toISOString(), type: 'BATHYMETRY', provenance: 'SIMULATED',
        bathymetry: { samples, cellSizeM: 2, source: 'SIMULATED_SONAR' }, message: 'Simulated sonar swath; not a measured ocean survey'
      });
    }
    if (outOfOrder) {
      // Out-of-order ingest: re-emit the previous second's fix after the current one.
      const prevPose = platformAt(run, Math.max(0, tS - 1));
      if (prevPose) {
        const prev = enuToLatLng(prevPose.eastM, prevPose.northM);
        push(run, { ...telemetryEvent, tS, captureTime: new Date(Date.now() - 1000).toISOString(), platform: { eastM: prevPose.eastM, northM: prevPose.northM, headingDeg: prevPose.headingDeg, speedMps: PLATFORM_SPEED_MPS }, lat: prev.lat, lng: prev.lng, message: 'Out-of-order telemetry sample (older fix ingested late)' });
      }
    }
  }

  // Environment every 30 s.
  const env = envAt(run, tS);
  if (env && env.tS === tS) {
    push(run, { tS, captureTime: null, type: 'ENVIRONMENT', provenance: 'SIMULATED', environment: { waveHeightM: env.waveHeightM, windMps: env.windMps, visibilityClass: env.visibilityClass, turbidity: env.turbidity } });
  }

  // Fault notices once at fault start.
  for (const fault of s.faults) {
    if (fault.atS === tS) push(run, { tS, captureTime: null, type: 'FAULT', provenance: 'SIMULATED', message: `Fault injected: ${fault.kind.replaceAll('_', ' ')} for ${fault.durationS}s` });
  }

  // Duplicate ingest events (dedupe check): every 5th duplicate is collapsed.
  if (faultActive(run, tS, 'DUPLICATE_EVENTS')) {
    run.internal.duplicatesReceived++;
    if (run.internal.duplicatesReceived % 5 === 0) {
      run.internal.duplicatesDropped++;
      push(run, { tS, captureTime: null, type: 'ALERT', provenance: 'SIMULATED', message: `[deduped] duplicate ingest collapsed by event id (received ${run.internal.duplicatesReceived})` });
    }
  }

  // Camera + inference.
  const pending: Array<Promise<void>> = [];
  const cameraDown = faultActive(run, tS, 'CAMERA_OUTAGE') || faultActive(run, tS, 'NETWORK_LOSS');
  if (cameraDown || missionPaused || s.telemetryOnly) {
    if (cameraDown) run.health.droppedFrames++;
  } else if (pose) {
    const glare = (s.glareWindows ?? []).some(([a, b]) => tS >= a && tS <= b);
    let capturedAny = false;
    for (const object of s.objects) {
      if (!inWindows(object.visibleS, tS)) continue;
      const truth = positionAt(object.track, tS);
      if (!truth) continue;
      const relEast = truth[0] - pose.eastM;
      const relNorth = truth[1] - pose.northM;
      const rangeM = Math.hypot(relEast, relNorth);
      if (rangeM > CAMERA.detectionRangeM) continue;
      // True relative bearing in the camera frame (heading = 0° ahead).
      const absoluteRad = Math.atan2(relEast, relNorth);
      const headingRad = (pose.headingDeg * Math.PI) / 180;
      let bearingDeg = ((absoluteRad - headingRad) * 180) / Math.PI;
      bearingDeg = ((bearingDeg + 180) % 360 + 360) % 360 - 180;
      // A real camera sees a cone: capture only within range AND the horizontal FOV.
      if (Math.abs(bearingDeg) > CAMERA.fovHDeg / 2) continue;
      const { rangeBucket, bearingBucket } = pickVariant(rangeM, bearingDeg);
      const variant = variantPath(object.id, rangeBucket, bearingBucket, glare);
      const truthBox = loadManifest().variants[variant];
      const record: FrameRecord = {
        frameId: `FRM-${run.id}-${tS}-${object.id}`,
        tS, variant, glare, scenarioObjectId: object.id, scenarioObjectName: object.name, scenarioDepthM: object.depthM,
        truthBoxes: truthBox ? [{ objectId: object.id, bbox: truthBox.bbox, eastM: truth[0], northM: truth[1] }] : [],
        preds: [],
      };
      run.internal.frameRecords.push(record);
      pending.push(dispatchFrame(run, record, inference));
      capturedAny = true;
    }
    if (!capturedAny && tS - run.internal.lastNegativeCaptureS >= 5) {
      run.internal.lastNegativeCaptureS = tS;
      const negative = glare ? loadManifest().negatives[1] ?? loadManifest().negatives[0] : loadManifest().negatives[0];
      if (negative) {
        const record: FrameRecord = { frameId: `FRM-${run.id}-${tS}-NEG`, tS, variant: negative, glare, truthBoxes: [], preds: [] };
        run.internal.frameRecords.push(record);
        pending.push(dispatchFrame(run, record, inference));
      }
    }
  }

  maintainTracks(run, tS);
  return pending;
}

// ── Metrics evaluator (truth used HERE only) ─────────────────────────────────
function iou(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): number {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width), y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

function percentile(values: number[], p: number): number | 'UNAVAILABLE' {
  if (!values.length) return 'UNAVAILABLE';
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] * 100) / 100;
}

export function computeMetrics(run: SimRun): RunMetrics {
  const s = run.scenario;
  const scored = run.internal.frameRecords.filter(record => record.truthBoxes.length > 0);
  let tp = 0, fp = 0, fn = 0;
  const localizationErrors: number[] = [];
  const identityByTrack = new Map<string, string[]>();
  for (const record of scored) {
    const remaining = record.truthBoxes.map((t, i) => ({ ...t, index: i }));
    for (const pred of record.preds) {
      let bestIoU = 0, bestTruth: typeof remaining[number] | null = null;
      for (const truth of remaining) {
        const score = iou(pred.bbox, truth.bbox);
        if (score > bestIoU) { bestIoU = score; bestTruth = truth; }
      }
      if (bestTruth && bestIoU >= 0.3) {
        tp++;
        remaining.splice(remaining.indexOf(bestTruth), 1);
        localizationErrors.push(Math.hypot(pred.estEastM - bestTruth.eastM, pred.estNorthM - bestTruth.northM));
        const seq = identityByTrack.get(pred.trackId) ?? [];
        seq.push(bestTruth.objectId);
        identityByTrack.set(pred.trackId, seq);
      } else {
        fp++;
      }
    }
    fn += remaining.length;
  }
  const framesScored = scored.length;
  const precision = tp + fp > 0 ? Math.round((tp / (tp + fp)) * 1000) / 1000 : 'UNAVAILABLE' as const;
  const recall = tp + fn > 0 ? Math.round((tp / (tp + fn)) * 1000) / 1000 : 'UNAVAILABLE' as const;
  const predictedUnique = [...identityByTrack.keys()].length;
  const identitySwaps = [...identityByTrack.values()].reduce((acc, seq) => acc + seq.slice(1).filter((id, i) => id !== seq[i]).length, 0);
  const rmse = localizationErrors.length
    ? Math.round(Math.sqrt(localizationErrors.reduce((acc, e) => acc + e * e, 0) / localizationErrors.length) * 10) / 10
    : 'UNAVAILABLE' as const;
  const scheduled = s.durationS * s.frameHz;
  const captured = run.internal.frameRecords.length;
  const failed = run.events.filter(e => e.type === 'FRAME_FAILED').length;
  const latencySamples = run.events.filter(e => e.type === 'FRAME_INFERRED').map(e => e.queueDelayMs ?? 0).map(ms => ms * run.speed / 1000);
  return {
    available: true,
    partial: run.state !== 'COMPLETED',
    frames: { scheduled, captured, dropped: run.health.droppedFrames, failed },
    perFrame: { precision, recall, framesScored, iouThreshold: 0.3 },
    uniqueObjectCount: {
      truth: s.objects.length,
      predicted: predictedUnique,
      error: s.objects.length > 0 && predictedUnique > 0 ? Math.abs(predictedUnique - s.objects.length) : 'UNAVAILABLE' as const,
    },
    identitySwaps,
    localization: { rmseM: rmse, n: localizationErrors.length },
    latency: {
      p50S: percentile(latencySamples, 0.5),
      p95S: percentile(latencySamples, 0.95),
      definition: 'Wall-clock queue delay per inference, converted to sim seconds at run speed (capture→inference-complete). Display polling adds ≤1 s wall.',
    },
    droppedFrameRate: scheduled > 0 ? Math.round((run.health.droppedFrames / scheduled) * 1000) / 1000 : 'UNAVAILABLE' as const,
    staleFeedBehaviorS: TIMING.staleAfterS,
    recoveryTimeS: run.health.lastRecoveryS ?? 'UNAVAILABLE',
    alertCount: run.events.filter(e => e.type === 'ALERT' && !e.message?.startsWith('[deduped]')).length,
    dedup: { duplicatesReceived: run.internal.duplicatesReceived, duplicatesDropped: run.internal.duplicatesDropped },
  };
}

// ── Clock ────────────────────────────────────────────────────────────────────
// SIM_TICK_MS shrinks the wall-clock tick for tests/demos; sim time advances by
// speed × elapsed, so semantics are unchanged.
const TICK_MS = Math.max(10, Number(process.env.SIM_TICK_MS) || 250);

function inferenceFor(run: SimRun): InferenceFn {
  return run._inference ?? realInference;
}

async function tick(runId: string): Promise<void> {
  const run = runs.get(runId);
  if (!run || run.state !== 'RUNNING' || run._ticking) return;
  run._ticking = true;
  try { await advanceRun(run, (TICK_MS / 1000) * run.speed, false); }
  finally { run._ticking = false; }
}

export interface ReplayCatalogueEntry {
  id: string;
  name: string;
  scenarioId: string;
  createdAt: string;
  eventsCount: number;
  detectionsCount: number;
  source: 'RECORDED' | 'SIMULATION';
}

export const replays = new Map<string, { meta: ReplayCatalogueEntry; dataset?: any }>();

// Seed Replay 1 (Recorded Mission)
replays.set('REPLAY-01', {
  meta: {
    id: 'REPLAY-01',
    name: 'Replay 1: Chennai Coastline Survey (Recorded Mission)',
    scenarioId: 'MSN-0001',
    createdAt: '2026-01-15T02:00:00.000Z',
    eventsCount: 1740,
    detectionsCount: 53,
    source: 'RECORDED',
  },
});

export function exportRunToReplayDataset(run: SimRun): any {
  const originLat = ENU_ORIGIN.lat;
  const originLon = ENU_ORIGIN.lng;
  const startTime = run.startedAt;
  const endTime = new Date(Date.parse(startTime) + run.tS * 1000).toISOString();

  const telemetryRows = run.events
    .filter(e => e.type === 'TELEMETRY')
    .map((e, idx) => ({
      telemetry_id: `TEL-SIM-${String(idx).padStart(5, '0')}`,
      mission_id: run.id,
      platform_id: 'PLT-SIM-01',
      seq: String(idx),
      event_time_utc: new Date(Date.parse(startTime) + e.tS * 1000).toISOString(),
      ingestion_time_utc: new Date(Date.parse(startTime) + (e.tS + 0.2) * 1000).toISOString(),
      sim_time_s: e.tS.toFixed(1),
      // A missing GPS fix is recorded as unknown, never as a coordinate at the
      // display origin (see the LOCATION UNKNOWN contract in runScene.ts).
      lat: e.lat === null || e.lat === undefined ? '' : String(e.lat),
      lon: e.lng === null || e.lng === undefined ? '' : String(e.lng),
      // Heading/speed are recorded only when the telemetry event carried them;
      // no fabricated default replaces a missing sensor reading.
      heading_deg: e.platform?.headingDeg !== undefined ? String(e.platform.headingDeg.toFixed(1)) : '',
      speed_mps: e.platform?.speedMps !== undefined ? String(e.platform.speedMps.toFixed(2)) : '',
      roll_deg: '0.0',
      pitch_deg: '0.0',
      location_unknown: e.locationUnknown ? 'true' : 'false',
      location_uncertainty_m: e.locationUnknown ? '' : '2.5',
      scenario_type: run.scenario.name,
      provenance: 'synthetic_simulation',
    }));

  const detectionRows = run.events
    .filter(e => e.type === 'FRAME_INFERRED')
    .map((e, idx) => ({
      detection_id: e.detectionId ?? `DET-SIM-${idx}`,
      mission_id: run.id,
      track_id: e.trackId ?? `TRK-SIM-${idx}`,
      sensor_id: 'SNS-CAM-01',
      event_time_utc: new Date(Date.parse(startTime) + e.tS * 1000).toISOString(),
      // Playback clock contract: replay positions events at capture/simulation
      // time (tS). A delayed inference result appears at the moment the frame
      // was captured, not when the operator received it — the queue delay is
      // preserved on the event (queueDelayMs) so a later ingestion-time display
      // can be derived without ever backdating or regenerating history.
      ingestion_time_utc: new Date(Date.parse(startTime) + (e.tS + 0.3) * 1000).toISOString(),
      class_name: e.className ?? 'Mixed Waste',
      confidence: String(e.confidence ?? ''),
      raw_confidence: String(e.rawConfidence ?? ''),
      calibrated: e.confidenceCalibrated ? 'true' : 'false',
      // Missing geolocation stays empty. Without a real fix there is no
      // observation location; the display origin is not a measurement.
      lat: e.lat === null || e.lat === undefined ? '' : String(e.lat),
      lon: e.lng === null || e.lng === undefined ? '' : String(e.lng),
      depth_m: e.depthEstimated ? '' : e.position?.depthM !== undefined ? String(e.position.depthM) : '',
      scenario_object_id: e.scenarioObjectId ?? '',
      scenario_object_name: e.scenarioObjectName ?? '',
      scenario_depth_m: e.scenarioDepthM !== undefined ? String(e.scenarioDepthM) : '',
      range_m: '',
      bearing_deg: '',
      image_fixture_url: e.frameUrl ?? '',
      provenance: 'synthetic_simulation',
    }));

  const trackRows = Array.from(run.internal.tracks.values()).map(t => ({
    track_id: t.trackId,
    mission_id: run.id,
    status: t.status.toLowerCase(),
    review_status: t.reviewStatus.toLowerCase(),
    object_class: 'Mixed Waste',
    first_seen_utc: startTime,
    last_seen_utc: new Date(Date.parse(startTime) + t.lastTS * 1000).toISOString(),
    confidence: String(t.lastConfidence ?? 60),
    provenance: 'synthetic_simulation',
  }));

  const alertRows = run.events
    .filter(e => e.type === 'ALERT')
    .map((e, idx) => ({
      alert_id: `ALT-SIM-${String(idx).padStart(4, '0')}`,
      mission_id: run.id,
      event_time_utc: new Date(Date.parse(startTime) + e.tS * 1000).toISOString(),
      alert_type: 'debris_detected',
      severity: 'warning',
      track_id: e.trackId ?? '',
      message: e.message ?? 'Debris contact detected',
      provenance: 'synthetic_simulation',
    }));

  const eventRows = run.events
    .filter(e => e.type === 'FAULT' || e.type === 'OPERATOR_ACTION' || e.type === 'MISSION_STATE')
    .map((e, idx) => ({
      event_id: `EVT-SIM-${String(idx).padStart(4, '0')}`,
      mission_id: run.id,
      event_time_utc: new Date(Date.parse(startTime) + e.tS * 1000).toISOString(),
      event_type: e.type.toLowerCase(),
      description: e.message ?? '',
      provenance: 'synthetic_simulation',
    }));

  const fixtures = [...new Set(run.events.flatMap(e => e.frameUrl ? [e.frameUrl] : []))];

  return {
    manifest: {
      label: 'SIMULATION',
      package: 'oceanguard_simulation_run',
      generated_at_utc: new Date().toISOString(),
      mission_id: run.id,
      mission_name: run.scenario.name,
      duration_s: run.tS,
      state: run.state,
      source_run_id: run.id,
      restart_count: run.restartCount,
    },
    events: structuredClone(run.events),
    run: runView(run),
    tables: {
      missions: [{
        mission_id: run.id,
        name: `${run.scenario.name} (Simulation Run)`,
        status: run.state.toLowerCase(),
        mission_type: 'surface_debris_survey',
        region_label: 'offshore_chennai_study_area_SIMULATED',
        start_time_utc: startTime,
        end_time_utc: endTime,
        timezone_display: 'Asia/Kolkata',
        origin_lat: String(originLat),
        origin_lon: String(originLon),
        scene_scale_m_per_unit: '1.0',
        axis_convention: 'ENU: +x=East(m), +y=North(m), +z=Up(m)',
        seed: String(run.scenario.seed),
        provenance: 'synthetic_simulation',
        schema_version: '0.1.0-unverified',
      }],
      platforms: [{
        platform_id: 'PLT-SIM-01',
        mission_id: run.id,
        platform_type: 'simulated_underwater_auv',
        name: 'OceanGuard AUV-01',
        provenance: 'synthetic_simulation',
      }],
      sensors: [
        { sensor_id: 'SNS-CAM-01', platform_id: 'PLT-SIM-01', sensor_type: 'simulated_auv_camera_rgb', sample_rate_hz: '1.0', provenance: 'synthetic_simulation' },
        { sensor_id: 'SNS-SONAR-01', platform_id: 'PLT-SIM-01', sensor_type: 'simulated_auv_multibeam', sample_rate_hz: '1.0', provenance: 'synthetic_simulation' },
      ],
      telemetry: telemetryRows,
      environmental_observations: [],
      object_truth: [],
      detections: detectionRows,
      tracks: trackRows,
      alerts: alertRows,
      scenario_events: eventRows,
    },
    fixtures,
  };
}

// One durable recording per execution. Atomic replacement prevents partial JSON.
const replayDirectory = path.resolve(process.env.SIM_REPLAY_DIR || (process.env.VERCEL
  ? path.join(os.tmpdir(), 'oceanguard-simulation-replays')
  : 'data/simulation-replays'));
const lastReplayWrite = new Map<string, number>();
if (fs.existsSync(replayDirectory)) {
  for (const file of fs.readdirSync(replayDirectory).filter(f => f.endsWith('.json'))) {
    try {
      const fullPath = path.join(replayDirectory, file);
      const item = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      if (item.meta?.id && item.dataset?.events) {
        if ((item.meta.detectionsCount ?? 0) === 0) {
          try { fs.unlinkSync(fullPath); } catch {}
        } else {
          replays.set(item.meta.id, item);
        }
      }
    } catch (error) { console.error(`Cannot load replay ${file}:`, error); }
  }
}
export function saveRunAsReplay(run: SimRun): ReplayCatalogueEntry {
  const replayId = `REPLAY-${run.id}-${Date.parse(run.startedAt)}-${run.restartCount}`;
  const previous = replays.get(replayId);
  const dataset = exportRunToReplayDataset(run);
  const meta: ReplayCatalogueEntry = {
    id: replayId, name: `${run.scenario.name} · ${run.id}`,
    scenarioId: run.scenario.id, createdAt: previous?.meta.createdAt ?? new Date().toISOString(),
    eventsCount: run.events.length,
    detectionsCount: run.events.filter(e => e.type === 'FRAME_INFERRED').length,
    source: run.mode === 'REPLAY' ? 'RECORDED' : 'SIMULATION',
  };
  const item = { meta, dataset };
  replays.set(replayId, item);
  try {
    fs.mkdirSync(replayDirectory, { recursive: true });
    const destination = path.join(replayDirectory, `${replayId}.json`);
    fs.writeFileSync(`${destination}.tmp`, JSON.stringify(item));
    fs.renameSync(`${destination}.tmp`, destination);
    lastReplayWrite.set(run.id, Date.now());
    run.recordingError = undefined;
  } catch (error) { run.recordingError = error instanceof Error ? error.message : String(error); }
  return meta;
}

function completeRun(run: SimRun): void {
  if (run.state === 'COMPLETED' || run.state === 'ABORTED') return;
  run.state = 'COMPLETED';
  run.completedAt = new Date().toISOString();
  run.metrics = computeMetrics(run);
  push(run, { tS: run.tS, captureTime: null, type: 'RUN_STATE', provenance: 'SIMULATED', message: 'Run completed; metrics computed' });
  const timer = timers.get(run.id);
  if (timer) { clearInterval(timer); timers.delete(run.id); }
  saveRunAsReplay(run);
}

function stopTimer(runId: string): void {
  const timer = timers.get(runId);
  if (timer) { clearInterval(timer); timers.delete(runId); }
}

function startTimer(run: SimRun): void {
  stopTimer(run.id);
  timers.set(run.id, setInterval(() => {
    if (run.mode === 'REPLAY') replayTick(run.id);
    else void tick(run.id);
  }, TICK_MS));
  timers.get(run.id)?.unref();
}

export function createRun(scenarioId: string, speed = 1, inference?: InferenceFn, runSeed?: number): SimRun {
  const factory = SCENARIO_FACTORIES[scenarioId];
  if (!factory) throw new Error(`Unknown scenario ${scenarioId}`);
  // In tests with fakeInference, keep reproducible default 20260922; otherwise randomize seed unless specified
  const seed = runSeed ?? (inference ? 20260922 : (Date.now() % 1_000_000 + Math.floor(Math.random() * 9999)));
  const scenario = factory(seed);
  const id = `SIM-RUN-${String(++runCounter).padStart(4, '0')}`;
  const run: SimRun = {
    id, scenario, mode: scenario.mode, state: 'RUNNING', tS: 0, speed, restartCount: 0,
    startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    events: [],
    health: {
      espada: 'UP', espadaLastOkAt: null, espadaLastError: null, feed: 'FRESH',
      lastFrameAtS: null, queueDelayMs: 0, droppedFrames: 0, consecutiveEspadaFailures: 0,
      lastFailureTS: null, lastRecoveryS: null,
    },
    metrics: null,
    internal: {
      lastProcessedS: 0, nextEventId: 1, detectionCounter: 0, trackSeq: 0,
      tracks: new Map(), frameRecords: [], missionPausedUntilS: 0, lastNegativeCaptureS: 0,
      duplicatesReceived: 0, duplicatesDropped: 0, aborted: false,
    },
  };
  if (inference) run._inference = inference;
  runs.set(id, run);
  push(run, { tS: 0, captureTime: null, type: 'RUN_STATE', provenance: 'SIMULATED', message: `Run ${id} started (scenario ${scenarioId}, seed ${seed}, speed ${speed}×)` });
  push(run, { tS: 0, captureTime: null, type: 'MISSION_STATE', provenance: 'SIMULATED', message: 'Mission IN_PROGRESS (simulated)' });
  saveRunAsReplay(run);
  startTimer(run);
  return run;
}

/**
 * Deterministically advance a run by whole sim seconds, awaiting all in-flight
 * inference. Test/demo hook — the live clock is unchanged.
 */
export async function advanceRun(run: SimRun, seconds: number, persistImmediately = true): Promise<void> {
  if (run.state !== 'RUNNING') return;
  // A recorded replay has no scenario to simulate: its clock is a cursor into
  // the recorded timeline. Advancing it here (instead of only from the wall
  // clock) keeps demo/test runs ingesting their own observations.
  if (run.internal.replay) { advanceReplayClock(run, seconds); return; }
  const target = Math.min(run.scenario.durationS, run.tS + seconds);
  const inference = inferenceFor(run);
  const generation = run.restartCount;
  while (run.state === 'RUNNING' && run.restartCount === generation && run.internal.lastProcessedS + 1 <= Math.floor(target)) {
    run.internal.lastProcessedS++;
    run.tS = Math.max(run.tS, run.internal.lastProcessedS);
    await Promise.all(processSecond(run, run.internal.lastProcessedS, inference));
  }
  if (run.restartCount !== generation) return;
  if (run.state !== 'RUNNING') { saveRunAsReplay(run); return; }
  run.tS = Math.max(run.tS, target);
  run.health.feed = run.health.lastFrameAtS === null
    ? 'FRESH'
    : run.tS - run.health.lastFrameAtS > TIMING.staleAfterS ? 'STALE' : 'FRESH';
  if (run.tS >= run.scenario.durationS) completeRun(run);
  else if (persistImmediately || Date.now() - (lastReplayWrite.get(run.id) ?? 0) >= 1500) saveRunAsReplay(run);
}

export function getRun(id: string): SimRun | undefined { return runs.get(id); }
export function listRuns(): Array<Pick<SimRun, 'id' | 'state' | 'mode' | 'tS' | 'speed'> & { scenarioId: string; name: string }> {
  return [...runs.values()].map(run => ({
    id: run.id, state: run.state, mode: run.mode, tS: Math.round(run.tS * 10) / 10,
    speed: run.speed, scenarioId: run.scenario.id, name: run.scenario.name,
  }));
}

export function pauseRun(id: string): SimRun | null {
  const run = runs.get(id);
  if (!run || run.state !== 'RUNNING') return null;
  run.state = 'PAUSED';
  stopTimer(id);
  push(run, { tS: run.tS, captureTime: null, type: 'RUN_STATE', provenance: 'SIMULATED', message: 'Run paused — simulation clock stopped, no duplicate processing on resume' });
  saveRunAsReplay(run);
  return run;
}

export function resumeRun(id: string): SimRun | null {
  const run = runs.get(id);
  if (!run || run.state !== 'PAUSED') return null;
  run.state = 'RUNNING';
  startTimer(run);
  push(run, { tS: run.tS, captureTime: null, type: 'RUN_STATE', provenance: 'SIMULATED', message: 'Run resumed from simulation clock' });
  return run;
}

export function restartRun(id: string): SimRun | null {
  const run = runs.get(id);
  if (!run) return null;
  stopTimer(id);
  saveRunAsReplay(run);
  const replay = run.internal.replay;
  run.tS = 0;
  run.startedAt = new Date().toISOString();
  run.state = 'RUNNING';
  run.restartCount++;
  run.completedAt = undefined;
  run.metrics = null;
  run.events = [];
  run.health = {
    espada: 'UP', espadaLastOkAt: null, espadaLastError: null, feed: 'FRESH',
    lastFrameAtS: null, queueDelayMs: 0, droppedFrames: 0, consecutiveEspadaFailures: 0,
    lastFailureTS: null, lastRecoveryS: null,
  };
  run.internal = {
    lastProcessedS: 0, nextEventId: 1, detectionCounter: 0, trackSeq: 0,
    tracks: new Map(), frameRecords: [], missionPausedUntilS: 0, lastNegativeCaptureS: 0,
    duplicatesReceived: 0, duplicatesDropped: 0, aborted: false,
    ...(replay ? { replay: { ...replay, cursors: { telemetry: 0, detections: 0, alerts: 0, scenario_events: 0 }, seenDetections: new Set<string>() } } : {}),
  };
  push(run, { tS: 0, captureTime: null, type: 'RUN_STATE', provenance: 'SIMULATED', message: `Run restarted (restart #${run.restartCount})` });
  startTimer(run);
  return run;
}

export function abortRun(id: string): SimRun | null {
  const run = runs.get(id);
  if (!run || run.state === 'COMPLETED') return null;
  run.state = 'ABORTED';
  run.completedAt = new Date().toISOString();
  run.metrics = computeMetrics(run);
  stopTimer(id);
  push(run, { tS: run.tS, captureTime: null, type: 'RUN_STATE', provenance: 'SIMULATED', message: 'Run aborted by operator; partial metrics computed' });
  saveRunAsReplay(run);
  return run;
}

export function setSpeed(id: string, speed: number): SimRun | null {
  const run = runs.get(id);
  if (!run || !Number.isFinite(speed) || speed <= 0 || speed > 600) return null;
  run.speed = speed;
  run.updatedAt = new Date().toISOString();
  return run;
}

// ── Replay runner (recorded dataset, original timestamps preserved) ─────────
interface ReplayDataset { tables: Record<string, Array<Record<string, string>>>; manifest?: Record<string, unknown> }
let replayDatasetCache: ReplayDataset | null = null;
function loadReplayDataset(): ReplayDataset {
  if (replayDatasetCache) return replayDatasetCache;
  const p = path.resolve(process.cwd(), 'public/simulation/mission.json');
  replayDatasetCache = JSON.parse(fs.readFileSync(p, 'utf-8')) as ReplayDataset;
  return replayDatasetCache;
}

export function createReplayRun(speed = 60): SimRun {
  const data = loadReplayDataset();
  const tables = data.tables;
  const startMs = Date.parse(tables.missions[0].start_time_utc);
  const endMs = Date.parse(tables.missions[0].end_time_utc);
  // The replay clock must cover every recorded ingestion, including samples
  // whose ingest time falls just past the mission's declared end (the dataset's
  // delayed final fix). Otherwise those observations are silently dropped.
  const lastIngestionMs = Object.values(tables).flat().reduce((latest, row) => {
    const at = Date.parse(row.ingestion_time_utc || row.event_time_utc);
    return Number.isFinite(at) ? Math.max(latest, at) : latest;
  }, endMs);
  const durationS = Math.max(0, Math.max(endMs, lastIngestionMs) - startMs) / 1000;
  const id = `SIM-RUN-${String(++runCounter).padStart(4, '0')}`;
  const scenario: ScenarioConfig = {
    id: 'REPLAY-MSN-0001',
    name: String(tables.missions[0].name ?? 'Recorded mission replay'),
    description: 'Recorded synthetic mission replayed against its original event timeline; original capture timestamps preserved.',
    mode: 'REPLAY', durationS, seed: 20260922, frameHz: 0,
    origin: ENU_ORIGIN, platform: [], objects: [], faults: [], environment: [],
  };
  const run: SimRun = {
    id, scenario, mode: 'REPLAY', state: 'RUNNING', tS: 0, speed, restartCount: 0,
    startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    events: [],
    health: {
      espada: 'UP', espadaLastOkAt: null, espadaLastError: null, feed: 'FRESH',
      lastFrameAtS: null, queueDelayMs: 0, droppedFrames: 0, consecutiveEspadaFailures: 0,
      lastFailureTS: null, lastRecoveryS: null,
    },
    metrics: null,
    internal: {
      lastProcessedS: 0, nextEventId: 1, detectionCounter: 0, trackSeq: 0,
      tracks: new Map(), frameRecords: [], missionPausedUntilS: 0, lastNegativeCaptureS: 0,
      duplicatesReceived: 0, duplicatesDropped: 0, aborted: false,
      replay: { tables, startMs, endMs, cursors: { telemetry: 0, detections: 0, alerts: 0, scenario_events: 0 }, missionId: String(tables.missions[0].mission_id ?? 'MSN-0001'), seenDetections: new Set<string>() },
    },
  };
  runs.set(id, run);
  push(run, { tS: 0, captureTime: new Date(startMs).toISOString(), type: 'RUN_STATE', provenance: 'RECORDED', message: `Replay of ${run.internal.replay?.missionId} started (recorded evidence; no live source)` });
  startTimer(run);
  return run;
}

/** Public event view: events carry no ground truth by construction. */
export function publicEvents(run: SimRun, sinceId: number): SimEvent[] {
  return run.events.filter(e => e.id > sinceId);
}

function replayIngest(run: SimRun): void {
  const replay = run.internal.replay;
  if (!replay) return;
  const clockMs = replay.startMs + run.tS * 1000;
  const sortIngest = (rows: Array<Record<string, string>>) => [...rows].sort((a, b) => Date.parse(a.ingestion_time_utc || a.event_time_utc) - Date.parse(b.ingestion_time_utc || b.event_time_utc));
  // A large playback tick can cover many recorded observations at once. Each
  // event is stamped with its own ingestion offset from the recording start so
  // a batch never collapses onto the enclosing tick's time. The original
  // capture time is still preserved separately on `captureTime`.
  const ingestionOffsetS = (ms: number) => Math.max(0, (ms - replay.startMs) / 1000);
  type ReplayKind = 'telemetry' | 'detections' | 'alerts' | 'scenario_events';
  const kinds: ReplayKind[] = ['telemetry', 'detections', 'alerts', 'scenario_events'];
  const pending: Array<{ kind: ReplayKind; row: Record<string, string>; at: number; order: number }> = [];
  for (const [order, kind] of kinds.entries()) {
    const rows = sortIngest(replay.tables[kind] ?? []);
    const at = (row: Record<string, string>) => Date.parse(kind === 'scenario_events' ? row.window_start_utc : row.ingestion_time_utc || row.event_time_utc);
    while (replay.cursors[kind] < rows.length && at(rows[replay.cursors[kind]]) <= clockMs) {
      const row = rows[replay.cursors[kind]++];
      pending.push({ kind, row, at: at(row), order });
    }
  }
  // One order for both a single jump and many small ticks; ids follow arrival time.
  pending.sort((a, b) => a.at - b.at || a.order - b.order);
  for (const { kind, row, at } of pending) {
    const tS = ingestionOffsetS(at);
    if (kind === 'telemetry') {
      const validFix = row.lat !== '' && row.lon !== '' && Number.isFinite(Number(row.lat)) && Number.isFinite(Number(row.lon)) && row.location_unknown !== 'true';
      const enu = validFix ? latLngToEnu(Number(row.lat), Number(row.lon)) : null;
      push(run, {
        tS, captureTime: row.event_time_utc, type: 'TELEMETRY', provenance: 'RECORDED',
        platform: enu ? { eastM: enu.eastM, northM: enu.northM, headingDeg: Number(row.heading_deg), speedMps: Number(row.speed_mps) } : undefined,
        lat: validFix ? Number(row.lat) : null, lng: validFix ? Number(row.lon) : null,
        locationUnknown: !validFix, message: `seq ${row.seq}`,
      });
      run.health.lastFrameAtS = tS;
    } else if (kind === 'detections') {
      if (replay.seenDetections.has(row.detection_id)) continue;
      replay.seenDetections.add(row.detection_id);
      const telemetryRow = (replay.tables.telemetry ?? []).find(t => t.seq === row.telemetry_seq);
      const hasPose = telemetryRow && telemetryRow.lat !== '' && telemetryRow.lon !== '' && Number.isFinite(Number(telemetryRow.lat)) && Number.isFinite(Number(telemetryRow.lon)) && telemetryRow.location_unknown !== 'true';
      const pose = hasPose ? latLngToEnu(Number(telemetryRow.lat), Number(telemetryRow.lon)) : null;
      const rangeM = Number(row.range_m_estimate) || 15;
      const bearingRad = ((Number(row.bearing_deg_estimate) || 0) * Math.PI) / 180;
      push(run, {
        tS, captureTime: row.event_time_utc ?? null, type: 'FRAME_INFERRED', provenance: 'RECORDED',
        detectionId: row.detection_id, trackId: `TRK-REC-${row.object_id ?? row.detection_id}`,
        frameUrl: row.frame_fixture ?? undefined, className: row.class_name ?? 'Mixed Waste',
        scenarioObjectId: row.scenario_object_id || undefined,
        scenarioObjectName: row.scenario_object_name || undefined,
        scenarioDepthM: row.scenario_depth_m === '' || row.scenario_depth_m === undefined ? undefined : Number(row.scenario_depth_m),
        depthEstimated: row.depth_m === '' || row.depth_m === undefined,
        message: `Recorded simulated detection (derived from ground truth; not model output) · review ${row.review_status ?? 'unreviewed'}`,
        position: pose ? { eastM: pose.eastM + rangeM * Math.sin(bearingRad), northM: pose.northM + rangeM * Math.cos(bearingRad), depthM: Number(row.depth_m) || 0, uncertaintyM: rangeM * 0.2 + 2.5 } : undefined,
        locationUnknown: !pose, reviewStatus: 'UNREVIEWED',
      });
    } else if (kind === 'alerts') {
      const recorded = (replay.tables.tracks ?? []).find(track => track.track_id === row.related_track_id);
      const objectId = recorded?.ground_truth_object_id ?? row.related_track_id;
      push(run, {
        tS, captureTime: row.event_time_utc ?? null, type: 'ALERT', provenance: 'RECORDED',
        trackId: objectId ? `TRK-REC-${objectId}` : undefined,
        message: `${row.alert_type?.replaceAll('_', ' ') ?? 'Alert'} (arrival delay ${Math.round((Date.parse(row.ingestion_time_utc) - Date.parse(row.event_time_utc)) / 1000)}s)`,
      });
    } else {
      push(run, { tS, captureTime: row.window_start_utc ?? null, type: 'FAULT', provenance: 'RECORDED', message: `Scenario window: ${row.scenario_type} — ${row.description ?? ''}` });
    }
  }

  if (run.tS >= run.scenario.durationS) completeRun(run);
}

/** Advance a recorded replay's clock and ingest every observation that arrived
 *  by the new sim time. Ingestion is cursor-driven, so one large step emits
 *  exactly the same events in the same order as many small steps. */
function advanceReplayClock(run: SimRun, seconds: number): void {
  run.tS = Math.min(run.scenario.durationS, run.tS + seconds);
  replayIngest(run);
  if (run.tS >= run.scenario.durationS) completeRun(run);
}

function replayTick(runId: string): void {
  const run = runs.get(runId);
  if (!run || run.state !== 'RUNNING' || !run.internal.replay) return;
  advanceReplayClock(run, (TICK_MS / 1000) * run.speed);
}

// ── Public mode/status ───────────────────────────────────────────────────────
export function sourceModes() {
  return {
    LIVE: { available: false, reason: 'No authorized live mission source exists in this deployment. No live telemetry, imagery, or ongoing mission records are connected. Use REPLAY or SIMULATION; no mission is invented as live.' },
    REPLAY: { available: true, dataset: 'public/simulation/mission.json', provenance: 'Synthetic recorded dataset (seed 20260922), played against its original event timeline.' },
    SIMULATION: { available: true, note: 'Generated telemetry + synthetic frames through the real ESPADA /v1/detect path. Telemetry-only aspects cannot demonstrate visual detection accuracy.' },
  };
}

// ── Express router ───────────────────────────────────────────────────────────
export const simulationRouter = Router();

simulationRouter.get('/modes', (_req: Request, res: Response) => res.json(sourceModes()));

simulationRouter.get('/scenarios', (_req: Request, res: Response) => {
  res.json({
    scenarios: ['SIM-FOV', 'SIM-BENTHIC-02', 'SIM-SURGE-03'].map(id => {
      const cfg = SCENARIO_FACTORIES[id](20260922);
      return { id, name: cfg.name, description: cfg.description, mode: cfg.mode, durationS: cfg.durationS, seed: cfg.seed };
    }),
  });
});

simulationRouter.get('/runs', (_req: Request, res: Response) => res.json({ runs: listRuns() }));

simulationRouter.post('/runs', (req: Request, res: Response) => {
  const { scenarioId, speed } = req.body as { scenarioId?: string; speed?: number };
  if (scenarioId === 'REPLAY-MSN-0001') {
    const run = createReplayRun(Number(speed) || 60);
    res.status(201).json({ run: runView(run) });
    return;
  }
  if (!scenarioId || !SCENARIO_IDS.includes(scenarioId)) {
    res.status(400).json({ message: `Unknown scenario. Available: ${SCENARIO_IDS.join(', ')}, REPLAY-MSN-0001` });
    return;
  }
  try {
    const run = createRun(scenarioId, Number(speed) || 1);
    res.status(201).json({ run: runView(run) });
  } catch (error) {
    res.status(500).json({ message: error instanceof Error ? error.message : 'Run could not start.' });
  }
});

simulationRouter.get('/runs/:id', (req: Request, res: Response) => {
  const run = runs.get(req.params.id);
  if (!run) { res.status(404).json({ message: 'Run not found.' }); return; }
  res.json({ run: runView(run) });
});

simulationRouter.post('/runs/:id/pause', (req: Request, res: Response) => {
  const run = pauseRun(req.params.id);
  if (!run) { res.status(409).json({ message: 'Run is not running.' }); return; }
  res.json({ run: runView(run) });
});

simulationRouter.post('/runs/:id/resume', (req: Request, res: Response) => {
  const run = resumeRun(req.params.id);
  if (!run) { res.status(409).json({ message: 'Run is not paused.' }); return; }
  res.json({ run: runView(run) });
});

simulationRouter.post('/runs/:id/restart', (req: Request, res: Response) => {
  const run = restartRun(req.params.id);
  if (!run) { res.status(404).json({ message: 'Run not found.' }); return; }
  res.json({ run: runView(run) });
});

simulationRouter.post('/runs/:id/abort', (req: Request, res: Response) => {
  const run = abortRun(req.params.id);
  if (!run) { res.status(404).json({ message: 'Run not found or already completed.' }); return; }
  res.json({ run: runView(run) });
});

simulationRouter.patch('/runs/:id', (req: Request, res: Response) => {
  const { speed } = req.body as { speed?: number };
  const run = setSpeed(req.params.id, Number(speed));
  if (!run) { res.status(400).json({ message: 'Invalid speed or run not found.' }); return; }
  res.json({ run: runView(run) });
});

simulationRouter.get('/runs/:id/events', (req: Request, res: Response) => {
  const run = runs.get(req.params.id);
  if (!run) { res.status(404).json({ message: 'Run not found.' }); return; }
  const since = Number(req.query.since) || 0;
  res.json({ state: run.state, recordingError: run.recordingError ?? null, events: publicEvents(run, since), cursor: { tS: Math.round(run.tS * 10) / 10, lastEventId: run.internal.nextEventId - 1 }, health: run.health });
});

simulationRouter.post('/runs/:id/review', (req: Request, res: Response) => {
  const run = runs.get(req.params.id);
  if (!run) { res.status(404).json({ message: 'Run not found.' }); return; }
  const { trackId, detectionId, verdict, correctedClass, note } = req.body as {
    trackId?: string;
    detectionId?: string;
    verdict?: 'CONFIRMED' | 'FALSE_POSITIVE' | 'CORRECTED';
    correctedClass?: string;
    note?: string;
  };
  if (!verdict || !['CONFIRMED', 'FALSE_POSITIVE', 'CORRECTED'].includes(verdict)) {
    res.status(400).json({ message: 'Verdict must be CONFIRMED, FALSE_POSITIVE, or CORRECTED.' });
    return;
  }
  if (trackId && run.internal.tracks.has(trackId)) {
    const track = run.internal.tracks.get(trackId)!;
    track.reviewStatus = verdict;
  }
  // Reviews are new observations; never rewrite what earlier replay frames knew.
  push(run, {
    tS: run.tS,
    captureTime: null,
    type: 'OPERATOR_ACTION',
    provenance: run.mode === 'REPLAY' ? 'RECORDED' : 'SIMULATED',
    trackId,
    detectionId,
    reviewStatus: verdict,
    message: `Operator review submitted: ${verdict}${note ? ` — ${note}` : ''}${correctedClass ? ` (corrected class: ${correctedClass})` : ''}`,
  });
  saveRunAsReplay(run);
  if (run.recordingError) { res.status(507).json({ message: 'Review is in memory but could not be saved to disk. Retry saving the recording.', recordingError: run.recordingError }); return; }
  res.json({ ok: true, verdict, trackId, detectionId });
});

simulationRouter.get('/runs/:id/metrics', (req: Request, res: Response) => {
  const run = runs.get(req.params.id);
  if (!run) { res.status(404).json({ message: 'Run not found.' }); return; }
  if (run.mode === 'REPLAY') {
    res.json({ metrics: { available: false, reason: 'Replay contains recorded simulated detections, not model output; detection accuracy is unavailable by construction. See tests/replay.test.ts for dataset integrity checks.' } });
    return;
  }
  res.json({ metrics: run.metrics ?? computeMetrics(run) });
});

simulationRouter.get('/replays', (_req: Request, res: Response) => {
  const all = Array.from(replays.values()).map(r => r.meta).filter(m => m.id === 'REPLAY-01' || (m.detectionsCount ?? 0) > 0);
  const seen = new Map<string, ReplayCatalogueEntry>();
  for (const m of all) {
    if (m.id === 'REPLAY-01') {
      seen.set(m.id, m);
      continue;
    }
    const baseName = m.name.replace(/\s*·\s*SIM-RUN-\d+/i, '').trim();
    const sig = `${m.scenarioId}__${baseName}__${m.detectionsCount}`;
    const existing = seen.get(sig);
    if (!existing || Date.parse(m.createdAt || '0') > Date.parse(existing.createdAt || '0')) {
      seen.set(sig, m);
    }
  }
  res.json({ replays: Array.from(seen.values()) });
});

simulationRouter.delete('/replays/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  if (!/^REPLAY-SIM-RUN-\d{4,}-\d+-\d+$/.test(id) || !replays.has(id)) {
    res.status(404).json({ message: 'Saved recording not found.' });
    return;
  }
  const targetFile = path.resolve(replayDirectory, `${id}.json`);
  if (path.dirname(targetFile) !== replayDirectory) {
    res.status(400).json({ message: 'Invalid recording ID.' });
    return;
  }
  try {
    if (fs.existsSync(targetFile)) fs.unlinkSync(targetFile);
    replays.delete(id);
    res.json({ ok: true, deleted: id });
  } catch {
    res.status(500).json({ message: 'Could not delete the saved recording.' });
  }
});

simulationRouter.get('/replays/:id', (req: Request, res: Response) => {
  const item = replays.get(req.params.id);
  if (!item) {
    res.status(404).json({ message: 'Replay not found.' });
    return;
  }
  if (item.meta.id === 'REPLAY-01') {
    const missionPath = path.resolve(process.cwd(), 'public/simulation/mission.json');
    if (fs.existsSync(missionPath)) {
      res.setHeader('Content-Type', 'application/json');
      res.send(fs.readFileSync(missionPath, 'utf8'));
      return;
    }
  }
  res.json(item.dataset);
});

simulationRouter.post('/runs/:id/save-replay', (req: Request, res: Response) => {
  const run = runs.get(req.params.id);
  if (!run) { res.status(404).json({ message: 'Run not found.' }); return; }
  const meta = saveRunAsReplay(run);
  if (run.recordingError) { res.status(507).json({ message: 'Recording could not be saved to disk. Observations remain in memory; retry saving.', recordingError: run.recordingError }); return; }
  res.json({ ok: true, replay: meta });
});

export function runView(run: SimRun) {
  return {
    id: run.id,
    scenarioId: run.scenario.id,
    scenarioName: run.scenario.name,
    scenarioDescription: run.scenario.description,
    mode: run.mode,
    state: run.state,
    tS: Math.round(run.tS * 10) / 10,
    durationS: run.scenario.durationS,
    speed: run.speed,
    restartCount: run.restartCount,
    startedAt: run.startedAt,
    completedAt: run.completedAt ?? null,
    seed: run.scenario.seed,
    health: run.health,
    telemetryOnly: Boolean(run.scenario.telemetryOnly),
    recordingError: run.recordingError ?? null,
    liveUnavailableReason: sourceModes().LIVE.reason,
  };
}
