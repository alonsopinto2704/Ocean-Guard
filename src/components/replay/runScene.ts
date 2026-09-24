import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { RunFeed } from './runEventFeed';
import { buildScenarioVisual } from '../monitoring/oceanScene';

/**
 * Data-connected 3D scene for Mission Replay, fed ONLY by the simulation run
 * event log (`runEventFeed.ts`). There are no hardcoded contacts: markers exist
 * only for tracks the server actually reported.
 *
 * Frame (docs/MISSION_SIMULATION.md §4): Local ENU, +x East, +y North, +z Up,
 * metres. Scene mapping: x → East, z → North, y → Up.
 *
 * Symbolism (docs §4): staleness is encoded by symbol + label, never color
 * alone — ACTIVE = solid ring, STALE = dashed ring, LOST = cross. Marker size
 * carries the reported location uncertainty. A missing GPS fix renders as
 * "LOCATION UNKNOWN" on the last known pose — never an invented position.
 */

export interface RunSceneController {
  update(feed: RunFeed): void;
  select(trackId: string | null): void;
  focusOceanFloor(): void;
  setFloorOnly(enabled: boolean): void;
  setFloorPings(enabled: boolean): void;
  setReliefScale(scale: number): void;
  resetCamera(): void;
  /** Dolly the camera toward/away from its target. factor < 1 moves closer. */
  zoomBy(factor: number): void;
  /** Frame a single selected ping so its features can be inspected up close. */
  zoomToTrack(trackId: string): void;
  toggleSeabedOutline(visible: boolean): void;
  dispose(): void;
}

export interface RunSceneOptions {
  onSelectTrack?: (trackId: string | null) => void;
  onError?: (message: string | null) => void;
  labels?: Map<string, HTMLElement>;
}

export interface FloorCell { eastM: number; northM: number; depthM: number; cellSizeM: number }

/** The surveyed floor depth directly beneath a position, or null when the
 *  position was never sampled. A nearest-cell lookup across an unsurveyed gap
 *  would invent a floor under the contact, so it is deliberately not returned:
 *  callers must render the contact with an unknown floor depth instead. */
export function sampledFloorDepth(cells: Iterable<FloorCell>, eastM: number, northM: number): number | null {
  let nearest: FloorCell | null = null;
  let nearestDistance = Infinity;
  for (const cell of cells) {
    const distance = Math.hypot(cell.eastM - eastM, cell.northM - northM);
    if (distance < nearestDistance) { nearestDistance = distance; nearest = cell; }
  }
  if (!nearest) return null;
  // Only a cell the contact actually sits over (or immediately beside) counts.
  return nearestDistance <= nearest.cellSizeM * 0.75 ? nearest.depthM : null;
}

const COLORS = {
  active: '#00f5d4',
  stale: '#ffaa00',
  lost: '#ff5964',
  platform: '#4cd6fb',
  uncertainty: '#2c4a5e',
  grid: '#122435',
  oceanFloor: '#1a3a4a',
  oceanFloorOutline: '#ff8800',
  oceanFloorHighlight: '#ffaa33',
};

interface TrackMarker {
  group: THREE.Group;
  activeSymbol: THREE.Group;
  staleSymbol: THREE.Group;
  lostSymbol: THREE.Group;
  uncertainty: THREE.Mesh;
  dot: THREE.Mesh;
  hit: THREE.Mesh;
  status: 'ACTIVE' | 'STALE' | 'LOST';
  labelKey: string;
  visual?: THREE.Group;
  visualId?: string;
}

function dashedCircle(radius: number, color: string): THREE.Line {
  const points = new THREE.EllipseCurve(0, 0, radius, radius, 0, Math.PI * 2, false, 0).getPoints(48);
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const line = new THREE.Line(geometry, new THREE.LineDashedMaterial({ color, dashSize: radius / 6, gapSize: radius / 10 }));
  line.computeLineDistances();
  line.rotation.x = -Math.PI / 2;
  return line;
}

function solidRing(radius: number, color: string): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.TorusGeometry(radius, radius / 14, 8, 40),
    new THREE.MeshBasicMaterial({ color }),
  );
}

export function createRunScene(container: HTMLElement, options: RunSceneOptions = {}): RunSceneController {
  const labels = options.labels ?? new Map<string, HTMLElement>();
  let disposed = false;
  let contextLost = false;

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#050b14');
  scene.fog = new THREE.FogExp2('#050b14', 0.0008);

  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 4000);
  camera.position.set(70, 85, 130);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.maxPolarAngle = Math.PI * 0.85;
  // Survey targets are a few metres across, so the camera must be allowed close
  // enough to inspect a single ping. A generous upper bound keeps the whole
  // recorded area in view; zoom-to-cursor makes scroll track the pointer.
  controls.minDistance = 1.5;
  controls.maxDistance = 900;
  controls.zoomSpeed = 1.4;
  controls.rotateSpeed = 0.75;
  controls.panSpeed = 1;
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  controls.zoomToCursor = true;
  controls.target.set(0, 0, 0);

  scene.add(new THREE.HemisphereLight('#7dd3fc', '#061c28', 1.4));
  const sun = new THREE.DirectionalLight('#e8f6ff', 1.8);
  sun.position.set(60, 120, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -200;
  sun.shadow.camera.right = 200;
  sun.shadow.camera.top = 200;
  sun.shadow.camera.bottom = -200;
  sun.shadow.camera.far = 500;
  sun.shadow.normalBias = 0.05;
  scene.add(sun);

  // Dedicated underwater bathymetric illumination
  const seabedLight = new THREE.DirectionalLight('#38bdf8', 1.0);
  seabedLight.position.set(-50, 40, -40);
  scene.add(seabedLight);

  const seabedGlow = new THREE.PointLight('#ff8800', 1.5, 320);
  seabedGlow.position.set(0, -8, 0);
  scene.add(seabedGlow);

  // Only received sonar cells are drawn; empty water has no inferred seabed.
  const floorGeometry = new THREE.BufferGeometry();
  const oceanFloor = new THREE.Mesh(floorGeometry, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.9 }));
  const floorEdges = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#f4ad66', transparent: true, opacity: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  scene.add(oceanFloor, floorEdges);
  const floorCenter = new THREE.Vector3(0, -15, 0);
  let floorRadius = 30;
  let reliefScale = 6;
  let lastFloorEventId = -1;
  let lastRunId: string | undefined;

  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(1600, 1600),
    new THREE.MeshPhysicalMaterial({
      color: '#08222e',
      roughness: 0.12,
      metalness: 0.05,
      transmission: 0.92,
      transparent: true,
      opacity: 0.16,
      ior: 1.33,
      thickness: 0.15,
    }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = -0.05;
  water.receiveShadow = true;
  scene.add(water);

  const causticTime = { value: 0 };
  water.material.onBeforeCompile = (shader) => {
    shader.uniforms.causticTime = causticTime;
    // The custom uniform must be DECLARED in the shader source; three.js only
    // generates declarations for a material's built-in uniforms. Without this
    // the fragment shader fails to compile and the water never renders
    // (see the same pattern in components/monitoring/oceanScene.ts).
    shader.fragmentShader = 'uniform float causticTime;\n' + shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
        vec2 p = vWorldPosition.xz * 0.05;
        float a = sin(p.x + sin(p.y + causticTime * 0.27)) + sin(p.y * 0.86 - causticTime * 0.3);
        float b = sin(p.x * 0.79 - causticTime * 0.22 + cos(p.y * 1.23)) + cos(p.y + causticTime * 0.21);
        float light = pow(max(0.0, 1.0 - abs(a * b)), 8.0);
        gl_FragColor.rgb += light * 0.15;`
    );
  };

  const grid = new THREE.GridHelper(200, 40, COLORS.grid, COLORS.grid);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as unknown as { opacity: number }).opacity = 0.4;
  grid.position.y = 0.02;
  scene.add(grid);

  const rangeRings: THREE.Line[] = [];
  for (const radius of [30, 60, 90]) {
    const ring = dashedCircle(radius, radius === 30 ? '#1d4b5e' : COLORS.grid);
    ring.position.y = 0.04;
    scene.add(ring);
    rangeRings.push(ring);
  }

  const platform = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.CircleGeometry(2.6, 32), new THREE.MeshBasicMaterial({ color: COLORS.platform, transparent: true, opacity: 0.9 }));
  hull.rotation.x = -Math.PI / 2;
  hull.position.y = 0.06;
  platform.add(hull);
  const needle = new THREE.Mesh(new THREE.ConeGeometry(0.9, 5.4, 12), new THREE.MeshBasicMaterial({ color: COLORS.platform }));
  needle.rotation.x = Math.PI / 2;
  needle.position.set(0, 0.4, 3.4);
  platform.add(needle);
  const fovCone = new THREE.Mesh(
    new THREE.CircleGeometry(30, 24, Math.PI / 2 - Math.PI / 12, Math.PI / 6),
    new THREE.MeshBasicMaterial({ color: COLORS.platform, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }),
  );
  fovCone.rotation.x = -Math.PI / 2;
  fovCone.position.y = 0.04;
  platform.add(fovCone);
  const unknownBadge = new THREE.Mesh(new THREE.RingGeometry(3.2, 3.8, 40), new THREE.MeshBasicMaterial({ color: '#83948f', side: THREE.DoubleSide }));
  unknownBadge.rotation.x = -Math.PI / 2;
  unknownBadge.position.y = 0.08;
  unknownBadge.visible = false;
  platform.add(unknownBadge);
  scene.add(platform);

  const TRAIL_POINTS = 900;
  const trailPositions = new Float32Array(TRAIL_POINTS * 3);
  const trailGeometry = new THREE.BufferGeometry();
  trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
  trailGeometry.setDrawRange(0, 0);
  const trail = new THREE.Line(trailGeometry, new THREE.LineBasicMaterial({ color: COLORS.platform, transparent: true, opacity: 0.5 }));
  trail.frustumCulled = false;
  scene.add(trail);
  let trailCount = 0;

  const trackMarkers = new Map<string, TrackMarker>();

  const selectionRing = new THREE.Mesh(new THREE.RingGeometry(4.4, 4.9, 48), new THREE.MeshBasicMaterial({ color: COLORS.stale, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }));
  selectionRing.rotation.x = -Math.PI / 2;
  selectionRing.position.y = 0.12;
  selectionRing.visible = false;
  scene.add(selectionRing);
  let selectedTrackId: string | null = null;
  let floorOnly = false;
  let floorPings = true;
  let hasPlatform = false;
  let latestFeed: RunFeed | null = null;

  function floorPingY(eastM: number, northM: number): number {
    const cells = [...(latestFeed?.bathymetry.values() ?? [])];
    if (!cells.length) return -14;
    const min = Math.min(...cells.map(cell => cell.depthM));
    const depth = sampledFloorDepth(cells, eastM, northM);
    // No local sonar cell: float the ping above the surveyed terrain at the
    // shallowest recorded depth rather than anchoring it to a guessed floor.
    if (depth === null) return -min + 2;
    return -(min + (depth - min) * reliefScale) + 1;
  }

  function syncPingMarkers() {
    for (const [id, marker] of trackMarkers) {
      const track = latestFeed?.tracks.get(id);
      if (track) marker.group.position.y = floorOnly ? floorPingY(track.eastM, track.northM) : 0.5;
      // The Waste-pings toggle hides contact markers in both view modes, so the
      // label overlay and the 3D markers never disagree about what is shown.
      marker.group.visible = floorPings;
      if (marker.visual && track) {
        // In floor-only mode the sampled surface may use exaggerated relief.
        // Put the authored model above its ping, never at a guessed seabed depth.
        marker.visual.visible = true;
        marker.visual.position.y = floorOnly ? 1.5 : -(track.scenarioDepthM ?? 0) - marker.group.position.y;
        const floorScale = ({ 'NET-01': 1.5, 'PET-02': 2.5, 'DRM-03': 3, 'TYR-04': 3,
          'BUO-05': 1.8, 'BAG-07': 2.5, 'WRE-08': 1.2 } as Record<string, number>)[track.scenarioObjectId ?? ''] ?? 2;
        marker.visual.scale.setScalar(floorOnly ? floorScale : 1);
      }
      marker.dot.visible = !(floorOnly && marker.visual);
      const ringScale = floorOnly && marker.visual ? 0.5 : 1;
      marker.activeSymbol.scale.setScalar(ringScale);
      marker.staleSymbol.scale.setScalar(ringScale);
      marker.lostSymbol.scale.setScalar(ringScale);
    }
    const selected = selectedTrackId ? trackMarkers.get(selectedTrackId) : null;
    selectionRing.visible = Boolean(selected) && floorPings;
    if (selected) selectionRing.position.set(selected.group.position.x, selected.group.position.y - 0.3, selected.group.position.z);
  }

  function buildTrackMarker(trackId: string): TrackMarker {
    const group = new THREE.Group();

    const activeSymbol = new THREE.Group();
    activeSymbol.add(solidRing(3, COLORS.active));
    const dot = new THREE.Mesh(new THREE.CircleGeometry(1.1, 20), new THREE.MeshBasicMaterial({ color: COLORS.active }));
    dot.rotation.x = -Math.PI / 2;
    dot.position.y = 0.05;
    activeSymbol.add(dot);
    group.add(activeSymbol);

    const staleSymbol = new THREE.Group();
    staleSymbol.add(dashedCircle(3, COLORS.stale));
    group.add(staleSymbol);

    const lostSymbol = new THREE.Group();
    const crossMaterial = new THREE.LineBasicMaterial({ color: COLORS.lost });
    for (const [a, b] of [[[-2.4, -2.4], [2.4, 2.4]], [[-2.4, 2.4], [2.4, -2.4]]] as const) {
      const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(a[0], 0.1, a[1]), new THREE.Vector3(b[0], 0.1, b[1])]);
      lostSymbol.add(new THREE.Line(geometry, crossMaterial));
    }
    group.add(lostSymbol);

    const uncertainty = new THREE.Mesh(
      new THREE.CircleGeometry(1, 40),
      new THREE.MeshBasicMaterial({ color: COLORS.uncertainty, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }),
    );
    uncertainty.rotation.x = -Math.PI / 2;
    uncertainty.position.y = 0.03;
    group.add(uncertainty);

    const hit = new THREE.Mesh(
      new THREE.CircleGeometry(5, 16),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    hit.rotation.x = -Math.PI / 2;
    hit.position.y = 0.2;
    hit.userData.trackId = trackId;
    group.add(hit);

    group.position.set(0, 0.5, 0);
    scene.add(group);
    return { group, activeSymbol, staleSymbol, lostSymbol, uncertainty, dot, hit, status: 'ACTIVE', labelKey: trackId };
  }

  function syncStatus(marker: TrackMarker, status: TrackMarker['status']) {
    marker.status = status;
    marker.activeSymbol.visible = status === 'ACTIVE';
    marker.staleSymbol.visible = status === 'STALE';
    marker.lostSymbol.visible = status === 'LOST';
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let downAt: [number, number] = [0, 0];
  const onDown = (event: PointerEvent) => { downAt = [event.clientX, event.clientY]; };
  const onUp = (event: PointerEvent) => {
    if (Math.hypot(event.clientX - downAt[0], event.clientY - downAt[1]) > 5) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects([...trackMarkers.values()].flatMap(marker => marker.visual?.visible ? [marker.hit, marker.visual] : [marker.hit]), true);
    const trackId = (hits[0]?.object.userData.trackId as string | undefined) ?? null;
    setSelected(trackId);
    options.onSelectTrack?.(trackId);
  };
  function setSelected(trackId: string | null) {
    selectedTrackId = trackId;
    const marker = trackId ? trackMarkers.get(trackId) : null;
    selectionRing.visible = Boolean(marker) && floorPings;
    if (marker) selectionRing.position.set(marker.group.position.x, marker.group.position.y - 0.3, marker.group.position.z);
  }
  renderer.domElement.addEventListener('pointerdown', onDown);
  renderer.domElement.addEventListener('pointerup', onUp);

  const onContextLost = (event: Event) => {
    event.preventDefault();
    if (disposed || contextLost) return;
    contextLost = true;
    cancelAnimationFrame(frameId);
    options.onError?.('The 3D graphics context was interrupted. Retry the scene if the browser restores it.');
  };
  const onContextRestored = () => {
    if (disposed || !contextLost) return;
    contextLost = false;
    previous = performance.now();
    options.onError?.(null);
    frameId = requestAnimationFrame(frame);
  };
  renderer.domElement.addEventListener('webglcontextlost', onContextLost);
  renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);

  const resize = () => {
    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  let frameId = 0;
  let previous = performance.now();
  const projected = new THREE.Vector3();
  function frame(now: number) {
    frameId = requestAnimationFrame(frame);
    const dt = Math.min((now - previous) / 1000, 0.05);
    previous = now;
    if (document.hidden) return;

    causticTime.value = now * 0.001;

    controls.autoRotate = false;
    controls.autoRotateSpeed = 0.35;
    controls.update();

    // Label layout: the selected ping always wins, then labels are placed
    // greedily and any that would overlap an already-placed one are collapsed.
    // At narrow widths only the selected ping keeps its text so terrain stays
    // readable; the ping dots and the count still convey the rest.
    const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
    const narrow = container.clientWidth < 420;
    const orderedLabels = [...labels.entries()].sort((a, b) =>
      (a[0] === selectedTrackId ? 0 : 1) - (b[0] === selectedTrackId ? 0 : 1));
    for (const [trackId, element] of orderedLabels) {
      const marker = trackMarkers.get(trackId);
      const anchor = marker ? marker.group.position : platform.position;
      projected.copy(anchor);
      projected.y += floorOnly && marker?.visual ? 5.5 : 3.4;
      projected.project(camera);
      const onScreen = Boolean(marker?.group.visible) && projected.z < 1 && projected.z > -1 && Math.abs(projected.x) < 0.98 && Math.abs(projected.y) < 0.95;
      const x = (projected.x * 0.5 + 0.5) * container.clientWidth;
      const y = (-projected.y * 0.5 + 0.5) * container.clientHeight;
      const width = element.offsetWidth || 80;
      const height = element.offsetHeight || 18;
      const box = { x: x - width / 2, y: y - height, w: width, h: height };
      const overlaps = placed.some(other =>
        box.x < other.x + other.w && box.x + box.w > other.x
        && box.y < other.y + other.h && box.y + box.h > other.y);
      const isSelected = trackId === selectedTrackId;
      const show = onScreen && (isSelected || (!narrow && !overlaps));
      if (show) placed.push(box);
      element.style.visibility = show ? 'visible' : 'hidden';
      element.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    }
    void dt;
    renderer.render(scene, camera);
  }
  frameId = requestAnimationFrame(frame);

  return {
    update(feed: RunFeed) {
      latestFeed = feed;
      hasPlatform = Boolean(feed.platform);
      platform.visible = !floorOnly && hasPlatform;
      if (feed.platform) {
        platform.position.set(feed.platform.eastM, 0, feed.platform.northM);
        platform.rotation.y = THREE.MathUtils.degToRad(feed.platform.headingDeg);
      }
      const fixes = feed.events.filter(event => event.type === 'TELEMETRY' && event.platform && !event.locationUnknown).slice(-TRAIL_POINTS);
      trailCount = fixes.length;
      fixes.forEach((event, index) => {
        trailPositions[index * 3] = event.platform!.eastM;
        trailPositions[index * 3 + 1] = 0.15;
        trailPositions[index * 3 + 2] = event.platform!.northM;
      });
      trailGeometry.setDrawRange(0, trailCount);
      (trailGeometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      // Newest received bathymetry event (manual reverse scan: Array.findLast
      // needs ES2023 lib, and this runs on every feed update).
      let floorEventId = 0;
      for (let index = feed.events.length - 1; index >= 0; index--) {
        if (feed.events[index].type === 'BATHYMETRY') { floorEventId = feed.events[index].id; break; }
      }
      if (floorEventId !== lastFloorEventId || feed.run?.id !== lastRunId) {
        lastFloorEventId = floorEventId;
        lastRunId = feed.run?.id;
        const vertices: number[] = [], colors: number[] = [], indices: number[] = [];
        const cells = [...feed.bathymetry.values()];
        const lookup = new Map(cells.map(cell => [
          `${cell.cellSizeM}:${Math.round(cell.eastM / cell.cellSizeM)}:${Math.round(cell.northM / cell.cellSizeM)}`,
          cell.depthM,
        ]));
        const minDepth = Math.min(...cells.map(cell => cell.depthM));
        const maxDepth = Math.max(...cells.map(cell => cell.depthM));
        const shallow = new THREE.Color('#e3b678');
        const middle = new THREE.Color('#4cc4b9');
        const deep = new THREE.Color('#174473');
        const color = new THREE.Color();
        const corners = new Map<string, number>();
        const vertex = (east: number, north: number, size: number): number => {
          const key = `${size}:${east}:${north}`;
          const existing = corners.get(key);
          if (existing !== undefined) return existing;
          const adjacent: number[] = [];
          for (const dx of [-0.5, 0.5]) for (const dz of [-0.5, 0.5]) {
            const sample = lookup.get(`${size}:${Math.round((east + dx * size) / size)}:${Math.round((north + dz * size) / size)}`);
            if (sample !== undefined) adjacent.push(sample);
          }
          const depth = adjacent.reduce((sum, value) => sum + value, 0) / adjacent.length;
          const index = vertices.length / 3;
          vertices.push(east, -(minDepth + (depth - minDepth) * reliefScale), north);
          const depthFraction = (depth - minDepth) / Math.max(0.01, maxDepth - minDepth);
          if (depthFraction < 0.5) color.copy(shallow).lerp(middle, depthFraction * 2);
          else color.copy(middle).lerp(deep, (depthFraction - 0.5) * 2);
          colors.push(color.r, color.g, color.b);
          corners.set(key, index);
          return index;
        };
        for (const cell of cells) {
          const h = cell.cellSizeM / 2;
          const a = vertex(cell.eastM - h, cell.northM - h, cell.cellSizeM);
          const b = vertex(cell.eastM - h, cell.northM + h, cell.cellSizeM);
          const c = vertex(cell.eastM + h, cell.northM + h, cell.cellSizeM);
          const d = vertex(cell.eastM + h, cell.northM - h, cell.cellSizeM);
          indices.push(a, b, c, a, c, d);
        }
        // Build a fresh geometry and dispose the previous one. Mutating the
        // existing geometry with setAttribute() would orphan the previous
        // position/color GPU buffers on every sonar update (a slow leak over a
        // long survey); disposing frees them immediately.
        const built = new THREE.BufferGeometry();
        built.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        built.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        built.setIndex(indices);
        built.computeVertexNormals();
        built.computeBoundingSphere();
        const previousFloor = oceanFloor.geometry;
        const previousEdges = floorEdges.geometry;
        oceanFloor.geometry = built;
        floorEdges.geometry = new THREE.EdgesGeometry(built);
        previousFloor.dispose();
        previousEdges.dispose();
        if (vertices.length) {
          built.computeBoundingBox();
          built.boundingBox!.getCenter(floorCenter);
          floorRadius = Math.max(25, built.boundingSphere!.radius);
        }
      }
      unknownBadge.visible = feed.platformLocationUnknown;

      const seen = new Set<string>();
      for (const [trackId, track] of feed.tracks) {
        seen.add(trackId);
        let marker = trackMarkers.get(trackId);
        if (!marker) {
          marker = buildTrackMarker(trackId);
          trackMarkers.set(trackId, marker);
        }
        if (marker.visual && marker.visualId !== track.scenarioObjectId) {
          marker.group.remove(marker.visual);
          marker.visual.traverse(object => {
            const mesh = object as THREE.Mesh;
            mesh.geometry?.dispose();
            if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
              Object.values(material).forEach(value => { if (value instanceof THREE.Texture) value.dispose(); });
              material.dispose();
            }
          });
          marker.visual = undefined;
          marker.visualId = undefined;
        }
        if (!marker.visual && track.scenarioObjectId && track.scenarioDepthM !== undefined) {
          const visual = buildScenarioVisual(track.scenarioObjectId);
          if (visual) {
            marker.visual = visual;
            marker.visualId = track.scenarioObjectId;
            marker.visual.position.set(0, 0, 0);
            marker.visual.traverse(object => { object.userData.trackId = trackId; });
            marker.group.add(marker.visual);
          }
        }
        marker.group.position.set(track.eastM, 0.5, track.northM);
        marker.uncertainty.scale.setScalar(Math.max(track.uncertaintyM, 1));
        syncStatus(marker, track.status);
      }
      for (const [trackId, marker] of trackMarkers) {
        if (!seen.has(trackId)) {
          scene.remove(marker.group);
          marker.group.traverse(object => {
            const mesh = object as THREE.Mesh;
            mesh.geometry?.dispose();
            if (mesh.material) (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(material => {
              Object.values(material).forEach(value => { if (value instanceof THREE.Texture) value.dispose(); });
              material.dispose();
            });
          });
          trackMarkers.delete(trackId);
        }
      }

      syncPingMarkers();
    },
    setFloorOnly(enabled: boolean) {
      floorOnly = enabled;
      water.visible = !enabled;
      grid.visible = !enabled;
      rangeRings.forEach(ring => { ring.visible = !enabled; });
      platform.visible = !enabled && hasPlatform;
      trail.visible = !enabled;
      syncPingMarkers();
    },
    setFloorPings(enabled: boolean) {
      floorPings = enabled;
      syncPingMarkers();
    },
    setReliefScale(scale: number) {
      if (reliefScale === scale) return;
      reliefScale = scale;
      lastFloorEventId = -1;
    },
    select(trackId: string | null) {
      setSelected(trackId);
    },
    focusOceanFloor() {
      controls.target.copy(floorCenter);
      camera.position.copy(floorCenter).add(new THREE.Vector3(floorRadius * 0.85, floorRadius * 0.6, floorRadius * 1.1));
      controls.update();
    },
    resetCamera() {
      controls.target.set(0, 0, 0);
      camera.position.set(70, 85, 130);
      controls.update();
    },
    zoomBy(factor: number) {
      const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
      const distance = THREE.MathUtils.clamp(offset.length() * factor, controls.minDistance, controls.maxDistance);
      camera.position.copy(controls.target).add(offset.setLength(distance));
      controls.update();
    },
    zoomToTrack(trackId: string) {
      const marker = trackMarkers.get(trackId);
      if (!marker) return;
      const target = marker.visual?.visible ? marker.visual.getWorldPosition(new THREE.Vector3()) : marker.group.position.clone();
      controls.target.copy(target);
      // Close enough that a ~6 m object fills a useful part of the frame,
      // offset slightly high so the ping and its seabed context are both visible.
      camera.position.copy(target).add(new THREE.Vector3(11, 13, 17));
      controls.update();
    },
    toggleSeabedOutline(visible: boolean) {
      floorEdges.visible = visible;
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frameId);
      observer.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);
      const materials = new Set<THREE.Material>();
      const geometries = new Set<THREE.BufferGeometry>();
      const textures = new Set<THREE.Texture>();
      scene.traverse(object => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) geometries.add(mesh.geometry);
        if (mesh.material) (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(material => materials.add(material));
      });
      materials.forEach(material => {
        Object.values(material).forEach(value => { if (value instanceof THREE.Texture) textures.add(value); });
        material.dispose();
      });
      textures.forEach(texture => texture.dispose());
      geometries.forEach(geometry => geometry.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      labels.forEach(label => { label.style.visibility = 'hidden'; });
    },
  };
}
