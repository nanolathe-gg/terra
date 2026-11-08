// Retail features beside our generated ones, per world, as one PNG per group (deposit, vent, tree, shrub, rock, spire, node, scar).
//   node measure/feature_compare.mjs <world> [--out DIR] [--top 12] [--seed N] [--names REGEX]
// DIR defaults to $R/features-round/<world> (R=/private/tmp/nanolathe-map-editor); the PNGs, index.html and numbers.json go there and
// never into git: the retail sprites come from $R/features/<world>/catalog.json and are read only to draw the sheet and to measure it.
// Each PNG has RETAIL (orange band: the sprites most used on the world's retail maps) and OURS (blue band: the variants of the world's
// own table, lit by the world's sun as the page does) on the world's ground colour, at 1x and then 2x. Numbers under the pictures:
// size, drawn pixels, luma octile cut points, mean hue and saturation of the coloured pixels, outline share (boundary pixels per
// pixel; AquaOre deposits, drawn blue for under water, are left out unless --aqua, which also paints our deposits as under water); retail rows are weighted by uses in the group mean. A world with no retail folder (Zhon) gets ours only.
import {mkdirSync, writeFileSync, readFileSync, existsSync} from 'node:fs';
import {join, basename} from 'node:path';
import {execFileSync} from 'node:child_process';
import {encodePNG, decodePNG} from './feature_gen_png.mjs';
import {generateFeature, paintDeposit, paintVent, toRGBA, rng} from '../sculpt-feature-gen.js';
import {defaultSet, variants} from '../sculpt-feature-set.js';

const R = process.env.R || '/private/tmp/nanolathe-map-editor';
const root = new URL('..', import.meta.url).pathname;
const args = process.argv.slice(2);
const world = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--out' && args[args.indexOf(a) - 1] !== '--top' && args[args.indexOf(a) - 1] !== '--seed' && args[args.indexOf(a) - 1] !== '--names');
const opt = (name, d) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : d; };
if (!world) { console.error('usage: node measure/feature_compare.mjs <world> [--out DIR] [--top 12]'); process.exit(2); }
const NAMES = opt('names') ? new RegExp(opt('names'), 'i') : null;   // only the retail sprites whose name matches (e.g. --names Dead)
const out = opt('out', join(R, 'features-round', world)), TOP = +opt('top', 12), MAXW = 1400;
mkdirSync(out, {recursive: true});

// ---- the world: its table (Green's kinds underneath, as sculpt.py biome_config), its sun and its ground ----
const table = JSON.parse(readFileSync(join(root, 'materials', world + '.json')));
const green = JSON.parse(readFileSync(join(root, 'materials/green.json'))).features;
const features = {...Object.fromEntries(['tree', 'shrub', 'rock', 'scar'].map(k => [k, green[k]])), ...table.features};
const config = {features};
let defaults = {sunTilt: 1};
try { defaults = JSON.parse(execFileSync(process.env.PYTHON || '/Users/daniel/src/terraform/.venv/bin/python', ['-c', 'import sys,json,sculpt;print(json.dumps(sculpt.biome_config(sys.argv[1])["defaults"]))', world], {cwd: root, encoding: 'utf8'})); } catch { /* the table's own defaults */ }
const tilt = Number(defaults.sunTilt ?? 1);
const sun0 = [-0.72, 0.38 * tilt, 0.82], sm = Math.hypot(...sun0), sun = sun0.map(v => v / sm);
const light = {x: +sun[0].toFixed(3), y: +(0.8944 * sun[1] - 0.4472 * sun[2]).toFixed(3), z: +(0.4472 * sun[1] + 0.8944 * sun[2]).toFixed(3)};
const palette = JSON.parse(readFileSync(join(root, 'materials/palette.json'))).indexed;
const ctx = {palette, light, bodyOnly: true};
const gm0 = table.measured?.ground || table.measured?.quilt || table.measured?.slopeGrass || {};   // the plain's own picture, else its quilt, else the cover
const gmean = gm0.meanRGB || table.material?.groundRGB || [90, 90, 90], gsd = gm0.lumaSd ?? 10;

// ---- small image tools ----
const canvas = (w, h, fill) => { const c = {w, h, rgba: new Uint8ClampedArray(w * h * 4)}; for (let i = 0; i < w * h; i++) c.rgba.set([...fill, 255], i * 4); return c; };
function groundCanvas(w, h, seed) {
  const c = canvas(w, h, gmean), r = rng(seed), L = 0.299 * gmean[0] + 0.587 * gmean[1] + 0.114 * gmean[2], amp = gsd * 0.7 / Math.max(L, 20);
  for (let i = 0; i < w * h; i++) { const n = (r() + r() + r() - 1.5) * 1.6 * amp; for (let k = 0; k < 3; k++) c.rgba[i * 4 + k] = Math.max(0, Math.min(255, gmean[k] * (1 + n))); }
  return c;
}
const FONT = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111', F: '111100110100100', G: '011100101101011',
  H: '101101111101101', I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101',
  O: '010101101101010', P: '110101110100100', Q: '010101101111011', R: '110101110101101', S: '011100010001110', T: '111010010010010', U: '101101101101111',
  V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010', Z: '111001010100111', 0: '111101101101111', 1: '010110010010111',
  2: '110001010100111', 3: '110001110001110', 4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010', 8: '111101111101111',
  9: '111101111001110', '-': '000000111000000', '.': '000000000000010', ':': '000010000010000', '/': '001001010100100', ' ': '000000000000000', '%': '101001010100101',
};
function text(c, x, y, s, rgb, scale = 1) {
  for (const ch of String(s).toUpperCase()) {
    const g = FONT[ch] || FONT[' '];
    for (let i = 0; i < 15; i++) if (g[i] === '1') for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const X = x + (i % 3) * scale + dx, Y = y + ((i / 3) | 0) * scale + dy; if (X >= 0 && Y >= 0 && X < c.w && Y < c.h) c.rgba.set([...rgb, 255], (Y * c.w + X) * 4);
    }
    x += 4 * scale;
  }
}
const upscale = (c, f) => { const o = {w: c.w * f, h: c.h * f, rgba: new Uint8ClampedArray(c.w * f * c.h * f * 4)}; for (let y = 0; y < o.h; y++) for (let x = 0; x < o.w; x++) o.rgba.set(c.rgba.subarray(((y / f | 0) * c.w + (x / f | 0)) * 4, ((y / f | 0) * c.w + (x / f | 0)) * 4 + 4), (y * o.w + x) * 4); return o; };
function blit(dst, src, x0, y0) { for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) { const X = x0 + x, Y = y0 + y; if (X >= 0 && Y >= 0 && X < dst.w && Y < dst.h) dst.rgba.set(src.rgba.subarray((y * src.w + x) * 4, (y * src.w + x) * 4 + 4), (Y * dst.w + X) * 4); } }
// a sprite {w,h,ax,ay,rgba} onto a canvas with its anchor at (px, py); a = overall opacity
function drawSprite(g, s, px, py, a = 1) {
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    const k = (y * s.w + x) * 4, al = s.rgba[k + 3] / 255 * a; if (al <= 0) continue;
    const X = px + x - s.ax, Y = py + y - s.ay; if (X < 0 || Y < 0 || X >= g.w || Y >= g.h) continue;
    const d = (Y * g.w + X) * 4; for (let i = 0; i < 3; i++) g.rgba[d + i] = Math.round(g.rgba[d + i] * (1 - al) + s.rgba[k + i] * al);
  }
}

// ---- statistics of one sprite: {w,h,rgba} with alpha > 0 where drawn ----
function statsOf(s) {
  const n = s.w * s.h, drawn = new Uint8Array(n); let area = 0, x0 = s.w, y0 = s.h, x1 = -1, y1 = -1;
  for (let i = 0; i < n; i++) if (s.rgba[i * 4 + 3] > 0) { drawn[i] = 1; area++; const x = i % s.w, y = (i / s.w) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (!area) return null;
  const luma = [], hue = [], sat = []; let edge = 0, cs = 0, sn = 0;
  for (let i = 0; i < n; i++) {
    if (!drawn[i]) continue;
    const r = s.rgba[i * 4], g = s.rgba[i * 4 + 1], b = s.rgba[i * 4 + 2]; luma.push(0.299 * r + 0.587 * g + 0.114 * b);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), sa = mx ? (mx - mn) / mx : 0; sat.push(sa);
    if (sa > 0.12 && mx - mn > 12) { const d = mx - mn, h = (mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 * Math.PI / 180; cs += Math.cos(h); sn += Math.sin(h); hue.push(h); }
    const x = i % s.w, y = (i / s.w) | 0;
    if (!(x > 0 && drawn[i - 1] && x < s.w - 1 && drawn[i + 1] && y > 0 && drawn[i - s.w] && y < s.h - 1 && drawn[i + s.w])) edge++;
  }
  luma.sort((a, b) => a - b);
  const q = f => Math.round(luma[Math.min(luma.length - 1, Math.floor(f * luma.length))]);
  return {w: x1 - x0 + 1, h: y1 - y0 + 1, area, octile: [1, 2, 3, 4, 5, 6, 7].map(i => q(i / 8)),
    hue: hue.length > area * 0.1 ? Math.round(((Math.atan2(sn, cs) * 180 / Math.PI) + 360) % 360) : null, sat: Math.round(100 * sat.reduce((a, b) => a + b, 0) / area), edge: Math.round(100 * edge / area)};
}

// ---- retail ----
const dirRetail = join(R, 'features', world), catPath = join(dirRetail, 'catalog.json');
const catalog = existsSync(catPath) ? JSON.parse(readFileSync(catPath)).features : [];
const loadPNG = url => { const p = join(dirRetail, basename(url)); return existsSync(p) ? decodePNG(readFileSync(p)) : null; };
function groupOf(f) {
  const area = f.footprintX * f.footprintZ;
  if (f.kind === 'deposit') return 'deposit';
  if (f.kind === 'foliage') return 'shrub';
  if ((f.kind === 'tree' || f.kind === 'other') && f.blocking && f.energy > 0 && area >= 6) return 'node';
  if (f.kind === 'tree') return 'tree';
  if (!f.blocking) return /vent/i.test(f.name) ? 'vent' : 'scar';
  return f.reclaimable && f.metal > 0 ? 'rock' : 'spire';
}
const retailBy = {};
for (const f of catalog) {
  if (!f.sprite) continue;
  const g = groupOf(f);
  if (g === 'deposit' && /aqua/i.test(f.name) && !args.includes('--aqua')) continue;   // metal under water: its own blue sprite, not a ground paint
  (retailBy[g] ||= {total: 0, list: []}).total += f.uses; retailBy[g].list.push(f);
}
const totalUses = catalog.reduce((a, f) => a + f.uses, 0);
function retailItem(f, i) {
  const body = loadPNG(f.sprite.url); if (!body) return null;
  const sh = f.shadow ? loadPNG(f.shadow.url) : null;
  return {src: 'retail', label: String(i + 1), name: f.name, uses: f.uses, meta: `${f.footprintX}x${f.footprintZ} m${f.metal} e${f.energy}`, f,
    body: {...body, ax: f.sprite.xOffset, ay: f.sprite.yOffset}, shadow: sh && {...sh, ax: f.shadow.xOffset, ay: f.shadow.yOffset}, blend: f.shadTrans ? 0.5 : 1};
}

// ---- ours: the variants the page would make, by group ----
const set = defaultSet(config);
function oursGroup(v) {
  if (v.kind !== 'rock') return v.kind;
  return v.params.reclaimable === false ? 'spire' : (Array.isArray(v.params.energy) ? v.params.energy[1] : v.params.energy) > 0 ? 'node' : 'rock';
}
const oursBy = {};
for (const kind of Object.keys(set)) for (const v of variants(kind, set, config)) (oursBy[oursGroup(v)] ||= []).push(v);
const spriteOf = s => s && {w: s.w, h: s.h, ax: s.ax, ay: s.ay, rgba: toRGBA(s, palette)};
function oursItem(v, i, retailDeposits) {
  const base = {src: 'ours', label: String(i + 1), name: `${v.kind} #${v.index} t${v.type}`, meta: `${v.params.cells || v.footprint.join('x')}`, v};
  if (v.kind === 'deposit' || v.kind === 'vent') {
    const metal = v.kind === 'deposit' ? (retailDeposits[i]?.metal ?? 127) : null;
    return {...base, name: `${v.kind} #${v.index}` + (metal ? ` m${metal}` : ''), paint: (g, x, y) => (v.kind === 'deposit' ? paintDeposit : paintVent)(g, x, y, v.kind === 'deposit' ? {...v.params, metal, ...(args.includes('--aqua') ? {underwater: true} : {})} : v.params, v.seed, ctx), reach: v.kind === 'deposit' ? 44 : 30};
  }
  const f = generateFeature(v.kind, v.params, v.seed, ctx);
  return {...base, body: spriteOf(f.body), shadow: spriteOf(f.shadow), blend: f.shadowBlend, bodyBlend: f.bodyBlend, gameplay: f.gameplay};
}

// ---- sheet layout ----
function strip(items, title, band, seed) {
  const ext = it => it.paint ? {l: it.reach, r: it.reach, a: it.reach, b: it.reach}
    : {l: Math.max(it.body.ax, it.shadow?.ax ?? 0), r: Math.max(it.body.w - it.body.ax, it.shadow ? it.shadow.w - it.shadow.ax : 0), a: Math.max(it.body.ay, it.shadow?.ay ?? 0), b: Math.max(it.body.h - it.body.ay, it.shadow ? it.shadow.h - it.shadow.ay : 0)};
  const rows = []; let row = {items: [], w: 0};
  for (const it of items) {
    const e = ext(it), cw = Math.max(14, e.l + e.r + 6);
    if (row.w + cw > MAXW && row.items.length) { rows.push(row); row = {items: [], w: 0}; }
    row.items.push({it, e, cw, x: row.w}); row.w += cw;
  }
  if (row.items.length) rows.push(row);
  const W = Math.max(title.length * 8 + 8, ...rows.map(r => r.w)), heights = rows.map(r => Math.max(...r.items.map(c => c.e.a)) + Math.max(...r.items.map(c => c.e.b)) + 14);
  const H = 12 + heights.reduce((a, b) => a + b, 0) + 2;
  const c = groundCanvas(W, H, seed);
  for (let y = 0; y < 12; y++) for (let x = 0; x < W; x++) c.rgba.set([...band, 255], (y * W + x) * 4);
  text(c, 3, 1, title, [255, 255, 255], 2);
  let y0 = 12;
  rows.forEach((r, ri) => {
    const above = Math.max(...r.items.map(q => q.e.a));
    for (const q of r.items) {
      const px = q.x + 3 + q.e.l, py = y0 + 2 + above;
      if (q.it.paint) {
        const before = new Uint8ClampedArray(c.rgba); q.it.paint(c, px, py);
        // the stamp: pixels the painter changed
        const R0 = q.it.reach, patch = {w: 2 * R0, h: 2 * R0, rgba: new Uint8ClampedArray(4 * 4 * R0 * R0)};
        for (let y = 0; y < 2 * R0; y++) for (let x = 0; x < 2 * R0; x++) { const X = px - R0 + x, Y = py - R0 + y; if (X < 0 || Y < 0 || X >= c.w || Y >= c.h) continue; const k = (Y * c.w + X) * 4; let d = 0; for (let i = 0; i < 3; i++) d += Math.abs(c.rgba[k + i] - before[k + i]); patch.rgba.set([c.rgba[k], c.rgba[k + 1], c.rgba[k + 2], d > 0 ? 255 : 0], (y * patch.w + x) * 4); }
        q.it.stat = statsOf(patch);
      } else {
        if (q.it.shadow) drawSprite(c, q.it.shadow, px, py, q.it.blend ?? 0.5);
        drawSprite(c, q.it.body, px, py, q.it.bodyBlend ?? 1);
        q.it.stat = statsOf(q.it.body);
        if (q.it.stat && q.it.shadow) { const sh = statsOf(q.it.shadow); q.it.stat.shadow = sh ? Math.round(100 * sh.area / q.it.stat.area) : 0; }   // shadow pixels per 100 body pixels
      }
      text(c, q.x + 3, y0 + heights[ri] - 8, q.it.label, [255, 255, 255]);
    }
    y0 += heights[ri];
  });
  return c;
}

// ---- groups ----
const GROUPS = ['deposit', 'vent', 'tree', 'shrub', 'rock', 'spire', 'node', 'scar'];
const mean = (a, w) => { const t = w.reduce((x, y) => x + y, 0) || 1; return a.reduce((s, v, i) => s + v * w[i], 0) / t; };
function aggregate(items) {
  const rows = items.filter(i => i.stat), w = rows.map(i => i.uses ?? 1);
  if (!rows.length) return null;
  const f = k => Math.round(mean(rows.map(r => r.stat[k]), w));
  const hues = rows.filter(r => r.stat.hue !== null);
  let hue = null; if (hues.length) { let cs = 0, sn = 0; hues.forEach(r => { const wi = r.uses ?? 1, a = r.stat.hue * Math.PI / 180; cs += wi * Math.cos(a); sn += wi * Math.sin(a); }); hue = Math.round(((Math.atan2(sn, cs) * 180 / Math.PI) + 360) % 360); }
  return {w: f('w'), h: f('h'), area: f('area'), octile: [0, 1, 2, 3, 4, 5, 6].map(i => Math.round(mean(rows.map(r => r.stat.octile[i]), w))), hue, sat: f('sat'), edge: f('edge'), shadow: rows.some(r => r.stat.shadow !== undefined) ? Math.round(mean(rows.map(r => r.stat.shadow ?? 0), w)) : undefined};
}
const numbers = {world, light, ground: gmean, groups: {}};
const sheets = [];
for (const g of GROUPS) {
  const rl = (retailBy[g]?.list || []).filter(f => !NAMES || NAMES.test(f.name)).sort((a, b) => b.uses - a.uses).slice(0, TOP), ov = oursBy[g] || [];
  if (!rl.length && !ov.length) continue;
  const retailItems = rl.map(retailItem).filter(Boolean), deposits = rl.filter(f => f.kind === 'deposit');
  const oursItems = ov.map((v, i) => oursItem(v, i, deposits));
  const share = retailBy[g] ? Math.round(100 * retailBy[g].total / totalUses) : 0;
  const bands = {retail: [200, 100, 20], ours: [30, 100, 200]};
  const seed = 7 + GROUPS.indexOf(g);
  const mk = (items, tag, band, ttl) => items.length ? strip(items, ttl, band, seed) : strip([{src: tag, label: '', paint: () => {}, reach: 6}], ttl + ' - NONE', band, seed);
  const parts = [];
  const rt = `RETAIL ${g} ${share}% OF USES TOP ${retailItems.length}`, ot = `OURS ${g} ${oursItems.length} VARIANTS`;
  const r1 = mk(retailItems, 'retail', bands.retail, rt), o1 = mk(oursItems, 'ours', bands.ours, ot);
  const r2 = upscale(r1, 2), o2 = upscale(o1, 2);
  const W = Math.max(r1.w, o1.w, r2.w, o2.w) + 8, stack = [r1, o1, r2, o2], H = stack.reduce((a, s) => a + s.h + 4, 4);
  const sheet = canvas(W, H, [24, 24, 24]); let y = 4;
  for (const s of stack) { blit(sheet, s, 4, y); y += s.h + 4; }
  const file = `${g}.png`; writeFileSync(join(out, file), encodePNG(sheet.w, sheet.h, sheet.rgba));
  const strow = it => ({n: it.label, name: it.name, uses: it.uses ?? null, meta: it.meta, ...(it.stat || {})});
  numbers.groups[g] = {share, retail: retailItems.map(strow), retailMean: aggregate(retailItems), ours: oursItems.map(strow), oursMean: aggregate(oursItems)};
  sheets.push(file);
  const m = numbers.groups[g], fmt = a => a ? `${a.w}x${a.h} area ${a.area} luma ${a.octile.join('/')} hue ${a.hue ?? '-'} sat ${a.sat} edge ${a.edge}%${a.shadow !== undefined ? ' shadow ' + a.shadow + '%' : ''}` : '-';
  console.log(`${g.padEnd(8)} retail ${String(share).padStart(2)}% of uses | retail ${fmt(m.retailMean)}\n${' '.repeat(9)}${' '.repeat(22)}| ours   ${fmt(m.oursMean)}`);
}
writeFileSync(join(out, 'numbers.json'), JSON.stringify(numbers, null, 1));
const tr = r => `<tr><td>${r.n}</td><td>${r.name}</td><td>${r.uses ?? ''}</td><td>${r.meta ?? ''}</td><td>${r.w ?? ''}x${r.h ?? ''}</td><td>${r.area ?? ''}</td><td>${r.octile?.join(' / ') ?? ''}</td><td>${r.hue ?? '-'}</td><td>${r.sat ?? ''}</td><td>${r.edge ?? ''}</td><td>${r.shadow ?? ''}</td></tr>`;
const meanRow = (t, a) => a ? tr({n: '', name: `<b>${t}</b>`, ...a}) : '';
writeFileSync(join(out, 'index.html'), `<!doctype html><meta charset=utf-8><title>${world} features: retail vs ours</title><style>body{background:#181818;color:#ddd;font:13px sans-serif;margin:12px}table{border-collapse:collapse;margin:6px 0 24px}td,th{border:1px solid #444;padding:2px 6px;text-align:right}td:nth-child(2){text-align:left}img{image-rendering:pixelated;max-width:100%}</style>
<h1>${world}: retail (orange) vs ours (blue); light ${JSON.stringify(light)}</h1>
${sheets.map(f => { const g = f.replace('.png', ''), m = numbers.groups[g]; return `<h2>${g} (retail ${m.share}% of uses)</h2><img src="${f}"><table><tr><th>#</th><th>name</th><th>uses</th><th>meta</th><th>size</th><th>px</th><th>luma octile cuts</th><th>hue</th><th>sat%</th><th>edge%</th><th>shadow%</th></tr>${m.retail.map(tr).join('')}${meanRow('retail mean (uses-weighted)', m.retailMean)}${m.ours.map(tr).join('')}${meanRow('ours mean', m.oursMean)}</table>`; }).join('\n')}`);
console.log(`wrote ${sheets.length} sheets to ${out}`);
