// My Fit Brain service worker.
// Privacy: never caches pages or API responses (they hold client data). It only keeps
// a static offline screen, shown when a page navigation fails because there is no network.
const CACHE = 'mfb-offline-v1';
const OFFLINE_URL = '/offline.html';
const PRECACHE = [OFFLINE_URL, '/brand/logo/MFB_Icon_FullColour.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(OFFLINE_URL).then((response) => response || Response.error())
      )
    );
    return;
  }

  // The offline screen's own logo.
  if (new URL(request.url).pathname === '/brand/logo/MFB_Icon_FullColour.svg') {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
  }
});
