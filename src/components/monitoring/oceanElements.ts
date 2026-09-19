import * as THREE from 'three';

export function createOceanElements(terrainHeight: (x: number, z: number) => number) {
  const group = new THREE.Group();
  group.name = 'Marine habitat and instruments';
  const dummy = new THREE.Object3D();

  // A few compact patches leave the contacts and survey corridor clear.
  const patches = [[-20, -7], [9, -20], [25, 14], [-19, 21]];
  const blade = new THREE.PlaneGeometry(.22, 1, 1, 4);
  blade.translate(0, .5, 0);
  const vertices = blade.attributes.position;
  for (let i = 0; i < vertices.count; i++) {
    const height = vertices.getY(i);
    vertices.setX(i, vertices.getX(i) * (1 - height * .92));
    vertices.setZ(i, height * height * .23);
  }
  blade.computeVertexNormals();
  const grass = new THREE.InstancedMesh(blade, new THREE.MeshStandardMaterial({ color: '#467a5b', roughness: .95, side: THREE.DoubleSide }), 192);
  grass.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const stems = Array.from({ length: grass.count }, (_, i) => {
    const patch = patches[i % patches.length];
    const angle = i * 2.39996, radius = .4 + Math.sqrt((i % 48) / 48) * 4;
    const x = patch[0] + Math.cos(angle) * radius, z = patch[1] + Math.sin(angle) * radius;
    return { x, y: terrainHeight(x, z) - .04, z, angle, height: .65 + (i % 7) * .15 };
  });
  group.add(grass);

  const metal = new THREE.MeshStandardMaterial({ color: '#6d8589', roughness: .5, metalness: .65 });
  const yellow = new THREE.MeshStandardMaterial({ color: '#dcad43', roughness: .55, metalness: .2 });
  const anchor = new THREE.Mesh(new THREE.BoxGeometry(1.35, .45, 1.35), metal);
  const anchorY = terrainHeight(22, -8);
  anchor.position.set(22, anchorY + .18, -8);
  group.add(anchor);
  const tetherGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(22, anchorY + .4, -8),
    new THREE.Vector3(22.3, -9, -8.15),
    new THREE.Vector3(22, -3.8, -8),
  ]);
  const tether = new THREE.Line(tetherGeometry, new THREE.LineBasicMaterial({ color: '#b8c0a6' }));
  group.add(tether);

  const station = new THREE.Group();
  station.name = 'Seabed observation station';
  station.position.set(7, terrainHeight(7, -5), -5);
  const housing = new THREE.Mesh(new THREE.CylinderGeometry(.42, .42, 1.3, 16), yellow);
  housing.position.y = 1.25;
  station.add(housing);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(.42, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), metal);
  cap.position.y = 1.9;
  station.add(cap);
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < 3; i++) {
    const angle = i * Math.PI * 2 / 3;
    const bottom = new THREE.Vector3(Math.cos(angle) * 1.1, .06, Math.sin(angle) * 1.1);
    bottom.y = terrainHeight(7 + bottom.x, -5 + bottom.z) - station.position.y + .06;
    const top = new THREE.Vector3(0, 1.3, 0);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(.055, .055, top.distanceTo(bottom), 6), metal);
    leg.position.copy(top).add(bottom).multiplyScalar(.5);
    leg.quaternion.setFromUnitVectors(up, top.sub(bottom).normalize());
    station.add(leg);
  }
  const beaconMaterial = new THREE.MeshBasicMaterial({ color: '#77efd5' });
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(.12, 10, 8), beaconMaterial);
  beacon.position.y = 2.35;
  station.add(beacon);
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, .6, 6), metal);
  antenna.position.y = 2.18;
  station.add(antenna);
  group.add(station);

  const bubbles = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 6, 4),
    new THREE.MeshStandardMaterial({ color: '#c3ede8', roughness: .12, metalness: .25, transparent: true, opacity: .28, depthWrite: false }),
    36,
  );
  bubbles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // Moving instances stay inside this small survey area throughout the animation.
  bubbles.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -8, 0), 40);
  group.add(bubbles);

  function update(elapsed: number, buoyHeight = 0) {
    stems.forEach((stem, i) => {
      dummy.position.set(stem.x, stem.y, stem.z);
      dummy.rotation.set(Math.sin(elapsed * .7 + i * .6) * .12, stem.angle, Math.sin(elapsed * .55 + i) * .1);
      dummy.scale.set(1, stem.height, 1);
      dummy.updateMatrix();
      grass.setMatrixAt(i, dummy.matrix);
    });
    grass.instanceMatrix.needsUpdate = true;
    const tetherPositions = tetherGeometry.attributes.position;
    tetherPositions.setY(2, buoyHeight - 3.8);
    tetherPositions.needsUpdate = true;
    beaconMaterial.color.setRGB(.25, .65 + Math.sin(elapsed * 1.4) * .2, .55);
    for (let i = 0; i < bubbles.count; i++) {
      const x = i % 2 ? -12 : 16, z = i % 3 ? 4 : -13;
      const base = terrainHeight(x, z) + .25;
      const rise = (elapsed * (.3 + i % 4 * .04) + i * .83) % (-base - .3);
      dummy.position.set(x + Math.sin(elapsed * .35 + i) * .4, base + rise, z + Math.cos(i * 2.4) * .7);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(.025 + (i % 5) * .012);
      dummy.updateMatrix();
      bubbles.setMatrixAt(i, dummy.matrix);
    }
    bubbles.instanceMatrix.needsUpdate = true;
  }
  update(0);
  // Include all grass sway in the bounds used for frustum culling.
  grass.computeBoundingSphere();
  if (grass.boundingSphere) grass.boundingSphere.radius += 1;
  return { group, update };
}
