// Procedural map features for Green: trees, burning and burnt trees, shrubs, rocks, scars, metal deposits, vents.
// Plain ES module, no dependencies, same bytes in Node and in the browser. Everything is built in the game's
// 256-color index space (the indices below are the game palette's; `palette` is only needed to turn indices
// into RGBA or to fit deposits and vents to a ground picture). Built from the written spec only. The burn sequences (fire)
// are in sculpt-feature-fire.js.
//
// A sprite is {w,h,ax,ay,idx:Uint8Array,a:Uint8Array}: palette index per pixel, a=1 where drawn, (ax,ay) the anchor
// pixel inside the sprite (the foot of a plant, the middle of a rock).
// A feature is {kind,name,seed,params,footprint,body,shadow,shadowBlend,bodyBlend,burn,burnt,gameplay}.

import { treeBurn, shrubBurn } from './sculpt-feature-fire.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;

// ---- random numbers and noise -------------------------------------------------------------------------------
export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const mix32 = (a, b) => { let n = Math.imul(a ^ 0x9E3779B9, 0x85EBCA6B) ^ Math.imul(b + 0x7F4A7C15, 0xC2B2AE35); n = Math.imul(n ^ (n >>> 15), 0x2C1B3C6D); return (n ^ (n >>> 13)) >>> 0; };
const hash2 = (x, y, s) => { let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2246822519); n = Math.imul(n ^ (n >>> 13), 1274126177); n ^= n >>> 16; return (n >>> 0) / 4294967296; };
function vnoise(x, y, s) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return lerp(lerp(hash2(ix, iy, s), hash2(ix + 1, iy, s), u), lerp(hash2(ix, iy + 1, s), hash2(ix + 1, iy + 1, s), u), v);
}
function fbm(x, y, s, oct = 3) { let a = 0.5, f = 1, t = 0, n = 0; for (let i = 0; i < oct; i++) { t += a * vnoise(x * f, y * f, s + i * 101); n += a; a *= 0.5; f *= 2; } return t / n; }
const pick = (r, list) => list[Math.min(list.length - 1, (r() * list.length) | 0)];
function weighted(r, table) { // table: [[value, weight], ...]
  let sum = 0; for (const [, w] of table) sum += w; let x = r() * sum;
  for (const [v, w] of table) { x -= w; if (x < 0) return v; }
  return table[table.length - 1][0];
}

// ---- palette indices (game order) ----------------------------------------------------------------------------
export const IDX = {
  GREEN: [47, 46, 45, 44, 43, 42, 41, 40, 39, 38, 37],              // tree greens, dark to light
  OLIVE: [175, 173, 172, 238, 170, 169, 168],
  YELLOW_GREEN: [175, 173, 172, 238, 170, 169, 168, 167, 166, 165, 164],
  SHRUB: [173, 169, 168, 167, 166, 165, 164, 163, 162],
  EXTRA_GREEN: [174, 239, 171, 237, 236, 235, 54, 234, 53, 233, 52],      // off-ramp greens, luma 19..146
  EXTRA_LUMA: [19, 21, 48, 63, 84, 104, 103, 132, 123, 165, 146],
  GRAY: [95, 94, 93, 92, 91, 90, 89, 88, 87, 86, 85],               // 15..171
  TAN: [68, 67, 66, 65, 64], PINK: [22, 21, 20, 18, 17],
  BROWN: [62, 61, 60, 59, 58, 57, 55],
  BLACK: [245, 63, 79, 78, 77],
  CHAR: [47, 94, 95, 61, 93, 62],
  WHITE: 255,
  KEY: 9,
};
const G = IDX.GREEN, GR = IDX.GRAY;
const LUMA_GREEN = [12, 18, 26, 33, 41, 46, 56, 63, 72, 82, 96];

// ---- sprites -------------------------------------------------------------------------------------------------
const newSprite = (w, h, ax, ay) => ({ w, h, ax, ay, idx: new Uint8Array(w * h), a: new Uint8Array(w * h) });
const inb = (s, x, y) => x >= 0 && y >= 0 && x < s.w && y < s.h;
function put(s, x, y, i) { if (!inb(s, x, y)) return; const k = y * s.w + x; s.idx[k] = i; s.a[k] = 1; }
const at = (s, x, y) => (inb(s, x, y) && s.a[y * s.w + x] ? 1 : 0);
function cropSprite(s, pad = 0) {
  let x0 = s.w, y0 = s.h, x1 = -1, y1 = -1;
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) if (s.a[y * s.w + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (x1 < 0) return newSprite(1, 1, 0, 0);
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(s.w - 1, x1 + pad); y1 = Math.min(s.h - 1, y1 + pad);
  const o = newSprite(x1 - x0 + 1, y1 - y0 + 1, s.ax - x0, s.ay - y0);
  for (let y = 0; y < o.h; y++) for (let x = 0; x < o.w; x++) { const k = (y + y0) * s.w + x + x0; o.idx[y * o.w + x] = s.idx[k]; o.a[y * o.w + x] = s.a[k]; }
  return o;
}
const cloneSprite = s => ({ ...s, idx: s.idx.slice(), a: s.a.slice() });
// distance (4-neighbor steps) from each drawn pixel to the nearest undrawn one; 0 for undrawn
function edgeDist(w, h, mask) {
  const d = new Int16Array(w * h).fill(9999), q = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x; if (!mask[k]) { d[k] = 0; q.push(k); }
  }
  for (let qi = 0; qi < q.length; qi++) {
    const k = q[qi], x = k % w, y = (k / w) | 0, nd = d[k] + 1;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const nk = ny * w + nx; if (d[nk] > nd) { d[nk] = nd; q.push(nk); }
    }
  }
  for (let k = 0; k < d.length; k++) if (d[k] === 9999) d[k] = 99;
  return d;
}
export function toRGBA(s, palette) {
  const o = new Uint8ClampedArray(s.w * s.h * 4);
  for (let k = 0; k < s.w * s.h; k++) if (s.a[k]) { const c = palette[s.idx[k]]; o[k * 4] = c[0]; o[k * 4 + 1] = c[1]; o[k * 4 + 2] = c[2]; o[k * 4 + 3] = 255; }
  return o;
}

// ---- light ---------------------------------------------------------------------------------------------------
// ctx.light = {x, y} is the screen direction TOWARD the sun (x<0 left, y<0 up); default upper left, as in retail.
// ctx.ambient (0..1.5, default 1) scales the lit-to-shade contrast of the plants. The shadow leans to the opposite
// side horizontally and goes up the screen (the retail look: shadows to the upper right for light from the upper left).
function lightOf(ctx = {}) {
  let lx = ctx.light?.x ?? -0.62, ly = ctx.light?.y ?? -0.7;
  const n = Math.hypot(lx, ly) || 1; lx /= n; ly /= n;
  const lz = 0.6, nn = Math.hypot(lx * 0.8, ly * 0.8, lz);
  return { x: lx, y: ly, v: [lx * 0.8 / nn, ly * 0.8 / nn, lz / nn], ambient: clamp(ctx.ambient ?? 1, 0.3, 1.6), shadowSide: lx < 0 ? 1 : -1 };
}

// ---- color pickers: lev is a float "ramp position" ----------------------------------------------------------------
function nearestExtra(lumaTarget) {
  let best = 0, bd = 1e9; IDX.EXTRA_LUMA.forEach((l, i) => { const d = Math.abs(l - lumaTarget); if (d < bd) { bd = d; best = i; } });
  return IDX.EXTRA_GREEN[best];
}
function lumaOfLevel(lev) { const i = clamp(lev, 0, 10), a = Math.floor(i), b = Math.min(10, a + 1); return lerp(LUMA_GREEN[a], LUMA_GREEN[b], i - a); }
// lean: -1 olive and yellow-green, 0 retail, +1 lush and bright. zone is a smooth 0..1 field that clusters the lean.
function broadColor(lev, r, lean, zone, inClump = true) {   // inClump: bright flecks only appear inside a bright clump, never as isolated pixels
  const L = clamp(lev, 0, 10.49), li = Math.round(L);
  const darkness = clamp((3.6 - L) / 3.6, 0, 1);
  if (darkness > 0 && r() < 0.6 * darkness + 0.1 * (L < 4.5 ? 1 : 0)) {
    // a dark gap between leaves: gray, a little brown
    const g = clamp(Math.round(L * 0.85 + (r() - 0.5) * 2.2 + (r() < 0.12 ? 3 : 0)), 0, 10);
    return r() < 0.3 ? weighted(r, [[62, 3], [61, 3], [60, 3], [59, 2], [58, 1], [57, 0.5]]) : (r() < 0.07 ? pick(r, [127, 125, 47]) : GR[g]);
  }
  let ramp = G;
  if (lean < 0 && zone < -lean * 0.9) ramp = IDX.YELLOW_GREEN;
  const x = r();
  if (inClump && L > 6.2 && x < 0.16) return pick(r, [233, 234, 54, 35, 53]);          // bright yellow-green flecks grouped on the lit lobes
  if (x < 0.1) return nearestExtra(Math.min(lumaOfLevel(L) + (r() - 0.5) * 40, inClump ? 200 : 92));
  if (x < 0.105) return inClump ? pick(r, [233, 234, 35, 53, 52]) : pick(r, [171, 237, 236]);   // saturated or gray-green flecks, never white, gray or pink
  if (x < 0.12 && L < 7) return IDX.OLIVE[clamp(Math.round(L * 0.6), 0, 6)];
  if (lean > 0 && L > 7 && r() < lean * 0.5) return pick(r, [36, 35, 34]);
  return ramp[li];
}
function coniferColor(lev, r, lean, zone, brownP) {
  const L = clamp(lev, 0, 10.49), li = Math.round(L);
  if (r() < brownP) return weighted(r, [[62, 2], [61, 3], [60, 3], [59, 3], [58, 3], [57, 3], [55, 1.5]]);   // retail's conifer brown runs lighter, gray-olive in the sun
  const x = r();
  if (x < 0.035 + (lean < 0 ? -lean * 0.2 : 0)) return IDX.OLIVE[clamp(Math.round(L * 0.8 + (r() - 0.5) * 3), 0, 6)];
  if (x < 0.05) return pick(r, [53, 54, 171, 237]);   // gray-green flecks; conifers have no pixel brighter than luma 123
  if (x < 0.14 && L < 4.5) return GR[clamp(Math.round(L + (r() - 0.5) * 4), 0, 6)];
  if (x < 0.25) return nearestExtra(lumaOfLevel(L) + (r() - 0.5) * 50);
  if (lean > 0 && L > 6 && r() < lean * 0.4) return pick(r, [36, 35]);
  return G[li];
}

// ---- shadows -------------------------------------------------------------------------------------------------
// A shadow sprite is the body's silhouette sheared along the ground: height above `groundY` shifts the pixel by
// `shx` px to the side per px of height and `up` px up the screen per px of height (negative = down). Soft stipple
// at the edge, solid core, dark palette colors. The shadow sprite shares the body's anchor so both place alike.
function makeShadow(body, o, r) {
  const { side = 1, shx = 0.58, up = 0.62, groundY = body.ay, colors, soften = 2, pad = 4, grow = 0 } = o;
  const reach = Math.ceil(Math.abs(shx) * body.h) + 4 + pad, tall = Math.ceil(Math.abs(up) * body.h) + pad + 4;
  const w = body.w + reach * 2, h = body.h + tall * 2;
  const ox = reach, oy = tall;                  // body pixel (x,y) sits at (x+ox, y+oy)
  const sh = newSprite(w, h, body.ax + ox, body.ay + oy);
  // blurred body coverage for soft edges
  const cov = (x, y) => {
    let c = 0, n = 0;
    for (let dy = -soften; dy <= soften; dy++) for (let dx = -soften; dx <= soften; dx++) { c += at(body, x + dx, y + dy); n++; }
    return c / n;
  };
  const cache = new Map();
  for (let Y = 0; Y < h; Y++) for (let X = 0; X < w; X++) {
    // inverse shear
    const Yr = Y - sh.ay, hgtScaled = -Yr / (up || 1);       // height above ground in body px
    const hg = up > 0 ? hgtScaled : hgtScaled;                 // (negative `up` flips the screen direction)
    const xb = (X - sh.ax) - side * shx * Math.max(0, hg);
    const yb = groundY - hg - body.ay + body.ay;               // body row (relative to the sprite top)
    const bx = Math.round(xb + body.ax), by = Math.round(yb);
    if (by < -soften || by > body.h + soften) continue;
    const key = by * 4096 + bx; let c = cache.get(key);
    if (c === undefined) { c = cov(bx, by); cache.set(key, c); }
    if (c > 0.55 + grow || (c > 0.12 && r() < (c - 0.12) / (0.43 + grow))) sh.a[Y * w + X] = 1;
  }
  for (let k = 0; k < w * h; k++) if (sh.a[k]) sh.idx[k] = weighted(r, colors);
  const out = cropSprite(sh);
  return out;
}
// Rock shadow (retail: a large soft dark patch to the right and below, wider than tall): the silhouette offset and grown a little.
function offsetShadow(body, dx, dy, grow, colors, r) {
  const pad = Math.ceil(Math.abs(dx)) + 6, w = body.w + pad * 2, h = body.h + pad * 2, sh = newSprite(w, h, body.ax + pad, body.ay + pad);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let hit = 0;
    for (let g = -grow; g <= grow; g++) for (let f = -grow; f <= grow; f++) if (at(body, x - pad - Math.round(dx) + f, y - pad - Math.round(dy) + g)) hit++;
    if (hit > (grow ? 2 : 0) || (hit > 0 && r() < 0.5)) { sh.a[y * w + x] = 1; sh.idx[y * w + x] = weighted(r, colors); }
  }
  return cropSprite(sh);
}
const TREE_SHADOW_COLORS = [[245, 39], [95, 38], [92, 6], [93, 6], [94, 5], [44, 2], [45, 2], [46, 2]];
const ROCK_SHADOW_COLORS = [[47, 78], [95, 20], [245, 2]];

// ---- trees -----------------------------------------------------------------------------------------------------
const TREE_DEFAULTS = {
  species: 'broadleaf',  // 'broadleaf' or 'conifer'
  height: 68,            // px, broadleaf 66-71, conifer 57-64
  width: 0.72,           // width / height, broadleaf 0.68-0.73, conifer 0.44-0.62
  crown: 0.6,            // 0 smooth egg .. 1 deeply lobed and ragged
  density: 0.45,         // 0 sparse and holey .. 1 solid
  taper: 0.5,            // broadleaf crown: 0 round top .. 1 narrow toward the top (retail Green 0.5; a biome knob)
  peaks: 0.5,            // broadleaf crown: 0 smooth top .. 1 irregular peaks along the top (retail Green 0.5)
  lean: 0,               // -1 olive, 0 retail, +1 lush
  energy: [250, 250],    // gameplay range (retail: 250 for every tree)
};

function treeFrame(P, seed, ctx) {
  const L = lightOf(ctx), conifer = P.species === 'conifer';
  const r = rng(seed), rn = rng(mix32(seed, 77));
  const H = Math.round(P.height), W = Math.round(H * P.width);
  const pad = 8, head = conifer ? 0 : 12, w = W + pad * 2 + 4, h = H + 3 + head;   // headroom above a broadleaf crown for its peaks
  const jx = (r() - 0.5) * 3, cx = w / 2 + jx;
  const ay = h - 3, ax = Math.round(cx) + (conifer ? 0 : Math.round((r() - 0.5) * 2));
  const stubRows = conifer ? 9 : 6, y0 = conifer ? 2 : 2 + head + Math.round(5 * P.peaks), yc = ay - (conifer ? 1 : 4);
  const Wh = W / 2;
  // silhouette profile
  const tp = conifer ? 0.5 + r() * 0.14 : 0.28 + r() * 0.3;
  const bump = !conifer && r() < 0.4, bumpX = (r() - 0.5) * 0.5;
  const tiers = conifer ? 5 + Math.floor(r() * 3) : 0, tierPh = r() * TAU;
  const s1 = (r() * 1e6) | 0, s2 = (r() * 1e6) | 0, s3 = (r() * 1e6) | 0, s4 = (r() * 1e6) | 0;
  const crown = P.crown, dens = P.density, taperV = clamp(P.taper + (r() - 0.5) * 0.3, 0, 1), peaksV = clamp(P.peaks + (r() - 0.5) * 0.3, 0, 1);
  const prof = tt => {
    tt = clamp(tt, 0, 1);
    if (conifer) {
      let p = tt < tp ? Math.pow(tt / tp, 0.62) : 1 - 0.34 * Math.pow((tt - tp) / (1 - tp), 1.2);
      p *= 1 + 0.1 * Math.sin(tiers * TAU * tt + tierPh) * Math.min(1, tt * 3);
      return p;
    }
    const narrow = 1 - taperV * 0.55 * Math.pow(1 - tt, 1.5);     // thinner toward the top
    if (tt < tp) { const s = tt / tp; return Math.pow(Math.max(0, 1 - Math.pow(1 - s, 2.3 - 0.6 * taperV)), 0.5) * narrow; }
    const s = (tt - tp) / (1 - tp);
    let p = 1 - 0.3 * Math.pow(s, 1.5);
    if (s > 0.7) p *= Math.sqrt(Math.max(0, 1 - Math.pow((s - 0.7) / 0.3, 2.2)));
    return p * narrow;
  };
  const mask = new Uint8Array(w * h);
  const nl = (x, y) => fbm(x / 7.5, y / 7.5, s1, 2) * 2 - 1;
  const nr = (x, y) => vnoise(x / 1.7, y / 1.7, s2) * 2 - 1;
  for (let y = y0; y <= yc; y++) for (let x = 0; x < w; x++) {
    const tt = (y - y0) / (yc - y0);
    let u = Math.abs(x - cx) / Wh;
    const lob = nl(x, y), rag = nr(x, y);
    const ttv = tt + (conifer ? 0.012 : 0.04) * crown * lob;
    let pr = prof(ttv);
    if (bump && !conifer) pr += 0.22 * Math.exp(-Math.pow((x - cx) / Wh - bumpX, 2) * 12) * Math.exp(-Math.pow(tt / 0.1, 2));
    const lim = pr * (1 + crown * (conifer ? 0.15 : 0.27) * lob) + crown * (conifer ? 0.12 : 0.17) * rag * (0.35 + 0.65 * Math.min(1, tt * 4)) + (conifer ? 0 : peaksV * 0.6 * Math.pow(clamp(vnoise(x / 3.1, y / 2.6, s1 + 13) - 0.5, 0, 1) * 2, 1.2) * (1 - clamp(tt / 0.5, 0, 1)));   // irregular peaks along the top
    if (u < lim && lim > 0.02) mask[y * w + x] = 1;
  }
  // crown top: several upward-reaching branch and leaf clusters with points, leaning toward the sun (broadleaf)
  if (!conifer) {
    const ytop = new Int16Array(w).fill(-1); for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) if (mask[y * w + x]) { ytop[x] = y; break; }
    const nPk = 2 + Math.round(peaksV * 4 * (0.7 + 0.6 * r())), xs = [];
    for (let t = 0; t < 60 && xs.length < nPk; t++) { const xi = Math.round(cx + (r() - 0.5) * W * 0.8); if (ytop[xi] >= 0 && xs.every(q => Math.abs(q - xi) >= 6)) xs.push(xi); }
    for (const xi of xs) {
      const base = ytop[xi] + 2, hp = Math.min(y0 - 2, Math.round((5 + r() * 8) * (0.55 + 0.9 * peaksV))), wp = 4 + r() * 4, lean = L.x * (0.25 + 0.3 * r());
      for (let dy = 0; dy <= hp; dy++) {
        const half = (wp / 2) * Math.pow(1 - dy / (hp + 1), 0.9), xc = xi + lean * dy + (vnoise(dy / 2.5, xi, s2) - 0.5) * 1.6, yy = base - dy;
        for (let x = Math.round(xc - half); x <= Math.round(xc + half); x++) if (x >= 0 && x < w && yy >= 0 && (x !== Math.round(xc - half) || r() < 0.7)) mask[yy * w + x] = 1;
      }
    }
  }
  // trunk stub
  const stub = [];
  for (let y = yc - 1; y <= ay; y++) {
    const sw = y === ay ? 2 + (r() < 0.5 ? 1 : 0) : conifer ? 4 + (ay - y < 5 ? 1 : 0) : 6 - (y > ay - 3 ? 1 : 0) + (r() < 0.2 ? 1 : 0);
    for (let x = 0; x < sw; x++) { const xx = Math.round(cx - sw / 2 + x + 0.01); stub.push([xx, y]); }
  }
  // holes near the edge and strays outside it
  let dist = edgeDist(w, h, mask);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x;
    if (mask[k]) { const d = dist[k]; if (d <= 3 && r() < (1 - dens) * (0.62 - d * 0.1) * (conifer ? 0.35 : 1)) mask[k] = 2; }
  }
  for (let k = 0; k < w * h; k++) if (mask[k] === 2) mask[k] = 0;
  const strays = [];
  for (let y = 1; y < h - 2; y++) for (let x = 1; x < w - 1; x++) {
    const k = y * w + x; if (mask[k]) continue;
    let near = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if ((dx || dy) && mask[(y + dy) * w + x + dx] === 1) near++;
    if (near > 0 && r() < (0.02 + 0.05 * crown) * Math.min(1, near / 4) * (0.5 + 0.5 * dens)) strays.push(k);
  }
  for (const k of strays) mask[k] = 1;
  for (const [x, y] of stub) mask[y * w + x] = 3;
  dist = edgeDist(w, h, mask);
  // shading
  const Hh = (yc - y0) / 2, ycen = (y0 + yc) / 2;
  const zf = (x, y) => {
    const ex = (x - cx) / (Wh * 0.95), ey = (y - ycen) / (Hh * 1.02);
    const dome = Math.sqrt(Math.max(0.03, 1 - ex * ex - ey * ey * 0.85));
    return 13 * dome + 7 * (fbm(x / 5.2, y / 5.2, s3, 2) - 0.5) * (0.4 + crown);
  };
  const body = newSprite(w, h, ax, ay);
  const amb = L.ambient;
  const mid = conifer ? 3.4 : 5.1, lamGain = conifer ? 3.0 : 3.3, gxGain = conifer ? 2.6 : 1.0, gyGain = conifer ? 0.3 : 0.9;
  const sigma = conifer ? 2.3 : 5.0;
  // bright leaf bunches (spec 15 B6): about 34 rounded 3-6 px clumps that lean to the upper-left lobes
  const clumpList = [];
  if (!conifer) {
    const inside = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x] === 1 && dist[y * w + x] >= 2) inside.push([x, y]);
    // bright pixels follow the light: a bunch can only sit where the crown's surface faces the sun (lit lobes and sun-facing rims)
    const lamAt = (x, y) => { const zx = zf(x + 1, y) - zf(x - 1, y), zy = zf(x, y + 1) - zf(x, y - 1), nn = Math.hypot(zx, zy, 2); return (-zx / nn) * L.v[0] + (-zy / nn) * L.v[1] + (2 / nn) * L.v[2]; };
    for (let tries = 0; clumpList.length < Math.round(P.clumps ?? 84) && tries < 40000 && inside.length; tries++) {
      const [x, y] = inside[(r() * inside.length) | 0];
      if (r() > Math.pow(clamp((lamAt(x, y) - 0.55) * 2.6, 0, 1), 1.3)) continue;
      if (clumpList.some(c => Math.hypot(c.x - x, c.y - y) < 3.5)) continue;
      clumpList.push({ x, y, rad: 1.1 + r() * 1.2, str: 3.6 + r() * 2.6 });
    }
  }
  const clumpBoost = (x, y) => { let b = 0; for (const c of clumpList) { const d2 = ((x - c.x) ** 2 + (y - c.y) ** 2) / (c.rad * c.rad); if (d2 < 1.6) b = Math.max(b, c.str * (1 - d2 / 1.6)); } return b; };
  const zoneN = (x, y) => (fbm(x / 9, y / 9, s4, 2) - 0.5) * 2;
  const needleX = conifer ? 5.5 : 0, brownField = (x, y) => vnoise(x / 6, y / 1.6, s1 + 5) + 0.35 * (vnoise(x / 2.2, y / 1.2, s2 + 9) - 0.5);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x, m = mask[k]; if (!m) continue;
    if (m === 3) { // stub
      const c = weighted(rn, [[62, 4], [61, 3], [60, 2], [95, 3], [94, 2], [93, 1], [59, 1]]);
      put(body, x, y, c); continue;
    }
    const zx = zf(x + 1, y) - zf(x - 1, y), zy = zf(x, y + 1) - zf(x, y - 1);
    const nn = Math.hypot(zx, zy, 2), nv = [-zx / nn, -zy / nn, 2 / nn];
    const lam = nv[0] * L.v[0] + nv[1] * L.v[1] + nv[2] * L.v[2];
    const tt = clamp((y - y0) / (yc - y0), 0, 1), ex = (x - cx) / Wh;
    // the light gradient follows the sun direction: lit side up and toward the sun
    let lev = mid + amb * (lamGain * (lam - 0.62) + gxGain * L.x * ex * 1.4 + gyGain * L.y * (tt - 0.5) * 2);
    if (!conifer) lev += clumpBoost(x, y) * amb;
    if (dist[k] <= 1 && !conifer) lev += 0.9;      // edges are not darker than the interior (no rim)
    // base darkening: ambient occlusion, never an outline
    if (tt > 0.78) lev -= ((tt - 0.78) / 0.22) * (conifer ? 2.2 : 4.4);
    const white = (rn() + rn() - 1), cell = vnoise(x / (1.9 + needleX * 0.35), y / 1.9, s1 + 31) * 2 - 1;
    let nz = (conifer ? 0.8 : 0.62) * white * 1.4 + (conifer ? 0.2 : 0.38) * cell * 1.5;
    if (!conifer && rn() < 0.1) nz += (lam > 0.66 ? 1 : lam < 0.52 ? -1 : 0) * 2.2;       // sparkle follows the light: bright on sun-facing leaves, dark in gaps
    lev += sigma * nz;
    const zone = zoneN(x, y);
    let col;
    if (conifer) {
      const bf = brownField(x, y);
      const lowerHalf = clamp((tt - 0.4) / 0.6, 0, 1);
      const brownP = clamp((bf - 0.45) * 3.2, 0, 1) * (0.3 + 0.7 * lowerHalf) + (Math.abs(x - cx) < 2 && tt > 0.55 ? 0.35 : 0);
      col = coniferColor(lev, rn, P.lean, zone, brownP);
    } else {
      const brownP = tt > 0.55 && dist[k] > 1 ? 0.16 * Math.max(0, vnoise(x / 3, y / 3, s2 + 7) - 0.4) * 3 : 0;
      col = rn() < brownP ? pick(rn, [61, 62, 60, 59]) : broadColor(lev, rn, P.lean, zone, clumpBoost(x, y) > 1.0);
    }
    put(body, x, y, col);
  }
  return { body: cropSprite(body, 0), cx, H, W };
}

function byQuantile(table, v) { // table of [value, weight], ordered; v in 0..1 spreads values spatially
  let sum = 0; for (const [, w] of table) sum += w; let x = clamp(v, 0, 0.9999) * sum;
  for (const [i, w] of table) { x -= w; if (x < 0) return i; }
  return table[table.length - 1][0];
}
const BURNT_TABLE = [[245, 1.5], [63, 1.5], [79, 1], [47, 12.5], [46, 6.7], [45, 6.8], [95, 14.7], [94, 9.1], [62, 6], [61, 4], [172, 3], [173, 2.5], [175, 1], [60, 2], [93, 9.3], [92, 3.5], [59, 2], [91, 3], [90, 2.2], [89, 1.2], [88, 0.6], [87, 0.4], [57, 0.6], [55, 0.4], [44, 1], [43, 0.5]];
// ---- burnt trees (skeletons) ------------------------------------------------------------------------------------
const BURNT_DEFAULTS = { species: 'broadleaf', height: 53, width: 0.62, forks: 3, ash: 0.5, energy: [50, 50] };
const CONIFER_DEAD = [[245, 1.5], [63, 1], [47, 13], [175, 1.5], [46, 12], [62, 5], [45, 10], [94, 4], [61, 1.5], [172, 2], [173, 2], [44, 3], [93, 11], [43, 1.5], [92, 3], [91, 2.5], [89, 2], [88, 1.5]];   // dark to light
// A sparse, narrow, tapering needle skeleton (spec 15 B3): dark trunk, short twigs, needle tufts, gaps; near-black greens and grays.
function burntConiferFrame(P, seed) {
  const r = rng(seed), rn = rng(mix32(seed, 5));
  const H = Math.round(P.height), W = Math.round(H * P.width), w = W + 8, h = H + 4, cx = w / 2 + (r() - 0.5), ax = Math.round(cx), ay = h - 3;
  const sp = newSprite(w, h, ax, ay), s1 = (r() * 1e6) | 0, Wh = W / 2, y0 = ay - H + 1;
  const target = Math.round(0.38 * W * H * (0.94 + 0.12 * r()));
  const hw0 = t => Wh * (0.1 + 0.9 * Math.pow(clamp(t / 0.62, 0, 1), 0.85)) * (t > 0.62 ? 1 - 0.22 * (t - 0.62) / 0.38 : 1);
  const asym = (y, side) => 1 + side * 0.12 + (vnoise(y / 3.2, side * 7, s1 + 3) - 0.5) * 0.55;   // a ragged, lopsided envelope
  const hw = t => hw0(t);
  const forced = new Set(), cand = [];
  for (let y = y0; y <= ay; y++) {              // trunk
    const t = (y - y0) / H;
    if (t > 0.04 && (t > 0.85 || r() < 0.82)) forced.add(y * w + ax);   // a thin trunk, visible through the needles
  }
  for (let y = y0 + 4; y < ay - 2; y += 2 + (r() < 0.4 ? 1 : 0)) {          // short twigs, alternating sides
    const t = (y - y0) / H, side = (y & 1) ? 1 : -1, len = Math.max(1, Math.round(hw(t) * (0.55 + 0.7 * r())));
    for (let i = 1; i <= len; i++) forced.add((y + (i > 2 && r() < 0.3 ? 1 : 0)) * w + ax + side * i + (side > 0 ? 1 : 0));
  }
  for (let y = y0; y <= ay - 1; y++) {
    const t = (y - y0) / H, half = hw(t);
    for (let x = Math.floor(cx - half * 1.5) - 1; x <= Math.ceil(cx + half * 1.5) + 1; x++) {
      const sd = x < cx ? -1 : 1, hs = half * asym(y, -sd * 0.5), k = y * w + x, edge = Math.abs(x - cx) / Math.max(hs, 1);
      if (forced.has(k) || edge > 1.05) continue;
      cand.push([0.5 * vnoise(x / 2.4, y / 1.2, s1) + 0.5 * rn() + 0.25 * edge * edge, k]);
    }
  }
  cand.sort((a, b) => a[0] - b[0]);
  const chosen = new Set(forced); for (let i = 0; chosen.size < target && i < cand.length; i++) chosen.add(cand[i][1]);
  for (const k of chosen) {
    const x = k % w, y = (k / w) | 0; if (y < 0 || y >= h) continue;
    const trunk = x === ax || x === ax + 1;
    const lit = clamp(-(x - cx) / Math.max(Wh, 1), -1, 1), v = clamp(0.35 * vnoise(x / 2, y / 2, s1 + 9) + 0.65 * rn() + 0.3 * lit, 0, 1);   // lit from the left
    put(sp, x, y, trunk && rn() < 0.55 ? weighted(rn, [[62, 4], [95, 3], [47, 3], [46, 2]]) : byQuantile(CONIFER_DEAD, v));
  }
  return { body: cropSprite(sp, 0) };
}
const BROAD_DEAD = [[245, 3], [127, 2], [95, 24], [47, 13], [62, 8], [94, 14], [61, 4], [45, 2.5], [43, 2], [93, 6], [60, 2.5], [92, 2.5], [90, 1], [89, 1], [71, 1], [72, 1], [67, 0.6]];
// Spec 16.3: a heavy gnarled dead trunk (flared base, 8-13 px, widest 10-17 px where 2-4 limbs fork at 20-60 degrees), short
// segments, 1 px twigs, 10-12 tips mostly in the top third; grays and near-black, warm browns at the base, lit on the left.
function burntFrame(P, seed, ctx) {
  if (P.species === 'conifer') return burntConiferFrame(P, seed);
  const r = rng(seed), rn = rng(mix32(seed, 5));
  const H = Math.round(P.height), W = Math.round(H * P.width), w = W + 12, h = H + 4, ax = Math.round(w / 2), ay = h - 3, y0 = ay - H + 1;
  const sp = newSprite(w, h, ax, ay), mask = new Uint8Array(w * h), s1 = (r() * 1e6) | 0;
  const wob = y => (fbm(y / 9, 3, s1, 2) - 0.5) * 4.2;
  const stamp = (x, y, wd) => { const rad = Math.max(0.5, wd / 2); for (let dy = -Math.ceil(rad); dy <= Math.ceil(rad); dy++) for (let dx = -Math.ceil(rad); dx <= Math.ceil(rad); dx++) if (dx * dx + dy * dy <= rad * rad + 0.25) { const px = Math.round(x + dx), py = Math.round(y + dy); if (px >= 0 && py >= 0 && px < w && py < h) mask[py * w + px] = 1; } };
  // trunk from the base to the fork: flare 10-14 at the base, 8-13 above, widest at the fork
  const yFork = ay - Math.round(H * 0.52);
  for (let y = ay; y >= yFork; y--) {
    const t = (ay - y) / (ay - yFork), flare = y >= ay - 3 ? (y === ay ? 3 : 12 - (ay - y) * 0.7) : 0;
    const wd = Math.max(flare, lerp(13, 8.8, t) * (0.9 + 0.2 * vnoise(y / 4, 1, s1 + 4)) + (y > ay - 6 ? 1.5 : 0));
    const xc = ax + wob(y) * (1 - 0.4 * (1 - t));
    for (let x = Math.floor(xc - wd / 2 - 1); x <= Math.ceil(xc + wd / 2 + 1); x++) { const edge = Math.abs(x - xc) - wd / 2 + (vnoise(x / 1.8, y / 1.8, s1 + 9) - 0.5) * 2.2; if (edge <= 0) mask[y * w + x] = 1; }
  }
  const xFork = ax + wob(yFork);
  // Round 4 (compared with Tree1-3Dead): few thick limbs that kink and splay sideways before turning up, one heavier side, no even crown of
  // upright twigs. A main limb continues the trunk; 2-3 side limbs leave nearly horizontally; short stubs; forks only near the ends.
  const nL = clamp(Math.round(P.forks) + 1, 3, 5), tips = [];
  const limb = (x, y, ang, len, wd, depth) => {
    let left = len;
    while (left > 0) {
      const sl = Math.min(left, 4 + r() * 3.5), nx = x + Math.sin(ang) * sl, ny = y - Math.cos(ang) * sl, n = Math.ceil(sl * 2);
      for (let k = 0; k <= n; k++) { const f = k / n; stamp(lerp(x, nx, f), lerp(y, ny, f), lerp(wd, Math.max(1.3, wd * 0.88), f)); }
      x = nx; y = ny; left -= sl; wd = Math.max(1.3, wd * 0.88);
      ang = ang * 0.8 + (r() - 0.5) * 0.9;                       // kinked, drifting back toward vertical
      if (r() < 0.6) { const sd = r() < 0.5 ? -1 : 1, tl = 2 + Math.floor(r() * 3); for (let t = 1; t <= tl; t++) stamp(x + sd * t, y - t * 0.8, 1); }   // 1 px twigs
      if (depth < 3 && left > 5 && r() < 0.5) limb(x, y, ang + (r() < 0.5 ? -1 : 1) * (0.6 + r() * 0.6), left * 0.7, Math.max(1.3, wd * 0.75), depth + 1);
      if (y < y0 + 2) break;
    }
    tips.push([x, y]);
    stamp(x, y - 1, 1);
  };
  const lean = (r() - 0.5) * 0.7;
  limb(xFork, yFork + 1, lean, (yFork - y0) * 1.02, 3.0, 0);                           // the main limb carries on up
  const side = r() < 0.5 ? -1 : 1;
  for (let i = 0; i < nL; i++) {
    const sd = i % 2 ? -side : side, yS = yFork + 3 - Math.round(r() * 6) - i * 3;
    limb(xFork + sd * 2, yS, sd * (1.0 + r() * 0.5), 12 + r() * 12 + (sd === side ? 4 : 0), 2.1 + r() * 0.8, 1);
  }
  for (let k = 0; k < 2 + Math.round(r() * 2); k++) { const yy = ay - 8 - Math.round(r() * (ay - yFork)), sd = r() < 0.5 ? -1 : 1; for (let t = 0; t < 4; t++) stamp(xFork + sd * (5 + t), yy - Math.floor(t / 2), 1.5); }   // stubs on the trunk
  for (let k = 0; k < Math.round(4 + 6 * P.ash); k++) {          // broken twig bits near the tips
    const t = tips[(r() * tips.length) | 0]; if (t) { const x = Math.round(t[0] + (r() - 0.5) * 6), y = Math.round(t[1] + (r() - 0.5) * 5); if (x >= 0 && y >= 0 && x < w && y < h) mask[y * w + x] = 1; }
  }
  { // squeeze the limbs in so the tree is the asked width (retail 27-40)
    let half = 1; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) half = Math.max(half, Math.abs(x - ax));
    const k2 = Math.min(1, (W / 2) / half);
    if (k2 < 1) { const m2 = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { const kk = lerp(1, k2, clamp(((ay - y) / H) * 1.6 - 0.3, 0, 1)); m2[y * w + Math.round(ax + (x - ax) * kk)] = 1; } mask.set(m2); }
  }
  const dist = edgeDist(w, h, mask);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x; if (!mask[k]) continue;
    const xc = ax + wob(y), lit = clamp(-(x - xc) / 8, -1, 1), base = y >= ay - 6;
    let v = 0.4 * vnoise(x / 2.2, y / 2.2, s1 + 21) + 0.6 * rn() + 0.17 * lit + (dist[k] <= 1 ? -0.05 : 0.04);
    let c = byQuantile(BROAD_DEAD, v);
    if (base && rn() < 0.38) c = weighted(rn, [[62, 4], [61, 3], [60, 2], [71, 1.5], [72, 1.5]]);
    if (rn() < P.ash * 0.006) c = pick(rn, [89, 90, 88]);
    put(sp, x, y, c);
  }
  return { body: cropSprite(sp, 0) };
}

// ---- shrubs ----------------------------------------------------------------------------------------------------
const SHRUB_DEFAULTS = { width: 28, height: 19, density: 0.55, lean: 0, energy: [20, 20] };
// Spec 15 B4: density 0.12 is the sparse Shrub3 (fill 0.17, about 24 small blobs); density 0.5 and up is the dense
// Shrub1/2 (fill 0.36-0.39, one mass holding 75% of the pixels). Texture is single-pixel speckle of 6-7 greens
// with the dark 173 as the under-leaf shade on every edge.
function shrubFrame(P, seed, ctx) {
  const r = rng(seed), rn = rng(mix32(seed, 6));
  const W = Math.round(P.width), H = Math.round(P.height), w = W + 6, h = H + 8, cx = w / 2, cy = (h - 6) / 2 + 1;
  const ax = Math.round(cx) + (r() < 0.5 ? 0 : -1), ay = h - 5;
  const sp = newSprite(w, h, ax, ay), occ = new Uint8Array(w * h);
  const dd = clamp(P.density / 0.5, 0, 1), fill = lerp(0.15, 0.43, dd), N = Math.round(fill * W * H);
  const s1 = (r() * 1e6) | 0;
  const env = (x, y) => { const e = ((x - cx) / (W / 2)) ** 2 + ((y - cy) / (H / 2)) ** 2; return e * 0.85 + (vnoise(x / 3, y / 3, s1) - 0.5) * 0.3 <= 1; };
  const inside = []; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (env(x, y)) inside.push([x, y]);
  // an irregular scatter of small leaf clumps (1-6 px). Dense shrubs overlap and attach into one mass; sparse ones stay apart.
  const clumps = [], cellAt = new Map(); let total = 0;
  const hi = P.lean > 0 ? 1.6 : 1, near = (x, y, d) => { for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) if (occ[(y + dy) * w + x + dx]) return true; return false; };
  for (let tries = 0; total < N && tries < 4000; tries++) {
    let [sx, sy] = inside[(r() * inside.length) | 0];
    const e = ((sx - cx) / (W / 2)) ** 2 + ((sy - cy) / (H / 2)) ** 2;
    if (r() > 1 - 0.5 * e) continue;                                  // fewer clumps at the rim, none missing in the middle
    const has = near(sx, sy, 2);
    if (dd > 0.5 ? (!has && total > 12 && r() < 0.8) : (has && r() < 0.65)) continue;    // dense: attach; sparse: keep apart
    const n = Math.min(N - total, dd > 0.5 ? 1 + Math.floor(r() * r() * 6.5) : 2 + Math.floor(r() * 7)), cells = [];
    let x = sx, y = sy;
    for (let k = 0; k < n; k++) {
      if (!occ[y * w + x] && env(x, y)) { occ[y * w + x] = 1; cells.push([x, y]); }
      const [dx, dy] = pick(r, [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 0], [-1, 0]]); x += dx; y += dy;
      if (x < 1 || y < 1 || x >= w - 1 || y >= h - 2) break;
    }
    if (cells.length) { clumps.push(cells); total += cells.length; }
  }
  for (const cells of clumps) {
    const has = (x, y) => cells.some(c => c[0] === x && c[1] === y);
    for (const [x, y] of cells) {
      const under = !has(x, y + 1), upper = !has(x, y - 1);
      let c;
      if (under) c = rn() < 0.42 ? 173 : weighted(rn, [[165, 5], [167, 2], [164, 3], [163, 2], [169, 1]]);        // the darker underside
      else if (upper) c = weighted(rn, [[163, 32 * hi], [164, 14], [165, 32], [162, 4 * hi], [167, 4], [166, 1]]);   // lit yellow-green top
      else c = weighted(rn, [[165, 34], [167, 10], [164, 8], [163, 8], [166, 3], [168, 2], [173, 4]]);
      put(sp, x, y, c);
    }
  }
  return { body: cropSprite(sp, 0) };
}

// ---- rocks -----------------------------------------------------------------------------------------------------
const ROCK_DEFAULTS = { cells: '2x2', size: 1, angular: 0.8, shade: 0.6, lean: 0, metal: null };   // shade: 0 soft .. 1 strong shading away from the sun (retail Green 0.6)
const ROCK_CELLS = { '1x1': [1, 1], '2x2': [2, 2], '3x2': [3, 2], '3x3': [3, 3], '4x3': [4, 3] };
function rockFrame(P, seed, ctx) {
  const L = lightOf(ctx), r = rng(seed), rn = rng(mix32(seed, 9));
  const [fw, fh] = ROCK_CELLS[P.cells] || [2, 2];
  let W, H;
  if (fw === 1) { W = Math.round(lerp(8, 21, clamp(P.size, 0, 1.4) / 1.4)); H = Math.round(W * (0.82 + r() * 0.15)); }
  else { W = Math.round(fw * 16 * (0.94 + 0.1 * r()) * P.size); H = Math.round(W * (0.62 + r() * 0.2)); }
  const w = W + 6, h = H + 6, cx = w / 2, cy = h / 2 + 0.5;
  const ax = Math.round(cx + (r() - 0.5) * 3), ay = Math.round(3 + H * (0.18 + r() * 0.2));
  const sp = newSprite(w, h, ax, ay);
  const nv = Math.round(lerp(11, 6, P.angular));
  const verts = []; for (let i = 0; i < nv; i++) verts.push(0.98 + r() * 0.3);   // a lumpy angular polygon: flat-ish sides and corners
  const ph = r() * TAU, f1 = r() * TAU, f2 = r() * TAU, a2 = 0.05 + 0.07 * r(), a3 = 0.04 * r();
  const radial = th => {
    const f = (th / TAU + 4) % 1 * nv, i = Math.floor(f), t = f - i;
    const poly = lerp(verts[i % nv], verts[(i + 1) % nv], t);
    const smooth = 1 + a2 * Math.cos(2 * th + f1) + a3 * Math.cos(3 * th + f2);
    return lerp(smooth, poly, P.angular);
  };
  const PV = []; for (let i = 0; i < nv; i++) { const a = (i + (r() - 0.5) * 0.55) / nv * TAU + ph, rr0 = verts[i] * 1.0; PV.push([Math.cos(a) * rr0 * 1.13, Math.sin(a) * rr0 * 1.13]); }
  const Wh = W / 2, Hh = H / 2, mask = new Uint8Array(w * h), tilt0 = (r() < 0.5 ? -1 : 1) * (0.15 + 0.3 * r());
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ux = (x - cx) / Wh, uy = (y - cy) / Hh, dx = ux * Math.cos(tilt0) + uy * Math.sin(tilt0), dy = -ux * Math.sin(tilt0) + uy * Math.cos(tilt0);   // a tilted oval
    let inside = false;      // true polygon: chords between corners, not a rounded blend
    for (let i = 0, j = nv - 1; i < nv; j = i++) { const [xi, yi] = PV[i], [xj, yj] = PV[j]; if ((yi > dy) !== (yj > dy) && dx < (xj - xi) * (dy - yi) / (yj - yi) + xi) inside = !inside; }
    if (inside && (1 + 0.1 * (fbm(x / 4, y / 4, seed) - 0.5)) > 0.9) mask[y * w + x] = 1;
  }
  const dist = edgeDist(w, h, mask);
  // One smoothly shaded, slightly lumpy, tilted oblong (spec 15 B1, round 3): light falls off continuously from the sun side to a dark
  // far side; cream, pink and white appear as soft mottling and broad highlight areas inside the shading, never as flat patches.
  const tilt = (r() - 0.5) * 0.5, ct = Math.cos(tilt), st = Math.sin(tilt), hasPx = [];
  const zf = (x, y) => {
    const dx = (x - cx) / Wh, dy = (y - cy) / Hh, ex = dx * ct + dy * st, ey = -dx * st + dy * ct;
    const dome = Math.sqrt(Math.max(0.02, 1 - (ex * ex + ey * ey) * 0.9));
    return (dome + (fbm(x / 7, y / 7, seed + 3, 3) - 0.5) * (0.2 + 0.3 * P.angular) + (fbm(x / 3.2, y / 3.2, seed + 5, 2) - 0.5) * 0.04) * Hh * 1.15;
  };
  // a few broad tonal planes: soft offsets of the tone so the shading has flat areas, not a smooth dome
  const planes = []; for (let i = 0; i < 3 + Math.round(P.angular * 2); i++) planes.push({ x: cx + (r() - 0.5) * W * 0.8, y: cy + (r() - 0.5) * H * 0.8, o: (r() - 0.5) * 0.3 });
  const planeOff = (x, y) => { let b = 0, bd = 1e9; planes.forEach((p, i) => { const d = Math.hypot(p.x - x, p.y - y) + (vnoise(x / 4, y / 4, seed + i) - 0.5) * 4; if (d < bd) { bd = d; b = i; } }); return planes[b].o; };
  const tone = new Float32Array(w * h), lowerRight = k => { const x = k % w, y = (k / w) | 0; return (x - cx) * -L.x + (y - cy) * -L.y > 0; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x; if (!mask[k]) continue;
    const zx = zf(x + 1, y) - zf(x - 1, y), zy = zf(x, y + 1) - zf(x, y - 1), nn = Math.hypot(zx, zy, 2);
    let t = (-zx / nn) * L.v[0] + (-zy / nn) * L.v[1] + (2 / nn) * L.v[2];
    t += 0.2 * (L.x * (x - cx) / Wh) + 0.03 * (L.y * (y - cy) / Hh);                       // broad fall-off from the sun side
    if (y > h * 0.78) t -= ((y / h - 0.78) / 0.22) * 0.05;                            // moderately dark base
    if (dist[k] <= 1) t -= lowerRight(k) ? 0.5 : 0.38;                                   // a dark one-pixel rim all round, stronger on the shadow side
    { const dd = ((x - cx) * -L.x + (y - cy) * -L.y) / (Wh * 0.7 + Hh * 0.7); t -= P.shade * 0.5 * Math.max(0, dd - 0.1); }   // the shade side falls off harder with the shading control
    { // a darker vertical front face below the lit top: the side facing the viewer, with a soft ridge where the top face ends
      const yb = cy + (0.06 + 0.2 * vnoise(x / 7, 3, seed + 91) + 0.1 * vnoise(x / 2.5, 5, seed + 92)) * Hh, below = (y - yb) / (0.4 * Hh);
      if (below > 0) t -= 0.24 * Math.min(1, below) * (0.7 + 0.3 * P.shade);
      else if (below > -0.12) t += 0.04;      // the lit edge of the top face
    }
    if (t < 0.45) t = 0.45 + (t - 0.45) * 0.45;                                             // the shade never goes to black over the whole base
    tone[k] = t + planeOff(x, y) + (rn() - 0.5) * 0.02; hasPx.push(k);
  }
  const ranked = hasPx.slice().sort((a, b) => tone[b] - tone[a]), N = ranked.length, soft = () => (rn() + rn() - 1) * 0.1;
  const bright = (list, u) => list[clamp(Math.floor((1 - u) * list.length), 0, list.length - 1)];
  const CREAM = [64, 64, 64, 65, 65, 66], PINKS = [17, 18, 18, 19, 20, 21], WHITES = [255, 81, 82, 83, 84];   // no olive-dark tans (68-70): retail rocks have no yellow-green specks
  const hiEnd = 0.383 - 0.08 * (P.shade - 0.5), litEnd = hiEnd + 0.18, midEnd = litEnd + 0.245 + 0.04 * (P.shade - 0.5);
  // the mottling field: pink where a soft noise is high (about 39% of the non-white highlight)
  const mott = k => vnoise((k % w) / 2.2, ((k / w) | 0) / 2.2, seed + 77) * 0.7 + fbm((k % w) / 9, ((k / w) | 0) / 9, seed + 78, 2) * 0.6;   // soft areas of pink inside the cream, not confetti
  const hiList = ranked.slice(0, Math.round(N * hiEnd)).filter((k, i) => i >= Math.round(N * hiEnd * 0.27)).map(k => mott(k)).sort((a, b) => a - b);
  const pinkCut = hiList[Math.floor(hiList.length * 0.39)] ?? 0.5;
  ranked.forEach((k, i) => {
    const u = clamp(i / N + soft(), 0, 0.9999);
    let c;
    if (u < hiEnd) {
      const v = u / hiEnd;
      if (v < 0.4) c = bright(WHITES, 1 - v / 0.4 * 0.8 - 0.1 + (rn() - 0.5) * 0.2);                                      // the broad highlight
      else { const f = (v - 0.4) / 0.6, pinkish = mott(k) + (rn() - 0.5) * 0.3 < pinkCut * 0.9; c = pinkish ? bright(PINKS, 1 - (1 - f) * 0.8 - 0.1 + (rn() - 0.5) * 0.12) : (rn() < 0.35 ? bright(WHITES.slice(1), rn()) : bright(CREAM, 1 - (1 - f) * 0.9 - 0.05 + (rn() - 0.5) * 0.12)); }
    } else if (u < litEnd) { c = bright([85, 86, 87, 88, 89], 1 - (u - hiEnd) / (litEnd - hiEnd) + (rn() - 0.5) * 0.3); if (mott(k) + (rn() - 0.5) * 0.1 < pinkCut * 0.8) c = bright([17, 18, 18, 20], 1 - (u - hiEnd) / (litEnd - hiEnd)); }   // a subtle pink wash through the lit gray
    else if (u < midEnd) c = bright([92, 91, 90], (u - litEnd) / (midEnd - litEnd) + (rn() - 0.5) * 0.4);
    else { const f = (u - midEnd) / (1 - midEnd); c = rn() < 0.1 ? weighted(rn, [[127, 3], [125, 1]]) : bright([93, 94, 95], 1 - f + (rn() - 0.5) * 0.3); }
    { const dd = (((k % w) - cx) * -L.x + (((k / w) | 0) - cy) * -L.y) / (Wh * 0.7 + Hh * 0.7);
      if (dd > 0.28 && (c === 255 || (c >= 81 && c <= 84) || (c >= 64 && c <= 67) || (c >= 17 && c <= 21) || (c >= 85 && c <= 88))) c = pick(rn, [90, 91, 92, 91, 93]); }   // never a bright or highlight pixel in the shaded lower right
    if (dist[k] > 1 && k / w > h * 0.82 && (c === 93 || c === 94 || c === 95 || c === 127 || c === 125) && rn() < 0.75) c = pick(rn, [91, 90, 92, 89, 91]);   // a moderately dark base, not black
    put(sp, k % w, (k / w) | 0, c);
  });
  const body = sp;
  return { body, W, H };
}

// ---- smudges and stains (scars) ------------------------------------------------------------------------------------
const SCAR_DEFAULTS = { type: 'smudge', size: 1, density: 0.55 };
function scarFrame(P, seed, ctx) {
  const r = rng(seed), rn = rng(mix32(seed, 3));
  if (P.type === 'stain') {
    // Rockgone: a dark stipple ellipse (this is the shadow sprite) and gray pebbles (the body)
    const W = Math.round(lerp(22, 56, clamp((P.size - 0.3) / 1.2, 0, 1))), H = Math.round(W * (0.62 + 0.15 * r()));
    const w = W + 6, h = H + 6, ax = Math.round(w / 2), ay = Math.round(h / 2 + 1);
    const ell = newSprite(w, h, ax, ay), peb = newSprite(w, h, ax, ay);
    const s1 = (r() * 1e6) | 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = (x - ax) / (W / 2), dy = (y - ay) / (H / 2), rr = Math.hypot(dx, dy) * (1 + 0.12 * (fbm(x / 5, y / 5, s1) - 0.5) * 2);
      if (rr > 1) continue;
      const dens = (0.5 * Math.pow(1 - rr, 0.9) + 0.06) * (0.6 + P.density);
      if (r() < dens * 1.1) put(ell, x, y, weighted(r, [[47, 58], [95, 32], [94, 10]]));
      if (r() < dens * 0.085 * (rr < 0.8 ? 1 : 0.4)) {
        const c = weighted(r, [[91, 3], [92, 3], [90, 3], [89, 2], [88, 2], [93, 2], [87, 1], [125, 0.5], [18, 0.5], [59, 0.5]]), n = r() < 0.55 ? 1 : r() < 0.6 ? 2 : 3;
        put(peb, x, y, c); if (n > 1) put(peb, x + (r() < 0.5 ? 1 : -1), y, c); if (n > 2) put(peb, x, y + 1, c);
      }
    }
    return { body: cropSprite(peb, 0), shadow: cropSprite(ell, 0), anchorBody: [ax, ay] };
  }
  const W = Math.round(lerp(17, 27, clamp(P.size / 1.3, 0, 1))), H = Math.round(W * (0.7 + 0.1 * r()));
  const w = W + 4, h = H + 4, ax = Math.round(w / 2), ay = Math.round(h / 2);
  const sp = newSprite(w, h, ax, ay), s1 = (r() * 1e6) | 0, s2 = (r() * 1e6) | 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (x - ax) / (W / 2), dy = (y - ay) / (H / 2);
    const warp = (fbm(x / 4, y / 4, s1, 2) - 0.5) * 0.55 + (vnoise(x / 1.5, y / 1.5, s2) - 0.5) * 0.28;
    const rr = Math.hypot(dx, dy) + warp;
    if (rr > 1.12) continue;
    const core = 1 - rr;                              // 1 centre .. 0 edge
    const keep = core > 0.3 ? 1 : clamp(0.1 + core * (P.density + 0.4) * 2.2, 0, 1);
    if (rn() > keep * (0.72 + 0.35 * P.density)) continue;
    const t = core + 0.25 * (vnoise(x / 2.2, y / 2.2, s2 + 3) - 0.5) + 0.1 * (rn() - 0.5);
    const col = t > 0.72 ? 245 : t > 0.5 ? 63 : t > 0.34 ? 92 : t > 0.22 ? 93 : t > 0.1 ? 91 : 94;
    put(sp, x, y, col);
  }
  return { body: cropSprite(sp, 0), translucent: true };
}

// ---- gameplay ------------------------------------------------------------------------------------------------------
function pickValue(range, sizeFrac, r) {
  // a [lo, hi] range: the value tracks size where size is known, else uniform; a fixed range gives the fixed value
  const [lo, hi] = range;
  if (lo === hi) return lo;
  const t = sizeFrac === undefined ? r() : clamp(sizeFrac + (r() - 0.5) * 0.2, 0, 1);
  return Math.round(lerp(lo, hi, t));
}

// ---- public API ------------------------------------------------------------------------------------------------
export const DEFAULTS = { tree: TREE_DEFAULTS, burnt: BURNT_DEFAULTS, shrub: SHRUB_DEFAULTS, rock: ROCK_DEFAULTS, scar: SCAR_DEFAULTS };
// Artist-facing controls per kind: [key, min, max, default, what it changes]
export const CONTROLS = {
  tree: [['species', 'broadleaf|conifer', null, 'broadleaf', 'leafy crown or narrow conifer'], ['height', 55, 72, 68, 'size in px (broadleaf 66-71, conifer 57-64 in retail)'], ['width', 0.42, 0.74, 0.7, 'width over height'], ['crown', 0, 1, 0.6, 'smooth to lobed, ragged silhouette'], ['density', 0, 1, 0.6, 'solid to holey and sparse'], ['taper', 0, 1, 0.5, 'broadleaf crown: round top to narrowing toward the top (biome knob)'], ['peaks', 0, 1, 0.5, 'broadleaf crown: smooth top to irregular peaks (biome knob)'], ['lean', -1, 1, 0, 'olive and yellow, to lush and bright'], ['energy', '[lo,hi]', null, '[250,250]', 'gameplay energy range; tracks height inside the range']],
  burnt: [['height', 50, 66, 58, 'size in px'], ['width', 0.4, 0.75, 0.55, 'width over height'], ['forks', 2, 5, 3, 'branch forks off the trunk'], ['ash', 0, 1, 0.5, 'amount of pale ash pixels']],
  shrub: [['width', 20, 36, 29, 'width in px'], ['height', 14, 28, 22, 'height in px'], ['density', 0, 1, 0.5, 'sparse scatter to full clump'], ['lean', -1, 1, 0, 'brightness of the leaf highlights']],
  rock: [['cells', '1x1|2x2|3x2|3x3|4x3', null, '2x2', 'footprint class, sets the pixel size and the metal'], ['shade', 0, 1, 0.6, 'soft to strong shading away from the sun'], ['size', 0.7, 1.15, 1, 'scale inside the class'], ['angular', 0, 1, 0.6, 'round boulder to faceted block']],
  scar: [['type', 'smudge|stain', null, 'smudge', 'scorch blot or rock stain'], ['size', 0.3, 1.3, 1, 'size'], ['density', 0, 1, 0.55, 'stipple density']],
  deposit: [['metal', 86, 223, 127, 'metal value; sets the chunk count (7 to 23) and the halo']],
  vent: [['size', 0.6, 1.6, 1, 'crack length and thickness'], ['forks', 2, 4, 3, 'how often the crack forks']],
};
const NAMES = { tree: 'Tree', burnt: 'TreeDead', shrub: 'Shrub', rock: 'Rock', scar: 'Smudge' };

// ctx.bodyOnly skips the burn sequence and the burnt successor (the editor's view needs only body and shadow; export needs them all).
// Body, shadow and gameplay do not depend on it: each draws from its own seeded stream.
export function generateFeature(kind, params = {}, seed = 1, ctx = {}) {
  const P = { ...DEFAULTS[kind], ...params };
  const rr = rng(mix32(seed, 0xBEEF));
  let body, shadow = null, bodyBlend = 1, burn = null, burnt = null, gameplay = {}, footprint = [1, 1];
  const L = lightOf(ctx);
  if (kind === 'tree') {
    const conifer = P.species === 'conifer';
    const T = treeFrame(P, seed, ctx);
    body = T.body;
    shadow = makeShadow(body, { side: L.shadowSide, shx: conifer ? 0.62 : 0.5, up: conifer ? 0.7 : 0.66, colors: TREE_SHADOW_COLORS, soften: 2 }, rng(mix32(seed, 41)));
    const bp = { species: P.species, height: Math.round(P.height * (conifer ? 0.88 : 0.78)), width: conifer ? 0.5 : 0.62, forks: 3, ash: 0.5 };
    if (!ctx.bodyOnly) { burnt = generateFeature('burnt', bp, mix32(seed, 6), ctx); burn = treeBurn(body, burnt.body, seed, conifer); }   // the view draws only body and shadow
    const sizeFrac = clamp((P.height - 55) / 17, 0, 1);
    gameplay = { energy: pickValue(P.energy, sizeFrac, rr), metal: 0, blocking: true, reclaimable: true, flamable: true, burnTicks: 192, spreadChance: conifer ? 30 : 90 };
  } else if (kind === 'burnt') {
    const B = burntFrame(P, seed, ctx);
    body = B.body;
    shadow = makeShadow(body, { side: L.shadowSide, shx: 0.55, up: 0.6, colors: TREE_SHADOW_COLORS, soften: 0, grow: 0.15 }, rng(mix32(seed, 42)));
    gameplay = { energy: pickValue(P.energy, undefined, rr), metal: 0, blocking: true, reclaimable: true, flamable: false };
  } else if (kind === 'shrub') {
    body = shrubFrame(P, seed, ctx).body;
    if (!ctx.bodyOnly) burn = shrubBurn(body, seed);
    gameplay = { energy: pickValue(P.energy, undefined, rr), metal: 0, blocking: false, reclaimable: true, flamable: true, burnTicks: 84, spreadChance: 30 };
  } else if (kind === 'rock') {
    const R = rockFrame(P, seed, ctx);
    body = R.body;
    const [fw, fh] = ROCK_CELLS[P.cells] || [2, 2];
    footprint = [fw, fh];
    shadow = offsetShadow(body, L.shadowSide * body.w * 0.2, body.h * 0.12, 1, ROCK_SHADOW_COLORS, rng(mix32(seed, 43)));
    const cellsN = fw * fh, metalDefault = Math.round((7.6 * cellsN + 22.5) / 25) * 25;
    gameplay = { energy: 0, metal: P.metal ?? Math.max(25, Math.min(100, metalDefault)), metalLinear: Math.round(7.6 * cellsN + 22.5), hp: 2000, blocking: true, reclaimable: true };
  } else if (kind === 'scar') {
    const S = scarFrame(P, seed, ctx);
    body = S.body; shadow = S.shadow || null;
    if (S.translucent) bodyBlend = 0.5;
    gameplay = { energy: 0, metal: 0, blocking: false, reclaimable: false };
  } else throw new Error('unknown kind ' + kind);
  return {
    kind, name: `${NAMES[kind]}_${(seed >>> 0).toString(36)}`, seed, params: P, footprint, body, shadow,
    shadowBlend: 0.5, bodyBlend, burn, burnt: kind === 'tree' ? burnt : null, gameplay,
  };
}
export function generateVariants(kind, count, params = {}, baseSeed = 1, ctx = {}) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(generateFeature(kind, params, mix32(baseSeed, i + 1), ctx));
  return out;
}
// Placement: pick one of the variants at random (a re-roll is another call with another rng seed).
export function pickVariant(variants, seed) { return variants[Math.floor(rng(mix32(seed, 0xA11CE))() * variants.length)]; }

// ---- ground painting: deposits and vents ----------------------------------------------------------------------------
// ground: {w, h, rgba: Uint8ClampedArray}; the painted pixels are palette colors fitted to the ground under them.
function paletteSearch(palette) {
  const cands = []; for (let i = 0; i < 256; i++) if (i !== 9 && i < 192 || i > 215) cands.push(i);
  return (r, g, b) => {
    let best = 0, bd = 1e12;
    for (const i of cands) { const c = palette[i], d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2; if (d < bd) { bd = d; best = i; } }
    return best;
  };
}
const MOSS_RGB = [[31, 79, 11], [43, 103, 19], [35, 91, 15], [23, 51, 0], [19, 63, 0], [15, 39, 0], [35, 31, 19], [47, 43, 27]];
function groundMean(g, cx, cy, rad) {
  let r = 0, gg = 0, b = 0, n = 0;
  for (let y = Math.max(0, cy - rad); y < Math.min(g.h, cy + rad); y++) for (let x = Math.max(0, cx - rad); x < Math.min(g.w, cx + rad); x++) { const k = (y * g.w + x) * 4; r += g.rgba[k]; gg += g.rgba[k + 1]; b += g.rgba[k + 2]; n++; }
  return n ? [r / n, gg / n, b / n] : [70, 110, 40];
}
function setGround(g, x, y, rgb) { if (x < 0 || y < 0 || x >= g.w || y >= g.h) return; const k = (y * g.w + x) * 4; g.rgba[k] = rgb[0]; g.rgba[k + 1] = rgb[1]; g.rgba[k + 2] = rgb[2]; g.rgba[k + 3] = 255; }
function getGround(g, x, y) { const k = (clamp(y, 0, g.h - 1) * g.w + clamp(x, 0, g.w - 1)) * 4; return [g.rgba[k], g.rgba[k + 1], g.rgba[k + 2]]; }

export const DEPOSIT_DEFAULTS = { metal: 127, style: 'retail', look: 'auto' };   // style 'retail' (angular plates) or 'pebbles' (round-1 round pebbles, an artist option); look 'auto' | 'cluster' | 'plates'
const STONE_CLASSES = [
  { w: 0.29, ramp: [[216, 3], [224, 3], [145, 4], [114, 5], [130, 2]] },        // pale: lilac-white, pink-lilac, pale blue
  { w: 0.22, ramp: [[115, 8], [131, 3], [147, 3], [217, 3], [148, 3], [87, 3]] }, // light and mid
  { w: 0.49, ramp: [[116, 17], [117, 5], [89, 9], [88, 8], [219, 4], [87, 2]] },  // steel blue and gray
];
const MOSS_WEIGHTS = [[170, 18], [168, 7], [61, 8.5], [169, 6.5], [238, 6.5], [60, 6], [73, 4.7], [172, 4], [62, 4.5], [175, 4], [173, 3], [90, 3], [167, 2.2]];
// Retail stone is fine grain, not flat facets: dark to light ramp, each pixel drawn from a tone with a +-1.6 index jitter (34-37 colors per chunk)
const STONE_RAMP = [219, 117, 89, 116, 88, 87, 148, 115, 147, 131, 217, 114, 130, 145, 224, 216, 224];
// Stone pixels track metal as retail's four deposits do (spec 16.1): 86 -> 198, 127 -> 564, 187 -> 806, 223 -> 886, linear between.
const STONE_BY_METAL = [[86, 198], [127, 564], [187, 806], [223, 886]];
export function stonePixelsFor(metal) {
  const t = STONE_BY_METAL; if (metal <= t[0][0]) return t[0][1] * metal / t[0][0]; if (metal >= t[3][0]) return t[3][1] + (metal - t[3][0]) * 2;
  for (let i = 0; i < 3; i++) if (metal <= t[i + 1][0]) return lerp(t[i][1], t[i + 1][1], (metal - t[i][0]) / (t[i + 1][0] - t[i][0]));
}
// Retail's two looks: RockMetal and RockMetal3 are one dominant ragged cluster of touching facets (solidity about 0.6, 8-12 thin arms)
// plus a few small wedges; RockMetal1 and RockMetal2 are separate plates, one large and three smaller. Each chunk is two-tone
// (pale lilac-white/pink-lilac next to steel blue/gray) in a tight dark moss halo; the halos merge into one patch.
export function paintDeposit(ground, cx, cy, params = {}, seed = 1, ctx = {}) {
  const P = { ...DEPOSIT_DEFAULTS, ...params };
  if (P.style === 'pebbles') return paintDepositPebbles(ground, cx, cy, P, seed, ctx);
  const palette = ctx.palette, q = paletteSearch(palette);
  const r = rng(seed), rn = rng(mix32(seed, 2));
  const mt = clamp((P.metal - 86) / (223 - 86), 0, 1);
  const look = P.look === 'auto' ? (P.metal >= 160 ? 'cluster' : 'plates') : P.look;
  const total = stonePixelsFor(P.metal) * (0.95 + 0.1 * r()) * (look === 'cluster' ? 0.66 : 1);
  const dom = look === 'cluster' ? clamp(lerp(0.66, 0.86, mt) + (r() - 0.5) * 0.05, 0.62, 0.88) : clamp(0.54 + (r() - 0.5) * 0.06, 0.5, 0.6);
  const small = [0, 0, 0].map(() => 0.5 + r()), ss = small.reduce((a, b) => a + b, 0);
  const areas = [total * dom, ...small.map(v => Math.max(15, total * (1 - dom) * v / ss))];
  const bw = 120, bh = 120, ox = Math.round(cx) - 60, oy = Math.round(cy) - 60;
  const chunkId = new Int8Array(bw * bh).fill(-1);
  const polyMask = (px, py, rad, nv, aspect, rot) => {
    const V = [];
    for (let i = 0; i < nv; i++) { const a = (i + (r() - 0.5) * 0.6) / nv * TAU, rr = rad * (0.55 + r() * 0.6); V.push([Math.cos(a) * rr * aspect, Math.sin(a) * rr]); }
    const c = Math.cos(rot), sn = Math.sin(rot), pts = [];
    const P2 = V.map(([u, v]) => [u * c - v * sn, u * sn + v * c]);
    for (let y = Math.floor(py - rad * 2.2); y <= Math.ceil(py + rad * 2.2); y++) for (let x = Math.floor(px - rad * 2.2); x <= Math.ceil(px + rad * 2.2); x++) {
      const X = x - px, Y = y - py; let inside = false;
      for (let i = 0, j = nv - 1; i < nv; j = i++) { const [xi, yi] = P2[i], [xj, yj] = P2[j]; if ((yi > Y) !== (yj > Y) && X < (xj - xi) * (Y - yi) / (yj - yi) + xi) inside = !inside; }
      if (inside) pts.push([x, y]);
    }
    return pts;
  };
  const sized = (px, py, area, nv, aspect, rot) => { let rad = Math.sqrt(area / Math.PI / 0.85), pts = polyMask(px, py, rad, nv, aspect, rot); for (let it = 0; it < 3; it++) { rad *= Math.sqrt(area / Math.max(pts.length, 1)); pts = polyMask(px, py, rad, nv, aspect, rot); } return pts; };
  const union = lists => { const seen = new Set(), out = []; for (const l of lists) for (const p of l) { const k = p[1] * 4096 + p[0]; if (!seen.has(k)) { seen.add(k); out.push(p); } } return out; };
  const chunks = [], layout = [[0, 0]];
  const rDom = Math.sqrt(areas[0] / Math.PI / 0.85);
  for (let i = 0; i < 3; i++) { const a = r() * TAU + i * 2.1, d = rDom * (look === 'cluster' ? 0.95 : 0.7) + 7 + r() * 6; layout.push([Math.cos(a) * d, Math.sin(a) * d * 0.9]); }
  for (let ci = 0; ci < 4; ci++) {
    let px = cx + layout[ci][0], py = cy + layout[ci][1];
    let pts;
    for (let attempt = 0; attempt < 9; attempt++) {
    if (ci === 0 && look === 'cluster') {                // ragged cluster of 2-4 touching facets (solidity about 0.6)
      const k = 4 + (r() < 0.5 ? 1 : 0), per = areas[0] / (k * 0.6), rad = Math.sqrt(per / Math.PI), parts = [];
      let ang = r() * TAU;
      for (let j = 0; j < k; j++) { ang += 1.3 + r() * 1.2; const d = rad * (1.25 + 0.8 * r()); parts.push(sized(px + Math.cos(ang) * d, py + Math.sin(ang) * d, per, 4 + Math.floor(r() * 2), 1 + r() * 0.5, r() * TAU)); }
      pts = union(parts);
      const arms = [];                                    // 8-12 short thin arms off the cluster rim
      const edge = pts.filter(([x, y]) => !pts.some(([u, v]) => u === x + 1 && v === y) || !pts.some(([u, v]) => u === x - 1 && v === y));
      const nArm = 10 + Math.floor(r() * 5);
      for (let j = 0; j < nArm && edge.length; j++) {
        const [sx, sy] = edge[(r() * edge.length) | 0]; let a = Math.atan2(sy - py, sx - px) + (r() - 0.5) * 0.9; const len = 4 + Math.floor(r() * 6);
        for (let t = 1; t <= len; t++) { a += (r() - 0.5) * 0.5; arms.push([Math.round(sx + Math.cos(a) * t), Math.round(sy + Math.sin(a) * t)]); if (r() < 0.2) arms.push([Math.round(sx + Math.cos(a) * t), Math.round(sy + Math.sin(a) * t) + 1]); }
      }
      pts = union([pts, arms]);
    } else pts = sized(px, py, areas[ci], 4 + Math.floor(r() * 2), 1 + r() * (ci === 0 ? 0.5 : 0.9), r() * TAU);
    // plates stay distinct stones: at least 3 px of moss between them
    if (ci === 0 || look === 'cluster' || !pts.some(p => chunks.some(c => c.some(q => Math.abs(q[0] - p[0]) < 4 && Math.abs(q[1] - p[1]) < 4)))) break;
    const ang = Math.atan2(layout[ci][1], layout[ci][0]); px += Math.cos(ang) * 2.5; py += Math.sin(ang) * 2.5;
    }
    { const set = new Set(pts.map(p => p[1] * 4096 + p[0])), out = [];
      for (const p of pts) { const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => set.has((p[1] + dy) * 4096 + p[0] + dx)).length; if (nb === 4 || r() > 0.14) out.push(p); }   // interior pixels are always stone: moss belongs only around the plates
      for (const p of pts) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const k = (p[1] + dy) * 4096 + p[0] + dx; if (!set.has(k) && r() < 0.03) { set.add(k); out.push([p[0] + dx, p[1] + dy]); } }
      { const have = new Set(out.map(p => p[1] * 4096 + p[0]));   // close one-pixel notches so no moss or grass sits inside a plate
        for (let pass = 0; pass < 2; pass++) { const add = [];
          for (const p of out) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) { const x = p[0] + dx, y = p[1] + dy, k = y * 4096 + x; if (have.has(k)) continue; let n = 0; for (const [ex, ey] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (have.has((y + ey) * 4096 + x + ex)) n++; if (n >= 3) { have.add(k); add.push([x, y]); } }
          out.push(...add); } }
      pts = out; }
    chunks.push(pts);
    const nf = ci === 0 ? 2 + Math.floor(r() * 3) : 2, seeds = [];
    const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length, my = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    for (let f = 0; f < nf; f++) { const cls = f === 0 ? 0 : f === 1 ? 2 : weighted(r, [[0, 0.29], [1, 0.22], [2, 0.49]]); seeds.push({ x: mx + (r() - 0.5) * 12, y: my + (r() - 0.5) * 10, cls, fav: [weighted(r, STONE_CLASSES[cls].ramp), weighted(r, STONE_CLASSES[cls].ramp)] }); }
    for (const [x, y] of pts) {
      const bx = x - ox, by = y - oy; if (bx < 0 || by < 0 || bx >= bw || by >= bh) continue;
      let b = 0, bd = 1e9; seeds.forEach((sd, i) => { const d = Math.hypot(sd.x - x, sd.y - y) + (vnoise(x / 2.5, y / 2.5, seed + ci * 7 + i) - 0.5) * 3; if (d < bd) { bd = d; b = i; } });
      chunkId[by * bw + bx] = ci;
      // brushed metal: horizontal streaks (each row has its own tone offset and runs of 3-6 px), a noisier grain, and specular glints in short bright runs
      const rowOff = (hash2(y, ci + 3, seed) - 0.5) * 0.36 + (hash2(y >> 1, ci + 9, seed) - 0.5) * 0.2, run = vnoise(x / (2.2 + 4.5 * hash2(y, ci + 21, seed)) + 50 * hash2(y, ci + 5, seed), y * 7.3 + ci * 13, seed + 40 + ci);   // run length and phase differ per row, so the streaks break up
      const base = [0.66, 0.46, 0.2][seeds[b].cls] + rowOff * 0.8 + (run - 0.5) * 0.5 + (vnoise(x / 2.2, y / 2.2, seed + 50 + ci) - 0.5) * 0.3 + (vnoise(x / 1.2, y / 1.2, seed + 60 + ci) - 0.5) * 0.25;
      let tone = clamp(base + (rn() - 0.5) * 0.4, 0, 1), c = STONE_RAMP[clamp(Math.round(tone * (STONE_RAMP.length - 1) + (rn() + rn() - 1) * 2.2 + (rn() < 0.1 ? (rn() < 0.5 ? -4 : 4) : 0)), 0, STONE_RAMP.length - 1)];   // fine pixel grain plus a few off-tone specks
      if (hash2(x >> 2, y, seed + ci * 5 + 11) < 0.075) c = rn() < 0.14 ? 255 : pick(rn, [224, 216, 130, 114, 224]);          // a glint
      setGround(ground, x, y, palette[c]);
    }
  }
  // moss: one merged patch. The patch covers about stone / 0.15 pixels (retail: stone is 9-18% of the painted pixels), found by growing
  // the halo distance until the area is reached; a 3-6 px feathered rim.
  const stonePts = chunks.flat(), s1 = (r() * 1e6) | 0, dmap = new Float32Array(bw * bh).fill(99), rawD = new Float32Array(bw * bh).fill(99);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    if (chunkId[y * bw + x] >= 0) { dmap[y * bw + x] = 0; continue; }
    const X = x + ox, Y = y + oy; let d = 99;
    for (const p of stonePts) { const dd = Math.abs(p[0] - X) + Math.abs(p[1] - Y); if (dd < 40) { const e = Math.hypot(p[0] - X, p[1] - Y); if (e < d) d = e; } }
    rawD[y * bw + x] = d; dmap[y * bw + x] = d + (fbm(X / 5, Y / 5, s1, 2) - 0.5) * 5;
  }
  const T = 4.6;   // a tight 3-6 px speckled rim that merges between neighbors (retail: median 2.8-3.6 px from a chunk, 90% within 6-8)
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const k = y * bw + x; if (chunkId[k] >= 0) continue;
    const d = dmap[k], near = rawD[k] <= 2.3; if (d > T + 1 && !near) continue;
    const pr = near || d <= 2.6 ? 1 : clamp((T + 1.4 - d) / 3.6, 0, 1) * 0.93;   // no grass ever shows inside or against a plate
    if (rn() > pr) continue;
    const X = x + ox, Y = y + oy, base = getGround(ground, X, Y), m = palette[weighted(rn, MOSS_WEIGHTS)], tint = 0.05 + 0.07 * rn();
    setGround(ground, X, Y, palette[q(lerp(m[0], base[0] * 0.5, tint), lerp(m[1], base[1] * 0.5, tint), lerp(m[2], base[2] * 0.5, tint))]);
  }
  return { cx, cy, metal: P.metal, look, chunks: 4, stonePx: stonePts.length, dominant: areas[0] / total, rect: [ox, oy, bw, bh], gameplay: { metal: P.metal, indestructible: true, footprint: [3, 3] } };
}
// Round 1's round-pebble deposit, kept as an artist option (style 'pebbles').

function paintDepositPebbles(ground, cx, cy, params = {}, seed = 1, ctx = {}) {
  const P = { ...DEPOSIT_DEFAULTS, ...params }, palette = ctx.palette, q = paletteSearch(palette), L = lightOf(ctx);
  const r = rng(seed), rn = rng(mix32(seed, 2));
  const mt = clamp((P.metal - 86) / (223 - 86), 0, 1);
  const nChunks = Math.round(lerp(7, 22, mt) + (r() - 0.5) * 2);
  const gm = groundMean(ground, cx, cy, 40);
  // chunks
  const chunks = [];
  const R = 19;
  for (let tries = 0; chunks.length < nChunks && tries < 500; tries++) {
    const a = r() * TAU, rr = Math.sqrt(r()) * R * 0.95;
    const area = chunks.length === 0 ? lerp(40, 83, mt * 0.6 + r() * 0.4) : lerp(9, 60, Math.pow(r(), 1.4));
    const rad = Math.sqrt(area / Math.PI);
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * 0.95;
    if (chunks.every(c => Math.hypot(c.x - x, c.y - y) > c.rad + rad + 2.2)) chunks.push({ x, y, rad, area, tone: r() });
  }
  const bw = 80, bh = 80, ox = Math.round(cx) - 40, oy = Math.round(cy) - 40;
  const halo = new Float32Array(bw * bh), chunkId = new Int16Array(bw * bh).fill(-1);
  const s1 = (r() * 1e6) | 0;
  // halo field: soft union of discs round the chunks plus a mossy core
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const X = x + ox, Y = y + oy; let f = -1;
    for (const c of chunks) { const d = Math.hypot(X - c.x, Y - c.y), reach = c.rad + 7 + c.rad * 0.15; f = Math.max(f, 1 - d / reach); }
    f += (fbm(X / 5, Y / 5, s1, 3) - 0.5) * 0.7 - 0.02;
    halo[y * bw + x] = f;
  }
  // chunk polygons
  for (let ci = 0; ci < chunks.length; ci++) {
    const c = chunks[ci], nv = 5 + Math.floor(r() * 3), vr = []; for (let i = 0; i < nv; i++) vr.push(0.72 + r() * 0.5);
    const ph = r() * TAU;
    for (let y = -Math.ceil(c.rad * 1.5); y <= Math.ceil(c.rad * 1.5); y++) for (let x = -Math.ceil(c.rad * 1.5); x <= Math.ceil(c.rad * 1.5); x++) {
      const th = Math.atan2(y, x) - ph, f = ((th / TAU + 4) % 1) * nv, i = Math.floor(f), t = f - i;
      const lim = c.rad * lerp(vr[i % nv], vr[(i + 1) % nv], t) * 1.08;
      if (Math.hypot(x, y * 1.05) < lim) { const bx = Math.round(c.x + x) - ox, by = Math.round(c.y + y) - oy; if (bx >= 0 && by >= 0 && bx < bw && by < bh) { chunkId[by * bw + bx] = ci; } }
    }
    c.fac = [Math.cos(r() * TAU), Math.sin(r() * TAU)];
  }
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const k = y * bw + x, X = x + ox, Y = y + oy, ci = chunkId[k];
    if (ci >= 0) {
      const c = chunks[ci];
      // facet shade: lit upper left, darker lower right, two facets per chunk
      const rx = (X - c.x) / Math.max(c.rad, 1), ry = (Y - c.y) / Math.max(c.rad, 1);
      const fac = (rx * c.fac[0] + ry * c.fac[1] > 0.1) ? 0.12 : -0.12;
      const lit = 0.5 + 0.5 * (-rx * -L.x * -1 * -1 * 1 + (-ry) * -L.y * -1 * -1 * 1) * -1 * -1 * 0 + 0.4 * (-(rx * -L.x) * -1 * 0) + (rx * L.x + ry * L.y) * -0.35 + fac + (rn() - 0.5) * 0.28;
      const ramp = c.tone < 0.12 ? [116, 115, 67, 66, 65, 64] : c.tone < 0.28 ? [68, 67, 66, 82, 81, 255] : c.tone < 0.36 ? [20, 18, 17, 66, 65] : [68, 67, 66, 65, 64, 82, 81];
      const idx = ramp[clamp(Math.floor(lit * ramp.length), 0, ramp.length - 1)];
      let idx2 = idx;
      // a dark edge facet on the lower right
      if (rx * L.x + ry * L.y > 0.55 && rn() < 0.5) idx2 = pick(rn, [68, 67, 115, 116]);
      setGround(ground, X, Y, palette[idx2]);
      continue;
    }
    const f = halo[k];
    if (f <= -0.02) continue;
    // moss: solid inside, feathered out to ~5 px
    if (f < 0.12 && rn() > f / 0.12 * 0.9 + 0.05) continue;
    const base = getGround(ground, X, Y);
    const m = pick(rn, MOSS_RGB), shade = 0.8 + (rn() - 0.5) * 1.1 + (fbm(X / 3, Y / 3, s1 + 8, 2) - 0.5) * 0.9;
    const tint = 0.3 + 0.2 * rn();
    const rgb = [0, 1, 2].map(i => lerp(m[i] * shade, base[i] * 0.62, tint));
    setGround(ground, X, Y, palette[q(rgb[0], rgb[1], rgb[2])]);
  }
  return { cx, cy, metal: P.metal, chunks: chunks.length, rect: [ox, oy, bw, bh], gameplay: { metal: P.metal, indestructible: true, footprint: [3, 3] } };
}


export const VENT_DEFAULTS = { size: 1, forks: 3 };
export function paintVent(ground, cx, cy, params = {}, seed = 1, ctx = {}) {
  const P = { ...VENT_DEFAULTS, ...params }, palette = ctx.palette, q = paletteSearch(palette);
  const r = rng(seed), rn = rng(mix32(seed, 4));
  const bw = 96, bh = 96, ox = Math.round(cx) - 48, oy = Math.round(cy) - 48;
  const core = new Uint8Array(bw * bh);   // 1 = crack, thickness irrelevant after drawing
  function stamp(x, y, t) {
    const rad = Math.max(0.4, t / 2);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (dx * dx + dy * dy <= rad * rad + 0.2) { const bx = Math.round(x + dx) - ox, by = Math.round(y + dy) - oy; if (bx >= 0 && by >= 0 && bx < bw && by < bh) core[by * bw + bx] = 1; }
  }
  function crack(x, y, ang, len, th, depth) {
    const steps = Math.round(len);
    for (let i = 0; i < steps; i++) {
      ang += (r() - 0.5) * 0.7;
      x += Math.cos(ang); y += Math.sin(ang) * 0.9;
      const t = Math.max(1, th * (1 - (i / steps) * 0.55));
      stamp(x, y, t);
      if (depth < 3 && i > 3 && i < steps - 2 && r() < 0.075 * P.forks / 3 * (depth === 0 ? 1.4 : 1)) {
        crack(x, y, ang + (r() < 0.5 ? -1 : 1) * (0.5 + r() * 0.7), len * (0.4 + r() * 0.3) - i * 0.2, Math.max(1, th * 0.6), depth + 1);
      }
    }
    if (depth < 2 && len > 8) crack(x, y, ang + (r() - 0.5) * 1.0, len * 0.5, Math.max(1, th * 0.6), depth + 1);
  }
  const a0 = r() * TAU, len = 17 * P.size;
  crack(cx, cy, a0, len * (1.0 + 0.3 * r()), 3 * Math.sqrt(P.size) + 0.6, 0);
  crack(cx, cy, a0 + Math.PI + (r() - 0.5) * 0.6, len * (0.8 + 0.3 * r()), 3 * Math.sqrt(P.size), 0);
  // edges: tint ring one and a feathered ring two
  const gm = [0, 0, 0];
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const k = y * bw + x, X = x + ox, Y = y + oy;
    if (core[k]) {
      setGround(ground, X, Y, palette[weighted(rn, [[245, 30], [63, 25], [79, 15], [78, 12], [77, 8], [95, 10]])]);
      continue;
    }
    let d1 = 99;
    for (let dy = -2; dy <= 2 && d1 > 1; dy++) for (let dx = -2; dx <= 2; dx++) { const bx = x + dx, by = y + dy; if (bx >= 0 && by >= 0 && bx < bw && by < bh && core[by * bw + bx]) { d1 = Math.min(d1, Math.max(Math.abs(dx), Math.abs(dy))); } }
    if (d1 > 2) continue;
    const pr = d1 === 1 ? 0.72 : 0.3;
    if (rn() > pr) continue;
    const base = getGround(ground, X, Y);
    const idx = weighted(rn, [[170, 8.3], [168, 6.5], [172, 5.7], [169, 5.5], [166, 4.1], [61, 7.1], [59, 4.9], [62, 4.7], [60, 4.4], [175, 3.5], [72, 4.8], [95, 2]]);
    const c = palette[idx], tint = 0.35;
    setGround(ground, X, Y, palette[q(lerp(c[0], base[0] * 0.7, tint), lerp(c[1], base[1] * 0.7, tint), lerp(c[2], base[2] * 0.7, tint))]);
  }
  return { cx, cy, rect: [ox, oy, bw, bh], gameplay: { geothermal: true, indestructible: true, footprint: [1, 1] } };
}

// ---- compositing a feature onto an RGBA ground (used by the artifact and tests) -----------------------------------------
export function drawFeature(ground, f, px, py, palette) {
  const blend = (s, x0, y0, a, tinted) => {
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
      if (!s.a[y * s.w + x]) continue;
      const X = px + x - s.ax, Y = py + y - s.ay; if (X < 0 || Y < 0 || X >= ground.w || Y >= ground.h) continue;
      const c = palette[s.idx[y * s.w + x]], k = (Y * ground.w + X) * 4;
      for (let i = 0; i < 3; i++) ground.rgba[k + i] = Math.round(ground.rgba[k + i] * (1 - a) + c[i] * a);
    }
  };
  if (f.shadow) blend(f.shadow, 0, 0, f.shadowBlend);
  blend(f.body, 0, 0, f.bodyBlend);
}
