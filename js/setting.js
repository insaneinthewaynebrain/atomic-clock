// Tools: "Set to the minute" countdown with beeps, date-change danger zone, moon phase, GMT helper.
import * as store from './store.js';
import { now, clock } from './time.js';
import { el, pad } from './ui.js';
import { partsIn } from './world.js';

const DAY = 86400000;
const $ = (id) => document.getElementById(id);

/* =========================================================
   Date-change danger zone (21:00–03:00 local)
   ========================================================= */
export function inDangerZone(t = now()) {
  const h = new Date(t).getHours();
  return h >= 21 || h < 3;
}

function dateZoneBox(big = false) {
  const t = now();
  if (inDangerZone(t)) {
    const end = new Date(t); if (end.getHours() >= 21) end.setDate(end.getDate() + 1); end.setHours(3, 0, 0, 0);
    return el('div', { class: 'zone bad' + (big ? ' big' : '') },
      el('b', {}, '⚠️ Date-change danger zone'),
      el('div', {}, `Don’t change the date between 21:00 and 03:00 — the date-change gears are engaged and you can damage many movements. Safe again at 03:00 (in ${Math.ceil((end - t) / 3600000)} h). Check your manual.`));
  }
  return el('div', { class: 'zone ok' + (big ? ' big' : '') },
    el('b', {}, '✓ Safe to change the date'),
    el('div', {}, 'Outside the 21:00–03:00 danger zone. Tip: set the date first, then move the time forward past midnight to get AM/PM right.'));
}

function updateClockZone() {
  const n = $('clock-zone');
  if (!n) return;
  const z = inDangerZone();
  n.hidden = !z;
  n.textContent = z ? '⚠️ 21:00–03:00: don’t change the date now' : '';
}

/* =========================================================
   Set to the minute
   ========================================================= */
let raf = null, audio = null, beepsOn = false, lastBeep = 0, wake = null;

function beep(atAudioTime, freq, dur) {
  const o = audio.createOscillator(), g = audio.createGain();
  o.type = 'sine'; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, atAudioTime);
  g.gain.exponentialRampToValueAtTime(0.6, atAudioTime + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, atAudioTime + dur);
  o.connect(g).connect(audio.destination);
  o.start(atAudioTime); o.stop(atAudioTime + dur + 0.02);
}

function toggleBeeps(btn) {
  try {
    if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
    audio.resume();
    beepsOn = !beepsOn;
    if (beepsOn) beep(audio.currentTime + 0.02, 880, 0.05);   // confirms sound works
  } catch (e) { beepsOn = false; }
  btn.textContent = beepsOn ? '🔊 Beeps on' : '🔈 Beeps off';
  btn.classList.toggle('primary', beepsOn);
}

function setFrame() {
  const t = now();
  const next = Math.floor(t / 60000) * 60000 + 60000;
  const left = (next - t) / 1000;
  const big = $('set-left');
  if (!big) return;
  big.textContent = left >= 59.95 ? '0.0' : left.toFixed(1);
  big.className = 'set-left' + (left <= 5 ? ' final' : '') + (left >= 59.4 ? ' go' : '');
  const d = new Date(next);
  $('set-target').textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
  const ring = $('set-ring');
  if (ring) ring.style.strokeDashoffset = String(((60 - left) / 60) * 653.5);
  // Schedule beeps precisely with the audio clock, a little ahead of time.
  if (beepsOn && audio) {
    for (const s of [5, 4, 3, 2, 1, 0]) {
      const at = next - s * 1000;
      const ms = at - t;
      if (ms > 0 && ms < 120 && lastBeep !== at) {
        lastBeep = at;
        beep(audio.currentTime + ms / 1000, s === 0 ? 1320 : 880, s === 0 ? 0.45 : 0.08);
      }
    }
  }
  raf = requestAnimationFrame(setFrame);
}

function renderSetting() {
  const box = $('tool-setting-body');
  box.innerHTML = '';
  const beepBtn = el('button', { type: 'button', class: 'btn wide' + (beepsOn ? ' primary' : '') }, beepsOn ? '🔊 Beeps on' : '🔈 Beeps off');
  beepBtn.onclick = () => toggleBeeps(beepBtn);
  box.append(
    el('div', { class: 'card set-card' },
      el('div', { class: 'set-ring-wrap' },
        el('div', { class: 'set-ring', html: '<svg viewBox="0 0 220 220" aria-hidden="true"><circle cx="110" cy="110" r="104" class="ring-bg"/><circle id="set-ring" cx="110" cy="110" r="104" class="ring-fg" transform="rotate(-90 110 110)"/></svg>' }),
        el('div', { class: 'set-center' },
          el('div', { class: 'muted small' }, 'Seconds to'),
          el('div', { id: 'set-target', class: 'set-target' }, '--:--:00'),
          el('div', { id: 'set-left', class: 'set-left' }, '--'))),
      beepBtn,
      el('p', { class: 'muted small' }, 'Beeps on the last 5 seconds and a long beep exactly on the minute. On iPhone, the silent switch must be off for sound.'),
      el('p', { class: 'muted small sync-note' }, clock.synced ? `Network-synced, accurate to about ±${clock.accuracy} ms.` : 'Not synced yet — using the phone’s clock.')),
    el('div', { class: 'card' },
      el('h2', { class: 'card-title' }, 'How to set a watch to the second'),
      el('ol', { class: 'steps small' },
        el('li', {}, 'Pull the crown out to the time-setting position. Most mechanical watches “hack”: the seconds hand stops.'),
        el('li', {}, 'Stop the seconds hand at 12, then set the minute hand exactly on the minute shown above.'),
        el('li', {}, 'Push the crown in on the long beep (when the countdown hits zero).'),
        el('li', {}, 'Watch doesn’t hack? Wait until its seconds hand passes 12 at the same moment as the beep, then set the minute hand.'))),
    dateZoneBox(true));
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(setFrame);
  if ('wakeLock' in navigator) navigator.wakeLock.request('screen').then((w) => { wake = w; }).catch(() => {});
}

function hideSetting() {
  cancelAnimationFrame(raf); raf = null;
  if (wake) { wake.release().catch(() => {}); wake = null; }
}

/* =========================================================
   Moon phase (calculated on the phone)
   ========================================================= */
const SYNODIC = 29.530588853;
const REF_NEW = Date.UTC(2000, 0, 6, 18, 14);        // a known new moon

export function moonInfo(t = now()) {
  const age = ((((t - REF_NEW) / DAY) % SYNODIC) + SYNODIC) % SYNODIC;
  const illum = (1 - Math.cos((2 * Math.PI * age) / SYNODIC)) / 2;
  const names = [[1.85, 'New moon', '🌑'], [5.54, 'Waxing crescent', '🌒'], [9.23, 'First quarter', '🌓'], [12.92, 'Waxing gibbous', '🌔'],
    [16.61, 'Full moon', '🌕'], [20.30, 'Waning gibbous', '🌖'], [23.99, 'Last quarter', '🌗'], [27.68, 'Waning crescent', '🌘'], [30, 'New moon', '🌑']];
  const [, name, emoji] = names.find((n) => age < n[0]);
  const nextNew = t + (SYNODIC - age) * DAY;
  const nextFull = t + ((age < SYNODIC / 2 ? SYNODIC / 2 : SYNODIC * 1.5) - age) * DAY;
  return { age, illum, name, emoji, nextNew, nextFull, lastNew: t - age * DAY };
}

function moonSvg(age) {
  // Lit part of the disc: outer edge is a semicircle, inner edge an ellipse.
  const r = 80, cx = 90, cy = 90;
  const p = age / SYNODIC;                       // 0 new → 0.5 full → 1 new
  const waxing = p < 0.5;
  const k = Math.cos(2 * Math.PI * p);           // 1 new, -1 full
  const rx = Math.abs(k) * r;
  const sweepOuter = waxing ? 1 : 0;             // right side lit when waxing (northern hemisphere)
  const sweepInner = (k > 0) === waxing ? 0 : 1;
  const d = `M ${cx} ${cy - r} A ${r} ${r} 0 0 ${sweepOuter} ${cx} ${cy + r} A ${rx} ${r} 0 0 ${sweepInner} ${cx} ${cy - r} Z`;
  return `<svg viewBox="0 0 180 180" class="moon-svg" aria-hidden="true"><circle cx="${cx}" cy="${cy}" r="${r}" fill="#1e2433"/><path d="${d}" fill="#f4ecd0"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#2a3142" stroke-width="2"/></svg>`;
}

function renderMoon() {
  const box = $('tool-moon-body');
  const m = moonInfo();
  const fd = (t) => new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const clicks = Math.round(m.age) % 30;
  box.innerHTML = '';
  box.append(
    el('div', { class: 'card moon-card' },
      el('div', { class: 'moon-pic', html: moonSvg(m.age) }),
      el('div', { class: 'moon-name' }, `${m.emoji} ${m.name}`),
      el('div', { class: 'moon-grid' },
        el('div', {}, el('div', { class: 'stat-label' }, 'Illuminated'), el('div', { class: 'stat-value' }, `${Math.round(m.illum * 100)}%`)),
        el('div', {}, el('div', { class: 'stat-label' }, 'Moon age'), el('div', { class: 'stat-value' }, `${m.age.toFixed(1)} days`)),
        el('div', {}, el('div', { class: 'stat-label' }, 'Last new moon'), el('div', { class: 'stat-value' }, fd(m.lastNew))),
        el('div', {}, el('div', { class: 'stat-label' }, 'Next full moon'), el('div', { class: 'stat-value' }, fd(m.nextFull))),
        el('div', {}, el('div', { class: 'stat-label' }, 'Next new moon'), el('div', { class: 'stat-value' }, fd(m.nextNew))))),
    el('div', { class: 'card' },
      el('h2', { class: 'card-title' }, 'Setting a moonphase watch'),
      el('ol', { class: 'steps small' },
        el('li', {}, 'Using the moonphase pusher or crown position, turn the disc until a full moon sits exactly in the centre of the window.'),
        el('li', {}, 'Keep going until the window is empty or shows the new moon (most discs: about 15 more clicks; check your manual).'),
        el('li', {}, el('b', {}, `Now advance ${clicks} click${clicks === 1 ? '' : 's'}`), ' — one per day since the last new moon.'),
        el('li', {}, 'Mind the date-change danger zone: many watches must not be adjusted between 21:00 and 03:00.'))),
    el('p', { class: 'muted small center' }, 'Calculated on your phone from the average lunar month; times can be out by up to about half a day.'));
}

/* =========================================================
   GMT helper: 24-hour dial
   ========================================================= */
let gmtTimer = null;

function zonesList() {
  const fromSlots = store.get().worldSlots.filter(Boolean).map((s) => [s.timezone, `${s.name} (${s.timezone})`]);
  let all = [];
  try { all = Intl.supportedValuesOf('timeZone'); } catch (e) { all = ['Europe/London', 'Europe/Paris', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo', 'Asia/Hong_Kong', 'Australia/Sydney', 'Asia/Dubai', 'Asia/Singapore']; }
  return { fromSlots, all };
}

function gmtDial(hourFloat, homeFloat) {
  const cx = 150, cy = 150, R = 136;
  let s = `<svg viewBox="0 0 300 300" class="gmt-svg" aria-hidden="true"><circle cx="${cx}" cy="${cy}" r="${R}" fill="#0b0d12" stroke="#2a3142" stroke-width="3"/>`;
  // day/night halves of the bezel (06–18 light)
  s += `<path d="M ${cx} ${cy} L ${cx + R * Math.sin(Math.PI / 2)} ${cy - R * Math.cos(Math.PI / 2)} A ${R} ${R} 0 0 1 ${cx + R * Math.sin(Math.PI * 1.5)} ${cy - R * Math.cos(Math.PI * 1.5)} Z" fill="#141a2b"/>`;
  for (let h = 0; h < 24; h++) {
    const a = (h / 24) * 2 * Math.PI;
    const x1 = cx + Math.sin(a) * (R - 4), y1 = cy - Math.cos(a) * (R - 4);
    const x2 = cx + Math.sin(a) * (R - (h % 2 ? 12 : 18)), y2 = cy - Math.cos(a) * (R - (h % 2 ? 12 : 18));
    s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#8f98ab" stroke-width="${h % 2 ? 2 : 3}"/>`;
    if (h % 2 === 0) {
      const tx = cx + Math.sin(a) * (R - 36), ty = cy - Math.cos(a) * (R - 36);
      s += `<text x="${tx}" y="${ty}" fill="#eef1f7" font-size="17" font-weight="700" text-anchor="middle" dominant-baseline="central">${h === 0 ? 24 : h}</text>`;
    }
  }
  const hand = (hf, colour, len, w) => {
    const a = (hf / 24) * 2 * Math.PI;
    return `<line x1="${cx}" y1="${cy}" x2="${cx + Math.sin(a) * len}" y2="${cy - Math.cos(a) * len}" stroke="${colour}" stroke-width="${w}" stroke-linecap="round"/>` +
      `<polygon points="${cx + Math.sin(a) * (len + 12)},${cy - Math.cos(a) * (len + 12)} ${cx + Math.sin(a + 0.07) * (len - 6)},${cy - Math.cos(a + 0.07) * (len - 6)} ${cx + Math.sin(a - 0.07) * (len - 6)},${cy - Math.cos(a - 0.07) * (len - 6)}" fill="${colour}"/>`;
  };
  s += hand(homeFloat, '#4b5568', 70, 4);
  s += hand(hourFloat, '#f87171', 82, 5);
  s += `<circle cx="${cx}" cy="${cy}" r="7" fill="#f87171"/></svg>`;
  return s;
}

function renderGmt() {
  const box = $('tool-gmt-body');
  const data = store.get();
  const zone = data.gmtZone || 'Etc/UTC';
  const { fromSlots, all } = zonesList();
  const sel = el('select', { class: 'input', 'aria-label': 'Second time zone', onchange: (e) => { data.gmtZone = e.target.value; store.save(); renderGmt(); } },
    el('optgroup', { label: 'Common' }, [['Etc/UTC', 'UTC / GMT'], ...fromSlots].map(([v, l]) => el('option', { value: v, selected: v === zone }, l))),
    el('optgroup', { label: 'All time zones' }, all.map((z) => el('option', { value: z, selected: z === zone && !fromSlots.some((f) => f[0] === z) && z !== 'Etc/UTC' }, z.replace(/_/g, ' ')))));
  const dial = el('div', { class: 'gmt-dial' });
  const info = el('div', { class: 'gmt-info' });
  const draw = () => {
    const t = now();
    const p = partsIn(zone, t);
    const local = new Date(t);
    const hf = p.h + p.mi / 60, lf = local.getHours() + local.getMinutes() / 60;
    dial.innerHTML = gmtDial(hf, lf);
    info.innerHTML = '';
    info.append(
      el('div', { class: 'gmt-big' }, `${pad(p.h)}:${pad(p.mi)}`),
      el('div', {}, `Point the GMT hand (red) at `, el('b', {}, `${pad(p.h)}:${pad(p.mi)}`), ` on the 24-hour scale, with the bezel at 24 (zero).`),
      el('div', { class: 'muted small' }, `Grey hand: your local time on the same scale (${pad(local.getHours())}:${pad(local.getMinutes())}).`));
  };
  draw();
  box.innerHTML = '';
  box.append(el('div', { class: 'card gmt-card' }, el('label', { class: 'field' }, el('span', {}, 'Second time zone'), sel), dial, info),
    el('div', { class: 'card' }, el('h2', { class: 'card-title' }, 'GMT tips'),
      el('ul', { class: 'plain-list small' },
        el('li', {}, '“Flyer” GMTs (e.g. Rolex 3285): the jumping hour hand changes local time; the GMT hand keeps home time.'),
        el('li', {}, '“Caller” GMTs: the GMT hand jumps; set it to the second zone with the crown.'),
        el('li', {}, 'Rotating the bezel lets you read a third zone: turn it by the hour difference.'))));
  clearInterval(gmtTimer);
  gmtTimer = setInterval(draw, 15000);
}

/* ========================================================= */
export function register({ registerTool }) {
  registerTool({ id: 'setting', title: 'Set to the minute', icon: '⏱️', desc: 'Countdown + beeps, date safety', panel: 'setting', show: renderSetting, hide: hideSetting, order: 10 });
  registerTool({ id: 'moon', title: 'Moon phase', icon: '🌔', desc: 'Set your moonphase', panel: 'moon', show: renderMoon, order: 20 });
  registerTool({ id: 'gmt', title: 'GMT helper', icon: '🌐', desc: 'Where the GMT hand points', panel: 'gmt', show: renderGmt, hide: () => clearInterval(gmtTimer), order: 30 });
  // Danger-zone warning on the Clock tab (only shown 21:00–03:00).
  const after = document.getElementById('clk-tz');
  if (after && !$('clock-zone')) after.after(el('div', { id: 'clock-zone', class: 'clock-zone', hidden: true }));
  updateClockZone();
  setInterval(updateClockZone, 30000);
}
