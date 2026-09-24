import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import * as THREE from 'three';
import {
  Satellite, Waves, Cpu, Navigation, ArrowUpRight,
  Shield, Layers, Compass, Plus, Minus, X
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Badge, DataProvenanceBadge } from '../components/ui/Badge';
import { SkipLink } from '../components/ui/SkipLink';
import { accessRequestsApi } from '../lib/api';

// ── Sample Indian coastal hotspot data ──────────────────────────────────────
// These records mirror the fallback dataset in Hotspots.tsx and the seed data
// in storage.ts. All values are SAMPLE / SIMULATED — not measured observations.
// Risk thresholds match utils.ts: CRITICAL ≥80, HIGH 60–79, MEDIUM 30–59, LOW <30
const DEBRIS_LOCATIONS = [
  { id: 'HS-01', lat: 22.45, lng: 69.15, risk: 'CRITICAL' as const, riskScore: 92, massKg: 1840, surveyRadiusKm: 38, confidencePct: 96.4, label: 'Gulf of Kachchh',    count: 312, dominantClass: 'Fishing Net',    zone: 'Z-GUJ' },
  { id: 'HS-02', lat: 18.95, lng: 72.80, risk: 'HIGH'     as const, riskScore: 78, massKg: 982,  surveyRadiusKm: 30, confidencePct: 93.8, label: 'Mumbai Coast',        count: 204, dominantClass: 'Mixed Waste',     zone: 'Z-MUM' },
  { id: 'HS-03', lat: 16.70, lng: 73.25, risk: 'HIGH'     as const, riskScore: 72, massKg: 760,  surveyRadiusKm: 26, confidencePct: 91.2, label: 'Konkan Coast',        count: 176, dominantClass: 'Plastic Bottle',  zone: 'Z-KON' },
  { id: 'HS-04', lat: 15.35, lng: 73.75, risk: 'MEDIUM'   as const, riskScore: 46, massKg: 410,  surveyRadiusKm: 20, confidencePct: 89.5, label: 'Goa Coast',           count: 98,  dominantClass: 'Plastic Bag',     zone: 'Z-GOA' },
  { id: 'HS-05', lat: 12.85, lng: 74.80, risk: 'HIGH'     as const, riskScore: 68, massKg: 510,  surveyRadiusKm: 22, confidencePct: 92.1, label: 'Mangaluru Coast',     count: 120, dominantClass: 'Rope',            zone: 'Z-MNG' },
  { id: 'HS-06', lat:  8.80, lng: 78.75, risk: 'HIGH'     as const, riskScore: 75, massKg: 860,  surveyRadiusKm: 28, confidencePct: 94.7, label: 'Gulf of Mannar',      count: 188, dominantClass: 'Fishing Net',     zone: 'Z-MAN' },
  { id: 'HS-07', lat: 13.08, lng: 80.35, risk: 'MEDIUM'   as const, riskScore: 42, massKg: 290,  surveyRadiusKm: 18, confidencePct: 88.3, label: 'Chennai Coast',       count: 74,  dominantClass: 'Plastic Bottle',  zone: 'Z-CHE' },
  { id: 'HS-08', lat: 19.95, lng: 86.40, risk: 'CRITICAL' as const, riskScore: 86, massKg: 740,  surveyRadiusKm: 32, confidencePct: 95.2, label: 'Odisha Coast',        count: 162, dominantClass: 'Mixed Waste',     zone: 'Z-ODI' },
  { id: 'HS-09', lat: 21.80, lng: 88.90, risk: 'MEDIUM'   as const, riskScore: 54, massKg: 624,  surveyRadiusKm: 24, confidencePct: 90.6, label: 'Sundarbans',          count: 148, dominantClass: 'Plastic Bag',     zone: 'Z-SUN' },
  { id: 'HS-10', lat: 10.55, lng: 72.60, risk: 'LOW'      as const, riskScore: 22, massKg: 134,  surveyRadiusKm: 16, confidencePct: 86.4, label: 'Lakshadweep Region',  count: 42,  dominantClass: 'Plastic Bottle',  zone: 'Z-LAK' },
] as const;

// ── Coordinate conversion ───────────────────────────────────────────────────
// Standard spherical-to-cartesian for Three.js SphereGeometry (Y-up, Z toward viewer).
// phi: polar angle from north pole; theta: azimuthal angle from 180°W (dateline).
// Verified correct: India at ~22°N 78°E lands in the expected screen quadrant
// when globeRig.rotation.y ≈ 2.1 rad (faces ~78°E longitude toward camera).
function latLngToXYZ(lat: number, lng: number, r: number) {
  const phi   = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  return {
    x:  r * Math.sin(phi) * Math.cos(theta),
    y:  r * Math.cos(phi),
    z: -r * Math.sin(phi) * Math.sin(theta),
  };
}

// ── Risk color helpers (consistent with utils.ts thresholds) ────────────────
function riskHex(risk: string): number {
  switch (risk) {
    case 'CRITICAL': return 0xff4455;
    case 'HIGH':     return 0xffaa00;
    case 'MEDIUM':   return 0xeab308;
    case 'LOW':      return 0x10b981;
    default:         return 0x10b981;
  }
}

// ── India initial rotation ───────────────────────────────────────────────────
// rx = 0.35, ry = 0.21 centers India (~20°N, 78°E) directly facing the camera (+Z)
// with all coastal markers prominently displayed.
const INDIA_ROT_X = 0.35;
const INDIA_ROT_Y = 0.21;

// ── Simplified India-region coastline data ──────────────────────────────────
// A curated set of line segments approximating the Indian subcontinent,
// Sri Lanka, and major Indian Ocean island groups. Each pair of points forms
// one line segment [lat1, lng1, lat2, lng2]. Derived from simplified Natural
// Earth / open geographic reference data (public domain).
// Attribution: Simplified from Natural Earth 1:110m coastline data (public domain,
// https://www.naturalearthdata.com/). No commercial restrictions.
const COASTLINE_SEGMENTS: [number, number, number, number][] = [
  // Indian west coast (Gujarat → Kerala)
  [23.5, 68.5, 22.8, 69.2],
  [22.8, 69.2, 22.0, 69.7],
  [22.0, 69.7, 21.1, 70.2],
  [21.1, 70.2, 20.9, 70.8],
  [20.9, 70.8, 20.7, 71.5],
  [20.7, 71.5, 20.5, 72.2],
  [20.5, 72.2, 19.9, 72.7],
  [19.9, 72.7, 19.2, 72.9],
  [19.2, 72.9, 18.5, 73.0],
  [18.5, 73.0, 17.8, 73.2],
  [17.8, 73.2, 17.0, 73.4],
  [17.0, 73.4, 16.3, 73.5],
  [16.3, 73.5, 15.5, 73.8],
  [15.5, 73.8, 14.9, 74.1],
  [14.9, 74.1, 14.3, 74.5],
  [14.3, 74.5, 13.5, 74.7],
  [13.5, 74.7, 12.9, 74.9],
  [12.9, 74.9, 12.2, 75.3],
  [12.2, 75.3, 11.5, 75.8],
  [11.5, 75.8, 11.0, 76.1],
  [11.0, 76.1, 10.5, 76.5],
  [10.5, 76.5, 9.7,  76.8],
  [9.7,  76.8, 9.0,  77.2],
  [9.0,  77.2, 8.4,  77.5],
  [8.4,  77.5, 8.1,  77.6],
  // India southern tip and east coast (Kerala → Bangladesh)
  [8.1,  77.6, 8.0,  78.1],
  [8.0,  78.1, 8.3,  78.7],
  [8.3,  78.7, 8.8,  79.0],
  [8.8,  79.0, 9.5,  79.4],
  [9.5,  79.4, 10.2, 79.8],
  [10.2, 79.8, 10.8, 79.9],
  [10.8, 79.9, 11.4, 79.8],
  [11.4, 79.8, 11.9, 79.9],
  [11.9, 79.9, 12.5, 80.1],
  [12.5, 80.1, 13.0, 80.3],
  [13.0, 80.3, 13.7, 80.3],
  [13.7, 80.3, 14.3, 80.1],
  [14.3, 80.1, 14.9, 80.2],
  [14.9, 80.2, 15.5, 80.2],
  [15.5, 80.2, 16.0, 80.5],
  [16.0, 80.5, 16.5, 81.1],
  [16.5, 81.1, 17.0, 81.7],
  [17.0, 81.7, 17.5, 82.2],
  [17.5, 82.2, 18.0, 83.0],
  [18.0, 83.0, 18.5, 83.5],
  [18.5, 83.5, 19.0, 84.2],
  [19.0, 84.2, 19.5, 85.1],
  [19.5, 85.1, 20.0, 86.2],
  [20.0, 86.2, 20.5, 86.9],
  [20.5, 86.9, 21.0, 87.4],
  [21.0, 87.4, 21.5, 87.8],
  [21.5, 87.8, 22.0, 88.2],
  [22.0, 88.2, 22.5, 88.7],
  [22.5, 88.7, 22.8, 89.2],
  [22.8, 89.2, 23.2, 89.8],
  // Northern coast closure (Gujarat toward Pakistan border)
  [23.5, 68.5, 24.0, 67.5],
  [24.0, 67.5, 24.5, 67.0],
  // Sri Lanka rough outline
  [9.8,  80.1, 9.5,  80.5],
  [9.5,  80.5, 9.0,  81.2],
  [9.0,  81.2, 8.4,  81.2],
  [8.4,  81.2, 8.0,  81.0],
  [8.0,  81.0, 7.5,  80.7],
  [7.5,  80.7, 7.0,  80.1],
  [7.0,  80.1, 6.5,  79.9],
  [6.5,  79.9, 6.0,  80.3],
  [6.0,  80.3, 5.9,  80.7],
  [5.9,  80.7, 6.2,  81.2],
  [6.2,  81.2, 7.0,  81.8],
  [7.0,  81.8, 8.0,  81.8],
  [8.0,  81.8, 8.9,  81.5],
  [8.9,  81.5, 9.5,  81.3],
  [9.5,  81.3, 9.8,  80.1],
  // Maldives (schematic center line)
  [4.2,  73.5, 3.5,  73.0],
  [3.5,  73.0, 2.5,  72.8],
  // Lakshadweep (schematic)
  [10.6, 72.7, 11.2, 72.2],
  [11.2, 72.2, 11.7, 72.0],
  // Andaman rough
  [13.2, 93.0, 12.4, 92.8],
  [12.4, 92.8, 11.7, 92.6],
  [11.7, 92.6, 10.5, 92.4],
  [10.5, 92.4,  9.5, 92.5],
];

// ── Globe Canvas Component ─────────────────────────────────────────────────
interface GlobeProps {
  onMarkerSelect: (id: string | null) => void;
  selectedId: string | null;
}

function createMarkerLabelSprite(text: string, colorHex: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 240;
  canvas.height = 56;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const hexStr = '#' + colorHex.toString(16).padStart(6, '0');

  // Semi-transparent pill container
  ctx.fillStyle = 'rgba(6, 14, 24, 0.92)';
  ctx.strokeStyle = hexStr;
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(4, 6, 232, 44, 8);
  } else {
    ctx.rect(4, 6, 232, 44);
  }
  ctx.fill();
  ctx.stroke();

  // Status color dot
  ctx.fillStyle = hexStr;
  ctx.beginPath();
  ctx.arc(22, 28, 4.5, 0, Math.PI * 2);
  ctx.fill();

  // Crisp label text
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 18px Inter, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 36, 28);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.scale.set(0.18, 0.042, 1);
  return sprite;
}

function GlobeCanvas({ onMarkerSelect, selectedId }: GlobeProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    const W = el.clientWidth || 600;
    const H = el.clientHeight || 500;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, W < 768 ? 1 : 1.5));
    renderer.domElement.style.touchAction = 'none';
    renderer.domElement.style.cursor = 'grab';
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.setAttribute(
      'aria-label',
      'Interactive Indian Ocean marine debris monitoring globe showing 10 sample monitoring zones along the Indian coast. Drag to rotate. Pinch, scroll, or use plus and minus to zoom.'
    );
    el.appendChild(renderer.domElement);

    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 1000);
    camera.position.z = 2.8;
    let targetZoom = 2.8;

    // Globe rig: all geographic layers (surface, coastline, markers) live inside
    // this group so they rotate together and markers stay geographically anchored.
    const globeRig = new THREE.Group();
    // Initial rotation perfectly centering India (~20°N, 78°E) facing viewer:
    globeRig.rotation.set(INDIA_ROT_X, INDIA_ROT_Y, 0);
    scene.add(globeRig);

    // ── Ocean sphere (matte deep ocean without distracting specular reflection balls)
    const geo = new THREE.SphereGeometry(1, 64, 64);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x051020,
      roughness: 0.9,
      metalness: 0.1,
    });
    const globe = new THREE.Mesh(geo, mat);
    globeRig.add(globe);

    // ── Wireframe overlay ─────────────────────────────────────────────────
    const wireMat = new THREE.MeshBasicMaterial({
      color: 0x00f5d4, wireframe: true, transparent: true, opacity: 0.06,
    });
    globeRig.add(new THREE.Mesh(new THREE.SphereGeometry(1.002, 36, 36), wireMat));

    // ── Atmosphere halo ───────────────────────────────────────────────────
    const atmMat = new THREE.MeshBasicMaterial({
      color: 0x00f5d4, transparent: true, opacity: 0.08, side: THREE.BackSide,
    });
    globeRig.add(new THREE.Mesh(new THREE.SphereGeometry(1.08, 36, 36), atmMat));

    // ── Simplified coastline layer (crisp glowing cyan Indian coast) ──────
    const coastPositions: number[] = [];
    COASTLINE_SEGMENTS.forEach(([lat1, lng1, lat2, lng2]) => {
      const p1 = latLngToXYZ(lat1, lng1, 1.003);
      const p2 = latLngToXYZ(lat2, lng2, 1.003);
      coastPositions.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    });
    const coastGeo = new THREE.BufferGeometry();
    coastGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(coastPositions), 3));
    const coastMat = new THREE.LineBasicMaterial({ color: 0x00f5d4, transparent: true, opacity: 0.85 });
    globeRig.add(new THREE.LineSegments(coastGeo, coastMat));

    // ── Lighting (soft balanced illumination without specular hotspot glare)
    scene.add(new THREE.AmbientLight(0x0e2030, 2.8));
    const dLight = new THREE.DirectionalLight(0x4cd6fb, 1.0);
    dLight.position.set(3, 4, 3);
    scene.add(dLight);
    const fillLight = new THREE.DirectionalLight(0x00f5d4, 0.6);
    fillLight.position.set(-3, -2, 2);
    scene.add(fillLight);

    // ── Debris markers with pulsing beacon rings & attached text tags ─────
    type MarkerVisual = {
      mesh: THREE.Mesh;
      ring: THREE.Mesh;
      ringMaterial: THREE.MeshBasicMaterial;
      sprite: THREE.Sprite | null;
      phase: number;
      id: string;
      worldPos: THREE.Vector3;
    };
    const markerVisuals: MarkerVisual[] = [];

    DEBRIS_LOCATIONS.forEach((d, index) => {
      const pos = latLngToXYZ(d.lat, d.lng, 1.02);
      const color = riskHex(d.risk);
      // Prominent marker size (clearly visible on globe)
      const markerSize = 0.026 + Math.min(d.count / 350, 1) * 0.016;

      const mGeo = new THREE.SphereGeometry(markerSize, 16, 16);
      const mMat = new THREE.MeshBasicMaterial({ color });
      const mesh = new THREE.Mesh(mGeo, mMat);
      mesh.position.set(pos.x, pos.y, pos.z);
      mesh.userData.debrisId = d.id;
      globeRig.add(mesh);

      // Pulse ring — aligned to local surface
      const rGeo = new THREE.RingGeometry(0.035, 0.055, 24);
      const rMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(rGeo, rMat);
      ring.position.set(pos.x, pos.y, pos.z);
      ring.lookAt(0, 0, 0);
      globeRig.add(ring);

      // Attached label tag with outward sea offset
      const isWestCoast = d.lng < 76 && d.lat > 11;
      const isEastCoast = d.lng >= 76;
      const isSouth = d.lat <= 11;

      let offsetX = 0;
      let offsetY = 0.02;
      if (isWestCoast) {
        offsetX = -0.06;
      } else if (isEastCoast) {
        offsetX = 0.06;
      } else if (isSouth) {
        offsetY = -0.04;
      }

      const sprite = createMarkerLabelSprite(d.label, color);
      if (sprite) {
        sprite.position.set(pos.x * 1.08 + offsetX, pos.y * 1.08 + offsetY, pos.z * 1.08);
        globeRig.add(sprite);
      }

      // Pre-compute position for occlusion testing
      const worldPos = new THREE.Vector3(pos.x, pos.y, pos.z);
      markerVisuals.push({ mesh, ring, ringMaterial: rMat, sprite, phase: index * 0.85, id: d.id, worldPos });
    });

    // ── Focus / Center on Geographic Location ─────────────────────────────
    const focusOnLocation = (lat: number, lng: number) => {
      const phi = (90 - lat) * (Math.PI / 180);
      const theta = (lng + 180) * (Math.PI / 180);
      const px = Math.sin(phi) * Math.cos(theta);
      const py = Math.cos(phi);
      const pz = -Math.sin(phi) * Math.sin(theta);

      targetRotX = Math.atan2(py, pz);
      const zPrime = Math.hypot(py, pz);
      const baseRy = Math.atan2(-px, zPrime);

      // Shortest angular path from current globe rotation.y
      const diff = (baseRy - globeRig.rotation.y) % (Math.PI * 2);
      const shortestDiff = ((diff + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      targetRotY = globeRig.rotation.y + shortestDiff;

      isCentering = true;
      targetZoom = Math.min(camera.position.z, 2.5);
    };

    // ── Raycaster for marker click selection ──────────────────────────────
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const markerMeshes = markerVisuals.map(m => m.mesh);

    const onMarkerClick = (event: PointerEvent) => {
      if (isDragging || pointers.size > 1) return;
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.x =  ((event.clientX - rect.left)  / rect.width)  * 2 - 1;
      ndc.y = -((event.clientY - rect.top)   / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(markerMeshes);
      if (hits.length > 0) {
        const hit = hits[0].object as THREE.Mesh;
        const id = hit.userData.debrisId as string;
        const nextId = selectedRef.current === id ? null : id;
        onMarkerSelect(nextId);
        if (nextId) {
          const loc = DEBRIS_LOCATIONS.find(d => d.id === nextId);
          if (loc) focusOnLocation(loc.lat, loc.lng);
        }
      } else {
        onMarkerSelect(null);
      }
    };

    // ── Pointer / touch / keyboard controls ───────────────────────────────
    const pointers = new Map<number, { x: number; y: number }>();
    let isDragging = false;
    let prevX = 0;
    let prevY = 0;
    let lastPinchDistance = 0;
    let velocityX = 0;
    let velocityY = 0;
    let targetRotX = INDIA_ROT_X;
    let targetRotY = INDIA_ROT_Y;
    let isCentering = false;

    const clampTilt = () => {
      globeRig.rotation.x = THREE.MathUtils.clamp(globeRig.rotation.x, -Math.PI * 0.42, Math.PI * 0.42);
    };

    const pinchDistance = () => {
      const points = [...pointers.values()];
      if (points.length < 2) return 0;
      return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    };

    const onPointerDown = (event: PointerEvent) => {
      renderer.domElement.focus({ preventScroll: true });
      renderer.domElement.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      isDragging = true;
      isCentering = false;
      renderer.domElement.style.cursor = 'grabbing';
      if (pointers.size === 1) {
        prevX = event.clientX;
        prevY = event.clientY;
      } else if (pointers.size === 2) {
        lastPinchDistance = pinchDistance();
        velocityX = 0;
        velocityY = 0;
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size >= 2) {
        const distance = pinchDistance();
        if (lastPinchDistance > 0) {
          targetZoom = THREE.MathUtils.clamp(targetZoom + (lastPinchDistance - distance) * 0.006, 1.5, 4.8);
        }
        lastPinchDistance = distance;
        return;
      }
      const dx = event.clientX - prevX;
      const dy = event.clientY - prevY;
      globeRig.rotation.y += dx * 0.005;
      globeRig.rotation.x += dy * 0.004;
      clampTilt();
      velocityY = dx * 0.00042;
      velocityX = dy * 0.00034;
      prevX = event.clientX;
      prevY = event.clientY;
    };

    const onPointerEnd = (event: PointerEvent) => {
      const wasDragging = isDragging;
      pointers.delete(event.pointerId);
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }
      lastPinchDistance = pointers.size > 1 ? pinchDistance() : 0;
      isDragging = pointers.size > 0;
      renderer.domElement.style.cursor = isDragging ? 'grabbing' : 'grab';
      const remaining = pointers.values().next().value as { x: number; y: number } | undefined;
      if (remaining) { prevX = remaining.x; prevY = remaining.y; }
      if (!isDragging && wasDragging) {
        onMarkerClick(event);
      }
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      targetZoom = THREE.MathUtils.clamp(targetZoom + event.deltaY * 0.002, 1.5, 4.8);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const rotationStep = 0.09;
      if      (event.key === 'ArrowLeft')              globeRig.rotation.y -= rotationStep;
      else if (event.key === 'ArrowRight')             globeRig.rotation.y += rotationStep;
      else if (event.key === 'ArrowUp')                globeRig.rotation.x -= rotationStep;
      else if (event.key === 'ArrowDown')              globeRig.rotation.x += rotationStep;
      else if (event.key === '+' || event.key === '=') targetZoom = Math.max(1.5, targetZoom - 0.25);
      else if (event.key === '-' || event.key === '_') targetZoom = Math.min(4.8, targetZoom + 0.25);
      else return;
      event.preventDefault();
      clampTilt();
    };

    renderer.domElement.addEventListener('pointerdown',  onPointerDown);
    renderer.domElement.addEventListener('pointermove',  onPointerMove);
    renderer.domElement.addEventListener('pointerup',    onPointerEnd);
    renderer.domElement.addEventListener('pointercancel',onPointerEnd);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
    renderer.domElement.addEventListener('keydown', onKeyDown);

    // Zoom and Focus custom event handlers
    const handleZoomEvent = (e: Event) => {
      const delta = (e as CustomEvent<number>).detail || 0;
      targetZoom = THREE.MathUtils.clamp(targetZoom + delta, 1.5, 4.8);
    };
    const handleFocusEvent = (e: Event) => {
      const { lat, lng } = (e as CustomEvent<{ lat: number; lng: number }>).detail;
      focusOnLocation(lat, lng);
    };

    renderer.domElement.addEventListener('oceanguard:zoom', handleZoomEvent);
    renderer.domElement.addEventListener('oceanguard:focus', handleFocusEvent);

    const onResize = () => {
      if (!el) return;
      const W2 = el.clientWidth, H2 = el.clientHeight;
      renderer.setSize(W2, H2);
      camera.aspect = W2 / H2;
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(el);

    // ── Animation loop ────────────────────────────────────────────────────
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let animId: number;
    let lastRender = 0;
    let lastFrame  = 0;

    const camForward = new THREE.Vector3();
    const markerWorld = new THREE.Vector3();

    const animate = (timestamp = 0) => {
      animId = requestAnimationFrame(animate);
      if (document.hidden || (reduceMotion && timestamp - lastRender < 100)) return;
      lastRender = timestamp;
      const delta = lastFrame ? Math.min((timestamp - lastFrame) / 16.67, 3) : 1;
      lastFrame = timestamp;

      // Smooth centering to selected coastal zone if triggered
      if (isCentering) {
        globeRig.rotation.x = THREE.MathUtils.lerp(globeRig.rotation.x, targetRotX, 0.08 * delta);
        globeRig.rotation.y = THREE.MathUtils.lerp(globeRig.rotation.y, targetRotY, 0.08 * delta);
        if (Math.abs(globeRig.rotation.x - targetRotX) < 0.003 && Math.abs(globeRig.rotation.y - targetRotY) < 0.003) {
          isCentering = false;
        }
      }

      // Continuous gentle auto-rotation (pauses when a location is selected so user can inspect it)
      const isLocationSelected = Boolean(selectedRef.current);
      if (!isDragging && !reduceMotion && !isCentering && !isLocationSelected) {
        const autoSpin = 0.0014;
        globeRig.rotation.y += (velocityY + autoSpin) * delta;
        globeRig.rotation.x += velocityX * delta;
        clampTilt();
        const damping = Math.pow(0.94, delta);
        velocityX *= damping;
        velocityY *= damping;
      }

      const zoomEase = 1 - Math.pow(0.78, delta);
      camera.position.z = THREE.MathUtils.lerp(camera.position.z, targetZoom, zoomEase);

      // Camera forward direction in world space for occlusion checking
      camera.getWorldDirection(camForward);

      const seconds = timestamp / 1000;
      markerVisuals.forEach(({ mesh, ring, ringMaterial, sprite, phase, id, worldPos }) => {
        // Far-side occlusion check: hide markers when rotated onto backside of globe
        globeRig.localToWorld(markerWorld.copy(worldPos));
        markerWorld.sub(camera.position).normalize();
        const dot = markerWorld.dot(camForward);
        const visible = dot > 0.04;
        mesh.visible = visible;
        ring.visible = visible && (!reduceMotion);
        if (sprite) sprite.visible = visible;

        if (!visible) return;

        // Radiant pulse animation
        const isSelected = selectedRef.current === id;
        if (!reduceMotion) {
          const pulse = Math.sin(seconds * 2.4 + phase) * 0.5 + 0.5;
          const scaleBoost = isSelected ? 1.5 : 1;
          mesh.scale.setScalar((1 + pulse * 0.25) * scaleBoost);
          ring.scale.setScalar((1 + pulse * 1.4) * scaleBoost);
          ringMaterial.opacity = isSelected ? 0.95 : Math.max(0.1, 0.7 - pulse * 0.6);
          if (sprite) {
            const sprScale = isSelected ? 1.35 : 1.0;
            sprite.scale.set(0.18 * sprScale, 0.042 * sprScale, 1);
            sprite.renderOrder = isSelected ? 999 : 1;
            sprite.material.opacity = isSelected ? 1.0 : 0.88;
          }
        } else {
          mesh.scale.setScalar(isSelected ? 1.5 : 1);
          ring.scale.setScalar(1);
          ringMaterial.opacity = 0.5;
          if (sprite) {
            sprite.scale.set(0.18 * (isSelected ? 1.35 : 1), 0.042 * (isSelected ? 1.35 : 1), 1);
            sprite.renderOrder = isSelected ? 999 : 1;
          }
        }
      });

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown',  onPointerDown);
      renderer.domElement.removeEventListener('pointermove',  onPointerMove);
      renderer.domElement.removeEventListener('pointerup',    onPointerEnd);
      renderer.domElement.removeEventListener('pointercancel',onPointerEnd);
      renderer.domElement.removeEventListener('wheel',  onWheel);
      renderer.domElement.removeEventListener('keydown', onKeyDown);
      renderer.domElement.removeEventListener('oceanguard:zoom', handleZoomEvent);
      renderer.domElement.removeEventListener('oceanguard:focus', handleFocusEvent);
      scene.traverse(object => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose?.();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach(item => item.dispose());
        else material?.dispose?.();
      });
      renderer.dispose();
      renderer.forceContextLoss();
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={mountRef} className="h-full min-h-[460px] w-full" />;
}

// ── Marker detail panel ────────────────────────────────────────────────────
function MarkerDetailPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const location = DEBRIS_LOCATIONS.find(d => d.id === id);
  if (!location) return null;
  const riskColors: Record<string, string> = {
    CRITICAL: 'text-[#ff4455] border-[#ff4455]/40 bg-[#ff4455]/10',
    HIGH:     'text-[#ffaa00] border-[#ffaa00]/40 bg-[#ffaa00]/10',
    MEDIUM:   'text-[#eab308] border-[#eab308]/40 bg-[#eab308]/10',
    LOW:      'text-[#10b981] border-[#10b981]/40 bg-[#10b981]/10',
  };
  const cls = riskColors[location.risk] ?? riskColors.LOW;
  const latStr = `${location.lat.toFixed(2)}°N`;
  const lngStr = `${location.lng.toFixed(2)}°E`;
  return (
    <div
      role="dialog"
      aria-label={`Details for ${location.label}`}
      className="absolute bottom-16 left-4 z-20 w-72 rounded border border-[#3a4a46]/60 bg-[#080e1a]/95 p-3.5 backdrop-blur-md shadow-2xl"
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="text-xs font-bold text-[#dde2f3] leading-tight">{location.label}</p>
          <p className="font-mono text-[10px] text-[#83948f] mt-0.5">{latStr}, {lngStr} · {location.zone}</p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close detail panel"
          className="ml-2 text-[#83948f] hover:text-[#00f5d4] transition-colors p-1"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex items-center justify-between gap-2 mb-2.5">
        <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[10px] font-bold uppercase tracking-wider ${cls}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-current" />
          {location.risk}
        </div>
        <span className="font-mono text-[10px] font-semibold text-[#dde2f3]">
          Risk Index: <strong className="text-[#00f5d4] font-bold">{location.riskScore}</strong> / 100
        </span>
      </div>

      <div className="space-y-1.5 text-[10px] font-mono text-[#b9cac4] bg-[#0c1422] p-2.5 rounded border border-[#3a4a46]/40">
        <div className="flex justify-between">
          <span className="text-[#83948f]">Cataloged debris</span>
          <span className="font-bold text-[#dde2f3]">{location.count.toLocaleString()} items</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#83948f]">Estimated total mass</span>
          <span className="font-bold text-[#4cd6fb]">{location.massKg.toLocaleString()} kg</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#83948f]">AI model confidence</span>
          <span className="font-bold text-[#00f5d4]">{location.confidencePct}%</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#83948f]">Dominant litter class</span>
          <span className="text-[#26fedc]">{location.dominantClass}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#83948f]">Monitoring radius</span>
          <span className="text-[#dde2f3]">{location.surveyRadiusKm} km</span>
        </div>
      </div>
      <p className="mt-2 text-[9px] font-mono text-[#83948f] border-t border-[#3a4a46]/40 pt-1.5 uppercase tracking-wider">
        ⚠ SAMPLE / SIMULATED DATA — not measured
      </p>
    </div>
  );
}

// ── Landing Page ───────────────────────────────────────────────────────────
export default function Landing() {
  const navigate = useNavigate();
  const [orgInput, setOrgInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [authKeyFeedback, setAuthKeyFeedback] = useState<string | null>(null);
  const [requestLoading, setRequestLoading] = useState(false);
  const [selectedMarker, setSelectedMarker] = useState<string | null>(null);
  const globeCanvasRef = useRef<HTMLDivElement>(null);

  const handleZoom = useCallback((delta: number) => {
    const canvas = globeCanvasRef.current?.querySelector('canvas');
    canvas?.dispatchEvent(new CustomEvent('oceanguard:zoom', { detail: delta }));
  }, []);

  const handleSelectZone = useCallback((id: string) => {
    setSelectedMarker(prev => {
      const nextId = prev === id ? null : id;
      if (nextId) {
        const loc = DEBRIS_LOCATIONS.find(d => d.id === nextId);
        if (loc) {
          const canvas = globeCanvasRef.current?.querySelector('canvas');
          canvas?.dispatchEvent(new CustomEvent('oceanguard:focus', { detail: { lat: loc.lat, lng: loc.lng } }));
        }
      }
      return nextId;
    });
  }, []);

  const handleAuthRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgInput.trim() || !emailInput.trim()) {
      setAuthKeyFeedback('Please enter both your organization name and institutional email.');
      return;
    }
    setRequestLoading(true);
    setAuthKeyFeedback(null);
    try {
      const res = await accessRequestsApi.create(orgInput, emailInput);
      setAuthKeyFeedback(`Sentinel data access request registered (${res.request.id}) for ${res.request.organization}. Confirmation queued to ${res.request.email}.`);
      setOrgInput('');
      setEmailInput('');
    } catch (err: any) {
      setAuthKeyFeedback(err.message || 'Failed to submit request. Please try again.');
    } finally {
      setRequestLoading(false);
    }
  };

  return (
    <>
      <SkipLink />
      <main id="main-content" tabIndex={-1} className="min-h-screen w-full bg-[#0e131f] text-[#dde2f3] overflow-y-auto overflow-x-hidden outline-none selection:bg-[#00f5d4]/30 selection:text-[#26fedc]">

      {/* ── SECTION 1: HERO & TELEMETRY ─────────────────────────────────── */}
      <section className="relative w-full overflow-hidden bg-[#080e1a] px-4 sm:px-6 lg:px-12 pt-10 pb-16 border-b border-[#3a4a46]/30">
        <div className="pointer-events-none absolute left-1/2 top-1/4 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[900px] rounded-full bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-[#00f5d4]/10 via-[#4cd6fb]/5 to-transparent blur-3xl" />
        <div className="pointer-events-none absolute -right-32 top-12 w-96 h-96 rounded-full bg-[#00b2d6]/10 blur-[120px]" />

        <div className="relative z-10 max-w-7xl mx-auto flex flex-col gap-8">
          {/* Telemetry Eyebrow Pill */}
          <div className="flex flex-wrap items-center gap-2.5 self-start">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#242a36]/90 border border-[#3a4a46]/60 shadow-lg backdrop-blur-md">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00f5d4] opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#00f5d4]" />
              </span>
              <span className="font-telemetry-tag text-[10px] uppercase tracking-widest text-[#00f5d4] font-bold">
                MISSION ID: COASTAL_PILOT_V1
              </span>
              <span className="text-[#83948f]/40">|</span>
              <span className="font-data-mono-sm text-[11px] text-[#b9cac4]">
                SAMPLE TELEMETRY // ESPADA V1 INFERENCE ACTIVE
              </span>
            </div>
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded bg-[#1a202c]/70 border border-[#3a4a46]/30">
              <span className="font-data-mono-sm text-[11px] text-[#4cd6fb] font-mono">LATENCY: ~10MS LOCAL ONNX</span>
              <span className="font-telemetry-tag text-[10px] text-[#83948f]">GEODATUM: WGS84 (SAMPLE)</span>
            </div>
          </div>

          {/* Hero Typography */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-end">
            <div className="lg:col-span-8 flex flex-col gap-4">
              <h1 className="font-display-hero text-3xl sm:text-5xl lg:text-6xl font-bold uppercase tracking-tight text-[#dde2f3] leading-[1.08]">
                Autonomous <span className="bg-gradient-to-r from-[#00f5d4] via-[#4cd6fb] to-[#26fedc] bg-clip-text text-transparent drop-shadow-[0_0_35px_rgba(0,245,212,0.35)]">Neural Vision</span> for Pristine Oceans.
              </h1>
              <p className="font-body-lg text-sm sm:text-base text-[#b9cac4] max-w-2xl leading-relaxed">
                Self-hosted local computer vision and marine telemetry for coastal litter detection. Real-time object detection and human-reviewed continual learning with the open-source Espada v1 detector—no paid AI APIs or cloud vendor lock-in.
              </p>
            </div>

            <div className="lg:col-span-4 flex flex-col sm:flex-row lg:flex-col gap-3 justify-end">
              <button
                onClick={() => {
                  const el = document.getElementById('india-ocean-globe');
                  el?.scrollIntoView({ behavior: 'smooth' });
                }}
                className="inline-flex items-center justify-center gap-2.5 px-6 py-3.5 rounded bg-gradient-to-r from-[#00f5d4] to-[#4cd6fb] text-[#00201a] font-bold text-xs uppercase tracking-wider shadow-[0_0_25px_rgba(0,245,212,0.35)] hover:shadow-[0_0_35px_rgba(0,245,212,0.6)] hover:brightness-110 active:scale-[0.98] transition-all cursor-pointer"
              >
                Explore 3D Globe
                <ArrowUpRight className="w-4 h-4" />
              </button>
              <button
                onClick={() => navigate('/data')}
                className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded bg-[#161c28] border border-[#3a4a46]/60 text-[#d7fff3] font-semibold text-xs tracking-wider hover:border-[#00f5d4]/50 hover:bg-[#242a36] transition-all cursor-pointer"
              >
                Try Espada AI Detector
              </button>
            </div>
          </div>

          {/* Stats Strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-4">
            <div className="flex flex-col p-3.5 rounded bg-[#1a202c]/75 border border-[#3a4a46]/40 shadow-sm backdrop-blur-md">
              <span className="font-telemetry-tag text-[10px] text-[#b9cac4] uppercase tracking-wider font-bold">Vessel Assets</span>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="font-data-mono-xl text-2xl text-[#d7fff3] font-bold">3 PILOT</span>
                <span className="font-telemetry-tag text-[9px] text-[#00f5d4] uppercase">COASTAL TRIALS</span>
              </div>
              <div className="w-full bg-[#2f3542] h-1 rounded-full mt-2 overflow-hidden">
                <div className="bg-[#00f5d4] h-full w-[100%]" />
              </div>
            </div>

            <div className="flex flex-col p-3.5 rounded bg-[#1a202c]/75 border border-[#3a4a46]/40 shadow-sm backdrop-blur-md">
              <span className="font-telemetry-tag text-[10px] text-[#b9cac4] uppercase tracking-wider font-bold">Model Checkpoint</span>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="font-data-mono-xl text-2xl text-[#4cd6fb] font-bold">v1.0</span>
                <span className="font-telemetry-tag text-[9px] text-[#4cd6fb] uppercase">SSDLITE320 ONNX</span>
              </div>
              <div className="w-full bg-[#2f3542] h-1 rounded-full mt-2 overflow-hidden">
                <div className="bg-[#4cd6fb] h-full w-[94%]" />
              </div>
            </div>

            <div className="flex flex-col p-3.5 rounded bg-[#1a202c]/75 border border-[#3a4a46]/40 shadow-sm backdrop-blur-md">
              <span className="font-telemetry-tag text-[10px] text-[#b9cac4] uppercase tracking-wider font-bold">Simulated Contacts</span>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="font-data-mono-xl text-2xl text-[#26fedc] font-bold">1,524</span>
                <span className="font-telemetry-tag text-[9px] text-[#00f5d4] uppercase">10 DEMO ZONES</span>
              </div>
              <div className="w-full bg-[#2f3542] h-1 rounded-full mt-2 overflow-hidden">
                <div className="bg-[#00dfc1] h-full w-[100%]" />
              </div>
            </div>

            <div className="flex flex-col p-3.5 rounded bg-[#1a202c]/75 border border-[#3a4a46]/40 shadow-sm backdrop-blur-md">
              <span className="font-telemetry-tag text-[10px] text-[#b9cac4] uppercase tracking-wider font-bold">Typical Inference</span>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="font-data-mono-xl text-2xl text-[#00f5d4] font-bold">~10<span className="text-xs font-normal text-[#b9cac4]">ms</span></span>
                <span className="font-telemetry-tag text-[9px] text-[#00f5d4] uppercase">ONNX RUNTIME · FP32</span>
              </div>
              <div className="w-full bg-[#2f3542] h-1 rounded-full mt-2 overflow-hidden">
                <div className="bg-[#00f5d4] h-full w-[84%]" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 2: INTERACTIVE 3D GLOBE ─────────────────────────────── */}
      <section className="relative w-full bg-[#0e131f] px-4 sm:px-6 lg:px-12 py-16 border-b border-[#3a4a46]/30" id="india-ocean-globe">
        <div className="max-w-7xl mx-auto flex flex-col gap-6">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="h-1.5 w-1.5 rounded-full bg-[#00f5d4] animate-pulse" />
                <span className="font-telemetry-tag text-[10px] uppercase tracking-widest text-[#00f5d4] font-bold">
                  ORBITAL 3D PROJECTION · INDIAN OCEAN
                </span>
              </div>
              <h2 className="font-headline-xl text-2xl sm:text-3xl font-bold text-[#dde2f3]">
                Indian Ocean Marine Debris Monitoring Grid
              </h2>
              <p className="font-body-md text-xs sm:text-sm text-[#b9cac4] mt-1">
                Drag to orbit · Pinch, scroll, or use +/- to zoom and minimize · Click any coastal zone to inspect.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline-cyan" size="xs">COASTAL INDIA</Badge>
              <DataProvenanceBadge status="SAMPLE" label="SAMPLE DATASET" />
            </div>
          </div>

          <div className="relative rounded border border-[#3a4a46]/50 bg-[#080e1a] overflow-hidden min-h-[500px] flex flex-col lg:flex-row items-stretch">
            {/* Globe Canvas */}
            <div className="flex-1 relative min-h-[460px]" ref={globeCanvasRef}>
              <GlobeCanvas
                onMarkerSelect={setSelectedMarker}
                selectedId={selectedMarker}
              />

              {/* Marker detail panel */}
              {selectedMarker && (
                <MarkerDetailPanel
                  id={selectedMarker}
                  onClose={() => setSelectedMarker(null)}
                />
              )}

              {/* Zoom In / Zoom Out (Minimize) Controls */}
              <div className="absolute right-4 top-4 z-10 flex flex-col gap-2">
                <button
                  type="button"
                  aria-label="Zoom in"
                  title="Zoom In (+)"
                  onClick={() => handleZoom(-0.35)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded border border-[#3a4a46]/60 bg-[#080e1a]/90 text-sm font-bold text-[#00f5d4] shadow-lg backdrop-blur-md transition-colors hover:border-[#00f5d4] hover:bg-[#102434]"
                >
                  <Plus className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="Zoom out (minimize)"
                  title="Zoom Out / Minimize (-)"
                  onClick={() => handleZoom(0.35)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded border border-[#3a4a46]/60 bg-[#080e1a]/90 text-sm font-bold text-[#00f5d4] shadow-lg backdrop-blur-md transition-colors hover:border-[#00f5d4] hover:bg-[#102434]"
                >
                  <Minus className="h-4 w-4" />
                </button>
              </div>

              <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-[#3a4a46]/50 bg-[#080e1a]/80 px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-[#b9cac4] backdrop-blur-md">
                Drag to orbit · Pinch / scroll / +/- to zoom · Click coastal marker to inspect
              </div>

              {/* Risk Legend (all 4 levels, matching utils.ts thresholds) */}
              <div className="absolute top-4 left-4 p-3 rounded bg-[#161c28]/90 border border-[#3a4a46]/50 backdrop-blur-md">
                <p className="font-telemetry-tag text-[9px] uppercase tracking-wider text-[#b9cac4] mb-2 font-bold">
                  Risk Level (sample)
                </p>
                <div className="space-y-1.5 text-xs font-mono">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[#ff4455] shadow-[0_0_6px_#ff4455]" />
                    <span className="text-[#ff4455]">Critical (≥80)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[#ffaa00]" />
                    <span className="text-[#ffaa00]">High (60–79)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[#eab308]" />
                    <span className="text-[#eab308]">Medium (30–59)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[#10b981]" />
                    <span className="text-[#10b981]">Low (&lt;30)</span>
                  </div>
                  <p className="text-[8px] text-[#83948f] border-t border-[#3a4a46]/40 pt-1 mt-1">
                    Coastline: Natural Earth (public domain)
                  </p>
                </div>
              </div>
            </div>

            {/* Right Sidebar */}
            <div className="w-full lg:w-80 bg-[#161c28]/95 border-t lg:border-t-0 lg:border-l border-[#3a4a46]/50 p-4 sm:p-5 flex flex-col justify-between">
              <div>
                <h3 className="font-headline-sm text-sm font-bold text-[#dde2f3] uppercase tracking-wide mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Compass className="w-4 h-4 text-[#00f5d4]" />
                    <span>Indian Coastal Zones</span>
                  </span>
                  <span className="font-mono text-[10px] text-[#00f5d4] font-bold">10 MONITORED</span>
                </h3>
                <p className="text-[9px] font-mono text-[#83948f] mb-3 uppercase tracking-wider">
                  ⚠ Sample simulation telemetry · 7,516 km coastline
                </p>

                {/* Aggregate Metrics Bar */}
                <div className="grid grid-cols-3 gap-1.5 p-2 rounded bg-[#080e1a] border border-[#3a4a46]/40 mb-3 text-center font-mono">
                  <div className="border-r border-[#3a4a46]/30">
                    <div className="text-[13px] font-bold text-[#dde2f3]">10</div>
                    <div className="text-[8px] text-[#83948f] uppercase">Zones</div>
                  </div>
                  <div className="border-r border-[#3a4a46]/30">
                    <div className="text-[13px] font-bold text-[#00f5d4]">1,524</div>
                    <div className="text-[8px] text-[#83948f] uppercase">Demo Items</div>
                  </div>
                  <div>
                    <div className="text-[13px] font-bold text-[#4cd6fb]">7,150 <span className="text-[9px] font-normal">kg</span></div>
                    <div className="text-[8px] text-[#83948f] uppercase">Demo Est. Mass</div>
                  </div>
                </div>

                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {DEBRIS_LOCATIONS.map(d => (
                    <button
                      key={d.id}
                      onClick={() => handleSelectZone(d.id)}
                      className={`w-full text-left p-2.5 rounded bg-[#080e1a] border transition-all flex flex-col gap-1.5 cursor-pointer ${
                        selectedMarker === d.id
                          ? 'border-[#00f5d4]/60 shadow-[0_0_12px_rgba(0,245,212,0.18)] bg-[#00f5d4]/10'
                          : 'border-[#3a4a46]/40 hover:border-[#00f5d4]/40 hover:bg-[#0c1626]'
                      }`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <p className="text-xs font-semibold text-[#dde2f3] truncate">{d.label}</p>
                        <Badge
                          variant={d.risk === 'CRITICAL' ? 'red' : d.risk === 'HIGH' ? 'amber' : d.risk === 'MEDIUM' ? 'amber' : 'cyan'}
                          size="xs"
                        >
                          {d.risk}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between text-[10px] font-mono text-[#83948f] w-full">
                        <span>{d.lat.toFixed(2)}°N, {d.lng.toFixed(2)}°E</span>
                        <span>
                          Index: <strong className={d.risk === 'CRITICAL' ? 'text-[#ff4455]' : d.risk === 'HIGH' ? 'text-[#ffaa00]' : d.risk === 'MEDIUM' ? 'text-[#eab308]' : 'text-[#10b981]'}>{d.riskScore}</strong>/100
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[10px] font-mono border-t border-[#3a4a46]/20 pt-1 text-[#b9cac4] w-full">
                        <span><strong className="text-[#dde2f3]">{d.count}</strong> debris items</span>
                        <span className="text-[#4cd6fb]">{d.massKg.toLocaleString()} kg</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-4 mt-4 border-t border-[#3a4a46]/40">
                <Button
                  variant="primary"
                  fullWidth
                  size="sm"
                  onClick={() => navigate('/hotspots')}
                  icon={<Layers className="w-4 h-4" />}
                >
                  Open Indian Ocean Hotspot Map
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 4: CORE ARCHITECTURAL PILLARS ──────────────────────── */}
      <section className="relative w-full bg-[#161c28] px-4 sm:px-6 lg:px-12 py-16 border-b border-[#3a4a46]/30">
        <div className="max-w-7xl mx-auto flex flex-col gap-10">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div className="flex flex-col gap-2 max-w-2xl">
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-[#00f5d4]" />
                <span className="font-telemetry-tag text-[10px] uppercase tracking-widest text-[#00f5d4] font-bold">
                  ARCHITECTURAL SPECIFICATION
                </span>
              </div>
              <h2 className="font-headline-xl text-2xl sm:text-3xl font-bold text-[#dde2f3]">
                Sub-Surface Optical &amp; Algorithmic Supremacy
              </h2>
              <p className="font-body-md text-xs sm:text-sm text-[#b9cac4]">
                Engineered specifically to solve the aquatic visibility ceiling: mitigating high solar flare refraction, heavy white-cap wave occlusions, and severe light absorption past the bathyal drop-off.
              </p>
            </div>
            <span className="font-data-mono-md text-xs text-[#4cd6fb] font-bold font-mono">
              SYS_ARCHITECTURE // 04 PILLARS
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="group relative rounded bg-[#1a202c] border border-[#3a4a46]/40 p-5 flex flex-col justify-between shadow-md hover:border-[#00f5d4]/50 hover:shadow-[0_0_25px_rgba(0,245,212,0.15)] transition-all">
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="font-data-mono-sm text-[11px] text-[#00f5d4] font-bold font-mono">01 // SPECTRAL</span>
                  <Satellite className="w-5 h-5 text-[#4cd6fb]" />
                </div>
                <h3 className="font-headline-sm text-base text-[#dde2f3] font-bold">Multi-Spectral Imaging</h3>
                <p className="font-body-sm text-xs text-[#b9cac4] leading-relaxed">
                  Exploring multi-band coastal and satellite imagery ingestion with optical normal correction. Prototype preprocessing for isolating floating polymers and flotsam from sun glint and surface chop.
                </p>
              </div>
              <div className="pt-4 mt-3 border-t border-[#3a4a46]/30 flex items-center justify-between font-telemetry-tag text-[10px] text-[#83948f] uppercase">
                <span>MODE: OPTICAL PILOT</span>
                <span className="text-[#00f5d4] font-bold">RESEARCH STAGE</span>
              </div>
            </div>

            <div className="group relative rounded bg-[#1a202c] border border-[#3a4a46]/40 p-5 flex flex-col justify-between shadow-md hover:border-[#4cd6fb]/50 hover:shadow-[0_0_25px_rgba(76,214,251,0.15)] transition-all">
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="font-data-mono-sm text-[11px] text-[#4cd6fb] font-bold font-mono">02 // 3D SCENE</span>
                  <Waves className="w-5 h-5 text-[#4cd6fb]" />
                </div>
                <h3 className="font-headline-sm text-base text-[#dde2f3] font-bold">Interactive 3D Monitoring</h3>
                <p className="font-body-sm text-xs text-[#b9cac4] leading-relaxed">
                  Real-time Three.js procedural ocean rendering featuring wave displacement physics, surface and seabed debris inspection, boat kinematics, and atmospheric sun modeling for sample coastal missions.
                </p>
              </div>
              <div className="pt-4 mt-3 border-t border-[#3a4a46]/30 flex items-center justify-between font-telemetry-tag text-[10px] text-[#83948f] uppercase">
                <span>VIEW: SURFACE / BENTHIC</span>
                <span className="text-[#4cd6fb] font-bold">SAMPLE MISSION</span>
              </div>
            </div>

            <div className="group relative rounded bg-[#1a202c] border border-[#3a4a46]/40 p-5 flex flex-col justify-between shadow-md hover:border-[#26fedc]/50 hover:shadow-[0_0_25px_rgba(38,254,220,0.15)] transition-all">
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="font-data-mono-sm text-[11px] text-[#26fedc] font-bold font-mono">03 // INFERENCE</span>
                  <Cpu className="w-5 h-5 text-[#00f5d4]" />
                </div>
                <h3 className="font-headline-sm text-base text-[#dde2f3] font-bold">Espada v1 Neural Detector</h3>
                <p className="font-body-sm text-xs text-[#b9cac4] leading-relaxed">
                  Fine-tuned SSDLite320 MobileNetV3 detector trained on the open TACO litter-imagery dataset (general litter categories; not a marine-specific benchmark). Delivers fast local ONNX inference, normalized bounding boxes, and operator-verified continual training.
                </p>
              </div>
              <div className="pt-4 mt-3 border-t border-[#3a4a46]/30 flex items-center justify-between font-telemetry-tag text-[10px] text-[#83948f] uppercase">
                <span>ONNX RUNTIME LOCAL</span>
                <span className="text-[#26fedc] font-bold">NO PAID APIS</span>
              </div>
            </div>

            <div className="group relative rounded bg-[#1a202c] border border-[#3a4a46]/40 p-5 flex flex-col justify-between shadow-md hover:border-[#00f5d4]/50 hover:shadow-[0_0_25px_rgba(0,245,212,0.15)] transition-all">
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="font-data-mono-sm text-[11px] text-[#00f5d4] font-bold font-mono">04 // AUDIT</span>
                  <Navigation className="w-5 h-5 text-[#00f5d4]" />
                </div>
                <h3 className="font-headline-sm text-base text-[#dde2f3] font-bold">Human-in-the-Loop Review</h3>
                <p className="font-body-sm text-xs text-[#b9cac4] leading-relaxed">
                  Every inference result can be reviewed by human operators: confirm detections, reject false positives, adjust bounding boxes, or tag missed debris to create versioned training data for future retrains.
                </p>
              </div>
              <div className="pt-4 mt-3 border-t border-[#3a4a46]/30 flex items-center justify-between font-telemetry-tag text-[10px] text-[#83948f] uppercase">
                <span>STORE: SQLITE WAL</span>
                <span className="text-[#00f5d4] font-bold">CONTINUAL LOOP</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 5: PILOT CAPABILITIES & ROADMAP ───────────────────── */}
      <section className="relative w-full bg-[#0e131f] px-4 sm:px-6 lg:px-12 py-16 border-b border-[#3a4a46]/30">
        <div className="max-w-7xl mx-auto flex flex-col gap-10">
          <div className="flex flex-col items-center text-center gap-2">
            <span className="font-telemetry-tag text-[10px] uppercase tracking-widest text-[#00f5d4] font-bold">
              PILOT CAPABILITIES &amp; ROADMAP
            </span>
            <h2 className="font-headline-xl text-2xl sm:text-4xl font-bold text-[#dde2f3]">
              Self-Hosted Ecological Telemetry
            </h2>
            <p className="font-body-md text-xs sm:text-sm text-[#b9cac4] max-w-xl">
              Engineered with open-source models, public marine debris benchmarks, and local human-in-the-loop review.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { val: '494+', title: 'Training Samples', desc: 'Curated general-litter images from the open-source TACO dataset used for fine-tuning (not marine-validated).', color: '#00f5d4' },
              { val: '200',  title: 'Held-Out Images',  desc: 'Deterministic capture-batch holdout partition ensuring genuine generalization benchmarking.', color: '#4cd6fb' },
              { val: '100%', title: 'Self-Hosted Ownership', desc: 'Runs entirely on local hardware with zero paid third-party API dependencies or subscription keys.', color: '#26fedc' },
              { val: '1 Entry', title: 'Espada v1 Registry', desc: 'Single production model registry entry with atomic candidate evaluation and hot-reload promotion.', color: '#d7fff3' },
            ].map(c => (
              <div key={c.title} className="p-6 rounded bg-[#161c28] border border-[#3a4a46]/40 shadow-lg flex flex-col items-center text-center gap-2 hover:border-[#00f5d4]/40 transition-all">
                <span className="font-display-hero text-3xl sm:text-4xl font-bold tracking-tight" style={{ color: c.color }}>
                  {c.val}
                </span>
                <span className="font-headline-sm text-sm font-semibold text-[#dde2f3]">{c.title}</span>
                <p className="font-body-sm text-xs text-[#b9cac4] mt-1 leading-relaxed">{c.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SECTION 6: PARTNERSHIP & ACCESS CALLOUT ──────────────────── */}
      <section className="relative w-full bg-[#080e1a] px-4 sm:px-6 lg:px-12 py-16 overflow-hidden">
        <div className="pointer-events-none absolute left-1/2 bottom-0 -translate-x-1/2 w-[700px] h-[350px] bg-[#00f5d4]/10 blur-[130px] rounded-full" />
        <div className="max-w-5xl mx-auto rounded bg-gradient-to-b from-[#242a36] via-[#161c28] to-[#080e1a] border border-[#3a4a46]/50 p-6 sm:p-10 shadow-2xl relative z-10 flex flex-col gap-6">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
            <div className="flex flex-col gap-2 max-w-xl">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded bg-[#1a202c] border border-[#00f5d4]/30 font-telemetry-tag text-[10px] text-[#00f5d4] uppercase">
                <Shield className="w-3.5 h-3.5 text-[#00f5d4]" />
                <span>SUPPORTS UN SDG 14 // LIFE BELOW WATER</span>
              </div>
              <h2 className="font-headline-xl text-xl sm:text-2xl font-bold text-[#dde2f3]">
                Request Sentinel Data Stream Access
              </h2>
              <p className="font-body-md text-xs sm:text-sm text-[#b9cac4]">
                Direct REST and Webhook telemetry streaming for sovereign maritime authorities, coastal research institutes, and robotic cleanup consortia along Indian coastlines.
              </p>
            </div>
            <div className="flex flex-col p-3 rounded bg-[#080e1a] border border-[#3a4a46]/40 text-[#b9cac4] font-mono text-xs">
              <span className="font-telemetry-tag text-[9px] uppercase">SESSION SECURITY</span>
              <span className="text-[#00f5d4] font-bold text-sm">SIGNED SESSION TOKENS · HTTPS</span>
              <span className="font-telemetry-tag text-[9px] uppercase mt-1">ROLE-BASED ACCESS CONTROL</span>
            </div>
          </div>

          {/* Access Request Form */}
          <form onSubmit={handleAuthRequest} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end bg-[#080e1a]/80 p-4 rounded border border-[#3a4a46]/40">
            <div className="md:col-span-4 flex flex-col gap-1">
              <label htmlFor="portal-organization" className="font-data-mono-sm text-[10px] text-[#b9cac4] uppercase">Organization / Institute</label>
              <input
                id="portal-organization"
                name="organization"
                autoComplete="organization"
                value={orgInput}
                onChange={e => setOrgInput(e.target.value)}
                className="bg-[#242a36] border border-[#3a4a46]/60 rounded px-3 py-2 font-data-mono-sm text-xs text-[#dde2f3] placeholder:text-[#83948f] focus:border-[#00f5d4] focus:outline-none"
                placeholder="Marine research institute / coastal authority / port authority"
              />
            </div>
            <div className="md:col-span-5 flex flex-col gap-1">
              <label htmlFor="portal-email" className="font-data-mono-sm text-[10px] text-[#b9cac4] uppercase">Institutional Email</label>
              <input
                id="portal-email"
                name="email"
                autoComplete="email"
                type="email"
                value={emailInput}
                onChange={e => setEmailInput(e.target.value)}
                className="bg-[#242a36] border border-[#3a4a46]/60 rounded px-3 py-2 font-data-mono-sm text-xs text-[#dde2f3] placeholder:text-[#83948f] focus:border-[#00f5d4] focus:outline-none"
                placeholder="cadence@maritimeresearch.org"
              />
            </div>
            <div className="md:col-span-3">
              <button
                type="submit"
                disabled={requestLoading}
                className="w-full py-2 px-3 rounded bg-gradient-to-r from-[#00f5d4] to-[#4cd6fb] text-[#00201a] font-data-mono-sm text-xs font-bold uppercase tracking-wider shadow-[0_0_20px_rgba(0,245,212,0.35)] hover:shadow-[0_0_30px_rgba(0,245,212,0.6)] cursor-pointer transition-all disabled:opacity-50"
              >
                {requestLoading ? 'Submitting...' : 'Request Access'}
              </button>
            </div>
          </form>

          {authKeyFeedback && (
            <div role="status" aria-live="polite" className="p-3 rounded bg-[#00f5d4]/10 border border-[#00f5d4]/40 text-[#00f5d4] font-mono text-xs text-center">
              {authKeyFeedback}
            </div>
          )}
        </div>
      </section>

      {/* ── FOOTER ─────────────────────────────────────────────────────── */}
      <footer className="w-full bg-[#080e1a] border-t border-[#3a4a46]/30 px-4 sm:px-6 lg:px-12 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-mono text-[#83948f]">
        <div className="flex items-center gap-3">
          <span className="text-[#00f5d4] font-bold">OceanGuard AI Platform</span>
          <span>//</span>
          <span>LAT: 20°00'00"N LON: 78°00'00"E · India</span>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/command')} className="inline-flex min-h-11 items-center gap-1 rounded px-2 text-[#4cd6fb] hover:underline cursor-pointer md:min-h-9">
            Command Center <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <span>© 2026 OceanGuard Corp.</span>
        </div>
      </footer>
      </main>
    </>
  );
}
