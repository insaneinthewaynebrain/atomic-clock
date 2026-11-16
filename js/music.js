// Alarm music, composed for this app and synthesised live on the phone with Web Audio, so it's
// royalty-free by construction (no recordings, no downloads, works offline).
//   soft   – spa: slow warm pads, glassy bells with echo, distant waves
//   medium – bright pop: four-on-the-floor beat, bouncy bass, chord stabs, a catchy hook
//   harsh  – heavy rock: distorted palm-muted power-chord riff, double kick, crashes
export const TONES = [
  ['soft', 'Soft — relaxing spa music'],
  ['medium', 'Medium — bright, upbeat pop'],
  ['harsh', 'Harsh — heavy rock (get up!)'],
];
export const TONE_SHORT = { soft: 'Soft', medium: 'Medium', harsh: 'Harsh' };

/** Map older saved sounds (beeps / chime / pips) onto the three tones. */
export function normTone(s) {
  if (s === 'soft' || s === 'medium' || s === 'harsh') return s;
  return s === 'chime' ? 'soft' : 'medium';
}

/** How each tone builds: starting volume, full volume and seconds to get there. */
export const RAMP = { soft: [0.25, 0.9, 60], medium: [0.35, 0.9, 30], harsh: [0.6, 1, 8], chime: [0.55, 0.9, 20] };

const hz = (n) => 440 * Math.pow(2, (n - 69) / 12);

let noiseBuf = null;
function noise(ctx) {
  if (!noiseBuf || noiseBuf.sampleRate !== ctx.sampleRate) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

function voice(ctx, dest, { type = 'sine', f, t, dur, vol, a = 0.01, r = 0.1, detune = 0, lp, lpTo, q = 0.7 }) {
  const o = ctx.createOscillator();
  o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = detune;
  const g = ctx.createGain();
  const hold = Math.max(a, dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + a);
  g.gain.setValueAtTime(vol, t + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + hold + r);
  let n = o;
  if (lp) {
    const fl = ctx.createBiquadFilter();
    fl.type = 'lowpass'; fl.Q.value = q;
    fl.frequency.setValueAtTime(lp, t);
    if (lpTo) fl.frequency.exponentialRampToValueAtTime(lpTo, t + hold + r);
    o.connect(fl); n = fl;
  }
  n.connect(g).connect(dest);
  o.start(t); o.stop(t + hold + r + 0.05);
  return o;
}

function hit(ctx, dest, { t, dur, vol, type = 'highpass', f = 7000, q = 0.7 }) {
  const s = ctx.createBufferSource();
  s.buffer = noise(ctx);
  const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(fl).connect(g).connect(dest);
  s.start(t, Math.random()); s.stop(t + dur + 0.02);
}

function kick(ctx, dest, t, vol, top = 150) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.setValueAtTime(top, t);
  o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
  o.connect(g).connect(dest); o.start(t); o.stop(t + 0.4);
}

function snare(ctx, dest, t, vol) {
  hit(ctx, dest, { t, dur: 0.2, vol, type: 'bandpass', f: 1900, q: 0.8 });
  voice(ctx, dest, { type: 'triangle', f: 190, t, dur: 0.01, vol: vol * 0.6, a: 0.002, r: 0.1 });
}

function echo(ctx, dest, time, fb, tone) {
  const inp = ctx.createGain(), dl = ctx.createDelay(2), f = ctx.createGain(), lp = ctx.createBiquadFilter();
  dl.delayTime.value = time; f.gain.value = fb; lp.type = 'lowpass'; lp.frequency.value = tone;
  inp.connect(dl); dl.connect(lp); lp.connect(f); f.connect(dl); lp.connect(dest);
  inp.connect(dest);
  return inp;
}

/* ---------- Soft: spa ---------- */
function soft(ctx, bus) {
  const space = echo(ctx, bus, 0.75, 0.42, 2600);
  const padBus = ctx.createGain(); padBus.gain.value = 1;
  const padLp = ctx.createBiquadFilter(); padLp.type = 'lowpass'; padLp.frequency.value = 1300;
  padBus.connect(padLp).connect(space);
  // Distant waves: looping filtered noise whose level swells and falls.
  const sea = ctx.createBufferSource(); sea.buffer = noise(ctx); sea.loop = true;
  const seaLp = ctx.createBiquadFilter(); seaLp.type = 'lowpass'; seaLp.frequency.value = 420;
  const seaG = ctx.createGain(); seaG.gain.value = 0.0001;
  sea.connect(seaLp).connect(seaG).connect(bus); sea.start();
  // Fmaj9 · C/E add9 · Dm9 · B♭maj9 — 8 seconds each
  const CH = [[53, 57, 60, 64, 67], [52, 55, 60, 62, 67], [50, 53, 57, 60, 64], [46, 53, 57, 60, 62]];
  const BELL = [0, null, 2, null, null, 4, null, 1, null, 3, null, null, 2, null, 4, null];
  const BELL2 = [4, null, null, 3, null, 2, null, null, 1, null, 2, null, 4, null, null, 3];   // second minute: a different melody
  return {
    bpm: 60, div: 2,
    step(s, t, sd) {
      const ci = Math.floor(s / 16) % 4, ch = CH[ci], i = s % 16;
      if (i === 0) {
        for (const n of ch) {
          voice(ctx, padBus, { type: 'sine', f: hz(n), t, dur: 6.5, vol: 0.05, a: 2.5, r: 3, detune: -5 });
          voice(ctx, padBus, { type: 'triangle', f: hz(n), t, dur: 6.5, vol: 0.03, a: 3, r: 3, detune: 6 });
        }
        voice(ctx, padBus, { type: 'sine', f: hz(ch[0] - 12), t, dur: 6.5, vol: 0.12, a: 2, r: 3 });
        seaG.gain.setTargetAtTime(0.05, t, 1.6);
        seaG.gain.setTargetAtTime(0.008, t + 4, 1.8);
      }
      const second = Math.floor(s / 64) % 2 === 1;
      const b = (second ? BELL2 : BELL)[i];
      if (b != null && !(ci === 3 && i > 8)) {
        const f = hz(ch[b] + 12 + (s % 32 > 15 && b === 4 ? 12 : 0));
        voice(ctx, space, { type: 'sine', f, t, dur: 0.01, vol: 0.07, a: 0.004, r: 2.4 });
        voice(ctx, space, { type: 'sine', f: f * 2.76, t, dur: 0.01, vol: 0.012, a: 0.002, r: 0.9 });
      }
      void sd;
    },
    dispose() { try { sea.stop(); } catch (e) { /* already stopped */ } },
  };
}

/* ---------- Realistic instruments (used by Medium and Harsh) ---------- */
// Room echo: a convolution reverb with a generated impulse response.
function room(ctx, dest, { secs = 1.8, decay = 3.2, wet = 0.22 } = {}) {
  const sr = ctx.sampleRate, len = Math.floor(sr * secs), ir = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay) * (i < sr * 0.01 ? i / (sr * 0.01) : 1);
  }
  const conv = ctx.createConvolver(); conv.buffer = ir;
  const wetG = ctx.createGain(); wetG.gain.value = wet;
  const inp = ctx.createGain();
  inp.connect(dest); inp.connect(conv).connect(wetG).connect(dest);
  return inp;
}

// Plucked string (Karplus–Strong), worked out at a high internal rate so every note is in tune.
const KS_RATE = 88200;
const ksCache = new WeakMap();
function string(ctx, f, { dur = 2, bright = 0.6, decay = 0.996, body = 0 } = {}) {
  let m = ksCache.get(ctx); if (!m) { m = new Map(); ksCache.set(ctx, m); }
  const key = `${f.toFixed(2)}|${dur}|${bright}|${decay}|${body}`;
  if (m.has(key)) return m.get(key);
  const n = Math.floor(KS_RATE * dur), buf = ctx.createBuffer(1, n, KS_RATE), d = buf.getChannelData(0);
  const N = Math.max(2, Math.round(KS_RATE / f)), line = new Float32Array(N);
  let prev = 0;
  for (let i = 0; i < N; i++) { const x = Math.random() * 2 - 1; prev += bright * (x - prev); line[i] = prev; }
  let idx = 0, peak = 0;
  for (let i = 0; i < n; i++) {
    const a = line[idx], b = line[(idx + 1) % N];
    d[i] = a; line[idx] = decay * (0.5 * (a + b)); idx = (idx + 1) % N;
    peak = Math.max(peak, Math.abs(a));
  }
  if (body) for (let i = 1; i < n; i++) d[i] += body * d[i - 1] * 0.5;   // a little woody warmth
  const k = peak ? 0.9 / peak : 1; for (let i = 0; i < n; i++) d[i] *= k;
  m.set(key, buf);
  return buf;
}
function pluck(ctx, dest, f, t, { vol = 0.3, dur = 2, len = null, bright, decay, lp, body } = {}) {
  const src = ctx.createBufferSource(); src.buffer = string(ctx, f, { dur, bright, decay, body });
  const g = ctx.createGain(); g.gain.setValueAtTime(vol, t);
  if (len != null) { g.gain.setValueAtTime(vol, t + len); g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.06); }
  let n = src;
  if (lp) { const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp; src.connect(fl); n = fl; }
  n.connect(g).connect(dest);
  src.start(t); src.stop(t + (len != null ? len + 0.1 : dur));
}

// Electric piano: two-operator FM with a fading bell, the classic "Rhodes" recipe.
function epiano(ctx, dest, f, t, { vol = 0.12, dur = 1.6 } = {}) {
  const car = ctx.createOscillator(), mod = ctx.createOscillator(), mg = ctx.createGain(), g = ctx.createGain();
  car.frequency.value = f; mod.frequency.value = f;
  mg.gain.setValueAtTime(f * 2.2, t); mg.gain.exponentialRampToValueAtTime(f * 0.15, t + 0.9);
  mod.connect(mg).connect(car.frequency);
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.006);
  g.gain.exponentialRampToValueAtTime(vol * 0.35, t + 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const oscs = [car, mod];
  car.connect(g).connect(dest);
  if (f * 7.1 < ctx.sampleRate * 0.45) {          // the bell-like "tine", when it fits in the recording
    const tine = ctx.createOscillator(), tg = ctx.createGain();
    tine.frequency.value = f * 7.1; tg.gain.setValueAtTime(vol * 0.08, t); tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    tine.connect(tg).connect(dest); oscs.push(tine);
  }
  for (const o of oscs) { o.start(t); o.stop(t + dur + 0.05); }
}

// Drums
function kick2(ctx, dest, t, vol = 0.9, { punch = 1 } = {}) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.setValueAtTime(140 * punch, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.09);
  g.gain.setValueAtTime(vol, t); g.gain.setTargetAtTime(0.0001, t + 0.05, 0.11);
  const sh = ctx.createWaveShaper(); const c = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const x = i / 128 - 1; c[i] = Math.tanh(2.2 * x); } sh.curve = c;
  o.connect(sh).connect(g).connect(dest); o.start(t); o.stop(t + 0.6);
  const s = ctx.createBufferSource(); s.buffer = noise(ctx);
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
  const cg = ctx.createGain(); cg.gain.setValueAtTime(vol * 0.35, t); cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);
  s.connect(hp).connect(cg).connect(dest); s.start(t, Math.random()); s.stop(t + 0.03);
}
function snare2(ctx, dest, t, vol = 0.6) {
  for (const [f, v] of [[185, 0.55], [330, 0.3]]) {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'triangle';
    o.frequency.setValueAtTime(f * 1.3, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.03);
    g.gain.setValueAtTime(vol * v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g).connect(dest); o.start(t); o.stop(t + 0.15);
  }
  const s = ctx.createBufferSource(); s.buffer = noise(ctx);
  const bp = ctx.createBiquadFilter(); bp.type = 'highpass'; bp.frequency.value = 1800;
  const pk = ctx.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 5000; pk.gain.value = 6;
  const g = ctx.createGain(); g.gain.setValueAtTime(vol * 0.9, t); g.gain.setTargetAtTime(0.0001, t + 0.02, 0.06);
  s.connect(bp).connect(pk).connect(g).connect(dest); s.start(t, Math.random()); s.stop(t + 0.35);
}
function clap(ctx, dest, t, vol = 0.5) {
  for (const [dt, v] of [[0, 0.6], [0.011, 0.7], [0.023, 1]]) {
    const s = ctx.createBufferSource(); s.buffer = noise(ctx);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1300; bp.Q.value = 1.4;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol * v, t + dt); g.gain.setTargetAtTime(0.0001, t + dt + 0.004, dt === 0.023 ? 0.05 : 0.008);
    s.connect(bp).connect(g).connect(dest); s.start(t + dt, Math.random()); s.stop(t + dt + 0.3);
  }
}
const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800];     // the classic drum-machine cymbal ratios
function cymbal(ctx, dest, t, { vol = 0.12, dur = 0.05, open = false } = {}) {
  const g = ctx.createGain(), bp = ctx.createBiquadFilter(), hp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = open ? 8500 : 10000; bp.Q.value = 0.8;
  hp.type = 'highpass'; hp.frequency.value = open ? 5000 : 7000;
  g.gain.setValueAtTime(vol, t); g.gain.setTargetAtTime(0.0001, t + 0.005, dur / 3);
  for (const f of METAL) { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f * 1.7; o.connect(bp); o.start(t); o.stop(t + dur * 4 + 0.05); }
  const s = ctx.createBufferSource(); s.buffer = noise(ctx); const ng = ctx.createGain(); ng.gain.value = 0.6;
  s.connect(ng).connect(bp); s.start(t, Math.random()); s.stop(t + dur * 4 + 0.05);
  bp.connect(hp).connect(g).connect(dest);
}

/* ---------- Medium: bright pop ----------
 118 bpm, G major, G–D–Em–C. Electric piano and strummed guitar, plucky bass, a full kit with claps,
 and a plucked-string hook. 16 bars: 4-bar build, 8 bars full with the hook, 4 bars lifted an octave. */
function medium(ctx, bus) {
  const rm = room(ctx, bus, { secs: 1.6, wet: 0.2 });
  const ROOT = [43, 50, 52, 48];                                  // G2 D3 E3 C3
  const CH = [[55, 59, 62, 67], [57, 62, 66, 69], [55, 59, 64, 67], [55, 60, 64, 67]];   // voicings
  const HOOK = [
    [[0, 74, 2], [2, 71, 2], [4, 74, 2], [6, 76, 2], [8, 74, 4], [12, 71, 2], [14, 69, 2]],
    [[0, 69, 2], [2, 66, 2], [4, 69, 2], [6, 71, 2], [8, 69, 6], [14, 66, 2]],
    [[0, 67, 2], [2, 71, 2], [4, 74, 2], [6, 76, 2], [8, 79, 4], [12, 76, 2], [14, 74, 2]],
    [[0, 72, 3], [3, 71, 3], [6, 69, 2], [8, 67, 6], [14, 69, 2]],
  ];
  const BASS = [0, null, null, 12, null, null, 0, null, 0, null, 7, null, 12, null, 7, null];
  return {
    bpm: 118, div: 4,
    step(s, t, sd) {
      const barN = Math.floor(s / 16) % 16, bar = barN % 4, i = s % 16;
      const build = barN < 4, lift = barN >= 12;
      // Drums
      if (i % 4 === 0 && !(build && barN < 2 && i !== 0)) kick2(ctx, rm, t, 0.85);
      if ((i === 4 || i === 12) && !build) clap(ctx, rm, t, 0.42);
      if (!build || barN >= 2) cymbal(ctx, rm, t, { vol: i % 4 === 2 ? 0.11 : 0.05, dur: i % 4 === 2 && i === 14 ? 0.25 : 0.05, open: i === 14 });
      if (barN === 3 && i >= 12) snare2(ctx, rm, t, 0.25 + (i - 12) * 0.08);          // a little roll into the chorus
      if (barN % 4 === 0 && i === 0 && !build) cymbal(ctx, rm, t, { vol: 0.16, dur: 1.4, open: true });
      // Bass
      const bn = BASS[i];
      if (bn != null) pluck(ctx, rm, hz(ROOT[bar] + bn - 12), t, { vol: 0.5, dur: 1, len: sd * 1.6, bright: 0.35, decay: 0.997, lp: 900 });
      // Electric piano on beats 1 and the "and" of 2
      if (i === 0 || i === 6 || (i === 10 && !build)) for (const n of CH[bar]) epiano(ctx, rm, hz(n), t, { vol: 0.07, dur: i === 0 ? 1.8 : 0.9 });
      // Strummed guitar on the off-beats (a few milliseconds between strings)
      if (!build && (i === 2 || i === 6 || i === 10 || i === 14)) {
        CH[bar].forEach((n, k) => pluck(ctx, rm, hz(n + 12), t + k * 0.007, { vol: 0.09, dur: 0.6, len: sd * 1.2, bright: 0.8, decay: 0.994 }));
      }
      // Hook
      if (!build) for (const [st, n, len] of HOOK[bar]) {
        if (st !== i) continue;
        const up = lift ? 12 : 0;
        pluck(ctx, rm, hz(n + up), t, { vol: 0.32, dur: 1.5, len: sd * len, bright: 0.9, decay: 0.998 });
        epiano(ctx, rm, hz(n + up), t, { vol: 0.04, dur: sd * len + 0.2 });
      }
    },
  };
}

/* ---------- Harsh: heavy rock ----------
 150 bpm in E. Two layers of distorted string-modelled guitar through an amp and speaker cabinet,
 a bass guitar, and a full kit. 16 bars: main riff, a variation, double-kick riff, then big open chords. */
function harsh(ctx, bus) {
  const rm = room(ctx, bus, { secs: 1.2, decay: 4, wet: 0.14 });
  const amp = ctx.createGain(); amp.gain.value = 6;
  const sh = ctx.createWaveShaper(); const c = new Float32Array(4096);
  for (let i = 0; i < c.length; i++) { const x = (i * 2) / c.length - 1; c[i] = Math.tanh(4 * x) * 0.9 + 0.1 * Math.tanh(12 * x); }
  sh.curve = c; sh.oversample = '4x';
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 90;
  const scoop = ctx.createBiquadFilter(); scoop.type = 'peaking'; scoop.frequency.value = 650; scoop.gain.value = -6; scoop.Q.value = 0.8;
  const pres = ctx.createBiquadFilter(); pres.type = 'peaking'; pres.frequency.value = 2400; pres.gain.value = 4;
  const cab = ctx.createBiquadFilter(); cab.type = 'lowpass'; cab.frequency.value = 4800; cab.Q.value = 0.9;
  const cab2 = ctx.createBiquadFilter(); cab2.type = 'lowpass'; cab2.frequency.value = 7000;
  const out = ctx.createGain(); out.gain.value = 0.09;
  amp.connect(hp).connect(sh).connect(scoop).connect(pres).connect(cab).connect(cab2).connect(out).connect(rm);
  // [step, root, length in 16ths, open?]
  const A = [[0, 40, 1, 0], [2, 40, 1, 0], [3, 40, 1, 0], [4, 43, 2, 1], [6, 40, 1, 0], [7, 40, 1, 0], [8, 45, 2, 1], [10, 40, 1, 0], [11, 40, 1, 0], [12, 46, 2, 1], [14, 45, 2, 1]];
  const B = [[0, 40, 1, 0], [2, 40, 1, 0], [3, 40, 1, 0], [4, 47, 3, 1], [7, 40, 1, 0], [8, 45, 2, 1], [10, 43, 2, 1], [12, 40, 1, 0], [13, 40, 1, 0], [14, 38, 2, 1]];
  const BIG = [[[0, 40, 16, 1]], [[0, 36, 16, 1]], [[0, 38, 16, 1]], [[0, 43, 8, 1], [8, 45, 8, 1]]];
  const riffFor = (barN) => (barN >= 12 ? BIG[barN - 12] : (barN % 4 === 3 ? B : A));
  const chord = (n, t, len, open) => {
    const dur = open ? Math.max(0.6, len) : 0.25;
    for (const [iv, v, dt] of [[0, 1, 0], [7, 0.8, 0.004], [12, 0.6, 0.008]]) {
      for (const take of [0, 1]) {   // double-tracked
        pluck(ctx, amp, hz(n + iv) * (take ? 1.003 : 1), t + dt + take * 0.006, { vol: v * 0.5, dur: dur + 0.2, len: open ? len : 0.09, bright: 0.95, decay: open ? 0.9985 : 0.99, lp: open ? null : 1400 });
      }
    }
  };
  return {
    bpm: 150, div: 4,
    step(s, t, sd) {
      const barN = Math.floor(s / 16) % 16, i = s % 16;
      const riff = riffFor(barN), big = barN >= 12, dbl = barN >= 8 && barN < 12;
      for (const [st, n, len, open] of riff) {
        if (st !== i) continue;
        chord(n, t, sd * len * 0.98, !!open);
        pluck(ctx, rm, hz(n - 12), t, { vol: 0.55, dur: 1.2, len: sd * len * 0.95, bright: 0.5, decay: 0.997, lp: 700 });   // bass guitar
      }
      // Drums
      if (dbl ? true : (big ? i % 4 === 0 : (i % 2 === 0 && i !== 4 && i !== 12))) kick2(ctx, rm, t, dbl ? 0.7 : 0.9, { punch: 1.2 });
      if (i === 4 || i === 12) snare2(ctx, rm, t, 0.75);
      if (!big && i % 2 === 0) cymbal(ctx, rm, t, { vol: 0.07, dur: 0.06 });
      if (big && i % 4 === 0) cymbal(ctx, rm, t, { vol: 0.08, dur: 0.6, open: true });
      if (i === 0 && barN % 4 === 0) cymbal(ctx, rm, t, { vol: 0.2, dur: 1.8, open: true });
      if (barN === 15 && i >= 8) snare2(ctx, rm, t, 0.45 + (i - 8) * 0.05);     // fill back to the top
    },
  };
}

/* ---------- Chime: the medication reminder ----------
 A clear two-note "ding-dong" every 8 seconds, with quiet in between for the spoken reminder. */
function chime(ctx, bus) {
  const space = echo(ctx, bus, 0.3, 0.25, 3500);
  const bell = (f, t, v) => {
    voice(ctx, space, { type: 'sine', f, t, dur: 0.01, vol: v, a: 0.004, r: 1.8 });
    voice(ctx, space, { type: 'sine', f: f * 2.01, t, dur: 0.01, vol: v * 0.25, a: 0.003, r: 0.8 });
    voice(ctx, space, { type: 'triangle', f: f * 3, t, dur: 0.01, vol: v * 0.08, a: 0.002, r: 0.4 });
  };
  return {
    bpm: 60, div: 2,
    step(s, t) {
      const i = s % 16;
      if (i === 0) bell(hz(88), t, 0.35);      // E6
      if (i === 1) bell(hz(84), t, 0.35);      // C6
    },
  };
}

const STYLES = { soft, medium, harsh, chime };

/**
 * Start a tone looping. Returns { setVolume(v), stop() }.
 * Nothing is scheduled more than half a second ahead, so stop() is immediate.
 */
export function playTone(ctx, tone, volume = 0.6) {
  const out = ctx.createGain(); out.gain.value = volume;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.2;
  const bus = ctx.createGain();
  bus.connect(comp).connect(out).connect(ctx.destination);
  const S = (STYLES[tone] || STYLES[normTone(tone)])(ctx, bus);
  const sd = 60 / S.bpm / S.div;
  let s = 0, next = ctx.currentTime + 0.08, stopped = false;
  const pump = () => {
    if (stopped) return;
    while (next < ctx.currentTime + 0.5) { S.step(s, next, sd); s++; next += sd; }
  };
  pump();
  const iv = setInterval(pump, 90);
  return {
    setVolume(v) { out.gain.setTargetAtTime(v, ctx.currentTime, 0.4); },
    stop() {
      if (stopped) return;
      stopped = true; clearInterval(iv);
      out.gain.cancelScheduledValues(ctx.currentTime);
      out.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.04);
      setTimeout(() => { try { S.dispose?.(); out.disconnect(); } catch (e) { /* gone */ } }, 600);
    },
  };
}

/* ---------- Recorded copies for iPhone / iPad ----------
 iOS can leave live Web Audio silent after the app has been interrupted (it still says "running").
 Ordinary audio playback is far more dependable there, so each tone is recorded once, on the phone,
 into a short seamless loop (a WAV file in memory) that the alarm plays on repeat. */
const TEMPO = { soft: [60, 2], medium: [118, 4], harsh: [150, 4], chime: [60, 2] };
const LOOP = { soft: [128, 0, 0.7], medium: [256, 0, 0.9], harsh: [256, 0, 0.95], chime: [16, 0, 0.8] };   // soft ≈ 64 s, medium ≈ 33 s, harsh ≈ 26 s   // steps, first step, peak level

/** Bump when any tone's music changes, so phones record the new version. */
export const TONES_VERSION = 3;

export async function renderTone(tone, rate = 22050) {
  const [steps, from, peak] = LOOP[tone];
  const [bpm, div] = TEMPO[tone];
  const sd = 60 / bpm / div, secs = steps * sd;
  const ctx = new OfflineAudioContext(1, Math.ceil(secs * rate), rate);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.2;
  const bus = ctx.createGain();
  bus.connect(comp).connect(ctx.destination);
  const S = STYLES[tone](ctx, bus);
  for (let i = 0; i < steps; i++) S.step(from + i, 0.01 + i * sd, sd);
  const buf = await ctx.startRendering();
  const d = buf.getChannelData(0);
  let pk = 0; for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i]));
  const k = pk > 0 ? peak / pk : 1;                      // every tone comes out clearly audible
  const fade = Math.floor(rate * 0.01);                   // tiny fades so the loop point doesn't click
  const n = d.length, wav = new ArrayBuffer(44 + n * 2), v = new DataView(wav);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const g = Math.min(1, i / fade, (n - 1 - i) / fade);
    v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, d[i] * k * g)) * 32767, true);
  }
  return URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
}
