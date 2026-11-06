// Burn-sequence statistics against spec 15/16 (lead-in, repeating cycle, tail, flame arch, tongues, sparks, colors).
//   node measure/feature_gen_burn_stats.mjs [module]
import {pathToFileURL} from 'node:url';
const mod = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : '../sculpt-feature-gen.js');
const fire = i => i >= 192 && i <= 216;
const mean = a => a.reduce((s, v) => s + v, 0) / (a.length || 1);
const sig = f => `${f.w}x${f.h}:` + Buffer.from(f.idx).toString('hex') + Buffer.from(f.a).toString('hex');
const px = (f, x, y) => (x >= 0 && y >= 0 && x < f.w && y < f.h && f.a[y * f.w + x]) ? f.idx[y * f.w + x] : -1;
function treeStats(frames, burnt) {
  const o = {};
  const sh = f => { let d = 0, n = 0; for (let k = 0; k < f.w * f.h; k++) if (f.a[k]) { d++; if (fire(f.idx[k])) n++; } return n / Math.max(d, 1); };
  o.tail91to95 = frames.slice(91, 96).map(f => +sh(f).toFixed(2));
  o.cycleIdentical = frames.slice(9, 80).every((f, i) => sig(f) === sig(frames[9 + (i % 14)]));
  o.uniqueFrames = new Set(frames.map(sig)).size;
  o.fireShare = {lead: frames.slice(1, 9).map(f => +sh(f).toFixed(2)), cycleMean: +mean(frames.slice(9, 23).map(sh)).toFixed(3), cycleMin: +Math.min(...frames.slice(9, 23).map(sh)).toFixed(2), cycleMax: +Math.max(...frames.slice(9, 23).map(sh)).toFixed(2), tail: +mean(frames.slice(80, 90).map(sh)).toFixed(2)};
  // flame metrics on cycle frames (anchor-relative)
  const top = [], width = [], iso = [], iou = [], tongues = [], cnt = {}; let nfire = 0;
  const cyc = frames.slice(9, 23);
  cyc.forEach((f, n) => {
    let tp = f.h, x0 = f.w, x1 = 0, isoN = 0; const topCol = new Array(f.w).fill(f.h);
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) { const i = px(f, x, y); if (i < 0 || !fire(i)) continue; nfire++; cnt[i] = (cnt[i] || 0) + 1; tp = Math.min(tp, y); x0 = Math.min(x0, x); x1 = Math.max(x1, x); topCol[x] = Math.min(topCol[x], y);
      let nb = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && px(f, x + dx, y + dy) >= 0 && fire(px(f, x + dx, y + dy))) nb++; if (!nb) isoN++; }
    top.push(f.ay - tp); width.push(x1 - x0 + 1); iso.push(isoN);
    let t = 0; for (let x = 2; x < f.w - 2; x++) { const v = topCol[x]; if (v < f.h && v <= topCol[x - 1] && v < topCol[x + 1] && v <= topCol[x - 2] && v < topCol[x + 2] && f.ay - v >= 24) t++; } tongues.push(t);
    const g = cyc[(n + 1) % 14]; let inter = 0, uni = 0; // IoU of fire masks, aligned at the anchor
    for (let y = -f.ay - 5; y < f.h + 5; y++) for (let x = -f.ax - 20; x < f.w + 20; x++) { const a = px(f, x + 0, y + 0), bx = x - f.ax + g.ax, by = y - f.ay + g.ay; const bb = px(g, bx, by); const A = a >= 0 && fire(a), B = bb >= 0 && fire(bb); if (A && B) inter++; if (A || B) uni++; }
    iou.push(inter / Math.max(uni, 1));
  });
  // IoU above is in sprite coordinates shifted by anchor: recompute properly
  o.flameTopAboveAnchor = +mean(top).toFixed(1); o.flameWidth = +mean(width).toFixed(1); o.sparksPerFrame = +mean(iso).toFixed(1); o.tonguesPerFrame = +mean(tongues).toFixed(1); o.iouConsecutive = +mean(iou).toFixed(2);
  o.share208 = +(cnt[208] / nfire).toFixed(3); o.share195 = +(cnt[195] / nfire).toFixed(3);
  const last = frames[95]; let em = 0, dr = 0; for (let k = 0; k < last.w * last.h; k++) if (last.a[k]) { dr++; if (fire(last.idx[k])) em++; }
  o.lastFrame = {w: last.w, h: last.h, ax: last.ax, ay: last.ay, burnt: burnt ? [burnt.w, burnt.h, burnt.ax, burnt.ay] : null, embers: +(em / dr).toFixed(2)};
  // flame base arch: lowest fire row (relative to anchor, positive = below) per column offset band, over cycle frames
  const bands = {'0-7': [], '7-12': [], '12-18': [], '18-26': []}, gone = {'18-26': 0, n: 0};
  for (const f of cyc) for (let dx = 0; dx <= 26; dx++) for (const sg of [-1, 1]) { const x = f.ax + sg * dx; if (x < 0 || x >= f.w) continue; let low = null; for (let y = f.h - 1; y >= 0; y--) { const i = px(f, x, y); if (i >= 0 && fire(i)) { low = y - f.ay; break; } }
    const key = dx <= 7 ? '0-7' : dx <= 12 ? '7-12' : dx <= 18 ? '12-18' : '18-26'; if (low !== null) bands[key].push(-low); if (key === '18-26') { gone.n++; if (low === null) gone['18-26']++; } }
  o.baseArch = Object.fromEntries(Object.entries(bands).map(([k, v]) => [k, +mean(v).toFixed(1)])); o.farFlankNoFire = +(gone['18-26'] / gone.n).toFixed(2);
  return o;
}
const out = {};
for (const [name, params] of [['broadleaf', {}], ['conifer', {species: 'conifer', height: 61, width: 0.5}]]) {
  const t = mod.generateFeature('tree', params, 1000);
  out[name] = treeStats(t.burn, t.burnt.body);
}
const s = mod.generateFeature('shrub', {}, 4001), sb = s.burn;
const sf = f => { let d = 0, n = 0; for (let k = 0; k < f.w * f.h; k++) if (f.a[k]) { d++; if (fire(f.idx[k])) n++; } return n / Math.max(d, 1); };
out.shrub = {frames: sb.length, fireShareMean: +mean(sb.slice(2, 41).map(sf)).toFixed(2), lastFireShare: +sf(sb[41]).toFixed(2), width: +mean(sb.slice(2, 41).map(f => f.w)).toFixed(1), cycleIdentical: sb.slice(2, 41).every((f, i) => sig(f) === sig(sb[2 + (i % 14)]))};
console.log(JSON.stringify(out, null, 1));
