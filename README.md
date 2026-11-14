# Atomic Clock

A personal iPhone web app (PWA): a network-synced clock for setting mechanical watches to the second, a watch accuracy tracker, a world clock, a weather forecast and a currency converter.

It's a static site (HTML, CSS and JavaScript) with no build step, no backend and no API keys. All your data stays in your browser's localStorage. Use **Settings ⚙︎ → Export backup** now and then.

## Data sources (all free, keyless, CORS-enabled)

| Feature | Source |
|---|---|
| Network time | `time.now` (fallback: `timeapi.io`) |
| Place search / time zones | Open-Meteo geocoding API |
| Weather | Open-Meteo: UK Met Office `ukmo_seamless` model first, Open-Meteo `best_match` for any missing value |
| Exchange rates | `open.er-api.com` (ExchangeRate-API), 160+ currencies, updated daily |

## Files

- `index.html`, `styles.css`: the page and its look
- `js/`: app code (`time.js` sync, `clock.js`, `tracker.js`, `world.js`, `weather.js`, `currency.js`)
- `sw.js`: offline support. **Bump `VERSION` in `sw.js` whenever you change files**, so phones pick up the update.
- `manifest.webmanifest`, `icons/`: home-screen app settings and icons

## Run locally

```
python3 -m http.server 8000
```
Then open http://localhost:8000
