import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {WORLD_HELP} from '../sculpt-world-help.js';
import {featureParameterHelp} from '../sculpt-editor-help.js';
import {nodeParameterHelp, nodeInputHelp, nodeKindHelp, DITHER_HELP} from '../sculpt-material-help.js';
import {NODES, DITHER} from '../sculpt-materials.js';
import {KNOBS} from '../sculpt-knobs.js';
import {SHAPE_FIELDS} from '../sculpt-scene.js';

test('registered world and shape fields have a description', () => {
  assert.deepEqual(Object.keys(WORLD_HELP).sort(), KNOBS.flatMap(([, rows]) => rows.map(([key]) => key)).sort());
  for (const [key, , , , , , , , help] of SHAPE_FIELDS) assert.ok(help?.trim(), key);
});

test('material graph rows have help for each parameter, input and node kind', () => {
  for (const [type, spec] of Object.entries(NODES)) {
    assert.ok(spec.help?.trim(), type);
    for (const [key, , format] of spec.inputs) assert.ok(nodeInputHelp(type, key, format), `${type}.${key}`);
    for (const kind of Object.keys(spec.kinds ?? {'': true})) {
      if (kind) assert.ok(nodeKindHelp(type, kind), `${type}.${kind}`);
      for (const {key} of spec.params(kind)) assert.ok(nodeParameterHelp(type, key), `${type}.${kind}.${key}`);
    }
  }
  for (const {key} of DITHER) assert.ok(DITHER_HELP[key], key);
});

test('the fixed feature recipe parameter rows have help', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const params = [...html.matchAll(/data-param="([^"]+)" data-param-kind="([^"]+)"/g)];
  assert.ok(params.length);
  for (const [, key, kind] of params) assert.ok(featureParameterHelp(kind, key), `${kind}.${key}`);
});
