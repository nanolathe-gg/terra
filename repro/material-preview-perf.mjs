// Focused Ground panel and selection check; no scene or full editor suite.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {cdpPortFree} from './cdp-port.mjs';
const args=process.argv.slice(2),opt=(key,fallback)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1];};
const server=opt('--server','http://127.0.0.1:8991'),port=Number(opt('--port','9781')),out=opt('--out','/private/tmp/ground-panel');
mkdirSync(out,{recursive:true});const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function session(url, port, fn) {
  const logs = [];let dragData=null;
  await cdpPortFree(port);
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--enable-gpu', '--use-angle=metal', `--remote-debugging-port=${port}`,
    `--user-data-dir=${out}/profile-${port}-${Date.now()}`, '--window-size=1700,1300', '--no-first-run', 'about:blank'], {stdio: 'ignore'});
  try {
    let ws;
    for (let i = 0; i < 100 && !ws; i++) { try { const p = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(x => x.type === 'page'); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {} if (!ws) await sleep(200); }
    await new Promise(r => ws.onopen = r);
    let id = 0; const wait = new Map();
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.id) { wait.get(m.id)?.(m); wait.delete(m.id); }
      if(m.method==='Input.dragIntercepted')dragData=m.params.data;
      if (m.method === 'Runtime.exceptionThrown') logs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push(m.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 300));
    };
    const send = (method, params = {}) => new Promise(r => { const k = ++id; wait.set(k, r); ws.send(JSON.stringify({id: k, method, params})); });
    const ev = async expression => { const r = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true}); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text); return r.result.result.value; };
    await send('Runtime.enable'); await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', {width: 1700, height: 1300, deviceScaleFactor: 1, mobile: false});
    await send('Page.navigate', {url});
    return await fn({send, ev, logs,drag:()=>dragData});
  } finally { chrome.kill(); await sleep(600); }
}
const ready = async ev => {
  for (let i = 0; i < 600; i++) {
    if (await ev(`!!window.sculptCanvas && !document.getElementById('editor').disabled && !document.getElementById('map-export').disabled`)) { await ev('sculptCanvas.idle()'); await sleep(1500); return; }
    const e = await ev(`document.getElementById('error')?.textContent`); if (e) throw new Error(e);
    await sleep(300);
  }
  throw new Error('the editor never became ready');
};

await session(`${server}/?biome=red&mapX=2&mapY=2&gpuMB=512`,port,async({ev,logs})=>{
 await ready(ev);
 const result=await ev(`(async()=>{
 const {GroundPreview}=await import('./sculpt-ground-preview.js');
 const {GROUND_PRESETS,copyGroundRecipe}=await import('./sculpt-ground-presets.js');
 const canvas=document.createElement('canvas');canvas.width=canvas.height=document.getElementById('ground-preview').width;const preview=new GroundPreview(canvas);const samples=[];
 try {for(const key of ['rust-mottling','cloudy-green','blue-streaked-water','violet-rippled-water']){
 const recipe=copyGroundRecipe(GROUND_PRESETS[key]);
 for(let i=0;i<4;i++) {recipe.steps.find(s=>s.type==='noise').params.patternSize+=.01;const start=performance.now();let draft;
 const result=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('preview timed out')),90000);preview.request(sculptCanvas.renderer,recipe,(error,info)=>{if(error){clearTimeout(timeout);reject(error);return;}if(info.draft){draft=performance.now()-start;return;}clearTimeout(timeout);resolve({draftMs:draft,finalMs:performance.now()-start});});});
 samples.push({key,iteration:i,...result});}
 }}finally{preview.dispose();}return samples;
 })()`);
 assert.deepEqual(logs,[]);writeFileSync(out+'/preview-perf.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
});
