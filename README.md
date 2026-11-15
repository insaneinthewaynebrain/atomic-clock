# Atomic Clock

A free app for watch collectors, made for viewers of the **Watch Hobbyist** YouTube channel
(https://www.youtube.com/watchhobbyist). It installs on an iPhone home screen like an app (PWA).

- **Clock**: network-synced time to the millisecond for setting watches, plus an accuracy tracker
  (+/− seconds and Mark), grades against COSC / METAS / Rolex / Grand Seiko and movement specs,
  position testing, and shareable result cards.
- **Collection**: watches, wishlist, sold/traded, photos, values and a collection summary.
- **Wrist**: what you're wearing, a wear calendar and stats, power-reserve countdowns, and service,
  warranty and battery reminders.
- **Tools**: set to the minute (countdown with beeps), date-change danger zone, moon phase, GMT helper,
  experimental microphone timegrapher, insurance list (PDF) and CSV export, world clock, weather,
  currency, backup & settings, and About.
- **Alarm & timers** (in Tools): 5 saved alarm banks, each with an optional sunrise wake light
  (screen glows red → orange → warm white before the alarm) and a set time or the real local sunrise;
  Bedside mode; countdown timer, stopwatch, lap timer, egg timer and up to 20 named medication timers.
  Every alarm and timer can use one of three tones (Soft spa, Medium pop, Harsh rock). The tones are
  composed for this app and synthesised live with Web Audio, so they're royalty-free and work offline.

It's a static site with no build step, no backend, no API keys and no tracking. All data stays on the
user's own phone (localStorage, with photos in IndexedDB). There's a JSON backup and restore, with
photos optional.

## Data sources (free, keyless, CORS-enabled)
- Time: `time.now` (fallback `timeapi.io`)
- Weather and place search: Open-Meteo (Met Office `ukmo_seamless`, then `best_match`)
- Town name: BigDataCloud (fallback OpenStreetMap Nominatim)
- Exchange rates: open.er-api.com
- Moon phase and sunrise times: calculated on the device

## Changing the name
Edit `js/config.js` (app name and channel), plus `name`/`short_name` in `manifest.webmanifest` and `<title>` in `index.html`.

## Releasing an update
Bump `VERSION` in `sw.js` and `APP_VERSION` in `js/app.js`, and add any new files to `SHELL` in `sw.js`.

## Run locally
`python3 -m http.server 8000`, then open http://localhost:8000
