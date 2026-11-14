// App shell: tabs, settings (thresholds, backup), service worker.
import * as store from './store.js';
import { startSync, sync, clock } from './time.js';
import { initClock, showClock, hideClock } from './clock.js';
import { initTracker, render as renderTracker } from './tracker.js';
import { initWorld, showWorld, hideWorld } from './world.js';
import { initWeather, showWeather } from './weather.js';
import { initCurrency, showCurrency } from './currency.js';
import { el, openModal, confirmModal, toast } from './ui.js';

export const APP_VERSION = '3';
const GEAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';

const TABS = {
  clock: { show: showClock, hide: hideClock },
  world: { show: showWorld, hide: hideWorld },
  weather: { show: showWeather },
  currency: { show: showCurrency },
};
let currentTab = null;

function switchTab(name) {
  if (!TABS[name] || name === currentTab) return;
  if (currentTab && TABS[currentTab].hide) TABS[currentTab].hide();
  currentTab = name;
  document.querySelectorAll('.tab').forEach((s) => s.classList.toggle('active', s.dataset.tab === name));
  document.querySelectorAll('.tabbtn').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === name);
    b.setAttribute('aria-current', b.dataset.tab === name ? 'page' : 'false');
  });
  window.scrollTo(0, 0);
  TABS[name].show();
  if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
}

/* ---------- Settings ---------- */

function exportBackup() {
  const json = JSON.stringify(store.exportData(), null, 2);
  const d = new Date();
  const fname = `atomic-clock-backup-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
  const blob = new Blob([json], { type: 'application/json' });
  const file = typeof File === 'function' ? new File([blob], fname, { type: 'application/json' }) : null;
  if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file], title: 'Atomic Clock backup' }).catch((e) => {
      if (e.name !== 'AbortError') download(blob, fname);
    });
  } else {
    download(blob, fname);
  }
}

function download(blob, fname) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: fname });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  toast('Backup saved');
}

function importBackup() {
  const input = el('input', { type: 'file', accept: 'application/json,.json,text/plain' });
  input.addEventListener('change', async () => {
    const f = input.files && input.files[0];
    if (!f) return;
    try {
      const obj = JSON.parse(await f.text());
      const ok = await confirmModal('Replace all data?', 'Importing replaces your watches, readings, places and settings with the ones in this backup.', 'Import', true);
      if (!ok) return;
      store.importData(obj);
      toast('Backup imported');
      setTimeout(() => location.reload(), 600);
    } catch (e) {
      openModal({ title: 'Import failed', content: el('p', {}, e.message || 'That file could not be read.'), actions: [{ label: 'OK', kind: 'primary' }] });
    }
  });
  input.click();
}

function openSettings() {
  const d = store.get();
  const g = el('input', { class: 'input', type: 'number', inputmode: 'decimal', min: '0', step: '0.5', value: String(d.thresholds.green) });
  const a = el('input', { class: 'input', type: 'number', inputmode: 'decimal', min: '0', step: '0.5', value: String(d.thresholds.amber) });
  const syncInfo = clock.synced
    ? `Last sync: ${clock.source}, ±${clock.accuracy} ms, from the fastest of ${clock.samples} samples.`
    : 'Not synced yet.';
  openModal({
    title: 'Settings',
    className: 'tall',
    content: [
      el('h3', { class: 'sub-title' }, 'Watch rate colours (seconds per day)'),
      el('div', { class: 'row2' },
        el('label', { class: 'field' }, el('span', {}, '🟢 Green up to ±'), g),
        el('label', { class: 'field' }, el('span', {}, '🟠 Amber up to ±'), a)),
      el('p', { class: 'muted small' }, 'Beyond amber shows red (a service may be due).'),
      el('h3', { class: 'sub-title' }, 'Backup'),
      el('p', { class: 'muted small' }, 'Everything is stored only on this phone. Export a backup file now and then (save it to Files or iCloud Drive).'),
      el('div', { class: 'actions2' },
        el('button', { type: 'button', class: 'btn', onclick: exportBackup }, '⬆︎ Export backup'),
        el('button', { type: 'button', class: 'btn', onclick: importBackup }, '⬇︎ Import backup')),
      el('h3', { class: 'sub-title' }, 'Time sync'),
      el('p', { class: 'muted small' }, syncInfo + ' Re-syncs every 5 minutes and when you reopen the app.'),
      el('button', { type: 'button', class: 'btn wide', onclick: async () => { toast('Syncing…', 1000); const ok = await sync(); toast(ok ? `Synced, ±${clock.accuracy} ms` : 'Sync failed'); } }, 'Sync now'),
      el('h3', { class: 'sub-title' }, 'Data sources (free, no keys)'),
      el('p', { class: 'muted small' }, `App version ${APP_VERSION}`),
      el('p', { class: 'muted small' }, 'Time: time.now (backup: timeapi.io) · Places & weather: Open-Meteo.com (Met Office UKMO model + Open-Meteo default) · Currency: ExchangeRate-API open.er-api.com'),
    ],
    actions: [
      { label: 'Close' },
      {
        label: 'Save', kind: 'primary',
        onClick: () => {
          const gv = parseFloat(g.value), av = parseFloat(a.value);
          if (!(gv >= 0) || !(av >= 0) || av < gv) { toast('Amber must be at least as big as green'); return false; }
          d.thresholds = { green: gv, amber: av };
          store.save();
          renderTracker();
          toast('Settings saved');
        },
      },
    ],
  });
}

/* ---------- Boot ---------- */

function init() {
  document.querySelectorAll('.settings-btn').forEach((b) => { b.innerHTML = GEAR; b.addEventListener('click', openSettings); });
  document.querySelectorAll('.tabbtn').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  initClock();
  initTracker();
  initWorld();
  initWeather();
  initCurrency();
  startSync();
  const start = location.hash.slice(1);
  switchTab(TABS[start] ? start : 'clock');

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    // When a new version takes over, reload once so the new files are used.
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && !reloaded) { reloaded = true; location.reload(); }
    });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    }).catch((e) => console.warn('SW registration failed', e));
  }
}

init();
