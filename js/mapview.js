// "Where it's been": a small map fitted to the watch's places, with distance travelled (an estimate),
// and a full-screen map you can zoom and pan; tap a pin to see the photos taken there.
// The map is an offline world outline (Natural Earth, country level) — no map service, no tracking.
import * as store from './store.js';
import { el, openModal, confirmModal, placeSearchModal, placeLabel, toast } from './ui.js';
import { fillImg } from './photos.js';
import { getWatch, openPhotoViewer } from './collection.js';
import { placesOf } from './model.js';

const NS = 'http://www.w3.org/2000/svg';
const live = (w) => getWatch(w.id) || w;
let worldPath = null;
const loadWorld = () => (worldPath ? Promise.resolve(worldPath) : import('./worldmap.js').then((m) => (worldPath = m.WORLD_PATH)));

// Equirectangular: x = lng + 180, y = 90 - lat (0..360 × 0..180).
const px = (p) => [p.lng + 180, 90 - p.lat];

/** View box around the places, never tighter than ~16° wide, kept at a 2:1 shape. */
function fitBox(places) {
  if (!places.length) return [0, 8, 360, 152];
  const xs = places.map((p) => px(p)[0]), ys = places.map((p) => px(p)[1]);
  let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  let w = Math.max(16, (x1 - x0) * 1.35), h = Math.max(8, (y1 - y0) * 1.35);
  if (w / h > 2) h = w / 2; else w = h * 2;
  w = Math.min(w, 360); h = Math.min(h, 180);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return [Math.max(0, Math.min(360 - w, cx - w / 2)), Math.max(0, Math.min(180 - h, cy - h / 2)), w, h];
}

function svgMap(places, box, { onPin, route = true } = {}) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'world');
  svg.setAttribute('viewBox', box.join(' '));
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Map with ${places.length} place${places.length === 1 ? '' : 's'}`);
  const scale = box[2] / 360;                    // keep pins the same size on screen when zoomed in
  const land = document.createElementNS(NS, 'path');
  land.setAttribute('class', 'land');
  loadWorld().then((p) => land.setAttribute('d', p)).catch(() => {});
  svg.append(land);
  if (route && places.length > 1) {
    const line = document.createElementNS(NS, 'polyline');
    line.setAttribute('points', places.map((p) => px(p).join(',')).join(' '));
    line.setAttribute('class', 'route'); line.setAttribute('stroke-width', String(1.1 * scale * 3));
    svg.append(line);
  }
  places.forEach((p, i) => {
    const [x, y] = px(p);
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'pin-g');
    const halo = document.createElementNS(NS, 'circle');
    halo.setAttribute('cx', x); halo.setAttribute('cy', y); halo.setAttribute('r', String((6 + Math.min(5, p.n)) * scale * 3.2)); halo.setAttribute('class', 'pin-halo');
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.setAttribute('r', String(3.2 * scale * 3.2)); dot.setAttribute('class', 'pin');
    const t = document.createElementNS(NS, 'title'); t.textContent = p.placeName || 'Place';
    g.append(halo, dot, t);
    if (onPin) { g.style.cursor = 'pointer'; g.addEventListener('click', (e) => { e.stopPropagation(); onPin(p, i); }); }
    svg.append(g);
  });
  return svg;
}

export const fmtKm = (km) => (km >= 100 ? `${Math.round(km).toLocaleString('en-GB')} km` : `${km.toFixed(km >= 10 ? 0 : 1)} km`);

/** The small map on the watch's page. */
export function miniMap(w, onChange) {
  const { places, distance } = placesOf(live(w));
  const box = el('div', { class: 'map-mini' });
  const map = el('button', { type: 'button', class: 'map-frame', 'aria-label': 'Open the map full screen', onclick: () => openFullMap(w, onChange) },
    svgMap(places, fitBox(places), { route: true }),
    el('span', { class: 'map-expand' }, '⤢'));
  const countries = new Set(places.map((p) => (p.placeName || '').split(', ').pop()).filter(Boolean));
  box.append(map,
    el('div', { class: 'map-stats' },
      el('div', {}, el('div', { class: 'map-big' }, places.length ? fmtKm(distance) : '—'), el('div', { class: 'eyebrow' }, 'Travelled (estimate)')),
      el('div', {}, el('div', { class: 'map-big' }, String(places.length)), el('div', { class: 'eyebrow' }, places.length === 1 ? 'Place' : 'Places')),
      el('div', {}, el('div', { class: 'map-big' }, String(countries.size)), el('div', { class: 'eyebrow' }, countries.size === 1 ? 'Country' : 'Countries'))),
    places.length ? null : el('p', { class: 'muted small' }, 'Add places, or photos with a location to “Around the world”, and they appear here.'),
    el('div', { class: 'map-actions' },
      el('button', { type: 'button', class: 'btn sm', onclick: () => addPlace(w, onChange) }, '＋ Add a place'),
      el('button', { type: 'button', class: 'btn sm', onclick: () => import('./photomatch.js').then((m) => m.matchPhotos(w, onChange)) }, '🖼️ Add photos to the map')));
  return box;
}

export function addPlace(w, onChange = () => {}) {
  placeSearchModal({
    title: 'Add a place',
    onPick: (p) => {
      (live(w).locations ||= []).push({ id: store.uid(), lat: p.lat, lng: p.lon, date: new Date().toISOString().slice(0, 10),
        placeName: [p.name, placeLabel(p).replace(new RegExp(`^${p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')},?\\s*`), '')].filter(Boolean).join(', '), photoIds: [] });
      store.save(); onChange(); toast(`${p.name} added`);
    },
  });
}

/** Full-screen map: pinch-free zoom buttons, drag to pan, tap a pin for its photos. */
export function openFullMap(w, onChange = () => {}) {
  const { places, distance } = placesOf(live(w));
  let box = fitBox(places);
  const overlay = el('div', { class: 'map-full', role: 'dialog', 'aria-label': 'Map' });
  const holder = el('div', { class: 'map-full-svg' });
  const sheet = el('div', { class: 'map-sheet', hidden: true });
  const draw = () => { holder.replaceChildren(svgMap(places, box, { onPin: showPin })); };
  const zoom = (f) => {
    const [x, y, ww, hh] = box, cx = x + ww / 2, cy = y + hh / 2;
    const nw = Math.max(6, Math.min(360, ww * f)), nh = nw / 2;
    box = [Math.max(0, Math.min(360 - nw, cx - nw / 2)), Math.max(0, Math.min(180 - nh, cy - nh / 2)), nw, nh]; draw();
  };
  // Drag to pan.
  let drag = null;
  // Panning starts only once the finger has moved, so a simple tap still reaches a pin.
  holder.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, box: [...box], id: e.pointerId, moving: false }; });
  holder.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.moving) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
      drag.moving = true; try { holder.setPointerCapture(drag.id); } catch (er) { /* ignore */ }
    }
    const r = holder.getBoundingClientRect();
    const k = Math.max(drag.box[2] / r.width, drag.box[3] / r.height);
    const nx = drag.box[0] - (e.clientX - drag.x) * k, ny = drag.box[1] - (e.clientY - drag.y) * k;
    box = [Math.max(0, Math.min(360 - box[2], nx)), Math.max(0, Math.min(180 - box[3], ny)), box[2], box[3]];
    holder.firstChild?.setAttribute('viewBox', box.join(' '));
  });
  holder.addEventListener('pointerup', () => { drag = null; });
  holder.addEventListener('pointercancel', () => { drag = null; });

  function showPin(p) {
    sheet.hidden = false;
    const grid = el('div', { class: 'map-sheet-photos' }, p.photoIds.length ? p.photoIds.map((id, i) => {
      const img = el('img', { alt: '' }); fillImg(img, id);
      return el('button', { type: 'button', class: 'map-ph', onclick: () => { close(); openPhotoViewer(p.photoIds, i); } }, img);
    }) : [el('p', { class: 'muted small' }, 'No photos at this place yet.')]);
    sheet.replaceChildren(
      el('div', { class: 'map-sheet-head' },
        el('div', {}, el('div', { class: 'map-sheet-name' }, p.placeName || 'Unnamed place'),
          el('div', { class: 'muted small' }, [p.t ? new Date(p.t).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null, `${p.photoIds.length} photo${p.photoIds.length === 1 ? '' : 's'}`].filter(Boolean).join(' · '))),
        el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'Close', onclick: () => { sheet.hidden = true; } }, '×')),
      grid,
      p.manualIds.length ? el('button', { type: 'button', class: 'link-btn danger-t', onclick: async () => {
        if (!(await confirmModal(`Remove ${p.placeName || 'this place'}?`, 'Photos stay in their galleries.', 'Remove', true))) return;
        const ids = new Set(p.manualIds);
        live(w).locations = (live(w).locations || []).filter((l) => !ids.has(l.id)); store.save(); close(); onChange(); openFullMap(w, onChange);
      } }, 'Remove this place') : null);
  }
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.append(
    el('div', { class: 'map-full-bar' },
      el('button', { type: 'button', class: 'btn sm', onclick: close }, '‹ Back'),
      el('div', { class: 'map-full-title' }, el('b', {}, live(w).name), el('span', { class: 'muted small' }, ` · ${places.length} place${places.length === 1 ? '' : 's'} · ${fmtKm(distance)} (estimate)`)),
      el('div', { class: 'map-zoom' },
        el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'Zoom in', onclick: () => zoom(0.6) }, '+'),
        el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'Zoom out', onclick: () => zoom(1 / 0.6) }, '−'),
        el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'Fit', onclick: () => { box = fitBox(places); draw(); } }, '⤢'))),
    holder, sheet,
    el('div', { class: 'map-full-foot muted small' }, 'Tap a pin to see the photos taken there. Distance is the straight-line total between places, in date order.'));
  document.body.append(overlay);
  draw();
}
