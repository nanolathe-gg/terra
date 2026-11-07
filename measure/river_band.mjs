// The River preset's bends against retail TA rivers (the riverfix card): the stroke-time migration (sculpt-river.js) on three test paths, a straight line, a
// gentle curve and an S, each 1650 px long on a 4x4 map, over 24 stroke seeds. Per path: the farthest the channel stands from the drawn line (median and
// largest, in widths), the length over the drawn length, the window and bend statistics of measure/river_retail.py on the channel (the same definitions:
// over windows of 4 and 8 widths of arc, the arc over the chord and the farthest the course stands from the chord; bends at inflections where the heading has
// turned 15 degrees, wavelength twice their median spacing, amplitude the median farthest point of a half bend from its chord), the oxbows a river leaves and
// the JS time per stroke. Retail (river_retail.py's table, courses that do not turn through a junction): sin8 1.03 to 1.20 (median 1.12), off8 0.4 to 1.6
// widths, bends 2.4 to 6 widths long and .1 to .6 widths high.
//   node measure/river_band.mjs [--width 48] [--wander 0,24,...,192] [--checkout DIR]     (DIR: another checkout's sculpt-river.js, e.g. main's, for a before)
import {pathToFileURL} from 'node:url';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const checkout = resolve(opt('--checkout', resolve(dirname(fileURLToPath(import.meta.url)), '..')));
const R = await import(pathToFileURL(checkout + '/sculpt-river.js').href);
const width = Number(opt("--width", 48)), wanders = opt("--wander", "0,24,48,72,96,120,144,168,192").split(",").map(Number), W = Math.max(R.RIVER_MIN_WIDTH, width);
export const PATHS = {
  straight: Array.from({length: 12}, (_, i) => ({x: 200 + i * 150, y: 1088})),
  gentle: Array.from({length: 23}, (_, i) => { const t = i / 22; return {x: 200 + 1650 * t, y: 1188 - 400 * t * (1 - t)}; }),
  s: Array.from({length: 33}, (_, i) => { const t = i / 32; return {x: 200 + 1650 * t, y: 1088 + 260 * Math.sin(2 * Math.PI * t)}; }),
};
const length = p => { let s = 0; for (let i = 1; i < p.length; i++) s += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y); return s; };
const near = (line, p) => { let best = Infinity; for (let i = 0; i + 1 < line.length; i++) { const a = line[i], b = line[i + 1], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0; best = Math.min(best, Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t)); } return best; };
const median = a => { const s = a.filter(v => v !== null).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
// The course at 2 px, smoothed over .35 of a width (river_retail.py smooths its 16-px axis the same way).
function course(p) {
  const d = [p[0]]; let carry = 0;
  for (let i = 1; i < p.length; i++) { const a = p[i - 1], b = p[i], L = Math.hypot(b.x - a.x, b.y - a.y); let t = 2 - carry; while (t <= L) { d.push({x: a.x + (b.x - a.x) * t / L, y: a.y + (b.y - a.y) * t / L}); t += 2; } carry = L - (t - 2); }
  const sig = Math.max(1, .35 * W / 2), r = Math.ceil(3 * sig), w = Array.from({length: 2 * r + 1}, (_, k) => Math.exp(-((k - r) ** 2) / (2 * sig * sig)));
  return d.map((_, i) => { let x = 0, y = 0, s = 0; for (let k = -r; k <= r; k++) { const j = Math.max(0, Math.min(d.length - 1, i + k)); x += w[k + r] * d[j].x; y += w[k + r] * d[j].y; s += w[k + r]; } return {x: x / s, y: y / s}; });
}
const farFromChord = (s, i, j) => { const cx = s[j].x - s[i].x, cy = s[j].y - s[i].y, cl = Math.hypot(cx, cy); let o = 0; for (let m = i; m <= j; m++) o = Math.max(o, Math.abs(((s[m].x - s[i].x) * cy - (s[m].y - s[i].y) * cx) / Math.max(cl, 1e-9))); return [o, cl]; };
function stats(path) {
  const s = course(path), cum = [0];
  for (let i = 1; i < s.length; i++) cum.push(cum[i - 1] + Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y));
  const out = {};
  for (const k of [4, 8]) {
    const sins = [], offs = []; let j = 0;
    for (let i = 0; i < s.length; i += Math.max(1, Math.floor(s.length / 400))) {
      while (j < s.length && cum[j] < cum[i] + k * W) j++;
      if (j >= s.length) break;
      const [o, cl] = farFromChord(s, i, j); if (cl > 1e-6) { sins.push((cum[j] - cum[i]) / cl); offs.push(o / W); }
    }
    out['sin' + k] = median(sins); if (k === 8) out.off8 = median(offs);
  }
  // bends: the heading's turn, the curvature smoothed over half a width, its sign changes where the heading has turned 15 degrees since the last kept one
  const th = [];
  for (let i = 0; i < s.length; i++) { const a = s[Math.max(0, i - 1)], b = s[Math.min(s.length - 1, i + 1)]; let t = Math.atan2(b.y - a.y, b.x - a.x); if (i) { while (t - th[i - 1] > Math.PI) t -= 2 * Math.PI; while (t - th[i - 1] < -Math.PI) t += 2 * Math.PI; } th.push(t); }
  const kap = th.map((_, i) => (th[Math.min(s.length - 1, i + 1)] - th[Math.max(0, i - 1)]) / 4), sig = Math.max(1, .5 * W / 2), r = Math.ceil(3 * sig);
  const ks = kap.map((_, i) => { let v = 0, z = 0; for (let k = -r; k <= r; k++) { const j = Math.max(0, Math.min(s.length - 1, i + k)), g = Math.exp(-k * k / (2 * sig * sig)); v += g * kap[j]; z += g; } return v / z; });
  const keep = [0];
  for (let i = 0; i + 1 < s.length; i++) if (Math.sign(ks[i + 1]) !== Math.sign(ks[i]) && Math.abs(th[i] - th[keep.at(-1)]) > 15 * Math.PI / 180) keep.push(i);
  keep.shift();
  if (keep.length >= 3) {
    out.wavelength = 2 * median(keep.slice(1).map((v, i) => cum[v] - cum[keep[i]])) / W;
    out.amplitude = median(keep.slice(1).map((v, i) => farFromChord(s, keep[i], v)[0])) / W;
  } else out.wavelength = out.amplitude = null;
  return out;
}
const f = (v, d = 2) => v === null || v === undefined ? '  -  ' : v.toFixed(d);
// Wander is the band in px here (sculpt-river.js riverBand); an older checkout (main before riverfix, where Wander was steps in 4s and the belt 8 widths) is run its own way.
const run = (pts, wander, seed) => R.riverBand ? R.migrateRiver(pts, {width: W, band: R.riverBand(wander, W), seed, bounds: {w: 2080, h: 2176}})
  : R.migrateRiver(pts, {width: W, steps: R.riverSteps(wander), seed, bounds: {w: 2080, h: 2176}});
console.log(`checkout ${checkout}, width ${width} px (channel ${W})`);
console.log('wander path      far med/max W  length  sin4   sin8   off8 W  bend wl W  amp W  oxbows  ms/stroke');
for (const wander of wanders) for (const [name, pts] of Object.entries(PATHS)) {
  const far = [], grow = [], st = [], ox = [], ms = [];
  for (let k = 0; k < 24; k++) {
    const t0 = performance.now(), m = run(pts, wander, (2701 + k * 7919) >>> 0);
    ms.push(performance.now() - t0);
    far.push(Math.max(...m.path.map(p => near(m.drawn, p))) / W); grow.push(length(m.path) / length(m.drawn)); ox.push(m.oxbows.length); st.push(stats(m.path));
  }
  const g = key => median(st.map(x => x[key]));
  console.log(`${String(wander).padStart(6)} ${name.padEnd(9)} ${f(median(far))} / ${f(Math.max(...far))}   ${f(median(grow), 3)}  ${f(g('sin4'), 3)}  ${f(g('sin8'), 3)}  ${f(g('off8'))}    ${f(g('wavelength'), 1)}       ${f(g('amplitude'))}   ${f(ox.reduce((a, b) => a + b, 0) / ox.length)}    ${f(median(ms), 1)}`);
}
