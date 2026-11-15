// The full-screen "ringing" screen shared by alarms and every timer, plus tone previews.
// Alerts that fire while another is ringing wait their turn.
import { now } from './time.js';
import { el, pad, toast } from './ui.js';
import { getAudio, unlockAudio } from './countdown.js';
import { playTone, RAMP, normTone, TONES } from './music.js';

const GIVE_UP_MS = 10 * 60 * 1000;
const $ = (id) => document.getElementById(id);
let cur = null, queue = [], timer = null, player = null, wake = null, started = 0;

/**
 * opts: { icon, title, label, sound, sunlit, buttons: [{ label, kind, fn }], onTimeout }
 * The first button is the main one; every button stops the sound.
 */
export function ringAlert(opts) {
  if (cur) { queue.push(opts); return; }
  stopPreview();
  cur = opts;
  started = Date.now();
  const overlay = el('div', { id: 'alarm-ring', class: 'alarm-ring' + (opts.sunlit ? ' sunlit' : ''), role: 'alertdialog', 'aria-label': opts.title || 'Alarm' },
    el('div', { class: 'ar-icon' }, opts.icon || '⏰'),
    el('div', { class: 'ar-time', id: 'ar-time' }, ''),
    el('div', { class: 'ar-label' }, opts.title || 'Alarm'),
    opts.label ? el('div', { class: 'ar-sub' }, opts.label) : null,
    el('div', { class: 'ar-btns' + (opts.buttons.length === 1 ? ' one' : '') }, opts.buttons.map((b) =>
      el('button', { type: 'button', class: 'btn ' + (b.kind || ''), onclick: () => finish(b.fn) }, b.label))));
  document.body.append(overlay);
  if ('wakeLock' in navigator) navigator.wakeLock.request('screen').then((w) => { wake = w; }).catch(() => {});
  if (navigator.vibrate) try { navigator.vibrate([400, 200, 400]); } catch (e) { /* not supported */ }
  beat();
  timer = setInterval(beat, 1000);
}

export const isRinging = () => !!cur;

function beat() {
  const t = $('ar-time');
  if (t) { const x = new Date(now()); t.textContent = `${pad(x.getHours())}:${pad(x.getMinutes())}`; }
  const tone = normTone(cur.sound);
  const [v0, v1, secs] = RAMP[tone];
  const vol = Math.min(v1, v0 + ((Date.now() - started) / 1000 / secs) * (v1 - v0));
  if (!player) { const ctx = getAudio(); if (ctx) player = playTone(ctx, tone, vol); }
  else player.setVolume(vol);
  if (Date.now() - started > GIVE_UP_MS) { const f = cur.onTimeout; finish(f); }
}

function finish(fn) {
  clearInterval(timer); timer = null;
  player?.stop(); player = null;
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
  if (prevBtn) { prevBtn.textContent = '▶ Play'; prevBtn = null; }
}

/** Play/stop a 12-second sample of a tone. `btn` shows ▶/■. */
export function previewTone(tone, btn) {
  const same = prev && prevBtn === btn;
  stopPreview();
  if (same) return;
  unlockAudio();
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
