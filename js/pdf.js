// Real PDF files made on the phone (jsPDF, bundled with the app so it works offline):
//  • Insurance — A4: details, serial number, value history with dates, insurance photos, list of documents.
//  • Photo album — 21 × 21 cm square pages (a common photo-book size): cover, story, details, accuracy, wear,
//    map, value history, then every gallery with large photos. Upload the PDF to a photo-book printer.
import * as store from './store.js';
import { toast } from './ui.js';
import { photoDataUrl } from './photos.js';
import { getWatch, money, movementLabel, daysWorn } from './collection.js';
import { featuresOf, featureLabel, categoryLabel, valueInfo, serviceInfo, placesOf, HOW_ACQUIRED, WHY_BOUGHT } from './model.js';
import { accuracyData } from './accuracyui.js';
import { fmtRate } from './accuracy.js';
import { galleriesForAlbum } from './galleries.js';
import { INS_SLOTS } from './watchdocs.js';
import { shareOrDownload } from './backup.js';
import { APP_NAME } from './config.js';

const d = () => store.get();
const fmtD = (s) => (s ? new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
// The built-in PDF font covers Western European text; leave out emoji and other symbols it can't draw.
const clean = (s) => String(s ?? '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
  .replace(/−/g, '-').replace(/[^\x20-\x7E\xA0-\xFF\n€]/g, '').replace(/ {2,}/g, ' ').trim();

let lib = null;
function loadJsPdf() {
  if (!lib) {
    lib = new Promise((resolve, reject) => {
      if (window.jspdf) { resolve(window.jspdf.jsPDF); return; }
      const sc = document.createElement('script');
      sc.src = 'js/vendor/jspdf.umd.min.js';
      sc.onload = () => resolve(window.jspdf.jsPDF);
      sc.onerror = () => { lib = null; reject(new Error('The PDF maker could not be loaded.')); };
      document.head.append(sc);
    });
  }
  return lib;
}

const imgSize = (src) => new Promise((resolve) => { const i = new Image(); i.onload = () => resolve([i.naturalWidth, i.naturalHeight]); i.onerror = () => resolve(null); i.src = src; });
async function photo(id) {
  const src = id ? await photoDataUrl(id, 'full') : null;
  if (!src || !src.startsWith('data:image')) return null;
  const size = await imgSize(src);
  return size ? { src, w: size[0], h: size[1], type: src.startsWith('data:image/png') ? 'PNG' : 'JPEG' } : null;
}

/** Small layout helper: a cursor down the page, wrapping text, new pages as needed. */
function writer(doc, { margin, footer }) {
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const st = { y: margin, page: 1 };
  const api = {
    W, H, margin, inner: W - 2 * margin, st,
    newPage() { footer && footer(doc, st.page); doc.addPage(); st.page++; st.y = margin; },
    need(h) { if (st.y + h > H - margin - 6) api.newPage(); },
    text(txt, { size = 10.5, bold = false, color = [30, 30, 30], gap = 1.6, x = margin, width = api.inner, align = 'left' } = {}) {
      const t = clean(txt); if (!t) return;
      doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(...color);
      const lines = doc.splitTextToSize(t, width), lh = size * 0.42;
      for (const line of lines) { api.need(lh); doc.text(line, align === 'center' ? x + width / 2 : x, st.y + lh * 0.8, { align }); st.y += lh; }
      st.y += gap;
    },
    heading(txt) { api.need(16); st.y += 3; api.text(txt, { size: 15, bold: true, color: [20, 20, 20], gap: 1 }); doc.setDrawColor(201, 169, 110); doc.setLineWidth(0.6); doc.line(margin, st.y, margin + 22, st.y); st.y += 5; },
    rows(pairs) {
      for (const [k, v] of pairs) {
        if (v == null || v === '') continue;
        const vt = doc.splitTextToSize(clean(v), api.inner * 0.62);
        const h = Math.max(1, vt.length) * 4.6 + 1.6;
        api.need(h);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(110, 110, 110); doc.text(clean(k), margin, st.y + 3.8);
        doc.setTextColor(25, 25, 25); doc.text(vt, margin + api.inner * 0.36, st.y + 3.8);
        st.y += h; doc.setDrawColor(228, 228, 228); doc.setLineWidth(0.2); doc.line(margin, st.y - 0.6, W - margin, st.y - 0.6);
      }
      st.y += 3;
    },
    image(p, { maxW = api.inner, maxH = 110, center = true, caption = '' } = {}) {
      if (!p) return;
      const k = Math.min(maxW / p.w, maxH / p.h);
      const w = p.w * k, h = p.h * k;
      api.need(h + (caption ? 8 : 2));
      const x = center ? (W - w) / 2 : margin;
      doc.addImage(p.src, p.type, x, st.y, w, h, undefined, 'FAST');
      st.y += h + 1.5;
      if (caption) api.text(caption, { size: 8.5, color: [90, 90, 90], x, width: Math.max(w, 60), gap: 3 });
      else st.y += 2;
    },
  };
  return api;
}

/* ---------- Charts drawn straight into the PDF ---------- */
function drawRateChart(doc, x, y, w, h, w0) {
  const a = accuracyData(w0);
  const pts = a.points;
  doc.setDrawColor(220, 220, 220); doc.setLineWidth(0.2); doc.rect(x, y, w, h);
  if (!pts.length) { doc.setFontSize(9); doc.setTextColor(140, 140, 140); doc.text('No readings yet', x + w / 2, y + h / 2, { align: 'center' }); return; }
  const g = d().thresholds.green, maxR = Math.max(g * 2, ...pts.map((p) => Math.abs(p.rate))) * 1.15;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const X = (t) => x + 4 + (t1 > t0 ? (t - t0) / (t1 - t0) : 0.5) * (w - 8), Y = (r) => y + h / 2 - (r / maxR) * (h / 2 - 3);
  doc.setFillColor(225, 245, 235); doc.rect(x, Y(g), w, Y(-g) - Y(g), 'F');
  doc.setDrawColor(190, 190, 190); doc.line(x, Y(0), x + w, Y(0));
  const man = pts.filter((p) => p.src === 'manual');
  doc.setDrawColor(201, 169, 110); doc.setLineWidth(0.4);
  for (let i = 1; i < man.length; i++) doc.line(X(man[i - 1].t), Y(man[i - 1].rate), X(man[i].t), Y(man[i].rate));
  for (const p of pts) {
    if (p.src === 'timegrapher') { doc.setFillColor(20, 184, 166); const cx = X(p.t), cy = Y(p.rate); doc.triangle(cx, cy - 1.6, cx + 1.6, cy, cx - 1.6, cy, 'F'); doc.triangle(cx, cy + 1.6, cx + 1.6, cy, cx - 1.6, cy, 'F'); }
    else { doc.setFillColor(201, 169, 110); doc.circle(X(p.t), Y(p.rate), 1.2, 'F'); }
  }
  doc.setFontSize(7.5); doc.setTextColor(120, 120, 120);
  doc.text(`+${Math.round(maxR / 1.15)} s/day`, x + 1, y + 4); doc.text(`-${Math.round(maxR / 1.15)} s/day`, x + 1, y + h - 1.5);
  doc.text('Gold circles: manual readings   Teal diamonds: timegrapher', x, y + h + 4);
}

function drawMonthBars(doc, x, y, w, h, w0, year) {
  const months = Array.from({ length: 12 }, (_, m) => {
    const a = new Date(year, m, 1).getTime(), b = new Date(year, m + 1, 1).getTime(); const days = new Set();
    for (const e of d().wear || []) {
      if (e.watchId !== w0.id) continue;
      const s0 = Math.max(e.on, a), s1 = Math.min(e.off || Date.now(), b); if (s1 <= s0) continue;
      const c = new Date(s0); c.setHours(0, 0, 0, 0);
      for (let i = 0; c.getTime() < s1 && i < 40; i++) { days.add(c.toDateString()); c.setDate(c.getDate() + 1); }
    }
    return days.size;
  });
  const max = Math.max(1, ...months), bw = w / 12;
  doc.setFontSize(7.5); doc.setTextColor(110, 110, 110);
  months.forEach((n, i) => {
    const bh = (n / max) * (h - 8);
    doc.setFillColor(201, 169, 110); if (n) doc.rect(x + i * bw + bw * 0.2, y + h - 5 - bh, bw * 0.6, bh, 'F');
    doc.text('JFMAMJJASOND'[i], x + i * bw + bw / 2, y + h, { align: 'center' });
    if (n) doc.text(String(n), x + i * bw + bw / 2, y + h - 6 - bh, { align: 'center' });
  });
  return months.reduce((a, b) => a + b, 0);
}

async function mapImage(w0, wPx = 1400) {
  const { places } = placesOf(w0);
  const { WORLD_PATH } = await import('./worldmap.js');
  // Fit the places (same rule as the screen map).
  let box = [0, 8, 360, 152];
  if (places.length) {
    const xs = places.map((p) => p.lng + 180), ys = places.map((p) => 90 - p.lat);
    let bw = Math.max(16, (Math.max(...xs) - Math.min(...xs)) * 1.35), bh = Math.max(8, (Math.max(...ys) - Math.min(...ys)) * 1.35);
    if (bw / bh > 2) bh = bw / 2; else bw = bh * 2;
    bw = Math.min(360, bw); bh = Math.min(180, bh);
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
    box = [Math.max(0, Math.min(360 - bw, cx - bw / 2)), Math.max(0, Math.min(180 - bh, cy - bh / 2)), bw, bh];
  }
  const c = document.createElement('canvas'); c.width = wPx; c.height = wPx / 2;
  const g = c.getContext('2d');
  g.fillStyle = '#eef3f7'; g.fillRect(0, 0, c.width, c.height);
  const k = c.width / box[2];
  g.setTransform(k, 0, 0, k, -box[0] * k, -box[1] * k);
  g.fillStyle = '#c9cfd6'; g.fill(new Path2D(WORLD_PATH));
  g.setTransform(1, 0, 0, 1, 0, 0);
  const P = (p) => [((p.lng + 180) - box[0]) * k, ((90 - p.lat) - box[1]) * k];
  if (places.length > 1) { g.strokeStyle = '#b08d4f'; g.lineWidth = 3; g.setLineDash([10, 8]); g.beginPath(); places.forEach((p, i) => { const [x, y] = P(p); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); g.setLineDash([]); }
  for (const p of places) { const [x, y] = P(p); g.fillStyle = 'rgba(201,169,110,.35)'; g.beginPath(); g.arc(x, y, 18, 0, 7); g.fill(); g.fillStyle = '#8a6a2f'; g.beginPath(); g.arc(x, y, 8, 0, 7); g.fill(); }
  return { src: c.toDataURL('image/jpeg', 0.88), w: c.width, h: c.height, type: 'JPEG' };
}

const fileBase = (w) => `${(w.name || 'watch').replace(/[^\w-]+/g, '-').replace(/-+/g, '-')}`;
const footerFor = (label) => (doc, n) => {
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(150, 150, 150);
  doc.text(clean(`${label} · ${APP_NAME}`), 12, H - 6); doc.text(String(n), W - 12, H - 6, { align: 'right' });
};

function detailPairs(w, { serial }) {
  return [['Brand', w.brand], ['Model name', w.model], ['Model number', w.reference], serial ? ['Serial number', w.serial || 'Not recorded'] : null, ['Year made', w.year],
    ['Movement', [movementLabel(w.movement), w.calibre].filter(Boolean).join(' · ')], ['Jewels', w.jewels], ['Beats per hour', w.bph ? `${Number(w.bph).toLocaleString('en-GB')} vph` : null],
    ['Power reserve', w.powerReserve ? `${w.powerReserve} hours` : null], ['Case', [w.caseSize ? `${w.caseSize} mm` : null, w.caseMaterial, w.thickness ? `${w.thickness} mm thick` : null].filter(Boolean).join(' · ')],
    ['Water resistance', w.waterResistance], ['Crystal', w.crystal], ['Dial', w.dial], ['Strap / bracelet', w.strap],
    ['Features', featuresOf(w).map((f) => featureLabel(d(), f)).join(', ')], ['Categories', (w.categories || []).map((c) => categoryLabel(d(), c)).join(', ')],
    ['Purchase date', fmtD(w.purchaseDate)], ['Purchase price', w.purchasePrice != null ? money(w.purchasePrice) : null], ['Bought from', w.boughtFrom],
    ['Box and papers', [w.box ? 'Box' : '', w.papers ? 'Papers' : ''].filter(Boolean).join(' + ') || null], ['Condition', w.condition],
    ['Last serviced', fmtD(w.lastService)], ['Next service due', serviceInfo(w).next ? fmtD(serviceInfo(w).next) : null], ['Warranty ends', fmtD(w.warrantyUntil)]].filter(Boolean);
}

async function save(doc, name, title) {
  const blob = doc.output('blob');
  await shareOrDownload(new Blob([blob], { type: 'application/pdf' }), name, title);
}

/* ---------- Insurance (A4) ---------- */
export async function insurancePdf(w0) {
  const w = getWatch(w0.id) || w0;
  toast('Making the insurance PDF…', 2500);
  try {
    const jsPDF = await loadJsPdf();
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const label = `${w.name} - insurance record`;
    const out = writer(doc, { margin: 16, footer: footerFor(label) });
    out.text(w.name, { size: 22, bold: true, gap: 1 });
    out.text(`Watch record for insurance${d().ownerName ? ` · Owner: ${d().ownerName}` : ''} · Prepared ${fmtD(new Date())}`, { size: 9.5, color: [100, 100, 100], gap: 4 });
    out.text(`Please note: this is the owner's own record made with ${APP_NAME}, not an official valuation. Your insurer may ask for original receipts, papers or a professional valuation.`, { size: 8.5, color: [120, 90, 20], gap: 5 });
    const face = await photo(w.face || w.photos?.[0]);
    if (face) out.image(face, { maxH: 70 });
    const vi = valueInfo(w);
    out.heading('Key details');
    out.rows([['Watch', [w.brand, w.model].filter(Boolean).join(' ') || w.name], ['Model number', w.reference || 'Not recorded'], ['Serial number', w.serial || 'Not recorded'],
      ['Latest value', vi.latest ? `${money(vi.latest.value)} (${fmtD(vi.latest.date)})` : 'Not recorded']]);
    out.heading('Details');
    out.rows(detailPairs(w, { serial: true }));
    out.heading('Value history');
    out.rows(vi.entries.length ? vi.entries.map((e) => [fmtD(e.date), `${money(e.value)}${e.note ? ` - ${e.note}` : ''}`]) : [['', 'No values recorded']]);
    if ((w.insDocs || []).length) { out.heading('Documents held'); out.rows(w.insDocs.map((x) => [fmtD(x.added), x.name])); }
    // Insurance images: the labelled checklist first, then anything else in the Insurance gallery and image documents.
    const ins = w.insPhotos || {};
    const ids = [...INS_SLOTS.filter(([k]) => ins[k]).map(([k, lab]) => [ins[k], lab])];
    const seen = new Set(ids.map((x) => x[0]));
    for (const id of (w.galleryList || []).find((g) => g.id === 'insurance')?.photoIds || []) if (!seen.has(id)) { ids.push([id, w.photoMeta?.[id]?.note || '']); seen.add(id); }
    for (const x of w.insDocs || []) if ((x.type || '').startsWith('image/') && !seen.has(x.photoId)) ids.push([x.photoId, x.name]);
    if (ids.length) {
      out.newPage(); out.heading('Insurance photographs');
      for (const [id, cap] of ids) out.image(await photo(id), { maxH: 95, caption: cap });
    }
    footerFor(label)(doc, out.st.page);
    await save(doc, `${fileBase(w)}-insurance-${new Date().toISOString().slice(0, 10)}.pdf`, `${w.name} insurance`);
  } catch (e) { toast(e.message || 'Could not make the PDF'); }
}

/* ---------- Photo album (21 × 21 cm) ---------- */
export async function photoAlbum(w0) {
  const w = getWatch(w0.id) || w0;
  toast('Making the photo album… (large albums take a moment)', 4000);
  try {
    const jsPDF = await loadJsPdf();
    const doc = new jsPDF({ unit: 'mm', format: [210, 210] });
    const label = w.name;
    const out = writer(doc, { margin: 15, footer: footerFor(label) });
    const { W } = out;

    // Cover
    const face = await photo(w.face || w.photos?.[0]);
    out.st.y = 22;
    if (face) out.image(face, { maxW: 130, maxH: 120 });
    out.st.y += 4;
    out.text(w.name, { size: 24, bold: true, align: 'center', gap: 2 });
    out.text([w.brand, w.model, w.reference ? `Ref. ${w.reference}` : null].filter(Boolean).join(' · '), { size: 11, color: [90, 90, 90], align: 'center', gap: 2 });
    if (w.purchaseDate) out.text(`Together since ${fmtD(w.purchaseDate)}`, { size: 10.5, color: [160, 130, 70], align: 'center' });

    // Story
    const lab = (list, v) => (list.find((x) => x[0] === v) || [])[1];
    out.newPage(); out.heading('Its story');
    out.rows([['How I got it', lab(HOW_ACQUIRED, w.howAcquired)], ['Why', lab(WHY_BOUGHT, w.whyBought)], ['From', w.fromWho], ['Occasion', w.occasion], ['In the collection since', fmtD(w.purchaseDate)]]);
    if (w.story) out.text(w.story, { size: 11.5, gap: 4 });
    if (w.willNote && w.willStatus !== 'no') { out.heading(`A note for ${w.willTo || 'them'}`); out.text(w.willNote, { size: 11 }); }
    if (w.notes) { out.heading('Notes'); out.text(w.notes); }

    // Details (serial number left out on purpose — it's in the insurance PDF)
    out.newPage(); out.heading('The watch');
    out.rows(detailPairs(w, { serial: false }));

    // Accuracy
    const a = accuracyData(w);
    out.newPage(); out.heading('Accuracy');
    out.rows([['Current drift', a.drift != null ? fmtRate(a.drift) : 'Not measured yet'], ['All-time average', a.st.overall != null ? fmtRate(a.st.overall) : null],
      ['Readings', `${(w.readings || []).length} (${(w.readings || []).filter((r) => r.source === 'timegrapher').length} from the timegrapher)`]]);
    out.need(70); drawRateChart(doc, out.margin, out.st.y, out.inner, 60, w); out.st.y += 70;
    const hist = (w.readings || []).slice().sort((x, y) => y.timestamp - x.timestamp).slice(0, 18);
    out.rows(hist.map((r) => [new Date(r.timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
      r.source === 'timegrapher' ? `Timegrapher: ${fmtRate(r.timegrapherData.rate)}, beat error ${r.timegrapherData.beatError} ms`
        : `${r.setToZero ? 'Set to zero' : 'Manual'}: ${r.offsetSeconds > 0 ? '+' : ''}${r.offsetSeconds} s`]));

    // Wear
    const year = new Date().getFullYear();
    out.newPage(); out.heading(`Time on the wrist · ${year}`);
    out.need(55); const yearDays = drawMonthBars(doc, out.margin, out.st.y, out.inner, 45, w, year); out.st.y += 52;
    out.rows([['Days worn this year', String(yearDays)], ['Days worn in total', String(daysWorn(w.id))]]);

    // Map
    const { places, distance } = placesOf(w);
    out.newPage(); out.heading('Where it has been');
    out.image(await mapImage(w), { maxH: 90 });
    out.rows([['Places', String(places.length)], ['Distance travelled (estimate)', places.length > 1 ? `${Math.round(distance).toLocaleString('en-GB')} km` : null],
      ...places.map((p) => [p.t ? new Date(p.t).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '', p.placeName || 'Unnamed place'])]);

    // Value history
    const vi = valueInfo(w);
    if (vi.entries.length) {
      out.newPage(); out.heading('Value over time');
      out.rows(vi.entries.map((e) => [fmtD(e.date), `${money(e.value)}${e.note ? ` - ${e.note}` : ''}`]));
    }

    // Galleries: one or two large photos per page.
    for (const g of galleriesForAlbum(w)) {
      out.newPage(); out.heading(g.name);
      for (const p of g.photos) out.image(await photo(p.id), { maxH: 150, caption: p.caption });
    }
    out.newPage();
    out.st.y = 80;
    out.text(`Made with ${APP_NAME} on ${fmtD(new Date())}.`, { size: 10, color: [120, 120, 120], align: 'center' });
    out.text('Page size 21 x 21 cm - ready to upload to a photo-book printing service.', { size: 9, color: [150, 150, 150], align: 'center' });
    footerFor(label)(doc, out.st.page);
    void W;
    await save(doc, `${fileBase(w)}-photo-album.pdf`, `${w.name} photo album`);
  } catch (e) { console.error(e); toast(e.message || 'Could not make the album'); }
}
