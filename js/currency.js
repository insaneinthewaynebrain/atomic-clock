// Currency tab: converter for every currency open.er-api.com publishes, cached for offline use.
import * as store from './store.js';
import { el, fetchJSON, openModal, toast, fmtAgo } from './ui.js';

const RATES_URL = 'https://open.er-api.com/v6/latest/GBP';
const STALE_MS = 6 * 60 * 60 * 1000;

let names = null;
try { names = new Intl.DisplayNames(['en-GB'], { type: 'currency' }); } catch (e) { names = null; }
export function currencyName(code) {
  try { const n = names && names.of(code); return n && n !== code ? n : code; } catch (e) { return code; }
}
function decimals(code) {
  try { return new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits; }
  catch (e) { return 2; }
}

const root = () => document.getElementById('currency');
let loading = false, error = '';
let inputs = {};

function cur() { return store.get().currency; }
function rates() { return cur().ratesCache?.rates || null; }

export function convert(amount, from, to, r = rates()) {
  if (!r || !r[from] || !r[to]) return null;
  return (amount / r[from]) * r[to];
}

export function parseAmount(s) {
  const v = parseFloat(String(s).replace(/[,\s£€$]/g, ''));
  return Number.isFinite(v) ? v : null;
}

function formatOut(v, code) {
  if (v == null) return '';
  if (v !== 0 && Math.abs(v) < 0.01) return String(Number(v.toPrecision(3)));
  return v.toFixed(decimals(code));
}

function fmtRate(v) {
  if (v == null) return '—';
  if (v >= 100) return v.toFixed(2);
  if (v >= 1) return v.toFixed(4);
  return Number(v.toPrecision(4)).toString();
}

async function loadRates(force = false) {
  const c = cur();
  if (loading) return;
  if (!force && c.ratesCache && Date.now() - c.ratesCache.fetchedAt < STALE_MS) return;
  loading = true; error = ''; renderMeta();
  try {
    const j = await fetchJSON(RATES_URL, 12000);
    if (j.result !== 'success' || !j.rates) throw new Error('Unexpected response');
    c.ratesCache = { base: j.base_code, rates: j.rates, updatedUnix: j.time_last_update_unix, nextUnix: j.time_next_update_unix, fetchedAt: Date.now() };
    store.save();
  } catch (e) {
    error = c.ratesCache ? 'Could not refresh rates — using saved rates.' : 'Could not load exchange rates. Check your internet connection.';
  } finally {
    loading = false;
    recalc();
    renderMeta();
  }
}

function recalc() {
  const c = cur();
  const from = c.side, to = from === 'left' ? 'right' : 'left';
  const amt = parseAmount(c.amount);
  if (inputs[from] && document.activeElement !== inputs[from]) inputs[from].value = c.amount;
  if (inputs[to]) inputs[to].value = amt == null ? '' : formatOut(convert(amt, c[from], c[to]), c[to]);
}

function pickCurrency(side) {
  const c = cur();
  const r = rates();
  const codes = Object.keys(r || { GBP: 1, EUR: 1, USD: 1 }).sort();
  const all = codes.map((code) => ({ code, name: currencyName(code) }));
  const input = el('input', { type: 'search', class: 'input', placeholder: 'Search code or name, e.g. yen', autocomplete: 'off', spellcheck: false });
  const list = el('div', { class: 'results' });
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    list.innerHTML = '';
    const items = all.filter((x) => !q || x.code.toLowerCase().includes(q) || x.name.toLowerCase().includes(q));
    if (!items.length) list.append(el('p', { class: 'muted small' }, 'No matching currency.'));
    for (const x of items) {
      list.append(el('button', {
        type: 'button', class: 'result cur-result' + (x.code === c[side] ? ' selected' : ''),
        onclick: () => { c[side] = x.code; store.save(); m.close(); render(); },
      }, el('span', { class: 'cur-code' }, x.code), el('span', { class: 'r-sub' }, x.name)));
    }
  };
  input.addEventListener('input', draw);
  const m = openModal({ title: 'Choose currency', className: 'tall', content: [input, list], actions: [{ label: 'Cancel' }] });
  draw();
}

function swap() {
  const c = cur();
  [c.left, c.right] = [c.right, c.left];
  // keep the number the user typed in the same box position
  c.side = c.side === 'left' ? 'right' : 'left';
  store.save();
  render();
}

function side(sideName) {
  const c = cur();
  const code = c[sideName];
  const input = el('input', {
    class: 'input amount', type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-label': `${code} amount`,
    oninput: (e) => { c.amount = e.target.value; c.side = sideName; store.save(); recalc(); renderMeta(); },
    onfocus: (e) => e.target.select(),
  });
  inputs[sideName] = input;
  return el('div', { class: 'cur-side' },
    el('button', { type: 'button', class: 'cur-pick', onclick: () => pickCurrency(sideName) },
      el('span', { class: 'cur-code' }, code), el('span', { class: 'cur-name' }, currencyName(code)), el('span', { class: 'caret' }, '▾')),
    input);
}

function renderMeta() {
  const meta = document.getElementById('cur-meta');
  if (!meta) return;
  meta.innerHTML = '';
  const c = cur();
  const rc = c.ratesCache;
  if (rc) {
    const a = convert(1, c.left, c.right), b = convert(1, c.right, c.left);
    meta.append(
      el('div', { class: 'cur-rate' }, `1 ${c.left} = ${fmtRate(a)} ${c.right}`),
      el('div', { class: 'cur-rate muted' }, `1 ${c.right} = ${fmtRate(b)} ${c.left}`),
      el('div', { class: 'muted small' },
        `Rates published ${new Date(rc.updatedUnix * 1000).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` +
        ` · downloaded ${fmtAgo(rc.fetchedAt)}`),
      el('div', { class: 'muted small' }, `${Object.keys(rc.rates).length} currencies · Rates by ExchangeRate-API (open.er-api.com), updated daily`));
  }
  if (loading) meta.append(el('div', { class: 'muted small' }, 'Updating rates…'));
  if (error) meta.append(el('div', { class: 'notice ' + (rc ? 'warn' : 'bad') }, error));
}

export function render() {
  const box = root();
  box.innerHTML = '';
  inputs = {};
  box.append(el('div', { class: 'card cur-card' },
    side('left'),
    el('div', { class: 'swap-row' }, el('button', { type: 'button', class: 'icon-btn swap', 'aria-label': 'Swap currencies', onclick: swap }, '⇅')),
    side('right')));
  box.append(el('div', { class: 'card', id: 'cur-meta' }));
  box.append(el('button', { type: 'button', class: 'btn wide', onclick: () => { toast('Updating rates…', 1000); loadRates(true); } }, 'Refresh rates'));
  recalc();
  renderMeta();
}

export function initCurrency() { render(); }
export function showCurrency() { render(); loadRates(false); }
