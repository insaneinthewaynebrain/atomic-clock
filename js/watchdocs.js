// Per-watch documents: the insurance photo checklist, the insurance PDF and the "memory book" PDF.
// The PDFs are printable pages (Print → Save as PDF, or share the file), built on the phone; nothing is uploaded.
import * as store from './store.js';
import { el, confirmModal, toast } from './ui.js';
import { addPhoto, deletePhoto, fillImg, photoDataUrl } from './photos.js';
import { detailSections, money, movementLabel, subtitle, SELLER_TYPES, openPhotoViewer, daysWorn, getWatch } from './collection.js';
import { featuresOf, featureLabel } from './model.js';
import { watchStats, fmtRate } from './accuracy.js';
import { showPrintView } from './insurance.js';
import { APP_NAME } from './config.js';

/**
 * Insurance photos, following common insurer and appraiser guidance: the watch from every side, the serial and
 * reference numbers close up, the clasp, a shot for scale, a wrist shot as proof of ownership, any marks, and the
 * box, papers, receipt and valuation if you have them.
 */
export const INS_SLOTS = [
  ['front', 'Front (dial)', 'Straight on, dial in focus, no glare', true],
  ['back', 'Case back', 'The whole back, engravings readable', true],
  ['crownSide', 'Crown side', 'Side on, showing the crown', true],
  ['leftSide', 'Left side', 'The 9 o’clock side of the case', true],
  ['clasp', 'Clasp & bracelet', 'Clasp open or closed, any engravings', true],
  ['serial', 'Serial number', 'Close-up (case back, between the lugs or on the rehaut)', true],
  ['reference', 'Reference number', 'Close-up, between the lugs or on the case back', false],
  ['scale', 'Size (with a ruler)', 'Next to a ruler or coin for scale', false],
  ['wrist', 'On your wrist', 'Helps show it’s yours', false],
  ['marks', 'Marks or damage', 'Any scratches, dents or repairs', false],
  ['box', 'Box', 'Inner and outer box', false],
  ['papers', 'Papers / warranty card', 'Card with the serial number', false],
  ['receipt', 'Receipt / invoice', 'Shows price, date and where bought', false],
  ['valuation', 'Valuation', 'A recent appraisal, if you have one', false],
];

/** Other features can add photo galleries to the memory book: { title, photos(w) → ids, captions?(w) → texts, notes?(w) → text }. */
export const memoryGalleries = [];

const d = () => store.get();
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtD = (s) => (s ? new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
const fileName = (w, kind) => `${(w.name || 'watch').replace(/[^\w-]+/g, '-').replace(/-+/g, '-')}-${kind}-${new Date().toISOString().slice(0, 10)}.html`;

/* ---------- The checklist on the watch's page ---------- */
export function insSection(w, { docButtons = true } = {}) {
  if ((w.status || 'owned') !== 'owned') return null;
  const box = el('div', { class: 'ins-sec' });
  const fileIn = el('input', { type: 'file', accept: 'image/*', hidden: true });
  let slotFor = null;
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files && fileIn.files[0];
    fileIn.value = '';
    if (!f || !slotFor) return;
    try {
      toast('Adding photo…', 1200);
      const id = await addPhoto(f);
      const live = getWatch(w.id) || w;
      const old = live.insPhotos?.[slotFor];
      live.insPhotos = { ...(live.insPhotos || {}), [slotFor]: id };
      const insG = (live.galleryList || []).find((g) => g.id === 'insurance');
      if (insG) { insG.photoIds = insG.photoIds.filter((x) => x !== old); insG.photoIds.push(id); }
      (live.photoMeta ||= {})[id] = { taken: Date.now(), note: (INS_SLOTS.find((x) => x[0] === slotFor) || [])[1] || '' };
      if (old) deletePhoto(old).catch(() => {});
      store.save();
      draw();
    } catch (e) { toast(e.message || 'Could not add that photo'); }
  });
  const pick = (k) => { slotFor = k; fileIn.click(); };
  // The document view can't sit above an open pop-up: close the watch's page while it shows, reopen it after.
  const openDoc = (make) => {
    const live = getWatch(w.id) || w;
    document.getElementById('modal').close();
    make(live, () => import('./collection.js').then((m) => { const fresh = getWatch(w.id); if (fresh) m.openWatchDetail(fresh); }));
  };

  function draw() {
    const ins = (getWatch(w.id) || w).insPhotos || {};
    const essentials = INS_SLOTS.filter((x) => x[3]);
    const done = essentials.filter(([k]) => ins[k]).length;
    box.replaceChildren(
      el('h3', { class: 'sub-title' }, 'Insurance photos'),
      el('p', { class: 'muted small' }, `${done} of ${essentials.length} essentials · tap a box to add a photo. Insurers usually want these; box, papers and receipt help too.`),
      el('div', { class: 'ins-grid' }, INS_SLOTS.map(([k, label, tip, must]) => {
        const id = ins[k];
        const tile = el('div', { class: 'ins-tile' + (id ? ' has' : '') });
        if (id) {
          const img = el('img', { alt: label, onclick: () => openPhotoViewer(INS_SLOTS.map((x) => ins[x[0]]).filter(Boolean), INS_SLOTS.filter((x) => ins[x[0]]).findIndex((x) => x[0] === k)) });
          fillImg(img, id);
          tile.append(img,
            el('button', { type: 'button', class: 'ins-x', 'aria-label': `Remove ${label}`, onclick: async () => {
              const yes = await confirmModal(`Remove the ${label.toLowerCase()} photo?`, '', 'Remove', true);
              const live = getWatch(w.id) || w;
              if (yes) {
                const { [k]: gone, ...rest } = live.insPhotos || {};
                live.insPhotos = rest; store.save();
                if (gone) {
                  deletePhoto(gone).catch(() => {});
                  const insG = (live.galleryList || []).find((g) => g.id === 'insurance');
                  if (insG) insG.photoIds = insG.photoIds.filter((x) => x !== gone);
                  store.save();
                }
              }
              draw();
            } }, '×'));
        } else {
          tile.append(el('button', { type: 'button', class: 'ins-add', onclick: () => pick(k), title: tip }, el('span', { class: 'ins-plus' }, '＋'), el('span', { class: 'small muted' }, tip)));
        }
        tile.append(el('div', { class: 'ins-label' }, label, must ? null : el('span', { class: 'muted' }, ' · optional')));
        if (id) tile.append(el('button', { type: 'button', class: 'link-btn ins-replace', onclick: () => pick(k) }, 'Replace'));
        return tile;
      })),
      docButtons ? el('div', { class: 'doc-btns' },
        el('button', { type: 'button', class: 'btn', onclick: () => openDoc(insurancePdf) }, '📄 Insurance PDF'),
        el('button', { type: 'button', class: 'btn', onclick: () => openDoc(memoryBook) }, '📖 Memory book PDF')) : null,
      fileIn);
  }
  draw();
  return box;
}

/* ---------- Shared bits for both PDFs ---------- */
const CSS = `
  body { font: 12px/1.45 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #111; background: #fff; margin: 24px; }
  h1 { font-size: 22px; margin: 0 0 2px; } h2 { font-size: 15px; margin: 22px 0 8px; padding-bottom: 4px; border-bottom: 2px solid #111; }
  .sub { color: #555; margin: 0 0 12px; }
  .disc { border: 1px solid #c9a227; background: #fff8e1; border-radius: 6px; padding: 8px 10px; font-size: 11px; margin: 10px 0 14px; }
  table.kv { width: 100%; border-collapse: collapse; } .kv td { padding: 5px 6px; border-bottom: 1px solid #e3e3e3; vertical-align: top; }
  .kv td:first-child { color: #555; width: 38%; }
  .hero { display: flex; gap: 18px; align-items: center; margin: 8px 0 6px; }
  .hero img { width: 170px; height: 170px; object-fit: cover; border-radius: 50%; box-shadow: 0 2px 10px rgba(0,0,0,.25); flex: none; }
  .hero img.sq { border-radius: 16px; } .hero img.cut { object-fit: contain; border-radius: 0; box-shadow: none; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .grid figure { margin: 0; page-break-inside: avoid; } .grid img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 6px; border: 1px solid #ddd; display: block; }
  .grid figcaption { font-size: 10.5px; color: #444; margin-top: 3px; }
  .missing { color: #8a5a00; font-size: 11px; }
  .notes { white-space: pre-wrap; }
  .foot { margin-top: 20px; color: #666; font-size: 10.5px; }
  .cover { text-align: center; padding: 30px 0 10px; } .cover img { width: 300px; height: 300px; object-fit: cover; border-radius: 50%; box-shadow: 0 4px 18px rgba(0,0,0,.3); }
  .cover h1 { font-size: 28px; margin-top: 18px; } .cover .sub { font-size: 14px; }
  .pb { page-break-before: always; }
  @media screen and (max-width: 640px) { body { margin: 12px; } .grid { grid-template-columns: repeat(2, 1fr); } .hero { flex-direction: column; } .cover img { width: 220px; height: 220px; } }
`;
const page = (title, body) => `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head><body>${body}</body></html>`;
const row = (k, v) => (v == null || v === '' || v === false ? '' : `<tr><td>${esc(k)}</td><td>${esc(v === true ? 'Yes' : v)}</td></tr>`);
const facePic = async (w, cls = '') => {
  const id = w.face || w.photos?.[0];
  const src = id ? await photoDataUrl(id, 'full') : null;
  const shape = w.face ? (w.faceShape === 'square' || w.faceShape === 'rect' ? 'sq' : w.faceShape === 'cutout' ? 'cut' : '') : '';
  return src ? `<img class="${shape} ${cls}" src="${src}" alt="">` : '';
};

function detailRows(w, { serial = true } = {}) {
  const feats = featuresOf(w).map((id) => featureLabel(d(), id)).join(', ');
  const seller = w.sellerType === 'private' ? 'Private seller' : [w.boughtFrom, (SELLER_TYPES.find((x) => x[0] === w.sellerType) || [])[1]].filter(Boolean).join(' · ');
  return [
    row('Brand', w.brand), row('Model', w.model), row('Reference', w.reference), row('Nickname', w.nickname), row('Year made', w.year),
    serial ? row('Serial number', w.serial) : '',
    row('Movement', [movementLabel(w.movement), w.calibre].filter(Boolean).join(' · ')),
    row('Beat rate', w.bph ? `${Number(w.bph).toLocaleString('en-GB')} bph` : null), row('Jewels', w.jewels),
    row('Power reserve', w.powerReserve ? `${w.powerReserve} hours` : null), row('Functions', feats || null), row('Chronometer', w.chronometer ? 'Certified' : null),
    row('Case size', w.caseSize ? `${w.caseSize} mm` : null), row('Lug width', w.lugWidth ? `${w.lugWidth} mm` : null),
    row('Water resistance', w.waterResistance), row('Strap / bracelet', w.strap), row('Condition', w.condition),
    row('Box and papers', [w.box ? 'Box' : '', w.papers ? 'Papers' : ''].filter(Boolean).join(' + ') || 'Neither'),
    row('Purchase date', fmtD(w.purchaseDate)), row('Purchase price', w.purchasePrice != null ? money(w.purchasePrice) : null),
    row('Bought from', seller || null), row('Shop address', ['ad', 'jeweller'].includes(w.sellerType) ? w.sellerAddress : null),
    row('Shop contact', ['ad', 'jeweller'].includes(w.sellerType) ? w.sellerContact : null),
    row('Estimated value now', w.value != null ? money(w.value) : null),
    row('Last service', fmtD(w.lastService)), row('Warranty ends', fmtD(w.warrantyUntil)),
  ].join('');
}

async function insPhotoGrid(w, { listMissing = false } = {}) {
  const ins = w.insPhotos || {};
  const figs = [];
  for (const [k, label] of INS_SLOTS) {
    if (!ins[k]) continue;
    const src = await photoDataUrl(ins[k], 'full');
    if (src) figs.push(`<figure><img src="${src}" alt=""><figcaption>${esc(label)}</figcaption></figure>`);
  }
  const missing = INS_SLOTS.filter(([k, , , must]) => must && !ins[k]).map(([, label]) => label);
  return (figs.length ? `<div class="grid">${figs.join('')}</div>` : '<p class="missing">No insurance photos added yet.</p>')
    + (listMissing && missing.length ? `<p class="missing">Not yet photographed: ${esc(missing.join(', '))}.</p>` : '');
}

/* ---------- Insurance PDF ---------- */
export async function insurancePdf(w, onClose = null) {
  toast('Preparing the insurance document…', 1500);
  const owner = d().ownerName || '';
  const disclaimer = `This is not an official insurance document or valuation. It is the owner’s own record, made with ${esc(APP_NAME)}, to help start a claim or a new policy. Your insurer may ask for original receipts, papers or a professional valuation.`;
  const body = `
    <h1>${esc(w.name)}</h1>
    <p class="sub">Watch record for insurance${owner ? ` · Owner: ${esc(owner)}` : ''} · Prepared ${esc(fmtD(new Date()))}</p>
    <div class="disc"><b>Please note:</b> ${disclaimer}</div>
    <div class="hero">${await facePic(w)}<table class="kv">${row('Watch', subtitle(w) || w.name)}${row('Serial number', w.serial || 'Not recorded')}${row('Estimated value now', w.value != null ? money(w.value) : w.purchasePrice != null ? `${money(w.purchasePrice)} (purchase price)` : 'Not recorded')}</table></div>
    <h2>Details</h2><table class="kv">${detailRows(w)}</table>
    ${w.notes ? `<h2>Notes</h2><p class="notes">${esc(w.notes)}</p>` : ''}
    <h2>Photographs</h2>${await insPhotoGrid(w, { listMissing: true })}
    <p class="foot">${disclaimer}</p>`;
  showPrintView(page(`${w.name} – insurance record`, body), { title: `${w.name} – insurance`, file: fileName(w, 'insurance'), onClose });
}

/* ---------- Memory book PDF ---------- */
export async function memoryBook(w, onClose = null) {
  toast('Putting the memory book together…', 1500);
  const st = watchStats(w);
  const worn = daysWorn(w.id);
  const wear = (d().wear || []).filter((e) => e.watchId === w.id).sort((a, b) => a.on - b.on);
  const story = [
    row('In the collection since', fmtD(w.purchaseDate)),
    row('First worn', wear.length ? fmtD(wear[0].on) : null),
    row('Days worn', worn || null),
    row('Accuracy', st.overall != null ? `${fmtRate(st.overall)} (average of your measurements)` : null),
    row('To be left to', w.willStatus !== 'no' ? w.willTo : null),
  ].join('');
  let galleries = '';
  const extra = [];
  for (const id of w.photos || []) { const src = await photoDataUrl(id, 'full'); if (src) extra.push(`<figure><img src="${src}" alt=""></figure>`); }
  if (extra.length) galleries += `<h2>Photos</h2><div class="grid">${extra.join('')}</div>`;
  for (const g of memoryGalleries) {
    const ids = (g.photos(w) || []).filter(Boolean);
    const note = g.notes ? g.notes(w) : '';
    if (!ids.length && !note) continue;
    const caps = g.captions ? g.captions(w) : [];
    const figs = [];
    for (const [i, id] of ids.entries()) { const src = await photoDataUrl(id, 'full'); if (src) figs.push(`<figure><img src="${src}" alt="">${caps[i] ? `<figcaption>${esc(caps[i])}</figcaption>` : ''}</figure>`); }
    galleries += `<h2>${esc(g.title)}</h2>${note ? `<p class="notes">${esc(note)}</p>` : ''}${figs.length ? `<div class="grid">${figs.join('')}</div>` : ''}`;
  }
  const body = `
    <div class="cover">${await facePic(w)}<h1>${esc(w.name)}</h1><p class="sub">${esc(subtitle(w))}${w.year ? ` · ${esc(w.year)}` : ''}</p></div>
    ${story ? `<h2>Its story</h2><table class="kv">${story}</table>` : ''}
    ${w.willNote && w.willStatus !== 'no' ? `<h2>A note for ${esc(w.willTo || 'them')}</h2><p class="notes">${esc(w.willNote)}</p>` : ''}
    ${w.notes ? `<h2>Notes</h2><p class="notes">${esc(w.notes)}</p>` : ''}
    <h2 class="pb">The watch</h2><table class="kv">${detailRows(w, { serial: false })}</table>
    <h2>Insurance photos</h2>${await insPhotoGrid(w)}
    ${galleries}
    <p class="foot">A memory book made with ${esc(APP_NAME)} on ${esc(fmtD(new Date()))}. The serial number is left out on purpose; it’s in the insurance document.</p>`;
  showPrintView(page(`${w.name} – memory book`, body), { title: `${w.name} – memory book`, file: fileName(w, 'memory-book'), onClose });
}

export function register() {
  detailSections.push(insSection);
}
