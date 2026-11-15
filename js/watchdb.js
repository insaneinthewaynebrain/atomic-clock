// Watch knowledge for the add-a-watch dial scan: the brand list, words that point to a brand when read on a
// dial, and turning what the dial says into form values. (Everything else about a watch is entered by hand.)

export const BRANDS = [
  '88 Rue du Rhone', 'A. Lange & Söhne', 'Accurist', 'adidas', 'Allemano', 'Alpina', 'Alsta', 'Amazfit',
  'Anordain', 'Armani Exchange', 'Audemars Piguet', 'Avi-8', 'Ball', 'Baltic', 'Barbour', 'Bauhaus',
  'Baume & Mercier', 'Bell & Ross', 'Ben Sherman', 'Bering', 'Blancpain', 'Boccia Titanium', 'Boldr', 'BOSS',
  'Breguet', 'Breitling', 'Bremont', 'Bulgari', 'Bulova', 'Calypso', 'Candino', 'Carl F. Bucherer',
  'Cartier', 'Casio', 'Certina', 'Chopard', 'Christopher Ward', 'Citizen', 'Coach', 'Corum',
  'Damasko', 'Dan Henry', 'Daniel Wellington', 'Davosa', 'Diesel', 'Doxa', 'Duckworth Prestex', 'Dufa',
  'Edifice', 'Edox', 'Elliot Brown', 'Emporio Armani', 'Eterna', 'F.P. Journe', 'Farer', 'Favre Leuba',
  'Fears', 'Festina', 'Formex', 'Fortis', 'Fossil', 'Franck Muller', 'Frederique Constant', 'G-Shock',
  'Gant', 'Garmin', 'Gc', 'Girard-Perregaux', 'Glashütte Original', 'Glycine', 'Grand Seiko', 'Gruen',
  'Guess', 'H. Moser & Cie', 'Hamilton', 'Hanhart', 'Herbelin', 'Heuer', 'Hublot', 'HUGO',
  'Ice-Watch', 'Ikepod', 'Ingersoll', 'IWC', 'Jacques du Manoir', 'Jacques Lemans', 'Jaeger-LeCoultre', 'Junghans',
  'Kronaby', 'Kurono Tokyo', 'Laco', 'Lacoste', 'Lemania', 'Longines', 'Lorier', 'Lorus',
  'Lotus', 'Louis Erard', 'Luminox', 'Marathon', 'Maurice Lacroix', 'MB&F', 'MeisterSinger', 'Michael Kors',
  'Mido', 'Ming', 'Mondaine', 'Montblanc', 'Movado', 'Mühle-Glashütte', 'Nautica', 'Nivada Grenchen',
  'Nixon', 'Nodus', 'Nomos', 'Nordgreen', 'Norqain', 'Obaku', 'Olivia Burton', 'Omega',
  'Orient', 'Orient Star', 'Oris', 'Panerai', 'Parmigiani Fleurier', 'Patek Philippe', 'Paul Hewitt', 'Piaget',
  'Pierre Lannier', 'Polar', 'Rado', 'Raymond Weil', 'Richard Mille', 'Roamer', 'Roger Dubuis', 'Rolex',
  'Rotary', 'Seagull', 'Seiko', 'Sekonda', 'Sinn', 'Skagen', 'Smiths', 'Spinnaker',
  'Squale', 'Steinhart', 'Sternglas', 'Stowa', 'Suunto', 'Swatch', 'Swiss Military Hanowa', 'TAG Heuer',
  'Ted Baker', 'Timex', 'Tissot', 'Tommy Hilfiger', 'Tudor', 'Ulysse Nardin', 'Unimatic', 'Vacheron Constantin',
  'Vaer', 'Victorinox', 'Vostok', 'Vostok Europe', 'Withings', 'Yema', 'Zenith', 'Zeppelin',
  'Zodiac',
].sort((a, b) => a.localeCompare(b));

/** Words that point to a brand (and sometimes a model family) when read on a dial. */
const DIAL_HINTS = [
  ['GRAND SEIKO', 'Grand Seiko'], ['PROSPEX', 'Seiko', 'Prospex'], ['PRESAGE', 'Seiko', 'Presage'], ['SEIKO', 'Seiko'],
  ['OYSTER PERPETUAL', 'Rolex'], ['PERPETUAL DATE', 'Rolex'], ['SUPERLATIVE CHRONOMETER', 'Rolex'], ['SUPERLATIVE', 'Rolex'], ['SUBMARINER', 'Rolex', 'Submariner'], ['GMT-MASTER', 'Rolex', 'GMT-Master II'], ['DAYTONA', 'Rolex', 'Cosmograph Daytona'],
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
  ['MOONSWATCH', 'Swatch', 'MoonSwatch'], ['BIOCERAMIC', 'Swatch'], ['PROTECTION', 'G-Shock'], ['SHOCK RESIST', 'G-Shock'],
  ['CARTIER', 'Cartier'], ['BULOVA', 'Bulova'], ['TIMEX', 'Timex'], ['SWATCH', 'Swatch'], ['MIDO', 'Mido'], ['CERTINA', 'Certina'],
  ['RADO', 'Rado'], ['DOXA', 'Doxa'], ['SQUALE', 'Squale'], ['JUNGHANS', 'Junghans'], ['BREMONT', 'Bremont'], ['VOSTOK', 'Vostok'],
  ['CHRISTOPHER WARD', 'Christopher Ward'], ['C WARD', 'Christopher Ward'], ['BALTIC', 'Baltic'], ['LORIER', 'Lorier'], ['FARER', 'Farer'],
  ['MAURICE LACROIX', 'Maurice Lacroix'], ['FREDERIQUE CONSTANT', 'Frederique Constant'], ['RAYMOND WEIL', 'Raymond Weil'],
  ['IWC', 'IWC'], ['SCHAFFHAUSEN', 'IWC'], ['JAEGER', 'Jaeger-LeCoultre'], ['LECOULTRE', 'Jaeger-LeCoultre'], ['BLANCPAIN', 'Blancpain'],
  ['FIFTY FATHOMS', 'Blancpain', 'Fifty Fathoms'], ['VACHERON', 'Vacheron Constantin'], ['HUBLOT', 'Hublot'], ['BELL & ROSS', 'Bell & Ross'],
  ['STEINHART', 'Steinhart'], ['MARATHON', 'Marathon'], ['LUMINOX', 'Luminox'], ['BALL', 'Ball'], ['GLASHÜTTE', 'Glashütte Original'],
  ['STOWA', 'Stowa'], ['LACO', 'Laco'], ['FORTIS', 'Fortis'], ['EDOX', 'Edox'], ['ZODIAC', 'Zodiac'], ['YEMA', 'Yema'],
];

export const FEATURE_LABELS = { fDate: 'Date', fDay: 'Day', fGmt: 'GMT / second time zone', fChrono: 'Chronograph', fPowerInd: 'Power-reserve indicator' };

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

/* ---------- Guessing a brand from partial or misread words ---------- */
// Brands people are most likely to photograph get a small nudge when a fragment fits several.
const COMMON = new Set(['Seiko', 'Rolex', 'Omega', 'Casio', 'Citizen', 'Tudor', 'Tissot', 'Hamilton', 'Orient', 'Longines', 'TAG Heuer',
  'Breitling', 'G-Shock', 'Grand Seiko', 'Oris', 'Sekonda', 'Rotary', 'Timex', 'Bulova', 'Swatch', 'Accurist', 'Christopher Ward', 'Fossil']);
// Misread digits are only turned back into letters inside words that are mostly letters ("SEIK0" → SEIKO),
// never in numbers ("85" must not become "BS").
const clean = (w) => {
  const u = String(w || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();   // Söhne → SOHNE
  const letters = (u.match(/[A-Z]/g) || []).length, digits = (u.match(/[0-9]/g) || []).length;
  const v = letters >= 2 && letters > digits
    ? u.replace(/RN/g, 'M').replace(/VV/g, 'W').replace(/0/g, 'O').replace(/1/g, 'I').replace(/5/g, 'S').replace(/8/g, 'B').replace(/\$/g, 'S')
    : u;
  return v.replace(/[^A-Z]/g, '');
};

// Ordinary words printed on dials: never treated as a piece of a brand name.
const DIAL_WORDS = new Set(('THE AND FOR WITH MADE JAPAN SWISS SWITZERLAND GERMANY CHINA WATER RESIST RESISTANT AUTO AUTOMATIC QUARTZ '
  + 'DATE DAY GMT UTC JEWELS JEWEL DIVER DIVERS METERS METRES FEET BAR ATM SOLAR KINETIC CHRONOGRAPH CHRONOMETER OFFICIALLY CERTIFIED '
  + 'SUPERLATIVE PERPETUAL PROFESSIONAL LIMITED EDITION SPORT SPORTS STEEL STAINLESS TITANIUM GOLD SAPPHIRE TACHYMETER TACHYMETRE '
  + 'HAND WOUND MANUAL POWER RESERVE MOVT MOVEMENT SECONDS MINUTES HOURS TWO THREE FOUR FIVE SIX TEN TWELVE').split(' '));

// …including clipped ones ("SWIS" from SWISS MADE, "CHRONOM").
const isDialWord = (w) => DIAL_WORDS.has(w) || (w.length >= 4 && [...DIAL_WORDS].some((d) => d.length > w.length && (d.startsWith(w) || d.endsWith(w))));

/**
 * Best guesses for the brand from words read off a dial, even partial ones ("IKO" → Seiko, "ROLE" → Rolex).
 * @param {string[]} words  everything the reader saw, low-confidence words included
 * @returns {{brand:string, score:number, from:string}[]}  best first (score 0–1)
 */
export function guessBrands(words) {
  const targets = [];
  for (const b of BRANDS) {
    const full = clean(b);
    if (full.length >= 3) targets.push([full, b]);
    for (const part of b.split(/[\s&.-]+/)) { const c = clean(part); if (c.length >= 4 && c !== full) targets.push([c, b, true]); }
  }
  for (const [w, b] of DIAL_HINTS) { const c = clean(w); if (c.length >= 4) targets.push([c, b, true]); }
  const best = new Map();
  const list = [...words];
  const wordy = (w) => (String(w).match(/[A-Za-z]/g) || []).length >= 3;
  for (let i = 0; i + 1 < words.length; i++) {       // two-word names read as two words (both must be real words)
    if (wordy(words[i]) && wordy(words[i + 1])) list.push(`${words[i]} ${words[i + 1]}`);
  }
  for (const raw of list) {
    const w = clean(raw);
    if (w.length < 3 || isDialWord(w) || (String(raw).match(/[A-Za-z]/g) || []).length < 3) continue;
    for (const [t, brand, partial] of targets) {
      let sc = 0;
      const ratio = Math.min(w.length, t.length) / Math.max(w.length, t.length);
      if (w === t) sc = 1 + t.length / 100;     // a longer exact match (GRAND SEIKO) beats a shorter one (SEIKO)
      else if (w.length >= 4 && lev(w, t) <= Math.max(1, Math.floor(t.length / 4))) sc = 0.9 - 0.12 * lev(w, t);
      else if (w.includes(t) && t.length >= 4) sc = 0.85;
      else if (t.startsWith(w)) sc = 0.5 + 0.4 * ratio;
      else if (t.endsWith(w)) sc = 0.48 + 0.4 * ratio;
      else if (w.length >= 4 && t.includes(w)) sc = 0.42 + 0.35 * ratio;
      if (!sc) continue;
      if (w !== t) {
        // Dial lettering is capitals: a mostly-lowercase fragment ("Just," from some printed text) is noise, not part
        // of a brand name. Only whole-name matches count for lowercase words.
        const letters = String(raw).replace(/[^A-Za-z]/g, '');
        if ((letters.match(/[a-z]/g) || []).length > letters.length / 2) continue;
        // A 3-letter scrap is weak evidence: it may only point to a well-known brand ("IKO" → Seiko), never to a
        // rarer one it happens to end (e.g. "ITT" → Paul Hewitt).
        if (w.length === 3 && !COMMON.has(brand)) continue;
        if (w.length === 3) sc -= 0.08;
        if (!/[A-Z]/.test(String(raw).replace(/[^A-Za-z]/g, '').slice(0, 3))) sc -= 0.1;   // dial logos are capitals; "ome" is likely junk
      }
      if (partial) sc -= 0.1;                  // a sub-name (e.g. PROSPEX, or SEIKO inside Grand Seiko) is a weaker sign
      if (COMMON.has(brand)) sc += 0.04;
      const prev = best.get(brand);
      if (!prev) best.set(brand, { brand, score: sc, from: String(raw), seen: new Set([w]), hits: 1 });
      else {
        prev.hits++;                                                    // the same evidence read again in another pass
        if (sc > prev.score) { prev.score = sc; prev.from = String(raw); }
      }
    }
  }
  // Read again and again (several passes, or several fragments) → more believable.
  for (const g of best.values()) g.score += Math.min(0.12, 0.04 * (g.hits - 1));
  const out = [...best.values()].sort((a, b) => b.score - a.score).map(({ brand, score, from }) => ({ brand, score, from }));
  // A short fragment that fits many brands equally ("RO") is weak: knock the top score down by how crowded it is.
  if (out.length > 1 && out[0].score < 0.9) {
    const close = out.filter((g) => out[0].score - g.score < 0.06).length;
    if (close > 1) out[0] = { ...out[0], score: out[0].score - 0.05 * (close - 1) };
  }
  return out.filter((g) => g.score >= 0.55).slice(0, 4).map((g) => ({ ...g, score: Math.min(1, g.score) }));
}

/**
 * Turns text read from a dial into form values.
 * Returns { fields: {k: v}, found: [[label, value], ...] } — `found` is what to show the person.
 */
export function parseDial(raw, extraWords = []) {
  const text = ' ' + String(raw || '').toUpperCase()
    .replace(/[‘’`]/g, "'").replace(/[|]/g, 'I')
    .replace(/(\d)[OQ]/g, '$10').replace(/[OQ](\d)/g, '0$1')
    .replace(/[^A-Z0-9&'.\-/\s]/g, ' ').replace(/\s+/g, ' ') + ' ';
  const words = text.trim().split(' ');
  const fields = {};
  const found = [];

  // Brand: exact phrase first (longest first), then a one-letter-off match for single longer words (e.g. SEIK0).
  // Every brand in the list can be read off a dial too (names of 4+ letters, so short ones like Gc don't misfire).
  const fromList = BRANDS.filter((b) => b.replace(/[^A-Za-z]/g, '').length >= 4 && !DIAL_HINTS.some((h) => h[1] === b))
    .map((b) => [b.toUpperCase().replace(/Ü/g, 'U').replace(/Ö/g, 'O').replace(/É/g, 'E'), b]);
  const hints = [...DIAL_HINTS, ...fromList].sort((a, b) => b[0].length - a[0].length);
  let hit = hints.find(([w]) => new RegExp(`(^|[^A-Z])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Z]|$)`).test(text));
  if (!hit) {
    for (const h of hints) {
      if (h[0].includes(' ') || h[0].length < 5) continue;
      if (words.some((w) => w.length >= 4 && lev(w, h[0]) <= 1)) { hit = h; break; }
    }
  }
  let guesses = [];
  if (!hit) {
    guesses = guessBrands([...words, ...extraWords]);
    if (guesses.length) {
      fields.brand = guesses[0].brand;
      found.push(['Brand (best guess)', `${guesses[0].brand} — from “${guesses[0].from}”`]);
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

  return { fields, found, guesses };
}

/** Chrono24 search for this watch on the site for the person's currency. */
export function chrono24Url(query, currency) {
  const host = { GBP: 'www.chrono24.co.uk', USD: 'www.chrono24.com', EUR: 'www.chrono24.de', CHF: 'www.chrono24.ch', AUD: 'www.chrono24.com.au',
    CAD: 'www.chrono24.ca', JPY: 'www.chrono24.jp', SGD: 'www.chrono24.sg', HKD: 'www.chrono24.hk', SEK: 'www.chrono24.se', DKK: 'www.chrono24.dk',
    NOK: 'www.chrono24.no', PLN: 'www.chrono24.pl', CZK: 'www.chrono24.cz', INR: 'www.chrono24.in', AED: 'www.chrono24.ae', MXN: 'www.chrono24.com.mx',
    NZD: 'www.chrono24.co.nz', ZAR: 'www.chrono24.co.za' }[currency] || 'www.chrono24.com';
  return `https://${host}/search/index.htm?dosearch=true&query=${encodeURIComponent(query)}`;
}
