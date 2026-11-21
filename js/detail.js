// Each watch's page: one scannable screen, top to bottom —
// hero · newest photos · accuracy · time worn · map · service · value · galleries · details · sentimental ·
// insurance · the two PDF buttons. On wide screens it sits beside the Watch Box (two panes).
import * as store from './store.js';
import { el, openModal, confirmModal, toast } from './ui.js';
import { fillImg, addFile, deletePhoto, photoUrl } from './photos.js';
import { getWatch, faceEl, money, movementLabel, openWatchEditor, removeWatch, openPhotoViewer, cardLines, openSaleQr, SELLER_TYPES } from './collection.js';
import { accuracyCard } from './accuracyui.js';
import { featuresOf, featureLabel, categoryLabel, valueInfo, serviceInfo, HOW_ACQUIRED, WHY_BOUGHT } from './model.js';
import { galleryGrid, recentPhotos } from './galleries.js';
import { miniMap } from './mapview.js';
import { wristPanel } from './wrist.js';
import { insSection } from './watchdocs.js';
import { isLocked, padlockTapped } from './lock.js';

const DAY = 86400000, HOUR = 3600000;
const d = () => store.get();
const $ = (id) => document.getElementById(id);
const fmtD = (s) => (s ? new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
let currentId = null;
let wornYear = new Date().getFullYear();

export const pageOpenId = () => currentId;

/* ---------- Open / close ---------- */
export function openPage(w) {
  if (!w) return;
  if (currentId !== w.id) wornYear = new Date().getFullYear();
  currentId = w.id;
  document.body.classList.add('page-open');
  $('watch-page').hidden = false;
  render();
  const target = '#collection/' + w.id;
  if (location.hash !== target) history.replaceState(null, '', target);
  $('watch-page').scrollTop = 0;
  if (!matchMedia('(min-width: 900px)').matches) window.scrollTo(0, 0);
  document.querySelectorAll('.slot.selected, .watch-card.selected').forEach((n) => n.classList.remove('selected'));
  document.querySelector(`[data-wid="${w.id}"]`)?.classList.add('selected');
}

export function closePage() {
  currentId = null;
  document.body.classList.remove('page-open');
  const p = $('watch-page'); if (p) { p.hidden = true; p.innerHTML = ''; }
  if (location.hash.startsWith('#collection/')) history.replaceState(null, '', '#collection');
  document.querySelectorAll('.slot.selected, .watch-card.selected').forEach((n) => n.classList.remove('selected'));
}

const card = (title, ...kids) => el('section', { class: 'pg-card' }, title ? el('h2', { class: 'pg-h' }, title) : null, ...kids);

/* ---------- 1. Hero ---------- */
function hero(w) {
  const photo = faceEl(w, 'full', 'face-hero');
  const ids = [w.face, ...(w.photos || [])].filter(Boolean);
  if (ids.length) photo.addEventListener('click', () => openPhotoViewer(ids, 0));
  const status = cardLines.map((f) => f(w)).find(Boolean);
  const modelNo = w.reference;
  return el('div', { class: 'pg-hero' },
    photo,
    el('div', { class: 'pg-hero-text' },
      w.brand ? el('div', { class: 'pg-brand' }, w.brand) : null,
      el('h1', { class: 'pg-model' }, w.model || w.name),
      modelNo ? el('div', { class: 'pg-ref' }, 'Ref. ', el('b', {}, modelNo)) : null,
      w.nickname ? el('div', { class: 'pg-nick' }, `“${w.nickname}”`) : null,
      status ? el('div', { class: 'pg-status ' + (status.cls || '') }, status.text) : null));
}

/* ---------- 2. Three newest photos ---------- */
function recent(w) {
  const ids = recentPhotos(w, 3);
  if (!ids.length) return null;
  return el('div', { class: 'pg-recent n' + ids.length }, ids.map((id, i) => {
    const img = el('img', { alt: '', loading: 'lazy' }); fillImg(img, id, 'full');
    return el('button', { type: 'button', class: 'pg-recent-ph', onclick: () => openPhotoViewer(ids, i) }, img);
  }));
}

/* ---------- 4. Time worn ---------- */
function wearIn(id, from, to) {
  const days = new Set(); let ms = 0; const sessions = [];
  for (const e of d().wear || []) {
    if (e.watchId !== id) continue;
    const a = Math.max(e.on, from), b = Math.min(e.off || Date.now(), to);
    if (b <= a) continue;
    ms += b - a; sessions.push([a, b]);
    const c = new Date(a); c.setHours(0, 0, 0, 0);
    for (let i = 0; c.getTime() < b && i < 400; i++) { days.add(c.toDateString()); c.setDate(c.getDate() + 1); }
  }
  return { days, ms, sessions };
}

function timeWorn(w) {
  const all = (d().wear || []).filter((e) => e.watchId === w.id);
  const firstYear = all.length ? new Date(Math.min(...all.map((e) => e.on))).getFullYear() : new Date().getFullYear();
  const thisYear = new Date().getFullYear();
  const y0 = new Date(wornYear, 0, 1).getTime(), y1 = new Date(wornYear + 1, 0, 1).getTime();
  const year = wearIn(w.id, y0, y1);
  const months = Array.from({ length: 12 }, (_, m) => wearIn(w.id, new Date(wornYear, m, 1).getTime(), new Date(wornYear, m + 1, 1).getTime()));
  const max = Math.max(1, ...months.map((m) => m.days.size));
  const box = card('Time worn');
  box.append(
    el('div', { class: 'year-sw' },
      el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'Previous year', disabled: wornYear <= firstYear, onclick: () => { wornYear--; render(); } }, '‹'),
      el('b', {}, String(wornYear)),
      el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'Next year', disabled: wornYear >= thisYear, onclick: () => { wornYear++; render(); } }, '›')),
    el('div', { class: 'pg-stats' },
      el('div', {}, el('div', { class: 'pg-big' }, String(year.days.size)), el('div', { class: 'eyebrow' }, year.days.size === 1 ? 'Day worn' : 'Days worn')),
      el('div', {}, el('div', { class: 'pg-big' }, `≈ ${Math.round(year.ms / HOUR).toLocaleString('en-GB')} h`), el('div', { class: 'eyebrow' }, 'Estimated hours'))),
    el('div', { class: 'month-bars', role: 'img', 'aria-label': `Days worn each month in ${wornYear}` }, months.map((m, i) => el('div', { class: 'mb', title: `${new Date(wornYear, i, 1).toLocaleDateString('en-GB', { month: 'long' })}: ${m.days.size} day${m.days.size === 1 ? '' : 's'}` },
      el('span', { class: 'mb-v' }, m.days.size ? String(m.days.size) : ''),
      el('span', { class: 'mb-track' }, el('i', { style: `height:${(m.days.size / max) * 100}%` })),
      el('span', { class: 'mb-l' }, MONTHS[i])))));
  // Habits, including the weekend-watch insight.
  if (year.sessions.length) {
    const dow = new Array(7).fill(0);
    for (const [a, b] of year.sessions) dow[new Date(a).getDay()] += b - a;
    const weekend = dow[0] + dow[6], weekday = year.ms - weekend;
    const names = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
    const keys = [...year.days].map((k) => new Date(k).getTime()).sort((a, b) => a - b);
    let run = 1, best = 1;
    for (let i = 1; i < keys.length; i++) { run = Math.round((keys[i] - keys[i - 1]) / DAY) === 1 ? run + 1 : 1; best = Math.max(best, run); }
    box.append(el('div', { class: 'insights' },
      el('span', { class: 'insight' }, weekend > weekday * 0.4 ? '🏖️ More of a weekend watch' : '💼 Mostly a weekday watch'),
      el('span', { class: 'insight' }, `❤️ Favourite day: ${names[dow.indexOf(Math.max(...dow))]}`),
      el('span', { class: 'insight' }, `🔥 Longest run: ${best} day${best === 1 ? '' : 's'}`)));
  } else box.append(el('p', { class: 'muted small' }, `Not worn in ${wornYear}.`));
  const wp = wristPanel(w);
  if (wp) box.append(wp);
  return box;
}

/* ---------- 6. Service ---------- */
function service(w) {
  const s = serviceInfo(w);
  const box = card('Service');
  box.append(el('div', { class: 'pg-stats' },
    el('div', {}, el('div', { class: 'pg-mid' }, fmtD(w.lastService)), el('div', { class: 'eyebrow' }, 'Last serviced')),
    el('div', {}, el('div', { class: 'pg-mid' }, s.next ? fmtD(s.next) : '—'), el('div', { class: 'eyebrow' }, 'Next due'))));
  if (s.overdue) box.append(el('div', { class: 'svc-hint warn' }, `⚠️ Service overdue by ${Math.abs(s.daysLeft)} days.`));
  else if (s.soon) box.append(el('div', { class: 'svc-hint warn' }, `Due soon — in ${s.daysLeft} days.`));
  else if (!w.lastService) box.append(el('p', { class: 'muted small' }, 'Add when it was last serviced and how often, and the next date is worked out for you.'));
  box.append(el('button', { type: 'button', class: 'btn sm', onclick: () => editService(w) }, w.lastService ? 'Update service' : '＋ Add service details'));
  return box;
}

function editService(w) {
  const date = el('input', { type: 'date', class: 'input', value: w.lastService || '' });
  const every = el('input', { type: 'text', inputmode: 'decimal', class: 'input', value: w.serviceInterval ?? '', placeholder: 'e.g. 5' });
  openModal({ title: 'Service', content: [el('label', { class: 'field' }, el('span', {}, 'Last serviced'), date), el('label', { class: 'field' }, el('span', {}, 'Service every (years)'), every)],
    actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', onClick: () => {
      w.lastService = date.value || null; w.serviceInterval = every.value ? Number(every.value) : null; store.save(); store.emit('watches');
    } }] });
}

/* ---------- 7. Value ---------- */
function valueChart(info) {
  const pts = info.entries;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 320 110'); svg.setAttribute('class', 'value-chart ' + info.trend);
  if (pts.length < 2) return svg;
  const all = [...pts.map((p) => ({ t: Date.parse(p.date), v: p.value })), ...(info.projection ? [{ t: Date.parse(info.projection.date), v: info.projection.value, proj: true }] : [])];
  const t0 = all[0].t, t1 = all[all.length - 1].t;
  const v0 = Math.min(...all.map((p) => p.v)), v1 = Math.max(...all.map((p) => p.v));
  const pad = (v1 - v0) * 0.15 || v1 * 0.1 || 1;
  const x = (t) => 10 + ((t - t0) / Math.max(1, t1 - t0)) * 300, y = (v) => 100 - ((v - (v0 - pad)) / (v1 - v0 + 2 * pad)) * 90;
  const add = (tag, a) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(a)) n.setAttribute(k, v); svg.append(n); return n; };
  const real = all.filter((p) => !p.proj);
  add('polyline', { points: real.map((p) => `${x(p.t)},${y(p.v)}`).join(' '), class: 'vline' });
  if (info.projection) { const a = real[real.length - 1], b = all[all.length - 1]; add('line', { x1: x(a.t), y1: y(a.v), x2: x(b.t), y2: y(b.v), class: 'vproj' }); add('circle', { cx: x(b.t), cy: y(b.v), r: 3.5, class: 'vpt proj' }); }
  for (const p of real) add('circle', { cx: x(p.t), cy: y(p.v), r: 3.5, class: 'vpt' });
  return svg;
}

function value(w) {
  const info = valueInfo(w);
  const box = card('Value');
  const l = info.latest;
  const first = info.entries[0];
  const change = l && first && l !== first ? l.value - first.value : null;
  box.append(el('div', { class: 'pg-stats' },
    el('div', {}, el('div', { class: 'pg-big' }, l ? money(l.value) : '—'), el('div', { class: 'eyebrow' }, l ? `Latest · ${fmtD(l.date)}` : 'No value yet')),
    change != null ? el('div', {}, el('div', { class: 'pg-mid trend-' + info.trend }, `${change >= 0 ? '+' : '−'}${money(Math.abs(change))}`), el('div', { class: 'eyebrow' }, `since ${fmtD(first.date)}`)) : null));
  if (info.entries.length >= 2) {
    box.append(valueChart(info), el('div', { class: 'muted small' },
      { up: '▲ Rising', down: '▼ Falling', flat: '▬ Holding steady' }[info.trend],
      info.projection ? ` · projected ${money(info.projection.value)} by ${fmtD(info.projection.date)} (a straight-line guess, not a valuation)` : ' · a projection appears from 3 entries'));
  }
  if (info.entries.length) {
    box.append(el('details', { class: 'pg-more' }, el('summary', {}, `All entries (${info.entries.length})`),
      el('div', { class: 'vlist' }, info.entries.slice().reverse().map((e) => el('div', { class: 'vrow' },
        el('span', {}, fmtD(e.date)), el('b', {}, money(e.value)), el('span', { class: 'muted small' }, e.note || ''),
        el('button', { type: 'button', class: 'icon-btn sm danger', 'aria-label': 'Delete value', onclick: async () => {
          if (!(await confirmModal('Delete this value?', `${money(e.value)} on ${fmtD(e.date)}`, 'Delete', true))) return;
          w.valueHistory = w.valueHistory.filter((x) => x !== e && x.id !== e.id); syncValue(w); store.save(); store.emit('watches');
        } }, '×'))))));
  }
  box.append(el('button', { type: 'button', class: 'btn sm primary', onclick: () => addValue(w) }, '＋ Add value'));
  return box;
}
function syncValue(w) { const l = valueInfo(w).latest; w.value = l ? l.value : null; }
function addValue(w) {
  const date = el('input', { type: 'date', class: 'input', value: new Date().toISOString().slice(0, 10) });
  const val = el('input', { type: 'text', inputmode: 'decimal', class: 'input', placeholder: 'e.g. 12500' });
  const note = el('input', { type: 'text', class: 'input', placeholder: 'e.g. Dealer quote, insurance valuation' });
  openModal({ title: 'Add a value', content: [el('div', { class: 'row2' }, el('label', { class: 'field' }, el('span', {}, 'Date'), date), el('label', { class: 'field' }, el('span', {}, `Value (${d().money || 'GBP'})`), val)), el('label', { class: 'field' }, el('span', {}, 'Note'), note),
    el('p', { class: 'muted small' }, 'Entered by you — nothing is looked up online.')],
    actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', onClick: () => {
      const v = Number(val.value.replace(/[£$€,\s]/g, ''));
      if (!val.value || Number.isNaN(v) || !date.value) { toast('Enter a date and a value'); return false; }
      (w.valueHistory ||= []).push({ id: store.uid(), date: date.value, value: v, note: note.value.trim() });
      syncValue(w); store.save(); store.emit('watches');
    } }] });
  setTimeout(() => val.focus(), 200);
}

/* ---------- 9. Details ---------- */
const kv = (k, v) => (v == null || v === '' ? null : el('div', { class: 'fact' }, el('span', { class: 'fact-k' }, k), el('span', { class: 'fact-v' }, v)));
function serialEl(w) {
  if (!w.serial) return null;
  const v = el('button', { type: 'button', class: 'link-btn serial', onclick: () => { v.textContent = v.textContent.startsWith('•') ? w.serial : '•••••• (tap to show)'; } }, '•••••• (tap to show)');
  return el('div', { class: 'fact' }, el('span', { class: 'fact-k' }, 'Serial number'), v);
}
function details(w) {
  const feats = featuresOf(w), cats = w.categories || [];
  const det = el('details', { class: 'pg-card pg-drop' }, el('summary', { class: 'pg-h' }, 'Details'),
    el('div', { class: 'facts' },
      kv('Brand', w.brand), kv('Model name', w.model), kv('Model number', w.reference), serialEl(w), kv('Year made', w.year),
      kv('Movement', [movementLabel(w.movement), w.calibre].filter(Boolean).join(' · ')), kv('Jewels', w.jewels),
      kv('Beats per hour', w.bph ? `${Number(w.bph).toLocaleString('en-GB')} vph` : null), kv('Power reserve', w.powerReserve ? `${w.powerReserve} h` : null),
      kv('Case size', w.caseSize ? `${w.caseSize} mm` : null), kv('Case material', w.caseMaterial), kv('Thickness', w.thickness ? `${w.thickness} mm` : null),
      kv('Lug width', w.lugWidth ? `${w.lugWidth} mm` : null), kv('Water resistance', w.waterResistance), kv('Crystal', w.crystal), kv('Dial', w.dial),
      kv('Strap / bracelet', w.strap), kv('Purchase date', w.purchaseDate ? fmtD(w.purchaseDate) : null), kv('Purchase price', w.purchasePrice != null ? money(w.purchasePrice) : null),
      kv('Bought from', [w.boughtFrom, (SELLER_TYPES.find((x) => x[0] === w.sellerType) || [])[1]].filter(Boolean).join(' · ')),
      kv('Box & papers', w.box || w.papers ? [w.box ? 'Box' : null, w.papers ? 'Papers' : null].filter(Boolean).join(' + ') : null), kv('Condition', w.condition)),
    feats.length ? el('div', { class: 'tagset' }, el('div', { class: 'eyebrow' }, 'Features'), el('div', { class: 'chips' }, feats.map((f) => el('span', { class: 'chip-tag' }, featureLabel(d(), f))))) : null,
    cats.length ? el('div', { class: 'tagset' }, el('div', { class: 'eyebrow' }, 'Categories'), el('div', { class: 'chips' }, cats.map((c) => el('span', { class: 'chip-tag cat' }, categoryLabel(d(), c))))) : null,
    w.notes ? el('p', { class: 'notes' }, w.notes) : null,
    el('button', { type: 'button', class: 'btn sm', onclick: () => openWatchEditor(w) }, '✎ Edit details'));
  return det;
}

/* ---------- 10. Sentimental ---------- */
function sentimental(w) {
  const lab = (list, v) => (list.find((x) => x[0] === v) || [])[1];
  const has = w.howAcquired || w.whyBought || w.story || w.fromWho || w.occasion;
  return el('details', { class: 'pg-card pg-drop' }, el('summary', { class: 'pg-h' }, 'Sentimental'),
    has ? el('div', { class: 'facts' }, kv('How I got it', lab(HOW_ACQUIRED, w.howAcquired)), kv('Why', lab(WHY_BOUGHT, w.whyBought)), kv('From', w.fromWho), kv('Occasion', w.occasion)) : el('p', { class: 'muted small' }, 'How it came to you, why, and its story.'),
    w.story ? el('blockquote', { class: 'story' }, w.story) : null,
    el('button', { type: 'button', class: 'btn sm', onclick: () => openWatchEditor(w, { focusGroup: 'Sentimental' }) }, has ? '✎ Edit story' : '＋ Add its story'));
}

/* ---------- 11. Insurance ---------- */
function insurance(w) {
  const box = card('Insurance');
  box.append(el('div', { class: 'facts' }, kv('Model number', w.reference || 'Not recorded'), serialEl(w) || kv('Serial number', 'Not recorded — add it in Details'),
    kv('Latest value', valueInfo(w).latest ? money(valueInfo(w).latest.value) : 'Not recorded')));
  const ins = insSection(w, { docButtons: false });
  if (ins) box.append(ins);
  // Documents (PDF or images): policy, valuation, receipt…
  const fileIn = el('input', { type: 'file', accept: 'application/pdf,image/*', multiple: true, hidden: true });
  fileIn.addEventListener('change', async () => {
    for (const f of [...fileIn.files]) {
      try { const id = await addFile(f); (w.insDocs ||= []).push({ id: store.uid(), photoId: id, name: f.name || 'Document', type: f.type, added: Date.now() }); }
      catch (e) { toast(e.message || 'Could not add that file'); }
    }
    fileIn.value = ''; store.save(); render();
  });
  box.append(el('h3', { class: 'sub-title' }, 'Documents'),
    (w.insDocs || []).length ? el('div', { class: 'doc-list' }, w.insDocs.map((doc) => el('div', { class: 'doc-row' },
      el('button', { type: 'button', class: 'link-btn', onclick: async () => { const u = await photoUrl(doc.photoId, 'full'); if (u) window.open(u, '_blank'); } }, (doc.type || '').includes('pdf') ? '📄 ' : '🖼️ ', doc.name),
      el('span', { class: 'muted small' }, fmtD(doc.added)),
      el('button', { type: 'button', class: 'icon-btn sm danger', 'aria-label': `Remove ${doc.name}`, onclick: async () => {
        if (!(await confirmModal(`Remove ${doc.name}?`, '', 'Remove', true))) return;
        w.insDocs = w.insDocs.filter((x) => x !== doc); deletePhoto(doc.photoId).catch(() => {}); store.save(); render();
      } }, '×')))) : el('p', { class: 'muted small' }, 'Policy, valuation certificate, receipt — PDFs or photos.'),
    el('button', { type: 'button', class: 'btn sm', onclick: () => fileIn.click() }, '＋ Add a document'), fileIn);
  return box;
}

/* ---------- 12. Buttons ---------- */
function buttons(w) {
  const big = (icon, title, sub, fn) => el('button', { type: 'button', class: 'big-btn', onclick: fn },
    el('span', { class: 'big-btn-i' }, icon), el('span', {}, el('span', { class: 'big-btn-t' }, title), el('span', { class: 'big-btn-s' }, sub)));
  return el('div', { class: 'pg-buttons' },
    big('🛡️', 'Insurance', 'Create a PDF to send to your insurer', () => import('./pdf.js').then((m) => m.insurancePdf(w))),
    big('📖', 'Create a photo album', 'Everything about this watch, ready to print', () => import('./pdf.js').then((m) => m.photoAlbum(w))),
    el('div', { class: 'pg-minor' },
      el('button', { type: 'button', class: 'btn sm', onclick: () => openWatchEditor(w) }, '✎ Edit'),
      w.status === 'owned' ? el('button', { type: 'button', class: 'btn sm', onclick: () => openSaleQr(w) }, '🏷️ For-sale QR') : null,
      w.status === 'owned' ? el('button', { type: 'button', class: 'btn sm', onclick: () => openWatchEditor(w, { status: 'sold' }) }, 'Mark as sold')
        : el('button', { type: 'button', class: 'btn sm', onclick: () => { w.status = 'owned'; if (!w.purchaseDate) w.purchaseDate = new Date().toISOString().slice(0, 10); store.save(); store.emit('watches'); toast('Moved to your Watch Box'); } }, 'Move to Watch Box'),
      el('button', { type: 'button', class: 'btn sm danger', onclick: async () => {
        if (await confirmModal(`Delete “${w.name}”?`, 'This removes the watch, its photos and all its readings.', 'Delete', true)) { await removeWatch(w); closePage(); toast('Deleted'); }
      } }, 'Delete')));
}

/* ---------- The page ---------- */
export function render() {
  const page = $('watch-page');
  const w = currentId && getWatch(currentId);
  if (!page) return;
  if (!w) { closePage(); return; }
  if (isLocked()) { page.replaceChildren(el('div', { class: 'locked-over static' }, el('div', { class: 'locked-pad' }, '🔒'), el('button', { type: 'button', class: 'btn primary', onclick: padlockTapped }, 'Unlock'))); return; }
  const owned = (w.status || 'owned') === 'owned';
  const refresh = () => render();
  const kids = [
    el('div', { class: 'pg-bar' },
      el('button', { type: 'button', class: 'back-btn pg-back', onclick: closePage }, '‹ Watch Box'),
      el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'Edit watch', onclick: () => openWatchEditor(w) }, '✎')),
    hero(w),
    recent(w),
  ];
  if (owned) {
    kids.push(card('Accuracy', accuracyCard(w, { onOpen: (what) => {
      if (what === 'check') { d().selectedWatchId = w.id; store.save(); location.hash = 'clock'; setTimeout(() => document.getElementById('tracker')?.scrollIntoView({ behavior: 'smooth' }), 300); }
      else refresh();
    } })));
    kids.push(timeWorn(w));
    kids.push(card('Where it’s been', miniMap(w, refresh)));
    kids.push(service(w));
  }
  kids.push(value(w));
  kids.push(card('Galleries', galleryGrid(w, refresh)));
  kids.push(details(w), sentimental(w));
  if (owned) kids.push(insurance(w));
  kids.push(buttons(w));
  page.replaceChildren(el('div', { class: 'pg' }, ...kids.filter(Boolean)));
}

export function initDetail() {
  store.on('watches', () => { if (currentId) render(); });
  store.on('wear', () => { if (currentId) render(); });
  window.addEventListener('resize', () => document.body.classList.toggle('wide-split', matchMedia('(min-width: 900px)').matches));
  document.body.classList.toggle('wide-split', matchMedia('(min-width: 900px)').matches);
}
