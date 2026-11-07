// H15: fit the shared cross-section (engine-shape.wgsl crossSection) to every kind's classic curve, in one dimension.
//   node measure/section_fit.mjs [--out measure/section_presets.json]
// A curve is a rise p(t) of t = d / reach (0 at the foot, 1 at the crest). The classic curves are the ones engine-shape.wgsl
// computes for each kind; the candidate is faceRise + landSection with the numbers (al ah ph k cr P): apron share and height,
// face share, face curve, crown, and the face-curve exponent. Errors are in height units for the amount the audit used (80),
// over the cells where either curve is at least one unit above the ground (the audit's raised-region measure).
// The engine check (measure/section_check.mjs) repeats the measure on the real renders, which is the number to quote.
import {writeFileSync} from 'node:fs';
const sm = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const knots = [.67, .78, .89, 1], rise = [1, .34, .02, 0];
const tan = knots.map((_, i) => { if (!i || i === 3) return 0; const a = (rise[i] - rise[i - 1]) / (knots[i] - knots[i - 1]), b = (rise[i + 1] - rise[i]) / (knots[i + 1] - knots[i]); return a * b > 0 ? 2 * a * b / (a + b) : 0; });
function hillSection(t) {
  if (t <= 0 || t >= 1) return 0; if (t <= .67) return sm(0, .67, t);
  let k = 0; while (knots[k + 1] < t) k++;
  const w = knots[k + 1] - knots[k], u = (t - knots[k]) / w, u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * rise[k] + (u3 - 2 * u2 + u) * w * tan[k] + (-2 * u3 + 3 * u2) * rise[k + 1] + (u3 - u2) * w * tan[k + 1];
}
const faceW = s => .66 + (s - .5) * .9, backW = s => s === .5 ? 1.34 : 2 - faceW(s);
export const classic = {
  plateau: (t, s = .5) => 1 - sm(Math.min(.9, Math.max(.12, .56 - (s - .5) * .6)), 1, 1 - t),
  smooth: t => 1 - sm(0, 1, 1 - t),
  water: t => 1 - sm(.1, 1, 1 - t),
  mountain: (t, s = .5) => Math.pow(Math.max(0, 1 - (1 - t) * (1 - t)), 3.5 * Math.pow(2, (.5 - s) * 1.5)),
  hillPlain: t => Math.pow(Math.max(0, 1 - (1 - t) * (1 - t)), 2),
  // the shouldered hill by side: front is the face side, rising to the crest at t = 1; back is the long slope
  hillFront: (t, s = .5) => { const f = faceW(s); return hillSection(s === .5 ? (f * (1 - t) + 1.34) / 2 : .67 + .33 * (1 - t)); },
  hillBack: (t, s = .5) => sm(0, 1, t),
};
// mirrors faceRise + landSection (no terraces, lip or width noise)
export function section(t, p) {
  let A = p.al, F = p.ph; if (A + F > .98) { const k = .98 / (A + F); A *= k; F *= k; }
  const capRise = .45 * p.cr, capExp = 1 + 2 * p.cr, pt = 1 - capRise, top = A + F;
  if (t < top) {
    if (t <= 0) return 0;
    const ah = A > 0 ? Math.min(p.ah, .9 * pt) : 0;
    if (t < A) return ah * Math.pow(t / A, 1.5);
    const u = (t - A) / F, k = Math.abs(p.k); let g = sm(0, 1, u);
    if (k > 0) { const c = p.k > 0 ? 1 - Math.pow(1 - u, p.P) : Math.pow(u, p.P); g += (c - g) * k; }
    return ah + (pt - ah) * g;
  }
  return capRise > 0 ? pt + capRise * (1 - Math.pow(1 - Math.min((t - top) / Math.max(1 - top, 1e-3), 1), capExp)) : 1;
}
export function err(f, g, amount = 80, n = 400) {
  let s = 0, c = 0, mx = 0;
  for (let i = 0; i < n; i++) { const t = (i + .5) / n, a = f(t), b = g(t); if (Math.max(a, b) * amount < 1) continue; const d = (a - b) * amount; s += d * d; c++; mx = Math.max(mx, Math.abs(d)); }
  return {rms: Math.sqrt(s / c), max: mx};
}
let seed = 7; const R = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const LO = {al: 0, ah: 0, ph: .05, k: -1, cr: 0, P: 1.2}, HI = {al: .5, ah: .5, ph: .98, k: 1, cr: 1, P: 5};
function search(cost, free, iters = 30000, restarts = 4) {
  let best = null;
  for (let r = 0; r < restarts; r++) {
    let cur = {al: 0, ah: 0, ph: .5, k: 0, cr: 0, P: 2.4}; for (const k of free) cur[k] = LO[k] + (HI[k] - LO[k]) * R();
    let cv = cost(cur), step = .5;
    for (let i = 0; i < iters; i++) {
      const q = {...cur}; for (const k of free) if (R() < .5) q[k] = Math.min(HI[k], Math.max(LO[k], cur[k] + (R() - .5) * (HI[k] - LO[k]) * step));
      const v = cost(q); if (v < cv) { cur = q; cv = v; } if (i % 5000 === 4999) step *= .6;
    }
    if (!best || cv < best.v) best = {v: cv, p: cur};
  }
  return best;
}
const round = p => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, +v.toFixed(3)]));
const out = {};
// plateau, lower/smooth, water: one face, no apron (k 0). Fitted only for the share; the softness slope is the classic's own .6.
out.shoulder = {p: {al: 0, ah: 0, ph: .44, k: 0, cr: 0, P: 2.4}, soft: {ph: .6}};
out.smooth = {p: {al: 0, ah: 0, ph: 1, k: 0, cr: 0, P: 2.4}};
out.water = {p: {al: 0, ah: 0, ph: .9, k: 0, cr: 0, P: 2.4}};
// mountain: shared apron/curve/exponent, share and crown linear in softness, over the softnesses 0, .25, .5, .75, 1
const S = [0, .25, .5, .75, 1], lin = (v, s) => ({al: v.al, ah: v.ah, k: v.k, P: v.P, ph: Math.min(.98, Math.max(.05, v.ph + v.dph * (s - .5))), cr: Math.min(1, Math.max(0, v.cr + v.dcr * (s - .5)))});
{
  const free = ['al', 'ah', 'k', 'P', 'ph', 'cr', 'dph', 'dcr'];
  const LO2 = {...LO, dph: -1, dcr: -1}, HI2 = {...HI, dph: 1, dcr: 1};
  let best = null;
  for (let r = 0; r < 6; r++) {
    let cur = {}; for (const k of free) cur[k] = LO2[k] + (HI2[k] - LO2[k]) * R();
    const cost = v => Math.sqrt(S.reduce((c, s) => { const e = err(t => classic.mountain(t, s), t => section(t, lin(v, s)), 80, 200); return c + e.rms * e.rms; }, 0) / S.length);
    let cv = cost(cur), step = .5;
    for (let i = 0; i < 6000; i++) { const q = {...cur}; for (const k of free) if (R() < .5) q[k] = Math.min(HI2[k], Math.max(LO2[k], cur[k] + (R() - .5) * (HI2[k] - LO2[k]) * step)); const v = cost(q); if (v < cv) { cur = q; cv = v; } if (i % 1000 === 999) step *= .65; }
    if (!best || cv < best.v) best = {v: cv, p: cur};
  }
  out.mountain = {p: round(best.p), softness: Object.fromEntries(S.map(s => [s, err(t => classic.mountain(t, s), t => section(t, lin(best.p, s)))]))};
}
for (const [name, f, free] of [['hillPlain', classic.hillPlain, ['ph', 'k', 'cr', 'P']], ['hillFront', t => classic.hillFront(t), ['ph', 'k', 'cr', 'P']]]) {
  const b = search(p => err(f, t => section(t, p)).rms, free, 40000, 5);
  out[name] = {p: round(b.p), ...err(f, t => section(t, b.p))};
}
out.hillBack = {note: 'a smoothstep over the back slope; no numbers'};
for (const [name, f] of [['shoulder', t => classic.plateau(t)], ['smooth', classic.smooth], ['water', classic.water]]) out[name].err = err(f, t => section(t, out[name].p));
for (const s of [0, 1]) out.shoulder['soft' + s] = err(t => classic.plateau(t, s), t => section(t, {...out.shoulder.p, ph: out.shoulder.p.ph + .6 * (s - .5)}));
const dest = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
console.log(JSON.stringify(out, null, 1)); if (dest) writeFileSync(dest, JSON.stringify(out, null, 1));
