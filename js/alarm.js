// Alarm clock. A web app can only ring while it's open on screen (the iPhone pauses it when
// locked), so there's a Bedside mode that keeps a dim clock showing all night.
import * as store from './store.js';
import { now } from './time.js';
import { el, openModal, confirmModal, toast, pad } from './ui.js';
import { getAudio, unlockAudio } from './countdown.js';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];   // index 0 = Monday
const SOUNDS = [['beeps', 'Classic beeps'], ['chime', 'Gentle chime'], ['pips', 'Time pips']];
const SNOOZE_MIN = 9;
const CATCH_UP_MS = 2 * 60 * 1000;        // ring if the app was reopened within 2 min of the time
const $ = (id) => document.getElementById(id);
const d = () => store.get();
const alarms = () => (d().alarms ||= []);
const dow = (date) => (date.getDay() + 6) % 7;   // Monday = 0

let ringing = null, ringTimer = null, ringStart = 0, wake = null, bedside = null, bedTimer = null;

/* ---------- Scheduling ---------- */
function todayAt(hhmm, base) {
  const [h, m] = hhmm.split(':').map(Number);
  const x = new Date(base); x.setHours(h, m, 0, 0);
  return x.getTime();
}

/** Next time this alarm will ring (ms), or null. */
export function nextRing(a, t = now()) {
  if (!a.enabled) return null;
  if (a.snoozeAt && a.snoozeAt > t - CATCH_UP_MS) return a.snoozeAt;
  for (let i = 0; i < 8; i++) {
    const base = new Date(t); base.setDate(base.getDate() + i);
    const at = todayAt(a.time, base);
    if (at < t - CATCH_UP_MS) continue;
    if (a.days?.length && !a.days.includes(dow(new Date(at)))) continue;
    if (a.lastFired === at) continue;
    return at;
  }
  return null;
}

export function nextAlarm() {
  let best = null;
  for (const a of alarms()) { const at = nextRing(a); if (at && (!best || at < best.at)) best = { a, at }; }
  return best;
}

function check() {
  if (ringing) return;
  const t = now();
  for (const a of alarms()) {
    const at = nextRing(a, t);
    if (at && t >= at && t - at < CATCH_UP_MS) { ring(a, at); break; }
  }
  updateClockLine();
}

/* ---------- Sound ---------- */
function tone(ctx, at, freq, dur, vol, type = 'sine') {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.linearRampToValueAtTime(vol, at + 0.01);
  g.gain.setValueAtTime(vol, at + dur - 0.03);
  g.gain.linearRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(ctx.destination);
  o.start(at); o.stop(at + dur + 0.05);
}

// One 2-second phrase of the chosen sound; volume builds up over the first 30 seconds.
function phrase(sound, ctx, vol) {
  const t0 = ctx.currentTime + 0.05;
  if (sound === 'chime') {
    [[0, 1047], [0.35, 1319], [0.7, 1568]].forEach(([dt, f]) => tone(ctx, t0 + dt, f, 0.9, vol * 0.7, 'triangle'));
  } else if (sound === 'pips') {
    for (let i = 0; i < 5; i++) tone(ctx, t0 + i * 0.3, 1000, 0.1, vol);
  } else {
    for (let i = 0; i < 4; i++) tone(ctx, t0 + i * 0.18, i % 2 ? 1760 : 1320, 0.1, vol, 'square');
  }
}

export function preview(sound) {
  unlockAudio();
  setTimeout(() => { const ctx = getAudio(); if (ctx) phrase(sound, ctx, 0.6); else toast('Sound is blocked — turn the volume up'); }, 120);
}

/* ---------- Ringing ---------- */
function ring(a, at) {
  ringing = a;
  ringStart = Date.now();
  a.lastFired = a.snoozeAt && Math.abs(a.snoozeAt - at) < 1000 ? a.lastFired : at;
  a.snoozeAt = null;
  if (!a.days?.length && !a.snoozed) a.enabled = false;   // one-off alarms switch themselves off
  store.save();
  const overlay = el('div', { id: 'alarm-ring', class: 'alarm-ring', role: 'alertdialog', 'aria-label': 'Alarm' },
    el('div', { class: 'ar-icon' }, '⏰'),
    el('div', { class: 'ar-time', id: 'ar-time' }, ''),
    el('div', { class: 'ar-label' }, a.label || 'Alarm'),
    el('div', { class: 'ar-btns' },
      el('button', { type: 'button', class: 'btn ar-snooze', onclick: () => stopRing(true) }, `Snooze ${SNOOZE_MIN} min`),
      el('button', { type: 'button', class: 'btn primary ar-stop', onclick: () => stopRing(false) }, 'Stop')));
  document.body.append(overlay);
  if ('wakeLock' in navigator) navigator.wakeLock.request('screen').then((w) => { wake = w; }).catch(() => {});
  const beat = () => {
    const el2 = $('ar-time'); if (el2) { const x = new Date(now()); el2.textContent = `${pad(x.getHours())}:${pad(x.getMinutes())}`; }
    const ctx = getAudio();
    const vol = Math.min(0.95, 0.25 + ((Date.now() - ringStart) / 30000) * 0.7);
    if (ctx) phrase(a.sound || 'beeps', ctx, vol);
    if (Date.now() - ringStart > 10 * 60 * 1000) stopRing(false);  // give up after 10 minutes
  };
  beat();
  ringTimer = setInterval(beat, 2000);
}

function stopRing(snooze) {
  clearInterval(ringTimer);
  const a = ringing;
  ringing = null;
  $('alarm-ring')?.remove();
  if (wake && !bedside) { wake.release().catch(() => {}); wake = null; }
  if (a && snooze) {
    a.snoozeAt = Math.round(now()) + SNOOZE_MIN * 60000;
    a.enabled = true; a.snoozed = true;
    toast(`Snoozing until ${hhmm(a.snoozeAt)}`);
  } else if (a) { a.snoozed = false; if (!a.days?.length) a.enabled = false; }
  store.save();
  render(); updateClockLine();
}

const hhmm = (t) => { const x = new Date(t); return `${pad(x.getHours())}:${pad(x.getMinutes())}`; };
function inText(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ${m % 60} min` : `${Math.floor(h / 24)} d ${h % 24} h`;
}

/* ---------- Bedside mode ---------- */
function startBedside() {
  unlockAudio();
  if (bedside) return;
  bedside = el('div', { id: 'bedside', class: 'bedside', onclick: (e) => { if (e.target.closest('.bs-exit')) return; bedside.classList.toggle('bright'); } },
    el('div', { class: 'bs-time', id: 'bs-time' }, ''),
    el('div', { class: 'bs-next', id: 'bs-next' }, ''),
    el('button', { type: 'button', class: 'bs-exit', onclick: stopBedside }, 'Exit bedside mode'));
  document.body.append(bedside);
  if ('wakeLock' in navigator) navigator.wakeLock.request('screen').then((w) => { wake = w; }).catch(() => {});
  const draw = () => {
    const t = now();
    $('bs-time').textContent = hhmm(t);
    const n = nextAlarm();
    $('bs-next').textContent = n ? `⏰ ${hhmm(n.at)} · ${n.a.label || 'Alarm'}` : 'No alarm set';
  };
  draw();
  bedTimer = setInterval(draw, 5000);
}
function stopBedside() {
  clearInterval(bedTimer);
  bedside?.remove(); bedside = null;
  if (wake) { wake.release().catch(() => {}); wake = null; }
}

/* ---------- Clock tab line ---------- */
function updateClockLine() {
  const line = $('alarm-line');
  if (!line) return;
  const n = nextAlarm();
  line.hidden = !n;
  if (n) line.textContent = `⏰ ${n.a.snoozeAt ? 'Snoozed until' : 'Alarm'} ${hhmm(n.at)} (in ${inText(n.at - now())}) · keep the app open`;
}

/* ---------- Editor ---------- */
function editAlarm(a) {
  const isNew = !a;
  const draft = a ? { ...a, days: [...(a.days || [])] } : { time: '07:00', label: '', days: [0, 1, 2, 3, 4], sound: 'beeps', enabled: true };
  const timeIn = el('input', { type: 'time', class: 'input alarm-time-in', value: draft.time });
  const labelIn = el('input', { type: 'text', class: 'input', value: draft.label || '', placeholder: 'Label (optional), e.g. Work' });
  const dayBtns = DAYS.map((name, i) => {
    const b = el('button', { type: 'button', class: 'day-chip' + (draft.days.includes(i) ? ' on' : ''), onclick: () => {
      draft.days = draft.days.includes(i) ? draft.days.filter((x) => x !== i) : [...draft.days, i].sort();
      b.classList.toggle('on');
    } }, name.slice(0, 2));
    return b;
  });
  const soundSel = el('select', { class: 'input' }, SOUNDS.map(([v, l]) => el('option', { value: v, selected: draft.sound === v }, l)));
  openModal({
    title: isNew ? 'New alarm' : 'Edit alarm',
    content: [
      timeIn,
      el('label', { class: 'field' }, el('span', {}, 'Repeat (none selected = once)'), el('div', { class: 'day-chips' }, dayBtns)),
      el('label', { class: 'field' }, el('span', {}, 'Label'), labelIn),
      el('label', { class: 'field' }, el('span', {}, 'Sound'), el('div', { class: 'row-sound' }, soundSel,
        el('button', { type: 'button', class: 'btn sm', onclick: () => preview(soundSel.value) }, '▶ Play'))),
    ],
    actions: [
      ...(isNew ? [] : [{ label: 'Delete', kind: 'danger', onClick: () => { setTimeout(async () => {
        if (await confirmModal('Delete this alarm?', '', 'Delete', true)) { d().alarms = alarms().filter((x) => x.id !== a.id); store.save(); render(); updateClockLine(); }
      }, 0); } }]),
      { label: 'Cancel' },
      { label: 'Save', kind: 'primary', onClick: () => {
        if (!/^\d{2}:\d{2}$/.test(timeIn.value)) { toast('Choose a time'); return false; }
        const out = { ...draft, time: timeIn.value, label: labelIn.value.trim(), sound: soundSel.value, enabled: true, snoozeAt: null, snoozed: false };
        if (isNew) alarms().push({ id: store.uid(), ...out }); else Object.assign(a, out);
        store.save(); unlockAudio(); render(); updateClockLine();
        const n = nextRing(isNew ? alarms()[alarms().length - 1] : a);
        if (n) toast(`Alarm in ${inText(n - now())}`);
      } },
    ],
  });
}

/* ---------- Panel ---------- */
function daysText(a) {
  const ds = a.days || [];
  if (!ds.length) return 'Once';
  if (ds.length === 7) return 'Every day';
  if (ds.join() === '0,1,2,3,4') return 'Weekdays';
  if (ds.join() === '5,6') return 'Weekends';
  return ds.map((i) => DAYS[i]).join(', ');
}

function render() {
  const box = $('tool-alarm-body');
  if (!box) return;
  box.innerHTML = '';
  const list = [...alarms()].sort((x, y) => x.time.localeCompare(y.time));
  box.append(
    el('div', { class: 'notice warn' }, el('b', {}, 'Keep the app open for alarms. '),
      'iPhone pauses web apps when the screen locks, so alarms only ring while this app is open on screen. At night, use ', el('b', {}, 'Bedside mode'), ' with the phone on charge — the screen stays on, very dim.'),
    el('div', { class: 'card' },
      list.length ? el('div', { class: 'alarm-list' }, list.map((a) => {
        const n = nextRing(a);
        const sw = el('input', { type: 'checkbox', class: 'switch', checked: !!a.enabled, 'aria-label': 'Alarm on', onchange: (e) => {
          a.enabled = e.target.checked; a.snoozeAt = null; store.save(); unlockAudio(); render(); updateClockLine();
        } });
        return el('div', { class: 'alarm-row' + (a.enabled ? '' : ' off') },
          el('button', { type: 'button', class: 'alarm-main', onclick: () => editAlarm(a) },
            el('div', { class: 'alarm-t' }, a.time),
            el('div', { class: 'muted small' }, [a.label, daysText(a), n ? `in ${inText(n - now())}` : null].filter(Boolean).join(' · '))),
          sw);
      })) : el('p', { class: 'muted' }, 'No alarms yet.'),
      el('button', { type: 'button', class: 'btn primary wide', onclick: () => editAlarm(null) }, '＋ Add alarm')),
    el('button', { type: 'button', class: 'btn wide bedside-btn', onclick: startBedside }, '🌙 Bedside mode'),
    el('p', { class: 'muted small center' }, 'Bedside mode shows a dim clock and your next alarm. Tap it to brighten; tap “Exit” to leave. Turn the volume up and touch the screen once so sound is allowed.'));
}

export function register({ registerTool }) {
  registerTool({ id: 'alarm', title: 'Alarm', icon: '⏰', desc: 'Alarms + bedside mode', panel: 'alarm', show: render, order: 5 });
  const slot = $('zone-slot');
  if (slot && !$('alarm-line')) slot.after(el('button', { type: 'button', id: 'alarm-line', class: 'alarm-line', hidden: true, onclick: () => { location.hash = 'tools/alarm'; } }));
  setInterval(check, 500);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  updateClockLine();
}
