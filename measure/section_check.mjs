// H15: the audit's raised-region measure, on the real engine, in two parts.
//  1. The default kinds (no curve of their own) against samples saved from the classic path (--against classic-ref.json, one array per case): RMS and max.
//  2. Each Go model form against its own knots: a stroke that picks the form draws, with every wobble off, base + amount * knotCurve(t),
//     t = (1 - d / R) / face, d the distance from the stroke, face .44 (softness .5, no shoulder noise). 140 and 560 px across.
// One stroke of three collinear points (440,580,700 at y 500) on a 4 x 4 map, ground left flat, roughness and every wobble off. Heights are the authored field,
// sampled every STEP px. A cell counts when either height is at least one unit from the flat ground (the audit's "raised region").
//   node measure/section_check.mjs --out DIR [--server http://127.0.0.1:8885] [--port 9685] [--kinds plateau,hill,...] [--against classic-ref.json]
// Writes DIR/section-check.json (one row per case). Without --against only the forms are measured.
import {cdpPortFree} from '../repro/cdp-port.mjs';
import {spawn, execFileSync} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
const args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const server = opt('--server', 'http://127.0.0.1:8885'), port = Number(opt('--port', 9685)), out = opt('--out', 'section-check');
const against = opt('--against', ''), only = opt('--kinds', '') ? opt('--kinds', '').split(',') : null;
const STEP = 4, W = 1100, H = 600, YC = 500, Y0 = YC - H / 2;
const path = [[440, YC], [580, YC], [700, YC]];
const SIZES = [140, 280, 560], AMOUNTS = [30, 80, 160];
const SOFT = [.5, 0, .88, 1];
const KINDS = {
  plateau: {soft: SOFT, amounts: AMOUNTS}, offset: {soft: SOFT, amounts: AMOUNTS}, lower: {soft: SOFT, amounts: AMOUNTS},
  mountain: {soft: SOFT, amounts: AMOUNTS}, hill: {soft: SOFT, amounts: AMOUNTS},
  hillPlain: {kind: 'hill', extra: {crestJag: .01}, soft: SOFT, amounts: AMOUNTS},
  deep: {soft: SOFT, amounts: AMOUNTS}, shallow: {soft: SOFT, amounts: AMOUNTS},
};
const curves = JSON.parse(execFileSync('go', ['run', './cmd/measuremodel', 'curves'], {cwd: new URL('..', import.meta.url), maxBuffer: 16 * 1024 * 1024}));
const FORM_NAMES = Object.keys(curves);
const cases = [];
if (against) for (const [name, d] of Object.entries(KINDS)) { if (only && !only.includes(name)) continue; for (const size of SIZES) for (const amount of d.amounts) for (const soft of d.soft) cases.push({name, kind: d.kind || name, size, amount, soft, extra: d.extra || {}}); }
// A form's own check: an offset (base + amount * curve) that picks the form by name, at softness .5 so the face is .44 of the reach.
for (const form of FORM_NAMES) { if (only && !only.includes('form:' + form)) continue; for (const size of [140, 560]) cases.push({name: 'form:' + form, kind: 'offset', size, amount: 80, soft: .5, extra: {curve: {form}}, form}); }
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
    await send('Page.navigate', {url: `${server}/sculpt?biome=green&mapX=4&mapY=4&scratch=sc${Date.now()}&audit=1&gpuMB=512&heapMB=1536${query}`}); await ready();
    const res = {};
    const spacing = await ev('(sculptDebug.size-1)/(sculptDebug.grid-1)');
    for (const c of cases) {
      const card = {diameter: c.size, amount: c.amount, roughness: 0, softness: Math.round(c.soft * 100), cracks: 0, faceVariation: 0, lean: c.kind === 'plateau' || c.kind === 'offset' ? 100 : 0, baseVary: 0, baseBump: 0, moonLobes: 0, ...c.extra};
      await ev(`sculptDebug.scene(${JSON.stringify([[c.kind, path, {card}]])},{ground:false})`); await ready();
      await ev('sculptCanvas.idle()');
      res[JSON.stringify([c.name, c.size, c.amount, c.soft])] = await ev(`(async () => { const sp=(sculptDebug.size-1)/(sculptDebug.grid-1), r=await sculptRegion.readAuthored({x:0,y:Math.floor(${Y0}/sp),width:Math.ceil(${W}/sp)+2,height:Math.ceil(${H}/sp)+2}), p=new Float32Array(r.data,0,r.width*r.height),o=[]; for(let y=0;y<${H};y+=${STEP}) for(let x=0;x<${W};x+=${STEP}) { const X=x/sp,Y=(y+${Y0})/sp-Math.floor(${Y0}/sp),i=Math.floor(X),j=Math.floor(Y),fx=X-i,fy=Y-j; o.push((p[j*r.width+i]*(1-fx)+p[j*r.width+i+1]*fx)*(1-fy)+(p[(j+1)*r.width+i]*(1-fx)+p[(j+1)*r.width+i+1]*fx)*fy); } return o; })()`);
    }
    ws.close(); return {res, logs, spacing};
  } finally { chrome.kill(); }
}
mkdirSync(out, {recursive: true});
const cur = await run(''), ref = against ? JSON.parse(readFileSync(against, 'utf8')) : {};
const rows = [], dump = {};
for (const c of cases) {
  const key = JSON.stringify([c.name, c.size, c.amount, c.soft]), b = cur.res[key];
  let a = ref[key], ground;
  if (c.form) {
    // The form against its knots: the distance to the stroke's capsule (a horizontal line at YC from 440 to 700), then the curve over the face share.
    // The page samples the node lattice bilinearly (spacing (world - 1) / (grid - 1) of the 4 x 4 map), so the reference does too.
    const f = x => { const a = curves[c.form], t = Math.max(0, Math.min(1, x)) * (a.length - 1), i = Math.floor(t), v = t - i; return a[i] * (1-v) + a[Math.min(i+1,a.length-1)] * v; }; const R = c.size / 2, face = .44, base = b[0], SP = cur.spacing; ground = base; a = [];
    const node = (i, j) => { const x = i * SP, d = Math.hypot(Math.max(440 - x, 0, x - 700), j * SP - YC); return base + c.amount * f(Math.max(0, 1 - d / R) / face); };
    for (let y = 0; y < H; y += STEP) for (let x = 0; x < W; x += STEP) {
      const X = x / SP, Y = (y + Y0) / SP, i = Math.floor(X), j = Math.floor(Y), fx = X - i, fy = Y - j;
      a.push((node(i, j) * (1 - fx) + node(i + 1, j) * fx) * (1 - fy) + (node(i, j + 1) * (1 - fx) + node(i + 1, j + 1) * fx) * fy);
    }
    dump[c.name + c.size] = {expected: a, engine: b};
  } else ground = [...a].sort((x, y) => x - y)[a.length >> 1];
  let s = 0, n = 0, mx = 0;
  for (let i = 0; i < a.length; i++) { if (Math.abs(a[i] - ground) < 1 && Math.abs(b[i] - ground) < 1) continue; const d = a[i] - b[i]; s += d * d; n++; mx = Math.max(mx, Math.abs(d)); }
  rows.push({kind: c.name, size: c.size, amount: c.amount, softness: c.soft, cells: n, rms: n ? Math.sqrt(s / n) : 0, max: mx});
}
writeFileSync(`${out}/section-check.json`, JSON.stringify({rows, console: cur.logs.slice(0, 10), samples: dump}));
for (const kind of [...new Set(rows.map(r => r.kind))]) { const r = rows.filter(x => x.kind === kind); console.log(kind.padEnd(14), 'RMS', Math.min(...r.map(x => x.rms)).toFixed(2), '-', Math.max(...r.map(x => x.rms)).toFixed(2), ' max', Math.max(...r.map(x => x.max)).toFixed(2), ' cases', r.length); }
