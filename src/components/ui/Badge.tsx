import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

type BadgeVariant =
  | 'default' | 'cyan' | 'green' | 'amber' | 'red' | 'purple'
  | 'outline-cyan' | 'live' | 'admin' | 'count' | 'fraction' | 'outline' | 'telemetry';

interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
  size?: '2xs' | 'xs' | 'sm' | 'md';
}

const variantStyles: Record<BadgeVariant, string> = {
  default:       'bg-[#1a202c] border-[#3a4a46]/60 text-[#b9cac4]',
  cyan:          'bg-[#00f5d4]/10 border-[#00f5d4]/40 text-[#00f5d4] shadow-[0_0_10px_rgba(0,245,212,0.15)]',
  green:         'bg-[#00f5d4]/15 border-[#00f5d4]/50 text-[#d7fff3]',
  amber:         'bg-[#ffaa00]/15 border-[#ffaa00]/40 text-[#ffaa00]',
  red:           'bg-[#93000a]/30 border-[#ff5964]/50 text-[#ffb4ab] shadow-[0_0_10px_rgba(255,89,100,0.2)]',
  purple:        'bg-[#a370f7]/15 border-[#a370f7]/40 text-[#d1b3ff]',
  'outline-cyan':'border-[#00f5d4]/60 text-[#00f5d4] bg-[#00f5d4]/5 shadow-[0_0_8px_rgba(0,245,212,0.15)]',
  live:          'bg-[#00f5d4]/15 border-[#00f5d4]/60 text-[#00f5d4] font-bold shadow-[0_0_10px_rgba(0,245,212,0.25)]',
  admin:         'bg-[#242a36] border-[#3a4a46] text-[#b9cac4]',
  count:         'bg-[#080e1a] border-[#3a4a46] text-[#4cd6fb] font-mono',
  fraction:      'bg-[#080e1a] border-[#3a4a46] text-[#b9cac4] font-mono',
  outline:       'border-[#3a4a46] text-[#b9cac4] bg-transparent',
  telemetry:     'bg-[#161c28]/90 border-[#3a4a46]/80 text-[#00f5d4] uppercase tracking-widest font-bold',
};

const sizeStyles = {
  '2xs': 'text-[9px] px-1 py-0.5 font-mono leading-none',
  xs:    'text-[10px] px-1.5 py-0.5 font-mono leading-none',
  sm:    'text-xs px-2 py-0.5 font-mono leading-tight',
  md:    'text-sm px-2.5 py-1 font-mono leading-tight',
};

/** Generic pill/label with variant + size presets. */
export function Badge({ variant = 'default', children, className, size = 'sm' }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded border font-mono tracking-wider',
        variantStyles[variant],
        sizeStyles[size],
        className
      )}
    >
      {children}
    </span>
  );
}

// Preset badges used in sidebar & headers (LIVE pulse, ADMIN tag, counts, 3D).
export function LiveBadge() {
  return (
    <Badge variant="live" size="xs">
      <span className="w-1.5 h-1.5 rounded-full bg-[#00f5d4] mr-1.5 pulse-dot inline-block shadow-[0_0_6px_#00f5d4]" />
      LIVE
    </Badge>
  );
}

export function AdminBadge() {
  return <Badge variant="admin" size="xs">ADMIN</Badge>;
}

export function CountBadge({ count }: { count: number | string }) {
  return <Badge variant="count" size="xs">{count}</Badge>;
}

export function ThreeDBadge() {
  return <Badge variant="outline-cyan" size="xs">3D</Badge>;
}

export { DataProvenanceBadge, type DataProvenanceStatus } from './DataProvenanceBadge';
