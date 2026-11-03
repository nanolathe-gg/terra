// Verify feature depth order, shadow alpha, anchor projection, and outlines.
// node repro/feature-draw.mjs --server http://127.0.0.1:8956 --port 9694
import {spawn} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const server = opt('--server', 'http://127.0.0.1:8956').replace(/\/$/, '');
const port = Number(opt('--port', '9694'));
const profile = mkdtempSync(join(tmpdir(), 'terraform-column-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--enable-gpu', '--use-angle=metal', `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`, '--window-size=1500,1200', '--no-first-run', 'about:blank',
], {stdio: ['ignore', 'ignore', 'pipe']});
let stderr = '', endpoint;
chrome.stderr.on('data', data => { stderr += data; endpoint = stderr.match(/DevTools listening on (ws:\/\/\S+)/)?.[1]; });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  for (let i = 0; i < 150 && !endpoint; i++) await sleep(200);
  if (!endpoint) throw new Error('Chrome did not open CDP: ' + stderr);
  if (Number(new URL(endpoint).port) !== port) throw new Error('Chrome opened an unexpected CDP port');
  const ws = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = event => {
    const message = JSON.parse(event.data), pair = pending.get(message.id);
    if (!pair) return;
    pending.delete(message.id);
    message.error ? pair[1](new Error(message.error.message)) : pair[0](message.result);
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const n = ++id; pending.set(n, [resolve, reject]);
    ws.send(JSON.stringify({id: n, method, params, ...(sessionId ? {sessionId} : {})}));
  });
  const {targetId} = await send('Target.createTarget', {url: 'about:blank'});
  const {sessionId} = await send('Target.attachToTarget', {targetId, flatten: true});
  const page = (method, params = {}) => send(method, params, sessionId);
  const evaluate = async expression => {
    const result = await page('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result?.value;
  };
  await page('Runtime.enable'); await page('Page.enable');
  await page('Page.navigate', {url: server + '/sculpt?biome=green&scratch=1&weatheredView=0'});
  let ready = false;
  for (let i = 0; i < 900; i++) {
    await sleep(100);
    if (await evaluate(`!!window.sculptDebug && !!document.querySelector('#feature-tool') && !document.querySelector('#feature-tool').disabled`)) { ready = true; break; }
  }
  if (!ready) throw new Error('Feature editor did not become ready');
  const data = await evaluate(`(async () => {
    await sculptCanvas.idle(); const sketch = sculptDebug.sketch();
    sketch.mapData.features = [{name:'Tree2',x:20,z:30}, {name:'Tree3',x:10,z:10}];
    sculptDebug.loadSketch(sketch); await sculptCanvas.idle(); await new Promise(r => setTimeout(r,1500));
    const proto = CanvasRenderingContext2D.prototype, draw = proto.drawImage, stroke = proto.stroke;
    window.__featureCalls = []; window.__featureStrokes = [];
    proto.drawImage = function(image, ...args) {
      if (image instanceof HTMLImageElement && image.src.includes('/map-features/')) window.__featureCalls.push({url:image.src,alpha:this.globalAlpha,smooth:this.imageSmoothingEnabled,args});
      return draw.call(this, image, ...args);
    };
    proto.stroke = function(...args) { window.__featureStrokes.push(this.strokeStyle); return stroke.call(this, ...args); };
    document.getElementById('overlay').dispatchEvent(new PointerEvent('pointerleave', {bubbles:true}));
    return {calls:window.__featureCalls,strokes:window.__featureStrokes,view:sculptCanvas.view(),base:sculptDebug.base,
      corners:[[10,10],[20,30]].map(([x,z]) => [[x,z],[x+1,z],[x,z+1],[x+1,z+1]].map(([a,b]) => sculptDebug.corner(a*16,b*16).eroded)),
      count:sculptDebug.sketch().mapData.features.length};
  })()`);
  const response = await fetch(server + '/map-features/green/catalog.json');
  if (!response.ok) throw new Error('Feature catalogue unavailable');
  const catalog = await response.json(), byName = name => catalog.features.find(entry => entry.name === name);
  const first = byName('Tree3'), second = byName('Tree2');
  if (!first?.shadow || !first.sprite || !second?.shadow || !second.sprite) throw new Error('Expected prepared tree sprites and shadows');
  const urls = [first.shadow.url, first.sprite.url, second.shadow.url, second.sprite.url];
  if (data.calls.length !== 4) throw new Error('Expected four sprite and shadow draws: ' + JSON.stringify(data.calls));
  for (let i = 0; i < 4; i++) {
    const call = data.calls[i], definition = i < 2 ? first : second, position = i < 2 ? [10,10] : [20,30], sprite = i%2 === 0 ? definition.shadow : definition.sprite;
    if (!call.url.endsWith(urls[i]) || call.smooth !== false || call.alpha !== (i%2 === 0 ? .5 : 1)) throw new Error('Wrong sprite order or transparency: ' + JSON.stringify(data.calls));
    const sum = data.corners[i < 2 ? 0 : 1].reduce((a,h) => a + Math.round(Math.max(0,Math.min(255,h))), 0);
    const x = position[0]*16 + definition.footprintX*8, y = position[1]*16 + definition.footprintZ*8 - (sum >> 3) + data.base/2;
    const expectedX = (Math.floor(x)-sprite.xOffset-data.view.x)*data.view.scale, expectedY = (Math.floor(y)-sprite.yOffset-data.view.y)*data.view.scale;
    if (Math.abs(call.args[0]-expectedX)>1e-6 || Math.abs(call.args[1]-expectedY)>1e-6) throw new Error('Sprite anchor differs from four-corner height projection');
  }
  if (data.strokes.includes('#73e59c')) throw new Error('Unselected feature footprints should not be outlined');
  const point = await evaluate(`(() => {
    document.getElementById('feature-tool').click();
    const button = [...document.querySelectorAll('[data-feature-list] button')].find(x => x.textContent.startsWith('Tree2 ·'));
    if (!button) throw new Error('Tree2 missing'); button.click(); window.__featureStrokes = [];
    const view = sculptCanvas.view(), rect = document.getElementById('overlay').getBoundingClientRect(), x=20*16+8, z=30*16+8, h=sculptDebug.corner(x,z).eroded;
    return {x:rect.left+(x-view.x)*view.scale,y:rect.top+(z-(Math.max(sculptDebug.sea,h)-sculptDebug.base)/2-view.y)*view.scale};
  })()`);
  await page('Input.dispatchMouseEvent', {type:'mouseMoved', x:point.x, y:point.y});
  if (!await evaluate(`window.__featureStrokes.includes('#ff877e')`)) throw new Error('Overlapping hover footprint missing');
  await page('Input.dispatchMouseEvent', {type:'mousePressed', x:point.x, y:point.y, button:'left', buttons:1, clickCount:1});
  await page('Input.dispatchMouseEvent', {type:'mouseReleased', x:point.x, y:point.y, button:'left', buttons:0, clickCount:1});
  if (!await evaluate(`window.__featureStrokes.includes('#ffe69c')`)) throw new Error('Selected footprint missing');
  console.log(JSON.stringify({features:data.count,draws:data.calls.length,order:['Tree3 shadow','Tree3 sprite','Tree2 shadow','Tree2 sprite'],alpha:data.calls.map(call=>call.alpha),pixelated:true,anchor:true,hovered:true,selected:true}));
  ws.close();
} finally {
  chrome.kill('SIGTERM');
}
