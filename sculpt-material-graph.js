// The material editor's graph canvas: node cards with a picture of what each makes, typed ports, wires and labeled frames.
// It draws and reports gestures; the editor (sculpt-material-editor.js) owns the material and makes every change.
import {NODES, nodeTypes, orderNodes, accepts as fits} from './sculpt-materials.js';

export const CARD = {width: 172, head: 38, row: 22, thumb: 72, port: 6, reach: 14};
const COLORS = {coords: '#91b9df', gray: '#d9bf8c', color: '#9bd5ae'};
const inputsOf = n => NODES[n.type].inputs;
export const cardHeight = n => CARD.head + Math.max(n.type === 'output' ? 0 : CARD.thumb + 8, inputsOf(n).length * CARD.row + 6) + 6;

// Where Arrange puts every node: columns by depth from the sources, each column ordered and aligned to what it connects to, so wires
// run left to right and cross little. Positions change only when the artist asks for this.
export function graphPositions(nodes, {aspect = null} = {}) {
  if (!nodes.length) return new Map();
  const compact = Number.isFinite(aspect) && aspect > 0, gap = compact ? 16 : 26, step = compact ? CARD.width + 28 : 236;
  const ordered = orderNodes(nodes), rank = new Map(), consumers = new Map(nodes.map(n => [n.id, []])), columns = [];
  for (const n of ordered) {
    rank.set(n.id, Math.max(-1, ...Object.values(n.in).filter(Boolean).map(id => rank.get(id))) + 1);
    for (const id of Object.values(n.in)) if (id) consumers.get(id).push(n.id);
  }
  // A source sits one column before its first reader, not at the far left.
  for (const n of [...ordered].reverse()) { const next = consumers.get(n.id); if (next.length) rank.set(n.id, Math.min(...next.map(id => rank.get(id))) - 1); }
  const top = Math.max(...rank.values()); for (const n of nodes) if (n.type === 'output') rank.set(n.id, top);
  for (const n of ordered) (columns[rank.get(n.id)] ??= []).push({n, y: 0, height: cardHeight(n)});
  const item = new Map(columns.flat().map(v => [v.n.id, v]));
  const pack = (column, want) => {   // keep the order, sit as near the wanted heights as the cards' sizes allow
    column.sort((a, b) => want(a) - want(b));
    let y = -Infinity;
    for (const v of column) { v.y = Math.max(want(v), y); y = v.y + v.height + gap; }
    const shift = column.reduce((sum, v) => sum + want(v) - v.y, 0) / column.length;
    for (const v of column) v.y += shift;
  };
  for (const column of columns) if (column) pack(column, v => column.indexOf(v) * 150);
  for (let sweep = 0; sweep < 10; sweep++) {
    const forward = sweep % 2 === 0, list = forward ? columns : [...columns].reverse();
    for (const column of list) if (column) pack(column, v => {
      const near = forward ? Object.values(v.n.in).filter(Boolean) : consumers.get(v.n.id);
      return near.length ? near.reduce((sum, id) => sum + item.get(id).y, 0) / near.length : v.y;
    });
  }
  const all = columns.flat(), low = Math.min(...all.map(v => v.y)), height = Math.max(...all.map(v => v.y + v.height)) - low;
  const width = (columns.length - 1) * step + CARD.width;
  // Compact first, then spread only the spare dimension toward the canvas's aspect. This leaves more room between wires without
  // making fitted cards smaller; expansion never overlaps cards. Saved positions are never passed through this unless Arrange is pressed.
  const sx = compact ? Math.max(1, Math.min(1.5, aspect * height / width)) : 1;
  const sy = compact ? Math.max(1, Math.min(1.5, width / (aspect * height))) : 1;
  return new Map(columns.flatMap((column, level) => (column ?? []).map(v => [v.n.id, {x: Math.round(level * step * sx), y: Math.round(compact ? (v.y - low) * sy : v.y)}])));
}

// An overview of every card and frame inside the usable canvas rectangle. No minimum zoom clips an unusually wide graph.
export function fitGraph(boxes, view) {
  if (!boxes.length || view.width <= 0 || view.height <= 0) return null;
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
  const width = Math.max(...boxes.map(b => b.x + b.width)) - x, height = Math.max(...boxes.map(b => b.y + b.height)) - y;
  const zoom = Math.min(1, view.width / Math.max(1, width), view.height / Math.max(1, height));
  return {zoom, pan: {x: view.x + (view.width - width * zoom) / 2 - x * zoom, y: view.y + (view.height - height * zoom) / 2 - y * zoom}};
}

// At overview scales a coarser world lattice keeps the visible grid sparse and its drawing work bounded.
export function graphGrid(zoom) {
  const step = 32 * zoom;
  return step * 2 ** Math.max(0, Math.ceil(Math.log2(16 / step)));
}

export function mountMaterialGraph(host) {
  const canvas = document.getElementById('material-graph'), ctx = canvas.getContext('2d');
  let zoom = 1, pan = {x: 40, y: 40}, shown = null, gesture = null, wire = null, hover = null, frame = 0, disposed = false, pendingFit = true, auto = new Map(), autoKey = '', viewWidth = 0, viewHeight = 0, autoFit = true;
  const nodes = () => host.material()?.nodes ?? [];
  // Cards with their place (the node's own, the gesture's while it is dragged, else Arrange's), type and size.
  const cards = () => {
    const list = nodes(); if (!list.length) return [];
    if (list.some(n => n.x === undefined)) { const key = JSON.stringify(list.map(n => [n.id, n.in])); if (key !== autoKey) { autoKey = key; auto = graphPositions(list, {aspect: usable().width / usable().height}); } }
    const types = nodeTypes(list), moved = gesture?.kind === 'move' ? gesture.positions : null;
    return list.map(n => ({n, ...(moved?.get(n.id) ?? (n.x === undefined ? auto.get(n.id) : {x: n.x, y: n.y})), type: types.get(n.id), height: cardHeight(n), inputs: inputsOf(n)}));
  };
  const inPort = (c, key) => ({x: c.x, y: c.y + CARD.head + CARD.row / 2 + c.inputs.findIndex(i => i[0] === key) * CARD.row});
  const outPort = c => ({x: c.x + CARD.width, y: c.y + CARD.head + CARD.row / 2});
  const point = e => { const r = canvas.getBoundingClientRect(); return {x: (e.clientX - r.left - pan.x) / zoom, y: (e.clientY - r.top - pan.y) / zoom}; };
  const frames = list => (host.material()?.frames ?? []).map((f, index) => {
    const members = list.filter(c => f.nodes.includes(c.n.id)); if (!members.length) return null;
    const x = Math.min(...members.map(c => c.x)) - 14, y = Math.min(...members.map(c => c.y)) - 30;
    return {index, name: f.name, x, y, width: Math.max(...members.map(c => c.x + CARD.width)) + 14 - x, height: Math.max(...members.map(c => c.y + c.height)) + 14 - y};
  }).filter(Boolean);
  // What lies under a point: a port first (ports reach past their dot so they are easy to grab), then a card, then a frame's label.
  function hit(p) {
    const list = cards(), reach = CARD.reach / Math.min(zoom, 1); let best = null, nearest = reach;
    for (const c of list) {   // the nearest port wins: zoomed out, neighboring ports lie within each other's reach
      const ports = [...(c.type ? [['out', outPort(c)]] : []), ...c.inputs.map(([key]) => [key, inPort(c, key)])];
      for (const [port, q] of ports) { const d = Math.hypot(p.x - q.x, p.y - q.y); if (d < nearest) { nearest = d; best = {c, port}; } }
    }
    if (best) return best;
    for (const c of [...list].reverse()) if (p.x >= c.x && p.x <= c.x + CARD.width && p.y >= c.y && p.y <= c.y + c.height) return {c, toggle: p.x < c.x + 24 && p.y < c.y + 26};
    for (const f of frames(list)) if (p.x >= f.x && p.x <= f.x + f.width && p.y >= f.y && p.y <= f.y + 24) return {frame: f};
    return null;
  }
  const accepts = (c, key, type) => { const want = c.inputs.find(i => i[0] === key)?.[2]; return !!want && fits(want, type); };
  const schedule = () => { if (!frame && !disposed) frame = requestAnimationFrame(draw); };
  function usable() {
    const r = canvas.getBoundingClientRect(), tools = canvas.parentElement.querySelector('.material-graph-tools')?.getBoundingClientRect(), help = canvas.parentElement.querySelector('#graph-help')?.getBoundingClientRect();
    const top = tools?.height ? tools.bottom - r.top + 12 : 16, bottom = help?.height ? r.bottom - help.top + 12 : 16;
    return {x: 20, y: top, width: Math.max(1, r.width - 40), height: Math.max(1, r.height - top - bottom)};
  }
  function fit() {
    const list = cards(), r = canvas.getBoundingClientRect();
    if (!list.length || r.width < 10 || r.height < 10) { pendingFit = true; return; }
    const fitted = fitGraph([...list.map(c => ({x: c.x, y: c.y, width: CARD.width, height: c.height})), ...frames(list)], usable());
    zoom = fitted.zoom; pan = fitted.pan; viewWidth = r.width; viewHeight = r.height; pendingFit = false; autoFit = true; schedule();
  }
  function curve(a, b, color, width) {
    const d = Math.max(40, Math.abs(b.x - a.x) * .45);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.bezierCurveTo(a.x + d, a.y, b.x - d, b.y, b.x, b.y); ctx.strokeStyle = color; ctx.lineWidth = width / Math.min(zoom, 1); ctx.stroke();
  }
  function label(value, x, y, max, color, size = 12, weight = '') {
    ctx.font = `${weight} ${size}px system-ui,sans-serif`; ctx.fillStyle = color; let s = value;
    while (ctx.measureText(s).width > max && s.length > 1) s = s.slice(0, -2) + '…';
    ctx.fillText(s, x, y);
  }
  function draw() {
    frame = 0; if (disposed) return;
    const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1; if (r.width < 1 || r.height < 1) return;
    if (canvas.width !== Math.round(r.width * dpr) || canvas.height !== Math.round(r.height * dpr)) { canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr); }
    if (pendingFit || autoFit && (viewWidth !== r.width || viewHeight !== r.height)) fit();
    else if (viewWidth && viewHeight && (viewWidth !== r.width || viewHeight !== r.height)) {
      // Resizing or focusing the graph keeps the graph point at the center and the artist's zoom, instead of fitting again.
      pan = {x: pan.x + (r.width - viewWidth) / 2, y: pan.y + (r.height - viewHeight) / 2};
    }
    viewWidth = r.width; viewHeight = r.height;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = '#141d20'; ctx.fillRect(0, 0, r.width, r.height);
    const grid = graphGrid(zoom); ctx.fillStyle = '#26333a'; for (let x = pan.x % grid; x < r.width; x += grid) for (let y = pan.y % grid; y < r.height; y += grid) ctx.fillRect(x, y, 1, 1);
    ctx.translate(pan.x, pan.y); ctx.scale(zoom, zoom);
    const list = cards(), byId = new Map(list.map(c => [c.n.id, c])), selection = host.selection(), thumbs = host.thumbnails(), frameAt = host.frame();
    for (const f of frames(list)) {
      const on = f.index === frameAt;
      ctx.fillStyle = '#1b262a'; ctx.strokeStyle = on ? '#9bd5ae' : '#3c4b52'; ctx.lineWidth = 1 / Math.min(zoom, 1); ctx.setLineDash([6, 5]);
      ctx.beginPath(); ctx.roundRect(f.x, f.y, f.width, f.height, 10); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
      label(f.name, f.x + 10, f.y + 17, f.width - 20, on ? '#cfe6d6' : '#8fa3a8', 12, '600');
    }
    for (const c of list) for (const [key] of c.inputs) {
      const from = byId.get(c.n.in[key]); if (!from || (wire?.detached?.id === c.n.id && wire.detached.key === key)) continue;
      const active = selection.has(c.n.id) || selection.has(from.n.id);
      ctx.globalAlpha = active ? 1 : .55; curve(outPort(from), inPort(c, key), '#141d20', active ? 6 : 4); curve(outPort(from), inPort(c, key), COLORS[from.type], active ? 2.4 : 1.5); ctx.globalAlpha = 1;
    }
    if (wire) { const from = byId.get(wire.from); if (from) curve(outPort(from), wire.point, COLORS[from.type], 2.4); }
    for (const c of [...list.filter(c => !selection.has(c.n.id)), ...list.filter(c => selection.has(c.n.id))]) {
      const {x, y, n} = c, on = selection.has(n.id), target = wire && hover?.c === c;
      ctx.globalAlpha = n.enabled ? 1 : .5;
      ctx.fillStyle = on ? '#2c3e37' : '#202c30'; ctx.strokeStyle = on ? '#9bd5ae' : target ? '#d9bf8c' : '#425158'; ctx.lineWidth = (on ? 1.8 : 1) / Math.min(zoom, 1);
      ctx.beginPath(); ctx.roundRect(x, y, CARD.width, c.height, 7); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(x + 13, y + 14, 4, 0, Math.PI * 2); ctx.fillStyle = ctx.strokeStyle = c.type ? COLORS[c.type] : '#9bd5ae'; if (n.enabled) ctx.fill(); else ctx.stroke();
      label(n.name, x + 24, y + 18, CARD.width - 32, '#e2ece7', 13, '600');
      label(NODES[n.type].label + (NODES[n.type].kinds ? ' · ' + NODES[n.type].kinds[n.kind] : ''), x + 12, y + 32, CARD.width - 24, '#93a8ad', 10.5);
      if (n.type !== 'output') {
        const tx = x + CARD.width - CARD.thumb - 10, ty = y + CARD.head, picture = thumbs.get(n.id);
        ctx.fillStyle = '#10171a'; ctx.fillRect(tx, ty, CARD.thumb, CARD.thumb);
        if (picture) { ctx.imageSmoothingEnabled = false; ctx.drawImage(picture, tx, ty, CARD.thumb, CARD.thumb); }
        if (host.solo() === n.id) { ctx.strokeStyle = '#e8d38a'; ctx.lineWidth = 2 / Math.min(zoom, 1); ctx.strokeRect(tx - 1, ty - 1, CARD.thumb + 2, CARD.thumb + 2); }
      }
      for (const [key, name] of c.inputs) {
        const q = inPort(c, key), linked = !!n.in[key], offered = wire && accepts(c, key, byId.get(wire.from)?.type);
        ctx.beginPath(); ctx.arc(q.x, q.y, CARD.port * (offered ? 1.35 : 1), 0, Math.PI * 2); ctx.fillStyle = offered ? '#f1e2b0' : linked ? '#d8e5dc' : '#56676e'; ctx.fill(); ctx.strokeStyle = '#141d20'; ctx.lineWidth = 1.5; ctx.stroke();
        label(name, q.x + 12, q.y + 4, CARD.width - (n.type === 'output' ? 30 : CARD.thumb + 34), '#b7c9cc', 11);
      }
      if (c.type) { const q = outPort(c); ctx.beginPath(); ctx.arc(q.x, q.y, CARD.port, 0, Math.PI * 2); ctx.fillStyle = COLORS[c.type]; ctx.fill(); ctx.strokeStyle = '#141d20'; ctx.lineWidth = 1.5; ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
  }
  // Releasing a wire: on an input port, on a card (its first free input that takes the type), or in the open, where the add menu
  // offers the nodes that take it.
  function drop(e) {
    const p = point(e), target = hit(p), from = cards().find(c => c.n.id === wire.from), was = wire; wire = null;
    if (target?.c && target.c.n.id !== was.from) {
      const key = target.port && target.port !== 'out' ? target.port : target.c.inputs.find(([k]) => accepts(target.c, k, from.type) && !target.c.n.in[k])?.[0] ?? target.c.inputs.find(([k]) => accepts(target.c, k, from.type))?.[0];
      if (key) { host.connect(was.from, target.c.n.id, key, was.detached); return; }
    }
    if (was.detached && !target) { host.connect(null, was.detached.id, was.detached.key); return; }
    if (!target && !was.detached) host.menu({x: e.clientX, y: e.clientY}, p, {from: was.from, type: from.type});
  }
  canvas.onpointerdown = e => {
    if (e.button !== 0) return; e.preventDefault(); canvas.focus(); host.closeMenu();
    const p = point(e), target = hit(p);
    if (target?.port === 'out') { wire = {from: target.c.n.id, point: p}; }
    else if (target?.port) {
      // Dragging a connected input takes its wire along; a plain click on it disconnects.
      const from = target.c.n.in[target.port];
      if (from) wire = {from, point: p, detached: {id: target.c.n.id, key: target.port}, start: {x: e.clientX, y: e.clientY}};
      else host.select([target.c.n.id]);
    }
    else if (target?.toggle) host.toggle(target.c.n.id);
    else if (target?.c) {
      const id = target.c.n.id, selection = host.selection();
      if (e.shiftKey) host.select(selection.has(id) ? [...selection].filter(s => s !== id) : [...selection, id]);
      else if (!selection.has(id)) host.select([id]);
      const moving = host.selection(), list = cards();
      gesture = {kind: 'move', start: p, origin: new Map(list.filter(c => moving.has(c.n.id)).map(c => [c.n.id, {x: c.x, y: c.y}])), positions: new Map(), moved: false, id};
    }
    else if (target?.frame) host.selectFrame(target.frame.index);
    else { gesture = {kind: 'pan', x: e.clientX, y: e.clientY, origin: {...pan}, moved: false}; }
    canvas.setPointerCapture(e.pointerId); schedule();
  };
  canvas.onpointermove = e => {
    const p = point(e);
    if (wire) { wire.point = p; hover = hit(p); schedule(); return; }
    if (gesture?.kind === 'move') {
      const dx = p.x - gesture.start.x, dy = p.y - gesture.start.y; gesture.moved ||= Math.hypot(dx, dy) * zoom > 3;
      if (gesture.moved) gesture.positions = new Map([...gesture.origin].map(([id, o]) => [id, {x: Math.round(o.x + dx), y: Math.round(o.y + dy)}]));
      schedule();
    } else if (gesture?.kind === 'pan') {
      gesture.moved ||= Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) > 3;
      pan = {x: gesture.origin.x + e.clientX - gesture.x, y: gesture.origin.y + e.clientY - gesture.y}; if (gesture.moved) autoFit = false; schedule();
    } else {
      hover = hit(p);
      canvas.style.cursor = hover?.port ? 'crosshair' : hover?.c ? 'grab' : hover?.frame ? 'pointer' : 'default';
      canvas.title = hover?.port === 'out' ? 'Drag to an input to connect' : hover?.port ? (hover.c.n.in[hover.port] ? 'Drag the wire away or click to disconnect' : 'Drag an output here to connect') : hover?.toggle ? 'Turn this node on or off' : '';
    }
  };
  canvas.onpointerup = e => {
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (wire) {
      const still = wire.detached && Math.hypot(e.clientX - wire.start.x, e.clientY - wire.start.y) < 4;
      if (still) { const d = wire.detached; wire = null; host.connect(null, d.id, d.key); } else drop(e);
    }
    const g = gesture; gesture = null; hover = null;
    if (g?.kind === 'move' && g.moved) host.move(g.positions);
    else if (g?.kind === 'move' && !e.shiftKey) host.select([g.id]);
    else if (g?.kind === 'pan' && !g.moved) host.select([]);
    schedule();
  };
  canvas.onpointercancel = e => { gesture = null; wire = null; if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId); schedule(); };
  canvas.ondblclick = e => { const target = hit(point(e)); if (target?.c && !target.port) host.viewAlone(target.c.n.id); else if (!target) host.menu({x: e.clientX, y: e.clientY}, point(e)); };
  canvas.oncontextmenu = e => { e.preventDefault(); const target = hit(point(e)); if (!target) host.menu({x: e.clientX, y: e.clientY}, point(e)); };
  canvas.onwheel = e => {
    e.preventDefault(); const p = point(e), r = canvas.getBoundingClientRect();
    autoFit = false; zoom = Math.max(1e-6, Math.min(2, zoom * Math.exp(-e.deltaY * .0015))); pan = {x: e.clientX - r.left - p.x * zoom, y: e.clientY - r.top - p.y * zoom}; schedule();
  };
  canvas.onkeydown = e => {
    const r = canvas.getBoundingClientRect(), center = {x: r.left + r.width / 2, y: r.top + r.height / 2};
    if (e.key === 'Escape' && wire) { wire = null; schedule(); }
    else if (['Delete', 'Backspace'].includes(e.key)) host.remove();
    else if (e.key.toLowerCase() === 'd' && (e.metaKey || e.ctrlKey)) host.duplicate();
    else if (e.key === 'Tab' && !e.shiftKey) host.menu(center, {x: (center.x - r.left - pan.x) / zoom, y: (center.y - r.top - pan.y) / zoom});
    else if (e.key.toLowerCase() === 'f' && !e.metaKey && !e.ctrlKey) fit();
    else return;
    e.preventDefault(); e.stopPropagation();
  };
  const resize = new ResizeObserver(schedule); resize.observe(canvas);
  return {
    // A different material fits to the view; the same one keeps the artist's zoom and place.
    refresh(context) { if (context !== shown) { shown = context; wire = null; gesture = null; pendingFit = autoFit = true; } schedule(); },
    fit, redraw: schedule,
    arrangement: () => { const v = usable(); return graphPositions(nodes(), {aspect: v.width / v.height}); },
    // The middle of the view, in graph units: where a node added from the toolbar lands.
    center() { const r = canvas.getBoundingClientRect(); return {x: (r.width / 2 - pan.x) / zoom, y: (r.height / 2 - pan.y) / zoom}; },
    places() { return new Map(cards().map(c => [c.n.id, {x: c.x, y: c.y}])); },
    dispose() { disposed = true; resize.disconnect(); cancelAnimationFrame(frame); },
  };
}
