// Insurance list (printable / PDF) and CSV export.
import * as store from './store.js';
import { el, toast } from './ui.js';
import { ownedWatches, money, movementLabel } from './collection.js';
import { photoDataUrl } from './photos.js';
import { shareOrDownload } from './backup.js';
import { APP_NAME } from './config.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtD = (s) => (s ? new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const stamp = () => new Date().toISOString().slice(0, 10);

/* ---------- Printable insurance list ---------- */
async function buildHtml({ serials, photos, owner }) {
  const list = ownedWatches().slice().sort((a, b) => (a.brand || '').localeCompare(b.brand || '') || a.name.localeCompare(b.name));
  let paid = 0, value = 0;
  const rows = [];
  for (const w of list) {
    const p = w.purchasePrice != null ? Number(w.purchasePrice) : null;
    const v = w.value != null ? Number(w.value) : p;
    if (p != null) paid += p;
    if (v != null) value += v;
    const img = photos && w.photos?.length ? await photoDataUrl(w.photos[0], 'thumb') : null;
    rows.push(`<tr>
      ${photos ? `<td class="ph">${img ? `<img src="${img}" alt="">` : ''}</td>` : ''}
      <td><b>${esc(w.brand || '')}</b><br>${esc(w.model || w.name)}${w.nickname ? `<br><span class="m">“${esc(w.nickname)}”</span>` : ''}</td>
      <td>${esc(w.reference || '')}${w.calibre ? `<br><span class="m">Cal. ${esc(w.calibre)}</span>` : ''}</td>
      ${serials ? `<td>${esc(w.serial || '')}</td>` : ''}
      <td>${esc(fmtD(w.purchaseDate))}${w.boughtFrom ? `<br><span class="m">${esc(w.boughtFrom)}</span>` : ''}<br><span class="m">${[w.box ? 'Box' : '', w.papers ? 'Papers' : ''].filter(Boolean).join(' + ') || 'No box/papers'}${w.condition ? ` · ${esc(w.condition)}` : ''}</span></td>
      <td class="n">${p != null ? esc(money(p)) : ''}</td>
      <td class="n">${v != null ? esc(money(v)) : ''}</td>
    </tr>`);
  }
  const head = `${photos ? '<th></th>' : ''}<th>Watch</th><th>Reference</th>${serials ? '<th>Serial</th>' : ''}<th>Purchased</th><th class="n">Paid</th><th class="n">Value now</th>`;
  const span = 3 + (photos ? 1 : 0) + (serials ? 1 : 0);
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Watch collection – insurance list</title>
<style>
  body { font: 12px/1.4 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #111; background: #fff; margin: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; } .sub { color: #555; margin: 0 0 16px; }
  table { width: 100%; border-collapse: collapse; } th, td { text-align: left; vertical-align: top; padding: 6px; border-bottom: 1px solid #ddd; }
  th { font-size: 11px; text-transform: uppercase; color: #555; border-bottom: 2px solid #111; }
  .n { text-align: right; white-space: nowrap; } .m { color: #666; font-size: 11px; }
  .ph img { width: 64px; height: 64px; object-fit: cover; border-radius: 6px; display: block; }
  tfoot td { font-weight: 700; border-top: 2px solid #111; border-bottom: 0; }
  .foot { margin-top: 16px; color: #666; font-size: 11px; }
  tr { page-break-inside: avoid; }
  .wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  @media screen and (max-width: 640px) {
    body { margin: 12px; font-size: 10.5px; } h1 { font-size: 17px; }
    th, td { padding: 4px 3px; } th { font-size: 9px; } .m { font-size: 9.5px; }
    .ph img { width: 40px; height: 40px; }
  }
</style></head><body>
<h1>Watch collection — insurance list</h1>
<p class="sub">${owner ? `Owner: ${esc(owner)} · ` : ''}Prepared ${esc(fmtD(new Date()))} · ${list.length} watch${list.length === 1 ? '' : 'es'}</p>
<div class="wrap"><table><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody>
<tfoot><tr><td colspan="${span}">Total</td><td class="n">${esc(money(paid))}</td><td class="n">${esc(money(value))}</td></tr></tfoot></table></div>
<p class="foot">“Value now” is the owner’s own estimate (purchase price where no estimate was entered). Made with ${esc(APP_NAME)}.</p>
</body></html>`;
}

function showPrintView(html) {
  let view = $('print-view');
  if (view) view.remove();
  const frame = el('iframe', { class: 'print-frame', title: 'Insurance list' });
  view = el('div', { id: 'print-view' },
    el('div', { class: 'print-bar' },
      el('button', { type: 'button', class: 'btn sm', onclick: () => view.remove() }, '✕ Close'),
      el('button', { type: 'button', class: 'btn sm', onclick: () => shareOrDownload(new Blob([html], { type: 'text/html' }), `insurance-list-${stamp()}.html`, 'Insurance list') }, '📤 Share file'),
      el('button', { type: 'button', class: 'btn sm primary', onclick: () => { try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (e) { window.print(); } } }, '🖨 Print / PDF')),
    frame);
  document.body.append(view);
  frame.srcdoc = html;
}

/* ---------- CSV ---------- */
const CSV_COLS = [
  ['status', 'Status'], ['name', 'Name'], ['brand', 'Brand'], ['model', 'Model'], ['reference', 'Reference'], ['nickname', 'Nickname'],
  ['movement', 'Movement'], ['calibre', 'Calibre'], ['bph', 'Beats per hour'], ['powerReserve', 'Power reserve (h)'],
  ['caseSize', 'Case size (mm)'], ['lugWidth', 'Lug width (mm)'], ['waterResistance', 'Water resistance'], ['strap', 'Strap'],
  ['purchaseDate', 'Purchase date'], ['purchasePrice', 'Purchase price'], ['boughtFrom', 'Bought from'], ['box', 'Box'], ['papers', 'Papers'],
  ['condition', 'Condition'], ['value', 'Estimated value'], ['targetPrice', 'Target price'], ['soldDate', 'Sold date'], ['soldPrice', 'Sold price'],
  ['soldTo', 'Sold to'], ['lastService', 'Last service'], ['serviceInterval', 'Service interval (years)'], ['warrantyUntil', 'Warranty until'],
  ['serial', 'Serial'], ['notes', 'Notes'],
];

export function buildCsv(includeSerial = true) {
  const cols = CSV_COLS.filter(([k]) => includeSerial || k !== 'serial');
  const cell = (v) => {
    if (v == null) return '';
    let s = typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v);
    if (/^[=+\-@]/.test(s)) s = "'" + s;                 // stop spreadsheets treating text as formulas
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.map(([, h]) => h).join(',')];
  for (const w of store.get().watches) {
    lines.push(cols.map(([k]) => cell(k === 'movement' ? movementLabel(w[k]) || w[k] : k === 'status' ? ({ owned: 'Owned', wishlist: 'Wishlist', sold: 'Sold' }[w.status || 'owned']) : w[k])).join(','));
  }
  return '﻿' + lines.join('\r\n');   // BOM so Excel opens £ correctly
}

/* ---------- Panel ---------- */
function render() {
  const box = $('tool-insurance-body');
  const d = store.get();
  const owned = ownedWatches();
  const serials = el('input', { type: 'checkbox', class: 'check', checked: true });
  const photos = el('input', { type: 'checkbox', class: 'check', checked: true });
  const owner = el('input', { class: 'input', type: 'text', value: d.ownerName || '', placeholder: 'Your name (optional)', autocapitalize: 'words',
    onchange: (e) => { d.ownerName = e.target.value.trim(); store.save(); } });
  box.innerHTML = '';
  box.append(
    el('div', { class: 'card' },
      el('h2', { class: 'card-title' }, '🛡️ Insurance list'),
      el('p', { class: 'muted small' }, `A printable list of your ${owned.length} owned watch${owned.length === 1 ? '' : 'es'} with photos, references, serial numbers, prices and totals. Use “Print / PDF”, then pinch outwards on the preview (or choose Save to Files) to keep it as a PDF.`),
      el('label', { class: 'field' }, el('span', {}, 'Name on the list'), owner),
      el('label', { class: 'field check-field' }, photos, el('span', {}, 'Include photos')),
      el('label', { class: 'field check-field' }, serials, el('span', {}, 'Include serial numbers')),
      el('button', { type: 'button', class: 'btn primary wide', disabled: !owned.length, onclick: async () => {
        toast('Preparing list…', 1200);
        showPrintView(await buildHtml({ serials: serials.checked, photos: photos.checked, owner: owner.value.trim() }));
      } }, 'Open insurance list')),
    el('div', { class: 'card' },
      el('h2', { class: 'card-title' }, '📊 Spreadsheet (CSV)'),
      el('p', { class: 'muted small' }, 'Every watch — Watch Box, wishlist and sold — with all details, for Numbers, Excel or Google Sheets.'),
      el('button', { type: 'button', class: 'btn wide', disabled: !d.watches.length, onclick: () => shareOrDownload(new Blob([buildCsv(true)], { type: 'text/csv' }), `watch-collection-${stamp()}.csv`, 'Watch collection') }, 'Export CSV')),
    el('p', { class: 'muted small center' }, 'Keep these files private: they contain serial numbers and values.'));
}

export function register({ registerTool }) {
  registerTool({ id: 'insurance', title: 'Insurance & export', icon: '🛡️', desc: 'PDF list and spreadsheet', panel: 'insurance', show: render, group: 'general', order: 80 });
}
