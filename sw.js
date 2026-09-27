/* Compass service worker — offline app shell.
   BUMP `CACHE` whenever index.html's ?v= changes. The activate handler deletes
   every cache that isn't the current one, so bumping it is what actually forces
   an installed home-screen app off a stale shell. */
const CACHE = 'compass-v34';
const ASSETS = [
  './', './index.html', './styles.css', './app.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/favicon-32.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // never cache API (prices / sync) or cross-origin (weather)
  if (url.pathname.startsWith('/api/') || url.origin !== location.origin) return;
  // app shell: network-first (so redeploys show fresh), fall back to cache offline
  e.respondWith(
    fetch(e.request).then(res => {
      if (res && res.status === 200) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then(c => c || caches.match('./index.html')))
  );
});
