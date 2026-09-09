import React from 'react';
import { cn } from '../../lib/utils';
import { Loader2 } from 'lucide-react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'outline';
type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
  fullWidth?: boolean;
  children?: React.ReactNode;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:   'bg-gradient-to-r from-[#00f5d4] to-[#4cd6fb] text-[#00201a] font-bold border-transparent shadow-[0_0_20px_rgba(0,245,212,0.35)] hover:shadow-[0_0_30px_rgba(0,245,212,0.6)] hover:brightness-110 active:scale-[0.99]',
  secondary: 'bg-[#1a202c] hover:bg-[#242a36] text-[#dde2f3] border-[#3a4a46]/70 hover:border-[#00f5d4]/50 hover:text-[#d7fff3] shadow-sm',
  ghost:     'bg-transparent hover:bg-white/5 text-[#b9cac4] hover:text-[#d7fff3] border-transparent',
  danger:    'bg-[#93000a]/20 hover:bg-[#93000a]/40 text-[#ffb4ab] border-[#ff5964]/40 hover:border-[#ff5964] shadow-[0_0_15px_rgba(255,89,100,0.2)]',
  success:   'bg-[#00f5d4]/10 hover:bg-[#00f5d4]/20 text-[#00f5d4] border-[#00f5d4]/40 hover:border-[#00f5d4] shadow-[0_0_15px_rgba(0,245,212,0.2)]',
  outline:   'bg-transparent border-[#3a4a46] text-[#b9cac4] hover:border-[#00f5d4]/60 hover:text-[#00f5d4] hover:shadow-[0_0_15px_rgba(0,245,212,0.15)]',
};

const sizeStyles: Record<ButtonSize, string> = {
  xs: 'px-2 py-1 text-xs gap-1 font-mono tracking-wide',
  sm: 'px-3 py-1.5 text-xs gap-1.5 font-mono tracking-wide',
  md: 'px-4 py-2 text-sm gap-2 tracking-wide font-medium',
  lg: 'px-5 py-2.5 text-sm gap-2.5 tracking-wider font-semibold',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  icon,
  iconRight,
  fullWidth,
  children,
  className,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center rounded border cursor-pointer',
        'min-h-11 md:min-h-9 transition-all duration-200 select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4cd6fb] focus-visible:ring-offset-2 focus-visible:ring-offset-[#080e1a]',
        'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:shadow-none',
        variantStyles[variant],
        sizeStyles[size],
        fullWidth && 'w-full',
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading
        ? <Loader2 className="w-4 h-4 animate-spin" />
        : icon && <span className="flex-shrink-0 flex items-center">{icon}</span>
      }
      {children && <span>{children}</span>}
      {iconRight && !loading && <span className="flex-shrink-0 flex items-center">{iconRight}</span>}
    </button>
  );
}
