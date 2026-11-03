// Exercise cancellation while the export helper is starting, accepting a chunk,
// and assembling its output. Requires built web WASM; uses no retail assets.
import {spawn, execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, existsSync, unlinkSync, readdirSync, chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {cdpPortFree} from './cdp-port.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const port = Number(opt('--port', 9697)), serverPort = Number(opt('--server-port', 8899));
const sleep = ms => new Promise(r => setTimeout(r, ms));
await cdpPortFree(port);
await cdpPortFree(serverPort);
const root = mkdtempSync(join(tmpdir(), 'terraform-cancel-test-'));
const assets = join(root, 'assets'), jobs = join(root, 'jobs'), helper = join(root, 'helper'), binary = join(root, 'server');
mkdirSync(assets); mkdirSync(jobs);
writeFileSync(helper, `#!/usr/bin/env node
const fs=require('fs'),readline=require('readline');
const root=process.env.TERRAFORM_CANCEL_TEST_ROOT,mode=fs.readFileSync(root+'/mode','utf8').trim();
const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');
if(mode==='start'){fs.writeFileSync(root+'/reached','start');setTimeout(()=>send({ready:true,width:544,height:640,maxChunkSide:512}),30000)}else send({ready:true,width:544,height:640,maxChunkSide:512});
readline.createInterface({input:process.stdin}).on('line',l=>{const v=JSON.parse(l);if(v.op===mode){fs.writeFileSync(root+'/reached',mode);setTimeout(()=>send(v.op==='finish'?{archive:'fake.ufo'}:{accepted:true}),30000)}else if(v.op==='chunk')send({accepted:true});else if(v.op==='finish')send({archive:'fake.ufo'})});
`);
chmodSync(helper, 0o700);
execFileSync('go', ['build', '-o', binary, './cmd/terraform'], {stdio: 'inherit'});
const server = spawn(binary, ['--port', String(serverPort), '--source-root', resolve('.'), '--assets-root', assets, '--export-tool', helper, '--prepared'], {env: {...process.env, TMPDIR: jobs, TERRAFORM_CANCEL_TEST_ROOT: root}, stdio: 'ignore'});
let chrome;
try {
  const url = `http://127.0.0.1:${serverPort}`;
  let serverReady = false;
  for (let i = 0; i < 100 && !serverReady; i++) { try { serverReady = (await fetch(url + '/sculpt')).ok; } catch {} if (!serverReady) await sleep(100); }
  if (!serverReady) throw new Error('test server did not start');
  chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--enable-gpu', '--use-angle=metal', `--remote-debugging-port=${port}`, `--user-data-dir=${root}/chrome`, '--window-size=1700,1300', '--no-first-run', 'about:blank'], {stdio: 'ignore'});
  let page;
  for (let i = 0; i < 100 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(x => x.type === 'page'); } catch {} if (!page) await sleep(200); }
  if (!page) throw new Error('Chrome did not start');
  const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const pending = new Map(), logs = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') logs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push(m.params.args.map(a => a.value ?? a.description).join(' ')); };
  const send = (method, params = {}) => new Promise(r => { const k = ++id; pending.set(k, r); ws.send(JSON.stringify({id: k, method, params})); });
  const ev = async expression => { const r = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true}); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result?.result?.value; };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {width: 1700, height: 1300, deviceScaleFactor: 1, mobile: false});
  await send('Page.navigate', {url: `${url}/sculpt?biome=green&mapX=1&mapY=1&scratch=cancel-test&gpuMB=512`});
  let ready = false;
  for (let i = 0; i < 600; i++) { if (await ev(`!!window.sculptCanvas && !document.getElementById('map-export')?.disabled`)) { ready = true; break; } await sleep(300); }
  if (!ready) throw new Error('editor did not become ready');
  await ev('sculptCanvas.idle()');
  const results = [];
  for (const mode of ['start', 'chunk', 'finish']) {
    try { unlinkSync(join(root, 'reached')); } catch {}
    writeFileSync(join(root, 'mode'), mode);
    await ev(`document.getElementById('map-export').click();true`);
    let reached = false;
    for (let i = 0; i < 1200; i++) { if (existsSync(join(root, 'reached'))) { reached = true; break; } await sleep(250); }
    if (!reached) throw new Error(`${mode} stage did not start`);
    const start = Date.now();
    await ev(`document.getElementById('map-cancel').click();true`);
    let state;
    for (let i = 0; i < 120; i++) { state = await ev(`({busy:document.getElementById('editor').disabled,status:document.getElementById('map-export-state').textContent,cancelHidden:document.getElementById('map-cancel').hidden})`); if (!state.busy && state.cancelHidden) break; await sleep(250); }
    if (state.busy || !state.cancelHidden) throw new Error(`${mode} cancellation blocked: ${JSON.stringify(state)}`);
    await sleep(1000);
    const leftovers = readdirSync(jobs);
    if (leftovers.length) throw new Error(`${mode} retained temporary jobs: ${leftovers.join(', ')}`);
    results.push({mode, millisecondsIncludingCleanupWait: Date.now() - start, status: state.status});
  }
  if (logs.length) throw new Error('browser errors: ' + logs.join('; '));
  console.log(JSON.stringify({results, consoleErrors: logs.length}));
} finally {
  chrome?.kill();
  server.kill('SIGTERM');
}
