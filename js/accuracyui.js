// Shared accuracy pieces: set-to-zero, logging a reading, source badges, the trend graph,
// the drift summary and the "due for service?" hint. Used on the Clock tab and each watch's page.
import * as store from './store.js';
import { now, clock, isFresh } from './time.js';
import { el, toast, signed, fmtDuration } from './ui.js';
import { watchStats, runsOf, tgReadings, fmtRate, fmtOffset } from './accuracy.js';
import { serviceInfo } from './model.js';

const DAY = 86400000;
const d = () => store.get();

export function rateClass(r) {
  if (r == null) return '';
  const { green, amber } = d().thresholds;
  const a = Math.abs(r);
  return a <= green ? 'good' : a <= amber ? 'mid' : 'badr';
}

const stamp = () => ({ timestamp: Math.round(now()), synced: !!clock.synced && isFresh(), acc: clock.accuracy });
export const fmtSecs = (o) => (o === 0 ? '0 s' : `${signed(o)} s`);

/** "Set to zero": the watch has just been set exactly; starts a fresh baseline. */
export function setToZero(w) {
  (w.readings ||= []).push({ id: store.uid(), ...stamp(), offsetSeconds: 0, source: 'manual', setToZero: true });
  store.save(); store.emit('watches');
  toast(`${w.name}: set to zero — a fresh baseline starts now`);
}

/** A manual accuracy check: how far the watch is out right now. */
export function logReading(w, offset, position) {
  const first = !(w.readings || []).some((r) => r.source === 'manual' && r.offsetSeconds != null);
  (w.readings ||= []).push({ id: store.uid(), ...stamp(), offsetSeconds: offset, source: 'manual',
    ...(position ? { position } : {}), ...(first ? { setToZero: true } : {}) });
  store.save(); store.emit('watches');
  toast(`Logged ${fmtSecs(offset)}${first ? ' — first reading, so this is the baseline' : ''}`);
}

export function deleteReading(w, id) {
  w.readings = (w.readings || []).filter((r) => r.id !== id);
  store.save(); store.emit('watches');
}

/** Small badge saying where a reading came from. */
export function sourceBadge(r) {
  if (r.source === 'timegrapher') return el('span', { class: 'src-badge tg', title: 'Measured with the timegrapher' }, '🎙 Timegrapher');
  if (r.setToZero) return el('span', { class: 'src-badge zero', title: 'Watch set to zero — a new baseline' }, '⓪ Set to zero');
  return el('span', { class: 'src-badge man', title: 'Entered by you' }, '✎ Manual');
}

/** Everything the summary, graph and history need. */
export function accuracyData(w) {
  const st = watchStats(w);
  const runs = runsOf(w);
  const lastZero = (w.readings || []).filter((r) => r.setToZero).sort((a, b) => b.timestamp - a.timestamp)[0] || null;
  const tg = tgReadings(w);
  // Rate points for the graph: each manual reading's rate since the one before, and each timegrapher rate.
  const points = [];
  for (const run of st.runs) for (const r of run.readings) if (r.rate != null) points.push({ t: r.t, rate: r.rate, src: 'manual', id: r.id });
  for (const r of tg) points.push({ t: r.timestamp, rate: r.timegrapherData.rate, src: 'timegrapher', id: r.id, be: r.timegrapherData.beatError });
  points.sort((a, b) => a.t - b.t);
  const latestTg = tg[tg.length - 1] || null;
  // Current drift: since the last set-to-zero (manual readings), else the latest timegrapher rate.
  let drift = st.runAvg, driftFrom = 'manual';
  if (drift == null && latestTg) { drift = latestTg.timegrapherData.rate; driftFrom = 'timegrapher'; }
  const last = (w.readings || []).slice().sort((a, b) => b.timestamp - a.timestamp)[0] || null;
  return { st, runs, lastZero, points, latestTg, drift, driftFrom, last };
}

/** "Due for service?" — from the rate, the beat error, a worsening trend and the service dates. */
export function serviceHint(w, a = accuracyData(w)) {
  const { amber } = d().thresholds;
  const reasons = [];
  const rate = a.st.overall ?? a.drift;
  if (rate != null && Math.abs(rate) > amber) reasons.push(`averaging ${fmtRate(rate)} (more than ±${amber} s/day)`);
  if (a.latestTg && a.latestTg.timegrapherData.beatError > 1.5) reasons.push(`beat error ${a.latestTg.timegrapherData.beatError} ms`);
  const recent = a.points.slice(-3).map((p) => Math.abs(p.rate));
  if (recent.length === 3 && recent[0] < recent[1] && recent[1] < recent[2] && recent[2] > amber / 2) reasons.push('getting less accurate with each reading');
  const s = serviceInfo(w);
  if (s.overdue) reasons.push('the service interval has passed');
  if (!reasons.length) {
    if (rate == null) return null;
    return el('div', { class: 'svc-hint ok' }, '✓ No sign it needs a service: running well within ±', String(amber), ' s/day.');
  }
  return el('div', { class: 'svc-hint warn' }, el('b', {}, 'Due for a service? '), `Possibly — ${reasons.join('; ')}. A watchmaker can regulate or service it.`);
}

/** Trend graph: rate (s/day) over time, manual readings as circles, timegrapher as diamonds. */
export function trendGraph(w, filter = 'all', { mini = false } = {}) {
  const a = accuracyData(w);
  const pts = a.points.filter((p) => filter === 'all' || p.src === filter);
  const W = 320, H = mini ? 90 : 150, padL = 30, padR = 8, padT = 8, padB = mini ? 8 : 18;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'trend' + (mini ? ' mini' : ''));
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', pts.length ? `Rate over time: ${pts.length} readings` : 'No readings yet');
  const add = (tag, attrs, text) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (text != null) n.textContent = text; svg.append(n); return n; };
  if (!pts.length) {
    add('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'trend-empty' }, 'Readings appear here');
    return svg;
  }
  const { green } = d().thresholds;
  const maxR = Math.max(green * 2, ...pts.map((p) => Math.abs(p.rate))) * 1.15;
  const t0 = Math.min(...pts.map((p) => p.t), ...(a.lastZero ? [a.lastZero.timestamp] : [])), t1 = Math.max(...pts.map((p) => p.t));
  const x = (t) => padL + (t1 > t0 ? ((t - t0) / (t1 - t0)) : 0.5) * (W - padL - padR);
  const y = (r) => padT + ((maxR - r) / (2 * maxR)) * (H - padT - padB);
  add('rect', { x: padL, y: y(green), width: W - padL - padR, height: y(-green) - y(green), class: 'trend-band' });
  add('line', { x1: padL, x2: W - padR, y1: y(0), y2: y(0), class: 'trend-zero' });
  if (!mini) {
    for (const v of [maxR / 1.15, -maxR / 1.15]) add('text', { x: padL - 4, y: y(v) + 3, 'text-anchor': 'end', class: 'trend-lbl' }, `${signed(Math.round(v))}`);
    add('text', { x: padL - 4, y: y(0) + 3, 'text-anchor': 'end', class: 'trend-lbl' }, '0');
    add('text', { x: padL, y: H - 4, class: 'trend-lbl' }, new Date(t0).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
    add('text', { x: W - padR, y: H - 4, 'text-anchor': 'end', class: 'trend-lbl' }, new Date(t1).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
  }
  // Set-to-zero moments as dashed lines.
  for (const r of (w.readings || []).filter((q) => q.setToZero && q.timestamp >= t0 && q.timestamp <= t1)) add('line', { x1: x(r.timestamp), x2: x(r.timestamp), y1: padT, y2: H - padB, class: 'trend-zero-ev' });
  // Line through manual points.
  const man = pts.filter((p) => p.src === 'manual');
  if (man.length > 1) add('polyline', { points: man.map((p) => `${x(p.t)},${y(p.rate)}`).join(' '), class: 'trend-line' });
  for (const p of pts) {
    const cx = x(p.t), cy = y(p.rate), cls = `trend-pt ${p.src} ${rateClass(p.rate)}`;
    const n = p.src === 'timegrapher'
      ? add('rect', { x: cx - 4, y: cy - 4, width: 8, height: 8, transform: `rotate(45 ${cx} ${cy})`, class: cls })
      : add('circle', { cx, cy, r: 4, class: cls });
    const tt = document.createElementNS(NS, 'title');
    tt.textContent = `${p.src === 'timegrapher' ? 'Timegrapher' : 'Manual'} · ${fmtRate(p.rate)} · ${new Date(p.t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
    n.append(tt);
  }
  return svg;
}

export const graphLegend = () => el('div', { class: 'trend-legend' },
  el('span', {}, el('i', { class: 'lg-dot' }), 'Manual'), el('span', {}, el('i', { class: 'lg-dia' }), 'Timegrapher'),
  el('span', {}, el('i', { class: 'lg-band' }), `Within ±${d().thresholds.green} s/day`), el('span', {}, el('i', { class: 'lg-zero' }), 'Set to zero'));

/** Compact card for a watch's page: drift, last reading + badge, mini graph, set-to-zero shortcut. */
export function accuracyCard(w, { onOpen } = {}) {
  const a = accuracyData(w);
  const box = el('div', { class: 'acc-card' });
  const days = a.lastZero ? (Date.now() - a.lastZero.timestamp) / DAY : null;
  box.append(
    el('div', { class: 'acc-top' },
      el('div', {}, el('div', { class: 'eyebrow' }, 'Current drift'),
        el('div', { class: 'acc-drift ' + rateClass(a.drift) }, a.drift != null ? fmtRate(a.drift) : '—'),
        el('div', { class: 'muted small' }, a.drift == null ? 'Log two readings, or run the timegrapher'
          : a.driftFrom === 'timegrapher' ? 'from the latest timegrapher reading' : `since set to zero ${days != null ? (days < 1 ? 'today' : `${Math.round(days)} days ago`) : ''}`)),
      a.last ? el('div', { class: 'acc-last' }, el('div', { class: 'eyebrow' }, 'Last reading'),
        el('div', {}, a.last.source === 'timegrapher' ? `${fmtRate(a.last.timegrapherData.rate)}` : fmtSecs(a.last.offsetSeconds)),
        el('div', { class: 'muted small' }, new Date(a.last.timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })), sourceBadge(a.last)) : null),
    trendGraph(w, 'all', { mini: true }),
    serviceHint(w, a),
    el('div', { class: 'acc-btns' },
      el('button', { type: 'button', class: 'btn sm', onclick: () => { setToZero(w); onOpen && onOpen('refresh'); } }, '⓪ Set to zero'),
      el('button', { type: 'button', class: 'btn sm', onclick: () => onOpen && onOpen('check') }, 'Accuracy check ›')));
  return box;
}

export { fmtOffset, fmtDuration };
