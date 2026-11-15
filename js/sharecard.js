// Share card: a neat image of a watch's accuracy result, for social media.
// Never includes the serial number, prices or values.
import { el, openModal, toast, signed } from './ui.js';
import { watchStats, grade } from './accuracy.js';
import { photoUrl } from './photos.js';
import { shareOrDownload } from './backup.js';
import { APP_NAME, CHANNEL_SHORT } from './config.js';

const W = 1080, H = 1350;
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const COL = { good: '#34d399', mid: '#fbbf24', badr: '#f87171', '': '#4cc2ff' };

function loadImg(src) {
  return new Promise((resolve) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => resolve(null); i.src = src; });
}

function fitText(ctx, text, maxW, size, weight = 700) {
  let s = size;
  do { ctx.font = `${weight} ${s}px ${FONT}`; s -= 2; } while (ctx.measureText(text).width > maxW && s > 18);
  return text;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

export async function drawCard(w) {
  const st = watchStats(w);
  const g = grade(w, st);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');

  // Background
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#141a2b'); bg.addColorStop(1, '#0b0d12');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  // Photo (cover-cropped) or a placeholder
  const PH = 640;
  const url = w.photos?.length ? await photoUrl(w.photos[0], 'full') : null;
  const img = url ? await loadImg(url) : null;
  ctx.save();
  roundRect(ctx, 48, 48, W - 96, PH, 36); ctx.clip();
  if (img) {
    const scale = Math.max((W - 96) / img.naturalWidth, PH / img.naturalHeight);
    const iw = img.naturalWidth * scale, ih = img.naturalHeight * scale;
    ctx.drawImage(img, 48 + (W - 96 - iw) / 2, 48 + (PH - ih) / 2, iw, ih);
  } else {
    ctx.fillStyle = '#1e2330'; ctx.fillRect(48, 48, W - 96, PH);
    ctx.font = `260px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('⌚', W / 2, 48 + PH / 2);
  }
  ctx.restore();

  // Name + model
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = '#eef1f7';
  let y = 48 + PH + 86;
  fitText(ctx, w.name, W - 120, 64, 800); ctx.fillText(w.name, 60, y);
  const sub = [w.brand, w.model, w.reference].filter(Boolean).join(' · ');
  if (sub && sub !== w.name) { y += 50; ctx.fillStyle = '#8f98ab'; fitText(ctx, sub, W - 120, 34, 500); ctx.fillText(sub, 60, y); }

  // Rate
  y += 130;
  const r = st.overall;
  const level = g.ready ? g.level : '';
  ctx.fillStyle = COL[level] || COL[''];
  const rateTxt = r == null ? '—' : `${signed(r, 1)} s/day`;
  ctx.font = `800 120px ${FONT}`; ctx.fillText(rateTxt, 60, y);
  const rw = ctx.measureText(rateTxt).width;
  ctx.fillStyle = '#8f98ab'; ctx.font = `600 44px ${FONT}`;
  if (r != null && Math.abs(r) >= 0.05) ctx.fillText(r > 0 ? 'fast' : 'slow', 60 + rw + 24, y);

  // Grade pill
  if (g.ready) {
    y += 46;
    const txt = (level === 'good' ? '✓ ' : '') + g.headline;
    ctx.font = `700 36px ${FONT}`;
    const tw = Math.min(ctx.measureText(txt).width, W - 160);
    ctx.fillStyle = (COL[level] || COL['']) + '26';
    roundRect(ctx, 60, y, tw + 48, 64, 32); ctx.fill();
    ctx.fillStyle = COL[level] || COL[''];
    fitText(ctx, txt, W - 160, 36, 700); ctx.fillText(txt, 84, y + 44);
    y += 64;
  }

  // Tracking info
  const marks = st.runs.reduce((n, run) => n + run.readings.length, 0);
  y += 62;
  ctx.fillStyle = '#cfd6e4'; ctx.font = `500 34px ${FONT}`;
  const days = st.overallDays;
  ctx.fillText(`Average over ${days >= 1 ? Math.round(days * 10) / 10 + ' days' : Math.round(days * 24) + ' hours'} · ${marks} marks against network time`, 60, y);

  // Footer
  ctx.fillStyle = '#2a3142'; ctx.fillRect(60, H - 120, W - 120, 2);
  ctx.fillStyle = '#eef1f7'; ctx.font = `700 34px ${FONT}`; ctx.fillText(APP_NAME, 60, H - 62);
  ctx.textAlign = 'right'; ctx.fillStyle = '#4cc2ff'; ctx.font = `600 32px ${FONT}`; ctx.fillText(CHANNEL_SHORT, W - 60, H - 62);

  return new Promise((resolve) => c.toBlob((b) => resolve({ blob: b, url: c.toDataURL('image/jpeg', 0.7) }), 'image/png'));
}

export async function openShareCard(w) {
  toast('Making your card…', 1200);
  const { blob, url } = await drawCard(w);
  const fname = `${w.name.replace(/[^\w-]+/g, '-').replace(/-+/g, '-').toLowerCase()}-accuracy.png`;
  openModal({
    title: 'Share accuracy',
    content: [el('img', { src: url, class: 'share-preview', alt: 'Accuracy card' }),
      el('p', { class: 'muted small' }, 'No serial number, prices or values are included.')],
    actions: [{ label: 'Close' }, { label: '📤 Share image', kind: 'primary', onClick: async () => { await shareOrDownload(blob, fname, `${w.name} accuracy`); return false; } }],
  });
}
