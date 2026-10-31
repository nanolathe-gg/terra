// H15: the audit's raised-region measure, on the real engine: each kind's classic curve against its cross-section preset, over the sizes,
// amounts and softnesses the scenes use. One stroke of three collinear points (the audit's: 240,380,500 at y 330, moved 200 px right onto a 4 x 4 map),
// ground left flat, roughness and every wobble off. Heights are the authored field, sampled every STEP px. A cell counts when either
// render is at least one unit from the flat ground (the audit's "raised region").
//   node measure/section_check.mjs --out DIR [--server http://127.0.0.1:8885] [--port 9685] [--kinds plateau,hill,...]
// Writes DIR/section-check.json (one row per case) and DIR/<kind>.svg (classic against preset along the stroke's cross-section).
import {cdpPortFree} from '../repro/cdp-port.mjs';
import {spawn} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
const args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const server = opt('--server', 'http://127.0.0.1:8885'), port = Number(opt('--port', 9685)), out = opt('--out', 'section-check');
const only = opt('--kinds', '') ? opt('--kinds', '').split(',') : null;
const STEP = 4, W = 1100, H = 600, YC = 500, Y0 = YC - H / 2;
const path = [[440, YC], [580, YC], [700, YC]];
const SIZES = [140, 280, 560], AMOUNTS = [30, 80, 160];
const SOFT = [.5, 0, .88, 1];
const KINDS = {
  plateau: {soft: SOFT, amounts: AMOUNTS}, offset: {soft: SOFT, amounts: AMOUNTS}, lower: {soft: SOFT, amounts: AMOUNTS},
  mountain: {soft: SOFT, amounts: AMOUNTS}, hill: {soft: SOFT, amounts: AMOUNTS},
  hillPlain: {kind: 'hill', extra: {crestJag: .01}, soft: SOFT, amounts: AMOUNTS},
  deep: {soft: SOFT, amounts: AMOUNTS}, shallow: {soft: SOFT, amounts: AMOUNTS},
  // Strokes that carry the stored section keys (cards in the UI's units), the authored apron, face, crown, shelf, terraces and lip.
  secPlateau: {kind: 'plateau', extra: {profile: 1, apronPx: 50, apronHeight: 15, facePx: 130}, soft: [.5], amounts: [80, 160]},
  secShare: {kind: 'plateau', extra: {profile: 1, faceCurve: -50}, soft: [0, .5, 1], amounts: [80]},
  secConvex: {kind: 'offset', extra: {profile: 1, apronPx: 20, apronHeight: 10, faceCurve: 60}, soft: [.5], amounts: [80]},
  secTerrace: {kind: 'offset', extra: {profile: 1, apronPx: 40, apronHeight: 15, facePx: 200, terraces: 7, ledge: 40, terraceJitter: 0}, soft: [.6], amounts: [80]},
  secLip: {kind: 'plateau', extra: {profile: 1, facePx: 90, lip: 6}, soft: [.5], amounts: [80]},
  secHill: {kind: 'hill', extra: {profile: 1, crown: 70, apronPx: 20, apronHeight: 10, facePx: 90}, soft: [.5], amounts: [70]},
  secMountain: {kind: 'mountain', extra: {profile: 1, crown: 50, faceCurve: 30, apronPx: 30, apronHeight: 20}, soft: [.5], amounts: [80]},
  secDeep: {kind: 'deep', extra: {profile: 1, apronPx: 30, apronHeight: 15, facePx: 90, shelfPx: 190, shelfDepth: 8}, soft: [.5], amounts: [80]},
  secShelf: {kind: 'deep', extra: {profile: 1, facePx: 90, shelfPx: 150, shelfDepth: 12, shelfSteps: 3}, soft: [.5], amounts: [80]},
  secBank: {kind: 'shallow', extra: {profile: 1, apronPx: 30, facePx: 90, terraces: 3, ledge: 50, terraceJitter: 0, lip: -8}, soft: [.5], amounts: [80]},
};
const cases = [];
for (const [name, d] of Object.entries(KINDS)) { if (only && !only.includes(name)) continue; for (const size of SIZES) for (const amount of d.amounts) for (const soft of d.soft) cases.push({name, kind: d.kind || name, size, amount, soft, extra: d.extra || {}}); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function run(query) {
  await cdpPortFree(port);
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--enable-gpu', '--use-angle=metal', `--remote-debugging-port=${port}`,
    `--user-data-dir=${out}/.profile-${port}-${Date.now()}`, '--window-size=1500,1200', '--no-first-run', 'about:blank'], {stdio: 'ignore'});
  try {
    let ws; for (let i = 0; i < 100 && !ws; i++) { try { const p = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(x => x.type === 'page'); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {} if (!ws) await sleep(200); }
    await new Promise(r => ws.onopen = r);
    let id = 0; const wait = new Map(), logs = [];
    ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') logs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push(m.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 300)); };
    const send = (method, params = {}) => new Promise(r => { const k = ++id; wait.set(k, r); ws.send(JSON.stringify({id: k, method, params})); });
    const ev = async expression => { const r = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true}); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text); return r.result.result.value; };
    const ready = async () => { for (let i = 0; i < 480; i++) { await sleep(250); if (await ev('!!window.sculptCanvas&&!document.getElementById("map-export").disabled')) return true; } throw new Error('never ready ' + logs.join('|')); };
    await send('Runtime.enable'); await send('Page.enable');
    await send('Page.navigate', {url: `${server}/sculpt?biome=green&mapX=4&mapY=4&scratch=sc${Date.now()}&gpuMB=512&heapMB=1536${query}`}); await ready();
    const res = {};
    for (const c of cases) {
      const card = {diameter: c.size, amount: c.amount, roughness: 0, softness: Math.round(c.soft * 100), cracks: 0, faceVariation: 0, northFace: 0, mesaFlank: 0, baseVary: 0, baseBump: 0, moonLobes: 0, ...c.extra};
      await ev(`sculptDebug.scene(${JSON.stringify([[c.kind, path, {card}]])},{ground:false})`); await ready();
      await ev('sculptCanvas.idle()');
      res[JSON.stringify([c.name, c.size, c.amount, c.soft])] = await ev(`(() => { const o = []; for (let y = 0; y < ${H}; y += ${STEP}) for (let x = 0; x < ${W}; x += ${STEP}) o.push(sculptDebug.corner(x, y + ${Y0}).authored); return o; })()`);
    }
    ws.close(); return {res, logs};
  } finally { chrome.kill(); }
}
mkdirSync(out, {recursive: true});
const classic = await run(''), preset = await run('&shapePresets');
const rows = [];
for (const c of cases) {
  const key = JSON.stringify([c.name, c.size, c.amount, c.soft]), a = classic.res[key], b = preset.res[key];
  const ground = [...a].sort((x, y) => x - y)[a.length >> 1]; let s = 0, n = 0, mx = 0;
  for (let i = 0; i < a.length; i++) { if (Math.abs(a[i] - ground) < 1 && Math.abs(b[i] - ground) < 1) continue; const d = a[i] - b[i]; s += d * d; n++; mx = Math.max(mx, Math.abs(d)); }
  rows.push({kind: c.name, size: c.size, amount: c.amount, softness: c.soft, cells: n, rms: n ? Math.sqrt(s / n) : 0, max: mx});
}
writeFileSync(`${out}/section-check.json`, JSON.stringify({rows, console: [...classic.logs, ...preset.logs].slice(0, 10), samples: Object.fromEntries(Object.entries(classic.res).map(([k, v]) => [k, {classic: v, preset: preset.res[k]}]))}));
for (const kind of Object.keys(KINDS)) { const r = rows.filter(x => x.kind === kind); if (!r.length) continue; console.log(kind.padEnd(10), 'RMS', Math.min(...r.map(x => x.rms)).toFixed(2), '-', Math.max(...r.map(x => x.rms)).toFixed(2), ' max', Math.max(...r.map(x => x.max)).toFixed(2), ' cases', r.length); }
