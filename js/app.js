// App shell: tabs, tools registry, service worker.
import * as store from './store.js';
import { startSync } from './time.js';
import { initClock, showClock, hideClock } from './clock.js';
import { initCountdown } from './countdown.js';
import { initTracker } from './tracker.js';
import { initWorld, showWorld, hideWorld } from './world.js';
import { initWeather, showWeather } from './weather.js';
import { initCurrency, showCurrency } from './currency.js';
import { initCollection, showCollection, hideCollection, bannerHooks } from './collection.js';
import { initTools, showTools, hideTools, registerTool } from './tools.js';
import { goHome } from './tools.js';
import { backupBanner, snapshotOnUpdate } from './backup.js';
import { APP_NAME } from './config.js';
import * as wrist from './wrist.js';
import * as setting from './setting.js';
import * as insurance from './insurance.js';
import * as timegrapher from './timegrapher.js';
import * as alarm from './alarm.js';
import * as watchdocs from './watchdocs.js';
import * as galleries from './galleries.js';
import * as watchlife from './watchlife.js';

export const APP_VERSION = '63';

// Feature modules that register their own tabs/tools.
const EXTRA_MODULES = [wrist, watchlife, galleries, watchdocs, setting, insurance, timegrapher, alarm];

const TABS = {
  clock: { show: showClock, hide: hideClock },
  collection: { show: showCollection, hide: hideCollection },
  tools: { show: showTools, hide: hideTools },
};
let currentTab = null;

/** Other stages add tabs here. */
export function registerTab(name, def) {
  TABS[name] = def;
  const b = document.querySelector(`.tabbtn[data-tab="${name}"]`);
  if (b) b.hidden = false;
}

export function switchTab(name, sub) {
  if (!TABS[name]) return;
  if (name === currentTab) { if (name === 'tools') { if (sub) showTools(sub); else goHome(); } return; }
  if (currentTab && TABS[currentTab].hide) TABS[currentTab].hide();
  currentTab = name;
  document.querySelectorAll('.tab').forEach((s) => s.classList.toggle('active', s.dataset.tab === name));
  document.querySelectorAll('.tabbtn').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === name);
    b.setAttribute('aria-current', b.dataset.tab === name ? 'page' : 'false');
  });
  window.scrollTo(0, 0);
  TABS[name].show(sub);
  if (!location.hash.startsWith('#' + name)) history.replaceState(null, '', '#' + name);
}

function registerBuiltInTools() {
  registerTool({ id: 'world', title: 'World clock', icon: '🌍', desc: 'UTC, GMT and your places', panel: 'world', show: showWorld, hide: hideWorld, order: 40 });
  registerTool({ id: 'weather', title: 'Weather', icon: '⛅', desc: 'Met Office forecast + wind', panel: 'weather', show: showWeather, order: 50 });
  registerTool({ id: 'currency', title: 'Currency', icon: '💱', desc: 'Every currency, offline too', panel: 'currency', show: showCurrency, order: 60 });
}

/* ---------- Boot ---------- */

async function init() {
  document.title = APP_NAME;
  document.querySelector('#tab-clock h1').textContent = APP_NAME;
  document.getElementById('backup-link').addEventListener('click', () => switchTab('tools', 'settings'));
  document.querySelectorAll('.tabbtn').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  bannerHooks.push(backupBanner);
  store.on('backup', () => { if (currentTab === 'collection') showCollection(); });

  snapshotOnUpdate(APP_VERSION);
  initClock();
  initTracker();
  initWorld();
  initWeather();
  initCurrency();
  initCollection();
  initTools(APP_VERSION);
  registerBuiltInTools();

  const api = { registerTab, registerTool, switchTab };
  for (const m of EXTRA_MODULES) m.register(api);
  initCountdown();

  startSync();
  // Old links: the Wrist tab now lives inside the Watch Box.
  const ALIAS = { wrist: 'collection', watchbox: 'collection' };
  const route = () => {
    let [tab, sub] = location.hash.slice(1).split('/');
    if (ALIAS[tab]) { tab = ALIAS[tab]; history.replaceState(null, '', '#' + tab); }
    switchTab(TABS[tab] ? tab : 'clock', sub);
  };
  route();
  window.addEventListener('hashchange', route);

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
