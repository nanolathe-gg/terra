// H15 part 2: one curve for every shape. A curve is a list of knots [distance share, height share] from the foot (0) to the top (1); the host samples it
// into a table of CV_N + 3 even steps, one before the foot to one past the top, by a monotone cubic (flat beyond both ends), and the shader
// (engine-shape.wgsl curveAt) reads the table with Catmull-Rom interpolation. A stroke with no curve of its own draws its kind's form at its softness; a stroke
// with its own stores `curve: {form, knots?, back?}`: the form alone stays live with softness, knots (edited, so they are what saves) replace it. Per-kind
// noise stays in the shader.
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

// ---- forms: short functions of softness that return knots (and, for the shouldered hill, a back) ----
const at = (f, xs) => xs.map(x => [x, f(x)]);
const even = n => Array.from({length: n + 1}, (_, i) => i / n);
const ridge = m => t => t <= 0 ? 0 : (1 - (1 - t) ** 2) ** m;
const SMOOTH = at(sm, even(48));
export const FORMS = {
  // The classic shouldered hill: a short steep face (rises 0, .02, .34, 1 at thirds of the width), and (back) a plain smooth slope the lean stretches.
  hill: () => ({knots: [[0, 0], [1 / 3, .02], [2 / 3, .34], [1, 1]], back: SMOOTH}),
  // (1 - (1 - t)^2)^m, m 3.5 at softness .5 and 5.9 at 0: dense near the foot where the power law bends.
  mountain: s => ({knots: at(ridge(3.5 * 2 ** ((.5 - s) * 1.5)), even(48))}),
  plateau: () => ({knots: SMOOTH}),
  // Desert's mesa: a concave apron (a share of the face), then a smoothstep face to the flat cap.
  mesa: () => ({knots: [[0, 0], [.19, .088], [.381, .25], [.52, .367], [.69, .625], [.845, .883], [1, 1]]}),
  // A sheer face: a low foot, the wall (about a third of the width), a crisp shoulder. Softness moves the wall toward the foot and softens it.
  cliff: s => { const f = .42 - (s - .5) * .3; return {knots: [[0, 0], [f * .5, .01], [f, .06], [f + .28, .8], [f + .5, .97], [1, 1]]}; },
  // Three flat treads with risers between.
  terrace: () => ({knots: [[0, 0], [.06, 0], [.28, .33], [.38, .33], [.6, .67], [.7, .67], [.92, 1], [1, 1]]}),
  // The plain hill of a ridge (spurs and crest options): the mountain's power law at exponent 2.
  dome: () => ({knots: at(ridge(2), even(48))}),
  // H27, a landform's half sections (foot 0 to the path 1; both sides read the table until the back is unlinked). A flat top is knots: the table
  // reaches 1 well before the path. Numbers only; softness plays no part.
  lfPlateau: () => ({knots: [[0, 0], [.1, 0], [.34, 1], [1, 1]]}),
  lfHill: () => ({knots: [[0, 0], [.28, .1], [.58, .45], [.82, .86], [1, 1]]}),
  lfMountain: () => ({knots: [[0, 0], [.36, .04], [.66, .2], [.88, .6], [1, 1]]}),
  lfTerraced: () => ({knots: [[0, 0], [.08, 0], [.2, .3], [.34, .3], [.46, .62], [.6, .62], [.72, 1], [1, 1]]}),
};
export const FORM_NAMES = ['hill', 'mountain', 'plateau', 'mesa', 'cliff', 'terrace'];
// A landform's presets: its own four, and main's mesa and cliff where they fit.
export const LANDFORM_FORMS = [['lfPlateau', 'Plateau'], ['lfHill', 'Hill'], ['lfMountain', 'Mountain'], ['lfTerraced', 'Terraced'], ['mesa', 'Mesa'], ['cliff', 'Cliff']];
// The forms the curve editor offers a kind, as [id, label].
export const formChoices = kind => kind === 'landform' ? LANDFORM_FORMS : FORM_NAMES.map(f => [f, f[0].toUpperCase() + f.slice(1)]);
// The form a kind draws by default.
export const defaultForm = (kind, shouldered) => kind === 'hill' ? (shouldered ? 'hill' : 'dome') : kind === 'mountain' ? 'mountain' : kind === 'landform' ? 'lfPlateau' : 'plateau';

// Lean and facing. Lean is the back's length over the face's: the slope toward the lean side runs `ratio` times the length of the other (0: the kind's own,
// which is the shouldered hill's softness-driven back and, for the plateau family, 1.7: the face widened .7 * .32 north^2 on the side toward north).
// Facing is the lean side: a map bearing, or the left or right of the drawn direction. A shouldered hill's face is the side opposite. A stroke with a Face
// width has no lean of its own: the px face stays what it says until a lean is set.
export const FACING_CHOICES = [[0, 'World default (north)'], [1, 'Left of the line'], [2, 'Right of the line'], [3, 'North'], [4, 'North-east'], [5, 'East'], [6, 'South-east'],
  [7, 'South'], [8, 'South-west'], [9, 'West'], [10, 'North-west']];
const R2 = Math.SQRT1_2, BEARINGS = [[0, -1], [R2, -R2], [1, 0], [R2, R2], [0, 1], [-R2, R2], [-1, 0], [-R2, -R2]];
const FAMILY = ['paint', 'erase', 'plateau', 'offset', 'sand', 'grass'];
export function leanSetup(kind, q) {
  const f = Math.round(q.facing || 0), side = f === 1 ? 1 : f === 2 ? -1 : 0, [bx, by] = BEARINGS[side ? 0 : Math.max(f, 3) - 3];
  const ratio = q.lean > 0 ? clamp(q.lean, .25, 4) : null;
  return {ratio, k: (ratio ?? (FAMILY.includes(kind) && !(q.facePx > 0) ? 1.7 : 1)) - 1, side, bx, by};
}
// A hill's shouldered geometry (face vector, end taper) is how it leans, so a hill with ridge options, or at lean 1, is the plain radial one.
export const isShouldered = (kind, q, ridge) => kind === 'hill' && !ridge && q.lean !== 1;
// The shouldered hill's face and back widths, shares of the radius: softness sets both, Face width sets the face, and a lean sets the back from the face.
export function hillWidths(q, ratio) {
  const soft = .66 + (q.softness - .5) * .9, face = q.facePx > 0 ? q.facePx / q.radius : soft;
  return {face, back: ratio ? ratio * face : q.softness === .5 ? 1.34 : 2 - soft};
}

// Variability: roughness stays the master; these tables hold what each kind multiplies it by, and the stroke's three sliders (outlineVar, widthVar, heightVar,
// 100% each) scale them, so the defaults draw what the per-kind constants drew.
//   outline: how far the outline wanders (radius share per unit roughness)
//   width:   the cell's width noise, 1 + roughness * k * noise, clamped to [lo, hi]
//   height:  the height lumps, 1 + roughness * (a * noiseCW + b * noiseDet)
// Left as they are because they are different ideas: the plateau's level wander (rough * 3 height units, not a share), the shouldered hill's cross shift and
// local radius (the face's own wander), and the deep stroke's shelf and core.
const OUTLINE = {deep: 1.1, family: .95, hill: .85, other: .2};
const WIDTH = {deep: [1.6, .45, 1.9], family: [1.3, .55, 1.7]};
const HEIGHT = {hill: [.75, .3], dome: [0, .09], mountain: [0, .09], lower: [0, .09]};
export function variability(kind, {naturalWater, naturalPlateau, shouldered, plainHill}, q) {
  const o = q.outlineVar ?? 1, w = q.widthVar ?? 1, h = q.heightVar ?? 1;
  const wd = naturalWater ? WIDTH.deep : naturalPlateau ? WIDTH.family : null;
  const ht = shouldered ? HEIGHT.hill : plainHill ? HEIGHT.dome : HEIGHT[kind] ?? null;
  return {amp: (naturalWater ? OUTLINE.deep : naturalPlateau ? OUTLINE.family : shouldered ? OUTLINE.hill : OUTLINE.other) * o,
    wK: wd ? wd[0] * w : 0, wLo: wd?.[1] ?? 1, wHi: wd?.[2] ?? 1, hgtA: ht ? ht[0] * h : 0, hgtB: ht ? ht[1] * h : 0};
}

// The kinds that take a cross-section curve, its face width and terraces.
export const SECTION_KINDS = ['plateau', 'offset', 'hill', 'mountain', 'deep', 'shallow', 'landform'];
const isWater = kind => kind === 'deep' || kind === 'shallow';

// The stroke's curve: {knots, back?} (form at the stroke's softness unless it carries knots of its own).
export function strokeKnots(kind, q, shouldered) {
  const c = q.curve, f = FORMS[c?.form] ? c.form : defaultForm(kind, shouldered), base = FORMS[f](q.softness);
  if (!c?.knots) return base;
  return {knots: c.knots, back: c.back ?? base.back};
}

// The front table (and the back one where the shape needs a second curve) of a stroke, with the uniforms its curve adds, or null for a kind with no
// cross-section. lip: the table leaves 0..1 (a land lip above 1, a water lip below 0), which the shader then keeps instead of clamping.
export function strokeCurve(kind, q, {shouldered}) {
  if (!['paint', 'erase', 'sand', 'grass', 'lower', 'smooth', 'offset', 'deep', 'shallow', 'plateau', 'mountain', 'hill', 'landform'].includes(kind)) return null;
  const k = strokeKnots(kind, q, shouldered), out = {front: sampleKnots(k.knots), u: {}};
  // A landform always has a back: the front's own until the sides are unlinked.
  const back = kind === 'landform' ? k.back ?? k.knots : k.back;
  if (shouldered) out.back = sampleKnots(k.back ?? SMOOTH);
  else if (kind === 'landform') out.back = sampleKnots(back);
  out.u.cvLip = k.knots.concat(kind === 'landform' ? back : []).some(p => p[1] > 1 || p[1] < 0) ? 1 : 0;
  if (SECTION_KINDS.includes(kind)) Object.assign(out.u, {sSteps: Math.round(clamp(q.terraces, 0, 8)), sFlat: Math.min(q.ledge, .95), sJit: q.terraceJitter, sBreak: clamp(q.breakup || 0, 0, 1)});
  return out;
}
// H27: a landform's two half widths (px): the whole section is the diameter, and the back (the lean side) is Lean times the front.
export function landformSides(q) {
  const ratio = q.lean > 0 ? clamp(q.lean, .25, 4) : 1, front = 2 * q.radius / (1 + ratio);
  return {front, back: front * ratio, ratio};
}
// H27: the most a cell can stand from a landform's path and still be on it (world px; `scale` is the frame's), over the widest side grown by the width
// variation at its largest weight, the wander, and the spurs. The segment boxes and nodeBounds both use it.
export function landformReach(q, scale = 1) {
  const {front, back} = landformSides(q), weight = Math.max(q.varyFoot ?? 1, q.varyMiddle ?? 1, q.varyCrest ?? 1);
  return Math.max(front, back) * Math.exp(1.35 * (q.widthVary || 0) * weight) + (q.wander || 0) * scale * weight + 2;
}
// The along-the-path knots a landform carries (the elevation's share along the path, 0 to 1.2), flat at 1 until edited.
export const ALONG_FLAT = [[0, 1], [1, 1]];
export const alongKnots = q => q.along?.length >= 2 ? q.along : ALONG_FLAT;


// The table as the shader reads it (Catmull-Rom over the CV_N + 3 samples), so the editor draws what a stroke draws.
export function readTable(tab, t) {
  const x = clamp(t, 0, 1) * CV_N, k = Math.min(Math.floor(x), CV_N - 1), f = x - k, p0 = tab[k], p1 = tab[k + 1], p2 = tab[k + 2], p3 = tab[k + 3];
  return p1 + .5 * f * (p2 - p0 + f * (2 * p0 - 5 * p1 + 4 * p2 - p3 + f * (3 * (p1 - p2) + p3 - p0)));
}
// The lean a stroke shows: its own, else the shouldered hill's softness-driven back over its face, else the kind's default.
export function leanRatio(kind, q, shouldered) {
  const L = leanSetup(kind, q);
  if (L.ratio || !shouldered) return L.k + 1;
  const w = hillWidths(q); return w.back / w.face;
}
// Knots for a form that has many (a power law or a smoothstep sampled finely): nine even ones, the starting point for dragging.
export function thinKnots(knots, n = 9) { const f = knotCurve(knots); return Array.from({length: n}, (_, i) => [i / (n - 1), Math.round(f(i / (n - 1)) * 1000) / 1000]); }

// The editor's preview: the stroke's table, foot to top, n + 1 samples (land: share of the rise; water: share of the descent), and its back's.
export function sectionPreview(kind, q, shouldered, n = 160) {
  const k = strokeKnots(kind, q, shouldered), tab = sampleKnots(k.knots), back = shouldered ? sampleKnots(k.back ?? SMOOTH) : kind === 'landform' && k.back ? sampleKnots(k.back) : tab, at = tb => Float32Array.from({length: n + 1}, (_, i) => readTable(tb, i / n));
  return {water: isWater(kind), ys: at(tab), back: at(back), knots: k.knots};
}
