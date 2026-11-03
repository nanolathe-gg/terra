// Exercise the existing memory controls through the real Go worker.
import {spawn} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {cdpPortFree} from './cdp-port.mjs';
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i+1]; };
const port = Number(opt('--port', '9695')), server = opt('--server', 'http://127.0.0.1:8891');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
await cdpPortFree(port);
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--enable-gpu', '--use-angle=metal', `--remote-debugging-port=${port}`,
  `--user-data-dir=${mkdtempSync('/private/tmp/terraform-memory-')}`, '--window-size=1400,1000', '--no-first-run', 'about:blank',
], {stdio: 'ignore'});
let ws;
try {
  let tab;
  for (let i=0; i<100 && !tab; i++) {
    try { tab = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch {}
    if (!tab) await sleep(200);
  }
  if (!tab) throw Error('Browser did not open');
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve,reject) => { ws.onopen=resolve; ws.onerror=reject; });
  let id=0; const pending=new Map(), errors=[];
  ws.onmessage = event => {
    const m=JSON.parse(event.data);
    if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); }
    if (m.method==='Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
    if (m.method==='Runtime.consoleAPICalled' && m.params.type==='error') errors.push(m.params.args.map(a=>a.value??a.description).join(' '));
  };
  const send=(method,params={})=>new Promise(resolve=>{ const n=++id; pending.set(n,resolve); ws.send(JSON.stringify({id:n,method,params})); });
  const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.result?.exceptionDetails)throw Error(r.result.exceptionDetails.exception?.description||r.result.exceptionDetails.text);return r.result?.result?.value;};
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate',{url:`${server}/sculpt?biome=green&mapX=1&mapY=1&scratch=1&gpuMB=512&heapMB=1024&weatheredView=0`});
  let ready=false;
  for(let i=0;i<600;i++){if(await ev(`!!window.sculptCanvas && !document.getElementById('map-export')?.disabled`)){ready=true;break;}await sleep(100);}
  if(!ready)throw Error('Editor did not become ready');
  const result=await ev(`(async()=>{
    const assert=(ok,message)=>{if(!ok)throw Error(message);};
    sculptDebug.scene([['hill',[[200,200],[320,250]],{card:{diameter:160,amount:80}}]],{ground:false});
    await sculptCanvas.idle();
    const pixels=async()=>{const c=await sculptCanvas.debugBake({x:96,y:96,width:256,height:256},1);return c.getContext('2d').getImageData(0,0,256,256).data;};
    const before=await pixels();
    const budget=(id,n)=>{const e=document.getElementById(id);e.value=n;e.dispatchEvent(new Event('change',{bubbles:true}));};
    budget('gpu-budget',128);budget('heap-budget',128);await sculptCanvas.idle();
    const low=await pixels();let changed=0;for(let i=0;i<before.length;i+=4)if(before[i]!==low[i]||before[i+1]!==low[i+1]||before[i+2]!==low[i+2]||before[i+3]!==low[i+3])changed++;
    assert(changed===0,'Lower budgets changed terrain pixels');
    const stats=sculptCanvas.stats();assert(stats.cacheBytes<=32*1024*1024,'UI cache exceeds quarter of heap budget');
    let refusal='';try{await sculptCanvas.debugBake({x:0,y:0,width:256,height:256},.125);}catch(error){refusal=error.message;}
    assert(refusal.includes('Terrain image')&&refusal.includes('available budget is 64.0 MiB'),'Expected early heap refusal: '+refusal);
    budget('gpu-budget',512);budget('heap-budget',1024);await sculptCanvas.idle();
    const after=await pixels();let restored=0;for(let i=0;i<before.length;i++)if(before[i]!==after[i])restored++;
    assert(restored===0,'Budget refusal broke subsequent rendering');
    return{gpuMiB:128,heapMiB:128,changedPixels:changed,cacheBytes:stats.cacheBytes,cacheLimit:32*1024*1024,refusal,restoredChangedBytes:restored};
  })()`);
  if(errors.length)throw Error('Browser errors: '+errors.join('; '));
  console.log(JSON.stringify({...result,consoleErrors:errors.length}));
} finally { ws?.close(); chrome.kill('SIGTERM'); }
