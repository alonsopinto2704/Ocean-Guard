import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ChevronRight, MapPin, Radio } from 'lucide-react';
import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { LoadingState, EmptyState } from '../components/ui/StateComponents';
import {
  getDetectionStatusColor, getRiskBg,
  formatRelativeTime, getConfidenceLabel
} from '../lib/utils';
import type { Detection, DetectionStatus, RiskLevel } from '../types';

const ALL_DETECTIONS: Detection[] = [
  { id: 'DET-1042', trackId: 'TRK-1042', className: 'Fishing Net',    category: 'Fishing Gear', confidence: 89, status: 'TRACKING',  riskScore: 89, riskLevel: 'CRITICAL', riskFactors: [], boundingBox: { x: 0.54, y: 0.44, w: 0.28, h: 0.24 } as any, estimatedSize: '3.6 m²', estimatedDistance: '420m', estimatedMassKg: 16.2, lat: 35.1, lng: -158.3, locationLabel: 'Zone 4 N · Pacific', cameraId: 'CAM-04', cameraName: 'Alpha 4', zoneId: 'Z4', zoneName: 'Zone 4', detectedAt: new Date(Date.now() - 5 * 60000).toISOString(), source: 'CAMERA' },
  { id: 'DET-1105', trackId: 'TRK-1105', className: 'Rope',           category: 'Fishing Gear', confidence: 77, status: 'NEW',       riskScore: 38, riskLevel: 'MEDIUM',   riskFactors: [], boundingBox: { x: 0.4, y: 0.5, w: 0.2, h: 0.1 } as any, estimatedSize: '1.2 m²', estimatedDistance: '280m', estimatedMassKg: 2.1,  lat: 20.4, lng: 145.6,  locationLabel: 'Zone 2 · Western Pacific', cameraId: 'CAM-08', cameraName: 'Gamma 8', zoneId: 'Z2', zoneName: 'Zone 2', detectedAt: new Date(Date.now() - 28 * 60000).toISOString(), source: 'CAMERA' },
  { id: 'DET-1210', trackId: 'TRK-1210', className: 'Mixed Waste',    category: 'Unknown',      confidence: 68, status: 'VALIDATING',riskScore: 72, riskLevel: 'HIGH',     riskFactors: [], boundingBox: { x: 0.2, y: 0.3, w: 0.35, h: 0.3 } as any, estimatedSize: '5.1 m²', estimatedDistance: '620m', estimatedMassKg: 28.4, lat: 35.1, lng: -148.4, locationLabel: 'Zone 4 S · Pacific', cameraId: 'CAM-04', cameraName: 'Alpha 4', zoneId: 'Z4', zoneName: 'Zone 4', detectedAt: new Date(Date.now() - 42 * 60000).toISOString(), source: 'UPLOAD' },
  { id: 'DET-0902', trackId: 'TRK-902',  className: 'Plastic Bottle', category: 'Plastic',      confidence: 94, status: 'CONFIRMED', riskScore: 42, riskLevel: 'MEDIUM',   riskFactors: [], boundingBox: { x: 0.18, y: 0.38, w: 0.14, h: 0.16 } as any, estimatedSize: '0.5 m²', estimatedDistance: '140m', estimatedMassKg: 0.9, lat: 28.5, lng: -140.2, locationLabel: 'Pacific Gyre · Sector A', cameraId: 'CAM-02', cameraName: 'Beta 2', zoneId: 'Z1', zoneName: 'Zone 1', detectedAt: new Date(Date.now() - 12 * 60000).toISOString(), source: 'DRONE' },
  { id: 'DET-0988', trackId: 'TRK-988',  className: 'Plastic Bag',    category: 'Plastic',      confidence: 91, status: 'CONFIRMED', riskScore: 55, riskLevel: 'MEDIUM',   riskFactors: [], boundingBox: { x: 0.32, y: 0.68, w: 0.18, h: 0.15 } as any, estimatedSize: '0.9 m²', estimatedDistance: '190m', estimatedMassKg: 0.6, lat: 14.2, lng: -155.8, locationLabel: 'Zone 1 · North Pacific', cameraId: 'CAM-01', cameraName: 'Alpha 1', zoneId: 'Z1', zoneName: 'Zone 1', detectedAt: new Date(Date.now() - 18 * 60000).toISOString(), source: 'CAMERA' },
  { id: 'DET-0840', trackId: 'TRK-840',  className: 'Metal',          category: 'Metal/Glass',  confidence: 82, status: 'CONFIRMED', riskScore: 31, riskLevel: 'MEDIUM',   riskFactors: [], boundingBox: { x: 0.1, y: 0.4, w: 0.12, h: 0.1 } as any, estimatedSize: '0.3 m²', estimatedDistance: '80m',  estimatedMassKg: 1.4,  lat: 42.1, lng: -130.5, locationLabel: 'Oregon Shelf', cameraId: 'CAM-06', cameraName: 'Zeta 6', zoneId: 'Z3', zoneName: 'Zone 3', detectedAt: new Date(Date.now() - 68 * 60000).toISOString(), source: 'CAMERA' },
  { id: 'DET-0775', trackId: 'TRK-775',  className: 'Plastic Bag',    category: 'Plastic',      confidence: 52, status: 'FALSE_POSITIVE', riskScore: 12, riskLevel: 'LOW',  riskFactors: [], boundingBox: { x: 0.6, y: 0.6, w: 0.1, h: 0.08 } as any, estimatedSize: '0.2 m²', estimatedDistance: '60m',  estimatedMassKg: 0.1,  lat: 5.8, lng: -110.2, locationLabel: 'Central Pacific', cameraId: 'CAM-03', cameraName: 'Beta 3', zoneId: 'Z1', zoneName: 'Zone 1', detectedAt: new Date(Date.now() - 95 * 60000).toISOString(), source: 'CAMERA' },
  { id: 'DET-0688', trackId: 'TRK-688',  className: 'Wood',           category: 'Organic',      confidence: 71, status: 'EXPIRED',   riskScore: 18, riskLevel: 'LOW',     riskFactors: [], boundingBox: { x: 0.25, y: 0.55, w: 0.22, h: 0.18 } as any, estimatedSize: '2.1 m²', estimatedDistance: '340m', estimatedMassKg: 8.2,  lat: -10.2, lng: -85.4, locationLabel: 'Eastern Pacific', cameraId: 'CAM-09', cameraName: 'Eta 9', zoneId: 'Z5', zoneName: 'Zone 5', detectedAt: new Date(Date.now() - 180 * 60000).toISOString(), source: 'CAMERA' },
];

const STATUS_FILTERS: DetectionStatus[] = ['NEW', 'VALIDATING', 'CONFIRMED', 'TRACKING', 'LOST', 'FALSE_POSITIVE', 'EXPIRED'];
const RISK_FILTERS: RiskLevel[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

export default function Detections() {
  const navigate = useNavigate();
  const [search, setSearch]       = useState('');
  const [statusFilter, setStatus] = useState<DetectionStatus | 'ALL'>('ALL');
  const [riskFilter, setRisk]     = useState<RiskLevel | 'ALL'>('ALL');
  const [loading]                 = useState(false);

  const filtered = ALL_DETECTIONS.filter(d => {
    const matchSearch = !search ||
      d.className.toLowerCase().includes(search.toLowerCase()) ||
      d.id.toLowerCase().includes(search.toLowerCase()) ||
      d.trackId.toLowerCase().includes(search.toLowerCase()) ||
      d.locationLabel.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'ALL' || d.status === statusFilter;
    const matchRisk   = riskFilter === 'ALL' || d.riskLevel === riskFilter;
    return matchSearch && matchStatus && matchRisk;
  });

  if (loading) return <LoadingState message="Loading detections..." size="lg" className="h-full" />;

  return (
    <div className="p-3 sm:p-6 space-y-4">
      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: ALL_DETECTIONS.length, color: '#00d4ff' },
          { label: 'Critical', value: ALL_DETECTIONS.filter(d => d.riskLevel === 'CRITICAL').length, color: '#ff4455' },
          { label: 'Tracking', value: ALL_DETECTIONS.filter(d => d.status === 'TRACKING').length, color: '#00ff88' },
          { label: 'New', value: ALL_DETECTIONS.filter(d => d.status === 'NEW').length, color: '#aa55ff' },
        ].map(s => (
          <Card key={s.label} className="py-3 px-4">
            <p className="text-xs text-[var(--ocean-text-dim)] mb-1">{s.label}</p>
            <p className="text-2xl font-bold font-mono" style={{ color: s.color }}>{s.value}</p>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <label htmlFor="detection-search" className="sr-only">Search detections</label>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ocean-text-muted)]" />
          <input
            id="detection-search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by class, ID, track or location..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-surface)] text-[var(--ocean-text)] placeholder-[var(--ocean-text-muted)] focus:border-cyan-500 outline-none"
          />
        </div>
        <div>
          <label htmlFor="detection-status" className="sr-only">Filter by status</label>
          <select
            id="detection-status"
            value={statusFilter}
            onChange={e => setStatus(e.target.value as any)}
            className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-surface)] text-[var(--ocean-text)] focus:border-cyan-500 outline-none"
          >
            <option value="ALL">All Statuses</option>
            {STATUS_FILTERS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="detection-risk" className="sr-only">Filter by risk level</label>
          <select
            id="detection-risk"
            value={riskFilter}
            onChange={e => setRisk(e.target.value as any)}
            className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-surface)] text-[var(--ocean-text)] focus:border-cyan-500 outline-none"
          >
            <option value="ALL">All Risk Levels</option>
            {RISK_FILTERS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      </Card>

      {/* Compact, touch-friendly cards replace the wide table on small screens. */}
      <div className="space-y-3 md:hidden">
        {filtered.length === 0 ? (
          <Card><EmptyState title="No detections found" description="Try adjusting your filters" className="py-8" /></Card>
        ) : filtered.map(d => (
          <button
            key={d.id}
            type="button"
            onClick={() => navigate(`/detections/${d.id}`)}
            className="w-full rounded border border-[#3a4a46]/45 bg-[#1a202c]/90 p-4 text-left shadow-md transition-colors hover:border-[#00f5d4]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4cd6fb]"
            aria-label={`Open ${d.className} detection ${d.id}, ${d.riskLevel} risk`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-cyan-400">{d.id}</span>
                  <Badge variant={d.riskLevel === 'CRITICAL' ? 'red' : d.riskLevel === 'HIGH' ? 'amber' : 'cyan'} size="xs">
                    {d.riskLevel} RISK
                  </Badge>
                </div>
                <p className="mt-2 text-sm font-semibold text-[var(--ocean-text)]">{d.className}</p>
                <p className="text-[11px] text-[var(--ocean-text-dim)]">{d.category} · {d.status.replace('_', ' ')}</p>
              </div>
              <ChevronRight className="mt-1 h-4 w-4 flex-shrink-0 text-[var(--ocean-text-muted)]" />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
              <span className="flex items-center gap-1.5 text-[var(--ocean-text-dim)]"><Radio className="h-3.5 w-3.5 text-cyan-400" />{d.confidence}% confidence</span>
              <span className="flex items-center gap-1.5 text-[var(--ocean-text-dim)]"><MapPin className="h-3.5 w-3.5 text-cyan-400" />{d.locationLabel}</span>
            </div>
            <p className="mt-3 text-[10px] text-[var(--ocean-text-muted)]">{d.trackId} · {formatRelativeTime(d.detectedAt)}</p>
          </button>
        ))}
      </div>

      {/* Table */}
      <Card noPad className="hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--ocean-border)]">
                {['Detection ID', 'Class', 'Confidence', 'Risk', 'Status', 'Location', 'Source', 'Detected', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold text-[var(--ocean-text-muted)] uppercase tracking-wider whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={9}><EmptyState title="No detections found" description="Try adjusting your filters" className="py-12" /></td></tr>
              ) : filtered.map((d, i) => (
                <tr
                  key={d.id}
                  className={`border-b border-[var(--ocean-border)]/50 hover:bg-[var(--ocean-card-hover)] cursor-pointer transition-colors ${i % 2 === 0 ? '' : 'bg-white/[0.01]'}`}
                  onClick={() => navigate(`/detections/${d.id}`)}
                  tabIndex={0}
                  aria-label={`Open ${d.className} detection ${d.id}`}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      navigate(`/detections/${d.id}`);
                    }
                  }}
                >
                  <td className="px-4 py-3">
                    <div>
                      <p className="text-xs font-mono text-cyan-400">{d.id}</p>
                      <p className="text-[10px] text-[var(--ocean-text-muted)]">{d.trackId}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-xs font-semibold text-[var(--ocean-text)]">{d.className}</p>
                    <p className="text-[10px] text-[var(--ocean-text-muted)]">{d.category}</p>
                  </td>
                  <td className="px-4 py-3">
                    <div className="min-w-20" aria-label={`${d.confidence}% confidence`}>
                      <div className="flex items-center justify-between gap-2 font-mono text-[10px]">
                        <span className="text-cyan-300">{d.confidence}%</span>
                        <span className="text-[var(--ocean-text-muted)]">{getConfidenceLabel(d.confidence)}</span>
                      </div>
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-[#2f3542]">
                        <div className="h-full rounded-full bg-cyan-400" style={{ width: `${d.confidence}%` }} />
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div>
                      <span className={`text-xs font-mono px-1.5 py-0.5 rounded border ${getRiskBg(d.riskLevel)}`}>
                        {d.riskLevel}
                      </span>
                      <p className="text-[10px] text-[var(--ocean-text-muted)] mt-0.5">{d.riskScore}/100</p>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${getDetectionStatusColor(d.status)}`}>
                      {d.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-xs text-[var(--ocean-text-dim)] max-w-[140px] truncate">{d.locationLabel}</p>
                    <p className="text-[10px] text-[var(--ocean-text-muted)]">{d.estimatedDistance}</p>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" size="xs">{d.source}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-xs text-[var(--ocean-text-dim)] whitespace-nowrap">{formatRelativeTime(d.detectedAt)}</p>
                  </td>
                  <td className="px-4 py-3">
                    <ChevronRight className="w-4 h-4 text-[var(--ocean-text-muted)]" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-[var(--ocean-border)] flex items-center justify-between">
          <p className="text-xs text-[var(--ocean-text-muted)]">
            Showing {filtered.length} of {ALL_DETECTIONS.length} detections
          </p>
          <Badge variant="cyan" size="xs">LIVE</Badge>
        </div>
      </Card>
    </div>
  );
}
