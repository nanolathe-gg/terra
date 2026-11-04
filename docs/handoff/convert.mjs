// One-time re-authoring of fixtures from the retired kinds to landform strokes (see README.md here; not a runtime converter; delete after use).
// <repo> must be a checkout of main BEFORE the retirement (TOOL_PRESETS and SHAPE_FIELDS are read from its sculpt.js), <server> serves that checkout.
//   node convert.mjs <repo> <server> <prefix.json|-> <file>...   (rewrites files in place; prints a summary)
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {resolve} from 'node:path';
const [repo, server, prefixFile, ...given] = process.argv.slice(2), files = given.map(f => resolve(f));
const src = readFileSync(`${repo}/sculpt.js`, 'utf8');
const prefix = prefixFile !== '-' && existsSync(prefixFile) ? JSON.parse(readFileSync(prefixFile, 'utf8')) : {};
// SHAPE_FIELDS: key, lo, hi, scale (card units are slider units = value * scale).
const FIELDS = {};
for (const m of src.matchAll(/^\s*\['(\w+)','[\w-]+','(?:[^'\\]|\\.)*',(?:\[[^\]]*\]|[\w.]+(?:\.slice\(\d\))?|\[\.\.\.[^\]]*\]),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)/gm)) FIELDS[m[1]] = {lo: +m[2], hi: +m[3], scale: +m[5]};
const presetText = src.slice(src.indexOf('const TOOL_PRESETS=') + 'const TOOL_PRESETS='.length, src.indexOf('\nconst TOOL_FIELDS'));
const TOOL_PRESETS = Function(`return ${presetText.trim().replace(/;$/, '')}`)();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const configs = {};
async function config(biome) { return configs[biome] ??= await (await fetch(`${server}/sculpt-config.json?biome=${biome}`)).json(); }
function oldCard(kind, world, cfg, override) {
  const wd = k => { const v = Number(cfg.defaults?.[k]); return Number.isFinite(v) ? v : 0; };
  const base = Object.fromEntries(Object.entries(FIELDS).map(([k, f]) => [k, clamp(Math.round(wd(k) * f.scale), f.lo, f.hi)]));
  const starting = {...TOOL_PRESETS[world]?.[kind]};
  return {...base, cracks: {hill: 40, mountain: 60, plateau: 50, crater: 30, offset: 40, landform: 40}[kind] ?? 0, diameter: 200, amount: kind === 'offset' ? 20 : 70, roughness: 35, shelves: 25, bankWidth: 50, beachFlatness: 50, softness: 50, shallowMode: 'area', ...starting, ...override};
}
const r3 = v => Math.round(v * 1000) / 1000, r1 = v => Math.round(v * 10) / 10;
const sm = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const even = n => Array.from({length: n + 1}, (_, i) => i / n);
// The reviewed shore fit: a smoothstep over 90% of the half width, then level (the retail-window fixtures).
const SHORE = [...even(48).map(x => [r3(.9 * x), r3(sm(x))]), [1, 1]];
const hillKnots = [[0, 0], [1 / 3, .02], [2 / 3, .34], [1, 1]].map(([x, y]) => [r3(x), y]), SMOOTH = even(12).map(x => [r3(x), r3(sm(x))]);
const ridge = m => t => t <= 0 ? 0 : (1 - (1 - t) ** 2) ** m;
const mountainKnots = s => even(16).map(x => [r3(x), r3(ridge(3.5 * 2 ** ((.5 - s) * 1.5))(x))]);
const MESA = [[0, 0], [.19, .088], [.381, .25], [.52, .367], [.69, .625], [.845, .883], [1, 1]];
// The approved plateau (LANDFORM_DEFAULTS): its asymmetric foot as the front and back.
const LF_PLATEAU = {form: 'lfPlateau', knots: [[0, 0], [0.08, 0.006], [0.19, 0.035], [0.27, 0.15], [0.37, 0.65], [0.45, 0.96], [0.5, 1], [1, 1]], back: [[0, 0], [0.096, 0.006], [0.228, 0.035], [0.324, 0.15], [0.444, 0.65], [0.54, 0.96], [0.6, 1], [1, 1]]};
const SHARED = ['fingers', 'fingerSize', 'layerPx', 'layerRiser', 'layerVary', 'layerCircle', 'lavaSpread', 'lavaCircleVary', 'shorePlates', 'plateWaterPx', 'plateLandPx', 'plateSize', 'plateGap', 'plateHeight', 'plateMaterial', 'frostNeedles', 'plateVary', 'crystalShoreSeam',
  'waterShore', 'waterDeep', 'waterBed', 'maskChannel', 'maskAmount', 'styleRelief', 'styleCracks', 'styleBanding', 'styleFace', 'styleErosion', 'styleDeposits', 'styleVegetation', 'styleExposure', 'spurCount', 'spurLength', 'spurSpread', 'spurWidth', 'spurTaper', 'spurHeight', 'spurForks', 'spurBulb', 'crestTaper', 'iceFacets', 'iceFacetSize'];
// Pin every landform setting, so no landform preset (e.g. the desert mesa's steps) leaks into a converted stroke.
const PIN = {roughness: 0, softness: 50, faceVariation: 0, facePx: 0, lean: 100, facing: 3, terraces: 0, ledge: 60, terraceJitter: 35, breakup: 0, stepReference: 0, heightReference: 1, combine: 0, routeSmooth: 0, crestTaper: 0,
  wander: 0, widthVary: 0, heightVary: 0, varySize: 160, varyFoot: 100, varyMiddle: 100, fingers: 0, shorePlates: 0, spurCount: 0, iceFacets: 0, maskChannel: 0};
const along = (pts, heights, amount, elev, plain) => {
  // Encode a crest that follows the ground under the path (a relative stroke on uneven ground) as the along curve: the crest's share of elev - plain.
  if (!heights || pts.length < 2) return undefined;
  const crest = heights.map(h => h + amount), span = elev - plain;
  if (Math.max(...crest) - Math.min(...crest) < 3 || Math.abs(span) < 4) return undefined;
  const cum = [0]; for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
  const L = cum.at(-1); if (L < 1) return undefined;
  const ks = crest.map((c, k) => [r3(cum[k] / L), r3(clamp((c - plain) / span, 0, 1.2))]);
  return ks.filter((k, i) => !i || k[0] > ks[i - 1][0] + .01 || i === ks.length - 1);
};
function convert(kind, pts, o, world, cfg, heights) {
  const old = oldCard(kind, world, cfg, o.card || {}), plain = cfg.baseHeight, rough = old.roughness / 100, D = old.diameter, soft = old.softness / 100;
  const card = {...PIN, diameter: D, cracks: old.cracks};
  for (const k of SHARED) if (old[k] !== undefined) card[k] = old[k];
  const base = heights ? heights.reduce((a, b) => a + b, 0) / heights.length : plain;
  const startBase = heights ? heights[0] : plain;
  let curve;
  if (kind === 'deep' || kind === 'shallow') {
    const bank = 2 ** ((old.bankWidth / 100 - .5) * 1.3), d = D * bank;
    Object.assign(card, {diameter: r1(d), heightReference: 1, elevation: kind === 'deep' ? -55 : -7, combine: kind === 'deep' ? 1 : (o.shallowMode ?? old.shallowMode) === 'passage' ? 0 : 2,
      wander: r1(Math.min(120, (kind === 'deep' ? .34 : .08) * rough * d)), widthVary: kind === 'deep' ? r1(Math.min(100, 67 * rough)) : 0, varySize: 210, cracks: 0});
    const layers = Math.round(old.shoreLayers ?? 0);
    if (layers >= 1) Object.assign(card, {stepReference: Math.round(old.layerStyle) === 1 ? 2 : 1, terraces: layers, ledge: old.layerLedge, terraceJitter: old.layerRough});
    curve = {form: 'lfHill', knots: SHORE};
  } else if (kind === 'hill' || kind === 'mountain') {
    const amount = old.amount, elev = Math.round(Math.max(...(heights || [plain]).map(h => h + amount)));
    Object.assign(card, {elevation: elev, wander: r1(Math.min(120, (kind === 'hill' ? .34 : .08) * rough * D)), widthVary: kind === 'hill' ? r1(Math.min(100, 57 * rough)) : 0, heightVary: Math.round(Math.min(40, (kind === 'hill' ? .6 : .1) * rough * amount))});
    const ridgeOpts = Math.round(old.spurCount) >= 1 || old.crestJag > 0 || old.crestVary > 0 || old.crestTaper > 0;
    if (kind === 'hill' && !ridgeOpts && old.lean !== 100) {
      // The shouldered hill: a short steep face and a long smooth back (softness sets their widths; a lean sets the back).
      const face = .66 + (soft - .5) * .9, back = old.lean > 0 ? old.lean / 100 * face : soft === .5 ? 1.34 : 2 - face;
      card.lean = Math.round(clamp(100 * back / face, 25, 400)); curve = {form: 'lfHill', knots: hillKnots, back: SMOOTH};
    } else curve = kind === 'mountain' ? {form: 'lfMountain', knots: mountainKnots(soft)} : {form: 'lfHill'};
    const a = along(pts, heights, amount, elev, plain); if (a) card.along = a;
  } else if (kind === 'plateau' || kind === 'offset' || kind === 'lower') {
    const amount = kind === 'lower' ? -old.amount : old.amount, mesa = old.curve?.form === 'mesa';
    const ref = kind === 'plateau' ? startBase : base;
    Object.assign(card, {elevation: Math.round(ref + amount), combine: amount < 0 ? 1 : 0, wander: r1(Math.min(120, 90 * (D / 300) * (rough / .4))), widthVary: r1(Math.min(100, 35 * rough / .4)), heightVary: rough > 0 ? 3 : 0, varySize: 140, varyFoot: 115, varyMiddle: 145});
    if (old.terraces > 0) Object.assign(card, {terraces: old.terraces, ledge: old.ledge, terraceJitter: old.terraceJitter, breakup: old.breakup ?? 0});
    curve = mesa ? {form: 'mesa', knots: MESA} : kind === 'lower' ? {form: 'lfHill'} : LF_PLATEAU;
    if (kind !== 'plateau') { const a = along(pts, heights, amount, Math.round(ref + amount), plain); if (a) card.along = a; }
  } else if (kind === 'ramp') {
    // A ramp joins its endpoint heights: Flatten to the higher end, the along curve from the lower end's share, a protected route.
    const h0 = heights?.[0] ?? plain, h1 = heights?.at(-1) ?? plain, hi = Math.max(h0, h1), span = hi - plain;
    Object.assign(card, {elevation: Math.round(hi), combine: 2, routeSmooth: 100, cracks: 0});
    if (Math.abs(span) >= 4) card.along = [[0, r3(clamp((h0 - plain) / span, 0, 1.2))], [1, r3(clamp((h1 - plain) / span, 0, 1.2))]];
    curve = {form: 'lfPlateau', knots: [[0, 0], [.2, .1], [.45, .7], [.6, 1], [1, 1]]};
  } else return null;
  card.curve = curve;
  const {card: _, shallowMode, curve: oc, ...rest} = o;
  return ['landform', pts, {...rest, card}];
}
// The fixtures' own layout: Python-style spacing for objects, compact number arrays, one stroke a line.
const numeric = v => Array.isArray(v) && v.every(x => typeof x === 'number' || numeric(x));
let SPACED = false;
const num = v => Array.isArray(v) ? '[' + v.map(num).join(SPACED ? ', ' : ',') + ']' : JSON.stringify(v);
const sp = v => numeric(v) ? num(v) : Array.isArray(v) ? '[' + v.map(sp).join(', ') + ']' : v && typeof v === 'object' ? '{' + Object.entries(v).map(([k, x]) => JSON.stringify(k) + ': ' + sp(x)).join(', ') + '}' : JSON.stringify(v);
function format(scene) {
  const {strokes, ground, query, ...head} = scene, line2 = [];
  if (ground !== undefined) line2.push('"ground": ' + sp(ground)); if (query !== undefined) line2.push('"query": ' + sp(query));
  const first = Object.entries(head).map(([k, x]) => JSON.stringify(k) + ': ' + sp(x)).join(', ');
  return '{' + first + ',\n ' + (line2.length ? line2.join(', ') + ',\n ' : '') + '"strokes": [\n  ' + strokes.map(([k, pts, o]) => '[' + [JSON.stringify(k), num(pts), ...(o === undefined ? [] : [sp(o)])].join(', ') + ']').join(',\n  ') + '\n ]}\n';
}
const RETIRED = new Set(['hill', 'mountain', 'plateau', 'offset', 'lower', 'ramp', 'deep', 'shallow']);
for (const file of files) {
  const text = readFileSync(file, 'utf8'), scene = JSON.parse(text); SPACED = /\[\[-?[\d.]+, /.test(text);
  if (!Array.isArray(scene.strokes) || !scene.strokes.some(s => RETIRED.has(s[0]))) continue;
  const cfg = await config(scene.biome), world = scene.biome, pre = prefix[file] || {};   // sampled heights are above the sea
  let n = 0;
  scene.strokes = scene.strokes.map((s, i) => { if (!RETIRED.has(s[0])) return s; n++; return convert(s[0], s[1], s[2] || {}, world, cfg, pre[i]); });
  writeFileSync(file, format(scene));
  console.log(file, n, 'strokes', Object.keys(pre).length ? 'with prefix heights' : 'on the plain');
}
