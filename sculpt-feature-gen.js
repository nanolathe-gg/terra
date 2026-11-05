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
const BURNT_DEFAULTS = { height: 58, width: 0.55, forks: 3, ash: 0.5, energy: [50, 50] };
function burntFrame(P, seed, ctx) {
  const r = rng(seed), rn = rng(mix32(seed, 5));
  const H = Math.round(P.height), W = Math.round(H * P.width);
  const w = W + 14, h = H + 4, ax = Math.round(w / 2 + (r() - 0.5) * 2), ay = h - 3;
  const sp = newSprite(w, h, ax, ay);
  const cells = new Map();   // key -> [x,y,thickness class, depth]
  const segs = [];
  function line(x0, y0, x1, y1, t0, t1, depth) {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    for (let i = 0; i <= n; i++) {
      const f = i / n, x = lerp(x0, x1, f), y = lerp(y0, y1, f), t = lerp(t0, t1, f);
      const rad = Math.max(0.5, t / 2);
      for (let dy = -Math.ceil(rad); dy <= Math.ceil(rad); dy++) for (let dx = -Math.ceil(rad); dx <= Math.ceil(rad); dx++) {
        if (dx * dx + dy * dy <= rad * rad + 0.3) { const px = Math.round(x + dx), py = Math.round(y + dy), key = py * w + px; if (!cells.has(key) || cells.get(key)[3] > depth) cells.set(key, [px, py, t, depth]); }
      }
    }
  }
  const maxDepth = 5;
  function branch(x, y, ang, len, th, depth) {
    // ang: radians from straight up; sway as it goes
    let px = x, py = y, a = ang;
    const steps = Math.max(2, Math.round(len / 5));
    for (let i = 0; i < steps; i++) {
      a += (r() - 0.5) * 0.35;
      const nx = px + Math.sin(a) * len / steps, ny = py - Math.cos(a) * len / steps;
      line(px, py, nx, ny, th * (1 - i / (steps * 1.6)), th * (1 - (i + 1) / (steps * 1.6)), depth);
      px = nx; py = ny;
      if (depth < maxDepth && i > 0 && i < steps - 1 && r() < 0.28 * (P.forks / 3)) {   // side twig
        const side = r() < 0.5 ? -1 : 1;
        branch(px, py, a + side * (0.5 + r() * 0.5), len * (0.35 + r() * 0.3), Math.max(1, th * 0.5), depth + 1);
      }
    }
    if (depth >= maxDepth || len < 5) return;
    const nf = depth === 0 ? Math.max(2, Math.round(P.forks)) : (r() < 0.7 ? 2 : 3);
    for (let k = 0; k < nf; k++) {
      const spread = 0.35 + r() * 0.45;
      const aa = a + (k - (nf - 1) / 2) * spread * (0.8 + r() * 0.4) + (r() - 0.5) * 0.2;
      branch(px, py, aa, len * (0.62 + r() * 0.2), Math.max(1.4, th * (depth < 1 ? 0.7 : 0.78)), depth + 1);
    }
  }
  const trunkLen = H * 0.27;
  branch(ax, ay, (r() - 0.5) * 0.15, trunkLen, 5.6 + r() * 1.5, 0);
  // base flare
  for (let dx = -3; dx <= 3; dx++) for (let dy = 0; dy < 3; dy++) if (Math.abs(dx) <= 3 - dy * 0.5 + (r() < 0.3 ? 1 : 0)) cells.set((ay - dy + 1) * w + ax + dx, [ax + dx, ay - dy + 1, 5, 0]);
  let half = 1; for (const [, c] of cells) half = Math.max(half, Math.abs(c[0] - ax));
  const sq = Math.min(1, (W / 2) / half), cells2 = new Map();
  for (const [, c] of cells) { const x = Math.round(ax + (c[0] - ax) * sq); cells2.set(c[1] * w + x, [x, c[1], c[2], c[3]]); }
  cells.clear(); for (const [k, c] of cells2) cells.set(k, c);
  const mask = new Uint8Array(w * h);
  for (const [, c] of cells) if (inb(sp, c[0], c[1])) mask[c[1] * w + c[0]] = 1;
  const strays = Math.round(8 + 10 * r());
  for (let i = 0; i < strays; i++) {            // broken twig bits and leftover flecks
    const keys = [...cells.keys()], kk = keys[(r() * keys.length) | 0], c = cells.get(kk);
    if (c[3] >= 2) { const x = c[0] + Math.round((r() - 0.5) * 6), y = c[1] + Math.round((r() - 0.5) * 6); if (inb(sp, x, y)) mask[y * w + x] = 1; }
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x; if (!mask[k]) continue;
    const c = cells.get(k), depth = c ? c[3] : 4, thick = c ? c[2] : 1;
    const baseT = clamp((y - (ay - 12)) / 12, 0, 1);       // pale stump base
    const v = 0.3 * vnoise(x / 2.4, y / 2.4, 77) + 0.7 * rn();
    let col;
    const ashP = P.ash * 0.06 + baseT * 0.08;
    if (rn() < ashP) col = pick(rn, [89, 91, 90, 88]);
    else col = byQuantile(BURNT_TABLE, v);
    if (thick >= 3 && rn() < 0.35) col = pick(rn, [61, 62, 95]);
    put(sp, x, y, col);
  }
  return { body: cropSprite(sp, 0) };
}

// ---- shrubs ----------------------------------------------------------------------------------------------------
const SHRUB_DEFAULTS = { width: 29, height: 22, density: 0.5, lean: 0, energy: [20, 20] };
function shrubFrame(P, seed, ctx) {
  const r = rng(seed);
  const W = Math.round(P.width), H = Math.round(P.height), w = W + 4, h = H + 4;
  const ay = h - 4, ax = Math.round(w / 2) + (r() < 0.5 ? 0 : -1);
  const sp = newSprite(w, h, ax, ay);
  const nClumps = Math.round(lerp(14, 36, P.density) * (W / 29));
  const used = new Uint8Array(w * h);
  const clumps = [];
  const px = [];
  const hi = P.lean > 0 ? [163, 162, 164, 165] : [165, 164, 163, 167];
  for (let c = 0; c < nClumps; c++) {
    const a = r() * TAU, rr = Math.sqrt(r());
    const cx = ax + Math.cos(a) * rr * W * 0.46, cy = ay - H * 0.5 + Math.sin(a) * rr * H * 0.42 - 1;
    // a clump: a 3-8 px cluster, lit pixels on top and to the left, a dark underside
    const n = 3 + Math.floor(r() * 6);
    const cells = [[0, 0]];
    while (cells.length < n) { const [bx, by] = pick(r, cells), d = pick(r, [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 0], [-1, 0]]); if (!cells.some(q => q[0] === bx + d[0] && q[1] === by + d[1])) cells.push([bx + d[0], by + d[1]]); }
    for (const [dx, dy] of cells) {
      const x = Math.round(cx + dx), y = Math.round(cy + dy);
      if (!inb(sp, x, y) || used[y * w + x]) continue;
      used[y * w + x] = 1;
      const below = cells.some(q => q[0] === dx && q[1] === dy + 1), above = cells.some(q => q[0] === dx && q[1] === dy - 1);
      let col;
      if (!below) col = weighted(r, [[173, 62], [169, 10], [167, 16], [165, 12]]);              // underside
      else if (!above) col = weighted(r, [[165, 34], [163, 22], [164, 18], [162, 6], [167, 20]]);   // lit top
      else col = weighted(r, [[167, 30], [166, 20], [165, 34], [168, 10], [173, 6]]);
      if (r() < 0.04) col = pick(r, hi);
      px.push([x, y, col]);
    }
  }
  for (const [x, y, c] of px) put(sp, x, y, c);
  // pull a few darks next to bright ones (a leaf underside)
  for (const [x, y, c] of px) if ((c === 163 || c === 164 || c === 162) && !at(sp, x, y + 1) && r() < 0.8) put(sp, x, y + 1, 173);
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
  // facets: Voronoi cells with their own tilt
  const nf = 3 + Math.round(P.angular * 2 + r()), seeds = [];
  for (let i = 0; i < nf; i++) {
    const sx = (r() - 0.5) * 1.3, sy = (r() - 0.5) * 1.1;
    seeds.push({ x: cx + sx * Wh * 0.7, y: cy + sy * Hh * 0.7, tx: sx * 0.9 + (r() - 0.5) * 0.9, ty: sy * 0.9 + (r() - 0.5) * 0.9 });
  }
  const sf = P.angular;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x; if (!mask[k]) continue;
    let b = -1, bd = 1e9, b2 = 1e9;
    for (let i = 0; i < nf; i++) { const d = Math.hypot(seeds[i].x - x, seeds[i].y - y) + (vnoise(x / 3, y / 3, seed + i) - 0.5) * 3; if (d < bd) { b2 = bd; bd = d; b = i; } else if (d < b2) b2 = d; }
    const f = seeds[b];
    const ex = (x - cx) / Wh, ey = (y - cy) / Hh, dz = Math.sqrt(Math.max(0.04, 1 - ex * ex * 0.8 - ey * ey * 0.8));
    // normal: dome blended with the facet's flat tilt
    let nx = lerp(ex * 0.9, f.tx * 1.1, 0.5 + 0.4 * sf), ny = lerp(ey * 0.9, f.ty * 1.1, 0.5 + 0.45 * sf), nz = lerp(dz, 0.75, 0.5 * sf);
    const nn = Math.hypot(nx, ny, nz); nx /= nn; ny /= nn; nz /= nn;
    const lam = nx * L.v[0] + ny * L.v[1] + nz * L.v[2];
    const tt = y / h;
    let lev = 4.5 + 7.5 * (lam - 0.45) * L.ambient;
    lev += (-ex * -L.x - ey * -L.y) * 0;     // (lamp term already holds the direction)
    const dd = dist[k];
    if (dd <= 1) lev -= 3.0; else if (dd === 2) lev -= 1.1; // dark rim
    if (b2 - bd < 1.4) lev -= 2.2;           // crack between facets
    if (tt > 0.66) lev -= ((tt - 0.66) / 0.34) * 4.6;     // dark base
    lev += ((rn() - 0.5) * 2.0) * 1.5 + (vnoise(x / 1.5, y / 1.5, seed + 17) - 0.5) * 2.6;
    // color
    let col;
    const li = Math.round(lev);
    if (li >= 11) {
      const ti = clamp(li - 11, 0, 4); col = IDX.TAN[ti] === undefined ? 64 : IDX.TAN[ti];
      if (li >= 14 && rn() < 0.2) col = IDX.WHITE;
    } else col = GR[clamp(li, 0, 10)];
    if (lev > 6.5 && rn() < 0.035) col = IDX.PINK[clamp(Math.round((lev - 6) * 0.9 + (rn() - 0.5) * 2), 0, 4)];
    else if (lev > 3.5 && lev < 8 && rn() < 0.012) col = IDX.PINK[clamp(Math.round(rn() * 2), 0, 2)];
    put(sp, x, y, col);
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

// ---- fire --------------------------------------------------------------------------------------------------------
const HEAT_TABLES = [
  [[195, 45], [209, 28], [196, 14], [197, 8], [210, 5]],                                  // core, heat > .66
  [[210, 40], [209, 18], [197, 17], [198, 9], [195, 8], [196, 4], [200, 4]],              // body
  [[200, 28], [211, 24], [205, 14], [203, 10], [204, 8], [199, 8], [198, 6], [210, 2]],   // edge
];
function flamePixels(frameSeed, stage, o, canvas) {
  // `canvas` gets flame pixels added. o: {cx, base, width, height, tongues}
  const r = rng(frameSeed), n1 = (frameSeed >>> 3) | 0;
  const { cx, base, width, height } = o;
  const tongues = o.tongues;
  const T = [];
  for (let i = 0; i < tongues; i++) {
    const f = tongues === 1 ? 0.5 : i / (tongues - 1);
    T.push({ x: cx + (f - 0.5) * width * (0.9 + 0.25 * r()), h: height * stage * (0.45 + 0.55 * Math.pow(r(), 0.7)), w: width * (o.narrow ?? 1) * (0.17 + 0.12 * r()) });
  }
  for (let y = base; y > base - height - 4; y--) {
    for (let x = Math.floor(cx - width); x <= cx + width; x++) {
      const up = base - y;
      let cover = 0, heat = 0;
      for (const t of T) {
        if (up > t.h) continue;
        const f = up / t.h, hw = t.w * Math.pow(1 - f, 0.62) + 0.5;
        const dx = Math.abs(x - t.x) + (vnoise(x / 2.3, y / 2.3, n1) - 0.5) * 3.4;
        if (dx < hw) { cover = 1; heat = Math.max(heat, (1 - f) * 0.7 + (1 - dx / hw) * 0.4); }
      }
      if (!cover) continue;
      heat += (r() - 0.5) * 0.45;
      if (r() < (o.hole ?? 0.07)) continue;
      const tab = heat > 0.66 ? HEAT_TABLES[0] : heat > 0.34 ? HEAT_TABLES[1] : HEAT_TABLES[2];
      put(canvas, x, y, weighted(r, tab));
    }
  }
}
function charColor(r) { return weighted(r, [[95, 28], [47, 24], [93, 17], [94, 14], [62, 6], [61, 5], [92, 3], [89, 2], [91, 1]]); }

function burnSequence(tree, burnt, seed, nFrames = 96) {
  const body = tree.body, b = burnt.body;
  const r = rng(mix32(seed, 31));
  // working canvas big enough for the flame above the crown
  const padT = 34, padS = 8;
  const w = body.w + padS * 2, h = body.h + padT + 2, ox = padS, oy = padT;
  const ax = body.ax + ox, ay = body.ay + oy;
  // per-pixel char and vanish thresholds
  const keyOf = (x, y) => y * body.w + x;
  const charT = new Float32Array(body.w * body.h), vanT = new Float32Array(body.w * body.h);
  for (let y = 0; y < body.h; y++) for (let x = 0; x < body.w; x++) {
    const hgt = (y) / body.h;
    charT[keyOf(x, y)] = 0.04 + 0.4 * (0.5 * (1 - hgt) + 0.7 * r());
    vanT[keyOf(x, y)] = 0.55 + 0.38 * r();
  }
  const frames = [];
  const crownH = body.ay, crownW = body.w;
  for (let i = 0; i < nFrames; i++) {
    const cv = newSprite(w, h, ax, ay);
    const p = i / (nFrames - 1);
    if (i === 0) { for (let y = 0; y < body.h; y++) for (let x = 0; x < body.w; x++) if (body.a[keyOf(x, y)]) put(cv, x + ox, y + oy, body.idx[keyOf(x, y)]); frames.push(cropSprite(cv)); continue; }
    if (i === nFrames - 1) { for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if (b.a[y * b.w + x]) put(cv, x - b.ax + ax, y - b.ay + ay, b.idx[y * b.w + x]); frames.push(cropSprite(cv)); continue; }
    // skeleton underneath
    for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if (b.a[y * b.w + x]) put(cv, x - b.ax + ax, y - b.ay + ay, b.idx[y * b.w + x]);
    // crown: green -> char -> gone
    const progress = Math.min(1, i / 36), vanP = clamp((p - 0.5) / 0.46, 0, 1.05);
    for (let y = 0; y < body.h; y++) for (let x = 0; x < body.w; x++) {
      const k = keyOf(x, y); if (!body.a[k]) continue;
      if (vanT[k] < 0.55 + vanP * 0.43 && vanP > 0) continue;
      const rr = rng(mix32(seed + i, k));
      const charred = charT[k] < progress * 0.52;
      if (charred) put(cv, x + ox, y + oy, charColor(rr));
      else put(cv, x + ox, y + oy, body.idx[k]);
    }
    // flame: grows for ~10 frames, steady and flickering, dies down at the end
    const grow = clamp(i / 10, 0.1, 1), die = clamp((nFrames - 1 - i) / 12, 0, 1);
    const stage = Math.min(grow, die) * (0.92 + 0.12 * Math.sin(i * 0.9) + (rng(mix32(seed, i))() - 0.5) * 0.15);
    const fl = newSprite(w, h, ax, ay);
    const mixed = Math.min(1, 0.4 + p * 2);
    flamePixels(mix32(seed, i * 977 + 13), stage, { cx: ax - 1 + (rng(mix32(seed, i + 5))() - 0.5) * 2, base: ay - Math.round(crownH * 0.12), width: crownW * 0.5, height: Math.round(78 * mixed * 0.95 + 4), tongues: 7, hole: 0.4, narrow: 0.72 }, fl);
    for (let k = 0; k < w * h; k++) if (fl.a[k]) { cv.idx[k] = fl.idx[k]; cv.a[k] = 1; }
    frames.push(cropSprite(cv));
  }
  return frames;
}
function shrubBurn(shrub, seed, nFrames = 42) {
  const frames = [];
  const W = 16, H = 32, w = W + 6, h = H + 6, ax = Math.round(w / 2), ay = h - 3;
  for (let i = 0; i < nFrames; i++) {
    const cv = newSprite(w, h, ax, ay), p = i / (nFrames - 1);
    const stage = clamp(Math.min(i / 6, (nFrames - 1 - i) / 10), 0.05, 1) * (0.9 + 0.2 * rng(mix32(seed, i))());
    if (i === nFrames - 1) { const rr = rng(mix32(seed, 99)); for (let k = 0; k < 90; k++) put(cv, ax + Math.round((rr() - 0.5) * 8), ay - Math.round(rr() * 7), weighted(rr, [[205, 30], [206, 24], [207, 20], [214, 14], [215, 12]])); frames.push(cropSprite(cv)); continue; }
    flamePixels(mix32(seed, i * 313 + 7), stage, { cx: ax, base: ay, width: 7, height: 34, tongues: 3, hole: 0.34 }, cv);
    const rc = rng(mix32(seed, i * 17 + 3)); // charred twigs and embers at the foot
    for (let k = 0; k < 40 + 40 * (1 - Math.abs(p - 0.4)); k++) { const x = ax + Math.round((rc() - 0.5) * 12), y = ay - Math.round(rc() * rc() * 9); if (!cv.a[y * w + x]) put(cv, x, y, charColor(rc)); }
    frames.push(cropSprite(cv));
  }
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
    const bp = { height: Math.round(P.height * 0.84), width: conifer ? 0.5 : 0.62, forks: conifer ? 3 : 3, ash: 0.5 };
    burnt = generateFeature('burnt', bp, mix32(seed, 6), ctx);
    burn = burnSequence({ body }, burnt.body ? { body: burnt.body } : burnt, seed);
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

export const DEPOSIT_DEFAULTS = { metal: 127 };
export function paintDeposit(ground, cx, cy, params = {}, seed = 1, ctx = {}) {
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
