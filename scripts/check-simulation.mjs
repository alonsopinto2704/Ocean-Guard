import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const dataDirArg = process.argv.indexOf('--data-dir');
const dataDir = dataDirArg >= 0 ? process.argv[dataDirArg + 1] : fileURLToPath(new URL('public/simulation', root));
if (!dataDir || dataDir.startsWith('--')) throw new Error('--data-dir requires a directory path');
const dataPath = path.resolve(dataDir);
const data = JSON.parse(readFileSync(path.join(dataPath, 'mission.json'), 'utf8'));
const { tables: t, manifest } = data;
const start = Date.parse(t.missions[0].start_time_utc);
const end = Date.parse(t.missions[0].end_time_utc);
assert.equal(manifest.label, 'SIMULATION');
assert.equal(end - start, 1800000);
const keys = { missions: 'mission_id', platforms: 'platform_id', sensors: 'sensor_id', telemetry: 'telemetry_id', detections: 'detection_id', tracks: 'track_id', alerts: 'alert_id', scenario_events: 'scenario_event_id', environmental_observations: 'observation_id', object_truth: 'object_id' };
for (const [table, rows] of Object.entries(t)) {
  assert.equal(rows.length, manifest.files[`${table}.csv`].row_count, table);
  assert.equal(new Set(rows.map(row => row[keys[table]])).size, rows.length, `${table} IDs`);
  for (const row of rows) {
    assert.ok(['synthetic_simulation', 'simulated_ground_truth', 'derived_estimate'].includes(row.provenance));
    if (row.mission_id) assert.ok(t.missions.some(m => m.mission_id === row.mission_id));
    if (row.platform_id) assert.ok(t.platforms.some(p => p.platform_id === row.platform_id));
    if (row.event_time_utc) assert.ok(Date.parse(row.event_time_utc) >= start && Date.parse(row.event_time_utc) <= end);
    if (row.ingestion_time_utc) assert.ok(Date.parse(row.ingestion_time_utc) >= Date.parse(row.event_time_utc));
  }
}
for (const row of t.telemetry) {
  assert.ok(Number.isFinite(+row.lat) && Math.abs(+row.lat) <= 90);
  assert.ok(Number.isFinite(+row.lon) && Math.abs(+row.lon) <= 180);
  assert.ok(+row.heading_deg >= 0 && +row.heading_deg <= 360);
  assert.equal(Date.parse(row.event_time_utc) - start, +row.sim_time_s * 1000);
}
const gaps = t.telemetry.slice(1).filter((row, i) => +row.seq - +t.telemetry[i].seq !== 1);
assert.equal(gaps.length, 1);
assert.equal(+gaps[0].seq, 1561);
assert.ok(!t.telemetry.some(row => +row.seq >= 1500 && +row.seq <= 1560));
const classes = JSON.parse(readFileSync(new URL('ai_service/models/classes.json', root), 'utf8'));
for (const d of t.detections) {
  assert.ok(t.sensors.some(s => s.sensor_id === d.sensor_id));
  assert.ok(t.telemetry.some(p => p.seq === d.telemetry_seq));
  assert.ok(t.object_truth.some(o => o.object_id === d.object_id));
  assert.equal(d.review_status, 'unreviewed');
  assert.equal(classes[+d.class_id], 'Mixed Waste');
  for (const axis of ['x', 'y']) {
    const center = +d[`bbox_${axis}_center`];
    const size = +d[axis === 'x' ? 'bbox_width' : 'bbox_height'];
    assert.ok(size > 0 && center - size / 2 >= 0 && center + size / 2 <= 1);
  }
}
for (const track of t.tracks) {
  assert.ok(t.object_truth.some(o => o.object_id === track.ground_truth_object_id));
  assert.equal(t.detections.filter(d => d.object_id === track.ground_truth_object_id).length, +track.detection_count);
}
for (const alert of t.alerts) if (alert.related_track_id) assert.ok(t.tracks.some(t => t.track_id === alert.related_track_id));
const delayed = t.alerts.find(a => a.alert_type === 'delayed_event_demo');
assert.equal(Date.parse(delayed.ingestion_time_utc) - Date.parse(delayed.event_time_utc), 45000);
assert.equal(data.fixtures.length, 6);
for (const fixture of data.fixtures) {
  const fixturePath = existsSync(path.join(dataPath, 'fixtures', path.basename(fixture)))
    ? path.join(dataPath, 'fixtures', path.basename(fixture))
    : path.join(dataPath, path.basename(fixture));
  assert.ok(existsSync(fixturePath), `Fixture file not found: ${fixture}`);
}
console.log('Simulation checks passed: counts, IDs, references, provenance, class mapping, timestamps, boxes, feed gap, delayed alert, and fixture files.');
