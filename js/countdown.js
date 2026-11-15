// Minute countdown on the Clock tab: shift lights in the last 5 seconds and
// radio-style time pips (5 short + 1 long exactly on the minute).
import * as store from './store.js';
import { now } from './time.js';
import { el, pad, toast } from './ui.js';

// A tiny silent WAV: playing it from a tap switches older iPhones into "media" audio mode.
const SILENT_WAV = 'data:audio/wav;base64,UklGRmQGAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YUAGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

let audio = null, silentEl = null, unlocked = false;
let lastScheduled = 0, lastStage = null;
const $ = (id) => document.getElementById(id);
const mode = () => store.get().countdown || 'off';    // 'off' | 'lights' | 'beeps'

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

/* ---------- Called every animation frame by the clock ---------- */
export function tickCountdown() {
  const m = mode();
  const box = $('countdown');
  if (!box) return;
  const t = now();
  const next = Math.floor(t / 60000) * 60000 + 60000;
  const left = (next - t) / 1000;                 // seconds until the next minute
  const sinceMinute = 60 - left;                  // seconds since the last minute

  // Label
  const nd = new Date(next);
  const label = $('cd-label');
  if (label) label.textContent = m === 'off' ? '' : `Next minute ${pad(nd.getHours())}:${pad(nd.getMinutes())}:00`;

  // Lights: stage 1..5 in the last 5 seconds, 6 = on the minute (flash for 0.8 s)
  let stage = 0;
  if (m !== 'off') {
    if (left <= 5) stage = 6 - Math.ceil(left);   // 5→1 … 1→5
    if (sinceMinute < 0.8) stage = 6;
  }
  if (stage !== lastStage) {
    lastStage = stage;
    const lights = box.querySelectorAll('.sl');
    lights.forEach((l, i) => { l.className = 'sl' + (stage === 6 ? ' go' : i < stage ? (i < 2 ? ' g' : i < 4 ? ' a' : ' r') : ''); });
    const big = $('clk-big');
    big.classList.remove('cd-g', 'cd-a', 'cd-r', 'cd-go');
    if (stage === 6) big.classList.add('cd-go');
    else if (stage >= 5) big.classList.add('cd-r');
    else if (stage >= 3) big.classList.add('cd-a');
    else if (stage >= 1) big.classList.add('cd-g');
    document.querySelector('.clock').classList.toggle('cd-flash', stage === 6);
  }

  // Pips: schedule each one ~150 ms ahead on the audio clock for exact timing.
  if (m === 'beeps' && soundReady()) {
    const lat = (audio.outputLatency || audio.baseLatency || 0);
    for (let s = 5; s >= 0; s--) {
      const at = next - s * 1000;
      const ms = at - t;
      if (ms > 0 && ms < 150 && at > lastScheduled) {
        lastScheduled = at;
        pip(audio.currentTime + Math.max(0, ms / 1000 - lat), s === 0);
      }
    }
  }
}

/* ---------- Controls ---------- */
function updateHint() {
  const h = $('cd-hint');
  if (!h) return;
  const need = mode() === 'beeps' && !soundReady();
  h.hidden = !need;
  h.textContent = need ? 'Tap here to turn the sound on' : '';
}

function setMode(v) {
  store.get().countdown = v;
  store.save();
  if (v === 'beeps') {
    unlockAudio();
    // A test pip so you know sound is working.
    setTimeout(() => { if (soundReady()) pip(audio.currentTime + 0.05, false); else toast('Sound is blocked — check the volume'); }, 120);
  }
  drawControls();
}

function drawControls() {
  const seg = $('cd-seg');
  if (!seg) return;
  seg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.v === mode()));
  $('countdown').classList.toggle('off', mode() === 'off');
  lastStage = null;
  updateHint();
}

export function initCountdown() {
  const anchor = $('clk-big');
  if (!anchor || $('countdown')) return;
  const seg = el('div', { id: 'cd-seg', class: 'seg seg3 cd-seg', role: 'group', 'aria-label': 'Minute countdown' },
    [['off', 'Off'], ['lights', 'Lights'], ['beeps', '+ Beeps']].map(([v, l]) => {
      const b = el('button', { type: 'button', class: 'seg-btn', onclick: () => setMode(v) }, l);
      b.dataset.v = v;
      return b;
    }));
  const box = el('div', { id: 'countdown', class: 'countdown' },
    el('div', { class: 'shift', 'aria-hidden': 'true' }, [0, 1, 2, 3, 4].map(() => el('span', { class: 'sl' }))),
    el('div', { id: 'cd-label', class: 'cd-label' }));
  anchor.after(box);
  // Controls go under the time-zone line.
  const ctl = el('div', { class: 'cd-controls' },
    el('div', { class: 'cd-title' }, '⏱ Minute countdown'),
    seg,
    el('button', { type: 'button', id: 'cd-hint', class: 'cd-hint', hidden: true, onclick: unlockAudio }),
    el('details', { class: 'cd-help' },
      el('summary', {}, 'How to set a watch to the second'),
      el('ol', { class: 'steps small' },
        el('li', {}, 'Turn on the countdown (with beeps if you like). The lights fill over the last 5 seconds of each minute; five short pips, then a long pip exactly on the minute.'),
        el('li', {}, 'Pull the crown out to the time-setting position. Most mechanical watches “hack”: the seconds hand stops. Stop it at 12.'),
        el('li', {}, 'Set the minute hand exactly on the next minute shown.'),
        el('li', {}, 'Push the crown in on the long pip / green flash.'),
        el('li', {}, 'Watch doesn’t hack? Wait until its seconds hand passes 12 together with the long pip, then set the minute hand.')),
      el('p', { class: 'muted small' }, 'Sound plays even with the silent switch on (iOS 16.4 or later); turn the volume up.')));
  const after = $('clock-zone') || $('clk-tz');
  after.after(ctl);
  drawControls();
  // iPhone needs a tap before sound can start, e.g. after reopening the app.
  document.addEventListener('pointerdown', () => { if (mode() === 'beeps' && !soundReady()) unlockAudio(); }, true);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && audio) audio.resume().catch(() => {}).finally(updateHint);
  });
}
