import { Logo } from './brand';

// App-style splash for screens without the app shell (login, registration).
export function SplashLoader() {
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
