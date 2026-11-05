// H15 part 2: one curve for every shape. A curve is a list of knots [distance share, height share] from the foot (0) to the top (1); the host samples it
// into a table of CV_N + 3 even steps, one before the foot to one past the top, by a monotone cubic (flat beyond both ends), and the shader
// (engine-shape.wgsl curveAt) reads the table with Catmull-Rom interpolation. A stroke with no curve of its own draws its kind's form at its softness; a stroke
// with its own stores `curve: {form, knots?, back?}`: the form alone stays live with softness, knots (edited, so they are what saves) replace it.
import {isRiver, riverSpan, RIVER_MIN_WIDTH} from './sculpt-river.js';
export const CV_N = 64;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sm = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

// A monotone cubic Hermite through the knots (Fritsch-Carlson tangents: zero at the ends and wherever the slope changes sign, so a lip knot above 1 or a flat
// tread never rings). Returns the sampler for x in 0..1; beyond the first and last knot it holds their heights.
export function knotCurve(knots) {
  const n = knots.length, xs = knots.map(k => k[0]), ys = knots.map(k => k[1]), d = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(xs[i + 1] - xs[i], 1e-9));
  const m = ys.map((_, i) => {
    if (!i || i === n - 1) return 0;
    if (d[i - 1] * d[i] <= 0) return 0;
    const h0 = xs[i] - xs[i - 1], h1 = xs[i + 1] - xs[i], w1 = 2 * h1 + h0, w2 = h1 + 2 * h0;
    return (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
  });
  return x => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let k = 0; while (xs[k + 1] < x) k++;
    const h = xs[k + 1] - xs[k], u = (x - xs[k]) / h, u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * ys[k] + (u3 - 2 * u2 + u) * h * m[k] + (-2 * u3 + 3 * u2) * ys[k + 1] + (u3 - u2) * h * m[k + 1];
  };
}
export const sampleKnots = knots => { const f = knotCurve(knots); return Array.from({length: CV_N + 3}, (_, j) => f((j - 1) / CV_N)); };

// ---- forms: short functions of softness that return knots ----
const at = (f, xs) => xs.map(x => [x, f(x)]);
const even = n => Array.from({length: n + 1}, (_, i) => i / n);
const ridge = m => t => t <= 0 ? 0 : (1 - (1 - t) ** 2) ** m;
const SMOOTH = at(sm, even(48));
export const FORMS = {
  // A crater's spurs: (1 - (1 - t)^2)^m, m 3.5 at softness .5 and 5.9 at 0, dense near the foot where the power law bends.
  mountain: s => ({knots: at(ridge(3.5 * 2 ** ((.5 - s) * 1.5)), even(48))}),
  // Reset ground and the cover brushes: a smoothstep over the face.
  plateau: () => ({knots: SMOOTH}),
  // Desert's mesa: a concave apron (a share of the face), then a smoothstep face to the flat cap.
  mesa: () => ({knots: [[0, 0], [.19, .088], [.381, .25], [.52, .367], [.69, .625], [.845, .883], [1, 1]]}),
  // A sheer face: a low foot, the wall (about a third of the width), a crisp shoulder. Softness moves the wall toward the foot and softens it.
  cliff: s => { const f = .42 - (s - .5) * .3; return {knots: [[0, 0], [f * .5, .01], [f, .06], [f + .28, .8], [f + .5, .97], [1, 1]]}; },
  // H27, a landform's half sections (foot 0 to the path 1; both sides read the table until the back is unlinked). A flat top is knots: the table
  // reaches 1 well before the path. Numbers only; softness plays no part.
  // The approved plateau's low grassy foot: its first 10% of rise spans 36.75 px at a 150 px half-width.
  lfPlateau: () => ({knots: [[0, 0], [.08, .006], [.19, .035], [.27, .15], [.37, .65], [.45, .96], [.5, 1], [1, 1]]}),
  lfHill: () => ({knots: [[0, 0], [.28, .1], [.58, .45], [.82, .86], [1, 1]]}),
  lfMountain: () => ({knots: [[0, 0], [.36, .04], [.66, .2], [.88, .6], [1, 1]]}),
  lfTerraced: () => ({knots: [[0, 0], [.08, 0], [.2, .3], [.34, .3], [.46, .62], [.6, .62], [.72, 1], [1, 1]]}),
  // The reviewed shore (landform-shores retail windows): a smoothstep over the outer 90% of the half width, level at the path.
  lfShore: () => ({knots: [...even(24).map(x => [Math.round(900 * x) / 1000, Math.round(1000 * sm(x)) / 1000]), [1, 1]]}),
  // The valleys (cut-to landforms: the ground falls from the foot, 0, to the floor on the path, 1). V: the rise above the floor is linear in the distance (a river's
  // walls stand at one slope); U: the rise is the distance squared (a glacier's trough: a flat floor and steep upper walls). A terraced valley is the V with steps.
  lfValleyV: () => ({knots: [[0, 0], [1, 1]]}),
  lfValleyU: () => ({knots: [...even(16).map(x => [x, Math.round(1000 * (1 - (1 - x) ** 2)) / 1000])]}),
  // P28: a river's valley, over RIVER_SPAN channel half widths: a level floodplain a little wider than the levees, then walls to the plain. The channel is cut in
  // on the GPU from the path's curvature (engine-shape.wgsl riverChannel).
  lfRiver: () => ({knots: [[0, 0], [.1, .04], [.25, .2], [.4, .6], [.55, .93], [.65, 1], [1, 1]]}),
  // P28: a braided river's valley: the floodplain stays level to half the section (the belt of threads lies on it), then the walls.
  lfBraided: () => ({knots: [[0, 0], [.15, .06], [.3, .3], [.42, .75], [.5, 1], [1, 1]]}),
  // A ramp's travel strip: a level center, rounded shoulders.
  lfRamp: () => ({knots: [[0, 0], [.2, .1], [.45, .7], [.6, 1], [1, 1]]}),
};
// A landform's presets: its own four, and main's mesa and cliff where they fit.
export const LANDFORM_FORMS = [['lfPlateau', 'Plateau'], ['lfHill', 'Hill'], ['lfMountain', 'Mountain'], ['lfTerraced', 'Terraced'], ['mesa', 'Mesa'], ['cliff', 'Cliff'], ['lfShore', 'Shore'], ['lfRamp', 'Ramp'], ['lfValleyV', 'Valley V'], ['lfValleyU', 'Valley U'], ['lfRiver', 'River'], ['lfBraided', 'Braided river']];
// The palette entry a landform's section form belongs to (the Tool preset menu restyles a selected landform as that entry); a shore is deep water when it cuts.
export const landformTool = p => ({lfHill: 'hill', lfMountain: 'mountain', lfRamp: 'ramp', lfShore: Math.round(p?.combine || 0) === 1 ? 'deep' : 'shallow', lfValleyU: 'valleyU', lfRiver: 'river', lfBraided: 'braided',
  lfValleyV: Math.round(p?.terraces || 0) > 0 ? 'valleyT' : 'valleyV'})[p?.curve?.form] ?? 'plateau';
// The form a kind draws by default (only a landform's section is edited).
export const defaultForm = kind => kind === 'spurs' ? 'mountain' : kind === 'landform' ? 'lfPlateau' : 'plateau';

// Lean and facing. Lean is the back's length over the face's: the slope toward the lean side runs `ratio` times the length of the other (0: the kind's own,
// which for Reset ground and the cover brushes is 1.7: the face widened .7 * .32 north^2 on the side toward north).
// Facing is the lean side: a map bearing, or the left or right of the drawn direction.
export const FACING_CHOICES = [[0, 'World default (north)'], [1, 'Left of the line'], [2, 'Right of the line'], [3, 'North'], [4, 'North-east'], [5, 'East'], [6, 'South-east'],
  [7, 'South'], [8, 'South-west'], [9, 'West'], [10, 'North-west']];
const R2 = Math.SQRT1_2, BEARINGS = [[0, -1], [R2, -R2], [1, 0], [R2, R2], [0, 1], [-R2, R2], [-1, 0], [-R2, -R2]];
const FAMILY = ['paint', 'erase', 'sand', 'grass'];
export function leanSetup(kind, q) {
  const f = Math.round(q.facing || 0), side = f === 1 ? 1 : f === 2 ? -1 : 0, [bx, by] = BEARINGS[side ? 0 : Math.max(f, 3) - 3];
  const ratio = q.lean > 0 ? clamp(q.lean, .25, 4) : null;
  return {ratio, k: (ratio ?? (FAMILY.includes(kind) ? 1.7 : 1)) - 1, side, bx, by};
}

// Variability: roughness stays the master; these hold what each kind multiplies it by.
//   outline: how far the outline wanders (radius share per unit roughness)
//   width:   the cell's width noise, 1 + roughness * k * noise, clamped to [lo, hi]
//   height:  the height lumps, 1 + roughness * (a * noiseCW + b * noiseDet)
// Reset ground and the cover brushes (the plateau family) wander and widen; a crater's spurs lump; the other kinds keep a small outline wander.
export function variability(kind, {naturalPlateau}) {
  return {amp: naturalPlateau ? .95 : .2, wK: naturalPlateau ? 1.3 : 0, wLo: naturalPlateau ? .55 : 1, wHi: naturalPlateau ? 1.7 : 1, hgtA: 0, hgtB: kind === 'spurs' ? .09 : 0};
}

// The kinds that take a cross-section curve and terraces: the landform.
export const SECTION_KINDS = ['landform'];

// The stroke's curve: {knots, back?} (form at the stroke's softness unless it carries knots of its own).
export function strokeKnots(kind, q) {
  const c = q.curve, f = FORMS[c?.form] ? c.form : defaultForm(kind), base = FORMS[f](q.softness);
  if (!c?.knots) return base;
  return {knots: c.knots, back: c.back ?? base.back};
}

// The front table (and the back one where the shape needs a second curve) of a stroke, with the uniforms its curve adds, or null for a kind with no
// cross-section. lip: the table leaves 0..1 (a land lip above 1, a water lip below 0), which the shader then keeps instead of clamping.
export function strokeCurve(kind, q) {
  if (!['paint', 'erase', 'sand', 'grass', 'smooth', 'spurs', 'landform'].includes(kind)) return null;
  const k = strokeKnots(kind, q), out = {front: sampleKnots(k.knots), u: {}};
  // A landform always has a back: the front's own until the sides are unlinked.
  const back = kind === 'landform' ? k.back ?? k.knots : k.back;
  if (kind === 'landform') out.back = sampleKnots(back);
  out.u.cvLip = k.knots.concat(kind === 'landform' ? back : []).some(p => p[1] > 1 || p[1] < 0) ? 1 : 0;
  if (SECTION_KINDS.includes(kind)) Object.assign(out.u, {sSteps: Math.round(clamp(q.terraces, 0, 8)), sFlat: Math.min(q.ledge, .95), sJit: q.terraceJitter, sBreak: clamp(q.breakup || 0, 0, 1)});
  return out;
}
// H27: a landform's two half widths (px): the whole section is the diameter, and the back (the lean side) is Lean times the front.
export function landformSides(q) {
  const ratio = q.lean > 0 ? clamp(q.lean, .25, 4) : 1, front = 2 * (isRiver(q) ? riverSpan(q) * Math.max(q.radius, RIVER_MIN_WIDTH / 2) : q.radius) / (1 + ratio);
  return {front, back: front * ratio, ratio};
}
// H27: which side of the way a landform is drawn its back (the lean side) is on, +1 left and -1 right, decided once by the path's first segment (dx, dy): Left or
// Right of the line, or whichever side a map bearing (turned with the shape's frame) falls on.
export function landformBackSide(lean, turn, dx, dy) {
  const bx = lean.bx * Math.cos(turn) - lean.by * Math.sin(turn), by = lean.bx * Math.sin(turn) + lean.by * Math.cos(turn);
  return lean.side || ((dy * bx - dx * by) < 0 ? -1 : 1);
}
// H27: the most a cell can stand from a landform's path and still be on it (world px; `scale` is the frame's), over the widest side grown by the width
// variation at its largest weight, the wander, and the spurs. The segment boxes and nodeBounds both use it.
export function landformReach(q, scale = 1, widthMul = 1) {
  const {front, back} = landformSides(q), weight = Math.max(q.varyFoot ?? 1, q.varyMiddle ?? 1);
  return Math.max(front, back) * widthMul * Math.exp(1.35 * (q.widthVary || 0) * weight) + (isRiver(q) ? 0 : (q.wander || 0) * scale * weight) + 2;
}
// The along-the-path knots a landform carries (the elevation's share along the path, 0 to 1.2), flat at 1 until edited.
export const ALONG_FLAT = [[0, 1], [1, 1]];
export const alongKnots = q => q.along?.length >= 2 ? q.along : ALONG_FLAT;


// The table as the shader reads it (Catmull-Rom over the CV_N + 3 samples), so the editor draws what a stroke draws.
export function readTable(tab, t) {
  const x = clamp(t, 0, 1) * CV_N, k = Math.min(Math.floor(x), CV_N - 1), f = x - k, p0 = tab[k], p1 = tab[k + 1], p2 = tab[k + 2], p3 = tab[k + 3];
  return p1 + .5 * f * (p2 - p0 + f * (2 * p0 - 5 * p1 + 4 * p2 - p3 + f * (3 * (p1 - p2) + p3 - p0)));
}
// The lean a stroke shows: its own, else the kind's default.
export function leanRatio(kind, q) { return leanSetup(kind, q).k + 1; }
// Knots for a form that has many (a power law or a smoothstep sampled finely): nine even ones, the starting point for dragging.
export function thinKnots(knots, n = 9) { const f = knotCurve(knots); return Array.from({length: n}, (_, i) => [i / (n - 1), Math.round(f(i / (n - 1)) * 1000) / 1000]); }

// The editor's preview: the stroke's table, foot to top, n + 1 samples (share of the rise), and its back's.
export function sectionPreview(kind, q, n = 160) {
  const k = strokeKnots(kind, q), tab = sampleKnots(k.knots), back = kind === 'landform' && k.back ? sampleKnots(k.back) : tab, at = tb => Float32Array.from({length: n + 1}, (_, i) => readTable(tb, i / n));
  return {ys: at(tab), back: at(back), knots: k.knots};
}

// Resolve the authored height only at evaluation/preview time, so the same
// sea-relative stroke follows the map's sea level without rewriting its recipe.
export const landformElevation = (q, sea) => q.elevation + (Math.round(q.heightReference || 0) === 1 ? sea : 0);

// One authored step count/ledge/variation set; choose the coordinate system.
// Resolve to the existing shared profile or coastline pass, never both.
// Whether a resolved landform (landformSteps) runs the shared coast pass: fingers, shoreline steps or shore plates.
// A landform makes water when it cuts or flattens, or raises to a height at or under the sea (sea-relative): Surf has a shore to work only then.
export const landformMakesWater = q => Math.round(q.combine || 0) >= 1 || (Math.round(q.heightReference || 0) === 1 && q.elevation <= 0);
export const landformShore = q => q.fingers > 0 || Math.round(q.shoreLayers) >= 1 || q.shorePlates > 0;
export function landformSteps(q) {
  const reference=Math.round(clamp(q.stepReference||0,0,2)),shore=reference>0;
  const count=Math.round(clamp(q.terraces||0,0,shore?12:8));
  return {...q,terraces:shore?0:count,shoreLayers:shore?count:0,layerStyle:reference===2?1:0,
    layerLedge:clamp(q.ledge??.6,.4,.95),layerRough:clamp(q.terraceJitter??.35,0,1)};
}
