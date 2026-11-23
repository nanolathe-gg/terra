// The static build (go run ./cmd/terraform --build-site, which needs Go): a versioned folder, the page's files at relative paths, every world's configs,
// services and the map exporter.
import test from 'node:test';
import assert from 'node:assert/strict';
import {runSite} from './site-cli.mjs';
import {mkdtempSync, readFileSync, readdirSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

// Deployment can validate the artifact it just built, without compiling the exporter twice.
const folder = process.env.TERRAFORM_SITE_DIR ? resolve(process.env.TERRAFORM_SITE_DIR)
  : runSite(['--build-site', mkdtempSync(join(tmpdir(), 'site-'))]).trim();
const read = name => readFileSync(join(folder, name), 'utf8');

test('the root is the editor with a versioned asset base and no navigation redirect', () => {
  const root=read('../../index.html');
  assert.ok(root.includes(`<base href="b/${folder.split('/').pop()}/">`));
  assert.ok(root.includes('id="terrain"'));
  assert.ok(!root.includes('location.replace('));
  assert.equal(root.replace(/<base href="[^"]+">/,''),read('index.html'));
});

test('the start-up preload hints name only files in the build, the entry module first', () => {
  const page=read('index.html'),hints=[...page.matchAll(/<link rel="(modulepreload|preload)" href="([^"]+)"( as="fetch" crossorigin)?>/g)];
  assert.ok(hints.length>20,'the page lists its start-up modules and shaders');
  assert.equal(hints[0][2],'sculpt.js');
  for(const [,rel,href,fetchMode] of hints){
    assert.ok(existsSync(join(folder,href)),`${href} is in the build`);
    if(rel==='preload')assert.ok(fetchMode,`${href}: a fetch preload matches the page's cors fetch only with crossorigin`);
  }
  assert.ok(hints.some(([,,href])=>href==='engine-shape.wgsl'),'the late-read shaders are hinted');
});

test('every world has a config file, and the services are declared', () => {
  const services = JSON.parse(read('services.json'));
  for (const world of services.worlds) {
    const config = JSON.parse(read(`config/${world}.json`));
    assert.equal(config.biomeId, world);
    assert.ok(!('variants' in config), `${world}: no variants`);
  }
  const catalog = JSON.parse(read('config/catalog.json'));
  assert.deepEqual(Object.keys(catalog.worlds).sort(), services.worlds.toSorted());
  assert.equal(services.maps.available, true);
  assert.match(services.maps.url, /^https:\/\/terraform-savelinks\.[a-z0-9-]+\.workers\.dev\/maps$/);
  assert.equal(services.features, undefined);   // features are generated in the page; there is no feature service
  assert.equal(services.export, undefined, 'export runs in the page everywhere: no service to declare');
});

test('the build carries the map exporter, built from export/ for WebAssembly', () => {
  const wasm = readFileSync(join(folder, 'map-export.wasm'));
  assert.deepEqual([...wasm.subarray(0, 4)], [0, 0x61, 0x73, 0x6d], 'a WebAssembly module');
  assert.ok(read('wasm_exec.js').includes('globalThis.Go'), "Go's wasm_exec.js");
  assert.ok(read('sculpt-export-worker.js').includes("importScripts('wasm_exec.js')"));
});

test('the page and its modules fetch by relative paths', () => {
  for (const file of readdirSync(folder).filter(f => /^(sculpt.*\.(js|html)|engine.*\.wgsl)$/.test(f))) {
    const text = read(file);
    assert.ok(!/fetch\(\s*['"`]\//.test(text), `${file} fetches an absolute path`);
    assert.ok(!/(?:src|href)="\//.test(text), `${file} links an absolute path`);
  }
});

test('the diagnostic view ships its reference classifier and presentation module', () => {
  for (const name of ['sculpt-passability.js', 'sculpt-passability-view.js']) assert.ok(existsSync(join(folder, name)), name);
});

// Available authored pictures travel with the picker. Worlds without a picture use
// its "No picture yet" fallback; adding a world does not require new preview art.
test('the New map picker ships every available authored world thumbnail',()=>{
  const manifest=JSON.parse(read('ui-previews/manifest.json'));
  const worlds=JSON.parse(read('services.json')).worlds;
  const images=Object.entries(manifest.worlds.images);
  assert.ok(images.length,'the preview bundle has authored world pictures');
  for(const [world,image] of images){
    assert.ok(worlds.includes(world),`${world}: preview belongs to a shipped world`);
    const bytes=readFileSync(join(folder,'ui-previews',image));
    assert.deepEqual([...bytes.subarray(0,8)],[137,80,78,71,13,10,26,10],`${world}: thumbnail is a PNG`);
  }
});
