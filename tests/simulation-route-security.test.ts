import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oceanguard-route-'));
const replayDirectory = path.join(directory, 'replays');
process.env.VERCEL = '1';
process.env.OCEANGUARD_WEB_DATA_DIR = directory;
process.env.OCEANGUARD_SESSION_SECRET = 'test-only-session-secret';
process.env.SIM_REPLAY_DIR = replayDirectory;
const { default: app } = await import('../server.js');
const sim = await import('../src/server/simulation.js');

test('simulation routes require login and replay deletion stays inside its archive', async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  const sentinel = path.join(directory, 'oceanguard-db.json');
  try {
    assert.equal((await fetch(`${base}/api/simulation/scenarios`)).status, 401);
    assert.equal((await fetch(`${base}/api/simulation/replays/..%2Foceanguard-db`, { method: 'DELETE' })).status, 401);

    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'operator@oceanguard.ai', password: 'demo1234' }),
    });
    assert.equal(login.status, 200);
    const { token } = await login.json() as { token: string };
    const headers = { Authorization: `Bearer ${token}` };
    assert.equal((await fetch(`${base}/api/simulation/scenarios`, { headers })).status, 200);
    const before = fs.readFileSync(sentinel, 'utf8');
    assert.equal((await fetch(`${base}/api/simulation/replays/..%2Foceanguard-db`, { method: 'DELETE', headers })).status, 404);
    assert.equal(fs.readFileSync(sentinel, 'utf8'), before);

    const run = sim.createRun('SIM-NORMAL', 1, async () => ({ latencyMs: 0, analysisId: null, detections: [] }));
    sim.abortRun(run.id);
    const saved = sim.saveRunAsReplay(run);
    assert.equal((await fetch(`${base}/api/simulation/replays/${saved.id}`, { method: 'DELETE', headers })).status, 200);
    assert.equal(fs.existsSync(path.join(replayDirectory, `${saved.id}.json`)), false);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
