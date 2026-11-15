// Tools tab: a grid of tools; each opens in its own panel.
import * as store from './store.js';
import { el, openModal } from './ui.js';
import { APP_NAME, CHANNEL_NAME, CHANNEL_URL } from './config.js';
import { backupPanel } from './backup.js';

/*
 Each tool: { id, title, icon, desc, panel (element id), show(), hide(), hideable }
 More tools are registered by other modules with registerTool().
*/
const TOOLS = [];
let current = null;      // open tool id, or null for the grid
let tabVisible = false;
let appVersion = '';

export function registerTool(t) {
  const i = TOOLS.findIndex((x) => x.id === t.id);
  if (i >= 0) TOOLS[i] = t; else TOOLS.push(t);
  TOOLS.sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
}

const $ = (id) => document.getElementById(id);

function renderHome() {
  const home = $('tools-home');
  home.innerHTML = '';
  const hidden = store.get().tools.hidden;
  const grid = el('div', { class: 'tool-grid' });
  for (const t of TOOLS) {
    if (t.hideable !== false && hidden.includes(t.id)) continue;
    grid.append(el('button', { type: 'button', class: 'tool-tile', onclick: () => openTool(t.id) },
      el('span', { class: 'tool-icon' }, t.icon),
      el('span', { class: 'tool-text' }, el('span', { class: 'tool-title' }, t.title), el('span', { class: 'tool-desc' }, t.desc))));
  }
  home.append(grid,
    el('button', { type: 'button', class: 'link-btn center-block', onclick: customise }, 'Show or hide tools'));
}

function customise() {
  const hidden = new Set(store.get().tools.hidden);
  const boxes = TOOLS.filter((t) => t.hideable !== false).map((t) => {
    const cb = el('input', { type: 'checkbox', class: 'check', checked: !hidden.has(t.id) });
    cb.dataset.id = t.id;
    return el('label', { class: 'field check-field' }, cb, el('span', {}, `${t.icon} ${t.title}`));
  });
  openModal({
    title: 'Show or hide tools',
    content: [el('p', { class: 'muted small' }, 'Untick the tools you don’t use.'), ...boxes],
    actions: [{ label: 'Cancel' }, {
      label: 'Save', kind: 'primary',
      onClick: () => {
        store.get().tools.hidden = boxes.map((b) => b.querySelector('input')).filter((c) => !c.checked).map((c) => c.dataset.id);
        store.save();
        renderHome();
      },
    }],
  });
}

export function openTool(id) {
  const t = TOOLS.find((x) => x.id === id);
  if (!t) return;
  closeCurrent();
  current = id;
  $('tools-home').hidden = true;
  document.querySelectorAll('.tool-panel').forEach((p) => { p.hidden = p.dataset.tool !== t.panel; });
  $('tools-title').textContent = t.title;
  $('tools-back').hidden = false;
  window.scrollTo(0, 0);
  if (t.show) t.show();
  if (location.hash !== '#tools/' + id) history.replaceState(null, '', '#tools/' + id);
}

function closeCurrent() {
  if (!current) return;
  const t = TOOLS.find((x) => x.id === current);
  if (t && t.hide) t.hide();
  current = null;
}

export function goHome() {
  closeCurrent();
  $('tools-home').hidden = false;
  document.querySelectorAll('.tool-panel').forEach((p) => { p.hidden = true; });
  $('tools-title').textContent = 'Tools';
  $('tools-back').hidden = true;
  renderHome();
  if (tabVisible) history.replaceState(null, '', '#tools');
}

/* ---------- Built-in panels: Backup & settings, About ---------- */
const MONEY = ['GBP', 'EUR', 'USD', 'CHF', 'JPY', 'AUD', 'CAD', 'NZD', 'SGD', 'HKD', 'SEK', 'NOK', 'DKK', 'AED', 'INR', 'ZAR'];

function renderSettings() {
  const box = $('tool-settings-body');
  backupPanel(box, appVersion);
  const d = store.get();
  const sel = el('select', { class: 'input', onchange: (e) => { d.money = e.target.value; store.save(); store.emit('watches'); } },
    MONEY.map((c) => el('option', { value: c, selected: d.money === c }, c)));
  box.insertBefore(el('div', { class: 'card' },
    el('h2', { class: 'card-title' }, 'Settings'),
    el('label', { class: 'field' }, el('span', {}, 'Currency for watch prices and values'), sel)), box.lastChild);
}

function renderAbout() {
  const box = $('tool-about-body');
  box.innerHTML = '';
  box.append(
    el('div', { class: 'card' },
      el('h2', { class: 'card-title' }, APP_NAME),
      el('p', {}, `${APP_NAME} is a free app for watch collectors: an exact, network-synced clock for setting your watches; an accuracy tracker; your collection, wishlist and wear history; and handy tools for setting dates, moonphases and GMT hands.`),
      el('p', {}, 'Made with the ', el('a', { href: CHANNEL_URL, target: '_blank', rel: 'noopener', class: 'channel-link' }, `${CHANNEL_NAME} YouTube channel`), ' — come and say hello.')),
    el('div', { class: 'card' },
      el('h2', { class: 'card-title' }, 'Your data stays on your phone'),
      el('p', {}, 'There are no accounts, no adverts and no tracking. Everything you enter — watches, photos, marks and wear history — is stored only on this device. Use Backup & settings to keep a copy safe.')),
    el('div', { class: 'card' },
      el('h2', { class: 'card-title' }, 'About timing accuracy'),
      el('p', {}, 'The clock checks the time against an internet time server and shows how accurate the result is (usually within a few hundredths of a second). Accuracy depends on your connection. Watch accuracy figures, standards grades and the timegrapher are a guide for hobby use, not a certified test.')),
    el('div', { class: 'card' },
      el('h2', { class: 'card-title' }, 'Data sources (all free, no keys)'),
      el('ul', { class: 'plain-list small' },
        el('li', {}, 'Time: time.now (backup: timeapi.io)'),
        el('li', {}, 'Weather and place search: Open-Meteo.com — UK Met Office model where available'),
        el('li', {}, 'Your town name: BigDataCloud (backup: OpenStreetMap Nominatim)'),
        el('li', {}, 'Exchange rates: ExchangeRate-API (open.er-api.com)'),
        el('li', {}, 'Moon phase: calculated on your phone'))),
    el('p', { class: 'muted small center' }, `Version ${appVersion} · Brand names are used for identification only.`));
}

export function initTools(version) {
  appVersion = version;
  $('tools-back').addEventListener('click', goHome);
  registerTool({ id: 'settings', title: 'Backup & settings', icon: '💾', desc: 'Back up, restore, currency', panel: 'settings', show: renderSettings, hideable: false, order: 90 });
  registerTool({ id: 'about', title: 'About', icon: 'ℹ️', desc: `${APP_NAME} & ${CHANNEL_NAME}`, panel: 'about', show: renderAbout, hideable: false, order: 95 });
}

export function showTools(sub) {
  tabVisible = true;
  if (sub && TOOLS.some((t) => t.id === sub)) openTool(sub);
  else if (current) openTool(current);
  else goHome();
}

export function hideTools() {
  tabVisible = false;
  if (current) { const t = TOOLS.find((x) => x.id === current); if (t && t.hide) t.hide(); }
}
