// The good-morning screen shown when an alarm is stopped (and when a night is ended from Bedside mode):
// a sleep score and summary, an affirmation to match the alarm's tone, today's weather where the phone
// is, and what to wear. Older nights open the same screen without the weather.
import * as store from './store.js';
import { el, openModal, pad, fetchJSON } from './ui.js';
import { wmo, getPosition, nearestTown } from './weather.js';
import { messagesFor } from './wakewords.js';
import { normTone } from './music.js';

const BUCKET_MS = 5 * 60 * 1000;
const hhmm = (t) => { const x = new Date(t); return `${pad(x.getHours())}:${pad(x.getMinutes())}`; };
const hm = (ms) => { const m = Math.max(0, Math.round(ms / 60000)); return { h: Math.floor(m / 60), m: m % 60 }; };
const durText = (ms) => { const { h, m } = hm(ms); return h ? `${h} h ${pad(m)} min` : `${m} min`; };

/* ---------- Sleep score (0–100) ---------- */
export function sleepScore(n) {
  const asleep = (n.end - (n.listen ? n.onset : n.start)) / 3600000;
  const dur = Math.max(0, Math.min(1, (asleep - 4) / 3.5));          // 4 h → 0, 7½ h or more → full marks
  if (!n.listen) return Math.round(dur * 100);
  const calm = 1 - Math.min(1, (n.restMin || 0) / 60);
  const quiet = 1 - Math.min(1, (n.snoreMin || 0) / 90);
  const voice = 1 - Math.min(1, (n.voices?.length || 0) / 5);
  return Math.round(dur * 55 + calm * 20 + quiet * 15 + voice * 10);
}
const scoreWord = (s) => (s >= 85 ? 'Great night' : s >= 70 ? 'Good night' : s >= 50 ? 'Fair night' : 'Rough night');
const scoreColour = (s) => (s >= 85 ? '#34d399' : s >= 70 ? '#4cc2ff' : s >= 50 ? '#fbbf24' : '#f87171');

function ring(score) {
  const ns = 'http://www.w3.org/2000/svg', R = 52, C = 2 * Math.PI * R;
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 120 120'); svg.setAttribute('class', 'mo-ring');
  const add = (tag, a) => { const n = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(a)) n.setAttribute(k, v); svg.append(n); return n; };
  add('circle', { cx: 60, cy: 60, r: R, fill: 'none', stroke: 'rgba(255,255,255,.08)', 'stroke-width': 10 });
  const arc = add('circle', { cx: 60, cy: 60, r: R, fill: 'none', stroke: scoreColour(score), 'stroke-width': 10, 'stroke-linecap': 'round',
    'stroke-dasharray': `${C}`, 'stroke-dashoffset': `${C}`, transform: 'rotate(-90 60 60)', class: 'mo-arc' });
  requestAnimationFrame(() => requestAnimationFrame(() => arc.setAttribute('stroke-dashoffset', String(C * (1 - score / 100)))));
  const t = add('text', { x: 60, y: 60, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'mo-score' }); t.textContent = String(score);
  return svg;
}

function chart(n) {
  const B = n.buckets || [];
  if (!n.listen || !B.length) return null;
  const max = Math.max(4, ...B.map((b) => b[0] + b[1] + b[2]));
  const hours = [];
  const first = new Date(n.start); first.setMinutes(0, 0, 0);
  for (let t = first.getTime() + 3600000; t < n.end; t += 3600000) hours.push(t);
  const total = n.end - n.start;
  return el('div', { class: 'mo-chart' },
    el('div', { class: 'mo-bars' },
      hours.map((t) => el('i', { class: 'mo-hour', style: `left:${((t - n.start) / total) * 100}%` })),
      B.map((b, i) => {
        const h = (x) => `${Math.round((x / max) * 100)}%`;
        return el('div', { class: 'mo-col', style: `left:${((i * BUCKET_MS) / total) * 100}%;width:${(BUCKET_MS / total) * 100}%` },
          el('i', { class: 'sl-v', style: `height:${h(b[2])}` }), el('i', { class: 'sl-m', style: `height:${h(b[1])}` }), el('i', { class: 'sl-s', style: `height:${h(b[0])}` }));
      })),
    el('div', { class: 'mo-axis' }, hours.filter((_, i) => hours.length <= 8 || i % 2 === 0).map((t) =>
      el('span', { style: `left:${((t - n.start) / total) * 100}%` }, String(new Date(t).getHours()).padStart(2, '0')))),
    el('div', { class: 'sl-key small' }, el('span', {}, el('i', { class: 'sl-s' }), 'Snoring'), el('span', {}, el('i', { class: 'sl-m' }), 'Movement'), el('span', {}, el('i', { class: 'sl-v' }), 'Talking / crying out')));
}

function sleepCard(n) {
  const score = sleepScore(n);
  const asleep = n.end - (n.listen ? n.onset : n.start);
  const hist = (store.get().sleep?.history || []).filter((x) => x !== n && x.end < n.end).slice(0, 7);
  const avg = hist.length >= 2 ? hist.reduce((s, x) => s + (x.end - (x.listen ? x.onset : x.start)), 0) / hist.length : null;
  const diff = avg != null ? Math.round((asleep - avg) / 60000) : null;
  const { h, m } = hm(asleep);
  const stat = (icon, label, value, cls) => el('div', { class: 'mo-stat ' + (cls || '') }, el('div', { class: 'mo-stat-i' }, icon), el('div', { class: 'mo-stat-v' }, value), el('div', { class: 'mo-stat-l' }, label));
  const voices = n.voices?.length || 0;
  return el('div', { class: 'mo-card mo-sleep' },
    n.short ? el('div', { class: 'notice small' }, `A short test (${durText(n.end - n.start)}) — not saved to your sleep history.`) : null,
    el('div', { class: 'mo-sleep-top' },
      el('div', { class: 'mo-ring-box' }, ring(score), el('div', { class: 'mo-score-word', style: `color:${scoreColour(score)}` }, scoreWord(score))),
      el('div', { class: 'mo-sleep-main' },
        el('div', { class: 'mo-big' }, el('b', {}, String(h)), el('span', {}, 'h '), el('b', {}, pad(m)), el('span', {}, 'min')),
        el('div', { class: 'mo-sub' }, n.listen ? 'estimated sleep' : 'bedtime to alarm'),
        el('div', { class: 'mo-times' }, `🌙 ${hhmm(n.start)}`, el('span', { class: 'mo-arrow' }, '→'), `☀️ ${hhmm(n.end)}`),
        n.listen && n.onset > n.start + 60000 ? el('div', { class: 'mo-sub' }, `Probably asleep by ${hhmm(n.onset)}`) : null,
        diff != null ? el('div', { class: 'mo-sub' }, diff === 0 ? 'Same as your recent average' : `${Math.abs(diff) >= 60 ? durText(Math.abs(diff) * 60000) : Math.abs(diff) + ' min'} ${diff > 0 ? 'more' : 'less'} than your recent average`) : null)),
    n.listen ? el('div', { class: 'mo-stats' },
      stat('😴', 'Snoring', n.snoreMin ? `~${n.snoreMin} min` : n.snores ? 'A little' : 'None', n.snoreMin ? 'warn' : 'ok'),
      stat('🌀', 'Restless', n.restMin ? `~${n.restMin} min` : 'Settled', n.restMin ? 'warn' : 'ok'),
      stat('🗣️', 'Talking / crying out', voices ? `${voices}×` : 'None', voices ? 'bad' : 'ok')) : null,
    n.listen && n.snoreFrom ? el('p', { class: 'mo-note' }, `Most snoring was between ${hhmm(n.snoreFrom)} and ${hhmm(n.snoreTo)}.`) : null,
    n.listen && voices ? el('p', { class: 'mo-note' }, `Loud talking or crying out at ${n.voices.slice(0, 5).map(hhmm).join(', ')} — it could be sleep talking, a bad dream or a night terror, or another noise in the room.`) : null,
    chart(n),
    n.listen ? el('p', { class: 'mo-fine' }, 'An estimate from sounds only — not a medical test. Partners, pets and street noise can be counted too. If you snore loudly most nights, or someone notices you stop breathing or gasp in your sleep, talk to your GP.')
      : el('p', { class: 'mo-fine' }, 'Turn on “Listen for snoring and restless sleep” at bedtime for snoring and restlessness too.'));
}

/* ---------- Affirmation ---------- */
function wordsCard(tone) {
  const m = messagesFor(tone)[0];
  const t = normTone(tone);
  return el('div', { class: `mo-card mo-words mo-${t}` },
    el('div', { class: 'mo-q' }, '“'),
    el('div', { class: 'mo-words-text' }, m.text.replace(/^[“"]|[”"]$/g, '')),
    m.by ? el('div', { class: 'mo-words-by' }, '— ' + m.by) : null);
}

/* ---------- Weather and what to wear ---------- */
let wxCache = null;
function place() {
  const d = store.get();
  if (d.sunPlace) return d.sunPlace;
  const w = d.weather?.cache?.place;
  return w && Number.isFinite(w.lat) ? { name: w.town || w.name, lat: w.lat, lon: w.lon } : null;
}

async function loadWeather(p) {
  const key = `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`;
  if (wxCache && wxCache.key === key && Date.now() - wxCache.at < 30 * 60000) return wxCache.data;
  const url = 'https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({
    latitude: p.lat.toFixed(4), longitude: p.lon.toFixed(4), timezone: 'auto', forecast_days: '1', wind_speed_unit: 'mph',
    current: 'temperature_2m,apparent_temperature,weather_code,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_probability_max,uv_index_max,wind_gusts_10m_max',
  });
  const data = await fetchJSON(url, 10000);
  wxCache = { key, at: Date.now(), data };
  return data;
}

/** Clothing advice from the day's forecast. Returns [{ icon, text }]. */
export function whatToWear(dl) {
  const lo = dl.apparent_temperature_min?.[0] ?? dl.temperature_2m_min[0];
  const hi = dl.apparent_temperature_max?.[0] ?? dl.temperature_2m_max[0];
  const rain = dl.precipitation_probability_max?.[0] ?? 0;
  const uv = dl.uv_index_max?.[0] ?? 0;
  const gust = dl.wind_gusts_10m_max?.[0] ?? 0;            // mph
  const code = dl.weather_code?.[0] ?? 0;
  const snow = [71, 73, 75, 77, 85, 86].includes(code);
  const feel = (lo + hi) / 2;
  const out = [];
  if (feel < 0) out.push({ icon: '🧥', text: 'Heavy winter coat, hat, gloves and a scarf — it’s freezing' });
  else if (feel < 7) out.push({ icon: '🧥', text: 'A warm coat and a jumper; a hat and gloves for the coldest part of the day' });
  else if (feel < 13) out.push({ icon: '🧥', text: 'A jacket or light coat over long sleeves' });
  else if (feel < 18) out.push({ icon: '🧶', text: 'A light jacket or jumper you can take off later' });
  else if (feel < 24) out.push({ icon: '👕', text: 'T-shirt weather — light trousers, a skirt or shorts' });
  else out.push({ icon: '🩳', text: 'Light, loose, breathable clothes — and drink plenty of water' });
  if (hi - lo >= 8) out.push({ icon: '👚', text: `Wear layers: it goes from about ${Math.round(lo)}° to ${Math.round(hi)}° (feels like)` });
  if (snow) out.push({ icon: '🥾', text: 'Boots with good grip — snow is likely' });
  if (rain >= 60) out.push({ icon: '☔', text: `Waterproof jacket or umbrella — ${rain}% chance of rain` });
  else if (rain >= 30) out.push({ icon: '🌂', text: `Take an umbrella just in case (${rain}% chance of rain)` });
  if (gust >= 40) out.push({ icon: '🌬️', text: `Windproof layer — gusts up to ${Math.round(gust)} mph${rain >= 30 ? ' (an umbrella may struggle)' : ''}` });
  if (uv >= 6) out.push({ icon: '🧴', text: `Sun cream, sunglasses and a hat — UV is high (${Math.round(uv)})` });
  else if (uv >= 3) out.push({ icon: '🕶️', text: `Sunglasses, and sun cream if you’re out a while (UV ${Math.round(uv)})` });
  return out;
}

function weatherCard() {
  const box = el('div', { class: 'mo-card mo-wx' }, el('div', { class: 'mo-h' }, 'Today’s weather'), el('div', { class: 'muted small' }, 'Loading…'));
  const fill = async () => {
    const p = place();
    box.innerHTML = '';
    box.append(el('div', { class: 'mo-h' }, 'Today’s weather'));
    if (!p) {
      box.append(el('p', { class: 'small muted' }, 'Allow your location to see today’s weather and what to wear.'),
        el('button', { type: 'button', class: 'btn sm', onclick: async () => {
          try {
            const pos = await getPosition(); const town = await nearestTown(pos.lat, pos.lon);
            store.get().sunPlace = { name: town.town || 'Your location', region: town.region || '', lat: pos.lat, lon: pos.lon, gps: true, at: Date.now() };
            store.save(); fill();
          } catch (e) { box.append(el('p', { class: 'small muted' }, e.message || 'Could not find your location.')); }
        } }, '📍 Use my location'));
      return;
    }
    box.append(el('div', { class: 'muted small' }, 'Loading…'));
    try {
      const w = await loadWeather(p);
      const c = w.current, dl = w.daily;
      const now = wmo(c.weather_code, c.is_day), day = wmo(dl.weather_code[0], 1);
      box.innerHTML = '';
      box.append(
        el('div', { class: 'mo-h' }, `Today in ${p.name || 'your area'}`),
        el('div', { class: 'mo-wx-top' },
          el('div', { class: 'mo-wx-icon' }, day.icon),
          el('div', {},
            el('div', { class: 'mo-wx-temp' }, `${Math.round(c.temperature_2m)}°`, el('span', {}, ` feels ${Math.round(c.apparent_temperature)}°`)),
            el('div', { class: 'mo-wx-desc' }, `${now.label} now · ${day.label.toLowerCase()} later`),
            el('div', { class: 'mo-wx-row' },
              el('span', {}, `↑ ${Math.round(dl.temperature_2m_max[0])}°`), el('span', {}, `↓ ${Math.round(dl.temperature_2m_min[0])}°`),
              el('span', {}, `☔ ${dl.precipitation_probability_max[0] ?? 0}%`), el('span', {}, `🌬️ ${Math.round(dl.wind_gusts_10m_max[0] ?? 0)} mph`),
              el('span', {}, `☀️ UV ${Math.round(dl.uv_index_max[0] ?? 0)}`)))),
        el('div', { class: 'mo-h mo-wear-h' }, '👔 What to wear'),
        el('ul', { class: 'mo-wear' }, whatToWear(dl).map((x) => el('li', {}, el('span', { class: 'mo-wear-i' }, x.icon), el('span', {}, x.text)))),
        el('div', { class: 'mo-fine' }, 'Forecast: Open-Meteo.com'));
    } catch (e) {
      box.innerHTML = '';
      box.append(el('div', { class: 'mo-h' }, 'Today’s weather'), el('p', { class: 'small muted' }, 'Couldn’t load the weather — check your internet connection.'));
    }
  };
  setTimeout(fill, 50);
  return box;
}

/* ---------- The screen ---------- */
function greeting(t) {
  const h = new Date(t).getHours();
  return h < 5 ? 'Hello, night owl' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/**
 * night: a sleep summary from sleep.js (or null); tone: the alarm's tone (sets the affirmation);
 * today: show today's weather and clothing (false when looking back at an older night).
 */
export function showMorning({ night = null, tone = 'soft', today = true } = {}) {
  const when = night ? night.end : Date.now();
  const date = new Date(when).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  openModal({
    className: 'tall morning',
    content: [
      el('div', { class: 'mo-head' }, el('div', { class: 'mo-hello' }, today ? `${greeting(when)} ☀️` : 'Your night'), el('div', { class: 'mo-date' }, date)),
      today ? wordsCard(tone) : null,
      night ? sleepCard(night) : null,
      today ? weatherCard() : null,
    ],
    actions: [{ label: today ? 'Start my day' : 'Close', kind: 'primary' }],
  });
}
