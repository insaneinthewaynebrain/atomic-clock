// Medication timers (up to 20), worked out backwards from the packet:
//   • the most doses allowed in 24 hours (e.g. 4)
//   • the shortest gap allowed between doses (e.g. 4 hours), and optionally the longest (e.g. 6)
// plus the user's day (wake-up and bedtime). The app spreads the doses evenly across the waking day,
// shows the best time for the next dose and the earliest it's allowed, and re-plans the rest of the
// day whenever a dose is taken — even if it's taken early.
import * as store from './store.js';
import { el, pad, toast, confirmModal, openModal } from './ui.js';
import { unlockAudio } from './countdown.js';
import { ringAlert } from './ring.js';
import { primeSpeech } from './wakewords.js';

const MAX_MEDS = 20;
const MIN = 60000, H = 60 * MIN, DAY = 24 * H;

const hhmm = (t) => { const x = new Date(t); return `${pad(x.getHours())}:${pad(x.getMinutes())}`; };
function when(t) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((new Date(t).setHours(0, 0, 0, 0) - today) / DAY);
  return (days === 1 ? 'tomorrow ' : days === -1 ? 'yesterday ' : days ? new Date(t).toLocaleDateString('en-GB', { weekday: 'short' }) + ' ' : '') + hhmm(t);
}
function span(ms) {
  const m = Math.max(0, Math.round(ms / MIN));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
}
function countdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
const fmtH = (h) => String(Math.round(h * 10) / 10);
const hrs = (h) => `${Math.round(h * 10) / 10} hour${h === 1 ? '' : 's'}`;
const num = (v, lo, hi, dflt) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt; };

/* ---------- Data ---------- */
export function newMed() {
  return { id: store.uid(), name: '', dose: '', perDay: 4, minGap: 4, maxGap: 0, food: 'any', expiry: '', remind: 'best', sound: 'medium', log: [], endAt: null, rang: false };
}

/** Bring older saved timers up to date. */
export function tidy(m) {
  if (m.perDay == null) {
    const minH = m.minH ?? ((m.h || 0) + (m.m || 0) / 60 || 4);
    const maxH = m.maxH ?? minH;
    m.minGap = minH; m.maxGap = maxH > minH ? maxH : 0;
    m.perDay = m.max24 && m.doseMax ? Math.max(1, Math.floor(m.max24 / m.doseMax)) : Math.max(1, Math.min(12, Math.floor(24 / minH)));
    if (!m.dose && m.doseMin) m.dose = `${m.doseMin}${m.doseMax > m.doseMin ? '–' + m.doseMax : ''} ${m.unit || 'tablets'}`;
    if (m.food === 'water') m.food = 'any';
    m.remind = m.remind === 'end' ? 'best' : (m.remind === 'start' ? 'best' : m.remind || 'best');
  }
  if (!Array.isArray(m.log)) m.log = m.startedAt ? [{ t: m.startedAt }] : [];
  m.log = m.log.filter((x) => x.t > Date.now() - 7 * DAY).sort((a, b) => a.t - b.t);
  if (m.maxGap && m.maxGap < m.minGap) m.maxGap = m.minGap;
  return m;
}

const dayCfg = () => (store.get().medDay ||= { wake: '07:00', bed: '23:00' });
const minsOf = (s) => { const [h, mi] = s.split(':').map(Number); return h * 60 + mi; };
/** Length of the waking day in ms (bedtime after midnight is fine). */
function awakeMs() {
  const c = dayCfg();
  let d = minsOf(c.bed) - minsOf(c.wake);
  if (d <= 0) d += 1440;
  return d * MIN;
}
/** The waking period { w, b } that `t` falls in — or, if asleep, the one that just ended. */
function periodAt(t) {
  const c = dayCfg(), len = awakeMs();
  const base = new Date(t); base.setHours(0, 0, 0, 0);
  const wm = minsOf(c.wake) * MIN;
  for (const off of [0, -1, -2]) {
    const w = base.getTime() + off * DAY + wm;
    if (w <= t) return { w, b: w + len };
  }
  return { w: base.getTime() - DAY + wm, b: base.getTime() - DAY + wm + len };
}
const nextWake = (t) => { const p = periodAt(t); return p.w + DAY; };

/** The evenly spread gap for a full day, kept within the packet's limits. */
function dayGap(m) {
  const g = m.perDay > 1 ? awakeMs() / (m.perDay - 1) : DAY;
  return clampGap(m, g);
}
function clampGap(m, g) {
  g = Math.max(g, m.minGap * H);
  if (m.maxGap) g = Math.min(g, m.maxGap * H);
  return g;
}

const in24 = (m, at) => m.log.filter((x) => x.t > at - DAY && x.t <= at).length;
/** Earliest moment from `from` when one more dose keeps within the 24-hour maximum. */
function capFree(m, from) {
  const recent = m.log.filter((x) => x.t > from - DAY && x.t <= from);
  if (recent.length < m.perDay) return from;
  return recent[recent.length - m.perDay].t + DAY + 1000;
}

/**
 * The plan from now: { soonest, best, today: [times still planned in this waking day] }.
 * Re-worked every time from the last dose taken.
 */
export function plan(m, t = Date.now()) {
  const last = m.log[m.log.length - 1];
  if (!last || t - last.t > DAY) {
    // Nothing recent: take the first dose now if you're awake, otherwise when you wake up.
    const p = periodAt(t);
    const awake = t < p.b;
    const best = awake ? t : nextWake(t);
    return { soonest: t, best, first: true, gap: dayGap(m), today: spread(m, best, awake ? p.b : best + awakeMs(), m.perDay) };
  }
  const soonest = Math.max(last.t + m.minGap * H, capFree(m, last.t + m.minGap * H));
  const p = periodAt(last.t);
  const takenToday = m.log.filter((x) => x.t >= p.w && x.t <= last.t).length;
  const left = m.perDay - takenToday;
  let best, gap = dayGap(m), end = p.b;
  if (last.t < p.b && left > 0) {
    gap = clampGap(m, (p.b - last.t) / left);
    best = last.t + gap;
    if (best > p.b + 30 * MIN) { best = p.w + DAY; end = best + awakeMs(); gap = dayGap(m); }
  } else { best = p.w + DAY; end = best + awakeMs(); }
  best = Math.max(best, soonest);
  return { soonest, best, gap, today: spread(m, best, end, left > 0 ? left : m.perDay) };
}

function spread(m, from, end, count) {
  const out = [];
  const g = count > 1 ? clampGap(m, (end - from) / (count - 1)) : 0;
  for (let i = 0; i < count; i++) {
    const at = from + i * g;
    if (i && at > end + 30 * MIN) break;
    out.push(at);
  }
  return out;
}

/* ---------- Reminders ---------- */
function schedule(m) {
  const last = m.log[m.log.length - 1];
  if (!last) { m.endAt = null; m.rang = false; return; }
  const p = plan(m);
  m.endAt = m.remind === 'soonest' ? p.soonest : p.best;
  m.rang = m.endAt <= Date.now() + 1000;
}

export function checkMeds(meds, changed) {
  const t = Date.now();
  for (const m of meds) {
    if (!m.endAt || m.rang || t < m.endAt) continue;
    m.rang = true; store.save(); changed();
    const name = m.name || 'medication';
    ringAlert({
      icon: '💊', title: `Your ${name} timer has ended`,
      label: 'Check the packet before taking it — for example, whether to take it with food.',
      sound: 'chime', say: `Your ${name} timer has ended.`,
      buttons: [{ label: 'Stop' }, { label: 'I’ve taken it — start again', kind: 'primary', fn: () => setTimeout(() => takeNow(m, changed), 200) }],
    });
  }
}

/* ---------- Taking a dose ---------- */
/** Reasons to stop and think before recording a dose at `at`. */
function problems(m, at) {
  const out = [];
  const prev = m.log.filter((x) => x.t <= at).pop();
  if (prev && at < prev.t + m.minGap * H) out.push(`It’s only been ${span(at - prev.t)} since your last dose. The packet says to wait at least ${hrs(m.minGap)}.`);
  if (in24(m, at) + 1 > m.perDay) out.push(`This would be dose ${in24(m, at) + 1} in 24 hours. The packet says no more than ${m.perDay}.`);
  const p = periodAt(at);
  if (at >= p.b) out.push(`It’s after the bedtime you set (${hhmm(p.b)}). Should you be taking this medication now?`);
  else if (p.b - at < m.minGap * H) out.push(`There ${p.b - at < 2 * H ? 'is' : 'are'} only ${span(p.b - at)} before you go to bed (${hhmm(p.b)}). Should you be taking this medication now?`);
  const ex = expiry(m);
  if (ex?.bad) out.push(ex.text);
  return out;
}

function record(m, at, after) {
  m.log.push({ t: at }); m.log.sort((a, b) => a.t - b.t);
  schedule(m); store.save();
  const p = plan(m);
  toast(`Got it. Next dose around ${when(p.best)}`, 3500);
  after?.();
}

/** The serious warning: the user must tick to accept responsibility before "Take anyway" works. */
function severeWarning(issues) {
  return new Promise((resolve) => {
    let yes = false, btn = null;
    const tick = el('input', { type: 'checkbox', class: 'check', onchange: () => { if (btn) btn.disabled = !tick.checked; } });
    const dlg = openModal({
      title: '⚠️ Warning',
      className: 'severe',
      content: [
        el('ul', { class: 'warn-list severe-list' }, issues.map((x) => el('li', {}, x))),
        el('p', { class: 'small' }, 'If you’re not sure, don’t take it. Ask a pharmacist, or call NHS 111 (or your local health line). In an emergency call 999.'),
        el('label', { class: 'field check-field accept-box' }, tick,
          el('span', {}, 'I have read the packet. I accept full responsibility for taking this dose, and that this app gives no medical advice.')),
      ],
      actions: [{ label: 'Don’t take it', kind: 'primary' }, { label: 'Take anyway', kind: 'danger', onClick: () => { if (!tick.checked) return false; yes = true; } }],
      onClose: () => resolve(yes),
    });
    btn = dlg.dlg.querySelector('.modal-actions .btn:last-child');
    btn.disabled = true;
  });
}

async function takeNow(m, after, at = Date.now()) {
  unlockAudio(); primeSpeech();
  const issues = problems(m, at);
  if (issues.length && !(await severeWarning(issues))) return;
  record(m, at, after);
}

function tookEarlier(m, after) {
  const n = new Date();
  const timeIn = el('input', { type: 'time', class: 'input alarm-time-in', value: `${pad(n.getHours())}:${pad(n.getMinutes())}` });
  openModal({
    title: 'When did you take it?',
    content: [timeIn, el('p', { class: 'muted small' }, 'A time later than now counts as yesterday.')],
    actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', onClick: () => {
      const [h, mi] = timeIn.value.split(':').map(Number);
      const x = new Date(); x.setHours(h, mi, 0, 0);
      if (x.getTime() > Date.now() + MIN) x.setDate(x.getDate() - 1);
      setTimeout(() => takeNow(m, after, x.getTime()), 0);
    } }],
  });
}

function expiry(m) {
  if (!/^\d{4}-\d{2}$/.test(m.expiry || '')) return null;
  const [y, mo] = m.expiry.split('-').map(Number);
  const end = new Date(y, mo, 1).getTime();   // "EXP 03/2027" means the end of March
  if (Date.now() >= end) return { bad: true, text: `This medicine is out of date (EXP ${pad(mo)}/${y}). Don’t take it — take it back to a pharmacy.` };
  if (end - Date.now() < 31 * DAY) return { bad: false, text: `Goes out of date at the end of ${pad(mo)}/${y}.` };
  return null;
}

/* ---------- Screen ---------- */
function status(m, t = Date.now()) {
  const last = m.log[m.log.length - 1];
  const p = plan(m, t);
  if (!last || p.first) {
    if (p.best > t + MIN) return { cls: 'idle', head: `First dose around ${when(p.best)}`, big: '', sub: 'That’s when your day starts — or take one sooner if you need it.' };
    // As if a dose were taken now: when would the next one be?
    const next = plan({ ...m, log: [...m.log, { t }] }, t).best;
    return { cls: 'idle', head: 'Take a dose when you need it', big: '', sub: `If you take one now, your next dose will be around ${when(next)}.` };
  }
  if (t < p.soonest) {
    return { cls: 'wait', head: `Next dose around ${when(p.best)}`, big: countdown(p.best - t),
      sub: p.soonest < p.best - MIN ? `If you really need it sooner, the earliest is ${when(p.soonest)}.` : 'Not before then.' };
  }
  if (t < p.best) {
    return { cls: 'ok', head: `Next dose around ${when(p.best)}`, big: countdown(p.best - t), sub: 'You can take it sooner if you need it.' };
  }
  return { cls: 'due', head: 'Next dose is due now', big: '', sub: 'Take it when you need it.' };
}

const openSettings = new Set();   // which settings panels are open (kept while the screen redraws)

/** A big − value + control: easy to tap, nothing to type. */
function stepper(label, value, { min, max, step = 1, show, help }, onChange) {
  const out = el('div', { class: 'stepper-val', 'aria-live': 'polite' }, show(value));
  const go = (d) => { const v = Math.max(min, Math.min(max, Math.round((value + d) * 2) / 2)); if (v === value) return; value = v; out.textContent = show(v); onChange(v); };
  return el('div', { class: 'stepper-row' },
    el('div', { class: 'stepper-q' }, el('div', { class: 'stepper-label' }, label), help ? el('div', { class: 'stepper-help' }, help) : null),
    el('div', { class: 'stepper' },
      el('button', { type: 'button', class: 'step-btn', 'aria-label': `Less: ${label}`, onclick: () => go(-step) }, '−'),
      out,
      el('button', { type: 'button', class: 'step-btn', 'aria-label': `More: ${label}`, onclick: () => go(step) }, '+')));
}

function settings(m, rerender) {
  const changed = () => { tidy(m); schedule(m); store.save(); openSettings.add(m.id); rerender(); };
  const explainText = () => `With your day, that’s about one dose every ${span(dayGap(m))}.`;
  const explain = el('b', {}, explainText());
  const timesTxt = (n) => `${n} time${n === 1 ? '' : 's'}`;
  const hoursTxt = (h) => `${h} hour${h === 1 ? '' : 's'}`;
  const det = el('details', { class: 'packet', open: !m.name || !m.log.length || openSettings.has(m.id), ontoggle: () => { if (det.open) openSettings.add(m.id); else openSettings.delete(m.id); } },
    el('summary', {}, '⚙️ What the packet says'),
    stepper('How many times a day, at most?', m.perDay, { min: 1, max: 12, show: timesTxt, help: 'Look for “no more than … doses in 24 hours”.' }, (v) => { m.perDay = v; changed(); }),
    el('div', { class: 'stepper-group' },
      el('div', { class: 'stepper-title' }, 'How long to wait between doses?'),
      stepper('At least', m.minGap, { min: 1, max: 48, show: hoursTxt }, (v) => {
        m.minGap = v; if (m.maxGap && m.maxGap <= v) { m.maxGap = v + 1; maxBox.replaceWith(maxBox = maxStepper()); }
        changed();
      }),
      (maxBox = maxStepper()),
      el('p', { class: 'stepper-help' }, 'If the packet says “every 4 to 6 hours”, set 4 and 6. If it gives only one number, leave “At most” as “Not given”.')),
    el('p', { class: 'pk-explain' }, explain),
    el('div', { class: 'field' }, el('span', { class: 'stepper-label' }, 'When should the reminder ring?'),
      el('div', { class: 'remind-choice' }, [
        ['best', 'At the recommended time', 'Doses spread evenly through your day'],
        ['soonest', 'As soon as I’m allowed', 'When the shortest wait is over'],
      ].map(([v, l, h]) => el('button', { type: 'button', class: 'remind-opt' + (m.remind === v ? ' on' : ''), 'aria-pressed': String(m.remind === v),
        onclick: () => { m.remind = v; schedule(m); store.save(); openSettings.add(m.id); rerender(); } },
        el('span', { class: 'remind-tick' }, m.remind === v ? '✓' : ''), el('span', { class: 'remind-text' }, el('b', {}, l), el('span', {}, h)))))),
    el('div', { class: 'pk-end' },
      el('button', { type: 'button', class: 'btn sm', disabled: !m.log.length, onclick: async () => {
        if (!(await confirmModal('Clear the dose history?', 'Starts this medicine afresh. Its settings are kept.', 'Clear', true))) return;
        m.log = []; m.endAt = null; m.rang = false; store.save(); rerender();
      } }, 'Clear history'),
      el('button', { type: 'button', class: 'btn sm danger', onclick: async () => {
        if (!(await confirmModal(`Delete ${m.name || 'this medicine'}?`, '', 'Delete', true))) return;
        const list = store.get().timers.meds; list.splice(list.indexOf(m), 1); store.save(); rerender();
      } }, 'Delete')));
  var maxBox;
  function maxStepper() {
    // 0 means "not given"; going up from there starts at the "at least" time + 1 hour.
    return stepper('At most', m.maxGap || 0, { min: 0, max: 48, show: (h) => (h ? hoursTxt(h) : 'Not given') }, (raw) => {
      const prev = m.maxGap || 0;
      let v = raw;
      if (v > 0 && v <= m.minGap) v = raw > prev ? m.minGap + 1 : 0;   // must be longer than "at least"
      m.maxGap = v; changed();
      if (v !== raw) maxBox.replaceWith(maxBox = maxStepper());
    });
  }
  return det;
}

function dayCard(rerender) {
  const c = dayCfg();
  const save = (k) => (e) => { if (/^\d{2}:\d{2}$/.test(e.target.value)) { c[k] = e.target.value; store.get().timers.meds.forEach(schedule); store.save(); rerender(); } };
  return el('div', { class: 'card day-card' },
    el('h2', { class: 'card-title' }, '☀️ Your day'),
    el('div', { class: 'day-row' },
      el('label', { class: 'field' }, el('span', {}, 'I usually wake up at'), el('input', { type: 'time', class: 'input', value: c.wake, onchange: save('wake') })),
      el('label', { class: 'field' }, el('span', {}, 'and go to bed at'), el('input', { type: 'time', class: 'input', value: c.bed, onchange: save('bed') }))),
    el('p', { class: 'muted small' }, `Doses are spread across your ${span(awakeMs())} awake.`));
}

/* ---------- Terms: accepted once before the medication timers can be used ---------- */
export const MED_TERMS = [
  'These medication timers are reminders only. They are not a medical device and do not give medical advice.',
  'The app does not know which medicines are right for you, the correct dose, how medicines interact, or whether a medicine is out of date or should be taken with food.',
  'You are responsible for reading and following the packet or patient leaflet, and the advice of your doctor or pharmacist. The times shown are worked out only from the numbers you enter.',
  'Reminders can be missed: the app only rings while it is open on screen, and phones can be muted, locked, flat or switched off. Never rely on it for medicine where a missed or extra dose could cause serious harm.',
  'To the fullest extent permitted by law, the app’s makers accept no responsibility for any harm, loss or consequence arising from its use.',
  'If you think you or someone else has taken too much of a medicine, get medical help straight away (NHS 111, or 999 in an emergency) — even if they feel well.',
];

function termsCard(rerender) {
  const tick = el('input', { type: 'checkbox', class: 'check' });
  const go = el('button', { type: 'button', class: 'btn primary wide big-btn', disabled: true, onclick: () => {
    store.get().medTerms = { at: Date.now(), v: 1 }; store.save(); rerender();
  } }, 'Continue');
  tick.addEventListener('change', () => { go.disabled = !tick.checked; });
  return el('div', { class: 'card terms-card' },
    el('h2', { class: 'card-title' }, '💊 Before you use medication timers'),
    el('p', { class: 'small' }, 'Please read and accept these terms:'),
    el('ol', { class: 'terms-list' }, MED_TERMS.map((x) => el('li', {}, x))),
    el('label', { class: 'field check-field accept-box' }, tick, el('span', {}, 'I have read and accept these terms.')),
    go);
}

export function viewMeds(box, rerender, meds) {
  if (!store.get().medTerms) { box.append(termsCard(rerender)); return null; }
  meds.forEach(tidy);
  const cards = meds.map((m, i) => {
    const s = status(m);
    const head = el('div', { class: 'med-head-line' }, s.head), big = el('div', { class: 'med-big' }, s.big), sub = el('div', { class: 'small med-txt' }, s.sub);
    const ex = expiry(m);
    const card = el('div', { class: `card med-card ${s.cls}` },
      el('div', { class: 'med-head' }, el('span', { class: 'bank-no' }, String(i + 1)),
        el('input', { type: 'text', class: 'input med-name', value: m.name, placeholder: 'Name, e.g. Paracetamol', 'aria-label': 'Medicine name',
          onchange: (ev) => { m.name = ev.target.value.trim(); store.save(); } })),
      el('div', { class: 'med-rule small muted' }, `Up to ${m.perDay} time${m.perDay > 1 ? 's' : ''} a day · ${m.maxGap ? `${fmtH(m.minGap)} to ${fmtH(m.maxGap)} hours apart` : `at least ${hrs(m.minGap)} apart`}`),
      ex ? el('div', { class: `notice ${ex.bad ? 'bad' : 'warn'} small` }, ex.text) : null,
      el('div', { class: 'med-status' }, head, big, sub),
      el('div', { class: 'small muted center med-count' }, `${in24(m, Date.now())} of ${m.perDay} doses in the last 24 hours`),
      el('button', { type: 'button', class: 'btn primary wide big-btn', onclick: () => takeNow(m, rerender) }, '💊 I’ve taken a dose now'),
      el('p', { class: 'med-star' }, '* Before taking it, check the safety tips at the top — for example, whether to take it with food.'),
      el('div', { class: 'med-links' },
        el('button', { type: 'button', class: 'link-btn', onclick: () => tookEarlier(m, rerender) }, 'Took it earlier?'),
        m.log.length ? el('button', { type: 'button', class: 'link-btn', onclick: async () => {
          const l = m.log[m.log.length - 1];
          if (!(await confirmModal('Undo the last dose?', `Removes the dose at ${when(l.t)}.`, 'Undo'))) return;
          m.log.pop(); schedule(m); store.save(); rerender();
        } }, 'Undo last dose') : null),
      settings(m, rerender));
    return { card, m, head, big, sub };
  });
  box.append(
    el('div', { class: 'notice warn med-safety' },
      el('b', {}, 'Always follow the packet or leaflet, and your doctor’s or pharmacist’s advice. '),
      'This is a reminder only — it can’t tell whether a medicine is right for you, and it only rings while the app is open.',
      ' ', el('button', { type: 'button', class: 'link-btn inline', onclick: () => openModal({ title: 'Medication timer terms', content: el('ol', { class: 'terms-list' }, MED_TERMS.map((x) => el('li', {}, x))), actions: [{ label: 'Close', kind: 'primary' }] }) }, 'Terms'),
      el('details', {}, el('summary', {}, 'Safety tips before taking any medicine'),
        el('ul', { class: 'warn-list' },
          el('li', {}, el('b', {}, 'Check the date. '), 'Don’t take anything past its expiry (“EXP”) date.'),
          el('li', {}, el('b', {}, 'Check about food. '), 'Some medicines, like ibuprofen, should be taken with or after food to protect your stomach.'),
          el('li', {}, el('b', {}, 'Right dose for the person. '), 'Children’s doses depend on age or weight. Use the spoon or syringe that comes with the medicine.'),
          el('li', {}, el('b', {}, 'Don’t double up. '), 'Cold and flu remedies often already contain paracetamol or ibuprofen.'),
          el('li', {}, el('b', {}, 'Missed a dose? '), 'Don’t take two at once to catch up.'),
          el('li', {}, 'Ask a pharmacist first if you’re pregnant, breastfeeding, have a health condition, take other medicines or drink alcohol.'),
          el('li', {}, 'If you or someone else may have taken too much, get help straight away (NHS 111, or 999 in an emergency) — even if they feel fine.')))),
    dayCard(rerender),
    ...cards.map((c) => c.card),
    meds.length < MAX_MEDS
      ? el('button', { type: 'button', class: 'btn wide add-med', onclick: () => { meds.push(newMed()); store.save(); rerender(); setTimeout(() => { const n = document.querySelectorAll('.med-name'); n[n.length - 1]?.focus(); }, 50); } },
        `＋ Add another medicine (${meds.length} of ${MAX_MEDS})`)
      : el('p', { class: 'muted small center' }, `All ${MAX_MEDS} medicine timers are in use.`));
  return () => {
    const t = Date.now();
    for (const c of cards) {
      const s = status(c.m, t);
      if (c.head.textContent !== s.head) c.head.textContent = s.head;
      if (c.big.textContent !== s.big) c.big.textContent = s.big;
      if (c.sub.textContent !== s.sub) c.sub.textContent = s.sub;
      const cls = `card med-card ${s.cls}`;
      if (c.card.className !== cls) { c.card.className = cls; if (s.cls === 'due' || s.cls === 'ok') rerender(); }
    }
  };
}
