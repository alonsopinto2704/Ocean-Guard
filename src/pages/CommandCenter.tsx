import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, Camera, Shield, Target, Zap,
  TrendingUp, Activity, MapPin, X, Check, UserCheck, RefreshCw, Bell, ArrowRight
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';
import { dashboardApi, alertsApi, detectionsApi } from '../lib/api';
import { useSystem } from '../context/SystemContext';
import { useAuth } from '../context/AuthContext';
import { StatCard, Card, CardHeader } from '../components/ui/Card';
import { Badge, DataProvenanceBadge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { LoadingState } from '../components/ui/StateComponents';
import { formatRelativeTime } from '../lib/utils';
import type { Alert, Detection } from '../types';

// Series colors for the 7-day trend chart, keyed by recharts dataKey.
const TREND_COLORS = { plastic: '#00f5d4', fishingGear: '#ffaa00', metalGlass: '#4cd6fb', other: '#83948f' };

// Static demo dataset for the class-distribution pie (category totals, not live data).
const CATEGORY_DATA = [
  { name: 'Plastic', value: 638, color: '#00f5d4' },
  { name: 'Fishing Gear', value: 312, color: '#ffaa00' },
  { name: 'Metal/Glass', value: 198, color: '#4cd6fb' },
  { name: 'Organic', value: 89,  color: '#26fedc' },
  { name: 'Unknown', value: 47,  color: '#83948f' },
];

// Compact grid of live subsystem health readouts (system, AI, GPS, cameras, latency).
function SystemHealthPanel() {
  const { health, isOnline } = useSystem();
  const items = [
    { label: 'System',   value: health?.system ?? (isOnline ? 'ONLINE' : 'UNAVAILABLE'), ok: health?.system === 'ONLINE' },
    { label: 'AI Engine', value: health?.ai ?? 'STANDBY', ok: health?.ai === 'RUNNING' },
    // No real GPS receiver is connected in this prototype; the field arrives as
    // UNAVAILABLE and must never render as a healthy green chip.
    { label: 'GPS',      value: 'NO FIX', ok: false },
    { label: 'Internet', value: isOnline ? 'ONLINE' : 'OFFLINE', ok: isOnline },
    { label: 'Cameras',  value: health ? `${health.activeCameras}/${health.totalCameras}` : '—', ok: Boolean(health && health.activeCameras > 0) },
    { label: 'Latency',  value: health?.aiLatencyMs ? `${health.aiLatencyMs.toFixed(1)}ms` : '—', ok: true },
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map(item => (
        <div key={item.label} className="flex items-center justify-between px-3 py-2 rounded-lg bg-[var(--ocean-surface)] border border-[var(--ocean-border)]">
          <span className="text-xs text-[var(--ocean-text-dim)]">{item.label}</span>
          <span className={`text-xs font-mono font-semibold ${item.ok ? 'text-emerald-400' : 'text-amber-400'}`}>
            {item.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// Command Center dashboard: KPI cards, live trend/pie charts, alert feed,
// recent detections, subsystem health, and the alert-management modal.
export default function CommandCenter() {
  const { summary, health, isOnline, lastEvent } = useSystem();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [trends, setTrends] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);

  // Alert Manager Drawer / Modal
  const [isAlertModalOpen, setIsAlertModalOpen] = useState(false);
  const [alertFilter, setAlertFilter] = useState<'ALL' | 'UNRESOLVED' | 'CRITICAL'>('UNRESOLVED');
  const [processingAlertId, setProcessingAlertId] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Sonar chime helper — reuses ONE AudioContext for the page lifetime.
  // BUGFIX: previously created a fresh AudioContext per event and never closed it;
  // browsers cap concurrent AudioContexts (~6), after which alerts went silent.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const playSonarChime = () => {
    try {
      const saved = localStorage.getItem('oceanguard_display_settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.alertSound === 'Disabled') return;
      }
      const Ctor = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) return;
      // Lazily create and cache the context; resume() handles autoplay policy.
      const audioCtx = audioCtxRef.current ?? new Ctor();
      audioCtxRef.current = audioCtx;
      if (audioCtx.state === 'suspended') void audioCtx.resume();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.15); // A5
      gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.45);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.45); // oscillator is GC-able; context is reused
    } catch { /* Audio not supported or autoplay blocked */ }
  };

  // Close the cached AudioContext when leaving the page so the browser slot is freed.
  useEffect(() => () => { void audioCtxRef.current?.close(); }, []);

  // Fetch trends + alerts + detections in parallel. Failures stay visible:
  // an offline request must be distinguishable from empty results.
  const loadData = async () => {
    try {
      const [t, a, d] = await Promise.all([
        dashboardApi.trends(),
        alertsApi.list(),
        detectionsApi.list(),
      ]);
      setTrends(t.history ?? []);
      setAlerts(a.alerts ?? []);
      setDetections(d.detections ?? []);
      setLoadError(null);
      setLastLoadedAt(new Date());
    } catch (err: any) {
      // Keep previously loaded data on screen, but surface the failure.
      setLoadError(err?.message || 'Coastal telemetry is unreachable. Showing the last loaded data.');
    }
    finally { setLoading(false); }
  };

  useEffect(() => {
    loadData();
  }, []);

  // React to live SSE alerts: chime and refresh when an alert changes.
  useEffect(() => {
    if (lastEvent && lastEvent.type === 'ALERT_UPDATE') {
      playSonarChime();
      loadData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastEvent]);

  // Mark an alert ACKNOWLEDGED and splice the server response into local state.
  const handleAcknowledgeAlert = async (id: string) => {
    setProcessingAlertId(id);
    try {
      const updated = await alertsApi.updateStatus(id, 'ACKNOWLEDGED');
      setAlerts(curr => curr.map(a => a.id === id ? updated : a));
      setActionNotice(`Alert ${id} acknowledged.`);
      setTimeout(() => setActionNotice(null), 2500);
    } catch (err: any) {
      setActionNotice(`Failed to acknowledge alert: ${err.message}`);
    } finally {
      setProcessingAlertId(null);
    }
  };

  // Assign the alert to the current operator (or the default response unit).
  const handleAssignAlert = async (id: string) => {
    setProcessingAlertId(id);
    try {
      const assignee = user?.name || 'Coastal Response Unit';
      const updated = await alertsApi.assign(id, assignee);
      setAlerts(curr => curr.map(a => a.id === id ? updated : a));
      setActionNotice(`Alert ${id} assigned to ${assignee}.`);
      setTimeout(() => setActionNotice(null), 2500);
    } catch (err: any) {
      setActionNotice(`Failed to assign alert: ${err.message}`);
    } finally {
      setProcessingAlertId(null);
    }
  };

  // Close out an alert as RESOLVED.
  const handleResolveAlert = async (id: string) => {
    setProcessingAlertId(id);
    try {
      const updated = await alertsApi.updateStatus(id, 'RESOLVED');
      setAlerts(curr => curr.map(a => a.id === id ? updated : a));
      setActionNotice(`Alert ${id} resolved.`);
      setTimeout(() => setActionNotice(null), 2500);
    } catch (err: any) {
      setActionNotice(`Failed to resolve alert: ${err.message}`);
    } finally {
      setProcessingAlertId(null);
    }
  };

  if (loading) return <LoadingState message="Connecting to OceanGuard Command Center..." size="lg" className="h-full" />;

  const activeAlertsList = alerts.filter(a => ['TRIGGERED', 'ACKNOWLEDGED', 'ACTION_REQUIRED', 'ASSIGNED'].includes(a.status));
  const criticalCount = alerts.filter(a => a.priority === 'CRITICAL' && a.status !== 'RESOLVED').length;

  const kpis = [
    { label: 'Active Alerts',       value: activeAlertsList.length, color: '#ff5964', icon: <AlertTriangle className="w-5 h-5" />, path: '#alerts', trend: 'up',   trendValue: `${criticalCount} critical` },
    { label: 'Debris Detected',     value: detections.length || summary?.debrisDetected || '—', color: '#00f5d4', icon: <Target className="w-5 h-5" />, path: '/detections', trend: 'up', trendValue: '+47 today' },
    { label: 'High Risk Incidents', value: summary?.highRiskIncidents ?? '—', color: '#ffaa00', icon: <Shield className="w-5 h-5" />, path: '/detections', trend: 'up', trendValue: '+3 today' },
    { label: 'Active Hotspots',     value: summary?.activeHotspots ?? '—', color: '#4cd6fb', icon: <MapPin className="w-5 h-5" />, path: '/hotspots', trend: 'stable', trendValue: '0 change' },
    { label: 'Cleanup Missions',    value: summary?.cleanupMissions ?? '—', color: '#26fedc', icon: <Zap className="w-5 h-5" />, path: '/cleanup', trend: 'down', trendValue: 'Active teams' },
    { label: 'Cameras Online',      value: summary?.camerasOnline ?? '—', color: '#d7fff3', icon: <Camera className="w-5 h-5" />, path: '/sensors' },
  ];

  const filteredAlertsForModal = alerts.filter(a => {
    if (alertFilter === 'CRITICAL') return a.priority === 'CRITICAL';
    if (alertFilter === 'UNRESOLVED') return a.status !== 'RESOLVED';
    return true;
  });

  return (
    <div className="p-3 sm:p-6 space-y-5 sm:space-y-6 max-w-7xl mx-auto">
      {/* Data availability banner: visible error + retry, distinguishable from empty */}
      {loadError && (
        <div role="alert" className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-400" />
            <div>
              <p className="text-xs font-semibold text-amber-300">Live data unavailable</p>
              <p className="text-[11px] text-amber-200/80">{loadError}{lastLoadedAt ? ` Last updated ${formatRelativeTime(lastLoadedAt.toISOString())}.` : ' No data has loaded yet.'}</p>
            </div>
          </div>
          <Button variant="outline" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => { setLoading(true); void loadData(); }}>
            Retry
          </Button>
        </div>
      )}

      {/* Top Action Banner */}
      <div className="flex flex-col gap-3 rounded-lg border border-[#ff5964]/30 bg-gradient-to-r from-[#93000a]/20 to-[#161c28] p-4 sm:flex-row sm:items-center sm:justify-between shadow-lg">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded border border-[#ff5964]/40 bg-[#ff5964]/10 text-[#ff7b84]">
            <AlertTriangle className="h-4 w-4 animate-pulse" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[#dde2f3]">
              {activeAlertsList.length} alert{activeAlertsList.length === 1 ? '' : 's'} requiring operational attention ({criticalCount} Critical)
            </p>
            <p className="mt-0.5 text-xs text-[#b9cac4]">
              Inspect anomaly triggers, dispatch cleanup missions, and acknowledge environmental risk notifications.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="danger"
            size="sm"
            onClick={() => setIsAlertModalOpen(true)}
            icon={<Bell className="w-4 h-4" />}
          >
            Review All Alerts ({activeAlertsList.length})
          </Button>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4">
        {kpis.map(k => (
          <StatCard
            key={k.label}
            label={k.label}
            value={k.value}
            color={k.color}
            icon={k.icon}
            trend={k.trend as any}
            trendValue={k.trendValue}
            onClick={() => {
              if (k.path === '#alerts') {
                setIsAlertModalOpen(true);
              } else {
                navigate(k.path);
              }
            }}
          />
        ))}
      </div>

      {/* Main Charts Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Trend chart — 2/3 width */}
        <Card className="xl:col-span-2" noPad>
          <CardHeader
            title="7-Day Coastal Debris Detection Volume"
            subtitle="Sample incident trend across demo sectors"
            icon={<TrendingUp className="w-4 h-4 text-cyan-400" />}
            action={<DataProvenanceBadge status="SAMPLE" label="SAMPLE TRENDS" />}
            className="px-4 pt-4"
          />
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={trends} margin={{ left: -10, right: 12, bottom: 0 }}>
              <defs>
                {Object.entries(TREND_COLORS).map(([k, c]) => (
                  <linearGradient key={k} id={`grad-${k}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={c} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={c} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--ocean-border)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--ocean-border)" />
              <Tooltip
                contentStyle={{ background: 'var(--ocean-card)', border: '1px solid var(--ocean-border)', borderRadius: 8 }}
                labelStyle={{ color: 'var(--ocean-text-dim)' }}
              />
              {Object.entries(TREND_COLORS).map(([k, c]) => (
                <Area key={k} type="monotone" dataKey={k} stroke={c} fill={`url(#grad-${k})`} strokeWidth={2} dot={false} />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        {/* Category breakdown */}          <Card noPad>
            <CardHeader
              title="Debris Distribution by Class"
              subtitle="Sample category totals — not live counts"
              icon={<Target className="w-4 h-4 text-cyan-400" />}
              action={<DataProvenanceBadge status="SAMPLE" label="SAMPLE" />}
              className="px-4 pt-4"
            />
          <div className="flex justify-center">
            <PieChart width={180} height={180}>
              <Pie data={CATEGORY_DATA} cx={90} cy={90} innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value">
                {CATEGORY_DATA.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ background: 'var(--ocean-card)', border: '1px solid var(--ocean-border)', borderRadius: 8 }} />
            </PieChart>
          </div>
          <div className="px-4 pb-4 space-y-1.5">
            {CATEGORY_DATA.map(d => (
              <div key={d.name} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: d.color }} />
                  <span className="text-xs text-[var(--ocean-text-dim)]">{d.name}</span>
                </div>
                <span className="text-xs font-mono font-semibold text-[var(--ocean-text)]">{d.value}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Bottom grid: Alerts + Detections + System Health */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Active Alerts List */}
        <Card noPad>
          <div className="flex items-center justify-between px-4 pt-4 mb-2">
            <CardHeader
              title="Active Alert Feed"
              subtitle={`${activeAlertsList.length} anomalies awaiting response`}
              icon={<AlertTriangle className="w-4 h-4 text-amber-400" />}
              className="mb-0"
            />
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setIsAlertModalOpen(true)}
            >
              View all ({alerts.length})
            </Button>
          </div>

          <div className="space-y-2 px-4 pb-4">
            {activeAlertsList.length === 0 ? (
              <div className="p-6 text-center text-xs text-[var(--ocean-text-muted)]">
                All maritime alerts are resolved.
              </div>
            ) : (
              activeAlertsList.slice(0, 5).map(a => (
                <div
                  key={a.id}
                  className="flex items-start justify-between gap-3 p-3 rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-surface)] hover:border-cyan-500/30 transition-colors"
                >
                  <div
                    className="flex-1 min-w-0 cursor-pointer"
                    onClick={() => {
                      if (a.detectionId) navigate(`/detections/${a.detectionId}`);
                      else setIsAlertModalOpen(true);
                    }}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${a.priority === 'CRITICAL' ? 'bg-red-400' : 'bg-amber-400'}`} />
                      <p className="text-xs font-semibold text-[var(--ocean-text)] truncate">{a.title}</p>
                    </div>
                    <p className="text-[10px] text-[var(--ocean-text-dim)] truncate">{a.locationLabel}</p>
                    <p className="text-[10px] text-[var(--ocean-text-muted)] mt-0.5 font-mono">
                      {formatRelativeTime(a.triggeredAt)} · Status: <span className="text-cyan-400">{a.status}</span>
                    </p>
                  </div>

                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <Badge variant={a.priority === 'CRITICAL' ? 'red' : 'amber'} size="2xs">
                      {a.priority}
                    </Badge>
                    {a.status === 'TRIGGERED' && (
                      <button
                        onClick={() => handleAcknowledgeAlert(a.id)}
                        disabled={processingAlertId === a.id}
                        className="text-[10px] text-cyan-400 hover:text-cyan-300 underline font-mono"
                      >
                        Ack
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Recent Detections */}
        <Card noPad>
          <div className="flex items-center justify-between px-4 pt-4 mb-2">
            <CardHeader
              title="Recent Detections"
              subtitle="Latest records from the prototype store"
              icon={<Activity className="w-4 h-4 text-cyan-400" />}
              className="mb-0"
            />
            <Button variant="ghost" size="xs" onClick={() => navigate('/detections')}>
              View all ({detections.length})
            </Button>
          </div>

          <div className="space-y-2 px-4 pb-4">
            {detections.slice(0, 5).map(d => (
              <div
                key={d.id}
                onClick={() => navigate(`/detections/${d.id}`)}
                className="flex items-center justify-between gap-3 p-2.5 rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-surface)] hover:border-cyan-500/30 transition-colors cursor-pointer"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold text-[var(--ocean-text)] truncate">{d.className}</p>
                    <span className="text-[10px] font-mono text-cyan-400">{d.confidence}%</span>
                  </div>
                  <p className="text-[10px] text-[var(--ocean-text-dim)] truncate mt-0.5">
                    {d.cameraName} · {formatRelativeTime(d.detectedAt)}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <Badge variant={d.riskLevel === 'CRITICAL' ? 'red' : d.riskLevel === 'HIGH' ? 'amber' : 'cyan'} size="2xs">
                    {d.riskLevel}
                  </Badge>
                  <p className="text-[10px] font-mono text-[var(--ocean-text-muted)] mt-0.5">
                    {d.estimatedMassKg ? `${d.estimatedMassKg} kg` : '—'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Subsystem Health */}
        <Card>
          <CardHeader
            title="Subsystem Architecture"
            subtitle="Mesh connectivity & inference nodes"
            icon={<Shield className="w-4 h-4 text-emerald-400" />}
          />
          <SystemHealthPanel />
          <div className="mt-4 rounded-lg border border-cyan-500/20 bg-cyan-950/20 p-3" role="status" aria-live="polite">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-400' : 'bg-amber-400'}`} />
              <span className={`text-xs font-semibold ${isOnline ? 'text-emerald-400' : 'text-amber-400'}`}>
                {isOnline ? 'Demo API connected' : 'Demo API unavailable'}
              </span>
            </div>
            <p className="text-[10px] text-[var(--ocean-text-dim)] mt-1">
              Check Espada AI & Data for the inference service status.
            </p>
          </div>
        </Card>
      </div>

      {/* ─── MODAL: ALERT MANAGEMENT DRAWER ──────────────────────────────── */}
      {isAlertModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[var(--ocean-card)] border border-[var(--ocean-border)] rounded-xl w-full max-w-3xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between p-4 border-b border-[var(--ocean-border)]">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400" />
                <h3 className="text-sm font-semibold text-[var(--ocean-text)]">
                  Maritime Alert Management Console
                </h3>
                <span className="text-xs font-mono text-cyan-400">({alerts.length} Total)</span>
              </div>
              <button
                onClick={() => setIsAlertModalOpen(false)}
                className="text-[var(--ocean-text-muted)] hover:text-[var(--ocean-text)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {actionNotice && (
              <div className="px-4 py-2 bg-cyan-950/40 border-b border-cyan-800/40 text-xs font-mono text-cyan-300">
                {actionNotice}
              </div>
            )}

            <div className="flex items-center justify-between p-3 border-b border-[var(--ocean-border)] bg-[var(--ocean-surface)]">
              <div className="flex gap-2">
                {(['UNRESOLVED', 'CRITICAL', 'ALL'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setAlertFilter(f)}
                    className={`px-3 py-1 text-xs font-mono rounded-lg border transition-all ${
                      alertFilter === f
                        ? 'border-cyan-500 bg-cyan-500/20 text-cyan-300 font-bold'
                        : 'border-[var(--ocean-border)] bg-[var(--ocean-card)] text-[var(--ocean-text-dim)] hover:text-[var(--ocean-text)]'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <Button
                variant="ghost"
                size="xs"
                icon={<RefreshCw className="w-3 h-3" />}
                onClick={loadData}
              >
                Refresh
              </Button>
            </div>

            <div className="overflow-y-auto p-4 space-y-3 flex-1">
              {filteredAlertsForModal.length === 0 ? (
                <div className="text-center py-12 text-xs text-[var(--ocean-text-muted)]">
                  No alerts match the selected filter.
                </div>
              ) : (
                filteredAlertsForModal.map(a => (
                  <div
                    key={a.id}
                    className="p-3.5 rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-surface)] space-y-2 hover:border-cyan-500/30 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <Badge variant={a.priority === 'CRITICAL' ? 'red' : 'amber'} size="xs">
                            {a.priority}
                          </Badge>
                          <span className="text-xs font-mono font-bold text-cyan-400">{a.id}</span>
                          <span className="text-[10px] text-[var(--ocean-text-muted)]">
                            {new Date(a.triggeredAt).toLocaleString()}
                          </span>
                        </div>
                        <p className="text-sm font-semibold text-[var(--ocean-text)] mt-1">{a.title}</p>
                        <p className="text-xs text-[var(--ocean-text-dim)] mt-0.5">{a.description}</p>
                        <p className="text-[11px] font-mono text-cyan-300 mt-1 flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {a.locationLabel} ({a.lat}°N, {a.lng}°E)
                        </p>
                      </div>

                      <div className="text-right flex-shrink-0">
                        <Badge
                          variant={
                            a.status === 'RESOLVED'
                              ? 'green'
                              : a.status === 'ASSIGNED'
                              ? 'cyan'
                              : a.status === 'ACKNOWLEDGED'
                              ? 'purple'
                              : 'red'
                          }
                          size="xs"
                        >
                          {a.status}
                        </Badge>
                        {a.assignedTo && (
                          <p className="text-[10px] text-[var(--ocean-text-muted)] mt-1">
                            Assigned: {a.assignedTo}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--ocean-border)]/50">
                      <div className="flex items-center gap-2">
                        {a.detectionId && (
                          <button
                            onClick={() => {
                              setIsAlertModalOpen(false);
                              navigate(`/detections/${a.detectionId}`);
                            }}
                            className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1 underline font-mono"
                          >
                            View Detection #{a.detectionId}
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {a.status === 'TRIGGERED' && (
                          <Button
                            variant="outline"
                            size="xs"
                            disabled={processingAlertId === a.id}
                            onClick={() => handleAcknowledgeAlert(a.id)}
                            icon={<Check className="w-3 h-3 text-cyan-400" />}
                          >
                            Acknowledge
                          </Button>
                        )}
                        {a.status !== 'ASSIGNED' && a.status !== 'RESOLVED' && (
                          <Button
                            variant="outline"
                            size="xs"
                            disabled={processingAlertId === a.id}
                            onClick={() => handleAssignAlert(a.id)}
                            icon={<UserCheck className="w-3 h-3 text-purple-400" />}
                          >
                            Assign to Me
                          </Button>
                        )}
                        {a.status !== 'RESOLVED' && (
                          <Button
                            variant="success"
                            size="xs"
                            disabled={processingAlertId === a.id}
                            onClick={() => handleResolveAlert(a.id)}
                            icon={<Check className="w-3 h-3" />}
                          >
                            Resolve Alert
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => {
                            setIsAlertModalOpen(false);
                            navigate('/cleanup');
                          }}
                        >
                          Dispatch Cleanup
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
