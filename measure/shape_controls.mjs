// H15: does every shape control do something, on every kind that shows it? One stroke per case on the real engine, each control moved from its default;
// the number is the mean height change (units) over the cells either render raises or lowers by at least one unit. A control the panel offers that prints
// 0.00 is dead. `open` is a stroke with a share face, `px` one with a Face width.
//   node measure/shape_controls.mjs [--server http://127.0.0.1:8885] [--port 9685] [--out DIR]
// Writes DIR/shape-controls.json; prints one row per control. Exit 1 on a console error.
import {cdpPortFree} from '../repro/cdp-port.mjs';
import {spawn} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
const args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const server = opt('--server', 'http://127.0.0.1:8885'), port = Number(opt('--port', 9685)), out = opt('--out', 'shape-controls');
const only = new Set(opt('--only', '').split(',').filter(Boolean)), kinds = new Set(opt('--kinds', '').split(',').filter(Boolean)), variants = new Set(opt('--variants', '').split(',').filter(Boolean));
const STEP = 4, W = 1000, H = 600, YC = 500, Y0 = YC - H / 2, path = [[420, YC], [560, YC], [700, YC]];
const CARD = {diameter: 280, amount: 80, roughness: 40, softness: 50, cracks: 0};
const KINDS = {plateau: {}, offset: {}, hill: {}, ridge: {kind: 'hill', extra: {crestJag: 20}}, mountain: {}, deep: {}, shallow: {}};
// control: the UI's units; `base` is what the control needs on to mean anything (compared with and without the control's own value).
const CONTROLS = {
  curve: {set: {curve: {form: 'cliff'}}},
  facePx: {set: {facePx: 90}},
  softness: {set: {softness: 15}},
  faceVariation: {set: {faceVariation: 150}},
  terraces: {set: {terraces: 4}},
  ledge: {base: {terraces: 4}, set: {ledge: 90}},
  terraceJitter: {base: {terraces: 4}, set: {terraceJitter: 100}},
  lean: {set: {lean: 300}},
  facing: {base: {lean: 300}, set: {facing: 7}},   // south: the stroke runs east, and north is the default
  outlineVar: {set: {outlineVar: 200}},
  widthVar: {set: {widthVar: 200}},
  heightVar: {set: {heightVar: 200}},
};
// Applicability comes from the same Go model and schema used by the editor.
const SECTION = ['plateau', 'offset', 'hill', 'mountain', 'deep', 'shallow'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
await cdpPortFree(port);
mkdirSync(out, {recursive: true});
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--enable-gpu', '--use-angle=metal', `--remote-debugging-port=${port}`,
  `--user-data-dir=${out}/.profile-${port}-${Date.now()}`, '--window-size=1500,1200', '--no-first-run', 'about:blank'], {stdio: 'ignore'});
const rows = [], logs = [];
try {
  let ws; for (let i = 0; i < 100 && !ws; i++) { try { const p = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(x => x.type === 'page'); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {} if (!ws) await sleep(200); }
  await new Promise(r => ws.onopen = r);
  let id = 0; const wait = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') logs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push(m.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 300)); };
  const send = (method, params = {}) => new Promise(r => { const k = ++id; wait.set(k, r); ws.send(JSON.stringify({id: k, method, params})); });
  const ev = async expression => { const r = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true}); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text); return r.result.result.value; };
  const ready = async () => { for (let i = 0; i < 750; i++) { await sleep(120); if (await ev('!!window.terraformAudit && !!window.sculptRegion')) { await ev('terraformAudit.ready()'); return true; } } throw new Error('never ready ' + logs.join('|')); };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', {url: `${server}/sculpt?biome=green&mapX=4&mapY=4&scratch=ctl${Date.now()}&audit=1&weatheredView=0&gpuMB=512&heapMB=1536`}); await ready();
  const schema = await ev('terraformAudit.fields');
  const shown = async (key, kind, card) => {
    const field = schema.find(f => f[0] === key);
    if (!(field ? field[3].includes(kind) : key === 'curve' && SECTION.includes(kind))) return false;
    const p = {softness: (card.softness ?? 50) / 100, rough: (card.roughness ?? 35) / 100,
      radius: (card.diameter ?? 200) / 2, amount: card.amount ?? 70};
    for (const f of schema) if (card[f[0]] !== undefined) p[f[0]] = card[f[0]] / f[7];
    if (card.curve) p.curve = card.curve;
    p.world = await ev('terraformAudit.panelValues()');
    return ev(`terraformAudit.shapeAvailable(${JSON.stringify(key)},${JSON.stringify(kind)},${JSON.stringify(p)})`);
  };
  const heights = async (kind, card) => {
    await ev(`terraformAudit.scene(${JSON.stringify([[kind, path, {card}]])},{ground:false})`); await ev('terraformAudit.idle()');
    return ev(`(async () => { const spacing=(sculptDebug.size-1)/(sculptDebug.grid-1), x0=0, y0=Math.floor(${Y0}/spacing),
      x1=Math.ceil((${W}-1)/spacing), y1=Math.ceil((${Y0}+${H}-1)/spacing), r=await sculptRegion.readAuthored({x:x0,y:y0,width:x1-x0+1,height:y1-y0+1}),
      plane=new Float32Array(r.data,0,r.width*r.height), out=[];
      for(let y=0;y<${H};y+=${STEP})for(let x=0;x<${W};x+=${STEP}){let gx=x/spacing-x0,gy=(y+${Y0})/spacing-y0,ix=Math.floor(gx),iy=Math.floor(gy),jx=Math.min(ix+1,r.width-1),jy=Math.min(iy+1,r.height-1),fx=gx-ix,fy=gy-iy;
        out.push((plane[iy*r.width+ix]*(1-fx)+plane[iy*r.width+jx]*fx)*(1-fy)+(plane[jy*r.width+ix]*(1-fx)+plane[jy*r.width+jx]*fx)*fy)} return out; })()`);
  };
  const moved = (a, b) => { const g = a[0]; let s = 0, n = 0; for (let i = 0; i < a.length; i++) { if (Math.abs(a[i] - g) < 1 && Math.abs(b[i] - g) < 1) continue; s += Math.abs(a[i] - b[i]); n++; } return n ? s / n : 0; };
  for (const [name, d] of Object.entries(KINDS)) for (const [variant, face] of [['open', {}], ['px', {facePx: 120}]]) {
    if ((kinds.size && !kinds.has(name)) || (variants.size && !variants.has(variant))) continue;
    const kind = d.kind || name, card = {...CARD, ...(d.extra || {}), ...face}, cache = new Map();
    const at = c => { const k = JSON.stringify(c); if (!cache.has(k)) cache.set(k, heights(kind, c)); return cache.get(k); };
    for (const [key, c] of Object.entries(CONTROLS)) {
      if ((only.size && !only.has(key)) || (variant === 'px' && key === 'facePx')) continue;
      const base = {...card, ...c.base}, show = await shown(key, kind, {...base, ...(name === 'ridge' ? {crestJag: 20} : {})});
      rows.push({kind: name, variant, control: key, shown: show, moved: moved(await at(base), await at({...base, ...c.set}))});
    }
  }
  ws.close();
} finally { chrome.kill(); }
writeFileSync(`${out}/shape-controls.json`, JSON.stringify({rows, console: logs.slice(0, 10)}));
const names = Object.keys(KINDS), keys = Object.keys(CONTROLS);
for (const variant of ['open', 'px']) {
  console.log(`\n${variant.padEnd(15)}${names.map(n => n.padStart(9)).join('')}`);
  for (const key of keys) console.log(key.padEnd(15) + names.map(n => { const r = rows.find(x => x.kind === n && x.variant === variant && x.control === key); return (!r ? '' : r.moved.toFixed(2) + (r.shown ? (r.moved < .01 ? ' !' : '  ') : ' -')).padStart(9); }).join(''));
}
console.log('\n! shown but dead   - hidden from this stroke');
if (logs.length) console.log('console:', logs.slice(0, 5));
process.exit(logs.length ? 1 : 0);
