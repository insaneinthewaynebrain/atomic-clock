// Weather tab: Open-Meteo, Met Office (UKMO) model first, Open-Meteo default as fallback per value.
import * as store from './store.js';
import { el, fetchJSON, placeSearchModal, placeLabel, fmtAgo, toast } from './ui.js';

const MODELS = ['ukmo_seamless', 'best_match'];
const MODEL_NAME = { ukmo_seamless: 'UK Met Office', best_match: 'Open-Meteo default' };
const CURRENT = ['temperature_2m', 'weather_code', 'wind_speed_10m', 'wind_gusts_10m', 'is_day'];
const HOURLY = ['precipitation_probability'];
const DAILY = ['weather_code', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_probability_max', 'wind_speed_10m_max', 'wind_gusts_10m_max'];
const FIELD_LABEL = {
  temperature_2m: 'temperature', weather_code: 'conditions', wind_speed_10m: 'wind', wind_gusts_10m: 'gusts',
  precipitation_probability: 'rain chance', temperature_2m_max: 'temperature', temperature_2m_min: 'temperature',
  precipitation_probability_max: 'rain chance', wind_speed_10m_max: 'wind', wind_gusts_10m_max: 'gusts', is_day: null,
};
const STALE_MS = 10 * 60 * 1000;

// WMO weather codes → [label, day icon, night icon]
const WMO = {
  0: ['Clear', '☀️', '🌙'], 1: ['Mainly clear', '🌤️', '🌙'], 2: ['Partly cloudy', '⛅', '☁️'], 3: ['Overcast', '☁️', '☁️'],
  45: ['Fog', '🌫️', '🌫️'], 48: ['Freezing fog', '🌫️', '🌫️'],
  51: ['Light drizzle', '🌦️', '🌧️'], 53: ['Drizzle', '🌦️', '🌧️'], 55: ['Heavy drizzle', '🌧️', '🌧️'],
  56: ['Freezing drizzle', '🌧️', '🌧️'], 57: ['Freezing drizzle', '🌧️', '🌧️'],
  61: ['Light rain', '🌦️', '🌧️'], 63: ['Rain', '🌧️', '🌧️'], 65: ['Heavy rain', '🌧️', '🌧️'],
  66: ['Freezing rain', '🌧️', '🌧️'], 67: ['Freezing rain', '🌧️', '🌧️'],
  71: ['Light snow', '🌨️', '🌨️'], 73: ['Snow', '🌨️', '🌨️'], 75: ['Heavy snow', '❄️', '❄️'], 77: ['Snow grains', '🌨️', '🌨️'],
  80: ['Light showers', '🌦️', '🌧️'], 81: ['Showers', '🌧️', '🌧️'], 82: ['Violent showers', '⛈️', '⛈️'],
  85: ['Snow showers', '🌨️', '🌨️'], 86: ['Heavy snow showers', '❄️', '❄️'],
  95: ['Thunderstorm', '⛈️', '⛈️'], 96: ['Thunderstorm, hail', '⛈️', '⛈️'], 99: ['Thunderstorm, hail', '⛈️', '⛈️'],
};
export function wmo(code, isDay = 1) {
  const w = WMO[code] || ['Unknown', '❔', '❔'];
  return { label: w[0], icon: isDay === 0 ? w[2] : w[1] };
}

export function windLight(gust) {
  if (gust == null) return { cls: '', label: '—' };
  if (gust < 20) return { cls: 'good', label: 'Low wind' };
  if (gust < 40) return { cls: 'mid', label: 'Gusty' };
  return { cls: 'badr', label: 'Strong gusts' };
}

const root = () => document.getElementById('weather');
let loading = false;
let message = '';

function buildUrl(lat, lon, models) {
  const q = new URLSearchParams({
    latitude: lat.toFixed(4), longitude: lon.toFixed(4),
    current: CURRENT.join(','), hourly: [...HOURLY, ...CURRENT].join(','), daily: DAILY.join(','),
    wind_speed_unit: 'mph', temperature_unit: 'celsius', timezone: 'auto', forecast_days: '4',
  });
  if (models) q.set('models', models.join(','));
  return 'https://api.open-meteo.com/v1/forecast?' + q.toString();
}

/** Pick a value: Met Office first, then the default model. Records which model supplied each field. */
function makePicker(models, used) {
  return function pick(block, name, idx) {
    if (!block) return null;
    for (const m of models) {
      let v = block[`${name}_${m}`];
      if (v === undefined && (m === 'best_match' || models.length === 1)) v = block[name];
      if (idx != null) v = Array.isArray(v) ? v[idx] : undefined;
      if (v != null && !Number.isNaN(v)) {
        if (FIELD_LABEL[name]) (used[m] ||= new Set()).add(FIELD_LABEL[name]);
        return v;
      }
    }
    return null;
  };
}

/** Turn a raw Open-Meteo response into what the screen shows. */
export function interpret(raw, models) {
  const used = {};
  const pick = makePicker(models, used);
  const c = raw.current || {};
  let hourIdx = -1;
  const ht = raw.hourly?.time || [];
  if (c.time) hourIdx = ht.indexOf(c.time.slice(0, 13) + ':00');
  if (hourIdx < 0) hourIdx = 0;
  // With several models the "current" block isn't labelled by model, so read this hour from
  // each model's hourly data (Met Office first) and only fall back to the current block.
  const now = (name) => { const v = pick(raw.hourly, name, hourIdx); return v != null ? v : pick(c, name); };
  const isDay = now('is_day');
  const current = {
    time: c.time,
    temp: now('temperature_2m'),
    code: now('weather_code'),
    isDay: isDay == null ? 1 : isDay,
    wind: now('wind_speed_10m'),
    gust: now('wind_gusts_10m'),
    rain: pick(raw.hourly, 'precipitation_probability', hourIdx),
  };
  const days = (raw.daily?.time || []).slice(0, 4).map((date, i) => ({
    date,
    code: pick(raw.daily, 'weather_code', i),
    max: pick(raw.daily, 'temperature_2m_max', i),
    min: pick(raw.daily, 'temperature_2m_min', i),
    rain: pick(raw.daily, 'precipitation_probability_max', i),
    wind: pick(raw.daily, 'wind_speed_10m_max', i),
    gust: pick(raw.daily, 'wind_gusts_10m_max', i),
  }));
  const sources = Object.entries(used).map(([m, set]) => ({ model: m, name: MODEL_NAME[m] || m, fields: [...set] }));
  return { current, days, sources, timezone: raw.timezone };
}

async function fetchForecast(lat, lon) {
  try {
    return { raw: await fetchJSON(buildUrl(lat, lon, MODELS), 12000), models: MODELS };
  } catch (e) {
    if (/HTTP 4(00|29)/.test(e.message) && !/limit/i.test(e.message)) {
      // Model combination rejected: fall back to Open-Meteo's default model only.
      return { raw: await fetchJSON(buildUrl(lat, lon, null), 12000), models: ['best_match'] };
    }
    throw e;
  }
}

export function getPosition() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) { reject(new Error('Location is not available on this device')); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      (e) => reject(new Error(e.code === 1 ? 'Location permission was declined' : 'Could not get your location')),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 10 * 60 * 1000 });
  });
}

async function refresh(force = false) {
  const w = store.get().weather;
  if (loading) return;
  if (!force && w.cache && Date.now() - w.cache.at < STALE_MS && sameLocation(w)) { render(); return; }
  loading = true; message = ''; render();
  try {
    let place;
    if (w.mode === 'place' && w.place) place = { ...w.place };
    else {
      const pos = await getPosition();
      place = { name: 'Your location', gps: true, ...pos };
      Object.assign(place, await nearestTown(pos.lat, pos.lon, w.cache?.place));
      w.mode = 'gps';
    }
    const { raw, models } = await fetchForecast(place.lat, place.lon);
    w.cache = { at: Date.now(), place, raw, models };
    store.save();
  } catch (e) {
    message = e.message || 'Could not load the weather';
    if (/declined|location/i.test(message) && w.mode !== 'place') w.mode = 'declined';
    store.save();
  } finally {
    loading = false;
    render();
  }
}

/* ---------- Coordinates -> nearest town (free, keyless) ---------- */
let regionNames = null;
try { regionNames = new Intl.DisplayNames(['en-GB'], { type: 'region' }); } catch (e) { regionNames = null; }
const countryName = (code, fallback) => {
  try { return (code && regionNames && regionNames.of(code.toUpperCase())) || fallback || ''; } catch (e) { return fallback || ''; }
};

function kmBetween(a, b) {
  const r = Math.PI / 180;
  const x = (b.lon - a.lon) * r * Math.cos(((a.lat + b.lat) / 2) * r), y = (b.lat - a.lat) * r;
  return Math.sqrt(x * x + y * y) * 6371;
}

export async function nearestTown(lat, lon, previous) {
  // Reuse the last name if we've barely moved.
  if (previous && previous.gps && previous.town && kmBetween(previous, { lat, lon }) < 1) {
    return { town: previous.town, region: previous.region };
  }
  try {
    const j = await fetchJSON(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`, 8000);
    const town = j.city || j.locality;
    if (town) return { town, region: [j.principalSubdivision, countryName(j.countryCode, j.countryName)].filter(Boolean).join(', ') };
  } catch (e) { /* try the next service */ }
  try {
    const j = await fetchJSON(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&accept-language=en&lat=${lat}&lon=${lon}`, 8000);
    const a = j.address || {};
    const town = a.town || a.village || a.city || a.suburb || a.hamlet || a.municipality || j.name;
    if (town) return { town, region: [a.county || a.state, countryName(a.country_code, a.country)].filter((x, i, arr) => x && arr.indexOf(x) === i).join(', ') };
  } catch (e) { /* fall through */ }
  return {};
}

function sameLocation(w) {
  const p = w.cache?.place;
  if (!p) return false;
  if (w.mode === 'gps') return !!p.gps && !!p.town;
  if (w.mode === 'place' && w.place) return !p.gps && p.lat === w.place.lat && p.lon === w.place.lon;
  return false;
}

function choosePlace() {
  placeSearchModal({
    title: 'Weather for…',
    onPick: (p) => {
      const w = store.get().weather;
      w.mode = 'place';
      w.place = { name: p.name, admin1: p.admin1, country: p.country, lat: p.lat, lon: p.lon };
      store.save();
      refresh(true);
    },
  });
}

function useGps() {
  store.get().weather.mode = 'gps';
  store.save();
  refresh(true);
}

function dayName(iso, i) {
  if (i === 0) return 'Today';
  if (i === 1) return 'Tomorrow';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' });
}

const n0 = (v, unit = '') => (v == null ? '—' : Math.round(v) + unit);

function light(gust) {
  const l = windLight(gust);
  return el('span', { class: 'light ' + l.cls, title: l.label }, el('span', { class: 'light-dot' }), l.label);
}

export function render() {
  const box = root();
  box.innerHTML = '';
  const w = store.get().weather;
  const cache = w.cache;

  let placeTitle = w.place ? w.place.name : '', placeSub = '';
  if (cache) {
    const p = cache.place;
    if (p.gps) {
      placeTitle = '📍 ' + (p.town || 'Your location');
      placeSub = p.town ? `${p.region ? p.region + ' · ' : ''}your current location` : `${p.lat.toFixed(2)}, ${p.lon.toFixed(2)}`;
    } else {
      placeTitle = p.name;
      placeSub = placeLabel(p);
    }
  }

  box.append(el('div', { class: 'wx-head' },
    el('div', {}, el('div', { class: 'wx-place' }, placeTitle || 'Weather'), placeSub ? el('div', { class: 'muted small' }, placeSub) : null),
    el('div', { class: 'wx-btns' },
      el('button', { type: 'button', class: 'btn sm', onclick: useGps }, '📍 My location'),
      el('button', { type: 'button', class: 'btn sm', onclick: choosePlace }, '🔍 Place'))));

  if (loading) box.append(el('p', { class: 'muted' }, 'Loading weather…'));
  if (message) {
    box.append(el('div', { class: 'notice bad' }, message,
      w.mode === 'declined' ? el('div', {}, el('button', { type: 'button', class: 'btn primary', onclick: choosePlace }, 'Type a place instead')) : null));
  }
  if (!cache) {
    if (!loading && !message) {
      if (w.mode === 'declined') {
        box.append(el('div', { class: 'notice' }, 'Location is off for this app. Type a place instead, or tap “My location” to try again.',
          el('div', {}, el('button', { type: 'button', class: 'btn primary', onclick: choosePlace }, 'Type a place'))));
      } else box.append(el('p', { class: 'muted' }, 'Getting your location…'));
    }
    return;
  }

  const data = interpret(cache.raw, cache.models || MODELS);
  const c = data.current;
  const cw = wmo(c.code, c.isDay);

  box.append(el('div', { class: 'card wx-now' },
    el('div', { class: 'wx-now-top' },
      el('div', { class: 'wx-icon big' }, cw.icon),
      el('div', {},
        el('div', { class: 'wx-temp' }, n0(c.temp, '°C')),
        el('div', { class: 'wx-cond' }, cw.label))),
    el('div', { class: 'wx-grid' },
      el('div', {}, el('div', { class: 'stat-label' }, 'Rain chance'), el('div', { class: 'stat-value' }, n0(c.rain, '%'))),
      el('div', {}, el('div', { class: 'stat-label' }, 'Wind'), el('div', { class: 'stat-value' }, n0(c.wind, ' mph'))),
      el('div', {}, el('div', { class: 'stat-label' }, 'Gusts'), el('div', { class: 'stat-value' }, n0(c.gust, ' mph'))),
      el('div', {}, el('div', { class: 'stat-label' }, 'Wind light'), light(c.gust)))));

  const list = el('div', { class: 'card wx-days' }, el('h2', { class: 'card-title' }, 'Today + 3 days'));
  data.days.forEach((d, i) => {
    const dw = wmo(d.code, 1);
    list.append(el('div', { class: 'wx-day' },
      el('div', { class: 'wx-line' },
        el('div', { class: 'wx-dname' }, dayName(d.date, i)),
        el('div', { class: 'wx-icon', title: dw.label }, dw.icon),
        el('div', { class: 'wx-hilo' }, el('b', {}, n0(d.max, '°')), el('span', { class: 'muted' }, ' / ' + n0(d.min, '°'))),
        el('div', { class: 'wx-rain' }, '💧 ' + n0(d.rain, '%'))),
      el('div', { class: 'wx-line' },
        el('div', { class: 'wx-wind' }, `${dw.label} · wind ${n0(d.wind)}, gusts ${n0(d.gust)} mph`),
        el('div', { class: 'wx-light' }, light(d.gust)))));
  });
  list.append(el('p', { class: 'muted small' }, 'Wind column: max wind / max gust. Light: green under 20 mph gusts, amber 20–39, red 40+.'));
  box.append(list);

  const ukmo = data.sources.find((s) => s.model === 'ukmo_seamless');
  const dflt = data.sources.find((s) => s.model === 'best_match');
  let src;
  if (ukmo && dflt) src = `UK Met Office model. Open-Meteo default model fills gaps for: ${dflt.fields.join(', ')}`;
  else if (ukmo) src = 'UK Met Office model';
  else src = 'Open-Meteo default model (Met Office model not available here)';
  box.append(el('p', { class: 'muted small wx-src' },
    `Source: ${src} — via Open-Meteo.com. Updated ${fmtAgo(cache.at)}.`,
    !navigator.onLine ? ' Offline: showing saved forecast.' : ''));
  box.append(el('button', { type: 'button', class: 'btn wide', onclick: () => { toast('Refreshing…', 1000); refresh(true); } }, 'Refresh'));
}

export function initWeather() { render(); }
export function showWeather() {
  const w = store.get().weather;
  render();
  if (w.mode === 'declined' && !w.place) return;
  refresh(false);
}
