// Finds a round watch head (bezel / case ring) in a small square picture, so the camera can snap its crop to it.
//
// How: for each candidate circle, walk round it at 64 points and check whether there's a clear light/dark change
// *across* the circle there (the edge of a bezel). A real bezel has that nearly all the way round; hair, fabric,
// bracelet links and dial print don't line up into a circle, so they can't fake it. Coarse search first, then a
// fine one around the best few. Pure maths, no model; tuned on real wrist photos in poor light.

const A = 64;                                   // points round each circle
const COS = new Float32Array(A), SIN = new Float32Array(A);
for (let i = 0; i < A; i++) { COS[i] = Math.cos((i / A) * 2 * Math.PI); SIN[i] = Math.sin((i / A) * 2 * Math.PI); }

/**
 * @param {ImageData} img  a square picture (about 160 px), roughly centred on where the watch should be
 * @returns {{cx:number, cy:number, r:number, score:number} | null}  in the picture's pixels; score = share of the
 *   circle with a clear edge (0–1)
 */
export function findDial(img) {
  const W = img.width, H = img.height, N = Math.min(W, H);
  const { gx, gy, T } = gradients(img);

  // How much of the circle (cx, cy, r) has an edge running along it. `band` allows a little slack in radius,
  // which also lets a slightly tilted (oval) watch count.
  const ring = (cx, cy, r, band) => {
    const q = [0, 0, 0, 0];                       // hits per quarter: a real bezel has edges all the way round
    for (let a = 0; a < A; a++) {
      let best = 0;
      for (let dr = -band; dr <= band; dr++) {
        const x = Math.round(cx + COS[a] * (r + dr)), y = Math.round(cy + SIN[a] * (r + dr));
        if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
        const i = y * W + x;
        const v = Math.abs(gx[i] * COS[a] + gy[i] * SIN[a]);   // the part of the edge that crosses the circle
        if (v > best) best = v;
      }
      if (best > T) q[(a * 4 / A) | 0]++;
    }
    const per = A / 4;
    const mean = (q[0] + q[1] + q[2] + q[3]) / A, worst = Math.min(...q) / per;
    return 0.5 * mean + 0.5 * worst;              // a lopsided ring (strong on one side only) scores low
  };

  const rMin = Math.round(N * 0.2), rMax = Math.round(N * 0.5);
  // A real edge peaks sharply at one radius; a "ring" stitched together from different edges (e.g. the
  // crystal's top and the bezel's bottom) is a broad smear of middling scores. Reward the sharp ones.
  const sharp = (cx, cy, r) => {
    const v = ring(cx, cy, r, 1);
    return v - 0.5 * (ring(cx, cy, r - 4, 1) + ring(cx, cy, r + 4, 1)) / 2;
  };
  // Every ring round one centre, measured once (much faster than asking ring by ring).
  const profile = (cx, cy) => {
    const p = new Float32Array(rMax + 6);
    for (let r = rMin - 4; r <= rMax + 4; r++) p[r] = ring(cx, cy, r, 1);
    return p;
  };
  const sharpOf = (p, r) => p[r] - 0.25 * (p[r - 4] + p[r + 4]);

  // Coarse: centres near the middle (the guide is centred on the watch), every 4 px; radii every 3 px.
  const lim = N * 0.2, mx = W / 2, my = H / 2;
  const coarse = [];
  for (let cy = Math.round(my - lim); cy <= my + lim; cy += 4) {
    for (let cx = Math.round(mx - lim); cx <= mx + lim; cx += 4) {
      for (let r = rMin; r <= rMax; r += 3) {
        const s = ring(cx, cy, r, 2);
        if (s >= 0.45) coarse.push({ cx, cy, r, s });
      }
    }
  }
  if (!coarse.length) return null;
  coarse.sort((a, b) => b.s - a.s);

  // Fine: around the best few coarse hits, every pixel, tighter radius slack.
  let best = null;
  for (const c of coarse.slice(0, 6)) {
    for (let cy = c.cy - 3; cy <= c.cy + 3; cy++) for (let cx = c.cx - 3; cx <= c.cx + 3; cx++) {
      for (let r = c.r - 3; r <= c.r + 3; r++) {
        if (r < rMin || r > rMax) continue;
        const s = ring(cx, cy, r, 1);
        if (s < 0.6) continue;
        const k = sharp(cx, cy, r);
        if (!best || k > best.k) best = { cx, cy, r, s, k };
      }
    }
  }
  if (!best || best.s < 0.68) return null;

  // A watch head is many circles sharing one centre (crystal edge, chapter ring, dial edge, bezel); a case
  // outline bulging at the lugs or pushers isn't. So settle the centre where the most rings line up…
  const support = (cx, cy) => {
    const p = profile(cx, cy);
    let t = 0;
    for (let r = rMin; r <= rMax; r++) { const v = sharpOf(p, r); if (v > 0.35) t += v - 0.35; }
    return t / 2;
  };
  const starts = [best, coarse[0]];
  let centre = { cx: best.cx, cy: best.cy, t: support(best.cx, best.cy) };
  for (const st of starts) {
    for (let cy = st.cy - 10; cy <= st.cy + 10; cy += 2) for (let cx = st.cx - 10; cx <= st.cx + 10; cx += 2) {
      const t = support(cx, cy);
      if (t > centre.t) centre = { cx, cy, t };
    }
  }
  for (let cy = centre.cy - 2; cy <= centre.cy + 2; cy++) for (let cx = centre.cx - 2; cx <= centre.cx + 2; cx++) {
    const t = support(cx, cy);
    if (t > centre.t) centre = { cx, cy, t };
  }
  // …then take the outermost strong ring round it, so the crop includes the whole bezel.
  const prof = profile(centre.cx, centre.cy);
  let outer = null;
  for (let r = rMin; r <= rMax; r++) if (prof[r] >= 0.68) outer = { cx: centre.cx, cy: centre.cy, r, s: prof[r] };
  if (!outer) outer = best;
  // A white or polished bezel on a pale case can be faint: once the centre is settled, accept a fainter ring a
  // little further out (it has to be a sharp, clean edge round that same centre).
  for (let r = Math.ceil(outer.r * 1.05); r <= Math.min(rMax, outer.r * 1.3); r++) {
    const v = ring(outer.cx, outer.cy, r, 1);
    if (v >= 0.5 && sharp(outer.cx, outer.cy, r) >= 0.25) outer = { ...outer, r, s: Math.max(outer.s, v) };
  }
  return { cx: outer.cx, cy: outer.cy, r: outer.r, score: outer.s };
}

/** Sobel gradients of a lightly blurred greyscale copy, and an "is this a real edge" level for this picture. */
function gradients(img) {
  const W = img.width, H = img.height, p = img.data;
  const g0 = new Float32Array(W * H);
  for (let i = 0, j = 0; j < W * H; i += 4, j++) g0[j] = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
  const g = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    let s = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += g0[(y + dy) * W + x + dx];
    g[y * W + x] = s / 9;
  }
  const gx = new Float32Array(W * H), gy = new Float32Array(W * H), mag = [];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    gx[i] = g[i - W + 1] + 2 * g[i + 1] + g[i + W + 1] - g[i - W - 1] - 2 * g[i - 1] - g[i + W - 1];
    gy[i] = g[i + W - 1] + 2 * g[i + W] + g[i + W + 1] - g[i - W - 1] - 2 * g[i - W] - g[i - W + 1];
    mag.push(Math.hypot(gx[i], gy[i]));
  }
  mag.sort((a, b) => a - b);
  // A clear edge: stronger than most of the picture (works in dim light, where every edge is weak).
  const T = Math.max(24, mag[Math.floor(mag.length * 0.72)]);
  return { gx, gy, T };
}
