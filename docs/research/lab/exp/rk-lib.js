// Rock face detail (prefix rk-): the shared WGSL for the rk- experiments. One parametric rock model spans granite,
// sandstone, limestone, basalt, shale, schist, gneiss and conglomerate; each rock type is a preset of numbers
// (RK_PRESETS), never a branch. Weathering (age, stain, frost, lichen) and the lighting models (line-sweep horizons,
// sky visibility, multi-scale cavity, warm/cool, gloss) live here too, so each experiment is a list of variants.
// Original code. Ideas, all reimplemented from the published descriptions:
//   - block lattice cut by three parting sets (beds as horizontal planes, two vertical joint sets): structural
//     geology textbook picture; the engine's bedRelief/blockField do a 2D version.
//   - line-sweep horizons with a convex-hull stack: Timonen and Westerholm 2010, "Scalable height field
//     self-shadowing" (CGF 29(2)); Timonen 2013, "Line-sweep ambient obscurance" (CGF 32(4)). Ricky Reusser's
//     notebook (github.com/rreusser/notebooks, MIT, read for reference only) walks lines the same way.
//   - cosine-weighted slice visibility: Jimenez et al. 2016, "Practical realtime strategies for accurate indirect
//     occlusion" (GTAO), its closed-form slice integral.
//   - pair dithering with a mixing penalty: Yliluoma 2011, "Arbitrary-palette positional dithering algorithm".
// Opening this module as an experiment renders the bare scene (the cliff band) with the lab's default light.

// ---- the scene: a mesa band crossing the window from upper left to lower right, two cliff tiers and talus ----
export const RK_SCENE = /* wgsl */`
const RK_T = vec2f(0.9397, 0.3420);    // along the band, toward the lower right (20 degrees below east)
const RK_N = vec2f(-0.3420, 0.9397);   // across it: the upper face looks 65 degrees off the sun, the lower 115
const RK_O = vec2f(256.0, 196.0);
fn rkSp(x: f32, k: f32) -> f32 { return max(x, 0.0) + k * log(1.0 + exp(-abs(x) / k)); }
// The plateau's half width on each side (px), wandering into spurs and bays.
fn rkRim(s: f32, side: f32) -> f32 {
  let o = select(0.0, 40.0, side > 0.0);
  return 44.0 + 18.0 * vnoise(vec2f(s / 90.0 + o, 1.5), 0x3a1u) + 8.0 * vnoise(vec2f(s / 33.0 + o, 4.5), 0x5c2u)
       + 2.5 * vnoise(vec2f(s / 11.0 + o, 7.5), 0x2d9u);
}
// (s along the band, d across it, e out from the rim: negative on the plateau), px.
fn rkFrame(p: vec2f) -> vec3f {
  let q = p - RK_O; let s = dot(q, RK_T); let d = dot(q, RK_N);
  return vec3f(s, d, abs(d) - rkRim(s, sign(d)));
}
// Two cliff tiers: an upper cliff (2.6 units per px, 38 px), a bench (0.7, 16 px), a lower cliff (2.3, 30 px), a
// talus apron (0.55, 40 px) and the plain. The tier tops (228 and 118) are where the stains start (rkBelowLip).
fn rkProfile(e: f32) -> f32 {
  var h = 228.0;
  h -= 2.6 * rkSp(e, 1.2);
  h -= (0.7 - 2.6) * rkSp(e - 38.0, 2.0);
  h -= (2.3 - 0.7) * rkSp(e - 54.0, 2.0);
  h -= (0.55 - 2.3) * rkSp(e - 84.0, 3.0);
  h -= (0.0 - 0.55) * rkSp(e - 124.0, 8.0);
  return h;
}
fn rkBase(p: vec2f) -> f32 {
  let f = rkFrame(p);
  return rkProfile(f.z) + 2.2 * vnoise(p / 47.0, 0x611u) + 0.9 * vnoise(p / 19.0, 0x613u);
}
// Chutes and buttresses down the cliffs (round 1's gully filter, two octaves from 40 px), so a face has large forms.
fn rkChutes(p: vec2f, h0: f32, g: vec2f) -> f32 {
  let slope = length(g);
  if (slope < 0.3 || prm.chutes <= 0.0) { return h0; }
  return gullies(p, h0, g, slope * sstep(0.6, 1.6, slope), 40.0, prm.chutes, 2, 6.0, 0x1c5u);
}
// The base gradient (units per px), by central differences of the analytic base.
fn rkGrad(p: vec2f) -> vec2f {
  let e = 1.0;
  return vec2f(rkBase(p + vec2f(e, 0.0)) - rkBase(p - vec2f(e, 0.0)), rkBase(p + vec2f(0.0, e)) - rkBase(p - vec2f(0.0, e))) / (2.0 * e);
}
// Height below the nearest tier top above (units): where a stain has run from.
fn rkBelowLip(h: f32) -> f32 { return select(228.0 - h, 120.0 - h, h < 118.0); }
`;

// ---- the rock model --------------------------------------------------------------------------------------------
// Every rock type is these numbers (prm.*). Units: px across the ground, height units up.
export const RK_PARAMS = {
  jSize: 18, jAsp: 1.0, jJit: 0.9,       // joint cells: spacing (px), along:across aspect, jitter (0: hexagons)
  bed: 0, bedRag: 1.0, bedTerr: 0.0,     // beds: thickness (units, 0 massive), ragged boundary (units), tread flattening
  terr: 0.0, vary: 0.5,                  // flattening of each joint cell toward level (organ pipes), per-block tilt/step variety
  crev: 2.0, crevW: 1.2, open: 0.6, bedOpen: 0.25,   // crevice depth (units), half width (px), share of joints and of bed partings open
  chip: 0.4, chipSize: 5.0, grit: 0.35,  // angular chips (share, px) and per-pixel grit (units)
  incl: 0.0, inclSize: 6.0, inclFace: 0.0,   // inclusions: > 0 clasts proud, < 0 pits (to -1 honeycomb); share kept to faces
  flute: 0.0, fluteSpace: 5.0,           // karren flutes down the fall line: depth (units), spacing (px)
  lam: 0.0, lamDip: 0.0, lamX: 0.0, lamTone: 0.0, lamCut: 0.0,   // laminae: spacing (units), global dip, per-bed cross dip, tone, relief
  wave: 0.0, waveLen: 30.0,              // foliation waviness: amplitude (units), wavelength (px)
  bedTone: 0.3, grain: 0.06, speck: 0.0, // albedo: bed-to-bed mix toward colour B, per-pixel grain, dark/light speck share
  aR: 140, aG: 130, aB: 120, bR: 110, bG: 100, bB: 92,   // rock colours A and B (sRGB 0..255)
  // weathering: age (rounding, open joints, lichen and varnish growth), stain streaks, frost shattering
  age: 0.3, stain: 0.0, stainLen: 70.0, frost: 0.0, lichen: 0.0,
  sR: 48, sG: 34, sB: 26,                // stain colour (desert varnish by default)
  gloss: 0.0,                            // stain gloss (varnish), for the gloss light
  size: 1.0,                             // one scale for every px size above (the artist's Size)
  chutes: 0.22,                          // the scene's chutes (round 1's gully depth), not part of the rock model
  rockOn: 1,                             // 0 skips the rock model (for timing the scene alone)
};

// Rock-type presets: numbers only.
export const RK_PRESETS = {
  granite: {jSize: 30, jAsp: 1.15, jJit: 0.95, open: 0.5, bedOpen: 0.15, bed: 26, bedRag: 3.0, bedTerr: 0.3, wave: 9.0, waveLen: 45.0,
    terr: 0.12, vary: 0.7, crev: 2.4, crevW: 1.1, chip: 0.25, grit: 0.4, bedTone: 0.0, grain: 0.05, speck: 0.16,
    aR: 134, aG: 122, aB: 116, bR: 96, bG: 90, bB: 88, age: 0.75},
  sandstone: {jSize: 34, jAsp: 1.8, jJit: 0.8, open: 0.5, bedOpen: 0.2, bed: 11, bedRag: 1.2, bedTerr: 0.6, terr: 0.0, vary: 0.35, crev: 1.6, chip: 0.15, grit: 0.25,
    lam: 5.0, lamX: 1.3, lamTone: 0.22, lamCut: 0.5, incl: -0.55, inclSize: 4.5, inclFace: 1.0, bedTone: 0.55, grain: 0.04,
    aR: 172, aG: 118, aB: 84, bR: 200, bG: 168, bB: 128, age: 0.5},
  limestone: {jSize: 15, jAsp: 1.0, jJit: 0.7, open: 0.85, bedOpen: 0.3, bed: 14, bedRag: 0.8, bedTerr: 0.5, terr: 0.0, vary: 0.3, crev: 3.0, crevW: 1.3, chip: 0.2, grit: 0.3,
    flute: 2.6, fluteSpace: 4.5, incl: -0.25, inclSize: 5.0, bedTone: 0.25, grain: 0.05,
    aR: 150, aG: 148, aB: 140, bR: 116, bG: 114, bB: 110, age: 0.6},
  basalt: {jSize: 11, jAsp: 1.0, jJit: 0.18, open: 0.95, bed: 0, terr: 0.75, vary: 0.25, crev: 2.2, crevW: 0.9, chip: 0.35, chipSize: 4.0, grit: 0.3,
    bedTone: 0.0, grain: 0.07, speck: 0.03, aR: 70, aG: 68, aB: 68, bR: 54, bG: 52, bB: 56, age: 0.25},
  shale: {jSize: 9, jAsp: 2.2, jJit: 0.9, open: 0.5, bedOpen: 0.6, bed: 4.5, bedRag: 0.6, bedTerr: 0.35, terr: 0.0, vary: 0.7, crev: 1.2, crevW: 0.9, chip: 0.85, chipSize: 3.0, grit: 0.45,
    lam: 1.3, lamTone: 0.12, lamCut: 0.7, bedTone: 0.45, grain: 0.05, aR: 92, aG: 88, aB: 86, bR: 72, bG: 70, bB: 74, age: 0.2},
  schist: {jSize: 22, jAsp: 1.6, jJit: 0.9, open: 0.4, bed: 0, terr: 0.0, vary: 0.5, crev: 1.6, chip: 0.3, grit: 0.35,
    lam: 6.0, lamDip: 1.6, lamTone: 0.25, lamCut: 1.0, wave: 10.0, waveLen: 30.0, bedTone: 0.0, grain: 0.06, speck: 0.05,
    aR: 120, aG: 120, aB: 110, bR: 84, bG: 88, bB: 84, age: 0.35, gloss: 0.6},
  gneiss: {jSize: 28, jAsp: 1.3, jJit: 0.9, open: 0.4, bed: 0, terr: 0.05, vary: 0.45, crev: 2.0, chip: 0.25, grit: 0.35,
    lam: 7.0, lamDip: 1.4, lamTone: 0.55, lamCut: 0.6, wave: 12.0, waveLen: 38.0, bedTone: 0.0, grain: 0.05, speck: 0.12,
    aR: 164, aG: 156, aB: 148, bR: 66, bG: 64, bB: 66, age: 0.45},
  conglomerate: {jSize: 30, jAsp: 1.4, jJit: 0.9, open: 0.5, bed: 16, bedRag: 1.5, bedTerr: 0.3, terr: 0.0, vary: 0.4, crev: 2.0, chip: 0.15, grit: 0.3,
    incl: 0.75, inclSize: 5.5, bedTone: 0.3, grain: 0.05, aR: 128, aG: 108, aB: 88, bR: 104, bG: 92, bB: 80, age: 0.5},
};

export const RK_ROCK = /* wgsl */`
struct Rk { dh: f32, crev: f32, bedI: f32, bedF: f32, lamV: f32, cellH: f32, incl: f32, inclId: f32, fresh: f32, rock: f32, talus: f32 };
var<private> rkLast: Rk;

fn rkSize() -> f32 { return max(prm.size, 0.2); }
// Jittered lattice point of cell c (cell units); odd rows sit half a cell over, so jitter 0 is a hexagon lattice.
fn rkPt(c: vec2i, jit: f32, seed: u32) -> vec2f {
  let off = select(0.0, 0.5, (c.y & 1) == 1);
  return vec2f(f32(c.x) + 0.5 + off, f32(c.y) + 0.5) + (h2(c, seed) - 0.5) * jit;
}
// The two nearest points of a row-staggered jittered lattice of cells sz px (x, y), in px: nearest point, its cell,
// and the distance to the edge between the two nearest (exact for a bisector).
struct RkCell { c1: vec2f, id: vec2i, id2: vec2i, edge: f32, r1: f32 };
fn rkCells(x: vec2f, sz: vec2f, jit: f32, seed: u32) -> RkCell {
  let q = x / sz;
  let by = i32(floor(q.y));
  var d1 = 1e9; var d2 = 1e9; var p1 = vec2f(0.0); var p2 = vec2f(0.0); var id = vec2i(0); var id2 = vec2i(0);
  for (var j = -1; j <= 1; j++) {
    let row = by + j;
    let off = select(0.0, 0.5, (row & 1) == 1);
    let bx = i32(floor(q.x - off));
    for (var i = -1; i <= 1; i++) {
      let c = vec2i(bx + i, row);
      let pt = rkPt(c, jit, seed) * sz;
      let dd = dot(x - pt, x - pt);
      if (dd < d1) { d2 = d1; p2 = p1; id2 = id; d1 = dd; p1 = pt; id = c; } else if (dd < d2) { d2 = dd; p2 = pt; id2 = c; }
    }
  }
  var r: RkCell;
  r.c1 = p1; r.id = id; r.id2 = id2; r.r1 = sqrt(d1);
  let m = p2 - p1;
  r.edge = 0.5 * (d2 - d1) / max(length(m), 1e-4);
  return r;
}
fn rkTri(v: f32) -> f32 { return 1.0 - abs(fract(v) * 2.0 - 1.0); }

// The rock surface at p over the base height h0 with base gradient g. Returns the height offset and what the albedo
// needs. 'rock' is how much of the ground is bare rock (faces and plateau); 'talus' the debris apron.
fn rkRock(p: vec2f, h0: f32, g: vec2f) -> Rk {
  var o: Rk;
  let S = rkSize();
  let slope = length(g);
  let fall = select(vec2f(0.0, 1.0), -g / max(slope, 1e-5), slope > 1e-4);
  let fr = rkFrame(p);
  let x = vec2f(fr.x, fr.y);                 // the joint frame: fixed in the world, along and across the band
  let gx = vec2f(dot(g, RK_T), dot(g, RK_N)); // the gradient in that frame
  let age = clamp(prm.age, 0.0, 1.0);
  let frost = clamp(prm.frost, 0.0, 1.0);
  // Bare rock on faces steeper than about 1 and on the plateau; the bench keeps some; the talus is debris.
  let face = sstep(0.75, 1.3, slope);
  let top = 1.0 - sstep(-6.0, 2.0, fr.z);
  o.talus = sstep(78.0, 92.0, fr.z) * (1.0 - sstep(112.0, 132.0, fr.z));
  o.rock = max(max(face, top), 0.55 * (1.0 - o.talus) * sstep(0.35, 0.7, slope));

  // Beds: horizontal planes (a dip tilts them), ragged, with a fine wave for foliated rock.
  let waveOff = prm.wave * (vnoise(p / prm.waveLen, 0x7a1u) + 0.4 * vnoise(p / (prm.waveLen * 0.43), 0x7a3u));
  var bedI = 0.0; var bedF = 0.5; var bedEdge = 1e9; var bedPx = 1e9;
  if (prm.bed > 0.0) {
    let rag = prm.bedRag * (vnoise(p / 6.0, 0x1b1u) + 0.5 * vnoise(p / 2.7, 0x1b3u));
    let c = (h0 + rag + waveOff) / prm.bed;
    bedI = floor(c); bedF = c - bedI;
    bedPx = prm.bed / max(slope, 0.05);
    bedEdge = min(bedF, 1.0 - bedF) * bedPx;
  }
  o.bedI = bedI; o.bedF = bedF;
  // Joint cells, staggered bed by bed (each bed its own seed and offset).
  let bseed = 0x51a7u + u32(i32(bedI) + 4096) * 0x9e3779b9u;
  let jsz = vec2f(prm.jSize * sqrt(prm.jAsp), prm.jSize / sqrt(prm.jAsp) * select(1.0, 0.866, prm.jJit < 0.5)) * S;
  let cl = rkCells(x + vec2f(h1i(i32(bedI), 0x33u) * 97.0, 0.0), jsz, prm.jJit, bseed);
  let hc = h2(cl.id, bseed ^ 0x2545u);
  let hv = h2(cl.id, bseed ^ 0x6c8eu);
  o.cellH = hc.x;
  // A joint is open (a crevice) or tight (a seam: the step and tilt only), by a hash of the pair of cells it parts.
  let pairOpen = step(h01(cl.id.x + cl.id2.x, cl.id.y + cl.id2.y, bseed ^ 0x0e1u), prm.open + 0.3 * prm.age);
  let bedOpen = step(h1i(i32(bedI), 0x0e3u), prm.bedOpen + 0.2 * prm.age);
  var edge = min(select(1e9, cl.edge, pairOpen > 0.5), select(1e9, bedEdge, bedOpen > 0.5));
  var dh = 0.0;
  // Each joint cell flattened toward level about its own point (columns, stepped blocks), a tilt and a step of its own.
  let toPt = x - cl.c1;
  dh += -prm.terr * dot(gx, toPt);
  dh += prm.vary * (2.4 * (hc.y - 0.5) + 1.0 * dot(hv - 0.5, toPt));
  // Bed treads: each bed pulled toward its top, with a riser of a few px at its foot.
  if (prm.bed > 0.0) {
    let rr = clamp(2.5 * S / bedPx, 0.12, 1.0);
    dh += prm.bedTerr * prm.bed * (sstep(0.0, rr, bedF) - bedF) * (0.6 + 0.8 * h1i(i32(bedI), 0x77u));
  }
  // Frost: a fine angular fracture level, fresh faces, sharp edges. Age: rounded shoulders, opened joints.
  let roundR = age * (1.0 - 0.8 * frost) * 0.42 * min(min(jsz.x, jsz.y), bedPx * 1.0);
  if (roundR > 0.3) {
    let t = 1.0 - min(edge / roundR, 1.0);
    dh -= 1.1 * roundR * (1.0 - sqrt(max(1.0 - t * t, 0.0)));
  }
  var crev = 1.0 - sstep(0.0, prm.crevW * (1.0 + 0.6 * age + 0.5 * frost), edge + 0.6 * (vnoise(p / 2.1, 0x2c1u)));
  if (frost > 0.0) {
    let fc = rkCells(x * 1.0 + vec2f(13.0, 7.0), vec2f(4.5, 4.0) * S, 1.0, 0x7f3u ^ bseed);
    let fh = h2(fc.id, 0x7f5u ^ bseed);
    let fcrev = (1.0 - sstep(0.0, 0.8, fc.edge)) * step(1.0 - frost, fh.x * 0.6 + 0.4);
    crev = max(crev, fcrev * frost);
    dh += frost * 1.4 * (dot(fh - 0.5, x - fc.c1) * 0.5 + (fh.y - 0.5) * 1.5);
    o.fresh = frost * step(fh.y, 0.35 * frost) * (1.0 - fcrev);
  }
  dh -= prm.crev * crev;
  o.crev = crev;
  // Angular chips: small facets, worn away with age.
  let chipA = prm.chip * (1.0 - 0.7 * age) + 0.5 * frost;
  if (chipA > 0.01) {
    let ch = rkCells(x + vec2f(5.0, 3.0), vec2f(prm.chipSize * S, prm.chipSize * 0.8 * S), 1.0, 0x5e1u ^ bseed);
    let k = h2(ch.id, 0x5e3u);
    dh += chipA * (0.8 * dot(k - 0.5, x - ch.c1) + 0.9 * (k.y - 0.5));
    dh -= chipA * 0.5 * (1.0 - sstep(0.0, 0.7, ch.edge));
  }
  // Laminae: beds within beds (cross-beds dip per bed), foliation (a global dip and the wave).
  var lamV = 0.5;
  if (prm.lam > 0.0) {
    let ang = h1i(i32(bedI), 0x4d1u) * TAU;
    let ldir = vec2f(cos(ang), sin(ang));
    let ldip = prm.lamX * hs(i32(bedI), 3, 0x4d3u);
    let lc = (h0 + prm.lamDip * dot(p, RK_N) + ldip * dot(p, ldir) + waveOff) / prm.lam;
    lamV = fract(lc);
    let lg = length(g + prm.lamDip * RK_N + ldip * ldir);
    let lamPx = prm.lam / max(lg, 0.05);
    let show = sstep(1.6, 3.2, lamPx / labPx());
    dh -= prm.lamCut * show * (1.0 - sstep(0.0, 0.3, rkTri(lc + 0.5) * 0.5)) * (0.4 + 0.6 * age);
    lamV = mix(0.5, lamV, show);
  }
  o.lamV = lamV;
  // Karren flutes: sharp-crested runnels down the fall line, strongest at the top of a bed or face.
  if (prm.flute > 0.0) {
    let cs = stripes(p, fall, 1.0 / (prm.fluteSpace * S), 0x6a1u);
    let ph = acos(clamp(cs.x, -1.0, 1.0)) / PI;
    let atTop = select(1.0, 0.35 + 0.65 * bedF, prm.bed > 0.0);
    dh += prm.flute * (ph * ph - 0.33) * sstep(0.5, 1.1, slope) * atTop;
  }
  // Inclusions: clasts (incl > 0) as pebbles standing proud, pits (incl < 0) as cups merging into honeycomb.
  if (prm.incl != 0.0) {
    let ic = rkCells(x + vec2f(41.0, 29.0), vec2f(prm.inclSize * S), 1.0, 0x3d1u ^ bseed);
    let ih = h2(ic.id, 0x3d3u);
    let R = 0.5 * prm.inclSize * S;
    if (prm.incl > 0.0) {
      let rc = R * (0.5 + 0.55 * ih.x);
      let on = step(ih.y, prm.incl);
      let t = max(1.0 - (ic.r1 / rc) * (ic.r1 / rc), 0.0);
      dh += on * rc * (0.55 + 0.4 * age) * sqrt(t);
      o.incl = on * step(1e-4, t);
      o.inclId = ih.x;
    } else {
      let cov = -prm.incl;
      let patches = select(1.0, sstep(-0.15, 0.35, vnoise(p / 34.0, 0x3d5u) + 0.25 * (1.0 - bedF)), cov < 0.9);
      let rp = R * mix(0.45, 1.35, cov) * (0.7 + 0.5 * ih.x);
      let on = step(ih.y, min(cov * 1.6, 1.0)) * patches * mix(1.0, sstep(0.6, 1.2, slope), prm.inclFace);
      let t = max(1.0 - (ic.r1 / rp) * (ic.r1 / rp), 0.0);
      dh -= on * t * R * (0.5 + 0.6 * age) * sstep(0.0, 0.6, ic.edge + 0.3);
      o.incl = -on * t;
    }
  }
  dh += prm.grit * hs(i32(floor(p.x)), i32(floor(p.y)), 0x9a1u);
  o.dh = dh;
  return o;
}

// Debris on the talus apron: stones 2-7 px, more and coarser with frost.
fn rkTalus(p: vec2f, talus: f32) -> vec2f {
  if (talus <= 0.0) { return vec2f(0.0); }
  let c = rkCells(p, vec2f(5.5 * rkSize()), 1.0, 0x8b1u);
  let k = h2(c.id, 0x8b3u);
  let r = 2.8 * rkSize() * (0.45 + 0.6 * k.x) * (1.0 + 0.35 * prm.frost);
  let on = step(k.y, talus * (0.4 + 0.5 * prm.frost)) * step(0.15, talus);
  let t = max(1.0 - (c.r1 / r) * (c.r1 / r), 0.0);
  return vec2f(on * r * 0.8 * pow(t, 0.6 - 0.3 * prm.frost), on * step(1e-4, t));
}

fn heightAt(p: vec2f) -> f32 {
  let g = rkGrad(p);
  let h0 = rkChutes(p, rkBase(p), g);
  if (prm.rockOn < 0.5) { rkLast = Rk(); return h0; }
  var r = rkRock(p, h0, g);
  let st = rkTalus(p, r.talus);
  rkLast = r;
  return h0 + r.dh * r.rock + st.x + 0.35 * hs(i32(floor(p.x)), i32(floor(p.y)), 0x9a3u) * (1.0 - r.rock);
}
`;

// ---- weathering and albedo -------------------------------------------------------------------------------------
export const RK_ALBEDO = /* wgsl */`
fn rkC(r: f32, g: f32, b: f32) -> vec3f { return vec3f(r, g, b) / 255.0; }
// Streaks down the fall line from the tier tops: columns 3-9 px wide of a stain (desert varnish by default).
fn rkStain(p: vec2f, h: f32, g: vec2f) -> f32 {
  if (prm.stain <= 0.0) { return 0.0; }
  let slope = length(g);
  let fall = select(vec2f(0.0, 1.0), -g / max(slope, 1e-5), slope > 1e-4);
  // Two families of curtains (8 and 21 px apart), each streak's own length from a noise along it.
  let a = stripes(p, fall, 1.0 / (8.0 * rkSize()), 0x5a1u);
  let b = stripes(p + vec2f(37.0, 11.0), fall, 1.0 / (21.0 * rkSize()), 0x5a3u);
  let col = max(sstep(0.35, 0.8, a.x) * sstep(-0.6, 0.2, b.y), sstep(0.45, 0.85, b.x));
  let len = prm.stainLen * (0.3 + 1.2 * (vnoise(vec2f(dot(p, vec2f(-fall.y, fall.x)) / 6.0, h / 60.0), 0x5a5u) * 0.5 + 0.5));
  let below = max(rkBelowLip(h) - 3.0, 0.0);
  let run = exp(-below / len) * sstep(0.0, 4.0, rkBelowLip(h));
  return clamp(prm.stain * col * run * sstep(0.6, 1.4, slope) * 1.4, 0.0, 1.0);
}
// Lichen rosettes, 2-8 px, on faces that look at the sun and at the sky, more with age. Returns (cover, colour pick).
fn rkLichen(p: vec2f, n: vec3f, crev: f32) -> vec2f {
  let amt = prm.lichen * (0.4 + 0.6 * prm.age) * (1.0 - prm.frost * 0.7);
  if (amt <= 0.0) { return vec2f(0.0); }
  let c = rkCells(p, vec2f(8.0 * rkSize()), 1.0, 0x4c1u);
  let k = h2(c.id, 0x4c3u);
  let lit = sstep(0.25, 0.65, dot(n, normalize(lab.sun.xyz))) * sstep(0.35, 0.75, n.z);
  let r = 3.6 * rkSize() * (0.35 + 0.75 * k.x) * sqrt(amt) * (1.0 + 0.3 * hs(i32(floor(p.x)), i32(floor(p.y)), 0x4c5u));
  let on = step(k.y, amt * 1.2) * step(c.r1, r) * lit * (1.0 - crev);
  return vec2f(on, k.x);
}
fn rkLichenColour(k: f32) -> vec3f {
  if (k < 0.4) { return rkC(150.0, 158.0, 120.0); }   // grey-green (Parmelia)
  if (k < 0.7) { return rkC(196.0, 192.0, 168.0); }    // pale crust
  if (k < 0.9) { return rkC(178.0, 176.0, 72.0); }     // yellow-green (Rhizocarpon)
  return rkC(206.0, 118.0, 38.0);                       // orange (Xanthoria)
}

// The albedo of the rock (before lichen, which needs the lit normal): packed into M so the light pass only reads it.
fn rkAlbedoRock(p: vec2f, h: f32) -> vec4f {
  let r = rkLast;
  let g = rkGrad(p);
  let h0 = rkChutes(p, rkBase(p), g);
  let cA = rkC(prm.aR, prm.aG, prm.aB); let cB = rkC(prm.bR, prm.bG, prm.bB);
  var c = mix(cA, cB, prm.bedTone * h1i(i32(r.bedI), 0x2b1u));
  c = mix(c, cB, prm.lamTone * (rkTri(r.lamV) - 0.5) * 2.0 * select(1.0, -1.0, prm.lamTone < 0.0));
  // Per-pixel mineral grain: dark and light specks (granite's biotite and feldspar), and a fine grain.
  let px = vec2i(floor(p));
  let u = h01(px.x, px.y, 0xb11u);
  c *= 1.0 + prm.grain * hs(px.x, px.y, 0xb13u) + 0.05 * vnoise(p / 5.0, 0xb15u);
  if (u < prm.speck * 0.6) { c = mix(c, rkC(36.0, 34.0, 36.0), 0.75); }
  else if (u > 1.0 - prm.speck) { c = mix(c, rkC(232.0, 226.0, 216.0), 0.55); }
  // Clasts: pebbles of quartz, chert, the rock's own and a dark volcanic.
  if (r.incl > 0.0) {
    let k = r.inclId;
    var pc = mix(cA, vec3f(0.88, 0.85, 0.8), 0.55);
    if (k > 0.3) { pc = rkC(92.0, 84.0, 84.0); }
    if (k > 0.55) { pc = mix(cB, vec3f(0.6, 0.3, 0.2), 0.35); }
    if (k > 0.8) { pc = rkC(200.0, 190.0, 176.0); }
    c = pc * (1.0 + 0.08 * hs(px.x, px.y, 0xb17u));
  }
  if (r.incl < 0.0) { c *= 1.0 + 0.25 * r.incl; }
  c *= 1.0 - 0.12 * r.crev;
  // Weathering: varnish deepens with age everywhere a little, and in streaks from the lips; fresh frost scars are clean.
  let st = rkStain(p, h0, g);
  let fresh = r.fresh;
  let veneer = prm.age * 0.18 * select(0.0, 1.0, prm.stain > 0.0);
  c = mix(c, rkC(prm.sR, prm.sG, prm.sB), clamp(max(st, veneer) * (1.0 - fresh), 0.0, 1.0));
  c = mix(c, c * 1.18 + 0.04, fresh);
  // The ground: the plateau's soil in hollows, the talus and the plain.
  let soilTop = sstep(-0.1, 0.25, vnoise(p / 26.0, 0xc11u) + 0.15 * vnoise(p / 7.0, 0xc13u)) * (1.0 - sstep(-14.0, -2.0, rkFrame(p).z));
  let ground = lab.cGround.rgb * (1.0 + 0.07 * hs(px.x, px.y, 0xc15u) + 0.05 * vnoise(p / 6.0, 0xc17u));
  var a = mix(ground, c, r.rock * (1.0 - 0.85 * soilTop));
  // Talus stones in the rock's colours on a mixed matrix.
  if (r.talus > 0.0) {
    let st2 = rkTalus(p, r.talus);
    let k = h01(i32(floor(p.x / 5.5)), i32(floor(p.y / 5.5)), 0x8b5u);
    let stone = mix(cB, cA, k * k) * (0.85 + 0.06 * hs(px.x, px.y, 0x8b7u));
    a = mix(mix(a, mix(ground, cB, 0.45), r.talus * 0.6), stone, st2.y * 0.85);
  }
  // Gloss for the gloss light: varnish streaks and (schist) the foliation's mica, coded in .w with the rock share.
  let gl = clamp(prm.gloss * max(st, select(0.0, 0.7, prm.lam > 0.0 && prm.lamDip > 0.0)) * r.rock, 0.0, 0.99);
  return vec4f(a, floor(gl * 16.0) + clamp(r.rock * (1.0 - r.crev), 0.0, 0.99));
}
fn matAt(p: vec2f, h: f32) -> vec4f { if (prm.rockOn < 0.5) { return vec4f(lab.cGround.rgb, 0.0); } return rkAlbedoRock(p, h); }
fn rkGloss(m: vec4f) -> f32 { return floor(m.w) / 16.0; }
fn rkOpen(m: vec4f) -> f32 { return fract(m.w); }
fn albedoAt(p: vec2f, h: f32, n: vec3f, m: vec4f) -> vec3f {
  var c = m.rgb;
  let li = rkLichen(p, n, 1.0 - rkOpen(m));
  if (li.x > 0.0) { c = mix(c, rkLichenColour(li.y) * (1.0 + 0.06 * hs(i32(floor(p.x)), i32(floor(p.y)), 0x4c7u)), 0.9 * li.x); }
  return c;
}
`;

// A default export so the module also opens as an experiment: the bare cliff band under the lab's light.
export default {
  title: 'rk: the cliff band',
  lab: {exposure: 0.8},
  about: 'The scene every rk- experiment shares: a mesa band, two cliff tiers, a bench and talus aprons, with granite.',
  world: 'green',
  params: {...RK_PARAMS, ...RK_PRESETS.granite},
  variants: [{label: 'granite', params: {}}],
  wgsl: RK_SCENE + RK_ROCK + RK_ALBEDO,
};
