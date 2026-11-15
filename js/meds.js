// Medication timers (up to 20). Each one holds the instructions from the packet — adult or child
// dose, "every 4 to 6 hours", "no more than 8 tablets in 24 hours", food, expiry date — and a log of
// doses taken. The card shows when the next dose is too soon, when you're in the recommended time
// window, and warns before you go over the 24-hour maximum.
import * as store from './store.js';
import { el, pad, toast, confirmModal, openModal } from './ui.js';
import { unlockAudio } from './countdown.js';
import { ringAlert, toneField } from './ring.js';

const MAX_MEDS = 20;
const H = 3600000, DAY = 24 * H;
const UNITS = ['tablets', 'capsules', 'caplets', 'ml', 'sachets', 'puffs', 'drops', 'patches', 'doses'];
const FOOD = [['any', 'Not stated on the packet'], ['with', 'Take with or after food'], ['empty', 'Take on an empty stomach'], ['water', 'Take with a full glass of water']];
const FOOD_SHORT = { with: '🍽️ With or after food', empty: '🚫🍽️ Empty stomach', water: '💧 With a full glass of water' };

const hhmm = (t) => { const x = new Date(t); return `${pad(x.getHours())}:${pad(x.getMinutes())}`; };
function when(t) {
  const x = new Date(t), today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((new Date(x).setHours(0, 0, 0, 0) - today) / DAY);
  return (days === 0 ? '' : days === 1 ? 'tomorrow ' : days === -1 ? 'yesterday ' : x.toLocaleDateString('en-GB', { weekday: 'short' }) + ' ') + hhmm(t);
}
function clock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${h}:${pad(m)}:${pad(s % 60)}`;
}
const words = (ms) => { const m = Math.round(ms / 60000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`; };
const num = (v, lo, hi) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo; };
const fmtN = (n) => String(Math.round(n * 100) / 100);
const unitOf = (m, n = 2) => (n === 1 && /s$/.test(m.unit) && m.unit !== 'ml' ? m.unit.slice(0, -1) : m.unit);

export function newMed() {
  return { id: store.uid(), name: '', who: 'adult', age: '', doseMin: 1, doseMax: 1, unit: 'tablets', minH: 4, maxH: 4, max24: 0,
    food: 'any', expiry: '', remind: 'start', sound: 'medium', log: [], endAt: null, rang: false };
}

/** Bring older saved timers (single interval) up to date. */
export function tidy(m) {
  if (m.minH == null) { const h = (m.h || 0) + (m.m || 0) / 60 || 4; m.minH = h; m.maxH = h; }
  m.who ||= 'adult'; m.unit ||= 'tablets'; m.food ||= 'any'; m.remind ||= 'start';
  if (m.doseMin == null) m.doseMin = 1;
  if (m.doseMax == null || m.doseMax < m.doseMin) m.doseMax = m.doseMin;
  if (m.maxH < m.minH) m.maxH = m.minH;
  if (!Array.isArray(m.log)) m.log = m.startedAt ? [{ t: m.startedAt, amt: m.doseMin }] : [];
  m.log = m.log.filter((x) => x.t > Date.now() - 7 * DAY);
  return m;
}

/* ---------- The rules from the packet ---------- */
const lastDose = (m) => m.log[m.log.length - 1] || null;
const takenIn24 = (m, at) => m.log.filter((x) => x.t > at - DAY && x.t <= at).reduce((s, x) => s + x.amt, 0);

/** Earliest time a dose of `amt` keeps within the 24-hour maximum (or `from` if fine already). */
function limitFreeAt(m, amt, from) {
  if (!m.max24) return from;
  const logs = m.log.filter((x) => x.t > from - DAY).sort((a, b) => a.t - b.t);
  let total = logs.reduce((s, x) => s + x.amt, 0), at = from;
  for (const x of logs) {
    if (total + amt <= m.max24) break;
    total -= x.amt; at = Math.max(at, x.t + DAY + 1000);
  }
  return total + amt <= m.max24 ? at : null;
}

function expiryState(m) {
  if (!/^\d{4}-\d{2}$/.test(m.expiry || '')) return null;
  const [y, mo] = m.expiry.split('-').map(Number);
  const endOfMonth = new Date(y, mo, 1).getTime();      // packets mean the end of that month
  const label = `${pad(mo)}/${y}`;
  if (Date.now() >= endOfMonth) return { cls: 'bad', text: `Expired (${label}) — don’t take it. Take it back to a pharmacy to dispose of safely.` };
  if (endOfMonth - Date.now() < 31 * DAY) return { cls: 'warn', text: `Expires at the end of ${label}.` };
  return { cls: 'ok', text: `Use by end of ${label}` };
}

/** Where this medicine is now. */
export function medStatus(m, t = Date.now()) {
  const last = lastDose(m);
  if (!last) return { cls: 'idle', big: 'Ready', text: 'No doses recorded yet. Tap “I’ve taken a dose” when you take one.' };
  const early = last.t + m.minH * H, late = last.t + m.maxH * H;
  const free = limitFreeAt(m, m.doseMin, t);
  if (free == null || free > t + 1000) {
    const at = free ?? t + DAY;
    return { cls: 'limit', big: clock(at - t), text: `24-hour maximum reached (${fmtN(takenIn24(m, t))} of ${fmtN(m.max24)} ${m.unit}). No more until ${when(Math.max(at, early))}.`, next: Math.max(at, early) };
  }
  const span = m.maxH > m.minH;
  if (t < early) return { cls: 'wait', big: clock(early - t), text: span ? `Too soon. Best time for the next dose: ${when(early)}–${hhmm(late)}.` : `Too soon. Next dose from ${when(early)}.`, next: early };
  if (span && t <= late) return { cls: 'window', big: 'OK now', text: `In the recommended window (${hhmm(early)}–${hhmm(late)}) — ${words(late - t)} left. Only take it if you need it.` };
  return { cls: 'open', big: 'OK now', text: `It’s been ${words(t - last.t)} since the last dose — OK to take one if you need it.` };
}

/** Warnings for taking `amt` at time `at`. */
function doseWarnings(m, amt, at) {
  const w = [];
  const before = m.log.filter((x) => x.t <= at).pop();
  if (before && at < before.t + m.minH * H) w.push(`Too soon: the packet says at least ${fmtN(m.minH)} hours between doses — the last was ${when(before.t)}, so the next is due from ${when(before.t + m.minH * H)}.`);
  if (m.max24 && takenIn24(m, at) + amt > m.max24) w.push(`This would make ${fmtN(takenIn24(m, at) + amt)} ${m.unit} in 24 hours — more than the maximum of ${fmtN(m.max24)} on the packet.`);
  if (amt > m.doseMax) w.push(`${fmtN(amt)} ${unitOf(m, amt)} is more than the single dose on the packet (${doseText(m)}).`);
  const ex = expiryState(m);
  if (ex?.cls === 'bad') w.push(ex.text);
  return w;
}

const doseText = (m) => `${fmtN(m.doseMin)}${m.doseMax > m.doseMin ? `–${fmtN(m.doseMax)}` : ''} ${unitOf(m, m.doseMax)}`;
const everyText = (m) => `every ${fmtN(m.minH)}${m.maxH > m.minH ? `–${fmtN(m.maxH)}` : ''} hours`;

/** When to remind: the start (or end) of the window, but never before the 24-hour limit allows. */
function schedule(m) {
  const last = lastDose(m);
  if (!last) { m.endAt = null; m.rang = false; return; }
  let at = last.t + (m.remind === 'end' ? m.maxH : m.minH) * H;
  const free = limitFreeAt(m, m.doseMin, at);
  if (free != null) at = Math.max(at, free);
  m.endAt = at; m.rang = at <= Date.now();
}

/* ---------- Background check ---------- */
export function checkMeds(meds, changed) {
  const t = Date.now();
  for (const m of meds) {
    if (!m.endAt || m.rang || t < m.endAt) continue;
    m.rang = true; store.save(); changed();
    const span = m.maxH > m.minH, last = lastDose(m);
    const label = [
      last && span ? `Recommended window: ${hhmm(last.t + m.minH * H)}–${hhmm(last.t + m.maxH * H)}` : `Dose: ${doseText(m)}`,
      FOOD_SHORT[m.food] || null,
      'Only take it if you need it, as directed on the packet.',
    ].filter(Boolean).join(' · ');
    ringAlert({ icon: '💊', title: m.name || 'Medication', label, sound: m.sound,
      buttons: [{ label: 'Dismiss' }, { label: 'Record a dose', kind: 'primary', fn: () => setTimeout(() => takeDose(m, changed), 200) }] });
  }
}

/* ---------- Taking a dose ---------- */
function takeDose(m, after) {
  unlockAudio();
  const amtOpts = [];
  for (let a = m.doseMin; a <= m.doseMax + 1e-9 && amtOpts.length < 12; a += m.doseMin >= 1 ? 1 : m.doseMin) amtOpts.push(Math.round(a * 100) / 100);
  if (!amtOpts.length) amtOpts.push(m.doseMin);
  let amt = amtOpts[0];
  const amtIn = el('input', { type: 'number', inputmode: 'decimal', step: 'any', min: 0, class: 'input', value: amt });
  const chips = amtOpts.length > 1 ? el('div', { class: 'seg', style: `grid-template-columns: repeat(${Math.min(amtOpts.length, 4)}, minmax(0, 1fr))` },
    amtOpts.map((a) => el('button', { type: 'button', class: 'seg-btn' + (a === amt ? ' active' : ''), onclick: (e) => {
      amt = a; amtIn.value = a; e.target.parentNode.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b === e.target)); upd();
    } }, `${fmtN(a)} ${unitOf(m, a)}`))) : null;
  const nowD = new Date();
  const timeIn = el('input', { type: 'time', class: 'input', value: `${pad(nowD.getHours())}:${pad(nowD.getMinutes())}` });
  const warnBox = el('div', {});
  const at = () => {
    const [h, mi] = (timeIn.value || '').split(':').map(Number);
    const x = new Date(); if (Number.isFinite(h)) x.setHours(h, mi, 0, 0);
    if (x.getTime() > Date.now() + 60000) x.setDate(x.getDate() - 1);   // a later clock time means yesterday
    return x.getTime();
  };
  let btn;
  const upd = () => {
    amt = num(amtIn.value, 0, 1000);
    const w = doseWarnings(m, amt, at());
    warnBox.innerHTML = '';
    if (w.length) warnBox.append(el('div', { class: 'notice bad' }, el('b', {}, '⚠️ Please check before taking: '), el('ul', { class: 'warn-list' }, w.map((x) => el('li', {}, x))),
      el('div', { class: 'small' }, 'If you’re unsure, ask a pharmacist or call NHS 111 (or your local health line).')));
    if (btn) { btn.textContent = w.length ? 'Record anyway' : 'Record dose'; btn.className = 'btn ' + (w.length ? 'danger' : 'primary'); }
  };
  amtIn.addEventListener('input', upd); timeIn.addEventListener('change', upd);
  const ex = expiryState(m);
  const dlg = openModal({
    title: `💊 ${m.name || 'Medication'}`,
    content: [
      el('p', { class: 'small' }, `Packet: ${m.who === 'child' ? 'child' : 'adult'} dose ${doseText(m)}${m.who === 'child' && m.age ? ` (${m.age})` : ''}, ${everyText(m)}${m.max24 ? `, no more than ${fmtN(m.max24)} ${m.unit} in 24 hours` : ''}.`),
      FOOD_SHORT[m.food] ? el('div', { class: 'food-tag' }, FOOD_SHORT[m.food]) : null,
      ex && ex.cls !== 'ok' ? el('div', { class: `notice ${ex.cls === 'bad' ? 'bad' : 'warn'}` }, ex.text) : null,
      chips,
      el('label', { class: 'field' }, el('span', {}, `How much (${m.unit})`), amtIn),
      el('label', { class: 'field' }, el('span', {}, 'Time taken'), timeIn),
      warnBox,
    ],
    actions: [{ label: 'Cancel' }, { label: 'Record dose', kind: 'primary', onClick: () => {
      if (!(amt > 0)) { toast('Enter how much you took'); return false; }
      const t = at();
      m.log.push({ t, amt }); m.log.sort((a, b) => a.t - b.t);
      schedule(m); store.save();
      toast(m.endAt ? `Recorded. ${m.remind === 'end' ? 'Reminder' : 'Next dose from'} ${when(m.endAt)}` : 'Recorded');
      after?.();
    } }],
  });
  btn = dlg.dlg.querySelector('.modal-actions .btn:last-child');
  upd();
}

/* ---------- Screen ---------- */
const numField = (label, value, step, onchange, cls = '') => el('label', { class: 'num-box ' + cls },
  el('input', { type: 'number', inputmode: 'decimal', step, min: 0, value: fmtN(value), class: 'input num-in', 'aria-label': label, onchange, onfocus: (e) => e.target.select() }),
  el('span', {}, label));

function packetForm(m, rerender) {
  const set = (k, lo, hi) => (e) => { m[k] = num(e.target.value, lo, hi); tidyAndSave(); };
  const tidyAndSave = () => { tidy(m); if (lastDose(m)) schedule(m); store.save(); };
  const seg = (k, opts) => el('div', { class: 'seg' }, opts.map(([v, l]) => el('button', { type: 'button', class: 'seg-btn' + (m[k] === v ? ' active' : ''), onclick: () => { m[k] = v; tidyAndSave(); rerender(); } }, l)));
  return el('details', { class: 'packet', open: !m.name || !m.log.length },
    el('summary', {}, '📦 Instructions from the packet'),
    el('p', { class: 'muted small' }, 'Copy these from the box or leaflet, for the right person — adult and child doses are often different.'),
    el('div', { class: 'field' }, el('span', {}, 'Dose for'), seg('who', [['adult', 'Adult'], ['child', 'Child']])),
    m.who === 'child' ? el('label', { class: 'field' }, el('span', {}, 'Child’s age or weight band on the packet'),
      el('input', { type: 'text', class: 'input', value: m.age || '', placeholder: 'e.g. 6–8 years', onchange: (e) => { m.age = e.target.value.trim(); store.save(); } })) : null,
    el('div', { class: 'field' }, el('span', {}, 'Each dose'),
      el('div', { class: 'pk-row' }, numField('from', m.doseMin, 'any', set('doseMin', 0, 1000)), el('span', { class: 'pk-to' }, 'to'), numField('up to', m.doseMax, 'any', set('doseMax', 0, 1000)),
        el('select', { class: 'input', onchange: (e) => { m.unit = e.target.value; store.save(); rerender(); } }, UNITS.map((u) => el('option', { value: u, selected: m.unit === u }, u))))),
    el('div', { class: 'field' }, el('span', {}, 'How often'),
      el('div', { class: 'pk-row' }, el('span', { class: 'pk-to' }, 'every'), numField('hours', m.minH, '0.5', set('minH', 0.25, 72)), el('span', { class: 'pk-to' }, 'to'), numField('hours', m.maxH, '0.5', set('maxH', 0.25, 72)))),
    el('p', { class: 'muted small' }, 'If the packet gives one time (e.g. “every 8 hours”), put the same number in both. If it says “at least 4 hours between doses”, put 4 in both.'),
    el('div', { class: 'field' }, el('span', {}, 'Maximum in 24 hours (0 = not stated)'),
      el('div', { class: 'pk-row' }, el('span', { class: 'pk-to' }, 'no more than'), numField(m.unit, m.max24, 'any', set('max24', 0, 1000)))),
    el('label', { class: 'field' }, el('span', {}, 'Food'), el('select', { class: 'input', onchange: (e) => { m.food = e.target.value; store.save(); rerender(); } },
      FOOD.map(([v, l]) => el('option', { value: v, selected: m.food === v }, l)))),
    el('label', { class: 'field' }, el('span', {}, 'Expiry date (“EXP” on the box)'),
      el('input', { type: 'month', class: 'input', value: m.expiry || '', onchange: (e) => { m.expiry = e.target.value; store.save(); rerender(); } })),
    el('label', { class: 'field' }, el('span', {}, 'Remind me'), el('select', { class: 'input', onchange: (e) => { m.remind = e.target.value; tidyAndSave(); rerender(); } },
      [['start', 'When the next dose is allowed (start of the window)'], ['end', 'At the end of the window']].map(([v, l]) => el('option', { value: v, selected: m.remind === v }, l)))),
    toneField(m.sound, (v) => { m.sound = v; store.save(); }, 'Alarm sound'));
}

export function viewMeds(box, rerender, meds) {
  meds.forEach(tidy);
  const cards = meds.map((m, i) => {
    const st = medStatus(m);
    const big = el('div', { class: 'med-big' }, st.big), txt = el('div', { class: 'small med-txt' }, st.text);
    const tally = el('div', { class: 'small muted med-tally' });
    const ex = expiryState(m);
    const recent = m.log.filter((x) => x.t > Date.now() - DAY);
    const card = el('div', { class: `card med-card ${st.cls}` },
      el('div', { class: 'med-head' }, el('span', { class: 'bank-no' }, String(i + 1)),
        el('input', { type: 'text', class: 'input med-name', value: m.name, placeholder: 'Medicine name, e.g. Paracetamol 500 mg', 'aria-label': 'Medicine name',
          onchange: (ev) => { m.name = ev.target.value.trim(); store.save(); } })),
      el('div', { class: 'med-tags' },
        el('span', { class: 'chip' }, m.who === 'child' ? `Child${m.age ? ' · ' + m.age : ''}` : 'Adult'),
        el('span', { class: 'chip' }, `${doseText(m)} ${everyText(m)}`),
        m.max24 ? el('span', { class: 'chip' }, `max ${fmtN(m.max24)} in 24 h`) : null,
        FOOD_SHORT[m.food] ? el('span', { class: 'chip' }, FOOD_SHORT[m.food]) : null),
      ex && ex.cls !== 'ok' ? el('div', { class: `notice ${ex.cls === 'bad' ? 'bad' : 'warn'} small` }, ex.text) : null,
      el('div', { class: 'med-status' }, big, txt, tally),
      recent.length ? el('div', { class: 'med-log small' }, el('span', { class: 'muted' }, 'Last 24 h: '),
        recent.map((x) => `${hhmm(x.t)} (${fmtN(x.amt)})`).join(' · '),
        el('button', { type: 'button', class: 'link-btn', onclick: async () => {
          if (!(await confirmModal('Remove the last dose?', `Removes ${hhmm(lastDose(m).t)} (${fmtN(lastDose(m).amt)} ${m.unit}) from the record.`, 'Remove', true))) return;
          m.log.pop(); schedule(m); store.save(); rerender();
        } }, 'Undo last')) : null,
      el('div', { class: 'med-btns' },
        el('button', { type: 'button', class: 'btn primary', onclick: () => takeDose(m, rerender) }, '💊 I’ve taken a dose'),
        el('button', { type: 'button', class: 'btn', disabled: !m.log.length && !m.endAt, onclick: async () => {
          if (!(await confirmModal('Reset this timer?', 'Clears the dose record and the reminder. The packet instructions are kept.', 'Reset', true))) return;
          m.log = []; m.endAt = null; m.rang = false; store.save(); rerender();
        } }, 'Reset'),
        el('button', { type: 'button', class: 'btn danger', onclick: async () => {
          if (!(await confirmModal(`Delete ${m.name || 'this timer'}?`, 'Its name, packet instructions and dose record will be removed.', 'Delete', true))) return;
          meds.splice(meds.indexOf(m), 1); store.save(); rerender();
        } }, 'Delete')),
      packetForm(m, rerender));
    return { card, m, big, txt, tally };
  });
  box.append(
    el('div', { class: 'notice warn med-safety' },
      el('b', {}, 'Always follow the directions on the packet or patient leaflet, and your doctor’s or pharmacist’s advice. '),
      'These timers are reminders only — they can’t check that a medicine is right for you, and they only ring while this app is open on screen.',
      el('details', { open: !meds.some((m) => m.log.length) }, el('summary', {}, 'Before taking any medicine'),
        el('ul', { class: 'warn-list' },
          el('li', {}, el('b', {}, 'Check the expiry date'), ' (“EXP”) on the box or blister strip. Don’t take medicine that’s out of date — take it back to a pharmacy.'),
          el('li', {}, el('b', {}, 'Check whether to take it with food'), ' or on an empty stomach. Some painkillers, such as ibuprofen and aspirin, can upset or harm the stomach if taken without food.'),
          el('li', {}, el('b', {}, 'Use the right dose for the person'), ' — children’s doses go by age or weight. Use the spoon or syringe that comes with liquid medicines, not a kitchen spoon.'),
          el('li', {}, el('b', {}, 'Don’t double up on ingredients.'), ' Many cold and flu remedies already contain paracetamol or ibuprofen — check the ingredients so you don’t take too much by accident.'),
          el('li', {}, el('b', {}, 'Missed a dose?'), ' Don’t take two doses to make up for it, unless the leaflet says to.'),
          el('li', {}, 'Ask a pharmacist first if you’re pregnant or breastfeeding, have allergies, asthma, stomach, kidney, liver or heart problems, take other medicines, or drink alcohol.'),
          el('li', {}, 'Store medicines out of the sight and reach of children.'),
          el('li', {}, 'If symptoms don’t get better, or you think someone has taken too much, get medical advice straight away (NHS 111 or 999 in the UK) — even if they seem well.')))),
    ...cards.map((c) => c.card),
    meds.length < MAX_MEDS
      ? el('button', { type: 'button', class: 'btn wide add-med', onclick: () => { meds.push(newMed()); store.save(); rerender(); setTimeout(() => { const n = document.querySelectorAll('.med-name'); n[n.length - 1]?.focus(); }, 50); } },
        `＋ Add another medication timer (${meds.length} of ${MAX_MEDS})`)
      : el('p', { class: 'muted small center' }, `All ${MAX_MEDS} medication timers are in use.`));
  return () => {
    const t = Date.now();
    for (const c of cards) {
      const st = medStatus(c.m, t);
      if (c.big.textContent !== st.big) c.big.textContent = st.big;
      if (c.txt.textContent !== st.text) c.txt.textContent = st.text;
      const tl = c.m.max24 ? `${fmtN(takenIn24(c.m, t))} of ${fmtN(c.m.max24)} ${c.m.unit} taken in the last 24 hours` : '';
      if (c.tally.textContent !== tl) c.tally.textContent = tl;
      const cls = `card med-card ${st.cls}`;
      if (c.card.className !== cls) c.card.className = cls;
    }
  };
}
