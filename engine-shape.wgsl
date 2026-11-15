// H6 (Green): shape on the GPU. Compute passes that evaluate Green's brushes (paint, erase, deep, shallow, mountain, hill, ground)
// over a rectangle of the map, beside the JS engine in sculpt.js. Every pass is one thread per cell; a thread reads and writes only
// its own cell of the field planes, so the planes are updated in place and no snapshot is needed. The hill's softening blur is the
// one neighbourhood step (two box blurs of radius 2 on the scratch weights, edge-clamped like the JS `blurred`).
//
// Arithmetic follows sculpt.js (`dab`, `settleHill`, `groundHeight`, `valueNoise`) line for line, in f32. The host (sculpt-gpu-fields.js)
// does the path preparation in JS (simplify, corner rounding, frames, boxes) and passes the capsule list, so the segments are
// bit-identical to the JS engine's. The marker below is replaced by the host with the uniform struct it fills.
//
// Planes: F holds h p r c v x u as seven f32 planes (u: the part of h the art does not show, see artLevel). Mk holds the 25 mask planes as int8, packed per cell (7 words a cell) so one thread
// owns every byte it writes. Nz is the node's noise tables (7 fields), Sc three scratch planes (weights, tmp, joined).
/*NODE_STRUCT*/

@group(0) @binding(0) var<uniform> u: Node;
@group(0) @binding(1) var<storage, read_write> F: array<f32>;
@group(0) @binding(2) var<storage, read_write> Mk: array<u32>;
@group(0) @binding(3) var<storage, read_write> Nz: array<f32>;
@group(0) @binding(4) var<storage, read_write> Sc: array<f32>;
@group(0) @binding(5) var<storage, read> Seg: array<vec4f>;
@group(0) @binding(6) var<storage, read> MW: array<vec4f>;
@group(0) @binding(7) var<storage, read_write> Out: array<u32>;

const PH = 0u; const PP = 1u; const PR = 2u; const PC = 3u; const PV = 4u; const PX = 5u; const PU = 6u;

// (wavelength 1, weight 1, wavelength 2, weight 2) and (salt 1, salt 2) of NOISE_FIELDS: x y detail coastX coastY coastWidth shelf.
var<private> NZ: array<vec4f, 7> = array<vec4f, 7>(
  vec4f(95.0, 0.7, 37.0, 0.3), vec4f(95.0, 0.7, 37.0, 0.3), vec4f(64.0, 0.65, 23.0, 0.35), vec4f(210.0, 0.65, 75.0, 0.35),
  vec4f(210.0, 0.65, 75.0, 0.35), vec4f(180.0, 0.65, 55.0, 0.35), vec4f(170.0, 0.75, 48.0, 0.25));
var<private> NS: array<vec2u, 7> = array<vec2u, 7>(
  vec2u(0x1863u, 0x32a7u), vec2u(0x73c1u, 0x9e15u), vec2u(0x5b39u, 0x2ac9u), vec2u(0x5e17u, 0x37abu),
  vec2u(0x84d1u, 0x192fu), vec2u(0x73b9u, 0x4f25u), vec2u(0x986du, 0x62f3u));

fn hashi(x: i32, y: i32, s: u32) -> f32 {
  var n = (bitcast<u32>(x) * 374761393u) ^ (bitcast<u32>(y) * 668265263u) ^ s;
  n = (n ^ (n >> 13u)) * 1274126177u;
  return f32(n ^ (n >> 16u)) / 4294967295.0 * 2.0 - 1.0;
}
fn sm(a: f32, b: f32, v: f32) -> f32 { let t = clamp((v - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
fn vnoise(x: f32, y: f32, s: u32) -> f32 {
  let fx = floor(x); let fy = floor(y);
  let ix = i32(fx); let iy = i32(fy);
  let tx = sm(0.0, 1.0, x - fx); let ty = sm(0.0, 1.0, y - fy);
  let a = hashi(ix, iy, s); let b = hashi(ix + 1, iy, s); let c = hashi(ix, iy + 1, s); let d = hashi(ix + 1, iy + 1, s);
  return (a + (b - a) * tx) * (1.0 - ty) + (c + (d - c) * tx) * ty;
}
fn noiseValue(f: u32, s: u32, x: f32, y: f32) -> f32 {
  let w = NZ[f]; let k = NS[f];
  return w.y * vnoise(x / w.x, y / w.x, s ^ k.x) + w.w * vnoise(x / w.z, y / w.z, s ^ k.y);
}

#ifdef PAGES
// H5b: the planes may be a page: a pw x ph block of the map whose first cell is (ox, oy) in the world lattice (a whole map: ox = oy = 0, pw = ph = grid, so
// every index below is the old y * grid + x). x, y stay world lattice coordinates; u.grid stays the whole map's size, which clamps and bounds the lattice.
fn lidx(x: i32, y: i32) -> u32 { return u32(y - u.oy) * u.pw + u32(x - u.ox); }
fn pcells() -> u32 { return u.pw * u.ph; }

// H5b (direct != 0): the node's noise at a lattice cell, evaluated where the table would have stored it (the `noise` pass's own arithmetic), so a page
// holds no tables: stamp reads them at the nearest point of each capsule, which is as far away as the node's extent.
fn noiseCell(f: u32, ix: i32, iy: i32) -> f32 {
    let n = u.grid;
    var px = f32(ix) * u.spacing; var py = f32(iy) * u.spacing;
    if (u.framed != 0u) {
        let lx = u.inv0 * px + u.inv2 * py + u.inv4; let ly = u.inv1 * px + u.inv3 * py + u.inv5;
        let gx = floor(lx / u.spacing + 0.5); let gy = floor(ly / u.spacing + 0.5);
        let inside = gx >= 0.0 && gy >= 0.0 && gx < f32(n) && gy < f32(n);
        px = select(lx, gx * u.spacing, inside); py = select(ly, gy * u.spacing, inside);
    }
    return noiseValue(f, u.seed, px, py);
}
fn nzCell(f: u32, x: i32, y: i32, i: u32, cells: u32) -> f32 {
  if (u.direct != 0u) { return noiseCell(f, x, y); }
  return Nz[f * cells + i];
}
fn nzAt(f: u32, ix: i32, iy: i32, cells: u32) -> f32 {
    if (u.direct != 0u) { return noiseCell(f, ix, iy); }
    return Nz[f * cells + u32(iy) * u.grid + u32(ix)];
}

#endif
// The node's noise tables over the rectangle: a framed node reads the world lattice through the inverse frame, quantised to the
// nearest cell (Math.round: half up) and evaluated directly off the map, as framedNoise does; an unframed one is the world field.
@compute @workgroup_size(8, 8)
fn noise(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
#ifdef PAGES
  let n = u.grid; let i = lidx(x, y);
#else
  let n = u.grid; let i = u32(y) * n + u32(x);
#endif
  var px = f32(x) * u.spacing; var py = f32(y) * u.spacing;
  if (u.framed != 0u) {
    let lx = u.inv0 * px + u.inv2 * py + u.inv4; let ly = u.inv1 * px + u.inv3 * py + u.inv5;
    let gx = floor(lx / u.spacing + 0.5); let gy = floor(ly / u.spacing + 0.5);
    let inside = gx >= 0.0 && gy >= 0.0 && gx < f32(n) && gy < f32(n);
    px = select(lx, gx * u.spacing, inside); py = select(ly, gy * u.spacing, inside);
  }
#ifdef PAGES
  let cells = pcells();
#else
  let cells = n * n;
#endif
  for (var f = 0u; f < 7u; f++) { Nz[f * cells + i] = noiseValue(f, u.seed, px, py); }
}

// sample() of the JS engine: a bilinear read of one noise table, clamped to the lattice.
fn sampleN(f: u32, x: f32, y: f32) -> f32 {
#ifdef PAGES
  let n = u.grid; let top = f32(n - 1u);
#else
  let n = u.grid; let cells = n * n; let top = f32(n - 1u);
#endif
  let gx = clamp(x / u.spacing, 0.0, top); let gy = clamp(y / u.spacing, 0.0, top);
  let ix = u32(floor(gx)); let iy = u32(floor(gy));
  let jx = min(ix + 1u, n - 1u); let jy = min(iy + 1u, n - 1u);
  let fx = gx - f32(ix); let fy = gy - f32(iy);
#ifdef PAGES
  let cells = n * n;   // the table's plane size (a whole map only; a page evaluates directly)
  let a = nzAt(f, i32(ix), i32(iy), cells); let b = nzAt(f, i32(jx), i32(iy), cells);
  let c = nzAt(f, i32(ix), i32(jy), cells); let d = nzAt(f, i32(jx), i32(jy), cells);
  return (a * (1.0 - fx) + b * fx) * (1.0 - fy) + (c * (1.0 - fx) + d * fx) * fy;
#else
  let o = f * cells;
  return (Nz[o + iy * n + ix] * (1.0 - fx) + Nz[o + iy * n + jx] * fx) * (1.0 - fy)
       + (Nz[o + jy * n + ix] * (1.0 - fx) + Nz[o + jy * n + jx] * fx) * fy;
#endif
}

fn maskGet(i: u32, p: u32) -> i32 {
  let w = Mk[i * 7u + (p >> 2u)]; var v = i32((w >> ((p & 3u) * 8u)) & 255u);
  if (v > 127) { v = v - 256; }
  return v;
}
fn maskSet(i: u32, p: u32, v: i32) {
  let at = i * 7u + (p >> 2u); let sh = (p & 3u) * 8u;
  let w = Mk[at];
  Mk[at] = (w & ~(255u << sh)) | ((bitcast<u32>(v) & 255u) << sh);
}

// H15 part 2: one curve. The host samples a stroke's curve (height share against distance share from the foot, 0..1) at CV_N + 3 even steps, one step
// before the foot to one past the top, into MW after the node's extra rows, four samples to a row. curveAt reads it with Catmull-Rom interpolation (linear
// steps put visible slope kinks into the lighting). `off` is u.curveBase or u.backBase, relative to the node's rows past its mask writes.
/*CV_N*/
fn cvAt(at: u32, k: u32) -> f32 { return MW[at + (k >> 2u)][k & 3u]; }
fn curveRaw(off: u32, t: f32) -> f32 {
  let at = u.mwBase + u.nwrites + off;
  let x = clamp(t, 0.0, 1.0) * CV_N; let k = min(u32(x), u32(CV_N) - 1u); let f = x - f32(k);
  let p0 = cvAt(at, k); let p1 = cvAt(at, k + 1u); let p2 = cvAt(at, k + 2u); let p3 = cvAt(at, k + 3u);
  return p1 + 0.5 * f * (p2 - p0 + f * (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3 + f * (3.0 * (p1 - p2) + p3 - p0)));
}
// A curve leaves 0..1 only when the host says it has a lip (u.cvLip): above 1 on land, below 0 on water; the excess is kept for the kind's lift.
fn keepLip(c: f32) -> f32 { return select(clamp(c, 0.0, 1.0), c, u.cvLip != 0u); }
fn curveAt(off: u32, t: f32) -> f32 { return keepLip(curveRaw(off, t)); }

// One thread per cell: every capsule of the node in order. Kinds: 0 paint, 1 erase, 4 a crater's spurs (the pieces of a hidden ridge stroke).
// H9 parametric cross-section, after H15 part 2: the curve is a host table (curveAt); what stays here is the terraces on the curve's value (terraced).
fn terraceLevel(m: u32, n: u32, nA: f32, nB: f32) -> f32 {
  let fm = f32(m); let fnn = f32(n);
  var j = 0.0;
  if (m > 0u && m < n) { j = u.sJit * 0.3 / fnn * (nA * cos(2.4 * fm + 1.0) + nB * sin(2.4 * fm + 1.0)); }
  return fm / fnn + j;
}
fn terrace(g: f32, n: u32, nj: f32, nA: f32, nB: f32) -> f32 {
  let fnn = f32(n);
  let a = clamp(u.sJit * nj, -0.22 * fnn, 0.22 * fnn);
  let q = g * fnn + a * 4.0 * g * (1.0 - g);
  let k = u32(max(0.0, min(floor(q), fnn - 1.0)));
  let lo = terraceLevel(k, n, nA, nB); let hi = terraceLevel(k + 1u, n, nA, nB);
  return lo + (hi - lo) * sm(u.sFlat, 1.0, q - f32(k));
}
// Terraces on the curve's value over the whole of 0..1; a lip's excess (outside 0..1) rides on top untouched.
fn terraced(c: f32, x: i32, y: i32, i: u32, cells: u32) -> f32 {
  if (u.sSteps == 0u) { return c; }
  let g = clamp(c, 0.0, 1.0);
  if (g <= 0.0 || g >= 1.0) { return c; }
  if (u.sBreak <= 0.0) { return terrace(g, u.sSteps, nzF(3u, x, y, i, cells), nzF(4u, x, y, i, cells), nzF(0u, x, y, i, cells)) + (c - g); }
  // H27 breakup: a stretch of the terraces keeps its shelf where a ticket (the shelf and detail noise, and a draw per tread) clears a bar that rises with
  // the breakup, so at full breakup most stretches lose their shelf and the short ledges that survive are where the ticket is high. The treads' heights are
  // untouched (the unterraced value is the curve), only whether the shelf stands at this place.
  let ticket = clamp(0.5 + 0.9 * (0.6 * nzF(6u, x, y, i, cells) + 0.4 * nzF(2u, x, y, i, cells)) + 0.3 * hashi(i32(floor(g * f32(u.sSteps))), 3, 0x5b7u), 0.0, 1.0);
  let bar = u.sBreak * 0.8;
  let intact = sm(bar - 0.12, bar + 0.12, ticket + 0.12);
  return mix(c, terrace(g, u.sSteps, nzF(3u, x, y, i, cells), nzF(4u, x, y, i, cells), nzF(0u, x, y, i, cells)) + (c - g), intact);
}
// How far a cell lies toward the side the stroke leans (0..1: the cosine between the stroke's bearing and the direction from the stroke to the cell, never
// below 0). The lean side is a map bearing (bearX, bearY) or, with leanSide, the left (+1) or right (-1) of the drawn direction (none on a point).
fn leanToward(ddx: f32, ddy: f32, sx: f32, sy: f32, span2: f32) -> f32 {
  var bx = u.bearX; var by = u.bearY;
  if (u.leanSide != 0.0) {
    if (span2 <= 0.0) { return 0.0; }
    let len = sqrt(span2); bx = u.leanSide * sy / len; by = -u.leanSide * sx / len;
  }
  return max(0.0, (ddx * bx + ddy * by) / max(1e-3, sqrt(ddx * ddx + ddy * ddy)));
}

// H9: a landform's or water stroke's mask writes, once the node is settled: plane, target, gain, flat per write (maskSetup/paintCell of sculpt.js).
fn shapeMasks(i: u32, f: f32, groundCut: bool) {
  for (var m = 0u; m < u.nwrites; m++) {
    let mw = MW[u.mwBase + m]; let pl = u32(mw.x); if (groundCut && pl == 21u) { continue; } let b = f32(maskGet(i, pl));
    var k = f * mw.z; if (mw.w != 0.0) { k = 1.0; }
    maskSet(i, pl, i32(floor(b + (mw.y - b) * k + 0.5)));
  }
}
// Scree is loose ground. Where the talus lies over the cell (k: 0 none .. 1 eight units deep or more) the rock detail goes and stones gather, through the two planes
// a Paint stroke writes for them (5: relief, toward weaker; 4: scatter, toward denser), so one field says where the rock skin stops and where the stones
// lie, and paint laid over the landform afterwards still has the last word.
// Rock presets (B2): the stroke's claim (its write to plane 20, sculpt-gpu-fields.js rockClaim) on the cells it shapes outside its own footprint, its
// talus and its shore fingers, so they are the stroke's rock.
fn claimRock(i: u32) {
  for (var m = 0u; m < u.nwrites; m++) { let mw = MW[u.mwBase + m]; if (u32(mw.x) == 20u || u32(mw.x) == 21u) { maskSet(i, u32(mw.x), i32(mw.y)); } }
}
fn talusGround(i: u32, k: f32) {
  if (k <= 0.0) { return; }
  let r = f32(maskGet(i, 5u)); maskSet(i, 5u, i32(floor(r + (-127.0 - r) * k + 0.5)));
  let d = f32(maskGet(i, 4u)); maskSet(i, 4u, i32(floor(d + (127.0 - d) * 0.6 * k + 0.5)));
}
fn nzF(f: u32, x: i32, y: i32, i: u32, cells: u32) -> f32 {
#ifdef PAGES
  return nzCell(f, x, y, i, cells);
#else
  return Nz[f * cells + i];
#endif
}

@compute @workgroup_size(8, 8)
fn stamp(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
#ifdef PAGES
  let n = u.grid; let cells = pcells(); let i = lidx(x, y);
#else
  let n = u.grid; let cells = n * n; let i = u32(y) * n + u32(x);
#endif
  let wx = f32(x) * u.spacing; let wy = f32(y) * u.spacing;
  var lx = wx; var ly = wy;
  if (u.framed != 0u) { lx = u.inv0 * wx + u.inv2 * wy + u.inv4; ly = u.inv1 * wx + u.inv3 * wy + u.inv5; }
  // Paint (kind 0) and erase (1): the coast noise fields.
  let kind = u.kind;
  let fxF = 3u; let fyF = 4u;
#ifdef PAGES
  let nzx = nzCell(fxF, x, y, i, cells); let nzy = nzCell(fyF, x, y, i, cells);
  let nCW = nzCell(5u, x, y, i, cells); let nDet = nzCell(2u, x, y, i, cells);
#else
  let nzx = Nz[fxF * cells + i]; let nzy = Nz[fyF * cells + i];
  let nCW = Nz[5u * cells + i]; let nDet = Nz[2u * cells + i];
#endif
  let radius = u.radius;
  var best = -1.0e30; var bc = 0.0; var visited = false;
  for (var k = 0u; k < u.nseg; k++) {
    let s0 = Seg[(u.segBase + k) * 4u]; let s1 = Seg[(u.segBase + k) * 4u + 1u]; let s2 = Seg[(u.segBase + k) * 4u + 2u];
    let bx = bitcast<vec4<i32>>(Seg[(u.segBase + k) * 4u + 3u]);
    if (x < bx.x || x > bx.z || y < bx.y || y > bx.w) { continue; }
    let px = s0.x; let py = s0.y;
    let sx = s0.z - px; let sy = s0.w - py;
    let span2 = sx * sx + sy * sy;
    var t = 0.0;
    if (span2 > 0.0) { t = clamp(((wx - px) * sx + (wy - py) * sy) / span2, 0.0, 1.0); }
    let cx = px + sx * t; let cy = py + sy * t;
    var ex = nzx; var ey = nzy;
    if (span2 > 0.0) { ex = nzx - sampleN(fxF, cx, cy); ey = nzy - sampleN(fyF, cx, cy); }
    else { ex = nzx - s2.x; ey = nzy - s2.y; }
    let dx = wx - cx + u.amp * (u.rotX * ex - u.rotY * ey);
    let dy = wy - cy + u.amp * (u.rotY * ex + u.rotX * ey);
    var width = 1.0;
    if (u.wK != 0.0) { width = clamp(1.0 + u.rough * u.wK * nCW, u.wLo, u.wHi); }
    let reach = radius * width;
    // Lean: the slope toward the lean side runs leanK of its length longer (shorter below 0): the brush's shoulder widens.
    var leaned = 1.0;
    if (u.leanK != 0.0) { let ln = leanToward(wx - cx, wy - cy, sx, sy, span2); leaned = 1.0 + u.leanK * ln * ln; }
    let r = sqrt(dx * dx + dy * dy) / reach;
    if (r >= 1.0) { continue; }
    // The curve's value c. Plateau-like edge: a broad-scale face-width variation, the north foreshortening term, then the shoulder.
    let broad = vnoise(lx / (radius * 1.3), ly / (radius * 1.3), u.seed ^ 0x5f1u);
    let shoulder0 = clamp(0.56 + u.rough * (nDet + 0.30 * nCW) + u.faceVar * 0.22 * broad, 0.18, 0.88);
    let shoulder = clamp(shoulder0 - (u.softness - 0.5) * 0.6 - 0.32 * (leaned - 1.0), 0.12, 0.90);
    var c = curveAt(u.curveBase, (1.0 - r) / (1.0 - shoulder));
    c = terraced(c, x, y, i, cells);
    if (c <= best || c == 0.0) { continue; }
    best = c; bc = c; visited = true;
  }
  if (!visited) { return; }
  let w = clamp(bc, 0.0, 1.0);
  let base = F[PH * cells + i];
  var value = base;
  let pbase = F[PP * cells + i];
  if (kind == 0u) {
    let f = w * u.amountPct;
    for (var m = 0u; m < u.nwrites; m++) {
      let mw = MW[u.mwBase + m]; let pl = u32(mw.x); let b = f32(maskGet(i, pl));
      // A preset ID is categorical: blending 2 toward 0 would paint slot 0.
      if(mw.w==1.0){if(f>0.0){maskSet(i,pl,i32(mw.y));}continue;}
      maskSet(i, pl, i32(floor(b + (mw.y - b) * f * mw.z + 0.5)));
    }
  } else {
    value = base + (u.baseH - base) * w;
    F[PC * cells + i] = F[PC * cells + i] * (1.0 - w);
    F[PV * cells + i] = F[PV * cells + i] * (1.0 - w);
    F[PX * cells + i] = F[PX * cells + i] * (1.0 - w);
    for (var m = 0u; m < u.nwrites; m++) {
      let mw = MW[u.mwBase + m]; let pl = u32(mw.x); let b = f32(maskGet(i, pl));
      if (mw.w == 2.0) { if (w >= 0.5) { maskSet(i, pl, i32(mw.y)); } continue; }   // all or nothing: the rock a cell belongs to (Erase)
      maskSet(i, pl, i32(floor(b + (mw.y - b) * w * mw.z + 0.5)));
    }
  }
  F[PH * cells + i] = clamp(value, u.minH, u.maxH);
  // Routes open where the height changed; protection follows the kind (a cover brush leaves it alone).
  if (kind != 0u && w > 0.0) { F[PR * cells + i] = F[PR * cells + i] * (1.0 - w); }
  if (kind != 0u) { F[PP * cells + i] = pbase * (1.0 - w); }
}

// The smooth brush's blur: a box of blurR cells either side (the host scales it with the spacing), clamped at the map edge, from scratch plane bsrc to bdst.
@compute @workgroup_size(8, 8)
fn blurH(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
#ifdef PAGES
  let n = u.grid; let cells = pcells(); let lo = max(0, u.ox); let hi = min(i32(n) - 1, u.ox + i32(u.pw) - 1);   // a page clamps at the map edge, or at its own edge (outside what its core reads)
#else
  let n = u.grid; let cells = n * n; let hi = i32(n) - 1;
#endif
  var sum = 0.0; let rr = i32(u.blurR);
#ifdef PAGES
  for (var k = -rr; k <= rr; k++) { sum = sum + Sc[u.bsrc * cells + lidx(clamp(x + k, lo, hi), y)]; }
  Sc[u.bdst * cells + lidx(x, y)] = sum / f32(2 * rr + 1);
#else
  for (var k = -rr; k <= rr; k++) { sum = sum + Sc[u.bsrc * cells + u32(y) * n + u32(clamp(x + k, 0, hi))]; }
  Sc[u.bdst * cells + u32(y) * n + u32(x)] = sum / f32(2 * rr + 1);
#endif
}
@compute @workgroup_size(8, 8)
fn blurV(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
#ifdef PAGES
  let n = u.grid; let cells = pcells(); let lo = max(0, u.oy); let hi = min(i32(n) - 1, u.oy + i32(u.ph) - 1);
#else
  let n = u.grid; let cells = n * n; let hi = i32(n) - 1;
#endif
  var sum = 0.0; let rr = i32(u.blurR);
#ifdef PAGES
  for (var k = -rr; k <= rr; k++) { sum = sum + Sc[u.bsrc * cells + lidx(x, clamp(y + k, lo, hi))]; }
  Sc[u.bdst * cells + lidx(x, y)] = sum / f32(2 * rr + 1);
#else
  for (var k = -rr; k <= rr; k++) { sum = sum + Sc[u.bsrc * cells + u32(clamp(y + k, 0, hi)) * n + u32(x)]; }
  Sc[u.bdst * cells + u32(y) * n + u32(x)] = sum / f32(2 * rr + 1);
#endif
}

// The ground node: broad undulation of dry ground (groundHeight). groundLifted: the same lift of a dry height h at cell (x, y) with protection pp, for
// artLevel (the pass keeps its own arithmetic, so its bytes stay as they were).
fn groundLifted(h: f32, pp: f32, x: i32, y: i32) -> f32 {
  let wx = f32(x) * u.spacing; let wy = f32(y) * u.spacing;
  let wave = u.gWave; let s = u.seed;
  let v = 0.6 * vnoise(wx / wave, wy / wave, s ^ 0x51a3u) + 0.3 * vnoise(wx * 2.1 / wave, wy * 2.1 / wave, s ^ 0x2b7du)
        + 0.1 * vnoise(wx * 4.3 / wave, wy * 4.3 / wave, s ^ 0x6c11u);
  let threshold = (0.5 - u.gCover) * 1.2;
  let blotch = sm(threshold - 0.15, threshold + 0.15, vnoise(wx / (wave * 3.2), wy / (wave * 3.2), s ^ 0x7f4bu));
  let next = h + u.gAmp * v * blotch * (1.0 - pp) * sm(u.sea + 1.0, u.sea + 8.0, h);
  return clamp(max(next, min(h, u.sea + 1.5)), u.minH, u.maxH);
}
@compute @workgroup_size(8, 8)
fn ground(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
#ifdef PAGES
  let cells = pcells(); let i = lidx(x, y);
#else
  let n = u.grid; let cells = n * n; let i = u32(y) * n + u32(x);
#endif
  let h = F[PH * cells + i];
  if (h <= u.sea + 1.0) { return; }
  let wx = f32(x) * u.spacing; let wy = f32(y) * u.spacing;
  let wave = u.gWave; let s = u.seed;
  let v = 0.6 * vnoise(wx / wave, wy / wave, s ^ 0x51a3u) + 0.3 * vnoise(wx * 2.1 / wave, wy * 2.1 / wave, s ^ 0x2b7du)
        + 0.1 * vnoise(wx * 4.3 / wave, wy * 4.3 / wave, s ^ 0x6c11u);
  let threshold = (0.5 - u.gCover) * 1.2;
  let blotch = sm(threshold - 0.15, threshold + 0.15, vnoise(wx / (wave * 3.2), wy / (wave * 3.2), s ^ 0x7f4bu));
  let next = h + u.gAmp * v * blotch * (1.0 - F[PP * cells + i]) * sm(u.sea + 1.0, u.sea + 8.0, h);
  F[PH * cells + i] = clamp(max(next, min(h, u.sea + 1.5)), u.minH, u.maxH);
}

// ---- A height image (a node of kind 'heights'; sculpt-gpu-fields.js heightsFields) ----
// Sample (i, j) of the image sits at world pixel (hmX + i * hmCell, hmY + j * hmCell). A cell reads the image at its own world position and nothing
// else, so the value is a function of position alone: a page, the whole map and a rectangle of either agree, and no cell needs a neighbor.
// The host holds this pass's window of samples in MW from u.mwBase: hmCw samples a row, the first of them sample (hmCx, hmCy). An index past the
// image's edge reads the edge sample.
fn hmSample(i: i32, j: i32) -> f32 {
  let k = u32(clamp(j, 0, i32(u.hmH) - 1) - u.hmCy) * u.hmCw + u32(clamp(i, 0, i32(u.hmW) - 1) - u.hmCx);
  return MW[u.mwBase + (k >> 2u)][k & 3u];
}
// The weights of the four samples round a place t (0..1) between the second and the third: a cubic through both with the slopes a Catmull-Rom spline
// has there (half the difference of the samples either side), except that within HM_COLLAR of a sample the surface is the straight line of that slope.
// The lattice of the fields is about 2 px and the export reads a 16 px corner as the bilinear mix of the four lattice cells round it; those cells all
// lie in a sample's collar (2.5 px at 16 px a sample), where the surface is linear in x and in y, so the mix is the sample itself. A plain Catmull-Rom
// curves there, and the mix misses a steep sample's byte by 1.
const HM_COLLAR = 0.15625;
const HM_REACH = 2.0;   // the cells past the image's outer samples that the surface covers (HEIGHTS_REACH in sculpt-gpu-fields.js)
fn hmWeights(t: f32) -> vec4f {
  if (t <= HM_COLLAR) { return vec4f(-0.5 * t, 1.0, 0.5 * t, 0.0); }
  if (t >= 1.0 - HM_COLLAR) { let s = t - 1.0; return vec4f(0.0, -0.5 * s, 1.0, 0.5 * s); }
  let span = 1.0 - 2.0 * HM_COLLAR; let q = (t - HM_COLLAR) / span; let q2 = q * q; let q3 = q2 * q;
  return (2.0 * q3 - 3.0 * q2 + 1.0) * vec4f(-0.5 * HM_COLLAR, 1.0, 0.5 * HM_COLLAR, 0.0) + (q3 - 2.0 * q2 + q) * span * vec4f(-0.5, 0.0, 0.5, 0.0)
       + (3.0 * q2 - 2.0 * q3) * vec4f(0.0, 0.5 * HM_COLLAR, 1.0, -0.5 * HM_COLLAR) + (q3 - q2) * span * vec4f(0.0, -0.5, 0.0, 0.5);
}
fn hmRow(i: i32, j: i32, w: vec4f) -> f32 { return w.x * hmSample(i - 1, j) + w.y * hmSample(i, j) + w.z * hmSample(i + 1, j) + w.w * hmSample(i + 2, j); }
// u.combine: 0 raise (the higher of the ground and the image), 1 cut (the lower), 2 flatten (the image, easing back into the ground across the margin
// round the samples, as a landform's section meets the ground at its foot), 3 replace (the image, margin and all).
@compute @workgroup_size(8, 8)
fn heights(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
#ifdef PAGES
  let cells = pcells(); let i = lidx(x, y);
#else
  let n = u.grid; let cells = n * n; let i = u32(y) * n + u32(x);
#endif
  // The cell's place in the image, in samples, and how far that is outside the samples.
  let su = (f32(x) * u.spacing - u.hmX) / u.hmCell; let sv = (f32(y) * u.spacing - u.hmY) / u.hmCell;
  let ex = max(max(-su, su - f32(u.hmW - 1u)), 0.0); let ey = max(max(-sv, sv - f32(u.hmH - 1u)), 0.0);
  if (ex > HM_REACH || ey > HM_REACH) { return; }
  let fu = floor(su); let fv = floor(sv); let si = i32(fu); let sj = i32(fv);
  let wx = hmWeights(su - fu); let wy = hmWeights(sv - fv);
  let v = wy.x * hmRow(si, sj - 1, wx) + wy.y * hmRow(si, sj, wx) + wy.z * hmRow(si, sj + 1, wx) + wy.w * hmRow(si, sj + 2, wx);
  let base = F[PH * cells + i];
  var value = v;
  if (u.combine == 0u) { value = max(base, v); }
  else if (u.combine == 1u) { value = min(base, v); }
  else if (u.combine == 2u) {
    // All of the image over the samples and their collars, none of it at the margin's edge.
    let keep = (1.0 - sm(HM_COLLAR, HM_REACH, ex)) * (1.0 - sm(HM_COLLAR, HM_REACH, ey));
    if (keep < 1.0) { value = base + (v - base) * keep; }
  }
  F[PH * cells + i] = clamp(value, u.minH, u.maxH);
}

// Back to the empty map over the rectangle: dry base height, nothing else.
@compute @workgroup_size(8, 8)
fn init(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
#ifdef PAGES
  let cells = pcells(); let i = lidx(x, y);
#else
  let n = u.grid; let cells = n * n; let i = u32(y) * n + u32(x);
#endif
  F[PH * cells + i] = u.baseH;
  for (var p = 1u; p < 6u; p++) { F[p * cells + i] = 0.0; }
  if (u.artKeep == 0u) { F[PU * cells + i] = 0.0; }   // (the second evaluation of a level-art run keeps the first one's height there)
  for (var w = 0u; w < 7u; w++) { Mk[i * 7u + w] = 0u; }
}

// Undulation in the art below 1: the host evaluates the node list twice, first without the ground node (artHold keeps that height in plane u), then
// whole; artLevel leaves in u the share of the ground's undulation the art does not show: (1 - gArt) times what the undulation adds to the height, where
// that is the ground node's own lift (the plain, a ground-relative shape). Where a later node changed it (a section's crest, a cut, a shoreline that moved
// with the ground, steps along it), the art keeps the game's height, fading over ART_KEEP height units, so the art's waterline is the game's. The draw
// subtracts u; the game heights keep h.
const ART_KEEP = 2.0;
@compute @workgroup_size(8, 8)
fn artHold(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
#ifdef PAGES
  let cells = pcells(); let i = lidx(x, y);
#else
  let n = u.grid; let cells = n * n; let i = u32(y) * n + u32(x);
#endif
  F[PU * cells + i] = F[PH * cells + i];
}
@compute @workgroup_size(8, 8)
fn artLevel(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
#ifdef PAGES
  let cells = pcells(); let i = lidx(x, y);
#else
  let n = u.grid; let cells = n * n; let i = u32(y) * n + u32(x);
#endif
  let d = F[PH * cells + i] - F[PU * cells + i];
  let lift = select(0.0, groundLifted(u.baseH, 0.0, x, y) - u.baseH, u.baseH > u.sea + 1.0);   // the ground node's own lift (it runs first, on the base height)
  let h = F[PH * cells + i];
  let part = (1.0 - clamp(u.gArt, 0.0, 1.0)) * (1.0 - sm(0.0, ART_KEEP, abs(d - lift))) * d;
  // No cell changes sides of the sea in the art: its waterline is the game's, cell for cell.
  F[PU * cells + i] = select(max(part, h - u.sea), min(part, max(h - u.sea - 0.25, 0.0)), h > u.sea);
}

// Pack the rectangle for readback: seven f32 planes, then 25 int8 mask planes, each plane contiguous and row-major in the rectangle.
// Thread j writes one word: an f32, or four consecutive cells of one mask plane.
@compute @workgroup_size(256)
fn pack(@builtin(global_invocation_id) g: vec3u, @builtin(num_workgroups) ng: vec3u) {
  let j = g.y * (ng.x * 256u) + g.x;
  let w = u32(u.rx1 - u.rx0 + 1); let h = u32(u.ry1 - u.ry0 + 1); let rc = w * h;
  let q = (rc + 3u) / 4u;
#ifdef PAGES
  let cells = pcells();
#else
  let n = u.grid; let cells = n * n;
#endif
  if (j < 7u * rc) {
    let pl = j / rc; let k = j % rc;
    let cx = u32(u.rx0) + k % w; let cy = u32(u.ry0) + k / w;
#ifdef PAGES
    Out[j] = bitcast<u32>(F[pl * cells + lidx(i32(cx), i32(cy))]);
#else
    Out[j] = bitcast<u32>(F[pl * cells + cy * n + cx]);
#endif
    return;
  }
  let m = j - 7u * rc;
  if (m >= 25u * q) { return; }
  let mp = m / q; let qq = m % q;
  var word = 0u;
  for (var b = 0u; b < 4u; b++) {
    let k = qq * 4u + b;
    if (k < rc) {
      let cx = u32(u.rx0) + k % w; let cy = u32(u.ry0) + k / w;
#ifdef PAGES
      word = word | ((bitcast<u32>(maskGet(lidx(i32(cx), i32(cy)), mp)) & 255u) << (b * 8u));
#else
      word = word | ((bitcast<u32>(maskGet(cy * n + cx, mp)) & 255u) << (b * 8u));
#endif
    }
  }
  Out[j] = word;
}

#ifdef PAGES
// H5b: the authored height at every `blurR`-th cell of the rectangle (the coarse lattice the overview reads): thread j is lattice point (j % w, j / w),
// w = (rx1 - rx0) / step + 1, at cell (rx0 + step * (j % w), ry0 + step * (j / w)).
@compute @workgroup_size(256)
fn coarse(@builtin(global_invocation_id) g: vec3u, @builtin(num_workgroups) ng: vec3u) {
  let j = g.y * (ng.x * 256u) + g.x;
  let step = u.blurR;
  let w = u32(u.rx1 - u.rx0) / step + 1u; let h = u32(u.ry1 - u.ry0) / step + 1u;
  if (j >= w * h) { return; }
  let cx = u.rx0 + i32((j % w) * step); let cy = u.ry0 + i32((j / w) * step);
  Out[j] = bitcast<u32>(F[PH * pcells() + lidx(cx, cy)]);
}

#endif
// ---- H6c: the remaining shapes. New entry points only; the entries above are untouched. ----
// Kinds: 9 sand, 10 grass, 11 smooth. Same capsule loop as `stamp` (the host passes the same segments); the rules for value, routes and cover follow
// dab() in sculpt.js.
@compute @workgroup_size(8, 8)
fn stampN(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
#ifdef PAGES
  let n = u.grid; let cells = pcells(); let i = lidx(x, y);
#else
  let n = u.grid; let cells = n * n; let i = u32(y) * n + u32(x);
#endif
  let wx = f32(x) * u.spacing; let wy = f32(y) * u.spacing;
  var lx = wx; var ly = wy;
  if (u.framed != 0u) { lx = u.inv0 * wx + u.inv2 * wy + u.inv4; ly = u.inv1 * wx + u.inv3 * wy + u.inv5; }
  let kind = u.kind;
  let natural = kind == 9u || kind == 10u;
  let fxF = select(0u, 3u, natural); let fyF = select(1u, 4u, natural);
#ifdef PAGES
  let nzx = nzCell(fxF, x, y, i, cells); let nzy = nzCell(fyF, x, y, i, cells);
  let nCW = nzCell(5u, x, y, i, cells); let nDet = nzCell(2u, x, y, i, cells);
#else
  let nzx = Nz[fxF * cells + i]; let nzy = Nz[fyF * cells + i];
  let nCW = Nz[5u * cells + i]; let nDet = Nz[2u * cells + i];
#endif
  let radius = u.radius;
  var best = 0.0; var visited = false;
  for (var k = 0u; k < u.nseg; k++) {
    let s0 = Seg[(u.segBase + k) * 4u]; let s2 = Seg[(u.segBase + k) * 4u + 2u];
    let bx = bitcast<vec4<i32>>(Seg[(u.segBase + k) * 4u + 3u]);
    if (x < bx.x || x > bx.z || y < bx.y || y > bx.w) { continue; }
    let px = s0.x; let py = s0.y;
    let sx = s0.z - px; let sy = s0.w - py;
    let span2 = sx * sx + sy * sy;
    var t = 0.0;
    if (span2 > 0.0) { t = clamp(((wx - px) * sx + (wy - py) * sy) / span2, 0.0, 1.0); }
    let cx = px + sx * t; let cy = py + sy * t;
    var ex = nzx; var ey = nzy;
    if (span2 > 0.0) { ex = nzx - sampleN(fxF, cx, cy); ey = nzy - sampleN(fyF, cx, cy); }
    else { ex = nzx - s2.x; ey = nzy - s2.y; }
    let dx = wx - cx + u.amp * (u.rotX * ex - u.rotY * ey);
    let dy = wy - cy + u.amp * (u.rotY * ex + u.rotX * ey);
    var width = 1.0;
    if (u.wK != 0.0) { width = clamp(1.0 + u.rough * u.wK * nCW, u.wLo, u.wHi); }
    var reach = radius * width;
    var leaned = 1.0;
    if (u.leanK != 0.0) { let ln = leanToward(wx - cx, wy - cy, sx, sy, span2); leaned = 1.0 + u.leanK * ln * ln; }
    if (!natural) { reach = reach * leaned; }
    let r = sqrt(dx * dx + dy * dy) / reach;
    if (r >= 1.0) { continue; }
    var c = 0.0;
    if (natural) {
      let broad = vnoise(lx / (radius * 1.3), ly / (radius * 1.3), u.seed ^ 0x5f1u);
      let shoulder0 = clamp(0.56 + u.rough * (nDet + 0.30 * nCW) + u.faceVar * 0.22 * broad, 0.18, 0.88);
      let shoulder = clamp(shoulder0 - (u.softness - 0.5) * 0.6 - 0.32 * (leaned - 1.0), 0.12, 0.90);
      c = curveAt(u.curveBase, (1.0 - r) / (1.0 - shoulder));
    } else {
      c = curveAt(u.curveBase, 1.0 - r);
    }
    c = terraced(c, x, y, i, cells);
    if (c <= best) { continue; }
    best = c; visited = true;
  }
  if (!visited) { return; }
  let w = clamp(best, 0.0, 1.0);
  let base = F[PH * cells + i];
  var value = base;
  if (kind == 9u || kind == 10u) {
    let tv = select(-1.0, 1.0, kind == 9u); let vb = F[PV * cells + i];
    F[PV * cells + i] = vb + (tv - vb) * w * u.amountPct;
  }
  else if (kind == 11u) { value = base + (Sc[2u * cells + i] - base) * w * u.amountPct; }
  F[PH * cells + i] = clamp(value, u.minH, u.maxH);
  if (kind != 11u && value != base) { F[PR * cells + i] = F[PR * cells + i] * (1.0 - w); }
}

// ---- H27 landform (decision 24): one path, a whole cross-section, a fixed elevation along it ----
// A landform sweeps its section (the front table, the back table, their half widths lfFront and lfBack) along a path. The path is the crest. A cell takes the
// segment nearest it (the first on a tie, as stampRamp), finds how far up the section it stands (q: 0 at the feet, 1 at the crest, a lip above), and reads the
// crest's height at its place along the path from the along table. The cell's value is base + (crest - base) * q, `base` being the height the strokes before
// it left, and combine keeps max(base, value) (raise to), min (cut to) or value (flatten to). Every read is the cell's own height and its position, so a
// regional replay of a window finds what the whole map did. A spur piece (s1.z < 0, its root's place along the trunk -1 - s1.z) is a candidate of its own, and so is
// an impact's landing (s1.x 1: the whole section at the path's end, the node's first segment; u.grooveEnd), which the trunk, the approach's groove, meets.
// Segment layout: s0 = a, b; s1 = (length before, length, the path's length | -1 - place, the back side: +1 left of the way drawn, -1 right);
// s2 = a trunk's end flags (1 start, 2 end: the section closes round it) | a spur piece's (width, width, height, height) at its ends.
fn lfFractal(x: f32, y: f32, salt: u32) -> f32 {
  return 0.57 * vnoise(x, y, u.seed ^ salt) + 0.29 * vnoise(x * 2.17 + 19.1, y * 2.17 - 7.3, u.seed ^ (salt + 0x65u)) + 0.14 * vnoise(x * 5.03 - 11.7, y * 5.03 + 31.2, u.seed ^ (salt + 0xd1u));
}
// The variation's weight at a place on the section: the foot's at the foot, blending to the middle's by halfway up and holding it to the crest.
fn lfWeight(q: f32) -> f32 {
  let g = clamp(q, 0.0, 1.0);
  return mix(u.lfFoot, u.lfMid, min(g * 2.0, 1.0));
}
// The share of the section at a signed distance c across the path (positive: left of the way drawn) and e beyond the path's end. Past a free end the section
// closes round it: the distance is radial and the two halves are blended by which way the cell lies, so an asymmetric section meets itself with no seam.
fn lfShare(c: f32, e: f32, cap: bool, side: f32, wm: f32) -> f32 {
  let back = c * side;
  let fw = max(u.lfFront * wm, 0.5); let bw = max(u.lfBack * wm, 0.5);
  let r = sqrt(c * c + e * e);
  if (cap && e > 0.0) {
    var qf = 0.0; var qb = 0.0;
    if (r < fw) { qf = curveAt(u.curveBase, 1.0 - r / fw); }
    if (r < bw) { qb = curveAt(u.backBase, 1.0 - r / bw); }
    return mix(qf, qb, 0.5 + 0.5 * back / r);
  }
  if (back > 0.0) { if (r >= bw) { return 0.0; } return curveAt(u.backBase, 1.0 - r / bw); }
  if (r >= fw) { return 0.0; }
  return curveAt(u.curveBase, 1.0 - r / fw);
}
// P28 river: the channel cut into a valley's floodplain (the valley is the section curve; this is the part that needs the path's bend). c is the signed distance
// across the path, e beyond its end (the channel closes round it); kw the path's curvature times the channel width u.lfRiver, positive when the bend's centre is
// on the c > 0 side; silt the oxbow's remaining depth (1 the river). v runs across the channel, +1 at the inner bank, -1 at the outer. The deepest line sits toward
// the outer bank by .55 of a bend's tightness, under a steep cut bank; the inner side runs on above the water as a gentle point bar; depth grows with the bend
// (pools in bends, riffles in the crossings); a levee rims the channel (scroll bars across the point bar are below). Port of docs/research/lab/exp/ws-meander.js riverAt
// (the research branch), with the banks as smooth runs and the depth scaled by the width.
fn riverChannel(fl: f32, qq: f32, c: f32, e: f32, kw: f32, silt: f32, wx: f32, wy: f32) -> vec2f {
  let W = u.lfRiver; let hw = 0.5 * W;
  let k = clamp(1.4 * kw, -1.0, 1.0); let ak = abs(k);
  let sg = select(1.0, sign(k), ak > 1e-4);
  let d = sqrt(c * c + e * e);
  let v = select(-1.0, 1.0, c >= 0.0) * sg * d / hw;
  let v0 = -0.55 * ak;
  var f = 0.0;
  if (v < v0) { f = 1.0 - pow(clamp((v0 - v) / (1.0 + v0), 0.0, 1.0), mix(2.0, 5.0, ak)); }
  else { f = 1.0 - pow(clamp((v - v0) / (1.0 - v0), 0.0, 1.0), mix(2.0, 1.25, ak)); }
  let sea = u.sea;
  // Channel depth (lfRiverDepth): the channel's depth as a multiple of a quarter of its width (1: as before), so a narrow river can run deep.
  let depth = 0.25 * W * u.lfRiverDepth * (0.5 + 0.75 * ak) * (1.0 + 0.15 * vnoise(wx / 30.0, wy / 30.0, u.seed ^ 0x99u)) * silt;
  let lev = 0.07 * W * exp(-max(d - hw, 0.0) / (0.8 * W)) * qq * qq * silt;
  let fp = fl + lev;
  // The point bar: on the inner side of a bend (v > 1), as wide as the bend is tight and the channel wide (0.65 + 1.3 x the tightness, in channel widths),
  // widest at the apex and narrow in the crossings, where it changes banks. s is the distance in px from the channel's inner edge. Its surface climbs gently
  // from the water, with scroll bars (low ridges where the channel stood) across it, and rises to the floodplain at its outer edge; the second result is the
  // share of sand laid on it, which goes to the cover plane and draws through the painted sand.
  let top = max(fp, sea + 0.4);
  let s = (v - 1.0) * hw;
  let barBase = mix(0.1 * W, W * (0.65 + 1.3 * ak), sm(0.0, 0.2, ak));
  var h = 1.0e9;
  var sand = 0.0;
  if (v >= -1.0 && v <= 1.0) { h = sea + 0.25 - (depth + 0.25) * f; }
  else if (v < -1.0) { h = sea + 0.25 + (top - sea - 0.25) * sm(0.0, 1.0, (-1.0 - v) * hw / mix(7.0, 3.5, ak)); }
  else if (s >= 1.85 * barBase) { h = sea + 1.1 + max(top - sea - 1.1, 0.0); }   // past the bar (and its noise): the floodplain, with no noise to read
  else {
    let barPx = barBase * (1.0 + 0.3 * vnoise(wx / 41.0, wy / 41.0, u.seed ^ 0x9bu));
    let ub = s / barPx;
    let t = min(ub, 1.0);
    let phase = s / (0.9 * W) + 0.7 * vnoise(wx / 53.0, wy / 53.0, u.seed ^ 0x9cu);
    let scroll = pow(0.5 + 0.5 * cos(6.2831853 * phase), 1.5) * sm(0.0, 0.25, t) * (1.0 - sm(0.7, 1.0, t));
    h = sea + 0.3 + 0.8 * t + max(top - sea - 1.1, 0.0) * sm(0.6, 1.0, t) + 0.5 * scroll * sm(0.04, 0.18, ak);
    let gate = sm(0.04, 0.18, ak) * sm(0.85, 1.0, silt);
    sand = gate * (1.0 - sm(0.7, 1.1, ub + 0.3 * vnoise(wx / 19.0, wy / 19.0, u.seed ^ 0x9du))) * (0.65 + 0.35 * scroll);
  }
  return vec2f(min(fp, h), sand);
}
// Braided bed (the riverfix card): a mostly dry bed of gravel bars a little above the sea, with thin threads of water that split and rejoin round them.
// The bars are the cells of a staggered, jittered lattice stretched along the path (BR_LEN widths by BR_ACROSS, in (along, across) px, so they follow the
// bends), measured with a distance that counts BR_HEAD times over upstream of a bar's site and BR_TAIL times downstream: each bar is a teardrop, a blunt head
// upstream and a long tapering tail (the path is drawn from upstream to down, as a river's migration reads it). The lookup is bent by smooth noise in two
// octaves, so the edges between bars curve. Each bar has an age, from its seed and how far its site lies from the bare braid plain (a band about a line that
// wanders across the bed): young bars are the bed, low (1.4 to 2 above the sea), and its share is the second result (stampLandform lays it as the cover
// plane's sand, the bed plane's gravel and the scatter's pebbles); old bars rise to the valley floor without it, so the ground pass grows grass on them.
// Threads run on the edges between bars where at least one is young, with bed along every thread, so water never touches grass. A thread is as wide as the
// active tracts (two bands wandering across the bed, BR_WET wide) are strong there, 3 to 12 px, varied by its edge's seed and along its length, and tapers
// out with them; on an edge steeper than about 25 degrees to the flow it fades too, so threads split and rejoin in shallow Y's, no cross link is square to
// the flow and none ends square. Threads are cut 2 to 3 units under the sea, which the per-pixel draw shows as water from a 2-px field (one under 3 px wide
// breaks into dashes on that lattice, one under 2.5 units deep at the waterline's jitter); an edge too narrow to hold water is a dry scar. Everything is a
// function of the cell's place along and across the path and the stroke's seed, so a regional replay draws the same bed. fl is the valley floor the bed lies
// on; the bed reaches 1.8 widths either side of the path, and past an end it runs straight on to its round rim.
const BR_LEN = 5.6;      // a bar's lattice length along the path, in widths
const BR_ACROSS = 1.4;   // and across it
const BR_HEAD = 1.5;     // the distance upstream of a bar's site counts this much (a blunt head)...
const BR_TAIL = 0.75;    // ...and downstream this much (a long tail)
// The bed's artistic numbers, in one place: how wet it is and how pebbly. Its colour is world data (materials/<world>.json water.riverBedRGB; a world with
// none takes its rock's, darkened), drawn by engine-frag.wgsl where the bed plane says.
const BR_WET = 1.5;      // how wide the two active tracts reach (in widths, times 1.2 to 3.4 either side of their lines): the bed's wet share follows it
const BR_PEBBLES = 0.7;  // the bed's pebbles: its share written as painted denser scatter (mask plane 4), so the loose-stone scatter lays stones on it
fn braidSite(cx: i32, cy: i32) -> vec2f {
  return vec2f(f32(cx) + 0.5 * f32(cy & 1) + 0.5 + 0.38 * hashi(cx, cy, u.seed ^ 0xb1u), f32(cy) + 0.5 + 0.3 * hashi(cx, cy, u.seed ^ 0xb2u));
}
// The squared teardrop distance from q to a site, in lattice units.
fn braidDist(q: vec2f, site: vec2f) -> f32 {
  let dx = (q.x - site.x) * select(BR_TAIL, BR_HEAD, q.x < site.x); let dy = q.y - site.y;
  return dx * dx + dy * dy;
}
// Its gradient in px (the path's along and across), for the distance from the edge between two bars.
fn braidGrad(q: vec2f, site: vec2f, d: f32, LX: f32, LY: f32) -> vec2f {
  let k = select(BR_TAIL, BR_HEAD, q.x < site.x);
  return vec2f(k * k * (q.x - site.x) / LX, (q.y - site.y) / LY) / max(d, 1e-6);
}
// A bar's age (0 young, 1 old): its seed, and how far its site stands from the bare braid plain.
fn braidAge(cell: vec2i, site: vec2f, LX: f32, LY: f32, W: f32) -> f32 {
  let mid = 2.2 * W * vnoise(site.x * LX / (9.0 * W), 0.37, u.seed ^ 0x95u);
  let plain = 1.0 - sm(2.5 * W, 4.6 * W, abs(site.y * LY - 0.5 * mid));
  return clamp(0.62 * (0.5 + 0.5 * hashi(cell.x, cell.y, u.seed ^ 0xb6u)) + 0.6 * (1.0 - plain), 0.0, 1.0);
}
fn braidedBelt(fl: f32, c: f32, e: f32, sAlong: f32, wx: f32, wy: f32) -> vec2f {
  let W = u.lfRiver; let B = 1.8 * W;
  let d = sqrt(c * c + e * e);
  if (d > B + 6.0) { return vec2f(fl, 0.0); }
  let sea = u.sea;
  let cc = c;
  let LX = BR_LEN * W; let LY = BR_ACROSS * W;
  // The active tracts, where the water runs: bands about 1.5 widths (times BR_WET) either side of two lines that wander across the path, one 2.2 widths over
  // about 9 widths along, the other 3 widths over about 13 (and a little weaker), so the threads gather, part and meet again.
  let mid = 2.2 * W * vnoise(sAlong / (9.0 * W), 0.37, u.seed ^ 0x95u);
  let mid2 = 3.0 * W * vnoise(sAlong / (13.0 * W) + 4.3, 0.71, u.seed ^ 0x9au);
  let tract = max(1.0 - sm(1.2 * W * BR_WET, 3.4 * W * BR_WET, abs(cc - mid)), 0.8 * (1.0 - sm(0.8 * W * BR_WET, 2.6 * W * BR_WET, abs(cc - mid2))));
  let q0 = vec2f(sAlong / LX, cc / LY);
  let q = q0 + vec2f(0.12 * vnoise(q0.x * 1.7 + 3.1, q0.y * 1.3, u.seed ^ 0xb7u),
                     0.32 * vnoise(q0.x * 1.6, q0.y * 0.8 + 7.7, u.seed ^ 0xb8u) + 0.1 * vnoise(q0.x * 4.1 + 1.9, q0.y * 1.7, u.seed ^ 0xb9u));
  let iy0 = i32(floor(q.y));
  var d1 = 1.0e9; var d2 = 1.0e9; var a = vec2f(0.0); var b = vec2f(0.0); var ia = vec2i(0); var ib = vec2i(0);
  for (var jy = -1; jy <= 1; jy++) {
    let cy = iy0 + jy;
    let ix0 = i32(floor(q.x - 0.5 * f32(cy & 1)));
    for (var jx = -1; jx <= 1; jx++) {
      let cx = ix0 + jx;
      let site = braidSite(cx, cy);
      let dd = braidDist(q, site);
      if (dd < d1) { d2 = d1; b = a; ib = ia; d1 = dd; a = site; ia = vec2i(cx, cy); }
      else if (dd < d2) { d2 = dd; b = site; ib = vec2i(cx, cy); }
    }
  }
  // The distance in px from the edge between the two bars: the difference of their distances over its gradient.
  let r1 = sqrt(d1); let r2 = sqrt(d2);
  let gf = braidGrad(q, b, r2, LX, LY) - braidGrad(q, a, r1, LX, LY);
  let edgePx = (r2 - r1) / max(length(gf), 1e-6);
  let along = abs(gf.x) / max(length(gf), 1e-6);   // the sine of the edge's angle to the flow
  let ageA = braidAge(ia, a, LX, LY, W); let ageB = braidAge(ib, b, LX, LY, W);
  // The edge's seed (its width): the two bars' ids in either order.
  let first = ia.x < ib.x || (ia.x == ib.x && ia.y < ib.y);
  let lo = select(ib, ia, first); let hi = select(ia, ib, first);
  let hw = 0.5 + 0.5 * hashi(lo.x * 7919 + hi.x, lo.y * 104729 + hi.y, u.seed ^ 0xb4u);
  // A thread runs on an edge with bed on at least one side (sand lines it, so it never touches grass); it is as wide as the tract is strong there and tapers
  // out with it, and on an edge steeper than about 25 degrees to the flow, so it fades rather than ending square. The edge's seed varies its width only.
  let width = mix(3.0, 6.0, hw) * (0.5 + 1.5 * tract) * (0.8 + 0.25 * vnoise(wx / 23.0, wy / 23.0, u.seed ^ 0xb5u))
            * sm(0.1, 0.35, tract) * (1.0 - sm(0.42, 0.62, along)) * (1.0 - sm(0.4, 0.5, min(ageA, ageB)));
  let wet = width > 2.0;
  // The bar: its rise from the edge over 45% of a bar's width, to a height its age gives.
  let rise = sm(0.0, 0.45 * LY, edgePx);
  let barTop = sea + 1.4 + 0.25 * vnoise(wx / 5.0, wy / 5.0, u.seed ^ 0x98u) + rise * mix(0.5, 3.4, ageA * ageA);
  var h = barTop;
  var sand = 1.0 - sm(0.35, 0.7, ageA);   // the bed's share: young bars
  if (wet) {
    let f = 1.0 - sm(0.5 * width - 1.0, 0.5 * width + 1.0, edgePx);
    h = mix(barTop, sea - (2.0 + 1.0 * tract), f);
    sand = max(sand, 1.0 - sm(0.5 * width + 3.0, 0.5 * width + 8.0, edgePx));   // bed along every thread, so water never touches grass
  } else {
    let f = 1.0 - sm(0.5 * width - 1.0, 0.5 * width + 2.0, edgePx);
    h = mix(barTop, sea + 1.3, f);   // a dry channel scar, above the waterline's relief
  }
  let rim = sm(B - 6.0, B + 6.0, d + 3.0 * vnoise(wx / 14.0, wy / 14.0, u.seed ^ 0x94u));
  return vec2f(min(fl, mix(h, fl, rim)), sand * (1.0 - rim));
}
// A signed section (a knot below 0, u.lfSigned): the part of the section beyond the ground (a rim or levee beside a cut, a moat round a raise) is part of the
// landform, so a cell counts as covered by how far inside the foot it stands (0 at the foot, 1 at the path), not by the section's value, which is below 0
// there. A section that stays within 0..1 keeps its value as its coverage. The widths are lfShare's.
fn lfCraterCover(q: f32, c: f32, e: f32, cap: bool, side: f32, wm: f32) -> f32 {
  if (u.lfSigned == 0u) { return clamp(q, 0.0, 1.0); }
  let back = c * side; let r = sqrt(c * c + e * e);
  let fw = max(u.lfFront * wm, 0.5); let bw = max(u.lfBack * wm, 0.5);
  var w = select(fw, bw, back > 0.0);
  if (cap && e > 0.0) { w = mix(fw, bw, 0.5 + 0.5 * back / max(r, 1e-5)); }
  return max(clamp(q, 0.0, 1.0), clamp(1.0 - r / w, 0.0, 1.0));
}
// lfcrater: the impact's spread at azimuth phi from downrange (c, sn: its cosine and sine), as impactWeight in sculpt-shape-presets.js: the blanket gathers
// downrange (ejAsym), an uprange forbidden zone opens (ejFz, half angle), and a grazing impact throws to the sides (ejWing) with a downrange gap (ejDz).
fn lfCraterSpread(c: f32, sn: f32) -> f32 {
  let down = abs(atan2(sn, c)); let up = 3.14159265 - down;
  var w = (1.0 + 0.85 * u.ejAsym * c) * (1.0 - u.ejWing) + u.ejWing * pow(abs(sn), 1.5);
  if (u.ejFz > 0.0) { w = w * sm(0.6 * u.ejFz, 1.4 * u.ejFz, up); }
  if (u.ejDz > 0.0) { w = w * sm(0.6 * u.ejDz, 1.4 * u.ejDz, down); }
  return w;
}
// Big impacts buckle the ground round them. Retail Moon's big craters (650-750 px rims; docs/IMPACT_RETAIL.md, measure/crater_rings.py): past the rim the
// outer flank is broken into 6-7 blocks of uplifted ground, 22-37 deg of the ring each, centred 1.2-1.4 rim radii out and standing .19-.54 of the depth over
// the smooth flank, a second crest on 11-18% of the azimuth, and nothing in the heights past 2 rim radii; craters under about 260 px carry lumps at their own,
// lower scale. Here: rings of raised blocks BK_WAVE rim radii apart from just outside the rim, wandering along the ring, each ring broken into sections that
// stand to different heights, highest by the rim and gone by 1.72 rim radii. Its own height (u.bkAmt, the Buckling row) and the impact's spread carry it
// (none in the forbidden zone, more downrange); the rim radius rp scales it from none under BK_R0 px to all of it from BK_R1 px. In the shape's frame (lr:
// the cell's ray's rim point), so every tile computes the same value. lfimpact2 (the owner: "should allow a bit more"): 48 -> 32 and 280 -> 160 px, so a
// crater of retail's medium class (rim 172-248 px across, median 4.5 blocks at .46 of the depth) buckles: at Diameter 360 (a 220 px rim) the Moon
// preset draws 5 blocks (2 before), on a flat fixture.
const BK_R0 = 32.0;
const BK_R1 = 160.0;
const BK_WAVE = 0.3;
const BK_AMP = 3.0;
fn lfImpactBuckle(sr: f32, rp: f32, lr: vec2f, w: f32) -> f32 {
  let size = sm(BK_R0, BK_R1, rp);
  if (size <= 0.0 || sr < 1.0 || sr > 1.72) { return 0.0; }
  let a = lr / (0.5 * rp);
  let ph = (sr - 1.05) / BK_WAVE + 0.3 * vnoise(lr.x / (0.8 * rp), lr.y / (0.8 * rp), u.seed ^ 0x4b17u);
  let n = floor(ph); let f = ph - n;
  let arc = sm(-0.1, 0.3, vnoise(a.x + 17.3 * n, a.y - 9.1 * n, u.seed ^ 0x6d2bu));
  let lift = 0.7 + 0.3 * vnoise(1.9 * a.x - 5.1 * n, 1.9 * a.y + 3.3 * n, u.seed ^ 0x2e95u);
  let block = sm(0.0, 0.4, f) * (1.0 - sm(0.6, 1.0, f));
  let env = sm(1.0, 1.1, sr) * (1.0 - sm(1.25, 1.72, sr));
  return BK_AMP * size * clamp(w, 0.0, 1.6) * env * arc * lift * block;
}
// lfcrater: the ejecta beyond a landform's peak (its rim), added to the ground or the shape: a thin continuous blanket that thins as the cube of the distance
// (McGetchin et al. 1973) to about 1.8 rim radii from the path, and ragged radial tongues that run from the rim a third to most of a rim radius farther, curling
// as they go (retail Moon's craters: a fringe of short, curly ridges round a crisp rim). The tongues and their lengths are functions of the place on the rim a
// cell's ray leaves from (in the shape's frame), so they run outward and every tile computes the same value. Tongues sit at least 8 px apart, so they read at 1x.
fn lfCraterEjecta(wx: f32, wy: f32, trunk: u32) -> vec2f {
  let s0 = Seg[(u.segBase + trunk) * 4u]; let s1 = Seg[(u.segBase + trunk) * 4u + 1u];
  let a = s0.xy; let d = s0.zw - s0.xy; let p = vec2f(wx, wy);
  let t = clamp(dot(p - a, d) / max(dot(d, d), 1e-8), 0.0, 1.0);
  let o = p - (a + d * t); let r = length(o);
  if (r < 1e-3) { return vec2f(0.0, 1.0); }
  let rh = o / r;
  let rp = select(u.ejPeakF, u.ejPeakB, (o.x * d.y - o.y * d.x) * s1.w > 0.0);
  if (rp <= 0.0) { return vec2f(0.0, 1.0); }
  let sr = r / rp;
  var w = 1.0;
  if (u.imX != 0.0 || u.imY != 0.0) { w = lfCraterSpread(rh.x * u.imX + rh.y * u.imY, u.imX * rh.y - u.imY * rh.x); }
  // An oblique impact lowers its rim where it throws little ejecta (Herrick and Forsberg-Taylor 2003: the uprange rim first, then the downrange one).
  let lip = select(1.0, mix(1.0, 0.4 + 0.6 * clamp(w, 0.0, 1.0), sm(0.0, 0.3, u.ejFz + u.ejDz)), u.ejAmt > 0.0);
  if (sr < 0.8 || sr > 2.6 || w <= 0.0) { return vec2f(0.0, lip); }
  let lt = max(8.0, 0.2 * rp);
  let wig = 0.6 * lt * vnoise(r / 15.0, f32(trunk) * 7.3 + 0.37 * dot(rh, vec2f(13.1, 7.7)), u.seed ^ 0x2c61u);
  let rim = a + d * t + rh * rp + vec2f(-rh.y, rh.x) * wig;
  var lr = rim; var lp = p;
  if (u.framed != 0u) { lr = vec2f(u.inv0 * rim.x + u.inv2 * rim.y + u.inv4, u.inv1 * rim.x + u.inv3 * rim.y + u.inv5); lp = vec2f(u.inv0 * wx + u.inv2 * wy + u.inv4, u.inv1 * wx + u.inv3 * wy + u.inv5); }
  let ray = vnoise(lr.x / lt, lr.y / lt, u.seed ^ 0x3a71u);
  let len = vnoise(lr.x / (0.6 * lt), lr.y / (0.6 * lt), u.seed ^ 0x5e13u);
  let hum = vnoise(lp.x / 7.0, lp.y / 7.0, u.seed ^ 0x1f37u);
  let tip = 1.0 + (0.35 + 0.3 * (len + 1.0)) * (0.75 + 0.25 * min(w, 1.8));
  let along = clamp((sr - 1.0) / (tip - 1.0), 0.0, 1.0);
  let tongue = sm(0.05, 0.6, ray) * sm(0.95, 1.08, sr) * pow(1.0 - along, 0.6) * select(1.0, 0.0, sr >= tip);
  let blanket = sm(0.85, 1.05, sr) * pow(sr, -3.0) * (1.0 - sm(1.5, 1.9, sr));
  return vec2f(u.ejAmt * (w * (0.5 * blanket + tongue) * (0.8 + 0.4 * hum)) + u.bkAmt * lfImpactBuckle(sr, rp, lr, w), lip);
}
// lfcrater: a spur off a section that peaks before its path (a crater's rim, u.lfPeak the peak's share of the half width from the foot) carries the section
// from the foot to that peak, both sides, so it ridges out from the rim at the rim's height instead of carrying the bowl along it.
fn lfCraterSpurShare(c: f32, e: f32, wm: f32) -> f32 {
  let r = sqrt(c * c + e * e); let w = max(u.lfFront * wm, 0.5);
  if (r >= w) { return 0.0; }
  return curveAt(u.curveBase, u.lfPeak * (1.0 - r / w));
}
// Gaps: a ring or ridge broken into arcs. Gaps breaks spaced evenly round a click (the angle about its point) or along a drawn path (its share), each
// moved a little by the stroke's seed, Gap width of the spacing wide with soft sides: 1 in a break, 0 between.
fn lfGapMask(phase: f32) -> f32 {
  let n = u.lfGaps; let t = phase * n; let k = floor(t); var m = 0.0;
  for (var j = -1; j <= 1; j++) {
    let kk = k + f32(j); let w = i32(kk - n * floor(kk / n));
    let c = kk + 0.5 + 0.3 * hashi(w, 7, u.seed ^ 0x9a3u);
    m = max(m, 1.0 - smoothstep(0.08 * u.lfGapWidth, 0.5 * u.lfGapWidth, abs(t - c)));
  }
  return m;
}
// One segment's candidate at a cell: (the value before combine, q clamped to 0..1).
// trunkShare: the cell's place along the path (0 to 1), for a trunk segment; a spur piece carries its root's.
fn lfEval(s0: vec4f, s1: vec4f, s2: vec4f, wx: f32, wy: f32, base: f32, nA: f32, nB: f32, nC: f32, trunkShare: f32, x: i32, y: i32, i: u32, cells: u32) -> vec3f {
  let dx = s0.z - s0.x; let dy = s0.w - s0.y; let len = max(sqrt(dx * dx + dy * dy), 1e-4);
  let ux = dx / len; let uy = dy / len;
  let ahead = (wx - s0.x) * ux + (wy - s0.y) * uy;
  let tt = clamp(ahead / len, 0.0, 1.0);
  let cx = s0.x + dx * tt; let cy = s0.y + dy * tt;
  let c = (wx - cx) * uy - (wy - cy) * ux;
  let spur = s1.z < 0.0;
  let flags = select(u32(s2.x), 3u, spur);
  let cap = (ahead < 0.0 && (flags & 1u) != 0u) || (ahead > len && (flags & 2u) != 0u);
  let e = max(max(ahead - len, -ahead), 0.0);
  let share = select(trunkShare, -1.0 - s1.z, spur);
  // The existing crest taper narrows and lowers the trunk; its along curve remains independently editable.
  let taper = select(u.lfTaper * (1.0 - sm(0.0, 0.4, min(share, 1.0 - share))), 0.0, spur || s1.z < 1.0);
  var wm0 = select(1.0 - 0.62 * taper, mix(s2.x, s2.y, tt), spur);
  // lfcrater: an impact's groove (the trunk before its landing) is as wide, at each place, as the along curve is high there over its end: the shape at that scale.
  if (u.grooveEnd != 0.0 && !spur) { wm0 = wm0 * clamp(clamp(curveRaw(u.alongBase, share), 0.0, 1.2) / u.grooveEnd, 0.0, 2.0); }
  let hm = select(1.0 - 0.7 * taper, mix(s2.z, s2.w, tt), spur);
  var cc = c; var ee = e; var wm = wm0;
  if (u.lfWander > 0.0 || u.lfWidth > 0.0) {
    // Move the radial outline, including the free ends. Shifting only c left round caps unchanged and could fold a face when the section crossed its path.
    // The same position-based noise moves a bend's equal-distance candidates together; taper and both sides keep one bounded footprint.
    let wt = lfWeight(lfShare(c, e, cap, s1.w, wm0));
    let r = sqrt(c * c + e * e);
    let shift = u.lfWander * wt * nA * sm(0.0, max(u.lfFront, u.lfBack) * wm0 * 0.18, r);
    let moved = max(0.0, r + shift) / max(r, 1e-5);
    cc = c * moved; ee = e * moved;
    wm = wm0 * exp(1.35 * u.lfWidth * wt * nB);
  }
  var q = lfShare(cc, ee, cap, s1.w, wm);
  if (spur && u.lfPeak > 0.0 && s1.x == 0.0) { q = lfCraterSpurShare(cc, ee, wm); }   // an impact's landing (s1.x 1) draws the whole section
  // Face steepness above 1 (the host sets it on a raised section): the section's rise share through a gain round its middle, so the face between foot
  // and top is lfFace times as steep there, and the foot and the top flatter and wider.
  if (u.lfFace > 1.0 && q > 0.0 && q < 1.0) { let ga = pow(q, u.lfFace); q = ga / (ga + pow(1.0 - q, u.lfFace)); }
  let along = clamp(curveRaw(u.alongBase, select(share, 1.0, !spur && s1.z < 1.0)), 0.0, 1.2);   // a click (no length) reads its along curve at the end
  let lfB = select(u.baseH, base, u.lfGround != 0u); let lfE = select(u.elev, base + u.elev, u.lfGround != 0u);
  let crest = lfB + (lfE - lfB) * along * hm;   // the plain is the map's base height (with Height reference Ground, the cell's own ground); a spur piece rises hm of the way from it   // the plain is the map's base height (with Height reference Ground, the cell's own ground); a spur piece rises hm of the way from it
  let qt = terraced(q, x, y, i, cells);
  var value = base + (crest - base) * qt;
  var bar = 0.0;
  if (u.lfRiver > 0.0 && !spur) {
    if (u.lfBraid > 0.0) { let bb = braidedBelt(value, c, e, share * s1.z + select(-e, e, share > 0.5), wx, wy); value = bb.x; bar = bb.y; }
    else { let ch = riverChannel(value, q, c, e, mix(s2.y, s2.z, tt), s2.w, wx, wy); value = ch.x; bar = ch.y; }
  }
  if (u.lfHeight > 0.0) { value = value + u.lfHeight * lfWeight(q) * nC * sm(0.0, 0.15, q); }
  // Gaps lower only the ground this shape raises above its base (a crater's rim, not its bowl), by at most Gap depth.
  if (u.lfGaps > 0.0 && !spur && value > base) {
    let click = dx * dx + dy * dy < 1.0;
    let phase = select(clamp(share, 0.0, 1.0), fract(atan2(wy - s0.y, wx - s0.x) / 6.2831853 + 1.0), click);
    value = value - min(value - base, u.lfGapDepth) * lfGapMask(phase);
  }
  return vec3f(value, lfCraterCover(q, cc, ee, cap, s1.w, wm), bar);
}
// ---- P1 gullies: a slope-aligned stripe filter (ported from the research lab's gully filter, docs/research/lab/lib.wgsl on the research branch) ----
// The four nearest jittered cells of a 1/f lattice, smoothstep weights, (cos, sin) of the phase across `dir` summed and normalised: stripes whose crests
// run along dir.
fn gullyStripes(p: vec2f, dir: vec2f, f: f32, seed: u32) -> vec2f {
  let perp = vec2f(-dir.y, dir.x);
  let q = p * f; let c0 = floor(q - 0.5); let fr = q - 0.5 - c0;
  var acc = vec2f(0.0);
  for (var j = 0; j <= 1; j++) { for (var i = 0; i <= 1; i++) {
    let cx = i32(c0.x) + i; let cy = i32(c0.y) + j;
    let o = q - (vec2f(f32(cx), f32(cy)) + 0.5 + 0.35 * vec2f(hashi(cx, cy, seed), hashi(cx, cy, seed ^ 0x68e31da4u)));
    let wx = select(1.0 - fr.x, fr.x, i == 1); let wy = select(1.0 - fr.y, fr.y, j == 1);
    let w = wx * wx * (3.0 - 2.0 * wx) * wy * wy * (3.0 - 2.0 * wy);
    let ph = 6.2831853 * dot(o, perp);
    acc += w * vec2f(cos(ph), sin(ph));
  } }
  let l = length(acc);
  return select(vec2f(1.0, 0.0), acc / l, l > 1e-5);
}
// Branching gullies cut into a height h0 that rises along `steer` (any length) at slope `slope0`. Each octave folds its stripes downward (fold -1:
// round crests, V-cut floors, as water cuts them; the research brief's realism check, calibrated on 1 m lidar, put 10 of 15 statistics in the real
// range with it against 8 of 15 for the sharp-crested fold +1, which would suit badland or alpine worlds) and adds its own gradient to the steering,
// so the next octave branches. wave0: the first wavelength (px); depth: depth per wavelength per unit slope, halved each octave; minWave: no octave
// finer than this.
fn gullies(p: vec2f, h0: f32, steer: vec2f, slope0: f32, wave0: f32, depth: f32, minWave: f32, seed: u32) -> f32 {
  if (slope0 <= 0.0 || length(steer) < 1e-6) { return h0; }
  var h = h0; var g = normalize(steer) * max(slope0, 1e-3);
  var f = 1.0 / wave0; var dk = depth;
  for (var k = 0; k < 8; k++) {
    if (1.0 / f < minWave) { break; }
    let s = length(g); if (s < 1e-5) { break; }
    let dir = g / s; let perp = vec2f(-dir.y, dir.x);
    let cs = gullyStripes(p, dir, f, seed + u32(k) * 0x3c6ef35fu);
    let a = dk * (1.0 / f) * min(slope0, 1.6);
    h -= a * (0.5 - abs(cs.y));
    g += a * sign(cs.y) * cs.x * 6.2831853 * f * perp;
    f *= 2.0; dk *= 0.5;
  }
  return h;
}
// The stroke's own fall line at a cell: away from the path (a soft minimum, 28 px, over its segments' nearest points, so bends blend), or zero where no
// segment is near. Gullies and the talus cones both steer by it.
fn landformFall(p: vec2f, x: i32, y: i32) -> vec2f {
  var acc = 0.0; var away = vec2f(0.0);
  for (var k = 0u; k < u.nseg; k++) {
    let bx = bitcast<vec4<i32>>(Seg[(u.segBase + k) * 4u + 3u]);
    if (x < bx.x || x > bx.z || y < bx.y || y > bx.w) { continue; }
    let s0 = Seg[(u.segBase + k) * 4u];
    let d = s0.zw - s0.xy; let t = clamp(dot(p - s0.xy, d) / max(dot(d, d), 1e-8), 0.0, 1.0);
    let o = p - (s0.xy + d * t); let dn = length(o);
    if (dn < 1e-3) { continue; }
    let w = exp(-dn / 28.0); acc += w; away += w * o / dn;
  }
  // The test is against the weights' own sum: they fall to 1e-5 some 320 px from the path, and an absolute floor there left the lower slope and the foot
  // of a wide landform with no fall line (no gullies, no talus). Only directions that cancel (a cell midway between two stretches) give none.
  if (acc <= 0.0 || length(away) < 1e-5 * acc) { return vec2f(0.0); }
  return normalize(away);
}
// The outline's wander at a point of the shape's frame, -1..1. `even` is the one wavelength (the Variation size) drawn round the whole shape. Variation along the
// wall (u.lfVary) blends in waves three times as long, the alcoves and salients a wall's teeth ride on, and lets the teeth come and go over stretches 2.5
// wavelengths long, so one wall has straight runs and ragged ones. The sum stays within -1..1: the footprint the host reserves for Wander still holds it.
fn wanderVaried(even: f32, x: f32, y: f32) -> f32 {
  let sz = max(u.lfSize, 8.0); let zb = 70.0 / sz;
  let big = 0.7 * noiseValue(3u, u.seed ^ 0x51a7u, x * zb, y * zb) + 0.3 * noiseValue(2u, u.seed ^ 0x51a7u, x * zb, y * zb);
  let amp = clamp(1.0 + 1.5 * vnoise(x / (2.5 * sz), y / (2.5 * sz), u.seed ^ 0x33c9u), 0.05, 2.2);
  return mix(even, clamp(0.6 * even * amp + 0.7 * big, -1.0, 1.0), u.lfVary);
}
// Variation along the wall for the Gullies: a field seven of the widest gullies across, -1..1.
fn wallBroad(x: f32, y: f32, wv: f32) -> f32 { return vnoise(x / (7.0 * wv), y / (7.0 * wv), u.seed ^ 0x6e21u); }
// Variation along the wall for the Gullies. Their depth, a multiple of the drawn depth that already runs from a fifth to nearly twice over stretches three
// wavelengths long, widens over the longer stretches of wallBroad, from no gullies at all (a plain wall) to 2.4 times; and their sideways warp gains a
// longer, larger one, so their spacing runs from about half to one and a half times the Gully size along one wall.
fn gullyDeepVaried(even: f32, x: f32, y: f32, wv: f32) -> f32 { return even * mix(1.0, clamp(1.0 + 1.6 * wallBroad(x, y, wv), 0.0, 2.4), u.lfVary); }
fn gullyWarpVaried(even: f32, x: f32, y: f32, wv: f32) -> f32 { return even + u.lfVary * 1.6 * wv * vnoise(x / (5.0 * wv), y / (5.0 * wv), u.seed ^ 0x1d4fu); }
// Hard beds: a raised face stands in cliff bands with gentler slopes between them. The cell's lift over the ground, as a share of the section's own
// crest there, goes through a staircase of bedN equal pairs: the lower 0.6 of a pair is the soft bed, which keeps a tenth of its slope at full strength,
// and the upper 0.4 the hard bed, which takes up the rest and stands that much steeper. It runs after the Gullies, so a band keeps its level round
// every spur and up every ravine, as a bed does. The bands' levels wave by a quarter of a pair along the wall, and each band thins out over some
// stretches (more of them with Variation along the wall), so a ledge ends and the next steps out. Only the difference from the straight ramp is added:
// at strength 0 nothing moves, nor does the section's own level top (q from 0.92 up), whatever the Gullies cut into it. The bands fade out over the
// section's foot (q under 0.25, as the Gullies do): on that gentle apron a hard bed is a thin ribbon of rock winding round the toe.
fn hardBeds(value: f32, base: f32, own: f32, q: f32, lx: f32, ly: f32) -> f32 {
  let lift = (own - base) / max(q, 0.05);
  let free = (1.0 - sm(0.92, 1.0, q)) * sm(0.0, 0.25, q);
  if (lift < 8.0 || free <= 0.0) { return value; }
  let g = clamp((value - base) / lift, 0.0, 1.0);
  let wave = 0.25 * (0.6 * vnoise(lx / 190.0, ly / 190.0, u.seed ^ 0x91b3u) + 0.4 * vnoise(lx / 61.0, ly / 61.0, u.seed ^ 0x4c7du));
  let at = clamp(g * u.bedN + wave * 4.0 * g * (1.0 - g), 0.0, u.bedN);
  let k = min(floor(at), u.bedN - 1.0); let t = at - k;
  let x = (t - 0.6) / 0.4;
  let stair = select(0.06 + 0.94 * mix(x, sm(0.0, 1.0, x), 0.5), 0.1 * t, t < 0.6);
  let ticket = 0.5 + 0.5 * (0.7 * vnoise(lx / 150.0 + k * 7.3, ly / 150.0 - k * 3.1, u.seed ^ 0x77a1u) + 0.3 * vnoise(lx / 47.0 + k * 1.7, ly / 47.0, u.seed ^ 0x1e35u));
  let bar = 0.1 + 0.35 * u.lfVary;
  let intact = sm(bar - 0.25, bar + 0.25, ticket);
  return value + lift * (stair - t) / u.bedN * u.bedSoft * intact * free;
}
// A landform's gullies at a cell it raises: steered by the stroke's own fall line, at the slope of the picked segment's own section across that line, faded
// over the foot (q 0 to 0.25) and off a smooth route. The pattern lives in the shape's frame, so it moves with the shape and every tile and page computes
// the same value.
fn landformGullies(value: f32, q: f32, pk: u32, share: f32, wx: f32, wy: f32, lx: f32, ly: f32, base: f32, nA: f32, nB: f32, nC: f32, x: i32, y: i32, i: u32, cells: u32) -> f32 {
  let keep = sm(0.0, 0.25, q) * (1.0 - u.lfRoute * sm(0.30, 0.92, q));
  if (keep <= 0.0) { return value; }
  let p = vec2f(wx, wy);
  let fall = landformFall(p, x, y);
  if (all(fall == vec2f(0.0))) { return value; }
  let hs = max(u.spacing, 1.0);
  let s0 = Seg[(u.segBase + pk) * 4u]; let s1 = Seg[(u.segBase + pk) * 4u + 1u]; let s2 = Seg[(u.segBase + pk) * 4u + 2u];
  // The pattern runs in the shape's frame, whose px are fs world px: the slope and the finest wavelength go into frame px with it.
  let fs = select(1.0, 1.0 / max(length(vec2f(u.inv0, u.inv1)), 1e-6), u.framed != 0u);
  var out = fall;
  if (u.framed != 0u) { out = vec2f(u.inv0 * fall.x + u.inv2 * fall.y, u.inv1 * fall.x + u.inv3 * fall.y); }
  let wv = u.gullySize; let sd = normalize(out);
  // On a long even face one wavelength cuts evenly spaced ribs, a comb; a broad warp across the fall line and a broad change of depth make them wander,
  // crowd, part and differ.
  var warp = 0.5 * wv * vnoise(lx / (2.2 * wv), ly / (2.2 * wv), u.seed ^ 0x7f4au);
  // Real gullies are not a comb: over stretches three wavelengths long the depth runs from a fifth to nearly twice, so a wall has quiet buttresses
  // and deeply cut bays.
  var deep = clamp(1.0 + 0.85 * vnoise(lx / (3.0 * wv), ly / (3.0 * wv), u.seed ^ 0x2b91u), 0.2, 1.85);
  if (u.lfVary > 0.0) { warp = gullyWarpVaried(warp, lx, ly, wv); deep = gullyDeepVaried(deep, lx, ly, wv); }
  let gp = vec2f(lx, ly) + vec2f(-sd.y, sd.x) * warp;
  // Gullies head back into their wall: in bays one wavelength apart (two of the widest gullies to a bay) the whole face stands farther in, and on the
  // buttresses between it stands where it was drawn, so each bay keeps the face's own section. A bay is wider than deep (at most 0.45 wavelength
  // back), deepest where the gullies are, and its neighbours differ; some stretches have none. Its depth is read at the foot in line with the cell
  // (lfRun), so a bay is one depth all the way down its fall line: a depth that changed on the way down could leave a hollow on the face. The face is
  // read at a place farther out along the fall line, with that place's own wander and width (this cell's would move the outline with the look).
  let ro = lfRun(s0, s1, s2, wx, wy, nA, nB, share);
  let fp = vec2f(lx, ly) + out * ro.x;
  // Bays are a cliff's: a side whose section is nowhere steeper than the repose (a hill's long back) has none, by the gate the talus uses. Setting such
  // a slope's foot back only uncovered the hollows of the ground under it (closed basins at the foot of modern Green's hills).
  let relief = select(u.elev, base + u.elev, u.lfGround != 0u) - base;
  let table = select(u.curveBase, u.backBase, ro.z > 0.5);
  var rise = 0.0; var pv = curveAt(table, 0.0);
  for (var j = 0u; j < 16u; j++) { let v = curveAt(table, f32(j + 1u) / 16.0); rise = max(rise, abs(v - pv) * 16.0 * abs(relief) / max(ro.y, 1.0)); pv = v; }
  let cliff = sm(u.talusTan, 1.6 * u.talusTan, rise);
  let fwarp = 0.5 * wv * vnoise(fp.x / (2.2 * wv), fp.y / (2.2 * wv), u.seed ^ 0x7f4au);
  let fdeep = clamp(1.0 + 0.85 * vnoise(fp.x / (3.0 * wv), fp.y / (3.0 * wv), u.seed ^ 0x2b91u), 0.2, 1.85);
  let bay = 1.0 - abs(gullyStripes(fp + vec2f(-sd.y, sd.x) * fwarp, sd, 0.5 / wv, u.seed ^ 0x3d17u).y);
  let each = max(1.0 + 0.9 * vnoise(fp.x / (1.7 * wv), fp.y / (1.7 * wv), u.seed ^ 0x51c3u), 0.0);
  let back = wv * fs * min(u.gully * fdeep * each, 0.45) * sm(0.0, 1.0, bay) * (1.0 - u.lfRoute) * cliff;
  let fw = p + fall * back; var fl = fw;
  if (u.framed != 0u) { fl = vec2f(u.inv0 * fw.x + u.inv2 * fw.y + u.inv4, u.inv1 * fw.x + u.inv3 * fw.y + u.inv5); }
  let fz = 210.0 / max(u.lfSize, 8.0); var fA = nA; var fB = nB;
  if (u.lfWander > 0.0) { fA = 0.7 * noiseValue(3u, u.seed, fl.x * fz, fl.y * fz) + 0.3 * noiseValue(2u, u.seed, fl.x * fz, fl.y * fz); if (u.lfVary > 0.0) { fA = wanderVaried(fA, fl.x, fl.y); } }
  if (u.lfWidth > 0.0) { fB = noiseValue(5u, u.seed, fl.x * fz, fl.y * fz); }
  let there = lfEval(s0, s1, s2, fw.x, fw.y, base, fA, fB, nC, share, x, y, i, cells).x;
  let up = lfEval(s0, s1, s2, fw.x - fall.x * hs, fw.y - fall.y * hs, base, fA, fB, nC, share, x, y, i, cells).x;
  let down = lfEval(s0, s1, s2, fw.x + fall.x * hs, fw.y + fall.y * hs, base, fA, fB, nC, share, x, y, i, cells).x;
  let slope = abs(up - down) / (2.0 * hs);
  // The bay only lowers, and comes in over its first 2 px, so a small Gullies is a small change.
  let h0 = value - max(value - there, 0.0) * clamp(back * 0.5, 0.0, 1.0);
  // gullies() starts from the uphill direction, as the lab's does, so each octave's own gradient, added to it, turns it the way the cut surface turns
  // (toward the path, except where a section dips on its way up).
  let steer = out * select(1.0, -1.0, up > down);
  return gullies(gp, h0, steer, slope * keep * fs, wv, u.gully * deep, max(8.0, 3.0 * u.spacing) / fs, u.seed ^ 0x6a1u);
}
// ---- P17 talus cones: the loose slope that rests against the foot of a landform's face, below each of its gully chutes ----
// How far inside (positive) or beyond (negative) the foot of the stroke's footprint a cell stands, and the foot's run from the path (the side the cell is on),
// in world px, by the outline lfEval draws (wander and width variation included; the arithmetic is lfEval's, repeated because lfEval stays as it is).
fn lfRun(s0: vec4f, s1: vec4f, s2: vec4f, wx: f32, wy: f32, nA: f32, nB: f32, trunkShare: f32) -> vec3f {
  let dx = s0.z - s0.x; let dy = s0.w - s0.y; let len = max(sqrt(dx * dx + dy * dy), 1e-4);
  let ux = dx / len; let uy = dy / len;
  let ahead = (wx - s0.x) * ux + (wy - s0.y) * uy;
  let tt = clamp(ahead / len, 0.0, 1.0);
  let cx = s0.x + dx * tt; let cy = s0.y + dy * tt;
  let c = (wx - cx) * uy - (wy - cy) * ux;
  let flags = u32(s2.x);
  let cap = (ahead < 0.0 && (flags & 1u) != 0u) || (ahead > len && (flags & 2u) != 0u);
  let e = max(max(ahead - len, -ahead), 0.0);
  let taper = select(u.lfTaper * (1.0 - sm(0.0, 0.4, min(trunkShare, 1.0 - trunkShare))), 0.0, s1.z < 1.0);
  let wm0 = 1.0 - 0.62 * taper;
  var cc = c; var ee = e; var wm = wm0;
  if (u.lfWander > 0.0 || u.lfWidth > 0.0) {
    let wt = lfWeight(lfShare(c, e, cap, s1.w, wm0));
    let r = sqrt(c * c + e * e);
    let shift = u.lfWander * wt * nA * sm(0.0, max(u.lfFront, u.lfBack) * wm0 * 0.18, r);
    let moved = max(0.0, r + shift) / max(r, 1e-5);
    cc = c * moved; ee = e * moved;
    wm = wm0 * exp(1.35 * u.lfWidth * wt * nB);
  }
  let back = cc * s1.w; let r = sqrt(cc * cc + ee * ee);
  let fw = max(u.lfFront * wm, 0.5); let bw = max(u.lfBack * wm, 0.5);
  var foot = select(fw, bw, back > 0.0);
  if (cap && ee > 0.0) { foot = mix(fw, bw, 0.5 + 0.5 * back / max(r, 1e-5)); }
  return vec3f(foot - r, foot, select(0.0, 1.0, back > 0.0));
}
// The height of the talus above the ground at a cell, or 0 (the caller takes the higher of this and the face). Each chute (a valley of the Gullies' widest
// stripes, which run on straight below the foot) lays a cone whose slope is the repose (talusAngle) and whose length is the reach, with a low apron between the
// cones, and nothing on a face whose section is nowhere steeper than the repose; inside the footprint the cone climbs the face at the repose until the face rises through it.
fn talusApron(wx: f32, wy: f32, lx: f32, ly: f32, x: i32, y: i32, trunk: u32, share: f32, nA: f32, nB: f32, base: f32, face: f32) -> f32 {
  let s0 = Seg[(u.segBase + trunk) * 4u]; let s1 = Seg[(u.segBase + trunk) * 4u + 1u]; let s2 = Seg[(u.segBase + trunk) * 4u + 2u];
  let ro = lfRun(s0, s1, s2, wx, wy, nA, nB, share);
  if (ro.x <= -u.talusReach) { return 0.0; }
  let relief = select(u.elev, base + u.elev, u.lfGround != 0u) - base;   // with Height reference Ground the crest stands elev over this cell's ground
  if (relief <= 0.0) { return 0.0; }
  // The steepest the stroke's section gets (its curve table, on this side, over the relief and the run), against the repose.
  let table = select(u.curveBase, u.backBase, ro.z > 0.5);
  // One march over the curve: its steepest slope (the gate) and where it first rises at the repose or steeper (the foot of the face, tf, interpolated).
  var rise = 0.0; var tf = 1.0; var before = 0.0; var found = false; var prevV = curveAt(table, 0.0);
  for (var j = 0u; j < 16u; j++) {
    let v = curveAt(table, f32(j + 1u) / 16.0);
    let g = abs(v - prevV) * 16.0 * relief / max(ro.y, 1.0);
    if (!found && g >= u.talusTan) { tf = (f32(j) + 0.5 - clamp((g - u.talusTan) / max(g - before, 1e-4), 0.0, 1.0)) / 16.0; found = true; }
    before = g; prevV = v; rise = max(rise, g);
  }
  let steep = sm(u.talusTan, 1.6 * u.talusTan, rise);
  if (steep <= 0.0) { return 0.0; }
  let fall = landformFall(vec2f(wx, wy), x, y);
  if (all(fall == vec2f(0.0))) { return 0.0; }
  let wv = u.gullySize;
  let chute = 0.5 + 0.5 * clamp(vnoise(lx / wv, ly / wv, u.seed ^ 0x6a1u), -1.0, 1.0);
  let L = u.talusReach * steep;
  if (L < 1.0) { return 0.0; }
  let along = ro.x - ro.y * max(tf, 0.0);
  let cap = 0.3 * relief;
  let apex = cap * tanh(0.5 * u.talusTan * L / cap);
  let out = max(-along, 0.0);
  let Hc = apex * (0.88 + 0.24 * mix(chute, 0.5, sm(0.0, 0.25, out / L)));
  if (along < 0.0) { let t = 1.0 - clamp(out / L, 0.0, 1.0); return Hc * t * t; }
  let line = Hc + 2.0 * Hc / L * along;
  let cut = u.gully * u.gullySize;
  // The cone is over once the section has risen through its line. A section that then levels off (a plateau) would meet the still rising line a second time
  // farther in and be buried under it (Talus reach 80 with Gullies raised 320 of a plateau's 587 level cells by up to 85 units), so the cone ends before
  // that second meeting. A section that keeps rising (a ridge) has none and is as it was.
  let t0 = max(tf, 0.0);
  var t2 = 2.0; var above = false; var pt = t0; var pd = curveAt(table, t0) * relief - Hc;
  for (var j = 1u; j <= 16u; j++) {
    let t = f32(j) / 16.0;
    if (t2 < 2.0 || t <= pt) { continue; }
    let d = curveAt(table, t) * relief - (Hc + 2.0 * Hc / L * (t - t0) * ro.y);
    if (d >= 0.0) { above = true; }
    else if (above) { t2 = mix(pt, t, clamp(pd / max(pd - d, 1e-4), 0.0, 1.0)); }
    pt = t; pd = d;
  }
  let ended = sm(t2 - 0.0625, t2, ro.x / max(ro.y, 1.0));
  return line * (1.0 - sm(cut, 2.0 * cut, face - line)) * (1.0 - ended);
}
// The fans. Debris comes down the ravines whatever the section's slope, so the wall lays an apron of fans from where its ravines open (the section at 0.15
// of the relief, where the Gullies' cut begins) to a toe the reach beyond the foot: lobes about a wavelength across on one apron, bigger where the
// Gullies cut deeper; as high at the apex as the skirt it lies on and half as much again. Up the ravine it fills the floor to that level. The
// lobes are read at the foot in line with the cell, so each runs straight out from the wall.
fn talusFan(wx: f32, wy: f32, lx: f32, ly: f32, x: i32, y: i32, trunk: u32, share: f32, nA: f32, nB: f32, base: f32) -> f32 {
  let s0 = Seg[(u.segBase + trunk) * 4u]; let s1 = Seg[(u.segBase + trunk) * 4u + 1u]; let s2 = Seg[(u.segBase + trunk) * 4u + 2u];
  // How far inside the foot the cell stands: by the outline as drawn (with its wander) at the wall and inside it, and by the plain distance from the path
  // once 40 px beyond that. Far out the wander's shift folds the distance into islands with square corners, which a fan would copy as steps.
  let rw = lfRun(s0, s1, s2, wx, wy, nA, nB, share);
  let rp = lfRun(s0, s1, s2, wx, wy, 0.0, 0.0, share);
  let ro = vec3f(mix(rw.x, rp.x, sm(0.0, 40.0, -rp.x)), rw.y, rw.z);
  if (ro.x <= -u.talusReach) { return 0.0; }
  let relief = select(u.elev, base + u.elev, u.lfGround != 0u) - base;
  if (relief <= 0.0) { return 0.0; }
  let fall = landformFall(vec2f(wx, wy), x, y);
  if (all(fall == vec2f(0.0))) { return 0.0; }
  let table = select(u.curveBase, u.backBase, ro.z > 0.5);
  var tq = 1.0; var pv = curveAt(table, 0.0);
  for (var j = 0u; j < 16u; j++) {
    let v = curveAt(table, f32(j + 1u) / 16.0);
    if (v >= 0.15) { tq = (f32(j) + clamp((0.15 - pv) / max(v - pv, 1e-4), 0.0, 1.0)) / 16.0; break; }
    pv = v;
  }
  var fo = fall;
  if (u.framed != 0u) { fo = vec2f(u.inv0 * fall.x + u.inv2 * fall.y, u.inv1 * fall.x + u.inv3 * fall.y); }
  let wv = u.gullySize;
  let fp = vec2f(lx, ly) + fo * ro.x;
  // The lobes are a smooth field along the foot, a wavelength across, and not the Gullies' stripes: those fork where their phase jumps, which is a
  // branch in a gully and would be a step in a fan.
  var fdeep = clamp(1.0 + 0.85 * vnoise(fp.x / (3.0 * wv), fp.y / (3.0 * wv), u.seed ^ 0x2b91u), 0.2, 1.85);
  if (u.lfVary > 0.0) { fdeep = gullyDeepVaried(fdeep, fp.x, fp.y, wv); }
  let gv = sm(0.0, 1.0, 0.5 + 0.5 * clamp(1.4 * vnoise(fp.x / wv, fp.y / wv, u.seed ^ 0x3d17u), -1.0, 1.0));
  let strength = min(u.gully * fdeep / 0.3, 1.2);          // deeper gullies, a bigger fan; some stretches have next to none
  let apexIn = ro.y * tq;                                   // how far inside the foot the ravine opens
  let len = apexIn + u.talusReach;                          // from the apex to the toe
  let s = apexIn - ro.x;                                    // from the apex, outward
  // The fan's height comes in with the reach (a short reach is a low fan, 0 is none), and is all there once the reach is a good part of the way from
  // the ravine's opening to the foot.
  let top = 0.225 * relief * strength * tanh(u.talusReach / (0.35 * apexIn + 12.0));
  // Across the wall the fans stand on a continuous apron (0.4 of their height), and the share does not change along a fall line: every line then falls
  // outward all the way, so no hollow is shut in between two fans and the wall (a share that widened outward left 155 such cells on the test cliff).
  let across = 0.4 + 0.6 * pow(max(gv, 1e-3), 1.6);
  if (s >= 0.0) { return top * pow(1.0 - clamp(s / len, 0.0, 1.0), 1.5) * across; }
  // Up the ravine the debris lies a little higher, never lower: a fan that thinned out inward stood as a bank along the foot with a hollow behind it.
  // So a ravine's floor and a bay's are filled to the fan's level until the face rises through it.
  return top * across * (1.0 + 0.3 * min(-s / len, 1.0));
}
fn landformTalus(wx: f32, wy: f32, lx: f32, ly: f32, x: i32, y: i32, trunk: u32, share: f32, nA: f32, nB: f32, base: f32, face: f32) -> f32 {
  return max(talusApron(wx, wy, lx, ly, x, y, trunk, share, nA, nB, base, face), talusFan(wx, wy, lx, ly, x, y, trunk, share, nA, nB, base));
}
// Whether a landform's candidate beats the one it holds, by Combine: the higher (Raise to), the lower (Cut to) or the farther from the ground (Flatten to).
fn lfBetter(cand: vec3f, pick: vec3f, seen: bool, base: f32) -> bool {
  if (!seen) { return true; }
  if (u.combine == 0u) { return cand.x > pick.x; }
  if (u.combine == 1u) { return cand.x < pick.x; }
  return abs(cand.x - base) > abs(pick.x - base);
}
// lfcrater: how far past a section's peak (in shares of its half width, toward the path) a rim spur's root fades into the bowl's wall.
const SPUR_INNER = 0.05;

@compute @workgroup_size(8, 8)
fn stampLandform(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
#ifdef PAGES
  let cells = pcells(); let i = lidx(x, y);
#else
  let cells = u.grid * u.grid; let i = u32(y) * u.grid + u32(x);
#endif
  let wx = f32(x) * u.spacing; let wy = f32(y) * u.spacing;
  var lx = wx; var ly = wy;
  if (u.framed != 0u) { lx = u.inv0 * wx + u.inv2 * wy + u.inv4; ly = u.inv1 * wx + u.inv3 * wy + u.inv5; }
  let base = F[PH * cells + i];
  // The variation noise: functions of the position in the shape's frame only (never of a tile or a page), at a few scales; one cell's three values serve every segment.
  var nA = 0.0; var nB = 0.0; var nC = 0.0;
  if (u.lfWander > 0.0 || u.lfWidth > 0.0 || u.lfHeight > 0.0) {
    let sz = max(u.lfSize, 8.0);
    // Broad scallops carry smaller notches on the same outline. The two section weights let the shoulder break up more than the foot, without another control.
    if (u.lfWander > 0.0) { nA = 0.7 * noiseValue(3u, u.seed, lx * 210.0 / sz, ly * 210.0 / sz) + 0.3 * noiseValue(2u, u.seed, lx * 210.0 / sz, ly * 210.0 / sz); if (u.lfVary > 0.0) { nA = wanderVaried(nA, lx, ly); } }
    if (u.lfWidth > 0.0) { nB = noiseValue(5u, u.seed, lx * 210.0 / sz, ly * 210.0 / sz); }
    if (u.lfHeight > 0.0) { nC = lfFractal(lx / sz + 37.1, ly / sz - 19.7, 0x5c9u); }
  }
  var nearest = 3.0e38; var trunk = 0xffffffffu;
  var pick = vec3f(base, 0.0, 0.0); var seen = false; var pk = 0u; var psh = 0.0;
  var land = vec3f(base, 0.0, 0.0);
  var spr = vec3f(base, 0.0, 0.0); var sk = 0u;   // lfcrater: the strongest rim spur at the cell (sk its segment), merged with the section below
  var tShare = 0.0;
  for (var k = 0u; k < u.nseg; k++) {
    let bx = bitcast<vec4<i32>>(Seg[(u.segBase + k) * 4u + 3u]);
    if (x < bx.x || x > bx.z || y < bx.y || y > bx.w) { continue; }
    let s0 = Seg[(u.segBase + k) * 4u]; let s1 = Seg[(u.segBase + k) * 4u + 1u]; let s2 = Seg[(u.segBase + k) * 4u + 2u];
    if (s1.z >= 0.0) {
      let dx = s0.z - s0.x; let dy = s0.w - s0.y; let len2 = max(dx * dx + dy * dy, 1e-8);
      let t = clamp(((wx - s0.x) * dx + (wy - s0.y) * dy) / len2, 0.0, 1.0);
      let d2 = (wx - s0.x - dx * t) * (wx - s0.x - dx * t) + (wy - s0.y - dy * t) * (wy - s0.y - dy * t);
      if (d2 < nearest) { nearest = d2; trunk = k; }
      continue;
    }
    let cand = lfEval(s0, s1, s2, wx, wy, base, nA, nB, nC, 0.0, x, y, i, cells);
    if (cand.y <= 0.0) { continue; }
    if (k == 0u && u.grooveEnd != 0.0) { land = cand; continue; }   // an impact's landing meets the groove below
    if (u.lfPeak > 0.0 && s1.x == 0.0) { if (spr.y <= 0.0 || abs(cand.x - base) > abs(spr.x - base)) { spr = cand; sk = k; } continue; }
    if (lfBetter(cand, pick, seen, base)) { pick = cand; seen = true; pk = k; psh = 0.0; }
  }
  if (trunk != 0xffffffffu) {
    // The cell's place along the path. On the inside of a bend the nearest point jumps from one segment to the next, so the place is blended over the
    // segments nearly as near (within a band of half the distance) and the crest's height along the path meets itself with no seam. The band ends before
    // the reach, inside every segment's box, so no box cuts a weight off.
    let dn = sqrt(nearest); let wmax = max(u.lfFoot, u.lfMid);
    let band = min(max(4.0, 0.5 * dn), max(u.lfFront, u.lfBack) * exp(1.35 * u.lfWidth * wmax) + u.lfWander * wmax - dn);
    var sw = 0.0; var ss = 0.0;
    for (var k = 0u; k < u.nseg; k++) {
      let bx = bitcast<vec4<i32>>(Seg[(u.segBase + k) * 4u + 3u]);
      if (x < bx.x || x > bx.z || y < bx.y || y > bx.w) { continue; }
      let s0 = Seg[(u.segBase + k) * 4u]; let s1 = Seg[(u.segBase + k) * 4u + 1u];
      if (s1.z < 0.0) { continue; }
      let dx = s0.z - s0.x; let dy = s0.w - s0.y; let len2 = max(dx * dx + dy * dy, 1e-8);
      let t = clamp(((wx - s0.x) * dx + (wy - s0.y) * dy) / len2, 0.0, 1.0);
      var w = 1.0;
      if (k != trunk) {
        if (band <= 0.0) { continue; }
        let f = 1.0 - (sqrt((wx - s0.x - dx * t) * (wx - s0.x - dx * t) + (wy - s0.y - dy * t) * (wy - s0.y - dy * t)) - dn) / band;
        if (f <= 0.0) { continue; }
        w = f * f;
      }
      sw += w; ss += w * clamp((s1.x + t * s1.y) / max(s1.z, 1e-4), 0.0, 1.0);
    }
    tShare = ss / sw;
    var cand = lfEval(Seg[(u.segBase + trunk) * 4u], Seg[(u.segBase + trunk) * 4u + 1u], Seg[(u.segBase + trunk) * 4u + 2u], wx, wy, base, nA, nB, nC, ss / sw, x, y, i, cells);
    // An impact's landing and its groove are one shape: where both cover the cell, the deeper of their cuts below the ground and the higher of their rises above
    // it, added (the groove's floor breaches the rim, the bowl stays whole, a raised shape keeps the higher); either alone stands. Each is level with the
    // ground at its foot, so the two meet with no step.
    if (land.y > 0.0) {
      if (cand.y <= 0.0) { cand = land; }
      else { let rc = cand.x - base; let rl = land.x - base; cand = vec3f(base + min(min(rc, 0.0), min(rl, 0.0)) + max(max(rc, 0.0), max(rl, 0.0)), max(cand.y, land.y), cand.z); }
      land = vec3f(base, 0.0, 0.0);
    }
    var ck = trunk; var csh = ss / sw;
    // lfcrater: spurs off a section's peak (a crater's rim) stand on its outer flank, whatever Combine is: there the cell keeps the higher of the two rises in
    // the rim's direction. Past the peak, toward the path (the section's share across, its cover, above u.lfPeak), the section alone holds, so a spur's root
    // never fills the bowl's wall; at the peak the section stands at the rim's height, at or over any spur, so the hand-over meets itself.
    if (spr.y > 0.0) {
      if (cand.y <= 0.0) { cand = spr; ck = sk; csh = 0.0; }
      else {
        let rt = cand.x - base; let rs = spr.x - base;
        let f = 1.0 - sm(u.lfPeak, u.lfPeak + SPUR_INNER, cand.y);
        let rim = curveRaw(u.curveBase, u.lfPeak) * select(u.elev - u.baseH, u.elev, u.lfGround != 0u);   // the section's rise at its peak: the rim's direction
        let wins = select((rs < rt), (rs > rt), rim > 0.0) && f > 0.0;
        cand = vec3f(base + select(rt, mix(rt, rs, f), wins), max(cand.y, spr.y * f), cand.z);
        if (wins && f >= 0.5) { ck = sk; csh = 0.0; }
      }
      spr = vec3f(base, 0.0, 0.0);
    }
    if (cand.y > 0.0 && lfBetter(cand, pick, seen, base)) { pick = cand; seen = true; pk = ck; psh = csh; }
  }
  if (land.y > 0.0 && !seen) { pick = land; seen = true; }   // a landing no groove segment reaches (its box is the trunk's own; kept for safety)
  if (spr.y > 0.0 && lfBetter(spr, pick, seen, base)) { pick = spr; seen = true; pk = sk; psh = 0.0; }   // a rim spur past every trunk segment's box
  // P17: the talus cones, where Gullies cut the faces (the chutes are theirs) and the stroke raises. Beyond the footprint the cone is all there is.
  var talus = 0.0;
  if (u.talusReach > 0.0 && u.gully > 0.0 && u.combine == 0u && trunk != 0xffffffffu) { talus = landformTalus(wx, wy, lx, ly, x, y, trunk, tShare, nA, nB, base, select(0.0, pick.x - base, seen));
    // Talus stays off a route an earlier stroke laid (a ramp drawn before the plateau had scree across its foot).
    talus *= 1.0 - clamp(F[PR * cells + i], 0.0, 1.0); }
  var ej = 0.0; var lipK = 1.0;
  if ((u.ejAmt > 0.0 || u.bkAmt > 0.0) && trunk != 0xffffffffu) { let ev = lfCraterEjecta(wx, wy, select(trunk, 0u, u.grooveEnd != 0.0)); ej = ev.x; lipK = ev.y; }   // an impact's round its landing
  if (!seen) {
    if (talus > 0.0) { F[PH * cells + i] = clamp(base + talus, u.minH, u.maxH); talusGround(i, sm(0.0, 8.0, talus)); claimRock(i); }
    if (ej > 0.0) { F[PH * cells + i] = clamp(F[PH * cells + i] + ej, u.minH, u.maxH); }
    return;
  }
  // Shared shore features seed the actual sea crossings inside this shape, including cuts and joined paths.
  if (u.coPutW != 0u) { Sc[4u * cells + i] = pick.y; }
  var value = pick.x;
  // Coast ramp below 1 (the host sets it on a stroke whose crest is under the sea): the dry part of the section keeps only the last lfCoast of its fall to
  // the waterline (the drop as a share of base - sea), easing off the plain and meeting the water in a bank 1 / lfCoast times as steep; under water it is
  // as drawn. From 1 to .75 the reshaped ramp blends in, so the row moves the coast by degrees from the drawn section.
  if (u.lfCoast < 1.0 && base > u.sea && value > u.sea && value < base) {
    let keep = max(u.lfCoast, 0.02);
    let fx = clamp(((base - value) / (base - u.sea) - (1.0 - keep)) / keep, 0.0, 1.0);
    let ramp = base - fx * fx * (2.0 - fx) * (base - u.sea);
    let blend = min(1.0, (1.0 - keep) / 0.25);
    value = select(mix(value, ramp, blend), ramp, blend >= 1.0);
  }
  if (u.gully > 0.0 && value > base) { value = landformGullies(value, pick.y, pk, psh, wx, wy, lx, ly, base, nA, nB, nC, x, y, i, cells); }
  if (u.bedN >= 1.0 && u.bedSoft > 0.0 && u.combine == 0u && value > base) { value = hardBeds(value, base, pick.x, pick.y, lx, ly); }
  var scree = 0.0;   // how far the talus covers the cell: loose ground takes no cracks
  if (talus > 0.0) { scree = sm(0.0, 8.0, base + talus - value); talusGround(i, scree); value = max(value, base + talus); claimRock(i); }
  if (u.combine == 0u) { value = max(base, value); } else if (u.combine == 1u) { value = min(base, value); }
  F[PH * cells + i] = clamp(value, u.minH, u.maxH);
  if (ej > 0.0 || lipK < 1.0) { F[PH * cells + i] = clamp(select(value, base + (value - base) * lipK, value > base) + ej, u.minH, u.maxH); }
  // P28 point bar: its sand goes to the cover plane, as a Sand brush's does, and draws through the painted-sand path.
  if (pick.z > 0.0) { let vb = F[PV * cells + i]; F[PV * cells + i] = vb + (1.0 - vb) * pick.z; }
  // The braided bed (riverfix): its share also marks the bed plane (mask 19), where the draw lays the world's river-bed gravel over the sand, and BR_PEBBLES of
  // it the scatter density (mask 4, as painted denser scatter), so the loose-stone scatter lays pebbles there; each keeps the larger of what was there and the bed's.
  if (u.lfBraid > 0.0 && pick.z > 0.0) {
    maskSet(i, 19u, max(maskGet(i, 19u), i32(round(127.0 * clamp(pick.z, 0.0, 1.0)))));
    maskSet(i, 4u, max(maskGet(i, 4u), i32(round(127.0 * BR_PEBBLES * clamp(pick.z, 0.0, 1.0)))));
  }
  // The influence: how much of the section the cell stands in, where the stroke moved the height (a unit or more is all of it). Masks, routes, protection and
  // cracks follow as a plateau's do.
  let inf = pick.y * clamp(abs(value - base), 0.0, 1.0);
  // A route is a shared field, not a draw/bake mode. It also works on already-level ground, where there is no height-change influence.
  let route = u.lfRoute * sm(0.30, 0.92, pick.y);
  F[PR * cells + i] = max(F[PR * cells + i] * (1.0 - inf), route);
  F[PP * cells + i] = max(max(F[PP * cells + i] * (1.0 - inf), sm(0.65, 0.95, inf)), u.lfRoute * sm(0.55, 0.92, pick.y));
  if (inf <= 0.0) { return; }
  // Ground edge: over the outer part of the section the stroke lays its ground material only where a scalloped noise lets it, so the material's
  // edge breaks into lobes and specks instead of a line (0: everywhere the stroke moves the height).
  let groundCut = u.lfGroundEdge > 0.0 && pick.y < u.lfGroundEdge * clamp(0.5 + 0.38 * vnoise(wx / 46.0, wy / 46.0, u.seed ^ 0x3e1du) + 0.2 * vnoise(wx / 7.0, wy / 7.0, u.seed ^ 0x77a1u), 0.02, 1.0);
  if (u.nwrites > 0u) { shapeMasks(i, inf, groundCut); }
  if (u.crackAmt > 0.0) { F[PC * cells + i] = max(F[PC * cells + i], min(1.0, inf * 1.6) * u.crackAmt * (1.0 - scree)); }
}

// H6c smooth: the prefix height of the cells the box blur will read, copied to scratch plane 0 (blurH and blurV then run on it with blurR = the node's radius).
@compute @workgroup_size(8, 8)
fn smoothCopy(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
#ifdef PAGES
  let cells = pcells(); let i = lidx(x, y);
#else
  let n = u.grid; let cells = n * n; let i = u32(y) * n + u32(x);
#endif
  Sc[i] = F[PH * cells + i];
}

// H6c fissure: fissureCell() of sculpt.js over the pieces the host lists (a = s0.xy, b = s0.zw; width multipliers r0 r1 in s1.xy, depth multipliers h0 h1 in s1.zw).
// Every piece raises the crack field beside its cut; the deepest cut (the first on a tie) sets height, protection, routes and the wet-mask write.
fn fissureProfile(d: f32, hw: f32, cellPx: f32) -> f32 {
  let lo = 0.75 * cellPx; let q = (d - lo) / max(hw - lo, 0.35 * cellPx);
  if (q <= 0.0) { return 1.0; }
  if (q >= 1.0) { return 0.0; }
  return (1.0 - q) * sqrt(1.0 - q);
}
@compute @workgroup_size(8, 8)
fn stampFissure(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
#ifdef PAGES
  let cells = pcells(); let i = lidx(x, y);
#else
  let n = u.grid; let cells = n * n; let i = u32(y) * n + u32(x);
#endif
  let wx = f32(x) * u.spacing; let wy = f32(y) * u.spacing;
  var lx = wx; var ly = wy;
  if (u.framed != 0u) { lx = u.inv0 * wx + u.inv2 * wy + u.inv4; ly = u.inv1 * wx + u.inv3 * wy + u.inv5; }
  let seed = u.seed; let jag = u.fJag; let net = u.fNet != 0.0;
  var bestG = 0.0; var crackV = 0.0;
  for (var k = 0u; k < u.nseg; k++) {
    let s0 = Seg[(u.segBase + k) * 4u]; let s1 = Seg[(u.segBase + k) * 4u + 1u];
    let bx = bitcast<vec4<i32>>(Seg[(u.segBase + k) * 4u + 3u]);
    if (x < bx.x || x > bx.z || y < bx.y || y > bx.w) { continue; }
    let px = s0.x; let py = s0.y; let sx = s0.z - px; let sy = s0.w - py; let span2 = sx * sx + sy * sy;
    var t = 0.0;
    if (span2 > 0.0) { t = clamp(((wx - px) * sx + (wy - py) * sy) / span2, 0.0, 1.0); }
    let cx = px + sx * t; let cy = py + sy * t;
    var gv = 0.0; var near = 0.0;
    if (net) {
      let C = u.fCell;
      let wxp = lx + C * 0.14 * vnoise(lx / (C * 0.9), ly / (C * 0.9), seed ^ 0x2e1u);
      let wyp = ly + C * 0.14 * vnoise(lx / (C * 0.9), ly / (C * 0.9), seed ^ 0x4d7u);
      let ix = i32(floor(wxp / C)); let iy = i32(floor(wyp / C));
      var d1 = 1.0e30; var d2 = 1.0e30; var x1 = 0.0; var y1 = 0.0; var x2 = 0.0; var y2 = 0.0;
      for (var j = -1; j <= 1; j++) { for (var m = -1; m <= 1; m++) {
        let cxs = ix + m; let cys = iy + j;
        let qx = (f32(cxs) + 0.5 + 0.42 * hashi(cxs, cys, seed ^ 0x61u)) * C; let qy = (f32(cys) + 0.5 + 0.42 * hashi(cxs, cys, seed ^ 0x93u)) * C;
        let dd = (wxp - qx) * (wxp - qx) + (wyp - qy) * (wyp - qy);
        if (dd < d1) { d2 = d1; x2 = x1; y2 = y1; d1 = dd; x1 = qx; y1 = qy; } else if (dd < d2) { d2 = dd; x2 = qx; y2 = qy; }
      } }
      let e = (d2 - d1) / (2.0 * max(sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1)), 1e-3));
      let hw = u.fHw; let reg = 1.0 - sm(0.55, 1.0, sqrt((wx - cx) * (wx - cx) + (wy - cy) * (wy - cy)) / u.radius);
      let vary = 0.65 + 0.35 * vnoise(lx / (C * 0.5), ly / (C * 0.5), seed ^ 0x7a9u);
      let wob = 1.0 + jag * 0.5 * vnoise(lx / 9.0, ly / 9.0, seed ^ 0x1f3u);
      gv = fissureProfile(e, hw * wob, u.spacing) * vary * reg; near = (1.0 - sm(0.0, 1.0, e / (hw * 3.0 + 3.0))) * reg;
    } else {
      let rm = s1.x + (s1.y - s1.x) * t; let hm = s1.z + (s1.w - s1.z) * t; let hw = u.fHw * u.fKf * rm;
      var dx = wx - cx; var dy = wy - cy;
      if (jag > 0.0) {
        dx = dx + u.fAmp * (0.7 * vnoise(lx / 23.0, ly / 23.0, seed ^ 0x5a1u) + 0.5 * vnoise(lx / 9.0, ly / 9.0, seed ^ 0x3c7u));
        dy = dy + u.fAmp * (0.7 * vnoise(lx / 23.0, ly / 23.0, seed ^ 0x6b5u) + 0.5 * vnoise(lx / 9.0, ly / 9.0, seed ^ 0x2d3u));
      }
      let d = sqrt(dx * dx + dy * dy);
      gv = fissureProfile(d, hw, u.spacing) * hm * (1.0 - 0.5 * jag * (0.5 - 0.5 * vnoise(lx / 17.0, ly / 17.0, seed ^ 0x7e1u)));
      near = 1.0 - sm(0.0, 1.0, d / (hw * 3.0 + 3.0));
    }
    if (near > 0.0 && u.fCrack > 0.0) { crackV = max(crackV, u.fCrack * near); }
    if (gv <= bestG) { continue; }
    bestG = gv;
  }
  if (crackV > 0.0) { F[PC * cells + i] = max(F[PC * cells + i], crackV); }
  if (bestG <= 0.0) { return; }
  let base = F[PH * cells + i];
  let cut = base - u.amount * bestG;
  F[PH * cells + i] = clamp(select(cut, max(cut, u.sea + 1.5), base > u.sea + 1.0), u.minH, u.maxH);
  let sw = sm(0.0, 0.3, bestG);
  F[PP * cells + i] = F[PP * cells + i] * (1.0 - sw);
  F[PR * cells + i] = F[PR * cells + i] * (1.0 - sw);
  for (var m = 0u; m < u.nwrites; m++) {
    let mw = MW[u.mwBase + m]; let pl = u32(mw.x); let b = f32(maskGet(i, pl));
    maskSet(i, pl, i32(floor(b + (mw.y - b) * (sw * u.fDark) * mw.z + 0.5)));
  }
}

// ---- H10: the coast pass (Lava's shore layers and fingers) ----
// The coast planes live in the scratch buffer Sc after the hill's three planes (see CB..CFF). Every pass below runs over the node's coast box (the
// region the host gives it: the footprint grown by the coast's reach), one thread per cell, reading only its own cells of the planes a previous pass
// finished, so a repeat run is identical. Distances are world px, so the same passes serve every resolution.
const CB = 3u; const CW = 4u; const CPX = 5u; const CPY = 6u; const CQX = 7u; const CQY = 8u; const CDD = 9u; const CSS = 10u; const CRR = 11u; const CUU = 12u; const CFF = 13u;
const CNPL = 14u;

fn cIdx(x: i32, y: i32) -> u32 {
#ifdef PAGES
  return lidx(x, y);
#else
  return u32(y) * u.grid + u32(x);
#endif
}
fn cCells() -> u32 {
#ifdef PAGES
  return pcells();
#else
  return u.grid * u.grid;
#endif
}
fn cInBox(x: i32, y: i32) -> bool { return x >= u.rx0 && x <= u.rx1 && y >= u.ry0 && y <= u.ry1; }

// Before the node's stamp: the prefix height (B) over the box, and no footprint (W), no finger marks.
@compute @workgroup_size(8, 8)
fn coastInit(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
  let cells = cCells(); let i = cIdx(x, y);
  Sc[CB * cells + i] = F[PH * cells + i];
  Sc[CW * cells + i] = 0.0; Sc[CUU * cells + i] = 0.0; Sc[CFF * cells + i] = 0.0;
}

// The nearest crossing of the sea (a point where the height meets the sea level along a grid edge) among the cell's four edges. A crossing needs the
// footprint on one side at least; with coMoved, one side must also have changed side of the sea since the prefix (an older lake's coast under this
// stroke's bank is that stroke's to shape). Also snapshots the heights the field was computed from (R).
@compute @workgroup_size(8, 8)
fn coastSeed(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
  let cells = cCells(); let i = cIdx(x, y); let sea = u.sea;
  let hi = F[PH * cells + i];
  Sc[CRR * cells + i] = hi;
  let wx = f32(x) * u.spacing; let wy = f32(y) * u.spacing;
  var bd = 3.0e38; var bp = vec2f(-1.0e9, -1.0e9);
  let wi = Sc[CW * cells + i]; let bi = Sc[CB * cells + i];
  for (var k = 0; k < 4; k++) {
    let ddx = select(0, 1, k == 0) + select(0, -1, k == 1); let ddy = select(0, 1, k == 2) + select(0, -1, k == 3);
    let jx = x + ddx; let jy = y + ddy;
    if (!cInBox(jx, jy)) { continue; }
    let j = cIdx(jx, jy);
    let hj = F[PH * cells + j];
    if ((hi > sea) == (hj > sea)) { continue; }
    if (wi <= 0.0 && Sc[CW * cells + j] <= 0.0) { continue; }
    if (u.coMoved != 0u && (bi > sea) == (hi > sea) && (Sc[CB * cells + j] > sea) == (hj > sea)) { continue; }
    let t = abs(hi - sea) / max(1.0e-6, abs(hi - hj));
    let p = vec2f(wx + f32(ddx) * t * u.spacing, wy + f32(ddy) * t * u.spacing);
    let d2 = dot(p - vec2f(wx, wy), p - vec2f(wx, wy));
    if (d2 < bd) { bd = d2; bp = p; }
  }
  let dst = select(CPX, CQX, u.coSrc != 0u);
  Sc[dst * cells + i] = bp.x; Sc[(dst + 1u) * cells + i] = bp.y;
}

// One jump of the flood: coSrc selects the source pair of planes (0: P, 1: Q); the result goes to the other pair. A strict < keeps the first of equal candidates.
@compute @workgroup_size(8, 8)
fn coastJump(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
  let cells = cCells(); let i = cIdx(x, y);
  let sx = select(CPX, CQX, u.coSrc != 0u); let dx0 = select(CQX, CPX, u.coSrc != 0u);
  let me = vec2f(f32(x) * u.spacing, f32(y) * u.spacing);
  var bd = 3.0e38; var bp = vec2f(-1.0e9, -1.0e9);
  for (var oy = -1; oy <= 1; oy++) { for (var ox = -1; ox <= 1; ox++) {
    let nx = x + ox * u.coStep; let ny = y + oy * u.coStep;
    if (!cInBox(nx, ny)) { continue; }
    let j = cIdx(nx, ny);
    let p = vec2f(Sc[sx * cells + j], Sc[(sx + 1u) * cells + j]);
    if (p.x < -1.0e8) { continue; }
    let d2 = dot(p - me, p - me);
    if (d2 < bd) { bd = d2; bp = p; }
  } }
  Sc[dx0 * cells + i] = bp.x; Sc[(dx0 + 1u) * cells + i] = bp.y;
}

// D: the distance to that point (world px), or the far value where no crossing came.
@compute @workgroup_size(8, 8)
fn coastFinish(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
  let cells = cCells(); let i = cIdx(x, y);
  let sx = select(CPX, CQX, u.coSrc != 0u);
  let p = vec2f(Sc[sx * cells + i], Sc[(sx + 1u) * cells + i]);
  var d = u.coFar;
  if (p.x > -1.0e8) { d = length(p - vec2f(f32(x) * u.spacing, f32(y) * u.spacing)); }
  Sc[CDD * cells + i] = d;
}

// The signed distance (positive on dry ground) into plane P.x, ready for the blur.
@compute @workgroup_size(8, 8)
fn coastSd(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
  let cells = cCells(); let i = cIdx(x, y);
  let d = Sc[CDD * cells + i];
  Sc[CPX * cells + i] = select(-d, d, Sc[CRR * cells + i] > u.sea);
}
// blurredBox: a box blur of radius blurR from plane bsrc to bdst, clamped at the box edge (the pass region).
@compute @workgroup_size(8, 8)
fn coastBlurH(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
  let cells = cCells(); var sum = 0.0; let rr = i32(u.blurR);
  for (var k = -rr; k <= rr; k++) { sum = sum + Sc[u.bsrc * cells + cIdx(clamp(x + k, u.rx0, u.rx1), y)]; }
  Sc[u.bdst * cells + cIdx(x, y)] = sum / f32(2 * rr + 1);
}
@compute @workgroup_size(8, 8)
fn coastBlurV(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
  let cells = cCells(); var sum = 0.0; let rr = i32(u.blurR);
  for (var k = -rr; k <= rr; k++) { sum = sum + Sc[u.bsrc * cells + cIdx(x, clamp(y + k, u.ry0, u.ry1))]; }
  Sc[u.bdst * cells + cIdx(x, y)] = sum / f32(2 * rr + 1);
}

// Debug and checks: one scratch plane (bsrc) over the rectangle into Out, as floats.
@compute @workgroup_size(256)
fn packPlane(@builtin(global_invocation_id) g: vec3u, @builtin(num_workgroups) ng: vec3u) {
  let j = g.y * (ng.x * 256u) + g.x;
  let w = u32(u.rx1 - u.rx0 + 1); let h = u32(u.ry1 - u.ry0 + 1);
  if (j >= w * h) { return; }
  let cx = i32(u.rx0) + i32(j % w); let cy = i32(u.ry0) + i32(j / w);
  Out[j] = bitcast<u32>(Sc[u.bsrc * cCells() + cIdx(cx, cy)]);
}

// ---- coast fingers ----
// Thumb fingers (retail lava-1: tendrils and stubs in clusters, tapering to a round tip, now and then forked): one per jittered lattice site in the shape's
// frame; the coast point at tangent offset tau from a site's axis reaches the finger's outline. Everything about a finger comes from its site's hashes.
const THUMB_CELL = 44.0;
const THUMB_SPREAD = 0.5;   // how much a cluster's noise raises a site's chance of a finger
const THUMB_AMOUNT = 1.4;   // H24: the share of lattice sites that grow one, the same on every world
fn uhash(i: i32, j: i32, salt: u32, k: u32) -> f32 { return hashi(i, j, salt ^ k) * 0.5 + 0.5; }
fn thumbAt(lx: f32, ly: f32, nx: f32, ny: f32, amount: f32) -> f32 {
  let tx = -ny; let ty = nx; let salt = u.seed;
  let ci = i32(floor(lx / THUMB_CELL)); let cj = i32(floor(ly / THUMB_CELL));
  var best = 0.0;
  let size = u.cfSize;
  for (var j = cj - 1; j <= cj + 1; j++) { for (var i = ci - 1; i <= ci + 1; i++) {
    let ax = (f32(i) + 0.5 + 0.45 * hashi(i, j, salt ^ 0x5a7u)) * THUMB_CELL;
    let ay = (f32(j) + 0.5 + 0.45 * hashi(i, j, salt ^ 0x1d3u)) * THUMB_CELL;
    // Lobe variety (cfVary): sites gather in clusters, and a few grow long, wide lobes and spits among many small ones (0: the even comb).
    let cluster = mix(1.0, 0.55 + 0.9 * (vnoise(ax / 260.0, ay / 260.0, salt ^ 0x7c3u) * 0.5 + 0.5), u.cfVary);
    let chance = clamp((0.7 + 1.5 * THUMB_SPREAD * vnoise(ax / 130.0, ay / 130.0, salt ^ 0x1f3u)) * THUMB_AMOUNT * cluster, 0.04, 0.97);
    if (uhash(i, j, salt, 0x31fu) >= chance) { continue; }
    // Only sites within half a cell of the coast along its normal grow a finger here.
    if (abs((lx - ax) * nx + (ly - ay) * ny) >= THUMB_CELL * 0.5) { continue; }
    let grow = mix(1.0, 0.35 + 2.6 * pow(uhash(i, j, salt, 0x9d1u), 3.0), u.cfVary);
    let L = amount * 52.0 * (0.3 + 2.0 * pow(uhash(i, j, salt, 0x4e5u), 2.4)) * size * grow;
    let fork = L > 40.0 * amount * size && L < 95.0 * amount * size && uhash(i, j, salt, 0x2c9u) > 0.8;
    var h0 = clamp(5.0 + 0.15 * L / max(amount, 0.2) + (uhash(i, j, salt, 0x6b1u) - 0.5) * 6.0, 7.0, 24.0) * min(1.0, 0.4 + amount * 0.6) * mix(1.0, 0.7 + 0.5 * min(grow, 1.6), u.cfVary);
    if (fork) { h0 = clamp(h0 * 1.3, 16.0, 26.0); }
    let tau = abs((lx - ax) * tx + (ly - ay) * ty);
    if (tau >= h0) { continue; }
    let ht = max(4.5, 0.8 * h0); let Ls = max(L - ht, 0.0);
    let sh = (tau - ht) / (h0 - ht);
    var r = Ls + sqrt(max(ht * ht - tau * tau, 0.0));
    if (tau > ht) { r = Ls * (1.0 - sh * sh); }
    if (fork && r > 0.5 * L) { let wn = 0.42 * h0; if (tau < wn) { r = min(r, 0.5 * L + (r - 0.5 * L) * tau / wn); } }
    best = max(best, r);
  } }
  return best + vnoise(lx / 12.0, ly / 12.0, salt ^ 0x5c1u) * 1.6;
}
// thumbReach: the world position and inland normal go into the shape's frame; the lattice is turned 26 degrees off the axes.
fn thumbReach(wx: f32, wy: f32, nx: f32, ny: f32, amount: f32) -> f32 {
  var lx = wx; var ly = wy; var mx = nx; var my = ny;
  if (u.framed != 0u) {
    lx = u.inv0 * wx + u.inv2 * wy + u.inv4; ly = u.inv1 * wx + u.inv3 * wy + u.inv5;
    mx = u.inv0 * nx + u.inv2 * ny; my = u.inv1 * nx + u.inv3 * ny;
    var ml = sqrt(mx * mx + my * my); if (ml == 0.0) { ml = 1.0; }
    mx = mx / ml; my = my / ml;
  }
  let ca = 0.8988; let sa = 0.4384;
  return thumbAt(ca * lx + sa * ly, -sa * lx + ca * ly, ca * mx + sa * my, -sa * mx + ca * my, amount);
}
// The inland unit normal at a cell: the gradient of the blurred signed distance (plane CSS), clamped at the box.
fn coastNormal(x: i32, y: i32, cells: u32) -> vec3f {
  let gx = Sc[CSS * cells + cIdx(min(x + 1, u.rx1), y)] - Sc[CSS * cells + cIdx(max(x - 1, u.rx0), y)];
  let gy = Sc[CSS * cells + cIdx(x, min(y + 1, u.ry1))] - Sc[CSS * cells + cIdx(x, max(y - 1, u.ry0))];
  let len = sqrt(gx * gx + gy * gy);
  if (len < 1.0e-3) { return vec3f(0.0, 0.0, 0.0); }
  return vec3f(gx / len, gy / len, 1.0);
}
// H24: the height (units above the sea) of a finger's flat top, the same on every world.
const FINGER_LOW = 3.5;
// At each cell near the coast the finger field is read at the nearest coast point (back along the normal) and the cell is raised to a flat tongue (or
// sunk, for an inlet). U marks the raised cells for the connectivity march; F keeps a flat finger's height for the layers.
@compute @workgroup_size(8, 8)
fn coastFinger(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
  let cells = cCells(); let i = cIdx(x, y); let sea = u.sea;
  let dist = Sc[CDD * cells + i];
  if (dist > u.coLimit) { return; }
  let nm = coastNormal(x, y, cells);
  if (nm.z == 0.0) { return; }
  let sd = select(-dist, dist, Sc[CRR * cells + i] > sea);
  let wx = f32(x) * u.spacing; let wy = f32(y) * u.spacing;
  let f = clamp(thumbReach(wx - sd * nm.x, wy - sd * nm.y, nm.x, nm.y, u.coFAmt), -u.coFReach, u.coFReach);
  if (sd < 0.0 && -sd < f) {
    F[PH * cells + i] = clamp(sea + FINGER_LOW, u.minH, u.maxH);
    claimRock(i);
    Sc[CUU * cells + i] = 1.0;
    Sc[CFF * cells + i] = FINGER_LOW;
  } else if (sd > 0.0 && sd < -f) {
    F[PH * cells + i] = clamp(sea - 0.5 - 2.5 * (1.0 - sd / -f), u.minH, u.maxH);
    claimRock(i);
  }
}
// A tongue is land joined to land. Instead of flooding out from the old dry ground, a raised cell marches back along its normal toward the coast and keeps
// its height only if it reaches ground that was dry before the fingers by way of raised cells alone (a finger is one prism from the coast to its tip).
@compute @workgroup_size(8, 8)
fn coastJoin(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
  let cells = cCells(); let i = cIdx(x, y); let sea = u.sea;
  if (Sc[CUU * cells + i] == 0.0) { return; }
  let nm = coastNormal(x, y, cells);
  var ok = false;
  if (nm.z != 0.0) {
    let reachPx = Sc[CDD * cells + i] + 2.0 * u.spacing;
    let step = 0.5 * u.spacing; let steps = i32(ceil(reachPx / step));
    let p0 = vec2f(f32(x), f32(y));
    for (var k = 1; k <= steps; k++) {
      let p = p0 + vec2f(nm.x, nm.y) * (f32(k) * step / u.spacing);
      // The four cells round the sample: dry old ground among them joins the finger; none raised or dry ends the march.
      let fx = i32(floor(p.x)); let fy = i32(floor(p.y));
      var any = false;
      for (var q = 0; q < 4; q++) {
        let cx = fx + (q & 1); let cy = fy + (q >> 1);
        if (!cInBox(cx, cy)) { continue; }
        let j = cIdx(cx, cy);
        if (Sc[CRR * cells + j] > sea) { ok = true; break; }
        if (Sc[CUU * cells + j] != 0.0) { any = true; }
      }
      if (ok || !any) { break; }
    }
  }
  if (!ok) { F[PH * cells + i] = Sc[CRR * cells + i]; Sc[CFF * cells + i] = 0.0; }
}

// ---- shore layers ----
// Circular layers: the bites. One thread per jittered lattice site (in the shape's frame); a bite is kept only if it straddles the waterline. A site is four
// floats at the end of the scratch buffer: world x, world y, radius (negative: none), spacing factor.
@compute @workgroup_size(8, 8)
fn coastSites(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= u.coSNI || g.y >= u.coSNJ) { return; }
  let i = u.coSI0 + i32(g.x); let j = u.coSJ0 + i32(g.y);
  let cells = cCells(); let salt = u.seed; let cv = u.coCV; let C = u.coRc * 1.3;
  let at = (CNPL * cells + (g.y * u.coSNI + g.x) * 4u);
  Sc[at + 2u] = -1.0;
  if (hashi(i, j, salt ^ 0x91du) < -0.55 + 0.45 * cv) { return; }
  let lx = (f32(i) + 0.5 + 0.4 * hashi(i, j, salt ^ 0x13bu)) * C; let ly = (f32(j) + 0.5 + 0.4 * hashi(i, j, salt ^ 0x5c9u)) * C;
  var wx = lx; var wy = ly;
  if (u.framed != 0u) {
    // the frame's inverse of inv: the forward transform
    let det = u.inv0 * u.inv3 - u.inv1 * u.inv2;
    let a = u.inv3 / det; let b = -u.inv1 / det; let c = -u.inv2 / det; let d = u.inv0 / det;
    let e = -(a * u.inv4 + c * u.inv5); let f = -(b * u.inv4 + d * u.inv5);
    wx = a * lx + c * ly + e; wy = b * lx + d * ly + f;
  }
  let gx = i32(floor(wx / u.spacing + 0.5)); let gy = i32(floor(wy / u.spacing + 0.5));
  if (gx < u.coBx0 || gx > u.coBx1 || gy < u.coBy0 || gy > u.coBy1) { return; }
  let u0 = hashi(i, j, salt ^ 0x77fu) * 0.5 + 0.5; let k = cIdx(gx, gy);
  let dk = Sc[CDD * cells + k]; let sd = select(-dk, dk, Sc[CRR * cells + k] > u.sea);
  let r = u.coRc * ((0.4 + pow(u0, 1.3)) * (1.0 - cv) + (0.3 + 1.2 * u0 * u0) * cv);
  let sc = 1.0 - cv + cv * (0.55 + 0.9 * (hashi(i, j, salt ^ 0x2c1u) * 0.5 + 0.5));
  if (sd < -0.5 * r || sd > 0.8 * r) { return; }
  Sc[at] = wx; Sc[at + 1u] = wy; Sc[at + 2u] = r; Sc[at + 3u] = sc;
}
// L2: Layer edge jag. Before the layers, the land's distance from the coast zigzags by up to coJag px in runs of about 8 px (position-only noise in
// the shape's frame), so each riser, wherever it lies, is ragged on its own; the waterline itself stays (the jag grows in over 2 jags from it). Run only
// when the stroke's jag is above 0, so the layers' own arithmetic is untouched without it.
@compute @workgroup_size(8, 8)
fn coastJag(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
  let cells = cCells(); let i = cIdx(x, y);
  if (!(Sc[CRR * cells + i] > u.sea)) { return; }
  let d = Sc[CDD * cells + i];
  if (d >= u.coLReach) { return; }
  let wx = f32(x) * u.spacing; let wy = f32(y) * u.spacing;
  var lx = wx; var ly = wy;
  if (u.framed != 0u) { lx = u.inv0 * wx + u.inv2 * wy + u.inv4; ly = u.inv1 * wx + u.inv3 * wy + u.inv5; }
  let jag = u.coJag * (0.75 * vnoise(lx / 8.0, ly / 8.0, u.seed ^ 0x6b5u) + 0.25 * vnoise(lx / 5.0, ly / 5.0, u.seed ^ 0x1e7u));
  Sc[CDD * cells + i] = max(0.0, d + jag * sm(0.0, 2.0 * u.coJag, d));
}
// The land's height as a staircase in the distance from the coast (or, scalloped, from the nearest bite's edge), the layers' edges wandering with
// position-only noise in the shape's frame. Layer k tops out at sea + foot + riser k; the last riser meets the plain. Weights (varied risers) are the
// node's mask-write records after its own writes: x the riser's height weight, y the height below it (both in risers).
@compute @workgroup_size(8, 8)
fn coastLayers(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
  let cells = cCells(); let i = cIdx(x, y); let sea = u.sea;
  let raw = Sc[CRR * cells + i];
  if (!(raw > sea)) { return; }
  let d = Sc[CDD * cells + i]; let base = Sc[CB * cells + i];
  let W = u.coW; let vary = u.coVary; let n = i32(u.coN); let salt = u.seed;
  let rise = u.baseH - sea; let foot = min(6.0, 0.3 * rise); var riser = u.coRiser;
  if (riser <= 0.0) { riser = (rise - foot) / f32(n); }
  if (d >= u.coLReach) { if (Sc[CW * cells + i] > 0.0 && raw < base) { F[PH * cells + i] = base; } return; }
  let wx = f32(x) * u.spacing; let wy = f32(y) * u.spacing;
  var lx = wx; var ly = wy;
  if (u.framed != 0u) { lx = u.inv0 * wx + u.inv2 * wy + u.inv4; ly = u.inv1 * wx + u.inv3 * wy + u.inv5; }
  let scal = u.coScal != 0u;
  let ledge = clamp(u.coLedge + u.coIrr * 0.3 * vnoise(lx / 33.0, ly / 33.0, salt ^ 0x2b1u), 0.3, 0.95);
  var dd = d;
  if (scal) {
    let C = u.coRc * 1.3; let rs = u.coRs;
    let ia = max(i32(floor((lx - rs) / C)), u.coSI0); let ib = min(i32(floor((lx + rs) / C)), u.coSI0 + i32(u.coSNI) - 1);
    let ja = max(i32(floor((ly - rs) / C)), u.coSJ0); let jb = min(i32(floor((ly + rs) / C)), u.coSJ0 + i32(u.coSNJ) - 1);
    for (var j = ja; j <= jb; j++) { for (var ii = ia; ii <= ib; ii++) {
      let at = CNPL * cells + (u32(j - u.coSJ0) * u.coSNI + u32(ii - u.coSI0)) * 4u;
      let r = Sc[at + 2u];
      if (r < 0.0) { continue; }
      dd = min(dd, (length(vec2f(wx - Sc[at], wy - Sc[at + 1u])) - r) / Sc[at + 3u]);
    } }
    dd = max(0.0, dd);
  }
  let wob = u.coIrr * select(1.0, 0.4, scal) * (0.55 * vnoise(lx / 42.0, ly / 42.0, salt ^ 0x7a1u) + 0.25 * vnoise(lx / 14.0, ly / 14.0, salt ^ 0x3c5u) + 0.12 * vnoise(lx / 6.0, ly / 6.0, salt ^ 0x5e3u));
  var Wl = W;
  if (vary > 0.0 || u.coSpread > 0.0) { Wl = W * exp((0.5 * vary + 0.5 * u.coSpread) * vnoise(lx / 75.0, ly / 75.0, salt ^ 0x91fu)); }
  var meanderQ = 0.0;
  if (u.coMeander > 0.0 && !scal) {
    meanderQ = u.coMeander * (0.55 * vnoise(lx / (3.6 * W), ly / (3.6 * W), salt ^ 0x1d7u) + 0.35 * vnoise(lx / (1.6 * W), ly / (1.6 * W), salt ^ 0x4c3u) + 0.2 * vnoise(lx / (0.7 * W), ly / (0.7 * W), salt ^ 0x2f9u));
  }
  var extraQ = 0.0;
  if (vary > 0.0) { extraQ = vary * (0.4 * vnoise(lx / 17.0, ly / 17.0, salt ^ 0x6d3u) + 0.2 * vnoise(lx / 8.0, ly / 8.0, salt ^ 0x4e1u)); }
  let q = max(0.0, dd / Wl + wob + meanderQ + extraQ);
  if (q >= f32(n) + select(0.0, 1.0, vary > 0.0)) { if (raw < base) { F[PH * cells + i] = base; } return; }
  var level = 0.0;
  if (vary > 0.0) {
    let k0 = max(0, i32(floor(q)) - 2); let k1 = min(n - 1, i32(floor(q)) + 1);
    level = foot + riser * MW[u.mwBase + u.nwrites + u32(k0)].y;
    for (var k = k0; k <= k1; k++) {
      let wsz = 24.0 + 9.0 * f32(k % 4);
      let off = vary * 0.45 * vnoise(lx / wsz, ly / wsz, salt ^ u32(0x3a7 + k * 977));
      level = level + riser * MW[u.mwBase + u.nwrites + u32(k)].x * sm(f32(k) + ledge + off, f32(k) + 1.0 + off, q);
    }
  } else {
    let k = floor(q);
    level = foot + riser * (k + sm(ledge, 1.0, q - k));
  }
  // Fingers stay as flat as they were laid, under the ledge they would be raised to.
  let ff = Sc[CFF * cells + i];
  if (ff > 0.0) { level = min(level, ff); }
  F[PH * cells + i] = clamp(min(min(base, u.baseH), sea + level * sm(0.0, 5.0, d)) + max(0.0, base - u.baseH), u.minH, u.maxH);
}

// ---- P27: the beach profile (a water landform's Surf, from 0 up), last of the coast pass ----
// One thread per cell, from its own distance D to the stroke's waterline (the coast field of the heights the earlier passes left), its snapshot R, the footprint W
// and position-only noise in the shape's frame. Land: a face up from the waterline to a berm crest (a cubic, level at the crest), a slight back-slope, then a rise
// that gives way to the bank; the land is cut to that profile where it stands above it and left where it is lower. Water: a shoreface (depth with the 2/3 power of
// the distance, Dean's), then a steeper slope, the bed lifted to it where it is deeper. Both blend into the stroke's own heights by the reach. Retail's coasts hold
// the berm to a few units (Archipelago's land stands 1 above the sea, its p90 crest 5), so the crest is 0.3 to 2.5 units and 3 to 48 px from the water: the frag's
// surfBerm (3 + 45 Surf px, 0.3 + 2.2 Surf units: a little Surf is a low, narrow berm, and none of the beach's size is held back below a threshold).
// A rocky shore is the artist's: the Paint tool's rock, which the frag's beach gives way to. The beach reach (px) is BEACH_REACH in sculpt-gpu-fields.js.
const BEACH_REACH = 140.0;
@compute @workgroup_size(8, 8)
fn coastBeach(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
  let cells = cCells(); let i = cIdx(x, y); let sea = u.sea;
  let raw = Sc[CRR * cells + i]; let d = Sc[CDD * cells + i]; let foot = Sc[CW * cells + i];
  let strength = sm(0.0, 1.0, u.coSurf) * sm(0.0, 0.3, foot);
  if (strength <= 0.0 || d >= BEACH_REACH) { return; }
  // The berm's size is a function of the cross-shore distance and of the nearest point of the coast (its frame position), so it is one along the normal.
  let sx = select(CPX, CQX, u.coSrc != 0u);
  let cp = vec2f(Sc[sx * cells + i], Sc[(sx + 1u) * cells + i]);
  if (cp.x < -1.0e8) { return; }
  var lx = cp.x; var ly = cp.y;
  if (u.framed != 0u) { lx = u.inv0 * cp.x + u.inv2 * cp.y + u.inv4; ly = u.inv1 * cp.x + u.inv3 * cp.y + u.inv5; }
  let salt = u.seed;
  // The berm's distance and height wander along the coast (cusps and embayments, 60 to 80 px apart).
  let e = u.coSurf;
  let xb = (3.0 + 45.0 * e) * (1.0 + 0.3 * vnoise(lx / 57.0, ly / 57.0, salt ^ 0x6b1u));
  let hb = (0.3 + 2.2 * e) * (1.0 + 0.2 * vnoise(lx / 83.0, ly / 83.0, salt ^ 0x6b7u));
  var result = raw;
  if (raw > sea) {
    let rel = raw - sea;
    var ceil = 0.0;
    if (d < xb) { let t = d / xb; ceil = hb * (1.5 * t - 0.5 * t * t * t); }
    else { ceil = hb * (1.0 - 0.35 * sm(0.0, 1.0, (d - xb) / 24.0)) + 0.25 * max(0.0, d - xb - 24.0); }
    let beach = mix(min(rel, ceil), rel, sm(xb + 24.0, xb + 56.0, d));
    result = sea + max(mix(rel, beach, strength), min(rel, 0.05));
  }
  F[PH * cells + i] = clamp(result, u.minH, u.maxH);
}

// ---- H10: shore plates (materials 1 slabs and 2 frost), after the coast field (coMoved 0, so every crossing the footprint touches seeds it) ----
// One thread per cell of the band: its own distance D, the snapshot of its own height R, a jittered Voronoi lattice in the shape's frame, value noise. No cell reads another's
// result, so a repeat run is identical. The band is plWater px into the water and plLand px onto land from the stroke's waterline.
fn plH(x: i32, y: i32, salt: u32) -> f32 { return hashi(x, y, u.seed ^ salt); }
fn plHalf(x: i32, y: i32, salt: u32) -> f32 { return hashi(x, y, u.seed ^ salt) * 0.5 + 0.5; }
// The two nearest points of the lattice of L-sized cells around (lx, ly) in the shape's frame: each cell's point is its centre moved by plH (salts sa and sb) times jit of a cell.
// Squared distances, the points, and the cells, nearest (b) first.
struct PlCells { d1: f32, d2: f32, b: vec2f, n: vec2f, bi: i32, bj: i32, ni: i32, nj: i32 }
fn plCells(lx: f32, ly: f32, L: f32, sa: u32, sb: u32, jit: f32) -> PlCells {
  var r = PlCells(3.0e38, 3.0e38, vec2f(0.0), vec2f(0.0), 0, 0, 0, 0);
  let ci = i32(floor(lx / L)); let cj = i32(floor(ly / L));
  for (var v = cj - 1; v <= cj + 1; v++) { for (var w = ci - 1; w <= ci + 1; w++) {
    let c = vec2f((f32(w) + 0.5 + plH(w, v, sa) * jit) * L, (f32(v) + 0.5 + plH(w, v, sb) * jit) * L);
    let q = (lx - c.x) * (lx - c.x) + (ly - c.y) * (ly - c.y);
    if (q < r.d1) { r.d2 = r.d1; r.n = r.b; r.ni = r.bi; r.nj = r.bj; r.d1 = q; r.b = c; r.bi = w; r.bj = v; } else if (q < r.d2) { r.d2 = q; r.n = c; r.ni = w; r.nj = v; }
  } }
  return r;
}

@compute @workgroup_size(8, 8)
fn coastPlates(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
  let cells = cCells(); let i = cIdx(x, y); let sea = u.sea;
  let raw = Sc[CRR * cells + i];
  let wet = raw <= sea;
  let width = select(u.plLand, u.plWater, wet);
  let d = Sc[CDD * cells + i];
  if (!(width > 0.0) || d >= width) { return; }
  let wx = f32(x) * u.spacing; let wy = f32(y) * u.spacing;
  var lx = wx; var ly = wy; var scale = 1.0;
  if (u.framed != 0u) { lx = u.inv0 * wx + u.inv2 * wy + u.inv4; ly = u.inv1 * wx + u.inv3 * wy + u.inv5; scale = 1.0 / length(vec2f(u.inv0, u.inv1)); }
  let ph = PH * cells + i; let pp = PP * cells + i; let pr = PR * cells + i; let pv = PV * cells + i; let px = PX * cells + i;
  if (u.plMat == 1u) {
    let L = max(8.0, u.plSize); let seam = max(u.spacing * 0.5, max(0.0, u.plGap) * 0.5);
    let k = plCells(lx, ly, L, 0x481u, 0x287u, 0.4);
    let keep = plHalf(k.bi, k.bj, 0x721u); var shade = 0.8 + 0.2 * plHalf(k.bi, k.bj, 0x3b9u); let lift = plHalf(k.bi, k.bj, 0x6d3u);
    if (keep > 1.0 - sm(0.2, 1.0, d / width)) { return; }
    let wob = vnoise(lx / 6.0, ly / 6.0, u.seed ^ 0x317u) * 0.5;
    var edge = (k.d2 - k.d1) / (2.0 * max(1.0, length(k.b - k.n))) * scale + wob;
    // H20b: a wet plate whose centre reads low in a slow noise breaks into a mesh of cells 0.4 of L, its own outline kept as the nearer seam. Wet only: on land a mesh this fine
    // inks its seams into black clumps (retail's fine mesh is the water band). The noise sits close to .5, so the cut is pulled toward it (0.72) to make the share about plVary.
    if (wet && u.plVary > 0.0 && 0.5 + 0.5 * vnoise(k.b.x / (L * 4.0), k.b.y / (L * 4.0), u.seed ^ 0x5d1u) < 0.5 + 0.72 * (u.plVary - 0.5)) {
      let f = plCells(lx, ly, L * 0.4, 0x6a9u, 0x2e3u, 0.4);
      edge = min(edge, (f.d2 - f.d1) / (2.0 * max(1.0, length(f.b - f.n))) * scale + wob);
      shade = 0.8 + 0.2 * plHalf(f.bi, f.bj, 0x1f5u);
    }
    let seamed = edge < seam;
    F[px] = select(shade, u.plSeam, seamed); F[pp] = 1.0;
    if (wet) { F[ph] = clamp(max(raw, sea - 3.2 + lift), u.minH, u.maxH); }
    else if (!seamed) { F[ph] = clamp(raw + lift * u.plHeight, u.minH, u.maxH); }
    return;
  }
  if (u.plMat != 2u) { return; }
  // Frost: patches (size L) carry needles in one of three directions 60 degrees apart; seams run between much larger cells (3 L).
  let gapSize = u.frGapSize; let L = max(20.0, u.plSize); let sp0 = max(3.0, u.plGap); let turn = atan2(u.rotY, u.rotX);
  F[pp] = max(F[pp], 0.04);
  F[pr] = max(F[pr], (1.0 + 4.0 * (1.0 - d / width)) / 255.0);
  let pc = plCells(lx, ly, L, 0x481u, 0x287u, 0.4);
  let kind3 = i32(floor(plHalf(pc.bi, pc.bj, 0x5d1u) * 3.0)) % 3;
  let pkeep = plHalf(pc.bi, pc.bj, 0x721u); let needles = plHalf(pc.bi, pc.bj, 0x9c5u) < u.plNeedles;
  let angle = turn + 1.5707963 + f32(kind3) * 1.0471976 + plH(pc.bi, pc.bj, 0x3c9u) * 0.12;
  let pgap = sp0 * (0.8 + 0.5 * plHalf(pc.bi, pc.bj, 0x6b7u)); let phase = plHalf(pc.bi, pc.bj, 0x1f3u);
  let pid = (pc.bi * 73856093) ^ (pc.bj * 19349663);
  let support = 1.0 - sm(0.1, 1.0, d / width);
  let ca = cos(angle); let sa = sin(angle);
  let across = (lx * ca + ly * sa) / (pgap * scale) + phase; let along = (-lx * sa + ly * ca) / scale;
  let index = i32(floor(across + 0.5)); let off = abs(across - f32(index)) * pgap;
  let nlen = pgap * (1.5 + 4.0 * plHalf(index, pid, 0x2e7u)); let stretch = i32(floor(along / nlen + plH(index, pid, 0x4a9u) * 2.0));
  let here = plHalf(index, stretch ^ pid, 0x91du); let line = plHalf(index, pid, 0x63du);
  var strip = 0.0;
  if (needles && !(pkeep > support) && !(line < 0.45)) { strip = sm(1.5, 0.5, off) * sm(0.15, 0.5, here - (1.0 - support) * 0.35); }
  if (wet) {
    let across2 = (lx * ca + ly * sa) / scale;
    let field = vnoise(along / 64.0, across2 / 20.0, u.seed ^ 0x1a7u) * 0.45 + vnoise(along / 26.0, across2 / 6.0, u.seed ^ 0x2b1u) * 0.3 + vnoise(along / 10.0, across2 / 3.0, u.seed ^ 0x3d7u) * 0.18 + 0.5;
    strip = max(strip, sm(0.0, 0.12, pow(support, 1.25) * 1.25 - field));
    if (strip <= 0.05) { return; }
    let top = sea + u.plHeight * (0.6 + 0.4 * plHalf(index, pid, 0x7b3u));
    F[ph] = clamp(raw + (max(raw, top) - raw) * strip, u.minH, u.maxH);
    F[pp] = max(F[pp], strip); F[pr] = max(F[pr], strip); F[pv] = min(F[pv], -strip);
    return;
  }
  // Land: a low ridge along each needle, a groove along the seam between the big cells, melt pockets.
  let sk = plCells(lx, ly, L * 3.0, 0x6c1u, 0x7e9u, 0.42);
  let skb = plHalf(sk.bi, sk.bj, 0x8d3u); let skn = plHalf(sk.ni, sk.nj, 0x8d3u);
  let sedge = (sk.d2 - sk.d1) / (2.0 * max(1.0, length(sk.b - sk.n))) * scale + vnoise(lx / 9.0, ly / 9.0, u.seed ^ 0x317u) * 1.2;
  var seam = 0.0;
  if (max(skb, skn) > 1.0 - support * 0.9) { seam = sm(1.6, 0.3, sedge); }
  let lift = strip * min(2.5, u.plHeight * 0.7) - seam * 2.5;
  var holeShare = 0.0;
  if (u.frGapReach > 0.0) { holeShare = u.frGaps * sm(u.frGapReach, 0.0, d / width); }
  var hole = 0.0;
  if (holeShare > 0.0) { hole = sm(0.0, 0.1, vnoise(lx / gapSize, ly / gapSize, u.seed ^ 0x4e1u) * 0.5 + vnoise(lx / (gapSize * 0.41), ly / (gapSize * 0.41), u.seed ^ 0x5f3u) * 0.22 + 0.5 - (1.0 - holeShare)); }
  if (hole > 0.02) {
    F[ph] = clamp(raw + (min(raw, sea - u.frGapDepth) - raw) * hole, u.minH, u.maxH);
    F[pp] = max(F[pp], hole); F[pr] = max(F[pr], hole); F[pv] = min(F[pv], -hole);
    return;
  }
  if (lift == 0.0) { return; }
  F[ph] = clamp(raw + lift, u.minH, u.maxH);
  let keepM = max(strip, seam); F[pp] = max(F[pp], keepM); F[pr] = max(F[pr], keepM); F[pv] = min(F[pv], -keepM);
}

// ---- H10: crystal columns (form 1) and bergs (form 2) ----
// Columns: a mound tiled with flat polygonal columns in a Voronoi pattern of up to three widths (stampColumns in sculpt.js). Each cell evaluates the columns of the
// 3 x 3 lattice neighbours of every width in use itself (the mound is a distance to the stroke's path, cheap to evaluate), so there is no record pass and no thread
// reads another's result. Seg k holds the path point k and the next (the last repeats itself).
var<private> SZL: array<f32, 3> = array<f32, 3>(1.0, 0.55, 0.3);
var<private> SZS: array<f32, 3> = array<f32, 3>(1.0, 0.65, 0.4);
var<private> SZB: array<f32, 3> = array<f32, 3>(1.0, 0.4, 0.0);

fn cgRnd(i: i32, j: i32, a: u32) -> f32 {
  var x = ((bitcast<u32>(i) * 73856093u) ^ (bitcast<u32>(j) * 19349663u) ^ (u.seed + a * 83492791u)) * 2654435761u;
  x = x ^ (x >> 15u); x = x * 2246822519u; x = x ^ (x >> 13u);
  return f32(x) / 4294967296.0;
}
// The jittered point of cell (i, j) of size L in the shape's frame (hash salts 1 + o and 2 + o, jit of a cell around its centre), and a point of the frame in the world.
fn cgPoint(i: i32, j: i32, L: f32, jit: f32, o: u32) -> vec2f {
  return vec2f((f32(i) + 0.5 + (cgRnd(i, j, 1u + o) - 0.5) * jit) * L, (f32(j) + 0.5 + (cgRnd(i, j, 2u + o) - 0.5) * jit) * L);
}
fn cgWorld(l: vec2f) -> vec2f {
  if (u.framed == 0u) { return l; }
  let det = u.inv0 * u.inv3 - u.inv1 * u.inv2;
  let a = u.inv3 / det; let b = -u.inv1 / det; let c = -u.inv2 / det; let d = u.inv0 / det;
  let e = -(a * u.inv4 + c * u.inv5); let f = -(b * u.inv4 + d * u.inv5);
  return vec2f(a * l.x + c * l.y + e, b * l.x + d * l.y + f);
}

// ---- H10: a landform's Facets, a pass over the node's own result ----
// facetSnap copies the node's result to plane R; facetApply then re-tiles the cells the node touched (footprint plane W > 0) with Voronoi facets (Facet shape:
// angular facets), each the plane through the result at the facet's seed (height and slope over 3 cells, read from R inside the footprint and from the prefix B
// elsewhere). Every read is of R, B or W, which no thread of the pass writes, so a repeat run is identical. Reads clamp to the node's box (the host grows it by
// the seeds' reach). fcMode 1 is a landform that digs into the ground it lands on: the planes are fitted to its surface up and down and replace it by the Facets
// share (fcStrength); fcMode 2 a raised one: a share of tilted, steeper planes stand out of it. Step height (fcStep) steps each facet off its neighbours.
// Surface Crystal (fcSurface) marks them as one crystal skin (the crystal field's 0.74, whose thin web the draw adds); Rock leaves the shape's own ground.
@compute @workgroup_size(8, 8)
fn facetSnap(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
  let cells = cCells(); let i = cIdx(x, y);
  Sc[CRR * cells + i] = F[PH * cells + i];
}
fn fcAt(gx: i32, gy: i32, cells: u32) -> f32 {
  let j = cIdx(clamp(gx, max(u.coBx0, 0), min(u.coBx1, i32(u.grid) - 1)), clamp(gy, max(u.coBy0, 0), min(u.coBy1, i32(u.grid) - 1)));
  return select(Sc[CB * cells + j], Sc[CRR * cells + j], Sc[CW * cells + j] > 0.0);
}
struct FcSeed { l: vec2f, w: vec2f, h: f32, dx: f32, dy: f32, step: f32, steep: f32, on: bool }
fn fcSeed(i: i32, j: i32, cells: u32) -> FcSeed {
  let L = u.fcL; let dig = u.fcMode == 1u;
  let jit = select(1.0, 0.9, dig);
  let l = cgPoint(i, j, L, jit, 0u); let w = cgWorld(l);
  let gx = i32(floor(w.x / u.spacing + 0.5)); let gy = i32(floor(w.y / u.spacing + 0.5)); let e3 = 3;
  var s: FcSeed; s.l = l; s.w = w;
  s.h = fcAt(gx, gy, cells);
  s.dx = (fcAt(gx + e3, gy, cells) - fcAt(gx - e3, gy, cells)) / (2.0 * 3.0 * u.spacing);
  s.dy = (fcAt(gx, gy + e3, cells) - fcAt(gx, gy - e3, cells)) / (2.0 * 3.0 * u.spacing);
  s.step = 0.0; s.steep = 1.0; s.on = true;
  if (dig) { s.step = (cgRnd(i, j, 3u) - 0.5) * 2.0 * u.fcStep; }
  else {
    s.on = cgRnd(i, j, 4u) < u.fcShare;
    s.dx = s.dx + (cgRnd(i, j, 6u) - 0.5) * 0.7; s.dy = s.dy + (cgRnd(i, j, 7u) - 0.5) * 0.7;
    s.steep = 1.1 + 0.3 * cgRnd(i, j, 5u); s.step = (cgRnd(i, j, 3u) - 0.2) * 2.0 * u.fcStep;
  }
  return s;
}
@compute @workgroup_size(8, 8)
fn facetApply(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
  let cells = cCells(); let i = cIdx(x, y);
  if (!(Sc[CW * cells + i] > 0.0)) { return; }
  let snap = Sc[CRR * cells + i]; let base = Sc[CB * cells + i]; let relief = snap - base;
  let dig = u.fcMode == 1u;
  if (dig) { if (abs(relief) < 0.6) { return; } } else { if (relief < 2.0) { return; } }
  let wx = f32(x) * u.spacing; let wy = f32(y) * u.spacing;
  var lx = wx; var ly = wy;
  if (u.framed != 0u) { lx = u.inv0 * wx + u.inv2 * wy + u.inv4; ly = u.inv1 * wx + u.inv3 * wy + u.inv5; }
  let L = u.fcL; let ci = i32(floor(lx / L)); let cj = i32(floor(ly / L));
  var d1 = 3.0e38; var d2 = 3.0e38; var bi = 0; var bj = 0;
  for (var j = cj - 1; j <= cj + 1; j++) { for (var ii = ci - 1; ii <= ci + 1; ii++) {
    let d = length(vec2f(lx, ly) - cgPoint(ii, j, L, select(1.0, 0.9, dig), 0u));
    if (d < d1) { d2 = d1; d1 = d; bi = ii; bj = j; } else if (d < d2) { d2 = d; }
  } }
  let s = fcSeed(bi, bj, cells);
  if (dig) {
    let facet = s.h + s.dx * (wx - s.w.x) + s.dy * (wy - s.w.y) + s.step * sm(0.0, 4.0, abs(relief));
    F[PH * cells + i] = clamp(snap + (facet - snap) * u.fcStrength, u.minH, u.maxH);
    if (abs(relief) >= 2.0 && u.fcSurface != 0u) { F[PP * cells + i] = 1.0; F[PX * cells + i] = 0.74; }
    return;
  }
  if (!s.on) { return; }
  let plane = s.h + (s.dx * (wx - s.w.x) + s.dy * (wy - s.w.y)) * s.steep + s.step * sm(0.0, 10.0, relief);
  let value = max(plane, base); let fade = sm(2.0, 10.0, relief);
  F[PH * cells + i] = clamp(snap + (value - snap) * fade, u.minH, u.maxH);
  if (u.fcSurface != 0u) { F[PP * cells + i] = 1.0; F[PX * cells + i] = 0.74; }
}

// ---- Facets: stepped columns and prisms (Facet shape 1 and 2), a pass over the landform's own result ----
// The curves give the envelope (the landform the stamp just drew, snapped to plane R by facetSnap; the prefix is B, the footprint W). This pass breaks it into
// geometric elements whose seeds lie on a lattice in the path's own coordinates (s along the trunk, c across it, + left of the way drawn), so a click is a
// cluster round the point and a drag a ridge along the path; each element is laid out in its own segment's frame, so it keeps its shape round a bend. Every
// element stands as high as the envelope at its seed, so the section, the along curve and the variation shape the cluster or ridge.
// lfCrystalSites runs first, once per seed: where the seed lies on the map (a walk along the path), and what the elements need there (the envelope and its
// slope for a column; the section's rise, its slope across the prism and the prism's room for a prism), into a table after the coast planes (Sc from
// CNPL x cells, 12 floats a seed). lfCrystalApply then reads only that table and R, B and W, so a repeat run is identical. The table's layout is in MW after the
// node's other rows (lfcTab): a row per segment (its path, -1 for a spur piece) and a row per path and level (the seeds' first index, i0, ni, j0; nj = 1 - 2 j0).

// The cell's place in the path's coordinates (s, c) and the trunk segment it is nearest (a free end runs on past its last segment).
fn lfCrystalCoord(p: vec2f) -> vec3f {
  var best = 3.0e38; var sc = vec3f(0.0);
  for (var k = 0u; k < u.nseg; k++) {
    let s0 = Seg[(u.segBase + k) * 4u]; let s1 = Seg[(u.segBase + k) * 4u + 1u];
    if (s1.z < 0.0) { continue; }
    let flags = u32(Seg[(u.segBase + k) * 4u + 2u].x);
    let d = s0.zw - s0.xy; let len = max(length(d), 1e-4); let ax = d / len;
    let t = clamp(dot(p - s0.xy, ax), select(0.0, -1.0e9, (flags & 1u) != 0u), select(len, 1.0e9, (flags & 2u) != 0u));
    let q = p - s0.xy - ax * t; let d2 = dot(q, q);
    if (d2 < best) { best = d2; sc = vec3f(s1.x + t, q.x * ax.y - q.y * ax.x, f32(k)); }
  }
  return sc;
}
// The world point at (s, c) of the path the trunk segment k0 belongs to (w), the way the segment holding s runs (ax), and that segment (k): found walking
// along the path's own segments only.
struct LfcPoint { w: vec2f, ax: vec2f, k: u32 }
fn lfCrystalPoint(sc: vec2f, k0: u32) -> LfcPoint {
  var k = k0;
  for (var n = 0u; n < u.nseg; n++) {
    let s1 = Seg[(u.segBase + k) * 4u + 1u]; let flags = u32(Seg[(u.segBase + k) * 4u + 2u].x);
    if (sc.x >= s1.x || (flags & 1u) != 0u || k == 0u) { break; }
    k = k - 1u;
  }
  for (var n = 0u; n < u.nseg; n++) {
    let s1 = Seg[(u.segBase + k) * 4u + 1u]; let flags = u32(Seg[(u.segBase + k) * 4u + 2u].x);
    if (sc.x < s1.x + s1.y || (flags & 2u) != 0u || k + 1u >= u.nseg) { break; }
    k = k + 1u;
  }
  let s0 = Seg[(u.segBase + k) * 4u]; let s1 = Seg[(u.segBase + k) * 4u + 1u];
  let d = s0.zw - s0.xy; let ax = d / max(length(d), 1e-4);
  var r: LfcPoint; r.w = s0.xy + ax * (sc.x - s1.x) + vec2f(ax.y, -ax.x) * sc.y; r.ax = ax; r.k = k;
  return r;
}
// A world offset q in a segment's frame (along, across), as (s, c) run.
fn lfCrystalLocal(q: vec2f, ax: vec2f) -> vec2f { return vec2f(dot(q, ax), q.x * ax.y - q.y * ax.x); }
// The envelope at a world point, as (its height, its height over the prefix): R inside the footprint, the prefix elsewhere (fcAt's clamped read).
fn lfCrystalEnv(w: vec2f, cells: u32) -> vec2f {
  let gx = i32(floor(w.x / u.spacing + 0.5)); let gy = i32(floor(w.y / u.spacing + 0.5));
  let j = cIdx(clamp(gx, max(u.coBx0, 0), min(u.coBx1, i32(u.grid) - 1)), clamp(gy, max(u.coBy0, 0), min(u.coBy1, i32(u.grid) - 1)));
  let b = Sc[CB * cells + j];
  let h = select(b, Sc[CRR * cells + j], Sc[CW * cells + j] > 0.0);
  return vec2f(h, h - b);
}
// The landform's own section at a world point on trunk segment k over the ground `base` (lfEval: the curves, the along curve, the variation, the terraces):
// (the height, the coverage). The terraces read their noise at the seed's cell `at`, which lies in the node's footprint whenever the element stands.
fn lfcSection(w: vec2f, k: u32, base: f32, at: vec2f, cells: u32) -> vec2f {
  let s0 = Seg[(u.segBase + k) * 4u]; let s1 = Seg[(u.segBase + k) * 4u + 1u]; let s2 = Seg[(u.segBase + k) * 4u + 2u];
  let d = s0.zw - s0.xy; let ax = d / max(length(d), 1e-4);
  var lx = w.x; var ly = w.y;
  if (u.framed != 0u) { lx = u.inv0 * w.x + u.inv2 * w.y + u.inv4; ly = u.inv1 * w.x + u.inv3 * w.y + u.inv5; }
  var nA = 0.0; var nB = 0.0; var nC = 0.0;
  let sz = max(u.lfSize, 8.0);
  if (u.lfWander > 0.0) { nA = 0.7 * noiseValue(3u, u.seed, lx * 210.0 / sz, ly * 210.0 / sz) + 0.3 * noiseValue(2u, u.seed, lx * 210.0 / sz, ly * 210.0 / sz); if (u.lfVary > 0.0) { nA = wanderVaried(nA, lx, ly); } }
  if (u.lfWidth > 0.0) { nB = noiseValue(5u, u.seed, lx * 210.0 / sz, ly * 210.0 / sz); }
  if (u.lfHeight > 0.0) { nC = lfFractal(lx / sz + 37.1, ly / sz - 19.7, 0x5c9u); }
  let x = clamp(i32(floor(at.x / u.spacing + 0.5)), 0, i32(u.grid) - 1); let y = clamp(i32(floor(at.y / u.spacing + 0.5)), 0, i32(u.grid) - 1);
#ifdef PAGES
  let i = 0u;   // the terraces' noise is evaluated directly on a page (nzF reads no table)
#else
  let i = u32(y) * u.grid + u32(x);
#endif
  let share = clamp((s1.x + dot(w - s0.xy, ax)) / max(s1.z, 1e-4), 0.0, 1.0);
  return lfEval(s0, s1, s2, w.x, w.y, base, nA, nB, nC, share, x, y, i, cells).xy;
}
// The column width a seed takes (0, 1 or 2 of SZL) where Size mix mixes three: smaller in patches and where the envelope stands highest.
fn lfCrystalLevel(w: vec2f, share: f32) -> i32 {
  if (!(u.cgSizeVar > 0.0)) { return 0; }
  let f = 0.5 + 0.32 * vnoise(w.x / 64.0, w.y / 64.0, u.seed ^ 0x51au) + 0.18 * vnoise(w.x / 27.0, w.y / 27.0, u.seed ^ 0x2e7u) + 0.3 * (share - 0.5);
  if (f > 1.17 - 0.4 * u.cgSizeVar) { return 2; }
  if (f > 0.84 - 0.3 * u.cgSizeVar) { return 1; }
  return 0;
}
// The envelope's rise over the plain, for the size mix's "highest" (the stroke's elevation over the map's base height).
fn lfCrystalRise() -> f32 { return max(abs(u.elev - u.baseH), 1.0); }
// How a cell's new height combines with the prefix, as the stroke's Combine does.
fn lfCrystalCombine(b: f32, v: f32) -> f32 {
  if (u.combine == 0u) { return max(b, v); }
  if (u.combine == 1u) { return min(b, v); }
  return v;
}

// ---- the seed table ----
fn lfcRow(r: u32) -> vec4f { return MW[u.mwBase + u.nwrites + u.lfcTab + r]; }
// The path a trunk segment belongs to (-1: a spur piece).
fn lfcPath(k: u32) -> i32 { return i32(lfcRow(k).x); }
// The index of seed (i, j) of path p at level lv in the table, or -1 outside it.
fn lfcIndex(p: i32, lv: u32, i: i32, j: i32) -> i32 {
  if (p < 0) { return -1; }
  let b = lfcRow(u.nseg + u32(p) * 3u + lv); let i0 = i32(b.y); let ni = i32(b.z); let j0 = i32(b.w);
  if (i < i0 || i >= i0 + ni || j < j0 || j > -j0) { return -1; }
  return i32(b.x) + (j - j0) * ni + (i - i0);
}
fn lfcAt(n: i32, w: u32, cells: u32) -> vec4f { let a = CNPL * cells + u32(n) * 12u + w * 4u; return vec4f(Sc[a], Sc[a + 1u], Sc[a + 2u], Sc[a + 3u]); }
fn lfcPut(n: u32, w: u32, v: vec4f, cells: u32) { let a = CNPL * cells + n * 12u + w * 4u; Sc[a] = v.x; Sc[a + 1u] = v.y; Sc[a + 2u] = v.z; Sc[a + 3u] = v.w; }
// A prism seed's place in the path's coordinates: a hexagonal lattice of the spacing lfcSpace (rows along the path), each seed moved by up to lfcJs of a
// spacing along the path and lfcJc across it (less where the shape has no room: a lone prism stays on its click), so no rows show.
fn lfcPrismSeed(i: i32, j: i32) -> vec2f {
  let S = u.lfcSpace;
  return vec2f((f32(i) + 0.5 * f32(j & 1) + u.lfcJs * (cgRnd(i, j, 22u) - 0.5)) * S, (f32(j) * 0.8660254 + u.lfcJc * (cgRnd(i, j, 23u) - 0.5)) * S);
}
// A prism's own radius: its share of Facet width (Variation spreads it); 0 where the Facets share leaves no prism.
fn lfcPrismSize(i: i32, j: i32) -> f32 {
  if (cgRnd(i, j, 21u) >= u.lfcShare) { return 0.0; }
  return 0.5 * u.cgSize * (1.0 + u.cgVar * (cgRnd(i, j, 24u) - 0.5) * 1.2);
}
// The seed table entry thread t fills: its path, level, and lattice place (i, j); the level is -1 past the table.
fn lfcSeedOf(t: u32) -> vec4i {
  for (var r = 0u; r < u.lfcBlocks; r++) {
    let b = lfcRow(u.nseg + r);
    if (f32(t) >= b.x && f32(t) < b.x + b.z * (1.0 - 2.0 * b.w)) { let local = i32(t) - i32(b.x); let ni = i32(b.z); return vec4i(i32(r / 3u), i32(r % 3u), i32(b.y) + local % ni, i32(b.w) + local / ni); }
  }
  return vec4i(0, -1, 0, 0);
}

// One thread per seed of the table (256 a row of the dispatch): which path and level it is, where it lies, and what its element needs. A seed far from the
// cells this evaluation covers (lfcW*, grown by the reach of a seed) keeps only its place; nothing there reads the rest.
@compute @workgroup_size(8, 8)
fn lfCrystalSites(@builtin(global_invocation_id) g: vec3u) {
  let t = g.y * 256u + g.x;
  if (g.x >= 256u || t >= u.lfcSites) { return; }
  let cells = cCells(); let at = lfcSeedOf(t);
  if (at.y < 0) { return; }
  let p = at.x; let lv = u32(at.y); let i = at.z; let j = at.w;
  var k0 = 0u;
  for (var k = 0u; k < u.nseg; k++) { if (lfcPath(k) == p) { k0 = k; break; } }
  let prism = u.lfcForm == 2u;
  var sc = cgPoint(i, j, u.cgSize * SZL[lv], 0.9, lv * 16u);
  if (prism) { sc = lfcPrismSeed(i, j); }
  let pt = lfCrystalPoint(sc, k0);
  lfcPut(t, 0u, vec4f(pt.w, pt.ax), cells);
  let gx = i32(floor(pt.w.x / u.spacing + 0.5)); let gy = i32(floor(pt.w.y / u.spacing + 0.5));
  if (gx < u.lfcWx0 || gx > u.lfcWx1 || gy < u.lfcWy0 || gy > u.lfcWy1) { lfcPut(t, 1u, vec4f(0.0), cells); lfcPut(t, 2u, vec4f(0.0), cells); return; }
  if (!prism) {
    // A column: the envelope at its seed and its slope over three cells, and whether the seed takes this level's width.
    let env = lfCrystalEnv(pt.w, cells);
    let e = 3.0 * u.spacing;
    let sx = (lfCrystalEnv(pt.w + vec2f(e, 0.0), cells).x - lfCrystalEnv(pt.w - vec2f(e, 0.0), cells).x) / (2.0 * e);
    let sy = (lfCrystalEnv(pt.w + vec2f(0.0, e), cells).x - lfCrystalEnv(pt.w - vec2f(0.0, e), cells).x) / (2.0 * e);
    let fits = u.lfcLevels <= 1u || lfCrystalLevel(pt.w, env.y / lfCrystalRise()) == i32(lv);
    lfcPut(t, 1u, vec4f(env, sx, sy), cells); lfcPut(t, 2u, vec4f(select(0.0, 1.0, fits), 0.0, 0.0, 0.0), cells);
    return;
  }
  // A prism: its rise over a cell's ground b is A + B b (the section is linear in the ground it lands on), and its top's slope across the prism (the section's
  // over half its radius each way: Level tops below 100 tilt the top as that plane). Its own size waits for lfCrystalRoom (word 2: final radius, own size).
  let R = lfcPrismSize(i, j);
  let v0 = lfcSection(pt.w, pt.k, 0.0, pt.w, cells); let v1 = lfcSection(pt.w, pt.k, 1.0, pt.w, cells);
  let a = max(0.5 * R, u.spacing);
  let tx = (lfcSection(pt.w + vec2f(a, 0.0), pt.k, 0.0, pt.w, cells).x - lfcSection(pt.w - vec2f(a, 0.0), pt.k, 0.0, pt.w, cells).x) / (2.0 * a);
  let ty = (lfcSection(pt.w + vec2f(0.0, a), pt.k, 0.0, pt.w, cells).x - lfcSection(pt.w - vec2f(0.0, a), pt.k, 0.0, pt.w, cells).x) / (2.0 * a);
  lfcPut(t, 1u, vec4f(v0.x, v1.x - v0.x - 1.0, tx, ty), cells); lfcPut(t, 2u, vec4f(0.0, select(0.0, R, v0.y > 0.0), 0.0, 0.0), cells);
}
// Prisms, after lfCrystalSites: each prism's radius, no more than half the way to the nearest prism that also stands (on the shape, in the Facets share; less
// the reach of its jittered outline), so neighbours never merge and a lone prism keeps its full size.
@compute @workgroup_size(8, 8)
fn lfCrystalRoom(@builtin(global_invocation_id) g: vec3u) {
  let t = g.y * 256u + g.x;
  if (g.x >= 256u || t >= u.lfcSites) { return; }
  let cells = cCells(); let at = lfcSeedOf(t);
  if (at.y < 0) { return; }
  let own = lfcAt(i32(t), 2u, cells).y;
  if (own <= 0.0) { return; }
  let w = lfcAt(i32(t), 0u, cells).xy;
  var near = 3.0e38;
  for (var dj = -1; dj <= 1; dj++) { for (var di = -2; di <= 2; di++) {
    if (di == 0 && dj == 0) { continue; }
    let n = lfcIndex(at.x, 0u, at.z + di, at.w + dj);
    if (n < 0 || lfcAt(n, 2u, cells).y <= 0.0) { continue; }
    near = min(near, length(lfcAt(n, 0u, cells).xy - w));
  } }
  let a = CNPL * cells + t * 12u + 8u;
  Sc[a] = min(own, 0.5 * near / (1.0 + 0.3 * u.bgJit));
}

// Stepped columns: the envelope tiled with Voronoi columns (up to three widths); each top is the envelope at its seed, stepped up or down from its
// neighbours, level (Level tops 100) or following the envelope's slope, tilted into one or two planes by Top tilt; the uncovered share stays the envelope.
fn lfCrystalColumns(x: i32, y: i32, i: u32, cells: u32) {
  let wx = f32(x) * u.spacing; let wy = f32(y) * u.spacing;
  let pc = lfCrystalCoord(vec2f(wx, wy)); let path = lfcPath(u32(pc.z)); let lx = pc.x; let ly = pc.y;
  let levels = i32(u.lfcLevels);
  var d1 = 3.0e38; var d2 = 3.0e38; var bl = -1; var bn = -1; var bi = 0; var bj = 0;
  for (var lv = 0; lv < levels; lv++) {
    let Ll = u.cgSize * SZL[lv]; let ci = i32(floor(lx / Ll)); let cj = i32(floor(ly / Ll));
    for (var j = cj - 1; j <= cj + 1; j++) { for (var ii = ci - 1; ii <= ci + 1; ii++) {
      let n = lfcIndex(path, u32(lv), ii, j);
      if (n < 0) { continue; }
      if (levels > 1 && lfcAt(n, 2u, cells).x == 0.0) { continue; }
      let d = length(vec2f(wx, wy) - lfcAt(n, 0u, cells).xy);
      if (d < d1) { d2 = d1; d1 = d; bl = lv; bn = n; bi = ii; bj = j; } else if (d < d2) { d2 = d; }
    } }
  }
  if (bl < 0) {
    // No width in use is near: the widest columns, whatever they asked for.
    let ci = i32(floor(lx / u.cgSize)); let cj = i32(floor(ly / u.cgSize));
    for (var j = cj - 1; j <= cj + 1; j++) { for (var ii = ci - 1; ii <= ci + 1; ii++) {
      let n = lfcIndex(path, 0u, ii, j);
      if (n < 0) { continue; }
      let d = length(vec2f(wx, wy) - lfcAt(n, 0u, cells).xy);
      if (d < d1) { d2 = d1; d1 = d; bl = 0; bn = n; bi = ii; bj = j; } else if (d < d2) { d2 = d; }
    } }
  }
  if (bn < 0) { return; }
  let o = u32(bl) * 16u;
  let cp = lfcAt(bn, 0u, cells); let cw = cp.xy; let env = lfcAt(bn, 1u, cells);
  if (env.y <= 1.0) { return; }
  // The uncovered share (1 - Facets, the widest columns most) keeps the envelope's own smooth surface.
  if (cgRnd(bi, bj, 12u + o) < u.cgSmooth * SZB[bl]) { return; }
  var step = 0.0;
  if (!(cgRnd(bi, bj, 3u + o) < 0.4)) { step = (cgRnd(bi, bj, 4u + o) - 0.35) * 2.0 * u.cgStep * SZS[bl]; }
  let shade = 0.8 + 0.2 * cgRnd(bi, bj, 5u + o);
  var top = env.x + step + (env.z * (wx - cw.x) + env.w * (wy - cw.y)) * (1.0 - clamp(u.cgTiers, 0.0, 1.0));
  if (u.cgFacet > 0.0) {
    let fa = u.cgFacet;
    let h0 = cgRnd(bi, bj, 6u + o) * 6.2831853; let h1 = h0 + 3.1415927 * (0.5 + cgRnd(bi, bj, 7u + o));
    let m0 = fa * (0.2 + 0.8 * cgRnd(bi, bj, 8u + o)); var m1 = 0.0;
    if (!(cgRnd(bi, bj, 9u + o) < 0.3)) { m1 = fa * (0.2 + 0.8 * cgRnd(bi, bj, 10u + o)); }
    let ol = lfCrystalLocal(vec2f(wx, wy) - cw, cp.zw); let ox = ol.x; let oy = ol.y;
    let pa = cos(h0) * m0 * ox + sin(h0) * m0 * oy; let pb = cos(h1) * m1 * ox + sin(h1) * m1 * oy;
    if (cgRnd(bi, bj, 11u + o) < 0.5) { top = top + min(pa, pb); } else { top = top + max(pa, pb); }
  }
  let base = Sc[CB * cells + i];
  let value = lfCrystalCombine(base, top);
  if (abs(value - base) <= 0.5) { F[PH * cells + i] = base; return; }
  F[PH * cells + i] = clamp(value, u.minH, u.maxH);
  // Surface Crystal: each column is crystal, shaded by its own brightness, with a dark seam to its neighbours; Rock keeps the shape's own ground.
  if (u.fcSurface == 0u) { return; }
  F[PP * cells + i] = 1.0; F[PX * cells + i] = select(shade, 0.5, d2 - d1 < max(1.2, u.spacing * 0.6));
}

// Prisms: scattered over the envelope (lfcPrismSeed), a Facets share of the seeds carries a polygonal prism (Polygon sides, turned square to the path by Align,
// its outline jittered and its corners cut), as high as the envelope at its seed; its faces climb from its outline to a flat top (Flat top share) that is
// level or, with Level tops below 100, tilted as the envelope's slope across the prism. Between prisms the ground is the prefix. Face roughness roughens the
// faces; Surface Crystal marks each prism as clean crystal (the crystal field), Rock leaves it the shape's own ground, lit with the world's slope relief and
// light (ice blocks).
fn lfCrystalPrisms(x: i32, y: i32, i: u32, cells: u32) {
  let wx = f32(x) * u.spacing; let wy = f32(y) * u.spacing; let here = vec2f(wx, wy);
  let pc = lfCrystalCoord(here); let path = lfcPath(u32(pc.z));
  let rowH = 0.8660254 * u.lfcSpace; let cj = i32(round(pc.y / rowH));
  let base = Sc[CB * cells + i];
  let tilt = 1.0 - clamp(u.cgTiers, 0.0, 1.0);
  var best = 0.0;
  for (var j = cj - 2; j <= cj + 2; j++) {
    let ci = i32(round(pc.x / u.lfcSpace - 0.5 * f32(j & 1)));
    for (var ii = ci - 2; ii <= ci + 2; ii++) {
      let n = lfcIndex(path, 0u, ii, j);
      if (n < 0) { continue; }
      let R = lfcAt(n, 2u, cells).x;
      if (R <= 0.0) { continue; }
      let sp = lfcAt(n, 0u, cells); var q = lfCrystalLocal(here - sp.xy, sp.zw);
      // Prism stretch: the prism is drawn elongated along its own turned axis (a rectangle from a square), so the cull allows its length.
      let el = clamp(u.lfcStretch, 1.0, 3.0);
      if (dot(q, q) > 2.6 * R * R * el * el) { continue; }
      let sec = lfcAt(n, 1u, cells);
      let H = (sec.x + sec.y * base) * (1.0 + u.cgVar * (cgRnd(ii, j, 25u) - 0.5));
      if (H <= 3.0) { continue; }   // lower than 3 units a prism does not read as one, only as its crystal mark
      let ns = u32(clamp(round(u.lfcSides + u.cgVar * (cgRnd(ii, j, 26u) - 0.5) * 2.4), 3.0, 12.0));
      let rot = (1.0 - clamp(u.lfcAlign, 0.0, 1.0)) * cgRnd(ii, j, 27u) * 6.2831853;
      if (el > 1.0) { let ax = vec2f(cos(rot), sin(rot)); let ay = vec2f(-ax.y, ax.x); q = ax * (dot(q, ax) / el) + ay * dot(q, ay); }
      let inr = R * cos(3.1415927 / f32(ns));
      var m = 1.0e9;
      for (var e = 0u; e < ns; e++) {
        let a = rot + (f32(e) + u.bgJit * (cgRnd(ii, j, 40u + e) - 0.5) * 0.7) * 6.2831853 / f32(ns);
        let d = inr * (1.0 + u.bgJit * (cgRnd(ii, j, 60u + e) - 0.5) * 0.6);
        m = min(m, (d - dot(q, vec2f(cos(a), sin(a)))) / inr);
      }
      for (var e = 0u; e < u32(u.lfcBreak); e++) {
        let a = cgRnd(ii, j, 100u + e) * 6.2831853;
        m = min(m, (R * (0.55 + 0.35 * cgRnd(ii, j, 120u + e)) - dot(q, vec2f(cos(a), sin(a)))) / inr);
      }
      if (m <= 0.0) { continue; }
      // The top: the seed's height, tilted below Level tops 100 as the plane of the envelope's slope across the prism; the faces climb to it over the outer
      // (1 - Flat top share) of the prism.
      let top = H + tilt * dot(sec.zw, here - sp.xy);
      let h = top * min(m / max(1.0 - u.cTop, 0.05), 1.0);
      if (h <= 0.0) { continue; }
      best = max(best, h);
    }
  }
  if (best <= 0.0) { F[PH * cells + i] = base; return; }
  if (u.bgRough > 0.0) {
    let f = vnoise(wx / 40.0, wy / 40.0, u.seed ^ 0x2a1u) * 0.3 + vnoise(wx / 17.0, wy / 17.0, u.seed ^ 0x4c7u) * 0.3 + vnoise(wx / 8.0, wy / 8.0, u.seed ^ 0x6e3u) * 0.28 + vnoise(wx / 4.0, wy / 4.0, u.seed ^ 0x8f9u) * 0.18;
    best = best + u.bgRough * f * sm(0.0, 4.0, best);
  }
  F[PH * cells + i] = clamp(lfCrystalCombine(base, base + best), u.minH, u.maxH);
  if (u.fcSurface == 0u) { return; }
  F[PP * cells + i] = 1.0;
  F[PX * cells + i] = max(F[PX * cells + i], sm(0.2, 1.5, best));
}

@compute @workgroup_size(8, 8)
fn lfCrystalApply(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
  let cells = cCells(); let i = cIdx(x, y);
  if (u.lfcForm == 1u) { lfCrystalColumns(x, y, i, cells); } else { lfCrystalPrisms(x, y, i, cells); }
}
