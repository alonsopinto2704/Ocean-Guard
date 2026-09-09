import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, Camera, Shield, Target, Zap,
  TrendingUp, Activity, MapPin
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';
import { dashboardApi } from '../lib/api';
import { useSystem } from '../context/SystemContext';
import { StatCard, Card, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { LoadingState } from '../components/ui/StateComponents';
import { formatRelativeTime } from '../lib/utils';
import type { Alert, Detection } from '../types';

const TREND_COLORS = { plastic: '#00f5d4', fishingGear: '#ffaa00', metalGlass: '#4cd6fb', other: '#83948f' };
const PIE_COLORS   = ['#00f5d4', '#ffaa00', '#4cd6fb', '#26fedc', '#83948f'];

const CATEGORY_DATA = [
  { name: 'Plastic', value: 638, color: '#00f5d4' },
  { name: 'Fishing Gear', value: 312, color: '#ffaa00' },
  { name: 'Metal/Glass', value: 198, color: '#4cd6fb' },
  { name: 'Organic', value: 89,  color: '#26fedc' },
  { name: 'Unknown', value: 47,  color: '#83948f' },
];

function SystemHealthPanel() {
  const { health, isOnline } = useSystem();
  const items = [
    { label: 'System',   value: health?.system ?? 'ONLINE', ok: health?.system === 'ONLINE' },
    { label: 'AI Engine', value: health?.ai ?? 'RUNNING', ok: health?.ai === 'RUNNING' },
    { label: 'GPS',      value: health?.gps ?? 'VALID', ok: health?.gps === 'VALID' },
    { label: 'Internet', value: isOnline ? 'ONLINE' : 'OFFLINE', ok: isOnline },
    { label: 'Cameras',  value: `${health?.activeCameras ?? 14}/${health?.totalCameras ?? 15}`, ok: (health?.activeCameras ?? 14) === (health?.totalCameras ?? 15) },
    { label: 'Latency',  value: `${(health?.aiLatencyMs ?? 14.2).toFixed(1)}ms`, ok: (health?.aiLatencyMs ?? 14.2) < 50 },
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map(item => (
        <div key={item.label} className="flex items-center justify-between px-3 py-2 rounded-lg bg-[var(--ocean-surface)] border border-[var(--ocean-border)]">
          <span className="text-xs text-[var(--ocean-text-dim)]">{item.label}</span>
          <span className={`text-xs font-mono ${item.ok ? 'text-green-400' : 'text-red-400'}`}>
            {item.value}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function CommandCenter() {
  const { summary } = useSystem();
  const navigate    = useNavigate();
  const [trends, setTrends]       = useState<any[]>([]);
  const [alerts, setAlerts]       = useState<Alert[]>([]);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [t, a, d] = await Promise.all([
          dashboardApi.trends(),
          dashboardApi.alerts(),
          dashboardApi.recentDetections(),
        ]);
        setTrends(t.history ?? []);
        setAlerts(a.alerts ?? []);
        setDetections(d.detections ?? []);
      } catch { /* use empty */ }
      finally { setLoading(false); }
    };
    load();
  }, []);

  if (loading) return <LoadingState message="Loading command center..." size="lg" className="h-full" />;

  const kpis = [
    { label: 'Active Alerts',       value: summary?.activeAlerts ?? 7,    color: '#ff5964', icon: <AlertTriangle className="w-5 h-5" />, path: '/command', trend: 'up',   trendValue: '+2 today' },
    { label: 'Debris Detected',     value: summary?.debrisDetected ?? 1284, color: '#00f5d4', icon: <Target className="w-5 h-5" />,       path: '/detections', trend: 'up', trendValue: '+47 today' },
    { label: 'High Risk Incidents', value: summary?.highRiskIncidents ?? 21, color: '#ffaa00', icon: <Shield className="w-5 h-5" />,       path: '/detections', trend: 'up', trendValue: '+3 today' },
    { label: 'Active Hotspots',     value: summary?.activeHotspots ?? 18, color: '#4cd6fb', icon: <MapPin className="w-5 h-5" />,         path: '/hotspots', trend: 'stable', trendValue: '0 change' },
    { label: 'Cleanup Missions',    value: summary?.cleanupMissions ?? 3,  color: '#26fedc', icon: <Zap className="w-5 h-5" />,           path: '/cleanup', trend: 'down',  trendValue: '-1 this week' },
    { label: 'Cameras Online',      value: summary?.camerasOnline ?? '14/15', color: '#d7fff3', icon: <Camera className="w-5 h-5" />,     path: '/sensors' },
  ];

  const hasCameraIssue = (summary?.camerasOnline ?? '14/15') !== '15/15';

  return (
    <div className="p-3 sm:p-6 space-y-5 sm:space-y-6">
      <div className="flex flex-col gap-3 rounded border border-[#ff5964]/30 bg-gradient-to-r from-[#93000a]/20 to-[#161c28] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded border border-[#ff5964]/30 bg-[#ff5964]/10 text-[#ff7b84]">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[#dde2f3]">{summary?.activeAlerts ?? 7} alerts need operator attention</p>
            <p className="mt-0.5 text-xs text-[#b9cac4]">Start with critical detections, then assign a response mission.</p>
          </div>
        </div>
        <Button variant="danger" size="sm" onClick={() => navigate('/detections')}>Review critical detections</Button>
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
            onClick={() => navigate(k.path)}
          />
        ))}
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Trend chart — 2/3 width */}
        <Card className="xl:col-span-2" noPad>
          <CardHeader
            title="7-Day Debris Detection Trend"
            subtitle="All debris categories"
            icon={<TrendingUp className="w-4 h-4" />}
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

        {/* Category breakdown */}
        <Card noPad>
          <CardHeader
            title="Debris by Category"
            subtitle="Current period"
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
                <span className="text-xs font-mono text-[var(--ocean-text)]">{d.value}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Bottom grid: Alerts + Detections + System Health */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Active Alerts */}
        <Card noPad>
          <CardHeader
            title="Active Alerts"
            subtitle={`${alerts.length || 7} requiring attention`}
            icon={<AlertTriangle className="w-4 h-4" />}
            action={<Button variant="ghost" size="xs" onClick={() => navigate('/command')}>View all</Button>}
            className="px-4 pt-4"
          />
          <div className="space-y-2 px-4 pb-4">
            {(alerts.length ? alerts : MOCK_ALERTS).slice(0, 5).map(a => (
              <button key={a.id}
                type="button"
                onClick={() => navigate(a.detectionId ? `/detections/${a.detectionId}` : '/detections')}
                className="flex w-full items-start gap-3 rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-surface)] p-3 text-left transition-colors hover:border-cyan-500/30"
              >
                <span className={`mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full ${a.priority === 'CRITICAL' ? 'bg-red-400' : a.priority === 'HIGH' ? 'bg-orange-400' : 'bg-amber-300'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-[var(--ocean-text)] truncate">{a.title}</p>
                  <p className="text-[10px] text-[var(--ocean-text-dim)] truncate">{a.locationLabel}</p>
                  <p className="text-[10px] text-[var(--ocean-text-muted)] mt-0.5">
                    {formatRelativeTime(a.triggeredAt)}
                  </p>
                </div>
                <Badge variant={a.priority === 'CRITICAL' ? 'red' : 'amber'} size="xs">
                  {a.priority}
                </Badge>
              </button>
            ))}
          </div>
        </Card>

        {/* Recent Detections */}
        <Card noPad>
          <CardHeader
            title="Recent Detections"
            subtitle="Last 5 AI detections"
            icon={<Activity className="w-4 h-4" />}
            action={<Button variant="ghost" size="xs" onClick={() => navigate('/detections')}>View all</Button>}
            className="px-4 pt-4"
          />
          <div className="space-y-2 px-4 pb-4">
            {(detections.length ? detections : MOCK_DETECTIONS).slice(0, 5).map(d => (
              <button key={d.id}
                type="button"
                className="flex w-full items-center gap-3 rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-surface)] p-2.5 text-left transition-colors hover:border-cyan-500/30"
                onClick={() => navigate(`/detections/${d.id}`)}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-[var(--ocean-text)] truncate">{d.className}</p>
                  <p className="text-[10px] text-[var(--ocean-text-dim)]">{d.cameraName} · {formatRelativeTime(d.detectedAt)}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs font-mono text-cyan-400">{d.confidence}%</p>
                  <Badge variant={d.riskLevel === 'CRITICAL' ? 'red' : d.riskLevel === 'HIGH' ? 'amber' : 'cyan'} size="xs">
                    {d.riskLevel}
                  </Badge>
                </div>
              </button>
            ))}
          </div>
        </Card>

        {/* System Health */}
        <Card>
          <CardHeader
            title="System Health"
            subtitle="All subsystems"
            icon={<Activity className="w-4 h-4" />}
          />
          <SystemHealthPanel />
          <div className={`mt-4 rounded-lg border p-3 ${hasCameraIssue ? 'border-amber-500/20 bg-amber-500/10' : 'border-green-500/20 bg-green-500/10'}`}>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${hasCameraIssue ? 'bg-amber-400' : 'bg-green-400'}`} />
              <span className={`text-xs font-semibold ${hasCameraIssue ? 'text-amber-300' : 'text-green-400'}`}>
                {hasCameraIssue ? 'Core systems online · 1 camera needs attention' : 'All critical systems operational'}
              </span>
            </div>
            <p className="text-[10px] text-[var(--ocean-text-dim)] mt-1">
              Espada v1 · self-hosted inference · validation metrics in model registry
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ── Mock data for demo ──────────────────────────────────────────────────────
const MOCK_ALERTS: Alert[] = [
  { id: 'ALT-001', type: 'RISK_THRESHOLD', title: 'Large Debris Cluster Detected', description: 'Cluster of 47 items identified near Zone 4', priority: 'CRITICAL', status: 'TRIGGERED', triggeredAt: new Date(Date.now() - 8 * 60000).toISOString(), lat: 35.1, lng: -158.3, locationLabel: 'Zone 4 — North Pacific' },
  { id: 'ALT-002', type: 'DETECTION', title: 'Fishing Net — Track #1042', description: 'Large fishing net 3.6m² moving at 0.4 m/s', priority: 'HIGH', status: 'ACKNOWLEDGED', triggeredAt: new Date(Date.now() - 22 * 60000).toISOString(), lat: 28.5, lng: -140.2, locationLabel: 'Pacific Gyre · Sector B' },
  { id: 'ALT-003', type: 'DEVICE', title: 'Camera CAM-15 Offline', description: 'No heartbeat received for 12 minutes', priority: 'MEDIUM', status: 'INVESTIGATING', triggeredAt: new Date(Date.now() - 47 * 60000).toISOString(), lat: 20.4, lng: -145.6, locationLabel: 'Monitoring Zone 3' },
  { id: 'ALT-004', type: 'RISK_THRESHOLD', title: 'High Density Zone — Sector A', description: '42 detections in 2km radius', priority: 'HIGH', status: 'ACTION_REQUIRED', triggeredAt: new Date(Date.now() - 95 * 60000).toISOString(), lat: 14.2, lng: -155.8, locationLabel: 'Sector A — Zone 1' },
  { id: 'ALT-005', type: 'DETECTION', title: 'Plastic Debris — Track #988', description: 'Mixed plastic cluster 82 kg estimated', priority: 'HIGH', status: 'ASSIGNED', triggeredAt: new Date(Date.now() - 140 * 60000).toISOString(), lat: 32.1, lng: -148.4, locationLabel: 'Zone 2 — Coastal' },
];

const MOCK_DETECTIONS: Detection[] = [
  { id: 'DET-1042', trackId: 'TRK-1042', className: 'Fishing Net', category: 'Fishing Gear', confidence: 89, status: 'TRACKING', riskScore: 89, riskLevel: 'CRITICAL', riskFactors: [], boundingBox: { x: 0.54, y: 0.44, width: 0.28, height: 0.24 }, estimatedSize: '3.6 m²', estimatedDistance: '420m', estimatedMassKg: 16.2, lat: 35.1, lng: -158.3, locationLabel: 'Zone 4 N', cameraId: 'CAM-04', cameraName: 'Cam Alpha 4', zoneId: 'Z4', zoneName: 'Zone 4', detectedAt: new Date(Date.now() - 5 * 60000).toISOString(), source: 'CAMERA' },
  { id: 'DET-0902', trackId: 'TRK-902',  className: 'Plastic Bottle', category: 'Plastic', confidence: 94, status: 'CONFIRMED', riskScore: 42, riskLevel: 'MEDIUM', riskFactors: [], boundingBox: { x: 0.18, y: 0.38, width: 0.14, height: 0.16 }, estimatedSize: '0.5 m²', estimatedDistance: '140m', estimatedMassKg: 0.9, lat: 28.5, lng: -140.2, locationLabel: 'Pacific Gyre', cameraId: 'CAM-02', cameraName: 'Cam Beta 2', zoneId: 'Z1', zoneName: 'Zone 1', detectedAt: new Date(Date.now() - 12 * 60000).toISOString(), source: 'DRONE' },
  { id: 'DET-0988', trackId: 'TRK-988',  className: 'Plastic Bag', category: 'Plastic', confidence: 91, status: 'CONFIRMED', riskScore: 55, riskLevel: 'MEDIUM', riskFactors: [], boundingBox: { x: 0.32, y: 0.68, width: 0.18, height: 0.15 }, estimatedSize: '0.9 m²', estimatedDistance: '190m', estimatedMassKg: 0.6, lat: 14.2, lng: -155.8, locationLabel: 'Zone 1', cameraId: 'CAM-01', cameraName: 'Cam Alpha 1', zoneId: 'Z1', zoneName: 'Zone 1', detectedAt: new Date(Date.now() - 18 * 60000).toISOString(), source: 'CAMERA' },
  { id: 'DET-1105', trackId: 'TRK-1105', className: 'Rope', category: 'Fishing Gear', confidence: 77, status: 'NEW', riskScore: 38, riskLevel: 'MEDIUM', riskFactors: [], boundingBox: { x: 0.4, y: 0.5, width: 0.2, height: 0.1 }, estimatedSize: '1.2 m²', estimatedDistance: '280m', estimatedMassKg: 2.1, lat: 20.4, lng: 145.6, locationLabel: 'Zone 2', cameraId: 'CAM-08', cameraName: 'Cam Gamma 8', zoneId: 'Z2', zoneName: 'Zone 2', detectedAt: new Date(Date.now() - 28 * 60000).toISOString(), source: 'CAMERA' },
  { id: 'DET-1210', trackId: 'TRK-1210', className: 'Mixed Waste', category: 'Unknown', confidence: 68, status: 'VALIDATING', riskScore: 72, riskLevel: 'HIGH', riskFactors: [], boundingBox: { x: 0.2, y: 0.3, width: 0.35, height: 0.3 }, estimatedSize: '5.1 m²', estimatedDistance: '620m', estimatedMassKg: 28.4, lat: 35.1, lng: -148.4, locationLabel: 'Zone 4 S', cameraId: 'CAM-04', cameraName: 'Cam Alpha 4', zoneId: 'Z4', zoneName: 'Zone 4', detectedAt: new Date(Date.now() - 42 * 60000).toISOString(), source: 'UPLOAD' },
];
