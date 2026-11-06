// The map's generated feature set (owner, November 5-6 2026): per kind, how many variants, a seed and the few settings an artist
// sets on purpose. A save keeps this recipe and the placements, never pixels; sculpt-feature-gen.js draws each variant from it.
// Every world has metal deposits and geothermal vents (painted into the ground, carried in game by an invisible feature); trees,
// shrubs, rocks and scars come from the world's `features` table (materials/<world>.json), so a world without one has none of them.
// Plain module, no DOM: the page (sculpt-features.js) and the tests (repro/feature-set.test.mjs) share it.

export const KINDS = ['deposit', 'vent', 'tree', 'shrub', 'rock', 'scar'];
export const GROUND_KINDS = ['deposit', 'vent'];
export const FILL_KINDS = ['tree', 'shrub', 'rock'];
export const LABELS = {deposit: 'Metal deposit', vent: 'Geothermal vent', tree: 'Tree', shrub: 'Shrub', rock: 'Rock', scar: 'Scar'};
export const PLURALS = {deposit: 'metal deposits', vent: 'geothermal vents', tree: 'trees', shrub: 'shrubs', rock: 'rocks', scar: 'scars'};
export const MAX_VARIANTS = 16;
const ROCK_CELLS = {'1x1': [1, 1], '2x2': [2, 2], '3x2': [3, 2], '3x3': [3, 3], '4x3': [4, 3]};
// The same on every world: Green's deposits (spec 11: 3x3, metal 86-223; RockMetal1's 127 is the most placed) and vents (GreenVent01-10,
// 1x1; crack length 0.8-1.25 of the generator's). Their looks are Green's until another world's are measured.
const COMMON = {
  deposit: {count: 4, metal: 127, types: [{share: 1, params: {}}]},
  vent: {count: 4, types: [{share: 1, params: {}, vary: {size: [0.8, 1.25]}}]},
};
const SEEDS = {deposit: 4711, vent: 4723, tree: 4733, shrub: 4751, rock: 4759, scar: 4783};
// What an artist sets per kind besides the count and the seed: [key, min, max, 'range' for a [lo, hi] pair]. Gameplay ranges (energy,
// metal) come from the retail table (spec 4) and change the game, not the pixels.
export const SETTINGS = {
  tree: [['taper', 0, 1], ['peaks', 0, 1], ['energy', 0, 5000, 'range']],
  rock: [['shade', 0, 1], ['metal', 0, 255, 'range']],
  deposit: [['metal', 0, 255]],
};

// The generator's own defaults (retail Green), for a world table that leaves a setting out.
const FALLBACK = {tree: {taper: 0.5, peaks: 0.5, energy: [250, 250]}, rock: {shade: 0.6, metal: [25, 100]}, deposit: {metal: 127}};

export function hash32(a, b) {
  let n = Math.imul((a >>> 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b >>> 0) + 0x7f4a7c15, 0xc2b2ae35);
  n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d);
  return (n ^ (n >>> 13)) >>> 0;
}
const unit = (a, b) => hash32(a, b) / 4294967296;

export function worldKinds(config) {
  return KINDS.filter(kind => GROUND_KINDS.includes(kind) || config?.features?.[kind]?.types?.length);
}
function kindData(kind, config) { return GROUND_KINDS.includes(kind) ? COMMON[kind] : config?.features?.[kind]; }

export function defaultSet(config) {
  const out = {};
  for (const kind of worldKinds(config)) {
    const data = kindData(kind, config), entry = {count: data.count, seed: SEEDS[kind]};
    for (const [key] of SETTINGS[kind] || []) entry[key] = structuredClone(data[key] ?? FALLBACK[kind][key]);
    out[kind] = entry;
  }
  return out;
}

const number = (value, lo, hi, fallback) => value !== null && value !== '' && Number.isFinite(Number(value)) ? Math.min(hi, Math.max(lo, Number(value))) : fallback;
// A saved or edited recipe, kept to the world's kinds and the settings' bounds; anything missing takes the world's default.
export function normalizeSet(value, config) {
  const base = defaultSet(config), out = {};
  for (const [kind, b] of Object.entries(base)) {
    const v = value?.[kind] || {};
    const entry = {count: Math.round(number(v.count, 1, MAX_VARIANTS, b.count)), seed: Number.isInteger(v.seed) && v.seed >= 0 && v.seed <= 4294967295 ? v.seed : b.seed};
    for (const [key, lo, hi, type] of SETTINGS[kind] || []) {
      if (type === 'range') {
        const pair = Array.isArray(v[key]) ? v[key] : b[key], a = Math.round(number(pair[0], lo, hi, b[key][0])), c = Math.round(number(pair[1], lo, hi, b[key][1]));
        entry[key] = [Math.min(a, c), Math.max(a, c)];
      } else entry[key] = key === 'metal' ? Math.round(number(v[key], lo, hi, b[key])) : number(v[key], lo, hi, b[key]);
    }
    out[kind] = entry;
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
  const data = kindData(kind, config), entry = set?.[kind];
  if (!data || !entry) return [];
  const list = [], counts = new Map();
  for (let i = 0; i < entry.count; i++) { const t = typeOf(data.types, i); list.push(t); counts.set(t, (counts.get(t) || 0) + 1); }
  return list.map((t, index) => {
    const type = data.types[t], seed = hash32(entry.seed, index + 1), params = {...type.params};
    let draw = 0;
    for (const [key, [lo, hi]] of Object.entries(type.vary || {})) {
      const value = lo + (hi - lo) * unit(seed, 101 + draw++);
      params[key] = Number.isInteger(lo) && Number.isInteger(hi) ? Math.round(value) : Math.round(value * 100) / 100;
    }
    if (kind === 'tree') Object.assign(params, {taper: entry.taper, peaks: entry.peaks, energy: [...entry.energy]});
    let footprint = [1, 1];
    if (kind === 'rock') {
      footprint = ROCK_CELLS[params.cells] || [2, 2];
      // Retail rock metal tracks footprint area (spec 4): the range's low end on a single cell, its high end from 3x3 up.
      params.shade = entry.shade; params.metal = Math.round(entry.metal[0] + (entry.metal[1] - entry.metal[0]) * Math.min(1, (footprint[0] * footprint[1] - 1) / 8));
    }
    if (kind === 'deposit') footprint = [3, 3];
    return {kind, index, seed, params, footprint, weight: type.share / counts.get(t), type: t};
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
  if (kind === 'tree') return params.species === 'conifer' ? 'conifer' : 'broadleaf';
  if (kind === 'shrub') return params.density < 0.3 ? 'sparse' : 'dense';
  if (kind === 'rock') return (params.cells || '2x2').replace('x', '×');
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
