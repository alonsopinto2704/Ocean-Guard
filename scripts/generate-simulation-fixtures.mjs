/**
 * Deterministic simulation fixture generator (seeded; same output every run).
 *
 * Produces:
 *   public/simulation/runs/manifest.json   truth-box manifest (harness-only; never sent to the detector)
 *   public/simulation/runs/frames/*.png    192x108 synthetic sea-surface frames (PNG encoded here, zero deps)
 *
 * The detector never receives object ids or truth boxes — the manifest stays in
 * this harness. Frames differ only by range/bearing bucket and glare flag so
 * per-frame precision/recall is measurable per variant.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const framesDir = path.join(root, 'public/simulation/runs/frames');
mkdirSync(framesDir, { recursive: true });

const W = 192, H = 108;
const FOV_H_DEG = 60;
const BEARING_PIXELS_FACTOR = 2;   // bearing = (centerX − 0.5) × FOV × 2
const BOX_RANGE_K = 5.4;
const VARIANT_RANGES = [8, 12, 18, 26];
const VARIANT_BEARINGS = [-30, -20, -10, 0, 10, 20, 30];

// ── Seeded RNG ───────────────────────────────────────────────────────────────
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Minimal PNG encoder (no dependencies) ────────────────────────────────────
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(pixels, width, height) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    pixels.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit, truecolor RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Scene rendering ──────────────────────────────────────────────────────────
function clamp01(v) { return Math.min(1, Math.max(0, v)); }

/** Render one 192x108 sea-surface frame with zero or one debris object. */
function renderFrame({ seed, bbox, glare = false, turbidity = 0.1 }) {
  const rng = makeRng(seed);
  const px = Buffer.alloc(W * H * 3);
  const set = (x, y, r, g, b) => {
    if (x < 0 || x >= W || y < 0 || y >= H) return;
    const i = (y * W + x) * 3;
    px[i] = Math.round(clamp01(r) * 255); px[i + 1] = Math.round(clamp01(g) * 255); px[i + 2] = Math.round(clamp01(b) * 255);
  };
  const haze = turbidity * 0.45 + (glare ? 0.25 : 0);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W, v = y / H;
      const wave = Math.sin(u * 22 + v * 9 + seed % 7) * 0.05 + Math.sin(u * 5 - v * 17 + seed % 11) * 0.04;
      let r = 0.10 + wave * 0.5 + v * 0.16;
      let g = 0.30 + wave * 0.7 + v * 0.22;
      let b = 0.38 + wave * 0.8 + v * 0.30;
      r = r * (1 - haze) + haze; g = g * (1 - haze) + haze; b = b * (1 - haze) + haze * 0.92;
      if (glare) {
        const band = Math.exp(-Math.pow((u - 0.68) * 5.2, 2));
        const glint = band * (0.55 + 0.35 * Math.sin(v * 60 + seed % 5));
        r += glint * 0.55; g += glint * 0.5; b += glint * 0.34;
      }
      set(x, y, r, g, b);
    }
  }
  // Debris blob (irregular, darker than water, warm hue) at the truth box.
  if (bbox) {
    const cx = (bbox.x + bbox.width / 2) * W;
    const cy = (bbox.y + bbox.height / 2) * H;
    const rx = (bbox.width * W) / 2;
    const ry = (bbox.height * H) / 2;
    for (let y = Math.floor(cy - ry - 2); y <= Math.ceil(cy + ry + 2); y++) {
      for (let x = Math.floor(cx - rx - 2); x <= Math.ceil(cx + rx + 2); x++) {
        const nx = (x - cx) / rx, ny = (y - cy) / ry;
        const d = nx * nx + ny * ny + 0.22 * Math.sin(Math.atan2(ny, nx) * 5 + seed % 9);
        if (d <= 1) {
          const shade = 0.75 + 0.25 * Math.sin(x * 0.9 + y * 1.3);
          set(x, y, 0.52 * shade, 0.38 * shade, 0.22 * shade);
        } else if (d <= 1.25) {
          set(x, y, 0.62, 0.55, 0.4); // foam ring
        }
      }
    }
  }
  return encodePng(px, W, H);
}

// ── Manifest ─────────────────────────────────────────────────────────────────
const manifest = { fovHDeg: FOV_H_DEG, boxRangeK: BOX_RANGE_K, variants: {}, negatives: [] };
const OBJECTS = ['OBJ-0001', 'OBJ-0002', 'OBJ-0003', 'OBJ-0004', 'OBJ-0005'];

let fileCount = 0;
for (const objectId of OBJECTS) {
  for (const rangeM of VARIANT_RANGES) {
    for (const bearingDeg of VARIANT_BEARINGS) {
      for (const glare of [false, true]) {
        const heightFrac = Math.min(0.42, BOX_RANGE_K / rangeM);
        const widthFrac = heightFrac * 1.5;
        // Bearing → pixel center with margin so the blob never clamps at the edge.
        const cx = 0.5 + (bearingDeg / (FOV_H_DEG * BEARING_PIXELS_FACTOR));
        const bbox = {
          x: clamp01(cx - widthFrac / 2),
          y: clamp01(0.5 - heightFrac / 2),
          width: Math.min(widthFrac, 1 - clamp01(cx - widthFrac / 2)),
          height: heightFrac,
        };
        const suffix = bearingDeg < 0 ? `neg${-bearingDeg}` : `${bearingDeg}`;
        const name = `${objectId}_${rangeM}m_${suffix}deg${glare ? '_glare' : ''}.png`;
        const seed = (objectId.charCodeAt(objectId.length - 1) * 1000 + rangeM * 10 + (bearingDeg + 90) + (glare ? 7 : 0)) >>> 0;
        writeFileSync(path.join(framesDir, name), renderFrame({ seed, bbox, glare, turbidity: glare ? 0.5 : 0.1 }));
        manifest.variants[`/simulation/runs/frames/${name}`] = { objectId, rangeM, bearingDeg, bbox };
        fileCount++;
      }
    }
  }
}

// Negative (no-object) frames: calm + glare.
for (const [i, glare] of [false, true].entries()) {
  const name = `NEGATIVE_empty_${glare ? 'glare' : 'calm'}.png`;
  writeFileSync(path.join(framesDir, name), renderFrame({ seed: 99 + i, bbox: null, glare, turbidity: glare ? 0.5 : 0.1 }));
  manifest.negatives.push(`/simulation/runs/frames/${name}`);
}

writeFileSync(path.join(root, 'public/simulation/runs/manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`Generated ${fileCount} variant frames + ${manifest.negatives.length} negatives + manifest in public/simulation/runs/`);
