// Accuracy on the Clock tab, in two parts:
//  • Set Time (under the live clock): pick the watch, set it to the clock, tap “Set to zero”.
//  • Accuracy Check (the card): log how far it is out, drift, trend graph, merged manual/timegrapher history.
import * as store from './store.js';
import { now, clock, isFresh } from './time.js';
import { el, confirmModal, toast, signed, fmtDuration, fmtDateTime } from './ui.js';
import { watchStats, fmtOffset, fmtRate, grade, fmtRange, POSITIONS, posLabel, positionRates, restingAdvice } from './accuracy.js';
import { setToZero, logReading, sourceBadge, accuracyData, trendGraph, graphLegend, serviceHint, rateClass as rc, fmtSecs } from './accuracyui.js';
import { openShareCard } from './sharecard.js';
import { openWatchEditor, ownedWatches, addWatch as addWatchFlow } from './collection.js';

const DAY = 86400000;
const root = () => document.getElementById('tracker');

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
  const list = ownedWatches();
  return list.find((w) => w.id === d.selectedWatchId) || list[0] || null;
}

function stamp() {
  return { t: Math.round(now()), synced: !!clock.synced && isFresh(), acc: clock.accuracy };
}

/* ---------- Actions ---------- */

function addWatch() { addWatchFlow('owned'); }
function editWatch(w) { openWatchEditor(w); }

async function deleteWatch(w) {
  const ok = await confirmModal(`Delete “${w.name}”?`, 'This removes the watch, its photos and all its marks. It cannot be undone (unless you have a backup).', 'Delete', true);
  if (!ok) return;
  const { removeWatch } = await import('./collection.js');
  await removeWatch(w);
}

// Mark: save the chosen +/- seconds against the exact synced time of the tap.
function mark(w, sign, secs, pos) {
  const s = stamp();
  const offset = sign * secs;
  const first = !(w.readings || []).some((r) => r.source === 'manual');
  (w.readings ||= []).push({ id: store.uid(), timestamp: s.t, offsetSeconds: offset, source: 'manual', synced: s.synced, acc: s.acc,
    ...(pos ? { position: pos } : {}), ...(first ? { setToZero: true } : {}) });
  store.save();
  toast(`Marked ${fmtSignedSecs(offset)} at ${fmtDateTime(s.t).split(' ').pop()}${s.synced ? '' : ' (not synced)'}`);
  render();
}

function fmtSignedSecs(o) { return o === 0 ? '0 s' : `${signed(o)} s`; }

async function deleteReading(w, runId, readingId) {
  const ok = await confirmModal('Delete this reading?', 'Rates will be recalculated without it.', 'Delete', true);
  if (!ok) return;
  w.readings = (w.readings || []).filter((r) => r.id !== readingId);
  store.save();
  render();
}

/* ---------- Render ---------- */

function gradeBlock(w, st) {
  const g = grade(w, st);
  const box = el('div', { class: 'grade' });
  if (!g.ready) {
    box.append(el('div', { class: 'muted small' }, '🏅 Accuracy grade appears after a day or more of marks.'));
    return box;
  }
  const rows = [...g.stds, ...(g.spec ? [g.spec] : [])];
  box.append(
    el('div', { class: 'grade-head' },
      el('span', { class: 'grade-badge ' + g.level }, (g.level === 'good' ? '✓ ' : g.level === 'badr' ? '✗ ' : '') + g.headline),
      el('button', { type: 'button', class: 'btn sm', onclick: () => openShareCard(w) }, '📤 Share')),
    rows.length ? el('details', { class: 'grade-list' },
      el('summary', {}, 'Compare with standards'),
      rows.map((r) => el('div', { class: 'grade-row' },
        el('span', { class: 'grade-mark ' + (r.pass ? 'good' : 'badr') }, r.pass ? '✓' : '✗'),
        el('span', { class: 'grade-name' }, r.name, el('span', { class: 'muted small' }, ` ${fmtRange(r)}`), el('div', { class: 'muted small' }, r.src)))),
      el('p', { class: 'muted small' }, 'Certification tests are done in a laboratory; your figure is real-world wear, so treat the grade as a guide.')) : null);
  return box;
}

function stat(label, value, sub, cls = '') {
  return el('div', { class: 'stat ' + cls }, el('div', { class: 'stat-label' }, label), el('div', { class: 'stat-value' }, value), sub ? el('div', { class: 'stat-sub' }, sub) : null);
}

let filter = 'all';      // history + graph: all | manual | timegrapher

/* ---------- Set Time (under the clock) ---------- */
function renderSetTime() {
  const slot = document.getElementById('settime-slot');
  if (!slot) return;
  const owned = ownedWatches();
  slot.innerHTML = '';
  if (!owned.length) return;
  const d = data();
  const w = selected();
  const last = (w.readings || []).filter((r) => r.setToZero).sort((a, b) => b.timestamp - a.timestamp)[0];
  const sel = el('select', { class: 'input watch-select', 'aria-label': 'Watch to set', onchange: (e) => { d.selectedWatchId = e.target.value; store.save(); store.emit('watches'); } },
    owned.map((x) => el('option', { value: x.id, selected: x.id === w.id }, x.name)));
  slot.append(el('div', { class: 'settime' },
    el('div', { class: 'eyebrow' }, 'Set Time'),
    el('div', { class: 'settime-row' }, sel,
      el('button', { type: 'button', class: 'btn primary settime-zero', onclick: () => setToZero(w) }, '⓪ Set to zero')),
    el('div', { class: 'muted small' }, last
      ? `Last set to zero ${new Date(last.timestamp).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} at ${new Date(last.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
      : 'Set the watch to the clock above, push the crown in on zero, then tap Set to zero.')));
}

/* ---------- Accuracy Check (the card) ---------- */
export function render() {
  renderSetTime();
  const box = root();
  box.innerHTML = '';
  const d = data();
  box.append(el('h2', { class: 'card-title' }, 'Accuracy Check'));

  const owned = ownedWatches();
  if (!owned.length) {
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
    onchange: (e) => { d.selectedWatchId = e.target.value; store.save(); store.emit('watches'); },
  }, owned.map((x) => el('option', { value: x.id, selected: x.id === w.id }, x.name)));
  box.append(el('div', { class: 'watch-bar' }, sel,
    el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'Add watch', title: 'Add watch', onclick: addWatch }, '+'),
    el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'Edit watch details', title: 'Edit details', onclick: () => editWatch(w) }, '✎')));

  // Log a reading: [+/-] [0..60 s] [Log]
  const signSel = el('select', { class: 'input mark-sign', 'aria-label': 'Plus (fast) or minus (slow)' },
    el('option', { value: '1' }, '+'), el('option', { value: '-1' }, '−'));
  const minSel = el('select', { class: 'input mark-mins', 'aria-label': 'Minutes' },
    Array.from({ length: 11 }, (_, i) => el('option', { value: String(i) }, `${i}m`)));
  const secSel = el('select', { class: 'input mark-secs', 'aria-label': 'Seconds' },
    Array.from({ length: 60 }, (_, i) => el('option', { value: String(i) }, `${i}s`)));
  const posSel = el('select', { class: 'input pos-select', 'aria-label': 'How the watch rested since the last reading' },
    el('option', { value: '' }, 'Position since last reading (optional)'),
    POSITIONS.map(([v, lab]) => el('option', { value: v }, lab)));
  box.append(
    el('p', { class: 'muted small mark-help' }, 'How far is the watch out? + = ahead of the clock (fast), − = behind (slow).'),
    el('div', { class: 'mark-row mark-row4' }, signSel, minSel, secSel,
      el('button', { type: 'button', class: 'btn primary mark-btn', onclick: () => logReading(w, Number(signSel.value) * (Number(minSel.value) * 60 + Number(secSel.value)), posSel.value) }, 'Log')),
    posSel);

  const a = accuracyData(w);
  const st = a.st;
  const latest = st.latest;
  const first = st.cur ? st.cur.readings[0] : null;
  const sinceZero = st.cur && st.cur.readings.length > 1 ? latest.offset - first.offset : null;
  box.append(el('div', { class: 'stats' },
    stat('Drift per day', a.drift != null ? fmtRate(a.drift) : '—', a.drift == null ? 'needs 2 readings' : a.driftFrom === 'timegrapher' ? 'latest timegrapher' : 'since set to zero', rc(a.drift)),
    stat('Out now', latest ? fmtSecs(latest.offset) : '—', latest ? fmtOffset(latest.offset) : 'no readings yet'),
    stat('Since set to zero', sinceZero != null ? fmtSecs(sinceZero) : '—', sinceZero != null ? `over ${fmtDuration(st.cur.spanDays * DAY)}` : 'needs 2 readings'),
    stat('All-time average', fmtRate(st.overall), st.overallDays > 0 ? `${st.runs.length} run${st.runs.length === 1 ? '' : 's'} · ${fmtDuration(st.overallDays * DAY)}` : 'needs 2 readings', rc(st.overall))));

  // Trend graph with filters
  const seg = el('div', { class: 'seg seg3 acc-filter', role: 'group', 'aria-label': 'Show readings' },
    [['all', 'All'], ['manual', 'Manual'], ['timegrapher', 'Timegrapher']].map(([v, l]) =>
      el('button', { type: 'button', class: 'seg-btn' + (filter === v ? ' active' : ''), onclick: () => { filter = v; render(); } }, l)));
  box.append(el('h3', { class: 'sub-title' }, 'Trend · seconds per day'), seg, trendGraph(w, filter), graphLegend());
  const hint = serviceHint(w, a);
  if (hint) box.append(hint);

  box.append(gradeBlock(w, st));
  const pr = positionRates(w);
  if (pr.length) {
    const adv = restingAdvice(pr);
    box.append(el('h3', { class: 'sub-title' }, 'Rate by position'),
      el('div', { class: 'pos-table' }, pr.map((r) => el('div', { class: 'pos-row' },
        el('span', {}, r.label), el('span', { class: 'pos-rate ' + rateClass(r.rate) }, fmtRate(r.rate)), el('span', { class: 'muted small' }, `${r.n}× · ${fmtDuration(r.days * DAY)}`)))),
      adv ? el('p', { class: 'advice' }, '💡 ', adv) : null);
  }

  box.append(el('button', { type: 'button', class: 'btn wide tg-open', onclick: () => { d.tgWatchId = w.id; store.save(); location.hash = 'tools/timegrapher'; } }, '🎙 Measure with the timegrapher'),
    el('p', { class: 'muted small' }, 'Timegrapher results are added to this history automatically.'));

  // One merged history
  const rows = (w.readings || []).filter((r) => filter === 'all' || r.source === filter).slice().sort((x, y) => y.timestamp - x.timestamp);
  const rateOf = new Map(st.runs.flatMap((run) => run.readings).map((r) => [r.id, r]));
  box.append(el('h3', { class: 'sub-title' }, `History — ${w.name}`));
  if (!rows.length) { box.append(el('p', { class: 'muted small' }, filter === 'all' ? 'No readings yet. Set the watch to zero, then come back every day or so and log how far it is out.' : 'No readings of this kind yet.')); return; }
  const list = el('div', { class: 'hist' });
  for (const r of rows.slice(0, 60)) {
    let main, sub;
    if (r.source === 'timegrapher') {
      const x = r.timegrapherData;
      main = `${fmtRate(x.rate)}`; sub = `beat error ${x.beatError} ms · ${Number(x.bph).toLocaleString('en-GB')} bph · ${x.confidence} confidence`;
    } else {
      const m = rateOf.get(r.id);
      main = `${fmtSecs(r.offsetSeconds)} `; sub = r.setToZero ? 'new baseline' : m && m.rate != null ? `${fmtRate(m.rate)} · ${signed(m.gain)} s in ${fmtDuration(m.elapsedMs)}` : '';
      if (r.position) sub += ` · ${posLabel(r.position)}`;
    }
    list.append(el('div', { class: 'hist-row' },
      el('div', { class: 'hist-main' },
        el('div', { class: 'hist-when' }, fmtDateTime(r.timestamp), r.source === 'manual' && r.synced === false ? el('span', { class: 'unsynced', title: 'Logged without network sync' }, ' ⚠︎') : null, ' ', sourceBadge(r)),
        el('div', { class: 'hist-off' }, main, r.source === 'manual' && r.offsetSeconds ? el('span', { class: 'muted small' }, fmtOffset(r.offsetSeconds)) : null),
        sub ? el('div', { class: 'hist-rate muted small' }, sub) : null),
      el('button', { type: 'button', class: 'icon-btn sm danger', 'aria-label': 'Delete reading', onclick: () => deleteReading(w, null, r.id) }, '×')));
  }
  box.append(list);
}

export function initTracker() {
  render();
  store.on('watches', render);
}
