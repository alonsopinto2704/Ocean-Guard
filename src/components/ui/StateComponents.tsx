import React from 'react';
import { AlertTriangle, Loader2, LockKeyhole, WifiOff } from 'lucide-react';
import { cn } from '../../lib/utils';

export function LoadingState({
  message = 'Loading...',
  className,
  size = 'md',
}: {
  message?: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const sizeMap = { sm: 'h-32', md: 'h-64', lg: 'h-96' };
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3', sizeMap[size], className)}>
      <Loader2 className="w-8 h-8 text-cyan-500 animate-spin" />
      <p className="text-sm text-[var(--ocean-text-dim)] font-mono">{message}</p>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 gap-4 text-center px-4', className)}>
      {icon && (
        <div className="w-16 h-16 rounded-full bg-[var(--ocean-surface)] border border-[var(--ocean-border)] flex items-center justify-center text-[var(--ocean-text-muted)]">
          {icon}
        </div>
      )}
      <div>
        <h3 className="text-sm font-semibold text-[var(--ocean-text-dim)]">{title}</h3>
        {description && (
          <p className="text-xs text-[var(--ocean-text-muted)] mt-1 max-w-xs mx-auto">{description}</p>
        )}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

export function ErrorState({
  message = 'Something went wrong',
  onRetry,
  className,
}: {
  message?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 gap-4 text-center px-4', className)}>
      <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-400">
        <AlertTriangle className="h-7 w-7" aria-hidden="true" />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-red-400">System Error</h3>
        <p className="text-xs text-[var(--ocean-text-dim)] mt-1 max-w-xs mx-auto">{message}</p>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="min-h-11 rounded px-3 text-xs text-cyan-400 hover:text-cyan-300 underline underline-offset-2 md:min-h-9"
        >
          Retry
        </button>
      )}
    </div>
  );
}

export function OfflineState({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 gap-4 text-center', className)}>
      <div className="w-16 h-16 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
        <WifiOff className="h-7 w-7" aria-hidden="true" />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-amber-400">Connection Lost</h3>
        <p className="text-xs text-[var(--ocean-text-dim)] mt-1">
          Operating in offline mode. Data may be stale.
        </p>
      </div>
    </div>
  );
}

export function PermissionDenied({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 gap-4 text-center', className)}>
      <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-400">
        <LockKeyhole className="h-7 w-7" aria-hidden="true" />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-red-400">Access Restricted</h3>
        <p className="text-xs text-[var(--ocean-text-dim)] mt-1">
          You don't have permission to view this section.
        </p>
      </div>
    </div>
  );
}
