// Drive the curve editor (H15 part 2, step C) in headless Chrome, one world at a time: pick every form at 140 and 560 px and draw it, then drag, add and
// remove a knot, reset, set lean and facing, draw, edit the selected stroke, and save and reload (the browser's autosave) to see that the knots and the
// render come back the same.
//   node repro/curveedit.mjs [--server http://127.0.0.1:8801] [--port 9450] [--worlds green,desert] [--out dir]
// Prints one JSON line per world; exit code 1 on any failed check or a console error.
import {cdpPortFree} from './cdp-port.mjs';
import {FORM_NAMES, FORMS, LANDFORM_FORMS} from '../sculpt-shape-presets.js';
import {spawn} from 'node:child_process';
import {mkdirSync} from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : fallback; };
const server = opt('--server', 'http://127.0.0.1:8801'), port = Number(opt('--port', 9450)), out = opt('--out', 'curveedit-out');
const worlds = opt('--worlds', 'green,desert').split(',');
mkdirSync(out, {recursive: true});
const sleep = ms => new Promise(r => setTimeout(r, ms));
let bad = 0;

async function session(url, fn) {
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
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

for (const world of worlds) {
  const url = `${server}/sculpt?biome=${world}&gpuMB=512&heapMB=1536`;   // no scratch: the autosave is what the reload reads
  const r = await session(url, async ({send, ev, logs}) => {
    const res = {world, checks: {}};
    const check = (name, ok, detail) => { res.checks[name] = ok ? 'ok' : `FAILED ${detail === undefined ? '' : JSON.stringify(detail)}`; if (!ok) bad++; };
    const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', {type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra});
    const setValue = (id, v, evt = 'input') => ev(`(() => { const e = document.getElementById(${JSON.stringify(id)}); e.value = ${JSON.stringify(String(v))}; e.dispatchEvent(new Event(${JSON.stringify(evt)}, {bubbles: true})); if (${JSON.stringify(evt)} === 'input') e.dispatchEvent(new Event('change', {bubbles: true})); return e.value; })()`);
    const brush = async (tool = 'plateau') => { await ev(`document.querySelector('[data-tool="${tool}"]').click(); true`); await sleep(300); };
    const stroke = async (tool = 'plateau') => {
      await brush(tool);   // a stroke leaves its shape selected in the Select tool; the next one starts from the brush
      const x0 = 700, y0 = 650;
      await send('Input.dispatchMouseEvent', {type: 'mouseMoved', x: x0, y: y0}); await mouse('mousePressed', x0, y0);
      for (const [dx, dy] of [[0, 0], [60, 20], [120, 30], [180, 10], [240, 0]]) { await mouse('mouseMoved', x0 + dx, y0 + dy); await sleep(30); }
      await mouse('mouseReleased', x0 + 240, y0); await ev('sculptCanvas.idle()'); await sleep(300);
    };
    const nodes = () => ev('sculptDebug.nodes()');
    const raised = async () => ev(`(() => { const n = sculptDebug.nodes().at(-1), far = sculptDebug.corner(10, 10).authored; return Math.max(...n.points.map(p => sculptDebug.corner(p.x, p.y).authored)) - far; })()`);
    const grid = () => ev(`(() => { const o = []; for (let y = 100; y < 1000; y += 30) for (let x = 100; x < 1000; x += 30) o.push(sculptDebug.corner(x, y).authored); return o; })()`);
    // the editor canvas, scrolled into view, its box in page pixels
    const box = async () => ev(`(() => { const c = document.getElementById('section-preview'); c.closest('details').open = true; c.scrollIntoView({block: 'center'}); const r = c.getBoundingClientRect(); return {x: r.left, y: r.top, w: r.width, h: r.height, cw: c.width, ch: c.height}; })()`);
    // a front knot's page position, read from the page's own section layout (the canvas is drawn at the pixels it is shown in, both sides across)
    const knotXY = async (b, x, v) => { const q = await ev(`sculptDebug.sectionPoint('front', ${x}, ${v})`); return [q.x, q.y]; };
    const drag = async (from, to, extra = {}) => { await mouse('mousePressed', ...from, extra); await mouse('mouseMoved', ...to); await sleep(60); await mouse('mouseReleased', ...to); await sleep(250); };
    try {
      await ready(ev); await ev('sculptCanvas.zoom(1); true'); await sleep(500);
      await ev(`document.querySelector('[data-tool="plateau"]').click(); true`); await sleep(300);
      // 1. every form at 140 and 560 px
      for (const size of [144, 560]) {   // the diameter slider steps by 8, so 144 is its nearest to 140
        await brush(); await setValue('diameter', size);
        for (const form of FORM_NAMES) {
          await brush(); await setValue('curve-form', form, 'change');
          const before = (await nodes()).length;
          await stroke();
          const ns = await nodes(), n = ns.at(-1), up = await raised(); 
          check(`form ${form} ${size}px`, ns.length === before + 1 && n.params.curve?.form === form && n.params.radius === size / 2 && up > 5, {nodes: ns.length - before, curve: n?.params?.curve, radius: n?.params?.radius, up});
          await ev(`document.getElementById('undo').click(); true`); await ev('sculptCanvas.idle()'); await sleep(200);
        }
      }
      // 2. knots on the brush: drag, add, remove, reset (the cliff form, softness as it stands)
      await brush(); await setValue('diameter', 200); await setValue('curve-form', 'cliff', 'change');
      let b = await box(); const base = FORMS.cliff(Number(await ev(`document.getElementById('softness').value`)) / 100).knots;
      check('the form shows its knots as handles', (await ev('sculptDebug.curve()'))?.form === 'cliff' && !(await ev('sculptDebug.curve()')).knots);
      await drag(await knotXY(b, ...base[3]), await knotXY(b, base[3][0], base[3][1] + .15));
      let c = await ev('sculptDebug.curve()');
      check('drag a knot', c?.knots?.length === base.length && c.knots[3][1] > base[3][1] + .1 && c.knots.every((k, i) => i === 3 || Math.abs(k[1] - base[i][1]) < 1e-6), c);
      await drag(await knotXY(b, .5, 1.25), await knotXY(b, .5, 1.25));   // click on empty canvas: a knot is added, above 1 (a lip)
      c = await ev('sculptDebug.curve()');
      check('add a knot (a lip above 1)', c?.knots?.length === base.length + 1 && c.knots.some(k => k[1] > 1.1), c);
      const lipIdx = c.knots.findIndex(k => k[1] > 1.1), bk = await knotXY(b, ...c.knots[lipIdx]);
      await mouse('mousePressed', ...bk, {modifiers: 8}); await mouse('mouseReleased', ...bk, {modifiers: 8}); await sleep(250);   // Shift-click removes
      c = await ev('sculptDebug.curve()');
      check('remove a knot', c?.knots?.length === base.length && !c.knots.some(k => k[1] > 1.1), c);
      await ev(`document.getElementById('curve-reset').click(); true`); await sleep(200); c = await ev('sculptDebug.curve()');
      check('reset to the form', c?.form === 'cliff' && !c.knots, c);
      // 3. lean and facing, then a stroke that carries them with knots of its own
      await drag(await knotXY(b, ...base[3]), await knotXY(b, base[3][0], base[3][1] + .2));
      await brush(); await setValue('lean', 300); await setValue('facing', 5, 'change');
      await stroke();
      let ns = await nodes(), n = ns.at(-1), p = n.params;
      check('lean and facing set on the stroke', p.lean === 3 && p.facing === 5 && p.curve?.knots?.length === base.length && p.curve.form === 'cliff', {lean: p.lean, facing: p.facing, curve: p.curve});
      // 4. the selected stroke re-edits: select it, drag a knot, undo
      await brush(); await ev(`document.querySelector('[data-tool="move"]').click(); true`); await sleep(300);   // back to the brush, then Select
      await mouse('mouseMoved', 820, 665); await mouse('mousePressed', 820, 665); await mouse('mouseReleased', 820, 665); await sleep(400);
      const sel = await ev('sculptDebug.state().selected');
      check('the stroke is selected', sel === ns.length - 1, sel);
      if (sel === ns.length - 1) {
        b = await box(); const k0 = (await nodes())[sel].params.curve.knots;
        check('the editor shows the selected stroke\'s knots', same(await ev('sculptDebug.curve()'), (await nodes())[sel].params.curve));
        await drag(await knotXY(b, ...k0[3]), await knotXY(b, k0[3][0], k0[3][1] + .1));
        const k1 = (await nodes())[sel].params.curve.knots;
        check('drag a knot of the selected stroke', k1[3][1] > k0[3][1] + .05 && k1.length === k0.length, {k0: k0[3], k1: k1[3]});
        await ev(`document.getElementById('undo').click(); true`); await ev('sculptCanvas.idle()'); await sleep(300);
        check('undo restores the knots', same((await nodes())[sel].params.curve.knots, k0));
        await drag(await knotXY(b, ...k0[3]), await knotXY(b, k0[3][0], k0[3][1] + .1));   // the edit that must survive the reload
      }
      // 5. save (the autosave) and reload
      ns = await nodes(); const saved = ns.map(x => x.params?.curve ?? null), heights = await grid(); await sleep(1500);
      await send('Page.navigate', {url}); await sleep(1500); await ready(ev); await ev('sculptCanvas.zoom(1); true'); await sleep(500); await ev('sculptCanvas.idle()'); await sleep(500);
      const back = (await nodes()).map(x => x.params?.curve ?? null), h2 = await grid();
      check('the same knots after reload', same(saved, back) && saved.some(x => x?.knots), {saved, back});
      check('the same render after reload', h2.length === heights.length && h2.every((v, i) => Math.abs(v - heights[i]) < 1e-3), h2.reduce((m, v, i) => Math.max(m, Math.abs(v - heights[i])), 0));
      // 6. the landform (H27): its forms, both sides of the section, Link sides and Mirror, the lean handle, the along curve and its pick, the elevation, undo, save and reload
      await brush('landform'); await setValue('diameter', 200); await setValue('curve-form', 'lfPlateau', 'change');
      const crestHeights = async () => ev(`(() => { const n = sculptDebug.nodes().at(-1); return n.points.map(p => sculptDebug.corner(p.x, p.y).authored); })()`);
      const plain = await ev(`sculptDebug.corner(10, 10).authored`);
      for (const [id] of LANDFORM_FORMS) {
        await brush('landform'); await setValue('curve-form', id, 'change');
        const before = (await nodes()).length; await stroke('landform');
        const ns2 = await nodes(), n2 = ns2.at(-1), hs = await crestHeights();
        check(`landform form ${id}`, ns2.length === before + 1 && n2.kind === 'landform' && n2.params.curve?.form === id && Math.max(...hs) > plain + 20, {nodes: ns2.length - before, kind: n2?.kind, curve: n2?.params?.curve, plain, hs: hs.map(h => Math.round(h))});
        await ev(`document.getElementById('undo').click(); true`); await ev('sculptCanvas.idle()'); await sleep(200);
      }
      await brush('landform'); await setValue('curve-form', 'lfPlateau', 'change'); await stroke('landform');   // the stroke is selected
      const L0 = (await nodes()).length - 1;
      let b2 = await box(); const kn = FORMS.lfPlateau().knots, sp = async (side, x, v) => { const q = await ev(`sculptDebug.sectionPoint(${JSON.stringify(side)}, ${x}, ${v})`); return [q.x, q.y]; };
      check('a landform starts with its sides linked', (await ev(`document.getElementById('curve-link').getAttribute('aria-pressed')`)) === 'true' && !(await ev('sculptDebug.curve()'))?.knots);
      await drag(await sp('back', ...kn[1]), await sp('back', kn[1][0], kn[1][1] + .2));
      c = await ev('sculptDebug.curve()');
      check('a back handle moves the shared curve while linked', c?.knots?.[1]?.[1] > kn[1][1] + .1 && !c.back, c);
      await ev(`document.getElementById('curve-link').click(); true`); await sleep(300); c = await ev('sculptDebug.curve()');
      check('unlinking copies the front to the back', c?.back && same(c.back, c.knots), c);
      await drag(await sp('back', ...kn[2]), await sp('back', kn[2][0] + .02, kn[2][1] - .3));
      const c2 = await ev('sculptDebug.curve()');
      check('an unlinked back moves on its own', same(c2.knots, c.knots) && c2.back[2][1] < c.back[2][1] - .2, {front: c2.knots, back: c2.back});
      await setValue('lean', 250); await sleep(200);
      await ev(`document.getElementById('curve-mirror').click(); true`); await sleep(300);
      const c3 = await ev('sculptDebug.curve()'), p3 = (await nodes())[L0].params;
      check('mirror swaps the sides and turns the lean round', same(c3.knots, c2.back) && same(c3.back, c2.knots) && Math.abs(p3.lean - .4) < .03, {lean: p3.lean, front: c3.knots, back: c3.back});
      await ev(`document.getElementById('curve-link').click(); true`); await sleep(300);
      check('linking again drops the back', !(await ev('sculptDebug.curve()'))?.back);
      const lean0 = (await nodes())[L0].params.lean, lp = await ev('sculptDebug.leanPoint()');
      await drag([lp.x, lp.y], [lp.x + 40, lp.y]);
      const lean1 = (await nodes())[L0].params.lean;
      check('dragging the crest sideways sets the lean', lean1 !== lean0 && lean1 >= .25 && lean1 <= 4, {lean0, lean1});
      // the elevation, and the along curve
      const top0 = Math.max(...await crestHeights()); await setValue('lf-elevation', plain + 120, 'input'); await sleep(300); await ev('sculptCanvas.idle()'); await sleep(500);
      const top1 = Math.max(...await crestHeights());
      check('the elevation sets the crest', Math.abs(top1 - (plain + 120)) < 6 && top1 > top0 + 20, {top0, top1, plain});
      await ev(`document.getElementById('along-preview').scrollIntoView({block: 'center'}); true`); await sleep(300);
      const ap = await ev('sculptDebug.alongPoint(.5, 1)'), apLow = await ev('sculptDebug.alongPoint(.5, .3)');
      await mouse('mouseMoved', ap.x, ap.y); await mouse('mousePressed', ap.x, ap.y); await mouse('mouseReleased', ap.x, ap.y); await sleep(200);
      check('a click on the along curve picks a place', Math.abs((await ev('sculptDebug.place()')) - .5) < .04 && (await ev('JSON.stringify(sculptRegion.sectionMark())')) !== 'null');
      const dbl = async pt => { for (const n of [1, 2]) { await send('Input.dispatchMouseEvent', {type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', buttons: 1, clickCount: n}); await send('Input.dispatchMouseEvent', {type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', buttons: 0, clickCount: n}); } await sleep(300); };
      await dbl(apLow);
      let al = await ev('sculptDebug.along()');
      check('double-clicking the along curve adds a knot', al?.length === 3 && Math.abs(al[1][0] - .5) < .05, al);
      await drag([apLow.x, apLow.y], [apLow.x, (await ev('sculptDebug.alongPoint(.5, .15)')).y]);
      al = await ev('sculptDebug.along()');
      await ev('sculptCanvas.idle()'); await sleep(600);
      const hs2 = await crestHeights(), mid = hs2[Math.floor(hs2.length / 2)];
      check('the along curve lowers the crest in the middle', al?.[1]?.[1] < .3 && mid < top1 - 40 && hs2[0] > top1 - 8, {al, mid, ends: [hs2[0], hs2.at(-1)], top1});
      await ev(`document.getElementById('undo').click(); true`); await ev('sculptCanvas.idle()'); await sleep(300);
      const alongAfterUndo = (await nodes())[L0].params.along;
      check('undo restores the knot the drag moved', alongAfterUndo?.length === 3 && alongAfterUndo[1][1] > al[1][1] + .05, {before: al, after: alongAfterUndo});
      // save (the autosave) and reload: the curve with its sides, the along knots and the render come back
      await brush('landform');
      ns = await nodes(); const savedL = ns.map(x => x.kind === 'landform' ? [x.params.curve ?? null, x.params.along ?? null, x.params.elevation, x.params.lean] : null), heightsL = await grid(); await sleep(1500);
      await send('Page.navigate', {url}); await sleep(1500); await ready(ev); await ev('sculptCanvas.zoom(1); true'); await sleep(500); await ev('sculptCanvas.idle()'); await sleep(500);
      const backL = (await nodes()).map(x => x.kind === 'landform' ? [x.params.curve ?? null, x.params.along ?? null, x.params.elevation, x.params.lean] : null), h3 = await grid();
      check('the landform comes back the same after reload', same(savedL, backL) && savedL.some(x => x?.[1]), {savedL, backL});
      check('the landform render is the same after reload', h3.length === heightsL.length && h3.every((v, i) => Math.abs(v - heightsL[i]) < 1e-3), h3.reduce((m, v, i) => Math.max(m, Math.abs(v - heightsL[i])), 0));
    } catch (err) { res.error = err.message; bad++; }
    res.console = logs.filter(l => !/favicon/.test(l)); if (res.console.length) bad++;
    return res;
  });
  console.log(JSON.stringify(r));
}
process.exit(bad ? 1 : 0);
