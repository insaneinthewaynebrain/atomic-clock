// Backup & restore (JSON file), optional photos, and the 30-day reminder.
import * as store from './store.js';
import { el, openModal, confirmModal, toast } from './ui.js';
import { exportPhotos, importPhotos } from './photos.js';
import { allPhotoIds } from './collection.js';
import { APP_NAME } from './config.js';

const DAY = 86400000;

function fileName(withPhotos = true) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `atomic-clock-${withPhotos ? 'complete' : 'data-only'}-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
}

export function download(blob, fname) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: fname });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
}

/** Share a file through the iPhone share sheet, or download it elsewhere. */
export async function shareOrDownload(blob, fname, title) {
  const file = typeof File === 'function' ? new File([blob], fname, { type: blob.type }) : null;
  if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title }); return true; }
    catch (e) { if (e.name === 'AbortError') return false; }
  }
  download(blob, fname);
  return true;
}

async function doExport(withPhotos) {
  const out = store.exportData();
  if (withPhotos) {
    toast('Preparing photos…', 4000);
    const ids = store.get().watches.flatMap(allPhotoIds);
    out.photos = await exportPhotos(ids);
  }
  const blob = new Blob([JSON.stringify(out, null, withPhotos ? 0 : 2)], { type: 'application/json' });
  const ok = await shareOrDownload(blob, fileName(withPhotos), `${APP_NAME} backup`);
  if (ok) {
    store.get().lastBackupAt = Date.now();
    store.save();
    store.emit('backup');
    toast('Backup ready — save it to Files or iCloud Drive');
  }
}

/** One complete file: every watch, photo, gallery, wear log, place, alarm, timer and setting. */
export function exportBackup() { doExport(true); }
/** Smaller file without photos (for a quick extra copy). */
export function exportDataOnly() { doExport(false); }
const photoCount = () => store.get().watches.reduce((n, w) => n + allPhotoIds(w).length, 0);

/* ---------- Automatic safety copy before each app update ---------- */
// Updates never touch photos (stored separately); this keeps a copy of everything else from just before a new
// version first ran, so a bad update can be rolled back without a backup file. The last 3 are kept.
const SNAP_DB = 'atomic-clock-snapshots';
function snapDb() {
  return new Promise((res, rej) => {
    const q = indexedDB.open(SNAP_DB, 1);
    q.onupgradeneeded = () => q.result.createObjectStore('snaps', { keyPath: 'at' });
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  });
}
async function snapTx(mode, fn) {
  const db = await snapDb();
  return new Promise((res, rej) => { const t = db.transaction('snaps', mode); const r = fn(t.objectStore('snaps')); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); });
}
export async function listSnapshots() {
  try { return ((await snapTx('readonly', (st) => st.getAll())) || []).sort((a, b) => b.at - a.at); } catch (e) { return []; }
}
/** Called at start-up: if this is the first run of a new version, keep a copy of the data from before it. */
export async function snapshotOnUpdate(appVersion) {
  const d = store.get();
  const last = d.lastRunVersion;
  if (last === appVersion) return;
  try {
    if (last && (d.watches.length || d.wear.length)) {
      await snapTx('readwrite', (st) => st.put({ at: Date.now(), fromVersion: last, toVersion: appVersion, json: JSON.stringify(store.exportData()) }));
      const all = await listSnapshots();
      for (const old of all.slice(3)) await snapTx('readwrite', (st) => st.delete(old.at));
    }
  } catch (e) { console.warn('Safety copy failed', e); }
  d.lastRunVersion = appVersion; store.save();
}
async function restoreSnapshot(s) {
  const ok = await confirmModal('Roll back to this copy?', `Your data goes back to how it was on ${new Date(s.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}, just before version ${s.toVersion} first opened. Anything added since then is lost. Photos aren’t affected.`, 'Roll back', true);
  if (!ok) return;
  store.importData(JSON.parse(s.json));
  toast('Rolled back');
  setTimeout(() => location.reload(), 700);
}

export function importBackup() {
  const input = el('input', { type: 'file', accept: 'application/json,.json,text/plain' });
  input.addEventListener('change', async () => {
    const f = input.files && input.files[0];
    if (!f) return;
    try {
      const obj = JSON.parse(await f.text());
      const ok = await confirmModal('Replace all data?', 'Importing replaces everything in the app — watches, photos, galleries, wear history, places, alarms, timers and settings — with what’s in this backup.', 'Import', true);
      if (!ok) return;
      const photos = store.importData(obj);
      if (photos) { toast('Restoring photos…', 4000); await importPhotos(photos); }
      toast('Backup imported');
      setTimeout(() => location.reload(), 700);
    } catch (e) {
      openModal({ title: 'Import failed', content: el('p', {}, e.message || 'That file could not be read.'), actions: [{ label: 'OK', kind: 'primary' }] });
    }
  });
  input.click();
}

/** True when there is something worth backing up and no backup for 30 days. */
export function backupDue() {
  const d = store.get();
  const hasData = d.watches.length > 0 || d.wear.length > 0;
  if (!hasData) return false;
  const since = d.lastBackupAt || d.createdAt || Date.now();
  return Date.now() - since > 30 * DAY;
}

export function backupBanner() {
  if (!backupDue()) return null;
  const d = store.get();
  const txt = d.lastBackupAt
    ? `Your last backup was ${Math.floor((Date.now() - d.lastBackupAt) / DAY)} days ago.`
    : 'You haven’t made a backup yet.';
  return el('div', { class: 'notice warn banner' },
    el('div', {}, el('b', {}, 'Time for a backup. '), txt, ' Your watches are stored only on this phone.'),
    el('button', { type: 'button', class: 'btn sm', onclick: exportBackup }, 'Back up now'));
}

export function backupPanel(container, appVersion) {
  container.innerHTML = '';
  const d = store.get();
  const snapCard = el('div', { class: 'card' }, el('h2', { class: 'card-title' }, 'Safety copies before updates'),
    el('p', { class: 'muted small' }, 'Each time the app updates, it first keeps a copy of your data on this phone (the last 3). If an update goes wrong, roll back here.'));
  listSnapshots().then((list) => {
    if (!list.length) { snapCard.append(el('p', { class: 'muted small' }, 'None yet — one is made the next time the app updates.')); return; }
    for (const s of list) {
      snapCard.append(el('div', { class: 'snap-row' },
        el('div', {}, el('div', {}, new Date(s.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })),
          el('div', { class: 'muted small' }, `Before version ${s.toVersion} (was ${s.fromVersion})`)),
        el('button', { type: 'button', class: 'btn sm', onclick: () => restoreSnapshot(s) }, 'Roll back')));
    }
  });
  container.append(
    el('div', { class: 'card' },
      el('p', {}, 'Everything you enter is stored only on this phone — nothing is sent anywhere. Export a backup now and then and save it to Files or iCloud Drive. You can import it on a new phone.'),
      el('p', { class: 'muted small' }, d.lastBackupAt ? `Last backup: ${new Date(d.lastBackupAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}` : 'No backup made yet.'),
      el('p', { class: 'muted small' }, `The backup is one file with everything in the app${photoCount() ? `, including your ${photoCount()} photos (roughly ${Math.max(1, Math.round(photoCount() * 0.4))} MB)` : ''}. If an app or iPhone update ever goes wrong, import it here to get everything back.`),
      el('div', { class: 'actions2' },
        el('button', { type: 'button', class: 'btn primary', onclick: exportBackup }, '⬆︎ Export everything'),
        el('button', { type: 'button', class: 'btn', onclick: importBackup }, '⬇︎ Import backup')),
      photoCount() ? el('button', { type: 'button', class: 'link-btn small', onclick: exportDataOnly }, 'Or export a smaller file without photos') : null),
    snapCard,
    el('p', { class: 'muted small center' }, `App version ${appVersion}`));
}
