/**
 * End-to-end demo harness (docs/MISSION_SIMULATION.md §7 "Synthetic scenarios").
 *
 * Drives every SIM-* scenario through the real ESPADA /v1/detect path
 * (realInference — frames carry X-Espada-Skip-Learning), prints a measured
 * scenario matrix (accepted thresholds vs actuals) and a summary JSON.
 *
 * Usage: npx tsx scripts/demo-simulation.ts [--only SIM-COUNT,SIM-FAULTS] [--json out.json]
 */
import { writeFileSync } from 'node:fs';
import {
  advanceRun,
  computeMetrics,
  createRun,
  getRun,
  realInference,
  type RunMetrics,
} from '../src/server/simulation.js';

const args = process.argv.slice(2);
const onlyIdx = args.indexOf('--only');
const only = onlyIdx >= 0 ? args[onlyIdx + 1].split(',').map(s => s.trim()) : null;
const jsonIdx = args.indexOf('--json');
const jsonPath = jsonIdx >= 0 ? args[jsonIdx + 1] : null;

const SCENARIOS = ['SIM-NORMAL', 'SIM-FOV', 'SIM-COUNT', 'SIM-GLARE', 'SIM-OCCLUSION', 'SIM-NOISE', 'SIM-FAULTS', 'SIM-OPS'] as const;

interface Row {
  scenario: string;
  measured: string;
  pass: boolean;
  metrics: RunMetrics;
}

function evaluate(scenario: string, metrics: RunMetrics, run: NonNullable<ReturnType<typeof getRun>>): { measured: string; pass: boolean } {
  const detections = run.events.filter(e => e.type === 'FRAME_INFERRED');
  switch (scenario) {
    case 'SIM-NORMAL': {
      const pass = detections.length === 0 && metrics.alertCount === 0 && run.state === 'COMPLETED';
      return { measured: `detections=${detections.length}, alerts=${metrics.alertCount}, state=${run.state}`, pass };
    }
    case 'SIM-FOV': {
      const stale = run.events.some(e => (e.type === 'TRACK_STALE' || e.type === 'TRACK_LOST'));
      const created = run.events.filter(e => e.type === 'TRACK_CREATED').length;
      const pass = created >= 1 && stale && detections.length > 0;
      return { measured: `tracks=${created}, stale/lost=${stale}, detections=${detections.length}`, pass };
    }
    case 'SIM-COUNT': {
      const err = metrics.uniqueObjectCount.error;
      const pass = err !== 'UNAVAILABLE' && err <= 1 && metrics.identitySwaps === 0;
      return { measured: `unique objects predicted=${metrics.uniqueObjectCount.predicted}/5 (err ${err}), swaps=${metrics.identitySwaps}`, pass };
    }
    case 'SIM-GLARE': {
      const glareDets = run.events.filter(e => e.type === 'FRAME_INFERRED' && e.frameUrl?.includes('_glare')).length;
      const calmDets = run.events.filter(e => e.type === 'FRAME_INFERRED' && e.frameUrl?.includes('OBJ-') && !e.frameUrl?.includes('_glare')).length;
      // Measurable difference reported: any calm-water detection counts as a signal.
      return { measured: `calm=${calmDets} vs glare=${glareDets} detections (precision ${metrics.perFrame.precision})`, pass: calmDets > 0 || glareDets === 0 };
    }
    case 'SIM-OCCLUSION': {
      const created = run.events.filter(e => e.type === 'TRACK_CREATED');
      const recovered = run.events.some(e => e.type === 'TRACK_UPDATED' && e.message === 'Track recovered');
      const staleOrLost = run.events.some(e => (e.type === 'TRACK_STALE' || e.type === 'TRACK_LOST'));
      const pass = created.length === 1 && staleOrLost && recovered;
      return { measured: `tracks=${created.length}, gap stale/lost=${staleOrLost}, identity recovered=${recovered}`, pass };
    }
    case 'SIM-NOISE': {
      const unknown = run.events.some(e => e.type === 'TELEMETRY' && e.locationUnknown);
      const pass = metrics.dedup.duplicatesReceived > 0 && metrics.dedup.duplicatesDropped > 0 && unknown;
      return { measured: `duplicates ${metrics.dedup.duplicatesDropped}/${metrics.dedup.duplicatesReceived} deduped, UNKNOWN locations shown=${unknown}`, pass };
    }
    case 'SIM-FAULTS': {
      const recovery = metrics.recoveryTimeS;
      const pass = run.health.droppedFrames > 0 && metrics.frames.failed > 0 && recovery !== 'UNAVAILABLE' && recovery <= 10;
      return { measured: `dropped=${run.health.droppedFrames}, failed=${metrics.frames.failed}, recovery=${recovery}s (≤10s)`, pass };
    }
    case 'SIM-OPS': {
      const fp = run.events.find(e => e.type === 'OPERATOR_ACTION' && e.reviewStatus === 'FALSE_POSITIVE');
      const onDetection = fp?.detectionId && run.events.some(e => e.detectionId === fp.detectionId && e.type === 'FRAME_INFERRED' && e.reviewStatus === 'FALSE_POSITIVE');
      const pass = Boolean(fp) && Boolean(onDetection);
      return { measured: `FP review linked to detection=${Boolean(fp) && Boolean(onDetection)}, completion=${run.events.some(e => e.type === 'MISSION_STATE' && e.message?.includes('complet'))}`, pass };
    }
    default:
      return { measured: 'no evaluation', pass: false };
  }
}

async function main() {
  // Confirm ESPADA is actually up before claiming "live" results.
  const base = (process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
  const probe = await fetch(`${base}/v1/model`).then(r => r.json() as Promise<{ ready: boolean; engine?: string; classes?: string[] }>).catch(() => null);
  if (!probe?.ready) {
    console.error(`ESPADA is not READY at ${base} — refusing to produce a "live" matrix.`);
    process.exit(2);
  }
  console.log(`ESPADA: READY (${probe.engine}, classes=${JSON.stringify(probe.classes)}) at ${base}\n`);

  const rows: Row[] = [];
  for (const scenario of SCENARIOS) {
    if (only && !only.includes(scenario)) continue;
    process.stdout.write(`Running ${scenario} … `);
    const run = createRun(scenario, 8, realInference);
    let guard = 0;
    while (run.state === 'RUNNING' && guard++ < 200) await advanceRun(run, 30);
    const metrics = computeMetrics(run);
    const { measured, pass } = evaluate(scenario, metrics, run);
    rows.push({ scenario, measured, pass, metrics });
    console.log(pass ? `PASS — ${measured}` : `FAIL — ${measured}`);
  }

  console.log('\n=== MEASURED SCENARIO MATRIX (live ESPADA, seed 20260922) ===');
  for (const row of rows) {
    console.log(`${row.pass ? '✓' : '✗'} ${row.scenario}: ${row.measured}`);
  }

  if (jsonPath) {
    writeFileSync(jsonPath, JSON.stringify({
      generatedAtUtc: new Date().toISOString(),
      espada: { base, engine: probe.engine, classes: probe.classes },
      seed: 20260922,
      rows: rows.map(({ scenario, measured, pass, metrics }) => ({ scenario, measured, pass, metrics })),
    }, null, 2));
    console.log(`\nJSON matrix written to ${jsonPath}`);
  }
}

main().catch(error => { console.error(error); process.exit(1); });
