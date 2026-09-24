import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('data/simulation-replays');
if (!fs.existsSync(dir)) {
  console.log('No simulation-replays directory found.');
  process.exit(0);
}

const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
console.log(`Starting scan of ${files.length} replay files in ${dir}...`);

const replays = [];
for (const f of files) {
  const filePath = path.join(dir, f);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    replays.push({ file: f, path: filePath, meta: data.meta });
  } catch (err) {
    console.error(`Error reading ${f}:`, err.message);
  }
}

// 1. Delete all zero-detection files
let zeroDeleted = 0;
const nonZero = [];
for (const item of replays) {
  const detections = item.meta?.detectionsCount ?? 0;
  if (detections === 0 && item.meta?.id !== 'REPLAY-01') {
    fs.unlinkSync(item.path);
    zeroDeleted++;
  } else {
    nonZero.push(item);
  }
}
console.log(`Deleted ${zeroDeleted} zero-detection files.`);

// 2. Deduplicate non-zero replays
// Group by: scenarioId + normalized scenario name + detectionsCount
const groups = new Map();
for (const item of nonZero) {
  const baseName = (item.meta?.name || '').replace(/\s*·\s*SIM-RUN-\d+/i, '').trim();
  const scenarioId = item.meta?.scenarioId || 'UNKNOWN';
  const detectionsCount = item.meta?.detectionsCount || 0;
  const eventsCount = item.meta?.eventsCount || 0;

  // Signature: scenario + base name + detections
  const groupKey = `${scenarioId}__${baseName}__${detectionsCount}`;
  if (!groups.has(groupKey)) {
    groups.set(groupKey, []);
  }
  groups.get(groupKey).push(item);
}

let duplicateDeleted = 0;
let keptCount = 0;

for (const [key, items] of groups.entries()) {
  // Sort by createdAt descending (newest first), tie-break by eventsCount descending
  items.sort((a, b) => {
    const timeA = Date.parse(a.meta?.createdAt || 0) || 0;
    const timeB = Date.parse(b.meta?.createdAt || 0) || 0;
    if (timeB !== timeA) return timeB - timeA;
    return (b.meta?.eventsCount || 0) - (a.meta?.eventsCount || 0);
  });

  const keep = items[0];
  keptCount++;

  const duplicates = items.slice(1);
  for (const dup of duplicates) {
    try {
      fs.unlinkSync(dup.path);
      duplicateDeleted++;
    } catch (err) {
      console.error(`Failed to delete duplicate ${dup.file}:`, err.message);
    }
  }

  console.log(`Kept: ${keep.meta.name} (${keep.meta.detectionsCount} detections, ${keep.meta.eventsCount} events) [${keep.file}]`);
  if (duplicates.length > 0) {
    console.log(`  -> Deleted ${duplicates.length} duplicate copies.`);
  }
}

console.log(`\nSummary:`);
console.log(`- Zero detection files removed: ${zeroDeleted}`);
console.log(`- Duplicate copies removed: ${duplicateDeleted}`);
console.log(`- Unique recordings kept: ${keptCount}`);

// Also clean replays.json at root if present
const rootReplaysPath = path.resolve('replays.json');
if (fs.existsSync(rootReplaysPath)) {
  try {
    const rootData = JSON.parse(fs.readFileSync(rootReplaysPath, 'utf8'));
    if (Array.isArray(rootData.replays)) {
      const before = rootData.replays.length;
      // Filter out 0-detection items
      const valid = rootData.replays.filter(r => (r.detectionsCount || 0) > 0 || r.id === 'REPLAY-01');
      // Deduplicate by signature
      const seen = new Set();
      const deduped = [];
      for (const r of valid) {
        const base = (r.name || '').replace(/\s*·\s*SIM-RUN-\d+/i, '').trim();
        const key = `${r.scenarioId}__${base}__${r.detectionsCount}`;
        if (!seen.has(key) || r.id === 'REPLAY-01') {
          seen.add(key);
          deduped.push(r);
        }
      }
      rootData.replays = deduped;
      fs.writeFileSync(rootReplaysPath, JSON.stringify(rootData, null, 2));
      console.log(`replays.json cleaned: before ${before} -> now ${deduped.length} entries.`);
    }
  } catch (err) {
    console.error('Error cleaning replays.json:', err.message);
  }
}
