import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { Water } from 'three/examples/jsm/objects/Water.js';
import { createOceanElements } from './oceanElements';

export type OceanMode = 'surface' | 'underwater' | 'sonar';
export type CameraView = 'orbit' | 'bridge' | 'overhead' | 'inspect';
function terrainHeight(x: number, z: number) {
  return -16 + Math.sin(x * .1) * 1.1 + Math.sin(z * .17) * .4 + Math.sin(x * .48 + z * .3) * .12;
}
export const CONTACTS = [
  { id: 'NET-01', name: 'Drifting fishing net', type: 'Entanglement hazard', risk: 'HIGH', depth: 1.8, x: 12, z: -17, color: '#efb879' },
  { id: 'PET-02', name: 'Floating bottles', type: 'Surface litter', risk: 'MEDIUM', depth: 0, x: -10, z: -12, color: '#9fe1db' },
  { id: 'DRM-03', name: 'Discarded steel drum', type: 'Submerged toxic hazard', risk: 'HIGH', depth: -(terrainHeight(15, 9) + .62), x: 15, z: 9, color: '#efb879' },
  { id: 'TYR-04', name: 'Seabed tire', type: 'Submerged debris', risk: 'MEDIUM', depth: -(terrainHeight(-11, 8) + .2), x: -11, z: 8, color: '#9fe1db' },
  { id: 'BUO-05', name: 'Smart telemetry buoy', type: 'Oceanographic sensor node', risk: 'LOW', depth: 0, x: 22, z: -8, color: '#5eead4' },
  { id: 'DRN-06', name: 'Autonomous survey AUV', type: 'Glider drone (Manta-02)', risk: 'LOW', depth: 4.8, x: -16, z: 16, color: '#38bdf8' },
  { id: 'BAG-07', name: 'Ghost gear & polymer mass', type: 'Drifting plastic hazard', risk: 'HIGH', depth: 0.9, x: -5, z: -23, color: '#fb923c' },
  { id: 'WRE-08', name: 'Sunken cargo container', type: 'Seabed navigation hazard', risk: 'HIGH', depth: -(terrainHeight(3, 24) + 1.25), x: 3, z: 24, color: '#f87171' },
] as const;

function rng(seed: number) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; }; }
export function waveHeight(x: number, z: number, t: number, strength = 1) {
  return strength * (Math.sin(x * .18 + z * .1 - t * .85) * .28 + Math.sin(x * -.12 + z * .25 - t * 1.1) * .13);
}

function weatheredTexture(kind: 'deck' | 'rust' | 'sand') {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const random = rng(kind === 'rust' ? 34 : 91);
  ctx.fillStyle = kind === 'rust' ? '#786a53' : kind === 'sand' ? '#a59874' : '#c8c5b7';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 14000; i++) {
    const light = random() * 100;
    ctx.fillStyle = kind === 'rust' ? `rgba(${90 + light},${40 + light * .35},22,${random() * .65})` : `rgba(${light},${light},${light * .85},.13)`;
    ctx.fillRect(random() * 256, random() * 256, random() * 3 + 1, random() * 3 + 1);
  }
  if (kind === 'deck') {
    ctx.strokeStyle = '#8f958d'; ctx.lineWidth = 1;
    for (let i = 0; i < 256; i += 32) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.stroke(); }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(kind === 'sand' ? 36 : 2, kind === 'sand' ? 36 : 2);
  return texture;
}

function vessel() {
  const boat = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: '#e9e7db', roughness: .4, metalness: .12 });
  const hullMat = new THREE.MeshStandardMaterial({ color: '#183e48', roughness: .4, metalness: .28 });
  const metal = new THREE.MeshStandardMaterial({ color: '#b0b9b6', roughness: .27, metalness: .8 });
  const rubber = new THREE.MeshStandardMaterial({ color: '#242e2f', roughness: .88 });
  const glass = new THREE.MeshPhysicalMaterial({ color: '#204049', roughness: .07, metalness: .32, clearcoat: 1 });
  function box(w: number, h: number, d: number, x: number, y: number, z: number, mat = white) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; boat.add(mesh); return mesh;
  }
  function rail(a: number[], b: number[], radius = .035, mat = metal) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, start.distanceTo(end), 8), mat);
    mesh.position.copy(start).add(end).multiplyScalar(.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.sub(start).normalize());
    boat.add(mesh); return mesh;
  }
  // Hull stations form a pointed bow, flared sides, and a submerged keel.
  const stations = [[-8, .05], [-6.7, 1.65], [-4.7, 2.45], [3.8, 2.5], [6.5, 2.15]];
  const vertices: number[] = [], indices: number[] = [];
  for (const [z, beam] of stations) {
    for (const [x, y] of [[-beam, 1.3], [-beam * .78, -.65], [0, -1.3], [beam * .78, -.65], [beam, 1.3]]) vertices.push(x, y, z);
  }
  for (let s = 0; s < stations.length - 1; s++) for (let j = 0; j < 4; j++) {
    const a = s * 5 + j, b = a + 5; indices.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geo.setIndex(indices); geo.computeVertexNormals();
  hullMat.side = THREE.DoubleSide;
  const hull = new THREE.Mesh(geo, hullMat); hull.castShadow = hull.receiveShadow = true; boat.add(hull);
  box(4.28, 1.75, .12, 0, .38, 6.5, hullMat);
  const outline = new THREE.Shape(); outline.moveTo(0, -8);
  outline.lineTo(1.65, -6.7); outline.lineTo(2.45, -4.7); outline.lineTo(2.5, 3.8); outline.lineTo(2.15, 6.5);
  outline.lineTo(-2.15, 6.5); outline.lineTo(-2.5, 3.8); outline.lineTo(-2.45, -4.7); outline.lineTo(-1.65, -6.7); outline.closePath();
  const deck = new THREE.Mesh(new THREE.ShapeGeometry(outline), new THREE.MeshStandardMaterial({ map: weatheredTexture('deck'), roughness: .9, side: THREE.DoubleSide }));
  deck.rotation.x = Math.PI / 2; deck.position.y = 1.34; deck.receiveShadow = true; boat.add(deck);
  box(3.65, 2.25, 4.8, 0, 2.49, -.8);
  box(3.9, .16, 5.1, 0, 3.7, -.85);
  // Individual inset bridge windows, frames, and sloped forward glazing.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) box(.035, .8, 1.08, side * 1.84, 2.97, -2.1 + i * 1.35, glass);
    for (let i = 0; i < 3; i++) box(.82, .78, .04, (i - 1) * 1.08, 2.97, -3.22, glass);
    for (let i = 0; i < 7; i++) {
      const z = -4.4 + i * 1.62, x = side * (z > 4 ? 2.15 : 2.42);
      rail([x, 1.35, z], [x, 2.27, z]);
      if (i < 6) rail([x, 2.27, z], [side * (z + 1.62 > 4 ? 2.15 : 2.42), 2.27, z + 1.62]);
    }
    rail([side * 2.42, 2.27, -4.4], [side * 1.5, 2.27, -6.65]);
    rail([side * 1.5, 2.27, -6.65], [0, 2.27, -7.75]);
    for (let i = 0; i < 3; i++) {
      const fender = new THREE.Mesh(new THREE.CapsuleGeometry(.2, .65, 4, 10), rubber);
      fender.position.set(side * 2.55, .95, -.5 + i * 2.2); boat.add(fender);
    }
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(.08, 8, 8), new THREE.MeshBasicMaterial({ color: side < 0 ? '#ff3d29' : '#61edb3' }));
    lamp.position.set(side * 1.92, 3.76, -2.9); boat.add(lamp);
  }
  rail([0, 3.75, .5], [0, 7, .5], .07);
  rail([-1.1, 6.3, .5], [1.1, 6.3, .5], .04);
  rail([-.9, 3.75, .5], [0, 6, .5], .04);
  rail([.9, 3.75, .5], [0, 6, .5], .04);
  const radar = box(1.85, .17, .33, 0, 6.9, .5); radar.name = 'radar';
  for (const x of [-1, 1]) {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(.36, 20, 16), white); dome.position.set(x, 4.05, 1); boat.add(dome);
  }
  box(1.7, .55, 1.7, 0, 1.65, 4.7, new THREE.MeshStandardMaterial({ color: '#c6a664', roughness: .82 }));
  const lifeMat = new THREE.MeshStandardMaterial({ color: '#cf592e', roughness: .62 });
  const life = new THREE.Mesh(new THREE.TorusGeometry(.43, .13, 12, 28), lifeMat); life.position.set(0, 2.6, 1.65); boat.add(life);
  for (let i = 0; i < 4; i++) rail([1.2, 1.6 + i * .36, 1.8], [1.7, 1.6 + i * .36, 1.8], .025);
  // Hull name is an in-world decal, lit with the rest of the boat.
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#e5ede6'; ctx.font = 'bold 50px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('OCEANGUARD 01', 256, 70);
  const label = new THREE.CanvasTexture(canvas); label.colorSpace = THREE.SRGBColorSpace;
  const nameplate = new THREE.Mesh(new THREE.PlaneGeometry(2.7, .68), new THREE.MeshStandardMaterial({ map: label, transparent: true, depthWrite: false }));
  nameplate.position.set(2.51, .66, 1.1); nameplate.rotation.y = Math.PI / 2; boat.add(nameplate);
  return boat;
}

function buildContact(index: number) {
  const group = new THREE.Group();
  if (index === 0) {
    const points: THREE.Vector3[] = [];
    const knot = (u: number, v: number) => new THREE.Vector3(u * 5.2, -.1 - Math.sin(v * Math.PI) * 1.6, v * 3.4 + Math.sin(u * 5) * .2);
    for (let u = -.5; u <= .5; u += .045) for (let v = 0; v < 1; v += .055) points.push(knot(u, v), knot(u, v + .055));
    for (let v = 0; v <= 1; v += .055) for (let u = -.5; u < .5; u += .045) points.push(knot(u, v), knot(u + .045, v));
    group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: '#69774a' })));
    for (let i = 0; i < 7; i++) {
      const buoy = new THREE.Mesh(new THREE.SphereGeometry(.15, 16, 12), new THREE.MeshStandardMaterial({ color: i % 2 ? '#d6bc7b' : '#d16c35', roughness: .7 }));
      buoy.position.set(-2.6 + i * .86, .02, 0); group.add(buoy);
    }
  } else if (index === 1) {
    const random = rng(3);
    const plastic = new THREE.MeshStandardMaterial({ color: '#d3e4df', metalness: .02, roughness: .2, transparent: true, opacity: .8 });
    const profile = [[0, -.36], [.1, -.35], [.12, -.3], [.12, .17], [.07, .26], [.045, .29], [.045, .36]].map(([x,y]) => new THREE.Vector2(x, y));
    for (let i = 0; i < 9; i++) {
      const bottle = new THREE.Group(); bottle.add(new THREE.Mesh(new THREE.LatheGeometry(profile, 16), plastic));
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(.052, .052, .065, 12), new THREE.MeshStandardMaterial({ color: i % 2 ? '#437f81' : '#dedbd2' }));
      cap.position.y = .39; bottle.add(cap);
      bottle.rotation.set(1.5, random() * 6, random() * .5); bottle.position.set((random() - .5) * 3, .05, (random() - .5) * 2.5); group.add(bottle);
    }
  } else if (index === 2) {
    const rusty = new THREE.MeshStandardMaterial({ map: weatheredTexture('rust'), roughness: .94, metalness: .35 });
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(.45, .45, 1.25, 32), rusty); drum.rotation.z = 1.15; group.add(drum);
    for (const y of [-.52, -.3, .3, .52]) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(.455, .022, 6, 40), rusty); rim.rotation.x = Math.PI / 2; rim.position.y = y; drum.add(rim);
    }
  } else if (index === 3) {
    const rubber = new THREE.MeshStandardMaterial({ color: '#262c29', roughness: .98 });
    const tire = new THREE.Mesh(new THREE.TorusGeometry(.63, .24, 14, 48), rubber); tire.rotation.x = Math.PI / 2; group.add(tire);
    for (let i = 0; i < 40; i++) {
      const tread = new THREE.Mesh(new THREE.BoxGeometry(.065, .39, .055), rubber);
      const a = i / 40 * Math.PI * 2; tread.position.set(Math.sin(a) * .85, 0, Math.cos(a) * .85); tread.rotation.y = a + .3; group.add(tread);
    }
  } else if (index === 4) {
    // BUO-05: Smart telemetry buoy
    const yellow = new THREE.MeshStandardMaterial({ color: '#eab308', roughness: .35, metalness: .1 });
    const orange = new THREE.MeshStandardMaterial({ color: '#ea580c', roughness: .4 });
    const darkMetal = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: .5, metalness: .8 });
    const floatMesh = new THREE.Mesh(new THREE.CylinderGeometry(.65, .55, 1.2, 24), yellow);
    floatMesh.position.y = .3; group.add(floatMesh);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(.66, .08, 8, 24), orange);
    collar.rotation.x = Math.PI / 2; collar.position.y = .5; group.add(collar);
    const waterline = new THREE.Mesh(new THREE.CylinderGeometry(.56, .45, .4, 24), orange);
    waterline.position.y = -.2; group.add(waterline);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, 1.3, 8), darkMetal);
      leg.position.set(Math.cos(a) * .35, 1.15, Math.sin(a) * .35);
      group.add(leg);
    }
    const solar = new THREE.Mesh(new THREE.CylinderGeometry(.42, .42, .05, 16), darkMetal);
    solar.position.y = 1.0; group.add(solar);
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(.12, .12, .18, 12), darkMetal);
    housing.position.y = 1.85; group.add(housing);
    const strobe = new THREE.Mesh(new THREE.SphereGeometry(.09, 12, 12), new THREE.MeshBasicMaterial({ color: '#5eead4' }));
    strobe.name = 'buoyStrobe'; strobe.position.y = 1.98; group.add(strobe);
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(.012, .012, 1.1, 6), darkMetal);
    antenna.position.y = 2.45; group.add(antenna);
    const keel = new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, 3.5, 6), darkMetal);
    keel.position.y = -2.1; group.add(keel);
  } else if (index === 5) {
    // DRN-06: Autonomous survey AUV 'Manta-02'
    const auvYellow = new THREE.MeshStandardMaterial({ color: '#facc15', roughness: .3, metalness: .15 });
    const auvCarbon = new THREE.MeshStandardMaterial({ color: '#0f172a', roughness: .4, metalness: .7 });
    const auvGlass = new THREE.MeshStandardMaterial({ color: '#38bdf8', roughness: .1, metalness: .2, transparent: true, opacity: .85 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(.32, 1.8, 8, 16), auvYellow);
    body.rotation.x = Math.PI / 2; group.add(body);
    const belly = new THREE.Mesh(new THREE.BoxGeometry(.45, .15, 1.4), auvCarbon);
    belly.position.y = -.22; group.add(belly);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(.28, 16, 16), auvGlass);
    dome.position.set(0, 0, -1.1); group.add(dome);
    const beam = new THREE.Mesh(new THREE.ConeGeometry(1.2, 4.5, 16, 1, true), new THREE.MeshBasicMaterial({ color: '#38bdf8', transparent: true, opacity: .16, side: THREE.DoubleSide, depthWrite: false }));
    beam.rotation.x = -Math.PI / 2; beam.position.set(0, 0, -3.3); group.add(beam);
    const wings = new THREE.Mesh(new THREE.BoxGeometry(2.4, .04, .38), auvCarbon);
    wings.position.set(0, .02, -.1); group.add(wings);
    for (const sx of [-1.18, 1.18]) {
      const pod = new THREE.Mesh(new THREE.CapsuleGeometry(.065, .32, 4, 8), auvYellow);
      pod.rotation.x = Math.PI / 2; pod.position.set(sx, .02, -.1); group.add(pod);
    }
    const fin = new THREE.Mesh(new THREE.BoxGeometry(.04, .45, .32), auvCarbon);
    fin.position.set(0, .32, .85); group.add(fin);
    for (const sx of [-.24, .24]) {
      const cowl = new THREE.Mesh(new THREE.CylinderGeometry(.11, .11, .28, 12, 1, true), auvCarbon);
      cowl.rotation.x = Math.PI / 2; cowl.position.set(sx, 0, 1.05); group.add(cowl);
      const hub = new THREE.Mesh(new THREE.SphereGeometry(.05, 8, 8), auvYellow);
      hub.position.set(sx, 0, 1.05); group.add(hub);
    }
  } else if (index === 6) {
    // BAG-07: Ghost gear & polymer mass (drifting near-surface plastics)
    const filmMat = new THREE.MeshStandardMaterial({ color: '#dbeafe', roughness: .35, transparent: true, opacity: .72, side: THREE.DoubleSide });
    const ropeMat = new THREE.MeshStandardMaterial({ color: '#f97316', roughness: .8 });
    const random = rng(77);
    for (let i = 0; i < 7; i++) {
      const sheet = new THREE.Mesh(new THREE.PlaneGeometry(.7 + random() * .5, .6 + random() * .6, 4, 4), filmMat);
      sheet.position.set((random() - .5) * 1.6, (random() - .5) * .8, (random() - .5) * 1.6);
      sheet.rotation.set(random() * Math.PI, random() * Math.PI, random() * Math.PI);
      group.add(sheet);
    }
    const ropeCurve: THREE.Vector3[] = [];
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 4;
      ropeCurve.push(new THREE.Vector3(Math.cos(a) * .6 + (random() - .5) * .3, (i / 18) * .8 - .4, Math.sin(a) * .6 + (random() - .5) * .3));
    }
    for (let i = 0; i < ropeCurve.length - 1; i++) {
      const p1 = ropeCurve[i], p2 = ropeCurve[i + 1];
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(.02, .02, p1.distanceTo(p2), 6), ropeMat);
      seg.position.copy(p1).add(p2).multiplyScalar(.5);
      seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p2.clone().sub(p1).normalize());
      group.add(seg);
    }
  } else {
    // WRE-08: Sunken shipping cargo container
    const rustMat = new THREE.MeshStandardMaterial({ map: weatheredTexture('rust'), roughness: .95, metalness: .4 });
    const mainBox = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.5, 5.8), rustMat);
    group.add(mainBox);
    for (let i = -11; i <= 11; i++) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(2.46, 2.44, .08), rustMat);
      rib.position.z = i * .24; group.add(rib);
    }
    const steelMat = new THREE.MeshStandardMaterial({ color: '#2b2d2f', roughness: .7, metalness: .8 });
    for (const sx of [-1.22, 1.22]) {
      for (const sz of [-2.92, 2.92]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(.18, 2.54, .18), steelMat);
        post.position.set(sx, 0, sz); group.add(post);
      }
    }
    group.rotation.set(.08, .35, -.05);
  }
  const c = CONTACTS[index]; group.position.set(c.x, -c.depth, c.z);
  group.traverse(object => { object.userData.contact = c.id; if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true; } });
  return group;
}

export interface OceanController {
  setMode(mode: OceanMode): void;
  setCamera(view: CameraView): void;
  select(id: string): void;
  setWaves(value: number): void;
  setPaused(paused: boolean): void;
  zoom(amount: number): void;
  setDepth(depth: number): void;
  dispose(): void;
}

export function createOceanScene(container: HTMLElement, onSelect: (id: string) => void, onFrame: (fps: number, depth: number, heading: number) => void, labels: Map<string, HTMLElement>, onError: (message: string | null) => void, onModeChange: (mode: OceanMode) => void = () => {}, onNavigate: () => void = () => {}): OceanController {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .7;
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene(); scene.fog = new THREE.FogExp2('#c3d7da', .0009);
  const camera = new THREE.PerspectiveCamera(48, 1, .1, 12000); camera.position.set(26, 12, 33);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1, -5); controls.enableDamping = true; controls.dampingFactor = .06; controls.minDistance = 3; controls.maxDistance = 110; controls.maxPolarAngle = Math.PI * .95;
  const sky = new Sky(); sky.scale.setScalar(10000); scene.add(sky);
  const sun = new THREE.Vector3(.8, .42, -.5).normalize();
  sky.material.uniforms.turbidity.value = 2.7; sky.material.uniforms.rayleigh.value = 2.2;
  sky.material.uniforms.mieCoefficient.value = .004; sky.material.uniforms.mieDirectionalG.value = .85; sky.material.uniforms.sunPosition.value.copy(sun);
  const pmrem = new THREE.PMREMGenerator(renderer); const environment = pmrem.fromScene(sky as unknown as THREE.Scene); scene.environment = environment.texture; scene.environmentIntensity = .45; pmrem.dispose();
  const hemi = new THREE.HemisphereLight('#daeaf2', '#586a56', 1.1); scene.add(hemi);
  const sunlight = new THREE.DirectionalLight('#fff0d5', 2); sunlight.position.copy(sun).multiplyScalar(100);
  sunlight.castShadow = true; sunlight.shadow.mapSize.set(1024, 1024); sunlight.shadow.camera.left = -40; sunlight.shadow.camera.right = 40; sunlight.shadow.camera.top = 40; sunlight.shadow.camera.bottom = -40; sunlight.shadow.camera.far = 240; sunlight.shadow.normalBias = .035; scene.add(sunlight);

  // Concentrate vertices around the survey boat while retaining a true horizon.
  const compactScene = container.clientWidth < 768;
  const oceanGeometry = new THREE.PlaneGeometry(2, 2, compactScene ? 144 : 256, compactScene ? 144 : 256);
  const oceanPositions = oceanGeometry.attributes.position;
  const stretch = (u: number) => Math.sign(u) * 25 * (Math.exp(Math.abs(u) * Math.log(201)) - 1);
  for (let i = 0; i < oceanPositions.count; i++) { oceanPositions.setX(i, stretch(oceanPositions.getX(i))); oceanPositions.setY(i, stretch(oceanPositions.getY(i))); }
  oceanGeometry.computeBoundingSphere();
  const water = new Water(oceanGeometry, { textureWidth: 512, textureHeight: 512, sunDirection: sun, sunColor: '#fff2df', waterColor: '#104e52', distortionScale: .85, fog: true });
  water.rotation.x = -Math.PI / 2;
  water.material.uniforms.seaState = { value: 1 };
  water.material.vertexShader = water.material.vertexShader.replace('uniform float time;', 'uniform float time; uniform float seaState;').replace('void main() {', `void main() {
    vec3 displaced = position;
    displaced.z = seaState * (sin(position.x * .18 - position.y * .1 - time * .85) * .28 + sin(position.x * -.12 - position.y * .25 - time * 1.1) * .13);
  `).replaceAll('vec4( position, 1.0 )', 'vec4( displaced, 1.0 )');
  water.material.fragmentShader = water.material.fragmentShader.replace('uniform float size;', 'uniform float size; uniform float seaState;').replace(/vec4 getNoise\( vec2 uv \) \{[\s\S]*?return noise \* 0\.5 - 1\.0;\s*\}/, `vec4 getNoise(vec2 uv) {
    vec2 slope = vec2(.18,.1) * cos(uv.x*.18 + uv.y*.1 - time*.85)*.28
      + vec2(-.12,.25)*cos(uv.x*-.12 + uv.y*.25 - time*1.1)*.13;
    for(int i=0;i<4;i++) {
      float f = float(i); float angle = f * 2.399;
      vec2 dir = vec2(cos(angle), sin(angle));
      float freq = .18 * pow(1.65, f);
      float phase = dot(uv, dir) * freq - time * sqrt(9.81 * freq) * .65;
      float antialias = 1.0 - smoothstep(.3, 1.5, length(fwidth(uv)) * freq);
      slope += dir * cos(phase) * (.022 / (1.0 + f*.4)) * antialias;
    }
    return vec4(-slope * seaState, 1.0, 1.0);
  }`);
  water.material.fragmentShader = water.material.fragmentShader.replace('100.0, 2.0, 0.5', '90.0, 0.45, 0.5');
  scene.add(water);

  const undersideMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { time: { value: 0 }, seaState: { value: 1 } }]),
    vertexShader: `uniform float time; uniform float seaState; varying vec3 seaPosition;
      #include <common>
      #include <fog_pars_vertex>
      void main() {
        vec3 p = position;
        p.z = seaState * (sin(p.x*.18-p.y*.1-time*.85)*.28 + sin(p.x*-.12-p.y*.25-time*1.1)*.13);
        seaPosition = (modelMatrix * vec4(p, 1.0)).xyz;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `uniform float time; varying vec3 seaPosition;
      #include <common>
      #include <fog_pars_fragment>
      void main() {
        vec3 ray = normalize(seaPosition-cameraPosition);
        float window = pow(max(ray.y, 0.0), 3.0);
        float ripple = sin(seaPosition.x*.8 + sin(seaPosition.z*.65-time*.4)*2.0 + time*.5);
        vec3 color = mix(vec3(.035,.16,.18), vec3(.3,.56,.53), window);
        color += (.018 + window*.04) * ripple;
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const underside = new THREE.Mesh(oceanGeometry, undersideMaterial); underside.rotation.x = -Math.PI/2; underside.visible = false; scene.add(underside);
  const landscape = new THREE.Group(); scene.add(landscape);
  for (let island = 0; island < 4; island++) {
    const geometry = new THREE.PlaneGeometry(1000, 420, 96, 40); geometry.rotateX(-Math.PI / 2);
    const positions = geometry.attributes.position; const colors = new Float32Array(positions.count * 3);
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), z = positions.getZ(i);
      const envelope = Math.max(0, 1 - (x / 500) ** 2) * Math.max(0, 1 - (z / 210) ** 2);
      const h = envelope * (45 + 28 * Math.sin(x * .013 + island * 3) + 18 * Math.sin(x * .043 + z * .025) + 8 * Math.sin(z * .11 + x * .13)) - 3;
      positions.setY(i, h);
      const color = new THREE.Color(h < 5 ? '#aba18a' : h > 45 ? '#5b6255' : '#4b6250'); color.multiplyScalar(.8 + .2 * Math.sin(x * .3));
      colors.set([color.r, color.g, color.b], i * 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3)); geometry.computeVertexNormals();
    const islandMesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    islandMesh.position.set(-1100 + island * 720, 0, -900 - (island % 2) * 220); landscape.add(islandMesh);
  }
  const boat = vessel(); scene.add(boat);
  const habitat = createOceanElements(terrainHeight); scene.add(habitat.group);
  const contactMeshes = CONTACTS.map((_, i) => buildContact(i)); contactMeshes.forEach(c => scene.add(c));
  const radar = boat.getObjectByName('radar')!;
  const buoyStrobe = contactMeshes[4].getObjectByName('buoyStrobe') as THREE.Mesh;
  const floatingIndices = [0, 1, 4, 6];

  const seabedGeometry = new THREE.PlaneGeometry(600, 600, 150, 150); seabedGeometry.rotateX(-Math.PI / 2);
  const bedPositions = seabedGeometry.attributes.position;
  for (let i = 0; i < bedPositions.count; i++) { bedPositions.setY(i, terrainHeight(bedPositions.getX(i), bedPositions.getZ(i))); }
  seabedGeometry.computeVertexNormals();
  const bedMaterial = new THREE.MeshStandardMaterial({ map: weatheredTexture('sand'), roughness: 1 });
  const causticTime = { value: 0 }, causticStrength = { value: 0 };
  bedMaterial.onBeforeCompile = shader => {
    shader.uniforms.causticTime = causticTime; shader.uniforms.causticStrength = causticStrength;
    shader.vertexShader = 'varying vec3 bedWorld;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n bedWorld = (modelMatrix * vec4(position, 1.0)).xyz;');
    shader.fragmentShader = 'varying vec3 bedWorld; uniform float causticTime; uniform float causticStrength;\n' + shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      vec2 p = bedWorld.xz * .9;
      float a = sin(p.x + sin(p.y + causticTime*.27)) + sin(p.y*.86 - causticTime*.3);
      float b = sin(p.x*.79 - causticTime*.22 + cos(p.y*1.23)) + cos(p.y + causticTime*.21);
      float light = pow(max(0.0, 1.0-abs(a*b)), 14.0);
      diffuseColor.rgb *= 1.0 + light * causticStrength;
    `);
  };
  const seabed = new THREE.Mesh(seabedGeometry, bedMaterial); seabed.receiveShadow = true; scene.add(seabed);
  const random = rng(51);
  const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: '#626e60', roughness: 1 }), 100);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 100; i++) { const x = (random() - .5) * 150, z = (random() - .5) * 150; dummy.position.set(x, terrainHeight(x,z), z); dummy.scale.set(.5 + random() * 2, .2 + random(), .5 + random() * 2); dummy.rotation.set(random(), random() * 6, random()); dummy.updateMatrix(); rocks.setMatrixAt(i, dummy.matrix); } scene.add(rocks);

  // Marine wildlife: animated schooling fish
  const fishCount = 28;
  const fishGeometry = new THREE.ConeGeometry(.09, .48, 5);
  fishGeometry.rotateX(Math.PI / 2);
  const fishMaterial = new THREE.MeshStandardMaterial({ color: '#7dd3fc', roughness: .35, metalness: .65 });
  const fishSchool = new THREE.InstancedMesh(fishGeometry, fishMaterial, fishCount);
  scene.add(fishSchool);

  const particlesGeometry = new THREE.BufferGeometry(); const particlesArray = new Float32Array(700 * 3);
  for (let i = 0; i < 700; i++) particlesArray.set([(random() - .5) * 110, -random() * 16, (random() - .5) * 110], i * 3);
  particlesGeometry.setAttribute('position', new THREE.BufferAttribute(particlesArray, 3));
  const particles = new THREE.Points(particlesGeometry, new THREE.PointsMaterial({ color: '#b4d9c4', size: .035, transparent: true, opacity: .35, depthWrite: false })); scene.add(particles);
  const scanner = new THREE.Group();
  for (const r of [10, 20, 30, 40, 50]) {
    const circle = new THREE.Mesh(new THREE.RingGeometry(r - .035, r, 128), new THREE.MeshBasicMaterial({ color: '#50cba4', transparent: true, opacity: .22, side: THREE.DoubleSide })); circle.rotation.x = -Math.PI / 2; circle.position.y = -15; scanner.add(circle);
  }
  const scan = new THREE.Mesh(new THREE.RingGeometry(.2, 50, 96, 1, 0, .35), new THREE.MeshBasicMaterial({ color: '#5ddbb6', transparent: true, opacity: .12, side: THREE.DoubleSide, depthWrite: false })); scan.rotation.x = -Math.PI / 2; scan.position.y = -14.9; scanner.add(scan); scanner.visible = false; scene.add(scanner);
  const selectedRing = new THREE.Mesh(new THREE.RingGeometry(2.7, 2.74, 80), new THREE.MeshBasicMaterial({ color: '#f6d09a', transparent: true, opacity: .75, side: THREE.DoubleSide, depthTest: false, depthWrite: false })); selectedRing.rotation.x = -Math.PI / 2; scene.add(selectedRing);

  let mode: OceanMode = 'surface', selected = CONTACTS[0].id as string, waveStrength = 1, paused = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  let frameId = 0, elapsed = 0, previous = performance.now(), fpsTime = previous, frames = 0, labelTime = 0, telemetryTime = 0, frameRate = 60, disposed = false, contextLost = false;
  const targetCamPos = new THREE.Vector3(26, 12, 33);
  const targetLookAt = new THREE.Vector3(0, 1, -5);
  let isTransitioning = false;
  let presetTransition = false;
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  const surfaceFog = new THREE.Color('#c3d7da'), deepFog = new THREE.Color('#12535a'), sonarFog = new THREE.Color('#061c20');
  const background = new THREE.Color();
  const fog = scene.fog as THREE.FogExp2;
  controls.enableZoom = false;
  function descend(pixels: number) {
    presetTransition = false;
    if (!isTransitioning) {
      targetCamPos.copy(camera.position);
      targetLookAt.copy(controls.target);
    }
    const nextY = THREE.MathUtils.clamp(targetCamPos.y - pixels * .025, terrainHeight(targetCamPos.x, targetCamPos.z) + 1.5, 65);
    targetLookAt.y = THREE.MathUtils.clamp(targetLookAt.y + nextY - targetCamPos.y, -35, 80);
    targetCamPos.y = nextY;
    isTransitioning = true;
    onNavigate();
  }
  const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey) return;
    event.preventDefault();
    descend(THREE.MathUtils.clamp(event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? container.clientHeight : 1), -160, 160));
  };
  renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
  const onOrbitStart = () => { isTransitioning = false; };
  controls.addEventListener('start', onOrbitStart);
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(), projected = new THREE.Vector3(), cameraDirection = new THREE.Vector3();
  let down = [0, 0];
  const onDown = (e: PointerEvent) => { down = [e.clientX, e.clientY]; };
  const onUp = (e: PointerEvent) => {
    if (Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
    const rect = renderer.domElement.getBoundingClientRect(); pointer.set((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1); raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(contactMeshes, true)[0]; if (hit?.object.userData.contact) onSelect(hit.object.userData.contact);
  };
  renderer.domElement.addEventListener('pointerdown', onDown); renderer.domElement.addEventListener('pointerup', onUp);
  const onContextLost = (event: Event) => {
    event.preventDefault();
    if (disposed || contextLost) return;
    contextLost = true; cancelAnimationFrame(frameId);
    onError('The 3D graphics context was interrupted. OceanGuard will resume the scene if the browser restores it.');
  };
  const onContextRestored = () => {
    if (disposed || !contextLost) return;
    contextLost = false;
    previous = fpsTime = performance.now(); frames = 0; resize(); onError(null);
    frameId = requestAnimationFrame(frame);
  };
  renderer.domElement.addEventListener('webglcontextlost', onContextLost);
  renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);
  const resize = () => {
    const w = Math.max(container.clientWidth, 1), h = Math.max(container.clientHeight, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, w < 768 ? 1 : 1.25));
    camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
  };
  const observer = new ResizeObserver(resize); observer.observe(container); resize();
  function constrainView() {
    controls.target.x = THREE.MathUtils.clamp(controls.target.x, -100, 100);
    controls.target.z = THREE.MathUtils.clamp(controls.target.z, -100, 100);
    camera.position.x = THREE.MathUtils.clamp(camera.position.x, -140, 140);
    camera.position.z = THREE.MathUtils.clamp(camera.position.z, -140, 140);
    controls.target.y = THREE.MathUtils.clamp(controls.target.y, -35, 80);
    camera.position.y = THREE.MathUtils.clamp(camera.position.y, terrainHeight(camera.position.x, camera.position.z) + .8, 90);
  }
  function frame(now: number) {
    frameId = requestAnimationFrame(frame);
    const dt = Math.min((now - previous) / 1000, .05); previous = now;
    if (document.hidden) { fpsTime = now; frames = 0; return; }
    // These objects are fully occluded by the opaque water from above.
    const showSubmerged = camera.position.y < 1 || mode === 'sonar';
    habitat.group.visible = seabed.visible = rocks.visible = fishSchool.visible = showSubmerged;
    if (!paused) elapsed += dt;
    water.material.uniforms.time.value = elapsed; water.material.uniforms.seaState.value = waveStrength;
    undersideMaterial.uniforms.time.value = elapsed; undersideMaterial.uniforms.seaState.value = waveStrength; causticTime.value = elapsed;
    boat.position.y = waveHeight(0, 0, elapsed, waveStrength);
    if (showSubmerged && !paused) habitat.update(elapsed, waveHeight(22, -8, elapsed, waveStrength));
    boat.rotation.x = (waveHeight(0, -4, elapsed, waveStrength) - waveHeight(0, 4, elapsed, waveStrength)) / 8;
    boat.rotation.z = (waveHeight(2, 0, elapsed, waveStrength) - waveHeight(-2, 0, elapsed, waveStrength)) / 4;
    radar.rotation.y = elapsed * 1.5;

    // Wave physics for floating / surface-connected objects
    contactMeshes.forEach((group, i) => {
      const c = CONTACTS[i];
      if (floatingIndices.includes(i)) {
        group.position.y = waveHeight(c.x, c.z, elapsed, waveStrength) - c.depth;
        group.rotation.x = (waveHeight(c.x, c.z - .6, elapsed, waveStrength) - waveHeight(c.x, c.z + .6, elapsed, waveStrength)) / 1.2;
        group.rotation.z = (waveHeight(c.x + .6, c.z, elapsed, waveStrength) - waveHeight(c.x - .6, c.z, elapsed, waveStrength)) / 1.2;
      } else if (i === 5) {
        // DRN-06: Autonomous survey AUV survey sweep
        const droneDx = Math.sin(elapsed * .25) * 2.4;
        const droneDz = Math.cos(elapsed * .25) * 1.8;
        group.position.set(c.x + droneDx, -c.depth + Math.sin(elapsed * .5) * .22, c.z + droneDz);
        group.rotation.y = -elapsed * .25 + Math.PI / 2;
        group.rotation.z = Math.sin(elapsed * .25) * .08;
      }
    });

    // Buoy beacon strobe
    if (buoyStrobe && buoyStrobe.material instanceof THREE.MeshBasicMaterial) {
      const strobeOn = Math.floor(elapsed * 2.2) % 2 === 0;
      buoyStrobe.material.color.set(strobeOn ? '#5eead4' : '#042f2e');
    }

    // Fish schooling motion
    if (showSubmerged) for (let k = 0; k < fishCount; k++) {
      const angle = elapsed * .35 + (k / fishCount) * Math.PI * 2;
      const radius = 13 + Math.sin(k * 1.5 + elapsed * .3) * 2.8;
      const fx = Math.cos(angle) * radius;
      const fz = Math.sin(angle) * radius;
      const fy = -7.5 + Math.sin(angle * 2 + k * .8) * 1.5;
      dummy.position.set(fx, fy, fz);
      const nextAngle = angle + .08;
      const nfx = Math.cos(nextAngle) * radius;
      const nfz = Math.sin(nextAngle) * radius;
      dummy.lookAt(nfx, fy + Math.cos(angle * 2 + k * .8) * .12, nfz);
      dummy.scale.set(1, 1, 1 + Math.sin(elapsed * 5 + k) * .15);
      dummy.updateMatrix();
      fishSchool.setMatrixAt(k, dummy.matrix);
    }
    if (showSubmerged) fishSchool.instanceMatrix.needsUpdate = true;

    scan.rotation.z = -elapsed * .35;
    const contactIndex = CONTACTS.findIndex(c => c.id === selected), contact = CONTACTS[contactIndex];
    if (contact && contactMeshes[contactIndex]) {
      const targetMesh = contactMeshes[contactIndex];
      const isSurface = floatingIndices.includes(contactIndex);
      const ringY = mode === 'surface'
        ? waveHeight(contact.x, contact.z, elapsed, waveStrength) + .08
        : isSurface ? targetMesh.position.y + .35 : targetMesh.position.y + (contactIndex === 7 ? 1.4 : .35);
      selectedRing.position.set(targetMesh.position.x, ringY, targetMesh.position.z);
    }

    // Smooth camera lerping when transitioning
    if (isTransitioning) {
      const blend = reducedMotion ? 1 : 1 - Math.exp(-7 * dt);
      camera.position.lerp(targetCamPos, blend);
      controls.target.lerp(targetLookAt, blend);
      if (camera.position.distanceTo(targetCamPos) < .04 && controls.target.distanceTo(targetLookAt) < .04) {
        camera.position.copy(targetCamPos);
        controls.target.copy(targetLookAt);
        isTransitioning = false;
      }
    }

    controls.update();
    constrainView();
    camera.lookAt(controls.target);
    // The camera crosses one continuous ocean; lighting follows its actual height.
    const immersion = 1 - THREE.MathUtils.smoothstep(camera.position.y, -1.2, .6);
    if (mode !== 'sonar' && !(presetTransition && isTransitioning)) {
      const nextMode = camera.position.y < -.15 ? 'underwater' : camera.position.y > .15 ? 'surface' : mode;
      if (nextMode !== mode) { mode = nextMode; onModeChange(mode); }
    }
    const sonar = mode === 'sonar';
    sky.visible = landscape.visible = !sonar && camera.position.y > -.6;
    water.visible = !sonar && camera.position.y > -.6;
    underside.visible = !sonar && camera.position.y < 1;
    scanner.visible = sonar;
    particles.visible = !sonar && immersion > 0;
    particles.material.opacity = .35 * immersion;
    causticStrength.value = sonar ? 0 : .35 * immersion;
    background.copy(sonar ? sonarFog : deepFog);
    scene.background = sky.visible ? null : background;
    fog.color.copy(surfaceFog).lerp(sonar ? sonarFog : deepFog, sonar ? 1 : immersion);
    fog.density = THREE.MathUtils.lerp(.0009, .025, sonar ? 1 : immersion);
    hemi.intensity = THREE.MathUtils.lerp(1.1, .85, immersion);
    sunlight.intensity = THREE.MathUtils.lerp(2, 1.2, immersion);
    if (now - labelTime > 40) {
      contactMeshes.forEach((group, i) => {
        const element = labels.get(CONTACTS[i].id); if (!element) return;
        projected.copy(group.position); projected.y = mode === 'surface' ? 1.2 : group.position.y + 1.2; projected.project(camera);
        const visible = projected.z < 1 && projected.z > -1 && Math.abs(projected.x) < .98 && Math.abs(projected.y) < .9;
        element.style.visibility = visible ? 'visible' : 'hidden';
        element.style.transform = `translate(${(projected.x * .5 + .5) * container.clientWidth}px, ${(-projected.y * .5 + .5) * container.clientHeight}px) translate(-50%, -100%)`;
      }); labelTime = now;
    }
    renderer.render(scene, camera); frames++;
    if (now - fpsTime >= 1000) {
      frameRate = Math.round(frames * 1000 / (now - fpsTime));
      fpsTime = now; frames = 0;
    }
    if (now - telemetryTime >= 100) {
      camera.getWorldDirection(cameraDirection);
      const heading = (THREE.MathUtils.radToDeg(Math.atan2(cameraDirection.x, -cameraDirection.z)) + 360) % 360;
      onFrame(frameRate, Math.round(-camera.position.y * 10) / 10, Math.round(heading));
      telemetryTime = now;
    }
  }
  frameId = requestAnimationFrame(frame);
  function setCamera(view: CameraView) {
    presetTransition = true;
    isTransitioning = true;
    if (view === 'inspect') {
      const position = contactMeshes[CONTACTS.findIndex(c => c.id === selected)].position;
      const targetY = mode === 'surface' ? 0 : position.y;
      targetLookAt.set(position.x, targetY, position.z);
      targetCamPos.set(position.x + 5, mode === 'surface' ? targetY + 3 : Math.min(-1.2, targetY + 3), position.z + 7);
    } else if (view === 'bridge') {
      targetCamPos.set(.1, mode === 'surface' ? 4.4 : -4, -1.5);
      targetLookAt.set(0, mode === 'surface' ? 1.4 : -9, -45);
    } else if (view === 'overhead') {
      targetCamPos.set(0, mode === 'surface' ? 65 : -1, .1);
      targetLookAt.set(0, mode === 'surface' ? 0 : -16, 0);
    } else if (mode === 'surface') {
      targetCamPos.set(26, 12, 33);
      targetLookAt.set(0, 1, -5);
    } else {
      targetCamPos.set(25, -6, 32);
      targetLookAt.set(0, -12, -4);
    }
  }
  return {
    setMode(next) {
      mode = next;
      bedMaterial.wireframe = mode === 'sonar'; bedMaterial.color.set(mode === 'sonar' ? '#51bba0' : '#ffffff');
      setCamera('orbit');
    },
    setCamera,
    setDepth(depth) { descend(((isTransitioning ? targetCamPos.y : camera.position.y) + depth) / .025); },
    select(id) { if (CONTACTS.some(c => c.id === id)) selected = id; },
    setWaves(value) { waveStrength = THREE.MathUtils.clamp(value, .15, 2); },
    setPaused(value) { paused = value; },
    zoom(amount) {
      isTransitioning = false;
      const offset = camera.position.clone().sub(controls.target);
      offset.setLength(THREE.MathUtils.clamp(offset.length() * amount, controls.minDistance, controls.maxDistance));
      camera.position.copy(controls.target).add(offset); controls.update(); constrainView(); camera.lookAt(controls.target);
    },
    dispose() {
      disposed = true; cancelAnimationFrame(frameId); observer.disconnect(); controls.dispose();
      renderer.domElement.removeEventListener('wheel', onWheel);
      controls.removeEventListener('start', onOrbitStart);
      renderer.domElement.removeEventListener('pointerdown', onDown); renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost); renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);
      const materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>(), geometries = new Set<THREE.BufferGeometry>();
      scene.traverse(object => {
        const mesh = object as THREE.Mesh; if (mesh.geometry) geometries.add(mesh.geometry);
        if (mesh.material) (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(m => materials.add(m));
      });
      materials.forEach(material => { Object.values(material).forEach(value => { if (value instanceof THREE.Texture) textures.add(value); }); material.dispose(); });
      textures.forEach(t => t.dispose()); geometries.forEach(g => g.dispose()); environment.dispose();
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); labels.forEach(label => { label.style.visibility = 'hidden'; });
    },
  };
}
