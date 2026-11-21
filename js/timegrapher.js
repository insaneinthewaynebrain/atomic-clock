// Experimental timegrapher: listens to the watch through the phone microphone,
// detects ticks and estimates rate (s/day) and beat error (ms).
// The screen is a 4-step guide; the measurement itself runs full screen
// (10-second countdown → 2-minute live reading → summary).
import * as store from './store.js';
import { el, toast, signed } from './ui.js';
import { ownedWatches, getWatch, detailExtras } from './collection.js';
import { openModal, confirmModal } from './ui.js';

const STD_BPH = [18000, 19800, 21600, 25200, 28800, 36000];

/* ---------- Visiting watches: timed here but not in the Watch Box (e.g. a friend's) ---------- */
const visitors = () => (store.get().visitors ||= []);
/** A Watch Box watch or a visiting watch, by id. */
const tgWatch = (id) => getWatch(id) || visitors().find((v) => v.id === id) || null;
const watchLabel = (w) => (w.visiting ? `${w.name}${w.owner ? ` (${w.owner})` : ''}` : w.name);
/** <option>s for every watch you can time, grouped, with "Add a visiting watch…" at the end. */
function watchOptions(selected) {
  const owned = ownedWatches(), vis = visitors();
  return [
    owned.length ? el('optgroup', { label: 'Watch Box' }, owned.map((w) => el('option', { value: w.id, selected: w.id === selected }, w.name))) : null,
    vis.length ? el('optgroup', { label: 'Visiting watches' }, vis.map((w) => el('option', { value: w.id, selected: w.id === selected }, w.name))) : null,
    el('option', { value: '__visit' }, '＋ Add a visiting watch…'),
  ];
}

function addVisitor(onDone) {
  const nameIn = el('input', { class: 'input', type: 'text', placeholder: 'e.g. Tom’s Speedmaster', autocapitalize: 'words' });
  const ownerIn = el('input', { class: 'input', type: 'text', placeholder: 'Whose is it? (optional)', autocapitalize: 'words' });
  const bphSel = el('select', { class: 'input' }, el('option', { value: '' }, 'Not sure — detect it'),
    STD_BPH.map((b) => el('option', { value: String(b) }, `${b.toLocaleString('en-GB')} bph`)), el('option', { value: 'other' }, 'Other…'));
  const otherIn = el('input', { class: 'input', type: 'text', inputmode: 'numeric', placeholder: 'Beats per hour, e.g. 14400', hidden: true });
  bphSel.addEventListener('change', () => { otherIn.hidden = bphSel.value !== 'other'; if (!otherIn.hidden) otherIn.focus(); });
  let made = null;
  openModal({
    title: 'Add a visiting watch',
    content: [el('p', { class: 'muted small' }, 'For timing a watch that isn’t in your Watch Box — a friend’s, or one you’re thinking of buying. Its results are kept here, separate from your collection.'),
      el('label', { class: 'field' }, el('span', {}, 'Name'), nameIn), el('label', { class: 'field' }, el('span', {}, 'Owner'), ownerIn),
      el('label', { class: 'field' }, el('span', {}, 'Beat rate'), bphSel, otherIn)],
    actions: [{ label: 'Cancel' }, { label: 'Add', kind: 'primary', onClick: () => {
      const name = nameIn.value.trim();
      if (!name) { toast('Give it a name'); nameIn.focus(); return false; }
      const bph = bphSel.value === 'other' ? Math.round(Number(otherIn.value.replace(/[^\d.]/g, ''))) : Number(bphSel.value) || null;
      if (bphSel.value === 'other' && !(bph >= 3600 && bph <= 72000)) { toast('Beat rate should be between 3,600 and 72,000'); otherIn.focus(); return false; }
      made = { id: 'v' + store.uid(), visiting: true, name, owner: ownerIn.value.trim() || null, bph, added: Date.now(), timegrapher: [] };
      visitors().push(made); store.save();
    } }],
    onClose: () => onDone(made),
  });
  setTimeout(() => nameIn.focus(), 60);
}

/** Puts a beat rate into the picker, adding a custom option if it isn't a standard one. */
function setBph(sel, bph) {
  if (!bph) return;
  const v = String(bph);
  if (![...sel.options].some((o) => o.value === v)) sel.append(el('option', { value: v }, `${Number(bph).toLocaleString('en-GB')} bph`));
  bphChoice = v; sel.value = v;
}
const WINDOW_S = 20;          // per-band tick history (used to choose the band)
const LIVE_WINDOW_S = 60;     // live numbers use the last minute
const MIN_S = 6;              // need at least this much before showing a result
const BASELINE_S = 30;        // background measurement length
const COUNTDOWN_S = 10;       // time to put the phone down and walk away
const MEASURE_S = 120;        // measurement length
const $ = (id) => document.getElementById(id);

let ctx = null, stream = null, node = null;
// mode: 'off' (mic closed) | 'baseline' | 'paused' | 'countdown' | 'listening'
let mode = 'off';
let runTicks = [];            // every tick from the chosen band during this measurement
let startT = 0, listenFrom = 0, selectAt = 0, lastResult = null, bphChoice = 'auto', curBph = null;
let baseline = null;          // { at, bands: [{ median, p95, p99 }], db, spikes, room }
let baseUntil = 0, baseStarted = 0, baseLevels = [], countdownTimer = null;
let chosen = null, selectInfo = null;
let sampleRate = 48000, level = 0;
let wizStep = 1, skipped = false;
let rafId = 0, lastAnalyse = 0, lastDraw = 0, lastTickSeen = 0, wake = null;
let finalInfo = null;         // { r, at, watchId, bph, seconds, beats, signal, baseline }

/* ---------- Signal processing ----------
   Five band-pass filters cover where watch ticks usually stand out. During the background
   measurement each band's loudness is recorded; while listening, a sound only counts as a tick
   if it is clearly louder than that band's loudest background noise. After a few seconds the
   band where the watch stands out most is chosen. */
const BAND_HZ = [2500, 4000, 6000, 9000, 13000];
const DECIM = 16;             // keep every 16th envelope value for statistics

function makeBand(f0, sr) {
  const w0 = 2 * Math.PI * Math.min(f0, sr * 0.45) / sr, q = 1.2;
  const alpha = Math.sin(w0) / (2 * q), a0 = 1 + alpha;
  return {
    f0, b0: alpha / a0, b2: -alpha / a0, a1: (-2 * Math.cos(w0)) / a0, a2: (1 - alpha) / a0,
    x1: 0, x2: 0, y1: 0, y2: 0, env: 0, noise: 1e-4, peak: 1e-3, armed: true, lastTick: -1,
    ticks: [], stats: [], gate: 0,
  };
}
let bands = [];

function quantile(arr, q) {
  if (!arr.length) return 0;
  const a = Float32Array.from(arr).sort();
  return a[Math.min(a.length - 1, Math.floor(q * a.length))];
}
const median = (arr) => { const a = arr.slice().sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };

function bandPeriod(b) {
  const bph = bphChoice === 'auto' ? estimateBph(b.ticks) : Number(bphChoice);
  return bph ? 3600 / bph : 0.1;
}

function processBlock(start, data, sr) {
  // Microphone level for the meters (works in every mode while the mic is open).
  let pk = 0;
  for (let i = 0; i < data.length; i += 4) { const a = Math.abs(data[i]); if (a > pk) pk = a; }
  level = Math.max(pk, level * 0.85);
  if (mode === 'baseline') baseLevels.push(pk);
  if (mode !== 'baseline' && mode !== 'listening') return;
  const attack = 1 - Math.exp(-1 / (sr * 0.0002));
  const release = 1 - Math.exp(-1 / (sr * 0.004));
  const noiseK = 1 - Math.exp(-1 / (sr * 1.5));
  const peakDecay = Math.exp(-1 / (sr * 3));
  const active = mode === 'listening' && chosen ? [chosen] : bands;
  for (const b of active) {
    const refractory = bandPeriod(b) * 0.55;
    let { x1, x2, y1, y2, env, noise, peak, armed, lastTick } = b;
    for (let i = 0; i < data.length; i++) {
      const x = data[i];
      const y = b.b0 * x + b.b2 * x2 - b.a1 * y1 - b.a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      const a = Math.abs(y);
      env += (a > env ? attack : release) * (a - env);
      const t = (start + i) / sr;
      if (mode === 'baseline') { if (i % DECIM === 0) b.stats.push(env); continue; }
      if (t < listenFrom) continue;
      if (env < noise * 3) noise += noiseK * (env - noise);
      peak = Math.max(peak * peakDecay, env);
      if (!chosen && i % DECIM === 0) b.stats.push(env);
      const thr = Math.max(noise + 0.35 * (peak - noise), b.gate);
      if (armed && env > thr && env > noise * 4 && t - lastTick > refractory) {
        b.ticks.push(t); lastTick = t; armed = false;
        if (b === chosen) runTicks.push(t);
      } else if (!armed && env < noise + 0.15 * (peak - noise)) armed = true;
    }
    Object.assign(b, { x1, x2, y1, y2, env, noise, peak, armed, lastTick });
    const cutoff = (start + data.length) / sr - WINDOW_S;
    while (b.ticks.length && b.ticks[0] < cutoff) b.ticks.shift();
  }
  const t = (start + data.length) / sr;
  if (mode === 'baseline' && t >= baseUntil) finishBaseline();
  if (mode === 'listening' && !chosen && t >= selectAt) chooseBand();
}

const toDb = (v) => 20 * Math.log10(Math.max(v, 1e-6));

function finishBaseline() {
  const med = quantile(baseLevels, 0.5);
  const spikes = baseLevels.length ? baseLevels.filter((v) => v > med * 4).length / baseLevels.length : 0;
  const db = toDb(med);
  const room = db < -55 && spikes < 0.03 ? 'quiet' : db < -40 && spikes < 0.08 ? 'ok' : 'noisy';
  baseline = {
    at: Date.now(), db, spikes, room,
    bands: bands.map((b) => ({ median: quantile(b.stats, 0.5), p95: quantile(b.stats, 0.95), p99: quantile(b.stats, 0.99) })),
  };
  bands.forEach((b) => { b.stats = []; });
  baseLevels = [];
  mode = 'paused';
  skipped = false;
  wizStep = 2;
  renderWizard();
}

// Pick the band where the sounds keep the steadiest beat (the watch); loudness breaks ties.
function chooseBand() {
  let best = null;
  bands.forEach((b, i) => {
    const loud = quantile(b.stats, 0.99);
    const ref = baseline ? Math.max(baseline.bands[i].p95, 1e-7) : Math.max(quantile(b.stats, 0.5), 1e-7);
    const ratio = loud / ref;
    const bph = bphChoice === 'auto' ? estimateBph(b.ticks) : Number(bphChoice);
    const r = bph ? analyse(b.ticks, bph) : null;
    const rhythm = r ? Math.min(1, r.found) * Math.max(0, 1 - r.jitterMs / 1.5) : 0;
    const score = rhythm * 10 + Math.min(ratio, 20) / 20;
    if (!best || score > best.score) best = { b, score, ratio, rhythm };
  });
  chosen = best.b;
  selectInfo = { hz: chosen.f0, ratio: best.ratio, rhythm: best.rhythm };
  bands.forEach((b) => { b.stats = []; });
  runTicks = chosen.ticks.slice();
}

function estimateBph(ts) {
  if (ts.length < 6) return null;
  const iv = [];
  for (let i = 1; i < ts.length; i++) iv.push(ts[i] - ts[i - 1]);
  iv.sort((a, b) => a - b);
  const med = iv[Math.floor(iv.length / 2)];
  const est = 3600 / med;
  return STD_BPH.reduce((a, b) => (Math.abs(b - est) < Math.abs(a - est) ? b : a));
}

/* Give every sound a beat number, following the watch's beat as it drifts. Counting from
   the first sound alone goes wrong over long runs (a watch 60 s/day out drifts by more than half
   a beat in two minutes), so the reference follows the recent on-beat sounds instead. */
function assignBeats(ts, T) {
  if (!ts.length) return [];
  const t0 = ts[0], out = [], recent = [];
  const tol = Math.max(0.003, T * 0.04);
  let ref = 0, misses = 0;
  for (const t of ts) {
    const x = t - t0;
    const n = Math.round((x - ref) / T);
    const off = x - n * T;
    if (Math.abs(off - ref) < tol) {
      recent.push(off); if (recent.length > 7) recent.shift();
      ref = median(recent); misses = 0;
    } else if (++misses > 20) { ref = off; recent.length = 0; recent.push(off); misses = 0; }
    out.push([n, t]);
  }
  return out;
}

/** Fit ticks to an ideal beat train: returns rate (s/day), beat error (ms) and quality. */
export function analyse(ts, bph) {
  if (!bph || ts.length < 8) return null;
  const T = 3600 / bph;
  // Linear fit with a separate offset for even/odd beats (tick vs tock).
  const fit = (rows) => {
    let sn = 0, st = 0, snn = 0, snt = 0, sp = 0, spp = 0, spn = 0, spt = 0;
    const m = rows.length;
    for (const [n, t] of rows) { const p = n & 1; sn += n; st += t; snn += n * n; snt += n * t; sp += p; spp += p * p; spn += p * n; spt += p * t; }
    // Solve normal equations for t = a + b*n + c*p (3x3)
    const A = [[m, sn, sp], [sn, snn, spn], [sp, spn, spp]], B = [st, snt, spt];
    const det = (M) => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
    const D = det(A);
    if (Math.abs(D) < 1e-12) return null;
    const col = (k) => A.map((r, i) => r.map((v, j) => (j === k ? B[i] : v)));
    return { a: det(col(0)) / D, b: det(col(1)) / D, c: det(col(2)) / D };
  };
  // Room noises land at random places; the watch lands on the beat.
  let pts = assignBeats(ts, T);
  let f = { a: ts[0], b: T, c: 0 };
  for (let pass = 0; pass < 3; pass++) {
    const res = (n, t) => t - (f.a + f.b * n + f.c * (n & 1));
    // Keep the sound closest to the beat for each beat number…
    const best = new Map();
    for (const [n, t] of pts) { const r = Math.abs(res(n, t)); if (!best.has(n) || r < best.get(n)[0]) best.set(n, [r, t]); }
    let rows = [...best.entries()].map(([n, [, t]]) => [n, t]);
    // …and drop sounds well off the beat (after the first rough pass).
    if (pass > 0) {
      const abs = rows.map(([n, t]) => Math.abs(res(n, t))).sort((x, y) => x - y);
      const mad = abs[Math.floor(abs.length / 2)] || 0;
      const lim = Math.max(0.0006, mad * 4);
      rows = rows.filter(([n, t]) => Math.abs(res(n, t)) <= lim);
    }
    if (rows.length < 8) return null;
    const nf = fit(rows);
    if (!nf) return null;
    f = nf;
    if (pass === 2) pts = rows;
  }
  pts.sort((x, y) => x[0] - y[0]);
  const resid = pts.map(([n, t]) => t - (f.a + f.b * n + f.c * (n & 1)));
  const sd = Math.sqrt(resid.reduce((s2, r) => s2 + r * r, 0) / resid.length);
  const span = pts[pts.length - 1][0] - pts[0][0] + 1;
  const found = pts.length / span;
  const rate = (T / f.b - 1) * 86400;
  const beatError = Math.abs(f.c) * 1000;
  // Confidence: share of beats heard and how steady they are.
  const steady = Math.max(0, 1 - sd / 0.0015);
  const score = Math.min(1, found) * steady;
  const confidence = score > 0.7 ? 'High' : score > 0.4 ? 'Medium' : 'Low';
  return { rate, beatError, bph, found, jitterMs: sd * 1000, confidence, score, seconds: ts[ts.length - 1] - ts[0] };
}

/* ---------- Audio ---------- */
function setSession(type) {
  try { if (navigator.audioSession) navigator.audioSession.type = type; } catch (e) { /* older iOS */ }
}

const MIC_ERRORS = {
  NotAllowedError: 'Microphone permission was declined. On iPhone: Settings → Apps → Safari → Microphone → Ask or Allow, then reopen the app and try again.',
  SecurityError: 'Microphone permission was declined. On iPhone: Settings → Apps → Safari → Microphone → Ask or Allow, then reopen the app and try again.',
  NotFoundError: 'No microphone was found.',
  NotReadableError: 'The microphone is busy — close any call, voice memo or video app and try again.',
  AbortError: 'The microphone is busy — close any call, voice memo or video app and try again.',
};

async function openMic(deviceId) {
  // Try the cleanest signal first, then progressively simpler requests.
  const dev = deviceId ? { deviceId: { exact: deviceId } } : {};
  const tries = [
    { audio: { ...dev, echoCancellation: false, noiseSuppression: false, autoGainControl: false } },
    { audio: { ...dev } },
    { audio: true },
  ];
  let last = null;
  for (const c of tries) {
    try { return await navigator.mediaDevices.getUserMedia(c); } catch (e) { last = e; if (e.name === 'NotAllowedError' || e.name === 'SecurityError') break; }
  }
  throw last || new Error('Microphone unavailable');
}

async function openAudio() {
  if (ctx) return true;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus('This browser can’t use the microphone here. Try opening the app link in Safari.', 'bad');
    return false;
  }
  // The clock’s beeps put the iPhone in “playback only” mode, which blocks the microphone.
  setSession('play-and-record');
  try {
    stream = await openMic(store.get().tgDevice || '');
  } catch (e) {
    setSession('playback');
    setStatus((MIC_ERRORS[e.name] || 'Could not use the microphone.') + (MIC_ERRORS[e.name] ? '' : ` (${e.name || 'error'}${e.message ? ': ' + e.message : ''})`), 'bad');
    return false;
  }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    await ctx.audioWorklet.addModule('js/tick-worklet.js');
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop()); stream = null; ctx = null; setSession('playback');
    setStatus(`This phone’s browser can’t process audio this way (${e.name || 'error'}). Please update iOS.`, 'bad');
    return false;
  }
  const src = ctx.createMediaStreamSource(stream);
  node = new AudioWorkletNode(ctx, 'tick-tap');
  const mute = ctx.createGain(); mute.gain.value = 0;
  src.connect(node).connect(mute).connect(ctx.destination);
  sampleRate = ctx.sampleRate;
  bands = BAND_HZ.map((f) => makeBand(f, sampleRate));
  node.port.onmessage = (e) => processBlock(e.data.start, e.data.data, sampleRate);
  await ctx.resume();
  if (mode === 'off') mode = 'paused';
  setStatus('', '');
  listDevices();
  startLoop();
  return true;
}

// A short two-note chime so you know from across the room that it has finished.
function chime() {
  if (!ctx) return;
  try {
    [[880, 0], [1318.5, 0.18]].forEach(([hz, dt]) => {
      const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + 0.05 + dt;
      o.type = 'sine'; o.frequency.value = hz;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      o.connect(g).connect(ctx.destination);
      o.start(t); o.stop(t + 0.5);
    });
  } catch (e) { /* ignore */ }
}

function keepAwake(on) {
  if (on) {
    if ('wakeLock' in navigator && (!wake || wake.released)) navigator.wakeLock.request('screen').then((w) => { wake = w; }).catch(() => {});
  } else if (wake) { wake.release().catch(() => {}); wake = null; }
}

/* ---------- Steps ---------- */
/** Step 1: listen to the room for 30 seconds with no watch in place. */
async function measureBackground() {
  if (!(await openAudio())) return;
  stopListening();
  bands.forEach((b) => { b.stats = []; });
  baseline = null; baseLevels = [];
  baseStarted = ctx.currentTime;
  baseUntil = ctx.currentTime + 0.5 + BASELINE_S;   // skip the tap itself
  mode = 'baseline';
  wizStep = 1;
  keepAwake(true);
  renderWizard();
}

function cancelBackground() {
  stopListening();
  baseline = null;
  renderWizard();
}

async function skipBackground() {
  skipped = true; baseline = null;
  wizStep = 3;
  renderWizard();
  await openAudio();   // so the level meter works while placing the watch
}

/** Step 4: full screen — 10-second countdown, then a 2-minute measurement. */
async function startMeasurement() {
  if (!(await openAudio())) return;
  stopListening();
  keepAwake(true);
  openStage();
  setPhase('count');
  mode = 'countdown';
  let n = COUNTDOWN_S;
  const show = () => {
    const box = $('tg-cd-num');
    if (!box) return;
    const num = el('span', { class: 'tg-cd-digit' + (n <= 3 ? ' last' : '') }, String(n));
    box.replaceChildren(num);
    const ring = $('tg-cd-ring');
    if (ring) ring.style.strokeDashoffset = String(CD_CIRC * (1 - (n - 1) / COUNTDOWN_S));
  };
  const ring = $('tg-cd-ring');
  if (ring) { ring.style.transition = 'none'; ring.style.strokeDashoffset = '0'; void ring.getBoundingClientRect(); ring.style.transition = ''; }
  show();
  clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    n--;
    if (n > 0) { show(); return; }
    clearInterval(countdownTimer);
    beginListening();
    setPhase('measure');
  }, 1000);
}

function beginListening() {
  runTicks = []; lastResult = null; chosen = null; selectInfo = null; curBph = null;
  bands.forEach((b, i) => {
    Object.assign(b, { env: 0, noise: 1e-4, peak: 1e-3, armed: true, lastTick: -1, ticks: [], stats: [] });
    b.gate = baseline ? baseline.bands[i].p95 * 2 : 0;   // must be clearly above the room’s usual noise
  });
  startT = ctx.currentTime;
  listenFrom = startT + 0.3;
  selectAt = listenFrom + 5;
  lastAnalyse = 0; lastDraw = 0; lastTickSeen = 0;
  mode = 'listening';
  resetLive();
}

// Stops listening but keeps the microphone and the background measurement.
function stopListening() {
  clearInterval(countdownTimer);
  if (mode === 'listening' || mode === 'countdown' || mode === 'baseline') mode = ctx ? 'paused' : 'off';
}

function stop() {
  stopListening();
  cancelAnimationFrame(rafId); rafId = 0;
  try { node && node.disconnect(); } catch (e) { /* ignore */ }
  if (stream) stream.getTracks().forEach((t) => t.stop());
  if (ctx) ctx.close().catch(() => {});
  ctx = stream = node = null;
  mode = 'off';
  level = 0;
  setSession('playback');
  keepAwake(false);
}

function finishMeasurement() {
  const bph = curBph;
  const elapsed = ctx ? ctx.currentTime - startT : 0;
  stopListening();
  const all = runTicks.filter((t) => t >= listenFrom + 1);
  const r = (bph && analyse(all, bph)) || lastResult;
  if (r) lastResult = r;
  const w = tgWatch($('tg-watch')?.value);
  finalInfo = {
    r, at: Date.now(), watchId: w ? w.id : '', bph, seconds: Math.round(Math.min(elapsed, MEASURE_S)),
    beats: runTicks.length, signal: selectInfo, baseline: !!baseline, ticks: all, saved: false,
  };
  // Saved automatically: no re-entering the result by hand.
  if (r && w) finalInfo.saved = saveResult(w.id);
  chime();
  keepAwake(false);
  setPhase('result');
  renderResult();
  renderWizard();
}

/* ---------- Live loop ---------- */
function startLoop() {
  if (rafId) return;
  const loop = () => {
    rafId = ctx ? requestAnimationFrame(loop) : 0;
    if (!ctx) return;
    // Level meters (step cards) and the background progress.
    const pct = Math.max(0, Math.min(100, ((toDb(level) + 80) / 70) * 100));
    document.querySelectorAll('.tg-level-bar').forEach((b) => { b.style.width = `${pct}%`; });
    if (mode === 'baseline') {
      const done = Math.min(1, (ctx.currentTime - baseStarted) / (BASELINE_S + 0.5));
      const ring = $('tg-base-ring');
      if (ring) ring.style.strokeDashoffset = String(BASE_CIRC * (1 - done));
      const s = $('tg-base-secs');
      if (s) s.textContent = String(Math.max(0, Math.ceil(baseUntil - ctx.currentTime)));
    }
    if (mode === 'listening') liveFrame();
  };
  rafId = requestAnimationFrame(loop);
}

const fmtClock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const rateClass = (v) => (Math.abs(v) <= 10 ? 'good' : Math.abs(v) <= 20 ? 'mid' : 'badr');   // matches verdict()
const beClass = (v) => (v <= 0.6 ? 'good' : v <= 1.2 ? 'mid' : 'badr');

function resetLive() {
  const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };
  set('tg-l-timer', fmtClock(MEASURE_S));
  set('tg-l-rate', '—'); set('tg-l-be', '—'); set('tg-l-beats', '0'); set('tg-l-bph', 'Finding the tick…');
  set('tg-l-sig', ''); set('tg-l-conf', ''); set('tg-l-status', 'Listening… stay quiet and don’t touch the phone.');
  const r = $('tg-l-rate'); if (r) r.className = 'tg-l-rate';
  const p = $('tg-l-prog'); if (p) p.style.width = '0%';
  drawTrace($('tg-l-trace'), [], 0, { span: MEASURE_S });
}

function liveFrame() {
  const now = ctx.currentTime;
  const elapsed = now - startT;
  const left = Math.max(0, MEASURE_S - elapsed);
  const timer = $('tg-l-timer');
  if (timer) {
    const txt = fmtClock(Math.ceil(left));
    if (timer.textContent !== txt) timer.textContent = txt;
    timer.classList.toggle('ending', left <= 10);
  }
  const p = $('tg-l-prog'); if (p) p.style.width = `${Math.min(100, (elapsed / MEASURE_S) * 100)}%`;
  if (runTicks.length !== lastTickSeen) {
    lastTickSeen = runTicks.length;
    const dot = $('tg-l-dot');
    if (dot) { dot.classList.remove('hit', 'odd'); void dot.offsetWidth; dot.classList.add('hit'); if (lastTickSeen % 2) dot.classList.add('odd'); }
    const b = $('tg-l-beats'); if (b) b.textContent = lastTickSeen.toLocaleString('en-GB');
  }
  const ms = performance.now();
  if (ms - lastAnalyse > 500) { lastAnalyse = ms; analyseLive(elapsed); }
  if (ms - lastDraw > 120) { lastDraw = ms; drawTrace($('tg-l-trace'), runTicks.filter((t) => t >= listenFrom), curBph, { span: MEASURE_S, from: listenFrom }); }
  if (elapsed >= MEASURE_S) finishMeasurement();
}

function analyseLive(elapsed) {
  const set = (id, v) => { const e = $(id); if (e && e.textContent !== v) e.textContent = v; };
  curBph = bphChoice === 'auto' ? (chosen ? estimateBph(chosen.ticks) || curBph : null) : Number(bphChoice);
  set('tg-l-bph', !chosen ? 'Finding the tick…' : curBph ? `${curBph.toLocaleString('en-GB')} bph${bphChoice === 'auto' ? ' · auto' : ''}` : 'Detecting beat…');
  if (selectInfo) set('tg-l-sig', `Signal ${selectInfo.ratio >= 10 ? Math.round(selectInfo.ratio) : selectInfo.ratio.toFixed(1)}× ${baseline ? 'above background' : 'above noise'} · ${(selectInfo.hz / 1000).toFixed(1)} kHz`);
  const cut = startT + elapsed - LIVE_WINDOW_S;
  const win = runTicks.filter((t) => t >= cut && t >= listenFrom);
  const r = chosen && elapsed >= MIN_S + 2 && curBph ? analyse(win, curBph) : null;
  const status = $('tg-l-status');
  if (!r) {
    if (elapsed > 12 && runTicks.length < 10) {
      set('tg-l-status', selectInfo && selectInfo.rhythm < 0.2 && baseline ? 'Can’t pick out a steady tick yet — the watch may need to be pressed closer to the microphone.' : 'Not hearing clear ticks yet — check the watch is touching the microphone.');
      if (status) status.className = 'tg-l-status warn';
    }
    return;
  }
  lastResult = r;
  const rate = $('tg-l-rate');
  if (rate) { rate.textContent = signed(r.rate, 1); rate.className = 'tg-l-rate ' + rateClass(r.rate); }
  const be = $('tg-l-be');
  if (be) { be.textContent = `${r.beatError.toFixed(1)} ms`; be.className = 'tg-l-val ' + beClass(r.beatError); }
  set('tg-l-conf', `Confidence ${r.confidence} · ${Math.round(Math.min(1, r.found) * 100)}% of beats heard`);
  const low = r.confidence === 'Low';
  set('tg-l-status', low ? 'Readings are unsteady — keep the room quiet and the phone still.' : elapsed < 30 ? 'Locked on. Numbers settle over the first 30 seconds…' : 'Steady reading. Keep still until the timer ends.');
  if (status) status.className = 'tg-l-status ' + (low ? 'warn' : 'ok');
}

// Timegrapher-style trace: each beat's timing against a perfect watch at this beat rate.
// A line sloping up means fast, down means slow; two lines apart means beat error.
function drawTrace(c, ts, bph, { span = 0, from = null } = {}) {
  if (!c) return;
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth, h = c.clientHeight;
  if (!w || !h) return;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  // Grid
  g.strokeStyle = 'rgba(143,152,171,.14)'; g.lineWidth = 1;
  for (let i = 1; i < 6; i++) { const x = Math.round((w * i) / 6) + 0.5; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
  g.strokeStyle = 'rgba(143,152,171,.28)';
  g.beginPath(); g.moveTo(0, Math.round(h / 2) + 0.5); g.lineTo(w, Math.round(h / 2) + 0.5); g.stroke();
  if (!bph || ts.length < 4) return;
  const T = 3600 / bph;
  const rows = assignBeats(ts, T);
  const tA = ts[0];
  const offs = rows.map(([n, t]) => (tA + n * T - t) * 1000);   // ms; positive = early (fast), drawn upwards
  const center = median(offs);
  const dev = offs.map((o) => Math.abs(o - center)).sort((x, y) => x - y);
  const half = Math.min((T * 1000) / 2, Math.max(4, (dev[Math.floor(dev.length * 0.85)] || 0) * 1.6));
  const start = from ?? tA;
  const total = span || Math.max(1, ts[ts.length - 1] - start);
  // Millisecond guides
  const step = half > 20 ? 10 : half > 8 ? 5 : 2;
  g.fillStyle = 'rgba(143,152,171,.55)'; g.font = '10px -apple-system, system-ui, sans-serif';
  for (let v = step; v < half; v += step) {
    [1, -1].forEach((s) => {
      const y = h / 2 - (s * v / half) * (h / 2 - 6);
      g.strokeStyle = 'rgba(143,152,171,.08)'; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
      g.fillText(`${s > 0 ? '+' : '−'}${v} ms`, 4, y - 2);
    });
  }
  const newest = ts[ts.length - 1];
  rows.forEach(([n, t], i) => {
    const d = offs[i] - center;
    const out = Math.abs(d) > half;
    const y = h / 2 - (Math.max(-half, Math.min(half, d)) / half) * (h / 2 - 6);
    const x = 4 + ((t - start) / total) * (w - 8);
    const fresh = newest - t < 1.5;
    g.globalAlpha = out ? 0.25 : 1;
    g.fillStyle = n & 1 ? '#fbbf24' : '#c9a96e';
    const s = fresh ? 4 : 2.6;
    g.fillRect(x - s / 2, y - s / 2, s, s);
  });
  g.globalAlpha = 1;
}

/* ---------- Full-screen stage ---------- */
const CD_R = 120, CD_CIRC = 2 * Math.PI * CD_R;
const BASE_R = 34, BASE_CIRC = 2 * Math.PI * BASE_R;

function openStage() {
  let s = $('tg-stage');
  if (s) { s.classList.remove('closing'); return s; }
  s = el('div', { id: 'tg-stage', class: 'tg-stage', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Timegrapher measurement' },
    el('button', { type: 'button', class: 'tg-x', 'aria-label': 'Close', onclick: closeStage }, '×'),
    // Countdown
    el('section', { class: 'tg-ph tg-ph-count' },
      el('div', { class: 'tg-kicker' }, 'Step away from the watch'),
      el('div', { class: 'tg-cd' },
        el('div', { class: 'tg-cd-svg', html: `<svg viewBox="0 0 280 280" aria-hidden="true"><circle cx="140" cy="140" r="${CD_R}" class="tg-cd-track"/><circle id="tg-cd-ring" cx="140" cy="140" r="${CD_R}" class="tg-cd-prog" style="stroke-dasharray:${CD_CIRC};stroke-dashoffset:0"/></svg>` }),
        el('div', { id: 'tg-cd-num', class: 'tg-cd-num', 'aria-live': 'polite' })),
      el('div', { class: 'tg-cd-sub' }, 'Put the phone down, don’t touch it, and move away. The measurement starts by itself.'),
      el('button', { type: 'button', class: 'btn tg-ghost', onclick: closeStage }, 'Cancel')),
    // Live measurement
    el('section', { class: 'tg-ph tg-ph-measure' },
      el('div', { class: 'tg-live-top' },
        el('span', { class: 'tg-live' }, el('span', { class: 'tg-live-dot' }), 'LIVE'),
        el('span', { id: 'tg-l-bph', class: 'tg-chip' }, 'Finding the tick…')),
      el('div', { class: 'tg-timer-wrap' },
        el('div', { id: 'tg-l-timer', class: 'tg-timer' }, fmtClock(MEASURE_S)),
        el('div', { class: 'tg-timer-sub' }, 'remaining')),
      el('div', { class: 'tg-prog' }, el('span', { id: 'tg-l-prog' })),
      el('div', { class: 'tg-l-graph' },
        el('canvas', { id: 'tg-l-trace', class: 'tg-l-canvas', 'aria-label': 'Live beat timing trace' }),
        el('div', { class: 'tg-legend' }, el('span', { class: 'tg-key tick' }, 'tick'), el('span', { class: 'tg-key tock' }, 'tock'), el('span', { class: 'muted' }, '↗ fast · ↘ slow'))),
      el('div', { class: 'tg-l-grid' },
        el('div', { class: 'tg-l-stat wide' }, el('div', { class: 'tg-l-lbl' }, 'Rate · s/day'), el('div', { id: 'tg-l-rate', class: 'tg-l-rate' }, '—')),
        el('div', { class: 'tg-l-stat' }, el('div', { class: 'tg-l-lbl' }, 'Beat error'), el('div', { id: 'tg-l-be', class: 'tg-l-val' }, '—')),
        el('div', { class: 'tg-l-stat' }, el('div', { class: 'tg-l-lbl' }, 'Beats heard ', el('span', { id: 'tg-l-dot', class: 'tg-beat-dot' })), el('div', { id: 'tg-l-beats', class: 'tg-l-val' }, '0'))),
      el('div', { class: 'tg-l-meta' }, el('span', { id: 'tg-l-sig' }), el('span', { id: 'tg-l-conf' })),
      el('div', { id: 'tg-l-status', class: 'tg-l-status' }),
      el('button', { type: 'button', class: 'btn tg-ghost', onclick: () => { if (ctx && ctx.currentTime - startT >= 20 && lastResult) finishMeasurement(); else closeStage(); } }, 'Stop early')),
    // Results
    el('section', { id: 'tg-result', class: 'tg-ph tg-ph-result' }));
  document.body.append(s);
  document.body.classList.add('tg-stage-open');
  return s;
}

function setPhase(p) {
  const s = $('tg-stage');
  if (s) { s.dataset.phase = p; s.scrollTop = 0; }
}

function closeStage() {
  if (mode === 'countdown' || mode === 'listening') stopListening();
  keepAwake(false);
  const s = $('tg-stage');
  document.body.classList.remove('tg-stage-open');
  if (!s) return;
  s.classList.add('closing');
  setTimeout(() => s.remove(), 260);
  renderWizard();
  renderHistory();
}

function showLastResult() {
  if (!finalInfo) return;
  openStage();
  setPhase('result');
  renderResult();
}

function verdict(rate) {
  const a = Math.abs(rate);
  if (rate >= -4 && rate <= 6) return ['Excellent', 'Within chronometer (COSC) limits of −4 / +6 s/day.', 'good'];
  if (a <= 10) return ['Very good', 'Better than most mechanical movement specs.', 'good'];
  if (a <= 20) return ['Good', 'Typical for an everyday mechanical watch.', 'mid'];
  if (a <= 40) return ['Fair', `Running ${rate > 0 ? 'fast' : 'slow'} — a regulation would help.`, 'mid'];
  return ['Needs attention', `Running well ${rate > 0 ? 'fast' : 'slow'}. Consider regulation or a service.`, 'badr'];
}
const beVerdict = (v) => (v <= 0.5 ? 'Excellent' : v <= 1.0 ? 'Good' : v <= 2 ? 'Fair' : 'High');

// Semicircle gauge from −60 to +60 s/day.
function gaugeSvg() {
  const R = 84, cx = 110, cy = 104, MAX = 60;
  const pt = (v, r = R) => { const a = Math.PI * (v + MAX) / (2 * MAX); return [cx - r * Math.cos(a), cy - r * Math.sin(a)]; };
  const arc = (v1, v2, cls) => { const [x1, y1] = pt(v1), [x2, y2] = pt(v2); return `<path class="${cls}" d="M${x1.toFixed(1)} ${y1.toFixed(1)} A${R} ${R} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}"/>`; };
  const ticksSvg = [-60, -40, -20, 0, 20, 40, 60].map((v) => {
    const [x1, y1] = pt(v, R - 14), [x2, y2] = pt(v, R - 8), [tx, ty] = pt(v, R - 26);
    return `<line class="tg-g-tick" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/><text class="tg-g-lbl" x="${tx.toFixed(1)}" y="${(ty + 3).toFixed(1)}">${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}</text>`;
  }).join('');
  return `<svg viewBox="0 0 220 122" aria-hidden="true">
    ${arc(-60, -20, 'tg-g-arc bad')}${arc(-20, -10, 'tg-g-arc mid')}${arc(-10, 10, 'tg-g-arc good')}${arc(10, 20, 'tg-g-arc mid')}${arc(20, 60, 'tg-g-arc bad')}
    ${arc(-4, 6, 'tg-g-arc cosc')}${ticksSvg}
    <g id="tg-needle" class="tg-needle"><line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - R + 6}"/><circle cx="${cx}" cy="${cy}" r="6"/></g>
  </svg>`;
}

function countUp(node, to, digits, ms = 1300, fmt = (v) => v.toFixed(digits)) {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduce) { node.textContent = fmt(to); return; }
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
    node.textContent = fmt(to * e);
    if (k < 1 && node.isConnected) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function renderResult() {
  const box = $('tg-result');
  if (!box || !finalInfo) return;
  box.innerHTML = '';
  const { r } = finalInfo;
  const w = tgWatch(finalInfo.watchId);
  const when = new Date(finalInfo.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const again = el('button', { type: 'button', class: 'btn', onclick: startMeasurement }, '↻ Measure again');
  const done = el('button', { type: 'button', class: 'btn primary', onclick: closeStage }, 'Done');
  if (!r) {
    box.append(
      el('div', { class: 'tg-r-fail tg-in', style: '--d:0' },
        el('div', { class: 'tg-r-fail-icon' }, '🔇'),
        el('h2', {}, 'Couldn’t hear a steady tick'),
        el('p', { class: 'muted' }, `${finalInfo.beats} sounds were picked up, but not enough of them kept the watch’s beat.`),
        el('ul', { class: 'plain-list small' },
          el('li', {}, 'Try wired earphones with the microphone resting on the case back.'),
          el('li', {}, 'Make sure the watch is wound and running.'),
          el('li', {}, 'Choose a quieter room and measure the background again.'),
          el('li', {}, 'Set the beat rate on the main screen if you know it.'))),
      el('div', { class: 'tg-r-btns tg-in', style: '--d:2' }, again, done));
    return;
  }
  const [title, sub, cls] = verdict(r.rate);
  const rateNum = el('span', { class: 'tg-r-rate ' + rateClass(r.rate) }, '0.0');
  const card = (lbl, val, note, d, c = '') => el('div', { class: 'tg-r-card tg-in', style: `--d:${d}` },
    el('div', { class: 'tg-l-lbl' }, lbl), el('div', { class: 'tg-r-val ' + c }, val), note ? el('div', { class: 'tg-r-note' }, note) : null);
  const beVal = el('span', {}, '0.0');
  const watchSel = el('select', { class: 'input', 'aria-label': 'Save to watch' }, watchOptions(finalInfo.watchId));
  const syncBtn = () => {
    const same = finalInfo.saved && watchSel.value === finalInfo.savedTo;
    saveBtn.textContent = same ? 'Saved automatically ✓' : finalInfo.saved ? 'Move to this watch' : 'Save to watch';
    saveBtn.disabled = same;
  };
  watchSel.addEventListener('change', () => {
    if (watchSel.value === '__visit') addVisitor((v) => { watchSel.replaceChildren(...watchOptions(v ? v.id : finalInfo.watchId).filter(Boolean)); syncBtn(); });
    else syncBtn();
  });
  const saveBtn = el('button', { type: 'button', class: 'btn primary', onclick: () => {
    if (saveResult(watchSel.value)) { finalInfo.saved = true; syncBtn(); }
  } }, '');
  syncBtn();
  const graph = el('canvas', { class: 'tg-r-canvas', 'aria-label': 'Beat timing trace for the whole measurement' });

  box.append(
    el('div', { class: 'tg-r-head tg-in', style: '--d:0' },
      el('div', { class: 'tg-kicker ok' }, '✓ Measurement complete'),
      el('h2', { class: 'tg-r-title' }, w ? w.name : 'Your watch'),
      el('div', { class: 'muted small' }, `${when} · ${fmtClock(finalInfo.seconds)} · ${r.bph.toLocaleString('en-GB')} bph`)),
    el('div', { class: 'tg-gauge tg-in', style: '--d:1' },
      el('div', { class: 'tg-gauge-svg', html: gaugeSvg() }),
      el('div', { class: 'tg-gauge-read' }, rateNum, el('span', { class: 'tg-r-unit' }, 's/day'))),
    el('div', { class: 'tg-verdict tg-in ' + cls, style: '--d:2' }, el('b', {}, title), el('span', {}, sub)),
    el('div', { class: 'tg-r-cards' },
      el('div', { class: 'tg-r-card tg-in', style: '--d:3' }, el('div', { class: 'tg-l-lbl' }, 'Beat error'), el('div', { class: 'tg-r-val ' + beClass(r.beatError) }, beVal, ' ms'), el('div', { class: 'tg-r-note' }, beVerdict(r.beatError))),
      card('Beat rate', `${(r.bph / 1000).toLocaleString('en-GB', { maximumFractionDigits: 1 })}k`, `${r.bph.toLocaleString('en-GB')} bph · ${r.bph / 7200} Hz`, 4),
      card('Confidence', r.confidence, `${Math.round(Math.min(1, r.found) * 100)}% of beats heard`, 5, r.confidence === 'High' ? 'good' : r.confidence === 'Medium' ? 'mid' : 'badr'),
      card('Signal', finalInfo.signal ? `${finalInfo.signal.ratio >= 10 ? Math.round(finalInfo.signal.ratio) : finalInfo.signal.ratio.toFixed(1)}×` : '—', finalInfo.baseline ? 'louder than background' : 'background skipped', 6)),
    el('div', { class: 'tg-r-graph tg-in', style: '--d:7' },
      el('div', { class: 'tg-l-lbl' }, 'Trace · whole measurement'), graph,
      el('div', { class: 'tg-legend' }, el('span', { class: 'tg-key tick' }, 'tick'), el('span', { class: 'tg-key tock' }, 'tock'), el('span', { class: 'muted' }, `${finalInfo.beats.toLocaleString('en-GB')} beats · timing spread ${r.jitterMs.toFixed(2)} ms`))),
    el('div', { class: 'tg-r-save tg-in', style: '--d:8' }, watchSel, saveBtn),
    el('div', { class: 'tg-r-btns tg-in', style: '--d:9' }, again, done),
    el('p', { class: 'muted small tg-in', style: '--d:10' }, 'Phone microphones are far less sensitive than a real timegrapher — treat this as a guide. Amplitude can’t be measured this way.'));

  countUp(rateNum, r.rate, 1, 1300, (v) => signed(v, 1));
  countUp(beVal, r.beatError, 1, 1100);
  const needle = box.querySelector('#tg-needle');
  if (needle) {
    const ang = (Math.max(-60, Math.min(60, r.rate)) / 60) * 90;
    needle.style.transform = 'rotate(-90deg)';
    requestAnimationFrame(() => requestAnimationFrame(() => { needle.style.transform = `rotate(${ang}deg)`; }));
  }
  requestAnimationFrame(() => drawTrace(graph, finalInfo.ticks, r.bph, {}));
}

/* ---------- Main panel ---------- */
// Lists microphones (wired earphones, Bluetooth headsets…) once permission has been given.
async function listDevices() {
  const sel = $('tg-mic');
  if (!sel || !navigator.mediaDevices?.enumerateDevices) return;
  try {
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
    const cur = store.get().tgDevice || '';
    sel.innerHTML = '';
    sel.append(el('option', { value: '' }, 'Phone’s own microphone'));
    devs.forEach((d, i) => { if (d.deviceId && d.deviceId !== 'default') sel.append(el('option', { value: d.deviceId, selected: d.deviceId === cur }, d.label || `Microphone ${i + 1}`)); });
    const row = sel.closest('.tg-mic-row'); if (row) row.hidden = sel.options.length < 2;
  } catch (e) { /* ignore */ }
}

function setStatus(msg, cls) { const s = $('tg-status'); if (s) { s.textContent = msg; s.className = 'tg-status ' + (cls || ''); s.hidden = !msg; } }

const ROOM = {
  quiet: ['Quiet', 'Great — this room is quiet enough for a good reading.', 'good'],
  ok: ['Fairly quiet', 'Should be fine. A quieter spot may give steadier numbers.', 'mid'],
  noisy: ['Noisy', 'There’s a lot of background sound. Try a quieter room, or use wired earphones on the case back.', 'badr'],
};

function levelMeter(label) {
  return el('div', { class: 'tg-level-row' }, el('span', { class: 'muted small' }, label), el('div', { class: 'tg-level' }, el('span', { class: 'tg-level-bar' })));
}

function renderWizard() {
  const box = $('tg-steps');
  if (!box) return;
  const busy = mode === 'baseline';
  const room = baseline ? ROOM[baseline.room] : null;
  const steps = [
    { n: 1, title: 'Measure the background', done: !!baseline || skipped, tone: room ? room[2] : '', summary: baseline ? `Done · ${room[0]}` : skipped ? 'Skipped' : '' },
    { n: 2, title: 'Background measurement complete', done: wizStep > 2, tone: room ? room[2] : '', summary: baseline ? room[0] : skipped ? 'Skipped' : '' },
    { n: 3, title: 'Place the watch next to the microphone', done: wizStep > 3, summary: store.get().tgDevice ? 'External microphone' : 'Ready' },
    { n: 4, title: 'Start measurement & step away', done: false, summary: '' },
  ];
  const body = (n) => {
    if (n === 1) {
      if (busy) {
        return [
          el('div', { class: 'tg-base-live' },
            el('div', { class: 'tg-base-ringbox', html: `<svg viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="${BASE_R}" class="tg-cd-track"/><circle id="tg-base-ring" cx="40" cy="40" r="${BASE_R}" class="tg-cd-prog" style="stroke-dasharray:${BASE_CIRC};stroke-dashoffset:${BASE_CIRC}"/></svg><span id="tg-base-secs">${BASELINE_S}</span>` }),
            el('div', {}, el('b', {}, 'Listening to the room…'), el('div', { class: 'muted small' }, 'Stay quiet and keep still. No watch near the phone.'))),
          levelMeter('Room sound'),
          el('button', { type: 'button', class: 'btn sm tg-ghost', onclick: cancelBackground }, 'Cancel'),
        ];
      }
      return [
        el('ul', { class: 'tg-checks' },
          el('li', {}, el('b', {}, 'Go somewhere as quiet as possible'), ' — no TV, music, fans or talking. The quieter the room, the better the watch can be heard.'),
          el('li', {}, el('b', {}, 'Put the phone where the test will happen'), ', ideally on something soft like a folded cloth, with no watch near it.'),
          el('li', {}, el('b', {}, 'Stay still for 30 seconds'), ' while the app learns the room’s sound so it can ignore it later.')),
        el('button', { type: 'button', class: 'btn primary wide tg-go', onclick: measureBackground }, 'Measure background · 30 s'),
        el('button', { type: 'button', class: 'tg-link', onclick: skipBackground }, 'Skip this step (less accurate)'),
      ];
    }
    if (n === 2) {
      if (!baseline) return [el('p', { class: 'muted small' }, 'Background skipped — the app will estimate the noise as it listens.'), el('button', { type: 'button', class: 'btn primary wide', onclick: () => { wizStep = 3; renderWizard(); } }, 'Continue')];
      return [
        el('div', { class: 'tg-room ' + room[2] },
          el('div', { class: 'tg-room-badge' }, baseline.room === 'noisy' ? '!' : '✓'),
          el('div', {}, el('b', {}, `Room: ${room[0]}`), el('div', { class: 'small' }, room[1]))),
        el('div', { class: 'tg-room-facts muted small' },
          el('span', {}, `Background level ${String(Math.round(baseline.db)).replace('-', '−')} dB`),
          el('span', {}, `Sudden noises: ${baseline.spikes < 0.01 ? 'none' : baseline.spikes < 0.05 ? 'a few' : 'many'}`)),
        el('div', { class: 'tg-row-btns' },
          el('button', { type: 'button', class: 'btn', onclick: measureBackground }, 'Measure again'),
          el('button', { type: 'button', class: 'btn primary', onclick: () => { wizStep = 3; renderWizard(); } }, 'Continue →')),
      ];
    }
    if (n === 3) {
      return [
        el('div', { class: 'tg-opt best' },
          el('div', { class: 'tg-opt-tag' }, 'Best'),
          el('b', {}, '🎧 Wired earphones on the case back'),
          el('p', { class: 'small' }, 'Plug in wired earphones that have a microphone (USB-C or Lightning). Lay the watch dial-down on a soft cloth and rest the earphones’ little microphone on the middle of the case back.'),
          el('div', { class: 'tg-mic-row', hidden: true },
            el('select', { id: 'tg-mic', class: 'input', 'aria-label': 'Microphone', onchange: (e) => {
              store.get().tgDevice = e.target.value; store.save();
              const wasOpen = mode !== 'off';
              stop(); baseline = null; skipped = false; wizStep = 1; renderWizard();
              toast('Microphone changed — measure the background again with it');
              if (wasOpen) openAudio();
            } }))),
        el('div', { class: 'tg-opt' },
          el('b', {}, '📱 Phone microphone'),
          el('p', { class: 'small' }, 'Lay the phone on a soft cloth and press the watch’s case back against the bottom edge of the phone, where the microphone is.')),
        el('p', { class: 'muted small' }, 'Wind the watch fully first. Bluetooth earphones (e.g. AirPods) filter out much of the tick, so they work less well.'),
        ctx ? levelMeter('Microphone') : null,
        el('button', { type: 'button', class: 'btn primary wide', onclick: () => { wizStep = 4; renderWizard(); } }, 'The watch is in place →'),
      ];
    }
    return [
      el('p', { class: 'small' }, `When you tap Start you get ${COUNTDOWN_S} seconds to put the phone down and move away, so your movement isn’t heard. Then it measures for ${MEASURE_S / 60} minutes and stops by itself.`),
      el('p', { class: 'muted small' }, 'The screen is designed to be read from across the room, and a chime plays when it has finished.'),
      el('button', { type: 'button', class: 'btn primary wide tg-start-big', onclick: startMeasurement }, el('span', {}, '▶'), ' Start measurement'),
    ];
  };
  box.replaceChildren(...steps.map((s) => {
    const active = s.n === wizStep;
    const canJump = !busy && !active && s.done && !(s.n === 2 && !baseline && !skipped);
    const head = el(canJump ? 'button' : 'div', { type: canJump ? 'button' : null, class: 'tg-step-head', onclick: canJump ? () => { wizStep = s.n; renderWizard(); } : null },
      el('span', { class: 'tg-step-num' }, s.done && !active ? '✓' : String(s.n)),
      el('span', { class: 'tg-step-title' }, s.title),
      !active && s.summary && s.done ? el('span', { class: 'tg-step-sum ' + (s.tone || '') }, s.summary) : null);
    return el('div', { class: `tg-step${active ? ' active' : ''}${s.done && !active ? ' done' : ''}${s.n > wizStep && !s.done ? ' todo' : ''}` },
      head, active ? el('div', { class: 'tg-step-body' }, body(s.n)) : null);
  }));
  if (wizStep === 3) listDevices();
  renderLast();
}

function renderLast() {
  const box = $('tg-last');
  if (!box) return;
  box.innerHTML = '';
  const r = finalInfo?.r;
  if (!r) return;
  box.append(el('button', { type: 'button', class: 'card tg-last-card', onclick: showLastResult },
    el('div', {}, el('div', { class: 'stat-label' }, 'Last measurement'),
      el('div', { class: 'tg-last-rate ' + rateClass(r.rate) }, `${signed(r.rate, 1)} s/day`),
      el('div', { class: 'muted small' }, `Beat error ${r.beatError.toFixed(1)} ms · ${r.bph.toLocaleString('en-GB')} bph · ${r.confidence} confidence`)),
    el('span', { class: 'tg-last-go' }, 'View ›')));
}

function unsaveResult() {
  if (!finalInfo || !finalInfo.savedTo) return;
  const prev = tgWatch(finalInfo.savedTo);
  if (prev) {
    if (prev.visiting) prev.timegrapher = (prev.timegrapher || []).filter((x) => x !== finalInfo.savedRef);
    else prev.readings = (prev.readings || []).filter((x) => x !== finalInfo.savedRef);
  }
  finalInfo.savedTo = null; finalInfo.savedRef = null;
}

function saveResult(watchId) {
  const r = finalInfo?.r;
  if (!r) return false;
  const w = tgWatch(watchId);
  if (!w) { toast('Choose a watch first'); return false; }
  const data = { rate: Math.round(r.rate * 10) / 10, beatError: Math.round(r.beatError * 10) / 10, bph: r.bph, confidence: r.confidence, seconds: finalInfo.seconds };
  if (w.visiting) (w.timegrapher ||= []).push({ t: finalInfo.at, ...data });
  // Watch Box watches: one accuracy history, this reading marked as coming from the timegrapher.
  else (w.readings ||= []).push({ id: store.uid(), timestamp: finalInfo.at, offsetSeconds: null, source: 'timegrapher', timegrapherData: data });
  // Remember where it went, so choosing another watch on the result screen can move it.
  unsaveResult();
  finalInfo.savedTo = w.id; finalInfo.savedRef = w.visiting ? w.timegrapher[w.timegrapher.length - 1] : w.readings[w.readings.length - 1];
  store.save(); store.emit('watches');
  toast(`Saved to ${w.name}’s accuracy history`);
  return true;
}

function visitorBar(w) {
  return el('div', { class: 'tg-visitor' },
    el('div', { class: 'muted small' }, `Visiting watch${w.owner ? ` · ${w.owner}’s` : ''}${w.bph ? ` · ${Number(w.bph).toLocaleString('en-GB')} bph` : ''} — not in your Watch Box`),
    el('div', { class: 'tg-visitor-btns' },
      el('button', { type: 'button', class: 'btn sm', onclick: () => moveToBox(w) }, 'Move to Watch Box'),
      el('button', { type: 'button', class: 'btn sm danger', onclick: async () => {
        if (!(await confirmModal(`Remove ${w.name}?`, 'Its timegrapher results are removed too.', 'Remove', true))) return;
        store.get().visitors = visitors().filter((x) => x !== w); store.save(); render();
      } }, 'Remove')));
}

function moveToBox(v) {
  const d = store.get();
  const w = { id: store.uid(), name: v.name, bph: v.bph, status: 'owned', added: Date.now(), runs: [], photos: [],
    readings: (v.timegrapher || []).map((x) => ({ id: store.uid(), timestamp: x.t, offsetSeconds: null, source: 'timegrapher',
      timegrapherData: { rate: x.rate, beatError: x.beatError, bph: x.bph, confidence: x.confidence, seconds: x.seconds } })),
    notes: v.owner ? `Timed as ${v.owner}’s watch before it joined the Watch Box.` : null };
  d.watches.push(w);
  d.visitors = visitors().filter((x) => x !== v);
  d.selectedWatchId = w.id;
  store.save(); store.emit('watches');
  toast(`${v.name} is now in your Watch Box`);
  render();
}

function renderHistory() {
  const box = $('tg-history');
  if (!box) return;
  box.innerHTML = '';
  const w = tgWatch($('tg-watch')?.value);
  const list = (w?.visiting ? (w.timegrapher || []) : (w?.readings || []).filter((x) => x.source === 'timegrapher' && x.timegrapherData)
    .map((x) => ({ ...x.timegrapherData, t: x.timestamp, ref: x }))).slice().sort((a, b) => a.t - b.t).reverse();
  if (w?.visiting) box.append(visitorBar(w));
  if (!list.length) return;
  box.append(el('h3', { class: 'sub-title' }, `Saved results — ${watchLabel(w)}`),
    el('div', { class: 'hist' }, list.map((x) => el('div', { class: 'hist-row' },
      el('div', { class: 'hist-main' },
        el('div', { class: 'hist-when' }, new Date(x.t).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })),
        el('div', { class: 'hist-off' }, `${signed(x.rate, 1)} s/day · beat error ${x.beatError} ms`),
        el('div', { class: 'muted small' }, `${x.bph.toLocaleString('en-GB')} bph · ${x.confidence} confidence · ${x.seconds} s`)),
      el('button', { type: 'button', class: 'icon-btn sm danger', 'aria-label': 'Delete result', onclick: () => { if (w.visiting) w.timegrapher = w.timegrapher.filter((y) => y !== x); else w.readings = w.readings.filter((y) => y !== x.ref); store.save(); store.emit('watches'); renderHistory(); } }, '×')))));
}

function render() {
  const box = $('tool-timegrapher-body');
  box.innerHTML = '';
  const d = store.get();
  const chosen = d.tgWatchId && tgWatch(d.tgWatchId) ? d.tgWatchId : d.selectedWatchId;
  let prev = chosen;
  const watchSel = el('select', { id: 'tg-watch', class: 'input', 'aria-label': 'Watch', onchange: (e) => {
    if (e.target.value === '__visit') {
      addVisitor((v) => { if (v) { d.tgWatchId = v.id; store.save(); render(); } else e.target.value = prev; });
      return;
    }
    prev = e.target.value; d.tgWatchId = prev; store.save();
    const w = tgWatch(prev);
    if (w && w.bph) setBph(bphSel, w.bph);
    renderHistory();
  } }, watchOptions(chosen));
  const bphSel = el('select', { class: 'input', 'aria-label': 'Beats per hour', onchange: (e) => { bphChoice = e.target.value; } },
    el('option', { value: 'auto' }, 'Beat rate: auto'), STD_BPH.map((b) => el('option', { value: String(b) }, `${b.toLocaleString('en-GB')} bph`)));
  const cur = tgWatch(chosen);
  bphSel.value = STD_BPH.includes(Number(bphChoice)) ? bphChoice : 'auto';
  if (cur && cur.bph) setBph(bphSel, cur.bph);

  box.append(
    el('div', { class: 'card tg-card' },
      el('div', { class: 'tg-hero' },
        el('div', { class: 'tg-hero-icon' }, '🎙️'),
        el('div', {}, el('h2', { class: 'card-title' }, 'Timegrapher'), el('div', { class: 'muted small' }, 'Listens to your watch tick to estimate its rate and beat error. Experimental — a guide, not a lab instrument.'))),
      el('div', { class: 'row2 tg-setup' }, watchSel, bphSel),
      el('div', { id: 'tg-steps', class: 'tg-steps' }),
      el('div', { id: 'tg-status', class: 'tg-status', hidden: true })),
    el('div', { id: 'tg-last' }),
    el('details', { class: 'card tg-tips' },
      el('summary', {}, 'More tips for a good reading'),
      el('ul', { class: 'plain-list small' },
        el('li', {}, 'Set the beat rate if you know it (e.g. 28,800 bph for most modern Swiss movements, 21,600 for Seiko NH35/4R).'),
        el('li', {}, 'Measure the background with the phone exactly where the test will be. The app then ignores those room sounds.'),
        el('li', {}, 'A soft surface (cloth, mouse mat) stops vibrations from the table reaching the microphone.'),
        el('li', {}, 'Test dial up and crown down too — the same positions as the accuracy tracker.'),
        el('li', {}, 'Amplitude can’t be measured with a phone microphone.'))),
    el('div', { id: 'tg-history' }));
  renderWizard();
  renderHistory();
}

function tgDetail(w) {
  const r = (w.readings || []).filter((x) => x.source === 'timegrapher' && x.timegrapherData).sort((a, b) => a.timestamp - b.timestamp).pop();
  if (!r) return null;
  const x = r.timegrapherData;
  return el('div', { class: 'fact' }, el('span', { class: 'fact-k' }, 'Timegrapher'), el('span', { class: 'fact-v' }, `${signed(x.rate, 1)} s/day · ${x.beatError} ms (${new Date(r.timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })})`));
}

export function register({ registerTool }) {
  registerTool({ id: 'timegrapher', title: 'Timegrapher', icon: '🎙️', desc: 'Experimental: listen to the tick', panel: 'timegrapher', group: 'accuracy', show: render, hide: () => { const s = $('tg-stage'); if (s) { s.remove(); document.body.classList.remove('tg-stage-open'); } if (mode !== 'off') stop(); }, order: 70 });
  detailExtras.push(tgDetail);
}
