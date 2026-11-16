// Plays alarm tones through one ordinary <audio> element (the dependable route on iPhone and iPad).
// Each tone is recorded on the phone when the app starts (music.js renderTone).
// To be allowed to play later without a tap, the element is "unlocked" once during a tap by playing a
// short SILENT clip — never an alarm tone, so nothing is ever heard when you tap around the app.
import { renderTone } from './music.js';

const TONES = ['soft', 'medium', 'harsh', 'chime'];
const urls = {};         // tone -> blob URL of the recorded loop
let preparing = null, unlocked = false, unlocking = false, playingTone = null;
const player = new Audio();
player.loop = true; player.preload = 'auto'; player.setAttribute('playsinline', '');

function silentUrl() {
  const n = 2205, b = new ArrayBuffer(44 + n * 2), v = new DataView(b);   // 0.1 s of silence
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 22050, true); v.setUint32(28, 44100, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
}
const SILENT = silentUrl();

/** Record all the tones (once). Safe to call many times. */
export function prepare() {
  if (preparing) return preparing;
  preparing = (async () => {
    for (const t of TONES) {
      try { urls[t] = await renderTone(t); } catch (e) { console.warn('Could not record tone', t, e); }
    }
  })();
  return preparing;
}

/** Call inside a tap: plays a silent clip so the element may play alarm tones later on its own. */
export function bless() {
  if (unlocked || unlocking || playingTone) return;
  unlocking = true;
  try {
    player.loop = false; player.src = SILENT;
    player.play().then(() => { unlocked = true; }).catch(() => {}).finally(() => {
      unlocking = false;
      if (!playingTone) { try { player.pause(); } catch (e) { /* ignore */ } player.loop = true; }
    });
  } catch (e) { unlocking = false; }
}

export const ready = (tone) => !!urls[tone];

/** Start a tone looping. Resolves true if the phone is playing it. */
export async function start(tone, volume = 1) {
  if (!urls[tone]) return false;
  playingTone = tone;
  player.loop = true;
  if (!player.src.endsWith(urls[tone])) player.src = urls[tone];
  try { player.currentTime = 0; } catch (e) { /* not loaded yet */ }
  try { player.volume = volume; } catch (e) { /* iOS ignores volume */ }
  try { await player.play(); return playingTone === tone; } catch (e) { if (playingTone === tone) playingTone = null; return false; }
}

export function setVolume(v) { if (playingTone) try { player.volume = Math.max(0, Math.min(1, v)); } catch (e) { /* iOS */ } }
export function stop() { playingTone = null; try { player.pause(); player.currentTime = 0; } catch (e) { /* ignore */ } }
export const playing = () => !!playingTone && !player.paused;
