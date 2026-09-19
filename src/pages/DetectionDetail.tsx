import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Camera, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { Badge } from '../components/ui/Badge';
import { Card, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { LoadingState } from '../components/ui/StateComponents';
import { detectionsApi } from '../lib/api';
import { getDetectionStatusColor, formatDateTime } from '../lib/utils';

/** Circular SVG gauge showing the 0-100 risk score with a tier badge below. */
function RiskGauge({ score }: { score: number }) {
  const r = 54, c = 2 * Math.PI * r;
  const dash = (score / 100) * c;
  const color = score >= 80 ? '#ff4455' : score >= 60 ? '#ff8800' : score >= 30 ? '#ffaa00' : '#00ff88';
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-32 h-32">
        <svg width="128" height="128" viewBox="0 0 128 128">
          <circle cx="64" cy="64" r={r} fill="none" stroke="var(--ocean-border)" strokeWidth="8" />
          <circle
            cx="64"
            cy="64"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="8"
            strokeDasharray={`${dash} ${c}`}
            strokeLinecap="round"
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

/** Detection detail: frame with bounding box, metadata grid, risk-factor
 *  breakdown, drift track history, false-positive flagging, and a hand-off
 *  to cleanup mission planning. */
export default function DetectionDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [detection, setDetection] = useState<any | null>(null);
  const [track, setTrack] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showFalsePositive, setShowFalsePositive] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [notice, setNotice] = useState('');

  // Load the detection and its track in parallel; a missing track is non-fatal.
  const loadData = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [d, t] = await Promise.all([
        detectionsApi.get(id),
        detectionsApi.track(id).catch(() => null),
      ]);
      setDetection(d);
      setTrack(t);
    } catch (err: any) {
      setError(err.message || `Detection record ${id} was not found.`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [id]);

  // Navigate to cleanup planning carrying this detection as the mission source.
  const handleCreateMission = () => {
    if (!detection) return;
    navigate(`/cleanup?source=${encodeURIComponent(detection.id)}`, {
      state: {
        sourceDetection: {
          id: detection.id,
          className: detection.className,
          riskLevel: detection.riskLevel,
          zoneName: detection.zoneName,
          locationLabel: detection.locationLabel,
          estimatedMassKg: detection.estimatedMassKg,
          detectionCount: 1,
        },
      },
    });
  };

  const confirmFalsePositive = async () => {
    if (!detection) return;
    setActionLoading(true);
    try {
      const updated = await detectionsApi.updateStatus(detection.id, 'FALSE_POSITIVE');
      setDetection(updated);
      setShowFalsePositive(false);
      setNotice(`${detection.id} has been recorded as a false positive. Target is omitted from autonomous cleanup queues.`);
    } catch (err: any) {
      alert(`Failed to update status: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return <LoadingState message="Loading detection telemetry..." size="lg" className="h-full p-12" />;
  }

  if (error || !detection) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-4 text-center">
        <div className="p-8 rounded-xl border border-red-500/30 bg-red-500/10">
          <XCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-white mb-2">Record Not Found</h2>
          <p className="text-xs text-[var(--ocean-text-dim)] mb-6">
            {error || `Detection record ${id} does not exist in the database.`}
          </p>
          <Button variant="primary" size="sm" icon={<ArrowLeft className="w-4 h-4" />} onClick={() => navigate('/detections')}>
            Return to Detections
          </Button>
        </div>
      </div>
    );
  }

  const d = detection;
  const status = d.status;

  return (
    <div className="p-3 sm:p-6 space-y-6 max-w-6xl mx-auto">
      {/* Back + Header */}
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
              <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${getDetectionStatusColor(status)}`}>
                {status}
              </span>
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
            Plan Cleanup Mission
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
        {/* Left Column: Image/Box + Details */}
        <div className="xl:col-span-2 space-y-6">
          <Card noPad className="overflow-hidden">
            <div className="relative bg-[#020d1e] aspect-video flex items-center justify-center">
              {d.frameUrl ? (
                <>
                  <img src={d.frameUrl} alt={`Detection frame for ${d.className}`} className="absolute inset-0 h-full w-full object-cover" />
                  {d.boundingBox && (
                    <div
                      className="absolute border-2 border-red-400"
                      style={{
                        left: `${d.boundingBox.x * 100}%`,
                        top: `${d.boundingBox.y * 100}%`,
                        width: `${d.boundingBox.width * 100}%`,
                        height: `${d.boundingBox.height * 100}%`,
                      }}
                    >
                      <div className="absolute -top-6 left-0 bg-red-400 text-black text-[10px] font-mono font-bold px-1.5 py-0.5 whitespace-nowrap">
                        {d.className} {d.confidence}% | {d.trackId}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="relative z-10 flex max-w-xs flex-col items-center gap-3 px-6 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full border border-[#3a4a46] bg-[#161c28] text-[#4cd6fb]">
                    <Camera className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#dde2f3]">Sensor Detection Frame</p>
                    <p className="mt-1 text-xs leading-relaxed text-[#83948f]">
                      Captured by {d.cameraName || 'Station Camera'} at {d.detectedAt ? formatDateTime(d.detectedAt) : 'UTC'}. Bounding boxes and spatial telemetry verified.
                    </p>
                  </div>
                </div>
              )}
              {/* HUD */}
              <div className="absolute top-3 left-3">
                <Badge variant="red" size="xs">SURVEILLANCE FRAME</Badge>
              </div>
              <div className="absolute bottom-3 left-3 right-3 truncate text-[10px] font-mono text-cyan-400/80">
                {formatDateTime(d.detectedAt)} · {d.cameraName} · {d.locationLabel}
              </div>
            </div>
          </Card>

          {/* Details Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Debris Class',   value: d.className },
              { label: 'Category',       value: d.category },
              { label: 'Estimated Size', value: d.estimatedSize },
              { label: 'Est. Mass',      value: `${d.estimatedMassKg} kg` },
              { label: 'Camera Distance',value: d.estimatedDistance },
              { label: 'Sensor Device',  value: d.cameraName },
              { label: 'Marine Zone',    value: d.zoneName },
              { label: 'Ingestion Feed', value: d.source },
            ].map(({ label, value }) => (
              <div key={label} className="p-3 rounded-lg bg-[var(--ocean-card)] border border-[var(--ocean-border)]">
                <p className="text-[10px] text-[var(--ocean-text-muted)] uppercase tracking-wider">{label}</p>
                <p className="text-xs font-semibold text-[var(--ocean-text)] mt-1 truncate">{value}</p>
              </div>
            ))}
          </div>

          {/* Risk Factors Breakdown */}
          <Card>
            <CardHeader title="Neural & Environmental Risk Breakdown" />
            <div className="space-y-3">
              {d.riskFactors && d.riskFactors.length > 0 ? (
                d.riskFactors.map((rf: any, i: number) => (
                  <div key={i} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-[var(--ocean-text)]">{rf.label}</span>
                      <span className="font-mono text-cyan-400 font-bold">+{rf.score} pts</span>
                    </div>
                    {rf.description && (
                      <p className="text-[11px] text-[var(--ocean-text-muted)]">{rf.description}</p>
                    )}
                    <div className="h-1.5 rounded-full bg-[var(--ocean-border)] overflow-hidden">
                      <div className="h-full bg-cyan-400 rounded-full" style={{ width: `${Math.min(100, rf.score * 3)}%` }} />
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-xs text-[var(--ocean-text-muted)]">No elevated risk factors detected for this object.</p>
              )}
            </div>
          </Card>
        </div>

        {/* Right Column: Risk Gauge + Coordinates & Track Points */}
        <div className="space-y-6">
          <Card className="flex flex-col items-center p-6 text-center">
            <h3 className="text-sm font-semibold text-[var(--ocean-text)] mb-4">Cumulative Environmental Risk</h3>
            <RiskGauge score={d.riskScore} />
            <p className="text-xs text-[var(--ocean-text-muted)] mt-4 leading-relaxed">
              Calculated using object surface area, proximity to shipping lanes, drift velocity, and marine protected zone boundaries.
            </p>
          </Card>

          {/* Track History */}
          <Card>
            <CardHeader title="Tracking History & Drift" subtitle={`Track ID ${d.trackId}`} />
            <div className="space-y-3">
              {(track?.points || d.trackPoints || []).map((pt: any, i: number) => (
                <div key={i} className="flex items-start gap-3 relative text-xs">
                  <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 flex-shrink-0 mt-1" />
                  <div className="flex-1 min-w-0">
                    <p className="font-mono font-semibold text-[var(--ocean-text)]">
                      {pt.lat?.toFixed(4)}°N, {pt.lng?.toFixed(4)}°E
                    </p>
                    <p className="text-[10px] text-[var(--ocean-text-muted)] font-mono">
                      {formatDateTime(pt.timestamp)} {pt.confidence ? `· ${pt.confidence}% confidence` : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* False Positive Confirmation Modal */}
      <Modal
        isOpen={showFalsePositive}
        onClose={() => setShowFalsePositive(false)}
        title="Confirm False Positive Decision"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-xs text-[var(--ocean-text-dim)]">
            Flagging <strong>{d.id}</strong> as a false positive will immediately update operational logs and suppress this target from cleanup dispatches.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={() => setShowFalsePositive(false)}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" loading={actionLoading} onClick={confirmFalsePositive}>
              Confirm False Positive
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
