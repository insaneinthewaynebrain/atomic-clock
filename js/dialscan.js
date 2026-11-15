// Reads the words on a watch dial, on the phone (Tesseract OCR, loaded the first time it's needed).
// Nothing is uploaded: the picture never leaves the device. The reading engine itself (~3 MB, plus ~2 MB
// of English text data) is downloaded once from the jsDelivr CDN and then kept by the browser.
import { parseDial } from './watchdb.js';

const TESS = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
let workerP = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.async = true; s.crossOrigin = 'anonymous';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('The dial reader could not be downloaded (are you online?).'));
    document.head.append(s);
  });
}

async function worker() {
  if (!workerP) {
    workerP = (async () => {
      await loadScript(TESS);
      const w = await window.Tesseract.createWorker('eng', 1, {
        workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
        corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',
        langPath: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int',
      });
      await w.setParameters({ tessedit_pageseg_mode: '11' });   // sparse text: words scattered round a dial
      return w;
    })().catch((e) => { workerP = null; throw e; });
  }
  return workerP;
}

/** Start downloading the reader early (e.g. when the camera opens) so the scan is quicker. */
export function warmUp() { worker().catch(() => {}); }

function blobImage(blob) {
  return new Promise((resolve, reject) => {
    const u = URL.createObjectURL(blob);
    const i = new Image();
    i.onload = () => { URL.revokeObjectURL(u); resolve(i); };
    i.onerror = () => { URL.revokeObjectURL(u); reject(new Error('bad image')); };
    i.src = u;
  });
}

/**
 * Greyscale, stretched contrast; `invert` for light text on dark dials.
 * `crop` = [x, y, w, h] as fractions of the picture, enlarged to fill the output (makes small lettering readable).
 */
function prepared(img, invert, crop = [0, 0, 1, 1]) {
  const [cx, cy, cw, ch] = crop;
  const sw = img.naturalWidth * cw, sh = img.naturalHeight * ch;
  const W = 1200, H = Math.round((sh / sw) * W);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  g.drawImage(img, img.naturalWidth * cx, img.naturalHeight * cy, sw, sh, 0, 0, W, H);
  const d = g.getImageData(0, 0, W, H);
  const p = d.data;
  let lo = 255, hi = 0;
  const lum = new Uint8ClampedArray(W * H);
  for (let i = 0, j = 0; i < p.length; i += 4, j++) {
    const v = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
    lum[j] = v; if (v < lo) lo = v; if (v > hi) hi = v;
  }
  const k = 255 / Math.max(1, hi - lo);
  for (let i = 0, j = 0; i < p.length; i += 4, j++) {
    let v = (lum[j] - lo) * k;
    if (invert) v = 255 - v;
    p[i] = p[i + 1] = p[i + 2] = v;
  }
  g.putImageData(d, 0, 0);
  return c;
}

/**
 * Reads a face picture. Resolves { text, fields, found } — see parseDial().
 * `onWord` is called with each recognised word as it's found (for the scan animation).
 */
export async function scanDial(blob, onWord = () => {}) {
  const [w, img] = await Promise.all([worker(), blobImage(blob)]);
  const texts = [];
  const faint = [];          // low-confidence pieces, still useful for guessing the brand ("..IKO" → Seiko)
  // Whole dial, then enlarged crops of the upper middle (where the brand nearly always sits) and the lower middle.
  const TOP = [0.14, 0.1, 0.72, 0.5], LOW = [0.14, 0.5, 0.72, 0.36];     // brand above centre; model, depth, "AUTOMATIC" below
  const passes = [[false, undefined], [true, undefined], [false, TOP], [true, TOP], [false, LOW], [true, LOW]];
  for (const [invert, crop] of passes) {
    const { data } = await w.recognize(prepared(img, invert, crop));
    const all = (data.words || []).filter((x) => /[A-Za-z0-9]{2,}/.test(x.text));
    const good = all.filter((x) => x.confidence > 45);
    good.forEach((x) => onWord(x.text));
    all.filter((x) => x.confidence <= 45 && x.confidence > 10).forEach((x) => faint.push(x.text));
    texts.push(good.map((x) => x.text).join(' '));
  }
  const text = texts.join(' ');
  return { text, ...parseDial(text, faint) };
}
