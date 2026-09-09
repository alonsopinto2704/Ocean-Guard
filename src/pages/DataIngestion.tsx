import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  Check,
  CheckCircle2,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  ScanLine,
  Upload,
  Video,
  X,
} from 'lucide-react';
import { DetectionOverlay, ConfidenceMeter } from '../components/ai/DetectionOverlay';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, CardHeader } from '../components/ui/Card';
import { aiApi } from '../lib/api';
import { formatBytes } from '../lib/utils';
import type { AIFeedbackVerdict, AIInferenceResult, AIServiceStatus } from '../types';

type AnalysisState = 'ANALYZING' | 'COMPLETE' | 'FAILED';

interface AnalysisItem {
  id: string;
  name: string;
  size: number;
  previewUrl: string;
  state: AnalysisState;
  result: AIInferenceResult | null;
  error: string | null;
}

const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

function riskVariant(risk: string) {
  if (risk === 'CRITICAL' || risk === 'HIGH') return 'red' as const;
  if (risk === 'MEDIUM') return 'amber' as const;
  return 'cyan' as const;
}

function ResultSummary({ result }: { result: AIInferenceResult }) {
  const cards = [
    ['Objects', result.summary.totalDetections],
    ['Mean confidence', `${result.summary.meanConfidence.toFixed(1)}%`],
    ['High risk', result.summary.highRiskDetections],
    ['Inference', `${result.latencyMs.toFixed(0)}ms`],
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {cards.map(([label, value]) => (
        <div key={label} className="rounded border border-[var(--ocean-border)] bg-[var(--ocean-surface)] p-3">
          <p className="text-[10px] uppercase tracking-wider text-[var(--ocean-text-muted)]">{label}</p>
          <p className="mt-1 font-mono text-lg font-bold text-[#d7fff3]">{value}</p>
        </div>
      ))}
    </div>
  );
}

function DetectionReview({ result, classes }: { result: AIInferenceResult; classes: string[] }) {
  const [reviewed, setReviewed] = useState<Record<string, AIFeedbackVerdict>>({});
  const [corrections, setCorrections] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function review(detectionId: string, verdict: AIFeedbackVerdict, correctedClass?: string) {
    setSaving(detectionId);
    setError(null);
    try {
      await aiApi.feedback({ analysisId: result.analysisId, detectionId, verdict, correctedClass });
      setReviewed((current) => ({ ...current, [detectionId]: verdict }));
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : 'Review could not be saved.');
    } finally {
      setSaving(null);
    }
  }

  if (result.detections.length === 0) {
    return (
      <div className="rounded border border-[var(--ocean-border)] bg-[var(--ocean-surface)] p-4 text-sm text-[var(--ocean-text-dim)]">
        Espada found no objects above the active confidence threshold.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && <p role="alert" className="text-xs text-[#ffb4ab]">{error}</p>}
      {result.detections.map((detection) => {
        const verdict = reviewed[detection.id];
        return (
          <div key={detection.id} className="rounded border border-[var(--ocean-border)] bg-[var(--ocean-surface)] p-3">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-bold text-[var(--ocean-text)]">{detection.className}</p>
                <p className="text-[10px] text-[var(--ocean-text-muted)]">{detection.parentCategory} · {detection.id}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={riskVariant(detection.riskLevel)} size="xs">{detection.riskLevel}</Badge>
                <span className="font-mono text-xs text-[var(--ocean-text-dim)]">Risk {detection.riskScore}</span>
              </div>
            </div>
            <ConfidenceMeter value={detection.confidence} calibrated={detection.confidenceCalibrated} method={result.analysis.confidenceMethod} />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                size="xs"
                variant={verdict === 'CONFIRMED' ? 'success' : 'outline'}
                icon={<Check className="h-3.5 w-3.5" />}
                loading={saving === detection.id}
                onClick={() => review(detection.id, 'CONFIRMED')}
              >
                Confirm
              </Button>
              <Button
                size="xs"
                variant={verdict === 'FALSE_POSITIVE' ? 'danger' : 'outline'}
                icon={<X className="h-3.5 w-3.5" />}
                loading={saving === detection.id}
                onClick={() => review(detection.id, 'FALSE_POSITIVE')}
              >
                Not debris
              </Button>
              <label className="sr-only" htmlFor={`correct-${result.analysisId}-${detection.id}`}>Correct class for {detection.className}</label>
              <select
                id={`correct-${result.analysisId}-${detection.id}`}
                value={corrections[detection.id] || detection.className}
                onChange={(event) => setCorrections((current) => ({ ...current, [detection.id]: event.target.value }))}
                className="min-h-9 rounded border border-[var(--ocean-border)] bg-[#080e1a] px-2 text-xs text-[var(--ocean-text)] focus:outline-none focus:ring-2 focus:ring-[#4cd6fb]"
              >
                {classes.map((className) => <option key={className} value={className}>{className}</option>)}
              </select>
              <Button
                size="xs"
                variant={verdict === 'CORRECTED' ? 'success' : 'outline'}
                loading={saving === detection.id}
                disabled={!corrections[detection.id] || corrections[detection.id] === detection.className}
                onClick={() => review(detection.id, 'CORRECTED', corrections[detection.id])}
              >
                Save correction
              </Button>
              {verdict && <span className="text-[10px] text-[#00f5d4]">Saved to the reviewed learning queue</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function DataIngestion() {
  const [dragging, setDragging] = useState(false);
  const [analyses, setAnalyses] = useState<AnalysisItem[]>([]);
  const [modelStatus, setModelStatus] = useState<AIServiceStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [liveActive, setLiveActive] = useState(false);
  const [liveResult, setLiveResult] = useState<AIInferenceResult | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [frameCount, setFrameCount] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameBusyRef = useRef(false);
  const objectUrlsRef = useRef<string[]>([]);

  async function refreshStatus() {
    setStatusLoading(true);
    try {
      setModelStatus(await aiApi.status());
    } finally {
      setStatusLoading(false);
    }
  }

  useEffect(() => {
    void refreshStatus();
    return () => {
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function analyze(file: File) {
    const id = `ANALYSIS-${crypto.randomUUID()}`;
    const previewUrl = URL.createObjectURL(file);
    objectUrlsRef.current.push(previewUrl);
    const item: AnalysisItem = { id, name: file.name, size: file.size, previewUrl, state: 'ANALYZING', result: null, error: null };
    setAnalyses((current) => [item, ...current]);

    if (!ACCEPTED_TYPES.has(file.type)) {
      setAnalyses((current) => current.map((entry) => entry.id === id
        ? { ...entry, state: 'FAILED', error: 'Use a JPG, PNG, or WebP image.' }
        : entry));
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setAnalyses((current) => current.map((entry) => entry.id === id
        ? { ...entry, state: 'FAILED', error: 'Image exceeds the 20 MB limit.' }
        : entry));
      return;
    }

    try {
      const result = await aiApi.inferImage(file);
      setAnalyses((current) => current.map((entry) => entry.id === id ? { ...entry, state: 'COMPLETE', result } : entry));
    } catch (analysisError) {
      setAnalyses((current) => current.map((entry) => entry.id === id
        ? { ...entry, state: 'FAILED', error: analysisError instanceof Error ? analysisError.message : 'Espada could not analyze this image.' }
        : entry));
    }
  }

  function onDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragging(false);
    Array.from(event.dataTransfer.files).forEach((file) => void analyze(file));
  }

  function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    Array.from(event.target.files ?? []).forEach((file) => void analyze(file));
    event.target.value = '';
  }

  async function startCamera() {
    setLiveError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access requires HTTPS (or localhost) in a supported browser.');
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setFrameCount(0);
      setLiveActive(true);
    } catch (cameraError) {
      setLiveError(cameraError instanceof Error ? cameraError.message : 'Camera access was denied.');
    }
  }

  function stopCamera() {
    setLiveActive(false);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  useEffect(() => {
    if (!liveActive) return;
    let cancelled = false;

    async function analyzeFrame() {
      if (frameBusyRef.current || cancelled) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2 || !video.videoWidth) return;
      frameBusyRef.current = true;
      try {
        const targetWidth = Math.min(video.videoWidth, 960);
        const targetHeight = Math.round(targetWidth * video.videoHeight / video.videoWidth);
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        canvas.getContext('2d')?.drawImage(video, 0, 0, targetWidth, targetHeight);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
        if (!blob) throw new Error('Could not capture a camera frame.');
        const result = await aiApi.inferImage(blob, `live-frame-${Date.now()}.jpg`);
        if (!cancelled) {
          setLiveResult(result);
          setFrameCount((count) => count + 1);
          setLiveError(null);
        }
      } catch (frameError) {
        if (!cancelled) setLiveError(frameError instanceof Error ? frameError.message : 'Live inference failed.');
      } finally {
        frameBusyRef.current = false;
      }
    }

    void analyzeFrame();
    const timer = window.setInterval(() => void analyzeFrame(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [liveActive]);

  const statusVariant = modelStatus?.ready ? 'green' : modelStatus?.state === 'ERROR' ? 'red' : 'amber';

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded border border-[#00f5d4]/30 bg-[#00f5d4]/10 p-2 text-[#00f5d4]"><ScanLine className="h-5 w-5" /></div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-bold text-[var(--ocean-text)]">Espada · version 1</h2>
                {statusLoading ? <Badge variant="outline" size="xs">CHECKING</Badge> : <Badge variant={statusVariant} size="xs">{modelStatus?.state || 'OFFLINE'}</Badge>}
              </div>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[var(--ocean-text-dim)]">
                Real server-side object detection. Reviewed confirmations and mistakes enter the asynchronous continual-learning queue; only a validated candidate can replace the live model.
              </p>
              {(modelStatus?.error || modelStatus?.notice) && <p role="status" className="mt-2 text-xs text-[#ffaa00]">{modelStatus.error || modelStatus.notice}</p>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded border border-[var(--ocean-border)] bg-[var(--ocean-surface)] px-3 py-2 text-[10px] text-[var(--ocean-text-muted)]">
              <span className="font-mono text-[#d7fff3]">{modelStatus?.learning?.detectionsReviewed ?? 0}</span> reviewed · <span className="font-mono text-[#d7fff3]">{modelStatus?.classes.length ?? 0}</span> classes
            </div>
            <Button size="sm" variant="outline" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void refreshStatus()}>Refresh</Button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card
          className={`border-2 border-dashed transition-colors ${dragging ? 'border-[#00f5d4] bg-[#00f5d4]/5' : 'border-[var(--ocean-border)]'}`}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <div className="flex min-h-64 flex-col items-center justify-center gap-4 text-center">
            <div className="rounded-full border border-[#00f5d4]/30 bg-[#00f5d4]/10 p-4 text-[#00f5d4]"><Upload className="h-7 w-7" /></div>
            <div>
              <h3 className="text-sm font-bold text-[var(--ocean-text)]">Test Espada with an image</h3>
              <p className="mt-1 text-xs text-[var(--ocean-text-dim)]">JPG, PNG, or WebP · maximum 20 MB</p>
            </div>
            <Button variant="primary" size="sm" icon={<ImageIcon className="h-4 w-4" />} onClick={() => fileRef.current?.click()}>Choose image</Button>
            <input ref={fileRef} type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onFile} />
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Live camera inference"
            subtitle={liveActive ? `Analyzing one frame every 1.5 seconds · ${frameCount} processed` : 'Runs in the browser through the deployed Espada service'}
            icon={<Video className="h-4 w-4" />}
            action={liveActive
              ? <Button variant="danger" size="xs" onClick={stopCamera}>Stop camera</Button>
              : <Button variant="primary" size="xs" icon={<Camera className="h-3.5 w-3.5" />} onClick={() => void startCamera()}>Start camera</Button>}
          />
          <div className="relative flex min-h-52 items-center justify-center overflow-hidden rounded border border-[var(--ocean-border)] bg-[#080e1a]">
            <video ref={videoRef} muted playsInline className={`block h-auto w-full ${liveActive ? '' : 'invisible'}`} />
            <DetectionOverlay result={liveResult} />
            {!liveActive && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center text-[var(--ocean-text-muted)]">
                <Camera className="h-7 w-7" />
                <span className="text-xs">Camera is stopped</span>
              </div>
            )}
          </div>
          <canvas ref={canvasRef} className="hidden" />
          {liveError && <p role="alert" className="mt-3 text-xs text-[#ffb4ab]">{liveError}</p>}
          {liveResult && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-[var(--ocean-text-muted)]">
              <Badge variant="live" size="xs">LIVE</Badge>
              <span>{liveResult.detections.length} objects</span><span>·</span>
              <span>{liveResult.latencyMs.toFixed(0)}ms inference</span><span>·</span>
              <span>{liveResult.model.name} {liveResult.model.version}</span>
            </div>
          )}
          {liveResult && !liveActive && (
            <div className="mt-4 border-t border-[var(--ocean-border)] pt-4">
              <p className="mb-3 text-xs font-semibold text-[var(--ocean-text)]">Review the last camera frame</p>
              <DetectionReview result={liveResult} classes={modelStatus?.classes || []} />
            </div>
          )}
        </Card>
      </div>

      {analyses.length === 0 ? (
        <Card className="py-10 text-center">
          <ImageIcon className="mx-auto h-7 w-7 text-[var(--ocean-text-muted)]" />
          <p className="mt-3 text-sm font-semibold text-[var(--ocean-text)]">No test analyses yet</p>
          <p className="mt-1 text-xs text-[var(--ocean-text-dim)]">Choose a marine image to see Espada’s real output here.</p>
        </Card>
      ) : (
        <div className="space-y-5">
          {analyses.map((item) => (
            <Card key={item.id}>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <ImageIcon className="h-4 w-4 flex-shrink-0 text-[#a370f7]" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-[var(--ocean-text)]">{item.name}</p>
                    <p className="text-[10px] text-[var(--ocean-text-muted)]">{formatBytes(item.size)}</p>
                  </div>
                </div>
                {item.state === 'ANALYZING' && <Badge variant="cyan" size="xs"><Loader2 className="mr-1 h-3 w-3 animate-spin" /> ANALYZING</Badge>}
                {item.state === 'COMPLETE' && <Badge variant="green" size="xs"><CheckCircle2 className="mr-1 h-3 w-3" /> COMPLETE</Badge>}
                {item.state === 'FAILED' && <Badge variant="red" size="xs"><AlertTriangle className="mr-1 h-3 w-3" /> FAILED</Badge>}
              </div>
              {item.state === 'FAILED' ? (
                <div role="alert" className="rounded border border-[#ff5964]/30 bg-[#93000a]/15 p-4 text-sm text-[#ffb4ab]">{item.error}</div>
              ) : (
                <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">
                  <div className="space-y-3">
                    <div className="relative w-fit max-w-full overflow-hidden rounded border border-[var(--ocean-border)] bg-[#080e1a]">
                      <img src={item.previewUrl} alt={`Analysis source ${item.name}`} className="block h-auto max-h-[34rem] max-w-full" />
                      <DetectionOverlay result={item.result} />
                    </div>
                    {item.result && <ResultSummary result={item.result} />}
                  </div>
                  <div>
                    {item.state === 'ANALYZING' ? (
                      <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded border border-[var(--ocean-border)] bg-[var(--ocean-surface)] text-[var(--ocean-text-dim)]">
                        <Loader2 className="h-6 w-6 animate-spin text-[#00f5d4]" />
                        <p className="text-xs">Espada is analyzing the image…</p>
                      </div>
                    ) : item.result ? <DetectionReview result={item.result} classes={modelStatus?.classes || []} /> : null}
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
