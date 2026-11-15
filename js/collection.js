// Watch Box tab: every watch you own (no limit), wishlist, sold/traded. Shared watch records with the tracker.
// Wear tracking (on the wrist, power reserve, wear calendar) is added by wrist.js through the hooks below.
import * as store from './store.js';
import { el, openModal, confirmModal, toast } from './ui.js';
import { addPhoto, deletePhoto, fillImg } from './photos.js';
import { watchStats, fmtRate, grade } from './accuracy.js';

/* ---------- Reference lists ---------- */
export const MOVEMENTS = [
  ['automatic', 'Automatic'], ['manual', 'Manual wind'], ['quartz', 'Quartz'], ['solar', 'Solar'],
  ['springdrive', 'Spring Drive'], ['kinetic', 'Kinetic'], ['other', 'Other'],
];
export const movementLabel = (v) => (MOVEMENTS.find((m) => m[0] === v) || [null, ''])[1];
const BPH = ['18000', '19800', '21600', '25200', '28800', '36000'];
const CONDITIONS = ['New / unworn', 'Excellent', 'Very good', 'Good', 'Fair', 'Needs work'];
const BRANDS = ['A. Lange & Söhne', 'Audemars Piguet', 'Baltic', 'Ball', 'Baume & Mercier', 'Bell & Ross', 'Blancpain',
  'Breguet', 'Breitling', 'Bremont', 'Bulova', 'Cartier', 'Casio', 'Certina', 'Christopher Ward', 'Citizen', 'Doxa',
  'Farer', 'Fossil', 'Frederique Constant', 'G-Shock', 'Girard-Perregaux', 'Glashütte Original', 'Grand Seiko',
  'Hamilton', 'Hublot', 'IWC', 'Jaeger-LeCoultre', 'Junghans', 'Longines', 'Lorier', 'Luminox', 'Marathon',
  'Maurice Lacroix', 'Mido', 'MontBlanc', 'Nomos', 'Omega', 'Orient', 'Oris', 'Panerai', 'Patek Philippe',
  'Rado', 'Raymond Weil', 'Rolex', 'Seiko', 'Sinn', 'Squale', 'Swatch', 'TAG Heuer', 'Timex', 'Tissot', 'Tudor',
  'Ulysse Nardin', 'Vacheron Constantin', 'Vaer', 'Zenith'];

/* ---------- Helpers ---------- */
const d = () => store.get();
export const ownedWatches = () => d().watches.filter((w) => (w.status || 'owned') === 'owned');
export function getWatch(id) { return d().watches.find((w) => w.id === id) || null; }
const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));

export function money(v, digits = 0) {
  if (v == null) return '—';
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: d().money || 'GBP', maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v);
  } catch (e) { return String(Math.round(v)); }
}

export function subtitle(w) {
  return [w.brand, w.model, w.reference].filter(Boolean).join(' · ');
}

/** Number of distinct days a watch has been worn. */
export function daysWorn(id) {
  const days = new Set();
  for (const e of d().wear) {
    if (e.watchId !== id) continue;
    const end = e.off || Date.now();
    const c = new Date(e.on); c.setHours(0, 0, 0, 0);
    for (let i = 0; c.getTime() <= end && i < 400; i++) { days.add(c.toDateString()); c.setDate(c.getDate() + 1); }
  }
  return days.size;
}

function changed() { store.save(); store.emit('watches'); }

/* ---------- Form definition ---------- */
// type: text | number | date | select | check | textarea | brand | serial ; half: pairs short fields
// The Stage-2 service fields are added to this list by wrist.js (FORM_EXTRA).
export const FORM = [
  { group: 'Watch', fields: [
    { k: 'name', label: 'Name shown in the app', ph: 'e.g. Rolex GMT', req: true },
    { k: 'brand', label: 'Brand', type: 'brand', half: true },
    { k: 'model', label: 'Model', half: true },
    { k: 'reference', label: 'Reference', half: true },
    { k: 'nickname', label: 'Nickname', ph: 'e.g. Pepsi', half: true },
  ] },
  { group: 'Movement', fields: [
    { k: 'movement', label: 'Movement type', type: 'select', options: MOVEMENTS, half: true },
    { k: 'calibre', label: 'Calibre', ph: 'e.g. NH35, 3285', half: true },
    { k: 'bph', label: 'Beats per hour', type: 'number', list: BPH, ph: 'e.g. 28800', half: true },
    { k: 'powerReserve', label: 'Power reserve (hours)', type: 'number', half: true },
  ] },
  { group: 'Case & strap', fields: [
    { k: 'caseSize', label: 'Case size (mm)', type: 'number', half: true },
    { k: 'lugWidth', label: 'Lug width (mm)', type: 'number', half: true },
    { k: 'waterResistance', label: 'Water resistance', ph: 'e.g. 200 m', half: true },
    { k: 'strap', label: 'Strap or bracelet', ph: 'e.g. Jubilee', half: true },
  ] },
  { group: 'Purchase', fields: [
    { k: 'purchaseDate', label: 'Purchase date', type: 'date', half: true },
    { k: 'purchasePrice', label: 'Purchase price', type: 'number', half: true },
    { k: 'boughtFrom', label: 'Where bought', ph: 'e.g. AD, eBay, Chrono24' },
    { k: 'box', label: 'Box', type: 'check', half: true },
    { k: 'papers', label: 'Papers', type: 'check', half: true },
    { k: 'condition', label: 'Condition', type: 'select', options: CONDITIONS.map((c) => [c, c]), half: true },
    { k: 'value', label: 'Estimated value now', type: 'number', half: true },
  ] },
  { group: 'Wishlist', when: 'wishlist', fields: [
    { k: 'targetPrice', label: 'Target price', type: 'number' },
  ] },
  { group: 'Sold / traded', when: 'sold', fields: [
    { k: 'soldDate', label: 'Date sold', type: 'date', half: true },
    { k: 'soldPrice', label: 'Price received', type: 'number', half: true },
    { k: 'soldTo', label: 'Sold or traded to' },
  ] },
  { group: 'Private', fields: [
    { k: 'serial', label: 'Serial number (kept private, never shared)', type: 'serial' },
  ] },
  { group: 'Notes', fields: [
    { k: 'notes', label: 'Notes', type: 'textarea' },
  ] },
];

function fieldInput(f, w) {
  const v = w[f.k];
  if (f.type === 'select') {
    return el('select', { class: 'input', 'data-k': f.k },
      el('option', { value: '' }, '—'),
      f.options.map(([val, lab]) => el('option', { value: val, selected: v === val }, lab)));
  }
  if (f.type === 'check') {
    return el('input', { type: 'checkbox', class: 'check', 'data-k': f.k, checked: !!v });
  }
  if (f.type === 'textarea') {
    return el('textarea', { class: 'input', rows: 3, 'data-k': f.k }, v || '');
  }
  const attrs = { class: 'input', 'data-k': f.k, value: v == null ? '' : String(v), placeholder: f.ph || '', autocomplete: 'off' };
  if (f.type === 'number') Object.assign(attrs, { type: 'text', inputmode: 'decimal' });
  else if (f.type === 'date') attrs.type = 'date';
  else attrs.type = 'text';
  if (f.type === 'brand') { attrs.list = 'brand-list'; attrs.autocapitalize = 'words'; }
  if (f.list) attrs.list = 'list-' + f.k;
  if (f.type === 'serial') { attrs.autocapitalize = 'characters'; attrs.spellcheck = false; }
  const input = el('input', attrs);
  if (f.list) return [input, el('datalist', { id: 'list-' + f.k }, f.list.map((x) => el('option', { value: x })))];
  return input;
}

function readField(f, root) {
  const n = root.querySelector(`[data-k="${f.k}"]`);
  if (!n) return undefined;
  if (f.type === 'check') return n.checked;
  const v = n.value.trim();
  if (f.type === 'number') return num(v.replace(/[£$€,\s]/g, ''));
  return v || null;
}

/* ---------- Editor ---------- */
export function openWatchEditor(watch, opts = {}) {
  const isNew = !watch;
  const w = isNew ? { status: opts.status || 'owned', photos: [], runs: [] }
    : { ...watch, status: opts.status || watch.status || 'owned', photos: [...(watch.photos || [])] };
  if (w.status === 'sold' && !w.soldDate) w.soldDate = new Date().toISOString().slice(0, 10);
  const added = [];        // photos added during this edit (deleted again on cancel)
  const removed = [];      // photos removed during this edit (deleted on save)
  let saved = false;

  const form = el('div', { class: 'wform' });
  form.append(el('datalist', { id: 'brand-list' }, BRANDS.map((b) => el('option', { value: b }))));

  // Status
  const statusSel = el('div', { class: 'seg seg3' });
  const statusBtns = [['owned', 'Owned'], ['wishlist', 'Wishlist'], ['sold', 'Sold']].map(([v, lab]) => {
    const b = el('button', { type: 'button', class: 'seg-btn' + (w.status === v ? ' active' : ''), onclick: () => { w.status = v; statusBtns.forEach((x) => x.classList.toggle('active', x.dataset.v === v)); toggleGroups(); } }, lab);
    b.dataset.v = v;
    return b;
  });
  statusSel.append(...statusBtns);
  form.append(statusSel);

  // Photos
  const photoRow = el('div', { class: 'photo-row' });
  const fileIn = el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  const drawPhotos = () => {
    photoRow.innerHTML = '';
    w.photos.forEach((id, i) => {
      const img = el('img', { class: 'thumb', alt: 'Watch photo' });
      fillImg(img, id);
      photoRow.append(el('div', { class: 'thumb-wrap' }, img,
        el('button', { type: 'button', class: 'thumb-x', 'aria-label': 'Remove photo', onclick: () => { removed.push(id); w.photos.splice(i, 1); drawPhotos(); } }, '×'),
        i === 0 ? el('span', { class: 'thumb-main' }, 'Main') : el('button', { type: 'button', class: 'thumb-star', 'aria-label': 'Make main photo', onclick: () => { w.photos.splice(i, 1); w.photos.unshift(id); drawPhotos(); } }, '★')));
    });
    photoRow.append(el('button', { type: 'button', class: 'thumb add', onclick: () => fileIn.click() }, el('span', {}, '＋'), el('span', { class: 'small' }, 'Photo')));
  };
  fileIn.addEventListener('change', async () => {
    const files = [...(fileIn.files || [])];
    fileIn.value = '';
    for (const f of files) {
      try { toast('Adding photo…', 1200); const id = await addPhoto(f); added.push(id); w.photos.push(id); drawPhotos(); }
      catch (e) { toast(e.message || 'Could not add that photo'); }
    }
  });
  drawPhotos();
  form.append(el('h3', { class: 'sub-title' }, 'Photos'), photoRow, fileIn);

  // Field groups
  const groups = [];
  for (const g of FORM) {
    const box = el('div', { class: 'fgroup' }, el('h3', { class: 'sub-title' }, g.group));
    let pair = null;
    for (const f of g.fields) {
      const label = f.type === 'check'
        ? el('label', { class: 'field check-field' }, fieldInput(f, w), el('span', {}, f.label))
        : el('label', { class: 'field' }, el('span', {}, f.label + (f.req ? ' *' : '')), fieldInput(f, w));
      if (f.half) {
        if (!pair) { pair = el('div', { class: 'row2' }); box.append(pair); }
        pair.append(label);
        if (pair.children.length === 2) pair = null;
      } else { pair = null; box.append(label); }
    }
    groups.push({ g, box });
    form.append(box);
  }
  const toggleGroups = () => groups.forEach(({ g, box }) => { box.hidden = !!g.when && g.when !== w.status; });
  toggleGroups();

  // Auto-fill the name from brand + model if left empty
  const nameIn = form.querySelector('[data-k="name"]');
  const autoName = () => {
    if (nameIn.dataset.touched) return;
    nameIn.value = [form.querySelector('[data-k="brand"]').value, form.querySelector('[data-k="model"]').value].filter((x) => x.trim()).join(' ');
  };
  nameIn.addEventListener('input', () => { nameIn.dataset.touched = nameIn.value ? '1' : ''; });
  if (isNew) {
    form.querySelector('[data-k="brand"]').addEventListener('input', autoName);
    form.querySelector('[data-k="model"]').addEventListener('input', autoName);
  } else nameIn.dataset.touched = '1';

  openModal({
    title: isNew ? (w.status === 'wishlist' ? 'Add to wishlist' : 'Add a watch') : (opts.status === 'sold' && watch.status !== 'sold' ? `Mark ${watch.name} as sold` : `Edit ${watch.name}`),
    className: 'tall',
    content: form,
    actions: [
      { label: 'Cancel' },
      {
        label: 'Save', kind: 'primary',
        onClick: async () => {
          const vals = {};
          for (const g of FORM) for (const f of g.fields) { const v = readField(f, form); if (v !== undefined) vals[f.k] = v; }
          if (!vals.name) vals.name = [vals.brand, vals.model].filter(Boolean).join(' ');
          if (!vals.name) { toast('Please give the watch a name'); nameIn.focus(); return false; }
          saved = true;
          for (const id of removed) deletePhoto(id).catch(() => {});
          if (isNew) {
            const nw = { id: store.uid(), runs: [], added: Date.now(), ...vals, status: w.status, photos: w.photos };
            d().watches.push(nw);
            if (opts.select || nw.status === 'owned') d().selectedWatchId = nw.id;
          } else {
            Object.assign(watch, vals, { status: w.status, photos: w.photos });
          }
          changed();
          toast('Saved');
        },
      },
    ],
    onClose: () => { if (!saved) for (const id of added) deletePhoto(id).catch(() => {}); },
  });
}

export async function removeWatch(w) {
  for (const id of w.photos || []) await deletePhoto(id).catch(() => {});
  const data = d();
  data.watches = data.watches.filter((x) => x.id !== w.id);
  data.wear = data.wear.filter((x) => x.watchId !== w.id);
  if (data.selectedWatchId === w.id) data.selectedWatchId = ownedWatches()[0]?.id || null;
  changed();
}

/* ---------- Detail view ---------- */
function fact(label, value) {
  if (value == null || value === '' || value === false) return null;
  return el('div', { class: 'fact' }, el('span', { class: 'fact-k' }, label), el('span', { class: 'fact-v' }, value === true ? 'Yes' : String(value)));
}

export function openPhotoViewer(ids, start = 0) {
  let i = start;
  const img = el('img', { class: 'viewer-img', alt: 'Watch photo' });
  const count = el('div', { class: 'muted small viewer-count' });
  const show = () => { img.removeAttribute('src'); fillImg(img, ids[i], 'full'); count.textContent = ids.length > 1 ? `${i + 1} of ${ids.length}` : ''; };
  show();
  const actions = [{ label: 'Close' }];
  if (ids.length > 1) {
    actions.unshift(
      { label: '‹ Prev', onClick: () => { i = (i - 1 + ids.length) % ids.length; show(); return false; } },
      { label: 'Next ›', onClick: () => { i = (i + 1) % ids.length; show(); return false; } });
  }
  openModal({ className: 'viewer', content: [img, count], actions });
}

export function openWatchDetail(w) {
  const st = watchStats(w);
  const box = el('div', { class: 'detail' });
  if (w.photos?.length) {
    const main = el('img', { class: 'detail-photo', alt: w.name, onclick: () => openPhotoViewer(w.photos, 0) });
    fillImg(main, w.photos[0], 'full');
    box.append(main);
    if (w.photos.length > 1) {
      box.append(el('div', { class: 'photo-row' }, w.photos.map((id, i) => {
        const t = el('img', { class: 'thumb', alt: 'Watch photo', onclick: () => openPhotoViewer(w.photos, i) });
        fillImg(t, id);
        return t;
      })));
    }
  }
  if (subtitle(w)) box.append(el('p', { class: 'muted' }, subtitle(w)));

  const serialFact = w.serial ? (() => {
    const v = el('button', { type: 'button', class: 'link-btn serial', onclick: () => { v.textContent = v.textContent.startsWith('•') ? w.serial : '•••••• (tap to show)'; } }, '•••••• (tap to show)');
    return el('div', { class: 'fact' }, el('span', { class: 'fact-k' }, 'Serial'), v);
  })() : null;

  const gain = w.value != null && w.purchasePrice != null ? w.value - w.purchasePrice : null;
  const soldPL = w.soldPrice != null && w.purchasePrice != null ? w.soldPrice - w.purchasePrice : null;
  box.append(el('div', { class: 'facts' },
    fact('Nickname', w.nickname),
    fact('Movement', [movementLabel(w.movement), w.calibre].filter(Boolean).join(' · ')),
    fact('Beat rate', w.bph ? `${Number(w.bph).toLocaleString('en-GB')} bph` : null),
    fact('Power reserve', w.powerReserve ? `${w.powerReserve} h` : null),
    fact('Case size', w.caseSize ? `${w.caseSize} mm` : null),
    fact('Lug width', w.lugWidth ? `${w.lugWidth} mm` : null),
    fact('Water resistance', w.waterResistance),
    fact('Strap', w.strap),
    fact('Bought', [w.purchaseDate ? new Date(w.purchaseDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null, w.boughtFrom].filter(Boolean).join(' · ')),
    fact('Paid', w.purchasePrice != null ? money(w.purchasePrice) : null),
    fact('Estimated value', w.value != null ? money(w.value) + (gain != null ? ` (${gain >= 0 ? '+' : '−'}${money(Math.abs(gain))})` : '') : null),
    fact('Box & papers', w.box || w.papers ? [w.box ? 'Box' : null, w.papers ? 'Papers' : null].filter(Boolean).join(' + ') : null),
    fact('Condition', w.condition),
    fact('Target price', w.status === 'wishlist' && w.targetPrice != null ? money(w.targetPrice) : null),
    fact('Sold', w.status === 'sold' ? [w.soldDate ? new Date(w.soldDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null, w.soldPrice != null ? money(w.soldPrice) : null, w.soldTo].filter(Boolean).join(' · ') : null),
    fact('Profit / loss', w.status === 'sold' && soldPL != null ? `${soldPL >= 0 ? '+' : '−'}${money(Math.abs(soldPL))}` : null),
    fact('Accuracy', st.overall != null ? `${fmtRate(st.overall)} (average)` : null),
    (() => { const g = grade(w, st); return g.ready ? fact('Grade', g.headline) : null; })(),
    fact('Days worn', w.status === 'owned' && daysWorn(w.id) ? daysWorn(w.id) : null),
    serialFact,
    ...(detailExtras.map((f) => f(w))),
  ));
  for (const f of detailSections) { const n = f(w); if (n) box.append(n); }
  if (w.notes) box.append(el('h3', { class: 'sub-title' }, 'Notes'), el('p', { class: 'notes' }, w.notes));

  const actions = [];
  if (w.status === 'owned') actions.push({ label: 'Mark as sold', onClick: () => { setTimeout(() => openWatchEditor(w, { status: 'sold' }), 0); } });
  else actions.push({ label: 'Move to Watch Box', onClick: () => { w.status = 'owned'; if (!w.purchaseDate) w.purchaseDate = new Date().toISOString().slice(0, 10); changed(); toast('Moved to your Watch Box'); } });
  actions.push(
    { label: 'Delete', kind: 'danger', onClick: () => { setTimeout(async () => { if (await confirmModal(`Delete “${w.name}”?`, 'This removes the watch, its photos and all its marks.', 'Delete', true)) { await removeWatch(w); toast('Deleted'); } }, 0); } },
    { label: 'Edit', onClick: () => { setTimeout(() => openWatchEditor(w), 0); } },
    { label: 'Close', kind: 'primary' });
  openModal({ title: w.name, className: 'tall', content: box, actions });
}
// Other stages can add rows to the detail view…
export const detailExtras = [];
// …whole sections under the facts (e.g. the watch's own wrist/wear panel)…
export const detailSections = [];
// …a short status line on each watch card (e.g. "On your wrist")…
export const cardLines = [];
// …and cards near the top of the Watch Box (e.g. reminders, what's on the wrist).
export const boxSections = [];

/* ---------- Watch Box screen ---------- */
const root = () => document.getElementById('collection');

function summary(list) {
  let paid = 0, est = 0, gain = 0, nPaid = 0;
  const byBrand = {}, byMove = {};
  for (const w of list) {
    const p = num(w.purchasePrice), v = num(w.value);
    if (p != null) { paid += p; nPaid++; gain += (v ?? p) - p; }
    if (v != null || p != null) est += v ?? p;
    const b = w.brand || 'Other'; byBrand[b] = (byBrand[b] || 0) + 1;
    const m = movementLabel(w.movement) || 'Not set'; byMove[m] = (byMove[m] || 0) + 1;
  }
  const bars = (obj) => {
    const rows = Object.entries(obj).sort((a, b) => b[1] - a[1]);
    const max = Math.max(1, ...rows.map((r) => r[1]));
    return el('div', { class: 'bars' }, rows.map(([k, n]) => el('div', { class: 'bar-row' },
      el('span', { class: 'bar-k' }, k), el('span', { class: 'bar' }, el('span', { class: 'bar-fill', style: `width:${(n / max) * 100}%` })), el('span', { class: 'bar-n' }, n))));
  };
  const card = el('div', { class: 'card coll-summary' },
    el('div', { class: 'sum-grid' },
      el('div', {}, el('div', { class: 'stat-label' }, 'Watches'), el('div', { class: 'sum-v' }, list.length)),
      el('div', {}, el('div', { class: 'stat-label' }, 'Total paid'), el('div', { class: 'sum-v' }, nPaid ? money(paid) : '—')),
      el('div', {}, el('div', { class: 'stat-label' }, 'Estimated value'), el('div', { class: 'sum-v' }, est ? money(est) : '—')),
      el('div', {}, el('div', { class: 'stat-label' }, 'Gain / loss'), el('div', { class: 'sum-v ' + (gain > 0 ? 'pos' : gain < 0 ? 'neg' : '') }, nPaid ? `${gain >= 0 ? '+' : '−'}${money(Math.abs(gain))}` : '—'))));
  if (list.length > 1) {
    const det = el('details', { class: 'breakdown' }, el('summary', {}, 'Breakdown by brand and movement'),
      el('h3', { class: 'sub-title' }, 'By brand'), bars(byBrand),
      el('h3', { class: 'sub-title' }, 'By movement'), bars(byMove));
    card.append(det);
  }
  if (nPaid && list.some((w) => w.purchasePrice != null && w.value == null)) {
    card.append(el('p', { class: 'muted small' }, 'Where no estimated value is entered, the purchase price is used.'));
  }
  return card;
}

const SORTS = [
  ['brand', 'Brand A–Z'], ['valueDesc', 'Value: high to low'], ['newest', 'Newest purchase'], ['oldest', 'Oldest purchase'],
  ['mostWorn', 'Most worn'], ['leastWorn', 'Least worn'], ['name', 'Name A–Z'],
];
function sortList(list, sort) {
  const by = {
    brand: (a, b) => (a.brand || '~').localeCompare(b.brand || '~') || a.name.localeCompare(b.name),
    name: (a, b) => a.name.localeCompare(b.name),
    valueDesc: (a, b) => (num(b.value) ?? num(b.purchasePrice) ?? num(b.targetPrice) ?? -1) - (num(a.value) ?? num(a.purchasePrice) ?? num(a.targetPrice) ?? -1),
    newest: (a, b) => (b.purchaseDate || '').localeCompare(a.purchaseDate || ''),
    oldest: (a, b) => (a.purchaseDate || '9999').localeCompare(b.purchaseDate || '9999'),
    mostWorn: (a, b) => daysWorn(b.id) - daysWorn(a.id),
    leastWorn: (a, b) => daysWorn(a.id) - daysWorn(b.id),
  }[sort] || ((a, b) => a.name.localeCompare(b.name));
  return [...list].sort(by);
}

function watchCard(w) {
  const img = el('div', { class: 'wc-photo' });
  if (w.photos?.length) { const i = el('img', { alt: w.name, loading: 'lazy' }); fillImg(i, w.photos[0]); img.append(i); }
  else img.append(el('span', { class: 'wc-ph' }, '⌚'));
  let line = '';
  if (w.status === 'wishlist') line = w.targetPrice != null ? `Target ${money(w.targetPrice)}` : '';
  else if (w.status === 'sold') line = w.soldPrice != null ? `Sold ${money(w.soldPrice)}` : 'Sold';
  else line = w.value != null ? money(w.value) : w.purchasePrice != null ? `Paid ${money(w.purchasePrice)}` : '';
  return el('button', { type: 'button', class: 'watch-card', onclick: () => openWatchDetail(w) },
    img,
    el('div', { class: 'wc-body' },
      el('div', { class: 'wc-name' }, w.name),
      el('div', { class: 'wc-sub' }, subtitle(w) || movementLabel(w.movement) || ' '),
      line ? el('div', { class: 'wc-line' }, line) : null,
      w.status === 'owned' ? cardLines.map((f) => { const t = f(w); return t ? el('div', { class: 'wc-status ' + (t.cls || '') }, t.text) : null; }) : null));
}

export function render() {
  const box = root();
  if (!box) return;
  box.innerHTML = '';
  const data = d();
  const view = data.collectionView;
  const counts = { owned: 0, wishlist: 0, sold: 0 };
  for (const w of data.watches) counts[w.status || 'owned']++;

  for (const f of bannerHooks) { const b = f(); if (b) box.append(b); }

  const tabs = el('div', { class: 'seg seg3' }, [['owned', 'Owned'], ['wishlist', 'Wishlist'], ['sold', 'Sold']].map(([v, lab]) =>
    el('button', { type: 'button', class: 'seg-btn' + (view.tab === v ? ' active' : ''), onclick: () => { view.tab = v; store.save(); render(); } }, `${lab} (${counts[v]})`)));
  box.append(tabs);

  let list = data.watches.filter((w) => (w.status || 'owned') === view.tab);
  if (view.tab === 'owned') for (const f of boxSections) { const n = f(); if (n) box.append(n); }
  if (view.tab === 'owned' && list.length) box.append(summary(list));

  const search = el('input', { type: 'search', class: 'input', placeholder: 'Search', value: view.q || '', 'aria-label': 'Search watches',
    oninput: (e) => { view.q = e.target.value; drawGrid(); } });
  const sort = el('select', { class: 'input', 'aria-label': 'Sort', onchange: (e) => { view.sort = e.target.value; store.save(); drawGrid(); } },
    SORTS.map(([v, lab]) => el('option', { value: v, selected: view.sort === v }, lab)));
  box.append(el('div', { class: 'coll-tools' }, search, sort));

  const addLabel = view.tab === 'wishlist' ? '+ Add to wishlist' : view.tab === 'sold' ? '+ Add a sold watch' : '+ Add a watch';
  box.append(el('button', { type: 'button', class: 'btn primary wide', onclick: () => openWatchEditor(null, { status: view.tab }) }, addLabel));

  const grid = el('div', { class: 'watch-grid' });
  box.append(grid);
  function drawGrid() {
    grid.innerHTML = '';
    const q = (view.q || '').trim().toLowerCase();
    let shown = list;
    if (q) shown = list.filter((w) => [w.name, w.brand, w.model, w.reference, w.nickname, w.calibre].some((x) => x && String(x).toLowerCase().includes(q)));
    shown = sortList(shown, view.sort);
    if (!shown.length) {
      grid.append(el('p', { class: 'muted empty-note' }, q ? 'No watches match your search.' :
        view.tab === 'owned' ? 'Your Watch Box is empty. Tap “Add a watch” to start — there’s room for as many as you like.' :
          view.tab === 'wishlist' ? 'Nothing on your wishlist yet.' : 'No sold or traded watches yet.'));
    }
    for (const w of shown) grid.append(watchCard(w));
  }
  drawGrid();
}
// Other stages can add banners at the top of the Watch Box screen.
export const bannerHooks = [];

let visible = false;
export function initCollection() {
  store.on('watches', () => { if (visible) render(); });
  store.on('wear', () => { if (visible) render(); });
}
export function showCollection() { visible = true; render(); }
export function hideCollection() { visible = false; }
