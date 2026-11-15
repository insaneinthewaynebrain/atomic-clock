// Minute countdown on the Clock tab: a ring counting down to the next minute that glows
// green → amber → red with ripples in the last seconds, plus optional radio-style time pips
// (5 short + 1 long exactly on the minute).
import { now } from './time.js';
import { el, pad } from './ui.js';

// A tiny silent WAV: playing it from a tap switches older iPhones into "media" audio mode.
const SILENT_WAV = 'data:audio/wav;base64,UklGRmQGAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YUAGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

let audio = null, silentEl = null, unlocked = false;
let lastScheduled = 0, lastWhole = null, lastSec = '', lastTarget = '';
const CIRC = 2 * Math.PI * 108;
const $ = (id) => document.getElementById(id);
// Beeps are always on.
const mode = () => 'beeps';

/* ---------- Sound ---------- */
// Must run inside a tap. Makes Web Audio play even with the iPhone's silent switch on.
function unlockAudio() {
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* older iOS */ }
  try {
    if (!silentEl) { silentEl = new Audio(SILENT_WAV); silentEl.setAttribute('playsinline', ''); }
    silentEl.play().catch(() => {});
  } catch (e) { /* ignore */ }
  try {
    if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    if (audio.state !== 'running') audio.resume();
    const b = audio.createBuffer(1, 1, 22050), s = audio.createBufferSource();
    s.buffer = b; s.connect(audio.destination); s.start(0);
    unlocked = true;
  } catch (e) { unlocked = false; }
  updateHint();
}

function pip(atAudioTime, long) {
  const o = audio.createOscillator(), g = audio.createGain();
  o.type = 'sine';
  o.frequency.value = 1000;                       // 1 kHz, like the BBC time pips
  const dur = long ? 0.5 : 0.1;
  g.gain.setValueAtTime(0.0001, atAudioTime);
  g.gain.linearRampToValueAtTime(0.9, atAudioTime + 0.004);
  g.gain.setValueAtTime(0.9, atAudioTime + dur - 0.01);
  g.gain.linearRampToValueAtTime(0.0001, atAudioTime + dur);
  o.connect(g).connect(audio.destination);
  o.start(atAudioTime); o.stop(atAudioTime + dur + 0.02);
}

function soundReady() { return audio && audio.state === 'running'; }

/* ---------- Colours ---------- */
const GREEN = [34, 197, 94], AMBER = [251, 191, 36], RED = [239, 68, 68];
const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
function ringColour(left) {
  if (left > 10) return GREEN;
  if (left > 5) return mix(GREEN, AMBER, (10 - left) / 5);
  return mix(AMBER, RED, Math.min(1, (5 - left) / 4));
}

function pulse(rgb, big) {
  const box = $('cd-pulses');
  if (!box) return;
  const p = el('span', { class: 'cd-pulse' + (big ? ' big' : '') });
  p.style.setProperty('--pc', big ? '255,255,255' : rgb.join(','));
  p.addEventListener('animationend', () => p.remove());
  box.append(p);
}

/* ---------- Called every animation frame by the clock ---------- */
export function tickCountdown() {
  const ring = $('cd-ring');
  if (!ring) return;
  const t = now();
  const next = Math.floor(t / 60000) * 60000 + 60000;
  const leftMs = next - t;                          // ms until the next minute
  const left = leftMs / 1000;

  // Target time
  const nd = new Date(next);
  const target = `${pad(nd.getHours())}:${pad(nd.getMinutes())}:00`;
  if (target !== lastTarget) { $('cd-target').textContent = target; lastTarget = target; }

  // Seconds and thousandths remaining
  const whole = Math.floor(leftMs / 1000);
  const sec = String(whole);
  if (sec !== lastSec) { $('cd-sec').textContent = sec; lastSec = sec; }
  $('cd-ms').textContent = '.' + pad(Math.floor(leftMs % 1000), 3);

  // Ring: empties as the minute runs out; colour and glow build over the last 10 s.
  const rgb = ringColour(left);
  const k = left > 10 ? 0 : (10 - left) / 10;     // 0 → 1 over the last 10 seconds
  const sinceMinute = 60 - left;
  const flash = sinceMinute < 0.6;                // just after the minute
  ring.style.setProperty('--c', flash ? '255,255,255' : rgb.join(','));
  ring.style.setProperty('--glow', (flash ? 46 : 4 + 40 * k * k).toFixed(1) + 'px');
  ring.style.setProperty('--glowa', (flash ? 0.95 : 0.25 + 0.7 * k).toFixed(2));
  ring.style.setProperty('--spread', (flash ? 1.18 : 1 + 0.12 * k * k).toFixed(3));
  $('cd-arc').style.strokeDashoffset = String(CIRC * (1 - left / 60));
  ring.classList.toggle('urgent', left <= 5);
  ring.classList.toggle('flash', flash);

  // A ripple leaves the ring on each of the last 5 seconds, and a burst on the minute.
  if (whole !== lastWhole) {
    if (lastWhole !== null) {
      if (whole < 5) pulse(rgb, false);
      if (whole === 59 && lastWhole === 0) pulse(rgb, true);
    }
    lastWhole = whole;
  }

  // Pips: schedule each one ~150 ms ahead on the audio clock for exact timing.
  if (mode() === 'beeps' && soundReady()) {
    const lat = (audio.outputLatency || audio.baseLatency || 0);
    for (let s2 = 5; s2 >= 0; s2--) {
      const at = next - s2 * 1000;
      const ms = at - t;
      if (ms > 0 && ms < 150 && at > lastScheduled) {
        lastScheduled = at;
        pip(audio.currentTime + Math.max(0, ms / 1000 - lat), s2 === 0);
      }
    }
  }
}

/* ---------- Sound start-up ---------- */
// iPhone only allows sound after the screen has been touched once since the app opened,
// so the first touch anywhere (tap or scroll) switches the beeps on silently.
function updateHint() {
  const h = $('cd-hint');
  if (h) h.hidden = soundReady();
}

function onFirstTouch() {
  if (soundReady()) return;
  unlockAudio();
  setTimeout(updateHint, 150);
}

export function initCountdown() {
  const slot = $('countdown-slot');
  if (!slot || $('cd-ring')) return;
  slot.append(
    el('div', { id: 'countdown', class: 'countdown' },
      el('div', { id: 'cd-ring', class: 'cd-ring' },
        el('div', { id: 'cd-pulses', class: 'cd-pulses', 'aria-hidden': 'true' }),
        el('div', { class: 'cd-halo', 'aria-hidden': 'true' }),
        el('div', { class: 'cd-svg', 'aria-hidden': 'true', html: `<svg viewBox="0 0 240 240"><circle class="cd-track" cx="120" cy="120" r="108"/><circle id="cd-arc" class="cd-arc" cx="120" cy="120" r="108" transform="rotate(-90 120 120)" stroke-dasharray="${CIRC.toFixed(2)}"/></svg>` }),
        el('div', { class: 'cd-center' },
          el('div', { class: 'cd-next' }, 'Next minute'),
          el('div', { id: 'cd-target', class: 'cd-target' }, '--:--:00'),
          el('div', { class: 'cd-left' }, el('span', { id: 'cd-sec' }, '--'), el('span', { id: 'cd-ms', class: 'cd-ms' }, '.---')),
          el('div', { class: 'cd-unit' }, 'seconds to go')))),
    el('div', { class: 'cd-controls' },
      el('div', { id: 'cd-hint', class: 'cd-hint' }, '🔈 Beeps start after your first touch of the screen'),
      el('details', { class: 'cd-help' },
        el('summary', {}, 'How to set a watch to the second'),
        el('ol', { class: 'steps small' },
          el('li', {}, 'Pull the crown out to the time-setting position. Most mechanical watches “hack”: the seconds hand stops. Stop it at 12.'),
          el('li', {}, 'Set the minute hand exactly on the “Next minute” shown inside the ring.'),
          el('li', {}, 'As the ring turns amber and red, get ready — push the crown in the moment it reaches zero, on the long pip.'),
          el('li', {}, 'Watch doesn’t hack? Wait until its seconds hand passes 12 as the ring hits zero, then set the minute hand.')),
        el('p', { class: 'muted small' }, 'Beeps: five short pips, then a long pip exactly on the minute. They play even with the silent switch on (iOS 16.4 or later); turn the volume up.'))));
  // Try straight away (works where the browser allows it), then on the first touch of any kind.
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* older iOS */ }
  try { audio = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' }); audio.resume().then(updateHint).catch(() => {}); } catch (e) { audio = null; }
  for (const ev of ['pointerdown', 'touchend', 'click', 'keydown']) document.addEventListener(ev, onFirstTouch, true);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && audio) audio.resume().catch(() => {}).finally(updateHint);
  });
  if (audio) audio.onstatechange = updateHint;
  updateHint();
}
