import { cn } from './cn';

/** The single coral dot above a headline. Use at most one per screen. */
export function BinduDot({ className }: { className?: string }) {
  return <span aria-hidden className={cn('block h-2.5 w-2.5 rounded-full bg-coral', className)} />;
}
