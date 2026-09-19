import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from './Button';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

// Accessible dialog: Escape closes, body scroll locks, focus is trapped to the
// panel and restored to the trigger on close, with optional size presets.
const sizeMap = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

export function Modal({
  isOpen, onClose, title, subtitle, children, footer, size = 'md', className
}: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Focus management + Escape-to-close while open. The closed-state branch keeps
  // body-scroll restore symmetrical (the old code duplicated the same cleanup).
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      const previousFocus = document.activeElement as HTMLElement | null;
      document.addEventListener('keydown', handleKey);
      document.body.style.overflow = 'hidden';
      requestAnimationFrame(() => {
        const preferred = panelRef.current?.querySelector<HTMLElement>('[autofocus]');
        (preferred ?? panelRef.current)?.focus();
      });

      return () => {
        document.removeEventListener('keydown', handleKey);
        document.body.style.overflow = '';
        previousFocus?.focus();
      };
    }
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={cn(
          'relative w-full max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl border outline-none',
          'bg-[var(--ocean-card)] border-[var(--ocean-border)]',
          'shadow-2xl shadow-black/50',
          sizeMap[size],
          className
        )}
      >
        {/* Header */}
        {(title || subtitle) && (
          <div className="flex items-start justify-between p-5 border-b border-[var(--ocean-border)]">
            <div>
              {title && (
                <h2 id={titleId} className="text-base font-semibold text-[var(--ocean-text)]">{title}</h2>
              )}
              {subtitle && (
                <p className="text-sm text-[var(--ocean-text-dim)] mt-0.5">{subtitle}</p>
              )}
            </div>
            <Button variant="ghost" size="xs" onClick={onClose} aria-label="Close dialog" className="ml-2 -mr-1">
              <X className="w-4 h-4" />
            </Button>
          </div>
        )}

        {/* Body */}
        <div className="p-5">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="flex justify-end gap-2 px-5 pb-5">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
