// Exercise column variants, validation, history, and their effect on a render.
// node repro/column-ui.mjs --server http://127.0.0.1:8956 --port 9694
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
  await page('Page.navigate', {url: server + '/sculpt?biome=desert&variant=triad&scratch=1&weatheredView=0'});
  let ready = false;
  for (let i = 0; i < 600; i++) {
    await sleep(100);
    if (await evaluate(`!!window.sculptDebug && !!document.querySelector('#column-panel [data-column-path]')`)) { ready = true; break; }
  }
  if (!ready) throw new Error('Column editor did not become ready');
  const interactions = await evaluate(`(() => {
    const assert = (v, message) => { if (!v) throw new Error(message); };
    const find = path => document.querySelector('[data-column-path="' + path + '"]');
    const edit = (input, value) => { input.focus(); input.value = value; input.dispatchEvent(new Event('input', {bubbles:true})); input.dispatchEvent(new Event('change', {bubbles:true})); };
    const panel = document.querySelector('#column-panel'), sections = panel.querySelectorAll('.column-section');
    assert(!panel.hidden && sections.length === 4, 'Expected four variant sections');
    assert(panel.textContent.includes('Column row:'), 'Variant label missing');
    const thickness = find('variants.triad.sections.0.beds.0.0'), hardness = find('variants.triad.sections.0.beds.0.1'), slot = find('variants.triad.sections.0.beds.0.2');
    assert(Number(thickness.value) === 3 && thickness.getAttribute('aria-label') === 'Section 1, bed 1 thickness', 'Variant bed control');
    assert(slot.tagName === 'SELECT' && slot.options.length === 5, 'Material slot control');
    edit(thickness, '3.25'); let sketch = sculptDebug.sketch();
    assert(sketch.column.variants.triad.sections[0].beds[0][0] === 3.25 && sketch.column.sections[0].beds[0][0] === 4.8, 'Variant edit changed wrong row');
    assert(!panel.querySelector('button').disabled, 'Restore did not enable');
    hardness.focus(); hardness.value = '2'; hardness.dispatchEvent(new Event('input', {bubbles:true}));
    assert(!hardness.checkValidity() && sculptDebug.sketch().column.variants.triad.sections[0].beds[0][1] === .5, 'Invalid hardness mutated the column');
    hardness.dispatchEvent(new Event('change', {bubbles:true}));
    assert(Number(hardness.value) === .5 && hardness.checkValidity(), 'Invalid value was not reset');
    edit(slot, '2'); assert(sculptDebug.sketch().column.variants.triad.sections[0].beds[0][2] === 2, 'Material slot edit');
    const color = find('colors.0'); assert(color.type === 'color', 'Slot color input'); edit(color, '#123456');
    assert(JSON.stringify(sculptDebug.sketch().column.colors[0]) === '[18,52,86]', 'Slot color edit');
    const origin = find('origin'); assert(origin.tagName === 'SELECT', 'Origin selector'); edit(origin, 'sea');
    assert(sculptDebug.sketch().column.origin === 'sea', 'Origin edit');
    edit(find('variants.triad.bands.0'), '4.5'); assert(sculptDebug.sketch().column.variants.triad.bands[0] === 4.5, 'Band edit');
    panel.querySelector('button').click();
    assert(sculptDebug.sketch().column.variants.triad.sections[0].beds[0][0] === 3 && panel.querySelector('button').disabled, 'Restore column');
    document.querySelector('#undo').click(); assert(sculptDebug.sketch().column.variants.triad.bands[0] === 4.5, 'Undo restore');
    document.querySelector('#redo').click(); assert(sculptDebug.sketch().column.variants.triad.bands[0] === 4, 'Redo restore');
    return {sections:sections.length, beds:panel.querySelectorAll('tbody tr').length, slotChoices:slot.options.length, colorInputs:panel.querySelectorAll('input[type=color]').length};
  })()`);
  const visual = await evaluate(`(async () => {
    const edit = (input, value) => { input.value = value; input.dispatchEvent(new Event('input', {bubbles:true})); input.dispatchEvent(new Event('change', {bubbles:true})); };
    const strata = document.getElementById('knob-strata'); if (strata) edit(strata, strata.max);
    sculptDebug.scene([['plateau', [[128,128]], {card:{diameter:200,amount:90}}]], {ground:false}); await sculptCanvas.idle();
    const pixels = async () => { const canvas = await sculptCanvas.debugBake({x:0,y:0,width:256,height:256}, 1); return canvas.getContext('2d').getImageData(0,0,256,256).data; };
    const before = await pixels();
    for (let i=0; i<5; i++) edit(document.querySelector('[data-column-path="colors.'+i+'"]'), i%2 ? '#000000' : '#ffffff');
    await sculptCanvas.idle(); const after = await pixels(); let changed = 0;
    for (let i=0; i<before.length; i+=4) if (before[i]!==after[i] || before[i+1]!==after[i+1] || before[i+2]!==after[i+2]) changed++;
    return {changed, total:before.length/4};
  })()`);
  if (!visual.changed) throw new Error('Column colors did not change the rendered terrain');
  console.log(JSON.stringify({interactions, visual}));
  ws.close();
} finally {
  chrome.kill('SIGTERM');
}
