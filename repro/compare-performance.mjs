// Alternate original and Go builds in fresh browsers, with identical timing hooks.
// node repro/compare-performance.mjs --original http://127.0.0.1:8890 --wgpu http://127.0.0.1:8891 --out /private/tmp/terrain-comparison
import {spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const args=process.argv.slice(2),opt=(key,fallback)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1]};
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const original=opt('--original','http://127.0.0.1:8890'),wgpu=opt('--wgpu','http://127.0.0.1:8891');
const out=resolve(opt('--out','/private/tmp/terraform-performance-'+Date.now())),runs=Number(opt('--runs','3')),mode=opt('--map','map4'),port=opt('--port','9696'),tools=opt('--tools','hill,landform').split(',');
if(!Number.isInteger(runs)||runs<1||runs>20)throw Error('--runs must be between 1 and 20');
mkdirSync(out,{recursive:true});
const results=[];
for(const tool of tools)for(let i=0;i<runs;i++)for(const build of (i%2?['wgpu','original']:['original','wgpu'])){
 const label=`${build}-${tool}-${i+1}`,dir=join(out,label);
 console.log(`Running ${label}`);
 const r=spawnSync(process.execPath,[join(root,'repro/perf.mjs'),mode,'--server',build==='original'?original:wgpu,'--port',port,'--scene',opt('--scene','repro/scenes/green-2.json'),'--tool',tool,'--out',dir,'--label',label,'--no-export'],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});
 writeFileSync(join(out,label+'.log'),(r.stdout||'')+(r.stderr||''));
 const file=join(dir,`${mode}-${label}-perf.json`),data=JSON.parse(readFileSync(file,'utf8'));
 const entry={tool,build,run:i+1,file,exitCode:r.status,data};results.push(entry);
 if(r.status!==0||data.error||data.console?.length)throw Error(`Failed ${label}; inspect ${file}`);
 for(const key of ['latencyAny','latency']){const m=data.drag?.[key];if(!m||m.censored!==0||m.moves!==data.drag.movesDelivered||m.measured!==m.moves||![m.p50,m.p95].every(Number.isFinite))throw Error(`Incomplete ${key} for ${label}; inspect ${file}`);}
 console.log(JSON.stringify({label,firstAnyP95:data.drag.latencyAny.p95,pointerOverlapP95:data.drag.latency.p95,frameP95:data.drag.rafMs.p95,release:data.release.finalInView}));
}
const median=a=>{if(a.length!==runs||!a.every(Number.isFinite))return null;a=[...a].sort((x,y)=>x-y);return a.length?a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2:null};
const metrics={firstVisibleP50:d=>d.drag.latencyAny.p50,firstVisibleP95:d=>d.drag.latencyAny.p95,pointerOverlapP50:d=>d.drag.latency.p50,pointerOverlapP95:d=>d.drag.latency.p95,frameP95:d=>d.drag.rafMs.p95,sceneComplete:d=>d.load.finalInView,releaseComplete:d=>d.release.finalInView,cacheBytes:d=>d.memory.cacheBytes};
const summary={original,wgpu,mode,runs,scene:opt('--scene','repro/scenes/green-2.json'),note:'Medians across runs. Pointer overlap is an approximation; first visible may be unrelated to the edited area. Timing excludes startup; no GPU diagnostic wrappers or pixel readbacks are enabled.',tools:{},files:results.map(({data,...r})=>r)};
for(const tool of tools){const row=summary.tools[tool]={};for(const [name,get]of Object.entries(metrics)){const values=build=>results.filter(r=>r.tool===tool&&r.build===build).map(r=>get(r.data));const a=values('original'),b=values('wgpu');row[name]={original:median(a),wgpu:median(b),originalRuns:a,wgpuRuns:b,measured:{original:a.filter(Number.isFinite).length,wgpu:b.filter(Number.isFinite).length,expected:runs}};if(row[name].original>0&&Number.isFinite(row[name].wgpu))row[name].ratio=row[name].wgpu/row[name].original;}row.moves=Object.fromEntries(['original','wgpu'].map(build=>[build,results.filter(r=>r.tool===tool&&r.build===build).reduce((a,r)=>({measured:a.measured+r.data.drag.latencyAny.measured,censored:a.censored+r.data.drag.latencyAny.censored}),{measured:0,censored:0})]));}
writeFileSync(join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary.tools,null,2));console.log(`Saved ${join(out,'summary.json')}`);
