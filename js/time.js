// Network time sync.
// Takes several HTTPS samples, measures each round trip with performance.now(),
// keeps the lowest-delay sample and runs the clock from performance.now() + offset.

const SOURCES = [
  {
    name: 'time.now',
    url: () => 'https://time.now/developer/api/timezone/Etc/UTC?_=' + Date.now() + Math.random().toString(36).slice(2, 6),
    parse: (j) => parseIsoUtc(j.utc_datetime),
    resolutionMs: 0.001,
  },
  {
    name: 'timeapi.io',
    url: () => 'https://timeapi.io/api/time/current/zone?timeZone=UTC&_=' + Date.now(),
    parse: (j) => parseIsoUtc(j.dateTime),
    resolutionMs: 1,
  },
];

const SAMPLES = 6;
const RESYNC_MS = 5 * 60 * 1000;

// Parses "2026-11-14T19:54:29.228351Z" (or without Z) as UTC, keeping sub-millisecond digits.
export function parseIsoUtc(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/.exec(s || '');
  if (!m) throw new Error('Unrecognised time format');
  const frac = m[7] ? parseFloat('0.' + m[7]) * 1000 : 0;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) + frac;
}

export const clock = {
  base: null,          // epoch ms at performance.now() === 0
  phoneOffset: null,   // true time minus phone clock, ms (positive = phone is slow)
  synced: false,
  accuracy: null,      // ± ms
  source: null,
  lastSync: null,      // phone-clock ms of last good sync
  error: null,
  syncing: false,
};

const listeners = new Set();
export function onSyncChange(fn) { listeners.add(fn); }
function emit() { listeners.forEach((f) => { try { f(clock); } catch (e) { console.error(e); } }); }

/** Best-known current time in epoch milliseconds. */
export function now() {
  return clock.base != null ? clock.base + performance.now() : Date.now();
}

async function takeSample(src) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 5000);
  try {
    const t0 = performance.now();
    const res = await fetch(src.url(), { cache: 'no-store', credentials: 'omit', signal: ac.signal });
    const t1 = performance.now();
    const phoneAtT1 = Date.now();
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const server = src.parse(await res.json());
    const rtt = t1 - t0;
    // Assume the server stamped the time half-way through the round trip.
    return {
      rtt,
      base: server - (t0 + t1) / 2,
      phoneOffset: server - (phoneAtT1 - rtt / 2),
    };
  } finally { clearTimeout(timer); }
}

async function doSync() {
  clock.syncing = true;
  emit();
  let lastErr = null;
  for (const src of SOURCES) {
    const samples = [];
    let fails = 0;
    for (let i = 0; i < SAMPLES && fails < 2; i++) {
      try { samples.push(await takeSample(src)); fails = 0; }
      catch (e) { lastErr = e; fails++; }
    }
    if (samples.length) {
      const best = samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
      clock.base = best.base;
      clock.phoneOffset = best.phoneOffset;
      clock.accuracy = Math.max(1, Math.ceil(best.rtt / 2 + src.resolutionMs));
      clock.source = src.name;
      clock.samples = samples.length;
      clock.lastSync = Date.now();
      clock.synced = true;
      clock.error = null;
      clock.syncing = false;
      emit();
      return true;
    }
  }
  clock.syncing = false;
  clock.error = (lastErr && lastErr.message) || 'No network time source answered';
  emit();
  return false;
}

let inflight = null;
export function sync() {
  if (!inflight) inflight = doSync().finally(() => { inflight = null; });
  return inflight;
}

/** True when the last good sync is recent enough to trust. */
export function isFresh() {
  return clock.synced && clock.lastSync && Date.now() - clock.lastSync < 30 * 60 * 1000;
}

// If performance.now() stalled while the phone slept, re-anchor on the
// (corrected) phone clock and re-sync.
function checkDrift() {
  if (clock.base == null || clock.phoneOffset == null) return;
  const viaPerf = clock.base + performance.now();
  const viaDate = Date.now() + clock.phoneOffset;
  if (Math.abs(viaPerf - viaDate) > 1000) {
    clock.base = viaDate - performance.now();
    sync();
  }
}

let started = false;
export function startSync() {
  if (started) return;
  started = true;
  sync();
  setInterval(() => { if (document.visibilityState === 'visible') sync(); }, RESYNC_MS);
  setInterval(checkDrift, 2000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { checkDrift(); sync(); }
  });
  window.addEventListener('pageshow', (e) => { if (e.persisted) sync(); });
  window.addEventListener('online', () => sync());
}
