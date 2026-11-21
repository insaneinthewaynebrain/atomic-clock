// Accuracy maths shared by the Clock tracker, Collection and share cards.
import { signed, pad } from './ui.js';

const DAY = 86400000;

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

/**
 * Measuring runs from the watch's readings: a run starts at each "set to zero" (or the first manual reading)
 * and collects the manual readings after it. Timegrapher readings carry a rate, not an offset, so they
 * aren't part of runs (see tgReadings).
 */
export function runsOf(w) {
  const runs = [];
  let cur = null;
  for (const r of (w.readings || []).slice().sort((a, b) => a.timestamp - b.timestamp)) {
    if (r.source !== 'manual' || r.offsetSeconds == null) continue;
    if (r.setToZero || !cur) { cur = { id: r.id, readings: [] }; runs.push(cur); }
    cur.readings.push({ id: r.id, t: r.timestamp, offset: r.offsetSeconds, pos: r.position, synced: r.synced, setToZero: !!r.setToZero });
  }
  return runs;
}
export const tgReadings = (w) => (w.readings || []).filter((r) => r.source === 'timegrapher' && r.timegrapherData).sort((a, b) => a.timestamp - b.timestamp);

/** Per-watch summary. Overall average is weighted by elapsed time across runs. */
export function watchStats(w) {
  const runs = runsOf(w).filter((r) => r.readings.length).map(computeRun)
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


/* ---------- Standards (Stage 3) ----------
   Figures are average daily rates in seconds/day. Certification tests are done in a lab
   (several positions/temperatures); this app measures real-world wear, so grades are a guide. */
export const STANDARDS = [
  { id: 'rolex', name: 'Rolex Superlative Chronometer', min: -2, max: 2, src: 'Rolex — tested after casing' },
  { id: 'gs-special', name: 'Grand Seiko Special', min: -2, max: 4, src: 'Grand Seiko — 6 positions, 3 temperatures' },
  { id: 'metas', name: 'METAS Master Chronometer', min: 0, max: 5, src: 'METAS (Omega, Tudor and others) — cased watch' },
  { id: 'gs', name: 'Grand Seiko mechanical', min: -3, max: 5, src: 'Grand Seiko 9S standard — 6 positions' },
  { id: 'cosc', name: 'COSC chronometer', min: -4, max: 6, src: 'COSC — uncased movement, average daily rate' },
];

// Manufacturer accuracy specs for common movements (matched against the calibre / movement type).
export const MOVEMENT_SPECS = [
  { re: /\bNH3\d|\bNH7\d|\b4R3\d|\b4R\d\d|\b4R\b/i, name: 'Seiko NH3x / 4R', min: -35, max: 45, src: 'Seiko 4R35/4R36 spec (NH35A: −20/+40)', nh: { re: /\bNH\d\d/i, min: -20, max: 40, name: 'Seiko NH35/NH36', src: 'Seiko Instruments NH35A spec' } },
  { re: /\b6R\d\d|\b6R\b/i, name: 'Seiko 6R', min: -15, max: 25, src: 'Seiko 6R15/6R35 spec' },
  { re: /\b7S\d\d/i, name: 'Seiko 7S', min: -20, max: 40, src: 'Seiko 7S26/7S36 spec' },
  { re: /\b28(24|36|92|93|95)\b|\b2824/i, name: 'ETA 2824-2 (standard grade)', min: -12, max: 12, src: 'ETA standard grade (Elaboré ±7, Top ±4)' },
  { re: /\bSW ?2\d\d|\bSW ?3\d\d|\bSellita/i, name: 'Sellita SW200 (standard grade)', min: -12, max: 12, src: 'Sellita standard grade (Elaboré ±7, Top ±4)' },
  { re: /\b90\d\d\b|\b9015|\b9039/i, name: 'Miyota 9000 series', min: -10, max: 30, src: 'Miyota 9015 spec' },
  { re: /\b82\d\d\b|\b8215/i, name: 'Miyota 8200 series', min: -20, max: 40, src: 'Miyota 8215 spec' },
];
const QUARTZ = { name: 'Typical quartz (±15 s/month)', min: -0.5, max: 0.5, src: 'Typical quartz spec ±15 s/month' };
const SPRING_DRIVE = { name: 'Spring Drive (±15 s/month)', min: -0.5, max: 0.5, src: 'Grand Seiko Spring Drive spec ±1 s/day (±15 s/month)' };

export function movementSpec(w) {
  if (w.movement === 'quartz' || w.movement === 'solar') return QUARTZ;
  if (w.movement === 'springdrive') return SPRING_DRIVE;
  const cal = String(w.calibre || '');
  if (!cal) return null;
  for (const s of MOVEMENT_SPECS) {
    if (s.nh && s.nh.re.test(cal)) return s.nh;
    if (s.re.test(cal)) return s;
  }
  return null;
}

const MIN_DAYS = 1;   // need at least a day of tracking before grading

/** Grade a watch's average rate. */
export function grade(w, st = watchStats(w)) {
  const r = st.overall;
  if (r == null || st.overallDays < MIN_DAYS) return { ready: false, rate: r };
  const pass = (s) => r >= s.min - 0.05 && r <= s.max + 0.05;
  const mech = !['quartz', 'solar', 'springdrive'].includes(w.movement);
  const stds = mech ? STANDARDS.map((s) => ({ ...s, pass: pass(s) })) : [];
  const spec = movementSpec(w);
  const specRes = spec ? { ...spec, pass: pass(spec) } : null;
  const best = stds.find((s) => s.pass);
  let headline, level;
  if (best) { headline = `Meets ${best.name} spec`; level = 'good'; }
  else if (specRes && specRes.pass) { headline = `Within ${specRes.name} spec`; level = 'mid'; }
  else if (specRes) { headline = `Outside ${specRes.name} spec`; level = 'badr'; }
  else if (mech) { headline = 'Outside chronometer specs'; level = Math.abs(r) <= 15 ? 'mid' : 'badr'; }
  else { headline = 'No standard for this movement'; level = ''; }
  return { ready: true, rate: r, days: st.overallDays, stds, spec: specRes, headline, level, best };
}

export const fmtRange = (s) => `${s.min > 0 ? '+' : s.min < 0 ? '−' : ''}${Math.abs(s.min)} / ${s.max > 0 ? '+' : ''}${s.max} s/day`;

/* ---------- Position testing ---------- */
export const POSITIONS = [
  ['wrist', 'On the wrist'], ['dialup', 'Dial up'], ['dialdown', 'Dial down'],
  ['crownup', 'Crown up'], ['crowndown', 'Crown down'], ['crownleft', 'Crown left'],
];
export const posLabel = (p) => (POSITIONS.find((x) => x[0] === p) || [null, ''])[1];

/** Time-weighted rate for each position (from intervals that ended with a mark tagged with that position). */
export function positionRates(w) {
  const agg = {};
  for (const run of watchStats(w).runs) {
    for (const r of run.readings) {
      if (!r.pos || r.rate == null || !r.elapsedMs) continue;
      const a = (agg[r.pos] ||= { gain: 0, days: 0, n: 0 });
      a.gain += r.gain; a.days += r.elapsedMs / DAY; a.n++;
    }
  }
  return POSITIONS.filter(([k]) => agg[k]).map(([k, label]) => ({ pos: k, label, rate: agg[k].gain / agg[k].days, days: agg[k].days, n: agg[k].n }));
}

/** Suggest the best overnight resting position (assumes ~16 h on the wrist, ~8 h resting). */
export function restingAdvice(rates) {
  const wrist = rates.find((r) => r.pos === 'wrist');
  const rest = rates.filter((r) => r.pos !== 'wrist');
  if (!rest.length) return null;
  if (wrist) {
    const best = rest.map((r) => ({ ...r, net: (wrist.rate * 16 + r.rate * 8) / 24 })).sort((a, b) => Math.abs(a.net) - Math.abs(b.net))[0];
    return `Rest it ${best.label.toLowerCase()} overnight: with daytime wear it should average about ${signed(best.net, 1)} s/day.`;
  }
  const best = [...rest].sort((a, b) => Math.abs(a.rate) - Math.abs(b.rate))[0];
  return `${best.label} is its most accurate resting position (${signed(best.rate, 1)} s/day).`;
}
