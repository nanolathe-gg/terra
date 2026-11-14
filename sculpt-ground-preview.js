import {TerrainRenderer} from './sculpt-renderer.js';
import {groundPool} from './sculpt-material-model.js';
import {MASK_KEYS} from './sculpt-scene.js';
// The normal terrain renderer over an authored flat fixture, with the period
// seam at the center. No preview shader and no readback of the material cache.
export class GroundPreview {
 constructor(canvas){this.canvas=canvas;this.serial=0;this.epoch=0;this.running=false;}
 request(main,recipe,done,view={}){
  this.cancelled=false;
  const job={main,view,recipe:structuredClone(recipe),done,epoch:this.epoch,serial:++this.serial};
  this.pending={...job,draft:true};
  if(!this.running&&!this.timer)this.timer=setTimeout(()=>{this.timer=null;this.run();},0);
  clearTimeout(this.finalTimer);this.finalTimer=setTimeout(()=>{this.finalTimer=null;if(job.serial!==this.serial)return;this.pending={...job,draft:false};this.run();},120);
 }

 async run(){
  if(this.running||!this.pending)return;this.running=true;const job=this.pending;this.pending=null;
  try{
   const {main,recipe}=job,pool=groundPool(main.config.material),size=this.canvas.width,half=size/2;
   if(!this.renderer){
    const config=structuredClone(Object.fromEntries(Object.entries(main.config).filter(([,v])=>typeof v!=='function')));Object.assign(config,{size:pool*3+1,worldSize:pool*3+1,grid:pool*3/4+1,worldGrid:pool*3/4+1,gpuBudgetBytes:256*1024*1024,maskKeys:MASK_KEYS});
    this.surface=new OffscreenCanvas(size,size);this.renderer=await TerrainRenderer.createChunked(this.surface,config);
   }
   if(this.disposed||job.epoch!==this.epoch)return;
   const r=this.renderer;r.variant=new URLSearchParams(main.variant);r.applyKnobs();r.setColors(main.colorOverrides);r.i('uDiagnosticView',job.view.channel??0);
   // Drafts use the same renderer and fields, deferring the expensive final
   // palette diffusion until input settles. The final job restores the recipe.
   const sample=recipe&&job.draft?{...recipe,knobs:{...recipe.knobs,textureDither:0}}:recipe;
   r.setGrounds(new Map(sample?[[1,sample]]:[]));
   const request={x:pool-half,y:pool-half,width:size,height:size,worldSize:r.config.worldSize,worldGrid:r.config.worldGrid};
   const region=r.requiredRegion(request),count=region.gridWidth*region.gridHeight;
   request.gridWidth=region.gridWidth;request.gridHeight=region.gridHeight;request.gridOrigin=region.gridOrigin;
   const h=new Float32Array(count);const center=job.view.height??(recipe?.worldWater?r.config.seaLevel-64:r.config.baseHeight),slope=Math.tan((job.view.slope??0)*Math.PI/180);
   for(let y=0;y<region.gridHeight;y++)for(let x=0;x<region.gridWidth;x++)h[y*region.gridWidth+x]=center+(region.gridOrigin[0]+x*region.gridSpacing-pool)*slope;
   request.fields={h};request.masks={ground:new Int8Array(count).fill(recipe?2:0)};
   const rendered=await r.renderChunk(request,{clay:false,light:'original'});
   if(!this.cancelled&&job.epoch===this.epoch&&(job.serial===this.serial||job.draft)){
    const ctx=this.canvas.getContext('2d');ctx.drawImage(rendered.canvas,0,0);const pixels=job.draft?null:ctx.getImageData(0,0,size,size).data,keys=new Set();
    for(let y=0;pixels&&y<size;y+=32)for(let x=0;x<size;x+=32){let key='';for(let j=0;j<32;j++){const at=((y+j)*size+x)*4;key+=String.fromCharCode(...pixels.subarray(at,at+128));}keys.add(key);}

    job.done(null,{draft:job.draft,distinct:keys.size,tiles:(size/32)**2,pool,perLevel:(pool/32)**2});
   }

  }catch(error){if(job.serial===this.serial)job.done(error);}
  finally{this.running=false;if(this.disposed)this.renderer?.dispose();else if(this.pending)this.run();}
 }
 cancel(){this.epoch++;this.cancelled=true;clearTimeout(this.timer);clearTimeout(this.finalTimer);this.timer=this.finalTimer=null;this.pending=null;this.serial++;}
 dispose(){this.cancel();this.disposed=true;if(!this.running)this.renderer?.dispose();}
}
