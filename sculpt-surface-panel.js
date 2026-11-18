// World › Surface (docs/SURFACE_LAYERS.md): the world's surface layers as a list, top first, in three sections by what draws (layerSection):
// those that draw with the world as it is, the built-ins that draw only where Surface paint has painted, and those that cannot draw yet, each
// with its reason. Each row opens to set a layer's material, its Coverage (stored as amount), its edge and its rule (conditions that must all
// hold, or a score); a row moves within its stage, a material layer can be removed, and a layer is added from a preset. Hovering or focusing a
// row previews where that layer lies on the map. The list is a world setting: `host.apply(next, {commit})` stores it.
import {SURFACE_BUILTINS, SURFACE_NEEDS, SURFACE_STAGE_NAMES, SURFACE_FACTS, SURFACE_RULE_TERMS, SURFACE_DRAWABLE, SURFACE_FIXED, SURFACE_OWN_AMOUNT, PLANT_KINDS, PLANT_LABELS, PLANT_FACTS, surfaceRows, spreadRule, SURFACE_FACT_RANGE, SURFACE_FACT_GRAY, SURFACE_FACT_ROOT, factPosition, factAtPosition, isMaterialLayer, layerKey} from './sculpt-material-model.js';
import {controlRow} from './sculpt-workspace.js';

const $ = id => document.getElementById(id);
// Each fact's name for an artist (its range: sculpt-material-model.js SURFACE_FACT_RANGE).
export const FACT_LABELS = {
  slope: ['Steepness'], aboveSea: ['Height above the sea'], abovePlain: ['Height above the plain'], wear: ['Worn by water'], deposit: ['Sediment laid down'],
  wetness: ['Wetness'], moisture: ['Moisture'], soilDepth: ['Soil depth'], light: ['Sunlight'], top: ['Lumps (1) and hollows (-1)'], convexity: ['Convexity'],
  rockShare: ['Rock'], debrisShare: ['Debris'], sandShare: ['Sand'],
};
export const BUILTIN_LABELS = {
  highland: 'Highland ground', slopeCover: 'Slope cover', soil: 'Bare soil', rock: 'Rock', beach: 'Beach', crown: 'Crown rock', baseBand: 'Base band',
  regrownMoss: 'Moss on regrown debris', fines: 'Debris fines', paintedRock: 'Painted rock', paintedSnow: 'Painted snow', paintedMoss: 'Painted moss',
  sandDust: 'Sand dust', sand: 'Sand', chips: 'Chips', iceCrest: 'Snow on ice crests', iceCap: 'Snow on ice tops',
};
// Where each built-in lies by its own placement (the masks engine-frag.wgsl gives each surfaceStage), in one plain line for its closed row.
export const BUILTIN_WHERE = {
  highland: 'On ground raised past Highland ground’s height', slopeCover: 'On slopes, above the low ground by the water', soil: 'Where the cover thins beside bare rock',
  rock: 'Where rock is bare: its faces and exposed ground', beach: 'Along the shore, within reach of the water', crown: 'On raised ground, bare rock up to its crown',
  baseBand: 'In a band just above the plain, on bedded rock', regrownMoss: 'Where plants grow back over cliff debris', fines: 'In cliff debris: its sand and grit',
  paintedRock: 'Where Rock is painted, and rims and shores near paint', paintedSnow: 'Where Snow or ice is painted', paintedMoss: 'Where Moss is painted',
  sandDust: 'A tint of sand where sand thins out', sand: 'Where sand is painted or deposited', chips: 'Small rock chips on weathered ground',
  iceCrest: 'In lumps on high ground', iceCap: 'On the level tops of raised ground',
};
const fmt = v => String(+Number(v).toFixed(2));
const factName = fact => (FACT_LABELS[fact]?.[0] ?? fact).replace(/\s*\([^)]*\)/g, '');
const andList = words => words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
// Where a layer lies, in words, from its own rule ("Where Moisture is above 0.4 and Sunlight is below 0.8"; a score by its facts and threshold);
// a built-in by its own line, narrowed by its rule if it has one.
export function whereWords(layer) {
  const window = w => { const name = factName(w.fact), from = w.from != null, to = w.to != null;
    return from && to ? `${name} is ${fmt(w.from)} to ${fmt(w.to)}` : from ? `${name} is above ${fmt(w.from)}` : to ? `${name} is below ${fmt(w.to)}` : `${name} is anything`; };
  const {where, score} = spreadRule(layer);   // the limits it draws with, its Spread applied
  const rule = score?.terms?.length ? `Where a score of ${andList(score.terms.map(t => (Number(t.weight ?? 1) < 0 ? 'less ' : '') + factName(t.fact)))} passes ${fmt(score.from ?? .5)}`
    : where?.length ? `Where ${where.map(window).join(' and ')}` : '';
  const own = layer?.builtin != null ? BUILTIN_WHERE[layer.builtin] : '';
  if (own) return rule && !SURFACE_FIXED.includes(layer.builtin) ? `${own}, ${rule[0].toLowerCase()}${rule.slice(1)}` : own;
  return rule || 'Everywhere';
}
// Where a built-in's material comes from when the row has no material of its own to name: a role of the Materials panel or the rock types.
// The others (SURFACE_DRAWABLE) each draw a material the row chooses.
const BUILTIN_SOURCES = {
  highland: 'the world’s highland material', slopeCover: 'the world’s slope material', rock: 'each rock type’s rock', beach: 'the world’s beach material',
  crown: 'the rock type’s rock', fines: 'the debris material', paintedRock: 'the rock type’s rock', chips: 'the rock type’s chips',
};
// Built-ins whose strength and placement are World settings of their own (the rows under the list, in this section's "Built-in settings"):
// their row shows no Coverage, which would only repeat the strength.
const BUILTIN_SETTINGS = {highland: 'highland', baseBand: 'baseBand'};
// The World settings that place each built-in (what the draw reads for its share, engine-frag.wgsl and engine-common.wgsl), in the order an artist
// reaches for them: the open row lists each with its value and a door to it, so where a surface lies is answered from its row. A rock type's
// setting (sculpt-rock-presets.js ROCK_KEYS) shows the world's rock; each rock type sets its own in Rock types.
export const BUILTIN_PLACED_BY = {
  highland: ['highland', 'highFrom', 'highReach'], baseBand: ['baseBand', 'baseBandLow', 'baseBandHigh'], slopeCover: ['slopeTexture'], soil: ['soilRim'],
  rock: ['faceRock', 'rockFaceFrom', 'rimReach', 'shoreRock', 'bankRock', 'lushness'], beach: ['beachWidth'], crown: ['rockCrown'],
  regrownMoss: ['debrisAmount', 'lushness'], fines: ['debrisAmount', 'debrisReach'], sandDust: ['sandDust'], sand: ['sand', 'sandLee', 'sandCrown'],
  iceCrest: ['iceCrest'], iceCap: ['iceSnow'],
};
// Where each stage's layers lie, in plain words (SURFACE_STAGE_NAMES order). A layer moves only among its stage's layers: the engine's own steps
// (tints, beds, cracks, weather) lie between the stages. The open row says it; a closed row only where it helps (CLOSED_PLACE).
const STAGE_PLACE = ['On the ground itself, under everything else', 'With the slope cover, under soil, rock and beach', 'With bare soil, rock and beach, under crown rock and bands',
  'With crown rock, over rock and under the bands', 'With the base band, under debris and sand', 'With debris, painted surfaces and sand, under boulders and cracks',
  'With the chips, over boulders and cracks', 'Over everything but surf and water'];
const CLOSED_PLACE = {7: 'over everything but surf and water'};
// Moving layer i one step up the list (d 1: drawn over the next layer, a higher index) or down (d -1) among `peers`, the indices of the layers
// it moves among (its stage's, in its section). It lands directly after (up) or before (down) the nearest peer in the stored list, so it also
// passes any layer of its stage that lies between them in another section; every other layer keeps its order. Null at either end.
export function moveLayer(layers, i, d, peers) {
  const j = d > 0 ? Math.min(...peers.filter(k => k > i)) : Math.max(...peers.filter(k => k < i));
  if (!Number.isFinite(j)) return null;
  const next = layers.filter((_, k) => k !== i), at = next.indexOf(layers[j]);
  next.splice(d > 0 ? at + 1 : at, 0, layers[i]);
  return next;
}
// Presets a new layer starts from: a material (a library key, or a role of the world's own list) and a rule.
export const SURFACE_PRESETS = [
  {key: 'snow', name: 'Snow above a height', material: 'ice-ground', stage: 'snow', where: [{fact: 'abovePlain', from: 40, fade: 6}], edge: {width: .2, noise: .6, noiseSize: 1}},
  {key: 'moss', name: 'Moss in damp shade', material: 'lush-ground', stage: 'land', where: [{fact: 'moisture', from: .4, fade: .1}, {fact: 'light', to: .8, fade: .1}], amount: .6, edge: {width: .05, noise: 1, noiseSize: 22}, plants: {kind: 'moss', amount: .5}},
  // Plants (the cover classes' tufts and shrubs, as layers): plants-only layers, which draw no material, so only the plants change the picture.
  {key: 'tufts', name: 'Grass tufts on level ground', material: null, stage: 'ground', where: [{fact: 'slope', to: .45, fade: .1}, {fact: 'moisture', from: .15, fade: .1}], plants: {kind: 'grass', amount: .6}},
  {key: 'meadow', name: 'Meadow in damp ground', material: null, stage: 'ground', where: [{fact: 'moisture', from: .5, fade: .1}, {fact: 'soilDepth', from: .4, fade: .1}], edge: {width: .2, noise: .6, noiseSize: 22}, plants: {kind: 'meadow', amount: .7}},
  {key: 'shrubs', name: 'Shrubs in damp hollows', material: null, stage: 'ground', where: [{fact: 'moisture', from: .55, fade: .1}, {fact: 'top', to: .1, fade: .1}], amount: .8, edge: {width: .2, noise: .8, noiseSize: 22}, plants: {kind: 'shrubs', amount: .5}},
  {key: 'scree', name: 'Scree on steep ground', material: 'role:debris', stage: 'land', where: [{fact: 'slope', from: .9, fade: .2}], amount: .7, edge: {width: .1, noise: .8, noiseSize: 6}},
  {key: 'ledge', name: 'Rock on steep convex edges', material: 'role:rock', stage: 'land', score: {terms: [{fact: 'slope', weight: 1}, {fact: 'convexity', weight: 1.5}], from: 1.2, fade: .2}, edge: {width: .1, noise: .6, noiseSize: 4}},
  {key: 'dry', name: 'Dry ground on sunny slopes', material: 'desert-ground', stage: 'land', where: [{fact: 'light', from: 1.15, fade: .1}, {fact: 'moisture', to: .35, fade: .1}], amount: .3, edge: {width: .05, noise: 1, noiseSize: 22}},
  // Low ground (the retired Low ground tint, as a layer): the ground from the sea's bed up to a few units above it, the lake beds too.
  {key: 'lowland', name: 'Low ground by the water', material: 'red-ground', stage: 'ground', where: [{fact: 'aboveSea', to: 5, fade: 1.5}], edge: {width: .2, noise: .6, noiseSize: 20}},
  {key: 'mud', name: 'Mud in wet hollows', material: 'red-ground', stage: 'land', where: [{fact: 'wetness', from: .5, fade: .1}, {fact: 'top', to: -.1, fade: .1}], edge: {width: .2, noise: .6, noiseSize: 1}},
  // Flowers (the cover classes' flowers, as a layer): single pixels of the Flowers material, a clump of one species each, where the ground is wet.
  {key: 'flowers', name: 'Flowers in wet ground', material: 'flowers', stage: 'land', where: [{fact: 'wetness', from: .35, fade: .1}], amount: .1, edge: {width: .05, noise: 1, noiseSize: 1}},
  {key: 'blank', name: 'Material layer', material: 'role:ground', stage: 'land', where: [{fact: 'slope', from: 0, fade: .05}], amount: .5},
];

const stageOf = layer => isMaterialLayer(layer) ? Math.max(0, SURFACE_STAGE_NAMES.indexOf(layer.stage ?? 'land')) : SURFACE_BUILTINS[layer.builtin]?.[0] ?? 0;
const nameOf = layer => layer.name || (isMaterialLayer(layer) ? 'Material layer' : BUILTIN_LABELS[layer.builtin] ?? layer.builtin);
// The layers that drew one pixel (a read of host.inspect: their rows and coverages in draw order), top first, each with its coverage and what
// of it shows: its coverage less what every layer drawn after it covers. The inspector below and the Pick card's "Layers here" read it.
export function layersAt(read, layers) {
  let layerRows = [];
  try { layerRows = surfaceRows(layers).layerRows; } catch (_) {}
  const byRow = new Map(layerRows.map((row, i) => [row, i])), out = [];
  let over = 1;
  for (let k = read.layers.length - 1; k >= 0; k--) {
    const l = read.layers[k], layer = layers[byRow.get(l.row)], seen = l.cover * over;
    over *= 1 - Math.max(0, Math.min(1, l.cover));
    if (layer) out.push({layer, key: layerKey(layer), name: nameOf(layer), cover: Math.min(1, l.cover), seen});
  }
  return out;
}
// What a surface the world lacks (SURFACE_NEEDS `layer`) needs, and the control that lends one.
const LAYER_REASONS = {beach: {text: 'This world has no beach of its own; another world can lend one (choosing reloads the page).', go: {id: 'beach-from'}}};
// Which section of the list a layer belongs in, from facts read directly (no rule is evaluated and no pixel read): 'idle' with its reasons
// while it draws nothing with the world as it is, 'painted' for a built-in that draws only where Surface paint has painted (SURFACE_NEEDS),
// else 'drawing'. `facts`: material(layer) → whether the map holds its material; control(key) → {value, label, note, place, rock, rocks} or
// null (value: the World setting, for a rock type's setting the largest of the world's rock and the rock types in use; note: why the setting
// itself is unavailable, '' if it is not); role(key) → {present, name} or null; layer(name) → whether the world draws that surface;
// fact(name) → a world fact (sculpt-knobs.js worldPanelValues). A reason is {text, go}: go names the control that turns it on ({control} or
// {id}). Anything unknown is no claim.
export function layerSection(layer, facts) {
  const reasons = [], builtin = !isMaterialLayer(layer);
  if (!(builtin && SURFACE_OWN_AMOUNT.includes(layer.builtin)) && Number(layer.amount ?? 1) <= 0) reasons.push({text: 'Coverage is 0.'});
  if (layer.material != null && !facts.material(layer)) reasons.push({text: 'Its material is missing from this map: open the row to choose one.'});
  else if (builtin && layer.material == null && SURFACE_DRAWABLE.includes(layer.builtin)) reasons.push({text: 'It has no material, so it draws nothing: open the row to choose one.'});
  let painted = false;
  for (const need of builtin ? SURFACE_NEEDS[layer.builtin] ?? [] : []) {
    if (need.painted) { painted = true; continue; }
    if (need.control) {
      if (need.unless && facts.fact(need.unless) > 0) continue;
      const c = facts.control(need.control);
      if (!c || !(c.value <= 0)) continue;
      reasons.push({text: `${c.label} is 0${c.rock ? ` for the world’s rock${c.rocks ? ' and every rock type in use' : ''}` : ''}.`, go: {control: need.control}, note: c.note});
    } else if (need.role) {
      const r = facts.role(need.role);
      if (!r || r.present) continue;
      reasons.push({text: `The map has no ${r.name} material: in Materials, choose one and set Also the world’s to ${r.name}.`});
    } else if (need.column) { if (facts.column?.() === false) reasons.push({text: 'No rock has a column of beds: give the world’s rock or a rock type a Rock column.'}); }
    else if (need.layer && !facts.layer(need.layer)) reasons.push(LAYER_REASONS[need.layer] ?? {text: `This world draws no ${need.layer}.`});
  }
  // A lone setting's own requirement says what else it waits for (with more reasons, those already say it).
  const out = reasons.map(({note, ...r}) => reasons.length === 1 && note ? {...r, text: `${r.text} ${note}`} : r);
  return {section: out.length ? 'idle' : painted ? 'painted' : 'drawing', reasons: out};
}
const el = (tag, props = {}, ...children) => { const e = Object.assign(document.createElement(tag), props); for (const c of children) e.append(c); return e; };
// Controls get ids from their layer and part (uid), so a rebuilt list can give focus back to the control that had it.
let rowKey = '';
const uid = part => `surface-${rowKey}-${part}`.replace(/[^A-Za-z0-9_-]/g, '_');
const ROCK_TYPED = ['rock', 'crown', 'paintedRock', 'chips'];
const factSelect = (value, onChange, part) => {
  const select = el('select', {title: 'What it reads', id: uid(part)}, ...SURFACE_FACTS.map(f => el('option', {value: f, textContent: FACT_LABELS[f][0], selected: f === value})));
  select.onchange = () => onChange(select.value);
  return select;
};
// A rule's kind: everywhere (none), conditions that all hold (windows), or a score (weighted facts summed past a threshold).
const ruleKind = layer => layer.score ? 'score' : layer.where?.length ? 'where' : 'none';
function switchRule(layer, kind) {
  const facts = layer.score ? layer.score.terms.map(t => t.fact) : (layer.where ?? []).map(w => w.fact);
  delete layer.where; delete layer.score;
  if (kind === 'none') delete layer.spread;   // a layer shown everywhere has no limits to spread
  if (kind === 'where') layer.where = (facts.length ? facts : ['slope']).map(fact => ({fact, from: .5, fade: .1}));
  if (kind === 'score') layer.score = {terms: (facts.length ? facts : ['slope']).map(fact => ({fact, weight: 1})), from: .5, fade: .1};
}

// `host`: surface() the list now, apply(next, {commit}), restore() the world's own, preview(row or -1), hide(keys) the layers not shown now, material(layer) → {name, color} or
// null (height: whether it has art height), edit(layer, button) to open its material, materialKey(preset) → a library key for a preset's material, library() → the materials a
// layer may draw [{key, name, color}],
// roleMaterial(builtin) and slotMaterial(slot) → {name, color} or null, pick() to take the Pick tool, inspect(at) → what the draw laid there;
// for the sections (layerSection's facts): control(key), role(key), hasLayer(name), fact(name), worldName(), and place(go) → where the control
// that turns a layer on lives ("Rock types › Exposure & relief"), open(go) to show and focus it.
export function mountSurfacePanel(host) {
  const list = $('surface-layers');
  const SECTIONS = ['drawing', 'painted', 'idle'];
  const facts = {material: layer => Boolean(host.material(layer)), control: key => host.control?.(key) ?? null, role: key => host.role?.(key) ?? null,
    layer: name => host.hasLayer?.(name) ?? true, fact: name => host.fact?.(name) ?? 0, column: () => host.hasColumn?.()};
  const open = new Set();   // the layers whose rows are open, by key
  // The design view, by key: layers hidden for now, or the one layer shown alone (solo). Never saved, undone or exported (host.hide).
  const hidden = new Set();
  let solo = null, sent = '';
  const shown = key => solo ? key === solo : !hidden.has(key);
  const sendView = (force = false) => {
    const keys = host.surface().map(layerKey).filter(k => !shown(k)), text = keys.join('\n');
    if (force ? text || sent : text !== sent) { sent = text; const one = solo && host.surface().find(l => layerKey(l) === solo); host.hide(keys, {solo: one ? nameOf(one) : null}); }
  };
  let editing = null;   // the list while a slider moves; committed on change
  const current = () => editing ?? host.surface();
  const put = (next, commit) => { editing = commit ? null : next; host.apply(next, {commit}); if (commit) { build(); reinspect(); } };
  let picking = false;   // a Color picker is open: a rebuild would close it
  const refresh = () => { if (!editing && !picking) { build(); sendView(true); } };   // after a material edit, an undo or a load; not while a slider moves
  const edit = (i, change, commit) => { const next = structuredClone(current()); change(next[i], next); put(next, commit); };
  // The editor's own slider (sculpt-workspace.js controlRow, as the World rows and the shape card): a drag or a key moves the layer live, its
  // release is one undo step. `show` writes the value its label shows.
  const slider = (label, value, min, max, step, onInput, title = '', show = v => fmt(v)) => {
    const id = uid(label), row = controlRow({id, label: `${label} <output></output>`, range: `min="${min}" max="${max}" step="${step}" value="${value}"`});
    const input = row.querySelector('input[type=range]'), out = row.querySelector('output');
    out.textContent = show(value); row.classList.add('surface-slider');
    if (title) row.querySelector('.scrub').title = title;
    input.oninput = () => { out.textContent = show(Number(input.value)); onInput(Number(input.value), false); };
    input.onchange = () => onInput(Number(input.value), true);
    return row;
  };
  const percent = v => Math.round(v * 100) + '%';
  const number = (label, value, onSet, title = label + ' (empty: no limit)', placeholder = 'open', part = label) => {
    const input = el('input', {type: 'number', step: 'any', value: value ?? '', placeholder, title, id: uid(part)});
    input.onchange = () => onSet(input.value === '' ? undefined : Number(input.value));
    return el('label', {className: 'surface-number'}, el('span', {textContent: label}), input);
  };
  const remover = (title, onClick) => { const b = el('button', {type: 'button', textContent: '×', title, ariaLabel: title}); b.onclick = onClick; return b; };
  // `drawn`: the condition as the layer draws it, its Spread applied; when that moved its limits, the row says where they are now.
  function windowRow(i, k, w, drawn) {
    const set = (field, v) => edit(i, l => { if (v === undefined) delete l.where[k][field]; else l.where[k][field] = v; }, true);
    const moved = drawn && (drawn.from !== w.from || drawn.to !== w.to);
    return el('div', {className: 'surface-term'}, factSelect(w.fact, f => edit(i, l => { l.where[k].fact = f; }, true), `w${k}-fact`),
      number('from', w.from, v => set('from', v), undefined, undefined, `w${k}-from`), number('to', w.to, v => set('to', v), undefined, undefined, `w${k}-to`),
      number('fade', w.fade ?? .05, v => edit(i, l => { l.where[k].fade = Math.max(v ?? .05, .0001); }, true), 'How gradually it starts and stops', '', `w${k}-fade`),
      remover('Remove this condition', () => edit(i, l => { l.where.splice(k, 1); if (!l.where.length) delete l.where; }, true)),
      ...(moved ? [el('span', {className: 'small surface-spread-now', textContent: `With Spread: ${drawn.from != null ? fmt(drawn.from) : 'open'} to ${drawn.to != null ? fmt(drawn.to) : 'open'}`})] : []));
  }
  function termRow(i, k, t) {
    return el('div', {className: 'surface-term'}, factSelect(t.fact, f => edit(i, l => { l.score.terms[k].fact = f; }, true), `t${k}-fact`),
      number('×', t.weight ?? 1, v => edit(i, l => { l.score.terms[k].weight = v ?? 1; }, true), 'Its weight in the sum (negative: it counts against)', '1', `t${k}-weight`),
      remover('Remove this term', () => edit(i, l => { l.score.terms.splice(k, 1); if (!l.score.terms.length) delete l.score; }, true)));
  }
  // The fact view (engine-frag.wgsl views 14 to 17): pointing at or focusing a condition shows its fact over the map in gray, magenta where the
  // condition holds, while "Stripes where the layer under the pointer lies" is on; the block's legend then gives the fact's range, a histogram
  // of the map in view across it (from the view's own pixels, host.factSample) with the condition's limits marked, and the share that holds it.
  // What the legend shows: the layer (key) and its condition k, and its contents (a function, so a rebuilt row gets fresh elements). A rebuild of
  // the list (a material measured, a World setting changed) keeps it: the new row's legend shows it again (showFact, called by build).
  let sampling = 0, factShown = null;
  const showFact = () => {
    // A rebuild drops the focus from the row (its focusout clears the map's preview): the fact view is asked for again (a no-op when it is on).
    if (factShown) host.preview(factShown.row, factShown.k);
    for (const l of list.querySelectorAll('.surface-fact-view')) {
      const mine = factShown && l.closest('.surface-layer')?.dataset.key === factShown.key;
      l.hidden = !mine; if (mine) l.replaceChildren(...factShown.parts());
    }
  };
  function factView(term, k, layer, layerRow) {
    const key = layerKey(layer), fact = layer.score ? layer.score.terms[k]?.fact : layer.where?.[k]?.fact, drawn = layer.score ? null : spreadRule(layer).where[k];
    const on = () => {
      if (!$('surface-show').checked || layerRow == null || !fact) return;
      host.preview(layerRow, k);
      const ticket = ++sampling, [lo, hi] = SURFACE_FACT_RANGE[fact], holds = layer.score ? 'the score passes' : 'this condition holds';
      const range = `On the map: ${factName(fact)} in gray, dark at ${fmt(lo)} to light at ${fmt(hi)}${SURFACE_FACT_ROOT.includes(fact) ? ` (${fmt(factAtPosition(fact, .5))} at the middle: the low end spread out)` : ''}`;
      const late = () => ['rockShare', 'debrisShare', 'sandShare'].includes(fact) ? [el('p', {className: 'small', textContent: 'The map shows its final share; a layer drawn before that share is complete saw less.'})] : [];
      factShown = {key, k, row: layerRow, parts: () => [el('p', {className: 'small', textContent: `${range}; magenta where ${holds}. Reading the view once the map has finished drawing…`}), ...late()]};
      showFact();
      host.factSample?.().then(read => {
        if (ticket !== sampling) return;
        factShown = {key, k, row: layerRow, parts: () => [el('p', {className: 'small', textContent: read ? `${range}; magenta where ${holds}: ${percent(read.holds / read.total)} of the map in view.` : `${range}. The view could not be read for a histogram.`}),
          ...(read ? [histogram(read.levels, fact, drawn)] : []), ...late()]};
        showFact();
      });
    };
    const off = event => {
      if (term.contains(event?.relatedTarget)) return;
      sampling++; if (factShown?.key === key && factShown.k === k) { factShown = null; showFact(); }
      if ($('surface-show').checked && layerRow != null) host.preview(layerRow);
    };
    term.addEventListener('pointerenter', on); term.addEventListener('focusin', event => { if (!term.contains(event.relatedTarget)) on(); });
    term.addEventListener('pointerleave', event => { if (!term.contains(document.activeElement)) off(event); }); term.addEventListener('focusout', off);
  }
  // A histogram of the fact over the map in view (the green levels' counts; green across SURFACE_FACT_GRAY spans the fact's range, as the fact
  // view draws it: factPosition) in 48 bars, the condition's limits shaded.
  function histogram(levels, fact, drawn) {
    const [lo, hi] = SURFACE_FACT_RANGE[fact];
    const W = 240, H = 40, BARS = 48, c = el('canvas', {width: W, height: H, className: 'surface-histogram', title: `How much of the map in view has each value, ${fmt(lo)} to ${fmt(hi)}`});
    const g = c.getContext('2d'), bars = new Array(BARS).fill(0);
    const [g0, g1] = SURFACE_FACT_GRAY.map(v => v * 255);
    levels.forEach((n, v) => { bars[Math.max(0, Math.min(BARS - 1, Math.floor((v - g0) / (g1 - g0) * BARS)))] += n; });
    const top = Math.max(...bars, 1), x = v => factPosition(fact, v) * W;
    if (drawn) { g.fillStyle = 'rgba(230, 60, 220, .28)'; const a = drawn.from != null ? x(drawn.from) : 0, b = drawn.to != null ? x(drawn.to) : W; g.fillRect(a, 0, Math.max(1, b - a), H); }
    g.fillStyle = '#d8d8d8';
    bars.forEach((n, k) => { const h = n ? Math.max(1, Math.sqrt(n / top) * (H - 2)) : 0; g.fillRect(k * W / BARS + .5, H - h, W / BARS - 1, h); });
    return el('div', {className: 'surface-histogram-row'}, el('span', {className: 'small', textContent: fmt(lo)}), c, el('span', {className: 'small', textContent: fmt(hi)}));
  }
  function ruleBlock(layer, i, layerRow) {
    const kind = ruleKind(layer), block = el('div', {className: 'surface-rule'});
    const select = el('select', {title: 'Where the layer may show', id: uid('rule')},
      el('option', {value: 'none', textContent: 'Everywhere', selected: kind === 'none'}),
      el('option', {value: 'where', textContent: 'Where all of these hold', selected: kind === 'where'}),
      el('option', {value: 'score', textContent: 'Where a score passes (a weighted sum)', selected: kind === 'score'}));
    select.onchange = () => edit(i, l => switchRule(l, select.value), true);
    block.append(el('label', {className: 'surface-number surface-rule-kind'}, el('span', {textContent: 'Shows'}), select));
    const drawn = spreadRule(layer), legend = el('div', {className: 'surface-fact-view', hidden: true});
    if (kind === 'where') layer.where.forEach((w, k) => { const term = windowRow(i, k, w, drawn.where[k]); factView(term, k, layer, layerRow); block.append(term); });
    if (kind === 'score') {
      layer.score.terms.forEach((t, k) => { const term = termRow(i, k, t); factView(term, k, layer, layerRow); block.append(term); });
      block.append(el('div', {className: 'surface-term'}, el('span', {className: 'small', textContent: 'The sum, with the edge noise, passes'}),
        number('at', layer.score.from ?? .5, v => edit(i, l => { l.score.from = v ?? .5; }, true), 'The sum it shows from', '.5', 'score-at'),
        number('fade', layer.score.fade ?? .05, v => edit(i, l => { l.score.fade = Math.max(v ?? .05, .0001); }, true), 'How gradually it starts', '', 'score-fade'),
        ...(drawn.score.from !== (layer.score.from ?? .5) ? [el('span', {className: 'small surface-spread-now', textContent: `With Spread: ${fmt(drawn.score.from)}`})] : [])));
    }
    // Spread: every limit of the rule moved together (sculpt-material-model.js spreadRule), so one slider widens or narrows where the layer may
    // show; the conditions keep their own numbers. Coverage beside it is how much of that area it covers, not how far it reaches.
    if (kind !== 'none') block.append(slider('Spread', layer.spread ?? 0, -1, 1, .01, (v, c) => edit(i, l => { if (v) l.spread = v; else delete l.spread; }, c),
      'Moves every limit of its rule together: right widens where it may show, left narrows it; the conditions keep their own numbers',
      v => (v > 0 ? '+' : '') + fmt(v)));
    const terms = kind === 'where' ? layer.where.length : kind === 'score' ? layer.score.terms.length : 0;
    if (kind !== 'none' && terms < SURFACE_RULE_TERMS) {
      const add = el('button', {type: 'button', textContent: kind === 'where' ? '+ Condition' : '+ Term', title: 'Read another fact of the site'});
      add.onclick = () => edit(i, l => { if (kind === 'where') l.where.push({fact: 'slope', from: .5, fade: .1}); else l.score.terms.push({fact: 'slope', weight: 1}); }, true);
      block.append(add);
    }
    block.append(legend);
    return block;
  }
  function materialSelect(layer, i) {
    const builtin = !isMaterialLayer(layer), options = host.library();
    const select = el('select', {className: 'surface-material', id: uid('material'), title: 'The library material this layer draws (the world’s copy, shared by every layer that draws it)'});
    if (builtin && layer.material == null) select.append(el('option', {value: '', textContent: 'None: it draws nothing', selected: true}));
    // A material layer with plants may draw no material: its plants grow on whatever lies below.
    if (!builtin && layer.plants) select.append(el('option', {value: '', textContent: 'None: plants only', selected: layer.material == null}));
    const groups = new Map();
    for (const m of options) { const g = m.key.split('-')[0]; if (!groups.has(g)) groups.set(g, el('optgroup', {label: g[0].toUpperCase() + g.slice(1)})); groups.get(g).append(el('option', {value: m.key, textContent: m.name, selected: m.key === layer.material})); }
    if (layer.material != null && !options.some(m => m.key === layer.material)) select.append(el('option', {value: layer.material, textContent: layer.material + ' (not in the library)', selected: true}));
    select.append(...groups.values());
    select.onchange = () => edit(i, l => { if (select.value) l.material = select.value; else delete l.material; }, true);   // a plants-only layer keeps its plants
    return el('label', {className: 'surface-number surface-material-row'}, el('span', {textContent: 'Material'}), select);
  }
  function row(layer, i, layers, layerRows, placedAll) {
    const placed = placedAll[i];
    // Its controls take ids from it (uid), so a rebuild of the list (an edit, a material measured, the world changed) gives the focus back.
    const key = layerKey(layer), builtin = !isMaterialLayer(layer), stage = stageOf(layer), fixed = builtin && SURFACE_FIXED.includes(layer.builtin);
    rowKey = key;
    // The layers it moves among: its stage's, in its section (moveLayer).
    const peers = layers.map((l, j) => j).filter(j => stageOf(layers[j]) === stage && placedAll[j].section === placed.section);
    const material = layer.material != null ? host.material(layer) : null, isOpen = open.has(key);
    const head = el('div', {className: 'surface-head'});
    const toggle = el('button', {type: 'button', id: uid('toggle'), className: 'surface-toggle', textContent: isOpen ? '▾' : '▸', title: isOpen ? 'Close this layer' : 'Open this layer’s settings', ariaExpanded: String(isOpen)});
    toggle.onclick = () => { if (open.has(key)) open.delete(key); else open.add(key); build(); list.querySelector(`[data-key="${CSS.escape(key)}"] .surface-toggle`)?.focus(); };
    const chip = el('span', {className: 'material-chip', title: material?.name ?? (layer.material != null ? 'The map lacks this layer’s material' : 'Its own color')});
    if (material) chip.style.background = material.color; else if (layer.material == null) chip.classList.add('own');
    head.append(toggle, chip);
    // The layer's name over what it draws: its material's name, or where a built-in's look comes from.
    const role = builtin && layer.material == null ? host.roleMaterial?.(layer.builtin) : null;
    const plants = layer.plants ? PLANT_LABELS[layer.plants.kind] ?? '' : '';
    const drawn = el('span', {className: 'surface-drawn', textContent: (material?.name ?? role?.name ?? (layer.material != null ? 'its material is missing from this map' : plants ? `${plants} only` : BUILTIN_SOURCES[layer.builtin] ?? 'no material: it draws nothing'))
      + (plants && layer.material != null ? `, with ${plants.toLowerCase()}` : '')});
    // Where it lies, in words from its own rule (whereWords), then what it draws.
    const line = el('span', {className: 'small surface-where'}, whereWords(layer) + ' · ', drawn);
    if (role) { chip.style.background = role.color; chip.classList.remove('own'); chip.title = role.name; }
    // Its place, where the stage says something an artist needs (snow lies over everything else).
    const place = CLOSED_PLACE[stage] ? [el('span', {className: 'small surface-place', textContent: CLOSED_PLACE[stage][0].toUpperCase() + CLOSED_PLACE[stage].slice(1)})] : [];
    if (!builtin) {
      const name = el('input', {type: 'text', value: nameOf(layer), maxLength: 80, className: 'surface-name', title: 'The layer’s name', id: uid('name')});
      name.onchange = () => edit(i, l => { l.name = name.value.trim() || 'Material layer'; }, true);
      head.append(el('div', {className: 'surface-label'}, name, line, ...place));
    } else {
      const name = el('span', {className: 'surface-name', textContent: nameOf(layer)});
      const label = el('div', {className: 'surface-label'}, name, line, ...place); label.onclick = () => toggle.click(); head.append(label);
    }
    const move = (d, text) => {
      const next = moveLayer(layers, i, d, peers), past = next && nameOf(layers[d > 0 ? Math.min(...peers.filter(k => k > i)) : Math.max(...peers.filter(k => k < i))]);
      const title = next ? `${d > 0 ? 'Raise: over' : 'Lower: under'} ${past}` : d > 0 ? 'Already the top of the layers it moves among' : 'Already the bottom of the layers it moves among';
      const b = el('button', {type: 'button', id: uid(d > 0 ? 'raise' : 'lower'), textContent: text, title, ariaLabel: title, disabled: !next}); b.onclick = () => put(structuredClone(next), true); return b;
    };
    const eye = el('button', {type: 'button', id: uid('eye'), className: 'surface-eye', textContent: hidden.has(key) ? 'Show' : 'Hide',
      title: hidden.has(key) ? 'Show this layer again' : 'Hide this layer while you design (not saved; an export draws it)', disabled: Boolean(solo)});
    eye.onclick = () => { if (hidden.has(key)) hidden.delete(key); else hidden.add(key); build(); sendView(); list.querySelector(`[data-key="${CSS.escape(key)}"] .surface-eye`)?.focus(); };
    const alone = el('button', {type: 'button', id: uid('solo'), className: 'surface-solo', textContent: 'Solo', ariaPressed: String(solo === key),
      title: solo === key ? 'Show every layer again' : 'Show this layer alone over the ground while you design (not saved; an export draws every layer)'});
    alone.onclick = () => { solo = solo === key ? null : key; build(); sendView(); list.querySelector(`[data-key="${CSS.escape(key)}"] .surface-solo`)?.focus(); };
    head.append(eye, alone);
    const item = el('li', {className: 'surface-layer' + (isOpen ? ' open' : '') + (shown(key) ? '' : ' unshown'), tabIndex: -1}, head);
    item.dataset.key = key;
    // Its Coverage, on the row whether open or closed (Highland ground and Base band take their strength from their World settings).
    if (!(builtin && BUILTIN_SETTINGS[layer.builtin])) item.append(el('div', {className: 'surface-cover'}, slider('Coverage', layer.amount ?? 1, 0, 1, .01, (v, c) => edit(i, l => { l.amount = v; }, c),
      'The share of its area it covers, each covered pixel at full strength; Noise size sets whether it is single pixels or patches', percent)));
    // Why it draws nothing now, each reason with a door to the control that turns it on (as Pick's doors and the shape card's Edit).
    if (placed.reasons.length) item.append(el('div', {className: 'small surface-why'}, ...placed.reasons.map(r => {
      const line = el('p', {textContent: r.text + ' '}), where = r.go && host.place?.(r.go);
      if (where) { const b = el('button', {type: 'button', className: 'link surface-go', textContent: where + ' ›', title: 'Show this setting'}); b.onclick = () => host.open(r.go); line.append(b); }
      return line;
    })));
    if (isOpen) {
      const edge = layer.edge ?? {}, body = el('div', {className: 'surface-body'});
      // A built-in that already draws a role material or its rock type's rock takes it from there (sculpt-material-model.js SURFACE_DRAWABLE).
      const own = builtin && !SURFACE_DRAWABLE.includes(layer.builtin);
      const materialRow = own ? el('p', {className: 'small surface-wide', textContent: `Drawn with ${role?.name ?? BUILTIN_SOURCES[layer.builtin]}: choose it in ${ROCK_TYPED.includes(layer.builtin) ? 'Rock types' : 'the Materials panel'}.`}) : el('div', {className: 'surface-wide surface-line'}, materialSelect(layer, i));
      if (material && !own) { const b = el('button', {type: 'button', id: uid('edit'), textContent: 'Edit…', title: 'Open its material in the material editor (the world’s: every map in this world shows your edit)'}); b.onclick = () => host.edit(layer, b); materialRow.append(b); }
      // Its place in the stack (within its stage) and, for a material layer, removing it: in the open row, so the head keeps room for the name.
      const order = el('div', {className: 'surface-wide surface-line surface-order'}, el('span', {className: 'small', textContent: STAGE_PLACE[stage] + '.'}), move(1, '↑ Raise'), move(-1, '↓ Lower'));
      if (!builtin) order.append(el('button', {type: 'button', textContent: 'Remove', title: 'Remove this layer (its material leaves the map unless a stroke uses it)', onclick: () => { const next = structuredClone(layers); next.splice(i, 1); put(next, true); }}));
      // Layers that draw one library material share the world's copy of it (one snow for every snow layer).
      const sharing = layer.material != null ? layers.filter((l, j) => j !== i && l.material === layer.material).map(nameOf) : [];
      body.append(materialRow, ...(sharing.length ? [el('p', {className: 'small surface-wide', textContent: `Shared with ${sharing.join(', ')}: one material, so its Color and edits change them all.`})] : []), order);
      // The material's own Color (sculpt-materials.js recolorMaterial): all its color steps move together; the steps stay editable in it.
      // A rock-typed built-in shows the world's rock material's (a rock type with a material of its own keeps that one's).
      const colored = material ?? (own ? role : null);
      if (colored?.own) {
        const pick = el('input', {type: 'color', value: colored.own, id: uid('color'), title: 'Moves all of the material’s color steps together (the world’s copy, on every map); each step stays editable in the material editor'});
        const rgb = () => [1, 3, 5].map(k => parseInt(pick.value.slice(k, k + 2), 16) / 255);
        pick.oninput = () => { picking = true; host.recolor(layer, rgb(), false); };
        pick.onchange = () => { picking = false; host.recolor(layer, rgb(), true); build(); };
        body.append(el('label', {className: 'surface-number surface-wide'}, el('span', {textContent: 'Color'}), pick));
      }
      if (builtin) { const placedBy = placedByBlock(layer); if (placedBy) body.append(placedBy); }
      if (fixed) body.append(el('p', {className: 'small surface-wide', textContent: 'Its settings place it: it also sets the ground’s relief and caps the beds, so it takes no rule or edge here.'}));
      else body.append(
        slider('Edge width', edge.width ?? 1, 0, 1, .01, (v, c) => edit(i, l => { l.edge = {...l.edge, width: v}; }, c), '1 blends into what is below; near 0 each pixel is one or the other'),
        slider('Edge noise', edge.noise ?? 0, 0, 1, .01, (v, c) => edit(i, l => { l.edge = {...l.edge, noise: v}; }, c), 'How ragged its edge is'),
        slider('Noise size (px)', edge.noiseSize ?? 8, 1, 64, 1, (v, c) => edit(i, l => { l.edge = {...l.edge, noiseSize: v}; }, c), '1 speckles by the pixel; larger makes patches'));
      if (layer.material != null) body.append(slider('Height contrast', edge.height ?? 0, 0, 1, .01, (v, c) => edit(i, l => { l.edge = {...l.edge, height: v}; }, c), 'At its edge the taller wins: its material’s art height against the ground material’s, so a blocky material keeps its high points and the ground takes its gaps'));
      if (!builtin && !layer.where?.length && !layer.score && (layer.amount ?? 1) >= 1) body.append(el('p', {className: 'small', textContent: 'At full Coverage everywhere it has no edge, so Height contrast does nothing: give it a rule or a Coverage under 1.'}));
      if (material && !material.height && (edge.height ?? 0) > 0) body.append(el('p', {className: 'small', textContent: 'This material has no art height, so Height contrast only lets a ground with height push it back: choose one with height (a rock material, for one) for blocks that stand out.'}));
      if (!builtin) body.append(plantsBlock(layer, i));
      if (!fixed) body.append(ruleBlock(layer, i, layerRows[i]));
      item.append(body);
    }
    // Chrome has no onfocusin/onfocusout properties: the focus events are listened for.
    // While one of its conditions shows its fact (factView), the row leaves the map to it: a rebuild that gives the focus back must not undo it.
    const preview = () => { if (factShown?.key !== key) host.preview($('surface-show').checked ? layerRows[i] : -1); };
    item.onpointerenter = preview; item.addEventListener('focusin', event => { if (!event.target.closest?.('.surface-term')) preview(); });   // a condition shows its fact (factView)
    item.onpointerleave = () => { if (!item.contains(document.activeElement)) host.preview(-1); };
    item.addEventListener('focusout', event => { if (!item.contains(event.relatedTarget)) host.preview(-1); });
    return item;
  }
  // A built-in's own placement (BUILTIN_PLACED_BY): each World setting with its value, and a door to it (its section and tab opened, the focus
  // on it). A rock type's setting shows the world's rock and says the rock types set their own. Null when the panel can read none of them.
  function placedByBlock(layer) {
    const items = (BUILTIN_PLACED_BY[layer.builtin] ?? []).map(key => [key, host.control?.(key)]).filter(([, c]) => c);
    if (!items.length) return null;
    const rows = items.map(([key, c]) => {
      const value = Number(c.own ?? c.value), where = host.place?.({control: key});
      const line = el('li', {className: 'surface-line'}, el('span', {textContent: `${c.name ?? c.label}: ${Number.isFinite(value) ? fmt(value) : '–'}${c.rock ? ' (the world’s rock)' : ''}`}));
      if (where) { const b = el('button', {type: 'button', className: 'link surface-go', id: uid(`placed-${key}`), textContent: where + ' ›', title: 'Show this setting'}); b.onclick = () => host.open({control: key}); line.append(b); }
      return line;
    });
    // Why a setting is unavailable, once for settings that share the reason (Highland ground's three wait on one material).
    const notes = [...new Set(items.map(([, c]) => c.note).filter(Boolean))];
    if (items.some(([, c]) => c.rock)) notes.push('Rock types set their own rock settings in Rock types; the values here are the world’s rock.');
    return el('div', {className: 'surface-wide surface-placed'}, el('p', {className: 'small', textContent: 'Where it lies is set by:'}), el('ul', {className: 'surface-placed-list'}, ...rows),
      ...notes.map(text => el('p', {className: 'small', textContent: text})));
  }
  // A material layer's plants (sculpt-material-model.js PLANT_KINDS): one kind, grown where the layer shows, as dense as its Plants amount.
  // The bake places them (engine-bake.wgsl plantMask) and knows only some facts: a rule that reads another grows them as if it were 0.
  function plantsBlock(layer, i) {
    const wrap = el('div', {className: 'surface-wide surface-plants'}), id = uid('plants');
    const select = el('select', {id, title: 'Plants this layer grows where it shows; their height is World › Vegetation relief'}, new Option('No plants', ''), ...PLANT_KINDS.map(k => new Option(PLANT_LABELS[k], k)));
    select.value = layer.plants?.kind ?? '';
    // Its plants removed from a layer that draws no material: it would draw nothing at all, so it takes the world's ground material.
    select.onchange = () => edit(i, l => { if (select.value) l.plants = {kind: select.value, amount: l.plants?.amount ?? .6}; else { delete l.plants; if (l.material == null) l.material = host.materialKey({material: 'role:ground'}); } }, true);
    wrap.append(el('label', {className: 'surface-line', htmlFor: id}, el('span', {textContent: 'Plants'}), select));
    if (layer.plants) {
      wrap.append(slider('Plant density', layer.plants.amount ?? .6, 0, 1, .01, (v, c) => edit(i, l => { l.plants = {...l.plants, amount: v}; }, c), 'How many of them grow where the layer shows'));
      const facts = [...(layer.where || []).map(w => w.fact), ...(layer.score?.terms || []).map(t => t.fact)].filter(f => !PLANT_FACTS.includes(f));
      if (facts.length) wrap.append(el('p', {className: 'small', textContent: `Plants are placed before ${[...new Set(facts)].join(', ')} ${facts.length > 1 ? 'are' : 'is'} known, so they grow as if ${facts.length > 1 ? 'those were' : 'it were'} 0.`}));
    }
    return wrap;
  }
  // Each layer's section and reasons, as the last build placed them (sync rebuilds only when the world has moved one).
  let placedText = '';
  const placeAll = layers => layers.map(l => layerSection(l, facts));
  // What a rebuild would change: each layer's section and reasons, and the values the open built-in rows list (placedByBlock), so a World setting
  // changed through a door shows its new value when the artist comes back.
  const shownState = layers => JSON.stringify([placeAll(layers), [...open].map(key => (BUILTIN_PLACED_BY[key] ?? []).map(k => { const c = host.control?.(k); return c ? c.own ?? c.value : null; }))]);
  // `reveal`: a layer whose section opens so its row shows (a new layer, a layer opened from the inspector). The focused control keeps the
  // focus across the rebuild (by its id, or a slider by its range's), and a section that receives it opens.
  let revealNext = null;   // a layer the next build reveals (one just added)
  function build({reveal = revealNext} = {}) {
    revealNext = null;
    const active = document.activeElement, scrub = active?.matches?.('.scrub') ? active.dataset.source : '';
    const focused = scrub?.startsWith('surface-') ? '' : active?.id?.startsWith('surface-') && list.contains(active) ? active.id : '';
    const layers = host.surface(), keys = new Set(layers.map(layerKey));
    for (const k of hidden) if (!keys.has(k)) hidden.delete(k);
    if (solo && !keys.has(solo)) solo = null;
    let layerRows = [];
    try { layerRows = surfaceRows(layers).layerRows; } catch (_) {}
    const placed = placeAll(layers);
    placedText = shownState(layers);
    // Shown top first (the topmost layer first), as the map stacks them: the last stage's last layer first.
    const order = layers.map((l, i) => i).sort((a, b) => stageOf(layers[b]) - stageOf(layers[a]) || b - a);
    for (const section of SECTIONS) {
      const rows = order.filter(i => placed[i].section === section).map(i => row(layers[i], i, layers, layerRows, placed));
      $(`surface-${section}-list`).replaceChildren(...rows);
      $(`surface-${section}-count`).textContent = String(rows.length);
      $(`surface-${section}`).hidden = !rows.length;
    }
    $('surface-world-name').textContent = host.worldName?.() ?? 'this world';
    const unshown = layers.filter(l => !shown(layerKey(l))).length;
    $('surface-view').hidden = !unshown;
    $('surface-view-text').textContent = solo ? `Showing “${nameOf(layers.find(l => layerKey(l) === solo))}” alone.` : `${unshown} hidden while you design.`;
    showFact();   // a condition's legend survives the rebuild
    const back = scrub ? list.querySelector(`.scrub[data-source="${CSS.escape(scrub)}"]`) : focused ? $(focused) : null;
    const shownRow = reveal != null ? list.querySelector(`[data-key="${CSS.escape(reveal)}"]`) : null;
    let moved = false;
    for (const e of [back, shownRow]) { const section = e?.closest('details.surface-section'); if (section && !section.open) { section.open = true; moved ||= e === back; } }
    back?.focus({preventScroll: true});
    if (moved) back.closest('.surface-layer')?.scrollIntoView({block: 'nearest'});   // its row left for a folded section: follow it
  }
  // After a World setting, a rock type in use or a role material changed: rebuild if a layer has changed section or reason.
  const sync = () => { if (!editing && !picking && shownState(host.surface()) !== placedText) build(); };
  $('surface-show-all').onclick = () => { hidden.clear(); solo = null; build(); sendView(); };
  // Add a layer: a small gallery of the presets (one tile each: its material's swatch, or a plant mark for a layer that grows plants only, and
  // its name), opened in place by its button; Escape folds it back (sculpt-ui.js closeTop presses the button). Choosing one adds the layer on
  // top of its stage, opens its row and brings it into view. The tiles are made once (Find reads them); their swatches follow the world's
  // materials each time it opens.
  const add = $('surface-add'), gallery = $('surface-gallery');
  const SPROUT = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M7 13V7M7 8C7 5 5 3.5 2 3.5 2 6.5 4 8 7 8ZM7 7C7 4.5 9 2.5 12 2.5 12 5 10 7 7 7Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';
  gallery.replaceChildren(...SURFACE_PRESETS.map(p => {
    const mark = el('span', {className: 'material-chip' + (p.material == null ? ' surface-plant' : '')}); if (p.material == null) mark.innerHTML = SPROUT;
    const tile = el('button', {type: 'button', className: 'surface-tile', title: `Add “${p.name}”: ${whereWords(p).replace(/^W/, 'w')}`}, mark, el('span', {textContent: p.name}));
    tile.dataset.preset = p.key; tile.onclick = () => addLayer(p); return tile;
  }));
  const swatches = () => { const library = new Map(host.library().map(m => [m.key, m.color])); for (const tile of gallery.children) { const p = SURFACE_PRESETS.find(q => q.key === tile.dataset.preset); if (p.material != null) tile.firstChild.style.background = library.get(host.materialKey(p)) ?? ''; } };
  const showGallery = on => {
    const back = !on && gallery.contains(document.activeElement);
    if (on) swatches();
    gallery.hidden = !on; add.setAttribute('aria-expanded', String(on));
    if (on) gallery.firstElementChild?.focus({preventScroll: true}); else if (back) add.focus({preventScroll: true});
  };
  add.onclick = () => showGallery(gallery.hidden);
  function addLayer(preset) {
    const layers = host.surface(), taken = new Set(layers.map(l => l.id)); let n = 1; while (taken.has(`${preset.key}-${n}`)) n++;
    const {key, ...rest} = preset, layer = {...structuredClone(rest), id: `${key}-${n}`, ...(preset.material == null ? {} : {material: host.materialKey(preset)})};
    if (layer.material == null) delete layer.material;
    showGallery(false);
    // A new layer goes on top of its stage, and opens.
    const stage = stageOf(layer), next = [...layers]; let at = 0; for (let j = next.length - 1; j >= 0; j--) if (stageOf(next[j]) <= stage) { at = j + 1; break; }
    next.splice(at, 0, layer); open.add(layer.id); revealNext = layer.id; put(next, true);
    const row = list.querySelector(`[data-key="${CSS.escape(layer.id)}"]`);
    row?.scrollIntoView({block: 'nearest', behavior: 'smooth'}); row?.querySelector('.surface-toggle')?.focus({preventScroll: true});
  }
  // The inspector (show, host.inspect): the layers that drew one pixel, top first, with what each covers and what of it shows, the effects
  // laid after them, and the facts rules read there. A pixel comes from Pick (Pick on the map starts it: host.pick; its card's Surface door
  // shows the pixel here); it reads again after each committed edit.
  const result = $('surface-inspect-result');
  let lastAt = null, reading = 0;
  $('surface-pick').onclick = () => host.pick();
  async function inspect() {
    if (!lastAt) return;
    const ticket = ++reading;
    result.hidden = false;
    if (!result.childElementCount) result.replaceChildren(el('p', {textContent: 'Reading the pixel…'}));
    const read = await host.inspect(lastAt).catch(error => ({error}));
    if (ticket === reading) showInspect(read);
  }
  function reinspect() { if (lastAt && !result.hidden) inspect(); }
  function openLayer(key) {
    open.add(key); build({reveal: key});
    const row = list.querySelector(`[data-key="${CSS.escape(key)}"]`); row?.scrollIntoView({block: 'nearest', behavior: 'smooth'}); row?.querySelector('.surface-toggle')?.focus({preventScroll: true});
  }
  function showInspect(read) {
    const again = el('button', {type: 'button', textContent: 'Read again'}), close = el('button', {type: 'button', textContent: 'Close'});
    again.onclick = inspect; close.onclick = () => { result.hidden = true; result.replaceChildren(); lastAt = null; };
    const tools = el('div', {className: 'surface-line'}, again, close);
    if (!read || read.error || read.unread) { result.replaceChildren(el('p', {textContent: read?.error ? 'The pixel could not be read: ' + read.error.message : read?.unread ? 'The pixel could not be read yet: the renderer may still be preparing its pipelines.' : 'That point is off the map.'}), tools); return; }
    const layers = host.surface();
    const hex = c => '#' + c.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');
    const final = hex(read.color), ground = host.slotMaterial(read.slot);
    const swatch = color => { const chip = el('span', {className: 'material-chip'}); chip.style.background = color; return chip; };
    const out = [el('p', {className: 'surface-line'}, swatch(final), el('span', {textContent: `Pixel ${Math.floor(lastAt.x)}, ${Math.floor(lastAt.y)}: ${final}`}))];
    out.push(el('p', {textContent: `Ground: ${ground?.name ?? 'the world’s ground'}${read.ownGround ? ' (the world’s ground)' : ' (a stroke’s material)'}` + (read.aboveSea < 0 ? `; under water, ${(-read.aboveSea).toFixed(1)} below the sea` : '')}));
    // What of each layer shows: its coverage, less what every layer drawn after it covers (layersAt).
    if (!read.layers.length) out.push(el('p', {textContent: 'No layer drew here: the ground shows.'}));
    else {
      out.push(el('p', {textContent: 'Layers that drew here, top first:'}));
      const items = layersAt(read, layers).map(({layer, key, name: label, cover, seen}) => {
        const material = layer.material != null ? host.material(layer) : !isMaterialLayer(layer) ? host.roleMaterial?.(layer.builtin) ?? null : null;
        const source = material?.name ?? (isMaterialLayer(layer) || layer.material != null ? 'its material (missing)' : BUILTIN_SOURCES[layer.builtin] ?? 'no material');
        const name = el('button', {type: 'button', className: 'link', textContent: label, title: 'Open this layer'}); name.onclick = () => openLayer(key);
        const chip = material ? swatch(material.color) : el('span', {className: 'material-chip own'});
        const fate = seen >= .995 ? 'shows' : seen < .005 ? 'covered by a later layer' : `${percent(seen)} shows`;
        return el('li', {className: 'surface-line'}, chip, name, el('span', {textContent: `${source} · covers ${percent(cover)} · ${fate}`}));
      });
      out.push(el('ol', {className: 'surface-inspect-layers'}, ...items));
    }
    const effects = [['wet band', read.wet], ['surf sand', read.surf]].filter(([, v]) => v > .005).map(([n, v]) => `${n} ${percent(Math.min(1, v))}`);
    out.push(el('p', {textContent: (effects.length ? 'Laid after the layers here: ' + effects.join(', ') + '. ' : '') + 'Light, weather, cracks, stones and the palette come after the layers too.'}));
    const factList = el('details', {}, el('summary', {textContent: 'Facts here (what rules read)'}),
      el('dl', {className: 'surface-facts'}, ...SURFACE_FACTS.flatMap((f, k) => [el('dt', {textContent: FACT_LABELS[f][0]}), el('dd', {textContent: read.facts[k].toFixed(2)})])));
    result.replaceChildren(...out, factList, tools);
  }
  $('surface-show').onchange = () => { if (!$('surface-show').checked) host.preview(-1); };
  $('surface-reset').onclick = () => { host.restore(); build(); sendView(); };
  build();
  // show(at, read): the inspector's detail for a pixel already read (the Pick card's Surface door); it reads again after each committed edit.
  // sync(): after a World setting or the map's rock types in use change, the sections follow.
  // showAll(): the design view back to every layer (the map's label for it, sculpt.js).
  const showAll = () => { if (!hidden.size && !solo) return; hidden.clear(); solo = null; build(); sendView(); };
  return {refresh, sync, showAll, open:openLayer, summary:()=>{
    const layers=host.surface(),placed=placeAll(layers);
    return layers.map((layer,i)=>({key:layerKey(layer),name:nameOf(layer),section:placed[i].section,reasons:placed[i].reasons.map(r=>r.text),hidden:!shown(layerKey(layer)),coverage:layer.amount==null&&BUILTIN_SETTINGS[layer.builtin]?'World setting':percent(layer.amount??1),stage:stageOf(layer),index:i})).sort((a,b)=>b.stage-a.stage||b.index-a.index);
  }, show: (at, read) => { reading++; lastAt = at; result.hidden = false; showInspect(read); }};
}
