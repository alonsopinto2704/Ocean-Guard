// Run: node --import tsx scripts/check-ocean-elements.mjs
import assert from 'node:assert/strict';
import { createOceanElements } from '../src/components/monitoring/oceanElements.ts';

const terrain = (x, z) => -16 + Math.sin(x * .1) + Math.sin(z * .17) * .4;
const habitat = createOceanElements(terrain);
const instances = habitat.group.children.filter(object => object.isInstancedMesh);
assert.deepEqual(instances.map(object => object.count), [192, 36]);
assert.equal(habitat.group.getObjectByName('Seabed observation station').position.y, terrain(7, -5));

for (const time of [0, 10, 10000]) {
  habitat.update(time, .4);
  for (const mesh of instances) {
    assert.ok(Array.from(mesh.instanceMatrix.array).every(Number.isFinite), `Invalid transform at ${time}s`);
  }
  const bubbles = instances[1];
  for (let i = 0; i < bubbles.count; i++) {
    const y = bubbles.instanceMatrix.array[i * 16 + 13];
    assert.ok(y > -18 && y < 0, `Bubble escaped water column at ${time}s`);
  }
  const tether = habitat.group.children.find(object => object.isLine);
  assert.ok(Math.abs(tether.geometry.attributes.position.getY(2) - (.4 - 3.8)) < .00001);
}
console.log('Ocean habitat transforms, terrain placement, bubbles and buoy tether passed.');
