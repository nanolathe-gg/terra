// The map's generated feature recipes: independent looks, settings, variants and seeds.
// Each recipe copies its source data so edits and placements survive world changes.
// The save holds recipes and placement addresses, never sprite pixels; the shared generator
// draws them in the destination world's light. World tables only choose the starting set.
// Plain module, no DOM: the page (sculpt-features.js) and the tests (repro/feature-set.test.mjs) share it.

export const KINDS = ['deposit', 'vent', 'tree', 'shrub', 'rock', 'scar'];
export const GROUND_KINDS = ['deposit', 'vent'];
export const FILL_KINDS = ['tree', 'shrub', 'rock'];
export const LABELS = {deposit: 'Metal deposit', vent: 'Geothermal vent', tree: 'Tree', shrub: 'Shrub', rock: 'Rock', scar: 'Scar'};
export const PLURALS = {deposit: 'metal deposits', vent: 'geothermal vents', tree: 'trees', shrub: 'shrubs', rock: 'rocks', scar: 'scars'};
export const MAX_VARIANTS = 16;
export const MAX_RECIPES = 32;
// A variant address reserves 16 slots per recipe ID. Array order and variant counts never
// renumber another recipe's placements, including after a save or world change.
export const recipeId = index => Math.floor(index / MAX_VARIANTS);
const VARIATION = {heightVariation:[0,0.6,0], widthVariation:[0,0.6,0]};
const PATTERN = {accentAmount:[0,1,0], patternScale:[2,24,8]};
export const FORMS = {
  tree: {...VARIATION, ...PATTERN, canopyLift:[0,0.65,0], arms:[1,16,7], reach:[12,100,50], thick:[0.6,5,1.6], reachVariation:[0,0.6,0], thickVariation:[0,0.6,0], height: [30, 110, 68], width: [0.42, 1.05, 0.72], density: [0, 1, 0.45], crown: [0, 1, 0.6], curl: [0, 1, 0.6]},
  shrub: {...VARIATION, ...PATTERN, width: [20, 50, 28], height: [14, 40, 19], density: [0, 1, 0.55]},
  rock: {...VARIATION, ...PATTERN, tall: [0, 1, 0], flat: [0, 1, 0], size: [0.7, 1.15, 1], pits: [0, 1, 0], grain: [0, 1, 0.6]},
  scar: {size: [0.3, 1.3, 1], density: [0, 1, 0.55]},
  vent: {size: [0.6, 1.6, 1]},
};
export const SPECIES = ['broadleaf', 'conifer', 'tendril', 'dead', 'deadConifer'];
export function controlRequirement(kind, key, params) {
  const species = params.species || 'broadleaf';
  if (['accentColor','patternScale'].includes(key) && !(params.accentAmount > 0)) return 'Increase second color coverage to show the pattern.';
  if (key === 'patternScale' && params.accentAmount >= 1) return 'Reduce second color coverage below 100% to show patches.';
  if (kind !== 'tree') return '';
  if (['accentColor','accentAmount','patternScale'].includes(key) && species.startsWith('dead')) return 'Choose a living plant shape.';
  if (['heightVariation','widthVariation'].includes(key) && species === 'tendril') return 'Use tendril length and thickness variation.';
  if (key === 'canopyStyle' && species !== 'broadleaf') return 'Choose a broadleaf shape.';
  if (key === 'canopyLift' && !['broadleaf','conifer'].includes(species)) return 'Choose a leafy tree shape.';
  const palm = species === 'broadleaf' && (params.canopyStyle === 'palm' || !params.canopyStyle && params.fronds > 0);
  if (palm && ['taper','peaks','crown','density'].includes(key)) return 'Palm fronds use their own canopy shape.';
  if (['taper', 'peaks', 'crown', 'density', 'clusters'].includes(key) && species !== 'broadleaf' && species !== 'conifer') return 'Choose a leafy tree shape.';
  if (['taper', 'peaks', 'clusters'].includes(key) && species === 'conifer') return 'Choose a broadleaf shape.';
  if (key === 'trunkColor' && species === 'tendril') return 'Tendril plants use the foliage color.';
  if (key === 'width' && species === 'tendril') return 'Tendrils use reach instead of crown width.';
  if (key === 'height' && species === 'tendril') return 'Use tendril length and thickness.';
  if (['curl','arms','reach','thick','reachVariation','thickVariation'].includes(key) && species !== 'tendril') return 'Choose a tendril shape.';
  if (key === 'color' && species.startsWith('dead')) return 'A dead tree has no foliage.';
  return '';
}

// A footprint 'WxD' in cells (rocks from 1x1 to Lava's 7x7 spires; Red's Mars plants are 2x2).
export const cellsOf = c => { const m = /^(\d+)x(\d+)$/.exec(String(c || '')); return m ? [Math.min(16, Math.max(1, +m[1])), Math.min(16, Math.max(1, +m[2]))] : null; };
// The same on every world: Green's deposits (spec 11: 3x3, metal 86-223; RockMetal1's 127 is the most placed) and vents (GreenVent01-10,
// 1x1; crack length 0.8-1.25 of the generator's). Their looks are Green's until another world's are measured.
const COMMON = {
  deposit: {count: 4, metal: 127, types: [{share: 1, params: {}}]},
  vent: {count: 4, types: [{share: 1, params: {}, vary: {size: [0.8, 1.25]}}]},
};
const SEEDS = {deposit: 4711, vent: 4723, tree: 4733, shrub: 4751, rock: 4759, scar: 4783};
// What an artist sets per kind besides the count and the seed: [key, min, max, 'range' for a [lo, hi] pair]. Gameplay ranges (energy,
// metal) come from the retail table (spec 4) and change the game, not the pixels.
// 'color' a '#rrggbb' the kind's colors move to (the world's own color for the kind is the default and changes nothing).
export const SETTINGS = {
  tree: [['taper', 0, 1], ['peaks', 0, 1], ['color', 0, 0, 'color'], ['energy', 0, 5000, 'range']],
  shrub: [['color', 0, 0, 'color']],
  rock: [['shade', 0, 1], ['angular', 0, 1], ['color', 0, 0, 'color'], ['metal', 0, 255, 'range']],
  deposit: [['metal', 0, 255]],
};

// The generator's own defaults (retail Green), for a world table that leaves a setting out.
// Colors: a lit tone of each kind's ramp (sculpt-feature-gen.js: Green's broadleaf leaves, its shrubs, its grey rocks).
const FALLBACK = {tree: {taper: 0.5, peaks: 0.5, color: '#11723c', energy: [250, 250]}, shrub: {color: '#43972b'}, rock: {shade: 0.6, angular: 0.5, color: '#949494', metal: [25, 100]}, deposit: {metal: 127}};

export function hash32(a, b) {
  let n = Math.imul((a >>> 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b >>> 0) + 0x7f4a7c15, 0xc2b2ae35);
  n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d);
  return (n ^ (n >>> 13)) >>> 0;
}
const unit = (a, b) => hash32(a, b) / 4294967296;

export function worldKinds(config) {
  return KINDS.filter(kind => GROUND_KINDS.includes(kind) || config?.features?.[kind]?.types?.length);
}
// Deposits and vents are the same on every world but their look: a world's table may set their painter's params (the halo's tone).
function kindData(kind, config) {
  if (!GROUND_KINDS.includes(kind)) return config?.features?.[kind];
  const own = config?.features?.[kind], look = own?.params;
  // a table may also give the painter's variation (`vary`, ranges for params such as reach) and its own types (a world's second look)
  return look || own?.types ? {...COMMON[kind], types: (own.types || COMMON[kind].types).map(t => ({...t, params: {...look, ...t.params}, vary: {...own.vary, ...t.vary}}))} : COMMON[kind];
}

// Catalog entries are assembled from the existing material tables for both the static build
// and the dev server. A recipe copies its data; the catalog is only a starting point.
export function featureCatalog(config, kind) {
  return [...(COMMON[kind] ? [{id:kind+'-default',kind,name:LABELS[kind]+' · default',data:COMMON[kind]}] : []), ...(config.featureCatalog || []).filter(p => p.kind === kind)];
}
const number = (value, lo, hi, fallback) => value !== null && value !== '' && Number.isFinite(Number(value)) ? Math.min(hi, Math.max(lo, Number(value))) : fallback;
const hex = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
export function makeRecipe(kind, data, id = 0, name = LABELS[kind]) {
  data = structuredClone(data);
  if (data.types?.length === 1) {
    if (kind === 'tree' && data.types[0].params.energy) data.energy = [...data.types[0].params.energy];
    if (kind === 'rock' && data.types[0].params.metal === 0) data.metal = [0, 0];
  }
  const entry = {id, name, count: data.count || 4, seed: SEEDS[kind], data, params: {}, weight: 1};
  for (const [key] of SETTINGS[kind] || []) entry[key] = structuredClone(data[key] ?? FALLBACK[kind][key]);
  return entry;
}
export function defaultSet(config) {
  return Object.fromEntries(worldKinds(config).map(kind => {
    const recipe=makeRecipe(kind,kindData(kind,config),0,`${config.biome || 'Default'} ${LABELS[kind].toLowerCase()}`);
    return [kind,{nextId:1,recipes:[normalizeRecipe(kind,recipe,config,recipe)]}];
  }));
}
// Only JSON values that the generators use are kept. Unknown/removed options do not
// survive in saves as hidden behavior; numeric values and work sizes are bounded.
const EXTRA_NUMBERS = {forks:[2,5],ash:[0,1],pieces:[1,8],lump:[0,1],cap:[0,1],shadow:[0,1],shadowLen:[0,2],gapShare:[0,1],shadowColor:null};
// Catalog params are trusted authored data. Saved recipes must keep those same keys,
// plus the public form controls. Bounds on dimensions also bound sprite allocation.
function cleanParams(value, config, kind, overrides = false) {
  const examples = [kindData(kind, config), ...featureCatalog(config, kind).map(p => p.data)].filter(Boolean);
  const allowed = new Set(['species','canopyStyle','cells','trunkColor','accentColor',...Object.keys(FORMS[kind] || {}), ...Object.keys(EXTRA_NUMBERS)]);
  if (kind === 'vent') { allowed.add('holeAspect'); allowed.add('rimLayers'); }
  for (const d of examples) for (const t of d.types || [{params:d.params}]) for (const k of Object.keys(t.params || {})) allowed.add(k);
  const out = {};
  for (const [k, v] of Object.entries(value || {})) {
    if (!allowed.has(k)) continue;
    if (k === 'canopyStyle') { if (['round','clustered','palm'].includes(v)) out[k]=v; continue; }
    if (k === 'trunkColor' || k === 'accentColor') { if(hex(v))out[k]=v.toLowerCase();continue; }
    if (k === 'species') { if (SPECIES.includes(v)) out[k] = v; continue; }
    if (k === 'cells') { const c = cellsOf(v); if(c) out[k] = c.join('x'); continue; }
    const numeric = k in (FORMS[kind] || {}) || (kind === 'vent' && (k === 'holeAspect' || k === 'rimLayers'));
    if (numeric && (typeof v !== 'number' || !Number.isFinite(v))) continue;
    const safety = {...VARIATION, ...PATTERN, canopyLift:[0,0.65],reachVariation:[0,0.6],thickVariation:[0,0.6],height:[1,256],width:kind==='tree'?[0.05,2]:[0.05,100],size:[0.05,3],reach:kind==='tree'?[1,256]:[0.05,4],thick:[0.1,8],shadowLen:[0,4],pieces:[1,8],arms:[1,16],forks:[2,5],holeAspect:[1,3.5],rimLayers:[0,1]};
    const limits = overrides ? FORMS[kind]?.[k] || EXTRA_NUMBERS[k] || safety[k] : safety[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = limits ? number(v, limits[0], limits[1], limits[2] ?? limits[0]) : number(v, -10000, 10000, 0);
    else if (typeof v === 'boolean' || typeof v === 'string' && v.length <= 64) out[k] = v;
    else if (Array.isArray(v) && v.length > 0 && v.length <= 32) {
      if (['energy', 'metal'].includes(k) && v.length === 2 && v.every(Number.isFinite)) out[k] = v.map(n => number(n, 0, 5000, 0)).sort((a,b) => a-b);
      else if (v.length >= 2 && v.every(hex)) out[k] = v.map(h => h.toLowerCase());
      else if (v.every(pair => Array.isArray(pair) && pair.length === 2 && hex(pair[0]) && Number.isFinite(pair[1]))) out[k] = v.map(([color,share]) => [color.toLowerCase(),number(share,0,1,0)]);
    } else if (Array.isArray(v) && !v.length && ['mottle','flecks','lights'].includes(k)) out[k] = [];
  }
  return out;
}
function settingValues(kind, value, base) {
  const out = {};
  for (const [key, lo, hi, type] of SETTINGS[kind] || []) {
    if (type === 'color') out[key] = hex(value[key]) ? value[key].toLowerCase() : base[key];
    else if (type === 'range') {
      const pair = Array.isArray(value[key]) ? value[key] : base[key];
      const a = Math.round(number(pair[0], lo, hi, base[key][0])), b = Math.round(number(pair[1], lo, hi, base[key][1]));
      out[key] = [Math.min(a, b), Math.max(a, b)];
    } else {
      out[key] = number(value[key], lo, hi, base[key]);
      if (key === 'metal') out[key] = Math.round(out[key]);
    }
  }
  return out;
}
function normalizeRecipe(kind, v, config, fallback) {
  const source = Array.isArray(v.data?.types) && v.data.types.length ? v.data : fallback.data;
  const types = source.types.slice(0, 32).filter(t => t && typeof t === 'object').map(t => {
    const vary = {};
    for (const [key, pair] of Object.entries(t.vary || {})) {
      if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(Number.isFinite)) continue;
      const a = cleanParams({[key]:pair[0]}, config, kind)[key], b = cleanParams({[key]:pair[1]}, config, kind)[key];
      if (Number.isFinite(a) && Number.isFinite(b)) vary[key] = [Math.min(a,b), Math.max(a,b)];
    }
    return {share:number(t.share, 0.001, 1e7, 1), params:cleanParams(t.params, config, kind), vary};
  });
  const data = {
    count:Math.round(number(source.count, 1, MAX_VARIANTS, 4)),
    ...settingValues(kind, source, FALLBACK[kind] || {}),
    types:types.length ? types : fallback.data.types,
  };
  const b = makeRecipe(kind, data, v.id, fallback.name);
  return {...b,
    name:typeof v.name === 'string' && v.name.trim() ? v.name.trim().slice(0, 80) : b.name,
    count:Math.round(number(v.count, 1, MAX_VARIANTS, b.count)),
    seed:Number.isInteger(v.seed) && v.seed >= 0 && v.seed <= 4294967295 ? v.seed : b.seed,
    params:cleanParams(v.params, config, kind, true), weight:number(v.weight, 0.01, 100, 1),
    ...settingValues(kind, v, b),
  };
}
export function normalizeSet(value, config) {
  const base = defaultSet(config), out = {};
  for (const [kind, b] of Object.entries(base)) {
    const ids = new Set(), recipes = [];
    for (const v of (Array.isArray(value?.[kind]?.recipes) ? value[kind].recipes : []).slice(0, MAX_RECIPES)) {
      if (!v || !Number.isInteger(v.id) || v.id < 0 || v.id > 1000000 || ids.has(v.id)) continue;
      ids.add(v.id); recipes.push(normalizeRecipe(kind, v, config, b.recipes[0]));
    }
    out[kind] = recipes.length ? {nextId: Math.max(...recipes.map(r => r.id + 1), Math.round(number(value[kind].nextId, 1, 1000001, 1))), recipes} : b;
  }
  return out;
}

// Which type each variant index takes: every type once, most used first, then the rest in golden-ratio steps over the shares. An index
// keeps its type whatever the count, so adding variants never changes the ones already placed.
function typeOf(types, index) {
  const order = types.map((t, i) => i).sort((a, b) => types[b].share - types[a].share || a - b);
  if (index < order.length) return order[index];
  const total = types.reduce((sum, t) => sum + t.share, 0);
  let t = ((index - order.length) * 0.6180339887 + 0.5) % 1 * total, k = 0;
  while (k < types.length - 1 && t >= types[k].share) { t -= types[k].share; k++; }
  return k;
}

// The kind's variants: what the generator draws for each (seed and parameters), its footprint, and its weight when placement picks one
// at random (its type's retail use share, split among the variants of that type, so placed features keep retail's mix).
export function variants(kind, set, config) {
  return (set?.[kind]?.recipes || []).flatMap(entry => recipeVariants(kind, entry));
}
function recipeVariants(kind, entry) {
  const data = entry.data;
  if (!data?.types?.length) return [];
  const list = [], counts = new Map();
  for (let i = 0; i < entry.count; i++) { const t = typeOf(data.types, i); list.push(t); counts.set(t, (counts.get(t) || 0) + 1); }
  return list.map((t, index) => {
    const type = data.types[t], seed = hash32(entry.seed, index + 1), params = {...type.params};
    let draw = 0;
    for (const [key, [lo, hi]] of Object.entries(type.vary || {})) {
      const value = lo + (hi - lo) * unit(seed, 101 + draw++);
      params[key] = Number.isInteger(lo) && Number.isInteger(hi) ? Math.round(value) : Math.round(value * 100) / 100;
    }
    if (kind === 'tree') Object.assign(params, {taper: entry.taper, peaks: entry.peaks}, type.params.energy && JSON.stringify(entry.energy) === JSON.stringify(data.energy ?? FALLBACK.tree.energy) ? {} : {energy: [...entry.energy]});   // a type with its own energy (a dead tree's 50) keeps it
    if (kind === 'rock') params.angular = entry.angular;
    Object.assign(params, entry.params);
    // Independent streams keep proportions stable when another control/count changes.
    // Explicit zero replaces a preset's size spread with a fixed dimension.
    const center = (key, fallback) => entry.params[key] ?? (type.vary?.[key] ? (type.vary[key][0] + type.vary[key][1]) / 2 : type.params[key]) ?? fallback;
    const varySize = (key, fallback, salt) => {
      const amount = entry.params[key + 'Variation'];
      if (amount === undefined) return;
      params[key] = center(key, fallback) * (1 + amount * (2 * unit(seed, salt) - 1));
    };
    if (kind === 'tree' && params.species !== 'tendril') {
      const baseHeight = center('height', 68), baseWidth = center('width', 0.72);
      const originalWidth = (params.height ?? 68) * (params.width ?? 0.72);
      varySize('height', 68, 811);
      if (entry.params.widthVariation !== undefined || entry.params.heightVariation !== undefined) {
        const widthScale = 1 + (entry.params.widthVariation ?? 0) * (2 * unit(seed, 812) - 1);
        const width = entry.params.widthVariation === undefined ? originalWidth : baseHeight * baseWidth * widthScale;
        params.width = width / (params.height ?? baseHeight);
      }
    } else if (kind === 'shrub') {
      varySize('height', 19, 811); varySize('width', 28, 812);
    } else if (kind === 'tree') {
      varySize('reach', (params.height ?? 68) * 1.2, 813); varySize('thick', 1.6, 814);
    }
    const ref = data.color ?? FALLBACK[kind]?.color;
    if (entry.color && ref && entry.color !== ref) params.recolor = {from: ref, to: entry.color};
    let footprint = cellsOf(params.cells) || [1, 1];
    if (kind === 'rock') {
      footprint = cellsOf(params.cells) || [2, 2];
      // Retail rock metal tracks footprint area (spec 4): the range's low end on a single cell, its high end from 3x3 up.
      params.shade = entry.shade; params.metal = type.params.metal === 0 && JSON.stringify(entry.metal) === JSON.stringify(data.metal ?? FALLBACK.rock.metal) ? 0 : Math.round(entry.metal[0] + (entry.metal[1] - entry.metal[0]) * Math.min(1, (footprint[0] * footprint[1] - 1) / 8));
    }
    if (kind === 'deposit') footprint = [3, 3];
    return {kind, index: entry.id * MAX_VARIANTS + index, recipe: entry.id, localIndex: index, seed, params, footprint, weight: entry.weight * type.share / counts.get(t) / data.types.reduce((sum, t) => sum + t.share, 0), type: t};
  });
}

// A weighted pick from a variant list; u is uniform in [0, 1).
export function pickVariant(list, u) {
  let t = u * list.reduce((sum, v) => sum + v.weight, 0);
  for (const v of list) { t -= v.weight; if (t < 0) return v.index; }
  return list.at(-1)?.index ?? 0;
}

// Words for a variant in the panel: its type ("broadleaf", "2x2", "rock stain").
export function typeLabel(kind, params) {
  if (kind === 'tree') return params.species === 'dead' || params.species === 'deadConifer' ? 'dead' : params.species === 'conifer' ? 'conifer' : params.species === 'tendril' ? 'tendril plant' : params.clusters > 0 ? 'clustered' : 'broadleaf';
  if (kind === 'shrub') return params.density < 0.3 ? 'sparse' : 'dense';
  if (kind === 'rock') return (params.tall > 0.4 ? 'spire ' : '') + (params.cells || '2x2').replace('x', '×');
  if (kind === 'scar') return params.type === 'stain' ? 'rock stain' : 'smudge';
  return '';
}

// One placement of the save: {kind, v (variant index), x, z (top-left footprint cell)} and, for a deposit, its own metal.
export function normalizePlacement(p) {
  if (!p || !KINDS.includes(p.kind) || !Number.isInteger(p.x) || !Number.isInteger(p.z)) return null;
  const out = {kind: p.kind, v: Number.isInteger(p.v) && p.v >= 0 ? p.v : 0, x: p.x, z: p.z};
  if (p.kind === 'deposit') out.metal = Math.round(number(p.metal, 0, 255, COMMON.deposit.metal));
  return out;
}
