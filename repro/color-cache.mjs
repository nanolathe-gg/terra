// LP5: four small fed-scene checks for interleaved immutable color records.
// node repro/color-cache.mjs --server http://127.0.0.1:<yours> --out /private/tmp/lp5
// On demand; no browser timing or export sweep.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import * as H from './headless.mjs';
const args=process.argv.slice(2),opt=(name,fallback)=>{const at=args.indexOf(name);return at<0?fallback:args.splice(at,2)[1];};
const server=opt('--server',''),out=resolve(opt('--out','/private/tmp/terra-color-cache')),repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
if(args.length||!server||new URL(server).port==='8801'||out===repo||out.startsWith(repo+'/'))throw Error('Give your own --server and an --out folder outside the repository.');
mkdirSync(out,{recursive:true});await H.openHost({server});
const rows=[],sha=a=>createHash('sha256').update(a).digest('hex');
async function read(r){
  const d=r.device,w=r.canvas.width,h=r.canvas.height,row=Math.ceil(w*4/256)*256,b=d.createBuffer({size:row*h,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),e=d.createCommandEncoder();
  e.copyTextureToBuffer({texture:r.canvas.gpu.texture},{buffer:b,bytesPerRow:row},[w,h]);d.queue.submit([e.finish()]);await b.mapAsync(GPUMapMode.READ);
  const raw=new Uint8Array(b.getMappedRange()),data=new Uint8Array(w*h*4);
  for(let y=0;y<h;y++)data.set(raw.subarray(y*row,y*row+w*4),y*w*4);
  b.destroy();return data;
}
for(const name of ['green-modern-2','green-2','red-3','green-7']){
  const scene=JSON.parse(readFileSync(join(repo,'repro/scenes',name+'.json'))),s=await H.openScene(scene,`biome=${scene.biome}&mapX=16&mapY=16&scratch=1&gpuMB=512${scene.query?'&'+scene.query:''}`);
  for(const [k,v]of Object.entries({faceFresh:1,faceRind:1,faceWet:.7,absorbDepth:1,shadowTint:1,cavity:1,closeShadow:1}))await H.knob(s,k,v);
  await H.weather(s);const r=s.renderer;r.setBudgetMB(1536);
  const x=name==='green-2'?800:name==='green-7'?480:320,y=name==='green-2'?680:name==='green-7'?512:640,options=s.drawOptions();
  const a={x,y,width:128,height:128,tile:128,options},b={x:x+128,y:y+64,width:131,height:129,tile:256,options};
  await H.renderWindow(s,a);const ta=await r.retainColorTile();assert(ta);
  await H.renderWindow(s,b);const tb=await r.retainColorTile();assert(tb);r.voxel.clear();
  if(name==='green-7')r.setColors({...r.colorOverrides,deep:[.9,.12,.07]});else await H.knob(s,'ambient',.51);
  const t=performance.now();await r.renderColorTile(ta,options);const wa=await read(r);
  await r.renderColorTile(tb,options);const wb=await read(r),replayMs=performance.now()-t;
  // Heterogeneous rectangles in one submission must keep local geometry and
  // sampling coordinates, including the odd tile's derivative apron.
  const batched=await r.renderColorTiles([ta,tb,ta,tb],options),atlas=await read(r),atlasWidth=r.canvas.width;
  for(const [i,region]of batched.regions.entries()){
    const tile=i%2?tb:ta,width=tile.width,height=tile.height,x=i<2?0:ta.width+tb.width,offset=x+(i%2?ta.width:0),pixels=new Uint8Array(width*height*4);
    for(let y=0;y<height;y++)pixels.set(atlas.subarray((y*atlasWidth+offset)*4,(y*atlasWidth+offset+width)*4),y*width*4);
    assert.equal(sha(pixels),sha(i%2?wb:wa),name+' batch tile '+i);
  }
  ta.rect={x:a.x,y:a.y,width:a.width,height:a.height};tb.rect={x:b.x,y:b.y,width:b.width,height:b.height};
  const view={x:a.x+35.25,y:a.y+28.5,width:168.5,height:103.25},clipped=await r.renderColorTiles([ta,tb],options,view),partial=await read(r),partialWidth=r.canvas.width;let clippedPixels=0;
  for(const [i,region]of clipped.regions.entries()){
    const tile=i?tb:ta,full=i?wb:wa,sourceX=i?ta.width:0,fresh=region.fresh??tile.rect;
    for(let y=0;y<tile.height;y++)for(let x=0;x<tile.width;x++){
      const at=((y*partialWidth)+sourceX+x)*4,p=(y*tile.width+x)*4,wx=tile.rect.x+x+.5,wy=tile.rect.y+y+.5;
      if(wx>=fresh.x&&wx<fresh.x+fresh.width&&wy>=fresh.y&&wy<fresh.y+fresh.height){assert.deepEqual([...partial.subarray(at,at+4)],[...full.subarray(p,p+4)],name+' clipped '+i+' at '+x+','+y);clippedPixels++;}
      else assert.deepEqual([...partial.subarray(at,at+4)],[0,0,0,255],name+' unpainted output stays absent');
    }
  }
  const fulla=await H.renderWindow(s,a),fullb=await H.renderWindow(s,b);
  assert.equal(sha(wa),sha(fulla),name+' first tile');assert.equal(sha(wb),sha(fullb),name+' interleaved odd tile');
  const maskBytes=[ta.source.colorMasks??ta.source.maskTexture,tb.source.colorMasks??tb.source.maskTexture].map(texture=>r.resources.get(texture)?.bytes??0),retained=r.colorBytes;await H.knob(s,'rockFace',3.9);await assert.rejects(()=>r.renderColorTile(ta,options),/needs [ABCDE]/);assert(ta.retired&&!r.colorTiles.has(ta),name+' a refused record is retired');
  // Retirement cannot destroy a pinned input while the preceding queue wait yields.
  let resume;const completion=r.previousChunk;r.previousChunk=new Promise(resolve=>{resume=resolve;});
  const pending=r.renderColorTile(tb,options);assert.equal(tb.users,1);r.releaseColorTile(tb);assert(r.resources.has(tb.record));resume();
  await assert.rejects(()=>pending,/evicted/);assert(!r.resources.has(tb.record));r.previousChunk=completion;
  r.trimColorTiles();assert.equal(r.colorBytes,0);await r.device.queue.onSubmittedWorkDone();await new Promise(r=>setTimeout(r,30));assert.deepEqual(s.errors,[]);
  rows.push({scene:name,tiles:[a,b].map(({options,...r})=>r),sha:[sha(wa),sha(wb)],different:0,batchedTiles:4,clippedPixels,retained,maskBytes,replayIncludingReadbacksMs:replayMs,geometryEditRejected:true,retirementWaitedForReader:true,evictedBytes:r.colorBytes,errors:s.errors});
  console.log(rows.at(-1));s.dispose();
}
writeFileSync(join(out,'color-cache-proof.json'),JSON.stringify(rows));process.exit(0);
