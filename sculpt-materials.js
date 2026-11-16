// Procedural materials for ground and water. A material is one typed node graph (noise and scattered shapes, shaped by levels and
// combined, then colored through gradients) with a Material node that takes its color, art height and shine, plus the game-palette
// colors it is reduced to. The graph is the material's source; the controls its author publishes are what a map maker adjusts.
// The GPU evaluates the compiled graph once per texel of a 512-px repeat (engine-ground.wgsl); terrain, preview and export read that.
import gamePalette from './materials/palette.json' with {type:'json'};
import library from './materials/textures.json' with {type:'json'};

export const MATERIAL_SLOTS = 8;                   // slot 0 is "the world's ground" on a stroke; materials take slots 1 to 7
export const MATERIAL_REPEAT = 512;
export const MATERIAL_CACHE_BYTES = 128 * 1024 * 1024;
export const MAX_NODES = 40, MAX_STOPS = 8, MAX_PALETTE = 32, MAX_CONTROLS = 12, MAX_FRAMES = 12, MAX_TAPPED = 4, MAX_BLURS = 4;
export const THUMB = 64, THUMB_STRIDE = 2;

const P = (key, label, min, max, value, step = 0) => ({key, label, min, max, value, step});
const SEED = P('seed', 'Seed', 0, 999, 0, 1);
const NOISE = [P('size', 'Size (px)', 1, 256, 8), P('detail', 'Fine detail', 0, 1, 0), P('layers', 'Broad layers', 0, 5, 0), SEED];
// Cells, Cracks and Facets read one lattice of scattered points; Jitter is how far each point strays from its cell's middle (0 a square grid).
const CELLS = [...NOISE, P('jitter', 'Jitter', 0, 1, .8)];
const NOISE_KIND = {
  cells: CELLS, cracks: CELLS, facets: CELLS,
  waves: [...NOISE, P('length', 'Length (px)', 1, 256, 24), P('direction', 'Direction (°)', 0, 180, 45), P('crests', 'Crests', 0, 1, 0)],
  ridged: [P('size', 'Size (px)', 2, 256, 16), P('layers', 'Detail layers', 0, 5, 2), P('roughness', 'Detail strength', 0, 1, .5), P('sharpness', 'Sharpness', .25, 4, 1.5), SEED],
  pixel: [SEED],
};
// Each node type: its output type, inputs [key, label, accepted type], optional kinds, parameters and a line of help.
// Types: coords (where a pattern is read), gray (one number a texel) and color. An input of type any takes gray or color. A node's output
// type is fixed, follows its inputs (any) or follows its kind (a function of the node).
export const NODES = {
  warp: {code: 1, label: 'Warp', out: 'coords', inputs: [['in', 'Coordinates', 'coords'], ['by', 'By', 'gray']], kinds: {turbulence: 'Turbulence', flow: 'Curl flow', push: 'Push'},
    params: kind => kind === 'push' ? [P('amount', 'Distance (px)', 0, 64, 8), P('direction', 'Direction (°)', 0, 360, 0)]
      : [P('amount', 'Amount (px)', 0, 24, 2), P('size', 'Size (px)', 1, 128, 10), P('layers', 'Broad layers', 0, 4, 0), P('axis', 'Axis balance', -1, 1, 0), SEED],
    help: 'Bends the coordinates a Noise or Scatter node reads, so its shapes lose their regular outlines; Push moves them along one Direction instead. A By input scales the move: all of it where white, none where black, so one pattern can shift or break another.'},
  noise: {code: 2, label: 'Noise', out: 'gray', inputs: [['in', 'Coordinates', 'coords']],
    kinds: {smooth: 'Smooth', gradient: 'Gradient', billow: 'Billow', cells: 'Cells', cracks: 'Cracks', facets: 'Facets', waves: 'Waves', ridged: 'Ridged', pixel: 'Pixel'},
    params: kind => NOISE_KIND[kind] ?? NOISE,
    help: 'A gray pattern. Color, height and masks can all read the same one. Cells is bright in each cell’s middle, Cracks is the distance to the nearest cell border (dark on the crack) and Facets gives each cell one flat value.'},
  scatter: {code: 3, label: 'Scatter', out: 'gray', inputs: [['in', 'Coordinates', 'coords'], ['density', 'Density', 'gray']],
    params: () => [P('spacing', 'Spacing (px)', 2, 64, 6), P('radius', 'Radius (px)', .25, 16, 2), P('coverage', 'Coverage', 0, 1, .5), P('jitter', 'Jitter', 0, 1.8, 1.5),
      P('hardness', 'Hardness', 0, .95, .1), P('profile', 'Profile', .25, 4, 1), P('sizeVariation', 'Size variation', 0, 1, .5), P('toneVariation', 'Tone variation', 0, 1, .3),
      P('elongation', 'Elongation', 0, 1, 0), P('angle', 'Angle (°)', 0, 180, 0), P('angleVariation', 'Angle variation', 0, 1, 1), P('follow', 'Follow density', 0, 1, 1), SEED],
    help: 'Scattered shapes: dots, pits, clods, pebbles, glints. Elongation narrows each into a streak (scratches, gouges, blades) along its Angle; Angle variation turns each its own way. A Density input thins them where it is dark.'},
  levels: {code: 4, label: 'Levels', out: 'gray', inputs: [['in', 'Input', 'gray']],
    params: () => [P('low', 'Low', -.5, 1, 0), P('high', 'High', 0, 1.5, 1), P('gamma', 'Gamma', .2, 4, 1), P('steps', 'Steps', 2, 16, 4, 1), P('terracing', 'Terracing', 0, 1, 0),
      P('invert', 'Invert', 0, 1, 0)],
    help: 'Stretches a pattern between Low and High. Terracing turns it into even Steps, from smooth (0) to flat shelves with sharp risers (1): terraces, strata bands, posterized patches. The histogram shows where its values lie.'},
  combine: {code: 5, label: 'Combine', out: 'any', inputs: [['a', 'Base', 'any'], ['b', 'Layer', 'any'], ['mask', 'Mask', 'gray']],
    kinds: {mix: 'Mix', add: 'Add', multiply: 'Multiply', subtract: 'Subtract', min: 'Darker of the two', max: 'Lighter of the two', screen: 'Screen'},
    params: () => [P('amount', 'Amount', 0, 2, 1), P('offset', 'Layer offset', -1, 1, 0)],
    help: 'Combines a layer with a base, gray or color. A Mask limits where; Layer offset is subtracted from the layer first (.5 centers a noise).'},
  heightblend: {code: 6, label: 'Height blend', out: 'any', inputs: [['a', 'Base', 'any'], ['b', 'Layer', 'any'], ['ha', 'Base height', 'gray'], ['hb', 'Layer height', 'gray']],
    params: () => [P('softness', 'Softness', .01, 1, .1), P('bias', 'Layer bias', -1, 1, 0)],
    help: 'Shows the layer where its height stands above the base’s, as sand fills between stones.'},
  gradient: {code: 7, label: 'Gradient', out: 'color', inputs: [['in', 'Input', 'gray']],
    params: () => [P('ease', 'Softness', 0, 1, 0)],
    help: 'Colors a gray pattern, dark to light. A stop brighter than 1 lightens when the result multiplies another color.'},
  adjust: {code: 12, label: 'Color adjust', out: 'color', inputs: [['in', 'Color', 'any'], ['mask', 'Mask', 'gray']],
    params: () => [P('hue', 'Hue (°)', -180, 180, 0), P('saturation', 'Saturation', -1, 1, 0), P('value', 'Brightness', -1, 1, 0)],
    help: 'Turns a color’s hue, and scales its saturation and brightness, through an optional Mask: drier or greener patches over every layer at once. The material’s palette limits what shows; after a large change, Pick from the material.'},
  blur: {code: 13, label: 'Blur', out: 'any', inputs: [['in', 'Input', 'any']], params: () => [P('radius', 'Radius (px)', 0, 32, 2)],
    help: 'Softens a gray or color pattern over Radius px (0 leaves it), wrapping at the repeat: soft halos from hard masks, dirt filling cracks, smoother heights. Its input is computed over the whole repeat first, so a material may use four.'},
  light: {code: 8, label: 'Light', out: 'gray', inputs: [['in', 'Height', 'gray']],
    params: () => [P('direction', 'Direction (°)', 0, 360, 135), P('strength', 'Strength', 0, 8, 2)],
    help: 'How a height’s slopes face a light: .5 on the level, lighter toward the light. Tints color like a lit bump without real relief.'},
  cavity: {code: 9, label: 'Cavity', out: 'gray', inputs: [['in', 'Height', 'gray']],
    params: () => [P('radius', 'Radius (px)', 1, 8, 2), P('strength', 'Strength', 0, 8, 2)],
    help: 'Hollows and crests of a height: below .5 in hollows, above it on crests. Darkens crevices or lightens worn tops.'},
  constant: {code: 10, label: 'Constant', out: n => n.kind === 'color' ? 'color' : 'gray', inputs: [], kinds: {gray: 'Gray', color: 'Color'},
    params: kind => kind === 'color' ? [] : [P('value', 'Value', 0, 1, .5)], help: 'One gray value, or one color, everywhere.'},
  output: {code: 11, label: 'Material', out: null, inputs: [['color', 'Color', 'any'], ['height', 'Height', 'gray'], ['shine', 'Shine', 'gray']],
    params: () => [P('relief', 'Relief (px)', 0, 8, 0)],
    help: 'What the material is: its color, the art height the sun lights (Relief scales it; gameplay heights never change) and its shine.'},
};
export const NODE_TYPES = Object.keys(NODES);
// Whether an input that wants one type takes an output of another: any takes gray or color, and a gray input reads a color's brightness.
export const accepts = (want, got) => got != null && (want === 'any' ? got !== 'coords' : want === 'gray' ? got === 'gray' || got === 'color' : want === got);
export const nodeParams = n => NODES[n.type].params(n.kind);
export const nodeKinds = n => NODES[n.type].kinds ?? null;
export const DITHER = [P('amount', 'Palette grain', 0, 1, 1), P('spread', 'Diffusion spread', 0, 1, 0), P('tone', 'Tone response', .5, 2, 1),
  P('red', 'Red weight', .25, 2, 1), P('green', 'Green weight', .25, 2, 1), P('blue', 'Blue weight', .25, 2, 1)];

const object = x => x && typeof x === 'object' && !Array.isArray(x);
const number = (n, what) => { if (typeof n !== 'number' || !Number.isFinite(n)) throw Error(`Invalid ${what}.`); return n; };
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const text = (value, fallback, what, max = 60) => {
  const s = value ?? fallback;
  if (typeof s !== 'string' || !s.trim() || s.trim().length > max) throw Error(`${what} needs 1 to ${max} characters.`);
  return s.trim();
};
function copyStops(value) {
  const stops = value ?? [[0, 0, 0, 0], [1, 1, 1, 1]];
  if (!Array.isArray(stops) || stops.length < 2 || stops.length > MAX_STOPS) throw Error(`A gradient needs 2 to ${MAX_STOPS} stops.`);
  return stops.map(s => {
    if (!Array.isArray(s) || s.length !== 4) throw Error('A gradient stop is a position and three color numbers.');
    return [clamp(number(s[0], 'stop position'), 0, 1), ...s.slice(1).map(v => clamp(number(v, 'stop color'), 0, 2))];
  }).sort((a, b) => a[0] - b[0]);
}
// A Constant's color: one stop, kept as a gradient's stops are so the same color fields and published controls serve both.
function copyColor(value) {
  const stop = Array.isArray(value?.[0]) && value[0].length === 4 ? value[0] : [0, .5, .5, .5];
  return [[0, ...stop.slice(1).map(v => clamp(number(v, 'color'), 0, 2))]];
}
// The type each node puts out, in evaluation order, checking each connection on the way.
function typeNodes(ordered) {
  const types = new Map();
  for (const n of ordered) {
    const spec = NODES[n.type];
    for (const [key, label, want] of spec.inputs) {
      const from = n.in[key]; if (from === null) continue;
      const got = types.get(from);
      if (got === null) throw Error('The Material node has no output to connect.');
      if (!accepts(want, got)) throw Error(`${n.name}: ${label} needs ${want === 'any' ? 'a gray or color' : want === 'coords' ? 'a Warp node’s coordinates' : want === 'gray' ? 'a gray or color' : 'a ' + want} input.`);
    }
    types.set(n.id, typeof spec.out === 'function' ? spec.out(n) : spec.out === 'any' ? (spec.inputs.some(([k, , want]) => want === 'any' && types.get(n.in[k]) === 'color') ? 'color' : 'gray') : spec.out);
  }
  return types;
}
// Nodes in evaluation order: every node after the ones it reads. A cycle has no such order.
export function orderNodes(nodes) {
  const byId = new Map(nodes.map(n => [n.id, n])), visiting = new Set(), done = new Set(), ordered = [];
  const visit = n => {
    if (done.has(n.id)) return;
    if (visiting.has(n.id)) throw Error('That connection would make a loop.');
    visiting.add(n.id);
    for (const [key] of NODES[n.type].inputs) if (n.in[key] !== null) visit(byId.get(n.in[key]));
    visiting.delete(n.id); done.add(n.id); ordered.push(n);
  };
  for (const n of nodes) visit(n);
  return ordered;
}
export const nodeTypes = nodes => typeNodes(orderNodes(nodes));
// One node with its numbers in range. Connections are checked by copyNodes, against the whole graph.
function copyNode(n, seen) {
  if (!object(n) || !Object.hasOwn(NODES, n.type) || typeof n.id !== 'string' || !n.id || n.id.length > 40 || seen.has(n.id)) throw Error('Invalid or duplicate material node.');
  seen.add(n.id);
  const spec = NODES[n.type], out = {id: n.id, type: n.type, name: text(n.name, spec.label, 'A node name'), enabled: n.enabled !== false};
  if (spec.kinds) { out.kind = n.kind ?? Object.keys(spec.kinds)[0]; if (!Object.hasOwn(spec.kinds, out.kind)) throw Error(`Invalid ${spec.label} type.`); }
  out.params = {};
  for (const p of spec.params(out.kind)) {
    const v = clamp(number(n.params?.[p.key] ?? p.value, p.label), p.min, p.max);
    out.params[p.key] = p.step ? Math.round(v / p.step) * p.step : v;
  }
  if (n.type === 'levels' && out.params.high < out.params.low + .01) out.params.high = out.params.low + .01;
  out.in = {};
  for (const [key] of spec.inputs) { const from = n.in?.[key] ?? null; if (from !== null && typeof from !== 'string') throw Error('Invalid node connection.'); out.in[key] = from; }
  if (n.type === 'gradient') out.stops = copyStops(n.stops);
  if (n.type === 'constant' && out.kind === 'color') out.stops = copyColor(n.stops);
  if (n.x !== undefined || n.y !== undefined) { out.x = Math.round(clamp(number(n.x, 'node position'), -20000, 20000)); out.y = Math.round(clamp(number(n.y, 'node position'), -20000, 20000)); }
  return out;
}
export function copyNodes(value) {
  if (!Array.isArray(value) || value.length > MAX_NODES) throw Error(`A material has at most ${MAX_NODES} nodes.`);
  const seen = new Set(), nodes = value.map(n => copyNode(n, seen));
  if (nodes.filter(n => n.type === 'output').length > 1) throw Error('A material has one Material node.');
  if (!nodes.some(n => n.type === 'output')) {
    if (nodes.length >= MAX_NODES) throw Error(`A material has at most ${MAX_NODES} nodes.`);
    nodes.push(copyNode({id: freeId(nodes, 'material'), type: 'output'}, seen));
  }
  for (const n of nodes) for (const key of Object.keys(n.in)) if (n.in[key] !== null && (!seen.has(n.in[key]) || n.in[key] === n.id)) n.in[key] = null;   // a deleted source leaves the input open
  typeNodes(orderNodes(nodes));
  // A Light or Cavity node evaluates its input again at each neighbor, so chains of them multiply the work.
  const byId = new Map(nodes.map(n => [n.id, n])), depth = new Map();
  const tapDepth = n => {
    if (depth.has(n.id)) return depth.get(n.id);
    const below = Math.max(0, ...Object.values(n.in).filter(Boolean).map(id => tapDepth(byId.get(id))));
    const d = below + (['light', 'cavity'].includes(n.type) && n.enabled && n.in.in ? 1 : 0); depth.set(n.id, d); return d;
  };
  if (nodes.some(n => tapDepth(n) > 2) || nodes.filter(n => ['light', 'cavity'].includes(n.type) && n.enabled && n.in.in).length > MAX_TAPPED)
    throw Error(`A material can use ${MAX_TAPPED} Light or Cavity nodes, at most two in a chain.`);
  if (nodes.filter(n => n.type === 'blur').length > MAX_BLURS) throw Error(`A material can use ${MAX_BLURS} Blur nodes.`);
  return nodes;
}
const freeId = (nodes, stem) => { const taken = new Set(nodes.map(n => n.id)); if (!taken.has(stem)) return stem; for (let i = 2; ; i++) if (!taken.has(`${stem}-${i}`)) return `${stem}-${i}`; };
// A new node of a type, placed by the caller. Its seed differs from its siblings', so two new Noise nodes are not the same pattern.
export function makeNode(type, nodes, props = {}) {
  const used = nodes.filter(n => n.params.seed !== undefined).map(n => n.params.seed);
  let seed = 0; while (used.includes(seed)) seed++;
  const node = copyNode({id: freeId(nodes, type), type, ...props}, new Set());
  if (node.params.seed !== undefined && props.params?.seed === undefined) node.params.seed = seed;
  return node;
}

export function copyPalette(value = []) {
  if (!Array.isArray(value) || value.length > MAX_PALETTE || value.some(n => !Number.isInteger(n) || n < 0 || n > 255)) throw Error(`A material palette holds at most ${MAX_PALETTE} game colors (0 to 255).`);
  return [...new Set(value)];
}
// The controls a material publishes: a label over one number of one node, or over a gradient's colors (param 'stops').
export function controlSpec(material, control) {
  const node = material.nodes.find(n => n.id === control.node); if (!node) return null;
  if (control.param === 'stops') return node.stops ? {node, stops: true} : null;
  const spec = nodeParams(node).find(p => p.key === control.param); if (!spec) return null;
  // The control's own range, inside the node setting's: what its author thinks a map maker should reach.
  const min = clamp(Number.isFinite(control.min) ? control.min : spec.min, spec.min, spec.max), max = clamp(Number.isFinite(control.max) ? control.max : spec.max, spec.min, spec.max);
  return {node, spec: min < max ? {...spec, min, max} : spec};
}
// The range a newly published setting starts with. A scale (a size from 1 to 256 px) gets a window about its value, a quarter to four
// times, so a small drag is a small change; any other setting gets its whole range. Its author can change either.
export function controlRange(spec, value) {
  if (!(value > 0) || !(spec.min > 0) || spec.max < 16 * spec.min) return {min: spec.min, max: spec.max};
  const nice = v => Number(v.toPrecision(2));
  return {min: clamp(nice(value / 4), spec.min, spec.max), max: clamp(nice(value * 4), spec.min, spec.max)};
}
export function copyMaterial(value) {
  if (!object(value)) throw Error('Invalid material.');
  const nodes = copyNodes(value.nodes ?? []), ids = new Set(nodes.map(n => n.id));
  const material = {source: value.source == null ? null : text(value.source, null, 'A material source', 80), seed: Math.round(clamp(number(value.seed ?? 0, 'material seed'), 0, 999)), nodes};
  if (value.frames !== undefined && !Array.isArray(value.frames)) throw Error('Invalid material frames.');
  material.frames = (value.frames ?? []).slice(0, MAX_FRAMES).map(f => ({name: text(f?.name, 'Group', 'A frame name'), nodes: [...new Set(Array.isArray(f?.nodes) ? f.nodes : [])].filter(id => ids.has(id))})).filter(f => f.nodes.length);
  if (value.controls !== undefined && !Array.isArray(value.controls)) throw Error('Invalid material controls.');
  material.controls = [];
  for (const c of (value.controls ?? []).slice(0, MAX_CONTROLS)) {
    if (!object(c) || typeof c.node !== 'string' || typeof c.param !== 'string') throw Error('Invalid material control.');
    const control = {label: text(c.label, 'Control', 'A control name'), node: c.node, param: c.param};
    if (c.param !== 'stops' && c.min !== undefined && c.max !== undefined) { control.min = number(c.min, 'A control’s range'); control.max = number(c.max, 'A control’s range'); }
    else if (c.param !== 'stops') {   // one saved before controls had ranges takes the range a new control starts with, so an untouched copy still equals the library's
      const target = controlSpec(material, control);
      if (target) Object.assign(control, controlRange(nodeParams(target.node).find(p => p.key === c.param), target.node.params[c.param]));
    }
    if (controlSpec(material, control) && !material.controls.some(o => o.node === control.node && o.param === control.param)) material.controls.push(control);
  }
  material.palette = copyPalette(value.palette);
  if (value.dither !== undefined && !object(value.dither)) throw Error('Invalid palette settings.');
  material.dither = Object.fromEntries(DITHER.map(p => [p.key, clamp(number(value.dither?.[p.key] ?? p.value, p.label), p.min, p.max)]));
  return material;
}
export const blankMaterial = () => copyMaterial({nodes: [
  {id: 'noise', type: 'noise', x: 0, y: 0}, {id: 'gradient', type: 'gradient', in: {in: 'noise'}, stops: [[0, .35, .35, .35], [1, .6, .6, .6]], x: 240, y: 0},
  {id: 'material', type: 'output', in: {color: 'gradient'}, x: 480, y: 0}]});
// Another material like this one: every seeded node moves together.
export const reseedMaterial = material => ({...material, seed: (material.seed + 1 + Math.floor(Math.random() * 997)) % 1000});
export const paletteRgb = index => gamePalette.indexed[index];

// The compiled graph: nodes in evaluation order, each an instruction of codes, links and numbers for the materialGraphs buffer.
export const STEP_STRIDE = 288, PROGRAM_BYTES = 16 + MAX_NODES * STEP_STRIDE;
export function compileMaterial(material) {
  const nodes = orderNodes(material.nodes), types = typeNodes(nodes), index = new Map(nodes.map((n, i) => [n.id, i]));
  const instructions = nodes.map(n => {
    const spec = NODES[n.type], kinds = spec.kinds ? Object.keys(spec.kinds) : [];
    const links = spec.inputs.map(([key]) => index.get(n.in[key]) ?? -1); while (links.length < 4) links.push(-1);
    const args = spec.params(n.kind).map(p => n.params[p.key] + (p.key === 'seed' ? material.seed : 0));
    if (n.type === 'gradient') args.push(n.stops.length, ...n.stops.flat());
    if (n.type === 'constant' && n.kind === 'color') args.push(...n.stops[0].slice(1));
    return {type: n.type, kind: n.kind ?? '', code: [spec.code, n.enabled ? 1 : 0, Math.max(0, kinds.indexOf(n.kind)), types.get(n.id) === 'color' ? 1 : 0], links, args, out: types.get(n.id)};
  });
  return {nodes, instructions, index};
}
// Pipeline identity is the graph's shape and node types, never a number a control changes.
export const programKey = program => JSON.stringify(program.instructions.map(i => [i.type, i.kind, i.code[1], i.links]));
// Blur stages: each Blur that is on and wired has its input computed over the whole repeat first (a stage), blurred, and read by the
// passes after it. `blurs` are their steps in order; a pass reads earlier stages only where its own nodes reach a Blur (auto layouts
// leave out a texture a pass never reads, so the cache binds it only then).
export function stagePlan(program) {
  const list = program.instructions, blurs = list.map((n, i) => n.type === 'blur' && n.code[1] && n.links[0] >= 0 ? i : -1).filter(i => i >= 0);
  const stage = new Map(blurs.map((i, k) => [i, k]));
  // The nodes a value needs at one point, stopping at Blurs, whose values come from their stage.
  const closure = i => { const seen = new Set(), visit = k => { if (k < 0 || seen.has(k)) return; seen.add(k); if (!stage.has(k)) list[k].links.forEach(visit); }; visit(i); return [...seen].sort((a, b) => a - b); };
  const reads = indices => indices.some(k => stage.has(k)), out = list.findIndex(n => n.type === 'output');
  return {blurs, stage, closure, out, mainReads: reads(closure(out)), stageReads: blurs.map(b => reads(closure(list[b].links[0])))};
}
// The WGSL for a compiled graph: one line a node, in order. A Light or Cavity node reads its height at four neighbors through a
// function that evaluates that height's own branch at another point. With Blurs, `stages` is the source of a third module: one entry
// point a Blur that computes its input (stageN) and the two blur passes (blurPass).
export function programSource(program, thumbnails = false) {
  const list = program.instructions, {blurs, stage, closure, out} = stagePlan(program);
  // A gray input wired to a color reads its brightness (graphGray); every other input reads its source as it is.
  const read = (i, k) => { const from = list[i].links[k]; return NODES[list[i].type].inputs[k][2] === 'gray' && list[from].out === 'color' ? `graphGray(v${from})` : `v${from}`; };
  const call = (i, point) => {
    const {type, kind, code, links} = list[i], s = `s${i}`, value = (k, fallback) => links[k] < 0 ? fallback : read(i, k);
    const coords = links[0] < 0 ? point : `v${links[0]}.xy`, tapped = links[0] >= 0;
    if (!code[1]) return type === 'warp' ? `vec4f(${coords},0,0)` : ['noise', 'scatter', 'constant', 'output'].includes(type) ? 'vec4f(0)' : ['light', 'cavity'].includes(type) ? 'vec4f(.5)' : value(0, 'vec4f(0)');
    const taps = step => ['+vec2f(' + step + ',0)', '-vec2f(' + step + ',0)', '+vec2f(0,' + step + ')', '-vec2f(0,' + step + ')'].map(d => `tap${i}(${point}${d})`).join(',');
    switch (type) {
      case 'warp': return `${kind === 'flow' ? 'nFlow' : kind === 'push' ? 'nPush' : 'nWarp'}(${s},${coords},${value(1, 'vec4f(1)')})`;
      case 'noise': return `${kind === 'ridged' ? 'nRidged' : kind === 'pixel' ? 'nPixel' : 'nNoise'}(${s},${coords})`;
      case 'scatter': return `nScatter(${s},${coords},${value(1, 'vec4f(1)')},${links[1] >= 0})`;
      case 'levels': return `nLevels(${s},${value(0, 'vec4f(0)')})`;
      case 'combine': return `nCombine(${s},${value(0, 'vec4f(0)')},${value(1, 'vec4f(0)')},${value(2, 'vec4f(1)')})`;
      case 'heightblend': return `nHeightBlend(${s},${value(0, 'vec4f(0)')},${value(1, 'vec4f(0)')},${value(2, 'vec4f(0)')},${value(3, 'vec4f(0)')})`;
      case 'gradient': return `nGradient(${s},${value(0, 'vec4f(0)')})`;
      case 'adjust': return `nAdjust(${s},${value(0, 'vec4f(0)')},${value(1, 'vec4f(1)')})`;
      case 'light': return tapped ? `nLight(${s},${taps('1.0')})` : 'vec4f(.5)';
      case 'cavity': return tapped ? `nCavity(${s},${read(i, 0)}.x,${taps(`arg(${s},0u)`)})` : 'vec4f(.5)';
      case 'blur': return stage.has(i) ? `stageAt(${stage.get(i)},${point})` : 'vec4f(0)';
      case 'constant': return kind === 'color' ? `vec4f(arg(${s},0u),arg(${s},1u),arg(${s},2u),1)` : `vec4f(arg(${s},0u))`;
      default: return 'vec4f(0)';
    }
  };
  // Noise kinds share nNoise and tell it which by the instruction's third code, so the index must be the shader's (0 smooth, 1 gradient,
  // 2 billow, 3 cells, 4 cracks, 5 facets, 6 waves): the order of NODES.noise.kinds.
  const lines = indices => indices.map(i => `let s${i}=node(${i}u);let v${i}=${call(i, 'point')};`).join('\n');
  const taps = (blurs.length ? STAGE_READ : '') + list.map((n, i) => ['light', 'cavity'].includes(n.type) && n.code[1] && n.links[0] >= 0 ? `fn tap${i}(point:vec2f)->f32{\n${lines(closure(n.links[0]))}\nreturn ${read(i, 0)}.x;\n}` : '').filter(Boolean).join('\n');
  const all = lines(list.map((_, i) => i)), o = list[out].links;
  const stages = blurs.length ? `@group(1) @binding(1) var<uniform> groundJob:vec4u;
@group(1) @binding(4) var stageOut:texture_storage_2d<rgba32float,write>;
@group(1) @binding(5) var blurSrc:texture_2d<f32>;
${blurs.map((b, k) => `@compute @workgroup_size(8,8)
fn stage${k}(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=textureDimensions(stageOut))){return;}
 graphPeriod=f32(textureDimensions(stageOut).x);graphRow=groundJob.z;let point=vec2f(id.xy);
${lines(closure(list[b].links[0]))}
 textureStore(stageOut,vec2i(id.xy),v${list[b].links[0]});
}`).join('\n')}
${BLUR_PASS}` : null;
  if (thumbnails) {
    const store = list.map((n, i) => n.type === 'output' ? '' : `textureStore(thumbOut,vec2i(id.xy),${i},vec4f(${n.out === 'coords' ? `vec3f(noiseBasis(3,v${i}.xy,24.0,379.0,vec3f(.8,0,0)))` : n.out === 'color' ? `v${i}.rgb` : `vec3f(v${i}.x)`},1));`).join('\n');
    return {taps, main: `@group(1) @binding(0) var thumbOut:texture_storage_2d_array<rgba8unorm,write>;
@group(1) @binding(1) var<uniform> groundJob:vec4u;
@compute @workgroup_size(8,8)
fn thumbMain(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=textureDimensions(thumbOut))){return;}
 graphPeriod=f32(groundJob.x);graphRow=groundJob.z;let point=vec2f(id.xy*groundJob.y);
${all}
${store}
}`, stages};
  }
  return {taps, main: `@group(1) @binding(0) var groundOut:texture_storage_2d_array<rgba32float,write>;
@group(1) @binding(2) var maskOut:texture_storage_2d_array<rgba16float,write>;
@group(1) @binding(1) var<uniform> groundJob:vec4u;
@compute @workgroup_size(8,8)
fn groundMain(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=textureDimensions(groundOut))){return;}
 graphPeriod=f32(textureDimensions(groundOut).x);graphRow=groundJob.z;let point=vec2f(id.xy);
${lines(closure(out))}
 let color=${o[0] < 0 ? 'vec3f(.5)' : `v${o[0]}.rgb`};let height=${o[1] < 0 ? '0.0' : `${read(out, 1)}.x*arg(s${out},0u)`};let shine=${o[2] < 0 ? '0.0' : `clamp(${read(out, 2)}.x,0.0,1.0)`};
 textureStore(groundOut,vec2i(id.xy),i32(groundJob.y),vec4f(color,height));
 textureStore(maskOut,vec2i(id.xy),i32(groundJob.y),vec4f(shine,0,0,1));
}`, stages};
}
// A stage's value at a point: its blurred repeat, wrapped, read between texels where a Light or Cavity asks at a fraction.
const STAGE_READ = `@group(1) @binding(3) var stageIn:texture_2d_array<f32>;
fn stageAt(k:i32,p:vec2f)->vec4f{
 let n=vec2i(textureDimensions(stageIn).xy);let c=floor(p);let f=p-c;let i=vec2i(c);
 let a=textureLoad(stageIn,(i%n+n)%n,k,0);if(all(f==vec2f(0))){return a;}
 let b=textureLoad(stageIn,((i+vec2i(1,0))%n+n)%n,k,0);let d=textureLoad(stageIn,((i+vec2i(0,1))%n+n)%n,k,0);let e=textureLoad(stageIn,((i+vec2i(1,1))%n+n)%n,k,0);
 return mix(mix(a,b,f.x),mix(d,e,f.x),f.y);
}
`;
// One direction of a Gaussian blur (groundJob.x: 0 across, 1 down) of the Blur at step groundJob.w, wrapping at the repeat. Its Radius is
// twice the Gaussian's sigma; below a twentieth of a pixel the input passes unchanged.
const BLUR_PASS = `@compute @workgroup_size(8,8)
fn blurPass(@builtin(global_invocation_id) id:vec3u){
 let n=vec2i(textureDimensions(blurSrc));let p=vec2i(id.xy);if(any(p>=n)){return;}
 graphRow=groundJob.z;let sigma=arg(node(groundJob.w),0u)*.5;
 if(sigma<.05){textureStore(stageOut,p,textureLoad(blurSrc,p,0));return;}
 let dir=select(vec2i(0,1),vec2i(1,0),groundJob.x==0u);let r=min(i32(ceil(sigma*3.0)),48);
 var sum=vec4f(0);var total=0.0;
 for(var k=-r;k<=r;k++){let w=exp(-f32(k*k)/(2.0*sigma*sigma));sum+=textureLoad(blurSrc,((p+dir*k)%n+n)%n,0)*w;total+=w;}
 textureStore(stageOut,p,sum/total);
}`;
// The most a material's art height can rise or fall, by interval arithmetic over its graph: the renderer reserves that much relief.
export function materialReliefBound(material) {
  const values = new Map(), add = (a, b) => [a[0] + b[0], a[1] + b[1]], sub = (a, b) => [a[0] - b[1], a[1] - b[0]];
  const mul = (a, b) => { const v = [a[0] * b[0], a[0] * b[1], a[1] * b[0], a[1] * b[1]]; return [Math.min(...v), Math.max(...v)]; }, mix = (a, b, w) => add(a, mul(sub(b, a), w));
  let height = [0, 0];
  for (const n of orderNodes(material.nodes)) {
    const get = (key, fallback = [0, 0]) => values.get(n.in[key]) ?? fallback, p = n.params; let v = [0, 1];
    if (!n.enabled) v = ['noise', 'scatter', 'constant'].includes(n.type) ? [0, 0] : ['light', 'cavity'].includes(n.type) ? [.5, .5] : get(Object.keys(n.in)[0]);
    else switch (n.type) {
      case 'constant': v = n.kind === 'color' ? [Math.min(...n.stops[0].slice(1)), Math.max(...n.stops[0].slice(1))] : [p.value, p.value]; break;
      case 'gradient': { const all = n.stops.flatMap(s => s.slice(1)); v = [Math.min(...all), Math.max(...all)]; break; }
      case 'heightblend': { const a = get('a'), b = get('b'); v = [Math.min(a[0], b[0]), Math.max(a[1], b[1])]; break; }
      case 'blur': v = get('in'); break;
      case 'adjust': { const a = get('in'); v = [Math.min(0, a[0]), Math.max(a[1], a[1] * (1 + Math.max(0, p.value)))]; break; }   // a turn keeps the brightest channel
      case 'combine': {
        const a = get('a'), q = sub(get('b'), [p.offset, p.offset]), w = mul([p.amount, p.amount], get('mask', [1, 1]));
        v = n.kind === 'add' ? add(a, mul(q, w)) : n.kind === 'subtract' ? sub(a, mul(q, w)) : n.kind === 'multiply' ? mul(a, mix([1, 1], q, w))
          : n.kind === 'min' ? mix(a, [Math.min(a[0], q[0]), Math.min(a[1], q[1])], w) : n.kind === 'max' ? mix(a, [Math.max(a[0], q[0]), Math.max(a[1], q[1])], w)
          : n.kind === 'screen' ? mix(a, sub([1, 1], mul(sub([1, 1], a), sub([1, 1], q))), w) : mix(a, q, w);
        break;
      }
      case 'output': height = mul(get('height'), [p.relief, p.relief]); break;
    }
    values.set(n.id, v);
  }
  return Math.max(...height.map(Math.abs));
}
// A rough color for a material where no GPU is at hand (the minimap's first picture): the middle of the gradient nearest its output.
export function materialTint(material) {
  const byId = new Map(material.nodes.map(n => [n.id, n]));
  let node = byId.get(material.nodes.find(n => n.type === 'output').in.color);
  for (let hops = 0; node && !node.stops && hops < MAX_NODES; hops++) node = byId.get(node.in.a ?? node.in.in ?? node.in.b);
  if (!node?.stops) return [.5, .5, .5];
  return [1, 2, 3].map(c => Math.min(1, node.stops.reduce((sum, stop) => sum + stop[c], 0) / node.stops.length));
}
// What decides a material's pixels: not its name, its layout or which controls it publishes.
export const materialRenderKey = m => JSON.stringify([m.seed, m.nodes.map(({name, x, y, ...n}) => n), m.palette, m.dither]);
// The selected node alone, as the material's color: the same graph and renderer, never saved.
export function soloMaterial(material, id) {
  const node = material.nodes.find(n => n.id === id); if (!node || node.type === 'output') return material;
  const nodes = structuredClone(material.nodes), out = nodes.find(n => n.type === 'output');
  let source = id;
  if (nodeTypes(nodes).get(id) === 'coords') { source = freeId(nodes, 'solo'); nodes.push({id: source, type: 'noise', kind: 'cells', params: {size: 24}, in: {in: id}}); }
  out.in = {color: source, height: null, shine: null};
  return {...copyMaterial({...material, nodes, palette: [], controls: [], frames: []}), dither: {...material.dither, amount: 0}};
}

// A map's materials: each in a slot 1 to 7, one of them the world's ground and one its water.
const nameOf = name => text(name, null, 'A material name', 80);
export function copyMaterials(value) {
  if (value == null) return null;
  if (!Array.isArray(value) || value.length >= MATERIAL_SLOTS) throw Error('A map holds at most seven materials.');
  const slots = new Set(), keys = new Set();
  const list = value.map(m => {
    if (!object(m) || !Number.isInteger(m.slot) || m.slot < 1 || m.slot >= MATERIAL_SLOTS || slots.has(m.slot)) throw Error('A material needs its own slot, 1 to 7.');
    slots.add(m.slot); const key = m.key ?? null;
    if (key !== null && (typeof key !== 'string' || !key.trim() || key.length > 80 || keys.has(key))) throw Error('Material keys must be unique nonempty strings.');
    if (key) keys.add(key);
    return {slot: m.slot, name: nameOf(m.name), key, worldGround: m.worldGround === true, worldWater: m.worldWater === true, ...(m.worldHigh === true ? {worldHigh: true} : {}), ...copyMaterial(m)};
  }).sort((a, b) => a.slot - b.slot);
  for (const role of ['worldGround', 'worldWater', 'worldHigh']) if (list.filter(m => m[role]).length > 1) throw Error('Only one material can be the ' + ({worldGround: 'world’s ground.', worldWater: 'world’s water.', worldHigh: 'world’s highland ground.'})[role]);
  if (list.some(m => m.worldHigh && (m.worldGround || m.worldWater))) throw Error('The world’s highland ground is a material of its own.');
  if (list.some(m => m.worldGround && m.worldWater)) throw Error('The world’s ground and its water are two materials.');
  return list;
}
export const LIBRARY = Object.fromEntries(Object.entries(library).map(([key, m]) => [key, {name: nameOf(m.name), ...copyMaterial({...m, source: key})}]));
const freeSlot = list => { for (let slot = 1; slot < MATERIAL_SLOTS; slot++) if (!list.some(m => m.slot === slot)) return slot; throw Error('A map holds at most seven materials.'); };
const uniqueName = (list, name) => { const taken = new Set(list.map(m => m.name)); if (!taken.has(name)) return name; for (let n = 2; ; n++) if (!taken.has(`${name} ${n}`)) return `${name} ${n}`; };
export function addMaterial(list, material, name = 'Material') {
  const slot = freeSlot(list), added = {slot, name: uniqueName(list, nameOf(name)), key: null, worldGround: false, worldWater: false, ...copyMaterial(material)};
  return {slot, materials: [...list, added].sort((a, b) => a.slot - b.slot)};
}
// Every map has a ground and a water material. Where a list lacks one (a scene, an older save), the library's is added; when the list
// is full, the first material that is not the other role takes it.
const ROLES = [['worldGround', 'ground'], ['worldWater', 'water']];
const libraryFor = (config, which) => LIBRARY[config.materials?.[which]] ?? LIBRARY[`green-${which}`];
export function withWorldMaterials(value, config) {
  let list = copyMaterials(value) ?? [];
  for (const [role, which] of ROLES) {
    if (list.some(m => m[role])) continue;
    const preset = libraryFor(config, which);
    if (list.length >= MATERIAL_SLOTS - 1) { const taker = list.find(m => !m.worldGround && !m.worldWater); list = list.map(m => m === taker ? {...m, [role]: true} : m); continue; }
    const added = addMaterial(list, preset, preset.name); list = added.materials.map(m => m.slot === added.slot ? {...m, [role]: true} : m);
  }
  // A world may also name a highland material (config.materials.high): level raised ground takes it (World row Highland ground). It is added
  // while the list has room; a map without it draws its ground there.
  const high = LIBRARY[config.materials?.high];
  if (high && !list.some(m => m.worldHigh) && list.length < MATERIAL_SLOTS - 1) {
    const added = addMaterial(list, high, high.name); list = added.materials.map(m => m.slot === added.slot ? {...m, worldHigh: true} : m);
  }
  // A world may name more materials its tools lay down (config.materials.extra: library keys; a tool's `material`, sculpt-tools.js
  // toolMaterialSlot). Each the list lacks is added while it has room.
  for (const key of config.materials?.extra || []) {
    const m = LIBRARY[key];
    if (m && !list.some(o => o.source === key) && list.length < MATERIAL_SLOTS - 1) list = addMaterial(list, m, m.name).materials;
  }
  return list;
}
// The world's ground and its water are world settings, like its sliders: every map drawn in the world shows the same two, and a map's
// other materials are its own. A map's list (a save's, or none for a new map) takes the world's two here, each in the slot the map
// already gave that role. `config.worldMaterials` holds the ones the artist changed (keptWorldMaterials); the rest are the library's.
export function adoptWorldMaterials(value, config) {
  let list = withWorldMaterials(value, config);
  for (const [role, which] of ROLES) {
    const source = config.worldMaterials?.find(m => m[role]) ?? libraryFor(config, which), at = list.find(m => m[role]);
    const name = uniqueName(list.filter(m => m !== at), nameOf(source.name));
    list = list.map(m => m === at ? {...m, name, ...copyMaterial(source)} : m);
  }
  return list;
}
// What the world keeps of a map's list: its ground and its water where they differ from the library's, each marked with the library
// material it replaces (`replaces`). A world nobody changed keeps nothing, so a later revision of the library reaches it; and an edit
// follows the library material it replaces.
const libraryKey = (config, which) => LIBRARY[config.materials?.[which]] ? config.materials[which] : `green-${which}`;
export function worldOwnMaterials(list, config) {
  return (list ?? []).filter(m => m.worldGround || m.worldWater).filter(m => {
    const preset = libraryFor(config, m.worldGround ? 'ground' : 'water');
    return m.name !== preset.name || JSON.stringify(copyMaterial(m)) !== JSON.stringify(copyMaterial(preset));
  }).map(m => ({replaces: libraryKey(config, m.worldGround ? 'ground' : 'water'), name: m.name, worldGround: m.worldGround, worldWater: m.worldWater, ...copyMaterial(m)}));
}
// The kept materials that apply to this look of the world: for each role, the one that replaces the library material the look names.
// One with no mark (a world file's, or an earlier store's) applies to any look. Damaged entries are dropped.
export function keptWorldMaterials(stored, config) {
  const kept = [];
  for (const [role, which] of ROLES) {
    const m = (Array.isArray(stored) ? stored : []).find(m => object(m) && m[role] === true && (m.replaces === undefined || m.replaces === libraryKey(config, which)));
    try { if (m) kept.push({replaces: libraryKey(config, which), name: nameOf(m.name), worldGround: role === 'worldGround', worldWater: role === 'worldWater', ...copyMaterial(m)}); } catch (_) {}
  }
  return kept;
}
// The store after an edit: this look's own, beside what the world keeps for the library materials its other looks name.
export function mergeWorldMaterials(stored, own, config) {
  const mine = new Set(ROLES.map(([, which]) => libraryKey(config, which)));
  return [...(Array.isArray(stored) ? stored : []).filter(m => object(m) && typeof m.replaces === 'string' && !mine.has(m.replaces)), ...own];
}
export const worldPair = list => (list ?? []).filter(m => m.worldGround || m.worldWater);
// A new map's materials: the world's two.
export const worldMaterials = config => adoptWorldMaterials(null, config);
export const duplicateMaterial = (list, slot) => { const m = find(list, slot); return addMaterial(list, m, `${m.name} copy`); };
const find = (list, slot) => { const m = list.find(m => m.slot === slot); if (!m) throw Error(`No material in slot ${slot}.`); return m; };
export const renameMaterial = (list, slot, name) => { find(list, slot); return list.map(m => m.slot === slot ? {...m, name: nameOf(name)} : m); };
export const setMaterial = (list, slot, material) => { find(list, slot); const copy = copyMaterial(material); return list.map(m => m.slot === slot ? {...m, ...copy} : m); };
export function assignMaterial(list, slot, role) {
  const m = find(list, slot);
  if (role === 'worldHigh') {
    if (m.worldGround || m.worldWater) throw Error('This material is the world’s ' + (m.worldGround ? 'ground' : 'water') + '. Duplicate it to use it as highland ground too.');
    return list.map(({worldHigh, ...o}) => o.slot === slot ? {...o, worldHigh: true} : o);
  }
  const other = role === 'worldGround' ? 'worldWater' : 'worldGround';
  if (m[other]) throw Error(role === 'worldGround' ? 'This material is the world’s water. Duplicate it to use it as ground too.' : 'This material is the world’s ground. Duplicate it to use it as water too.');
  // A material that becomes the ground or water stops being the highland ground.
  return list.map(({worldHigh, ...o}) => ({...o, ...(worldHigh && o.slot !== slot ? {worldHigh} : {}), [role]: o.slot === slot}));
}
// A stroke's material: -1 for the ground beneath, 0 for the world's ground, else a slot the map still has.
export function strokeMaterial(node, list) {
  const slot = node?.params?.groundPreset;
  return Number.isInteger(slot) && (slot === 0 || list.some(m => m.slot === slot && !m.worldWater)) ? slot : -1;
}
export const keepStrokeMaterials = (nodes, list) => nodes.map(n => n.params && n.params.groundPreset !== undefined && n.params.groundPreset !== strokeMaterial(n, list) ? {...n, params: {...n.params, groundPreset: strokeMaterial(n, list)}} : n);
export function materialsInUse(nodes, list) {
  const used = new Set([...list.filter(m => m.worldGround || m.worldWater || m.worldHigh).map(m => m.slot), ...nodes.filter(n => !n.hidden && (n.kind === 'landform' || n.kind === 'paint' && (n.params?.paintChannel === 26 || n.params?.paintChannel === undefined))).map(n => strokeMaterial(n, list))]);
  return list.filter(m => used.has(m.slot));
}
export function deleteMaterial(list, nodes, slot) {
  const m = find(list, slot);
  if (m.worldGround || m.worldWater) throw Error(`This is the world’s ${m.worldGround ? 'ground' : 'water'}. Assign another material first.`);
  // Deleting the highland material leaves the map without one: raised ground draws the ground.
  const next = list.filter(o => o.slot !== slot); return {materials: next, nodes: keepStrokeMaterials(nodes, next)};
}
// Where a material is used: as the world's ground or water, and by how many visible strokes.
export const materialUsers = (nodes, list, slot) => { const m = find(list, slot); return {world: m.worldGround ? 'ground' : m.worldWater ? 'water' : '', strokes: nodes.filter(n => !n.hidden && n.params?.groundPreset === slot).length}; };
export const materialText = m => JSON.stringify({format: 'terraform-material', name: m.name, ...copyMaterial(m)});
export function parseMaterialText(value) {
  let m; try { m = JSON.parse(value); } catch { throw Error('The clipboard has no material.'); }
  if (m?.format !== 'terraform-material') throw Error('The clipboard has no material.');
  return {name: nameOf(m.name), ...copyMaterial(m)};
}
export function materialCacheUsage(count, pool = MATERIAL_REPEAT) {
  if (!Number.isInteger(count) || count < 0 || count >= MATERIAL_SLOTS) throw Error('Invalid material cache size.');
  const bytes = count * 28 * pool * pool; return {bytes, budget: MATERIAL_CACHE_BYTES, fits: bytes <= MATERIAL_CACHE_BYTES};
}
