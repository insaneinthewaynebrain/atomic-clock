// Experimental timegrapher: listens to the watch through the phone microphone,
// detects ticks and estimates rate (s/day) and beat error (ms).
import * as store from './store.js';
import { el, toast, signed } from './ui.js';
import { ownedWatches, getWatch, detailExtras } from './collection.js';

const STD_BPH = [18000, 19800, 21600, 25200, 28800, 36000];
const WINDOW_S = 20;          // analyse the last 20 seconds
const MIN_S = 6;              // need at least this much before showing a result
const BASELINE_S = 30;        // background measurement length
const $ = (id) => document.getElementById(id);

let ctx = null, stream = null, node = null;
// mode: 'off' (mic closed) | 'baseline' | 'paused' | 'countdown' | 'listening'
let mode = 'off';
let running = false;          // true while listening for ticks
let ticks = [];               // tick times (s, audio clock) from the chosen band
let startT = 0, listenFrom = 0, selectAt = 0, lastResult = null, uiTimer = null, bphChoice = 'auto';
let baseline = null;          // { at, bands: [{ median, p999 }] } — the room's background
let baseUntil = 0, baseStarted = 0, countdownTimer = null;
let chosen = null, selectInfo = null;
let sampleRate = 48000;

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

function bandPeriod(b) {
  const bph = bphChoice === 'auto' ? estimateBph(b.ticks) : Number(bphChoice);
  return bph ? 3600 / bph : 0.1;
}

function processBlock(start, data, sr) {
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
      } else if (!armed && env < noise + 0.15 * (peak - noise)) armed = true;
    }
    Object.assign(b, { x1, x2, y1, y2, env, noise, peak, armed, lastTick });
    const cutoff = (start + data.length) / sr - WINDOW_S;
    while (b.ticks.length && b.ticks[0] < cutoff) b.ticks.shift();
  }
  const t = (start + data.length) / sr;
  if (mode === 'baseline' && t >= baseUntil) finishBaseline();
  if (mode === 'listening' && !chosen && t >= selectAt) chooseBand();
  if (chosen) ticks = chosen.ticks;
}

function finishBaseline() {
  baseline = { at: Date.now(), bands: bands.map((b) => ({ median: quantile(b.stats, 0.5), p95: quantile(b.stats, 0.95), p99: quantile(b.stats, 0.99) })) };
  bands.forEach((b) => { b.stats = []; });
  mode = 'paused';
  setStatus('Background measured ✓  Now place the watch against the phone, then tap Start — you’ll get a 3-second countdown so touching the phone doesn’t matter.', 'ok');
  drawControls();
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
  ticks = chosen.ticks;
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

function currentPeriod() {
  const b = bphChoice === 'auto' ? estimateBph(ticks) : Number(bphChoice);
  return b ? 3600 / b : null;
}

/** Fit ticks to an ideal beat train: returns rate (s/day), beat error (ms) and quality. */
export function analyse(ts, bph) {
  if (!bph || ts.length < 8) return null;
  const T = 3600 / bph;
  const t0 = ts[0];
  // Linear fit with a separate offset for even/odd beats (tick vs tock).
  const fit = (rows) => {
    let sn = 0, st = 0, snn = 0, snt = 0, sp = 0, spp = 0, spn = 0, spt = 0;
    const m = rows.length;
    for (const [n, t] of rows) { const p = n % 2; sn += n; st += t; snn += n * n; snt += n * t; sp += p; spp += p * p; spn += p * n; spt += p * t; }
    // Solve normal equations for t = a + b*n + c*p (3x3)
    const A = [[m, sn, sp], [sn, snn, spn], [sp, spn, spp]], B = [st, snt, spt];
    const det = (M) => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
    const D = det(A);
    if (Math.abs(D) < 1e-12) return null;
    const col = (k) => A.map((r, i) => r.map((v, j) => (j === k ? B[i] : v)));
    return { a: det(col(0)) / D, b: det(col(1)) / D, c: det(col(2)) / D };
  };
  // Give every sound a beat number. Room noises land at random places; the watch lands on the beat.
  let pts = ts.map((t) => [Math.round((t - t0) / T), t]);
  if (pts.length < 8) return null;
  let f = { a: t0, b: T, c: 0 };
  for (let pass = 0; pass < 3; pass++) {
    const res = (n, t) => t - (f.a + f.b * n + f.c * (n % 2));
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
    pts = pass < 2 ? ts.map((t) => [Math.round((t - f.a) / f.b), t]) : rows;
  }
  pts.sort((x, y) => x[0] - y[0]);
  const resid = pts.map(([n, t]) => t - (f.a + f.b * n + f.c * (n % 2)));
  const sd = Math.sqrt(resid.reduce((s2, r) => s2 + r * r, 0) / resid.length);
  const span = pts[pts.length - 1][0] - pts[0][0] + 1;
  const found = pts.length / span;
  const rate = (T / f.b - 1) * 86400;
  const beatError = Math.abs(f.c) * 1000;
  // Confidence: share of beats heard and how steady they are.
  const steady = Math.max(0, 1 - sd / 0.0015);
  const score = Math.min(1, found) * steady;
  const confidence = score > 0.7 ? 'High' : score > 0.4 ? 'Medium' : 'Low';
  return { rate, beatError, bph, found, jitterMs: sd * 1000, confidence, score, seconds: ts[ts.length - 1] - ts[0], residuals: pts.map(([n, t], i) => [t, resid[i] + f.c * (n % 2), n % 2]) };
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
  listDevices();
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
  return true;
}

/** Step 1: listen to the room for 30 seconds with no watch in place. */
async function measureBackground() {
  if (!(await openAudio())) return;
  stopListening(true);
  bands.forEach((b) => { b.stats = []; });
  baseline = null;
  baseStarted = ctx.currentTime;
  baseUntil = ctx.currentTime + 0.5 + BASELINE_S;   // skip the tap itself
  mode = 'baseline';
  setStatus('Measuring the background… keep the phone still where the test will be, with no watch on it.', '');
  clearInterval(uiTimer); uiTimer = setInterval(update, 250);
  drawControls();
}

/** Step 2: 3-2-1 countdown (so touching the phone isn’t heard), then listen. */
async function start() {
  if (!(await openAudio())) return;
  stopListening(true);
  mode = 'countdown';
  let n = 3;
  const show = () => { $('tg-count').textContent = String(n); $('tg-count').hidden = false; };
  show();
  setStatus('Hands off the phone…', '');
  drawControls();
  clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    n--;
    if (n > 0) { show(); return; }
    clearInterval(countdownTimer);
    $('tg-count').hidden = true;
    beginListening();
  }, 1000);
}

function beginListening() {
  ticks = []; lastResult = null; chosen = null; selectInfo = null;
  for (const b of bands) {
    Object.assign(b, { env: 0, noise: 1e-4, peak: 1e-3, armed: true, lastTick: -1, ticks: [], stats: [] });
    const i = bands.indexOf(b);
    b.gate = baseline ? baseline.bands[i].p95 * 2 : 0;   // must be clearly above the room’s usual noise
  }
  startT = ctx.currentTime;
  listenFrom = startT + 0.3;
  selectAt = listenFrom + 5;
  mode = 'listening';
  running = true;
  setStatus('Listening… numbers settle after about 20 seconds.', '');
  clearInterval(uiTimer); uiTimer = setInterval(update, 500);
  drawControls();
}

// Pause keeps the microphone and the background measurement.
function stopListening(silent) {
  clearInterval(countdownTimer);
  const c = $('tg-count'); if (c) c.hidden = true;
  running = false;
  if (mode === 'listening' || mode === 'countdown' || mode === 'baseline') mode = ctx ? 'paused' : 'off';
  if (!silent) {
    setStatus(lastResult ? 'Paused. Save the result to a watch below, or tap Start for a new reading.' : 'Paused.', '');
    drawControls();
  }
}

function stop() {
  running = false;
  clearInterval(uiTimer); clearInterval(countdownTimer);
  const c = $('tg-count'); if (c) c.hidden = true;
  try { node && node.disconnect(); } catch (e) { /* ignore */ }
  if (stream) stream.getTracks().forEach((t) => t.stop());
  if (ctx) ctx.close().catch(() => {});
  ctx = stream = node = null;
  mode = 'off';
  setSession('playback');
  drawControls();
  setStatus(lastResult ? 'Stopped. Save the result to a watch below, or start again.' : 'Stopped.', '');
}

/* ---------- UI ---------- */
// Lists microphones (wired earphones, Bluetooth headsets…) once permission has been given.
async function listDevices() {
  const sel = $('tg-mic');
  if (!sel || !navigator.mediaDevices?.enumerateDevices) return;
  try {
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
    const cur = store.get().tgDevice || '';
    sel.innerHTML = '';
    sel.append(el('option', { value: '' }, 'Microphone: phone’s own'));
    devs.forEach((d, i) => { if (d.deviceId && d.deviceId !== 'default') sel.append(el('option', { value: d.deviceId, selected: d.deviceId === cur }, d.label || `Microphone ${i + 1}`)); });
    sel.closest('.tg-mic-row').hidden = sel.options.length < 2;
  } catch (e) { /* ignore */ }
}

function setStatus(msg, cls) { const s = $('tg-status'); if (s) { s.textContent = msg; s.className = 'tg-status ' + (cls || ''); } }

function update() {
  if (mode === 'baseline') {
    const done = Math.min(1, (ctx.currentTime - baseStarted) / (BASELINE_S + 0.5));
    $('tg-base-bar').style.width = `${Math.round(done * 100)}%`;
    $('tg-base-txt').textContent = `Measuring background… ${Math.max(0, Math.ceil(baseUntil - ctx.currentTime))} s`;
    return;
  }
  if (!running) return;
  const elapsed = ctx.currentTime - startT;
  const bph = bphChoice === 'auto' ? estimateBph(ticks) : Number(bphChoice);
  $('tg-bph').textContent = !chosen ? 'Finding the tick…' : bph ? `${bph.toLocaleString('en-GB')} bph${bphChoice === 'auto' ? ' (auto)' : ''}` : 'Detecting beat…';
  if (selectInfo) $('tg-sig').textContent = `Watch is ${selectInfo.ratio >= 10 ? Math.round(selectInfo.ratio) : selectInfo.ratio.toFixed(1)}× ${baseline ? 'louder than the background' : 'above the noise'} (${(selectInfo.hz / 1000).toFixed(1)} kHz band)`;
  const r = chosen && elapsed >= MIN_S + 2 ? analyse(ticks, bph) : null;
  if (!r) {
    $('tg-rate').textContent = '—'; $('tg-be').textContent = '—'; $('tg-conf').textContent = ticks.length ? `${ticks.length} ticks heard` : 'No ticks yet';
    if (elapsed > 12 && ticks.length < 10) setStatus(selectInfo && selectInfo.rhythm < 0.2 && baseline ? 'Can’t pick out a steady tick above the background. Press its case back firmly against the bottom of the phone, or try a quieter room.' : 'Not hearing clear ticks. Try a quieter room and press the case back against the bottom of the phone.', 'warn');
    drawTrace(null);
    return;
  }
  lastResult = r;
  $('tg-rate').textContent = `${signed(r.rate, 1)} s/day`;
  $('tg-rate').className = 'tg-big ' + (Math.abs(r.rate) <= 6 ? 'good' : Math.abs(r.rate) <= 20 ? 'mid' : 'badr');
  $('tg-be').textContent = `${r.beatError.toFixed(1)} ms`;
  $('tg-be').className = 'tg-mid ' + (r.beatError <= 0.6 ? 'good' : r.beatError <= 1.2 ? 'mid' : 'badr');
  $('tg-conf').textContent = `Confidence: ${r.confidence} · ${Math.round(r.found * 100)}% of beats heard`;
  setStatus(r.confidence === 'Low' ? 'Readings are unsteady — keep the phone still and the room quiet.' : 'Listening… numbers settle after about 20 seconds.', r.confidence === 'Low' ? 'warn' : '');
  drawTrace(r);
  const save = $('tg-save'); if (save) save.disabled = false;
}

// Timegrapher-style trace: each beat's timing error over time (a slope means fast/slow).
function drawTrace(r) {
  const c = $('tg-trace');
  if (!c) return;
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth, h = c.clientHeight;
  if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#0b0d12'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#2a3142'; g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  if (!r) return;
  const T = 3600 / r.bph;
  const pts = r.residuals;
  const t0 = pts[0][0], t1 = pts[pts.length - 1][0] || t0 + 1;
  // Show the drift: add back the rate so the line slopes like a paper timegrapher.
  const slope = -(r.rate / 86400);
  const scaleY = h / 2 / 0.004;  // ±4 ms full scale
  for (const [t, res, odd] of pts) {
    const y = h / 2 - (res + slope * (t - t0) - (slope * (t1 - t0)) / 2) * scaleY * -1;
    const x = ((t - t0) / Math.max(1, t1 - t0)) * (w - 8) + 4;
    g.fillStyle = odd ? '#fbbf24' : '#4cc2ff';
    g.fillRect(x - 1.5, Math.max(0, Math.min(h - 3, y - 1.5)), 3, 3);
  }
  void T;
}

function drawControls() {
  const main = $('tg-start'), second = $('tg-second'), base = $('tg-base');
  if (!main) return;
  const set = (btn, text, cls, fn, disabled = false) => { btn.textContent = text; btn.className = 'btn ' + cls; btn.onclick = fn; btn.disabled = disabled; };
  // Background card
  base.classList.toggle('done', !!baseline);
  base.classList.toggle('busy', mode === 'baseline');
  $('tg-base-txt').textContent = mode === 'baseline' ? 'Measuring background…' : baseline
    ? `✓ Background measured ${Math.max(0, Math.round((Date.now() - baseline.at) / 60000))} min ago`
    : 'Not measured yet — recommended';
  $('tg-base-btn').textContent = mode === 'baseline' ? 'Cancel' : baseline ? 'Measure again' : '① Measure background (30 s)';
  $('tg-base-btn').onclick = mode === 'baseline' ? () => { stopListening(false); baseline = null; drawControls(); } : measureBackground;
  if (mode !== 'baseline') $('tg-base-bar').style.width = baseline ? '100%' : '0%';
  // Main buttons
  if (mode === 'listening' || mode === 'countdown') {
    set(main, '❚❚ Pause', 'danger', () => stopListening(false));
  } else {
    set(main, baseline ? '② Start (3-2-1)' : '▶ Start (3-2-1)', 'primary', start, mode === 'baseline');
  }
  set(second, '■ Stop mic', '', stop, mode === 'off');
}

function saveResult() {
  const r = lastResult;
  if (!r) return;
  const sel = $('tg-watch');
  const w = getWatch(sel && sel.value);
  if (!w) { toast('Choose a watch first'); return; }
  (w.timegrapher ||= []).push({ t: Date.now(), rate: Math.round(r.rate * 10) / 10, beatError: Math.round(r.beatError * 10) / 10, bph: r.bph, confidence: r.confidence, seconds: Math.round(r.seconds) });
  store.save(); store.emit('watches');
  toast(`Saved to ${w.name}`);
  renderHistory();
}

function renderHistory() {
  const box = $('tg-history');
  if (!box) return;
  box.innerHTML = '';
  const w = getWatch($('tg-watch')?.value);
  const list = (w?.timegrapher || []).slice().reverse();
  if (!list.length) return;
  box.append(el('h3', { class: 'sub-title' }, `Saved results — ${w.name}`),
    el('div', { class: 'hist' }, list.map((x) => el('div', { class: 'hist-row' },
      el('div', { class: 'hist-main' },
        el('div', { class: 'hist-when' }, new Date(x.t).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })),
        el('div', { class: 'hist-off' }, `${signed(x.rate, 1)} s/day · beat error ${x.beatError} ms`),
        el('div', { class: 'muted small' }, `${x.bph.toLocaleString('en-GB')} bph · ${x.confidence} confidence · ${x.seconds} s`)),
      el('button', { type: 'button', class: 'icon-btn sm danger', 'aria-label': 'Delete result', onclick: () => { w.timegrapher = w.timegrapher.filter((y) => y !== x); store.save(); renderHistory(); } }, '×')))));
}

function render() {
  const box = $('tool-timegrapher-body');
  box.innerHTML = '';
  const owned = ownedWatches();
  const d = store.get();
  const watchSel = el('select', { id: 'tg-watch', class: 'input', 'aria-label': 'Watch', onchange: (e) => {
    const w = getWatch(e.target.value);
    if (w && w.bph && STD_BPH.includes(Number(w.bph))) { bphChoice = String(w.bph); bphSel.value = bphChoice; }
    renderHistory();
  } }, owned.length ? owned.map((w) => el('option', { value: w.id, selected: w.id === d.selectedWatchId }, w.name)) : el('option', { value: '' }, 'No watches yet'));
  const bphSel = el('select', { class: 'input', 'aria-label': 'Beats per hour', onchange: (e) => { bphChoice = e.target.value; } },
    el('option', { value: 'auto' }, 'Beat rate: auto'), STD_BPH.map((b) => el('option', { value: String(b) }, `${b.toLocaleString('en-GB')} bph`)));
  const cur = getWatch(d.selectedWatchId);
  if (cur && cur.bph && STD_BPH.includes(Number(cur.bph))) bphChoice = String(cur.bph);
  bphSel.value = bphChoice;

  box.append(
    el('div', { class: 'notice warn' }, el('b', {}, 'Experimental. '), 'A phone microphone is far less sensitive than a real timegrapher, so treat the numbers as a rough guide. Amplitude can’t be measured this way.'),
    el('div', { class: 'card tg-card' },
      el('div', { class: 'row2' }, watchSel, bphSel),
      el('div', { class: 'tg-mic-row', hidden: true }, el('select', { id: 'tg-mic', class: 'input', 'aria-label': 'Microphone', onchange: (e) => { store.get().tgDevice = e.target.value; store.save(); baseline = null; if (mode !== 'off') stop(); } })),
      el('div', { class: 'tg-readout' },
        el('div', {}, el('div', { class: 'stat-label' }, 'Rate'), el('div', { id: 'tg-rate', class: 'tg-big' }, '—')),
        el('div', {}, el('div', { class: 'stat-label' }, 'Beat error'), el('div', { id: 'tg-be', class: 'tg-mid' }, '—'))),
      el('div', { class: 'tg-meta' }, el('span', { id: 'tg-bph' }, ''), el('span', { id: 'tg-conf' }, '')),
      el('div', { class: 'tg-trace-wrap' },
        el('canvas', { id: 'tg-trace', class: 'tg-trace', 'aria-label': 'Beat timing trace' }),
        el('div', { id: 'tg-count', class: 'tg-count', hidden: true }, '3')),
      el('div', { id: 'tg-sig', class: 'tg-sig' }),
      el('div', { id: 'tg-status', class: 'tg-status' }, 'First measure the background with no watch on the phone, then place the watch and tap Start.'),
      el('div', { id: 'tg-base', class: 'tg-base' },
        el('div', { class: 'tg-base-top' }, el('span', { id: 'tg-base-txt', class: 'small' }, ''), el('button', { type: 'button', id: 'tg-base-btn', class: 'btn sm' }, '')),
        el('div', { class: 'tg-base-track' }, el('span', { id: 'tg-base-bar', class: 'tg-base-bar' }))),
      el('div', { class: 'tg-btns' },
        el('button', { type: 'button', id: 'tg-start', class: 'btn primary' }, '▶ Start'),
        el('button', { type: 'button', id: 'tg-second', class: 'btn' }, '■ Stop mic'),
        el('button', { type: 'button', id: 'tg-save', class: 'btn', disabled: !lastResult, onclick: saveResult }, 'Save to watch'))),
    el('div', { class: 'card' },
      el('h2', { class: 'card-title' }, 'Tips for a good reading'),
      el('ul', { class: 'plain-list small' },
        el('li', {}, 'Measure the background first with the phone exactly where the test will be, but no watch on it. The app then ignores those room sounds.'),
        el('li', {}, 'Use a quiet room — no fans, TV or talking.'),
        el('li', {}, 'Lay the phone on a soft surface and press the watch’s case back against the bottom edge of the phone (where the microphone is).'),
        el('li', {}, 'Wind the watch fully first; keep it still for 20–30 seconds.'),
        el('li', {}, 'Set the beat rate if you know it (e.g. 28,800 bph for most modern Swiss movements, 21,600 for Seiko NH35/4R).'),
        el('li', {}, 'Better microphone: wired earphones with a built-in microphone (USB-C or Lightning) work well. Hold the little microphone against the case back. Once connected, choose it in the Microphone box that appears.'),
        el('li', {}, 'Bluetooth earphones (e.g. AirPods) also work, but their microphones filter out much of the tick, so results are usually weaker.'),
        el('li', {}, 'Test dial up and crown down too — the same positions as the accuracy tracker.'))),
    el('div', { id: 'tg-history' }));
  drawControls();
  renderHistory();
  drawTrace(lastResult);
  listDevices();
}

function tgDetail(w) {
  const x = (w.timegrapher || [])[w.timegrapher?.length - 1];
  if (!x) return null;
  return el('div', { class: 'fact' }, el('span', { class: 'fact-k' }, 'Timegrapher'), el('span', { class: 'fact-v' }, `${signed(x.rate, 1)} s/day · ${x.beatError} ms (${new Date(x.t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })})`));
}

export function register({ registerTool }) {
  registerTool({ id: 'timegrapher', title: 'Timegrapher', icon: '🎙️', desc: 'Experimental: listen to the tick', panel: 'timegrapher', show: render, hide: () => { if (mode !== 'off') stop(); }, order: 70 });
  detailExtras.push(tgDetail);
}
