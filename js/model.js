// Watch data model: reference lists, safe migration of older saved data, and derived values.
// Pure functions only (no DOM, no store import) so store.js can run the migration while loading.

const DAY = 86400000;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/* ---------- Features (multi-select tags) ---------- */
export const FEATURE_GROUPS = [
  { k: 'time', title: 'Time', items: [['hacking', 'Hacking seconds'], ['smallSeconds', 'Small seconds'], ['centralSeconds', 'Central sweep seconds'],
    ['jumpingHour', 'Jumping hour'], ['retrograde', 'Retrograde'], ['regulator', 'Regulator'], ['powerReserveInd', 'Power reserve indicator']] },
  { k: 'calendar', title: 'Calendar', items: [['date', 'Date'], ['bigDate', 'Big date'], ['dayDate', 'Day-date'], ['annualCal', 'Annual calendar'],
    ['perpetualCal', 'Perpetual calendar'], ['moonphase', 'Moon phase']] },
  { k: 'timing', title: 'Timing', items: [['chronograph', 'Chronograph'], ['flyback', 'Flyback chronograph'], ['rattrapante', 'Split-seconds (rattrapante)'],
    ['tachymeter', 'Tachymeter'], ['telemeter', 'Telemeter'], ['pulsometer', 'Pulsometer'], ['countdown', 'Countdown timer'], ['alarm', 'Alarm']] },
  { k: 'travel', title: 'Travel', items: [['gmt', 'GMT / dual time'], ['worldTimer', 'World timer']] },
  { k: 'tool', title: 'Tool / sport', items: [['diverBezel', 'Diver’s bezel (unidirectional)'], ['hev', 'Helium escape valve'], ['screwCrown', 'Screw-down crown'],
    ['slideRule', 'Slide-rule bezel'], ['antiMagnetic', 'Anti-magnetic'], ['shockResistant', 'Shock resistant']] },
  { k: 'complications', title: 'Complications', items: [['tourbillon', 'Tourbillon'], ['minuteRepeater', 'Minute repeater'], ['skeleton', 'Skeleton']] },
  { k: 'power', title: 'Power', items: [['automatic', 'Automatic'], ['manualWind', 'Manual wind'], ['quartz', 'Quartz'], ['solar', 'Solar'],
    ['radio', 'Radio-controlled'], ['springDrive', 'Spring Drive']] },
  { k: 'other', title: 'Certification / other', items: [['chronometer', 'Chronometer certified'], ['sapphire', 'Sapphire crystal'], ['lume', 'Lume'],
    ['quickset', 'Quickset date']] },
];

/** Every feature on offer: built-in plus the person's own. [{ id, label, group }] */
export function allFeatures(d) {
  const out = [];
  for (const g of FEATURE_GROUPS) for (const [id, label] of g.items) out.push({ id, label, group: g.k });
  for (const c of d.customFeatures || []) out.push({ id: c.id, label: c.label, group: 'custom' });
  return out;
}
export const featureLabel = (d, id) => (allFeatures(d).find((f) => f.id === id) || { label: id }).label;

// Older versions stored five features as yes/no fields, plus the movement type.
const LEGACY_FEATURES = { fDate: 'date', fDay: 'dayDate', fGmt: 'gmt', fChrono: 'chronograph', fPowerInd: 'powerReserveInd', chronometer: 'chronometer' };
const MOVEMENT_FEATURE = { automatic: 'automatic', manual: 'manualWind', quartz: 'quartz', solar: 'solar', springdrive: 'springDrive' };

/** A watch's feature ids (saved list, plus anything still only held in the older yes/no fields). */
export function featuresOf(w) {
  const set = new Set(Array.isArray(w.features) ? w.features : []);
  for (const [k, id] of Object.entries(LEGACY_FEATURES)) if (w[k] && !(w.featuresTouched)) set.add(id);
  return [...set];
}

/* ---------- Categories ---------- */
export const CATEGORIES = [['dress', 'Dress'], ['sports', 'Sports'], ['travel', 'Travel'], ['tough', 'Tough'], ['fitness', 'Fitness'],
  ['diver', 'Diver'], ['daily', 'Daily'], ['special', 'Special occasion'], ['dressCasual', 'Dress-casual']];
export function allCategories(d) {
  return [...CATEGORIES.map(([id, label]) => ({ id, label })), ...(d.customCategories || []).map((c) => ({ id: c.id, label: c.label }))];
}
export const categoryLabel = (d, id) => (allCategories(d).find((c) => c.id === id) || { label: id }).label;

/* ---------- Sentimental ---------- */
export const HOW_ACQUIRED = [['bought', 'Bought it myself'], ['present', 'Given as a present'], ['inherited', 'Inherited'], ['other', 'Other']];
export const WHY_BOUGHT = [['achievement', 'Achievement'], ['treat', 'Treat to myself'], ['milestone', 'Milestone'], ['sentimental', 'Sentimental'],
  ['collection', 'Part of my collection'], ['investment', 'Investment'], ['other', 'Other']];

/* ---------- Galleries ---------- */
export const DEFAULT_GALLERIES = [['wrist', 'Wrist shots'], ['lume', 'Lume'], ['box', 'Box and papers'], ['world', 'Around the world'], ['insurance', 'Insurance']];
const OLD_GALLERY_NAMES = { wrist: 'Wrist shots', moments: 'Favourite moments', marks: 'Marks & blemishes', general: 'General', lume: 'Lume' };

/* ---------- Migration (runs on every load; safe to run repeatedly) ---------- */
export function migrateWatch(w) {
  if (!isObj(w)) return w;

  // Features: move the old yes/no fields and the movement type into the tag list (old fields are kept).
  if (!Array.isArray(w.features)) {
    const f = new Set();
    for (const [k, id] of Object.entries(LEGACY_FEATURES)) if (w[k]) f.add(id);
    if (MOVEMENT_FEATURE[w.movement]) f.add(MOVEMENT_FEATURE[w.movement]);
    w.features = [...f];
    w.featuresTouched = true;
  }
  if (!Array.isArray(w.categories)) w.categories = [];

  // Accuracy readings: manual marks (from measuring runs) and timegrapher results become one list.
  if (!Array.isArray(w.readings)) {
    const out = [];
    for (const run of Array.isArray(w.runs) ? w.runs : []) {
      const rs = (run.readings || []).slice().sort((a, b) => a.t - b.t);
      rs.forEach((r, i) => out.push({
        id: r.id || uid(), timestamp: r.t, offsetSeconds: r.offset, source: 'manual',
        ...(i === 0 ? { setToZero: true } : {}), ...(r.pos ? { position: r.pos } : {}),
        ...(r.synced != null ? { synced: r.synced } : {}), ...(r.acc != null ? { acc: r.acc } : {}),
      }));
    }
    for (const x of Array.isArray(w.timegrapher) ? w.timegrapher : []) {
      out.push({ id: uid(), timestamp: x.t, offsetSeconds: null, source: 'timegrapher',
        timegrapherData: { rate: x.rate, beatError: x.beatError, bph: x.bph, confidence: x.confidence, seconds: x.seconds } });
    }
    w.readings = out.sort((a, b) => a.timestamp - b.timestamp);
  }

  // Value history: the purchase price and any estimate become dated entries.
  if (!Array.isArray(w.valueHistory)) {
    const vh = [];
    const pd = w.purchaseDate || (w.added ? new Date(w.added).toISOString().slice(0, 10) : null);
    if (w.purchasePrice != null && pd) vh.push({ id: uid(), date: pd, value: Number(w.purchasePrice), note: 'Purchase price' });
    if (w.value != null) vh.push({ id: uid(), date: w.valueDate || new Date().toISOString().slice(0, 10), value: Number(w.value), note: 'Estimate' });
    w.valueHistory = vh;
  }

  // Sentimental: a gift recorded under "Bought from" becomes "Given as a present".
  if (w.howAcquired === undefined) w.howAcquired = w.sellerType === 'gift' ? 'present' : (w.sellerType ? 'bought' : null);

  // Locations: places added by hand.
  if (!Array.isArray(w.locations)) {
    w.locations = (Array.isArray(w.places) ? w.places : []).map((p) => ({
      id: p.id || uid(), lat: p.lat, lng: p.lon, date: p.when ? new Date(p.when).toISOString().slice(0, 10) : null,
      placeName: [p.name, p.sub].filter(Boolean).join(', '), photoIds: [],
    }));
  }

  // Galleries: named albums with a cover. Photo details (when, where, note) are kept per photo.
  if (!Array.isArray(w.galleryList)) {
    const meta = isObj(w.photoMeta) ? w.photoMeta : {};
    const list = DEFAULT_GALLERIES.map(([id, name]) => ({ id, name, coverPhotoId: null, photoIds: [] }));
    const old = isObj(w.galleries) ? w.galleries : {};
    for (const [k, items] of Object.entries(old)) {
      if (!Array.isArray(items) || !items.length) continue;
      let g = list.find((x) => x.id === k);
      if (!g) { g = { id: k, name: OLD_GALLERY_NAMES[k] || k, coverPhotoId: null, photoIds: [] }; list.push(g); }
      for (const it of items.slice().sort((a, b) => (a.taken || 0) - (b.taken || 0))) {
        if (!it || !it.id) continue;
        g.photoIds.push(it.id);
        meta[it.id] = { taken: it.taken || null, takenGuess: !!it.takenGuess, lat: it.lat ?? null, lng: it.lon ?? null,
          town: it.town || null, region: it.region || null, note: it.note || '' };
      }
    }
    const ins = list.find((x) => x.id === 'insurance');
    for (const id of Object.values(isObj(w.insPhotos) ? w.insPhotos : {})) if (id && !ins.photoIds.includes(id)) ins.photoIds.push(id);
    w.galleryList = list;
    w.photoMeta = meta;
  }
  if (!isObj(w.photoMeta)) w.photoMeta = {};
  if (!Array.isArray(w.insDocs)) w.insDocs = [];
  return w;
}

/* ---------- Derived values ---------- */
export const readingsOf = (w) => (w.readings || []).slice().sort((a, b) => a.timestamp - b.timestamp);

/** Latest value entry and the trend across entries. */
export function valueInfo(w) {
  const vh = (w.valueHistory || []).filter((x) => x.value != null && x.date).slice().sort((a, b) => a.date.localeCompare(b.date));
  const latest = vh[vh.length - 1] || null;
  let trend = 'flat', slopePerYear = 0, projection = null;
  if (vh.length >= 2) {
    // Least-squares line through the entries (value against years).
    const xs = vh.map((x) => Date.parse(x.date) / (365.25 * DAY)), ys = vh.map((x) => x.value);
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let num = 0, den = 0;
    xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2; });
    slopePerYear = den ? num / den : 0;
    const rel = my ? slopePerYear / my : 0;
    trend = rel > 0.01 ? 'up' : rel < -0.01 ? 'down' : 'flat';
    if (vh.length >= 3) {
      const x1 = xs[xs.length - 1] + 1;
      projection = { date: new Date(x1 * 365.25 * DAY).toISOString().slice(0, 10), value: Math.max(0, my + slopePerYear * (x1 - mx)) };
    }
  }
  return { entries: vh, latest, trend, slopePerYear, projection };
}

/** Service: last date, interval, next due (calculated) and how soon. */
export function serviceInfo(w, now = Date.now()) {
  const last = w.lastService ? Date.parse(w.lastService) : null;
  const years = Number(w.serviceInterval) || null;
  let next = null;
  if (last && years) { const x = new Date(last); x.setMonth(x.getMonth() + Math.round(years * 12)); next = x.getTime(); }
  const daysLeft = next ? Math.round((next - now) / DAY) : null;
  return { last, years, next, daysLeft, overdue: daysLeft != null && daysLeft < 0, soon: daysLeft != null && daysLeft >= 0 && daysLeft <= 90 };
}

/** Purchase anniversary: years together if today is the day (29 Feb counts as 28 Feb in other years). */
export function birthdayYears(w, today = new Date()) {
  if (!w.purchaseDate) return 0;
  const [y, m, dd] = w.purchaseDate.split('-').map(Number);
  if (!y || !m || !dd) return 0;
  const leap = (yr) => (yr % 4 === 0 && yr % 100 !== 0) || yr % 400 === 0;
  let day = dd;
  if (m === 2 && dd === 29 && !leap(today.getFullYear())) day = 28;
  if (today.getMonth() + 1 !== m || today.getDate() !== day) return 0;
  const years = today.getFullYear() - y;
  return years >= 1 ? years : 0;
}

/** Great-circle distance in km. */
export function km(a, b) {
  const r = Math.PI / 180;
  const x = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(x));
}

/**
 * Every place a watch has been: locations added by hand plus photos with GPS, grouped when within ~5 km
 * (or the same town). Sorted by date; distance is the sum of the hops between them (an estimate).
 */
export function placesOf(w) {
  const pts = [];
  for (const loc of w.locations || []) if (loc.lat != null) pts.push({ ...loc, photoIds: [...(loc.photoIds || [])], manual: true, t: loc.date ? Date.parse(loc.date) : 0 });
  const meta = w.photoMeta || {};
  for (const g of w.galleryList || []) for (const id of g.photoIds) {
    const m = meta[id];
    if (!m || m.lat == null) continue;
    pts.push({ id, lat: m.lat, lng: m.lng, placeName: [m.town, m.region].filter(Boolean).join(', '), photoIds: [id], t: m.taken || 0 });
  }
  const groups = [];
  for (const p of pts.sort((a, b) => a.t - b.t)) {
    const town = (p.placeName || '').split(',')[0];
    const g = groups.find((x) => (town && x.town === town) || km(x, p) < 5);
    if (g) {
      for (const id of p.photoIds) if (!g.photoIds.includes(id)) g.photoIds.push(id);
      g.n++; if (p.manual) g.manualIds.push(p.id);
      if (!g.placeName && p.placeName) { g.placeName = p.placeName; g.town = town; }
    } else {
      groups.push({ lat: p.lat, lng: p.lng, placeName: p.placeName, town, t: p.t, photoIds: [...p.photoIds], n: 1, manualIds: p.manual ? [p.id] : [] });
    }
  }
  let distance = 0;
  for (let i = 1; i < groups.length; i++) distance += km(groups[i - 1], groups[i]);
  return { places: groups, distance };
}

/** Every photo id a watch owns (face, photos, galleries, insurance, documents). */
export function photoIdsOf(w) {
  return [...new Set([w.face, ...(w.photos || []), ...Object.values(w.insPhotos || {}),
    ...(w.galleryList || []).flatMap((g) => g.photoIds),
    ...Object.values(w.galleries || {}).flat().map((p) => p && p.id),
    ...(w.insDocs || []).map((x) => x.photoId)].filter(Boolean))];
}
