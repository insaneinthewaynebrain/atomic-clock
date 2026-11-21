// Watch photos: shrunk on the phone and kept in IndexedDB (too big for localStorage).
import { uid } from './store.js';

const DB = 'atomic-clock';
const STORE = 'photos';
const FULL_PX = 1600;
const THUMB_PX = 400;

let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const st = t.objectStore(STORE);
    let result;
    Promise.resolve(fn(st)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

function reqP(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That photo could not be read.')); };
    img.src = url;
  });
}

function resize(img, max, quality, type = 'image/jpeg') {
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  return new Promise((resolve) => c.toBlob((b) => resolve(b), type, quality));
}

/** Shrinks a picked photo and saves it. Returns the new photo id. */
export async function addPhoto(file) {
  const img = await loadImage(file);
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';   // PNG keeps a cut-out's transparent background
  const full = await resize(img, FULL_PX, 0.82, type);
  const thumb = await resize(img, THUMB_PX, 0.78, type);
  const id = 'p' + uid();
  await tx('readwrite', (st) => st.put({ id, full, thumb, added: Date.now() }));
  return id;
}

/** Stores any file as it is (e.g. an insurance PDF). Returns its id; images get a thumbnail too. */
export async function addFile(file) {
  if ((file.type || '').startsWith('image/')) return addPhoto(file);
  const id = 'f' + uid();
  await tx('readwrite', (st) => st.put({ id, full: file, thumb: null, added: Date.now(), name: file.name || 'document', mime: file.type || 'application/octet-stream' }));
  return id;
}

export async function deletePhoto(id) {
  forget(id);
  await tx('readwrite', (st) => st.delete(id));
}

export async function getPhoto(id) {
  return tx('readonly', (st) => reqP(st.get(id)));
}

const urls = new Map();   // `${id}:${kind}` -> object URL
/** Object URL for a photo ('thumb' or 'full'), or null if missing. */
export async function photoUrl(id, kind = 'thumb') {
  const key = id + ':' + kind;
  if (urls.has(key)) return urls.get(key);
  try {
    const rec = await getPhoto(id);
    if (!rec || !rec[kind]) return null;
    const u = URL.createObjectURL(rec[kind]);
    urls.set(key, u);
    return u;
  } catch (e) { return null; }
}
function forget(id) {
  for (const k of ['thumb', 'full']) {
    const key = id + ':' + k;
    if (urls.has(key)) { URL.revokeObjectURL(urls.get(key)); urls.delete(key); }
  }
}

/** Fills an <img> (or a placeholder element) with a photo once it has loaded. */
export function fillImg(imgEl, id, kind = 'thumb') {
  if (!id) return;
  photoUrl(id, kind).then((u) => { if (u) imgEl.src = u; });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
async function dataUrlToBlob(u) { return (await fetch(u)).blob(); }

/** For backups: {id: fullJpegDataUrl} for the given ids. */
export async function exportPhotos(ids) {
  const out = {};
  for (const id of ids) {
    const rec = await getPhoto(id).catch(() => null);
    if (rec && rec.full) out[id] = await blobToDataUrl(rec.full);
  }
  return out;
}

/** Restores photos from a backup (thumbnails are rebuilt). */
export async function importPhotos(map) {
  let n = 0;
  for (const [id, dataUrl] of Object.entries(map || {})) {
    try {
      const full = await dataUrlToBlob(dataUrl);
      if (!full.type.startsWith('image/')) {      // a stored document (e.g. PDF): keep it as it is
        forget(id);
        await tx('readwrite', (st) => st.put({ id, full, thumb: null, added: Date.now(), mime: full.type }));
        n++; continue;
      }
      const img = await loadImage(full);
      const thumb = await resize(img, THUMB_PX, 0.78, full.type === 'image/png' ? 'image/png' : 'image/jpeg');
      forget(id);
      await tx('readwrite', (st) => st.put({ id, full, thumb, added: Date.now() }));
      n++;
    } catch (e) { console.warn('Photo import failed', id, e); }
  }
  return n;
}

/** Small JPEG data URL (for printable lists and share cards). */
export async function photoDataUrl(id, kind = 'thumb') {
  const rec = await getPhoto(id).catch(() => null);
  return rec && rec[kind] ? blobToDataUrl(rec[kind]) : null;
}
