import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { foldEvents, EMPTY_FEED, replayFeedAt, type SimEvent as ClientEvent, type RunSummary } from '../src/components/replay/runEventFeed.js';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oceanguard-integrity-'));
process.env.SIM_REPLAY_DIR = directory;
process.env.SIM_TICK_MS = '600000';
const sim = await import('../src/server/simulation.js');
after(() => fs.rmSync(directory, { recursive: true, force: true }));
const detector = async () => ({ latencyMs: 7, analysisId: null, detections: [{ className: 'Mixed Waste', confidence: 23.4, rawConfidence: 21, confidenceCalibrated: false, boundingBox: { x: .4, y: .4, width: .2, height: .2 } }] });

test('restarted legacy replay reproduces original observations', async () => {
  const run = sim.createReplayRun(1);
  try {
    await sim.advanceRun(run, 120);
    const observations = () => run.events.filter(e => e.type === 'FRAME_INFERRED').map(e => [e.captureTime, e.trackId, e.position]);
    const first = observations();
    sim.restartRun(run.id);
    await sim.advanceRun(run, 120);
    assert.equal(run.tS, 120);
    assert.deepEqual(observations(), first);
  } finally { sim.abortRun(run.id); }
});

test('unknown GPS retains the last observed fix, including after backwards seek', () => {
  const events = [
    { id: 1, tS: 1, type: 'TELEMETRY', platform: { eastM: 1, northM: 2, headingDeg: 0, speedMps: 1 }, locationUnknown: false },
    { id: 2, tS: 2, type: 'TELEMETRY', platform: { eastM: 101, northM: 102, headingDeg: 0, speedMps: 1 }, locationUnknown: true },
    { id: 3, tS: 3, type: 'BATHYMETRY', bathymetry: { cellSizeM: 4, source: 'SIMULATED_SONAR', samples: [{ eastM: 1, northM: 2, depthM: 12 }] } },
  ] as ClientEvent[];
  const feed = foldEvents(EMPTY_FEED, events);
  assert.equal(feed.platform?.eastM, 1);
  assert.equal(feed.platformLocationUnknown, true);
  assert.equal(feed.bathymetry.size, 1);
  const earlier = replayFeedAt(events, 1, { speed: 1, mode: 'SIMULATION' } as RunSummary);
  assert.equal(earlier.bathymetry.size, 0);
  assert.equal(earlier.platformLocationUnknown, false);
  assert.equal(EMPTY_FEED.bathymetry.size, 0);
});

test('pausing during inference keeps recorded duration at or beyond observed timestamps', async () => {
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const run = sim.createRun('SIM-COUNT', 1, async () => { entered(); await gate; return detector(); });
  const advancing = sim.advanceRun(run, 20);
  await started;
  sim.pauseRun(run.id);
  release();
  await advancing;
  assert.ok(run.events.every(event => event.tS <= run.tS));
  assert.equal(sim.exportRunToReplayDataset(run).manifest.duration_s, run.tS);
  sim.abortRun(run.id);
});

test('review appends history, persists while paused, and disk failures return an error', async () => {
  const app = express(); app.use(express.json()); app.use(sim.simulationRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  const run = sim.createRun('SIM-COUNT', 1, detector);
  try {
    await sim.advanceRun(run, 20); sim.pauseRun(run.id);
    const original = structuredClone(run.events);
    const detection = original.find(e => e.type === 'FRAME_INFERRED')!;
    const reviewed = await fetch(`${base}/runs/${run.id}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trackId: detection.trackId, verdict: 'CONFIRMED' }) });
    assert.equal(reviewed.status, 200);
    assert.deepEqual(run.events.slice(0, original.length), original);
    const meta = sim.saveRunAsReplay(run);
    const saved = JSON.parse(fs.readFileSync(path.join(directory, `${meta.id}.json`), 'utf8'));
    assert.equal(saved.dataset.events.at(-1).reviewStatus, 'CONFIRMED');
    // A directory at the temporary-file path causes a portable write failure.
    const blockedPath = path.join(directory, `${meta.id}.json.tmp`);
    fs.mkdirSync(blockedPath);
    const failed = await fetch(`${base}/runs/${run.id}/save-replay`, { method: 'POST' });
    assert.equal(failed.status, 507);
    fs.rmdirSync(blockedPath);
  } finally { sim.abortRun(run.id); await new Promise<void>(resolve => server.close(() => resolve())); }
});
