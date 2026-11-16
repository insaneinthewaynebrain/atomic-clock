// Keeps the screen on while something needs it (Bedside mode, the sunrise, a ringing or snoozing alarm).
// iOS drops a screen wake lock now and then (a notification, the microphone stopping, a sound starting),
// so ask again whenever it's dropped, when the app comes back to the front, and every 15 seconds.
const reasons = new Set();
let lock = null, asking = false;

async function ask() {
  if (!reasons.size || asking || document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return;
  if (lock && !lock.released) return;
  asking = true;
  try {
    lock = await navigator.wakeLock.request('screen');
    lock.addEventListener('release', () => { lock = null; if (reasons.size) setTimeout(ask, 500); });
  } catch (e) { lock = null; }
  finally { asking = false; }
}

export function keepAwake(reason) { reasons.add(reason); ask(); }
export function allowSleep(reason) {
  reasons.delete(reason);
  if (!reasons.size && lock) { lock.release().catch(() => {}); lock = null; }
}

document.addEventListener('visibilitychange', ask);
setInterval(ask, 15000);

/* ---------- Screen edges ----------
 On some iPhones (foldables, landscape) iOS keeps a strip beside the app for its status icons, painted
 with the page's own background. Full-screen views set it to their colour so the whole screen matches.
 Several can be open at once; the topmost wins. */
const ORDER = ['ring', 'sun', 'bedside'];
const edges = {};
export function setEdge(owner, colour) {
  if (colour) edges[owner] = colour; else delete edges[owner];
  const top = ORDER.find((o) => edges[o]);
  const c = top ? edges[top] : '';
  document.documentElement.style.backgroundColor = c;
  document.body.style.backgroundColor = c;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) { meta.dataset.orig ||= meta.content; meta.content = c || meta.dataset.orig; }
}
