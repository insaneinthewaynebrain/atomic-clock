# Atomic Clock

A free app for watch collectors, made for viewers of the **Watch Hobbyist** YouTube channel
(https://www.youtube.com/watchhobbyist). It installs on an iPhone home screen like an app (PWA).

- **Clock**: network-synced time to the millisecond for setting watches, plus an accuracy tracker
  (+/− seconds and Mark), grades against COSC / METAS / Rolex / Grand Seiko and movement specs,
  position testing, and shareable result cards.
- **Watch Box**: the main home for the collection, drawn as a virtual watch box with a slot per watch (add
  more slots any time; no limit). Each slot shows the watch's face picture, brand, model/reference and time
  worn in the past 12 months, and is outlined green (worn most), amber or red (worn least). Adding a watch
  opens the camera with a circle, square or tall-rectangle guide: fill it with the watch head and only that
  is kept as the watch's face picture. With the circle guide the app looks for the round bezel as you aim
  (`js/dialfind.js`: walks round candidate circles checking for an edge crossing them, settles on the centre shared by the most rings, then takes the outermost; no AI model) and snaps the crop to it; a photo picked from the
  library with a transparent background (iPhone "lift subject") is kept as a cut-out PNG. With "Auto photo" on (the default),
  holding the found dial steady for about a second takes the photo by itself, and the result screen carries on
  after a short countdown (any touch stops it) — hands-free with the watch on your wrist. Pressing the shutter runs a film-style scan that reads the dial on the
  phone (brand, automatic/quartz, jewels, water resistance, GMT/chronograph/date when written on the dial, and a
  best guess from partly-read words). Then "Which watch is it?" in three steps — brand (dropdown with "Add a brand"),
  model by reference or by name, year (or not sure) — and the form, pre-filled with the dial reading and those
  answers; everything else is entered by hand (a button opens Chrono24's search for prices). The form also has
  seller type (private seller, or shop name/address/contact for a jeweller), legacy (who the watch is to be left to —
  not a will), and each watch can make a for-sale QR code. Each watch also has an insurance photo checklist (front, case back,
  both sides, clasp, serial and reference close-ups, scale, wrist, marks, box, papers, receipt, valuation), an
  insurance PDF (all its details and photos, with a "not an official insurance document" disclaimer) and a memory
  book PDF (face picture, its story and legacy note, details without the serial, insurance photos and galleries —
  more galleries plug in through `memoryGalleries` in `js/watchdocs.js`). Galleries on each watch: wrist shots, favourite moments,
  marks & blemishes (with notes), general and lume; photos are taken in the app or picked from the library, and keep
  when and where they were taken (from the photo's own EXIF data, or the current time and location). Photos are
  copied into the app, as a web app can't link to the Photos library. Plus wishlist and sold/traded, more photos, values and a summary. What's on your wrist, service/warranty/battery reminders and
  a wear calendar with stats sit at the top; each watch's own page has its wrist panel (wear now / taken
  off, power-reserve countdown with "Wound", recent wears, log a past wear). This replaces the old
  Collection and Wrist tabs (old `#wrist` links open the Watch Box).
- **Tools**: set to the minute (countdown with beeps), date-change danger zone, moon phase, GMT helper,
  experimental microphone timegrapher, insurance list (PDF) and CSV export, world clock, weather,
  currency, backup & settings, and About.
- **Alarm & timers** (in Tools): 5 saved alarm banks, each with an optional sunrise wake light
  (screen glows red → orange → warm white before the alarm) and a set time or the real local sunrise;
  Bedside mode with a sleep timer and optional on-device listening for snoring and restless sleep
  (nothing is recorded); countdown timer, stopwatch with laps (fastest/average/slowest), egg timer, and up to 20 medication
  timers planned from the packet (most doses in 24 hours, shortest gap, optional longest gap) and your
  wake-up and bedtime, re-planned after each dose). Every alarm and timer can use one of three tones (Soft spa, Medium pop,
  Harsh rock), composed for this app and synthesised live with Web Audio, so they're royalty-free and
  work offline. Alarms also show and speak wake-up words to match the tone, with quotes from the internet.

It's a static site with no build step, no backend, no API keys and no tracking. All data stays on the
user's own phone (localStorage, with photos in IndexedDB). There's a JSON backup and restore, with
photos optional.

## Data sources (free, keyless, CORS-enabled)
- Dial reading: Tesseract.js OCR runs on the phone (engine and English data downloaded once from jsDelivr); pictures never leave the device
- Watch details: entered by hand (no free watch-specification source exists to look them up automatically)
- Prices: Chrono24 has no public API and blocks cross-site requests, so the app opens Chrono24's search instead
- For-sale QR codes: qrcode-generator (jsDelivr), made on the phone
- Time: `time.now` (fallback `timeapi.io`)
- Weather and place search: Open-Meteo (Met Office `ukmo_seamless`, then `best_match`)
- Town name: BigDataCloud (fallback OpenStreetMap Nominatim)
- Exchange rates: open.er-api.com
- Wake-up quotes: DummyJSON (dummyjson.com/quotes), sorted by mood on the device
- Moon phase and sunrise times: calculated on the device

## Changing the name
Edit `js/config.js` (app name and channel), plus `name`/`short_name` in `manifest.webmanifest` and `<title>` in `index.html`.

## Releasing an update
Bump `VERSION` in `sw.js` and `APP_VERSION` in `js/app.js`, and add any new files to `SHELL` in `sw.js`.

## Run locally
`python3 -m http.server 8000`, then open http://localhost:8000
