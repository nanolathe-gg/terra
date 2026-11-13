// The static build (python3 sculpt.py --build-site, which needs Go): a versioned folder, the page's files at relative paths, every world's configs,
// services and the map exporter.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, readdirSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {ROCK_PRESETS, applyWorldRock, rockPresetFor} from '../sculpt-rock-presets.js';

const root = new URL('..', import.meta.url).pathname;
// Deployment can validate the artifact it just built, without compiling the exporter twice.
const folder = process.env.TERRAFORM_SITE_DIR ? resolve(process.env.TERRAFORM_SITE_DIR)
  : execFileSync(process.env.PYTHON || 'python3', [join(root, 'sculpt.py'), '--build-site', mkdtempSync(join(tmpdir(), 'site-'))], {encoding: 'utf8'}).trim();
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
    for (const variant of Object.keys(config.variants)) {
      const file = JSON.parse(read(`config/${world}--${variant}.json`));
      assert.equal(file.variant, variant);
      // A variant that names a rock recipe names one the page has, and the page lays its numbers (and, where asked, its beds) over the world's.
      if (file.rock) {
        const recipe = ROCK_PRESETS[file.rock.recipe], beds = file.column?.sections;
        assert.ok(recipe, `${world}/${variant}: recipe ${file.rock.recipe}`);
        applyWorldRock(file);
        for (const [key, value] of Object.entries(recipe.knobs)) assert.equal(Number(file.defaults[key]), value, `${world}/${variant}: ${key}`);
        assert.deepEqual(file.column?.sections, file.rock.beds ? recipe.sections : beds);
        assert.equal(rockPresetFor(file.defaults, file.column), file.rock.beds ? file.rock.recipe : '');
      }
    }
  }
  assert.ok(JSON.parse(read('config/catalog.json')).worlds.green);
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

// Authored default-world pictures travel with the same static build as the picker.
test('the New map picker has every authored world thumbnail',()=>{
  const manifest=JSON.parse(read('ui-previews/manifest.json'));
  const worlds=JSON.parse(read('services.json')).worlds;
  assert.deepEqual(Object.keys(manifest.worlds.images).sort(),[...worlds].sort());
  for(const world of worlds){const bytes=readFileSync(join(folder,'ui-previews',manifest.worlds.images[world]));assert.deepEqual([...bytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);}
});
