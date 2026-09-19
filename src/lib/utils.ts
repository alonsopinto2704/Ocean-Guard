import type { RiskLevel, DetectionStatus, CleanupStatus, CameraStatus, DeviceStatus } from '../types';

// ─── Risk Level helpers ──────────────────────────────────────────────────────
// Maps a numeric risk score (0-100) onto the discrete RiskLevel buckets.
// Single source of truth for the thresholds (80/60/30) used everywhere below.
export function scoreToRiskLevel(score: number): RiskLevel {
  if (score >= 80) return 'CRITICAL';
  if (score >= 60) return 'HIGH';
  if (score >= 30) return 'MEDIUM';
  return 'LOW';
}

/** Normalize input that may already be a RiskLevel or a raw 0-100 score. */
function toRiskLevel(level: RiskLevel | number): RiskLevel {
  return typeof level === 'number' ? scoreToRiskLevel(level) : level;
}

/** Text color class for a risk level (or numeric score). */
export function getRiskColor(level: RiskLevel | number): string {
  switch (toRiskLevel(level)) {
    case 'CRITICAL': return 'text-red-400';
    case 'HIGH':     return 'text-orange-400';
    case 'MEDIUM':   return 'text-amber-400';
    case 'LOW':      return 'text-green-400';
    default:         return 'text-slate-400';
  }
}

/** Bordered pill (bg + border + text) classes for a risk level (or numeric score). */
export function getRiskBg(level: RiskLevel | number): string {
  switch (toRiskLevel(level)) {
    case 'CRITICAL': return 'bg-red-500/10 border-red-500/30 text-red-400';
    case 'HIGH':     return 'bg-orange-500/10 border-orange-500/30 text-orange-400';
    case 'MEDIUM':   return 'bg-amber-500/10 border-amber-500/30 text-amber-400';
    case 'LOW':      return 'bg-green-500/10 border-green-500/30 text-green-400';
    default:         return 'bg-slate-500/10 border-slate-500/30 text-slate-400';
  }
}

// ─── Detection Status helpers ─────────────────────────────────────────────────
/** Bordered pill classes for each detection lifecycle status. */
export function getDetectionStatusColor(status: DetectionStatus): string {
  switch (status) {
    case 'NEW':            return 'bg-blue-500/10 border-blue-500/30 text-blue-400';
    case 'VALIDATING':     return 'bg-purple-500/10 border-purple-500/30 text-purple-400';
    case 'CONFIRMED':      return 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400';
    case 'TRACKING':       return 'bg-green-500/10 border-green-500/30 text-green-400';
    case 'LOST':           return 'bg-amber-500/10 border-amber-500/30 text-amber-400';
    case 'FALSE_POSITIVE': return 'bg-slate-500/10 border-slate-500/30 text-slate-400';
    case 'EXPIRED':        return 'bg-slate-500/10 border-slate-500/30 text-slate-500';
    default:               return 'bg-slate-500/10 border-slate-500/30 text-slate-400';
  }
}

// ─── Camera status helpers ────────────────────────────────────────────────────
/** Text color class for each camera connectivity state. */
export function getCameraStatusColor(status: CameraStatus): string {
  switch (status) {
    case 'STREAMING':    return 'text-green-400';
    case 'ONLINE':       return 'text-cyan-400';
    case 'CONNECTING':   return 'text-amber-400';
    case 'LOW_FPS':      return 'text-orange-400';
    case 'NO_SIGNAL':    return 'text-red-400';
    case 'DISCONNECTED': return 'text-red-500';
    case 'ERROR':        return 'text-red-600';
    default:             return 'text-slate-400';
  }
}

// ─── Cleanup status helpers ───────────────────────────────────────────────────
/** Bordered pill classes for each cleanup mission lifecycle status. */
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
/** Text color class for each fleet device state. */
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

// ─── Date/time utilities ─────────────────────────────────────────────────────
/** Human-readable "time ago" string. Handles future timestamps (clock skew) by clamping to "just now". */
export function formatRelativeTime(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  // BUGFIX: a future timestamp (negative diff) previously rendered as "-5s ago".
  if (diffMs < 0) return 'just now';

  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr  = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24)  return `${diffHr}h ago`;
  return `${diffDay}d ago`;
}

/** Locale timestamp like "Sep 19, 14:32" for tables and HUD lines. */
export function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('en-US', {
    month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit'
  });
}

/** Locale date only, e.g. "Sep 19, 2026", for report listings. */
export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: '2-digit'
  });
}

// ─── Byte formatter ──────────────────────────────────────────────────────────
/** Formats a byte count as B / KB / MB / GB with one decimal for the larger units. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024)        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024)               return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

// ─── Class utility ───────────────────────────────────────────────────────────
/** Joins conditional class names, skipping falsy values (tiny clsx replacement). */
export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ');
}
