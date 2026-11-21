// Watch Box tab: every watch you own (no limit), wishlist, sold/traded. Shared watch records with the tracker.
// Wear tracking (on the wrist, power reserve, wear calendar) is added by wrist.js through the hooks below.
import * as store from './store.js';
import { el, openModal, confirmModal, toast } from './ui.js';
import { addPhoto, deletePhoto, fillImg, photoUrl } from './photos.js';
import { watchStats, fmtRate, grade } from './accuracy.js';
import { captureFace } from './camera.js';
import { addWatch } from './addwatch.js';
export { addWatch };
import { BRANDS, FEATURE_LABELS, chrono24Url } from './watchdb.js';
import { photoIdsOf, allFeatures, allCategories, featuresOf, FEATURE_GROUPS, HOW_ACQUIRED, WHY_BOUGHT } from './model.js';
import { isLocked, padlockTapped, onLockChange, lockEnabled } from './lock.js';

/* ---------- Reference lists ---------- */
export const MOVEMENTS = [
  ['automatic', 'Automatic'], ['manual', 'Manual wind'], ['quartz', 'Quartz'], ['solar', 'Solar'],
  ['springdrive', 'Spring Drive'], ['kinetic', 'Kinetic'], ['other', 'Other'],
];
export const movementLabel = (v) => (MOVEMENTS.find((m) => m[0] === v) || [null, ''])[1];
const BPH = ['18000', '19800', '21600', '25200', '28800', '36000'];
const CONDITIONS = ['New / unworn', 'Excellent', 'Very good', 'Good', 'Fair', 'Needs work'];
/** Every brand to offer: the built-in list plus any the person has added. */
export function allBrands() {
  const extra = (d().customBrands || []).filter((b) => !BRANDS.includes(b));
  return [...BRANDS, ...extra].sort((x, y) => x.localeCompare(y));
}

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

/** Wear in the last 12 months: { days: distinct days worn, ms: total time on the wrist }. */
export function wearPastYear(id) {
  const from = Date.now() - 365 * 86400000;
  const days = new Set();
  let ms = 0;
  for (const e of d().wear) {
    if (e.watchId !== id) continue;
    const end = e.off || Date.now();
    if (end <= from) continue;
    const start = Math.max(e.on, from);
    ms += end - start;
    const c = new Date(start); c.setHours(0, 0, 0, 0);
    for (let i = 0; c.getTime() <= end && i < 400; i++) { days.add(c.toDateString()); c.setDate(c.getDate() + 1); }
  }
  return { days: days.size, ms };
}

/**
 * The watch's "face" — its profile picture (just the watch head, framed with the camera guide).
 * Falls back to the main photo, then to a placeholder.
 */
export function faceEl(w, kind = 'thumb', cls = '') {
  const shape = w.face ? (w.faceShape || 'circle') : 'circle';
  const box = el('div', { class: `face face-${shape} ${cls}` });
  // Placeholder first; the picture replaces it once loaded. A missing picture (e.g. deleted) falls back to the
  // main photo, then stays as the placeholder — never a broken image.
  box.append(el('span', { class: 'face-ph' }, '⌚'));
  const ids = [w.face, w.photos?.[0]].filter(Boolean);
  (async () => {
    for (const id of ids) {
      const u = await photoUrl(id, kind);
      if (!u) continue;
      if (id !== w.face) box.className = `face face-circle ${cls}`;
      box.replaceChildren(el('img', { alt: w.name || 'Watch', src: u }));
      return;
    }
  })();
  return box;
}

function changed() { store.save(); store.emit('watches'); }

/* ---------- Form definition ---------- */
// type: text | number | date | select | check | textarea | brand | serial ; half: pairs short fields
// The Stage-2 service fields are added to this list by wrist.js (FORM_EXTRA).
export const SELLER_TYPES = [['ad', 'Authorised dealer'], ['jeweller', 'Jeweller / watch shop'], ['private', 'Private seller'],
  ['online', 'Online marketplace'], ['gift', 'Gift or inherited'], ['other', 'Other']];
export const FORM = [
  { group: 'Watch', fields: [
    { k: 'name', label: 'Name shown in the app', ph: 'e.g. Rolex GMT', req: true },
    { k: 'brand', label: 'Brand', type: 'brand', half: true },
    { k: 'model', label: 'Model name', half: true },
    { k: 'reference', label: 'Model number (reference)', half: true },
    { k: 'year', label: 'Year made', type: 'number', ph: 'e.g. 2019', half: true },
    { k: 'nickname', label: 'Nickname', ph: 'e.g. Pepsi' },
  ] },
  { group: 'Movement', fields: [
    { k: 'movement', label: 'Movement type', type: 'select', options: MOVEMENTS, half: true },
    { k: 'calibre', label: 'Calibre', ph: 'e.g. NH35, 3285', half: true },
    { k: 'bph', label: 'Beats per hour', type: 'number', list: BPH, ph: 'e.g. 28800', half: true },
    { k: 'powerReserve', label: 'Power reserve (hours)', type: 'number', half: true },
    { k: 'jewels', label: 'Jewels', type: 'number', half: true },
  ] },
  { group: 'Features', fields: [{ k: 'features', type: 'chips', source: 'features' }] },
  { group: 'Categories', fields: [{ k: 'categories', type: 'chips', source: 'categories' }] },
  { group: 'Case & strap', fields: [
    { k: 'caseSize', label: 'Case size (mm)', type: 'number', half: true },
    { k: 'lugWidth', label: 'Lug width (mm)', type: 'number', half: true },
    { k: 'waterResistance', label: 'Water resistance', ph: 'e.g. 200 m', half: true },
    { k: 'strap', label: 'Strap or bracelet', ph: 'e.g. Jubilee', half: true },
    { k: 'caseMaterial', label: 'Case material', ph: 'e.g. Steel', half: true },
    { k: 'thickness', label: 'Thickness (mm)', type: 'number', half: true },
    { k: 'crystal', label: 'Crystal', ph: 'e.g. Sapphire', half: true },
    { k: 'dial', label: 'Dial', ph: 'e.g. Black, sunburst', half: true },
  ] },
  { group: 'Purchase', fields: [
    { k: 'purchaseDate', label: 'Purchase date', type: 'date', half: true },
    { k: 'purchasePrice', label: 'Purchase price', type: 'number', half: true },
    { k: 'sellerType', label: 'Bought from', type: 'select', options: SELLER_TYPES },
    { k: 'boughtFrom', label: 'Seller or shop name', ph: 'e.g. Goldsmiths, eBay, Chrono24', showIf: (v) => v.sellerType !== 'private' },
    { k: 'sellerAddress', label: 'Shop address', type: 'textarea', showIf: (v) => ['ad', 'jeweller'].includes(v.sellerType) },
    { k: 'sellerContact', label: 'Shop phone, email or website', showIf: (v) => ['ad', 'jeweller'].includes(v.sellerType) },
    { k: 'box', label: 'Box', type: 'check', half: true },
    { k: 'papers', label: 'Papers', type: 'check', half: true },
    { k: 'condition', label: 'Condition', type: 'select', options: CONDITIONS.map((c) => [c, c]), half: true },
    { k: 'value', label: 'Estimated value now', type: 'number', half: true },
  ], extra: (form) => el('button', { type: 'button', class: 'btn sm c24-btn', onclick: () => {
    const q = ['brand', 'reference', 'model'].map((k) => form.querySelector(`[data-k="${k}"]`)?.value.trim()).filter((x) => x && x !== '__add');
    if (!q.length) { toast('Enter the brand and reference first'); return; }
    window.open(chrono24Url(q.slice(0, 2).join(' '), d().money || 'GBP'), '_blank', 'noopener');
  } }, 'Check current prices on Chrono24 ↗') },
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
  { group: 'Sentimental', fields: [
    { k: 'howAcquired', label: 'How I got it', type: 'select', options: HOW_ACQUIRED, half: true },
    { k: 'whyBought', label: 'Why', type: 'select', options: WHY_BOUGHT, half: true },
    { k: 'fromWho', label: 'Who it’s from', ph: 'e.g. Dad', half: true, showIf: (v) => v.howAcquired !== 'bought' },
    { k: 'occasion', label: 'Occasion', ph: 'e.g. 40th birthday', half: true },
    { k: 'story', label: 'My story', type: 'textarea' },
  ] },
  { group: 'Legacy', note: 'A private note of who you’d like this watch to go to. This is not a will or an official document — to make it legally binding, include it in your will with a solicitor.', fields: [
    { k: 'willStatus', label: 'Is this watch in your will?', type: 'select', options: [['yes', 'Yes'], ['no', 'No'], ['undecided', 'Not decided yet']] },
    { k: 'willTo', label: 'To be left to', ph: 'e.g. my son, James', showIf: (v) => v.willStatus !== 'no' },
    { k: 'willNote', label: 'Note for them (optional)', type: 'textarea', showIf: (v) => v.willStatus !== 'no' },
  ] },
  { group: 'Notes', fields: [
    { k: 'notes', label: 'Notes', type: 'textarea' },
  ] },
];

function chipsInput(f, w) {
  const chosen = new Set(f.source === 'features' ? featuresOf(w) : (w.categories || []));
  const box = el('div', { class: 'chips-field', 'data-k': f.k });
  box._value = () => [...chosen];
  const chip = (id, label) => {
    const b = el('button', { type: 'button', class: 'chip-btn' + (chosen.has(id) ? ' on' : ''), 'aria-pressed': String(chosen.has(id)),
      onclick: () => { chosen.has(id) ? chosen.delete(id) : chosen.add(id); b.classList.toggle('on'); b.setAttribute('aria-pressed', String(chosen.has(id))); } }, label);
    return b;
  };
  const addOwn = (row) => el('button', { type: 'button', class: 'chip-btn add', onclick: () => {
    const name = prompt(f.source === 'features' ? 'Name of the feature' : 'Name of the category');
    if (!name || !name.trim()) return;
    const id = 'c_' + store.uid();
    (f.source === 'features' ? (d().customFeatures ||= []) : (d().customCategories ||= [])).push({ id, label: name.trim() });
    store.save(); chosen.add(id);
    row.insertBefore(chip(id, name.trim()), row.lastChild);
  } }, '＋ Add your own');
  if (f.source === 'features') {
    const groups = [...FEATURE_GROUPS.map((g) => [g.title, g.items]), ['Your own', (d().customFeatures || []).map((c) => [c.id, c.label])]];
    for (const [title, items] of groups) {
      const row = el('div', { class: 'chips' }, items.map(([id, label]) => chip(id, label)));
      if (title === 'Your own') row.append(addOwn(row));
      if (items.length || title === 'Your own') box.append(el('div', { class: 'chip-group' }, el('div', { class: 'eyebrow' }, title), row));
    }
  } else {
    const row = el('div', { class: 'chips' }, allCategories(d()).map((c) => chip(c.id, c.label)));
    row.append(addOwn(row));
    box.append(row);
  }
  return box;
}

function fieldInput(f, w) {
  const v = w[f.k];
  if (f.type === 'chips') return chipsInput(f, w);
  if (f.type === 'brand') {
    const list = allBrands();
    if (v && !list.includes(v)) list.unshift(v);
    const sel = el('select', { class: 'input', 'data-k': f.k },
      el('option', { value: '' }, 'Choose a brand…'),
      list.map((b) => el('option', { value: b, selected: v === b }, b)),
      el('option', { value: '__add' }, '＋ Add a brand…'));
    const other = el('input', { type: 'text', class: 'input brand-new', 'data-k': f.k + '__new', placeholder: 'Brand name', autocapitalize: 'words', hidden: true });
    sel.addEventListener('change', () => { other.hidden = sel.value !== '__add'; if (!other.hidden) other.focus(); });
    return [sel, other];
  }
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
  if (f.list) attrs.list = 'list-' + f.k;
  if (f.type === 'serial') { attrs.autocapitalize = 'characters'; attrs.spellcheck = false; }
  const input = el('input', attrs);
  if (f.list) return [input, el('datalist', { id: 'list-' + f.k }, f.list.map((x) => el('option', { value: x })))];
  return input;
}

function readField(f, root) {
  const n = root.querySelector(`[data-k="${f.k}"]`);
  if (!n) return undefined;
  if (f.type === 'chips') return n._value();
  if (f.type === 'check') return n.checked;
  const v = n.value.trim();
  if (f.type === 'brand' && v === '__add') return root.querySelector(`[data-k="${f.k}__new"]`).value.trim() || null;
  if (f.type === 'number') return num(v.replace(/[£$€,\s]/g, ''));
  return v || null;
}

/* ---------- Editor ---------- */
export function openWatchEditor(watch, opts = {}) {
  const isNew = !watch;
  const w = isNew ? { ...(opts.prefill || {}), status: opts.status || 'owned', photos: [], runs: [] }
    : { ...watch, status: opts.status || watch.status || 'owned', photos: [...(watch.photos || [])] };
  if (w.status === 'sold' && !w.soldDate) w.soldDate = new Date().toISOString().slice(0, 10);
  const added = [];        // photos added during this edit (deleted again on cancel)
  const removed = [];      // photos removed during this edit (deleted on save)
  let saved = false;
  if (opts.face) { w.face = opts.face.id; w.faceShape = opts.face.shape; added.push(opts.face.id); }

  const form = el('div', { class: 'wform' });

  // Status
  const statusSel = el('div', { class: 'seg seg3' });
  const statusBtns = [['owned', 'Owned'], ['wishlist', 'Wishlist'], ['sold', 'Sold']].map(([v, lab]) => {
    const b = el('button', { type: 'button', class: 'seg-btn' + (w.status === v ? ' active' : ''), onclick: () => { w.status = v; statusBtns.forEach((x) => x.classList.toggle('active', x.dataset.v === v)); toggleGroups(); } }, lab);
    b.dataset.v = v;
    return b;
  });
  statusSel.append(...statusBtns);
  form.append(statusSel);

  if (opts.banner) form.append(opts.banner);

  // Face picture (the watch's profile picture, taken with the camera guide)
  const faceBox = el('div', { class: 'face-edit' });
  const drawFace = () => {
    faceBox.innerHTML = '';
    faceBox.append(faceEl(w.face ? w : { name: '', photos: [] }, 'thumb', 'face-md'),
      el('div', { class: 'face-edit-btns' },
        el('p', { class: 'muted small' }, w.face ? 'This picture is how the watch shows in your Watch Box.' : 'Take a picture of just the watch head so it’s instantly recognisable in your Watch Box.'),
        el('button', { type: 'button', class: 'btn sm', onclick: async () => {
          const res = await captureFace({ title: w.name || 'Face picture', shape: w.faceShape });
          if (!res || !res.blob) return;
          try {
            const id = await addPhoto(res.blob);
            added.push(id);
            if (w.face) removed.push(w.face);
            w.face = id; w.faceShape = res.shape;
            drawFace();
          } catch (e) { toast(e.message || 'Could not save the picture'); }
        } }, w.face ? '📷 Retake' : '📷 Take face picture'),
        w.face ? el('button', { type: 'button', class: 'btn sm', onclick: () => { removed.push(w.face); w.face = null; drawFace(); } }, 'Remove') : null));
  };
  drawFace();
  form.append(el('h3', { class: 'sub-title' }, 'Face picture'), faceBox);

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
  form.append(el('h3', { class: 'sub-title' }, 'More photos'), photoRow, fileIn);

  // Field groups
  const groups = [];
  const conditional = [];   // fields shown only when another answer fits (e.g. shop address for a jeweller)
  for (const g of FORM) {
    const box = el('div', { class: 'fgroup' }, el('h3', { class: 'sub-title' }, g.group));
    if (g.note) box.append(el('p', { class: 'muted small fnote' }, g.note));
    let pair = null;
    for (const f of g.fields) {
      const label = f.type === 'chips' ? el('div', { class: 'field' }, fieldInput(f, w))
        : f.type === 'check'
        ? el('label', { class: 'field check-field' }, fieldInput(f, w), el('span', {}, f.label))
        : el('label', { class: 'field' }, el('span', {}, f.label + (f.req ? ' *' : '')), fieldInput(f, w));
      if (f.showIf) conditional.push([f, label]);
      if (f.half) {
        if (!pair) { pair = el('div', { class: 'row2' }); box.append(pair); }
        pair.append(label);
        if (pair.children.length === 2) pair = null;
      } else { pair = null; box.append(label); }
    }
    if (g.extra) box.append(g.extra(form));
    groups.push({ g, box });
    form.append(box);
  }
  const toggleGroups = () => groups.forEach(({ g, box }) => { box.hidden = !!g.when && g.when !== w.status; });
  toggleGroups();
  const toggleFields = () => {
    const vals = {};
    for (const g of FORM) for (const x of g.fields) { if (x.type === 'chips') continue; const n = form.querySelector(`[data-k="${x.k}"]`); if (n) vals[x.k] = n.type === 'checkbox' ? n.checked : n.value; }
    for (const [f, label] of conditional) label.hidden = !f.showIf(vals);
  };
  form.addEventListener('change', toggleFields);
  toggleFields();

  // Auto-fill the name from brand + model if left empty
  const nameIn = form.querySelector('[data-k="name"]');
  const autoName = () => {
    if (nameIn.dataset.touched) return;
    const b = form.querySelector('[data-k="brand"]').value;
    const brand = b === '__add' ? form.querySelector('[data-k="brand__new"]').value : b;
    nameIn.value = [brand, form.querySelector('[data-k="model"]').value || form.querySelector('[data-k="reference"]').value].filter((x) => x && x.trim()).join(' ');
  };
  nameIn.addEventListener('input', () => { nameIn.dataset.touched = nameIn.value ? '1' : ''; });
  if (isNew) {
    for (const k of ['brand', 'brand__new', 'model', 'reference']) {
      const n = form.querySelector(`[data-k="${k}"]`);
      n.addEventListener('input', autoName); n.addEventListener('change', autoName);
    }
    if (w.name) nameIn.dataset.touched = '1'; else autoName();
  } else nameIn.dataset.touched = '1';

  if (opts.focusGroup) setTimeout(() => { const g = groups.find((x) => x.g.group === opts.focusGroup); if (g) g.box.scrollIntoView({ block: 'start' }); }, 250);
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
          vals.featuresTouched = true;
          if (!vals.name) { toast('Please give the watch a name'); nameIn.focus(); return false; }
          if (vals.brand && !allBrands().includes(vals.brand)) { (d().customBrands ||= []).push(vals.brand); }
          saved = true;
          for (const id of removed) deletePhoto(id).catch(() => {});
          const face = { face: w.face || null, faceShape: w.face ? w.faceShape : null };
          if (isNew) {
            const nw = { id: store.uid(), runs: [], added: Date.now(), ...vals, status: w.status, photos: w.photos, ...face };
            d().watches.push(nw);
            if (opts.select || nw.status === 'owned') d().selectedWatchId = nw.id;
          } else {
            Object.assign(watch, vals, { status: w.status, photos: w.photos }, face);
            // Sold or moved to the wishlist while on the wrist: end that wear so it stops counting.
            if (w.status !== 'owned') for (const e of d().wear) if (e.watchId === watch.id && !e.off) e.off = Date.now();
          }
          changed();
          toast('Saved');
        },
      },
    ],
    onClose: () => {
      if (!saved) {
        for (const id of added) deletePhoto(id).catch(() => {});
        if (isNew && opts.face) toast('Watch not added');
      }
    },
  });
}

/** Every stored photo a watch owns: face picture, more photos, galleries, insurance photos and documents. */
export function allPhotoIds(w) { return photoIdsOf(w); }

export async function removeWatch(w) {
  for (const id of allPhotoIds(w)) await deletePhoto(id).catch(() => {});
  const data = d();
  data.watches = data.watches.filter((x) => x.id !== w.id);
  data.wear = data.wear.filter((x) => x.watchId !== w.id);
  if (data.selectedWatchId === w.id) data.selectedWatchId = ownedWatches()[0]?.id || null;
  changed();
}

/* ---------- For-sale QR code ---------- */
let qrLib = null;
function loadQr() {
  if (!qrLib) {
    qrLib = new Promise((resolve, reject) => {
      if (window.qrcode) { resolve(window.qrcode); return; }
      const sc = document.createElement('script');
      sc.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
      sc.crossOrigin = 'anonymous';
      sc.onload = () => resolve(window.qrcode);
      sc.onerror = () => { qrLib = null; reject(new Error('The QR maker could not be downloaded (are you online?).')); };
      document.head.append(sc);
    });
  }
  return qrLib;
}

/** Plain-text sale listing that the QR code holds — readable by any phone camera, no website needed. */
export function saleText(w, sale) {
  const feats = featuresOf(w).map((id) => (allFeatures(d()).find((f) => f.id === id) || { label: id }).label);
  const lines = [
    `FOR SALE: ${[w.brand, w.model].filter(Boolean).join(' ') || w.name}`,
    w.reference ? `Reference: ${w.reference}` : null,
    w.year ? `Year: ${w.year}` : null,
    [movementLabel(w.movement), w.calibre].filter(Boolean).join(' · ') || null,
    [w.caseSize ? `${w.caseSize} mm` : null, w.waterResistance].filter(Boolean).join(' · ') || null,
    feats.length ? feats.join(', ') : null,
    `Box & papers: ${w.box && w.papers ? 'Full set' : w.box ? 'Box only' : w.papers ? 'Papers only' : 'Watch only'}`,
    w.condition ? `Condition: ${w.condition}` : null,
    w.lastService ? `Last serviced: ${new Date(w.lastService).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}` : null,
    sale.price != null ? `Price: ${money(sale.price)}` : null,
    sale.contact ? `Contact: ${sale.contact}` : null,
    sale.extra || null,
  ];
  return lines.filter(Boolean).join('\n');
}

export function openSaleQr(w) {
  const sale = { price: w.sale?.price ?? w.value ?? null, contact: w.sale?.contact || '', extra: w.sale?.extra || '' };
  const priceIn = el('input', { class: 'input', type: 'text', inputmode: 'decimal', value: sale.price ?? '', placeholder: 'Asking price' });
  const contactIn = el('input', { class: 'input', type: 'text', value: sale.contact, placeholder: 'Phone or email' });
  const extraIn = el('textarea', { class: 'input', rows: 2, placeholder: 'Anything else, e.g. “Collection from Leeds”' }, sale.extra);
  const out = el('div', { class: 'qr-out' });
  let pngUrl = null;
  const draw = async () => {
    sale.price = num(priceIn.value.replace(/[£$€,\s]/g, '')); sale.contact = contactIn.value.trim(); sale.extra = extraIn.value.trim();
    out.innerHTML = '';
    try {
      const qrcode = await loadQr();
      const text = saleText(w, sale);
      const q = qrcode(0, 'M'); q.addData(unescape(encodeURIComponent(text))); q.make();
      const n = q.getModuleCount(), cell = 8, pad = 4 * cell, size = n * cell + pad * 2;
      const c = document.createElement('canvas'); c.width = size; c.height = size;
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, size, size); g.fillStyle = '#000';
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.isDark(y, x)) g.fillRect(pad + x * cell, pad + y * cell, cell, cell);
      pngUrl = c.toDataURL('image/png');
      out.append(el('img', { class: 'qr-img', src: pngUrl, alt: 'For-sale QR code' }), el('pre', { class: 'qr-text' }, text));
    } catch (e) { out.append(el('p', { class: 'muted' }, e.message)); }
  };
  openModal({
    title: `Sell ${w.name}`, className: 'tall',
    content: [
      el('p', { class: 'muted small' }, 'Makes a QR code holding this watch’s details and your asking price. Print it or show it on screen — anyone can scan it with their phone camera to read the listing. Your serial number is never included.'),
      el('div', { class: 'row2' }, el('label', { class: 'field' }, el('span', {}, 'Asking price'), priceIn), el('label', { class: 'field' }, el('span', {}, 'Contact'), contactIn)),
      el('label', { class: 'field' }, el('span', {}, 'Extra details'), extraIn),
      el('button', { type: 'button', class: 'btn primary wide', onclick: draw }, 'Make QR code'), out],
    actions: [
      { label: 'Share / save', onClick: async () => {
        if (!pngUrl) { await draw(); }
        if (!pngUrl) return false;
        const blob = await (await fetch(pngUrl)).blob();
        const file = new File([blob], `${(w.name || 'watch').replace(/[^\w-]+/g, '-')}-for-sale.png`, { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: `${w.name} for sale` }); } catch (e) { /* cancelled */ } }
        else { const a = el('a', { href: pngUrl, download: file.name }); document.body.append(a); a.click(); a.remove(); }
        return false;
      } },
      { label: 'Done', kind: 'primary' },
    ],
    onClose: () => { w.sale = { price: num(priceIn.value.replace(/[£$€,\s]/g, '')), contact: contactIn.value.trim(), extra: extraIn.value.trim() }; store.save(); },
  });
  draw();
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

/** Opens a watch's page (in the Watch Box tab; beside the list on wide screens). */
export function openWatchDetail(w) {
  if (!w) return;
  const modal = document.getElementById('modal');
  if (modal && modal.open) modal.close();
  if (!document.getElementById('tab-collection').classList.contains('active')) { location.hash = 'collection/' + w.id; return; }
  import('./detail.js').then((m) => m.openPage(getWatch(w.id) || w));
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

const SORTS = [['newest', 'Newest acquired'], ['oldest', 'Oldest acquired'], ['name', 'Name A–Z'], ['mostWorn', 'Most worn']];
const acquired = (w) => w.purchaseDate || (w.added ? new Date(w.added).toISOString().slice(0, 10) : '');
function sortList(list, sort) {
  const by = {
    name: (a, b) => a.name.localeCompare(b.name),
    newest: (a, b) => acquired(b).localeCompare(acquired(a)) || a.name.localeCompare(b.name),
    oldest: (a, b) => (acquired(a) || '9999').localeCompare(acquired(b) || '9999') || a.name.localeCompare(b.name),
    mostWorn: (a, b) => daysWorn(b.id) - daysWorn(a.id) || a.name.localeCompare(b.name),
  }[sort] || ((a, b) => acquired(b).localeCompare(acquired(a)));
  return [...list].sort(by);
}

/* ---------- Filters: features (all must match), categories (any), movement (any) ---------- */
const emptyFilters = () => ({ features: [], categories: [], movements: [], hide: false });
const filtersOf = (view) => (view.filters ||= emptyFilters());
const activeCount = (f) => f.features.length + f.categories.length + f.movements.length;
export function matchesFilters(w, f) {
  const feats = featuresOf(w);
  if (f.features.length && !f.features.every((x) => feats.includes(x))) return false;
  if (f.categories.length && !f.categories.some((x) => (w.categories || []).includes(x))) return false;
  if (f.movements.length && !f.movements.includes(w.movement || '')) return false;
  return true;
}

function openFilters(view, onDone) {
  const f = { ...emptyFilters(), ...filtersOf(view) };
  f.features = [...f.features]; f.categories = [...f.categories]; f.movements = [...f.movements];
  const chips = (key, items) => el('div', { class: 'chips' }, items.map(([id, label]) => {
    const b = el('button', { type: 'button', class: 'chip-btn' + (f[key].includes(id) ? ' on' : ''), 'aria-pressed': String(f[key].includes(id)),
      onclick: () => { f[key] = f[key].includes(id) ? f[key].filter((x) => x !== id) : [...f[key], id]; b.classList.toggle('on'); b.setAttribute('aria-pressed', String(f[key].includes(id))); } }, label);
    return b;
  }));
  const groups = {};
  for (const x of allFeatures(d())) (groups[x.group] ||= []).push([x.id, x.label]);
  const hide = el('input', { type: 'checkbox', class: 'check', checked: f.hide });
  openModal({
    title: 'Filter the Watch Box', className: 'tall',
    content: [
      el('label', { class: 'field check-field' }, hide, el('span', {}, 'Hide watches that don’t match (otherwise they’re greyed out)')),
      el('h3', { class: 'sub-title' }, 'Category'), chips('categories', allCategories(d()).map((c) => [c.id, c.label])),
      el('h3', { class: 'sub-title' }, 'Movement'), chips('movements', MOVEMENTS),
      el('h3', { class: 'sub-title' }, 'Features'), el('p', { class: 'muted small' }, 'Watches must have every feature you pick.'),
      ...Object.entries(groups).map(([g, items]) => el('div', { class: 'chip-group' }, el('div', { class: 'eyebrow' }, g === 'custom' ? 'Your own' : g), chips('features', items))),
    ],
    actions: [
      { label: 'Clear all', onClick: () => { view.filters = emptyFilters(); store.save(); onDone(); } },
      { label: 'Show watches', kind: 'primary', onClick: () => { f.hide = hide.checked; view.filters = f; store.save(); onDone(); } },
    ],
  });
}

function filterBar(view, onChange) {
  const f = filtersOf(view);
  const n = activeCount(f);
  const label = (key, id) => key === 'features' ? (allFeatures(d()).find((x) => x.id === id) || { label: id }).label
    : key === 'categories' ? (allCategories(d()).find((x) => x.id === id) || { label: id }).label : movementLabel(id) || id;
  const active = [];
  for (const key of ['categories', 'movements', 'features']) for (const id of f[key]) {
    active.push(el('button', { type: 'button', class: 'chip-btn on sm', onclick: () => { f[key] = f[key].filter((x) => x !== id); store.save(); onChange(); } }, label(key, id), ' ×'));
  }
  return el('div', { class: 'filter-bar' },
    el('button', { type: 'button', class: 'btn sm' + (n ? ' primary' : ''), onclick: () => openFilters(view, onChange) }, n ? `Filters · ${n}` : '⚲ Filter'),
    n ? el('div', { class: 'chips inline' }, active) : null,
    n ? el('button', { type: 'button', class: 'link-btn', onclick: () => { view.filters = emptyFilters(); store.save(); onChange(); } }, 'Clear all') : null);
}

function watchCard(w) {
  const img = el('div', { class: 'wc-photo' });
  const pid = w.face || w.photos?.[0];
  if (pid) { const i = el('img', { alt: w.name, loading: 'lazy' }); fillImg(i, pid); img.append(i); }
  else img.append(el('span', { class: 'wc-ph' }, '⌚'));
  let line = '';
  if (w.status === 'wishlist') line = w.targetPrice != null ? `Target ${money(w.targetPrice)}` : '';
  else if (w.status === 'sold') line = w.soldPrice != null ? `Sold ${money(w.soldPrice)}` : 'Sold';
  else line = w.value != null ? money(w.value) : w.purchasePrice != null ? `Paid ${money(w.purchasePrice)}` : '';
  return el('button', { type: 'button', class: 'watch-card', 'data-wid': w.id, onclick: () => openWatchDetail(w) },
    img,
    el('div', { class: 'wc-body' },
      el('div', { class: 'wc-name' }, w.name),
      el('div', { class: 'wc-sub' }, subtitle(w) || movementLabel(w.movement) || ' '),
      line ? el('div', { class: 'wc-line' }, line) : null,
      w.status === 'owned' ? cardLines.map((f) => { const t = f(w); return t ? el('div', { class: 'wc-status ' + (t.cls || '') }, t.text) : null; }) : null));
}

/* ---------- The virtual watch box (Owned) ---------- */
const DEFAULT_SLOTS = 6;

/** green / amber / red per watch by time worn in the past year (most-worn third green, least-worn third red). */
function wearTiers(list) {
  const rows = list.map((w) => ({ id: w.id, ms: wearPastYear(w.id).ms }));
  const out = {};
  if (!rows.some((r) => r.ms > 0)) { for (const r of rows) out[r.id] = 'none'; return out; }
  rows.sort((a, b) => b.ms - a.ms);
  const n = rows.length;
  rows.forEach((r, i) => {
    const rank = rows.findIndex((x) => x.ms === r.ms);      // ties share the better colour
    out[r.id] = r.ms <= 0 ? 'red' : n < 3 ? (rank === 0 ? 'green' : 'amber')
      : rank < n / 3 ? 'green' : rank >= (2 * n) / 3 ? 'red' : 'amber';
  });
  return out;
}

function wornText(id) {
  const { days, ms } = wearPastYear(id);
  if (!ms) return 'Not worn in the past year';
  if (ms < 86400000 && days <= 1) return `${Math.max(1, Math.round(ms / 3600000))} h worn · past year`;
  return `${days} day${days === 1 ? '' : 's'} worn · past year`;
}

// Tapping a watch presses it into its cushion (~200 ms, then a slight spring back) before its page opens.
const reducedMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
function pressOpen(node, w) {
  if (reducedMotion()) { openWatchDetail(w); return; }
  node.classList.remove('pressing'); void node.offsetWidth; node.classList.add('pressing');
  setTimeout(() => { node.classList.remove('pressing'); openWatchDetail(w); }, 200);
}

function slotEl(w, tier, dim = false) {
  const status = cardLines.map((f) => f(w)).find(Boolean);
  const model = [w.model, w.reference].filter(Boolean).join(' · ') || (w.brand ? w.name.replace(w.brand, '').trim() : '') || w.name;
  return el('button', { type: 'button', class: `slot tier-${tier}${dim ? ' dim' : ''}`, 'data-wid': w.id, onclick: (e) => pressOpen(e.currentTarget, w), 'aria-label': w.name },
    el('div', { class: 'slot-brand' }, w.brand || w.name),
    el('div', { class: 'slot-cushion' }, faceEl(w)),
    el('div', { class: 'slot-model' }, model),
    el('div', { class: 'slot-worn' }, wornText(w.id)),
    status ? el('div', { class: 'slot-status ' + (status.cls || '') }, status.text) : null);
}

function watchBox(all, shown, view, filtering, dimmed = null) {
  const tiers = wearTiers(all);
  const slots = Math.max(view.slots || DEFAULT_SLOTS, all.length);
  const inner = el('div', { class: 'wbox-lining' });
  for (const w of shown) inner.append(slotEl(w, tiers[w.id], dimmed && dimmed.has(w.id)));
  if (filtering && !shown.length) inner.append(el('p', { class: 'muted empty-note' }, 'No watches match your search.'));
  if (!filtering) {
    for (let i = all.length; i < slots; i++) {
      inner.append(el('button', { type: 'button', class: 'slot empty', onclick: () => addWatch('owned'), 'aria-label': 'Add a watch' },
        el('div', { class: 'slot-cushion' }, el('span', { class: 'slot-plus' }, '+')),
        el('div', { class: 'slot-worn' }, i === all.length ? 'Add a watch' : 'Empty slot')));
    }
  }
  const empties = slots - all.length;
  const ctl = el('div', { class: 'wbox-ctl' },
    el('button', { type: 'button', class: 'link-btn', onclick: () => { view.slots = slots + 2; store.save(); render(); } }, '+ Add 2 slots'),
    empties > 0 ? el('button', { type: 'button', class: 'link-btn', onclick: () => { view.slots = Math.max(all.length, slots - Math.min(2, empties)); store.save(); render(); } }, 'Remove empty slots') : null);
  const legend = all.some((w) => tiers[w.id] !== 'none')
    ? el('div', { class: 'wbox-legend' }, el('span', { class: 'muted' }, 'Past 12 months:'),
      el('span', {}, el('i', { class: 'tier-green' }), 'Most worn'), el('span', {}, el('i', { class: 'tier-amber' }), 'Between'), el('span', {}, el('i', { class: 'tier-red' }), 'Least worn'))
    : (all.length ? el('div', { class: 'wbox-legend muted' }, 'Log what you wear and the slots turn green, amber or red by how much each watch is worn.') : null);
  return el('div', { class: 'wbox-wrap' },
    el('div', { class: 'wbox' }, el('div', { class: 'wbox-lid' }), inner),
    legend, ctl);
}

export function render() {
  const box = root();
  if (!box) return;
  box.innerHTML = '';
  const data = d();
  const view = data.collectionView;
  if (isLocked()) {
    box.append(el('div', { class: 'locked-box' },
      el('div', { class: 'wbox locked' }, el('div', { class: 'wbox-lid' }), el('div', { class: 'wbox-lining' }, ...Array.from({ length: 6 }, () => el('div', { class: 'slot ghost' }, el('div', { class: 'slot-cushion' }))))),
      el('div', { class: 'locked-over' }, el('div', { class: 'locked-pad' }, '🔒'), el('div', { class: 'locked-t' }, 'Your Watch Box is locked'),
        el('button', { type: 'button', class: 'btn primary', onclick: padlockTapped }, 'Unlock'))));
    return;
  }
  const counts = { owned: 0, wishlist: 0, sold: 0 };
  for (const w of data.watches) counts[w.status || 'owned']++;

  for (const f of bannerHooks) { const b = f(); if (b) box.append(b); }

  const tabs = el('div', { class: 'seg seg3' }, [['owned', 'Owned'], ['wishlist', 'Wishlist'], ['sold', 'Sold']].map(([v, lab]) =>
    el('button', { type: 'button', class: 'seg-btn' + (view.tab === v ? ' active' : ''), onclick: () => { view.tab = v; store.save(); render(); } }, `${lab} (${counts[v]})`)));
  box.append(tabs);

  const owned = view.tab === 'owned';
  const list = data.watches.filter((w) => (w.status || 'owned') === view.tab);
  if (!SORTS.some(([v]) => v === view.sort)) view.sort = 'newest';

  const search = el('input', { type: 'search', class: 'input', placeholder: 'Search', value: view.q || '', 'aria-label': 'Search watches',
    oninput: (e) => { view.q = e.target.value; draw(); } });
  const sort = el('select', { class: 'input', 'aria-label': 'Sort', onchange: (e) => { view.sort = e.target.value; store.save(); draw(); } },
    SORTS.map(([v, lab]) => el('option', { value: v, selected: view.sort === v }, lab)));
  if (list.length) box.append(el('div', { class: 'coll-tools' }, search, sort), filterBar(view, () => render()));

  const addLabel = view.tab === 'wishlist' ? '+ Add to wishlist' : view.tab === 'sold' ? '+ Add a sold watch' : '+ Add a watch';
  box.append(el('button', { type: 'button', class: 'btn primary wide', onclick: () => addWatch(view.tab) }, addLabel));

  const area = el('div', {});
  box.append(area);
  function draw() {
    area.innerHTML = '';
    const q = (view.q || '').trim().toLowerCase();
    let shown = list;
    if (q) shown = list.filter((w) => [w.name, w.brand, w.model, w.reference, w.nickname, w.calibre].some((x) => x && String(x).toLowerCase().includes(q)));
    shown = sortList(shown, view.sort);
    const f = filtersOf(view);
    let dimmed = null;
    if (activeCount(f)) {
      if (f.hide) shown = shown.filter((w) => matchesFilters(w, f));
      else dimmed = new Set(shown.filter((w) => !matchesFilters(w, f)).map((w) => w.id));
    }
    if (owned) { area.append(watchBox(list, shown, view, !!q || (activeCount(f) > 0 && f.hide), dimmed)); return; }
    const grid = el('div', { class: 'watch-grid' });
    if (!shown.length) {
      grid.append(el('p', { class: 'muted empty-note' }, q ? 'No watches match your search.' :
        view.tab === 'wishlist' ? 'Nothing on your wishlist yet.' : 'No sold or traded watches yet.'));
    }
    for (const w of shown) { const c = watchCard(w); if (dimmed && dimmed.has(w.id)) c.classList.add('dim'); grid.append(c); }
    area.append(grid);
  }
  draw();

  if (owned) for (const f of boxSections) { const n = f(); if (n) box.append(n); }
  if (owned && list.length) box.append(summary(list));
}
// Other stages can add banners at the top of the Watch Box screen.
export const bannerHooks = [];

let visible = false;
export function initCollection() {
  const pad = document.getElementById('box-lock');
  const drawPad = () => { if (pad) { pad.textContent = isLocked() ? '🔒' : lockEnabled() ? '🔓' : '🔒'; pad.classList.toggle('off', !lockEnabled()); pad.setAttribute('aria-label', isLocked() ? 'Unlock Watch Box' : lockEnabled() ? 'Watch Box lock' : 'Set up a Watch Box lock'); } };
  if (pad) pad.addEventListener('click', padlockTapped);
  onLockChange(() => { drawPad(); if (visible) render(); });
  drawPad();
  store.on('watches', () => { if (visible) render(); });
  store.on('wear', () => { if (visible) render(); });
}
export function showCollection(sub) {
  visible = true; render();
  import('./detail.js').then((m) => {
    if (sub && getWatch(sub)) m.openPage(getWatch(sub));
    else if (!sub && m.pageOpenId() && !matchMedia('(min-width: 900px)').matches) m.closePage();
  });
}
export function hideCollection() { visible = false; }
