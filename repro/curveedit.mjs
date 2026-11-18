// Drive the curve editor (H15 part 2, step C) in headless Chrome, one world at a time: pick every form at 140 and 560 px and draw it, then drag, add and
// remove a knot, reset, set lean and facing, draw, edit the selected stroke, and save and reload (the browser's autosave) to see that the knots and the
// render come back the same.
//   node repro/curveedit.mjs [--server http://127.0.0.1:8801] [--port 9450] [--worlds green,desert] [--out dir]
// The worlds run at once, one browser each, on CDP ports --port, --port+1, ...
// Prints one JSON line per world; exit code 1 on any failed check or a console error.
import {chromePath, chromeGpuFlags} from './chrome.mjs';
import {cdpPortFree} from './cdp-port.mjs';
import {FORMS, LANDFORM_FORMS} from '../sculpt-shape-presets.js';
import {LANDFORM_DEFAULTS, LANDFORM_SHAPES} from '../sculpt-scene.js';
import {spawn} from 'node:child_process';
import {mkdirSync,readFileSync} from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : fallback; };
const server = opt('--server', 'http://127.0.0.1:8801'), port = Number(opt('--port', 9450)), out = opt('--out', 'curveedit-out');
const worlds = opt('--worlds', 'green,desert').split(',');
mkdirSync(out, {recursive: true});
const sleep = ms => new Promise(r => setTimeout(r, ms));
let bad = 0;

async function session(url, port, fn) {
  const logs = [];
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

// Each world is its own browser, all at once, on CDP ports --port, --port+1, ...
async function editWorld(world, port) {
  const url = `${server}/?biome=${world}&gpuMB=512&heapMB=1536`;   // no scratch: the autosave is what the reload reads (each browser has its own)
  const r = await session(url, port, async ({send, ev, logs}) => {
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
    // the most the last stroke moved the ground on its path, up or down (River and Braided river cut their channel whatever the Combine)
    const moved = async () => ev(`(() => { const n = sculptDebug.nodes().at(-1), far = sculptDebug.corner(10, 10).authored; return Math.max(...n.points.map(p => Math.abs(sculptDebug.corner(p.x, p.y).authored - far))); })()`);
    const grid = () => ev(`(() => { const o = []; for (let y = 100; y < 1000; y += 30) for (let x = 100; x < 1000; x += 30) o.push(sculptDebug.corner(x, y).authored); return o; })()`);
    // the editor canvas, scrolled into view, its box in page pixels
    const box = async () => ev(`(() => { const c = document.getElementById('section-preview'), d = c.closest('details'); if (d) d.open = true; c.scrollIntoView({block: 'center'}); const r = c.getBoundingClientRect(); return {x: r.left, y: r.top, w: r.width, h: r.height, cw: c.width, ch: c.height}; })()`);
    // a front knot's page position, read from the page's own section layout (the canvas is drawn at the pixels it is shown in, both sides across)
    const knotXY = async (b, x, v) => { const q = await ev(`sculptDebug.sectionPoint('front', ${x}, ${v})`); return [q.x, q.y]; };
    const drag = async (from, to, extra = {}) => { await mouse('mousePressed', ...from, extra); await mouse('mouseMoved', ...to); await sleep(60); await mouse('mouseReleased', ...to); await sleep(250); };
    try {
      await ready(ev); await ev('sculptCanvas.zoom(1); true'); await sleep(500);
      // Fix the seed so outline variation cannot turn this UI check into a lottery.
      await setValue('seed',2701,'change');await ev(`document.getElementById('seed-vary').checked=false;document.getElementById('seed-vary').dispatchEvent(new Event('change',{bubbles:true}));true`);
      // The Plateau button's numbers (the model's, the shape library's and the world's own: sculpt-scene.js, its table's world.shapes) must reach a
      // new stroke, and a selected stroke through the existing Style selector.
      const worldShapes = (await (await fetch(`${server}/config/${world}.json`)).json()).worldShapes;
      const defaults = {...LANDFORM_DEFAULTS, ...LANDFORM_SHAPES.plateau, ...worldShapes[world].plateau};
      const baseH = await ev('sculptDebug.base');
      await stroke('plateau');
      // The Wander slider (sculpt-scene.js SHAPE_FIELDS: steps of 2 px) snaps the world's number to its step (75 px to 76).
      const wanderSnapped = Math.round(defaults.wander / 2) * 2;
      const fresh = (await nodes()).at(-1).params;
      check('approved landform defaults reach a new stroke', same(fresh.curve, defaults.curve) && fresh.radius === defaults.diameter / 2 && fresh.wander === wanderSnapped && fresh.widthVary === defaults.widthVary / 100 && fresh.elevation === baseH + defaults.elevation && fresh.routeSmooth === 0 && fresh.crestTaper === 0, {curve:fresh.curve,radius:fresh.radius,wander:fresh.wander,elevation:fresh.elevation,baseH});
      await setValue('curve-form', 'lfTerraced', 'change'); await setValue('lf-wander', 0);   // a plateau form: the style restores the plateau
      await setValue('tool-style', world, 'change'); await ev('sculptCanvas.idle()');
      const styled = (await nodes()).at(-1).params;
      check('style restores the approved curve and numbers on a selected landform', same(styled.curve, defaults.curve) && styled.wander === fresh.wander && styled.elevation === fresh.elevation, styled.curve);
      check('facing is offered only when the default section has different sides', await ev('document.getElementById("facing-control").hidden') === !defaults.curve.back);
      await setValue('lean', 200);
      check('unequal landform widths enable facing', !await ev('document.getElementById("facing-control").hidden'));
      await setValue('tool-style', world, 'change'); await ev('sculptCanvas.idle()');
      await ev(`document.getElementById('blank').click(); true`); await ready(ev);
      await ev(`document.querySelector('[data-tool="plateau"]').click(); true`); await sleep(300);
      // 1. every form at 140 and 560 px
      for (const size of [144, 560]) {   // the diameter slider steps by 8, so 144 is its nearest to 140
        await brush(); await setValue('diameter', size);
        for (const form of LANDFORM_FORMS.map(([id]) => id)) {   // the shape buttons draw landforms
          // River and Braided river cut a channel under their floodplain, which the Plateau card's Raise to keeps from showing: they are drawn
          // as their own buttons draw them (Cut to, 3 above the sea). Every other form is drawn on the Plateau card.
          const tool = {lfRiver: 'river', lfBraided: 'braided'}[form] ?? 'plateau';
          if (tool === 'plateau') { await brush(); await setValue('curve-form', form, 'change'); }
          else { await brush(tool); await setValue('diameter', size); }
          const before = (await nodes()).length;
          await stroke(tool);
          const ns = await nodes(), n = ns.at(-1), change = await moved();
          // A channel targets three units above the sea; on Green its total
          // cut is only six units, and the path can sample a channel shoulder.
          const minimumChange=tool==='plateau'?5:Math.min(5,Math.max(.5,Math.abs(baseH-(await ev('sculptDebug.sea'))-3)*.5));
          check(`form ${form} ${size}px`, ns.length === before + 1 && n.params.curve?.form === form && n.params.radius === size / 2 && change > minimumChange, {minimumChange,nodes: ns.length - before, curve: n?.params?.curve, radius: n?.params?.radius, change});
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
      // 6. the landform (H27; section 1 draws its forms): both sides of the section, Link sides and Mirror, the lean handle, the along curve and its pick, the elevation, undo, save and reload
      // Sections 1-5 edited this same brush (the plateau button draws a landform) and left a landform where this one is drawn: start a blank map and the world's preset.
      await ev(`document.getElementById('blank').click(); true`); await ready(ev); await ev('sculptCanvas.zoom(1); true'); await sleep(500);
      await brush('plateau'); await setValue('tool-style', world, 'change'); await setValue('diameter', 200);
      // This sequence samples the crest at path points: keep the analytic
      // fixture centered, after testing the natural world defaults above.
      await setValue('lf-wander',0);await setValue('lf-width-vary',0);await setValue('lf-height-vary',0);
      await setValue('curve-form', 'lfPlateau', 'change');
      const crestHeights = async () => ev(`(() => { const n = sculptDebug.nodes().at(-1); return n.points.map(p => sculptDebug.corner(p.x, p.y).authored); })()`);
      const plain = await ev(`sculptDebug.corner(10, 10).authored`);
      await brush('plateau'); await setValue('curve-form', 'lfPlateau', 'change'); await stroke('plateau');   // the stroke is selected
      const L0 = (await nodes()).length - 1;
      let b2 = await box(); const kn = FORMS.lfPlateau().knots, sp = async (side, x, v) => { const q = await ev(`sculptDebug.sectionPoint(${JSON.stringify(side)}, ${x}, ${v})`); return [q.x, q.y]; };
      check('a landform starts with its sides linked', (await ev(`document.getElementById('curve-link').getAttribute('aria-pressed')`)) === 'true' && !(await ev('sculptDebug.curve()'))?.knots);
      await drag(await sp('back', ...kn[1]), await sp('back', kn[1][0], kn[1][1] + .2));
      c = await ev('sculptDebug.curve()');
      check('a back handle moves the shared curve while linked', c?.knots?.[1]?.[1] > kn[1][1] + .1 && !c.back, c);
      await ev(`document.getElementById('curve-link').click(); true`); await sleep(300); c = await ev('sculptDebug.curve()');
      check('unlinking copies the front to the back', c?.back && same(c.back, c.knots), c);
      const backKnot = kn.findIndex(k => k[1] >= .5 && k[1] < 1);
      await drag(await sp('back', ...kn[backKnot]), await sp('back', kn[backKnot][0] + .02, kn[backKnot][1] - .3));
      const c2 = await ev('sculptDebug.curve()');
      check('an unlinked back moves on its own', same(c2.knots, c.knots) && c2.back[backKnot][1] < c.back[backKnot][1] - .2, {front: c2.knots, back: c2.back});
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
      if(await ev('sculptDebug.state().selected')!==L0)await ev(`document.querySelector('#layers [data-index="${L0}"] .layer-name').click();true`);
      const targetElevation=Math.round(plain)+90;   // the button draws 130 over the plain
      const top0 = Math.max(...await crestHeights()); await setValue('lf-elevation', targetElevation, 'input'); await sleep(300); await ev('sculptCanvas.idle()'); await sleep(500);
      const top1 = Math.max(...await crestHeights());
      check('the elevation sets the crest', (await nodes())[L0].params.elevation===targetElevation && Math.abs(top1-targetElevation)<6 && Math.abs(top1-top0)>20, {top0,top1,plain,targetElevation,params:(await nodes())[L0].params.elevation});
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
      // Undo clears selection; select the saved stroke again before editing its controls.
      await ev(`document.querySelector('#layers [data-index="${L0}"] .layer-name').click(); true`);
      await setValue('lf-route-smooth', 80); await setValue('crest-taper', 65);
      check('landform route and taper edits reach the selected node', (await nodes())[L0].params.routeSmooth === .8 && (await nodes())[L0].params.crestTaper === .65);
      await ev(`document.getElementById('undo').click(); true`); await ev('sculptCanvas.idle()'); await sleep(300);
      check('undo restores the taper independently of the route', (await nodes())[L0].params.crestTaper === 0 && (await nodes())[L0].params.routeSmooth === .8);
      await ev(`document.querySelector('#layers [data-index="${L0}"] .layer-name').click(); true`);
      await setValue('crest-taper', 65); await ev('sculptCanvas.idle()'); await sleep(500);
      await brush('plateau');
      ns = await nodes(); const savedL = ns.map(x => x.kind === 'landform' ? [x.params.curve ?? null, x.params.along ?? null, x.params.elevation, x.params.lean, x.params.routeSmooth, x.params.crestTaper] : null), heightsL = await grid(); await sleep(1500);
      await send('Page.navigate', {url}); await sleep(1500); await ready(ev); await ev('sculptCanvas.zoom(1); true'); await sleep(500); await ev('sculptCanvas.idle()'); await sleep(500);
      const backL = (await nodes()).map(x => x.kind === 'landform' ? [x.params.curve ?? null, x.params.along ?? null, x.params.elevation, x.params.lean, x.params.routeSmooth, x.params.crestTaper] : null), h3 = await grid();
      check('the landform comes back the same after reload', same(savedL, backL) && savedL.some(x => x?.[1]), {savedL, backL});
      check('the landform render is the same after reload', h3.length === heightsL.length && h3.every((v, i) => Math.abs(v - heightsL[i]) < 1e-3), h3.reduce((m, v, i) => Math.max(m, Math.abs(v - heightsL[i])), 0));
      // 7. Flatten to over an existing hill (a rounded landform 80 above the plain), the along curve at 0 at one end: that end comes down to the plain (decision 24)
      const plainH = await ev(`sculptDebug.corner(10, 10).authored`);
      const flat = along => [['landform', [[640, 300]], {card: {diameter: 200, elevation: plainH + 80, wander: 0, widthVary: 0, heightVary: 0}, curve: {form: 'lfHill'}}], ['landform', [[100, 300], [780, 300]], {card: {diameter: 160, elevation: plainH + 91, combine: 2, wander: 0, widthVary: 0, heightVary: 0}, along}]];
      const probe = async along => { await ev(`sculptDebug.scene(${JSON.stringify(flat(along))}, {ground: false})`); await ready(ev); return ev(`[[300, 300], [640, 300], [740, 300]].map(([x, y]) => sculptDebug.corner(x, y).authored)`); };
      const level = await probe([[0, 1], [1, 1]]), down = await probe([[0, 1], [1, 0]]);
      check('flatten to with the along curve at 0 at the end brings the hill down to the plain', level[1] > plainH + 80 && down[1] < plainH + 0.3 * 91 && down[2] < plainH + 12 && level[0] > plainH + 85, {plainH, level, down});
      // 8. An isolated shore crosses sea level; the preceding knot tests need not.
      const shore = JSON.parse(readFileSync(new URL('comparisons/landform-shores/03-lava-contours.json', import.meta.url), 'utf8'));
      shore.strokes[0][2].card.elevation = (await ev('sculptDebug.sea')) - 55;
      shore.strokes[0][2].card.heightReference = 0;
      shore.strokes[0][2].card.terraces = 0;
      await ev(`sculptDebug.scene(${JSON.stringify(shore.strokes)}, {ground:false})`); await ready(ev);
      await ev(`document.querySelector('#layers [data-index="0"] .layer-name').click(); true`);
      const fixedShoreHeights=await grid();
      await setValue('lf-height-reference',1);await ready(ev);
      const refHeights=await grid(),refError=Math.max(...refHeights.map((h,i)=>Math.abs(h-fixedShoreHeights[i])));
      check('switching to sea reference preserves the shore', (await nodes())[0].params.elevation===-55 && refError<1e-3,{elevation:(await nodes())[0].params.elevation,refError});
      check('sea reference labels the shared height input', await ev(`document.querySelector('label[for="lf-elevation"]').textContent.includes('Height above sea')`));
      await setValue('lf-elevation',-30);await ready(ev);
      check('relative height changes the bed depth', Math.abs((await ev('sculptDebug.corner(460,380).authored'))-((await ev('sculptDebug.sea'))-30))<.01);
      await ev(`document.getElementById('undo').click(); true`);await ready(ev);
      check('undo restores the relative depth', (await nodes())[0].params.heightReference===1 && (await nodes())[0].params.elevation===-55);
      await ev(`document.querySelector('#layers [data-index="0"] .layer-name').click(); true`);
      await setValue('fingers', 100); await setValue('finger-size', 65); await setValue('sec-terraces', 5); await ready(ev);
      check('landform shore controls reach the selected node', (await nodes())[0].params.fingers === 1 && (await nodes())[0].params.fingerSize === .65 && (await nodes())[0].params.terraces === 5 && (await nodes())[0].params.stepReference === 1);
      const shoreHeights = await grid();
      await ev(`document.getElementById('undo').click(); true`); await ready(ev);
      check('undo restores only the landform shore layers', (await nodes())[0].params.terraces === 0 && (await nodes())[0].params.fingers === 1);
      const noLayerHeights = await grid(), changed = shoreHeights.filter((h,i)=>Math.abs(h-noLayerHeights[i])>1).length;
      check('shore layers change actual landform heights', changed > 5, {changed});
      await ev(`document.querySelector('#layers [data-index="0"] .layer-name').click(); true`);
      await setValue('sec-terraces', 5); await setValue('water-deep', 2, 'change'); await ready(ev);
      check('one shared step count and flat share replace shore duplicates', await ev(`['shore-layers','layer-ledge','layer-rough','layer-style'].every(id=>!document.getElementById(id+'-control'))&&!document.getElementById('sec-terraces-control').hidden&&!document.getElementById('sec-ledge-control').hidden`));
      await setValue('lf-step-reference',0);await ready(ev);
      check('profile mode keeps the shared count and hides shore-only settings', (await nodes())[0].params.terraces===5 && await ev(`document.getElementById('layer-px-control').hidden&&!document.getElementById('sec-breakup-control').hidden&&document.getElementById('sec-terraces').max==='8'`));
      await setValue('lf-step-reference',2);await ready(ev);
      check('circular shoreline mode shows circular settings', await ev(`!document.getElementById('layer-circle-control').hidden&&document.getElementById('lava-spread-control').hidden&&document.getElementById('sec-breakup-control').hidden&&document.getElementById('sec-terraces').max==='12'`));
      await setValue('sec-terraces',11);await setValue('sec-ledge',95);await setValue('lf-step-reference',0);await ready(ev);
      check('switching to profile clamps shared values to its supported range', (await nodes())[0].params.terraces===8 && (await nodes())[0].params.ledge===.9);
      await ev(`document.getElementById('undo').click(); true`);await ready(ev);
      check('undo restores the previous step mode and shared values atomically', (await nodes())[0].params.stepReference===2 && (await nodes())[0].params.terraces===11 && (await nodes())[0].params.ledge===.95);
      const savedShore = (await nodes())[0].params, hsShore = await grid(); await sleep(1500);
      await send('Page.navigate', {url}); await ready(ev); await ev('sculptCanvas.zoom(1); true'); await sleep(500);
      check('shore parameters survive autosave and reload', same(savedShore, (await nodes())[0].params));
      const hsReloaded = await grid(); check('shore heights survive reload', hsReloaded.every((h,i)=>Math.abs(h-hsShore[i])<1e-3));
    } catch (err) { res.error = err.message; bad++; }
    res.console = logs.filter(l => !/favicon/.test(l)); if (res.console.length) bad++;
    return res;
  });
  console.log(JSON.stringify(r));
}
await Promise.all(worlds.map((world, i) => editWorld(world, port + i)));
process.exit(bad ? 1 : 0);
