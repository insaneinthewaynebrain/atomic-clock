// Two sections on each watch's page:
//  • "In rotation" — the past 12 months of wear: hours and days, how it compares with the rest of the Watch Box,
//    month by month, habits, accuracy over the period, and a few surprises.
//  • "Where I've been" — a world map of every place the watch has been: gallery photos with a location, plus
//    places added by hand (type-ahead search, as in Weather).
import * as store from './store.js';
import { el, openModal, confirmModal, placeSearchModal, placeLabel } from './ui.js';
import { detailSections, getWatch, ownedWatches, money, openWatchDetail } from './collection.js';
import { watchStats, fmtRate } from './accuracy.js';
import { GALLERIES, placeText } from './galleries.js';
import { memoryGalleries } from './watchdocs.js';

const DAY = 86400000, HOUR = 3600000;
const d = () => store.get();
const dayKey = (t) => { const x = new Date(t); return `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`; };
const fmtH = (ms) => { const h = ms / HOUR; return h >= 100 ? `${Math.round(h).toLocaleString('en-GB')} h` : h >= 10 ? `${Math.round(h)} h` : `${h.toFixed(1)} h`; };
const ord = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');

/** Wear inside [from, to): total time, the sessions (clipped) and the days touched. */
function wearIn(id, from, to = Date.now()) {
  const sessions = [];
  const days = new Set();
  for (const e of d().wear || []) {
    if (e.watchId !== id) continue;
    const a = Math.max(e.on, from), b = Math.min(e.off || Date.now(), to);
    if (b <= a) continue;
    sessions.push([a, b]);
    const c = new Date(a); c.setHours(0, 0, 0, 0);
    for (let i = 0; c.getTime() < b && i < 400; i++) { days.add(dayKey(c)); c.setDate(c.getDate() + 1); }
  }
  sessions.sort((x, y) => x[0] - y[0]);
  return { ms: sessions.reduce((n, [a, b]) => n + b - a, 0), sessions, days };
}

/* ---------- In rotation ---------- */
function rotationSection(w) {
  if ((w.status || 'owned') !== 'owned') return null;
  const now = Date.now(), from = now - 365 * DAY;
  const mine = wearIn(w.id, from);
  const box = el('div', { class: 'rot-sec' }, el('h3', { class: 'sub-title' }, 'In rotation · past 12 months'));
  const all = ownedWatches().map((x) => ({ w: x, ...wearIn(x.id, from) })).sort((a, b) => b.ms - a.ms);
  if (!mine.ms) {
    box.append(el('p', { class: 'muted small' }, 'Not worn in the past 12 months. Log it with “Wear now” above and this fills up with hours, habits and how it compares with the rest of your Watch Box.'));
    return box;
  }
  const total = all.reduce((n, x) => n + x.ms, 0);
  const rank = all.findIndex((x) => x.w.id === w.id) + 1;
  const share = total ? Math.round((mine.ms / total) * 100) : 0;
  const fair = all.length ? Math.round(100 / all.length) : 0;

  // Headline numbers
  box.append(el('div', { class: 'rot-stats' },
    stat(fmtH(mine.ms), 'worn'),
    stat(`${mine.days.size}`, mine.days.size === 1 ? 'day' : 'days'),
    stat(`${share}%`, 'of all wear'),
    stat(all.length > 1 ? ord(rank) : '—', all.length > 1 ? `of ${all.length} watches` : 'only watch')));

  // Compared with the Watch Box
  if (all.length > 1) {
    const max = all[0].ms || 1;
    const shown = all.length <= 8 ? all : [...all.slice(0, 6), ...(rank > 6 ? [all[rank - 1]] : [])];
    box.append(el('div', { class: 'rot-bars' }, shown.map((x) => el('div', { class: 'rot-bar' + (x.w.id === w.id ? ' me' : '') },
      el('span', { class: 'rot-bar-name' }, x.w.name),
      el('span', { class: 'rot-bar-track' }, el('i', { style: `width:${Math.max(2, (x.ms / max) * 100)}%` })),
      el('span', { class: 'rot-bar-v' }, fmtH(x.ms))))),
    el('p', { class: 'muted small' }, share > fair * 1.5 ? `A firm favourite: worn ${Math.round(share / fair * 10) / 10}× an even share.`
      : share < fair * 0.5 ? `Under-worn: an even share would be about ${fair}% of your wear.` : `About an even share of your wear (${fair}% each would be equal).`));
  }

  // Month by month
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const a = new Date(); a.setDate(1); a.setHours(0, 0, 0, 0); a.setMonth(a.getMonth() - i);
    const b = new Date(a); b.setMonth(b.getMonth() + 1);
    months.push({ label: a.toLocaleDateString('en-GB', { month: 'narrow' }), name: a.toLocaleDateString('en-GB', { month: 'long' }), ms: wearIn(w.id, a.getTime(), b.getTime()).ms });
  }
  const mMax = Math.max(...months.map((m) => m.ms), 1);
  box.append(el('div', { class: 'rot-months', 'aria-label': 'Hours worn each month' }, months.map((m) => el('div', { class: 'rot-m', title: `${m.name}: ${fmtH(m.ms)}` },
    el('span', { class: 'rot-m-bar' }, el('i', { style: `height:${(m.ms / mMax) * 100}%` })), el('span', { class: 'rot-m-l' }, m.label)))));

  // Habits
  const dow = new Array(7).fill(0);
  for (const [a, b] of mine.sessions) dow[new Date(a).getDay()] += b - a;
  const favDay = dow.indexOf(Math.max(...dow));
  const dayNames = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
  const weekend = dow[0] + dow[6], weekday = mine.ms - weekend;
  const keys = [...mine.days].map((k) => { const [y, m, dd] = k.split('-').map(Number); return new Date(y, m, dd).getTime(); }).sort((a, b) => a - b);
  let streak = 1, best = 1, gap = 0;
  for (let i = 1; i < keys.length; i++) {
    const diff = Math.round((keys[i] - keys[i - 1]) / DAY);
    streak = diff === 1 ? streak + 1 : 1; best = Math.max(best, streak); gap = Math.max(gap, diff - 1);
  }
  const longest = Math.max(...mine.sessions.map(([a, b]) => b - a));
  const peak = months.reduce((x, y) => (y.ms > x.ms ? y : x));
  box.append(el('div', { class: 'facts rot-facts' },
    fact('Favourite day', dayNames[favDay]),
    fact('Weekends vs weekdays', weekend > weekday * 0.4 ? 'More of a weekend watch' : 'Mostly a weekday watch'),
    fact('Longest run', `${best} day${best === 1 ? '' : 's'} in a row`),
    fact('Longest time on the wrist', fmtH(longest)),
    fact('Average session', fmtH(mine.ms / mine.sessions.length)),
    fact('Busiest month', `${peak.name} (${fmtH(peak.ms)})`),
    gap ? fact('Longest rest', `${gap} day${gap === 1 ? '' : 's'}`) : null));

  // Accuracy over the period
  const st = watchStats(w);
  const runs = st.runs.filter((r) => r.readings[r.readings.length - 1].t >= from && r.spanDays > 0);
  if (runs.length) {
    const g = runs.reduce((n, r) => n + r.totalGain, 0), dd = runs.reduce((n, r) => n + r.spanDays, 0);
    const rate = g / dd;
    const drift = rate * (mine.ms / DAY);
    const rates = runs.map((r) => r.totalGain / r.spanDays);
    box.append(el('div', { class: 'facts rot-facts' },
      fact('Average accuracy', `${fmtRate(rate)} over ${runs.length} measuring run${runs.length === 1 ? '' : 's'}`),
      runs.length > 1 ? fact('Best / worst run', `${fmtRate(rates.reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a)))} / ${fmtRate(rates.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a)))}`) : null,
      fact('Drift while worn', `about ${Math.abs(drift) >= 90 ? `${Math.round(Math.abs(drift) / 60)} min` : `${Math.round(Math.abs(drift))} s`} ${drift >= 0 ? 'fast' : 'slow'} in total, if never reset`)));
  } else {
    box.append(el('p', { class: 'muted small' }, 'Accuracy: no measurements in the past 12 months. Use the accuracy tracker on the Clock tab to add some.'));
  }

  // Surprises
  const fun = [];
  const hours = mine.ms / HOUR;
  const bph = Number(w.bph) || (w.movement === 'quartz' ? 3600 : 0);
  if (bph) fun.push(`It ${w.movement === 'quartz' ? 'ticked' : 'beat'} about ${Math.round(bph * hours).toLocaleString('en-GB')} times on your wrist.`);
  const handMm = (Number(w.caseSize) || 40) * 0.36;                      // seconds hand roughly 36% of the case width
  const km = (2 * Math.PI * handMm * hours * 60) / 1e6;
  fun.push(`The tip of its seconds hand travelled about ${km >= 1 ? `${km.toFixed(1)} km` : `${Math.round(km * 1000)} m`} while you wore it.`);
  if (w.purchasePrice != null && mine.days.size) fun.push(`Cost per wear this year: ${money(Number(w.purchasePrice) / mine.days.size, 2)} a day.`);
  fun.push(`That’s ${(hours / 24).toFixed(1)} full days on your wrist — ${((mine.ms / (365 * DAY)) * 100).toFixed(1)}% of the whole year.`);
  if (w.powerReserve && w.movement !== 'quartz') fun.push(`Enough wear to run its ${w.powerReserve}-hour power reserve flat ${Math.floor(hours / Number(w.powerReserve))} times over.`);
  box.append(el('div', { class: 'rot-fun' }, el('div', { class: 'rot-fun-t' }, '✨ Did you know?'), fun.map((t) => el('p', {}, t))));
  return box;
}
const stat = (v, l) => el('div', { class: 'rot-stat' }, el('div', { class: 'rot-stat-v' }, v), el('div', { class: 'rot-stat-l' }, l));
const fact = (k, v) => (v == null ? null : el('div', { class: 'fact' }, el('span', { class: 'fact-k' }, k), el('span', { class: 'fact-v' }, v)));

/* ---------- Where I've been ---------- */
/** Every point for a watch: gallery photos with a location, and places added by hand. */
export function placesOf(w) {
  const pts = [];
  for (const g of GALLERIES) for (const it of w.galleries?.[g.k] || []) {
    if (it.lat == null) continue;
    pts.push({ lat: it.lat, lon: it.lon, name: it.town || placeText(it), sub: it.region || '', when: it.taken, from: `${g.icon} ${g.title}` });
  }
  for (const p of w.places || []) pts.push({ ...p, from: '📍 Added by you', manual: true });
  return pts.sort((a, b) => (b.when || 0) - (a.when || 0));
}

function placesSection(w) {
  if ((w.status || 'owned') !== 'owned') return null;
  const box = el('div', { class: 'map-sec' });
  const pts = placesOf(w);
  const mapBox = el('div', { class: 'map-box' });
  // Group into places (same town / within ~5 km).
  const groups = [];
  for (const p of pts) {
    const g = groups.find((x) => (p.name && x.name === p.name) || (Math.abs(x.lat - p.lat) < 0.05 && Math.abs(x.lon - p.lon) < 0.05));
    if (g) { g.n++; g.items.push(p); } else groups.push({ name: p.name, sub: p.sub, lat: p.lat, lon: p.lon, n: 1, items: [p] });
  }
  const countries = new Set(groups.map((g) => (g.sub || '').split(', ').pop()).filter(Boolean));
  box.append(el('h3', { class: 'sub-title' }, 'Where I’ve been with this watch'),
    el('p', { class: 'muted small' }, groups.length
      ? `${groups.length} place${groups.length === 1 ? '' : 's'}${countries.size ? ` in ${countries.size} countr${countries.size === 1 ? 'y' : 'ies'}` : ''}${farthest(groups)}`
      : 'Photos in its galleries with a location appear here, and you can add places yourself.'),
    mapBox,
    groups.length ? el('div', { class: 'map-list' }, groups.map((g) => el('div', { class: 'map-item' },
      el('span', { class: 'map-dot' }),
      el('div', { class: 'map-item-main' }, el('div', { class: 'map-item-name' }, g.name || 'Unnamed place', g.n > 1 ? el('span', { class: 'muted' }, ` ×${g.n}`) : null),
        el('div', { class: 'muted small' }, [g.sub, [...new Set(g.items.map((i) => i.from))].join(', ')].filter(Boolean).join(' · '))),
      g.items.some((i) => i.manual) ? el('button', { type: 'button', class: 'ins-x map-x', 'aria-label': `Remove ${g.name}`, onclick: () => removePlace(w, g.items.filter((i) => i.manual)) }, '×') : null))) : null,
    el('button', { type: 'button', class: 'btn wide', onclick: () => addPlace(w) }, '＋ Add a place'));
  import('./worldmap.js').then(({ WORLD_PATH }) => mapBox.append(drawMap(WORLD_PATH, groups))).catch(() => {});
  return box;
}

function farthest(groups) {
  const home = d().weather?.cache?.place;
  if (!home || home.lat == null || !groups.length) return '';
  const km = (a) => { const r = Math.PI / 180; const x = Math.sin(((a.lat - home.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(home.lat * r) * Math.sin(((a.lon - home.lon) * r) / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); };
  const far = groups.reduce((x, y) => (km(y) > km(x) ? y : x));
  const dist = km(far);
  return dist > 50 ? ` · farthest from home: ${far.name} (${Math.round(dist).toLocaleString('en-GB')} km)` : '';
}

function drawMap(path, groups) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 8 360 152');                          // leave out most of Antarctica
  svg.setAttribute('class', 'world');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `World map with ${groups.length} place${groups.length === 1 ? '' : 's'} marked`);
  const land = document.createElementNS(NS, 'path');
  land.setAttribute('d', path); land.setAttribute('class', 'land');
  svg.append(land);
  for (const g of groups) {
    const x = g.lon + 180, y = 90 - g.lat;
    const halo = document.createElementNS(NS, 'circle');
    halo.setAttribute('cx', x); halo.setAttribute('cy', y); halo.setAttribute('r', 5.5 + Math.min(4, g.n)); halo.setAttribute('class', 'pin-halo');
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.setAttribute('r', 2.8); dot.setAttribute('class', 'pin');
    const t = document.createElementNS(NS, 'title'); t.textContent = g.name || '';
    dot.append(t);
    svg.append(halo, dot);
  }
  return svg;
}

function addPlace(w) {
  document.getElementById('modal').close();
  setTimeout(() => placeSearchModal({
    title: 'Add a place',
    onPick: (p) => {
      const live = getWatch(w.id) || w;
      (live.places ||= []).push({ id: store.uid(), name: p.name, sub: placeLabel(p).replace(new RegExp(`^${p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')},?\\s*`), ''), lat: p.lat, lon: p.lon, when: Date.now() });
      store.save();
      setTimeout(() => openWatchDetail(getWatch(w.id) || live), 0);
    },
    onCancel: () => setTimeout(() => openWatchDetail(getWatch(w.id) || w), 0),
  }), 0);
}

async function removePlace(w, items) {
  const yes = await confirmModal(`Remove ${items[0].name}?`, items.length > 1 ? `It was added ${items.length} times.` : '', 'Remove', true);
  const live = getWatch(w.id) || w;
  if (yes) { const ids = new Set(items.map((i) => i.id)); live.places = (live.places || []).filter((p) => !ids.has(p.id)); store.save(); }
  setTimeout(() => openWatchDetail(getWatch(w.id) || live), 0);
}

export function register() {
  detailSections.push(rotationSection, placesSection);
  memoryGalleries.unshift({ title: 'Where I’ve been', photos: () => [],
    notes: (w) => { const seen = new Set(); return placesOf(w).filter((p) => p.name && !seen.has(p.name) && seen.add(p.name)).map((p) => [p.name, p.sub].filter(Boolean).join(', ')).join(' · '); } });
}
