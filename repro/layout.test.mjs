// The page's markup keeps what scripts, saves and checks find by name: every element id the editor had before the interface was rearranged
// (repro/layout-ids.txt; an id may move, it may not vanish or double), the order of the fixed tool buttons, and the two panes of the side panel.
// An id leaves the list only on purpose, with the control it named.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('sculpt.html', root), 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);

test('every id of the page is still there, once', () => {
  const kept = readFileSync(new URL('repro/layout-ids.txt', root), 'utf8').split('\n').filter(Boolean);
  assert.deepEqual(kept.filter(id => !ids.includes(id)), [], 'ids missing from sculpt.html');
  assert.deepEqual([...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))], [], 'ids written twice');
});

test('the tool buttons written in the page keep their order, each with a name', () => {
  const palette = html.split('class="tool-groups"')[1].split('</section>')[0];
  assert.deepEqual([...palette.matchAll(/data-tool="(\w+)"|id="(shape|water)-tools"/g)].map(m => m[1] ?? `[${m[2]}]`), ['move', 'landform', '[shape]', 'fissure', '[water]', 'smooth', 'erase', 'paint', 'sand', 'grass']);
  for (const button of palette.match(/<button [^>]*data-tool="\w+"[^>]*>.*?<\/button>/g)) assert.match(button, /<span class="tool-name">[^<]+<\/span><\/button>$/, button.slice(0, 60));
  for (const group of ['Shape tools', 'Water tools', 'Paint tools']) assert.ok(palette.includes(`role="group" aria-label="${group}"`), group);
});

test('the side panel has two panes, and no hidden container holds them', () => {
  assert.deepEqual([...html.matchAll(/role="tab" aria-selected="(?:true|false)" aria-controls="(pane-\w+)"/g)].map(m => m[1]), ['pane-tool', 'pane-world']);
  // measure/world_controls.mjs reads the offered sliders from this markup: a pane is hidden by its tab (role="tabpanel"), never by a wrapper.
  for (const pane of ['pane-tool', 'pane-world']) assert.match(html, new RegExp(`<section id="${pane}" role="tabpanel"`));
  const before = html.slice(html.indexOf('<aside id="inspector-sidebar"'), html.indexOf('<section id="pane-world"'));
  assert.ok(!/\shidden[\s>=]/.test(before), 'nothing between the side panel and its first pane is hidden');
});
