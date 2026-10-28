// Flow bake, stage 1 (card F1; FLOW_BAKE.md): the current over the water of a
// region and the sediment colours it carries, to a steady state. Heights are
// never changed. Runs in a worker like the sand transport (sculpt-sand.js); the
// page sends the region's heights and the river and source strokes, and gets
// back five Int8 planes over the region (sculpt-flow-ui.js documents them).
//
// The method is the usual stable-fluids one, done once and to rest:
//  1. A wish field: the river strokes' directions (a Gaussian across each path,
//     tangent times strength) blended with the bed's own downhill direction.
//  2. A pressure projection on a staggered grid, so the flow is divergence-free:
//     land is a wall (no flux), the region's edge is open, and water therefore
//     parts around every island instead of running through it.
//  3. Each sediment colour is carried along that fixed field (semi-Lagrangian
//     advection, a little diffusion for mixing, a decay along the path for
//     settling) with the source dabs held at their amount, until the fields stop
//     changing: the steady state. No randomness and no clock: the same inputs
//     always give the same planes.
// Large regions are solved on a coarser grid (FLOW_BAKE "Performance") and
// sampled back up bilinearly; flows are smooth, so little is lost.
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

let cancelled = -1;
const yieldNow = () => new Promise(resolve => setTimeout(resolve, 0));

// Thin a polyline to points at least `gap` apart, keeping both ends.
function thin(points, gap) {
  if (points.length < 2) return points.slice();
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) if (Math.hypot(points[i][0] - out[out.length - 1][0], points[i][1] - out[out.length - 1][1]) >= gap) out.push(points[i]);
  out.push(points[points.length - 1]);
  return out;
}

// Mean over a disc-ish window of the water cells only (so the land's heights do
// not drown the bed's own slope): two box passes per axis of the masked mean.
function maskedBlur(values, water, cw, ch, radius) {
  const weight = Float32Array.from(water), a = new Float32Array(values.length), b = new Float32Array(values.length);
  for (let i = 0; i < a.length; i++) a[i] = water[i] ? values[i] : 0;
  const pass = (src, wsrc, dst, wdst, along, across, count, lines) => {
    for (let line = 0; line < lines; line++) {
      for (let k = 0; k < count; k++) {
        let s = 0, ws = 0;
        for (let o = -radius; o <= radius; o++) { const q = k + o; if (q < 0 || q >= count) continue; s += src[line * across + q * along]; ws += wsrc[line * across + q * along]; }
        dst[line * across + k * along] = s; wdst[line * across + k * along] = ws;
      }
    }
  };
  const wa = new Float32Array(values.length), wb = new Float32Array(values.length);
  pass(a, weight, b, wb, 1, cw, cw, ch);   // along x
  pass(b, wb, a, wa, cw, 1, ch, cw);       // along y
  const out = new Float32Array(values.length);
  for (let i = 0; i < out.length; i++) out[i] = water[i] && wa[i] > 0 ? a[i] / wa[i] : 0;
  return out;
}

async function bake(request, report) {
  const t0 = performance.now();
  const {grid, size, seaLevel, rect, settings, rivers, sources, heights, job} = request;
  const spacing = (size - 1) / (grid - 1);
  const w = rect.x1 - rect.x0 + 1, h = rect.y1 - rect.y0 + 1;
  const mix = clamp(settings.mix ?? .35, 0, 1), fade = Math.max(50, settings.fade ?? 1200), bedWeight = clamp(settings.bed ?? .3, 0, 1), reach = Math.max(0, settings.reach ?? 60);
  const maxSteps = Math.round(settings.steps ?? 900);
  // Coarse grid: about `cells` cells in all; the factor is a whole number of grid cells.
  const f = Math.max(1, Math.ceil(Math.sqrt(w * h / (settings.cells ?? 45000))));
  const cw = Math.ceil(w / f), ch = Math.ceil(h / f), n = cw * ch, cs = f * spacing;
  let bytes = heights.byteLength;
  const F32 = k => { bytes += k * 4; return new Float32Array(k); };
  const I32 = k => { bytes += k * 4; return new Int32Array(k); };
  const U8 = k => { bytes += k; return new Uint8Array(k); };
  const stats = {f, cw, ch, cellPx: cs};
  const tick = async (phase, fraction) => { report(phase, fraction); await yieldNow(); return cancelled === job; };

  // World px of coarse cell (i, j)'s centre, and the region cell it covers.
  const wx = i => (rect.x0 + i * f + (f - 1) / 2) * spacing, wy = j => (rect.y0 + j * f + (f - 1) / 2) * spacing;

  // Water: the block's mean height below the sea. Depth is kept for the bed's slope.
  const water = U8(n), depth = F32(n);
  for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
    let s = 0, c = 0;
    for (let y = j * f; y < Math.min(h, j * f + f); y++) for (let x = i * f; x < Math.min(w, i * f + f); x++) { s += heights[y * w + x]; c++; }
    const d = seaLevel - s / c; depth[j * cw + i] = d; water[j * cw + i] = d > .3 ? 1 : 0;
  }
  let waterCells = 0; for (let i = 0; i < n; i++) waterCells += water[i];
  stats.waterCells = waterCells;

  // 1. The wish field. Rivers: for each path, a Gaussian across it (sigma ~ 0.9 of the
  // half width) weights the tangents of its segments; where rivers overlap the vectors add.
  const ux = F32(n), uy = F32(n), wr = F32(n);
  for (const river of rivers) {
    const pts = thin(river.pts, Math.max(8, river.radius * .25));
    if (pts.length < 2) continue;
    const sigma = Math.max(cs, river.radius * .9), s = clamp(river.amount, 0, 1);
    const grow = sigma * 2.4;
    let ax = Infinity, ay = Infinity, bx = -Infinity, by = -Infinity;
    for (const p of pts) { ax = Math.min(ax, p[0]); ay = Math.min(ay, p[1]); bx = Math.max(bx, p[0]); by = Math.max(by, p[1]); }
    const i0 = clamp(Math.floor((ax - grow) / cs - rect.x0 / f), 0, cw - 1), i1 = clamp(Math.ceil((bx + grow) / cs - rect.x0 / f), 0, cw - 1);
    const j0 = clamp(Math.floor((ay - grow) / cs - rect.y0 / f), 0, ch - 1), j1 = clamp(Math.ceil((by + grow) / cs - rect.y0 / f), 0, ch - 1);
    const seg = [];
    for (let k = 0; k < pts.length - 1; k++) {
      const dx = pts[k + 1][0] - pts[k][0], dy = pts[k + 1][1] - pts[k][1], l = Math.hypot(dx, dy);
      if (l > 1e-6) seg.push([pts[k][0], pts[k][1], dx, dy, l, dx / l, dy / l]);
    }
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const c = j * cw + i; if (!water[c]) continue;
      const px = wx(i), py = wy(j);
      let vx = 0, vy = 0, g = 0;
      for (const [x, y, dx, dy, l, tx, ty] of seg) {
        const t = clamp(((px - x) * dx + (py - y) * dy) / (l * l), 0, 1), d = Math.hypot(px - x - dx * t, py - y - dy * t) / sigma, wgt = Math.exp(-1.2 * d * d);
        vx += wgt * tx; vy += wgt * ty; g += wgt;
      }
      const m = Math.hypot(vx, vy); if (m < 1e-6) continue;
      const k = Math.min(1, g);
      ux[c] += s * k * vx / m; uy[c] += s * k * vy / m; wr[c] += k;
    }
  }
  // The bed: the water's own depth, smoothed, and its slope toward deeper water; it
  // only fills in where no river speaks (weight 1 - river weight), at a speed that grows
  // with the slope and saturates.
  if (bedWeight > 0) {
    const sm = maskedBlur(depth, water, cw, ch, Math.max(2, Math.round(40 / cs)));
    for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
      const c = j * cw + i; if (!water[c]) continue;
      const at = (ii, jj) => { const q = jj * cw + ii; return ii >= 0 && jj >= 0 && ii < cw && jj < ch && water[q] ? sm[q] : sm[c]; };
      const gx = (at(i + 1, j) - at(i - 1, j)) / 2, gy = (at(i, j + 1) - at(i, j - 1)) / 2, m = Math.hypot(gx, gy);
      if (m < 1e-6) continue;
      const k = bedWeight * (1 - Math.min(1, wr[c])) * m / (m + .6);
      ux[c] += k * gx / m; uy[c] += k * gy / m;
    }
  }
  if (await tick('wish', .06)) return null;

  // 2. Projection on a staggered grid. Fx[j*(cw+1)+i] is the flux through the face left of cell
  // (i, j); a face is open when the cells on both sides are water, or when a water cell is at the
  // region's edge (open to the outside, where the pressure is 0).
  const Fx = F32((cw + 1) * ch), Fy = F32(cw * (ch + 1));
  const wat = (i, j) => i >= 0 && j >= 0 && i < cw && j < ch && water[j * cw + i] === 1;
  for (let j = 0; j < ch; j++) for (let i = 0; i <= cw; i++) {
    const L = wat(i - 1, j), R = wat(i, j);
    if (i > 0 && i < cw) { if (L && R) Fx[j * (cw + 1) + i] = .5 * (ux[j * cw + i - 1] + ux[j * cw + i]); }
    else if (i === 0 && R) Fx[j * (cw + 1)] = ux[j * cw];
    else if (i === cw && L) Fx[j * (cw + 1) + cw] = ux[j * cw + cw - 1];
  }
  for (let j = 0; j <= ch; j++) for (let i = 0; i < cw; i++) {
    const T = wat(i, j - 1), B = wat(i, j);
    if (j > 0 && j < ch) { if (T && B) Fy[j * cw + i] = .5 * (uy[(j - 1) * cw + i] + uy[j * cw + i]); }
    else if (j === 0 && B) Fy[i] = uy[i];
    else if (j === ch && T) Fy[ch * cw + i] = uy[(ch - 1) * cw + i];
  }
  // Pressure: deg p - sum of water neighbours' p = -divergence (SPD; the small shift keeps a pond
  // with no open edge solvable). Jacobi-preconditioned conjugate gradients.
  const rhs = F32(n), deg = F32(n), p = F32(n), r = F32(n), z = F32(n), dir = F32(n), Ap = F32(n);
  for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
    const c = j * cw + i; if (!water[c]) continue;
    rhs[c] = -(Fx[j * (cw + 1) + i + 1] - Fx[j * (cw + 1) + i] + Fy[(j + 1) * cw + i] - Fy[j * cw + i]);
    deg[c] = 1e-4 + (i > 0 ? wat(i - 1, j) : 1) + (i < cw - 1 ? wat(i + 1, j) : 1) + (j > 0 ? wat(i, j - 1) : 1) + (j < ch - 1 ? wat(i, j + 1) : 1);
  }
  const apply = (x, out) => {
    for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
      const c = j * cw + i; if (!water[c]) { out[c] = 0; continue; }
      let s = deg[c] * x[c];
      if (i > 0 && water[c - 1]) s -= x[c - 1]; if (i < cw - 1 && water[c + 1]) s -= x[c + 1];
      if (j > 0 && water[c - cw]) s -= x[c - cw]; if (j < ch - 1 && water[c + cw]) s -= x[c + cw];
      out[c] = s;
    }
  };
  let rz = 0, rhsNorm = 0;
  for (let c = 0; c < n; c++) { r[c] = rhs[c]; z[c] = water[c] ? r[c] / deg[c] : 0; dir[c] = z[c]; rz += r[c] * z[c]; rhsNorm += r[c] * r[c]; }
  rhsNorm = Math.sqrt(rhsNorm);
  let iterations = 0;
  for (; iterations < 600 && rhsNorm > 0; iterations++) {
    apply(dir, Ap);
    let dAp = 0; for (let c = 0; c < n; c++) dAp += dir[c] * Ap[c];
    if (!(dAp > 0)) break;
    const alpha = rz / dAp; let rr = 0;
    for (let c = 0; c < n; c++) { p[c] += alpha * dir[c]; r[c] -= alpha * Ap[c]; rr += r[c] * r[c]; }
    if (Math.sqrt(rr) < 1e-4 * rhsNorm) { iterations++; break; }
    let rzNew = 0; for (let c = 0; c < n; c++) { z[c] = water[c] ? r[c] / deg[c] : 0; rzNew += r[c] * z[c]; }
    const beta = rzNew / rz; rz = rzNew;
    for (let c = 0; c < n; c++) dir[c] = z[c] + beta * dir[c];
    if ((iterations & 31) === 31 && await tick('project', .06 + .1 * Math.min(1, iterations / 400))) return null;
  }
  stats.pressureIterations = iterations;
  // Subtract the pressure's gradient from every open face, then average faces to cell velocity.
  for (let j = 0; j < ch; j++) for (let i = 0; i <= cw; i++) {
    const L = wat(i - 1, j), R = wat(i, j), k = j * (cw + 1) + i;
    if (L && R) Fx[k] -= p[j * cw + i] - p[j * cw + i - 1];
    else if (R && i === 0) Fx[k] -= p[j * cw];
    else if (L && i === cw) Fx[k] += p[j * cw + cw - 1];
  }
  for (let j = 0; j <= ch; j++) for (let i = 0; i < cw; i++) {
    const T = wat(i, j - 1), B = wat(i, j), k = j * cw + i;
    if (T && B) Fy[k] -= p[j * cw + i] - p[(j - 1) * cw + i];
    else if (B && j === 0) Fy[k] -= p[i];
    else if (T && j === ch) Fy[k] += p[(ch - 1) * cw + i];
  }
  const speeds = F32(waterCells); let sc = 0;
  for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
    const c = j * cw + i; if (!water[c]) { ux[c] = uy[c] = 0; continue; }
    ux[c] = .5 * (Fx[j * (cw + 1) + i] + Fx[j * (cw + 1) + i + 1]); uy[c] = .5 * (Fy[j * cw + i] + Fy[(j + 1) * cw + i]);
    speeds[sc++] = Math.hypot(ux[c], uy[c]);
  }
  // Normalise so the 98th percentile of the water's speed is 1 (cells per step of the transport below).
  speeds.sort(); const ref = sc ? speeds[Math.min(sc - 1, Math.floor(sc * .98))] : 0;
  stats.referenceSpeed = ref;
  if (!(ref > 1e-9)) {
    // No current anywhere: nothing to carry. Every plane stays empty.
    const empty = () => new Int8Array(w * h);
    return {planes: [empty(), empty(), empty(), empty(), empty()], colors: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], stats: {...stats, ms: performance.now() - t0, bytes, steps: [0, 0, 0]}};
  }
  let maxSpeed = 0;
  for (let c = 0; c < n; c++) { ux[c] /= ref; uy[c] /= ref; const m = Math.hypot(ux[c], uy[c]); if (m > 1.5) { ux[c] *= 1.5 / m; uy[c] *= 1.5 / m; } maxSpeed = Math.max(maxSpeed, Math.min(1.5, m)); }
  const dt = .8 / Math.max(1, maxSpeed);
  if (await tick('project', .17)) return null;

  // 3. Transport. The velocity is fixed, so the advection's four source cells and weights are
  // computed once per cell. A corner on land is dropped and the rest renormalised (the colour
  // follows the wall); a corner outside the region brings in clean water (concentration 0).
  const src = I32(4 * n), wgt = F32(4 * n), still = F32(n);
  for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
    const c = j * cw + i; if (!water[c]) continue;
    // Settling: the decay along the path moved this step (a little water still settles too).
    still[c] = Math.exp(-Math.max(.12, Math.hypot(ux[c], uy[c])) * dt * cs / fade);
    const x = i - ux[c] * dt, y = j - uy[c] * dt, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    let total = 0;
    for (let k = 0; k < 4; k++) {
      const ci = x0 + (k & 1), cj = y0 + (k >> 1), wk = ((k & 1) ? fx : 1 - fx) * ((k >> 1) ? fy : 1 - fy);
      const inside = ci >= 0 && cj >= 0 && ci < cw && cj < ch;
      if (inside && !water[cj * cw + ci]) { wgt[4 * c + k] = 0; src[4 * c + k] = -1; continue; }
      src[4 * c + k] = inside ? cj * cw + ci : -1; wgt[4 * c + k] = wk; total += wk;
    }
    if (total < 1e-6) { src[4 * c] = c; wgt[4 * c] = 1; for (let k = 1; k < 4; k++) wgt[4 * c + k] = 0; continue; }
    for (let k = 0; k < 4; k++) wgt[4 * c + k] /= total;
  }
  const diffusion = .22 * mix;
  const nb = I32(4 * n); // water neighbours, -1 for none (a wall, or the region's edge: no flux)
  for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
    const c = j * cw + i; if (!water[c]) continue;
    nb[4 * c] = i > 0 && water[c - 1] ? c - 1 : -1; nb[4 * c + 1] = i < cw - 1 && water[c + 1] ? c + 1 : -1;
    nb[4 * c + 2] = j > 0 && water[c - cw] ? c - cw : -1; nb[4 * c + 3] = j < ch - 1 && water[c + cw] ? c + cw : -1;
  }
  // Sources: each dab path holds its slot's concentration inside it, falling off over its outer half.
  const used = [false, false, false];
  const slotFields = [F32(n), F32(n), F32(n)];
  for (const source of sources) {
    const slot = clamp(source.slot | 0, 0, 2); used[slot] = true;
    const pts = source.pts.length > 1 ? thin(source.pts, Math.max(4, source.radius * .3)) : source.pts, rad = Math.max(cs, source.radius), S = slotFields[slot];
    for (let k = 0; k < Math.max(1, pts.length - 1); k++) {
      const a = pts[k], b = pts[Math.min(k + 1, pts.length - 1)], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
      const i0 = clamp(Math.floor((Math.min(a[0], b[0]) - rad - cs) / cs - rect.x0 / f), 0, cw - 1), i1 = clamp(Math.ceil((Math.max(a[0], b[0]) + rad + cs) / cs - rect.x0 / f), 0, cw - 1);
      const j0 = clamp(Math.floor((Math.min(a[1], b[1]) - rad - cs) / cs - rect.y0 / f), 0, ch - 1), j1 = clamp(Math.ceil((Math.max(a[1], b[1]) + rad + cs) / cs - rect.y0 / f), 0, ch - 1);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const c = j * cw + i; if (!water[c]) continue;
        const t = l2 ? clamp(((wx(i) - a[0]) * dx + (wy(j) - a[1]) * dy) / l2, 0, 1) : 0, d = Math.hypot(wx(i) - a[0] - dx * t, wy(j) - a[1] - dy * t) / rad;
        const v = clamp(source.amount, 0, 1) * (1 - smooth(.5, 1, d));
        if (v > S[c]) S[c] = v;
      }
    }
  }
  const conc = [null, null, null], steps = [0, 0, 0];
  for (let slot = 0; slot < 3; slot++) {
    if (!used[slot]) continue;
    let a = F32(n), b = F32(n); const S = slotFields[slot];
    for (let c = 0; c < n; c++) a[c] = S[c];
    let step = 0;
    for (; step < maxSteps; step++) {
      let change = 0;
      for (let c = 0; c < n; c++) {
        if (!water[c]) continue;
        // advect, then mix with the water neighbours, then settle, then hold the sources
        let v = 0; const o = 4 * c;
        for (let k = 0; k < 4; k++) { const q = src[o + k]; if (q >= 0) v += wgt[o + k] * a[q]; }
        let d = 0; for (let k = 0; k < 4; k++) { const q = nb[o + k]; if (q >= 0) d += a[q] - a[c]; }
        // diffusion acts on the advected value's neighbourhood through the previous field: a split step
        v = (v + diffusion * d) * still[c];
        if (S[c] > v) v = S[c];
        if (v < 0) v = 0;
        const dv = Math.abs(v - a[c]); if (dv > change) change = dv;
        b[c] = v;
      }
      [a, b] = [b, a];
      if (step >= 24 && change < 8e-4) { step++; break; }
      if ((step & 15) === 15 && await tick('carry', .17 + .73 * ((slot + Math.min(1, step / maxSteps)) / Math.max(1, used.filter(Boolean).length)))) return null;
    }
    steps[slot] = step; conc[slot] = a;
  }
  stats.steps = steps;

  // 4. Out to the region's grid: stretch each field into the land by the bank reach (the planes carry
  // the stain the shader tints banks from), then sample bilinearly at every region cell. The flow gets
  // two cells so pixels at the shoreline still read the current.
  const extend = (field, cells, ramp) => {
    const out = Float32Array.from(field), raw = Float32Array.from(field), layer = new Int16Array(n);
    for (let c = 0; c < n; c++) layer[c] = water[c] ? 0 : -1;
    for (let e = 1; e <= cells; e++) {
      const fresh = [];
      for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
        const c = j * cw + i; if (layer[c] !== -1) continue;
        let s = 0, k = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const ii = i + di, jj = j + dj; if (!di && !dj || ii < 0 || jj < 0 || ii >= cw || jj >= ch) continue;
          if (layer[jj * cw + ii] === e - 1 && (e > 1 || water[jj * cw + ii])) { s += raw[jj * cw + ii]; k++; }
        }
        if (k) { raw[c] = s / k; out[c] = ramp ? raw[c] * (1 - (e - 1) / cells) : raw[c]; fresh.push(c); }
      }
      for (const c of fresh) layer[c] = e;
    }
    return out;
  };
  const reachCells = Math.ceil(reach / cs);
  const planesCoarse = [extend(ux, 2, false), extend(uy, 2, false)];
  for (let slot = 0; slot < 3; slot++) planesCoarse.push(conc[slot] ? (reachCells > 0 ? extend(conc[slot], reachCells, true) : conc[slot]) : null);
  // Fade to nothing over the last cells of any edge of the region that is not the map's own edge, so a
  // small bake does not end in a straight line.
  const taper = 20, edge = {l: rect.x0 > 0, r: rect.x1 < grid - 1, t: rect.y0 > 0, b: rect.y1 < grid - 1};
  const planes = [0, 1, 2, 3, 4].map(() => new Int8Array(w * h));
  const sample = (field, gx, gy) => {
    const x0 = clamp(Math.floor(gx), 0, cw - 1), y0 = clamp(Math.floor(gy), 0, ch - 1), x1 = Math.min(cw - 1, x0 + 1), y1 = Math.min(ch - 1, y0 + 1), fx = clamp(gx - x0, 0, 1), fy = clamp(gy - y0, 0, 1);
    return (field[y0 * cw + x0] * (1 - fx) + field[y0 * cw + x1] * fx) * (1 - fy) + (field[y1 * cw + x0] * (1 - fx) + field[y1 * cw + x1] * fx) * fy;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = (x + .5) / f - .5, gy = (y + .5) / f - .5;
      const edgeDistance = Math.min(edge.l ? x : 1e9, edge.r ? w - 1 - x : 1e9, edge.t ? y : 1e9, edge.b ? h - 1 - y : 1e9);
      const fadeOut = edgeDistance >= taper ? 1 : smooth(0, taper, edgeDistance);
      const vx = sample(planesCoarse[0], gx, gy), vy = sample(planesCoarse[1], gx, gy), m = Math.hypot(vx, vy), k = y * w + x;
      if (m > 1e-4) { const s = Math.sqrt(Math.min(1, m) * fadeOut) / m; planes[0][k] = Math.round(clamp(vx * s, -1, 1) * 127); planes[1][k] = Math.round(clamp(vy * s, -1, 1) * 127); }
      for (let slot = 0; slot < 3; slot++) { const field = planesCoarse[2 + slot]; if (field) planes[2 + slot][k] = Math.round(clamp(sample(field, gx, gy) * fadeOut, 0, 1) * 127); }
    }
    if ((y & 31) === 31 && await tick('out', .9 + .1 * y / h)) return null;
  }
  bytes += planes.length * w * h;
  stats.ms = performance.now() - t0; stats.bytes = bytes; stats.slots = used.filter(Boolean).length;
  return {planes, colors: [], stats};
}

self.onmessage = async event => {
  const m = event.data;
  if (m.cancel) { cancelled = m.job; return; }
  const report = (phase, fraction) => self.postMessage({job: m.job, progress: fraction, phase});
  try {
    const result = await bake(m, report);
    if (!result) { self.postMessage({job: m.job, cancelled: true}); return; }
    self.postMessage({job: m.job, done: true, planes: result.planes, stats: result.stats}, result.planes.map(p => p.buffer));
  } catch (err) { self.postMessage({job: m.job, error: String(err?.stack || err)}); }
};
