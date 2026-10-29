// Card D: a bounded working set for the existing terrain shader. Materials
// belong to this renderer once; callers own the LRU of copied output images.
import {TerrainRenderer} from './sculpt-renderer.js';

const MASK_KEYS=['mr','ms','mw','mm','md','ml','mc','mb','mf','mx','my','mz','mg','mk','free14','free15','free16','free17','free18','free19','fu','fv','s1','s2','s3'];
const MB=1024*1024, pow2=n=>2**Math.ceil(Math.log2(Math.max(1,n)));
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const mipBytes=(w,h,layers,levels,bytes)=>{let total=0;for(let i=0;i<levels;i++)total+=Math.max(1,w>>i)*Math.max(1,h>>i)*layers*bytes;return total;};

export class ChunkTerrainRenderer extends TerrainRenderer {
  static async create(canvas,config) {
    const self=new ChunkTerrainRenderer(canvas,config);
    try { await self.initialize(); return self; }
    catch(error) { self.dispose(); throw error; }
  }
  constructor(canvas,config) {
    // Never let the whole-map initializer allocate a world-sized field or mesh.
    // All material and uniform setup still follows the existing renderer.
    canvas.width=1;canvas.height=1;
    super(canvas,{...config,size:1,grid:1});
    this.sourceConfig=config;this.chunked=true;this.resources=new Map();
    this.budgetBytes=config.gpuBudgetBytes??(config.gpuBudgetMB??512)*MB;this.reservedBytes=config.gpuReservedBytes??0;
    this.peakBytes=0;this.peakBudgetedBytes=0;this.peakCPUBytes=0;this.evictions=0;
    this._busy=false;this.disposed=false;this.outputBytes=0;this.cpuWorkingBytes=0;
  }
  async initialize() {
    await super.initialize();
    this.config=this.sourceConfig;this.size=this.config.worldSize??this.config.size;this.grid=this.config.worldGrid??this.config.grid;
    for(const [key,bytes] of [['heightTexture',4],['routeTexture',4],['gridTexture',8],['maskTexture',this.maskLayers*4],['fieldsTexture',8]])
      this.track(this[key],key,bytes,'working');
    this.track(this.uniformBuffer,'uniforms',this.layout.size,'shared');
    this.height=null;
    this.fixedBytes=[...this.resources.values()].filter(r=>r.kind==='materials'||r.kind==='shared').reduce((n,r)=>n+r.bytes,0);
    this.limit=this.device.limits.maxTextureDimension2D;
    this.setColors();this.recommendedChunkSize=this.chunkSize();
  }
  // The initializer asks for two whole-world meshes; defer both until a region
  // supplies its bounds. A chunk always uses the same global lattice, even if
  // a lower memory budget changes the output chunk size.
  mesh(resolution) { return {resolution}; }
  timer() { return null; }
  track(resource,label,bytes,kind) {
    if(resource)this.resources.set(resource,{label,bytes,kind});
    this.recordMemory();return resource;
  }
  release(resource) { if(!resource)return;resource.destroy();this.resources.delete(resource); }
  get residentBytes() { let n=this.outputBytes;for(const r of this.resources.values())n+=r.bytes;return n; }
  get cpuRetainedBytes() { return (this.uniformData?.byteLength??0)+(this.height?.byteLength??0)+(this.maskBytes?.byteLength??0); }
  recordMemory() {
    this.peakBytes=Math.max(this.peakBytes,this.residentBytes);
    this.peakBudgetedBytes=Math.max(this.peakBudgetedBytes,this.residentBytes+this.reservedBytes);
    this.peakCPUBytes=Math.max(this.peakCPUBytes,this.cpuRetainedBytes+this.cpuWorkingBytes);
  }
  get busy() { return this._busy; }
  stats() {
    const byKind={};for(const r of this.resources.values())byKind[r.kind]=(byKind[r.kind]??0)+r.bytes;
    return {residentBytes:this.residentBytes,peakBytes:this.peakBytes,budgetBytes:this.budgetBytes,outputBytes:this.outputBytes,
      retainedBytes:this.fixedBytes,workingBytes:(byKind.working??0)+(byKind.mesh??0)+this.outputBytes,
      reservedBytes:this.reservedBytes,budgetedBytes:this.residentBytes+this.reservedBytes,peakBudgetedBytes:this.peakBudgetedBytes,
      cpuRetainedBytes:this.cpuRetainedBytes,cpuWorkingBytes:this.cpuWorkingBytes,cpuUploadBytes:this.cpuUploadBytes??0,cpuPeakBytes:this.peakCPUBytes,
      textureBytes:this.outputBytes+[...this.resources].filter(([r])=>'format' in r).reduce((n,[,v])=>n+v.bytes,0),
      bufferBytes:[...this.resources].filter(([r])=>!('format' in r)).reduce((n,[,v])=>n+v.bytes,0),
      resources:this.resources.size,byKind,busy:this.busy,evictions:this.evictions,recommendedChunkSize:this.recommendedChunkSize,
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
  // The shaders bound all neighbourhoods. Bake relief noise and fractures are
  // functions of the queried point, not walks through adjacent baked pixels.
  // Only height/mask/weather support extends the bake's field input apron.
  reaches(quality='full',heightBounds=this.config.heightBounds??[-90,300]) {
    const n=(k,f)=>this.number(k,f),full=quality==='full';
    // H1: the close shadow march (6 px) and the cavity ring (3 px) plus the gradient's 1.4 sit inside the far taps' reach.
    const shadow=(full?12:5)**2*1.4+2,draw=Math.max(shadow,36,19,11,3,1.4,n('closeShadow',0)>0?6+1.4:0,n('cavity',0)>0?3+1.4:0);
    const boulder=n('boulderSize',9)*1.6*1.8+14+5;
    const debris=Math.max(3,n('debrisSize',6)*.9)*1.85+n('debrisReach',48)+18;
    const beach=Math.max(this.config.textures.beach?(this.config.material?.beachWidth??120)*n('beachWidth',.6):0,n('apron',0))*1.35*1.15;
    // G2: the rock frame reads heights on rings of cliffReach and cliffWide px, and the joints take the frame at their
    // patch's seed, up to 1.41 patches (cliffDomain) from the pixel (the nearest seed of a jittered lattice is within 1.13
    // cells, and the warp moves the pixel by up to .28): cliffFollow only.
    const cliff=n('cliffFollow',0)>0?1.45*Math.max(n('cliffDomain',90),24)+Math.max(n('cliffWide',56),n('cliffReach',20)*1.5,4)+2:0;
    const bake=Math.max(19,boulder,debris,beach,cliff);
    // G3: the fringe's copies read the material field up to ringShift px from the pixel, and a few px more for each copy's gradient.
    const direct=Math.max(61,48*Math.max(.65,1.6*n('ringSpread',.65)),Math.abs(n('waterSoft',32)),41*Math.abs(n('ringVariation',.7)/.75),n('ringShift',0)>0?Math.abs(n('ringShift',0))+4:0);
    // A projection apron includes appearance displacement too. These are
    // bounds from the actual terms: cosine/value noise <=1, the crack search
    // visits at most +/-4 cells (point delta <4.9 cells per axis), and signed
    // style masks can multiply relief by four. This keeps a tall painted face
    // from disappearing merely because it started south of the output chunk.
    const span=heightBounds[1]-heightBounds[0],slope=span*Math.SQRT2/10;
    const relief=Math.abs(n('reliefAmount',.5)*n('reliefScale',28))*Math.max(2.5,.25*n('gentleRelief',.6))*Math.max(1,Math.abs(n('gentleRelief',.6)))*Math.max(1,1+.65*n('reliefPatchy',1))*4;
    const severity=Math.max(n('crackSeverity',.6),.6),major=n('crackSpacing',40),minor=major/3.2;
    const blocks=(.5*(1+3*severity)+1.225*major+.5*(.6+1.6*severity)+4.41*minor)*Math.max(n('crackBlocks',.6),.6);
    const beds=(Math.abs(n('bedSpacing',12))*Math.max(1,(slope+Math.abs(n('bedDip',0)))**(1-n('bedHeight',0)))*1.8*Math.abs(n('bedLedge',.5))+1.8*Math.abs(n('bedLip',1)))*Math.abs(n('rockOrder',0));
    const bands=Math.abs(n('bandSpacing',3.7))*Math.max(Math.abs(n('banding',0))*4,.8);
    const lumps=1.6*(Math.abs(n('plainRelief',1.2))+Math.abs(n('lumpRelief',4))+Math.abs(n('bedRelief',0)));
    const gullyRise=Math.abs(n('ribTilt',0))*Math.max(n('gullySpacing',8),8),F=Math.max(n('facetSize',2),2),coarse=Math.max(n('facetCoarse',0),0);
    const facetRise=1.85*F*Math.abs(n('facetTilt',0))*(Math.max(n('facetStretch',.25),.25)+Math.abs(n('facetSkew',1)))*(1+2.4*coarse)+.5*Math.abs(n('facetStep',0))*(1+coarse);
    const extra=gullyRise+facetRise+relief+blocks+beds+bands+lumps+7.84*Math.abs(n('worms',0))+Math.abs(n('boulderSize',9))+Math.abs(n('debrisSize',6))*.35+Math.abs(n('rippleHeight',1.4));
    const maxVisible=Math.max(this.config.seaLevel,heightBounds[1]+2.85+Math.abs(this.config.material?.surfaceRelief??1)*extra+4);
    return {draw,bake,direct,projection:[(this.config.seaLevel-this.config.baseHeight)/2,(maxVisible-this.config.baseHeight)/2]};
  }
  requiredRegion(request,options={}) {
    const size=request.worldSize??this.size,grid=request.worldGrid??this.grid,spacing=(size-1)/(grid-1);
    if(!(size>1&&grid>1))throw new Error('nanolathe: invalid chunk world lattice');
    const {x,y,width,height}=request;
    if(![x,y,width,height].every(Number.isInteger)||width<1||height<1)throw new Error('nanolathe: chunk bounds must be integer pixels');
    const shift=request.exportArt?Math.floor(this.config.baseHeight/2):0;
    const reach=this.reaches(options.quality??'full',request.heightBounds);
    const resolution=options.quality==='preview'?Math.ceil((size-1)/(1023/192)):Math.ceil((size-1)/(1023/512));
    const step=(size-1)/resolution;
    const col0=clamp(Math.floor(x/step)-1,0,resolution),col1=clamp(Math.ceil((x+width)/step)+1,0,resolution);
    const row0=clamp(Math.floor((y+shift+reach.projection[0])/step)-1,0,resolution),row1=clamp(Math.ceil((y+shift+height+reach.projection[1])/step)+1,0,resolution);
    const fieldsX=clamp(Math.floor(col0*step-reach.draw)-1,0,size-1),fieldsY=clamp(Math.floor(row0*step-reach.draw)-1,0,size-1);
    const fieldsEndX=clamp(Math.ceil(col1*step+reach.draw)+1,0,size-1),fieldsEndY=clamp(Math.ceil(row1*step+reach.draw)+1,0,size-1);
    const input=Math.max(reach.bake,reach.direct-reach.draw,5);
    // One extra grid sample covers linear filtering, including weatherAt's
    // deliberately corner-based (rather than texel-centred) UVs.
    const gx0=clamp(Math.floor((fieldsX-input)/spacing)-1,0,grid-1),gy0=clamp(Math.floor((fieldsY-input)/spacing)-1,0,grid-1);
    const gx1=clamp(Math.ceil((fieldsEndX+input)/spacing)+1,0,grid-1),gy1=clamp(Math.ceil((fieldsEndY+input)/spacing)+1,0,grid-1);
    return {x:gx0*spacing,y:gy0*spacing,width:(gx1-gx0)*spacing,height:(gy1-gy0)*spacing,
      gridOrigin:[gx0*spacing,gy0*spacing],gridWidth:gx1-gx0+1,gridHeight:gy1-gy0+1,gridSpacing:spacing,worldSize:size,worldGrid:grid,
      fieldsX,fieldsY,fieldsWidth:fieldsEndX-fieldsX+1,fieldsHeight:fieldsEndY-fieldsY+1,
      screenOrigin:[x,y+shift],mesh:{col0,col1,row0,row1,resolution},reach};
  }
  estimate(region,width,height,maskPlaneCount=this.maskPlaneCount) {
    const field=pow2(region.fieldsWidth)*pow2(region.fieldsHeight)*8;
    const maskLayers=Math.max(1,Math.ceil(maskPlaneCount/4)),input=pow2(region.gridWidth)*pow2(region.gridHeight)*(16+maskLayers*4);
    const m=region.mesh,cols=m.col1-m.col0,rows=m.row1-m.row0;
    const mesh=(cols+1)*(rows+1)*8+Math.max(4,cols*rows*24),output=width*height*12;
    return {field,input,mesh,output,maskPlaneCount,maskLayers,workingBytes:field+input+mesh+output,
      retainedBytes:this.fixedBytes,reservedBytes:this.reservedBytes,gpuBytes:this.fixedBytes+this.reservedBytes+field+input+mesh+output,
      cpuRetainedBytes:this.cpuRetainedBytes,cpuUploadBytes:Math.max(input,mesh),cpuPeakBytes:this.cpuRetainedBytes+Math.max(input,mesh)};
  }
  chunkSize(maximum=this.config.chunkSize??512,options={}) {
    let size=Math.floor(maximum/32)*32;
    while(size>=32) {
      const region=this.requiredRegion({x:Math.floor(this.size/2),y:Math.floor(this.size/2),width:size,height:size},options),e=this.estimate(region,size,size);
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
  allocate(region,gridWidth,gridHeight,width,height) {
    this.evict();
    const fw=pow2(region.fieldsWidth),fh=pow2(region.fieldsHeight),gw=pow2(gridWidth),gh=pow2(gridHeight);
    const e=this.estimate({...region,gridWidth,gridHeight},width,height),required=e.gpuBytes;
    if(Math.max(fw,fh,gw,gh,width,height)>this.limit||required>this.budgetBytes)
      throw new Error(`nanolathe: chunk needs ${Math.ceil(required/MB)} MB of GPU memory; use chunks of ${this.chunkSize()} px or smaller`);
    const T=GPUTextureUsage,read=T.TEXTURE_BINDING|T.COPY_DST;
    this.heightTexture=this.texture('chunk height',gw,gh,1,'r32float',4,read);
    this.routeTexture=this.texture('chunk routes',gw,gh,1,'rgba8unorm',4,read);
    this.gridTexture=this.texture('chunk weather and material',gw,gh,2,'rgba8unorm',4,read);
    if(this.maskLayers>this.device.limits.maxTextureArrayLayers)throw new Error('nanolathe: mask planes exceed the device texture array limit');
    this.maskTexture=this.texture('chunk masks',gw,gh,this.maskLayers,'rgba8snorm',4,read);
    this.fieldsTexture=this.texture('chunk fields',fw,fh,1,'rgba16float',8,T.STORAGE_BINDING|T.TEXTURE_BINDING);
    this.fieldsOut=this.device.createBindGroup({label:'chunk fields out',layout:this.bakePipeline.getBindGroupLayout(1),entries:[{binding:0,resource:this.fieldsTexture.createView()}]});
    this.canvas.width=width;this.canvas.height=height;this.outputBytes=width*height*8;
    this.outputCanvas??=new OffscreenCanvas(width,height);this.outputCanvas.width=width;this.outputCanvas.height=height;
    this.bakeWidth=fw;this.bakeHeight=fh;
    const rasterSize=Math.min(this.size,this.limit),span=rasterSize/2;
    const rasterOrigin=this.size<=this.limit?[0,0]:region.screenOrigin.map(v=>Math.floor(v/span)*span);
    this.f('uChunkRasterOrigin',rasterOrigin);this.f('uChunkRasterSize',rasterSize);
    this.chunkViewport=[rasterOrigin[0]-region.screenOrigin[0],rasterOrigin[1]-region.screenOrigin[1],rasterSize,rasterSize];
    this.depthTexture=this.texture('chunk depth',width,height,1,'depth32float',4,T.RENDER_ATTACHMENT);this.depthView=this.depthTexture.createView();
    this.f('uChunkFieldsOrigin',[region.fieldsX,region.fieldsY]);this.f('uChunkFieldsSize',[fw,fh]);
    this.f('uChunkGridSize',[gw,gh]);this.f('uChunkGridCount',[gridWidth,gridHeight]);
    this.f('uChunkScreenOrigin',region.screenOrigin);this.f('uChunkScreenSize',[width,height]);
    this.meshes=[this.regionMesh(region.mesh),null];this.meshes[1]=this.meshes[0];
    this.bindGroups={};this.fieldsDirty=true;
    this.recordMemory();return {gw,gh,fw,fh};
  }
  regionMesh({col0,col1,row0,row1,resolution}) {
    const cols=col1-col0,rows=row1-row0,points=new Float32Array((cols+1)*(rows+1)*2),indices=new Uint32Array(cols*rows*6);
    let at=0;for(let y=row0;y<=row1;y++)for(let x=col0;x<=col1;x++){points[at++]=x/resolution;points[at++]=y/resolution;}
    at=0;for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){const a=y*(cols+1)+x,b=a+cols+1;indices.set([a,b,a+1,a+1,b,b+1],at);at+=6;}
    this.cpuWorkingBytes=points.byteLength+indices.byteLength;this.cpuUploadBytes=this.cpuWorkingBytes;this.recordMemory();
    const buffer=(data,usage)=>{if(data.byteLength>this.device.limits.maxBufferSize)throw new Error('nanolathe: chunk mesh exceeds the device buffer limit');const b=this.track(this.device.createBuffer({label:'chunk mesh',size:Math.max(4,data.byteLength),usage:usage|GPUBufferUsage.COPY_DST}),'chunk mesh',Math.max(4,data.byteLength),'mesh');if(data.byteLength)this.device.queue.writeBuffer(b,0,data);return b;};
    const mesh={vertices:buffer(points,GPUBufferUsage.VERTEX),indices:buffer(indices,GPUBufferUsage.INDEX),count:indices.length};
    this.cpuWorkingBytes=0;return mesh;
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
    const pixels=gw*gh,height=new Float32Array(pixels),routes=new Uint8Array(pixels*4),grid=new Uint8Array(pixels*8),masks=new Int8Array(pixels*this.maskLayers*4);
    const painted=new Array(planes.length).fill(0),toByte=v=>Math.round(clamp(v??0,0,1)*255);
    this.uploadBytes=height.byteLength+routes.byteLength+grid.byteLength+masks.byteLength;
    this.cpuWorkingBytes=this.uploadBytes;this.cpuUploadBytes=Math.max(this.cpuUploadBytes,this.uploadBytes);this.recordMemory();
    const weather=request.weather??fields.weather,material=request.material??fields.material;
    for(let y=0;y<gh;y++)for(let x=0;x<gw;x++) {
      const src=Math.min(y,h-1)*w+Math.min(x,w-1),dst=y*gw+x;
      height[dst]=(request.exportArt?clamp(fields.h[src],0,255):fields.h[src])-this.config.seaLevel;
      routes[dst*4]=toByte(fields.r?.[src]);routes[dst*4+1]=toByte(fields.c?.[src]);routes[dst*4+2]=Math.round((clamp(fields.v?.[src]??0,-1,1)*.5+.5)*255);routes[dst*4+3]=toByte(fields.x?.[src]);
      for(let k=0;k<planes.length;k++){const v=planes[k]?.[src]??0;masks[(k>>2)*pixels*4+dst*4+(k&3)]=v;painted[k]||=v!==0?1:0;}
      for(let k=0;k<4;k++){grid[dst*4+k]=toByte(Array.isArray(weather)?weather[k]?.[src]:weather?.[['flow','deposit','talus','sand'][k]]?.[src]);grid[pixels*4+dst*4+k]=toByte(material?.[src*4+k]);}
    }
    const q=this.device.queue;q.writeTexture({texture:this.heightTexture},height,{bytesPerRow:gw*4},[gw,gh]);q.writeTexture({texture:this.routeTexture},routes,{bytesPerRow:gw*4},[gw,gh]);
    q.writeTexture({texture:this.gridTexture},grid,{bytesPerRow:gw*4,rowsPerImage:gh},[gw,gh,2]);q.writeTexture({texture:this.maskTexture},masks,{bytesPerRow:gw*4,rowsPerImage:gh},[gw,gh,this.maskLayers]);
    const flags={paintOn:painted.slice(0,9).some(Boolean),scatterOn:painted[4],styleOn:painted.slice(5,9).some(Boolean),waterOn:painted.slice(9,12).some(Boolean)||painted[13],lumpOn:painted[12],flowOn:painted.slice(20,25).some(Boolean),...request.maskFlags};
    for(const k of ['paintOn','scatterOn','styleOn','waterOn','lumpOn','flowOn'])this.i('u'+k[0].toUpperCase()+k.slice(1),flags[k]??0);
    this.materialReady=Boolean(material);this.cpuWorkingBytes=0;
  }
  // A reusable canvas is returned. Copy it before the next renderChunk; the
  // caller must count its retained bitmap/canvas bytes separately from stats.
  async renderChunk(request,options={}) {
    if(this.disposed)throw new Error('nanolathe: chunk renderer is disposed');
    if(this.busy)throw new Error('nanolathe: chunk renderer is already rendering');
    this._busy=true;
    try {
      this.size=request.worldSize??this.size;this.grid=request.worldGrid??this.grid;
      const region=this.requiredRegion(request,options),w=request.gridWidth??region.gridWidth,h=request.gridHeight??w;
      request={...request,gridWidth:w,gridHeight:h,gridOrigin:request.gridOrigin??region.gridOrigin};
      const planes=this.maskPlanes(request);this.maskPlaneCount=planes.length;this.maskLayers=Math.max(1,Math.ceil(planes.length/4));
      this.recommendedChunkSize=this.chunkSize();
      const dimensions=this.allocate(region,w,h,request.width,request.height);this.upload(request,region,dimensions,planes);
      this.activeRegion=region;
      if(options.sedimentColors!==undefined)this.setSediment(options.sedimentColors);
      const result=super.draw({...options,quality:options.quality??'full',exact:options.exact||Boolean(request.exportArt)});
      // A WebGPU presentation image expires at the next browser frame. Copy
      // synchronously before waiting for the queue, so the returned pixels live.
      this.outputCanvas.getContext('2d').drawImage(this.canvas,0,0);
      await this.device.queue.onSubmittedWorkDone();
      return {...result,canvas:this.outputCanvas,x:request.x,y:request.y,width:request.width,height:request.height,exportArt:Boolean(request.exportArt),outputBytes:request.width*request.height*4,region,stats:{...this.stats(),busy:false}};
    } finally { this._busy=false;this.cpuWorkingBytes=0; }
  }
  evict() {
    for(const [resource,entry] of [...this.resources])if(entry.kind==='working'||entry.kind==='mesh')this.release(resource);
    for(const key of ['heightTexture','routeTexture','gridTexture','maskTexture','fieldsTexture','depthTexture'])this[key]=null;
    this.bindGroups={};this.meshes=[];this.canvas.width=1;this.canvas.height=1;if(this.outputCanvas){this.outputCanvas.width=1;this.outputCanvas.height=1;}this.outputBytes=8;this.evictions++;
  }
  dispose() {
    if(this.disposed)return;this.disposed=true;for(const resource of [...this.resources.keys()])this.release(resource);
    this.context?.unconfigure();this.device?.destroy();if(this.outputCanvas){this.outputCanvas.width=0;this.outputCanvas.height=0;}
    this.outputBytes=0;this.fixedBytes=0;this.cpuWorkingBytes=0;this.uniformData=null;this.uniformView=null;this.height=null;this.maskBytes=null;
  }
}
