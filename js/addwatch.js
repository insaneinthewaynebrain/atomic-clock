// Add-a-watch journey:
//   1. camera + film-style dial scan (camera.js, dialscan.js)
//   2. "Which watch is it?" — brand (dropdown or add a brand), reference (or "I don't know"), a name, year (or "I don't know")
//   3. look-up: built-in reference list + Wikipedia, cross-checked with what the scan read; Chrono24 for prices
//   4. the full form, pre-filled, for the person to check and save.
import * as store from './store.js';
import { el, openModal, toast } from './ui.js';
import { addPhoto, deletePhoto } from './photos.js';
import { captureFace } from './camera.js';
import { lookupReference, wikiSummary, chrono24Url, FEATURE_LABELS } from './watchdb.js';
import { openWatchEditor, allBrands, movementLabel } from './collection.js';

const scanner = () => import('./dialscan.js');

const LABELS = {
  brand: 'Brand', model: 'Model', reference: 'Reference', calibre: 'Movement (calibre)', movement: 'Movement type', jewels: 'Jewels',
  bph: 'Beat rate', powerReserve: 'Power reserve', caseSize: 'Case size', lugWidth: 'Lug width', waterResistance: 'Water resistance',
  chronometer: 'Chronometer', madeYears: 'Made', ...FEATURE_LABELS,
};
function show(k, v) {
  if (v === true) return 'Yes';
  if (v === false) return 'No';
  if (k === 'movement') return movementLabel(v) || v;
  if (k === 'bph') return `${Number(v).toLocaleString('en-GB')} bph`;
  if (k === 'powerReserve') return `${v} h`;
  if (k === 'caseSize' || k === 'lugWidth') return `${v} mm`;
  return String(v);
}

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
  const chips = guessed && scan.guesses.length > 1
    ? el('div', { class: 'guess-row' }, el('span', { class: 'muted small' }, `Read “${scan.guesses[0].from}” — could be:`),
      scan.guesses.map((g) => el('button', { type: 'button', class: 'chip', onclick: () => pickBrand(g.brand) }, g.brand)))
    : null;

  const refIn = el('input', { class: 'input', type: 'text', value: a.reference || '', placeholder: 'e.g. SKX007, 126610LN', autocapitalize: 'characters', spellcheck: false });
  const refUnknown = el('input', { type: 'checkbox', class: 'check', checked: !!a.refUnknown });
  const nameIn = el('input', { class: 'input', type: 'text', value: a.name ?? (sf.model || ''), placeholder: 'e.g. Submariner, “Dad’s Seiko”', autocapitalize: 'words' });
  const yearSel = el('select', { class: 'input' }, el('option', { value: '' }, 'Choose a year…'), el('option', { value: 'unknown', selected: a.year === 'unknown' }, 'I don’t know'),
    Array.from({ length: new Date().getFullYear() - 1899 }, (_, i) => new Date().getFullYear() - i).map((y) => el('option', { value: String(y), selected: String(a.year) === String(y) }, y)));
  const syncRef = () => { refIn.disabled = refUnknown.checked; if (refUnknown.checked) refIn.value = ''; };
  refUnknown.addEventListener('change', syncRef); syncRef();

  const read = () => ({
    brand: brandSel.value === '__add' ? brandNew.value.trim() : brandSel.value,
    reference: refIn.value.trim(), refUnknown: refUnknown.checked, name: nameIn.value.trim(), year: yearSel.value,
  });

  const content = [];
  if (scan?.found?.length) {
    content.push(el('div', { class: 'scan-summary' }, el('span', { class: 'tag-read' }, 'From the dial'),
      ' ', scan.found.map(([k, v]) => `${v}`).join(' · ')));
  }
  content.push(
    el('label', { class: 'field' }, el('span', {}, 'Brand ', brandTag), brandSel, brandNew), chips,
    el('label', { class: 'field' }, el('span', {}, 'Model reference'), refIn),
    el('label', { class: 'field check-field' }, refUnknown, el('span', {}, 'I don’t know the reference')),
    el('p', { class: 'muted small' }, 'The reference is the best way to find the details. It’s usually on the case back, the papers or the warranty card, or engraved between the lugs.'),
    el('label', { class: 'field' }, el('span', {}, 'Name (if there’s no reference, or you’d like your own)'), nameIn),
    el('label', { class: 'field' }, el('span', {}, 'Year made'), yearSel),
    el('p', { class: 'muted small' }, 'The year helps tell apart versions of the same reference that changed over time.'));

  openModal({
    title: 'Which watch is it?', className: 'tall', content,
    actions: [
      { label: 'Skip', onClick: () => { done = true; Object.assign(a, read()); setTimeout(() => toEditor(ctx, null), 0); } },
      { label: 'Find details', kind: 'primary', onClick: () => {
        const v = read();
        if (!v.brand && !v.reference && !v.name) { toast('Choose a brand, or enter a reference or name'); return false; }
        if (brandSel.value === '__add' && !v.brand) { toast('Type the new brand name'); brandNew.focus(); return false; }
        done = true; Object.assign(a, v);
        setTimeout(() => findDetails(ctx), 0);
      } },
    ],
    onClose: () => { if (!done) cancelAdd(ctx); },
  });
}

function cancelAdd(ctx) {
  if (ctx.face) deletePhoto(ctx.face.id).catch(() => {});
  toast('Watch not added');
}

/* ---------- Step 3: look it up and cross-check ---------- */
async function findDetails(ctx) {
  const a = ctx.answers;
  const sf = ctx.scan?.fields || {};
  let closedEarly = false;   // any close of this modal is the person cancelling (moving on replaces it without closing)
  openModal({ title: 'Finding details…', content: el('div', { class: 'finding' }, el('div', { class: 'spinner' }),
    el('p', { class: 'muted' }, 'Checking the reference list and Wikipedia…')),
  actions: [{ label: 'Cancel' }], onClose: () => { closedEarly = true; cancelAdd(ctx); } });

  const year = /^\d{4}$/.test(a.year) ? Number(a.year) : null;
  const look = lookupReference({ reference: a.refUnknown ? '' : a.reference, year, calibre: sf.calibre });
  const query = [look.fields.brand || a.brand, look.fields.model || a.name || a.reference].filter(Boolean).join(' ');
  const wiki = query ? await Promise.race([wikiSummary(query), new Promise((r) => setTimeout(() => r(null), 6000))]) : null;
  if (closedEarly) return;

  // Cross-check: the reference list wins over the dial; say what it confirmed or corrected.
  const merged = { ...sf };
  const rows = [];
  const keys = [...new Set([...Object.keys(sf), ...Object.keys(look.fields)])].filter((k) => LABELS[k]);
  for (const k of keys) {
    const s = sf[k], l = look.fields[k];
    if (l === false && s === undefined) continue;                 // don't list every function the watch hasn't got
    if (l !== undefined) merged[k] = l;
    let src;
    if (s !== undefined && l !== undefined) src = String(s) === String(l) ? ['ok', 'Dial ✓ list'] : ['fix', `Corrected (dial read ${show(k, s)})`];
    else if (l !== undefined) src = ['list', 'Reference list'];
    else src = ['dial', 'Dial'];
    rows.push([k, merged[k], src]);
  }
  // The person's own choice of brand always beats what the dial seemed to say (the dial reading is only a guess);
  // the reference list only overrides it when it knows this exact reference.
  const brandRow = rows.findIndex(([k]) => k === 'brand');
  if (brandRow >= 0) rows.splice(brandRow, 1);
  const brand = look.fields.brand || a.brand || sf.brand || null;
  if (brand) {
    const src = look.fields.brand
      ? (a.brand && a.brand !== look.fields.brand ? ['fix', `Corrected by the reference (you chose ${a.brand})`] : ['list', 'Reference list'])
      : a.brand ? (sf.brand && sf.brand !== a.brand ? ['ok', `Your choice (dial guessed ${sf.brand})`] : ['ok', sf.brand ? 'Your choice ✓ dial' : 'Your choice']) : ['dial', 'Dial'];
    rows.unshift(['brand', brand, src]);
  }
  merged.brand = brand;
  if (!a.refUnknown && a.reference) merged.reference = a.reference;
  if (year) merged.year = year;
  const ownName = a.name && a.name !== sf.model ? a.name : null;      // typed by the person, not just the family read off the dial
  merged.model = look.fields.model || a.name || sf.model || null;
  if (ownName) merged.name = ownName.toLowerCase().startsWith(String(merged.brand || '').toLowerCase()) ? ownName : [merged.brand, ownName].filter(Boolean).join(' ');
  delete merged.madeYears;

  const body = [];
  if (a.year === 'unknown' || !a.year) body.push(el('div', { class: 'notice warn' }, el('b', {}, 'Year not known. '), 'The details below are for this reference in general — please check they’re correct for your watch.'));
  if (a.refUnknown || !a.reference) body.push(el('div', { class: 'notice' }, el('b', {}, 'No reference. '), 'You can enter the details yourself on the next screen. Anything read from the dial is already filled in.'));
  else if (!look.key) body.push(el('div', { class: 'notice' }, el('b', {}, `${a.reference} isn’t in the app’s reference list yet. `), 'Check Wikipedia or Chrono24 below and fill in the rest on the next screen.'));
  for (const n of look.notes) body.push(el('div', { class: 'notice warn' }, n));
  if (rows.length) {
    body.push(el('div', { class: 'facts found-list' }, rows.map(([k, v, [cls, src]]) => el('div', { class: 'fact' },
      el('span', { class: 'fact-k' }, LABELS[k]),
      el('span', { class: 'fact-v' }, show(k, v), el('small', { class: 'src src-' + cls }, src))))));
  } else body.push(el('p', { class: 'muted' }, 'Nothing could be filled in automatically.'));
  if (look.fields.madeYears) body.push(el('p', { class: 'muted small' }, `This reference was made ${look.fields.madeYears}.`));
  if (wiki) {
    body.push(el('div', { class: 'wiki' }, el('div', { class: 'wiki-t' }, 'Wikipedia: ', wiki.title),
      el('p', {}, wiki.text.length > 420 ? wiki.text.slice(0, 400).replace(/\s\S*$/, '') + '…' : wiki.text),
      wiki.url ? el('a', { href: wiki.url, target: '_blank', rel: 'noopener' }, 'Read more ↗') : null));
  }
  const c24q = [merged.brand, merged.reference || merged.model].filter(Boolean).join(' ');
  if (c24q) {
    body.push(el('a', { class: 'btn wide c24-btn', href: chrono24Url(c24q, store.get().money || 'GBP'), target: '_blank', rel: 'noopener' }, 'See current prices on Chrono24 ↗'),
      el('p', { class: 'muted small' }, 'Chrono24 doesn’t let other apps read its prices, so this opens its search for your watch in your country. Pop the typical price into “Estimated value”.'));
  }
  body.push(el('p', { class: 'muted small' }, 'Details come from the app’s built-in reference list and what was read from the dial — always worth a quick check.'));

  let moved = false;
  openModal({
    title: 'What we found', className: 'tall', content: body,
    actions: [
      { label: '‹ Back', onClick: () => { moved = true; setTimeout(() => identify(ctx), 0); } },
      { label: 'Continue', kind: 'primary', onClick: () => { moved = true; setTimeout(() => toEditor(ctx, merged, rows.length), 0); } },
    ],
    onClose: () => { if (!moved) cancelAdd(ctx); },
  });
}

/* ---------- Step 4: the full form ---------- */
function toEditor(ctx, merged, nFound = 0) {
  const a = ctx.answers;
  const prefill = merged ? { ...merged } : {
    ...(ctx.scan?.fields || {}),
    brand: a.brand || ctx.scan?.fields?.brand || null,
    reference: a.refUnknown ? null : a.reference || null,
    model: a.name || ctx.scan?.fields?.model || null,
    year: /^\d{4}$/.test(a.year || '') ? Number(a.year) : null,
  };
  for (const k of Object.keys(prefill)) if (prefill[k] == null || prefill[k] === '') delete prefill[k];
  const banner = merged
    ? el('div', { class: 'notice' + (a.year === 'unknown' || !a.year ? ' warn' : '') }, nFound ? `${nFound} detail${nFound === 1 ? '' : 's'} filled in for you. ` : '',
      a.year === 'unknown' || !a.year ? 'Year not known — please check the details are correct.' : 'Please check everything is right, then add anything else you know.')
    : null;
  openWatchEditor(null, { status: ctx.status, face: ctx.face, prefill, banner });
}
