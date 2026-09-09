import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  Radar, Eye, Thermometer, Layers, Compass, Maximize2, RotateCcw,
  Anchor, Navigation, Crosshair, Wifi, Activity, Gauge, ChevronDown,
  ChevronUp, Ship, ZoomIn, ZoomOut, Fish, AlertTriangle, ShieldCheck,
  Search, Sliders, Volume2, VolumeX, Focus, ArrowUpRight
} from 'lucide-react';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TYPES & SYSTEM CONFIG
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type ViewMode = 'OPTICAL' | 'SONAR' | 'THERMAL' | 'BATHYMETRIC';

interface DetectedTarget {
  id: string;
  type: 'debris' | 'wildlife';
  className: string;
  category: string;
  confidence: number;
  speed: number;       // knots
  distance: number;    // meters from vessel
  bearing: number;     // degrees (0-360)
  depth: number;       // meters below sea level (0 = surface)
  risk: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'BENIGN';
  position: { x: number; y: number; z: number };
  realColorHex: string;
  materials: string;
  dimensions: string;
}

const MODE_CONFIG: Record<ViewMode, {
  name: string;
  tagline: string;
  icon: typeof Radar;
  accent: string;
  themeClass: string;
  skyColor: number;
  fogColor: number;
  fogDensity: number;
  waterColor: number;
  waterRoughness: number;
  waterOpacity: number;
  seabedColor: number;
  seabedWireframe: boolean;
  ambientLightColor: number;
  ambientIntensity: number;
  sunIntensity: number;
  showCaustics: boolean;
}> = {
  OPTICAL: {
    name: 'Real-World Optical',
    tagline: 'True-color high-definition multi-spectrum camera synthesis',
    icon: Eye,
    accent: '#00d4ff',
    themeClass: 'text-cyan-400 border-cyan-500/40 bg-cyan-500/10',
    skyColor: 0x051329,
    fogColor: 0x051f38,
    fogDensity: 0.0055,
    waterColor: 0x07446e,
    waterRoughness: 0.12,
    waterOpacity: 0.55,
    seabedColor: 0x221a12,
    seabedWireframe: false,
    ambientLightColor: 0xe6f7ff,
    ambientIntensity: 0.85,
    sunIntensity: 1.4,
    showCaustics: true,
  },
  SONAR: {
    name: 'Cyber-Sonar HUD',
    tagline: 'Tesla-style high-frequency multi-beam synthetic aperture sonar',
    icon: Radar,
    accent: '#00ff88',
    themeClass: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10',
    skyColor: 0x000d07,
    fogColor: 0x00170e,
    fogDensity: 0.008,
    waterColor: 0x002e15,
    waterRoughness: 0.35,
    waterOpacity: 0.32,
    seabedColor: 0x002b11,
    seabedWireframe: true,
    ambientLightColor: 0x33ff99,
    ambientIntensity: 0.45,
    sunIntensity: 0.7,
    showCaustics: false,
  },
  THERMAL: {
    name: 'FLIR Thermal IR',
    tagline: 'Long-wave infrared radiance thermography',
    icon: Thermometer,
    accent: '#ff7700',
    themeClass: 'text-amber-400 border-amber-500/40 bg-amber-500/10',
    skyColor: 0x160500,
    fogColor: 0x220900,
    fogDensity: 0.007,
    waterColor: 0x331200,
    waterRoughness: 0.4,
    waterOpacity: 0.42,
    seabedColor: 0x180400,
    seabedWireframe: false,
    ambientLightColor: 0xffaa55,
    ambientIntensity: 0.5,
    sunIntensity: 0.9,
    showCaustics: false,
  },
  BATHYMETRIC: {
    name: 'Bathymetric LiDAR',
    tagline: 'Topographic contour scan of seabed benthic relief',
    icon: Layers,
    accent: '#a855f7',
    themeClass: 'text-purple-400 border-purple-500/40 bg-purple-500/10',
    skyColor: 0x0c0418,
    fogColor: 0x150729,
    fogDensity: 0.006,
    waterColor: 0x1e0040,
    waterRoughness: 0.25,
    waterOpacity: 0.22,
    seabedColor: 0x120326,
    seabedWireframe: true,
    ambientLightColor: 0xd8b4fe,
    ambientIntensity: 0.6,
    sunIntensity: 0.8,
    showCaustics: true,
  },
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TARGET DATA WITH REAL-LIFE COLORS AND RICH PROFILES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const INITIAL_TARGETS: DetectedTarget[] = [
  {
    id: 'TRK-1042',
    type: 'debris',
    className: 'Ghost Fishing Net',
    category: 'Commercial Monofilament / Nylon',
    confidence: 94.8,
    speed: 0.4,
    distance: 38,
    bearing: 34,
    depth: 2.1,
    risk: 'CRITICAL',
    position: { x: 22, y: -2.1, z: -31 },
    realColorHex: '#2e7d32',
    materials: 'High-density braided polyamide with orange surface buoys and lead lines',
    dimensions: '6.4m × 3.8m × 2.2m',
  },
  {
    id: 'TRK-902',
    type: 'debris',
    className: 'PET Bottle Cluster',
    category: 'Consumer Microplastics Precursor',
    confidence: 97.2,
    speed: 0.9,
    distance: 24,
    bearing: 122,
    depth: 0.2,
    risk: 'MEDIUM',
    position: { x: -16, y: 0.1, z: -18 },
    realColorHex: '#38bdf8',
    materials: 'Polyethylene terephthalate with caps & floating packaging film',
    dimensions: '2.1m × 1.8m × 0.4m',
  },
  {
    id: 'TRK-884',
    type: 'debris',
    className: 'Corroded Oil Drum',
    category: 'Hazardous Chemical Storage',
    confidence: 89.1,
    speed: 0.1,
    distance: 52,
    bearing: 238,
    depth: 4.8,
    risk: 'HIGH',
    position: { x: -36, y: -4.8, z: 37 },
    realColorHex: '#c2410c',
    materials: 'Oxidized 55-gal steel drum with yellow hazard band and petrochemical residue',
    dimensions: '0.9m dia × 1.2m h',
  },
  {
    id: 'TRK-741',
    type: 'debris',
    className: 'Industrial Heavy Tire',
    category: 'Dense Synthetic Elastomer',
    confidence: 92.4,
    speed: 0.0,
    distance: 41,
    bearing: 195,
    depth: 14.5,
    risk: 'MEDIUM',
    position: { x: -18, y: -14.5, z: 36 },
    realColorHex: '#18181b',
    materials: 'Vulcanized heavy-equipment tread tire with marine biofilm encrustation',
    dimensions: '1.6m dia × 0.6m w',
  },
  {
    id: 'TRK-619',
    type: 'debris',
    className: '20ft Intermodal Container',
    category: 'Submerged Maritime Cargo',
    confidence: 98.6,
    speed: 0.0,
    distance: 88,
    bearing: 295,
    depth: 21.0,
    risk: 'CRITICAL',
    position: { x: 68, y: -21.0, z: 56 },
    realColorHex: '#dc2626',
    materials: 'Corten corrugated steel container resting on sandy oceanic shelf',
    dimensions: '6.06m × 2.44m × 2.59m',
  },
  {
    id: 'TRK-532',
    type: 'debris',
    className: 'Braided Hawser Rope Coil',
    category: 'Marine Moorings Debris',
    confidence: 84.7,
    speed: 0.6,
    distance: 47,
    bearing: 312,
    depth: 0.8,
    risk: 'MEDIUM',
    position: { x: 32, y: -0.8, z: 34 },
    realColorHex: '#d97706',
    materials: '8-strand polypropylene/hemp towing hawser bundle with frayed ends',
    dimensions: '3.2m coil length',
  },
  {
    id: 'BIO-001',
    type: 'wildlife',
    className: 'Bluefin Tuna School',
    category: 'Protected Marine Pelagic Fauna',
    confidence: 99.1,
    speed: 3.8,
    distance: 31,
    bearing: 78,
    depth: 5.5,
    risk: 'BENIGN',
    position: { x: 26, y: -5.5, z: 12 },
    realColorHex: '#60a5fa',
    materials: 'Biological specimen: 14x Thunnus thynnus swimming in formation',
    dimensions: '1.8m avg length',
  },
  {
    id: 'BIO-002',
    type: 'wildlife',
    className: 'Oceanic Manta Ray',
    category: 'Vulnerable Marine Megafauna',
    confidence: 96.5,
    speed: 2.1,
    distance: 46,
    bearing: 154,
    depth: 8.2,
    risk: 'BENIGN',
    position: { x: -28, y: -8.2, z: 35 },
    realColorHex: '#38bdf8',
    materials: 'Biological specimen: Mobula birostris gliding through water column',
    dimensions: '4.2m wing span',
  },
];

const RISK_BADGE_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  CRITICAL: { bg: 'bg-rose-500/20', text: 'text-rose-400', border: 'border-rose-500/50' },
  HIGH:     { bg: 'bg-amber-500/20', text: 'text-amber-400', border: 'border-amber-500/50' },
  MEDIUM:   { bg: 'bg-cyan-500/20',  text: 'text-cyan-400',  border: 'border-cyan-500/50' },
  LOW:      { bg: 'bg-blue-500/20',  text: 'text-blue-400',  border: 'border-blue-500/50' },
  BENIGN:   { bg: 'bg-emerald-500/20', text: 'text-emerald-400', border: 'border-emerald-500/50' },
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// THREE.JS PROCEDURAL FACTORIES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Realistic seabed with canyon, ridges, and depth contours
function createSeabedMesh(size: number, seg: number, mode: ViewMode, accent: string): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  const pos = geo.attributes.position;
  const count = pos.count;
  const colors = new Float32Array(count * 3);

  const cfg = MODE_CONFIG[mode];
  const baseColor = new THREE.Color(cfg.seabedColor);
  const deepColor = new THREE.Color(0x020a14);
  const shallowColor = new THREE.Color(mode === 'BATHYMETRIC' ? cfg.accent : 0xd4a373);

  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const z = pos.getY(i); // In plane coords Y is world Z

    // Multiscale underwater bathymetry noise
    let h = 0;
    h += Math.sin(x * 0.05) * Math.cos(z * 0.04) * 5.0;
    h += Math.sin(x * 0.12 + 1.2) * Math.cos(z * 0.1 + 0.8) * 2.8;
    h += Math.sin(x * 0.25 + 2.5) * Math.cos(z * 0.22 + 1.5) * 1.2;

    // Continental shelf drop-off / trench
    const trenchDist = Math.abs(x - 35);
    if (trenchDist < 20) {
      h -= Math.cos((trenchDist / 20) * (Math.PI / 2)) * 8.0;
    }

    // Seamount / ridge
    const ridgeDist = Math.sqrt((x + 35) ** 2 + (z + 20) ** 2);
    if (ridgeDist < 30) {
      h += Math.cos((ridgeDist / 30) * (Math.PI / 2)) * 6.5;
    }

    pos.setZ(i, h);

    // Vertex colors based on elevation (bathymetric colormap)
    const normH = THREE.MathUtils.clamp((h + 10) / 18, 0, 1);
    const vertColor = new THREE.Color();
    if (mode === 'BATHYMETRIC') {
      vertColor.setHSL(0.75 - normH * 0.55, 0.9, 0.25 + normH * 0.35);
    } else {
      vertColor.lerpColors(deepColor, baseColor, normH);
    }
    colors[i * 3] = vertColor.r;
    colors[i * 3 + 1] = vertColor.g;
    colors[i * 3 + 2] = vertColor.b;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    wireframe: cfg.seabedWireframe,
    roughness: 0.88,
    metalness: 0.08,
    emissive: new THREE.Color(cfg.accent),
    emissiveIntensity: cfg.seabedWireframe ? 0.2 : 0.03,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -24; // 24 meters below water surface
  mesh.receiveShadow = true;
  return mesh;
}

// Crisp Canvas Sprite Label with dark frosted HUD background
function createTacticalSprite(
  title: string,
  subtitle: string,
  borderColor: string,
  badgeText?: string
): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  canvas.width = 512;
  canvas.height = 160;

  // Background card
  ctx.fillStyle = 'rgba(6, 12, 24, 0.88)';
  ctx.beginPath();
  ctx.roundRect(8, 8, canvas.width - 16, canvas.height - 16, 16);
  ctx.fill();

  // Outer border with accent color
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(8, 8, canvas.width - 16, canvas.height - 16, 16);
  ctx.stroke();

  // Top header with badge
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 30px "JetBrains Mono", monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(title, 24, 26);

  if (badgeText) {
    ctx.font = 'bold 20px "JetBrains Mono", monospace';
    const badgeW = ctx.measureText(badgeText).width + 20;
    const badgeX = canvas.width - 24 - badgeW;
    ctx.fillStyle = borderColor;
    ctx.beginPath();
    ctx.roundRect(badgeX, 26, badgeW, 32, 6);
    ctx.fill();

    ctx.fillStyle = '#050a12';
    ctx.fillText(badgeText, badgeX + 10, 31);
  }

  // Divider line
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(24, 72);
  ctx.lineTo(canvas.width - 24, 72);
  ctx.stroke();

  // Subtitle telemetry stats
  ctx.fillStyle = borderColor;
  ctx.font = '500 24px "JetBrains Mono", monospace';
  ctx.fillText(subtitle, 24, 94);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const spriteMat = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });

  const sprite = new THREE.Sprite(spriteMat);
  sprite.scale.set(12, 3.75, 1);
  return sprite;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// OBJECT BUILDERS WITH REALISTIC DEFINITION & VIBRANT REAL-LIFE COLORS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function buildObject3D(target: DetectedTarget, accent: string): THREE.Group {
  const root = new THREE.Group();
  root.name = target.id;
  const isWildlife = target.type === 'wildlife';
  const targetColor = target.realColorHex;

  const modelGroup = new THREE.Group();

  switch (target.className) {
    case 'Ghost Fishing Net': {
      // Realistic braided netting with floats and weights
      const netMat = new THREE.MeshStandardMaterial({
        color: 0x1e5a2b, // dark nylon green
        roughness: 0.9,
        wireframe: true,
      });
      const netMesh = new THREE.Mesh(new THREE.TorusKnotGeometry(2.4, 0.8, 64, 16, 2, 3), netMat);
      modelGroup.add(netMesh);

      // Bright safety-orange buoys / floats
      const floatMat = new THREE.MeshStandardMaterial({ color: 0xff6600, roughness: 0.3 });
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const fl = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 12), floatMat);
        fl.position.set(Math.cos(angle) * 3.4, 1.2 + Math.sin(i) * 0.4, Math.sin(angle) * 3.4);
        modelGroup.add(fl);
      }

      // Lead line sinkers (dark metallic cylinders)
      const sinkerMat = new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.8, roughness: 0.3 });
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        const sk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.6, 8), sinkerMat);
        sk.position.set(Math.cos(angle) * 2.8, -1.8, Math.sin(angle) * 2.8);
        modelGroup.add(sk);
      }
      break;
    }

    case 'PET Bottle Cluster': {
      // Distinct realistic bottles: translucent cyan bodies + white/red caps
      const bottleMat = new THREE.MeshPhysicalMaterial({
        color: 0x67e8f9,
        roughness: 0.1,
        transmission: 0.85,
        opacity: 0.85,
        transparent: true,
        ior: 1.33,
      });
      const capMatRed = new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.4 });
      const capMatWhite = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4 });

      for (let i = 0; i < 9; i++) {
        const bGroup = new THREE.Group();
        const bBody = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.22, 1.4, 10), bottleMat);
        const bCap = new THREE.Mesh(
          new THREE.CylinderGeometry(0.14, 0.14, 0.18, 8),
          i % 2 === 0 ? capMatRed : capMatWhite
        );
        bCap.position.y = 0.75;
        bGroup.add(bBody, bCap);

        bGroup.position.set(
          (Math.random() - 0.5) * 3.0,
          (Math.random() - 0.5) * 0.6,
          (Math.random() - 0.5) * 3.0
        );
        bGroup.rotation.set(Math.random() * 1.5, Math.random() * 3.0, Math.random() * 1.5);
        modelGroup.add(bGroup);
      }
      break;
    }

    case 'Corroded Oil Drum': {
      // 55-gal barrel with rust, metal rims, and yellow biohazard warning stripe
      const drumMat = new THREE.MeshStandardMaterial({
        color: 0x9a3412, // rusted corten orange
        roughness: 0.8,
        metalness: 0.5,
      });
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 2.6, 18), drumMat);

      // Steel reinforcement chimes/rims
      const chimeMat = new THREE.MeshStandardMaterial({ color: 0x431407, metalness: 0.6, roughness: 0.6 });
      [-0.8, 0, 0.8].forEach(y => {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1.03, 0.08, 8, 24), chimeMat);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = y;
        drum.add(ring);
      });

      // Biohazard warning stripe
      const stripeMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.4 });
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(1.01, 1.01, 0.45, 18), stripeMat);
      drum.add(stripe);

      modelGroup.add(drum);
      break;
    }

    case 'Industrial Heavy Tire': {
      // Matte vulcanized rubber tire with realistic tread geometry
      const tireMat = new THREE.MeshStandardMaterial({
        color: 0x1c1917, // deep tire black
        roughness: 0.95,
        metalness: 0.05,
      });
      const tire = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.6, 16, 32), tireMat);
      tire.rotation.x = Math.PI / 2;

      // Radial tread blocks
      const treadMat = new THREE.MeshStandardMaterial({ color: 0x09090b, roughness: 0.9 });
      for (let i = 0; i < 16; i++) {
        const angle = (i / 16) * Math.PI * 2;
        const tread = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.22, 0.35), treadMat);
        tread.position.set(Math.cos(angle) * 1.95, Math.sin(angle) * 1.95, 0);
        tread.rotation.z = angle;
        tire.add(tread);
      }
      modelGroup.add(tire);
      break;
    }

    case '20ft Intermodal Container': {
      // Realistic ISO container: Red painted corrugated steel with white corner castings
      const containerMat = new THREE.MeshStandardMaterial({
        color: 0xb91c1c, // maritime red
        roughness: 0.5,
        metalness: 0.4,
      });
      const body = new THREE.Mesh(new THREE.BoxGeometry(6.2, 2.6, 2.5), containerMat);

      // Corrugation ribs
      const ribMat = new THREE.MeshStandardMaterial({ color: 0x991b1b, roughness: 0.6, metalness: 0.4 });
      for (let x = -2.8; x <= 2.8; x += 0.4) {
        const rib = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.45, 2.54), ribMat);
        rib.position.x = x;
        body.add(rib);
      }

      // Corner casting blocks
      const cornerMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, metalness: 0.7, roughness: 0.3 });
      [
        [-3.1, 1.3, 1.25], [3.1, 1.3, 1.25], [-3.1, -1.3, 1.25], [3.1, -1.3, 1.25],
        [-3.1, 1.3, -1.25], [3.1, 1.3, -1.25], [-3.1, -1.3, -1.25], [3.1, -1.3, -1.25]
      ].forEach(([cx, cy, cz]) => {
        const block = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), cornerMat);
        block.position.set(cx, cy, cz);
        body.add(block);
      });

      modelGroup.add(body);
      break;
    }

    case 'Braided Hawser Rope Coil': {
      // Golden-brown hemp rope coil with frayed strands
      const ropeMat = new THREE.MeshStandardMaterial({
        color: 0xd97706, // golden rope
        roughness: 0.9,
      });
      for (let i = 0; i < 5; i++) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1.2 + i * 0.25, 0.16, 8, 32), ropeMat);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = i * 0.15;
        modelGroup.add(ring);
      }
      break;
    }

    case 'Bluefin Tuna School': {
      // High-definition marine life: sleek torpedo fish with dorsal fin and swimming motion
      const fishMat = new THREE.MeshStandardMaterial({
        color: 0x2563eb,
        metalness: 0.8,
        roughness: 0.2,
      });
      const bellyMat = new THREE.MeshStandardMaterial({
        color: 0xe0f2fe,
        metalness: 0.6,
        roughness: 0.25,
      });

      for (let i = 0; i < 6; i++) {
        const fish = new THREE.Group();
        // Body
        const body = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.8, 12), fishMat);
        body.rotation.z = -Math.PI / 2;
        body.scale.set(1, 1, 0.5);

        // Tail
        const tail = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.6, 3), fishMat);
        tail.position.x = -1.1;
        tail.rotation.z = Math.PI / 2;
        tail.scale.set(1, 0.2, 1);

        fish.add(body, tail);
        fish.position.set(
          (i - 3) * 1.2 + (Math.random() - 0.5) * 0.6,
          (Math.random() - 0.5) * 0.8,
          (i % 3) * 1.5 + (Math.random() - 0.5) * 0.6
        );
        fish.userData.isFish = true;
        fish.userData.offset = i;
        modelGroup.add(fish);
      }
      break;
    }

    case 'Oceanic Manta Ray': {
      // Realistic manta ray with wide wings and trailing tail
      const rayMat = new THREE.MeshStandardMaterial({
        color: 0x0f172a, // dark dorsal
        roughness: 0.3,
        metalness: 0.4,
      });
      const bellyMat = new THREE.MeshStandardMaterial({
        color: 0xf8fafc, // white belly
        roughness: 0.4,
      });

      const wingShape = new THREE.Shape();
      wingShape.moveTo(0, 2.0); // Head
      wingShape.quadraticCurveTo(2.8, 0.5, 4.0, 0); // Right wing tip
      wingShape.quadraticCurveTo(2.0, -1.0, 0.4, -2.0); // Right pelvic
      wingShape.lineTo(0, -2.2); // Tail base
      wingShape.lineTo(-0.4, -2.0); // Left pelvic
      wingShape.quadraticCurveTo(-2.0, -1.0, -4.0, 0); // Left wing tip
      wingShape.quadraticCurveTo(-2.8, 0.5, 0, 2.0); // Back to head

      const rayGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.35, bevelEnabled: true, bevelSize: 0.1 });
      const ray = new THREE.Mesh(rayGeo, rayMat);
      ray.rotation.x = -Math.PI / 2;
      ray.position.y = 0;

      // Whip tail
      const tail = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.01, 3.5, 6),
        new THREE.MeshStandardMaterial({ color: 0x0f172a })
      );
      tail.position.set(0, 0, 3.2);
      tail.rotation.x = Math.PI / 2;
      ray.add(tail);

      modelGroup.add(ray);
      modelGroup.userData.isManta = true;
      break;
    }

    default: {
      const fallback = new THREE.Mesh(
        new THREE.DodecahedronGeometry(1.2),
        new THREE.MeshStandardMaterial({ color: targetColor, roughness: 0.5 })
      );
      modelGroup.add(fallback);
    }
  }

  root.add(modelGroup);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // CRITICAL DEPTH PERCEPTION UPGRADES:
  // 1) Vertical plumb-line laser dropping straight to seabed floor
  // 2) Circular benthic shadow contact ring on seabed
  // 3) Water surface projection beacon ring
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  const depthColor = new THREE.Color(isWildlife ? '#10b981' : targetColor);

  // Surface beacon ring (at y = 0)
  const surfaceRingGeo = new THREE.RingGeometry(1.6, 1.85, 32);
  const surfaceRingMat = new THREE.MeshBasicMaterial({
    color: depthColor,
    transparent: true,
    opacity: 0.45,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const surfaceRing = new THREE.Mesh(surfaceRingGeo, surfaceRingMat);
  surfaceRing.rotation.x = -Math.PI / 2;
  surfaceRing.position.set(0, -target.position.y + 0.1, 0); // Always sits at y=0 world
  root.add(surfaceRing);

  // Vertical plumb line extending from surface to object, down to seabed (-24m)
  const plumbPoints = [
    new THREE.Vector3(0, -target.position.y, 0), // at surface (world Y = 0)
    new THREE.Vector3(0, 0, 0),                  // at object center
    new THREE.Vector3(0, -24 - target.position.y, 0) // at seabed (world Y = -24)
  ];
  const plumbGeo = new THREE.BufferGeometry().setFromPoints(plumbPoints);
  const plumbMat = new THREE.LineDashedMaterial({
    color: depthColor,
    transparent: true,
    opacity: 0.35,
    dashSize: 0.8,
    gapSize: 0.4,
  });
  const plumbLine = new THREE.Line(plumbGeo, plumbMat);
  plumbLine.computeLineDistances();
  root.add(plumbLine);

  // Seabed floor contact shadow
  const shadowGeo = new THREE.RingGeometry(2.0, 2.4, 32);
  const shadowMat = new THREE.MeshBasicMaterial({
    color: depthColor,
    transparent: true,
    opacity: 0.3,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
  shadowMesh.rotation.x = -Math.PI / 2;
  shadowMesh.position.set(0, -24 - target.position.y + 0.2, 0);
  root.add(shadowMesh);

  // Object tracking aura / ring
  const auraGeo = new THREE.RingGeometry(3.2, 3.45, 48);
  const auraMat = new THREE.MeshBasicMaterial({
    color: depthColor,
    transparent: true,
    opacity: 0.6,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const aura = new THREE.Mesh(auraGeo, auraMat);
  aura.rotation.x = -Math.PI / 2;
  aura.userData.isAura = true;
  root.add(aura);

  // HUD Tactical Sprite
  const spriteText = `${target.confidence.toFixed(1)}% CONF · ${target.distance.toFixed(0)}m · ▼${target.depth.toFixed(1)}m`;
  const sprite = createTacticalSprite(
    target.className,
    spriteText,
    isWildlife ? '#10b981' : targetColor,
    target.risk
  );
  sprite.position.set(0, 5.2, 0);
  root.add(sprite);

  // Speed vector arrow
  if (target.speed > 0.1) {
    const bearingRad = (target.bearing * Math.PI) / 180;
    const arrowDir = new THREE.Vector3(Math.sin(bearingRad), 0, -Math.cos(bearingRad));
    const arrow = new THREE.ArrowHelper(
      arrowDir,
      new THREE.Vector3(0, 0.4, 0),
      Math.min(target.speed * 2.5, 8),
      depthColor.getHex(),
      1.0,
      0.5
    );
    root.add(arrow);
  }

  // Set world position
  root.position.set(target.position.x, target.position.y, target.position.z);
  return root;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RESEARCH VESSEL MODEL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function buildAutonomousVessel(accent: string): THREE.Group {
  const v = new THREE.Group();
  v.name = 'RESEARCH_VESSEL';

  // Catamaran twin-hull architecture
  const hullShape = new THREE.Shape();
  hullShape.moveTo(0, -7.5);
  hullShape.bezierCurveTo(1.6, -6.0, 1.8, -2.0, 1.6, 2.0);
  hullShape.bezierCurveTo(1.4, 5.0, 0.8, 7.0, 0, 8.0);
  hullShape.bezierCurveTo(-0.8, 7.0, -1.4, 5.0, -1.6, 2.0);
  hullShape.bezierCurveTo(-1.8, -2.0, -1.6, -6.0, 0, -7.5);

  const hullGeo = new THREE.ExtrudeGeometry(hullShape, {
    depth: 2.2,
    bevelEnabled: true,
    bevelSize: 0.3,
    bevelThickness: 0.2,
  });

  const hullMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    metalness: 0.7,
    roughness: 0.3,
  });

  // Port Hull
  const portHull = new THREE.Mesh(hullGeo, hullMat);
  portHull.rotation.x = -Math.PI / 2;
  portHull.position.set(-3.2, 0.4, 0);
  portHull.castShadow = true;

  // Starboard Hull
  const stbHull = new THREE.Mesh(hullGeo, hullMat);
  stbHull.rotation.x = -Math.PI / 2;
  stbHull.position.set(3.2, 0.4, 0);
  stbHull.castShadow = true;

  v.add(portHull, stbHull);

  // Center Deck Bridge connecting both hulls
  const bridgeMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    metalness: 0.5,
    roughness: 0.4,
  });
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(6.4, 1.0, 11.0), bridgeMat);
  bridge.position.set(0, 1.6, -0.5);
  bridge.castShadow = true;
  v.add(bridge);

  // Command superstructure
  const superMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    roughness: 0.2,
    metalness: 0.3,
  });
  const superstructure = new THREE.Mesh(new THREE.BoxGeometry(4.4, 2.6, 5.5), superMat);
  superstructure.position.set(0, 3.2, 0.2);
  v.add(superstructure);

  // Wraparound bridge tinted sensor canopy
  const canopyMat = new THREE.MeshStandardMaterial({
    color: 0x00d4ff,
    roughness: 0.05,
    metalness: 0.9,
    emissive: 0x003366,
    emissiveIntensity: 0.6,
  });
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(4.44, 0.9, 2.5), canopyMat);
  canopy.position.set(0, 3.6, 2.2);
  v.add(canopy);

  // Sensor mast with spinning radar
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.18, 4.5, 8),
    new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.8, roughness: 0.2 })
  );
  mast.position.set(0, 6.5, 0.2);
  v.add(mast);

  // Radar dome / bar
  const radarBar = new THREE.Mesh(
    new THREE.BoxGeometry(3.2, 0.15, 0.4),
    new THREE.MeshStandardMaterial({ color: 0xf8fafc, metalness: 0.5 })
  );
  radarBar.position.set(0, 8.6, 0.2);
  radarBar.userData.isRadar = true;
  v.add(radarBar);

  // Dual Starlink & satellite domes
  const domeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 });
  const dome1 = new THREE.Mesh(new THREE.SphereGeometry(0.65, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
  dome1.position.set(-1.3, 4.5, -1.6);
  const dome2 = new THREE.Mesh(new THREE.SphereGeometry(0.65, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
  dome2.position.set(1.3, 4.5, -1.6);
  v.add(dome1, dome2);

  // Navigation lights (Port red, Starboard green, Mast white, Stern amber)
  const navPort = new THREE.PointLight(0xef4444, 2.5, 15);
  navPort.position.set(-3.5, 2.6, 3.5);
  const navPortMesh = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), new THREE.MeshBasicMaterial({ color: 0xef4444 }));
  navPort.add(navPortMesh);

  const navStb = new THREE.PointLight(0x10b981, 2.5, 15);
  navStb.position.set(3.5, 2.6, 3.5);
  const navStbMesh = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), new THREE.MeshBasicMaterial({ color: 0x10b981 }));
  navStb.add(navStbMesh);

  const navStern = new THREE.PointLight(0xf59e0b, 1.8, 12);
  navStern.position.set(0, 2.8, -5.8);
  const navSternMesh = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), new THREE.MeshBasicMaterial({ color: 0xf59e0b }));
  navStern.add(navSternMesh);

  v.add(navPort, navStb, navStern);

  // Sonar emitter ring on keel
  const sonarRing = new THREE.Mesh(
    new THREE.TorusGeometry(5.5, 0.15, 8, 64),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(accent), transparent: true, opacity: 0.6 })
  );
  sonarRing.rotation.x = -Math.PI / 2;
  sonarRing.position.y = 0.1;
  sonarRing.userData.isSonarPulse = true;
  v.add(sonarRing);

  return v;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// COMPONENT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export default function Monitoring() {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    water: THREE.Mesh;
    seabed: THREE.Mesh;
    vessel: THREE.Group;
    sweep: THREE.Group;
    targetGroups: THREE.Group[];
    causticLight: THREE.PointLight;
    animId: number;
  } | null>(null);

  const [mode, setMode] = useState<ViewMode>('OPTICAL');
  const [targets, setTargets] = useState<DetectedTarget[]>(INITIAL_TARGETS);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>('TRK-1042');
  const [showTelemetry, setShowTelemetry] = useState(() => typeof window === 'undefined' || window.innerWidth >= 1024);
  const [showPanel, setShowPanel] = useState(true);
  const [filterType, setFilterType] = useState<'all' | 'debris' | 'wildlife'>('all');

  // Vessel live telemetry
  const [vesselSpeed, setVesselSpeed] = useState(4.6);
  const [vesselHeading, setVesselHeading] = useState(48);
  const [depthSounder, setDepthSounder] = useState(24.2);

  // Direct DOM refs to avoid 60fps React re-renders
  const fpsSpanRef = useRef<HTMLSpanElement>(null);
  const scanAngleTextRef = useRef<HTMLDivElement>(null);
  const scanSubTextRef = useRef<HTMLSpanElement>(null);
  const scanBarRef = useRef<HTMLDivElement>(null);
  const fpsRef = useRef({ frames: 0, lastTime: performance.now() });

  const targetsRef = useRef(targets);
  targetsRef.current = targets;

  const filteredTargets = useMemo(() => {
    if (filterType === 'all') return targets;
    return targets.filter(t => t.type === filterType);
  }, [targets, filterType]);

  // ── Build / Rebuild Three.js scene ─────────────────────────────────────────
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || (window.innerHeight - 56);
    const cfg = MODE_CONFIG[mode];
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Renderer
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, width < 768 ? 1 : 1.25));
    renderer.shadowMap.enabled = false;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = mode === 'OPTICAL' ? 1.35 : 1.1;
    container.appendChild(renderer.domElement);

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(cfg.skyColor);
    scene.fog = new THREE.FogExp2(cfg.fogColor, cfg.fogDensity);

    // Camera (Tesla-style high-angle chase perspective)
    const camera = new THREE.PerspectiveCamera(52, width / height, 0.1, 800);
    camera.position.set(38, 32, 48);

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 6;
    controls.maxDistance = 220;
    controls.maxPolarAngle = Math.PI * 0.88; // Don't look fully from underneath the world
    controls.target.set(0, -1, 0);

    // ── Lighting Architecture ──────────────────────────────────────────────
    const ambientLight = new THREE.AmbientLight(cfg.ambientLightColor, cfg.ambientIntensity);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xfffaed, cfg.sunIntensity);
    sunLight.position.set(50, 90, 40);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(1024, 1024);
    sunLight.shadow.camera.near = 10;
    sunLight.shadow.camera.far = 250;
    sunLight.shadow.camera.left = -90;
    sunLight.shadow.camera.right = 90;
    sunLight.shadow.camera.top = 90;
    sunLight.shadow.camera.bottom = -90;
    sunLight.shadow.bias = -0.0005;
    scene.add(sunLight);

    // Dynamic underwater caustic point light
    const causticLight = new THREE.PointLight(
      mode === 'OPTICAL' ? 0x38bdf8 : new THREE.Color(cfg.accent).getHex(),
      cfg.showCaustics ? 2.5 : 0.8,
      80
    );
    causticLight.position.set(0, -6, 0);
    scene.add(causticLight);

    // ── Water Surface Mesh (High Resolution Grid for Live Waves) ───────────
    const waterGeo = new THREE.PlaneGeometry(280, 280, width < 768 ? 48 : 64, width < 768 ? 48 : 64);
    const waterMat = new THREE.MeshStandardMaterial({
      color: cfg.waterColor,
      roughness: cfg.waterRoughness,
      metalness: 0.08,
      opacity: cfg.waterOpacity,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0;
    water.receiveShadow = false;
    scene.add(water);

    // ── Seabed Benthic Terrain ──────────────────────────────────────────────
    const seabed = createSeabedMesh(280, width < 768 ? 64 : 96, mode, cfg.accent);
    scene.add(seabed);

    // ── Autonomous Research Vessel ──────────────────────────────────────────
    const vessel = buildAutonomousVessel(cfg.accent);
    scene.add(vessel);

    // ── Range Rings at 25m, 50m, 75m, 100m ──────────────────────────────────
    const rangeGroup = new THREE.Group();
    [25, 50, 75, 100].forEach(r => {
      const ringMesh = new THREE.Mesh(
        new THREE.RingGeometry(r - 0.1, r + 0.1, 72),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(cfg.accent),
          transparent: true,
          opacity: 0.18,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      );
      ringMesh.rotation.x = -Math.PI / 2;
      ringMesh.position.y = 0.08;
      rangeGroup.add(ringMesh);

      // Range text markers
      const marker = createTacticalSprite(`${r}m`, 'RANGE DATUM', cfg.accent);
      marker.position.set(r, 1.2, 0);
      marker.scale.set(4.0, 1.25, 1);
      rangeGroup.add(marker);
    });

    // Compass cardinal labels
    const cardinals = [
      { t: 'N', a: 0 },
      { t: 'E', a: Math.PI / 2 },
      { t: 'S', a: Math.PI },
      { t: 'W', a: -Math.PI / 2 },
    ];
    cardinals.forEach(({ t, a }) => {
      const s = createTacticalSprite(t, 'BEARING', '#ffffff');
      s.position.set(Math.sin(a) * 98, 2.0, -Math.cos(a) * 98);
      s.scale.set(4.5, 1.4, 1);
      rangeGroup.add(s);
    });
    scene.add(rangeGroup);

    // ── Rotating Radar / Sonar Sweep Fan ────────────────────────────────────
    const sweep = new THREE.Group();
    const fanGeo = new THREE.ConeGeometry(95, 0.2, 64, 1, true, 0, Math.PI / 5);
    const fanMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(cfg.accent),
      transparent: true,
      opacity: 0.08,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const fan = new THREE.Mesh(fanGeo, fanMat);
    fan.rotation.x = Math.PI / 2;
    fan.rotation.z = Math.PI / 2;
    fan.position.y = 0.2;
    sweep.add(fan);

    const sweepLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.2, 0), new THREE.Vector3(95, 0.2, 0)]),
      new THREE.LineBasicMaterial({ color: new THREE.Color(cfg.accent), transparent: true, opacity: 0.6 })
    );
    sweep.add(sweepLine);
    scene.add(sweep);

    // ── Detected Targets (Debris & Marine Wildlife) ──────────────────────────
    const targetGroups: THREE.Group[] = [];
    targets.forEach(t => {
      const tg = buildObject3D(t, cfg.accent);
      scene.add(tg);
      targetGroups.push(tg);
    });

    // ── Floating Plankton / Bubble Particles ────────────────────────────────
    const pCount = width < 768 ? 160 : 280;
    const pGeo = new THREE.BufferGeometry();
    const pPos = new Float32Array(pCount * 3);
    for (let i = 0; i < pCount; i++) {
      pPos[i * 3]     = (Math.random() - 0.5) * 220;
      pPos[i * 3 + 1] = -Math.random() * 23; // In water column between 0 and -23m
      pPos[i * 3 + 2] = (Math.random() - 0.5) * 220;
    }
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    const pMat = new THREE.PointsMaterial({
      color: mode === 'OPTICAL' ? 0x93c5fd : new THREE.Color(cfg.accent).getHex(),
      size: 0.35,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    const particles = new THREE.Points(pGeo, pMat);
    scene.add(particles);

    const animationStartedAt = performance.now();
    fpsRef.current = { frames: 0, lastTime: performance.now() };
    if (fpsSpanRef.current) fpsSpanRef.current.textContent = '-- FPS';

    // ── Animation Loop ───────────────────────────────────────────────────────
    let animId = 0;
    let frameCount = 0;
    let lastRenderTime = 0;
    const animate = (timestamp = 0) => {
      animId = requestAnimationFrame(animate);
      if (document.hidden || (prefersReducedMotion && timestamp - lastRenderTime < 80)) return;
      lastRenderTime = timestamp;
      frameCount += 1;
      const t = (timestamp - animationStartedAt) / 1000;

      // FPS tracking via direct DOM update (zero React re-renders)
      fpsRef.current.frames++;
      const now = performance.now();
      if (now - fpsRef.current.lastTime >= 1000) {
        if (fpsSpanRef.current) {
          fpsSpanRef.current.textContent = `${fpsRef.current.frames} FPS`;
        }
        fpsRef.current.frames = 0;
        fpsRef.current.lastTime = now;
      }

      // ── Animate live sea waves on water mesh ──────────────────────────────
      const wPos = water.geometry.attributes.position;
      const count = wPos.count;
      for (let i = 0; i < count; i++) {
        const x = wPos.getX(i);
        const y = wPos.getY(i);

        let wave = 0;
        // Primary ocean swell
        wave += Math.sin(x * 0.045 + t * 0.85) * 0.65;
        wave += Math.sin(y * 0.065 + t * 0.65) * 0.50;
        // Secondary cross-chop
        wave += Math.sin(x * 0.12 + y * 0.09 + t * 1.4) * 0.22;
        wave += Math.cos(x * 0.08 - y * 0.11 + t * 1.1) * 0.18;
        // Micro surface capillary ripples
        wave += Math.sin(x * 0.28 + t * 2.5) * 0.08;

        wPos.setZ(i, wave);
      }
      wPos.needsUpdate = true;
      if (frameCount % 8 === 0) water.geometry.computeVertexNormals();

      // ── Vessel realistic roll, pitch & radar rotation ────────────────────
      if (!prefersReducedMotion) {
        vessel.position.y = Math.sin(t * 0.5) * 0.35 + 0.35;
        vessel.rotation.x = Math.sin(t * 0.3) * 0.025; // pitch
        vessel.rotation.z = Math.sin(t * 0.4 + 0.5) * 0.02; // roll
      }

      vessel.children.forEach(c => {
        if (c.userData.isRadar) {
          c.rotation.y = t * 2.8;
        }
        if (c.userData.isSonarPulse) {
          const pulse = 1.0 + (Math.sin(t * 2.4) * 0.5 + 0.5) * 0.25;
          c.scale.set(pulse, pulse, 1);
        }
      });

      // ── Sonar sweep sweep-line rotation (direct DOM update, zero React re-renders) ──
      sweep.rotation.y = t * 0.8;
      const sweepDeg = Math.round((((sweep.rotation.y * 180) / Math.PI) % 360 + 360) % 360);
      if (scanAngleTextRef.current) scanAngleTextRef.current.textContent = `${sweepDeg}° BEARING`;
      if (scanSubTextRef.current) scanSubTextRef.current.textContent = `${sweepDeg}°`;
      if (scanBarRef.current) scanBarRef.current.style.width = `${(sweepDeg / 360) * 100}%`;

      // ── Dynamic caustics light swimming ──────────────────────────────────
      causticLight.position.x = Math.sin(t * 0.35) * 18;
      causticLight.position.z = Math.cos(t * 0.28) * 18;
      causticLight.intensity = (cfg.showCaustics ? 2.5 : 0.8) + Math.sin(t * 1.8) * 0.4;

      // ── Target objects animation & wildlife swimming ─────────────────────
      const currentTargetList = targetsRef.current;
      targetGroups.forEach((group, i) => {
        const item = currentTargetList[i];
        if (!item) return;

        // Gentle tidal drift
        group.position.x = item.position.x + Math.sin(t * 0.3 + i * 1.5) * 1.6;
        group.position.z = item.position.z + Math.cos(t * 0.25 + i * 1.2) * 1.6;

        // Surface objects bob with waves
        if (item.depth < 2.5) {
          group.position.y = item.position.y + Math.sin(t * 0.8 + i) * 0.45;
        }

        // Pulse tracking aura
        group.children.forEach(c => {
          if (c.userData.isAura) {
            const auraScale = 1.0 + (Math.sin(t * 2.0 + i) * 0.5 + 0.5) * 0.3;
            c.scale.set(auraScale, auraScale, 1);
          }
        });

        // Animate fish school & manta ray fins
        const modelContainer = group.children[0];
        if (modelContainer) {
          modelContainer.children.forEach(child => {
            if (child.userData.isFish) {
              const fOffset = child.userData.offset || 0;
              child.rotation.y = Math.sin(t * 3.5 + fOffset) * 0.2;
            }
          });
          if (modelContainer.userData.isManta) {
            modelContainer.rotation.z = Math.sin(t * 1.4) * 0.15; // Wing flap tilt
          }
        }
      });

      // ── Plankton bubble drift ────────────────────────────────────────────
      const pAttr = particles.geometry.attributes.position;
      for (let i = 0; i < pCount; i++) {
        let py = pAttr.getY(i);
        py += Math.sin(t + i * 0.2) * 0.02 + 0.005; // Upward buoyant drift
        if (py > 0) py = -23;
        pAttr.setY(i, py);
        pAttr.setX(i, pAttr.getX(i) + Math.sin(t * 0.4 + i) * 0.01);
      }
      pAttr.needsUpdate = true;

      controls.update();
      renderer.render(scene, camera);
    };

    animate();

    // Resize handler
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    sceneRef.current = {
      renderer, scene, camera, controls, water, seabed, vessel,
      sweep, targetGroups, causticLight, animId
    };

    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(animId);
      scene.traverse(object => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose?.();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach(item => item.dispose());
        else material?.dispose?.();
      });
      renderer.dispose();
      renderer.forceContextLoss();
      scene.clear();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      sceneRef.current = null;
    };
  }, [mode]);

  // ── Camera Presets (Tesla FSD Chase, Top-Down, Subsea ROV) ─────────────────
  const setCameraPreset = useCallback((preset: 'chase' | 'top' | 'subsea' | 'orbit') => {
    const s = sceneRef.current;
    if (!s) return;
    const { camera, controls } = s;

    switch (preset) {
      case 'chase': // Behind vessel looking forward
        camera.position.set(0, 14, -34);
        controls.target.set(0, 2, 20);
        break;
      case 'top': // 2D Radar overview
        camera.position.set(0, 110, 0.1);
        controls.target.set(0, 0, 0);
        break;
      case 'subsea': // Benthic underwater view
        camera.position.set(16, -14, 28);
        controls.target.set(0, -16, 0);
        break;
      case 'orbit': // Tactical diagonal perspective
      default:
        camera.position.set(38, 32, 48);
        controls.target.set(0, -1, 0);
        break;
    }
    controls.update();
  }, []);

  // ── Simulated live updates for distance, bearing & confidence ──────────────
  useEffect(() => {
    const timer = setInterval(() => {
      setVesselSpeed(4.5 + Math.sin(Date.now() / 3000) * 0.3);
      setVesselHeading(h => (h + (Math.random() * 1.2 - 0.6) + 360) % 360);
      setDepthSounder(d => Math.max(18, +(d + (Math.random() * 0.4 - 0.2)).toFixed(1)));

      setTargets(prev =>
        prev.map(item => ({
          ...item,
          distance: Math.max(8, +(item.distance + (Math.random() * 0.8 - 0.4)).toFixed(1)),
          speed: Math.max(0, +(item.speed + (Math.random() * 0.1 - 0.05)).toFixed(1)),
          confidence: Math.min(99.4, Math.max(72.0, +(item.confidence + (Math.random() * 0.6 - 0.3)).toFixed(1))),
        }))
      );
    }, 2500);

    return () => clearInterval(timer);
  }, []);

  const cfg = MODE_CONFIG[mode];

  return (
    <div className="relative w-full h-[calc(100dvh-64px)] bg-[#020611] overflow-hidden select-none font-sans text-slate-100">
      {/* ── 3D Canvas Mount ─────────────────────────────────────────────────── */}
      <div ref={mountRef} role="img" aria-label="Interactive 3D marine monitoring scene" className="absolute inset-0 z-0 cursor-grab active:cursor-grabbing" />

      {/* ── Top-Center: Multi-Mode Selector (Tesla Autopilot Mode Bar) ──────── */}
      <div className="absolute left-3 right-3 top-3 z-20 flex items-center gap-1.5 overflow-x-auto rounded-2xl border border-white/10 bg-slate-950/85 p-1.5 shadow-2xl shadow-cyan-950/30 backdrop-blur-xl lg:left-1/2 lg:right-auto lg:-translate-x-1/2">
        {(Object.keys(MODE_CONFIG) as ViewMode[]).map(m => {
          const item = MODE_CONFIG[m];
          const Icon = item.icon;
          const isActive = mode === m;
          return (
            <button
              key={m}
              onClick={() => setMode(m)}
              aria-pressed={isActive}
              className={`flex flex-shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-[10px] font-mono font-bold tracking-wider transition-all cursor-pointer sm:px-4 sm:text-xs ${
                isActive
                  ? `${item.themeClass} shadow-lg shadow-cyan-500/10`
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{item.name.toUpperCase()}</span>
            </button>
          );
        })}
      </div>

      {/* ── Top-Left: Active Mode Telemetry & System Health ─────────────────── */}
      <div className="absolute left-3 top-16 z-20 max-w-sm space-y-2 sm:left-4">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-950/85 backdrop-blur-xl border border-white/10 shadow-xl">
            <span className="w-2.5 h-2.5 rounded-full animate-ping" style={{ background: cfg.accent }} />
            <span className="text-xs font-mono font-bold tracking-widest uppercase" style={{ color: cfg.accent }}>
              LIVE 3D RADAR ACTIVE
            </span>
          </div>

          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-950/85 backdrop-blur-xl border border-white/10">
            <Activity className="w-3.5 h-3.5 text-emerald-400" />
            <span ref={fpsSpanRef} className="text-xs font-mono font-bold text-emerald-400">-- FPS</span>
          </div>
        </div>

        <div className="hidden px-3.5 py-2 rounded-xl bg-slate-950/75 backdrop-blur-xl border border-white/10 sm:block">
          <div className="text-[11px] font-mono text-slate-300 font-medium leading-relaxed">
            {cfg.tagline}
          </div>
        </div>
      </div>

      {/* ── Top-Right: Camera Presets (Tesla Surround Vision Angles) ───────── */}
      <div className="absolute right-[26rem] top-16 z-20 hidden flex-col gap-1.5 xl:flex">
        {[
          { id: 'chase', label: 'Tesla FSD Bow Cam', icon: Navigation },
          { id: 'orbit', label: 'Surround 360° View', icon: Compass },
          { id: 'top',   label: '2D Surface Radar', icon: Radar },
          { id: 'subsea', label: 'Subsea Benthic ROV', icon: Anchor },
        ].map(cam => {
          const Icon = cam.icon;
          return (
            <button
              key={cam.id}
              onClick={() => setCameraPreset(cam.id as any)}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-950/80 backdrop-blur-xl border border-white/10 text-slate-300 hover:text-white hover:border-cyan-500/40 hover:bg-cyan-500/10 transition-all text-xs font-mono shadow-lg cursor-pointer"
            >
              <Icon className="w-3.5 h-3.5 text-cyan-400" />
              <span>{cam.label}</span>
            </button>
          );
        })}
      </div>

      {/* ── Bottom-Left: Live Vessel Telemetry HUD ──────────────────────────── */}
      <div className={`absolute left-3 z-20 sm:left-4 lg:bottom-4 ${showPanel ? 'bottom-[calc(46%+1rem)]' : 'bottom-3'}`}>
        <button
          onClick={() => setShowTelemetry(v => !v)}
          aria-expanded={showTelemetry}
          className="flex items-center gap-1.5 mb-2 px-3 py-1.5 rounded-lg bg-slate-950/80 backdrop-blur-md border border-white/10 text-slate-300 hover:text-white text-xs font-mono cursor-pointer"
        >
          <Gauge className="w-3.5 h-3.5 text-cyan-400" />
          <span>VESSEL SENSORS</span>
          {showTelemetry ? <ChevronDown className="w-3.5 h-3.5 ml-1" /> : <ChevronUp className="w-3.5 h-3.5 ml-1" />}
        </button>

        {showTelemetry && (
          <div className="w-[min(320px,calc(100vw-1.5rem))] space-y-3 rounded-2xl border border-white/10 bg-slate-950/90 p-3 shadow-2xl backdrop-blur-2xl sm:min-w-[280px] sm:p-4">
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'VESSEL SOG', val: `${vesselSpeed.toFixed(1)} kn`, icon: Gauge, color: '#00d4ff' },
                { label: 'GYRO HEADING', val: `${vesselHeading.toFixed(0)}° TRUE`, icon: Compass, color: '#38bdf8' },
                { label: 'SONAR SWEEP', val: '0° BEARING', icon: Radar, color: cfg.accent },
                { label: 'BATHY DEPTH', val: `${depthSounder} m`, icon: Anchor, color: '#a855f7' },
                { label: 'TELEMETRY LINK', val: '5G ULTRA LOW LAT', icon: Wifi, color: '#10b981' },
                { label: 'TARGETS IN ZONE', val: `${targets.length} TRACKED`, icon: Crosshair, color: '#f59e0b' },
              ].map(item => {
                const Icon = item.icon;
                return (
                  <div key={item.label} className="p-2 rounded-xl bg-white/[0.03] border border-white/5">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <Icon className="w-3 h-3" style={{ color: item.color }} />
                      <span className="text-[9px] font-mono text-slate-400 font-bold uppercase">{item.label}</span>
                    </div>
                    <div
                      ref={item.label === 'SONAR SWEEP' ? scanAngleTextRef : undefined}
                      className="text-xs font-mono font-bold text-white tracking-wider"
                    >
                      {item.val}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Sweep Angle Progress Bar */}
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] font-mono text-slate-400">
                <span>360° CONTINUOUS SWEEP</span>
                <span ref={scanSubTextRef} style={{ color: cfg.accent }}>0°</span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                <div
                  ref={scanBarRef}
                  className="h-full rounded-full transition-all duration-75"
                  style={{
                    width: '0%',
                    background: `linear-gradient(90deg, transparent, ${cfg.accent})`,
                  }}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Bottom-Center: Compass & Position Tag ──────────────────────────── */}
      <div className="absolute bottom-4 left-1/2 z-20 hidden -translate-x-1/2 items-center gap-4 rounded-2xl border border-white/10 bg-slate-950/85 px-5 py-2.5 shadow-2xl backdrop-blur-2xl lg:flex">
        <div className="relative w-10 h-10 flex-shrink-0">
          <svg viewBox="0 0 40 40" className="w-full h-full">
            <circle cx="20" cy="20" r="18" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
            <circle cx="20" cy="20" r="12" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="0.5" />
            <text x="20" y="7" textAnchor="middle" fill="#00d4ff" fontSize="6" fontWeight="bold" fontFamily="monospace">N</text>
            <text x="35" y="22" textAnchor="middle" fill="#64748b" fontSize="5" fontFamily="monospace">E</text>
            <text x="20" y="37" textAnchor="middle" fill="#64748b" fontSize="5" fontFamily="monospace">S</text>
            <text x="5" y="22" textAnchor="middle" fill="#64748b" fontSize="5" fontFamily="monospace">W</text>
            <line
              x1="20" y1="20"
              x2={20 + Math.sin((vesselHeading * Math.PI) / 180) * 14}
              y2={20 - Math.cos((vesselHeading * Math.PI) / 180) * 14}
              stroke="#00d4ff"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <circle cx="20" cy="20" r="2" fill="#00d4ff" />
          </svg>
        </div>

        <div className="border-l border-white/10 pl-3">
          <div className="text-[9px] font-mono text-slate-400 uppercase tracking-wider">NAV POSITION</div>
          <div className="text-xs font-mono font-bold text-slate-100">14°12.4' N, 155°48.2' W</div>
        </div>

        <div className="border-l border-white/10 pl-3">
          <div className="text-[9px] font-mono text-slate-400 uppercase tracking-wider">SECTOR</div>
          <div className="text-xs font-mono font-bold text-cyan-400">02 · PACIFIC GYRE</div>
        </div>
      </div>

      {/* ── Right-Side: Tesla-Style Real-World Object Tracking Panel ───────── */}
      <div
        className={`absolute bottom-3 left-3 right-3 z-20 flex h-[46%] flex-col transition-all duration-300 lg:bottom-4 lg:left-auto lg:right-4 lg:top-16 lg:h-auto ${
          showPanel ? 'lg:w-96' : 'left-auto h-12 w-12 lg:h-auto'
        }`}
      >
        <button
          onClick={() => setShowPanel(v => !v)}
          aria-label={showPanel ? 'Hide object classifier' : 'Show object classifier'}
          className="absolute -top-10 right-0 flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-slate-950/90 text-slate-400 shadow-xl backdrop-blur-xl transition-colors hover:text-white lg:-left-10 lg:right-auto lg:top-2"
        >
          {showPanel ? <ChevronDown className="w-4 h-4 rotate-90" /> : <ChevronUp className="w-4 h-4 rotate-90" />}
        </button>

        {showPanel && (
          <div className="h-full rounded-2xl bg-slate-950/90 backdrop-blur-2xl border border-white/10 shadow-2xl flex flex-col overflow-hidden">
            {/* Panel Header */}
            <div className="p-4 border-b border-white/10">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Crosshair className="w-4 h-4 text-cyan-400" />
                  <span className="text-xs font-mono font-bold text-white uppercase tracking-wider">
                    AI OBJECT CLASSIFIER
                  </span>
                </div>
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
                  {filteredTargets.length} DETECTED
                </span>
              </div>

              {/* Filter Tabs */}
              <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-white/[0.04] border border-white/5 text-[10px] font-mono font-bold">
                {[
                  { id: 'all', label: 'ALL TARGETS' },
                  { id: 'debris', label: 'DEBRIS' },
                  { id: 'wildlife', label: 'WILDLIFE' },
                ].map(f => (
                  <button
                    key={f.id}
                    onClick={() => setFilterType(f.id as any)}
                    aria-pressed={filterType === f.id}
                    className={`py-1.5 rounded-lg transition-all cursor-pointer ${
                      filterType === f.id
                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Target List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2.5 scrollbar-thin">
              {filteredTargets.map(item => {
                const isSelected = selectedTargetId === item.id;
                const badge = RISK_BADGE_STYLES[item.risk];
                return (
                  <div
                    key={item.id}
                    onClick={() => setSelectedTargetId(isSelected ? null : item.id)}
                    onKeyDown={event => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedTargetId(isSelected ? null : item.id);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    aria-expanded={isSelected}
                    className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-cyan-950/40 border-cyan-500/60 shadow-lg shadow-cyan-950/40'
                        : 'bg-white/[0.02] border-white/5 hover:border-white/20 hover:bg-white/[0.04]'
                    }`}
                  >
                    {/* Header: Class + Risk */}
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ background: item.realColorHex }}
                        />
                        <span className="text-xs font-semibold text-white tracking-wide">
                          {item.className}
                        </span>
                      </div>
                      <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded-md border ${badge.bg} ${badge.text} ${badge.border}`}>
                        {item.risk}
                      </span>
                    </div>

                    {/* Telemetry 4-Col Grid */}
                    <div className="grid grid-cols-4 gap-1.5 mb-2.5 text-center">
                      <div className="p-1.5 rounded-lg bg-black/40">
                        <div className="text-[8px] font-mono text-slate-400">CONF</div>
                        <div className="text-xs font-mono font-bold text-cyan-300">{item.confidence}%</div>
                      </div>
                      <div className="p-1.5 rounded-lg bg-black/40">
                        <div className="text-[8px] font-mono text-slate-400">DIST</div>
                        <div className="text-xs font-mono font-bold text-slate-200">{item.distance}m</div>
                      </div>
                      <div className="p-1.5 rounded-lg bg-black/40">
                        <div className="text-[8px] font-mono text-slate-400">DEPTH</div>
                        <div className="text-xs font-mono font-bold text-slate-200">▼{item.depth}m</div>
                      </div>
                      <div className="p-1.5 rounded-lg bg-black/40">
                        <div className="text-[8px] font-mono text-slate-400">SPEED</div>
                        <div className="text-xs font-mono font-bold text-slate-200">{item.speed}kn</div>
                      </div>
                    </div>

                    {/* Confidence Progress Bar */}
                    <div className="h-1 rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${item.confidence}%`,
                          background: item.realColorHex,
                        }}
                      />
                    </div>

                    {/* Expanded Detail Box */}
                    {isSelected && (
                      <div className="mt-3 pt-3 border-t border-white/10 space-y-2 text-[11px] font-mono animate-fadeIn">
                        <div className="text-slate-400 leading-relaxed">
                          <span className="text-slate-500 uppercase">Materials: </span>
                          <span className="text-slate-200">{item.materials}</span>
                        </div>
                        <div className="flex justify-between text-slate-400">
                          <span>DIMENSIONS: <strong className="text-white">{item.dimensions}</strong></span>
                          <span>BEARING: <strong className="text-cyan-400">{item.bearing}°</strong></span>
                        </div>
                        <div className="flex items-center justify-between pt-1">
                          <span className="text-slate-500">TRACK ID: {item.id}</span>
                          <span className="text-emerald-400 font-bold flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            LOCKED ON RADAR
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Panel Footer: Summary Counters */}
            <div className="p-4 border-t border-white/10 bg-slate-950/60">
              <div className="grid grid-cols-3 gap-2 text-center font-mono">
                <div className="p-2 rounded-xl bg-rose-500/10 border border-rose-500/20">
                  <div className="text-base font-bold text-rose-400">
                    {targets.filter(t => t.risk === 'CRITICAL').length}
                  </div>
                  <div className="text-[8px] text-slate-400">CRITICAL</div>
                </div>
                <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
                  <div className="text-base font-bold text-amber-400">
                    {targets.filter(t => t.risk === 'HIGH').length}
                  </div>
                  <div className="text-[8px] text-slate-400">HIGH RISK</div>
                </div>
                <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                  <div className="text-base font-bold text-emerald-400">
                    {targets.filter(t => t.type === 'wildlife').length}
                  </div>
                  <div className="text-[8px] text-slate-400">WILDLIFE</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Bottom-Right: Zoom & Reset Controls ────────────────────────────── */}
      <div className="absolute bottom-4 right-4 z-20 hidden flex-col gap-1.5 lg:flex">
        {[
          {
            icon: ZoomIn,
            title: 'Zoom In',
            action: () => {
              const s = sceneRef.current;
              if (s) {
                s.camera.position.multiplyScalar(0.85);
                s.controls.update();
              }
            },
          },
          {
            icon: ZoomOut,
            title: 'Zoom Out',
            action: () => {
              const s = sceneRef.current;
              if (s) {
                s.camera.position.multiplyScalar(1.18);
                s.controls.update();
              }
            },
          },
          {
            icon: RotateCcw,
            title: 'Reset View',
            action: () => setCameraPreset('orbit'),
          },
          {
            icon: Maximize2,
            title: 'Toggle Fullscreen',
            action: () => {
              if (!document.fullscreenElement) {
                mountRef.current?.requestFullscreen?.();
              } else {
                document.exitFullscreen?.();
              }
            },
          },
        ].map((btn, i) => {
          const Icon = btn.icon;
          return (
            <button
              key={i}
              onClick={btn.action}
              title={btn.title}
              aria-label={btn.title}
              className="w-9 h-9 rounded-xl bg-slate-950/80 backdrop-blur-xl border border-white/10 flex items-center justify-center text-slate-400 hover:text-white hover:border-cyan-500/40 hover:bg-cyan-500/10 transition-all cursor-pointer shadow-xl"
            >
              <Icon className="w-4 h-4" />
            </button>
          );
        })}
      </div>

      {/* Subtle CRT scanning vignette */}
      <div
        className="absolute inset-0 pointer-events-none z-10"
        style={{
          background: 'radial-gradient(ellipse at center, transparent 65%, rgba(2, 6, 23, 0.45) 100%)',
        }}
      />
    </div>
  );
}
