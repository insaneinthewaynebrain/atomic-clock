// Experimental timegrapher: listens to the watch through the phone microphone,
// detects ticks and estimates rate (s/day) and beat error (ms).
import * as store from './store.js';
import { el, toast, signed } from './ui.js';
import { ownedWatches, getWatch, detailExtras } from './collection.js';

const STD_BPH = [18000, 19800, 21600, 25200, 28800, 36000];
const WINDOW_S = 20;          // analyse the last 20 seconds
const MIN_S = 6;              // need at least this much before showing a result
const $ = (id) => document.getElementById(id);

let ctx = null, stream = null, node = null;
let running = false;
let ticks = [];               // tick times in seconds (audio clock)
let env = 0, noise = 0.0005, peak = 0.01, armed = true, lastTick = -1;
let startT = 0, settleUntil = 0, lastResult = null, uiTimer = null, bphChoice = 'auto';

/* ---------- Signal processing ---------- */
function processBlock(start, data, sr) {
  const T = currentPeriod() || 0.1;
  const refractory = T * 0.55;
  const attack = 1 - Math.exp(-1 / (sr * 0.0002));
  const release = 1 - Math.exp(-1 / (sr * 0.004));
  const noiseK = 1 - Math.exp(-1 / (sr * 1.5));
  const peakDecay = Math.exp(-1 / (sr * 3));
  for (let i = 0; i < data.length; i++) {
    const a = Math.abs(data[i]);
    env += (a > env ? attack : release) * (a - env);
    if (env < noise * 3) noise += noiseK * (env - noise);   // follow the quiet floor only
    peak = Math.max(peak * peakDecay, env);
    const thr = noise + 0.35 * (peak - noise);
    const t = (start + i) / sr;
    if (t < settleUntil) continue;          // skip the first moments while the microphone settles
    if (armed && env > thr && env > noise * 4 && t - lastTick > refractory) {
      ticks.push(t); lastTick = t; armed = false;
    } else if (!armed && env < noise + 0.15 * (peak - noise)) armed = true;
  }
  const cutoff = (start + data.length) / sr - WINDOW_S;
  while (ticks.length && ticks[0] < cutoff) ticks.shift();
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
  // Assign beat numbers, skipping missed beats; keep one tick per beat.
  const pts = [];
  let lastN = -1;
  for (const t of ts) {
    const n = Math.round((t - t0) / T);
    if (n !== lastN) { pts.push([n, t]); lastN = n; }
  }
  if (pts.length < 8) return null;
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
  const f = fit(pts);
  if (!f) return null;
  const resid = pts.map(([n, t]) => t - (f.a + f.b * n + f.c * (n % 2)));
  const sd = Math.sqrt(resid.reduce((s, r) => s + r * r, 0) / resid.length);
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

async function start() {
  if (running) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus('This browser can’t use the microphone here. Try opening the app link in Safari.', 'bad');
    return;
  }
  // The clock’s beeps put the iPhone in “playback only” mode, which blocks the microphone.
  setSession('play-and-record');
  try {
    stream = await openMic(store.get().tgDevice || '');
  } catch (e) {
    setSession('playback');
    setStatus((MIC_ERRORS[e.name] || 'Could not use the microphone.') + (MIC_ERRORS[e.name] ? '' : ` (${e.name || 'error'}${e.message ? ': ' + e.message : ''})`), 'bad');
    return;
  }
  listDevices();
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    await ctx.audioWorklet.addModule('js/tick-worklet.js');
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop()); stream = null; setSession('playback');
    setStatus(`This phone’s browser can’t process audio this way (${e.name || 'error'}). Please update iOS.`, 'bad');
    return;
  }
  const src = ctx.createMediaStreamSource(stream);
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500; hp.Q.value = 0.7;
  node = new AudioWorkletNode(ctx, 'tick-tap');
  const mute = ctx.createGain(); mute.gain.value = 0;
  src.connect(hp).connect(node).connect(mute).connect(ctx.destination);
  const sr = ctx.sampleRate;
  node.port.onmessage = (e) => processBlock(e.data.start, e.data.data, sr);
  ticks = []; env = 0; noise = 0.0005; peak = 0.01; armed = true; lastTick = -1; lastResult = null;
  await ctx.resume();
  startT = ctx.currentTime;
  settleUntil = startT + 2;
  running = true;
  setStatus('Listening… hold the watch against the bottom of the phone.', '');
  uiTimer = setInterval(update, 500);
  drawControls();
}

function stop() {
  running = false;
  clearInterval(uiTimer);
  try { node && node.disconnect(); } catch (e) { /* ignore */ }
  if (stream) stream.getTracks().forEach((t) => t.stop());
  if (ctx) ctx.close().catch(() => {});
  ctx = stream = node = null;
  setSession('playback');
  drawControls();
  if (lastResult) setStatus('Stopped. Save the result to a watch below, or start again.', '');
  else setStatus('Stopped.', '');
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
  if (!running) return;
  const elapsed = ctx.currentTime - startT;
  const bph = bphChoice === 'auto' ? estimateBph(ticks) : Number(bphChoice);
  $('tg-bph').textContent = bph ? `${bph.toLocaleString('en-GB')} bph${bphChoice === 'auto' ? ' (auto)' : ''}` : 'Detecting beat…';
  const r = elapsed >= MIN_S + 2 ? analyse(ticks, bph) : null;
  if (!r) {
    $('tg-rate').textContent = '—'; $('tg-be').textContent = '—'; $('tg-conf').textContent = ticks.length ? `${ticks.length} ticks heard` : 'No ticks yet';
    if (elapsed > 12 && ticks.length < 10) setStatus('Not hearing clear ticks. Try a quieter room and press the case back against the bottom of the phone.', 'warn');
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
  const btn = $('tg-start');
  if (!btn) return;
  btn.textContent = running ? '■ Stop' : '● Start listening';
  btn.classList.toggle('danger', running);
  btn.classList.toggle('primary', !running);
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
      el('div', { class: 'tg-mic-row', hidden: true }, el('select', { id: 'tg-mic', class: 'input', 'aria-label': 'Microphone', onchange: (e) => { store.get().tgDevice = e.target.value; store.save(); if (running) { stop(); start(); } } })),
      el('div', { class: 'tg-readout' },
        el('div', {}, el('div', { class: 'stat-label' }, 'Rate'), el('div', { id: 'tg-rate', class: 'tg-big' }, '—')),
        el('div', {}, el('div', { class: 'stat-label' }, 'Beat error'), el('div', { id: 'tg-be', class: 'tg-mid' }, '—'))),
      el('div', { class: 'tg-meta' }, el('span', { id: 'tg-bph' }, ''), el('span', { id: 'tg-conf' }, '')),
      el('canvas', { id: 'tg-trace', class: 'tg-trace', 'aria-label': 'Beat timing trace' }),
      el('div', { id: 'tg-status', class: 'tg-status' }, 'Tap Start, then hold the watch against the phone.'),
      el('div', { class: 'actions2' },
        el('button', { type: 'button', id: 'tg-start', class: 'btn primary', onclick: () => (running ? stop() : start()) }, '● Start listening'),
        el('button', { type: 'button', id: 'tg-save', class: 'btn', disabled: !lastResult, onclick: saveResult }, 'Save to watch'))),
    el('div', { class: 'card' },
      el('h2', { class: 'card-title' }, 'Tips for a good reading'),
      el('ul', { class: 'plain-list small' },
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
  registerTool({ id: 'timegrapher', title: 'Timegrapher', icon: '🎙️', desc: 'Experimental: listen to the tick', panel: 'timegrapher', show: render, hide: () => { if (running) stop(); }, order: 70 });
  detailExtras.push(tgDetail);
}
