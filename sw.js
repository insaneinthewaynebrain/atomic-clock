// Service worker: keeps the app working offline.
// Online: always fetch the latest files from the network (so updates show straight away).
// Offline: use the copies saved here.
const VERSION = 'v69';
const CACHE = 'atomic-clock-' + VERSION;
const SHELL = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  './js/app.js', './js/store.js', './js/ui.js', './js/time.js', './js/clock.js',
  './js/tracker.js', './js/world.js', './js/weather.js', './js/currency.js',
  './js/config.js', './js/accuracy.js', './js/photos.js', './js/collection.js', './js/backup.js', './js/tools.js',
  './js/wrist.js', './js/sharecard.js', './js/setting.js', './js/insurance.js', './js/timegrapher.js', './js/tick-worklet.js', './js/countdown.js', './js/alarm.js', './js/ring.js', './js/music.js', './js/sun.js', './js/timers.js', './js/meds.js', './js/sleep.js', './js/wakewords.js', './js/alarmsound.js', './js/keepawake.js', './js/morning.js', './js/camera.js', './js/watchdb.js', './js/dialscan.js', './js/addwatch.js', './js/dialfind.js', './js/watchdocs.js', './js/galleries.js', './js/exif.js', './js/worldmap.js',
  './js/model.js',
  './js/accuracyui.js',
  './js/lock.js',
  './js/birthday.js',
  './js/detail.js',
  './js/mapview.js',
  './js/pdf.js',
  './js/photomatch.js',
  './js/vendor/jspdf.umd.min.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' skips the browser's HTTP cache so we never save stale files.
  event.waitUntil(caches.open(CACHE)
    .then((c) => Promise.all(SHELL.map((u) => fetch(u, { cache: 'reload' }).then((r) => { if (r.ok) return c.put(u, r); }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('atomic-clock-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // APIs: straight to the network
  const key = req.mode === 'navigate' ? './index.html' : url.pathname;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req, { cache: 'no-cache' });   // revalidate with the server every time
      if (res.ok) cache.put(key, res.clone());
      return res;
    } catch (e) {
      const cached = await cache.match(key, { ignoreSearch: true });
      return cached || new Response('Offline', { status: 503, statusText: 'Offline' });
    }
  })());
});
