import { authorizedFetch } from '../lib/auth';
import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Anchor,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Compass,
  Crosshair,
  Database,
  Eye,
  Focus,
  Gauge,
  Layers,
  Maximize2,
  Minimize2,
  Minus,
  Navigation,
  Pause,
  Play,
  Plus,
  Radar,
  RotateCcw,
  Square,
  Waves,
  X,
  Zap,
  Signal,
  MapPin,
  Thermometer,
  Wind,
  Droplets,
  Radio,
  Activity,
  Target,
  Camera,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  createOceanScene,
  type OceanController,
  type OceanMode,
  type CameraView,
  type DynamicContact,
  type BathymetryBatch,
} from '../components/monitoring/oceanScene';
import { isSharedSimulationFixture, ScenarioObjectPreview } from '../components/monitoring/ScenarioObjectPreview';
import './MonitoringLive.css';

export type SourceMode = 'SIMULATION' | 'REPLAY' | 'LIVE';

const MODES = [
  { id: 'surface', label: 'Surface', icon: Eye },
  { id: 'underwater', label: 'Underwater', icon: Waves },
  { id: 'sonar', label: 'Sonar', icon: Radar },
] as const;

interface ScenarioSummary {
  id: string;
  name: string;
  description: string;
  durationS: number;
  seed: number;
}

interface RunView {
  id: string;
  scenarioId: string;
  scenarioName: string;
  scenarioDescription: string;
  mode: 'SIMULATION' | 'REPLAY';
  state: 'INITIALIZING' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'ABORTED';
  tS: number;
  durationS: number;
  speed: number;
  recordingError?: string | null;
  restartCount?: number;
  seed?: number;
  health: {
    espada: 'UP' | 'DOWN' | 'DEGRADED';
    feed: 'FRESH' | 'STALE' | 'INTERRUPTED';
    queueDelayMs: number;
    droppedFrames: number;
    lastFrameAtS: number | null;
  };
}

interface SimEventItem {
  id: number;
  tS: number;
  captureTime: string | null;
  type: string;
  provenance: string;
  detectionId?: string;
  trackId?: string;
  frameUrl?: string;
  scenarioObjectId?: string;
  scenarioObjectName?: string;
  scenarioDepthM?: number;
  className?: string;
  confidence?: number;
  rawConfidence?: number;
  confidenceCalibrated?: boolean;
  anomalyScore?: boolean;
  position?: { eastM: number; northM: number; depthM: number; uncertaintyM: number };
  locationUnknown?: boolean;
  lat?: number | null;
  lng?: number | null;
  reviewStatus?: 'UNREVIEWED' | 'CONFIRMED' | 'FALSE_POSITIVE' | 'CORRECTED';
  message?: string;
  environment?: { waveHeightM: number; windMps: number; visibilityClass: string; turbidity: number };
  bathymetry?: BathymetryBatch;
  platform?: { eastM: number; northM: number; headingDeg: number; speedMps: number };
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

function releaseOrphanedCanvases(container: HTMLElement | null) {
  container?.querySelectorAll('canvas').forEach(canvas => {
    try {
      const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      context?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      /* Removing the orphaned canvas still releases the page reference. */
    } finally {
      canvas.remove();
    }
  });
}

export default function Monitoring() {
  const container = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const contactToggle = useRef<HTMLButtonElement>(null);
  const engine = useRef<OceanController | null>(null);
  const labels = useRef(new Map<string, HTMLElement>());
  const navigate = useNavigate();

  // Mode and view state
  const [sourceMode] = useState<SourceMode>('SIMULATION');
  const [mode, setMode] = useState<OceanMode>('underwater');
  const [view, setView] = useState<CameraView>('orbit');
  const [paused, setPaused] = useState(prefersReducedMotion);
  const [showLabels, setShowLabels] = useState(true);
  const [showPanel, setShowPanel] = useState(false);
  const [waves, setWaves] = useState(1);
  const [fps, setFps] = useState(0);
  const [depth, setDepth] = useState(0);
  const [heading, setHeading] = useState(0);
  const [sceneError, setSceneError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sceneAttempt, setSceneAttempt] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);

  // Simulation engine state
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>('SIM-FOV');
  const [activeRun, setActiveRun] = useState<RunView | null>(null);
  const [dynamicContacts, setDynamicContacts] = useState<Map<string, DynamicContact>>(new Map());
  const [selectedContactId, setSelectedContactId] = useState<string>('');
  const [simSpeed, setSimSpeed] = useState<number>(1);
  const [metrics, setMetrics] = useState<any | null>(null);
  const [showMetricsDrawer, setShowMetricsDrawer] = useState(false);
  const [lastTelemetry, setLastTelemetry] = useState<{ lat?: number | null; lng?: number | null; locationUnknown?: boolean }>({});
  const [environment, setEnvironment] = useState<{ waveHeightM: number; windMps: number; visibilityClass: string; turbidity: number } | null>(null);
  const [showTelemetryHUD, setShowTelemetryHUD] = useState(false);

  const [mappedCells, setMappedCells] = useState(0);
  const [runPending, setRunPending] = useState(false);
  const [vesselTelemetry, setVesselTelemetry] = useState<SimEventItem['platform']>();
  const runRequestRef = useRef(0);
  const lastEventIdRef = useRef<number>(0);
  // Mirrors activeRun for use inside polling callbacks without stale-closure reads
  // or impure React state-updater side effects.
  const activeRunRef = useRef<RunView | null>(null);
  activeRunRef.current = activeRun;
  const dynamicContactsRef = useRef(dynamicContacts);
  dynamicContactsRef.current = dynamicContacts;
  const selectedContactIdRef = useRef(selectedContactId);
  selectedContactIdRef.current = selectedContactId;

  // 1. Initialize Three.js scene
  useEffect(() => {
    try {
      const controller = createOceanScene(
        container.current!,
        id => {
          setSelectedContactId(id);
          setShowPanel(true);
        },
        (rate, cameraDepth, cameraHeading) => {
          setFps(rate);
          setDepth(cameraDepth);
          setHeading(cameraHeading);
        },
        labels.current,
        setSceneError,
        setMode,
        () => setView('orbit')
      );
      engine.current = controller;
      controller.setMode(mode);
      controller.setWaves(waves);
      controller.setPaused(paused);
      controller.setCamera(view);
      controller.setLiveMode(true);
    } catch (e) {
      releaseOrphanedCanvases(container.current);
      setSceneError(e instanceof Error ? e.message : 'WebGL could not start.');
    }
    return () => {
      engine.current?.dispose();
      engine.current = null;
    };
  }, [sceneAttempt]);

  // Sync selected contact with scene
  useEffect(() => {
    engine.current?.updateLiveContacts(Array.from(dynamicContacts.values()));
  }, [dynamicContacts, sceneAttempt]);

  useEffect(() => {
    if (selectedContactId) {
      engine.current?.select(selectedContactId);
    }
  }, [selectedContactId]);

  // Fullscreen sync
  useEffect(() => {
    const syncFullscreen = () => setFullscreen(document.fullscreenElement === root.current);
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  // 2. Fetch available scenarios and start initial simulation run
  useEffect(() => {
    let cancelled = false;
    async function loadScenarios() {
      try {
        const res = await authorizedFetch('/api/simulation/scenarios');
        if (!res.ok) throw new Error('Scenarios unavailable');
        const data = await res.json();
        if (!cancelled && data.scenarios) {
          const available = data.scenarios.filter((s: ScenarioSummary) => ['SIM-FOV', 'SIM-BENTHIC-02', 'SIM-SURGE-03'].includes(s.id));
          setScenarios(available);
          const runsResponse = await authorizedFetch('/api/simulation/runs');
          if (!runsResponse.ok) {
            const error = await runsResponse.json().catch(() => ({}));
            throw new Error(error.message || 'Runs unavailable');
          }
          const runsData = await runsResponse.json();
          if (cancelled) return;
          const existing = (runsData.runs ?? []).find((run: RunView) =>
            run.mode === 'SIMULATION' && ['RUNNING', 'PAUSED'].includes(run.state) &&
            available.some((scenario: ScenarioSummary) => scenario.id === run.scenarioId));
          if (existing) {
            const runResponse = await authorizedFetch(`/api/simulation/runs/${existing.id}`);
            if (!runResponse.ok) {
              const error = await runResponse.json().catch(() => ({}));
              throw new Error(error.message || 'Active run unavailable');
            }
            const runData = await runResponse.json();
            if (cancelled) return;
            setActiveRun(runData.run);
            setSelectedScenarioId(runData.run.scenarioId);
            setSimSpeed(runData.run.speed);
          } else {
            startRun('SIM-FOV', 1);
          }
        }
      } catch (err) {
        if (!cancelled) setNotice(err instanceof Error ? err.message : 'Could not load the monitoring service. Refresh this page to retry.');
      }
    }
    loadScenarios();
    return () => {
      cancelled = true;
    };
  }, []);

  // 3. Start or switch a run.
  // Sequential-guard: every request gets a token; stale responses never overwrite newer state.
  // State is only reset AFTER the new run is confirmed, so a failed start keeps the current session visible.
  async function startRun(scenarioId: string, speed = 1) {
    if (runPending) return;
    const request = ++runRequestRef.current;
    setRunPending(true);
    try {
      const res = await authorizedFetch('/api/simulation/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId, speed }),
      });
      if (request !== runRequestRef.current) return;
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setNotice(err.message || 'Could not start simulation run.');
        return;
      }
      const data = await res.json();
      if (request !== runRequestRef.current) return;
      // The server keeps one active run per scenario family; a switching start
      // supersedes the previous session. Reset local views only after success.
      lastEventIdRef.current = 0;
      setDynamicContacts(new Map());
      setMetrics(null);
      setSelectedContactId('');
      setEnvironment(null);
      setLastTelemetry({});
      setVesselTelemetry(undefined);
      setMappedCells(0);
      engine.current?.updateLiveContacts([]);
      engine.current?.updateBathymetry(null);
      setActiveRun(data.run);
      setSimSpeed(data.run.speed);
      engine.current?.setLiveMode(true);
      engine.current?.updateVesselPose(0, 0, 0);
    } catch (err) {
      if (request === runRequestRef.current) setNotice('Could not connect to the simulation service. Please try again.');
    } finally {
      if (request === runRequestRef.current) setRunPending(false);
    }
  }

  // 4. Poll events for active run. The effect keys on run identity/restart; the
  // terminal-state check reads the mirrored ref so a state change alone never
  // tears down and restarts the interval.
  useEffect(() => {
    if (!activeRun) return;
    if (lastEventIdRef.current > 0 && ['COMPLETED', 'ABORTED'].includes(activeRun.state)) return;

    let cancelled = false;
    let inFlight = false;
    const interval = setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const res = await authorizedFetch(`/api/simulation/runs/${activeRun.id}/events?since=${lastEventIdRef.current}`);
        if (!res.ok) { if (!cancelled) setNotice('Monitoring updates are unavailable. Retrying the connection.'); return; }
        const data = await res.json();
        if (cancelled) return;
        if (data.cursor) {
          lastEventIdRef.current = data.cursor.lastEventId;
        }

        // Health/state merge happens outside React updater callbacks: derive the
        // next run object first, then commit it once.
        if (data.health) {
          const previous = activeRunRef.current;
          if (previous && previous.id === activeRun.id) {
            setActiveRun({
              ...previous,
              tS: data.cursor?.tS ?? previous.tS,
              state: data.run?.state ?? data.state ?? previous.state,
              health: data.health,
              recordingError: data.recordingError ?? null,
            });
          }
        }

        const events: SimEventItem[] = data.events ?? [];
        if (events.length === 0) return;

        for (const e of events) {
            if (e.type === 'BATHYMETRY' && e.bathymetry) {
              setMappedCells(engine.current?.updateBathymetry(e.bathymetry) ?? 0);
            } else if (e.type === 'TELEMETRY') {
              if (e.platform && !e.locationUnknown) {
                setVesselTelemetry(e.platform);
                engine.current?.updateVesselPose(e.platform.eastM, e.platform.northM, e.platform.headingDeg);
              }
              setLastTelemetry({ lat: e.lat, lng: e.lng, locationUnknown: e.locationUnknown });
            } else if (e.type === 'ENVIRONMENT' && e.environment) {
              engine.current?.setWaves(e.environment.waveHeightM);
              setWaves(e.environment.waveHeightM);
              setEnvironment(e.environment);
            }
        }
        const firstDetection = events.find(e => e.type === 'FRAME_INFERRED');
        if (firstDetection && selectedContactIdRef.current === '') {
          setSelectedContactId(firstDetection.trackId || firstDetection.detectionId || `DET-${firstDetection.id}`);
        }

        const next = new Map(dynamicContactsRef.current);
        for (const e of events) {
          if (e.type === 'FRAME_INFERRED') {
            const contactId = e.trackId || e.detectionId || `DET-${e.id}`;
            const east = e.position?.eastM ?? 0;
            const north = e.position?.northM ?? 0;
            const uncertainty = e.position?.uncertaintyM ?? 3.0;

            next.set(contactId, {
              id: contactId,
              name: e.scenarioObjectName || 'Unidentified debris',
              scenarioObjectId: e.scenarioObjectId,
              className: e.className || 'Mixed Waste',
              type: e.provenance === 'RECORDED' ? 'Recorded evidence' : 'Detected marine debris',
              // Risk is only meaningful against a reported model confidence. Recorded
              // evidence and tripped-up inference carry none, so no risk is invented.
              risk: e.confidence === undefined ? 'UNKNOWN' : e.confidence > 75 ? 'HIGH' : e.confidence > 40 ? 'MEDIUM' : 'LOW',
              depth: e.scenarioDepthM ?? 0,
              x: east,
              z: -north,
              uncertaintyM: uncertainty,
              status: 'ACTIVE',
              reviewStatus: e.reviewStatus || 'UNREVIEWED',
              locationUnknown: Boolean(e.locationUnknown) || !e.position,
              confidence: e.confidence,
              rawConfidence: e.rawConfidence,
              confidenceCalibrated: e.confidenceCalibrated,
              anomalyScore: e.anomalyScore,
              frameUrl: e.frameUrl,
              captureTime: e.captureTime,
              lastTS: e.tS,
            });

          } else if (['TRACK_CREATED', 'TRACK_UPDATED', 'TRACK_STALE', 'TRACK_LOST'].includes(e.type) && e.trackId) {
            const contact = next.get(e.trackId);
            if (contact) next.set(e.trackId, {
              ...contact,
              status: e.type === 'TRACK_LOST' ? 'LOST' : e.type === 'TRACK_STALE' ? 'STALE' : 'ACTIVE',
              ...(e.position ? { x: e.position.eastM, z: -e.position.northM, depth: contact.scenarioObjectId ? contact.depth : e.position.depthM, uncertaintyM: e.position.uncertaintyM } : {}),
            });
          } else if (e.type === 'OPERATOR_ACTION') {
            if (e.trackId && next.has(e.trackId)) {
              const trk = next.get(e.trackId)!;
              next.set(e.trackId, { ...trk, reviewStatus: e.reviewStatus || trk.reviewStatus });
            }
          } else if (e.type === 'ALERT') {
            // Alert events are surfaced via contact status; no separate log kept.
          }
        }
        setDynamicContacts(next);
      } catch (err) {
        console.error('Error polling simulation events', err);
      } finally {
        inFlight = false;
      }
    }, 280);

    return () => { cancelled = true; clearInterval(interval); };
  }, [activeRun?.id, activeRun?.state, activeRun?.restartCount]);

  // 5. Playback action handlers
  async function pauseSimulation() {
    if (!activeRun) return;
    try {
      const res = await authorizedFetch(`/api/simulation/runs/${activeRun.id}/pause`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setActiveRun(data.run);
      } else setNotice('Could not pause the run. Please retry.');
    } catch (err) {
      setNotice('Could not pause the run. Check the monitoring service connection.');
    }
  }

  async function resumeSimulation() {
    if (!activeRun) return;
    try {
      const res = await authorizedFetch(`/api/simulation/runs/${activeRun.id}/resume`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setActiveRun(data.run);
      } else setNotice('Could not resume the run. Please retry.');
    } catch (err) {
      setNotice('Could not resume the run. Check the monitoring service connection.');
    }
  }

  async function restartSimulation() {
    if (!activeRun || runPending) return;
    setRunPending(true);
    try {
      const res = await authorizedFetch(`/api/simulation/runs/${activeRun.id}/restart`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        lastEventIdRef.current = 0;
        setMappedCells(0);
        setSelectedContactId('');
        setVesselTelemetry(undefined);
        setLastTelemetry({});
        setEnvironment(null);
        setMetrics(null);
        engine.current?.updateBathymetry(null);
        setDynamicContacts(new Map());
        setActiveRun(data.run);
        engine.current?.updateLiveContacts([]);
        engine.current?.updateVesselPose(0, 0, 0);
      } else setNotice('Could not restart the run. Please retry.');
    } catch (err) {
      setNotice('Could not restart the run. Check the monitoring service connection.');
    } finally {
      setRunPending(false);
    }
  }

  async function abortSimulation() {
    if (!activeRun) return;
    try {
      const res = await authorizedFetch(`/api/simulation/runs/${activeRun.id}/abort`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setActiveRun(data.run);
        fetchMetrics();
      } else setNotice('Could not stop and save the run. Please retry.');
    } catch (err) {
      setNotice('Could not stop and save the run. Check the monitoring service connection.');
    }
  }

  async function changeSimSpeed(speed: number) {
    if (!activeRun) return;
    try {
      const res = await authorizedFetch(`/api/simulation/runs/${activeRun.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ speed }),
      });
      if (res.ok) {
        const data = await res.json();
        setActiveRun(data.run);
        setSimSpeed(data.run.speed);
      } else setNotice('Run speed was not changed. Please retry.');
    } catch (err) {
      setNotice('Run speed was not changed. Check the monitoring service connection.');
    }
  }

  async function submitReview(verdict: 'CONFIRMED' | 'FALSE_POSITIVE' | 'CORRECTED') {
    if (!activeRun || !selectedContactId) return;
    try {
      const response = await authorizedFetch(`/api/simulation/runs/${activeRun.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trackId: selectedContactId,
          verdict,
          note: `Operator visual verification in 3D scene`,
          correctedClass: verdict === 'CORRECTED' ? 'Mixed Waste' : undefined,
        }),
      });
      if (!response.ok) { setNotice('Review was not saved. Please retry.'); return; }
      setDynamicContacts(prev => {
        const next = new Map(prev);
        const trk = next.get(selectedContactId);
        if (trk) {
          next.set(selectedContactId, { ...trk, reviewStatus: verdict });
        }
        return next;
      });
    } catch (err) {
      setNotice('Review was not saved. Check the monitoring service connection.');
    }
  }

  async function fetchMetrics() {
    if (!activeRun) return;
    try {
      const res = await authorizedFetch(`/api/simulation/runs/${activeRun.id}/metrics`);
      if (res.ok) {
        const data = await res.json();
        setMetrics(data.metrics);
      }
    } catch (err) {
      console.error('Fetch metrics failed', err);
    }
  }

  function focusContact(id: string) {
    setSelectedContactId(id);
    engine.current?.select(id);
    const target = dynamicContacts.get(id);
    if (target && mode !== 'sonar') {
      changeMode(target.depth > 0.5 ? 'underwater' : 'surface');
    }
    changeView('inspect');
    if (window.innerWidth < 768) setShowPanel(false);
  }

  function changeMode(next: OceanMode) {
    setMode(next);
    setView('orbit');
    engine.current?.setMode(next);
  }

  function changeView(next: CameraView) {
    setView(next);
    engine.current?.setCamera(next);
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (root.current?.requestFullscreen) await root.current.requestFullscreen();
      else throw new Error('Fullscreen is not supported.');
    } catch {
      setNotice('Fullscreen is unavailable in this browser. The scene still works in this view.');
    }
  }

  // Active contact for detail view
  const selectedContact = dynamicContacts.get(selectedContactId) ?? Array.from(dynamicContacts.values())[0] ?? null;
  const contactsList = Array.from(dynamicContacts.values());

  return (
    <div className="ocean-monitor" ref={root}>
      {/* Top Header Bar */}
      <header className="ocean-topbar">
        <div className="ocean-mission">
          <h1>
            Coastal Watch 3D
            <span className="ocean-sample">
              {sourceMode === 'REPLAY'
                ? 'REPLAY (RECORDED)'
                : sourceMode === 'LIVE'
                  ? 'LIVE MISSION'
                  : 'SAMPLE SIMULATION'}
            </span>
          </h1>
        </div>

        <div className="ocean-topbar-actions">
          <button type="button" className="sim-mode-btn" onClick={() => navigate('/replay')} title="Open saved survey recordings">
            <Database size={13} /><span>REPLAY</span>
          </button>

          {/* View Mode Switcher */}
          <div className="ocean-mode-switch" role="group" aria-label="Monitoring view">
            {MODES.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => changeMode(id)}
                aria-label={label}
                aria-pressed={mode === id}
                className={mode === id ? 'active' : ''}
              >
                <Icon size={14} />
                <span>{label}</span>
              </button>
            ))}
          </div>

          {/* HUD & Utility Action Buttons */}
          <div className="ocean-hud-actions">
            <button
              type="button"
              className="sim-mode-btn ocean-floor-scan-btn"
              onClick={() => navigate(activeRun ? `/replay?runId=${encodeURIComponent(activeRun.id)}&view=floor` : '/replay?view=floor')}
              title="Explore received sonar samples and unsurveyed gaps"
            >
              <Camera size={13} />
              <span>FLOOR MODEL</span>
            </button>

            <button
              type="button"
              ref={contactToggle}
              className={`sim-mode-btn ${showPanel ? 'active' : ''}`}
              onClick={() => setShowPanel(prev => !prev)}
              aria-expanded={showPanel}
              aria-controls="ocean-contact-panel"
              title="Toggle mission contacts target panel"
            >
              <Radar size={13} />
              <span>TARGETS ({String(contactsList.length).padStart(2, '0')})</span>
            </button>


          </div>
        </div>
      </header>

      {/* Simulation Controls & Synchronized Clock Bar */}
      {sourceMode === 'SIMULATION' && (
        <details className="sim-control-disclosure">
          <summary>Survey controls <span>{activeRun ? `T+${activeRun.tS.toFixed(0)}s · ${activeRun.state.toLowerCase()} · ${contactsList.length} detected` : 'Preparing AUV survey'}</span></summary>
        <div className="sim-control-bar" role="toolbar" aria-label="Simulation Controls">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ font: '9px monospace', color: 'var(--ocean-text-muted)' }}>SCENARIO:</span>
            <select
              aria-label="Survey scenario"
              className="sim-select"
              disabled={runPending}
              value={selectedScenarioId}
              onChange={e => {
                const nextId = e.target.value;
                setSelectedScenarioId(nextId);
                // Changing scenario finishes the previous recording and starts a new
                // execution; the previous session stays replayable from the archive.
                startRun(nextId, simSpeed);
              }}
            >
              {scenarios.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="sim-btn-group">
            {activeRun?.state === 'RUNNING' ? (
              <button className="sim-btn" onClick={pauseSimulation} title="Pause simulation time">
                <Pause size={12} /> Pause
              </button>
            ) : (
              <button className="sim-btn primary" disabled={!activeRun || activeRun.state !== 'PAUSED'} onClick={resumeSimulation} title="Resume simulation time">
                <Play size={12} /> Resume
              </button>
            )}
            <button className="sim-btn" disabled={!activeRun || runPending} onClick={restartSimulation} title="Save this execution and restart the scenario">
              <RotateCcw size={12} /> Restart
            </button>
            <button className="sim-btn danger" disabled={!activeRun || ['COMPLETED', 'ABORTED'].includes(activeRun.state)} onClick={abortSimulation} title="Abort mission and record metrics">
              <Square size={12} /> Abort
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ font: '9px monospace', color: '#94a3b8' }}>SPEED:</span>
            {[1, 2, 5].map(s => (
              <button
                key={s}
                className={`sim-btn ${simSpeed === s ? 'primary' : ''}`}
                style={{ padding: '3px 6px', fontSize: '9px' }}
                onClick={() => changeSimSpeed(s)}
              >
                {s}x
              </button>
            ))}
          </div>

          {activeRun && (
            <div className="sim-clock-badge">
              <Clock size={12} color="#38bdf8" />
              <span>
                SIM CLOCK: <strong>T+{activeRun.tS.toFixed(1)}s</strong> / {activeRun.durationS}s
              </span>
              <span style={{ color: '#64748b' }}>|</span>
              <span style={{ color: '#94a3b8' }}>SEED: {activeRun.seed ?? 20260922}</span>
            </div>
          )}

          {/* Feed Freshness & Model Health Status */}
          {activeRun && (
            <div className="sim-health-bar">
              <div className="sim-health-item">
                <span
                  className={`sim-dot ${
                    activeRun.health.feed === 'FRESH'
                      ? 'up'
                      : activeRun.health.feed === 'STALE'
                        ? 'degraded'
                        : 'down'
                  }`}
                />
                <span>FEED: {activeRun.health.feed}</span>
              </div>
              <div className="sim-health-item">
                <span
                  className={`sim-dot ${
                    activeRun.health.espada === 'UP'
                      ? 'up'
                      : activeRun.health.espada === 'DEGRADED'
                        ? 'degraded'
                        : 'down'
                  }`}
                />
                <span>ESPADA: {activeRun.health.espada}</span>
              </div>
              {lastTelemetry.locationUnknown && (
                <div className="sim-health-item" style={{ color: '#f87171' }}>
                  <AlertTriangle size={11} /> GPS UNKNOWN
                </div>
              )}
            </div>
          )}

          <button
            className="sim-btn"
            style={{
              marginLeft: 'auto',
              background: 'rgba(56, 189, 248, 0.15)',
              borderColor: 'rgba(56, 189, 248, 0.4)',
            }}
            onClick={() => {
              setShowMetricsDrawer(prev => !prev);
              fetchMetrics();
            }}
          >
            <Gauge size={12} /> Run metrics
          </button>
        </div>
        </details>
      )}

      {activeRun?.recordingError && (
        <div className="ocean-recording-error" role="alert">
          <AlertTriangle size={16} /> Replay could not be saved. Keep this page open and retry saving in Replay.
        </div>
      )}
      <div className="ocean-viewport">
      <div
        className="ocean-canvas"
        ref={container}
        role="img"
        aria-label="Interactive Ocean Guard 3D monitoring simulation scene"
      />
      <div className="ocean-shade" />

      {!fps && !sceneError && (
        <div className="ocean-scene-loader" aria-live="polite">
          <div className="ocean-scene-loader-ring" />
          <div className="ocean-scene-loader-text">
            <strong>INITIALIZING OCEAN GUARD 3D ENGINE</strong>
            <small>Connecting pipeline, ocean bathymetry, and coordinate transforms...</small>
          </div>
        </div>
      )}

      {/* 3D Target Labels */}
      <div className="ocean-labels" hidden={!showLabels || !!sceneError}>
        {contactsList.map(c => (
          <button
            key={c.id}
            ref={el => {
              if (el) labels.current.set(c.id, el);
              else labels.current.delete(c.id);
            }}
            className={`ocean-contact-label ${c.id === selectedContactId ? 'is-selected' : ''}`}
            onClick={() => {
              setSelectedContactId(c.id);
              setShowPanel(true);
            }}
            aria-label={`Select ${c.name}`}
            aria-pressed={c.id === selectedContactId}
          >
            <span
              className="contact-pin"
              style={{
                background:
                  c.reviewStatus === 'CONFIRMED'
                    ? 'var(--ocean-green)'
                    : c.status === 'ACTIVE'
                      ? 'var(--ocean-cyan)'
                      : c.status === 'STALE'
                        ? 'var(--ocean-amber)'
                        : 'var(--ocean-red)',
              }}
            />
            <span>
              {c.id} · {c.status}
              {c.depth > 0 && mode === 'surface' ? ' · SUBMERGED' : ''}
            </span>
          </button>
        ))}
      </div>

      {/* Left Status Panel - Vessel Telemetry & Environment (Collapsible HUD) */}
      {showTelemetryHUD && (
        <aside className="ocean-status-panel" aria-label="Vessel telemetry and environment">
          <div className="ocean-panel-heading">
            <div>
              <span className="ocean-eyebrow">TELEMETRY & IN-SITU SENSORS</span>
              <h2>Vessel & Sea State</h2>
            </div>
            <button
              type="button"
              className="ocean-icon-button"
              aria-label="Close telemetry HUD"
              onClick={() => setShowTelemetryHUD(false)}
            >
              <X size={16} />
            </button>
          </div>
          <div className="ocean-status-section">
            <div className="ocean-status-header">
              <span className="ocean-eyebrow">OCEANGUARD 01 / TELEMETRY</span>
              <h3>VESSEL STATUS</h3>
            </div>
          <div className="ocean-status-grid">
            <div className="ocean-status-item">
              <Signal className="ocean-status-icon" size={14} />
              <div>
                <small>GPS FIX</small>
                <strong>{lastTelemetry.lat == null || lastTelemetry.lng == null || lastTelemetry.locationUnknown ? 'UNAVAILABLE' : 'ACQUIRED'}</strong>
              </div>
              <span className={`ocean-status-badge ${lastTelemetry.lat == null || lastTelemetry.locationUnknown ? 'bad' : 'good'}`}>
                {lastTelemetry.lat == null || lastTelemetry.locationUnknown ? 'NO FIX' : 'VALID'}
              </span>
            </div>
            <div className="ocean-status-item">
              <MapPin className="ocean-status-icon" size={14} />
              <div>
                <small>GPS POSITION</small>
                <strong>
                  {lastTelemetry.lat != null && lastTelemetry.lng != null
                    ? `${lastTelemetry.lat.toFixed(4)}° lat, ${lastTelemetry.lng.toFixed(4)}° lon`
                    : '—'}
                </strong>
              </div>
            </div>
            <div className="ocean-status-item">
              <Compass className="ocean-status-icon" size={14} />
              <div>
                <small>HEADING</small>
                <strong>{vesselTelemetry ? `${vesselTelemetry.headingDeg.toFixed(0)}°` : '—'}</strong>
              </div>
            </div>
            <div className="ocean-status-item">
              <Zap className="ocean-status-icon" size={14} />
              <div>
                <small>SPEED</small>
                <strong>{vesselTelemetry ? `${vesselTelemetry.speedMps.toFixed(1)} m/s` : '—'}</strong>
              </div>
            </div>
          </div>
        </div>

        {environment && (
          <div className="ocean-status-section">
            <div className="ocean-status-header">
              <span className="ocean-eyebrow">ENVIRONMENT / SEA STATE</span>
              <h3>IN-SITU CONDITIONS</h3>
            </div>
            <div className="ocean-status-grid">
              <div className="ocean-status-item">
                <Waves className="ocean-status-icon" size={14} />
                <div>
                  <small>WAVE HEIGHT</small>
                  <strong>{environment.waveHeightM.toFixed(1)} m</strong>
                </div>
                <span className="ocean-status-badge">
                  {environment.waveHeightM < 0.5 ? 'CALM' : environment.waveHeightM < 1.25 ? 'SLIGHT' : 'MODERATE'}
                </span>
              </div>
              <div className="ocean-status-item">
                <Wind className="ocean-status-icon" size={14} />
                <div>
                  <small>WIND SPEED</small>
                  <strong>{environment.windMps.toFixed(1)} m/s</strong>
                </div>
              </div>
              <div className="ocean-status-item">
                <Droplets className="ocean-status-icon" size={14} />
                <div>
                  <small>VISIBILITY</small>
                  <strong>{environment.visibilityClass}</strong>
                </div>
              </div>
              <div className="ocean-status-item">
                <Thermometer className="ocean-status-icon" size={14} />
                <div>
                  <small>TURBIDITY</small>
                  <strong>{environment.turbidity.toFixed(1)} NTU</strong>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="ocean-status-section">
          <div className="ocean-status-header">
            <span className="ocean-eyebrow">SYSTEM / PIPELINE HEALTH</span>
            <h3>ESPADA & FEED STATUS</h3>
          </div>
          <div className="ocean-status-grid">
            <div className="ocean-status-item">
              <Radio className="ocean-status-icon" size={14} />
              <div>
                <small>DATA FEED</small>
                <strong>{activeRun?.health.feed ?? 'WAITING'}</strong>
              </div>
              <span className={`ocean-status-badge ${activeRun?.health.feed === 'FRESH' ? 'good' : activeRun?.health.feed === 'STALE' ? 'warn' : 'bad'}`}>
                {activeRun?.health.feed === 'FRESH' ? 'FRESH' : activeRun?.health.feed === 'STALE' ? 'STALE' : 'DOWN'}
              </span>
            </div>
            <div className="ocean-status-item">
              <Activity className="ocean-status-icon" size={14} />
              <div>
                <small>ESPADA MODEL</small>
                <strong>{activeRun?.health.espada ?? 'UNKNOWN'}</strong>
              </div>
              <span className={`ocean-status-badge ${activeRun?.health.espada === 'UP' ? 'good' : activeRun?.health.espada === 'DEGRADED' ? 'warn' : 'bad'}`}>
                {activeRun?.health.espada === 'UP' ? 'OPERATIONAL' : activeRun?.health.espada === 'DEGRADED' ? 'DEGRADED' : 'OFFLINE'}
              </span>
            </div>
            <div className="ocean-status-item">
              <Target className="ocean-status-icon" size={14} />
              <div>
                <small>TARGETS TRACKED</small>
                <strong>{contactsList.length}</strong>
              </div>
            </div>
            <div className="ocean-status-item">
              <Gauge className="ocean-status-icon" size={14} />
              <div>
                <small>FRAME RATE</small>
                <strong>{fps || '—'} FPS</strong>
              </div>
            </div>
          </div>
        </div>
      </aside>
      )}

      {/* Scene Caption */}
      <div className="ocean-scene-caption">
        <span className="ocean-dot" />
        {mode === 'surface'
          ? '3D DETECTION VIEW'
          : mode === 'underwater'
            ? 'SUBSURFACE RECONSTRUCTION'
            : 'SIMULATED ACOUSTIC SONAR'}
        <span className="ocean-caption-divider" />
        {fps ? `${fps} FPS` : 'CALIBRATING'}
        <span className="ocean-caption-divider" />
        {contactsList.length} TARGETS TRACKED
        <span className="ocean-caption-divider" />
        <span style={{ color: 'var(--ocean-cyan)' }}>{mode === 'surface' ? `WAVE: ${waves.toFixed(2)}m` : `DEPTH: ${depth.toFixed(1)}m`}</span>
      </div>

      {/* Camera Presets Bar */}
      <div className="ocean-camera-bar">
        {(
          [
            { id: 'orbit', label: 'Orbit', icon: Compass },
            { id: 'bridge', label: 'Bridge', icon: Navigation },
            { id: 'overhead', label: 'Overhead', icon: Layers },
            { id: 'seabed', label: 'Seabed', icon: Anchor },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-pressed={view === id}
            onClick={() => changeView(id)}
            className={view === id ? 'active' : ''}
          >
            <Icon size={14} />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* Active Contact Quick View (when panel closed) */}
      {!showPanel && selectedContact && (
        <div className="ocean-contact-quickview" aria-label="Selected contact summary">
          <div className="ocean-quickview-header">
            <span className="ocean-eyebrow">SELECTED TARGET</span>
            <button className="ocean-icon-button" onClick={() => setShowPanel(true)} aria-label="Open contact panel">
              <ArrowUpRight size={14} />
            </button>
          </div>
          <h4>{selectedContact.name}</h4>
          <p className="ocean-quickview-class">{selectedContact.id} · model class: {selectedContact.className}</p>
          <div className="ocean-quickview-meta">
            <span className={`ocean-risk-badge ${selectedContact.risk.toLowerCase()}`}>{selectedContact.risk} RISK</span>
            <span>{selectedContact.status}</span>
            {selectedContact.reviewStatus !== 'UNREVIEWED' && (
              <span className={`ocean-review-badge ${selectedContact.reviewStatus.toLowerCase()}`}>{selectedContact.reviewStatus}</span>
            )}
          </div>
          <div className="ocean-quickview-position">
            <small>E: {selectedContact.x.toFixed(1)}m N: {(-selectedContact.z).toFixed(1)}m (±{selectedContact.uncertaintyM.toFixed(1)}m)</small>
          </div>
        </div>
      )}

      {/* Contact Panel */}
      {showPanel && (
        <aside className="ocean-contact-panel" id="ocean-contact-panel" aria-label="Mission contacts">
          <div className="ocean-panel-heading">
            <div>
              <span className="ocean-eyebrow">TARGET TRACKS & INFERENCE</span>
              <h2>
                In the water <span>{String(contactsList.length).padStart(2, '0')}</span>
              </h2>
            </div>
            <button
              className="ocean-icon-button"
              aria-label="Close contacts"
              onClick={() => {
                setShowPanel(false);
                requestAnimationFrame(() => contactToggle.current?.focus());
              }}
            >
              <X size={16} />
            </button>
          </div>

          {/* Contact List */}
          <div className="ocean-contact-list">
            {contactsList.length === 0 ? (
              <div style={{ padding: '16px 8px', font: '10px monospace', color: '#94a3b8', textAlign: 'center' }}>
                No debris detected in camera FOV yet.
              </div>
            ) : (
              contactsList.map(c => (
                <button
                  key={c.id}
                  className={`ocean-contact-row ${selectedContactId === c.id ? 'active' : ''}`}
                  onClick={() => focusContact(c.id)}
                  aria-pressed={selectedContactId === c.id}
                >
                  <span className="ocean-target-icon">
                    <Crosshair size={18} />
                  </span>
                  <span className="ocean-contact-title">
                    <strong>{c.name}</strong>
                    <small>
                      {c.locationUnknown ? (
                        <span style={{ color: '#f87171' }}>UNKNOWN LOCATION</span>
                      ) : (
                        `E: ${c.x.toFixed(1)}m, N: ${(-c.z).toFixed(1)}m (±${c.uncertaintyM.toFixed(1)}m)`
                      )}
                    </small>
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                    <span className={`sim-track-badge ${c.status.toLowerCase()}`}>{c.status}</span>
                    {c.reviewStatus !== 'UNREVIEWED' && (
                      <span className={`sim-review-badge ${c.reviewStatus.toLowerCase()}`}>{c.reviewStatus}</span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Selected Contact Detail Card */}
          {selectedContact && (
            <div className="ocean-contact-detail">
              <div className="ocean-detail-label">
                <span>INSPECTED CONTACT</span>
                <span className={selectedContact.risk === 'HIGH' ? 'ocean-amber' : selectedContact.risk === 'UNKNOWN' ? 'ocean-dim' : 'ocean-mint'}>
                  {selectedContact.risk} RISK
                </span>
              </div>
              <h3>{selectedContact.name}</h3>
              {selectedContact.scenarioObjectId && <p style={{ margin: '3px 0 8px', fontSize: 11, color: '#9dbbb8' }}>Scenario visual: {selectedContact.scenarioObjectId}. Shape and depth come from the authored scene.</p>}
              <p style={{ margin: '4px 0 8px', font: '10px monospace', color: '#94a3b8' }}>
                Single class supported: <strong>Mixed Waste</strong> (SSDLite320 ONNX)
              </p>

              {selectedContact.scenarioObjectId && isSharedSimulationFixture(selectedContact.frameUrl) && (
                <div className="sim-frame-preview">
                  <ScenarioObjectPreview id={selectedContact.scenarioObjectId} name={selectedContact.name} />
                  <div className="sim-frame-tag">SCENARIO DEPICTION</div>
                </div>
              )}
              {selectedContact.frameUrl && (isSharedSimulationFixture(selectedContact.frameUrl)
                ? <details className="sim-source-frame">
                    <summary>Inspect synthetic detector frame · T+{selectedContact.lastTS?.toFixed(1) ?? '0'}s</summary>
                    <img src={selectedContact.frameUrl} alt={`Synthetic detector fixture associated with ${selectedContact.name}`} loading="lazy" />
                    <p>Shared fixture; its shape does not identify this object.</p>
                  </details>
                : <div className="sim-frame-preview">
                    <img src={selectedContact.frameUrl} alt={`Source camera frame for ${selectedContact.name}`} />
                    <div className="sim-frame-tag">SOURCE FRAME @ T+{selectedContact.lastTS?.toFixed(1) ?? '0'}s</div>
                  </div>)}

              {/* Metrics & Uncertainty */}
              <div className="ocean-detail-metrics">
                <div>
                  <small>{selectedContact.confidenceCalibrated ? 'CALIBRATED CONF.' : 'REPORTED CONF. (UNCALIBRATED)'}</small>
                  <strong>{selectedContact.confidence ? `${selectedContact.confidence.toFixed(1)}%` : '—'}</strong>
                </div>
                <div>
                  <small>RAW MODEL SCORE</small>
                  <strong>{selectedContact.rawConfidence ? `${selectedContact.rawConfidence.toFixed(0)}%` : '—'}</strong>
                </div>
                <div>
                  <small>{selectedContact.scenarioObjectId ? 'SCENARIO DEPTH' : 'DEPTH'}</small>
                  <strong>{selectedContact.depth > 0 ? `${selectedContact.depth.toFixed(1)} m` : 'UNKNOWN'}</strong>
                </div>
                <div>
                  <small>UNCERTAINTY</small>
                  <strong>±{selectedContact.uncertaintyM.toFixed(1)}<span> m</span></strong>
                </div>
                <div>
                  <small>POSITION FIX</small>
                  <strong style={{ fontSize: '12px' }}>
                    {selectedContact.locationUnknown ? 'UNKNOWN' : `${selectedContact.x.toFixed(1)}m, ${(-selectedContact.z).toFixed(1)}m`}
                  </strong>
                </div>
              </div>

              {/* Operator Review Actions */}
              <div style={{ marginTop: '12px', borderTop: '1px solid var(--line)', paddingTop: '10px' }}>
                <span style={{ font: '9px monospace', color: '#94a3b8', letterSpacing: '0.08em' }}>OPERATOR VERIFICATION:</span>
                <div className="sim-review-actions">
                  <button className="sim-review-btn confirm" onClick={() => submitReview('CONFIRMED')}>
                    <CheckCircle2 size={11} style={{ display: 'inline', marginRight: 4 }} />
                    Confirm
                  </button>
                  <button className="sim-review-btn reject" onClick={() => submitReview('FALSE_POSITIVE')}>
                    <X size={11} style={{ display: 'inline', marginRight: 4 }} />
                    False Pos.
                  </button>
                </div>
              </div>

              <button className="ocean-inspect" style={{ marginTop: 12 }} onClick={() => focusContact(selectedContact.id)}>
                <Focus size={15} /> Orbit target in 3D <ArrowUpRight size={15} />
              </button>

              <p className="ocean-provenance">
                Frames analyzed by the self-hosted Espada ONNX service (/v1/detect). Location is an estimate from the simulated survey; camera boxes do not measure depth.
              </p>
            </div>
          )}

          <div className="ocean-seabed-card">
            <span className="ocean-eyebrow">AUV SONAR SURVEY</span>
            <p className="ocean-seabed-card-desc">{mappedCells.toLocaleString()} sonar cells recorded. This background terrain is illustrative; the floor-only replay shows surveyed areas and leaves unknown areas blank.</p>
            <button type="button" className="sim-btn primary" onClick={() => navigate(activeRun ? `/replay?runId=${encodeURIComponent(activeRun.id)}&view=floor` : '/replay?view=floor')}>
              <Compass size={13} /> Open floor-only 3D
            </button>
          </div>
          <button className="ocean-espada-link" onClick={() => navigate('/data')}>
            <span>Open ESPADA Data Hub</span>
            <ArrowUpRight size={16} />
          </button>
        </aside>
      )}

      {/* Compass */}
      <div className="ocean-compass" aria-hidden="true">
        <span>N</span>
        <Navigation size={25} style={{ transform: `rotate(${heading - 45}deg)` }} color="var(--ocean-cyan)" />
        <small>{String(Math.round(heading) % 360).padStart(3, '0')}° HEADING</small>
      </div>

      {/* Water Column Depth Control */}
      <div className="ocean-depth-control" style={{ top: sourceMode === 'SIMULATION' ? '255px' : '225px' }}>
        <label htmlFor="ocean-camera-depth">
          WATER COLUMN{' '}
          <strong>{depth < 0 ? `${Math.abs(depth).toFixed(1)} m above` : `${depth.toFixed(1)} m deep`}</strong>
        </label>
        <input
          id="ocean-camera-depth"
          aria-label="Camera depth: surface to seabed"
          type="range"
          min="-12"
          max="48"
          step=".2"
          value={Math.min(48, Math.max(-12, depth))}
          onChange={event => engine.current?.setDepth(Number(event.target.value))}
        />
        <div>
          <span>Above</span>
          <span>Surface</span>
          <span>Deep (48 m)</span>
        </div>
      </div>

      {/* Bottom Bar */}
      <footer className="ocean-bottom-bar">
        <div className="ocean-vessel-status">
          <span className="ocean-vessel-icon">
            <Anchor size={20} />
          </span>
          <div>
            <strong>Ocean Guard Research 01</strong>
            <small>
              {sourceMode === 'REPLAY'
                ? 'Chennai coastline recorded survey'
                : 'Simulated survey · events recorded for replay'}
            </small>
          </div>
          <div className="ocean-depth">
            <small>{mode === 'surface' ? 'SEA STATE' : 'CAMERA DEPTH'}</small>
            <strong>
              {mode === 'surface'
                ? waves < 0.6
                  ? 'Calm'
                  : waves > 1.4
                    ? 'Moderate'
                    : 'Light swell'
                : `${depth.toFixed(1)} m`}
            </strong>
          </div>
        </div>

        <div className="ocean-sea-control">
          <label htmlFor="ocean-waves">WAVE INTENSITY</label>
          <input
            id="ocean-waves"
            type="range"
            min="0.15"
            max="2"
            step="0.05"
            value={waves}
            onChange={e => {
              const value = Number(e.target.value);
              setWaves(value);
              engine.current?.setWaves(value);
            }}
          />
        </div>

        <div className="ocean-tools">
          <button
            className="ocean-icon-button"
            aria-label={paused ? 'Resume scene motion' : 'Pause scene motion'}
            aria-pressed={paused}
            onClick={() =>
              { engine.current?.setPaused(!paused); setPaused(!paused); }
            }
          >
            {paused ? <Play size={17} /> : <Pause size={17} />}
          </button>
          <button
            className={`ocean-icon-button ${showLabels ? 'active' : ''}`}
            aria-label="Toggle contact labels"
            aria-pressed={showLabels}
            onClick={() => setShowLabels(current => !current)}
          >
            <Crosshair size={17} />
          </button>
          <span className="ocean-tool-divider" />
          <button className="ocean-icon-button" aria-label="Zoom in" onClick={() => engine.current?.zoom(0.8)}>
            <Plus size={17} />
          </button>
          <button className="ocean-icon-button" aria-label="Zoom out" onClick={() => engine.current?.zoom(1.25)}>
            <Minus size={17} />
          </button>
          <button className="ocean-icon-button" aria-label="Reset camera" onClick={() => changeView('orbit')}>
            <RotateCcw size={16} />
          </button>
          <button
            className="ocean-icon-button"
            aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            aria-pressed={fullscreen}
            onClick={toggleFullscreen}
          >
            {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </div>
      </footer>

      {/* Evaluation Metrics Drawer */}
      {showMetricsDrawer && (
        <div className="sim-metrics-drawer" role="dialog" aria-label="Evaluation Metrics">
          <div className="sim-metrics-header">
            <h3>Pipeline Performance & Test Matrix</h3>
            <button className="ocean-icon-button" onClick={() => setShowMetricsDrawer(false)}>
              <X size={15} />
            </button>
          </div>

          {!metrics ? (
            <p style={{ font: '11px monospace', color: 'var(--ocean-text-muted)' }}>Gathering scenario telemetry & inference metrics...</p>
          ) : !metrics.available ? (
            <p style={{ font: '11px monospace', color: 'var(--ocean-red)' }}>{metrics.reason}</p>
          ) : (
            <div className="sim-metrics-grid">
              <div className="sim-metric-card">
                <small>PRECISION (IOU 0.50)</small>
                <strong>
                  {typeof metrics.perFrame.precision === 'number'
                    ? `${(metrics.perFrame.precision * 100).toFixed(1)}%`
                    : metrics.perFrame.precision}
                </strong>
              </div>
              <div className="sim-metric-card">
                <small>RECALL (IOU 0.50)</small>
                <strong>
                  {typeof metrics.perFrame.recall === 'number'
                    ? `${(metrics.perFrame.recall * 100).toFixed(1)}%`
                    : metrics.perFrame.recall}
                </strong>
              </div>
              <div className="sim-metric-card">
                <small>UNIQUE OBJECT COUNTING</small>
                <strong>
                  {metrics.uniqueObjectCount.predicted} / {metrics.uniqueObjectCount.truth}{' '}
                  <span style={{ fontSize: '10px', color: 'var(--ocean-text-muted)' }}>
                    (err: {metrics.uniqueObjectCount.error})
                  </span>
                </strong>
              </div>
              <div className="sim-metric-card">
                <small>IDENTITY SWAPS</small>
                <strong>{metrics.identitySwaps}</strong>
              </div>
              <div className="sim-metric-card">
                <small>LOCALIZATION RMSE</small>
                <strong>
                  {typeof metrics.localization.rmseM === 'number'
                    ? `${metrics.localization.rmseM.toFixed(2)}m`
                    : metrics.localization.rmseM}
                </strong>
              </div>
              <div className="sim-metric-card" title={metrics.latency.definition}>
                <small>LATENCY (P50 / P95, SIM TIME)</small>
                <strong>
                  {metrics.latency.p50S !== 'UNAVAILABLE'
                    ? `${metrics.latency.p50S.toFixed(2)}s / ${typeof metrics.latency.p95S === 'number' ? metrics.latency.p95S.toFixed(2) : '—'}s`
                    : 'UNAVAILABLE'}
                </strong>
              </div>
              <div className="sim-metric-card">
                <small>DROPPED FRAME RATE</small>
                <strong>
                  {typeof metrics.droppedFrameRate === 'number'
                    ? `${(metrics.droppedFrameRate * 100).toFixed(1)}%`
                    : metrics.droppedFrameRate}
                </strong>
              </div>
              <div className="sim-metric-card">
                <small>STALE FEED THRESHOLD</small>
                <strong>{metrics.staleFeedBehaviorS}s</strong>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Live Unavailable Modal */}
      {/* Controls Hint */}
      <div className="ocean-controls-hint">
        Drag to orbit <span>·</span> Scroll ↓ dive / ↑ rise <span>·</span> +/- zoom <span>·</span> Space pause{' '}
        <span>·</span> R reset camera
      </div>

      {sceneError ? (
        <div className="ocean-error" role="alert">
          <strong>Scene unavailable</strong>
          <p>{sceneError}</p>
          <button
            onClick={() => {
              setSceneError(null);
              setSceneAttempt(attempt => attempt + 1);
            }}
          >
            Retry scene
          </button>
        </div>
      ) : (
        notice && (
          <div className="ocean-error" role="status">
            <strong>Notice</strong>
            <p>{notice}</p>
            <button onClick={() => setNotice(null)}>Dismiss</button>
          </div>
        )
      )}

      </div>
    </div>
  );
}
