import { authorizedFetch } from '../../lib/auth';
/**
 * Client for the isolated simulation run registry (`/api/simulation`).
 *
 * The 3D view and console here consume ONLY this event log — never operational
 * records, and never ground truth (the server filters truth out of the public
 * event view by construction; see src/server/simulation.ts).
 */

export type RunState = 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'ABORTED';
export type FeedStatus = 'FRESH' | 'STALE' | 'INTERRUPTED';

export interface RunHealth {
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
}

export interface RunSummary {
  id: string;
  scenarioId: string;
  scenarioName: string;
  scenarioDescription: string;
  mode: 'LIVE' | 'REPLAY' | 'SIMULATION';
  state: RunState;
  tS: number;
  durationS: number;
  speed: number;
  restartCount: number;
  startedAt: string;
  completedAt: string | null;
  seed: number;
  health: RunHealth;
  telemetryOnly: boolean;
  liveUnavailableReason: string;
  recordingError?: string | null;
}

export interface SimEvent {
  id: number;
  tS: number;
  wallTime: string;
  captureTime: string | null;
  type:
  | 'FRAME_CAPTURED' | 'FRAME_INFERRED' | 'FRAME_FAILED' | 'TELEMETRY' | 'ENVIRONMENT'
  | 'TRACK_CREATED' | 'TRACK_UPDATED' | 'TRACK_STALE' | 'TRACK_LOST'
  | 'BATHYMETRY' | 'ALERT' | 'MISSION_STATE' | 'FAULT' | 'OPERATOR_ACTION' | 'RUN_STATE';
  provenance: 'SIMULATED' | 'RECORDED' | 'MODEL_OUTPUT';
  bathymetry?: { samples: Array<{ eastM: number; northM: number; depthM: number }>; cellSizeM: number; source: 'SIMULATED_SONAR' | 'SENSOR' };
  detectionId?: string;
  trackId?: string;
  frameUrl?: string;
  className?: string;
  scenarioObjectId?: string;
  scenarioObjectName?: string;
  scenarioDepthM?: number;
  confidence?: number;
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

/** A live view of one run: latest summary, all events so far, derived track states. */
export interface RunFeed {
  run: RunSummary;
  events: SimEvent[];
  /** Latest telemetry fix, or null before the first fix arrives. */
  platform: { eastM: number; northM: number; headingDeg: number; speedMps: number } | null;
  /** True while the GPS fix is missing (MISSING_LOCATION fault): render UNKNOWN, never invent a position. */
  platformLocationUnknown: boolean;
  /** Derived track states keyed by trackId (latest known status/position). */
  tracks: Map<string, {
    trackId: string;
    status: 'ACTIVE' | 'STALE' | 'LOST';
    eastM: number;
    northM: number;
    uncertaintyM: number;
    reviewStatus: SimEvent['reviewStatus'];
    lastEventId: number;
    scenarioObjectId?: string;
    scenarioObjectName?: string;
    scenarioDepthM?: number;
    className?: string;
    confidence?: number;
    lastFrameUrl?: string;
    lastCaptureTime?: string | null;
  }>;
  bathymetry: Map<string, { eastM: number; northM: number; depthM: number; cellSizeM: number; source: string }>;
  lastEnvironment: SimEvent['environment'] | null;
  /** Live detection→display latency per event, in seconds of sim time (if speed > 0). */
  displayLatencyS: Array<{ detectionId: string; latencyS: number }>;
  lastEventId: number;
}

export const EMPTY_FEED: RunFeed = {
  run: null as unknown as RunSummary,
  events: [],
  platform: null,
  platformLocationUnknown: false,
  tracks: new Map(),
  bathymetry: new Map(),
  lastEnvironment: null,
  displayLatencyS: [],
  lastEventId: 0,
};

/** Fold a batch of new events into a feed, updating the derived track states. */
export function foldEvents(feed: RunFeed, events: SimEvent[], run?: RunSummary): RunFeed {
  const accepted = [...new Map(events.filter(event => event.id > feed.lastEventId).map(event => [event.id, event])).values()].sort((a, b) => a.id - b.id);
  const next: RunFeed = {
    run: run ?? feed.run,
    events: accepted.length ? [...feed.events, ...accepted] : feed.events,
    platform: feed.platform,
    platformLocationUnknown: feed.platformLocationUnknown,
    tracks: new Map(feed.tracks),
    bathymetry: new Map(feed.bathymetry),
    lastEnvironment: feed.lastEnvironment,
    displayLatencyS: feed.displayLatencyS,
    lastEventId: feed.lastEventId,
  };
  for (const event of accepted) {
    if (event.id <= next.lastEventId) continue;
    next.lastEventId = event.id;
    if (event.type === 'TELEMETRY') {
      next.platformLocationUnknown = Boolean(event.locationUnknown);
      if (event.platform && !next.platformLocationUnknown) next.platform = event.platform;
    }
    if (event.type === 'BATHYMETRY' && event.bathymetry) {
      const { cellSizeM, source, samples } = event.bathymetry;
      if (Number.isFinite(cellSizeM) && cellSizeM > 0) for (const sample of samples) {
        if (![sample.eastM, sample.northM, sample.depthM].every(Number.isFinite) || sample.depthM < 0) continue;
        next.bathymetry.set([cellSizeM, Math.round(sample.eastM / cellSizeM), Math.round(sample.northM / cellSizeM)].join(':'), { ...sample, cellSizeM, source });
      }
    }
    if (event.type === 'ENVIRONMENT' && event.environment) next.lastEnvironment = event.environment;
    if (event.trackId) {
      const previous = next.tracks.get(event.trackId);
      const status = event.type === 'TRACK_STALE' ? 'STALE' : event.type === 'TRACK_LOST' ? 'LOST' : event.type === 'TRACK_UPDATED' ? 'ACTIVE' : previous?.status ?? 'ACTIVE';
      const scenarioObjectId = event.scenarioObjectId ?? previous?.scenarioObjectId;
      const scenarioObjectName = event.scenarioObjectName ?? previous?.scenarioObjectName;
      const scenarioDepthM = event.scenarioDepthM ?? previous?.scenarioDepthM;
      const className = event.className ?? previous?.className;
      const confidence = event.confidence ?? previous?.confidence;
      const lastFrameUrl = event.frameUrl ?? previous?.lastFrameUrl;
      const lastCaptureTime = event.captureTime ?? previous?.lastCaptureTime;
      if (event.position) {
        next.tracks.set(event.trackId, {
          trackId: event.trackId,
          status,
          eastM: event.position.eastM,
          northM: event.position.northM,
          uncertaintyM: event.position.uncertaintyM,
          reviewStatus: event.reviewStatus ?? previous?.reviewStatus,
          lastEventId: event.id,
          scenarioObjectId,
          scenarioObjectName,
          scenarioDepthM,
          className,
          confidence,
          lastFrameUrl,
          lastCaptureTime,
        });
      } else if (previous) {
        next.tracks.set(event.trackId, {
          ...previous,
          status,
          reviewStatus: event.reviewStatus ?? previous.reviewStatus,
          lastEventId: event.id,
          scenarioObjectId,
          scenarioObjectName,
          scenarioDepthM,
          className,
          confidence,
          lastFrameUrl,
          lastCaptureTime,
        });
      }
    }
    if (event.type === 'FRAME_INFERRED' && event.detectionId && next.run) {
      const speed = next.run.speed > 0 ? next.run.speed : 1;
      // Capture→console latency in sim seconds (queue delay converted at run speed).
      const latencyS = ((event.queueDelayMs ?? 0) / 1000) * (next.run.mode === 'SIMULATION' ? speed : 1);
      if (next.displayLatencyS.length > 2000) next.displayLatencyS = next.displayLatencyS.slice(-1000);
      next.displayLatencyS = [...next.displayLatencyS, { detectionId: event.detectionId, latencyS }];
    }
  }
  return next;
}

export async function fetchRuns(signal?: AbortSignal): Promise<Array<Pick<RunSummary, 'id' | 'state' | 'mode' | 'tS' | 'speed'> & { scenarioId: string; name: string }>> {
  const response = await authorizedFetch('/api/simulation/runs', { signal });
  if (!response.ok) throw new Error(`Run registry returned HTTP ${response.status}`);
  const body = await response.json() as { runs: Array<Pick<RunSummary, 'id' | 'state' | 'mode' | 'tS' | 'speed'> & { scenarioId: string; name: string }> };
  return body.runs;
}

export async function fetchScenarios(signal?: AbortSignal): Promise<Array<{ id: string; name: string; description: string; mode: string; durationS: number; seed: number }>> {
  const response = await authorizedFetch('/api/simulation/scenarios', { signal });
  if (!response.ok) throw new Error(`Scenario list returned HTTP ${response.status}`);
  const body = await response.json() as { scenarios: Array<{ id: string; name: string; description: string; mode: string; durationS: number; seed: number }> };
  return body.scenarios;
}

export async function fetchRun(runId: string, signal?: AbortSignal): Promise<RunSummary> {
  const response = await authorizedFetch(`/api/simulation/runs/${encodeURIComponent(runId)}`, { signal });
  if (!response.ok) throw new Error(`Run ${runId} returned HTTP ${response.status}`);
  const body = await response.json() as { run: RunSummary };
  return body.run;
}

export async function fetchEvents(runId: string, sinceId: number, signal?: AbortSignal): Promise<{ events: SimEvent[]; cursor: { tS: number; lastEventId: number }; health: RunHealth }> {
  const response = await authorizedFetch(`/api/simulation/runs/${encodeURIComponent(runId)}/events?since=${sinceId}`, { signal });
  if (!response.ok) throw new Error(`Event log for ${runId} returned HTTP ${response.status}`);
  return response.json();
}

export async function fetchMetrics(runId: string, signal?: AbortSignal): Promise<RunMetrics | { available: false; reason: string }> {
  const response = await authorizedFetch(`/api/simulation/runs/${encodeURIComponent(runId)}/metrics`, { signal });
  if (!response.ok) throw new Error(`Metrics for ${runId} returned HTTP ${response.status}`);
  const body = await response.json() as { metrics: RunMetrics | { available: false; reason: string } };
  return body.metrics;
}

export async function startRun(scenarioId: string, speed?: number): Promise<RunSummary> {
  const response = await authorizedFetch('/api/simulation/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenarioId, speed }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || `Run start returned HTTP ${response.status}`);
  }
  const body = await response.json() as { run: RunSummary };
  return body.run;
}

export async function commandRun(runId: string, command: 'pause' | 'resume' | 'restart' | 'abort'): Promise<RunSummary> {
  const response = await authorizedFetch(`/api/simulation/runs/${encodeURIComponent(runId)}/${command}`, { method: 'POST' });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || `${command} returned HTTP ${response.status}`);
  }
  const body = await response.json() as { run: RunSummary };
  return body.run;
}

export async function setRunSpeed(runId: string, speed: number): Promise<RunSummary> {
  const response = await authorizedFetch(`/api/simulation/runs/${encodeURIComponent(runId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ speed }),
  });
  if (!response.ok) throw new Error(`Speed change returned HTTP ${response.status}`);
  const body = await response.json() as { run: RunSummary };
  return body.run;
}

/** Rebuild from the original log so backwards seeks cannot retain future observations. */
export function replayFeedAt(events: SimEvent[], cursorS: number, run: RunSummary): RunFeed {
  return foldEvents(EMPTY_FEED, events.filter(event => event.tS <= cursorS), { ...run, tS: cursorS });
}
