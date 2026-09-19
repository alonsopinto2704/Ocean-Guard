import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { config } from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ESPADA_SERVICE = 'Espada Intelligence';

export async function probeEspada(serviceUrl, fetchImpl = fetch, timeoutMs = 1500) {
  try {
    const baseUrl = serviceUrl.replace(/\/$/, '');
    const response = await fetchImpl(`${baseUrl}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return false;
    const status = await response.json();
    return status?.service === ESPADA_SERVICE;
  } catch {
    return false;
  }
}

export function unexpectedExitCode(code, signal) {
  if (typeof code === 'number' && code !== 0) return code;
  return 1;
}

function waitForExit(child, timeoutMs = 5000) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function runHidden(command, args) {
  return new Promise(resolve => {
    const child = spawn(command, args, { stdio: 'ignore', windowsHide: true });
    child.once('error', () => resolve(false));
    child.once('exit', code => resolve(code === 0));
  });
}

async function terminateOwnedTree(child, platform = process.platform) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;

  if (platform === 'win32') {
    const killedTree = await runHidden('taskkill', ['/PID', String(child.pid), '/T', '/F']);
    if (!killedTree && child.exitCode === null && child.signalCode === null) child.kill();
  } else {
    child.kill('SIGTERM');
  }

  await waitForExit(child);
  if (child.exitCode === null && child.signalCode === null && platform !== 'win32') {
    child.kill('SIGKILL');
    await waitForExit(child);
  }
  if (child.exitCode === null && child.signalCode === null) {
    throw new Error(`Timed out while stopping owned process ${child.pid}.`);
  }
}

export function createSupervisor({
  spawnChild = spawn,
  terminateTree = terminateOwnedTree,
  platform = process.platform,
} = {}) {
  const children = [];
  let stopping = false;
  let stopPromise = null;

  function stop(code = 0) {
    if (stopPromise) {
      if (code !== 0) process.exitCode = code;
      return stopPromise;
    }

    stopping = true;
    if (code !== 0 || process.exitCode == null) process.exitCode = code;
    stopPromise = Promise.allSettled(children.map(({ child }) => terminateTree(child, platform))).then(results => {
      const failures = results.filter(result => result.status === 'rejected');
      if (failures.length > 0) {
        process.exitCode = 1;
        for (const failure of failures) console.error(`Child teardown failed: ${failure.reason}`);
      }
    });
    return stopPromise;
  }

  function start(name, command, args, env = {}) {
    if (stopping) return null;
    const child = spawnChild(command, args, {
      cwd: root,
      stdio: 'inherit',
      windowsHide: true,
      env: { ...process.env, ...env },
    });
    children.push({ name, child });
    child.once('error', error => {
      console.error(`${name} failed to start: ${error.message}`);
      void stop(1);
    });
    child.once('exit', (code, signal) => {
      if (!stopping) {
        console.error(`${name} exited unexpectedly${signal ? ` (${signal})` : ` (code ${code ?? 'unknown'})`}.`);
        void stop(unexpectedExitCode(code, signal));
      }
    });
    return child;
  }

  return {
    start,
    stop,
    get stopping() { return stopping; },
    get children() { return [...children]; },
  };
}

export async function main() {
  config({ path: path.join(root, '.env.local'), quiet: true });
  const supervisor = createSupervisor();
  process.on('SIGINT', () => { void supervisor.stop(); });
  process.on('SIGTERM', () => { void supervisor.stop(); });

  const serviceUrl = (process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
  let running = await probeEspada(serviceUrl);

  if (!running && !process.env.AI_SERVICE_URL) {
    const python = process.env.ESPADA_PYTHON || path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    if (!existsSync(python)) {
      console.error('Espada needs its local Python environment. Run: python -m venv .venv, then install ai_service/requirements.txt into .venv.');
      await supervisor.stop(1);
    } else {
      supervisor.start('Espada service', python, ['-m', 'uvicorn', 'ai_service.app.main:app', '--host', '127.0.0.1', '--port', '8000']);
      for (let attempt = 0; attempt < 40 && !supervisor.stopping; attempt++) {
        if (await probeEspada(serviceUrl, fetch, 1000)) {
          running = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      if (!running && !supervisor.stopping) {
        console.error('Espada did not start. Check the Python error above.');
        await supervisor.stop(1);
      } else if (running && !supervisor.stopping && process.env.ESPADA_TRAINER_ENABLED !== 'false') {
        supervisor.start('Espada trainer', python, ['-m', 'ai_service.training.continual_worker'], {
          OCEANGUARD_BASE_DATASET: path.join(root, 'datasets', 'taco'),
        });
      }
    }
  }

  if (!supervisor.stopping && (running || process.env.AI_SERVICE_URL)) {
    supervisor.start('OceanGuard web server', process.execPath, ['--import', 'tsx', 'server.ts']);
  }
}

const entryPoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === entryPoint) {
  await main();
}
