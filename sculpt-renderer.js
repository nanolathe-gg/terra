// One displaced surface, shared by every terrain brush. Prototype renderer
// on WebGPU (no WebGL fallback). Shaders: engine-common.wgsl (shared),
// sculpt-vert.wgsl and engine-frag.wgsl (the draw), engine-bake.wgsl (the
// fields bake of a chunk, a compute pass).

import {materialRows,tablePlacementRows,groundCoverRows,groundCoverOn,groundPool,PLACEMENT_ROW,PLANT_REACH} from './sculpt-material-model.js';
import {columnRows,columnColors} from './sculpt-column.js';
import {LOW_GROUND_RGB} from './sculpt-knobs.js';
import {makeNoise, NOISE_SIZE} from './sculpt-noise.js';
import {requestAdapter, WEBGPU_NEEDS as NO_WEBGPU} from './sculpt-webgpu.js';
import {RockWeather} from './sculpt-rock-weather.js';
import {VoxelSurface} from './sculpt-volume.js';
import {extractGates, gateValues, gateKey} from './sculpt-gates.js';

// The mask planes when the config names none: as many as MASK_KEYS (sculpt-scene.js, which says what each holds). The masks texture array has a layer per 4 planes.
const MASK_PLANE_COUNT = 25;

// sRGB 0..255 to OKLab (Ottosson 2020), as engine-palette.wgsl does on the GPU: the palette's colours are converted once here.
function oklab(rgb) {
  const lin = rgb.map(v => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  const [l, m, s] = [[0.4122214708, 0.5363325363, 0.0514459929], [0.2119034982, 0.6806995451, 0.1073969566], [0.0883024619, 0.2817188376, 0.6299787005]]
    .map(r => Math.cbrt(r[0] * lin[0] + r[1] * lin[1] + r[2] * lin[2]));
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}

// The plain's tiles as a 512 x 32 RGBA picture: tile t at x = 32 t, entry letters looked up in the colour list (H3). Plain bytes, uploaded
// with writeTexture: no image decode or canvas stands between the table and the texture, so every host uploads the same texels.
function groundTilePixels({entries, tiles}) {
  const data = new Uint8Array(512 * 32 * 4);
  tiles.forEach((tile, t) => { for (let i = 0; i < 1024; i++) {
    const k = tile.charCodeAt(i), c = entries[k >= 97 ? k - 97 : k - 39], at = ((i >> 5) * 512 + t * 32 + (i & 31)) * 4;
    data.set([c[0], c[1], c[2], 255], at);
  } });
  return {width: 512, height: 32, data};
}

// Average colour of an RGBA picture (0..1 RGB): the mean of every pixel. It was the mean of a 64 x 64 canvas reduction, which depended on the
// browser's resampling filter.
function meanColor({data}) {
  const sum = [0, 0, 0];
  for (let i = 0; i < data.length; i += 4) { sum[0] += data[i]; sum[1] += data[i + 1]; sum[2] += data[i + 2]; }
  return sum.map(v => v / (data.length / 4) / 255);
}

// The shaders keep their GLSL origins' structure: the common source is
// pasted at /*COMMON*/, and #ifdef / #ifndef / #else / #endif keep or drop
// lines by the defined names. Dropped lines stay blank, so a compiler
// message's line number still points into the assembled module.
export function preprocess(source, common, defines) {
  const out = [], keep = [];
  for (const line of source.replace('/*COMMON*/', common).split('\n')) {
    const m = line.match(/^\s*#(ifdef|ifndef|else|endif)\b\s*(\w*)/);
    if (!m) { out.push(keep.every(Boolean) ? line : ''); continue; }
    if (m[1] === 'ifdef' || m[1] === 'ifndef') keep.push((m[1] === 'ifdef') === defines.has(m[2]));
    else if (m[1] === 'else') keep.push(!keep.pop());
    else keep.pop();
    out.push('');
  }
  return out.join('\n');
}

// Byte layout of the shaders' one uniform block (struct Uniforms in
// engine-common.wgsl), by WGSL's uniform alignment rules. Arrays take a
// 16-byte element stride, so array<vec4f, N> is the only array form used.
// The one other struct is Rock, a rock recipe (array<Rock, N>): the members of slot 0 are also fields by their own names, so the world's own
// rock is set as every other uniform is (uFaceJoint).
// The rock's shine knobs, in the order of Rock.shineRock's components.
const SHINE_ROCK = ['shineRock', 'shineRockSharp', 'shineRockRough', 'shineRockScale'];
const FIELD_TYPES = {f32: [4, 4, 'f'], i32: [4, 4, 'i'], vec2f: [8, 8, 'f'], vec3f: [16, 12, 'f'], vec4f: [16, 16, 'f']};
function structFields(source, name) {
  const body = source.match(new RegExp(`struct ${name}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1];
  if (!body) throw new Error(`nanolathe: engine-common.wgsl has no struct ${name}`);
  return body.split('\n').map(raw => raw.replace(/\/\/.*$/, '').trim()).filter(Boolean).map(line => {
    const m = line.match(/^(\w+)\s*:\s*(?:array<(\w+),\s*(\d+)>|(\w+))\s*,?$/);
    if (!m) throw new Error(`nanolathe: unsupported uniform field "${line}" in engine-common.wgsl`);
    return {line, name: m[1], type: m[2] || m[4], array: Boolean(m[2]), count: m[2] ? Number(m[3]) : 1};
  });
}
export function uniformLayout(source) {
  const rock = new Map();
  let rockSize = 0;
  for (const f of structFields(source, 'Rock')) {
    const type = FIELD_TYPES[f.type];
    if (!type || (f.array && f.type !== 'vec4f')) throw new Error(`nanolathe: unsupported Rock field "${f.line}" in engine-common.wgsl`);
    // A member array (the recipe's colours) is array<vec4f, N>, 16 bytes an element, as the Uniforms' own arrays.
    const align = f.array ? 16 : type[0], size = f.array ? 16 * f.count : type[1];
    rockSize = Math.ceil(rockSize / align) * align;
    rock.set(f.name, {offset: rockSize, kind: type[2], width: type[1] / 4, count: f.count, stride: f.array ? 16 : 0});
    rockSize += size;
  }
  if (rockSize % 16) throw new Error('nanolathe: struct Rock must be a multiple of 16 bytes (a uniform array stride)');
  const fields = new Map();
  let offset = 0;
  for (const f of structFields(source, 'Uniforms')) {
    if (f.type === 'Rock') {
      offset = Math.ceil(offset / 16) * 16;
      fields.set(f.name, {offset, kind: 'struct', count: f.count, stride: rockSize, members: rock});
      for (const [name, m] of rock) fields.set(name, {offset: offset + m.offset, kind: m.kind, width: m.width, count: m.count, stride: m.stride});
      offset += rockSize * f.count;
      continue;
    }
    const type = FIELD_TYPES[f.type];
    if (!type) throw new Error(`nanolathe: unsupported uniform field "${f.line}" in engine-common.wgsl`);
    const align = f.array ? 16 : type[0], size = f.array ? 16 * f.count : type[1];
    offset = Math.ceil(offset / align) * align;
    fields.set(f.name, {offset, kind: type[2], width: type[1] / 4, count: f.count, stride: f.array ? 16 : 0});
    offset += size;
  }
  return {fields, size: Math.ceil(offset / 16) * 16};
}

// Mip levels for the materials that blend across scales: a 2x2 box filter
// per level and layer, as GL's generateMipmap gives.
const MIP_SHADER = `
@group(0) @binding(0) var src: texture_2d<f32>;
@vertex fn fullScreen(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}
@fragment fn halve(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let last = vec2i(textureDimensions(src, 0)) - 1;
  let s = vec2i(at.xy) * 2;
  return (textureLoad(src, min(s, last), 0) + textureLoad(src, min(s + vec2i(1, 0), last), 0)
        + textureLoad(src, min(s + vec2i(0, 1), last), 0) + textureLoad(src, min(s + vec2i(1, 1), last), 0)) * 0.25;
}`;

// H4: the generated materials' level-0 size and level count (512 down to 8 px).
const GENERATED_SIZE = 512, GENERATED_LEVELS = 7;

class SpecializationMiss extends Error { constructor(state) { super('nanolathe: pipelines for these gates are not built yet'); this.state = state; } }

// The engine's materials, uniforms and passes. ChunkTerrainRenderer (sculpt-chunk-renderer.js) is the renderer that is constructed: it adds
// the per-chunk textures, the memory accounting and renderChunk.
export class TerrainRenderer {
  static async createChunked(canvas, config) {
    const {ChunkTerrainRenderer} = await import('./sculpt-chunk-renderer.js');
    return ChunkTerrainRenderer.create(canvas, config);
  }

  constructor(canvas, config) {
    if (!navigator.gpu) throw new Error(NO_WEBGPU + ' This browser does not offer it' + (window.isSecureContext ? '.' : ' on an insecure page; open it from localhost or https.'));
    this.canvas = canvas;
    this.config = config;
    this.context = canvas.getContext('webgpu');
    if (!this.context) throw new Error(NO_WEBGPU + ' The page could not get a WebGPU canvas.');
    this.size = config.worldSize ?? config.size;
    this.grid = config.worldGrid ?? config.grid;
    this.maskPlaneCount = config.maskKeys?.length ?? MASK_PLANE_COUNT;
    this.maskLayers = Math.max(1, Math.ceil(this.maskPlaneCount / 4));
    this.timers = [];
    this.rocks = new Map();   // rock recipes in slots 1-15 (setRocks)
    this.lastGPU = null;
    this.lastBakeGPU = null;
    // Set by the page to show WebGPU errors that arrive after a call returns.
    this.onerror = null;
  }

  // Validation and device errors arrive asynchronously; report each one.
  reportError(message) {
    console.error('nanolathe: WebGPU: ' + message);
    this.onerror?.('WebGPU: ' + message);
  }

  async initialize() {
    const adapter = await requestAdapter();
    // The draw reads 16 textures in its fragment stage, WebGPU's guaranteed
    // default per stage, as the WebGL renderer used all 16 texture units. The
    // weather and material-field grids share one array texture (gridTexture)
    // so the painted masks (card C5) fit in that limit.
    const features = adapter.features.has('timestamp-query') ? ['timestamp-query'] : [];
    const device = this.device = await adapter.requestDevice({requiredFeatures: features});
    device.lost.then(info => { if (info.reason !== 'destroyed') this.reportError(`device lost: ${info.message}`); });
    device.addEventListener('uncapturederror', event => this.reportError(event.error.message));
    this.format = navigator.gpu.getPreferredCanvasFormat();
    // A plain unorm canvas stores the shader's values as they are, as the
    // WebGL canvas did (no sRGB encoding); opaque, as WebGL's alpha: false.
    this.context.configure({device, format: this.format, alphaMode: 'opaque',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST});

    // The engine's shaders (engine-frag / engine-bake / engine-common) draw every world.
    // Every world's materials are numbers: the config names its table (config.materialTable).
    const tableUrl = this.config.materialTable;
    this.materialData = null;
    const names = ['sculpt-vert.wgsl', 'engine-frag.wgsl', 'engine-common.wgsl', 'engine-bake.wgsl', 'engine-materials.wgsl', tableUrl, 'engine-palette.wgsl', 'materials/palette.json', 'engine-volume.wgsl'];
    const [vert, frag, common, bake, ...extra] = await Promise.all(names.map(async name => {
      const r = await fetch(name);
      if (!r.ok) throw new Error(`Cannot load ${name}`);
      return r.text();
    }));
    const modelTable = extra[1];
    this.paletteSource = extra[2];
    const palette = JSON.parse(extra[3]);
    this.paletteColours = palette.colours;
    // Slots 0-9 and 246-254 of the game's palette are Windows' static system colours, which its map art does not draw with (255, white,
    // it does: snow and surf). A colour that only those slots hold stays out of the lookup unless a world's table picks it by entry.
    const art = new Set(palette.indexed.filter((_, i) => i >= 10 && (i < 246 || i === 255)).map(String));
    this.paletteArt = palette.colours.map((_, i) => i).filter(i => art.has(String(palette.colours[i])));
    this.materialsSource = extra[0];
    this.commonSource = common;
    this.volumeSource = extra[4];
    this.layout = uniformLayout(preprocess(common, '', new Set()));
    this.uniformData = new ArrayBuffer(this.layout.size);
    this.uniformView = new DataView(this.uniformData);
    this.uniformBuffer = device.createBuffer({size: this.layout.size, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
    const compile = async (label, code) => {
      const module = device.createShaderModule({label, code});
      const messages = (await module.getCompilationInfo()).messages;
      // Warnings matter when porting a GLSL change; show them too.
      for (const m of messages.filter(m => m.type !== 'error'))
        console.warn(`nanolathe: ${label} ${m.type} ${m.lineNum}:${m.linePos} ${m.message}\n    ${code.split('\n')[m.lineNum - 1]?.trim() ?? ''}`);
      const errors = messages.filter(m => m.type === 'error');
      if (errors.length) throw new Error(`nanolathe: ${label} does not compile:\n` + errors.map(e =>
        `${e.lineNum}:${e.linePos} ${e.message}\n    ${code.split('\n')[e.lineNum - 1]?.trim() ?? ''}`).join('\n'));
      return module;
    };
    // P6: the draw's and the bake's uniform gates are override bools (sculpt-gates.js); the pipelines are built per set of values, see specialized().
    const fragGates = extractGates(preprocess(frag.replace('/*VOLUME*/',this.volumeSource), common, new Set(['VOLUME_RENDER'])), this.layout.fields);
    const bakeGates = extractGates(preprocess(bake, common, new Set(['BAKE'])), this.layout.fields);
    const [vertModule, fragModule, bakeModule] = await Promise.all([
      compile('sculpt-vert.wgsl', preprocess(vert, common, new Set())),
      compile('engine-frag.wgsl', fragGates.source),
      compile('engine-bake.wgsl', bakeGates.source)]);
    this.specParts = {vertModule, fragModule, bakeModule, frag: fragGates.gates, bake: bakeGates.gates, keyOrder: [...new Set([...fragGates.gates.keys(), ...bakeGates.gates.keys()])]};
    this.specCache = new Map();
    this.specBuilding = new Map();
    this.specUsed = [];
    this.specStats = {built: 0, ms: 0};

    // Group 0: the uniforms and the world fields, shared by the draw and the
    // bake (binding 6 is the fields for the draw, the routes for the bake).
    // Group 1: the draw's materials, or the bake's output.
    const both = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE;
    const texture = (binding, visibility, sampleType = 'float', viewDimension = '2d') => ({binding, visibility, texture: {sampleType, viewDimension}});
    const sampler = (binding, visibility) => ({binding, visibility, sampler: {type: 'filtering'}});
    this.commonLayout = device.createBindGroupLayout({label: 'world fields', entries: [
      {binding: 0, visibility: both, buffer: {type: 'uniform'}},
      texture(1, both, 'unfilterable-float'), texture(2, both), texture(4, both, 'float', '2d-array'), texture(6, both),
      sampler(7, both), sampler(8, both), texture(9, both, 'float', '2d-array'),texture(10,both,'unfilterable-float'),texture(11,both,'unfilterable-float'),texture(12,both,'unfilterable-float')]});
    const F = GPUShaderStage.FRAGMENT;
    // The engine draw (H4) binds only what Green reads: the plain's tiles, the water images, the palette and the generated materials
    // (binding 19, read with textureLoad); no land image remains. Binding numbers are the shared draw's, with 2-13 left out.
    this.materialLayout = device.createBindGroupLayout({label: 'materials', entries: [
      texture(0, F), sampler(1, F),
      texture(18, F), texture(19, F, 'float', '2d-array')]});
    // The bake's group 1: the fields texture, and the loose-stone mask lattice (looseMain fills it, the bake reads it).
    const fieldsLayout = device.createBindGroupLayout({label: 'fields out', entries: [
      {binding: 0, visibility: GPUShaderStage.COMPUTE, storageTexture: {access: 'write-only', format: 'rgba16float'}},
      {binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'storage'}}]});
    const bakeLayout = device.createPipelineLayout({bindGroupLayouts: [this.commonLayout, fieldsLayout]});
    this.fieldsLayout = fieldsLayout;
    this.bakePipelineLayout = bakeLayout;
    this.rockWeather = await RockWeather.create(this,preprocess);
    this.voxel = await VoxelSurface.create(this,this.volumeSource,preprocess);
    this.drawPipelineLayout = device.createPipelineLayout({bindGroupLayouts: [this.commonLayout, this.materialLayout,this.voxel.drawLayout]});
    const mipModule = device.createShaderModule({label: 'mip levels', code: MIP_SHADER});
    this.mipPipeline = device.createRenderPipeline({label: 'mip levels', layout: 'auto',
      vertex: {module: mipModule, entryPoint: 'fullScreen'},
      fragment: {module: mipModule, entryPoint: 'halve', targets: [{format: 'rgba8unorm'}]}});

    this.samplers = new Map();
    // The world fields: clamped and linear; noise repeats.
    this.linearClamp = this.sampler({magFilter: 'linear', minFilter: 'linear'});
    this.linearRepeat = this.sampler({magFilter: 'linear', minFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat'});
    // The fields a chunk's bake writes (r relief height, g route protection or (negative) beach, b crack/line code, a sand) and the
    // grid-resolution inputs are textures of the chunk (ChunkTerrainRenderer.allocate); the loose-stone mask's buffer outlives the chunks.
    this.looseBuffer = device.createBuffer({label: 'loose mask', size: 16, usage: GPUBufferUsage.STORAGE});
    this.bindGroups = {};
    this.fieldsDirty = true;
    this.uniform = this.layout.fields;
    this.materialData = JSON.parse(modelTable);
    // The water's grain is two more generated materials after the table's own, named by the config's water block (shared when the two are one).
    for (const name of [this.config.water.deep, this.config.water.shallow]) if (!this.materialData.order.includes(name)) this.materialData.order.push(name);
    // A borrowed beach (sculpt-scene.js borrowBeach names the lender's table): its beach material, generated as one more layer after the world's own,
    // so every other layer keeps its place and its noise.
    if (this.config.beachTable && !this.materialData.order.includes('beach')) {
      const lender = await this.groundTable(this.config.beachTable);
      this.materialData.measured.beach = lender.measured.beach; this.materialData.model.beach = lender.model.beach;
      this.materialData.order.push('beach');
    }
    // The startup generation: the materials and the palette lookup (GPU) are started first and the noise (CPU) is made while they build.
    this.textures = {};
    const generation = performance.now();
    const gpu = Promise.all([this.makeMaterials(), this.paletteTexture()]);
    this.textures.noise = this.noiseTexture();
    this.textures.palette = (await gpu)[1];
    this.generationMs = performance.now() - generation;
    const variant = new URLSearchParams(location.search);
    // H4: the engine's own knob values go in first, over the world's, under the page's query.
    for (const [key, value] of Object.entries(this.config.engineDefaults || {})) if (!variant.has(key)) variant.set(key, value);
    for (const [key, value] of Object.entries(this.config.defaults || {}))
      if (!variant.has(key)) variant.set(key, value);
    this.variant = variant;
    const slopeMaterial = ['slopes', 'structured'].includes(variant.get('surface'));
    this.means = {};
    // The materials the table makes, by name: which optional stages the world has.
    this.layers = new Set(this.materialData.order);
    // A world builds the plain's 16 tiles from its table's `ground` data; a borrowed pattern (World panel) names the table of the world it
    // comes from. A table without `ground` data (a quilted plain: its generated `quilt` layer is the plain) binds a one-texel stand-in,
    // and the world's mean ground colour is the quilt's.
    const groundTable = await this.groundTable(this.groundSource().groundTable);
    this.groundTiled = Boolean(groundTable.ground);
    const tiles = this.groundTiled ? groundTilePixels(groundTable.ground) : {width: 1, height: 1, data: new Uint8Array(4)};
    this.means.ground = this.groundTiled ? meanColor(tiles) : this.materialData.measured.quilt.meanRGB.map(v => v / 255);
    this.textures.grass = this.materialTexture('grass', [tiles], {minFilter: 'nearest', magFilter: 'nearest', mipmaps: false});
    // Mean colour of each base material, so a world can move it to a new base colour while keeping the texture's grain.
    this.means.slope = this.materialData.measured[this.materialData.order[0]].meanRGB.map(v => v / 255);
    this.means.rock = this.materialData.measured[this.materialData.order[1]].meanRGB.map(v => v / 255);
    // The transition body is generated layer 5 and the transition (ring, body, contours) needs the flag; the ring is layer 7. The beach is the
    // table's `beach` layer (6 in a world's own table, the last when borrowed).
    this.transitionBody = this.layers.has('body');
    if (this.layers.has('beach')) this.means.beach = this.materialData.measured.beach.meanRGB.map(v => v / 255);
    this.i('uBeach', this.layers.has('beach'));
    this.i('uBeachLayer', this.materialData.order.indexOf('beach'));
    this.f('uBeachHeight',this.config.material?.beachHeight??6);
    const mid=this.config.water?.midRGB, midDepth=this.config.material?.midDepth;
    this.set('uWaterMid', mid && midDepth ? [...mid.map(v => v / 255), midDepth] : [0, 0, 0, 0]);
    this.f('uGrid', this.grid);
    this.f('uSize', this.size);
    this.f('uBase', this.config.baseHeight - this.config.seaLevel);
    this.f('uSea', 0);
    this.f('uDetail', this.config.material?.surfaceRelief ?? 1.0);
    this.i('uSlopeMaterial', slopeMaterial);
    this.i('uMineralMargins', variant.get('transition') === 'mineral');
    this.applyKnobs();
    this.i('uDiagnosticView', ['diffuse','occlusion','shadow','exposure','shading','material','cracks'].indexOf(variant.get('view')) + 1);
    this.f('uFaceFill', variant.has('faceFill') ? Number(variant.get('faceFill')) : Math.max(0, Math.min(.5, (Number(variant.get('fill')) || 0) / 100)));
    const material = this.config.material || {};
    this.set('uSlopeProfile', [material.slopeStart ?? .10,
      material.slopeFull ?? .55, material.slopeFloor ?? 8.0, material.slopeDry ?? 24.0]);
    this.v('uElevatedCover', material.elevatedCover || [5, 32, 0]);
    this.i('uSlopeOnLowBanks', material.slopeOnLowBanks !== false);
    this.f('uRampMaterial', material.rampMaterial ?? 0);
    this.i('uSlopeSand', Boolean(material.slopeSand));
    this.i('uGrassSlopes', Boolean(material.grassSlopes));
    this.v('uCrystalColor', (material.crystalRGB || [110, 150, 225]).map(v => v / 255));
    this.i('uGroundFringe', material.groundFringe === true);
    // A preset can retain coloured veins or dark neutral grain at its edge.
    // The blending algorithm does not choose a biome's material colour.
    this.set('uFringeSignal', material.fringeSignal || [-.299, -.587, -.114, 1]);
    this.set('uFringeRange', material.fringeRange || [.08, .28]);
    this.f('uWetBand', material.wetBand ?? 13);
    // E6: mineralDetail scales the rock art's contrast about its mean (1: as drawn).
    const rockMean = material.hillRockMeanRGB || [85, 84, 79];
    this.v('uRockMean', rockMean.map(v => v / 255));
    this.v('uShallowColor', (this.config.water?.shallowRGB || [60, 115, 163]).map(v => v / 255));
    const bed = this.config.water?.riverBedRGB;   // riverfix: a braided bed's gravel, world data (absent: the draw darkens the world's rock)
    this.set('uRiverBed', bed ? [...bed.map(v => v / 255), 1] : [0, 0, 0, 0]);
    this.v('uDeepColor', (this.config.water?.deepRGB || [16, 57, 133]).map(v => v / 255));
    this.v('uWaterMean', this.materialData.measured[this.config.water.deep].meanRGB.map(v => v / 255));
    this.i('uWaterLayer', this.materialData.order.indexOf(this.config.water.deep));
    this.i('uShallowLayer', this.materialData.order.indexOf(this.config.water.shallow));
  }

  sampler(descriptor) {
    const key = JSON.stringify(descriptor);
    if (!this.samplers.has(key)) this.samplers.set(key, this.device.createSampler(descriptor));
    return this.samplers.get(key);
  }

  // An RGBA8 material from one image per layer ({width, height, data}: RGBA bytes, row by row), with its sampler. Filters
  // follow the WebGL renderer: repeat, the given min/mag filters, and
  // trilinear between generated levels where the material has them.
  materialTexture(label, images, {minFilter, magFilter, mipmaps}) {
    const {width, height} = images[0], layers = images.length;
    const mipLevelCount = mipmaps ? Math.floor(Math.log2(Math.max(width, height))) + 1 : 1;
    const texture = this.device.createTexture({label, size: [width, height, layers], format: 'rgba8unorm', mipLevelCount,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT});
    images.forEach((source, layer) => this.device.queue.writeTexture({texture, origin: [0, 0, layer]}, source.data,
      {bytesPerRow: width * 4, rowsPerImage: height}, [width, height]));
    if (mipmaps) this.generateMipmaps(texture, layers, mipLevelCount);
    return {texture, view: texture.createView({dimension: layers > 1 ? '2d-array' : '2d'}),
      sampler: this.sampler({minFilter, magFilter, mipmapFilter: mipmaps ? 'linear' : 'nearest', addressModeU: 'repeat', addressModeV: 'repeat'})};
  }

  // The draw's noise (sculpt-noise.js): periodic RGBA8, linear filtering, repeating.
  noiseTexture() {
    const start = performance.now();
    const texture = this.device.createTexture({label: 'noise', size: [NOISE_SIZE, NOISE_SIZE], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST});
    this.device.queue.writeTexture({texture}, makeNoise(), {bytesPerRow: NOISE_SIZE * 4}, [NOISE_SIZE, NOISE_SIZE]);
    this.noiseMs = performance.now() - start;
    return {texture, view: texture.createView(), sampler: this.sampler({minFilter: 'linear', magFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat'})};
  }

  // The palette lookup (engine-palette.wgsl): the colours map art draws with, or the ones the table's `palette.entries` pick, as a 1024 x 288 RGBA8 texture.
  async paletteTexture() {
    const device = this.device, start = performance.now();
    const colours = (this.materialData.palette?.entries ?? this.paletteArt).map(i => this.paletteColours[i]);
    const rows = new Float32Array(colours.length * 8);
    colours.forEach((c, i) => { rows.set([c[0], c[1], c[2], 0], i * 8); rows.set(oklab(c), i * 8 + 4); });
    const buffer = device.createBuffer({size: rows.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST});
    device.queue.writeBuffer(buffer, 0, rows);
    const count = device.createBuffer({size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
    device.queue.writeBuffer(count, 0, new Uint32Array([colours.length, 0, 0, 0]));
    const texture = device.createTexture({label: 'palette lookup', size: [1024, 288], format: 'rgba8unorm', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC});
    if (!this.palettePipeline) {
      const module = device.createShaderModule({label: 'engine-palette.wgsl', code: this.paletteSource});
      const errors = (await module.getCompilationInfo()).messages.filter(m => m.type === 'error');
      if (errors.length) throw new Error('nanolathe: engine-palette.wgsl does not compile:\n' + errors.map(e => `${e.lineNum}:${e.linePos} ${e.message}`).join('\n'));
      this.palettePipeline = await device.createComputePipelineAsync({label: 'palette', layout: 'auto', compute: {module, entryPoint: 'paletteMain'}});
    }
    const encoder = device.createCommandEncoder({label: 'palette'});
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.palettePipeline);
    pass.setBindGroup(0, device.createBindGroup({layout: this.palettePipeline.getBindGroupLayout(0), entries: [
      {binding: 0, resource: {buffer}}, {binding: 1, resource: {buffer: count}}, {binding: 2, resource: texture.createView()}]}));
    pass.dispatchWorkgroups(128, 4);
    pass.end();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    buffer.destroy(); count.destroy();
    this.paletteMs = performance.now() - start;
    return {texture, view: texture.createView()};
  }

  generateMipmaps(texture, layers, levels) {
    const encoder = this.device.createCommandEncoder({label: 'mip levels'});
    for (let layer = 0; layer < layers; layer++) for (let level = 1; level < levels; level++) {
      const view = mip => texture.createView({dimension: '2d', baseMipLevel: mip, mipLevelCount: 1, baseArrayLayer: layer, arrayLayerCount: 1});
      const pass = encoder.beginRenderPass({colorAttachments: [{view: view(level), loadOp: 'clear', storeOp: 'store'}]});
      pass.setPipeline(this.mipPipeline);
      pass.setBindGroup(0, this.device.createBindGroup({layout: this.mipPipeline.getBindGroupLayout(0), entries: [{binding: 0, resource: view(level - 1)}]}));
      pass.draw(3);
      pass.end();
    }
    this.device.queue.submit([encoder.finish()]);
  }

  // Base colours chosen for a world: {ground, slope, rock, sand, beach,
  // shallow, deep} as [r,g,b] 0..1, or absent to keep the world's own.
  groundSource() {
    return this.config.groundPatterns?.[this.variant.get('groundPattern')] || (this.ownGround ??= {groundTable: this.config.materialTable});
  }
  // A world's table by URL (a borrowed ground pattern or beach): this world's own is already loaded.
  async groundTable(url) {
    if (url === this.config.materialTable) return this.materialData;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Cannot load ground pattern ${url}`);
    return response.json();
  }

  setColors(colors = {}) {
    this.colorOverrides = {...colors};
    this.set('uMaterialTable', this.placementTable(this.variant));
    for (const key of ['ground', 'slope', 'sand', 'beach', 'shallow', 'deep', 'crystal']) {
      const c = colors[key];
      this.set('u' + key[0].toUpperCase() + key.slice(1) + 'Base', c ? [...c, 1] : [0, 0, 0, 0]);
    }
    // The light's colours (card P12b): white is the grey light every world had.
    this.v('uSunColor', colors.sun || [1, 1, 1]);
    this.v('uSkyColor', colors.sky || [1, 1, 1]);
    // Low ground's color: the world's pick, else a dark red-brown mud (retail Zhon's lowland).
    this.v('uLowColor', colors.low || LOW_GROUND_RGB.map(v => v / 255));
    // The authored slot palette, or tones of this world's own rock.
    const strataDefaults = columnColors(this.config.column,this.means.rock);
    const strata = strataDefaults.map((c, i) => colors['strata' + (i + 1)] || c.map(v => v / 255));
    // The world's rock is slot 0 of the rock table: its colour (a = 1 when the world chose one) and its beds' slots, which a recipe without
    // colours of its own takes (writeRocks).
    // Row 6: the color it deepens toward with thickness (B4), the world's 'absorb' color where it chose one.
    this.set('uRockColors', [colors.rock ? [...colors.rock, 1] : [0, 0, 0, 0], ...strata, colors.absorb ? [...colors.absorb, 1] : [0, 0, 0, 0]]);
    for (const key of ['ground', 'slope', 'rock', 'beach'])
      this.v('u' + key[0].toUpperCase() + key.slice(1) + 'TexMean', this.means[key] || [0.5, 0.5, 0.5]);
    this.writeRocks();
  }

  // GLSL uniform uFooBar is the uniform block's field fooBar. A value is a
  // number or boolean, a vector's components, or (for an array) a list of
  // element vectors. Unknown names throw: WebGL ignored them silently.
  set(name, value) {
    const field = /^u[A-Z]/.test(name) && this.uniform.get(name[1].toLowerCase() + name.slice(2));
    if (!field) throw new Error(`nanolathe: no uniform ${name} in engine-common.wgsl`);
    const elements = field.stride ? value : [typeof value === 'object' ? value : [value]];
    if (elements.length > field.count) throw new Error(`nanolathe: too many elements for uniform ${name}`);
    elements.forEach((element, e) => {
      const components = Array.from(element, Number);
      if (components.length > field.width) throw new Error(`nanolathe: too many components for uniform ${name}`);
      components.forEach((c, j) => {
        const at = field.offset + e * field.stride + j * 4;
        if (field.kind === 'i') this.uniformView.setInt32(at, c, true); else this.uniformView.setFloat32(at, c, true);
      });
    });
    this.uniformsDirty = true;
  }
  f(name, value) { this.set(name, value); }
  i(name, value) { this.set(name, Number(value)); }
  v(name, value) { this.set(name, value); }

  // P6: the draw, bake and loose-mask pipelines for the gates' values now. A set of values not built yet throws SpecializationMiss; the async
  // callers (renderChunk, timeBake, timeDraw) build it and run again. The check at the end of draw() catches a gate that changed between the
  // bake's encode and the draw's: both run with the uniform buffer as it is at submit.
  specKey() {
    const parts = this.specParts, slots = this.rockSlots(), values = {...gateValues(parts.frag, this.uniformView, slots), ...gateValues(parts.bake, this.uniformView, slots)};
    return {key: gateKey(values, parts.keyOrder), values};
  }
  specialized(kind) {
    const state = this.specKey(), entry = this.specCache.get(state.key);
    if (!entry) throw new SpecializationMiss(state);
    this.specUsed.push(state.key);
    return entry[kind];
  }
  specCheck() {
    const state = this.specKey();
    if (this.specUsed.some(k => k !== state.key)) throw new SpecializationMiss(state);
  }
  get drawPipeline() { return this.specialized('draw'); }
  get bakePipeline() { return this.specialized('bake'); }
  get loosePipeline() { return this.specialized('loose'); }
  // The voxel solid's and rock weather's passes for the rockMask now (engine-common.wgsl), from `built` (mask -> passes); a miss builds them
  // with the draw's and the bake's pipelines (specialize) and the work runs again.
  rockPasses(built) {
    const passes = built?.[this.rockMask()];
    if (!passes) throw new SpecializationMiss(this.specKey());
    return passes;
  }
  async specialize({key, values}) {
    const rock = performance.now();
    await Promise.all([this.voxel.build(values.rockMask), this.rockWeather.build(values.rockMask)]);
    this.specStats.rockMs = (this.specStats.rockMs ?? 0) + performance.now() - rock;
    if (this.specCache.has(key)) return;
    if (!this.specBuilding.has(key)) {
      const {vertModule, fragModule, bakeModule, frag, bake} = this.specParts, device = this.device, start = performance.now();
      const pick = gates => Object.fromEntries([...gates.keys()].map(id => [id, values[id]]));
      const fragment = {module: fragModule, entryPoint: 'fragmentMain', targets: [{format: this.format}], constants: pick(frag)};
      const compute = entryPoint => ({module: bakeModule, entryPoint, constants: pick(bake)});
      this.specBuilding.set(key, Promise.all([
        device.createRenderPipelineAsync({label: 'terrain', layout: this.drawPipelineLayout,
          vertex: {module: vertModule, entryPoint: 'vertexMain'},
          fragment, primitive: {topology: 'triangle-list', cullMode: 'none'}}),
        device.createComputePipelineAsync({label: 'relief bake', layout: this.bakePipelineLayout, compute: compute('bakeMain')}),
        device.createComputePipelineAsync({label: 'loose mask', layout: this.bakePipelineLayout, compute: compute('looseMain')})]).then(([draw, bake, loose]) => {
        if (this.specCache.size >= 24) this.specCache.delete(this.specCache.keys().next().value);
        this.specCache.set(key, {draw, bake, loose});
        this.specStats.built++; this.specStats.ms += performance.now() - start;
      }).finally(() => this.specBuilding.delete(key)));
    }
    await this.specBuilding.get(key);
  }
  // Runs `work` (which encodes and submits with the pipelines above); a miss builds the pipelines and runs it again.
  async withPipelines(work) {
    for (let attempt = 0; ; attempt++) {
      this.specUsed = [];
      try { return await work(); }
      catch (error) {
        if (!(error instanceof SpecializationMiss) || attempt >= 4) throw error;
        await this.specialize(error.state);
      }
    }
  }

  flushUniforms() {
    if (!this.uniformsDirty) return;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);
    this.uniformsDirty = false;
  }

  // Group 0 with the fields (draw) or the routes (bake) at binding 6.
  commonBindGroup(kind) {
    return this.bindGroups[kind] ??= this.device.createBindGroup({label: kind, layout: this.commonLayout, entries: [
      {binding: 0, resource: {buffer: this.uniformBuffer}},
      ...[this.heightTexture, this.textures.noise.texture].map((t, i) => ({binding: i + 1, resource: t.createView()})),
      {binding: 4, resource: this.gridTexture.createView({dimension: '2d-array'})},
      {binding: 6, resource: (kind === 'bake'||kind==='rock-weather' ? this.routeTexture : this.fieldsTexture).createView()},
      {binding: 7, resource: this.linearClamp}, {binding: 8, resource: this.linearRepeat},
      {binding: 9, resource: this.maskTexture.createView({dimension: '2d-array'})},
      {binding:10,resource:(kind==='rock-weather'?this.rockWeather.empty:(this.rockWeather.final??this.rockWeather.empty)).createView()},
      {binding:11,resource:(kind==='rock-weather'?this.rockWeather.empty:(this.rockWeather.source??this.rockWeather.empty)).createView()},
      {binding:12,resource:(kind==='rock-weather'?this.rockWeather.empty:(this.rockWeather.rim??this.rockWeather.empty)).createView()}]});
  }

  // Group 1: the plain's tiles, the waters, the palette and the generated materials.
  materialBindGroup() {
    return this.bindGroups.materials ??= this.device.createBindGroup({label: 'materials', layout: this.materialLayout, entries: [
      {binding: 0, resource: this.textures.grass.view}, {binding: 1, resource: this.textures.grass.sampler},
      {binding: 18, resource: this.textures.palette.view}, {binding: 19, resource: this.generated.view}]});
  }

  // The six placement rows of a world whose table has no `placement` block (engine-frag.wgsl landPlace reads them), from the world's
  // material and its transition. Green's rows are materials/green.json's.
  placementRows(variant) {
    const material = this.config.material || {};
    const soil = variant.get('transition') === 'soil', mineral = variant.get('transition') === 'mineral';
    const threshold = material.rockSlope ?? 1.145, feather = material.rockFeather ?? 0.43;
    // The slope score: slope, noise, wear (with its tap) on the first row; the soil's slope, noise and wear on the second.
    const r0 = [0.55, 0.45, 0.28, 5], r1 = [soil ? 0.80 : 0.25, soil ? 0.70 : 0, 0.55, 10];
    return [r0, r1, [threshold - feather * 0.5, threshold + feather * 0.5, 0, 0],
      [0.2, soil ? 18 : 1e9, 18, 28], material.rockyCoasts ? [-1e4, -1e3, 0, 0] : [12, 36, 0, 0], [0.45, 0.9, mineral ? 0.45 : 0, mineral ? 1.4 : 0]];
  }
  // The draw's uniform table: only the six placement rows are read, at PLACEMENT_ROW. A table with a `placement` block gives them
  // (Green's); every other table leaves them to the world's material, as the world's placement always was.
  placementTable(variant) {
    const rows = this.materialData?.placement ? tablePlacementRows(this.materialData) : this.placementRows(variant);
    return [...Array.from({length: PLACEMENT_ROW}, () => [0, 0, 0, 0]), ...rows, ...groundCoverRows(this.config.material?.groundCover,variant,this.colorOverrides||{},this.colorOverrides?.ground||this.means?.ground)];
  }

  // H4 round 2: one generated layer at one level as RGBA bytes (a check of the pass against the images it replaced; not used by the draw).
  async readGenerated(layer, level = 0) {
    const size = GENERATED_SIZE >> level, row = Math.ceil(size * 4 / 256) * 256;
    const buffer = this.device.createBuffer({size: row * size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ});
    const encoder = this.device.createCommandEncoder();
    encoder.copyTextureToBuffer({texture: this.generated.texture, mipLevel: level, origin: [0, 0, layer]}, {buffer, bytesPerRow: row}, [size, size, 1]);
    this.device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const mapped = new Uint8Array(buffer.getMappedRange()), out = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) out.set(mapped.subarray(y * row, y * row + size * 4), y * size * 4);
    buffer.destroy();
    return {size, data: Array.from(out)};
  }

  // What the startup generation took, in ms: the noise (CPU), the palette lookup and the materials (GPU), and the wall time of all three.
  get startupParts() { return {noise: this.noiseMs, palette: this.paletteMs, materials: this.startupMs, total: this.generationMs}; }

  // H4 item 2: the land materials of materials/green.json made on the GPU, once at startup and again when the table changes.
  // One layer per material, GENERATED_SIZE px square, MIP levels halving down to 8 px; level L is made with a footprint of 2^L
  // (engine-materials.wgsl). Returns the milliseconds from submit to the GPU finishing.  All four materials are always made.
  async makeMaterials() {
    const device = this.device, size = GENERATED_SIZE, levels = GENERATED_LEVELS, layers = this.materialData.order.length;
    const start = performance.now();
    if (!this.materialPipeline) {
      const module = device.createShaderModule({label: 'engine-materials.wgsl', code: this.materialsSource});
      const errors = (await module.getCompilationInfo()).messages.filter(m => m.type === 'error');
      if (errors.length) throw new Error('nanolathe: engine-materials.wgsl does not compile:\n' + errors.map(e => `${e.lineNum}:${e.linePos} ${e.message}`).join('\n'));
      this.materialPipeline = await device.createComputePipelineAsync({label: 'materials', layout: 'auto', compute: {module, entryPoint: 'makeMaterial'}});
      this.ditherPipeline = await device.createComputePipelineAsync({label: 'material dither', layout: 'auto', compute: {module, entryPoint: 'makeDither'}});
    }
    if (!this.generated) {
      const texture = device.createTexture({label: 'generated materials', size: [size, size, layers], format: 'rgba8unorm', mipLevelCount: levels,
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC});
      this.generated = {texture, view: texture.createView({dimension: '2d-array'})};
    }
    const rows = Float32Array.from(materialRows(this.materialData).flat());
    const table = device.createBuffer({size: rows.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST});
    device.queue.writeBuffer(table, 0, rows);
    const encoder = device.createCommandEncoder({label: 'materials'});
    const params = [];
    for (let level = 0; level < levels; level++) {
      const buffer = device.createBuffer({size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
      device.queue.writeBuffer(buffer, 0, new Float32Array([size, 2 ** level, 0, 0]));
      params.push(buffer);
      const pass = encoder.beginComputePass({label: 'materials level ' + level});
      pass.setPipeline(this.materialPipeline);
      pass.setBindGroup(0, device.createBindGroup({layout: this.materialPipeline.getBindGroupLayout(0), entries: [
        {binding: 0, resource: {buffer: table}},
        {binding: 1, resource: this.generated.texture.createView({dimension: '2d-array', baseMipLevel: level, mipLevelCount: 1})},
        {binding: 2, resource: {buffer: buffer}},
        {binding: 3, resource: this.generated.texture.createView({dimension: '2d-array', baseMipLevel: level ? level - 1 : 1, mipLevelCount: 1})}]}));
      const n = Math.ceil(size / 2 ** level / 8);
      pass.dispatchWorkgroups(n, n, layers);
      pass.end();
      if (level === 0) {
        // A dithered material's level 0 (engine-materials.wgsl makeDither): dot diffusion, one dispatch per class of the 8 x 8 matrix, in
        // order; each pass gathers the errors the lower classes left in ditherErr. The levels above box-mean it.
        const err = device.createBuffer({size: size * size * 16 * layers, usage: GPUBufferUsage.STORAGE});
        const dither = encoder.beginComputePass({label: 'materials dither'});
        dither.setPipeline(this.ditherPipeline);
        const n = Math.ceil(size / 8 / 8);
        for (let cls = 0; cls < 64; cls++) {
          const pass = device.createBuffer({size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
          device.queue.writeBuffer(pass, 0, new Float32Array([size, 1, cls, 0]));
          params.push(pass);
          dither.setBindGroup(0, device.createBindGroup({layout: this.ditherPipeline.getBindGroupLayout(0), entries: [
            {binding: 0, resource: {buffer: table}},
            {binding: 1, resource: this.generated.texture.createView({dimension: '2d-array', baseMipLevel: 0, mipLevelCount: 1})},
            {binding: 2, resource: {buffer: pass}}, {binding: 6, resource: {buffer: err}}]}));
          dither.dispatchWorkgroups(n, n, layers);
        }
        dither.end();
        params.push(err);
      }
    }
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    table.destroy(); params.forEach(b => b.destroy());
    return this.startupMs = performance.now() - start;
  }
  // GPU time of one pass from timestamp queries, read back without
  // stalling; at most three in flight, as the WebGL timer queries were.
  timer() {
    if (!this.device.features.has('timestamp-query')) return null;
    let slot = this.timers.find(t => !t.busy);
    if (!slot && this.timers.length >= 3) return null;
    if (!slot) {
      slot = {querySet: this.device.createQuerySet({type: 'timestamp', count: 2}),
        resolve: this.device.createBuffer({size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC}),
        read: this.device.createBuffer({size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST})};
      this.timers.push(slot);
    }
    slot.busy = true;
    return {
      timestampWrites: {querySet: slot.querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1},
      encode: encoder => {
        encoder.resolveQuerySet(slot.querySet, 0, 2, slot.resolve, 0);
        encoder.copyBufferToBuffer(slot.resolve, 0, slot.read, 0, 16);
      },
      // An encoder that is never submitted (a SpecializationMiss retry) gives its slot back.
      release: () => { slot.busy = false; },
      // After submit: resolves to the pass's GPU milliseconds.
      result: () => slot.read.mapAsync(GPUMapMode.READ).then(() => {
        const [begin, end] = new BigUint64Array(slot.read.getMappedRange());
        slot.read.unmap();
        slot.busy = false;
        return end > begin ? Number(end - begin) / 1e6 : 0;
      }, () => { slot.busy = false; return null; }),
    };
  }

  // The world's sun, not normalized: from the west (the east for the alternate light), sunTilt scaling its north-south component (1: as
  // before; Moon 0, lit from due west as every retail Lunar map measures), Sun height degrees above the horizon. Each world's Sun height is the
  // height this light had before it was a control (sculpt.py sun_height): z comes out .82 to within a bit, and the uniforms are the same.
  sunVector(light = 'original') {
    const tilt = this.variant.has('sunTilt') ? Number(this.variant.get('sunTilt')) : 1;
    const x = light === 'alternate' ? 0.72 : -0.72, y = 0.38 * tilt;
    // Held to the control's range (20 to 75): a lower sun's shadows need a height grid apron (sculpt-chunk-renderer.js reaches) that pushes even
    // a 32 px chunk past a 128 MB budget at 15 degrees.
    const height = this.variant.has('sunHeight') ? Math.min(75, Math.max(20, Number(this.variant.get('sunHeight')))) : null;
    return [x, y, height === null ? 0.82 : Math.hypot(x, y) * Math.tan(height * Math.PI / 180)];
  }

  async draw({clay = false, light = 'original', detail = this.config.material?.surfaceRelief ?? 1, ring = .85, ringSpread = .65, ringVariation = .7, materialWeathering = this.config.material?.materialWeathering ?? 0, transitionDetail = this.config.material?.transitionDetail ?? .65, exact = false} = {}) {
    const start = performance.now(), device = this.device;
    this.i('uClay', clay);
    const weatherAmount=materialWeathering;
    this.f('uMaterialWeathering', weatherAmount);
    this.f('uTransitionDetail', transitionDetail);
    this.i('uMaterialReady', this.materialReady);
    const useBody=this.transitionBody && this.materialReady && weatherAmount>0;
    this.i('uTransitionBody', Boolean(useBody));
    this.f('uDetail', this.variant.get('relief') === 'base' ? 0 : detail);
    this.f('uRingAmount', this.layers.has('ring') ? ring : 0);
    this.f('uRingSpread', ringSpread);
    this.f('uRingVariation', ringVariation);
    this.i('uQuantize', (this.variant.get('palette') || 'nearest') !== 'off');
    this.i('uPaletteMix', Number(this.variant.get('paletteMix')) > 0.5);
    this.f('uShoreEdge', Number(this.variant.get('shoreEdge')) || 0);
    this.f('uCrystalGrain', Number(this.variant.get('crystalGrain')) || 0);
    this.f('uCrystalFace', this.variant.has('crystalFace') ? Number(this.variant.get('crystalFace')) : 1);
    this.f('uCrystalInk', Number(this.variant.get('crystalInk')) || 0);
    this.f('uCrystalTone', this.variant.has('crystalTone') ? Number(this.variant.get('crystalTone')) : 1);
    let sun = this.sunVector(light);
    this.worldSun = sun.map(v => v / Math.hypot(...sun));   // the map's own sun, as exports draw it (sculpt-features.js lights the features by it)
    // Review sun (card H1): the page's ?sun=<azimuth> turns the light about the vertical by that many degrees, for looking at the relief
    // from other directions (ink keeps its shade, geometry does not); its height stays Sun height's. Exports never take it (exact).
    const review = exact ? null : /^\s*(-?[\d.]+)\s*$/.exec(this.variant.get('sun') || '');
    if (review) {
      const turn = Math.atan2(sun[1], sun[0]) + (Number(review[1]) || 0) * Math.PI / 180, flat = Math.hypot(sun[0], sun[1]);
      sun = [Math.cos(turn) * flat, Math.sin(turn) * flat, sun[2]];
    }
    const length = Math.hypot(...sun);
    this.v('uLight', sun.map(v => v / length));
    // Lit crack walls are baked for this light.
    const sunKey = sun.join(',');
    if (this.sunKey !== sunKey) { this.sunKey = sunKey; this.sun = sun.map(v => v / length); this.fieldsDirty = true; }
    const encoder = device.createCommandEncoder({label: 'terrain'});
    // P6: a SpecializationMiss abandons this encoder, its bake included, so the fields go back to unbaked and the retry bakes again.
    const dirty = this.fieldsDirty;
    let drawPipeline;
    try {
      if (dirty) this.bakeFields(encoder);
      // Looked up after the bake, which sets some of the gates' uniforms.
      drawPipeline = this.drawPipeline;
      this.specCheck();
    } catch (error) { this.fieldsDirty = dirty; throw error; }
    this.flushUniforms();device.queue.submit([encoder.finish()]);
    if(!this.voxelColor||this.voxelColor.width!==this.canvas.width||this.voxelColor.height!==this.canvas.height){
      if(this.voxelColor)this.release(this.voxelColor);
      this.voxelColor=device.createTexture({label:'voxel terrain color',size:[this.canvas.width,this.canvas.height],format:this.format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
      this.track(this.voxelColor,'voxel terrain color',this.canvas.width*this.canvas.height*4,'working');
    }
    const clear=this.means.ground||[.19,.28,.14],timers=[];
    await this.voxel.render((commands,volume,rect,first)=>{
      const timer=this.timer();if(timer)timers.push(timer);
      const pass=commands.beginRenderPass({label:'voxel terrain',colorAttachments:[{view:this.voxelColor.createView(),clearValue:{r:clear[0],g:clear[1],b:clear[2],a:1},loadOp:first?'clear':'load',storeOp:'store'}],
        timestampWrites:timer?.timestampWrites});
      pass.setPipeline(drawPipeline);pass.setScissorRect(...rect.map(Math.round));
      pass.setBindGroup(0,this.commonBindGroup('draw'));pass.setBindGroup(1,this.materialBindGroup());pass.setBindGroup(2,volume);pass.draw(3);pass.end();timer?.encode(commands);
    });
    // Keep intermediate pieces in a persistent texture: a canvas presentation
    // image expires at the next browser frame while allocation readback yields.
    const present=device.createCommandEncoder({label:'present voxel terrain'});
    present.copyTextureToTexture({texture:this.voxelColor},{texture:this.context.getCurrentTexture()},[this.canvas.width,this.canvas.height]);device.queue.submit([present.finish()]);
    this.gpuResult=Promise.all(timers.map(t=>t.result())).then(values=>{const ms=values.reduce((a,b)=>a+(b??0),0);this.lastGPU=ms;return ms;});
    return {milliseconds:performance.now()-start,gpuMilliseconds:this.lastGPU};
  }

  // Surface knobs read from the variant; callable again after a change.
  applyKnobs() {
    const variant = this.variant;
    // Placement is live state too: refreshing only scalar uniforms left these
    // controls frozen at startup in the generated materials.
    this.set('uMaterialTable', this.placementTable(variant));
    this.f('uMaterialFoot', variant.has('materialFoot') ? Math.max(1, Number(variant.get('materialFoot'))) : 1);   // H3: ?materialFoot=4 trials a quarter-resolution draw
    this.f('uMossFromGround', variant.has('moss') ? Number(variant.get('moss')) : 0.0);
    this.f('uLightCap', variant.has('lightCap') ? Number(variant.get('lightCap')) : 1.13);
    this.f('uShadeDepth', variant.has('shadeDepth') ? Number(variant.get('shadeDepth')) : 1.0);
    this.f('uAmbient', variant.has('ambient') ? Number(variant.get('ambient')) : 0.42);
    this.f('uSlopeMarks', variant.has('slopeMarks') ? Number(variant.get('slopeMarks')) : 0);
    this.f('uWrinkles', variant.has('wrinkles') ? Number(variant.get('wrinkles')) : 0);
    this.f('uCrystalSeam', variant.has('crystalSeam') ? Number(variant.get('crystalSeam')) : 0);
    // Shine and roughness (card E2): per material gloss, sharpness, roughness amplitude and scale. All gloss and roughness 0 skips the shading.
    const shine = ['Ground', 'Slope', 'Rock', 'Sand', 'Crystal'].map(m => {
      const knob = (suffix, fallback) => variant.has(`shine${m}${suffix}`) ? Number(variant.get(`shine${m}${suffix}`)) : fallback;
      return [knob('', 0), knob('Sharp', 24), knob('Rough', 0), knob('Scale', 6)];
    });
    // With no slope cover the slope group has no share, so its gloss does not wake the pass (worldControlRequirement says the same).
    const slopeShare = (!groundCoverOn(this.config.material?.groundCover, variant) && Number(variant.get('slopeTexture') ?? 0.3) > 0) || Boolean(this.config.material?.slopeSand);
    this.i('uShineOn', Number(variant.get('faceWet')??0)>0 || Number(variant.get('wetGround')??0)>0 || shine.some((m, i) => (i !== 1 || slopeShare) && (m[0] > 0 || m[2] > 0)));
    this.f('uShineStretch', variant.has('shineStretch') ? Number(variant.get('shineStretch')) : 1);
    this.f('uShineWhite', variant.has('shineWhite') ? Number(variant.get('shineWhite')) : 0.35);
    // The rock's row is its recipe's (Rock.shineRock: slot 0's here); row 2 of the table is unused.
    this.set('uShine', shine.map((m, i) => i === 2 ? [0, 0, 0, 0] : m));
    this.set('uShineRock', shine[2]);
    // E10 (Lava): crease at the foot of each bank step; shine only from this slope up (0: off).
    this.f('uLayerCrease', variant.has('layerCrease') ? Number(variant.get('layerCrease')) : 0);
    this.f('uShineSlopeGate', variant.has('shineSlopeGate') ? Number(variant.get('shineSlopeGate')) : 0);
    // H1 (Green): close shadow and cavity occlusion (0: off).
    this.f('uCloseShadow', variant.has('closeShadow') ? Number(variant.get('closeShadow')) : 0);
    this.f('uCavity', variant.has('cavity') ? Number(variant.get('cavity')) : 0);
    // G5 (Lava): hill rock.
    for (const [name, fallback] of [['lavaCrust', 0], ['lavaPillow', 34], ['lavaChip', 5.5], ['lavaVeins', 0], ['lavaCalm', 0.6], ['lavaDusk', 0]]) {
      this.f('u' + name[0].toUpperCase() + name.slice(1), variant.has(name) ? Number(variant.get(name)) : fallback);
    }
    this.f('uShadeBlue', variant.has('shadeBlue') ? Number(variant.get('shadeBlue')) : 0);
    this.f('uFrostWet', variant.has('frostWet') ? Number(variant.get('frostWet')) : 0);
    // E7 (Crystal): shallow water's crystal mosaic.
    this.f('uCrystalShallow', variant.has('crystalShallow') ? Number(variant.get('crystalShallow')) : 0);
    this.f('uCrystalShallowPx', variant.has('crystalShallowPx') ? Number(variant.get('crystalShallowPx')) : 10);
    // G7 (Crystal): the craters' web and light; the defaults leave every world as it was.
    this.f('uCrystalCraterWeb', variant.has('crystalCraterWeb') ? Number(variant.get('crystalCraterWeb')) : 0);
    this.f('uCrystalCraterWebPx', variant.has('crystalCraterWebPx') ? Number(variant.get('crystalCraterWebPx')) : 14);
    this.f('uCrystalCraterWobble', variant.has('crystalCraterWobble') ? Number(variant.get('crystalCraterWobble')) : 0);
    this.f('uCrystalCraterGap', variant.has('crystalCraterGap') ? Number(variant.get('crystalCraterGap')) : 0);
    this.f('uCrystalCraterTone', variant.has('crystalCraterTone') ? Number(variant.get('crystalCraterTone')) : 0);
    this.f('uCrystalCraterLight', variant.has('crystalCraterLight') ? Number(variant.get('crystalCraterLight')) : 1);
    this.f('uCrystalSeamEnd', variant.has('crystalSeamEnd') ? Number(variant.get('crystalSeamEnd')) : 0.74);
    this.f('uCrystalShallowInk', variant.has('crystalShallowInk') ? Number(variant.get('crystalShallowInk')) : 0.55);
    // E11: shallow water round 2; every default is the earlier look.
    this.f('uShelfWander', variant.has('shelfWander') ? Number(variant.get('shelfWander')) : 0);
    this.f('uStepSoftPx', variant.has('stepSoftPx') ? Number(variant.get('stepSoftPx')) : 1);
    this.f('uRingContrast', variant.has('ringContrast') ? Number(variant.get('ringContrast')) : 0);
    this.f('uRingCount', variant.has('ringCount') ? Number(variant.get('ringCount')) : 7);
    this.f('uRingSize', variant.has('ringSize') ? Number(variant.get('ringSize')) : 1);
    this.f('uBedFlat', variant.has('bedFlat') ? Number(variant.get('bedFlat')) : 0);
    this.f('uSandCrown', variant.has('sandCrown') ? Number(variant.get('sandCrown')) : 0);
    this.f('uFlatBank', variant.has('flatBank') ? Number(variant.get('flatBank')) : 0.0);
    this.f('uDither', variant.has('dither') ? Number(variant.get('dither')) : 2.0);
    this.f('uFlatShadow', variant.has('flatShadow') ? Number(variant.get('flatShadow')) : 0.0);
    this.f('uFlatOcclusion', variant.has('flatOcclusion') ? Number(variant.get('flatOcclusion')) : 0.4);
    this.f('uSandEdge', variant.has('sandEdge') ? Number(variant.get('sandEdge')) : 1.0);
    this.f('uSandLight', variant.has('sandLight') ? Number(variant.get('sandLight')) : 0.25);
    this.f('uBeachWidth', variant.has('beachWidth') ? Number(variant.get('beachWidth')) : 1.0);
    this.f('uFaceFill', variant.has('faceFill') ? Number(variant.get('faceFill')) : 0);
    this.f('uRockCrown', variant.has('rockCrown') ? Number(variant.get('rockCrown')) : 0);
    this.f('uStrata', variant.has('strata') ? Number(variant.get('strata')) : 0);
    this.f('uStrataContrast', variant.has('strataContrast') ? Number(variant.get('strataContrast')) : 0.6);
    this.f('uStrataGrain', variant.has('strataGrain') ? Number(variant.get('strataGrain')) : 1);
    this.f('uBandWater', variant.has('bandWater') ? Number(variant.get('bandWater')) : 0);
    this.f('uSandGrass', variant.has('sandGrass') ? Number(variant.get('sandGrass')) : 0.6);
    this.f('uSandDust', variant.has('sandDust') ? Number(variant.get('sandDust')) : 0.5);
    this.f('uSandGrain', variant.has('sandGrain') ? Number(variant.get('sandGrain')) : 0.8);
    this.i('uGroundMode', this.groundTiled ? 1 : 0);
    this.f('uGroundContrast', variant.has('groundContrast') ? Number(variant.get('groundContrast')) : 1);
    this.i('uGroundBorrowed', this.groundSource() !== this.ownGround);
    this.i('uGroundLayer', this.materialData ? this.materialData.order.indexOf('quilt') : -1);   // H14b: a table's quilted plain is the layer after the others
    this.i('uGroundTiles', variant.has('groundTiles') ? Number(variant.get('groundTiles')) : 16);
    this.f('uTileShift', Math.floor(this.config.baseHeight / 2));   // the export's tile grid in screen rows (TA's projection offset; requiredRegion's shift)
    this.f('uPool', groundPool(this.config.material));   // card tilepool: the period level ground repeats with
    this.f('uCrispShore', variant.has('crispShore') ? Number(variant.get('crispShore')) : 1.0);
    this.f('uBankRock', variant.has('bankRock') ? Number(variant.get('bankRock')) : 0.25);
    this.f('uWaterSoft', variant.has('waterSoft') ? Number(variant.get('waterSoft')) : 32);
    this.f('uLandDither', variant.has('landDither') ? Number(variant.get('landDither')) : 0.25);
    this.f('uCrackDark', variant.has('crackDark') ? Number(variant.get('crackDark')) : 0.75);
    this.f('uSlopeTexture', variant.has('slopeTexture') ? Number(variant.get('slopeTexture')) : 0.3);
    this.f('uShallowDepth', variant.has('shallowDepth') ? Number(variant.get('shallowDepth')) : this.config.material?.shallowDepth ?? 2);
    this.f('uDeepDepth', variant.has('deepDepth') ? Number(variant.get('deepDepth')) : this.config.material?.deepDepth ?? 42);
    // Water looks (card E1): every default is the earlier water.
    this.f('uBedTint', variant.has('bedTint') ? Number(variant.get('bedTint')) : 0.85);
    this.v('uShallowMean', (this.config.water?.shallowMeanRGB || this.config.water?.shallowRGB || [60, 115, 163]).map(v => v / 255));
    this.f('uBedBright', variant.has('bedBright') ? Number(variant.get('bedBright')) : 1);
    this.f('uRingFade', variant.has('ringFade') ? Number(variant.get('ringFade')) : 0);
    this.f('uHillLight', variant.has('hillLight') ? Number(variant.get('hillLight')) : 1);
    this.f('uBedContrast', variant.has('bedContrast') ? Number(variant.get('bedContrast')) : 1);
    this.f('uDeepEdge', variant.has('deepEdge') ? Number(variant.get('deepEdge')) : 0);
    // Card E8 (Painted Desert); 0 is every world as it was.
    this.f('uBaseBand', variant.has('baseBand') ? Number(variant.get('baseBand')) : 0);
    this.f('uBaseBandLow', variant.has('baseBandLow') ? Number(variant.get('baseBandLow')) : 4);
    this.f('uBaseBandHigh', variant.has('baseBandHigh') ? Number(variant.get('baseBandHigh')) : 6.5);
    this.f('uBaseBandWander', variant.has('baseBandWander') ? Number(variant.get('baseBandWander')) : 1);
    this.f('uBaseBandGaps', variant.has('baseBandGaps') ? Number(variant.get('baseBandGaps')) : 0.45);
    // Card G4 (Painted Desert); 0 is every world as it was.
    this.f('uDesertCapFlat', variant.has('desertCapFlat') ? Number(variant.get('desertCapFlat')) : 0);
    // E9 (Green rock faces).
    this.f('uShineOutside', variant.has('shineOutside') ? Number(variant.get('shineOutside')) : 1);
    // E6: shine roughness gate and headroom (0: the earlier shine exactly).
    this.f('uShineGate', variant.has('shineGate') ? Number(variant.get('shineGate')) : 0);
    this.f('uShineHeadroom', variant.has('shineHeadroom') ? Number(variant.get('shineHeadroom')) : 0);
    this.f('uPockmark', variant.has('pockmark') ? Number(variant.get('pockmark')) : 0);
    this.f('uPockSize', variant.has('pockSize') ? Number(variant.get('pockSize')) : 5);
    // G8 (Moon).
    this.f('uMoonCups', variant.has('moonCups') ? Number(variant.get('moonCups')) : 0);
    this.f('uMoonCupSize', variant.has('moonCupSize') ? Number(variant.get('moonCupSize')) : 5.5);
    this.f('uMoonCupDepth', variant.has('moonCupDepth') ? Number(variant.get('moonCupDepth')) : 1.4);
    this.f('uCupStretch', variant.has('cupStretch') ? Number(variant.get('cupStretch')) : 1);
    this.f('uMoonRibs', variant.has('moonRibs') ? Number(variant.get('moonRibs')) : 0);
    this.f('uMoonRibDepth', variant.has('moonRibDepth') ? Number(variant.get('moonRibDepth')) : 1);
    this.f('uMoonRibDark', variant.has('moonRibDark') ? Number(variant.get('moonRibDark')) : 0);
    this.f('uMoonFolds', variant.has('moonFolds') ? Number(variant.get('moonFolds')) : 0);
    this.f('uMoonFoldSpacing', variant.has('moonFoldSpacing') ? Number(variant.get('moonFoldSpacing')) : .9);
    this.f('uIceCrystal', variant.has('iceCrystal') ? Number(variant.get('iceCrystal')) : 0);
    this.f('uIceCrest', variant.has('iceCrest') ? Number(variant.get('iceCrest')) : 0);
    // G3: the fringe's offset copies (ringShift 0: the earlier concentric lines).
    this.f('uRingShift', variant.has('ringShift') ? Number(variant.get('ringShift')) : 0);
    this.f('uRingShiftDir', variant.has('ringShiftDir') ? Number(variant.get('ringShiftDir')) : 315);
    this.f('uRingScatter', variant.has('ringScatter') ? Number(variant.get('ringScatter')) : 0.5);
    this.f('uRingWobble', variant.has('ringWobble') ? Number(variant.get('ringWobble')) : 3);
    this.f('uRingLobe', variant.has('ringLobe') ? Number(variant.get('ringLobe')) : 22);
    this.f('uRingFill', variant.has('ringFill') ? Number(variant.get('ringFill')) : 0);
    this.f('uRingPatch', variant.has('ringPatch') ? Number(variant.get('ringPatch')) : 0);
    this.f('uRingPatchSize', variant.has('ringPatchSize') ? Number(variant.get('ringPatchSize')) : 120);
    this.f('uRingTone', variant.has('ringTone') ? Number(variant.get('ringTone')) : 0);
    // G6: Ice blocks and mesas (0: the earlier look exactly).
    this.f('uIceSoft', variant.has('iceSoft') ? Number(variant.get('iceSoft')) : 0);
    this.f('uIceSnow', variant.has('iceSnow') ? Number(variant.get('iceSnow')) : 0);
    this.f('uIceFall', variant.has('iceFall') ? Number(variant.get('iceFall')) : 0);
    this.f('uIceApron', variant.has('iceApron') ? Number(variant.get('iceApron')) : 0);
    this.f('uIceFrost', variant.has('iceFrost') ? Number(variant.get('iceFrost')) : 0);
    // G1: shallow water round 3; every default is the earlier look.
    this.f('uShoalRag', variant.has('shoalRag') ? Number(variant.get('shoalRag')) : 0);
    this.f('uShoalStairs', variant.has('shoalStairs') ? Number(variant.get('shoalStairs')) : 0);
    this.f('uShoalShoreSoft', variant.has('shoalShoreSoft') ? Number(variant.get('shoalShoreSoft')) : 0);
    // Low ground: its tint and reach (0: none, as before); its color is set with the others (setColors).
    this.f('uLowTint', variant.has('lowTint') ? Number(variant.get('lowTint')) : 0);
    this.f('uLowReach', variant.has('lowReach') ? Number(variant.get('lowReach')) : 6);
    this.f('uLowGrain', variant.has('lowGrain') ? Number(variant.get('lowGrain')) : 1);
    this.f('uLooseKnoll', variant.has('looseKnoll') ? Number(variant.get('looseKnoll')) : 0);
    this.f('uGougeWeb', variant.has('gougeWeb') ? Number(variant.get('gougeWeb')) : 0);
    this.f('uCreaseShade', variant.has('creaseShade') ? Number(variant.get('creaseShade')) : 0);
    this.writeRocks();
    this.fieldsDirty = true;
  }

  variantNumber(key, fallback) { const x = Number(this.variant.get(key)); return Number.isFinite(x) && this.variant.has(key) ? x : fallback; }

  // H5: a shader that pastes the common source under EROSION, as erosion.wgsl does.
  preprocessShader(source) { return preprocess(source, this.commonSource, new Set(['EROSION'])); }

  // H2, H16 rock column. The world's table (config.column, from materials/<world>.json; sculpt-column.js). No sections: no column.
  // Erosion reads the same uniforms, so the draw and the pass share one column.
  setColumn() {
    const column = this.config.column, v = this.variant;
    const number = (key, fallback) => { const x = Number(v.get(key)); return Number.isFinite(x) && v.has(key) ? x : fallback; };
    const {beds, starts, bands} = columnRows(column, this.config.variant);
    // Refinement can run before any relief bake; its column offset must not depend on the last displayed view.
    this.set('uBedDip', number('bedDip', 0));
    this.set('uBedDipDir', number('bedDipDir', 90));
    this.set('uColumnContrast', number('columnContrast', 1));
    this.set('uColumnWander', column?.wander?.value ?? 0);
    this.set('uColumnTerrain', [...(column?.wander?.terrain || [0, 0, 0]), 0]);
    this.set('uColumnOrigin', column?.origin === 'plain' ? this.config.baseHeight - this.config.seaLevel : 0);
    this.set('uBandSpacing', bands[0]);
    this.set('uBandLine', bands[1]);
    this.writeRocks();
  }

  // Rock recipes (struct Rock in engine-common.wgsl) in slots 1 to 15, by slot: {knobs, column, colors}, knobs by their ROCK_KEYS names, column a
  // rock column block (sculpt-column.js) and colors {rock, beds} as '#rrggbb' (sculpt-rock-presets.js checkColors). Slot 0 is the world's own
  // rock: its numbers are the flat settings every address names (this.variant), its column config.column, its colors the world's (setColors).
  // A slot takes slot 0's number for any it does not set, slot 0's column if it has none, and slot 0's colors where its own are null. The slots given are the
  // ones in use: their maxima bound the passes that gather (writeRocks), and a second slot builds the pipelines that read any slot (rockMask).
  setRocks(rocks = new Map()) {
    const count = this.uniform.get('rock').count;
    for (const slot of rocks.keys()) if (!Number.isInteger(slot) || slot < 1 || slot >= count) throw new Error(`nanolathe: rock slot ${slot} is not 1 to ${count - 1}`);
    this.rocks = new Map(rocks);
    this.applyKnobs();
    this.setColumn();
  }
  rockSlots() { return [0, ...[...this.rocks.keys()].sort((a, b) => a - b)]; }
  // The pipelines' rockMask (engine-common.wgsl): 0 while slot 0 is the only rock in use, so every read is slot 0's at a fixed offset.
  rockMask() { return this.rocks.size ? 15 : 0; }
  // A recipe number of a slot as the uniforms hold it (after writeRocks).
  rockValue(slot, member) {
    const table = this.uniform.get('rock'), m = table.members.get(member), at = table.offset + slot * table.stride + m.offset;
    return m.kind === 'i' ? this.uniformView.getInt32(at, true) : this.uniformView.getFloat32(at, true);
  }
  // The largest of slot 0's number `own` (a knob's value) and the other slots' own settings of it: a reach over the rocks in use.
  rockMax(key, own) { return Math.max(own, ...[...this.rocks.values()].map(r => Number(r.knobs?.[key])).filter(Number.isFinite)); }
  // Slots 1-15 as copies of slot 0 (the world's rock, as applyKnobs, bakeFields and setColumn set it) under their own numbers; the pool of every
  // slot's rock column; and the maxima the passes that gather from other points read (debrisAny, runoffAny, debrisReachMax).
  writeRocks() {
    const table = this.uniform.get('rock'), bytes = new Uint8Array(this.uniformData);
    const own = columnRows(this.config.column, this.config.variant), beds = [...own.beds], starts = [...own.starts];
    this.set('uColumnFirst', 0);
    this.set('uColumnCount', own.starts.length);
    // Where level ground takes a recipe's beds (bedsFrom): the world's from its first section's start, as the gate always read it. A recipe
    // with beds of its own starts no lower than the world's second section: the world's lowest section is the plain's band (Desert's first 16
    // units, nearly all its plain-colored bed), and a recipe's beds start at 0, so they painted the ground at a stroke's foot, its talus a few
    // units over the plain, in their own colors. Its faces show its beds at every height.
    this.set('uBedsFrom', own.starts[0]?.[0] ?? 0);
    const band = own.starts[own.starts.length > 1 ? 1 : 0]?.[0] ?? 0;
    for (const [slot, rock] of this.rocks) {
      const at = table.offset + slot * table.stride;
      bytes.copyWithin(at, table.offset, table.offset + table.stride);
      for (const [key, value] of Object.entries(rock.knobs || {})) {
        const shine = SHINE_ROCK.indexOf(key), m = table.members.get(shine >= 0 ? 'shineRock' : key);
        if (m && m.kind === 'f' && Number.isFinite(Number(value))) this.uniformView.setFloat32(at + m.offset + Math.max(shine, 0) * 4, Number(value), true);
      }
      // Its own colors where it has them ('#rrggbb'): row 0 the rock's (a = 1, chosen), rows 1-5 its beds' slots; the rest stay slot 0's.
      const colors = table.members.get('rockColors'), row = (k, hex) => [1, 3, 5].forEach((i, c) => this.uniformView.setFloat32(at + colors.offset + k * 16 + c * 4, parseInt(hex.slice(i, i + 2), 16) / 255, true));
      if (rock.colors?.rock) { row(0, rock.colors.rock); this.uniformView.setFloat32(at + colors.offset + 12, 1, true); }
      rock.colors?.beds?.forEach((hex, k) => row(1 + k, hex));
      if (rock.colors?.absorb) { row(6, rock.colors.absorb); this.uniformView.setFloat32(at + colors.offset + 6 * 16 + 12, 1, true); }
      if (rock.column) {
        const rows = columnRows(rock.column, ''), shift = beds.length;
        this.uniformView.setInt32(at + table.members.get('columnFirst').offset, starts.length, true);
        this.uniformView.setInt32(at + table.members.get('columnCount').offset, rows.starts.length, true);
        this.uniformView.setFloat32(at + table.members.get('bedsFrom').offset, Math.max(rows.starts[0]?.[0] ?? 0, band), true);
        beds.push(...rows.beds); starts.push(...rows.starts.map(([start, first, n, period]) => [start, first + shift, n, period]));
      }
    }
    if (beds.length > this.uniform.get('columnBeds').count || starts.length > this.uniform.get('columnSections').count) throw new Error('nanolathe: the rock recipes\' columns are too large for the uniforms');
    this.set('uColumnBeds', beds);
    this.set('uColumnSections', starts);
    const slots = this.rockSlots(), max = key => Math.max(...slots.map(k => this.rockValue(k, key)));
    this.f('uDebrisAny', max('debrisAmount'));
    this.f('uRunoffAny', max('runoff'));
    this.f('uDebrisReachMax', max('debrisReach'));
    this.f('uShadowTintAny', max('shadowTint'));
    // Shine is drawn where any rock in use has gloss, roughness or wetness (applyKnobs decides it for slot 0 and the other materials).
    if (slots.some(k => k && (this.rockValue(k, 'faceWet') > 0 || Math.max(...[0, 2].map(c => this.uniformView.getFloat32(table.offset + k * table.stride + table.members.get('shineRock').offset + c * 4, true))) > 0))) this.i('uShineOn', 1);
    this.uniformsDirty = true;
  }

  // The bake's group 1 for the chunk's fields texture and the loose-stone mask.
  makeFieldsOut() {
    return this.device.createBindGroup({label: 'fields out', layout: this.fieldsLayout,
      entries: [{binding: 0, resource: this.fieldsTexture.createView()}, {binding: 1, resource: {buffer: this.looseBuffer}}]});
  }

  // Card P16: the loose-stone mask, computed once per cell of 4 px over the bake's window and the margin a stone reaches (see looseMain), so a
  // candidate reads one entry where the mask would take about 20 texture reads. Nothing runs while Supply is 0 and no scatter is painted.
  // A fed chunk's painted flags are written into the uniform buffer by the GPU (ChunkTerrainRenderer.flagPass), so the CPU copy of uScatterOn
  // is stale there: the pass runs, and looseMain's own test of u.scatterOn leaves every cell empty where nothing is painted.
  encodeLooseMask(encoder) {
    const supply = Math.max(this.uniformValue('uLooseSupply'),this.uniformValue('uDebrisAny'),this.uniformValue('uBoulders')), painted = this.gpuFlags || this.uniformValue('uScatterOn'), plants = this.uniformValue('uPlantsOn') > 0;
    if (!(supply > 0) && !painted && !plants) return;
    const [x0, y0, w, h] = this.bakeWindow;
    // Card P31: a plant's candidate lies up to 23 px (a shrub's cell and jitter) from the pixels it covers, the mask reads heights 8 px past its cell, and the apron adds 15.
    // Boulders: the largest class has a 32 px radius.
    const margin = Math.max(Math.ceil(3.6 * (this.uniformValue('uBoulders') > 0 ? 32 : Math.min(16, 3.3 * Math.max(...this.rockSlots().map(k => this.rockValue(k, 'looseSize')))))) + 4, plants ? PLANT_REACH : 0);
    const ox = Math.floor((x0 - margin) / 4), oy = Math.floor((y0 - margin) / 4);
    const nx = Math.ceil((w + 2 * margin) / 4) + 2, ny = Math.ceil((h + 2 * margin) / 4) + 2;
    if (nx * ny * 32 > this.looseBuffer.size) {
      this.release(this.looseBuffer);
      this.looseBuffer = this.device.createBuffer({label: 'loose mask', size: nx * ny * 32, usage: GPUBufferUsage.STORAGE});
      this.track(this.looseBuffer,'loose mask',this.looseBuffer.size,'loose');
      this.fieldsOut = this.makeFieldsOut();
    }
    this.v('uLooseGrid', [ox, oy, nx, ny]);
    const pass = encoder.beginComputePass({label: 'loose mask'});
    pass.setPipeline(this.loosePipeline);
    pass.setBindGroup(0, this.commonBindGroup('bake'));
    pass.setBindGroup(1, this.fieldsOut);
    pass.dispatchWorkgroups(Math.ceil(nx / 8), Math.ceil(ny / 8));
    pass.end();
  }

  uniformValue(name) {
    const field = this.uniform.get(name[1].toLowerCase() + name.slice(2));
    return field.kind === 'i' ? this.uniformView.getInt32(field.offset, true) : this.uniformView.getFloat32(field.offset, true);
  }
  // A rock slot's colors as the draw reads them, '#rrggbb': {rock, beds}, the rock's (its own, else the rock material's mean, as rockFlat) and
  // its five bed slots'. The World pane shows a preset's effective colors with them, and starts its own from the world's.
  slotColors(slot) {
    const table = this.uniform.get('rock'), at = table.offset + slot * table.stride + table.members.get('rockColors').offset;
    const row = k => [0, 1, 2, 3].map(c => this.uniformView.getFloat32(at + k * 16 + c * 4, true)), mean = this.uniform.get('rockMean');
    const hex = rgb => '#' + rgb.slice(0, 3).map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
    const own = row(0), rock = own[3] > 0.5 ? own : [0, 1, 2].map(c => this.uniformView.getFloat32(mean.offset + c * 4, true));
    // The absorption color: row 6 where chosen, else the rock's own hue at full strength (engine-frag.wgsl absorbFilter).
    const absorb = row(6), top = Math.max(rock[0], rock[1], rock[2], 0.02);
    return {rock: hex(rock), beds: [1, 2, 3, 4, 5].map(k => hex(row(k))), absorb: hex(absorb[3] > 0.5 ? absorb : rock.slice(0, 3).map(v => v / top))};
  }
  // The palette entry the draw's lookup gives a color, '#rrggbb' (engine-palette.wgsl rows 0-31: the nearest entry by rgb distance to the
  // color's point of the 32-level cube; the dither then mixes entries around it).
  paletteNearest(hex) {
    const colours = (this.materialData.palette?.entries ?? this.paletteArt).map(i => this.paletteColours[i]);
    const cube = [1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * 31 / 255) * 255 / 31);
    let best = colours[0], nearest = Infinity;
    for (const c of colours) { const d = (c[0] - cube[0]) ** 2 + (c[1] - cube[1]) ** 2 + (c[2] - cube[2]) ** 2; if (d < nearest) { nearest = d; best = c; } }
    return '#' + best.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  }

  // Encodes the bake into the given encoder, or submits it on its own.
  bakeFields(encoder = null, timer = null) {
    const v = this.variant;
    const number = (key, fallback) => { const x = Number(v.get(key)); return Number.isFinite(x) && v.has(key) ? x : fallback; };
    const set = (name, value) => this.set(name, Number(value));
    set('uGrid', this.grid); set('uSize', this.size); set('uBase', this.config.baseHeight - this.config.seaLevel); set('uSea', 0); set('uPool', groundPool(this.config.material));
    {
      set('uWeatherMaps', this.weatherMaps ? 1 : 0);
      for (const [key, fallback] of [['terraceBreak', 0], ['terraceCalm', 0], ['wetSwath', 0], ['lushness', 0], ['rillDepth', 0], ['rillSpacing', 8]])
        set('u' + key[0].toUpperCase() + key.slice(1), number(key, fallback));
    }
    set('uReliefScale', number('reliefScale', 28));
    set('uReliefAmount', number('reliefAmount', 0.5));
    set('uReliefBranch', number('reliefBranch', 2.0));
    set('uReliefLumps', number('reliefLumps', 0.7));
    set('uReliefGain', number('reliefGain', 0.55));
    set('uReliefWarp', number('reliefWarp', 10));
    set('uReliefPatchy', number('reliefPatchy', 1));
    set('uReliefJitter', number('reliefJitter', 0.8));
    set('uFaceStreak', number('faceStreak', 0));
    for (const [key, fallback] of [['rockFace', 0], ['rockFaceFrom', 0.6], ['faceBed', 5.5], ['faceLedge', 2.2], ['faceRun', 90], ['faceLean', 28], ['faceScratch', 2.5],
      ['faceScratchSize', 7], ['faceBlock', 3], ['faceBlockSize', 11], ['faceGrit', 0], ['faceGrass', 0.8], ['faceRock', 0.9], ['faceCrease', 2.5], ['faceCreaseSize', 6],
      ['faceShade', 0.85], ['faceWear', 0.35], ['faceLayers', 0], ['faceMass', 1], ['faceTone', 0.12], ['faceStrata', 0], ['faceWet', 0], ['shoreRock',0],['shoreShelf',0],['runoff',0],['runoffScale',24],['runoffConcentration',.65],['runoffCut',2],['runoffStain',.5],['debrisAmount',0],['debrisReach',56],['debrisDepth',4],['rimReach',0], ['faceJointTilt',0],['faceScaleVary',0],['faceFold',0],['faceBedVary',1],['bedCycleVary',0],['faceBreak',0],['faceSpall',0],['faceClast',0],['faceClastSize',12],['faceMineral',0],['faceJointWidth',1],['faceSecondary',.35],['faceContinuity',1],['faceDetailPatch',0],['faceWhole',0],['faceWholeLarge',0],['faceRegular',0],['sandLee',0],['groundPatch',0],['groundPatchSize',200],['faceFresh',0],['faceRind',0],['faceRindDepth',6],['faceRindTone',-.22],['faceRindWarmth',.35],['faceRindRough',.65], ['faceStretch', 1], ['faceBlockHeight', 1], ['faceRound', 0], ['faceJoint', 0.35], ['faceExtrude', 0], ['faceLamina', 0], ['faceLaminaSize', 6], ['faceScratchLength', 50], ['faceScratchAngle', 0], ['faceGritSize', 1.3], ['lightThrough', 0], ['absorbDepth', 0], ['shadowTint', 0]])
      set('u' + key[0].toUpperCase() + key.slice(1), number(key, fallback));
    set('uFaceStreakFrom', number('faceStreakFrom', 0.3));
    set('uGentleRelief', number('gentleRelief', 0.6));
    set('uSand', number('sand', 0));
    set('uCrackSeverity', number('crackSeverity', 0.6));
    set('uPlainRelief', number('plainRelief', 1.2));
    set('uBedRelief', number('bedRelief', 0));
    set('uLumpRelief', number('lumpRelief', 4));
    set('uCrackSpacing', number('crackSpacing', 40));
    set('uCrackWidth', number('crackWidth', 1));
    set('uCrackNetwork', number('crackNetwork', 0.35));
    set('uCrackMinor', number('crackMinor', 0.75));
    set('uCrackHairline', number('crackHairline', 0.6));
    set('uCrackBlocks', number('crackBlocks', 0.6));
    set('uCrackMajor', number('crackMajor', 0.8));
    if (this.sun) this.v('uSun', this.sun);
    set('uWindAngle', number('wind', 20));
    set('uRipple', number('ripple', 7));
    set('uRippleHeight', number('rippleHeight', 1.4));
    set('uBanding', number('banding', 0));
    set('uApron', number('apron', 0));
    set('uWorms', number('worms', 0));
    set('uLooseSupply', number('looseSupply', 0));
    set('uBoulders', number('boulders', 0));
    set('uSoilRim', number('soilRim', 0));
    set('uWetGround', number('wetGround', 0));
    set('uLooseSize', number('looseSize', 6));
    set('uPlantsOn', groundCoverOn(this.config.material?.groundCover, this.variant) && this.config.material.groundCover.plants ? 1 : 0);
    set('uStoneRound', number('stoneRound',this.config.material?.stoneRound ?? 0));
    set('uStoneSort', number('stoneSort',this.config.material?.stoneSort ?? 0.6));
    set('uStoneSlab', number('stoneSlab',this.config.material?.stoneSlab ?? 0.05));
    set('uStoneMoss', this.config.material?.stoneMoss ?? 0.35);
    set('uBandSoftness', number('bandSoftness', 0.35));
    set('uBandJag', number('bandJag', 0));
    set('uBandFade', number('bandFade', 0.75));
    set('uBeachDistance', this.layers.has('beach') ? (this.config.material?.beachWidth ?? 120) * number('beachWidth', 0.6) : 0);
    set('uHasBeach', this.layers.has('beach'));
    set('uSandBanding', number('sandBanding', 0));
    set('uSandBandSpacing', number('sandBandSpacing', 2));
    set('uReliefOctaves', number('reliefOctaves', 5));
    this.setColumn();
    const own = !encoder;
    encoder ||= this.device.createCommandEncoder({label: 'relief bake'});
    this.rockWeather.encode(encoder);
    this.encodeLooseMask(encoder);
    const pass = encoder.beginComputePass({label: 'relief bake', timestampWrites: timer?.timestampWrites});
    pass.setPipeline(this.bakePipeline);
    pass.setBindGroup(0, this.commonBindGroup('bake'));
    pass.setBindGroup(1, this.fieldsOut);
    pass.dispatchWorkgroups(Math.ceil(this.bakeWidth / 8), Math.ceil(this.bakeHeight / 8));
    pass.end();
    if (own) {
      timer?.encode(encoder);
      this.flushUniforms();
      this.device.queue.submit([encoder.finish()]);
    }
    this.fieldsDirty = false;
  }

  // Milliseconds from submitting one bake to the GPU finishing it, with
  // the GPU idle before; lastBakeGPU holds the pass's own GPU time.
  async timeBake() {
    await this.device.queue.onSubmittedWorkDone();
    const timer = this.timer(), start = performance.now(), dirty = this.fieldsDirty;
    // Each retry bakes again; if the last attempt still misses, its encoder is never submitted, so the fields go back to unbaked and the timer's slot is freed.
    try {
      await this.withPipelines(() => {
        const encoder = this.device.createCommandEncoder({label: 'relief bake'});
        this.bakeFields(encoder, timer);
        timer?.encode(encoder);
        this.specCheck();
        this.flushUniforms();
        this.device.queue.submit([encoder.finish()]);
      });
    } catch (error) { timer?.release(); this.fieldsDirty = dirty; throw error; }
    await this.device.queue.onSubmittedWorkDone();
    const ms = performance.now() - start;
    if (timer) this.lastBakeGPU = await timer.result();
    return ms;
  }

  // The same for one draw (options as draw()); the fields are baked first,
  // so this times the terrain pass alone. Returns {ms, gpuMs}.
  async timeDraw(options = {}) {
    if (this.fieldsDirty) await this.withPipelines(() => this.bakeFields());
    await this.device.queue.onSubmittedWorkDone();
    const start = performance.now();
    await this.withPipelines(() => this.draw(options));
    await this.device.queue.onSubmittedWorkDone();
    const ms = performance.now() - start;
    return {ms, gpuMs: (await this.gpuResult) ?? null};
  }
}
