// H15 part 2: one curve for every shape. A stroke's curve is height share against distance share from the foot (0 at the foot, 1 at the top). The host
// samples it at CV_N + 3 even steps, one before the foot to one past the top; the shader (engine-shape.wgsl curveAt) reads the table with Catmull-Rom interpolation. Per-kind noise stays in the shader.
export const CV_N = 32;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sm = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
// The shouldered hill's face side: a smoothstep to .67 of the way across, then a monotone cubic Hermite through knots (.67, .78, .89, 1) at rises (1, .34, .02, 0).
export const hillKnots = [.67, .78, .89, 1], hillRise = [1, .34, .02, 0];
export const hillTangents = hillKnots.map((_, i) => {
  if (!i || i === hillKnots.length - 1) return 0;
  const a = (hillRise[i] - hillRise[i - 1]) / (hillKnots[i] - hillKnots[i - 1]);
  const b = (hillRise[i + 1] - hillRise[i]) / (hillKnots[i + 1] - hillKnots[i]);
  return a * b > 0 ? 2 * a * b / (a + b) : 0;
});
function hillSection(t) {
  if (t <= 0 || t >= 1) return 0;
  if (t <= .67) return sm(t / .67);
  let k = 0; while (hillKnots[k + 1] < t) k++;
  const w = hillKnots[k + 1] - hillKnots[k], u = (t - hillKnots[k]) / w, u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * hillRise[k] + (u3 - 2 * u2 + u) * w * hillTangents[k] + (-2 * u3 + 3 * u2) * hillRise[k + 1] + (u3 - u2) * w * hillTangents[k + 1];
}
const sample = f => Array.from({length: CV_N + 3}, (_, j) => f((j - 1) / CV_N));
const SMOOTH = t => sm(t);
// Desert's mesa flank at mesaFlank 1: concave at the foot, over the cap's share of the reach.
const MESA = t => t * t + (1 - sm(1 - t)) * (1 - t);
// The front table (and the back one where the shape needs a second curve) of a kind at a stroke's softness, or null for a kind with no cross-section.
//   plateau family, lower, smooth, deep, shallow: the smoothstep (the shader scales the distance by the face share); plateau's back is the mesa flank
//   mountain, plain hill: (1 - r^2)^m at the stroke's exponent m, r = 1 - t
//   shouldered hill: the face side from the foot to the crest; the back side a smoothstep (the lean, sBack, stretches it)
export function curveTables(kind, q, {shouldered}) {
  switch (kind) {
    case 'paint': case 'erase': case 'offset': case 'sand': case 'grass': case 'lower': case 'smooth': case 'deep': case 'shallow': return {front: sample(SMOOTH)};
    case 'plateau': return {front: sample(SMOOTH), back: sample(MESA)};
    case 'mountain': { const m = 3.5 * 2 ** ((.5 - q.softness) * 1.5); return {front: sample(t => t <= 0 ? 0 : (1 - (1 - t) ** 2) ** m)}; }
    case 'hill': {
      if (!shouldered) return {front: sample(t => t <= 0 ? 0 : (1 - (1 - t) ** 2) ** 2)};
      return {front: sample(t => hillSection(.67 + .33 * (1 - t))), back: sample(SMOOTH)};
    }
  }
  return null;
}
