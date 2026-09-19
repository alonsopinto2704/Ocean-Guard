import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { createSupervisor, probeEspada, unexpectedExitCode } from './dev.mjs';

function response(service, ok = true) {
  return { ok, json: async () => ({ service }) };
}

test('probeEspada requires both HTTP success and the Espada identity', async () => {
  assert.equal(await probeEspada('http://example.test/', async url => {
    assert.equal(url, 'http://example.test/health');
    return response('Espada Intelligence');
  }), true);
  assert.equal(await probeEspada('http://example.test', async () => response('Other Service')), false);
  assert.equal(await probeEspada('http://example.test', async () => response('Espada Intelligence', false)), false);
});

test('unexpected child exits always map to failure', () => {
  assert.equal(unexpectedExitCode(7, null), 7);
  assert.equal(unexpectedExitCode(0, null), 1);
  assert.equal(unexpectedExitCode(null, 'SIGTERM'), 1);
});

test('supervisor waits for owned teardown and refuses new children after stopping', async () => {
  const child = new EventEmitter();
  child.pid = 123;
  child.exitCode = null;
  child.signalCode = null;
  let releaseTeardown;
  const teardown = new Promise(resolve => { releaseTeardown = resolve; });
  let spawnCount = 0;
  const supervisor = createSupervisor({
    spawnChild: () => { spawnCount += 1; return child; },
    terminateTree: async ownedChild => {
      assert.equal(ownedChild, child);
      await teardown;
    },
  });

  supervisor.start('dummy', 'unused', []);
  const stopping = supervisor.stop(0);
  assert.equal(supervisor.stopping, true);
  assert.equal(supervisor.start('late child', 'unused', []), null);
  assert.equal(spawnCount, 1);

  let stopped = false;
  void stopping.then(() => { stopped = true; });
  await Promise.resolve();
  assert.equal(stopped, false);
  releaseTeardown();
  await stopping;
  assert.equal(stopped, true);
});
