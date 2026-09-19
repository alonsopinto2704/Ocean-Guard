import type { ComponentType } from 'react';
import { Activity, AlertCircle, FlaskConical, Upload } from 'lucide-react';
import { cn } from '../../lib/utils';

export type DataProvenanceStatus = 'LIVE' | 'SAMPLE' | 'USER PROVIDED' | 'UNAVAILABLE';

export interface DataProvenanceBadgeProps {
  status: DataProvenanceStatus;
  label?: string;
  lastVerified?: string | Date | null;
  className?: string;
  size?: '2xs' | 'xs' | 'sm';
  showIcon?: boolean;
}

const statusConfig: Record<
  DataProvenanceStatus,
  {
    bg: string;
    border: string;
    text: string;
    icon: ComponentType<{ className?: string }>;
    defaultLabel: string;
  }
> = {
  LIVE: {
    bg: 'bg-[#00f5d4]/15',
    border: 'border-[#00f5d4]/60',
    text: 'text-[#00f5d4]',
    icon: Activity,
    defaultLabel: 'LIVE',
  },
  SAMPLE: {
    bg: 'bg-[#ffaa00]/15',
    border: 'border-[#ffaa00]/50',
    text: 'text-[#ffaa00]',
    icon: FlaskConical,
    defaultLabel: 'SAMPLE DATA',
  },
  'USER PROVIDED': {
    bg: 'bg-[#a370f7]/15',
    border: 'border-[#a370f7]/50',
    text: 'text-[#d1b3ff]',
    icon: Upload,
    defaultLabel: 'USER PROVIDED',
  },
  UNAVAILABLE: {
    bg: 'bg-slate-800/80',
    border: 'border-slate-600/60',
    text: 'text-[#94a3b8]',
    icon: AlertCircle,
    defaultLabel: 'UNAVAILABLE',
  },
};

const sizeStyles = {
  '2xs': 'text-[9px] px-1 py-0.5 gap-1',
  xs: 'text-[10px] px-1.5 py-0.5 gap-1.5',
  sm: 'text-xs px-2 py-0.5 gap-1.5',
};

const iconSizes = {
  '2xs': 'h-2.5 w-2.5',
  xs: 'h-3 w-3',
  sm: 'h-3.5 w-3.5',
};

/** Status chip declaring data origin (LIVE / SAMPLE / USER PROVIDED / UNAVAILABLE)
 *  with an accessible description including last-verified time. */
export function DataProvenanceBadge({
  status,
  label,
  lastVerified,
  className,
  size = 'xs',
  showIcon = true,
}: DataProvenanceBadgeProps) {
  const cfg = statusConfig[status];
  const Icon = cfg.icon;
  const displayLabel = label || cfg.defaultLabel;

  const accessibleText = `Data provenance: ${displayLabel}${
    lastVerified ? `, verified ${new Date(lastVerified).toLocaleTimeString()}` : ''
  }`;

  return (
    <span
      role="status"
      aria-label={accessibleText}
      title={accessibleText}
      className={cn(
        'inline-flex items-center rounded border font-mono font-bold tracking-wider',
        cfg.bg,
        cfg.border,
        cfg.text,
        sizeStyles[size],
        className
      )}
    >
      {showIcon && (
        status === 'LIVE' ? (
          <span className="w-1.5 h-1.5 rounded-full bg-[#00f5d4] pulse-dot inline-block shadow-[0_0_6px_#00f5d4]" />
        ) : (
          <Icon className={iconSizes[size]} aria-hidden="true" />
        )
      )}
      <span>{displayLabel}</span>
    </span>
  );
}
