import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Camera, Compass, Crosshair, ExternalLink, Eye, Layers, Maximize2, Pause, Play, RefreshCw, RotateCcw, Save, Search, SkipBack, SkipForward, SlidersHorizontal, Sparkles, Target, Trash2, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Modal } from '../ui/Modal';
import { EMPTY_FEED, commandRun, fetchEvents, fetchRun, fetchRuns, fetchScenarios, foldEvents, replayFeedAt, startRun, type RunFeed, type RunSummary, type SimEvent } from './runEventFeed';
import { createRunScene, sampledFloorDepth, type RunSceneController } from './runScene';
import { isSharedSimulationFixture, ScenarioObjectPreview } from '../monitoring/ScenarioObjectPreview';
import { authorizedFetch } from '../../lib/auth';
import './RunEventConsole.css';

type ArchiveEntry = { id: string; name: string; scenarioId?: string; eventsCount: number; detectionsCount: number; createdAt: string; source: string };
type Recording = { events: SimEvent[]; run: RunSummary; manifest?: { duration_s?: number } };
const clock = (seconds: number) => new Date(Math.max(0, seconds) * 1000).toISOString().slice(11, 19);
// Long recordings can hold far more events than a spread call can pass as
// arguments, so the latest recorded time is folded rather than spread.
const latestTimeS = (events: SimEvent[]) => events.reduce((max, event) => Math.max(max, event.tS), 0);
const frameLabel = (event: SimEvent) => clock(event.tS) + ' · ' + (event.scenarioObjectName ?? 'AUV frame');
async function json<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await authorizedFetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || 'Request failed (' + response.status + ')');
  return body as T;
}

export default function RunEventConsole() {
  const [searchParams] = useSearchParams();
  const linkedRunId = searchParams.get('runId');
  const [floorOnly, setFloorOnly] = useState(searchParams.get('view') === 'floor');
  const [showPings, setShowPings] = useState(true);
  const viewport = useRef<HTMLDivElement>(null);
  const labels = useRef(new Map<string, HTMLElement>());
  const scene = useRef<RunSceneController | null>(null);
  const [sceneError, setSceneError] = useState('');
  const [sceneAttempt, setSceneAttempt] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [archive, setArchive] = useState<ArchiveEntry[]>([]);
  const [archiveQuery, setArchiveQuery] = useState('');
  const [archiveId, setArchiveId] = useState('');
  const [recording, setRecording] = useState<Recording | null>(null);
  const [run, setRun] = useState<RunSummary | null>(null);
  const [liveFeed, setLiveFeed] = useState<RunFeed>(EMPTY_FEED);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [scenarios, setScenarios] = useState<Array<{ id: string; name: string }>>([]);
  const [scenarioId, setScenarioId] = useState('');
  const [runs, setRuns] = useState<Awaited<ReturnType<typeof fetchRuns>>>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [outline, setOutline] = useState(false);
  const [reliefScale, setReliefScale] = useState(3);
  const [pickedFrameId, setPickedFrameId] = useState<number | null>(null);
  const [logFilter, setLogFilter] = useState<'all' | 'frames' | 'detections' | 'alerts' | 'sonar'>('all');
  const [logSearch, setLogSearch] = useState('');
  const [imageFilter, setImageFilter] = useState<'normal' | 'contrast' | 'sonar' | 'mono'>('normal');
  const [lightbox, setLightbox] = useState<{ url: string; label: string } | null>(null);
  const floorFocused = useRef(false);
  const requestId = useRef(0);
  const duration = recording ? Math.max(0, recording.manifest?.duration_s ?? 0, latestTimeS(recording.events)) : run?.tS ?? 0;
  const feed = useMemo(() => recording ? replayFeedAt(recording.events, cursor, recording.run) : liveFeed, [recording, cursor, liveFeed]);
  const tracks = [...feed.tracks.values()];
  const selectedTrack = tracks.find(track => track.trackId === selected) ?? tracks[0];
  const selectedDetection = [...feed.events].reverse().find(event => event.type === 'FRAME_INFERRED' && event.trackId === selectedTrack?.trackId);
  const latestFrame = [...feed.events].reverse().find(event => event.frameUrl && (event.type === 'FRAME_CAPTURED' || event.type === 'FRAME_INFERRED'));
  const cells = [...feed.bathymetry.values()];
  const depths = cells.map(cell => cell.depthM);
  const surveySource = cells.some(cell => cell.source === 'SIMULATED_SONAR') ? 'Simulated sonar' : 'Recorded sonar';
  // The archive can hold hundreds of snapshots, many sharing a display name, so
  // it is searchable and every entry states its date and source before use.
  const archiveTerm = archiveQuery.trim().toLowerCase();
  const savedSurveys = useMemo(() => {
    const list = archive
      .filter(item => item.id !== 'REPLAY-01' && (item.detectionsCount ?? 0) > 0)
      .map(item => ({ ...item, createdLabel: item.createdAt ? new Date(item.createdAt).toISOString().slice(0, 10) : 'date unknown' }))
      .filter(item => !archiveTerm || [item.name, item.id, item.source, item.createdLabel].some(value => value.toLowerCase().includes(archiveTerm)));
    const seen = new Map<string, typeof list[0]>();
    for (const item of list) {
      const base = item.name.replace(/\s*·\s*SIM-RUN-\d+/i, '').trim();
      const key = `${item.scenarioId || ''}__${base}__${item.detectionsCount}`;
      const prev = seen.get(key);
      if (!prev || Date.parse(item.createdAt || '0') > Date.parse(prev.createdAt || '0')) {
        seen.set(key, item);
      }
    }
    return Array.from(seen.values());
  }, [archive, archiveTerm]);
  const selectedFloorDepth = selectedTrack ? sampledFloorDepth(cells, selectedTrack.eastM, selectedTrack.northM) : null;
  // Latest authored scenario identity/depth reported for each track. This is
  // visual reference data recorded alongside the replay — the model only ever
  // reports the `Mixed Waste` class — so it is shown as scenario context, never
  // as a model classification or a measured depth. Detection events arrive in
  // order, so the last write for a track wins.
  const objectInfo = new Map<string, { id?: string; name: string; depthM?: number }>();
  for (const event of feed.events) {
    if (event.trackId && event.scenarioObjectName) objectInfo.set(event.trackId, { id: event.scenarioObjectId, name: event.scenarioObjectName, depthM: event.scenarioDepthM });
  }
  const selectedObject = selectedTrack ? objectInfo.get(selectedTrack.trackId) : undefined;
  // Track state never carries scenario identity — only FRAME_* events do — so
  // the name/depth come from the selected detection or the objectInfo map.
  const selectedObjectName = selectedDetection?.scenarioObjectName ?? selectedObject?.name ?? 'Unidentified debris';
  const selectedObjectDepth = selectedDetection?.scenarioDepthM ?? selectedObject?.depthM;
  const frameEvents = feed.events.filter(event => event.frameUrl && (event.type === 'FRAME_CAPTURED' || event.type === 'FRAME_INFERRED'));
  const detectionTicks = useMemo(() => {
    if (!recording) return [];
    const set = new Map<number, SimEvent>();
    for (const e of recording.events) {
      if ((e.type === 'FRAME_INFERRED' || e.type === 'TRACK_CREATED') && e.tS >= 0) {
        const key = Math.round(e.tS * 2) / 2;
        if (!set.has(key)) set.set(key, e);
      }
    }
    return [...set.values()];
  }, [recording]);
  const visibleLog = useMemo(() => {
    let list = feed.events;
    if (logFilter === 'frames') {
      list = list.filter(e => e.type === 'FRAME_CAPTURED' || e.type === 'FRAME_INFERRED' || e.type === 'FRAME_FAILED');
    } else if (logFilter === 'detections') {
      list = list.filter(e => e.type === 'FRAME_INFERRED' || e.type === 'TRACK_CREATED' || e.type === 'TRACK_UPDATED');
    } else if (logFilter === 'alerts') {
      list = list.filter(e => e.type === 'ALERT');
    } else if (logFilter === 'sonar') {
      list = list.filter(e => e.type === 'BATHYMETRY');
    }
    if (logSearch.trim()) {
      const q = logSearch.toLowerCase().trim();
      list = list.filter(e =>
        e.type.toLowerCase().includes(q) ||
        (e.message && e.message.toLowerCase().includes(q)) ||
        (e.scenarioObjectName && e.scenarioObjectName.toLowerCase().includes(q)) ||
        (e.trackId && e.trackId.toLowerCase().includes(q)) ||
        (e.className && e.className.toLowerCase().includes(q))
      );
    }
    return list;
  }, [feed.events, logFilter, logSearch]);
  const pickedFrame = pickedFrameId === null ? undefined : frameEvents.find(event => event.id === pickedFrameId);
  const shownFrame = pickedFrame ?? (selectedDetection?.frameUrl ? selectedDetection : latestFrame);
  const seek = (value: number) => { setPlaying(false); setCursor(Math.min(duration, Math.max(0, value))); };
  // Selecting a contact also clears any frame the operator picked by hand, so
  // the image viewer always follows the contact that is actually selected.
  const selectTrack = (trackId: string | null) => { setSelected(trackId); setPickedFrameId(null); };
  const selectTrackRef = useRef(selectTrack);
  selectTrackRef.current = selectTrack;

  async function refresh(signal?: AbortSignal) {
    const [catalogue, availableRuns, availableScenarios] = await Promise.all([
      json<{ replays: ArchiveEntry[] }>('/api/simulation/replays', { signal }), fetchRuns(signal), fetchScenarios(signal),
    ]);
    setArchive(catalogue.replays.slice().reverse());
    setRuns(availableRuns);
    setScenarios(availableScenarios.filter(item => item.mode !== 'REPLAY'));
    setScenarioId(previous => previous || availableScenarios.find(item => item.mode !== 'REPLAY')?.id || '');
  }
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    const tick = async () => {
      if (pending) return;
      pending = true;
      try { await refresh(controller.signal); } catch (cause) { if (!controller.signal.aborted) setError(String(cause)); }
      finally { pending = false; }
    };
    void tick();
    const timer = window.setInterval(tick, 5000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!viewport.current) return;
    try { scene.current = createRunScene(viewport.current, { onSelectTrack: trackId => selectTrackRef.current(trackId), onError: message => setSceneError(message ?? ''), labels: labels.current }); }
    catch (cause) { setSceneError(cause instanceof Error ? cause.message : '3D view could not start.'); }
    return () => { scene.current?.dispose(); scene.current = null; };
  }, [sceneAttempt]);
  useEffect(() => {
    scene.current?.setReliefScale(reliefScale);
    scene.current?.update(feed);
    scene.current?.setFloorOnly(floorOnly);
    scene.current?.setFloorPings(showPings);
    scene.current?.toggleSeabedOutline(outline);
    if (floorOnly && feed.bathymetry.size > 0 && !floorFocused.current) {
      scene.current?.focusOceanFloor();
      floorFocused.current = true;
    }
    if (!floorOnly) floorFocused.current = false;
  }, [feed, sceneAttempt, outline, floorOnly, reliefScale, showPings]);
  useEffect(() => { scene.current?.select(selectedTrack?.trackId ?? null); }, [selectedTrack?.trackId, feed, sceneAttempt]);

  useEffect(() => {
    if (!run || recording) return;
    let stopped = false, pending = false, since = 0, missing = 0;
    const controller = new AbortController();
    setLiveFeed(EMPTY_FEED);
    const poll = async () => {
      if (pending) return;
      pending = true;
      try {
        const [summary, batch] = await Promise.all([fetchRun(run.id, controller.signal), fetchEvents(run.id, since, controller.signal)]);
        if (stopped) return;
        // Restarted runs reset their event IDs and must not retain the previous mission.
        if (batch.cursor.lastEventId < since) { since = 0; setLiveFeed(EMPTY_FEED); }
        else { since = batch.cursor.lastEventId; setLiveFeed(previous => foldEvents(previous, batch.events, summary)); }
        setRun(summary);
        setError('');
        missing = 0;
      } catch (cause) {
        if (stopped) return;
        // A 404 can be a single poll landing on another server instance; only
        // give up on the session once it stays missing.
        if (/HTTP 404/.test(String(cause)) && ++missing >= 5) {
          stopped = true;
          window.clearInterval(timer);
          setRun(null);
          setError('This live session is no longer available on the server. Choose a saved recording below (Replay 1–3 are always available).');
          return;
        }
        setError('Event feed interrupted. Last received observations remain visible. ' + String(cause));
      }
      finally { pending = false; }
    };
    void poll();
    const timer = window.setInterval(poll, 700);
    return () => { stopped = true; controller.abort(); window.clearInterval(timer); };
  }, [run?.id, run?.restartCount, recording]);

  useEffect(() => {
    if (!recording || !playing) return;
    let previous = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now(), elapsed = (now - previous) / 1000 * speed;
      previous = now;
      setCursor(value => Math.min(duration, value + elapsed));
    }, 80);
    return () => window.clearInterval(timer);
  }, [recording, playing, speed, duration]);
  useEffect(() => { if (cursor >= duration) setPlaying(false); }, [cursor, duration]);

  // Keyboard scrubbing while a recording is open: Space plays/pauses, the arrow
  // keys step (Shift steps further), Home/End jump to the start/end of the run.
  // Ignored while a form control has focus so typing is never hijacked.
  useEffect(() => {
    if (!recording) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A'].includes(target.tagName) || target.isContentEditable)) return;
      if (event.key === ' ') { event.preventDefault(); setCursor(value => (value >= duration ? 0 : value)); setPlaying(value => !value); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); seek(cursor + (event.shiftKey ? 30 : 5)); }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); seek(cursor - (event.shiftKey ? 30 : 5)); }
      else if (event.key === 'Home') { event.preventDefault(); seek(0); }
      else if (event.key === 'End') { event.preventDefault(); seek(duration); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [recording, cursor, duration]);

  async function act(action: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  async function openArchive(id: string) {
    const attempt = ++requestId.current;
    setPlaying(false);
    await act(async () => {
      const data = await json<Recording>('/api/simulation/replays/' + encodeURIComponent(id));
      if (attempt !== requestId.current) return;
      if (!Array.isArray(data.events) || !data.run) throw new Error('This legacy fixture has no original run-event recording. Choose a saved survey from a new monitoring session.');
      floorFocused.current = false;
      setRecording(data); setArchiveId(id); setRun(null); setLiveFeed(EMPTY_FEED); setCursor(floorOnly ? latestTimeS(data.events) : 0); setSelected(null); setPickedFrameId(null);
    });
  }
  async function followRun(id: string) {
    const attempt = ++requestId.current;
    await act(async () => { const summary = await fetchRun(id); if (attempt !== requestId.current) return; setRecording(null); setArchiveId(''); setPlaying(false); setSelected(null); setPickedFrameId(null); setLiveFeed(EMPTY_FEED); setRun(summary); }); }
  async function deleteArchive(id: string) {
    if (!id) return;
    await act(async () => {
      await json('/api/simulation/replays/' + encodeURIComponent(id), { method: 'DELETE' });
      if (archiveId === id) {
        setRecording(null);
        setArchiveId('');
      }
      await refresh();
      setNotice('Recording deleted successfully.');
    });
  }

  useEffect(() => {
    if (!linkedRunId) return;
    let cancelled = false;
    const attempt = ++requestId.current;
    void (async () => {
      try {
        const saved = await json<{ replay: ArchiveEntry }>('/api/simulation/runs/' + encodeURIComponent(linkedRunId) + '/save-replay', { method: 'POST' });
        const data = await json<Recording>('/api/simulation/replays/' + encodeURIComponent(saved.replay.id));
        if (cancelled || attempt !== requestId.current) return;
        floorFocused.current = false;
        setRecording(data); setArchiveId(saved.replay.id); setRun(null); setCursor(floorOnly ? latestTimeS(data.events) : 0); setPlaying(false); setPickedFrameId(null);
        await refresh();
      } catch (cause) { if (!cancelled) setError('Could not open this session recording. Choose a saved survey below. ' + String(cause)); }
    })();
    return () => { cancelled = true; };
  }, [linkedRunId]);

  // One log row. Rows that belong to a contact are buttons, so clicking an
  // entry selects the ping it came from; camera frames show a thumbnail and
  // detection rows carry the recorded object name and its scenario depth.
  const logRow = (event: SimEvent) => {
    const info = event.trackId ? objectInfo.get(event.trackId) : undefined;
    const name = event.scenarioObjectName ?? info?.name;
    const depth = event.scenarioDepthM ?? info?.depthM;
    const hasFrame = Boolean(event.frameUrl) && (event.type === 'FRAME_CAPTURED' || event.type === 'FRAME_INFERRED');
    const badgeClass =
      event.type === 'FRAME_INFERRED' || event.type === 'TRACK_CREATED' || event.type === 'TRACK_UPDATED'
        ? 'replay-badge-detection'
        : event.type === 'FRAME_CAPTURED'
        ? 'replay-badge-camera'
        : event.type === 'ALERT'
        ? 'replay-badge-alert'
        : event.type === 'BATHYMETRY'
        ? 'replay-badge-sonar'
        : 'replay-badge-nav';

    const typeLabel =
      event.type === 'FRAME_INFERRED' ? 'DETECTION' :
      event.type === 'FRAME_CAPTURED' ? 'CAMERA' :
      event.type === 'TRACK_CREATED' ? 'NEW CONTACT' :
      event.type === 'TRACK_UPDATED' ? 'TRACK UPDATE' :
      event.type === 'BATHYMETRY' ? 'BATHYMETRY' :
      event.type.replaceAll('_', ' ');

    const body = (
      <>
        {hasFrame && (
          <div className="relative flex-none">
            {event.scenarioObjectId && isSharedSimulationFixture(event.frameUrl)
              ? <span className="replay-log-thumb"><ScenarioObjectPreview id={event.scenarioObjectId} name={event.scenarioObjectName ?? 'debris'} /></span>
              : <img className="replay-log-thumb" src={event.frameUrl} alt="" loading="lazy" />}
            <span className="replay-log-thumb-badge"><Camera className="h-2.5 w-2.5" /></span>
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className={`replay-event-badge ${badgeClass}`}>{typeLabel}</span>
            <time className="font-mono text-[11px] text-[var(--ocean-text-dim)]">{clock(event.tS)}</time>
          </div>
          {name && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className="font-semibold text-amber-300">{name}</span>
              {depth !== undefined && (
                <span className="replay-depth-tag">{depth.toFixed(1)} m depth</span>
              )}
            </div>
          )}
          <p className="mt-1 text-[var(--ocean-text-dim)] truncate">
            {event.message || event.className || (event.type === 'BATHYMETRY' ? 'Sonar bathymetry sample recorded' : event.provenance)}
          </p>
        </div>
      </>
    );

    const inspectable = Boolean(event.trackId || hasFrame);
    const className = 'replay-log-row rounded-lg border border-[var(--ocean-border)] px-3 py-2 text-xs transition-colors hover:border-cyan-400/50';
    return inspectable ? (
      <button
        key={event.id}
        type="button"
        className={className}
        aria-label={'Inspect ' + event.type.replaceAll('_', ' ') + ' at ' + clock(event.tS) + (name ? ' for ' + name : '')}
        onClick={() => {
          if (recording) seek(event.tS);
          if (event.trackId) {
            setSelected(event.trackId);
            scene.current?.zoomToTrack(event.trackId);
          }
          if (hasFrame) setPickedFrameId(event.id);
          else setPickedFrameId(null);
        }}
      >
        {body}
      </button>
    ) : (
      <div key={event.id} className={className}>{body}</div>
    );
  };

  return <section className="replay-workspace overflow-hidden rounded-2xl border border-[var(--ocean-border)] bg-[#0b1622]">
    <div className="space-y-3 border-b border-[var(--ocean-border)] p-3 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-lg font-semibold">Run event 3D view</h2><p className="mt-1 hidden text-sm text-[var(--ocean-text-dim)] sm:block">Recorded simulated observations, tracked contacts, and survey coverage.</p></div>
        <Badge variant={recording ? 'purple' : run ? 'cyan' : 'default'}>{recording ? 'SAVED REPLAY' : run ? run.mode + ' · ' + run.state : 'SELECT A SESSION'}</Badge>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 w-full flex-none text-xs text-[var(--ocean-text-dim)] sm:w-auto sm:flex-1">Saved surveys
          <div className="mt-1 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <input className="replay-select w-full" type="search" value={archiveQuery} placeholder="Search recordings by name, date or source" aria-label="Search saved surveys" onChange={event => setArchiveQuery(event.target.value)} />
            <select aria-label="Choose a saved survey" className="replay-select w-full" value={archiveId} disabled={busy} onChange={event => event.target.value && void openArchive(event.target.value)}>
              <option value="">Choose a recording ({savedSurveys.length}{archiveTerm ? ' matching' : ''})</option>
              {savedSurveys.map(item => <option key={item.id} value={item.id}>{item.createdLabel} · {item.source} · {item.name} · {item.detectionsCount} detections</option>)}
            </select>
          </div>
        </div>
        <Button variant="outline" size="sm" icon={<RefreshCw className="h-4 w-4" />} disabled={busy} onClick={() => void act(() => refresh())}>Refresh archive</Button>
        {archiveId && (
          <Button variant="outline" size="sm" icon={<Trash2 className="h-4 w-4 text-rose-400" />} disabled={busy} onClick={() => void deleteArchive(archiveId)}>
            Delete recording
          </Button>
        )}
      </div>
      {!savedSurveys.length && <p className="text-sm text-[var(--ocean-text-dim)]">{archiveTerm ? 'No saved survey matches “' + archiveQuery.trim() + '”.' : 'No saved surveys yet. Start a monitoring session; its observations are saved automatically.'}</p>}
      <details className="rounded-lg border border-[var(--ocean-border)] p-3">
        <summary className="cursor-pointer text-sm font-medium">Run a survey or follow an active session</summary>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select aria-label="Survey scenario" className="replay-select" value={scenarioId} onChange={event => setScenarioId(event.target.value)}>{scenarios.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          <Button size="sm" disabled={busy || !scenarioId || run?.state === 'RUNNING' || run?.state === 'PAUSED'} onClick={() => void act(async () => { const next = await startRun(scenarioId, 1); setRecording(null); setArchiveId(''); setLiveFeed(EMPTY_FEED); setRun(next); })}>Start survey</Button>
          <select aria-label="Existing monitoring session" className="replay-select" value={run?.id ?? ''} disabled={busy} onChange={event => event.target.value && void followRun(event.target.value)}><option value="">Follow existing session</option>{runs.map(item => <option key={item.id} value={item.id}>{item.name} · {item.state}</option>)}</select>
          {run && <><Button size="sm" variant="outline" disabled={busy || !['RUNNING','PAUSED'].includes(run.state)} onClick={() => void act(async () => setRun(await commandRun(run.id, run.state === 'RUNNING' ? 'pause' : 'resume')))}>{run.state === 'RUNNING' ? 'Pause run' : 'Resume run'}</Button><Button size="sm" variant="outline" disabled={busy} icon={<Save className="h-4 w-4" />} onClick={() => void act(async () => { await json('/api/simulation/runs/' + encodeURIComponent(run.id) + '/save-replay', { method: 'POST' }); await refresh(); setNotice('Recording saved. Open it from Saved surveys.'); })}>Save snapshot</Button></>}
        </div>
      </details>
      {error && <p role="alert" className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200">{error}</p>}
      {notice && <p role="status" className="text-sm text-cyan-200">{notice}</p>}
      {run?.recordingError && <p role="alert" className="text-sm text-amber-200">Recording is not saved to disk. Keep this session open and retry Save snapshot.</p>}
    </div>
    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--ocean-border)] p-3">
      <Button size="sm" variant="outline" icon={<Compass className="h-4 w-4" />} aria-pressed={floorOnly} onClick={() => { setFloorOnly(value => !value); scene.current?.focusOceanFloor(); }}>{floorOnly ? 'Full survey' : 'Floor-only model'}</Button>
      <Button size="sm" variant="outline" icon={<RotateCcw className="h-4 w-4" />} onClick={() => { floorFocused.current = false; if (floorOnly) scene.current?.focusOceanFloor(); else scene.current?.resetCamera(); }}>Reset view</Button>
      <label className="ml-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={outline} onChange={event => setOutline(event.target.checked)} /> Cell outlines</label>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={showPings} onChange={event => setShowPings(event.target.checked)} /> Waste pings ({tracks.length})</label>
      <label className="flex items-center gap-2 text-xs">Relief <select aria-label="Vertical relief scale" className="replay-select" value={reliefScale} onChange={event => { setReliefScale(Number(event.target.value)); floorFocused.current = false; }}><option value={1}>1× true scale</option><option value={3}>3×</option><option value={6}>6×</option></select></label>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" aria-label="Zoom in" title="Zoom in" icon={<ZoomIn className="h-4 w-4" />} onClick={() => scene.current?.zoomBy(0.7)} />
        <Button size="sm" variant="outline" aria-label="Zoom out" title="Zoom out" icon={<ZoomOut className="h-4 w-4" />} onClick={() => scene.current?.zoomBy(1.4)} />
        {selectedTrack && <Button size="sm" variant="outline" icon={<Crosshair className="h-4 w-4" />} onClick={() => scene.current?.zoomToTrack(selectedTrack.trackId)}>Zoom to ping</Button>}
      </div>
      <p className="hidden w-full text-xs text-[var(--ocean-text-dim)] sm:block">Drag to orbit · scroll or pinch to zoom · right-drag or two-finger drag to pan. Select a ping, then use Zoom to ping for detail.</p>
    </div>
    <div className="relative h-[520px] min-h-[360px] sm:h-[600px] lg:h-[660px]">
      <div ref={viewport} className="absolute inset-0" role="img" aria-label="Recorded ocean survey in 3D. Colored cells show measured depths; blank areas are unmapped." />
      {showPings && <div className="replay-run-labels">{tracks.map((track, index) => {
        const info = objectInfo.get(track.trackId);
        const floorDepth = sampledFloorDepth(cells, track.eastM, track.northM);
        const title = [
          info?.name ?? 'Unidentified debris',
          info?.depthM !== undefined ? 'Scenario depth ' + info.depthM.toFixed(1) + ' m (authored reference)' : null,
          floorDepth === null ? 'Surveyed floor depth unknown here' : 'Surveyed floor depth ' + floorDepth.toFixed(1) + ' m',
          'Estimated horizontal position',
        ].filter(Boolean).join(' · ');
        return <button key={track.trackId} ref={element => { if (element) labels.current.set(track.trackId, element); else labels.current.delete(track.trackId); }} type="button" className="replay-contact-label" title={title} aria-pressed={selectedTrack?.trackId === track.trackId} onClick={() => selectTrack(track.trackId)}>{info?.id ? <span className="replay-object-glyph" aria-hidden="true"><ScenarioObjectPreview id={info.id} name={info.name} /></span> : <span className="replay-ping-dot" />}<span className="replay-ping-name">{info?.name ?? 'Waste ping ' + String(index + 1).padStart(2, '0')}</span>{info?.depthM !== undefined && <span className="replay-ping-depth">{info.depthM.toFixed(1)} m</span>}</button>;
      })}</div>}
      <div className="pointer-events-none absolute left-3 top-3 z-10 max-w-[min(320px,calc(100%-24px))] space-y-1.5 rounded-lg border border-white/10 bg-[#08121e]/90 p-3 text-xs">
        <p className="font-mono text-cyan-200">{recording ? 'REPLAY' : 'RUN'} {clock(recording ? cursor : run?.tS ?? 0)}</p>
        <p>{cells.length ? surveySource + ' · ' + cells.length + ' mapped cells' : 'Ocean floor not yet surveyed'}</p>
        {floorOnly && <p>Floor model · {reliefScale}× vertical relief (display only)</p>}
        {floorOnly && <p className="text-[var(--ocean-text-dim)]">Object shapes and sizes are illustrative</p>}
        <p className="text-[var(--ocean-text-dim)]">{depths.length ? Math.min(...depths).toFixed(1) + '–' + Math.max(...depths).toFixed(1) + ' m depth · ' : ''}Blank areas = unknown</p>
        {depths.length > 0 && <div className="replay-depth-legend"><div className="replay-depth-ramp" /><div><span>Shallow {Math.min(...depths).toFixed(1)} m</span><span>Deep {Math.max(...depths).toFixed(1)} m</span></div></div>}
        {feed.platformLocationUnknown && <p className="text-amber-200">Location unknown · last fix retained</p>}
      </div>
      {showPings && selectedTrack && <div className="replay-selected-ping"><strong>{selectedObjectName}</strong><span>{selectedTrack.trackId} · {selectedTrack.status}</span>{selectedObjectDepth !== undefined && <span>Scenario object depth {selectedObjectDepth.toFixed(1)} m below surface (authored visual reference, not a model measurement)</span>}<span>Model: {selectedDetection?.className ?? 'Unclassified'} · {selectedDetection?.confidence === undefined ? 'confidence unavailable' : selectedDetection.confidence.toFixed(1) + '% confidence'}</span><span>Surveyed floor depth: {selectedFloorDepth === null ? 'unknown — no sonar sample at this position' : selectedFloorDepth.toFixed(1) + ' m'}</span></div>}
      {!run && !recording && <p className="pointer-events-none absolute bottom-5 left-0 right-0 text-center text-sm text-[var(--ocean-text-dim)]">Choose a saved survey to explore its observations.</p>}
      {sceneError && <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#08121e]/95 p-5 text-center"><p>{sceneError}</p><Button onClick={() => { setSceneError(''); setSceneAttempt(value => value + 1); }}>Retry 3D view</Button></div>}
    </div>
    {recording && (
      <div className="replay-timeline border-y border-[var(--ocean-border)] p-4 bg-[#08121e]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              icon={playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              onClick={() => { if (cursor >= duration) setCursor(0); setPlaying(value => !value); }}
            >
              {playing ? 'Pause' : 'Play replay'}
            </Button>
            <Button size="sm" variant="outline" aria-label="Jump to start" title="Jump to start (Home)" icon={<SkipBack className="h-4 w-4" />} onClick={() => seek(0)} />
            <Button size="sm" variant="outline" aria-label="Back 10 seconds" title="Back 10 seconds" onClick={() => seek(cursor - 10)}>−10 s</Button>
            <Button size="sm" variant="outline" aria-label="Forward 10 seconds" title="Forward 10 seconds" onClick={() => seek(cursor + 10)}>+10 s</Button>
            <Button size="sm" variant="outline" aria-label="Jump to end" title="Jump to end (End)" icon={<SkipForward className="h-4 w-4" />} onClick={() => seek(duration)}>
              End
            </Button>
            <span className="font-mono text-xs px-2 py-1 rounded bg-[#0a1826] border border-[var(--ocean-border)] text-cyan-200">
              {clock(cursor)} / {clock(duration)}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs text-[var(--ocean-text-dim)] mr-1">Speed:</span>
            {[0.5, 1, 2, 4, 8, 16].map((rate) => (
              <button
                key={rate}
                type="button"
                className={`replay-speed-pill ${speed === rate ? 'active' : ''}`}
                onClick={() => setSpeed(rate)}
                title={`Playback speed ${rate}×`}
              >
                {rate}×
              </button>
            ))}
          </div>
        </div>

        <div
          className="replay-timeline-track-wrap mt-2"
          title="Scroll mouse wheel to scrub timeline"
          onWheel={(event) => {
            event.preventDefault();
            seek(cursor + (event.deltaY > 0 ? 5 : -5));
          }}
        >
          <div className="replay-timeline-ticks" aria-hidden="true">
            {detectionTicks.map((tick) => {
              const leftPct = Math.min(100, Math.max(0, (tick.tS / (duration || 1)) * 100));
              return (
                <span
                  key={tick.id}
                  className="replay-timeline-tick"
                  style={{ left: `${leftPct}%` }}
                  title={`Detection at ${clock(tick.tS)}: ${tick.scenarioObjectName ?? 'Debris contact'}`}
                />
              );
            })}
          </div>
          <input
            className="replay-range"
            type="range"
            aria-label="Replay time: scrub to any moment up to the end of the recording"
            min={0}
            max={duration || 1}
            step={0.1}
            value={cursor}
            onChange={event => seek(Number(event.target.value))}
          />
        </div>
        <div className="flex items-center justify-between text-[11px] text-[var(--ocean-text-dim)]">
          <span>Tip: Drag slider, mouse wheel scroll, or use ←/→ (Shift=30s), Home/End. Amber marks show debris detections.</span>
          <span className="font-mono text-amber-300/80">{detectionTicks.length} detections on timeline</span>
        </div>
      </div>
    )}
    <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-2">
      <div className="space-y-4">
        <div>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Target className="h-4 w-4 text-cyan-400" />
              Detected objects <span className="text-cyan-200">({tracks.length})</span>
            </h3>
            {selectedTrack && (
              <Button
                size="xs"
                variant="outline"
                icon={<Crosshair className="h-3.5 w-3.5" />}
                onClick={() => scene.current?.zoomToTrack(selectedTrack.trackId)}
              >
                Center 3D View
              </Button>
            )}
          </div>
          <div className="my-2.5 flex max-h-32 flex-wrap gap-2 overflow-auto">
            {tracks.map(track => {
              const info = objectInfo.get(track.trackId);
              const isSelected = selectedTrack?.trackId === track.trackId;
              return (
                <button
                  key={track.trackId}
                  title={track.trackId}
                  aria-pressed={isSelected}
                  onClick={() => selectTrack(track.trackId)}
                  className={'rounded-lg border px-3 py-1.5 text-xs transition-all ' + (isSelected ? 'border-cyan-300 bg-cyan-300/15 shadow-[0_0_12px_rgba(0,245,212,0.25)]' : 'border-[var(--ocean-border)] hover:border-cyan-500/50')}
                >
                  <span className="font-medium text-amber-200">{info?.name ?? track.trackId}</span>
                  <span className="ml-1.5 text-[10px] text-cyan-300">({track.status})</span>
                  {info?.depthM !== undefined && (
                    <span className="ml-1.5 text-[10px] text-amber-300/80">{info.depthM.toFixed(1)}m</span>
                  )}
                </button>
              );
            })}
          </div>
          {!tracks.length && <p className="my-3 text-sm text-[var(--ocean-text-dim)]">No objects detected at this point in the recording.</p>}
        </div>

        {selectedTrack && (
          <div className="rounded-xl border border-cyan-400/20 bg-[#07131f]/80 p-3.5 space-y-2.5">
            <div className="flex items-center justify-between border-b border-[var(--ocean-border)] pb-2">
              <div>
                <h4 className="text-sm font-bold text-amber-300">{selectedObjectName}</h4>
                <p className="text-[11px] font-mono text-[var(--ocean-text-dim)]">{selectedTrack.trackId} · {selectedTrack.status}</p>
              </div>
              {selectedObjectDepth !== undefined && (
                <div className="text-right">
                  <span className="rounded-full bg-amber-400/20 px-2.5 py-1 text-xs font-semibold text-amber-200 border border-amber-400/40">
                    Depth {selectedObjectDepth.toFixed(1)} m
                  </span>
                </div>
              )}
            </div>

            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
              <dt className="text-[var(--ocean-text-dim)]">Scenario Debris Depth</dt>
              <dd className="font-semibold text-amber-100">{selectedObjectDepth !== undefined ? `${selectedObjectDepth.toFixed(1)} m below surface` : 'Not recorded'}</dd>

              <dt className="text-[var(--ocean-text-dim)]">Surveyed Floor Depth</dt>
              <dd className="text-cyan-200">{selectedFloorDepth === null ? 'Unknown (no sonar ping)' : `${selectedFloorDepth.toFixed(1)} m`}</dd>

              {selectedFloorDepth !== null && selectedObjectDepth !== undefined && (
                <>
                  <dt className="text-[var(--ocean-text-dim)]">Clearance to Seabed</dt>
                  <dd className="text-emerald-300 font-semibold">{Math.max(0, selectedFloorDepth - selectedObjectDepth).toFixed(1)} m</dd>
                </>
              )}

              <dt className="text-[var(--ocean-text-dim)]">AI Model Class</dt>
              <dd className="text-cyan-300">{selectedDetection?.className ?? 'Not available'}</dd>

              <dt className="text-[var(--ocean-text-dim)]">Model Confidence</dt>
              <dd className="text-emerald-300 font-mono">{selectedDetection?.confidence !== undefined ? `${selectedDetection.confidence.toFixed(1)}%` : 'Not available'}</dd>

              <dt className="text-[var(--ocean-text-dim)]">Horizontal Location</dt>
              <dd className="font-mono text-[var(--ocean-text)]">E {selectedTrack.eastM.toFixed(1)} · N {selectedTrack.northM.toFixed(1)} m</dd>

              <dt className="text-[var(--ocean-text-dim)]">Uncertainty</dt>
              <dd className="text-[var(--ocean-text-dim)]">±{selectedTrack.uncertaintyM.toFixed(1)} m</dd>

              <dt className="text-[var(--ocean-text-dim)]">Operator Review</dt>
              <dd><Badge variant={selectedTrack.reviewStatus === 'CONFIRMED' ? 'green' : 'cyan'}>{selectedTrack.reviewStatus ?? 'UNREVIEWED'}</Badge></dd>
            </dl>
          </div>
        )}

        {shownFrame?.scenarioObjectId && isSharedSimulationFixture(shownFrame.frameUrl) && <figure className="replay-scenario-preview">
          <ScenarioObjectPreview id={shownFrame.scenarioObjectId} name={shownFrame.scenarioObjectName ?? selectedObjectName} />
          <figcaption>Authored scenario depiction · {shownFrame.scenarioObjectName ?? selectedObjectName}. The detector uses a shared synthetic fixture.</figcaption>
        </figure>}
        {shownFrame?.frameUrl && (
          <details key={shownFrame.id} className="replay-source-frame" open={!isSharedSimulationFixture(shownFrame.frameUrl) || !shownFrame.scenarioObjectId}>
          <summary>{shownFrame.scenarioObjectId && isSharedSimulationFixture(shownFrame.frameUrl) ? 'Inspect original synthetic detector frame' : 'Captured AUV frame'}</summary>
          <figure className="mt-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Camera className="h-3.5 w-3.5 text-cyan-400" />
                <span className="text-xs font-semibold text-cyan-200">{isSharedSimulationFixture(shownFrame.frameUrl) ? 'Synthetic detector fixture' : 'Captured AUV Frame'}</span>
                {(shownFrame.scenarioDepthM ?? selectedObjectDepth) !== undefined && (
                  <span className="rounded bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200 border border-amber-400/30">
                    {(shownFrame.scenarioDepthM ?? selectedObjectDepth)?.toFixed(1)} m depth
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {(['normal', 'contrast', 'sonar', 'mono'] as const).map(mode => (
                  <button
                    key={mode}
                    type="button"
                    className={`replay-filter-btn ${imageFilter === mode ? 'active' : ''}`}
                    onClick={() => setImageFilter(mode)}
                  >
                    {mode === 'normal' ? 'Normal' : mode === 'contrast' ? 'Contrast' : mode === 'sonar' ? 'Sonar' : 'Mono'}
                  </button>
                ))}
              </div>
            </div>

            <div className="relative group">
              <button
                type="button"
                className="replay-frame-open"
                onClick={() => setLightbox({ url: shownFrame.frameUrl!, label: frameLabel(shownFrame) })}
                aria-label="Open the captured frame at full size"
              >
                <img
                  className={`replay-frame-img filter-${imageFilter}`}
                  src={shownFrame.frameUrl}
                  alt={'AUV camera frame at ' + clock(shownFrame.tS)}
                />

                {/* Tactical HUD overlays */}
                <div className="replay-hud-corners" aria-hidden="true">
                  <span className="corner tl" />
                  <span className="corner tr" />
                  <span className="corner bl" />
                  <span className="corner br" />
                </div>

                <span className="replay-frame-zoom">
                  <Maximize2 className="h-3.5 w-3.5" /> Enlarge
                </span>
              </button>
            </div>

            <figcaption className="flex items-center justify-between text-xs text-[var(--ocean-text-dim)]">
              <span>{shownFrame.scenarioObjectName ?? 'AUV camera'} · {clock(shownFrame.tS)}</span>
              {shownFrame.trackId && (
                <button
                  type="button"
                  className="text-cyan-400 hover:text-cyan-300 underline text-[11px]"
                  onClick={() => {
                    setSelected(shownFrame.trackId);
                    scene.current?.zoomToTrack(shownFrame.trackId);
                  }}
                >
                  Focus Contact in 3D
                </button>
              )}
            </figcaption>
          </figure>
          </details>
        )}

        {frameEvents.length > 1 && (
          <div className="replay-frame-strip" role="group" aria-label="Recorded frames">
            {frameEvents.map(event => (
              <button
                key={event.id}
                type="button"
                className={'replay-frame-thumb' + (event.id === shownFrame?.id ? ' is-active' : '')}
                title={(event.scenarioObjectName ?? 'AUV frame') + ' · ' + clock(event.tS)}
                aria-label={'Inspect frame at ' + clock(event.tS) + (event.scenarioObjectName ? ' for ' + event.scenarioObjectName : '')}
                aria-pressed={event.id === shownFrame?.id}
                onClick={() => {
                  if (recording) seek(event.tS);
                  setPickedFrameId(event.id);
                  if (event.trackId) setSelected(event.trackId);
                }}
              >
                {event.scenarioObjectId && isSharedSimulationFixture(event.frameUrl)
                  ? <ScenarioObjectPreview id={event.scenarioObjectId} name={event.scenarioObjectName ?? 'debris'} />
                  : <img src={event.frameUrl} alt="" loading="lazy" />}
                <span>{clock(event.tS)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ocean-border)] pb-2.5">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Layers className="h-4 w-4 text-cyan-400" />
            Observed event log <span className="text-cyan-200">({visibleLog.length}/{feed.events.length})</span>
          </h3>
          <div className="flex items-center gap-1 text-xs">
            <Search className="h-3.5 w-3.5 text-[var(--ocean-text-dim)]" />
            <input
              type="search"
              className="replay-log-search"
              placeholder="Search events..."
              value={logSearch}
              onChange={e => setLogSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Multi-category filter tabs */}
        <div className="replay-filter-tabs flex flex-wrap gap-1">
          {[
            { id: 'all', label: `All (${feed.events.length})` },
            { id: 'detections', label: `Detections (${feed.events.filter(e => e.type === 'FRAME_INFERRED' || e.type === 'TRACK_CREATED').length})` },
            { id: 'frames', label: `Frames (${frameEvents.length})` },
            { id: 'alerts', label: `Alerts (${feed.events.filter(e => e.type === 'ALERT').length})` },
            { id: 'sonar', label: `Sonar (${feed.events.filter(e => e.type === 'BATHYMETRY').length})` },
          ].map(tab => (
            <button
              key={tab.id}
              type="button"
              className={`replay-filter-tab ${logFilter === tab.id ? 'active' : ''}`}
              onClick={() => setLogFilter(tab.id as any)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="replay-event-list space-y-2 overflow-auto max-h-[38rem] pr-1">
          {[...visibleLog].sort((a, b) => b.tS - a.tS || b.id - a.id).map(logRow)}
          {!visibleLog.length && (
            <p className="text-sm text-[var(--ocean-text-dim)] p-4 text-center rounded-lg border border-dashed border-[var(--ocean-border)]">
              No matching events found for current filters.
            </p>
          )}
        </div>
      </div>
    </div>
    <Modal isOpen={Boolean(lightbox)} onClose={() => setLightbox(null)} title={lightbox?.label ?? 'Captured frame'} subtitle="Original AUV camera frame — simulated survey" size="xl">
      {lightbox && <div className="space-y-3">
        <div className="flex justify-between items-center px-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-[var(--ocean-text-dim)]">Filter:</span>
            {(['normal', 'contrast', 'sonar', 'mono'] as const).map(mode => (
              <button
                key={mode}
                type="button"
                className={`replay-filter-btn ${imageFilter === mode ? 'active' : ''}`}
                onClick={() => setImageFilter(mode)}
              >
                {mode === 'normal' ? 'Normal' : mode === 'contrast' ? 'High Contrast' : mode === 'sonar' ? 'Sonar Palette' : 'Monochrome'}
              </button>
            ))}
          </div>
          <a className="replay-frame-link" href={lightbox.url} target="_blank" rel="noreferrer">Open raw file <ExternalLink className="h-3.5 w-3.5" /></a>
        </div>
        <img src={lightbox.url} alt="Captured AUV camera frame at full size" className={`mx-auto max-h-[68vh] w-auto rounded-lg border border-[var(--ocean-border)] bg-black object-contain filter-${imageFilter}`} />
      </div>}
    </Modal>
  </section>;
}
