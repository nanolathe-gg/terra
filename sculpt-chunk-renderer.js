import {rockWeatherBytes} from './sculpt-rock-weather.js';
// Card D: a bounded working set for the existing terrain shader. Materials
// belong to this renderer once; callers own the LRU of copied output images.
import {TerrainRenderer} from './sculpt-renderer.js';
import {columnRows} from './sculpt-column.js';
import {PLANT_REACH,groundCoverOn} from './sculpt-material-model.js';
import {feedPasses, feedUniform} from './sculpt-gpu-fields.js';

const MASK_KEYS=['mr','ms','mw','mm','md','ml','mc','mb','mf','mx','my','mz','mg','mk','ovErosion','ovDeposits','ovVegetation','ovExposure','surf','riverBed','fu','fv','s1','s2','s3'];
const MB=1024*1024, pow2=n=>2**Math.ceil(Math.log2(Math.max(1,n)));
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const mipBytes=(w,h,layers,levels,bytes)=>{let total=0;for(let i=0;i<levels;i++)total+=Math.max(1,w>>i)*Math.max(1,h>>i)*layers*bytes;return total;};

// The relief fields stop at 2x: their memory grows with the square of the level, and 4x's grain is drawn, not baked.
const fieldLevel=scale=>Math.max(scale,.5);
export class ChunkTerrainRenderer extends TerrainRenderer {
  static async create(canvas,config) {
    const self=new ChunkTerrainRenderer(canvas,config);
    try { await self.initialize(); return self; }
    catch(error) { self.dispose(); throw error; }
  }
  constructor(canvas,config) {
    canvas.width=1;canvas.height=1;
    super(canvas,config);
    this.resources=new Map();
    this.budgetBytes=config.gpuBudgetBytes??(config.gpuBudgetMB??512)*MB;this.reservedBytes=config.gpuReservedBytes??0;
    this.peakBytes=0;this.peakBudgetedBytes=0;this.peakCPUBytes=0;this.evictions=0;
    this._busy=false;this.disposed=false;this.outputBytes=0;this.cpuWorkingBytes=0;
  }
  async initialize() {
    await super.initialize();
    this.track(this.uniformBuffer,'uniforms',this.layout.size,'shared');
    this.track(this.looseBuffer,'loose mask',this.looseBuffer.size,'loose');
    this.fixedBytes=[...this.resources.values()].filter(r=>r.kind==='materials'||r.kind==='shared').reduce((n,r)=>n+r.bytes,0);
    this.limit=this.device.limits.maxTextureDimension2D;
    this.setColors();this.recommendedChunkSize=this.chunkSize();
  }
  timer() { return null; }
  track(resource,label,bytes,kind) {
    if(resource)this.resources.set(resource,{label,bytes,kind});
    this.recordMemory();return resource;
  }
  release(resource) { if(!resource)return;resource.destroy();this.resources.delete(resource); }
  get residentBytes() { let n=this.outputBytes;for(const r of this.resources.values())n+=r.bytes;return n; }
  get cpuRetainedBytes() { return this.uniformData?.byteLength??0; }
  recordMemory() {
    this.peakBytes=Math.max(this.peakBytes,this.residentBytes);
    this.peakBudgetedBytes=Math.max(this.peakBudgetedBytes,this.residentBytes+this.reservedBytes);
    this.peakCPUBytes=Math.max(this.peakCPUBytes,this.cpuRetainedBytes+this.cpuWorkingBytes);
  }
  get busy() { return this._busy; }
  stats() {
    const byKind={};for(const r of this.resources.values())byKind[r.kind]=(byKind[r.kind]??0)+r.bytes;
    return {residentBytes:this.residentBytes,peakBytes:this.peakBytes,budgetBytes:this.budgetBytes,outputBytes:this.outputBytes,
      retainedBytes:this.fixedBytes,workingBytes:(byKind.working??0)+(byKind.loose??0)+this.outputBytes,
      reservedBytes:this.reservedBytes,budgetedBytes:this.residentBytes+this.reservedBytes,peakBudgetedBytes:this.peakBudgetedBytes,
      cpuRetainedBytes:this.cpuRetainedBytes,cpuWorkingBytes:this.cpuWorkingBytes,cpuUploadBytes:this.cpuUploadBytes??0,cpuPeakBytes:this.peakCPUBytes,
      textureBytes:this.outputBytes+[...this.resources].filter(([r])=>'format' in r).reduce((n,[,v])=>n+v.bytes,0),
      bufferBytes:[...this.resources].filter(([r])=>!('format' in r)).reduce((n,[,v])=>n+v.bytes,0),
      resources:this.resources.size,byKind,voxel:this.voxel?.stats,busy:this.busy,evictions:this.evictions,recommendedChunkSize:this.recommendedChunkSize,
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
    const n=(k,f)=>this.number(k,f);
    // H1: the close shadow march (6 px) and the cavity rings (4 px) plus the gradient's 1.4 sit inside the far taps' reach.
    const shadow=12**2*1.4+2,draw=Math.max(shadow,128,36,19,11,3,1.4,n('closeShadow',0)>0?6+1.4:0,60,n('cavity',0)>0?4+1.4:0,n('crystalShallow',0)>0?48:0);   // H20: the shallow mosaic's fringe taps the crystal field 48 px out
    // P16: the largest class drawn has radius min(16, 3.3 x the median); a stone reaches 1.6 radii from its candidate (1.41 of a class radius at most) and a larger stone that suppresses it a little further, and the mask reads 14 px up the slope plus its gradient (5).
    const stones=3.6*Math.min(16,3.3*n('looseSize',6))+24;
    const beach=Math.max(this.config.layers.includes('beach')?(this.config.material?.beachWidth??120)*n('beachWidth',.6):0,n('apron',0))*1.35*1.15;
    const bake=Math.max(19,stones,beach,n('runoff',0)>0||n('debrisAmount',0)>0?180:0,groundCoverOn(this.config.material?.groundCover,this.variant)&&this.config.material.groundCover.plants?PLANT_REACH:0);
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
    const lumps=1.6*(Math.abs(n('plainRelief',1.2))+Math.abs(n('lumpRelief',4))+Math.abs(n('bedRelief',0)));
    const extra=relief+blocks+bands+lumps+7.84*Math.abs(n('worms',0))+Math.abs(n('looseSize',6))+Math.abs(n('rippleHeight',1.4))+(n('debrisAmount',0)>0?1.5*n('debrisDepth',4):0);
    const maxVisible=Math.max(this.config.seaLevel,heightBounds[1]+2.85+Math.abs(this.config.material?.surfaceRelief??1)*extra+4);
    return {draw,bake,direct,projection:[(this.config.seaLevel-this.config.baseHeight)/2,(maxVisible-this.config.baseHeight)/2]};
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
    const input=Math.max(reach.bake,reach.direct-reach.draw,5);
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
  estimate(region,width,height,maskPlaneCount=this.maskPlaneCount,scale=1) {
    // input per texel: height 4 + routes 4 + weather/material 4 layers x 4 (as allocate() makes them), then 4 a mask layer.
    const fieldScale=fieldLevel(scale),field=pow2(Math.ceil(region.fieldsWidth/fieldScale))*pow2(Math.ceil(region.fieldsHeight/fieldScale))*8;
    const maskLayers=Math.max(1,Math.ceil(maskPlaneCount/4)),input=pow2(region.gridWidth)*pow2(region.gridHeight)*(24+maskLayers*4);
    const rasterScale=scale<1?scale:Math.max(1,scale/2);
    // Presentation, persistent color, and the copied output image.
    const output=Math.ceil(width/rasterScale)*Math.ceil(height/rasterScale)*8+Math.ceil(width/scale)*Math.ceil(height/scale)*4;
    // The loose-stone / plant mask survives chunk reuse. Include its current
    // allocation and the largest next allocation before reserving voxel memory.
    const margin=Math.max(Math.ceil(3.6*Math.min(16,3.3*this.number('looseSize',6)))+4,PLANT_REACH);
    const loose=Math.max(this.looseBuffer?.size??16,(Math.ceil((region.fieldsWidth+2*fieldScale+2*margin)/4)+2)*(Math.ceil((region.fieldsHeight+2*fieldScale+2*margin)/4)+2)*32);
    const rockWeather=this.number('runoff',0)>0||this.number('debrisAmount',0)>0?rockWeatherBytes(region.fieldsWidth+2*fieldScale,region.fieldsHeight+2*fieldScale):0;
    const voxel=Math.min(64*MB,this.budgetBytes*.35);
    return {field,input,output,loose,rockWeather,maskPlaneCount,maskLayers,voxel,workingBytes:field+input+output+loose+voxel+rockWeather,
      retainedBytes:this.fixedBytes,reservedBytes:this.reservedBytes,gpuBytes:this.fixedBytes+this.reservedBytes+field+input+output+loose+voxel+rockWeather,
      cpuRetainedBytes:this.cpuRetainedBytes,cpuUploadBytes:input,cpuPeakBytes:this.cpuRetainedBytes+input};
  }

  chunkSize(maximum=this.config.chunkSize??512) {
    let size=Math.floor(maximum/32)*32;
    while(size>=32) {
      const region=this.requiredRegion({x:Math.floor(this.size/2),y:Math.floor(this.size/2),width:size,height:size}),e=this.estimate(region,size,size,this.maskPlaneCount,1);
      if(Math.max(pow2(region.fieldsWidth),pow2(region.fieldsHeight),pow2(region.gridWidth),pow2(region.gridHeight),size)<=this.limit&&
        e.gpuBytes<=this.budgetBytes)return size;
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
    if(this.residentBytes+this.reservedBytes>this.budgetBytes)this.evict();
    this.recommendedChunkSize=this.chunkSize();this.recordMemory();return this.recommendedChunkSize;
  }
  texture(label,width,height,layers,format,bytes,usage,kind='working') {
    return this.track(this.device.createTexture({label,size:[width,height,layers],format,usage}),label,width*height*layers*bytes,kind);
  }
  allocate(region,gridWidth,gridHeight,world_width,world_height,fed=false,scale=1) {
    this.voxel.clear();
    const rasterScale=scale<1?scale:Math.max(1,scale/2),width=Math.ceil(world_width/rasterScale),height=Math.ceil(world_height/rasterScale);   // Color raster; the cached image below still uses `scale`.
    const fieldScale=fieldLevel(scale),fw=pow2(Math.ceil(region.fieldsWidth/fieldScale)),fh=pow2(Math.ceil(region.fieldsHeight/fieldScale)),gw=pow2(gridWidth),gh=pow2(gridHeight);
    let e=this.estimate({...region,gridWidth,gridHeight},world_width,world_height,this.maskPlaneCount,scale);
    const required=e.gpuBytes;
    if(Math.max(fw,fh,gw,gh,width,height)>this.limit||required>this.budgetBytes){
      // H13: the parts of the estimate, so a refusal says which one crossed the budget (reserved is the canvas, the paged fields and the image cache).
      const mb=n=>Math.ceil(n/MB),parts=`fixed ${mb(e.retainedBytes)}, reserved ${mb(e.reservedBytes)}, field ${mb(e.field)}, input ${mb(e.input)}, loose ${mb(e.loose)}, rock weather ${mb(e.rockWeather)}, voxels ${mb(e.voxel)}, output ${mb(e.output)} of ${mb(this.budgetBytes)}`;
      throw new Error(`nanolathe: chunk needs ${mb(required)} MB of GPU memory (${parts}); use chunks of ${this.chunkSize()} px or smaller`);
    }
    const allocationKey=[fw,fh,gw,gh,width,height,Math.ceil(world_width/scale),Math.ceil(world_height/scale),this.maskLayers,fed].join(',');
    const reuse=this.allocationKey===allocationKey&&Boolean(this.heightTexture);
    if(!reuse){this.evict();this.allocationKey=allocationKey;}
    const T=GPUTextureUsage,read=T.TEXTURE_BINDING|T.COPY_DST|(fed?T.STORAGE_BINDING:0);   // H6b: the feed pass writes these four
    if(!reuse){
    this.heightTexture=this.texture('chunk height',gw,gh,1,'r32float',4,read);
    this.routeTexture=this.texture('chunk routes',gw,gh,1,'rgba8unorm',4,read);   // r route protection, g the shapes' crack amount, b painted cover signed about one half (above: sand, below: the world's ground), a crystal cells
    this.gridTexture=this.texture('chunk weather and material',gw,gh,4,'rgba8unorm',4,read);   // H5: layers 2 and 3 hold Green's Time maps
    if(this.maskLayers>this.device.limits.maxTextureArrayLayers)throw new Error('nanolathe: mask planes exceed the device texture array limit');
    this.maskTexture=this.texture('chunk masks',gw,gh,this.maskLayers,'rgba8snorm',4,read);
    this.fieldsTexture=this.texture('chunk fields',fw,fh,1,'rgba16float',8,T.STORAGE_BINDING|T.TEXTURE_BINDING);
    this.fieldsOut=this.makeFieldsOut();
    this.canvas.width=width;this.canvas.height=height;this.outputBytes=width*height*4+Math.ceil(world_width/scale)*Math.ceil(world_height/scale)*4;
    this.outputCanvas??=new OffscreenCanvas(width,height);this.outputCanvas.width=Math.ceil(world_width/scale);this.outputCanvas.height=Math.ceil(world_height/scale);
    }
    // The texture is padded for reuse, but only this region and one filtering
    // guard texel can be sampled. Avoid shading the unused power-of-two tail.
    this.bakeWidth=Math.min(fw,Math.ceil(region.fieldsWidth/fieldScale)+1);
    this.bakeHeight=Math.min(fh,Math.ceil(region.fieldsHeight/fieldScale)+1);
    this.bakeWindow=[region.fieldsX,region.fieldsY,this.bakeWidth*fieldScale,this.bakeHeight*fieldScale];this.f('uChunkFieldsOrigin',[region.fieldsX,region.fieldsY]);this.f('uChunkFieldsSize',[fw,fh]);
    this.f('uChunkGridSize',[gw,gh]);this.f('uChunkGridCount',[gridWidth,gridHeight]);
    this.f('uChunkScreenOrigin',region.screenOrigin);this.f('uChunkScale',rasterScale);this.f('uChunkFieldScale',fieldScale);   // Shared shader coordinates stay in world pixels at every display scale.
    // Keep native material variance before nonlinear coverage and palette mapping.
    // Averaging these inputs first changes the mean rendered color at lower resolutions.
    this.f('uMaterialFoot',this.variant.has('materialFoot')?Math.max(1,Number(this.variant.get('materialFoot'))):1);
    if(!reuse)this.bindGroups={};this.fieldsDirty=true;
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
    const flags={paintOn:painted.slice(0,9).some(Boolean),scatterOn:painted[4],styleOn:painted.slice(5,9).some(Boolean),waterOn:painted.slice(9,12).some(Boolean)||painted[13]||painted[18],lumpOn:painted[12],overrideOn:painted.slice(14,18).some(Boolean),...request.maskFlags};
    for(const k of ChunkTerrainRenderer.FLAGS)this.i('u'+k[0].toUpperCase()+k.slice(1),flags[k]??0);
    this.materialReady=Boolean(material);this.weatherMaps=Boolean(weather?.wear);this.cpuWorkingBytes=0;
  }
  // H7b: the six painted-mask flags (uniforms that gate whole branches) used to come back to the CPU through a mapped read, a full GPU round trip
  // (about 8 ms) between the feed pass and the draw. They are now expanded from the feed pass's word by one more tiny pass and copied into the
  // uniform buffer inside the same submission, so nothing waits. The expansion is the arithmetic the CPU applied to the word:
  //   paintOn: any of bits 0-8, scatterOn: bit 4, styleOn: any of 5-8, waterOn: any of 9-11, 13 or 18, lumpOn: bit 12, overrideOn: any of 14-17.
  // While it is in use, flushUniforms writes the CPU copy around those six fields, so the CPU never overwrites the GPU's values.
  static FLAGS=['paintOn','scatterOn','styleOn','waterOn','lumpOn','overrideOn'];
  flagPass() {
    if(this.flagsPass)return this.flagsPass;
    const device=this.device,module=device.createShaderModule({label:'chunk flags',code:`
      @group(0) @binding(0) var<storage, read> painted: array<u32>;
      @group(0) @binding(1) var<storage, read_write> flags: array<u32, 6>;
      fn any_(w: u32, a: u32, b: u32) -> u32 { let mask = ((1u << (b - a)) - 1u) << a; return select(0u, 1u, (w & mask) != 0u); }
      @compute @workgroup_size(1) fn main() {
        let w = painted[0];
        flags[0] = any_(w, 0u, 9u);
        flags[1] = (w >> 4u) & 1u;
        flags[2] = any_(w, 5u, 9u);
        flags[3] = max(max(any_(w, 9u, 12u), (w >> 13u) & 1u), (w >> 18u) & 1u);
        flags[4] = (w >> 12u) & 1u;
        flags[5] = any_(w, 14u, 18u);
      }`});
    const pipe=device.createComputePipeline({label:'chunk flags',layout:'auto',compute:{module,entryPoint:'main'}});
    const out=device.createBuffer({label:'chunk flags out',size:24,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
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
    const uniform=feedUniform(device,{grid:gathered?src.grid:feed.grid,cells:gathered?src.cells:feed.grid*feed.grid,ox:gathered?0:ox,oy:gathered?0:oy,gw,gh,cw:region.gridWidth,ch:region.gridHeight,sea:this.config.seaLevel,
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
      const flags={paintOn:any(0,9),scatterOn:on(4),styleOn:any(5,9),waterOn:any(9,12)||on(13)||on(18),lumpOn:on(12),overrideOn:any(14,18),...request.maskFlags};
      for(const k of ChunkTerrainRenderer.FLAGS)this.i('u'+k[0].toUpperCase()+k.slice(1),flags[k]??0);
    }
    this.materialReady=Boolean(src.field);this.weatherMaps=Boolean(src.maps);   // the material field rides in layer 1 when the Time pass made one
  }
  // A reusable canvas is returned. Copy it before the next renderChunk; the
  // caller must count its retained bitmap/canvas bytes separately from stats.
  // H6b: options.feed (the GPU shape fields' buffers and the Time pass's, see sculpt.js gpuFeedSource) makes the chunk's textures by a compute pass
  // in place of the CPU read and `upload`; the request then carries no fields, only the chunk's rectangle.
  async renderChunk(request,{feed=null,scale=1,deferCompletion=false,...options}={}) {   // feed rides in the options so wrappers that forward (request, options) keep it
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
      const dimensions=this.allocate(region,w,h,request.width,request.height,Boolean(feed),scale);
      if(feed)await this.feedFromGpu(request,region,dimensions,feed,passes);else this.upload(request,region,dimensions,planes);
      this.activeRegion=region;this.voxelScale=scale;
      const result=await this.withPipelines(()=>super.draw({...options,exact:options.exact||Boolean(request.exportArt)}));
      // A WebGPU presentation image expires at the next browser frame. Copy
      // synchronously before waiting for the queue, so the returned pixels live.
      const copy=this.outputCanvas.getContext('2d');copy.imageSmoothingEnabled=true;copy.imageSmoothingQuality='high';
      copy.drawImage(this.canvas,0,0,this.outputCanvas.width,this.outputCanvas.height);
      // Prepare the snapshot now; apply GPU backpressure at the next tile.
      // Canvas copying preserves command order and owns this image before reuse.
      this.previousChunk=this.device.queue.onSubmittedWorkDone();
      this.previousChunk.catch(()=>{}); // Device errors are also reported by the renderer.
      if(!deferCompletion)await this.previousChunk;
      return {...result,canvas:this.outputCanvas,x:request.x,y:request.y,width:request.width,height:request.height,scale,outWidth:Math.ceil(request.width/scale),outHeight:Math.ceil(request.height/scale),exportArt:Boolean(request.exportArt),outputBytes:Math.ceil(request.width/scale)*Math.ceil(request.height/scale)*4,region,stats:{...this.stats(),busy:false}};
    } finally { this._busy=false;this.cpuWorkingBytes=0; }
  }
  evict() {
    this.voxel?.clear();this.rockWeather?.clear();
    for(const [resource,entry] of [...this.resources])if(entry.kind==='working')this.release(resource);
    for(const key of ['heightTexture','routeTexture','gridTexture','maskTexture','fieldsTexture','voxelColor'])this[key]=null;
    this.bindGroups={};this.canvas.width=1;this.canvas.height=1;if(this.outputCanvas){this.outputCanvas.width=1;this.outputCanvas.height=1;}this.outputBytes=8;this.evictions++;
  }
  dispose() {
    if(this.disposed)return;this.disposed=true;for(const resource of [...this.resources.keys()])this.release(resource);this.feedDummy?.destroy();
    this.context?.unconfigure();this.device?.destroy();if(this.outputCanvas){this.outputCanvas.width=0;this.outputCanvas.height=0;}
    this.outputBytes=0;this.fixedBytes=0;this.cpuWorkingBytes=0;this.uniformData=null;this.uniformView=null;
  }
}
