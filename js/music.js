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
export const RAMP = { soft: [0.25, 0.9, 60], medium: [0.35, 0.9, 30], harsh: [0.6, 1, 8] };

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
      const b = BELL[i];
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

/* ---------- Medium: bright pop ---------- */
function medium(ctx, bus) {
  const lead = echo(ctx, bus, 0.39, 0.25, 3000);   // dotted-eighth echo at 116 bpm
  const ROOT = [36, 43, 45, 41];                     // C · G · Am · F
  const TRI = [[60, 64, 67], [59, 62, 67], [57, 60, 64], [57, 60, 65]];
  const BASS = [0, null, 12, null, 0, null, 12, 0, null, 0, 12, null, 0, null, 12, 7];
  const HOOK = [
    [[0, 72, 2], [2, 76, 2], [4, 79, 3], [8, 76, 2], [10, 77, 2], [12, 76, 2], [14, 74, 2]],
    [[0, 74, 2], [2, 71, 2], [4, 74, 3], [8, 79, 4], [12, 77, 2], [14, 76, 2]],
    [[0, 72, 2], [2, 76, 2], [4, 81, 3], [8, 79, 2], [10, 76, 2], [12, 77, 2], [14, 76, 2]],
    [[0, 77, 3], [4, 76, 2], [6, 74, 2], [8, 72, 6], [14, 74, 2]],
  ];
  return {
    bpm: 116, div: 4,
    step(s, t, sd) {
      const bar = Math.floor(s / 16) % 4, i = s % 16, loop = Math.floor(s / 64);
      if (i % 4 === 0) kick(ctx, bus, t, 0.8);
      if (i === 4 || i === 12) { hit(ctx, bus, { t, dur: 0.16, vol: 0.32, type: 'bandpass', f: 1500, q: 1 }); hit(ctx, bus, { t: t + 0.012, dur: 0.12, vol: 0.22, type: 'bandpass', f: 1200 }); }
      hit(ctx, bus, { t, dur: 0.04, vol: i % 4 === 2 ? 0.12 : 0.04, f: 8000 });
      const bn = BASS[i];
      if (bn != null) voice(ctx, bus, { type: 'square', f: hz(ROOT[bar] + bn), t, dur: sd * 0.8, vol: 0.09, a: 0.005, r: 0.06, lp: 900, lpTo: 300 });
      if (i === 2 || i === 6 || i === 10 || i === 14 || (i === 7 && bar === 3)) {
        for (const n of TRI[bar]) {
          voice(ctx, bus, { type: 'sawtooth', f: hz(n), t, dur: sd * 1.2, vol: 0.028, a: 0.004, r: 0.08, lp: 2600, lpTo: 700, detune: -7 });
          voice(ctx, bus, { type: 'sawtooth', f: hz(n), t, dur: sd * 1.2, vol: 0.028, a: 0.004, r: 0.08, lp: 2600, lpTo: 700, detune: 7 });
        }
      }
      if (s >= 32) {   // the hook comes in after two bars
        for (const [st, n, len] of HOOK[bar]) {
          if (st !== i) continue;
          const up = loop % 4 === 3 ? 12 : 0;
          voice(ctx, lead, { type: 'square', f: hz(n + up), t, dur: sd * len * 0.85, vol: 0.045, a: 0.01, r: 0.12, lp: 3800 });
          voice(ctx, lead, { type: 'triangle', f: hz(n + 12 + up), t, dur: sd * len * 0.85, vol: 0.03, a: 0.01, r: 0.12 });
        }
      }
    },
  };
}

/* ---------- Harsh: heavy rock ---------- */
function harsh(ctx, bus) {
  // Guitar chain: pre-gain → waveshaper distortion → "cab" filters.
  const pre = ctx.createGain(); pre.gain.value = 3;
  const sh = ctx.createWaveShaper();
  const k = 80, c = new Float32Array(2048);
  for (let i = 0; i < c.length; i++) { const x = (i * 2) / c.length - 1; c[i] = ((1 + k) * x) / (1 + k * Math.abs(x)); }
  sh.curve = c; sh.oversample = '4x';
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 90;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4200;
  const mid = ctx.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 900; mid.gain.value = -5;
  const amp = ctx.createGain(); amp.gain.value = 0.22;
  pre.connect(sh).connect(hp).connect(mid).connect(lp).connect(amp).connect(bus);
  // [step, root (MIDI), length in 16ths, accent]
  const A = [[0, 40, 1, 0], [2, 40, 1, 0], [3, 40, 1, 0], [4, 40, 1, 0], [6, 40, 1, 0], [7, 40, 1, 0], [8, 43, 3, 1], [11, 40, 1, 0], [12, 45, 2, 1], [14, 46, 2, 1]];
  const RIFF = [
    A,
    [...A.slice(0, 8), [12, 43, 2, 1], [14, 41, 2, 1]],
    A,
    [[0, 40, 1, 0], [1, 40, 1, 0], [2, 40, 1, 0], [3, 40, 1, 0], [4, 40, 1, 0], [6, 40, 1, 0], [8, 38, 4, 1], [12, 41, 4, 1]],
  ];
  return {
    bpm: 160, div: 4,
    step(s, t, sd) {
      const bar = Math.floor(s / 16) % 4, i = s % 16, loop = Math.floor(s / 64);
      for (const [st, n, len, acc] of RIFF[bar]) {
        if (st !== i) continue;
        const dur = acc ? sd * len * 0.95 : sd * 0.55;
        const tone = acc ? 5000 : 1100;      // palm-muted chugs are darker
        for (const [iv, v] of [[0, 0.5], [7, 0.35], [12, 0.25]]) {
          voice(ctx, pre, { type: 'sawtooth', f: hz(n + iv), t, dur, vol: v, a: 0.003, r: acc ? 0.12 : 0.03, detune: -8, lp: tone });
          voice(ctx, pre, { type: 'sawtooth', f: hz(n + iv), t, dur, vol: v * 0.8, a: 0.003, r: acc ? 0.12 : 0.03, detune: 9, lp: tone });
        }
        voice(ctx, bus, { type: 'square', f: hz(n - 12), t, dur, vol: 0.12, a: 0.004, r: 0.05, lp: 500 });
      }
      // Drums: double kick on 16ths in the second half of each loop, 8ths otherwise.
      if (i % 2 === 0 || bar >= 2) kick(ctx, bus, t, 0.85, 180);
      if (i === 4 || i === 12) snare(ctx, bus, t, 0.6);
      if (i % 2 === 0) hit(ctx, bus, { t, dur: 0.07, vol: 0.09, f: 9000 });
      if (i === 0 && (bar === 0 || bar === 2)) hit(ctx, bus, { t, dur: 1.4, vol: 0.28, f: 5000 });
      if (bar === 3 && i >= 12 && loop % 2) snare(ctx, bus, t, 0.45);   // fill
    },
  };
}

const STYLES = { soft, medium, harsh };

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
  const S = (STYLES[normTone(tone)])(ctx, bus);
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
