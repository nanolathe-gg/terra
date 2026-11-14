// Focused Ground panel and selection check; no scene or full editor suite.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {cdpPortFree} from './cdp-port.mjs';
const args=process.argv.slice(2),opt=(key,fallback)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1];};
const server=opt('--server','http://127.0.0.1:8991'),port=Number(opt('--port','9781')),out=opt('--out','/private/tmp/ground-panel');
mkdirSync(out,{recursive:true});const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function session(url, port, fn) {
  const logs = [];
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
      if (m.method === 'Runtime.exceptionThrown') logs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push(m.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 300));
    };
    const send = (method, params = {}) => new Promise(r => { const k = ++id; wait.set(k, r); ws.send(JSON.stringify({id: k, method, params})); });
    const ev = async expression => { const r = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true}); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text); return r.result.result.value; };
    await send('Runtime.enable'); await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', {width: 1700, height: 1300, deviceScaleFactor: 1, mobile: false});
    await send('Page.navigate', {url});
    return await fn({send, ev, logs});
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
 const set=(id,value,event='change')=>ev(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(String(value))};e.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));return true;})()`);
 const click=id=>ev(`document.getElementById(${JSON.stringify(id)}).click();true`);
 const state=()=>ev('sculptDebug.sketch()');
 const preview=async()=>{await ev(`document.getElementById('ground-preview').scrollIntoView();true`);for(let i=0;i<120;i++){const text=await ev(`document.getElementById('ground-preview-count').textContent`);if(text.includes('unavailable'))throw Error(text);if(text.includes('distinct'))return text;await sleep(200);}throw Error('preview timed out');};
 await ready(ev);await click('tab-world');await click('wsec-ground');
 await set('ground-add','violet-rippled-water');let saved=await state();assert.equal(saved.grounds.length,1);assert.ok(saved.grounds[0].textureColors.low[0]%1,'fractional RGB preserved');assert.equal(await ev(`document.getElementById('texture-color-low').value`),'#2d275c');assert.ok((await ev(`document.getElementById('texture-palette').value`)).length>20);
 await set('water-material',1);await click('water-material-edit');await preview();
 assert.equal((await state()).grounds[0].worldWater,true);assert.equal(await ev(`document.getElementById('ground-presets').value`),'1');
 const old=(await state()).grounds[0].knobs.patternWarp;await set('ground-patternWarp',2.5,'input');await set('ground-patternWarp',2.5);assert.equal((await state()).grounds[0].knobs.patternWarp,2.5);
 await click('undo');assert.equal((await state()).grounds[0].knobs.patternWarp,old);await click('redo');assert.equal((await state()).grounds[0].knobs.patternWarp,2.5);
 await set('texture-color-high','#5a9ed2','input');await set('texture-color-high','#5a9ed2');assert.deepEqual((await state()).grounds[0].textureColors.high,[90,158,210]);
 await set('ground-add','rust-mottling');await set('ground-world-default',2);saved=await state();assert.equal(saved.grounds[1].worldGround,true);assert.equal(saved.grounds[0].worldWater,true);
 assert.deepEqual(saved.worldSettings.grounds,saved.grounds,'embedded world saves materials');
 await ev(`sculptDebug.scene([['deep',[[256,256],[768,256]],{card:{diameter:400}}]],{ground:false});true`);await ev('sculptCanvas.idle()');
 saved=await state();await ev(`sculptDebug.loadSketch(${JSON.stringify(saved)});true`);assert.deepEqual((await state()).grounds,saved.grounds);
 console.log('texture controls, assignments and direct save round-trip passed');await sleep(900);await send('Page.reload');await ready(ev);assert.deepEqual((await state()).grounds,saved.grounds);
 await click('tab-world');await click('wsec-water-shores');assert.equal(await ev(`document.getElementById('water-material').value`),'1');await click('water-material-edit');const count=await preview();assert.equal(await ev(`document.getElementById('texture-color-high').value`),'#5a9ed2');
 const picture=await ev(`document.getElementById('ground-preview').toDataURL()`);writeFileSync(`${out}/water-preview.png`,Buffer.from(picture.split(',')[1],'base64'));
 await ev(`for(const d of document.querySelectorAll('#ground-recipe-fields>details'))d.open=['Pattern','Pattern colors','Marks'].includes(d.querySelector('summary').textContent);document.getElementById('ground-recipe-fields').scrollIntoView();true`);await sleep(500);
 const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(`${out}/editor.png`,Buffer.from(shot.result.data,'base64'));
 await set('ground-presets',2);await click('ground-delete');assert.equal((await state()).grounds.some(g=>g.worldGround),false);assert.equal((await state()).grounds[0].worldWater,true);
 assert.deepEqual(logs,[]);writeFileSync(`${out}/report.json`,JSON.stringify({continuousColors:true,waterAssignment:true,groundAssignment:true,undoRedo:true,saveReload:true,embeddedWorld:true,deleteAssignment:true,preview:count,consoleErrors:logs},null,2));console.log('texture UI: controls, assignments, undo, save/reload, embedded world and preview passed');
});
