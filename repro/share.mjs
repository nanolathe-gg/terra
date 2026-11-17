// Share-link check in a real browser: share a map, open the link in a fresh profile, confirm the map is the same, restore the visitor's own map.
//   node repro/share.mjs --server http://127.0.0.1:8851 [--port 9751] [--out dir] [--entry /index.html] [--admin-token-file path]
// --server is where the page is served (the dev server, or a static build on localhost); the page's own services.json says which save-link
// service it uses. With --admin-token-file the ids this run created are deleted from that service afterwards (the token is never printed).
// Writes screenshots to --out and prints one JSON line. Exit 1 on any failed check or console error.
import {chromePath, chromeGpuFlags} from './chrome.mjs';
import {cdpPortFree} from './cdp-port.mjs';
import {spawn} from 'node:child_process';
import {mkdirSync, writeFileSync, readFileSync} from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : fallback; };
const server = opt('--server', ''), port = Number(opt('--port', 0)), out = opt('--out', 'share-out'), entry = opt('--entry', '/index.html'), tokenFile = opt('--admin-token-file', '');
if (!server || !port) { console.error('Pass --server and --port (this script never defaults to the owner\'s editor).'); process.exit(2); }
mkdirSync(out, {recursive: true});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const logs = [], checks = {};
const check = (name, ok, detail = '') => { checks[name] = ok ? 'ok' : 'FAILED ' + detail; };

async function session(fn) {
  await cdpPortFree(port);
  const chrome = spawn(chromePath, ['--headless=new', ...chromeGpuFlags, `--remote-debugging-port=${port}`,
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
    const ev = async expression => { const r = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true}); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text); return r.result?.result?.value; };
    await send('Runtime.enable'); await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', {width: 1700, height: 1300, deviceScaleFactor: 1, mobile: false});
    const shot = async name => writeFileSync(`${out}/${name}.png`, Buffer.from((await send('Page.captureScreenshot', {format: 'png'})).result.data, 'base64'));
    const open = async url => {
      await ev('window.__old=1;true').catch(() => {});
      await send('Page.navigate', {url});
      for (let i = 0; i < 100 && await ev('window.__old===1').catch(() => true); i++) await sleep(100);
      for (let i = 0; i < 600; i++) {
        if (await ev(`!!window.sculptCanvas && !document.getElementById('editor').disabled`).catch(() => false)) { await ev('sculptCanvas.idle()'); await sleep(1200); return; }
        await sleep(300);
      }
      throw new Error('the editor never became ready: ' + await ev(`document.getElementById('error')?.textContent`));
    };
    return await fn({send, ev, shot, open});
  } finally { chrome.kill(); await sleep(600); }
}
const stroke = async (send, ev, tool, x0 = 700, y0 = 650) => {
  await ev(`document.querySelector('[data-tool="${tool}"]').click(); true`);
  const m = (type, x, y) => send('Input.dispatchMouseEvent', {type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1});
  await send('Input.dispatchMouseEvent', {type: 'mouseMoved', x: x0, y: y0}); await m('mousePressed', x0, y0);
  for (const [dx, dy] of [[0, 0], [60, 20], [120, 30], [180, 10], [240, 0]]) { await m('mouseMoved', x0 + dx, y0 + dy); await sleep(30); }
  await m('mouseReleased', x0 + 240, y0); await ev('sculptCanvas.idle()');
};
const sketchJson = ev => ev('JSON.stringify(sculptRegion.sketch())');
const canon = v => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => [k, canon(v[k])])) : v;
// A drawn stroke has no `hidden`, a loaded one has false; key order differs; compare the strokes by content.
const strokes = json => JSON.parse(json).nodes.map(n => canon({...n, hidden: Boolean(n.hidden)}));
const nodesOf = json => JSON.stringify(strokes(json));
const differs = (a, b) => { const x = strokes(a), y = strokes(b); if (x.length !== y.length) return `${x.length} vs ${y.length} strokes`; for (let i = 0; i < x.length; i++) for (const k of new Set([...Object.keys(x[i]), ...Object.keys(y[i])])) if (JSON.stringify(x[i][k]) !== JSON.stringify(y[i][k])) return `stroke ${i}.${k}: ${JSON.stringify(x[i][k])?.slice(0, 80)} vs ${JSON.stringify(y[i][k])?.slice(0, 80)}`; return ''; };

// Sharing and the previous-map notice both live in the Map menu. Start each share
// from a known closed state so the details toggle fires exactly one new request.
const openShare=async ev=>{
  await ev(`if(document.getElementById('pane-map').hidden)document.getElementById('tab-map').click();document.getElementById('share-menu').open=false;true`);await sleep(100);
  await ev(`document.getElementById('share-result').hidden=true;document.getElementById('share-url').value='';document.getElementById('share-menu').open=true;true`);
};
const openMap=ev=>ev(`if(document.getElementById('pane-map').hidden)document.getElementById('tab-map').click();true`);
const page = `${server}${entry}`;
let link = '', sharedJson = '', ownJson = '', mapsUrl = '';
await session(async ({send, ev, shot, open}) => {
  await open(page);
  mapsUrl = await ev(`fetch('services.json').then(r=>r.json()).then(s=>s.maps?.url||'')`);
  await stroke(send, ev, 'hill');
  sharedJson = await sketchJson(ev);
  await openShare(ev);
  for (let i = 0; i < 100 && !await ev(`document.getElementById('share-url').value`); i++) await sleep(200);
  link = await ev(`document.getElementById('share-url').value`);
  await shot('1-share-link');
  check('link is page?map=id', /[?&]map=[a-z2-7]{16}$/.test(link), link);
  // The same map shared again gives the same link.
  await openShare(ev);
  for (let i = 0; i < 100 && await ev(`document.getElementById('share-result').hidden`); i++) await sleep(200);
  check('same map, same link', await ev(`document.getElementById('share-url').value`) === link);
  const copied = await ev(`document.getElementById('share-copy').click(); new Promise(r=>setTimeout(()=>r(document.getElementById('share-message').textContent),500))`);
  check('copy gives feedback', /copied|Ctrl/.test(copied), copied);
});
await session(async ({send, ev, shot, open}) => {
  await open(page + (page.includes('?') ? '&' : '?') + 'mapX=4&mapY=4');
  await stroke(send, ev, 'mountain', 600, 800);
  ownJson = await sketchJson(ev); await sleep(1200);
  check('own map differs from shared', nodesOf(ownJson) !== nodesOf(sharedJson));
  // A link that does not exist leaves the map alone and says so.
  const bad = link.replace(/map=.*/, 'map=aaaaaaaaaaaaaaaa');
  await open(bad);
  check('unknown link says so', /No saved map has this link/.test(await ev(`document.getElementById('error').textContent`)));
  { const now = await sketchJson(ev); check('unknown link leaves own map', nodesOf(now) === nodesOf(ownJson), differs(ownJson, now)); }
  await shot('2-unknown-link');
  await open(link);
  { const now = await sketchJson(ev); check('shared map is the same', nodesOf(now) === nodesOf(sharedJson), differs(sharedJson, now)); }
  // Sharing the loaded map again gives the same link from its Export home.
  await openShare(ev);
  for (let i = 0; i < 100 && !await ev(`document.getElementById('share-url').value`); i++) await sleep(200);
  check('share, open, share again: same link', await ev(`document.getElementById('share-url').value`) === link, await ev(`document.getElementById('share-url').value`));
  check('map= dropped from the address', !(await ev('location.search')).includes('map='));
  check('previous map offered', await ev(`!document.getElementById('share-previous').hidden`));
  await shot('3-opened-shared');
  await openMap(ev);await ev(`document.getElementById('share-restore').click(); true`); await sleep(1500); await ev('sculptCanvas.idle()');
  check('restore brings the own map back', nodesOf(await sketchJson(ev)) === nodesOf(ownJson));
  await shot('4-restored');
  // A reload keeps the visitor's edits: nothing re-opens the shared map.
  await open(page); check('reload keeps the restored map', nodesOf(await sketchJson(ev)) === nodesOf(ownJson));
});
// A link to another world: the page navigates and reloads, and the Map menu opens itself with the restore offer.
let redLink = '';
await session(async ({send, ev, shot, open}) => {
  await open(page + (page.includes('?') ? '&' : '?') + 'biome=red&mapX=4&mapY=4');
  await stroke(send, ev, 'mountain', 650, 700);
  await openShare(ev);
  for (let i = 0; i < 100 && !await ev(`document.getElementById('share-url').value`); i++) await sleep(200);
  redLink = await ev(`document.getElementById('share-url').value`);
});
await session(async ({send, ev, shot, open}) => {
  await open(page + (page.includes('?') ? '&' : '?') + 'mapX=4&mapY=4');
  await stroke(send, ev, 'hill', 600, 800);
  const own = await sketchJson(ev); await sleep(1200);
  await open(redLink);
  for (let i = 0; i < 100 && await ev(`document.getElementById('pane-map').hidden`); i++) await sleep(200);
  check('world switch: world changed', await ev('sculptRegion.sketch().biome') === 'red');
  check('world switch: Map opened itself with the offer', await ev(`!document.getElementById('pane-map').hidden && !document.getElementById('share-previous').hidden && !document.getElementById('share-menu').open`));
  check('world switch: no map= or shared= left in the address', !/[?&](map|shared)=/.test(await ev('location.search')), await ev('location.search'));
  await shot('5-world-switch');
  await openMap(ev);await ev(`document.getElementById('share-restore').click(); true`);
  for (let i = 0; i < 100 && await ev('window.sculptRegion?.sketch().biome').catch(() => 'red') !== 'green'; i++) await sleep(300);
  for (let i = 0; i < 100 && !await ev(`window.sculptRegion?.ready?.() && !document.getElementById('editor').disabled`).catch(() => false); i++) await sleep(300);
  await sleep(1500);
  check('restore across worlds: own map back', nodesOf(await sketchJson(ev)) === nodesOf(own), differs(own, await sketchJson(ev)));
  check('restore across worlds: slot cleared, no lingering button', await ev(`localStorage.getItem('terraform-previous-map-v1')===null`));
});
check('console clean', logs.filter(l => !/favicon|404/.test(l)).length === 0, logs.join(' | ').slice(0, 300));
if (tokenFile && link) {
  const id = link.split('map=')[1], token = readFileSync(tokenFile, 'utf8').trim();
  const r = await fetch(`${mapsUrl}/${id}`, {method: 'DELETE', headers: {Authorization: `Bearer ${token}`}});
  const after = await fetch(`${mapsUrl}/${id}`);
  check('test entry deleted', r.ok && after.status === 404, `delete ${r.status}, then get ${after.status}`);
}
const failed = Object.values(checks).some(v => v !== 'ok');
console.log(JSON.stringify({page, link, checks, console: logs.slice(0, 5)}));
process.exit(failed ? 1 : 0);
