// One displaced surface, shared by every terrain brush. Prototype renderer.
function shader(gl, type, source) {
  const s = gl.createShader(type);
  gl.shaderSource(s, source);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

export class TerrainRenderer {
  static async create(canvas, config) {
    const self = new TerrainRenderer(canvas, config);
    await self.initialize();
    return self;
  }

  constructor(canvas, config) {
    this.canvas = canvas;
    this.config = config;
    this.gl = canvas.getContext('webgl2', {antialias: false, alpha: false, preserveDrawingBuffer: true});
    if (!this.gl) throw new Error('This terrain preview requires WebGL 2.');
    this.grid = config.grid;
    this.size = config.size;
    this.height = new Float32Array(this.grid * this.grid).fill(config.baseHeight);
    this.queries = [];
    this.lastGPU = null;
  }

  async initialize() {
    const gl = this.gl;
    const [vs, fs, common] = await Promise.all(['sculpt.vert', 'sculpt.frag', 'sculpt-common.glsl'].map(async name => {
      const r = await fetch('/' + name);
      if (!r.ok) throw new Error(`Cannot load ${name}`);
      return r.text();
    }));
    this.program = gl.createProgram();
    for (const [type, source] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]])
      gl.attachShader(this.program, shader(gl, type, source.replace('/*COMMON*/', common)));
    gl.linkProgram(this.program);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program));
    gl.useProgram(this.program);
    this.uniform = new Map();
    this.meshes = [this.mesh(192), this.mesh(512)];
    this.heightTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.heightTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, this.grid, this.grid, 0, gl.RED, gl.FLOAT, this.height);
    this.i('uHeight', 0);
    this.routeTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + 12);
    gl.bindTexture(gl.TEXTURE_2D, this.routeTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.i('uRoutes', 12);
    this.setRoutes(new Float32Array(this.grid * this.grid));
    const variant = new URLSearchParams(location.search);
    for (const [key, value] of Object.entries(this.config.defaults || {}))
      if (!variant.has(key)) variant.set(key, value);
    this.variant = variant;
    const slopeMaterial = ['slopes', 'structured'].includes(variant.get('surface'));
    const rockLayers = variant.get('material') === 'varied';
    this.fringeTextures = {};
    for (const [key, name, unit] of [['noise','uNoise',1], ['grass','uGrass',2], ['rock','uRock',3], ['water','uWater',4], ['palette','uPalette',5], ['waterShallow','uWaterShallow',6], ['slopeGrass','uSlopeGrass',8], ['rockWeathered','uRockWeathered',9], ['rockFractured','uRockFractured',10], ['fractures','uFractures',11], ['mineralRing','uMineralRing',14], ['mineralRings','uMineralRing',14]]) {
      if (key === 'mineralRings' && !this.config.textures.mineralRings) continue;
      if (key === 'mineralRing' && !this.config.textures.mineralRing) { this.i(name, 2); continue; }
      if (key === 'slopeGrass' && !slopeMaterial) { this.i(name, 2); continue; }
      if (key.startsWith('rock') && key !== 'rock' && !rockLayers) { this.i(name, 3); continue; }
      if (key === 'fractures' && !this.config.textures.fractures) { this.i(name, 1); continue; }
      let url = this.config.textures[key];
      if (key === 'rock' && variant.get('rock') === 'hill') url = this.config.textures.hillRock;
      if (key === 'rock' && variant.get('rock') === 'structural') url = '/sculpt-assets/rock-structural.png';
      if (variant.get('surface') === 'structured') {
        if (key === 'slopeGrass' && this.config.textures.slopeStructured) url = this.config.textures.slopeStructured;
        if (key === 'rock' && this.config.textures.rockStructured) url = this.config.textures.rockStructured;
      }
      if (key === 'noise' && variant.get('noise') === 'ridged') url = '/sculpt-assets/noise-ridged-gaussian.png';
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Cannot load ${key} material`);
      const bitmap = await createImageBitmap(await response.blob(), {colorSpaceConversion: 'none', premultiplyAlpha: 'none'});
      gl.activeTexture(gl.TEXTURE0 + unit);
      const materialTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, materialTexture);
      if (key === 'mineralRing') this.fringeTextures.veins = materialTexture;
      if (key === 'mineralRings') this.fringeTextures.rings = materialTexture;
      const numeric = key === 'noise' || key === 'fractures';
      const detailLevels = this.config.textures.transitionBody && ['grass','slopeGrass','rock','mineralRing','mineralRings'].includes(key);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, detailLevels ? gl.LINEAR_MIPMAP_LINEAR : numeric ? gl.LINEAR : gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, numeric ? gl.LINEAR : gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
      if (detailLevels) gl.generateMipmap(gl.TEXTURE_2D);
      bitmap.close();
      this.i(name, unit);
    }
    // Two optional transition stages share one texture unit. Keeping both
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
    gl.activeTexture(gl.TEXTURE0+13);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY,gl.createTexture());
    gl.texParameteri(gl.TEXTURE_2D_ARRAY,gl.TEXTURE_MIN_FILTER,this.transitionBody?gl.LINEAR_MIPMAP_LINEAR:gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY,gl.TEXTURE_WRAP_S,gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY,gl.TEXTURE_WRAP_T,gl.REPEAT);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY,0,gl.RGBA8,fringe.width,fringe.height,2,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    for(const [layer,bitmap] of [fringe,body].entries()) {
      if(bitmap.width!==fringe.width||bitmap.height!==fringe.height) throw new Error('Transition material sizes must match');
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY,0,0,0,layer,bitmap.width,bitmap.height,1,gl.RGBA,gl.UNSIGNED_BYTE,bitmap);
    }
    if(this.transitionBody)gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    if(body!==fringe)body.close();fringe.close();
    this.i('uSlopeFringe',13);
    this.f('uGrid', this.grid);
    this.f('uSize', this.size);
    this.f('uBase', this.config.baseHeight);
    this.f('uSea', this.config.seaLevel);
    this.f('uDetail', variant.get('relief') === 'base' ? 0.0 : (this.config.material?.surfaceRelief ?? 1.0));
    this.f('uFractureDepth', this.config.material?.fractureDepth ?? 1.0);
    this.i('uRockyCoasts', Boolean(this.config.material?.rockyCoasts));
    this.i('uSlopeMaterial', slopeMaterial);
    this.i('uSoilCover', variant.get('transition') === 'soil');
    this.i('uMineralMargins', variant.get('transition') === 'mineral' && variant.get('margins') !== 'slope');
    this.i('uRockLayers', rockLayers);
    this.i('uDiagnostic', ['diffuse','occlusion','shadow','exposure','shading','material'].indexOf(variant.get('view')) + 1);
    this.i('uSeparateLight', variant.get('shade') === 'separate');
    this.f('uFaceFill', Math.max(0, Math.min(.5, (Number(variant.get('fill')) || 0) / 100)));
    this.i('uCoastalDetail', variant.get('shore') !== 'smooth');
    this.i('uNativeShallows', variant.get('water') !== 'tinted');
    this.i('uLayered', ['layers', 'terraces'].includes(variant.get('geology')));
    this.i('uTerraced', variant.get('geology') === 'terraces');
    const material = this.config.material || {};
    gl.uniform4fv(this.location('uSlopeProfile'), [material.slopeStart ?? .10,
      material.slopeFull ?? .55, material.slopeFloor ?? 8.0, material.slopeDry ?? 24.0]);
    this.v('uElevatedCover', material.elevatedCover || [5, 32, 0]);
    this.i('uSlopeOnLowBanks', material.slopeOnLowBanks !== false);
    this.f('uRampMaterial', material.rampMaterial ?? 0);
    this.i('uGroundFringe', material.groundFringe === true);
    // A preset can retain coloured veins or dark neutral grain at its edge.
    // The blending algorithm does not choose a biome's material colour.
    gl.uniform4fv(this.location('uFringeSignal'), material.fringeSignal || [-.299, -.587, -.114, 1]);
    gl.uniform2fv(this.location('uFringeRange'), material.fringeRange || [.08, .28]);
    const threshold = material.rockSlope ?? 1.145, feather = material.rockFeather ?? 0.43;
    this.f('uRockStart', threshold - feather * 0.5);
    this.f('uRockFull', threshold + feather * 0.5);
    this.f('uWetBand', material.wetBand ?? 13);
    this.f('uShallowDepth', material.shallowDepth ?? 2);
    this.f('uDeepDepth', material.deepDepth ?? 42);
    this.f('uMineralDetail', variant.get('grain') === 'strong' ? 2.4 : 1.0);
    const rockMean = variant.get('rock') === 'hill' ? material.hillRockMeanRGB : material.rockMeanRGB || [85, 84, 79];
    this.v('uRockMean', rockMean.map(v => v / 255));
    this.i('uShapeCoverage', variant.get('coverage') === 'form');
    this.i('uLedgeCoverage', variant.get('coverage') === 'ledge');
    this.v('uShallowColor', (this.config.water?.shallowRGB || [60, 115, 163]).map(v => v / 255));
    this.v('uDeepColor', (this.config.water?.deepRGB || [16, 57, 133]).map(v => v / 255));
    this.v('uWaterMean', (this.config.water?.meanRGB || [38, 76, 226]).map(v => v / 255));
    this.weatherTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + 7);
    gl.bindTexture(gl.TEXTURE_2D, this.weatherTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.i('uWeather', 7);
    this.setWeather();
    this.materialFieldTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + 15);
    gl.bindTexture(gl.TEXTURE_2D, this.materialFieldTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.i('uMaterialField', 15);
    this.setMaterialField();
    this.timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.disable(gl.CULL_FACE);
  }

  location(name) {
    if (!this.uniform.has(name)) this.uniform.set(name, this.gl.getUniformLocation(this.program, name));
    return this.uniform.get(name);
  }
  f(name, value) { this.gl.uniform1f(this.location(name), value); }
  i(name, value) { this.gl.uniform1i(this.location(name), value); }
  v(name, value) { this.gl.uniform3fv(this.location(name), value); }

  mesh(resolution) {
    const gl = this.gl;
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
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, points, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, index, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return {vao, count: index.length};
  }

  setHeight(height, grid) {
    if (height.length !== grid * grid) throw new Error('Invalid height field dimensions.');
    this.height = height;
    this.grid = grid;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.heightTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, grid, grid, 0, gl.RED, gl.FLOAT, height);
    gl.useProgram(this.program);
    this.f('uGrid', grid);
  }

  setWeather(flow, deposit, talus) {
    const gl = this.gl;
    const bytes = new Uint8Array(this.grid * this.grid * 4);
    if (flow && deposit) for (let i = 0; i < flow.length; i++) {
      bytes[i * 4] = Math.min(255, Math.max(0, Math.round(flow[i] * 255)));
      bytes[i * 4 + 1] = Math.min(255, Math.max(0, Math.round(deposit[i] * 255)));
      bytes[i * 4 + 2] = Math.min(255, Math.max(0, Math.round((talus?.[i] || 0) * 255)));
    }
    gl.activeTexture(gl.TEXTURE0 + 7);
    gl.bindTexture(gl.TEXTURE_2D, this.weatherTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.grid, this.grid, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
  }

  setRoutes(routes) {
    const gl = this.gl, bytes = new Uint8Array(routes.length);
    for (let i = 0; i < routes.length; i++) bytes[i] = Math.round(routes[i] * 255);
    gl.activeTexture(gl.TEXTURE0 + 12);
    gl.bindTexture(gl.TEXTURE_2D, this.routeTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, this.grid, this.grid, 0, gl.RED, gl.UNSIGNED_BYTE, bytes);
  }

  setMaterialField(field) {
    const gl=this.gl,bytes=new Uint8Array(this.grid*this.grid*4);
    if (field) for(let i=0;i<field.length;i++) bytes[i]=Math.round(Math.max(0,Math.min(1,field[i]))*255);
    gl.activeTexture(gl.TEXTURE0+15);
    gl.bindTexture(gl.TEXTURE_2D,this.materialFieldTexture);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,this.grid,this.grid,0,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
    this.materialReady=Boolean(field);
  }

  draw({quality = 'preview', clay = false, light = 'original', fractures = 0, scree = 0, detail = this.config.material?.surfaceRelief ?? 1, ring = .85, ringSpread = .65, ringVariation = .7, fringeStyle = 'veins', materialWeathering = this.config.material?.materialWeathering ?? 0, transitionDetail = this.config.material?.transitionDetail ?? .65} = {}) {
    const start = performance.now(), gl = this.gl;
    gl.useProgram(this.program);
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
    if (fringeTexture) {
      gl.activeTexture(gl.TEXTURE0 + 14);
      gl.bindTexture(gl.TEXTURE_2D, fringeTexture);
      this.i('uMineralRing', 14);
    }
    this.f('uRingAmount', fringeTexture ? ring : 0);
    this.f('uRingSpread', ringSpread);
    this.f('uRingVariation', ringVariation);
    this.i('uScree', scree > 0);
    this.i('uQuantize', false);
    const front = this.variant.get('lighting') === 'front';
    const sun = [light === 'alternate' ? 0.72 : -0.72, front ? 0.38 : -0.38, 0.82];
    const length = Math.hypot(...sun);
    this.v('uLight', sun.map(v => v / length));
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.19, 0.28, 0.14, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (this.timer) {
      const disjoint = gl.getParameter(this.timer.GPU_DISJOINT_EXT);
      this.queries = this.queries.filter(q => {
        if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) return true;
        if (!disjoint) this.lastGPU = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
        gl.deleteQuery(q);
        return false;
      });
    }
    let query;
    if (this.timer && this.queries.length < 3) {
      query = gl.createQuery();
      gl.beginQuery(this.timer.TIME_ELAPSED_EXT, query);
    }
    const mesh = this.meshes[full ? 1 : 0];
    gl.bindVertexArray(mesh.vao);
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
    if (query) { gl.endQuery(this.timer.TIME_ELAPSED_EXT); this.queries.push(query); }
    return {milliseconds: performance.now() - start, gpuMilliseconds: this.lastGPU};
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
