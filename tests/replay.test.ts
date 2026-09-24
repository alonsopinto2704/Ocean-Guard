import assert from 'node:assert/strict';
import test from 'node:test';
import dataset from '../public/simulation/mission.json' with { type: 'json' };
import { ingestionField, pathGeometry, sortByIngestion, toMs, visibleByIngestion } from '../src/lib/replay';

test('replay visibility follows ingestion and reaches the delayed final sample', () => {
  const telemetry = sortByIngestion(dataset.tables.telemetry);
  const finalIngestion = Math.max(...telemetry.map(row => toMs(ingestionField(row))));
  assert.equal(finalIngestion, Date.parse('2026-01-15T02:30:00.200Z'));
  assert.equal(visibleByIngestion(telemetry, Date.parse('2026-01-15T02:00:00.1Z')).length, 0);
  assert.equal(visibleByIngestion(telemetry, finalIngestion).length, telemetry.length);
});

test('path uses fixed scale and breaks at the telemetry interruption', () => {
  const telemetry = sortByIngestion(dataset.tables.telemetry);
  const geometry = pathGeometry(telemetry, telemetry);
  assert.equal(geometry.segments.length, 2);
  const partial = pathGeometry(telemetry.slice(0, 1), telemetry).segments[0];
  assert.equal(partial, geometry.segments[0].split(' L')[0]);
  assert.match(geometry.segments[1], /^M /);
});
