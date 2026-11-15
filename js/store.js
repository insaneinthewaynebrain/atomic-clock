// All app data lives in one localStorage entry.
const KEY = 'atomic-clock-data-v1';

function defaults() {
  return {
    version: 2,
    createdAt: Date.now(),
    lastBackupAt: null,
    money: 'GBP',                                   // currency for watch prices/values
    wear: [],                                       // [{id, watchId, on, off}]
    tools: { hidden: [] },
    collectionView: { tab: 'owned', sort: 'brand', q: '' },
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
  if (!Array.isArray(out.wear)) out.wear = [];
  if (!Array.isArray(out.tools.hidden)) out.tools.hidden = [];
  // v1 → v2: every existing watch becomes an owned watch in the collection.
  out.watches = out.watches.filter(isObj).map((w) => ({
    ...w,
    id: w.id || uid(),
    name: w.name || [w.brand, w.model].filter(Boolean).join(' ') || 'Watch',
    status: w.status || 'owned',
    runs: Array.isArray(w.runs) ? w.runs : [],
    photos: Array.isArray(w.photos) ? w.photos : [],
  }));
  out.version = 2;
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

/** Data for a backup file (caches left out). Photos are added by backup.js. */
export function exportData() {
  const copy = JSON.parse(JSON.stringify(data));
  if (copy.weather) copy.weather.cache = null;
  if (copy.currency) copy.currency.ratesCache = null;
  return { app: 'atomic-clock', backupVersion: 2, exportedAt: new Date().toISOString(), data: copy };
}

/* Tiny change notifications so screens can refresh each other. */
const subs = {};
export function on(topic, fn) { (subs[topic] ||= []).push(fn); }
export function emit(topic) { (subs[topic] || []).forEach((f) => { try { f(); } catch (e) { console.error(e); } }); }

/** Replace everything with an imported backup. Throws if the file is not a backup. */
export function importData(obj) {
  const d = obj && obj.app === 'atomic-clock' && isObj(obj.data) ? obj.data : obj;
  if (!isObj(d) || !(Array.isArray(d.watches) || Array.isArray(d.worldSlots))) {
    throw new Error('This file is not an Atomic Clock backup.');
  }
  const keepCaches = { w: data.weather.cache, r: data.currency.ratesCache };
  const photos = obj && isObj(obj.photos) ? obj.photos : null;
  data = merge(defaults(), d);
  if (!data.weather.cache) data.weather.cache = keepCaches.w;
  if (!data.currency.ratesCache) data.currency.ratesCache = keepCaches.r;
  // A restored backup counts as backed up at the time it was made.
  const made = obj && Date.parse(obj.exportedAt);
  if (made && !(data.lastBackupAt > made)) data.lastBackupAt = made;
  save();
  return photos;
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
