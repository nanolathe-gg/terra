// H15 part 2: one curve for every shape. A stroke's curve is height share against distance share from the foot (0 at the foot, 1 at the top). The host
// samples it at CV_N + 3 even steps, one before the foot to one past the top; the shader (engine-shape.wgsl curveAt) reads the table with Catmull-Rom
// interpolation. Per-kind noise stays in the shader. strokeCurve is the one place a kind, its softness and the stored section keys become a curve (step C
// replaces the keys with knots a stroke carries).
export const CV_N = 64;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sm = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
// The shouldered hill's face side: a smoothstep to .67 of the way across, then a monotone cubic Hermite through knots (.67, .78, .89, 1) at rises (1, .34, .02, 0).
const hillKnots = [.67, .78, .89, 1], hillRise = [1, .34, .02, 0];
const hillTangents = hillKnots.map((_, i) => {
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

// The stored section keys (profile-free): a stroke carries a section when any of them is set. Crown's default is .5, so only a changed crown counts.
export const SECTION_KINDS = ['plateau', 'offset', 'hill', 'mountain', 'deep', 'shallow'];
export const carriesSection = (kind, q) => SECTION_KINDS.includes(kind) && (q.apronPx > 0 || q.facePx > 0 || Boolean(q.faceCurve) || Boolean(q.lip) || q.shelfPx > 0 || q.shelfSteps > 0 ||
  ((kind === 'hill' || kind === 'mountain') && q.crown != null && q.crown !== .5));
// The face between its foot (0) and top (1): a smoothstep, bent toward a concave (-) or convex (+) power curve by |faceCurve|.
const faceShape = (t, curve) => { const g = sm(t), k = Math.abs(curve); return k > 0 ? g + ((curve > 0 ? 1 - (1 - t) ** 2.4 : t ** 2.4) - g) * k : g; };
// A terrace level without jitter (the shader adds the jitter to the face terraces; a shelf's steps are baked).
const stepped = (g, n, flat) => { const s = g * n, k = Math.max(0, Math.min(Math.floor(s), n - 1)); return (k + sm((s - k - flat) / (1 - flat))) / n; };
const lipRim = (t, F) => t >= 0 ? 1 - sm(t / (.45 * F)) : 1 - sm(-t / clamp(.4 * F, 5, 30));

// A dry-land stroke's section (plateau, offset, hill, mountain) at the stroke's reach R: apron, face, then the crown's cap on a dome. px widths, as the stored keys say.
function landSection(kind, q, R) {
  const dome = kind === 'hill' || kind === 'mountain', crown = dome ? q.crown : 0, capW = .55 * crown, capRise = .45 * crown, capExp = 1 + 2 * crown, pt = 1 - capRise;
  const share = clamp(.38 + (q.softness - .5) * .6, .1, .88);
  let A = q.apronPx, F = q.facePx > 0 ? q.facePx : dome ? Math.max((1 - capW) * R - A, .1 * R) : share * R;
  // The widths stay as the keys say; the shader shrinks them to fit each cell's reach (carried), and a dome's cap gets what is left, at least 2% of the reach.
  const top = A + F, ah = A > 0 ? Math.min(q.apronHeight, .9 * pt) : 0, cap = dome ? Math.max(R - top, .02 * R) : 0, D = top + cap;
  const p = d => d <= 0 ? 0 : d < A ? ah * (d / A) ** 1.5 : d < top ? ah + (pt - ah) * faceShape((d - A) / F, q.faceCurve)
    : capRise > 0 ? pt + capRise * (1 - (1 - Math.min((d - top) / cap, 1)) ** capExp) : 1;
  return {front: sample(t => p(t * D)), D, u: {cvPx: top, cvA: A, cvD: D, cvCap: cap, cvFs: q.facePx > 0 || dome ? 0 : share, cvLo: ah, cvHi: pt, sLip: q.lip, lipDir: -1, lipAt: 0, lipF: F}};
}
// A deep or shallow stroke's section, in two tables because the classic read the ground height per cell: v = sea + hb P(d) on the bank (hb the cell's ground above
// the sea, P 1 at the bank's top and 0 at the waterline: the inset a lip needs, then apron and face) and v = sea + Q(d) past it (the shelf, then the bed; Q in
// height units). The shader forms w = (hb (1 - P) - Q) / (hb + depth of the bed) per cell, so no ground height is assumed here.
function waterSection(kind, q, R, sea) {
  const db = kind === 'deep' ? 55 : 7;
  let A = q.apronPx, F = q.facePx > 0 ? q.facePx : q.bankPx > 0 ? Math.max(q.bankPx - A, 6) : .4 * R, S = q.shelfPx > 0 && q.shelfDepth > 0 ? q.shelfPx : 0, I = q.lip !== 0 ? clamp(.4 * F, 5, 30) : 0;
  const total = I + A + F + S; if (total > .92 * R) { const k = .92 * R / total; I *= k; A *= k; F *= k; S *= k; }
  const B = A + F, rest = I + B + S, depth = Math.min(q.shelfDepth, .7 * db), ah = A > 0 ? Math.min(q.apronHeight, .9) : 0, steps = Math.round(clamp(q.shelfSteps, 0, 6)), D = rest + .7 * (R - rest);
  const p = dd => dd <= 0 ? 0 : dd < A ? ah * (dd / A) ** 1.5 : dd >= A + F ? 1 : ah + (1 - ah) * faceShape((dd - A) / F, q.faceCurve);
  const P = d => d < I ? 1 : d < I + B ? p(B - (d - I)) : 0;
  const Q = d => {
    if (d < I + B) return 0;
    if (d < rest) { const t = (d - I - B) / S; return -depth * (steps > 0 ? 1 - stepped(1 - t, steps, q.ledge) : sm(t / .35)); }
    const top = S > 0 ? -depth : 0;
    return top + (-db - top) * sm((d - rest) / (.7 * (R - rest)));
  };
  return {front: sample(t => P(t * D)), back: sample(t => Q(t * D)), D, u: {cvPx: D, cvA: 0, cvD: D, cvCap: 0, cvFs: 0, cvLo: ah, cvHi: 1, cvWater: 1, sLip: q.lip, lipDir: 1, lipAt: I, lipF: F}};
}

// The front table (and the back one where the shape needs a second curve) of a stroke, with the uniforms its section adds, or null for a kind with no cross-section.
//   plateau family, lower, smooth, deep, shallow: the smoothstep (the shader scales the distance by the face share); plateau's back is the mesa flank
//   mountain, plain hill: (1 - r^2)^m at the stroke's exponent m, r = 1 - t
//   shouldered hill: the face side from the foot to the crest; the back side a smoothstep (the lean, sBack, stretches it)
//   a stroke that carries section keys: landSection or waterSection; its px widths become cvPx, cvA, cvD and the shader maps each cell's own width noise onto them
export function strokeCurve(kind, q, {shouldered, radius, bankScale, sea}) {
  let out;
  switch (kind) {
    case 'paint': case 'erase': case 'sand': case 'grass': case 'lower': case 'smooth': case 'offset': case 'deep': case 'shallow': out = {front: sample(SMOOTH)}; break;
    case 'plateau': out = {front: sample(SMOOTH), back: sample(MESA)}; break;
    case 'mountain': { const m = 3.5 * 2 ** ((.5 - q.softness) * 1.5); out = {front: sample(t => t <= 0 ? 0 : (1 - (1 - t) ** 2) ** m)}; break; }
    case 'hill': out = shouldered ? {front: sample(t => hillSection(.67 + .33 * (1 - t))), back: sample(SMOOTH)} : {front: sample(t => t <= 0 ? 0 : (1 - (1 - t) ** 2) ** 2)}; break;
    default: return null;
  }
  out.u = {};
  if (SECTION_KINDS.includes(kind)) Object.assign(out.u, {sSteps: Math.round(clamp(q.terraces, 0, 8)), sFlat: Math.min(q.ledge, .95), sJit: q.terraceJitter, cvLo: 0, cvHi: 1});
  if (!shouldered && carriesSection(kind, q)) {
    const R = radius * (kind === 'deep' || kind === 'shallow' ? bankScale : 1);
    const s = kind === 'deep' || kind === 'shallow' ? waterSection(kind, q, R, sea) : landSection(kind, q, R);
    out.front = s.front; if (s.back) out.back = s.back; Object.assign(out.u, s.u);
  }
  return out;
}

// The cross-section editor's preview: the stroke's section from its foot to its centre, as heights (land: above the ground; water: on ground baseH, from the bank top to the bed).
export function sectionPreview(kind, q, {radius, bankScale, sea, baseH}, n = 160) {
  const t = strokeCurve(kind, q, {shouldered: false, radius, bankScale, sea});
  if (!t || !t.u.cvPx) return null;
  const water = kind === 'deep' || kind === 'shallow', R = radius * (water ? bankScale : 1), {cvD: D} = t.u, ys = new Float32Array(n + 1), db = kind === 'deep' ? 55 : 7, hb = baseH - sea;
  const at = (tab, x) => { const i = Math.min(Math.floor(x), CV_N - 1); return tab[i + 1] + (tab[i + 2] - tab[i + 1]) * (x - i); };
  for (let k = 0; k <= n; k++) {
    const d = R * k / n, x = clamp(d / D, 0, 1) * CV_N, w = at(t.front, x);
    const lift = !q.lip ? 0 : q.lip * (water ? lipRim(d - t.u.lipAt, t.u.lipF) : lipRim(t.u.cvPx - d, t.u.lipF));
    ys[k] = water ? sea + Math.min(hb, hb * w + at(t.back, x)) + lift : w * q.amount + lift;
  }
  return {water, ys, bed: sea - db};
}
