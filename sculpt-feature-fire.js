// Fire for the feature generator (sculpt-feature-gen.js): the tree and shrub burn sequences, built as a simulation of rising
// hot gas instead of per-frame flame shapes. Plain ES module, no dependencies; the simulation uses only + - * / and
// Math.floor, so it gives the same bytes in Node and in the browser. Palette indices are the game's (flame 192-216).
//
// What retail does (measured frame by frame on Tree1, Tree4 and Shrub1, 2 game ticks = 66.7 ms per frame):
// - One flame column stands on a small flat foot at the trunk (7 columns at ignition, about 20 when burning). Its top grows
//   4-11 px/frame, then its upper part pinches off as a puff that rises on, shrinks, reddens and breaks into fragments and
//   sparks within 1-3 frames, and the column refills from below: about one pulse every 7-14 frames.
// - The gas inside rises faster with height: about 2 px/frame at the foot, 2-4 at 20-40 px up, 5-7 at 40-60 px.
// - Flames burn in front of the crown (the column covers crown pixels) and behind it (seen through the charred crown's gaps,
//   beside it and above its top), alternating: when the column is short the flames behind show.
// - Lead-in: the fire starts on the ground at the trunk and the burning climbs about 7 px/frame; one cut to the charred crown
//   at frame 9; burn-out: the crown is consumed and the fire fills the tree, then it shrinks and lifts off the ground onto the
//   trunk; the last frame is the burnt successor with embers on it.
// So the fire is a heat field advected upward with a speed that grows with height, cooled by a lumpy field that rides up with
// the gas (cool pockets cut tongues and pinch off puffs), fed by sources that pulse and follow the burn. Two layers: the
// column in front of the crown and the crown's own flames behind it, pulsing out of phase. Heat maps to the flame ramp by
// hard bands; a second field riding with the gas splits the hot core between the pale (193-196) and the pure yellow (208-209)
// ramp, so the core reads as 2-6 px patches.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = t => t * t * (3 - 2 * t);

// ---- random numbers (the same generators as sculpt-feature-gen.js) --------------------------------------------------
function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const mix32 = (a, b) => { let n = Math.imul(a ^ 0x9E3779B9, 0x85EBCA6B) ^ Math.imul(b + 0x7F4A7C15, 0xC2B2AE35); n = Math.imul(n ^ (n >>> 15), 0x2C1B3C6D); return (n ^ (n >>> 13)) >>> 0; };
const hash2 = (x, y, s) => { let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2246822519); n = Math.imul(n ^ (n >>> 13), 1274126177); n ^= n >>> 16; return (n >>> 0) / 4294967296; };
function weighted(r, table) { let sum = 0; for (const [, w] of table) sum += w; let x = r() * sum; for (const [v, w] of table) { x -= w; if (x < 0) return v; } return table[table.length - 1][0]; }
const noise2 = (x, y, s) => { const i = Math.floor(x), j = Math.floor(y), u = smooth(x - i), v = smooth(y - j), a = hash2(i, j, s), b = hash2(i + 1, j, s), c = hash2(i, j + 1, s), d = hash2(i + 1, j + 1, s); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; };
const noise1 = (x, s) => { const i = Math.floor(x), f = smooth(x - i), a = hash2(i, 0, s); return a + (hash2(i + 1, 0, s) - a) * f; };

// ---- sprites ({w,h,ax,ay,idx,a}, as in sculpt-feature-gen.js) -------------------------------------------------------
const newSprite = (w, h, ax, ay) => ({ w, h, ax, ay, idx: new Uint8Array(w * h), a: new Uint8Array(w * h) });
const cloneSprite = s => ({ ...s, idx: s.idx.slice(), a: s.a.slice() });
function put(s, x, y, i) { if (x < 0 || y < 0 || x >= s.w || y >= s.h) return; const k = y * s.w + x; s.idx[k] = i; s.a[k] = 1; }
function cropSprite(s) {
  let x0 = s.w, y0 = s.h, x1 = -1, y1 = -1;
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) if (s.a[y * s.w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return newSprite(1, 1, 0, 0);
  const o = newSprite(x1 - x0 + 1, y1 - y0 + 1, s.ax - x0, s.ay - y0);
  for (let y = 0; y < o.h; y++) for (let x = 0; x < o.w; x++) { const k = (y + y0) * s.w + x + x0; o.idx[y * o.w + x] = s.idx[k]; o.a[y * o.w + x] = s.a[k]; }
  return o;
}
export const isFlameIndex = i => i >= 192 && i <= 216;

// ---- the gas -------------------------------------------------------------------------------------------------------
// A smooth value-noise table over (x, gas time). Gas time tau = t - T(y), where T(y) is the time the gas needs to rise from
// the ground to row y; tau is constant along a rising parcel, so a field read at tau rides up with the gas (and stretches
// as the gas accelerates), at the cost of one table lookup.
function gasTable(w, n, cellX, cellT, seed) {
  const gx = Math.ceil(w / cellX) + 2, gt = Math.ceil(n / cellT) + 2, g = new Float32Array(gx * gt), out = new Float32Array(w * n);
  for (let i = 0; i < g.length; i++) g[i] = hash2(i % gx, (i / gx) | 0, seed);
  for (let t = 0; t < n; t++) for (let x = 0; x < w; x++) {
    const fx = x / cellX, ft = t / cellT, ix = Math.floor(fx), it = Math.floor(ft), u = smooth(fx - ix), v = smooth(ft - it);
    const a = g[it * gx + ix], b = g[it * gx + ix + 1], c = g[(it + 1) * gx + ix], d = g[(it + 1) * gx + ix + 1];
    out[t * w + x] = a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  // equalize: values spread evenly over 0..1 (smooth noise crowds the middle), so a threshold on it is a share of the area
  const hist = new Float64Array(257);
  for (let i = 0; i < out.length; i++) hist[Math.floor(out[i] * 256)]++;
  for (let i = 1; i < 257; i++) hist[i] += hist[i - 1];
  for (let i = 0; i < out.length; i++) { const q = out[i] * 256, j = Math.floor(q), lo = j ? hist[j - 1] : 0; out[i] = (lo + (hist[j] - lo) * (q - j)) / out.length; }
  return out;
}

const SUB = 2;                       // simulation steps per frame
const TAU_RES = 2;                   // gas-table rows per frame of gas time
// One layer of fire: heat H (0 cold .. about 1 in the burning fuel) on the sprite canvas, stepped SUB times per frame.
// P (px, frames): rise speed v0 at the ground, v1 from hAcc up, easing to v2 over hSlow above that; buoy0/buoy1 (hot gas rises
// faster), lift/liftX/liftT (threads of gas that rise faster); turb/turbX/turbT and jitter (sideways churn, more higher up);
// cooling: cool everywhere, coolLow more for gas that has cooled, coolTop above the tree (from topFrom over topRamp), grain at
// random, pockets (lump, pocket threshold, lumpX/lumpT size) and cold bands (band threshold, bandX/bandT, from bandFrom over
// bandRamp; cut(x, emission time) adds the fuel pulse's dips), erode (cold air eating the edges), diffuse (sideways mixing);
// fuel: hole/holeUp (share of fuel cells not burning at the foot and above it), fuelX/fuelT (their size), inject (heat per
// frame from burning fuel above the foot), cap; frames (length of the run).
function makeLayer(w, h, ay, P, seed) {
  const H = new Float32Array(w * h), N = new Float32Array(w * h), vRow = new Float32Array(h), tRow = new Float32Array(h), turbRow = new Float32Array(h), pocketRow = new Float32Array(h), bandRow = new Float32Array(h);
  for (let y = 0; y < h; y++) {   // the gas speeds up as it rises, slows again once it has mixed above the flame, and churns more as it rises
    const up = ay - y, u = clamp(up / P.hAcc, 0, 1), o = clamp((up - P.hAcc) / P.hSlow, 0, 1);
    vRow[y] = P.v0 + (P.v1 - P.v0) * smooth(u) - (P.v1 - P.v2) * smooth(o); turbRow[y] = P.turb * (0.6 + 0.65 * u + 0.5 * o);
    pocketRow[y] = P.lump * (0.2 + 0.8 * smooth(u));   // the burning body near the ground stays whole; the cold cuts it higher up
    bandRow[y] = P.lump * smooth(clamp((up - P.bandFrom) / P.bandRamp, 0, 1));
  }
  // gas time: the fields that ride with the gas move at the speed of its hot core (buoyancy included), so a cold band
  // travels with the flame it cuts instead of standing in its way as a flat ceiling
  const hot = P.buoy0 + P.buoy1 * 0.85; tRow[h - 1] = 0; for (let y = h - 2; y >= 0; y--) tRow[y] = tRow[y + 1] + 1 / (vRow[y] * hot);
  const tauOff = tRow[0] + 8, nTau = Math.ceil((P.frames + tauOff + 8) * TAU_RES);
  const cool1 = gasTable(w, nTau, P.bandX, P.bandT * TAU_RES, mix32(seed, 1)), cool2 = gasTable(w, nTau, P.lumpX, P.lumpT * TAU_RES, mix32(seed, 2));   // wide cold bands that sever the column, small pockets that notch it
  // the gas that left the fire during a dip of the fuel pulse is a cold band: it rides up and cuts the column there (a puff
  // pinches off above it and the column refills from below); P.cut(x, emission time) gives 0..1
  if (P.cut) for (let i = 0; i < nTau; i++) for (let x = 0; x < w; x++) { const k = i * w + x; cool1[k] = Math.max(cool1[k] * P.bandMix, P.cut(x, i / TAU_RES - tauOff)); }
  const sj = mix32(seed, 7) & 0xffffff, tex = gasTable(w, nTau, 1.6, 1.0 * TAU_RES, mix32(seed, 3)), flick = gasTable(w, nTau, P.fuelX, P.fuelT * TAU_RES, mix32(seed, 4));
  const turb = gasTable(w, nTau, P.turbX, P.turbT * TAU_RES, mix32(seed, 5)), lift = gasTable(w, nTau, P.liftX, P.liftT * TAU_RES, mix32(seed, 6));
  const gas = (tab, x, y, t) => { const q = (t - tRow[y] + tauOff) * TAU_RES, i = Math.floor(q), f = q - i, k = i * w + x; return tab[k] + (tab[k + w] - tab[k]) * f; };
  const layer = {
    H, w, h, vRow,
    // one step of dt frames ending at time t: advect up (and sideways by sway[y] px/frame), cool, mix sideways, feed sources
    step(t, sway, src, extra = 0) {
      const dt = 1 / SUB, b = P.diffuse;
      for (let y = 0; y < h; y++) {
        const u = sway[y] * dt, tau = (t - tRow[y] + tauOff) * TAU_RES, ti = Math.floor(tau), tf = tau - ti;
        for (let x = 0; x < w; x++) {
          // hot gas rises faster than the cooler gas around it: tongues shoot up from the core and their edges curl back
          // and some threads of gas rise faster than their neighbors: the top breaks into tongues of different heights
          const kl = ti * w + x, lf = lift[kl] + (lift[kl + w] - lift[kl]) * tf;
          const vy = vRow[y] * (P.buoy0 + P.buoy1 * H[y * w + x]) * (1 - P.lift + 2 * P.lift * lf) * dt;
          const kt = ti * w + x, tu = turb[kt] + (turb[kt + w] - turb[kt]) * tf;
          const ux = u + (2 * tu - 1) * turbRow[y] * dt + (hash2(x, y, sj + ((t * 613) | 0)) - 0.5) * P.jitter;
          // whole cells move, rounded at random (no interpolation: it would blur the lumps away step by step)
          const sy = y + Math.floor(vy + hash2(x, y, sj + ((t * 389) | 0))), sx = x - Math.floor(ux + hash2(x, y, sj + ((t * 211) | 0)));
          let v = sy < h && sx >= 0 && sx < w ? H[sy * w + sx] : 0;
          if (v > 0) {
            const k = ti * w + x, k1 = cool1[k] + (cool1[k + w] - cool1[k]) * tf, k2 = cool2[k] + (cool2[k + w] - cool2[k]) * tf;
            const band = clamp((k1 - P.band) / (1 - P.band), 0, 1), pocket = clamp((k2 - P.pocket) / (1 - P.pocket), 0, 1);   // a cold band, a pocket
            // above the tree the mixing air quenches what is left within a few frames, higher for the threads that rise fastest
            const top = P.coolTop * smooth(clamp((ay - y - P.topFrom - P.topVar * (lf - 0.5)) / P.topRamp, 0, 1));
            v -= dt * (P.cool + top + extra * vRow[y] / P.v1 + P.coolLow * (v < 1 ? 1 - v : 0) + pocketRow[y] * pocket * pocket + bandRow[y] * band + P.grain * hash2(x, y, sj + ((t * 977) | 0)));   // a hot core rises intact; once a parcel has cooled it is soon gone
          }
          N[y * w + x] = v > 0 ? v : 0;
        }
      }
      for (let y = 0; y < h; y++) {
        const r = y * w;
        for (let x = 0; x < w; x++) {
          const k = r + x, n = N[k]; if (n === 0 && (x === 0 || N[k - 1] === 0) && (x === w - 1 || N[k + 1] === 0)) { H[k] = 0; continue; }
          const l = x > 0 ? N[k - 1] : 0, rr = x < w - 1 ? N[k + 1] : 0, m4 = (l + rr + (y > 0 ? N[k - w] : 0) + (y < h - 1 ? N[k + w] : 0)) / 4;
          // mix sideways a little; and cold air eats the flame from its edges, so puffs shrink and columns narrow into tongues
          const v = n * (1 - 2 * b) + b * (l + rr) - dt * P.erode * (n > m4 ? n - m4 : 0);
          H[k] = v > 0 ? v : 0;
        }
      }
      for (let i = 0; i < src.n; i++) {
        const k = src.k[i], x = k % w, y = (k / w) | 0, f = gas(flick, x, y, t);
        if (f < (src.add[i] ? P.holeUp : P.hole)) continue;   // patchy fuel: holes in the foot where the ground shows through, fewer higher up
        const s = src.s[i] * (0.7 + 0.45 * clamp((f - P.hole) / (1 - P.hole), 0, 1));
        if (src.add[i]) { const v = H[k] + s * P.inject * dt; H[k] = v < P.cap ? v : P.cap; }   // burning fuel heats the gas passing through
        else if (H[k] < s) H[k] = s;                                                              // the foot holds its heat
      }
    },
    texture: (x, y, t) => gas(tex, x, y, t),
  };
  return layer;
}
// A source list: cell index, strength and mode: held (the cell is kept at least this hot: the foot) or added (burning fuel
// heats the gas passing through, so a dip in the fuel leaves a cold band in the rising gas).
const sources = () => ({ k: [], s: [], add: [], n: 0, put(k, s, add = false) { if (s > 0.01) { this.k.push(k); this.s.push(s); this.add.push(add); this.n++; } } });

// ---- heat to color ---------------------------------------------------------------------------------------------------
// Bands from hot to cool with their share of fire pixels, and the indices inside each band picked by the core texture (so a
// band shows as patches of one index). Shares follow retail's measured index shares (208 22%, 195 13%, 210 12%, 209 10%,
// 194 7%, 200 5%, 197 5%, 211 4%, 193 4%, 196 4%, 198 3.5%, 205 3%; rim red, core pale and yellow).
const BANDS = [
  [11, [[193, 3.0], [194, 2.4], [208, 5.2], [192, 0.4]]],     // the core: pale and pure yellow about half and half
  [15, [[194, 3.0], [195, 5.0], [208, 7.0]]],
  [16, [[195, 6.0], [208, 6.4], [196, 2.0], [209, 1.6]]],
  [13, [[208, 3.6], [209, 4.0], [196, 2.0], [195, 2.0], [197, 1.4]]],
  [12, [[209, 3.4], [197, 3.6], [210, 3.8], [194, 1.2]]],
  [12, [[210, 6.0], [198, 3.4], [199, 2.0], [211, 0.6]]],
  [11, [[210, 2.2], [211, 3.6], [200, 3.6], [201, 0.6], [202, 0.6]]],
  [10, [[200, 1.6], [203, 1.9], [204, 1.5], [205, 3.0], [206, 0.6], [212, 0.6], [213, 0.4], [207, 0.4]]],
];
function bandColor(band, q) {
  const list = BANDS[band][1]; let sum = 0; for (const [, w] of list) sum += w;
  let x = q * sum; for (const [i, w] of list) { x -= w; if (x < 0) return i; }
  return list[list.length - 1][0];
}
// A flame's color follows its heat and how deep inside the flame a pixel is: the rim is orange and red and the inside of
// even a small puff is yellow (retail: 36% of rim pixels are red or dark red, about 2% of the pixels 3 px or more inside).
// field(): the fire mask (heat above T0, the threshold jittered per pixel so the rim is torn, not traced) and per fire pixel
// the heat less a rim penalty; -9 where there is no fire. A few pixels inside get a cooler speck.
const RIM = [0.2, 0.08];
function flameField(heat, w, h, T0, f, seed) {
  const m = new Uint8Array(w * h), e = new Float32Array(w * h).fill(-9);
  for (let k = 0; k < heat.length; k++) if (heat[k] + (hash2(k % w, (k / w) | 0, seed + f * 7919) - 0.5) * 0.08 > T0) m[k] = 1;
  const edge = k => { const x = k % w; return (x === 0 || !m[k - 1]) || (x === w - 1 || !m[k + 1]) || k < w || !m[k - w] || k >= w * (h - 1) || !m[k + w]; };
  const d1 = new Uint8Array(w * h);
  for (let k = 0; k < m.length; k++) if (m[k] && edge(k)) d1[k] = 1;
  for (let k = 0; k < m.length; k++) {
    if (!m[k]) continue;
    const x = k % w, y = (k / w) | 0, near = d1[k] ? 0 : (x > 0 && d1[k - 1]) || (x < w - 1 && d1[k + 1]) || (y > 0 && d1[k - w]) || (y < h - 1 && d1[k + w]);
    e[k] = heat[k] - (d1[k] ? RIM[0] : near ? RIM[1] : 0) - (hash2(x, y, seed + 57 + f * 15485863) < 0.25 ? 0.12 : 0);
  }
  return e;
}
// Thresholds between the bands: quantiles of the field over the fire pixels of the given frames, so the bands hold their shares.
function bandThresholds(fields) {
  const N = 2048, hist = new Float64Array(N), at = v => Math.max(0, Math.min(N - 1, Math.floor((v + 0.6) * 1000))); let n = 0;
  for (const e of fields) for (let k = 0; k < e.length; k++) if (e[k] > -9) { hist[at(e[k])]++; n++; }
  const th = []; let acc = 0, want = 0, bi = 0;
  for (let b = 0; b < BANDS.length - 1; b++) {
    want += BANDS[b][0] / 100 * n;
    while (bi < N - 1 && acc + hist[N - 1 - bi] < want) { acc += hist[N - 1 - bi]; bi++; }
    th.push((N - 1 - bi) / 1000 - 0.6);
  }
  return th;   // th[b]: field value above which a pixel is band b or hotter
}
function paintFire(cv, e, tex, th, f, seed) {
  const w = cv.w;
  for (let k = 0; k < e.length; k++) {
    if (e[k] <= -9) continue;
    let b = 0; while (b < th.length && e[k] < th[b]) b++;
    const q = clamp(tex[k] + (hash2(k % w, (k / w) | 0, seed + 31 + f * 104729) - 0.5) * 0.8, 0, 0.999);
    cv.idx[k] = bandColor(b, q); cv.a[k] = 1;
  }
}
const SPARK_COLORS = [[205, 29], [208, 14], [200, 10], [210, 9], [203, 6], [209, 6], [211, 5], [204, 5], [194, 4], [197, 4]];

// ---- the burn driver ---------------------------------------------------------------------------------------------------
// Runs the layers over the whole sequence and returns per frame the heat snapshots and the core texture.
// plan(f) gives, for the frame f (a time, fractional between frames), {front, back} source lists and the sway per row.
function runFire(layers, plan, f0, nFrames) {
  const snaps = layers.map(() => []), texs = layers.map(() => []);
  for (let f = f0; f < nFrames; f++) {
    for (let s = 1; s <= SUB; s++) {
      const t = f - 1 + s / SUB, p = plan(t);
      layers.forEach((L, i) => L.step(t, p.sway, p.src[i], p.cool || 0));
    }
    if (f < 0) continue;
    layers.forEach((L, i) => {
      snaps[i][f] = L.H.slice();
      const tx = new Float32Array(L.w * L.h);
      for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) tx[y * L.w + x] = L.texture(x, y, f);
      texs[i][f] = tx;
    });
  }
  return { snaps, texs };
}
// Pulses of the fuel: seeded lengths in [lo, hi] frames; strong for most of a pulse, then a dip (the gas of the dip rises as a
// weak band and cuts the column near its top: the puff). Returns pulse(t) in [dip, 1].
function pulseTrain(seed, lo, hi, dip, nFrames, phase = 0) {
  const r = rng(seed), starts = [-phase - 20];
  while (starts[starts.length - 1] < nFrames + 20) starts.push(starts[starts.length - 1] + lo + r() * (hi - lo));
  return t => {
    let i = 0; while (i < starts.length - 2 && starts[i + 1] <= t) i++;
    const L = starts[i + 1] - starts[i], p = (t - starts[i]) / L;
    const low = p < 0.55 ? 0 : p < 0.75 ? smooth((p - 0.55) / 0.2) : 1 - smooth((p - 0.75) / 0.25);
    return 1 - (1 - dip) * low;
  };
}

// ---- tree burn -------------------------------------------------------------------------------------------------------
const CHAR_CROWN = [[93, 24], [91, 11], [90, 7], [92, 8], [87, 1.5], [95, 8], [94, 5], [61, 1], [62, 1], [245, 1.5]];
// Tree burn, 96 frames: 0 the living tree; 1-8 the fire starts on the ground at the trunk and climbs into the green crown;
// 9 the crown cuts to char (open: the flames behind it show through its gaps); 9-79 the steady burn; 80-94 the crown is
// consumed, the bare tree shows and the fire fills it, then shrinks and lifts off the ground; 95 the burnt successor's exact
// size and anchor with glowing embers.
export function treeBurn(body, burntBody, seed, conifer = false, nFrames = 96) {
  const b = burntBody, padT = 38, padS = conifer ? 16 : 14, w = body.w + padS * 2, h = body.h + padT + 8, ox = padS, oy = padT;
  const ax = body.ax + ox, ay = body.ay + oy;
  // the crown: rows and columns it covers, its top
  let top = h, cx0 = w, cx1 = -1;
  for (let y = 0; y < body.h; y++) for (let x = 0; x < body.w; x++) if (body.a[y * body.w + x]) { const X = x + ox, Y = y + oy; if (Y < top) top = Y; if (X < cx0) cx0 = X; if (X > cx1) cx1 = X; }
  const Hc = ay - top, half = (cx1 - cx0) / 2, ccx = (cx0 + cx1) / 2;
  // living crown and charred crown (one cut at frame 9). The char loses about 3 columns each side, keeps some of the old shade
  // as dark greens, opens clustered gaps (retail's charred crown is 26-36% open) and carries a few fixed glowing embers.
  const living = newSprite(w, h, ax, ay), charred = newSprite(w, h, ax, ay), rc = rng(mix32(seed, 77)), gs = mix32(seed, 78);
  for (let y = 0; y < body.h; y++) {
    let x0 = body.w, x1 = -1; for (let x = 0; x < body.w; x++) if (body.a[y * body.w + x]) { if (x < x0) x0 = x; x1 = x; }
    for (let x = 0; x < body.w; x++) {
      const k = y * body.w + x; if (!body.a[k]) continue;
      put(living, x + ox, y + oy, body.idx[k]);
      const up = ay - (y + oy), gap = 0.65 * noise2(x / 2.6, y / 2.6, gs) + 0.35 * hash2(x, y, gs);
      if (x < x0 + 3 || x > x1 - 3 || (up > 8 && gap < (conifer ? 0.4 : 0.33))) continue;
      const i = body.idx[k], dark = (i >= 44 && i <= 47) || (i >= 90 && i <= 95) || (i >= 55 && i <= 62);
      put(charred, x + ox, y + oy, dark && rc() < 0.6 ? weighted(rc, [[43, 3], [44, 4], [45, 5], [46, 3], [47, 2]]) : weighted(rc, CHAR_CROWN));
    }
  }
  for (let e = 0; e < 4; e++) {        // fixed embers glowing in the char
    const ex = Math.round(ccx + (rc() - 0.5) * half * 1.3), ey = Math.round(ay - Hc * (0.25 + 0.45 * rc()));
    for (let t = 0; t < 3 + Math.floor(rc() * 4); t++) { const x = ex + Math.floor(rc() * 3) - 1, y = ey + Math.floor(rc() * 2); if (charred.a[y * w + x]) put(charred, x, y, weighted(rc, [[205, 3], [200, 2], [211, 2], [210, 1], [203, 2]])); }
  }
  const skel = newSprite(w, h, ax, ay);
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if (b.a[y * b.w + x]) put(skel, x - b.ax + ax, y - b.ay + ay, b.idx[y * b.w + x]);

  // the fire: retail's numbers this is tuned to are in the header and in the ffire notes (column top 36-76 px, mean 55, pulse
  // every ~7 frames, puffs live 1-3 frames, gas rising about 2, 2-4 and 5-7 px/frame at 0-20, 20-40 and 40-60 px)
  const P = {
    v0: 2.0, v1: conifer ? 10.5 : 10, v2: conifer ? 8.5 : 8, hAcc: Hc * 0.58, hSlow: Hc * 0.4, cool: 0.005, coolLow: 0.03, lump: 2.5, pocket: 0.62, lumpX: 5, lumpT: 3.2, bandX: 16, bandT: 1.5, band: 0.6, bandMix: 0.6, bandFrom: Hc * 0.42, bandRamp: Hc * 0.2, coolTop: 0.3, topFrom: Hc * 0.95, topRamp: Hc * 0.3, topVar: 30, diffuse: 0.05, erode: 0.1, bLo: 0.4, bHi: 0.95, bRad: 3.5, grain: 0.02, buoy0: 0.6, buoy1: 0.8, jitter: 1.6, lift: 0.45, liftX: 3.5, liftT: 2.5, wave: 2.2,
    turb: 2.6, turbX: 5, turbT: 2.5, hole: 0.15, holeUp: 0.07, fuelX: 3, fuelT: 1.5, zCap: 0.5, dip: 0, footMin: 0.4, lag: 4, inject: 0.4, cap: 1.15, frames: nFrames,
  };
  const footHalf = conifer ? 8 : 10, depth = conifer ? 4 : 3, ign = conifer ? -0.3 : -1.5, climb = conifer ? 8 : 10, period = conifer ? 6.5 : 7.5;
  const pulseF = pulseTrain(mix32(seed, 201), period - 1.5, period + 1.5, P.dip, nFrames);
  const pulseB = t => 1.15 - pulseF(t - P.lag);                         // the flames behind the crown flare when the column's top dips
  const phaseX = (x, t) => 5 * (noise2(x / 4, t / 6, seed + 73) - 0.5);       // the pulse reaches the columns at slightly different times
  P.cut = (x, te) => 1 - pulseF(te + phaseX(x, te));
  const front = makeLayer(w, h, ay, P, mix32(seed, 101)), back = makeLayer(w, h, ay, { ...P, cool: 0.02, coolLow: 0.06, v0: 2.4, hole: 0.2, cut: null, bandMix: 0.9 }, mix32(seed, 102));   // the crown's flames: shorter-lived, cut at random
  // the crown's own flames, behind it: spots that flare for a while, then move elsewhere in the crown
  const bSpot = i => { const cyc = 6 + 8 * hash2(i, 0, seed + 61); return { cyc, born: hash2(i, 1, seed + 61) * cyc }; };
  const bSpots = []; for (let i = 0; i < (conifer ? 7 : 9); i++) bSpots.push(bSpot(i));
  const where = (i, n) => { const up = Hc * (P.bLo + (P.bHi - P.bLo) * hash2(i, n, seed + 62)), e = (up / Hc - 0.5) / 0.55, wide = half * Math.sqrt(Math.max(0, 1 - e * e));
    return { x: Math.round(ccx + (hash2(i, n, seed + 63) * 2 - 1) * wide * 0.6), up, rad: P.bRad + 1.8 * hash2(i, n, seed + 64) }; };
  const stamp = (list, sp, s) => { const R = Math.ceil(sp.rad); for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (dx * dx + dy * dy <= sp.rad * sp.rad) list.put((Math.round(ay - sp.up) + dy) * w + sp.x + dx, s * (1 - 0.35 * (dx * dx + dy * dy) / (sp.rad * sp.rad))); };
  const swS = mix32(seed, 301), sway = new Float32Array(h);
  const plan = t => {
    const age = t - ign, reach = 10 + age * climb;                                   // the burning climbs about 10 px/frame (retail's flame top 27, 40, 43, 51, 48, 76 at frames 1-6)
    const tail = clamp((t - 80) / 6, 0, 1), die = clamp((t - 89.5) / 5.5, 0, 1);    // crown consumed from 80; the fire dies over 90-94
    const fs = sources(), bs = sources();
    if (age > 0) {
      const pb = pulseB(t);
      // in front: the trunk and the lower crown burning, a zone on a small flat foot on the ground at the trunk (7 columns at
      // ignition, about 20 when burning) that climbs with the burning to half the crown's height; its fuel is patchy.
      // At the end the foot dies first: the fire lifts off the ground onto the trunk.
      const fw = Math.min(footHalf, 3 + age * 0.9) * (1 - 0.2 * tail), zTop = Math.min(reach, Hc * (age < 10 ? 0.68 : P.zCap));   // the green crown catches high in the lead-in
      for (let up = -depth; up <= zTop + 4; up++) {
        // a ragged outline: the half-width wobbles with height and time, the top is uneven and round-shouldered
        const u = clamp(up / Math.max(zTop, 1), 0, 1.2), wob = 0.55 + 0.9 * noise2(up / 6, t / 2, seed + 71);
        const hz = fw * wob * (u < 0.5 ? 1 - 0.1 * u : Math.max(0, 0.95 - (u - 0.5) * 1.3)), sh = (noise2(up / 8, t / 2.5, seed + 72) - 0.5) * 8 * clamp(up / 12, 0, 1);
        const s = (up < 0 ? 0.45 : 1 - 0.3 * up / Hc) * (up < 4 ? 1 - clamp(die * 1.7, 0, 1) : 1 - die * 0.85);
        const catching = up > 3 && age < 10;   // while the fire takes hold (the lead-in) the fuel it reaches burns at once: a rounded lump that grows
        for (let x = Math.floor(ax + sh - hz - 1); x <= Math.ceil(ax + sh + hz + 1); x++) {
          // the pulse reaches the columns at slightly different times (no flat-topped puffs); in a dip the fuel above the foot
          // goes out, so the gas of the dip is a cold gap that rises and cuts the column; the foot never quite goes out.
          // Two or three lobes side by side burn harder than the gaps between them.
          const p = pulseF(t + phaseX(x, t)), lobe = 0.55 + 0.9 * noise2(x / 5.5, t / 4, seed + 74);
          fs.put((ay - up) * w + x, s * (up < 4 ? Math.max(p, P.footMin) : catching ? 0.85 : p * lobe) * clamp(hz + 0.5 - Math.abs(x - ax - sh), 0, 1), up >= 4 && !catching);
        }
      }
      for (let i = 0; i < bSpots.length; i++) {
        const sp = bSpots[i], n = Math.floor((t + sp.born) / sp.cyc), on = ((t + sp.born) / sp.cyc - n) < 0.7, at = where(i, n);
        if (on && at.up < reach - 25) stamp(bs, at, pb * (1 + 0.3 * tail) * (1 - die));
      }
      if (tail > 0) for (let i = 0; i < 8 * tail * (1 - die); i++) { const at = where(100 + i, Math.floor(t)); at.rad = 2.5; at.up *= 0.75; stamp(bs, at, 0.65 * (1 - die)); }   // burn-out: the whole tree burns, behind its bare limbs
    }
    for (let y = 0; y < h; y++) {                 // sway: the flame leans and waves above its anchored foot, a little to the left
      // a sideways wave that travels up with the gas: tongues bend into S-curves and curl, not straight spikes
      const up = clamp((ay - y) / Hc, 0, 1);
      sway[y] = up * (P.wave * (2 * noise1(t * 0.3 - (ay - y) / 14, swS) - 1) + 0.6 * (2 * noise1(t * 0.12, swS + 1) - 1) - 0.25);
    }
    return { src: [bs, fs], sway, cool: die * 0.3 };   // and as it dies, what is left above cools fast: it shrinks from the top
  };
  const { snaps, texs } = runFire([back, front], plan, -3, nFrames - 1);
  const T0 = 0.15, fields = snaps.map((L, i) => L.map((hs, f) => flameField(hs, w, h, T0, f, seed + 11 + 2 * i)));
  const th = bandThresholds([...fields[0].slice(12, 80), ...fields[1].slice(12, 80)]);
  // sparks: single pixels that leave the flame's upper edge and rise 2-4 px/frame for 1-3 frames
  const sparks = [], rs = rng(mix32(seed, 401));
  const frames = new Array(nFrames);
  frames[0] = cropSprite(living);                  // a broadleaf's first frame is the living tree; a conifer's already burns at the foot
  for (let f = conifer ? 0 : 1; f < nFrames - 1; f++) {
    const base = f < 9 ? living : f < 80 ? charred : null;
    let crown;
    if (base) crown = cloneSprite(base);
    else {                                         // the crown burns away over a few frames and the bare tree shows
      const t = (f - 80) / 6; crown = cloneSprite(charred);
      for (let k = 0; k < w * h; k++) if (crown.a[k] && hash2(k % w, (k / w) | 0, seed) < t * 1.15 + 0.1) crown.a[k] = 0;
      for (let k = 0; k < w * h; k++) if (skel.a[k] && !crown.a[k]) { crown.idx[k] = skel.idx[k]; crown.a[k] = 1; }
    }
    const cv = newSprite(w, h, ax, ay);
    paintFire(cv, fields[0][f], texs[0][f], th, f, seed + 11);           // behind
    for (let k = 0; k < w * h; k++) if (crown.a[k]) { cv.idx[k] = crown.idx[k]; cv.a[k] = 1; }
    paintFire(cv, fields[1][f], texs[1][f], th, f, seed + 13);           // in front
    // sparks
    const fr = snaps[1][f], nNew = Math.round((conifer ? 2 : 4.5) * (0.5 + rs()) * (f < 4 ? 0.3 : 1) * (f > 90 ? 0.3 : 1));
    for (let i = 0; i < nNew; i++) {
      const x = Math.round(ccx + (rs() * 2 - 1) * half * 0.9); let y = 0;
      while (y < ay && !(fr[y * w + x] > T0 + 0.02 || snaps[0][f][y * w + x] > T0 + 0.02)) y++;
      if (y < ay - 4) sparks.push({ x, y: y - 1 - Math.floor(rs() * 4), life: 1 + Math.floor(rs() * 3), c: weighted(rs, SPARK_COLORS) });
    }
    for (const s of sparks) if (s.life > 0) {
      if (s.y > 0 && s.x >= 0 && s.x < w && !cv.a[s.y * w + s.x]) put(cv, s.x, s.y, s.c);
      s.y -= 2 + Math.floor(rs() * 3); s.x += Math.floor(rs() * 3) - 1; s.life--;
    }
    frames[f] = cropSprite(cv);
  }
  const last = cloneSprite(b), re = rng(mix32(seed, 4242));       // the burnt successor's exact size and anchor, about 16% embers
  for (let k = 0; k < last.w * last.h; k++) if (last.a[k] && re() < 0.16) last.idx[k] = weighted(re, [[205, 30], [200, 18], [203, 14], [204, 14], [211, 8], [210, 8], [206, 8]]);
  frames[nFrames - 1] = last;
  return frames;
}

// ---- shrub burn ------------------------------------------------------------------------------------------------------
const CHAR = [[95, 28], [47, 24], [93, 17], [94, 14], [62, 6], [61, 5], [92, 3], [89, 2], [91, 1]];
// Shrub burn, 42 frames, flame only (the shrub is gone from frame 0): a small flame on a narrow foot, 11-18 px wide and
// 23-34 px tall, its gas rising about 1-3 px/frame, few puffs; the last frame a small dying flame. One layer: nothing to hide behind.
export function shrubBurn(shrub, seed, nFrames = 42) {
  const W = 32, H = 48, ax = 16, ay = H - 5;
  const halfB = clamp(shrub.w * 0.22, 4.5, 6.5), zH = clamp(shrub.h + 2, 15, 22);
  const L = makeLayer(W, H, ay, { v0: 1.2, v1: 3.2, v2: 2.2, hAcc: 24, hSlow: 10, cool: 0.004, coolLow: 0.02, lump: 1.2, pocket: 0.62, lumpX: 3.5, lumpT: 3, bandX: 10, bandT: 2, band: 0.6, bandMix: 0.7, bandFrom: 8, bandRamp: 6, coolTop: 0.2, topFrom: 24, topRamp: 10, topVar: 10,
    diffuse: 0.05, erode: 0.12, grain: 0.03, buoy0: 0.45, buoy1: 1.1, jitter: 1.2, lift: 0.4, liftX: 3, liftT: 2.5, turb: 1.2, turbX: 4, turbT: 3, hole: 0.25, holeUp: 0.08,
    inject: 0.35, cap: 1.15, fuelX: 3, fuelT: 1.5, frames: nFrames }, mix32(seed, 101));
  const pulse = pulseTrain(mix32(seed, 201), 5, 8, 0.25, nFrames), swS = mix32(seed, 301), sway = new Float32Array(H);
  // the burning shrub: a narrow foot and a rounded body of fuel above it, both pulsing; at the end the fuel runs low
  const plan = t => {
    const s = sources(), grow = clamp((t + 2.5) / 5, 0.3, 1), die = t > nFrames - 3 ? 0.4 : 1;
    for (let up = -1; up <= zH * grow; up++) {
      const u = (up / zH - 0.45) / 0.6, hz = (up < 2 ? 2.5 : halfB * Math.sqrt(Math.max(0, 1 - u * u))) * (0.75 + 0.5 * noise2(up / 4, t / 2.5, seed + 71)) * grow;
      for (let x = Math.floor(ax - hz - 1); x <= Math.ceil(ax + hz + 1); x++) {
        const p = pulse(t + 2 * (noise2(x / 4, t / 5, seed + 73) - 0.5)) * die;
        s.put((ay - up) * W + x, (up < 2 ? Math.max(p, 0.45) : p) * clamp(hz + 0.5 - Math.abs(x - ax), 0, 1), up >= 2);
      }
    }
    for (let y = 0; y < H; y++) { const up = clamp((ay - y) / 30, 0, 1); sway[y] = up * (1.4 * (2 * noise1(t * 0.3 - (ay - y) / 10, swS) - 1) - 0.12); }
    return { src: [s], sway, cool: die < 1 ? 0.3 : 0 };
  };
  const { snaps, texs } = runFire([L], plan, -3, nFrames);
  const T0 = 0.2, fields = snaps[0].map((hs, f) => flameField(hs, W, H, T0, f, seed + 11)), th = bandThresholds(fields.slice(2));
  const frames = [];
  for (let f = 0; f < nFrames; f++) {
    const cv = newSprite(W, H, ax, ay);
    paintFire(cv, fields[f], texs[0][f], th, f, seed + 11);
    const rch = rng(mix32(seed, 800 + f)); for (let k = 0; k < 2; k++) { const x = ax + Math.round((rch() - 0.5) * 10), y = ay - Math.round(rch() * 2); if (!cv.a[y * W + x]) put(cv, x, y, weighted(rch, CHAR)); }
    frames.push(cropSprite(cv));
  }
  return frames;
}
