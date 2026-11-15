// Sleep tracking: a timer from bedtime to the alarm, and (optionally) listening through the night
// for snoring and restless sleep. Sound is analysed on the phone as it happens; nothing is recorded,
// stored or uploaded — only counts of sounds per 5 minutes are kept.
//
// How sounds are sorted (an estimate, not a medical test):
//   snore    – a mostly low-pitched sound (< 400 Hz) lasting 0.4–4 s that repeats with breathing
//              rhythm (every 2–12 s)
//   voice    – a loud mid-pitched sound (talking, crying out, shouting) lasting over 0.6 s —
//              can mean sleep talking, a bad dream or a night terror
//   movement – rustling and bumps (mostly high-pitched or broadband)
import * as store from './store.js';
import { el, openModal, pad } from './ui.js';

const BUCKET_MS = 5 * 60 * 1000;
const FRAME_MS = 100;
const S = () => (store.get().sleep ||= { current: null, history: [] });

let mic = null;   // { ctx, stream, an, timer, floor, ev, lastSnoreCand, ... }

export const sleeping = () => !!S().current;
export const listening = () => !!mic;

/** Start the sleep timer (and listening, if asked). Call from a tap. Returns an error message or ''. */
export async function startSleep(listen) {
  const s = S();
  if (!s.current) s.current = { start: Date.now(), listen: !!listen, buckets: [], voices: [] };
  s.current.listen = !!listen;
  store.save();
  if (listen) return startMic();
  return '';
}

function bucket(t) {
  const cur = S().current;
  const i = Math.floor((t - cur.start) / BUCKET_MS);
  while (cur.buckets.length <= i) cur.buckets.push([0, 0, 0]);   // [snores, movements, voices]
  return cur.buckets[i];
}

/* ---------- Microphone ---------- */
const MIC_ERRORS = {
  NotAllowedError: 'Microphone permission was declined, so only the sleep timer is running. On iPhone: Settings → Apps → Safari → Microphone → Allow.',
  SecurityError: 'Microphone permission was declined, so only the sleep timer is running.',
  NotFoundError: 'No microphone was found, so only the sleep timer is running.',
  NotReadableError: 'The microphone is busy (a call or another app?), so only the sleep timer is running.',
};

async function startMic() {
  if (mic) return '';
  if (!navigator.mediaDevices?.getUserMedia) return 'This browser can’t use the microphone here, so only the sleep timer is running.';
  try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch (e) { /* older iOS */ }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
      .catch(() => navigator.mediaDevices.getUserMedia({ audio: true }));
  } catch (e) {
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (x) { /* ignore */ }
    return MIC_ERRORS[e.name] || 'Could not use the microphone, so only the sleep timer is running.';
  }
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const src = ctx.createMediaStreamSource(stream);
  const an = ctx.createAnalyser();
  an.fftSize = 2048; an.smoothingTimeConstant = 0;
  src.connect(an);
  await ctx.resume().catch(() => {});
  const bin = ctx.sampleRate / an.fftSize;
  mic = {
    ctx, stream, an, floor: null, ev: null, lastSnoreCand: 0, quietFrames: 0,
    spec: new Float32Array(an.frequencyBinCount), wave: new Float32Array(an.fftSize),
    lo: [Math.round(60 / bin), Math.round(400 / bin)], mid: [Math.round(400 / bin), Math.round(2000 / bin)], hi: [Math.round(2000 / bin), Math.round(7000 / bin)],
  };
  mic.timer = setInterval(frame, FRAME_MS);
  return '';
}

/** Stop listening (before the alarm plays, so the iPhone speaker works normally again). */
export function stopMic() {
  if (!mic) return;
  clearInterval(mic.timer);
  mic.stream.getTracks().forEach((t) => t.stop());
  mic.ctx.close().catch(() => {});
  mic = null;
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* older iOS */ }
  store.save();
}

const sumPow = (spec, [a, b]) => { let s = 0; for (let i = a; i < b; i++) s += Math.pow(10, spec[i] / 10); return s; };

function frame() {
  const cur = S().current;
  if (!cur || !mic) return;
  const { an, spec, wave } = mic;
  an.getFloatTimeDomainData(wave);
  let e = 0; for (let i = 0; i < wave.length; i++) e += wave[i] * wave[i];
  const db = 10 * Math.log10(e / wave.length + 1e-12);
  // Background level: follows quiet moments quickly, creeps up slowly (fans, traffic).
  if (mic.floor == null) mic.floor = db;
  else if (db < mic.floor) mic.floor = mic.floor * 0.7 + db * 0.3;
  else mic.floor += 0.004;
  const t = Date.now();
  if (!mic.saved || t - mic.saved > 60000) { mic.saved = t; store.save(); }   // keep the night safe if the app reloads
  const loud = db > mic.floor + 9 && db > -70;
  if (loud) {
    an.getFloatFrequencyData(spec);
    if (!mic.ev) mic.ev = { start: t, peak: db, lo: 0, mid: 0, hi: 0 };
    const ev = mic.ev;
    ev.peak = Math.max(ev.peak, db);
    ev.lo += sumPow(spec, mic.lo); ev.mid += sumPow(spec, mic.mid); ev.hi += sumPow(spec, mic.hi);
    mic.quietFrames = 0;
    if (t - ev.start > 8000) endEvent(t);    // very long sounds: close and start again
  } else if (mic.ev && ++mic.quietFrames >= 4) endEvent(t);
}

function endEvent(t) {
  const ev = mic.ev; mic.ev = null; mic.quietFrames = 0;
  const dur = (t - ev.start) / 1000;
  if (dur < 0.25) return;                         // clicks and ticks
  const tot = ev.lo + ev.mid + ev.hi || 1;
  const lo = ev.lo / tot, mid = ev.mid / tot;
  const b = bucket(ev.start);
  if (lo >= 0.55 && dur >= 0.4 && dur <= 4) {
    const gap = (ev.start - mic.lastSnoreCand) / 1000;
    mic.lastSnoreCand = ev.start;
    if (gap >= 2 && gap <= 12) b[0]++;           // repeating with breathing rhythm
    else b[1]++;
  } else if (mid >= 0.5 && dur >= 0.6 && ev.peak > mic.floor + 15) {
    b[2]++;
    const v = S().current.voices;
    if (v.length < 50) v.push(ev.start);
  } else b[1]++;
}

/* ---------- Summary ---------- */
const hhmm = (t) => { const x = new Date(t); return `${pad(x.getHours())}:${pad(x.getMinutes())}`; };
const dur = (ms) => { const m = Math.round(ms / 60000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${pad(m % 60)} min`; };

function summarise(cur, end) {
  const B = cur.buckets;
  // Estimated sleep onset: the start of the first 20 quiet minutes (≤ 2 movements per 5 min).
  let onset = cur.start;
  if (cur.listen) {
    for (let i = 0; i + 3 < B.length; i++) {
      if ([0, 1, 2, 3].every((k) => (B[i + k]?.[1] || 0) + (B[i + k]?.[2] || 0) <= 2)) { onset = cur.start + i * BUCKET_MS; break; }
    }
  }
  const snoreBuckets = B.map((b, i) => (b[0] >= 3 ? i : -1)).filter((i) => i >= 0);
  const restBuckets = B.map((b, i) => (b[1] >= 8 || b[2] >= 2 ? i : -1)).filter((i) => i >= 0);
  return {
    start: cur.start, end, onset: Math.min(onset, end), listen: cur.listen,
    snores: B.reduce((s, b) => s + b[0], 0), snoreMin: snoreBuckets.length * 5,
    snoreFrom: snoreBuckets.length ? cur.start + snoreBuckets[0] * BUCKET_MS : null,
    snoreTo: snoreBuckets.length ? cur.start + (snoreBuckets[snoreBuckets.length - 1] + 1) * BUCKET_MS : null,
    moves: B.reduce((s, b) => s + b[1], 0), voices: cur.voices.slice(0, 20),
    restMin: restBuckets.length * 5, restAt: restBuckets.slice(0, 12).map((i) => cur.start + i * BUCKET_MS),
    buckets: B,
  };
}

/** End the night: saves and shows the summary. */
export function endSleep({ show = true } = {}) {
  const s = S();
  const cur = s.current;
  stopMic();
  if (!cur) return null;
  s.current = null;
  const end = Date.now();
  const sum = summarise(cur, end);
  // Under 10 minutes is a test, not a night: show it, but keep it out of the history.
  if (end - cur.start < 10 * 60000) sum.short = true;
  else s.history = [sum, ...(s.history || [])].slice(0, 30);
  store.save();
  if (show) showSummary(sum);
  return sum;
}

export const lastNight = () => S().history?.[0] || null;
export const history = () => S().history || [];

function timeline(sum) {
  const B = sum.buckets;
  if (!sum.listen || !B.length) return null;
  const max = Math.max(4, ...B.map((b) => b[0] + b[1] + b[2]));
  return el('div', { class: 'sl-chart' },
    el('div', { class: 'sl-bars' }, B.map((b) => {
      const h = (n) => `${Math.round((n / max) * 100)}%`;
      return el('div', { class: 'sl-col' },
        el('i', { class: 'sl-v', style: `height:${h(b[2])}` }), el('i', { class: 'sl-m', style: `height:${h(b[1])}` }), el('i', { class: 'sl-s', style: `height:${h(b[0])}` }));
    })),
    el('div', { class: 'sl-axis muted small' }, el('span', {}, hhmm(sum.start)), el('span', {}, hhmm(sum.end))),
    el('div', { class: 'sl-key small' }, el('span', {}, el('i', { class: 'sl-s' }), 'Snoring'), el('span', {}, el('i', { class: 'sl-m' }), 'Movement'), el('span', {}, el('i', { class: 'sl-v' }), 'Voice / crying out')));
}

export function summaryBody(sum) {
  const inBed = sum.end - sum.start, asleep = sum.end - sum.onset;
  const rows = [
    sum.short ? el('div', { class: 'notice small' }, `A short test (${dur(inBed)}) — not saved to your sleep history.`) : null,
    el('div', { class: 'sl-big' }, el('div', { class: 'sl-num' }, dur(sum.listen ? asleep : inBed)), el('div', { class: 'muted small' }, sum.listen ? 'estimated sleep' : 'sleep time (bedtime to alarm)')),
    el('p', { class: 'small center' }, `Bedtime ${hhmm(sum.start)} → woke ${hhmm(sum.end)} · in bed ${dur(inBed)}`,
      sum.listen && sum.onset > sum.start + 60000 ? ` · probably asleep from about ${hhmm(sum.onset)}` : ''),
  ];
  if (sum.listen) {
    rows.push(el('div', { class: 'sl-cards' },
      el('div', { class: 'sl-card ' + (sum.snoreMin ? 'warn' : 'ok') }, el('div', { class: 'sl-h' }, '😴 Snoring'),
        el('div', {}, sum.snoreMin ? `Detected — about ${sum.snoreMin} min${sum.snoreFrom ? `, mostly ${hhmm(sum.snoreFrom)}–${hhmm(sum.snoreTo)}` : ''}` : sum.snores ? 'A little, now and then' : 'None detected')),
      el('div', { class: 'sl-card ' + (sum.restMin ? 'warn' : 'ok') }, el('div', { class: 'sl-h' }, '🌀 Restless sleep'),
        el('div', {}, sum.restMin ? `Restless for about ${sum.restMin} min (from ${sum.restAt.slice(0, 4).map(hhmm).join(', ')}${sum.restAt.length > 4 ? '…' : ''})` : 'Settled night — little movement')),
      el('div', { class: 'sl-card ' + (sum.voices.length ? 'bad' : 'ok') }, el('div', { class: 'sl-h' }, '🗣️ Talking or crying out'),
        el('div', {}, sum.voices.length ? `${sum.voices.length} time${sum.voices.length > 1 ? 's' : ''} (${sum.voices.slice(0, 5).map(hhmm).join(', ')}) — could be sleep talking, a bad dream or a night terror, or another noise in the room` : 'None heard'))),
    timeline(sum),
    el('p', { class: 'muted small' }, 'An estimate from sounds only — not a medical test. Partners, pets and street noise can be counted too. If you snore loudly most nights, or someone notices you stop breathing or gasp in your sleep, talk to your GP (it can be a sign of sleep apnoea). Frequent night terrors or nightmares are also worth mentioning to a doctor.'));
  } else rows.push(el('p', { class: 'muted small' }, 'Turn on “Listen for snoring and restless sleep” at bedtime to get a snoring and restlessness summary.'));
  return rows;
}

export function showSummary(sum) {
  openModal({ title: 'Good morning ☀️ — your night', className: 'tall', content: summaryBody(sum), actions: [{ label: 'Done', kind: 'primary' }] });
}

/** Live line for the bedside screen. */
export function bedsideLine() {
  const cur = S().current;
  if (!cur) return '';
  return `💤 ${dur(Date.now() - cur.start)} since bedtime${mic ? ' · 🎙️ listening' : cur.listen ? ' · microphone off' : ''}`;
}
