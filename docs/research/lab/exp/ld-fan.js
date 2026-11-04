// Loose material: a fan at a gully mouth (alluvial or debris-flow), with downfan fining, channel lag, levees and snouts.
// Shape: a range front across the top, cut by a canyon; at its mouth a fan, a cone in polar coordinates round the apex,
// concave in profile (h = fanH (1 - t)^1.3, t = distance / radius). Radial distributary channels (a jittered lattice in
// angle, each wandering) incise it, shallower downfan; one is the active channel, deeper (the fanhead trench). The
// debris-flow fan is steeper and its channels end in lobes: a levee ridge on each side and a rounded snout of boulders.
// Material, one population per rule (ld-common.js scatter): coarse and poorly sorted at the apex, finer downfan (d50 falls
// with t: downfan fining), a clean coarse lag in the active channel, gravel bars beside it, a packed and varnished
// pavement on the older surfaces between the channels, sand at the distal fringe; boulders on the levees and snouts.
// Three artist numbers again: supply, size (d50 at the apex, px), sorting (downfan fining and channel sorting, 0..1).
// Original code; the morphology (downfan fining, fanhead trench, lobes, levees, snouts, varnished inactive surfaces) is
// from the fan literature (see the report).
import {LD_SCATTER, LD_ALBEDO} from './ld-common.js';

export default {
  title: 'Loose material: fan at a gully mouth',
  about: 'A cone with radial channels; downfan fining, channel lag, varnished pavement between channels; a debris-flow fan with levees and boulder snouts.',
  world: 'desert',
  params: {debris: 0, fanH: 34, fanSlope: 0.14, supply: 0.8, size: 12, sorting: 0.85, varnish: 1, today: 0,
           ldRmax: 12, ldJitter: 0.85, ldHeight: 0.7, ldSuppress: 2, ldContact: 0.5},
  variants: [
    {label: 'today', note: 'the fan shape with one class of chips from the deposit (no sorting, no channels in the material)', params: {today: 1, ldSuppress: 0, ldContact: 0, varnish: 0}},
    {label: 'alluvial', note: 'alluvial fan: slope 0.14, downfan fining, lag, pavement, varnish'},
    {label: 'unsorted', note: 'sorting 0', params: {sorting: 0}},
    {label: 'debris', note: 'debris-flow fan: slope 0.24, lobes, levees, boulder snouts', params: {debris: 1, fanH: 48, fanSlope: 0.24, size: 16, ldRmax: 14}},
    {label: 'red', note: 'red colours, debris-flow fan, supply 0.5', params: {debris: 1, fanH: 48, fanSlope: 0.24, size: 16, ldRmax: 14, supply: 0.5}, lab: {world: 'red'}},
    {label: 'alluvial-2x', note: '2x on the fanhead', lab: {px: 0.5, ox: 130, oy: 100}},
  ],
  wgsl: /* wgsl */`
${LD_SCATTER}
${LD_ALBEDO}
const PLAIN = 20.0;
const APEX = vec2f(250.0, 128.0);
fn frontY(x: f32) -> f32 { return 118.0 + 14.0 * vnoise(vec2f(x / 70.0, 2.0), 0x81u); }
fn canyonX(y: f32) -> f32 { return APEX.x + 10.0 * vnoise(vec2f(5.0, y / 30.0), 0x82u); }
fn fanR() -> f32 { return prm.fanH / prm.fanSlope; }

// The range: rising steeply north of the front, with lumps, cut by the canyon.
fn range(p: vec2f) -> f32 {
  let fy = frontY(p.x);
  let up = sstep(fy + 6.0, fy - 90.0, p.y);
  var h = PLAIN + 130.0 * up + 12.0 * fbm(p, 50.0, 3, 0.5, 0x83u) * up;
  h = gullies(p, h, vec2f(0.0, -1.0), 1.4 * up * (1.0 - up) * 4.0, 34.0, 0.5, 3, 3.0 * labPx(), 0x86u);
  let cx = canyonX(p.y);
  let canyon = exp(-pow((p.x - cx) / (14.0 + 0.25 * max(fy - p.y, 0.0)), 2.0)) * sstep(fy + 10.0, fy - 10.0, p.y);
  h = mix(h, PLAIN + prm.fanH + 0.35 * max(APEX.y - p.y, 0.0), canyon);
  return h;
}

// Polar coordinates round the apex: (angle from due south, distance, t = distance / radius).
fn polar(p: vec2f) -> vec3f {
  let d = p - APEX;
  return vec3f(atan2(d.x, d.y), length(d), length(d) / fanR());
}
struct Chan { depth: f32, near: f32, act: f32, levee: f32, snout: f32, lobeEnd: f32 };
// The distributaries: primaries every ~0.3 rad from the apex, secondaries every ~0.13 rad from a third of the radius.
fn channels(p: vec2f) -> Chan {
  var c: Chan; c.near = 0.0; c.depth = 0.0; c.act = 0.0; c.levee = 0.0; c.snout = 0.0; c.lobeEnd = 1.0;
  let pl = polar(p);
  if (pl.z > 1.3 || p.y < APEX.y - 14.0) { return c; }
  let north = sstep(APEX.y - 14.0, APEX.y + 2.0, p.y);   // channels fade in below the canyon mouth
  // A debris-flow fan has a few lobes: wide primaries only.
  let octs = select(2, 1, prm.debris > 0.0);
  for (var oct = 0; oct < octs; oct++) {
    let sp = select(select(0.3, 0.55, prm.debris > 0.0), 0.13, oct == 1);
    let base = i32(floor(pl.x / sp));
    for (var i = base - 1; i <= base + 1; i++) {
      let seed = u32(oct * 977) + 0x90u;
      let th = (f32(i) + 0.5 + 0.6 * (h1i(i, seed) - 0.5)) * sp + 0.12 * vnoise(vec2f(pl.y / 45.0, f32(i) * 3.1), seed + 1u);
      let across = abs(pl.x - th) * max(pl.y, 1.0);
      let start = select(0.0, 0.3, oct == 1);
      let end = 0.75 + 0.3 * h1i(i, seed + 2u);
      if (pl.z < start || pl.z > end + 0.35) { continue; }
      let isActive = select(0.0, 1.0, oct == 0 && i == 0);
      let w = (2.5 + 5.0 * pl.z) * (1.0 + isActive) * (1.0 + 0.8 * prm.debris);
      let prof = exp(-pow(across / w, 2.0));
      let fade = sstep(start, start + 0.08, pl.z) * (1.0 - sstep(end - 0.15, end, pl.z)) * north;
      let dep = (select(1.6, 0.8, oct == 1) + 2.5 * isActive * (1.0 - pl.z)) * (1.0 - 0.6 * pl.z) * fade;
      c.depth = max(c.depth, dep * prof);
      c.near = max(c.near, prof * fade);
      c.act = max(c.act, isActive * prof * fade);
      if (prm.debris > 0.0 && oct == 0) {
        // Levees: ridges either side, ~1.4 widths out; the lobe's snout: a rounded mound at the channel's end.
        let lv = exp(-pow((across - 1.5 * w) / (0.6 * w), 2.0)) * fade;
        c.levee = max(c.levee, lv);
        let sd = length(vec2f(across / (2.2 * w), (pl.z - end) * fanR() / (1.6 * w)));
        c.snout = max(c.snout, exp(-sd * sd) * sstep(0.2, 0.5, end) * north);
        if (prof > 0.5) { c.lobeEnd = end; }
      }
    }
  }
  return c;
}
fn fanH(p: vec2f) -> f32 {
  let pl = polar(p);
  if (pl.z >= 1.0) { return 0.0; }
  return prm.fanH * pow(1.0 - pl.z, 1.3);
}
fn ground(p: vec2f) -> f32 {
  let ch = channels(p);
  var f = PLAIN + fanH(p) - ch.depth + 0.8 * fbm(p, 40.0, 2, 0.5, 0x84u);
  if (prm.debris > 0.0) { f += 3.0 * ch.levee + 5.0 * ch.snout; }
  return smax(range(p), f, 6.0);
}

fn ldMask(q: vec2f) -> LdMask {
  var m: LdMask;
  let pl = polar(q);
  let onFan = (1.0 - sstep(0.95, 1.1, pl.z)) * sstep(APEX.y - 6.0, APEX.y + 6.0, q.y);
  let Z = prm.size; let s = prm.sorting;
  if (prm.today > 0.0) {
    m.a = vec4f(0.3 * onFan * prm.supply, 6.0, 0.2, 0.3);
    return m;
  }
  let ch = channels(q);
  let t = clamp(pl.z, 0.0, 1.0);
  // Older surfaces between channels: a packed pavement whose gravel fines downfan.
  let fine = mix(1.0, pow(1.0 - t, 1.6) * 0.85 + 0.15, s);
  var a = vec4f(0.7, max(1.6, 0.35 * Z * fine), mix(1.6, 0.55, s), 0.7);
  // Channels: bars of gravel at the margins, a coarse clean lag in the thalweg (most in the active channel).
  a = mix(a, vec4f(0.75, max(1.6, 0.4 * Z * fine), mix(1.6, 0.7, s), 0.35), sstep(0.2, 0.5, ch.near));
  let lag = sstep(0.55, 0.9, ch.near) * (0.5 + 0.5 * ch.act);
  a = mix(a, vec4f(0.8, max(2.0, 0.8 * Z * fine), mix(1.6, 0.55, s), 0.08), lag);
  // The distal fringe: sand and silt, few stones.
  a = mix(a, vec4f(0.08, 1.6, 1.0, 0.9), sstep(0.8, 1.0, t) * s);
  a.x *= onFan;
  // Off the fan: the plain's sparse gravel; the range: residual chips.
  let rng = sstep(PLAIN + 20.0, PLAIN + 60.0, range(q));
  a = mix(a, vec4f(0.08, 2.5, 1.2, 0.6), (1.0 - onFan) * (1.0 - rng));
  a = mix(a, vec4f(0.25, 4.0, 1.3, 0.3), rng);
  m.a = vec4f(a.x * prm.supply, a.yzw);
  if (prm.debris > 0.0) {
    // Debris flows: boulders pushed to the levees and the snouts (unsorted flows keep them spread through the lobe).
    let b = max(ch.levee, ch.snout) * onFan;
    m.b = vec4f(mix(0.25 * ch.near, 0.75 * b, s) * prm.supply, Z * mix(0.9, 1.25, s), 0.5, 0.0);
  }
  return m;
}
fn ldShapeAt(q: vec2f) -> vec2f {
  // Water rounds; debris flows and the range break.
  let pl = polar(q);
  let fluvial = (1.0 - prm.debris) * (1.0 - sstep(0.95, 1.1, pl.z));
  return vec2f(mix(0.1, 0.75, fluvial), 0.05);
}

var<private> gAge: f32;
var<private> gSand: f32;
fn heightAt(p: vec2f) -> f32 {
  let g = ground(p);
  let ch = channels(p);
  let pl = polar(p);
  let onFan = (1.0 - sstep(0.95, 1.1, pl.z)) * sstep(APEX.y - 6.0, APEX.y + 6.0, p.y);
  // Surface age: the active channel is fresh, the surfaces between channels old (varnished), patchy by an old-lobe noise.
  gAge = onFan * (1.0 - sstep(0.2, 0.6, ch.near)) * sstep(-0.3, 0.3, vnoise(p / 60.0, 0x85u) + 0.25) * prm.varnish;
  gSand = sstep(0.82, 1.0, pl.z) * (1.0 - sstep(1.0, 1.25, pl.z)) * prm.sorting * (1.0 - prm.today);
  return g + ldScatter(p);
}
fn matAt(p: vec2f, h: f32) -> vec4f {
  if (ldOut.y > 0.0) { return vec4f(ldOut.y, gAge, 0.0, ldOut.w); }
  return vec4f(0.0, gAge, gSand, 2.0 + ldOut.z);
}
fn albedoAt(p: vec2f, h: f32, n: vec3f, m: vec4f) -> vec3f {
  let slope = length(n.xy) / max(n.z, 1e-3);
  var g = mix(lab.cGround.rgb, lab.cGrass.rgb, sstep(0.5, 1.2, slope) * (1.0 - m.x));
  let mm = vec4f(m.x, 0.0, m.z, m.w);
  var c = ldAlbedo(p, h, n, mm, g);
  // Varnish darkens and reddens old stones and the pavement between them.
  c *= mix(vec3f(1.0), vec3f(0.78, 0.72, 0.68), m.y * 0.85);
  return c;
}
`,
};
