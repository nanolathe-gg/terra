// H2: the GPU erosion pass (erosion.wgsl), run on the renderer's
// device (knob erosion 1; 0 is Weathering off). Its contract: the same mobility and lower/upper bounds (derived below from the
// same slope rules, at the worker's own largest budget), no change to submerged samples
// or to protected ones, and a height between sea -90 and sea +300. The worker then runs
// with the height this returns, so the apron, sand and material field are as before.
// Authoring prototype, not retail rules.

import {terrainAllocation} from './sculpt-memory.js';
import {feedPasses, feedUniform} from './sculpt-gpu-fields.js';
// The Time pass reads the world's own rock (slot 0) for its beds' hardness: its pipelines read every rock number at slot 0's fixed offset
// (engine-common.wgsl rockMask). A rock preset's own beds do not reach the heights yet.
const TIME_ROCK = {rockMask: 0};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// The Time pass's cell, world px: a lattice finer than this is simulated on cells this size and gets the result as a change of its own
// heights (runCoarse). The game keeps one height per 16 px, so the finer half was art; a pass on 4 px cells costs a quarter of one on 2.
const TIME_CELL = 4;
// Constants of the model. Each comment says what it trades; the four knobs a user sees are
// erosionAge, erosionRain, columnContrast and talusAngle.
const BASE_RAIN = 0.006;   // height units a dry sample gains per iteration (times erosionRain)
const K_FLUX = 0.12;       // pipe flow per unit of surface difference: stable below .25 with four pipes
const DAMP = 0.85;         // flow a pipe keeps from the last iteration: sheets spread instead of ringing
const K_CAP = 0.3;         // sediment capacity per unit of sin(slope) * speed
const CAP_SPACING = 2;     // the lattice spacing, px, that K_CAP is the capacity at (runGpu scales it for a coarser lattice)
const K_DISSOLVE = 0.5;    // share of the shortfall dissolved per iteration
const K_DEPOSIT = 0.3;     // share of the excess dropped per iteration (lower than dissolve: sediment travels)
const EVAPORATION = 0.01;  // standing water dries slowly, so pits fill and settle their sediment
const WET_FULL = 0.01;     // water depth at which the full capacity applies
const ROCK_WEAR = 15;      // hardest rock (hardness 1, contrast 1) wears 1/16 as fast as debris
const SOFT_EXTRA = 0;      // softest rock stands this many degrees steeper than loose debris (shale slopes as debris does)
const HARD_ANGLE = 80;     // repose of the hardest rock, degrees
const THERMAL = 0.05;      // share of a pair's excess slope moved per thermal step (eight pairs share a sample's budget)
// Budget the larger of the solver and the subsequent material pass. On a fine lattice
// runCoarse keeps its result while simulating on a smaller, world-aligned square.
export function timePassBytes(grid, spacing, material) {
  const step = Math.max(1, Math.round(TIME_CELL / spacing)), side = Math.ceil(grid / step);
  const cells = grid * grid, simCells = side * side;
  // Three states, pipe flow, velocity, totals and bounds (104 B), plus the 20 B result.
  const solver = simCells * 124 + Math.ceil(side / 8) ** 2 * 12;
  const coarseInputs = step > 1 ? cells * 20 + simCells * 12 : 0;
  // Material retains the 20 B Time result and uses eight scratch words plus its RGBA8 output.
  return Math.max(solver + coarseInputs, material ? cells * 56 : 0) + 65536;
}

export class GpuErosion {
  constructor(renderer, source) {
    this.renderer = renderer;
    const device = this.device = renderer.device;
    const module = device.createShaderModule({label: 'erosion', code: source});
    this.ready = module.getCompilationInfo().then(info => {
      const errors = info.messages.filter(m => m.type === 'error');
      if (errors.length) throw new Error('nanolathe: engine-erosion.wgsl does not compile:\n' + errors.map(e => `${e.lineNum}:${e.linePos} ${e.message}`).join('\n'));
      const C = GPUShaderStage.COMPUTE;
      const buffer = type => ({visibility: C, buffer: {type}});
      this.layout1 = device.createBindGroupLayout({label: 'erosion', entries: [{binding: 0, ...buffer('uniform')}, {binding: 1, ...buffer('read-only-storage')}, {binding: 2, ...buffer('storage')},
        {binding: 3, ...buffer('storage')}, {binding: 4, ...buffer('storage')}, {binding: 5, ...buffer('storage')}, {binding: 6, ...buffer('storage')}, {binding: 7, ...buffer('read-only-storage')}]});
      this.layout0 = device.createBindGroupLayout({label: 'erosion u', entries: [{binding: 0, ...buffer('uniform')}]});
      const layout = device.createPipelineLayout({bindGroupLayouts: [this.layout0, this.layout1]});
      this.pipelines = {};
      return Promise.all(['offsetMain', 'fluxMain', 'waterMain', 'exchangeMain', 'settleMain', 'carryMain', 'thermalMain'].map(async entry =>
        { this.pipelines[entry] = await device.createComputePipelineAsync({label: entry, layout, compute: {module, entryPoint: entry, constants: TIME_ROCK}}); }));
    });
  }

  // Resolves when no Time pass is running (the paged fields start a page's pass in the background only then).
  quiet() { return this.running ? new Promise(r => (this.quietWaiters ??= []).push(r)) : Promise.resolve(); }

  // H5: the maps pass (engine-weather.wgsl) on the erosion's own device and common source, built on first use.
  async mapsPipeline() {
    if (this.maps) return this.maps;
    const {device} = this, C = GPUShaderStage.COMPUTE, buffer = (type, binding) => ({binding, visibility: C, buffer: {type}});
    const source = this.renderer.timeSources.maps;
    const module = device.createShaderModule({label: 'engine-weather', code: source});
    const info = await module.getCompilationInfo(), errors = info.messages.filter(m => m.type === 'error');
    if (errors.length) throw new Error('nanolathe: engine-weather.wgsl does not compile:\n' + errors.map(e => `${e.lineNum}:${e.linePos} ${e.message}`).join('\n'));
    const layout = device.createBindGroupLayout({label: 'engine-weather', entries: [buffer('uniform', 0), ...[1, 2, 3, 4].map(b => buffer('read-only-storage', b)), ...[5, 6, 7].map(b => buffer('storage', b))]});
    const pipeline = await device.createComputePipelineAsync({label: 'mapsMain', layout: device.createPipelineLayout({bindGroupLayouts: [this.layout0, layout]}), compute: {module, entryPoint: 'mapsMain', constants: TIME_ROCK}});
    return this.maps = {layout, pipeline};
  }

  // H6b: the whole Time pass on GPU buffers (Green's map canvas, engine 1). The input is the GPU shape fields' own planes and masks
  // (request.planes, request.masks: the height, protection and erosion-override planes); engine-feed.wgsl builds the erosion state, the
  // fixed field and the active-tile list from them, and the maps pass follows the erosion as in run(). Nothing is read back: the result
  // is two buffers, `weather` (plane 0 the authored height the pass started from, plane 1 the eroded height) and `maps` (the three packed
  // layers), which the chunk bake reads in place and `readBuffer` brings to the CPU only when a CPU reader asks.
  async runGpu(request) {
    const owned=[],keep=new Set();let complete=false;
    const current=()=>{if(request.stale?.())throw new DOMException('The Time request was superseded.','AbortError');};
    this.running=(this.running||0)+1;
    try {
      // A lattice finer than the pass's cell is simulated on the pass's cells (runCoarse), inside this pass's own accounting.
      const step=Math.round(TIME_CELL/(request.spacing??(request.size-1)/(request.grid-1)));
      if(step>1){const result=await this.runCoarse(request,step);complete=true;return result;}
      current();await this.ready;current();
      window.erodeRuns=(window.erodeRuns||0)+1;
      const feed = await feedPasses(this.device), mp = await this.mapsPipeline();
      current();
      const {device} = this, {grid, size, seaLevel} = request, n = grid * grid, spacing = request.spacing ?? (size - 1) / (grid - 1);   // H5b: a window of a larger map passes the map's spacing and its own origin
      const age = Math.max(1, Math.round(request.age)), rain = BASE_RAIN * request.rain, started = performance.now();
      const talus = Math.tan(request.talusAngle * Math.PI / 180);
      // Water cuts lines a cell wide, so a coarser lattice's are wider: the capacity falls with the root of the spacing, which keeps the
      // material moved the same from 2 px cells (where the constants were set) to 8 (measured on Green: within 8% at 4 px, 15% at 8 px;
      // without it 40% and 80% more).
      const capacity = K_CAP * Math.sqrt(CAP_SPACING / spacing);
      const params = new Float32Array([grid, spacing, rain, K_FLUX, DAMP, capacity, K_DISSOLVE, K_DEPOSIT, EVAPORATION, WET_FULL,
        this.renderer.variantNumber('columnContrast', 1), ROCK_WEAR, talus, Math.min(request.talusAngle + SOFT_EXTRA, 85) * Math.PI / 180, HARD_ANGLE * Math.PI / 180, THERMAL, request.ox ?? 0, request.oy ?? 0]);
      const S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
      const make = (label, bytes, usage = S) => { const b=device.createBuffer({label, size:Math.max(16,bytes),usage});owned.push(b);return b; };
      const tw = Math.ceil(grid / 8);
      // The steps dispatch one workgroup per active tile, directly; a window's tiles fit one dispatch dimension up to 2047 cells.
      if (tw * tw > 65535) throw new Error(`nanolathe: a Time pass window of ${grid} cells is over the 2047 a dispatch covers`);
      let state,pipeFlow,vel,acc,fixedBuffer,paramBuffer,tileFlag,tileList,tileCount,tileArgs,weather,maps;
      await terrainAllocation(device,()=>{
      state = [0, 1, 2].map(k => make('erosion state ' + k, n * 16));
      pipeFlow = make('erosion pipe flow', n * 16), vel = make('erosion velocity', n * 8), acc = make('erosion totals', n * 16);
      fixedBuffer = make('erosion fixed', n * 16), paramBuffer = make('erosion params', 80, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
      tileFlag = make('erosion tile flags', tw * tw * 4), tileList = make('erosion tiles', tw * tw * 8), tileCount = make('erosion tile count', 4);
      tileArgs = make('erosion tile args', 12, S | GPUBufferUsage.INDIRECT);
      weather = make('time pass height', n * 8), maps = [0, 1, 2].map(k => make('time pass map ' + k, n * 4));
      });current();
      // The fine relief's field octaves (engine-feed.wgsl feedFine) at each cell's world point: the window's first cell and the world rock's values.
      const fine = [request.fineRelief ?? 0, request.fineSize ?? 8, request.fineGrain ?? 0, this.renderer.uniformValue('uPool')];
      const uniform = feedUniform(device, {grid, cells: n, rateMask: request.rateMask, maskStride: request.maskStride, shownHeights: request.shownHeights, sea: seaLevel, spacing, envelope: request.envelope ?? 1, tilesWide: tw, ox: request.ox ?? 0, oy: request.oy ?? 0, fine, fineBase: this.renderer.config.baseHeight});
      owned.push(uniform);
      device.queue.writeBuffer(paramBuffer, 0, params);
      this.renderer.setColumn();
      // Time owns its uniform snapshot below. Uploading the shared draw buffer
      // here could overwrite a chunk paused for voxel readback.
      const res = {'0.0': {buffer: uniform}, '0.1': {buffer: request.planes}, '0.2': {buffer: request.masks},
        '1.0': {buffer: state[0]}, '1.1': {buffer: state[1]}, '1.2': {buffer: state[2]}, '1.3': {buffer: fixedBuffer}, '1.4': {buffer: tileFlag}, '1.5': {buffer: tileList},
        '1.6': {buffer: tileCount}, '1.7': {buffer: tileArgs}, '1.8': {buffer: weather}, '1.9': {buffer: state[1]}, '1.10': {buffer: acc}};
      const group1 = (src, dst) => device.createBindGroup({layout: this.layout1, entries: [{binding: 0, resource: {buffer: paramBuffer}},
        {binding: 1, resource: {buffer: src}}, {binding: 2, resource: {buffer: dst}}, {binding: 3, resource: {buffer: pipeFlow}},
        {binding: 4, resource: {buffer: vel}}, {binding: 5, resource: {buffer: acc}}, {binding: 6, resource: {buffer: fixedBuffer}}, {binding: 7, resource: {buffer: tileList}}]});
      // A chunk may change the shared uniforms while this request yields.
      // Time reads CPU-owned column values, never the GPU-written chunk flags.
      const worldUniform=make('time pass world uniforms',this.renderer.uniformData.byteLength,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
      device.queue.writeBuffer(worldUniform,0,this.renderer.uniformData);
      const countRead=make('erosion tile count read',16,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST);
      const group0=device.createBindGroup({layout:this.layout0,entries:[{binding:0,resource:{buffer:worldUniform}}]});
      const [s0, s1, s2] = state;
      const forward = group1(s0, s1), reverse = group1(s1, s0);
      const water = group1(s0, s2), exchange = group1(s2, s1);
      const groups=Math.ceil(grid/8),parts={gpu:0,slices:0,iterations:[],maxSliceWait:0};
      const submitSlice=async (encoder,iterations=0,submitted=null) => {
        if(request.beforeSlice)await request.beforeSlice();current();
        const tSubmit = performance.now();
        device.queue.submit([encoder.finish()]);submitted?.();
        await device.queue.onSubmittedWorkDone();
        const wait=performance.now()-tSubmit;
        parts.gpu+=wait;parts.slices++;parts.iterations.push(iterations);parts.maxSliceWait=Math.max(parts.maxSliceWait,wait);
        current();return wait;
      };
      // Yield a task, rather than a microtask: input and visible chunk work may
      // submit before the next slice. No next Time slice is already queued.
      const yieldWork=async()=>{await new Promise(resolve=>setTimeout(resolve,0));current();};
      const begin=(encoder,label)=>{
        const pass=encoder.beginComputePass({label});
        return {pass,step:(entry,group)=>{pass.setPipeline(this.pipelines[entry]);pass.setBindGroup(0,group0);pass.setBindGroup(1,group);if(entry==='offsetMain')pass.dispatchWorkgroups(groups,groups);else if(active)pass.dispatchWorkgroups(active);}};
      };
      let encoder=device.createCommandEncoder({label:'erosion input'});
      const input=encoder.beginComputePass({label:'erosion input'});
      const feedStep=(entry,x,y=1)=>{input.setPipeline(feed.pipes[entry]);for(const [g,bg] of feed.groups(entry,res))input.setBindGroup(g,bg);input.dispatchWorkgroups(x,y);};
      feedStep('seedMain',groups,groups);feedStep('tileFlagMain',groups,groups);feedStep('tileListMain',Math.ceil(tw/8),Math.ceil(tw/8));feedStep('tileArgsMain',1);input.end();
      encoder.copyBufferToBuffer(request.planes,0,weather,0,n*4);
      // The steps dispatch exactly the active tiles, directly: an indirect dispatch costs Chrome a validation pass each, and a workgroup for
      // every tile of the window costs the GPU its idle ones. The count is read once, with the input pass this run already waits for.
      encoder.copyBufferToBuffer(tileCount,0,countRead,0,4);
      let active=0,mapped;
      const initial=begin(encoder,'erosion offset');initial.step('offsetMain',forward);initial.pass.end();
      await submitSlice(encoder,0,()=>{mapped=countRead.mapAsync(GPUMapMode.READ);mapped.catch(()=>{});});
      await mapped;current();active=new Uint32Array(countRead.getMappedRange(0,4))[0];countRead.unmap();
      await yieldWork();
      // A slice is sized to about 25 ms of the pass's own GPU work, so input and visible chunks get the queue between slices. A slice's wait
      // also holds whatever else was queued ahead of it (tiles, another Time pass), so it only bounds the pass's own cost: the lowest cost an
      // iteration a million cells has shown (this.rate, per wet or dry pass, drifting up 2% a slice) sizes the batch, and a busy queue no
      // longer shrinks the slices into many more round trips. The first pass starts at one iteration. Slicing does not change the result.
      // The cells are the active tiles' (8 x 8 each), the steps' work: a window that is mostly sea or flat costs little, and timed against the
      // whole window it would lower the rate for the next dense pass, which would then run whole in one slice. A pass with no active tile
      // does no step work and teaches the rate nothing.
      const rateKey=rain!==0?'wet':'dry',mcells=active*64/1e6;this.rate??={};
      const sized=()=>mcells>0?clamp(Math.floor(25/(this.rate[rateKey]*mcells)),1,256):256;
      let batch=this.rate[rateKey]?sized():1;
      for(let it=0;it<age;){
        current();const count=Math.min(batch,age-it);
        encoder=device.createCommandEncoder({label:'erosion gpu slice'});
        const {pass,step}=begin(encoder,'erosion');
        for(let i=0;i<count;i++){
          if(rain!==0){step('fluxMain',forward);step('waterMain',water);step('exchangeMain',exchange);step('carryMain',reverse);}
          step('thermalMain',forward);step('thermalMain',reverse);
        }
        pass.end();const wait=await submitSlice(encoder,count);it+=count;
        if(mcells>0){const cost=Math.max(wait,.01)/(count*mcells),known=this.rate[rateKey];this.rate[rateKey]=known?Math.min(cost,known*1.02):cost;}
        batch=sized();
        await yieldWork();
      }
      encoder=device.createCommandEncoder({label:'erosion output'});
      const final=begin(encoder,'erosion settle');
      final.step('settleMain',forward);final.step('thermalMain',reverse);final.step('thermalMain',forward);final.step('thermalMain',reverse);final.step('thermalMain',forward);final.pass.end();
      const output=encoder.beginComputePass({label:'time pass output'});
      output.setPipeline(feed.pipes.refinedMain);for(const [g,bg] of feed.groups('refinedMain',res))output.setBindGroup(g,bg);output.dispatchWorkgroups(groups,groups);output.end();
      const mapParams=make('erosion map params',64,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
      device.queue.writeBuffer(mapParams,0,new Float32Array([grid,spacing,.36/(age*BASE_RAIN),request.sand??0,request.wetReach??3,request.talusFull??2.5,request.wearFull??6,request.flowK??4,request.ox??0,request.oy??0,0,0,0,0,0,0]));
      const mapGroup=device.createBindGroup({layout:mp.layout,entries:[{buffer:mapParams},{buffer:s1},{buffer:acc},{buffer:fixedBuffer},{buffer:weather,offset:0,size:n*4},...maps.map(buffer=>({buffer}))].map((resource,binding)=>({binding,resource}))});
      const second=encoder.beginComputePass({label:'erosion maps'});
      second.setPipeline(mp.pipeline);second.setBindGroup(0,group0);second.setBindGroup(1,mapGroup);second.dispatchWorkgroups(groups,groups);second.end();
      await submitSlice(encoder);
      complete=true;for(const b of [weather,...maps])keep.add(b);
      return {weather,maps,grid,bytes:n*20,milliseconds:performance.now()-started,parts:{...parts,tiles:null,activeTiles:active,windowTiles:tw*tw,gpuFed:true}};
    } finally {
      for(const b of owned)if(!complete||!keep.has(b))b.destroy();
      if(!--this.running&&this.quietWaiters?.length){const w=this.quietWaiters;this.quietWaiters=[];w.forEach(r=>r());}
    }
  }

  // A lattice finer than the Time pass's cell (TIME_CELL): its height, protection and masks are read down to the pass's cells
  // (engine-feed.wgsl timeDownMain), the pass runs on those, and its change of height and its maps come back on the lattice
  // (timeUpHeightMain, timeUpMapsMain). The coarse cells sit on the world cells that divide by `step`, whatever the window's origin, so the
  // windows of one map sample the same cells. The result has the shape runGpu's has: plane 0 is the lattice's authored height, exactly.
  async runCoarse(request,step) {
    const {device}=this,{grid}=request,n=grid*grid,spacing=request.spacing??(request.size-1)/(grid-1),ox=request.ox??0,oy=request.oy??0,started=performance.now();
    const current=()=>{if(request.stale?.())throw new DOMException('The Time request was superseded.','AbortError');};
    const first=o=>(step-(o%step+step)%step)%step,sx=first(ox),sy=first(oy),gc=Math.floor((grid-1-Math.min(sx,sy))/step)+1,nc=gc*gc;
    const S=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST,owned=[],kept=[];
    const make=(label,bytes,list=owned)=>{const b=device.createBuffer({label,size:Math.max(16,bytes),usage:S});list.push(b);return b;};
    let complete=false,coarse=null;
    try {
      current();await this.ready;const feed=await feedPasses(device);current();
      let planes,masks,weather,maps;
      await terrainAllocation(device,()=>{
        planes=make('time cells height',nc*8);masks=make('time cells erosion mask',nc*4);
        weather=make('time pass height',n*8,kept);maps=[0,1,2].map(k=>make('time pass map '+k,n*4,kept));
      });current();
      const uniform=feedUniform(device,{grid,cells:n,rateMask:request.rateMask,ox:sx,oy:sy,gw:gc,gh:step,sea:request.seaLevel});owned.push(uniform);
      const res={'0.0':{buffer:uniform},'0.1':{buffer:request.planes},'0.2':{buffer:request.masks},'3.15':{buffer:planes},'3.16':{buffer:masks},
        '3.21':{buffer:weather},'3.22':{buffer:weather},'3.23':{buffer:maps[0]},'3.24':{buffer:maps[1]},'3.25':{buffer:maps[2]}};
      const pass=(encoder,entry,side)=>{const p=encoder.beginComputePass({label:entry});p.setPipeline(feed.pipes[entry]);for(const [g,bg] of feed.groups(entry,res))p.setBindGroup(g,bg);p.dispatchWorkgroups(Math.ceil(side/8),Math.ceil(side/8));p.end();};
      // The lattice's height and protection are taken now, with the cells the pass reads: an edit during the pass cannot reach its result.
      // Like every submission of the pass, these two wait their turn first (beforeSlice) and are not made for a superseded request.
      if(request.beforeSlice)await request.beforeSlice();current();
      let encoder=device.createCommandEncoder({label:'erosion cells input'});
      encoder.copyBufferToBuffer(request.planes,0,weather,0,n*8);pass(encoder,'timeDownMain',gc);
      device.queue.submit([encoder.finish()]);
      coarse=await this.runGpu({...request,planes,masks,maskStride:1,shownHeights:1,rateMask:request.rateMask&3,grid:gc,spacing:spacing*step,ox:(ox+sx)/step,oy:(oy+sy)/step});
      current();if(request.beforeSlice)await request.beforeSlice();current();
      Object.assign(res,{'3.17':{buffer:coarse.weather},'3.18':{buffer:coarse.maps[0]},'3.19':{buffer:coarse.maps[1]},'3.20':{buffer:coarse.maps[2]}});
      encoder=device.createCommandEncoder({label:'erosion cells output'});
      pass(encoder,'timeUpMapsMain',grid);pass(encoder,'timeUpHeightMain',grid);   // the maps read the protection plane's neighbour, the height, before the height pass writes beside it
      device.queue.submit([encoder.finish()]);await device.queue.onSubmittedWorkDone();current();
      complete=true;
      return {weather,maps,grid,bytes:n*20,milliseconds:performance.now()-started,parts:{...coarse.parts,cells:gc,step}};
    } finally {
      for(const b of owned)b.destroy();
      if(coarse){coarse.weather.destroy();coarse.maps.forEach(b=>b.destroy());}
      if(!complete)for(const b of kept)b.destroy();
    }
  }

  // The material field (engine-weather.wgsl mf*): arrival, soil, softened source and source a cell, packed into one RGBA8 word that the chunk feed
  // writes into gridTexture layer 1. It reads a height already on the GPU (the Time pass's eroded plane: `heightBuffer`, `heightOffset` cells in)
  // and never comes back to the CPU. {ox, oy} is the window's first lattice cell, so that pages of one map join. The caller owns the buffer.
  // A window of a larger map passes the map's spacing, as runGpu's request does: `size` is then the map's, not the window's.
  async materialField({heightBuffer, heightOffset = 0, grid, size, spacing: given, ox = 0, oy = 0, seaLevel = 0, baseHeight = 24, seed = 1, depositSpread = .65, profile = {}}) {
    await this.ready;
    const {device} = this, n = grid * grid, spacing = given ?? (size - 1) / (grid - 1), spread = clamp(depositSpread, 0, 1);
    // One build of the five pipelines, shared by calls that overlap (the preview lattice's and the canonical pass's): a call never sees the
    // table before its pipelines exist. A failed build is tried again.
    this.fieldReady ??= (async () => {
      const module = device.createShaderModule({label: 'engine-weather material field', code: this.renderer.timeSources.maps});
      const errors = (await module.getCompilationInfo()).messages.filter(m => m.type === 'error');
      if (errors.length) throw new Error('nanolathe: engine-weather.wgsl does not compile:\n' + errors.map(e => `${e.lineNum}:${e.linePos} ${e.message}`).join('\n'));
      const entries = {source: 'mfSourceMain', drops: 'mfDropsMain', counts: 'mfCountsMain', blur: 'mfBlurMain', combine: 'mfCombineMain'}, field = {};
      await Promise.all(Object.entries(entries).map(async ([k, entryPoint]) => { field[k] = await device.createComputePipelineAsync({label: entryPoint, layout: 'auto', compute: {module, entryPoint, constants: TIME_ROCK}}); }));
      return field;
    })().catch(err => { this.fieldReady = null; throw err; });
    this.field = await this.fieldReady;
    const P = this.field, S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST, made = [];
    const make = (bytes, usage = S) => { const b = device.createBuffer({size: Math.max(16, bytes), usage}); made.push(b); return b; };
    const heightBuf = make(n * 4);
    const [source, gx, gy, basin, deposit, flow, settled] = Array.from({length: 7}, () => make(n * 4));
    const field = device.createBuffer({label: 'material field', size: n * 4, usage: S});
    const mineral = profile.mineral === true, elevated = profile.elevatedCover || [0, 30, 0];
    const uniform = (sigma, axis) => {
      const buf = make(80, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST), view = new DataView(new ArrayBuffer(80));
      [grid, spacing, seaLevel, baseHeight, spread].forEach((v, i) => view.setFloat32(i * 4, v, true));
      view.setUint32(20, seed >>> 0, true); view.setUint32(24, n, true);
      [profile.rockyCoasts ? 1 : 0, mineral ? 1 : 0, elevated[0], elevated[1], elevated[2], profile.transportSlopeStart ?? (mineral ? .07 : .60), profile.transportSlopeFull ?? (mineral ? .55 : 1.35), sigma, axis, ox, oy]
        .forEach((v, i) => view.setFloat32(28 + i * 4, v, true));
      device.queue.writeBuffer(buf, 0, view.buffer); return buf;
    };
    const encoder = device.createCommandEncoder({label: 'material field'});
    encoder.copyBufferToBuffer(heightBuffer, heightOffset * 4, heightBuf, 0, n * 4);
    const run = (pipeline, ids, bufs, uni, groups) => {
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(2, device.createBindGroup({layout: pipeline.getBindGroupLayout(2), entries: [{binding: 0, resource: {buffer: uni}}, ...ids.map((binding, k) => ({binding, resource: {buffer: bufs[k]}}))]}));
      pass.dispatchWorkgroups(...groups); pass.end();
    };
    const tiles = Math.ceil(grid / 8), u0 = uniform(0, 0);
    run(P.source, [1, 2, 3, 4, 5], [heightBuf, source, gx, gy, basin], u0, [tiles, tiles]);
    run(P.drops, [1, 2, 3, 4, 6, 7], [heightBuf, source, gx, gy, deposit, flow], u0, [Math.ceil(n / 64)]);
    // The drops have consumed both gradients. Counts overwrite them, then the blur
    // passes can reuse the two count buffers. Each dispatch reads and writes distinct buffers.
    const depositAmount = gx, flowAmount = gy, horizontal = deposit, soft = flow;
    const blur = (input, output, sigma) => {
      run(P.blur, [8, 9], [input, horizontal], uniform(sigma, 0), [tiles, tiles]);
      run(P.blur, [8, 9], [horizontal, output], uniform(sigma, 1), [tiles, tiles]);
    };
    run(P.counts, [6, 7, 9], [deposit, flow, depositAmount], uniform(0, 1), [tiles, tiles]);
    run(P.counts, [6, 7, 9], [deposit, flow, flowAmount], uniform(0, 2), [tiles, tiles]);
    blur(source, soft, 9 + spread * 17);
    blur(depositAmount, settled, 2.6);
    // Once the horizontal pass has read the input, its vertical pass can replace it.
    const broad = depositAmount, runoff = flowAmount;
    blur(depositAmount, broad, 9);
    blur(flowAmount, runoff, 3.5);
    run(P.combine, [1, 2, 5, 10, 11, 12, 13, 14], [heightBuf, source, basin, field, settled, broad, runoff, soft], u0, [tiles, tiles]);
    device.queue.submit([encoder.finish()]);
    made.forEach(buf => buf.destroy());   // destroyed buffers wait for the submitted work
    return field;
  }
}

// H6b: the renderer's erosion instance, built on first use (Green's engine steps over active tiles).
export async function erosionOf(renderer) {
  if (!renderer.erosion) {
    renderer.erosion ??= new GpuErosion(renderer, renderer.timeSources.erosion);
  }
  return renderer.erosion;
}
