// Timers in the Alarm section: countdown, stopwatch, lap timer, egg timer and up to 20 medication
// timers. Running timers store their end time, so they carry on through tab changes and reloads.
import * as store from './store.js';
import { el, pad, toast } from './ui.js';
import { unlockAudio } from './countdown.js';
import { ringAlert, toneField } from './ring.js';
import { newMed, tidy, checkMeds, viewMeds } from './meds.js';

const LATE_MS = 10 * 60 * 1000;     // timers that ended while the app was closed still ring for 10 min
const $ = (id) => document.getElementById(id);
let changed = () => {};

function T() {
  const d = store.get();
  const t = (d.timers ||= {});
  t.countdown ||= { dur: 5 * 60000, sound: 'medium' };
  t.stopwatch ||= { base: 0, since: null };
  t.laps ||= { base: 0, since: null, laps: [] };
  t.egg ||= { type: 'soft', size: 'L', cold: true, sound: 'soft' };
  t.meds ||= [];
  if (!t.meds.length) t.meds.push(newMed());
  t.meds.forEach(tidy);
  return t;
}
const save = () => store.save();

/* ---------- Formatting ---------- */
const hhmm = (t) => { const x = new Date(t); return `${pad(x.getHours())}:${pad(x.getMinutes())}`; };
function clock(ms, cs = false) {
  ms = Math.max(0, ms);
  const tot = cs ? Math.floor(ms / 10) : Math.ceil(ms / 1000);
  const c = cs ? tot % 100 : 0, s = cs ? Math.floor(tot / 100) : tot;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return (h ? `${h}:${pad(m)}` : `${pad(m)}`) + `:${pad(ss)}` + (cs ? `.${pad(c)}` : '');
}
function words(ms) {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}
const numIn = (value, max, label, onchange) => el('label', { class: 'num-box' },
  el('input', { type: 'number', inputmode: 'numeric', min: 0, max, value, class: 'input num-in', 'aria-label': label, onchange, onfocus: (e) => e.target.select() }),
  el('span', {}, label));
const clampInt = (v, max) => Math.max(0, Math.min(max, Math.floor(Number(v) || 0)));

/* ---------- Background checks (every half second) ---------- */
export function init(onChange) { changed = onChange; T(); }

export function check() {
  const t = Date.now(), all = T();
  const c = all.countdown;
  if (c.endAt && t >= c.endAt) {
    const late = t - c.endAt;
    c.endAt = null; c.left = null; save(); changed();
    if (late < LATE_MS) ringAlert({ icon: '⏳', title: 'Time’s up', label: `${words(c.dur)} timer`, sound: c.sound,
      buttons: [{ label: 'Restart', fn: () => startCountdown(c.dur) }, { label: 'Stop', kind: 'primary' }] });
  }
  const e = all.egg;
  if (e.endAt && t >= e.endAt) {
    const late = t - e.endAt, egg = EGGS.find((x) => x.id === e.type) || EGGS[1];
    e.endAt = null; save(); changed();
    if (late < LATE_MS) ringAlert({ icon: '🥚', title: `${egg.name} eggs are ready`, label: egg.after, sound: e.sound,
      buttons: [{ label: 'Done', kind: 'primary' }] });
  }
  checkMeds(all.meds, changed);
}

/* ---------- Countdown timer ---------- */
const PRESETS = [1, 2, 3, 5, 10, 15, 20, 30, 45, 60, 90, 120];
function startCountdown(dur) {
  const c = T().countdown;
  c.dur = dur; c.endAt = Date.now() + dur; c.left = null; save(); changed();
}

function viewTimer(box, rerender) {
  const c = T().countdown;
  const running = !!c.endAt, paused = c.left != null && !running;
  const left = () => (running ? c.endAt - Date.now() : paused ? c.left : c.dur);
  const disp = el('div', { class: 'big-time', id: 'cd-disp' }, clock(left()));
  const bar = el('div', { class: 'tbar' }, el('i', { id: 'cd-bar' }));
  const ends = el('div', { class: 'muted small center', id: 'cd-ends' }, '');
  const parts = [Math.floor(c.dur / 3600000), Math.floor((c.dur % 3600000) / 60000), Math.floor((c.dur % 60000) / 1000)];
  const setDur = () => {
    const [h, m, s] = [...box.querySelectorAll('.num-in')].map((x, i) => clampInt(x.value, i ? 59 : 23));
    c.dur = ((h * 60 + m) * 60 + s) * 1000; save(); disp.textContent = clock(c.dur);
  };
  box.append(el('div', { class: 'card timer-card' },
    disp, bar, ends,
    !running && !paused ? [
      el('div', { class: 'num-row' }, numIn(parts[0], 23, 'hours', setDur), numIn(parts[1], 59, 'min', setDur), numIn(parts[2], 59, 'sec', setDur)),
      el('div', { class: 'preset-row' }, PRESETS.map((m) => el('button', { type: 'button', class: 'preset', onclick: () => { unlockAudio(); startCountdown(m * 60000); rerender(); } }, m < 60 ? `${m} min` : `${m / 60} h`.replace('1.5 h', '1½ h')))),
      el('button', { type: 'button', class: 'btn primary wide big-btn', onclick: () => { unlockAudio(); setDur(); if (c.dur < 1000) { toast('Set a time first'); return; } startCountdown(c.dur); rerender(); } }, 'Start'),
    ] : el('div', { class: 'btn-pair' },
      el('button', { type: 'button', class: 'btn big-btn', onclick: () => { c.endAt = null; c.left = null; save(); rerender(); } }, 'Cancel'),
      running
        ? el('button', { type: 'button', class: 'btn primary big-btn', onclick: () => { c.left = c.endAt - Date.now(); c.endAt = null; save(); rerender(); } }, 'Pause')
        : el('button', { type: 'button', class: 'btn primary big-btn', onclick: () => { unlockAudio(); c.endAt = Date.now() + c.left; c.left = null; save(); rerender(); } }, 'Resume')),
    toneField(c.sound, (v) => { c.sound = v; save(); }, 'Sound when it ends')));
  return () => {
    const l = left();
    disp.textContent = clock(l);
    $('cd-bar').style.width = `${running || paused ? Math.max(0, Math.min(100, 100 * l / c.dur)) : 100}%`;
    ends.textContent = running ? `Ends at ${hhmm(c.endAt)}` : paused ? 'Paused' : '';
  };
}

/* ---------- Stopwatch ---------- */
const elapsed = (s) => s.base + (s.since ? Date.now() - s.since : 0);
function toggle(s) { if (s.since) { s.base += Date.now() - s.since; s.since = null; } else s.since = Date.now(); save(); }

function viewStopwatch(box, rerender) {
  const s = T().stopwatch;
  const disp = el('div', { class: 'big-time sw' }, clock(elapsed(s), true));
  box.append(el('div', { class: 'card timer-card' },
    el('div', { class: 'muted small center' }, s.since ? 'Running' : elapsed(s) ? 'Stopped' : 'Ready'),
    disp,
    el('div', { class: 'btn-pair' },
      el('button', { type: 'button', class: 'btn big-btn', disabled: !!s.since || !elapsed(s), onclick: () => { s.base = 0; s.since = null; save(); rerender(); } }, 'Reset'),
      el('button', { type: 'button', class: 'btn big-btn ' + (s.since ? 'stop-btn' : 'primary'), onclick: () => { toggle(s); rerender(); } }, s.since ? 'Stop' : elapsed(s) ? 'Continue' : 'Start'))),
  el('p', { class: 'muted small center' }, 'Keeps running if you leave this screen or close the app.'));
  return () => { disp.textContent = clock(elapsed(s), true); };
}

/* ---------- Lap timer ---------- */
function viewLaps(box, rerender) {
  const s = T().laps;
  const tot = el('div', { class: 'big-time sw' }, clock(elapsed(s), true));
  const lapsAt = s.laps;                          // cumulative ms at each lap
  const lapTimes = lapsAt.map((v, i) => v - (i ? lapsAt[i - 1] : 0));
  const best = lapTimes.length > 1 ? Math.min(...lapTimes) : null, worst = lapTimes.length > 1 ? Math.max(...lapTimes) : null;
  const curLap = el('span', { class: 'lap-cur' }, '');
  const cur = () => elapsed(s) - (lapsAt.length ? lapsAt[lapsAt.length - 1] : 0);
  const running = !!s.since, any = elapsed(s) > 0;
  const rows = lapTimes.map((lt, i) => el('div', { class: 'lap-row' + (lt === best ? ' best' : lt === worst ? ' worst' : '') },
    el('span', {}, `Lap ${i + 1}`), el('span', { class: 'lap-t' }, clock(lt, true)), el('span', { class: 'muted' }, clock(lapsAt[i], true)))).reverse();
  const avg = lapTimes.length ? lapTimes.reduce((x, y) => x + y, 0) / lapTimes.length : 0;
  box.append(el('div', { class: 'card timer-card' },
    tot,
    el('div', { class: 'muted small center' }, `Lap ${lapsAt.length + 1}: `, curLap),
    el('div', { class: 'btn-pair' },
      running
        ? el('button', { type: 'button', class: 'btn big-btn', onclick: () => { s.laps.push(elapsed(s)); save(); rerender(); } }, 'Lap')
        : el('button', { type: 'button', class: 'btn big-btn', disabled: !any, onclick: () => { s.base = 0; s.since = null; s.laps = []; save(); rerender(); } }, 'Reset'),
      el('button', { type: 'button', class: 'btn big-btn ' + (running ? 'stop-btn' : 'primary'), onclick: () => { toggle(s); rerender(); } }, running ? 'Stop' : any ? 'Continue' : 'Start'))),
  lapTimes.length ? el('div', { class: 'card' },
    el('div', { class: 'lap-sum' },
      el('div', {}, el('span', { class: 'muted small' }, 'Fastest'), el('b', { class: 'good-t' }, clock(Math.min(...lapTimes), true))),
      el('div', {}, el('span', { class: 'muted small' }, 'Average'), el('b', {}, clock(avg, true))),
      el('div', {}, el('span', { class: 'muted small' }, 'Slowest'), el('b', { class: 'bad-t' }, clock(Math.max(...lapTimes), true)))),
    el('div', { class: 'lap-head muted small' }, el('span', {}, 'Lap'), el('span', {}, 'Lap time'), el('span', {}, 'Total')),
    rows) : el('p', { class: 'muted small center' }, 'Tap Start, then Lap each time round. Fastest lap shows green, slowest red.'));
  return () => { tot.textContent = clock(elapsed(s), true); curLap.textContent = clock(cur(), true); };
}

/* ---------- Egg timer ---------- */
// Times are for eggs lowered straight from the fridge into a pan of boiling water.
const EGGS = [
  { id: 'dippy', name: 'Dippy', desc: 'Very runny yolk — for toast soldiers', s: 300, yolk: '#ffb000', runny: 2, after: 'Into egg cups and serve straight away.' },
  { id: 'soft', name: 'Soft boiled', desc: 'Runny yolk, white just set', s: 360, yolk: '#ffa200', runny: 1, after: 'Serve straight away so they don’t keep cooking.' },
  { id: 'jammy', name: 'Jammy', desc: 'Sticky, fudgy yolk — ramen and salads', s: 420, yolk: '#f39200', jam: true, after: 'Plunge into iced water for 2 minutes, then peel.' },
  { id: 'medium', name: 'Medium', desc: 'Yolk set with a soft centre', s: 480, yolk: '#f7b23b', after: 'Cool in cold water for a minute, then peel.' },
  { id: 'hard', name: 'Hard boiled', desc: 'Firm yolk all the way through', s: 600, yolk: '#f8d24f', after: 'Cool in cold water so the yolk stays bright yellow.' },
  { id: 'firm', name: 'Extra firm', desc: 'For egg mayo, devilled eggs, picnics', s: 720, yolk: '#fadf86', after: 'Cool in cold water, then peel.' },
  { id: 'poached', name: 'Poached', desc: 'Cracked into gently simmering water', s: 180, yolk: '#ffa800', poached: true, fixed: true, after: 'Lift out with a slotted spoon and drain.' },
  { id: 'quail', name: 'Quail eggs', desc: 'Tiny eggs, soft and runny', s: 150, yolk: '#ffa000', small: true, fixed: true, after: 'Cool in cold water, then peel.' },
];
const SIZES = [['S', 'Small', -60], ['M', 'Medium', -30], ['L', 'Large', 0], ['XL', 'Very large', 60]];

function eggSvg(g) {
  const ns = 'http://www.w3.org/2000/svg', sc = g.small ? 0.72 : 1;
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 60 70'); svg.setAttribute('class', 'egg-svg'); svg.setAttribute('aria-hidden', 'true');
  const add = (tag, attrs) => { const n = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); svg.append(n); };
  if (g.poached) add('path', { d: 'M7 41c0-13 9-22 22-22 14 0 25 7 25 20 0 12-10 21-24 21C17 60 7 53 7 41z', fill: '#f7f3ea' });
  else add('ellipse', { cx: 30, cy: 37, rx: 21 * sc, ry: 27 * sc, fill: '#f7f3ea' });
  const r = 11 * sc, cy = g.poached ? 39 : 40;
  if (g.runny) add('path', { d: `M${30 - r * 0.7} ${cy + 3}q${r * 0.7} ${9 + g.runny * 6} ${r * 1.4} 0z`, fill: g.yolk });
  add('circle', { cx: 30, cy, r, fill: g.yolk });
  if (g.jam) add('circle', { cx: 30, cy, r: r * 0.55, fill: '#e07b00' });
  if (g.runny || g.poached) add('ellipse', { cx: 30 - r * 0.32, cy: cy - r * 0.36, rx: r * 0.28, ry: r * 0.18, fill: 'rgba(255,255,255,.6)' });
  return svg;
}

function eggSecs(e) {
  const g = EGGS.find((x) => x.id === e.type) || EGGS[1];
  if (g.fixed) return g.s;
  return g.s + (SIZES.find((s) => s[0] === e.size)?.[2] || 0) - (e.cold ? 0 : 30);
}

function viewEggs(box, rerender) {
  const e = T().egg;
  const g = EGGS.find((x) => x.id === e.type) || EGGS[1];
  if (e.endAt) {
    const disp = el('div', { class: 'big-time' }, clock(e.endAt - Date.now()));
    const bar = el('i', {});
    box.append(el('div', { class: 'card timer-card egg-run' },
      eggSvg(g),
      el('div', { class: 'egg-run-name' }, g.name),
      disp, el('div', { class: 'tbar' }, bar),
      el('div', { class: 'muted small center' }, `Ready at ${hhmm(e.endAt)}`),
      el('button', { type: 'button', class: 'btn wide big-btn', onclick: () => { e.endAt = null; save(); rerender(); } }, 'Cancel')),
    toneField(e.sound, (v) => { e.sound = v; save(); }, 'Sound when they’re ready'));
    return () => { const l = e.endAt - Date.now(); disp.textContent = clock(l); bar.style.width = `${Math.max(0, Math.min(100, 100 * l / e.dur))}%`; };
  }
  const total = el('div', { class: 'egg-total' });
  const upd = () => { total.textContent = `${g.name}: ${clock(eggSecs(e) * 1000)}`; };
  box.append(
    el('div', { class: 'egg-grid' }, EGGS.map((x) => el('button', { type: 'button', class: 'egg-card' + (x.id === e.type ? ' on' : ''), onclick: () => { e.type = x.id; save(); rerender(); } },
      eggSvg(x), el('div', { class: 'egg-name' }, x.name), el('div', { class: 'egg-desc' }, x.desc), el('div', { class: 'egg-mins' }, clock(x.s * 1000))))),
    el('div', { class: 'card' },
      g.fixed ? null : [
        el('div', { class: 'field' }, el('span', {}, 'Egg size'), el('div', { class: 'seg seg4' }, SIZES.map(([k, l]) => el('button', { type: 'button', class: 'seg-btn' + (e.size === k ? ' active' : ''), onclick: () => { e.size = k; save(); rerender(); } }, l)))),
        el('label', { class: 'field check-field' }, el('input', { type: 'checkbox', class: 'check', checked: !!e.cold, onchange: (ev) => { e.cold = ev.target.checked; save(); upd(); } }), el('span', {}, 'Straight from the fridge (untick for room temperature: 30 s less)')),
      ],
      total,
      el('p', { class: 'muted small' }, g.poached ? 'Bring a pan of water to a gentle simmer, slip the cracked egg in, then tap Start.' : 'Bring a pan of water to a rolling boil, lower the eggs in gently with a spoon, then tap Start.'),
      el('button', { type: 'button', class: 'btn primary wide big-btn', onclick: () => { unlockAudio(); e.dur = eggSecs(e) * 1000; e.endAt = Date.now() + e.dur; save(); rerender(); } }, `Start — ${g.name}`),
      toneField(e.sound, (v) => { e.sound = v; save(); }, 'Sound when they’re ready')));
  upd();
  return null;
}

const VIEWS = { timer: viewTimer, stopwatch: viewStopwatch, laps: viewLaps, eggs: viewEggs, meds: (box, rerender) => viewMeds(box, rerender, T().meds) };

/** Draws one timer screen into `box`; returns a function that refreshes the live numbers. */
export function renderView(v, box, rerender) {
  T();
  return (VIEWS[v] || viewTimer)(box, rerender);
}
