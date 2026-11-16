// World › Surface (docs/SURFACE_LAYERS.md): the world's surface layers as a list, top first. Each row opens to set a layer's material, its
// Coverage (stored as amount), its edge and its rule (conditions that must all hold, or a score); a row moves within its stage, a material layer can be removed,
// and a layer is added from a preset. Hovering or focusing a row previews where that layer lies on the map. The list is a world setting:
// `host.apply(next, {commit})` stores it.
import {SURFACE_BUILTINS, SURFACE_STAGE_NAMES, SURFACE_FACTS, SURFACE_RULE_TERMS, SURFACE_DRAWABLE, SURFACE_FIXED, surfaceRows, isMaterialLayer, layerKey} from './sculpt-material-model.js';

const $ = id => document.getElementById(id);
// Plain names for the facts a rule reads, with the range a window's sliders cover.
export const FACT_LABELS = {
  slope: ['Steepness', 0, 3, .05], aboveSea: ['Height above the sea', -20, 200, 1], abovePlain: ['Height above the plain', -60, 200, 1],
  wear: ['Worn by water', 0, 1, .01], deposit: ['Sediment laid down', 0, 1, .01], wetness: ['Wetness', 0, 1, .01], moisture: ['Moisture', 0, 1, .01],
  soilDepth: ['Soil depth', 0, 1, .01], light: ['Sunlight', 0, 1.6, .01], top: ['Lumps (1) and hollows (-1)', -1, 1, .02], convexity: ['Convexity', -1, 1, .02],
  rockShare: ['Rock', 0, 1, .01], debrisShare: ['Debris', 0, 1, .01], sandShare: ['Sand', 0, 1, .01],
};
export const BUILTIN_LABELS = {
  highland: 'Highland ground', slopeCover: 'Slope cover', soil: 'Bare soil', rock: 'Rock', beach: 'Beach', crown: 'Crown rock', baseBand: 'Base band',
  regrownMoss: 'Moss on regrown debris', fines: 'Debris fines', paintedRock: 'Painted rock', paintedSnow: 'Painted snow', paintedMoss: 'Painted moss',
  sandDust: 'Sand dust', sand: 'Sand', chips: 'Chips', iceCrest: 'Snow on ice crests', iceCap: 'Snow on ice tops',
};
// Where a built-in's material comes from when the row has no material of its own to name: a role of the Materials panel or the rock types.
// The others (SURFACE_DRAWABLE) each draw a material the row chooses.
const BUILTIN_SOURCES = {
  highland: 'the world’s highland material', slopeCover: 'the world’s slope material', rock: 'each rock type’s rock', beach: 'the world’s beach material',
  crown: 'the rock type’s rock', fines: 'the debris material', paintedRock: 'the rock type’s rock', chips: 'the rock type’s chips',
};
// Built-ins whose strength and placement are World settings of their own (the rows under the list, in this section's "Built-in settings"):
// their row shows no Coverage, which would only repeat the strength.
const BUILTIN_SETTINGS = {highland: 'highland', baseBand: 'baseBand'};
// The stages as the list's group headings, top first in the list; a layer moves only within its group (the engine's effects lie between them).
const STAGE_TITLES = ['Ground', 'Slope cover', 'Soil, rock and beach', 'Crown rock', 'Bands', 'Loose ground: debris, paint, sand', 'Chips', 'Snow'];
const STAGE_HELP = ['Over the ground material, under the low-ground tint.', 'Under the cover classes.', 'Under the margin join.', 'Under the beds.',
  'Under the ground patches and the rock skin.', 'Under the boulders and cracks.', 'Under the weather, crystals and hill light.', 'Over everything but surf and water.'];
// Presets a new layer starts from: a material (a library key, or a role of the world's own list) and a rule.
export const SURFACE_PRESETS = [
  {key: 'snow', name: 'Snow above a height', material: 'ice-ground', stage: 'snow', where: [{fact: 'abovePlain', from: 40, fade: 6}], edge: {width: .2, noise: .6, noiseSize: 1}},
  {key: 'moss', name: 'Moss in damp shade', material: 'lush-ground', stage: 'land', where: [{fact: 'moisture', from: .4, fade: .1}, {fact: 'light', to: .8, fade: .1}], amount: .6, edge: {width: .05, noise: 1, noiseSize: 22}},
  {key: 'scree', name: 'Scree on steep ground', material: 'role:debris', stage: 'land', where: [{fact: 'slope', from: .9, fade: .2}], amount: .7, edge: {width: .1, noise: .8, noiseSize: 6}},
  {key: 'ledge', name: 'Rock on steep convex edges', material: 'role:rock', stage: 'land', score: {terms: [{fact: 'slope', weight: 1}, {fact: 'convexity', weight: 1.5}], from: 1.2, fade: .2}, edge: {width: .1, noise: .6, noiseSize: 4}},
  {key: 'dry', name: 'Dry ground on sunny slopes', material: 'desert-ground', stage: 'land', where: [{fact: 'light', from: 1.15, fade: .1}, {fact: 'moisture', to: .35, fade: .1}], amount: .3, edge: {width: .05, noise: 1, noiseSize: 22}},
  {key: 'mud', name: 'Mud in wet hollows', material: 'red-ground', stage: 'land', where: [{fact: 'wetness', from: .5, fade: .1}, {fact: 'top', to: -.1, fade: .1}], edge: {width: .2, noise: .6, noiseSize: 1}},
  // Flowers (the cover classes' flowers, as a layer): single pixels of the Flowers material, a clump of one species each, where the ground is wet.
  {key: 'flowers', name: 'Flowers in wet ground', material: 'flowers', stage: 'land', where: [{fact: 'wetness', from: .35, fade: .1}], amount: .1, edge: {width: .05, noise: 1, noiseSize: 1}},
  {key: 'blank', name: 'Material layer', material: 'role:ground', stage: 'land', where: [{fact: 'slope', from: 0, fade: .05}], amount: .5},
];

const stageOf = layer => isMaterialLayer(layer) ? Math.max(0, SURFACE_STAGE_NAMES.indexOf(layer.stage ?? 'land')) : SURFACE_BUILTINS[layer.builtin]?.[0] ?? 0;
const nameOf = layer => layer.name || (isMaterialLayer(layer) ? 'Material layer' : BUILTIN_LABELS[layer.builtin] ?? layer.builtin);
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
  if (kind === 'where') layer.where = (facts.length ? facts : ['slope']).map(fact => ({fact, from: .5, fade: .1}));
  if (kind === 'score') layer.score = {terms: (facts.length ? facts : ['slope']).map(fact => ({fact, weight: 1})), from: .5, fade: .1};
}

// `host`: surface() the list now, apply(next, {commit}), restore() the world's own, preview(row or -1), hide(keys) the layers not shown now, material(layer) → {name, color} or
// null (height: whether it has art height), edit(layer, button) to open its material, materialKey(preset) → a library key for a preset's material, library() → the materials a
// layer may draw [{key, name, color}], settings(key) to show a World setting's row and settingNote(key) why it is unavailable ('' if not),
// roleMaterial(builtin) and slotMaterial(slot) → {name, color} or null, pickPixel(onPick) → cancel, inspect(at) → what the draw laid there.
export function mountSurfacePanel(host) {
  const list = $('surface-layers');
  const open = new Set();   // the layers whose rows are open, by key
  // The design view, by key: layers hidden for now, or the one layer shown alone (solo). Never saved, undone or exported (host.hide).
  const hidden = new Set();
  let solo = null, sent = '';
  const shown = key => solo ? key === solo : !hidden.has(key);
  const sendView = (force = false) => {
    const keys = host.surface().map(layerKey).filter(k => !shown(k)), text = keys.join('\n');
    if (force ? text || sent : text !== sent) { sent = text; host.hide(keys); }
  };
  let editing = null;   // the list while a slider moves; committed on change
  const current = () => editing ?? host.surface();
  const put = (next, commit) => { editing = commit ? null : next; host.apply(next, {commit}); if (commit) { build(); reinspect(); } };
  let picking = false;   // a Color picker is open: a rebuild would close it
  const refresh = () => { if (!editing && !picking) { build(); sendView(true); } };   // after a material edit, an undo or a load; not while a slider moves
  const edit = (i, change, commit) => { const next = structuredClone(current()); change(next[i], next); put(next, commit); };
  const slider = (label, value, min, max, step, onInput, title = '') => {
    const id = uid(label), out = el('output', {htmlFor: id, value: String(value)});
    const input = el('input', {type: 'range', id, min, max, step, value, title});
    input.oninput = () => { out.value = input.value; onInput(Number(input.value), false); };
    input.onchange = () => onInput(Number(input.value), true);
    return el('label', {className: 'surface-slider', title}, el('span', {textContent: label}), input, out);
  };
  const number = (label, value, onSet, title = label + ' (empty: no limit)', placeholder = 'open', part = label) => {
    const input = el('input', {type: 'number', step: 'any', value: value ?? '', placeholder, title, id: uid(part)});
    input.onchange = () => onSet(input.value === '' ? undefined : Number(input.value));
    return el('label', {className: 'surface-number'}, el('span', {textContent: label}), input);
  };
  const remover = (title, onClick) => { const b = el('button', {type: 'button', textContent: '×', title, ariaLabel: title}); b.onclick = onClick; return b; };
  function windowRow(i, k, w) {
    const set = (field, v) => edit(i, l => { if (v === undefined) delete l.where[k][field]; else l.where[k][field] = v; }, true);
    return el('div', {className: 'surface-term'}, factSelect(w.fact, f => edit(i, l => { l.where[k].fact = f; }, true), `w${k}-fact`),
      number('from', w.from, v => set('from', v), undefined, undefined, `w${k}-from`), number('to', w.to, v => set('to', v), undefined, undefined, `w${k}-to`),
      number('fade', w.fade ?? .05, v => edit(i, l => { l.where[k].fade = Math.max(v ?? .05, .0001); }, true), 'How gradually it starts and stops', '', `w${k}-fade`),
      remover('Remove this condition', () => edit(i, l => { l.where.splice(k, 1); if (!l.where.length) delete l.where; }, true)));
  }
  function termRow(i, k, t) {
    return el('div', {className: 'surface-term'}, factSelect(t.fact, f => edit(i, l => { l.score.terms[k].fact = f; }, true), `t${k}-fact`),
      number('×', t.weight ?? 1, v => edit(i, l => { l.score.terms[k].weight = v ?? 1; }, true), 'Its weight in the sum (negative: it counts against)', '1', `t${k}-weight`),
      remover('Remove this term', () => edit(i, l => { l.score.terms.splice(k, 1); if (!l.score.terms.length) delete l.score; }, true)));
  }
  function ruleBlock(layer, i) {
    const kind = ruleKind(layer), block = el('div', {className: 'surface-rule'});
    const select = el('select', {title: 'Where the layer may show', id: uid('rule')},
      el('option', {value: 'none', textContent: 'Everywhere', selected: kind === 'none'}),
      el('option', {value: 'where', textContent: 'Where all of these hold', selected: kind === 'where'}),
      el('option', {value: 'score', textContent: 'Where a score passes (a weighted sum)', selected: kind === 'score'}));
    select.onchange = () => edit(i, l => switchRule(l, select.value), true);
    block.append(el('label', {className: 'surface-number surface-rule-kind'}, el('span', {textContent: 'Shows'}), select));
    if (kind === 'where') layer.where.forEach((w, k) => block.append(windowRow(i, k, w)));
    if (kind === 'score') {
      layer.score.terms.forEach((t, k) => block.append(termRow(i, k, t)));
      block.append(el('div', {className: 'surface-term'}, el('span', {className: 'small', textContent: 'The sum, with the edge noise, passes'}),
        number('at', layer.score.from ?? .5, v => edit(i, l => { l.score.from = v ?? .5; }, true), 'The sum it shows from', '.5', 'score-at'),
        number('fade', layer.score.fade ?? .05, v => edit(i, l => { l.score.fade = Math.max(v ?? .05, .0001); }, true), 'How gradually it starts', '', 'score-fade')));
    }
    const terms = kind === 'where' ? layer.where.length : kind === 'score' ? layer.score.terms.length : 0;
    if (kind !== 'none' && terms < SURFACE_RULE_TERMS) {
      const add = el('button', {type: 'button', textContent: kind === 'where' ? '+ Condition' : '+ Term', title: 'Read another fact of the site'});
      add.onclick = () => edit(i, l => { if (kind === 'where') l.where.push({fact: 'slope', from: .5, fade: .1}); else l.score.terms.push({fact: 'slope', weight: 1}); }, true);
      block.append(add);
    }
    return block;
  }
  function materialSelect(layer, i) {
    const builtin = !isMaterialLayer(layer), options = host.library();
    const select = el('select', {className: 'surface-material', id: uid('material'), title: 'The library material this layer draws (the world’s copy, shared by every layer that draws it)'});
    if (builtin && layer.material == null) select.append(el('option', {value: '', textContent: 'None: it draws nothing', selected: true}));
    const groups = new Map();
    for (const m of options) { const g = m.key.split('-')[0]; if (!groups.has(g)) groups.set(g, el('optgroup', {label: g[0].toUpperCase() + g.slice(1)})); groups.get(g).append(el('option', {value: m.key, textContent: m.name, selected: m.key === layer.material})); }
    if (layer.material != null && !options.some(m => m.key === layer.material)) select.append(el('option', {value: layer.material, textContent: layer.material + ' (not in the library)', selected: true}));
    select.append(...groups.values());
    select.onchange = () => edit(i, l => { if (select.value) l.material = select.value; else delete l.material; }, true);
    return el('label', {className: 'surface-number surface-material-row'}, el('span', {textContent: 'Material'}), select);
  }
  function row(layer, i, layers, layerRows) {
    const key = layerKey(layer), builtin = !isMaterialLayer(layer), stage = stageOf(layer), fixed = builtin && SURFACE_FIXED.includes(layer.builtin);
    rowKey = key;
    const siblings = layers.map((l, j) => [l, j]).filter(([l]) => stageOf(l) === stage).map(([, j]) => j), at = siblings.indexOf(i);
    const material = layer.material != null ? host.material(layer) : null, isOpen = open.has(key);
    const head = el('div', {className: 'surface-head'});
    const toggle = el('button', {type: 'button', className: 'surface-toggle', textContent: isOpen ? '▾' : '▸', title: isOpen ? 'Close this layer' : 'Open this layer’s settings', ariaExpanded: String(isOpen)});
    toggle.onclick = () => { if (open.has(key)) open.delete(key); else open.add(key); build(); list.querySelector(`[data-key="${CSS.escape(key)}"] .surface-toggle`)?.focus(); };
    const chip = el('span', {className: 'material-chip', title: material?.name ?? (layer.material != null ? 'The map lacks this layer’s material' : 'Its own color')});
    if (material) chip.style.background = material.color; else if (layer.material == null) chip.classList.add('own');
    head.append(toggle, chip);
    // The layer's name over what it draws: its material's name, or where a built-in's look comes from.
    const role = builtin && layer.material == null ? host.roleMaterial?.(layer.builtin) : null;
    const drawn = el('span', {className: 'small surface-drawn', textContent: material?.name ?? role?.name ?? (layer.material != null ? 'its material is missing from this map' : BUILTIN_SOURCES[layer.builtin] ?? 'no material: it draws nothing')});
    if (role) { chip.style.background = role.color; chip.classList.remove('own'); chip.title = role.name; }
    if (!builtin) {
      const name = el('input', {type: 'text', value: nameOf(layer), maxLength: 80, className: 'surface-name', title: 'The layer’s name', id: uid('name')});
      name.onchange = () => edit(i, l => { l.name = name.value.trim() || 'Material layer'; }, true);
      head.append(el('div', {className: 'surface-label'}, name, drawn));
    } else {
      const name = el('span', {className: 'surface-name', textContent: nameOf(layer)}); name.onclick = () => toggle.click();
      const label = el('div', {className: 'surface-label'}, name, drawn); label.onclick = () => toggle.click(); head.append(label);
    }
    const summary = [layer.amount != null && layer.amount !== 1 ? Math.round(layer.amount * 100) + '%' : '', ruleKind(layer) !== 'none' ? 'ruled' : ''].filter(Boolean).join(' · ');
    if (summary) head.append(el('span', {className: 'small surface-stage', textContent: summary}));
    const move = (d, text, title) => { const b = el('button', {type: 'button', textContent: text, title, ariaLabel: title, disabled: at + d < 0 || at + d >= siblings.length}); b.onclick = () => { const next = structuredClone(layers), j = siblings[at + d]; [next[i], next[j]] = [next[j], next[i]]; put(next, true); }; return b; };
    const eye = el('button', {type: 'button', className: 'surface-eye', textContent: shown(key) ? '●' : '○', ariaPressed: String(!hidden.has(key)),
      title: hidden.has(key) ? 'Show this layer again' : 'Hide this layer while you design (not saved; an export draws it)', disabled: Boolean(solo)});
    eye.onclick = () => { if (hidden.has(key)) hidden.delete(key); else hidden.add(key); build(); sendView(); list.querySelector(`[data-key="${CSS.escape(key)}"] .surface-eye`)?.focus(); };
    const alone = el('button', {type: 'button', className: 'surface-solo', textContent: 'S', ariaPressed: String(solo === key),
      title: solo === key ? 'Show every layer again' : 'Show this layer alone over the ground while you design (not saved; an export draws every layer)'});
    alone.onclick = () => { solo = solo === key ? null : key; build(); sendView(); list.querySelector(`[data-key="${CSS.escape(key)}"] .surface-solo`)?.focus(); };
    head.append(eye, alone);
    const item = el('li', {className: 'surface-layer' + (isOpen ? ' open' : '') + (shown(key) ? '' : ' unshown'), tabIndex: -1}, head);
    item.dataset.key = key;
    if (isOpen) {
      const edge = layer.edge ?? {}, body = el('div', {className: 'surface-body'});
      // A built-in that already draws a role material or its rock type's rock takes it from there (sculpt-material-model.js SURFACE_DRAWABLE).
      const own = builtin && !SURFACE_DRAWABLE.includes(layer.builtin);
      const materialRow = own ? el('p', {className: 'small surface-wide', textContent: `Drawn with ${role?.name ?? BUILTIN_SOURCES[layer.builtin]}: choose it in ${ROCK_TYPED.includes(layer.builtin) ? 'Rock types' : 'the Materials panel'}.`}) : el('div', {className: 'surface-wide surface-line'}, materialSelect(layer, i));
      if (material && !own) { const b = el('button', {type: 'button', textContent: 'Edit…', title: 'Open its material in the material editor (the world’s: every map in this world shows your edit)'}); b.onclick = () => host.edit(layer, b); materialRow.append(b); }
      // Its place in the stack (within its stage) and, for a material layer, removing it: in the open row, so the head keeps room for the name.
      const order = el('div', {className: 'surface-wide surface-line surface-order'}, el('span', {className: 'small', textContent: siblings.length > 1 ? 'Order in its group' : 'Alone in its group'}),
        move(1, '↑ Raise', 'Raise: over the layer above it'), move(-1, '↓ Lower', 'Lower: under the layer below it'));
      if (!builtin) order.append(el('button', {type: 'button', textContent: 'Remove', title: 'Remove this layer (its material leaves the map unless a stroke uses it)', onclick: () => { const next = structuredClone(layers); next.splice(i, 1); put(next, true); }}));
      // Layers that draw one library material share the world's copy of it (one snow for every snow layer).
      const sharing = layer.material != null ? layers.filter((l, j) => j !== i && l.material === layer.material).map(nameOf) : [];
      body.append(materialRow, ...(sharing.length ? [el('p', {className: 'small surface-wide', textContent: `Shared with ${sharing.join(', ')}: one material, so its Color and edits change them all.`})] : []), order);
      // The material's own Color (sculpt-materials.js recolorMaterial): all its color steps move together; the steps stay editable in it.
      const colored = material ?? (own ? role : null);
      if (colored?.own) {
        const pick = el('input', {type: 'color', value: colored.own, id: uid('color'), title: 'Moves all of the material’s color steps together (the world’s copy, on every map); each step stays editable in the material editor'});
        const rgb = () => [1, 3, 5].map(k => parseInt(pick.value.slice(k, k + 2), 16) / 255);
        pick.oninput = () => { picking = true; host.recolor(layer, rgb(), false); };
        pick.onchange = () => { picking = false; host.recolor(layer, rgb(), true); build(); };
        body.append(el('label', {className: 'surface-number surface-wide'}, el('span', {textContent: 'Color'}), pick));
      }
      if (builtin && BUILTIN_SETTINGS[layer.builtin]) {
        const b = el('button', {type: 'button', className: 'surface-wide link', textContent: 'Its strength and height: Built-in settings below'}); b.onclick = () => host.settings(BUILTIN_SETTINGS[layer.builtin]);
        body.append(b);
        const note = host.settingNote(BUILTIN_SETTINGS[layer.builtin]); if (note) body.append(el('p', {className: 'small surface-wide', textContent: note}));
      } else body.append(slider('Coverage', layer.amount ?? 1, 0, 1, .01, (v, c) => edit(i, l => { l.amount = v; }, c), 'The share of its area it covers, each covered pixel at full strength; Noise size sets whether it is single pixels or patches'));
      if (fixed) body.append(el('p', {className: 'small surface-wide', textContent: 'Its settings place it: it also sets the ground’s relief and caps the beds, so it takes no rule or edge here.'}));
      else body.append(
        slider('Edge width', edge.width ?? 1, 0, 1, .01, (v, c) => edit(i, l => { l.edge = {...l.edge, width: v}; }, c), '1 blends into what is below; near 0 each pixel is one or the other'),
        slider('Edge noise', edge.noise ?? 0, 0, 1, .01, (v, c) => edit(i, l => { l.edge = {...l.edge, noise: v}; }, c), 'How ragged its edge is'),
        slider('Noise size (px)', edge.noiseSize ?? 8, 1, 64, 1, (v, c) => edit(i, l => { l.edge = {...l.edge, noiseSize: v}; }, c), '1 speckles by the pixel; larger makes patches'));
      if (layer.material != null) body.append(slider('Height contrast', edge.height ?? 0, 0, 1, .01, (v, c) => edit(i, l => { l.edge = {...l.edge, height: v}; }, c), 'At its edge the taller wins: its material’s art height against the ground material’s, so a blocky material keeps its high points and the ground takes its gaps'));
      if (!builtin && !layer.where?.length && !layer.score && (layer.amount ?? 1) >= 1) body.append(el('p', {className: 'small', textContent: 'At full Coverage everywhere it has no edge, so Height contrast does nothing: give it a rule or a Coverage under 1.'}));
      if (material && !material.height && (edge.height ?? 0) > 0) body.append(el('p', {className: 'small', textContent: 'This material has no art height, so Height contrast only lets a ground with height push it back: choose one with height (a rock material, for one) for blocks that stand out.'}));
      if (!fixed) body.append(ruleBlock(layer, i));
      item.append(body);
    }
    item.onpointerenter = item.onfocusin = () => host.preview($('surface-show').checked ? layerRows[i] : -1);
    item.onpointerleave = () => { if (!item.contains(document.activeElement)) host.preview(-1); };
    item.onfocusout = event => { if (!item.contains(event.relatedTarget)) host.preview(-1); };
    return item;
  }
  function build() {
    const focused = document.activeElement?.id?.startsWith('surface-') ? document.activeElement.id : '';
    const layers = host.surface(), keys = new Set(layers.map(layerKey));
    for (const k of hidden) if (!keys.has(k)) hidden.delete(k);
    if (solo && !keys.has(solo)) solo = null;
    let layerRows = [];
    try { layerRows = surfaceRows(layers).layerRows; } catch (_) {}
    // Shown top first (the topmost layer first), as the map stacks them: the last stage's last layer first.
    const order = layers.map((l, i) => i).sort((a, b) => stageOf(layers[b]) - stageOf(layers[a]) || b - a), items = [];
    let last = -1;
    for (const i of order) {
      const stage = stageOf(layers[i]);
      if (stage !== last) items.push(el('li', {className: 'surface-group small', textContent: STAGE_TITLES[stage], title: STAGE_HELP[stage]}));
      last = stage; items.push(row(layers[i], i, layers, layerRows));
    }
    const unshown = layers.filter(l => !shown(layerKey(l))).length;
    if (unshown) {
      const all = el('button', {type: 'button', textContent: 'Show all', id: 'surface-show-all'});
      all.onclick = () => { hidden.clear(); solo = null; build(); sendView(); };
      items.unshift(el('li', {className: 'surface-view small'}, el('span', {textContent: solo ? `Showing “${nameOf(layers.find(l => layerKey(l) === solo))}” alone.` : `${unshown} hidden while you design.`}),
        el('span', {className: 'small', textContent: ' Saves and exports draw every layer.'}), all));
    }
    list.replaceChildren(...items);
    if (focused) $(focused)?.focus({preventScroll: true});
  }
  const add = $('surface-add');
  add.replaceChildren(el('option', {value: '', textContent: 'Add a layer…'}), ...SURFACE_PRESETS.map(p => el('option', {value: p.key, textContent: p.name})));
  add.onchange = () => {
    const preset = SURFACE_PRESETS.find(p => p.key === add.value); add.value = ''; if (!preset) return;
    const layers = host.surface(), taken = new Set(layers.map(l => l.id)); let n = 1; while (taken.has(`${preset.key}-${n}`)) n++;
    const {key, ...rest} = preset, layer = {...structuredClone(rest), id: `${key}-${n}`, material: host.materialKey(preset)};
    // A new layer goes on top of its stage, and opens.
    const stage = stageOf(layer), next = [...layers]; let at = 0; for (let j = next.length - 1; j >= 0; j--) if (stageOf(next[j]) <= stage) { at = j + 1; break; }
    next.splice(at, 0, layer); open.add(layer.id); put(next, true);
  };
  // The inspector (host.pickPixel, host.inspect): the layers that drew one pixel, top first, with what each covers and what of it shows,
  // the effects laid after them, and the facts rules read there. It reads again after each committed edit.
  const inspectButton = $('surface-inspect'), result = $('surface-inspect-result');
  let cancelPick = null, lastAt = null, reading = 0;
  const pressed = on => { inspectButton.ariaPressed = String(on); inspectButton.textContent = on ? 'Click the map… (Esc or here to stop)' : 'Inspect a pixel'; };
  inspectButton.onclick = () => {
    if (cancelPick) { cancelPick(); cancelPick = null; pressed(false); return; }
    pressed(true);
    cancelPick = host.pickPixel(at => { cancelPick = null; pressed(false); lastAt = at; inspect(); });
  };
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && cancelPick) { cancelPick(); cancelPick = null; pressed(false); } });
  async function inspect() {
    if (!lastAt) return;
    const ticket = ++reading;
    result.hidden = false;
    if (!result.childElementCount) result.replaceChildren(el('p', {textContent: 'Reading the pixel…'}));
    const read = await host.inspect(lastAt).catch(error => ({error}));
    if (ticket === reading) showInspect(read);
  }
  function reinspect() { if (lastAt && !result.hidden) inspect(); }
  const percent = v => Math.round(v * 100) + '%';
  function openLayer(key) {
    open.add(key); build();
    const row = list.querySelector(`[data-key="${CSS.escape(key)}"]`); row?.scrollIntoView({block: 'nearest', behavior: 'smooth'}); row?.querySelector('.surface-toggle')?.focus({preventScroll: true});
  }
  function showInspect(read) {
    const again = el('button', {type: 'button', textContent: 'Read again'}), close = el('button', {type: 'button', textContent: 'Close'});
    again.onclick = inspect; close.onclick = () => { result.hidden = true; result.replaceChildren(); lastAt = null; };
    const tools = el('div', {className: 'surface-line'}, again, close);
    if (!read || read.error) { result.replaceChildren(el('p', {textContent: read?.error ? 'The pixel could not be read: ' + read.error.message : 'That point is off the map.'}), tools); return; }
    const layers = host.surface(); let layerRows = [];
    try { layerRows = surfaceRows(layers).layerRows; } catch (_) {}
    const byRow = new Map(layerRows.map((row, i) => [row, i]));
    const hex = c => '#' + c.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');
    const final = hex(read.color), ground = host.slotMaterial(read.slot);
    const swatch = color => { const chip = el('span', {className: 'material-chip'}); chip.style.background = color; return chip; };
    const out = [el('p', {className: 'surface-line'}, swatch(final), el('span', {textContent: `Pixel ${Math.floor(lastAt.x)}, ${Math.floor(lastAt.y)}: ${final}`}))];
    out.push(el('p', {textContent: `Ground: ${ground?.name ?? 'the world’s ground'}${read.ownGround ? ' (the world’s ground)' : ' (a stroke’s material)'}` + (read.aboveSea < 0 ? `; under water, ${(-read.aboveSea).toFixed(1)} below the sea` : '')}));
    // What of each layer shows: its coverage, less what every layer drawn after it covers.
    const seen = new Array(read.layers.length); let over = 1;
    for (let k = read.layers.length - 1; k >= 0; k--) { seen[k] = read.layers[k].cover * over; over *= 1 - Math.max(0, Math.min(1, read.layers[k].cover)); }
    if (!read.layers.length) out.push(el('p', {textContent: 'No layer drew here: the ground shows.'}));
    else {
      out.push(el('p', {textContent: 'Layers that drew here, top first:'}));
      const items = [];
      read.layers.forEach((l, k) => {
        const i = byRow.get(l.row), layer = layers[i]; if (!layer) return;
        const material = layer.material != null ? host.material(layer) : !isMaterialLayer(layer) ? host.roleMaterial?.(layer.builtin) ?? null : null;
        const source = material?.name ?? (isMaterialLayer(layer) || layer.material != null ? 'its material (missing)' : BUILTIN_SOURCES[layer.builtin] ?? 'no material');
        const name = el('button', {type: 'button', className: 'link', textContent: nameOf(layer), title: 'Open this layer'}); name.onclick = () => openLayer(layerKey(layer));
        const chip = material ? swatch(material.color) : el('span', {className: 'material-chip own'});
        const fate = seen[k] >= .995 ? 'shows' : seen[k] < .005 ? 'covered by a later layer' : `${percent(seen[k])} shows`;
        items.unshift(el('li', {className: 'surface-line'}, chip, name, el('span', {textContent: `${source} · covers ${percent(Math.min(1, l.cover))} · ${fate}`})));
      });
      out.push(el('ol', {className: 'surface-inspect-layers'}, ...items));
    }
    const effects = [['low-ground tint', read.lowTint], ['wet band', read.wet], ['surf sand', read.surf]].filter(([, v]) => v > .005).map(([n, v]) => `${n} ${percent(Math.min(1, v))}`);
    out.push(el('p', {textContent: (effects.length ? 'Laid after the layers here: ' + effects.join(', ') + '. ' : '') + 'Light, weather, cracks, stones and the palette come after the layers too.'}));
    const facts = el('details', {}, el('summary', {textContent: 'Facts here (what rules read)'}),
      el('dl', {className: 'surface-facts'}, ...SURFACE_FACTS.flatMap((f, k) => [el('dt', {textContent: FACT_LABELS[f][0]}), el('dd', {textContent: read.facts[k].toFixed(2)})])));
    result.replaceChildren(...out, facts, tools);
  }
  $('surface-show').onchange = () => { if (!$('surface-show').checked) host.preview(-1); };
  $('surface-reset').onclick = () => { host.restore(); build(); sendView(); };
  build();
  return {refresh};
}
