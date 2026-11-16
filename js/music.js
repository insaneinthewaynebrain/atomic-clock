// Alarm music, composed for this app and synthesised live on the phone with Web Audio, so it's
// royalty-free by construction (no recordings, no downloads, works offline).
//   soft   – spa: slow warm pads, glassy bells with echo, distant waves
//   medium – a classic digital alarm clock (beep-beep-beep-beep)
//   harsh  – an old twin-bell wind-up alarm clock ringing flat out
export const TONES = [
  ['soft', 'Soft — relaxing spa music'],
  ['medium', 'Medium — classic alarm clock beeps'],
  ['harsh', 'Harsh — loud ringing bell clock (get up!)'],
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

/* ---------- Medium and Harsh: real alarm-clock sounds, made sample by sample ----------
 These are worked out directly as audio samples (no music engine), which is quick and sounds like
 the real thing:
   medium – a classic digital bedside alarm: four short beeps, a pause, repeat
   harsh  – an old wind-up twin-bell alarm clock: a hammer rattling between two metal bells,
            modelled as ringing metal (each bell's own overtones), with mechanical clatter */
function beepAlarm(rate) {
  const cycle = 1.2, loops = 10, n = Math.round(rate * cycle * loops), d = new Float32Array(n);
  const f = 1046.5;                                           // C6: clear without being shrill
  for (let i = 0; i < n; i++) {
    const t = (i / rate) % cycle;
    const k = Math.floor(t / 0.16), u = t - k * 0.16;          // 4 beeps, each 0.09 s on / 0.07 s off
    if (k > 3 || u > 0.09) continue;
    const env = Math.min(1, u / 0.004, (0.09 - u) / 0.006);    // soft edges: no clicks
    const ph = 2 * Math.PI * f * (i / rate);
    d[i] = env * (Math.sin(ph) + 0.32 * Math.sin(3 * ph) + 0.12 * Math.sin(5 * ph) + 0.05 * Math.sin(7 * ph)) * 0.7;   // piezo-buzzer character
  }
  return d;
}

function bellAlarm(rate) {
  const cycle = 3, ringFor = 2.4, loops = 3, n = Math.round(rate * cycle * loops), d = new Float32Array(n);
  // Two slightly mistuned bells (that clash is what makes them so hard to ignore).
  const bells = [2050, 2390].map((f0) => [[1, 1, 0.9], [1.59, 0.6, 0.55], [2.14, 0.45, 0.4], [2.65, 0.32, 0.3], [3.17, 0.24, 0.22], [4.07, 0.14, 0.15]]
    .filter(([r]) => f0 * r < rate * 0.45)
    .map(([r, amp, decay]) => {
      const w = 2 * Math.PI * f0 * r / rate, rr = Math.exp(-1 / (decay * rate));
      return { c: 2 * rr * Math.cos(w), r2: rr * rr, amp, y1: 0, y2: 0 };
    }));
  const hammerHz = 16;                                       // strikes per second on each bell
  let clatter = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate, tc = t % cycle;
    const ringing = tc < ringFor;
    let out = 0;
    for (let b = 0; b < 2; b++) {
      // The hammer hits bell 0, then bell 1, half a stroke later.
      let x = 0;
      if (ringing) {
        const phase = (tc * hammerHz + b * 0.5) % 1, prev = ((tc - 1 / rate) * hammerHz + b * 0.5) % 1;
        if (phase < prev) { x = 0.6 + Math.random() * 0.4; clatter = 1; }
      }
      for (const m of bells[b]) {
        const y = m.c * m.y1 - m.r2 * m.y2 + x * m.amp;
        m.y2 = m.y1; m.y1 = y; out += y;
      }
    }
    clatter *= Math.exp(-1 / (0.004 * rate));               // short metallic tick of the hammer
    out += clatter * (Math.random() * 2 - 1) * 0.6;
    d[i] = Math.tanh(out * 0.09) ;                           // driven hard, like a cheap clock speaker... or a real bell
  }
  return d;
}

const SAMPLED = { medium: [beepAlarm, 22050], harsh: [bellAlarm, 44100] };
const sampledCache = {};
function sampled(tone) {
  if (!sampledCache[tone]) { const [fn, rate] = SAMPLED[tone]; sampledCache[tone] = { rate, data: fn(rate) }; }
  return sampledCache[tone];
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

const STYLES = { soft, chime };

/**
 * Start a tone looping. Returns { setVolume(v), stop() }.
 * Nothing is scheduled more than half a second ahead, so stop() is immediate.
 */
export function playTone(ctx, tone, volume = 0.6) {
  tone = tone === 'chime' ? 'chime' : normTone(tone);
  if (SAMPLED[tone]) {
    const { rate, data } = sampled(tone);
    const buf = ctx.createBuffer(1, data.length, rate); buf.copyToChannel(data, 0);
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const g = ctx.createGain(); g.gain.value = volume;
    src.connect(g).connect(ctx.destination); src.start();
    return {
      setVolume(v) { g.gain.setTargetAtTime(v, ctx.currentTime, 0.3); },
      stop() { try { g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.03); src.stop(ctx.currentTime + 0.2); } catch (e) { /* gone */ } },
    };
  }
  const out = ctx.createGain(); out.gain.value = volume;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.2;
  const bus = ctx.createGain();
  bus.connect(comp).connect(out).connect(ctx.destination);
  const S = STYLES[tone](ctx, bus);
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
const TEMPO = { soft: [60, 2], chime: [60, 2] };
const LOOP = { soft: [128, 0, 0.7], chime: [16, 0, 0.8] };   // soft ≈ 64 s, chime 8 s   // steps, first step, peak level

/** Bump when any tone's music changes, so phones record the new version. */
export const TONES_VERSION = 4;

function wavUrl(d, rate, peak) {
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

export async function renderTone(tone, rate = 22050) {
  if (SAMPLED[tone]) { const sm = sampled(tone); return wavUrl(sm.data, sm.rate, tone === 'harsh' ? 0.98 : 0.85); }
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
  return wavUrl(buf.getChannelData(0), rate, peak);
}
