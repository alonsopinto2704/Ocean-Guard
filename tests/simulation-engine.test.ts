import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getPositiveDepth } from '../src/lib/bathymetry.js';

const testReplayDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oceanguard-engine-test-'));
process.env.SIM_REPLAY_DIR = testReplayDir;

const {
  advanceRun, computeMetrics, createRun, getRun, pauseRun, restartRun, resumeRun, setSpeed,
} = await import('../src/server/simulation.js');
type EspadaResult = import('../src/server/simulation.js').EspadaResult;
type InferenceFn = import('../src/server/simulation.js').InferenceFn;

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

/**
 * Truth-blind fake model, faithful to the rendered frames: it decodes the
 * range/bearing baked into the variant filename exactly as the renderer drew
 * it (height = K/range, x-offset = bearing/FOV). It never reads scenario truth,
 * so engine tests validate tracking/identity/fault logic with a perfect
 * detector; detection ACCURACY is only ever measured with the real ESPADA run.
 * Glare frames wash the object out (no detection) by construction here.
 */
function fakeInference(misses = 0): { fn: InferenceFn; calls: string[] } {
  const calls: string[] = [];
  let n = 0;
  const K = 5.4, FOV = 60;
  return {
    calls,
    fn: async (variant: string): Promise<EspadaResult> => {
      calls.push(variant);
      const miss = ++n <= misses;
      const match = /OBJ-\d+_(\d+)m_(neg)?(\d+)deg(_glare)?\.png$/.exec(variant);
      if (miss || !match || variant.includes('_glare')) return { latencyMs: 40, detections: [], analysisId: null };
      const range = Number(match[1]);
      const bearing = (match[2] ? -1 : 1) * Number(match[3]);
      const height = Math.min(0.42, K / range);
      const width = height * 1.5;
      const cx = Math.min(1, Math.max(0, 0.5 + (bearing / FOV) * 0.42));
      const x = Math.max(0, Math.min(1 - width, cx - width / 2));
      return {
        latencyMs: 40,
        detections: [{
          className: 'Mixed Waste',
          confidence: 64.4, rawConfidence: 58, confidenceCalibrated: true,
          boundingBox: box(x, Math.max(0, 0.5 - height / 2), Math.min(width, 1 - x), height),
        }],
        analysisId: null,
      };
    },
  };
}

async function runToCompletion(runId: string, chunkS = 30): Promise<void> {
  const run = getRun(runId)!;
  let guard = 0;
  while (run.state === 'RUNNING' && guard++ < 100) await advanceRun(run, chunkS);
}

test('engine module never imports operational storage (isolation by construction)', async () => {
  const source = await import('node:fs').then(fs => fs.readFileSync(new URL('../src/server/simulation.ts', import.meta.url), 'utf8'));
  assert.ok(!/from\s+'\.\/storage(\.js)?'/.test(source), 'simulation engine must not import storage.ts');
  assert.ok(!/\bstorage\.(getDetections|getAlerts|getCleanupMissions|addDetection|createCleanupMission|logAudit)\b/.test(source), 'simulation engine must not call operational storage APIs');
});

test('AUV sonar samples the same terrain shown in 3D monitoring', async () => {
  const run = createRun('SIM-FOV', 1, async () => ({ latencyMs: 1, detections: [], analysisId: null }));
  await advanceRun(run, 12);
  const samples = run.events.filter(event => event.type === 'BATHYMETRY').flatMap(event => event.bathymetry?.samples ?? []);
  assert.ok(samples.length > 0);
  for (const sample of samples) {
    assert.ok(Math.abs(sample.depthM - getPositiveDepth(sample.eastM, -sample.northM)) < 0.011);
  }
});

test('SIM-NORMAL completes with zero detections and no alerts', async () => {
  const { fn } = fakeInference();
  const run = createRun('SIM-NORMAL', 8, fn);
  await runToCompletion(run.id);
  const metrics = computeMetrics(run);
  assert.equal(run.state, 'COMPLETED');
  assert.equal(run.events.filter(e => e.type === 'FRAME_INFERRED').length, 0, 'no-object scenario must produce no detections');
  assert.equal(run.events.filter(e => e.type === 'ALERT').length, 0);
  assert.equal(metrics.frames.failed, 0);
  assert.equal(metrics.perFrame.framesScored, 0);
});

test('SIM-COUNT: tracking keeps identities distinct and counting error within ±1', async () => {
  const { fn } = fakeInference();
  const run = createRun('SIM-COUNT', 8, fn);
  await runToCompletion(run.id);
  const detections = run.events.filter(e => e.type === 'FRAME_INFERRED');
  assert.ok(detections.length >= 5, `expected detections, got ${detections.length}`);
  const trackIds = new Set(detections.map(e => e.trackId));
  assert.ok(trackIds.size <= 5, `expected ≤5 tracks, got ${trackIds.size}: ${[...trackIds].join(',')}`);
  const metrics = computeMetrics(run);
  assert.ok(metrics.uniqueObjectCount.error !== 'UNAVAILABLE' && metrics.uniqueObjectCount.error <= 1, `counting error ${metrics.uniqueObjectCount.error}`);
  assert.equal(metrics.identitySwaps, 0);
});

test('SIM-OCCLUSION: identity preserved across the visibility gap', async () => {
  const { fn } = fakeInference();
  const run = createRun('SIM-OCCLUSION', 8, fn);
  await runToCompletion(run.id);
  const created = run.events.filter(e => e.type === 'TRACK_CREATED');
  assert.equal(created.length, 1, `expected a single track, got ${created.length}`);
  assert.ok(run.events.some(e => (e.type === 'TRACK_STALE' || e.type === 'TRACK_LOST') && e.trackId === created[0].trackId), 'expected stale/lost during occlusion');
  assert.ok(run.events.some(e => e.type === 'TRACK_UPDATED' && e.trackId === created[0].trackId && e.message === 'Track recovered'), 'expected recovery after occlusion');
});

test('SIM-FAULTS: feed drops, ESPADA health degrades, recovery recorded within 10 s of sim time', async () => {
  const { fn } = fakeInference();
  const run = createRun('SIM-FAULTS', 10, fn);
  await runToCompletion(run.id);
  assert.ok(run.events.some(e => e.type === 'FAULT'), 'fault notices recorded');
  assert.ok(run.health.droppedFrames > 0, 'frames dropped during camera/network outage');
  assert.equal(run.health.espada, 'UP', 'service recovered by end of run');
  assert.ok(run.health.lastRecoveryS !== null && run.health.lastRecoveryS <= 10, `recovery ${run.health.lastRecoveryS}s sim time (threshold ≤ 10 s)`);
});

test('SIM-GLARE: glare frames lose detections relative to calm frames', async () => {
  const { fn, calls } = fakeInference();
  const run = createRun('SIM-GLARE', 8, fn);
  await runToCompletion(run.id);
  const glareFrames = calls.filter(v => v.includes('_glare') && !v.includes('NEGATIVE'));
  const calmObjectFrames = calls.filter(v => v.includes('OBJ-') && !v.includes('_glare'));
  const glareDetections = run.events.filter(e => e.type === 'FRAME_INFERRED' && e.frameUrl?.includes('_glare')).length;
  const calmDetections = run.events.filter(e => e.type === 'FRAME_INFERRED' && e.frameUrl?.includes('OBJ-') && !e.frameUrl?.includes('_glare')).length;
  assert.ok(glareFrames.length > 0 && calmObjectFrames.length > 0, 'scenario must exercise both glare and calm object frames');
  assert.ok(glareDetections < calmDetections, `glare detections (${glareDetections}) should trail calm (${calmDetections})`);
});

test('SIM-NOISE: duplicates counted and collapsed; missing locations flagged UNKNOWN', async () => {
  const { fn } = fakeInference();
  const run = createRun('SIM-NOISE', 8, fn);
  await runToCompletion(run.id);
  assert.ok(run.internal.duplicatesReceived > 0, 'duplicate ingest fault exercised');
  assert.ok(run.internal.duplicatesDropped > 0, 'duplicates deduped');
  assert.ok(run.events.some(e => e.type === 'TELEMETRY' && e.locationUnknown), 'missing GPS rendered as UNKNOWN, not invented');
  assert.ok(run.events.some(e => e.message?.includes('Out-of-order')), 'out-of-order samples handled');
  const metrics = computeMetrics(run);
  assert.equal(metrics.dedup.duplicatesReceived, run.internal.duplicatesReceived);
});

test('SIM-OPS: operator review marks a detection false positive and mission completes', async () => {
  const { fn } = fakeInference();
  const run = createRun('SIM-OPS', 8, fn);
  await runToCompletion(run.id);
  const fp = run.events.find(e => e.type === 'OPERATOR_ACTION' && e.reviewStatus === 'FALSE_POSITIVE');
  assert.ok(fp, 'false-positive review recorded');
  assert.ok(fp?.detectionId, 'review linked to the exact detection');
  const reviewed = run.events.find(e => e.detectionId === fp?.detectionId && e.type === 'FRAME_INFERRED');
  assert.equal(reviewed?.reviewStatus, 'FALSE_POSITIVE', 'review status visible on the source detection');
  assert.ok(run.events.some(e => e.type === 'MISSION_STATE' && e.message?.includes('complet')), 'mission completion recorded');
});

test('pause stops the simulation clock; resume processes no duplicate seconds', async () => {
  const { fn, calls } = fakeInference();
  const run = createRun('SIM-FOV', 4, fn);
  await advanceRun(run, 2);
  const callsAtPause = calls.length;
  const processedAtPause = run.internal.lastProcessedS;
  assert.ok(pauseRun(run.id));
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(run.internal.lastProcessedS, processedAtPause, 'no seconds processed while paused');
  assert.equal(calls.length, callsAtPause, 'no inference while paused');
  assert.ok(resumeRun(run.id));
  await advanceRun(run, 2);
  assert.ok(run.internal.lastProcessedS > processedAtPause, 'processing resumes');
  // Exactly-once: every second 1..lastProcessedS was processed exactly once.
  assert.equal(run.internal.lastProcessedS - processedAtPause, Math.floor(run.tS) - processedAtPause);
});

test('restart resets clock, events, health, and internal state', async () => {
  const { fn } = fakeInference();
  const run = createRun('SIM-NORMAL', 10, fn);
  await advanceRun(run, 2);
  assert.ok(restartRun(run.id));
  assert.equal(run.tS, 0);
  assert.equal(run.events.length, 1, 'only the restart banner event');
  assert.equal(run.internal.trackSeq, 0);
  assert.equal(run.internal.tracks.size, 0);
  await runToCompletion(run.id);
  assert.equal(run.state, 'COMPLETED');
});

test('speed changes take effect and runs are addressable', () => {
  const { fn } = fakeInference();
  const run = createRun('SIM-NORMAL', 1, fn);
  assert.ok(setSpeed(run.id, 60));
  assert.equal(run.speed, 60);
  assert.ok(getRun(run.id));
});

test('abort produces partial metrics marked as partial', async () => {
  const { fn } = fakeInference();
  const run = createRun('SIM-COUNT', 6, fn);
  await advanceRun(run, 3);
  const { abortRun } = await import('../src/server/simulation.js');
  abortRun(run.id);
  assert.equal(run.state, 'ABORTED');
  assert.ok(run.metrics);
  assert.ok(run.metrics?.partial, 'aborted run metrics flagged partial');
});

test('inference dispatch uses the isolation header and the documented endpoint (contract check)', async () => {
  const source = await import('node:fs').then(fs => fs.readFileSync(new URL('../src/server/simulation.ts', import.meta.url), 'utf8'));
  assert.ok(source.includes("'X-Espada-Skip-Learning': 'true'"), 'frames must skip the learning store');
  assert.ok(source.includes('/v1/detect'), 'uses the documented ESPADA endpoint');
});
