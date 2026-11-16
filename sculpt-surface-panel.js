// World › Surface (docs/SURFACE_LAYERS.md, phase 3): the world's surface layers as a list, bottom to top. Each row sets a layer's Amount,
// its edge and its rule; a row moves within its stage, a material layer can be removed, and a layer is added from a preset. Hovering or
// focusing a row previews where that layer lies on the map. The list is a world setting: `host.apply(next, {commit})` stores it.
import {SURFACE_BUILTINS, SURFACE_STAGE_NAMES, SURFACE_FACTS, SURFACE_RULE_TERMS, surfaceRows} from './sculpt-material-model.js';

const $ = id => document.getElementById(id);
// Plain names for the facts a rule reads, with the range a window's sliders cover.
export const FACT_LABELS = {
  slope: ['Steepness', 0, 3, .05], aboveSea: ['Height above the sea', -20, 200, 1], abovePlain: ['Height above the plain', -60, 200, 1],
  wear: ['Worn by water', 0, 1, .01], deposit: ['Sediment laid down', 0, 1, .01], wetness: ['Wetness', 0, 1, .01], moisture: ['Moisture', 0, 1, .01],
  soilDepth: ['Soil depth', 0, 1, .01], light: ['Sunlight', 0, 1.6, .01], top: ['Lumps (1) and hollows (-1)', -1, 1, .02], convexity: ['Convexity', -1, 1, .02],
  rockShare: ['Rock', 0, 1, .01], debrisShare: ['Debris', 0, 1, .01], sandShare: ['Sand', 0, 1, .01],
};
const BUILTIN_LABELS = {
  highland: 'Highland ground', slopeCover: 'Slope cover', soil: 'Bare soil', rock: 'Rock', beach: 'Beach', crown: 'Crown rock', baseBand: 'Base band',
  regrownMoss: 'Moss on regrown debris', fines: 'Debris fines', paintedRock: 'Painted rock', paintedSnow: 'Painted snow', paintedMoss: 'Painted moss',
  sandDust: 'Sand dust', sand: 'Sand', chips: 'Chips', iceCrest: 'Snow on ice crests', iceCap: 'Snow on ice tops',
};
const STAGE_LABELS = ['on the ground', 'with the slope cover', 'with the rock', 'with the crown rock', 'with the beds', 'with the loose ground', 'with the chips', 'with the snow'];
// Presets a new layer starts from: a material (a library key, or a role of the world's own list) and a rule.
export const SURFACE_PRESETS = [
  {key: 'snow', name: 'Snow above a height', material: 'ice-ground', stage: 'snow', where: [{fact: 'abovePlain', from: 40, fade: 6}], edge: {width: .2, noise: .6, noiseSize: 1}},
  {key: 'moss', name: 'Moss in damp shade', material: 'lush-ground', stage: 'land', where: [{fact: 'moisture', from: .4, fade: .1}, {fact: 'light', to: .8, fade: .1}], amount: .6, edge: {width: .05, noise: 1, noiseSize: 22}},
  {key: 'scree', name: 'Scree on steep ground', material: 'role:debris', stage: 'land', where: [{fact: 'slope', from: .9, fade: .2}], amount: .7, edge: {width: .1, noise: .8, noiseSize: 6}},
  {key: 'dry', name: 'Dry ground on sunny slopes', material: 'desert-ground', stage: 'land', where: [{fact: 'light', from: 1.15, fade: .1}, {fact: 'moisture', to: .35, fade: .1}], amount: .3, edge: {width: .05, noise: 1, noiseSize: 22}},
  {key: 'mud', name: 'Mud in wet hollows', material: 'red-ground', stage: 'land', where: [{fact: 'wetness', from: .5, fade: .1}, {fact: 'top', to: -.1, fade: .1}], edge: {width: .2, noise: .6, noiseSize: 1}},
  {key: 'blank', name: 'Material layer', material: 'role:ground', stage: 'land', where: [{fact: 'slope', from: 0, fade: .05}], amount: .5},
];

const stageOf = layer => layer.material != null ? Math.max(0, SURFACE_STAGE_NAMES.indexOf(layer.stage ?? 'land')) : SURFACE_BUILTINS[layer.builtin]?.[0] ?? 0;
const nameOf = layer => layer.name || (layer.material != null ? 'Material layer' : BUILTIN_LABELS[layer.builtin] ?? layer.builtin);
const el = (tag, props = {}, ...children) => { const e = Object.assign(document.createElement(tag), props); for (const c of children) e.append(c); return e; };

// `host`: surface() the list now, apply(next, {commit}), restore() the world's own, preview(row or -1), material(layer) → {name, color} or
// null, edit(layer, button) to open its material, materialKey(preset) → a library key for a preset's material.
export function mountSurfacePanel(host) {
  const list = $('surface-layers');
  let editing = null;   // the list while a slider moves; committed on change
  const current = () => editing ?? host.surface();
  const put = (next, commit) => { editing = commit ? null : next; host.apply(next, {commit}); if (commit) build(); };
  const edit = (i, change, commit) => { const next = structuredClone(current()); change(next[i], next); put(next, commit); };
  const slider = (label, value, min, max, step, onInput, title = '') => {
    const id = 'surface-' + Math.random().toString(36).slice(2, 9), out = el('output', {htmlFor: id, value: String(value)});
    const input = el('input', {type: 'range', id, min, max, step, value, title});
    input.oninput = () => { out.value = input.value; onInput(Number(input.value), false); };
    input.onchange = () => onInput(Number(input.value), true);
    return el('label', {className: 'surface-slider', title}, el('span', {textContent: label}), input, out);
  };
  const number = (label, value, onSet) => {
    const input = el('input', {type: 'number', step: 'any', value: value ?? '', placeholder: 'open', title: label + ' (empty: no limit)'});
    input.onchange = () => onSet(input.value === '' ? undefined : Number(input.value));
    return el('label', {className: 'surface-number'}, el('span', {textContent: label}), input);
  };
  function windowRow(i, k, w) {
    const select = el('select', {title: 'What the condition reads'}, ...SURFACE_FACTS.map(f => el('option', {value: f, textContent: FACT_LABELS[f][0], selected: f === w.fact})));
    select.onchange = () => edit(i, l => { l.where[k].fact = select.value; }, true);
    const remove = el('button', {type: 'button', textContent: '×', title: 'Remove this condition'});
    remove.onclick = () => edit(i, l => { l.where.splice(k, 1); if (!l.where.length) delete l.where; }, true);
    return el('div', {className: 'surface-window row'}, select,
      number('from', w.from, v => edit(i, l => { if (v === undefined) delete l.where[k].from; else l.where[k].from = v; }, true)),
      number('to', w.to, v => edit(i, l => { if (v === undefined) delete l.where[k].to; else l.where[k].to = v; }, true)),
      number('fade', w.fade ?? .05, v => edit(i, l => { l.where[k].fade = Math.max(v ?? .05, .0001); }, true)), remove);
  }
  function row(layer, i, layers, layerRows) {
    const stage = stageOf(layer), siblings = layers.map((l, j) => [l, j]).filter(([l]) => stageOf(l) === stage).map(([, j]) => j), at = siblings.indexOf(i);
    const material = layer.material != null ? host.material(layer) : null;
    const head = el('div', {className: 'surface-head row'});
    if (layer.material != null) {
      const chip = el('span', {className: 'material-chip', title: material?.name ?? 'The map lacks this layer’s material'}); if (material) chip.style.background = material.color;
      const name = el('input', {type: 'text', value: nameOf(layer), maxLength: 80, className: 'surface-name', title: 'The layer’s name'});
      name.onchange = () => edit(i, l => { l.name = name.value.trim() || 'Material layer'; }, true);
      head.append(chip, name);
    } else head.append(el('strong', {className: 'surface-name', textContent: nameOf(layer)}));
    head.append(el('span', {className: 'small surface-stage', textContent: STAGE_LABELS[stage]}));
    const move = (d, text, title) => { const b = el('button', {type: 'button', textContent: text, title, disabled: at + d < 0 || at + d >= siblings.length}); b.onclick = () => { const next = structuredClone(layers), j = siblings[at + d]; [next[i], next[j]] = [next[j], next[i]]; put(next, true); }; return b; };
    head.append(move(-1, '↓', 'Lower: under the layer below it'), move(1, '↑', 'Higher: over the layer above it'));
    if (layer.material != null) {
      const open = el('button', {type: 'button', textContent: 'Edit material…', disabled: !material}); open.onclick = () => host.edit(layer, open);
      const remove = el('button', {type: 'button', textContent: '×', title: 'Remove this layer'}); remove.onclick = () => { const next = structuredClone(layers); next.splice(i, 1); put(next, true); };
      head.append(open, remove);
    }
    const edge = layer.edge ?? {};
    const body = el('div', {className: 'surface-body'},
      slider('Amount', layer.amount ?? 1, 0, 1, .01, (v, c) => edit(i, l => { l.amount = v; }, c), 'The share of pixels it takes where its rule allows it'),
      slider('Edge width', edge.width ?? 1, 0, 1, .01, (v, c) => edit(i, l => { l.edge = {...l.edge, width: v}; }, c), '1 blends into what is below; near 0 each pixel is one or the other'),
      slider('Edge noise', edge.noise ?? 0, 0, 1, .01, (v, c) => edit(i, l => { l.edge = {...l.edge, noise: v}; }, c), 'How ragged its edge is'),
      slider('Noise size (px)', edge.noiseSize ?? 8, 1, 64, 1, (v, c) => edit(i, l => { l.edge = {...l.edge, noiseSize: v}; }, c), '1 speckles by the pixel; larger makes patches'));
    if (layer.score) body.append(el('p', {className: 'small', textContent: 'Its rule is a score (a sum of facts past a threshold), set in the world file.'}));
    else {
      (layer.where ?? []).forEach((w, k) => body.append(windowRow(i, k, w)));
      if ((layer.where?.length ?? 0) < SURFACE_RULE_TERMS) {
        const add = el('button', {type: 'button', textContent: layer.where?.length ? '+ Condition' : '+ Where…', title: 'Limit where it shows by a fact of the site'});
        add.onclick = () => edit(i, l => { l.where = [...(l.where ?? []), {fact: 'slope', from: .5, fade: .1}]; }, true);
        body.append(add);
      }
    }
    const item = el('li', {className: 'surface-layer', tabIndex: -1}, head, body);
    item.onpointerenter = item.onfocusin = () => host.preview(layerRows[i]);
    item.onpointerleave = () => { if (!item.contains(document.activeElement)) host.preview(-1); };
    item.onfocusout = event => { if (!item.contains(event.relatedTarget)) host.preview(-1); };
    return item;
  }
  function build() {
    const layers = host.surface();
    let layerRows = [];
    try { layerRows = surfaceRows(layers).layerRows; } catch (_) {}
    // Shown top first (the topmost layer first), as the map stacks them.
    const items = layers.map((l, i) => row(l, i, layers, layerRows));
    list.replaceChildren(...items.reverse());
  }
  const add = $('surface-add');
  add.replaceChildren(el('option', {value: '', textContent: 'Add a layer…'}), ...SURFACE_PRESETS.map(p => el('option', {value: p.key, textContent: p.name})));
  add.onchange = () => {
    const preset = SURFACE_PRESETS.find(p => p.key === add.value); add.value = ''; if (!preset) return;
    const layers = host.surface(), taken = new Set(layers.map(l => l.id)); let n = 1; while (taken.has(`${preset.key}-${n}`)) n++;
    const {key, ...rest} = preset, layer = {...structuredClone(rest), id: `${key}-${n}`, material: host.materialKey(preset)};
    // A new layer goes on top of its stage.
    const stage = stageOf(layer), next = [...layers]; let at = next.length; for (let j = next.length - 1; j >= 0; j--) { if (stageOf(next[j]) <= stage) { at = j + 1; break; } if (j === 0) at = 0; }
    next.splice(at, 0, layer); put(next, true);
  };
  $('surface-reset').onclick = () => { host.restore(); build(); };
  build();
  return {refresh: build};
}
