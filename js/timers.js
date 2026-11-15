// Timers in the Alarm section: countdown, stopwatch with laps, egg timer and up to 20 medication
// timers. Running timers store their end time, so they carry on through tab changes and reloads.
import * as store from './store.js';
import { el, pad, toast } from './ui.js';
import { unlockAudio } from './countdown.js';
import { ringAlert, toneField } from './ring.js';
import { newMed, tidy, checkMeds, viewMeds } from './meds.js';
import { primeSpeech } from './wakewords.js';

const LATE_MS = 10 * 60 * 1000;     // timers that ended while the app was closed still ring for 10 min
const $ = (id) => document.getElementById(id);
let changed = () => {};

function T() {
  const d = store.get();
  const t = (d.timers ||= {});
  t.countdown ||= { dur: 5 * 60000, sound: 'medium' };
  t.stopwatch ||= { base: 0, since: null };
  t.stopwatch.laps ||= [];
  if (t.laps) {            // the old separate lap timer: bring it into the stopwatch if that one is empty
    const sw = t.stopwatch, old = t.laps;
    if (!sw.base && !sw.since && (old.base || old.since)) Object.assign(sw, { base: old.base, since: old.since, laps: old.laps || [] });
    delete t.laps;
  }
  t.egg ||= { type: 'soft', size: 'L', cold: true };
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
    const late = t - e.endAt, egg = eggOf(e);
    e.endAt = null; save(); keepAwake(false); changed();
    if (late < LATE_MS) ringAlert({ icon: '🥚', title: egg.ready, label: egg.after, sound: 'chime', say: `${egg.ready}.`,
      buttons: [{ label: 'Stop', kind: 'primary' }] });
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

/* ---------- Stopwatch with laps ---------- */
// One stopwatch: left circle is Lap (running) or Reset (stopped); right circle is Start / Stop / Continue.
// s.laps holds the total time at each lap press, so lap times are the gaps between them.
//
// Accuracy: taps are taken on touch-down (not on release, which adds ~50–150 ms) and timed from the
// event's own high-resolution timestamp, so a busy screen redraw can't delay the reading. While the
// app stays open, time is measured with the monotonic performance clock (not the wall clock, which
// can jump when the phone re-syncs). s.since (wall clock) is still saved so it keeps going across reloads.
let anchor = null;                       // { since, perf }: performance.now() at the moment s.since began
const ms3 = (ms) => {                    // 00:00.000 — milliseconds
  ms = Math.max(0, Math.floor(ms));
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return (h ? `${h}:${pad(m)}` : pad(m)) + `:${pad(s % 60)}.${String(ms % 1000).padStart(3, '0')}`;
};
const eventPerf = (ev) => {              // when the finger actually touched, on the performance clock
  const now = performance.now(), t = ev && ev.timeStamp;
  return t > now - 1000 && t <= now ? t : now;
};
const elapsedAt = (s, perf) => s.base + (!s.since ? 0
  : anchor && anchor.since === s.since ? perf - anchor.perf
  : Date.now() - (performance.now() - perf) - s.since);
const elapsed = (s) => elapsedAt(s, performance.now());
function toggleAt(s, perf) {
  if (s.since) { s.base = elapsedAt(s, perf); s.since = null; anchor = null; }
  else { s.since = Date.now() - (performance.now() - perf); anchor = { since: s.since, perf }; }
  save();
}

// Fires on touch-down for speed; Enter/Space (click with no pointer) still works for keyboards.
const tapBtn = (cls, label, fn, disabled = false) => el('button', {
  type: 'button', class: 'sw-btn ' + cls, disabled,
  onpointerdown: (ev) => { if (ev.button > 0) return; ev.preventDefault(); if (navigator.vibrate) navigator.vibrate(12); fn(eventPerf(ev)); },
  onclick: (ev) => { if (ev.detail === 0) fn(performance.now()); },
}, label);

let swWake = null;
function swAwake(on) {
  if (on && 'wakeLock' in navigator && (!swWake || swWake.released)) navigator.wakeLock.request('screen').then((w) => { swWake = w; }).catch(() => {});
  if (!on && swWake) { swWake.release().catch(() => {}); swWake = null; }
}

function viewStopwatch(box, rerender) {
  const s = T().stopwatch;
  const lapsAt = s.laps;
  const lapTimes = lapsAt.map((v, i) => v - (i ? lapsAt[i - 1] : 0));
  const best = lapTimes.length > 1 ? Math.min(...lapTimes) : null, worst = lapTimes.length > 1 ? Math.max(...lapTimes) : null;
  const avg = lapTimes.length ? lapTimes.reduce((x, y) => x + y, 0) / lapTimes.length : 0;
  const running = !!s.since, any = elapsed(s) > 0;
  const cur = () => elapsed(s) - (lapsAt.length ? lapsAt[lapsAt.length - 1] : 0);
  swAwake(running);

  const tot = el('div', { class: 'big-time sw' }, ms3(elapsed(s)));
  const curLap = el('span', { class: 'lap-cur' }, ms3(cur()));
  const liveLap = el('span', { class: 'lap-t' }, ms3(cur()));
  const liveTot = el('span', { class: 'muted' }, ms3(elapsed(s)));

  const lap = (perf) => { s.laps.push(Math.round(elapsedAt(s, perf))); save(); rerender(); };
  const reset = () => { s.base = 0; s.since = null; s.laps = []; anchor = null; save(); rerender(); };
  const startStop = (perf) => { toggleAt(s, perf); if (!s.since) s.base = Math.round(s.base); rerender(); };

  const rows = lapTimes.map((lt, i) => {
    const diff = i ? lt - lapTimes[i - 1] : null;
    return el('div', { class: 'lap-row' + (lt === best ? ' best' : lt === worst ? ' worst' : '') },
      el('span', {}, `Lap ${i + 1}`),
      el('span', { class: 'lap-t' }, ms3(lt),
        diff != null ? el('small', { class: 'lap-diff ' + (diff < 0 ? 'good-t' : diff > 0 ? 'bad-t' : 'muted') }, diff ? `${diff < 0 ? '−' : '+'}${ms3(Math.abs(diff))}` : 'same') : null),
      el('span', { class: 'muted' }, ms3(lapsAt[i])));
  }).reverse();
  const liveRow = any && (running || lapsAt.length) ? el('div', { class: 'lap-row live' },
    el('span', {}, `Lap ${lapsAt.length + 1}`), liveLap, liveTot) : null;

  box.append(el('div', { class: 'card timer-card sw-card' + (running ? ' running' : '') },
    el('div', { class: 'muted small center' }, running ? 'Running' : any ? 'Stopped' : 'Ready'),
    tot,
    el('div', { class: 'muted small center sw-curlap' }, lapsAt.length ? [`Lap ${lapsAt.length + 1}: `, curLap] : ' '),
    el('div', { class: 'sw-btns' },
      running ? tapBtn('lap', 'Lap', lap) : tapBtn('reset', 'Reset', reset, !any),
      running ? tapBtn('stop', 'Stop', startStop) : tapBtn('go', any ? 'Continue' : 'Start', startStop))),
  lapTimes.length ? el('div', { class: 'card' },
    lapTimes.length > 1 ? el('div', { class: 'lap-sum' },
      el('div', {}, el('span', { class: 'muted small' }, 'Fastest'), el('b', { class: 'good-t' }, ms3(best))),
      el('div', {}, el('span', { class: 'muted small' }, 'Average'), el('b', {}, ms3(avg))),
      el('div', {}, el('span', { class: 'muted small' }, 'Slowest'), el('b', { class: 'bad-t' }, ms3(worst)))) : '',
    el('div', { class: 'lap-head muted small' }, el('span', {}, 'Lap'), el('span', {}, 'Lap time'), el('span', {}, 'Total')),
    liveRow, rows) : '',   // '' not null: box.append would print "null"
  el('p', { class: 'muted small center' }, 'Buttons react the instant you touch them, timed to the millisecond. ',
    lapTimes.length ? 'Fastest lap green, slowest red; the small figure is the change from the lap before. ' : 'Tap Start, then Lap each time round — or just Start and Stop. ',
    'The screen stays on while it runs, and it keeps going if you leave this screen.'));

  // Redraw every screen frame (not every 0.1 s) so the thousandths actually move.
  const draw = () => {
    if (!tot.isConnected) return;
    const e = elapsed(s), c = ms3(cur());
    tot.textContent = ms3(e); curLap.textContent = c; liveLap.textContent = c; liveTot.textContent = ms3(e);
    if (s.since) requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
  return null;
}

/* ---------- Egg timer ---------- */
// Times are for eggs lowered straight from the fridge into a pan of boiling water.
const EGGS = [
  { id: 'dippy', name: 'Dippy', ready: 'Your dippy egg is ready', desc: 'Very runny yolk — for toast soldiers', s: 300, yolk: '#ffa600', runny: 2, after: 'Into egg cups and serve straight away.' },
  { id: 'soft', name: 'Soft boiled', ready: 'Your soft-boiled egg is ready', desc: 'Runny yolk, white just set', s: 360, yolk: '#ff9d00', runny: 1, after: 'Serve straight away so it doesn’t keep cooking.' },
  { id: 'jammy', name: 'Jammy', ready: 'Your jammy egg is ready', desc: 'Sticky, fudgy yolk — ramen and salads', s: 420, yolk: '#f7a21b', centre: '#e06f00', cr: 0.6, gloss: true, after: 'Plunge into iced water for 2 minutes, then peel.' },
  { id: 'medium', name: 'Medium', ready: 'Your medium-boiled egg is ready', desc: 'Yolk set with a soft centre', s: 480, yolk: '#f8c247', centre: '#f39a12', cr: 0.38, after: 'Cool in cold water for a minute, then peel.' },
  { id: 'hard', name: 'Hard boiled', ready: 'Your hard-boiled egg is ready', desc: 'Firm yolk all the way through', s: 600, yolk: '#f7d34f', crumbs: '#e3b92e', after: 'Cool in cold water so the yolk stays bright yellow.' },
  { id: 'firm', name: 'Extra firm', ready: 'Your extra-firm egg is ready', desc: 'For egg mayo, devilled eggs, picnics', s: 720, yolk: '#f4e08f', crumbs: '#dcc56a', ring: '#a9ab7f', after: 'Cool in cold water, then peel.' },
  { id: 'poached', name: 'Poached', ready: 'Your poached egg is ready', desc: 'Cracked into gently simmering water', s: 180, yolk: '#ffa800', poached: true, fixed: true, after: 'Lift out with a slotted spoon and drain.' },
  { id: 'quail', name: 'Quail eggs', ready: 'Your quail eggs are ready', desc: 'Tiny eggs, soft and runny', s: 150, yolk: '#ff9800', runny: 1, small: true, fixed: true, after: 'Cool in cold water, then peel.' },
];
const SIZES = [['S', 'Small', -60], ['M', 'Medium', -30], ['L', 'Large', 0], ['XL', 'Very large', 60]];
const eggOf = (e) => EGGS.find((x) => x.id === e.type) || EGGS[1];

/* Each egg is drawn cut in half on a 100 × 120 canvas, so the yolk shows how it will turn out. */
const NS = 'http://www.w3.org/2000/svg';
const SHELL = 'M50 5C25 5 9 43 9 72c0 26 18 44 41 44s41-18 41-44C91 43 75 5 50 5z';
const BLOB = 'M12 70c-6-15 6-30 22-33 9-12 30-14 41-3 15 1 22 15 17 28 6 13-4 28-20 29-10 9-33 9-43-1C18 90 7 82 12 70z';
const svgNode = (tag, attrs) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
const outlineOf = (g) => (g.poached ? BLOB : SHELL);
const scaleOf = (g) => (g.small ? 'translate(50 62) scale(.74) translate(-50 -62)' : '');

function eggParts(g) {
  const out = [], add = (tag, attrs) => out.push(svgNode(tag, attrs));
  const cx = 50, cy = g.poached ? 66 : 74, r = g.poached ? 21 : 23;
  if (g.poached) add('path', { d: BLOB, fill: '#f8f4ea', stroke: '#e2d8c3', 'stroke-width': 2 });
  else add('path', { d: SHELL, fill: '#f8f4ea', stroke: g.small ? '#b48f62' : '#d6c6a6', 'stroke-width': g.small ? 4 : 3 });
  if (g.small) [[30, 22], [64, 18], [83, 48], [16, 60], [88, 82], [22, 98], [72, 108], [48, 7]].forEach(([x, y]) => add('circle', { cx: x, cy: y, r: 2.6, fill: '#5b4127' }));
  if (g.runny) add('path', { d: `M${cx - r * 0.72} ${cy + r * 0.55}Q${cx} ${cy + r + 6 + g.runny * 9} ${cx + r * 0.72} ${cy + r * 0.55}z`, fill: g.yolk });
  if (g.poached) add('ellipse', { cx, cy: cy + r * 0.85, rx: r * 0.9, ry: r * 0.22, fill: 'rgba(120,90,40,.18)' });
  add('circle', { cx, cy, r, fill: g.yolk });
  if (g.centre) add('circle', { cx, cy, r: r * g.cr, fill: g.centre });
  if (g.ring) add('circle', { cx, cy, r: r - 1.4, fill: 'none', stroke: g.ring, 'stroke-width': 2.4, opacity: 0.8 });
  if (g.crumbs) [[-9, -8, 2.2], [7, -11, 1.8], [11, 4, 2.4], [-4, 9, 2], [-13, 3, 1.6], [3, -2, 1.4], [14, -6, 1.3]].forEach(([dx, dy, rr]) => add('circle', { cx: cx + dx, cy: cy + dy, r: rr, fill: g.crumbs }));
  if (g.runny || g.poached || g.gloss) {
    const gr = g.gloss ? r * g.cr : r;
    add('ellipse', { cx: cx - gr * 0.34, cy: cy - gr * 0.4, rx: gr * 0.3, ry: gr * 0.18, fill: 'rgba(255,255,255,.65)', transform: `rotate(-25 ${cx - gr * 0.34} ${cy - gr * 0.4})` });
  }
  return out;
}

function eggSvg(g, cls = 'egg-svg') {
  const svg = svgNode('svg', { viewBox: '0 0 100 120', class: cls, 'aria-hidden': 'true' });
  const grp = svgNode('g', { transform: scaleOf(g) });
  grp.append(...eggParts(g));
  svg.append(grp);
  return svg;
}

/* The big egg on the running screen: an empty outline that fills from the bottom up. */
let eggUid = 0;
function fillingEgg(g) {
  const id = `egg-rise-${++eggUid}`;
  const svg = svgNode('svg', { viewBox: '0 0 100 120', class: 'egg-big', 'aria-hidden': 'true' });
  const wave = svgNode('path', { d: 'M-100 0q12.5-4 25 0' + 't25 0'.repeat(15) + 'V140H-100z' });
  const clip = svgNode('clipPath', { id }); clip.append(wave);
  const defs = svgNode('defs', {}); defs.append(clip);
  const empty = svgNode('g', { transform: scaleOf(g) });
  empty.append(svgNode('path', { d: outlineOf(g), fill: 'rgba(255,255,255,.04)', stroke: 'rgba(255,255,255,.28)', 'stroke-width': 1.6, 'stroke-dasharray': '4 4' }));
  const full = svgNode('g', { transform: scaleOf(g), 'clip-path': `url(#${id})` });
  full.append(...eggParts(g));
  svg.append(defs, empty, full);
  svg.setFill = (p) => {   // p: 0 = empty … 1 = full
    const y = 122 - p * 124, x = -((Date.now() / 40) % 50);
    wave.setAttribute('transform', `translate(${x} ${y})`);
  };
  return svg;
}

function eggSecs(e) {
  const g = eggOf(e);
  if (g.fixed) return g.s;
  return g.s + (SIZES.find((s) => s[0] === e.size)?.[2] || 0) - (e.cold ? 0 : 30);
}

let eggWake = null;
function keepAwake(on) {
  if (on && 'wakeLock' in navigator && (!eggWake || eggWake.released)) navigator.wakeLock.request('screen').then((w) => { eggWake = w; }).catch(() => {});
  if (!on && eggWake) { eggWake.release().catch(() => {}); eggWake = null; }
}

function viewEggs(box, rerender) {
  const e = T().egg;
  const g = eggOf(e);
  if (e.endAt) {
    const disp = el('div', { class: 'egg-left' }, clock(e.endAt - Date.now()));
    const pct = el('div', { class: 'egg-pct' }, '');
    const big = fillingEgg(g);
    keepAwake(true);
    box.append(el('div', { class: 'card timer-card egg-run' },
      el('div', { class: 'egg-run-name' }, g.name),
      el('div', { class: 'egg-stage' + (g.small ? ' small' : '') + (g.poached ? ' poached' : '') }, big,
        el('div', { class: 'egg-readout' }, disp, pct)),
      el('div', { class: 'muted small center' }, `Ready at ${hhmm(e.endAt)}`),
      el('button', { type: 'button', class: 'btn wide big-btn', onclick: () => { e.endAt = null; save(); keepAwake(false); rerender(); } }, 'Cancel')),
    el('p', { class: 'muted small center' }, `When it’s done you’ll hear a chime and “${g.ready}”.`));
    const upd = () => {
      if (!e.endAt) return;
      const l = e.endAt - Date.now(), p = Math.max(0, Math.min(1, 1 - l / e.dur));
      disp.textContent = clock(l);
      pct.textContent = `${Math.floor(p * 100)}% cooked`;
      big.setFill(p);
    };
    upd();
    return upd;
  }
  keepAwake(false);
  const total = el('div', { class: 'egg-total' });
  const upd = () => { total.textContent = `${g.name}: ${clock(eggSecs(e) * 1000)}`; };
  box.append(
    el('div', { class: 'egg-grid' }, EGGS.map((x) => el('button', { type: 'button', class: 'egg-card' + (x.id === e.type ? ' on' : ''), 'aria-pressed': String(x.id === e.type), onclick: () => { e.type = x.id; save(); rerender(); } },
      eggSvg(x), el('div', { class: 'egg-name' }, x.name), el('div', { class: 'egg-desc' }, x.desc), el('div', { class: 'egg-mins' }, clock(x.s * 1000))))),
    el('div', { class: 'card' },
      g.fixed ? null : [
        el('div', { class: 'field' }, el('span', {}, 'Egg size'), el('div', { class: 'seg seg4' }, SIZES.map(([k, l]) => el('button', { type: 'button', class: 'seg-btn' + (e.size === k ? ' active' : ''), onclick: () => { e.size = k; save(); rerender(); } }, l)))),
        el('label', { class: 'field check-field' }, el('input', { type: 'checkbox', class: 'check', checked: !!e.cold, onchange: (ev) => { e.cold = ev.target.checked; save(); upd(); } }), el('span', {}, 'Straight from the fridge (untick for room temperature: 30 s less)')),
      ],
      total,
      el('p', { class: 'muted small' }, g.poached ? 'Bring a pan of water to a gentle simmer, slip the cracked egg in, then tap Start.' : 'Bring a pan of water to a rolling boil, lower the eggs in gently with a spoon, then tap Start.'),
      el('button', { type: 'button', class: 'btn primary wide big-btn', onclick: () => { unlockAudio(); primeSpeech(); e.dur = eggSecs(e) * 1000; e.endAt = Date.now() + e.dur; save(); rerender(); } }, `Start — ${g.name}`),
      el('p', { class: 'muted small center' }, `When it’s done you’ll hear a chime and “${g.ready}”.`)));
  upd();
  return null;
}

/** Called when the Alarm & timers panel closes. */
export function leave() { swAwake(false); }

const VIEWS = { timer: viewTimer, stopwatch: viewStopwatch, laps: viewStopwatch, eggs: viewEggs, meds: (box, rerender) => viewMeds(box, rerender, T().meds) };

/** Draws one timer screen into `box`; returns a function that refreshes the live numbers. */
export function renderView(v, box, rerender) {
  T();
  if (v !== 'stopwatch' && v !== 'laps') swAwake(false);
  return (VIEWS[v] || viewTimer)(box, rerender);
}
