// lf-apron: lumps and hills around a shape, as primitives the column walk cannot make (they are deposits, not
// remnants). The stroke is round 1's three-segment ridge (engine-shape.wgsl kind 4 style); u = distance / reach is 0 on
// the crest and 1 at the foot. Every primitive is a sum of compact bumps placed per cell of a jittered lattice, the cell's
// hash picking its size and keeping it only where its own centre lies in the right band of u, so it is a pure function
// of position with a bounded reach (regional replay with an apron of one cell).
//  - hummocks: an apron of mounds 10-25 px across from the foot outward, elongated down the fall line at their own
//    centre, smaller and lower outward; a share are kettles (hollows). Landslide and moraine hummocks.
//  - knolls: satellite hills 25-70 px across on the plain round the foot, rarer with distance, each with its own lumps.
//  - slumps: per site near the foot, a scar (a spoon-shaped hollow with a steep head) on the lower face and a lobe
//    past the foot whose volume matches the scar's, with arcuate pressure ridges parallel to its front.
// Original code. The landforms are textbook (rotational slumps, hummocky moraine); no code read.
export default {
  title: 'Hummocks, knolls and slumps round a ridge',
  about: 'Deposit primitives placed by the stroke\'s own distance field: a hummock apron, satellite knolls, slump scars and lobes.',
  world: 'green',
  params: {reach: 105, amount: 105, hum: 0, humCell: 18, humH: 11, humBand: 0.6, kno: 0, knoCell: 74, knoH: 30, slu: 0, sluCell: 110, sluD: 24, sluP: 0.6},
  variants: [
    {label: 'swept', note: 'the ridge stroke', params: {}},
    {label: 'hummocks', note: 'hummock apron with kettles', params: {hum: 1}},
    {label: 'knolls', note: 'satellite knolls', params: {kno: 1}},
    {label: 'slumps', note: 'slump scars and lobes', params: {slu: 1}},
    {label: 'all', note: 'all three', params: {hum: 1, kno: 1, slu: 1}},
    {label: 'all-2x', note: '2x zoom', params: {hum: 1, kno: 1, slu: 1}, lab: {px: 0.5, ox: 230, oy: 200}},
  ],
  wgsl: /* wgsl */`
const PTS = array<vec2f, 4>(vec2f(60.0, 290.0), vec2f(200.0, 180.0), vec2f(350.0, 220.0), vec2f(470.0, 120.0));
fn ridgeSoft(p: vec2f) -> f32 {
  var acc = 0.0;
  for (var k = 0; k < 3; k++) { acc += exp(-segDist(p, PTS[k], PTS[k + 1]) / 28.0); }
  return -28.0 * log(max(acc, 1e-30));
}
fn ridgeHard(p: vec2f) -> f32 { var d = 1e9; for (var k = 0; k < 3; k++) { d = min(d, segDist(p, PTS[k], PTS[k + 1])); } return d; }
// u: 0 on the crest, 1 at the foot (smooth, no lumps), and the fall line there.
fn uAt(p: vec2f) -> f32 { return ridgeSoft(p) / prm.reach; }
fn fallAt(p: vec2f) -> vec2f {
  let e = 2.0;
  let g = vec2f(ridgeSoft(p + vec2f(e, 0.0)) - ridgeSoft(p - vec2f(e, 0.0)), ridgeSoft(p + vec2f(0.0, e)) - ridgeSoft(p - vec2f(0.0, e)));
  return normalize(g + vec2f(1e-5, 0.0));
}
fn curve(t: f32) -> f32 { return t * t * (1.6 - 0.6 * t); }
fn ridgeHeight(p: vec2f) -> f32 {
  let reach = prm.reach * (1.0 + 0.25 * vnoise(p / 120.0, 0x77u));
  let wob = 18.0 * vnoise(p / 70.0, 0x51u);
  let t = 1.0 - clamp((ridgeHard(p) + wob) / reach, 0.0, 1.0);
  let lumps = 1.0 + 0.45 * (0.65 * vnoise(p / 55.0, 0x1863u) + 0.35 * vnoise(p / 22.0, 0x32a7u));
  return 20.0 + prm.amount * curve(t) * lumps;
}

// A compact bump: 1 at the centre, 0 at radius 1, smooth (C1) at the rim.
fn bump(q: f32) -> f32 { let a = clamp(1.0 - q * q, 0.0, 1.0); return a * a; }

// Hummocks: per cell of a jittered lattice, a mound elongated down the fall line at its own centre.
fn hummocks(p: vec2f) -> vec2f {   // (height, debris share)
  let cell = prm.humCell;
  let b = vec2i(floor(p / cell));
  var h = 0.0; var deb = 0.0;
  for (var j = -1; j <= 1; j++) { for (var i = -1; i <= 1; i++) {
    let c = b + vec2i(i, j);
    let ctr = (vec2f(c) + 0.5 + (h2(c, 0x4a11u) - 0.5) * 0.9) * cell;
    let u = uAt(ctr);
    // The apron: from the lower face (u .8) out to 1 + humBand, densest and highest at the foot.
    let band = sstep(0.78, 0.95, u) * (1.0 - sstep(1.0, 1.0 + prm.humBand, u));
    if (band <= 0.0 || h01(c.x, c.y, 0x4a12u) > 0.25 + 0.75 * band) { continue; }
    let f = fallAt(ctr);
    let d = p - ctr;
    let r = cell * (0.45 + 0.35 * h01(c.x, c.y, 0x4a13u)) * (0.7 + 0.3 * band);
    let q = vec2f(dot(d, f) / (r * 1.5), dot(d, vec2f(-f.y, f.x)) / r);   // 1.5 times longer down the fall line
    let kettle = h01(c.x, c.y, 0x4a14u) < 0.18;
    let amp = prm.humH * (0.5 + 0.5 * h01(c.x, c.y, 0x4a15u)) * band * select(1.0, -0.7, kettle);
    let w = bump(length(q));
    h += amp * w;
    deb = max(deb, w * select(1.0, 0.0, kettle));
  } }
  return vec2f(h, deb);
}

// Satellite knolls: sparse, larger, rarer with distance from the foot; each with lumps of its own.
fn knolls(p: vec2f) -> f32 {
  let cell = prm.knoCell;
  let b = vec2i(floor(p / cell));
  var h = 0.0;
  for (var j = -1; j <= 1; j++) { for (var i = -1; i <= 1; i++) {
    let c = b + vec2i(i, j);
    let ctr = (vec2f(c) + 0.5 + (h2(c, 0x5b21u) - 0.5) * 0.8) * cell;
    let u = uAt(ctr);
    let near = sstep(0.95, 1.1, u) * (1.0 - sstep(1.2, 2.2, u));
    if (h01(c.x, c.y, 0x5b22u) > near) { continue; }
    let r = cell * (0.18 + 0.3 * h01(c.x, c.y, 0x5b23u));
    let a = TAU * h01(c.x, c.y, 0x5b24u);
    let d = rot(p - ctr, a);
    let q = d / vec2f(r * 1.35, r);
    let lump = 1.0 + 0.3 * vnoise(p / (0.6 * r), 0x5b25u + u32(c.x * 7 + c.y));
    h += prm.knoH * (0.4 + 0.6 * h01(c.x, c.y, 0x5b26u)) * near * bump(length(q)) * lump;
  } }
  return h;
}

// Slumps: per site near the foot, a scar on the lower face and a lobe past the foot. Local frame: x down the fall line
// at the site, y across it. The lobe holds the scar's volume: depth * scar area = height * lobe area.
fn slumps(p: vec2f) -> vec2f {   // (height change, debris share)
  let cell = prm.sluCell;
  let b = vec2i(floor(p / cell));
  var dh = 0.0; var deb = 0.0;
  for (var j = -1; j <= 1; j++) { for (var i = -1; i <= 1; i++) {
    let c = b + vec2i(i, j);
    // The site: a point of the lattice pulled onto the foot along the fall line (u = 1), kept with probability sluP.
    var s = (vec2f(c) + 0.5 + (h2(c, 0x6c31u) - 0.5) * 0.8) * cell;
    if (h01(c.x, c.y, 0x6c32u) > prm.sluP) { continue; }
    // (In the engine the host would place the sites once per stroke, as it does a crater's rim sectors.)
    var f = fallAt(s);
    for (var k = 0; k < 2; k++) { s += f * (prm.reach * 0.92 - ridgeSoft(s)); f = fallAt(s); }
    if (abs(uAt(s) - 0.92) > 0.05) { continue; }
    let n = vec2f(-f.y, f.x);
    let d = p - s;
    let x = dot(d, f); let y = dot(d, n);
    let size = 0.55 + 0.45 * h01(c.x, c.y, 0x6c33u);
    // Scar: on the lower face, upslope of the site; a steep head (upslope rim) and a shallow toe.
    let ls = 34.0 * size; let ws = 26.0 * size;
    let sx = (x + 0.55 * ls) / ls; let sy = y / ws;
    let head = select(1.0, 1.6, sx < 0.0);                     // the head rim is tighter: a steep headscarp
    let scar = bump(length(vec2f(sx * head, sy)));
    let depth = prm.sluD * size;
    // Lobe: past the foot, a tongue longer than wide and wider than the scar, convex, with two or three arcuate pressure
    // ridges along its front half (the back half rides smooth out of the scar).
    let ll = 48.0 * size; let wl = 34.0 * size;
    let lx = (x - 0.5 * ll) / ll; let ly = y / (wl * (1.0 + 0.35 * clamp(lx, 0.0, 1.0)));   // it spreads toward the toe
    let ql = length(vec2f(lx, ly));
    let body = pow(clamp(1.0 - ql * ql, 0.0, 1.0), 0.5);
    let hl = depth * (ls * ws) / (ll * wl) * 1.5;               // the scar's volume spread over the lobe (about)
    let front = sstep(-0.1, 0.4, lx);                          // ridges only toward the toe
    let ridges = 0.3 * front * max(0.0, sin(TAU * ql * 2.6 + 1.2)) * (1.0 - sstep(0.88, 1.0, ql));
    dh += -depth * scar + hl * body * (1.0 + ridges) + hl * 0.25 * scar;   // some debris stays in the scar
    deb = max(deb, max(scar * 0.8, body));
  } }
  return vec2f(dh, deb);
}

fn heightAt(p: vec2f) -> f32 {
  var h = ridgeHeight(p);
  if (prm.hum > 0.0) { h += hummocks(p).x; }
  if (prm.kno > 0.0) { h += knolls(p); }
  if (prm.slu > 0.0) { h += slumps(p).x; }
  return max(h, 12.0);
}
fn matAt(p: vec2f, h: f32) -> vec4f {
  var deb = 0.0;
  if (prm.hum > 0.0) { deb = max(deb, 0.6 * hummocks(p).y); }
  if (prm.slu > 0.0) { deb = max(deb, slumps(p).y); }
  return vec4f(0.0, 0.55 * deb, 0.0, 0.0);
}
`,
};
