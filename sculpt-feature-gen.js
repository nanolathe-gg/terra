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
// ctx.light.z (toward the viewer), when given, is the sun's own elevation in the sprite's view: the page sends the map's sun
// in view space (TA's view looks down the direction (0, south 1, up 2)), so a high sun lights the tops and fronts of a crown.
function lightOf(ctx = {}) {
  let lx = ctx.light?.x ?? -0.62, ly = ctx.light?.y ?? -0.7;
  const n = Math.hypot(lx, ly) || 1;
  let v;
  if (Number.isFinite(ctx.light?.z)) { const m = Math.hypot(lx, ly, ctx.light.z) || 1; v = [lx / m, ly / m, ctx.light.z / m]; }
  else { const lz = 0.6, nn = Math.hypot(lx / n * 0.8, ly / n * 0.8, lz); v = [lx / n * 0.8 / nn, ly / n * 0.8 / nn, lz / nn]; }
  lx /= n; ly /= n;
  return { x: lx, y: ly, v, ambient: clamp(ctx.ambient ?? 1, 0.3, 1.6), shadowSide: lx < 0 ? 1 : -1 };
}
// The view's world-up direction: a face turned to the sky in TA's view (sky light falls on it).
const UP_VIEW = [0, -0.4472, 0.8944];

// ---- color: RGB ramps, the world's light and the game palette -------------------------------------------------------------
// Generators that shade in RGB (rocks, trees, shrubs, plants) take their colors as ramps: '#rrggbb' stops, darkest first, evenly
// spaced in tone. A world's look is its ramps (materials/<world>.json); the defaults are retail Green's, measured from its sprites
// by luma quantile. Every RGB picture is lit by the world's sun and sky colors and then quantized to the game palette.
const rampCache = new Map();
function rampOf(stops) {
  const key = stops.join(); let r = rampCache.get(key);
  if (!r) { r = stops.map(h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))); rampCache.set(key, r); }
  return r;
}
export function rampAt(stops, t) {
  const R = rampOf(stops), n = R.length - 1, f = clamp(t, 0, 1) * n, i = Math.min(n - 1, Math.floor(f)), u = f - i, a = R[i], b = R[i + 1];
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}
const lumaRGB = c => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
// ctx.tint = {sun:[r,g,b], sky:[r,g,b] (0..1, white is the grey light), ambient (the world's unlit share), up (the sun's height,
// world z)}: the renderer's light colors (engine-frag.wgsl): the share of a pixel's light that is sky takes the sky's color and the
// share that is sun the sun's, divided by the tint of open level ground so the exposure stays. A pixel's `lit` is its direct sun
// term n.l (0 in shade, so shadows take the sky's color). Null when both colors are white (every world's default).
function tintOf(ctx) {
  const t = ctx?.tint; if (!t) return null;
  const sun = t.sun || [1, 1, 1], sky = t.sky || [1, 1, 1];
  if (sun.every(v => Math.abs(v - 1) < 1e-4) && sky.every(v => Math.abs(v - 1) < 1e-4)) return null;
  const amb = clamp(t.ambient ?? 0.42, 0.01, 2), up = clamp(t.up ?? 0.71, 0, 1), flat = amb + 0.95 * up;
  const flatLuma = Math.max(0.05, lumaRGB([0, 1, 2].map(i => 1 + (amb * (sky[i] - 1) + 0.95 * up * (sun[i] - 1)) / flat)));
  return lit => { const s = 0.95 * clamp(lit, 0, 1), d = amb + s; return [0, 1, 2].map(i => (1 + (amb * (sky[i] - 1) + s * (sun[i] - 1)) / d) / flatLuma); };
}
// Nearest palette color (weighted RGB distance), over the colors a feature may use: never the transparent key 9 nor the game's
// animated fire and glow range 192-215; a color the palette holds twice maps to its first index, so the bytes are stable.
const quantCache = new WeakMap();
function quantizer(palette) {
  if (!palette) throw new Error('This feature needs the game palette (ctx.palette).');
  let q = quantCache.get(palette);
  if (q) return q;
  const cands = [], seen = new Set();
  for (let i = 0; i < 256; i++) { if (i === 9 || (i >= 192 && i <= 215)) continue; const k = palette[i].join(); if (seen.has(k)) continue; seen.add(k); cands.push(i); }
  const memo = new Map();
  q = (r, g, b) => {
    r = clamp(Math.round(r), 0, 255); g = clamp(Math.round(g), 0, 255); b = clamp(Math.round(b), 0, 255);
    const key = (r << 16) | (g << 8) | b; let best = memo.get(key);
    if (best !== undefined) return best;
    let bd = Infinity;
    for (const i of cands) { const c = palette[i], dr = c[0] - r, dg = c[1] - g, db = c[2] - b, d = 2 * dr * dr + 4 * dg * dg + 3 * db * db; if (d < bd) { bd = d; best = i; } }
    memo.set(key, best); return best;
  };
  quantCache.set(palette, q); return q;
}
// An RGB picture before quantization: rgb (0..255), lit (the direct sun term), a = drawn.
const newCanvas = (w, h, ax, ay) => ({ w, h, ax, ay, rgb: new Float32Array(w * h * 3), lit: new Float32Array(w * h), a: new Uint8Array(w * h) });
function paintRGB(c, x, y, rgb, lit) { if (x < 0 || y < 0 || x >= c.w || y >= c.h) return; const k = y * c.w + x; c.rgb[k * 3] = rgb[0]; c.rgb[k * 3 + 1] = rgb[1]; c.rgb[k * 3 + 2] = rgb[2]; c.lit[k] = lit; c.a[k] = 1; }
// The canvas lit by the world's colors and quantized: a palette sprite. grain (luma units) is a fine, seeded per-pixel jitter
// before quantization: the dither of a rendered and quantized sprite.
function quantize(c, ctx, grain = 0, seed = 1) {
  const q = quantizer(ctx.palette), tint = tintOf(ctx), s = newSprite(c.w, c.h, c.ax, c.ay);
  for (let k = 0; k < c.w * c.h; k++) {
    if (!c.a[k]) continue;
    let r = c.rgb[k * 3], g = c.rgb[k * 3 + 1], b = c.rgb[k * 3 + 2];
    if (tint) { const m = tint(c.lit[k]); r *= m[0]; g *= m[1]; b *= m[2]; }
    if (grain) { const j = (hash2(k % c.w, (k / c.w) | 0, seed) + hash2(k % c.w + 7, (k / c.w) | 0, seed + 1) - 1) * grain; r += j; g += j; b += j; }
    s.idx[k] = q(r, g, b); s.a[k] = 1;
  }
  return s;
}
// A palette sprite lit by the world's colors (sprites drawn as indices: burnt trees, scars, shadows, deposit stone); `lit` the
// direct sun term for every pixel (0: shade and shadows, which take the sky's color). Unchanged when the light is white.
function tintSprite(s, ctx, lit) {
  if (!s || !tintOf(ctx)) return s;
  const c = newCanvas(s.w, s.h, s.ax, s.ay), P = ctx.palette;
  for (let k = 0; k < s.w * s.h; k++) if (s.a[k]) { c.rgb.set(P[s.idx[k]], k * 3); c.lit[k] = lit; c.a[k] = 1; }
  return quantize(c, ctx);
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
const TREE_SHADOW_COLORS = [[245, 41], [95, 40], [92, 6], [93, 7], [94, 6]];   // neutral, so any world's ground shows through (retail Green's, less its 6% dark greens)
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
  colors: null,          // the leaf ramp, darkest first (null: the species' retail Green ramp)
  gap: null,             // the ramp of the dark gaps between leaves (branches and shade seen through the crown)
  trunk: ['#120e0b', '#231f13', '#3b3323', '#534333'],
  flecks: null,          // [[color, share], ...]: second hues among the sunlit leaves (Green's yellow-green, its conifers' grey-olive)
  energy: [250, 250],    // gameplay range (retail: 250 for every tree)
};
// Retail Green's ramps, measured from Tree1-3 and Tree4-7 (chromatic pixels by luma octile; the gaps are the neutral fifth).
const LEAF = {
  broadleaf: { colors: ['#052213', '#033019', '#034224', '#0b4e2a', '#125c2f', '#11723c', '#147e46', '#1f984c'], gap: ['#110e0d', '#1d1912', '#272727', '#393939'], flecks: [['#33bf2b', 0.24], ['#1f9f67', 0.12]], gapShare: 0.19 },
  conifer: { colors: ['#00130b', '#01190d', '#022212', '#052813', '#093516', '#15401e', '#264d23', '#4a6b43'], gap: ['#0b0d06', '#17130f', '#1e1b15', '#2f2f2f'], flecks: [['#534333', 0.2], ['#5f6347', 0.2], ['#473b2b', 0.12]], gapShare: 0.2 },
};
// A tree as a solid (round 9): a crown of leaf lobes round a core, ragged with leaf noise and holed by gaps that show the darker
// leaves inside, on a trunk; a conifer is a tiered cone of needles. Lit by the map's sun: each lobe is bright where it faces the sun
// and shaded by the lobes between it and the sun, the crown's underside and inside dark, so the light pixels gather on the sunlit
// lobes as on a real tree. Colors by rank of tone along the leaf ramp (retail's share of each tone under any sun).
function treeSolid(P, r) {
  const conifer = P.species === 'conifer', Hs = P.height, W = Hs * P.width, a = W / 2, b = a * 0.92;
  const trunkVis = conifer ? 3 : 2, Hc = Hs - trunkVis - 2, c = Math.sqrt(Math.max(9, (Hc / 2) ** 2 - (CE * b) ** 2)) / SE, Uc = (Hc / 2 + trunkVis) / SE;
  const U0 = Uc - c, Utop = Uc + c, branches = [], clusters = clamp(P.clusters ?? 0, 0, 1), crown = clamp(P.crown, 0, 1), dens = clamp(P.density, 0, 1), taper = clamp(P.taper, 0, 1), peaks = clamp(P.peaks, 0, 1);
  const s1 = (r() * 1e6) | 0, s2 = (r() * 1e6) | 0, s3 = (r() * 1e6) | 0;
  const narrow = U => 1 - taper * 0.62 * smoothstep(Uc - c * 0.5, Utop, U);              // the crown narrows toward the top
  let envelope, crownF;
  if (conifer) {
    const tiers = 5 + Math.floor(r() * 3), ph = r() * TAU, lean = (r() - 0.5) * 0.12;
    const R = U => a * Math.pow(clamp((Utop - U) / (Utop - U0), 0, 1), 0.82) * (U < U0 + c * 0.15 ? 0.75 + 0.25 * smoothstep(U0 - 4, U0 + c * 0.15, U) : 1);
    envelope = (E, S, U) => Math.max(Math.hypot(E - lean * (U - U0), S * a / b) - R(U), U0 - 6 - U, U - Utop) * 0.7;
    crownF = (E, S, U) => {
      const t = clamp((U - U0) / (Utop - U0), 0, 1), th = Math.atan2(S, E - lean * (U - U0));
      const tier = 0.13 * Math.sin(tiers * TAU * t + ph + 0.6 * Math.sin(th * 3 + s1 % 7)) * Math.min(1, t * 3) + 0.08 * (vnoise(th * 2.5 + 3, t * 9, s1) - 0.5);
      let f = (Math.hypot(E - lean * (U - U0), S * a / b) - R(U) * (1 + tier)) * 0.7;
      f = Math.max(f, U0 - 6 - U, U - Utop);
      return f + (0.9 + 0.6 * crown) * (vnoise3(E / 1.3, S / 1.3, U / 1.6, s2) - 0.5) * 2 + (1 - dens) * 6 * Math.max(0, vnoise3(E / 3, S / 3, U / 3.4, s3) - 0.58);
    };
  } else {
    // lobes on the envelope, mostly on the side the view sees (south and up), smaller toward the top; peaks reach up from the top
    const lobes = [], nL = Math.round(30 + 14 * crown), K = clusters > 0 ? 3 + Math.round(4 * clusters + r()) : 0;
    // clusters (Archipelago's trees): the leaves gather in K clusters at the ends of branches, open between them
    for (let i = 0; i < K; i++) {
      let d; do { const u = 0.15 + 0.85 * r(), ph = r() * TAU, sq = Math.sqrt(1 - u * u); d = [sq * Math.cos(ph), sq * Math.sin(ph), u]; } while (d[1] * SE + d[2] * CE < -0.1);
      const cen = [a * d[0] * 0.78, b * d[1] * 0.78, Uc + c * d[2] * 0.45 - c * 0.25], m = 6 + Math.round(4 * r());
      branches.push(cen);
      for (let j = 0; j < m; j++) lobes.push([cen[0] + (r() - 0.5) * a * 0.42, cen[1] + (r() - 0.5) * b * 0.42, cen[2] + (r() - 0.5) * c * 0.3, a * (0.11 + 0.08 * r()), 1]);
    }
    for (let i = 0; K === 0 && i < nL * 6 && lobes.length < nL; i++) {
      const u = 2 * r() - 1, ph = r() * TAU, sq = Math.sqrt(1 - u * u), d = [sq * Math.cos(ph), sq * Math.sin(ph), u];
      if (d[1] * SE + d[2] * CE < -0.25) continue;
      const rad = a * (0.22 + 0.12 * r() + 0.06 * crown) * (1 - 0.25 * Math.max(0, d[2])), k = 1 - rad / a * 0.85 - 0.06 * r(), U = Uc + c * d[2] * k, n = narrow(U);
      lobes.push([a * d[0] * k * n, b * d[1] * k * n, U, rad * n, 1]);
    }
    const nPk = Math.round(peaks * 5 * (0.6 + 0.8 * r()));
    for (let i = 0; i < nPk; i++) { const e = (r() - 0.5) * 1.3, U = Utop - c * (0.12 + 0.12 * r()), n = narrow(U); lobes.push([a * e * n * 0.8, b * (r() - 0.4) * 0.6 * n, U + c * 0.1 * peaks, a * (0.16 + 0.08 * r()), 1.6 + 0.8 * peaks]); }
    const core = K ? null : [a * 0.74, b * 0.74, c * 0.76];
    const ek = K ? 0.86 : 1;   // clustered leaves sit inside the crown's outline: their shade is measured from their own depth
    envelope = (E, S, U) => { const n = narrow(U) * ek; return (Math.hypot(E / (a * n), S / (b * n), (U - Uc) / (c * ek)) - 1) * Math.min(a, c) * 0.9; };
    crownF = (E, S, U) => {
      const n = narrow(U);
      let f = core ? (Math.hypot(E / (core[0] * n), S / (core[1] * n), (U - Uc) / core[2]) - 1) * Math.min(core[0], core[2]) * 0.9 : 1e9;
      for (const [x, y, z, rad, st] of lobes) { const dz = (U - z) / st; f = smin(f, Math.hypot(E - x, S - y, dz) - rad, 2.2); }
      return f + (0.8 + 0.9 * crown) * (vnoise3(E / 1.4, S / 1.4, U / 1.5, s2) - 0.5) * 2 + 2.4 * crown * (vnoise3(E / 3.6, S / 3.6, U / 4, s2 + 9) - 0.5) * 2 + (1 - dens) * 5 * Math.max(0, vnoise3(E / 1.9, S / 1.9, U / 2.1, s3) - 0.6);
    };
  }
  const rt = conifer ? 1.6 : 2.4, trunkTop = U0 + c * (conifer ? 0.5 : clusters > 0 ? 0.08 : 0.35), jx = (r() - 0.5) * 1.5;
  const capsule = (E, S, U, A, B, r0, r1) => { const ab = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], ap = [E - A[0], S - A[1], U - A[2]], t = clamp((ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1), 0, 1); return Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t) - lerp(r0, r1, t); };
  const fork = [jx, 0, trunkTop];
  const trunkF = (E, S, U) => {
    const t = clamp(U / trunkTop, 0, 1);
    let f = Math.max(Math.hypot(E - jx * t, S) - rt * (1.15 - 0.4 * t) - (U < 3 ? (3 - U) * 0.45 : 0), -U, U - trunkTop);
    for (const cen of branches) f = Math.min(f, capsule(E, S, U, fork, cen, rt * 0.62, rt * 0.3));   // the branches out to the leaf clusters
    return f;
  };
  const F = (E, S, U) => Math.max(Math.min(crownF(E, S, U), trunkF(E, S, U)), -U);
  return { F, crownF, trunkF, envelope, a, b, c, Uc, U0, Utop, W, conifer, ext: { e0: -a * 1.35, e1: a * 1.35, s0: -b * 1.35, s1: b * 1.35, u: Utop + c * 0.4 * peaks + 3 } };
}
function treeFrame(P, seed, ctx) {
  const L = lightOf(ctx), r = rng(seed), rn = rng(mix32(seed, 77)), sun = worldSun(L), T = treeSolid(P, r), look = LEAF[T.conifer ? 'conifer' : 'broadleaf'];
  const R = renderSolid({ F: T.F, eMin: T.ext.e0, eMax: T.ext.e1, sMin: T.ext.s0, sMax: T.ext.s1, uMax: T.ext.u, sun, shadowSun: flatSun(sun) });
  const { w, h } = R, info = [];
  for (let k = 0; k < w * h; k++) {
    const p = R.px[k]; if (!p) continue;
    const trunk = T.trunkF(p.E, p.S, p.U) < T.crownF(p.E, p.S, p.U) + 0.3, n = p.n;
    const direct = Math.max(0, n[0] * sun[0] + n[1] * sun[1] + n[2] * sun[2]) * p.vis, sky = Math.max(0, n[2]);
    const depth = Math.max(0, -T.envelope(p.E, p.S, p.U)), ao = 1 - smoothstep(0.08 * T.a, 0.45 * T.a, depth);
    let t = (0.6 * direct + 0.25 * sky + 0.15) * lerp(0.3, 1, ao) * lerp(0.6, 1, smoothstep(T.U0, T.U0 + T.c * 0.7, p.U));
    t += (rn() + rn() - 1) * (T.conifer ? 0.18 : 0.32);                               // leaf by leaf: retail's crowns vary pixel to pixel
    info.push({ k, t, ao, direct, trunk, j: hash2(k % w, (k / w) | 0, seed) });
  }
  // the gaps: the deepest and darkest share of the crown takes the gap ramp; the rest of the leaves go by rank of tone
  const leaves = info.filter(q => !q.trunk), gapShare = (P.gapShare ?? look.gapShare) * (1.25 - 0.5 * clamp(P.density, 0, 1));
  const gapScore = q => (1 - q.ao) + 0.7 * (1 - q.t) + 0.55 * q.j, byGap = leaves.slice().sort((p, q) => gapScore(q) - gapScore(p) || p.k - q.k), nGap = Math.round(byGap.length * gapShare), gapSet = new Set(byGap.slice(0, nGap).map(q => q.k));
  const colors = P.colors || look.colors, gap = P.gap || look.gap, flecks = (P.flecks || look.flecks).map(([hex, share]) => [rampOf([hex])[0], share]);
  const c = newCanvas(w, h, R.ox, R.oy), olive = [92, 107, 42], lean = clamp(P.lean, -1, 1);
  const paintRank = (list, ramp, fl) => list.sort((p, q) => p.t - q.t || p.k - q.k).forEach((q, i) => {
    let u = clamp((i + 0.5) / list.length + (lean > 0 ? lean * 0.06 : 0), 0, 1), col = rampAt(ramp, u);
    if (fl && u > 0.84 && q.direct > 0.45) { let acc = 0; const v = rn(); for (const [rgb, share] of fl) { if (v >= acc && v < acc + share) { const f = lumaRGB(col) / Math.max(1, lumaRGB(rgb)); col = rgb.map(x => x * Math.min(1.25, f)); break; } acc += share; } }
    if (lean < 0) { const f = lumaRGB(col) / lumaRGB(olive); col = col.map((x, j) => lerp(x, olive[j] * f, -lean * 0.45)); }
    paintRGB(c, q.k % w, (q.k / w) | 0, col, q.direct);
  });
  paintRank(leaves.filter(q => !gapSet.has(q.k)), colors, flecks);
  paintRank(leaves.filter(q => gapSet.has(q.k)), gap, null);
  paintRank(info.filter(q => q.trunk), P.trunk, null);
  const body = quantize(c, ctx, 6, mix32(seed, 31));
  return { body, R, H: Math.round(P.height), W: Math.round(T.W) };
}

function byQuantile(table, v) { // table of [value, weight], ordered; v in 0..1 spreads values spatially
  let sum = 0; for (const [, w] of table) sum += w; let x = clamp(v, 0, 0.9999) * sum;
  for (const [i, w] of table) { x -= w; if (x < 0) return i; }
  return table[table.length - 1][0];
}
// ---- ground plants: tendrils from a bulb ------------------------------------------------------------------------------------
// Retail Red's Mars plants (MarsPlant01-08, 2x2): a few pale bulbs on the ground and `arms` tendrils that wander out `reach` px,
// curling (`curl`), thick at the bulb and thin at the tips, lying on the ground and shiny along their length. The same solid in the
// burnt ramp is the burnt plant (retail's MarsPlant..Crisp keeps the living plant's shape).
const TENDRIL_GOLD = ['#441000', '#671400', '#6b2709', '#684f1e', '#745b22', '#91772e', '#b39453', '#d1b979'];
const CHAR_RAMP = ['#0c0c0c', '#0e0f13', '#17130f', '#18140f', '#1f1f1f', '#1f1f1f', '#282727', '#343434'];   // retail MarsPlant..Crisp by luma octile
function tendrilSolid(P, r) {
  const arms = Math.round(clamp(P.arms ?? 7, 3, 12)), reach = P.reach ?? P.height * 1.2, thick = P.thick ?? 1.6, curl = clamp(P.curl ?? 0.6, 0, 1);
  const segs = [], bulbs = [];
  for (let i = 0; i < 2 + Math.floor(r() * 2); i++) bulbs.push([(r() - 0.5) * 7, (r() - 0.5) * 6, 3.6 + r() * 1.4, 3.8 + r() * 1.8]);
  for (let i = 0; i < arms; i++) {
    let ang = (i + 0.6 * (r() - 0.5)) / arms * TAU, x = (r() - 0.5) * 4, y = (r() - 0.5) * 4, z = 3, turn = (r() - 0.5) * 0.25;
    const len = reach * (0.55 + 0.6 * r()), steps = Math.max(4, Math.round(len / 3));
    for (let k = 0; k < steps; k++) {
      const t = k / steps, t1 = (k + 1) / steps, rad0 = thick * (1 - 0.72 * t), rad1 = thick * (1 - 0.72 * t1);
      turn = turn * 0.6 + (r() - 0.5) * 0.5 * curl; ang += turn + (r() - 0.5) * 0.7 * curl;      // kinks, but outward: the bend does not build up into loops
      const nx = x + Math.cos(ang) * 3, ny = y + Math.sin(ang) * 3 * 0.95, nz = rad1 + 0.3 + 1.2 * (1 - t1) * (1 - t1);
      segs.push([x, y, z, nx, ny, nz, rad0, rad1]); x = nx; y = ny; z = nz;
    }
  }
  // a coarse grid of the segments near each 8 px cell, so the distance is cheap to evaluate
  let e0 = 0, e1 = 0, s0 = 0, s1 = 0; for (const g of segs) { e0 = Math.min(e0, g[0], g[3]); e1 = Math.max(e1, g[0], g[3]); s0 = Math.min(s0, g[1], g[4]); s1 = Math.max(s1, g[1], g[4]); }
  const C = 8, pad = thick + 6, gx0 = Math.floor((e0 - pad) / C), gy0 = Math.floor((s0 - pad) / C), gw = Math.ceil((e1 + pad) / C) - gx0 + 1, gh = Math.ceil((s1 + pad) / C) - gy0 + 1, grid = Array.from({ length: gw * gh }, () => []);
  const reachOf = C * 0.71 + 4 + thick;
  segs.forEach((g, i) => { for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) { const cx = (gx + gx0 + 0.5) * C, cy = (gy + gy0 + 0.5) * C, ab = [g[3] - g[0], g[4] - g[1]], t = clamp(((cx - g[0]) * ab[0] + (cy - g[1]) * ab[1]) / (ab[0] ** 2 + ab[1] ** 2 || 1), 0, 1); if (Math.hypot(cx - g[0] - ab[0] * t, cy - g[1] - ab[1] * t) < reachOf) grid[gy * gw + gx].push(i); } });
  const F = (E, S, U) => {
    let f = 4;                                                       // a safe step where no segment is near
    for (const [x, y, z, rad] of bulbs) f = Math.min(f, Math.hypot(E - x, S - y, U - z) - rad);
    const gx = Math.floor(E / C) - gx0, gy = Math.floor(S / C) - gy0;
    if (gx >= 0 && gy >= 0 && gx < gw && gy < gh) for (const i of grid[gy * gw + gx]) {
      const [x0, y0, z0, x1, y1, z1, r0, r1] = segs[i], ab = [x1 - x0, y1 - y0, z1 - z0], ap = [E - x0, S - y0, U - z0], t = clamp((ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2), 0, 1);
      f = Math.min(f, Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t) - lerp(r0, r1, t));
    }
    return Math.max(f, -U);
  };
  return { F, ext: { e0: e0 - thick - 2, e1: e1 + thick + 2, s0: s0 - thick - 2, s1: s1 + thick + 2, u: 10 }, W: e1 - e0 };
}
function tendrilFrame(P, seed, ctx, burnt = false) {
  const L = lightOf(ctx), r = rng(seed), rn = rng(mix32(seed, 77)), sun = worldSun(L), T = tendrilSolid(P, r);
  const R = renderSolid({ F: T.F, eMin: T.ext.e0, eMax: T.ext.e1, sMin: T.ext.s0, sMax: T.ext.s1, uMax: T.ext.u, sun, shadowSun: flatSun(sun) }), view = [0, SE, CE], list = [];
  for (let k = 0; k < R.w * R.h; k++) {
    const p = R.px[k]; if (!p) continue;
    const n = p.n, nl = n[0] * sun[0] + n[1] * sun[1] + n[2] * sun[2], direct = Math.max(0, nl) * p.vis;
    const rf = [2 * nl * n[0] - sun[0], 2 * nl * n[1] - sun[1], 2 * nl * n[2] - sun[2]], spec = Math.pow(Math.max(0, rf[0] * view[0] + rf[1] * view[1] + rf[2] * view[2]), 9) * p.vis;
    list.push({ k, t: 0.5 * direct + 0.3 * Math.max(0, n[2]) + (burnt ? 0.2 : 0.8) * spec + (rn() - 0.5) * 0.08, direct });
  }
  const c = newCanvas(R.w, R.h, R.ox, R.oy), ramp = burnt ? CHAR_RAMP : (P.colors || TENDRIL_GOLD);
  list.sort((p, q) => p.t - q.t || p.k - q.k).forEach((q, i) => paintRGB(c, q.k % R.w, (q.k / R.w) | 0, rampAt(ramp, (i + 0.5) / list.length), q.direct));
  return { body: quantize(c, ctx, 5, mix32(seed, 32)), R, W: Math.round(T.W), H: R.h };
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
// colors: the shrub's ramp (retail Green's Shrub1-3 by luma octile); flecks: second hues among its light leaves (Archipelago's fronds)
const SHRUB_DEFAULTS = { width: 28, height: 19, density: 0.55, lean: 0, colors: ['#0f2700', '#0f2700', '#163705', '#2a6c18', '#3a8a25', '#43972b', '#459b2b', '#58b236'], flecks: [], energy: [20, 20] };
// Spec 15 B4: density 0.12 is the sparse Shrub3 (fill 0.17, about 24 small blobs); density 0.5 and up is the dense
// Shrub1/2 (fill 0.36-0.39, one mass holding 75% of the pixels). Texture is single-pixel speckle of 6-7 greens
// with the dark 173 as the under-leaf shade on every edge.
function shrubFrame(P, seed, ctx) {
  const r = rng(seed), rn = rng(mix32(seed, 6));
  const W = Math.round(P.width), H = Math.round(P.height), w = W + 6, h = H + 8, cx = w / 2, cy = (h - 6) / 2 + 1;
  const ax = Math.round(cx) + (r() < 0.5 ? 0 : -1), ay = h - 5;
  const sp = newSprite(w, h, ax, ay), occ = new Uint8Array(w * h), c = newCanvas(w, h, ax, ay), L = lightOf(ctx), fl = (P.flecks || []).map(([hex, share]) => [rampOf([hex])[0], share]);
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
      // ramp position: the underside dark, the lit top light (toward the sun's side a little lighter), speckled leaf by leaf
      const side = clamp(-((x - cx) * L.x + (y - cy) * L.y) / (W / 2), -1, 1) * 0.08;
      let u = under ? 0.04 + 0.4 * rn() : upper ? 0.6 + 0.4 * rn() * hi : 0.3 + 0.48 * rn();
      u = clamp(u + side, 0, 1);
      let col = rampAt(P.colors, u);
      if (u > 0.35 && fl.length) { let acc = 0; const v = rn(); for (const [rgb, share] of fl) { if (v >= acc && v < acc + share) { const f = lumaRGB(col) / Math.max(1, lumaRGB(rgb)); col = rgb.map(q => q * Math.min(1.2, f)); break; } acc += share; } }
      paintRGB(c, x, y, col, upper ? 0.8 : under ? 0.15 : 0.5);
    }
  }
  return { body: cropSprite(quantize(c, ctx, 4, mix32(seed, 8)), 0) };
}

// ---- solids: a small ray marcher in TA's view ---------------------------------------------------------------------------
// Rocks and plants are modelled as solids and drawn as TA's artists rendered theirs: an orthographic view from the south at the
// 63.4-degree elevation of TA's projection (level ground nearly 1:1 on screen, heights at half scale), lit by the map's own sun.
// World coordinates are (E, S, U) in pixels from the footprint's middle on the ground; the view is x east, y down the screen and z
// toward the viewer. A solid is a distance function F(E, S, U) (negative inside); the march finds the first surface along each
// pixel's ray, its normal, and whether the sun reaches it, and a second march lays the solid's shadow on level ground.
const CE = 0.8944, SE = 0.4472;
function vnoise3(x, y, z, s) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz), h = (a, b, c) => hash2(a + Math.imul(c, 7919), b - Math.imul(c, 104729), s);
  return lerp(lerp(lerp(h(ix, iy, iz), h(ix + 1, iy, iz), u), lerp(h(ix, iy + 1, iz), h(ix + 1, iy + 1, iz), u), v),
    lerp(lerp(h(ix, iy, iz + 1), h(ix + 1, iy, iz + 1), u), lerp(h(ix, iy + 1, iz + 1), h(ix + 1, iy + 1, iz + 1), u), v), w);
}
const softMax = (list, k) => { let m = -Infinity; for (const v of list) if (v > m) m = v; let s = 0; for (const v of list) s += Math.exp((v - m) / k); return m + k * Math.log(s); };
const smin = (a, b, k) => { const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1); return lerp(b, a, h) - k * h * (1 - h); };
// The world sun (E, S, U) from the view-space light (the view is a rotation of the world).
const worldSun = L => { const [x, y, z] = L.v; return [x, CE * y + SE * z, -SE * y + CE * z]; };
// The sun that lays shadows on the ground: TA draws heights at half scale, so shadows are shorter than the true sun casts
// (0.4 of it: retail's tree shadows reach about as far as the tree is tall on screen).
const flatSun = s => { const m = Math.hypot(s[0] * 0.4, s[1] * 0.4, s[2]) || 1; return [s[0] * 0.4 / m, s[1] * 0.4 / m, s[2] / m]; };
// S: {F, eMin, eMax, sMin, sMax, uMax, sun [E,S,U]}. Returns the picture's pixels with their surface point, normal and sun visibility,
// and the shadow on the ground as a soft mask; both in sprite coordinates with the world origin at (ox, oy).
function renderSolid(S) {
  const pad = 2, ox = Math.ceil(-S.eMin) + pad, oy = Math.ceil(-(CE * S.sMin - SE * S.uMax)) + pad;
  const w = Math.ceil(S.eMax - S.eMin) + pad * 2 + 1, h = Math.ceil(CE * (S.sMax - S.sMin) + SE * S.uMax) + pad * 2 + 1;
  const zMax = SE * S.sMax + CE * S.uMax + 1, zMin = SE * S.sMin - 1, F = S.F, out = new Array(w * h).fill(null);
  let sun = S.sun;
  const normal = (E, Sn, U) => { const e = 0.5, gx = F(E + e, Sn, U) - F(E - e, Sn, U), gy = F(E, Sn + e, U) - F(E, Sn - e, U), gz = F(E, Sn, U + e) - F(E, Sn, U - e), m = Math.hypot(gx, gy, gz) || 1; return [gx / m, gy / m, gz / m]; };
  // soft shadow toward the sun: 0 blocked .. 1 open; only near passes soften it (a far body's distance is a bound, not exact)
  const sunVis = (E, Sn, U, k = 6) => {
    let t = 1.2, vis = 1;
    for (let i = 0; i < 64 && t < 220; i++) { const d = F(E + sun[0] * t, Sn + sun[1] * t, U + sun[2] * t); if (d < 0.02) return 0; if (d < 4) vis = Math.min(vis, k * d / t); t += clamp(d, 0.6, 8); if (U + sun[2] * t > S.uMax + 2) break; }
    return clamp(vis, 0, 1);
  };
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    const x = px + 0.5 - ox, y = py + 0.5 - oy;
    let z = zMax;
    for (let i = 0; i < 200 && z > zMin; i++) {
      const E = x, Sn = CE * y + SE * z, U = -SE * y + CE * z, d = F(E, Sn, U);
      if (d < 0.04) { const n = normal(E, Sn, U); out[py * w + px] = { E, S: Sn, U, n, vis: sunVis(E + n[0] * 0.7, Sn + n[1] * 0.7, U + n[2] * 0.7) }; break; }
      z -= Math.max(d * 0.85, 0.06);
    }
  }
  // the shadow on level ground: ground points the sun does not reach, drawn where they fall on screen
  sun = S.shadowSun || S.sun;
  const reach = sun[2] > 0.05 ? S.uMax / sun[2] : 0, sE0 = Math.min(S.eMin, S.eMin - sun[0] * reach), sE1 = Math.max(S.eMax, S.eMax - sun[0] * reach), sS0 = Math.min(S.sMin, S.sMin - sun[1] * reach), sS1 = Math.max(S.sMax, S.sMax - sun[1] * reach);
  const sox = Math.ceil(-sE0) + pad, soy = Math.ceil(-CE * sS0) + pad, sw = Math.ceil(sE1 - sE0) + pad * 2 + 1, sh = Math.ceil(CE * (sS1 - sS0)) + pad * 2 + 1, shadow = new Float32Array(sw * sh);
  // on a 2 px grid (the shadow is a stipple), each cell's cover shared by its four pixels
  if (sun[2] > 0.05) for (let py = 0; py < sh; py += 2) for (let px = 0; px < sw; px += 2) {
    const E = px + 1 - sox, Sn = (py + 1 - soy) / CE, c = 1 - sunVis(E, Sn, 0.3, 12);
    for (let dy = 0; dy < 2 && py + dy < sh; dy++) for (let dx = 0; dx < 2 && px + dx < sw; dx++) shadow[(py + dy) * sw + px + dx] = c;
  }
  return { w, h, ox, oy, px: out, shadow: { w: sw, h: sh, ox: sox, oy: soy, cover: shadow } };
}
// The ground shadow as a sprite: solid where the sun is blocked, stippled in the penumbra; the body's anchor (ax, ay) in the
// shadow's own pixels so both place alike.
function shadowSprite(R, ax, ay, colors, r, most = 1) {   // most: the stipple's cover at the shadow's core (retail's tree shadows are an open dither)
  const s = R.shadow, sp = newSprite(s.w, s.h, ax - R.ox + s.ox, ay - R.oy + s.oy);
  for (let k = 0; k < s.w * s.h; k++) { const c = s.cover[k]; if (r() < clamp((c - 0.25) / 0.35, 0, 1) * most) { sp.a[k] = 1; sp.idx[k] = weighted(r, colors); } }
  return cropSprite(sp);
}

// ---- rocks -----------------------------------------------------------------------------------------------------
// One generator for every world's rocks (round 9, compared with retail Green, Red, Desert, Lava, Ice and Moon): a body, or a few
// (`pieces`, Desert's boulders), each a buried ellipsoid made blocky by `angular` (its tangent planes, their edges rounded: a softly
// faceted block; 1 is Ice's sharp shards), uneven by `lump`, drawn up into a spire by `tall` (Lava, Crystal), pocked by `pits`
// (Desert). Lit by the map's sun with sky light from above and shadowed by itself; colored by rank of tone along the world's ramp
// (`colors`, darkest first) so a rock keeps retail's share of highlight under any sun, `mottle` [[color, share], ...] soft second
// hues through the mid and light tones at the ramp's lightness, `grain` the fine dither of a rendered sprite. Retail Green's ramp and
// mottles are measured from its ten rocks (luma octiles; cream 30% and rose 22% of the light pixels).
export const ROCK_GREEN = ['#0f0f0f', '#2b2b2b', '#4b4b4b', '#5b5b5b', '#787878', '#949494', '#c3c3c3', '#f4f4f4'];
const ROCK_DEFAULTS = { cells: '2x2', size: 1, angular: 0.5, shade: 0.6, tall: 0, pieces: 1, pits: 0, grain: 0.6, lump: 0.6, colors: ROCK_GREEN, mottle: [['#c3c39b', 0.3], ['#d7a3b3', 0.26]], metal: null };   // shade: 0 soft .. 1 strong shading away from the sun (retail Green 0.6)
export const cellsOf = c => { const m = /^(\d+)x(\d+)$/.exec(String(c || '')); return m ? [clamp(+m[1], 1, 16), clamp(+m[2], 1, 16)] : [2, 2]; };
const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function rockSolid(P, r) {
  const [fw, fh] = cellsOf(P.cells), tall = clamp(P.tall, 0, 1), lump = clamp(P.lump, 0, 1), ang = clamp(P.angular, 0, 1);
  // the footprint's width and depth, and the height (screen rise is about half of it)
  let W, D;
  if (fw === 1 && fh === 1) { W = lerp(8, 21, clamp(P.size, 0, 1.4) / 1.4); D = W * (0.72 + 0.15 * r()); }
  else { W = fw * 16 * (0.86 + 0.12 * r()) * P.size; D = fh * 16 * (0.7 + 0.12 * r()) * P.size; }
  const hgt = W * (0.34 + 0.34 * r() + 2.1 * tall * tall);   // retail spires stand about 2.5 times their width (Lava, Crystal)
  const bodies = [{ e: 0, s: 0, a: W / 2, b: D / 2, hgt }];
  for (let i = 1; i < Math.round(clamp(P.pieces, 1, 8)); i++) {
    const sc = 0.3 + 0.32 * r(), th = r() * TAU;
    const far = 0.46 + 0.4 * r();   // some stones touch the main one, some lie apart (Desert's boulders)
    bodies.push({ e: Math.cos(th) * W * far, s: Math.sin(th) * D * far * 0.9 + D * 0.1, a: W / 2 * sc, b: D / 2 * sc * (0.85 + 0.3 * r()), hgt: hgt * sc * (0.8 + 0.4 * r()) });
  }
  for (const b of bodies) {
    b.s1 = (r() * 1e6) | 0; b.rot = r() * TAU; b.co = Math.cos(b.rot); b.si = Math.sin(b.rot);
    // a rounded box (superellipsoid): round at angular 0 (Desert's pebbles), a block with a flat top and steep sides at Green's
    // 0.5; its widest just above the ground, so the foot is a dark undercut
    b.p = 2 + 2.6 * ang; b.rz = b.hgt / (1.08 + 0.1 * r()); b.zc = b.hgt - b.rz;
    b.planes = [];
    if (ang > 0.2) {                                                 // facets: flat cuts across the block (sharp at 1: Ice's shards)
      const n = 2 + Math.round(7 * ang + 3 * r());
      for (let i = 0; i < n; i++) { const phi = r() * TAU, up = -0.2 + 1.6 * r(), v = [Math.cos(phi), Math.sin(phi), up], m = Math.hypot(...v), u = v.map(c => c / m);
        b.planes.push([...u, (Math.sqrt((b.a * u[0]) ** 2 + (b.b * u[1]) ** 2 + (b.rz * u[2]) ** 2) + b.zc * u[2]) * lerp(0.99, 0.8, clamp((ang - 0.3) / 0.7, 0, 1)) * (0.88 + 0.12 * r())]); }
    }
    b.k = lerp(1.2, 0.25, ang);
    b.amp = lump * Math.min(b.a, b.rz);
  }
  const bodyF = (b, E, S, U) => {
    const de = E - b.e, ds = S - b.s, qe = de * b.co - ds * b.si, qs = de * b.si + ds * b.co, qu = U;
    const p = b.p, hz = Math.pow(Math.pow(Math.abs(qe / b.a), p) + Math.pow(Math.abs(qs / b.b), p), 1 / p), vz = Math.abs((qu - b.zc) / b.rz);
    let f = (Math.pow(Math.pow(hz, p) + Math.pow(vz, p), 1 / p) - 1) * Math.min(b.a, b.b, b.rz) * 0.85;
    if (b.planes.length) f = Math.max(f, softMax(b.planes.map(q => q[0] * qe + q[1] * qs + q[2] * qu - q[3]), b.k));
    if (tall > 0) {     // a spire: a cone with vertical ridges, standing on a low mound
      const rho = Math.hypot(qe, qs * b.a / b.b), tU = clamp(qu / b.hgt, 0, 1), R = b.a * Math.pow(1 - tU, 0.9) * (0.62 + 0.38 * (1 - tU)), th = Math.atan2(qs, qe);
      const ridge = 1 + 0.16 * (vnoise(th * 2.2 + 9, qu / 14, b.s1 + 7) - 0.5) + 0.08 * (vnoise(th * 7, qu / 6, b.s1 + 8) - 0.5);
      const fc = Math.max((rho - R * ridge) * 0.75, qu - b.hgt);
      f = lerp(f, smin(fc, f + b.rz * 0.55, b.a * 0.25), smoothstep(0, 0.5, tall));
    }
    if (b.amp > 0) f += b.amp * (0.24 * (vnoise3(qe / (b.a * 0.7 + 2), qs / (b.a * 0.7 + 2), qu / (b.a * 0.7 + 2), b.s1 + 2) - 0.5) + 0.14 * (vnoise3(qe / (b.a * 0.3 + 2), qs / (b.a * 0.3 + 2), qu / (b.a * 0.3 + 2), b.s1) - 0.5) + 0.05 * (vnoise3(qe / 2.6, qs / 2.6, qu / 2.6, b.s1 + 1) - 0.5));
    return f;
  };
  // each body's bounding sphere: a far body costs one distance (a safe lower bound for the march), not its whole shape
  for (const b of bodies) { b.bc = b.hgt * 0.5; b.br = Math.hypot(Math.max(b.a, b.b) * 1.35, b.hgt * 0.62) + b.amp * 0.3 + 2; }
  const F = (E, S, U) => {
    let f = Infinity;
    for (const b of bodies) { const bound = Math.hypot(E - b.e, S - b.s, U - b.bc) - b.br; if (bound >= f) continue; f = bound > 4 ? Math.min(f, bound) : Math.min(f, bodyF(b, E, S, U)); }
    return Math.max(f, -U);
  };
  const ext = bodies.reduce((o, b) => ({ e0: Math.min(o.e0, b.e - b.a * 1.25), e1: Math.max(o.e1, b.e + b.a * 1.25), s0: Math.min(o.s0, b.s - b.b * 1.25), s1: Math.max(o.s1, b.s + b.b * 1.25), u: Math.max(o.u, b.hgt * 1.15) }), { e0: 0, e1: 0, s0: 0, s1: 0, u: 0 });
  return { F, W, D, hgt, ext, bodies };
}
function rockFrame(P, seed, ctx) {
  const L = lightOf(ctx), r = rng(seed), rn = rng(mix32(seed, 9)), sun = worldSun(L);
  const Sd = rockSolid(P, r), R = renderSolid({ F: Sd.F, eMin: Sd.ext.e0, eMax: Sd.ext.e1, sMin: Sd.ext.s0, sMax: Sd.ext.s1, uMax: Sd.ext.u, sun });
  const { w, h } = R, tone = new Float32Array(w * h), lit = new Float32Array(w * h), hasPx = [], mask = new Uint8Array(w * h);
  for (let k = 0; k < w * h; k++) if (R.px[k]) mask[k] = 1;
  const dist = edgeDist(w, h, mask);
  // the shade side, as a direction across the picture (for the Shading control and the no-highlight rule)
  const away = [-L.x, -L.y], span = (Sd.ext.e1 - Sd.ext.e0) * 0.35 + (CE * (Sd.ext.s1 - Sd.ext.s0) + SE * Sd.ext.u) * 0.35, mid = [R.ox, R.oy - SE * Sd.hgt * 0.4];
  for (let k = 0; k < w * h; k++) {
    const p = R.px[k]; if (!p) continue;
    const n = p.n, direct = Math.max(0, n[0] * sun[0] + n[1] * sun[1] + n[2] * sun[2]) * p.vis, sky = Math.max(0, n[2]);   // sky light falls on what faces up
    let t = 0.5 * direct + 0.5 * sky - 0.12 * smoothstep(0.5, 0, p.U / Math.max(1, Sd.hgt) * 4);    // a darker foot where the rock meets the ground
    const dd = ((k % w + 0.5 - mid[0]) * away[0] + (((k / w) | 0) + 0.5 - mid[1]) * away[1]) / span;
    t -= P.shade * 0.3 * Math.max(0, dd - 0.05);                                       // the far side falls off harder with the shading control
    if (dist[k] <= 1) t -= 0.05 + 0.1 * smoothstep(-0.2, 0.4, dd);                     // a soft dark rim, darkest on the shade side
    tone[k] = t; lit[k] = direct; hasPx.push(k);
  }
  // pits: small dark dents with a lit far rim
  if (P.pits > 0) {
    const n = Math.round(clamp(P.pits, 0, 1) * hasPx.length / 55);
    for (let i = 0; i < n; i++) {
      const k = hasPx[(r() * hasPx.length) | 0], x = k % w, y = (k / w) | 0, rad = 0.6 + r() * 1.1;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const q = (dx * dx + dy * dy) / (rad * rad), kk = (y + dy) * w + x + dx; if (x + dx < 0 || x + dx >= w || !R.px[kk]) continue;
        if (q < 1) tone[kk] -= 0.35 * (1 - q * 0.6); else if (q < 2.2 && dx * away[0] + dy * away[1] > 0) tone[kk] += 0.08;
      }
    }
  }
  // rank of tone -> ramp position; Shading bends the ramp (0.6 is retail Green's); the shade side never takes a highlight
  const ranked = hasPx.slice().sort((a, b) => tone[a] - tone[b] || a - b), N = ranked.length, gamma = Math.pow(2.4, (P.shade - 0.6) * 2.5);
  const s2 = (r() * 1e6) | 0, mot = (P.mottle || []).map(([hex, share], i) => ({ rgb: rampOf([hex])[0], share, seed: s2 + 11 * i + 3 }));
  const c = newCanvas(w, h, 0, 0);
  ranked.forEach((k, i) => {
    const x = k % w, y = (k / w) | 0, dd = ((x + 0.5 - mid[0]) * away[0] + (y + 0.5 - mid[1]) * away[1]) / span;
    let u = Math.pow((i + 0.5) / N, gamma);
    u = Math.min(u, lerp(1, 0.6, smoothstep(0.2, 0.45, dd)));
    let col = rampAt(P.colors, u);
    // second hues: each claims the areas where its own soft noise is highest, by its share, in the mid and light tones
    const on = smoothstep(0.22, 0.42, u) * (1 - smoothstep(0.95, 1, u));
    if (on > 0) {
      let best = null;
      // retail's are a per-pixel speckle (a noisy texture, rendered), leaning a little toward soft patches
      let acc = 0; const v = clamp(0.7 * hash2(x, y, s2 + 31) + 0.3 * fbm(x / 3.4, y / 3.4, s2 + 32, 2) + 0.15 * (fbm(x / 3.4, y / 3.4, s2 + 32, 2) - 0.5), 0, 0.9999);
      for (const m of mot) { if (v >= acc && v < acc + m.share) best = m; acc += m.share; }
      if (best) { const f = lumaRGB(col) / Math.max(1, lumaRGB(best.rgb)); col = col.map((c0, j) => lerp(c0, best.rgb[j] * f, on)); }
    }
    paintRGB(c, x, y, col, lit[k]);
  });
  const fu = 0.18 + 0.2 * r(), ax = Math.round(R.ox + (r() - 0.5) * 3), ay = Math.round(lerp(R.oy - SE * Sd.hgt - CE * Sd.D * 0.5 + fu * (CE * Sd.D + SE * Sd.hgt), R.oy, smoothstep(0, 0.6, P.tall)));
  c.ax = ax; c.ay = ay;
  const body = quantize(c, ctx, P.grain * 20, s2);
  return { body, R, W: Math.round(Sd.W), H: h };
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
      if (r() < dens * 1.1) put(ell, x, y, weighted(r, [[245, 58], [95, 32], [94, 10]]));
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
    const conifer = P.species === 'conifer', tendril = P.species === 'tendril';
    const T = tendril ? tendrilFrame(P, seed, ctx) : treeFrame(P, seed, ctx);
    body = cropSprite(T.body);
    shadow = tintSprite(shadowSprite(T.R, T.body.ax, T.body.ay, TREE_SHADOW_COLORS, rng(mix32(seed, 41)), 0.72), ctx, 0);   // the solid's own shadow, from the map's sun
    footprint = cellsOf(P.cells || '1x1');
    const bp = { species: P.species, height: Math.round(P.height * (conifer ? 0.88 : 0.78)), width: conifer ? 0.5 : 0.62, forks: 3, ash: 0.5 };
    if (!ctx.bodyOnly) {   // the view draws only body and shadow
      if (tendril) { const B = tendrilFrame(P, seed, ctx, true); burnt = { body: cropSprite(B.body), shadow: tintSprite(shadowSprite(B.R, B.body.ax, B.body.ay, TREE_SHADOW_COLORS, rng(mix32(seed, 42)), 0.72), ctx, 0), gameplay: { energy: 25, metal: 0, blocking: true, reclaimable: true, flamable: false } }; }
      else burnt = generateFeature('burnt', bp, mix32(seed, 6), ctx);
      burn = treeBurn(body, burnt.body, seed, conifer);
    }
    const sizeFrac = clamp((P.height - 55) / 17, 0, 1);
    gameplay = { energy: pickValue(P.energy, sizeFrac, rr), metal: 0, blocking: true, reclaimable: true, flamable: true, burnTicks: 192, spreadChance: conifer ? 30 : 90 };
  } else if (kind === 'burnt') {
    const B = burntFrame(P, seed, ctx);
    body = tintSprite(B.body, ctx, ctx.tint?.up ?? 0.7);
    shadow = tintSprite(makeShadow(body, { side: L.shadowSide, shx: 0.55, up: 0.6, colors: TREE_SHADOW_COLORS, soften: 0, grow: 0.15 }, rng(mix32(seed, 42))), ctx, 0);
    gameplay = { energy: pickValue(P.energy, undefined, rr), metal: 0, blocking: true, reclaimable: true, flamable: false };
  } else if (kind === 'shrub') {
    body = tintSprite(shrubFrame(P, seed, ctx).body, ctx, ctx.tint?.up ?? 0.7);
    if (!ctx.bodyOnly) burn = shrubBurn(body, seed);
    gameplay = { energy: pickValue(P.energy, undefined, rr), metal: 0, blocking: false, reclaimable: true, flamable: true, burnTicks: 84, spreadChance: 30 };
  } else if (kind === 'rock') {
    const R = rockFrame(P, seed, ctx);
    body = cropSprite(R.body);
    const [fw, fh] = cellsOf(P.cells);
    footprint = [fw, fh];
    shadow = tintSprite(shadowSprite(R.R, R.body.ax, R.body.ay, ROCK_SHADOW_COLORS, rng(mix32(seed, 43))), ctx, 0);   // the solid's own shadow on level ground, from the map's sun
    const cellsN = fw * fh, metalDefault = Math.round((7.6 * cellsN + 22.5) / 25) * 25;
    gameplay = { energy: 0, metal: P.metal ?? Math.max(25, Math.min(100, metalDefault)), metalLinear: Math.round(7.6 * cellsN + 22.5), hp: 2000, blocking: true, reclaimable: true };
  } else if (kind === 'scar') {
    const S = scarFrame(P, seed, ctx);
    body = tintSprite(S.body, ctx, ctx.tint?.up ?? 0.7); shadow = tintSprite(S.shadow || null, ctx, 0);
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
function groundMean(g, cx, cy, rad) {
  let r = 0, gg = 0, b = 0, n = 0;
  for (let y = Math.max(0, cy - rad); y < Math.min(g.h, cy + rad); y++) for (let x = Math.max(0, cx - rad); x < Math.min(g.w, cx + rad); x++) { const k = (y * g.w + x) * 4; r += g.rgba[k]; gg += g.rgba[k + 1]; b += g.rgba[k + 2]; n++; }
  return n ? [r / n, gg / n, b / n] : [70, 110, 40];
}
// A halo pixel: the ground already under it, its lightness scaled by `tone`, its hue `sat` times as strong, times a speckle `f`: the
// world's own ground and grain round a deposit, so it blends on any world.
function haloOf(base, tone, sat, f) { const L0 = lumaRGB(base); return base.map(v => clamp((L0 + (v - L0) * sat) * tone * f, 0, 255)); }
// The world's light colors on a painted color, as on open level ground (null when the light is white).
function groundLight(ctx) { const t = tintOf(ctx); if (!t) return null; const m = t(ctx.tint.up ?? 0.71); return c => [c[0] * m[0], c[1] * m[1], c[2] * m[2]]; }
function setGround(g, x, y, rgb) { if (x < 0 || y < 0 || x >= g.w || y >= g.h) return; const k = (y * g.w + x) * 4; g.rgba[k] = rgb[0]; g.rgba[k + 1] = rgb[1]; g.rgba[k + 2] = rgb[2]; g.rgba[k + 3] = 255; }
function getGround(g, x, y) { const k = (clamp(y, 0, g.h - 1) * g.w + clamp(x, 0, g.w - 1)) * 4; return [g.rgba[k], g.rgba[k + 1], g.rgba[k + 2]]; }

// halo: the lightness of the ground under the halo, scaled (retail, measured round the deposits of each world: Green 0.86, Red 0.9,
// Desert 0.7, Moon 0.62, Crystal 1, Archipelago lighter than its sand); haloSat how much richer its hue is than the ground's.
export const DEPOSIT_DEFAULTS = { metal: 127, style: 'retail', look: 'auto', halo: 0.82, haloSat: 1.1 };   // style 'retail' (angular plates) or 'pebbles' (round-1 round pebbles, an artist option); look 'auto' | 'cluster' | 'plates'
const STONE_CLASSES = [
  { w: 0.29, ramp: [[216, 3], [224, 3], [145, 4], [114, 5], [130, 2]] },        // pale: lilac-white, pink-lilac, pale blue
  { w: 0.22, ramp: [[115, 8], [131, 3], [147, 3], [217, 3], [148, 3], [87, 3]] }, // light and mid
  { w: 0.49, ramp: [[116, 17], [117, 5], [89, 9], [88, 8], [219, 4], [87, 2]] },  // steel blue and gray
];
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
  const palette = ctx.palette, q = paletteSearch(palette), lit = groundLight(ctx);
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
      setGround(ground, x, y, lit ? palette[q(...lit(palette[c]))] : palette[c]);
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
    const X = x + ox, Y = y + oy, h = haloOf(getGround(ground, X, Y), P.halo, P.haloSat, (rawD[k] <= 1.5 ? 0.78 : 1) * (0.72 + 0.5 * rn() * rn() + 0.12 * rn()));   // speckled, as retail's moss
    setGround(ground, X, Y, palette[q(h[0], h[1], h[2])]);
  }
  return { cx, cy, metal: P.metal, look, chunks: 4, stonePx: stonePts.length, dominant: areas[0] / total, rect: [ox, oy, bw, bh], gameplay: { metal: P.metal, indestructible: true, footprint: [3, 3] } };
}
// Round 1's round-pebble deposit, kept as an artist option (style 'pebbles').

function paintDepositPebbles(ground, cx, cy, params = {}, seed = 1, ctx = {}) {
  const P = { ...DEPOSIT_DEFAULTS, ...params }, palette = ctx.palette, q = paletteSearch(palette), L = lightOf(ctx), glit = groundLight(ctx);
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
      setGround(ground, X, Y, glit ? palette[q(...glit(palette[idx2]))] : palette[idx2]);
      continue;
    }
    const f = halo[k];
    if (f <= -0.02) continue;
    // moss: solid inside, feathered out to ~5 px
    if (f < 0.12 && rn() > f / 0.12 * 0.9 + 0.05) continue;
    const base = getGround(ground, X, Y);
    const rgb = haloOf(base, P.halo, P.haloSat, 0.85 + (rn() - 0.5) * 0.5 + (fbm(X / 3, Y / 3, s1 + 8, 2) - 0.5) * 0.4);
    setGround(ground, X, Y, palette[q(rgb[0], rgb[1], rgb[2])]);
  }
  return { cx, cy, metal: P.metal, chunks: chunks.length, rect: [ox, oy, bw, bh], gameplay: { metal: P.metal, indestructible: true, footprint: [3, 3] } };
}


export const VENT_DEFAULTS = { size: 1, forks: 3, rim: 0.72 };   // rim: the lightness of the ground round the crack, scaled
export function paintVent(ground, cx, cy, params = {}, seed = 1, ctx = {}) {
  const P = { ...VENT_DEFAULTS, ...params }, palette = ctx.palette, q = paletteSearch(palette), lit = groundLight(ctx);
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
      { const c = palette[weighted(rn, [[245, 30], [63, 25], [79, 15], [78, 12], [77, 8], [95, 10]])]; setGround(ground, X, Y, lit ? palette[q(...lit(c))] : c); }
      continue;
    }
    let d1 = 99;
    for (let dy = -2; dy <= 2 && d1 > 1; dy++) for (let dx = -2; dx <= 2; dx++) { const bx = x + dx, by = y + dy; if (bx >= 0 && by >= 0 && bx < bw && by < bh && core[by * bw + bx]) { d1 = Math.min(d1, Math.max(Math.abs(dx), Math.abs(dy))); } }
    if (d1 > 2) continue;
    const pr = d1 === 1 ? 0.72 : 0.3;
    if (rn() > pr) continue;
    const base = getGround(ground, X, Y);
    const h = haloOf(base, P.rim * (d1 === 1 ? 0.9 : 1), 1.15, 0.85 + 0.3 * rn());   // the scorched rim: the ground under it, darker
    setGround(ground, X, Y, palette[q(h[0], h[1], h[2])]);
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
