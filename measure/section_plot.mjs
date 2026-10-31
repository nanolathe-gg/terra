// H15: plots of classic against preset along the stroke's cross-section, from measure/section_check.mjs's section-check.json.
//   node measure/section_plot.mjs <section-check.json> <out-dir>
// One SVG per kind: the heights on the column through the middle of the stroke, one panel per size/amount/softness case listed in CASES.
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
const [file, out] = process.argv.slice(2); mkdirSync(out, {recursive: true});
const j = JSON.parse(readFileSync(file, 'utf8')), W = 275, X = 145;   // the sampling grid of section_check.mjs: 275 columns, column 145 is x = 580
const CASES = {plateau: [[280, 80, .5], [280, 80, 0], [280, 80, 1]], offset: [[280, 80, .5]], lower: [[280, 80, .5]], mountain: [[280, 80, .5], [280, 80, 0], [280, 80, 1], [280, 160, 1]],
  hill: [[280, 80, .5], [280, 80, .88], [280, 160, .5]], hillPlain: [[280, 80, .5]], deep: [[280, 80, .5]], shallow: [[280, 80, .5]]};
for (const [kind, list] of Object.entries(CASES)) {
  const panels = list.map(([size, amount, soft], n) => {
    const s = j.samples[JSON.stringify([kind, size, amount, soft])]; if (!s) return '';
    const col = a => { const o = []; for (let i = X; i < a.length; i += W) o.push(a[i]); return o; }, c = col(s.classic), p = col(s.preset);
    const lo = Math.min(...c, ...p), hi = Math.max(...c, ...p), x = i => 10 + i * 280 / (c.length - 1), y = v => 150 - (v - lo) / Math.max(hi - lo, 1) * 130;
    const line = (a, color) => `<polyline fill="none" stroke="${color}" stroke-width="1.5" points="${a.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}"/>`;
    return `<g transform="translate(${n * 300},20)"><text x="10" y="-6" font-size="11">${kind} ${size}px amount ${amount} softness ${soft}</text>${line(c, '#222')}${line(p, '#d33')}</g>`;
  }).join('');
  writeFileSync(`${out}/${kind}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="${list.length * 300}" height="190" font-family="sans-serif"><rect width="100%" height="100%" fill="#fff"/>${panels}<text x="10" y="184" font-size="11" fill="#222">black: classic, red: preset (height along the column through the stroke)</text></svg>`);
}
