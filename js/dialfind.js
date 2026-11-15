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

/* ---------- Precise fit at the moment the photo is taken ---------- */

/**
 * Traces the bezel's real edge round a rough find and fits an oval to it (a watch seen slightly at an angle is
 * an oval, and the rough circle sits off its centre). `img` is a bigger copy of the same picture (e.g. 480 px)
 * and `rough` is the rough find scaled to it.
 * @returns {{cx:number, cy:number, a:number, b:number, angle:number} | null}  oval centre, half-axes (a ≥ b)
 *   and the direction of the long axis (radians); null if the edge can't be traced reliably
 */
export function traceBezel(img, rough) {
  const W = img.width, H = img.height;
  const { gx, gy, T } = gradients(img);
  const R = 128, pts = [];
  for (let i = 0; i < R; i++) {
    const t = (i / R) * 2 * Math.PI, c = Math.cos(t), s = Math.sin(t);
    // Walk out along the ray (wide enough for the short side of a tilted watch). Take the *outermost* clear edge,
    // not the strongest: the bezel's outer edge, rather than the insert/dial boundary inside it.
    const prof = [];
    for (let r = rough.r * 0.68; r <= rough.r * 1.25; r += 0.5) {
      const x = Math.round(rough.cx + c * r), y = Math.round(rough.cy + s * r);
      if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) { prof.push([r, 0]); continue; }
      const k = y * W + x;
      prof.push([r, Math.abs(gx[k] * c + gy[k] * s)]);
    }
    const peak = Math.max(...prof.map((q) => q[1]));
    let at = null;
    if (peak > T) {
      for (let j = prof.length - 2; j >= 1; j--) {
        const v = prof[j][1];
        if (v >= peak * 0.5 && v >= prof[j - 1][1] && v >= prof[j + 1][1]) { at = [rough.cx + c * prof[j][0], rough.cy + s * prof[j][0]]; break; }
      }
    }
    if (at) pts.push(at);
  }
  if (pts.length < R * 0.6) return null;
  // Fit, drop the points that disagree most (lugs, crown, reflections), fit again.
  let use = pts, fit = null;
  for (let pass = 0; pass < 3; pass++) {
    fit = fitEllipse(use);
    if (!fit) return null;
    const res = use.map((p) => Math.abs(ellipseDist(fit, p)));
    const cut = [...res].sort((x, y) => x - y)[Math.floor(res.length * 0.75)] * 1.5 + 0.5;
    const next = use.filter((p, i) => res[i] <= cut);
    if (next.length < R * 0.45) break;
    use = next;
  }
  if (!fit || fit.b / fit.a < 0.65 || fit.a > rough.r * 1.3 || fit.b < rough.r * 0.62) return null;
  if (Math.hypot(fit.cx - rough.cx, fit.cy - rough.cy) > rough.r * 0.25) return null;
  return fit;
}

/** Least-squares conic fit (A x² + B xy + C y² + D x + E y = 1, centred for stability) → oval parameters. */
function fitEllipse(pts) {
  const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length, my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const M = Array.from({ length: 5 }, () => new Float64Array(6));
  for (const [px, py] of pts) {
    const x = px - mx, y = py - my, row = [x * x, x * y, y * y, x, y];
    for (let i = 0; i < 5; i++) { for (let j = 0; j < 5; j++) M[i][j] += row[i] * row[j]; M[i][5] += row[i]; }
  }
  // Solve the 5×5 normal equations (Gaussian elimination with pivoting).
  for (let c = 0; c < 5; c++) {
    let p = c; for (let r = c + 1; r < 5; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) return null;
    for (let r = 0; r < 5; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k < 6; k++) M[r][k] -= f * M[c][k]; }
  }
  const [A, B, C, D, E] = M.map((r, i) => r[5] / r[i]);
  const den = 4 * A * C - B * B;
  if (den <= 0) return null;                                   // not an ellipse
  const x0 = (B * E - 2 * C * D) / den, y0 = (B * D - 2 * A * E) / den;
  const F = 1 + A * x0 * x0 + B * x0 * y0 + C * y0 * y0;       // value at the centre, moved to the right-hand side
  const angle = 0.5 * Math.atan2(B, A - C);
  const cs = Math.cos(angle), sn = Math.sin(angle);
  const Ap = A * cs * cs + B * cs * sn + C * sn * sn, Cp = A * sn * sn - B * cs * sn + C * cs * cs;
  if (Ap <= 0 || Cp <= 0 || F <= 0) return null;
  let a = Math.sqrt(F / Ap), b = Math.sqrt(F / Cp), ang = angle;
  if (b > a) { [a, b] = [b, a]; ang += Math.PI / 2; }
  return { cx: x0 + mx, cy: y0 + my, a, b, angle: ang };
}

/** Roughly how far a point is from the oval's edge (in pixels; negative = inside). */
function ellipseDist(e, [px, py]) {
  const c = Math.cos(e.angle), s = Math.sin(e.angle), dx = px - e.cx, dy = py - e.cy;
  const u = dx * c + dy * s, v = -dx * s + dy * c;
  const rho = Math.hypot(u / e.a, v / e.b);
  return (rho - 1) * Math.hypot(u, v) / Math.max(rho, 1e-6);
}
