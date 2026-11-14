// Sustained material scrub regression: the draw cycle must bound GPU submissions.
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
 await ready(ev);
 await ev(`document.getElementById('tab-world').click();document.getElementById('wsec-ground').click();document.getElementById('material-open').click();true`);
 const set=(id,value)=>ev(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(String(value))};e.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
 await set('ground-add','rust-mottling');await set('ground-world-default',1);await ev('sculptCanvas.idle()');await ev(`document.getElementById('material-tab-phase').click();true`);
 const initial=await ev(`Number(document.getElementById('ground-patternWarp').value)`);
 await ev(`(()=>{window.dragStats={submitted:0,pending:0,peak:0,lost:[]};const queue=sculptCanvas.renderer.device.queue;const submit=queue.submit.bind(queue);queue.submit=b=>{submit(b);dragStats.submitted++;dragStats.pending++;dragStats.peak=Math.max(dragStats.peak,dragStats.pending);queue.onSubmittedWorkDone().then(()=>dragStats.pending--,e=>{dragStats.pending--;dragStats.lost.push(String(e));});};sculptCanvas.renderer.device.lost.then(info=>dragStats.lost.push(info.message));document.querySelector('.scrub[data-source="ground-patternWarp"]').closest('details').open=true;document.querySelector('.scrub[data-source="ground-patternWarp"]').scrollIntoView({block:'center'});return true;})()`);
 const point=await ev(`(()=>{const r=document.querySelector('.scrub[data-source="ground-patternWarp"]').getBoundingClientRect();return {x:r.x+20,y:r.y+r.height/2};})()`);
 await send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',buttons:1,clickCount:1});
 for(let i=0;i<120;i++){await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x+(i<60?i:120-i)*3,y:point.y,button:'left',buttons:1});await sleep(8);}
 await send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',buttons:0,clickCount:1});
 const during=await ev('dragStats');writeFileSync(`${out}/during.json`,JSON.stringify({during,logs},null,2));console.log(JSON.stringify({during,logs}));
 await ev('sculptCanvas.idle()');await sleep(1500);
 const stats=await ev('dragStats');assert.ok(stats.submitted>0,'the drag must actually change a rendered material');assert.ok(stats.peak<20,'material inputs must not flood the GPU queue');
 const final=await ev(`({shown:Number(document.getElementById('ground-patternWarp').value),rendered:sculptCanvas.renderer.grounds.get(1).knobs.patternWarp})`);assert.equal(final.rendered,final.shown,'the final slider value reaches the renderer');assert.notEqual(final.shown,initial,'the pointer gesture changes the control');const error=await ev(`document.getElementById('error')?.textContent`);const note=await ev(`document.getElementById('ground-preview-count').textContent`);
 writeFileSync(`${out}/report.json`,JSON.stringify({stats,final,error,note,logs},null,2));console.log(JSON.stringify({stats,final,error,note,logs}));
 assert.deepEqual(stats.lost,[]);assert.deepEqual(logs,[]);assert.ok(!error);assert.ok(!note.includes('unavailable'));
});
