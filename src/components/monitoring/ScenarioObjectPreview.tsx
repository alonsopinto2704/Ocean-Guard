import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { buildScenarioVisual } from './oceanScene';
import './ScenarioObjectPreview.css';

const previews = new Map<string, string>();
let renderer: THREE.WebGLRenderer | undefined;

export const isSharedSimulationFixture = (url?: string) => Boolean(url?.startsWith('/simulation/runs/frames/OBJ-'));

function previewUrl(id: string): string | undefined {
  const cached = previews.get(id);
  if (cached) return cached;
  try {
    const model = buildScenarioVisual(id);
    if (!model) return undefined;
    renderer ??= new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(480, 270, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#183643');
    scene.add(new THREE.HemisphereLight('#d3eff2', '#344a42', 2.3));
    const key = new THREE.DirectionalLight('#fff0d5', 2.1);
    key.position.set(6, 9, 8);
    scene.add(key);
    model.position.set(0, 0, 0);
    scene.add(model);
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    model.position.sub(center);
    const span = box.getSize(new THREE.Vector3()).length();
    const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 100);
    camera.position.set(span * 0.65, span * 0.48, span * 0.9);
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/webp', 0.88);
    previews.set(id, url);
    model.traverse(object => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose();
      if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        Object.values(material).forEach(value => { if (value instanceof THREE.Texture) value.dispose(); });
        material.dispose();
      }
    });
    return url;
  } catch {
    return undefined;
  }
}

export function ScenarioObjectPreview({ id, name }: { id: string; name: string }) {
  const [src, setSrc] = useState(() => previews.get(id));
  useEffect(() => { setSrc(previewUrl(id)); }, [id]);
  return <span className="scenario-object-preview">
    {src ? <img src={src} alt={`Illustrative 3D model of ${name}`} /> : <span className="scenario-object-preview-fallback">{name}</span>}
  </span>;
}
