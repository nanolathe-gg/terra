import {terrainAllocation} from './sculpt-memory.js';
// A bounded, transient voxel solid for the editor's existing chunk stream.
// Only allocation counts return to JS; shape, rock, wear, and rendering stay on GPU.
const STORAGE=()=>GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST;
const ENTRIES={
  voxelPrepare:[[0],[0]],
  voxelGuideBlocks:[[0,3],[6]],
  voxelGuideBuild:[[0,3,6],[1]],
  voxelClassify:[[0,4],[2,3,4]],
  voxelBuild:[[0,1,3,4,5,7],[5]],
  voxelWeather:[[0,1,2,3,4,5,7],[5]],
};
export class VoxelSurface {
  static async create(renderer,source,preprocess){
    const self=new VoxelSurface(renderer);const d=renderer.device;
    const code=preprocess('/*COMMON*/\n'+source,renderer.commonSource,new Set(['VOLUME_COMPUTE']));
    renderer.stageSources?.push({source:code,stage:'D'});
    const module=d.createShaderModule({label:'voxel solid',code});
    const errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');
    if(errors.length)throw Error(errors.map(m=>`${m.lineNum}: ${m.message}`).join('\n'));
    const input=b=>b===0?{binding:b,visibility:GPUShaderStage.COMPUTE|GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}}:[3,4,6].includes(b)?{binding:b,visibility:GPUShaderStage.COMPUTE|GPUShaderStage.FRAGMENT,texture:{sampleType:'unfilterable-float'}}:{binding:b,visibility:GPUShaderStage.COMPUTE|GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage'}};
    const output=b=>b<2||b===6?{binding:b,visibility:GPUShaderStage.COMPUTE,storageTexture:{access:'write-only',format:'rgba32float'}}:{binding:b,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}};
    const empty=d.createBindGroupLayout({entries:[]});self.module=module;self.layouts={};self.built=new Map();
    for(const [entryPoint,[reads,writes]]of Object.entries(ENTRIES)){
      const a=d.createBindGroupLayout({entries:reads.map(input)}),b=d.createBindGroupLayout({entries:writes.map(output)});
      self.layouts[entryPoint]={layout:d.createPipelineLayout({bindGroupLayouts:[renderer.commonLayout,empty,a,b]}),reads,writes,a,b};
    }
    await Promise.all([self.build(0),self.build(15)]);
    self.drawLayout=d.createBindGroupLayout({entries:[0,1,2,3,4,7].map(input)});
    self.uniform=d.createBuffer({label:'voxel region settings',size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    self.readback=d.createBuffer({label:'voxel allocation count readback',size:16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    renderer.track(self.uniform,'voxel settings',64,'shared');renderer.track(self.readback,'voxel count readback',16,'shared');
    return self;
  }
  constructor(renderer){this.renderer=renderer;this.device=renderer.device;this.owned=[];this.previewCounts=new Map();this.predictionStats={predicted:0,seeds:0,overflows:0,budgetFallbacks:0,preDrawWaitMs:0,postDrawWaitMs:0};this.stats={pieces:0,bricks:0,peakBytes:0,allocationMs:0};}
  // Both allowed rock masks are ready at startup: fixed slot 0, and the recipe table.
  build(mask){
    if(!this.built.has(mask))this.built.set(mask,Promise.all(Object.entries(this.layouts).map(async([entryPoint,l])=>[entryPoint,{...l,pipeline:await this.device.createComputePipelineAsync({label:entryPoint,layout:l.layout,compute:{module:this.module,entryPoint,constants:{rockMask:mask}}})}]))
      .then(list=>{this.passesBy??={};this.passesBy[mask]=Object.fromEntries(list);}));
    return this.built.get(mask);
  }
  // A finished piece's buffers and textures stay as a one-set pool for the next piece instead of being destroyed: view tiles share a size, and
  // creating then freeing ~30 MB a tile (Chrome zero-fills each new resource) kept its GPU process busy while the GPU waited. Every pass writes
  // what it later reads (the brick counter is reset below), so a reused resource draws the same picture. The pool stays tracked against the
  // budget, holds one set at most, and goes whenever the renderer is past 80% of its budget, needs room or evicts (dropPool(), release()).
  clear(){
    // Several callers clear in a row before one piece allocates; only a piece that owned something replaces the pool.
    if(this.owned.length){this.dropPool();this.pool=this.owned;this.owned=[];}
    this.density=null;
    const r=this.renderer;if(r.residentBytes+r.reservedBytes>.8*r.budgetBytes)this.dropPool();
  }
  dropPool(){for(const x of this.pool??[])this.renderer.release(x);this.pool=[];}
  release(){this.clear();this.dropPool();}
  take(match){const i=(this.pool??[]).findIndex(match);if(i<0)return null;const [x]=this.pool.splice(i,1);this.owned.push(x);return x;}
  own(resource,label,bytes){this.owned.push(resource);this.renderer.track(resource,label,bytes,'working');return resource;}
  buffer(label,size,usage=STORAGE()){
    size=Math.max(16,size);
    // A larger kept buffer serves (no voxel pass reads a buffer's length), up to twice the size asked for.
    return this.take(b=>b instanceof GPUBuffer&&b.label===label&&b.usage===usage&&b.size>=size&&b.size<=2*size)??this.own(this.device.createBuffer({label,size,usage}),label,size);
  }
  texture(label,width,height){
    // Exactly the size asked for: voxelGuideBlocks reads its texture's dimensions.
    return this.take(t=>t instanceof GPUTexture&&t.label===label&&t.width===width&&t.height===height)??this.own(this.device.createTexture({label,size:[width,height],format:'rgba32float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING}),label,width*height*16);
  }
  settings(s,capacity=s.capacity){
    const data=new ArrayBuffer(64),f=new Float32Array(data),u=new Uint32Array(data);
    f.set([...s.origin,s.step],0);u.set([s.columnsX,s.columnsY,s.width,s.height,capacity],3);f.set([s.low,s.high,s.screenLow,s.screenHigh,s.top],8);
    this.device.queue.writeBuffer(this.uniform,0,data);
  }
  inputs(){return {0:{buffer:this.uniform},1:{buffer:this.columns},2:{buffer:this.density[0]},3:this.height.createView(),4:this.guide.createView(),5:{buffer:this.bricks},7:{buffer:this.counter}};}
  encode(name,encoder,groups,reads,writes){
    const p=this.passes[name];   // render() picks the rockMask's passes
    const group=(layout,bindings,resources)=>this.device.createBindGroup({layout,entries:bindings.map(binding=>({binding,resource:resources[binding]}))});
    const pass=encoder.beginComputePass({label:name});pass.setPipeline(p.pipeline);pass.setBindGroup(0,this.renderer.commonBindGroup('draw'));
    pass.setBindGroup(2,group(p.a,p.reads,reads));pass.setBindGroup(3,group(p.b,p.writes,writes));pass.dispatchWorkgroups(...groups);pass.end();
  }
  bounds(rect,step,low,high,top){
    const r=this.renderer,base=r.config.baseHeight-r.config.seaLevel,unit=8*step,halo=72+6*step;
    const x0=Math.floor((rect.x-halo)/unit)*unit,x1=Math.ceil((rect.x+rect.width+halo)/unit)*unit;
    const y0=Math.floor((rect.y+(low-40-base)*.5-halo)/unit)*unit,y1=Math.ceil((rect.y+rect.height+(Math.max(high+40,top)-base)*.5+halo)/unit)*unit;
    const width=Math.round((x1-x0)/step),height=Math.round((y1-y0)/step),columnsX=width/8,columnsY=height/8;
    const apron=Math.max(40,6*step);
    const capacity=columnsX*columnsY*(Math.ceil((high+apron)/unit)-Math.floor((low-apron)/unit)+1);
    return {origin:[x0,y0],step,width,height,columnsX,columnsY,capacity,low,high,top,screenLow:rect.y,screenHigh:rect.y+rect.height};
  }
  async render(draw){
    this.passes=this.renderer.rockPasses(this.passesBy);   // this rockMask's passes, or a specialization miss that builds them
    const r=this.renderer,region=r.activeRegion,scale=r.uniformView.getFloat32(r.layout.fields.get('chunkScale').offset,true);
    const origin=region.screenOrigin,width=r.canvas.width*scale,height=r.canvas.height*scale;
    const step=2**Math.max(0,Math.floor(Math.log2(r.voxelScale)));
    const h=r.config.heightBounds??[-90,300],extra=Math.max(64,region.reach.projection[1]*2+r.config.baseHeight-h[1]);
    const low=h[0]-extra-r.config.seaLevel,high=h[1]+extra-r.config.seaLevel;
    // The rays start from one height, the authored maximum with 64 units for the relief and the 40 the bricks reach above it: not from the
    // relief allowance's (high), which every relief term moves. The march can step past thin rock, so a ray from another start finds
    // another face, and a term that only moved the allowance re-rolled a tenth of a picture's steep faces (green-2 10%, Bed lumps .6 to 2).
    const top=h[1]+104;
    this.stats.pieces=this.stats.bricks=this.stats.peakBytes=0;const start=performance.now();
    let first=true;
    const piece=async rect=>{
      this.clear();
      const s=this.bounds(rect,step,low,high,top),n=s.columnsX*s.columnsY;
      let available=r.budgetBytes-r.reservedBytes-r.residentBytes;
      // The guide's blocks are 4 px on a side (engine-volume.wgsl voxelGuideBlocks).
      const blockCells=Math.max(1,Math.round(4/step)),blocksX=Math.ceil(s.width/blockCells),blocksY=Math.ceil(s.height/blockCells);
      const metadata=s.width*s.height*32+blocksX*blocksY*16+n*16+s.capacity*16+16;
      const split=async()=>{
        this.clear();if(Math.min(rect.width,rect.height)<=8*scale&&Math.max(rect.width,rect.height)<=8*scale)throw Error('The voxel surface exceeds the terrain memory budget: '+JSON.stringify({rect,s,available,metadata,resident:r.residentBytes,reserved:r.reservedBytes}));
        const horizontal=rect.width>=rect.height,key=horizontal?'width':'height',axis=horizontal?'x':'y';
        const a=Math.max(scale,Math.floor(rect[key]/scale/2)*scale);
        await piece({...rect,[key]:a});await piece({...rect,[axis]:rect[axis]+a,[key]:rect[key]-a});
      };
      if(metadata>available*.6){r.makeWorkingRoom(Math.ceil(metadata/.6));available=r.budgetBytes-r.reservedBytes-r.residentBytes;}
      if(metadata>available*.6||s.capacity*16>this.device.limits.maxStorageBufferBindingSize){await split();return;}
      await terrainAllocation(this.device,()=>{
      this.height=this.texture('voxel authored surface',s.width,s.height);this.guide=this.texture('voxel cliff guides',s.width,s.height);this.blocks=this.texture('voxel guide blocks',blocksX,blocksY);
      this.columns=this.buffer('voxel column ranges',n*16);this.bricks=this.buffer('voxel brick positions',s.capacity*16);
      this.counter=this.buffer('voxel brick count',16,STORAGE()|GPUBufferUsage.COPY_SRC);
      });
      this.device.queue.writeBuffer(this.counter,0,new Uint32Array(4));this.settings(s);
      const input={0:{buffer:this.uniform},3:this.height.createView(),4:this.guide.createView(),6:this.blocks.createView()};
      const output={0:this.height.createView(),1:this.guide.createView(),2:{buffer:this.columns},3:{buffer:this.bricks},4:{buffer:this.counter},6:this.blocks.createView()};
      const countEncoder=this.device.createCommandEncoder({label:'voxel surface allocation'});
      this.encode('voxelPrepare',countEncoder,[Math.ceil(s.width/8),Math.ceil(s.height/8)],input,output);
      this.encode('voxelGuideBlocks',countEncoder,[Math.ceil(blocksX/8),Math.ceil(blocksY/8)],input,output);
      this.encode('voxelGuideBuild',countEncoder,[Math.ceil(s.width/8),Math.ceil(s.height/8)],input,output);
      this.encode('voxelClassify',countEncoder,[Math.ceil(s.columnsX/8),Math.ceil(s.columnsY/8)],input,output);
      countEncoder.copyBufferToBuffer(this.counter,0,this.readback,0,16);this.device.queue.submit([countEncoder.finish()]);
      // Start the small count read now. A warmed preview can allocate and
      // submit its solid/draw without waiting for the CPU to receive it.
      const pending=this.readback.mapAsync(GPUMapMode.READ).then(()=>{const values=new Uint32Array(this.readback.getMappedRange().slice(0));this.readback.unmap();return values;});
      pending.catch(()=>{}); // allocation failure may unwind before validation
      try{
      const preview=r.voxelScale>1,key=[step,s.columnsX,s.columnsY].join(','),last=this.previewCounts.get(key),ps=this.predictionStats;
      let counts=null,capacity=preview&&last!==undefined?Math.min(s.capacity,Math.ceil(last*1.5)):null;
      const readCounts=async afterDraw=>{const t=preview?performance.now():0,values=await pending;
        if(preview)ps[afterDraw?'postDrawWaitMs':'preDrawWaitMs']+=performance.now()-t;
        if(values[1])throw Error('Terrain extends beyond the voxel projection bounds.');
        if(values[0]>s.capacity)throw Error('The voxel brick count exceeds its conservative allocation bound.');
        if(preview){this.previewCounts.delete(key);this.previewCounts.set(key,values[0]);if(this.previewCounts.size>16)this.previewCounts.delete(this.previewCounts.keys().next().value);}
        return values;
      };
      const fits=count=>count*1024<=this.device.limits.maxStorageBufferBindingSize&&r.makeWorkingRoom(Math.max(16,count*1024)*2);
      if(capacity===null||!fits(capacity)){
        if(preview){if(capacity===null)ps.seeds++;else ps.budgetFallbacks++;}
        counts=await readCounts(false);capacity=counts[0];
      }else ps.predicted++;
      const drawPool=async count=>{
        if(this.density){for(const b of this.density){r.release(b);this.owned=this.owned.filter(v=>v!==b);}this.density=null;}
        if(!fits(count))return false;
        const densityBytes=count*1024;
        await terrainAllocation(this.device,()=>{this.density=[this.buffer('voxel solid A',densityBytes),this.buffer('voxel solid B',densityBytes)];});this.settings(s,count);
        const reads=this.inputs(),encoder=this.device.createCommandEncoder({label:'voxel solid and terrain draw'}),groups=[Math.min(count,128),Math.ceil(count/128)];
        this.encode('voxelBuild',encoder,groups,reads,{5:{buffer:this.density[0]}});
        // The same four wear rounds and solid, with excess dispatches rejected
        // by the GPU's actual count rather than evaluating unused bricks.
        const wear=r.rockSlots().some(k=>r.rockValue(k,'faceWear')>0&&r.rockValue(k,'rockFace')>0)?4:0;
        for(let i=0;i<wear;i++)this.encode('voxelWeather',encoder,groups,{...reads,2:{buffer:this.density[i%2]}},{5:{buffer:this.density[1-i%2]}});
        const bind=this.device.createBindGroup({layout:this.drawLayout,entries:[0,1,2,3,4,7].map(binding=>({binding,resource:reads[binding]}))});
        draw(encoder,bind,[(rect.x-origin[0])/scale,(rect.y-origin[1])/scale,rect.width/scale,rect.height/scale],first);
        this.device.queue.submit([encoder.finish()]);
        this.stats.peakBytes=Math.max(this.stats.peakBytes,metadata+Math.max(16,densityBytes)*2);return true;
      };
      if(!await drawPool(capacity)){await split();return;}
      if(!counts){
        counts=await readCounts(true);
        if(counts[0]>capacity){
          ps.overflows++;
          // Drain the rejected pool before replacing its memory. No
          // presentation has been submitted; earlier validated pieces survive.
          await this.device.queue.onSubmittedWorkDone();
          if(!await drawPool(counts[0])){await split();return;}
        }
      }
      first=false;this.stats.pieces++;this.stats.bricks+=counts[0];
      }finally{await pending.catch(()=>{});}
    };
    await piece({x:origin[0],y:origin[1],width,height});this.stats.allocationMs=performance.now()-start;
  }
  destroy(){this.release();this.uniform.destroy();this.readback.destroy();}
}
