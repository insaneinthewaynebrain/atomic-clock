// App shell: tabs, settings (thresholds, backup), service worker.
import * as store from './store.js';
import { startSync } from './time.js';
import { initClock, showClock, hideClock } from './clock.js';
import { initTracker } from './tracker.js';
import { initWorld, showWorld, hideWorld } from './world.js';
import { initWeather, showWeather } from './weather.js';
import { initCurrency, showCurrency } from './currency.js';
import { el, openModal, confirmModal, toast } from './ui.js';

export const APP_VERSION = '5';

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
  openModal({
    title: 'Backup & restore',
    content: [
      el('p', { class: 'muted small' }, 'Your watches, marks and places are stored only on this phone. Export a backup now and then and save it to Files or iCloud Drive.'),
      el('div', { class: 'actions2' },
        el('button', { type: 'button', class: 'btn', onclick: exportBackup }, '⬆︎ Export backup'),
        el('button', { type: 'button', class: 'btn', onclick: importBackup }, '⬇︎ Import backup')),
      el('p', { class: 'muted small' }, `App version ${APP_VERSION}`),
    ],
    actions: [{ label: 'Close' }],
  });
}

/* ---------- Boot ---------- */

function init() {
  document.getElementById('backup-link').addEventListener('click', openSettings);
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
