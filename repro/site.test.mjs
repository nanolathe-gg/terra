// The static build (python3 sculpt.py --build-site): a versioned folder, the page's files at relative paths, every world's configs, services.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, readdirSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const out = mkdtempSync(join(tmpdir(), 'site-'));
const folder = execFileSync(process.env.PYTHON || 'python3', [join(root, 'sculpt.py'), '--build-site', out], {encoding: 'utf8'}).trim();
const read = name => readFileSync(join(folder, name), 'utf8');

test('the root opens the versioned build', () => {
  assert.match(folder, /\/b\/[0-9a-f]{10}$/);
  assert.ok(read('../../index.html').includes(`b/${folder.split('/').pop()}/sculpt.html`));
});

test('every world and variant has a config file, and the services are declared', () => {
  const services = JSON.parse(read('services.json'));
  for (const world of services.worlds) {
    const config = JSON.parse(read(`config/${world}.json`));
    assert.equal(config.biomeId, world);
    assert.ok(existsSync(join(folder, config.materialTable)), `${world}: table ${config.materialTable} is in the build`);
    for (const variant of Object.keys(config.variants)) assert.equal(JSON.parse(read(`config/${world}--${variant}.json`)).variant, variant);
  }
  assert.ok(JSON.parse(read('config/catalog.json')).worlds.green);
  assert.equal(services.maps.available, true);
  assert.match(services.maps.url, /^https:\/\/terraform-savelinks\.[a-z0-9-]+\.workers\.dev\/maps$/);
  for (const name of ['export', 'features']) assert.equal(services[name].available, false), assert.ok(services[name].reason.length > 20);
});

test('the page and its modules fetch by relative paths', () => {
  for (const file of readdirSync(folder).filter(f => /^(sculpt.*\.(js|html)|engine.*\.wgsl)$/.test(f))) {
    const text = read(file);
    assert.ok(!/fetch\(\s*['"`]\//.test(text), `${file} fetches an absolute path`);
    assert.ok(!/(?:src|href)="\//.test(text), `${file} links an absolute path`);
  }
});
