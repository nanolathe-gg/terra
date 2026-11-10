// Synthetic height images for the checks of the `heights` stroke (sculpt-gpu-fields.js heightsFields): every sample comes from a formula here, none
// from a map or a picture.
//   node repro/heights-fixture.mjs > repro/shape-scenes/heights-bumps.json     writes the scene repro/heights.test.mjs compares with this file
// A scene holds an image as base64, as a save does: ['heights', [], {image, bits, width, height, cell, x, y, scale, offset, mode}].
import {fileURLToPath} from 'node:url';

// The save's text for samples: bytes (bits 8) or 16-bit values, low byte first (bits 16), as base64.
export function encodeSamples(samples, bits = 8) {
  const bytes = bits === 16 ? new Uint8Array(samples.length * 2) : Uint8Array.from(samples);
  if (bits === 16) samples.forEach((v, i) => { bytes[2 * i] = v & 255; bytes[2 * i + 1] = v >> 8; });
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}
export const decodeSamples = (image, bits = 8) => { const b = Buffer.from(image, 'base64'); return bits === 16 ? Uint16Array.from({length: b.length / 2}, (_, i) => b[2 * i] | b[2 * i + 1] << 8) : Uint8Array.from(b); };

// Gaussian bumps on a level: floor + sum of amp * exp(-d^2 / (2 radius^2)) over [cx, cy, amp, radius] in samples, rounded and kept in 0..top.
export function bumps(width, height, floor, list, top = 255) {
  const out = new Array(width * height);
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    let v = floor;
    for (const [cx, cy, amp, radius] of list) v += amp * Math.exp(-((i - cx) ** 2 + (j - cy) ** 2) / (2 * radius * radius));
    out[j * width + i] = Math.max(0, Math.min(top, Math.round(v)));
  }
  return out;
}
// The hardest bytes for a surface to give back: every sample its own value in 0..255 (an integer hash of its place), so neighbors differ by
// up to the whole range.
export function hashBytes(width, height, salt = 0x51f3) {
  const out = new Array(width * height);
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    let n = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ salt;
    n = Math.imul(n ^ (n >>> 13), 1274126177); out[j * width + i] = ((n ^ (n >>> 16)) >>> 0) % 256;
  }
  return out;
}

// The scene of repro/shape-scenes/heights-bumps.json: four images, one in each mode, over a plateau and the ground undulation, with a Smooth stroke
// after them. On the 4 x 4 map of the regional check the pages meet at cell 512 (about 1024 px) and its quadrants at cell 584 (about 1168 px): every
// image lies across both lines, three of them off the 16 px grid, so a page, a quadrant and the whole map must agree on the same cells.
export function fixtureScene() {
  const hills = bumps(64, 64, 70, [[20, 18, 150, 7], [44, 40, 140, 10], [12, 50, 60, 5], [52, 10, -40, 6], [33, 30, 35, 16]]);
  const swell = bumps(24, 20, 21000, [[6, 5, 24000, 3], [16, 12, 30000, 4], [10, 16, -9000, 2.5]], 65535);
  const pit = bumps(48, 48, 120, [[24, 24, -90, 9], [10, 36, -50, 4], [38, 12, 30, 5]]);
  const block = bumps(20, 20, 96, [[10, 10, 80, 4]]);
  return {biome: 'green',
    source: {note: 'A check of the heights stroke (repro/heights.test.mjs, repro/regional.mjs): four synthetic height images, Gaussian bumps from the formulas of repro/heights-fixture.mjs ' +
      '(fixtureScene; node repro/heights-fixture.mjs writes this file), one in each mode, lying across the page seam and the quadrant lines of the regional check on a 4 x 4 map. No sample comes from a map.'},
    ground: true, query: '',
    strokes: [
      ['plateau', [[880, 1010], [1180, 1140], [1420, 1010]], {card: {diameter: 420}}],
      ['heights', [], {image: encodeSamples(hills), bits: 8, width: 64, height: 64, cell: 16, x: 604, y: 618, scale: 1, offset: 0, mode: 'raise'}],
      ['heights', [], {image: encodeSamples(swell, 16), bits: 16, width: 24, height: 20, cell: 40, x: 250.5, y: 900.25, scale: 1 / 256, offset: 4, mode: 'flatten'}],
      ['heights', [], {image: encodeSamples(pit), bits: 8, width: 48, height: 48, cell: 8, x: 1003, y: 961.5, scale: 1, offset: -24, mode: 'cut'}],
      ['heights', [], {image: encodeSamples(block), bits: 8, width: 20, height: 20, cell: 16, x: 1040, y: 1024, scale: 1, offset: 0, mode: 'replace'}],
      ['smooth', [[960, 1300], [1240, 1180]], {card: {diameter: 260}}]]};
}
// One stroke a line, as the scenes are kept.
export const sceneText = scene => `{"biome": ${JSON.stringify(scene.biome)}, "source": ${JSON.stringify(scene.source)},\n "ground": ${scene.ground}, "query": ${JSON.stringify(scene.query)},\n "strokes": [\n${scene.strokes.map(s => '  ' + JSON.stringify(s)).join(',\n')}\n ]}\n`;

if (process.argv[1] === fileURLToPath(import.meta.url)) process.stdout.write(sceneText(fixtureScene()));
