// The material editor's pictures: the terrain renderer itself over small authored fixtures (a level plain or a deep sea for the tile,
// a shore and a hill for the material on terrain), each node's output for the graph and add menu, and the library drawer's swatches.
// One renderer serves them all, a job at a time. The picture and graph thumbnails take priority over the menu and library.
import {TerrainRenderer} from './sculpt-renderer.js';
import {MATERIAL_REPEAT, copyMaterial, makeNode, snippetNodes, soloMaterial} from './sculpt-materials.js';
import {MASK_KEYS} from './sculpt-scene.js';

export const TILE = MATERIAL_REPEAT, TERRAIN = 384, SWATCH = 96;
// The terrain fixture's height across its width: sea bed, a beach ramp, a level plain, then a hill; for a rock material a cliff, so its
// faces show the rock.
function terrainHeight(x, sea, base, cliff = false) {
  const t = x / TERRAIN, mix = (a, b, f) => a + (b - a) * Math.max(0, Math.min(1, f));
  if (t < .3) return mix(sea - 46, base, t / .3);
  if (t < .58) return base;
  return cliff ? mix(base, base + 120, (t - .58) / .14) : mix(base, base + 78, (t - .58) / .3);
}
// The terrain fixture's Time maps, so a material's Worn and Deposit colors show: water wore the hill's flank and laid sediment at its foot,
// each from none at the top of the picture to all of it at the bottom, so the picture shows every level a From setting can pick.
function terrainWeather(region, request) {
  const count = region.gridWidth * region.gridHeight, wear = new Float32Array(count), deposit = new Float32Array(count), clamp = v => Math.max(0, Math.min(1, v));
  const level = new Float32Array(count).fill(.5);   // the fall line's "none" (engine-common.wgsl timeMap3 without Time maps); every other map's is 0
  for (let y = 0; y < region.gridHeight; y++) for (let x = 0; x < region.gridWidth; x++) {
    const t = (region.gridOrigin[0] + x * region.gridSpacing - request.x) / TERRAIN, down = clamp((region.gridOrigin[1] + y * region.gridSpacing - request.y) / TERRAIN), i = y * region.gridWidth + x;
    wear[i] = clamp((t - .6) / .04) * clamp((.86 - t) / .04) * down;
    deposit[i] = clamp(1 - Math.abs(t - .56) / .04) * down;
  }
  return {wear, deposit, fx: level, fy: level};
}

// Menu thumbnails are fixed examples. Filters get inputs and settings that make their effect visible.
function nodeSample({type, kind, snippet}) {
  const nodes = [];
  const add = (type, props) => {
    const node = makeNode(type, nodes, props);
    nodes.push(node);
    return node.id;
  };
  const pattern = (kind = 'smooth', size = 22) => add('noise', {kind, params: {size}});
  if (snippet) {
    const height = snippet === 'moss-in-hollows' ? pattern('cells') : null;
    const made = snippetNodes(snippet, nodes), output = made.at(-1);
    if (height) {
      made.find(node => node.type === 'cavity').in.in = height;
      output.in.a = height;
    }
    return {material: copyMaterial({nodes: [...nodes, ...made]}), id: output.id};
  }

  const stops = [[0, .12, .07, .17], [.55, .59, .27, .21], [1, .97, .82, .51]];
  let props;
  switch (type) {
    case 'noise': props = {params: {size: 16}}; break;
    case 'warp': props = kind === 'push' ? {in: {by: pattern()}, params: {amount: 24}} : {params: {amount: 9}}; break;
    case 'levels': props = {in: {in: pattern()}, params: {low: .25, high: .75, terracing: .9}}; break;
    case 'combine': props = {in: {a: pattern('cells'), b: pattern('waves', 13)}, params: {amount: kind === 'multiply' ? 1 : .55}}; break;
    case 'heightblend': {
      const ha = pattern('cells'), hb = pattern('waves', 15);
      const a = add('gradient', {in: {in: ha}, stops});
      const b = add('constant', {kind: 'color', stops: [[0, .24, .50, .52]]});
      props = {in: {a, b, ha, hb}};
      break;
    }
    case 'gradient': props = {in: {in: pattern('billow')}, stops}; break;
    case 'adjust': props = {in: {in: add('gradient', {in: {in: pattern('cells')}, stops})}, params: {hue: 110}}; break;
    case 'blur': props = {in: {in: pattern('facets')}, params: {radius: kind === 'directional' ? 12 : 4, direction: 35}}; break;
    case 'slopeblur': props = {in: {in: pattern('facets'), slope: pattern()}, params: {distance: 24}}; break;
    case 'light': props = {in: {in: pattern('cells', 16)}, params: {strength: 5}}; break;
    case 'cavity': props = {in: {in: pattern('cracks', 20)}, params: {radius: 3, strength: 5}}; break;
    case 'constant': props = {stops: [[0, .24, .50, .52]]}; break;
  }
  const id = add(type, {kind, ...props});
  return {material: copyMaterial({nodes}), id};
}

export class MaterialPreview {
  constructor() { this.jobs = new Map(); this.swatches = []; this.serial = 0; this.pictureSerial = 0; this.running = false; this.renderer = null; this.timer = null; }
  // A picture of `material` beside `companion` (the map's water when the material is ground, its ground when it is water).
  // view: 'tile' (the whole repeat, level and lit) or 'terrain'. solo: a node id to show alone, unlit. done(error, {canvas, tiles, draft}).
  // ground: for a rock material, the map's ground, under which the terrain picture shows it as the rock.
  picture(main, material, companion, {view = 'tile', solo = null, ground = null} = {}, done) {
    const job = {kind: 'picture', main, material: structuredClone(material), companion: structuredClone(companion), ground: ground && structuredClone(ground), view, solo, done, serial: ++this.serial};
    const reduces = !solo && material.palette.length >= 2 && material.dither.amount > 0;
    this.pictureSerial = job.serial; clearTimeout(this.timer);
    // The first answer skips the palette reduction; the finished one follows once input settles.
    this.post({...job, draft: reduces});
    if (reduces) this.timer = setTimeout(() => { if (job.serial === this.pictureSerial) this.post({...job, draft: false}); }, 120);
  }
  // Each node's output, by node id (Uint8ClampedArray RGBA, THUMB px square).
  thumbnails(main, material, done) { this.post({kind: 'thumbnails', main, material: structuredClone(material), done, serial: ++this.serial}); }
  // One example output for an Add node entry, using the graph's thumbnail renderer.
  sample(main, entry, done) { this.post({kind: 'sample', main, entry, done}); }
  // A swatch for the library drawer: the middle SWATCH px of the material's repeat, level and lit (water as a deep sea), palette included.
  // done(error, canvas). Queued in order; cancelSwatches drops the ones not started.
  swatch(main, material, done) { if (this.disposed) return; this.swatches.push({kind: 'swatch', main, material: structuredClone(material), done}); if (!this.running) queueMicrotask(() => this.run()); }
  cancelSwatches() { this.swatches.length = 0; }
  post(job) { if (this.disposed) return; this.jobs.set(job.kind, job); if (!this.running) queueMicrotask(() => this.run()); }
  async host(main) {
    if (this.renderer && this.world === main) return this.renderer;
    this.renderer?.dispose();
    const config = structuredClone(Object.fromEntries(Object.entries(main.config).filter(([, v]) => typeof v !== 'function'))), pool = MATERIAL_REPEAT;
    Object.assign(config, {size: pool * 3 + 1, worldSize: pool * 3 + 1, grid: pool * 3 / 4 + 1, worldGrid: pool * 3 / 4 + 1, gpuBudgetBytes: 256 * 1024 * 1024, maskKeys: MASK_KEYS});
    this.renderer = await TerrainRenderer.createChunked(new OffscreenCanvas(TILE, TILE), config); this.world = main;
    return this.renderer;
  }
  async run() {
    if (this.running || this.disposed) return; this.running = true;
    try {
      while ((this.jobs.size || this.swatches.length) && !this.disposed) {
        const kind = ['picture', 'thumbnails', 'sample'].find(kind => this.jobs.has(kind)) ?? 'swatch';
        const job = kind === 'swatch' ? this.swatches.shift() : this.jobs.get(kind); this.jobs.delete(kind);
        try {
          const r = await this.host(job.main);
          if (this.disposed) return;
          if (kind === 'thumbnails' || kind === 'sample') {
            const {material, id} = kind === 'sample' ? nodeSample(job.entry) : job;
            const pictures = await r.groundCache.thumbnails(material, MATERIAL_REPEAT);
            if (!this.disposed) job.done(null, id ? pictures.get(id) : pictures);
            continue;
          }
          const water = job.material.worldWater === true, sea = r.config.seaLevel, base = r.config.baseHeight, pool = MATERIAL_REPEAT;
          let shown = job.solo ? soloMaterial(job.material, job.solo) : job.material;
          if (job.draft) shown = {...shown, dither: {...shown.dither, amount: 0}};
          r.variant = new URLSearchParams(job.main.variant); r.applyKnobs(); r.setColors(job.main.colorOverrides);
          r.i('uDiagnosticView', job.solo ? 8 : 0);
          const asRock = job.ground && job.view === 'terrain' && !job.solo, companion = job.companion ?? job.material;
          r.setMaterials(new Map(asRock ? [[1, {...job.ground, worldGround: true, worldWater: false}], [2, {...companion, worldGround: false, worldWater: true}], [3, {...shown, worldGround: false, worldWater: false, worldRock: true}]]
            : [[1, {...shown, worldGround: !water, worldWater: water}], [2, {...companion, worldGround: water, worldWater: !water}]]));
          const size = kind === 'swatch' ? SWATCH : job.view === 'terrain' ? TERRAIN : TILE, half = size / 2;
          const request = {x: pool * 1.5 - half, y: pool * 1.5 - half, width: size, height: size, worldSize: r.config.worldSize, worldGrid: r.config.worldGrid};
          const region = r.requiredRegion(request), count = region.gridWidth * region.gridHeight, h = new Float32Array(count);
          Object.assign(request, {gridWidth: region.gridWidth, gridHeight: region.gridHeight, gridOrigin: region.gridOrigin});
          for (let y = 0; y < region.gridHeight; y++) for (let x = 0; x < region.gridWidth; x++)
            h[y * region.gridWidth + x] = job.view === 'terrain' ? terrainHeight(region.gridOrigin[0] + x * region.gridSpacing - request.x, sea, base, asRock) : water ? sea - 64 : base;
          request.fields = {h}; request.masks = {ground: new Int8Array(count)};
          if (job.view === 'terrain') request.weather = terrainWeather(region, request);
          const rendered = await r.renderChunk(request, {clay: false, light: 'original'});
          if (this.disposed) continue;
          if (kind === 'swatch') { const canvas = new OffscreenCanvas(size, size); canvas.getContext('2d').drawImage(rendered.canvas, 0, 0); job.done(null, canvas); continue; }
          if (job.serial !== this.pictureSerial && !job.draft) continue;
          const canvas = new OffscreenCanvas(size, size), ctx = canvas.getContext('2d', {willReadFrequently: true}); ctx.drawImage(rendered.canvas, 0, 0);
          let tiles = null;
          if (!job.draft && job.view === 'tile' && !job.solo) {
            const pixels = ctx.getImageData(0, 0, size, size).data, keys = new Set();
            for (let y = 0; y < size; y += 32) for (let x = 0; x < size; x += 32) { let key = ''; for (let j = 0; j < 32; j++) { const at = ((y + j) * size + x) * 4; key += String.fromCharCode(...pixels.subarray(at, at + 128)); } keys.add(key); }
            tiles = keys.size;
          }
          job.done(null, {canvas, tiles, draft: job.draft, view: job.view});
        } catch (error) { if (!this.disposed) job.done(error); }
      }
    } finally { this.running = false; }
  }
  // Focus graph hides only the picture: drop its queued work and palette finish, while visible node thumbnails and library swatches continue.
  cancelPicture() { this.jobs.delete('picture'); clearTimeout(this.timer); this.pictureSerial = ++this.serial; }
  cancel() { this.cancelPicture(); this.jobs.clear(); this.swatches.length = 0; }
  dispose() { this.cancel(); this.disposed = true; this.renderer?.dispose(); this.renderer = null; }
}
