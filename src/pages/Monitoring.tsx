import { useEffect, useRef, useState } from 'react';
import { Anchor, ArrowUpRight, ChevronDown, Compass, Crosshair, Eye, Focus, Layers, Maximize2, Minimize2, Minus, Navigation, Pause, Play, Plus, Radar, RotateCcw, Waves, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { CONTACTS, createOceanScene, type OceanController, type OceanMode, type CameraView } from '../components/monitoring/oceanScene';
import './Monitoring.css';

const MODES = [{ id: 'surface', label: 'Surface', icon: Eye }, { id: 'underwater', label: 'Underwater', icon: Waves }, { id: 'sonar', label: 'Sonar', icon: Radar }] as const;

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

function releaseOrphanedCanvases(container: HTMLElement | null) {
  container?.querySelectorAll('canvas').forEach(canvas => {
    try {
      const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      context?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch { /* Removing the orphaned canvas still releases the page reference. */ }
    finally { canvas.remove(); }
  });
}

export default function Monitoring() {
  const container = useRef<HTMLDivElement>(null), root = useRef<HTMLDivElement>(null), contactToggle = useRef<HTMLButtonElement>(null);
  const engine = useRef<OceanController | null>(null), labels = useRef(new Map<string, HTMLElement>());
  const navigate = useNavigate();
  const [mode, setMode] = useState<OceanMode>('surface'), [view, setView] = useState<CameraView>('orbit');
  const [selected, setSelected] = useState<string>(CONTACTS[0].id);
  const [paused, setPaused] = useState(prefersReducedMotion);
  const [showLabels, setShowLabels] = useState(true), [showPanel, setShowPanel] = useState(() => typeof window === 'undefined' || window.innerWidth >= 768);
  const [waves, setWaves] = useState(1), [fps, setFps] = useState(0), [depth, setDepth] = useState(0), [heading, setHeading] = useState(0);
  const [sceneError, setSceneError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [sceneAttempt, setSceneAttempt] = useState(0), [fullscreen, setFullscreen] = useState(false);
  const contact = CONTACTS.find(c => c.id === selected)!;
  useEffect(() => {
    try {
      const controller = createOceanScene(container.current!, setSelected, (rate, cameraDepth, cameraHeading) => { setFps(rate); setDepth(cameraDepth); setHeading(cameraHeading); }, labels.current, setSceneError, setMode, () => setView('orbit'));
      engine.current = controller;
      controller.select(selected);
      controller.setMode(mode);
      controller.setWaves(waves);
      controller.setPaused(paused);
      controller.setCamera(view);
    }
    catch (e) {
      releaseOrphanedCanvases(container.current);
      setSceneError(e instanceof Error ? e.message : 'WebGL could not start.');
    }
    return () => { engine.current?.dispose(); engine.current = null; };
  }, [sceneAttempt]);
  useEffect(() => { engine.current?.select(selected); }, [selected]);
  useEffect(() => {
    const syncFullscreen = () => setFullscreen(document.fullscreenElement === root.current);
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  // Keyboard navigation for accessibility
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Leave native controls and links to their browser behavior.
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '') || target?.closest('button, a, [role="button"], [contenteditable="true"]')) return;

      if (e.key === 'Escape' && showPanel && !document.fullscreenElement) {
        setShowPanel(false);
        requestAnimationFrame(() => contactToggle.current?.focus());
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        engine.current?.zoom(0.8);
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        engine.current?.zoom(1.25);
      } else if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        setPaused(curr => {
          const next = !curr;
          engine.current?.setPaused(next);
          return next;
        });
      } else if (e.key === 'r' || e.key === 'R') {
        changeView('orbit');
      } else if (e.key === 'm' || e.key === 'M') {
        const nextMode = mode === 'surface' ? 'underwater' : mode === 'underwater' ? 'sonar' : 'surface';
        changeMode(nextMode);
      } else if (['1', '2', '3', '4', '5', '6', '7', '8'].includes(e.key)) {
        const idx = parseInt(e.key, 10) - 1;
        if (CONTACTS[idx]) {
          setSelected(CONTACTS[idx].id);
          setShowPanel(true);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showPanel, mode]);
  function focusContact(id: string) {
    const target = CONTACTS.find(item => item.id === id);
    if (!target) return;
    setSelected(id);
    engine.current?.select(id);
    if (mode !== 'sonar') changeMode(target.depth > .5 ? 'underwater' : 'surface');
    changeView('inspect');
    if (window.innerWidth < 768) setShowPanel(false);
  }
  function changeMode(next: OceanMode) { setMode(next); setView('orbit'); engine.current?.setMode(next); }
  function changeView(next: CameraView) { setView(next); engine.current?.setCamera(next); }
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (root.current?.requestFullscreen) await root.current.requestFullscreen();
      else throw new Error('Fullscreen is not supported.');
    } catch { setNotice('Fullscreen is unavailable in this browser. The scene still works in this view.'); }
  }
  return <div className="ocean-monitor" ref={root}>
    <div className="ocean-canvas" ref={container} role="img" aria-label="Interactive sample ocean mission with a research vessel, sensory telemetry buoys, autonomous drones, and debris contacts. Use the named controls to change view or inspect contacts." />
    <div className="ocean-shade" />
    {!fps && !sceneError && (
      <div className="ocean-scene-loader" aria-live="polite">
        <div className="ocean-scene-loader-ring" />
        <div className="ocean-scene-loader-text">
          <strong>INITIALIZING COASTAL 3D TELEMETRY</strong>
          <small>Calibrating surface water, seabed bathymetry, and contacts...</small>
        </div>
      </div>
    )}
    <div className="ocean-labels" hidden={!showLabels || !!sceneError}>
      {CONTACTS.map(c => <button key={c.id} ref={el => { if (el) labels.current.set(c.id, el); else labels.current.delete(c.id); }} className={`ocean-contact-label ${c.id === selected ? 'is-selected' : ''}`} onClick={() => { setSelected(c.id); setShowPanel(true); }} aria-label={`Select ${c.name}`} aria-pressed={c.id === selected}>
        <span className="contact-pin" /><span>{c.id}{c.depth > 0 && mode === 'surface' ? ' · BELOW SURFACE' : ''}</span>
      </button>)}
    </div>
    <header className="ocean-topbar">
      <div className="ocean-mission"><span className="ocean-eyebrow">OCEANGUARD / FIELD VIEW</span><h1>Coastal watch<span className="ocean-sample">SAMPLE MISSION</span></h1><p>Explore the water. Inspect what lies beneath.</p></div>
      <div className="ocean-mode-switch" role="group" aria-label="Monitoring view">{MODES.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => changeMode(id)} aria-label={label} aria-pressed={mode === id} className={mode === id ? 'active' : ''}><Icon size={15} /><span>{label}</span></button>)}</div>
    </header>
    <div className="ocean-scene-caption"><span className="ocean-dot" />{mode === 'surface' ? 'OPTICAL RECONSTRUCTION' : mode === 'underwater' ? 'SUBSURFACE RECONSTRUCTION' : 'SIMULATED SONAR'}<span className="ocean-caption-divider" />{fps ? `${fps} FPS` : 'CALIBRATING SCENE'}</div>
    <div className="ocean-camera-bar" role="group" aria-label="Camera position">{([{ id: 'orbit', label: 'Orbit', icon: Compass }, { id: 'bridge', label: 'Bridge', icon: Navigation }, { id: 'overhead', label: 'Overhead', icon: Layers }] as const).map(({ id, label, icon: Icon }) => <button key={id} aria-pressed={view === id} onClick={() => changeView(id)} className={view === id ? 'active' : ''}><Icon size={14} /><span>{label}</span></button>)}</div>
    <button ref={contactToggle} className="ocean-contact-toggle" onClick={() => setShowPanel(current => !current)} aria-expanded={showPanel} aria-controls="ocean-contact-panel"><Radar size={16} /> Contacts <span>{String(CONTACTS.length).padStart(2, '0')}</span><ChevronDown size={14} /></button>
    {showPanel && <aside className="ocean-contact-panel" id="ocean-contact-panel" aria-label="Mission contacts">
      <div className="ocean-panel-heading"><div><span className="ocean-eyebrow">MISSION OVERVIEW</span><h2>In the water <span>{String(CONTACTS.length).padStart(2, '0')}</span></h2></div><button className="ocean-icon-button" aria-label="Close contacts" onClick={() => { setShowPanel(false); requestAnimationFrame(() => contactToggle.current?.focus()); }}><X size={16} /></button></div>
      <div className="ocean-contact-list">{CONTACTS.map(c => <button key={c.id} className={`ocean-contact-row ${selected === c.id ? 'active' : ''}`} onClick={() => focusContact(c.id)} aria-label={`${c.name}, ${c.depth === 0 ? 'at the surface' : `${c.depth.toFixed(1)} meters deep`}, ${c.risk.toLowerCase()} scenario risk`} aria-pressed={selected === c.id}>
        <span className="ocean-target-icon"><Crosshair size={19} /></span><span className="ocean-contact-title"><strong>{c.name}</strong><small>{c.id} <span>·</span> {c.depth === 0 ? 'Surface' : `${c.depth.toFixed(1)} m depth`}</small></span><span className={`ocean-risk-dot ${c.risk.toLowerCase()}`} title={`${c.risk} scenario risk`} />
      </button>)}</div>
      <div className="ocean-contact-detail">
        <div className="ocean-detail-label"><span>SELECTED CONTACT</span><span className={contact.risk === 'HIGH' ? 'ocean-amber' : contact.risk === 'LOW' ? 'ocean-mint' : 'ocean-teal'}>{contact.risk} RISK</span></div>
        <h3>{contact.name}</h3><p>{contact.type}</p>
        <div className="ocean-detail-metrics"><div><small>DEPTH</small><strong>{contact.depth.toFixed(1)}<span> m</span></strong></div><div><small>VESSEL DISTANCE</small><strong>{Math.hypot(contact.x, contact.z).toFixed(1)}<span> m</span></strong></div></div>
        <button className="ocean-inspect" onClick={() => focusContact(selected)}><Focus size={16} /> Inspect contact <ArrowUpRight size={16} /></button>
        <p className="ocean-provenance">Scenario positions and risk labels. No live detections are connected to this scene.</p>
      </div>
      <button className="ocean-espada-link" onClick={() => navigate('/data')}><span>Analyze real imagery with Espada</span><ArrowUpRight size={16} /></button>
    </aside>}
    <div className="ocean-compass" aria-hidden="true"><span>N</span><Navigation size={25} style={{ transform: `rotate(${heading - 45}deg)` }} /><small>{String(Math.round(heading) % 360).padStart(3, '0')}° HEADING</small></div>
    <div className="ocean-depth-control">
      <label htmlFor="ocean-camera-depth">WATER COLUMN <strong>{depth < 0 ? `${Math.abs(depth).toFixed(1)} m above` : `${depth.toFixed(1)} m deep`}</strong></label>
      <input id="ocean-camera-depth" aria-label="Camera depth: surface to seabed" type="range" min="-12" max="13" step=".1" value={Math.min(13, Math.max(-12, depth))} onChange={event => engine.current?.setDepth(Number(event.target.value))} />
      <div><span>Above</span><span>Surface</span><span>Seabed</span></div>
    </div>
    <footer className="ocean-bottom-bar">
      <div className="ocean-vessel-status"><span className="ocean-vessel-icon"><Anchor size={20} /></span><div><strong>OG Research 01</strong><small>Sample coastal survey</small></div><div className="ocean-depth"><small>{mode === 'surface' ? 'SEA STATE' : 'CAMERA DEPTH'}</small><strong>{mode === 'surface' ? waves < .6 ? 'Calm' : waves > 1.4 ? 'Moderate' : 'Light swell' : `${depth.toFixed(1)} m`}</strong></div></div>
      <div className="ocean-sea-control"><label htmlFor="ocean-waves">WAVE INTENSITY</label><input id="ocean-waves" type="range" min="0.15" max="2" step="0.05" value={waves} onChange={e => { const value = Number(e.target.value); setWaves(value); engine.current?.setWaves(value); }} /></div>
      <div className="ocean-tools">
        <button className="ocean-icon-button" aria-label={paused ? 'Resume scene motion' : 'Pause scene motion'} aria-pressed={paused} onClick={() => setPaused(current => { const next = !current; engine.current?.setPaused(next); return next; })}>{paused ? <Play size={17} /> : <Pause size={17} />}</button>
        <button className={`ocean-icon-button ${showLabels ? 'active' : ''}`} aria-label="Toggle contact labels" aria-pressed={showLabels} onClick={() => setShowLabels(current => !current)}><Crosshair size={17} /></button><span className="ocean-tool-divider" />
        <button className="ocean-icon-button" aria-label="Zoom in" onClick={() => engine.current?.zoom(.8)}><Plus size={17} /></button><button className="ocean-icon-button" aria-label="Zoom out" onClick={() => engine.current?.zoom(1.25)}><Minus size={17} /></button>
        <button className="ocean-icon-button" aria-label="Reset camera" onClick={() => changeView('orbit')}><RotateCcw size={16} /></button>
        <button className="ocean-icon-button" aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} aria-pressed={fullscreen} onClick={toggleFullscreen}>{fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
      </div>
    </footer>
    <div className="ocean-controls-hint">Drag to orbit <span>·</span> Scroll ↓ dive / ↑ rise <span>·</span> +/- zoom <span>·</span> Space pause <span>·</span> R reset</div>
    {sceneError ? <div className="ocean-error" role="alert"><strong>Scene unavailable</strong><p>{sceneError}</p><button onClick={() => { setSceneError(null); setSceneAttempt(attempt => attempt + 1); }}>Retry scene</button></div>
      : notice && <div className="ocean-error" role="status"><strong>Scene notice</strong><p>{notice}</p><button onClick={() => setNotice(null)}>Dismiss</button></div>}
  </div>;
}
