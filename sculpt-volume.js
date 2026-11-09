// A bounded, transient voxel solid for the editor's existing chunk stream.
// Only allocation counts return to JS; shape, rock, wear, and rendering stay on GPU.
const STORAGE=()=>GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST;
const ENTRIES={
  voxelPrepare:[[0],[0]],
  voxelGuideBuild:[[0,3],[1]],
  voxelClassify:[[0,4],[2,3,4]],
  voxelBuild:[[0,1,3,4,5],[5]],
  voxelWeather:[[0,1,2,3,4,5],[5]],
};
export class VoxelSurface {
  static async create(renderer,source,preprocess){
    const self=new VoxelSurface(renderer);const d=renderer.device;
    const code=preprocess('/*COMMON*/\n'+source,renderer.commonSource,new Set([...(renderer.chunked?['CHUNK']:[]),'VOLUME_COMPUTE']));
    const module=d.createShaderModule({label:'voxel solid',code});
    const errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');
    if(errors.length)throw Error(errors.map(m=>`${m.lineNum}: ${m.message}`).join('\n'));
    const input=b=>b===0?{binding:b,visibility:GPUShaderStage.COMPUTE|GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}}:[3,4].includes(b)?{binding:b,visibility:GPUShaderStage.COMPUTE|GPUShaderStage.FRAGMENT,texture:{sampleType:'unfilterable-float'}}:{binding:b,visibility:GPUShaderStage.COMPUTE|GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage'}};
    const output=b=>b<2?{binding:b,visibility:GPUShaderStage.COMPUTE,storageTexture:{access:'write-only',format:'rgba32float'}}:{binding:b,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}};
    const empty=d.createBindGroupLayout({entries:[]});self.passes={};
    for(const [entryPoint,[reads,writes]]of Object.entries(ENTRIES)){
      const a=d.createBindGroupLayout({entries:reads.map(input)}),b=d.createBindGroupLayout({entries:writes.map(output)});
      const layout=d.createPipelineLayout({bindGroupLayouts:[renderer.commonLayout,empty,a,b]});
      self.passes[entryPoint]={pipeline:await d.createComputePipelineAsync({label:entryPoint,layout,compute:{module,entryPoint}}),reads,writes,a,b};
    }
    self.drawLayout=d.createBindGroupLayout({entries:[0,1,2,3,4].map(input)});
    self.uniform=d.createBuffer({label:'voxel region settings',size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    self.readback=d.createBuffer({label:'voxel allocation count readback',size:16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    renderer.track?.(self.uniform,'voxel settings',48,'shared');renderer.track?.(self.readback,'voxel count readback',16,'shared');
    return self;
  }
  constructor(renderer){this.renderer=renderer;this.device=renderer.device;this.owned=[];this.stats={pieces:0,bricks:0,peakBytes:0,allocationMs:0};}
  clear(){for(const r of this.owned){if(this.renderer.release)this.renderer.release(r);else r.destroy();}this.owned=[];}
  own(resource,label,bytes){this.owned.push(resource);this.renderer.track?.(resource,label,bytes,'working');return resource;}
  buffer(label,size,usage=STORAGE()){return this.own(this.device.createBuffer({label,size:Math.max(16,size),usage}),label,Math.max(16,size));}
  texture(label,width,height){return this.own(this.device.createTexture({label,size:[width,height],format:'rgba32float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING}),label,width*height*16);}
  settings(s,capacity=s.capacity){
    const data=new ArrayBuffer(48),f=new Float32Array(data),u=new Uint32Array(data);
    f.set([...s.origin,s.step],0);u.set([s.columnsX,s.columnsY,s.width,s.height,capacity],3);f.set([s.low,s.high,s.screenLow,s.screenHigh],8);
    this.device.queue.writeBuffer(this.uniform,0,data);
  }
  inputs(){return {0:{buffer:this.uniform},1:{buffer:this.columns},2:{buffer:this.density[0]},3:this.height.createView(),4:this.guide.createView(),5:{buffer:this.bricks}};}
  encode(name,encoder,groups,reads,writes){
    const p=this.passes[name];
    const group=(layout,bindings,resources)=>this.device.createBindGroup({layout,entries:bindings.map(binding=>({binding,resource:resources[binding]}))});
    const pass=encoder.beginComputePass({label:name});pass.setPipeline(p.pipeline);pass.setBindGroup(0,this.renderer.commonBindGroup('draw'));
    pass.setBindGroup(2,group(p.a,p.reads,reads));pass.setBindGroup(3,group(p.b,p.writes,writes));pass.dispatchWorkgroups(...groups);pass.end();
  }
  bounds(rect,step,low,high){
    const r=this.renderer,base=r.config.baseHeight-r.config.seaLevel,unit=8*step,halo=72+6*step;
    const x0=Math.floor((rect.x-halo)/unit)*unit,x1=Math.ceil((rect.x+rect.width+halo)/unit)*unit;
    const y0=Math.floor((rect.y+(low-40-base)*.5-halo)/unit)*unit,y1=Math.ceil((rect.y+rect.height+(high+40-base)*.5+halo)/unit)*unit;
    const width=Math.round((x1-x0)/step),height=Math.round((y1-y0)/step),columnsX=width/8,columnsY=height/8;
    const apron=Math.max(40,6*step);
    const capacity=columnsX*columnsY*(Math.ceil((high+apron)/unit)-Math.floor((low-apron)/unit)+1);
    return {origin:[x0,y0],step,width,height,columnsX,columnsY,capacity,low,high,screenLow:rect.y,screenHigh:rect.y+rect.height};
  }
  async render(draw){
    const r=this.renderer,region=r.activeRegion,scale=r.chunked?r.uniformView.getFloat32(r.layout.fields.get('chunkScale').offset,true):1;
    const origin=region?.screenOrigin??[0,0],width=r.canvas.width*scale,height=r.canvas.height*scale;
    const full=r.uniformView.getInt32(r.layout.fields.get('full').offset,true)!==0;
    const step=2**Math.max(full?0:1,Math.floor(Math.log2(r.voxelScale??scale)));
    const h=r.config.heightBounds??[-90,300],extra=Math.max(64,(region?.reach.projection[1]??((h[1]-r.config.baseHeight)/2))*2+r.config.baseHeight-h[1]);
    const low=h[0]-extra-r.config.seaLevel,high=h[1]+extra-r.config.seaLevel;
    this.stats.pieces=this.stats.bricks=this.stats.peakBytes=0;const start=performance.now();
    let first=true;
    const piece=async rect=>{
      this.clear();
      const s=this.bounds(rect,step,low,high),n=s.columnsX*s.columnsY;
      const available=(r.budgetBytes??512*1048576)-(r.reservedBytes??0)-(r.residentBytes??0);
      const metadata=s.width*s.height*32+n*16+s.capacity*16+16;
      const split=async()=>{
        this.clear();if(Math.min(rect.width,rect.height)<=8*scale&&Math.max(rect.width,rect.height)<=8*scale)throw Error('The voxel surface exceeds the terrain memory budget: '+JSON.stringify({rect,s,available,metadata,resident:r.residentBytes,reserved:r.reservedBytes}));
        const horizontal=rect.width>=rect.height,key=horizontal?'width':'height',axis=horizontal?'x':'y';
        const a=Math.max(scale,Math.floor(rect[key]/scale/2)*scale);
        await piece({...rect,[key]:a});await piece({...rect,[axis]:rect[axis]+a,[key]:rect[key]-a});
      };
      if(metadata>available*.6||s.capacity*16>this.device.limits.maxStorageBufferBindingSize){await split();return;}
      this.height=this.texture('voxel authored surface',s.width,s.height);this.guide=this.texture('voxel cliff guides',s.width,s.height);
      this.columns=this.buffer('voxel column ranges',n*16);this.bricks=this.buffer('voxel brick positions',s.capacity*16);
      this.counter=this.buffer('voxel brick count',16,STORAGE()|GPUBufferUsage.COPY_SRC);
      this.device.queue.writeBuffer(this.counter,0,new Uint32Array(4));this.settings(s);
      const input={0:{buffer:this.uniform},3:this.height.createView(),4:this.guide.createView()};
      const output={0:this.height.createView(),1:this.guide.createView(),2:{buffer:this.columns},3:{buffer:this.bricks},4:{buffer:this.counter}};
      const countEncoder=this.device.createCommandEncoder({label:'voxel surface allocation'});
      this.encode('voxelPrepare',countEncoder,[Math.ceil(s.width/8),Math.ceil(s.height/8)],input,output);
      this.encode('voxelGuideBuild',countEncoder,[Math.ceil(s.width/8),Math.ceil(s.height/8)],input,output);
      this.encode('voxelClassify',countEncoder,[Math.ceil(s.columnsX/8),Math.ceil(s.columnsY/8)],input,output);
      countEncoder.copyBufferToBuffer(this.counter,0,this.readback,0,16);this.device.queue.submit([countEncoder.finish()]);
      await this.readback.mapAsync(GPUMapMode.READ);const counts=new Uint32Array(this.readback.getMappedRange().slice(0));this.readback.unmap();
      const count=counts[0],densityBytes=count*1024;
      if(counts[1])throw Error('Terrain extends beyond the voxel projection bounds.');
      if(count>s.capacity)throw Error('The voxel brick count exceeds its conservative allocation bound.');
      if(densityBytes>this.device.limits.maxStorageBufferBindingSize||metadata+densityBytes*2>available){await split();return;}
      this.density=[this.buffer('voxel solid A',densityBytes),this.buffer('voxel solid B',densityBytes)];this.settings(s,count);
      const reads=this.inputs();const encoder=this.device.createCommandEncoder({label:'voxel solid and terrain draw'});
      const groups=[Math.min(count,128),Math.ceil(count/128)];
      this.encode('voxelBuild',encoder,groups,reads,{5:{buffer:this.density[0]}});
      for(let i=0;i<4;i++)this.encode('voxelWeather',encoder,groups,{...reads,2:{buffer:this.density[i%2]}},{5:{buffer:this.density[1-i%2]}});
      const bind=this.device.createBindGroup({layout:this.drawLayout,entries:[0,1,2,3,4].map(binding=>({binding,resource:reads[binding]}))});
      draw(encoder,bind,[(rect.x-origin[0])/scale,(rect.y-origin[1])/scale,rect.width/scale,rect.height/scale],first);first=false;
      this.device.queue.submit([encoder.finish()]);this.stats.pieces++;this.stats.bricks+=count;
      this.stats.peakBytes=Math.max(this.stats.peakBytes,metadata+densityBytes*2);
    };
    await piece({x:origin[0],y:origin[1],width,height});this.stats.allocationMs=performance.now()-start;
  }
  destroy(){this.clear();this.uniform.destroy();this.readback.destroy();}
}
