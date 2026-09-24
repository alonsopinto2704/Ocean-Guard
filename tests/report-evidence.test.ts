import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

const dataDir = mkdtempSync(path.join(tmpdir(), 'oceanguard-report-'));
process.env.OCEANGUARD_WEB_DATA_DIR = dataDir;
const { storage } = await import('../src/server/storage.ts');

test('report preserves per-detection evidence and operator origin provenance', () => {
  const source = storage.getDetections()[0];
  assert.ok(source);
  const reviewed = storage.reviewDetectionOrigin(source.id, 'MAN_MADE', { id: 'TEST', email: 'test@example.invalid' });
  assert.equal(reviewed?.originReview?.label, 'MAN_MADE');
  const report = storage.createReport({ type: 'INCIDENT', zoneId: 'ALL', startDate: '2020-01-01', endDate: '2100-01-01' });
  const anomaly = report.anomalies?.find(item => item.detectionId === source.id);
  assert.ok(anomaly);
  assert.equal(anomaly.className, source.className);
  assert.equal(anomaly.confidencePercent, source.confidence);
  assert.deepEqual(anomaly.boundingBoxNormalized, source.boundingBox ?? null);
  assert.deepEqual(anomaly.location, { latitude: source.lat, longitude: source.lng, label: source.locationLabel });
  assert.equal(anomaly.originAssessment, 'MAN_MADE');
  assert.equal(anomaly.originAssessmentSource, 'OPERATOR_REVIEW');
  assert.equal(anomaly.provenance, 'PROTOTYPE_RECORD');
  assert.equal(report.anomalies?.length, report.metrics.totalDetectionsPeriod);
});

test.after(async () => {
  await delay(150); // Let the storage engine's debounced write finish before deleting the test directory.
  const resolved = path.resolve(dataDir);
  assert.ok(resolved.startsWith(path.resolve(tmpdir()) + path.sep));
  rmSync(resolved, { recursive: true, force: true });
});
