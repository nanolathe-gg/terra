// Compare two height fields saved by `run.mjs --heights` (row-major f32 of the same size).
//   node docs/research/lab/compare-heights.mjs a.f32 b.f32 [--w 512] [--box x0,y0,x1,y1] [--ignore 2]
// Prints RMS, mean signed difference, max |difference| and the share of samples that differ by more than 0.5 units.
// --box limits the comparison to a rectangle (pixels); --ignore drops that many pixels at every window edge (the
// 1-px border the normal needs, or a simulation's edge effects).
import {readFileSync} from 'node:fs';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : d; };
const W = Number(opt('--w', 512)), ignore = Number(opt('--ignore', 0)), box = opt('--box', '');
const [fa, fb] = args;
if (!fa || !fb) { console.error('usage: node compare-heights.mjs a.f32 b.f32 [--w 512] [--box x0,y0,x1,y1] [--ignore 2]'); process.exit(2); }
const read = f => { const b = readFileSync(f); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
const a = read(fa), b = read(fb);
if (a.length !== b.length) { console.error(`sizes differ: ${a.length} and ${b.length} samples`); process.exit(1); }
const H = a.length / W;
let [x0, y0, x1, y1] = box ? box.split(',').map(Number) : [0, 0, W, H];
x0 = Math.max(x0, ignore); y0 = Math.max(y0, ignore); x1 = Math.min(x1, W - ignore); y1 = Math.min(y1, H - ignore);
let n = 0, sq = 0, sum = 0, max = 0, over = 0;
for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
  const d = b[y * W + x] - a[y * W + x];
  n++; sq += d * d; sum += d; max = Math.max(max, Math.abs(d)); if (Math.abs(d) > 0.5) over++;
}
console.log(JSON.stringify({samples: n, rms: +Math.sqrt(sq / n).toFixed(4), meanDiff: +(sum / n).toFixed(4), maxAbs: +max.toFixed(4), over05: +(over / n).toFixed(4)}));
