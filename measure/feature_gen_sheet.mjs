// Build the evidence page for the procedural feature generators: only generated images.
//   node measure/feature_gen_sheet.mjs OUT_DIR GROUND_PNG [stats-table.json]
// Writes OUT_DIR/index.html and OUT_DIR/img/*.png. GROUND_PNG is our own render of Green ground (repro/render.mjs ours.png).
import {mkdirSync, writeFileSync, readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {encodePNG, decodePNG} from './feature_gen_png.mjs';
import {generateFeature, generateVariants, pickVariant, paintDeposit, paintVent, drawFeature, toRGBA, rng, CONTROLS} from '../sculpt-feature-gen.js';

const [out, groundPath, tablePath] = process.argv.slice(2);
const palette = JSON.parse(readFileSync(new URL('../materials/palette.json', import.meta.url))).indexed;
const img = join(out, 'img'); mkdirSync(img, {recursive: true});
const ground0 = decodePNG(readFileSync(groundPath));
const patch = (x, y, w, h) => { const g = {w, h, rgba: new Uint8ClampedArray(w * h * 4)}; for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) g.rgba.set(ground0.rgba.subarray(((y + j) * ground0.w + x + i) * 4, ((y + j) * ground0.w + x + i) * 4 + 4), (j * w + i) * 4); return g; };
const GX = 450, GY = 500;                       // a flat patch of our modern Green ground
const save = (name, w, h, rgba) => { writeFileSync(join(img, name + '.png'), encodePNG(w, h, rgba)); return {name: name + '.png', w, h}; };
const ctx = {palette};
const sceneRnd = rng(4242);

// ---- the scene ----
const SW = 360, SH = 252, scene = patch(GX, GY, SW, SH);
const placed = [];
const vents = [], deposits = [];
paintDeposit(scene, 72, 66, {metal: 223}, 11, ctx); deposits.push([72, 66]);
paintDeposit(scene, 290, 196, {metal: 86}, 12, ctx);
paintVent(scene, 200, 70, {size: 1.1}, 5, ctx);
const sets = {
  broad: generateVariants('tree', 5, {species: 'broadleaf', height: 68}, 100, ctx),
  conif: generateVariants('tree', 4, {species: 'conifer', height: 61, width: 0.5}, 200, ctx),
  burnt: generateVariants('burnt', 2, {}, 300, ctx),
  shrub: generateVariants('shrub', 4, {}, 400, ctx),
  rock: [...generateVariants('rock', 3, {cells: '1x1', size: 1}, 500, ctx), ...generateVariants('rock', 2, {cells: '2x2'}, 510, ctx), ...generateVariants('rock', 1, {cells: '3x3'}, 520, ctx)],
  smudge: generateVariants('scar', 3, {type: 'smudge'}, 600, ctx), stain: generateVariants('scar', 2, {type: 'stain', size: 0.9}, 610, ctx),
};
const tryPlace = (list, x, y) => placed.push({f: pickVariant(list, Math.floor(sceneRnd() * 1e9)), x: Math.round(x), y: Math.round(y)});
for (let i = 0; i < 4; i++) tryPlace(sets.smudge, 20 + sceneRnd() * 320, 40 + sceneRnd() * 200);
for (let i = 0; i < 2; i++) tryPlace(sets.stain, 130 + sceneRnd() * 150, 150 + sceneRnd() * 60);
// grove: broadleaf and conifers clustered, 1-cell spacing
const grove = [[150, 110], [186, 120], [124, 140], [162, 150], [200, 158], [230, 132], [148, 190], [188, 196]];
grove.forEach(([x, y], i) => tryPlace(i % 3 === 2 ? sets.conif : sets.broad, x + (sceneRnd() - 0.5) * 8, y + (sceneRnd() - 0.5) * 6));
for (const [x, y] of [[272, 110], [296, 128], [262, 146]]) tryPlace(sets.conif, x, y);
for (const [x, y] of [[96, 210], [112, 220]]) tryPlace(sets.burnt, x, y);
for (let i = 0; i < 16; i++) tryPlace(sets.shrub, 20 + sceneRnd() * 320, 100 + sceneRnd() * 140);
for (const [x, y] of [[40, 130], [58, 152], [250, 70], [316, 84], [320, 160], [24, 220], [222, 214]]) tryPlace(sets.rock, x, y);
placed.sort((a, b) => a.y - b.y);
for (const p of placed) drawFeature(scene, p.f, p.x, p.y, palette);
const sceneImg = save('scene', SW, SH, scene.rgba);

// ---- tiles: one feature on a ground crop ----
let tilePatchSeed = 0;
function tile(name, f, w, h, ax, ay) {
  const g = patch(GX + 20 + (tilePatchSeed++ % 5) * 11, GY + 20, w, h);
  drawFeature(g, f, ax, ay, palette);
  return save(name, w, h, g.rgba);
}
const rows = [];
const fmtP = p => Object.entries(p).filter(([k]) => !['energy'].includes(k)).map(([k, v]) => `${k} ${typeof v === 'number' ? +v.toFixed(2) : v}`).join(', ');
const gp = f => Object.entries(f.gameplay).filter(([k, v]) => typeof v !== 'boolean' && ['energy', 'metal', 'hp'].includes(k)).map(([k, v]) => `${k} ${v}`).join(', ') + (f.gameplay.blocking ? ', blocks' : ', walk-through') + (f.gameplay.flamable ? ', flamable' : '');
function featureRow(title, note, list, w, h, ax, ay, tag) {
  const items = list.map((f, i) => ({im: tile(`${tag}-${i}`, f, w, h, ax, ay), cap: `seed ${f.seed.toString(36)}: ${fmtP(f.params)}<br>${gp(f)}`}));
  rows.push({title, note, items, w, h});
}
featureRow('Broadleaf trees', 'Ten forms from ten seeds, all with the default controls.', generateVariants('tree', 10, {species: 'broadleaf'}, 1000, ctx), 100, 96, 38, 86, 'broad');
featureRow('Conifers', 'Narrow teardrop, drooping tiers, brown branch pixels in the lower half.', generateVariants('tree', 6, {species: 'conifer', height: 61, width: 0.5}, 2000, ctx).map((f, i) => f), 80, 88, 30, 80, 'conif');
featureRow('Burnt trees', 'Skeletons, the same generator the burn sequence ends on.', generateVariants('burnt', 4, {}, 3000, ctx), 80, 76, 30, 68, 'burnt');
featureRow('Shrubs', 'No shadow. Dark undersides next to lit leaf pixels.', generateVariants('shrub', 6, {}, 4000, ctx), 52, 40, 25, 32, 'shrub');
featureRow('Rocks', 'Small (1x1), 2x2, 3x3 and 4x3 classes; metal tracks footprint.', [...generateVariants('rock', 3, {cells: '1x1'}, 5000, ctx), ...generateVariants('rock', 2, {cells: '2x2'}, 5100, ctx), generateFeature('rock', {cells: '3x3'}, 5200, ctx), generateFeature('rock', {cells: '3x2'}, 5300, ctx), generateFeature('rock', {cells: '4x3'}, 5400, ctx)], 96, 80, 40, 24, 'rock');
featureRow('Scars', 'Smudges (50% blend body) and rock stains (stipple shadow plus pebbles).', [...generateVariants('scar', 2, {type: 'smudge'}, 6000, ctx), ...generateVariants('scar', 2, {type: 'stain', size: 0.9}, 6100, ctx)], 80, 60, 40, 30, 'scar');

// deposits and vents painted into ground
const extraStats = {deposit: [], vent: []};
function diffStats(g0, g) {
  let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1, n = 0, pale = 0; const cols = new Set(), paleMask = new Uint8Array(g.w * g.h);
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) { const k = (y * g.w + x) * 4; if (g0.rgba[k] === g.rgba[k] && g0.rgba[k + 1] === g.rgba[k + 1] && g0.rgba[k + 2] === g.rgba[k + 2]) continue;
    n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); cols.add(g.rgba[k] << 16 | g.rgba[k + 1] << 8 | g.rgba[k + 2]);
    const L = 0.299 * g.rgba[k] + 0.587 * g.rgba[k + 1] + 0.114 * g.rgba[k + 2]; if (L > 150) { pale++; paleMask[y * g.w + x] = 1; } }
  // pale chunks of at least 4 px (4-connected)
  const seen = new Uint8Array(g.w * g.h); let chunks = 0;
  for (let i = 0; i < paleMask.length; i++) if (paleMask[i] && !seen[i]) { let sz = 0; const q = [i]; seen[i] = 1; while (q.length) { const c = q.pop(); sz++; for (const d of [1, -1, g.w, -g.w]) { const nn = c + d; if (nn >= 0 && nn < paleMask.length && paleMask[nn] && !seen[nn] && Math.abs((nn % g.w) - (c % g.w)) <= 1) { seen[nn] = 1; q.push(nn); } } } if (sz >= 4) chunks++; }
  return {w: x1 - x0 + 1, h: y1 - y0 + 1, n, pale, chunks, ncolors: cols.size};
}
function paintedRow(title, note, fn, vals, tag, W, H, kindKey) {
  const items = vals.map((v, i) => { const g0 = patch(GX + 30 + i * 13, GY + 40, W, H), g = patch(GX + 30 + i * 13, GY + 40, W, H); const r = fn(g, W / 2, H / 2, v, 700 + i); extraStats[kindKey].push(diffStats(g0, g)); return {im: save(`${tag}-${i}`, W, H, g.rgba), cap: r.cap}; });
  rows.push({title, note, items, w: W, h: H});
}
paintedRow('Metal deposits', 'Painted into the ground, never a sprite. Metal sets the chunk count.', (g, x, y, v, s) => { const r = paintDeposit(g, x, y, {metal: v}, s, ctx); return {cap: `metal ${v}, ${r.chunks} chunks<br>indestructible, 3x3 cells`}; }, [86, 127, 187, 223], 'dep', 96, 96, 'deposit');
paintedRow('Geothermal vents', 'Crack decals painted into the ground; the game draws the steam.', (g, x, y, v, s) => { paintVent(g, x, y, v, s, ctx); return {cap: `size ${v.size}, forks ${v.forks}<br>geothermal, indestructible, 1x1`}; }, [{size: 0.8, forks: 3}, {size: 1.2, forks: 4}, {size: 1.5, forks: 3}], 'vent', 96, 96, 'vent');
const avg = (a, f) => a.reduce((s, v) => s + f(v), 0) / a.length;
const dep = extraStats.deposit, vt = extraStats.vent;
const extraRows = [
  ['deposit', 'width px', '48 to 59', avg(dep, d => d.w), 48, 59], ['deposit', 'height px', '53 to 66', avg(dep, d => d.h), 53, 66],
  ['deposit', 'pale chunks (4 px or more)', '7 to 23', avg(dep, d => d.chunks), 7, 23], ['deposit', 'pale share of painted px', '0.10 to 0.16', avg(dep, d => d.pale / d.n), 0.10, 0.16],
  ['deposit', 'distinct colors', '84 to 91', avg(dep, d => d.ncolors), 84, 91],
  ['vent', 'width px', '23 to 61', avg(vt, d => d.w), 23, 61], ['vent', 'height px', '20 to 67', avg(vt, d => d.h), 20, 67], ['vent', 'distinct colors', '20 to 46', avg(vt, d => d.ncolors), 20, 46],
].map(([kind, metric, spec, v, lo, hi]) => ({kind, metric, spec, ours: v < 10 ? v.toFixed(2) : v.toFixed(0), ok: v >= lo && v <= hi}));

// controls
const ctrl = [];
function ctrlRow(title, kind, key, vals, base, w, h, ax, ay, tag, extraCtx) {
  const items = vals.map((v, i) => { const f = generateFeature(kind, {...base, [key]: v}, 9001, {...ctx, ...(extraCtx ? extraCtx(v) : {})}); return {im: tile(`${tag}-${i}`, f, w, h, ax, ay), cap: `${key} = ${typeof v === 'number' ? v : JSON.stringify(v)}`}; });
  ctrl.push({title, items, w, h});
}
ctrlRow('Tree crown (smooth to ragged)', 'tree', 'crown', [0, 0.5, 1], {}, 100, 96, 38, 86, 'c-crown');
ctrlRow('Tree density (solid to holey)', 'tree', 'density', [0.1, 0.5, 0.95], {}, 100, 96, 38, 86, 'c-dens');
ctrlRow('Tree color lean (olive to lush)', 'tree', 'lean', [-1, 0, 1], {}, 100, 96, 38, 86, 'c-lean');
ctrlRow('Tree height', 'tree', 'height', [56, 64, 72], {}, 100, 96, 38, 86, 'c-h');
ctrlRow('World light: sun left, sun right, dim', 'tree', 'height', [68, 68, 68], {}, 100, 96, 38, 86, 'c-light', (v) => ({}));
ctrl.pop();
{
  const lights = [{light: {x: -0.62, y: -0.7}, ambient: 1}, {light: {x: 0.62, y: -0.7}, ambient: 1}, {light: {x: -0.62, y: -0.7}, ambient: 0.55}];
  const items = lights.map((c, i) => { const f = generateFeature('tree', {}, 9001, {...ctx, ...c}); return {im: tile(`c-light-${i}`, f, 120, 96, i === 1 ? 70 : 38, 86), cap: ['light from the upper left', 'light from the upper right', 'dim light (ambient 0.55)'][i]}; });
  ctrl.push({title: 'World light drives shading and shadow side', items, w: 120, h: 96});
}
ctrlRow('Rock angularity (round to faceted)', 'rock', 'angular', [0, 0.5, 1], {cells: '2x2'}, 96, 80, 40, 24, 'c-ang');
ctrlRow('Rock footprint class', 'rock', 'cells', ['1x1', '2x2', '3x3'], {}, 96, 80, 40, 24, 'c-cells');
ctrlRow('Shrub density', 'shrub', 'density', [0.1, 0.5, 0.95], {}, 52, 40, 25, 32, 'c-shrub');
ctrlRow('Smudge density', 'scar', 'density', [0.2, 0.55, 1], {type: 'smudge'}, 60, 44, 30, 22, 'c-scar');
{
  const items = [86, 150, 223].map((m, i) => { const g = patch(GX + 30, GY + 40, 96, 96); const r = paintDeposit(g, 48, 48, {metal: m}, 77, ctx); return {im: save(`c-dep-${i}`, 96, 96, g.rgba), cap: `metal = ${m} (${r.chunks} chunks)`}; });
  ctrl.push({title: 'Deposit metal value', items, w: 96, h: 96});
}

// burn strips
const t0 = generateFeature('tree', {species: 'broadleaf'}, 1000, ctx), seq = t0.burn;
let cw = 0, ch = 0, bax = 0, bay = 0;
for (const f of seq) { bax = Math.max(bax, f.ax); bay = Math.max(bay, f.ay); }
for (const f of seq) { cw = Math.max(cw, bax + (f.w - f.ax)); ch = Math.max(ch, bay + (f.h - f.ay)); }
function strip(frames, name) {
  const W = cw * frames.length, buf = new Uint8ClampedArray(W * ch * 4);
  frames.forEach((f, n) => { const rgba = toRGBA(f, palette); for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) { const k = (y * f.w + x) * 4; if (!rgba[k + 3]) continue; const X = n * cw + bax - f.ax + x, Y = bay - f.ay + y, o = (Y * W + X) * 4; buf[o] = rgba[k]; buf[o + 1] = rgba[k + 1]; buf[o + 2] = rgba[k + 2]; buf[o + 3] = 255; } });
  return save(name, W, ch, buf);
}
const stripAll = strip(seq, 'burn-strip');
const pick8 = [0, 3, 8, 20, 40, 60, 80, 95].map(i => seq[i]);
const stripKey = strip(pick8, 'burn-key');
const shrubB = generateFeature('shrub', {}, 4001, ctx).burn;
const sw0 = Math.max(...shrubB.map(f => f.w)), sh0 = Math.max(...shrubB.map(f => f.h)), sax = Math.max(...shrubB.map(f => f.ax)), say = Math.max(...shrubB.map(f => f.ay));
const sbuf = new Uint8ClampedArray(sw0 * shrubB.length * sh0 * 4);
shrubB.forEach((f, n) => { const rgba = toRGBA(f, palette); for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) { const k = (y * f.w + x) * 4; if (!rgba[k + 3]) continue; const X = n * sw0 + sax - f.ax + x, Y = say - f.ay + y, o = (Y * sw0 * shrubB.length + X) * 4; sbuf.set(rgba.subarray(k, k + 4), o); } });
const shrubStrip = save('shrub-burn-strip', sw0 * shrubB.length, sh0, sbuf);
const burntTile = tile('burnt-final', t0.burnt, 80, 76, 30, 68);
const alive = tile('burn-alive', t0, 100, 96, 38, 86);

const table = tablePath && existsSync(tablePath) ? JSON.parse(readFileSync(tablePath, 'utf8')) : null;
if (table) table.rows.push(...extraRows);
const esc = s => String(s);
const cell = it => `<figure><div class="p1" style="width:${it.im.w}px"><img src="img/${it.im.name}" width="${it.im.w}" height="${it.im.h}"></div><div class="p3" style="width:${it.im.w * 3}px"><img src="img/${it.im.name}" width="${it.im.w * 3}" height="${it.im.h * 3}"></div><figcaption>${it.cap}</figcaption></figure>`;
const rowHtml = r => `<section><h3>${r.title}</h3>${r.note ? `<p class="n">${r.note}</p>` : ''}<div class="scroll"><div class="row">${r.items.map(cell).join('')}</div></div></section>`;
const verdictHtml = readFileSync(new URL('./feature_gen_verdict.html', import.meta.url), 'utf8');
const tableHtml = table ? `<table><tr><th>kind</th><th>metric</th><th>spec (retail range)</th><th>ours (mean of ${table.n || 12})</th><th>in range</th></tr>${table.rows.map(r => `<tr class="${r.ok ? 'ok' : 'bad'}"><td>${r.kind}</td><td>${r.metric}</td><td>${r.spec}</td><td>${r.ours}</td><td>${r.ok ? 'yes' : 'no'}</td></tr>`).join('')}</table>` : '';
const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Generated Green map features</title>
<style>
body{background:#16181a;color:#d8dcd8;font:14px/1.45 system-ui,sans-serif;margin:24px auto;max-width:1180px;padding:0 16px}
h1{font-size:22px}h2{font-size:18px;margin-top:36px;border-top:1px solid #333;padding-top:16px}h3{font-size:15px;margin:22px 0 2px}
img{image-rendering:pixelated;display:block}.scroll{overflow-x:auto;padding-bottom:8px}.row{display:flex;gap:14px;align-items:flex-start;width:max-content}
figure{margin:0}figcaption{font-size:11px;color:#9aa;max-width:300px;margin-top:3px}.p1{margin-bottom:4px}.n{color:#9aa;margin:0 0 6px;font-size:12px}
table{border-collapse:collapse;font-size:12px}td,th{border:1px solid #333;padding:2px 8px;text-align:left}tr.bad td{color:#e9a}tr.ok td{color:#bdb}
.anim{width:${cw * 3}px;height:${ch * 3}px;background:#46702a url(img/burn-strip.png) 0 0/${cw * 96 * 3}px ${ch * 3}px no-repeat;image-rendering:pixelated;animation:burn 6.4s steps(96) infinite}
@keyframes burn{to{background-position:-${cw * 96 * 3}px 0}}
.anim1{width:${cw}px;height:${ch}px;background:#46702a url(img/burn-strip.png) 0 0/${cw * 96}px ${ch}px no-repeat;image-rendering:pixelated;animation:burn1 6.4s steps(96) infinite}
@keyframes burn1{to{background-position:-${cw * 96}px 0}}
.sanim{width:${sw0 * 3}px;height:${sh0 * 3}px;background:#46702a url(img/shrub-burn-strip.png) 0 0/${sw0 * shrubB.length * 3}px ${sh0 * 3}px no-repeat;image-rendering:pixelated;animation:sb 2.8s steps(${shrubB.length}) infinite}
@keyframes sb{to{background-position:-${sw0 * shrubB.length * 3}px 0}}
.keystrip{background:#46702a;width:${cw * 8 * 2}px}.keystrip img{width:${cw * 8 * 2}px;height:${ch * 2}px}
</style></head><body>
<h1>Generated Green map features (procedural, no retail data)</h1>
<p>Every image on this page was generated by <code>sculpt-feature-gen.js</code> from a seed and a handful of controls, in the game's 256-color palette, then drawn on our own modern Green ground. Pixel art is shown at whole-number scales only (1x, then 3x); scroll sideways rather than shrinking. Claims are marked <b>(measured)</b> with a number, or <b>(by eye)</b>.</p>
<h2>1. Scene at 1x</h2>
<div class="scroll"><img src="img/scene.png" width="${SW}" height="${SH}"></div>
<h2>Same scene at 3x</h2>
<div class="scroll"><img src="img/scene.png" width="${SW * 3}" height="${SH * 3}"></div>
${verdictHtml}
<h2>2. One row per kind (1x above, 3x below each tile)</h2>
${rows.map(rowHtml).join('')}
<h2>3. Burning, burnt</h2>
<p class="n">Tree burn: 96 frames over 192 ticks (6.4 s), frame 0 is the living tree, the last frame is the skeleton. Animated at 1x and 3x with CSS steps(); the frames are one horizontal strip.</p>
<div class="scroll"><div class="row"><figure><div class="anim1"></div><figcaption>1x, 6.4 s loop</figcaption></figure><figure><div class="anim"></div><figcaption>3x</figcaption></figure><figure><div class="p3" style="width:${alive.w * 3}px"><img src="img/${alive.name}" width="${alive.w * 3}" height="${alive.h * 3}"></div><figcaption>frame 0, alive</figcaption></figure><figure><div class="p3" style="width:${burntTile.w * 3}px"><img src="img/${burntTile.name}" width="${burntTile.w * 3}" height="${burntTile.h * 3}"></div><figcaption>burnt tree (same seed)</figcaption></figure></div></div>
<p class="n">Frames 0, 3, 8, 20, 40, 60, 80, 95 at 2x:</p><div class="scroll"><div class="keystrip"><img src="img/${stripKey.name}"></div></div>
<p class="n">Shrub burn: 42 frames over 84 ticks (flame only), 3x:</p><div class="sanim"></div>
<h2>4. What each control does</h2>
${ctrl.map(rowHtml).join('')}
<h2>5. Spec target against measured</h2>
<p class="n">Spec ranges are the min to max over the retail sprites of that family (from the auditor's committed table); ours is the mean over 12 generated sprites measured with the auditor's <code>feature_stats.py png</code>. Every number here is measured.</p>
${tableHtml}
</body></html>`;
writeFileSync(join(out, 'index.html'), html);
console.log('wrote', join(out, 'index.html'), `cell ${cw}x${ch}`);
