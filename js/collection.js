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
    { k: 'model', label: 'Model', half: true },
    { k: 'reference', label: 'Reference', half: true },
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
  { group: 'Functions', fields: [
    ...Object.entries(FEATURE_LABELS).map(([k, label]) => ({ k, label, type: 'check', half: true })),
    { k: 'chronometer', label: 'Chronometer certified', type: 'check', half: true },
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
  { group: 'Legacy', note: 'A private note of who you’d like this watch to go to. This is not a will or an official document — to make it legally binding, include it in your will with a solicitor.', fields: [
    { k: 'willStatus', label: 'Is this watch in your will?', type: 'select', options: [['yes', 'Yes'], ['no', 'No'], ['undecided', 'Not decided yet']] },
    { k: 'willTo', label: 'To be left to', ph: 'e.g. my son, James', showIf: (v) => v.willStatus !== 'no' },
    { k: 'willNote', label: 'Note for them (optional)', type: 'textarea', showIf: (v) => v.willStatus !== 'no' },
  ] },
  { group: 'Notes', fields: [
    { k: 'notes', label: 'Notes', type: 'textarea' },
  ] },
];

function fieldInput(f, w) {
  const v = w[f.k];
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
      const label = f.type === 'check'
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
    for (const g of FORM) for (const x of g.fields) { const n = form.querySelector(`[data-k="${x.k}"]`); if (n) vals[x.k] = n.type === 'checkbox' ? n.checked : n.value; }
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

/** Every stored photo a watch owns: face picture, gallery photos, insurance photos. */
export function allPhotoIds(w) {
  return [...new Set([w.face, ...(w.photos || []), ...Object.values(w.insPhotos || {})].filter(Boolean))];
}

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
  const feats = Object.keys(FEATURE_LABELS).filter((k) => w[k]).map((k) => FEATURE_LABELS[k]);
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

function openSaleQr(w) {
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

export function openWatchDetail(w) {
  const st = watchStats(w);
  const box = el('div', { class: 'detail' });
  if (w.face) {
    const f = faceEl(w, 'full', 'face-lg');
    f.addEventListener('click', () => openPhotoViewer([w.face, ...(w.photos || [])], 0));
    box.append(f);
    if (w.photos?.length) {
      box.append(el('div', { class: 'photo-row' }, w.photos.map((id, i) => {
        const t = el('img', { class: 'thumb', alt: 'Watch photo', onclick: () => openPhotoViewer([w.face, ...w.photos], i + 1) });
        fillImg(t, id);
        return t;
      })));
    }
  } else if (w.photos?.length) {
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
    fact('Year made', w.year),
    fact('Beat rate', w.bph ? `${Number(w.bph).toLocaleString('en-GB')} bph` : null),
    fact('Jewels', w.jewels),
    fact('Functions', Object.keys(FEATURE_LABELS).filter((k) => w[k]).map((k) => FEATURE_LABELS[k]).join(', ') || null),
    fact('Chronometer', w.chronometer ? 'Certified' : null),
    fact('Power reserve', w.powerReserve ? `${w.powerReserve} h` : null),
    fact('Case size', w.caseSize ? `${w.caseSize} mm` : null),
    fact('Lug width', w.lugWidth ? `${w.lugWidth} mm` : null),
    fact('Water resistance', w.waterResistance),
    fact('Strap', w.strap),
    fact('Bought', [w.purchaseDate ? new Date(w.purchaseDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null,
      w.sellerType === 'private' ? 'Private seller' : w.boughtFrom, w.sellerType && w.sellerType !== 'private' ? (SELLER_TYPES.find((x) => x[0] === w.sellerType) || [])[1] : null].filter(Boolean).join(' · ')),
    fact('Shop address', ['ad', 'jeweller'].includes(w.sellerType) ? w.sellerAddress : null),
    fact('Shop contact', ['ad', 'jeweller'].includes(w.sellerType) ? w.sellerContact : null),
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
    fact('In your will', w.willStatus ? { yes: 'Yes', no: 'No', undecided: 'Not decided yet' }[w.willStatus] : null),
    fact('To be left to', w.willStatus !== 'no' ? w.willTo : null),
    serialFact,
    ...(detailExtras.map((f) => f(w))),
  ));
  for (const f of detailSections) { const n = f(w); if (n) box.append(n); }
  if (w.notes) box.append(el('h3', { class: 'sub-title' }, 'Notes'), el('p', { class: 'notes' }, w.notes));
  if (w.status === 'owned') box.append(el('button', { type: 'button', class: 'btn wide sale-btn', onclick: () => { document.getElementById('modal').close(); setTimeout(() => openSaleQr(w), 0); } }, '🏷️ For-sale QR code'));

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
  const pid = w.face || w.photos?.[0];
  if (pid) { const i = el('img', { alt: w.name, loading: 'lazy' }); fillImg(i, pid); img.append(i); }
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

function slotEl(w, tier) {
  const status = cardLines.map((f) => f(w)).find(Boolean);
  const model = [w.model, w.reference].filter(Boolean).join(' · ') || (w.brand ? w.name.replace(w.brand, '').trim() : '') || w.name;
  return el('button', { type: 'button', class: `slot tier-${tier}`, onclick: () => openWatchDetail(w), 'aria-label': w.name },
    el('div', { class: 'slot-brand' }, w.brand || w.name),
    el('div', { class: 'slot-cushion' }, faceEl(w)),
    el('div', { class: 'slot-model' }, model),
    el('div', { class: 'slot-worn' }, wornText(w.id)),
    status ? el('div', { class: 'slot-status ' + (status.cls || '') }, status.text) : null);
}

function watchBox(all, shown, view, filtering) {
  const tiers = wearTiers(all);
  const slots = Math.max(view.slots || DEFAULT_SLOTS, all.length);
  const inner = el('div', { class: 'wbox-lining' });
  for (const w of shown) inner.append(slotEl(w, tiers[w.id]));
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
  const counts = { owned: 0, wishlist: 0, sold: 0 };
  for (const w of data.watches) counts[w.status || 'owned']++;

  for (const f of bannerHooks) { const b = f(); if (b) box.append(b); }

  const tabs = el('div', { class: 'seg seg3' }, [['owned', 'Owned'], ['wishlist', 'Wishlist'], ['sold', 'Sold']].map(([v, lab]) =>
    el('button', { type: 'button', class: 'seg-btn' + (view.tab === v ? ' active' : ''), onclick: () => { view.tab = v; store.save(); render(); } }, `${lab} (${counts[v]})`)));
  box.append(tabs);

  const owned = view.tab === 'owned';
  const list = data.watches.filter((w) => (w.status || 'owned') === view.tab);

  const search = el('input', { type: 'search', class: 'input', placeholder: 'Search', value: view.q || '', 'aria-label': 'Search watches',
    oninput: (e) => { view.q = e.target.value; draw(); } });
  const sort = el('select', { class: 'input', 'aria-label': 'Sort', onchange: (e) => { view.sort = e.target.value; store.save(); draw(); } },
    SORTS.map(([v, lab]) => el('option', { value: v, selected: view.sort === v }, lab)));
  if (list.length) box.append(el('div', { class: 'coll-tools' }, search, sort));

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
    if (owned) { area.append(watchBox(list, shown, view, !!q)); return; }
    const grid = el('div', { class: 'watch-grid' });
    if (!shown.length) {
      grid.append(el('p', { class: 'muted empty-note' }, q ? 'No watches match your search.' :
        view.tab === 'wishlist' ? 'Nothing on your wishlist yet.' : 'No sold or traded watches yet.'));
    }
    for (const w of shown) grid.append(watchCard(w));
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
  store.on('watches', () => { if (visible) render(); });
  store.on('wear', () => { if (visible) render(); });
}
export function showCollection() { visible = true; render(); }
export function hideCollection() { visible = false; }
