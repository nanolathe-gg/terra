// Local drainage and rockfall sources on a global 4px lattice. No CPU simulation
// or readback: the bake, voxel solid and material all sample this same field.
const STEP=4, HALO=104, ROUNDS=16;
export function rockWeatherBytes(width,height){return (Math.ceil((width+2*HALO)/STEP)+2)*(Math.ceil((height+2*HALO)/STEP)+2)*96;}
export class RockWeather {
  static async create(renderer,preprocess){
    const self=new RockWeather(renderer),d=renderer.device;
    const source=await (await fetch('engine-rock-weather.wgsl')).text();
    const code=preprocess(source,renderer.commonSource,new Set(['BAKE']));
    const module=d.createShaderModule({label:'rock runoff and deposition',code});
    const errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');
    if(errors.length)throw Error(errors.map(m=>`${m.lineNum}: ${m.message}`).join('\n'));
    self.layout=d.createBindGroupLayout({entries:[0,1].map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:'unfilterable-float'}})).concat([{binding:2,visibility:GPUShaderStage.COMPUTE,storageTexture:{access:'write-only',format:'rgba32float'}},{binding:3,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:'unfilterable-float'}},{binding:4,visibility:GPUShaderStage.COMPUTE,storageTexture:{access:'write-only',format:'rgba32float'}},{binding:5,visibility:GPUShaderStage.COMPUTE,storageTexture:{access:'write-only',format:'rgba32float'}}])});
    const layout=d.createPipelineLayout({bindGroupLayouts:[renderer.commonLayout,self.layout]});self.pipelines={};
    for(const entryPoint of ['rockTerrain','rockRain','rockFlow','rockDeposit'])self.pipelines[entryPoint]=await d.createComputePipelineAsync({label:entryPoint,layout,compute:{module,entryPoint}});
    self.empty=d.createTexture({label:'empty rock weather',size:[1,1],format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING});renderer.track(self.empty,'empty rock weather',16,'shared');
    return self;
  }
  constructor(renderer){this.renderer=renderer;this.owned=[];this.final=null;this.source=null;this.rim=null;}
  clear(){for(const t of this.owned)this.renderer.release(t);this.owned=[];this.final=null;this.source=null;this.rim=null;this.key='';this.renderer.bindGroups={};}
  encode(encoder){
    const r=this.renderer,d=r.device;
    if(r.uniformValue('uRunoff')<=0&&r.uniformValue('uDebrisAmount')<=0&&r.uniformValue('uRimReach')<=0){if(this.final)this.clear();r.v('uRockWeatherGrid',[0,0,1,1]);return;}
    const [x,y,w,h]=r.bakeWindow;
    const ox=Math.floor((x-HALO)/STEP)*STEP,oy=Math.floor((y-HALO)/STEP)*STEP;
    const width=Math.ceil((x+w+HALO-ox)/STEP)+1,height=Math.ceil((y+h+HALO-oy)/STEP)+1,key=[width,height].join(',');
    if(key!==this.key){this.clear();this.key=key;for(const label of ['rock flow terrain','rock flow A','rock flow B','rock weather field','rock source beds','rock debris provenance']){const t=d.createTexture({label,size:[width,height],format:'rgba32float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING});r.track(t,label,width*height*16,'working');this.owned.push(t);}this.final=this.owned[3];this.source=this.owned[5];
      // How near a drop each cell of level ground stands (Bare rock at rims): rockDeposit writes it into flow B, which the flow rounds have
      // finished with by then (the last round leaves the flow in A), so the rim takes no memory of its own.
      this.rim=this.owned[2];r.bindGroups={};}
    r.v('uRockWeatherGrid',[ox,oy,width,height]);
    const pass=(name,terrain,flow,out,sourceIn=this.empty,sourceOut=this.owned[4],rim=this.owned[5])=>{const p=encoder.beginComputePass({label:name});p.setPipeline(this.pipelines[name]);p.setBindGroup(0,r.commonBindGroup('rock-weather'));p.setBindGroup(1,d.createBindGroup({layout:this.layout,entries:[terrain,flow,out,sourceIn,sourceOut,rim].map((t,binding)=>({binding,resource:t.createView()}))}));p.dispatchWorkgroups(Math.ceil(width/8),Math.ceil(height/8));p.end();};
    const [terrain,a,b,final,source,provenance]=this.owned;
    pass('rockTerrain',this.empty,this.empty,terrain);pass('rockRain',terrain,this.empty,a);
    // The flow rounds carry runoff alone; with Runoff exposure at 0 every reader multiplies their result by 0, so they are not run.
    if(r.uniformValue('uRunoff')>0)for(let i=0;i<ROUNDS;i++)pass('rockFlow',terrain,i%2?b:a,i%2?a:b);
    pass('rockDeposit',terrain,a,final,source,provenance,b);
  }
}
