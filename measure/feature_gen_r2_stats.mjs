// Round 2 statistics from the spec's section 15 (shares, clumps, chunks, fills) for the generated features.
//   node measure/feature_gen_r2_stats.mjs [path/to/sculpt-feature-gen.js]   (default: this repo's module)
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const mod = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : '../sculpt-feature-gen.js');
const palette = JSON.parse(readFileSync(new URL('../materials/palette.json', import.meta.url))).indexed;
const luma = i => { const c = palette[i]; return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; };
const mean = a => a.reduce((s, v) => s + v, 0) / (a.length || 1);
const fx = (v, d = 3) => +v.toFixed(d);
function comps(w, h, mask, eight) {
  const seen = new Uint8Array(w * h), out = [];
  for (let i = 0; i < w * h; i++) if (mask[i] && !seen[i]) {
    const q = [i], px = []; seen[i] = 1;
    while (q.length) { const c = q.pop(); px.push(c); const x = c % w, y = (c / w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; if (!eight && dx && dy) continue; const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; const k = ny * w + nx; if (mask[k] && !seen[k]) { seen[k] = 1; q.push(k); } } }
    out.push(px);
  }
  return out;
}
const drawn = s => { let n = 0; for (let k = 0; k < s.w * s.h; k++) n += s.a[k]; return n; };
const share = (s, test) => { let n = 0, d = 0; for (let k = 0; k < s.w * s.h; k++) if (s.a[k]) { d++; if (test(s.idx[k])) n++; } return n / Math.max(d, 1); };
const R = {};
// trees
for (const [name, params] of [['broadleaf', {}], ['conifer', {species: 'conifer', height: 61, width: 0.5}]]) {
  const rows = [];
  for (let i = 0; i < 12; i++) {
    const s = mod.generateFeature('tree', params, 1000 + i * 7).body, o = {};
    o.share3738 = share(s, k => k === 37 || k === 38); o.share3740 = share(s, k => k >= 37 && k <= 40);
    o.nearWhite = (() => { let n = 0; for (let k = 0; k < s.w * s.h; k++) if (s.a[k]) { const c = palette[s.idx[k]]; if (luma(s.idx[k]) > 130 && !(c[1] > c[0] + 8 && c[1] > c[2] + 8)) n++; } return n; })();
    o.bright130 = share(s, k => luma(k) > 130);
    const lit = new Uint8Array(s.w * s.h); for (let k = 0; k < lit.length; k++) lit[k] = s.a[k] && (s.idx[k] === 37 || s.idx[k] === 38) ? 1 : 0;
    const cs = comps(s.w, s.h, lit, false).filter(c => c.length >= 4);
    o.clumps = cs.length; let ul = 0, lr = 0; const cx = s.w / 2, cy = s.h / 2;
    for (const c of cs) { const mx = mean(c.map(k => k % s.w)), my = mean(c.map(k => (k / s.w) | 0)); if (mx < cx && my < cy) ul++; if (mx >= cx && my >= cy) lr++; }
    o.clumpUL = ul / Math.max(cs.length, 1); o.clumpLR = lr / Math.max(cs.length, 1);
    let lh = 0, tot = 0; for (let k = 0; k < lit.length; k++) if (lit[k]) { tot++; if ((k % s.w) < s.w / 2) lh++; } o.litLeft = lh / Math.max(tot, 1);
    rows.push(o);
  }
  R['tree-' + name] = Object.fromEntries(Object.keys(rows[0]).map(k => [k, fx(mean(rows.map(r => r[k])))]));
}
// rocks
{
  const rows = [];
  for (let i = 0; i < 12; i++) {
    const s = mod.generateFeature('rock', {cells: ['1x1', '2x2', '3x2', '3x3', '4x3'][i % 5]}, 50 + i * 3).body, o = {};
    const cream = k => k >= 64 && k <= 70, pink = k => k >= 16 && k <= 22, white = k => k === 255 || (k >= 81 && k <= 84);
    o.cream = share(s, cream); o.pink = share(s, pink); o.white = share(s, white); o.highlight = o.cream + o.pink + o.white;
    const shade = k => [93, 94, 95, 127, 125, 47, 62, 159].includes(k);
    let sx = 0, sy = 0, n = 0, lrN = 0, ulN = 0; const cx = s.w / 2, cy = s.h / 2;
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) { const k = y * s.w + x; if (s.a[k] && shade(s.idx[k])) { n++; sx += (x - cx) / s.w; sy += (y - cy) / s.h; if (x >= cx && y >= cy) lrN++; if (x < cx && y < cy) ulN++; } }
    o.shadeLR = lrN / Math.max(n, 1); o.shadeUL = ulN / Math.max(n, 1); o.shadeDx = sx / Math.max(n, 1); o.shadeDy = sy / Math.max(n, 1);
    o.shadeShare = n / drawn(s);
    rows.push(o);
  }
  R.rock = Object.fromEntries(Object.keys(rows[0]).map(k => [k, fx(mean(rows.map(r => r[k])))]));
}
// deposits on flat ground
{
  const rows = [];
  for (const metal of [86, 127, 187, 223]) for (let t = 0; t < 3; t++) {
    const W = 120, g = {w: W, h: W, rgba: new Uint8ClampedArray(W * W * 4)}; for (let i = 0; i < W * W; i++) { g.rgba[i * 4] = 70; g.rgba[i * 4 + 1] = 110; g.rgba[i * 4 + 2] = 40; g.rgba[i * 4 + 3] = 255; }
    mod.paintDeposit(g, 60, 60, {metal}, 700 + t * 11 + metal, {palette});
    const painted = new Uint8Array(W * W), stone = new Uint8Array(W * W); let np = 0;
    for (let i = 0; i < W * W; i++) { const r = g.rgba[i * 4], gg = g.rgba[i * 4 + 1], b = g.rgba[i * 4 + 2]; if (r === 70 && gg === 110 && b === 40) continue; painted[i] = 1; np++; const L = 0.299 * r + 0.587 * gg + 0.114 * b, green = gg > r + 8 && gg > b + 8; if (L >= 100 && !green) stone[i] = 1; }
    const cs = comps(W, W, stone, true).filter(c => c.length >= 8).sort((a, b) => b.length - a.length);
    const total = cs.reduce((s, c) => s + c.length, 0), main = cs.slice(0, 4);
    const dist = []; const mainMask = new Uint8Array(W * W); for (const c of main) for (const k of c) mainMask[k] = 1;
    const pts = []; for (let i = 0; i < W * W; i++) if (mainMask[i]) pts.push([i % W, (i / W) | 0]);
    for (let i = 0; i < W * W; i++) if (painted[i] && !stone[i]) { const x = i % W, y = (i / W) | 0; let d = 99; for (const [px, py] of pts) d = Math.min(d, Math.hypot(px - x, py - y)); dist.push(d); }
    dist.sort((a, b) => a - b);
    rows.push({metal, chunks: cs.length, dominant: cs.length ? cs[0].length / total : 0, stonePx: total, stoneShare: total / np, mossMedianDist: dist[dist.length >> 1] || 0, moss6: dist.filter(d => d <= 6).length / Math.max(dist.length, 1)});
  }
  R.deposit = {all: Object.fromEntries(Object.keys(rows[0]).filter(k => k !== 'metal').map(k => [k, fx(mean(rows.map(r => r[k])))])), byMetal: [86, 127, 187, 223].map(m => ({metal: m, chunks: fx(mean(rows.filter(r => r.metal === m).map(r => r.chunks)), 1), dominant: fx(mean(rows.filter(r => r.metal === m).map(r => r.dominant))), stonePx: fx(mean(rows.filter(r => r.metal === m).map(r => r.stonePx)), 0)}))};
}
// burnt (broadleaf and conifer)
for (const [name, params] of [['burnt-broadleaf', {}], ['burnt-conifer', {species: 'conifer', height: 58, width: 0.5}]]) {
  const rows = [];
  for (let i = 0; i < 12; i++) {
    const s = mod.generateFeature('burnt', params, 3000 + i * 5).body, o = {}, n = drawn(s);
    o.w = s.w; o.h = s.h; o.area = n; o.fill = n / (s.w * s.h);
    let iso = 0; for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) if (s.a[y * s.w + x]) { let nb = 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < s.w && Y < s.h && s.a[Y * s.w + X]) nb++; } if (nb <= 1) iso++; }
    o.isolated = iso / n; o.gt30 = share(s, k => luma(k) > 30); o.green = share(s, k => { const c = palette[k]; return c[1] > c[0] + 8 && c[1] > c[2] + 8; });
    o.gray = share(s, k => k >= 90 && k <= 95); o.brown = share(s, k => (k >= 55 && k <= 62) || k === 72 || k === 73);
    rows.push(o);
  }
  R[name] = Object.fromEntries(Object.keys(rows[0]).map(k => [k, fx(mean(rows.map(r => r[k])))]));
}
// shrubs
for (const [name, params] of [['shrub-dense', {density: 0.6, width: 27, height: 20}], ['shrub-sparse', {density: 0.12, width: 33, height: 26}]]) {
  const rows = [];
  for (let i = 0; i < 12; i++) {
    const s = mod.generateFeature('shrub', params, 400 + i * 9).body, o = {}, n = drawn(s), a = s.a;
    o.w = s.w; o.h = s.h; o.area = n; o.fill = n / (s.w * s.h);
    const bl = comps(s.w, s.h, a, true).map(c => c.length).sort((x, y) => y - x); o.blobs = bl.length; o.largestShare = bl[0] / n;
    let iso = 0; for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) if (a[y * s.w + x]) { let nb = 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < s.w && Y < s.h && a[Y * s.w + X]) nb++; } if (nb <= 1) iso++; }
    o.isolated = iso / n; o.dark173 = share(s, k => k === 173); o.mid165 = share(s, k => k === 165); o.light = share(s, k => k === 162 || k === 163);
    rows.push(o);
  }
  R[name] = Object.fromEntries(Object.keys(rows[0]).map(k => [k, fx(mean(rows.map(r => r[k])))]));
}
// shrub burn last frame, vents
{
  const f = mod.generateFeature('shrub', {}, 4001).burn.at(-1), n = drawn(f), c = {};
  for (let k = 0; k < f.w * f.h; k++) if (f.a[k]) c[f.idx[k]] = (c[f.idx[k]] || 0) + 1;
  R.shrubBurnLast = {px: n, shares: Object.fromEntries(Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([k, v]) => [k, fx(v / n, 2)]))};
  const rows = [];
  for (let i = 0; i < 6; i++) {
    const W = 120, g = {w: W, h: W, rgba: new Uint8ClampedArray(W * W * 4)}; for (let j = 0; j < W * W; j++) { g.rgba[j * 4] = 70; g.rgba[j * 4 + 1] = 110; g.rgba[j * 4 + 2] = 40; g.rgba[j * 4 + 3] = 255; }
    mod.paintVent(g, 60, 60, {size: 0.8 + 0.15 * i}, 900 + i, {palette});
    const hist = {}; let n2 = 0;
    const idxOf = new Map(palette.map((c, k) => [c.join(','), k]));
    for (let j = 0; j < W * W; j++) { const rgb = [g.rgba[j * 4], g.rgba[j * 4 + 1], g.rgba[j * 4 + 2]]; if (rgb[0] === 70 && rgb[1] === 110 && rgb[2] === 40) continue; n2++; const k = idxOf.get(rgb.join(',')); const L = luma(k); const green = rgb[1] > rgb[0] + 8 && rgb[1] > rgb[2] + 8; const cls = L < 20 ? 'black' : green ? 'green' : 'brownOther'; hist[cls] = (hist[cls] || 0) + 1; }
    rows.push({black: (hist.black || 0) / n2, green: (hist.green || 0) / n2, brown: (hist.brownOther || 0) / n2, px: n2});
  }
  R.vent = Object.fromEntries(Object.keys(rows[0]).map(k => [k, fx(mean(rows.map(r => r[k])))]));
}
console.log(JSON.stringify(R, null, 1));
