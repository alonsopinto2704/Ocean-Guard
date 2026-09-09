import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, MapPin, Clock, Camera, Layers, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Badge } from '../components/ui/Badge';
import { Card, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { getConfidenceBg, getDetectionStatusColor, formatDateTime } from '../lib/utils';

const DETECTION_DATA: Record<string, any> = {
  'DET-1042': {
    id: 'DET-1042', trackId: 'TRK-1042', className: 'Fishing Net', category: 'Fishing Gear',
    confidence: 89, status: 'TRACKING', riskScore: 89, riskLevel: 'CRITICAL',
    estimatedSize: '3.6 m²', estimatedDistance: '420m', estimatedMassKg: 16.2,
    lat: 35.1, lng: -158.3, locationLabel: 'Zone 4 N · Pacific (35.1°N, 158.3°W)',
    cameraId: 'CAM-04', cameraName: 'Alpha 4 — Zone 4 S', zoneId: 'Z4', zoneName: 'Zone 4',
    detectedAt: new Date(Date.now() - 5 * 60000).toISOString(), source: 'CAMERA',
    boundingBox: { x: 54, y: 44, w: 28, h: 24 },
    riskFactors: [
      { label: 'Large size',            score: 24, description: 'Object exceeds 3m² surface area' },
      { label: 'High density cluster',  score: 20, description: 'Cluster of 47 items in 200m radius' },
      { label: 'Near shipping route',   score: 18, description: '1.2km from Trans-Pacific lane' },
      { label: 'Moving debris',         score: 14, description: 'Velocity: 0.4 m/s heading NW' },
      { label: 'Sensitive zone',        score: 13, description: 'Within marine sanctuary boundary' },
    ],
    trackPoints: [
      { lat: 35.08, lng: -158.28, timestamp: new Date(Date.now() - 35 * 60000).toISOString() },
      { lat: 35.09, lng: -158.29, timestamp: new Date(Date.now() - 28 * 60000).toISOString() },
      { lat: 35.09, lng: -158.30, timestamp: new Date(Date.now() - 20 * 60000).toISOString() },
      { lat: 35.10, lng: -158.31, timestamp: new Date(Date.now() - 12 * 60000).toISOString() },
      { lat: 35.10, lng: -158.30, timestamp: new Date(Date.now() - 5  * 60000).toISOString() },
    ],
  },
};

function RiskGauge({ score }: { score: number }) {
  const r = 54, c = 2 * Math.PI * r;
  const dash = (score / 100) * c;
  const color = score >= 80 ? '#ff4455' : score >= 60 ? '#ff8800' : score >= 30 ? '#ffaa00' : '#00ff88';
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-32 h-32">
        <svg width="128" height="128" viewBox="0 0 128 128">
          <circle cx="64" cy="64" r={r} fill="none" stroke="var(--ocean-border)" strokeWidth="8" />
          <circle cx="64" cy="64" r={r} fill="none" stroke={color} strokeWidth="8"
            strokeDasharray={`${dash} ${c}`} strokeLinecap="round"
            style={{ transform: 'rotate(-90deg)', transformOrigin: 'center', transition: 'stroke-dasharray 1s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold font-mono" style={{ color }}>{score}</span>
          <span className="text-[10px] text-[var(--ocean-text-muted)]">/ 100</span>
        </div>
      </div>
      <Badge variant={score >= 80 ? 'red' : score >= 60 ? 'amber' : 'green'} size="sm">
        {score >= 80 ? 'CRITICAL' : score >= 60 ? 'HIGH' : score >= 30 ? 'MEDIUM' : 'LOW'}
      </Badge>
    </div>
  );
}

export default function DetectionDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const d = DETECTION_DATA[id!] ?? DETECTION_DATA['DET-1042'];
  const [status, setStatus] = useState(d.status);
  const [showFalsePositive, setShowFalsePositive] = useState(false);
  const [notice, setNotice] = useState('');

  const handleCreateMission = () => {
    navigate(`/cleanup?source=${encodeURIComponent(d.id)}`, {
      state: {
        sourceDetection: {
          id: d.id,
          className: d.className,
          riskLevel: d.riskLevel,
          zoneName: d.zoneName,
          locationLabel: d.locationLabel,
          estimatedMassKg: d.estimatedMassKg,
          detectionCount: 1,
        },
      },
    });
  };

  const confirmFalsePositive = () => {
    setStatus('FALSE_POSITIVE');
    setShowFalsePositive(false);
    setNotice(`${d.id} was marked as a false positive. No cleanup mission will be created automatically.`);
  };

  return (
    <div className="p-3 sm:p-6 space-y-6 max-w-6xl mx-auto">
      {/* Back + header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-2 sm:gap-3">
          <Button variant="ghost" size="sm" icon={<ArrowLeft className="w-4 h-4" />} onClick={() => navigate('/detections')}>
            Back
          </Button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-[var(--ocean-text)]">{d.className}</h2>
              <Badge variant="outline" size="xs">{d.id}</Badge>
              <Badge variant="cyan" size="xs">{d.trackId}</Badge>
            </div>
            <p className="text-xs text-[var(--ocean-text-dim)] mt-0.5">{d.locationLabel}</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:flex">
          <Button
            variant="danger"
            size="sm"
            icon={<AlertTriangle className="w-4 h-4" />}
            onClick={() => setShowFalsePositive(true)}
            disabled={status === 'FALSE_POSITIVE'}
          >
            Flag False Positive
          </Button>
          <Button variant="primary" size="sm" onClick={handleCreateMission} disabled={status === 'FALSE_POSITIVE'}>
            Review Cleanup Mission
          </Button>
        </div>
      </div>

      {notice && (
        <div role="status" aria-live="polite" className="flex items-start gap-2 rounded border border-[#00f5d4]/30 bg-[#00f5d4]/10 p-3 text-sm text-[#d7fff3]">
          <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#00f5d4]" />
          <span>{notice}</span>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left: detection frame */}
        <div className="xl:col-span-2 space-y-6">
          {/* Simulated detection frame */}
          <Card noPad className="overflow-hidden">
            <div className="relative bg-[#020d1e] aspect-video flex items-center justify-center">
              {d.frameUrl ? (
                <>
                  <img src={d.frameUrl} alt={`Detection frame for ${d.className}`} className="absolute inset-0 h-full w-full object-cover" />
                  <div className="absolute border-2 border-red-400"
                    style={{ left: `${d.boundingBox.x}%`, top: `${d.boundingBox.y}%`, width: `${d.boundingBox.w}%`, height: `${d.boundingBox.h}%` }}>
                    <div className="absolute -top-6 left-0 bg-red-400 text-black text-[10px] font-mono font-bold px-1.5 py-0.5 whitespace-nowrap">
                      {d.className} {d.confidence}% | {d.trackId}
                    </div>
                  </div>
                </>
              ) : (
                <div className="relative z-10 flex max-w-xs flex-col items-center gap-3 px-6 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full border border-[#3a4a46] bg-[#161c28] text-[#4cd6fb]">
                    <Camera className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#dde2f3]">Source frame unavailable</p>
                    <p className="mt-1 text-xs leading-relaxed text-[#83948f]">Telemetry and classification data are available, but the camera frame has not synced yet.</p>
                  </div>
                </div>
              )}
              {/* HUD */}
              <div className="absolute top-3 left-3">
                <Badge variant="red" size="xs">FRAME CAPTURE</Badge>
              </div>
              <div className="absolute bottom-3 left-3 right-3 truncate text-[10px] font-mono text-cyan-400/70">
                {formatDateTime(d.detectedAt)} UTC · {d.cameraName}
              </div>
            </div>
          </Card>

          {/* Details grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Class',    value: d.className },
              { label: 'Category', value: d.category },
              { label: 'Size',     value: d.estimatedSize },
              { label: 'Mass',     value: `${d.estimatedMassKg} kg` },
              { label: 'Distance', value: d.estimatedDistance },
              { label: 'Camera',   value: d.cameraName },
              { label: 'Zone',     value: d.zoneName },
              { label: 'Source',   value: d.source },
            ].map(({ label, value }) => (
              <Card key={label} className="py-2.5">
                <p className="text-[10px] text-[var(--ocean-text-muted)] uppercase tracking-wider">{label}</p>
                <p className="text-sm font-semibold text-[var(--ocean-text)] mt-0.5">{value}</p>
              </Card>
            ))}
          </div>

          {/* Status + Confidence */}
          <Card>
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-6">
              <div>
                <p className="text-xs text-[var(--ocean-text-muted)] mb-2">Status</p>
                <span className={`text-sm font-mono px-2 py-1 rounded border ${getDetectionStatusColor(status)}`}>{status.replace('_', ' ')}</span>
              </div>
              <div>
                <p className="text-xs text-[var(--ocean-text-muted)] mb-2">Confidence</p>
                <span className={`text-sm font-mono px-2 py-1 rounded border ${getConfidenceBg(d.confidence)}`}>{d.confidence}%</span>
              </div>
              <div className="flex-1">
                <p className="text-xs text-[var(--ocean-text-muted)] mb-2">Confidence Bar</p>
                <div className="h-2 rounded-full bg-[var(--ocean-border)] overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-green-400 transition-all"
                    style={{ width: `${d.confidence}%` }} />
                </div>
              </div>
            </div>
          </Card>

          {/* Track history */}
          <Card>
            <CardHeader title="Track History" subtitle={`${d.trackPoints?.length ?? 0} points recorded`} icon={<Layers className="w-4 h-4" />} />
            <div className="space-y-2">
              {(d.trackPoints ?? []).map((pt: any, i: number) => (
                <div key={i} className="flex flex-col gap-1 rounded border border-transparent py-1 text-xs sm:flex-row sm:items-center sm:gap-3">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${i === (d.trackPoints.length - 1) ? 'bg-cyan-400' : 'bg-[var(--ocean-border)]'}`} />
                  <span className="font-mono text-[var(--ocean-text-dim)] sm:w-36">{formatDateTime(pt.timestamp)}</span>
                  <span className="text-[var(--ocean-text-muted)]">{pt.lat.toFixed(4)}°N, {Math.abs(pt.lng).toFixed(4)}°W</span>
                  {i === (d.trackPoints.length - 1) && <Badge variant="live" size="xs">CURRENT</Badge>}
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Right: risk score */}
        <div className="space-y-4">
          <Card>
            <CardHeader title="Risk Assessment" icon={<AlertTriangle className="w-4 h-4" />} />
            <div className="flex justify-center mb-6">
              <RiskGauge score={d.riskScore} />
            </div>
            <div className="space-y-2.5">
              <p className="text-[10px] text-[var(--ocean-text-muted)] uppercase tracking-wider font-semibold">
                Risk Breakdown
              </p>
              {d.riskFactors.map((f: any) => (
                <div key={f.label}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-[var(--ocean-text-dim)]">{f.label}</span>
                    <span className="font-mono text-red-400">+{f.score}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[var(--ocean-border)] overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-red-500/60 to-red-400"
                      style={{ width: `${(f.score / 30) * 100}%` }} />
                  </div>
                  <p className="text-[10px] text-[var(--ocean-text-muted)] mt-0.5">{f.description}</p>
                </div>
              ))}
            </div>
          </Card>

          {/* Location */}
          <Card>
            <CardHeader title="Location" icon={<MapPin className="w-4 h-4" />} />
            <div className="space-y-2">
              <div className="p-3 rounded-lg bg-[var(--ocean-surface)] border border-[var(--ocean-border)] font-mono text-xs">
                <p className="text-cyan-400">{d.lat.toFixed(4)}°N</p>
                <p className="text-cyan-400">{Math.abs(d.lng).toFixed(4)}°W</p>
                <p className="text-[var(--ocean-text-muted)] mt-1">{d.locationLabel}</p>
              </div>
            </div>
          </Card>

          {/* Timeline */}
          <Card>
            <CardHeader title="Timeline" icon={<Clock className="w-4 h-4" />} />
            <div className="space-y-3">
              {[
                { label: 'First detected', time: d.detectedAt, color: 'bg-cyan-400' },
                { label: 'Confirmed', time: d.detectedAt, color: 'bg-green-400' },
                { label: 'Tracking active', time: d.detectedAt, color: 'bg-amber-400' },
              ].map(ev => (
                <div key={ev.label} className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${ev.color}`} />
                  <div>
                    <p className="text-xs text-[var(--ocean-text-dim)]">{ev.label}</p>
                    <p className="text-[10px] text-[var(--ocean-text-muted)] font-mono">{formatDateTime(ev.time)}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <Modal
        isOpen={showFalsePositive}
        onClose={() => setShowFalsePositive(false)}
        title="Mark as false positive?"
        subtitle="This removes the detection from the active response workflow."
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setShowFalsePositive(false)}>Cancel</Button>
            <Button variant="danger" size="sm" onClick={confirmFalsePositive}>Confirm false positive</Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-[var(--ocean-text-dim)]">
          Confirm only after reviewing the source evidence. The action is recorded against detection {d.id}.
        </p>
      </Modal>
    </div>
  );
}
