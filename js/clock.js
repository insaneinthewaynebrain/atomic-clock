// Clock tab: big synced time display, sync status line, wake lock.
import { clock, now, sync, onSyncChange, isFresh } from './time.js';
import { pad, fmtAgo, toast } from './ui.js';
import { tickCountdown, initCountdown } from './countdown.js';

const $ = (id) => document.getElementById(id);
let rafId = null;
let lastS = '', lastHm = '', lastDateKey = '';
let wakeLock = null;
let active = false;

function frame() {
  const d = new Date(now());
  const hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
  const s = pad(d.getSeconds());
  const ms = '.' + pad(d.getMilliseconds(), 3);
  if (hm !== lastHm) { $('clk-hm').textContent = hm; lastHm = hm; }
  if (s !== lastS) { $('clk-s').textContent = s; lastS = s; }
  $('clk-ms').textContent = ms;
  const dateKey = d.toDateString();
  if (dateKey !== lastDateKey) { lastDateKey = dateKey; renderDate(d); }
  tickCountdown();
  rafId = requestAnimationFrame(frame);
}

/* ---------- Fit the big digits to whatever screen we're on ---------- */
// Measures the real rendered width (the phone's own font) and sizes the
// seconds display to fill the space without ever spilling past the edge.
let fitQueued = false;
function fitClock() {
  fitQueued = false;
  const box = document.querySelector('.clock');
  const big = $('clk-big');
  if (!box || !big || !box.clientWidth) return;
  const avail = box.clientWidth;
  big.style.fontSize = '100px';
  const w100 = big.scrollWidth || 1;              // width of "SS.mmm" at 100px
  const byWidth = (avail * 0.97 / w100) * 100;
  const vh = window.innerHeight || 800;
  const byHeight = vh * (avail > 700 ? 0.34 : 0.26);  // keep room for everything else on short screens
  const size = Math.max(40, Math.min(byWidth, byHeight, 260));
  big.style.fontSize = size.toFixed(1) + 'px';
  $('clk-hm').style.fontSize = Math.max(32, size * 0.46).toFixed(1) + 'px';
}
export function queueFit() {
  if (fitQueued) return;
  fitQueued = true;
  requestAnimationFrame(fitClock);
}

function renderDate(d) {
  $('clk-date').textContent = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local time';
  let long = '';
  try {
    long = new Intl.DateTimeFormat('en-GB', { timeZoneName: 'long' }).formatToParts(d)
      .find((p) => p.type === 'timeZoneName')?.value || '';
  } catch (e) { /* ignore */ }
  $('clk-tz').textContent = long ? `${tz.replace(/_/g, ' ')} · ${long}` : tz;
}

export function renderStatus() {
  const btn = $('sync-status');
  const txt = btn.querySelector('.sync-text');
  const detail = $('sync-detail');
  btn.classList.remove('ok', 'warn', 'bad', 'busy');
  if (clock.synced && isFresh()) {
    btn.classList.add('ok');
    txt.textContent = `Synced, accurate to about ±${clock.accuracy} ms`;
  } else if (clock.synced) {
    btn.classList.add('warn');
    txt.textContent = `Re-sync failed — using sync from ${fmtAgo(clock.lastSync)}`;
  } else if (clock.syncing) {
    btn.classList.add('busy');
    txt.textContent = 'Syncing with network time…';
  } else {
    btn.classList.add('bad');
    txt.textContent = 'Sync failed — showing the phone’s own clock, which may be wrong';
  }
  const parts = [];
  if (clock.synced) {
    parts.push(`${clock.source} · ${fmtAgo(clock.lastSync)}`);
    const off = clock.phoneOffset / 1000;
    if (Math.abs(off) >= 0.05) parts.push(`phone clock is ${Math.abs(off).toFixed(2)} s ${off > 0 ? 'slow' : 'fast'}`);
    else parts.push('phone clock is within 0.05 s');
  } else if (clock.error && !clock.syncing) {
    parts.push('Tap the line above to try again');
  }
  if (clock.syncing && clock.synced) parts.push('re-syncing…');
  detail.textContent = parts.join(' · ');
}

/* ---------- Wake lock ---------- */
async function requestWake() {
  if (!('wakeLock' in navigator)) { $('clk-wake').textContent = 'Screen wake lock not supported on this device'; return; }
  try {
    if (wakeLock && !wakeLock.released) return;
    wakeLock = await navigator.wakeLock.request('screen');
    $('clk-wake').textContent = 'Screen will stay on while this tab is open';
    wakeLock.addEventListener('release', () => {
      if (active && document.visibilityState === 'visible') $('clk-wake').textContent = '';
    });
  } catch (e) {
    $('clk-wake').textContent = 'Tap the screen to keep it awake';
    // Some browsers only allow a wake lock after a tap: try again on the next one.
    document.addEventListener('pointerup', () => { if (active) requestWake(); }, { once: true });
  }
}

function releaseWake() {
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}

export function initClock() {
  onSyncChange(renderStatus);
  $('sync-status').addEventListener('click', async () => {
    toast('Syncing…', 1200);
    const ok = await sync();
    toast(ok ? `Synced, ±${clock.accuracy} ms` : 'Sync failed');
  });
  setInterval(() => { if (active) renderStatus(); }, 15000);
  document.addEventListener('visibilitychange', () => {
    if (active && document.visibilityState === 'visible') requestWake();
  });
  renderStatus();
  window.addEventListener('resize', queueFit);
  window.addEventListener('orientationchange', () => setTimeout(queueFit, 150));
  if ('ResizeObserver' in window) new ResizeObserver(queueFit).observe(document.querySelector('.clock'));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(queueFit);
}

export function showClock() {
  active = true;
  lastHm = lastS = lastDateKey = '';
  if (!rafId) rafId = requestAnimationFrame(frame);
  queueFit();
  requestWake();
  renderStatus();
}

export function hideClock() {
  active = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  releaseWake();
}
