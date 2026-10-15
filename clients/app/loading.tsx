import { Logo } from '../components/brand';

// Shown while a page loads (e.g. home fetching the client record): app-style splash.
export default function Loading() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="flex min-h-screen flex-col items-center justify-center gap-6 bg-cream"
    >
      <Logo variant="icon" tone="colour" width={64} priority className="motion-safe:animate-pulse" />
      <span className="h-1 w-24 overflow-hidden rounded-full bg-sand">
        <span className="block h-full w-1/3 rounded-full bg-teal motion-safe:animate-[mfb-loading_1.1s_ease-in-out_infinite]" />
      </span>
    </div>
  );
}
