// Finds a round watch head (dial + bezel) in a small square picture, so the camera can snap its crop to it.
// Classic circle Hough transform guided by edge direction: every strong edge votes for centres along its
// gradient (both ways, so light-on-dark and dark-on-light rings both count). Pure maths, no model, ~10 ms.

/**
 * @param {ImageData} img  a square-ish picture (about 160 px), roughly centred on where the watch should be
 * @returns {{cx:number, cy:number, r:number, score:number} | null}  in the picture's pixels
 */
export function findDial(img) {
  const first = rings(img, 0.86, 0.18, 0.5);
  if (!first) return null;
  const { top, outer } = first;
  let res = outer;
  if (outer.r <= top.r * 1.12) {
    // Only the dial's own edge stood out: look again, more sensitively, for a fainter case/bezel ring just
    // outside it (e.g. a gold case on a beige background).
    const N = Math.min(img.width, img.height);
    const second = rings(img, 0.7, Math.min(0.5, (top.r * 1.1) / N), Math.min(0.5, (top.r * 1.6) / N), top, 0.3);
    if (second && second.best) res = second.best;
  }
  // Step outwards while the ring's edges keep going (an oval's far side), but never past 1.45× the ring found.
  let r = res.r;
  for (let i = 0; i < 4; i++) {
    const nr = Math.min(res.r * 1.45, widest(first.edges, { ...res, r }));
    if (nr < r * 1.02) break;
    r = nr;
  }
  return { ...res, r };
}

/**
 * A watch seen at an angle is an oval: the ring found sits nearer its narrow side. Measure how far the
 * ring's own edges reach (edges facing the centre, near the ring) so the crop takes in the wide side too.
 */
function widest(edges, c) {
  const d = [];
  for (let k = 0; k < edges.x.length; k++) {
    const vx = edges.x[k] - c.cx, vy = edges.y[k] - c.cy, dist = Math.hypot(vx, vy);
    if (dist < c.r * 0.85 || dist > c.r * 1.2) continue;
    if (Math.abs((vx * edges.ux[k] + vy * edges.uy[k]) / dist) < 0.8) continue;     // not facing the centre
    d.push(dist);
  }
  if (d.length < 2 * Math.PI * c.r * 0.25) return c.r;
  d.sort((a, b) => a - b);
  return Math.max(c.r, d[Math.floor(d.length * 0.85)]);
}

function rings(img, pct, rLo, rHi, near = null, minScore = 0.5) {
  const W = img.width, H = img.height, N = Math.min(W, H);
  const p = img.data;
  // Greyscale + 3×3 blur.
  const g0 = new Float32Array(W * H);
  for (let i = 0, j = 0; j < W * H; i += 4, j++) g0[j] = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
  const g = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    let s = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += g0[(y + dy) * W + x + dx];
    g[y * W + x] = s / 9;
  }
  // Sobel edges.
  const ex = [], ey = [], ux = [], uy = [];
  const mags = new Float32Array(W * H);
  const gxA = new Float32Array(W * H), gyA = new Float32Array(W * H);
  for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
    const i = y * W + x;
    const gx = g[i - W + 1] + 2 * g[i + 1] + g[i + W + 1] - g[i - W - 1] - 2 * g[i - 1] - g[i + W - 1];
    const gy = g[i + W - 1] + 2 * g[i + W] + g[i + W + 1] - g[i - W - 1] - 2 * g[i - W] - g[i - W + 1];
    gxA[i] = gx; gyA[i] = gy; mags[i] = Math.hypot(gx, gy);
  }
  const sorted = Float32Array.from(mags).sort();
  const thr = Math.max(30, sorted[Math.floor(sorted.length * pct)]);
  for (let i = 0; i < mags.length; i++) {
    if (mags[i] < thr) continue;
    ex.push(i % W); ey.push((i / W) | 0); ux.push(gxA[i] / mags[i]); uy.push(gyA[i] / mags[i]);
  }
  if (ex.length < 40) return near ? { best: null } : null;

  // Votes for (centre, radius).
  const rMin = Math.round(N * rLo), rMax = Math.max(Math.round(N * rLo), Math.round(N * rHi));
  const nR = rMax - rMin + 1;
  const acc = new Uint16Array(nR * W * H);
  for (let k = 0; k < ex.length; k++) {
    const x = ex[k], y = ey[k], dx = ux[k], dy = uy[k];
    for (let ri = 0; ri < nR; ri++) {
      const r = rMin + ri;
      for (const sgn of [1, -1]) {
        const cx = Math.round(x + sgn * dx * r), cy = Math.round(y + sgn * dy * r);
        if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
        acc[ri * W * H + cy * W + cx]++;
      }
    }
  }
  // Best centre for each radius (3×3 neighbourhood sum soaks up rounding), scored as the share of the
  // circumference that has a matching edge. Only centres near the middle count: the guide is centred.
  const cands = [];
  const lim = near ? N * 0.05 : N * 0.22, mx = near ? near.cx : W / 2, my = near ? near.cy : H / 2;
  for (let ri = 0; ri < nR; ri++) {
    const r = rMin + ri, base = ri * W * H;
    let best = 0, bx = 0, by = 0;
    for (let y = Math.max(1, Math.floor(my - lim)); y < Math.min(H - 1, my + lim); y++) {
      for (let x = Math.max(1, Math.floor(mx - lim)); x < Math.min(W - 1, mx + lim); x++) {
        // 3×3 around the centre, over this radius and its neighbours: a watch seen at an angle is an oval,
        // whose edge votes spread over a few radii and centres.
        let v = 0;
        for (let dr = -1; dr <= 1; dr++) {
          if (ri + dr < 0 || ri + dr >= nR) continue;
          const i = (ri + dr) * W * H + y * W + x, wgt = dr ? 0.6 : 1;
          v += wgt * (acc[i] + acc[i - 1] + acc[i + 1] + acc[i - W] + acc[i + W] + 0.5 * (acc[i - W - 1] + acc[i - W + 1] + acc[i + W - 1] + acc[i + W + 1]));
        }
        v /= 2.2;          // same scale as a single radius, so the score thresholds below still mean the same
        if (v > best) { best = v; bx = x; by = y; }
      }
    }
    cands.push({ cx: bx, cy: by, r, score: best / (2 * Math.PI * r) });
  }
  if (near) {
    // Second pass: the largest ring around the same centre that's clearly there.
    const ok = cands.filter((c) => c.score >= minScore);
    return { best: ok.length ? ok.reduce((a, b) => (b.r > a.r ? b : a)) : null };
  }
  const top = cands.reduce((a, b) => (b.score > a.score ? b : a));
  if (top.score < minScore) return null;
  // Several rings (dial edge, chapter ring, bezel): take the outermost strong one that shares the centre,
  // so the crop includes the bezel.
  const outer = cands.filter((c) => c.score >= Math.max(0.5, top.score * 0.45) && Math.hypot(c.cx - top.cx, c.cy - top.cy) <= N * 0.06)
    .reduce((a, b) => (b.r > a.r ? b : a), top);
  return { top, outer, edges: { x: ex, y: ey, ux, uy } };
}

