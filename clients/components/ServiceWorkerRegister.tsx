'use client';

import { useEffect } from 'react';

// Registers /sw.js in production only (dev uses hot reload and should not be cached).
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {
      // Registration failure only means no offline screen; the app still works.
    });
  }, []);

  return null;
}
