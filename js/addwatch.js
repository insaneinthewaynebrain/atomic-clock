// Add-a-watch journey:
//   1. camera + film-style dial scan (camera.js, dialscan.js) — the only automatic part
//   2. "Which watch is it?" — brand (dropdown or add a brand), model by reference or by name, year (or not sure)
//   3. the full form, pre-filled with what the dial read and the answers above, for the person to complete and save.
import { el, openModal, toast } from './ui.js';
import { addPhoto, deletePhoto } from './photos.js';
import { captureFace } from './camera.js';
import { openWatchEditor, allBrands } from './collection.js';

const scanner = () => import('./dialscan.js');

export async function addWatch(status = 'owned') {
  scanner().then((m) => m.warmUp()).catch(() => {});      // start fetching the dial reader while the camera opens
  const res = await captureFace({
    title: 'Add a watch', allowSkip: true,
    scan: (blob, onWord) => scanner().then((m) => m.scanDial(blob, onWord)),
  });
  if (!res) return;
  let face = null;
  if (res.blob) {
    try { face = { id: await addPhoto(res.blob), shape: res.shape }; }
    catch (e) { toast(e.message || 'Could not save the picture'); }
  }
  identify({ status, face, scan: res.scan || null, answers: {} });
}

/* ---------- Step 2: which watch is it? ---------- */
function identify(ctx) {
  const { scan } = ctx;
  const a = ctx.answers;
  const sf = scan?.fields || {};
  let done = false;

  const brands = allBrands();
  const startBrand = a.brand ?? sf.brand ?? '';
  if (startBrand && !brands.includes(startBrand)) brands.unshift(startBrand);
  const brandSel = el('select', { class: 'input' }, el('option', { value: '' }, 'Choose a brand…'),
    brands.map((b) => el('option', { value: b, selected: b === startBrand }, b)), el('option', { value: '__add' }, '＋ Add a brand…'));
  const brandNew = el('input', { class: 'input brand-new', type: 'text', placeholder: 'Brand name', autocapitalize: 'words', hidden: true });
  brandSel.addEventListener('change', () => { brandNew.hidden = brandSel.value !== '__add'; if (!brandNew.hidden) brandNew.focus(); });
  const guessed = !!scan?.guesses?.length && !scan.found?.some(([k]) => k === 'Brand');
  const brandTag = sf.brand && startBrand === sf.brand ? el('span', { class: 'tag-read' + (guessed ? ' guess' : '') }, guessed ? 'best guess from the dial' : 'read from the dial') : null;
  // Other brands the dial fragment could be: tap one to choose it.
  const pickBrand = (b) => {
    if (![...brandSel.options].some((o) => o.value === b)) brandSel.insertBefore(el('option', { value: b }, b), brandSel.options[1]);
    brandSel.value = b; brandNew.hidden = true;
    if (brandTag) brandTag.hidden = b !== sf.brand;
  };
  const others = guessed ? scan.guesses.filter((g) => g.brand !== startBrand).slice(0, 3) : [];
  const chips = others.length
    ? el('div', { class: 'guess-row' }, el('span', { class: 'muted small' }, 'Or could be:'),
      others.map((g) => el('button', { type: 'button', class: 'chip', onclick: () => pickBrand(g.brand) }, g.brand)))
    : null;

  // ② Model: by reference (best for finding details) or by a name — one box, switched by a two-way choice.
  let mode = a.refUnknown || (!a.reference && a.name) ? 'name' : 'ref';
  const refIn = el('input', { class: 'input', type: 'text', value: a.reference || '', placeholder: 'e.g. SKX007, 126610LN', autocapitalize: 'characters', spellcheck: false, 'aria-label': 'Model reference' });
  const nameIn = el('input', { class: 'input', type: 'text', value: a.name ?? (sf.model || ''), placeholder: 'e.g. Submariner, “Dad’s Seiko”', autocapitalize: 'words', 'aria-label': 'Name' });
  const modelHint = el('p', { class: 'muted small id-hint' });
  const modeBtns = [['ref', 'Reference'], ['name', 'Name']].map(([v, lab]) => {
    const b = el('button', { type: 'button', class: 'seg-btn', onclick: () => { mode = v; syncMode(); (v === 'ref' ? refIn : nameIn).focus(); } }, lab);
    b.dataset.v = v; return b;
  });
  function syncMode() {
    modeBtns.forEach((b) => b.classList.toggle('active', b.dataset.v === mode));
    refIn.hidden = mode !== 'ref'; nameIn.hidden = mode !== 'name';
    modelHint.textContent = mode === 'ref'
      ? 'It’s on the case back, the papers or warranty card, or engraved between the lugs.'
      : 'No reference, or don’t know it? Give the watch a name instead.';
  }
  syncMode();

  // ③ Year made — or "Not sure".
  const yearSel = el('select', { class: 'input', 'aria-label': 'Year made' }, el('option', { value: '' }, 'Choose a year…'),
    Array.from({ length: new Date().getFullYear() - 1899 }, (_, i) => new Date().getFullYear() - i).map((y) => el('option', { value: String(y), selected: String(a.year) === String(y) }, y)));
  let notSure = a.year === 'unknown';
  const notSureBtn = el('button', { type: 'button', class: 'chip id-notsure', onclick: () => { notSure = !notSure; syncYear(); } }, 'Not sure');
  function syncYear() { notSureBtn.classList.toggle('on', notSure); yearSel.disabled = notSure; if (notSure) yearSel.value = ''; }
  yearSel.addEventListener('change', () => { if (yearSel.value) { notSure = false; syncYear(); } });
  syncYear();

  const read = () => ({
    brand: brandSel.value === '__add' ? brandNew.value.trim() : brandSel.value,
    reference: mode === 'ref' ? refIn.value.trim() : '', refUnknown: mode === 'name',
    name: mode === 'name' ? nameIn.value.trim() : '', year: notSure ? 'unknown' : yearSel.value,
  });

  const step = (n, title, ...body) => el('section', { class: 'id-step' }, el('div', { class: 'id-num' }, n),
    el('div', { class: 'id-body' }, el('div', { class: 'id-title' }, title), ...body));
  const content = [];
  if (scan?.found?.length) {
    content.push(el('div', { class: 'scan-summary' }, el('span', { class: 'tag-read' }, 'From the dial'),
      ' ', scan.found.map(([k, v]) => `${v}`).join(' · ')));
  }
  content.push(
    step('1', ['Brand ', brandTag], brandSel, brandNew, chips),
    step('2', 'Model', el('div', { class: 'seg id-seg' }, modeBtns), refIn, nameIn, modelHint),
    step('3', 'Year made', el('div', { class: 'id-year' }, yearSel, notSureBtn)));

  openModal({
    title: 'Which watch is it?', className: 'tall', content,
    actions: [
      { label: 'Cancel' },
      { label: 'Continue', kind: 'primary', onClick: () => {
        const v = read();
        if (brandSel.value === '__add' && !v.brand) { toast('Type the new brand name'); brandNew.focus(); return false; }
        done = true; Object.assign(a, v);
        setTimeout(() => toEditor(ctx), 0);
      } },
    ],
    onClose: () => { if (!done) cancelAdd(ctx); },
  });
}

function cancelAdd(ctx) {
  if (ctx.face) deletePhoto(ctx.face.id).catch(() => {});
  toast('Watch not added');
}

/* ---------- Step 3: the full form ---------- */
function toEditor(ctx) {
  const a = ctx.answers;
  const sf = ctx.scan?.fields || {};
  const own = a.name && a.name !== sf.model ? a.name : null;           // a name the person typed, not just a family read off the dial
  const prefill = {
    ...sf,                                                               // what the dial read: movement, jewels, depth, functions…
    brand: a.brand || sf.brand || null,
    reference: a.refUnknown ? null : a.reference || null,
    model: a.name || sf.model || null,
    year: /^\d{4}$/.test(a.year || '') ? Number(a.year) : null,
  };
  if (own && prefill.brand && !own.toLowerCase().startsWith(prefill.brand.toLowerCase())) prefill.name = `${prefill.brand} ${own}`;
  else if (own) prefill.name = own;
  for (const k of Object.keys(prefill)) if (prefill[k] == null || prefill[k] === '') delete prefill[k];
  const fromDial = Object.keys(sf).filter((k) => sf[k] != null && sf[k] !== false).length;
  const banner = fromDial
    ? el('div', { class: 'notice' }, `${fromDial} detail${fromDial === 1 ? '' : 's'} filled in from the dial. Please check them, then add anything else you know.`)
    : null;
  openWatchEditor(null, { status: ctx.status, face: ctx.face, prefill, banner });
}
