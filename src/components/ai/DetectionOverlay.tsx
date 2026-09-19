import type { AIInferenceResult } from '../../types';

interface DetectionOverlayProps {
  result: AIInferenceResult | null;
}

// Bounding-box stroke color per risk tier, drawn over analyzed imagery.
const RISK_COLOR: Record<string, string> = {
  LOW: '#4cd6fb',
  MEDIUM: '#ffaa00',
  HIGH: '#ff8c42',
  CRITICAL: '#ff5964',
};

/** Renders normalized bounding boxes + labels for every Espada detection.
 *  Positioned absolutely over the image at the same aspect ratio. */
export function DetectionOverlay({ result }: DetectionOverlayProps) {
  if (!result) return null;

  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
      {result.detections.map((detection) => {
        const color = RISK_COLOR[detection.riskLevel] || '#00f5d4';
        const { x, y, width, height } = detection.boundingBox;
        return (
          <div
            key={detection.id}
            className="absolute border-2 rounded-sm shadow-[0_0_12px_rgba(0,0,0,0.45)]"
            style={{
              left: `${x * 100}%`,
              top: `${y * 100}%`,
              width: `${width * 100}%`,
              height: `${height * 100}%`,
              borderColor: color,
            }}
          >
            <span
              className="absolute -top-6 left-[-2px] whitespace-nowrap rounded-sm px-1.5 py-0.5 text-[10px] font-bold text-[#080e1a]"
              style={{ backgroundColor: color }}
            >
              {detection.className} {detection.confidence.toFixed(1)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Labeled progress bar for a confidence value; wording changes when the score
 *  is calibrated vs. raw or anomaly-based. */
export function ConfidenceMeter({ value, calibrated, method }: { value: number; calibrated: boolean; method?: string }) {
  const color = value >= 80 ? '#00f5d4' : value >= 55 ? '#ffaa00' : '#ff8c42';
  const label = calibrated
    ? 'Calibrated confidence'
    : method === 'visual_anomaly_score'
    ? 'Visual anomaly score'
    : 'Raw model score';
  return (
    <div aria-label={`${label}: ${value.toFixed(1)} percent`}>
      <div className="mb-1 flex items-center justify-between gap-3 text-[10px] text-[var(--ocean-text-muted)]">
        <span>{label}</span>
        <span className="font-mono font-bold" style={{ color }}>{value.toFixed(1)}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[#2f3542]">
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${value}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}
