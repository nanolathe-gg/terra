// A save's picture, and the toolbar's. The save carries one: the map from above (pictures: {map: {image}}, a small WebP data URL), so Maps shows
// it without opening the map. It is drawn from the map, not part of it: a save without one loads the same and the editor draws it when idle. It
// travels in the map's entry and in a downloaded file, never in a share link (shareText's save is sketch(), which carries none; the save-link
// Worker refuses fields it does not know).
// Tool pictures (each toolbar tool's stroke in the map's own world) are drawn when a map opens and kept only in the page: they always show this
// build and this world, and they cost a save nothing. A key in memory skips a tool whose inputs have not changed since its picture was drawn.
// Drawing one uses the terrain renderer itself over a small level fixture (as the material editor's pictures do), with a shape engine of its
// own: the map's renderer and fields are never touched. No Time pass runs there, so it is the unweathered look.
// The renderer and the shape engine load with the first tool picture, so the list of Maps (sculpt-maps.js) and node's tests read the rest alone.
import {HELP_PATH} from './sculpt-help-examples.js';

export const MAP_PICTURE = 128;                          // the long side of the map's picture, px
export const TOOL_PICTURE = {width: 104, height: 76};    // the toolbar's picture box is 46 px high; twice that, near the hover examples' 260 x 190 shape
const QUALITY = .72;
const MAX_IMAGE = 32 * 1024;                             // characters of a data URL kept on load; a 128 px WebP is about 5 K
const IMAGE_RE = /^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/;

// The hash a tool picture's key is written as: FNV-1a over the text, 2 x 32 bits. A key only says "drawn from the same inputs"; a collision
// redraws nothing. Objects are written with their keys sorted: a world read back from a save holds the same values in another order.
const sorted = (key, value) => value && typeof value === 'object' && !Array.isArray(value) && !ArrayBuffer.isView(value) ? Object.fromEntries(Object.keys(value).sort().map(k => [k, value[k]])) : value;
export function pictureKey(...parts) {
  const text = JSON.stringify(parts, sorted);
  let a = 0x811c9dc5, b = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193); b = Math.imul(b ^ c, 0x5bd1e995) ^ (b >>> 15); }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36);
}
const validImage = v => typeof v === 'string' && v.length <= MAX_IMAGE && IMAGE_RE.test(v);
// A save's picture as this editor keeps it: one that is not a small WebP data URL (a remote address, another type, too large) is dropped, and
// so is anything else a save holds there (an earlier build's tool pictures). Answers undefined when nothing is left.
export function copyPictures(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return validImage(value.map?.image) ? {map: {image: value.map.image}} : undefined;
}
// What a save carries of the page's pictures: the map's.
export const savedPictures = pictures => pictures.map ? {map: pictures.map} : undefined;

// A source (canvas, bitmap) drawn into width x height and written as a WebP data URL.
export async function encodePicture(source, width, height, crop = null) {
  const canvas = new OffscreenCanvas(width, height), g = canvas.getContext('2d', {alpha: false});
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  if (crop) g.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height); else g.drawImage(source, 0, 0, width, height);
  const blob = await canvas.convertToBlob({type: 'image/webp', quality: QUALITY});
  if (blob.type !== 'image/webp') return null;   // a browser that cannot write WebP keeps no pictures
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = ''; for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return 'data:image/webp;base64,' + btoa(text);
}
// The bake level of the map's picture: the smallest power of two that brings the play area's long side within twice the picture's
// (the picture is then drawn down from it), and its size.
export function mapPictureSize(playWidth, playHeight) {
  const long = Math.max(playWidth, playHeight), level = 2 ** Math.max(0, Math.floor(Math.log2(long / (2 * MAP_PICTURE))));
  const s = MAP_PICTURE / long;
  return {level, width: Math.max(1, Math.round(playWidth * s)), height: Math.max(1, Math.round(playHeight * s))};
}

// The tool fixture: a level plain at the world's base height, 2048 px square, the hover examples' path moved to its middle. A picture's
// frame is the stroke's reach (`reach`: {ax, ay, bx, by, r}, as the editor's nodeReach gives it) at the first of a few zoom steps that holds it
// whole (a 104 x 76 picture drawn down from 208 x 152 pixels at 2, 4 or 8 art pixels each), so a small hill and a wide plateau both fill theirs.
const FIXTURE = 2048, SPACING = 4, GRID = FIXTURE / SPACING + 1, RENDER = {width: 2 * TOOL_PICTURE.width, height: 2 * TOOL_PICTURE.height}, MARGIN = 96;
const pathMiddle = (() => { const xs = HELP_PATH.map(p => p[0]), ys = HELP_PATH.map(p => p[1]); return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]; })();
export const TOOL_PATH = HELP_PATH.map(([x, y]) => [Math.round(x - pathMiddle[0] + FIXTURE / 2), Math.round(y - pathMiddle[1] + FIXTURE / 2)]);
export function toolFrame({ax, ay, bx, by, r}) {
  const w = bx - ax + 2 * r, h = by - ay + 2 * r, cx = (ax + bx) / 2, cy = (ay + by) / 2;
  const scale = [2, 4, 8].find(s => RENDER.width * s >= w && RENDER.height * s >= h) ?? 8;
  const width = RENDER.width * scale, height = RENDER.height * scale, at = (c, size) => Math.round(Math.max(MARGIN, Math.min(FIXTURE - MARGIN - size, c - size / 2)) / SPACING) * SPACING;
  return {x: at(cx, width), y: at(cy, height), width, height, scale};
}

// The world a tool picture is drawn in, taken from the map's renderer when the picture is asked for (the renderer replaces these objects
// on a change rather than editing them, so a later edit does not reach a queued picture), and the part of its key that says so. `keys`: the
// settings a map's world holds (sculpt-save.js worldKeys); the renderer's other parameters (the page's address) neither draw nor key a picture.
export const worldSnapshot = (main, keys) => ({variant: new URLSearchParams([...new URLSearchParams(String(main.variant ?? ''))].filter(([k]) => keys.has(k)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)).toString(), grounds: main.grounds ?? new Map(), colors: {...(main.colorOverrides ?? {})}, surface: main.config.surface ?? null});
export const worldPictureKey = (world, context, options) => pictureKey(world.variant, [...world.grounds], world.colors, world.surface, context, options);

// Tool pictures, one at a time. request(main, job): main is the map's renderer (its config and device kind); job is
// {id, key, world (worldSnapshot), nodes, frame (toolFrame), rocks, context, refSpacing, options, done(error, image)}. A newer job for a tool replaces a queued one. The renderer and
// engine are made on the first job and released when the queue drains, so nothing stays on the GPU between rounds.
export class ToolPictures {
  constructor({idle = () => true, wait = ms => new Promise(r => setTimeout(r, ms))} = {}) { this.queue = new Map(); this.running = false; this.disposed = false; this.idle = idle; this.wait = wait; this.stats = {drawn: 0, ms: 0, peakBytes: 0}; }
  request(main, job) { if (this.disposed) return; this.queue.set(job.id, {...job, main}); if (!this.running) queueMicrotask(() => this.run()); }
  pending(id) { return this.queue.has(id); }
  cancel() { this.queue.clear(); }
  async host(main, sea, base, minH, maxH, refSpacing) {
    const at = JSON.stringify([sea, base, minH, maxH, refSpacing]);
    if (this.renderer && this.main === main && this.at === at) return this.renderer;
    this.release();
    const [{TerrainRenderer}, {createShapeEngine}, {MASK_KEYS}] = await Promise.all([import('./sculpt-renderer.js'), import('./sculpt-gpu-fields.js'), import('./sculpt-scene.js')]);
    const config = structuredClone(Object.fromEntries(Object.entries(main.config).filter(([, v]) => typeof v !== 'function')));
    Object.assign(config, {size: FIXTURE + 1, worldSize: FIXTURE + 1, grid: GRID, worldGrid: GRID, gpuBudgetBytes: 192 * 1024 * 1024, maskKeys: MASK_KEYS, map: null});
    delete config.onDeviceLost; delete config.onMemoryPressure;
    this.renderer = await TerrainRenderer.createChunked(new OffscreenCanvas(RENDER.width, RENDER.height), config);
    this.engine = await createShapeEngine({device: this.renderer.device, grid: GRID, spacing: SPACING, refSpacing, baseHeight: base, sea, minH, maxH});
    this.main = main; this.at = at;
    return this.renderer;
  }
  release() { this.engine?.destroy(); this.engine = null; this.renderer?.dispose(); this.renderer = null; this.main = null; }
  async run() {
    if (this.running || this.disposed) return; this.running = true;
    try {
      while (this.queue.size && !this.disposed) {
        // Low priority: wait for the editor to be idle (no gesture, no view work) before each picture.
        while (!this.idle() && !this.disposed) await this.wait(500);
        if (!this.queue.size || this.disposed) break;   // cancelled while it waited
        const [id, job] = this.queue.entries().next().value; this.queue.delete(id);
        const t0 = performance.now();
        try {
          const {sea, baseHeight: base, minH, maxH} = job.context;
          const r = await this.host(job.main, sea, base, minH, maxH, job.refSpacing);
          if (this.disposed) return;
          const w = job.world;
          r.variant = new URLSearchParams(w.variant); r.config.surface = structuredClone(w.surface ?? null);
          r.setColors(w.colors);
          if (w.grounds?.size) r.setMaterials(w.grounds);
          r.setRocks(job.rocks ?? new Map());
          // The shape engine runs only over the cells the frame's draw reads (its apron included).
          const f = job.frame, request = {x: f.x, y: f.y, width: f.width, height: f.height, worldSize: FIXTURE + 1, worldGrid: GRID};
          const region = r.requiredRegion(request, {scale: f.scale}), clampCell = v => Math.max(0, Math.min(GRID - 1, v));
          const x0 = clampCell(Math.round(region.gridOrigin[0] / SPACING)), y0 = clampCell(Math.round(region.gridOrigin[1] / SPACING));
          const x1 = clampCell(x0 + region.gridWidth - 1), y1 = clampCell(y0 + region.gridHeight - 1);
          const out = await this.engine.run(job.nodes, job.context, {x0, y0, x1, y1});
          const fields = {h: out.floats[0], p: out.floats[1], r: out.floats[2], c: out.floats[3], v: out.floats[4], x: out.floats[5], u: out.floats[6]};
          Object.assign(request, {gridOrigin: [x0 * SPACING, y0 * SPACING], gridWidth: x1 - x0 + 1, gridHeight: y1 - y0 + 1, gridSpacing: SPACING, fields, masks: out.masks});
          const rendered = await r.renderChunk(request, {...job.options, quality: 'full', scale: f.scale});
          const image = await encodePicture(rendered.canvas, TOOL_PICTURE.width, TOOL_PICTURE.height, {x: 0, y: 0, width: f.width / f.scale, height: f.height / f.scale});
          this.stats.drawn++; this.stats.ms += performance.now() - t0; this.stats.peakBytes = Math.max(this.stats.peakBytes, r.stats?.().peakBytes ?? 0);
          if (!this.disposed) job.done(null, image);
        } catch (error) { if (!this.disposed) job.done(error); }
        await this.wait(0);
      }
    } finally { this.running = false; if (!this.queue.size) this.release(); }
  }
  dispose() { this.cancel(); this.disposed = true; this.release(); }
}
