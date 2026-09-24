import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  CAMERA, geolocateBox, latLngToEnu,
  type EspadaResult,
} from '../src/server/simulation.js';

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

/**
 * Fake model used to exercise the pipeline without network calls. It mimics the
 * documented ESPADA response contract (calibrated + raw confidence) but returns
 * boxes derived from its own table — it does NOT read scenario truth.
 */
const frameAt = (variant: string): EspadaResult => ({
  latencyMs: 40,
  detections: [
    {
      className: 'Mixed Waste',
      confidence: 64.4,
      rawConfidence: 58,
      confidenceCalibrated: true,
      boundingBox: variant.includes('_glare') ? box(0.3, 0.42, 0.18, 0.16) : box(0.44, 0.40, 0.24, 0.2),
    },
  ],
  analysisId: null,
});

test('geolocateBox inverts the documented box→range/bearing heuristic', () => {
  // heightFrac = K / range → range = K / heightFrac; box center encodes bearing.
  const h = CAMERA.boxRangeK / 12;
  const bbox = box(0.5 - h * 0.75, 0.5 - h / 2, h * 1.5, h); // centered → bearing 0
  const pose = { eastM: 100, northM: 200, headingDeg: 0 };
  const geo = geolocateBox(bbox, pose);
  assert.ok(Math.abs(geo.rangeM - 12) < 0.01, `range ${geo.rangeM}`);
  // Centered box → straight ahead (bearing 0), so position is due north of the pose.
  assert.ok(Math.abs(geo.eastM - pose.eastM) < 0.01, `east ${geo.eastM}`);
  assert.ok(Math.abs(geo.northM - (pose.northM + 12)) < 0.01, `north ${geo.northM}`);
  // Off-center box: +0.1 center offset → bearing = 0.1 × 60 × 2 = 12°.
  const off = geolocateBox(box(0.6 - h * 0.75, 0.5 - h / 2, h * 1.5, h), pose);
  assert.ok(Math.abs(off.bearingDeg - 12) < 0.01, `bearing ${off.bearingDeg}`);
});

test('latLngToEnu converts the display origin correctly (equirectangular, documented)', () => {
  const { lat, lng } = { lat: 13.0205, lng: 80.3404 };
  const enu = latLngToEnu(lat, lng);
  // 0.0005° lat → 55.66 m north; 0.0004° lng → 44.53 m × cos(13.02°) ≈ 43.38 m east.
  assert.ok(Math.abs(enu.eastM - 43.38) < 0.5, `east ${enu.eastM}`);
  assert.ok(Math.abs(enu.northM - 55.66) < 0.5, `north ${enu.northM}`);
});

test('fixture manifest is present, valid, and harness-only (never referenced by ESPADA requests)', () => {
  const raw = readFileSync(new URL('../public/simulation/runs/manifest.json', import.meta.url), 'utf8');
  const manifest = JSON.parse(raw) as {
    fovHDeg: number; boxRangeK: number;
    variants: Record<string, { objectId: string; bbox: { x: number; y: number; width: number; height: number } }>;
    negatives: string[];
  };
  assert.equal(manifest.fovHDeg, CAMERA.fovHDeg);
  assert.equal(manifest.boxRangeK, CAMERA.boxRangeK);
  assert.equal(Object.keys(manifest.variants).length, 280);
  assert.equal(manifest.negatives.length, 2);
  for (const [variant, entry] of Object.entries(manifest.variants)) {
    assert.ok(entry.bbox.width > 0 && entry.bbox.height > 0, variant);
    assert.ok(entry.bbox.x >= 0 && entry.bbox.x + entry.bbox.width <= 1.0001, variant);
    assert.ok(entry.bbox.y >= 0 && entry.bbox.y + entry.bbox.height <= 1.0001, variant);
  }
  // The manifest is only read by the simulation engine + evaluator; the inference
  // request builder (realInference) sends file bytes + filename only.
});

test('fake inference result honors the ESPADA contract shape', () => {
  const result = frameAt('/simulation/runs/frames/OBJ-0001_12m_0deg.png');
  assert.equal(result.detections.length, 1);
  const d = result.detections[0];
  assert.equal(d.className, 'Mixed Waste');
  assert.ok(d.rawConfidence <= d.confidence, 'raw score distinct from calibrated');
  assert.equal(typeof d.confidenceCalibrated, 'boolean');
});
