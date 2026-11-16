// The input checksum's guard (sculpt-digest-guard.js) under Node on Dawn: a clean draw passes, and each way a draw's input can escape the
// checksum is caught and named, with the checksum then withheld so no tile is kept. repro/check.sh digest runs it.
import test from 'node:test';
import assert from 'node:assert/strict';

const headless = await import('./headless.mjs'), {PER_CHUNK_UNIFORMS} = await import('../sculpt-gates.js');
await headless.openHost();
const open = async () => {
  const s = await headless.openScene({biome: 'green', strokes: []}, 'biome=green&mapX=4&mapY=4&scratch=1&gpuMB=512&heapMB=1536&digestGuard=1');
  s.renderer.setBudgetMB(512); return s;
};
const draw = s => headless.renderWindow(s, {width: 256, height: 256, tile: 256, digest: true});
const quietly = async work => { const error = console.error; console.error = () => {}; try { return await work(); } finally { console.error = error; } };

test('a clean scene: the same draw twice checks the same, draws the same and breaks no rule', async () => {
  const s = await open();
  try {
    const a = await draw(s), b = await draw(s), guard = s.renderer.guard;
    assert.ok(guard, 'digestGuard in the address installs the guard');
    assert.ok(a.digest && a.digest === b.digest);
    assert.ok(Buffer.from(a).equals(Buffer.from(b)));
    assert.equal(guard.draws, 2);
    assert.deepEqual(guard.violations, []);
  } finally { s.dispose(); }
});

test('a binding no class covers is named', async () => {
  const s = await open(), r = s.renderer, classes = r.digestClasses.bind(r);
  r.digestClasses = () => { const c = classes(), has = c.produced.has; return {...c, produced: {has: x => x !== r.fieldsTexture && has(x)}}; };
  try {
    const out = await quietly(() => draw(s));
    assert.equal(out.digest, null, 'no checksum after a violation');
    assert.match(r.guard.violations.join('\n'), /reads 'chunk fields', which the input checksum does not cover/);
  } finally { s.dispose(); }
});

test('a world texture rewritten without a version bump is named', async () => {
  const s = await open(), r = s.renderer;
  try {
    await draw(s);
    r.device.queue.writeTexture({texture: r.textures.noise.texture}, new Uint8Array(64).fill(7), {bytesPerRow: 16}, [4, 4]);
    await quietly(() => draw(s));
    assert.match(r.guard.violations.join('\n'), /world texture 'noise' changed without a world version bump/);
  } finally { s.dispose(); }
});

test('a setting the checksum leaves out is named when two draws with the same checksum differ in it', async () => {
  const s = await open(), r = s.renderer;
  PER_CHUNK_UNIFORMS.add('sun');   // as if `sun` were wrongly listed as per-chunk
  try {
    const first = await draw(s);
    new Float32Array(r.uniformData, r.layout.fields.get('sun').offset, 1)[0] += .25; r.uniformsDirty = true;
    await quietly(() => draw(s));
    assert.ok(first.digest);
    assert.match(r.guard.violations.join('\n'), /same input checksum ran with different uniforms \(sun\)/);
  } finally { PER_CHUNK_UNIFORMS.delete('sun'); s.dispose(); }
});
