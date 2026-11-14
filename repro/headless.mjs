// The engine without a browser: the editor's own modules (the scene builder, the shape fields, the Time pass, the chunk renderer) on Dawn, the
// WebGPU implementation Chrome uses, through its Node binding. The render checks and the measurement scripts run scenes here by default
// (render.mjs, regional.mjs, all.sh; --chrome runs them in the page instead), because a scene needs only the engine: one process of a few hundred
// MB and about a second, against five processes and over a gigabyte for headless Chrome. The editor, its UI and the static site stay in Chrome.
//
// The binding is npm's `webgpu` package (Dawn's official Node binding, MIT), a test-only tool the owner approved: it is installed outside the
// repository and the page never loads it. TERRAFORM_WEBGPU names the node_modules folder that holds it; the default is DAWN_DEFAULT below.
//
// The page's steps for a scene (sculpt.js boot, bootMap, scriptedScene, runFedWeather and sculpt-canvas.js bake) are followed here with the same
// shared functions (sculpt-scene.js), so a scene renders to the same pixels as in Chrome. What differs is only how pixels leave the GPU: the page
// copies the WebGPU canvas into 2D canvases, this reads the canvas texture.
import {existsSync, readFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {runSite} from './site-cli.mjs';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {fileURLToPath, pathToFileURL} from 'node:url';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DAWN_DEFAULT = '/tmp/nanolathe-map-editor/node-webgpu/node_modules';
const MB = 1024 * 1024;

// The Dawn binding, or an error that says how to get it.
async function loadDawn() {
  const root = process.env.TERRAFORM_WEBGPU || DAWN_DEFAULT, entry = join(root, 'webgpu', 'index.js');
  if (!existsSync(entry)) throw new Error(`the headless renderer needs Dawn's Node binding (npm package webgpu@0.6.2), which is not at ${root}. Install it outside the repository ` +
    `(npm install --prefix ${dirname(root)} webgpu@0.6.2) or set TERRAFORM_WEBGPU to the node_modules folder that holds it; --chrome runs the check in Chrome instead.`);
  return import(pathToFileURL(entry).href);
}

// What the page's WebGPU canvas is to the renderer: a context whose texture the renderer draws into. Readback takes the texture.
class HeadlessContext {
  constructor(canvas) { this.canvas = canvas; this.texture = null; }
  configure({device, format, usage}) { this.device = device; this.format = format; this.usage = usage; this.texture?.destroy(); this.texture = null; }
  unconfigure() { this.texture?.destroy(); this.texture = null; }
  getCurrentTexture() {
    const width = Math.max(1, this.canvas.width), height = Math.max(1, this.canvas.height);
    if (!this.texture || this.texture.width !== width || this.texture.height !== height) {
      this.texture?.destroy();
      this.texture = this.device.createTexture({label: 'headless canvas', size: [width, height], format: this.format, usage: this.usage | GPUTextureUsage.COPY_SRC});
    }
    return this.texture;
  }
}
// The canvases the renderer makes: its WebGPU canvas, and the 2D canvas it copies each chunk into for the page's image cache. That copy has no
// pixels here (drawImage does nothing); the runner reads the WebGPU canvas's texture instead.
class HeadlessCanvas {
  constructor(width = 1, height = 1) { this.width = width; this.height = height; }
  getContext(type) {
    if (type === 'webgpu') return this.gpu ??= new HeadlessContext(this);
    if (type === '2d') return this.ink ??= {imageSmoothingEnabled: true, imageSmoothingQuality: 'low', drawImage() {}};
    return null;
  }
}

// Where the engine's relative fetches go: the server's files (`server`, a development server base URL), or the checkout's sources with the generated files
// (the world configs, the catalog) that go run ./cmd/terraform --dump-configs writes with the same Go code the server runs.
function fileSource(configs) {
  return async path => {
    const name = decodeURIComponent(path.replace(/^\.?\//, '').split(/[?#]/)[0]);
    for (const file of [join(configs, name), join(REPO, name)]) if (!name.includes('..') && existsSync(file)) return new Response(readFileSync(file), {status: 200});
    return new Response('not found', {status: 404});
  };
}
export function dumpConfigs(dir = mkdtempSync(join(tmpdir(), 'terraform-configs-'))) {
  runSite(['--dump-configs', dir], {stdio: ['ignore', 'ignore', 'inherit']});
  return dir;
}

let host = null;
// The host: the Dawn instance and the browser globals the engine modules read (navigator.gpu, the GPU* constants, location, window,
// OffscreenCanvas, and fetch for relative paths). One per process. `server` or `configs` (a --dump-configs folder; made now if neither).
export async function openHost({server = '', configs = ''} = {}) {
  if (host) return host;
  const dawn = await loadDawn();
  Object.assign(globalThis, dawn.globals);
  const gpu = dawn.create(process.platform === 'darwin' ? ['backend=metal'] : []);
  // The canvas format is any 8-bit unorm one: Chrome's is BGRA, the same values in another order. RGBA reads back as the PNG wants it.
  gpu.getPreferredCanvasFormat = () => 'rgba8unorm';
  Object.defineProperty(globalThis, 'navigator', {value: {gpu}, configurable: true});
  globalThis.window = globalThis; globalThis.isSecureContext = true; globalThis.OffscreenCanvas = HeadlessCanvas;
  globalThis.location = {search: ''};
  const source = server ? null : fileSource(configs || dumpConfigs()), web = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, init) => typeof input === 'string' && !/^[a-z][a-z0-9+.-]*:/i.test(input)
    ? (server ? web(new URL(input.replace(/^\//, ''), server.replace(/\/?$/, '/')).href, init) : source(input)) : web(input, init);
  return host = {gpu, server, configs};
}

const json = async path => { const r = await fetch(path); if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`); return r.json(); };

// A scene opened as a page opens it (sculpt.js boot and bootMap): the world's config for the page's address, the map, the renderer, the fields,
// and the scene's nodes in them. `search` is the page's query (without '?'), as render.mjs and regional.mjs build it.
// The map view of the Chrome window this runner stands in for: render.mjs --chrome's (1500 x 1200; the page's terrain canvas when a scene starts,
// measured). The paged fields' budget keeps room for the view's canvases (sculpt-scene.js pagedBudget), so the pages take the same ring.
export const VIEW = {width: 1108, height: 841};
export async function openScene(scene, search, {strokes = scene.strokes, view = VIEW} = {}) {
  await openHost();
  const engine = await import('../sculpt-scene.js'), fieldsModule = await import('../sculpt-gpu-fields.js');
  const {configureMap} = await import('../sculpt-map.js'), {TerrainRenderer} = await import('../sculpt-renderer.js');
  const {copyRockSettings, applyWorldRock, copyRocks, worldRocks, keepStrokeRocks, rocksInUse} = await import('../sculpt-rock-presets.js');
  const {copyColumn} = await import('../sculpt-column.js'), {copyMapTools} = await import('../sculpt-tools.js');
  const settings = new URLSearchParams(search);
  for (const [key,value] of Object.entries(copyRockSettings(scene.rock) || {})) if (!settings.has(key)) settings.set(key,value);
  globalThis.location = {search: '?' + settings};
  const services = await json('services.json');
  const config = applyWorldRock(await json(`config/${encodeURIComponent(settings.get('biome') || services.defaultWorld)}${settings.get('variant') ? '--' + encodeURIComponent(settings.get('variant')) : ''}.json`));
  if (config.biomeId !== scene.biome) throw new Error(`asked for world ${scene.biome}, got ${config.biomeId}`);
  config.services = services;
  const worldColumn = {column: config.column}, columnOverride = copyColumn(scene.column);
  let rocks = copyRocks(scene.rocks) ?? worldRocks(config), rockKey = '[]';   // the map's rock presets (sculpt.js mapRocks): the scene's, else the world's
  const tools = copyMapTools(scene.tools) ?? [];   // the map's own tools (sculpt.js mapTools), which its strokes may name
  if (columnOverride) config.column = columnOverride;
  const catalog = await json('config/catalog.json');
  config.exportCatalog = catalog; config.defaultSeaLevel = catalog.worlds[config.biomeId]?.defaultSeaLevel;
  configureMap(config, settings);
  const {minH, maxH} = engine.heightRange(config);
  config.presetDefaults = {...config.defaults};
  engine.addDefaults(settings, config.defaults);
  engine.borrowBeach(config, settings);   // sculpt.js boot: a beach another world lends (Colors & base pattern, Beach)
  const worldSize = config.worldSize ?? config.size, worldGrid = config.worldGrid ?? config.grid, spacing = (worldSize - 1) / (worldGrid - 1);
  // sculpt-canvas.js mountMapCanvas: the chunk renderer over the map, with the page's colors.
  config.maskKeys = engine.MASK_KEYS; config.gpuBudgetBytes = 128 * MB;
  const canvas = new HeadlessCanvas(), renderer = await TerrainRenderer.createChunked(canvas, config), errors = [];
  renderer.onerror = message => errors.push(message);   // WebGPU validation and device errors arrive after the call that caused them
  fieldsModule.setFailureHandler(error => errors.push('shape fields: ' + (error?.message ?? String(error))));   // a failed shape run leaves the base height
  const ownColors = config.baseColors || config.colors || {};   // sculpt.js activeWorld: a world opens with its base colors as its own
  renderer.setColors(engine.rendererColors(engine.worldHexColors(config, settings, ownColors), columnOverride?.colors));
  const seed = engine.DEFAULT_SEED, refinementSeed = seed;
  let nodes = [];
  const context = () => engine.shapeContext({config, settings, seed, talusAngle: renderer.variantNumber('talusAngle', 40), minH, maxH});
  const gpuMB = Math.min(4096, Math.max(128, Number(settings.get('gpuMB')) || 512));
  const common = {worldSize, worldGrid, baseHeight: config.baseHeight, maskKeys: engine.MASK_KEYS, nodes: () => nodes, device: () => renderer.device, context, gesture: () => false};
  const paged = worldGrid > 1168 || settings.get('gpuPages') === 'force';
  const fields = paged
    ? fieldsModule.createPagedFields({...common, budget: () => engine.pagedBudget({gpuMB, renderer, chunk: Math.min(512, renderer.chunkSize()), maskCount: engine.MASK_KEYS.length, view}), foregroundPending: () => false, apron: Number(settings.get('timeApron') || 128), forceRing: Number(settings.get('pageRing') || 0)})
    : fieldsModule.createGpuFields(common);
  // sculpt.js scriptedScene: the scene's nodes replace the map's, and the fields evaluate them.
  // sculpt.js syncRocks: the renderer's rock table holds the presets strokes choose, and no other.
  const syncRocks = () => { const used = rocksInUse(nodes, rocks), key = JSON.stringify(used); if (key !== rockKey) { rockKey = key; renderer.setRocks(new Map(used.map(r => [r.slot, r]))); } };
  const play = (list, {ground = true} = {}) => { nodes = keepStrokeRocks(engine.sceneNodes(config, list, {ground, seed, settings, tools}), rocks); if (scene_) scene_.nodes = nodes; fields.changed(); syncRocks(); return nodes.length; };
  let scene_ = null;
  play(strokes, {ground: scene.ground !== false});
  if (paged) await fields.startCoarse();   // bootMap: a paged map's coarse lattice fills from the start
  const sliders = engine.surfaceSliders(config, settings);
  scene_ = {config, settings, renderer, canvas, fields, nodes, errors, play, context, engine, fieldsModule, worldSize, worldGrid, spacing, minH, maxH, seed, refinementSeed, sliders, paged, ownColors, worldColumn, columnOverride,
    material: engine.materialKnobs(sliders, refinementSeed, renderer.variant.get('transition')), drawOptions: options => engine.drawOptions(sliders, options),
    // The map's rock presets, and a new list for them (a preset edited, added or removed), as sculpt.js editRocks takes it: an edited preset is a
    // table upload, and the shape is evaluated again only when a stroke's choice went to Rock beneath (its preset deleted).
    get rocks() { return rocks; }, setRocks(list) {
      rocks = copyRocks(list) ?? []; const next = keepStrokeRocks(nodes, rocks);
      if (next.some((n, i) => n !== nodes[i])) { nodes = scene_.nodes = next; fields.changed(); }
      syncRocks();
    },
    dispose() { fields.destroy?.(); renderer.dispose(); }};
  return scene_;
}

// The Time pass over the scene's fields, as runFedWeather runs it (a whole map), or the paged Time runner (pagedTime) for a paged map.
export async function weather(s) {
  const {renderer, fields, config, engine, worldGrid: grid, worldSize: size, spacing} = s;
  // A pass again replaces the last one's results (sculpt.js dropGpuWeather): nothing reads them once this returns.
  if (s.time) { if (!s.time.paged) { s.time.weather.destroy(); s.time.maps.forEach(m => m.destroy()); s.time.field?.destroy(); } s.time = null; }
  if (!(renderer.variantNumber('erosion', 0) > 0)) return s.time = null;
  s.material = engine.materialKnobs(s.sliders, s.refinementSeed, renderer.variant.get('transition'));   // as runFedWeather reads them, when the pass runs
  if (s.paged) {
    await fields.coarseSettled();
    fields.setTime(engine.pagedTime({config, renderer, size, spacing, material: s.material}));
    return s.time = {paged: true};
  }
  await fields.gpuReady(); await fields.gpuQuiet();
  const b = fields.gpuBuffers(), {erosionOf} = await import('../sculpt-erosion.js'), erosion = await erosionOf(renderer);
  const result = await erosion.runGpu({planes: b.planes, masks: b.masks, rateMask: engine.MASK_KEYS.indexOf('ovErosion'), grid, size, seaLevel: config.seaLevel, ...engine.timeKnobs(renderer)});
  if (s.material) result.field = await erosion.materialField(engine.materialRequest(config, s.material, {heightBuffer: result.weather, heightOffset: grid * grid, grid, size}));
  return s.time = {weather: result.weather, maps: result.maps, field: result.field ?? null, milliseconds: result.milliseconds};
}

// What a bake reads (sculpt.js gpuFeedSource): the fields' buffers and the Time pass's, or a paged map's pages under the chunk's lattice.
async function feedFor(s, request, options) {
  const {fields, renderer, engine, time} = s;
  if (s.paged) {
    const region = renderer.requiredRegion(request, options), sp = region.gridSpacing, ox = Math.round(region.gridOrigin[0] / sp), oy = Math.round(region.gridOrigin[1] / sp);
    return fields.feedSource({x0: ox, y0: oy, x1: ox + region.gridWidth - 1, y1: oy + region.gridHeight - 1}, Boolean(time));
  }
  await fields.gpuReady();
  return {...fields.gpuBuffers(), maskCount: engine.MASK_KEYS.length, weather: time?.weather ?? null, maps: time?.maps ?? null, field: time?.field ?? null, get invalidRect() { return undefined; }, release: () => {}};
}

// The picture of a window, in tiles of `tile` px as the canvas bakes them (sculpt-canvas.js bake: fed, at 1x): RGBA bytes, opaque.
// exportArt bakes the export's art as sculpt-canvas.js exportChunks does (bake with exportArt: weathered, completed before it returns).
export async function renderWindow(s, {x = 0, y = 0, width = 1024, height = 1024, tile = 256, options = s.drawOptions(), exportArt = false} = {}) {
  const {renderer, canvas, config} = s, device = renderer.device, out = new Uint8Array(width * height * 4), reads = [];
  for (let ty = 0; ty < height; ty += tile) for (let tx = 0; tx < width; tx += tile) {
    const w = Math.min(tile, width - tx), h = Math.min(tile, height - ty);
    const request = {x: x + tx, y: y + ty, width: w, height: h, exportArt, worldSize: config.worldSize ?? config.size, worldGrid: config.worldGrid ?? config.grid};
    const feed = await feedFor(s, request, options);
    try { await renderer.renderChunk(request, {...options, feed, scale: 1, deferCompletion: !exportArt}); } finally { feed.release?.(); }
    const row = Math.ceil(w * 4 / 256) * 256, buffer = device.createBuffer({label: 'headless readback', size: row * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ});
    const encoder = device.createCommandEncoder({label: 'headless readback'});
    encoder.copyTextureToBuffer({texture: canvas.gpu.texture}, {buffer, bytesPerRow: row}, [w, h]);
    device.queue.submit([encoder.finish()]);
    reads.push({buffer, row, tx, ty, w, h});
  }
  for (const {buffer, row, tx, ty, w, h} of reads) {
    await buffer.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(buffer.getMappedRange());
    for (let r = 0; r < h; r++) out.set(src.subarray(r * row, r * row + w * 4), ((ty + r) * width + tx) * 4);
    buffer.unmap(); buffer.destroy();
  }
  for (let i = 3; i < out.length; i += 4) out[i] = 255;   // the canvas is opaque (alphaMode 'opaque'), as the page shows it
  return out;
}

// The Time pass's height on the CPU (sculpt.js gpuWeatherCpu): the authored height it started from and the eroded one, read back once a pass.
async function timeHeights(s) {
  if (!s.time.cpu) { const n = s.worldGrid ** 2, raw = await s.fieldsModule.readBuffer(s.renderer.device, s.time.weather, 0, n * 8); s.time.cpu = {refinedBase: new Float32Array(raw, 0, n), refined: new Float32Array(raw, n * 4, n)}; }
  return s.time.cpu;
}
// The weathered field over a region, as the page's export reads it (sculpt.js readRegional): a paged map's pages, or the fields' CPU copy with
// the Time pass's height laid on (sculpt-scene.js weatheredHeights).
async function readWeathered(s, request) {
  if (s.paged) return s.fields.readAsync(request);
  await s.fields.ready();
  const r = s.fields.read(request);
  return s.time ? {...r, fields: {...r.fields, h: s.engine.weatheredHeights(r, {...await timeHeights(s), grid: s.worldGrid, spacing: s.spacing})}} : r;
}

// A map's export as the page makes it (sculpt-export.js streamedExport; sculpt-canvas.js sampleHeights and exportChunks) through the page's
// exporter (sculpt-export-worker.js on export/ built for WebAssembly: repro/export-node.mjs, `wasm` its bytes): the corner heights from the
// weathered field (sculpt-map.js cellHeights), then the export art baked a canonical chunk at a time and written as PNG (repro/png.mjs), with the
// metadata the Export pane opens with. Only the engine's art: the page paints placed deposits and vents into the chunks with a 2D canvas, so a
// map with features exports in Chrome. onChunk(reply, done, total) sees the exporter's answer to each chunk.
export async function exportMap(s, {name, description, wasm, onChunk = () => {}}) {
  const {config} = s, map = config.map;
  if (!map) throw new Error('an export needs a map: mapX and mapY in the address');
  const {cellHeights} = await import('../sculpt-map.js'), page = await import('../sculpt-export.js'), {defaultStarts} = await import('../sculpt-features.js');
  const {encodePng} = await import('./png.mjs'), {exportWorker} = await import('./export-node.mjs');
  const catalogue = config.exportCatalog, climate = catalogue.worlds[config.biomeId]?.climate;
  if (!climate) throw new Error(`export is unavailable for ${config.biomeId}: ${catalogue.worlds[config.biomeId]?.disabledReason || 'no retail planet'}`);
  const sampled = await cellHeights(map, request => readWeathered(s, request)), palette = (await json('materials/palette.json')).indexed;
  const job = Array.from({length: 16}, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('');
  const call = exportWorker(wasm), start = page.exportStart({job, config, map, catalogue, palette, name, description: description ?? page.DEFAULT_DESCRIPTION,
    settings: page.climateSettings(climate), heights: sampled.heights, starts: defaultStarts(map)});
  await call(start);
  const size = Math.min(512, s.renderer.chunkSize()), total = Math.ceil(map.width / size) * Math.ceil(map.height / size), chunks = [];
  for (let y = 0; y < map.height; y += size) for (let x = 0; x < map.width; x += size) {
    const rect = {x, y, width: Math.min(size, map.width - x), height: Math.min(size, map.height - y)};
    const png = encodePng(rect.width, rect.height, await renderWindow(s, {...rect, tile: size, exportArt: true}));
    const reply = await call({op: 'chunk', ...rect, png: png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength)});
    chunks.push({...rect, png}); onChunk(reply, chunks.length, total);
  }
  const done = await call({op: 'finish'});
  return {start, chunks, clipped: sampled.clipped, result: done.result, archive: new Uint8Array(await done.archive.arrayBuffer()), indexed: new Uint8Array(await done.indexed.arrayBuffer())};
}

// The displayed heights over a window, `step` px apart (render.mjs's ours-heights.json): the page's weathered sampler (sculpt.js sampleRegional).
export async function windowHeights(s, {x = 0, y = 0, samples = 512, step = 2} = {}) {
  const {fields, engine, time, worldGrid: grid, spacing, renderer} = s, out = new Array(samples * samples);
  let sample;
  if (s.paged) sample = (px, py) => fields.sampleEroded(px, py);
  else {
    await fields.ready();
    if (time) {
      const {refined, refinedBase} = await timeHeights(s);
      const cell = (cx, cy) => engine.weatheredCell(fields.cell(cx, cy), fields.cell(cx, cy, 'r'), cy * grid + cx, refined, refinedBase);
      sample = (px, py) => engine.bilinearCells(px, py, spacing, grid, cell);
    } else sample = (px, py) => fields.sample(px, py);
  }
  for (let j = 0; j < samples; j++) for (let i = 0; i < samples; i++) out[j * samples + i] = sample(x + step * i, y + step * j);
  return out;
}

// The page's edits, as its handlers make them, then the shape and the Time pass they ask for (the page's own steps run as an edit settles; here
// at once). A world knob (sculpt.js setKnob and the audit host's knob): sculpt-knobs.js applyKnob, the code the page runs.
export async function knob(s, key, value, {weatherKeys = []} = {}) {
  const {applyKnob} = await import('../sculpt-knobs.js');
  const next = applyKnob({key, value, settings: s.settings, renderer: s.renderer, nodes: s.nodes, seed: s.seed});
  if (next.reload) throw new Error(`the world knob ${key} reloads the page: open the scene again with it in the address`);
  if (next.evaluate !== undefined) s.fields.changed();
  if (next.weather || weatherKeys.includes(key)) await weather(s);
}
// A surface slider (sculpt.js: an input event on the slider): it redraws, and the material field's two run the Time pass again.
export async function slider(s, id, value) {
  s.sliders[id] = Number(value);
  if (s.engine.TIME_SLIDER_IDS.includes(id)) await weather(s);
}
// A selected stroke's settings (sculpt.js changeSelected): a node without a path (the ground) is not edited.
export async function edit(s, i, values) {
  const n = s.nodes[i]; if (!n?.points) return;
  n.params = {...n.params, ...values};
  s.fields.changed(); await weather(s);
}
// A scripted scene (sculpt.js scriptedScene) with its Time pass.
export async function scene(s, list, {ground = true} = {}) { s.play(list, {ground}); await s.fields.ready(); return weather(s); }
// A Colors panel row picked (a hex) or cleared (null): sculpt-knobs.js pickWorldColor, as the panel's row applies it.
export async function pickColor(s, key, hex) {
  const {pickWorldColor} = await import('../sculpt-knobs.js');
  s.ownColors = pickWorldColor(s.config, s.ownColors, key, hex);
  s.renderer.setColors(s.engine.rendererColors(s.engine.worldHexColors(s.config, s.settings, s.ownColors), s.columnOverride?.colors));
}
// The map's own rock column (sculpt.js editColumn and restoreColumn, the Rock column panel's edit; null puts the world's back): checked as the
// page checks it, then the config the renderer and the Time pass read, the column's uniforms and slot colors, and the Time pass again.
export async function column(s, value) {
  const {copyColumn} = await import('../sculpt-column.js');
  s.worldColumn ??= {column: s.config.column};
  s.columnOverride = copyColumn(value);
  s.config.column = s.columnOverride || s.worldColumn.column;
  s.renderer.applyKnobs();
  s.renderer.setColors(s.engine.rendererColors(s.engine.worldHexColors(s.config, s.settings, s.ownColors), s.columnOverride?.colors));
  await weather(s);
}
// What the World panel enables a row by (sculpt-knobs.js worldPanelValues), with Weathering on as the page opens.
export async function panelValues(s) {
  const {worldPanelValues} = await import('../sculpt-knobs.js');
  const colors = s.engine.rendererColors(s.engine.worldHexColors(s.config, s.settings, s.ownColors), s.columnOverride?.colors);
  return worldPanelValues({config: s.config, renderer: s.renderer, nodes: s.nodes, colors, weathering: s.renderer.variantNumber('erosion', 0) > 0, materialWeathering: s.sliders['material-weathering']});
}
