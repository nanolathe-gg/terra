// Compare every authored field with four regional replays (sculpt-scene.js regionalCheck): under Node on Dawn (repro/headless.mjs, the default), or
// in an owned headless browser with --chrome.
//   node regional.mjs <scene.json> [--server http://127.0.0.1:8801] [--port 9450] [--chrome] [--configs DIR]
// Under Node the engine's files come from --server, or with no --server from this checkout (world configs from sculpt.py --dump-configs, or
// --configs DIR), and --port is not used. With --chrome the server defaults to the owner's (8801): pass your own.
import {cdpPortFree} from './cdp-port.mjs';
import {spawn} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const usage = 'Usage: node repro/regional.mjs <scene.json> [--server http://127.0.0.1:8801] [--port 9450] [--chrome] [--configs DIR]';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function argumentsFor(args) {
  const options = {server: 'http://127.0.0.1:8801', port: 9450, chrome: false, configs: ''}, seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') return null;
    if (arg === '--chrome') { options.chrome = true; continue; }
    if (arg === '--server' || arg === '--port' || arg === '--configs') {
      if (seen.has(arg) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Expected one value for ${arg}.\n${usage}`);
      seen.add(arg); options[arg.slice(2)] = args[++i];
    } else if (arg.startsWith('-') || options.sceneFile) throw new Error(`Unexpected argument ${arg}.\n${usage}`);
    else options.sceneFile = arg;
  }
  if (!options.sceneFile) throw new Error(usage);
  if (!/^\d+$/.test(String(options.port)) || !Number.isInteger(Number(options.port)) || Number(options.port) < 1 || Number(options.port) > 65535) throw new Error(`CDP port must be an integer from 1 to 65535.\n${usage}`);
  options.port = Number(options.port);
  let server;
  try { server = new URL(options.server); } catch { throw new Error(`Invalid server URL ${options.server}.\n${usage}`); }
  if (!['http:', 'https:'].includes(server.protocol) || server.search || server.hash) throw new Error(`Server must be an HTTP(S) base URL without a query or fragment.\n${usage}`);
  options.server = server.href.replace(/\/$/, '') + '/';
  options.serverGiven = seen.has('--server');
  return options;
}
async function freePort(port) {
  for (const host of ['127.0.0.1', '::1']) await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', error => {
      if (host === '::1' && ['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(error.code)) { resolve(); return; }
      reject(new Error(error.code === 'EADDRINUSE' ? `CDP port ${port} is already in use; choose another --port.` : `Cannot reserve CDP port ${port}: ${error.message}`));
    });
    probe.listen({port, host, exclusive: true}, () => probe.close(error => error ? reject(error) : resolve()));
  });
}
function openSocket(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url), timer = setTimeout(() => { ws.close(); reject(new Error('Chrome WebSocket did not open.')); }, 15000);
    ws.addEventListener('open', () => { clearTimeout(timer); resolve(ws); }, {once: true});
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Chrome WebSocket failed.')); }, {once: true});
    ws.addEventListener('close', () => { clearTimeout(timer); reject(new Error('Chrome WebSocket closed before opening.')); }, {once: true});
  });
}
function protocol(ws, errors) {
  let next = 0;
  const pending = new Map();
  const fail = message => { for (const q of pending.values()) { clearTimeout(q.timer); q.reject(new Error(message)); } pending.clear(); };
  ws.addEventListener('close', () => fail('Chrome WebSocket closed.'));
  ws.addEventListener('error', () => fail('Chrome WebSocket failed.'));
  ws.addEventListener('message', event => {
    let message;
    try { message = JSON.parse(event.data); } catch { fail('Chrome sent invalid protocol JSON.'); return; }
    if (message.id && pending.has(message.id)) {
      const q = pending.get(message.id); pending.delete(message.id); clearTimeout(q.timer);
      if (message.error) q.reject(new Error(`${q.method}: ${message.error.message}`)); else q.resolve(message.result);
    }
    if (errors.length < 20 && message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push('console: ' + message.params.args.map(a => a.value ?? a.description ?? a.type).join(' '));
    if (errors.length < 20 && message.method === 'Runtime.exceptionThrown') errors.push('exception: ' + (message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text));
  });
  return (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++next, timer = setTimeout(() => { pending.delete(id); reject(new Error(`Chrome command timed out: ${method}`)); }, 120000);
    pending.set(id, {method, resolve, reject, timer});
    try { ws.send(JSON.stringify({id, method, params, ...(sessionId ? {sessionId} : {})})); }
    catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
  });
}
function checkResult(result) {
  if (!result || !Number.isInteger(result.grid) || result.grid < 2 || !result.planes || Array.isArray(result.planes) || !Object.keys(result.planes).length || !Number.isSafeInteger(result.mismatches) || result.mismatches < 0) throw new Error('regionalCheck() returned an invalid report.');
  let total = 0;
  for (const [key, plane] of Object.entries(result.planes)) {
    if (!plane || !Number.isSafeInteger(plane.mismatches) || plane.mismatches < 0 || !Number.isFinite(plane.maxDifference) || plane.maxDifference < 0) throw new Error(`regionalCheck() returned an invalid plane: ${key}.`);
    total += plane.mismatches;
  }
  if (total !== result.mismatches) throw new Error('regionalCheck() mismatch total disagrees with its planes.');
}
async function main() {
  let options;
  try { options = argumentsFor(process.argv.slice(2)); }
  catch (error) { process.exitCode = 2; throw error; }
  if (!options) { console.log(usage); return; }
  const {sceneFile, server, port} = options;
  let scene;
  try { scene = JSON.parse(readFileSync(sceneFile, 'utf8')); }
  catch (error) { throw new Error(`Cannot read scene ${sceneFile}: ${error.message}`); }
  if (!scene || typeof scene !== 'object' || typeof scene.biome !== 'string' || !scene.biome.trim() || !Array.isArray(scene.strokes) || (scene.query !== undefined && typeof scene.query !== 'string')) throw new Error(`Invalid scene ${sceneFile}: expected biome, strokes and an optional query string.`);
  // H12b: the scene runs on a 4x4 map whose fields are paged (gpuPages=force), so the check reads the map's own regional fields.
  const page = new URLSearchParams({biome: scene.biome, scratch: '1', mapX: '4', mapY: '4', gpuPages: 'force', gpuMB: '512', heapMB: '1536'});
  for (const [key, value] of new URLSearchParams(scene.query || '')) page.append(key, value);
  if (!options.chrome) {
    const headless = await import('./headless.mjs');
    await headless.openHost({server: options.serverGiven ? server : '', configs: options.configs});
    const s = await headless.openScene(scene, page.toString());
    try {
      const result = await s.engine.regionalCheck({fields: s.fields, device: s.renderer.device, nodes: s.nodes, context: s.context(), config: s.config, grid: s.worldGrid, spacing: s.spacing, minH: s.minH, maxH: s.maxH});
      checkResult(result);
      if (s.errors.length) throw new Error(s.errors.slice(0, 20).join('\n'));
      console.log(JSON.stringify({scene: sceneFile, biome: scene.biome, nodes: s.nodes.length, ...result, host: 'node'}));
      if (result.mismatches) throw new Error(`${result.mismatches} regional field samples differ.`);
    } finally { s.dispose(); }
    return;
  }
  await freePort(port);
  const configURL = new URL(`config/${encodeURIComponent(scene.biome)}.json`, server);
  let response;
  try { response = await fetch(configURL, {signal: AbortSignal.timeout(10000)}); }
  catch (error) { throw new Error(`Cannot fetch config for world ${scene.biome}: ${error.message}`); }
  if (!response.ok) throw new Error(`${sceneFile}: world ${scene.biome} is not served (HTTP ${response.status}).`);
  const config = await response.json();
  if (config?.biomeId !== scene.biome) throw new Error(`${sceneFile}: asked for world ${scene.biome}, the server returned ${config?.biomeId}.`);
  const url = new URL('sculpt.html?' + page, server);
  let profile, chrome, ws, closed = false, chromeError, endpoint, stderr = '', cleanupPromise, exited;
  const cleanup = () => cleanupPromise ??= (async () => {
    ws?.close();
    const waitForExit = async ms => { let timer; try { await Promise.race([exited, new Promise(resolve => { timer = setTimeout(resolve, ms); })]); } finally { clearTimeout(timer); } };
    if (chrome?.pid && !closed) { chrome.kill('SIGTERM'); await waitForExit(3000); if (!closed) { chrome.kill('SIGKILL'); await waitForExit(3000); } }
    if (profile) rmSync(profile, {recursive: true, force: true, maxRetries: 3, retryDelay: 100});
  })();
  const interrupt = signal => { void cleanup().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143)); };
  const onInterrupt = () => interrupt('SIGINT'), onTerminate = () => interrupt('SIGTERM');
  process.once('SIGINT', onInterrupt); process.once('SIGTERM', onTerminate);
  try {
    profile = mkdtempSync(join(tmpdir(), 'nanolathe-regional-'));
    await cdpPortFree(port);
    chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--enable-gpu', '--use-angle=metal', '--remote-debugging-address=127.0.0.1',
      `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1500,1200', '--no-first-run', 'about:blank'], {stdio: ['ignore', 'ignore', 'pipe']});
    exited = new Promise(resolve => chrome.once('close', () => { closed = true; resolve(); }));
    chrome.once('error', error => { chromeError = error; });
    chrome.stderr.on('data', data => { stderr = (stderr + data).slice(-8192); endpoint = stderr.match(/DevTools listening on (ws:\/\/\S+)/)?.[1] || endpoint; });
    for (let i = 0; i < 75 && !endpoint; i++) {
      if (chromeError) throw new Error(`Cannot start Chrome: ${chromeError.message}`);
      if (closed) throw new Error(`Chrome exited before opening CDP. ${stderr.trim()}`);
      await sleep(200);
    }
    if (!endpoint) throw new Error(`Chrome did not open CDP on port ${port}. ${stderr.trim()}`);
    if (new URL(endpoint).port !== String(port)) throw new Error('Owned Chrome opened an unexpected CDP port.');
    // Connect only to the browser endpoint announced by this child, then make
    // our own target. Never discover or attach a tab from an existing browser.
    ws = await openSocket(endpoint);
    const errors = [], send = protocol(ws, errors);
    const {targetId} = await send('Target.createTarget', {url: 'about:blank'});
    const {sessionId} = await send('Target.attachToTarget', {targetId, flatten: true});
    const page = (method, params) => send(method, params, sessionId);
    const evaluate = async expression => {
      const result = await page('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result?.value;
    };
    const checkErrors = () => { if (errors.length) throw new Error(errors.slice(0, 20).join('\n')); };
    const ready = async label => {
      for (let i = 0; i < 480; i++) {
        checkErrors();
        // A Zhon map cannot export (by design): its editor being enabled stands in for the export button.
        const state = await evaluate(`(() => { const button=document.getElementById('map-export'), ready=Boolean(window.sculptCanvas&&window.sculptDebug&&((button&&!button.disabled)||(${scene.biome==='zhon'}&&!document.getElementById('editor')?.disabled))); return {ready,running:false,error:document.getElementById('error')?.textContent?.trim()||''}; })()`);
        if (state.error) throw new Error(`Editor error: ${state.error}`);
        if (state.ready && !state.running) { checkErrors(); return; }
        await sleep(250);
      }
      throw new Error(`${label} did not finish within 120 seconds.`);
    };
    await page('Runtime.enable'); await page('Page.enable'); await page('Page.navigate', {url: url.href});
    await ready('Editor startup');
    const loadedBiome = await evaluate('sculptDebug.biome');
    if (loadedBiome !== scene.biome) throw new Error(`Page loaded world ${loadedBiome}, scene asks for ${scene.biome}.`);
    const nodes = await evaluate(`sculptDebug.scene(${JSON.stringify(scene.strokes)}, {ground:${scene.ground !== false}})`);
    await ready('Scene');
    const result = await evaluate(`(() => { if(typeof sculptDebug.regionalCheck!=='function')throw new Error('This editor does not expose sculptDebug.regionalCheck().'); return sculptDebug.regionalCheck(); })()`);
    checkResult(result); await sleep(0); checkErrors();
    console.log(JSON.stringify({scene: sceneFile, biome: scene.biome, nodes, ...result, host: 'chrome'}));
    if (result.mismatches) throw new Error(`${result.mismatches} regional field samples differ.`);
  } finally {
    try { await cleanup(); } finally { process.removeListener('SIGINT', onInterrupt); process.removeListener('SIGTERM', onTerminate); }
  }
}
main().catch(error => { console.error(`regional.mjs: ${error.message}`); process.exitCode ||= 1; });
