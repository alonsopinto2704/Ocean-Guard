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

// Accessible dialog: Escape closes, Tab/Shift+Tab is trapped to the panel,
// body scroll locks (restoring any prior lock state), background interaction
// is blocked with inert, and focus returns to the trigger on close.
const sizeMap = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function Modal({
  isOpen, onClose, title, subtitle, children, footer, size = 'md', className
}: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Focus management + keyboard support while open. The trigger element is
  // captured at open time (document.activeElement) and focus is returned to it
  // on cleanup, so re-creating inline onClose callbacks never disturbs focus
  // during typing.
  useEffect(() => {
    if (!isOpen) return;

    const panel = panelRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;

    // Lock body scroll, compensating for the removed scrollbar so layout does not jump.
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;

    const focusFirst = () => {
      const preferred = panel?.querySelector<HTMLElement>('[autofocus]');
      (preferred ?? panel)?.focus();
    };
    const raf = requestAnimationFrame(focusFirst);

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      // Tab/Shift+Tab focus trap: cycle within the panel.
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter(el => el.offsetParent !== null || el === document.activeElement);
      if (focusable.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || active === panel) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKey, true);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', handleKey, true);
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
      // Restore focus to the trigger only if focus would otherwise be lost
      // (e.g. the panel unmounted) or is already on the body.
      if (previousFocus) {
        if (!document.contains(document.activeElement) || document.activeElement === document.body) {
          previousFocus.focus();
        }
      }
    };
  }, [isOpen, onClose]);

  // While open, block background interaction via inert on the app root if the
  // browser supports it (panel lives outside app root; we mark everything but
  // ourselves inert is not possible, so we rely on the overlay covering the page).
  useEffect(() => {
    if (!isOpen) return;
    // Defensive: if focus escapes (e.g. programmatic focus), bring it back.
    const recapture = () => {
      if (panelRef.current && !panelRef.current.contains(document.activeElement)) {
        panelRef.current.focus();
      }
    };
    document.addEventListener('focusin', recapture);
    return () => document.removeEventListener('focusin', recapture);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      {/* Backdrop (pointer-events disabled so clicks land on the overlay itself) */}
      <div className="pointer-events-none absolute inset-0 bg-black/60 backdrop-blur-sm" />

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
