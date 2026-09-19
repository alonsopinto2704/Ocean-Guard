import type { HTMLAttributes, ReactNode } from 'react';
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '../../lib/utils';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  onClick?: () => void;
  noPad?: boolean;
}

/** Surface container. When clickable, becomes a keyboard-accessible button
 *  (Enter/Space activate) with hover styling. */
export function Card({ children, className, hover, onClick, noPad, onKeyDown, role, tabIndex, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded border transition-all duration-200',
        'bg-[#1a202c]/85 backdrop-blur-md border-[#3a4a46]/45 shadow-md',
        !noPad && 'p-4',
        hover && 'card-hover cursor-pointer hover:border-[#00f5d4]/50 hover:shadow-[0_0_20px_rgba(0,245,212,0.12)]',
        onClick && 'cursor-pointer',
        className
      )}
      onClick={onClick}
      role={onClick ? (role ?? 'button') : role}
      tabIndex={onClick ? (tabIndex ?? 0) : tabIndex}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (!event.defaultPrevented && onClick && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onClick();
        }
      }}
      {...props}
    >
      {children}
    </div>
  );
}

interface CardHeaderProps {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** Standard card header row: icon chip, title, optional subtitle, right-side action. */
export function CardHeader({ title, subtitle, icon, action, className }: CardHeaderProps) {
  return (
    <div className={cn('flex items-center justify-between mb-4', className)}>
      <div className="flex items-center gap-2.5">
        {icon && (
          <div className="text-[#00f5d4] p-1.5 rounded bg-[#00f5d4]/10 border border-[#00f5d4]/20 flex items-center justify-center">
            {icon}
          </div>
        )}
        <div>
          <h3 className="font-headline-sm text-sm font-bold text-[#dde2f3] tracking-wide uppercase">
            {title}
          </h3>
          {subtitle && (
            <p className="font-telemetry-tag text-[10px] text-[#b9cac4]/80 tracking-wider mt-0.5 uppercase">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string | number;
  subvalue?: string;
  icon?: ReactNode;
  color?: string;
  trend?: 'up' | 'down' | 'stable';
  trendValue?: string;
  onClick?: () => void;
  className?: string;
}

/** KPI tile: colored laser accent, big value, optional trend chip and icon.
 *  NOTE: the mini progress bar at the bottom is a fixed-width decoration (84%),
 *  not driven by data. */
export function StatCard({
  label, value, subvalue, icon, color = '#00f5d4',
  trend, trendValue, onClick, className
}: StatCardProps) {
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;

  return (
    <Card
      className={cn('relative overflow-hidden group bg-[#161c28]/90 border-[#3a4a46]/40', className)}
      onClick={onClick}
      hover={!!onClick}
    >
      {/* Top Laser Accent */}
      <div
        className="absolute top-0 left-0 right-0 h-[2px] opacity-80 shadow-[0_0_8px_currentColor]"
        style={{
          background: `linear-gradient(90deg, transparent, ${color}, transparent)`,
          color,
        }}
      />

      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="font-telemetry-tag text-[10px] uppercase tracking-wider text-[#b9cac4] mb-2 font-bold">
            {label}
          </p>
          <p
            className="font-data-mono-xl text-2xl md:text-3xl font-bold leading-none tracking-tight"
            style={{ color }}
          >
            {value}
          </p>
          {subvalue && (
            <p className="font-telemetry-tag text-[10px] text-[#83948f] mt-1.5 tracking-wide">{subvalue}</p>
          )}
          {trend && trendValue && (
            <div className="flex items-center gap-1 mt-2">
              <span className={cn(
                'inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border',
                trend === 'up' && 'text-[#ffb4ab] border-[#ff5964]/40 bg-[#93000a]/20',
                trend === 'down' && 'text-[#00f5d4] border-[#00f5d4]/40 bg-[#00f5d4]/10',
                trend === 'stable' && 'text-[#83948f] border-[#3a4a46] bg-[#1a202c]',
              )}>
                <TrendIcon className="h-3 w-3" aria-hidden="true" /> {trendValue}
              </span>
            </div>
          )}
        </div>
        {icon && (
          <div
            className="p-2 rounded border border-white/5 flex-shrink-0"
            style={{ background: `${color}15`, color }}
          >
            {icon}
          </div>
        )}
      </div>

      {/* Mini Progress Track */}
      <div className="w-full bg-[#2f3542]/60 h-1 rounded-full mt-3 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: '84%', backgroundColor: color }}
        />
      </div>
    </Card>
  );
}
