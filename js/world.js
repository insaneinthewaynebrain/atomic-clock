// World tab: UTC/GMT plus five editable places, using IANA time zones.
import * as store from './store.js';
import { now } from './time.js';
import { el, pad, placeSearchModal, placeLabel, confirmModal } from './ui.js';

const dtfCache = new Map();
function dtf(tz) {
  if (!dtfCache.has(tz)) {
    dtfCache.set(tz, new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));
  }
  return dtfCache.get(tz);
}

/** Wall-clock parts of `ms` in time zone `tz`. */
export function partsIn(tz, ms) {
  const o = {};
  for (const p of dtf(tz).formatToParts(new Date(ms))) o[p.type] = p.value;
  const h = +o.hour === 24 ? 0 : +o.hour;
  return { y: +o.year, mo: +o.month, d: +o.day, h, mi: +o.minute, s: +o.second };
}

/** UTC offset of `tz` at instant `ms`, in minutes. */
export function tzOffsetMin(tz, ms) {
  const p = partsIn(tz, ms);
  const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

export function dayPart(h) {
  if (h >= 6 && h < 12) return { icon: '🌅', label: 'Morning', cls: 'morning' };
  if (h >= 12 && h < 17) return { icon: '☀️', label: 'Afternoon', cls: 'afternoon' };
  if (h >= 17 && h < 22) return { icon: '🌆', label: 'Evening', cls: 'evening' };
  return { icon: '🌙', label: 'Night', cls: 'night' };
}

function fmtDiff(min) {
  if (min === 0) return 'same time';
  const sign = min > 0 ? '+' : '−';
  const a = Math.abs(min), h = Math.floor(a / 60), m = a % 60;
  return `${sign}${h}${m ? ':' + pad(m) : ''} h`;
}

function rowInfo(tz, ms) {
  const p = partsIn(tz, ms);
  const local = new Date(ms);
  const dayDiff = Math.round((Date.UTC(p.y, p.mo - 1, p.d) - Date.UTC(local.getFullYear(), local.getMonth(), local.getDate())) / 86400000);
  const diffMin = tzOffsetMin(tz, ms) - (-local.getTimezoneOffset());
  return {
    time: `${pad(p.h)}:${pad(p.mi)}`,
    secs: pad(p.s),
    diff: fmtDiff(diffMin),
    day: dayDiff > 0 ? 'tomorrow' : dayDiff < 0 ? 'yesterday' : '',
    part: dayPart(p.h),
  };
}

let timer = null;
const rows = [];   // {tz, nodes}

function makeRow({ title, sub, tz, onclick, fixed }) {
  const n = {
    time: el('span', { class: 'w-time' }),
    secs: el('span', { class: 'w-secs' }),
    diff: el('span', { class: 'w-diff' }),
    day: el('span', { class: 'w-day' }),
    part: el('span', { class: 'w-part' }),
  };
  const node = el(onclick ? 'button' : 'div', { type: onclick ? 'button' : null, class: 'w-row' + (fixed ? ' fixed' : ''), onclick },
    el('div', { class: 'w-left' },
      el('div', { class: 'w-name' }, title),
      el('div', { class: 'w-sub' }, sub),
      el('div', { class: 'w-meta' }, n.part, n.diff, n.day)),
    el('div', { class: 'w-right' }, n.time, n.secs));
  rows.push({ tz, n });
  return node;
}

function tick() {
  const ms = now();
  for (const { tz, n } of rows) {
    const i = rowInfo(tz, ms);
    n.time.textContent = i.time;
    n.secs.textContent = ':' + i.secs;
    n.diff.textContent = i.diff;
    n.day.textContent = i.day;
    n.day.hidden = !i.day;
    n.part.textContent = `${i.part.icon} ${i.part.label}`;
    n.part.className = 'w-part ' + i.part.cls;
  }
  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
  const d = new Date(ms);
  document.getElementById('world-local').textContent =
    `Your time: ${pad(d.getHours())}:${pad(d.getMinutes())} · ${localTz.replace(/_/g, ' ')}`;
}

function editSlot(i) {
  const d = store.get();
  const extra = d.worldSlots[i] ? [{
    label: 'Clear slot', kind: 'danger',
    onClick: async () => {
      setTimeout(async () => {
        if (await confirmModal('Clear this slot?', d.worldSlots[i].name, 'Clear', true)) {
          d.worldSlots[i] = null; store.save(); render();
        }
      }, 0);
    },
  }] : [];
  placeSearchModal({
    title: `Place ${i + 1}`,
    extraActions: extra,
    onPick: (p) => {
      d.worldSlots[i] = { name: p.name, admin1: p.admin1, country: p.country, timezone: p.timezone, lat: p.lat, lon: p.lon };
      store.save();
      render();
    },
  });
}

export function render() {
  rows.length = 0;
  const fixed = document.getElementById('world-fixed');
  fixed.innerHTML = '';
  fixed.append(
    makeRow({ title: 'UTC', sub: 'Coordinated Universal Time', tz: 'Etc/UTC', fixed: true }),
    makeRow({ title: 'GMT', sub: 'Greenwich Mean Time (UTC+0, no daylight saving)', tz: 'Etc/GMT', fixed: true }));
  const slots = document.getElementById('world-slots');
  slots.innerHTML = '';
  store.get().worldSlots.forEach((s, i) => {
    if (!s) {
      slots.append(el('button', { type: 'button', class: 'w-row empty', onclick: () => editSlot(i) },
        el('div', { class: 'w-left' }, el('div', { class: 'w-name' }, `+ Add a place`), el('div', { class: 'w-sub' }, `Slot ${i + 1}`))));
    } else {
      slots.append(makeRow({ title: s.name, sub: [placeLabel(s), s.timezone].filter(Boolean).join(' · '), tz: s.timezone, onclick: () => editSlot(i) }));
    }
  });
  tick();
}

export function initWorld() { render(); }
export function showWorld() { render(); if (!timer) timer = setInterval(tick, 1000); }
export function hideWorld() { clearInterval(timer); timer = null; }
