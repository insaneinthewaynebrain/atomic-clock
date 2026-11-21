// Adding photos to a watch's map: pick photos from the library; each is placed on the map using the location
// and date stored in the photo (EXIF), and saved to the "Around the world" gallery.
import { el, openModal, toast } from './ui.js';
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
    review(w, items, onChange);
  });
  inp.click();
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
        for (const it of keep) { try { await addToGallery(w, 'world', it.f); } catch (e) { /* skip unreadable */ } }
        items.forEach((x) => URL.revokeObjectURL(x.url));
        toast(`${keep.length} photo${keep.length === 1 ? '' : 's'} added`);
        onChange();
      } }],
  });
}
