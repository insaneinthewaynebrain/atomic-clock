// Watch birthdays: on the anniversary of a watch's purchase date, a celebration with fireworks behind the watch.
// Several on one day show one after another; each at most once a day. 29 February counts as 28 February in other years.
import * as store from './store.js';
import { el } from './ui.js';
import { ownedWatches, faceEl, openWatchDetail } from './collection.js';
import { birthdayYears } from './model.js';
import { isLocked } from './lock.js';

const todayKey = () => { const t = new Date(); return `${t.getFullYear()}-${t.getMonth() + 1}-${t.getDate()}`; };
const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
let showing = false;

function fireworks(canvas) {
  const g = canvas.getContext('2d');
  const parts = [];
  const colours = ['#e9c46a', '#f4a261', '#e76f51', '#8ecae6', '#ffffff', '#c9a96e', '#a7f3d0'];
  let raf = 0, last = performance.now(), nextBurst = 0;
  const size = () => { const r = canvas.getBoundingClientRect(); canvas.width = r.width * devicePixelRatio; canvas.height = r.height * devicePixelRatio; };
  size();
  const burst = () => {
    const x = canvas.width * (0.15 + Math.random() * 0.7), y = canvas.height * (0.12 + Math.random() * 0.45);
    const c = colours[Math.floor(Math.random() * colours.length)];
    const n = 46 + Math.floor(Math.random() * 30);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, v = (1.6 + Math.random() * 2.4) * devicePixelRatio;
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, c });
    }
  };
  const frame = (t) => {
    const dt = Math.min(48, t - last) / 16.7; last = t;
    if (t > nextBurst) { burst(); nextBurst = t + 380 + Math.random() * 520; }
    g.globalCompositeOperation = 'destination-out'; g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(0, 0, canvas.width, canvas.height);
    g.globalCompositeOperation = 'lighter';
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 0.045 * dt * devicePixelRatio; p.vx *= 0.985; p.life -= 0.012 * dt;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      g.globalAlpha = Math.max(0, p.life); g.fillStyle = p.c;
      g.beginPath(); g.arc(p.x, p.y, 2.2 * devicePixelRatio, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}

/** Show today's birthdays (if any, and not already shown today). */
export function checkBirthdays(force = false) {
  if (showing || isLocked()) return;
  const data = store.get();
  const shown = (data.birthdaysShown ||= {});
  const key = todayKey();
  const list = ownedWatches().map((w) => ({ w, years: birthdayYears(w) })).filter((x) => x.years && (force || shown[x.w.id] !== key));
  if (!list.length) return;
  showing = true;
  for (const x of list) shown[x.w.id] = key;   // the whole day's list counts as shown (Close all included)
  store.save();
  let i = 0, stop = null;
  const overlay = el('div', { class: 'bday', role: 'dialog', 'aria-label': 'Watch birthday' });
  const close = () => { if (stop) stop(); overlay.remove(); showing = false; };
  const show = () => {
    const { w, years } = list[i];
    if (stop) stop();
    const canvas = el('canvas', { class: 'bday-fw', 'aria-hidden': 'true' });
    const more = list.length - i - 1;
    overlay.replaceChildren(canvas,
      el('div', { class: 'bday-card' },
        el('div', { class: 'bday-photo' }, faceEl(w, 'full', 'face-xl')),
        el('div', { class: 'eyebrow bday-eyebrow' }, list.length > 1 ? `${i + 1} of ${list.length}` : 'Today'),
        el('h2', { class: 'bday-title' }, 'Happy Watch Birthday!'),
        el('div', { class: 'bday-name' }, w.name),
        el('div', { class: 'bday-years' }, `${years} year${years === 1 ? '' : 's'} together`),
        el('div', { class: 'bday-btns' },
          el('button', { type: 'button', class: 'btn', onclick: () => { close(); openWatchDetail(w); } }, 'Open watch'),
          el('button', { type: 'button', class: 'btn primary', onclick: () => { if (more) { i++; show(); } else close(); } }, more ? 'Close · next' : 'Close')),
        list.length > 1 ? el('button', { type: 'button', class: 'link-btn bday-all', onclick: close }, 'Close all') : null));
    stop = reduced() ? null : fireworks(canvas);
  };
  document.body.append(overlay);
  show();
}

export function initBirthdays() {
  setTimeout(() => checkBirthdays(), 900);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(() => checkBirthdays(), 600); });
}
