import { cn } from './brand';

// Grey placeholder shapes shown while a page's data loads. The header and tab bar stay on screen.
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cn('block rounded-input bg-sand/70 motion-safe:animate-pulse', className)} />;
}

/** A white card holding a few skeleton lines (same border, radius and shadow as Card). */
export function SkeletonCard({ lines = 2, className }: { lines?: number; className?: string }) {
  return (
    <div aria-hidden className={cn('rounded-card border border-sand bg-white p-5 shadow-card', className)}>
      <Skeleton className="h-5 w-2/3" />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn('mt-3 h-4', i === lines - 1 ? 'w-1/2' : 'w-full')} />
      ))}
    </div>
  );
}

/** Screen-reader announcement for a loading page. */
export function LoadingStatus() {
  return (
    <span role="status" className="sr-only">
      Loading
    </span>
  );
}
