// The material workspace: the graph above the live map and the material's own texture, with Controls, Node and Palette at the right.
// Focus graph covers the two previews while settings stay in view. Every element is in index.html; edits use the map's own undo and save.
import {NODES, NODE_TYPES, accepts, snippetNodes, DITHER, LIBRARY, MAX_NODES, MAX_STOPS, MAX_PALETTE, MAX_CONTROLS, MAX_FRAMES, MATERIAL_SLOTS, THUMB,
  nodeParams, nodeKinds, nodeTypes, makeNode, copyMaterial, blankMaterial, reseedMaterial, controlSpec, controlRange, materialRenderKey, materialTint, paletteRgb, materialColor, recolorMaterial,
  addMaterial, duplicateMaterial, renameMaterial, setMaterial, assignMaterial, materialUsers, materialText, parseMaterialText, MAP_ROLES, roleOf, roleName, materialStatesApply, gameArtColor} from './sculpt-materials.js';
import {mountMaterialGraph, CARD, cardHeight} from './sculpt-material-graph.js';
import {MaterialPreview, TILE, TERRAIN, SWATCH} from './sculpt-material-preview.js';
import gamePalette from './materials/palette.json' with {type: 'json'};

const $ = id => document.getElementById(id);
const hex = rgb => '#' + rgb.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const rgbOf = value => [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16));
const PARAM_ROWS = 14, INPUT_ROWS = 5, CELL = 20;
// A select's options ([label, value] pairs), made again only when they change: an input tick of a slider leaves them as they are.
const optionsShown = new WeakMap();
const DITHER_DEFAULTS = Object.fromEntries(DITHER.map(p => [p.key, p.value]));
const setOptions = (select, pairs) => { const key = JSON.stringify(pairs); if (optionsShown.get(select) === key) return; optionsShown.set(select, key); select.replaceChildren(...pairs.map(([label, value]) => new Option(label, value))); };
// The pause in input the graph's thumbnails wait for, and docked the preview picture too (the map beside it is the live preview).
const PAUSE = 90;

export function mountMaterialEditor(host) {
  const dialog = $('material-editor'), preview = new MaterialPreview();
  let slot = 0, selection = new Set(), primary = null, frameAt = -1, solo = null, view = 'tile', zoomed = false, stopAt = 0, editingControls = false;
  let pictureKey = '', thumbKey = '', picture = null, thumbs = new Map(), thumbPixels = new Map(), opener = null, menuAt = null, thumbTimer = null, pictureTimer = null, pictureMaterial = '', full = false;
  const materials = () => host.materials(), material = () => materials().find(m => m.slot === slot) ?? null;
  const node = () => material()?.nodes.find(n => n.id === primary) ?? null;
  const note = text => { $('material-note').textContent = text; $('material-note').hidden = !text; };
  // An edit that the model refuses (a loop, a wrong type) is shown as a note and leaves the material as it was.
  const attempt = fn => (...args) => { try { const r = fn(...args); note(''); return r; } catch (e) { note(e.message); refresh(); } };
  const update = list => { host.edit(list); refresh(); };
  const edit = fn => { const m = structuredClone(material()); if (!m) return; fn(m); update(setMaterial(materials(), slot, m)); };
  const commit = () => host.checkpoint();
  const change = fn => { edit(fn); commit(); };
  const editNode = fn => edit(m => fn(m.nodes.find(n => n.id === primary), m));

  // The graph canvas.
  const graph = mountMaterialGraph({
    material, selection: () => selection, frame: () => frameAt, solo: () => solo, thumbnails: () => thumbs,
    select: ids => { selection = new Set(ids); primary = ids.at(-1) ?? null; frameAt = -1; stopAt = 0; if (primary) pick('node'); refresh(); },
    selectFrame: index => { frameAt = index; selection = new Set(); primary = null; pick('node'); refresh(); },
    toggle: attempt(id => change(m => { const n = m.nodes.find(n => n.id === id); if (n.type !== 'output') n.enabled = !n.enabled; })),
    viewAlone: id => { solo = primary = id; if (!selection.has(id)) selection = new Set([id]); refresh(); },
    move: attempt(positions => change(m => { const places = graph.places(); for (const n of m.nodes) { const p = positions.get(n.id) ?? places.get(n.id); n.x = p.x; n.y = p.y; } })),
    connect: attempt((from, to, key, detached) => change(m => {
      if (detached && (detached.id !== to || detached.key !== key)) m.nodes.find(n => n.id === detached.id).in[detached.key] = null;
      m.nodes.find(n => n.id === to).in[key] = from;
    })),
    remove: () => removeSelected(), duplicate: () => duplicateSelected(),
    menu: (screen, place, wire = null) => openMenu(screen, place, wire), closeMenu: () => closeMenu(),
  });
  const removeSelected = attempt(() => {
    if (frameAt >= 0) { change(m => { m.frames.splice(frameAt, 1); }); frameAt = -1; refresh(); return; }
    const ids = [...selection].filter(id => material().nodes.find(n => n.id === id)?.type !== 'output'); if (!ids.length) return;
    change(m => { m.nodes = m.nodes.filter(n => !ids.includes(n.id)); });
    selection = new Set(); primary = null; if (ids.includes(solo)) solo = null; refresh();
  });
  const duplicateSelected = attempt(() => {
    const ids = [...selection].filter(id => material().nodes.find(n => n.id === id)?.type !== 'output'); if (!ids.length) return;
    if (material().nodes.length + ids.length > MAX_NODES) throw Error(`A material has at most ${MAX_NODES} nodes.`);
    const made = [];
    change(m => {
      const places = graph.places(), renamed = new Map();
      for (const id of ids) { const source = m.nodes.find(n => n.id === id), copy = structuredClone(source); copy.id = makeNode(source.type, m.nodes).id; copy.name = (source.name + ' copy').slice(0, 60); const p = places.get(id); copy.x = p.x + 30; copy.y = p.y + 30; m.nodes.push(copy); renamed.set(id, copy.id); made.push(copy.id); }
      for (const id of made) { const copy = m.nodes.find(n => n.id === id); for (const key of Object.keys(copy.in)) if (renamed.has(copy.in[key])) copy.in[key] = renamed.get(copy.in[key]); }   // copies stay wired to each other
    });
    selection = new Set(made); primary = made.at(-1); refresh();
  });

  // The add menu: at the pointer, searchable, and when a wire was dropped in the open it lists only nodes that take it.
  const menuItems = [...$('node-list').querySelectorAll('button')];
  function openMenu(screen, place, wire) {
    if (!material()) return;
    menuAt = {place, wire}; const menu = $('node-menu'), stage = menu.parentElement.getBoundingClientRect();
    for (const b of menuItems) b.dataset.fits = String(!wire || (!b.dataset.snippet && NODES[b.dataset.type].inputs.some(([, , want]) => accepts(want, wire.type))));   // a starting point takes no wire
    menu.hidden = false; $('node-search').value = ''; filterMenu();
    menu.style.left = Math.max(8, Math.min(stage.width - menu.offsetWidth - 8, screen.x - stage.left)) + 'px';
    menu.style.top = Math.max(8, Math.min(stage.height - menu.offsetHeight - 8, screen.y - stage.top)) + 'px';
    $('node-search').focus();
  }
  function closeMenu() { if ($('node-menu').hidden) return false; $('node-menu').hidden = true; menuAt = null; return true; }
  // A search matches the entry's name or its search words: the names other editors use (Perlin, Voronoi, HSL ...).
  function filterMenu() { const q = $('node-search').value.trim().toLowerCase(); for (const b of menuItems) b.hidden = b.dataset.fits === 'false' || (q && !(b.textContent + ' ' + (b.dataset.keywords ?? '')).toLowerCase().includes(q)); }
  $('node-search').oninput = filterMenu;
  $('node-search').onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); menuItems.find(b => !b.hidden)?.click(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); menuItems.find(b => !b.hidden)?.focus(); }
  };
  $('node-list').onkeydown = e => {
    const shown = menuItems.filter(b => !b.hidden), at = shown.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); shown[Math.min(shown.length - 1, at + 1)]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); if (at <= 0) $('node-search').focus(); else shown[at - 1].focus(); }
  };
  const addNode = attempt(button => {
    const {place, wire} = menuAt ?? {place: graph.center(), wire: null}; let made;
    change(m => {
      if (m.nodes.length >= MAX_NODES) throw Error(`A material has at most ${MAX_NODES} nodes.`);
      made = makeNode(button.dataset.type, m.nodes, {...(button.dataset.kind ? {kind: button.dataset.kind} : {}), x: Math.round(place.x - (wire ? 0 : CARD.width / 2)), y: Math.round(place.y - 30)});
      if (wire) { const inputs = NODES[made.type].inputs, key = (inputs.find(([, , want]) => want === wire.type || want === 'any' && wire.type !== 'coords') ?? inputs.find(([, , want]) => accepts(want, wire.type)))[0]; made.in[key] = wire.from; }
      const places = graph.places(); for (const n of m.nodes) if (n.x === undefined) { const p = places.get(n.id); n.x = p.x; n.y = p.y; }   // the rest keep their places
      m.nodes.push(made);
    });
    closeMenu(); selection = new Set([made.id]); primary = made.id; frameAt = -1; pick('node'); refresh(); $('material-graph').focus();
  });
  // A starting point: its nodes join the graph at the pointer, wired to each other, and are selected.
  const addSnippet = attempt(button => {
    const {place} = menuAt ?? {place: graph.center()}; let made;
    change(m => {
      const places = graph.places(); for (const n of m.nodes) if (n.x === undefined) { const p = places.get(n.id); n.x = p.x; n.y = p.y; }
      made = snippetNodes(button.dataset.snippet, m.nodes, {x: place.x - CARD.width / 2, y: place.y - 30}); m.nodes.push(...made);
    });
    closeMenu(); selection = new Set(made.map(n => n.id)); primary = made.at(-1).id; frameAt = -1; pick('node'); refresh(); $('material-graph').focus();
  });
  for (const b of menuItems) b.onclick = () => b.dataset.snippet ? addSnippet(b) : addNode(b);
  $('graph-add').onclick = e => { const r = e.currentTarget.getBoundingClientRect(); openMenu({x: r.left, y: r.bottom + 6}, graph.center(), null); };
  $('graph-fit').onclick = () => graph.fit();
  // The same selection without a pointer: every node by name.
  $('graph-node-select').onchange = () => { const id = $('graph-node-select').value; selection = new Set(id ? [id] : []); primary = id || null; frameAt = -1; stopAt = 0; if (id) pick('node'); refresh(); };
  $('graph-arrange').onclick = attempt(() => { change(m => { const places = graph.arrangement(); for (const n of m.nodes) Object.assign(n, places.get(n.id)); }); graph.fit(); });
  $('graph-frame').onclick = attempt(() => {
    const ids = [...selection]; if (!ids.length) throw Error('Select the nodes to frame first (Shift-click adds to the selection).');
    if (material().frames.length >= MAX_FRAMES) throw Error(`A material has at most ${MAX_FRAMES} frames.`);
    change(m => { for (const f of m.frames) f.nodes = f.nodes.filter(id => !ids.includes(id)); m.frames = m.frames.filter(f => f.nodes.length); m.frames.push({name: 'Group', nodes: ids}); });
    frameAt = material().frames.length - 1; selection = new Set(); primary = null; pick('node'); refresh(); $('frame-name').select();
  });

  // Tabs of the side column.
  const tabs = ['controls', 'node', 'palette'];
  function pick(name) { for (const t of tabs) { const on = t === name; $('material-tab-' + t).setAttribute('aria-selected', String(on)); $('material-tab-' + t).tabIndex = on ? 0 : -1; $('material-pane-' + t).hidden = !on; } }
  for (const t of tabs) { $('material-tab-' + t).onclick = () => { pick(t); refresh(); }; $('material-tab-' + t).onkeydown = e => { if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return; e.preventDefault(); const next = tabs[(tabs.indexOf(t) + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; pick(next); $('material-tab-' + next).focus(); refresh(); }; }

  const setScrub = (id, spec, value) => { const input = $(id); input.min = spec.min; input.max = spec.max; input.step = spec.step || (spec.max - spec.min > 20 ? .1 : .005); input.value = value; $(id + '-value').textContent = String(+Number(value).toFixed(3)); };
  const published = (m, id, param) => m.controls.findIndex(c => c.node === id && c.param === param);
  const togglePublish = attempt((id, param, label) => change(m => {
    const at = published(m, id, param);
    if (at >= 0) m.controls.splice(at, 1);
    else { if (m.controls.length >= MAX_CONTROLS) throw Error(`A material publishes at most ${MAX_CONTROLS} controls.`); const control = {label, node: id, param}, n = m.nodes.find(n => n.id === id); if (param !== 'stops') Object.assign(control, controlRange(nodeParams(n).find(p => p.key === param), n.params[param])); m.controls.push(control); }
  }));
  // Publishing asks for the control's name once, in place under the setting (or the colors), starting from the node's name and the setting:
  // Enter or Publish accepts and publishes it named, as one undo step; Escape, ◆ again or leaving the field cancels. Map makers meet this name
  // in World; Edit controls renames it later.
  let naming = null;   // {row, input, pin, id, param}
  function askName(row, input, pin, id, param, suggestion) {
    cancelName(); naming = {row, input, pin, id, param}; row.hidden = false; pin.setAttribute('aria-expanded', 'true'); input.value = suggestion; input.focus(); input.select();
  }
  function cancelName() { if (!naming) return false; naming.row.hidden = true; naming.pin.setAttribute('aria-expanded', 'false'); naming = null; return true; }
  function acceptName() { if (!naming) return; const {id, param, input, pin} = naming, label = input.value.trim().slice(0, 60); if (!label) { input.focus(); return; } cancelName(); togglePublish(id, param, label); pin.focus(); }
  function namePrompt(row, input, ok) {
    input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); acceptName(); } };
    ok.onpointerdown = e => e.preventDefault();   // the field keeps the focus, so leaving it means leaving the prompt
    ok.onclick = acceptName;
    row.addEventListener('focusout', e => { if (naming?.row === row && !row.contains(e.relatedTarget) && e.relatedTarget !== naming.pin) cancelName(); });   // ◆ again cancels by its click
  }
  const askOrUnpublish = (row, input, pin, n, param, suggestion) => {
    if (naming?.row === row) { cancelName(); return; }
    if (published(material(), n.id, param) >= 0) { cancelName(); togglePublish(n.id, param); } else askName(row, input, pin, n.id, param, suggestion.slice(0, 60));
  };

  // A material's published controls, in the fixed rows the page declares under `prefix`: the editor's Controls pane ("ctl") and the
  // World pane's ground ("wg") and water ("ww"). `of()` is the material the rows act on. Names and Remove exist only in the editor.
  // The color a material is drawn in (the renderer's GPU mean of it, sculpt-renderer.js drawnColor), which the Color rows show and move.
  const drawn = m => { const r = host.renderer?.(); return r?.drawnColor ? r.drawnColor(m) : materialColor(m); };
  function controlRows(prefix, of) {
    const id = (part, i) => `${prefix}-${part}-${i}`, optional = name => document.getElementById(name);
    const editOf = fn => { const m = structuredClone(of()); if (!m) return; fn(m); update(setMaterial(materials(), m.slot, m)); };
    // The material's own Color (recolorMaterial): every color step moves together while the picker moves; one undo step when it closes.
    const own = $(`${prefix}-matcolor`);
    own.oninput = attempt(() => { const m = of(); if (m) editOf(o => Object.assign(o, recolorMaterial(o, rgbOf(own.value).map(v => v / 255), drawn(o)))); });
    own.onchange = commit;
    for (let i = 0; i < MAX_CONTROLS; i++) {
      const scrub = $(`${prefix}-${i}`), target = () => { const m = of(), c = m?.controls[i]; return c && controlSpec(m, c) ? c : null; };
      scrub.oninput = attempt(() => { const c = target(); if (c) editOf(m => { m.nodes.find(n => n.id === c.node).params[c.param] = Number(scrub.value); }); });
      scrub.onchange = commit;
      for (let k = 0; k < MAX_STOPS; k++) {
        const color = $(`${prefix}-color-${i}-${k}`);
        color.oninput = attempt(() => { const c = target(); if (c) editOf(m => { const stop = m.nodes.find(n => n.id === c.node).stops[k], gain = Math.max(1, ...stop.slice(1)); rgbOf(color.value).forEach((v, j) => { stop[j + 1] = v / 255 * gain; }); }); });
        color.onchange = commit;
      }
      if (optional(id('name', i))) {
        $(id('name', i)).onchange = attempt(() => { editOf(m => { m.controls[i].label = $(id('name', i)).value; }); commit(); });
        $(id('remove', i)).onclick = attempt(() => { editOf(m => { m.controls.splice(i, 1); }); commit(); });
        // Its range: what a map maker can reach with it, inside what the node setting allows.
        for (const end of ['min', 'max']) $(id(end, i)).onchange = attempt(() => { const lo = $(id('min', i)).valueAsNumber, hi = $(id('max', i)).valueAsNumber; if (!(lo < hi)) throw Error('A control’s range runs from a lower value to a higher one.'); editOf(m => { m.controls[i].min = lo; m.controls[i].max = hi; }); commit(); });
      }
    }
    return (m, naming = false) => {
      $(`${prefix}-matcolor-row`).hidden = !m; if (m && document.activeElement !== own) own.value = hex(drawn(m).map(v => v * 255));
      for (let i = 0; i < MAX_CONTROLS; i++) {
        const c = m?.controls[i], target = c && controlSpec(m, c); $(id('row', i)).hidden = !target; if (!target) continue;
        const name = optional(id('name', i));
        if (name) {
          name.hidden = $(id('remove', i)).hidden = !naming; if (document.activeElement !== name) name.value = c.label;
          $(id('range', i)).hidden = !naming || !!target.stops;
          if (!target.stops) for (const end of ['min', 'max']) { const input = $(id(end, i)); input.min = nodeParams(target.node).find(p => p.key === c.param).min; input.max = nodeParams(target.node).find(p => p.key === c.param).max; if (document.activeElement !== input) input.value = target.spec[end]; }
        }
        $(id('scrub', i)).hidden = !!target.stops; $(id('colors', i)).hidden = !target.stops;
        if (target.stops) { $(id('colors-label', i)).textContent = c.label; for (let k = 0; k < MAX_STOPS; k++) { const stop = target.node.stops[k], input = $(`${prefix}-color-${i}-${k}`); input.hidden = !stop; if (stop) input.value = hex(stop.slice(1).map(v => v / Math.max(1, ...stop.slice(1)) * 255)); } }
        else { $(id('label', i)).textContent = c.label; setScrub(`${prefix}-${i}`, target.spec, target.node.params[c.param]); }
      }
    };
  }
  const showControls = controlRows('ctl', material);
  function refreshControls(m) {
    $('controls-empty').hidden = m.controls.length > 0; $('controls-edit').hidden = !m.controls.length; $('controls-edit').setAttribute('aria-pressed', String(editingControls));
    showControls(m, editingControls);
  }
  // The World pane: which material is the world's ground and which its water, a chip of its color, and the settings it publishes,
  // live on the map. The graph behind them opens with Edit material.
  const worldRows = [['wg', 'worldGround', 'ground-world-default', 'material-open'], ['ww', 'worldWater', 'water-material', 'water-material-edit']]
    .map(([prefix, role, select, open]) => ({prefix, role, select, open, show: controlRows(prefix, () => materials().find(m => m[role]) ?? null)}));
  function refreshWorld() {
    const list = materials();
    for (const {prefix, role, select, open, show} of worldRows) {
      const m = list.find(o => o[role]) ?? null;
      setOptions($(select), list.filter(o => !o[role === 'worldGround' ? 'worldWater' : 'worldGround']).map(o => [o.name, String(o.slot)])); $(select).value = String(m?.slot ?? ''); $(open).disabled = !list.length;
      $(prefix + '-chip').style.background = m ? hex(materialTint(m).map(v => v * 255)) : '';
      show(m); $(prefix + '-empty').hidden = !m || m.controls.some(c => controlSpec(m, c));
    }
  }
  $('controls-edit').onclick = () => { editingControls = !editingControls; refresh(); };

  // Node pane.
  function refreshNode(m) {
    const n = node(), f = frameAt >= 0 ? m.frames[frameAt] : null;
    $('node-none').hidden = !!(n || f); $('node-fields').hidden = !n; $('frame-fields').hidden = !f;
    if (naming && (naming.id !== n?.id || published(m, naming.id, naming.param) >= 0)) cancelName();   // another node, or already published
    if (f && document.activeElement !== $('frame-name')) $('frame-name').value = f.name;
    if (!n) return;
    const spec = NODES[n.type], kinds = nodeKinds(n), params = nodeParams(n), types = nodeTypes(m.nodes);
    if (document.activeElement !== $('node-name')) $('node-name').value = n.name;
    $('node-enabled').checked = n.enabled; $('node-enabled').parentElement.hidden = n.type === 'output';   // the Material node is always on
    $('node-help').textContent = spec.help + (n.enabled ? '' : ' This node is off: it passes its first input through, or gives nothing.');
    $('node-kind-row').hidden = !kinds; if (kinds) { $('node-kind-label').textContent = n.type === 'combine' ? 'Operation' : 'Type'; setOptions($('node-kind'), Object.entries(kinds).map(([k, label]) => [label, k])); $('node-kind').value = n.kind; }
    for (let i = 0; i < PARAM_ROWS; i++) {
      const p = params[i]; $('node-param-row-' + i).hidden = !p; if (!p) continue;
      $('node-param-label-' + i).textContent = p.label; setScrub('node-param-' + i, p, n.params[p.key]);
      const on = published(m, n.id, p.key) >= 0; $('node-param-pin-' + i).setAttribute('aria-pressed', String(on)); $('node-param-pin-' + i).title = on ? 'Published in Controls. Click to remove it.' : 'Publish this setting in the material’s Controls';
    }
    for (let i = 0; i < INPUT_ROWS; i++) {
      const input = spec.inputs[i]; $('node-input-row-' + i).hidden = !input; if (!input) continue;
      const [key, label, want] = input, fits = o => o.id !== n.id && o.type !== 'output' && accepts(want, types.get(o.id));
      $('node-input-label-' + i).textContent = label;
      setOptions($('node-input-' + i), [[want === 'coords' ? 'Plain coordinates' : 'Not connected', ''], ...m.nodes.filter(fits).map(o => [o.name, o.id])]);
      $('node-input-' + i).value = n.in[key] ?? ''; $('node-input-clear-' + i).disabled = !n.in[key];
      // Worn and Deposit draw only on a ground: say so where this material is water or another of the world's surfaces.
      const inert = n.type === 'output' && ['worn', 'deposit'].includes(key) && !materialStatesApply(m);
      $('node-input-' + i).disabled = inert; $('node-input-' + i).title = inert ? 'Only a ground draws its Worn and Deposit colors: this material is the world’s water or another of its surfaces.' : '';
    }
    // A Constant's color shows the gradient's color fields for its one stop: no bar, position or Remove.
    const single = n.type === 'constant' && !!n.stops;
    $('node-gradient').hidden = !n.stops; $('node-histogram').hidden = n.type !== 'levels';
    for (const el of [$('gradient-bar'), $('stop-position'), document.querySelector('label[for="stop-position"]'), $('stop-remove')]) el.hidden = single;
    if (single) stopAt = 0;
    if (n.stops) {
      stopAt = Math.min(stopAt, n.stops.length - 1); const stop = n.stops[stopAt], gain = Math.max(1, ...stop.slice(1));
      $('stop-color').value = hex(stop.slice(1).map(v => v / gain * 255)); if (document.activeElement !== $('stop-gain')) $('stop-gain').value = +gain.toFixed(3); if (document.activeElement !== $('stop-position')) $('stop-position').value = +stop[0].toFixed(3);
      $('stop-remove').disabled = n.stops.length <= 2; const on = published(m, n.id, 'stops') >= 0; $('gradient-pin').setAttribute('aria-pressed', String(on)); $('gradient-pin').textContent = single ? (on ? 'Color is published' : 'Publish this color') : on ? 'Colors are published' : 'Publish these colors';
      if (!single) drawGradient(n); drawPaletteGrid($('stop-palette'), 8, null);
    }
    if (n.type === 'levels') drawHistogram(n);
    $('material-node-delete').disabled = $('node-duplicate').disabled = n.type === 'output'; $('node-solo').disabled = n.type === 'output'; $('node-solo').setAttribute('aria-pressed', String(solo === n.id));
  }
  $('node-name').onchange = attempt(() => { change(m => { m.nodes.find(n => n.id === primary).name = $('node-name').value; }); });
  $('node-enabled').onchange = attempt(() => { change(m => { m.nodes.find(n => n.id === primary).enabled = $('node-enabled').checked; }); });
  $('node-kind').onchange = attempt(() => { change(m => { const n = m.nodes.find(n => n.id === primary); n.kind = $('node-kind').value; }); });
  for (let i = 0; i < PARAM_ROWS; i++) {
    $('node-param-' + i).oninput = attempt(() => editNode(n => { n.params[nodeParams(n)[i].key] = Number($('node-param-' + i).value); }));
    $('node-param-' + i).onchange = commit;
    namePrompt($('node-param-name-row-' + i), $('node-param-name-' + i), $('node-param-name-ok-' + i));
    $('node-param-pin-' + i).onclick = () => { const n = node(), p = nodeParams(n)[i]; askOrUnpublish($('node-param-name-row-' + i), $('node-param-name-' + i), $('node-param-pin-' + i), n, p.key, `${n.name}: ${p.label.replace(/ \(.*\)$/, '').toLowerCase()}`); };
  }
  for (let i = 0; i < INPUT_ROWS; i++) {
    const set = value => attempt(() => change(m => { const n = m.nodes.find(n => n.id === primary); n.in[NODES[n.type].inputs[i][0]] = value; }))();
    $('node-input-' + i).onchange = () => set($('node-input-' + i).value || null); $('node-input-clear-' + i).onclick = () => set(null);
  }
  $('material-node-delete').onclick = () => removeSelected(); $('node-duplicate').onclick = () => duplicateSelected();
  $('node-solo').onclick = () => { solo = solo === primary ? null : primary; refresh(); };
  $('frame-name').onchange = attempt(() => change(m => { m.frames[frameAt].name = $('frame-name').value; }));
  $('frame-remove').onclick = () => removeSelected();

  // The gradient bar: stops are handles to drag, a click on the bar adds one, and the palette grid below sets a stop to a game color.
  function drawGradient(n) {
    const canvas = $('gradient-bar'), ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height, bar = h - 14;
    ctx.clearRect(0, 0, w, h); const g = ctx.createLinearGradient(8, 0, w - 8, 0);
    for (const s of n.stops) g.addColorStop(s[0], hex(s.slice(1).map(v => Math.min(1, v) * 255)));
    ctx.fillStyle = g; ctx.fillRect(8, 0, w - 16, bar);
    n.stops.forEach((s, i) => { const x = 8 + s[0] * (w - 16); ctx.beginPath(); ctx.moveTo(x, bar - 2); ctx.lineTo(x - 6, h - 1); ctx.lineTo(x + 6, h - 1); ctx.closePath(); ctx.fillStyle = hex(s.slice(1).map(v => Math.min(1, v) * 255)); ctx.fill(); ctx.strokeStyle = i === stopAt ? '#ffffff' : '#0c1214'; ctx.lineWidth = i === stopAt ? 2 : 1; ctx.stroke(); });
  }
  { const bar = $('gradient-bar'); let drag = null;
    const at = e => { const r = bar.getBoundingClientRect(); return Math.max(0, Math.min(1, ((e.clientX - r.left) * bar.width / r.width - 8) / (bar.width - 16))); };
    bar.onpointerdown = attempt(e => {
      const n = node(), t = at(e), near = n.stops.map((s, i) => [Math.abs(s[0] - t), i]).sort((a, b) => a[0] - b[0])[0];
      if (near[0] < .035) stopAt = near[1];
      else { if (n.stops.length >= MAX_STOPS) throw Error(`A gradient has at most ${MAX_STOPS} stops.`); const after = n.stops.findIndex(s => s[0] > t), a = n.stops[Math.max(0, (after < 0 ? n.stops.length : after) - 1)], b = n.stops[after < 0 ? n.stops.length - 1 : after], f = b[0] > a[0] ? (t - a[0]) / (b[0] - a[0]) : 0;
        const stop = [t, ...[1, 2, 3].map(c => a[c] + (b[c] - a[c]) * f)]; edit(m => { const g = m.nodes.find(n => n.id === primary); g.stops.push(stop); g.stops.sort((x, y) => x[0] - y[0]); }); stopAt = node().stops.findIndex(s => s[0] === t); }
      drag = {id: e.pointerId, moved: false}; bar.setPointerCapture(e.pointerId); refresh();
    });
    bar.onpointermove = attempt(e => { if (drag?.id !== e.pointerId) return; const t = at(e), n = node(), lo = stopAt > 0 ? n.stops[stopAt - 1][0] + .005 : 0, hi = stopAt < n.stops.length - 1 ? n.stops[stopAt + 1][0] - .005 : 1; drag.moved = true; editNode(g => { g.stops[stopAt][0] = Math.max(lo, Math.min(hi, t)); }); });
    bar.onpointerup = bar.onpointercancel = e => { if (drag?.id !== e.pointerId) return; drag = null; commit(); };
  }
  const setStop = fn => attempt(() => editNode(g => fn(g.stops[stopAt], g)));
  $('stop-color').oninput = () => setStop(stop => { const gain = Math.max(1, ...stop.slice(1)); rgbOf($('stop-color').value).forEach((v, j) => { stop[j + 1] = v / 255 * gain; }); })(); $('stop-color').onchange = commit;
  // Brightness above 1 makes a stop a lightener for a Multiply: the color keeps its hue and every channel scales.
  $('stop-gain').onchange = () => { setStop(stop => { const old = Math.max(1, ...stop.slice(1)), gain = Math.max(1, Math.min(2, Number($('stop-gain').value) || 1)); for (let j = 1; j < 4; j++) stop[j] = Math.min(2, stop[j] * gain / old); })(); commit(); };
  $('stop-position').onchange = () => { setStop((stop, g) => { stop[0] = Math.max(0, Math.min(1, Number($('stop-position').value) || 0)); const ref = stop; g.stops.sort((a, b) => a[0] - b[0]); stopAt = g.stops.indexOf(ref); })(); commit(); };
  $('stop-remove').onclick = () => { setStop((stop, g) => { g.stops.splice(stopAt, 1); stopAt = Math.max(0, stopAt - 1); })(); commit(); };
  namePrompt($('gradient-name-row'), $('gradient-name'), $('gradient-name-ok'));
  $('gradient-pin').onclick = () => { const n = node(); askOrUnpublish($('gradient-name-row'), $('gradient-name'), $('gradient-pin'), n, 'stops', `${n.name}: ${n.type === 'constant' ? 'color' : 'colors'}`); };
  const cellAt = (canvas, e, size) => { const r = canvas.getBoundingClientRect(), columns = canvas.width / size, x = Math.floor((e.clientX - r.left) * canvas.width / r.width / size), y = Math.floor((e.clientY - r.top) * canvas.height / r.height / size); return y * columns + x; };
  $('stop-palette').onclick = e => { const index = cellAt($('stop-palette'), e, 8); if (index < 0 || index > 255) return; setStop(stop => { paletteRgb(index).forEach((v, j) => { stop[j + 1] = v / 255; }); })(); commit(); };

  // A Levels node's histogram: where its input's values lie, with the Low and High marks.
  function drawHistogram(n) {
    const canvas = $('node-histogram'), ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height, pixels = thumbPixels.get(n.in.in), bins = new Array(64).fill(0);
    ctx.fillStyle = '#10171a'; ctx.fillRect(0, 0, w, h);
    if (pixels) { for (let i = 0; i < pixels.length; i += 4) bins[Math.min(63, Math.round(.2126 * pixels[i] + .7152 * pixels[i + 1] + .0722 * pixels[i + 2]) >> 2)]++; const top = Math.max(1, ...bins); ctx.fillStyle = '#8fa3a8'; bins.forEach((v, i) => ctx.fillRect(i * w / 64, h - v / top * (h - 4), w / 64 - .5, v / top * (h - 4))); }
    ctx.fillStyle = '#e8d38a'; for (const key of ['low', 'high']) ctx.fillRect(Math.max(0, Math.min(w - 2, n.params[key] * w)), 0, 2, h);
  }

  // Palette pane: the game's 256 colors; a click puts one in or out of the material's set. A strike marks
  // the Windows system slots the game's map art never draws with; adding one is refused (it would be re-reduced).
  function drawPaletteGrid(canvas, size, chosen) {
    const ctx = canvas.getContext('2d'), columns = canvas.width / size;
    gamePalette.indexed.forEach((rgb, i) => { const x = (i % columns) * size, y = Math.floor(i / columns) * size; ctx.fillStyle = hex(rgb); ctx.fillRect(x, y, size, size); if (!gameArtColor(i)) { ctx.strokeStyle = '#000000b0'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + 1, y + size - 1); ctx.lineTo(x + size - 1, y + 1); ctx.stroke(); } if (chosen && !chosen.has(i)) { ctx.fillStyle = '#10171acc'; ctx.fillRect(x, y, size, size); ctx.fillStyle = hex(rgb); ctx.fillRect(x + size * .3, y + size * .3, size * .4, size * .4); } });
    if (chosen) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; for (const i of chosen) ctx.strokeRect((i % columns) * size + 1, Math.floor(i / columns) * size + 1, size - 2, size - 2); }
  }
  function refreshPalette(m) {
    drawPaletteGrid($('palette-grid'), CELL, new Set(m.palette));
    $('palette-count').textContent = m.palette.length < 2 ? 'No palette: the color stays continuous and the map’s output picks each pixel’s game color.' : `${m.palette.length} of ${MAX_PALETTE} colors. For the game palette the material is reduced to these by error diffusion; true color keeps its continuous color.`;
    $('palette-clear').disabled = !m.palette.length;
    DITHER.forEach(p => { setScrub('dither-' + p.key, p, m.dither[p.key]); $('dither-' + p.key).disabled = m.palette.length < 2 || (p.key !== 'amount' && m.dither.amount <= 0); });
  }
  $('palette-grid').onclick = attempt(e => { const index = cellAt($('palette-grid'), e, CELL); if (index < 0 || index > 255) return; change(m => { if (m.palette.includes(index)) m.palette = m.palette.filter(i => i !== index); else { if (!gameArtColor(index)) throw Error(`Slot ${index} is a Windows system color the game's map art does not draw with; the material's pixels would be re-reduced to another entry anyway.`); if (m.palette.length >= MAX_PALETTE) throw Error(`A material palette holds at most ${MAX_PALETTE} colors.`); m.palette.push(index); } }); });
  $('palette-clear').onclick = attempt(() => change(m => { m.palette = []; }));
  // The game colors nearest what the material's color output actually makes, the most used first.
  $('palette-auto').onclick = attempt(() => {
    const m = material(), out = m.nodes.find(n => n.type === 'output').in.color, pixels = thumbPixels.get(out);
    if (!pixels) throw Error('Connect a color to the Material node first.');
    const counts = new Map(), nearest = rgb => { let best = 0, d = Infinity; gamePalette.indexed.forEach((c, i) => { if (!gameArtColor(i)) return; const e = (c[0] - rgb[0]) ** 2 + (c[1] - rgb[1]) ** 2 + (c[2] - rgb[2]) ** 2; if (e < d) { d = e; best = i; } }); return best; };
    for (let i = 0; i < pixels.length; i += 16) for (const gain of [.88, 1, 1.12]) { const index = nearest([pixels[i] * gain, pixels[i + 1] * gain, pixels[i + 2] * gain]); counts.set(index, (counts.get(index) ?? 0) + 1); }
    change(o => { o.palette = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 24).map(([i]) => i); if (o.dither.amount <= 0) o.dither.amount = 1; });
  });
  for (const p of DITHER) { $('dither-' + p.key).oninput = attempt(() => edit(m => { m.dither[p.key] = Number($('dither-' + p.key).value); })); $('dither-' + p.key).onchange = commit; }

  // The preview: one picture, shown as the tile, a 3 by 3 repeat or on a small piece of terrain. The canvas takes its box's own pixel size
  // (a whole number of tiles, sculpt-workspace.css), and every view but Repeat draws the middle of the picture unscaled: one art pixel a
  // pixel, or two at 2x.
  function drawPicture() {
    const canvas = $('material-preview'), size = canvas.clientWidth || canvas.width; if (canvas.width !== size) canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, size, size); if (!picture) return;
    const source = picture.canvas, s = source.width;
    if (view === 'repeat' && picture.view === 'tile') { ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) ctx.drawImage(source, x * size / 3, y * size / 3, size / 3, size / 3); return; }
    const scale = zoomed ? 2 : 1, crop = Math.min(s, size / scale), shown = crop * scale, at = (size - shown) / 2;
    ctx.imageSmoothingEnabled = false; ctx.drawImage(source, (s - crop) / 2, (s - crop) / 2, crop, crop, at, at, shown, shown);
  }
  const previewBox = new ResizeObserver(() => { if (dialog.open) drawPicture(); }); previewBox.observe($('material-preview'));
  function refreshPictures() {
    const m = material(); if (!dialog.open || !m) return;
    const r = host.renderer(), list = materials(), water = m.worldWater === true, companion = list.find(o => water ? o.worldGround : o.worldWater) ?? m;
    // A rock material (the world's, or a rock type's) shows on terrain as the hill's rock, over the map's own ground.
    const rock = m.worldRock === true || (host.rocks?.() ?? []).some(o => o.material === slot), ground = rock ? list.find(o => o.worldGround) ?? null : null;
    const context = [r.variant.toString(), r.colorOverrides], want = view === 'terrain' ? 'terrain' : 'tile', showing = solo && m.nodes.some(n => n.id === solo) ? solo : null;
    const key = JSON.stringify([materialRenderKey(m), water, materialRenderKey(companion), ground && materialRenderKey(ground), context, want, showing]);
    // An edit's picture waits for a pause in input, leaving the GPU to the live map. A new view, node or material draws at once.
    // Focus graph hides the picture, so only thumbnails continue until the split is restored.
    if (!full && key !== pictureKey) {
      pictureKey = key; $('material-preview').setAttribute('aria-busy', 'true'); $('material-preview-note').textContent = 'Updating…';
      const ask = () => preview.picture(r, m, companion, {view: want, solo: showing, ground}, (error, result) => {
        if (error) { pictureKey = ''; $('material-preview-note').textContent = 'No preview: ' + error.message; $('material-preview').setAttribute('aria-busy', 'false'); return; }
        picture = result; drawPicture(); $('material-preview').setAttribute('aria-busy', String(result.draft));
        $('material-preview-note').textContent = result.draft ? 'Finishing the palette…' : showing ? 'The selected node alone, unlit.' : result.tiles ? `${result.tiles} different 32-px tiles in one repeat (256 at most).` : 'Under this world’s sun: sea, shore, a plain and a hill.';
      });
      const edited = picture && pictureMaterial !== '' && pictureMaterial !== materialRenderKey(m); pictureMaterial = materialRenderKey(m);
      clearTimeout(pictureTimer); if (edited && !full) pictureTimer = setTimeout(ask, PAUSE); else ask();
    }
    // Thumbnails wait for a pause: they are a second run of the graph, and a drag changes them on every move.
    const tk = JSON.stringify([materialRenderKey({...m, palette: [], dither: DITHER_DEFAULTS}), slot]);   // thumbnails read neither the palette nor its dither
    if (tk !== thumbKey) { thumbKey = tk; clearTimeout(thumbTimer); thumbTimer = setTimeout(() => preview.thumbnails(r, m, async (error, pictures) => {
      if (error || !pictures) return;
      const made = new Map(); for (const [id, pixels] of pictures) made.set(id, await createImageBitmap(new ImageData(new Uint8ClampedArray(pixels), THUMB, THUMB)));
      thumbs = made; thumbPixels = pictures; graph.redraw(); const n = node(); if (n?.type === 'levels' && !$('material-pane-node').hidden) drawHistogram(n);
    }), PAUSE); }
  }
  for (const v of ['tile', 'repeat', 'terrain']) $('mview-' + v).onclick = () => { view = v; refresh(); };
  $('mview-zoom').onclick = () => { zoomed = !zoomed; refresh(); };
  $('mview-solo').onclick = () => { solo = solo ? null : primary; refresh(); };

  // The library drawer, opened from the material's name in the header: "In this map" (the map's and the world's materials; choosing one
  // switches the editor to it) and "Library" (the shipped materials by world; choosing one adds a copy to the map). One search filters both
  // by name. Each tile's swatch is the preview's own (MaterialPreview.swatch), made only once the tile scrolls into view and kept by what it
  // draws, so opening the editor costs nothing and the drawer fills as it is looked at.
  // A copy a surface layer draws names that layer (World › Surface), as a world role names its role.
  const layerOf = o => o.worldLayer ? host.layerName?.(o.worldLayer) ?? o.worldLayer : null;
  const roleText = o => [layerOf(o) ? `surface layer ${layerOf(o)}` : roleOf(o) ? `world ${roleName(roleOf(o))}` : '',host.scope?.(o)].filter(Boolean).join(' · ');
  const drawer = $('material-library'), swatches = new Map(), waiting = new Map(), inView = new Set();
  let mapTilesKey = '', libraryBuilt = false, libraryFull = null;
  const swatchKey = m => { const r = host.renderer(); return JSON.stringify([materialRenderKey(m), m.worldWater === true, r ? [r.variant.toString(), r.colorOverrides] : null]); };
  const tileMaterial = t => t.dataset.slot ? materials().find(o => o.slot === Number(t.dataset.slot)) : LIBRARY[t.dataset.key];
  const seen = new IntersectionObserver(entries => { for (const e of entries) { if (e.isIntersecting) { inView.add(e.target); paintSwatch(e.target); } else inView.delete(e.target); } }, {root: $('library-scroll'), rootMargin: '96px 0px'});
  function paintSwatch(t) {
    const m = tileMaterial(t), canvas = t.querySelector('canvas'); if (!m || drawer.hidden) return;
    const key = swatchKey(m); if (canvas.dataset.key === key) return;
    canvas.dataset.want = key;
    const made = swatches.get(key); if (made) { canvas.getContext('2d').drawImage(made, 0, 0); canvas.dataset.key = key; return; }
    if (waiting.has(key)) { waiting.get(key).add(canvas); return; }
    waiting.set(key, new Set([canvas]));
    preview.swatch(host.renderer(), m, (error, picture) => {
      const canvases = waiting.get(key) ?? []; waiting.delete(key); if (error || !picture) return;
      swatches.set(key, picture); if (swatches.size > 320) { const [oldKey, oldPicture] = swatches.entries().next().value; swatches.delete(oldKey); oldPicture.close?.(); }
      for (const c of canvases) if (c.dataset.want === key) { c.getContext('2d').drawImage(picture, 0, 0); c.dataset.key = key; }
    });
  }
  function tile(data, name, role, onclick) {
    const b = document.createElement('button'), c = document.createElement('canvas'), n = document.createElement('span');
    b.type = 'button'; b.className = 'library-tile'; Object.assign(b.dataset, data, {name: name.toLowerCase()}); b.onclick = onclick;
    c.className = 'library-swatch'; c.width = c.height = SWATCH; c.setAttribute('aria-hidden', 'true');
    n.className = 'library-name'; n.textContent = name; b.append(c, n);
    if (role) { const r = document.createElement('span'); r.className = 'library-role'; r.textContent = role; b.append(r); }
    seen.observe(b); return b;
  }
  const chooseTile = next => { setDrawer(false); choose(next); $('material-choose').focus(); };
  // The map's tiles follow its list; they are made again only when a name, a role or the list changes.
  function buildMapTiles() {
    const list = materials(), key = JSON.stringify(list.map(o => [o.slot, o.name, roleText(o)]));
    if (key !== mapTilesKey) { mapTilesKey = key; for (const t of $('library-map').children) { seen.unobserve(t); inView.delete(t); } $('library-map').replaceChildren(...list.map(o => tile({slot: String(o.slot)}, o.name, roleText(o), () => chooseTile(o.slot)))); if (!drawer.hidden) filterDrawer(); }
    for (const t of $('library-map').children) { const on = Number(t.dataset.slot) === slot; t.classList.toggle('current', on); if (on) t.setAttribute('aria-current', 'true'); else t.removeAttribute('aria-current'); }
    if (!drawer.hidden) for (const t of inView) if (t.dataset.slot) paintSwatch(t);
  }
  // The library by world (the key's world, named as the world list names it; the current world first), then the materials every world shares.
  function buildLibrary() {
    const worlds = host.worlds?.() ?? {}, order = Object.keys(worlds), here = host.world?.(), groups = new Map();
    for (const [key, m] of Object.entries(LIBRARY)) { const world = key.includes('-') && worlds[key.split('-')[0]] ? key.split('-')[0] : ''; if (!groups.has(world)) groups.set(world, []); groups.get(world).push(tile({key}, m.name, '', () => addFromLibrary(key))); }
    const rank = world => world === here ? -1 : world === '' ? order.length : order.indexOf(world);
    $('library-shipped').replaceChildren(...[...groups].sort(([a], [b]) => rank(a) - rank(b)).map(([world, tiles]) => {
      const group = document.createElement('section'), head = document.createElement('h4'), list = document.createElement('div');
      group.className = 'library-group'; head.textContent = world ? worlds[world] : 'Every world'; list.className = 'library-tiles'; list.append(...tiles); group.append(head, list); return group;
    }));
    libraryBuilt = true; libraryFull = null;
  }
  function filterDrawer() {
    const q = $('library-search').value.trim().toLowerCase(); let any = false;
    for (const t of drawer.querySelectorAll('.library-tile')) { t.hidden = !!q && !t.dataset.name.includes(q); any ||= !t.hidden; }
    for (const g of drawer.querySelectorAll('.library-group')) g.hidden = !g.querySelector('.library-tile:not([hidden])');
    $('library-empty').hidden = any;
  }
  function setDrawer(on) {
    if (drawer.hidden !== on) return false;
    drawer.hidden = !on; $('material-choose').setAttribute('aria-expanded', String(on));
    if (on) { if (!libraryBuilt) buildLibrary(); refresh(); filterDrawer(); $('library-search').focus(); }
    else { preview.cancelSwatches(); waiting.clear(); }
    return true;
  }
  $('material-choose').onclick = () => setDrawer(drawer.hidden);
  $('library-search').oninput = filterDrawer;
  $('library-search').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); drawer.querySelector('.library-tile:not([hidden]):not(:disabled)')?.click(); } else if (e.key === 'ArrowDown') { e.preventDefault(); drawer.querySelector('.library-tile:not([hidden])')?.focus(); } };

  // The header: which material, where it is used, and the list's own actions.
  function refresh() {
    const list = materials(); if (!list.some(m => m.slot === slot)) { slot = (list.find(m => m.worldGround) ?? list[0])?.slot ?? 0; selection = new Set(); primary = null; frameAt = -1; solo = null; }
    const m = material(), full = list.length >= MATERIAL_SLOTS - 1;
    refreshWorld();
    if (!dialog.open) return;   // the rest is the editor's own face
    buildMapTiles();
    $('material-choose-name').textContent = m?.name ?? ''; $('material-choose-role').textContent = m && roleText(m) ? '· ' + roleText(m) : '';$('material-choose-role').title=m?host.scope?.(m)??'':'';
    if (libraryBuilt && libraryFull !== full) { libraryFull = full; for (const t of $('library-shipped').querySelectorAll('.library-tile')) { t.disabled = full; t.title = full ? `The map already has ${MATERIAL_SLOTS - 1} materials.` : 'Add a copy to the map'; } }
    if (!m) return;
    if (m.nodes.every(n => n.id !== primary)) { primary = null; selection = new Set([...selection].filter(id => m.nodes.some(n => n.id === id))); }
    if (frameAt >= m.frames.length) frameAt = -1;
    if (solo && !m.nodes.some(n => n.id === solo)) solo = null;
    // The Node preview follows the selection; selecting the output node, a frame or nothing keeps the last node shown.
    if (solo && primary && node()?.type !== 'output') solo = primary;
    const users = materialUsers(host.strokes(), list, slot, host.rocks?.() ?? []), strokes = users.strokes ? `${users.strokes} stroke${users.strokes > 1 ? 's' : ''}` : '';
    const rocks = users.rocks.length ? `rock type${users.rocks.length > 1 ? 's' : ''} ${users.rocks.join(', ')}` : '';
    $('material-used').textContent = 'Used by: ' + ([users.world && 'the world’s ' + users.world, layerOf(m) && `the surface layer “${layerOf(m)}” (World › Surface)`, rocks, strokes].filter(Boolean).join(', ') || 'nothing yet');
    if (document.activeElement !== $('material-name')) $('material-name').value = m.name;
    $('material-use-ground').disabled = m.worldGround || m.worldWater; $('material-use-water').disabled = m.worldWater || m.worldGround;
    // A disabled role button says why (rule 9).
    $('material-use-ground').title = m.worldGround ? 'This is already the world’s ground' : m.worldWater ? 'This is the world’s water: make another material the water first' : '';
    $('material-use-water').title = m.worldWater ? 'This is already the world’s water' : m.worldGround ? 'This is the world’s ground: make another material the ground first' : ''; $('material-role').value = MAP_ROLES.some(([r]) => m[r]) ? roleOf(m) : ''; $('material-role').disabled = m.worldGround || m.worldWater; $('material-role').dataset.title ??= $('material-role').title; $('material-role').title = $('material-role').disabled ? 'The world’s ground and water draw nothing else.' : $('material-role').dataset.title;
    $('material-delete').disabled = m.worldGround || m.worldWater; $('material-delete').title = $('material-delete').disabled ? 'The world’s ground and water cannot be deleted. Assign another material first.' : '';
    for (const id of ['material-duplicate', 'material-paste', 'material-new']) { $(id).disabled = full; $(id).title = full ? `The map already has ${MATERIAL_SLOTS - 1} materials.` : ''; }
    $('material-reset').disabled = !LIBRARY[m.source]; $('material-reset').title = LIBRARY[m.source] ? `Back to “${LIBRARY[m.source].name}” from the library. Undo brings your version back.` : 'This material did not come from the library.';
    for (const v of ['tile', 'repeat', 'terrain']) $('mview-' + v).setAttribute('aria-pressed', String(view === v));
    $('mview-zoom').setAttribute('aria-pressed', String(zoomed)); $('mview-zoom').disabled = view === 'repeat';
    $('mview-solo').setAttribute('aria-pressed', String(!!solo)); $('mview-solo').disabled = !solo && (!primary || node()?.type === 'output');
    $('graph-frame').disabled = !selection.size;
    setOptions($('graph-node-select'), [['Select a node…', ''], ...m.nodes.map(n => [n.name, n.id])]); $('graph-node-select').value = primary ?? '';
    if (!$('material-pane-controls').hidden) refreshControls(m);
    if (!$('material-pane-node').hidden) refreshNode(m);
    if (!$('material-pane-palette').hidden) refreshPalette(m);
    graph.refresh(slot); drawPicture(); refreshPictures();
  }
  // Choosing a material (the open one too) starts its pictures again: they were cleared, so their keys must be.
  const choose = next => { slot = next; selection = new Set(); primary = null; frameAt = -1; solo = null; picture = null; thumbs = new Map(); thumbPixels = new Map(); pictureKey = thumbKey = pictureMaterial = ''; pick('controls'); refresh(); };
  const addToMap = attempt((source, name) => { const added = addMaterial(materials(), source, name); update(added.materials); commit(); $('material-menu').open = false; choose(added.slot); });
  const addFromLibrary = key => { setDrawer(false); addToMap(LIBRARY[key], LIBRARY[key].name); $('material-choose').focus(); };
  $('material-new').onclick = () => addToMap(blankMaterial(), 'New material');
  $('material-duplicate').onclick = attempt(() => { const added = duplicateMaterial(materials(), slot); update(added.materials); commit(); $('material-menu').open = false; choose(added.slot); });
  $('material-rename').onclick = attempt(() => { update(renameMaterial(materials(), slot, $('material-name').value)); commit(); });
  $('material-name').onkeydown = e => { if (e.key === 'Enter') $('material-rename').click(); };
  $('material-delete').onclick = attempt(() => { host.delete(slot); $('material-menu').open = false; refresh(); });
  $('material-use-ground').onclick = attempt(() => { update(assignMaterial(materials(), slot, 'worldGround')); commit(); });
  $('material-use-water').onclick = attempt(() => { update(assignMaterial(materials(), slot, 'worldWater')); commit(); });
  // Another surface of the world this material draws; choosing none leaves that surface to fall back (engine-frag.wgsl roleColor).
  $('material-role').onchange = attempt(() => { const v = $('material-role').value, list = materials(); update(v ? assignMaterial(list, slot, v) : list.map(o => o.slot === slot ? Object.fromEntries(Object.entries(o).filter(([k]) => !MAP_ROLES.some(([r]) => r === k))) : o)); commit(); });
  $('material-copy').onclick = async () => { try { await navigator.clipboard.writeText(materialText(material())); host.status('Copied the material.'); note(''); } catch (e) { note(e.message); } };
  $('material-paste').onclick = async () => { try { const m = parseMaterialText(await navigator.clipboard.readText()); addToMap(m, m.name); } catch (e) { note(e.message); } };
  $('material-reseed').onclick = attempt(() => change(m => { m.seed = reseedMaterial(m).seed; }));
  $('material-reset').onclick = attempt(() => { const source = LIBRARY[material().source]; if (!source) return; update(setMaterial(materials(), slot, source)); commit(); selection = new Set(); primary = null; frameAt = -1; refresh(); graph.fit(); });
  for (const [id, role] of [['ground-world-default', 'worldGround'], ['water-material', 'worldWater']]) $(id).onchange = attempt(() => { update(assignMaterial(materials(), Number($(id).value), role)); commit(); });

  // The workspace is not modal: its lower-left map can be drawn on, panned, zoomed and picked. The side panel gives way to the
  // material settings (sculpt-ui.js dock) and comes back on close. Focus graph covers the map, which then waits (host.suspend).
  function setFull(on) {
    if (full === on) return; full = on; document.querySelector('.app').classList.toggle('material-full', on); host.suspend(on);
    $('material-full').setAttribute('aria-pressed', String(on)); $('material-full').textContent = on ? 'Show map & texture' : 'Focus graph';
    $('material-full').title = on ? 'Restore the live map and texture below the graph' : 'Give the graph the map and texture preview space';
    if (on) { clearTimeout(pictureTimer); pictureTimer = null; pictureKey = pictureMaterial = ''; preview.cancelPicture(); }
    else refreshPictures();
  }
  // Where the editor was opened from, when that is not the Materials tab: Back returns there (the door gets the focus, as on any close).
  const origin = from => from?.closest?.('#pick') ? 'Pick' : from?.closest?.('#pane-world') ? 'World' : from?.closest?.('#pane-tool') ? 'the shape' : '';
  function open(which, from) {
    opener = from; if (which !== undefined && which !== slot) choose(which); pick('controls');   // another material: not the last one's selection, frame or solo node
    const back = origin(from); $('material-back').hidden = !back; $('material-back').textContent = back ? `← Back to ${back}` : '';
    if (!dialog.open) { dialog.show(); host.dock({close, inner}); $('material-graph').focus({preventScroll: true}); }
    pictureKey = thumbKey = ''; refresh();
  }
  // The side panel comes back before the focus returns, so a button inside it can take the focus. A door its panel built again meanwhile
  // is found by its id (a Surface row's Edit, say); without one the focus goes to Materials. Closed because the side panel was asked for
  // (its Build or World tab), the focus stays where that click put it.
  function close(returnFocus = true) {
    if (!dialog.open) return;
    closeMenu(); setDrawer(false); dialog.close(); setFull(false); clearTimeout(pictureTimer); preview.cancel(); pictureKey = thumbKey = pictureMaterial = ''; host.dock(null);
    const door = opener?.isConnected ? opener : opener?.id ? document.getElementById(opener.id) : null;
    if (returnFocus) (door && !door.closest('[hidden]') ? door : $('materials-toolbar')).focus({preventScroll: true});
  }
  // A text field of the editor (a node's, frame's or control's name, a range, the material's name, the drawer's search) is left first:
  // Escape puts back what a name field held when it took the focus and moves the focus out, and the editor stays open.
  const TEXT = 'input:not([type]),input[type=text],input[type=search],input[type=number],textarea';
  let fieldWas = null;
  dialog.addEventListener('focusin', e => { if (e.target.matches?.(TEXT)) fieldWas = {field: e.target, value: e.target.value}; });
  // A value the field committed (Enter applies a name; change ends an edit) is what Escape returns to.
  const committed = e => { if (fieldWas?.field === e.target) fieldWas.value = e.target.value; };
  dialog.addEventListener('change', committed); dialog.addEventListener('keydown', e => { if (e.key === 'Enter') committed(e); });
  function leaveField() {
    const field = document.activeElement; if (!dialog.contains(field) || !field.matches(TEXT) || field.closest('.publish-name, #node-menu')) return false;
    if (field === $('library-search')) { $('material-choose').focus(); return true; }   // the filter stays; the next Escape closes the drawer
    if (fieldWas?.field === field) field.value = fieldWas.value;
    (field.closest('#material-menu')?.querySelector('summary') ?? $('material-graph')).focus();
    return true;
  }
  // Escape inside the editor (sculpt-ui.js closeTop), one thing a press: a control's name being asked, a text field, the add menu, Manage or
  // the library drawer, then Focus graph back to the split workspace. Then the editor itself (closeDocked), and then Pick's card.
  function inner() {
    if (naming) { const pin = naming.pin; cancelName(); pin.focus(); return true; }
    if (leaveField()) return true;
    if (closeMenu()) { $('material-graph').focus(); return true; }
    if ($('material-menu').open) { $('material-menu').open = false; $('material-menu').querySelector('summary').focus(); return true; }
    if (setDrawer(false)) { $('material-choose').focus(); return true; }
    if (full) { setFull(false); return true; }
    return false;
  }
  const roleSlot = key => materials().find(m => m[key])?.slot;
  // Materials, the third of the editor's views (Build, World, Materials): selecting it opens the editor; Build or World, or Escape, closes it.
  $('materials-toolbar').onclick = () => { if (!dialog.open) open(undefined, $('materials-toolbar')); };
  $('material-open').onclick = () => open(roleSlot('worldGround'), $('material-open'));
  $('water-material-edit').onclick = () => open(roleSlot('worldWater'), $('water-material-edit'));
  $('material-full').onclick = () => setFull(!full);
  $('material-back').onclick = () => close();
  dialog.oncancel = e => e.preventDefault();
  // A press anywhere else, on the map too, closes the add menu, Manage and the library drawer.
  const outside = e => {
    if (!dialog.open) return; if (!$('node-menu').contains(e.target) && e.target !== $('graph-add')) closeMenu(); if ($('material-menu').open && !$('material-menu').contains(e.target)) $('material-menu').open = false;
    if (!drawer.hidden && !drawer.contains(e.target) && !$('material-choose').contains(e.target)) setDrawer(false);
  };
  document.addEventListener('pointerdown', outside, true);
  // Keys typed in the editor stay in it, so the map's shortcuts (Delete, V, arrows ...) never act on a shape meanwhile. Escape goes on to the
  // editor's one Escape chain (sculpt-ui.js closeTop).
  dialog.onkeydown = e => {
    if (e.defaultPrevented || e.key === 'Escape') return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.target.matches('input:not([type=range]),textarea')) { e.preventDefault(); $(e.shiftKey ? 'redo' : 'undo').click(); }
    e.stopPropagation();
  };
  const lock = () => { $('materials-toolbar').disabled = $('editor').disabled; $('material-editor-fields').disabled = $('editor').disabled; };
  const locks = new MutationObserver(lock); for (const id of ['editor']) locks.observe($(id), {attributes: true, attributeFilter: ['disabled']}); lock();
  refresh();
  // The Color rows again, once the renderer has read back what the materials are drawn in (sculpt.js renderer.onmeans).
  const refreshColors = () => { for (const [prefix, m] of [['ctl', material()], ...worldRows.map(w => [w.prefix, materials().find(o => o[w.role]) ?? null])]) { const own = $(`${prefix}-matcolor`); if (m && document.activeElement !== own) own.value = hex(drawn(m).map(v => v * 255)); } };
  return {refresh, refreshColors, open, resetView: () => graph.fit(), refreshPreview: () => { pictureKey = ''; refreshPictures(); }, dispose() { if (dialog.open) { dialog.close(); setFull(false); host.dock(null); } document.removeEventListener('pointerdown', outside, true); clearTimeout(thumbTimer); clearTimeout(pictureTimer); locks.disconnect(); previewBox.disconnect(); graph.dispose(); preview.dispose(); }};
}
