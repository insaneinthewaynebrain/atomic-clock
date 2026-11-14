// Watch accuracy tracker (on the Clock tab).
import * as store from './store.js';
import { now, clock, isFresh } from './time.js';
import { el, openModal, confirmModal, promptModal, toast, signed, fmtDuration, fmtDateTime, pad } from './ui.js';

const DAY = 86400000;
const root = () => document.getElementById('tracker');

/* ---------- Maths ---------- */

/** Derived numbers for one run (readings sorted by time). */
export function computeRun(run) {
  const rs = [...run.readings].sort((a, b) => a.t - b.t);
  const readings = rs.map((r, i) => {
    if (i === 0) return { ...r };
    const p = rs[i - 1];
    const elapsedMs = r.t - p.t;
    const gain = r.offset - p.offset;
    return { ...r, elapsedMs, gain, rate: elapsedMs > 0 ? gain / (elapsedMs / DAY) : null };
  });
  const first = rs[0], last = rs[rs.length - 1];
  const spanDays = rs.length > 1 ? (last.t - first.t) / DAY : 0;
  const totalGain = rs.length > 1 ? last.offset - first.offset : 0;
  return { id: run.id, readings, spanDays, totalGain, avg: spanDays > 0 ? totalGain / spanDays : null };
}

/** Per-watch summary. Overall average is weighted by elapsed time across runs. */
export function watchStats(w) {
  const runs = w.runs.filter((r) => r.readings.length).map(computeRun)
    .sort((a, b) => a.readings[0].t - b.readings[0].t);
  const cur = runs[runs.length - 1] || null;
  const latest = cur ? cur.readings[cur.readings.length - 1] : null;
  let g = 0, d = 0;
  for (const r of runs) if (r.spanDays > 0) { g += r.totalGain; d += r.spanDays; }
  return {
    runs, cur, latest,
    lastRate: latest && latest.rate != null ? latest.rate : null,
    lastElapsed: latest ? latest.elapsedMs : null,
    runAvg: cur ? cur.avg : null,
    overall: d > 0 ? g / d : null,
    overallDays: d,
  };
}

/* ---------- Formatting ---------- */

export function fmtOffset(sec) {
  const a = Math.abs(sec);
  if (a < 0.5) return 'on time';
  const m = Math.floor(a / 60), s = Math.round(a % 60);
  const body = m ? `${m} min ${pad(s)} s` : `${s} s`;
  return `${body} ${sec > 0 ? 'fast' : 'slow'}`;
}

export function fmtRate(r) {
  if (r == null) return '—';
  if (Math.abs(r) < 0.05) return '0.0 s/day';
  return `${signed(r, 1)} s/day ${r > 0 ? 'fast' : 'slow'}`;
}

function rateClass(r) {
  if (r == null) return '';
  const { green, amber } = store.get().thresholds;
  const a = Math.abs(r);
  if (a <= green) return 'good';
  if (a <= amber) return 'mid';
  return 'badr';
}

/* ---------- State helpers ---------- */

function data() { return store.get(); }
function selected() {
  const d = data();
  return d.watches.find((w) => w.id === d.selectedWatchId) || d.watches[0] || null;
}

function stamp() {
  return { t: Math.round(now()), synced: !!clock.synced && isFresh(), acc: clock.accuracy };
}

/* ---------- Actions ---------- */

async function addWatch() {
  const name = await promptModal('Add a watch', '', 'e.g. Rolex GMT', 'Add');
  if (!name) return;
  const w = { id: store.uid(), name, runs: [] };
  data().watches.push(w);
  data().selectedWatchId = w.id;
  store.save();
  render();
}

async function renameWatch(w) {
  const name = await promptModal('Rename watch', w.name, '', 'Save');
  if (!name) return;
  w.name = name;
  store.save();
  render();
}

async function deleteWatch(w) {
  const ok = await confirmModal(`Delete “${w.name}”?`, 'This removes the watch and all its readings. It cannot be undone (unless you have a backup).', 'Delete', true);
  if (!ok) return;
  const d = data();
  d.watches = d.watches.filter((x) => x.id !== w.id);
  d.selectedWatchId = d.watches[0]?.id || null;
  store.save();
  render();
}

// Mark: save the chosen +/- seconds against the exact synced time of the tap.
function mark(w, sign, secs) {
  const s = stamp();
  const offset = sign * secs;
  const reading = { id: store.uid(), offset, ...s };
  const runs = w.runs.filter((r) => r.readings.length);
  if (!runs.length) w.runs.push({ id: store.uid(), readings: [reading] });
  else {
    const last = (r) => Math.max(...r.readings.map((x) => x.t));
    runs.reduce((x, y) => (last(y) > last(x) ? y : x)).readings.push(reading);
  }
  store.save();
  toast(`Marked ${fmtSignedSecs(offset)} at ${fmtDateTime(s.t).split(' ').pop()}${s.synced ? '' : ' (not synced)'}`);
  render();
}

function fmtSignedSecs(o) { return o === 0 ? '0 s' : `${signed(o)} s`; }

async function deleteReading(w, runId, readingId) {
  const ok = await confirmModal('Delete this mark?', 'Rates will be recalculated without it.', 'Delete', true);
  if (!ok) return;
  const run = w.runs.find((r) => r.id === runId);
  if (!run) return;
  run.readings = run.readings.filter((r) => r.id !== readingId);
  w.runs = w.runs.filter((r) => r.readings.length);
  store.save();
  render();
}

/* ---------- Render ---------- */

function stat(label, value, sub, cls = '') {
  return el('div', { class: 'stat ' + cls }, el('div', { class: 'stat-label' }, label), el('div', { class: 'stat-value' }, value), sub ? el('div', { class: 'stat-sub' }, sub) : null);
}

export function render() {
  const box = root();
  box.innerHTML = '';
  const d = data();
  box.append(el('h2', { class: 'card-title' }, 'Watch accuracy'));

  if (!d.watches.length) {
    box.append(
      el('p', { class: 'muted' }, 'Add a watch to track how many seconds a day it gains or loses.'),
      el('button', { type: 'button', class: 'btn primary wide', onclick: addWatch }, '+ Add a watch'));
    return;
  }

  const w = selected();
  if (d.selectedWatchId !== w.id) { d.selectedWatchId = w.id; store.save(); }

  // Watch picker + small manage buttons
  const sel = el('select', {
    class: 'input watch-select', 'aria-label': 'Watch',
    onchange: (e) => { d.selectedWatchId = e.target.value; store.save(); render(); },
  }, d.watches.map((x) => el('option', { value: x.id, selected: x.id === w.id }, x.name)));
  box.append(el('div', { class: 'watch-bar' }, sel,
    el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'Add watch', title: 'Add watch', onclick: addWatch }, '+'),
    el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'Rename watch', title: 'Rename', onclick: () => renameWatch(w) }, '✎'),
    el('button', { type: 'button', class: 'icon-btn sm danger', 'aria-label': 'Delete watch', title: 'Delete', onclick: () => deleteWatch(w) }, '🗑')));

  // Mark row: [+/-] [0..60 s] [Mark]
  const signSel = el('select', { class: 'input mark-sign', 'aria-label': 'Plus (fast) or minus (slow)' },
    el('option', { value: '1' }, '+'), el('option', { value: '-1' }, '\u2212'));
  const secSel = el('select', { class: 'input mark-secs', 'aria-label': 'Seconds' },
    Array.from({ length: 61 }, (_, i) => el('option', { value: String(i) }, `${i} s`)));
  box.append(
    el('div', { class: 'mark-row' }, signSel, secSel,
      el('button', { type: 'button', class: 'btn primary mark-btn', onclick: () => mark(w, Number(signSel.value), Number(secSel.value)) }, 'Mark')),
    el('p', { class: 'muted small mark-help' }, '+ = watch ahead of the clock (fast), \u2212 = behind (slow).'));

  const st = watchStats(w);
  const all = st.runs.flatMap((r) => r.readings);
  const first = st.runs.length ? st.runs[st.runs.length - 1].readings[0] : null;
  const latest = st.latest;
  const sinceFirst = st.cur && st.cur.readings.length > 1 ? latest.offset - first.offset : null;

  box.append(el('div', { class: 'stats' },
    stat('Now', latest ? fmtSignedSecs(latest.offset) : '—', latest ? fmtOffset(latest.offset) : 'no marks yet', latest ? (latest.offset >= 0 ? '' : '') : ''),
    stat('Since last mark', fmtRate(st.lastRate), st.lastElapsed ? `${signed(latest.gain)} s in ${fmtDuration(st.lastElapsed)}` : 'needs 2 marks'),
    stat('Average per day', fmtRate(st.overall), st.overallDays > 0 ? `over ${fmtDuration(st.overallDays * DAY)}` : 'needs 2 marks', rateClass(st.overall)),
    stat('Total drift', sinceFirst != null ? `${fmtSignedSecs(sinceFirst)}` : '—', sinceFirst != null ? `${sinceFirst >= 0 ? 'gained' : 'lost'} since first mark (${fmtSignedSecs(first.offset)})` : 'needs 2 marks')));

  if (st.overall != null && Math.abs(st.overall) > d.thresholds.amber) {
    box.append(el('p', { class: 'service-note' }, `Averaging more than \u00b1${d.thresholds.amber} s/day \u2014 a service may be due.`));
  }

  // Log
  box.append(el('h3', { class: 'sub-title' }, `Log \u2014 ${w.name}`));
  if (!all.length) { box.append(el('p', { class: 'muted small' }, 'No marks yet. Compare your watch with the big seconds above, pick + or \u2212 and the seconds, then tap Mark.')); return; }
  const list = el('div', { class: 'hist' });
  st.runs.slice().reverse().forEach((run) => {
    run.readings.slice().reverse().forEach((r) => {
      const rateTxt = r.rate != null
        ? `${fmtRate(r.rate)} \u00b7 ${signed(r.gain)} s in ${fmtDuration(r.elapsedMs)}`
        : 'first mark';
      list.append(el('div', { class: 'hist-row' },
        el('div', { class: 'hist-main' },
          el('div', { class: 'hist-when' }, fmtDateTime(r.t), r.synced ? null : el('span', { class: 'unsynced', title: 'Marked without network sync' }, ' \u26a0\ufe0e')),
          el('div', { class: 'hist-off' }, `${fmtSignedSecs(r.offset)} `, el('span', { class: 'muted small' }, fmtOffset(r.offset))),
          el('div', { class: 'hist-rate muted small' }, rateTxt)),
        el('button', { type: 'button', class: 'icon-btn sm danger', 'aria-label': 'Delete mark', onclick: () => deleteReading(w, run.id, r.id) }, '\u00d7')));
    });
  });
  box.append(list);
}

export function initTracker() { render(); }
