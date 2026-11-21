// Per-watch galleries: a grid of covers (3 per row); each opens to its photos. Defaults: Wrist shots, Lume,
// Box and papers, Around the world, Insurance — plus any you create. Every photo keeps when (and, where known,
// where) it was taken: read from the photo itself when picked from the library, or now/here when taken in the app.
// Photos are copied into the app (a web app can't link to the Photos library).
import * as store from './store.js';
import { el, openModal, confirmModal, toast } from './ui.js';
import { addPhoto, deletePhoto, fillImg, photoUrl } from './photos.js';
import { getWatch } from './collection.js';
import { readExif } from './exif.js';
import { getPosition, nearestTown } from './weather.js';

const fmtWhen = (t) => new Date(t).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const placeText = (m) => [m.town, m.region].filter(Boolean).join(', ') || (m.lat != null ? `${m.lat.toFixed(4)}, ${m.lng.toFixed(4)}` : '');
const live = (w) => getWatch(w.id) || w;
const TIPS = {
  wrist: 'The watch on your wrist.',
  lume: 'Charge the lume with a torch, then turn the lights off. Flash off, phone rested on something still — the iPhone uses Night mode by itself.',
  box: 'The box, papers, warranty card and receipt.',
  world: 'Places you’ve worn it. Photos with a location appear on the map.',
  insurance: 'Clear photos for your insurer: front, back, sides, clasp, serial number.',
  marks: 'Get close (iPhone Pro switches to macro by itself). Add a note on how each mark happened.',
};

let asked = false;
function keepStorage() {
  // Ask the browser to keep the app's photos even when the phone is low on space.
  if (asked) return; asked = true;
  try { navigator.storage?.persist?.(); } catch (e) { /* not supported */ }
}

export const galleryOf = (w, gid) => (live(w).galleryList || []).find((g) => g.id === gid) || null;
export function coverOf(w, g) {
  const ids = g.photoIds || [];
  if (g.coverPhotoId && ids.includes(g.coverPhotoId)) return g.coverPhotoId;
  const meta = live(w).photoMeta || {};
  return ids.slice().sort((a, b) => (meta[b]?.taken || 0) - (meta[a]?.taken || 0))[0] || null;
}

/** The newest photos across every gallery (and the watch's own photos). */
export function recentPhotos(w, n = 3) {
  const x = live(w);
  const meta = x.photoMeta || {};
  const ids = [...new Set([...(x.galleryList || []).filter((g) => g.id !== 'insurance').flatMap((g) => g.photoIds), ...(x.photos || [])])];
  return ids.sort((a, b) => (meta[b]?.taken || meta[b]?.added || 0) - (meta[a]?.taken || meta[a]?.added || 0)).slice(0, n);
}

/** Adds one picked or captured file to a gallery, with when/where it was taken. Returns the photo id. */
export async function addToGallery(w, gid, file, { fromCamera = false, extraMeta = {} } = {}) {
  const exif = fromCamera ? { taken: null, lat: null, lon: null } : await readExif(file);
  const id = await addPhoto(file);
  const meta = { taken: exif.taken || (fromCamera ? Date.now() : file.lastModified || Date.now()), takenGuess: !exif.taken && !fromCamera,
    lat: exif.lat ?? null, lng: exif.lon ?? null, town: null, region: null, note: '', added: Date.now(), ...extraMeta };
  if (fromCamera && meta.lat == null) {
    try { const pos = await Promise.race([getPosition(), new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 8000))]); meta.lat = pos.lat; meta.lng = pos.lon; } catch (e) { /* no location */ }
  }
  const x = live(w);
  (x.photoMeta ||= {})[id] = meta;
  const g = (x.galleryList || []).find((q) => q.id === gid);
  if (g) g.photoIds.push(id);
  store.save();
  keepStorage();
  if (meta.lat != null) {
    nearestTown(meta.lat, meta.lng).then((t) => { if (t.town) { meta.town = t.town; meta.region = t.region; store.save(); } }).catch(() => {});
  }
  return id;
}

/* ---------- Grid of galleries on the watch's page ---------- */
export function galleryGrid(w, onChange) {
  const x = live(w);
  const grid = el('div', { class: 'gal-covers' });
  for (const g of x.galleryList || []) {
    const cover = coverOf(x, g);
    const pic = el('div', { class: 'gal-cover-pic' });
    if (cover) { const i = el('img', { alt: '', loading: 'lazy' }); fillImg(i, cover); pic.append(i); } else pic.append(el('span', { class: 'gal-cover-ph' }, '＋'));
    grid.append(el('button', { type: 'button', class: 'gal-cover', onclick: () => openGallery(x, g.id, onChange) },
      pic, el('span', { class: 'gal-cover-name' }, g.name), el('span', { class: 'gal-cover-n' }, g.photoIds.length ? `${g.photoIds.length}` : 'Empty')));
  }
  grid.append(el('button', { type: 'button', class: 'gal-cover new', onclick: () => newGallery(x, onChange) },
    el('div', { class: 'gal-cover-pic' }, el('span', { class: 'gal-cover-ph' }, '＋')), el('span', { class: 'gal-cover-name' }, 'New gallery')));
  return grid;
}

function newGallery(w, onChange) {
  const name = el('input', { class: 'input', type: 'text', placeholder: 'e.g. Holidays, Service visits', autocapitalize: 'sentences' });
  openModal({
    title: 'New gallery', content: name,
    actions: [{ label: 'Cancel' }, { label: 'Create', kind: 'primary', onClick: () => {
      const v = name.value.trim(); if (!v) { name.focus(); return false; }
      const g = { id: 'g' + store.uid(), name: v, coverPhotoId: null, photoIds: [], custom: true };
      live(w).galleryList.push(g); store.save();
      setTimeout(() => openGallery(w, g.id, onChange), 0);
    } }],
  });
  setTimeout(() => name.focus(), 200);
}

/* ---------- One gallery ---------- */
export function openGallery(w, gid, onChange = () => {}) {
  const g = galleryOf(w, gid);
  if (!g) return;
  const cam = el('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true });
  const lib = el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  const grid = el('div', { class: 'gal-grid' });
  let coverMode = false;
  let goingTo = false;
  const coverBtn = el('button', { type: 'button', class: 'btn sm', onclick: () => { coverMode = !coverMode; coverBtn.classList.toggle('primary', coverMode); coverBtn.textContent = coverMode ? 'Tap a photo for the cover' : '★ Set cover'; } }, '★ Set cover');
  const handle = (inp, fromCamera) => async () => {
    const files = [...(inp.files || [])];
    inp.value = '';
    for (const f of files) {
      try { toast('Adding photo…', 1200); await addToGallery(w, gid, f, { fromCamera }); } catch (e) { toast(e.message || 'Could not add that photo'); }
    }
    drawGrid(); onChange();
  };
  cam.addEventListener('change', handle(cam, true));
  lib.addEventListener('change', handle(lib, false));

  function drawGrid() {
    const x = live(w), gg = galleryOf(x, gid), meta = x.photoMeta || {};
    const cover = coverOf(x, gg);
    const ids = gg.photoIds.slice().sort((a, b) => (meta[b]?.taken || 0) - (meta[a]?.taken || 0));
    grid.replaceChildren(...(ids.length ? ids.map((id) => {
      const img = el('img', { alt: '' }); fillImg(img, id);
      return el('button', { type: 'button', class: 'gal-cell' + (id === cover ? ' is-cover' : ''), onclick: () => {
        if (coverMode) { gg.coverPhotoId = id; store.save(); coverMode = false; coverBtn.classList.remove('primary'); coverBtn.textContent = '★ Set cover'; drawGrid(); onChange(); toast('Cover set'); return; }
        goingTo = true; document.getElementById('modal').close(); setTimeout(() => openItem(w, gid, id, onChange), 0);
      } }, img,
      meta[id]?.taken ? el('span', { class: 'gal-date' }, new Date(meta[id].taken).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })) : null,
      id === cover ? el('span', { class: 'gal-star', title: 'Cover' }, '★') : null);
    }) : [el('p', { class: 'muted empty-note' }, 'No photos yet.')]));
  }
  drawGrid();
  const extra = [];
  if (g.custom || !['wrist', 'lume', 'box', 'world', 'insurance'].includes(g.id)) {
    extra.push({ label: 'Rename', onClick: () => { goingTo = true; setTimeout(() => renameGallery(w, gid, onChange), 0); } });
    extra.push({ label: 'Delete', kind: 'danger', onClick: () => { goingTo = true; setTimeout(() => deleteGallery(w, gid, onChange), 0); } });
  }
  openModal({
    title: g.name, className: 'tall',
    content: [el('p', { class: 'muted small' }, TIPS[g.id] || ''),
      el('div', { class: 'gal-add' },
        el('button', { type: 'button', class: 'btn primary', onclick: () => cam.click() }, '📷 Take photo'),
        el('button', { type: 'button', class: 'btn', onclick: () => lib.click() }, '🖼️ Add photos')),
      el('div', { class: 'gal-tools' }, coverBtn), grid, cam, lib],
    actions: [...extra, { label: 'Done', kind: 'primary' }],
    onClose: () => { if (!goingTo) onChange(); },
  });
}

function renameGallery(w, gid, onChange) {
  const g = galleryOf(w, gid);
  const name = el('input', { class: 'input', type: 'text', value: g.name });
  openModal({ title: 'Rename gallery', content: name, actions: [{ label: 'Cancel', onClick: () => { setTimeout(() => openGallery(w, gid, onChange), 0); } },
    { label: 'Save', kind: 'primary', onClick: () => { const v = name.value.trim(); if (v) { g.name = v; store.save(); } setTimeout(() => openGallery(w, gid, onChange), 0); } }] });
}

async function deleteGallery(w, gid, onChange) {
  const g = galleryOf(w, gid);
  const yes = await confirmModal(`Delete “${g.name}”?`, g.photoIds.length ? `Its ${g.photoIds.length} photo${g.photoIds.length === 1 ? '' : 's'} will be deleted too.` : '', 'Delete', true);
  if (!yes) { openGallery(w, gid, onChange); return; }
  const x = live(w);
  const keep = new Set((x.galleryList || []).filter((q) => q.id !== gid).flatMap((q) => q.photoIds));
  for (const id of g.photoIds) if (!keep.has(id)) { deletePhoto(id).catch(() => {}); delete x.photoMeta[id]; }
  x.galleryList = x.galleryList.filter((q) => q.id !== gid);
  store.save(); onChange();
}

/* ---------- One photo: big view, when/where, caption ---------- */
export function openItem(w, gid, id, onChange = () => {}) {
  const x = live(w);
  const m = (x.photoMeta ||= {})[id] || (x.photoMeta[id] = { taken: null, note: '' });
  const img = el('img', { class: 'viewer-img', alt: '' });
  photoUrl(id, 'full').then((u) => { if (u) img.src = u; });
  const where = el('div', { class: 'gal-meta' });
  const showWhere = () => where.replaceChildren(
    el('div', {}, '🕒 ', m.taken ? fmtWhen(m.taken) : 'Date not recorded', m.takenGuess ? el('span', { class: 'muted small' }, ' (date the file was saved)') : null),
    el('div', {}, '📍 ', placeText(m) || el('span', { class: 'muted' }, 'Location not recorded')));
  showWhere();
  if (m.lat != null && !m.town) nearestTown(m.lat, m.lng).then((t) => { if (t.town) { m.town = t.town; m.region = t.region; store.save(); showWhere(); } }).catch(() => {});
  const caption = el('textarea', { class: 'input', rows: 2, placeholder: gid === 'marks' ? 'How did it happen? Was it repaired?' : 'Add a caption (optional)' }, m.note || '');
  let leaving = false;
  const back = () => setTimeout(() => openGallery(w, gid, onChange), 0);
  openModal({
    title: (galleryOf(w, gid) || { name: 'Photo' }).name, className: 'tall',
    content: [img, where, caption],
    actions: [
      { label: 'Delete', kind: 'danger', onClick: () => { leaving = true; setTimeout(async () => {
        if (await confirmModal('Delete this photo?', '', 'Delete', true)) {
          const xx = live(w);
          for (const q of xx.galleryList) { q.photoIds = q.photoIds.filter((p) => p !== id); if (q.coverPhotoId === id) q.coverPhotoId = null; }
          for (const loc of xx.locations || []) loc.photoIds = (loc.photoIds || []).filter((p) => p !== id);
          if (xx.insPhotos) for (const [k, v] of Object.entries(xx.insPhotos)) if (v === id) delete xx.insPhotos[k];
          delete xx.photoMeta[id]; store.save(); deletePhoto(id).catch(() => {});
        }
        back();
      }, 0); } },
      { label: '★ Cover', onClick: () => { const g = galleryOf(w, gid); if (g) { g.coverPhotoId = id; store.save(); toast('Cover set'); } return false; } },
      { label: '‹ Back', kind: 'primary' },
    ],
    onClose: () => { if (caption.value.trim() !== (m.note || '')) { m.note = caption.value.trim(); store.save(); } if (!leaving) back(); },
  });
}

/** Photos with their gallery names, for the photo album (oldest first). */
export function galleriesForAlbum(w) {
  const x = live(w), meta = x.photoMeta || {};
  return (x.galleryList || []).filter((g) => g.photoIds.length).map((g) => ({
    name: g.name, id: g.id,
    photos: g.photoIds.slice().sort((a, b) => (meta[a]?.taken || 0) - (meta[b]?.taken || 0))
      .map((id) => ({ id, caption: [meta[id]?.taken ? new Date(meta[id].taken).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '', placeText(meta[id] || {}), meta[id]?.note].filter(Boolean).join(' · ') })),
  }));
}

export function register() { /* galleries now live on the watch page (detail.js) */ }
