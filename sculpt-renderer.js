// One displaced surface, shared by every terrain brush. Prototype renderer
// on WebGPU (no WebGL fallback). Shaders: sculpt-common.wgsl (shared),
// sculpt-vert.wgsl and sculpt-frag.wgsl (the draw), relief-bake.wgsl (the
// world-resolution fields bake, a compute pass).

// Layers of the masks texture array (4 planes each): the highest plane any card uses, divided by 4. Card F1 uses planes 20-24, layers 5-6.
const MASK_PLANE_COUNT = 25;
const NO_WEBGPU = 'This terrain editor needs WebGPU: current Chrome or Edge, Safari 26, or Firefox with WebGPU.';

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

    const [vert, frag, common, bake] = await Promise.all(['sculpt-vert.wgsl', 'sculpt-frag.wgsl', 'sculpt-common.wgsl', 'relief-bake.wgsl'].map(async name => {
      const r = await fetch('/' + name);
      if (!r.ok) throw new Error(`Cannot load ${name}`);
      return r.text();
    }));
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
      compile('sculpt-frag.wgsl', preprocess(frag, common, defines)),
      compile('relief-bake.wgsl', preprocess(bake, common, new Set([...defines, 'BAKE'])))]);

    // Group 0: the uniforms and the world fields, shared by the draw and the
    // bake (binding 6 is the fields for the draw, the routes for the bake).
    // Group 1: the draw's materials, or the bake's output.
    const both = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE;
    const texture = (binding, visibility, sampleType = 'float', viewDimension = '2d') => ({binding, visibility, texture: {sampleType, viewDimension}});
    const sampler = (binding, visibility) => ({binding, visibility, sampler: {type: 'filtering'}});
    this.commonLayout = device.createBindGroupLayout({label: 'world fields', entries: [
      {binding: 0, visibility: both, buffer: {type: 'uniform'}},
      texture(1, both, 'unfilterable-float'), texture(2, both), texture(3, both), texture(4, both, 'float', '2d-array'), texture(6, both),
      sampler(7, both), sampler(8, both), texture(9, both, 'float', '2d-array')]});
    const F = GPUShaderStage.FRAGMENT;
    this.materialLayout = device.createBindGroupLayout({label: 'materials', entries: [
      texture(0, F), sampler(1, F), texture(2, F), sampler(3, F), texture(4, F, 'float', '2d-array'), sampler(5, F),
      texture(6, F), sampler(7, F), texture(8, F), sampler(9, F), texture(10, F), sampler(11, F), texture(12, F), sampler(13, F),
      texture(14, F), sampler(15, F), texture(16, F), sampler(17, F), texture(18, F)]});
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
    // The world fields: clamped and linear; noise and fractures repeat.
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
    this.meshes = [this.mesh(192), this.mesh(512)];
    this.worldTextures(this.grid);
    this.device.queue.writeTexture({texture: this.heightTexture}, this.textureHeights(this.height), {bytesPerRow: this.grid * 4}, [this.grid, this.grid]);
    this.setRoutes(new Float32Array(this.grid * this.grid));
    const variant = new URLSearchParams(location.search);
    for (const [key, value] of Object.entries(this.config.defaults || {}))
      if (!variant.has(key)) variant.set(key, value);
    this.variant = variant;
    const slopeMaterial = ['slopes', 'structured'].includes(variant.get('surface'));
    const rockLayers = variant.get('material') === 'varied';
    // Each GLSL sampler named a texture unit; here it names a loaded texture
    // (bound(): its texture view and sampler). Aliases keep GL's sharing.
    this.textures = {};
    this.bound = {};
    this.fringeTextures = {};
    this.means = {};
    for (const [key, name] of [['noise','uNoise'], ['grass','uGrass'], ['rock','uRock'], ['water','uWater'], ['palette','uPalette'], ['waterShallow','uWaterShallow'], ['slopeGrass','uSlopeGrass'], ['rockWeathered','uRockWeathered'], ['rockFractured','uRockFractured'], ['fractures','uFractures'], ['mineralRing','uMineralRing'], ['mineralRings','uMineralRing']]) {
      if (key === 'mineralRings' && !this.config.textures.mineralRings) continue;
      if (key === 'mineralRing' && !this.config.textures.mineralRing) { this.bound[name] = 'grass'; continue; }
      if (key === 'slopeGrass' && !slopeMaterial) { this.bound[name] = 'grass'; continue; }
      if (key.startsWith('rock') && key !== 'rock' && !rockLayers) { this.bound[name] = 'rock'; continue; }
      if (key === 'fractures' && !this.config.textures.fractures) { this.bound[name] = 'noise'; continue; }
      let url = this.config.textures[key];
      if (key === 'rock' && variant.get('rock') === 'hill') url = this.config.textures.hillRock;
      if (key === 'rock' && variant.get('rock') === 'structural') url = this.config.assetBase + 'rock-structural.png';
      if (variant.get('surface') === 'structured') {
        if (key === 'slopeGrass' && this.config.textures.slopeStructured) url = this.config.textures.slopeStructured;
        if (key === 'rock' && this.config.textures.rockStructured) url = this.config.textures.rockStructured;
      }
      if (key === 'noise' && variant.get('noise') === 'ridged') url = this.config.assetBase + 'noise-ridged-gaussian.png';
      // Procedural ground tiles replace the sampled grass when the biome has them.
      // A world may use another world's ground pattern (World panel).
      if (key === 'grass') {
        const ground = this.groundSource();
        url = variant.get('ground') !== 'texture' && ground.groundTiles ? ground.groundTiles : ground.grass;
      }
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Cannot load ${key} material`);
      const bitmap = await createImageBitmap(await response.blob(), {colorSpaceConversion: 'none', premultiplyAlpha: 'none'});
      // Mean colour of each base material, so a world can move it to a new
      // base colour while keeping the texture's grain.
      const meanOf = {grass: 'ground', slopeGrass: 'slope', rock: 'rock'}[key];
      if (meanOf) this.means[meanOf] = meanColor(bitmap);
      const numeric = key === 'noise' || key === 'fractures';
      const detailLevels = this.config.textures.transitionBody && ['grass','slopeGrass','rock','mineralRing','mineralRings'].includes(key);
      const loaded = this.materialTexture(key, [bitmap], {
        minFilter: detailLevels || numeric ? 'linear' : 'nearest', magFilter: numeric ? 'linear' : 'nearest', mipmaps: detailLevels});
      if (key === 'mineralRing') this.fringeTextures.veins = loaded;
      if (key === 'mineralRings') this.fringeTextures.rings = loaded;
      bitmap.close();
      this.textures[key] = loaded;
      this.bound[name] = key;
    }
    // Two optional transition stages share one array texture. Keeping both
    // layers resident makes the weathering-strength control continuous.
    const fringeURL=this.config.textures.slopeFringe||this.config.textures.slopeGrass||this.config.textures.grass;
    const loadFringe=async url=>{
      const response=await fetch(url);
      if(!response.ok) throw new Error('Cannot load transition material');
      return createImageBitmap(await response.blob(),{colorSpaceConversion:'none',premultiplyAlpha:'none'});
    };
    const fringe=await loadFringe(fringeURL);
    this.transitionBody=Boolean(this.config.textures.transitionBody);
    const body=this.transitionBody?await loadFringe(this.config.textures.transitionBody):fringe;
    // A third layer holds the world's beach sand, if it has one (the WebGL
    // renderer had no texture unit left), tiled to the layer size.
    let beach=fringe;
    if(this.config.textures.beach){
      const source=await loadFringe(this.config.textures.beach);
      this.means.beach=meanColor(source);
      const tile=new OffscreenCanvas(fringe.width,fringe.height),g=tile.getContext('2d');
      for(let y=0;y<fringe.height;y+=source.height)for(let x=0;x<fringe.width;x+=source.width)g.drawImage(source,x,y);
      source.close(); beach=tile;
    }
    for(const bitmap of [body,beach]) if(bitmap.width!==fringe.width||bitmap.height!==fringe.height) throw new Error('Transition material sizes must match');
    this.textures.slopeFringe=this.materialTexture('slopeFringe',[fringe,body,beach],{minFilter:this.transitionBody?'linear':'nearest',magFilter:'nearest',mipmaps:this.transitionBody});
    this.bound.uSlopeFringe='slopeFringe';
    this.i('uBeach',Boolean(this.config.textures.beach));
    this.f('uBeachHeight',this.config.material?.beachHeight??6);
    const mid=this.config.water?.midRGB, midDepth=this.config.material?.midDepth;
    this.set('uWaterMid', mid && midDepth ? [...mid.map(v => v / 255), midDepth] : [0, 0, 0, 0]);
    if(body!==fringe)body.close();fringe.close();
    this.f('uGrid', this.grid);
    this.f('uSize', this.size);
    this.f('uBase', this.config.baseHeight - this.config.seaLevel);
    this.f('uSea', 0);
    this.f('uDetail', variant.get('relief') === 'base' ? 0.0 : (this.config.material?.surfaceRelief ?? 1.0));
    this.f('uFractureDepth', this.config.material?.fractureDepth ?? 1.0);
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
    this.f('uMineralDetail', (variant.get('grain') === 'strong' ? 2.4 : 1.0) * (variant.has('mineralDetail') ? Number(variant.get('mineralDetail')) : 1));
    const rockMean = variant.get('rock') === 'hill' ? material.hillRockMeanRGB : material.rockMeanRGB || [85, 84, 79];
    this.v('uRockMean', rockMean.map(v => v / 255));
    this.i('uShapeCoverage', variant.get('coverage') === 'form');
    this.i('uLedgeCoverage', variant.get('coverage') === 'ledge');
    this.v('uShallowColor', (this.config.water?.shallowRGB || [60, 115, 163]).map(v => v / 255));
    this.v('uDeepColor', (this.config.water?.deepRGB || [16, 57, 133]).map(v => v / 255));
    this.v('uWaterMean', (this.config.water?.meanRGB || [38, 76, 226]).map(v => v / 255));
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
    // the material field (one texture binding for both, see initialize).
    this.gridTexture = this.device.createTexture({label: 'weather and material field', size: [grid, grid, 2], format: 'rgba8unorm',
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
    return this.config.groundPatterns?.[this.variant.get('groundPattern')] || this.config.textures;
  }

  setColors(colors = {}) {
    for (const key of ['ground', 'slope', 'rock', 'sand', 'beach', 'shallow', 'deep', 'crystal']) {
      const c = colors[key];
      this.set('u' + key[0].toUpperCase() + key.slice(1) + 'Base', c ? [...c, 1] : [0, 0, 0, 0]);
    }
    // Strata colours: the world's, else a painted-desert set.
    const strataDefaults = this.config.strataColors || [[146, 74, 58], [188, 122, 96], [140, 124, 138], [198, 182, 158], [166, 98, 76]];
    const strata = strataDefaults.map((c, i) => colors['strata' + (i + 1)] || c.map(v => v / 255));
    this.set('uStrataColors', strata);
    // Bed zones (start above the plain, slot A, slot B, B's share); by
    // default two colours alternating evenly from just above the plain.
    const zones = (this.config.strataZones || [[1, 0, 1, 0.5]]).slice(0, 6);
    this.set('uStrataZones', [...zones, ...new Array(6 - zones.length).fill([0, 0, 0, 0])]);
    // Card E8: a bed thickness per zone (the grey buttes' beds are 2-3 times the apron's); none keeps strataSpacing.
    const space = (this.config.strataZoneSpacing || []).slice(0, 6);
    this.set('uStrataZoneSpace', [...space.map(x => [x, 0, 0, 0]), ...new Array(6 - space.length).fill([0, 0, 0, 0])]);
    this.i('uStrataZoneCount', zones.length);
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

  setHeight(height, grid) {
    this.fieldsDirty = true;
    if (height.length !== grid * grid) throw new Error('Invalid height field dimensions.');
    this.height = height;
    this.grid = grid;
    this.worldTextures(grid);
    this.device.queue.writeTexture({texture: this.heightTexture}, this.textureHeights(height), {bytesPerRow: grid * 4}, [grid, grid]);
    this.f('uGrid', grid);
  }

  setWeather(flow, deposit, talus, sand) {
    this.fieldsDirty = true;
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
      ...[this.heightTexture, this.textures.noise.texture, this.textures[this.bound.uFractures].texture].map((t, i) => ({binding: i + 1, resource: t.createView()})),
      {binding: 4, resource: this.gridTexture.createView({dimension: '2d-array'})},
      {binding: 6, resource: (kind === 'bake' ? this.routeTexture : this.fieldsTexture).createView()},
      {binding: 7, resource: this.linearClamp}, {binding: 8, resource: this.linearRepeat},
      {binding: 9, resource: this.maskTexture.createView({dimension: '2d-array'})}]});
  }

  // Group 1. The mineral-ring binding takes the chosen fringe texture, or
  // whatever its GLSL sampler pointed at (the ground) when there is none.
  materialBindGroup(fringe) {
    const ring = fringe || this.textures[this.bound.uMineralRing];
    const key = 'materials:' + (fringe ? Object.keys(this.fringeTextures).find(k => this.fringeTextures[k] === fringe) : '');
    return this.bindGroups[key] ??= this.device.createBindGroup({label: 'materials', layout: this.materialLayout, entries: [
      ...[this.textures[this.bound.uGrass], this.textures[this.bound.uSlopeGrass], this.textures[this.bound.uSlopeFringe], ring,
        this.textures[this.bound.uRock], this.textures[this.bound.uRockWeathered], this.textures[this.bound.uRockFractured],
        this.textures[this.bound.uWater], this.textures[this.bound.uWaterShallow]].flatMap((t, i) => [
        {binding: i * 2, resource: t.view}, {binding: i * 2 + 1, resource: t.sampler}]),
      {binding: 18, resource: this.textures[this.bound.uPalette].view}]});
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

  draw({quality = 'preview', clay = false, light = 'original', fractures = 0, scree = 0, detail = this.config.material?.surfaceRelief ?? 1, ring = .85, ringSpread = .65, ringVariation = .7, fringeStyle = 'veins', materialWeathering = this.config.material?.materialWeathering ?? 0, transitionDetail = this.config.material?.transitionDetail ?? .65} = {}) {
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
    this.f('uFractureAmount', this.config.textures.fractures ? fractures : 0);
    this.f('uDetail', this.variant.get('relief') === 'base' ? 0 : detail);
    const fringeTexture = this.fringeTextures[fringeStyle] || this.fringeTextures.veins || this.fringeTextures.rings;
    this.f('uRingAmount', fringeTexture ? ring : 0);
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
    const sun = [light === 'alternate' ? 0.72 : -0.72, (front ? 0.38 : -0.38) * tilt, 0.82];
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
    pass.setBindGroup(1, this.materialBindGroup(fringeTexture));
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
    this.i('uReliefMode', variant.get('detail') === 'lab' ? 0 : 1);
    this.f('uMicroRock', variant.has('microRock') ? Number(variant.get('microRock')) : 1.0);
    this.set('uFaceSlope', (variant.get('faceSlope') || '0.35,0.9').split(',').map(Number));
    this.set('uRockShare', (variant.get('rockShare') || '0.2,1.0').split(',').map(Number));
    this.set('uFaceScore', (variant.get('faceScore') || '0.2,2.0,0.5,0.3').split(',').map(Number));
    this.f('uFaceEdge', variant.has('faceEdge') ? Number(variant.get('faceEdge')) : 0.8);
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
    this.f('uStepSharp', variant.has('stepSharp') ? Number(variant.get('stepSharp')) : 0);
    this.f('uShelfWander', variant.has('shelfWander') ? Number(variant.get('shelfWander')) : 0);
    this.f('uShelfScale', variant.has('shelfScale') ? Number(variant.get('shelfScale')) : 100);
    this.f('uCrackedStep', variant.has('crackedStep') ? Number(variant.get('crackedStep')) : 0);
    this.f('uCrackedContrast', variant.has('crackedContrast') ? Number(variant.get('crackedContrast')) : 0);
    this.f('uBedDots', variant.has('bedDots') ? Number(variant.get('bedDots')) : 0);
    this.f('uBedDotCell', variant.has('bedDotCell') ? Number(variant.get('bedDotCell')) : 14);
    this.f('uStepSoftPx', variant.has('stepSoftPx') ? Number(variant.get('stepSoftPx')) : 1);
    this.f('uBedMottleScale', variant.has('bedMottleScale') ? Number(variant.get('bedMottleScale')) : 1);
    this.f('uRingContrast', variant.has('ringContrast') ? Number(variant.get('ringContrast')) : 0);
    this.f('uRingCount', variant.has('ringCount') ? Number(variant.get('ringCount')) : 7);
    this.f('uRingSize', variant.has('ringSize') ? Number(variant.get('ringSize')) : 1);
    this.f('uBedMottle', variant.has('bedMottle') ? Number(variant.get('bedMottle')) : 0);
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
    this.f('uStrataSpacing', variant.has('strataSpacing') ? Number(variant.get('strataSpacing')) : 10);
    this.f('uStrataWarp', variant.has('strataWarp') ? Number(variant.get('strataWarp')) : 12);
    this.f('uStrataContrast', variant.has('strataContrast') ? Number(variant.get('strataContrast')) : 0.6);
    this.f('uStrataGrain', variant.has('strataGrain') ? Number(variant.get('strataGrain')) : 1);
    this.f('uBandWater', variant.has('bandWater') ? Number(variant.get('bandWater')) : 0);
    this.f('uSandGrass', variant.has('sandGrass') ? Number(variant.get('sandGrass')) : 0.6);
    this.f('uSandDust', variant.has('sandDust') ? Number(variant.get('sandDust')) : 0.5);
    this.f('uSandGrain', variant.has('sandGrain') ? Number(variant.get('sandGrain')) : 0.8);
    this.i('uGroundMode', variant.get('ground') !== 'texture' && this.groundSource().groundTiles ? 1 : 0);
    this.f('uGroundContrast', variant.has('groundContrast') ? Number(variant.get('groundContrast')) : 1);
    this.i('uGroundBorrowed', this.groundSource() !== this.config.textures);
    this.i('uGroundTiles', variant.has('groundTiles') ? Number(variant.get('groundTiles')) : 16);
    this.f('uCrispShore', variant.has('crispShore') ? Number(variant.get('crispShore')) : 1.0);
    this.f('uBankRock', variant.has('bankRock') ? Number(variant.get('bankRock')) : 0.25);
    this.f('uWaterSoft', variant.has('waterSoft') ? Number(variant.get('waterSoft')) : 32);
    this.f('uGullyRock', variant.has('gullyRock') ? Number(variant.get('gullyRock')) : 0.5);
    this.f('uLandDither', variant.has('landDither') ? Number(variant.get('landDither')) : 0.25);
    this.f('uCrackDark', variant.has('crackDark') ? Number(variant.get('crackDark')) : 0.75);
    this.f('uCrackLit', variant.has('crackLit') ? Number(variant.get('crackLit')) : 0.35);
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
    // E9 (Green rock faces).
    this.f('uFaceRock', variant.has('faceRock') ? Number(variant.get('faceRock')) : 0);
    this.f('uRockMoss', variant.has('rockMoss') ? Number(variant.get('rockMoss')) : 1);
    this.f('uShineOutside', variant.has('shineOutside') ? Number(variant.get('shineOutside')) : 1);
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
    this.f('uIceSlate', variant.has('iceSlate') ? Number(variant.get('iceSlate')) : 0);
    this.f('uIceCrystal', variant.has('iceCrystal') ? Number(variant.get('iceCrystal')) : 0);
    this.f('uIceCrest', variant.has('iceCrest') ? Number(variant.get('iceCrest')) : 0);
    this.fieldsDirty = true;
  }

  // Encodes the bake into the given encoder, or submits it on its own.
  bakeFields(quality = 'full', encoder = null, timer = null) {
    const preview = quality !== 'full';
    const v = this.variant;
    const number = (key, fallback) => { const x = Number(v.get(key)); return Number.isFinite(x) && v.has(key) ? x : fallback; };
    const set = (name, value) => this.set(name, Number(value));
    set('uGrid', this.grid); set('uSize', this.size); set('uBase', this.config.baseHeight - this.config.seaLevel); set('uSea', 0);
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
    set('uBedCrackSlope', number('bedCrackSlope', 0.8));
    set('uBandFoot', number('bandFoot', 0));
    set('uLumpRelief', number('lumpRelief', 4));
    set('uCrackSpacing', number('crackSpacing', 40));
    set('uCrackLength', number('crackLength', 2));
    set('uCrackWidth', number('crackWidth', 1));
    set('uCrackJagged', number('crackJagged', 0.6));
    set('uCrackNetwork', number('crackNetwork', 0.35));
    set('uCrackReach', number('crackReach', 0.6));
    set('uCrackMinor', number('crackMinor', 0.75));
    set('uCrackHairline', number('crackHairline', 0.6));
    set('uCrackBlocks', number('crackBlocks', 0.6));
    set('uCrackMajor', number('crackMajor', 0.8));
    // Rock structure (card E3); 0 is the scattered rock every world had.
    set('uRockOrder', number('rockOrder', 0));
    set('uBedSpacing', number('bedSpacing', 12));
    set('uBedVary', number('bedVary', 0.5));
    set('uBedDip', number('bedDip', 0));
    set('uBedDipDir', number('bedDipDir', 90));
    set('uBedLedge', number('bedLedge', 0.5));
    set('uBedLip', number('bedLip', 1));
    set('uJointSpacing', number('jointSpacing', 36));
    set('uJointAngle', number('jointAngle', 0));
    set('uJointDepth', number('jointDepth', 2));
    set('uJointRun', number('jointRun', 120));
    set('uJointGaps', number('jointGaps', 0.3));
    set('uCrackStyle', number('crackStyle', 0));
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
    set('uBandSpacing', number('bandSpacing', 3.7));
    set('uBandSoftness', number('bandSoftness', 0.35));
    set('uBandLine', number('bandLine', 0.5));
    set('uBandWidth', number('bandWidth', 0));
    set('uBandJag', number('bandJag', 0));
    set('uBandFade', number('bandFade', 0.75));
    set('uBandStyle', number('bandStyle', 0), 'i');
    set('uBandRelief', number('bandRelief', 0));
    set('uBandWander', number('bandWander', 0));
    set('uBandGaps', number('bandGaps', 0));
    set('uBeachDistance', this.config.textures.beach ? (this.config.material?.beachWidth ?? 120) * number('beachWidth', 0.6) : 0);
    set('uHasBeach', Boolean(this.config.textures.beach));
    set('uSandBanding', number('sandBanding', 0));
    set('uSandBandSpacing', number('sandBandSpacing', 2));
    set('uReliefOctaves', preview ? Math.min(3, number('reliefOctaves', 5)) : number('reliefOctaves', 5));
    // E9 (Green rock faces).
    set('uGullyDepth', number('gullyDepth', 0));
    set('uGullySpacing', number('gullySpacing', 40));
    set('uGullyWidth', number('gullyWidth', 14));
    set('uGullyAngle', number('gullyAngle', -20));
    set('uGullyRun', number('gullyRun', 160));
    set('uGullyGaps', number('gullyGaps', 0.3));
    set('uGullyShade', number('gullyShade', 0));
    set('uRibTilt', number('ribTilt', 0));
    set('uBedFlow', number('bedFlow', 1));
    set('uBedBend', number('bedBend', 0));
    set('uBedPunch', number('bedPunch', 0));
    set('uScratchDepth', number('scratchDepth', 0));
    set('uScratchSpacing', number('scratchSpacing', 9));
    set('uScratchAngle', number('scratchAngle', -20));
    set('uScratchRun', number('scratchRun', 90));
    set('uScratchGaps', number('scratchGaps', 0.4));
    set('uFacetTilt', number('facetTilt', 0));
    set('uFacetSize', number('facetSize', 6));
    set('uFacetStretch', number('facetStretch', 1.5));
    set('uFacetStep', number('facetStep', 1));
    set('uFacetSeam', number('facetSeam', 0));
    set('uFacetSkew', number('facetSkew', 1));
    set('uFacetCoarse', number('facetCoarse', 0));
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
