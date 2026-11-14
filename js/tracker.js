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

async function justSet(w) {
  const s = stamp();
  const ok = await confirmModal('Start a new tracking run?',
    `Logs “${w.name}” as exactly on time (0 s) at ${fmtDateTime(s.t)}${s.synced ? '' : ' (warning: not network-synced)'}.`,
    'Start run');
  if (!ok) return;
  w.runs.push({ id: store.uid(), readings: [{ id: store.uid(), offset: 0, ...s }] });
  store.save();
  toast('New run started');
  render();
}

function logReading(w) {
  const s = stamp();   // captured the moment the button is tapped
  let dir = 1;
  const fastBtn = el('button', { type: 'button', class: 'seg-btn active' }, 'Fast');
  const slowBtn = el('button', { type: 'button', class: 'seg-btn' }, 'Slow');
  const setDir = (v) => { dir = v; fastBtn.classList.toggle('active', v > 0); slowBtn.classList.toggle('active', v < 0); };
  fastBtn.onclick = () => setDir(1);
  slowBtn.onclick = () => setDir(-1);
  const opts = (n, unit) => Array.from({ length: n }, (_, i) => el('option', { value: String(i) }, `${i} ${unit}`));
  const minSel = el('select', { class: 'input' }, opts(60, 'min'));
  const secSel = el('select', { class: 'input' }, opts(60, 's'));
  const hasRun = w.runs.some((r) => r.readings.length);
  openModal({
    title: `Log a reading — ${w.name}`,
    content: [
      el('p', { class: 'muted small' }, `Time captured: ${fmtDateTime(s.t)}${s.synced ? ` (synced ±${s.acc} ms)` : ' (not synced)'}`),
      el('div', { class: 'seg' }, fastBtn, slowBtn),
      el('div', { class: 'row2' },
        el('label', { class: 'field' }, el('span', {}, 'Minutes'), minSel),
        el('label', { class: 'field' }, el('span', {}, 'Seconds'), secSel)),
      hasRun ? null : el('p', { class: 'muted small' }, 'No run yet: this reading will start one. Rates appear from the second reading.'),
    ],
    actions: [
      { label: 'Cancel' },
      {
        label: 'Save', kind: 'primary',
        onClick: () => {
          const offset = dir * (Number(minSel.value) * 60 + Number(secSel.value));
          const reading = { id: store.uid(), offset, ...s };
          const runs = w.runs.filter((r) => r.readings.length);
          if (!runs.length) w.runs.push({ id: store.uid(), readings: [reading] });
          else {
            const cur = runs.reduce((a, b) => (Math.max(...b.readings.map((x) => x.t)) > Math.max(...a.readings.map((x) => x.t)) ? b : a));
            cur.readings.push(reading);
          }
          store.save();
          toast('Reading saved');
          render();
        },
      },
    ],
  });
}

async function deleteReading(w, runId, readingId) {
  const ok = await confirmModal('Delete this reading?', 'Rates will be recalculated without it.', 'Delete', true);
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

  const sel = el('select', {
    class: 'input watch-select', 'aria-label': 'Selected watch',
    onchange: (e) => { d.selectedWatchId = e.target.value; store.save(); render(); },
  }, d.watches.map((x) => el('option', { value: x.id, selected: x.id === w.id }, x.name)));

  box.append(sel, el('div', { class: 'watch-tools' },
    el('button', { type: 'button', class: 'btn sm', 'aria-label': 'Add watch', onclick: addWatch }, '+ Add'),
    el('button', { type: 'button', class: 'btn sm', 'aria-label': 'Rename watch', onclick: () => renameWatch(w) }, '✎ Rename'),
    el('button', { type: 'button', class: 'btn sm danger', 'aria-label': 'Delete watch', onclick: () => deleteWatch(w) }, '🗑 Delete')));

  box.append(el('div', { class: 'actions2' },
    el('button', { type: 'button', class: 'btn primary', onclick: () => justSet(w) }, 'I’ve just set this watch'),
    el('button', { type: 'button', class: 'btn', onclick: () => logReading(w) }, 'Log a reading')));

  const st = watchStats(w);
  const { green, amber } = d.thresholds;
  const grid = el('div', { class: 'stats' },
    stat('Latest offset', st.latest ? fmtOffset(st.latest.offset) : '—', st.latest ? fmtDateTime(st.latest.t) : 'no readings yet'),
    stat('Since last reading', fmtRate(st.lastRate), st.lastElapsed ? `over ${fmtDuration(st.lastElapsed)}` : 'needs 2 readings'),
    stat('Average this run', fmtRate(st.runAvg), st.cur && st.cur.spanDays > 0 ? `over ${fmtDuration(st.cur.spanDays * DAY)}` : 'needs 2 readings', rateClass(st.runAvg)),
    stat('Overall average', fmtRate(st.overall), st.overallDays > 0 ? `${st.runs.length} run${st.runs.length > 1 ? 's' : ''}, ${fmtDuration(st.overallDays * DAY)}` : 'all runs, time-weighted', rateClass(st.overall)));
  box.append(grid);

  const worst = [st.runAvg, st.overall].filter((x) => x != null).map(Math.abs);
  if (worst.length && Math.max(...worst) > amber) {
    box.append(el('p', { class: 'service-note' }, `Averaging more than ±${amber} s/day — a service may be due.`));
  }
  box.append(el('p', { class: 'legend small' },
    el('span', { class: 'chip good' }, `≤ ±${green}`), el('span', { class: 'chip mid' }, `≤ ±${amber}`), el('span', { class: 'chip badr' }, `> ±${amber} s/day`)));

  // History
  box.append(el('h3', { class: 'sub-title' }, 'History'));
  if (!st.runs.length) { box.append(el('p', { class: 'muted small' }, 'No readings yet.')); return; }
  [...st.runs].reverse().forEach((run, idx) => {
    const n = st.runs.length - idx;
    const head = el('div', { class: 'run-head' },
      el('span', {}, `Run ${n}${idx === 0 ? ' (current)' : ''}`),
      el('span', { class: 'run-avg ' + rateClass(run.avg) }, run.avg != null ? `avg ${fmtRate(run.avg)}` : ''));
    const list = el('div', { class: 'hist' });
    [...run.readings].reverse().forEach((r) => {
      const rateTxt = r.rate != null
        ? `${fmtRate(r.rate)} · ${signed(r.gain)} s in ${fmtDuration(r.elapsedMs)}${r.elapsedMs < 6 * 3600000 ? ' (short gap, rough)' : ''}`
        : 'start of run';
      list.append(el('div', { class: 'hist-row' },
        el('div', { class: 'hist-main' },
          el('div', { class: 'hist-when' }, fmtDateTime(r.t), r.synced ? null : el('span', { class: 'unsynced', title: 'Logged without network sync' }, ' ⚠︎')),
          el('div', { class: 'hist-off' }, fmtOffset(r.offset)),
          el('div', { class: 'hist-rate muted small' }, rateTxt)),
        el('button', { type: 'button', class: 'icon-btn sm danger', 'aria-label': 'Delete reading', onclick: () => deleteReading(w, run.id, r.id) }, '×')));
    });
    box.append(el('div', { class: 'run' }, head, list));
  });
}

export function initTracker() { render(); }
