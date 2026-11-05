// Render authored hover fixtures through the SAME /sculpt GPU pipeline.
// Images stay outside the checkout. No retail scene or crop is loaded.
// node repro/ui-previews.mjs --server http://127.0.0.1:8921 --port 9927 --out <assets-root>/ui-previews
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {cdpPortFree} from './cdp-port.mjs';
import {HELP_TOOLS,HELP_CONTROLS,HELP_CARD,HELP_PATH} from '../sculpt-help-examples.js';
const args=process.argv.slice(2),opt=(key,fallback)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1];};
const server=opt('--server','http://127.0.0.1:8921'),port=Number(opt('--port',9927)),out=resolve(opt('--out',join(tmpdir(),'terraform-ui-previews'))),repo=fileURLToPath(new URL('..',import.meta.url));
if(!relative(repo,out).startsWith('..'))throw Error('Preview images must be generated outside the repository.');
await cdpPortFree(port);mkdirSync(out,{recursive:true});
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--enable-gpu','--use-angle=metal',`--remote-debugging-port=${port}`,`--user-data-dir=${join(tmpdir(),'terraform-ui-previews-'+port)}`,'--window-size=1440,900','--no-first-run','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let ws;
try{
  for(let i=0;i<100&&!ws;i++){try{const tab=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');if(tab)ws=new WebSocket(tab.webSocketDebuggerUrl);}catch{}if(!ws)await sleep(150);}
  await new Promise(r=>ws.onopen=r);let id=0;const pending=new Map(),errors=[];
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);};
  const send=(method,params={})=>new Promise(r=>{const n=++id;pending.set(n,r);ws.send(JSON.stringify({id:n,method,params}));});
  const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.result?.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails));return r.result.result.value;};
  const ready=async()=>{for(let i=0;i<480;i++){if(await ev('!!window.sculptCanvas&&!document.getElementById("map-export").disabled')){await ev('sculptCanvas.idle()');return;}await sleep(150);}throw Error('Preview renderer did not become ready: '+errors.join('\n'));};
  await send('Runtime.enable');await send('Page.navigate',{url:`${server}/sculpt?biome=green&mapX=4&mapY=4&scratch=hover-previews&gpuMB=512&heapMB=1536`});await ready();
  // A fixed art-only crop. All variants keep the same seed, light and camera.
  const capture=async(name,kind,card)=>{
    await ev(`sculptDebug.scene(${JSON.stringify([[kind,HELP_PATH,{card,seed:2701}]])},{ground:false})`);await ready();
    const png=await ev(`(async()=>{const b=await sculptCanvas.debugBake({x:180,y:140,width:850,height:620},1),c=new OffscreenCanvas(425,310),g=c.getContext('2d');g.drawImage(b,0,0,425,310);const blob=await c.convertToBlob({type:'image/png'});return await new Promise(r=>{const f=new FileReader();f.onload=()=>r(f.result);f.readAsDataURL(blob);});})()`);
    writeFileSync(join(out,name+'.png'),Buffer.from(png.split(',')[1],'base64'));console.log(name);
  };
  for(const tool of HELP_TOOLS)await capture('tool-'+tool,tool,{});
  for(const [id,c] of Object.entries(HELP_CONTROLS))for(const [i,value] of c.values.entries())await capture(id+'-'+i,'hill',{...HELP_CARD,...c.base,[c.key]:value});
  if(errors.length)throw Error(errors.join('\n'));console.log(`Generated ${HELP_TOOLS.length+Object.keys(HELP_CONTROLS).length*2} previews in ${out}`);
}finally{ws?.close();chrome.kill();}
