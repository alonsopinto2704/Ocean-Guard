import type { RiskLevel, AlertPriority, DetectionStatus, CleanupStatus, CameraStatus, DeviceStatus } from '../types';

// ─── Risk Level helpers ──────────────────────────────────────────────────────
export function getRiskColor(level: RiskLevel | number): string {
  const l = typeof level === 'number'
    ? level >= 80 ? 'CRITICAL' : level >= 60 ? 'HIGH' : level >= 30 ? 'MEDIUM' : 'LOW'
    : level;
  switch (l) {
    case 'CRITICAL': return 'text-red-400';
    case 'HIGH':     return 'text-orange-400';
    case 'MEDIUM':   return 'text-amber-400';
    case 'LOW':      return 'text-green-400';
    default:         return 'text-slate-400';
  }
}

export function getRiskBg(level: RiskLevel | number): string {
  const l = typeof level === 'number'
    ? level >= 80 ? 'CRITICAL' : level >= 60 ? 'HIGH' : level >= 30 ? 'MEDIUM' : 'LOW'
    : level;
  switch (l) {
    case 'CRITICAL': return 'bg-red-500/10 border-red-500/30 text-red-400';
    case 'HIGH':     return 'bg-orange-500/10 border-orange-500/30 text-orange-400';
    case 'MEDIUM':   return 'bg-amber-500/10 border-amber-500/30 text-amber-400';
    case 'LOW':      return 'bg-green-500/10 border-green-500/30 text-green-400';
    default:         return 'bg-slate-500/10 border-slate-500/30 text-slate-400';
  }
}

export function scoreToRiskLevel(score: number): RiskLevel {
  if (score >= 80) return 'CRITICAL';
  if (score >= 60) return 'HIGH';
  if (score >= 30) return 'MEDIUM';
  return 'LOW';
}

// ─── Confidence helpers ──────────────────────────────────────────────────────
export function getConfidenceLabel(confidence: number): string {
  if (confidence >= 90) return 'HIGH';
  if (confidence >= 70) return 'MEDIUM';
  if (confidence >= 50) return 'LOW';
  return 'UNCERTAIN';
}

export function getConfidenceColor(confidence: number): string {
  if (confidence >= 90) return 'text-green-400';
  if (confidence >= 70) return 'text-amber-400';
  if (confidence >= 50) return 'text-orange-400';
  return 'text-red-400';
}

export function getConfidenceBg(confidence: number): string {
  if (confidence >= 90) return 'bg-green-500/10 border-green-500/30 text-green-400';
  if (confidence >= 70) return 'bg-amber-500/10 border-amber-500/30 text-amber-400';
  if (confidence >= 50) return 'bg-orange-500/10 border-orange-500/30 text-orange-400';
  return 'bg-red-500/10 border-red-500/30 text-red-400';
}

// ─── Detection Status helpers ─────────────────────────────────────────────────
export function getDetectionStatusColor(status: DetectionStatus): string {
  switch (status) {
    case 'NEW':           return 'bg-blue-500/10 border-blue-500/30 text-blue-400';
    case 'VALIDATING':    return 'bg-purple-500/10 border-purple-500/30 text-purple-400';
    case 'CONFIRMED':     return 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400';
    case 'TRACKING':      return 'bg-green-500/10 border-green-500/30 text-green-400';
    case 'LOST':          return 'bg-amber-500/10 border-amber-500/30 text-amber-400';
    case 'FALSE_POSITIVE':return 'bg-slate-500/10 border-slate-500/30 text-slate-400';
    case 'EXPIRED':       return 'bg-slate-500/10 border-slate-500/30 text-slate-500';
    default:              return 'bg-slate-500/10 border-slate-500/30 text-slate-400';
  }
}

// ─── Camera status helpers ────────────────────────────────────────────────────
export function getCameraStatusColor(status: CameraStatus): string {
  switch (status) {
    case 'STREAMING': return 'text-green-400';
    case 'ONLINE':    return 'text-cyan-400';
    case 'CONNECTING':return 'text-amber-400';
    case 'LOW_FPS':   return 'text-orange-400';
    case 'NO_SIGNAL': return 'text-red-400';
    case 'DISCONNECTED': return 'text-red-500';
    case 'ERROR':     return 'text-red-600';
    default:          return 'text-slate-400';
  }
}

// ─── Cleanup status helpers ───────────────────────────────────────────────────
export function getCleanupStatusColor(status: CleanupStatus): string {
  switch (status) {
    case 'DRAFT':       return 'bg-slate-500/10 border-slate-500/30 text-slate-400';
    case 'SCHEDULED':   return 'bg-blue-500/10 border-blue-500/30 text-blue-400';
    case 'ASSIGNED':    return 'bg-purple-500/10 border-purple-500/30 text-purple-400';
    case 'IN_PROGRESS': return 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400';
    case 'PAUSED':      return 'bg-amber-500/10 border-amber-500/30 text-amber-400';
    case 'COMPLETED':   return 'bg-green-500/10 border-green-500/30 text-green-400';
    case 'CANCELLED':   return 'bg-red-500/10 border-red-500/30 text-red-400';
    default:            return 'bg-slate-500/10 border-slate-500/30 text-slate-400';
  }
}

// ─── Device status helpers ────────────────────────────────────────────────────
export function getDeviceStatusColor(status: DeviceStatus): string {
  switch (status) {
    case 'ONLINE':      return 'text-green-400';
    case 'STANDBY':     return 'text-cyan-400';
    case 'MAINTENANCE': return 'text-amber-400';
    case 'ERROR':       return 'text-red-400';
    case 'OFFLINE':     return 'text-slate-500';
    default:            return 'text-slate-400';
  }
}

// ─── Alert priority helpers ──────────────────────────────────────────────────
export function getAlertPriorityColor(priority: AlertPriority): string {
  switch (priority) {
    case 'CRITICAL': return 'bg-red-500/15 border-red-500/40 text-red-400';
    case 'HIGH':     return 'bg-orange-500/15 border-orange-500/40 text-orange-400';
    case 'MEDIUM':   return 'bg-amber-500/15 border-amber-500/40 text-amber-400';
    case 'LOW':      return 'bg-blue-500/15 border-blue-500/40 text-blue-400';
    default:         return 'bg-slate-500/15 border-slate-500/40 text-slate-400';
  }
}

// ─── Category colors ─────────────────────────────────────────────────────────
export const CATEGORY_COLORS: Record<string, string> = {
  'Plastic':       '#00d4ff',
  'Fishing Gear':  '#ffaa00',
  'Metal/Glass':   '#aa55ff',
  'Organic':       '#00ff88',
  'Unknown':       '#6a9ab8',
};

// ─── Date/time utilities ─────────────────────────────────────────────────────
export function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${diffDay}d ago`;
}

export function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('en-US', {
    month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit'
  });
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: '2-digit'
  });
}

// ─── Number formatters ───────────────────────────────────────────────────────
export function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

// ─── Class utilities ─────────────────────────────────────────────────────────
export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ');
}
