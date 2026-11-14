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

await session(`${server}/?biome=red&mapX=2&mapY=2&gpuMB=512`,port,async({send,ev,logs})=>{
 const click=id=>ev(`document.getElementById(${JSON.stringify(id)}).click();true`);
 const set=(id,value,event='change')=>ev(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(String(value))};e.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));return true;})()`);
 const choose=i=>ev(`document.querySelector('[data-layer-index="${i}"] .material-layer-select').click();true`);
 const state=()=>ev('sculptDebug.sketch()');
 const preview=async()=>{for(let i=0;i<180;i++){const text=await ev(`document.getElementById('ground-preview-count').textContent`);if(text.includes('unavailable'))throw Error(text);if(text.includes('distinct')&&!text.includes('Draft'))return;await sleep(100);}throw Error('preview timed out');};
 await ready(ev);await click('tab-world');await click('wsec-ground');await click('material-open');
 const counts={'rust-mottling':4,'cloudy-green':3,'blue-streaked-water':3,'violet-rippled-water':4};
 for(const [key,count]of Object.entries(counts)){
  await set('ground-add',key);assert.equal(await ev(`document.querySelectorAll('.material-layer-row:not([hidden])').length`),count);await choose(1);
  assert.equal(await ev(`document.getElementById('ground-patternSize').disabled`),true,'adjustment pattern settings are inherited');
  assert.equal(await ev(`document.getElementById('layer-pattern').disabled`),true,'adjustment cannot replace its inherited basis');
  assert.equal(await ev(`document.getElementById('ground-'+(${JSON.stringify(key)}==='rust-mottling'?'textureFineStructure':'textureFine')).disabled`),false,'grain has its own editable strength');
  await preview();
 }
 await set('ground-presets',1);await choose(0);await set('ground-patternSize',17,'input');await set('ground-patternSize',17);
 await choose(1);assert.equal(await ev(`document.getElementById('ground-patternSize').value`),'17','inherited controls display current base settings');
 await click('material-tab-noise');await ev(`(()=>{const groups=[...document.querySelectorAll('#material-stage-noise details')];groups.find(e=>e.querySelector('summary').textContent==='Fine grain').open=true;return true;})()`);
 await preview();const before=await ev(`document.getElementById('ground-preview').toDataURL()`);
 await ev(`document.querySelector('[data-layer-index="1"] .material-layer-visible').click();true`);await preview();assert.notEqual(await ev(`document.getElementById('ground-preview').toDataURL()`),before,'hiding grain changes the visible material');
 await click('material-undo');await preview();assert.equal(await ev(`document.getElementById('ground-preview').toDataURL()`),before,'undo restores the identical sample');
 await click('material-reset');assert.equal((await state()).grounds[0].knobs.patternSize,6.4);assert.equal((await state()).grounds[0].layers.length,3);await choose(1);await preview();
 const saved=await state();await ev(`sculptDebug.loadSketch(${JSON.stringify(saved)});true`);assert.deepEqual((await state()).grounds,saved.grounds,'component stack save/reload');await preview();
 await send('Page.captureScreenshot',{format:'png'}).then(r=>writeFileSync(out+'/editor.png',Buffer.from(r.result.data,'base64')));
 assert.equal((await state()).grounds.some(p=>p.worldGround||p.worldWater),false,'world assignments unchanged');assert.deepEqual(logs,[]);
 await click('material-done');console.log(JSON.stringify({presetLayers:counts,inheritance:true,visibleGrain:true,undoExact:true,reset:true,saveReload:true,worldAssignmentsUnchanged:true,errors:logs}));
});
