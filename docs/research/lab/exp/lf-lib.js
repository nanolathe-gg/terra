// Shared WGSL for the lf-* experiments (not an experiment itself: it has no default export). Every lf module imports
// LF_PARAMS (its numbers become prm.<name>) and LF_WGSL, then defines its own baseHeight(p) (the authored stroke) and
// baseFall(p) (its smooth downhill direction times its slope, from the stroke's skeleton: steering gullies by the lumpy
// height's own gradient curls them, round 1's finding) and edgeDrive(p, h0) (extra drive, e.g. scarp retreat from a
// plateau's edge: return 0 for none).
//
// The one mechanism: differential erosion through a rock column, as a pure function of position.
//  - The column: beds `thick` units thick (measured across the bed), tilted `dip` degrees toward the bearing `strike`
//    (0 east, 90 south; slope 1 unit/px is 45 degrees), lifted by a cylindrical fold and a dome. Bed k's hardness comes
//    from a repeating cycle of `cyc` beds whose first `hardN` are hard, with per-bed and per-cycle hash variety.
//  - Resistance per unit of depth is the engine's: R = 1 + K * hardness (engine-erosion.wgsl: rock wears 1 / (1 + rockWear
//    * contrast * hardness) as fast as debris), with the hardness scaled by a joint factor jf (vertical joint sets weaken
//    brittle rock near them; soft beds do not hold joints open, so they wear alike either way).
//  - A budget of erosion per point (E soft-rock units times drive(p): relief above base level, slope, broad noise) is spent
//    walking down the column from the authored height h0, bed by bed, in closed form: the surface stops where the budget
//    runs out. Hard beds cost K times more, so they stand; soft beds are stripped. A pure function of (p, h0): no
//    neighbourhood, no iteration, regional replay for free.
// Sources (ideas, reimplemented): Cordonnier et al. 2018 (erodibility from the layer at the surface, folded strata);
// Paris et al. 2019 (a geology function giving hardness at a 3D point; MIT code at aparis69/Implicit-Volumetric-Terrains,
// read, nothing copied); Benes and Forsbach 2001 / Peytavie et al. 2009 (layered material columns).

export const LF_PARAMS = {
  E: 0,          // erosion budget: the depth of perfectly soft rock removed where drive is 1 (height units)
  base: 20,      // base level: the plain's height; nothing erodes below it and the budget grows with height above it
  relief: 130,   // height above base at which the relief term of drive reaches 1
  slopeK: 0,     // drive from the authored slope (|grad h0|, units per px)
  noiseA: 0,     // drive wanders by this share with broad noise (patchy breaching: mesas, buttes)
  noiseW: 90,    // its wavelength, px
  gullyD: 0,     // gullies: extra budget (soft-rock units) in fall-line grooves, less on the spurs between; soft risers dissect, caps hold
  gullyW: 48,    // the gullies' first wavelength, px
  dip: 0,        // bed tilt, degrees (90: vertical beds)
  strike: 0,     // bearing the beds dip toward, degrees (0 east, 90 south)
  thick: 4,      // bed thickness, height units
  zOrg: 0,       // the height the bed coordinate counts from (the engine's columnOrigin)
  cyc: 5,        // beds per cycle
  hardN: 2,      // hard beds at the foot of each cycle
  vary: 0.35,    // share of cycles whose hard band is one bed thicker or thinner
  hier: 0.4,     // share of cycles whose hard band is only middling hard (minor ridges between the major ones)
  capSharp: 5,   // a hard bed holds until nearly breached, then fails (caprock): its cut is (spent share)^(1 + capSharp * hardness)
  K: 12,         // hardness contrast: resistance of the hardest bed relative to soft rock, minus 1
  foldA: 0,      // fold amplitude, height units (cylindrical folds across foldAng)
  foldW: 260,    // fold wavelength, px
  foldAng: 0,    // bearing across the fold axes, degrees
  domeA: 0,      // dome amplitude, height units
  domeR: 150,    // dome radius, px
  domeX: 256, domeY: 192,
  jSets: 0,      // joint sets: 0, 1 or 2 (the second at jAng + jCross)
  jSp: 24,       // joint spacing, px
  jAng: 30,      // bearing of the first set's lines, degrees
  jCross: 80,    // angle between the sets, degrees
  jW: 3,         // joint width, px (soft edge: wider rounds the blocks, spheroidal weathering)
  jWeak: 0.8,    // how much a joint weakens the rock (0..1)
  jRound: 0,     // 1: blocks weaken toward their edges and corners (rounded tors, woolsacks); 0: only at the joint
  blockVar: 0,   // each joint block's rock is up to this share weaker than the strongest (some blocks fail, some stand)
};

// A plateau stroke (engine-shape.wgsl kind 6 style: flat top, steep sides) with scarp retreat from its edge, shared by
// lf-joints and lf-age. Its numbers: cx cy hx hy ang (the rounded box), amount, sideW, edgeK, retreatW, edgeNoise.
export const LF_PLATEAU_PARAMS = {cx: 256, cy: 192, hx: 170, hy: 118, ang: 0.22, amount: 90, sideW: 24, edgeK: 1.6, retreatW: 55, edgeNoise: 0};
export const LF_PLATEAU = /* wgsl */`
// The plateau's outline: a rounded box that wanders broadly (dOut) and finely (the full d).
fn plateauD(p: vec2f, fine: bool) -> f32 {
  var d = sdBox(p, vec2f(prm.cx, prm.cy), vec2f(prm.hx, prm.hy), prm.ang, 40.0) + 22.0 * vnoise(p / 90.0, 0x3a1u);
  if (fine) { d += 8.0 * vnoise(p / 31.0, 0x3a2u); }
  return d;
}
fn baseHeight(p: vec2f) -> f32 {
  let d = plateauD(p, true);
  let t = sstep(0.0, prm.sideW, -d);
  return prm.base + prm.amount * t + 3.0 * t * vnoise(p / 45.0, 0x3a3u);
}
// Smooth fall line: outward across the broad outline, times the side's slope.
fn baseFall(p: vec2f) -> vec2f {
  let e = 2.0;
  let g = vec2f(plateauD(p + vec2f(e, 0.0), false) - plateauD(p - vec2f(e, 0.0), false),
                plateauD(p + vec2f(0.0, e), false) - plateauD(p - vec2f(0.0, e), false)) / (2.0 * e);
  let d = plateauD(p, false);
  let t = clamp(-d / prm.sideW, 0.0, 1.0);
  return normalize(g + vec2f(1e-5, 0.0)) * prm.amount * 6.0 * t * (1.0 - t) / prm.sideW;
}
// Scarp retreat: the edge is attacked hardest and the attack fades inward over retreatW px.
fn edgeDrive(p: vec2f, h0: f32) -> f32 {
  let d = plateauD(p, true);
  if (d > 0.0) { return 0.0; }
  // The retreat is uneven: embayments where it runs ahead, promontories (and, cut off, buttes) where it lags.
  return prm.edgeK * exp(d / prm.retreatW) * max(0.0, 1.0 + prm.edgeNoise * fbm(p, 80.0, 3, 0.5, 0xed6eu));
}
`;

export const LF_WGSL = /* wgsl */`
fn lfDir(deg: f32) -> vec2f { let a = radians(deg); return vec2f(cos(a), sin(a)); }

// The structural lift of the beds at p (height units): cylindrical folds plus a dome.
fn lfFold(p: vec2f) -> f32 {
  var f = 0.0;
  if (prm.foldA != 0.0) { f += prm.foldA * sin(TAU * dot(p, lfDir(prm.foldAng)) / prm.foldW); }
  if (prm.domeA != 0.0) { let d = p - vec2f(prm.domeX, prm.domeY); f += prm.domeA * exp(-dot(d, d) / (prm.domeR * prm.domeR)); }
  return f;
}
// Bed coordinate (bed units) of the point (p, z): beds tilted dip toward strike, lifted by lfFold.
fn lfCoord(p: vec2f, z: f32) -> f32 {
  let th = radians(prm.dip);
  return (cos(th) * (z - prm.zOrg - lfFold(p)) + sin(th) * dot(p, lfDir(prm.strike))) / prm.thick;
}
// Hardness 0..1 of bed k: a cycle of cyc beds, the first hardN hard; some cycles' hard band one bed thicker or thinner.
fn lfHard(k: f32) -> f32 {
  let n = max(prm.cyc, 1.0);
  let cy = floor(k / n); let j = k - cy * n;
  let ci = i32(cy);
  let bump = select(0.0, select(-1.0, 1.0, h1i(ci, 0x2a1u) > 0.5), h1i(ci, 0x19u) < prm.vary);
  let r = h1i(i32(k), 0x3b7u);
  let hardTop = select(0.72 + 0.28 * r, 0.38 + 0.15 * r, h1i(ci, 0x4e5u) < prm.hier);
  return select(0.05, hardTop, j < prm.hardN + bump);   // soft beds alike: a vertical bed spends the whole budget in one bed, so any variety there turns into walls
}
fn lfResist(k: f32) -> f32 { return 1.0 + prm.K * lfHard(k); }

// Distance to the nearest line of one joint set (px), that line's strength 0.45..1, and the index of the block p lies
// in (its cell between two lines, changing exactly at a line's centre, so a block's strength steps inside the joint's
// trough). Joints are segments: each line is cut into pieces 2-5 spacings long, each with its own strength and a small
// sideways offset, so the set reads as joints, not ruled lines.
fn lfJointSet(p: vec2f, ang: f32, sp: f32, seed: u32) -> vec3f {
  let n = lfDir(ang + 90.0); let t = lfDir(ang);
  let w = 0.12 * sp * vnoise(p / 37.0, seed ^ 0x55u);                       // a gentle wander
  let u = (dot(p, n) + w) / sp;
  let line = floor(u + 0.5);
  let segL = sp * (2.0 + 3.0 * h1i(i32(line), seed ^ 0x77u));
  let v = dot(p, t) / segL + h1i(i32(line), seed ^ 0x99u);
  let seg = floor(v);
  let off = 0.18 * hs(i32(line), i32(seg), seed ^ 0x31u);
  let d = abs(u - line - off) * sp;
  let strength = 0.45 + 0.55 * h01(i32(line), i32(seg), seed ^ 0x13u);
  let block = select(line - 1.0, line, u - line - off >= 0.0);
  return vec3f(d, strength, block);
}
// The strength 1 - blockVar .. 1 of the joint block that holds p. Two sets: a hash of the two cells. One set: each fin
// line's own strength, wandering smoothly along it (no cut without a joint).
fn lfBlock(p: vec2f) -> f32 {
  if (prm.blockVar <= 0.0 || prm.jSets < 0.5) { return 1.0; }
  let a = lfJointSet(p, prm.jAng, prm.jSp, 0x1001u);
  if (prm.jSets > 1.5) {
    let b = lfJointSet(p, prm.jAng + prm.jCross, prm.jSp * 1.15, 0x2002u);
    return 1.0 - prm.blockVar * h01(i32(a.z), i32(b.z), 0xb10cu);
  }
  let along = dot(p, lfDir(prm.jAng)) / (prm.jSp * 3.0);
  return 1.0 - prm.blockVar * clamp(h1i(i32(a.z), 0xb10du) * (0.6 + 0.6 * vnoise(vec2f(along, a.z * 7.3), 0xb10eu)), 0.0, 1.0);
}
// Joint weakening 0..1 at p.
fn lfJoint(p: vec2f) -> f32 {
  if (prm.jSets < 0.5) { return 0.0; }
  let a = lfJointSet(p, prm.jAng, prm.jSp, 0x1001u);
  var w1 = a.y * (1.0 - sstep(0.0, prm.jW, a.x));
  if (prm.jRound > 0.0) { w1 = max(w1, prm.jRound * a.y * pow(1.0 - clamp(a.x / (0.5 * prm.jSp), 0.0, 1.0), 2.0)); }
  if (prm.jSets < 1.5) { return w1; }
  let sp2 = prm.jSp * 1.15;
  let b = lfJointSet(p, prm.jAng + prm.jCross, sp2, 0x2002u);
  var w2 = b.y * (1.0 - sstep(0.0, prm.jW, b.x));
  if (prm.jRound > 0.0) { w2 = max(w2, prm.jRound * b.y * pow(1.0 - clamp(b.x / (0.5 * sp2), 0.0, 1.0), 2.0)); }
  // Corners are attacked from two sides: the sum, softly capped.
  let s = w1 + w2;
  return s / (1.0 + 0.35 * s);
}

// Walk down the column from h0 spending the budget, bed by bed, in closed form. jf (0..1] scales every bed's hardness (not its
// resistance (joints). Returns the eroded height.
fn lfErode(p: vec2f, h0: f32, budget: f32, jf: f32) -> f32 {   // (jf scales the hardness, so a joint weakens hard rock)
  if (budget <= 0.0) { return h0; }
  let th = radians(prm.dip); let ct = cos(th); let st = sin(th);
  let f = lfFold(p) + prm.zOrg;
  let s = st * dot(p, lfDir(prm.strike));
  let c = (ct * (h0 - f) + s) / prm.thick;
  var k = floor(c);
  if (ct < 1e-3) { return h0 - budget / (1.0 + prm.K * lfHard(k) * jf); }   // vertical beds: one bed for the whole depth
  var top = h0; var b = budget;
  for (var i = 0; i < 64; i++) {
    let hd = lfHard(k);
    let R = 1.0 + prm.K * hd * jf;
    let bot = (k * prm.thick - s) / ct + f;
    let cost = R * (top - bot);
    if (b <= cost) {
      // Inside this bed the budget runs out. Soft rock wears down evenly; hard rock holds its top until it is nearly
      // breached (it fails by undermining, not by wearing), so its treads stay flat and its rims sharp.
      let share = b / max(cost, 1e-6);
      return top - (top - bot) * pow(share, 1.0 + prm.capSharp * hd);
    }
    b -= cost; top = bot; k -= 1.0;
  }
  return top - b;
}

// The default drive: relief above base level, plus slope, wandering with broad noise.
fn lfDrive(p: vec2f, h0: f32, slope: f32, fall: vec2f) -> f32 {
  let rel = clamp((h0 - prm.base) / prm.relief, 0.0, 1.0);
  var d = rel + prm.slopeK * slope;
  if (prm.noiseA != 0.0) { d *= max(0.0, 1.0 + prm.noiseA * fbm(p, prm.noiseW, 3, 0.5, 0x6d1u)); }
  return d;
}

// The budget at p for authored height h0: E times the drive (relief, slope, noise, edge retreat), plus fall-line gullies.
fn lfBudget(p: vec2f, h0: f32) -> f32 {
  let fall = baseFall(p);
  var budget = prm.E * (lfDrive(p, h0, length(fall), fall) + edgeDrive(p, h0));
  if (prm.gullyD != 0.0 && length(fall) > 1e-4) {
    // Water gathers into gullies down the stroke's fall line (lib stripes(), round 1's filter): two octaves, the groove
    // share |sin|. An absolute depth, not a share of the budget: in soft rock it cuts gullyD, in a hard bed gullyD / R.
    let dir = normalize(fall);
    let g1 = abs(stripes(p, dir, 1.0 / prm.gullyW, 0x4242u).y);
    let g2 = abs(stripes(p, dir, 2.0 / prm.gullyW, 0x4343u).y);
    let on = sstep(0.06, 0.25, length(fall)) * sstep(0.0, 8.0, h0 - prm.base);
    budget = max(0.0, budget + on * prm.gullyD * (0.65 * (2.0 * g1 - 1.0) + 0.35 * (2.0 * g2 - 1.0)));
  }
  return budget;
}

// The whole model at p for a base shape: h0, the budget, joints, the walk; never below the base level.
fn lfHeight(p: vec2f) -> f32 {
  let h0 = baseHeight(p);
  if (prm.E <= 0.0) { return h0; }
  let budget = lfBudget(p, h0);
  let jf = max((1.0 - prm.jWeak * lfJoint(p)) * lfBlock(p), 0.05);
  return max(lfErode(p, h0, budget, jf), min(h0, prm.base));
}

// Strata colours: the bed under the final surface picks rock (hard) or loose ground (soft), each bed a little lighter or
// warmer than its neighbours, steep soft ground reads as debris. A world colour model, not a new palette: every colour
// is a mix of the world's own ground, rock, loose and sand.
fn lfAlbedo(p: vec2f, h: f32, n: vec3f) -> vec3f {
  let slope = length(n.xy) / max(n.z, 1e-3);
  let c0 = lfCoord(p, h);
  let k = floor(c0);
  let hard = lfHard(k);
  let r = h1i(i32(k), 0x5151u);
  let cyc = floor(k / max(prm.cyc, 1.0));
  // Hard beds: the world's rock, some cycles' caps pale (a cream sandstone over red), each bed a little lighter or darker.
  let rockC = mix(lab.cRock.rgb, lab.cSand.rgb, select(0.15 * r, 0.6 + 0.3 * r, h1i(i32(cyc), 0x2bu) < 0.4)) * (0.9 + 0.16 * h1i(i32(k), 0x7u));
  // Soft beds: banded between the world's loose and ground colours by cycle, so risers read as layered.
  let softC = mix(lab.cLoose.rgb, lab.cGround.rgb, 0.2 + 0.6 * h1i(i32(cyc), 0x3cu)) * (0.94 + 0.08 * r);
  var c = mix(softC, rockC, sstep(0.3, 0.45, hard));
  // Debris rests on gentle soft ground below the risers.
  c = mix(c, lab.cLoose.rgb, 0.35 * (1.0 - sstep(0.3, 0.45, hard)) * (1.0 - sstep(0.2, 0.6, slope)));
  c = mix(lab.cGround.rgb, c, sstep(0.5, 2.5, h - prm.base + 4.0 * slope));      // the plain stays ground
  let grit = 0.06 * hs(i32(floor(p.x)), i32(floor(p.y)), 0x51edu) + 0.04 * vnoise(p / 5.0, 0x77u);
  return c * (1.0 + grit);
}
`;
