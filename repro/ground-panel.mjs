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

await session(`${server}/sculpt.html?biome=green&mapX=2&mapY=2&gpuMB=512`,port,async({send,ev,logs})=>{
 const set=(id,value,event='change')=>ev(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(String(value))};e.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));return true;})()`);
 const click=id=>ev(`document.getElementById(${JSON.stringify(id)}).click();true`);
 const state=()=>ev('sculptDebug.sketch()');
 await ready(ev);console.log('ready');
 await set('ground-add','bed');let saved=await state();assert.equal(saved.grounds.length,1);assert.equal(saved.grounds[0].name,'Cracked bed');
 assert.equal(await ev(`document.getElementById('ground-grainStretch').disabled`),true);
 assert.equal(await ev(`document.getElementById('ground-grainRelief').disabled`),true);
 await set('ground-grainFine',.6,'input');await set('ground-grainFine',.6);
 await set('ground-grainStretch',4,'input');await set('ground-grainStretch',4);
 await set('ground-grainDirection',37,'input');await set('ground-grainDirection',37);
 assert.equal((await state()).grounds[0].knobs.grainDirection,37);
 assert.equal(await ev(`document.getElementById('ground-grainRelief').disabled`),false);
 await set('ground-grainBroad',.7,'input');await set('ground-grainBroad',.7);
 assert.equal(await ev(`document.getElementById('ground-grainRelief').disabled`),false);
 await set('ground-grainRelief',2,'input');await set('ground-grainRelief',2);
 assert.equal((await state()).grounds[0].knobs.grainRelief,2);
 assert.equal(await ev(`document.getElementById('ground-grainColorMix').disabled`),true);
 await set('ground-variation-0','#ff0000','input');await set('ground-variation-0','#ff0000');
 assert.equal(await ev(`document.getElementById('ground-grainColorMix').disabled`),false);
 await set('ground-grainColorMix',.7,'input');await set('ground-grainColorMix',.7);
 assert.equal((await state()).grounds[0].knobs.grainColorMix,.7);
 await set('ground-plateAmount',5,'input');await set('ground-plateAmount',5);assert.equal((await state()).grounds[0].knobs.plateAmount,5);
 await click('undo');assert.equal((await state()).grounds[0].knobs.plateAmount,3.5);
 await click('redo');assert.equal((await state()).grounds[0].knobs.plateAmount,5);console.log('add/edit/undo/redo');
 await set('ground-name','Authored bed');await click('ground-rename');assert.equal((await state()).grounds[0].name,'Authored bed');
 await click('ground-duplicate');assert.equal((await state()).grounds.length,2);
 await click('ground-delete');assert.equal((await state()).grounds.length,1);
 // Select ground through the actual tool cards and draw one paint stroke and one landform.
 const stroke=async(tool,x)=>{
  await ev(`document.querySelector('[data-tool="${tool}"]').click();true`);
  if(tool==='paint')await set('paint-channel',26,'input');
  await set('lf-ground',1,'input');
  assert.equal(await ev(`document.getElementById('lf-ground-control').hidden`),false);
  const b=await ev(`(()=>{const b=document.getElementById('overlay').getBoundingClientRect();return{x:b.x+b.width*${x},y:b.y+b.height*.5};})()`);
  const mouse=(type,dx=0)=>send('Input.dispatchMouseEvent',{type,x:b.x+dx,y:b.y,button:'left',buttons:type==='mouseReleased'?0:1,clickCount:1});
  await mouse('mouseMoved');await mouse('mousePressed');await mouse('mouseMoved',40);await mouse('mouseReleased',40);await ev('sculptCanvas.idle()');
 };
 await stroke('paint',.4);assert.equal((await state()).nodes.at(-1).params.groundPreset,1);assert.equal((await state()).nodes.at(-1).params.paintChannel,26);
 await stroke('landform',.6);assert.equal((await state()).nodes.at(-1).params.groundPreset,1);console.log('paint and landform choices');
 saved=await state();await ev(`sculptDebug.loadSketch(${JSON.stringify(saved)});true`);assert.deepEqual((await state()).grounds,saved.grounds);
 await sleep(900);await send('Page.reload');await ready(ev);assert.deepEqual((await state()).grounds,saved.grounds);assert.equal((await state()).nodes.at(-1).params.groundPreset,1);console.log('save/reload');
 await click('tab-world');await click('wsec-ground');await set('ground-presets',1);
 await ev(`document.getElementById('ground-preview').scrollIntoView();true`);
 let count='';for(let i=0;i<100;i++){count=await ev(`document.getElementById('ground-preview-count').textContent`);if(count.includes('distinct')||count.includes('unavailable'))break;await sleep(200);}
 assert.match(count,/distinct tiles/);const picture=await ev(`document.getElementById('ground-preview').toDataURL()`);writeFileSync(`${out}/preview.png`,Buffer.from(picture.split(',')[1],'base64'));console.log(count);
 assert.deepEqual(logs,[]);writeFileSync(`${out}/report.json`,JSON.stringify({addEditUndoRedo:true,renameDuplicateDelete:true,paintAndLandform:true,saveReload:true,preview:count,consoleErrors:logs},null,2));
});
