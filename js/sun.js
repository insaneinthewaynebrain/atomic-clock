// Sunrise and sunset on the device (the standard "sunrise equation", good to about a minute).

const RAD = Math.PI / 180;

/**
 * Sunrise and sunset (ms) for the local calendar day of `day` at lat/lon.
 * Returns { rise, set } or { polar: 'day' | 'night' } when the sun doesn't rise or set.
 */
export function sunTimes(day, lat, lon) {
  const noonUtc = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), 12);
  const J = noonUtc / 86400000 + 2440587.5;
  const n = Math.round(J - 2451545.0 + 0.0008);
  const Js = n - lon / 360;
  const M = ((357.5291 + 0.98560028 * Js) % 360 + 360) % 360;
  const C = 1.9148 * Math.sin(M * RAD) + 0.02 * Math.sin(2 * M * RAD) + 0.0003 * Math.sin(3 * M * RAD);
  const L = (M + C + 180 + 102.9372) % 360;
  const Jt = 2451545.0 + Js + 0.0053 * Math.sin(M * RAD) - 0.0069 * Math.sin(2 * L * RAD);
  const sinD = Math.sin(L * RAD) * Math.sin(23.4397 * RAD);
  const cosD = Math.cos(Math.asin(sinD));
  const cosH = (Math.sin(-0.833 * RAD) - Math.sin(lat * RAD) * sinD) / (Math.cos(lat * RAD) * cosD);
  if (cosH > 1) return { polar: 'night' };
  if (cosH < -1) return { polar: 'day' };
  const H = Math.acos(cosH) / RAD;
  const toMs = (j) => Math.round((j - 2440587.5) * 86400000);
  return { rise: toMs(Jt - H / 360), set: toMs(Jt + H / 360) };
}

/** Sunrise (ms) on the local day of `day`, rounded down to the minute, or null. */
export function sunriseOn(day, place) {
  if (!place) return null;
  const s = sunTimes(day, place.lat, place.lon);
  return s.rise ? Math.floor(s.rise / 60000) * 60000 : null;
}
