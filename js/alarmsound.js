// Plays alarm tones through ordinary <audio> elements (the dependable route on iPhone and iPad).
// Each tone is recorded on the phone when the app starts (music.js renderTone). Every tap in the app
// "blesses" the elements — a silent play-and-pause — so iOS lets them play later without a tap.
import { renderTone } from './music.js';

const TONES = ['soft', 'medium', 'harsh', 'chime'];
const els = {};          // tone -> HTMLAudioElement
let preparing = null, current = null;

/** Record all the tones (once). Safe to call many times. */
export function prepare() {
  if (preparing) return preparing;
  preparing = (async () => {
    for (const t of TONES) {
      try {
        const url = await renderTone(t);
        const a = new Audio(url);
        a.loop = true; a.preload = 'auto'; a.setAttribute('playsinline', '');
        els[t] = a;
      } catch (e) { console.warn('Could not record tone', t, e); }
    }
  })();
  return preparing;
}

/** Call inside a tap: lets each tone play later on its own. */
export function bless() {
  for (const a of Object.values(els)) {
    if (!a.paused || a === current) continue;
    try {
      a.muted = true;
      a.play().then(() => { if (a !== current) { a.pause(); a.currentTime = 0; } a.muted = false; }).catch(() => { a.muted = false; });
    } catch (e) { /* ignore */ }
  }
}

export const ready = (tone) => !!els[tone];

/** Start a tone looping. Resolves true if the phone is playing it. */
export async function start(tone, volume = 1) {
  stop();
  const a = els[tone];
  if (!a) return false;
  current = a;
  a.muted = false; a.currentTime = 0;
  try { a.volume = volume; } catch (e) { /* iOS ignores volume */ }
  try { await a.play(); return current === a; } catch (e) { if (current === a) current = null; return false; }
}

export function setVolume(v) { if (current) try { current.volume = Math.max(0, Math.min(1, v)); } catch (e) { /* iOS */ } }
export function stop() { if (current) { try { current.pause(); current.currentTime = 0; } catch (e) { /* ignore */ } current = null; } }
export const playing = () => !!current && !current.paused;
