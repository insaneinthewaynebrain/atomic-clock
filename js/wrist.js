// Wrist tab: what's on the wrist, wear history, power-reserve countdowns, reminders.
import * as store from './store.js';
import { now } from './time.js';
import { el, openModal, confirmModal, toast, pad, fmtDuration } from './ui.js';
import { FORM, detailExtras, ownedWatches, getWatch } from './collection.js';
import { fillImg } from './photos.js';
import { backupDue, exportBackup } from './backup.js';

const HOUR = 3600000, DAY = 86400000;
const PALETTE = ['#4cc2ff', '#fbbf24', '#34d399', '#f472b6', '#a78bfa', '#fb923c', '#60a5fa', '#f87171', '#2dd4bf', '#e879f9', '#a3e635', '#fcd34d'];
const NOT_WORN_DAYS = 30;

const d = () => store.get();
const root = () => document.getElementById('wrist');
let visible = false;
let monthOffset = 0;        // calendar: 0 = this month
let timer = null;
let api = null;

/* ---------- Service fields added to the watch form ---------- */
function addFormFields() {
  if (FORM.some((g) => g.group === 'Service & warranty')) return;
  const i = FORM.findIndex((g) => g.group === 'Private');
  FORM.splice(i, 0, { group: 'Service & warranty', fields: [
    { k: 'lastService', label: 'Last service', type: 'date', half: true },
    { k: 'serviceInterval', label: 'Service every (years)', type: 'number', ph: 'e.g. 5', half: true },
    { k: 'warrantyUntil', label: 'Warranty ends', type: 'date', half: true },
    { k: 'batteryChanged', label: 'Battery changed (quartz)', type: 'date', half: true },
    { k: 'batteryInterval', label: 'Battery lasts (years)', type: 'number', ph: 'e.g. 2', half: true },
  ] });
}

/* ---------- Wear data helpers ---------- */
const dayKey = (t) => { const x = new Date(t); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
const isMechanical = (w) => ['automatic', 'manual', 'other', undefined, null, ''].includes(w.movement) && !!w.powerReserve;

export function onWrist() { return d().wear.filter((e) => !e.off); }

/** Every calendar day a wear entry covers. */
function entryDays(e) {
  const out = [];
  const end = e.off || now();
  const c = new Date(e.on); c.setHours(0, 0, 0, 0);
  for (let i = 0; c.getTime() <= end && i < 400; i++) { out.push(dayKey(c)); c.setDate(c.getDate() + 1); }
  return out;
}

function wearStats() {
  const per = {};
  const allDays = new Set();
  for (const e of d().wear) {
    const p = (per[e.watchId] ||= { days: new Set(), last: 0 });
    for (const k of entryDays(e)) { p.days.add(k); allDays.add(k + e.watchId); }
    p.last = Math.max(p.last, e.off || now());
  }
  const total = Object.values(per).reduce((n, p) => n + p.days.size, 0);
  return { per, total };
}

function colourOf(id) {
  const list = d().watches;
  const i = Math.max(0, list.findIndex((w) => w.id === id));
  return PALETTE[i % PALETTE.length];
}

/** When an automatic/manual watch will stop (ms), or null if unknown. */
export function stopsAt(w) {
  if (!isMechanical(w)) return null;
  if (onWrist().some((e) => e.watchId === w.id)) return null;
  const offs = d().wear.filter((e) => e.watchId === w.id && e.off).map((e) => e.off);
  const from = Math.max(offs.length ? Math.max(...offs) : 0, w.woundAt || 0);
  if (!from) return null;
  return from + Number(w.powerReserve) * HOUR;
}

/* ---------- Reminders ---------- */
function addYears(dateStr, years) {
  const x = new Date(dateStr);
  x.setFullYear(x.getFullYear() + Math.floor(years));
  x.setMonth(x.getMonth() + Math.round((years % 1) * 12));
  return x.getTime();
}
const fmtDate = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export function reminders() {
  const out = [];
  const t = Date.now();
  const snoozed = d().snoozed || {};
  const push = (r) => { if (!(snoozed[r.key] > t)) out.push(r); };
  for (const w of ownedWatches()) {
    if (w.lastService && w.serviceInterval) {
      const due = addYears(w.lastService, Number(w.serviceInterval));
      if (due - t < 60 * DAY) push({ key: `svc:${w.id}:${due}`, icon: '🛠️', watch: w, title: due < t ? 'Service overdue' : 'Service due soon', text: `${w.name} — ${due < t ? 'was due' : 'due'} ${fmtDate(due)} (every ${w.serviceInterval} years)` });
    }
    if (w.warrantyUntil) {
      const end = new Date(w.warrantyUntil).getTime();
      if (end - t < 60 * DAY && t - end < 30 * DAY) push({ key: `war:${w.id}:${end}`, icon: '📄', watch: w, title: end < t ? 'Warranty has ended' : 'Warranty ending soon', text: `${w.name} — ${end < t ? 'ended' : 'ends'} ${fmtDate(end)}` });
    }
    if (w.movement === 'quartz' && w.batteryChanged) {
      const due = addYears(w.batteryChanged, Number(w.batteryInterval) || 2);
      if (due - t < 30 * DAY) push({ key: `bat:${w.id}:${due}`, icon: '🔋', watch: w, title: due < t ? 'Battery probably due' : 'Battery due soon', text: `${w.name} — battery changed ${fmtDate(new Date(w.batteryChanged).getTime())}` });
    }
  }
  if (backupDue()) out.push({ key: 'backup', icon: '💾', title: 'Time for a backup', text: 'Your watches are stored only on this phone.', action: ['Back up now', exportBackup], noSnooze: true });
  return out;
}

function snooze(r) {
  const data = d();
  data.snoozed = data.snoozed || {};
  data.snoozed[r.key] = Date.now() + 30 * DAY;
  store.save();
  refreshAll();
}

function remindersCard(list) {
  return el('div', { class: 'card reminders' },
    el('h2', { class: 'card-title' }, `Reminders (${list.length})`),
    list.map((r) => el('div', { class: 'rem' },
      el('span', { class: 'rem-icon' }, r.icon),
      el('div', { class: 'rem-body' }, el('div', { class: 'rem-title' }, r.title), el('div', { class: 'muted small' }, r.text)),
      el('div', { class: 'rem-btns' },
        r.action ? el('button', { type: 'button', class: 'btn sm', onclick: r.action[1] }, r.action[0]) : null,
        r.noSnooze ? null : el('button', { type: 'button', class: 'btn sm', title: 'Hide for 30 days', onclick: () => snooze(r) }, 'Later')))),
    el('p', { class: 'muted small' }, 'Reminders show inside the app when you open it. (Phone notifications would need a server, which this app deliberately doesn’t use.)'));
}

function updateBadge() {
  const b = document.querySelector('.tabbtn[data-tab="wrist"] .tab-badge');
  if (b) b.hidden = reminders().length === 0;
  const line = document.getElementById('clock-reminders');
  if (line) {
    const n = reminders().length;
    line.hidden = !n;
    line.textContent = n ? `🔔 ${n} reminder${n > 1 ? 's' : ''} — tap to see` : '';
  }
}

/* ---------- Actions ---------- */
function pickWatch(title, onPick, filter = () => true) {
  const list = ownedWatches().filter(filter);
  if (!list.length) {
    openModal({ title, content: el('p', {}, 'Add a watch to your collection first.'), actions: [{ label: 'OK', kind: 'primary', onClick: () => api && api.switchTab('collection') }] });
    return;
  }
  const m = openModal({
    title, className: 'tall',
    content: el('div', { class: 'pick-list' }, list.map((w) => {
      const img = el('div', { class: 'pick-photo' });
      if (w.photos?.length) { const i = el('img', { alt: '' }); fillImg(i, w.photos[0]); img.append(i); } else img.append('⌚');
      return el('button', { type: 'button', class: 'pick-item', onclick: () => { m.close(); onPick(w); } },
        img, el('span', { class: 'pick-name' }, w.name), el('span', { class: 'pick-dot', style: `background:${colourOf(w.id)}` }));
    })),
    actions: [{ label: 'Cancel' }],
  });
}

function wearToday() {
  pickWatch('Wearing today', (w) => {
    if (onWrist().some((e) => e.watchId === w.id)) { toast(`${w.name} is already on your wrist`); return; }
    d().wear.push({ id: store.uid(), watchId: w.id, on: Math.round(now()), off: null });
    store.save(); toast(`Enjoy the ${w.name}`); refreshAll();
  });
}

function takeOff(e) {
  e.off = Math.round(now());
  store.save();
  const w = getWatch(e.watchId);
  const s = w && stopsAt(w);
  toast(s ? `${w.name} will stop in about ${fmtDuration(s - Date.now())}` : 'Taken off');
  refreshAll();
}

function wound(w) {
  w.woundAt = Date.now();
  store.save(); store.emit('watches');
  toast(`${w.name}: full power reserve (${w.powerReserve} h)`);
  refreshAll();
}

async function deleteEntry(e) {
  if (!(await confirmModal('Delete this wear entry?', '', 'Delete', true))) return;
  d().wear = d().wear.filter((x) => x.id !== e.id);
  store.save(); refreshAll();
}

function editEntry(e) {
  const w = getWatch(e.watchId);
  const toLocal = (t) => { const x = new Date(t); return `${dayKey(t)}T${pad(x.getHours())}:${pad(x.getMinutes())}`; };
  const onIn = el('input', { type: 'datetime-local', class: 'input', value: toLocal(e.on) });
  const offIn = el('input', { type: 'datetime-local', class: 'input', value: e.off ? toLocal(e.off) : '' });
  openModal({
    title: w ? w.name : 'Wear entry',
    content: [el('label', { class: 'field' }, el('span', {}, 'Put on'), onIn), el('label', { class: 'field' }, el('span', {}, 'Taken off (leave empty if still wearing)'), offIn)],
    actions: [
      { label: 'Delete', kind: 'danger', onClick: () => { setTimeout(() => deleteEntry(e), 0); } },
      { label: 'Cancel' },
      { label: 'Save', kind: 'primary', onClick: () => {
        const on = new Date(onIn.value).getTime(); const off = offIn.value ? new Date(offIn.value).getTime() : null;
        if (!on || (off && off < on)) { toast('Check the times'); return false; }
        e.on = on; e.off = off; store.save(); refreshAll();
      } },
    ],
  });
}

/* ---------- Render ---------- */
function onWristCard() {
  const on = onWrist();
  const card = el('div', { class: 'card' }, el('h2', { class: 'card-title' }, 'On your wrist'));
  if (!on.length) card.append(el('p', { class: 'muted' }, 'Nothing logged yet today.'));
  for (const e of on) {
    const w = getWatch(e.watchId);
    if (!w) continue;
    card.append(el('div', { class: 'wear-row' },
      el('span', { class: 'pick-dot', style: `background:${colourOf(w.id)}` }),
      el('div', { class: 'wear-main' }, el('div', { class: 'wear-name' }, w.name), el('div', { class: 'muted small' }, `On since ${new Date(e.on).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })} · ${fmtDuration(Date.now() - e.on)}`)),
      el('button', { type: 'button', class: 'btn sm', onclick: () => takeOff(e) }, 'Taken off')));
  }
  card.append(el('button', { type: 'button', class: 'btn primary wide', onclick: wearToday }, '⌚ Wearing today'));
  return card;
}

function reserveCard() {
  const rows = [];
  for (const w of ownedWatches()) {
    if (!isMechanical(w) || onWrist().some((e) => e.watchId === w.id)) continue;
    const s = stopsAt(w);
    let status, cls = '';
    if (s == null) { status = 'Not tracked yet — log a wear or tap “Wound”'; cls = 'muted'; }
    else if (s > Date.now()) { status = `Stops in about ${fmtDuration(s - Date.now())}`; cls = s - Date.now() < 6 * HOUR ? 'warn-t' : 'ok-t'; }
    else { status = `Probably stopped (${fmtDuration(Date.now() - s)} ago)`; cls = 'bad-t'; }
    const pct = s == null ? 0 : Math.max(0, Math.min(1, (s - Date.now()) / (Number(w.powerReserve) * HOUR)));
    rows.push(el('div', { class: 'pr-row' },
      el('div', { class: 'pr-main' },
        el('div', { class: 'wear-name' }, w.name),
        el('div', { class: 'small ' + cls }, status),
        el('div', { class: 'pr-bar' }, el('span', { class: 'pr-fill ' + cls, style: `width:${pct * 100}%` }))),
      el('button', { type: 'button', class: 'btn sm', onclick: () => wound(w) }, 'Wound')));
  }
  if (!rows.length) return null;
  return el('div', { class: 'card' },
    el('h2', { class: 'card-title' }, 'Power reserve'),
    ...rows,
    el('p', { class: 'muted small' }, 'Assumes the watch was fully wound when you took it off (or when you tap “Wound”). Set each watch’s power reserve in Collection → Edit.'));
}

function calendarCard() {
  const base = new Date(); base.setDate(1); base.setHours(0, 0, 0, 0); base.setMonth(base.getMonth() + monthOffset);
  const year = base.getFullYear(), month = base.getMonth();
  const byDay = {};
  for (const e of d().wear) for (const k of entryDays(e)) (byDay[k] ||= new Set()).add(e.watchId);
  const startDow = (base.getDay() + 6) % 7;     // Monday first
  const days = new Date(year, month + 1, 0).getDate();
  const grid = el('div', { class: 'cal-grid' }, ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x) => el('div', { class: 'cal-h' }, x)));
  for (let i = 0; i < startDow; i++) grid.append(el('div', {}));
  const today = dayKey(Date.now());
  for (let dd = 1; dd <= days; dd++) {
    const k = `${year}-${pad(month + 1)}-${pad(dd)}`;
    const ids = [...(byDay[k] || [])];
    grid.append(el('button', { type: 'button', class: 'cal-day' + (k === today ? ' today' : '') + (ids.length ? ' has' : ''), onclick: () => showDay(k) },
      el('span', { class: 'cal-n' }, dd),
      el('span', { class: 'cal-dots' }, ids.slice(0, 3).map((id) => el('i', { style: `background:${colourOf(id)}` })))));
  }
  return el('div', { class: 'card' },
    el('div', { class: 'cal-head' },
      el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'Previous month', onclick: () => { monthOffset--; render(); } }, '‹'),
      el('h2', { class: 'card-title' }, base.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })),
      el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'Next month', disabled: monthOffset >= 0, onclick: () => { monthOffset++; render(); } }, '›')),
    grid);
}

function showDay(k) {
  const entries = d().wear.filter((e) => entryDays(e).includes(k)).sort((a, b) => a.on - b.on);
  const [y, m, dd] = k.split('-').map(Number);
  const title = new Date(y, m - 1, dd).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const addBtn = { label: '+ Add', onClick: () => { setTimeout(() => pickWatch(`Worn on ${title}`, (w) => {
    const on = new Date(y, m - 1, dd, 9, 0).getTime();
    d().wear.push({ id: store.uid(), watchId: w.id, on, off: on + 8 * HOUR });
    store.save(); refreshAll();
  }), 0); } };
  openModal({
    title,
    content: entries.length ? entries.map((e) => {
      const w = getWatch(e.watchId);
      return el('button', { type: 'button', class: 'result', onclick: () => { setTimeout(() => editEntry(e), 0); document.getElementById('modal').close(); } },
        el('div', { class: 'r-name' }, w ? w.name : 'Deleted watch'),
        el('div', { class: 'r-sub' }, `${new Date(e.on).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} – ${e.off ? new Date(e.off).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : 'still on'} · tap to edit`));
    }) : el('p', { class: 'muted' }, 'Nothing logged on this day.'),
    actions: [addBtn, { label: 'Close', kind: 'primary' }],
  });
}

function statsCard() {
  const { per, total } = wearStats();
  const list = ownedWatches();
  if (!list.length) return null;
  const rows = list.map((w) => ({ w, days: per[w.id]?.days.size || 0, last: per[w.id]?.last || 0 }))
    .sort((a, b) => b.days - a.days || a.w.name.localeCompare(b.w.name));
  const t = Date.now();
  const nudges = rows.filter((r) => {
    const since = r.last || r.w.added || d().createdAt;
    return t - since > NOT_WORN_DAYS * DAY;
  });
  return el('div', { class: 'card' },
    el('h2', { class: 'card-title' }, 'Wear stats'),
    nudges.length ? el('div', { class: 'nudges' }, nudges.slice(0, 4).map((r) => el('div', { class: 'nudge' },
      `💤 ${r.w.name} ${r.last ? `hasn’t been worn for ${Math.floor((t - r.last) / DAY)} days` : 'hasn’t been worn yet'} — give it some wrist time?`))) : null,
    el('div', { class: 'wstats' }, rows.map((r) => el('div', { class: 'wstat' },
      el('span', { class: 'pick-dot', style: `background:${colourOf(r.w.id)}` }),
      el('span', { class: 'wstat-name' }, r.w.name),
      el('span', { class: 'wstat-n' }, `${r.days} day${r.days === 1 ? '' : 's'}`),
      el('span', { class: 'wstat-pc' }, total ? `${Math.round((r.days / total) * 100)}%` : '—'),
      el('span', { class: 'wstat-last muted' }, r.last ? (onWrist().some((e) => e.watchId === r.w.id) ? 'on now' : `${Math.max(0, Math.floor((t - r.last) / DAY))} d ago`) : 'never')))),
    el('p', { class: 'muted small' }, 'Days worn · share of all wear · last worn'));
}

export function render() {
  const box = root();
  if (!box) return;
  box.innerHTML = '';
  const rem = reminders();
  if (rem.length) box.append(remindersCard(rem));
  box.append(el('div', { class: 'wrist-layout' },
    el('div', {}, onWristCard(), reserveCard()),
    el('div', {}, calendarCard(), statsCard())));
}

function refreshAll() {
  updateBadge();
  if (visible) render();
  store.emit('wear');
}

/* ---------- Detail rows in Collection ---------- */
function detailRows(w) {
  const rows = [];
  if (w.lastService) rows.push(['Last service', fmtDate(new Date(w.lastService).getTime()) + (w.serviceInterval ? ` · next ${fmtDate(addYears(w.lastService, Number(w.serviceInterval)))}` : '')]);
  if (w.warrantyUntil) rows.push(['Warranty', `until ${fmtDate(new Date(w.warrantyUntil).getTime())}`]);
  if (w.movement === 'quartz' && w.batteryChanged) rows.push(['Battery changed', fmtDate(new Date(w.batteryChanged).getTime())]);
  const s = stopsAt(w);
  if (s) rows.push(['Power reserve', s > Date.now() ? `stops in about ${fmtDuration(s - Date.now())}` : 'probably stopped']);
  if (!rows.length) return null;
  return el('div', { class: 'fact-group' }, rows.map(([k, v]) => el('div', { class: 'fact' }, el('span', { class: 'fact-k' }, k), el('span', { class: 'fact-v' }, v))));
}

export function register(a) {
  api = a;
  addFormFields();
  detailExtras.push(detailRows);
  a.registerTab('wrist', { show: () => { visible = true; render(); clearInterval(timer); timer = setInterval(render, 60000); }, hide: () => { visible = false; clearInterval(timer); } });
  // A slim reminder line on the Clock tab.
  const clockPane = document.querySelector('#tab-clock .topbar');
  if (clockPane && !document.getElementById('clock-reminders')) {
    clockPane.after(el('button', { type: 'button', id: 'clock-reminders', class: 'rem-line', hidden: true, onclick: () => a.switchTab('wrist') }));
  }
  store.on('watches', () => { updateBadge(); if (visible) render(); });
  store.on('backup', updateBadge);
  updateBadge();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') updateBadge(); });
}
