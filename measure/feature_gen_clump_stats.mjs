// Bright-pixel clustering of the generated broadleaf trees: clumps of 4+ px (4-connected) of index 37/38 and of the wider bright set,
// their median and largest size, and the share of bright pixels with no bright 8-neighbor.
//   node measure/feature_gen_clump_stats.mjs [module]
import {pathToFileURL} from 'node:url';
const mod = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : '../sculpt-feature-gen.js');
const sets = {'37/38': [37, 38], 'bright set (37-39, 34-36, 233, 234, 54, 53)': [37, 38, 39, 36, 35, 34, 233, 234, 54, 53]};
const out = {};
for (const [name, list] of Object.entries(sets)) {
  const acc = {clumps: [], median: [], largest: [], isolated: [], inClumps: []};
  for (let i = 0; i < 12; i++) {
    const s = mod.generateFeature('tree', {}, 1000 + i * 7).body, m = new Uint8Array(s.w * s.h);
    for (let k = 0; k < m.length; k++) m[k] = s.a[k] && list.includes(s.idx[k]) ? 1 : 0;
    const seen = new Uint8Array(m.length), sizes = []; let total = 0, iso = 0;
    for (let k = 0; k < m.length; k++) if (m[k]) {
      total++; const x = k % s.w, y = (k / s.w) | 0; let nb = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && x + dx >= 0 && x + dx < s.w && y + dy >= 0 && y + dy < s.h && m[(y + dy) * s.w + x + dx]) nb++;
      if (!nb) iso++;
    }
    for (let k = 0; k < m.length; k++) if (m[k] && !seen[k]) { const q = [k]; seen[k] = 1; let n = 0; while (q.length) { const c = q.pop(); n++; for (const d of [1, -1, s.w, -s.w]) { const nn = c + d; if (nn >= 0 && nn < m.length && m[nn] && !seen[nn] && Math.abs((nn % s.w) - (c % s.w)) <= 1) { seen[nn] = 1; q.push(nn); } } } sizes.push(n); }
    const big = sizes.filter(n => n >= 4).sort((a, b) => a - b);
    acc.clumps.push(big.length); acc.median.push(big[big.length >> 1] || 0); acc.largest.push(big[big.length - 1] || 0); acc.isolated.push(iso / Math.max(total, 1)); acc.inClumps.push(big.reduce((a, b) => a + b, 0) / Math.max(total, 1));
  }
  const mean = a => +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(3);
  out[name] = Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, mean(v)]));
}
console.log(JSON.stringify(out, null, 1));
