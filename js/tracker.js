// Watch accuracy tracker (on the Clock tab).
import * as store from './store.js';
import { now, clock, isFresh } from './time.js';
import { el, confirmModal, toast, signed, fmtDuration, fmtDateTime } from './ui.js';
import { watchStats, fmtOffset, fmtRate, grade, fmtRange, POSITIONS, posLabel, positionRates, restingAdvice } from './accuracy.js';
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
  const ok = await confirmModal('Delete this mark?', 'Rates will be recalculated without it.', 'Delete', true);
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

export function render() {
  const box = root();
  box.innerHTML = '';
  const d = data();
  box.append(el('h2', { class: 'card-title' }, 'Watch accuracy'));

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
    onchange: (e) => { d.selectedWatchId = e.target.value; store.save(); render(); },
  }, owned.map((x) => el('option', { value: x.id, selected: x.id === w.id }, x.name)));
  box.append(el('div', { class: 'watch-bar' }, sel,
    el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'Add watch', title: 'Add watch', onclick: addWatch }, '+'),
    el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'Edit watch details', title: 'Edit details', onclick: () => editWatch(w) }, '✎'),
    el('button', { type: 'button', class: 'icon-btn sm danger', 'aria-label': 'Delete watch', title: 'Delete', onclick: () => deleteWatch(w) }, '🗑')));

  // Mark row: [+/-] [0..60 s] [Mark]
  const signSel = el('select', { class: 'input mark-sign', 'aria-label': 'Plus (fast) or minus (slow)' },
    el('option', { value: '1' }, '+'), el('option', { value: '-1' }, '\u2212'));
  const secSel = el('select', { class: 'input mark-secs', 'aria-label': 'Seconds' },
    Array.from({ length: 61 }, (_, i) => el('option', { value: String(i) }, `${i} s`)));
  const posSel = el('select', { class: 'input pos-select', 'aria-label': 'How the watch rested since the last mark' },
    el('option', { value: '' }, 'Position since last mark (optional)'),
    POSITIONS.map(([v, lab]) => el('option', { value: v }, lab)));
  box.append(
    el('div', { class: 'mark-row' }, signSel, secSel,
      el('button', { type: 'button', class: 'btn primary mark-btn', onclick: () => mark(w, Number(signSel.value), Number(secSel.value), posSel.value) }, 'Mark')),
    posSel,
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

  box.append(gradeBlock(w, st));
  const pr = positionRates(w);
  if (pr.length) {
    const adv = restingAdvice(pr);
    box.append(el('h3', { class: 'sub-title' }, 'Rate by position'),
      el('div', { class: 'pos-table' }, pr.map((r) => el('div', { class: 'pos-row' },
        el('span', {}, r.label), el('span', { class: 'pos-rate ' + rateClass(r.rate) }, fmtRate(r.rate)), el('span', { class: 'muted small' }, `${r.n}× · ${fmtDuration(r.days * DAY)}`)))),
      adv ? el('p', { class: 'advice' }, '💡 ', adv) : null);
  }

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
          el('div', { class: 'hist-rate muted small' }, rateTxt + (r.pos ? ` · ${posLabel(r.pos)}` : ''))),
        el('button', { type: 'button', class: 'icon-btn sm danger', 'aria-label': 'Delete mark', onclick: () => deleteReading(w, run.id, r.id) }, '\u00d7')));
    });
  });
  box.append(list);
}

export function initTracker() {
  render();
  store.on('watches', render);
}
