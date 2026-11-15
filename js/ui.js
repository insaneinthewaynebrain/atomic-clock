// Small DOM helpers, modals, toast, formatting and shared place search.

export function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k in n && typeof v !== 'string') n[k] = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    n.append(k instanceof Node ? k : String(k));
  }
  return n;
}

export const pad = (n, w = 2) => String(n).padStart(w, '0');

/* ---------- Modal ---------- */
let current = null;

export function openModal({ title, content, actions = [], onClose, className = '' }) {
  const dlg = document.getElementById('modal');
  if (dlg.open) { dlg.onclose = null; dlg.close(); }
  dlg.innerHTML = '';
  dlg.className = className;
  const box = el('div', { class: 'modal-box' });
  if (title) box.append(el('h2', { class: 'modal-title' }, title));
  const body = el('div', { class: 'modal-body' }, content || []);
  box.append(body);
  const close = () => { if (dlg.open) dlg.close(); };
  if (actions.length) {
    const row = el('div', { class: 'modal-actions' });
    for (const a of actions) {
      row.append(el('button', {
        type: 'button', class: 'btn ' + (a.kind || ''),
        onclick: async () => {
          const r = a.onClick ? await a.onClick() : undefined;
          if (r !== false) close();
        },
      }, a.label));
    }
    box.append(row);
  }
  dlg.append(box);
  dlg.onclose = () => { current = null; onClose && onClose(); };
  dlg.onclick = (e) => { if (e.target === dlg) close(); };
  dlg.showModal();
  current = { close, body, dlg };
  return current;
}

export function closeModal() { current && current.close(); }

export function confirmModal(title, message, okLabel = 'OK', danger = false) {
  return new Promise((resolve) => {
    let result = false;
    openModal({
      title,
      content: message ? el('p', {}, message) : null,
      actions: [
        { label: 'Cancel' },
        { label: okLabel, kind: danger ? 'danger' : 'primary', onClick: () => { result = true; } },
      ],
      onClose: () => resolve(result),
    });
  });
}

export function promptModal(title, initial = '', placeholder = '', okLabel = 'Save') {
  return new Promise((resolve) => {
    let result = null;
    const input = el('input', { class: 'input', type: 'text', value: initial, placeholder, autocapitalize: 'words', enterkeyhint: 'done' });
    const m = openModal({
      title,
      content: input,
      actions: [
        { label: 'Cancel' },
        {
          label: okLabel, kind: 'primary',
          onClick: () => { const v = input.value.trim(); if (!v) { input.focus(); return false; } result = v; },
        },
      ],
      onClose: () => resolve(result),
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const v = input.value.trim(); if (v) { result = v; m.close(); } }
    });
    setTimeout(() => { input.focus(); input.select(); }, 60);
  });
}

/* ---------- Toast ---------- */
let toastTimer;
export function toast(msg, ms = 2500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

/* ---------- Network ---------- */
export async function fetchJSON(url, ms = 10000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac.signal, cache: 'no-store', credentials: 'omit' });
    if (!r.ok) {
      let reason = '';
      try { reason = (await r.json()).reason || ''; } catch (e) { /* ignore */ }
      throw new Error(`HTTP ${r.status}${reason ? ': ' + reason : ''}`);
    }
    return await r.json();
  } finally { clearTimeout(t); }
}

/* ---------- Formatting ---------- */
const MINUS = '−';
export function signed(n, digits = 0) {
  const s = Math.abs(n).toFixed(digits);
  if (Number(s) === 0) return (0).toFixed(digits);
  return (n < 0 ? MINUS : '+') + s;
}

export function fmtDuration(ms) {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h < 24) return m ? `${h} h ${m} min` : `${h} h`;
  const d = Math.floor(h / 24), hh = h % 24;
  return hh ? `${d} d ${hh} h` : `${d} d`;
}

export function fmtDateTime(t) {
  const d = new Date(t);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) +
    ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

export function fmtShortTime(t) {
  const d = new Date(t);
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}

export function fmtAgo(t, nowMs = Date.now()) {
  const s = Math.max(0, Math.round((nowMs - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/* ---------- Place search (Open-Meteo geocoding) ---------- */
export async function searchPlaces(query) {
  const [namePart, ...rest] = query.split(',');
  const filter = rest.join(',').trim().toLowerCase();
  const url = 'https://geocoding-api.open-meteo.com/v1/search?count=15&language=en&format=json&name=' +
    encodeURIComponent(namePart.trim());
  const r = await fetchJSON(url, 10000);
  let list = (r.results || []).filter((p) => p.timezone).map((p) => ({
    name: p.name, admin1: p.admin1 || '', country: p.country || p.country_code || '',
    countryCode: p.country_code || '', timezone: p.timezone, lat: p.latitude, lon: p.longitude,
  }));
  if (filter) {
    const f = list.filter((p) => [p.admin1, p.country, p.countryCode].some((x) => x.toLowerCase().includes(filter)));
    if (f.length) list = f;
  }
  return list.slice(0, 10);
}

export function placeLabel(p) {
  return [p.admin1, p.country].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i && x !== p.name).join(', ');
}

export function placeSearchModal({ title, onPick, extraActions = [], onCancel }) {
  let picked = false;
  const input = el('input', {
    type: 'search', class: 'input', placeholder: 'Type a town or city, e.g. Paris', autocomplete: 'off',
    autocapitalize: 'words', enterkeyhint: 'search', spellcheck: false,
  });
  const status = el('div', { class: 'muted small search-status' });
  const list = el('div', { class: 'results' });
  let timer, seq = 0;
  async function run() {
    const q = input.value.trim();
    const my = ++seq;
    if (q.length < 2) { list.innerHTML = ''; status.textContent = ''; return; }
    status.textContent = 'Searching…';
    try {
      const res = await searchPlaces(q);
      if (my !== seq) return;
      list.innerHTML = '';
      status.textContent = res.length ? '' : 'No places found. Try another spelling.';
      for (const p of res) {
        list.append(el('button', {
          type: 'button', class: 'result',
          onclick: () => { picked = true; m.close(); onPick(p); },
        },
        el('div', { class: 'r-name' }, p.name),
        el('div', { class: 'r-sub' }, [placeLabel(p), p.timezone].filter(Boolean).join(' · '))));
      }
    } catch (e) {
      if (my === seq) status.textContent = 'Search failed — check your internet connection.';
    }
  }
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 350); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(timer); run(); input.blur(); } });
  const m = openModal({
    title, className: 'tall',
    content: [input, status, list],
    actions: [...extraActions, { label: 'Cancel' }],
    onClose: () => { if (!picked && onCancel) onCancel(); },
  });
  setTimeout(() => input.focus(), 60);
  return m;
}
