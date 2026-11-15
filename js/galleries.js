// Per-watch photo galleries: wrist shots, favourite moments, marks (with notes), general, lume.
// Every photo keeps when (and, where known, where) it was taken: read from the photo itself when picked from the
// library, or the current time and location when taken through the app. Photos are copied into the app (a web app
// can't link to the Photos library); a native version could link to Photos or sync to the cloud instead.
import * as store from './store.js';
import { el, openModal, confirmModal, toast } from './ui.js';
import { addPhoto, deletePhoto, fillImg, photoUrl } from './photos.js';
import { detailSections, getWatch } from './collection.js';
import { memoryGalleries } from './watchdocs.js';
import { readExif } from './exif.js';
import { getPosition, nearestTown } from './weather.js';

export const GALLERIES = [
  { k: 'wrist', title: 'Wrist shots', icon: '⌚', tip: 'The watch on your wrist.' },
  { k: 'moments', title: 'Favourite moments', icon: '⭐', tip: 'Times and places you wore it.' },
  { k: 'marks', title: 'Marks & blemishes', icon: '🔍', notes: true,
    tip: 'Get close: on iPhone Pro models the camera switches to the macro lens by itself (look for the flower icon). Add a note on how each mark happened.' },
  { k: 'general', title: 'General', icon: '🖼️', tip: 'Anything else.' },
  { k: 'lume', title: 'Lume shots', icon: '🌙',
    tip: 'Charge the lume with a torch, then turn the lights off. Flash off, phone rested on something still: the iPhone camera uses Night mode (a longer exposure) by itself in the dark.' },
];

const d = () => store.get();
const fmtWhen = (t) => new Date(t).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const placeText = (p) => [p.town, p.region].filter(Boolean).join(', ') || (p.lat != null ? `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}` : '');

/** All photo ids in a watch's galleries (for backups and deleting). */
export function galleryPhotoIds(w) {
  return Object.values(w.galleries || {}).flat().map((p) => p.id);
}

let asked = false;
function keepStorage() {
  // Ask the browser to keep the app's photos even when the phone is low on space.
  if (asked) return; asked = true;
  try { navigator.storage?.persist?.(); } catch (e) { /* not supported */ }
}

/** Adds one picked or captured file to a gallery, with when/where it was taken. */
async function addToGallery(w, g, file, fromCamera) {
  const exif = fromCamera ? { taken: null, lat: null, lon: null } : await readExif(file);
  const id = await addPhoto(file);
  const item = { id, added: Date.now(), taken: exif.taken || (fromCamera ? Date.now() : file.lastModified || Date.now()),
    takenGuess: !exif.taken && !fromCamera, lat: exif.lat, lon: exif.lon };
  if (fromCamera && item.lat == null) {
    try { const pos = await Promise.race([getPosition(), new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 8000))]); item.lat = pos.lat; item.lon = pos.lon; } catch (e) { /* no location */ }
  }
  const live = getWatch(w.id) || w;
  live.galleries = live.galleries || {};
  (live.galleries[g.k] ||= []).push(item);
  store.save();
  keepStorage();
  if (item.lat != null) {
    nearestTown(item.lat, item.lon).then((t) => { if (t.town) { item.town = t.town; item.region = t.region; store.save(); } }).catch(() => {});
  }
  return item;
}

/* ---------- On the watch's page ---------- */
function gallerySection(w) {
  if ((w.status || 'owned') !== 'owned') return null;
  const box = el('div', { class: 'gal-sec' });
  const draw = () => {
    const live = getWatch(w.id) || w;
    box.replaceChildren(el('h3', { class: 'sub-title' }, 'Galleries'),
      el('div', { class: 'gal-list' }, GALLERIES.map((g) => {
        const items = (live.galleries?.[g.k] || []).slice().sort((a, b) => b.taken - a.taken);
        const strip = el('div', { class: 'gal-strip' }, items.slice(0, 4).map((it) => { const i = el('img', { alt: '' }); fillImg(i, it.id); return i; }));
        return el('button', { type: 'button', class: 'gal-row', onclick: () => { document.getElementById('modal').close(); setTimeout(() => openGallery(live, g), 0); } },
          el('span', { class: 'gal-icon' }, g.icon),
          el('span', { class: 'gal-name' }, g.title, el('span', { class: 'muted small' }, items.length ? ` · ${items.length}` : ' · empty')),
          strip, el('span', { class: 'gal-chev' }, '›'));
      })));
  };
  draw();
  return box;
}

const reopenWatch = (w) => import('./collection.js').then((m) => { const fresh = getWatch(w.id); if (fresh) m.openWatchDetail(fresh); });

/* ---------- One gallery ---------- */
export function openGallery(w, g) {
  const cam = el('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true });
  const lib = el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  const grid = el('div', { class: 'gal-grid' });
  let goingTo = null;     // another screen opened from here (keeps the watch page from reopening underneath)
  const handle = (inp, fromCamera) => async () => {
    const files = [...(inp.files || [])];
    inp.value = '';
    for (const f of files) {
      try {
        toast('Adding photo…', 1200);
        const item = await addToGallery(w, g, f, fromCamera);
        if (g.notes && files.length === 1) { goingTo = 'item'; document.getElementById('modal').close(); setTimeout(() => openItem(w, g, item, true), 0); return; }
      } catch (e) { toast(e.message || 'Could not add that photo'); }
    }
    drawGrid();
  };
  cam.addEventListener('change', handle(cam, true));
  lib.addEventListener('change', handle(lib, false));

  function drawGrid() {
    const items = ((getWatch(w.id) || w).galleries?.[g.k] || []).slice().sort((a, b) => b.taken - a.taken);
    grid.replaceChildren(...(items.length ? items.map((it) => {
      const img = el('img', { alt: '' }); fillImg(img, it.id);
      return el('button', { type: 'button', class: 'gal-cell', onclick: () => { goingTo = 'item'; document.getElementById('modal').close(); setTimeout(() => openItem(w, g, it), 0); } },
        img, el('span', { class: 'gal-date' }, new Date(it.taken).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })),
        g.notes && it.note ? el('span', { class: 'gal-note-dot', title: 'Has a note' }, '✎') : null);
    }) : [el('p', { class: 'muted empty-note' }, 'No photos yet.')]));
  }
  drawGrid();
  openModal({
    title: `${g.icon} ${g.title}`, className: 'tall',
    content: [el('p', { class: 'muted small' }, g.tip),
      el('div', { class: 'gal-add' },
        el('button', { type: 'button', class: 'btn primary', onclick: () => cam.click() }, '📷 Take photo'),
        el('button', { type: 'button', class: 'btn', onclick: () => lib.click() }, '🖼️ From library')),
      grid, cam, lib],
    actions: [{ label: `‹ ${w.name}`, kind: 'primary' }],
    onClose: () => { if (!goingTo) reopenWatch(w); },
  });
}

/* ---------- One photo: big view, when/where, note ---------- */
function openItem(w, g, it, justAdded = false) {
  const img = el('img', { class: 'viewer-img', alt: '' });
  photoUrl(it.id, 'full').then((u) => { if (u) img.src = u; });
  const where = el('div', { class: 'gal-meta' });
  const showWhere = () => where.replaceChildren(
    el('div', {}, '🕒 ', fmtWhen(it.taken), it.takenGuess ? el('span', { class: 'muted small' }, ' (date the file was saved — the photo didn’t say when it was taken)') : null),
    el('div', {}, '📍 ', placeText(it) || el('span', { class: 'muted' }, 'Location not recorded')));
  showWhere();
  if (it.lat != null && !it.town) nearestTown(it.lat, it.lon).then((t) => { if (t.town) { it.town = t.town; it.region = t.region; store.save(); showWhere(); } }).catch(() => {});
  const note = g.notes ? el('textarea', { class: 'input', rows: 3, placeholder: 'How did it happen? When? Was it repaired?' }, it.note || '') : null;
  const caption = !g.notes ? el('input', { class: 'input', type: 'text', value: it.note || '', placeholder: 'Add a caption (optional)' }) : null;
  const save = () => { const v = (note || caption).value.trim(); if (v !== (it.note || '')) { it.note = v; store.save(); } };
  let deleting = false;
  openModal({
    title: g.title, className: 'tall',
    content: [img, where, note ? el('label', { class: 'field' }, el('span', {}, 'Notes on this mark'), note) : caption],
    actions: [
      { label: 'Delete', kind: 'danger', onClick: () => { deleting = true; setTimeout(async () => {
        if (await confirmModal('Delete this photo?', '', 'Delete', true)) {
          const live = getWatch(w.id) || w;
          live.galleries[g.k] = (live.galleries[g.k] || []).filter((x) => x.id !== it.id);
          store.save(); deletePhoto(it.id).catch(() => {});
        }
        openGallery(getWatch(w.id) || w, g);
      }, 0); } },
      { label: justAdded ? 'Done' : '‹ Back', kind: 'primary' },
    ],
    onClose: () => { if (deleting) return; save(); setTimeout(() => openGallery(getWatch(w.id) || w, g), 0); },
  });
  if (justAdded && note) setTimeout(() => note.focus(), 300);
}

export function register() {
  detailSections.push(gallerySection);
  for (const g of GALLERIES) {
    memoryGalleries.push({
      title: g.title,
      photos: (w) => (w.galleries?.[g.k] || []).slice().sort((a, b) => a.taken - b.taken).map((x) => x.id),
      captions: (w) => (w.galleries?.[g.k] || []).slice().sort((a, b) => a.taken - b.taken)
        .map((x) => [new Date(x.taken).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }), placeText(x), x.note].filter(Boolean).join(' · ')),
    });
  }
}
