/* Sawaari service worker — offline shell + network-first API.
 *
 * Strategy
 *   • navigations → network first, falling back to the cached shell when
 *     the device is offline (no blank screen);
 *   • hashed build assets (/assets/…) → network first with a cache
 *     fallback. They are immutable, so the only reason to serve a stale
 *     copy is being offline — and serving a stale bundle after a deploy
 *     is how a fixed API address keeps looking broken;
 *   • /api/* → network-only (never cache rides, payments or locations);
 *   • map tiles → stale-while-revalidate so a patchy connection still shows
 *     a map;
 *   • the rest of the shell → cache-first with a background refresh.
 */
const VERSION = 'sawaari-v2';
const SHELL_CACHE = `${VERSION}-shell`;
const TILE_CACHE = `${VERSION}-tiles`;
const RUNTIME_CACHE = `${VERSION}-runtime`;

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS).catch(() => undefined))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  // Supabase (api, realtime and storage) is always network-only
  if (url.hostname.endsWith('.supabase.co')) return;

  // API + socket traffic must never be served from a cache
  if (sameOrigin && (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io'))) {
    event.respondWith(fetch(request).catch(() => new Response(
      JSON.stringify({ error: 'You are offline. Reconnect to continue.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    )));
    return;
  }

  // map tiles: stale-while-revalidate
  if (/basemaps\.cartocdn\.com|tile\.openstreetmap\.org|a\.basemaps/.test(url.host)) {
    event.respondWith(
      caches.open(TILE_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request).then((res) => {
          if (res && res.ok) cache.put(request, res.clone());
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // navigations: network first, cached shell as the offline fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put('/index.html', copy));
          return res;
        })
        .catch(() => caches.match('/index.html').then((r) => r || caches.match('/')))
    );
    return;
  }

  // hashed build assets: always try the network first so a new deploy is
  // picked up immediately, fall back to the cache when offline
  if (sameOrigin && url.pathname.startsWith('/assets/')) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(RUNTIME_CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // static assets: cache first, refresh in the background
  if (sameOrigin) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request).then((res) => {
          if (res && res.ok && res.type === 'basic') cache.put(request, res.clone());
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    );
  }
});

// lets the page tell the SW to skip waiting (used by the "update" button)
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
