import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import mission from '../public/simulation/mission.json' with { type: 'json' };

// The wall clock must not advance these runs: the assertions drive the replay
// with advanceRun so the recorded timeline is reproduced deterministically.
process.env.SIM_TICK_MS = '600000';
const recordings = fs.mkdtempSync(path.join(os.tmpdir(), 'oceanguard-replay-'));
process.env.SIM_REPLAY_DIR = recordings;

const {
  advanceRun, createReplayRun, createRun, enuToLatLng, exportRunToReplayDataset,
  latLngToEnu, getRun, abortRun,
} = await import('../src/server/simulation.js');
type SimEvent = import('../src/server/simulation.js').SimEvent;

const tables = mission.tables as unknown as Record<string, Array<Record<string, string>>>;
const startMs = Date.parse(tables.missions[0].start_time_utc);

const ingestedBy = (rows: Array<Record<string, string>>, clockMs: number) =>
  rows.filter(row => Date.parse(row.ingestion_time_utc || row.event_time_utc) <= clockMs);

test('recorded replay reproduces original capture times, positions and identities', async () => {
  const run = createReplayRun(60);
  try {
    assert.equal(run.mode, 'REPLAY');
    await advanceRun(run, 120);
    const cursorMs = startMs + run.tS * 1000;

    // Telemetry: one event per recorded fix, at the original capture time.
    const expectedFixes = ingestedBy(tables.telemetry, cursorMs);
    const telemetryEvents = run.events.filter(event => event.type === 'TELEMETRY');
    assert.equal(telemetryEvents.length, expectedFixes.length);
    const bySeq = new Map(expectedFixes.map(row => [row.seq, row]));
    for (const event of telemetryEvents) {
      const row = bySeq.get(String(event.message).replace('seq ', ''));
      assert.ok(row, `no recorded fix for ${event.message}`);
      assert.equal(event.captureTime, row.event_time_utc, 'original capture timestamp preserved');
      assert.equal(event.lat, Number(row.lat));
      assert.equal(event.lng, Number(row.lon));
      const pose = latLngToEnu(Number(row.lat), Number(row.lon));
      assert.ok(Math.abs((event.platform?.eastM ?? 0) - pose.eastM) < 1e-6);
      assert.ok(Math.abs((event.platform?.northM ?? 0) - pose.northM) < 1e-6);
    }

    // Detections: recorded rows only — never model output, never regenerated.
    const detections = run.events.filter(event => event.type === 'FRAME_INFERRED');
    const expectedDetections = ingestedBy(tables.detections, cursorMs);
    assert.ok(expectedDetections.length > 0, 'the recorded window must contain detections');
    assert.equal(detections.length, expectedDetections.length);
    for (const event of detections) {
      assert.equal(event.provenance, 'RECORDED');
      assert.equal(event.confidence, undefined, 'recorded detections carry no model confidence');
      assert.equal(event.rawConfidence, undefined);
      const row = tables.detections.find(candidate => candidate.detection_id === event.detectionId);
      assert.ok(row, `detection ${event.detectionId} is not in the recording`);
      assert.equal(event.captureTime, row.event_time_utc);
      assert.equal(event.className, 'Mixed Waste');
      assert.equal(event.trackId, `TRK-REC-${row.object_id}`);
      // Position is derived from the recorded pose plus the recorded range/bearing.
      const poseRow = tables.telemetry.find(candidate => candidate.seq === row.telemetry_seq);
      assert.ok(poseRow, 'recorded detection references a recorded pose');
      const pose = latLngToEnu(Number(poseRow.lat), Number(poseRow.lon));
      const rangeM = Number(row.range_m_estimate) || 15;
      const bearingRad = (Number(row.bearing_deg_estimate) || 0) * Math.PI / 180;
      assert.ok(Math.abs((event.position?.eastM ?? 0) - (pose.eastM + rangeM * Math.sin(bearingRad))) < 1e-6);
      assert.ok(Math.abs((event.position?.northM ?? 0) - (pose.northM + rangeM * Math.cos(bearingRad))) < 1e-6);
      // The event is surfaced when its recorded ingestion time is reached.
      const ingestionS = (Date.parse(row.ingestion_time_utc) - startMs) / 1000;
      assert.ok(event.tS >= ingestionS, `event at ${event.tS}s predates its ingestion (${ingestionS}s)`);
      assert.ok(event.tS <= run.tS + 1e-9);
    }

    // Two runs over the same recording must be byte-identical.
    const twin = createReplayRun(60);
    try {
      await advanceRun(twin, 120);
      const shape = (events: SimEvent[]) => events
        .filter(event => event.type === 'FRAME_INFERRED')
        .map(event => [event.detectionId, event.tS, event.captureTime, event.trackId, event.position]);
      assert.deepEqual(shape(twin.events), shape(run.events));
    } finally { abortRun(twin.id); }
  } finally { abortRun(run.id); }
});

test('a recorded replay reproduces identical event times and identities at any advance step size', async () => {
  const stepped = createReplayRun(60);
  const jumped = createReplayRun(60);
  try {
    // Many small advances vs one large advance must fold to the same log.
    for (let elapsed = 0; elapsed < 120; elapsed += 5) await advanceRun(stepped, 5);
    await advanceRun(jumped, 120);

    // A jump and small steps must assign the same IDs in the same chronology.
    const shape = (events: SimEvent[]) => events
      .map(event => [
        event.id, event.tS, event.type, event.detectionId ?? null, event.trackId ?? null,
        event.captureTime ?? null, event.position?.eastM ?? null, event.position?.northM ?? null,
      ] as const);
    assert.deepEqual(shape(jumped.events), shape(stepped.events),
      'event times, identities and positions must not depend on the advance step size');
    // The log folds to a chronological order no matter how it was ingested.
    const times = jumped.events.map(event => event.tS);
    assert.deepEqual(times, [...times].sort((a, b) => a - b), 'the event log must read chronologically');

    // Each recorded observation is stamped with its own ingestion offset from
    // the recording start, never the enclosing playback tick's time.
    const observed = jumped.events.filter(event => event.type === 'FRAME_INFERRED');
    assert.ok(observed.length > 1, 'the window must contain several recorded observations');
    for (const event of observed) {
      const row = tables.detections.find(candidate => candidate.detection_id === event.detectionId);
      assert.ok(row, `detection ${event.detectionId} is not in the recording`);
      const expected = (Date.parse(row.ingestion_time_utc || row.event_time_utc) - startMs) / 1000;
      assert.equal(event.tS, expected, 'an event must carry its own ingestion offset, not the tick time');
    }
  } finally {
    abortRun(stepped.id);
    abortRun(jumped.id);
  }
});

test('saved simulation keeps authored object labels and depth separate from model observations', async () => {
  const run = createRun('SIM-FOV', 1, async () => ({
    latencyMs: 4, analysisId: null,
    detections: [{ className: 'Mixed Waste', confidence: 80, rawConfidence: 80, confidenceCalibrated: false,
      boundingBox: { x: 0.4, y: 0.4, width: 0.2, height: 0.2 } }],
  }));
  try {
    await advanceRun(run, 12);
    const event = run.events.find(e => e.type === 'FRAME_INFERRED' && e.scenarioObjectName);
    assert.ok(event, 'the captured scenario asset must be identified');
    assert.equal(event.depthEstimated, true, 'RGB inference cannot measure object depth');
    const dataset = exportRunToReplayDataset(run);
    const row = (dataset.tables.detections as Array<Record<string, string>>).find(r => r.detection_id === event.detectionId);
    assert.ok(row);
    assert.equal(row.scenario_object_id, event.scenarioObjectId);
    assert.equal(row.scenario_object_name, event.scenarioObjectName);
    assert.equal(row.scenario_depth_m, String(event.scenarioDepthM));
    assert.equal(row.depth_m, '', 'unknown measured depth must stay blank');
    assert.equal(dataset.events.find((e: SimEvent) => e.id === event.id)?.scenarioDepthM, event.scenarioDepthM);
  } finally { abortRun(run.id); }
});

test('recorded alerts link to the recorded object identity they were raised for', async () => {
  const run = createReplayRun(60);
  try {
    await advanceRun(run, run.scenario.durationS);
    assert.equal(run.state, 'COMPLETED');

    const alerts = run.events.filter(event => event.type === 'ALERT');
    assert.equal(alerts.length, tables.alerts.length, 'every recorded alert is replayed once');
    for (const alert of alerts) {
      if (!alert.trackId) continue;
      const tracks = tables.tracks.filter(track => `TRK-REC-${track.ground_truth_object_id}` === alert.trackId);
      assert.equal(tracks.length, 1, `alert ${alert.message} points at an unknown contact ${alert.trackId}`);
      const detections = run.events.filter(event =>
        event.type === 'FRAME_INFERRED' && event.trackId === alert.trackId);
      assert.ok(detections.length > 0, 'an alert must reference a contact that actually appears');
    }

    // Every recorded observation is replayed exactly once, and no more.
    const ids = run.events
      .filter(event => event.type === 'FRAME_INFERRED')
      .map(event => event.detectionId);
    assert.equal(ids.length, tables.detections.length);
    assert.equal(new Set(ids).size, ids.length, 'no duplicate observations across ticks');
    const fixes = run.events.filter(event => event.type === 'TELEMETRY');
    assert.equal(fixes.length, tables.telemetry.length);
  } finally { abortRun(run.id); }
});

test('recorded telemetry rows keep a missing GPS fix unknown instead of inventing a position', async () => {
  const run = createRun('SIM-NOISE', 8, async () => ({ latencyMs: 4, analysisId: null, detections: [] }));
  try {
    await advanceRun(run, 115);
    const dataset = exportRunToReplayDataset(run);
    const rows = dataset.tables.telemetry as Array<Record<string, string>>;
    const runUnknown = run.events.filter(event => event.type === 'TELEMETRY' && event.locationUnknown);
    assert.ok(runUnknown.length > 0, 'SIM-NOISE must drop GPS fixes');
    assert.equal(rows.filter(row => row.location_unknown === 'true').length, runUnknown.length);
    for (const row of rows) {
      if (row.location_unknown === 'true') {
        assert.equal(row.lat, '', 'an unavailable fix must not be recorded as a coordinate');
        assert.equal(row.lon, '');
        assert.equal(row.location_uncertainty_m, '', 'no uncertainty can be quoted without a fix');
      } else {
        assert.notEqual(row.lat, '');
        assert.notEqual(row.lon, '');
      }
    }
    // The archived run keeps the same observations the operator saw live.
    assert.equal(JSON.stringify(dataset.events), JSON.stringify(run.events));
    assert.equal(dataset.manifest.duration_s, run.tS);
  } finally {
    abortRun(run.id);
    fs.rmSync(recordings, { recursive: true, force: true });
  }
});

test('replayed missing GPS does not become zero coordinates or an ENU origin pose', async () => {
  const run = createReplayRun(60);
  try {
    const replay = run.internal.replay;
    assert.ok(replay);
    replay.tables = structuredClone(replay.tables);
    replay.tables.telemetry[0].lat = '';
    replay.tables.telemetry[0].lon = '';
    replay.tables.telemetry[0].location_unknown = 'true';
    await advanceRun(run, 1);
    const fix = run.events.find(event => event.type === 'TELEMETRY');
    assert.ok(fix);
    assert.equal(fix.lat, null);
    assert.equal(fix.lng, null);
    assert.equal(fix.platform, undefined);
    assert.equal(fix.locationUnknown, true);
  } finally { abortRun(run.id); }
});

test('advancing a recorded replay never runs the scenario generator', async () => {
  const run = createReplayRun(60);
  try {
    await advanceRun(run, 30);
    assert.equal(run.events.filter(event => event.type === 'FRAME_FAILED').length, 0);
    assert.equal(run.events.filter(event => event.type === 'BATHYMETRY').length, 0,
      'the recorded dataset contains no sonar survey, so none may be invented');
    assert.ok(getRun(run.id) === run);
    // The ENU origin used by the run registry is the one the recording declares.
    assert.ok(Math.abs(enuToLatLng(0, 0).lat - Number(tables.missions[0].origin_lat)) < 1e-9);
    assert.ok(Math.abs(enuToLatLng(0, 0).lng - Number(tables.missions[0].origin_lon)) < 1e-9);
  } finally { abortRun(run.id); }
});
