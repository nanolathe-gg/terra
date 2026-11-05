// Burn-sequence statistics for the generated tree and shrub (spec section 8): fire share, flame height, frame-to-frame change.
//   node measure/feature_gen_burn_stats.mjs
import {generateFeature} from '../sculpt-feature-gen.js';
const fire = i => i >= 192 && i <= 215 && i !== 208 || i === 208;
function stats(frames) {
  const share = [], height = [], change = [], size = [];
  frames.forEach((f, n) => {
    let d = 0, fp = 0, top = f.h;
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) { const k = y * f.w + x; if (!f.a[k]) continue; d++; if (fire(f.idx[k])) { fp++; top = Math.min(top, y); } }
    share.push(fp / Math.max(d, 1)); height.push(fp ? f.ay - top : 0); size.push([f.w, f.h]);
    if (n) { const p = frames[n - 1]; let u = 0, df = 0; const ox = f.ax - p.ax, oy = f.ay - p.ay;
      const get = (s, x, y) => (x >= 0 && y >= 0 && x < s.w && y < s.h && s.a[y * s.w + x]) ? s.idx[y * s.w + x] : -1;
      const W = Math.max(f.w, p.w) + 4, H = Math.max(f.h, p.h) + 4;
      for (let y = -2; y < H; y++) for (let x = -2; x < W; x++) { const a = get(f, x, y), b = get(p, x - ox, y - oy); if (a < 0 && b < 0) continue; u++; if (a !== b) df++; }
      change.push(df / Math.max(u, 1)); }
  });
  const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
  return {fireShareMean_mid: mean(share.slice(10, share.length - 12)), fireShareMax: Math.max(...share), flameHeightMean: mean(height.filter(h => h)), flameHeightMax: Math.max(...height), changeMean: mean(change.slice(5, -3)), lastFrame: size[size.length - 1], firstFrame: size[0]};
}
const t = generateFeature('tree', {}, 1000), s = generateFeature('shrub', {}, 4001);
console.log('tree', JSON.stringify(stats(t.burn)));
console.log('shrub', JSON.stringify(stats(s.burn)));
