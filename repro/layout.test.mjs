// Cheap markup checks protect unique lookup targets and named tools without freezing a layout.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const html = readFileSync(new URL('../sculpt.html', import.meta.url), 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);

test('page element IDs are unique', () => {
  assert.deepEqual([...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))], [], 'ids written twice');
});

test('tool buttons have a name', () => {
  const buttons = [...html.matchAll(/<button\b([^>]*\bdata-tool="([^"]+)"[^>]*)>([\s\S]*?)<\/button>/g)];
  assert.ok(buttons.length > 0);
  for (const [, attrs, tool, body] of buttons) {
    const label = /aria-label="([^"]+)"/.exec(attrs)?.[1] || body.replace(/<svg\b[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '');
    assert.ok(label.trim(), `${tool} needs a name`);
  }
});
