// Watch knowledge: brand list, words read from dials, and a built-in reference list of popular models and
// movements (used to fill in and cross-check the add-a-watch form). Data is a starting point, not gospel:
// the app always asks the person to check it.

export const BRANDS = ['A. Lange & Söhne', 'Alpina', 'Anordain', 'Audemars Piguet', 'Ball', 'Baltic', 'Baume & Mercier',
  'Bell & Ross', 'Blancpain', 'Boldr', 'Breguet', 'Breitling', 'Bremont', 'Bulgari', 'Bulova', 'Carl F. Bucherer', 'Cartier',
  'Casio', 'Certina', 'Chopard', 'Christopher Ward', 'Citizen', 'Corum', 'Damasko', 'Dan Henry', 'Davosa', 'Doxa', 'Edox',
  'Elliot Brown', 'Eterna', 'F.P. Journe', 'Farer', 'Fears', 'Formex', 'Fortis', 'Fossil', 'Franck Muller', 'Frederique Constant',
  'G-Shock', 'Garmin', 'Girard-Perregaux', 'Glashütte Original', 'Glycine', 'Grand Seiko', 'Gruen', 'H. Moser & Cie', 'Hamilton',
  'Hanhart', 'Heuer', 'Hublot', 'IWC', 'Jaeger-LeCoultre', 'Junghans', 'Kurono Tokyo', 'Laco', 'Lemania', 'Longines', 'Lorier',
  'Louis Erard', 'Luminox', 'Marathon', 'Maurice Lacroix', 'MB&F', 'Mido', 'Ming', 'Montblanc', 'Movado', 'Mühle-Glashütte',
  'Nivada Grenchen', 'Nodus', 'Nomos', 'Norqain', 'Omega', 'Orient', 'Orient Star', 'Oris', 'Panerai', 'Parmigiani Fleurier',
  'Patek Philippe', 'Piaget', 'Rado', 'Raymond Weil', 'Richard Mille', 'Rolex', 'Roger Dubuis', 'Seagull', 'Seiko', 'Sinn',
  'Smiths', 'Squale', 'Steinhart', 'Swatch', 'TAG Heuer', 'Timex', 'Tissot', 'Tudor', 'Ulysse Nardin', 'Unimatic', 'Vacheron Constantin',
  'Stowa', 'Vaer', 'Vostok', 'Yema', 'Zenith', 'Zodiac'].sort((a, b) => a.localeCompare(b));

/** Words that point to a brand (and sometimes a model family) when read on a dial. */
const DIAL_HINTS = [
  ['GRAND SEIKO', 'Grand Seiko'], ['PROSPEX', 'Seiko', 'Prospex'], ['PRESAGE', 'Seiko', 'Presage'], ['SEIKO', 'Seiko'],
  ['OYSTER PERPETUAL', 'Rolex'], ['SUBMARINER', 'Rolex', 'Submariner'], ['GMT-MASTER', 'Rolex', 'GMT-Master II'], ['DAYTONA', 'Rolex', 'Cosmograph Daytona'],
  ['SEA-DWELLER', 'Rolex', 'Sea-Dweller'], ['DATEJUST', 'Rolex', 'Datejust'], ['EXPLORER', 'Rolex', 'Explorer'], ['ROLEX', 'Rolex'],
  ['SPEEDMASTER', 'Omega', 'Speedmaster'], ['SEAMASTER', 'Omega', 'Seamaster'], ['AQUA TERRA', 'Omega', 'Seamaster Aqua Terra'],
  ['PLANET OCEAN', 'Omega', 'Seamaster Planet Ocean'], ['CONSTELLATION', 'Omega', 'Constellation'], ['OMEGA', 'Omega'],
  ['BLACK BAY', 'Tudor', 'Black Bay'], ['PELAGOS', 'Tudor', 'Pelagos'], ['TUDOR', 'Tudor'],
  ['ECO-DRIVE', 'Citizen'], ['PROMASTER', 'Citizen', 'Promaster'], ['CITIZEN', 'Citizen'],
  ['KHAKI', 'Hamilton', 'Khaki'], ['JAZZMASTER', 'Hamilton', 'Jazzmaster'], ['HAMILTON', 'Hamilton'],
  ['NAVITIMER', 'Breitling', 'Navitimer'], ['SUPEROCEAN', 'Breitling', 'Superocean'], ['BREITLING', 'Breitling'],
  ['CARRERA', 'TAG Heuer', 'Carrera'], ['AQUARACER', 'TAG Heuer', 'Aquaracer'], ['MONACO', 'TAG Heuer', 'Monaco'], ['TAG HEUER', 'TAG Heuer'],
  ['ROYAL OAK', 'Audemars Piguet', 'Royal Oak'], ['NAUTILUS', 'Patek Philippe', 'Nautilus'], ['AQUANAUT', 'Patek Philippe', 'Aquanaut'],
  ['PATEK PHILIPPE', 'Patek Philippe'], ['G-SHOCK', 'G-Shock'], ['CASIO', 'Casio'], ['TISSOT', 'Tissot'], ['LONGINES', 'Longines'],
  ['ORIENT STAR', 'Orient Star'], ['ORIENT', 'Orient'], ['BAMBINO', 'Orient', 'Bambino'], ['ORIS', 'Oris'], ['SINN', 'Sinn'],
  ['NOMOS', 'Nomos'], ['ZENITH', 'Zenith'], ['EL PRIMERO', 'Zenith', 'El Primero'], ['PANERAI', 'Panerai'], ['LUMINOR', 'Panerai', 'Luminor'],
  ['CARTIER', 'Cartier'], ['BULOVA', 'Bulova'], ['TIMEX', 'Timex'], ['SWATCH', 'Swatch'], ['MIDO', 'Mido'], ['CERTINA', 'Certina'],
  ['RADO', 'Rado'], ['DOXA', 'Doxa'], ['SQUALE', 'Squale'], ['JUNGHANS', 'Junghans'], ['BREMONT', 'Bremont'], ['VOSTOK', 'Vostok'],
  ['CHRISTOPHER WARD', 'Christopher Ward'], ['C WARD', 'Christopher Ward'], ['BALTIC', 'Baltic'], ['LORIER', 'Lorier'], ['FARER', 'Farer'],
  ['MAURICE LACROIX', 'Maurice Lacroix'], ['FREDERIQUE CONSTANT', 'Frederique Constant'], ['RAYMOND WEIL', 'Raymond Weil'],
  ['IWC', 'IWC'], ['SCHAFFHAUSEN', 'IWC'], ['JAEGER', 'Jaeger-LeCoultre'], ['LECOULTRE', 'Jaeger-LeCoultre'], ['BLANCPAIN', 'Blancpain'],
  ['FIFTY FATHOMS', 'Blancpain', 'Fifty Fathoms'], ['VACHERON', 'Vacheron Constantin'], ['HUBLOT', 'Hublot'], ['BELL & ROSS', 'Bell & Ross'],
  ['STEINHART', 'Steinhart'], ['MARATHON', 'Marathon'], ['LUMINOX', 'Luminox'], ['BALL', 'Ball'], ['GLASHÜTTE', 'Glashütte Original'],
  ['STOWA', 'Stowa'], ['LACO', 'Laco'], ['FORTIS', 'Fortis'], ['EDOX', 'Edox'], ['ZODIAC', 'Zodiac'], ['YEMA', 'Yema'],
];

/* ---------- Movements ---------- */
// name: [type, jewels, beats per hour, power reserve hours, note]
const CAL = {
  'NH35': ['automatic', 24, 21600, 41], 'NH36': ['automatic', 24, 21600, 41], 'NH34': ['automatic', 24, 21600, 41],
  '4R35': ['automatic', 23, 21600, 41], '4R36': ['automatic', 24, 21600, 41], '6R35': ['automatic', 24, 21600, 70],
  '6R15': ['automatic', 23, 21600, 50], '6R54': ['automatic', 24, 21600, 72], '7S26': ['automatic', 21, 21600, 41],
  '7S36': ['automatic', 23, 21600, 41], '8L35': ['automatic', 26, 28800, 50], '9S65': ['automatic', 35, 28800, 72],
  '9S85': ['automatic', 37, 36000, 55], '9S86': ['automatic', 37, 36000, 55], '9SA5': ['automatic', 47, 36000, 80],
  '9R65': ['springdrive', 30, null, 72], '9R15': ['springdrive', 30, null, 72], '9R66': ['springdrive', 30, null, 72],
  '8R48': ['automatic', 34, 28800, 45], '9F62': ['quartz', 9, null, null],
  '3130': ['automatic', 31, 28800, 48], '3132': ['automatic', 31, 28800, 48], '3135': ['automatic', 31, 28800, 48],
  '3186': ['automatic', 31, 28800, 48], '3187': ['automatic', 31, 28800, 48], '3230': ['automatic', 31, 28800, 70],
  '3235': ['automatic', 31, 28800, 70], '3255': ['automatic', 31, 28800, 70], '3285': ['automatic', 31, 28800, 70],
  '4130': ['automatic', 44, 28800, 72], '4131': ['automatic', 44, 28800, 72], '2236': ['automatic', 31, 28800, 55],
  '8800': ['automatic', 35, 25200, 55], '8806': ['automatic', 35, 25200, 55], '8900': ['automatic', 39, 25200, 60],
  '8500': ['automatic', 39, 25200, 60], '1861': ['manual', 18, 21600, 48], '3861': ['manual', 26, 21600, 50],
  '9900': ['automatic', 54, 28800, 60], '1120': ['automatic', 23, 28800, 44], '2500': ['automatic', 27, 25200, 48],
  'MT5602': ['automatic', 25, 28800, 70], 'MT5612': ['automatic', 26, 28800, 70], 'MT5652': ['automatic', 28, 28800, 70],
  'MT5402': ['automatic', 27, 28800, 70], 'MT5400': ['automatic', 27, 28800, 70], 'MT5813': ['automatic', 41, 28800, 70],
  '2824-2': ['automatic', 25, 28800, 38], '2836-2': ['automatic', 25, 28800, 38], '2892-A2': ['automatic', 21, 28800, 42],
  '7750': ['automatic', 25, 28800, 42], '2671': ['automatic', 25, 28800, 38], '2804-2': ['manual', 17, 28800, 42],
  '6497': ['manual', 17, 18000, 46], '6498': ['manual', 17, 18000, 46],
  'POWERMATIC 80': ['automatic', 23, 21600, 80], 'C07.111': ['automatic', 23, 21600, 80],
  'H-10': ['automatic', 25, 21600, 80], 'H-50': ['manual', 17, 21600, 80],
  'SW200-1': ['automatic', 26, 28800, 38, 'Newer SW200-1 b versions run about 41 h.'], 'SW300-1': ['automatic', 25, 28800, 42],
  '8215': ['automatic', 21, 21600, 42], '9015': ['automatic', 24, 28800, 42], '9039': ['automatic', 24, 28800, 42],
  'L888': ['automatic', 21, 25200, 72], 'B01': ['automatic', 47, 28800, 70], 'HEUER 02': ['automatic', 33, 28800, 80],
  '400': ['automatic', 21, 28800, 120], 'F6922': ['automatic', 22, 21600, 40], 'F6724': ['automatic', 22, 21600, 40],
  'SISTEM51': ['automatic', 19, 21600, 90], 'DUW 3001': ['automatic', 27, 21600, 42], 'ALPHA': ['manual', 17, 21600, 43],
  '2416B': ['automatic', 31, 19800, 31],
};
const calKey = (s) => String(s || '').toUpperCase().replace(/^(CAL\.?|CALIBRE|CALIBER|ETA|ROLEX|OMEGA|SEIKO|TUDOR|MIYOTA|SELLITA)\s*/, '').replace(/\s+/g, ' ').trim();

export function calibreInfo(name) {
  let k = calKey(name);
  if (!k) return null;
  if (!CAL[k]) k = Object.keys(CAL).find((x) => x.replace(/[-.\s]/g, '') === k.replace(/[-.\s]/g, '')) || k;
  if (!CAL[k] && /^\d{4}$/.test(k.slice(0, 4)) && CAL[k.slice(0, 4)]) k = k.slice(0, 4);
  const c = CAL[k];
  if (!c) return null;
  return { calibre: k, movement: c[0], jewels: c[1], bph: c[2], powerReserve: c[3], note: c[4] || null };
}

/* ---------- Popular references ---------- */
// key: [brand, model, calibre, case mm, water resistance m, features, made from, made to, lug mm, variants]
// features: d = date, D = day, g = GMT, c = chronograph, p = power-reserve indicator
const REF = {
  'SKX007': ['Seiko', 'Diver’s 200m (SKX007)', '7S26', 42, 200, 'dD', 1996, 2019, 22],
  'SKX009': ['Seiko', 'Diver’s 200m “Pepsi” (SKX009)', '7S26', 42, 200, 'dD', 1996, 2019, 22],
  'SKX013': ['Seiko', 'Diver’s 200m mid-size (SKX013)', '7S26', 38, 200, 'dD', 1996, 2019, 20],
  'SRPD': ['Seiko', 'Seiko 5 Sports', '4R36', 42.5, 100, 'dD', 2019, null, 22],
  'SRP777': ['Seiko', 'Prospex “Turtle” (SRP777)', '4R36', 45, 200, 'dD', 2016, null, 22],
  'SPB143': ['Seiko', 'Prospex 1965 Diver’s Re-interpretation (SPB143)', '6R35', 40.5, 200, 'd', 2020, null, 20],
  'SARB033': ['Seiko', 'Spirit (SARB033)', '6R15', 38, 100, 'd', 2006, 2019, 20],
  'SNK809': ['Seiko', 'Seiko 5 (SNK809)', '7S26', 37, 30, 'dD', null, null, 18],
  'SBGA211': ['Grand Seiko', 'Snowflake (SBGA211)', '9R65', 41, 100, 'dp', 2017, null, null],
  '126610LN': ['Rolex', 'Submariner Date', '3235', 41, 300, 'd', 2020, null, 21],
  '126610LV': ['Rolex', 'Submariner Date “Starbucks”', '3235', 41, 300, 'd', 2020, null, 21],
  '124060': ['Rolex', 'Submariner', '3230', 41, 300, '', 2020, null, 21],
  '116610LN': ['Rolex', 'Submariner Date', '3135', 40, 300, 'd', 2010, 2020, 20],
  '114060': ['Rolex', 'Submariner', '3130', 40, 300, '', 2012, 2020, 20],
  '126710BLRO': ['Rolex', 'GMT-Master II “Pepsi”', '3285', 40, 100, 'dg', 2018, null, 20],
  '126710BLNR': ['Rolex', 'GMT-Master II “Batman”', '3285', 40, 100, 'dg', 2019, null, 20],
  '126720VTNR': ['Rolex', 'GMT-Master II “Sprite”', '3285', 40, 100, 'dg', 2022, null, 20],
  '116710LN': ['Rolex', 'GMT-Master II', '3186', 40, 100, 'dg', 2007, 2019, 20],
  '116500LN': ['Rolex', 'Cosmograph Daytona', '4130', 40, 100, 'c', 2016, 2023, 20],
  '126500LN': ['Rolex', 'Cosmograph Daytona', '4131', 40, 100, 'c', 2023, null, 20],
  '124270': ['Rolex', 'Explorer', '3230', 36, 100, '', 2021, null, null],
  '214270': ['Rolex', 'Explorer', '3132', 39, 100, '', 2010, 2021, 20],
  '226570': ['Rolex', 'Explorer II', '3285', 42, 100, 'dg', 2021, null, null],
  '126600': ['Rolex', 'Sea-Dweller', '3235', 43, 1220, 'd', 2017, null, null],
  '126660': ['Rolex', 'Deepsea', '3235', 44, 3900, 'd', 2018, null, null],
  '124300': ['Rolex', 'Oyster Perpetual 41', '3230', 41, 100, '', 2020, null, null],
  '126334': ['Rolex', 'Datejust 41', '3235', 41, 100, 'd', 2017, null, null],
  '126300': ['Rolex', 'Datejust 41', '3235', 41, 100, 'd', 2017, null, null],
  '310.30.42.50.01.001': ['Omega', 'Speedmaster Moonwatch Professional', '3861', 42, 50, 'c', 2021, null, 20],
  '311.30.42.30.01.005': ['Omega', 'Speedmaster Professional Moonwatch', '1861', 42, 50, 'c', null, 2021, 20],
  '210.30.42.20.01.001': ['Omega', 'Seamaster Diver 300M', '8800', 42, 300, 'd', 2018, null, 20],
  '210.30.42.20.03.001': ['Omega', 'Seamaster Diver 300M (blue)', '8800', 42, 300, 'd', 2018, null, 20],
  '220.10.41.21.01.001': ['Omega', 'Seamaster Aqua Terra 150M', '8900', 41, 150, 'd', null, null, null],
  '79230N': ['Tudor', 'Black Bay', 'MT5602', 41, 200, '', 2016, 2023, 22],
  '79230B': ['Tudor', 'Black Bay (blue)', 'MT5602', 41, 200, '', 2016, 2023, 22],
  '79230R': ['Tudor', 'Black Bay (burgundy)', 'MT5602', 41, 200, '', 2016, 2023, 22],
  '79030N': ['Tudor', 'Black Bay Fifty-Eight', 'MT5402', 39, 200, '', 2018, null, 20],
  '79030B': ['Tudor', 'Black Bay Fifty-Eight (blue)', 'MT5402', 39, 200, '', 2020, null, 20],
  '79360N': ['Tudor', 'Black Bay Chrono', 'MT5813', 41, 200, 'dc', 2017, null, 22],
  '79830RB': ['Tudor', 'Black Bay GMT', 'MT5652', 41, 200, 'dg', 2018, null, 22],
  'H69439931': ['Hamilton', 'Khaki Field Mechanical', 'H-50', 38, 50, '', null, null, 20,
    [{ to: 2017, calibre: '2804-2', note: 'Before about 2018 this watch used the ETA 2804-2 (about 42 h); later ones use the H-50 (80 h).' }]],
  'H70455133': ['Hamilton', 'Khaki Field Auto 38', 'H-10', 38, 100, 'd', null, null, 20],
  'T137.407.11.041.00': ['Tissot', 'PRX Powermatic 80', 'POWERMATIC 80', 40, 100, 'd', 2021, null, null],
};
const refKey = (s) => String(s || '').toUpperCase().replace(/^M(?=\d{5,})/, '').replace(/[\s]/g, '');
const loose = (s) => refKey(s).replace(/[.\-/]/g, '');

/** Finds a reference in the built-in list (exact, without punctuation, or by its leading part, e.g. SKX007K2). */
export function findReference(ref) {
  const q = loose(ref);
  if (q.length < 3) return null;
  let best = null;
  for (const k of Object.keys(REF)) {
    const lk = loose(k);
    if (q === lk || (q.startsWith(lk) && (!best || lk.length > loose(best).length))) best = k;
    if (q === lk) break;
  }
  return best;
}

const FEAT = { d: 'fDate', D: 'fDay', g: 'fGmt', c: 'fChrono', p: 'fPowerInd' };
export const FEATURE_LABELS = { fDate: 'Date', fDay: 'Day', fGmt: 'GMT / second time zone', fChrono: 'Chronograph', fPowerInd: 'Power-reserve indicator' };

/**
 * Everything the built-in list knows about a watch.
 * Returns { found, fields: {k: v}, notes: [...], model }.
 */
export function lookupReference({ reference, year, calibre }) {
  const out = { found: false, fields: {}, notes: [], key: null };
  const key = reference ? findReference(reference) : null;
  let cal = calibre || null;
  if (key) {
    const r = REF[key];
    out.found = true; out.key = key;
    const [brand, model, c, mm, wr, feat, from, to, lug, variants] = r;
    Object.assign(out.fields, { brand, model, caseSize: mm, waterResistance: wr ? `${wr} m` : null, lugWidth: lug || null });
    for (const ch of Object.keys(FEAT)) out.fields[FEAT[ch]] = feat.includes(ch);
    cal = c;
    const y = Number(year);
    if (y && variants) for (const v of variants) {
      if ((v.from == null || y >= v.from) && (v.to == null || y <= v.to)) { if (v.calibre) cal = v.calibre; if (v.note) out.notes.push(v.note); }
    } else if (!y && variants) out.notes.push(...variants.map((v) => v.note).filter(Boolean));
    if (y && ((from && y < from) || (to && y > to))) {
      out.notes.push(`This reference was made ${from || '?'}–${to || 'now'}, so ${y} looks unusual — please check the year or reference.`);
    }
    if (from || to) out.fields.madeYears = `${from || '?'}–${to || 'now'}`;
  }
  const ci = calibreInfo(cal);
  if (ci) {
    Object.assign(out.fields, { calibre: ci.calibre, movement: ci.movement, jewels: ci.jewels, bph: ci.bph, powerReserve: ci.powerReserve });
    if (ci.note) out.notes.push(ci.note);
    out.found = true;
  }
  for (const k of Object.keys(out.fields)) if (out.fields[k] == null) delete out.fields[k];
  return out;
}

/* ---------- Reading a dial ---------- */
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 9;
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return m[a.length][b.length];
}

/**
 * Turns text read from a dial into form values.
 * Returns { fields: {k: v}, found: [[label, value], ...] } — `found` is what to show the person.
 */
export function parseDial(raw) {
  const text = ' ' + String(raw || '').toUpperCase()
    .replace(/[‘’`]/g, "'").replace(/[|]/g, 'I')
    .replace(/(\d)[OQ]/g, '$10').replace(/[OQ](\d)/g, '0$1')
    .replace(/[^A-Z0-9&'.\-/\s]/g, ' ').replace(/\s+/g, ' ') + ' ';
  const words = text.trim().split(' ');
  const fields = {};
  const found = [];

  // Brand: exact phrase first (longest first), then a one-letter-off match for single longer words (e.g. SEIK0).
  const hints = [...DIAL_HINTS].sort((a, b) => b[0].length - a[0].length);
  let hit = hints.find(([w]) => new RegExp(`(^|[^A-Z])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Z]|$)`).test(text));
  if (!hit) {
    for (const h of hints) {
      if (h[0].includes(' ') || h[0].length < 5) continue;
      if (words.some((w) => w.length >= 4 && lev(w, h[0]) <= 1)) { hit = h; break; }
    }
  }
  if (hit) {
    fields.brand = hit[1];
    found.push(['Brand', hit[1]]);
    // A model family on the dial (e.g. SUBMARINER) even if the brand word itself was found first.
    const fam = hit[2] ? hit : hints.find(([w, b, m]) => m && b === hit[1] && text.includes(w));
    if (fam) { fields.model = fam[2]; found.push(['Model family', fam[2]]); }
  }

  // Movement type
  const mv = [[/SPRING ?DRIVE/, 'springdrive', 'Spring Drive'], [/KINETIC/, 'kinetic', 'Kinetic'], [/ECO-?DRIVE|SOLAR/, 'solar', 'Solar'],
    [/QUARTZ/, 'quartz', 'Quartz'], [/AUTOMATIC|AUTOMATIQUE|SELF-?WINDING|PERPETUAL|AUTO\b/, 'automatic', 'Automatic'],
    [/HAND-?WOUND|HAND WINDING|MANUAL/, 'manual', 'Manual wind']].find(([re]) => re.test(text));
  if (mv) { fields.movement = mv[1]; found.push(['Movement', mv[2]]); }

  // Jewels
  const jw = text.match(/\b(\d{1,2}) ?(JEWELS?|JEWEL|RUBIS|RUBIES|J)\b/);
  if (jw && Number(jw[1]) >= 1 && Number(jw[1]) <= 80) { fields.jewels = Number(jw[1]); found.push(['Jewels', jw[1]]); }

  // Water resistance (metres preferred, then feet or bar)
  let wr = null;
  const m = text.match(/\b(\d{2,4}) ?(M|METERS?|METRES?|MT)\b/);
  const ft = text.match(/\b(\d{3,5}) ?(FT|FEET)\b/);
  const bar = text.match(/\b(\d{1,3}) ?(BAR|ATM)\b/);
  if (m && Number(m[1]) >= 10 && Number(m[1]) <= 4000) wr = Number(m[1]);
  else if (ft) wr = Math.round(Number(ft[1]) / 3.281 / 10) * 10;
  else if (bar) wr = Number(bar[1]) * 10;
  if (wr) { fields.waterResistance = `${wr} m`; found.push(['Water resistance', `${wr} m`]); }
  else if (/WATER ?RESIST/.test(text)) found.push(['Water resistance', 'Water resistant (no depth shown)']);

  // Beat rate (e.g. HI-BEAT 36000)
  const hb = text.match(/\b(18000|19800|21600|25200|28800|36000)\b/);
  if (hb) { fields.bph = Number(hb[1]); found.push(['Beat rate', `${hb[1]} bph`]); }
  else if (/HI-?BEAT/.test(text)) { fields.bph = 36000; found.push(['Beat rate', '36,000 bph (Hi-Beat)']); }

  // Complications written on the dial
  if (/\bGMT\b|\bUTC\b|WORLD ?TIME|DUAL ?TIME/.test(text)) { fields.fGmt = true; found.push(['Function', 'GMT']); }
  if (/CHRONOGRAPH|TACHYM|TELEMET|PULSOM|COSMOGRAPH/.test(text)) { fields.fChrono = true; found.push(['Function', 'Chronograph']); }
  if (/DAY-?DATE/.test(text)) { fields.fDate = true; fields.fDay = true; found.push(['Function', 'Day and date']); }
  else if (/DATE\b|DATEJUST/.test(text)) { fields.fDate = true; found.push(['Function', 'Date']); }
  if (/POWER ?RESERVE|RESERVE DE MARCHE/.test(text)) { fields.fPowerInd = true; found.push(['Function', 'Power-reserve indicator']); }
  if (/CHRONOMETER|CHRONOMETRE|COSC/.test(text)) { fields.chronometer = true; found.push(['Certified', 'Chronometer']); }

  return { fields, found };
}

/** Chrono24 search for this watch on the site for the person's currency. */
export function chrono24Url(query, currency) {
  const host = { GBP: 'www.chrono24.co.uk', USD: 'www.chrono24.com', EUR: 'www.chrono24.de', CHF: 'www.chrono24.ch', AUD: 'www.chrono24.com.au',
    CAD: 'www.chrono24.ca', JPY: 'www.chrono24.jp', SGD: 'www.chrono24.sg', HKD: 'www.chrono24.hk', SEK: 'www.chrono24.se', DKK: 'www.chrono24.dk',
    NOK: 'www.chrono24.no', PLN: 'www.chrono24.pl', CZK: 'www.chrono24.cz', INR: 'www.chrono24.in', AED: 'www.chrono24.ae', MXN: 'www.chrono24.com.mx',
    NZD: 'www.chrono24.co.nz', ZAR: 'www.chrono24.co.za' }[currency] || 'www.chrono24.com';
  return `https://${host}/search/index.htm?dosearch=true&query=${encodeURIComponent(query)}`;
}

/** Short Wikipedia summary for a model (keyless, CORS-enabled). Resolves null if nothing useful. */
export async function wikiSummary(query) {
  try {
    const s = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srlimit=3&format=json&origin=*&srsearch=${encodeURIComponent(query + ' watch')}`).then((r) => r.json());
    const hit = (s.query?.search || []).find((h) => !/disambiguation/i.test(h.title));
    if (!hit) return null;
    const p = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit.title.replace(/ /g, '_'))}`).then((r) => r.json());
    if (!p.extract) return null;
    return { title: p.title, text: p.extract, url: p.content_urls?.mobile?.page || p.content_urls?.desktop?.page };
  } catch (e) { return null; }
}
