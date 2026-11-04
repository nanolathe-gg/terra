// ws-meander: rivers at TA's scale from a stroke, deformed at stroke time by curvature-driven migration.
//
// 1. The path. The stroke (here a gentle seeded sine across the window) is resampled at W/2 and migrated for N steps
//    by the Howard-Knutson (1984) model: the nominal rate R0 = W C (C the signed curvature), the migration rate
//    R1(s) = -R0(s) + 2.5 * (sum upstream of R0 weighted by exp(-(s - s') / (2W))), applied along the normal toward the
//    outer bank. The upstream lag makes bends grow and travel downstream. A light Laplacian keeps the line smooth, the
//    path is resampled every step, and a neck cutoff (two points farther apart than 6 samples along the river but
//    closer than 1.1 W) removes the loop and keeps it as an oxbow with its age. Plain JS doubles, a seeded integer
//    hash and a fixed step count, so the same stroke gives the same path; in the engine the stroke stores the seed and
//    the steps and its path is a pure function of them (no bake; decision 19).
//    Paris et al. 2023 (aparis69/Meandering-rivers, MIT, verified) and Sylvester's meanderpy follow the same model;
//    this is our own code from the published equations.
// 2. The channel, a pure function of the nearest point on the path (distance d, side, arc length s, curvature C):
//    - Asymmetric banks: the thalweg moves toward the outer bank with |C W|; the outer profile is steep (a cut bank,
//      exposed soil), the inner one gentle and continues above the water as a sand point bar.
//    - Riffles and pools: depth grows with |C| (pools in the bends, riffles at the crossings, where the surface roughens
//      and shows white flecks).
//    - Levees beside the channel; the floodplain a few units above the sea, valley walls beyond the meander belt.
//    - Scroll bars: ridge-and-swale on the inner side, between the drawn line and today's channel (the ground the bend
//      swept), parallel to the bank; wet swales are darker.
//    - Oxbows: shallower with age, so the old ones are wet meadow crescents and the young ones lakes with reeds.
// 3. Braided: the same stroke as a wide belt; threads where |noise(s, u)| is small (a network that splits and joins),
//    gravel bars between, the oldest bars grassed over.
// The water is ws-lib's model with its waves aligned to the flow (the current's streaks), and Murk for silt.
import {WS_WATER, WS_WATER_PARAMS} from './ws-lib.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function resample(pts, ds) {
  const out = [pts[0].slice()]; let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i]; const L = Math.hypot(bx - ax, by - ay);
    let t = ds - carry;
    while (t <= L) { out.push([ax + (bx - ax) * t / L, ay + (by - ay) * t / L]); t += ds; }
    carry = L - (t - ds);
  }
  const last = pts[pts.length - 1];
  if (Math.hypot(last[0] - out[out.length - 1][0], last[1] - out[out.length - 1][1]) > ds * 0.3) out.push(last.slice());
  else out[out.length - 1] = last.slice();
  return out;
}
function curvature(pts) {
  const n = pts.length, C = new Float64Array(n);
  for (let i = 1; i < n - 1; i++) {
    const dx = (pts[i + 1][0] - pts[i - 1][0]) / 2, dy = (pts[i + 1][1] - pts[i - 1][1]) / 2;
    const ddx = pts[i + 1][0] - 2 * pts[i][0] + pts[i - 1][0], ddy = pts[i + 1][1] - 2 * pts[i][1] + pts[i - 1][1];
    C[i] = (dx * ddy - dy * ddx) / Math.pow(dx * dx + dy * dy, 1.5);
  }
  for (let pass = 0; pass < 2; pass++) { const c = C.slice(); for (let i = 1; i < n - 1; i++) C[i] = 0.25 * c[i - 1] + 0.5 * c[i] + 0.25 * c[i + 1]; }
  return C;
}
// The stroke-time path deformation. Returns the drawn line, the migrated path and the oxbows.
export function meander({W = 18, seed = 5, steps = 265, x0 = -90, x1 = 730, y0 = 224, amp = 9, wave = 250, belt = 150, rate = 3, smooth = 0.05, lag = 2}) {
  const r = rng(seed), ds = W * 0.5, ph = r() * 6.283, ph2 = r() * 6.283, ph3 = r() * 6.283;
  let pts = [];
  for (let x = x0; x <= x1; x += ds) pts.push([x, y0 + amp * Math.sin(6.283 * x / wave + ph) + 0.4 * amp * Math.sin(6.283 * x / (wave * 0.53) + ph2) + 0.5 * amp * Math.sin(6.283 * x / (wave * 0.31) + ph3) + (r() - 0.5) * 2]);
  const drawn = pts.map(p => p.slice());
  const oxbows = [];
  const decay = Math.exp(-ds / (lag * W));
  for (let it = 0; it < steps; it++) {
    const n = pts.length, C = curvature(pts);
    let acc = 0, norm = 0; const next = pts.map(p => p.slice());
    for (let i = 0; i < n; i++) {
      const R0 = W * C[i];
      acc = acc * decay + R0 * ds; norm = norm * decay + ds;
      if (i < 3 || i > n - 4) continue;
      const R1 = -R0 + 2.5 * acc / norm;
      const tx = pts[i + 1][0] - pts[i - 1][0], ty = pts[i + 1][1] - pts[i - 1][1], tl = Math.hypot(tx, ty);
      let mx = (ty / tl) * R1 * rate, my = (-tx / tl) * R1 * rate;   // toward the outer bank (right of a left bend)
      const ml = Math.hypot(mx, my), cap = 0.35 * ds;
      if (ml > cap) { mx *= cap / ml; my *= cap / ml; }
      next[i][0] += mx; next[i][1] += my;
    }
    for (let i = 1; i < n - 1; i++) {   // a light Laplacian: bank stiffness, no kinks
      next[i][0] += smooth * (pts[i - 1][0] + pts[i + 1][0] - 2 * pts[i][0]);
      next[i][1] += smooth * (pts[i - 1][1] + pts[i + 1][1] - 2 * pts[i][1]);
    }
    for (const q of next) q[1] = Math.min(Math.max(q[1], y0 - belt), y0 + belt);   // the valley walls
    pts = resample(next, ds);
    // Neck cutoffs.
    for (let i = 0; i < pts.length; i++) {
      for (let j = pts.length - 1; j > i + 6; j--) {
        if (Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]) < 1.1 * W) {
          oxbows.push({pts: pts.slice(i + 1, j), step: it});
          pts = pts.slice(0, i + 1).concat(pts.slice(j));
          break;
        }
      }
    }
  }
  return {drawn, path: pts, oxbows, steps};
}

// Pack polylines into WGSL constants: points (x, y, s, C or age), and boxes for groups of 8 segments.
function pack(name, lines, ages, W) {
  const P = [], B = [];
  lines.forEach((pts, li) => {
    const C = curvature(pts); let s = 0; const base = P.length;
    pts.forEach((p, i) => { if (i) s += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]); P.push([p[0], p[1], ages ? ages[li] : s, C[i]]); });
    for (let i = 0; i < pts.length - 1; i += 8) {
      const seg = pts.slice(i, Math.min(i + 9, pts.length));
      const xs = seg.map(q => q[0]), ys = seg.map(q => q[1]);
      B.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), base + i, base + Math.min(i + 8, pts.length - 1)]);
    }
  });
  if (!P.length) { P.push([-1e5, -1e5, 0, 0], [-1e5 + 1, -1e5, 0, 0]); B.push([-1e5, -1e5, -1e5 + 1, -1e5, 0, 1]); }
  const f = v => (Number.isInteger(v) ? v.toFixed(1) : v.toPrecision(7));
  return `const ${name}N = ${B.length};
const ${name}P = array<vec4f, ${P.length}>(${P.map(p => `vec4f(${p.map(f).join(', ')})`).join(', ')});
const ${name}B = array<vec4f, ${B.length}>(${B.map(b => `vec4f(${b.slice(0, 4).map(f).join(', ')})`).join(', ')});
const ${name}I = array<vec2i, ${B.length}>(${B.map(b => `vec2i(${b[4]}, ${b[5]})`).join(', ')});
`;
}

const RIVER = meander({});
const W = 18;
const DATA = pack('MD', [RIVER.drawn], null, W) + pack('MP', [RIVER.path], null, W)
  + pack('MO', RIVER.oxbows.map(o => o.pts), RIVER.oxbows.map(o => 1 - o.step / RIVER.steps), W);

const MW = /* wgsl */`
const RW = ${W.toFixed(1)};
const Y0 = 224.0;
struct Near { d: f32, side: f32, s: f32, c: f32, y: f32, t: vec2f };
// The nearest point on a packed polyline set (branch and bound over the 8-segment boxes).
fn nearMD(p: vec2f, reach: f32) -> Near {
  var r: Near; r.d = reach; r.side = 1.0; r.s = 0.0; r.c = 0.0; r.y = p.y; r.t = vec2f(1.0, 0.0);
  for (var k = 0; k < MDN; k++) {
    let b = MDB[k]; if (length(p - clamp(p, b.xy, b.zw)) >= r.d) { continue; }
    let ii = MDI[k];
    for (var i = ii.x; i < ii.y; i++) {
      let a = MDP[i]; let e = MDP[i + 1]; let ab = e.xy - a.xy;
      let t = clamp(dot(p - a.xy, ab) / dot(ab, ab), 0.0, 1.0); let d = length(p - a.xy - ab * t);
      if (d < r.d) { r.d = d; r.side = select(-1.0, 1.0, ab.x * (p.y - a.y) - ab.y * (p.x - a.x) > 0.0); r.s = mix(a.z, e.z, t); r.c = mix(a.w, e.w, t); r.y = mix(a.y, e.y, t); r.t = normalize(ab); }
    }
  }
  return r;
}
fn nearMP(p: vec2f, reach: f32) -> Near {
  var r: Near; r.d = reach; r.side = 1.0; r.s = 0.0; r.c = 0.0; r.y = p.y; r.t = vec2f(1.0, 0.0);
  for (var k = 0; k < MPN; k++) {
    let b = MPB[k]; if (length(p - clamp(p, b.xy, b.zw)) >= r.d) { continue; }
    let ii = MPI[k];
    for (var i = ii.x; i < ii.y; i++) {
      let a = MPP[i]; let e = MPP[i + 1]; let ab = e.xy - a.xy;
      let t = clamp(dot(p - a.xy, ab) / dot(ab, ab), 0.0, 1.0); let d = length(p - a.xy - ab * t);
      if (d < r.d) { r.d = d; r.side = select(-1.0, 1.0, ab.x * (p.y - a.y) - ab.y * (p.x - a.x) > 0.0); r.s = mix(a.z, e.z, t); r.c = mix(a.w, e.w, t); r.y = mix(a.y, e.y, t); r.t = normalize(ab); }
    }
  }
  return r;
}
fn nearMO(p: vec2f, reach: f32) -> Near {
  var r: Near; r.d = reach; r.side = 1.0; r.s = 0.0; r.c = 0.0; r.y = p.y; r.t = vec2f(1.0, 0.0);
  for (var k = 0; k < MON; k++) {
    let b = MOB[k]; if (length(p - clamp(p, b.xy, b.zw)) >= r.d) { continue; }
    let ii = MOI[k];
    for (var i = ii.x; i < ii.y; i++) {
      let a = MOP[i]; let e = MOP[i + 1]; let ab = e.xy - a.xy;
      let t = clamp(dot(p - a.xy, ab) / dot(ab, ab), 0.0, 1.0); let d = length(p - a.xy - ab * t);
      if (d < r.d) { r.d = d; r.s = a.z; r.t = normalize(ab); }
    }
  }
  return r;
}
fn nearRiver(p: vec2f, reach: f32) -> Near { if (prm.mig > 0.5) { return nearMP(p, reach); } return nearMD(p, reach); }
// The drawn line's y at x (the stroke as drawn: before migration), by its own polyline.
fn drawnY(p: vec2f) -> f32 { return nearMD(p, 400.0).y; }

// (height, cut bank, sand, gravel) and the river's water depth below the sea in .y of a second return: see riverAt.
struct Riv { h: f32, cut: f32, sand: f32, gravel: f32, wet: f32, riffle: f32 };
fn floodplain(p: vec2f) -> f32 {
  let sea = seaLevel();
  let off = abs(p.y - Y0) - (175.0 + 25.0 * vnoise(vec2f(p.x / 90.0, 0.0), 0x91u));
  return sea + 3.0 + 0.5 * vnoise(p / 23.0, 0x92u) + 0.35 * max(off, 0.0) + 6.0 * sstep(0.0, 60.0, off) * vnoise(p / 40.0, 0x93u);
}
fn riverAt(p: vec2f) -> Riv {
  let sea = seaLevel();
  var o: Riv; o.h = floodplain(p); o.cut = 0.0; o.sand = 0.0; o.gravel = 0.0; o.wet = 0.0; o.riffle = 0.0;
  if (prm.braid > 0.5) {
    let r = nearMD(p, 200.0);
    let B = 2.6 * RW;   // half belt
    let u = r.side * r.d;
    if (r.d > B + 6.0) { return o; }
    let edge = sstep(B - 3.0, B + 3.0, r.d + 2.0 * vnoise(p / 9.0, 0x94u));
    let q = vec2f(r.s / 70.0, u / 15.0);
    let t = abs(gnoised(q, 0x95u).x + 0.45 * gnoised(q * vec2f(2.1, 1.7) + 3.3, 0x96u).x);
    let thread = 1.0 - sstep(0.17, 0.30, t);
    let veg = sstep(0.25, 0.45, vnoise(vec2f(r.s / 60.0, u / 24.0) + 9.0, 0x97u)) * sstep(0.2, 0.5, t);
    let bed = sea + 0.7 + 0.5 * vnoise(p / 5.0, 0x98u) + 1.3 * veg - thread * (0.9 + 3.0 * sstep(0.17, 0.0, t));
    o.h = mix(bed, o.h, edge);
    o.gravel = (1.0 - edge) * (1.0 - veg);
    o.riffle = (1.0 - edge) * thread * sstep(0.08, 0.17, t);
    return o;
  }
  let r = nearRiver(p, 160.0);
  let hw = 0.5 * RW;
  let k = clamp(r.c * RW * 1.4, -1.0, 1.0) * prm.asym;
  // v: across the channel, +1 at the inner bank, -1 at the outer (inner = the side the curvature centre is on).
  let sg = select(1.0, sign(k), abs(k) > 1e-4);
  let v = r.side * sg * r.d / hw;
  let ak = abs(k);
  let v0 = -0.55 * ak;
  var f = 0.0;
  if (v < v0) { f = 1.0 - pow(clamp((v0 - v) / (1.0 + v0), 0.0, 1.0), mix(2.0, 5.0, ak)); }
  else { f = 1.0 - pow(clamp((v - v0) / (1.0 - v0), 0.0, 1.0), mix(2.0, 1.25, ak)); }
  let D = 7.0 * mix(0.85, 0.5 + 0.75 * ak, prm.asym) * (1.0 + 0.15 * vnoise(vec2f(r.s / 30.0, 0.0), 0x99u));
  let lev = 1.4 * exp(-max(r.d - hw, 0.0) / (0.8 * RW)) * prm.asym;
  var fp = o.h + lev;
  // Scroll bars on the swept inner side.
  let inner = select(0.0, 1.0, v > 1.0);
  var dy = p.y + 1e4;
  if (prm.scroll > 0.5) { dy = drawnY(p); }
  let swept = select(0.0, 1.0, (p.y - dy) * (r.y - dy) > 0.0) * sstep(0.0, 8.0, abs(r.y - dy) - abs(p.y - dy));
  let sc = inner * swept * prm.scroll * sstep(hw, hw + 4.0, r.d);
  let ph = (r.d - hw) / 7.5 + 0.6 * vnoise(p / 26.0, 0x9au);
  let ridge = 0.5 + 0.5 * cos(TAU * ph);
  fp += sc * (0.7 * ridge - 0.5) * (1.0 - sstep(4.0 * RW, 7.0 * RW, r.d));
  o.wet = sc * (1.0 - ridge) * (1.0 - sstep(4.0 * RW, 7.0 * RW, r.d));
  // The point bar: the inner profile runs on above the water as sand, wider in tight bends.
  let barW = 0.2 + 1.6 * ak;
  let barT = clamp((v - 1.0) / barW, 0.0, 1.0);
  if (v > 1.0 && v < 1.0 + barW) {
    o.h = sea + 0.3 + (fp - sea - 0.3) * pow(barT, 2.0);
    o.sand = (1.0 - sstep(0.6, 1.0, barT)) * prm.asym;
  } else if (abs(v) <= 1.0) {
    o.h = sea + 0.25 - (D + 0.25) * f;
    o.riffle = (1.0 - sstep(0.15, 0.4, ak)) * prm.asym;
  } else {
    o.h = fp;
    // The cut bank: a steep scarp of bare soil on the outer side.
    o.cut = (1.0 - sstep(0.0, 3.0, -v * hw - hw)) * sstep(0.1, 0.4, ak) * select(0.0, 1.0, v < -1.0);
  }
  // Oxbows: younger ones deeper (lakes), older ones silted (wet meadows).
  if (prm.ox > 0.5) {
    let ob = nearMO(p, 2.0 * RW);
    if (ob.d < 1.4 * hw && r.d > hw + 3.0) {
      let age = ob.s;
      let od = (1.0 - pow(ob.d / (1.2 * hw), 2.0)) * mix(5.0, -0.6, age);
      let oh = sea + 0.3 - od;
      if (oh < o.h) { o.h = mix(o.h, oh, sstep(1.4 * hw, 1.1 * hw, ob.d)); o.wet = max(o.wet, sstep(1.4 * hw, 0.9 * hw, ob.d)); o.sand = 0.0; o.cut = 0.0; }
    }
  }
  return o;
}
fn heightAt(p: vec2f) -> f32 { return riverAt(p).h; }
fn matAt(p: vec2f, h: f32) -> vec4f { let o = riverAt(p); return vec4f(o.cut, o.gravel, o.sand, min(o.wet, 0.99) + 2.0 * floor(o.riffle * 7.99)); }
fn albedoAt(p: vec2f, h: f32, n: vec3f, m: vec4f) -> vec3f {
  if (prm.plain > 0.5) { return albedoDefault(p, h, n, vec4f(0.0)); }
  let grit = 0.07 * hs(i32(floor(p.x)), i32(floor(p.y)), 0x51edu) + 0.05 * vnoise(p / 5.0, 0x77u);
  let wet = fract(m.w * 0.5) * 2.0;
  var c = lab.cGrass.rgb * (1.0 + grit);
  c = mix(c, c * vec3f(0.78, 0.85, 0.78), wet * 0.6);
  c = mix(c, vec3f(0.42, 0.33, 0.22) * (1.0 + 1.5 * grit), m.x);
  c = mix(c, vec3f(0.47, 0.45, 0.40) * (1.0 + 2.0 * grit), m.y);
  c = mix(c, lab.cSand.rgb * (1.0 + grit), m.z);
  return c;
}
fn lightAt(p: vec2f, h: f32, n: vec3f, m: vec4f, x: i32, y: i32) -> vec3f {
  let sea = seaLevel();
  if (prm.plain > 0.5 || h >= sea) { return lightDefault(p, h, n, m, x, y); }
  let depth = sea - h;
  let riffle = floor(m.w * 0.5) / 7.0;
  var flow = 0.35;
  if (prm.braid > 0.5) { let r = nearMD(p, 200.0); flow = atan2(r.t.y, r.t.x); }
  else { let r = nearRiver(p, 60.0); flow = atan2(r.t.y, r.t.x); }
  let grit = 0.07 * hs(i32(floor(p.x)), i32(floor(p.y)), 0x51edu);
  let bed = mix(lab.cSand.rgb * 0.75, vec3f(0.45, 0.42, 0.36), 0.5) * (1.0 + grit);
  let w = wsWater(p, depth, bed, n, sunShadow(p, h, lab.sun.xyz), prm.clarity, prm.murk, prm.wind * (1.0 + 1.5 * riffle), prm.glint, prm.caustic, flow);
  var col = w.rgb;
  // Riffles: white flecks where the shallow crossing breaks the surface.
  let cell = vec2i(floor(p / max(labPx(), 1.0)));
  let fleck = select(0.0, 1.0, h01(cell.x, cell.y, 0x9bu) < 0.07 * riffle * (1.0 - sstep(1.0, 4.0, depth)) * sstep(0.0, 0.3, vnoise(p / 6.0, 0x9cu)));
  col = mix(col, srgbToLin(vec3f(0.85, 0.88, 0.86)) * wsFlatLight(p, sea), fleck);
  return col;
}
`;

export default {
  title: 'Meandering rivers',
  about: `A stroke migrated ${RIVER.steps} steps by Howard-Knutson (${RIVER.path.length} samples, ${RIVER.oxbows.length} cutoffs); asymmetric banks, pools, bars, scroll bars, oxbows; and a braided belt.`,
  world: 'green',
  lab: {sea: 40},
  colours: {water: [16, 50, 84], sand: [190, 174, 136], sky: [160, 182, 205]},
  params: {...WS_WATER_PARAMS, murk: 0.2, clarity: 10, wind: 0.3, glint: 0.5, caustic: 0.2, plain: 0, mig: 1, asym: 1, scroll: 0, ox: 0, braid: 0},
  variants: [
    {label: 'drawn', note: 'the stroke as drawn, symmetric channel, built-in water', params: {plain: 1, mig: 0, asym: 0}, colours: {water: [38, 76, 225]}},
    {label: 'meander', note: 'migrated; cut banks, point bars, pools and riffles', params: {}},
    {label: 'floodplain', note: '+ scroll bars, levees, oxbows', params: {scroll: 1, ox: 1}},
    {label: 'braided', note: 'threads in a gravel belt', params: {braid: 1, mig: 0, murk: 0.3}},
    {label: 'floodplain-2x', note: 'a bend at 2x', params: {scroll: 1, ox: 1}, lab: {px: 0.5, ox: 200, oy: 110}},
  ],
  wgsl: WS_WATER + DATA + MW,
};
