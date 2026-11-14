// Service worker: keeps the app shell available offline.
// Bump VERSION whenever you change the app files.
const VERSION = 'v2';
const CACHE = 'atomic-clock-' + VERSION;
const SHELL = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  './js/app.js', './js/store.js', './js/ui.js', './js/time.js', './js/clock.js',
  './js/tracker.js', './js/world.js', './js/weather.js', './js/currency.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('atomic-clock-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()));
});

// Same-origin files: serve from cache straight away, refresh the cache in the background.
// Other sites (time, weather, rates APIs) always go to the network; the app caches their data itself.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const key = req.mode === 'navigate' ? './index.html' : req;
  event.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(key, { ignoreSearch: true });
    const network = fetch(req).then((res) => {
      if (res && res.ok) cache.put(key, res.clone());
      return res;
    }).catch(() => null);
    if (cached) { event.waitUntil(network); return cached; }
    const res = await network;
    return res || new Response('Offline', { status: 503, statusText: 'Offline' });
  }));
});
