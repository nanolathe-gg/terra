// Rule 9 for the feature set's look controls (sculpt-feature-set.js SETTINGS): the share of a kind's drawn area that visibly changes
// between a control's lowest and highest value, over Green's default set (every variant the control applies to), lit by Green's sun.
//   node measure/feature_controls.mjs [--out <dir>]     (--out also writes lo | hi sheets at 3x)
// impact.py's rule at a sprite's scale: each variant's shadow (50%) and body are drawn on Green's mean ground; 4 x 4 px blocks that
// either picture draws in are the class; a block counts as changed when its mean luma moves by more than 6, its luma s.d. by more
// than 4, or its mean colour by more than 8 (RGB distance). The floor is the same measure for one slider step (lo and lo + 0.05): a
// shift of the whole picture by a pixel is no floor here (sprites are pixel grain, so it moves half of all blocks), but a control
// whose full range is not well above one step is one nobody would see. The share of drawn pixels whose colour changes follows.
// Gameplay ranges (tree energy, rock metal) change the game's values, not pixels; they are not measured here.
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {generateFeature, drawFeature} from '../sculpt-feature-gen.js';
import {defaultSet, variants} from '../sculpt-feature-set.js';
import {encodePNG} from './feature_gen_png.mjs';

const args = process.argv.slice(2), out = args.includes('--out') ? args[args.indexOf('--out') + 1] : '';
const root = new URL('..', import.meta.url).pathname, table = JSON.parse(readFileSync(root + 'materials/green.json', 'utf8'));
const palette = JSON.parse(readFileSync(root + 'materials/palette.json', 'utf8')).indexed, config = {features: table.features};
const ground = table.measured.ground.meanRGB.map(Math.round), light = args.includes("--generator-light") ? {} : {x: -0.623, y: -0.026};   // Green's sun (front lighting) as the editor projects it
const B = 4, W = 120, H = 110, AX = 50, ANCHOR = {tree: 92, shrub: 70, rock: 66};
// A color control is measured from the world's color (0) to a color an artist might pick (1): autumn leaves, warm rocks; its floor
// is a 5% mix toward it.
const mixHex = (a, b, t) => '#' + [1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('');
const recolor = (from, to) => t => (t ? {recolor: {from, to: mixHex(from, to, t)}} : {});
const CONTROLS = [['tree', 'taper', 0, 1, v => v.params.species !== 'conifer'], ['tree', 'peaks', 0, 1, v => v.params.species !== 'conifer'], ['tree', 'color', 0, 1, () => true, recolor('#11723c', '#b8732a')],
  ['shrub', 'color', 0, 1, () => true, recolor('#43972b', '#c8a030')], ['rock', 'shade', 0, 1, () => true], ['rock', 'angular', 0, 1, () => true], ['rock', 'color', 0, 1, () => true, recolor('#949494', '#b07a5a')]];

function picture(kind, params, seed) {
  const dx = 0, AY = ANCHOR[kind];
  const g = {w: W, h: H, rgba: new Uint8ClampedArray(W * H * 4)}, drawn = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) g.rgba.set([...ground, 255], i * 4);
  const f = generateFeature(kind, params, seed, {light, bodyOnly: true, palette});
  drawFeature(g, f, AX + dx, AY, palette);
  for (const s of [f.body, f.shadow]) if (s) for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) if (s.a[y * s.w + x]) { const X = AX + dx + x - s.ax, Y = AY + y - s.ay; if (X >= 0 && Y >= 0 && X < W && Y < H) drawn[Y * W + X] = 1; }
  return {g, drawn, body: f.body};
}
// What each control is for, measured on the body: taper the crown's width in its top third over its widest row; peaks the top
// edge's roughness (mean px step between neighboring columns); shade the mean luma of the body's darkest third.
const rgbOf = i => palette[i], lumaOf = i => { const c = rgbOf(i); return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; };
const PURPOSE = {
  taper: s => { const w = []; for (let y = 0; y < s.h; y++) { let n = 0; for (let x = 0; x < s.w; x++) n += s.a[y * s.w + x]; w.push(n); } const top = w.slice(0, Math.ceil(s.h / 3)); return top.reduce((a, b) => a + b, 0) / top.length / Math.max(...w); },
  peaks: s => { const t = []; for (let x = 0; x < s.w; x++) { let y = 0; while (y < s.h && !s.a[y * s.w + x]) y++; if (y < s.h * 0.6) t.push(y); } let d = 0; for (let i = 1; i < t.length; i++) d += Math.abs(t[i] - t[i - 1]); return d / Math.max(1, t.length - 1); },
  // angular: the mean luma step between neighbouring body pixels (flat faces meet at sharper creases); color: the body's mean hue in degrees
  angular: s => { let d = 0, n = 0; for (let y = 0; y < s.h; y++) for (let x = 1; x < s.w; x++) { const k = y * s.w + x; if (s.a[k] && s.a[k - 1]) { d += Math.abs(lumaOf(s.idx[k]) - lumaOf(s.idx[k - 1])); n++; } } return d / Math.max(1, n); },
  color: s => { let cx = 0, cy = 0; for (let k = 0; k < s.w * s.h; k++) if (s.a[k]) { const [r, g, b] = rgbOf(s.idx[k]), h = Math.atan2(Math.sqrt(3) * (g - b), 2 * r - g - b); cx += Math.cos(h); cy += Math.sin(h); } return (Math.atan2(cy, cx) * 180 / Math.PI + 360) % 360; },
  shade: s => { const l = []; for (let k = 0; k < s.w * s.h; k++) if (s.a[k]) l.push(lumaOf(s.idx[k])); l.sort((a, b) => a - b); const q = Math.floor(l.length / 3); return l.slice(0, q).reduce((a, b) => a + b, 0) / q; },
};
const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
function blocks(p) {
  const out = [];
  for (let by = 0; by < H / B | 0; by++) for (let bx = 0; bx < W / B | 0; bx++) {
    let n = 0, l = 0, l2 = 0, r = 0, gg = 0, b = 0, any = 0;
    for (let y = by * B; y < by * B + B; y++) for (let x = bx * B; x < bx * B + B; x++) { const k = (y * W + x) * 4, L = luma(p.g.rgba[k], p.g.rgba[k + 1], p.g.rgba[k + 2]); n++; l += L; l2 += L * L; r += p.g.rgba[k]; gg += p.g.rgba[k + 1]; b += p.g.rgba[k + 2]; any |= p.drawn[y * W + x]; }
    l /= n; out.push({any, mean: l, sd: Math.sqrt(Math.max(0, l2 / n - l * l)), rgb: [r / n, gg / n, b / n]});
  }
  return out;
}
function changed(a, b) {
  let cls = 0, moved = 0;
  a.forEach((p, i) => { const q = b[i]; if (!p.any && !q.any) return; cls++; if (Math.abs(p.mean - q.mean) > 6 || Math.abs(p.sd - q.sd) > 4 || Math.hypot(p.rgb[0] - q.rgb[0], p.rgb[1] - q.rgb[1], p.rgb[2] - q.rgb[2]) > 8) moved++; });
  return {cls, moved};
}

const set = defaultSet(config), rows = [];
if (out) mkdirSync(out, {recursive: true});
for (const [kind, key, lo, hi, applies, edit = t => ({[key]: t})] of CONTROLS) {
  const list = variants(kind, {...set, [kind]: {...set[kind], recipes: set[kind].recipes.map(r => ({...r,count:16}))}}, config).filter(applies);
  let cls = 0, moved = 0, fcls = 0, fmoved = 0, px = 0, pxMoved = 0; const purpose = {lo: 0, hi: 0, step: 0};
  const sheet = out ? {w: W * 2 * list.length, h: H, rgba: new Uint8ClampedArray(W * 2 * list.length * H * 4)} : null;
  list.forEach((v, i) => {
    const a = picture(kind, {...v.params, ...edit(lo)}, v.seed), b = picture(kind, {...v.params, ...edit(hi)}, v.seed), c = picture(kind, {...v.params, ...edit(lo + 0.05)}, v.seed);
    const m = changed(blocks(a), blocks(b)), f = changed(blocks(a), blocks(c)); cls += m.cls; moved += m.moved; fcls += f.cls; fmoved += f.moved;
    const pa = PURPOSE[key](a.body), pb = PURPOSE[key](b.body), pc = PURPOSE[key](c.body); purpose.lo += pa / list.length; purpose.hi += pb / list.length; purpose.step += Math.abs(pc - pa) / list.length;
    for (let k = 0; k < W * H; k++) if (a.drawn[k] || b.drawn[k]) { px++; if (a.g.rgba[k * 4] !== b.g.rgba[k * 4] || a.g.rgba[k * 4 + 1] !== b.g.rgba[k * 4 + 1] || a.g.rgba[k * 4 + 2] !== b.g.rgba[k * 4 + 2]) pxMoved++; }
    if (sheet) for (const [j, p] of [[0, a], [1, b]]) for (let y = 0; y < H; y++) sheet.rgba.set(p.g.rgba.subarray(y * W * 4, (y + 1) * W * 4), (y * sheet.w + (i * 2 + j) * W) * 4);
  });
  rows.push({kind, control: key, range: [lo, hi], variants: list.length, changedShare: +(moved / cls).toFixed(3), floor: +(fmoved / fcls).toFixed(3), blocks: cls, pixelShare: +(pxMoved / px).toFixed(3), purpose: Object.fromEntries(Object.entries(purpose).map(([k, v]) => [k, +v.toFixed(3)]))});
  if (sheet) { const k = 3, big = new Uint8ClampedArray(sheet.w * k * sheet.h * k * 4); for (let y = 0; y < sheet.h * k; y++) for (let x = 0; x < sheet.w * k; x++) big.set(sheet.rgba.subarray(((y / k | 0) * sheet.w + (x / k | 0)) * 4, ((y / k | 0) * sheet.w + (x / k | 0)) * 4 + 4), (y * sheet.w * k + x) * 4); writeFileSync(`${out}/${kind}-${key}.png`, encodePNG(sheet.w * k, sheet.h * k, big)); }
}
for (const r of rows) console.log(`${r.kind.padEnd(5)} ${r.control.padEnd(6)} ${r.range.join('..')}  ${String(r.variants).padStart(2)} variants  changed ${(100 * r.changedShare).toFixed(1)}% of ${r.blocks} drawn 4-px blocks  (floor, one 0.05 step: ${(100 * r.floor).toFixed(1)}%); ${(100 * r.pixelShare).toFixed(1)}% of drawn pixels change colour; its purpose (${r.control}) ${r.purpose.lo} -> ${r.purpose.hi}, one step moves it ${r.purpose.step}`);
console.log(JSON.stringify(rows));
