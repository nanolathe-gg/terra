import {terrainAllocation,TerrainMemoryError} from './sculpt-memory.js';
import {rockWeatherBytes} from './sculpt-rock-weather.js';
// Card D: a bounded working set for the existing terrain shader. Materials
// belong to this renderer once; callers own the LRU of copied output images.
import {TerrainRenderer} from './sculpt-renderer.js';
import {columnRows} from './sculpt-column.js';
import {PLANT_REACH,groundCoverOn} from './sculpt-material-model.js';
import {feedPasses, feedUniform} from './sculpt-gpu-fields.js';
import {worldUniformDelta,PER_CHUNK_UNIFORMS} from './sculpt-gates.js';
import {MASK_KEYS} from './sculpt-scene.js';

const MB=1024*1024, pow2=n=>2**Math.ceil(Math.log2(Math.max(1,n)));
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const mipBytes=(w,h,layers,levels,bytes)=>{let total=0;for(let i=0;i<levels;i++)total+=Math.max(1,w>>i)*Math.max(1,h>>i)*layers*bytes;return total;};

// The relief fields stop at 2x: their memory grows with the square of the level, and 4x's grain is drawn, not baked.
const fieldLevel=scale=>Math.max(scale,.5);
// Every level samples one global field lattice. A rectangle's apron may start
// between coarse samples; rounding outward keeps neighboring blocks in phase.
export function alignedFieldRegion(region,scale=1){
  const step=fieldLevel(scale),x=Math.floor(region.fieldsX/step)*step,y=Math.floor(region.fieldsY/step)*step;
  const endX=Math.ceil((region.fieldsX+region.fieldsWidth-1)/step)*step,endY=Math.ceil((region.fieldsY+region.fieldsHeight-1)/step)*step;
  const width=endX-x+1,height=endY-y+1;
  return x===region.fieldsX&&y===region.fieldsY&&width===region.fieldsWidth&&height===region.fieldsHeight?region:{...region,fieldsX:x,fieldsY:y,fieldsWidth:width,fieldsHeight:height};
}
const INPUT_TEXTURES=['heightTexture','routeTexture','gridTexture','maskTexture'];
const ROCK_WORKING=['owned','final','source','rim','key'];
const COLOR_MASK_PACK=`
@group(0) @binding(0) var masks:texture_2d_array<f32>;
@group(0) @binding(1) var<storage,read_write> packed:array<u32>;
@group(0) @binding(2) var<uniform> band:vec4u;
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u){
  let size=textureDimensions(masks);if(id.x>=size.x||id.y>=band.y){return;}
  let p=vec2i(vec2u(id.x,id.y+band.x));let stride=((size.x+63u)/64u)*64u;let plane=stride*band.y;let i=id.y*stride+id.x;
  let a=textureLoad(masks,p,0,0);let b=textureLoad(masks,p,1,0);let c=textureLoad(masks,p,2,0);
  let d=textureLoad(masks,p,3,0);let e=textureLoad(masks,p,4,0);let f=textureLoad(masks,p,5,0);
  packed[i]=pack4x8snorm(a);packed[plane+i]=pack4x8snorm(vec4f(b.g,c.b,d.a,e.r));packed[2u*plane+i]=pack4x8snorm(vec4f(e.gba,f.r));
}`;

export class ChunkTerrainRenderer extends TerrainRenderer {
  static async create(canvas,config) {
    const self=new ChunkTerrainRenderer(canvas,config);
    try { await self.initialize(); return self; }
    catch(error) { self.dispose(); throw error; }
  }
  constructor(canvas,config) {
    canvas.width=1;canvas.height=1;
    super(canvas,config);
    this.resources=new Map();this.inputSets=new Map();this.levelSets=new Map();this.workingTick=0;this.activeInput=this.activeLevel=null;
    this.budgetBytes=config.gpuBudgetBytes??(config.gpuBudgetMB??512)*MB;this.reservedBytes=config.gpuReservedBytes??0;
    this.peakBytes=0;this.peakBudgetedBytes=0;this.peakCPUBytes=0;this.evictions=0;
    this.colorTiles=new Set();this.colorTargets=new Map();this.colorReruns=0;
    this._busy=false;this.disposed=false;this.outputBytes=0;this.cpuWorkingBytes=0;
  }
  async initialize() {
    await super.initialize();
    this.track(this.uniformBuffer,'uniforms',this.layout.size,'shared');
    this.track(this.looseBuffer,'loose mask',this.looseBuffer.size,'loose');
    const d=this.device;
    this.colorMaskLayout=d.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:'float',viewDimension:'2d-array'}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform',hasDynamicOffset:true,minBindingSize:16}}]});
    this.colorMaskPipeline=await d.createComputePipelineAsync({label:'color mask pack',layout:d.createPipelineLayout({bindGroupLayouts:[this.colorMaskLayout]}),compute:{module:d.createShaderModule({label:'color mask pack',code:COLOR_MASK_PACK}),entryPoint:'main'}});
    this.emptyColorMasks=this.texture('empty raw color masks',1,1,Math.max(1,Math.ceil(MASK_KEYS.length/4)),'rgba8snorm',4,GPUTextureUsage.TEXTURE_BINDING,'shared');
    this.fixedBytes=[...this.resources.values()].filter(r=>r.kind==='materials'||r.kind==='shared').reduce((n,r)=>n+r.bytes,0);
    this.limit=this.device.limits.maxTextureDimension2D;
    this.setColors();this.recommendedChunkSize=this.chunkSize();
  }
  timer() { return null; }
  track(resource,label,bytes,kind) {
    if(resource)this.resources.set(resource,{label,bytes,kind});
    this.recordMemory();return resource;
  }
  release(resource) { if(!resource||!this.resources.has(resource))return;resource.destroy();this.resources.delete(resource); }
  get residentBytes() { let n=this.outputBytes;for(const r of this.resources.values())n+=r.bytes;return n; }
  get cpuRetainedBytes() { let bytes=this.uniformData?.byteLength??0;for(const tile of this.colorTiles??[])bytes+=tile.cpu.byteLength+tile.world.byteLength;return bytes; }
  recordMemory() {
    this.peakBytes=Math.max(this.peakBytes,this.residentBytes);
    this.peakBudgetedBytes=Math.max(this.peakBudgetedBytes,this.residentBytes+this.reservedBytes);
    this.peakCPUBytes=Math.max(this.peakCPUBytes,this.cpuRetainedBytes+this.cpuWorkingBytes);
  }
  get colorBytes(){let bytes=0;for(const tile of this.colorTiles)bytes+=tile.bytes;return bytes;}
  get busy() { return this._busy; }
  stats() {
    let nativeTiles=0,previewBlocks=0;for(const tile of this.colorTiles)if(!tile.retired){if(tile.block)previewBlocks++;else nativeTiles++;}
    const byKind={};for(const r of this.resources.values())byKind[r.kind]=(byKind[r.kind]??0)+r.bytes;
    return {residentBytes:this.residentBytes,peakBytes:this.peakBytes,budgetBytes:this.budgetBytes,outputBytes:this.outputBytes,
      retainedBytes:this.fixedBytes,workingBytes:(byKind.working??0)+(byKind.loose??0)+this.outputBytes,
      reservedBytes:this.reservedBytes,budgetedBytes:this.residentBytes+this.reservedBytes,peakBudgetedBytes:this.peakBudgetedBytes,
      cpuRetainedBytes:this.cpuRetainedBytes,cpuWorkingBytes:this.cpuWorkingBytes,cpuUploadBytes:this.cpuUploadBytes??0,cpuPeakBytes:this.peakCPUBytes,
      textureBytes:this.outputBytes+[...this.resources].filter(([r])=>'format' in r).reduce((n,[,v])=>n+v.bytes,0),
      bufferBytes:[...this.resources].filter(([r])=>!('format' in r)).reduce((n,[,v])=>n+v.bytes,0),
      colorCache:{tiles:nativeTiles+previewBlocks,nativeTiles,previewBlocks,bytes:this.colorBytes,reruns:this.colorReruns},resources:this.resources.size,byKind,workingSets:{inputs:this.inputSets.size,levels:this.levelSets.size,bytes:this.workingGroups().reduce((n,g)=>n+this.workingBytes(g.state),0)},voxel:this.voxel?.stats,busy:this.busy,evictions:this.evictions,recommendedChunkSize:this.recommendedChunkSize,
      limits:{maxTextureDimension2D:this.device?.limits.maxTextureDimension2D,maxBufferSize:this.device?.limits.maxBufferSize,
        maxSampledTexturesPerShaderStage:this.device?.limits.maxSampledTexturesPerShaderStage,maxTextureArrayLayers:this.device?.limits.maxTextureArrayLayers},
      maskPlaneCount:this.maskPlaneCount,maskLayers:this.maskLayers,uploadBytes:this.uploadBytes??0};
  }
  materialTexture(label,images,options) {
    const loaded=super.materialTexture(label,images,options),{width,height}=images[0];
    const levels=options.mipmaps?Math.floor(Math.log2(Math.max(width,height)))+1:1;
    this.track(loaded.texture,label,mipBytes(width,height,images.length,levels,4),'materials');return loaded;
  }
  number(key,fallback) { return this.variant?.has(key)?Number(this.variant.get(key)):fallback; }
  // The shaders bound all neighbourhoods. Bake relief noise is a
  // function of the queried point, not walks through adjacent baked pixels.
  // Only height/mask/weather support extends the bake's field input apron.
  reaches(heightBounds=this.config.heightBounds??[-90,300]) {
    const n=(k,f)=>this.number(k,f),rock=(k,f)=>this.rockMax(k,n(k,f));   // rock: a recipe number's largest over the rocks in use
    // H1: the close shadow march (6 px) and the cavity rings (4 px) plus the gradient's 1.4 sit inside the far taps' reach.
    // The shadow march (engine-frag.wgsl visibility) reads the surface out to its twelfth sample (12^2 x 1.4 + 2 px) and, as the sun goes down,
    // the authored height from 238.6 px on while a sample tests a height under 240 above the pixel: those far samples need only the height
    // grid (`far` widens the grid's apron, not the fields'). At every world's own sun there are none, and far is the twelfth sample's reach.
    const sun=this.sunVector(),rise=sun[2]/Math.hypot(sun[0],sun[1]),far=238.6*rise<240+1e-3?240/rise:12**2*1.4+2;
    const shadow=12**2*1.4+2,draw=Math.max(shadow,128,36,19,11,3,1.4,n('closeShadow',0)>0?6+1.4:0,60,n('cavity',0)>0?4+1.4:0,n('crystalShallow',0)>0?48:0);   // H20: the shallow mosaic's fringe taps the crystal field 48 px out
    // P16: the largest class drawn has radius min(16, 3.3 x the median); a stone reaches 1.6 radii from its candidate (1.41 of a class radius at most) and a larger stone that suppresses it a little further, and the mask reads the heights 14 px out for a cliff's foot plus its gradient (5).
    const stones=n('boulders',0)>0?3.6*32+90:3.6*Math.min(16,3.3*rock('looseSize',6))+24;   // Boulders: a 32 px class, and the mask looks for the wall 80 px out
    const beach=Math.max(this.config.layers.includes('beach')?(this.config.material?.beachWidth??120)*n('beachWidth',.6):0,n('apron',0))*1.35*1.15;
    const bake=Math.max(19,stones,beach,rock('runoff',0)>0||rock('debrisAmount',0)>0||n('rimReach',0)>0||n('shoreRock',0)>0||n('shoreShelf',0)>0?180:0,groundCoverOn(this.config.material?.groundCover,this.variant)&&this.config.material.groundCover.plants?PLANT_REACH:0);
    // G3: the fringe's copies read the material field up to ringShift px from the pixel, and a few px more for each copy's gradient.
    const direct=Math.max(61,48*Math.max(.65,1.6*n('ringSpread',.65)),Math.abs(n('waterSoft',32)),41*Math.abs(n('ringVariation',.7)/.75),n('ringShift',0)>0?Math.abs(n('ringShift',0))+4:0);
    // A projection apron includes appearance displacement too. These are
    // bounds from the actual terms: cosine/value noise <=1, the crack search
    // visits at most +/-4 cells (point delta <4.9 cells per axis), and signed
    // style masks can multiply relief by four. This keeps a tall painted face
    // from disappearing merely because it started south of the output chunk.
    const relief=Math.abs(n('reliefAmount',.5)*n('reliefScale',28))*Math.max(2.5,.25*n('gentleRelief',.6))*Math.max(1,Math.abs(n('gentleRelief',.6)))*Math.max(1,1+.65*n('reliefPatchy',1))*4;
    const severity=Math.max(n('crackSeverity',.6),.6),major=n('crackSpacing',40),minor=major/3.2;
    const blocks=(.5*(1+3*severity)+1.225*major+.5*(.6+1.6*severity)+4.41*minor)*Math.max(n('crackBlocks',.6),.6);
    const bands=columnRows(this.config.column,this.config.variant).bands[0]*Math.max(Math.abs(n('banding',0))*4,.8);
    // The bed's lumps (bedRelief) stay under the water plane, but the pictures are sensitive to this reach (Green's hills shade differently by about one unit of it), so it keeps counting them.
    const lumps=1.6*(Math.abs(n('plainRelief',1.2))+Math.abs(n('lumpRelief',4))+Math.abs(n('bedRelief',0)));
    const extra=relief+blocks+bands+lumps+7.84*Math.abs(n('worms',0))+Math.abs(rock('looseSize',6))+Math.abs(n('rippleHeight',1.4))+(rock('debrisAmount',0)>0?1.5*rock('debrisDepth',4):0);
    const maxVisible=Math.max(this.config.seaLevel,heightBounds[1]+2.85+Math.abs(this.config.material?.surfaceRelief??1)*extra+4);
    return {draw,bake,direct,far,projection:[(this.config.seaLevel-this.config.baseHeight)/2,(maxVisible-this.config.baseHeight)/2]};
  }
  requiredRegion(request) {
    const size=request.worldSize??this.config.worldSize??this.size,grid=request.worldGrid??this.config.worldGrid??this.grid,spacing=(size-1)/(grid-1);
    if(!(size>1&&grid>1))throw new Error('nanolathe: invalid chunk world lattice');
    const {x,y,width,height}=request;
    if(![x,y,width,height].every(Number.isInteger)||width<1||height<1)throw new Error('nanolathe: chunk bounds must be integer pixels');
    const shift=request.exportArt?Math.floor(this.config.baseHeight/2):0;
    const reach=this.reaches(request.heightBounds);
    // The voxel lattice is global; projection and shading aprons determine
    // which native height/material inputs a screen rectangle needs.
    const fieldsX=clamp(Math.floor(x-reach.draw)-1,0,size-1),fieldsY=clamp(Math.floor(y+shift+reach.projection[0]-reach.draw)-1,0,size-1);
    const fieldsEndX=clamp(Math.ceil(x+width+reach.draw)+1,0,size-1),fieldsEndY=clamp(Math.ceil(y+shift+height+reach.projection[1]+reach.draw)+1,0,size-1);
    const input=Math.max(reach.bake,reach.direct-reach.draw,reach.far-reach.draw,5);
    // One extra grid sample covers linear filtering, including weatherAt's
    // deliberately corner-based (rather than texel-centred) UVs.
    const gx0=clamp(Math.floor((fieldsX-input)/spacing)-1,0,grid-1),gy0=clamp(Math.floor((fieldsY-input)/spacing)-1,0,grid-1);
    const gx1=clamp(Math.ceil((fieldsEndX+input)/spacing)+1,0,grid-1),gy1=clamp(Math.ceil((fieldsEndY+input)/spacing)+1,0,grid-1);
    return {x:gx0*spacing,y:gy0*spacing,width:(gx1-gx0)*spacing,height:(gy1-gy0)*spacing,
      gridOrigin:[gx0*spacing,gy0*spacing],gridWidth:gx1-gx0+1,gridHeight:gy1-gy0+1,gridSpacing:spacing,worldSize:size,worldGrid:grid,
      fieldsX,fieldsY,fieldsWidth:fieldsEndX-fieldsX+1,fieldsHeight:fieldsEndY-fieldsY+1,
      screenOrigin:[x,y+shift],reach};
  }
  // Relief and cached output use scale s. Color is evaluated at up to four
  // native samples per output pixel, then filtered after shading and palette mapping.
  estimate(region,width,height,maskPlaneCount=this.maskPlaneCount,scale=1,{budgetBytes=this.budgetBytes,reservedBytes=this.reservedBytes,preview=false}={}) {
    region=alignedFieldRegion(region,scale);
    // Preview blocks reuse their exact lattice dimensions. Finals retain their
    // padded input dimensions and sampling. Coarse/quarter share the input set.
    // Per texel: height 4 + routes 4 + weather/material 4 layers x 4, then 4 a mask layer.
    const fieldScale=fieldLevel(scale),field=pow2(Math.ceil(region.fieldsWidth/fieldScale))*pow2(Math.ceil(region.fieldsHeight/fieldScale))*8;
    const maskLayers=Math.max(1,Math.ceil(maskPlaneCount/4)),input=(preview?region.gridWidth*region.gridHeight:pow2(region.gridWidth)*pow2(region.gridHeight))*(24+maskLayers*4);
    const gw=preview?region.gridWidth:pow2(region.gridWidth),gh=preview?region.gridHeight:pow2(region.gridHeight),packing=this.maskPacking(gw,gh,budgetBytes),maskPack=packing.bytes+packing.settingsBytes;
    const rasterScale=scale<1?scale:Math.max(1,scale/2);
    // Presentation, persistent color, and the copied output image.
    const output=Math.ceil(width/rasterScale)*Math.ceil(height/rasterScale)*8+Math.ceil(width/scale)*Math.ceil(height/scale)*4;
    // The loose-stone / plant mask survives chunk reuse. Include its current
    // allocation and the largest next allocation before reserving voxel memory.
    const margin=Math.max(Math.ceil(3.6*(this.number('boulders',0)>0?32:Math.min(16,3.3*this.rockMax('looseSize',this.number('looseSize',6)))))+4,PLANT_REACH);
    const loose=Math.max(this.looseBuffer?.size??16,(Math.ceil((region.fieldsWidth+2*fieldScale+2*margin)/4)+2)*(Math.ceil((region.fieldsHeight+2*fieldScale+2*margin)/4)+2)*32);
    const rockWeather=this.rockMax('runoff',this.number('runoff',0))>0||this.rockMax('debrisAmount',this.number('debrisAmount',0))>0||this.number('rimReach',0)>0||this.number('shoreRock',0)>0||this.number('shoreShelf',0)>0?rockWeatherBytes(region.fieldsWidth+2*fieldScale,region.fieldsHeight+2*fieldScale):0;
    // D is released before mask packing, so their scratch reservations overlap.
    const voxel=Math.min(64*MB,budgetBytes*.35),geometryPixels=(Math.ceil(width/rasterScale)+2)*(Math.ceil(height/rasterScale)+2),geometryRecord=geometryPixels*56,geometry=geometryPixels*60;
    return {field,input,output,loose,rockWeather,maskPlaneCount,maskLayers,voxel,geometry,geometryRecord,maskPack,colorCacheBytes:this.colorBytes,workingBytes:field+input+output+loose+Math.max(voxel,maskPack)+rockWeather+geometry,
      retainedBytes:this.fixedBytes,reservedBytes,gpuBytes:this.fixedBytes+reservedBytes+this.colorBytes+field+input+output+loose+Math.max(voxel,maskPack)+rockWeather+geometry,
      cpuRetainedBytes:this.cpuRetainedBytes,cpuUploadBytes:input,cpuPeakBytes:this.cpuRetainedBytes+input};
  }

  // Budget probes are pure: a view-size trial must not evict an active bake.
  chunkSize(maximum=this.config.chunkSize??512,budgetBytes=this.budgetBytes,reservedBytes=this.reservedBytes) {
    let size=Math.floor(maximum/32)*32;
    while(size>=32) {
      const region=this.requiredRegion({x:Math.floor(this.size/2),y:Math.floor(this.size/2),width:size,height:size}),e=this.estimate(region,size,size,this.maskPlaneCount,1,{budgetBytes,reservedBytes});
      if(Math.max(pow2(region.fieldsWidth),pow2(region.fieldsHeight),pow2(region.gridWidth),pow2(region.gridHeight),size+2)<=this.limit&&
        e.gpuBytes-e.colorCacheBytes<=budgetBytes&&e.geometryRecord<=this.device.limits.maxStorageBufferBindingSize)return size;
      size=Math.floor(size/64)*32;
    }
    throw new Error('nanolathe: terrain materials and a 32 px chunk exceed the GPU memory budget');
  }
  // Reserve the parent's copied output images against the same terrain budget.
  // Estimates count application texture formats and buffers, not driver overhead.
  setBudget(bytes,reservedBytes=this.reservedBytes) { return this.setBudgetMB(bytes/MB,reservedBytes); }
  setBudgetMB(value,reservedBytes=this.reservedBytes) {
    if(!Number.isFinite(value)||value<=0||!Number.isFinite(reservedBytes)||reservedBytes<0)throw new Error('nanolathe: invalid GPU memory budget');
    this.budgetBytes=value*MB;this.reservedBytes=reservedBytes;
    if(!this.busy&&this.completedChunk===this.previousChunk)this.voxel?.clear();
    this.trimColorTiles(()=>this.residentBytes+this.reservedBytes<=this.budgetBytes);
    this.captureWorking();this.trimWorking(new Set([this.activeInput,this.activeLevel]),()=>this.residentBytes+this.reservedBytes<=this.budgetBytes);
    if(this.residentBytes+this.reservedBytes>this.budgetBytes)this.evict();
    this.recommendedChunkSize=this.chunkSize();this.recordMemory();return this.recommendedChunkSize;
  }
  texture(label,width,height,layers,format,bytes,usage,kind='working') {
    return this.track(this.device.createTexture({label,size:[width,height,layers],format,usage}),label,width*height*layers*bytes,kind);
  }
  // Texture capacity is cached, never its rendered contents. Every job still
  // feeds and bakes the same window. Coarse/quarter levels share an input set
  // whenever their exact padded lattice dimensions match.
  captureWorking(){
    if(this.activeLevel)Object.assign(this.activeLevel,{fieldsTexture:this.fieldsTexture,voxelColor:this.voxelColor,rock:Object.fromEntries(ROCK_WORKING.map(k=>[k,this.rockWeather[k]]))});
  }
  workingGroups(){return [...this.inputSets].map(([key,state])=>({kind:'input',key,state})).concat([...this.levelSets].map(([key,state])=>({kind:'level',key,state})));}
  workingResources(state){return state.textures??[state.fieldsTexture,state.voxelColor,...(state.rock?.owned??[])].filter(Boolean);}
  workingBytes(state){return this.workingResources(state).reduce((n,r)=>n+(this.resources.get(r)?.bytes??0),0);}
  emptyRock(){return {owned:[],final:null,source:null,rim:null,key:''};}
  dropWorking({kind,key,state}){
    for(const r of new Set(this.workingResources(state)))this.release(r);
    if(kind==='input'){
      this.inputSets.delete(key);if(this.activeInput===state){this.activeInput=null;for(const k of INPUT_TEXTURES)this[k]=null;}
    }else{
      this.levelSets.delete(key);if(this.activeLevel===state){this.activeLevel=null;this.fieldsTexture=this.voxelColor=null;Object.assign(this.rockWeather,this.emptyRock());}
    }
    this.bindGroups={};
  }
  trimWorking(keep,enough){
    for(const group of this.workingGroups().filter(g=>!keep.has(g.state)).sort((a,b)=>a.state.used-b.state.used)){
      if(enough())break;this.dropWorking(group);
    }
  }
  makeWorkingRoom(bytes){
    this.captureWorking();
    const enough=()=>this.residentBytes+this.reservedBytes+bytes<=this.budgetBytes;
    this.trimColorTiles(enough);this.trimWorking(new Set([this.activeInput,this.activeLevel]),enough);return enough();
  }
  async allocate(region,gridWidth,gridHeight,world_width,world_height,fed=false,scale=1,preview=false) {
    region=alignedFieldRegion(region,scale);this.geometryValid=false;
    this.voxel.clear();
    const rasterScale=scale<1?scale:Math.max(1,scale/2),width=Math.ceil(world_width/rasterScale),height=Math.ceil(world_height/rasterScale);   // Color raster; the cached image below still uses `scale`.
    const fieldScale=fieldLevel(scale),fw=pow2(Math.ceil(region.fieldsWidth/fieldScale)),fh=pow2(Math.ceil(region.fieldsHeight/fieldScale)),gw=preview?gridWidth:pow2(gridWidth),gh=preview?gridHeight:pow2(gridHeight);

    this.trimColorTiles(()=>this.estimate({...region,gridWidth,gridHeight},world_width,world_height,this.maskPlaneCount,scale,{preview}).gpuBytes<=this.budgetBytes);
    let e=this.estimate({...region,gridWidth,gridHeight},world_width,world_height,this.maskPlaneCount,scale,{preview});
    const required=e.gpuBytes;
    if(Math.max(fw,fh,gw,gh,width+2,height+2)>this.limit||required>this.budgetBytes||e.geometryRecord>this.device.limits.maxStorageBufferBindingSize){
      // H13: the parts of the estimate, so a refusal says which one crossed the budget (reserved is the canvas, the paged fields and the image cache).
      const mb=n=>Math.ceil(n/MB),parts=`fixed ${mb(e.retainedBytes)}, reserved ${mb(e.reservedBytes)}, field ${mb(e.field)}, input ${mb(e.input)}, loose ${mb(e.loose)}, rock weather ${mb(e.rockWeather)}, voxels ${mb(e.voxel)}, geometry ${mb(e.geometry)}, mask staging ${mb(e.maskPack)}, output ${mb(e.output)} of ${mb(this.budgetBytes)}`;
      throw new Error(`nanolathe: chunk needs ${mb(required)} MB of GPU memory (${parts}); use chunks of ${this.chunkSize()} px or smaller`);
    }
    this.captureWorking();this.voxel.clear();
    const inputKey=[gw,gh,this.maskLayers,fed].join(','),levelKey=[fw,fh].join(',');
    let input=this.inputSets.get(inputKey),level=this.levelSets.get(scale);
    if(level&&level.key!==levelKey){this.dropWorking({kind:'level',key:scale,state:level});level=null;}
    if(!input){input={used:0,textures:[]};this.inputSets.set(inputKey,input);}
    if(!level){level={key:levelKey,used:0,rock:this.emptyRock(),fieldsTexture:null,voxelColor:null};this.levelSets.set(scale,level);}
    if(level.voxelColor&&(level.voxelColor.width!==width||level.voxelColor.height!==height)){this.release(level.voxelColor);level.voxelColor=null;}
    const rockBytes=level.rock.owned.reduce((n,r)=>n+(this.resources.get(r)?.bytes??0),0);
    if(rockBytes>e.rockWeather){for(const r of level.rock.owned)this.release(r);level.rock=this.emptyRock();}
    const keep=new Set([input,level]),unused=()=>this.workingGroups().filter(g=>!keep.has(g.state)).reduce((n,g)=>n+this.workingBytes(g.state),0);
    this.trimWorking(keep,()=>required+unused()<=this.budgetBytes);
    if(this.maskLayers>this.device.limits.maxTextureArrayLayers)throw new Error('nanolathe: mask planes exceed the device texture array limit');
    const T=GPUTextureUsage,read=T.TEXTURE_BINDING|T.COPY_DST|(fed?T.STORAGE_BINDING:0);
    // Reused textures allocate nothing; an empty error scope only adds an IPC
    // round trip to every tile. Keep every actual allocation (and the forced
    // failure probe) inside the scope.
    if(this.failWorkingAllocation||!input.textures.length||!level.fieldsTexture)try{
      await terrainAllocation(this.device,()=>{
      if(this.failWorkingAllocation){this.failWorkingAllocation=false;throw new TerrainMemoryError('Forced working-set allocation failure.');}
      if(!input.textures.length){
        const make=(key,label,layers,format,bytes)=>{input[key]=this.texture(label,gw,gh,layers,format,bytes,read);input.textures.push(input[key]);};
        make('heightTexture','chunk height',1,'r32float',4);make('routeTexture','chunk routes',1,'rgba8unorm',4);
        make('gridTexture','chunk weather and material',4,'rgba8unorm',4);input.maskTexture=this.texture('chunk masks',gw,gh,this.maskLayers,'rgba8snorm',4,read|T.COPY_SRC);input.textures.push(input.maskTexture);
      }
      if(!level.fieldsTexture)level.fieldsTexture=this.texture('chunk fields',fw,fh,1,'rgba16float',8,T.STORAGE_BINDING|T.TEXTURE_BINDING);
      });
    }catch(error){this.dropWorking({kind:'input',key:inputKey,state:input});this.dropWorking({kind:'level',key:scale,state:level});throw error;}
    this.activeInput=input;this.activeLevel=level;input.used=level.used=++this.workingTick;
    for(const k of INPUT_TEXTURES)this[k]=input[k];this.colorMaskTexture=this.maskTexture;
    this.fieldsTexture=level.fieldsTexture;this.voxelColor=level.voxelColor;Object.assign(this.rockWeather,level.rock);
    // The loose buffer can grow on another level, so its output bind group is fresh.
    this.fieldsOut=this.makeFieldsOut();this.bindGroups={};
    if(this.canvas.width!==width)this.canvas.width=width;if(this.canvas.height!==height)this.canvas.height=height;
    this.outputCanvas??=new OffscreenCanvas(width,height);
    const ow=Math.ceil(world_width/scale),oh=Math.ceil(world_height/scale);
    if(this.outputCanvas.width!==ow)this.outputCanvas.width=ow;if(this.outputCanvas.height!==oh)this.outputCanvas.height=oh;
    this.outputBytes=width*height*4+ow*oh*4;
    // The texture is padded for reuse, but only this region and one filtering
    // guard texel can be sampled. Avoid shading the unused power-of-two tail.
    this.bakeWidth=Math.min(fw,Math.ceil(region.fieldsWidth/fieldScale)+1);
    this.bakeHeight=Math.min(fh,Math.ceil(region.fieldsHeight/fieldScale)+1);
    this.bakeWindow=[region.fieldsX,region.fieldsY,this.bakeWidth*fieldScale,this.bakeHeight*fieldScale];this.f('uChunkFieldsOrigin',[region.fieldsX,region.fieldsY]);this.f('uChunkFieldsSize',[fw,fh]);
    this.f('uChunkGridSize',[gw,gh]);this.f('uChunkGridCount',[gridWidth,gridHeight]);
    this.f('uChunkScreenOrigin',region.screenOrigin);this.f('uChunkScale',rasterScale);this.f('uChunkFieldScale',fieldScale);   // Shared shader coordinates stay in world pixels at every display scale.
    // Keep native material variance before nonlinear coverage and palette mapping.
    // Averaging these inputs first changes the mean rendered color at lower resolutions.
    this.fieldsDirty=true;
    this.recordMemory();return {gw,gh,fw,fh};
  }
  maskPlanes(request) {
    const supplied=request.maskPlanes??request.masks;
    return Array.isArray(supplied)?supplied:(this.config.maskKeys??MASK_KEYS).map(k=>supplied?.[k]??request.fields?.[k]);
  }
  upload(request,region,{gw,gh},planes) {
    const fields=request.fields,n=request.gridWidth*(request.gridHeight??request.gridWidth),w=request.gridWidth,h=request.gridHeight??request.gridWidth;
    if(!fields?.h||fields.h.length!==n)throw new Error('nanolathe: invalid regional height field');
    const spacing=request.gridSpacing??region.gridSpacing,origin=request.gridOrigin??region.gridOrigin;
    if(Math.abs(spacing-region.gridSpacing)>1e-7)throw new Error('nanolathe: regional fields must keep the global grid spacing');
    const ox=Math.round(origin[0]/spacing),oy=Math.round(origin[1]/spacing);
    if(Math.abs(ox*spacing-origin[0])>1e-5||Math.abs(oy*spacing-origin[1])>1e-5)throw new Error('nanolathe: regional field origin is off the global lattice');
    const need=region.gridOrigin.map(v=>Math.round(v/spacing));
    if(ox>need[0]||oy>need[1]||ox+w<need[0]+region.gridWidth||oy+h<need[1]+region.gridHeight)
      throw new Error('nanolathe: regional fields do not cover the shader apron; call requiredRegion first');
    this.f('uChunkGridOrigin',[ox,oy]);
    for(const plane of planes)if(plane&&plane.length!==n)throw new Error('nanolathe: invalid regional mask plane dimensions');
    const pixels=gw*gh,height=new Float32Array(pixels),routes=new Uint8Array(pixels*4),grid=new Uint8Array(pixels*16),masks=new Int8Array(pixels*this.maskLayers*4);
    const painted=new Array(planes.length).fill(0),toByte=v=>Math.round(clamp(v??0,0,1)*255);
    this.uploadBytes=height.byteLength+routes.byteLength+grid.byteLength+masks.byteLength;
    this.cpuWorkingBytes=this.uploadBytes;this.cpuUploadBytes=Math.max(this.cpuUploadBytes,this.uploadBytes);this.recordMemory();
    const weather=request.weather??fields.weather,material=request.material??fields.material;
    // H7 2c: the same bytes as the per-pixel form this replaces (which built three arrays per pixel and followed optional chains),
    // with every plane looked up once. A plane the request does not carry stays at the zero the buffers start with, which is
    // what toByte(undefined) and a missing mask value give.
    const names=['flow','deposit','talus','sand'],wearNames=['wear','wet','hard','slope'],fallNames=['fx','fy','channel','ridge'];
    const plane=(names2,k)=>Array.isArray(weather)?weather[k]:weather?.[names2[k]];
    const wp=[0,1,2,3].map(k=>plane(names,k)),wearP=[0,1,2,3].map(k=>weather?.[wearNames[k]]),fallP=[0,1,2,3].map(k=>weather?.[fallNames[k]]);
    const fr=fields.r,fc=fields.c,fv=fields.v,fx=fields.x,fh=fields.h,fu=fields.u,exportArt=request.exportArt,sea=this.config.seaLevel;
    const gridPlanes=[]; // [plane, byte offset of the layer, channel]
    for(let k=0;k<4;k++){if(wp[k])gridPlanes.push([wp[k],0,k]);if(wearP[k])gridPlanes.push([wearP[k],pixels*8,k]);if(fallP[k])gridPlanes.push([fallP[k],pixels*12,k]);}
    const lastRow=h-1,lastCol=w-1;
    for(let y=0;y<gh;y++) {
      const row=Math.min(y,lastRow)*w;
      for(let x=0;x<gw;x++) {
        const src=row+Math.min(x,lastCol),dst=y*gw+x,d4=dst*4;
        const art=fu?fh[src]-fu[src]:fh[src];   // the art's height: less the undulation it does not show (engine-feed.wgsl feedMain)
        height[dst]=(exportArt?clamp(art,0,255):art)-sea;
        routes[d4]=toByte(fr?.[src]);routes[d4+1]=toByte(fc?.[src]);routes[d4+2]=Math.round((clamp(fv?.[src]??0,-1,1)*.5+.5)*255);routes[d4+3]=toByte(fx?.[src]);
        for(let k=0;k<planes.length;k++){const pk=planes[k];if(!pk)continue;const v=pk[src]??0;masks[(k>>2)*pixels*4+d4+(k&3)]=v;if(v!==0)painted[k]=1;}
        if(material)for(let k=0;k<4;k++)grid[pixels*4+d4+k]=toByte(material[src*4+k]);
        for(let j=0;j<gridPlanes.length;j++){const g=gridPlanes[j];grid[g[1]+d4+g[2]]=toByte(g[0][src]);}
      }
    }
    const q=this.device.queue;q.writeTexture({texture:this.heightTexture},height,{bytesPerRow:gw*4},[gw,gh]);q.writeTexture({texture:this.routeTexture},routes,{bytesPerRow:gw*4},[gw,gh]);
    q.writeTexture({texture:this.gridTexture},grid,{bytesPerRow:gw*4,rowsPerImage:gh},[gw,gh,4]);q.writeTexture({texture:this.maskTexture},masks,{bytesPerRow:gw*4,rowsPerImage:gh},[gw,gh,this.maskLayers]);
    const flags={paintOn:painted.slice(0,9).some(Boolean),scatterOn:painted[4],styleOn:painted.slice(5,9).some(Boolean),waterOn:painted.slice(9,11).some(Boolean)||painted[18],lumpOn:painted[12],overrideOn:painted.slice(14,18).some(Boolean),rockIdOn:painted[20],...request.maskFlags};
    for(const k of ChunkTerrainRenderer.FLAGS)this.i('u'+k[0].toUpperCase()+k.slice(1),flags[k]??0);
    this.materialReady=Boolean(material);this.weatherMaps=Boolean(weather?.wear);this.cpuWorkingBytes=0;
  }
  // H7b: the seven painted-mask flags (uniforms that gate whole branches) used to come back to the CPU through a mapped read, a full GPU round trip
  // (about 8 ms) between the feed pass and the draw. They are now expanded from the feed pass's word by one more tiny pass and copied into the
  // uniform buffer inside the same submission, so nothing waits. The expansion is the arithmetic the CPU applied to the word:
  //   paintOn: any of bits 0-8, scatterOn: bit 4, styleOn: any of 5-8, waterOn: any of 9-10 or 18, lumpOn: bit 12, overrideOn: any of 14-17,
  //   rockIdOn: bit 20 (a cell claimed for a rock other than the world's own).
  // While it is in use, flushUniforms writes the CPU copy around those seven fields, so the CPU never overwrites the GPU's values.
  static FLAGS=['paintOn','scatterOn','styleOn','waterOn','lumpOn','overrideOn','rockIdOn'];
  flagPass() {
    if(this.flagsPass)return this.flagsPass;
    const device=this.device,module=device.createShaderModule({label:'chunk flags',code:`
      @group(0) @binding(0) var<storage, read> painted: array<u32>;
      @group(0) @binding(1) var<storage, read_write> flags: array<u32, 7>;
      fn any_(w: u32, a: u32, b: u32) -> u32 { let mask = ((1u << (b - a)) - 1u) << a; return select(0u, 1u, (w & mask) != 0u); }
      @compute @workgroup_size(1) fn main() {
        let w = painted[0];
        flags[0] = any_(w, 0u, 9u);
        flags[1] = (w >> 4u) & 1u;
        flags[2] = any_(w, 5u, 9u);
        flags[3] = max(any_(w, 9u, 11u), (w >> 18u) & 1u);
        flags[4] = (w >> 12u) & 1u;
        flags[5] = any_(w, 14u, 18u);
        flags[6] = (w >> 20u) & 1u;
      }`});
    const pipe=device.createComputePipeline({label:'chunk flags',layout:'auto',compute:{module,entryPoint:'main'}});
    const out=device.createBuffer({label:'chunk flags out',size:28,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
    const offsets=ChunkTerrainRenderer.FLAGS.map(k=>this.layout.fields.get(k).offset);
    return this.flagsPass={pipe,out,offsets,ranges:[...offsets].sort((a,b)=>a-b)};
  }
  flushUniforms() {
    if(!this.gpuFlags)return super.flushUniforms();
    if(!this.uniformsDirty)return;
    const data=this.uniformData;let at=0;
    for(const o of this.flagsPass.ranges){if(o>at)this.device.queue.writeBuffer(this.uniformBuffer,at,data,at,o-at);at=o+4;}
    if(at<data.byteLength)this.device.queue.writeBuffer(this.uniformBuffer,at,data,at,data.byteLength-at);
    this.uniformsDirty=false;
  }
  // H6b: engine-feed.wgsl's feedMain makes the chunk's height, route, weather and mask textures from the whole-map buffers: the same
  // arithmetic as the CPU read (the weather blend) and `upload` (the export clamp, the byte conversions, the edge repeat), in f32. The
  // painted flags come back as a 25-bit word (one small mapped read), then set the same uniforms `upload` does.
  async feedFromGpu(request,region,{gw,gh},feed,passes) {
    const device=this.device,spacing=region.gridSpacing,ox=Math.round(region.gridOrigin[0]/spacing),oy=Math.round(region.gridOrigin[1]/spacing);
    this.f('uChunkGridOrigin',[ox,oy]);
    const encoder=device.createCommandEncoder({label:'chunk feed'});
    // H5b: a paged map gathers the chunk's lattice from the pages into a staging set laid out as a small whole map (origin 0, stride = the lattice's width).
    const src=feed.gather?feed.gather(encoder,passes):feed,gathered=Boolean(feed.gather);
    const uniform=feedUniform(device,{grid:gathered?src.grid:feed.grid,cells:gathered?src.cells:feed.grid*feed.grid,ox:gathered?0:ox-(src.origin?.[0]??0),oy:gathered?0:oy-(src.origin?.[1]??0),gw,gh,cw:region.gridWidth,ch:region.gridHeight,sea:this.config.seaLevel,
      mode:(src.weather?1:0)|(src.maps?2:0)|(request.exportArt?4:0)|(src.field?8:0),invalidRect:src.invalidRect});
    this.feedDummy??=device.createBuffer({label:'feed absent',size:16,usage:GPUBufferUsage.STORAGE});
    const S=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST,painted=device.createBuffer({label:'feed painted',size:16,usage:S}),stage=device.createBuffer({label:'feed painted read',size:16,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
    const none={buffer:this.feedDummy},res={'0.0':{buffer:uniform},'0.1':{buffer:src.planes},'0.2':{buffer:src.masks},'2.0':src.weather?{buffer:src.weather}:none,
      '2.1':src.maps?{buffer:src.maps[0]}:none,'2.2':src.maps?{buffer:src.maps[1]}:none,'2.3':src.maps?{buffer:src.maps[2]}:none,'2.4':{buffer:painted},
      '2.5':this.heightTexture.createView(),'2.6':this.routeTexture.createView(),'2.7':this.gridTexture.createView({dimension:'2d-array'}),'2.8':this.maskTexture.createView({dimension:'2d-array'}),'2.9':src.field?{buffer:src.field}:none};
    const pass=encoder.beginComputePass({label:'chunk feed'});
    pass.setPipeline(passes.pipes.feedMain);for(const [g,bg] of passes.groups('feedMain',res))pass.setBindGroup(g,bg);
    pass.dispatchWorkgroups(Math.ceil(gw/8),Math.ceil(gh/8));pass.end();
    const onGpu=!request.maskFlags;   // an explicit flag override (none on the map canvas) keeps the read-back below
    if(onGpu){
      const f=this.flagPass(),flagPass=encoder.beginComputePass({label:'chunk flags'});
      flagPass.setPipeline(f.pipe);flagPass.setBindGroup(0,device.createBindGroup({layout:f.pipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:painted}},{binding:1,resource:{buffer:f.out}}]}));
      flagPass.dispatchWorkgroups(1);flagPass.end();
      f.offsets.forEach((o,i)=>encoder.copyBufferToBuffer(f.out,i*4,this.uniformBuffer,o,4));this.gpuFlags=true;
    }else encoder.copyBufferToBuffer(painted,0,stage,0,16);
    device.queue.submit([encoder.finish()]);src.tmp?.forEach(b=>b.destroy());feed.release?.();   // submitted: the buffers it reads may be destroyed now
    this.uploadBytes=0;this.cpuUploadBytes=0;
    if(onGpu){painted.destroy();stage.destroy();uniform.destroy();}
    else{
      await stage.mapAsync(GPUMapMode.READ);const word=new Uint32Array(stage.getMappedRange().slice(0))[0];stage.unmap();stage.destroy();painted.destroy();uniform.destroy();
      const on=k=>(word>>>k)&1,any=(a,b)=>{for(let k=a;k<b;k++)if(on(k))return 1;return 0;};
      const flags={paintOn:any(0,9),scatterOn:on(4),styleOn:any(5,9),waterOn:any(9,11)||on(18),lumpOn:on(12),overrideOn:any(14,18),rockIdOn:on(20),...request.maskFlags};
      for(const k of ChunkTerrainRenderer.FLAGS)this.i('u'+k[0].toUpperCase()+k.slice(1),flags[k]??0);
    }
    this.materialReady=Boolean(src.field);this.weatherMaps=Boolean(src.maps);   // the material field rides in layer 1 when the Time pass made one
  }
  maskPacking(width,height,budgetBytes=this.budgetBytes){
    const row=Math.ceil(width/64)*64,limit=Math.min(64*MB,budgetBytes*.35,this.device.limits.maxStorageBufferBindingSize),rows=Math.min(height,Math.max(1,Math.floor(limit/(row*12)))),bands=Math.ceil(height/rows);
    return {row,rows,bands,bytes:row*rows*12,settingsBytes:bands*this.device.limits.minUniformBufferOffsetAlignment};
  }
  async packColorMasks(){
    const texture=this.maskTexture,d=this.device,width=texture.width,height=texture.height,stride=d.limits.minUniformBufferOffsetAlignment,{row,rows:bandRows,bands,bytes,settingsBytes}=this.maskPacking(width,height);
    if(!this.maskPackBuffer||!this.resources.has(this.maskPackBuffer)||this.maskPackBuffer.size!==bytes||!this.resources.has(this.maskPackSettings)||this.maskPackSettings.size!==settingsBytes){
      this.release(this.maskPackBuffer);this.release(this.maskPackSettings);
      await terrainAllocation(d,()=>{
        this.maskPackBuffer=d.createBuffer({label:'color mask staging',size:bytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});this.track(this.maskPackBuffer,'color mask staging',bytes,'working');
        this.maskPackSettings=d.createBuffer({label:'color mask bands',size:settingsBytes,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});this.track(this.maskPackSettings,'color mask bands',settingsBytes,'working');
      });
    }
    const settings=new Uint32Array(settingsBytes/4);for(let band=0;band<bands;band++){settings[band*stride/4]=band*bandRows;settings[band*stride/4+1]=Math.min(bandRows,height-band*bandRows);}d.queue.writeBuffer(this.maskPackSettings,0,settings);
    const encoder=d.createCommandEncoder({label:'color mask pack'}),group=d.createBindGroup({layout:this.colorMaskLayout,entries:[{binding:0,resource:texture.createView({dimension:'2d-array'})},{binding:1,resource:{buffer:this.maskPackBuffer}},{binding:2,resource:{buffer:this.maskPackSettings,size:16}}]});
    for(let band=0;band<bands;band++){
      const y=band*bandRows,rows=Math.min(bandRows,height-y),pass=encoder.beginComputePass({label:'color mask pack'});pass.setPipeline(this.colorMaskPipeline);pass.setBindGroup(0,group,[band*stride]);pass.dispatchWorkgroups(Math.ceil(width/8),Math.ceil(rows/8));pass.end();
      encoder.copyBufferToTexture({buffer:this.maskPackBuffer,bytesPerRow:row*4,rowsPerImage:rows},{texture:this.colorMaskTexture,origin:[0,y,0]},[width,rows,3]);
    }
    d.queue.submit([encoder.finish()]);
  }

  // Geometry and surface textures transfer from the mutable workspace; only
  // the three packed mask layers are copied. Evict these before reusable work.
  colorResources(){return [...new Set([this.geometryRecord,this.heightTexture,this.gridTexture,this.fieldsTexture,this.rockWeather.final,this.rockWeather.source,this.rockWeather.rim].filter(r=>this.resources.get(r)?.kind==='working'))];}
  colorTileBytes(){return this.colorResources().reduce((n,r)=>n+this.resources.get(r).bytes,0)+this.maskTexture.width*this.maskTexture.height*12+this.layout.size;}
  async retainColorTile(){
    if(this.busy||!this.geometryValid||!this.activeInput||!this.activeLevel)return null;
    if(!this.makeWorkingRoom(this.maskTexture.width*this.maskTexture.height*12+this.layout.size))return null;
    this._busy=true;try {
      const owned=this.colorResources(),source={heightTexture:this.heightTexture,gridTexture:this.gridTexture,maskTexture:this.emptyColorMasks,colorMasks:null,fieldsTexture:this.fieldsTexture,rockWeather:{empty:this.rockWeather.empty,final:this.rockWeather.final,source:this.rockWeather.source,rim:this.rockWeather.rim}};
      const tile={owned,source,world:this.geometryUniformSnapshot.slice(),cpu:this.uniformData.slice(0),width:this.canvas.width,height:this.canvas.height,outWidth:this.outputCanvas.width,outHeight:this.outputCanvas.height,record:this.geometryRecord,gpuFlags:this.gpuFlags,users:0,retired:false};
      try{await terrainAllocation(this.device,()=>{
        source.colorMasks=this.texture('retained color masks',this.maskTexture.width,this.maskTexture.height,3,'rgba8snorm',4,GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST,'color-cache');
        tile.uniform=this.device.createBuffer({label:'retained color uniforms',size:this.layout.size,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});this.track(tile.uniform,'retained color uniforms',this.layout.size,'color-cache');
      });}catch(error){this.release(tile.uniform);this.release(source.colorMasks);throw error;}
      const encoder=this.device.createCommandEncoder({label:'retain color flags'});encoder.copyBufferToBuffer(this.uniformBuffer,0,tile.uniform,0,this.layout.size);encoder.copyTextureToTexture({texture:this.maskTexture},{texture:source.colorMasks},[this.maskTexture.width,this.maskTexture.height,3]);this.device.queue.submit([encoder.finish()]);
      tile.owned.push(tile.uniform,source.colorMasks);tile.bytes=tile.owned.reduce((n,r)=>n+this.resources.get(r).bytes,0);for(const r of tile.owned)this.resources.get(r).kind='color-cache';
      tile.group=this.commonBindGroup('draw',source,tile.uniform);this.colorTiles.add(tile);
      // Remove transferred textures from the workspace owners before reuse.
      const keep=new Set(tile.owned),input=this.activeInput,level=this.activeLevel;
      for(const [key,state]of this.inputSets)if(state===input)this.inputSets.delete(key);
      for(const [key,state]of this.levelSets)if(state===level)this.levelSets.delete(key);
      for(const r of [...input.textures,...this.workingResources(level)])if(!keep.has(r))this.release(r);
      this.activeInput=this.activeLevel=null;this.geometryRecord=null;this.geometryValid=false;this.voxelColor=null;Object.assign(this.rockWeather,this.emptyRock());this.bindGroups={};this.recordMemory();return tile;
    }finally{this._busy=false;}
  }
  releaseColorTile(tile){
    if(!tile||!this.colorTiles.has(tile))return;tile.retired=true;
    if(tile.users)return;
    for(const r of tile.owned)this.release(r);this.colorTiles.delete(tile);
  }
  trimColorTiles(enough=()=>false){for(const tile of this.colorTiles){if(enough())break;this.releaseColorTile(tile);}}
  async renderColorTile(tile,options=this.worldOptions){
    if(this.busy)throw Error('The renderer is already rendering.');
    if(!this.colorTiles.has(tile)||tile.retired)throw new DOMException('The color record was evicted.','AbortError');
    this._busy=true;tile.users++;
    try {
      await this.previousChunk;if(tile.retired)throw new DOMException('The color record was evicted.','AbortError');
      this.syncWorld(options);const delta=worldUniformDelta(tile.world,this.uniformData,this.layout,this.uniformStages);
      if(delta.stage&&delta.stage<'F')throw new DOMException('The color record needs '+delta.stage+'.','AbortError');
      const cpu=tile.cpu.slice(0),skip=new Set([...PER_CHUNK_UNIFORMS,'weatherMaps','materialReady','transitionBody','rockWeatherGrid']),rock=this.layout.fields.get('rock');
      for(const [name,f]of this.layout.fields){
        if(skip.has(name)||name.startsWith('chunk')||name!=='rock'&&rock&&f.offset>=rock.offset&&f.offset<rock.offset+rock.count*rock.stride)continue;
        const bytes=f.kind==='struct'?f.count*f.stride:(f.count-1)*f.stride+f.width*4;new Uint8Array(cpu,f.offset,bytes).set(new Uint8Array(this.uniformData,f.offset,bytes));
      }
      // Seven availability flags belong to the GPU snapshot, not this CPU copy.
      let at=0;for(const offset of tile.gpuFlags?this.flagsPass.ranges:[]){if(offset>at)this.device.queue.writeBuffer(tile.uniform,at,cpu,at,offset-at);at=offset+4;}if(at<cpu.byteLength)this.device.queue.writeBuffer(tile.uniform,at,cpu,at,cpu.byteLength-at);
      const {width,height,outWidth,outHeight}=tile;if(this.canvas.width!==width)this.canvas.width=width;if(this.canvas.height!==height)this.canvas.height=height;
      const key=width+','+height;let target=this.colorTargets.get(key);
      if(!target||!this.resources.has(target)){
        if(this.colorTargets.size>=3){const [old,resource]=this.colorTargets.entries().next().value;this.release(resource);this.colorTargets.delete(old);}
        await terrainAllocation(this.device,()=>{target=this.texture('cached color target',width,height,1,this.format,4,GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC);});
      }
      this.colorTargets.delete(key);this.colorTargets.set(key,target);this.colorReplayTarget=target;
      if(tile.retired)throw new DOMException('The color record was evicted.','AbortError');
      this.device.queue.writeBuffer(this.geometrySettings,0,new Uint32Array([width+2,height+2,0,0]));const encoder=this.device.createCommandEncoder({label:'cached tile color'});
      this.encodeColor(encoder,this.genericPipelines[this.rockMask()].draw,[0,0,width,height],true,null,{record:tile.record,group:tile.group,masks:tile.source.colorMasks,target:this.colorReplayTarget});
      encoder.copyTextureToTexture({texture:this.colorReplayTarget},{texture:this.context.getCurrentTexture()},[width,height]);this.device.queue.submit([encoder.finish()]);
      if(this.outputCanvas.width!==outWidth)this.outputCanvas.width=outWidth;if(this.outputCanvas.height!==outHeight)this.outputCanvas.height=outHeight;
      const copy=this.outputCanvas.getContext('2d');copy.imageSmoothingEnabled=true;copy.imageSmoothingQuality='high';copy.drawImage(this.canvas,0,0,outWidth,outHeight);
      const completion=this.device.queue.onSubmittedWorkDone();this.previousChunk=completion;completion.then(()=>{this.completedChunk=completion;},()=>{});this.colorReruns++;
      return {canvas:this.outputCanvas,pipelineKey:this.specKey().key};
    }finally{this._busy=false;tile.users--;if(tile.retired)this.releaseColorTile(tile);}
  }
  // A reusable canvas is returned. Copy it before the next renderChunk; the
  // caller must count its retained bitmap/canvas bytes separately from stats.
  // H6b: options.feed (the GPU shape fields' buffers and the Time pass's, see sculpt.js gpuFeedSource) makes the chunk's textures by a compute pass
  // in place of the CPU read and `upload`; the request then carries no fields, only the chunk's rectangle.
  async renderChunk(request,{feed=null,scale=1,deferCompletion=false,preview=false,deferPipelines=false,...options}={}) {   // feed rides in the options so wrappers that forward (request, options) keep it
    if(this.disposed)throw new Error('nanolathe: chunk renderer is disposed');
    if(this.busy)throw new Error('nanolathe: chunk renderer is already rendering');
    this._busy=true;this.gpuFlags=false;   // set by a fed bake whose flags the GPU writes
    try {
      // Bound live GPU work without delaying the preceding image snapshot.
      // A queued shape edit can arrive while this wait yields to input.
      await this.previousChunk;
      const passes=feed?await feedPasses(this.device):null;   // nothing awaits between here and the feed pass's submit: the buffers it reads stay current
      this.size=request.worldSize??this.size;this.grid=request.worldGrid??this.grid;
      const region=this.requiredRegion(request),w=request.gridWidth??region.gridWidth,h=request.gridHeight??region.gridHeight;
      request={...request,gridWidth:w,gridHeight:h,gridOrigin:request.gridOrigin??region.gridOrigin};
      const planes=feed?new Array(feed.maskCount).fill(null):this.maskPlanes(request);this.maskPlaneCount=planes.length;this.maskLayers=Math.max(1,Math.ceil(planes.length/4));
      this.recommendedChunkSize=this.chunkSize();
      const dimensions=await this.allocate(region,w,h,request.width,request.height,Boolean(feed),scale,preview);
      if(feed)await this.feedFromGpu(request,region,dimensions,feed,passes);else this.upload(request,region,dimensions,planes);
      this.activeRegion=region;this.voxelScale=scale;
      const result=await this.withPipelines(()=>super.draw({...options,exact:options.exact||Boolean(request.exportArt)}),{preview,defer:deferPipelines});
      this.captureWorking();
      // A WebGPU presentation image expires at the next browser frame. Copy
      // synchronously before waiting for the queue, so the returned pixels live.
      const copy=this.outputCanvas.getContext('2d');copy.imageSmoothingEnabled=true;copy.imageSmoothingQuality='high';
      copy.drawImage(this.canvas,0,0,this.outputCanvas.width,this.outputCanvas.height);
      // Prepare the snapshot now; apply GPU backpressure at the next tile.
      // Canvas copying preserves command order and owns this image before reuse.
      const completion=this.device.queue.onSubmittedWorkDone();this.previousChunk=completion;
      completion.then(()=>{this.completedChunk=completion;},()=>{}); // Device errors are also reported by the renderer.
      if(!deferCompletion)await this.previousChunk;
      return {...result,canvas:this.outputCanvas,x:request.x,y:request.y,width:request.width,height:request.height,scale,outWidth:Math.ceil(request.width/scale),outHeight:Math.ceil(request.height/scale),exportArt:Boolean(request.exportArt),outputBytes:Math.ceil(request.width/scale)*Math.ceil(request.height/scale)*4,region,stats:{...this.stats(),busy:false}};
    } finally { this._busy=false;this.cpuWorkingBytes=0; }
  }
  evict() {
    this.trimColorTiles();this.colorTargets.clear();this.voxel?.clear();this.rockWeather?.clear();
    for(const [resource,entry] of [...this.resources])if(entry.kind==='working')this.release(resource);
    this.inputSets.clear();this.levelSets.clear();this.activeInput=this.activeLevel=null;
    for(const key of ['heightTexture','routeTexture','gridTexture','maskTexture','colorMaskTexture','fieldsTexture','voxelColor'])this[key]=null;
    this.bindGroups={};this.canvas.width=1;this.canvas.height=1;if(this.outputCanvas){this.outputCanvas.width=1;this.outputCanvas.height=1;}this.outputBytes=8;this.evictions++;
  }
  dispose() {
    if(this.disposed)return;this.disposed=true;for(const resource of [...this.resources.keys()])this.release(resource);this.feedDummy?.destroy();
    this.context?.unconfigure();this.device?.destroy();if(this.outputCanvas){this.outputCanvas.width=0;this.outputCanvas.height=0;}
    this.outputBytes=0;this.fixedBytes=0;this.cpuWorkingBytes=0;this.uniformData=null;this.uniformView=null;
  }
}
