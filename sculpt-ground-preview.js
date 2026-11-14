import {TerrainRenderer} from './sculpt-renderer.js';
import {groundPool} from './sculpt-material-model.js';
import {MASK_KEYS} from './sculpt-scene.js';
// The normal terrain renderer over an authored flat fixture, with the period
// seam at the center. No preview shader and no readback of the material cache.
export class GroundPreview {
 constructor(canvas){this.canvas=canvas;this.serial=0;this.running=false;}
 request(main,recipe,neighbor,done){this.pending={main,recipe:structuredClone(recipe),neighbor:structuredClone(neighbor),done,serial:++this.serial};clearTimeout(this.timer);this.timer=setTimeout(()=>this.run(),120);}
 async run(){
  if(this.running||!this.pending)return;this.running=true;const job=this.pending;this.pending=null;
  try{
   const {main,recipe,neighbor}=job,pool=groundPool(main.config.material);
   if(!this.renderer){
    const config=structuredClone(Object.fromEntries(Object.entries(main.config).filter(([,v])=>typeof v!=='function')));Object.assign(config,{size:pool*3+1,worldSize:pool*3+1,grid:pool*3/4+1,worldGrid:pool*3/4+1,gpuBudgetBytes:256*1024*1024,maskKeys:MASK_KEYS});
    this.surface=new OffscreenCanvas(256,256);this.renderer=await TerrainRenderer.createChunked(this.surface,config);
   }
   const r=this.renderer;r.variant=new URLSearchParams(main.variant);r.applyKnobs();r.setColors(main.colorOverrides);r.i('uDiagnosticView',0);
   r.setGrounds(new Map(recipe?[[1,recipe]]:[]));
   const request={x:pool-128,y:pool-128,width:256,height:256,worldSize:r.config.worldSize,worldGrid:r.config.worldGrid};
   const region=r.requiredRegion(request),count=region.gridWidth*region.gridHeight;
   request.gridWidth=region.gridWidth;request.gridHeight=region.gridHeight;request.gridOrigin=region.gridOrigin;
   request.fields={h:new Float32Array(count).fill(recipe?.worldWater?r.config.seaLevel-64:r.config.baseHeight)};request.masks={ground:new Int8Array(count).fill(recipe?2:0)};
   const rendered=await r.renderChunk(request,{clay:false,light:'original'});
   if(job.serial===this.serial){
    const ctx=this.canvas.getContext('2d');ctx.drawImage(rendered.canvas,0,0);const pixels=ctx.getImageData(0,0,256,256).data,keys=new Set();
    for(let y=0;y<256;y+=32)for(let x=0;x<256;x+=32){let key='';for(let j=0;j<32;j++){const at=((y+j)*256+x)*4;key+=String.fromCharCode(...pixels.subarray(at,at+128));}keys.add(key);}
    let edgeDistinct=0;
    if(recipe&&!recipe.worldWater){
     r.setGrounds(new Map([[1,recipe],...(neighbor?[[2,neighbor]]:[])]));
     const edge=pool+12;
     for(let y=0;y<region.gridHeight;y++)for(let x=0;x<region.gridWidth;x++)request.masks.ground[y*region.gridWidth+x]=region.gridOrigin[0]+x*region.gridSpacing<edge?2:neighbor?3:0;
     const edgeRender=await r.renderChunk(request,{clay:false,light:'original'});
     const scratch=new OffscreenCanvas(256,256),edgeCtx=scratch.getContext('2d');edgeCtx.drawImage(edgeRender.canvas,0,0);
     const edgePixels=edgeCtx.getImageData(0,0,256,256).data,edgeKeys=new Set();
     for(let y=0;y<256;y+=32){let key='';for(let j=0;j<32;j++){const at=((y+j)*256+128)*4;key+=String.fromCharCode(...edgePixels.subarray(at,at+128));}edgeKeys.add(key);}edgeDistinct=edgeKeys.size;
    }
    if(job.serial===this.serial)job.done(null,{distinct:keys.size,tiles:64,pool,perLevel:(pool/32)**2,edgeDistinct,edgeTiles:recipe&&!recipe.worldWater?8:0,neighbor:neighbor?.name||'World ground'});
   }

  }catch(error){if(job.serial===this.serial)job.done(error);}
  finally{this.running=false;if(this.pending)this.run();}
 }
 dispose(){clearTimeout(this.timer);this.pending=null;this.serial++;this.renderer?.dispose();}
}
