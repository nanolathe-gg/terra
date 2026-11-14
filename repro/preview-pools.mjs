// Quick Dawn check for preview allocation: delayed count delivery, normal prediction,
// and forced overflow must all preserve the exact picture before presentation.
// node repro/preview-pools.mjs --out /tmp/<your-output> [--bench]
// Check shared GPU load before timing with --bench. No retail pixels are read.
import{readFileSync,writeFileSync,mkdirSync}from'node:fs';import{resolve,dirname}from'node:path';import{fileURLToPath}from'node:url';import{createHash}from'node:crypto';import assert from'node:assert/strict';
const args=process.argv.slice(2),at=args.indexOf('--out');if(at<0)throw Error('Give --out <outside repo>; --bench adds five alternating allocation samples.');
const out=resolve(args.splice(at,2)[1]),bench=args.includes('--bench'),repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
if(out===repo||out.startsWith(repo+'/'))throw Error('--out must be outside the repository');mkdirSync(out,{recursive:true});
const H=await import('./headless.mjs'),{createPreviewLattice}=await import('../sculpt-preview.js');
await H.openHost({configs:H.dumpConfigs(out+'/configs')});const scene=JSON.parse(readFileSync(repo+'/repro/scenes/green-modern-2.json')),s=await H.openScene(scene,'biome=green&variant=modern&mapX=16&mapY=16&scratch=1&gpuMB=512');await H.weather(s);await new Promise(r=>setTimeout(r,50));
const r=s.renderer,d=r.device,rect={x:0,y:256,width:1728,height:1088};r.setBudget(1024*1048576,0);
const source=createPreviewLattice(d,()=>({size:s.worldSize,grid:s.worldGrid,spacing:s.spacing,baseHeight:s.config.baseHeight,sea:s.config.seaLevel,minH:s.minH,maxH:s.maxH,nodes:s.nodes,context:s.context(),maskCount:s.engine.MASK_KEYS.length,revision:s.fields.stats().revision})),request={...rect,worldSize:s.worldSize,worldGrid:source.grid(4)},feed=await source.feed(r.requiredRegion(request),{weather:false});
const pixels=async()=>{const w=r.canvas.width,h=r.canvas.height,row=Math.ceil(w*4/256)*256,b=d.createBuffer({size:row*h,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}),e=d.createCommandEncoder();e.copyTextureToBuffer({texture:r.canvas.gpu.texture},{buffer:b,bytesPerRow:row},[w,h]);d.queue.submit([e.finish()]);await b.mapAsync(GPUMapMode.READ);const data=new Uint8Array(b.getMappedRange().slice(0));b.destroy();return data;};
const render=async()=>{await r.renderChunk(request,{...s.drawOptions(),feed,scale:4,preview:true});return pixels();};
const exact=await render(),v=r.voxel,seed={...v.predictionStats};assert(seed.seeds>0);
const original=v.readback.mapAsync.bind(v.readback),encoder=d.createCommandEncoder.bind(d),submit=d.queue.submit.bind(d.queue),labels=new WeakMap();let waiting=false,submittedBeforeReadback=false,presentedBeforeReadback=false;
d.createCommandEncoder=(desc={})=>{const e=encoder(desc),finish=e.finish.bind(e);e.finish=(...a)=>{const b=finish(...a);labels.set(b,desc.label);return b;};return e;};
d.queue.submit=commands=>{if(waiting&&commands.some(c=>labels.get(c)==='voxel solid and terrain draw'))submittedBeforeReadback=true;if(waiting&&commands.some(c=>labels.get(c)==='present voxel terrain'))presentedBeforeReadback=true;return submit(commands);};
v.readback.mapAsync=async(...a)=>{waiting=true;await original(...a);await new Promise(r=>setTimeout(r,100));waiting=false;};
const predicted=await render();v.readback.mapAsync=original;d.createCommandEncoder=encoder;d.queue.submit=submit;
assert(submittedBeforeReadback,'Prediction still waited before submitting its draw');assert.equal(presentedBeforeReadback,false,'An unvalidated preview was presented');assert.deepEqual(predicted,exact);
for(const key of v.previewCounts.keys())v.previewCounts.set(key,1);const oldOverflows=v.predictionStats.overflows,overflow=await render();assert(v.predictionStats.overflows>oldOverflows);assert.deepEqual(overflow,exact);
const report={seed,submittedBeforeReadback,presentedBeforeReadback,after:{...v.predictionStats},exactSHA:createHash('sha256').update(exact).digest('hex'),predictedSHA:createHash('sha256').update(predicted).digest('hex'),overflowSHA:createHash('sha256').update(overflow).digest('hex'),differentPredicted:0,differentOverflow:0,errors:s.errors};assert.equal(s.errors.length,0);if(bench){report.allocationWallMs=[];for(let i=0;i<5;i++)for(const predicted of [false,true]){if(!predicted)v.previewCounts.clear();await r.previousChunk;const t=performance.now();await r.renderChunk(request,{...s.drawOptions(),feed,scale:4,preview:true});report.allocationWallMs.push({predicted,ms:performance.now()-t});}}
// Reclaiming the canonical gather cache must respect outstanding feed leases.
const lease=await s.fields.feedSource({x0:0,y0:0,x1:32,y1:32},false);
assert.equal(s.fields.releaseStaging(),0,'A live feed lost its staging buffers');
lease.release();lease.release();
report.reclaimedStagingBytes=s.fields.releaseStaging();assert(report.reclaimedStagingBytes>0);
assert.equal(s.fields.releaseStaging(),0);assert.equal(s.errors.length,0);
writeFileSync(out+'/preview-pools.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));source.clear();await d.queue.onSubmittedWorkDone();await new Promise(r=>setTimeout(r,50));s.dispose();process.exit(0);
