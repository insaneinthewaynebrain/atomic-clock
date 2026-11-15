// Face-picture camera: full-screen live camera with a circle / square / tall-rectangle guide in the middle.
// Fill the guide with the watch head (dial + bezel), press the shutter, and only what's inside the guide is kept.
// Also works with a photo from the library: drag and pinch (or use the zoom slider) to line it up.
import { el, toast } from './ui.js';
import * as store from './store.js';

export const SHAPES = [
  ['circle', 'Circle'],
  ['square', 'Square'],
  ['rect', 'Tall'],
];
const OUT = { circle: [800, 800], square: [800, 800], rect: [600, 800] };   // saved picture size (px)

/** Size of the guide on screen for a shape, inside a W×H area. */
function frameRect(shape, W, H) {
  let fw, fh;
  if (shape === 'rect') {
    fw = Math.min(W * 0.62, H * 0.62 * 0.75);
    fh = fw / 0.75;
  } else {
    fw = fh = Math.min(W * 0.78, H * 0.56);
  }
  return { x: (W - fw) / 2, y: (H - fh) / 2, w: fw, h: fh };
}

/**
 * Opens the camera. Resolves with { blob, shape } (a JPEG of just the framed area), { skip: true } if the
 * person chose to skip (only offered with allowSkip), or null if cancelled.
 * `shape` picks the starting guide; the last one used is remembered.
 */
export function captureFace({ shape, title = 'Face picture', allowSkip = false } = {}) {
  return new Promise((resolve) => {
    const data = store.get();
    let cur = shape || data.faceShape || 'circle';
    let stream = null;
    let still = null;               // <img> when using a library photo or the native camera
    let z = 1, tx = 0, ty = 0;      // zoom and pan of the picture behind the guide
    let done = false;

    const dlg = el('dialog', { class: 'cam' });
    const stage = el('div', { class: 'cam-stage' });
    const video = el('video', { class: 'cam-media', playsinline: true, muted: true, autoplay: true });
    video.setAttribute('playsinline', ''); video.setAttribute('muted', '');
    const frame = el('div', { class: 'cam-frame' });
    const hint = el('div', { class: 'cam-hint' }, 'Fill the shape with the watch head — dial and bezel');
    const msg = el('div', { class: 'cam-msg', hidden: true });
    stage.append(video, frame, hint, msg);

    const shapeBtns = SHAPES.map(([v, lab]) => {
      const b = el('button', { type: 'button', class: 'cam-shape' + (v === cur ? ' active' : ''), 'aria-label': lab, onclick: () => setShape(v) },
        el('i', { class: 'cam-ico ' + v }), el('span', {}, lab));
      b.dataset.v = v;
      return b;
    });
    const zoom = el('input', { type: 'range', class: 'cam-zoom', min: '1', max: '4', step: '0.01', value: '1', 'aria-label': 'Zoom',
      oninput: () => { z = Number(zoom.value); clampPan(); apply(); } });

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
    const bar = el('div', { class: 'cam-bar' },
      el('div', { class: 'cam-top' }, el('div', { class: 'cam-title' }, title,
        allowSkip ? el('button', { type: 'button', class: 'link-btn cam-skip', onclick: () => finish({ skip: true }) }, 'Skip for now') : null),
        el('div', { class: 'cam-shapes' }, shapeBtns)),
      el('div', { class: 'cam-zoomrow' }, el('span', {}, '1×'), zoom, el('span', {}, '4×')),
      el('div', { class: 'cam-bottom' },
        el('button', { type: 'button', class: 'btn sm', onclick: () => finish(null) }, 'Cancel'),
        shutter,
        el('button', { type: 'button', class: 'btn sm', onclick: () => fileIn.click() }, 'Library')));
    dlg.append(stage, bar, fileIn, shotIn);
    document.body.append(dlg);
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
    dlg.showModal();

    function media() { return still || video; }
    function natural() {
      const m = media();
      return still ? [m.naturalWidth, m.naturalHeight] : [m.videoWidth, m.videoHeight];
    }

    function setShape(v) {
      cur = v;
      shapeBtns.forEach((b) => b.classList.toggle('active', b.dataset.v === v));
      layout();
    }
    function layout() {
      const W = stage.clientWidth, H = stage.clientHeight;
      const f = frameRect(cur, W, H);
      Object.assign(frame.style, { left: f.x + 'px', top: f.y + 'px', width: f.w + 'px', height: f.h + 'px' });
      frame.className = 'cam-frame ' + cur;
      hint.style.top = Math.min(H - 40, f.y + f.h + 14) + 'px';
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
        if (p.length > 1 && last.dist) { z = Math.max(1, Math.min(4, z * (dist / last.dist))); zoom.value = String(z); }
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
      z = 1; tx = 0; ty = 0; zoom.value = '1';
      hint.textContent = 'Drag and pinch to fit the watch head in the shape';
      layout();
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

    function take() {
      const [vw, vh] = natural();
      if (!vw || !vh) { toast('The camera isn’t ready yet'); return; }
      const W = stage.clientWidth, H = stage.clientHeight;
      // Where the (untransformed) picture sits: object-fit: cover, centred.
      const s0 = Math.max(W / vw, H / vh);
      const left = (W - vw * s0) / 2, top = (H - vh * s0) / 2;
      // Screen point -> picture pixel, undoing translate(tx,ty) scale(z) about the centre.
      const toSrc = (px, py) => {
        const qx = W / 2 + (px - tx - W / 2) / z, qy = H / 2 + (py - ty - H / 2) / z;
        return [(qx - left) / s0, (qy - top) / s0];
      };
      const f = frameRect(cur, W, H);
      const [sx, sy] = toSrc(f.x, f.y);
      const [ex, ey] = toSrc(f.x + f.w, f.y + f.h);
      const [ow, oh] = OUT[cur];
      const c = document.createElement('canvas');
      c.width = ow; c.height = oh;
      const g = c.getContext('2d');
      g.fillStyle = '#000'; g.fillRect(0, 0, ow, oh);
      g.drawImage(media(), sx, sy, ex - sx, ey - sy, 0, 0, ow, oh);
      shutter.disabled = true;
      dlg.classList.add('flash');
      c.toBlob((blob) => {
        if (!blob) { shutter.disabled = false; toast('Could not take the picture'); return; }
        preview(blob);
      }, 'image/jpeg', 0.9);
    }

    function preview(blob) {
      const url = URL.createObjectURL(blob);
      const pv = el('div', { class: 'cam-preview' },
        el('div', { class: 'face face-' + cur + ' cam-pv-face' }, el('img', { src: url, alt: 'Face picture' })),
        el('p', { class: 'muted' }, 'Is the whole watch head in the picture?'),
        el('div', { class: 'cam-msg-btns' },
          el('button', { type: 'button', class: 'btn', onclick: () => { URL.revokeObjectURL(url); pv.remove(); shutter.disabled = false; dlg.classList.remove('flash'); } }, 'Retake'),
          el('button', { type: 'button', class: 'btn primary', onclick: () => { URL.revokeObjectURL(url); finish({ blob, shape: cur }); } }, 'Use picture')));
      dlg.append(pv);
    }

    function finish(result) {
      if (done) return;
      done = true;
      stopStream();
      if (still) URL.revokeObjectURL(still.src);
      window.removeEventListener('resize', layout);
      if (result && result.shape) { data.faceShape = result.shape; store.save(); }
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
