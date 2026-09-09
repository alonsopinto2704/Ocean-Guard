import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import * as THREE from 'three';
import {
  Radar, Satellite, Waves, Cpu, Navigation, ArrowUpRight, Send,
  Shield, CheckCircle2, AlertTriangle, Eye, Layers, Compass, Pause, Play
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { SkipLink } from '../components/ui/SkipLink';

const DEBRIS_LOCATIONS = [
  { lat: 28.5, lng: -140.2, risk: 'CRITICAL', label: 'Pacific Gyre Cluster', count: 312 },
  { lat: 14.2, lng: -155.8, risk: 'HIGH', label: 'North Pacific Zone', count: 148 },
  { lat: 35.1, lng: -158.3, risk: 'CRITICAL', label: 'Zone 4 Hotspot', count: 204 },
  { lat: 20.4, lng: 145.6, risk: 'MEDIUM', label: 'Western Pacific', count: 74 },
  { lat: -10.2, lng: -85.4, risk: 'MEDIUM', label: 'Eastern Pacific', count: 52 },
  { lat: 5.8, lng: -110.2, risk: 'LOW', label: 'Central Pacific', count: 28 },
  { lat: 42.1, lng: -130.5, risk: 'HIGH', label: 'Oregon Shelf', count: 98 },
];

function latLngToXYZ(lat: number, lng: number, r: number) {
  const phi   = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  return {
    x:  r * Math.sin(phi) * Math.cos(theta),
    y:  r * Math.cos(phi),
    z: -r * Math.sin(phi) * Math.sin(theta),
  };
}

function GlobeCanvas({ autoRotationPaused }: { autoRotationPaused: boolean }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(autoRotationPaused);
  pausedRef.current = autoRotationPaused;

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
      'Interactive planetary marine debris globe. Drag or use arrow keys to rotate. Pinch, scroll, or use plus and minus to zoom.'
    );
    el.appendChild(renderer.domElement);

    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 1000);
    camera.position.z = 2.8;
    let targetZoom = 2.8;

    // Every surface layer lives in one rig so markers remain geographically
    // attached while the user rotates the planet.
    const globeRig = new THREE.Group();
    globeRig.rotation.set(0.12, -0.38, 0);
    scene.add(globeRig);

    // Globe sphere
    const geo  = new THREE.SphereGeometry(1, 64, 64);
    const mat  = new THREE.MeshPhongMaterial({
      color: 0x081326,
      emissive: 0x030a14,
      specular: 0x00f5d4,
      shininess: 40,
    });
    const globe = new THREE.Mesh(geo, mat);
    globeRig.add(globe);

    // Wireframe overlay
    const wireMat = new THREE.MeshBasicMaterial({
      color: 0x00f5d4,
      wireframe: true,
      transparent: true,
      opacity: 0.08,
    });
    globeRig.add(new THREE.Mesh(new THREE.SphereGeometry(1.002, 36, 36), wireMat));

    // Atmosphere glow
    const atmMat = new THREE.MeshBasicMaterial({
      color: 0x00dfc1,
      transparent: true,
      opacity: 0.12,
      side: THREE.BackSide,
    });
    globeRig.add(new THREE.Mesh(new THREE.SphereGeometry(1.1, 32, 32), atmMat));

    // Lighting
    scene.add(new THREE.AmbientLight(0x0a223a, 2.5));
    const dLight = new THREE.DirectionalLight(0x00f5d4, 2);
    dLight.position.set(3, 2, 2);
    scene.add(dLight);

    const sLight = new THREE.DirectionalLight(0x4cd6fb, 1.2);
    sLight.position.set(-3, -2, -1);
    scene.add(sLight);

    // Debris markers
    const markerVisuals: Array<{ mesh: THREE.Mesh; ring: THREE.Mesh; ringMaterial: THREE.MeshBasicMaterial; phase: number }> = [];
    DEBRIS_LOCATIONS.forEach((d, index) => {
      const pos = latLngToXYZ(d.lat, d.lng, 1.02);
      const color = d.risk === 'CRITICAL' ? 0xff5964 : d.risk === 'HIGH' ? 0xffaa00 : 0x00f5d4;
      const markerSize = 0.018 + Math.min(d.count / 350, 1) * 0.012;
      const mGeo = new THREE.SphereGeometry(markerSize, 12, 12);
      const mMat = new THREE.MeshBasicMaterial({ color });
      const mesh = new THREE.Mesh(mGeo, mMat);
      mesh.position.set(pos.x, pos.y, pos.z);
      globeRig.add(mesh);
      // Pulse ring
      const rGeo = new THREE.RingGeometry(0.03, 0.045, 20);
      const rMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(rGeo, rMat);
      ring.position.set(pos.x, pos.y, pos.z);
      ring.lookAt(0, 0, 0);
      globeRig.add(ring);
      markerVisuals.push({ mesh, ring, ringMaterial: rMat, phase: index * 0.85 });
    });

    // Particle field
    const particleCount = W < 768 ? 700 : 1400;
    const particlePositions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.acos(Math.random() * 2 - 1);
      const r = 1.01 + Math.random() * 0.04;
      particlePositions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
      particlePositions[i * 3 + 1] = r * Math.cos(phi);
      particlePositions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    const pMat = new THREE.PointsMaterial({ color: 0x4cd6fb, size: 0.007, transparent: true, opacity: 0.35 });
    globeRig.add(new THREE.Points(pGeo, pMat));

    // Pointer physics: mouse, pen, and touch share the same interaction model.
    const pointers = new Map<number, { x: number; y: number }>();
    let isDragging = false;
    let prevX = 0;
    let prevY = 0;
    let lastPinchDistance = 0;
    let velocityX = 0;
    let velocityY = 0;
    let hasCanvasFocus = false;

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
          targetZoom = THREE.MathUtils.clamp(targetZoom + (lastPinchDistance - distance) * 0.006, 1.75, 4.4);
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
      pointers.delete(event.pointerId);
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }
      lastPinchDistance = pointers.size > 1 ? pinchDistance() : 0;
      isDragging = pointers.size > 0;
      renderer.domElement.style.cursor = isDragging ? 'grabbing' : 'grab';
      const remaining = pointers.values().next().value as { x: number; y: number } | undefined;
      if (remaining) {
        prevX = remaining.x;
        prevY = remaining.y;
      }
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      targetZoom = THREE.MathUtils.clamp(targetZoom + event.deltaY * 0.0018, 1.75, 4.4);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const rotationStep = 0.09;
      if (event.key === 'ArrowLeft') globeRig.rotation.y -= rotationStep;
      else if (event.key === 'ArrowRight') globeRig.rotation.y += rotationStep;
      else if (event.key === 'ArrowUp') globeRig.rotation.x -= rotationStep;
      else if (event.key === 'ArrowDown') globeRig.rotation.x += rotationStep;
      else if (event.key === '+' || event.key === '=') targetZoom = Math.max(1.75, targetZoom - 0.25);
      else if (event.key === '-' || event.key === '_') targetZoom = Math.min(4.4, targetZoom + 0.25);
      else return;
      event.preventDefault();
      clampTilt();
    };

    const onFocus = () => { hasCanvasFocus = true; };
    const onBlur = () => { hasCanvasFocus = false; };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerEnd);
    renderer.domElement.addEventListener('pointercancel', onPointerEnd);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
    renderer.domElement.addEventListener('keydown', onKeyDown);
    renderer.domElement.addEventListener('focus', onFocus);
    renderer.domElement.addEventListener('blur', onBlur);

    const onResize = () => {
      if (!el) return;
      const W2 = el.clientWidth, H2 = el.clientHeight;
      renderer.setSize(W2, H2);
      camera.aspect = W2 / H2;
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(el);

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let animId: number;
    let lastRender = 0;
    let lastFrame = 0;
    const animate = (timestamp = 0) => {
      animId = requestAnimationFrame(animate);
      if (document.hidden || (reduceMotion && timestamp - lastRender < 100)) return;
      lastRender = timestamp;
      const delta = lastFrame ? Math.min((timestamp - lastFrame) / 16.67, 3) : 1;
      lastFrame = timestamp;

      if (!isDragging && !reduceMotion) {
        const autoSpin = !pausedRef.current && !hasCanvasFocus ? 0.00065 : 0;
        globeRig.rotation.y += (velocityY + autoSpin) * delta;
        globeRig.rotation.x += velocityX * delta;
        clampTilt();
        const damping = Math.pow(0.94, delta);
        velocityX *= damping;
        velocityY *= damping;
      }

      const zoomEase = 1 - Math.pow(0.78, delta);
      camera.position.z = THREE.MathUtils.lerp(camera.position.z, targetZoom, zoomEase);

      const seconds = timestamp / 1000;
      markerVisuals.forEach(({ mesh, ring, ringMaterial, phase }) => {
        const pulse = Math.sin(seconds * 2.1 + phase) * 0.5 + 0.5;
        mesh.scale.setScalar(1 + pulse * 0.22);
        ring.scale.setScalar(1 + pulse * 0.55);
        ringMaterial.opacity = 0.62 - pulse * 0.34;
      });
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerEnd);
      renderer.domElement.removeEventListener('pointercancel', onPointerEnd);
      renderer.domElement.removeEventListener('wheel', onWheel);
      renderer.domElement.removeEventListener('keydown', onKeyDown);
      renderer.domElement.removeEventListener('focus', onFocus);
      renderer.domElement.removeEventListener('blur', onBlur);
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
  }, []);

  return <div ref={mountRef} className="h-full min-h-[460px] w-full" />;
}

export default function Landing() {
  const navigate = useNavigate();
  const [orgInput, setOrgInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [authKeyFeedback, setAuthKeyFeedback] = useState<string | null>(null);
  const [globePaused, setGlobePaused] = useState(false);

  const handleAuthRequest = (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgInput || !emailInput) {
      setAuthKeyFeedback('Please enter institutional credentials to generate the socket key.');
      return;
    }
    setAuthKeyFeedback(`Access request received for ${orgInput}. The OceanGuard team will review the institutional email before enabling a data stream.`);
  };

  return (
    <>
      <SkipLink />
      <main id="main-content" tabIndex={-1} className="min-h-screen w-full bg-[#0e131f] text-[#dde2f3] overflow-y-auto overflow-x-hidden outline-none selection:bg-[#00f5d4]/30 selection:text-[#26fedc]">

      {/* ── SECTION 1: HERO & PLANETARY TELEMETRY ──────────────────────────── */}
      <section className="relative w-full overflow-hidden bg-[#080e1a] px-4 sm:px-6 lg:px-12 pt-10 pb-16 border-b border-[#3a4a46]/30">
        {/* Ambient Sonar Wave Rings Simulation */}
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
                MISSION ID: ORBITAL_BENTHIC_V4.8
              </span>
              <span className="text-[#83948f]/40">|</span>
              <span className="font-data-mono-sm text-[11px] text-[#b9cac4]">
                SENTINEL-2 & SAR INTERLEAVED // GLIDER FLEET SYNCED
              </span>
            </div>
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded bg-[#1a202c]/70 border border-[#3a4a46]/30">
              <span className="font-data-mono-sm text-[11px] text-[#4cd6fb] font-mono">LATENCY: 312MS</span>
              <span className="font-telemetry-tag text-[10px] text-[#83948f]">GEO-DATUM: WGS84</span>
            </div>
          </div>

          {/* Monumental Editorial Typography */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-end">
            <div className="lg:col-span-8 flex flex-col gap-4">
              <h1 className="font-display-hero text-3xl sm:text-5xl lg:text-6xl font-bold uppercase tracking-tight text-[#dde2f3] leading-[1.08]">
                Autonomous <span className="bg-gradient-to-r from-[#00f5d4] via-[#4cd6fb] to-[#26fedc] bg-clip-text text-transparent drop-shadow-[0_0_35px_rgba(0,245,212,0.35)]">Neural Vision</span> for Pristine Oceans.
              </h1>
              <p className="font-body-lg text-sm sm:text-base text-[#b9cac4] max-w-2xl leading-relaxed">
                Sub-millimeter optical computer vision and synthetic aperture radar deployed on autonomous swarm gliders. Engineering instantaneous target acquisition for abandoned ghost gear, polyethylene slicks, and submerged synthetic filaments across 361 million km² of oceanic abyssal surface.
              </p>
            </div>

            {/* Dynamic Action Deck */}
            <div className="lg:col-span-4 flex flex-col sm:flex-row lg:flex-col gap-3 justify-end">
              <button
                onClick={() => {
                  const el = document.getElementById('planetary-globe');
                  el?.scrollIntoView({ behavior: 'smooth' });
                }}
                className="group relative inline-flex items-center justify-between px-5 py-3.5 rounded bg-gradient-to-r from-[#00f5d4] to-[#4cd6fb] text-[#00201a] font-data-mono-md text-xs font-bold uppercase shadow-[0_0_35px_rgba(0,245,212,0.3)] transition-all duration-300 hover:shadow-[0_0_50px_rgba(0,245,212,0.55)] hover:scale-[1.01] cursor-pointer"
              >
                <span>Explore Planetary Debris Grid</span>
                <Radar className="w-4 h-4 transition-transform duration-300 group-hover:rotate-45" />
              </button>
              <button
                onClick={() => navigate('/command')}
                className="group inline-flex items-center justify-between px-5 py-3.5 rounded bg-[#242a36] text-[#dde2f3] hover:bg-[#343946] hover:text-[#00f5d4] transition-all duration-200 border border-[#3a4a46]/60 cursor-pointer"
              >
                <span className="font-data-mono-md text-xs uppercase font-medium">Launch Command Console</span>
                <ArrowUpRight className="w-4 h-4 text-[#4cd6fb] transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </button>
            </div>
          </div>

          {/* Real-Time Atmospheric Ticker Strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-4">
            <div className="flex flex-col p-3.5 rounded bg-[#1a202c]/75 border border-[#3a4a46]/40 shadow-sm backdrop-blur-md">
              <span className="font-telemetry-tag text-[10px] text-[#b9cac4] uppercase tracking-wider font-bold">AUV Gliders Active</span>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="font-data-mono-xl text-2xl text-[#d7fff3] font-bold">428</span>
                <span className="font-telemetry-tag text-[9px] text-[#00f5d4] uppercase">+14 SWARM DEP</span>
              </div>
              <div className="w-full bg-[#2f3542] h-1 rounded-full mt-2 overflow-hidden">
                <div className="bg-[#00f5d4] h-full w-[84%] animate-pulse" />
              </div>
            </div>

            <div className="flex flex-col p-3.5 rounded bg-[#1a202c]/75 border border-[#3a4a46]/40 shadow-sm backdrop-blur-md">
              <span className="font-telemetry-tag text-[10px] text-[#b9cac4] uppercase tracking-wider font-bold">Orbital Passes / HR</span>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="font-data-mono-xl text-2xl text-[#4cd6fb] font-bold">14.2</span>
                <span className="font-telemetry-tag text-[9px] text-[#4cd6fb] uppercase">SENTINEL + SAR</span>
              </div>
              <div className="w-full bg-[#2f3542] h-1 rounded-full mt-2 overflow-hidden">
                <div className="bg-[#4cd6fb] h-full w-[92%]" />
              </div>
            </div>

            <div className="flex flex-col p-3.5 rounded bg-[#1a202c]/75 border border-[#3a4a46]/40 shadow-sm backdrop-blur-md">
              <span className="font-telemetry-tag text-[10px] text-[#b9cac4] uppercase tracking-wider font-bold">Debris Clusters Cataloged</span>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="font-data-mono-xl text-2xl text-[#26fedc] font-bold">1,842,903</span>
                <span className="font-telemetry-tag text-[9px] text-[#00f5d4] uppercase">VERIFIED</span>
              </div>
              <div className="w-full bg-[#2f3542] h-1 rounded-full mt-2 overflow-hidden">
                <div className="bg-[#00dfc1] h-full w-[99%]" />
              </div>
            </div>

            <div className="flex flex-col p-3.5 rounded bg-[#1a202c]/75 border border-[#3a4a46]/40 shadow-sm backdrop-blur-md">
              <span className="font-telemetry-tag text-[10px] text-[#b9cac4] uppercase tracking-wider font-bold">Inference Latency</span>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="font-data-mono-xl text-2xl text-[#00f5d4] font-bold">14.2<span className="text-xs font-normal text-[#b9cac4]">ms</span></span>
                <span className="font-telemetry-tag text-[9px] text-[#00f5d4] uppercase">EDGE-FPGA</span>
              </div>
              <div className="w-full bg-[#2f3542] h-1 rounded-full mt-2 overflow-hidden">
                <div className="bg-[#00f5d4] h-full w-[70%]" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 2: INTERACTIVE 3D PLANETARY GLOBE VIEW ────────────────── */}
      <section className="relative w-full bg-[#0e131f] px-4 sm:px-6 lg:px-12 py-16 border-b border-[#3a4a46]/30" id="planetary-globe">
        <div className="max-w-7xl mx-auto flex flex-col gap-6">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="h-1.5 w-1.5 rounded-full bg-[#00f5d4] animate-pulse" />
                <span className="font-telemetry-tag text-[10px] uppercase tracking-widest text-[#00f5d4] font-bold">
                  ORBITAL 3D PROJECTION
                </span>
              </div>
              <h2 className="font-headline-xl text-2xl sm:text-3xl font-bold text-[#dde2f3]">
                Planetary Marine Debris Cluster Grid
              </h2>
              <p className="font-body-md text-xs sm:text-sm text-[#b9cac4] mt-1">
                Drag or swipe to rotate. Pinch or scroll to zoom. Active coordinates stay anchored to live geospatial telemetry.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline-cyan" size="xs">SECTOR 00</Badge>
              <Badge variant="live" size="xs">
                <span className="w-1.5 h-1.5 rounded-full bg-[#00f5d4] mr-1 pulse-dot inline-block" />
                LIVE STREAM
              </Badge>
            </div>
          </div>

          <div className="relative rounded border border-[#3a4a46]/50 bg-[#080e1a] overflow-hidden min-h-[500px] flex flex-col lg:flex-row items-stretch">
            {/* Globe Canvas */}
            <div className="flex-1 relative min-h-[460px]">
              <GlobeCanvas autoRotationPaused={globePaused} />

              <button
                type="button"
                aria-pressed={globePaused}
                aria-label={globePaused ? 'Resume automatic globe rotation' : 'Pause automatic globe rotation'}
                title={globePaused ? 'Resume automatic rotation' : 'Pause automatic rotation'}
                onClick={() => setGlobePaused(value => !value)}
                className="absolute right-4 top-4 z-10 inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded border border-[#3a4a46]/60 bg-[#080e1a]/90 px-3 text-xs font-semibold text-[#d7fff3] shadow-lg backdrop-blur-md transition-colors hover:border-[#00f5d4]/60 hover:text-[#00f5d4] md:min-h-9"
              >
                {globePaused
                  ? <Play className="h-4 w-4" aria-hidden="true" />
                  : <Pause className="h-4 w-4" aria-hidden="true" />
                }
                <span className="hidden sm:inline">{globePaused ? 'Resume rotation' : 'Pause rotation'}</span>
              </button>

              <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-[#3a4a46]/50 bg-[#080e1a]/80 px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-[#b9cac4] backdrop-blur-md">
                Drag to orbit · Pinch / scroll to zoom
              </div>

              {/* Floating Legend */}
              <div className="absolute top-4 left-4 p-3 rounded bg-[#161c28]/90 border border-[#3a4a46]/50 backdrop-blur-md">
                <p className="font-telemetry-tag text-[9px] uppercase tracking-wider text-[#b9cac4] mb-2 font-bold">
                  Target Risk Rating
                </p>
                <div className="space-y-1.5 text-xs font-mono">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[#ff5964] shadow-[0_0_6px_#ff5964]" />
                    <span className="text-[#ffb4ab]">Critical (&gt;80)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[#ffaa00]" />
                    <span className="text-[#ffaa00]">High (60-80)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[#00f5d4]" />
                    <span className="text-[#00f5d4]">Medium (&lt;60)</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Telemetry Sidebar for Globe */}
            <div className="w-full lg:w-80 bg-[#161c28]/95 border-t lg:border-t-0 lg:border-l border-[#3a4a46]/50 p-5 flex flex-col justify-between">
              <div>
                <h3 className="font-headline-sm text-sm font-bold text-[#dde2f3] uppercase tracking-wide mb-3 flex items-center gap-2">
                  <Compass className="w-4 h-4 text-[#00f5d4]" />
                  <span>Monitored Hotspots</span>
                </h3>

                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {DEBRIS_LOCATIONS.map(d => (
                    <div
                      key={d.label}
                      className="p-2.5 rounded bg-[#080e1a] border border-[#3a4a46]/40 hover:border-[#00f5d4]/40 transition-colors flex items-center justify-between"
                    >
                      <div>
                        <p className="text-xs font-semibold text-[#dde2f3] leading-none">{d.label}</p>
                        <p className="font-mono text-[10px] text-[#83948f] mt-1">
                          {d.lat > 0 ? `${d.lat}°N` : `${Math.abs(d.lat)}°S`}, {d.lng > 0 ? `${d.lng}°E` : `${Math.abs(d.lng)}°W`}
                        </p>
                      </div>
                      <Badge
                        variant={d.risk === 'CRITICAL' ? 'red' : d.risk === 'HIGH' ? 'amber' : 'cyan'}
                        size="xs"
                      >
                        {d.risk}
                      </Badge>
                    </div>
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
                  Open Gyre Heatmap (Sector 04)
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 4: CORE ARCHITECTURAL PILLARS ─────────────────────────── */}
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
                Sub-Surface Optical & Algorithmic Supremacy
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
            {/* Pillar 01 */}
            <div className="group relative rounded bg-[#1a202c] border border-[#3a4a46]/40 p-5 flex flex-col justify-between shadow-md hover:border-[#00f5d4]/50 hover:shadow-[0_0_25px_rgba(0,245,212,0.15)] transition-all">
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="font-data-mono-sm text-[11px] text-[#00f5d4] font-bold font-mono">01 // ORBITAL</span>
                  <Satellite className="w-5 h-5 text-[#4cd6fb]" />
                </div>
                <h3 className="font-headline-sm text-base text-[#dde2f3] font-bold">Multi-Spectral Orbital Eye</h3>
                <p className="font-body-sm text-xs text-[#b9cac4] leading-relaxed">
                  16-band multispectral satellite ingestion running custom Sun-Glint Suppression algorithms. Isolates synthetic micro-polymers from natural phytoplankton chlorophyll at 10nm resolution.
                </p>
              </div>
              <div className="pt-4 mt-3 border-t border-[#3a4a46]/30 flex items-center justify-between font-telemetry-tag text-[10px] text-[#83948f] uppercase">
                <span>RES: 0.12M / PIXEL</span>
                <span className="text-[#00f5d4] font-bold">SWATH 120KM</span>
              </div>
            </div>

            {/* Pillar 02 */}
            <div className="group relative rounded bg-[#1a202c] border border-[#3a4a46]/40 p-5 flex flex-col justify-between shadow-md hover:border-[#4cd6fb]/50 hover:shadow-[0_0_25px_rgba(76,214,251,0.15)] transition-all">
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="font-data-mono-sm text-[11px] text-[#4cd6fb] font-bold font-mono">02 // SUB-SURFACE</span>
                  <Waves className="w-5 h-5 text-[#4cd6fb]" />
                </div>
                <h3 className="font-headline-sm text-base text-[#dde2f3] font-bold">Autonomous Glider Swarms</h3>
                <p className="font-body-sm text-xs text-[#b9cac4] leading-relaxed">
                  Continuous buoyancy-driven autonomous underwater vehicles (AUVs) navigating below turbulent surface chop. Armed with high-frequency side-scan acoustic sonars that map submerged ghost gear entanglements.
                </p>
              </div>
              <div className="pt-4 mt-3 border-t border-[#3a4a46]/30 flex items-center justify-between font-telemetry-tag text-[10px] text-[#83948f] uppercase">
                <span>MAX DEPTH: 2,000M</span>
                <span className="text-[#4cd6fb] font-bold">SWARM: 428 UNITS</span>
              </div>
            </div>

            {/* Pillar 03 */}
            <div className="group relative rounded bg-[#1a202c] border border-[#3a4a46]/40 p-5 flex flex-col justify-between shadow-md hover:border-[#26fedc]/50 hover:shadow-[0_0_25px_rgba(38,254,220,0.15)] transition-all">
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="font-data-mono-sm text-[11px] text-[#26fedc] font-bold font-mono">03 // INFERENCE</span>
                  <Cpu className="w-5 h-5 text-[#00f5d4]" />
                </div>
                <h3 className="font-headline-sm text-base text-[#dde2f3] font-bold">Pelagic-Vision-v4 Transformer</h3>
                <p className="font-body-sm text-xs text-[#b9cac4] leading-relaxed">
                  Proprietary deep convolutional vision transformer trained on over 14.8 million high-latitude oceanic imagery samples. Distinguishes fishing net weaves, PET bottles, and floating ropes from living oceanic wildlife.
                </p>
              </div>
              <div className="pt-4 mt-3 border-t border-[#3a4a46]/30 flex items-center justify-between font-telemetry-tag text-[10px] text-[#83948f] uppercase">
                <span>TRAINED: 14.8M SAMPLES</span>
                <span className="text-[#26fedc] font-bold">99.4% RECALL</span>
              </div>
            </div>

            {/* Pillar 04 */}
            <div className="group relative rounded bg-[#1a202c] border border-[#3a4a46]/40 p-5 flex flex-col justify-between shadow-md hover:border-[#00f5d4]/50 hover:shadow-[0_0_25px_rgba(0,245,212,0.15)] transition-all">
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="font-data-mono-sm text-[11px] text-[#00f5d4] font-bold font-mono">04 // KINETICS</span>
                  <Navigation className="w-5 h-5 text-[#00f5d4]" />
                </div>
                <h3 className="font-headline-sm text-base text-[#dde2f3] font-bold">Automated Retrieval Intercept</h3>
                <p className="font-body-sm text-xs text-[#b9cac4] leading-relaxed">
                  Eulerian-Lagrangian hydrodynamic drift simulations factoring NOAA current vectors and real-time trade wind patterns. Automatically calculates the optimal interception vector for automated drone recovery tugs.
                </p>
              </div>
              <div className="pt-4 mt-3 border-t border-[#3a4a46]/30 flex items-center justify-between font-telemetry-tag text-[10px] text-[#83948f] uppercase">
                <span>PRECISION: ±4.2 METERS</span>
                <span className="text-[#00f5d4] font-bold">AUTO DISPATCH</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 5: VALIDATED EMPIRICAL IMPACT ─────────────────────────── */}
      <section className="relative w-full bg-[#0e131f] px-4 sm:px-6 lg:px-12 py-16 border-b border-[#3a4a46]/30">
        <div className="max-w-7xl mx-auto flex flex-col gap-10">
          <div className="flex flex-col items-center text-center gap-2">
            <span className="font-telemetry-tag text-[10px] uppercase tracking-widest text-[#00f5d4] font-bold">
              VALIDATED EMPIRICAL IMPACT
            </span>
            <h2 className="font-headline-xl text-2xl sm:text-4xl font-bold text-[#dde2f3]">
              Defense-Grade Ecological Telemetry
            </h2>
            <p className="font-body-md text-xs sm:text-sm text-[#b9cac4] max-w-xl">
              Deployed alongside sovereign naval forces, environmental NGOs, and deep-ocean research consortiums globally.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { val: '2.4M+', title: 'Metric Tons Tracked', desc: 'Aggregated synthetic waste mapped from spatial coordinates down to benthic ocean beds.', color: '#00f5d4' },
              { val: '99.4%', title: 'Classification Precision', desc: 'Rigorous zero-shot computer vision precision minimizing false alarms from wild marine fauna.', color: '#4cd6fb' },
              { val: '18,400', title: 'Megafauna Safeguarded', desc: 'Direct entanglement preventions across cetaceans, sea turtles, and pelagic pelmatozoans.', color: '#26fedc' },
              { val: '34', title: 'Coast Guards & NGOs', desc: 'Active real-time tactical API data feeds integrated into international maritime recovery fleets.', color: '#d7fff3' },
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

      {/* ── SECTION 6: ENTERPRISE PARTNERSHIP & DISPATCH CALLOUT ──────────── */}
      <section className="relative w-full bg-[#080e1a] px-4 sm:px-6 lg:px-12 py-16 overflow-hidden">
        <div className="pointer-events-none absolute left-1/2 bottom-0 -translate-x-1/2 w-[700px] h-[350px] bg-[#00f5d4]/10 blur-[130px] rounded-full" />
        <div className="max-w-5xl mx-auto rounded bg-gradient-to-b from-[#242a36] via-[#161c28] to-[#080e1a] border border-[#3a4a46]/50 p-6 sm:p-10 shadow-2xl relative z-10 flex flex-col gap-6">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
            <div className="flex flex-col gap-2 max-w-xl">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded bg-[#1a202c] border border-[#00f5d4]/30 font-telemetry-tag text-[10px] text-[#00f5d4] uppercase">
                <Shield className="w-3.5 h-3.5 text-[#00f5d4]" />
                <span>UN SDG 14 // LIFE BELOW WATER COMPLIANT</span>
              </div>
              <h2 className="font-headline-xl text-xl sm:text-2xl font-bold text-[#dde2f3]">
                Request Sentinel Data Stream Access
              </h2>
              <p className="font-body-md text-xs sm:text-sm text-[#b9cac4]">
                Direct REST and Webhook telemetry streaming for sovereign maritime authorities, deep-sea research institutes, and robotic cleanup consortia.
              </p>
            </div>
            <div className="flex flex-col p-3 rounded bg-[#080e1a] border border-[#3a4a46]/40 text-[#b9cac4] font-mono text-xs">
              <span className="font-telemetry-tag text-[9px] uppercase">ENCRYPTION PROTOCOL</span>
              <span className="text-[#00f5d4] font-bold text-sm">AES-256 GCM QUANTUM</span>
              <span className="font-telemetry-tag text-[9px] uppercase mt-1">CLEARANCE: SCIENTIFIC / TACTICAL</span>
            </div>
          </div>

          {/* Quick Interactive Input Terminal */}
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
                placeholder="Woods Hole / NOAA / Navy"
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
                className="w-full py-2 px-3 rounded bg-gradient-to-r from-[#00f5d4] to-[#4cd6fb] text-[#00201a] font-data-mono-sm text-xs font-bold uppercase tracking-wider shadow-[0_0_20px_rgba(0,245,212,0.35)] hover:shadow-[0_0_30px_rgba(0,245,212,0.6)] cursor-pointer transition-all"
              >
                Request Access
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

      {/* ── FOOTER ────────────────────────────────────────────────────────── */}
      <footer className="w-full bg-[#080e1a] border-t border-[#3a4a46]/30 px-4 sm:px-6 lg:px-12 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-mono text-[#83948f]">
        <div className="flex items-center gap-3">
          <span className="text-[#00f5d4] font-bold">OceanGuard AI Platform</span>
          <span>//</span>
          <span>LAT: 28°00'04"N LON: 162°45'11"W</span>
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
