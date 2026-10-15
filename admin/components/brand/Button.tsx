import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { cn } from './cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'md' | 'sm';

interface ButtonStyleOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-coral-deep text-white hover:bg-coral-hover disabled:hover:bg-coral-deep',
  secondary:
    'bg-transparent text-teal shadow-[inset_0_0_0_2px_var(--color-teal)] hover:bg-mist disabled:hover:bg-transparent',
  ghost: 'bg-transparent text-teal hover:bg-mist disabled:hover:bg-transparent',
};

// Both sizes keep a 44px+ touch target.
const SIZE_CLASSES: Record<ButtonSize, string> = {
  md: 'min-h-[48px] px-6 text-[16px]',
  sm: 'min-h-[44px] px-4 text-[14px]',
};

export function buttonClasses({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className,
}: ButtonStyleOptions = {}): string {
  return cn(
    'inline-flex items-center justify-center gap-2 rounded-full font-heading font-semibold leading-none',
    'transition-[background-color,box-shadow,transform] duration-150 select-none',
    'active:scale-[0.98] disabled:active:scale-100 motion-reduce:active:scale-100',
    'disabled:cursor-not-allowed disabled:opacity-60',
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    fullWidth && 'w-full',
    className
  );
}

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    Omit<ButtonStyleOptions, 'className'> {
  loading?: boolean;
  loadingText?: React.ReactNode;
}

export function Button({
  variant,
  size,
  fullWidth,
  loading = false,
  loadingText,
  disabled,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses({ variant, size, fullWidth, className })}
      {...rest}
    >
      {loading ? (
        <>
          <Loader2 size={18} strokeWidth={2} className="animate-spin" aria-hidden />
          <span>{loadingText ?? children}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}

type ButtonLinkProps = Omit<React.ComponentProps<typeof Link>, 'className'> & ButtonStyleOptions;

export function ButtonLink({ variant, size, fullWidth, className, ...rest }: ButtonLinkProps) {
  return <Link className={buttonClasses({ variant, size, fullWidth, className })} {...rest} />;
}
