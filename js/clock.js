// Clock tab: big synced time display, sync status line, wake lock.
import { clock, now, sync, onSyncChange, isFresh } from './time.js';
import { pad, fmtAgo, toast } from './ui.js';
import { tickCountdown } from './countdown.js';

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
}

export function showClock() {
  active = true;
  lastHm = lastS = lastDateKey = '';
  if (!rafId) rafId = requestAnimationFrame(frame);
  requestWake();
  renderStatus();
}

export function hideClock() {
  active = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  releaseWake();
}
