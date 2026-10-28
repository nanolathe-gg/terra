// Flow bake, stage 1 (card F1; design in FLOW_BAKE.md): the current and the
// colour it carries. River strokes and Source dabs are ordinary nodes that
// write no fields; one 'flowbake' node stores what the bake made, and replay
// only copies that into mask planes 20-24 (so a region replay stays exact and
// never re-runs the simulation). This module holds the pieces of that which
// sculpt.js only has to call: the node's stored result, its save format, and
// (further down) the bake driver and its panel.

// Mask planes the bake writes. Plane k is layer k >> 2, channel k & 3.
//   20 flow x, 21 flow y: the direction of the current times the square root of
//      its speed (so slow water keeps its direction in a signed byte); the speed
//      is the square of the vector's length, 0..1 of the fastest water of the bake
//   22, 23, 24: the concentration, 0..127 of 1, of sediment 1, 2 and 3. On land
//      within the bank reach the plane carries the same sediment fading with the
//      distance from the shore: the shader tints banks from it.
export const FLOW_FIRST = 20, FLOW_PLANES = 5;
export const FLOW_KINDS = ['river', 'source'];
export const isFlowKind = kind => FLOW_KINDS.includes(kind);

// What a river or source node keeps, under the names the shape editors read
// (radius, amount, roughness...), so Move, the brush sliders and Delete work on it as on any shape.
export const flowParams = (radius, amount, color = '') => ({radius, amount, rough: .35, softness: .5, bankWidth: .5, beachFlatness: .5, shelves: .25, shallowMode: 'passage', cracks: 0, color});

// A bake's stored result: {rect, planes: Int8Array x5 over the rect, colors:
// [[r,g,b] x3] (0..1), hash, settings, stats}. rect is in grid cells, inclusive.
export const resultWidth = result => result.rect.x1 - result.rect.x0 + 1;

// Replay's only job: copy the stored planes into the live ones, inside the
// clip a region replay allows (cells outside the bake's rect are untouched).
export function applyResult(result, planes, clip, grid) {
  if (!result) return;
  const r = result.rect, w = resultWidth(result);
  const x0 = Math.max(r.x0, clip.x0), x1 = Math.min(r.x1, clip.x1), y0 = Math.max(r.y0, clip.y0), y1 = Math.min(r.y1, clip.y1);
  if (x0 > x1 || y0 > y1) return;
  for (let k = 0; k < FLOW_PLANES; k++) {
    const src = result.planes[k], dst = planes[FLOW_FIRST + k];
    for (let y = y0; y <= y1; y++) dst.set(src.subarray((y - r.y0) * w + (x0 - r.x0), (y - r.y0) * w + (x1 - r.x0) + 1), y * grid + x0);
  }
}

// Save format: each plane as base64 of its bytes with runs of zero bytes
// collapsed (a zero byte, then the run length as two bytes), since most of a
// bake's planes are empty land.
function runs(plane) {
  const out = [];
  for (let i = 0; i < plane.length;) {
    if (plane[i] !== 0) { out.push(plane[i] & 255); i++; continue; }
    let j = i; while (j < plane.length && plane[j] === 0 && j - i < 65535) j++;
    out.push(0, (j - i) & 255, (j - i) >> 8); i = j;
  }
  return Uint8Array.from(out);
}
function unrun(bytes, length) {
  const out = new Int8Array(length); let at = 0;
  for (let i = 0; i < bytes.length;) {
    if (bytes[i] !== 0) { if (at >= length) throw new Error('The saved flow bake is too long.'); out[at++] = bytes[i] << 24 >> 24; i++; continue; }
    const n = bytes[i + 1] | (bytes[i + 2] << 8); if (at + n > length) throw new Error('The saved flow bake is too long.'); at += n; i += 3;
  }
  if (at !== length) throw new Error('The saved flow bake is too short.');
  return out;
}
const toBase64 = bytes => { let text = ''; for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(text); };
export function encodeResult(result) {
  if (!result) return undefined;
  return {rect: {...result.rect}, colors: result.colors, hash: result.hash, settings: result.settings, stats: result.stats, planes: result.planes.map(p => toBase64(runs(p)))};
}
export function decodeResult(saved, grid) {
  const r = saved?.rect;
  if (!r || ![r.x0, r.y0, r.x1, r.y1].every(Number.isInteger) || r.x0 < 0 || r.y0 < 0 || r.x1 >= grid || r.y1 >= grid || r.x1 < r.x0 || r.y1 < r.y0 || !Array.isArray(saved.planes) || saved.planes.length !== FLOW_PLANES) throw new Error('The saved flow bake is not valid.');
  const length = (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
  const colors = Array.isArray(saved.colors) ? saved.colors.slice(0, 3).map(c => [0, 1, 2].map(i => Math.max(0, Math.min(1, Number(c?.[i]) || 0)))) : [];
  while (colors.length < 3) colors.push([0, 0, 0]);
  return {rect: {x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1}, colors, hash: String(saved.hash ?? ''), settings: saved.settings || {}, stats: saved.stats || {},
    planes: saved.planes.map(text => unrun(Uint8Array.from(atob(text), c => c.charCodeAt(0)), length))};
}

// ---------------------------------------------------------------------------
// The bake driver and its panel. sculpt.js mounts it with a host object (the
// editor's state by getter, and the few actions it needs).

const BAKE_DEFAULTS = {mix: .35, fade: 1200, bed: .3, reach: 60};
const MARGIN_PX = 128;      // the bake's region: its inputs' box plus this
const IDLE_MS = 1500;       // auto-bake waits this long after the last edit
const hex = c => '#' + c.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
const validHex = h => typeof h === 'string' && /^#[0-9a-f]{6}$/i.test(h);

// Up to three sediments: each distinct source colour takes the next slot; a fourth
// colour joins the nearest of the three (documented in NOTES: more than three is not carried).
export function assignSlots(sources) {
  const colors = [], slots = [];
  for (const s of sources) {
    const key = validHex(s.color) ? s.color.toLowerCase() : '#7a3038';
    let at = colors.indexOf(key);
    if (at < 0 && colors.length < 3) { colors.push(key); at = colors.length - 1; }
    else if (at < 0) {
      const c = rgb(key); let best = 1e9;
      colors.forEach((other, k) => { const o = rgb(other), d = (c[0] - o[0]) ** 2 + (c[1] - o[1]) ** 2 + (c[2] - o[2]) ** 2; if (d < best) { best = d; at = k; } });
    }
    slots.push(at);
  }
  return {slots, colors: [0, 1, 2].map(i => colors[i] ? rgb(colors[i]) : [0, 0, 0])};
}

export function mountFlow(host) {
  const $ = host.$;
  let settings = {...BAKE_DEFAULTS}, auto = false, show = false, colour = '#7a3038';
  let worker = null, job = 0, running = null, stale = false, idleTimer = 0, checkTimer = 0, lastText = '';

  const nodeList = () => host.nodes();
  const bakeIndex = () => { const i = nodeList().findIndex(n => n.kind === 'flowbake'); return i; };
  const bakeNode = () => nodeList().find(n => n.kind === 'flowbake') || null;

  // The inputs a bake would read now: its region, the river and source strokes, the heights
  // before the bake node (or the live ones when it is not placed yet).
  function inputs() {
    const list = nodeList(), grid = host.grid(), spacing = host.spacing();
    const rivers = [], sources = [], src = [];
    let box = null;
    for (const n of list) {
      if (n.hidden || !isFlowKind(n.kind) || !n.points?.length) continue;
      const b = host.nodeBounds(n); box = box ? {x0: Math.min(box.x0, b.x0), y0: Math.min(box.y0, b.y0), x1: Math.max(box.x1, b.x1), y1: Math.max(box.y1, b.y1)} : b;
      (n.kind === 'river' ? rivers : src).push(n);
    }
    if (!box) return null;
    const m = Math.ceil(MARGIN_PX / spacing);
    const rect = {x0: Math.max(0, box.x0 - m), y0: Math.max(0, box.y0 - m), x1: Math.min(grid - 1, box.x1 + m), y1: Math.min(grid - 1, box.y1 + m)};
    const {slots, colors} = assignSlots(src);
    const pts = n => n.points.map(p => [p.x, p.y]);
    const i = bakeIndex(), before = i >= 0 && host.prefix()[i] ? host.prefix()[i].h : host.heights();
    return {rect, colors, before,
      rivers: rivers.map(n => ({pts: pts(n), radius: n.params.radius, amount: n.params.amount / 100})),
      sources: src.map((n, k) => ({pts: pts(n), radius: n.params.radius, amount: n.params.amount / 100, slot: slots[k], color: n.params.color}))};
  }
  function hashOf(inp) {
    let x = 2166136261;
    const text = JSON.stringify([inp.rect, inp.rivers, inp.sources, settings, host.sea()], (k, v) => typeof v === 'number' ? Math.round(v * 100) / 100 : v);
    for (let i = 0; i < text.length; i++) x = Math.imul(x ^ text.charCodeAt(i), 16777619);
    const grid = host.grid(), r = inp.rect;
    for (let y = r.y0; y <= r.y1; y++) for (let k = y * grid + r.x0, end = y * grid + r.x1; k <= end; k++) x = Math.imul(x ^ (Math.round(inp.before[k] * 8) | 0), 16777619);
    return (x >>> 0).toString(16) + ':' + (r.x1 - r.x0 + 1) + 'x' + (r.y1 - r.y0 + 1);
  }

  const text = (id, value) => { const el = $(id); if (el && el.textContent !== value) el.textContent = value; };
  function refresh() {
    const inp = inputs(), node = bakeNode(), result = node?.result;
    const was = stale;
    stale = Boolean(result && (!inp || hashOf(inp) !== result.hash));
    let state;
    if (running) state = `Baking… ${Math.round(running.progress * 100)}% (${running.phase})`;
    else if (!inp && !result) state = 'No river or source yet. Draw a river along the current, a source where sediment enters, then Bake.';
    else if (!result) state = 'Not baked yet.';
    else if (stale) state = 'Stale: the inputs changed since the bake. The old result stays on screen until you bake.';
    else state = 'Up to date.';
    if (result?.stats?.ms && !running) state += ` Last bake ${(result.stats.ms / 1000).toFixed(2)} s, ${result.stats.cw}×${result.stats.ch} cells of ${Math.round(result.stats.cellPx)} px, ${(result.stats.bytes / 1048576).toFixed(1)} MB working.`;
    text('flow-state', state);
    const badge = $('flow-badge'); if (badge) { badge.hidden = !(stale && !running); badge.textContent = 'stale'; }
    const button = $('flow-bake'); if (button) { button.textContent = running ? 'Cancel bake' : 'Bake'; button.disabled = !running && !inp; }
    const bar = $('flow-progress'); if (bar) { bar.hidden = !running; if (running) bar.value = running.progress; }
    if (stale !== was) host.relabel();
    // Bake when idle: after the last edit, if nothing is being drawn or moved.
    clearTimeout(idleTimer);
    if (auto && stale && !running && inp) idleTimer = setTimeout(() => { if (host.editing()) refresh(); else bake(); }, IDLE_MS);
  }
  // Recompute soon: edits arrive in bursts (dragging, undo), the hash walks the region once.
  function changed() { clearTimeout(checkTimer); checkTimer = setTimeout(() => { refresh(); host.updateControls(); }, 60); }

  function startWorker() {
    const w = new Worker('/sculpt-flow.js', {type: 'module'}); worker = w;
    w.onmessage = event => {
      const d = event.data; if (w !== worker || !running || d.job !== running.job) return;
      if (d.error) { fail(d.error); return; }
      if (d.cancelled) { running = null; refresh(); host.updateControls(); return; }
      if (!d.done) { running.progress = d.progress; running.phase = d.phase; refresh(); return; }
      const done = running; running = null;
      host.place({rect: done.rect, planes: d.planes.map(p => new Int8Array(p.buffer ?? p)), colors: done.colors, hash: done.hash, settings: {...done.settings}, stats: d.stats});
      host.status(`Flow baked in ${(d.stats.ms / 1000).toFixed(2)} s.`);
      refresh(); host.updateControls();
    };
    w.onerror = event => fail(event.message || 'worker unavailable');
  }
  function fail(message) { running = null; worker?.terminate(); worker = null; host.error('The flow bake failed: ' + message); refresh(); host.updateControls(); }

  // Start a bake of the current inputs; resolves when it is placed (or fails).
  function bake(overrides) {
    if (running) { cancel(); return; }
    if (overrides) { settings = {...settings, ...overrides}; syncSliders(); }
    const inp = inputs(); if (!inp) return;
    if (!worker) startWorker();
    const id = ++job, r = inp.rect, w = r.x1 - r.x0 + 1, grid = host.grid();
    const region = new Float32Array(w * (r.y1 - r.y0 + 1));
    for (let y = r.y0; y <= r.y1; y++) region.set(inp.before.subarray(y * grid + r.x0, y * grid + r.x1 + 1), (y - r.y0) * w);
    running = {job: id, rect: r, colors: inp.colors, hash: hashOf(inp), settings: {...settings}, progress: 0, phase: 'setup'};
    worker.postMessage({job: id, grid, size: host.size(), seaLevel: host.sea(), rect: r, heights: region, rivers: inp.rivers, sources: inp.sources, settings: {...settings}}, [region.buffer]);
    refresh(); host.updateControls();
  }
  function cancel() { if (!running) return; worker?.postMessage({cancel: true, job: running.job}); running.phase = 'cancelling'; refresh(); }

  // --- colours: a free picker, suggestions from the world, and the colours used before (kept with the world's settings)
  const swatch = (c, title, onPick) => { const b = document.createElement('button'); b.type = 'button'; b.title = title + ' ' + c; b.style.cssText = `flex:none;width:22px;min-width:22px;height:22px;padding:0;border-radius:4px;border:1px solid #465344;background:${c}`; b.addEventListener('click', onPick); return b; };
  function buildColours() {
    const world = host.world(), remembered = (world.flowColors || []).filter(validHex);
    const row = (id, list, title) => { const el = $(id); if (!el) return; el.replaceChildren(...list.map(([label, c]) => swatch(c, label || title, () => pick(c)))); };
    row('flow-suggest', host.suggestions().filter(([, c]) => validHex(c)), 'World colour');
    row('flow-recent', remembered.map(c => ['Used before', c]), 'Used before');
    $('flow-recent-label').hidden = !remembered.length;
  }
  function pick(c) {
    colour = c.toLowerCase(); $('flow-colour').value = colour; $('flow-hex').value = colour;
    host.recolourSelected(colour);
  }
  function remember(c) {
    if (!validHex(c)) return;
    const world = host.world(); world.flowColors = [c.toLowerCase(), ...(world.flowColors || []).filter(o => o.toLowerCase() !== c.toLowerCase())].slice(0, 12);
    host.saveWorlds(); buildColours();
  }

  // --- the panel
  const SLIDERS = [['mix', 'Mixing', 0, 100, 5, 100, '%', 'How far sediment spreads sideways into clean water as it goes.'],
    ['fade', 'Settling distance (px)', 200, 4000, 100, 1, '', 'Along the current, sediment fades with this e-folding distance: shorter, and the colour dies out sooner.'],
    ['bed', 'Current from the bed', 0, 100, 5, 100, '%', 'How far the bed\'s own downhill direction steers water that no river stroke covers.'],
    ['reach', 'Bank reach (px)', 0, 160, 4, 1, '', 'How far inland sediment stains the banks (the shader tints from this).']];
  function syncSliders() { for (const [key, , , , , scale, unit] of SLIDERS) { const el = $('flow-' + key); if (el) { el.value = Math.round(settings[key] * scale); text('flow-' + key + '-value', el.value + (unit || '')); } } }
  function build() {
    const section = document.createElement('section'); section.className = 'panel'; section.id = 'flow-panel';
    section.innerHTML = `<h3 class="panel-title">Current and sediment</h3>
      <p class="small">River tool: drag along the current (Diameter is its width, Amount its strength). Source tool: dab where sediment enters (Amount is how much). Then Bake.</p>
      <div class="control"><label for="flow-colour">Sediment colour (Source tool)</label>
        <div class="row"><input id="flow-colour" type="color" value="${colour}" aria-label="Sediment colour"><input id="flow-hex" type="text" value="${colour}" size="8" aria-label="Sediment colour as hex"></div>
        <div id="flow-suggest" class="row" style="gap:4px;flex-wrap:wrap" aria-label="Colours from this world"></div>
        <p id="flow-recent-label" class="small" hidden>Used before</p><div id="flow-recent" class="row" style="gap:4px;flex-wrap:wrap" aria-label="Colours used before"></div></div>
      ${SLIDERS.map(([key, label, lo, hi, step, , , help]) => `<div class="control"><label for="flow-${key}">${label} <output id="flow-${key}-value"></output></label><input id="flow-${key}" type="range" min="${lo}" max="${hi}" step="${step}"><p class="small">${help}</p></div>`).join('')}
      <div class="row"><button id="flow-bake" type="button">Bake</button><span id="flow-badge" class="small" style="color:#f3d36b;border:1px solid #f3d36b;border-radius:4px;padding:0 5px" hidden>stale</span></div>
      <progress id="flow-progress" max="1" value="0" style="width:100%" hidden></progress>
      <label class="small" style="display:flex;gap:6px"><input id="flow-auto" type="checkbox">Bake when the editor is idle</label>
      <label class="small" style="display:flex;gap:6px"><input id="flow-show" type="checkbox">Show the strokes and the baked current</label>
      <p id="flow-state" class="small"></p>`;
    host.mountPanel(section);
    for (const [key, , , , , scale] of SLIDERS) $('flow-' + key).addEventListener('input', () => { settings[key] = Number($('flow-' + key).value) / scale; syncSliders(); changed(); host.persist(); });
    syncSliders();
    $('flow-bake').addEventListener('click', () => bake());
    $('flow-auto').addEventListener('change', () => { auto = $('flow-auto').checked; refresh(); host.persist(); });
    $('flow-show').addEventListener('change', () => { show = $('flow-show').checked; host.schedule(); });
    $('flow-colour').addEventListener('input', () => pick($('flow-colour').value));
    $('flow-hex').addEventListener('change', () => { if (validHex($('flow-hex').value)) pick($('flow-hex').value); else $('flow-hex').value = colour; });
    const first = (host.world().flowColors || []).find(validHex); if (first) colour = first.toLowerCase();
    $('flow-colour').value = colour; $('flow-hex').value = colour;
    buildColours(); refresh();
  }
  build();

  // --- the overlay: the strokes (so they can be seen and picked), and optionally the baked current
  function draw(ink, tool, selected) {
    const showing = show || tool === 'river' || tool === 'source' || tool === 'move';
    if (!showing) return;
    const list = nodeList(), lift = host.lift;
    list.forEach((n, i) => {
      if (!isFlowKind(n.kind) || n.hidden || !n.points?.length) return;
      const pts = n.points.map(p => ({x: p.x, y: p.y - lift(p.x, p.y)}));
      if (n.kind === 'river') {
        ink.strokeStyle = i === selected ? '#f3d36b' : '#7fe3ff'; ink.fillStyle = ink.strokeStyle; ink.lineWidth = 3; ink.globalAlpha = .9;
        ink.beginPath(); pts.forEach((p, k) => k ? ink.lineTo(p.x, p.y) : ink.moveTo(p.x, p.y)); ink.stroke();
        // an arrowhead every ~70 px along the path, pointing the way the water goes
        let carry = 35;
        for (let k = 0; k < pts.length - 1; k++) {
          const a = pts[k], b = pts[k + 1], l = Math.hypot(b.x - a.x, b.y - a.y); if (l < 1e-6) continue;
          const tx = (b.x - a.x) / l, ty = (b.y - a.y) / l;
          for (let d = carry; d < l; d += 70) { const x = a.x + tx * d, y = a.y + ty * d; ink.beginPath(); ink.moveTo(x + tx * 9, y + ty * 9); ink.lineTo(x - tx * 6 - ty * 6, y - ty * 6 + tx * 6); ink.lineTo(x - tx * 6 + ty * 6, y - ty * 6 - tx * 6); ink.closePath(); ink.fill(); carry = d + 70 - l; }
          if (carry < 0) carry = 0;
        }
        ink.globalAlpha = .18; ink.lineWidth = Math.max(3, (n.params?.radius || 40) * 2); ink.lineCap = 'round'; ink.beginPath(); pts.forEach((p, k) => k ? ink.lineTo(p.x, p.y) : ink.moveTo(p.x, p.y)); ink.stroke(); ink.lineCap = 'butt';
      } else {
        const c = validHex(n.params?.color) ? n.params.color : '#7a3038', r = n.params?.radius || 30;
        ink.globalAlpha = .35; ink.fillStyle = c; ink.strokeStyle = i === selected ? '#f3d36b' : c; ink.lineWidth = i === selected ? 3 : 2;
        for (const p of pts) { ink.beginPath(); ink.arc(p.x, p.y, r, 0, Math.PI * 2); ink.fill(); ink.globalAlpha = .9; ink.stroke(); ink.globalAlpha = .35; }
      }
      ink.globalAlpha = 1;
    });
    const planes = host.planes();
    if (show && planes) {
      const grid = host.grid(), spacing = host.spacing();
      ink.strokeStyle = '#ffffffcc'; ink.fillStyle = '#ffe36b'; ink.lineWidth = 1.5;
      for (let wy = 12; wy < host.size(); wy += 28) for (let wx = 12; wx < host.size(); wx += 28) {
        const k = Math.round(wy / spacing) * grid + Math.round(wx / spacing), fx = planes[FLOW_FIRST][k] / 127, fy = planes[FLOW_FIRST + 1][k] / 127, m = Math.hypot(fx, fy);
        if (m < .06) continue;
        const speed = m * m, len = 8 + 22 * speed, y0 = wy - lift(wx, wy), tx = fx / m, ty = fy / m;
        ink.beginPath(); ink.moveTo(wx, y0); ink.lineTo(wx + tx * len, y0 + ty * len); ink.stroke(); ink.beginPath(); ink.arc(wx, y0, 1.8, 0, Math.PI * 2); ink.fill();
      }
    }
  }

  return {
    changed, busy: () => Boolean(running), stale: () => stale, bake, cancel, draw, remember, refresh,
    colour: () => colour,
    setColour: c => { if (validHex(c)) { colour = c.toLowerCase(); $('flow-colour').value = colour; $('flow-hex').value = colour; } },
    serialize: () => ({settings: {...settings}, auto}),
    load: saved => {
      settings = {...BAKE_DEFAULTS};
      for (const k of Object.keys(BAKE_DEFAULTS)) if (Number.isFinite(saved?.settings?.[k])) settings[k] = saved.settings[k];
      auto = Boolean(saved?.auto); $('flow-auto').checked = auto; syncSliders(); refresh();
    },
    rebuildColours: buildColours,
    debug: () => ({stale, running: Boolean(running), settings: {...settings}, auto, state: lastText})
  };
}
