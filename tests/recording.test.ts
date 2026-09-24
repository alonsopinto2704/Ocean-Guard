import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oceanguard-recording-'));
process.env.SIM_REPLAY_DIR = directory;
const { createRun, advanceRun, abortRun, saveRunAsReplay, replays, exportRunToReplayDataset } = await import('../src/server/simulation.js');

test('recordings contain only observed events, preserve scores and survive disk serialization', async () => {
  const run = createRun('SIM-COUNT', 1, async () => ({ latencyMs: 7, analysisId: null, detections: [{ className: 'Mixed Waste', confidence: 23.4, rawConfidence: 21, confidenceCalibrated: false, boundingBox: { x: .4, y: .4, width: .2, height: .2 } }] }));
  try {
    const initial = exportRunToReplayDataset(run);
    assert.equal(initial.tables.telemetry.length, 0, 'never export an unobserved future route');
    const first = saveRunAsReplay(run);
    await advanceRun(run, 20);
    const second = saveRunAsReplay(run);
    assert.equal(first.id, second.id, 'autosave updates one recording');
    const dataset = replays.get(second.id)!.dataset;
    assert.deepEqual(dataset.events, run.events);
    assert.equal(dataset.manifest.duration_s, run.tS);
    const detections = dataset.events.filter((e: any) => e.type === 'FRAME_INFERRED');
    assert.ok(detections.length);
    assert.equal(detections[0].confidence, 23.4);
    assert.equal(detections[0].latencyMs, 7);
    assert.ok(detections[0].captureTime);
    assert.equal(detections[0].position.depthM, 0);
    assert.ok(dataset.events.some((e: any) => e.type === 'BATHYMETRY' && e.bathymetry.source === 'SIMULATED_SONAR'));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, `${second.id}.json`), 'utf8')).dataset.events, JSON.parse(JSON.stringify(run.events)));
    abortRun(run.id);
    assert.equal(replays.get(second.id)!.dataset.run.state, 'ABORTED');
  } finally { abortRun(run.id); fs.rmSync(directory, { recursive: true, force: true }); }
});
