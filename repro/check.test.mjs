import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve, join} from 'node:path';
import {mkdtempSync, readFileSync, existsSync, unlinkSync, rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {planChecks, runChecks} from './check.mjs';

test('the default checks never build, render, launch a browser or invoke Python', () => {
  const {mode, steps} = planChecks([]);
  assert.equal(mode, 'quick');
  assert.deepEqual(steps.map(s => s.name), ['unit', 'gate']);
  const files = steps[0].args.slice(1);
  assert.ok(files.length > 20);
  assert.ok(files.every(f => f.endsWith('.test.mjs') && !/\.(gpu|config|export|build|features|assets)\.test\.mjs$/.test(f)));
  assert.ok(files.some(f => f.endsWith('/heights.test.mjs')), 'save/load and undo checks remain fast');
});

test('quick can select a single test and refuses expensive integration files', () => {
  const file = resolve('repro/paths.test.mjs');
  assert.deepEqual(planChecks(['quick', '--test', file]).steps[0].args, ['--test', file]);
  assert.throws(() => planChecks(['quick', '--test', 'repro/site.build.test.mjs']), /Not a quick/);
});

test('engine fixtures are actually scoped, and missing inputs fail before work starts', () => {
  const scene = resolve('repro/shape-scenes/green-landform.json');
  const steps = planChecks(['engine', '--scene', scene]).steps;
  assert.deepEqual(steps.find(s => s.name === 'regional').args.slice(1), [scene]);
  assert.equal(planChecks(['engine']).steps.find(s => s.name === 'regional').args.length, 4);
  assert.throws(() => planChecks(['engine', '--scene', 'missing.json']), /Scene not found/);
});

test('browser requires owned ports and selects just one world by default', () => {
  assert.throws(() => planChecks(['browser']), /requires --server/);
  const step = planChecks(['browser', '--server', 'http://127.0.0.1:8899', '--port', '9899']).steps[0];
  assert.equal(step.args[step.args.indexOf('--worlds') + 1], 'green');
  assert.ok(step.args.includes('--no-export'));
  assert.ok(!step.args.includes('--page8'));
  assert.throws(() => planChecks(['browser', '--server', 'http://127.0.0.1:8899', '--port', '9899', '--worlds', 'typo']), /Unknown world/);
});

test('old broad tiers and misapplied selectors fail with an actionable message', () => {
  for (const mode of ['land', 'full']) assert.throws(() => planChecks([mode]), /retired/);
  assert.throws(() => planChecks(['quick', '--worlds', 'green']), /quick does not render/);
  assert.throws(() => planChecks(['quick', '--out']), /Expected a value/);
  assert.throws(() => planChecks(['quick', '--typo']), /Unknown option/);
});

test('build, configuration and exporter checks are separate opt-in jobs', () => {
  assert.ok(planChecks(['site']).steps[0].args[1].endsWith('site.build.test.mjs'));
  assert.ok(planChecks(['features']).steps[0].args.slice(1).every(f => f.endsWith('.features.test.mjs')));
  assert.ok(planChecks(['config']).steps.find(s => s.name === 'config').args.slice(1).every(f => f.endsWith('.config.test.mjs')));
  assert.deepEqual(planChecks(['export']).steps.map(s => s.name), ['go-export', 'export']);
});

test('a failed child is reported and later selected checks still run', async () => {
  const out = mkdtempSync(join(tmpdir(), 'check-runner-'));
  try {
    const failures = await runChecks({mode: 'fixture', out, steps: [
      {name: 'failure', command: process.execPath, args: ['-e', 'console.log("failure evidence"); process.exit(7)']},
      {name: 'success', command: process.execPath, args: ['-e', 'console.log("later check ran")']},
    ]});
    assert.equal(failures, 1);
    assert.match(readFileSync(join(out, 'failure.log'), 'utf8'), /failure evidence/);
    assert.match(readFileSync(join(out, 'success.log'), 'utf8'), /later check ran/);
  } finally {
    for (const name of ['failure', 'success']) if (existsSync(join(out, `${name}.log`))) unlinkSync(join(out, `${name}.log`));
    rmdirSync(out);
  }
});

test('--list previews even a site build without tools, output files or compilation', () => {
  const out = join(tmpdir(), `check-list-${process.pid}`);
  const text = execFileSync(process.execPath, ['repro/check.mjs', 'site', '--list', '--out', out], {
    encoding: 'utf8', env: {...process.env, PYTHON: '/missing-python', TERRAFORM_WEBGPU: '/missing-dawn'},
  });
  assert.match(text, /site.build.test.mjs/);
  assert.equal(existsSync(out), false);
});
