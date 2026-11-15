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

