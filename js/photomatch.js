// Adding photos to a watch's map: pick photos from the library; the app compares them with this watch's own
// photos using an image model that runs on the phone (CLIP, via transformers.js), pre-ticks the likely matches,
// and you untick any mistakes. Each photo is placed using the location and date stored in it (EXIF) and saved to
// the "Around the world" gallery.
// Honest limits: a web app can't scan your whole photo library — you pick the photos. The model is a one-time
// download of about 90 MB (kept by the browser afterwards); it's good at "is this a watch like this one?" but can
// confuse two very similar watches, so always check the ticks. Nothing is uploaded: photos never leave the phone.
import * as store from './store.js';
import { el, openModal, toast } from './ui.js';
import { photoUrl } from './photos.js';
import { getWatch } from './collection.js';
import { readExif } from './exif.js';
import { addToGallery } from './galleries.js';

export function matchPhotos(w, onChange = () => {}) {
  const inp = el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  document.body.append(inp);
  inp.addEventListener('change', async () => {
    const files = [...(inp.files || [])];
    inp.remove();
    if (!files.length) return;
    const items = [];
    for (const f of files) items.push({ f, exif: await readExif(f).catch(() => ({})), keep: true, url: URL.createObjectURL(f) });
    const refs = referenceIds(w);
    if (!refs.length) { review(w, items, onChange, { note: 'Add a face picture or a wrist shot of this watch first and the app can pick out the matching photos for you. For now, untick any that aren’t this watch.' }); return; }
    if (!store.get().clipOk) {
      openModal({
        title: 'Find this watch in your photos?',
        content: [el('p', { class: 'small' }, `The app can compare these ${items.length} photos with this watch’s own photos and tick the likely matches. It uses an image model that runs on your phone — a one-time download of about 90 MB (Wi-Fi recommended). Your photos never leave the phone.`)],
        actions: [
          { label: 'Skip matching', onClick: () => { setTimeout(() => review(w, items, onChange), 0); } },
          { label: 'Download & match', kind: 'primary', onClick: () => { setTimeout(() => runMatch(w, items, refs, onChange), 0); } },
        ],
      });
    } else runMatch(w, items, refs, onChange);
  });
  inp.click();
}

/* ---------- On-device matching ---------- */
const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2/dist/transformers.min.js';
const MODEL = 'Xenova/clip-vit-base-patch32';
const MATCH = 0.8;                       // cosine similarity treated as "probably this watch"
let model = null;

/** This watch's own pictures to compare against: face, photos, then wrist shots (up to 8). */
function referenceIds(w) {
  const x = getWatch(w.id) || w;
  const wrist = (x.galleryList || []).find((g) => g.id === 'wrist')?.photoIds || [];
  return [...new Set([x.face, ...(x.photos || []), ...wrist].filter(Boolean))].slice(0, 8);
}

async function loadModel(progress) {
  if (model) return model;
  const T = await import(LIB);
  T.env.allowLocalModels = false;
  const onp = (p) => { if (p.status === 'progress' && p.total) progress(`Downloading the model… ${Math.round((p.loaded / p.total) * 100)}%`); };
  const processor = await T.AutoProcessor.from_pretrained(MODEL, { progress_callback: onp });
  const vision = await T.CLIPVisionModelWithProjection.from_pretrained(MODEL, { dtype: 'q8', progress_callback: onp });
  model = { T, processor, vision };
  return model;
}

async function embed(m, blob) {
  const img = await m.T.RawImage.fromBlob(blob);
  const { image_embeds } = await m.vision(await m.processor(img));
  const v = Float32Array.from(image_embeds.data);
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}
const cos = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

async function runMatch(w, items, refs, onChange) {
  const status = el('p', { class: 'small' }, 'Getting ready…');
  const m0 = openModal({ title: 'Finding this watch…', content: [status, el('p', { class: 'muted small' }, 'This runs on your phone. The first time includes the model download.')], actions: [{ label: 'Skip', onClick: () => { cancelled = true; } }] });
  let cancelled = false;
  try {
    const m = await loadModel((t) => { status.textContent = t; });
    store.get().clipOk = true; store.save();
    const refVecs = [];
    for (const id of refs) {
      const u = await photoUrl(id, 'full'); if (!u) continue;
      refVecs.push(await embed(m, await (await fetch(u)).blob()));
    }
    const scores = [];
    for (const [i, it] of items.entries()) {
      if (cancelled) break;
      status.textContent = `Checking photo ${i + 1} of ${items.length}…`;
      const v = await embed(m, it.f);
      scores.push(Math.max(...refVecs.map((r) => cos(r, v))));
    }
    if (cancelled) { m0.close(); review(w, items, onChange); return; }
    items.forEach((it, i) => { it.keep = scores[i] >= MATCH; });
    const n = items.filter((x) => x.keep).length;
    m0.close();
    setTimeout(() => review(w, items, onChange, { scores, note: `${n} of ${items.length} look like this watch and are ticked. The % is how closely each matches its own photos — check them, as very similar watches can fool it.` }), 0);
  } catch (e) {
    console.warn('Matching failed', e);
    m0.close();
    setTimeout(() => review(w, items, onChange, { note: 'The matching model couldn’t be loaded (are you online?). Untick any photos that aren’t this watch.' }), 0);
  }
}

export function review(w, items, onChange, { scores = null, note = '' } = {}) {
  const grid = el('div', { class: 'pm-grid' }, items.map((it, i) => {
    const cb = el('input', { type: 'checkbox', class: 'check pm-check', checked: it.keep, 'aria-label': 'Include this photo', onchange: (e) => { it.keep = e.target.checked; cell.classList.toggle('off', !it.keep); } });
    const cell = el('label', { class: 'pm-cell' + (it.keep ? '' : ' off') },
      el('img', { src: it.url, alt: '' }), cb,
      el('span', { class: 'pm-tag' }, it.exif?.lat != null ? '📍' : '—', scores ? ` ${Math.round(scores[i] * 100)}%` : ''));
    return cell;
  }));
  const withGps = items.filter((x) => x.exif?.lat != null).length;
  openModal({
    title: 'Add photos to the map', className: 'tall',
    content: [
      note ? el('p', { class: 'small' }, note) : null,
      el('p', { class: 'muted small' }, `${withGps} of ${items.length} have a location (📍). Untick any that aren’t this watch. Photos without a location are still saved to “Around the world”.`),
      grid],
    actions: [{ label: 'Cancel', onClick: () => items.forEach((x) => URL.revokeObjectURL(x.url)) },
      { label: 'Save', kind: 'primary', onClick: async () => {
        const keep = items.filter((x) => x.keep);
        toast(`Saving ${keep.length} photo${keep.length === 1 ? '' : 's'}…`, 4000);
        for (const it of keep) { try { await addToGallery(w, 'world', it.f); } catch (e) { /* skip unreadable */ } }
        items.forEach((x) => URL.revokeObjectURL(x.url));
        toast(`${keep.length} photo${keep.length === 1 ? '' : 's'} added`);
        onChange();
      } }],
  });
}
