// Loose material: which stone shapes read at TA's 1x. A board: rows are diameters 2, 3, 5, 8, 13 and 21 px; columns are
// shapes. 0-1 angular chips (facets to an off-centre apex, a flat cap), bare then half-buried; 2-3 rounded superellipses,
// bare then half-buried; 4-5 slabs, bare then half-buried; 6 today's boulders() (engine-bake.wgsl: three plane distances,
// sqrt dome, partly buried); 7 today's debrisStones()/screeHeight (three plane distances, linear cone). Each column also
// draws the ld contact shade round its stones. Original code.
import {LD_SCATTER, LD_ALBEDO} from './ld-common.js';

export default {
  title: 'Loose material: stone shapes at 1x',
  about: 'Rows: 2, 3, 5, 8, 13, 21 px. Columns: angular, angular half-buried, round, round half-buried, slab, slab half-buried, today boulders(), today debrisStones(). Field variants: the scatter alone, for its cost and the effect of suppression.',
  world: 'moon',
  params: {ldRmax: 8, ldJitter: 0.8, ldHeight: 0.8, ldSuppress: 2, ldContact: 0.5, field: 0},
  variants: [
    {label: 'board', note: 'palette, Knoll dither'},
    {label: 'board-raw', note: 'no palette', lab: {pal: 0}},
    {label: 'board-low-sun', note: 'sun at 20 degrees', lab: {el: 20}},
    {label: 'board-2x', note: '2x, the four smallest rows', lab: {px: 0.5, ox: 0, oy: 0}},
    {label: 'field-nosup', note: 'the scatter with a constant mask (supply 0.7, d50 5 px, sigma 1.6), no suppression', params: {field: 1, ldSuppress: 0}},
    {label: 'field-sup2', note: 'the same, the two larger classes suppress each smaller one', params: {field: 1, ldSuppress: 2}},
  ],
  wgsl: /* wgsl */`
${LD_SCATTER}
${LD_ALBEDO}
// The field variants: one constant population, so the timing is the scatter's own (an engine mask is a texture tap).
fn ldMask(q: vec2f) -> LdMask { var m: LdMask; m.a = vec4f(0.7, 5.0, 1.6, 0.3) * prm.field; return m; }
fn ldShapeAt(q: vec2f) -> vec2f { return vec2f(0.3, 0.1); }

const DIAM = array<f32, 6>(2.0, 3.0, 5.0, 8.0, 13.0, 21.0);
var<private> bTone: f32;
var<private> bCover: f32;
var<private> bContact: f32;

// One board stone: returns (height, sdf px).
fn boardStone(q: vec2f, col: i32, r: f32, h0: u32) -> vec2f {
  var st: LdCand; st.c = vec2f(0.0); st.r = r; st.ok = true; st.h0 = h0; st.fines = 0.0;
  if (col <= 5) {
    let shape = select(select(vec2f(0.0, 1.0), vec2f(1.0, 0.0), col < 4), vec2f(0.0, 0.0), col < 2);
    let fines = select(0.0, 0.55, (col & 1) == 1);
    let s = ldStone(q, st, shape, fines);
    return vec2f(s.x * r * prm.ldHeight * (0.75 + 0.5 * ldU(pcg(h0 ^ 0x51u))), s.y);
  }
  // Today's two outlines (engine-bake.wgsl boulders() with boulderRound 0, and debrisStones()).
  let a = ldU(h0) * TAU;
  let qq = rot(q, -a);
  let edge = max(max(abs(qq.x) * 0.9, abs(qq.y)), abs(qq.x * 0.6 + qq.y * 0.8)) / r;
  if (col == 6) {
    let lift = max(0.0, 1.0 - edge * edge);
    let buried = mix(0.15, 0.55, ldU(pcg(h0)));
    return vec2f(max(0.0, sqrt(lift) - buried) / (1.0 - buried) * r * (0.55 + 0.35 * ldU(pcg(h0 + 1u))), (edge - 1.0) * r);
  }
  let e2 = max(max(abs(qq.x), abs(qq.y) * 1.15), abs(qq.x * 0.7 - qq.y * 0.7)) / max(r, 0.5);
  return vec2f(max(0.0, 1.0 - e2) * r * 0.7, (e2 - 1.0) * r);
}

fn heightAt(p: vec2f) -> f32 {
  let ground = 20.0 + 0.6 * fbmBL(p, 40.0, 3, 0.5, labPx(), 0x31u);
  if (prm.field > 0.0) {
    let h = ground + ldScatter(p);
    bTone = ldOut.w; bCover = ldOut.y; bContact = ldOut.z;
    return h;
  }
  let col = i32(floor(p.x / 64.0)); let row = i32(floor(p.y / 64.0));
  bTone = 0.0; bCover = 0.0; bContact = 0.0;
  if (col < 0 || col > 7 || row < 0 || row > 5) { return ground; }
  let d = DIAM[row]; let r = 0.5 * d;
  let n = clamp(i32(floor(52.0 / (d * 1.7))), 1, 5);
  let sp = 56.0 / f32(n);
  let lc = p - vec2f(f32(col), f32(row)) * 64.0 - 4.0;
  let ij = clamp(vec2i(floor(lc / sp)), vec2i(0), vec2i(n - 1));
  var best = 0.0; var edge = 1e9;
  for (var j = -1; j <= 1; j++) { for (var i = -1; i <= 1; i++) {
    let c = ij + vec2i(i, j);
    if (any(c < vec2i(0)) || any(c >= vec2i(n))) { continue; }
    let h0 = hash2u(c.x + col * 17, c.y + row * 31, 0xb0a7du);
    let ctr = (vec2f(c) + 0.5) * sp + (vec2f(ldU(pcg(h0 ^ 5u)), ldU(pcg(h0 ^ 9u))) - 0.5) * sp * 0.2;
    let s = boardStone(lc - ctr, col, r * exp2(0.3 * (ldU(pcg(h0 ^ 3u)) - 0.5)), h0);
    edge = min(edge, s.y);
    if (s.x > best) { best = s.x; bTone = ldU(pcg(h0 ^ 0x7f4a7c15u)) * 2.0 - 1.0; bCover = smoothstep(0.0, 0.15 * r, s.x); }
  } }
  if (best <= 0.0 && edge < 1e8) { bContact = prm.ldContact * (1.0 - smoothstep(0.0, max(0.9 * labPx(), 0.6) + 0.25 * min(r, 6.0), edge)); }
  return ground + best;
}
fn matAt(p: vec2f, h: f32) -> vec4f {
  if (bCover > 0.0) { return vec4f(bCover, 0.0, 0.0, bTone); }
  return vec4f(0.0, 0.0, 0.0, 2.0 + bContact);
}
fn albedoAt(p: vec2f, h: f32, n: vec3f, m: vec4f) -> vec3f { return ldAlbedo(p, h, n, m, lab.cGround.rgb); }
`,
};
