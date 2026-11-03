// Compare an editor export and native Metal export of the same complete recipe.
// Builds isolated Go/WASM programs and requires an independently prepared
// catalogue. All generated archives remain in a private temp root.
// node repro/native-browser-export.mjs --prepared-assets /path/to/assets [--recipe path] [--port 9697] [--server-port 8898]
import {spawn, execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync, symlinkSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {cdpPortFree} from './cdp-port.mjs';

const args=process.argv.slice(2), opt=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1]};
const prepared=opt('--prepared-assets',''), recipeFile=opt('--recipe','repro/recipes/native-hill.json');
if(!prepared)throw Error('--prepared-assets must name an independent prepared catalogue');
const port=Number(opt('--port',9697)),serverPort=Number(opt('--server-port',8898));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
await cdpPortFree(port);await cdpPortFree(serverPort);
const root=mkdtempSync(join('/private/tmp','terraform-native-browser-')),assets=join(root,'assets'),native=join(root,'native'),source=join(root,'source');
mkdirSync(assets);mkdirSync(native);mkdirSync(source);mkdirSync(join(source,'web'));
copyFileSync('sculpt.html',join(source,'sculpt.html'));
symlinkSync(resolve('materials'),join(source,'materials'),'dir');
for(const f of readdirSync('.'))if(f.endsWith('.wgsl'))symlinkSync(resolve(f),join(source,f));
for(const f of ['bootstrap.js','worker.js'])copyFileSync(join('web',f),join(source,'web',f));
const goroot=execFileSync('go',['env','GOROOT'],{encoding:'utf8'}).trim();copyFileSync(join(goroot,'lib','wasm','wasm_exec.js'),join(source,'web','wasm_exec.js'));
for(const [pkg,file] of [['./cmd/editor','terraform.wasm'],['./cmd/renderworker','renderworker.wasm']])execFileSync('go',['build','-o',join(source,'web',file),pkg],{env:{...process.env,GOOS:'js',GOARCH:'wasm'},stdio:'inherit'});
copyFileSync(join(prepared,'map-catalog.json'),join(assets,'map-catalog.json'));
const binary=join(root,'terraform'), exporter=join(assets,'map-export');
execFileSync('go',['build','-o',binary,'./cmd/terraform'],{stdio:'inherit'});
execFileSync('go',['build','-o',exporter,'./export'],{stdio:'inherit'});
const server=spawn(binary,['--port',String(serverPort),'--source-root',source,'--assets-root',assets,'--export-tool',exporter,'--prepared'],{stdio:'ignore'});
let chrome;
try {
 const origin=`http://127.0.0.1:${serverPort}`;
 let ready=false;for(let i=0;i<100&&!ready;i++){try{ready=(await fetch(origin+'/sculpt')).ok}catch{}if(!ready)await sleep(100)}
 if(!ready)throw Error('server did not start');
 chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--enable-gpu','--use-angle=metal',`--remote-debugging-port=${port}`,`--user-data-dir=${root}/chrome`,'--window-size=1700,1300','--no-first-run','about:blank'],{stdio:'ignore'});
 let page;for(let i=0;i<100&&!page;i++){try{page=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(x=>x.type==='page')}catch{}if(!page)await sleep(200)}
 if(!page)throw Error('Chrome did not start');
 const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
 let id=0;const pending=new Map(),logs=[];
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id)}if(m.method==='Runtime.exceptionThrown')logs.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')logs.push(m.params.args.map(a=>a.value??a.description).join(' '))};
 const send=(method,params={})=>new Promise(r=>{const k=++id;pending.set(k,r);ws.send(JSON.stringify({id:k,method,params}))});
 const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.result?.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails));return r.result?.result?.value};
 await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1700,height:1300,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:`${origin}/sculpt?biome=green&mapX=1&mapY=1&sea=0&scratch=native-parity&gpuMB=512`});
 ready=false;for(let i=0;i<600;i++){if(await ev(`!!window.sculptCanvas && !document.getElementById('map-export')?.disabled`)){ready=true;break}await sleep(300)}
 if(!ready)throw Error('editor did not become ready');
 await ev('sculptCanvas.idle()');
 const fixture=JSON.parse(readFileSync(recipeFile,'utf8'));
 await ev(`sculptDebug.loadSketch(${JSON.stringify(fixture)});true`);
 const error=await ev(`document.getElementById('error').hidden ? '' : document.getElementById('error').textContent`);if(error)throw Error('recipe: '+error);
 const name='TerraformParity'+Date.now();
 await ev(`(()=>{for(const [id,v] of [['map-name',${JSON.stringify(name)}],['map-description','Native and browser parity']]){let e=document.getElementById(id);e.value=v;e.dispatchEvent(new Event('change',{bubbles:true}))}return true})()`);
 await ev(`window.parityExport={done:false};sculptMap.export().then(result=>window.parityExport={done:true,result},e=>window.parityExport={done:true,error:e.message});true`);
 let outcome;for(let i=0;i<2400;i++){outcome=await ev('window.parityExport');if(outcome?.done)break;await sleep(250)}
 if(!outcome?.done||outcome.error)throw Error('browser export: '+(outcome?.error||'timed out'));
 const full=await ev('sculptDebug.sketch()');
 if(full.mapData.name!==name)throw Error('complete recipe did not retain the export name');
 const scene=join(root,'scene.json');writeFileSync(scene,JSON.stringify(full));
 for(const [key,path] of [['archive',join(root,'browser.ufo')],['indexed',join(root,'browser.png')]]){
  const response=await fetch(origin+'/map-exports/'+encodeURIComponent(outcome.result[key]));if(!response.ok)throw Error(`${key}: HTTP ${response.status}`);writeFileSync(path,Buffer.from(await response.arrayBuffer()));
 }
 const nativeRun=execFileSync(binary,['--source-root',source,'--assets-root',assets,'--export-tool',exporter,'--prepared','--scene',scene,'--out',native],{encoding:'utf8',timeout:600000});
 let comparison;
 try { comparison=execFileSync('go',['run','repro/exportcompare.go',join(root,'browser.ufo'),join(native,name+'.ufo'),join(root,'browser.png'),join(native,name+'-indexed.png'),join(native,'heights.json'),name],{encoding:'utf8',timeout:120000}); }
 catch(e) { console.error(`Comparison artifacts: ${root}`); if(e.stdout)console.error(String(e.stdout)); throw e; }
 if(logs.length)throw Error('browser errors: '+logs.join('; '));
 console.log(JSON.stringify({root,native:nativeRun.trim(),comparison:JSON.parse(comparison),consoleErrors:logs.length}));
} finally {chrome?.kill();server.kill('SIGTERM')}
