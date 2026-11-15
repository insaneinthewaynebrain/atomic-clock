// Alarm section: 5 alarm banks (each with an optional sunrise wake light, and the choice of a set
// time or the real local sunrise), Bedside mode, and the timers (countdown, stopwatch with laps, eggs,
// medication) from timers.js.
// A web app can only ring while it's open on screen (the iPhone pauses it when locked), so
// Bedside mode keeps a dim clock showing all night.
import * as store from './store.js';
import { now } from './time.js';
import { el, openModal, confirmModal, toast, pad, placeSearchModal, placeLabel } from './ui.js';
import { unlockAudio } from './countdown.js';
import { ringAlert, isRinging, toneField, stopPreview } from './ring.js';
import { normTone, TONE_SHORT } from './music.js';
import { sunriseOn } from './sun.js';
import { getPosition, nearestTown } from './weather.js';
import * as timers from './timers.js';
import * as sleep from './sleep.js';
import { refreshQuotes, primeSpeech } from './wakewords.js';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];   // index 0 = Monday
const BANKS = 5;
const SNOOZE_MIN = 9;
const CATCH_UP_MS = 2 * 60 * 1000;        // ring if the app was reopened within 2 min of the time
const LIGHT_MINS = [10, 15, 20, 30, 45, 60];
const WORDS = [['speak', 'Spoken and shown on screen'], ['show', 'Shown on screen only'], ['off', 'Off — music only']];
const WORD_HINT = { soft: 'calm, yoga-style affirmations', medium: 'an upbeat pep talk for the work day', harsh: 'a drill sergeant telling you to get up' };
const OFFSETS = [-60, -45, -30, -20, -15, -10, -5, 0, 5, 10, 15, 20, 30, 45, 60];
const VIEWS = [['alarms', '⏰', 'Alarms'], ['timer', '⏳', 'Timer'], ['stopwatch', '⏱️', 'Stopwatch'],
  ['eggs', '🥚', 'Egg timer'], ['meds', '💊', 'Medication']];
const $ = (id) => document.getElementById(id);
const d = () => store.get();
const dow = (date) => (date.getDay() + 6) % 7;   // Monday = 0

let bedside = null, bedTimer = null, bedWake = null, sun = null, panelOpen = false, liveTimer = null, liveUpdate = null;

/* ---------- Data ---------- */
// Alarms live in d().alarms; each has a bank number 0–4. Older alarms are moved into free banks.
function alarms() {
  const list = (d().alarms ||= []);
  if (list.some((a) => a.bank == null)) {
    const used = new Set(list.map((a) => a.bank).filter((b) => b != null));
    for (const a of list) {
      if (a.bank != null) continue;
      for (let b = 0; b < BANKS; b++) if (!used.has(b)) { a.bank = b; used.add(b); break; }
      if (a.bank == null) a.bank = -1;            // more than 5 old alarms: kept, listed as "Other"
    }
    store.save();
  }
  return list;
}
const inBank = (b) => alarms().find((a) => a.bank === b);

/** Where sunrise is worked out: a chosen place, else the weather location. */
export function sunPlace() {
  const p = d().sunPlace;
  if (p) return p;
  const w = d().weather?.cache?.place;
  return w && Number.isFinite(w.lat) ? { name: w.town || w.name, lat: w.lat, lon: w.lon, fromWeather: true } : null;
}

/* ---------- Scheduling ---------- */
function todayAt(hhmm, base) {
  const [h, m] = hhmm.split(':').map(Number);
  const x = new Date(base); x.setHours(h, m, 0, 0);
  return x.getTime();
}

/** When this alarm rings on the local day of `base` (ms), or null. */
function ringOnDay(a, base) {
  if (a.mode !== 'sunrise') return todayAt(a.time, base);
  const r = sunriseOn(new Date(base), sunPlace());
  if (!r) return null;
  let at = r + (a.offset || 0) * 60000;
  if (a.latest) at = Math.min(at, todayAt(a.latest, base));
  return at;
}

/** Next time this alarm will ring (ms), or null. */
export function nextRing(a, t = now()) {
  if (!a.enabled) return null;
  if (a.snoozeAt && a.snoozeAt > t - CATCH_UP_MS) return a.snoozeAt;
  for (let i = 0; i < 8; i++) {
    const base = new Date(t); base.setDate(base.getDate() + i);
    const at = ringOnDay(a, base);
    if (at == null || at < t - CATCH_UP_MS) continue;
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
  const t = now();
  timers.check(t);
  for (const a of alarms()) {
    const at = nextRing(a, t);
    if (at && t >= at && t - at < CATCH_UP_MS) { ring(a, at); break; }
  }
  checkSunrise(t);
  updateClockLine();
}

/* ---------- Ringing ---------- */
function ring(a, at) {
  const snoozing = a.snoozeAt && Math.abs(a.snoozeAt - at) < 1000;
  if (!snoozing) a.lastFired = at;
  a.snoozeAt = null;
  if (!a.days?.length && !a.snoozed) a.enabled = false;   // one-off alarms switch themselves off
  store.save();
  if (a.light && sun && !sun.demo) drawSun(1);
  sleep.stopMic();     // the iPhone plays quietly while the microphone is on, so stop listening first
  const done = (snooze) => {
    hideSun();
    if (snooze) {
      a.snoozeAt = Math.round(now()) + SNOOZE_MIN * 60000;
      a.enabled = true; a.snoozed = true;
      toast(`Snoozing until ${hhmm(a.snoozeAt)}`);
      if (sleep.sleeping()) sleep.startSleep(store.get().sleep.current.listen);
    } else {
      a.snoozed = false; if (!a.days?.length) a.enabled = false;
      if (sleep.sleeping()) { stopBedside(true); sleep.endSleep(); }
    }
    store.save();
    if (panelOpen) render();
    updateClockLine();
  };
  ringAlert({
    icon: a.mode === 'sunrise' ? '🌅' : '⏰',
    title: a.label || `Alarm ${a.bank >= 0 ? a.bank + 1 : ''}`.trim(),
    label: a.mode === 'sunrise' ? 'Good morning — the sun is up' : null,
    sound: a.sound, sunlit: !!a.light, words: a.words || 'speak',
    buttons: [{ label: `Snooze ${SNOOZE_MIN} min`, fn: () => done(true) }, { label: 'Stop', kind: 'primary', fn: () => done(false) }],
    onTimeout: () => done(false),
  });
}

const hhmm = (t) => { const x = new Date(t); return `${pad(x.getHours())}:${pad(x.getMinutes())}`; };
function inText(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ${m % 60} min` : `${Math.floor(h / 24)} d ${h % 24} h`;
}

/* ---------- Sunrise wake light ----------
 Like a sunrise (dawn-simulation) lamp: the screen starts black and glows deep red, then orange,
 then golden and finally warm white, reaching full brightness at the alarm time. */
const SUN_STOPS = [[0, [0, 0, 0]], [0.12, [24, 2, 0]], [0.3, [88, 12, 2]], [0.5, [178, 44, 6]],
  [0.68, [250, 112, 28]], [0.84, [255, 186, 102]], [1, [255, 244, 226]]];
function sunColour(p) {
  p = Math.max(0, Math.min(1, p));
  for (let i = 1; i < SUN_STOPS.length; i++) {
    const [p1, c1] = SUN_STOPS[i];
    if (p <= p1) {
      const [p0, c0] = SUN_STOPS[i - 1], k = (p - p0) / (p1 - p0);
      return `rgb(${c0.map((v, j) => Math.round(v + (c1[j] - v) * k)).join(',')})`;
    }
  }
  return 'rgb(255,244,226)';
}

function showSun({ a, at, start, end, demo }) {
  hideSun();
  const box = el('div', { id: 'sunrise', class: 'sunrise' },
    el('div', { class: 'sun-disc' }),
    el('div', { class: 'sun-info' },
      el('div', { class: 'sun-time', id: 'sun-time' }, ''),
      el('div', { class: 'sun-next' }, demo ? 'Sunrise preview — one minute' : `Wake light · alarm at ${hhmm(at)}`)),
    el('div', { class: 'sun-btns' },
      demo ? el('button', { type: 'button', class: 'sun-btn', onclick: hideSun }, 'Close preview') : [
        el('button', { type: 'button', class: 'sun-btn', onclick: () => { a.lightSkip = at; store.save(); hideSun(); } }, 'Turn off the light'),
        el('button', { type: 'button', class: 'sun-btn', onclick: () => { a.lastFired = at; if (!a.days?.length) a.enabled = false; store.save(); hideSun(); toast('Alarm off — have a good day'); if (panelOpen) render(); } }, 'I’m up — cancel this alarm'),
      ]));
  document.body.append(box);
  sun = { a, at, start, end, demo, box, wake: null };
  if ('wakeLock' in navigator) navigator.wakeLock.request('screen').then((w) => { if (sun) sun.wake = w; else w.release(); }).catch(() => {});
  drawSun();
  if (demo) sun.timer = setInterval(() => { drawSun(); if (Date.now() > end + 6000) hideSun(); }, 250);
}

function drawSun(force) {
  if (!sun) return;
  const t = sun.demo ? Date.now() : now();
  const p = force ?? Math.max(0, Math.min(1, (t - sun.start) / (sun.end - sun.start)));
  const e = Math.pow(p, 1.3);   // our eyes notice the first glow most, so start gently
  sun.box.style.background = `radial-gradient(ellipse 140% 100% at 50% ${105 - e * 55}%, ${sunColour(e)} 0%, ${sunColour(e * 0.82)} 38%, ${sunColour(e * 0.55)} 100%)`;
  sun.box.style.setProperty('--sun-y', `${(1 - e) * 70 + 18}%`);
  sun.box.style.setProperty('--sun-glow', sunColour(Math.min(1, e * 1.15)));
  sun.box.classList.toggle('day', e > 0.62);
  const x = $('sun-time');
  if (x) x.textContent = hhmm(now());
}

function hideSun() {
  if (!sun) return;
  clearInterval(sun.timer);
  sun.box.remove();
  sun.wake?.release().catch(() => {});
  sun = null;
}

function checkSunrise(t) {
  if (sun?.demo) return;
  let want = null;
  for (const a of alarms()) {
    if (!a.enabled || !a.light || a.snoozeAt) continue;
    const at = nextRing(a, t);
    if (!at || a.lightSkip === at) continue;
    const start = at - (a.lightMin || 30) * 60000;
    if (t >= start && t < at && (!want || at < want.at)) want = { a, at, start, end: at };
  }
  if (want && (!sun || sun.at !== want.at)) showSun(want);
  else if (!want && sun && !isRinging()) hideSun();
  else if (sun) drawSun();
}

function previewSunrise() {
  unlockAudio();
  const t = Date.now();
  showSun({ a: null, at: t + 60000, start: t, end: t + 60000, demo: true });
}

/* ---------- Bedside mode ---------- */
function bedtime() {
  unlockAudio(); primeSpeech();
  const listen = el('input', { type: 'checkbox', class: 'check', checked: d().sleepListen !== false });
  const n = nextAlarm();
  openModal({
    title: '🌙 Good night',
    content: [
      el('p', {}, n ? `Your next alarm is ${hhmm(n.at)} (in ${inText(n.at - now())}). ` : 'No alarm is set. ', 'A sleep timer starts now, and in the morning you’ll see how long you slept.'),
      el('label', { class: 'field check-field' }, listen, el('span', {}, 'Listen for snoring and restless sleep')),
      el('p', { class: 'muted small' }, 'Uses the microphone all night. Sounds are checked on your phone as they happen — nothing is recorded, saved or sent anywhere. Put the phone on charge, face up, near the bed.'),
    ],
    actions: [{ label: 'Cancel' }, { label: 'Start', kind: 'primary', onClick: async () => {
      d().sleepListen = listen.checked; store.save();
      const started = sleep.startSleep(listen.checked);   // the timer starts straight away
      startBedside();
      const err = await started;
      if (err) toast(err, 6000);
    } }],
  });
}

function startBedside() {
  unlockAudio();
  if (bedside) return;
  bedside = el('div', { id: 'bedside', class: 'bedside', onclick: (e) => { if (e.target.closest('.bs-exit')) return; bedside.classList.toggle('bright'); } },
    el('div', { class: 'bs-time', id: 'bs-time' }, ''),
    el('div', { class: 'bs-next', id: 'bs-next' }, ''),
    el('div', { class: 'bs-sleep', id: 'bs-sleep' }, ''),
    el('button', { type: 'button', class: 'bs-exit', onclick: () => stopBedside() }, 'Exit bedside mode'));
  document.body.append(bedside);
  if ('wakeLock' in navigator) navigator.wakeLock.request('screen').then((w) => { bedWake = w; }).catch(() => {});
  const draw = () => {
    $('bs-time').textContent = hhmm(now());
    const n = nextAlarm();
    $('bs-next').textContent = n ? `${n.a.light ? '🌅' : '⏰'} ${hhmm(n.at)} · ${n.a.label || 'Alarm'}` : 'No alarm set';
    $('bs-sleep').textContent = sleep.bedsideLine();
  };
  draw();
  bedTimer = setInterval(draw, 5000);
}
async function stopBedside(quiet) {
  if (!quiet && sleep.sleeping()) {
    const end = await confirmModal('End the night?', 'Stop the sleep timer and see your summary? Choose Cancel to leave Bedside mode but keep the sleep timer running.', 'End & show summary');
    if (end) sleep.endSleep();
  }
  clearInterval(bedTimer);
  bedside?.remove(); bedside = null;
  if (bedWake) { bedWake.release().catch(() => {}); bedWake = null; }
}

/* ---------- Clock tab line ---------- */
function updateClockLine() {
  const line = $('alarm-line');
  if (!line) return;
  const n = nextAlarm();
  line.hidden = !n;
  if (n) line.textContent = `${n.a.light ? '🌅' : '⏰'} ${n.a.snoozeAt ? 'Snoozed until' : 'Alarm'} ${hhmm(n.at)} (in ${inText(n.at - now())}) · keep the app open`;
}

/* ---------- Sunrise location ---------- */
function chooseSunPlace(after) {
  const useGps = async () => {
    toast('Finding your location…');
    try {
      const pos = await getPosition();
      const town = await nearestTown(pos.lat, pos.lon);
      d().sunPlace = { name: town.town || 'Your location', region: town.region || '', lat: pos.lat, lon: pos.lon, gps: true };
      store.save(); toast('Location saved'); after?.();
    } catch (e) { toast(e.message || 'Could not get your location'); after?.(); }
  };
  placeSearchModal({
    title: 'Where do you wake up?',
    onPick: (p) => { d().sunPlace = { name: p.name, region: placeLabel(p), lat: p.lat, lon: p.lon }; store.save(); after?.(); },
    extraActions: [{ label: '📍 Use my location', onClick: () => { setTimeout(useGps, 0); } }],
    onCancel: () => after?.(),
  });
}

function placeText(p) { return p ? `${p.name}${p.region ? ', ' + p.region : ''}` : 'not set'; }

/* ---------- Editor ---------- */
const offText = (m) => (m === 0 ? 'At sunrise' : `${Math.abs(m)} min ${m < 0 ? 'before' : 'after'} sunrise`);

function editAlarm(bank, a, saved) {
  const isNew = !a;
  const draft = saved || (a ? { ...a, days: [...(a.days || [])] }
    : { time: '07:00', label: '', days: [0, 1, 2, 3, 4], sound: 'soft', enabled: true, mode: 'time', offset: 0, latest: '', light: true, lightMin: 30 });
  draft.sound = normTone(draft.sound);
  draft.mode ||= 'time';
  draft.lightMin ||= 30;

  const timeIn = el('input', { type: 'time', class: 'input alarm-time-in', value: draft.time });
  const offSel = el('select', { class: 'input' }, OFFSETS.map((m) => el('option', { value: m, selected: (draft.offset || 0) === m }, offText(m))));
  const latestOn = el('input', { type: 'checkbox', class: 'check', checked: !!draft.latest });
  const latestIn = el('input', { type: 'time', class: 'input', value: draft.latest || '07:30' });
  const sunPreview = el('div', { class: 'sun-preview' });
  const readDraft = () => {
    draft.time = timeIn.value || draft.time;
    draft.offset = Number(offSel.value);
    draft.latest = latestOn.checked ? latestIn.value : '';
    draft.label = labelIn.value.trim();
    draft.sound = tone.select.value;
    draft.light = lightOn.checked;
    draft.lightMin = Number(lightSel.value);
    draft.words = wordsSel.value;
    return draft;
  };
  const updSun = () => {
    readDraft();
    const p = sunPlace();
    sunPreview.innerHTML = '';
    if (!p) { sunPreview.append(el('span', { class: 'warn-text' }, 'Set your location so the alarm can follow the sunrise.')); return; }
    const tmr = new Date(now()); tmr.setDate(tmr.getDate() + 1);
    const r = sunriseOn(tmr, p);
    if (!r) { sunPreview.append(el('span', { class: 'warn-text' }, 'The sun doesn’t rise there at this time of year — choose a set time instead.')); return; }
    const at = ringOnDay({ ...draft, mode: 'sunrise' }, tmr);
    sunPreview.append(`Tomorrow: sunrise ${hhmm(r)} → alarm at `, el('b', {}, hhmm(at)), draft.light ? `, light from ${hhmm(at - draft.lightMin * 60000)}` : '');
  };
  const timeBox = el('div', { class: 'mode-box' }, timeIn);
  const sunBox = el('div', { class: 'mode-box' },
    el('label', { class: 'field' }, el('span', {}, 'Ring'), offSel),
    el('label', { class: 'field check-field' }, latestOn, el('span', {}, 'But never later than')), latestIn,
    el('div', { class: 'sun-loc' }, el('span', {}, '📍 ', placeText(sunPlace())),
      el('button', { type: 'button', class: 'btn sm', onclick: () => { readDraft(); chooseSunPlace(() => editAlarm(bank, a, draft)); } }, sunPlace() ? 'Change' : 'Set location')),
    sunPreview);
  const segBtns = [['time', 'Set time'], ['sunrise', '☀ Real sunrise']].map(([m, l]) => {
    const b = el('button', { type: 'button', class: 'seg-btn' + (draft.mode === m ? ' active' : ''), onclick: () => {
      draft.mode = m; segBtns.forEach((x) => x.classList.toggle('active', x === b));
      timeBox.hidden = m !== 'time'; sunBox.hidden = m !== 'sunrise'; updSun();
    } }, l);
    return b;
  });
  timeBox.hidden = draft.mode !== 'time'; sunBox.hidden = draft.mode !== 'sunrise';
  [offSel, latestOn, latestIn].forEach((x) => x.addEventListener('change', updSun));
  latestIn.addEventListener('focus', () => { latestOn.checked = true; });

  const labelIn = el('input', { type: 'text', class: 'input', value: draft.label || '', placeholder: 'Label (optional), e.g. Work' });
  const dayBtns = DAYS.map((name, i) => {
    const b = el('button', { type: 'button', class: 'day-chip' + (draft.days.includes(i) ? ' on' : ''), onclick: () => {
      draft.days = draft.days.includes(i) ? draft.days.filter((x) => x !== i) : [...draft.days, i].sort();
      b.classList.toggle('on');
    } }, name.slice(0, 2));
    return b;
  });
  const tone = toneField(draft.sound, () => updWords());
  const wordsSel = el('select', { class: 'input' }, WORDS.map(([v, l]) => el('option', { value: v, selected: (draft.words || 'speak') === v }, l)));
  const wordsHint = el('p', { class: 'muted small' });
  const updWords = () => { wordsHint.textContent = `With the ${tone.select.selectedOptions[0].text.split(' — ')[0]} tone: ${WORD_HINT[tone.select.value]}, plus matching quotes when online.`; };
  updWords();
  const lightOn = el('input', { type: 'checkbox', class: 'switch', checked: !!draft.light, onchange: updSun });
  const lightSel = el('select', { class: 'input', onchange: updSun }, LIGHT_MINS.map((m) => el('option', { value: m, selected: draft.lightMin === m }, `Starts ${m} min before the alarm`)));
  updSun();

  openModal({
    title: `Alarm ${bank + 1}`,
    className: 'tall',
    onClose: stopPreview,
    content: [
      el('div', { class: 'seg' }, segBtns),
      timeBox, sunBox,
      el('div', { class: 'light-box' },
        el('div', { class: 'light-head' }, el('span', {}, '🌅 Sunrise wake light'), lightOn),
        el('p', { class: 'muted small' }, 'The screen glows from deep red to warm white, like a sunrise lamp, so you wake gently before the sound.'),
        lightSel,
        el('button', { type: 'button', class: 'link-btn', onclick: previewSunrise }, 'Preview the sunrise (1 minute)')),
      el('label', { class: 'field' }, el('span', {}, 'Repeat (none selected = once)'), el('div', { class: 'day-chips' }, dayBtns)),
      el('label', { class: 'field' }, el('span', {}, 'Label'), labelIn),
      tone,
      el('label', { class: 'field' }, el('span', {}, 'Wake-up words'), wordsSel), wordsHint,
    ],
    actions: [
      ...(isNew ? [] : [{ label: 'Clear', kind: 'danger', onClick: () => { setTimeout(async () => {
        if (await confirmModal(`Clear alarm ${bank + 1}?`, 'The bank will be empty and ready to set again.', 'Clear', true)) { d().alarms = alarms().filter((x) => x !== a); store.save(); render(); updateClockLine(); }
      }, 0); } }]),
      { label: 'Cancel' },
      { label: 'Save', kind: 'primary', onClick: () => {
        readDraft();
        if (draft.mode === 'time' && !/^\d{2}:\d{2}$/.test(draft.time)) { toast('Choose a time'); return false; }
        if (draft.mode === 'sunrise' && !sunPlace()) { toast('Set your location first'); return false; }
        const out = { ...draft, bank, enabled: true, snoozeAt: null, snoozed: false, lightSkip: null };
        let target = a;
        if (isNew) { target = { id: store.uid(), ...out }; alarms().push(target); } else Object.assign(a, out);
        store.save(); unlockAudio(); primeSpeech(); render(); updateClockLine();
        const n = nextRing(target);
        if (n) toast(`Alarm in ${inText(n - now())}`);
        else if (draft.mode === 'sunrise') toast('No sunrise in the next week there');
        // Setting an alarm in the evening: offer to start the night straight away.
        const h = new Date(now()).getHours();
        if (n && (h >= 19 || h < 3) && n - now() < 14 * 3600000 && !sleep.sleeping()) setTimeout(bedtime, 400);
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

function alarmRow(a) {
  const n = nextRing(a);
  const sw = el('input', { type: 'checkbox', class: 'switch', checked: !!a.enabled, 'aria-label': 'Alarm on', onchange: (e) => {
    a.enabled = e.target.checked; a.snoozeAt = null; a.lightSkip = null; store.save(); unlockAudio(); render(); updateClockLine();
  } });
  const sunMode = a.mode === 'sunrise';
  const big = sunMode ? (n ? hhmm(n) : '☀ --:--') : a.time;
  const bits = [a.label, daysText(a),
    sunMode ? offText(a.offset || 0) + (a.latest ? `, by ${a.latest}` : '') : null,
    a.light ? `🌅 ${a.lightMin || 30} min light` : null,
    TONE_SHORT[normTone(a.sound)],
    a.enabled && n ? `in ${inText(n - now())}` : null];
  return el('div', { class: 'alarm-row' + (a.enabled ? '' : ' off') },
    el('span', { class: 'bank-no' }, a.bank >= 0 ? String(a.bank + 1) : '•'),
    el('button', { type: 'button', class: 'alarm-main', onclick: () => editAlarm(a.bank >= 0 ? a.bank : 0, a) },
      el('div', { class: 'alarm-t' }, sunMode ? el('span', { class: 'sun-tag' }, '☀') : null, big),
      el('div', { class: 'muted small' }, bits.filter(Boolean).join(' · '))),
    sw);
}

function renderAlarms(box) {
  const rows = [];
  for (let b = 0; b < BANKS; b++) {
    const a = inBank(b);
    rows.push(a ? alarmRow(a) : el('button', { type: 'button', class: 'alarm-row empty-bank', onclick: () => editAlarm(b, null) },
      el('span', { class: 'bank-no' }, String(b + 1)), el('span', { class: 'muted' }, 'Empty — tap to set an alarm'), el('span', { class: 'plus' }, '＋')));
  }
  const others = alarms().filter((a) => a.bank === -1);
  const p = sunPlace();
  box.append(
    el('div', { class: 'notice warn' }, el('b', {}, 'Keep the app open for alarms. '),
      'iPhone pauses web apps when the screen locks, so alarms, the wake light and timers only work while this app is open on screen. At night, use ', el('b', {}, 'Bedside mode'), ' with the phone on charge.'),
    el('div', { class: 'card' },
      el('h2', { class: 'card-title' }, 'Alarm banks ', el('span', { class: 'muted small' }, 'your 5 saved alarms — switch on the ones you need')),
      el('div', { class: 'alarm-list' }, rows),
      others.length ? [el('h3', { class: 'sub-title' }, 'Other alarms'), el('div', { class: 'alarm-list' }, others.map(alarmRow))] : null),
    el('button', { type: 'button', class: 'btn primary wide bedside-btn', onclick: bedtime }, sleep.sleeping() ? '🌙 Back to Bedside mode' : '🌙 Going to sleep — Bedside mode'),
    el('p', { class: 'muted small center' }, 'Starts your sleep timer and shows a dim clock with your next alarm. Optionally listens for snoring and restless sleep. Tap the clock to brighten it.'),
    nightCard(),
    el('div', { class: 'card sun-card' },
      el('h2', { class: 'card-title' }, '🌅 Sunrise wake-up'),
      el('p', { class: 'small' }, 'Sunrise alarm clocks copy the dawn: the light builds slowly for half an hour or so before the alarm. Gradual morning light is the body’s natural cue to wake — it helps switch off the sleep hormone melatonin and lift cortisol, so you surface from sleep gently instead of being jolted awake.'),
      el('p', { class: 'small' }, 'Each alarm can use the wake light, and can ring at a ', el('b', {}, 'set time'), ' or at the ', el('b', {}, 'real sunrise'), ' where you are (with “never later than” for dark winter mornings).'),
      el('ul', { class: 'plain-list small muted' },
        el('li', {}, 'Before bed, turn the screen brightness up and switch off Night Shift / Auto-Brightness if you can — the screen stays black until the sunrise starts.'),
        el('li', {}, 'Stand the phone facing you, a little way from your pillow.')),
      el('div', { class: 'sun-loc' }, el('span', {}, '📍 Sunrise location: ', el('b', {}, placeText(p)), p?.fromWeather ? ' (from Weather)' : ''),
        el('button', { type: 'button', class: 'btn sm', onclick: () => chooseSunPlace(render) }, p && !p.fromWeather ? 'Change' : 'Set')),
      p ? sunToday(p) : null,
      el('button', { type: 'button', class: 'btn wide', onclick: previewSunrise }, 'Preview the sunrise (1 minute)')));
}

function nightCard() {
  const cur = store.get().sleep?.current;
  const last = sleep.lastNight();
  if (cur) {
    return el('div', { class: 'card' }, el('h2', { class: 'card-title' }, '💤 Sleep timer running'),
      el('p', { class: 'small' }, sleep.bedsideLine()),
      el('button', { type: 'button', class: 'btn wide', onclick: () => { sleep.endSleep(); render(); } }, 'I’m up — end the night'));
  }
  if (!last) return '';
  const hist = sleep.history().slice(0, 7);
  return el('div', { class: 'card' },
    el('h2', { class: 'card-title' }, '💤 Last night'),
    el('button', { type: 'button', class: 'night-row', onclick: () => sleep.showSummary(last) },
      el('span', {}, nightText(last)), el('span', { class: 'muted' }, '›')),
    hist.length > 1 ? el('details', { class: 'night-hist' }, el('summary', { class: 'small muted' }, 'Previous nights'),
      hist.slice(1).map((n) => el('button', { type: 'button', class: 'night-row', onclick: () => sleep.showSummary(n) }, el('span', {}, nightText(n)), el('span', { class: 'muted' }, '›')))) : null);
}

function nightText(n) {
  const day = new Date(n.end).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const m = Math.round((n.end - (n.listen ? n.onset : n.start)) / 60000);
  const bits = [`${day}: ${Math.floor(m / 60)} h ${pad(m % 60)} min`];
  if (n.listen) bits.push(n.snoreMin ? `snoring ~${n.snoreMin} min` : 'no snoring', n.restMin || n.voices?.length ? 'restless spells' : 'settled');
  return bits.join(' · ');
}

function sunToday(p) {
  const t = new Date(now()), tm = new Date(t); tm.setDate(tm.getDate() + 1);
  const a = sunriseOn(t, p), b = sunriseOn(tm, p);
  return el('p', { class: 'muted small' }, a || b ? `Sunrise today ${a ? hhmm(a) : '—'} · tomorrow ${b ? hhmm(b) : '—'}` : 'No sunrise there at this time of year.');
}

function view() { const v = d().alarmView === 'laps' ? 'stopwatch' : d().alarmView; return VIEWS.some(([k]) => k === v) ? v : 'alarms'; }

function render() {
  const box = $('tool-alarm-body');
  if (!box) return;
  stopPreview();
  const keepY = window.scrollY;          // redrawing must not move the page (e.g. buttons jumping away after Lap)
  box.innerHTML = '';
  const v = view();
  box.append(el('div', { class: 'alarm-nav', role: 'tablist' }, VIEWS.map(([k, icon, label]) =>
    el('button', { type: 'button', role: 'tab', class: 'anav-btn' + (k === v ? ' active' : ''), 'aria-selected': String(k === v), onclick: () => {
      d().alarmView = k; store.save(); unlockAudio(); render();
    } }, el('span', { class: 'anav-icon' }, icon), el('span', {}, label)))));
  const body = el('div', { class: 'alarm-view' });
  box.append(body);
  liveUpdate = null;
  if (v === 'alarms') { timers.leave(); renderAlarms(body); }
  else liveUpdate = timers.renderView(v, body, render);
  if (window.scrollY !== keepY) window.scrollTo(0, keepY);
}

function show() {
  panelOpen = true;
  render();
  clearInterval(liveTimer);
  liveTimer = setInterval(() => { if (liveUpdate) liveUpdate(); }, 100);
}
function hide() { timers.leave(); panelOpen = false; clearInterval(liveTimer); liveTimer = null; liveUpdate = null; stopPreview(); }

export function register({ registerTool }) {
  registerTool({ id: 'alarm', title: 'Alarm & timers', icon: '⏰', desc: 'Sunrise alarms, timers, stopwatch, eggs, meds', panel: 'alarm', show, hide, order: 5 });
  const slot = $('zone-slot');
  if (slot && !$('alarm-line')) slot.after(el('button', { type: 'button', id: 'alarm-line', class: 'alarm-line', hidden: true, onclick: () => { d().alarmView = 'alarms'; location.hash = 'tools/alarm'; } }));
  timers.init(() => { if (panelOpen) render(); });
  refreshQuotes();
  setInterval(check, 500);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  updateClockLine();
}
