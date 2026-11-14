// All app data lives in one localStorage entry.
const KEY = 'atomic-clock-data-v1';

function defaults() {
  return {
    version: 1,
    thresholds: { green: 5, amber: 15 },          // s/day
    watches: [],                                    // [{id, name, runs:[{id, readings:[{id,t,offset,synced,acc}]}]}]
    selectedWatchId: null,
    worldSlots: [null, null, null, null, null],     // [{name, admin1, country, timezone, lat, lon}]
    weather: { mode: null, place: null, cache: null },
    currency: { left: 'GBP', right: 'EUR', amount: '1', side: 'left', ratesCache: null },
  };
}

function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }

function merge(def, obj) {
  if (!isObj(obj)) return def;
  const out = { ...def };
  for (const k of Object.keys(obj)) {
    if (isObj(def[k]) && isObj(obj[k])) out[k] = { ...def[k], ...obj[k] };
    else if (obj[k] !== undefined) out[k] = obj[k];
  }
  if (!Array.isArray(out.watches)) out.watches = [];
  if (!Array.isArray(out.worldSlots)) out.worldSlots = def.worldSlots;
  while (out.worldSlots.length < 5) out.worldSlots.push(null);
  out.worldSlots = out.worldSlots.slice(0, 5);
  return out;
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return merge(defaults(), JSON.parse(raw));
  } catch (e) { console.warn('Could not read saved data', e); }
  return defaults();
}

let data = load();

export function get() { return data; }

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(data)); }
  catch (e) { console.warn('Could not save data', e); }
}

/** Data for a backup file (caches left out). */
export function exportData() {
  const copy = JSON.parse(JSON.stringify(data));
  if (copy.weather) copy.weather.cache = null;
  if (copy.currency) copy.currency.ratesCache = null;
  return { app: 'atomic-clock', exportedAt: new Date().toISOString(), data: copy };
}

/** Replace everything with an imported backup. Throws if the file is not a backup. */
export function importData(obj) {
  const d = obj && obj.app === 'atomic-clock' && isObj(obj.data) ? obj.data : obj;
  if (!isObj(d) || !(Array.isArray(d.watches) || Array.isArray(d.worldSlots))) {
    throw new Error('This file is not an Atomic Clock backup.');
  }
  const keepCaches = { w: data.weather.cache, r: data.currency.ratesCache };
  data = merge(defaults(), d);
  if (!data.weather.cache) data.weather.cache = keepCaches.w;
  if (!data.currency.ratesCache) data.currency.ratesCache = keepCaches.r;
  save();
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
