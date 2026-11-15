// The material editor: one full-screen dialog for the map's ground and water materials. The graph fills the screen; beside it sit one
// preview and three panes: Controls (what the material publishes, for adjusting it), Node (the selected node) and Palette (the game
// colors it is reduced to). Every element is in index.html; this fills values and applies edits through the map's own undo and save.
import {NODES, NODE_TYPES, DITHER, LIBRARY, MAX_NODES, MAX_STOPS, MAX_PALETTE, MAX_CONTROLS, MAX_FRAMES, MATERIAL_SLOTS, THUMB,
  nodeParams, nodeKinds, nodeTypes, makeNode, copyMaterial, blankMaterial, reseedMaterial, controlSpec, materialRenderKey, materialTint, paletteRgb,
  addMaterial, duplicateMaterial, renameMaterial, setMaterial, assignMaterial, materialUsers, materialText, parseMaterialText} from './sculpt-materials.js';
import {mountMaterialGraph, graphPositions, CARD, cardHeight} from './sculpt-material-graph.js';
import {MaterialPreview, TILE, TERRAIN} from './sculpt-material-preview.js';
import gamePalette from './materials/palette.json' with {type: 'json'};

const $ = id => document.getElementById(id);
const hex = rgb => '#' + rgb.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const rgbOf = value => [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16));
const PARAM_ROWS = 10, INPUT_ROWS = 4, CELL = 20;

export function mountMaterialEditor(host) {
  const dialog = $('material-editor'), preview = new MaterialPreview();
  let slot = 0, selection = new Set(), primary = null, frameAt = -1, solo = null, view = 'tile', zoomed = false, stopAt = 0, editingControls = false;
  let pictureKey = '', thumbKey = '', picture = null, thumbs = new Map(), thumbPixels = new Map(), opener = null, menuAt = null, thumbTimer = null;
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
    toggle: attempt(id => change(m => { const n = m.nodes.find(n => n.id === id); n.enabled = !n.enabled; })),
    toggleSolo: id => { solo = solo === id ? null : id; refresh(); },
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
    for (const b of menuItems) { const spec = NODES[b.dataset.type]; b.dataset.fits = String(!wire || spec.inputs.some(([, , want]) => want === 'any' ? wire.type !== 'coords' : want === wire.type)); }
    menu.hidden = false; $('node-search').value = ''; filterMenu();
    menu.style.left = Math.max(8, Math.min(stage.width - menu.offsetWidth - 8, screen.x - stage.left)) + 'px';
    menu.style.top = Math.max(8, Math.min(stage.height - menu.offsetHeight - 8, screen.y - stage.top)) + 'px';
    $('node-search').focus();
  }
  function closeMenu() { if ($('node-menu').hidden) return false; $('node-menu').hidden = true; menuAt = null; return true; }
  function filterMenu() { const q = $('node-search').value.trim().toLowerCase(); for (const b of menuItems) b.hidden = b.dataset.fits === 'false' || (q && !b.textContent.toLowerCase().includes(q)); }
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
      if (wire) { const key = NODES[made.type].inputs.find(([, , want]) => want === 'any' ? wire.type !== 'coords' : want === wire.type)[0]; made.in[key] = wire.from; }
      const places = graph.places(); for (const n of m.nodes) if (n.x === undefined) { const p = places.get(n.id); n.x = p.x; n.y = p.y; }   // the rest keep their places
      m.nodes.push(made);
    });
    closeMenu(); selection = new Set([made.id]); primary = made.id; frameAt = -1; pick('node'); refresh(); $('material-graph').focus();
  });
  for (const b of menuItems) b.onclick = () => addNode(b);
  $('graph-add').onclick = e => { const r = e.currentTarget.getBoundingClientRect(); openMenu({x: r.left, y: r.bottom + 6}, graph.center(), null); };
  $('graph-fit').onclick = () => graph.fit();
  // The same selection without a pointer: every node by name.
  $('graph-node-select').onchange = () => { const id = $('graph-node-select').value; selection = new Set(id ? [id] : []); primary = id || null; frameAt = -1; stopAt = 0; if (id) pick('node'); refresh(); };
  $('graph-arrange').onclick = attempt(() => { change(m => { const places = graphPositions(m.nodes); for (const n of m.nodes) Object.assign(n, places.get(n.id)); }); graph.fit(); });
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
    else { if (m.controls.length >= MAX_CONTROLS) throw Error(`A material publishes at most ${MAX_CONTROLS} controls.`); m.controls.push({label, node: id, param}); }
  }));

  // A material's published controls, in the fixed rows the page declares under `prefix`: the editor's Controls pane ("ctl") and the
  // World pane's ground ("wg") and water ("ww"). `of()` is the material the rows act on. Names and Remove exist only in the editor.
  function controlRows(prefix, of) {
    const id = (part, i) => `${prefix}-${part}-${i}`, optional = name => document.getElementById(name);
    const editOf = fn => { const m = structuredClone(of()); if (!m) return; fn(m); update(setMaterial(materials(), m.slot, m)); };
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
      }
    }
    return (m, naming = false) => {
      for (let i = 0; i < MAX_CONTROLS; i++) {
        const c = m?.controls[i], target = c && controlSpec(m, c); $(id('row', i)).hidden = !target; if (!target) continue;
        const name = optional(id('name', i));
        if (name) { name.hidden = $(id('remove', i)).hidden = !naming; if (document.activeElement !== name) name.value = c.label; }
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
      $(select).replaceChildren(...list.filter(o => !o[role === 'worldGround' ? 'worldWater' : 'worldGround']).map(o => new Option(o.name, String(o.slot)))); $(select).value = String(m?.slot ?? ''); $(open).disabled = !list.length;
      $(prefix + '-chip').style.background = m ? hex(materialTint(m).map(v => v * 255)) : '';
      show(m); $(prefix + '-empty').hidden = !m || m.controls.some(c => controlSpec(m, c));
    }
  }
  $('controls-edit').onclick = () => { editingControls = !editingControls; refresh(); };

  // Node pane.
  function refreshNode(m) {
    const n = node(), f = frameAt >= 0 ? m.frames[frameAt] : null;
    $('node-none').hidden = !!(n || f); $('node-fields').hidden = !n; $('frame-fields').hidden = !f;
    if (f && document.activeElement !== $('frame-name')) $('frame-name').value = f.name;
    if (!n) return;
    const spec = NODES[n.type], kinds = nodeKinds(n), params = nodeParams(n), types = nodeTypes(m.nodes);
    if (document.activeElement !== $('node-name')) $('node-name').value = n.name;
    $('node-enabled').checked = n.enabled; $('node-help').textContent = spec.help + (n.enabled ? '' : ' This node is off: it passes its first input through, or gives nothing.');
    $('node-kind-row').hidden = !kinds; if (kinds) { $('node-kind-label').textContent = n.type === 'combine' ? 'Operation' : 'Type'; $('node-kind').replaceChildren(...Object.entries(kinds).map(([k, label]) => new Option(label, k))); $('node-kind').value = n.kind; }
    for (let i = 0; i < PARAM_ROWS; i++) {
      const p = params[i]; $('node-param-row-' + i).hidden = !p; if (!p) continue;
      $('node-param-label-' + i).textContent = p.label; setScrub('node-param-' + i, p, n.params[p.key]);
      const on = published(m, n.id, p.key) >= 0; $('node-param-pin-' + i).setAttribute('aria-pressed', String(on)); $('node-param-pin-' + i).title = on ? 'Published in Controls. Click to remove it.' : 'Publish this setting in the material’s Controls';
    }
    for (let i = 0; i < INPUT_ROWS; i++) {
      const input = spec.inputs[i]; $('node-input-row-' + i).hidden = !input; if (!input) continue;
      const [key, label, want] = input, fits = o => o.id !== n.id && o.type !== 'output' && (want === 'any' ? types.get(o.id) !== 'coords' : types.get(o.id) === want);
      $('node-input-label-' + i).textContent = label;
      $('node-input-' + i).replaceChildren(new Option(want === 'coords' ? 'Plain coordinates' : 'Not connected', ''), ...m.nodes.filter(fits).map(o => new Option(o.name, o.id)));
      $('node-input-' + i).value = n.in[key] ?? ''; $('node-input-clear-' + i).disabled = !n.in[key];
    }
    $('node-gradient').hidden = n.type !== 'gradient'; $('node-histogram').hidden = n.type !== 'levels';
    if (n.type === 'gradient') {
      stopAt = Math.min(stopAt, n.stops.length - 1); const stop = n.stops[stopAt], gain = Math.max(1, ...stop.slice(1));
      $('stop-color').value = hex(stop.slice(1).map(v => v / gain * 255)); if (document.activeElement !== $('stop-gain')) $('stop-gain').value = +gain.toFixed(3); if (document.activeElement !== $('stop-position')) $('stop-position').value = +stop[0].toFixed(3);
      $('stop-remove').disabled = n.stops.length <= 2; const on = published(m, n.id, 'stops') >= 0; $('gradient-pin').setAttribute('aria-pressed', String(on)); $('gradient-pin').textContent = on ? 'Colors are published' : 'Publish these colors';
      drawGradient(n); drawPaletteGrid($('stop-palette'), 8, null);
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
    $('node-param-pin-' + i).onclick = () => { const n = node(), p = nodeParams(n)[i]; togglePublish(n.id, p.key, `${n.name}: ${p.label.replace(/ \(.*\)$/, '').toLowerCase()}`.slice(0, 60)); };
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
  $('gradient-pin').onclick = () => { const n = node(); togglePublish(n.id, 'stops', `${n.name}: colors`.slice(0, 60)); };
  const cellAt = (canvas, e, size) => { const r = canvas.getBoundingClientRect(), columns = canvas.width / size, x = Math.floor((e.clientX - r.left) * canvas.width / r.width / size), y = Math.floor((e.clientY - r.top) * canvas.height / r.height / size); return y * columns + x; };
  $('stop-palette').onclick = e => { const index = cellAt($('stop-palette'), e, 8); if (index < 0 || index > 255) return; setStop(stop => { paletteRgb(index).forEach((v, j) => { stop[j + 1] = v / 255; }); })(); commit(); };

  // A Levels node's histogram: where its input's values lie, with the Low and High marks.
  function drawHistogram(n) {
    const canvas = $('node-histogram'), ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height, pixels = thumbPixels.get(n.in.in), bins = new Array(64).fill(0);
    ctx.fillStyle = '#10171a'; ctx.fillRect(0, 0, w, h);
    if (pixels) { for (let i = 0; i < pixels.length; i += 4) bins[Math.min(63, pixels[i] >> 2)]++; const top = Math.max(1, ...bins); ctx.fillStyle = '#8fa3a8'; bins.forEach((v, i) => ctx.fillRect(i * w / 64, h - v / top * (h - 4), w / 64 - .5, v / top * (h - 4))); }
    ctx.fillStyle = '#e8d38a'; for (const key of ['low', 'high']) ctx.fillRect(Math.max(0, Math.min(w - 2, n.params[key] * w)), 0, 2, h);
  }

  // Palette pane: the game's 256 colors; a click puts one in or out of the material's set.
  function drawPaletteGrid(canvas, size, chosen) {
    const ctx = canvas.getContext('2d'), columns = canvas.width / size;
    gamePalette.indexed.forEach((rgb, i) => { const x = (i % columns) * size, y = Math.floor(i / columns) * size; ctx.fillStyle = hex(rgb); ctx.fillRect(x, y, size, size); if (chosen && !chosen.has(i)) { ctx.fillStyle = '#10171acc'; ctx.fillRect(x, y, size, size); ctx.fillStyle = hex(rgb); ctx.fillRect(x + size * .3, y + size * .3, size * .4, size * .4); } });
    if (chosen) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; for (const i of chosen) ctx.strokeRect((i % columns) * size + 1, Math.floor(i / columns) * size + 1, size - 2, size - 2); }
  }
  function refreshPalette(m) {
    drawPaletteGrid($('palette-grid'), CELL, new Set(m.palette));
    $('palette-count').textContent = m.palette.length < 2 ? 'No palette: the color stays continuous and the map’s final palette step picks each pixel’s game color.' : `${m.palette.length} of ${MAX_PALETTE} colors. The material is reduced to these by error diffusion.`;
    $('palette-clear').disabled = !m.palette.length;
    DITHER.forEach(p => { setScrub('dither-' + p.key, p, m.dither[p.key]); $('dither-' + p.key).disabled = m.palette.length < 2 || (p.key !== 'amount' && m.dither.amount <= 0); });
  }
  $('palette-grid').onclick = attempt(e => { const index = cellAt($('palette-grid'), e, CELL); if (index < 0 || index > 255) return; change(m => { if (m.palette.includes(index)) m.palette = m.palette.filter(i => i !== index); else { if (m.palette.length >= MAX_PALETTE) throw Error(`A material palette holds at most ${MAX_PALETTE} colors.`); m.palette.push(index); } }); });
  $('palette-clear').onclick = attempt(() => change(m => { m.palette = []; }));
  // The game colors nearest what the material's color output actually makes, the most used first.
  $('palette-auto').onclick = attempt(() => {
    const m = material(), out = m.nodes.find(n => n.type === 'output').in.color, pixels = thumbPixels.get(out);
    if (!pixels) throw Error('Connect a color to the Material node first.');
    const counts = new Map(), nearest = rgb => { let best = 0, d = Infinity; gamePalette.indexed.forEach((c, i) => { const e = (c[0] - rgb[0]) ** 2 + (c[1] - rgb[1]) ** 2 + (c[2] - rgb[2]) ** 2; if (e < d) { d = e; best = i; } }); return best; };
    for (let i = 0; i < pixels.length; i += 16) for (const gain of [.88, 1, 1.12]) { const index = nearest([pixels[i] * gain, pixels[i + 1] * gain, pixels[i + 2] * gain]); counts.set(index, (counts.get(index) ?? 0) + 1); }
    change(o => { o.palette = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 24).map(([i]) => i); if (o.dither.amount <= 0) o.dither.amount = 1; });
  });
  for (const p of DITHER) { $('dither-' + p.key).oninput = attempt(() => edit(m => { m.dither[p.key] = Number($('dither-' + p.key).value); })); $('dither-' + p.key).onchange = commit; }

  // The preview: one picture, shown as the tile, a 3 by 3 repeat or on a small piece of terrain.
  function drawPicture() {
    const canvas = $('material-preview'), ctx = canvas.getContext('2d'), size = canvas.width; if (!picture) { ctx.clearRect(0, 0, size, size); return; }
    const source = picture.canvas, s = source.width;
    if (view === 'repeat' && picture.view === 'tile') { ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) ctx.drawImage(source, x * size / 3, y * size / 3, size / 3, size / 3); return; }
    const crop = zoomed ? size / 2 : Math.min(size, s); ctx.imageSmoothingEnabled = false; ctx.drawImage(source, (s - crop) / 2, (s - crop) / 2, crop, crop, 0, 0, size, size);
  }
  function refreshPictures() {
    const m = material(); if (!dialog.open || !m) return;
    const r = host.renderer(), list = materials(), water = m.worldWater === true, companion = list.find(o => water ? o.worldGround : o.worldWater) ?? m;
    const context = [r.variant.toString(), r.colorOverrides], want = view === 'terrain' ? 'terrain' : 'tile', showing = solo && m.nodes.some(n => n.id === solo) ? solo : null;
    const key = JSON.stringify([materialRenderKey(m), water, materialRenderKey(companion), context, want, showing]);
    if (key !== pictureKey) {
      pictureKey = key; $('material-preview').setAttribute('aria-busy', 'true'); $('material-preview-note').textContent = 'Updating…';
      preview.picture(r, m, companion, {view: want, solo: showing}, (error, result) => {
        if (error) { pictureKey = ''; $('material-preview-note').textContent = 'No preview: ' + error.message; $('material-preview').setAttribute('aria-busy', 'false'); return; }
        picture = result; drawPicture(); $('material-preview').setAttribute('aria-busy', String(result.draft));
        $('material-preview-note').textContent = result.draft ? 'Finishing the palette…' : showing ? 'The selected node alone, unlit.' : result.tiles ? `${result.tiles} different 32-px tiles in one repeat (256 at most).` : 'Under this world’s sun: sea, shore, a plain and a hill.';
      });
    }
    // Thumbnails wait for a pause: they are a second run of the graph, and a drag changes them on every move.
    const tk = JSON.stringify([materialRenderKey({...m, palette: [], dither: m.dither}), slot]);
    if (tk !== thumbKey) { thumbKey = tk; clearTimeout(thumbTimer); thumbTimer = setTimeout(() => preview.thumbnails(r, m, async (error, pictures) => {
      if (error || !pictures) return;
      const made = new Map(); for (const [id, pixels] of pictures) made.set(id, await createImageBitmap(new ImageData(new Uint8ClampedArray(pixels), THUMB, THUMB)));
      thumbs = made; thumbPixels = pictures; graph.redraw(); const n = node(); if (n?.type === 'levels' && !$('material-pane-node').hidden) drawHistogram(n);
    }), 90); }
  }
  for (const v of ['tile', 'repeat', 'terrain']) $('mview-' + v).onclick = () => { view = v; refresh(); };
  $('mview-zoom').onclick = () => { zoomed = !zoomed; refresh(); };
  $('mview-solo').onclick = () => { solo = solo ? null : primary; refresh(); };

  // The header: which material, where it is used, and the list's own actions.
  function refresh() {
    const list = materials(); if (!list.some(m => m.slot === slot)) { slot = (list.find(m => m.worldGround) ?? list[0])?.slot ?? 0; selection = new Set(); primary = null; frameAt = -1; solo = null; }
    const m = material(), role = o => o.worldGround ? ' · world ground' : o.worldWater ? ' · world water' : '', full = list.length >= MATERIAL_SLOTS - 1;
    refreshWorld();
    if (!dialog.open) return;   // the rest is the editor's own face
    $('material-select').replaceChildren(...list.map(o => new Option(o.name + role(o), String(o.slot)))); $('material-select').value = String(slot);
    if (!m) return;
    if (m.nodes.every(n => n.id !== primary)) { primary = null; selection = new Set([...selection].filter(id => m.nodes.some(n => n.id === id))); }
    if (frameAt >= m.frames.length) frameAt = -1;
    if (solo && !m.nodes.some(n => n.id === solo)) solo = null;
    const users = materialUsers(host.strokes(), list, slot), strokes = users.strokes ? `${users.strokes} stroke${users.strokes > 1 ? 's' : ''}` : '';
    $('material-used').textContent = 'Used by: ' + ([users.world && 'the world’s ' + users.world, strokes].filter(Boolean).join(', ') || 'nothing yet');
    if (document.activeElement !== $('material-name')) $('material-name').value = m.name;
    $('material-use-ground').disabled = m.worldGround || m.worldWater; $('material-use-water').disabled = m.worldWater || m.worldGround;
    $('material-delete').disabled = m.worldGround || m.worldWater; $('material-delete').title = $('material-delete').disabled ? 'The world’s ground and water cannot be deleted. Assign another material first.' : '';
    for (const id of ['material-duplicate', 'material-paste', 'material-add']) { $(id).disabled = full; $(id).title = full ? 'The map already has seven materials.' : ''; }
    $('material-reset').disabled = !LIBRARY[m.source]; $('material-reset').title = LIBRARY[m.source] ? `Back to “${LIBRARY[m.source].name}” from the library. Undo brings your version back.` : 'This material did not come from the library.';
    for (const v of ['tile', 'repeat', 'terrain']) $('mview-' + v).setAttribute('aria-pressed', String(view === v));
    $('mview-zoom').setAttribute('aria-pressed', String(zoomed)); $('mview-zoom').disabled = view === 'repeat';
    $('mview-solo').setAttribute('aria-pressed', String(!!solo)); $('mview-solo').disabled = !solo && (!primary || node()?.type === 'output');
    $('graph-frame').disabled = !selection.size;
    $('graph-node-select').replaceChildren(new Option('Select a node…', ''), ...m.nodes.map(n => new Option(n.name, n.id))); $('graph-node-select').value = primary ?? '';
    if (!$('material-pane-controls').hidden) refreshControls(m);
    if (!$('material-pane-node').hidden) refreshNode(m);
    if (!$('material-pane-palette').hidden) refreshPalette(m);
    graph.refresh(slot); drawPicture(); refreshPictures();
  }
  const choose = next => { slot = next; selection = new Set(); primary = null; frameAt = -1; solo = null; picture = null; thumbs = new Map(); thumbPixels = new Map(); pick('controls'); refresh(); };
  $('material-select').onchange = () => choose(Number($('material-select').value));
  const addToMap = attempt((source, name) => { const added = addMaterial(materials(), source, name); update(added.materials); commit(); $('material-menu').open = false; choose(added.slot); });
  $('material-add').onchange = () => { const key = $('material-add').value; $('material-add').value = ''; if (key === 'blank') addToMap(blankMaterial(), 'New material'); else if (LIBRARY[key]) addToMap(LIBRARY[key], LIBRARY[key].name); };
  $('material-add').replaceChildren(new Option('Add a material…', ''), new Option('Blank material', 'blank'), ...Object.entries(LIBRARY).map(([key, m]) => new Option(m.name, key)));
  $('material-duplicate').onclick = attempt(() => { const added = duplicateMaterial(materials(), slot); update(added.materials); commit(); $('material-menu').open = false; choose(added.slot); });
  $('material-rename').onclick = attempt(() => { update(renameMaterial(materials(), slot, $('material-name').value)); commit(); });
  $('material-name').onkeydown = e => { if (e.key === 'Enter') $('material-rename').click(); };
  $('material-delete').onclick = attempt(() => { host.delete(slot); $('material-menu').open = false; refresh(); });
  $('material-use-ground').onclick = attempt(() => { update(assignMaterial(materials(), slot, 'worldGround')); commit(); });
  $('material-use-water').onclick = attempt(() => { update(assignMaterial(materials(), slot, 'worldWater')); commit(); });
  $('material-copy').onclick = async () => { try { await navigator.clipboard.writeText(materialText(material())); host.status('Copied the material.'); note(''); } catch (e) { note(e.message); } };
  $('material-paste').onclick = async () => { try { const m = parseMaterialText(await navigator.clipboard.readText()); addToMap(m, m.name); } catch (e) { note(e.message); } };
  $('material-reseed').onclick = attempt(() => change(m => { m.seed = reseedMaterial(m).seed; }));
  $('material-reset').onclick = attempt(() => { const source = LIBRARY[material().source]; if (!source) return; update(setMaterial(materials(), slot, source)); commit(); selection = new Set(); primary = null; frameAt = -1; refresh(); });
  for (const [id, role] of [['ground-world-default', 'worldGround'], ['water-material', 'worldWater']]) $(id).onchange = attempt(() => { update(assignMaterial(materials(), Number($(id).value), role)); commit(); });

  function open(which, from) {
    opener = from; if (which !== undefined) slot = which; pick('controls');
    if (!dialog.open) { host.suspend(true); dialog.showModal(); }
    pictureKey = thumbKey = ''; refresh(); graph.fit();
  }
  const close = () => { closeMenu(); dialog.close(); preview.cancel(); pictureKey = thumbKey = ''; host.suspend(false); opener?.focus(); };
  const roleSlot = key => materials().find(m => m[key])?.slot;
  $('materials-toolbar').onclick = () => open(undefined, $('materials-toolbar'));
  $('material-open').onclick = () => open(roleSlot('worldGround'), $('material-open'));
  $('water-material-edit').onclick = () => open(roleSlot('worldWater'), $('water-material-edit'));
  $('material-done').onclick = close;
  dialog.oncancel = e => e.preventDefault();
  dialog.onpointerdown = e => { if (!$('node-menu').contains(e.target) && e.target !== $('graph-add')) closeMenu(); if ($('material-menu').open && !$('material-menu').contains(e.target)) $('material-menu').open = false; };
  // Escape steps back one thing at a time: an open menu, then the selection, then the editor. Shortcuts never reach the map beneath.
  dialog.onkeydown = e => {
    if (e.defaultPrevented) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (closeMenu()) $('material-graph').focus(); else if ($('material-menu').open) { $('material-menu').open = false; $('material-menu').querySelector('summary').focus(); }
      else if (selection.size || frameAt >= 0 || solo) { selection = new Set(); primary = null; frameAt = -1; solo = null; refresh(); } else close();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.target.matches('input:not([type=range]),textarea')) { e.preventDefault(); $(e.shiftKey ? 'redo' : 'undo').click(); }
    e.stopPropagation();
  };
  $('material-undo').onclick = () => $('undo').click(); $('material-redo').onclick = () => $('redo').click();
  const lock = () => { $('materials-toolbar').disabled = $('editor').disabled; $('material-editor-fields').disabled = $('editor').disabled; $('material-undo').disabled = $('undo').disabled; $('material-redo').disabled = $('redo').disabled; };
  const locks = new MutationObserver(lock); for (const id of ['editor', 'undo', 'redo']) locks.observe($(id), {attributes: true, attributeFilter: ['disabled']}); lock();
  if (dialog.open) host.suspend(true);
  refresh();
  return {refresh, refreshPreview: () => { pictureKey = ''; refreshPictures(); }, dispose() { if (!dialog.open) host.suspend(false); clearTimeout(thumbTimer); locks.disconnect(); graph.dispose(); preview.dispose(); }};
}
