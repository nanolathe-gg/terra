// Procedural map features for Green: trees, burning and burnt trees, shrubs, rocks, scars, metal deposits, vents.
// Plain ES module, no dependencies, same bytes in Node and in the browser. Everything is built in the game's
// 256-color index space (the indices below are the game palette's; `palette` is only needed to turn indices
// into RGBA or to fit deposits and vents to a ground picture). Built from the written spec only.
//
// A sprite is {w,h,ax,ay,idx:Uint8Array,a:Uint8Array}: palette index per pixel, a=1 where drawn, (ax,ay) the anchor
// pixel inside the sprite (the foot of a plant, the middle of a rock).
// A feature is {kind,name,seed,params,footprint,body,shadow,shadowBlend,bodyBlend,burn,burnt,gameplay}.

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
function broadColor(lev, r, lean, zone) {
  const L = clamp(lev, 0, 10.49), li = Math.round(L);
  const darkness = clamp((3.6 - L) / 3.6, 0, 1);
  if (darkness > 0 && r() < 0.6 * darkness + 0.1 * (L < 4.5 ? 1 : 0)) {
    // a dark gap between leaves: gray, a little brown
    const g = clamp(Math.round(L * 0.85 + (r() - 0.5) * 2.2 + (r() < 0.12 ? 3 : 0)), 0, 10);
    return r() < 0.3 ? weighted(r, [[62, 3], [61, 3], [60, 3], [59, 2], [58, 1], [57, 0.5]]) : GR[g];
  }
  let ramp = G;
  if (lean < 0 && zone < -lean * 0.9) ramp = IDX.YELLOW_GREEN;
  const x = r();
  if (x < 0.1) return nearestExtra(lumaOfLevel(L) + (r() - 0.5) * 40);
  if (x < 0.105) return pick(r, [233, 234, 35, 53, 52]);   // saturated or gray-green flecks, never white, gray or pink
  if (x < 0.12 && L < 7) return IDX.OLIVE[clamp(Math.round(L * 0.6), 0, 6)];
  if (lean > 0 && L > 7 && r() < lean * 0.5) return pick(r, [36, 35, 34]);
  return ramp[li];
}
function coniferColor(lev, r, lean, zone, brownP) {
  const L = clamp(lev, 0, 10.49), li = Math.round(L);
  if (r() < brownP) return weighted(r, [[62, 3], [61, 4], [60, 3], [59, 3], [58, 2], [57, 1]]);
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
const TREE_SHADOW_COLORS = [[245, 39], [95, 38], [92, 6], [93, 6], [94, 5], [44, 2], [45, 2], [46, 2]];
const ROCK_SHADOW_COLORS = [[47, 78], [95, 20], [245, 2]];

// ---- trees -----------------------------------------------------------------------------------------------------
const TREE_DEFAULTS = {
  species: 'broadleaf',  // 'broadleaf' or 'conifer'
  height: 68,            // px, broadleaf 66-71, conifer 57-64
  width: 0.64,           // width / height, broadleaf 0.68-0.73, conifer 0.44-0.62
  crown: 0.6,            // 0 smooth egg .. 1 deeply lobed and ragged
  density: 0.45,         // 0 sparse and holey .. 1 solid
  lean: 0,               // -1 olive, 0 retail, +1 lush
  energy: [250, 250],    // gameplay range (retail: 250 for every tree)
};

function treeFrame(P, seed, ctx) {
  const L = lightOf(ctx), conifer = P.species === 'conifer';
  const r = rng(seed), rn = rng(mix32(seed, 77));
  const H = Math.round(P.height), W = Math.round(H * P.width);
  const pad = 8, w = W + pad * 2 + 4, h = H + 3;
  const jx = (r() - 0.5) * 3, cx = w / 2 + jx;
  const ay = h - 3, ax = Math.round(cx) + (conifer ? 0 : Math.round((r() - 0.5) * 2));
  const stubRows = conifer ? 9 : 6, y0 = 2, yc = ay - (conifer ? 1 : 4);
  const Wh = W / 2;
  // silhouette profile
  const tp = conifer ? 0.5 + r() * 0.14 : 0.28 + r() * 0.3;
  const bump = !conifer && r() < 0.4, bumpX = (r() - 0.5) * 0.5;
  const tiers = conifer ? 5 + Math.floor(r() * 3) : 0, tierPh = r() * TAU;
  const s1 = (r() * 1e6) | 0, s2 = (r() * 1e6) | 0, s3 = (r() * 1e6) | 0, s4 = (r() * 1e6) | 0;
  const crown = P.crown, dens = P.density;
  const prof = tt => {
    tt = clamp(tt, 0, 1);
    if (conifer) {
      let p = tt < tp ? Math.pow(tt / tp, 0.62) : 1 - 0.34 * Math.pow((tt - tp) / (1 - tp), 1.2);
      p *= 1 + 0.1 * Math.sin(tiers * TAU * tt + tierPh) * Math.min(1, tt * 3);
      return p;
    }
    if (tt < tp) { const s = tt / tp; return Math.pow(Math.max(0, 1 - Math.pow(1 - s, 2.3)), 0.5); }
    const s = (tt - tp) / (1 - tp);
    let p = 1 - 0.3 * Math.pow(s, 1.5);
    if (s > 0.7) p *= Math.sqrt(Math.max(0, 1 - Math.pow((s - 0.7) / 0.3, 2.2)));
    return p;
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
    const lim = pr * (1 + crown * (conifer ? 0.15 : 0.27) * lob) + crown * (conifer ? 0.12 : 0.17) * rag * (0.35 + 0.65 * Math.min(1, tt * 4));
    if (u < lim && lim > 0.02) mask[y * w + x] = 1;
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
  const mid = conifer ? 3.4 : 5.7, lamGain = conifer ? 3.0 : 4.0, gxGain = conifer ? 2.6 : 1.3, gyGain = conifer ? 0.3 : 0.9;
  const sigma = conifer ? 1.9 : 4.3;
  // bright leaf bunches (spec 15 B6): about 34 rounded 3-6 px clumps that lean to the upper-left lobes
  const clumpList = [];
  if (!conifer) {
    const inside = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x] === 1 && dist[y * w + x] >= 2) inside.push([x, y]);
    const quad = () => weighted(r, [[0, 0.56], [1, 0.2], [2, 0.21], [3, 0.03]]);
    for (let tries = 0; clumpList.length < Math.round(P.clumps ?? 40) && tries < 20000 && inside.length; tries++) {
      const [x, y] = inside[(r() * inside.length) | 0], q = quad();
      if ((x < cx ? 0 : 1) + (y < ycen ? 0 : 2) !== q) continue;
      if (clumpList.some(c => Math.hypot(c.x - x, c.y - y) < 4.6)) continue;
      clumpList.push({ x, y, rad: 1.3 + r() * 1.6, str: 4 + r() * 2.5 });
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
    let nz = 0.5 * white * 1.4 + 0.5 * cell * 1.5;
    if (!conifer && rn() < 0.1) nz += (rn() < 0.5 ? -1 : 1) * 2.2;       // sparkle
    lev += sigma * nz;
    const zone = zoneN(x, y);
    let col;
    if (conifer) {
      const bf = brownField(x, y);
      const lowerHalf = clamp((tt - 0.4) / 0.6, 0, 1);
      const brownP = clamp((bf - 0.5) * 3.2, 0, 1) * (0.25 + 0.65 * lowerHalf) + (Math.abs(x - cx) < 2 && tt > 0.55 ? 0.35 : 0);
      col = coniferColor(lev, rn, P.lean, zone, brownP);
    } else {
      const brownP = tt > 0.55 && dist[k] > 1 ? 0.16 * Math.max(0, vnoise(x / 3, y / 3, s2 + 7) - 0.4) * 3 : 0;
      col = rn() < brownP ? pick(rn, [61, 62, 60, 59]) : broadColor(lev, rn, P.lean, zone);
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
const CONIFER_DEAD = [[245, 1], [63, 1], [47, 14], [46, 14], [45, 11], [172, 2], [173, 2], [175, 1.5], [44, 3], [62, 7], [61, 1], [93, 12], [94, 5], [92, 2.5], [43, 1], [91, 1.5], [89, 1.5]];
// A sparse, narrow, tapering needle skeleton (spec 15 B3): dark trunk, short twigs, needle tufts, gaps; near-black greens and grays.
function burntConiferFrame(P, seed) {
  const r = rng(seed), rn = rng(mix32(seed, 5));
  const H = Math.round(P.height), W = Math.round(H * P.width), w = W + 8, h = H + 4, cx = w / 2 + (r() - 0.5), ax = Math.round(cx), ay = h - 3;
  const sp = newSprite(w, h, ax, ay), s1 = (r() * 1e6) | 0, Wh = W / 2, y0 = ay - H + 1;
  const target = Math.round(0.365 * W * H * (0.94 + 0.12 * r()));
  const hw = t => Wh * (0.1 + 0.9 * Math.pow(clamp(t / 0.62, 0, 1), 0.85)) * (t > 0.62 ? 1 - 0.22 * (t - 0.62) / 0.38 : 1);
  const forced = new Set(), cand = [];
  for (let y = y0; y <= ay; y++) {              // trunk
    const t = (y - y0) / H;
    if (t > 0.04) { forced.add(y * w + ax); if (t > 0.3) forced.add(y * w + ax + 1); }
  }
  for (let y = y0 + 4; y < ay - 2; y += 2 + (r() < 0.4 ? 1 : 0)) {          // short twigs, alternating sides
    const t = (y - y0) / H, side = (y & 1) ? 1 : -1, len = Math.max(1, Math.round(hw(t) * (0.45 + 0.4 * r())));
    for (let i = 1; i <= len; i++) forced.add((y + (i > 2 && r() < 0.3 ? 1 : 0)) * w + ax + side * i + (side > 0 ? 1 : 0));
  }
  for (let y = y0; y <= ay - 1; y++) {
    const t = (y - y0) / H, half = hw(t);
    for (let x = Math.floor(cx - half) - 1; x <= Math.ceil(cx + half) + 1; x++) {
      const k = y * w + x, edge = Math.abs(x - cx) / Math.max(half, 1);
      if (forced.has(k) || edge > 1.05) continue;
      cand.push([0.55 * vnoise(x / 2.4, y / 1.2, s1) + 0.35 * rn() + 0.25 * edge * edge, k]);
    }
  }
  cand.sort((a, b) => a[0] - b[0]);
  const chosen = new Set(forced); for (let i = 0; chosen.size < target && i < cand.length; i++) chosen.add(cand[i][1]);
  for (const k of chosen) {
    const x = k % w, y = (k / w) | 0; if (y < 0 || y >= h) continue;
    const trunk = x === ax || x === ax + 1;
    const v = 0.35 * vnoise(x / 2, y / 2, s1 + 9) + 0.65 * rn();
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
  const yFork = ay - Math.round(H * 0.44);
  for (let y = ay; y >= yFork; y--) {
    const t = (ay - y) / (ay - yFork), flare = y >= ay - 3 ? (y === ay ? 3 : 12 - (ay - y) * 0.7) : 0;
    const wd = Math.max(flare, lerp(8.5, 12, t) * (0.9 + 0.2 * vnoise(y / 4, 1, s1 + 4)) + (y > ay - 6 ? 1.5 : 0));
    const xc = ax + wob(y) * (1 - 0.4 * (1 - t));
    for (let x = Math.floor(xc - wd / 2 - 1); x <= Math.ceil(xc + wd / 2 + 1); x++) { const edge = Math.abs(x - xc) - wd / 2 + (vnoise(x / 1.8, y / 1.8, s1 + 9) - 0.5) * 2.2; if (edge <= 0) mask[y * w + x] = 1; }
  }
  const xFork = ax + wob(yFork);
  const nL = clamp(Math.round(P.forks), 2, 4), tips = [];
  const limb = (x, y, ang, len, wd, depth) => {
    const segs = Math.max(1, Math.min(Math.round(len / 6), depth === 0 ? 2 : 1));
    for (let i = 0; i < segs; i++) {
      const sl = 4.5 + r() * 3.5, nx = x + Math.sin(ang) * sl, ny = y - Math.cos(ang) * sl;
      const n = Math.ceil(sl * 2);
      for (let k = 0; k <= n; k++) { const f = k / n; stamp(lerp(x, nx, f), lerp(y, ny, f), lerp(wd, Math.max(1, wd * 0.82), f)); }
      x = nx; y = ny; ang *= 0.6; wd = Math.max(1, wd * 0.82);
      if (r() < 0.3 && depth < 3) stamp(x + (r() < 0.5 ? -1 : 1) * 2, y - 1, 1);      // 1 px twig
    }
    if (y < y0 + 3 || depth >= 3 || len < 6) { tips.push([x, y]); return; }
    const nf = 2;
    for (let k = 0; k < nf; k++) limb(x, y, ang + (k ? 1 : -1) * (0.25 + r() * 0.35) + (r() - 0.5) * 0.2, len * (0.72 + r() * 0.15) - segs * 3, Math.max(1, wd * 0.8), depth + 1);
  };
  for (let i = 0; i < nL; i++) {
    const f = nL === 1 ? 0 : (i / (nL - 1) - 0.5) * 2, ang = f * (0.85 + 0.35 * r()) + (r() - 0.5) * 0.2;     // 20-60 degrees from vertical
    limb(xFork + f * 3, yFork + 1, ang, (yFork - y0) * (0.9 + 0.15 * r()), 7 - nL * 0.8 + r(), 0);
  }
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
    if (rn() < P.ash * 0.02) c = pick(rn, [89, 90, 67, 68]);
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
  const dd = clamp(P.density / 0.5, 0, 1), fill = lerp(0.135, 0.4, dd), N = Math.round(fill * W * H);
  const s1 = (r() * 1e6) | 0;
  const env = (x, y) => { const e = ((x - cx) / (W / 2)) ** 2 + ((y - cy) / (H / 2)) ** 2; return e * 0.88 + (vnoise(x / 3, y / 3, s1) - 0.5) * 0.35 <= 1; };
  const spread = true;
  const grow = (sx, sy, n) => {
    const cells = [[sx, sy]]; occ[sy * w + sx] = 1; let front = [];
    const addFront = (x, y) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy; if ((dx || dy) && nx >= 0 && ny >= 0 && nx < w && ny < h && !occ[ny * w + nx] && env(nx, ny)) front.push([nx, ny]); } };
    addFront(sx, sy);
    while (cells.length < n && front.length) {
      let i = (r() * front.length) | 0;
      for (let t = 0; t < 3; t++) { const j = (r() * front.length) | 0; if (spread && Math.hypot(front[j][0] - cx, (front[j][1] - cy) * 1.6) > Math.hypot(front[i][0] - cx, (front[i][1] - cy) * 1.6)) i = j; }   // reach out toward the envelope's edge
      const [x, y] = front[i]; front[i] = front[front.length - 1]; front.pop();
      if (occ[y * w + x]) continue; occ[y * w + x] = 1; cells.push([x, y]); addFront(x, y);
    }
    return cells;
  };
  const inside = []; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (env(x, y)) inside.push([x, y]);
  const dom = lerp(0.1, 0.62, dd), nBlobs = Math.round(lerp(26, 8, dd));
  const all = [];
  const c0 = inside.reduce((a, p) => (Math.abs(p[0] - cx) + Math.abs(p[1] - cy) < Math.abs(a[0] - cx) + Math.abs(a[1] - cy) ? p : a), inside[0]);
  all.push(...grow(c0[0], c0[1], Math.round(N * dom)));
  const rest = N - all.length;
  for (let b = 1; b < nBlobs && all.length < N; b++) {
    const [sx, sy] = inside[(r() * inside.length) | 0]; if (occ[sy * w + sx]) continue;
    let near = false; for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) if (occ[(sy + dy) * w + sx + dx]) { near = true; break; } if (near && b % 3) continue;
    const size = Math.max(1, Math.min(N - all.length, Math.round((rest / (nBlobs - 1)) * (0.2 + 1.6 * r() * r() * 1.2))));
    all.push(...grow(sx, sy, size));
  }
  for (let tries = 0; all.length < N && tries < 400; tries++) {   // top up with small outliers
    const [sx, sy] = inside[(r() * inside.length) | 0]; if (occ[sy * w + sx]) continue;
    all.push(...grow(sx, sy, Math.min(N - all.length, 1 + Math.floor(r() * 5))));
  }
  const nb4 = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => occ[(y + dy) * w + x + dx]).length;
  const hi = P.lean > 0 ? 1.6 : 1;
  for (const [x, y] of all) {
    const edge = nb4(x, y) < 4, belowOpen = !occ[(y + 1) * w + x];
    const dark = rn() < (belowOpen ? 0.62 : edge ? 0.42 : 0.2);
    const c = dark ? 173 : weighted(rn, [[165, 31.5], [167, 12.1], [163, 7 * hi], [168, 4.1], [164, 3.9], [166, 3.5], [162, 0.4 * hi]]);
    put(sp, x, y, c);
  }
  return { body: cropSprite(sp, 0) };
}

// ---- rocks -----------------------------------------------------------------------------------------------------
const ROCK_DEFAULTS = { cells: '2x2', size: 1, angular: 0.6, lean: 0, metal: null };
const ROCK_CELLS = { '1x1': [1, 1], '2x2': [2, 2], '3x2': [3, 2], '3x3': [3, 3], '4x3': [4, 3] };
function rockFrame(P, seed, ctx) {
  const L = lightOf(ctx), r = rng(seed), rn = rng(mix32(seed, 9));
  const [fw, fh] = ROCK_CELLS[P.cells] || [2, 2];
  let W, H;
  if (fw === 1) { W = Math.round(lerp(8, 21, clamp(P.size, 0, 1.4) / 1.4)); H = Math.round(W * (0.82 + r() * 0.15)); }
  else { W = Math.round(fw * 16 * (0.94 + 0.1 * r()) * P.size); H = Math.round(W * (0.74 + r() * 0.22)); }
  const w = W + 6, h = H + 6, cx = w / 2, cy = h / 2 + 0.5;
  const ax = Math.round(cx + (r() - 0.5) * 3), ay = Math.round(3 + H * (0.18 + r() * 0.2));
  const sp = newSprite(w, h, ax, ay);
  const nv = Math.round(lerp(11, 5, P.angular));
  const verts = []; for (let i = 0; i < nv; i++) verts.push(0.84 + r() * 0.28);
  const ph = r() * TAU, f1 = r() * TAU, f2 = r() * TAU, a2 = 0.05 + 0.07 * r(), a3 = 0.04 * r();
  const radial = th => {
    const f = (th / TAU + 4) % 1 * nv, i = Math.floor(f), t = f - i;
    const poly = lerp(verts[i % nv], verts[(i + 1) % nv], t);
    const smooth = 1 + a2 * Math.cos(2 * th + f1) + a3 * Math.cos(3 * th + f2);
    return lerp(smooth, poly, P.angular);
  };
  const Wh = W / 2, Hh = H / 2, mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (x - cx) / Wh, dy = (y - cy) / Hh;
    const th = Math.atan2(dy, dx) - ph, e = dy > 0 ? 3.2 : 2.2;      // flat-ish base
    const rr = Math.pow(Math.pow(Math.abs(dx), e) + Math.pow(Math.abs(dy), e), 1 / e);
    if (rr < radial(th) * (1 + 0.04 * (fbm(x / 4, y / 4, seed) - 0.5)) && (rr > 0 || true)) mask[y * w + x] = 1;
  }
  const dist = edgeDist(w, h, mask);
  // Tonal planes (spec 15 B1): 1-4 large highlight planes up-left, mid planes, a shade plane at the lower right.
  const cellsN = fw * fh, nHi = clamp(1 + (cellsN >= 12 ? 3 : cellsN >= 9 ? 2 : cellsN >= 4 ? 1 : 0) + (P.angular > 0.7 && cellsN >= 4 ? 1 : 0), 1, 4);
  const planes = [], dirAt = (x, y) => L.x * ((x - cx) / Wh) + L.y * ((y - cy) / Hh);
  const addPlane = (sx, sy, bias) => planes.push({ x: cx + sx * Wh, y: cy + sy * Hh, t: 0.5 + 0.42 * bias + (r() - 0.5) * 0.16 });
  for (let i = 0; i < nHi; i++) addPlane(L.x * (0.1 + 0.6 * r()), L.y * (0.1 + 0.55 * r()), 0.8 + r() * 0.2);   // toward the sun
  for (let i = 0; i < 2 + Math.round(P.angular * 2 + r()); i++) addPlane((r() - 0.5) * 1.4, (r() - 0.5) * 1.2, (r() - 0.5) * 0.7);
  addPlane(-L.x * (0.3 + r() * 0.4), -L.y * (0.15 + r() * 0.4), -0.9);          // the shade plane hugs the side away from the sun
  const flat = 0.35 + 0.55 * P.angular;             // 0 smooth dome shading .. 1 flat tonal planes
  const tone = new Float32Array(w * h), hasPx = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x; if (!mask[k]) continue;
    let bi = 0, bd = 1e9; planes.forEach((pl, i) => { const d = Math.hypot(pl.x - x, pl.y - y) + (vnoise(x / 3, y / 3, seed + i) - 0.5) * 3.2; if (d < bd) { bd = d; bi = i; } });
    const pl = planes[bi], d0 = dirAt(x, y);
    let t = lerp(0.5 + 0.34 * d0, pl.t + 0.12 * (d0 - dirAt(pl.x, pl.y)), flat);
    const rr = Math.hypot((x - cx) / Wh, (y - cy) / Hh);
    t -= 0.22 * Math.max(0, rr - 0.65) * (d0 < 0.05 ? 1.7 : 0.6);     // falls off to the shaded edge
    if (y > h * 0.72) t -= ((y / h - 0.72) / 0.28) * 0.34;            // dark base
    t += (rn() - 0.5) * 0.07 + (vnoise(x / 1.6, y / 1.6, seed + 17) - 0.5) * 0.08;
    tone[k] = t; hasPx.push(k);
  }
  // rank the non-rim pixels so the band shares match the spec: highlight 48%, lit gray 23%, mid and shade the rest
  const interior = hasPx.filter(k => dist[k] > 1).sort((a, b) => tone[b] - tone[a]), N = interior.length;
  const lowerRight = k => { const x = k % w, y = (k / w) | 0; return (x - cx) * -L.x + (y - cy) * -L.y > 0; };
  const hiN = Math.round(N * 0.45), litN = Math.round(N * 0.23), shadeN = Math.round(N * 0.12);
  const bright = (list, u) => list[clamp(Math.floor((1 - u) * list.length), 0, list.length - 1)];
  const CREAM = [64, 65, 66, 67, 68, 69, 70], PINKS = [16, 17, 18, 19, 20, 21, 22], WHITES = [255, 81, 82, 83, 84];
  const hiIdx = interior.slice(0, hiN), hiField = hiIdx.map(k => vnoise((k % w) / 8, ((k / w) | 0) / 8, seed + 77) + 0.02 * (rn() - 0.5));
  const order = hiField.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]), kind = new Array(hiN);
  order.forEach(([, i], rank) => { kind[i] = rank < hiN * 0.45 ? 0 : rank < hiN * 0.74 ? 1 : 2; });
  const col = new Map();
  interior.forEach((k, rank) => {
    let c;
    if (rank < hiN) {
      const u = 1 - rank / hiN * 0.85 - 0.05 + (rn() - 0.5) * 0.12;
      c = kind[rank] === 0 ? bright(CREAM, 1 - u) : kind[rank] === 1 ? bright(PINKS, 1 - u) : bright(WHITES, 1 - u);
    } else if (rank < hiN + litN) c = bright([85, 86, 87, 88, 89], 1 - (rank - hiN) / litN + (rn() - 0.5) * 0.3);
    else if (rank < N - shadeN) c = weighted(rn, [[90, 8], [91, 8.8], [92, 5.3]]);
    else c = weighted(rn, [[93, 4.5], [94, 3.4], [95, 4.2], [127, 1.9], [125, 0.8]]);
    col.set(k, c);
  });
  for (const k of hasPx) {
    let c;
    if (dist[k] <= 1) {                                 // the dark rim: thinner on the lit side
      if (!lowerRight(k) && rn() < 0.4) { c = col.size ? bright([88, 89, 90, 91], rn()) : 90; }
      else c = weighted(rn, [[91, 23], [90, 14], [92, 9], [95, 8], [94, 7], [93, 7], [127, 5.5], [125, 5]]);
    } else c = col.get(k);
    put(sp, k % w, (k / w) | 0, c);
  }
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

// ---- fire (spec 16.2) --------------------------------------------------------------------------------------------
// Retail's tree burn: a unique 9-frame lead-in (flame grows from the foot, crown still green), the crown cut to charred
// gray at frame 9, a 14-frame flame cycle that repeats byte for byte, and a 16-frame burn-out tail that ends on the burnt
// tree's exact size and anchor with glowing embers on it. The flame base is an arch (to the ground only near the trunk,
// climbing the crown's flanks), tongues are redrawn around a stable core, sparks are isolated dark-red pixels, no smoke.
const FLAME_GROUPS = {
  wy: [[195, 48], [194, 25], [193, 14], [196, 13]], py: [[197, 45], [198, 30], [199, 25]], by: [[208, 72], [209, 14], [210, 10], [211, 4]],
  or: [[200, 50], [201, 15], [202, 15], [203, 20]], dr: [[204, 35], [205, 45], [206, 20]], ot: [[192, 25], [207, 10], [212, 25], [213, 15], [214, 10], [215, 10], [216, 5]],
};
const FLAME_THIRDS = [   // base, middle, tip: [group, share]
  [['wy', 38], ['py', 12], ['by', 18], ['or', 6], ['dr', 3], ['ot', 23]],
  [['wy', 23], ['py', 8], ['by', 28], ['or', 7], ['dr', 4], ['ot', 29]],
  [['wy', 7], ['py', 8], ['by', 43], ['or', 16], ['dr', 11], ['ot', 14]],
];
const FLAME_EDGE = [[200, 30], [210, 22], [211, 20], [209, 10], [203, 10], [197, 5], [201, 3]];
const SPARK_COLORS = [[205, 29], [208, 14], [200, 10], [210, 9], [203, 6], [209, 6], [211, 5], [204, 5], [194, 4], [197, 4], [195, 4], [196, 4]];
const flameColor = (r, f) => weighted(r, FLAME_GROUPS[weighted(r, FLAME_THIRDS[f < 0.34 ? 0 : f < 0.67 ? 1 : 2])]);
// One flame frame drawn into `cv`. o: ax, ay (trunk foot), half (flame half width), top (tallest tip above ay), nT (tongues),
// coreH/coreHW (the stable core that every frame shares), deep (px below the anchor at the trunk), arch (flank reach up the crown), seeds.
function drawFlame(cv, o, rr, rcore) {
  const { ax, ay, half, top, nT, coreH, coreHW, deep } = o;
  const fire = new Uint8Array(cv.w * cv.h), colTop = new Map();
  const mark = (x, y) => { if (x >= 0 && y >= 0 && x < cv.w && y < cv.h) fire[y * cv.w + x] = 1; };
  const baseY = dx => {           // lowest fire row at distance dx from the trunk: an arch, the crest is the ground
    if (dx <= 7) return ay + deep;
    if (dx <= 12) return ay + 1;
    if (dx <= 18) return ay - Math.round(o.arch[0]);
    return ay - Math.round(o.arch[1]);
  };
  // stable core: a tall column that reaches the ground at the trunk, narrower higher up (same every frame)
  const nk = (x, y, s) => vnoise(x / 2.2, y / 2.2, s);
  for (let y = ay + deep; y >= ay - coreH; y--) {
    const up = ay - y, hw = coreHW * (1 - 0.55 * Math.pow(Math.max(0, up) / coreH, 1.2));
    for (let x = Math.ceil(ax - hw - 1); x <= ax + hw + 1; x++) {
      const dx = Math.abs(x - ax); if (y > baseY(dx)) continue;
      if (dx <= hw + (nk(x, y, o.coreSeed) - 0.5) * 3) mark(x, y);
    }
  }
  // tongues: tips 2-4 px wide, widening below, leaning slightly left, redrawn every frame
  const tongues = [];
  for (let t = 0; t < nT; t++) {
    const off = clamp(Math.round(-3 + (rr() + rr() + rr() - 1.5) * 12), -half, half);
    const reach = 1 - 0.45 * Math.abs(off) / Math.max(half, 1);
    const ht = clamp(Math.round(top * (0.55 + 0.45 * rr()) * reach), 24, top);
    tongues.push({ xc: ax + off, ht, sway: -2.5 + (rr() - 0.5) * 3 });
  }
  tongues.sort((a, b) => b.ht - a.ht)[0].ht = top;   // one tongue always reaches the frame's top
  for (const tg of tongues) for (let up = -deep; up <= tg.ht; up++) {
    const y = ay - up, rel = tg.ht - up;
    const w = Math.min(o.tongueW[1], o.tongueW[0] + rel * 0.17) + (rr() - 0.5) * 1.6;
    const cx = tg.xc + tg.sway * (up / tg.ht) + (rr() - 0.5) * 0.8;
    for (let x = Math.round(cx - w / 2); x <= Math.round(cx + w / 2); x++) {
      const dx = Math.abs(x - ax), b = baseY(dx);
      if (y > b) continue;
      if (dx > 18 && (hash2(x, up >> 3, o.coreSeed) < 0.58)) continue;     // most far-flank columns carry no fire
      mark(x, y);
    }
  }
  // islands of char inside the flame, ragged rim
  for (let k = 0; k < fire.length; k++) if (fire[k] && rr() < o.hole) fire[k] = 0;
  const g = (x, y) => (x >= 0 && y >= 0 && x < cv.w && y < cv.h) ? fire[y * cv.w + x] : 0;
  for (let x = 0; x < cv.w; x++) { let tp = -1, bt = -1; for (let y = 0; y < cv.h; y++) if (g(x, y)) { if (tp < 0) tp = y; bt = y; } if (tp >= 0) colTop.set(x, [tp, bt]); }
  for (let y = 0; y < cv.h; y++) for (let x = 0; x < cv.w; x++) {
    if (!fire[y * cv.w + x]) continue;
    const [tp, bt] = colTop.get(x), f = bt === tp ? 0.5 : (bt - y) / (bt - tp);
    const edge = g(x - 1, y) + g(x + 1, y) + g(x, y - 1) + g(x, y + 1) < 4 && rr() < 0.3;
    put(cv, x, y, edge ? weighted(rr, FLAME_EDGE) : flameColor(rr, f));
  }
  // sparks: about 7 isolated dark-red and yellow pixels around and above the tongues
  const nSp = Math.round(o.sparks * (0.6 + 0.8 * rr()));
  for (let i = 0; i < nSp; i++) {
    const x = ax + Math.round((rr() - 0.5) * (half * 2 + 8)), y = ay - Math.round(rr() * (top + 6));
    if (g(x, y) || g(x - 1, y) || g(x + 1, y) || g(x, y - 1) || g(x, y + 1)) continue;
    put(cv, x, y, weighted(rr, SPARK_COLORS));
  }
  return fire;
}
function charColor(r) { return weighted(r, [[95, 28], [47, 24], [93, 17], [94, 14], [62, 6], [61, 5], [92, 3], [89, 2], [91, 1]]); }
const CHAR_CROWN = [[93, 22.9], [91, 14.8], [90, 11.1], [92, 7.4], [87, 2.8], [95, 3.4], [94, 2.1], [61, 1], [62, 1]];
// Tree burn: frames 0-8 lead-in, 9-79 repeating 14-frame cycle, 80-95 tail ending on the burnt successor.
function burnSequence(tree, burnt, seed, nFrames = 96, conifer = false) {
  const body = tree.body, b = burnt.body, r = rng(mix32(seed, 31));
  const padT = 38, padS = 14, w = body.w + padS * 2, h = body.h + padT + 6, ox = padS, oy = padT;
  const ax = body.ax + ox, ay = body.ay + oy, cw = body.w;
  const at2 = (x, y) => (x >= 0 && y >= 0 && x < body.w && y < body.h && body.a[y * body.w + x]) ? body.idx[y * body.w + x] : -1;
  // charred crown: one cut at frame 9. The shape stays but loses about 3 columns each side; old shade stays as dark greens.
  const charred = newSprite(w, h, ax, ay), rc = rng(mix32(seed, 77));
  for (let y = 0; y < body.h; y++) {
    let x0 = body.w, x1 = -1; for (let x = 0; x < body.w; x++) if (body.a[y * body.w + x]) { x0 = Math.min(x0, x); x1 = x; }
    for (let x = 0; x < body.w; x++) {
      const k = y * body.w + x; if (!body.a[k] || x < x0 + 3 || x > x1 - 3 || (y < body.h - 8 && rc() < 0.04)) continue;
      const i = body.idx[k], dark = i >= 44 && i <= 47 || (i >= 90 && i <= 95) || (i >= 55 && i <= 62);
      put(charred, x + ox, y + oy, dark && rc() < 0.45 ? weighted(rc, [[43, 3], [44, 4], [45, 5], [46, 3], [47, 2]]) : weighted(rc, CHAR_CROWN));
    }
  }
  const living = newSprite(w, h, ax, ay);
  for (let y = 0; y < body.h; y++) for (let x = 0; x < body.w; x++) if (body.a[y * body.w + x]) put(living, x + ox, y + oy, body.idx[y * body.w + x]);
  const skel = newSprite(w, h, ax, ay);
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if (b.a[y * b.w + x]) put(skel, x - b.ax + ax, y - b.ay + ay, b.idx[y * b.w + x]);
  const flameHalf = conifer ? Math.round(cw * 0.59) : Math.round(cw * 0.36), top0 = Math.min(padT + body.ay - 4, conifer ? 72 : 76);
  const base = { ax, ay, half: flameHalf, top: top0, nT: 5, coreH: conifer ? 40 : 38, coreHW: conifer ? 9 : 10, deep: conifer ? 5 : 3, arch: conifer ? [5, 12] : [7, 16], tongueW: [2.4, 10], sparks: 10, hole: conifer ? 0.12 : 0.2, coreSeed: (seed * 7) | 0 };
  const compose = (under, flameO, fseed, extra) => {
    const cv = cloneSprite(under), fl = newSprite(w, h, ax, ay);
    drawFlame(fl, flameO, rng(fseed), null);
    for (let k = 0; k < w * h; k++) if (fl.a[k]) { cv.idx[k] = fl.idx[k]; cv.a[k] = 1; }
    if (extra) extra(cv);
    return cv;
  };
  const leadTop = [27, 40, 43, 51, 48, 76, 75, 76], leadN = [2, 3, 3, 4, 4, 5, 5, 5];
  const cycleN = [5, 5, 4, 4, 2, 4, 6, 6, 5, 3, 7, 4, 4, 2];
  const frames = new Array(nFrames), cycle = [];
  frames[0] = cropSprite(living);
  for (let f = 1; f <= 8; f++) frames[f] = cropSprite(compose(living, { ...base, top: Math.min(leadTop[f - 1], top0), nT: leadN[f - 1], coreH: Math.round(base.coreH * f / 8), hole: 0.12 }, mix32(seed, 500 + f)));
  for (let c = 0; c < 14; c++) cycle.push(cropSprite(compose(charred, { ...base, top: top0 - 6 + Math.round(rng(mix32(seed, 900 + c))() * 12), nT: cycleN[c] }, mix32(seed, 700 + c))));
  for (let f = 9; f <= 79; f++) frames[f] = cycle[(f - 9) % 14];                   // the same bytes every repeat
  for (let f = 80; f < nFrames; f++) {
    const t = (f - 80) / (nFrames - 80), die = f >= 91 ? (nFrames - 1 - f) / 5 : 1;
    const crown = cloneSprite(charred), vr = rng(mix32(seed, 60 + f));
    for (let k = 0; k < w * h; k++) if (crown.a[k] && (hash2(k % w, (k / w) | 0, seed) < t * 1.05 + 0.1)) crown.a[k] = 0;
    for (let k = 0; k < w * h; k++) if (skel.a[k] && !crown.a[k]) { crown.idx[k] = skel.idx[k]; crown.a[k] = 1; }
    const wide = 1 + 0.35 * (1 - Math.abs(t - 0.4));
    if (f === nFrames - 1) {            // the burnt successor's exact size and anchor, with about 16% glowing embers
      const last = cloneSprite(b), re = rng(mix32(seed, 4242));
      for (let k = 0; k < last.w * last.h; k++) if (last.a[k] && re() < 0.16) last.idx[k] = weighted(re, [[205, 30], [200, 18], [203, 14], [204, 14], [211, 8], [210, 8], [206, 8]]);
      frames[f] = last; continue;
    }
    frames[f] = cropSprite(compose(crown, { ...base, half: Math.round(flameHalf * wide), top: Math.max(14, Math.round(top0 * die)), nT: 5 + (f & 1), coreH: Math.max(12, Math.round(base.coreH * (0.9 + 0.7 * (1 - t)) * die)), coreHW: base.coreHW + 4, hole: 0.1 }, mix32(seed, 1100 + f)));
  }
  return frames;
}
// Shrub burn: 42 frames, flame only: 2 lead-in frames, a 14-frame cycle repeated through frame 41. Last frame ember.
function shrubBurn(shrub, seed, nFrames = 42) {
  const W = 30, H = 42, ax = 15, ay = H - 4, mk = (c) => {
    const cv = newSprite(W, H, ax, ay);
    drawFlame(cv, { ax, ay, half: 8, top: 22 + Math.round(rng(mix32(seed, 300 + c))() * 11), nT: 3, coreH: 12, coreHW: 4.5, deep: 1, arch: [6, 12], tongueW: [2.2, 8], sparks: 1, hole: 0.03, coreSeed: seed & 1023 }, rng(mix32(seed, 40 + c)));
    const rch = rng(mix32(seed, 800 + c)); for (let k = 0; k < 3; k++) { const x = ax + Math.round((rch() - 0.5) * 12), y = ay - Math.round(rch() * 4); if (!cv.a[y * W + x]) put(cv, x, y, charColor(rch)); }
    return cropSprite(cv);
  };
  const frames = [], cycle = []; for (let c = 0; c < 14; c++) cycle.push(mk(c));
  frames.push(mk(100), mk(101));
  for (let f = 2; f < nFrames - 1; f++) frames.push(cycle[(f - 2) % 14]);
  const last = newSprite(16, 14, 8, 11), rr = rng(mix32(seed, 99));      // a dying pale-yellow ember (spec 15)
  for (let k = 0; k < 260; k++) put(last, 8 + Math.round((rr() - 0.5) * 11), 11 - Math.round(rr() * 8), weighted(rr, [[208, 26], [195, 14], [194, 11], [209, 9], [210, 8], [193, 6], [196, 5], [192, 3], [205, 6]]));
  for (let k = 0; k < 7; k++) put(last, 8 + Math.round((rr() - 0.5) * 8), 11 - Math.round(rr() * 3), charColor(rr));
  frames.push(cropSprite(last));
  return frames;
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
  tree: [['species', 'broadleaf|conifer', null, 'broadleaf', 'leafy crown or narrow conifer'], ['height', 55, 72, 68, 'size in px (broadleaf 66-71, conifer 57-64 in retail)'], ['width', 0.42, 0.74, 0.7, 'width over height'], ['crown', 0, 1, 0.6, 'smooth to lobed, ragged silhouette'], ['density', 0, 1, 0.6, 'solid to holey and sparse'], ['lean', -1, 1, 0, 'olive and yellow, to lush and bright'], ['energy', '[lo,hi]', null, '[250,250]', 'gameplay energy range; tracks height inside the range']],
  burnt: [['height', 50, 66, 58, 'size in px'], ['width', 0.4, 0.75, 0.55, 'width over height'], ['forks', 2, 5, 3, 'branch forks off the trunk'], ['ash', 0, 1, 0.5, 'amount of pale ash pixels']],
  shrub: [['width', 20, 36, 29, 'width in px'], ['height', 14, 28, 22, 'height in px'], ['density', 0, 1, 0.5, 'sparse scatter to full clump'], ['lean', -1, 1, 0, 'brightness of the leaf highlights']],
  rock: [['cells', '1x1|2x2|3x2|3x3|4x3', null, '2x2', 'footprint class, sets the pixel size and the metal'], ['size', 0.7, 1.15, 1, 'scale inside the class'], ['angular', 0, 1, 0.6, 'round boulder to faceted block']],
  scar: [['type', 'smudge|stain', null, 'smudge', 'scorch blot or rock stain'], ['size', 0.3, 1.3, 1, 'size'], ['density', 0, 1, 0.55, 'stipple density']],
  deposit: [['metal', 86, 223, 127, 'metal value; sets the chunk count (7 to 23) and the halo']],
  vent: [['size', 0.6, 1.6, 1, 'crack length and thickness'], ['forks', 2, 4, 3, 'how often the crack forks']],
};
const NAMES = { tree: 'Tree', burnt: 'TreeDead', shrub: 'Shrub', rock: 'Rock', scar: 'Smudge' };

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
    burnt = generateFeature('burnt', bp, mix32(seed, 6), ctx);
    burn = burnSequence({ body }, { body: burnt.body }, seed, 96, conifer);
    const sizeFrac = clamp((P.height - 55) / 17, 0, 1);
    gameplay = { energy: pickValue(P.energy, sizeFrac, rr), metal: 0, blocking: true, reclaimable: true, flamable: true, burnTicks: 192, spreadChance: conifer ? 30 : 90 };
  } else if (kind === 'burnt') {
    const B = burntFrame(P, seed, ctx);
    body = B.body;
    shadow = makeShadow(body, { side: L.shadowSide, shx: 0.55, up: 0.6, colors: TREE_SHADOW_COLORS, soften: 0, grow: 0.15 }, rng(mix32(seed, 42)));
    gameplay = { energy: pickValue(P.energy, undefined, rr), metal: 0, blocking: true, reclaimable: true, flamable: false };
  } else if (kind === 'shrub') {
    body = shrubFrame(P, seed, ctx).body;
    burn = shrubBurn(body, seed);
    gameplay = { energy: pickValue(P.energy, undefined, rr), metal: 0, blocking: false, reclaimable: true, flamable: true, burnTicks: 84, spreadChance: 30 };
  } else if (kind === 'rock') {
    const R = rockFrame(P, seed, ctx);
    body = R.body;
    const [fw, fh] = ROCK_CELLS[P.cells] || [2, 2];
    footprint = [fw, fh];
    shadow = makeShadow(body, { side: L.shadowSide, shx: 0.5, up: -0.22, groundY: body.h - 3, colors: ROCK_SHADOW_COLORS, soften: 1, grow: 0.2 }, rng(mix32(seed, 43)));
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

export const DEPOSIT_DEFAULTS = { metal: 127, style: 'blob' };   // style: 'blob' (four angular chunks in a moss halo); a scratch style is planned
const STONE_CLASSES = [
  { w: 0.29, ramp: [[216, 3], [224, 3], [145, 4], [114, 5], [130, 2]] },        // pale: lilac-white, pink-lilac, pale blue
  { w: 0.22, ramp: [[115, 8], [131, 3], [147, 3], [217, 3], [148, 3], [87, 3]] }, // light and mid
  { w: 0.49, ramp: [[116, 17], [117, 5], [89, 9], [88, 8], [219, 4], [87, 2]] },  // steel blue and gray
];
const MOSS_WEIGHTS = [[170, 20], [168, 8.3], [61, 7.8], [169, 7.5], [238, 7.2], [60, 5.3], [73, 4.7], [172, 4], [62, 3.2], [90, 3], [167, 2.6]];
export function paintDeposit(ground, cx, cy, params = {}, seed = 1, ctx = {}) {
  const P = { ...DEPOSIT_DEFAULTS, ...params }, palette = ctx.palette, q = paletteSearch(palette);
  const r = rng(seed), rn = rng(mix32(seed, 2));
  const mt = clamp((P.metal - 86) / (223 - 86), 0, 1);
  // four main chunks: one dominant (54-86% of the stone pixels), three small wedges
  const total = lerp(200, 880, mt) * (0.9 + 0.2 * r()), dom = clamp(lerp(0.54, 0.86, mt) + (r() - 0.5) * 0.08, 0.5, 0.88);
  const small = [0, 0, 0].map(() => 0.4 + r()), ss = small.reduce((a, b) => a + b, 0);
  const areas = [total * dom, ...small.map(v => Math.max(15, total * (1 - dom) * v / ss))];
  const bw = 100, bh = 100, ox = Math.round(cx) - 50, oy = Math.round(cy) - 50;
  const chunkId = new Int8Array(bw * bh).fill(-1);
  const polyMask = (px, py, rad, nv, aspect, rot) => {
    // straight-edged polygon: nv corners at jittered angles and radii (angular, flat faces)
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
  const chunks = [];
  const layout = [[0, 0]];
  for (let i = 0; i < 3; i++) { const a = r() * TAU + i * 2.1, d = Math.sqrt(areas[0] / Math.PI / 0.85) * 0.75 + 11 + r() * 8; layout.push([Math.cos(a) * d, Math.sin(a) * d * 0.9]); }
  for (let ci = 0; ci < 4; ci++) {
    let px = cx + layout[ci][0], py = cy + layout[ci][1], pts = [];
    if (ci === 0 && mt > 0.45) {     // a ragged cluster of 2-4 touching facets
      const k = 2 + Math.round(mt * 2 * r() + mt), per = areas[0] / (k * 0.8), seen = new Set();
      for (let j = 0; j < k; j++) for (const p of sized(px + (r() - 0.5) * Math.sqrt(per) * 1.1, py + (r() - 0.5) * Math.sqrt(per) * 1.1, per, 4 + Math.floor(r() * 2), 1 + r() * 0.5, r() * TAU)) { const key = p[1] * 4096 + p[0]; if (!seen.has(key)) { seen.add(key); pts.push(p); } }
    } else pts = sized(px, py, areas[ci], 4 + Math.floor(r() * 2), 1 + r() * (ci === 0 ? 0.6 : 0.8), r() * TAU);
    chunks.push(pts);
    // two-tone facets inside the chunk: 2-4 planes, each a tone class
    const nf = ci === 0 ? 2 + Math.floor(r() * 3) : 2, seeds = [];
    const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length, my = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    for (let f = 0; f < nf; f++) { const cls = f === 0 ? 0 : f === 1 ? 2 : weighted(r, [[0, 0.29], [1, 0.22], [2, 0.49]]); seeds.push({ x: mx + (r() - 0.5) * 12, y: my + (r() - 0.5) * 10, cls, fav: [weighted(r, STONE_CLASSES[cls].ramp), weighted(r, STONE_CLASSES[cls].ramp)] }); }
    for (const [x, y] of pts) {
      const bx = x - ox, by = y - oy; if (bx < 0 || by < 0 || bx >= bw || by >= bh) continue;
      let b = 0, bd = 1e9; seeds.forEach((sd, i) => { const d = Math.hypot(sd.x - x, sd.y - y) + (vnoise(x / 2.5, y / 2.5, seed + ci * 7 + i) - 0.5) * 3; if (d < bd) { bd = d; b = i; } });
      const cls = rn() < 0.12 ? weighted(rn, [[0, 0.29], [1, 0.22], [2, 0.49]]) : seeds[b].cls;
      chunkId[by * bw + bx] = ci;
      setGround(ground, x, y, palette[cls === seeds[b].cls && rn() < 0.82 ? seeds[b].fav[rn() < 0.6 ? 0 : 1] : weighted(rn, STONE_CLASSES[cls].ramp)]);
    }
  }
  // moss halo: a 3-6 px feathered rim hugging every chunk, merging between neighbors
  const stonePts = chunks.flat(), s1 = (r() * 1e6) | 0;
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    if (chunkId[y * bw + x] >= 0) continue;
    const X = x + ox, Y = y + oy; let d = 99, big = true;
    chunks.forEach((pts, ci) => { for (const p of pts) { const dd = Math.abs(p[0] - X) + Math.abs(p[1] - Y); if (dd < 16) { const e = Math.hypot(p[0] - X, p[1] - Y) - (ci === 0 ? 0 : 1.5); if (e < d) { d = e; big = ci === 0; } } } });
    if (d > 12) continue;
    const ring = (big ? 3.8 : 5) + 3.2 * fbm(X / 4, Y / 4, s1, 2);
    const pr = d <= 3 ? 0.98 : clamp((ring - d) / 2.2, 0, 1) * 0.95;
    if (rn() > pr) continue;
    const base = getGround(ground, X, Y), m = palette[weighted(rn, MOSS_WEIGHTS)], tint = 0.18 + 0.12 * rn();
    setGround(ground, X, Y, palette[q(lerp(m[0], base[0] * 0.62, tint), lerp(m[1], base[1] * 0.62, tint), lerp(m[2], base[2] * 0.62, tint))]);
  }
  return { cx, cy, metal: P.metal, chunks: 4, stonePx: stonePts.length, dominant: areas[0] / total, rect: [ox, oy, bw, bh], gameplay: { metal: P.metal, indestructible: true, footprint: [3, 3] } };
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
