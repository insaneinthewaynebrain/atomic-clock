// Backup & restore (JSON file), optional photos, and the 30-day reminder.
import * as store from './store.js';
import { el, openModal, confirmModal, toast } from './ui.js';
import { exportPhotos, importPhotos } from './photos.js';
import { APP_NAME } from './config.js';

const DAY = 86400000;

function fileName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `atomic-clock-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
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
    const ids = store.get().watches.flatMap((w) => w.photos || []);
    out.photos = await exportPhotos(ids);
  }
  const blob = new Blob([JSON.stringify(out, null, withPhotos ? 0 : 2)], { type: 'application/json' });
  const ok = await shareOrDownload(blob, fileName(), `${APP_NAME} backup`);
  if (ok) {
    store.get().lastBackupAt = Date.now();
    store.save();
    store.emit('backup');
    toast('Backup ready — save it to Files or iCloud Drive');
  }
}

export function exportBackup() {
  const nPhotos = store.get().watches.reduce((n, w) => n + (w.photos?.length || 0), 0);
  if (!nPhotos) { doExport(false); return; }
  openModal({
    title: 'Include photos?',
    content: el('p', {}, `You have ${nPhotos} photo${nPhotos > 1 ? 's' : ''}. Including them makes the backup file much larger (roughly ${Math.max(1, Math.round(nPhotos * 0.3))} MB), but it means your photos are safe too.`),
    actions: [
      { label: 'Without photos', onClick: () => { setTimeout(() => doExport(false), 0); } },
      { label: 'With photos', kind: 'primary', onClick: () => { setTimeout(() => doExport(true), 0); } },
    ],
  });
}

export function importBackup() {
  const input = el('input', { type: 'file', accept: 'application/json,.json,text/plain' });
  input.addEventListener('change', async () => {
    const f = input.files && input.files[0];
    if (!f) return;
    try {
      const obj = JSON.parse(await f.text());
      const ok = await confirmModal('Replace all data?', 'Importing replaces your watches, marks, wear history, places and settings with the ones in this backup.', 'Import', true);
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
  container.append(
    el('div', { class: 'card' },
      el('p', {}, 'Everything you enter is stored only on this phone — nothing is sent anywhere. Export a backup now and then and save it to Files or iCloud Drive. You can import it on a new phone.'),
      el('p', { class: 'muted small' }, d.lastBackupAt ? `Last backup: ${new Date(d.lastBackupAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}` : 'No backup made yet.'),
      el('div', { class: 'actions2' },
        el('button', { type: 'button', class: 'btn primary', onclick: exportBackup }, '⬆︎ Export backup'),
        el('button', { type: 'button', class: 'btn', onclick: importBackup }, '⬇︎ Import backup'))),
    el('p', { class: 'muted small center' }, `App version ${appVersion}`));
}
