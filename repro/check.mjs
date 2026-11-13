// Focused checks. Planning is side-effect free so --list never builds, renders or starts a browser.
import {readdirSync, existsSync, mkdirSync, openSync, closeSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const optional = /\.(?:gpu|config|export|build|features)\.test\.mjs$/;
export const usage = `Usage: repro/check.sh [quick|browser|engine|export|features|config|site] [options]
  quick     Node unit tests and the world-name gate (default; no Python, Go or GPU)
  browser   One world's brush/undo smoke, without export; requires --server URL --port N
  engine    GPU height tests, regional replay and repeat checks on three authored fixtures
  features  CPU sprite generation, variants and burn animation checks
  export    Go exporter tests and native/WebAssembly byte parity
  config    Go config/server tests and generated configuration integration tests
  site      Static build integration test (Go)
Options:
  --test FILE     quick: run only this unit test file (repeatable)
  --scene FILE    engine: replace the default fixtures (repeatable)
  --worlds LIST   browser: replace the default world, green
  --server URL --port N  browser: your own server and CDP port
  --out DIR       logs and browser output (default: $R/check/<worktree>)
  --list          print the selected commands without running them
Expensive visual sweeps, benchmarks and retail comparisons are standalone tools.
The old land/full tiers are retired; select checks relevant to your change.`;

export function planChecks(argv) {
  const args = [...argv], mode = args[0] && !args[0].startsWith('-') ? args.shift() : 'quick';
  if (!['quick', 'browser', 'engine', 'export', 'features', 'config', 'site'].includes(mode)) throw new Error(`Unknown check group: ${mode}.\n${usage}`);
  const options = {}, tests = [], scenes = [];
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === '--list') { options.list = true; continue; }
    if (!['--test', '--scene', '--worlds', '--server', '--port', '--out'].includes(key)) throw new Error(`Unknown option: ${key}`);
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Expected a value after ${key}`);
    if (key === '--test') tests.push(value);
    else if (key === '--scene') scenes.push(value);
    else options[key.slice(2)] = value;
  }
  if (tests.length && mode !== 'quick') throw new Error('--test is only for quick; run an integration test directly with node --test.');
  if (scenes.length && mode !== 'engine') throw new Error('--scene is only for engine.');
  if (mode !== 'browser' && ['server', 'port', 'worlds'].some(k => options[k] !== undefined)) throw new Error('--server, --port and --worlds are only for browser. Use --scene to select engine fixtures; quick does not render scenes.');
  const out = resolve(options.out || join(process.env.R || '/private/tmp/nanolathe-map-editor', 'check', basename(repo)));
  const steps = [], node = (name, ...args) => {
    if (args[0] === '--test' && args.length === 1) throw new Error(`No tests found for ${name}; refusing automatic test discovery.`);
    steps.push({name, command: process.execPath, args});
  };
  const files = readdirSync(join(repo, 'repro')).filter(f => f.endsWith('.test.mjs')).sort();
  const testFiles = suffix => files.filter(f => f.endsWith(suffix)).map(f => join(repo, 'repro', f));
  if (mode === 'quick') {
    const selected = tests.length ? tests.map(f => resolve(f)) : files.filter(f => !optional.test(f)).map(f => join(repo, 'repro', f));
    for (const file of selected) {
      if (dirname(file) !== join(repo, 'repro') || !files.includes(basename(file)) || optional.test(file)) throw new Error(`Not a quick unit test: ${file}. Run it explicitly with node --test.`);
    }
    node('unit', '--test', ...selected);
    steps.push({name: 'gate', command: 'sh', args: [join(repo, 'repro/gate.sh')]});
  } else if (mode === 'browser') {
    if (!options.server || !options.port || !Number.isInteger(Number(options.port)) || Number(options.port) < 1024 || Number(options.port) > 65535) throw new Error('browser requires --server URL and --port N (your own server and CDP port).');
    const worlds = (options.worlds || 'green').split(',');
    for (const world of worlds) if (!/^[a-z]+$/.test(world) || !existsSync(join(repo, 'materials', `${world}.json`))) throw new Error(`Unknown world: ${world}`);
    node('smoke', join(repo, 'repro/smoke.mjs'), '--server', options.server, '--port', options.port, '--worlds', worlds.join(','), '--jobs', '1', '--no-export', '--out', join(out, 'smoke'));
  } else if (mode === 'engine') {
    const selected = scenes.length ? scenes.map(f => resolve(f)) : ['green-landform', 'lava-shallow', 'ice-facets'].map(f => join(repo, 'repro/shape-scenes', `${f}.json`));
    for (const file of selected) if (!file.endsWith('.json') || !existsSync(file)) throw new Error(`Scene not found: ${file}`);
    node('gpu', '--test', ...testFiles('.gpu.test.mjs'));
    node('regional', join(repo, 'repro/regional.mjs'), ...selected);
    node('repeat', join(repo, 'repro/shapecheck.mjs'), ...selected, '--out', join(out, 'repeat'));
  } else if (mode === 'export') {
    steps.push({name: 'go-export', command: 'go', args: ['test', './export']});
    node('export', '--test', ...testFiles('.export.test.mjs'));
  } else {
    if (mode === 'config') steps.push({name: 'go-site', command: 'go', args: ['test', './internal/site', './cmd/terraform']});
    node(mode, '--test', ...testFiles(mode === 'site' ? '.build.test.mjs' : `.${mode}.test.mjs`));
  }
  return {mode, out, list: !!options.list, steps};
}

async function main() {
  if (process.argv.slice(2).some(a => a === '--help' || a === '-h')) { console.log(usage); return; }
  const plan = planChecks(process.argv.slice(2));
  if (plan.list) {
    for (const s of plan.steps) console.log(`${s.name}: ${[s.command, ...s.args].map(a => JSON.stringify(a)).join(' ')}`);
    return;
  }
  process.exitCode = await runChecks(plan) ? 1 : 0;
}

export async function runChecks(plan) {
  mkdirSync(plan.out, {recursive: true});
  let failures = 0;
  for (const s of plan.steps) {
    const log = join(plan.out, `${s.name}.log`), fd = openSync(log, 'w'), start = performance.now();
    const code = await new Promise(resolve => {
      const child = spawn(s.command, s.args, {cwd: repo, stdio: ['ignore', fd, fd]});
      child.once('error', error => { console.error(error.message); resolve(1); });
      child.once('close', code => resolve(code ?? 1));
    });
    closeSync(fd);
    if (code) failures++;
    console.log(`${s.name.padEnd(12)} ${(code ? 'FAILED' : 'ok').padEnd(6)} ${((performance.now() - start) / 1000).toFixed(2)}s  ${log}`);
  }
  console.log(`${plan.mode}: ${failures ? `${failures} failed` : 'all passed'}`);
  return failures;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 2; });
