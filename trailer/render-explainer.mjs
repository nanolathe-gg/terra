// Render the explainer (trailer/explainer.html) from a layers folder (trailer/layers.mjs) to an mp4, in our own headless Chrome.
//   node trailer/render-explainer.mjs <layers-dir> <out.mp4> --port <cdp> [--stills 4,9.5,16] [--page 'slate.html?title=..']
// --stills writes PNGs of those seconds next to <out.mp4> instead of the video (for checking a shot).
import {browser, encoder} from './cdp.mjs';
import {createServer} from 'node:http';
import {readFile, writeFile} from 'node:fs/promises';
import {dirname, extname, join, normalize, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : fallback; };
const port = Number(opt('--port', 0)), stills = opt('--stills', ''), page = opt('--page', 'explainer.html');
const [layers, out] = args.map(a => resolve(a));
if (!layers || !out || !port) { console.error('usage: node trailer/render-explainer.mjs <layers-dir> <out.mp4> --port <cdp>'); process.exit(2); }
const here = dirname(fileURLToPath(import.meta.url));
const types = {'.htm': 'text/html', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.f32': 'application/octet-stream', '.js': 'text/javascript', '.mjs': 'text/javascript'};
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\/+/, '');
  const file = path.startsWith('layers/') ? join(layers, path.slice(7)) : join(here, path);
  let body; try { body = await readFile(file); } catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, {'content-type': types[extname(file)] ?? 'application/octet-stream'}); res.end(body);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/${page}`;
const b = await browser({port, width: 1280, height: 720, profile: join(dirname(out), `profile-${port}`)});
try {
  await b.send('Page.navigate', {url});
  for (let i = 0; i < 300 && !(await b.ev('window.ready === true').catch(() => false)); i++) { if (b.logs.length) throw new Error(b.logs.join('\n')); await new Promise(r => setTimeout(r, 100)); }
  const frames = await b.ev('window.frames');
  if (!frames) throw new Error('the explainer never became ready: ' + b.logs.join('\n'));
  if (stills) {
    for (const s of stills.split(',').map(Number)) { await b.ev(`frame(${Math.round(s * 30)}); true`); await writeFile(out.replace(/\.mp4$/, '') + `-${s}s.png`, await b.shot('png')); }
  } else {
    const t0 = Date.now(), enc = encoder(out);
    for (let i = 0; i < frames; i++) { await b.ev(`frame(${i}); true`); await enc.write(await b.shot()); }
    await enc.end();
    console.log(`${page.split('?')[0]}: ${frames} frames in ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${out}`);
  }
  if (b.logs.length) console.error('console:', b.logs.slice(0, 5).join('\n'));
} finally { await b.close(); server.close(); }
