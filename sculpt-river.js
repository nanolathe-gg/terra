// P28 rivers: a river is a valley landform whose path is migrated at stroke time. The drawn line is resampled at half the channel width and moved a seeded number
// of steps by Howard and Knutson's rule (1984): the nominal rate is the channel width times the curvature, the migration rate is minus that plus an upstream-weighted
// sum of it (so bends grow and travel downstream), applied toward the outer bank. A light Laplacian keeps the bank stiff, a neck cutoff (two points far apart along
// the river but near across it) drops the loop and keeps it as an oxbow, and a belt about the drawn line caps how far a bend can grow.
//
// Determinism: the path is a pure function of (drawn line, width, steps, seed) built only from + - * / sqrt, comparisons and an integer hash, which IEEE 754
// fixes exactly (no Math.pow, Math.hypot, Math.exp or trig, whose last bit may differ between browsers). The migrated path is still stored in the save and
// never recomputed on load; this function runs when a river is drawn or its Wander, Width or seed is edited.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const RIVER_MIN_WIDTH = 32;          // px: narrower and the channel is not orthogonally connected on the 16-px height grid (measured at 18 px: not connected)
export const RIVER_STEPS_PER_WANDER = 4;    // Wander 0..120 is 0..480 migration steps
export const RIVER_SPAN = 6;                // the section's half width over the channel's half width: the floodplain, levees and valley walls reach this far
export const BRAIDED_SPAN = 22;             // and for a braided belt (half a belt is 4.8 widths = 9.6 channel half widths, over a level floor to 11)
export const RIVER_BELT = 8;                // the most a bend can grow, in channel widths from the drawn line (it slows over the last third, and stops there)
export const RIVER_MAX_POINTS = 600;        // a drawn line longer than this many half-widths is thinned by the width, not by the cap
export const isBraided = q => q?.curve?.form === 'lfBraided';
export const isRiver = q => q?.curve?.form === 'lfRiver' || isBraided(q);
export const riverSpan = q => isBraided(q) ? BRAIDED_SPAN : RIVER_SPAN;
export const riverWidth = q => Math.max(RIVER_MIN_WIDTH, 2 * (q?.radius || 0));
export const riverSteps = wander => Math.round(clamp(Number(wander) || 0, 0, 120) * RIVER_STEPS_PER_WANDER);

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const len = (ax, ay, bx, by) => Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
function resample(pts, ds) {
  const out = [pts[0].slice()]; let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], L = len(ax, ay, bx, by);
    if (L < 1e-9) continue;
    let t = ds - carry;
    while (t <= L) { out.push([ax + (bx - ax) * t / L, ay + (by - ay) * t / L]); t += ds; }
    carry = L - (t - ds);
  }
  const last = pts[pts.length - 1], tail = out[out.length - 1];
  if (len(last[0], last[1], tail[0], tail[1]) > ds * 0.3 || out.length < 2) out.push(last.slice()); else out[out.length - 1] = last.slice();
  return out;
}
// The signed curvature at each vertex (positive when the path turns toward +y of its direction of travel in x-right, y-up terms), smoothed twice.
function curvature(pts) {
  const n = pts.length, C = new Float64Array(n);
  for (let i = 1; i < n - 1; i++) {
    const dx = (pts[i + 1][0] - pts[i - 1][0]) / 2, dy = (pts[i + 1][1] - pts[i - 1][1]) / 2;
    const ddx = pts[i + 1][0] - 2 * pts[i][0] + pts[i - 1][0], ddy = pts[i + 1][1] - 2 * pts[i][1] + pts[i - 1][1];
    const d2 = dx * dx + dy * dy;
    C[i] = d2 > 1e-12 ? (dx * ddy - dy * ddx) / (d2 * Math.sqrt(d2)) : 0;
  }
  for (let pass = 0; pass < 2; pass++) { const c = C.slice(); for (let i = 1; i < n - 1; i++) C[i] = 0.25 * c[i - 1] + 0.5 * c[i] + 0.25 * c[i + 1]; }
  return C;
}
// The nearest point of a polyline to (x, y), as [x, y, squared distance].
function nearest(line, x, y) {
  let bx = line[0][0], by = line[0][1], bd = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const ax = line[i][0], ay = line[i][1], dx = line[i + 1][0] - ax, dy = line[i + 1][1] - ay, l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? clamp(((x - ax) * dx + (y - ay) * dy) / l2, 0, 1) : 0, px = ax + dx * t, py = ay + dy * t, d = (x - px) * (x - px) + (y - py) * (y - py);
    if (d < bd) { bd = d; bx = px; by = py; }
  }
  return [bx, by, bd];
}

// Migrate a drawn line. `points` are {x, y}; returns {path, oxbows, drawn} with points as {x, y} and each oxbow {points, age} (age 0 for the last cutoff, 1 for the
// first). bounds {w, h} keeps the river on the map. Fewer than two distinct points, or zero steps, return the drawn line resampled (no migration).
export function migrateRiver(points, {width = RIVER_MIN_WIDTH, steps = 0, seed = 1, bounds = null, rate = 4, WOB = 0.8, smooth = 0.05, lag = 2} = {}) {
  const W = Math.max(RIVER_MIN_WIDTH, width);
  let ds = W * 0.5;
  let total = 0;
  for (let i = 1; i < points.length; i++) total += len(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y);
  if (total / ds > RIVER_MAX_POINTS) ds = total / RIVER_MAX_POINTS;
  const raw = points.map(p => [p.x, p.y]);
  if (raw.length < 2 || total < 1e-6) return {path: points.map(p => ({x: p.x, y: p.y})), oxbows: [], drawn: points.map(p => ({x: p.x, y: p.y})), steps: 0};
  const r = rng(seed), drawn = resample(raw, ds);
  const count = Math.max(0, Math.min(Math.round(steps), 1000));
  const xy = a => a.map(p => ({x: p[0], y: p[1]}));
  if (!count) return {path: xy(drawn), oxbows: [], drawn: xy(drawn), steps: 0};   // Wander 0 keeps the line as drawn
  let pts = drawn.map(p => p.slice());
  // A straight line has no curvature to grow from, and a river's bends have a wavelength of about eleven widths: a seeded wobble at that scale, off the line by
  // up to half a width, starts them (as the lab's drawn sine did). It fades to nothing over the first and last two widths, so the ends stay where they were put.
  const ph1 = r(), ph2 = r(), tri = t => { const x = t - Math.floor(t), y = x < 0.5 ? 2 * x : 2 - 2 * x; return 2 * y * y * (3 - 2 * y) - 1; };   // a smooth wave of period 1 from + - * only
  let arc = 0;
  const arcs = [0];
  for (let i = 1; i < pts.length; i++) { arc += len(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]); arcs.push(arc); }
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i + 1], tl = len(a[0], a[1], b[0], b[1]) || 1, e = Math.min(arcs[i], arc - arcs[i]) / (2 * W), fade = e >= 1 ? 1 : e * e * (3 - 2 * e);
    const off = fade * W * (WOB * (tri(arcs[i] / (11 * W) + ph1) + 0.45 * tri(arcs[i] / (5 * W) + ph2)));
    pts[i][0] += -(b[1] - a[1]) / tl * off; pts[i][1] += (b[0] - a[0]) / tl * off;
  }
  const oxbows = [], belt2 = RIVER_BELT * W * RIVER_BELT * W, decay = (lag * W) / (lag * W + ds), scale = W / 18;
  const lo = bounds ? [0, 0] : null, hi = bounds ? [bounds.w - 1, bounds.h - 1] : null;
  const keep = (q, known = Infinity) => {   // the belt about the drawn line, and the map; `known`: how far it stood from the line before this step moved it (a step moves a point by less than half a sample)
    const [nx, ny, d2] = known + 0.5 * ds < RIVER_BELT * W ? [0, 0, 0] : nearest(drawn, q[0], q[1]);
    if (d2 > belt2) { const k = RIVER_BELT * W / Math.sqrt(d2); q[0] = nx + (q[0] - nx) * k; q[1] = ny + (q[1] - ny) * k; }
    if (lo) { q[0] = clamp(q[0], lo[0], hi[0]); q[1] = clamp(q[1], lo[1], hi[1]); }
  };
  for (let it = 0; it < count && pts.length >= 8; it++) {
    const n = pts.length, C = curvature(pts);
    let acc = 0, norm = 0;
    const next = pts.map(p => p.slice());
    const stood = new Float64Array(n).fill(Infinity);
    const along = [0];   // the ends stay where they were put: the bends fade in over the first and last five widths
    for (let i = 1; i < n; i++) along.push(along[i - 1] + len(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
    for (let i = 0; i < n; i++) {
      const R0 = W * C[i];
      acc = acc * decay + R0 * ds; norm = norm * decay + ds;
      if (i < 3 || i > n - 4) continue;
      const R1 = -R0 + 2.5 * acc / norm;
      const tx = pts[i + 1][0] - pts[i - 1][0], ty = pts[i + 1][1] - pts[i - 1][1], tl = Math.sqrt(tx * tx + ty * ty);
      if (tl < 1e-9) continue;
      const e = Math.min(along[i], along[n - 1] - along[i]) / (5 * W), anchor = e >= 1 ? 1 : e * e * (3 - 2 * e);
      let mx = (ty / tl) * R1 * rate * scale * anchor, my = (-tx / tl) * R1 * rate * scale * anchor;   // toward the outer bank
      const ml = Math.sqrt(mx * mx + my * my), cap = 0.35 * ds;
      if (ml > cap) { mx *= cap / ml; my *= cap / ml; }
      // A bend slows as it nears the belt, so it rounds off there instead of lying flat against a wall.
      const [nx, ny, d2] = nearest(drawn, pts[i][0], pts[i][1]);
      stood[i] = Math.sqrt(d2);
      if (d2 > 0 && mx * (pts[i][0] - nx) + my * (pts[i][1] - ny) > 0) {
        const f = Math.sqrt(d2) / (RIVER_BELT * W), g = f <= 0.6 ? 0 : f >= 0.97 ? 1 : (f - 0.6) / 0.37;
        const slow = 1 - g * g * (3 - 2 * g); mx *= slow; my *= slow;
      }
      next[i][0] += mx; next[i][1] += my;
    }
    for (let i = 1; i < n - 1; i++) {   // bank stiffness: no kinks
      next[i][0] += smooth * (pts[i - 1][0] + pts[i + 1][0] - 2 * pts[i][0]);
      next[i][1] += smooth * (pts[i - 1][1] + pts[i + 1][1] - 2 * pts[i][1]);
    }
    for (let i = 1; i < n - 1; i++) keep(next[i], stood[i]);
    pts = resample(next, ds);
    // Neck cutoffs: two points more than six samples apart along the river and closer than 1.1 widths across it. The loop between them becomes an oxbow.
    const cut = 1.1 * W * 1.1 * W;
    for (let i = 0; i < pts.length; i++) {
      for (let j = pts.length - 1; j > i + 6; j--) {
        const dx = pts[i][0] - pts[j][0], dy = pts[i][1] - pts[j][1];
        if (dx * dx + dy * dy < cut) {
          oxbows.push({pts: pts.slice(i + 2, j - 2), step: it});   // a plug of silt at each end: the oxbow does not touch the river
          pts = pts.slice(0, i + 1).concat(pts.slice(j));
          break;
        }
      }
    }
  }
  for (let i = 1; i < pts.length - 1; i++) keep(pts[i]);
  return {path: xy(pts), oxbows: oxbows.filter(o => o.pts.length >= 4).map(o => ({points: xy(o.pts), age: count ? 1 - o.step / count : 0})), drawn: xy(drawn), steps: count};
}

// A cheap fingerprint of a point list, so an edit made by hand (which leaves the stored drawn line stale) is told from a Wander change.
export const pointsSignature = points => { let s = 0; for (let i = 0; i < points.length; i++) s += points[i].x * (1 + (i % 7)) + points[i].y * (2 + (i % 5)); return Math.round(s * 64) / 64 + ':' + points.length; };

// The node carries params.river = {drawn, key, sig}: the line as drawn (so Wander, Width and a new seed can migrate it again), the inputs the stored path was
// built from, and its fingerprint. The migrated path itself is the node's points and paths (the main river first, then the oxbows).
// Returns true when the node's path changed.
export function applyRiver(node, bounds) {
  const q = node.params, rv = q?.river;
  if (!isRiver(q) || !rv?.drawn?.length) return false;
  const width = riverWidth(q), steps = riverSteps(q.wander), key = [Math.round(width * 8), steps, node.seed >>> 0].join('|');
  if (rv.key === key && rv.sig === pointsSignature(node.points)) return false;
  if (rv.sig !== undefined && rv.sig !== pointsSignature(node.points)) return false;   // edited by hand since: the stored path stays as it is
  const m = migrateRiver(rv.drawn, {width, steps, seed: node.seed >>> 0, bounds});
  const points = [...m.path], paths = [m.path.map((_, i) => i)];
  for (const o of m.oxbows) { paths.push(o.points.map((_, i) => points.length + i)); points.push(...o.points); }
  node.points = points;
  node.paths = paths.length > 1 ? paths : undefined;
  node.params = {...q, river: {...rv, key, sig: pointsSignature(points), ages: m.oxbows.map(o => Math.round(o.age * 1000) / 1000)}};
  return true;
}

// The curvature of a stored path times the channel width, at each vertex: the section's asymmetry reads it (engine-shape.wgsl riverChannel). The turn is measured
// between the points about half a width behind and ahead along the path (Menger curvature: 2 cross / (|ab| |bc| |ac|)), so a dense hand-drawn line and a sparse
// migrated one give the same answer, then smoothed once. Positive when the bend's centre lies on the side c > 0 of the shader's frame (right of the way drawn in
// the page's y-down frame, whichever way it is looked at: c = (wx - cx) uy - (wy - cy) ux). sqrt only.
export function riverCurvature(path, width) {
  const n = path.length, out = new Float64Array(n), cum = [0], h = width * 0.5;
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + len(path[i - 1].x, path[i - 1].y, path[i].x, path[i].y));
  for (let i = 1; i < n - 1; i++) {
    let a = i - 1, b = i + 1;
    while (a > 0 && cum[i] - cum[a] < h) a--;
    while (b < n - 1 && cum[b] - cum[i] < h) b++;
    const p = path[i], q = path[a], r = path[b], ux = p.x - q.x, uy = p.y - q.y, vx = r.x - p.x, vy = r.y - p.y, wx = r.x - q.x, wy = r.y - q.y;
    const den = len(0, 0, ux, uy) * len(0, 0, vx, vy) * len(0, 0, wx, wy);
    out[i] = den > 1e-9 ? -2 * (ux * vy - uy * vx) / den * width : 0;
  }
  if (n > 2) { out[0] = out[1]; out[n - 1] = out[n - 2]; }
  const c = Float64Array.from(out);
  for (let i = 1; i < n - 1; i++) out[i] = 0.25 * c[i - 1] + 0.5 * c[i] + 0.25 * c[i + 1];
  return out;
}
