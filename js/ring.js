// The full-screen "ringing" screen shared by alarms and every timer, plus tone previews.
// Alerts that fire while another is ringing wait their turn.
import { now } from './time.js';
import { el, pad, toast } from './ui.js';
import { getAudio, unlockAudio, playBackup, stopBackup } from './countdown.js';
import { playTone, RAMP, normTone, TONES } from './music.js';
import { messagesFor, speak, stopSpeaking } from './wakewords.js';
import * as alarmSound from './alarmsound.js';

const GIVE_UP_MS = 10 * 60 * 1000;
const $ = (id) => document.getElementById(id);
let cur = null, queue = [], timer = null, player = null, wake = null, started = 0;
let msgs = [], nextMsgAt = 0, speaking = false, backupOn = false, mode = 'trying';
const MSG_EVERY = 18000;   // a new wake-up message about every 18 seconds

/**
 * opts: { icon, title, label, sound, sunlit, words: 'speak' | 'show' | 'off', say, buttons: [{ label, kind, fn }], onTimeout }
 * `say`: a sentence spoken over and over (between chimes) until a button is pressed.
 * The first button is the main one; every button stops the sound.
 */
export function ringAlert(opts) {
  if (cur) { queue.push(opts); return; }
  stopPreview();
  cur = opts;
  started = Date.now();
  const overlay = el('div', { id: 'alarm-ring', class: 'alarm-ring' + (opts.sunlit ? ' sunlit' : ''), role: 'alertdialog', 'aria-label': opts.title || 'Alarm',
    onpointerdown: () => {
      unlockAudio();
      // A tap always allows sound: start the recorded tone directly if it isn't already playing.
      if (cur && mode !== 'element') alarmSound.start(toneOf(cur), 1).then((ok) => { if (ok && cur) { player?.stop(); player = null; stopBackup(); backupOn = false; mode = 'element'; } });
      setTimeout(beat, 150);
    } },
    el('div', { class: 'ar-mute', id: 'ar-mute', hidden: true }, '🔇 Tap anywhere to turn the sound on'),
    el('div', { class: 'ar-sound', id: 'ar-sound' }, 'Sound: starting…'),
    el('div', { class: 'ar-icon' }, opts.icon || '⏰'),
    el('div', { class: 'ar-time', id: 'ar-time' }, ''),
    el('div', { class: 'ar-label' }, opts.title || 'Alarm'),
    opts.label ? el('div', { class: 'ar-sub' }, opts.label) : null,
    opts.words && opts.words !== 'off' ? el('div', { class: 'ar-msg', id: 'ar-msg', 'aria-live': 'polite' }) : null,
    el('div', { class: 'ar-btns' + (opts.buttons.length === 1 ? ' one' : '') }, opts.buttons.map((b) =>
      el('button', { type: 'button', class: 'btn ' + (b.kind || ''), onclick: () => finish(b.fn) }, b.label))));
  document.body.append(overlay);
  if ('wakeLock' in navigator) navigator.wakeLock.request('screen').then((w) => { wake = w; }).catch(() => {});
  if (navigator.vibrate) try { navigator.vibrate([400, 200, 400]); } catch (e) { /* not supported */ }
  // First choice: the recorded tone through ordinary audio playback (dependable on iPhone/iPad).
  mode = 'trying';
  const mine = opts, toneName = toneOf(opts);
  alarmSound.start(toneName, RAMP[toneName][0]).then((ok) => {
    if (cur !== mine) { if (ok) alarmSound.stop(); return; }
    mode = ok ? 'element' : 'webaudio';
    beat();
  });
  msgs = opts.words && opts.words !== 'off' ? messagesFor(opts.sound) : [];
  nextMsgAt = Date.now() + 2500;
  speaking = false;
  beat();
  timer = setInterval(beat, 1000);
}

const toneOf = (o) => (o.sound === 'chime' ? 'chime' : normTone(o.sound));

function nextMessage() {
  const box = $('ar-msg');
  if (!box || !msgs.length) return;
  const m = msgs.shift(); msgs.push(m);
  box.classList.remove('show');
  box.innerHTML = '';
  box.append(el('div', { class: 'ar-msg-text' }, `“${m.text.replace(/^[“"]|[”"]$/g, '')}”`));
  if (m.by) box.append(el('div', { class: 'ar-msg-by' }, '— ' + m.by));
  requestAnimationFrame(() => box.classList.add('show'));
  if (cur.words === 'speak') {
    speaking = true;
    player?.setVolume(0.12);
    const mine = cur;
    speak(m, cur.sound).then(() => { if (cur === mine) speaking = false; });
  }
}

export const isRinging = () => !!cur;

function beat() {
  if (!cur) return;
  const t = $('ar-time');
  if (t) { const x = new Date(now()); t.textContent = `${pad(x.getHours())}:${pad(x.getMinutes())}`; }
  const tone = toneOf(cur);
  const [v0, v1, secs] = RAMP[tone];
  const vol = Math.min(v1, v0 + ((Date.now() - started) / 1000 / secs) * (v1 - v0));
  if (msgs.length && Date.now() >= nextMsgAt) { nextMsgAt = Date.now() + MSG_EVERY; nextMessage(); }
  if (cur.say && !speaking && Date.now() >= nextMsgAt) {
    nextMsgAt = Date.now() + 8000;           // once per chime cycle
    speaking = true;
    player?.setVolume(0.15);
    const mine = cur;
    speak({ text: cur.say }, 'medium').then(() => { if (cur === mine) speaking = false; });
  }
  const v = speaking ? vol * 0.18 : vol;           // music dips while the voice talks
  const status = $('ar-sound');
  if (mode === 'element') {
    alarmSound.setVolume(v);
    if (!alarmSound.playing()) alarmSound.start(tone, v).then((ok) => { if (!ok && cur) mode = 'webaudio'; });
    if (status) status.textContent = '🔊 Sound on';
    const mm = $('ar-mute'); if (mm) mm.hidden = true;
  } else if (mode === 'trying') {
    // waiting for the recorded tone to start
  } else if (!player) {
    const ctx = getAudio();
    if (ctx) { player = playTone(ctx, tone, v); if (backupOn) { stopBackup(); backupOn = false; } }
    else if (!backupOn && Date.now() - started > 1500) {
      // Web Audio is still paused: fall back to the pre-approved chime, and ask for a tap if even that fails.
      backupOn = true;
      playBackup().then((ok) => { const m = $('ar-mute'); if (!ok) { backupOn = false; if (m) m.hidden = false; } });
    }
  } else player.setVolume(v);
  const m = $('ar-mute'); if (m && player) m.hidden = true;
  if (status && mode !== 'element') status.textContent = player ? '🔊 Sound on (live)' : backupOn ? '🔊 Sound on (backup chime)' : mode === 'trying' ? 'Sound: starting…' : '🔇 Sound blocked — tap the screen';
  if (Date.now() - started > GIVE_UP_MS) { const f = cur.onTimeout; finish(f); }
}

function finish(fn) {
  clearInterval(timer); timer = null;
  player?.stop(); player = null;
  stopBackup(); backupOn = false;
  alarmSound.stop(); mode = 'trying';
  stopSpeaking(); msgs = []; speaking = false;
  $('alarm-ring')?.remove();
  if (wake) { wake.release().catch(() => {}); wake = null; }
  cur = null;
  try { fn?.(); } catch (e) { console.error(e); }
  if (queue.length) setTimeout(() => { if (!cur && queue.length) ringAlert(queue.shift()); }, 300);
}

/* ---------- Previews ---------- */
let prev = null, prevTimer = null, prevBtn = null;
export function stopPreview() {
  clearTimeout(prevTimer);
  prev?.stop(); prev = null;
  if (!cur) alarmSound.stop();
  if (prevBtn) { prevBtn.textContent = '▶ Play'; prevBtn = null; }
}

/** Play/stop a 12-second sample of a tone. `btn` shows ▶/■. */
export function previewTone(tone, btn) {
  const same = prev && prevBtn === btn;
  stopPreview();
  if (same) return;
  unlockAudio();
  const t0 = normTone(tone);
  if (alarmSound.ready(t0)) {
    // Same recorded sound the alarm will use, so the preview is a true test.
    alarmSound.start(t0, 0.8).then((ok) => { if (!ok) toast('Sound is blocked — turn the volume up and tap again'); });
    prev = { stop: () => alarmSound.stop() };
    prevBtn = btn || null;
    if (btn) btn.textContent = '■ Stop';
    prevTimer = setTimeout(stopPreview, 12000);
    return;
  }
  setTimeout(() => {
    const ctx = getAudio();
    if (!ctx) { toast('Sound is blocked — turn the volume up and tap again'); return; }
    prev = playTone(ctx, tone, 0.6);
    prevBtn = btn || null;
    if (btn) btn.textContent = '■ Stop';
    prevTimer = setTimeout(stopPreview, 12000);
  }, 120);
}

/** A tone chooser: <select> plus a ▶ Play button. onChange(tone) is called on change. */
export function toneField(value, onChange, label = 'Alarm sound') {
  const sel = el('select', { class: 'input', onchange: () => { stopPreview(); onChange?.(sel.value); } },
    TONES.map(([v, l]) => el('option', { value: v, selected: normTone(value) === v }, l)));
  const btn = el('button', { type: 'button', class: 'btn sm', onclick: () => previewTone(sel.value, btn) }, '▶ Play');
  const field = el('label', { class: 'field' }, el('span', {}, label), el('div', { class: 'row-sound' }, sel, btn));
  field.select = sel;
  return field;
}
