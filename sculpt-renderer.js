// One displaced surface, shared by every terrain brush. Prototype renderer
// on WebGPU (no WebGL fallback). Shaders: engine-common.wgsl (shared),
// sculpt-vert.wgsl and engine-frag.wgsl (the draw), engine-bake.wgsl (the
// fields bake of a chunk, a compute pass).

import {tablePlacementRows,coverRows,groundPool,PLACEMENT_ROW,PLANT_REACH,surfaceRows,SURFACE_FLAGS_ROW} from './sculpt-material-model.js';
import {MaterialCache,writeMaterialSlot} from './sculpt-material-cache.js';
import {copyMaterial,materialCacheUsage,materialStaged,materialTint,materialColor,materialRenderKey,MATERIAL_REPEAT,MATERIAL_SLOTS,MAP_ROLES,LIBRARY,materialStates,gameArtColor} from './sculpt-materials.js';
import {columnRows,columnTones,toneColor} from './sculpt-column.js';
import {waterTone} from './sculpt-knobs.js';
import {makeNoise, NOISE_SIZE} from './sculpt-noise.js';
import {requestAdapter, WEBGPU_NEEDS as NO_WEBGPU} from './sculpt-webgpu.js';
import {RockWeather} from './sculpt-rock-weather.js';
import {VoxelSurface} from './sculpt-volume.js';
import {terrainAllocation} from './sculpt-memory.js';
import {extractGates, gateValues, gateKey, uniformStages, worldUniformDelta, PER_CHUNK_UNIFORMS} from './sculpt-gates.js';
import {digestGuardRequested, installDigestGuard} from './sculpt-digest-guard.js';
// The textures a chunk's feed fills, which the input checksum hashes texel by texel (inputDigest).
export const SURFACE_RECORD_BYTES = 32; // PackedSurfaceRecord in engine-frag.wgsl
export const INPUT_TEXTURES = ['heightTexture', 'routeTexture', 'gridTexture', 'maskTexture'];
// A uniform field's bytes in uniformData (sculpt-renderer.js uniformLayout).
const uniformSpan = f => f.stride ? f.stride * f.count : (f.width || 1) * 4;

// The mask planes when the config names none: as many as MASK_KEYS (sculpt-scene.js, which says what each holds). The masks texture array has a layer per 4 planes.
const MASK_PLANE_COUNT = 25;
// The output stage's candidate table (engine-output.wgsl): CELLS^3 grid points, N = 8 one-byte palette indices each.
const OUTPUT_TABLE_CELLS = 64 ** 3, OUTPUT_TABLE_BYTES = OUTPUT_TABLE_CELLS * 8;

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
// Recipe tables are Rock and Ground. Rock slot 0 members also have scalar aliases, so the world's own
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
  const structs = new Map();
  for (const name of ['Rock', 'Ground']) {
    if (!source.includes(`struct ${name}`)) continue;
    const members = new Map(); let size = 0;
    for (const f of structFields(source, name)) {
      const type = FIELD_TYPES[f.type];
      if (!type || (f.array && f.type !== 'vec4f')) throw new Error(`nanolathe: unsupported ${name} field "${f.line}"`);
      const align = f.array ? 16 : type[0];
      size = Math.ceil(size / align) * align;
      members.set(f.name, {offset: size, kind: type[2], width: type[1] / 4, count: f.count, stride: f.array ? 16 : 0});
      size += f.array ? 16 * f.count : type[1];
    }
    structs.set(name, {members, stride: Math.ceil(size / 16) * 16});
  }
  const fields = new Map();
  let offset = 0;
  for (const f of structFields(source, 'Uniforms')) {
    if (structs.has(f.type)) {
      const {members, stride} = structs.get(f.type);
      offset = Math.ceil(offset / 16) * 16;
      fields.set(f.name, {offset, kind: 'struct', count: f.count, stride, members});
      if (f.type === 'Rock') for (const [name, m] of members) fields.set(name, {offset: offset + m.offset, kind: m.kind, width: m.width, count: m.count, stride: m.stride});
      offset += stride * f.count;
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

class SpecializationMiss extends Error { constructor(state) { super('nanolathe: pipelines for these gates are not built yet'); this.state = state; } }
class PipelinesPending extends Error { constructor(state,ready) { super('Terrain pipelines are compiling in the background.');this.name='PipelinesPending';this.key=state.key;this.ready=ready; } }

// The engine's materials, uniforms and passes. ChunkTerrainRenderer (sculpt-chunk-renderer.js) is the renderer that is constructed: it adds
// the per-chunk textures, the memory accounting and renderChunk.
// The diagnostic views (engine-frag.wgsl u.diagnosticView, from 1): the page's `view`, and the Surface section's layer preview (setSurfacePreview).
const DIAGNOSTIC_VIEWS = ['diffuse','occlusion','shadow','exposure','shading','material','cracks','color','relief','roughness','wetness','palette-color','surface-layer'];
const SURFACE_FACT_VIEW = DIAGNOSTIC_VIEWS.length + 1;   // 14 to 17: the Surface section's fact view of a previewed layer's condition 0 to 3
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
    this.grounds = new Map();
    this.rocks = new Map();   // rock recipes in slots 1-15 (setRocks)
    this.drawnMeans = new Map(); this.drawnBase = new Map();   // slot -> the GPU's mean color of its material, and that less its graph's Color (drawnColor)
    this.lastGPU = null;
    this.lastBakeGPU = null;
    // Set by the page to show WebGPU errors that arrive after a call returns.
    this.onerror = null;
    this.worldEpoch = 0;   // the world textures' version, in the input checksum (worldResource)
    this.worldTextures = new Set();
  }

  // Validation and device errors arrive asynchronously; report each one.
  reportError(message) {
    if(this.recovering)return;
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
    // The adapter's own buffer limits, not WebGPU's defaults (256 MB buffers, 128 MB bindings): the voxel solid and the page caches are
    // sized against them, and a desktop GPU offers gigabytes. The default limits stay the floor requestAdapter checks.
    const requiredLimits = {maxBufferSize: adapter.limits.maxBufferSize, maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize};
    const device = this.device = await adapter.requestDevice({requiredFeatures: features, requiredLimits});
    if (digestGuardRequested()) this.guard = installDigestGuard(device);   // tests and debug runs only: before any resource is made
    device.lost.then(info => {
      if(info.reason==='destroyed'||this.recovering)return;
      if(this.config.onDeviceLost?.(info)){this.recovering=true;return;}
      this.reportError(`device lost: ${info.message}`);
    });
    device.addEventListener('uncapturederror',event=>{
      if(this.recovering){event.preventDefault();return;}
      if(typeof GPUOutOfMemoryError!=='undefined'&&event.error instanceof GPUOutOfMemoryError&&this.config.onMemoryPressure?.(event.error)){this.recovering=true;event.preventDefault();return;}
      this.reportError(event.error.message);
    });
    this.format = navigator.gpu.getPreferredCanvasFormat();
    // A plain unorm canvas stores the shader's values as they are, as the
    // WebGL canvas did (no sRGB encoding); opaque, as WebGL's alpha: false.
    this.context.configure({device, format: this.format, alphaMode: 'opaque',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST});

    // The engine's shaders (engine-frag / engine-bake / engine-common) draw every world.
    // Every world's materials are numbers: the config names its table (config.materialTable).
    const tableUrl = this.config.materialTable;
    this.materialData = null;
    const names = ['sculpt-vert.wgsl', 'engine-frag.wgsl', 'engine-common.wgsl', 'engine-bake.wgsl', tableUrl, 'materials/palette.json', 'engine-volume.wgsl', 'engine-erosion.wgsl', 'engine-weather.wgsl', 'engine-ground.wgsl', 'engine-ground-dither.wgsl', 'engine-output.wgsl'];
    const [vert, frag, common, bake, ...extra] = await Promise.all(names.map(async name => {
      const r = await fetch(name);
      if (!r.ok) throw new Error(`Cannot load ${name}`);
      return r.text();
    }));
    const modelTable = extra[0];
    const palette = JSON.parse(extra[1]);
    this.paletteColours = palette.colours;
    this.paletteIndexed = palette.indexed;
    // Slots 0-9 and 246-254 of the game's palette are Windows' static system colours, which its map art does not draw with (255, white,
    // it does: snow and surf). A colour that only those slots hold stays out of the lookup unless a world's table picks it by entry.
    const art = new Set(palette.indexed.filter((_, i) => gameArtColor(i)).map(String));
    this.paletteArt = palette.colours.map((_, i) => i).filter(i => art.has(String(palette.colours[i])));
    this.commonSource = common;
    this.outputSource = extra[extra.length - 1];
    this.volumeSource = extra[2];
    this.timeSources={erosion:this.preprocessShader(extra[3]),maps:this.preprocessShader(extra[4])};
    this.layout = uniformLayout(preprocess(common, '', new Set()));
    this.uniformData = new ArrayBuffer(this.layout.size);
    this.uniformView = new DataView(this.uniformData);
    this.uniformBuffer = device.createBuffer({label: 'terrain uniforms', size: this.layout.size, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC});
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
    const fragSource=preprocess(frag.replace('/*VOLUME*/',this.volumeSource),common,new Set(['VOLUME_RENDER','COLOR_PASS']));
    const geometrySource=preprocess(frag.replace('/*VOLUME*/',this.volumeSource),common,new Set(['VOLUME_RENDER','GEOMETRY_PASS']));
    const bakeSource=preprocess(bake,common,new Set(['BAKE']));
    this.stageSources=[{source:fragSource,stage:'F'},{source:geometrySource,stage:'E',roots:['geometryMain']},{source:bakeSource,stage:'C'}];
    const bakeGates=extractGates(bakeSource,this.layout.fields);
    const [vertModule,bakeModule] = await Promise.all([
      compile('sculpt-vert.wgsl', preprocess(vert, common, new Set())),
      compile('engine-bake.wgsl', bakeGates.source)]);
    // One uniform-gated fragment pipeline per rock mask. Color/light changes
    // no longer compile a new ray marcher; only relief gates specialize.
    this.specParts = {vertModule,bakeModule,bake:bakeGates.gates,keyOrder:[...bakeGates.gates.keys()]};
    this.specCache = new Map();
    this.specBuilding = new Map();
    this.specUsed = [];
    this.specStats = {built: 0, ms: 0, pipelinesPerSet:2};

    // Group 0: the uniforms and the world fields, shared by the draw and the
    // bake (binding 6 is the fields for the draw, the routes for the bake).
    // Group 1: the draw's materials, or the bake's output.
    const both = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE;
    const texture = (binding, visibility, sampleType = 'float', viewDimension = '2d') => ({binding, visibility, texture: {sampleType, viewDimension}});
    const sampler = (binding, visibility) => ({binding, visibility, sampler: {type: 'filtering'}});
    this.commonLayout = device.createBindGroupLayout({label: 'world fields', entries: [
      {binding: 0, visibility: both, buffer: {type: 'uniform'}},
      texture(1, both, 'unfilterable-float'), texture(2, both), texture(4, both, 'float', '2d-array'), texture(6, both),
      sampler(7, both), sampler(8, both), texture(9, both, 'float', '2d-array'),texture(10,both,'unfilterable-float'),texture(11,both,'unfilterable-float'),texture(12,both,'unfilterable-float'),texture(13,both,'unfilterable-float','2d-array'),texture(14,both,'float','2d-array'),{binding:15,visibility:both,buffer:{type:'read-only-storage'}},texture(16,both,'unfilterable-float','2d-array'),texture(17,both,'unfilterable-float','2d-array')]});
    const F = GPUShaderStage.FRAGMENT;
    // Group 1 is empty since the palette lookup went to the output stage (engine-output.wgsl); it stays so groups 2 and 3 keep their numbers.
    this.materialLayout = device.createBindGroupLayout({label: 'materials', entries: []});
    // The bake's group 1: the fields texture, and the loose-stone mask lattice (looseMain fills it, the bake reads it).
    const fieldsLayout = device.createBindGroupLayout({label: 'fields out', entries: [
      {binding: 0, visibility: GPUShaderStage.COMPUTE, storageTexture: {access: 'write-only', format: 'rgba16float'}},
      {binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'storage'}}]});
    const bakeLayout = device.createPipelineLayout({bindGroupLayouts: [this.commonLayout, fieldsLayout]});
    this.fieldsLayout = fieldsLayout;
    this.bakePipelineLayout = bakeLayout;
    this.rockWeather = await RockWeather.create(this,preprocess);
    this.voxel = await VoxelSurface.create(this,this.volumeSource,preprocess);
    const timeModules=Object.values(this.timeSources).map(source=>({source,stage:'B'}));
    this.timeUniformFields=[...uniformStages(timeModules).keys()].sort();
    this.uniformStages=uniformStages([...this.stageSources,...timeModules]);this.stageSources=null;
    this.geometryOutLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:F,buffer:{type:'storage'}},{binding:1,visibility:F,buffer:{type:'uniform'}}]});
    this.geometryInLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:F,buffer:{type:'read-only-storage'}},{binding:1,visibility:F,buffer:{type:'uniform'}},{binding:2,visibility:F,texture:{sampleType:'float',viewDimension:'2d-array'}},{binding:3,visibility:F,buffer:{type:'storage'}}]});
    // The Surface section's inspector: the color pass records what it drew at one pixel here (engine-frag.wgsl probeOut; setProbe, readProbe).
    this.probeBuffer=device.createBuffer({label:'surface inspector',size:96*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});this.track(this.probeBuffer,'surface inspector',96*4,'shared');
    this.geometrySettings=device.createBuffer({label:'geometry frame',size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});this.track(this.geometrySettings,'geometry frame',16,'shared');
    this.geometryPipelineLayout=device.createPipelineLayout({bindGroupLayouts:[this.commonLayout,this.materialLayout,this.voxel.drawLayout,this.geometryOutLayout]});
    this.drawPipelineLayout=device.createPipelineLayout({bindGroupLayouts:[this.commonLayout,this.materialLayout,device.createBindGroupLayout({entries:[]}),this.geometryInLayout]});
    const genericReady=this.buildGeneric(compile,fragSource,bakeSource,geometrySource);
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
    // The startup generation: the materials (GPU) are started first and the noise (CPU) is made while they build.
    this.textures = {};
    this.groundCache = new MaterialCache(this, preprocess(extra[5], common, new Set()), preprocess(extra[6], common, new Set()));
    const generation = performance.now();
    this.outputPaletteBuffer();
    this.textures.noise = this.noiseTexture();
    await genericReady;
    this.generationMs = performance.now() - generation;
    const variant = new URLSearchParams(location.search);
    // H4: the engine's own knob values go in first, over the world's, under the page's query.
    for (const [key, value] of Object.entries(this.config.engineDefaults || {})) if (!variant.has(key)) variant.set(key, value);
    for (const [key, value] of Object.entries(this.config.defaults || {}))
      if (!variant.has(key)) variant.set(key, value);
    this.variant = variant;
    this.means = {};
    // The world's surfaces (config.layers, from its world.materials): which optional stages it has (a beach, mineral margins' body).
    this.layers = new Set(this.config.layers || []);
    // The world's rock material's broad color (the strata's default tones and a rock with no color of its own read it before the map's
    // materials are set; sculpt-materials.js materialTint).
    this.means.rock = materialTint(LIBRARY[this.config.materials?.rock] ?? {nodes: [{type: 'output', in: {}}]});
    // The slope cover's broad color the same way: the Colors row Slope cover starts from it (sculpt.js defaultColor).
    this.means.slope = materialTint(LIBRARY[this.config.materials?.slope] ?? {nodes: [{type: 'output', in: {}}]});
    this.transitionBody = this.layers.has('body');
    this.applyKnobs();
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
    this.worldResource(texture);
    return {texture, view: texture.createView({dimension: layers > 1 ? '2d-array' : '2d'}),
      sampler: this.sampler({minFilter, magFilter, mipmapFilter: mipmaps ? 'linear' : 'nearest', addressModeU: 'repeat', addressModeV: 'repeat'})};
  }

  // The draw's noise (sculpt-noise.js): periodic RGBA8, linear filtering, repeating.
  noiseTexture() {
    const start = performance.now();
    const texture = this.device.createTexture({label: 'noise', size: [NOISE_SIZE, NOISE_SIZE], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST});
    this.device.queue.writeTexture({texture}, makeNoise(), {bytesPerRow: NOISE_SIZE * 4}, [NOISE_SIZE, NOISE_SIZE]);
    this.worldResource(texture);this.noiseMs = performance.now() - start;
    return {texture, view: texture.createView(), sampler: this.sampler({minFilter: 'linear', magFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat'})};
  }

  // The output stage's palette (engine-output.wgsl): the colours map art draws with, or the ones the table's `palette.entries` pick, rgb in
  // 0..255.
  outputPaletteBuffer() {
    const colours = (this.materialData.palette?.entries ?? this.paletteArt).map(i => this.paletteColours[i]);
    if (this.outputPalette) { this.worldTextures.delete(this.outputPalette); this.outputPalette.destroy(); }
    this.outputPalette = this.worldResource(this.device.createBuffer({label: 'output palette', size: Math.max(16, colours.length * 16), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST}));
    this.device.queue.writeBuffer(this.outputPalette, 0, new Float32Array(colours.flatMap(c => [c[0], c[1], c[2], 0])));
    this.outputCount = colours.length;
    // Its candidate table (engine-output.wgsl buildTable, 64^3 grid points x 8 indices, 2 MiB), built before the next output pass reads it.
    for (const b of [this.outputTable, this.outputPaletteCount]) if (b) { this.worldTextures.delete(b); b.destroy(); }
    this.outputTable = this.worldResource(this.device.createBuffer({label: 'output palette table', size: OUTPUT_TABLE_BYTES, usage: GPUBufferUsage.STORAGE}));
    this.outputPaletteCount = this.worldResource(this.device.createBuffer({label: 'output palette count', size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST}));
    this.device.queue.writeBuffer(this.outputPaletteCount, 0, new Uint32Array([colours.length, 0, 0, 0]));
    this.track?.(this.outputTable, 'output palette table', OUTPUT_TABLE_BYTES, 'shared');
    this.outputTableBuilt = false;
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


  setColors(colors = {}, options) { this.colorOverrides={...colors};this.worldDirty=true;return this.syncWorld(options); }

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

  // P6: the bake and loose-mask pipelines for the gates' values now. A set of values not built yet throws SpecializationMiss; the async
  // callers (renderChunk, timeBake, timeDraw) build it and run again. The check at the end of draw() catches a gate that changed between the
  // bake's encode and the draw's: both run with the uniform buffer as it is at submit.
  specKey() {
    const parts = this.specParts, slots = this.rockSlots(), values = gateValues(parts.bake, this.uniformView, slots, this.groundSlots());
    return {key: gateKey(values, parts.keyOrder), values};
  }
  // Original uniform comparisons, compiled before input is enabled. The draw
  // is shared by every level; relief finals retain their specialized cache.
  async buildGeneric(compile,fragSource,bakeSource,geometrySource) {
    const start=performance.now(),device=this.device;
    const [fragmentModule,bakeModule,geometryModule]=await Promise.all([compile('generic terrain',fragSource),compile('generic relief',bakeSource),compile('terrain geometry',geometrySource)]);
    this.genericPipelines=Object.fromEntries(await Promise.all([0,15].map(async rockMask=>{
      const constants={rockMask},compute=entryPoint=>({module:bakeModule,entryPoint,constants});
      const [draw,bake,loose,geometry]=await Promise.all([
        device.createRenderPipelineAsync({label:'generic terrain',layout:this.drawPipelineLayout,vertex:{module:this.specParts.vertModule,entryPoint:'vertexMain'},fragment:{module:fragmentModule,entryPoint:'fragmentMain',targets:[{format:this.format}],constants},primitive:{topology:'triangle-list',cullMode:'none'}}),
        device.createComputePipelineAsync({label:'generic relief bake',layout:this.bakePipelineLayout,compute:compute('bakeMain')}),
        device.createComputePipelineAsync({label:'generic loose mask',layout:this.bakePipelineLayout,compute:compute('looseMain')}),
        device.createRenderPipelineAsync({label:'terrain geometry',layout:this.geometryPipelineLayout,vertex:{module:this.specParts.vertModule,entryPoint:'vertexMain'},fragment:{module:geometryModule,entryPoint:'geometryMain',targets:[{format:this.format}],constants},primitive:{topology:'triangle-list',cullMode:'none'}})]);
      return [rockMask,{draw,bake,loose,geometry}];
    })));
    this.specStats.genericBuilt=2;this.specStats.genericMs=performance.now()-start;this.specStats.genericUses=0;this.specStats.deferred=0;
  }
  specialized(kind) {
    const state = this.specKey();
    const generic=this.pipelineMode==='generic';
    if(kind==='draw'||generic){
      this.specUsed.push(generic?'generic:'+state.values.rockMask:state.key);this.specStats.genericUses++;
      return this.genericPipelines[state.values.rockMask][kind];
    }
    const entry = this.specCache.get(state.key);
    if (!entry) throw new SpecializationMiss(state);
    this.specUsed.push(state.key);
    return entry[kind];
  }
  specCheck() {
    const state = this.specKey();
    const key=this.pipelineMode==='generic'?'generic:'+state.values.rockMask:state.key;
    if (this.specUsed.some(k => k !== key)) throw new SpecializationMiss(state);
  }
  get drawPipeline() { return this.specialized('draw'); }
  get bakePipeline() { return this.specialized('bake'); }
  get loosePipeline() { return this.specialized('loose'); }
  // The voxel solid's and rock weather's passes for the rockMask now (engine-common.wgsl), from `built` (mask -> passes); a miss builds them
  // with the bake's pipelines (specialize) and the work runs again.
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
      const {bakeModule,bake} = this.specParts, device = this.device, start = performance.now();
      const pick = gates => Object.fromEntries([...gates.keys()].map(id => [id, values[id]]));
      const compute = entryPoint => ({module: bakeModule, entryPoint, constants: pick(bake)});
      this.specBuilding.set(key, Promise.all([
        device.createComputePipelineAsync({label: 'relief bake', layout: this.bakePipelineLayout, compute: compute('bakeMain')}),
        device.createComputePipelineAsync({label: 'loose mask', layout: this.bakePipelineLayout, compute: compute('looseMain')})]).then(([bake, loose]) => {
        if (this.specCache.size >= 24) this.specCache.delete(this.specCache.keys().next().value);
        this.specCache.set(key, {bake, loose});
        this.specStats.built++; this.specStats.ms += performance.now() - start;
      }).finally(() => this.specBuilding.delete(key)));
    }
    await this.specBuilding.get(key);
  }
  // A preview miss retries with uniform gates and never starts a compile.
  // A view final yields the renderer while its specialized set builds; direct
  // readers and export await specialization as before.
  async withPipelines(work,{preview=false,defer=false}={}) {
    const previous=this.pipelineMode;this.pipelineMode='specialized';
    try{for(let attempt=0;;attempt++){
      this.specUsed=[];
      try{return await work();}
      catch(error){
        if(!(error instanceof SpecializationMiss)||attempt>=4)throw error;
        if(preview){this.pipelineMode='generic';continue;}
        const ready=this.specialize(error.state);
        if(defer){this.specStats.deferred++;throw new PipelinesPending(error.state,ready);}
        await ready;
      }
    }}finally{this.pipelineMode=previous;}
  }

  flushUniforms() {
    if (!this.uniformsDirty) return;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);
    this.uniformsDirty = false;
  }

  // Group 0 with the fields (draw) or the routes (bake) at binding 6.
  commonBindGroup(kind,source=this,uniformBuffer=this.uniformBuffer) {
    if(source===this&&this.bindGroups[kind])return this.bindGroups[kind];
    const group=this.device.createBindGroup({label: kind, layout: this.commonLayout, entries: [
      {binding: 0, resource: {buffer: uniformBuffer}},
      ...[source.heightTexture, this.textures.noise.texture].map((t, i) => ({binding: i + 1, resource: t.createView()})),
      {binding: 4, resource: source.gridTexture.createView({dimension: '2d-array'})},
      {binding: 6, resource: (kind === 'bake'||kind==='rock-weather' ? source.routeTexture : source.fieldsTexture).createView()},
      {binding: 7, resource: this.linearClamp}, {binding: 8, resource: this.linearRepeat},
      {binding: 9, resource: source.maskTexture.createView({dimension: '2d-array'})},
      {binding:10,resource:(kind==='rock-weather'?source.rockWeather.empty:(source.rockWeather.final??source.rockWeather.empty)).createView()},
      {binding:11,resource:(kind==='rock-weather'?source.rockWeather.empty:(source.rockWeather.source??source.rockWeather.empty)).createView()},
      {binding:12,resource:(kind==='rock-weather'?source.rockWeather.empty:(source.rockWeather.rim??source.rockWeather.empty)).createView()},
      {binding:13,resource:this.groundCache.fieldTexture.createView({dimension:'2d-array'})},{binding:14,resource:this.groundCache.colorTexture.createView({dimension:'2d-array'})},{binding:15,resource:{buffer:this.groundCache.programBuffer}},{binding:16,resource:this.groundCache.heightTexture.createView({dimension:'2d-array'})},{binding:17,resource:this.groundCache.meanTexture.createView({dimension:'2d-array'})}]});
    if(source===this)this.bindGroups[kind]=group;return group;
  }

  // Group 1: empty (see materialLayout).
  materialBindGroup() {
    return this.bindGroups.materials ??= this.device.createBindGroup({label: 'materials', layout: this.materialLayout, entries: []});
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
    const rows = this.config.placement ? tablePlacementRows(this.config) : this.placementRows(variant);   // the map's copy (sculpt-save.js ENGINE_TABLES)
    // The world's surface layers in the rows before the placement rows (engine-frag.wgsl surfaceStage): two a layer from row 0, the stages' heads at SURFACE_HEAD_ROW.
    // A material layer draws the map's material that carries its id (worldLayer).
    const slotOf = id => [...(this.grounds || new Map())].find(([, m]) => m.worldLayer === id)?.[0] ?? -1;
    const surface = surfaceRows(this.config.surface, slotOf, this.surfaceHidden);
    const head = [...surface.rows, ...Array.from({length: SURFACE_FLAGS_ROW - surface.rows.length}, () => [0, 0, 0, 0]), surface.flags, ...surface.head];
    // The layers that grow plants (engine-bake.wgsl plantMask), and the switch for the bake's plant pass.
    this.plantLayers = surface.plants.length; if (this.layout) this.i('uPlantsOn', this.plantLayers > 0);
    this.surfaceLooks = surface.flags[1];   // the facts that look around a pixel which a rule reads: the plant bake's apron grows by their reach
    return [...head, ...rows, ...coverRows(this.config.material?.site, surface.plants, variant?.get?.('plantRelief') ?? 1)];
  }


  // What the startup generation took, in ms: the noise (CPU), the palette lookup and the materials (GPU), and the wall time of all three.
  get startupParts() { return {noise: this.noiseMs, total: this.generationMs}; }

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
  // height this light had before it was a control (the authored sunHeight default): z comes out .82 to within a bit, and the uniforms are the same.
  sunVector(light = 'original') {
    const tilt = this.variant.has('sunTilt') ? Number(this.variant.get('sunTilt')) : 1;
    const x = light === 'alternate' ? 0.72 : -0.72, y = 0.38 * tilt;
    // Held to the control's range (20 to 75): a lower sun's shadows need a height grid apron (sculpt-chunk-renderer.js reaches) that pushes even
    // a 32 px chunk past a 128 MB budget at 15 degrees.
    const height = this.variant.has('sunHeight') ? Math.min(75, Math.max(20, Number(this.variant.get('sunHeight')))) : null;
    return [x, y, height === null ? 0.82 : Math.hypot(x, y) * Math.tan(height * Math.PI / 180)];
  }

  async allocateGeometry(){
    const width=this.canvas.width+2,height=this.canvas.height+2,bytes=width*height*SURFACE_RECORD_BYTES;
    if(bytes>this.device.limits.maxStorageBufferBindingSize)throw Error('The geometry record exceeds the GPU memory storage binding limit.');
    if(this.geometryRecord&&(!this.resources.has(this.geometryRecord)||this.geometryRecord.size!==bytes)){this.release(this.geometryRecord);this.geometryRecord=null;}
    if(this.geometryTarget&&(!this.resources.has(this.geometryTarget)||this.geometryTarget.width!==width||this.geometryTarget.height!==height)){this.release(this.geometryTarget);this.geometryTarget=null;}
    if(!this.geometryRecord||!this.geometryTarget)await terrainAllocation(this.device,()=>{
      if(!this.geometryRecord){this.geometryRecord=this.device.createBuffer({label:'surface geometry record',size:bytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});this.track(this.geometryRecord,'surface geometry record',bytes,'working');}
      if(!this.geometryTarget){this.geometryTarget=this.device.createTexture({label:'geometry raster target',size:[width,height],format:this.format,usage:GPUTextureUsage.RENDER_ATTACHMENT});this.track(this.geometryTarget,'geometry raster target',width*height*4,'working');}
    });
    this.device.queue.writeBuffer(this.geometrySettings,0,new Uint32Array([width,height,this.probe?this.probe.x+1:0,this.probe?this.probe.y+1:0]));
  }
  // The art pixel the inspector asks about ({x, y}), or none (null): the next color draws record what they drew there; readProbe reads it.
  setProbe(at=null){this.probe=at&&{x:Math.max(0,Math.floor(at.x)),y:Math.max(0,Math.floor(at.y))};if(at)this.device.queue.writeBuffer(this.probeBuffer,0,new Float32Array(96));}
  async readProbe(){
    const read=this.device.createBuffer({label:'surface inspector read',size:96*4,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}),encoder=this.device.createCommandEncoder({label:'surface inspector read'});
    encoder.copyBufferToBuffer(this.probeBuffer,0,read,0,96*4);this.device.queue.submit([encoder.finish()]);
    try{await read.mapAsync(GPUMapMode.READ);const v=[...new Float32Array(read.getMappedRange().slice(0))];read.unmap();if(!v[0])return null;
      const count=Math.min(32,Math.round(v[24])),layers=Array.from({length:count},(_,k)=>({row:Math.round(v[25+2*k]),cover:v[26+2*k]}));
      // rock: the rock type whose numbers the pixel read (its slot: 0 the world's) and how much of its rock shows there (0-1).
      return {color:v.slice(1,4),slot:Math.round(v[4]),aboveSea:v[5],facts:[...v.slice(6,20),...v.slice(90,94)],wet:v[21],surf:v[22],ownGround:v[23]>.5,layers,rock:{slot:Math.round(v[20]),share:v[89]}};}
    finally{read.destroy();}
  }

  geometryBinding(layout,record=this.geometryRecord,masks=this.colorMaskTexture,frame=this.geometrySettings){return this.device.createBindGroup({layout,entries:[{binding:0,resource:{buffer:record}},{binding:1,resource:{buffer:frame}},...(layout===this.geometryInLayout?[{binding:2,resource:masks.createView({dimension:'2d-array'})},{binding:3,resource:{buffer:this.probeBuffer}}]:[])]});}
  encodeColor(commands,pipeline,rect,first,timer,{record=this.geometryRecord,group=this.commonBindGroup('draw'),masks=this.colorMaskTexture,target=this.voxelColor,geometryGroup=null}={}){
    const pass=commands.beginRenderPass({label:'terrain color',colorAttachments:[{view:target.createView(),clearValue:{r:0,g:0,b:0,a:1},loadOp:first?'clear':'load',storeOp:'store'}],timestampWrites:timer?.timestampWrites});
    pass.setPipeline(pipeline);pass.setScissorRect(...rect);pass.setBindGroup(0,group);pass.setBindGroup(1,this.materialBindGroup());pass.setBindGroup(3,geometryGroup??this.geometryBinding(this.geometryInLayout,record,masks));pass.draw(3);pass.end();timer?.encode(commands);
  }
  // The output stage (engine-output.wgsl): the draw's lit color in `source` reduced to the game palette, pixel by pixel, and drawn
  // into `target` at `offset`. `chunk` holds the raster's place and scale (a cached tile's own settings); the world's settings are current:
  // palette off, Clay, a diagnostic view, or a raster coarser than art pixels pass the true color through.
  // The palette's candidate table is built here, in its own submission: the queue runs in order, so every output pass encoded after this
  // call reads the finished table.
  async outputPipelines() {
    if (!this.outputPipeline) {
      const device = this.device, module = device.createShaderModule({label: 'engine-output.wgsl', code: this.outputSource});
      const errors = (await module.getCompilationInfo()).messages.filter(m => m.type === 'error');
      if (errors.length) throw new Error('nanolathe: engine-output.wgsl does not compile:\n' + errors.map(e => `${e.lineNum}:${e.linePos} ${e.message}`).join('\n'));
      const [pipeline, blit, build] = await Promise.all([
        device.createComputePipelineAsync({label: 'output stage', layout: 'auto', compute: {module, entryPoint: 'patternPixels'}}),
        device.createRenderPipelineAsync({label: 'output blit', layout: 'auto', vertex: {module, entryPoint: 'blitVertex'}, fragment: {module, entryPoint: 'blitFragment', targets: [{format: this.format}]}, primitive: {topology: 'triangle-list'}}),
        device.createComputePipelineAsync({label: 'output palette table', layout: 'auto', compute: {module, entryPoint: 'buildTable'}})]);
      this.outputTableBuild = build; this.outputBlit = blit; this.outputPipeline = pipeline;
    }
    if (!this.outputTableBuilt) this.buildOutputTable();
  }
  buildOutputTable() {
    const device = this.device, count = this.outputPaletteCount;
    const encoder = device.createCommandEncoder({label: 'output palette table'}), pass = encoder.beginComputePass({label: 'output palette table'});
    pass.setPipeline(this.outputTableBuild);
    pass.setBindGroup(0, device.createBindGroup({layout: this.outputTableBuild.getBindGroupLayout(0), entries: [{binding: 2, resource: {buffer: this.outputPalette}}, {binding: 6, resource: {buffer: this.outputTable}}, {binding: 7, resource: {buffer: count}}]}));
    pass.dispatchWorkgroups(OUTPUT_TABLE_CELLS / 64);
    pass.end();
    device.queue.submit([encoder.finish()]);
    this.outputTableBuilt = true;
  }
  // The output stage's working texture, at least width x height. A batch sizes it once before its first pass: a release mid-encoder would
  // take it from the passes already encoded. An eviction releases it with the other working textures.
  outputSize(width, height) {
    const kept = this.outputTexture && (!this.resources || this.resources.has(this.outputTexture)) ? this.outputTexture : null;
    if (kept && kept.width >= width && kept.height >= height) return;
    const w = Math.max(width, kept?.width ?? 0), h = Math.max(height, kept?.height ?? 0);
    if (kept) { if (this.release) this.release(kept); else kept.destroy(); }
    this.outputTexture = this.device.createTexture({label: 'output stage color', size: [w, h], format: 'rgba8unorm', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING});
    this.track?.(this.outputTexture, 'output stage color', w * h * 4, 'working');
  }
  encodeOutput(encoder, source, target, {chunk = this.uniformData, offset = [0, 0], width = source.width, height = source.height, slot = 0} = {}) {
    const device = this.device, field = name => this.layout.fields.get(name), settings = new DataView(chunk);
    const int = name => this.uniformView.getInt32(field(name).offset, true), float = (name, k = 0) => settings.getFloat32(field(name).offset + 4 * k, true);
    const scale = float('chunkScale') || 1;
    const enabled = int('quantize') !== 0 && int('clay') === 0 && int('diagnosticView') === 0 && scale <= 1;
    // The threshold is keyed to art pixels (in drawn pixels when the raster is finer): an export's screen origin carries the base's half
    // height, a preview's does not, so both subtract it from the screen origin and a preview's pixels are an export's.
    const shift = Math.floor((this.config.baseHeight ?? 0) / 2);
    const origin = [Math.round(float('chunkScreenOrigin', 0) / scale), Math.round((float('chunkScreenOrigin', 1) - shift) / scale)];
    this.outputJobs ??= [];
    const job = this.outputJobs[slot] ??= device.createBuffer({label: 'output job', size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
    const words = new Int32Array([origin[0], origin[1], width, height, offset[0], offset[1], this.outputCount, enabled ? 1 : 0]);
    device.queue.writeBuffer(job, 0, words);
    this.outputSize(width, height);
    const compute = encoder.beginComputePass({label: 'output stage'});
    compute.setPipeline(this.outputPipeline);
    compute.setBindGroup(0, device.createBindGroup({layout: this.outputPipeline.getBindGroupLayout(0), entries: [
      {binding: 0, resource: source.createView()}, {binding: 1, resource: this.outputTexture.createView()}, {binding: 2, resource: {buffer: this.outputPalette}}, {binding: 3, resource: {buffer: job}}, {binding: 5, resource: {buffer: this.outputTable}}]}));
    compute.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
    compute.end();
    const blit = encoder.beginRenderPass({label: 'output blit', colorAttachments: [{view: target.createView(), loadOp: 'load', storeOp: 'store'}]});
    blit.setPipeline(this.outputBlit);
    blit.setViewport(offset[0], offset[1], width, height, 0, 1);
    blit.setScissorRect(offset[0], offset[1], width, height);
    blit.setBindGroup(0, device.createBindGroup({layout: this.outputBlit.getBindGroupLayout(0), entries: [{binding: 3, resource: {buffer: job}}, {binding: 4, resource: this.outputTexture.createView()}]}));
    blit.draw(3);
    blit.end();
  }
  // LP5 step 0 only: the current tile's color pass, never scheduler routing.
  async recolor(options=this.worldOptions){
    if(this.busy)throw Error('The renderer is already rendering.');
    if(!this.geometryValid||!this.resources?.has(this.geometryRecord))throw Error('No current geometry record.');
    this._busy=true;
    try {
      await this.previousChunk;const start=performance.now();this.syncWorld(options);
      const delta=worldUniformDelta(this.geometryUniformSnapshot,this.uniformData,this.layout,this.uniformStages);
      if(delta.stage&&delta.stage<'F')throw Error('The edit requires '+delta.stage+', not only color.');
      this.flushUniforms();const encoder=this.device.createCommandEncoder({label:'cached terrain color'}),timer=this.timer();
      this.encodeColor(encoder,this.genericPipelines[this.rockMask()].draw,[0,0,this.canvas.width,this.canvas.height],true,timer);
      await this.outputPipelines();this.encodeOutput(encoder,this.voxelColor,this.context.getCurrentTexture());this.device.queue.submit([encoder.finish()]);this.previousChunk=this.device.queue.onSubmittedWorkDone();await this.previousChunk;
      return {milliseconds:performance.now()-start,gpuMilliseconds:timer?await timer.result():null,recordBytes:this.geometryRecord.size};
    } finally { this._busy=false; }
  }

  async draw({clay = false, light = 'original', detail = this.config.material?.surfaceRelief ?? 1, materialWeathering = this.config.material?.materialWeathering ?? 0, transitionDetail = this.config.material?.transitionDetail ?? .65, exact = false, signal, stale, digest = null} = {}) {
    const current=()=>{signal?.throwIfAborted();if(stale?.())throw new DOMException('The scene changed during a terrain bake.','AbortError');};
    current();const start = performance.now(), device = this.device;
    this.syncWorld({clay,light,detail,materialWeathering,transitionDetail,exact});
    // Before the checksum: an edited material graph regenerates its cache layers here, which moves the world version (worldResource) the
    // checksum holds. Taken first, a check-only draw would match the old picture and the next drawn tile would carry the old version.
    // A layer whose pipeline still compiles keeps its last picture. Only the map's own view draws from that (drawWhileCompiling); an export
    // (exact), any other renderer, and a layer with no picture yet wait for the compile (materialsReady).
    this.syncMaterialCache();
    if (this.groundCache.compiling(this.drawWhileCompiling && !exact)) { await this.materialsReady(); current(); }
    this.i('uMaterialReady', this.materialReady);
    this.i('uTransitionBody', Boolean(this.transitionBody&&this.materialReady&&materialWeathering>0));
    // digest {reuse, check}: the checksum of everything the rest of the draw reads (inputDigest). A caller that still holds the picture of the same
    // checksum keeps it: the same inputs draw the same bytes (AGENTS.md rule 12), so the bake, the voxel solid and the march are skipped.
    // check: only the checksum, as a promise, so a caller can submit several tiles' checksums and wait once. Without reuse the draw does
    // not wait for it either: the result's digest is then a promise.
    let inputDigest = null;
    if (digest) {
      inputDigest = this.inputDigest();
      if (digest.check) return {check: inputDigest};
      if (digest.reuse) { inputDigest = await inputDigest; if (inputDigest && inputDigest === digest.reuse) return {reused: true, digest: inputDigest}; }
    }
    this.guard?.begin();
    const encoder = device.createCommandEncoder({label: 'terrain'});
    // P6: a SpecializationMiss abandons this encoder, its bake included, so the fields go back to unbaked and the retry bakes again.
    const dirty = this.fieldsDirty;
    let drawPipeline,pipelineKey;
    try {
      if (dirty) this.bakeFields(encoder);
      // Looked up after the bake, which sets some of the gates' uniforms.
      drawPipeline = this.drawPipeline;
      this.specCheck();pipelineKey=this.specKey().key;
    } catch (error) { this.fieldsDirty = dirty; throw error; }
    this.flushUniforms();device.queue.submit([encoder.finish()]);
    if(!this.voxelColor||this.voxelColor.width!==this.canvas.width||this.voxelColor.height!==this.canvas.height){
      if(this.voxelColor)this.release(this.voxelColor);
      this.voxelColor=device.createTexture({label:'voxel terrain color',size:[this.canvas.width,this.canvas.height],format:this.format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC|GPUTextureUsage.TEXTURE_BINDING});
      this.track(this.voxelColor,'voxel terrain color',this.canvas.width*this.canvas.height*4,'working');
    }
    this.geometryValid=false;await this.allocateGeometry();current();
    this.release(this.maskPackBuffer);this.release(this.maskPackSettings);this.maskPackBuffer=this.maskPackSettings=null;
    const timers=[];let clearGeometry=true;
    await this.voxel.render((commands,volume,rect,first)=>{
      // Clear once in the first solid/draw submission, preserving earlier pieces
      // if the voxel allocator splits or retries a later piece.
      if(clearGeometry){commands.clearBuffer(this.geometryRecord);clearGeometry=false;}
      const timer=this.timer();if(timer)timers.push(timer);
      const pass=commands.beginRenderPass({label:'terrain geometry',colorAttachments:[{view:this.geometryTarget.createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:first?'clear':'load',storeOp:'store'}],timestampWrites:timer?.timestampWrites});
      const [x,y,w,h]=rect.map(Math.round);pass.setPipeline(this.genericPipelines[this.rockMask()].geometry);pass.setScissorRect(x,y,w+2,h+2);
      pass.setBindGroup(0,this.commonBindGroup('draw'));pass.setBindGroup(1,this.materialBindGroup());pass.setBindGroup(2,volume);pass.setBindGroup(3,this.geometryBinding(this.geometryOutLayout));pass.draw(3);pass.end();timer?.encode(commands);
    },current);
    // E is complete for every piece. F has no solid dependency, so its
    // bounded mask staging replaces D instead of adding to the terrain peak.
    this.voxel.clear();current();await this.outputPipelines();current();
    // Packing, color and presentation have no readback between them. One submit
    // keeps the GPU running across all three instead of waiting on the page.
    const color=device.createCommandEncoder({label:'terrain color'});await this.packColorMasks(color);current();
    const colorTimer=this.timer();if(colorTimer)timers.push(colorTimer);
    this.encodeColor(color,drawPipeline,[0,0,this.canvas.width,this.canvas.height],true,colorTimer);
    this.geometryUniformSnapshot=new Uint32Array(this.uniformData.slice(0));this.geometryValid=true;
    this.encodeOutput(color,this.voxelColor,this.context.getCurrentTexture());device.queue.submit([color.finish()]);
    this.gpuResult=Promise.all(timers.map(t=>t.result())).then(values=>{const ms=values.reduce((a,b)=>a+(b??0),0);this.lastGPU=ms;return ms;});
    if (this.guard && !await this.guard.check(this, await inputDigest)) inputDigest = null;   // after a violation, no tile is kept
    return {milliseconds:performance.now()-start,gpuMilliseconds:this.lastGPU,pipelineKey,digest:inputDigest};
  }
  // A checksum of a draw's inputs: every texel of the input textures (INPUT_TEXTURES; textureSums), the settings uniform's bytes but the
  // per-chunk ones, the shader specialization, the canvas and texture sizes, and the world version (worldResource). Null when an input
  // texture is missing (no reuse). The guard (sculpt-digest-guard.js, in tests and ?digestGuard runs) checks that nothing else reaches a draw.
  // Everything is taken when it is called: the sums are submitted then, and the uniform bytes copied, so the next tile may change both
  // while the promise waits for the GPU.
  inputDigest() {
    const textures = INPUT_TEXTURES.map(k => this[k]);
    if (textures.some(t => !t)) return Promise.resolve(null);
    const sums = this.textureSums(textures.map(texture => ({texture})));
    // The per-chunk uniforms are left out: the draw sets them from this tile's region and inputs (the bake writes looseGrid after this
    // point, so until then it holds the previous tile's), and both are already in the checksum.
    const bytes = new Uint8Array(this.uniformData.slice(0));
    for (const name of PER_CHUNK_UNIFORMS) { const f = this.layout.fields.get(name); if (f) bytes.fill(0, f.offset, f.offset + uniformSpan(f)); }
    let ca = 0x811c9dc5, cb = 0x01000193;
    for (let i = 0; i < bytes.length; i++) { ca = Math.imul(ca ^ bytes[i], 0x01000193); cb = Math.imul(cb + bytes[i] + i, 0x5bd1e995) ^ (cb >>> 15); }
    const rest = '|' + this.specKey().key + '|' + this.canvas.width + 'x' + this.canvas.height + '|' + textures.map(t => t.width + 'x' + t.height + 'x' + t.depthOrArrayLayers).join(',') + '|w' + this.worldEpoch;
    return sums.then(s => [...s, ca >>> 0, cb >>> 0].map(n => n.toString(16)).join('.') + rest);
  }
  // Two 32-bit sums of per-texel hashes for each {texture, mip} (mip 0 by default), on the GPU; 8 bytes a texture read back. Float formats.
  async textureSums(entries) {
    const device = this.device, n = entries.length;
    this.digestPipe ??= device.createComputePipeline({label: 'texture sums', layout: 'auto', compute: {entryPoint: 'main', module: device.createShaderModule({label: 'texture sums', code: `
      @group(0) @binding(0) var t: texture_2d_array<f32>;
      @group(0) @binding(1) var<storage, read_write> acc: array<atomic<u32>>;
      @group(0) @binding(2) var<uniform> salt: vec4u;
      var<workgroup> wa: atomic<u32>;
      var<workgroup> wb: atomic<u32>;
      fn mixed(x: u32) -> u32 { var h = x; h ^= h >> 16u; h *= 0x7feb352du; h ^= h >> 15u; h *= 0x846ca68bu; h ^= h >> 16u; return h; }
      @compute @workgroup_size(8, 8, 1) fn main(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_index) li: u32) {
        if (li == 0u) { atomicStore(&wa, 0u); atomicStore(&wb, 0u); }
        workgroupBarrier();
        let d = textureDimensions(t);
        if (id.x < d.x && id.y < d.y) {
          let v = bitcast<vec4u>(textureLoad(t, vec2i(id.xy), i32(id.z), 0));
          let i = (id.z * d.y + id.y) * d.x + id.x;
          var a = mixed(i ^ salt.x); var b = mixed(i * 0x9e3779b9u + salt.y);
          for (var c = 0u; c < 4u; c++) { a = mixed(a ^ v[c]); b = mixed(b + v[c] * 0x85ebca6bu + c); }
          atomicAdd(&wa, a); atomicAdd(&wb, b);
        }
        workgroupBarrier();
        if (li == 0u) { atomicAdd(&acc[salt.z * 2u], atomicLoad(&wa)); atomicAdd(&acc[salt.z * 2u + 1u], atomicLoad(&wb)); }
      }`})}});
    const S = GPUBufferUsage, acc = device.createBuffer({label: 'texture sums', size: 8 * n, usage: S.STORAGE | S.COPY_SRC | S.COPY_DST}), read = device.createBuffer({label: 'texture sums read', size: 8 * n, usage: S.MAP_READ | S.COPY_DST});
    const salts = entries.map((e, k) => { const b = device.createBuffer({label: 'texture sums salt', size: 16, usage: S.UNIFORM | S.COPY_DST}); device.queue.writeBuffer(b, 0, new Uint32Array([0x51ed270b * (k + 1), 0x2545f491 * (k + 3), k, 0])); return b; });
    try {
      const encoder = device.createCommandEncoder({label: 'texture sums'});
      entries.forEach(({texture: t, mip = 0}, k) => {
        const pass = encoder.beginComputePass({label: 'texture sums'}); pass.setPipeline(this.digestPipe);
        pass.setBindGroup(0, device.createBindGroup({layout: this.digestPipe.getBindGroupLayout(0), entries: [{binding: 0, resource: t.createView({dimension: '2d-array', baseMipLevel: mip, mipLevelCount: 1})}, {binding: 1, resource: {buffer: acc}}, {binding: 2, resource: {buffer: salts[k]}}]}));
        pass.dispatchWorkgroups(Math.ceil(Math.max(1, t.width >> mip) / 8), Math.ceil(Math.max(1, t.height >> mip) / 8), t.depthOrArrayLayers); pass.end();
      });
      encoder.copyBufferToBuffer(acc, 0, read, 0, 8 * n); device.queue.submit([encoder.finish()]);
      await read.mapAsync(GPUMapMode.READ); const sums = [...new Uint32Array(read.getMappedRange().slice(0))]; read.unmap();
      return sums;
    } finally { acc.destroy(); read.destroy(); salts.forEach(b => b.destroy()); }
  }
  // A texture every draw may read and only the renderer's set-up writes (noise, palette, generated materials, the plain's tiles): its version
  // is in the input checksum, so making or rewriting one must come through here. The guard fails a draw that sees one change otherwise.
  worldResource(texture) { this.worldEpoch++; this.worldTextures.add(texture); return texture; }
  // What a draw may bind, for the guard: an input (in the checksum), a resource the draw makes from its inputs before reading it, or a world
  // texture (worldResource). A new binding fails the guard until it is placed here, and an input or a world texture needs the checksum to cover it.
  digestClasses() {
    const voxel = this.voxel, rock = this.rockWeather;
    const input = new Set([...INPUT_TEXTURES.map(k => this[k]), this.uniformBuffer].filter(Boolean));
    // The fields and rock weather textures (bakeFields), the loose-stone mask (encodeLooseMask), the voxel solid and its region settings
    // (VoxelSurface.render; the guard checks the settings' bytes against the checksum). The voxel solid and rock weather count what they
    // made, not what they hold: a large tile draws in pieces and hands a piece's resources back before the draw ends.
    // Also the color pass's geometry record and frame (allocateGeometry; the frame holds the canvas size) and its mask staging (packColorMasks).
    // The inspector's record (probeBuffer) is written by the color pass and read only by the page.
    // The output stage (encodeOutput) reads the color pass's picture (voxelColor), writes its working texture and takes its job from the
    // chunk's settings and the palette's length; the palette and its candidate table are world resources (outputPaletteBuffer).
    const own = new Set([this.fieldsTexture, this.looseBuffer, voxel?.uniform, this.geometryRecord, this.geometrySettings, this.maskPackBuffer, this.maskPackSettings, this.probeBuffer, this.voxelColor, this.outputTexture, ...(this.outputJobs ?? [])].filter(Boolean));
    const produced = {has: r => own.has(r) || Boolean(voxel?.made?.has(r) || rock?.made?.has(r))};
    // volatile: produced resources whose bytes may differ between two draws of the same checksum without changing the picture. The voxel
    // settings hold the solid's pool capacity, predicted from the last count; a piece that overflows builds again at its count.
    const volatile = new Set([voxel?.uniform].filter(Boolean));
    return {input, produced, world: this.worldTextures, volatile};
  }
  // The uniform fields that differ between two copies of uniformData, without the ones the GPU writes (gpuWrittenUniforms): for the guard.
  digestUniformDiff(a, b) {
    const x = new Uint8Array(a), y = new Uint8Array(b), skip = this.gpuWrittenUniforms(), names = [];
    for (const [name, f] of this.layout.fields) {
      if (skip.has(name) || f.members) continue;
      for (let i = f.offset, end = f.offset + uniformSpan(f); i < end; i++) if (x[i] !== y[i]) { names.push(name); break; }
    }
    return names;
  }
  gpuWrittenUniforms() { return new Set(); }

  // Surface knobs read from the variant; callable again after a change.
  // One writer for world uniforms. Chunk availability/paint flags stay with
  // the chunk. Repeated draws reuse the synchronized world; public setters
  // force a refresh when their data changes.
  syncWorld(options=this.worldOptions??{}) {
    const {clay=false,light='original',detail=this.config.material?.surfaceRelief??1,materialWeathering=this.config.material?.materialWeathering??0,transitionDetail=this.config.material?.transitionDetail??.65,exact=false}=options;
    const values={clay,light,detail,materialWeathering,transitionDetail,exact};
    // exact changes only the review sun: without one, an export's options are the view's and its draw reuses the view's sync.
    const key=JSON.stringify([{...values,exact:exact&&Boolean(this.reviewSun())},this.grid,this.size]);
    if(!this.worldDirty&&this.worldSyncKey===key)return {fields:[],stage:null,rockSlots:[],channels:[]};
    const wasDirty=this.fieldsDirty;
    this.worldOptions=values;
    const variant = this.variant;
    // Placement is live state too: refreshing only scalar uniforms left these
    // controls frozen at startup in the generated materials.
    this.set('uMaterialTable', this.placementTable(variant));
    this.f('uLightCap', variant.has('lightCap') ? Number(variant.get('lightCap')) : 1.13);
    this.f('uShadeDepth', variant.has('shadeDepth') ? Number(variant.get('shadeDepth')) : 1.0);
    this.f('uAmbient', variant.has('ambient') ? Number(variant.get('ambient')) : 0.42);
    this.f('uSlopeMarks', variant.has('slopeMarks') ? Number(variant.get('slopeMarks')) : 0);
    this.f('uWrinkles', variant.has('wrinkles') ? Number(variant.get('wrinkles')) : 0);
    this.f('uCrystalSeam', variant.has('crystalSeam') ? Number(variant.get('crystalSeam')) : 0);
    // Each surface has its own gloss, sharpness and roughness. Only the world and rock rows carry grain widths.
    const shine = ['Ground', 'Slope', 'Rock', 'Sand', 'Crystal'].map(m => {
      const knob = (suffix, fallback) => variant.has(`shine${m}${suffix}`) ? Number(variant.get(`shine${m}${suffix}`)) : fallback;
      return [knob('', 0), knob('Sharp', 24), knob('Rough', 0), m === 'Ground' || m === 'Rock' ? knob('Scale', 6) : 0];
    });
    // With no slope cover the slope group has no share, so its gloss does not wake the pass (worldControlRequirement says the same).
    const slopeShare = Number(variant.get('slopeTexture') ?? 0.3) > 0 || Boolean(this.config.material?.slopeSand);
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
    this.f('uSlabShallows', Math.min(1, Math.max(0, Number(variant.get('slabShallows')) || 0)));
    // G7 (Crystal): the craters' web and light; the defaults leave every world as it was.
    this.f('uCrystalCraterWeb', variant.has('crystalCraterWeb') ? Number(variant.get('crystalCraterWeb')) : 0);
    this.f('uCrystalCraterWebPx', variant.has('crystalCraterWebPx') ? Number(variant.get('crystalCraterWebPx')) : 14);
    this.f('uCrystalCraterWobble', variant.has('crystalCraterWobble') ? Number(variant.get('crystalCraterWobble')) : 0);
    this.f('uCrystalCraterGap', variant.has('crystalCraterGap') ? Number(variant.get('crystalCraterGap')) : 0);
    this.f('uCrystalCraterTone', variant.has('crystalCraterTone') ? Number(variant.get('crystalCraterTone')) : 0);
    this.f('uCrystalCraterLight', variant.has('crystalCraterLight') ? Number(variant.get('crystalCraterLight')) : 1);
    this.f('uCrystalSeamEnd', variant.has('crystalSeamEnd') ? Number(variant.get('crystalSeamEnd')) : 0.74);
    // E11: shallow water round 2; every default is the earlier look.
    this.f('uShelfWander', variant.has('shelfWander') ? Number(variant.get('shelfWander')) : 0);
    this.f('uStepSoftPx', variant.has('stepSoftPx') ? Number(variant.get('stepSoftPx')) : 1);
    this.f('uBedFlat', variant.has('bedFlat') ? Number(variant.get('bedFlat')) : 0);
    this.f('uSandCrown', variant.has('sandCrown') ? Number(variant.get('sandCrown')) : 0);
    this.f('uFlatBank', variant.has('flatBank') ? Number(variant.get('flatBank')) : 0.0);
    this.f('uFlatShadow', variant.has('flatShadow') ? Number(variant.get('flatShadow')) : 0.0);
    this.f('uFlatOcclusion', variant.has('flatOcclusion') ? Number(variant.get('flatOcclusion')) : 0.4);
    this.f('uSandEdge', variant.has('sandEdge') ? Number(variant.get('sandEdge')) : 1.0);
    this.f('uSandLight', variant.has('sandLight') ? Number(variant.get('sandLight')) : 0.25);
    this.f('uBeachWidth', variant.has('beachWidth') ? Number(variant.get('beachWidth')) : 1.0);
    this.f('uFaceFill', variant.has('faceFill') ? Number(variant.get('faceFill')) : 0);
    this.f('uFillFollow', variant.has('fillFollow') ? Number(variant.get('fillFollow')) : 0);
    this.f('uRockCrown', variant.has('rockCrown') ? Number(variant.get('rockCrown')) : 0);
    for (const [u, k, d] of [['uHighland', 'highland', 0], ['uHighFrom', 'highFrom', 8], ['uHighReach', 'highReach', 10]]) this.f(u, variant.has(k) ? Number(variant.get(k)) : d);
    this.f('uStrata', variant.has('strata') ? Number(variant.get('strata')) : 0);
    this.f('uStrataContrast', variant.has('strataContrast') ? Number(variant.get('strataContrast')) : 0.6);
    this.f('uStrataGrain', variant.has('strataGrain') ? Number(variant.get('strataGrain')) : 1);
    this.f('uSandGrass', variant.has('sandGrass') ? Number(variant.get('sandGrass')) : 0.6);
    this.f('uSandDust', variant.has('sandDust') ? Number(variant.get('sandDust')) : 0.5);
    this.f('uPool', groundPool(this.config.material));   // card tilepool: the period level ground repeats with
    this.f('uCrispShore', variant.has('crispShore') ? Number(variant.get('crispShore')) : 1.0);
    this.f('uBankRock', variant.has('bankRock') ? Number(variant.get('bankRock')) : 0.25);
    this.f('uWaterSoft', variant.has('waterSoft') ? Number(variant.get('waterSoft')) : 32);
    this.f('uCrackDark', variant.has('crackDark') ? Number(variant.get('crackDark')) : 0.75);
    this.f('uSlopeTexture', variant.has('slopeTexture') ? Number(variant.get('slopeTexture')) : 0.3);
    this.f('uShallowDepth', variant.has('shallowDepth') ? Number(variant.get('shallowDepth')) : this.config.material?.shallowDepth ?? 2);
    this.f('uDeepDepth', variant.has('deepDepth') ? Number(variant.get('deepDepth')) : this.config.material?.deepDepth ?? 42);
    // Water looks (card E1): every default is the earlier water.
    this.f('uBedTint', variant.has('bedTint') ? Number(variant.get('bedTint')) : 0.85);
    this.f('uBedBright', variant.has('bedBright') ? Number(variant.get('bedBright')) : 1);
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
    this.f('uStepCrease', variant.has('stepCrease') ? Number(variant.get('stepCrease')) : 0);
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
    // G6: Ice blocks and mesas (0: the earlier look exactly).
    this.f('uIceSoft', variant.has('iceSoft') ? Number(variant.get('iceSoft')) : 0);
    this.f('uIceSnow', variant.has('iceSnow') ? Number(variant.get('iceSnow')) : 0);
    this.f('uIceFall', variant.has('iceFall') ? Number(variant.get('iceFall')) : 0);
    this.f('uIceApron', variant.has('iceApron') ? Number(variant.get('iceApron')) : 0);
    this.f('uIceFrost', variant.has('iceFrost') ? Number(variant.get('iceFrost')) : 0);
    // G1: shallow water round 3; every default is the earlier look.
    this.f('uShoalRag', variant.has('shoalRag') ? Number(variant.get('shoalRag')) : 0);
    this.f('uShoalShoreSoft', variant.has('shoalShoreSoft') ? Number(variant.get('shoalShoreSoft')) : 0);
    // Low ground: its tint and reach (0: none, as before); its color is set with the others (setColors).
    this.f('uLowReach', variant.has('lowReach') ? Number(variant.get('lowReach')) : 6);
    this.f('uLowGrain', variant.has('lowGrain') ? Number(variant.get('lowGrain')) : 1);
    this.f('uGougeWeb', variant.has('gougeWeb') ? Number(variant.get('gougeWeb')) : 0);
    this.f('uCreaseShade', variant.has('creaseShade') ? Number(variant.get('creaseShade')) : 0);
    this.fieldsDirty = true;
    {
    this.i('uBeach', this.layers.has('beach'));
    this.f('uBeachHeight',this.config.material?.beachHeight??6);
    // The third colour is a tone on the water material's mean, as the shallows' is (sculpt-knobs.js waterTone).
    const mid=waterTone(this.config,'mid'), midDepth=this.config.material?.midDepth;
    this.set('uWaterMid', mid && midDepth ? [...mid, midDepth] : [0, 0, 0, 0]);
    this.f('uGrid', this.grid);
    this.f('uSize', this.size);
    this.f('uBase', this.config.baseHeight - this.config.seaLevel);
    this.f('uSea', 0);
    this.f('uDetail', this.config.material?.surfaceRelief ?? 1.0);
    this.i('uSlopeMaterial', ['slopes', 'structured'].includes(variant.get('surface')));
    this.i('uMineralMargins', variant.get('transition') === 'mineral');
    this.i('uDiagnosticView', this.previewView(variant));
    this.i('uSurfacePreview', this.surfacePreview ?? -1);
    this.f('uFaceFill', variant.has('faceFill') ? Number(variant.get('faceFill')) : Math.max(0, Math.min(.5, (Number(variant.get('fill')) || 0) / 100)));
    const material = this.config.material || {};
    this.set('uSlopeProfile', [material.slopeStart ?? .10,
      material.slopeFull ?? .55, material.slopeFloor ?? 8.0, material.slopeDry ?? 24.0]);
    this.v('uElevatedCover', material.elevatedCover || [5, 32, 0]);
    this.i('uSlopeOnLowBanks', material.slopeOnLowBanks !== false);
    this.f('uRampMaterial', material.rampMaterial ?? 0);
    this.i('uSlopeSand', Boolean(material.slopeSand));
    this.i('uGrassSlopes', Boolean(material.grassSlopes));
    this.i('uGroundFringe', material.groundFringe === true);
    // A preset can retain coloured veins or dark neutral grain at its edge.
    // The blending algorithm does not choose a biome's material colour.
    this.f('uWetBand', variant.has('wetBand') ? Number(variant.get('wetBand')) : material.wetBand ?? 13);   // World control; a world's material table sets its default (config.go)
    // E6: mineralDetail scales the rock art's contrast about its mean (1: as drawn).
    const bed = this.config.water?.riverBedRGB;   // riverfix: a braided bed's gravel, world data (absent: the draw darkens the world's rock)
    this.set('uRiverBed', bed ? [...bed.map(v => v / 255), 1] : [0, 0, 0, 0]);
    }
    {
    this.i('uClay', clay);
    const weatherAmount=materialWeathering;
    this.f('uMaterialWeathering', weatherAmount);
    this.f('uTransitionDetail', transitionDetail);
    this.f('uDetail', this.variant.get('relief') === 'base' ? 0 : detail);
    this.i('uQuantize', (this.variant.get('palette') || 'nearest') !== 'off');
    this.f('uShoreEdge', Number(this.variant.get('shoreEdge')) || 0);
    this.f('uCrystalGrain', Number(this.variant.get('crystalGrain')) || 0);
    this.f('uCrystalFace', this.variant.has('crystalFace') ? Number(this.variant.get('crystalFace')) : 1);
    this.f('uCrystalInk', Number(this.variant.get('crystalInk')) || 0);
    this.f('uCrystalTone', this.variant.has('crystalTone') ? Number(this.variant.get('crystalTone')) : 1);
    let sun = this.sunVector(light);
    this.worldSun = sun.map(v => v / Math.hypot(...sun));   // the map's own sun, as exports draw it (sculpt-features.js lights the features by it)
    // Review sun (card H1): the page's ?sun=<azimuth> turns the light about the vertical by that many degrees, for looking at the relief
    // from other directions (ink keeps its shade, geometry does not); its height stays Sun height's. Exports never take it (exact).
    const review = exact ? null : this.reviewSun();
    if (review) {
      const turn = Math.atan2(sun[1], sun[0]) + (Number(review[1]) || 0) * Math.PI / 180, flat = Math.hypot(sun[0], sun[1]);
      sun = [Math.cos(turn) * flat, Math.sin(turn) * flat, sun[2]];
    }
    const length = Math.hypot(...sun);
    this.v('uLight', sun.map(v => v / length));
    // Lit crack walls are baked for this light.
    const sunKey = sun.join(',');
    if (this.sunKey !== sunKey) { this.sunKey = sunKey; this.sun = sun.map(v => v / length); this.fieldsDirty = true; }
    }
    {
    const v = this.variant;
    const number = (key, fallback) => { const x = Number(v.get(key)); return Number.isFinite(x) && v.has(key) ? x : fallback; };
    const set = (name, value) => this.set(name, Number(value));
    set('uGrid', this.grid); set('uSize', this.size); set('uBase', this.config.baseHeight - this.config.seaLevel); set('uSea', 0); set('uPool', groundPool(this.config.material));
    {
      for (const [key, fallback] of [['terraceBreak', 0], ['terraceCalm', 0], ['wetSwath', 0], ['lushness', 0], ['rillDepth', 0], ['rillSpacing', 8]])
        set('u' + key[0].toUpperCase() + key.slice(1), number(key, fallback));
    }
    set('uReliefScale', number('reliefScale', 28));
    set('uReliefAmount', number('reliefAmount', 0.5));
    set('uReliefLumps', number('reliefLumps', 0.7));
    set('uReliefGain', number('reliefGain', 0.55));
    set('uReliefWarp', number('reliefWarp', 10));
    set('uReliefPatchy', number('reliefPatchy', 1));
    set('uFaceStreak', number('faceStreak', 0));
    for (const [key, fallback] of [['rockFace', 0], ['rockFaceFrom', 0.6], ['faceBed', 5.5], ['faceLedge', 2.2], ['faceRun', 90], ['faceLean', 28], ['faceScratch', 2.5],
      ['faceScratchSize', 7], ['faceBlock', 3], ['faceBlockSize', 11], ['faceGrass', 0.8], ['faceRock', 0.9], ['faceCrease', 2.5], ['faceCreaseSize', 6],
      ['faceShade', 0.85], ['faceWear', 0.35], ['faceLayers', 0], ['faceMass', 1], ['faceTone', 0.12], ['faceStrata', 0], ['faceWet', 0], ['shoreRock',0],['shoreShelf',0],['runoff',0],['runoffScale',24],['runoffConcentration',.65],['runoffCut',2],['runoffStain',.5],['debrisAmount',0],['debrisReach',56],['debrisDepth',4],['rimReach',0], ['faceJointTilt',0],['faceSlopeAlign',0],['faceScaleVary',0],['faceFold',0],['faceBedVary',1],['bedCycleVary',0],['faceBreak',0],['faceSpall',0],['faceClast',0],['faceClastSize',12],['faceMineral',0],['faceJointWidth',1],['faceSecondary',.35],['faceContinuity',1],['faceDetailPatch',0],['faceWhole',0],['faceWholeLarge',0],['faceRegular',0],['sandLee',0],['groundPatch',0],['groundPatchSize',200],['faceFresh',0],['faceRind',0],['faceRindDepth',6],['faceRindTone',-.22],['faceRindWarmth',.35],['faceRindRough',.65], ['faceStretch', 1], ['faceBlockHeight', 1], ['faceRound', 0], ['faceJoint', 0.35], ['faceExtrude', 0], ['faceLamina', 0], ['faceLaminaSize', 6], ['faceScratchLength', 50], ['faceScratchAngle', 0], ['absorbDepth', 0], ['shadowTint', 0]])
      set('u' + key[0].toUpperCase() + key.slice(1), number(key, fallback));
    set('uFaceStreakFrom', number('faceStreakFrom', 0.3));
    set('uGentleRelief', number('gentleRelief', 0.6));
    set('uSand', number('sand', 0));
    set('uCrackSeverity', number('crackSeverity', 0.6));
    set('uPlainRelief', number('plainRelief', 1.2));
    set('uBedRelief', number('bedRelief', 0));
    set('uBedCracks', number('bedCracks', 0));
    set('uBedCrackSize', number('bedCrackSize', 36));
    set('uLumpRelief', number('lumpRelief', 4));
    set('uCrackSpacing', number('crackSpacing', 40));
    set('uCrackFrom', number('crackFrom', 0.44));
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
    for (const [key, fallback] of [['fineRelief', 0], ['fineLevel', 0], ['fineSize', 8], ['fineGrain', 0], ['finePits', 0]]) set('u' + key[0].toUpperCase() + key.slice(1), number(key, fallback));
    set('uLooseSupply', number('looseSupply', 0));
    set('uBoulders', number('boulders', 0));
    set('uSoilRim', number('soilRim', 0));
    set('uWetGround', number('wetGround', 0));
    set('uLooseSize', number('looseSize', 6));
    set('uPlantsOn', this.plantLayers > 0 ? 1 : 0);
    set('uStoneRound', number('stoneRound',this.config.material?.stoneRound ?? 0));
    set('uStoneSort', number('stoneSort',this.config.material?.stoneSort ?? 0.6));
    set('uStoneSlab', number('stoneSlab',this.config.material?.stoneSlab ?? 0.05));
    set('uStoneMoss', this.config.material?.stoneMoss ?? 0.35);
    set('uBandSoftness', number('bandSoftness', 0.35));
    set('uBandJag', number('bandJag', 0));
    set('uBandFade', number('bandFade', 0.75));
    set('uBandLevel', number('bandLevel', 0));
    set('uBandFill', number('bandFill', 0));
    set('uBeachDistance', this.layers.has('beach') ? (this.config.material?.beachWidth ?? 120) * number('beachWidth', 0.6) : 0);
    set('uHasBeach', this.layers.has('beach'));
    set('uSandBanding', number('sandBanding', 0));
    set('uSandBandSpacing', number('sandBandSpacing', 2));
    }
    {
    const column = this.config.column, v = this.variant;
    const number = (key, fallback) => { const x = Number(v.get(key)); return Number.isFinite(x) && v.has(key) ? x : fallback; };
    const {beds, starts, bands} = columnRows(column);
    // Refinement can run before any relief bake; its column offset must not depend on the last displayed view.
    this.set('uBedDip', number('bedDip', 0));
    this.set('uBedDipDir', number('bedDipDir', 90));
    this.set('uColumnContrast', number('columnContrast', 1));
    this.set('uColumnWander', column?.wander?.value ?? 0);
    this.set('uColumnTerrain', [...(column?.wander?.terrain || [0, 0, 0]), 0]);
    this.set('uColumnOrigin', column?.origin === 'plain' ? this.config.baseHeight - this.config.seaLevel : 0);
    this.set('uBandSpacing', bands[0]);
    this.set('uBandLine', bands[1]);
    }
    if(this.colorOverrides){const colors=this.colorOverrides;
    this.set('uMaterialTable', this.placementTable(this.variant));
    // The shallows' tint: the world's own tone (Colors: Shallow water) or its data's, on the water material's mean.
    this.set('uShallowTone', colors.shallowTone ? [...colors.shallowTone, 1] : [...(waterTone(this.config,'shallow') || [0, 0, 0]), 0]);
    // The light's colours (card P12b): white is the grey light every world had.
    this.v('uSunColor', colors.sun || [1, 1, 1]);
    this.v('uSkyColor', colors.sky || [1, 1, 1]);
    // The column's bed tones (sculpt-column.js columnTones): shifts of the rock material's color, the authored ones or five grays.
    const strata = columnTones(this.config.column).map(t => [...t, 1]);
    // The world's rock is slot 0 of the rock table: its beds' tones, which a recipe without tones of its own takes (writeRocks). Row 0 is
    // unused: a rock's color is its material's (engine-frag.wgsl slotRock).
    // Row 6: the color it deepens toward with thickness (B4), the world's 'absorb' color where it chose one.
    this.set('uRockColors', [[0, 0, 0, 0], ...strata, colors.absorb ? [...colors.absorb, 1] : [0, 0, 0, 0]]);
    }
    this.writeRocks();
    const channels={
      timeColumn:this.timeUniformKey(),
      reach:this.reaches?.()??null,
      wear:this.rockSlots().some(k=>this.rockValue(k,'faceWear')>0&&this.rockValue(k,'rockFace')>0)?4:0,
      loose:[Math.max(this.uniformValue('uLooseSupply'),this.uniformValue('uDebrisAny'),this.uniformValue('uBoulders'))>0,this.uniformValue('uPlantsOn')>0,Math.max(...this.rockSlots().map(k=>this.rockValue(k,'looseSize')))],
      runoff:[this.uniformValue('uRunoffAny')>0,this.uniformValue('uDebrisAny')>0,this.uniformValue('uRimReach')>0,this.uniformValue('uShoreRock')>0,this.uniformValue('uShoreShelf')>0],
      rocks:this.rockSlots(),
    };
    const delta=worldUniformDelta(this.worldUniformSnapshot,this.uniformData,this.layout,this.uniformStages);
    delta.channels=[];
    for(const [name,value]of Object.entries(channels))if(JSON.stringify(value)!==JSON.stringify(this.worldChannelSnapshot?.[name])){
      const stage=name==='timeColumn'?'B':name==='wear'?'D':'C';delta.channels.push({name,stage});if(!delta.stage||stage<delta.stage)delta.stage=stage;
    }
    delta.timeChanged=channels.timeColumn!==this.worldChannelSnapshot?.timeColumn;
    this.worldUniformSnapshot=new Uint32Array(this.uniformData.slice(0));this.worldChannelSnapshot=channels;
    this.worldSyncKey=key;this.worldDirty=false;
    this.fieldsDirty=wasDirty||Boolean(delta.stage);
    return delta;
  }

  applyKnobs(options) { this.worldDirty=true;return this.syncWorld(options); }
  // The page's review sun (?sun=<azimuth>, syncWorld), a match of its number or null.
  reviewSun() { return /^\s*(-?[\d.]+)\s*$/.exec(this.variant?.get('sun') || ''); }

  variantNumber(key, fallback) { const value=this.variant.get(key);if(value==null)return fallback;const x=Number(value);return Number.isFinite(x)?x:fallback; }

  // H5: a shader that pastes the common source under EROSION, as erosion.wgsl does.
  preprocessShader(source) { return preprocess(source, this.commonSource, new Set(['EROSION'])); }

  // H2, H16 rock column. The world's table (config.column, from materials/<world>.json; sculpt-column.js). No sections: no column.
  // Erosion reads the same uniforms, so the draw and the pass share one column.
  setColumn() { this.worldDirty=true;return this.syncWorld(); }

  // Rock recipes (struct Rock in engine-common.wgsl) in slots 1 to 15, by slot: {knobs, column, colors}, knobs by their ROCK_KEYS names, column a
  // rock column block (sculpt-column.js) and colors {rock, beds} as '#rrggbb' (sculpt-rock-presets.js checkColors). Slot 0 is the world's own
  // rock: its numbers are the flat settings every address names (this.variant), its column config.column, its colors the world's (setColors).
  // A slot takes slot 0's number for any it does not set, slot 0's column if it has none, and slot 0's colors where its own are null. The slots given are the
  // ones in use: their maxima bound the passes that gather (writeRocks), and a second slot builds the pipelines that read any slot (rockMask).
  // The materials in use, by slot (sculpt-materials.js): the world's ground and water and those strokes chose. Input can arrive faster
  // than a repeat generates, so this keeps only the latest and reserves the cache's layout; bakeFields generates inside the draw cycle.
  setMaterials(materials = new Map()) {
    const table = this.uniform.get('ground'), checked = new Map();
    for (const [slot, material] of materials) {
      if (!Number.isInteger(slot) || slot < 1 || slot >= MATERIAL_SLOTS) throw new Error(`Material slots are 1 to ${MATERIAL_SLOTS - 1}.`);
      checked.set(slot, {worldGround: material.worldGround === true, worldWater: material.worldWater === true, ...Object.fromEntries(MAP_ROLES.map(([r]) => [r, material[r] === true])), ...(material.worldLayer ? {worldLayer: material.worldLayer} : {}), ...copyMaterial(material)});
    }
    const usage = materialCacheUsage([...checked.values()].reduce((n, m) => n + 1 + materialStates(m).length, 0), MATERIAL_REPEAT, [...checked.values()].some(materialStaged));   // layers: one a material and one a state
    if (!usage.fits) throw Error(`These materials need ${(usage.bytes / 1048576).toFixed(0)} MiB; the cache budget is ${usage.budget / 1048576} MiB. Use fewer materials.`);
    const role = key => [...checked].find(([, m]) => m[key])?.[0];
    if (checked.size && (!role('worldGround') || !role('worldWater'))) throw new Error('A map needs a ground material and a water material.');
    this.i('uGroundDefault', role('worldGround') ?? 0); this.i('uWaterGround', role('worldWater') ?? 0); for (const [r, key] of MAP_ROLES) this.i('u' + key[0].toUpperCase() + key.slice(1) + 'Ground', role(r) ?? -1);   // uHighGround, uRockGround, uSlopeGround...
    this.i('uGroundAny', checked.size ? 1 : 0);
    this.i('uGroundShine', [...checked.values()].some(m => m.nodes.find(n => n.type === 'output').in.shine) ? 1 : 0);
    this.grounds = checked;
    if (this.variant && (this.config.surface || []).some(l => l?.material != null)) this.set('uMaterialTable', this.placementTable(this.variant));   // a material layer's slot
    if (this.means) this.means.ground = checked.size ? materialTint(checked.get(role('worldGround'))) : [.5, .5, .5];
    if (this.means && role('worldSlope')) this.means.slope = materialTint(checked.get(role('worldSlope')));   // the map's slope cover, once it has one
    new Uint8Array(this.uniformData, table.offset, table.stride * table.count).fill(0);
    for (const [slot, material] of checked) writeMaterialSlot(this, material, this.uniformView, table.offset + slot * table.stride);
    this.groundCache.prepare(MATERIAL_REPEAT, this.grounds);
    this.fieldsDirty = true;
    this.uniformsDirty = true;
  }
  groundSlots() { return [...new Set([0,...this.grounds.keys()])].sort((a,b)=>a-b); }

  setRocks(rocks = new Map(), {sync=true}={}) {
    const count = this.uniform.get('rock').count;
    for (const slot of rocks.keys()) if (!Number.isInteger(slot) || slot < 1 || slot >= count) throw new Error(`nanolathe: rock slot ${slot} is not 1 to ${count - 1}`);
    this.rocks = new Map(rocks);
    if(!sync){this.worldDirty=true;return null;}
    return this.applyKnobs();
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
  rockMax(key, own) { let out=Math.max(own);for(const rock of this.rocks.values()){const value=Number(rock.knobs?.[key]);if(Number.isFinite(value))out=Math.max(out,value);}return out; }
  // Slots 1-15 as copies of slot 0 (the world's rock, as applyKnobs, bakeFields and setColumn set it) under their own numbers; the pool of every
  // slot's rock column; and the maxima the passes that gather from other points read (debrisAny, runoffAny, debrisReachMax).
  writeRocks() {
    const table = this.uniform.get('rock'), bytes = new Uint8Array(this.uniformData);
    const own = this.worldColumnRows = columnRows(this.config.column), beds = [...own.beds], starts = [...own.starts];
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
      // Its surface material (a material slot; 0 the world's rock material).
      this.uniformView.setInt32(at + table.members.get('material').offset, Number.isInteger(rock.material) ? rock.material : 0, true);
      // Its own colors where it has them: rows 1-5 its beds' tones ([r, g, b] shifts), row 6 its absorption ('#rrggbb'); the rest stay slot 0's.
      const colors = table.members.get('rockColors'), row = (k, hex) => [1, 3, 5].forEach((i, c) => this.uniformView.setFloat32(at + colors.offset + k * 16 + c * 4, parseInt(hex.slice(i, i + 2), 16) / 255, true));
      rock.colors?.beds?.forEach((tone, k) => tone.forEach((v, c) => this.uniformView.setFloat32(at + colors.offset + (1 + k) * 16 + c * 4, v, true)));
      if (rock.colors?.absorb) { row(6, rock.colors.absorb); this.uniformView.setFloat32(at + colors.offset + 6 * 16 + 12, 1, true); }
      if (rock.column) {
        const rows = columnRows(rock.column), shift = beds.length;
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
    this.f('uFineAny', Math.max(max('fineRelief'), max('finePits')));
    // Shine is drawn where any rock in use has gloss, roughness or wetness (applyKnobs decides it for slot 0 and the other materials).
    if (slots.some(k => k && (this.rockValue(k, 'faceWet') > 0 || Math.max(...[0, 2].map(c => this.uniformView.getFloat32(table.offset + k * table.stride + table.members.get('shineRock').offset + c * 4, true))) > 0))) this.i('uShineOn', 1);
    this.uniformsDirty = true;
  }

  // Time is compiled with rockMask=0: it reads only the world's column,
  // never the recipe slots appended to the shared column pools.
  timeUniformKey() {
    const words=new Uint32Array(this.uniformData),own=this.worldColumnRows;
    return JSON.stringify((this.timeUniformFields??[]).map(name=>{
      const f=this.uniform.get(name);if(!f)throw Error('Unknown Time uniform '+name);
      const count=name==='columnBeds'?own.beds.length:name==='columnSections'?own.starts.length:f.count,values=[];
      for(let i=0;i<count;i++)for(let j=0;j<f.width;j++)values.push(words[(f.offset+i*f.stride)/4+j]);
      return [name,values];
    }));
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
  // The broad color of the map's world rock material (its own, else the world's library material's).
  // The world's surface layers changed (docs/SURFACE_LAYERS.md): their rows go to the table. A material layer's material reaches the cache
  // through setMaterials (the map's list carries it).
  setSurface(surface) { this.config.surface = surface; this.set('uMaterialTable', this.placementTable(this.variant)); }
  // The earliest stage an edit that writes the world's uniforms directly reaches (worldUniformDelta over the stage scan), null if none changed:
  // a Surface section edit stays in the surface rows, which only the color pass reads.
  uniformStage(write) { const before = new Uint32Array(this.uniformData.slice(0)); write(); return worldUniformDelta(before, this.uniformData, this.layout, this.uniformStages).stage; }
  // The Surface section's preview of one layer (its first row, surfaceRows layerRows), or none (-1): the draw shows where that layer lies.
  // `term` (0 to 3): the fact view of that condition of the layer in place of its coverage (engine-frag.wgsl views 14 to 17).
  setSurfacePreview(row = -1, term = -1) {
    this.surfacePreview = row; this.surfaceFact = row >= 0 ? term : -1;
    this.i('uSurfacePreview', row);
    this.i('uDiagnosticView', this.previewView(this.variant));
  }
  // The diagnostic view the draw shows: the Surface section's preview (a layer's coverage, 13, or one of its conditions' fact, 14 to 17), else
  // the variant's own view.
  previewView(variant) {
    if (this.surfacePreview >= 0) return this.surfaceFact >= 0 ? SURFACE_FACT_VIEW + Math.min(this.surfaceFact, 3) : DIAGNOSTIC_VIEWS.indexOf('surface-layer') + 1;
    return DIAGNOSTIC_VIEWS.indexOf(variant?.get('view')) + 1;
  }
  // The layers the Surface section hides while an artist designs (their keys): a view only. An export draws every layer (designView).
  setSurfaceHidden(keys = []) { this.surfaceHidden = keys.length ? new Set(keys) : null; this.set('uMaterialTable', this.placementTable(this.variant)); }
  // Clears the Surface section's design view (hidden layers, the coverage preview) for an export's tiles; returns the function that puts it back,
  // or null when there is none.
  suspendDesignView() {
    const hidden = this.surfaceHidden, preview = this.surfacePreview ?? -1, term = this.surfaceFact ?? -1;
    if (!hidden && preview < 0) return null;
    this.surfaceHidden = null; this.set('uMaterialTable', this.placementTable(this.variant)); this.setSurfacePreview(-1);
    return () => { this.surfaceHidden = hidden; this.set('uMaterialTable', this.placementTable(this.variant)); this.setSurfacePreview(preview, term); };
  }
  // An export tile draws the world as saved and leaves the view's state as it found it; returns the function that puts the view back.
  // The design view is set aside for the draw (suspendDesignView). When the draw's own sync rewrote the world (the review sun, which exports
  // never take, or a change not yet synced), the snapshot and key the view's frames compare against are put back and the world is marked
  // for a rewrite: the next frame writes the view's values again and reports only what changed since the view's own last sync. Left at
  // the export's snapshot, every export-art draw under a design view read as a world change with no rectangle (stage F), which
  // invalidated the whole map, whose idle deposit and vent fits drew export art again.
  exportView() {
    // The uniforms the view drew with: a synced view compares the rewrite with them, as edits written directly since its sync (uniformStage)
    // reported their own stages. A world left dirty compares with its last sync, so the change it waits for is still reported.
    const view = new Uint32Array(this.uniformData.slice(0)), dirty = this.worldDirty;
    const design = this.suspendDesignView(), snapshot = this.worldUniformSnapshot, channels = this.worldChannelSnapshot, key = this.worldSyncKey, options = this.worldOptions;
    return () => {
      design?.();
      if (this.worldUniformSnapshot === snapshot) return;
      this.worldUniformSnapshot = dirty ? snapshot : view; this.worldChannelSnapshot = channels; this.worldSyncKey = key; this.worldOptions = options; this.worldDirty = true;
    };
  }
  // The color a material is drawn in: its slot's mean as the GPU computed it (sculpt-material-cache.js readMeans) when that read is of this
  // graph; else its graph's Color (materialColor) moved by the slot's last measured difference between the two, which recoloring keeps.
  drawnColor(m) {
    const read = this.drawnMeans.get(m.slot), own = materialColor(m);
    if (!read) return own;
    if (read.key === materialRenderKey(m)) return read.rgb;
    const was = this.drawnBase.get(m.slot);
    return was ? own.map((v, i) => Math.min(1, Math.max(0, v + was[i]))) : own;
  }
  // A rock slot's material's Color (sculpt-materials.js materialColor): its own material, else the world's rock material's.
  rockMaterialTint(slot = 0) {
    const own = this.rocks?.get(slot)?.material, grounds = this.grounds || new Map();
    const m = (own > 0 && grounds.get(own)) || [...grounds.values()].find(o => o.worldRock);
    return m ? this.drawnColor(m) : this.means.rock;
  }
  // A rock slot's colors as the draw reads them, '#rrggbb': {rock, beds, absorb}, the rock's (its material's drawn color, as rockFlat) and its
  // five bed slots' (that color and each bed's tone). The World pane shows a preset's effective colors with them.
  slotColors(slot) {
    const table = this.uniform.get('rock'), at = table.offset + slot * table.stride + table.members.get('rockColors').offset;
    const row = k => [0, 1, 2, 3].map(c => this.uniformView.getFloat32(at + k * 16 + c * 4, true)), rock = this.rockMaterialTint(slot);
    const hex = rgb => '#' + rgb.slice(0, 3).map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
    // The absorption color: row 6 where chosen, else the rock's own hue at full strength (engine-frag.wgsl absorbFilter).
    const absorb = row(6), top = Math.max(rock[0], rock[1], rock[2], 0.02);
    return {rock: hex(rock), beds: [1, 2, 3, 4, 5].map(k => hex(toneColor(rock, row(k)))), absorb: hex(absorb[3] > 0.5 ? absorb : rock.slice(0, 3).map(v => v / top))};
  }
  // The palette entry nearest a color, '#rrggbb', by rgb distance (the output stage's pattern then mixes entries around it).
  paletteNearest(hex) {
    const colours = (this.materialData.palette?.entries ?? this.paletteArt).map(i => this.paletteColours[i]);
    const cube = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    let best = colours[0], nearest = Infinity;
    for (const c of colours) { const d = (c[0] - cube[0]) ** 2 + (c[1] - cube[1]) ** 2 + (c[2] - cube[2]) ** 2; if (d < nearest) { nearest = d; best = c; } }
    return '#' + best.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  }

  // Encodes the bake into the given encoder, or submits it on its own.
  // The material cache generates what changed in the materials (the bake's and a cached tile's color rerun's).
  syncMaterialCache() { this.groundCache.sync(MATERIAL_REPEAT, this.grounds); }
  // Whether a material in use is still compiling, so a layer keeps an older picture (the export waits and says so).
  materialsCompiling() { return this.groundCache.compiling(); }
  // Resolves once every material in use has its pipelines (or failed to compile) and its layers are generated.
  async materialsReady() { for (;;) { this.syncMaterialCache(); if (!this.groundCache.compiling()) return; await this.groundCache.compiled(); } }
  bakeFields(encoder = null, timer = null) {
    this.syncMaterialCache();
    this.syncWorld();
    this.i('uWeatherMaps', Boolean(this.weatherMaps));
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
    // The color pass packs the chunk's mask and grid inputs in place at every draw, so a
    // console re-bake after a draw would bake the packed form and time garbage; the real
    // pass's own GPU time is lastBakeGPU (sculptDebug.bakeGpuMs).
    if (this.inputsPacked) throw new Error('bakeMs answers only while the chunk holds raw inputs; the last draw packed them in place for the color pass. Read bakeGpuMs, the last real bake\'s own GPU time, instead.');
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
    // As timeBake: after a draw the inputs hold the packed form, so a re-draw would pack
    // it again and draw garbage; the last real draw's GPU time is lastGPU.
    if (this.inputsPacked) throw new Error('drawMs answers only while the chunk holds raw inputs; the last draw packed them in place for the color pass. Read the last real draw\'s GPU time (renderer.lastGPU) instead.');
    if (this.fieldsDirty) await this.withPipelines(() => this.bakeFields());
    await this.device.queue.onSubmittedWorkDone();
    const start = performance.now();
    await this.withPipelines(() => this.draw(options));
    await this.device.queue.onSubmittedWorkDone();
    const ms = performance.now() - start;
    return {ms, gpuMs: (await this.gpuResult) ?? null};
  }
}
