// A column edit must change existing Surf geometry immediately, including undo.
// node repro/surf-column.mjs --server http://127.0.0.1:8921 --port 9927 --out /tmp/surf-column
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {cdpPortFree} from './cdp-port.mjs';
const args=process.argv.slice(2),opt=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const server=opt('--server','http://127.0.0.1:8921'),port=Number(opt('--port',9927)),out=opt('--out','/tmp/surf-column');
await cdpPortFree(port);mkdirSync(out,{recursive:true});
const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--enable-gpu','--use-angle=metal',`--remote-debugging-port=${port}`,`--user-data-dir=${join(out,'profile')}`,'--window-size=1440,900','--no-first-run','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let ws;
try{
  for(let i=0;i<100&&!ws;i++){
    try{const tab=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');if(tab)ws=new WebSocket(tab.webSocketDebuggerUrl);}catch{}
    if(!ws)await sleep(150);
  }
  if(!ws)throw Error('Chrome did not start');
  await new Promise(r=>ws.onopen=r);let id=0;const pending=new Map(),errors=[],report={};
  ws.onmessage=e=>{
    const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}
    if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);
    if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params.args.map(a=>a.value||a.description).join(' '));
  };
  const send=(method,params={})=>new Promise((resolve,reject)=>{
    const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(Error(`${method} timed out`));},120000);
    pending.set(n,m=>{clearTimeout(timer);m.error?reject(Error(m.error.message)):resolve(m);});ws.send(JSON.stringify({id:n,method,params}));
  });
  const ev=async expression=>{
    const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if(r.result?.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails));return r.result.result.value;
  };
  const ready=async()=>{
    for(let i=0;i<480;i++){
      if(await ev('!!window.sculptCanvas&&!document.getElementById("map-export").disabled')){await ev('sculptCanvas.idle()');return;}
      await sleep(150);
    }
    throw Error('Editor did not become ready: '+errors.join('\n'));
  };
  await send('Runtime.enable');await send('Page.enable');
  await send('Page.navigate',{url:`${server}/sculpt?biome=green&variant=modern&mapX=4&mapY=4&scratch=surf-column&bedDip=0&bedDipDir=90&gpuMB=512&heapMB=1536`});await ready();
  // Isolate the shape pass from weathering, and use a material with authored beds.
  await ev(`document.getElementById('weather').checked=false;document.getElementById('weather').dispatchEvent(new Event('change'));true`);await ready();
  await ev(`window.fixture=[['deep',[[250,500],[780,500]],{seed:2701,card:{diameter:650,surf:100,heightReference:1,elevation:-55,combine:1,wander:0,widthVary:0,heightVary:0,terraces:0}}]];sculptDebug.scene(fixture,{ground:false});true`);await ready();
  await ev(`window.heights=()=>{const a=[];for(let y=100;y<1000;y+=4)for(let x=0;x<1050;x+=4)a.push(sculptDebug.corner(x,y).authored);return a;};window.diff=(a,b)=>{let max=0,count=0;for(let i=0;i<a.length;i++){const v=Math.abs(a[i]-b[i]);max=Math.max(max,v);if(v>0)count++;}return {max,count};};window.before=heights();window.originalSketch=sculptDebug.sketch();true`);
  report.samples=await ev('before.length');
  report.beds=await ev(`(()=>{const fields=[...document.querySelectorAll('#column-panel input[aria-label$="hardness"]')];for(const e of fields){e.value='1';e.dispatchEvent(new Event('input',{bubbles:true}));}fields.at(-1)?.dispatchEvent(new Event('change',{bubbles:true}));return fields.length;})()`);await ready();
  assert(report.beds>0,'fixture needs editable rock beds');
  report.hardness=await ev('window.live=heights();diff(before,live)');
  assert(report.hardness.max>1,'hardness must change the live beach');
  await ev(`document.getElementById('undo').click()`);await ready();assert.deepEqual(await ev('diff(before,heights())'),{max:0,count:0});
  await ev(`document.getElementById('redo').click()`);await ready();assert.deepEqual(await ev('diff(live,heights())'),{max:0,count:0});
  await ev('sculptDebug.loadSketch(sculptDebug.sketch());true');await ready();assert.deepEqual(await ev('diff(live,heights())'),{max:0,count:0});
  report.history='undo, redo and recipe reload match exactly';
  await ev('sculptDebug.loadSketch(originalSketch);true');await ready();
  for(const [key,value] of [['bedDip',4],['bedDipDir',0]]){
    await ev(`(()=>{window.before=heights();const e=document.getElementById(${JSON.stringify('knob-'+key)});if(e.disabled)throw Error('control is disabled');e.value=${value};e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await ready();
    report[key]=await ev('window.live=heights();diff(before,live)');assert(report[key].max>1,`${key} must change the live beach`);
    await ev('sculptDebug.scene(fixture,{ground:false});true');await ready();assert.deepEqual(await ev('diff(live,heights())'),{max:0,count:0},`${key} must match a fresh replay`);
  }
  assert.deepEqual(errors,[]);report.console=errors;writeFileSync(join(out,'surf-column.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{ws?.close();browser.kill();}
