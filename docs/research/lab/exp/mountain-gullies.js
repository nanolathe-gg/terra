// Round 1's result in the lab: a mountain built like engine-shape.wgsl kind 4 (a swept curve times value-noise lumps,
// a jagged crest), with and without the slope-aligned gully filter steered by the stroke's own fall line.
export default {
  title: 'Mountain with gullies',
  about: 'A three-segment ridge stroke with the engine\'s lumps, then lib.wgsl gullies() steered by the stroke\'s analytic fall line (soft minimum at bends).',
  world: 'green',
  params: {gully: 0.45, wave: 62, octaves: 5, reach: 150, amount: 125},
  variants: [
    {label: 'swept', note: 'today', params: {gully: 0}},
    {label: 'gullies', note: 'fall-line steered', params: {}},
    {label: 'gullies-raw', note: 'no palette', params: {}, lab: {pal: 0}},
    {label: 'gullies-2x', note: '2x zoom, same world', params: {}, lab: {px: 0.5, ox: 160, oy: 110}},
  ],
  wgsl: /* wgsl */`
const PTS = array<vec2f, 4>(vec2f(60.0, 290.0), vec2f(200.0, 180.0), vec2f(350.0, 220.0), vec2f(470.0, 120.0));
fn ridge(p: vec2f) -> vec3f {   // (hard distance, soft distance, unused)
  var d = 1e9; var acc = 0.0;
  for (var k = 0; k < 3; k++) { let s = segDist(p, PTS[k], PTS[k + 1]); d = min(d, s); acc += exp(-s / 28.0); }
  return vec3f(d, -28.0 * log(max(acc, 1e-30)), 0.0);
}
fn curve(t: f32) -> f32 { return t * t * (1.6 - 0.6 * t); }
fn dcurve(t: f32) -> f32 { return t * (3.2 - 1.8 * t); }
fn heightAt(p: vec2f) -> f32 {
  let r3 = ridge(p);
  let reach = prm.reach * (1.0 + 0.25 * vnoise(p / 120.0, 0x77u));
  let wob = 18.0 * vnoise(p / 70.0, 0x51u);
  let t = 1.0 - clamp((r3.x + wob) / reach, 0.0, 1.0);
  let lumps = 1.0 + 0.45 * (0.65 * vnoise(p / 55.0, 0x1863u) + 0.35 * vnoise(p / 22.0, 0x32a7u));
  let jag = 1.0 - 0.35 * (0.5 - 0.5 * (0.6 * vnoise(p / 42.0, 0x6b1u) + 0.4 * vnoise(p / 16.0, 0x1d7u)));
  let h0 = 20.0 + prm.amount * curve(t) * lumps * mix(1.0, jag, sstep(0.5, 0.9, curve(t)));
  if (prm.gully <= 0.0) { return h0; }
  // The fall line: the gradient of the soft distance (finite difference of an analytic function, no buffer reads).
  let e = 1.0;
  let ts = 1.0 - clamp(ridge(p).y / prm.reach, 0.0, 1.0);
  let gsx = ridge(p + vec2f(e, 0.0)).y - ridge(p - vec2f(e, 0.0)).y;
  let gsy = ridge(p + vec2f(0.0, e)).y - ridge(p - vec2f(0.0, e)).y;
  let steer = -vec2f(gsx, gsy);   // uphill is toward the crest: minus the distance gradient
  let slope = prm.amount * dcurve(t) * lumps / reach;
  let foot = sstep(0.0, 0.25, t);
  return gullies(p, h0, steer, slope * foot, prm.wave, prm.gully, i32(prm.octaves), 3.0 * labPx(), 0x1234u);
}
fn matAt(p: vec2f, h: f32) -> vec4f { return vec4f(0.0); }
`,
};
