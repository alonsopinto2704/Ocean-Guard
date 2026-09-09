import React, { useEffect, useState } from 'react';
import { Activity, Brain, CheckCircle2, Database, FlaskConical, RefreshCw, ScanLine, Server, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, CardHeader } from '../components/ui/Card';
import { aiApi } from '../lib/api';
import type { AIServiceStatus } from '../types';

function Metric({ label, value }: { label: string; value: number | undefined }) {
  const percent = value == null ? null : value <= 1 ? value * 100 : value;
  const formatted = percent == null ? 'Awaiting validation' : `${percent.toFixed(1)}%`;
  return (
    <div className="rounded border border-[var(--ocean-border)] bg-[var(--ocean-surface)] p-3">
      <p className="text-[10px] uppercase tracking-wider text-[var(--ocean-text-muted)]">{label}</p>
      <p className={`mt-1 font-mono font-bold ${percent == null ? 'text-sm text-[#ffaa00]' : 'text-xl text-[#00f5d4]'}`}>{formatted}</p>
      {percent != null && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#2f3542]">
          <div className="h-full rounded-full bg-[#00f5d4]" style={{ width: `${Math.min(percent, 100)}%` }} />
        </div>
      )}
    </div>
  );
}

export default function AIModels() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<AIServiceStatus | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadStatus() {
    setLoading(true);
    try {
      setStatus(await aiApi.status());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadStatus(); }, []);

  const ready = Boolean(status?.ready);
  const stateVariant = ready ? 'green' : status?.state === 'ERROR' ? 'red' : 'amber';
  const metrics = status?.metrics || null;
  const learning = status?.learning;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-[var(--ocean-text-dim)]">One production registry entry. No simulated models or fabricated scores.</p>
        </div>
        <Button variant="outline" size="sm" loading={loading} icon={<RefreshCw className="h-4 w-4" />} onClick={() => void loadStatus()}>
          Refresh status
        </Button>
      </div>

      <Card className="relative overflow-hidden border-[#00f5d4]/35">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#00f5d4] to-transparent" />
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="rounded border border-[#00f5d4]/30 bg-[#00f5d4]/10 p-3 text-[#00f5d4]"><Brain className="h-7 w-7" /></div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-bold text-[var(--ocean-text)]">Espada</h2>
                <Badge variant="outline-cyan" size="xs">VERSION 1</Badge>
                <Badge variant={stateVariant} size="xs">{loading ? 'CHECKING' : status?.state || 'OFFLINE'}</Badge>
              </div>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--ocean-text-dim)]">
                Real-time marine-debris object detection, risk analysis, confidence reporting, and human-reviewed continual learning. Espada runs through the deployed ONNX service and does not call a paid AI API.
              </p>
              {(status?.error || status?.notice) && <p role="status" className="mt-3 text-xs text-[#ffaa00]">{status.error || status.notice}</p>}
            </div>
          </div>
          <Button variant="primary" size="sm" icon={<ScanLine className="h-4 w-4" />} onClick={() => navigate('/data')}>
            Try Espada
          </Button>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Validated performance" subtitle="Metrics appear only after evaluation on held-out marine imagery" icon={<Activity className="h-4 w-4" />} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Metric label="mAP at IoU 0.50" value={metrics?.map50} />
              <Metric label="Precision at IoU 0.50" value={metrics?.iou50Precision} />
              <Metric label="Recall at IoU 0.50" value={metrics?.iou50Recall} />
              <Metric label="F1 at IoU 0.50" value={metrics?.iou50F1} />
            </div>
          </Card>

          <Card>
            <CardHeader title="Detection classes" subtitle={`${status?.classes.length ?? 0} configured marine-debris classes`} icon={<ScanLine className="h-4 w-4" />} />
            {status?.classes.length ? (
              <div className="flex flex-wrap gap-2">
                {status.classes.map((className) => <Badge key={className} variant="cyan" size="xs">{className}</Badge>)}
              </div>
            ) : (
              <p className="text-sm text-[var(--ocean-text-dim)]">Class metadata will appear when the Espada service is online.</p>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Runtime" icon={<Server className="h-4 w-4" />} />
            <dl className="space-y-3 text-xs">
              {[
                ['Inference engine', status?.engine || 'ONNX Runtime'],
                ['Architecture', status?.architecture || 'Faster R-CNN MobileNetV3 FPN'],
                ['Input size', `${status?.inputSize || 640} × ${status?.inputSize || 640}`],
                ['Confidence', status?.confidenceCalibration === 'validation_bins'
                  ? 'Calibrated on validation data'
                  : status?.confidenceCalibration === 'visual_anomaly_score'
                  ? 'Visual anomaly score (uncalibrated)'
                  : 'Raw score until calibration'],
                ['Paid API keys', 'None'],
              ].map(([label, value]) => (
                <div key={label} className="flex items-start justify-between gap-4 border-b border-[var(--ocean-border)]/60 pb-3 last:border-0 last:pb-0">
                  <dt className="text-[var(--ocean-text-muted)]">{label}</dt>
                  <dd className="text-right font-mono text-[var(--ocean-text)]">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card>
            <CardHeader title="Continual learning" subtitle="Human-reviewed, asynchronous, safely promoted" icon={<FlaskConical className="h-4 w-4" />} />
            <div className="grid grid-cols-2 gap-2">
              {[
                ['Analyses stored', learning?.analysesStored ?? 0],
                ['Detections reviewed', learning?.detectionsReviewed ?? 0],
                ['Approved examples', learning?.approvedTrainingExamples ?? 0],
                ['False positives', learning?.falsePositivesReviewed ?? 0],
              ].map(([label, value]) => (
                <div key={label} className="rounded border border-[var(--ocean-border)] bg-[var(--ocean-surface)] p-3">
                  <p className="font-mono text-lg font-bold text-[#d7fff3]">{value}</p>
                  <p className="mt-1 text-[10px] text-[var(--ocean-text-muted)]">{label}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 space-y-2 text-xs text-[var(--ocean-text-dim)]">
              <p className="flex gap-2"><Database className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[#4cd6fb]" />Reviewed examples are versioned in the learning store.</p>
              <p className="flex gap-2"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[#00f5d4]" />A candidate replaces the live model only after its validation F1 improves.</p>
              <p className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[#00f5d4]" />Live inference remains available while retraining runs separately.</p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
