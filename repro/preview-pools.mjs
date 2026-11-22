// Quick Dawn check for preview allocation: with delayed count delivery a predicted preview is shown before its count and matches the
// exact picture; a forced overflow is reported (late) and its redraw is the exact picture; other renders wait for the count and redraw an
// overflow before presenting it.
// node repro/preview-pools.mjs --out /tmp/<your-output> [--bench]
// Check shared GPU load before timing with --bench. No retail pixels are read.
import{readFileSync,writeFileSync,mkdirSync}from'node:fs';import{resolve,dirname}from'node:path';import{fileURLToPath}from'node:url';import{createHash}from'node:crypto';import assert from'node:assert/strict';
const args=process.argv.slice(2),at=args.indexOf('--out');if(at<0)throw Error('Give --out <outside repo>; --bench adds five alternating allocation samples.');
const out=resolve(args.splice(at,2)[1]),bench=args.includes('--bench'),repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
if(out===repo||out.startsWith(repo+'/'))throw Error('--out must be outside the repository');mkdirSync(out,{recursive:true});
const H=await import('./headless.mjs'),{createPreviewLattice}=await import('../sculpt-preview.js');
await H.openHost({configs:H.dumpConfigs(out+'/configs')});const scene=JSON.parse(readFileSync(repo+'/repro/scenes/green-modern-2.json')),s=await H.openScene(scene,'biome=green&mapX=16&mapY=16&scratch=1&gpuMB=512');await H.weather(s);await new Promise(r=>setTimeout(r,50));
const r=s.renderer,d=r.device,rect={x:0,y:256,width:1728,height:1088};r.setBudget(1024*1048576,0);
const source=createPreviewLattice(d,()=>({size:s.worldSize,grid:s.worldGrid,spacing:s.spacing,baseHeight:s.config.baseHeight,sea:s.config.seaLevel,minH:s.minH,maxH:s.maxH,nodes:s.nodes,context:s.context(),maskCount:s.engine.MASK_KEYS.length,revision:s.fields.stats().revision})),request={...rect,worldSize:s.worldSize,worldGrid:source.grid(4)},feed=await source.feed(r.requiredRegion(request),{weather:false});
const pixels=async()=>{const w=r.canvas.width,h=r.canvas.height,row=Math.ceil(w*4/256)*256,b=d.createBuffer({size:row*h,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}),e=d.createCommandEncoder();e.copyTextureToBuffer({texture:r.canvas.gpu.texture},{buffer:b,bytesPerRow:row},[w,h]);d.queue.submit([e.finish()]);await b.mapAsync(GPUMapMode.READ);const data=new Uint8Array(b.getMappedRange().slice(0));b.destroy();return data;};
const render=async(preview=true)=>{const result=await r.renderChunk(request,{...s.drawOptions(),feed,scale:4,preview});return {pixels:await pixels(),late:result.late};};
// Pixel arrays are compared by the count of differing bytes: assert.deepEqual's message for two large arrays never finishes.
const differ=(a,b)=>{let n=a.length===b.length?0:Math.max(a.length,b.length);for(let i=0;i<Math.min(a.length,b.length);i++)if(a[i]!==b[i])n++;return n;};
const exact=(await render()).pixels,v=r.voxel,seed={...v.predictionStats};assert(seed.seeds>0);
// Counts arrive 100 ms late (Firefox's completion timer). A gesture's preview draws and is shown before they arrive, then checks them (late);
// any other render (here a non-preview chunk at the same scale) still presents only after its count checked.
const original=v.mapCounts.bind(v),encoder=d.createCommandEncoder.bind(d),submit=d.queue.submit.bind(d.queue),labels=new WeakMap();let waiting=false,submittedBeforeReadback=false,presentedBeforeReadback=false;
d.createCommandEncoder=(desc={})=>{const e=encoder(desc),finish=e.finish.bind(e);e.finish=(...a)=>{const b=finish(...a);labels.set(b,desc.label);return b;};return e;};
d.queue.submit=commands=>{if(waiting&&commands.some(c=>labels.get(c)==='voxel solid and terrain draw'))submittedBeforeReadback=true;if(waiting&&commands.some(c=>labels.get(c)==='terrain color'))presentedBeforeReadback=true;return submit(commands);};
v.mapCounts=buffer=>{waiting=true;return original(buffer).then(async values=>{await new Promise(r=>setTimeout(r,100));waiting=false;return values;});};
const predicted=await render();const predictedLate=await predicted.late;
assert(submittedBeforeReadback,'Prediction still waited before submitting its draw');assert(presentedBeforeReadback,'A predicted preview still waited for its count');assert.equal(predictedLate,false);assert.equal(differ(predicted.pixels,exact),0,'The predicted preview differs from the exact one');
// A preview predicted too small is shown wrong, says so (late), and its redraw at the counted size is the exact picture.
for(const key of v.previewCounts.keys())v.previewCounts.set(key,1);const oldOverflows=v.predictionStats.overflows,wrong=await render(),wrongLate=await wrong.late;assert.equal(wrongLate,true);assert(v.predictionStats.overflows>oldOverflows);
const redraw=await render();assert.equal(await redraw.late,false);assert.equal(differ(redraw.pixels,exact),0,'The redrawn preview differs from the exact one');
// Last: a non-preview chunk moves the renderer to the final pipeline set, whose bytes differ from the preview set's.
presentedBeforeReadback=false;const checked=await render(false);const presentedUnchecked=presentedBeforeReadback;assert.equal(checked.late,null);assert.equal(presentedUnchecked,false,'A render other than a gesture preview was presented before its count checked');
v.mapCounts=original;d.createCommandEncoder=encoder;d.queue.submit=submit;
// Any other render that predicts too small redraws before presenting (VoxelSurface render): the same picture, nothing late.
for(const key of v.previewCounts.keys())v.previewCounts.set(key,1);const checkedOverflows=v.predictionStats.overflows,checkedOverflow=await render(false);
assert(v.predictionStats.overflows>checkedOverflows,'The forced overflow did not happen');assert.equal(checkedOverflow.late,null);assert.equal(differ(checkedOverflow.pixels,checked.pixels),0,'A redrawn checked render differs');
const report={seed,submittedBeforeReadback,presentedBeforeReadback:true,presentedUnchecked,wrongLate,checkedOverflowSHA:createHash('sha256').update(checkedOverflow.pixels).digest('hex'),checkedSHA:createHash('sha256').update(checked.pixels).digest('hex'),after:{...v.predictionStats},exactSHA:createHash('sha256').update(exact).digest('hex'),predictedSHA:createHash('sha256').update(predicted.pixels).digest('hex'),redrawSHA:createHash('sha256').update(redraw.pixels).digest('hex'),errors:s.errors};assert.equal(s.errors.length,0);if(bench){report.allocationWallMs=[];for(let i=0;i<5;i++)for(const predicted of [false,true]){if(!predicted)v.previewCounts.clear();await r.previousChunk;const t=performance.now();await r.renderChunk(request,{...s.drawOptions(),feed,scale:4,preview:true});report.allocationWallMs.push({predicted,ms:performance.now()-t});}}
// Reclaiming the canonical gather cache must respect outstanding feed leases.
const lease=await s.fields.feedSource({x0:0,y0:0,x1:32,y1:32},false);
assert.equal(s.fields.releaseStaging(),0,'A live feed lost its staging buffers');
lease.release();lease.release();
report.reclaimedStagingBytes=s.fields.releaseStaging();assert(report.reclaimedStagingBytes>0);
assert.equal(s.fields.releaseStaging(),0);assert.equal(s.errors.length,0);
writeFileSync(out+'/preview-pools.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));source.clear();await d.queue.onSubmittedWorkDone();await new Promise(r=>setTimeout(r,50));s.dispose();process.exit(0);
