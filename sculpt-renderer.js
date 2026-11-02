// One displaced surface, shared by every terrain brush. Prototype renderer
// on WebGPU (no WebGL fallback). Shaders: sculpt-common.wgsl (shared),
// sculpt-vert.wgsl and sculpt-frag.wgsl (the draw), relief-bake.wgsl (the
// world-resolution fields bake, a compute pass).

import {materialRows,tablePlacementRows,PLACEMENT_ROW} from './sculpt-material-model.js';
import {columnRows} from './sculpt-column.js';
import {makeNoise, NOISE_SIZE} from './sculpt-noise.js';

// Layers of the masks texture array (4 planes each): the highest plane any card uses, divided by 4. Card F1 uses planes 20-24, layers 5-6.
const MASK_PLANE_COUNT = 25;
const NO_WEBGPU = 'This terrain editor needs WebGPU: current Chrome or Edge, Safari 26, or Firefox with WebGPU.';

// sRGB 0..255 to OKLab (Ottosson 2020), as engine-palette.wgsl does on the GPU: the palette's colours are converted once here.
function oklab(rgb) {
  const lin = rgb.map(v => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  const [l, m, s] = [[0.4122214708, 0.5363325363, 0.0514459929], [0.2119034982, 0.6806995451, 0.1073969566], [0.0883024619, 0.2817188376, 0.6299787005]]
    .map(r => Math.cbrt(r[0] * lin[0] + r[1] * lin[1] + r[2] * lin[2]));
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}

// The plain's tiles as a 512 x 32 picture: tile t at x = 32 t, entry letters looked up in the colour list (H3).
async function groundTileBitmap({entries, tiles}) {
  const data = new ImageData(512, 32);
  tiles.forEach((tile, t) => { for (let i = 0; i < 1024; i++) {
    const k = tile.charCodeAt(i), c = entries[k >= 97 ? k - 97 : k - 39], at = ((i >> 5) * 512 + t * 32 + (i & 31)) * 4;
    data.data.set([c[0], c[1], c[2], 255], at);
  } });
  return createImageBitmap(data, {colorSpaceConversion: 'none', premultiplyAlpha: 'none'});
}

// Average colour of an image (0..1 RGB), from a 64x64 reduction.
function meanColor(bitmap) {
  const canvas = new OffscreenCanvas(64, 64), g = canvas.getContext('2d');
  g.drawImage(bitmap, 0, 0, 64, 64);
  const d = g.getImageData(0, 0, 64, 64).data, sum = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) { sum[0] += d[i]; sum[1] += d[i + 1]; sum[2] += d[i + 2]; }
  return sum.map(v => v / (d.length / 4) / 255);
}

// The shaders keep their GLSL origins' structure: the common source is
// pasted at /*COMMON*/, and #ifdef / #ifndef / #else / #endif keep or drop
// lines by the defined names. Dropped lines stay blank, so a compiler
// message's line number still points into the assembled module.
function preprocess(source, common, defines) {
  const out = [], keep = [];
  for (const line of source.replace('/*COMMON*/', common).split('\n')) {
    const m = line.match(/^\s*#(ifdef|ifndef|else|endif)\b\s*(\w*)/);
    if (!m) {
      if (keep.every(k => k.enabled)) out.push(line);
      // CHUNK alternatives disappear completely from the whole-map source.
      // Its shader text stays identical, including the old BAKE blank lines:
      // even an unused branch can otherwise change float compilation.
      else if (!keep.some(k => k.name === 'CHUNK' && !k.enabled)) out.push('');
      continue;
    }
    let chunk = false;
    if (m[1] === 'ifdef' || m[1] === 'ifndef') {
      chunk = m[2] === 'CHUNK';
      keep.push({name: m[2], enabled: (m[1] === 'ifdef') === defines.has(m[2])});
    } else {
      chunk = keep.at(-1)?.name === 'CHUNK';
      if (m[1] === 'else') keep.at(-1).enabled = !keep.at(-1).enabled;
      else keep.pop();
    }
    if (!chunk && !keep.some(k => k.name === 'CHUNK' && !k.enabled)) out.push('');
  }
  return out.join('\n');
}

// Byte layout of the shaders' one uniform block (struct Uniforms in
// sculpt-common.wgsl), by WGSL's uniform alignment rules. Arrays take a
// 16-byte element stride, so array<vec4f, N> is the only array form used.
const FIELD_TYPES = {f32: [4, 4, 'f'], i32: [4, 4, 'i'], vec2f: [8, 8, 'f'], vec3f: [16, 12, 'f'], vec4f: [16, 16, 'f']};
function uniformLayout(source) {
  const body = source.match(/struct Uniforms\s*\{([\s\S]*?)\n\}/)?.[1];
  if (!body) throw new Error('nanolathe: sculpt-common.wgsl has no struct Uniforms');
  const fields = new Map();
  let offset = 0;
  for (const raw of body.split('\n')) {
    const line = raw.replace(/\/\/.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^(\w+)\s*:\s*(?:array<(\w+),\s*(\d+)>|(\w+))\s*,?$/);
    const type = m && FIELD_TYPES[m[2] || m[4]];
    if (!type) throw new Error(`nanolathe: unsupported uniform field "${line}" in sculpt-common.wgsl`);
    const array = Boolean(m[2]), count = array ? Number(m[3]) : 1;
    const align = array ? 16 : type[0], size = array ? 16 * count : type[1];
    offset = Math.ceil(offset / align) * align;
    fields.set(m[1], {offset, kind: type[2], width: type[1] / 4, count, stride: array ? 16 : 0});
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

export class TerrainRenderer {
  static async create(canvas, config) {
    const self = new TerrainRenderer(canvas, config);
    await self.initialize();
    return self;
  }

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
    this.grid = config.grid;
    this.size = config.size;
    this.maskPlaneCount = config.maskKeys?.length ?? MASK_PLANE_COUNT;
    this.maskLayers = Math.max(1, Math.ceil(this.maskPlaneCount / 4));
    this.height = new Float32Array(this.grid * this.grid).fill(config.baseHeight);
    this.timers = [];
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
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error(NO_WEBGPU + ' No WebGPU adapter is available (is hardware acceleration off?).');
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
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC});

    // The engine's shaders (engine-frag / engine-bake / engine-common) draw every world.
    // Every world's materials are numbers: the config names its table (config.materialTable).
    const tableUrl = this.config.materialTable;
    this.materialData = null;
    const names = ['sculpt-vert.wgsl', 'engine-frag.wgsl', 'engine-common.wgsl', 'engine-bake.wgsl', 'engine-materials.wgsl', 'engine-bridge.wgsl', tableUrl.replace(/^\//, ''), 'engine-palette.wgsl', 'materials/palette.json'];
    const [vert, frag, common, bake, ...extra] = await Promise.all(names.map(async name => {
      const r = await fetch('/' + name);
      if (!r.ok) throw new Error(`Cannot load ${name}`);
      return r.text();
    }));
    const modelTable = extra[2];
    this.paletteSource = extra[3];
    this.paletteColours = JSON.parse(extra[4]).colours;
    this.materialsSource = extra[0];
    this.commonSource = common;
    const defines = this.chunked ? new Set(['CHUNK']) : new Set();
    this.layout = uniformLayout(preprocess(common, '', defines));
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
    const [vertModule, fragModule, bakeModule] = await Promise.all([
      compile('sculpt-vert.wgsl', preprocess(vert, common, defines)),
      compile('engine-frag.wgsl', preprocess(frag + '\n' + extra[1], common, defines)),
      compile('engine-bake.wgsl', preprocess(bake, common, new Set([...defines, 'BAKE'])))]);

    // Group 0: the uniforms and the world fields, shared by the draw and the
    // bake (binding 6 is the fields for the draw, the routes for the bake).
    // Group 1: the draw's materials, or the bake's output.
    const both = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE;
    const texture = (binding, visibility, sampleType = 'float', viewDimension = '2d') => ({binding, visibility, texture: {sampleType, viewDimension}});
    const sampler = (binding, visibility) => ({binding, visibility, sampler: {type: 'filtering'}});
    this.commonLayout = device.createBindGroupLayout({label: 'world fields', entries: [
      {binding: 0, visibility: both, buffer: {type: 'uniform'}},
      texture(1, both, 'unfilterable-float'), texture(2, both), texture(4, both, 'float', '2d-array'), texture(6, both),
      sampler(7, both), sampler(8, both), texture(9, both, 'float', '2d-array')]});
    const F = GPUShaderStage.FRAGMENT;
    // The engine draw (H4) binds only what Green reads: the plain's tiles, the water images, the palette and the generated materials
    // (binding 19, read with textureLoad); no land image remains. Binding numbers are the shared draw's, with 2-13 left out.
    this.materialLayout = device.createBindGroupLayout({label: 'materials', entries: [
      texture(0, F), sampler(1, F),
      texture(18, F), texture(19, F, 'float', '2d-array'), texture(20, F)]});
    // GL drew with LESS against a cleared depth of 1; the vertex shader maps
    // GL's clip depth onto WebGPU's 0..1 range.
    [this.drawPipeline, this.bakePipeline] = await Promise.all([
      device.createRenderPipelineAsync({label: 'terrain', layout: device.createPipelineLayout({bindGroupLayouts: [this.commonLayout, this.materialLayout]}),
        vertex: {module: vertModule, entryPoint: 'vertexMain', buffers: [{arrayStride: 8, attributes: [{shaderLocation: 0, offset: 0, format: 'float32x2'}]}]},
        fragment: {module: fragModule, entryPoint: 'fragmentMain', targets: [{format: this.format}]},
        primitive: {topology: 'triangle-list', cullMode: 'none'},
        depthStencil: {format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less'}}),
      device.createComputePipelineAsync({label: 'relief bake', layout: device.createPipelineLayout({bindGroupLayouts: [this.commonLayout,
        device.createBindGroupLayout({label: 'fields out', entries: [{binding: 0, visibility: GPUShaderStage.COMPUTE, storageTexture: {access: 'write-only', format: 'rgba16float'}}]})]}),
        compute: {module: bakeModule, entryPoint: 'bakeMain'}})]);
    const mipModule = device.createShaderModule({label: 'mip levels', code: MIP_SHADER});
    this.mipPipeline = device.createRenderPipeline({label: 'mip levels', layout: 'auto',
      vertex: {module: mipModule, entryPoint: 'fullScreen'},
      fragment: {module: mipModule, entryPoint: 'halve', targets: [{format: 'rgba8unorm'}]}});

    this.samplers = new Map();
    // The world fields: clamped and linear; noise repeats.
    this.linearClamp = this.sampler({magFilter: 'linear', minFilter: 'linear'});
    this.linearRepeat = this.sampler({magFilter: 'linear', minFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat'});
    // The fields are baked once per height change: r relief height, g route
    // protection or (negative) beach, b crack/line code, a sand.
    this.fieldsTexture = device.createTexture({label: 'fields', size: [this.size, this.size], format: 'rgba16float',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC});
    this.fieldsOut = device.createBindGroup({label: 'fields out', layout: this.bakePipeline.getBindGroupLayout(1),
      entries: [{binding: 0, resource: this.fieldsTexture.createView()}]});
    this.fieldsDirty = true;
    this.uniform = this.layout.fields;
    this.materialData = JSON.parse(modelTable);
    // The water's grain is two more generated materials after the table's own, named by the config's water block (shared when the two are one).
    for (const name of [this.config.water.deep, this.config.water.shallow]) if (!this.materialData.order.includes(name)) this.materialData.order.push(name);
    // The startup generation: the materials and the palette lookup (GPU) are started first and the noise (CPU) is made while they build.
    this.textures = {};
    const generation = performance.now();
    const gpu = Promise.all([this.makeMaterials(), this.paletteTexture()]);
    this.textures.noise = this.noiseTexture();
    this.textures.palette = (await gpu)[1];
    this.generationMs = performance.now() - generation;
    this.meshes = [this.mesh(192), this.mesh(512)];
    this.worldTextures(this.grid);
    this.device.queue.writeTexture({texture: this.heightTexture}, this.textureHeights(this.height), {bytesPerRow: this.grid * 4}, [this.grid, this.grid]);
    this.setRoutes(new Float32Array(this.grid * this.grid));
    const variant = new URLSearchParams(location.search);
    // H4: the engine's own knob values go in first, over the world's, under the page's query.
    for (const [key, value] of Object.entries(this.config.engineDefaults || {})) if (!variant.has(key)) variant.set(key, value);
    for (const [key, value] of Object.entries(this.config.defaults || {}))
      if (!variant.has(key)) variant.set(key, value);
    this.variant = variant;
    const slopeMaterial = ['slopes', 'structured'].includes(variant.get('surface'));
    const rockLayers = variant.get('material') === 'varied';
    this.means = {};
    // The materials the table makes, by name: which optional stages the world has.
    this.layers = new Set(this.materialData.order);
    // A world builds the plain's 16 tiles from its table's `ground` data; a borrowed pattern (World panel) names the table of the world it
    // comes from. A table without `ground` data (a quilted plain: its generated `quilt` layer is the plain) binds a one-texel stand-in,
    // and the world's mean ground colour is the quilt's.
    const groundTable = await this.groundTable(this.groundSource().groundTable);
    this.groundTiled = Boolean(groundTable.ground);
    const tiles = this.groundTiled ? await groundTileBitmap(groundTable.ground) : await createImageBitmap(new ImageData(1, 1));
    this.means.ground = this.groundTiled ? meanColor(tiles) : this.materialData.measured.quilt.meanRGB.map(v => v / 255);
    this.textures.grass = this.materialTexture('grass', [tiles], {minFilter: 'nearest', magFilter: 'nearest', mipmaps: false});
    tiles.close();
    // Mean colour of each base material, so a world can move it to a new base colour while keeping the texture's grain.
    this.means.slope = this.materialData.measured[this.materialData.order[0]].meanRGB.map(v => v / 255);
    this.means.rock = this.materialData.measured[this.materialData.order[1]].meanRGB.map(v => v / 255);
    // The transition body is generated layer 5 and the transition (ring, body, contours) needs the flag; the beach is layer 6, the ring 7.
    this.transitionBody = this.layers.has('body');
    if (this.layers.has('beach')) this.means.beach = this.materialData.measured.beach.meanRGB.map(v => v / 255);
    this.i('uBeach', this.layers.has('beach'));
    this.f('uBeachHeight',this.config.material?.beachHeight??6);
    const mid=this.config.water?.midRGB, midDepth=this.config.material?.midDepth;
    this.set('uWaterMid', mid && midDepth ? [...mid.map(v => v / 255), midDepth] : [0, 0, 0, 0]);
    this.f('uGrid', this.grid);
    this.f('uSize', this.size);
    this.f('uBase', this.config.baseHeight - this.config.seaLevel);
    this.f('uSea', 0);
    this.f('uDetail', variant.get('relief') === 'base' ? 0.0 : (this.config.material?.surfaceRelief ?? 1.0));
    this.i('uRockyCoasts', Boolean(this.config.material?.rockyCoasts));
    this.i('uSlopeMaterial', slopeMaterial);
    this.i('uSoilCover', variant.get('transition') === 'soil');
    this.i('uMineralMargins', variant.get('transition') === 'mineral' && variant.get('margins') !== 'slope');
    this.i('uRockLayers', rockLayers);
    this.applyKnobs();
    this.i('uDiagnosticView', ['diffuse','occlusion','shadow','exposure','shading','material','cracks'].indexOf(variant.get('view')) + 1);
    this.i('uSeparateLight', variant.get('shade') === 'separate');
    this.f('uFaceFill', variant.has('faceFill') ? Number(variant.get('faceFill')) : Math.max(0, Math.min(.5, (Number(variant.get('fill')) || 0) / 100)));
    this.i('uCoastalDetail', variant.get('shore') !== 'smooth');
    this.i('uNativeShallows', variant.get('water') !== 'tinted');
    this.i('uLayered', ['layers', 'terraces'].includes(variant.get('geology')));
    this.i('uTerraced', variant.get('geology') === 'terraces');
    const material = this.config.material || {};
    this.set('uSlopeProfile', [material.slopeStart ?? .10,
      material.slopeFull ?? .55, material.slopeFloor ?? 8.0, material.slopeDry ?? 24.0]);
    this.v('uElevatedCover', material.elevatedCover || [5, 32, 0]);
    this.i('uSlopeOnLowBanks', material.slopeOnLowBanks !== false);
    this.f('uRampMaterial', material.rampMaterial ?? 0);
    this.i('uSlopeSand', Boolean(material.slopeSand));
    this.v('uCrystalColor', (material.crystalRGB || [110, 150, 225]).map(v => v / 255));
    this.i('uGroundFringe', material.groundFringe === true);
    // A preset can retain coloured veins or dark neutral grain at its edge.
    // The blending algorithm does not choose a biome's material colour.
    this.set('uFringeSignal', material.fringeSignal || [-.299, -.587, -.114, 1]);
    this.set('uFringeRange', material.fringeRange || [.08, .28]);
    const threshold = material.rockSlope ?? 1.145, feather = material.rockFeather ?? 0.43;
    this.f('uRockStart', threshold - feather * 0.5);
    this.f('uRockFull', threshold + feather * 0.5);
    this.f('uWetBand', material.wetBand ?? 13);
    // E6: mineralDetail scales the rock art's contrast about its mean (1: as drawn).
    const rockMean = material.hillRockMeanRGB || [85, 84, 79];
    this.v('uRockMean', rockMean.map(v => v / 255));
    this.i('uShapeCoverage', variant.get('coverage') === 'form');
    this.i('uLedgeCoverage', variant.get('coverage') === 'ledge');
    this.v('uShallowColor', (this.config.water?.shallowRGB || [60, 115, 163]).map(v => v / 255));
    this.v('uDeepColor', (this.config.water?.deepRGB || [16, 57, 133]).map(v => v / 255));
    this.v('uWaterMean', this.materialData.measured[this.config.water.deep].meanRGB.map(v => v / 255));
    this.i('uWaterLayer', this.materialData.order.indexOf(this.config.water.deep));
    this.i('uShallowLayer', this.materialData.order.indexOf(this.config.water.shallow));
    this.setWeather();
    this.setMaterialField();
  }

  sampler(descriptor) {
    const key = JSON.stringify(descriptor);
    if (!this.samplers.has(key)) this.samplers.set(key, this.device.createSampler(descriptor));
    return this.samplers.get(key);
  }

  // An RGBA8 material from one image per layer, with its sampler. Filters
  // follow the WebGL renderer: repeat, the given min/mag filters, and
  // trilinear between generated levels where the material has them.
  materialTexture(label, images, {minFilter, magFilter, mipmaps}) {
    const {width, height} = images[0], layers = images.length;
    const mipLevelCount = mipmaps ? Math.floor(Math.log2(Math.max(width, height))) + 1 : 1;
    const texture = this.device.createTexture({label, size: [width, height, layers], format: 'rgba8unorm', mipLevelCount,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT});
    images.forEach((source, layer) => this.device.queue.copyExternalImageToTexture({source},
      {texture, origin: [0, 0, layer], premultipliedAlpha: false}, [width, height]));
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

  // The palette lookup (engine-palette.wgsl): the table's colours, or the ones its `palette.entries` pick, as a 1024 x 96 RGBA8 texture.
  async paletteTexture() {
    const device = this.device, start = performance.now();
    const colours = (this.materialData.palette?.entries ?? this.paletteColours.map((_, i) => i)).map(i => this.paletteColours[i]);
    const rows = new Float32Array(colours.length * 8);
    colours.forEach((c, i) => { rows.set([c[0], c[1], c[2], 0], i * 8); rows.set(oklab(c), i * 8 + 4); });
    const buffer = device.createBuffer({size: rows.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST});
    device.queue.writeBuffer(buffer, 0, rows);
    const count = device.createBuffer({size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
    device.queue.writeBuffer(count, 0, new Uint32Array([colours.length, 0, 0, 0]));
    const texture = device.createTexture({label: 'palette lookup', size: [1024, 96], format: 'rgba8unorm', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC});
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

  // The grid-resolution inputs: authored height, routes (protection, crack
  // amount, painted sand and ground cover), weathering and material fields.
  worldTextures(grid) {
    if (this.worldGrid === grid) return;
    for (const t of [this.heightTexture, this.routeTexture, this.gridTexture, this.maskTexture]) t?.destroy();
    const make = (label, format) => this.device.createTexture({label, size: [grid, grid], format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST});
    this.heightTexture = make('height', 'r32float');
    this.routeTexture = make('routes', 'rgba8unorm');
    // Layer 0: the weathering worker's flow, deposit, talus and sand; layer 1:
    // the material field (one texture binding for both, see initialize). H5: layers 2 and 3 hold
    // the Time pass's maps (wear, wetness, hardness, slope; fall line, channel, ridge), Green's engine only.
    this.gridTexture = this.device.createTexture({label: 'weather and material field', size: [grid, grid, 4], format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST});
    // Painted masks (card C5), signed bytes so an unpainted
    // cell is exactly 0.0: layer 0 rock, snow or ice, wet ground, moss;
    // layer 1 scatter density, relief, cracks, banding; layer 2 face rock share,
    // then the water choices (shore edge, shallow-to-deep edge, bed; card E1);
    // layer 3 ground lumps (the rest is spare). Plane k of the page is layer
    // k >> 2, channel k & 3. Fresh textures are zero.
    this.maskTexture = this.device.createTexture({label: 'masks', size: [grid, grid, this.maskLayers], format: 'rgba8snorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST});
    this.maskAllocatedLayers = this.maskLayers;
    this.worldGrid = grid;
    this.bindGroups = {};
    this.maskUploaded = false;
  }

  // Base colours chosen for a world: {ground, slope, rock, sand, beach,
  // shallow, deep} as [r,g,b] 0..1, or absent to keep the world's own.
  groundSource() {
    return this.config.groundPatterns?.[this.variant.get('groundPattern')] || (this.ownGround ??= {groundTable: this.config.materialTable});
  }
  // A world's table by URL: this world's own is already loaded.
  async groundTable(url) {
    if (url === this.config.materialTable) return this.materialData;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Cannot load ground pattern ${url}`);
    return response.json();
  }

  setColors(colors = {}) {
    for (const key of ['ground', 'slope', 'rock', 'sand', 'beach', 'shallow', 'deep', 'crystal']) {
      const c = colors[key];
      this.set('u' + key[0].toUpperCase() + key.slice(1) + 'Base', c ? [...c, 1] : [0, 0, 0, 0]);
    }
    // The column's slot colours: the world's, else a painted-desert set.
    const strataDefaults = this.config.column?.colors || [[146, 74, 58], [188, 122, 96], [140, 124, 138], [198, 182, 158], [166, 98, 76]];
    const strata = strataDefaults.map((c, i) => colors['strata' + (i + 1)] || c.map(v => v / 255));
    this.set('uStrataColors', strata);
    for (const key of ['ground', 'slope', 'rock', 'beach'])
      this.v('u' + key[0].toUpperCase() + key.slice(1) + 'TexMean', this.means[key] || [0.5, 0.5, 0.5]);
  }

  // GLSL uniform uFooBar is the uniform block's field fooBar. A value is a
  // number or boolean, a vector's components, or (for an array) a list of
  // element vectors. Unknown names throw: WebGL ignored them silently.
  set(name, value) {
    const field = /^u[A-Z]/.test(name) && this.uniform.get(name[1].toLowerCase() + name.slice(2));
    if (!field) throw new Error(`nanolathe: no uniform ${name} in sculpt-common.wgsl`);
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

  flushUniforms() {
    if (!this.uniformsDirty) return;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);
    this.uniformsDirty = false;
  }

  mesh(resolution) {
    const points = new Float32Array((resolution + 1) ** 2 * 2);
    let k = 0;
    for (let y = 0; y <= resolution; y++) for (let x = 0; x <= resolution; x++) {
      points[k++] = x / resolution;
      points[k++] = y / resolution;
    }
    const index = new Uint32Array(resolution * resolution * 6);
    k = 0;
    for (let y = 0; y < resolution; y++) for (let x = 0; x < resolution; x++) {
      const a = y * (resolution + 1) + x, b = a + resolution + 1;
      index.set([a, b, a + 1, a + 1, b, b + 1], k); k += 6;
    }
    const buffer = (data, usage) => {
      const b = this.device.createBuffer({size: data.byteLength, usage: usage | GPUBufferUsage.COPY_DST});
      this.device.queue.writeBuffer(b, 0, data);
      return b;
    };
    return {vertices: buffer(points, GPUBufferUsage.VERTEX), indices: buffer(index, GPUBufferUsage.INDEX), count: index.length};
  }

  // Materials were authored at sea 0. Give every shader that same datum while
  // keeping editable/picking heights absolute. Sea-0 uploads remain untouched,
  // including shader source/compilation, so existing worlds keep their pixels.
  textureHeights(height) {
    return this.config.seaLevel===0 ? height : height.map(h => h-this.config.seaLevel);
  }

  setWeather(flow, deposit, talus, sand) {
    this.fieldsDirty = true; this.weatherMaps = false;
    const bytes = new Uint8Array(this.grid * this.grid * 4);
    if (flow && deposit) for (let i = 0; i < flow.length; i++) {
      bytes[i * 4] = Math.min(255, Math.max(0, Math.round(flow[i] * 255)));
      bytes[i * 4 + 1] = Math.min(255, Math.max(0, Math.round(deposit[i] * 255)));
      bytes[i * 4 + 2] = Math.min(255, Math.max(0, Math.round((talus?.[i] || 0) * 255)));
      bytes[i * 4 + 3] = Math.min(255, Math.max(0, Math.round((sand?.[i] || 0) * 255)));
    }
    this.worldTextures(this.grid);
    this.device.queue.writeTexture({texture: this.gridTexture, origin: [0, 0, 0]}, bytes, {bytesPerRow: this.grid * 4}, [this.grid, this.grid]);
  }

  setRoutes(routes, crackLines, cover, crystal, masks) {
    // Red: route protection; green: the shapes' crack amount; blue: painted
    // cover, signed about one half (above: sand, below: the world's ground);
    // alpha: crystal cells.
    this.fieldsDirty = true;
    const bytes = new Uint8Array(routes.length * 4);
    for (let i = 0; i < routes.length; i++) {
      const c = cover?.[i] || 0;
      bytes[i * 4] = Math.round(routes[i] * 255); bytes[i * 4 + 1] = Math.round((crackLines?.[i] || 0) * 255);
      bytes[i * 4 + 2] = Math.round((Math.max(-1, Math.min(1, c)) * 0.5 + 0.5) * 255); bytes[i * 4 + 3] = Math.round((crystal?.[i] || 0) * 255);
    }
    this.worldTextures(this.grid);
    this.device.queue.writeTexture({texture: this.routeTexture}, bytes, {bytesPerRow: this.grid * 4}, [this.grid, this.grid]);
    if (masks) this.setMasks(masks);
  }

  // Painted masks (card C5): fourteen signed-byte planes (rock, snow or ice, wet
  // ground, moss, scatter density, relief, cracks, banding, face rock share;
  // then, card E1, shore edge, shallow-to-deep edge, water bed, ground lumps and cracked bed),
  // interleaved into maskTexture's layers. Nothing is uploaded while nothing
  // has ever been painted; paintOn, scatterOn, styleOn, waterOn and lumpOn tell
  // the shaders whether to read the texture at all. The water and lump planes
  // have their own flags, so a stroke that sets only those leaves every other
  // read of the texture, and the render it feeds, as it was.
  setMasks(planes) {
    const n = this.grid * this.grid;
    this.maskPlaneCount = planes.length;
    this.maskLayers = Math.max(1, Math.ceil(planes.length / 4));
    if (this.maskLayers > this.device.limits.maxTextureArrayLayers) throw new Error('nanolathe: mask planes exceed the device texture array limit');
    this.worldTextures(this.grid);
    if (this.maskAllocatedLayers !== this.maskLayers) {
      this.maskTexture.destroy();
      this.maskTexture = this.device.createTexture({label: 'masks', size: [this.grid, this.grid, this.maskLayers], format: 'rgba8snorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST});
      this.maskAllocatedLayers = this.maskLayers;
      this.maskUploaded = true;
      this.bindGroups = {};
    }
    // Four cells a read: this runs every frame a shape is dragged, and scanning
    // five unpainted planes byte by byte cost 2 ms.
    const painted = planes.map(a => {
      if (!a) return 0;
      if (a.length !== n) throw new Error('nanolathe: invalid mask plane dimensions');
      if (!a.buffer || a.byteOffset % 4) return a.some(Boolean) ? 1 : 0;
      const words = new Int32Array(a.buffer, a.byteOffset, n >> 2);
      for (let i = 0; i < words.length; i++) if (words[i]) return 1;
      for (let i = n & ~3; i < n; i++) if (a[i]) return 1;
      return 0;
    });
    const any = painted.some(Boolean) ? 1 : 0;
    if (!any && !this.maskUploaded) return;
    this.fieldsDirty = true;
    if (this.maskBytes?.length !== n * this.maskLayers * 4) this.maskBytes = new Int8Array(n * this.maskLayers * 4);
    const bytes = this.maskBytes;
    bytes.fill(0);
    planes.forEach((a, k) => { if (!a) return; const at = (k >> 2) * n * 4 + (k & 3); for (let i = 0; i < n; i++) bytes[at + i * 4] = a[i]; });
    this.device.queue.writeTexture({texture: this.maskTexture}, bytes, {bytesPerRow: this.grid * 4, rowsPerImage: this.grid}, [this.grid, this.grid, this.maskLayers]);
    this.maskUploaded = Boolean(any);
    this.i('uPaintOn', painted.slice(0, 9).some(Boolean) ? 1 : 0);
    this.i('uScatterOn', painted[4] || 0);
    this.i('uStyleOn', painted.slice(5, 9).some(Boolean) ? 1 : 0);
    this.i('uOverrideOn', painted.slice(14, 18).some(Boolean) ? 1 : 0);   // H3: planes 14-17 (erosion, deposits, vegetation, exposure)
    this.i('uWaterOn', painted.slice(9, 12).some(Boolean) || painted[13] ? 1 : 0);
    this.i('uLumpOn', painted[12] || 0);
    this.i('uFlowOn', painted.slice(20, 25).some(Boolean) ? 1 : 0);
  }

  // The sediment colours of the flow bake (card F1): up to three [r,g,b] in 0..1.
  setSediment(colors) { this.set('uSedimentColors', [0, 1, 2].map(i => [...(colors?.[i] || [0, 0, 0]), 1])); }

  setMaterialField(field) {
    const bytes=new Uint8Array(this.grid*this.grid*4);
    if (field) for(let i=0;i<field.length;i++) bytes[i]=Math.round(Math.max(0,Math.min(1,field[i]))*255);
    this.worldTextures(this.grid);
    this.device.queue.writeTexture({texture:this.gridTexture,origin:[0,0,1]},bytes,{bytesPerRow:this.grid*4},[this.grid,this.grid]);
    this.materialReady=Boolean(field);
  }

  // Group 0 with the fields (draw) or the routes (bake) at binding 6.
  commonBindGroup(kind) {
    return this.bindGroups[kind] ??= this.device.createBindGroup({label: kind, layout: this.commonLayout, entries: [
      {binding: 0, resource: {buffer: this.uniformBuffer}},
      ...[this.heightTexture, this.textures.noise.texture].map((t, i) => ({binding: i + 1, resource: t.createView()})),
      {binding: 4, resource: this.gridTexture.createView({dimension: '2d-array'})},
      {binding: 6, resource: (kind === 'bake' ? this.routeTexture : this.fieldsTexture).createView()},
      {binding: 7, resource: this.linearClamp}, {binding: 8, resource: this.linearRepeat},
      {binding: 9, resource: this.maskTexture.createView({dimension: '2d-array'})}]});
  }

  // Group 1: the plain's tiles, the waters, the palette and the generated materials.
  materialBindGroup() {
    return this.bindGroups.materials ??= this.device.createBindGroup({label: 'materials', layout: this.materialLayout, entries: [
      {binding: 0, resource: this.textures.grass.view}, {binding: 1, resource: this.textures.grass.sampler},
      {binding: 18, resource: this.textures.palette.view}, {binding: 19, resource: this.generated.view}, {binding: 20, resource: this.relief.createView()}]});
  }

  // The ten placement rows of a world whose table has no `placement` block (engine-frag.wgsl landPlace reads them), from the knobs the
  // shared draw's placement read. Green's rows are materials/green.json's.
  placementRows(variant) {
    const material = this.config.material || {}, num = (k, d) => variant.has(k) ? Number(variant.get(k)) : d, list = (k, d) => (variant.get(k) || d).split(',').map(Number);
    const mode = variant.get('coverage'), soil = variant.get('transition') === 'soil', mineral = variant.get('transition') === 'mineral' && variant.get('margins') !== 'slope';
    const threshold = material.rockSlope ?? 1.145, feather = material.rockFeather ?? 0.43;
    let r0 = [1, 0, 0, 5], r1 = [0.55, 0, 0.55, 10], third = 0.30;   // the plain slope score: slope, noise, wear, and a third noise term
    if (mode === 'form') { r0 = [0.55, 0.45, 0.28, 5]; r1 = [soil ? 0.80 : 0.25, soil ? 0.70 : 0, 0.55, 10]; third = 0; }
    if (mode === 'ledge') { r0 = [0.15, 0.85, 0.15, 3]; r1 = [0.15, 0, 0.55, 4]; third = 0; }
    const face = list('faceSlope', '0.35,0.9'), share = list('rockShare', '0.2,1.0'), score = list('faceScore', '0.2,2.0,0.5,0.3');
    return [r0, r1, [threshold - feather * 0.5, threshold + feather * 0.5, third, 0],
      [0.2, soil ? 18 : 1e9, 18, 28], material.rockyCoasts ? [-1e4, -1e3, 0, 0] : [12, 36, 0, 0], [0.45, 0.9, mineral ? 0.45 : 0, mineral ? 1.4 : 0],
      [face[0], face[1], num('faceEdge', 0.8), 0], [share[0], share[1], 0, 0], score, [num('gullyRock', 0.5), num('rockOrder', 0), 0, 0]];
  }
  // The draw's uniform table: only the ten placement rows are read, at PLACEMENT_ROW. A table with a `placement` block gives them
  // (Green's); every other table leaves them to the knobs, as the world's placement always was.
  placementTable(variant) {
    const rows = this.materialData?.placement ? tablePlacementRows(this.materialData, variant) : this.placementRows(variant);
    return [...Array.from({length: PLACEMENT_ROW}, () => [0, 0, 0, 0]), ...rows];
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
      this.reliefPipeline = await device.createComputePipelineAsync({label: 'material relief', layout: 'auto', compute: {module, entryPoint: 'makeRelief'}});
    }
    if (!this.generated) {
      const texture = device.createTexture({label: 'generated materials', size: [size, size, layers], format: 'rgba8unorm', mipLevelCount: levels,
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC});
      this.generated = {texture, view: texture.createView({dimension: '2d-array'})};
      // H19: the rock's height gradient (engine-materials.wgsl makeRelief), one layer with the colours' levels.
      this.relief = device.createTexture({label: 'rock relief', size: [size, size], format: 'rgba16float', mipLevelCount: levels,
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING});
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
      const relief = encoder.beginComputePass({label: 'material relief level ' + level});
      relief.setPipeline(this.reliefPipeline);
      relief.setBindGroup(0, device.createBindGroup({layout: this.reliefPipeline.getBindGroupLayout(0), entries: [
        {binding: 0, resource: {buffer: table}}, {binding: 2, resource: {buffer: buffer}},
        {binding: 4, resource: this.relief.createView({baseMipLevel: level, mipLevelCount: 1})},
        {binding: 5, resource: this.relief.createView({baseMipLevel: level ? level - 1 : 1, mipLevelCount: 1})}]}));
      relief.dispatchWorkgroups(n, n);
      relief.end();
      if (level === 0) {
        // A dithered material's level 0 (engine-materials.wgsl makeDither): one invocation per 32-px block, the levels above box-mean it.
        const dither = encoder.beginComputePass({label: 'materials dither'});
        dither.setPipeline(this.ditherPipeline);
        dither.setBindGroup(0, device.createBindGroup({layout: this.ditherPipeline.getBindGroupLayout(0), entries: [
          {binding: 0, resource: {buffer: table}},
          {binding: 1, resource: this.generated.texture.createView({dimension: '2d-array', baseMipLevel: 0, mipLevelCount: 1})},
          {binding: 2, resource: {buffer: buffer}}]}));
        const blocks = Math.ceil(size / 32 / 8);
        dither.dispatchWorkgroups(blocks, blocks, layers);
        dither.end();
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
      // After submit: resolves to the pass's GPU milliseconds.
      result: () => slot.read.mapAsync(GPUMapMode.READ).then(() => {
        const [begin, end] = new BigUint64Array(slot.read.getMappedRange());
        slot.read.unmap();
        slot.busy = false;
        return end > begin ? Number(end - begin) / 1e6 : 0;
      }, () => { slot.busy = false; return null; }),
    };
  }

  draw({quality = 'preview', clay = false, light = 'original', scree = 0, detail = this.config.material?.surfaceRelief ?? 1, ring = .85, ringSpread = .65, ringVariation = .7, materialWeathering = this.config.material?.materialWeathering ?? 0, transitionDetail = this.config.material?.transitionDetail ?? .65, exact = false} = {}) {
    const start = performance.now(), device = this.device;
    const full = quality === 'full';
    this.i('uFull', full);
    this.i('uClay', clay);
    const weatherAmount=this.variant.get('deposits')==='off'?0:materialWeathering;
    this.f('uMaterialWeathering', weatherAmount);
    this.f('uTransitionDetail', transitionDetail);
    this.i('uMaterialReady', this.materialReady);
    const useBody=this.transitionBody && this.materialReady && weatherAmount>0;
    this.i('uTransitionBody', Boolean(useBody));
    this.f('uDetail', this.variant.get('relief') === 'base' ? 0 : detail);
    this.f('uRingAmount', this.layers.has('ring') ? ring : 0);
    this.f('uRingSpread', ringSpread);
    this.f('uRingVariation', ringVariation);
    this.i('uScree', scree > 0);
    this.i('uQuantize', (this.variant.get('palette') || 'nearest') !== 'off');
    this.i('uPaletteMix', Number(this.variant.get('paletteMix')) > 0.5);
    this.f('uShoreEdge', Number(this.variant.get('shoreEdge')) || 0);
    this.f('uCrystalGrain', Number(this.variant.get('crystalGrain')) || 0);
    this.f('uCrystalFace', this.variant.has('crystalFace') ? Number(this.variant.get('crystalFace')) : 1);
    this.f('uCrystalInk', Number(this.variant.get('crystalInk')) || 0);
    this.f('uCrystalTone', this.variant.has('crystalTone') ? Number(this.variant.get('crystalTone')) : 1);
    const front = this.variant.get('lighting') === 'front';
    // sunTilt scales the light's north-south component (1: as before; Moon 0,
    // lit from due west as every retail Lunar map measures).
    const tilt = this.variant.has('sunTilt') ? Number(this.variant.get('sunTilt')) : 1;
    let sun = [light === 'alternate' ? 0.72 : -0.72, (front ? 0.38 : -0.38) * tilt, 0.82];
    // Review sun (card H1): the page's ?sun=<azimuth>,<elevation> turns the light, for looking at the relief from other
    // suns (ink keeps its shade, geometry does not). Azimuth is degrees added to the world's own sun direction on the
    // screen plane (0: unchanged), elevation degrees above the horizon (empty: the world's own). Exports never take it (exact).
    const review = exact ? null : /^\s*(-?[\d.]*)\s*,\s*(-?[\d.]*)\s*$/.exec(this.variant.get('sun') || '');
    if (review) {
      const turn = Math.atan2(sun[1], sun[0]) + (Number(review[1]) || 0) * Math.PI / 180;
      const rise = review[2] === '' ? Math.atan2(sun[2], Math.hypot(sun[0], sun[1])) : Number(review[2]) * Math.PI / 180;
      sun = [Math.cos(turn) * Math.cos(rise), Math.sin(turn) * Math.cos(rise), Math.sin(rise)];
    }
    const length = Math.hypot(...sun);
    this.v('uLight', sun.map(v => v / length));
    // Lit crack walls are baked for this light.
    const sunKey = sun.join(',');
    if (this.sunKey !== sunKey) { this.sunKey = sunKey; this.sun = sun.map(v => v / length); this.fieldsDirty = true; }
    const encoder = device.createCommandEncoder({label: 'terrain'});
    // Painting bakes a cheap preview; the first full draw after it re-bakes.
    if (this.fieldsDirty || (full && this.bakedQuality !== 'full')) this.bakeFields(full ? 'full' : 'preview', encoder);
    if (this.depthTexture?.width !== this.canvas.width || this.depthTexture?.height !== this.canvas.height) {
      this.depthTexture?.destroy();
      this.depthTexture = device.createTexture({label: 'depth', size: [this.canvas.width, this.canvas.height], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT});
      this.depthView = this.depthTexture.createView();
    }
    // Rows above the drawn surface (raised ground is drawn north) take the
    // world's ground colour rather than a fixed green.
    const clear = this.means.ground || [0.19, 0.28, 0.14];
    const timer = this.timer();
    const pass = encoder.beginRenderPass({label: 'terrain',
      colorAttachments: [{view: this.context.getCurrentTexture().createView(), clearValue: {r: clear[0], g: clear[1], b: clear[2], a: 1}, loadOp: 'clear', storeOp: 'store'}],
      depthStencilAttachment: {view: this.depthView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard'},
      timestampWrites: timer?.timestampWrites});
    pass.setPipeline(this.drawPipeline);
    if (this.chunkViewport) pass.setViewport(...this.chunkViewport, 0, 1);
    pass.setBindGroup(0, this.commonBindGroup('draw'));
    pass.setBindGroup(1, this.materialBindGroup());
    const mesh = this.meshes[full ? 1 : 0];
    pass.setVertexBuffer(0, mesh.vertices);
    pass.setIndexBuffer(mesh.indices, 'uint32');
    pass.drawIndexed(mesh.count);
    pass.end();
    timer?.encode(encoder);
    this.flushUniforms();
    device.queue.submit([encoder.finish()]);
    this.gpuResult = timer?.result().then(ms => { if (ms !== null) this.lastGPU = ms; return ms; });
    return {milliseconds: performance.now() - start, gpuMilliseconds: this.lastGPU};
  }

  // Surface knobs read from the variant; callable again after a change.
  applyKnobs() {
    const variant = this.variant;
    // Placement is live state too: refreshing only scalar uniforms left these
    // controls frozen at startup in the generated materials.
    this.set('uMaterialTable', this.placementTable(variant));
    this.f('uMineralDetail', (variant.get('grain') === 'strong' ? 2.4 : 1.0) * (variant.has('mineralDetail') ? Number(variant.get('mineralDetail')) : 1));
    this.f('uMaterialFoot', variant.has('materialFoot') ? Math.max(1, Number(variant.get('materialFoot'))) : 1);   // H3: ?materialFoot=4 trials a quarter-resolution draw
    this.f('uMicroRock', variant.has('microRock') ? Number(variant.get('microRock')) : 1.0);
    this.set('uFaceSlope', (variant.get('faceSlope') || '0.35,0.9').split(',').map(Number));
    this.set('uRockShare', (variant.get('rockShare') || '0.2,1.0').split(',').map(Number));
    this.set('uFaceScore', (variant.get('faceScore') || '0.2,2.0,0.5,0.3').split(',').map(Number));
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
    this.i('uShineOn', shine.some(m => m[0] > 0 || m[2] > 0));
    this.f('uShineStretch', variant.has('shineStretch') ? Number(variant.get('shineStretch')) : 1);
    this.f('uShineWhite', variant.has('shineWhite') ? Number(variant.get('shineWhite')) : 0.35);
    this.set('uShine', shine);
    // E10 (Lava): crease at the foot of each bank step; shine only from this slope up (0: off).
    this.f('uLayerCrease', variant.has('layerCrease') ? Number(variant.get('layerCrease')) : 0);
    this.f('uShineSlopeGate', variant.has('shineSlopeGate') ? Number(variant.get('shineSlopeGate')) : 0);
    // G5 (Lava): dashes in the bank crease.
    this.f('uLavaCreaseVary', variant.has('lavaCreaseVary') ? Number(variant.get('lavaCreaseVary')) : 0);
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
    this.f('uShelfScale', variant.has('shelfScale') ? Number(variant.get('shelfScale')) : 100);
    this.f('uCrackedStep', variant.has('crackedStep') ? Number(variant.get('crackedStep')) : 0);
    this.f('uCrackedContrast', variant.has('crackedContrast') ? Number(variant.get('crackedContrast')) : 0);
    this.f('uBedDots', variant.has('bedDots') ? Number(variant.get('bedDots')) : 0);
    this.f('uBedDotCell', variant.has('bedDotCell') ? Number(variant.get('bedDotCell')) : 14);
    this.f('uStepSoftPx', variant.has('stepSoftPx') ? Number(variant.get('stepSoftPx')) : 1);
    this.f('uRingContrast', variant.has('ringContrast') ? Number(variant.get('ringContrast')) : 0);
    this.f('uRingCount', variant.has('ringCount') ? Number(variant.get('ringCount')) : 7);
    this.f('uRingSize', variant.has('ringSize') ? Number(variant.get('ringSize')) : 1);
    this.f('uBedFlat', variant.has('bedFlat') ? Number(variant.get('bedFlat')) : 0);
    this.f('uSandCrown', variant.has('sandCrown') ? Number(variant.get('sandCrown')) : 0);
    this.f('uFootRim', variant.has('rim') ? Number(variant.get('rim')) : 0.0);
    this.f('uCrevice', variant.has('crevice') ? Number(variant.get('crevice')) : 0.0);
    this.f('uFaceDark', variant.has('faceDark') ? Number(variant.get('faceDark')) : 0.0);
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
    this.f('uCrispShore', variant.has('crispShore') ? Number(variant.get('crispShore')) : 1.0);
    this.f('uBankRock', variant.has('bankRock') ? Number(variant.get('bankRock')) : 0.25);
    this.f('uWaterSoft', variant.has('waterSoft') ? Number(variant.get('waterSoft')) : 32);
    this.f('uLandDither', variant.has('landDither') ? Number(variant.get('landDither')) : 0.25);
    this.f('uCrackDark', variant.has('crackDark') ? Number(variant.get('crackDark')) : 0.75);
    this.f('uSlopeTexture', variant.has('slopeTexture') ? Number(variant.get('slopeTexture')) : 0.3);
    this.f('uShallowDepth', variant.has('shallowDepth') ? Number(variant.get('shallowDepth')) : this.config.material?.shallowDepth ?? 2);
    this.f('uDeepDepth', variant.has('deepDepth') ? Number(variant.get('deepDepth')) : this.config.material?.deepDepth ?? 42);
    // Water looks (card E1): every default is the earlier water.
    this.f('uBedLit', variant.has('bedLit') ? Number(variant.get('bedLit')) : 0);
    this.f('uBedTint', variant.has('bedTint') ? Number(variant.get('bedTint')) : 0.85);
    this.v('uShallowMean', (this.config.water?.shallowMeanRGB || this.config.water?.shallowRGB || [60, 115, 163]).map(v => v / 255));
    this.f('uBedBright', variant.has('bedBright') ? Number(variant.get('bedBright')) : 1);
    this.f('uRingFade', variant.has('ringFade') ? Number(variant.get('ringFade')) : 0);
    this.f('uHillLight', variant.has('hillLight') ? Number(variant.get('hillLight')) : 1);
    this.f('uBedContrast', variant.has('bedContrast') ? Number(variant.get('bedContrast')) : 1);
    this.f('uDeepEdge', variant.has('deepEdge') ? Number(variant.get('deepEdge')) : 0);
    this.f('uDeepEdgeDepth', variant.has('deepEdgeDepth') ? Number(variant.get('deepEdgeDepth')) : 0);
    // Card E8 (Painted Desert); 0 is every world as it was.
    this.f('uBaseBand', variant.has('baseBand') ? Number(variant.get('baseBand')) : 0);
    this.f('uBaseBandLow', variant.has('baseBandLow') ? Number(variant.get('baseBandLow')) : 4);
    this.f('uBaseBandHigh', variant.has('baseBandHigh') ? Number(variant.get('baseBandHigh')) : 6.5);
    this.f('uBaseBandWander', variant.has('baseBandWander') ? Number(variant.get('baseBandWander')) : 1);
    this.f('uBaseBandGaps', variant.has('baseBandGaps') ? Number(variant.get('baseBandGaps')) : 0.45);
    // Card G4 (Painted Desert); 0 is every world as it was.
    this.f('uDesertCapFlat', variant.has('desertCapFlat') ? Number(variant.get('desertCapFlat')) : 0);
    // E9 (Green rock faces).
    this.f('uRockMoss', variant.has('rockMoss') ? Number(variant.get('rockMoss')) : 1);
    this.f('uShineOutside', variant.has('shineOutside') ? Number(variant.get('shineOutside')) : 1);
    this.f('uFaceRelief', variant.has('faceRelief') ? Number(variant.get('faceRelief')) : 1);
    this.f('uRockDetail', variant.has('rockDetail') ? Number(variant.get('rockDetail')) : 1);
    // Flow bake (card F1): only read where a bake wrote planes 20-24 (uFlowOn).
    this.f('uFlowTint', variant.has('flowTint') ? Number(variant.get('flowTint')) : 1);
    this.f('uFlowShallow', variant.has('flowShallow') ? Number(variant.get('flowShallow')) : 0.85);
    this.f('uFlowStreak', variant.has('flowStreak') ? Number(variant.get('flowStreak')) : 0.5);
    this.f('uFlowStreakLen', variant.has('flowStreakLen') ? Number(variant.get('flowStreakLen')) : 140);
    this.f('uFlowBank', variant.has('flowBank') ? Number(variant.get('flowBank')) : 0.9);
    // E6: shine roughness gate and headroom (0: the earlier shine exactly).
    this.f('uShineGate', variant.has('shineGate') ? Number(variant.get('shineGate')) : 0);
    this.f('uShineHeadroom', variant.has('shineHeadroom') ? Number(variant.get('shineHeadroom')) : 0);
    this.f('uPockmark', variant.has('pockmark') ? Number(variant.get('pockmark')) : 0);
    this.f('uPockSize', variant.has('pockSize') ? Number(variant.get('pockSize')) : 5);
    // G8 (Moon).
    this.f('uMoonCups', variant.has('moonCups') ? Number(variant.get('moonCups')) : 0);
    this.f('uMoonCupSize', variant.has('moonCupSize') ? Number(variant.get('moonCupSize')) : 5.5);
    this.f('uMoonCupDepth', variant.has('moonCupDepth') ? Number(variant.get('moonCupDepth')) : 1.4);
    this.f('uMoonRibs', variant.has('moonRibs') ? Number(variant.get('moonRibs')) : 0);
    this.f('uMoonRibDepth', variant.has('moonRibDepth') ? Number(variant.get('moonRibDepth')) : 1);
    this.f('uMoonRibDark', variant.has('moonRibDark') ? Number(variant.get('moonRibDark')) : 0);
    this.f('uMoonFolds', variant.has('moonFolds') ? Number(variant.get('moonFolds')) : 0);
    this.f('uMoonFoldSpacing', variant.has('moonFoldSpacing') ? Number(variant.get('moonFoldSpacing')) : .9);
    this.f('uIceSlate', variant.has('iceSlate') ? Number(variant.get('iceSlate')) : 0);
    this.f('uIceCrystal', variant.has('iceCrystal') ? Number(variant.get('iceCrystal')) : 0);
    this.f('uIceCrest', variant.has('iceCrest') ? Number(variant.get('iceCrest')) : 0);
    // G3: the fringe's offset copies (ringShift 0: the earlier concentric lines).
    this.f('uRingShift', variant.has('ringShift') ? Number(variant.get('ringShift')) : 0);
    this.f('uRingShiftDir', variant.has('ringShiftDir') ? Number(variant.get('ringShiftDir')) : 315);
    this.f('uRingScatter', variant.has('ringScatter') ? Number(variant.get('ringScatter')) : 0.5);
    this.f('uRingWobble', variant.has('ringWobble') ? Number(variant.get('ringWobble')) : 3);
    this.f('uRingLobe', variant.has('ringLobe') ? Number(variant.get('ringLobe')) : 22);
    this.f('uRingTaper', variant.has('ringTaper') ? Number(variant.get('ringTaper')) : 0);
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
    this.f('uShoalBump', variant.has('shoalBump') ? Number(variant.get('shoalBump')) : 0);
    this.f('uShoalBumpPx', variant.has('shoalBumpPx') ? Number(variant.get('shoalBumpPx')) : 6);
    this.f('uShoalRag', variant.has('shoalRag') ? Number(variant.get('shoalRag')) : 0);
    this.f('uShoalStairs', variant.has('shoalStairs') ? Number(variant.get('shoalStairs')) : 0);
    this.f('uShoalGrain', variant.has('shoalGrain') ? Number(variant.get('shoalGrain')) : 0);
    this.f('uShoalShoreSoft', variant.has('shoalShoreSoft') ? Number(variant.get('shoalShoreSoft')) : 0);
    this.fieldsDirty = true;
  }

  variantNumber(key, fallback) { const x = Number(this.variant.get(key)); return Number.isFinite(x) && this.variant.has(key) ? x : fallback; }

  // H5: a shader that pastes the common source under EROSION, as erosion.wgsl does.
  preprocessShader(source) { return preprocess(source, this.commonSource, new Set(['EROSION'])); }

  // H2, H16 rock column. The world's table (config.column, from materials/<world>.json; sculpt-column.js). No sections: no column, the
  // hash beds as before. Erosion reads the same uniforms, so the bake and the pass share one column.
  setColumn() {
    const column = this.config.column, v = this.variant;
    const number = (key, fallback) => { const x = Number(v.get(key)); return Number.isFinite(x) && v.has(key) ? x : fallback; };
    const {beds, starts, bands} = columnRows(column, this.config.variant);
    // Refinement can run before any relief bake; its column offset must not depend on the last displayed view.
    this.set('uBedSpacing', number('bedSpacing', 12));
    this.set('uBedDip', number('bedDip', 0));
    this.set('uBedDipDir', number('bedDipDir', 90));
    this.i('uColumnSectionCount', starts.length);
    this.set('uColumnContrast', number('columnContrast', 1));
    this.set('uColumnBeds', beds);
    this.set('uColumnSections', starts);
    this.set('uColumnWander', column?.wander?.value ?? 0);
    this.set('uColumnTerrain', [...(column?.wander?.terrain || [0, 0, 0]), 0]);
    this.set('uColumnOrigin', column?.origin === 'plain' ? this.config.baseHeight - this.config.seaLevel : 0);
    this.set('uBandSpacing', bands[0]);
    this.set('uBandLine', bands[1]);
  }

  // Encodes the bake into the given encoder, or submits it on its own.
  bakeFields(quality = 'full', encoder = null, timer = null) {
    const preview = quality !== 'full';
    const v = this.variant;
    const number = (key, fallback) => { const x = Number(v.get(key)); return Number.isFinite(x) && v.has(key) ? x : fallback; };
    const set = (name, value) => this.set(name, Number(value));
    set('uGrid', this.grid); set('uSize', this.size); set('uBase', this.config.baseHeight - this.config.seaLevel); set('uSea', 0);
    {
      set('uWeatherMaps', this.weatherMaps ? 1 : 0);
      for (const [key, fallback] of [['terraceBreak', 0], ['terraceCalm', 0], ['wetSwath', 0], ['outcrop', 0], ['rillDepth', 0], ['rillSpacing', 8], ['stoneDensity', 0], ['stoneSize', 5]])
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
    set('uFaceStreakFrom', number('faceStreakFrom', 0.3));
    set('uGentleRelief', number('gentleRelief', 0.6));
    set('uBoulderDensity', preview ? 0 : number('boulders', 0));
    set('uBoulderSize', number('boulderSize', 9));
    set('uBoulderFoot', number('boulderFoot', 0.5));
    set('uBoulderCluster', number('boulderCluster', 0.6));
    set('uBoulderMoss', number('boulderMoss', 0.35));
    set('uDebris', preview ? 0 : number('debris', 0));
    set('uDebrisReach', number('debrisReach', 48));
    set('uDebrisSize', number('debrisSize', 6));
    set('uDebrisSort', number('debrisSort', 0.8));
    set('uRepose', number('repose', 0.6));
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
    // Rock structure (card E3); 0 is the scattered rock every world had.
    set('uRockOrder', number('rockOrder', 0));
    set('uBedVary', number('bedVary', 0.5));
    set('uBedLedge', number('bedLedge', 0.5));
    set('uJointDepth', number('jointDepth', 2));
    set('uGrooveSpacing', number('grooveSpacing', 36));
    set('uGrooveAngle', number('grooveAngle', 0));
    set('uGrooveRun', number('grooveRun', 120));
    set('uBedHeight', number('bedHeight', 0));
    set('uRockFrom', number('rockFrom', 0.6));
    if (this.sun) this.v('uSun', this.sun);
    set('uCracksOn', preview && v.get('previewCracks') !== '1' ? 0 : 1);
    set('uWindAngle', number('wind', 20));
    set('uRipple', number('ripple', 7));
    set('uRippleHeight', number('rippleHeight', 1.4));
    set('uBanding', number('banding', 0));
    set('uApron', number('apron', 0));
    set('uWorms', number('worms', 0));
    set('uBoulderRound', number('boulderRound', 0));
    set('uBandSoftness', number('bandSoftness', 0.35));
    set('uBandJag', number('bandJag', 0));
    set('uBandFade', number('bandFade', 0.75));
    set('uBeachDistance', this.layers.has('beach') ? (this.config.material?.beachWidth ?? 120) * number('beachWidth', 0.6) : 0);
    set('uHasBeach', this.layers.has('beach'));
    set('uSandBanding', number('sandBanding', 0));
    set('uSandBandSpacing', number('sandBandSpacing', 2));
    set('uReliefOctaves', preview ? Math.min(3, number('reliefOctaves', 5)) : number('reliefOctaves', 5));
    // E9 (Green rock faces).
    set('uGullyDepth', number('gullyDepth', 0));
    set('uGullyWidth', number('gullyWidth', 14));
    set('uGullyShade', number('gullyShade', 0));
    set('uRibTilt', number('ribTilt', 0));
    set('uBedPunch', number('bedPunch', 0));
    set('uFacetTilt', number('facetTilt', 0));
    set('uFacetCoarse', number('facetCoarse', 0));
    // G2 (rock faces follow the slope).
    set('uCliffFollow', number('cliffFollow', 0));
    set('uCliffReach', number('cliffReach', 20));
    set('uCliffWide', number('cliffWide', 56));
    set('uCliffFlat', number('cliffFlat', .04));
    set('uCliffRise', number('cliffRise', 0));
    set('uCliffBed', number('cliffBed', .5));
    set('uCliffStagger', number('cliffStagger', 0));
    set('uCliffFine', number('cliffFine', 0));
    set('uCliffDomain', number('cliffDomain', 90));
    {
      set('uBlocks', number('blocks', 0)); set('uBlockRow', number('blockRow', 4.5)); set('uBlockWidth', number('blockWidth', 9)); set('uBlockTilt', number('blockTilt', .5));
      set('uBlockStep', number('blockStep', .8)); set('uBlockSeam', number('blockSeam', .5)); set('uBlockChip', number('blockChip', 1.2));
      set('uHillBlocks', number('hillBlocks', 0));
    }
    this.setColumn();
    const own = !encoder;
    encoder ||= this.device.createCommandEncoder({label: 'relief bake'});
    const pass = encoder.beginComputePass({label: 'relief bake', timestampWrites: timer?.timestampWrites});
    pass.setPipeline(this.bakePipeline);
    pass.setBindGroup(0, this.commonBindGroup('bake'));
    pass.setBindGroup(1, this.fieldsOut);
    pass.dispatchWorkgroups(Math.ceil((this.bakeWidth ?? this.size) / 8), Math.ceil((this.bakeHeight ?? this.size) / 8));
    pass.end();
    if (own) {
      timer?.encode(encoder);
      this.flushUniforms();
      this.device.queue.submit([encoder.finish()]);
    }
    this.fieldsDirty = false;
    this.bakedQuality = quality;
  }

  // Milliseconds from submitting one bake to the GPU finishing it, with
  // the GPU idle before; lastBakeGPU holds the pass's own GPU time.
  async timeBake(quality = 'full') {
    await this.device.queue.onSubmittedWorkDone();
    const timer = this.timer(), start = performance.now();
    const encoder = this.device.createCommandEncoder({label: 'relief bake'});
    this.bakeFields(quality, encoder, timer);
    timer?.encode(encoder);
    this.flushUniforms();
    this.device.queue.submit([encoder.finish()]);
    await this.device.queue.onSubmittedWorkDone();
    const ms = performance.now() - start;
    if (timer) this.lastBakeGPU = await timer.result();
    return ms;
  }

  // The same for one draw (options as draw()); the fields are baked first,
  // so this times the terrain pass alone. Returns {ms, gpuMs}.
  async timeDraw(options = {}) {
    const full = options.quality === 'full';
    if (this.fieldsDirty || (full && this.bakedQuality !== 'full')) this.bakeFields(full ? 'full' : 'preview');
    await this.device.queue.onSubmittedWorkDone();
    const start = performance.now();
    this.draw(options);
    await this.device.queue.onSubmittedWorkDone();
    const ms = performance.now() - start;
    return {ms, gpuMs: (await this.gpuResult) ?? null};
  }

  sample(x, y) {
    const gx = Math.max(0, Math.min(this.grid - 1, x / (this.size - 1) * (this.grid - 1)));
    const gy = Math.max(0, Math.min(this.grid - 1, y / (this.size - 1) * (this.grid - 1)));
    const ix = Math.floor(gx), iy = Math.floor(gy), jx = Math.min(ix + 1, this.grid - 1), jy = Math.min(iy + 1, this.grid - 1);
    const fx = gx - ix, fy = gy - iy;
    return (this.height[iy * this.grid + ix] * (1 - fx) + this.height[iy * this.grid + jx] * fx) * (1 - fy)
      + (this.height[jy * this.grid + ix] * (1 - fx) + this.height[jy * this.grid + jx] * fx) * fy;
  }

  pick(x, y) {
    const wx = x / this.canvas.width * this.size;
    const sy = y / this.canvas.height * this.size;
    // Trace from the near side to pick visible geometry even at steep folds.
    // Fine displacement is below brush precision; the editable field owns picks.
    let previousY = sy + 170;
    let previous = previousY - (Math.max(this.config.seaLevel, this.sample(wx, previousY)) - this.config.baseHeight) * 0.5 - sy;
    for (let wy = previousY - 2; wy >= sy - 80; wy -= 2) {
      const value = wy - (Math.max(this.config.seaLevel, this.sample(wx, wy)) - this.config.baseHeight) * 0.5 - sy;
      if (value <= 0 && previous >= 0) {
        const t = previous / Math.max(1e-6, previous - value);
        return [Math.max(0, Math.min(this.size - 1, wx)), Math.max(0, Math.min(this.size - 1, previousY - t * 2))];
      }
      previous = value; previousY = wy;
    }
    return [Math.max(0, Math.min(this.size - 1, wx)), Math.max(0, Math.min(this.size - 1, sy))];
  }
}
