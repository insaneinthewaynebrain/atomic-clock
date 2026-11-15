// Face-picture camera: full-screen live camera with a circle / square / tall-rectangle guide in the middle.
// Fill the guide with the watch head (dial + bezel), press the shutter, and only what's inside the guide is kept.
// Also works with a photo from the library: drag and pinch (or use the zoom slider) to line it up.
import { el, toast } from './ui.js';
import * as store from './store.js';
import { findDial } from './dialfind.js';

export const SHAPES = [
  ['circle', 'Circle'],
  ['square', 'Square'],
  ['rect', 'Tall'],
];
const OUT = { circle: [800, 800], square: [800, 800], rect: [600, 800] };   // saved picture size (px)

const HINT_H = 34;   // room kept under the guide for the hint line

/** The guide's size and place: as big as fits between the top controls (y0) and the bottom controls (y1). */
function frameRect(shape, x0, x1, y0, y1, fill = 0.92) {
  const W = x1 - x0;
  const availH = Math.max(100, y1 - y0 - HINT_H);
  let fw, fh;
  if (shape === 'rect') {
    fh = Math.min(availH, (W * fill * 0.8) / 0.75);
    fw = fh * 0.75;
  } else {
    fw = fh = Math.min(W * fill, availH);
  }
  return { x: x0 + (W - fw) / 2, y: y0 + (availH - fh) / 2, w: fw, h: fh };
}
// Landscape (a phone on its side, or a wide/unfolded screen): shapes down one edge, zoom + shutter down the
// other, beside the guide — easy to reach with the thumb of the hand holding the phone while the watch is on
// the other wrist. "Left hand" mirrors it. Portrait keeps the shutter at the bottom with zoom up the side.

/**
 * Opens the camera. Resolves with { blob, shape } (a JPEG of just the framed area), { skip: true } if the
 * person chose to skip (only offered with allowSkip), or null if cancelled.
 * With `scan(blob, onWord)`, the picture is analysed (scan-line animation) and the result comes back as `scan`.
 * `shape` picks the starting guide; the last one used is remembered.
 */
export function captureFace({ shape, title = 'Face picture', allowSkip = false, scan = null } = {}) {
  return new Promise((resolve) => {
    const data = store.get();
    let cur = shape || data.faceShape || 'circle';
    let stream = null;
    let still = null;               // <img> when using a library photo or the native camera
    let z = 1, tx = 0, ty = 0;      // zoom and pan of the picture behind the guide
    let done = false;
    let snap = null;                // { x, y, r, t } dial found on screen (Circle guide only)
    let cutout = false;             // library photo with a transparent background (iPhone "lift subject")
    let busy = false;               // preview or scan showing
    let hold = null;                // auto-capture: { since, timer } while the found dial holds steady
    let autoShot = false;           // this picture was taken automatically
    let steadyRun = 0;              // looks in a row where the dial hasn't moved

    const dlg = el('dialog', { class: 'cam' });
    const stage = el('div', { class: 'cam-stage' });
    const video = el('video', { class: 'cam-media', playsinline: true, muted: true, autoplay: true });
    video.setAttribute('playsinline', ''); video.setAttribute('muted', '');
    const frame = el('div', { class: 'cam-frame' });
    const hint = el('div', { class: 'cam-hint' }, 'Fill the shape with the watch head — dial and bezel');
    const msg = el('div', { class: 'cam-msg', hidden: true });
    const ringLabel = el('span', {}, 'Dial found');
    const ring = el('div', { class: 'cam-snap', hidden: true }, ringLabel,
      el('div', { class: 'snap-prog', html: '<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="48" pathLength="100"/></svg>' }));
    stage.append(video, frame, ring, hint, msg);

    const shapeBtns = [...SHAPES, ['cutout', 'Cut-out']].map(([v, lab]) => {
      const b = el('button', { type: 'button', class: 'cam-shape' + (v === cur ? ' active' : ''), 'aria-label': lab, onclick: () => setShape(v) },
        el('i', { class: 'cam-ico ' + v }), el('span', {}, lab));
      b.dataset.v = v;
      if (v === 'cutout') b.hidden = true;     // only offered for a photo that's already cut out
      return b;
    });
    // Vertical zoom slider (drag up to zoom in) — sits under the thumb in every layout.
    const zFill = el('div', { class: 'zv-fill' });
    const zHandle = el('div', { class: 'zv-handle' });
    const zTrack = el('div', { class: 'zv-track' }, zFill, zHandle);
    const zLabel = el('div', { class: 'zv-val' }, '1.0×');
    const zoomV = el('div', { class: 'cam-zoomv', role: 'slider', 'aria-label': 'Zoom', 'aria-valuemin': '1', 'aria-valuemax': '4', tabindex: '0' },
      el('span', { class: 'zv-end' }, '4×'), zTrack, el('span', { class: 'zv-end' }, '1×'), zLabel);
    const setZoomUI = () => {
      const pc = ((z - 1) / 3) * 100;
      zFill.style.height = pc + '%'; zHandle.style.bottom = pc + '%';
      zLabel.textContent = z.toFixed(1) + '×'; zoomV.setAttribute('aria-valuenow', z.toFixed(1));
    };
    const zoomTo = (v) => { z = Math.max(1, Math.min(4, v)); setZoomUI(); clampPan(); apply(); };
    const zoomFromY = (y) => { const b = zTrack.getBoundingClientRect(); zoomTo(1 + 3 * (1 - Math.max(0, Math.min(1, (y - b.top) / b.height)))); };
    zoomV.addEventListener('pointerdown', (e) => { e.stopPropagation(); zoomV.setPointerCapture(e.pointerId); zoomFromY(e.clientY); });
    zoomV.addEventListener('pointermove', (e) => { if (zoomV.hasPointerCapture(e.pointerId)) zoomFromY(e.clientY); });
    zoomV.addEventListener('keydown', (e) => { if (e.key === 'ArrowUp') zoomTo(z + 0.1); if (e.key === 'ArrowDown') zoomTo(z - 0.1); });

    const data0 = store.get();
    const handBtn = el('button', { type: 'button', class: 'cam-hand', onclick: () => {
      data0.camHand = data0.camHand === 'left' ? 'right' : 'left'; store.save(); setHand(); layout();
    } });
    function setHand() {
      const left = data0.camHand === 'left';
      dlg.classList.toggle('lefty', left);
      handBtn.textContent = left ? '✋ Left-hand layout' : '🤚 Right-hand layout';
      handBtn.setAttribute('aria-label', `Controls on the ${left ? 'left' : 'right'} — tap to swap sides`);
    }

    const fileIn = el('input', { type: 'file', accept: 'image/*', hidden: true });
    const shotIn = el('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true });
    const onFile = (inp) => async () => {
      const f = inp.files && inp.files[0];
      inp.value = '';
      if (!f) return;
      const img = new Image();
      img.className = 'cam-media';
      img.onload = () => { useStill(img); };
      img.onerror = () => toast('That photo could not be read.');
      img.src = URL.createObjectURL(f);
    };
    fileIn.addEventListener('change', onFile(fileIn));
    shotIn.addEventListener('change', onFile(shotIn));

    const shutter = el('button', { type: 'button', class: 'cam-shutter', 'aria-label': 'Take picture', onclick: () => take() });
    // Auto-capture: takes the photo itself once the dial is found and held steady (hands-free with a watch on).
    const autoBtn = el('button', { type: 'button', class: 'cam-hand cam-auto', onclick: () => {
      data0.camAuto = !autoOn(); store.save(); setAuto(); cancelHold();
    } });
    const autoOn = () => data0.camAuto !== false;
    function setAuto() {
      autoBtn.textContent = autoOn() ? '⚡ Auto photo: on' : '⚡ Auto photo: off';
      autoBtn.classList.toggle('on', autoOn());
      autoBtn.setAttribute('aria-pressed', String(autoOn()));
      setHint();
    }
    const topEl = el('div', { class: 'cam-top' }, el('div', { class: 'cam-title' }, title), el('div', { class: 'cam-shapes' }, shapeBtns),
      el('div', { class: 'cam-toggles' }, autoBtn, handBtn));
    let controls;
    const bar = el('div', { class: 'cam-bar' },
      topEl,
      controls = el('div', { class: 'cam-controls' },
        zoomV,
        el('div', { class: 'cam-bottom' },
          el('span', { class: 'cam-spacer' }),
          shutter,
          el('button', { type: 'button', class: 'btn sm', onclick: () => fileIn.click() }, 'Library')),
        allowSkip ? el('button', { type: 'button', class: 'link-btn cam-skip', onclick: () => finish({ skip: true }) }, 'Add without a photo') : null));
    // Cancel lives in the top-left corner, where people expect it.
    const cancelBtn = el('button', { type: 'button', class: 'cam-cancel', 'aria-label': 'Cancel', onclick: () => finish(null) }, el('span', { 'aria-hidden': 'true' }, '✕'), ' Cancel');
    dlg.append(stage, bar, cancelBtn, fileIn, shotIn);
    document.body.append(dlg);
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
    dlg.showModal();
    setHand(); setZoomUI(); setAuto();
    stage.tabIndex = -1;
    stage.focus({ preventScroll: true });   // no button starts highlighted

    function media() { return still || video; }
    function natural() {
      const m = media();
      return still ? [m.naturalWidth, m.naturalHeight] : [m.videoWidth, m.videoHeight];
    }

    function setShape(v) {
      cur = v;
      shapeBtns.forEach((b) => b.classList.toggle('active', b.dataset.v === v));
      stage.classList.toggle('cutout', v === 'cutout');
      snap = null; ring.hidden = true;
      setHint();
      layout();
    }
    function setHint() {
      hint.textContent = cur === 'cutout' ? 'Cut-out photo — the watch keeps its own outline'
        : still ? 'Drag and pinch to fit the watch head in the shape'
          : cur === 'circle' ? (autoOn() ? 'Fill the circle with the watch head and hold still — it takes the photo itself'
            : 'Fill the circle with the watch head — it snaps to the dial when found')
            : 'Fill the shape with the watch head — dial and bezel';
    }
    /** Guide position for the current shape, fitted between the top and bottom controls. */
    function fit() {
      const sr = stage.getBoundingClientRect();
      if (dlg.classList.contains('side')) {
        const a = topEl.getBoundingClientRect(), b = controls.getBoundingClientRect();
        const [l, rr] = a.left < b.left ? [a, b] : [b, a];
        return frameRect(cur, l.right - sr.left + 12, rr.left - sr.left - 12, 14, sr.height - 4);
      }
      const y0 = topEl.getBoundingClientRect().bottom - sr.top + 14;
      const y1 = controls.getBoundingClientRect().top - sr.top - 8;
      return frameRect(cur, 60, sr.width - 60, y0, y1, 1);   // full width between the zoom slider and the other edge
    }
    function layout() {
      dlg.classList.toggle('side', stage.clientWidth > stage.clientHeight * 1.1);
      const f = fit();
      if (dlg.classList.contains('side')) Object.assign(zoomV.style, { top: '', height: '' });
      else Object.assign(zoomV.style, { top: f.y + 'px', height: f.h + 'px' });
      Object.assign(frame.style, { left: f.x + 'px', top: f.y + 'px', width: f.w + 'px', height: f.h + 'px' });
      frame.className = 'cam-frame ' + cur;
      hint.style.top = (f.y + f.h + 8) + 'px';
      clampPan(); apply();
    }
    function apply() { media().style.transform = `translate(${tx}px, ${ty}px) scale(${z})`; }
    function clampPan() {
      const W = stage.clientWidth, H = stage.clientHeight;
      const mx = (W * (z - 1)) / 2 + W * 0.3, my = (H * (z - 1)) / 2 + H * 0.3;
      tx = Math.max(-mx, Math.min(mx, tx)); ty = Math.max(-my, Math.min(my, ty));
    }

    // Drag to move, pinch to zoom (handy for library photos; works on the live view too).
    const pts = new Map();
    let last = null;
    stage.addEventListener('pointerdown', (e) => { stage.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); last = null; });
    stage.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      const p = [...pts.values()];
      const cx = p.reduce((s, q) => s + q[0], 0) / p.length, cy = p.reduce((s, q) => s + q[1], 0) / p.length;
      const dist = p.length > 1 ? Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]) : 0;
      if (last && last.n === p.length) {
        tx += cx - last.cx; ty += cy - last.cy;
        if (p.length > 1 && last.dist) { z = Math.max(1, Math.min(4, z * (dist / last.dist))); setZoomUI(); }
        clampPan(); apply();
      }
      last = { cx, cy, dist, n: p.length };
    });
    const up = (e) => { pts.delete(e.pointerId); last = null; };
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);

    function useStill(img) {
      stopStream();
      video.remove();
      if (still) { URL.revokeObjectURL(still.src); still.remove(); }
      still = img;
      stage.prepend(img);
      msg.hidden = true;
      z = 1; tx = 0; ty = 0; setZoomUI();
      cutout = hasTransparency(img);
      const cb = shapeBtns.find((b) => b.dataset.v === 'cutout');
      cb.hidden = !cutout;
      if (cutout) setShape('cutout');
      else { if (cur === 'cutout') setShape('circle'); setHint(); layout(); }
    }
    /** True for a picture whose background has been removed (transparent pixels round the edges). */
    function hasTransparency(img) {
      try {
        const c = document.createElement('canvas'); c.width = c.height = 48;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0, 48, 48);
        const d = g.getImageData(0, 0, 48, 48).data;
        let clear = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] < 200) clear++;
        return clear > 48 * 48 * 0.05;
      } catch (e) { return false; }
    }

    function stopStream() { if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; } }

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) { noCamera('This browser can’t show a live camera here.'); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1920 } } });
        if (done) { stopStream(); return; }
        video.srcObject = stream;
        await video.play().catch(() => {});
      } catch (e) {
        noCamera(e && e.name === 'NotAllowedError'
          ? 'Camera access is turned off for this app. You can allow it in Settings, or use the buttons below.'
          : 'The camera could not be started.');
      }
    }
    function noCamera(text) {
      msg.hidden = false;
      msg.replaceChildren(el('p', {}, text),
        el('div', { class: 'cam-msg-btns' },
          el('button', { type: 'button', class: 'btn primary', onclick: () => shotIn.click() }, 'Take a photo'),
          el('button', { type: 'button', class: 'btn', onclick: () => fileIn.click() }, 'Choose from library')));
    }

    /** Draws the part of the picture under a screen rectangle into a new canvas (ow × oh). */
    function grab(rect, ow, oh, fill = true) {
      const [vw, vh] = natural();
      const W = stage.clientWidth, H = stage.clientHeight;
      // Where the (untransformed) picture sits: object-fit: cover, centred.
      const s0 = Math.max(W / vw, H / vh);
      const left = (W - vw * s0) / 2, top = (H - vh * s0) / 2;
      // Screen point -> picture pixel, undoing translate(tx,ty) scale(z) about the centre.
      const toSrc = (px, py) => {
        const qx = W / 2 + (px - tx - W / 2) / z, qy = H / 2 + (py - ty - H / 2) / z;
        return [(qx - left) / s0, (qy - top) / s0];
      };
      const [sx, sy] = toSrc(rect.x, rect.y);
      const [ex, ey] = toSrc(rect.x + rect.w, rect.y + rect.h);
      const c = document.createElement('canvas');
      c.width = ow; c.height = oh;
      const g = c.getContext('2d', { willReadFrequently: true });
      if (fill) { g.fillStyle = '#000'; g.fillRect(0, 0, ow, oh); }
      g.drawImage(media(), sx, sy, ex - sx, ey - sy, 0, 0, ow, oh);
      return c;
    }
    const toBlob = (c, type) => new Promise((res) => c.toBlob(res, type, 0.9));

    // Live dial finding (Circle guide): look in and around the guide a few times a second.
    const LOOK = 160;
    function lookForDial() {
      if (done || busy || cur !== 'circle') { ring.hidden = true; cancelHold(); return; }
      const [vw, vh] = natural();
      if (!vw || !vh) return;
      const f = fit();
      const side = f.w * 1.5;          // a bit beyond the guide, in case the watch is bigger than it
      const area = { x: f.x + f.w / 2 - side / 2, y: f.y + f.h / 2 - side / 2, w: side, h: side };
      let found = null;
      try { found = findDial(grab(area, LOOK, LOOK).getContext('2d').getImageData(0, 0, LOOK, LOOK)); } catch (e) { found = null; }
      if (!found) { if (!snap || Date.now() - snap.t > 900) { snap = null; ring.hidden = true; cancelHold(); } return; }
      const k = side / LOOK;
      const nx = area.x + found.cx * k, ny = area.y + found.cy * k, nr = found.r * k * 1.05;   // a little outside the bezel, so it's never clipped
      // You framed the watch to fill the guide, so a real bezel is about the guide's size. A "dial" much smaller
      // (a ring inside the lettering) or much bigger (the case and strap) isn't it: keep your framing instead.
      if (nr < (f.w / 2) * 0.8 || nr > (f.w / 2) * 1.45) { if (!snap || Date.now() - snap.t > 900) { snap = null; ring.hidden = true; cancelHold(); } return; }
      // Steady? (centre and size within 7% of the last look) — needed before taking the photo automatically.
      const steady = snap && Math.hypot(nx - snap.x, ny - snap.y) < snap.r * 0.07 && Math.abs(nr - snap.r) < snap.r * 0.07;
      // Smooth so the ring doesn't jitter.
      snap = snap ? { x: snap.x * 0.5 + nx * 0.5, y: snap.y * 0.5 + ny * 0.5, r: snap.r * 0.5 + nr * 0.5, t: Date.now() } : { x: nx, y: ny, r: nr, t: Date.now() };
      Object.assign(ring.style, { left: snap.x - snap.r + 'px', top: snap.y - snap.r + 'px', width: snap.r * 2 + 'px', height: snap.r * 2 + 'px' });
      ring.hidden = false;
      steadyRun = steady ? steadyRun + 1 : 0;
      if (autoOn() && !still) { if (steadyRun >= 2) startHold(); else cancelHold(); }
    }
    // Auto-capture: the ring fills over HOLD_MS while the dial stays put, then the photo is taken.
    const HOLD_MS = 1100;
    function startHold() {
      if (hold) return;
      ring.classList.add('holding'); ringLabel.textContent = 'Hold still…';
      hold = { since: Date.now(), timer: setTimeout(() => {
        hold = null;
        // Only if it's still steady right now (the last look agreed), not just at the start.
        if (done || busy || ring.hidden || !snap || Date.now() - snap.t > 800 || steadyRun < 3) { cancelHold(); return; }
        ringLabel.textContent = 'Got it';
        autoShot = true;
        take();
      }, HOLD_MS) };
    }
    function cancelHold() {
      if (hold) { clearTimeout(hold.timer); hold = null; steadyRun = 0; }
      ring.classList.remove('holding'); ringLabel.textContent = 'Dial found';
    }
    // Self-paced: wait at least twice as long as the last look took, so the viewfinder stays smooth on any phone.
    let looker = null;
    const loop = () => {
      if (done) return;
      const t0 = performance.now();
      lookForDial();
      looker = setTimeout(loop, Math.max(300, 2 * (performance.now() - t0)));
    };
    looker = setTimeout(loop, 400);

    /** A transparent-background picture: trim to the watch's own outline (max 900 px), kept as PNG. */
    async function cutoutBlob() {
      const img = still;
      const sc = Math.min(1, 900 / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * sc), h = Math.round(img.naturalHeight * sc);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0, w, h);
      const d = g.getImageData(0, 0, w, h).data;
      let x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 16) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 < 0) return null;
      const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.03);
      x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
      const o = document.createElement('canvas'); o.width = x1 - x0 + 1; o.height = y1 - y0 + 1;
      o.getContext('2d').drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
      return toBlob(o, 'image/png');
    }

    async function take() {
      const auto = autoShot; autoShot = false;
      cancelHold();
      const [vw, vh] = natural();
      if (!vw || !vh) { toast('The camera isn’t ready yet'); return; }
      shutter.disabled = true;
      busy = true;
      dlg.classList.add('flash');
      const type = cutout ? 'image/png' : 'image/jpeg';     // keep transparency from a cut-out photo
      let main, alt = null;
      if (cur === 'cutout') main = { blob: await cutoutBlob(), shape: 'cutout' };
      else {
        const [ow, oh] = OUT[cur];
        const f = fit();
        if (cur === 'circle') {
          // One snapshot of the area round the guide: find the dial in *this* frame and crop from the same frame,
          // so the crop can't lag behind the live ring or come from a different moment.
          const side = f.w * 1.5, S = 960, k = side / S;
          const area = { x: f.x + f.w / 2 - side / 2, y: f.y + f.h / 2 - side / 2, w: side, h: side };
          const shot = grab(area, S, S, !cutout);
          const sm = document.createElement('canvas'); sm.width = sm.height = LOOK;
          const sg = sm.getContext('2d', { willReadFrequently: true }); sg.drawImage(shot, 0, 0, LOOK, LOOK);
          let found = null;
          try { found = findDial(sg.getImageData(0, 0, LOOK, LOOK)); } catch (e) { found = null; }
          const cropFrom = (x, y, w) => { const c = document.createElement('canvas'); c.width = ow; c.height = oh; const g = c.getContext('2d'); if (!cutout) { g.fillStyle = '#000'; g.fillRect(0, 0, ow, oh); } g.drawImage(shot, x, y, w, w * (oh / ow), 0, 0, ow, oh); return c; };
          const guideCanvas = cropFrom((f.x - area.x) / k, (f.y - area.y) / k, f.w / k);
          const mine = { blob: await toBlob(guideCanvas, type), shape: cur, how: 'guide' };
          const r = found ? (found.r * (S / LOOK)) * 1.05 : 0;              // in snapshot pixels, a little outside the bezel
          const sane = found && r * k >= (f.w / 2) * 0.8 && r * k <= (f.w / 2) * 1.45;
          if (sane) {
            const cx = found.cx * (S / LOOK), cy = found.cy * (S / LOOK);
            main = { blob: await toBlob(cropFrom(cx - r, cy - r, 2 * r), type), shape: cur, how: 'snap' };
            alt = mine;
          } else if (auto) {
            // Taken automatically but the dial can't be confirmed in this very frame: don't save a bad crop, keep waiting.
            busy = false; shutter.disabled = false; dlg.classList.remove('flash'); steadyRun = 0;
            return;
          } else main = mine;
        } else main = { blob: await toBlob(grab(f, ow, oh, !cutout), type), shape: cur, how: 'guide' };
      }
      if (!main.blob) { shutter.disabled = false; busy = false; toast('Could not take the picture'); return; }
      main.auto = auto;
      if (scan) runScan(main, alt); else preview(main, alt);
    }

    // Film-style analysis: the frame freezes, a scan line sweeps the watch, words read off the dial flicker up.
    async function runScan(main, alt) {
      const blob = main.blob;
      ring.hidden = true;
      if (!still) video.pause();
      const f = fit();
      const words = el('div', { class: 'scan-words' });
      const status = el('div', { class: 'scan-status' }, 'ANALYSING DIAL');
      const pct = el('div', { class: 'scan-pct' }, '00%');
      const box = el('div', { class: 'scan-box ' + cur, style: `left:${f.x}px;top:${f.y}px;width:${f.w}px;height:${f.h}px` },
        el('div', { class: 'scan-grid' }), el('div', { class: 'scan-line' }),
        el('i', { class: 'scan-c tl' }), el('i', { class: 'scan-c tr' }), el('i', { class: 'scan-c bl' }), el('i', { class: 'scan-c br' }));
      const hud = el('div', { class: 'scan-hud', style: `top:${Math.min(stage.clientHeight - 130, f.y + f.h + 8)}px` }, el('div', { class: 'scan-row' }, status, pct), words);
      const layer = el('div', { class: 'scan-layer' }, box, hud);
      stage.append(layer);
      hint.hidden = true;
      dlg.classList.add('scanning');
      const steps = ['ANALYSING DIAL', 'READING TEXT', 'MATCHING BRAND', 'MOVEMENT', 'JEWELS', 'WATER RESISTANCE', 'COMPLICATIONS'];
      let n = 0, p = 0;
      const tick = setInterval(() => {
        p = Math.min(96, p + Math.max(1, (96 - p) * 0.06));
        pct.textContent = String(Math.floor(p)).padStart(2, '0') + '%';
        if (++n % 9 === 0) status.textContent = steps[Math.min(steps.length - 1, Math.floor(n / 9))];
      }, 90);
      const seen = new Set();
      const onWord = (wd) => {
        const t = String(wd).replace(/[^\w&'.\-/]/g, '').toUpperCase();
        if (t.length < 2 || seen.has(t) || seen.size > 24) return;
        seen.add(t);
        words.append(el('span', { class: 'scan-word' }, t));
      };
      let result;
      const minTime = new Promise((res) => setTimeout(res, 2600));
      try { [result] = await Promise.all([scan(blob, onWord), minTime]); }
      catch (e) { await minTime; result = { error: e.message || 'The dial could not be read.', found: [], fields: {} }; }
      clearInterval(tick);
      if (done) return;
      pct.textContent = '100%';
      status.textContent = result.error ? 'NO SIGNAL' : (result.found.length ? 'MATCH FOUND' : 'NO TEXT FOUND');
      dlg.classList.add('scan-done');
      await new Promise((res) => setTimeout(res, 650));
      layer.remove(); hint.hidden = false;
      dlg.classList.remove('scanning', 'scan-done');
      preview(main, alt, result);
    }

    function preview(main, alt = null, result = null) {
      let pick = main;
      const faceBox = el('div', { class: 'cam-pv-wrap' });
      let url = null;
      const drawFace = () => {
        if (url) URL.revokeObjectURL(url);
        url = URL.createObjectURL(pick.blob);
        faceBox.replaceChildren(el('div', { class: 'face face-' + pick.shape + ' cam-pv-face' }, el('img', { src: url, alt: 'Face picture' })));
      };
      drawFace();
      let info = null;
      if (result) {
        info = result.found?.length
          ? el('div', { class: 'scan-found' }, el('div', { class: 'scan-found-t' }, 'Read from the dial'),
            result.found.map(([k, v]) => el('div', { class: 'scan-chip' }, el('span', {}, k), el('b', {}, v))))
          : el('p', { class: 'muted' }, result.error ? `${result.error} You can fill in the details next.` : 'No writing could be read on the dial — you can choose the brand next.');
      }
      const swap = alt ? el('button', { type: 'button', class: 'link-btn cam-swap', onclick: () => {
        [pick, alt] = [alt, pick];
        swap.textContent = pick.how === 'snap' ? 'Use my framing instead' : 'Use the snapped dial';
        note.textContent = pick.how === 'snap' ? '✓ Snapped to the dial' : 'Your framing';
        drawFace();
      } }, 'Use my framing instead') : null;
      const note = el('div', { class: 'cam-pv-note' }, main.how === 'snap' ? '✓ Snapped to the dial' : main.shape === 'cutout' ? '✓ Cut out from the photo' : '');
      const close = () => { if (url) URL.revokeObjectURL(url); clearTimeout(go); };
      const goBtn = el('button', { type: 'button', class: 'btn primary', onclick: () => { close(); finish({ blob: pick.blob, shape: pick.shape, scan: result }); } }, result ? 'Continue' : 'Use picture');
      // Taken automatically: carry on by itself after a short countdown; any touch stops it.
      const AUTO_S = 4;
      const bar = main.auto ? el('div', { class: 'cam-autogo' }, el('i', { style: `animation-duration:${AUTO_S}s` })) : null;
      const autoNote = main.auto ? el('div', { class: 'muted small' }, `Carrying on in ${AUTO_S} seconds — tap anywhere to stop`) : null;
      let go = main.auto ? setTimeout(() => goBtn.click(), AUTO_S * 1000) : null;
      const stopAuto = () => { if (!go) return; clearTimeout(go); go = null; bar?.remove(); autoNote?.remove(); };
      const pv = el('div', { class: 'cam-preview' },
        faceBox, note, swap,
        info || el('p', { class: 'muted' }, 'Is the whole watch head in the picture?'),
        el('div', { class: 'cam-msg-btns' },
          el('button', { type: 'button', class: 'btn', onclick: () => { close(); pv.remove(); busy = false; shutter.disabled = false; dlg.classList.remove('flash'); if (!still) video.play().catch(() => {}); } }, 'Retake'),
          goBtn),
        bar, autoNote);
      pv.addEventListener('pointerdown', (e) => { if (e.target !== goBtn) stopAuto(); }, true);
      dlg.append(pv);
    }

    function finish(result) {
      if (done) return;
      done = true;
      clearTimeout(looker);
      stopStream();
      if (still) URL.revokeObjectURL(still.src);
      window.removeEventListener('resize', layout);
      if (result && result.shape && result.shape !== 'cutout') { data.faceShape = result.shape; store.save(); }
      dlg.close();
      dlg.remove();
      resolve(result);
    }

    window.addEventListener('resize', layout);
    video.addEventListener('loadedmetadata', layout);
    requestAnimationFrame(layout);
    start();
  });
}
