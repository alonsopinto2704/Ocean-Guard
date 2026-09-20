import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  ScanLine,
  Upload,
  Video,
} from 'lucide-react';
import { DetectionOverlay } from '../components/ai/DetectionOverlay';
import { AnnotationEditor } from '../components/ai/AnnotationEditor';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, CardHeader } from '../components/ui/Card';
import { aiApi } from '../lib/api';
import { formatBytes } from '../lib/utils';
import type { AIInferenceResult, AIServiceStatus } from '../types';

type AnalysisState = 'QUEUED' | 'ANALYZING' | 'COMPLETE' | 'FAILED';

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
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

function formatMetric(value: number | undefined) {
  if (value == null) return 'Pending';
  return `${(value <= 1 ? value * 100 : value).toFixed(1)}%`;
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

// Espada AI & Data page: upload images (drag-drop or picker) for real server-side
// detection, run live camera inference on a 1.5s loop, and review/annotate frames.
export default function DataIngestion() {
  const [dragging, setDragging] = useState(false);
  const [analyses, setAnalyses] = useState<AnalysisItem[]>([]);
  const [modelStatus, setModelStatus] = useState<AIServiceStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [liveActive, setLiveActive] = useState(false);
  const [liveResult, setLiveResult] = useState<AIInferenceResult | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [frameCount, setFrameCount] = useState(0);
  const [liveFrameUrl, setLiveFrameUrl] = useState<string | null>(null);
  const [cameraStarting, setCameraStarting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const liveFrameRef = useRef<string | null>(null);
  const liveAbortRef = useRef<AbortController | null>(null);
  const cameraGeneration = useRef(0);
  const objectUrlsRef = useRef<string[]>([]);
  const uploadQueueRef = useRef<Array<{ file: File; item: AnalysisItem }>>([]);
  const activeUploadsRef = useRef(0);

  // Re-fetch Espada model status (engine, metrics, learning counters).
  async function refreshStatus() {
    setStatusLoading(true);
    try {
      setModelStatus(await aiApi.status());
      setStatusError(null);
    } catch (error) {
      setModelStatus(null);
      setStatusError(error instanceof Error ? error.message : 'Could not reach Espada.');
    } finally {
      setStatusLoading(false);
    }
  }

  useEffect(() => {
    void refreshStatus();
    return () => {
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      uploadQueueRef.current = [];
      cameraGeneration.current++;
      liveAbortRef.current?.abort();
      if (liveFrameRef.current) URL.revokeObjectURL(liveFrameRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  // Validate type/size, send the image to /ai/infer-image, and record the result
  // (or the failure) on the matching analysis item.
  async function processAnalysis(file: File, item: AnalysisItem) {
    setAnalyses((current) => current.map((entry) => entry.id === item.id
      ? { ...entry, state: 'ANALYZING' }
      : entry));
    if (!ACCEPTED_TYPES.has(file.type)) {
      setAnalyses((current) => current.map((entry) => entry.id === item.id
        ? { ...entry, state: 'FAILED', error: 'Use a JPG, PNG, or WebP image.' }
        : entry));
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setAnalyses((current) => current.map((entry) => entry.id === item.id
        ? { ...entry, state: 'FAILED', error: 'Image exceeds the 4 MB limit.' }
        : entry));
      return;
    }

    try {
      const result = await aiApi.inferImage(file);
      setAnalyses((current) => current.map((entry) => entry.id === item.id ? { ...entry, state: 'COMPLETE', result } : entry));
    } catch (analysisError) {
      setAnalyses((current) => current.map((entry) => entry.id === item.id
        ? { ...entry, state: 'FAILED', error: analysisError instanceof Error ? analysisError.message : 'Espada could not analyze this image.' }
        : entry));
    }
  }

  // Upload worker: keeps at most 2 analyses in flight, draining the queue as each finishes.
  function drainUploadQueue() {
    while (activeUploadsRef.current < 2 && uploadQueueRef.current.length > 0) {
      const queued = uploadQueueRef.current.shift();
      if (!queued) return;
      activeUploadsRef.current += 1;
      void processAnalysis(queued.file, queued.item).finally(() => {
        activeUploadsRef.current -= 1;
        drainUploadQueue();
      });
    }
  }

  function enqueueFiles(files: File[]) {
    const queued = files.map((file) => {
      const previewUrl = URL.createObjectURL(file);
      objectUrlsRef.current.push(previewUrl);
      return {
        file,
        item: {
          id: `ANALYSIS-${crypto.randomUUID()}`,
          name: file.name,
          size: file.size,
          previewUrl,
          state: 'QUEUED' as const,
          result: null,
          error: null,
        },
      };
    });
    if (!queued.length) return;
    setAnalyses((current) => [...queued.map(({ item }) => item), ...current]);
    uploadQueueRef.current.push(...queued);
    drainUploadQueue();
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    enqueueFiles(Array.from(event.dataTransfer.files));
  }

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    enqueueFiles(Array.from(event.target.files ?? []));
    event.target.value = '';
  }

  // Request the rear camera if available and attach the stream to the <video>.
  // A generation counter guards against races when the camera is started/stopped quickly.
  async function startCamera() {
    setLiveError(null);
    if (streamRef.current || cameraStarting) return;
    const generation = ++cameraGeneration.current;
    setCameraStarting(true);
    setLiveResult(null);
    setLiveFrameUrl(null);
    if (liveFrameRef.current) URL.revokeObjectURL(liveFrameRef.current);
    liveFrameRef.current = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access requires HTTPS (or localhost) in a supported browser.');
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
      if (generation !== cameraGeneration.current) { stream.getTracks().forEach(track => track.stop()); return; }
      streamRef.current = stream;
      stream.getTracks().forEach((track) => track.addEventListener('ended', () => {
        stopCameraForGeneration(generation, stream, 'Camera access ended. You can restart the camera when it is available.');
      }, { once: true }));
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setFrameCount(0);
      setLiveActive(true);
    } catch (cameraError) {
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      setLiveError(cameraError instanceof Error ? cameraError.message : 'Camera access was denied.');
    } finally {
      if (generation === cameraGeneration.current) setCameraStarting(false);
    }
  }

  function stopCameraForGeneration(generation: number, stream: MediaStream, message?: string) {
    if (generation !== cameraGeneration.current || streamRef.current !== stream) return;
    cameraGeneration.current += 1;
    liveAbortRef.current?.abort();
    setCameraStarting(false);
    setLiveActive(false);
    stream.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    if (message) setLiveError(message);
  }

  function stopCamera() {
    const stream = streamRef.current;
    if (stream) {
      stopCameraForGeneration(cameraGeneration.current, stream);
      return;
    }
    cameraGeneration.current += 1;
    liveAbortRef.current?.abort();
    setCameraStarting(false);
    setLiveActive(false);
  }

  // Live inference loop: while the camera is active, grab a frame every 1.5s,
  // downscale it to ≤960px, and send it for detection. The busy flag prevents
  // overlapping requests when inference is slower than the interval.
  useEffect(() => {
    if (!liveActive) return;
    let cancelled = false;
    let frameBusy = false;
    const controller = new AbortController();
    liveAbortRef.current = controller;

    async function analyzeFrame() {
      if (frameBusy || cancelled || controller.signal.aborted) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2 || !video.videoWidth) return;
      frameBusy = true;
      try {
        const targetWidth = Math.min(video.videoWidth, 960);
        const targetHeight = Math.round(targetWidth * video.videoHeight / video.videoWidth);
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        canvas.getContext('2d')?.drawImage(video, 0, 0, targetWidth, targetHeight);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
        if (!blob) throw new Error('Could not capture a camera frame.');
        if (cancelled || controller.signal.aborted) return;
        const result = await aiApi.inferImage(blob, `live-frame-${Date.now()}.jpg`, controller.signal);
        if (!cancelled && !controller.signal.aborted) {
          const previewUrl = URL.createObjectURL(blob);
          if (liveFrameRef.current) URL.revokeObjectURL(liveFrameRef.current);
          liveFrameRef.current = previewUrl;
          setLiveFrameUrl(previewUrl);
          setLiveResult(result);
          setFrameCount((count) => count + 1);
          setLiveError(null);
        }
      } catch (frameError) {
        if (!cancelled && !controller.signal.aborted) setLiveError(frameError instanceof Error ? frameError.message : 'Live inference failed.');
      } finally {
        frameBusy = false;
      }
    }

    void analyzeFrame();
    const timer = window.setInterval(() => void analyzeFrame(), 1500);
    return () => {
      cancelled = true;
      controller.abort();
      if (liveAbortRef.current === controller) liveAbortRef.current = null;
      window.clearInterval(timer);
    };
  }, [liveActive]);

  const statusVariant = modelStatus?.ready ? 'green' : modelStatus?.state === 'ERROR' ? 'red' : 'amber';
  const analysisUnavailable = statusLoading || !modelStatus?.ready;

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
                Server-side marine-debris analysis for uploaded images and live camera frames.
              </p>
              {statusError && <p role="alert" className="mt-2 text-xs text-[#ffb4ab]">{statusError}</p>}
              {(modelStatus?.error || modelStatus?.notice) && <p role="status" className="mt-2 text-xs text-[#ffaa00]">{modelStatus.error || modelStatus.notice}</p>}
              <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-[10px] text-[var(--ocean-text-muted)]">
                <div><dt className="inline">Engine </dt><dd className="inline font-mono text-[#d7fff3]">{modelStatus?.engine || 'Unavailable'}</dd></div>
                <div><dt className="inline">Precision </dt><dd className="inline font-mono text-[#d7fff3]">{formatMetric(modelStatus?.metrics?.iou50Precision)}</dd></div>
                <div><dt className="inline">Recall </dt><dd className="inline font-mono text-[#d7fff3]">{formatMetric(modelStatus?.metrics?.iou50Recall)}</dd></div>
                <div><dt className="inline">F1 </dt><dd className="inline font-mono text-[#d7fff3]">{formatMetric(modelStatus?.metrics?.iou50F1)}</dd></div>
              </dl>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded border border-[var(--ocean-border)] bg-[var(--ocean-surface)] px-3 py-2 text-[10px] text-[var(--ocean-text-muted)]">
              <span className="font-mono text-[#d7fff3]">{modelStatus?.learning?.framesReviewed ?? 0}</span> frames reviewed · <span className="font-mono text-[#d7fff3]">{modelStatus?.classes.length ?? 0}</span> classes
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
              <p className="mt-1 text-xs text-[var(--ocean-text-dim)]">JPG, PNG, or WebP · maximum 4 MB</p>
            </div>
            <Button variant="primary" size="sm" disabled={analysisUnavailable} icon={<ImageIcon className="h-4 w-4" />} onClick={() => fileRef.current?.click()}>Choose image</Button>
            {analysisUnavailable && !statusLoading && <p className="text-xs text-[#ffaa00]">Image analysis will be available when Espada reconnects.</p>}
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
              : <Button variant="primary" size="xs" disabled={cameraStarting || analysisUnavailable} icon={<Camera className="h-3.5 w-3.5" />} onClick={() => void startCamera()}>{cameraStarting ? 'Opening camera…' : 'Start camera'}</Button>}
          />
          <div className="relative flex min-h-52 items-center justify-center overflow-hidden rounded border border-[var(--ocean-border)] bg-[#080e1a]">
            <video ref={videoRef} muted playsInline className={`block h-auto w-full ${liveActive ? '' : 'invisible'}`} />
            {!liveActive && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center text-[var(--ocean-text-muted)]">
                <Camera className="h-7 w-7" />
                <span className="text-xs">Camera is stopped</span>
              </div>
            )}
          </div>
          <canvas ref={canvasRef} className="hidden" />
          {liveError && <p role="alert" className="mt-3 text-xs text-[#ffb4ab]">{liveError}</p>}
          {liveResult && liveFrameUrl && <div className="mt-4">
            <p className="mb-2 text-xs text-[var(--ocean-text-dim)]">Last analyzed frame · {liveResult.analysisId}</p>
            {liveActive ? (
              <div className="relative overflow-hidden rounded border border-[var(--ocean-border)]">
                <img src={liveFrameUrl} alt="Exact camera frame analyzed by Espada" className="block h-auto w-full" />
                <DetectionOverlay result={liveResult} />
              </div>
            ) : (
              <AnnotationEditor key={liveResult.analysisId} imageUrl={liveFrameUrl} result={liveResult} classes={modelStatus?.classes || []} />
            )}
          </div>}
          {liveResult && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-[var(--ocean-text-muted)]">
              <Badge variant="outline" size="xs">CAPTURED FRAME</Badge>
              <span>{liveResult.detections.length} objects</span><span>·</span>
              <span>{liveResult.latencyMs.toFixed(0)}ms inference</span><span>·</span>
              <span>{liveResult.model.name} {liveResult.model.version}</span>
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
              ) : item.state === 'ANALYZING' ? (
                <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">
                  <div className="relative w-fit max-w-full overflow-hidden rounded border border-[var(--ocean-border)] bg-[#080e1a]">
                    <img src={item.previewUrl} alt={`Analysis source ${item.name}`} className="block h-auto max-h-[34rem] max-w-full" />
                  </div>
                  <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded border border-[var(--ocean-border)] bg-[var(--ocean-surface)] text-[var(--ocean-text-dim)]">
                    <Loader2 className="h-6 w-6 animate-spin text-[#00f5d4]" />
                    <p className="text-xs">Espada is analyzing the image…</p>
                  </div>
                </div>
              ) : item.result ? (
                <div className="space-y-4">
                  <AnnotationEditor key={item.result.analysisId} imageUrl={item.previewUrl} result={item.result} classes={modelStatus?.classes || []} />
                  <ResultSummary result={item.result} />
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
