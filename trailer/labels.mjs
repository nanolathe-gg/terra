// Step labels over the real-time take (docs/TRAILER.md, "Combined cut"): each step capture-realtime.mjs marked gets a short label, drawn
// as a transparent 1280x720 PNG (a dark pill over the map, centred between the navigator and the zoom bar) in our own headless Chrome;
// labels.json gives each label's file and its seconds on the take. assemble-combined.sh lays them over the take with short fades.
//   node trailer/labels.mjs <take-dir>/realtime-raw.marks.json <take-dir>/labels --port <cdp>
import {browser} from './cdp.mjs';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : fallback; };
const port = Number(opt('--port', 0)), [marksFile, out] = args;
if (!marksFile || !out || !port) { console.error('usage: node trailer/labels.mjs <marks.json> <out-dir> --port <cdp>'); process.exit(2); }
const marks = JSON.parse(readFileSync(marksFile, 'utf8'));
// The label for each marked step; a label lasts until the next labelled step (the last until the take ends).
const STEPS = [['mountain', 'Draw a mountain range'], ['hills', 'Hills, a lake, a crater'], ['seed', 'New seed: a different mountain'],
  ['height', 'Taller? Just drag.'], ['wander', 'More wander, more natural'], ['features', 'Metal and trees'], ['exportPane', 'Export for Total Annihilation']];
const steps = STEPS.filter(([k]) => Number.isFinite(marks[k]));
mkdirSync(out, {recursive: true});
const b = await browser({port, width: 1280, height: 720, profile: join(out, `profile-${port}`)});
try {
  const list = [];
  for (const [i, [key, text]] of steps.entries()) {
    const png = await b.ev(`(() => { const c = document.createElement('canvas'); c.width = 1280; c.height = 720; const x = c.getContext('2d');
      x.font = '600 30px "Helvetica Neue", Helvetica, Arial, sans-serif'; const w = x.measureText(${JSON.stringify(text)}).width + 84, cx = 520, y = 588;
      x.fillStyle = 'rgba(12,16,14,.78)'; x.beginPath(); x.roundRect(cx - w / 2, y, w, 54, 27); x.fill();
      x.fillStyle = '#9fe08a'; x.beginPath(); x.arc(cx - w / 2 + 30, y + 27, 7, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(${JSON.stringify(text)}, cx + 17, y + 28);
      return c.toDataURL('image/png'); })()`);
    const file = `label-${i}.png`; writeFileSync(join(out, file), Buffer.from(png.split(',')[1], 'base64'));
    const next = steps[i + 1]; list.push({file, text, from: marks[key], to: next ? marks[next[0]] - 0.15 : null});
  }
  writeFileSync(join(out, 'labels.json'), JSON.stringify(list, null, 1) + '\n');
  console.log(`labels: ${list.length} -> ${out}`);
} finally { await b.close(); }
