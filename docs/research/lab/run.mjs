// Terrain lab runner: renders experiments headless and saves one PNG per variant, a sheet of all of them, and timings.
//   node docs/research/lab/run.mjs <exp> [<exp> ...] [--out DIR] [--query "w=640&h=448&world=desert"] [--v a,b]
//        [--timeout SECONDS] (per experiment page, default 1800) [--heights] (also <exp>--<variant>.f32: the heights, row-major f32)
// Each variant's PNG is the canvas's own bytes (toDataURL), so two runs of the same scene give identical files.
// Serves the repository root on a free local port, opens Chromium with WebGPU (SwiftShader when there is no GPU), and
// waits for window.__lab. Exits 1 if a shader fails to compile. Playwright is resolved from the global install; set
// PLAYWRIGHT_MODULE to its index.js if it lives elsewhere. SwiftShader timings are a CPU rasterizer's: compare
// variants with each other, never with a real GPU.
import {createServer} from 'node:http';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {execSync} from 'node:child_process';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : d; };
const out = path.resolve(opt('--out', path.join(root, 'lab-out')));
const query = opt('--query', '');
const vsel = opt('--v', '');
const timeout = Number(opt('--timeout', 1800)) * 1000;
const saveHeights = (() => { const i = args.indexOf('--heights'); if (i >= 0) args.splice(i, 1); return i >= 0; })();
const exps = args;
if (!exps.length) { console.error('usage: node docs/research/lab/run.mjs <exp> [...] [--out DIR] [--query "..."] [--v a,b]'); process.exit(2); }

let pwPath = process.env.PLAYWRIGHT_MODULE;
if (!pwPath) { try { pwPath = createRequire(import.meta.url).resolve('playwright'); } catch { pwPath = path.join(execSync('npm root -g').toString().trim(), 'playwright', 'index.js'); } }
const {chromium} = (await import(pwPath)).default ?? await import(pwPath);

const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wgsl': 'text/plain', '.png': 'image/png'};
const server = createServer(async (req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
  try { const body = await readFile(p); res.writeHead(200, {'content-type': TYPES[path.extname(p)] || 'application/octet-stream'}); res.end(body); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
await mkdir(out, {recursive: true});
const browser = await chromium.launch({args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader', '--no-sandbox']});
let failed = false;
const summary = {};
for (const exp of exps) {
  const page = await browser.newPage({viewport: {width: 1700, height: 1200}});
  page.on('pageerror', e => console.log(`[${exp}] pageerror`, e.message));
  const q = `exp=${exp}${query ? '&' + query : ''}${vsel ? '&v=' + vsel : ''}${saveHeights ? '&readback=1' : ''}`;
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${port}/docs/research/lab/index.html?${q}`);
  await page.waitForFunction(() => window.__lab?.done, null, {timeout, polling: 500});
  const lab = await page.evaluate(() => ({...window.__lab, heights: undefined}));
  if (lab.error) { console.log(`[${exp}] FAILED`, lab.error.join('\n')); console.log(await page.evaluate(() => document.getElementById('log').textContent)); failed = true; await page.close(); continue; }
  const pngs = await page.evaluate(() => window.__labPng || {});
  for (const r of lab.results) {
    await writeFile(path.join(out, `${exp}--${r.label}.png`), Buffer.from(pngs[r.label].split(',')[1], 'base64'));
    if (saveHeights) {
      const h = await page.evaluate(label => Array.from(window.__lab.heights[label] || []), r.label);
      await writeFile(path.join(out, `${exp}--${r.label}.f32`), Buffer.from(new Float32Array(h).buffer));
    }
  }
  await (await page.$('#grid')).screenshot({path: path.join(out, `${exp}--sheet.png`)});
  summary[exp] = lab.results.map(r => ({label: r.label, ms: r.ms}));
  console.log(`[${exp}] ${lab.results.length} variants in ${((Date.now() - t0) / 1000).toFixed(1)} s:`, lab.results.map(r => `${r.label} ${Object.entries(r.ms).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(' ')}`).join(' | '));
  await page.close();
}
await writeFile(path.join(out, 'timings.json'), JSON.stringify(summary, null, 1));
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
