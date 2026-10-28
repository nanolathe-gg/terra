// Flow bake, stage 1 (card F1; design in FLOW_BAKE.md): the current and the
// colour it carries. River strokes and Source dabs are ordinary nodes that
// write no fields; one 'flowbake' node stores what the bake made, and replay
// only copies that into mask planes 20-24 (so a region replay stays exact and
// never re-runs the simulation). This module holds the pieces of that which
// sculpt.js only has to call: the node's stored result, its save format, and
// (further down) the bake driver and its panel.

// Mask planes the bake writes. Plane k is layer k >> 2, channel k & 3.
//   20 flow x, 21 flow y: the direction of the current times the square root of
//      its speed (so slow water keeps its direction in a signed byte); the speed
//      is the square of the vector's length, 0..1 of the fastest water of the bake
//   22, 23, 24: the concentration, 0..127 of 1, of sediment 1, 2 and 3. On land
//      within the bank reach the plane carries the same sediment fading with the
//      distance from the shore: the shader tints banks from it.
export const FLOW_FIRST = 20, FLOW_PLANES = 5;
export const FLOW_KINDS = ['river', 'source'];
export const isFlowKind = kind => FLOW_KINDS.includes(kind);

// What a river or source node keeps, under the names the shape editors read
// (radius, amount, roughness...), so Move, the brush sliders and Delete work on it as on any shape.
export const flowParams = (radius, amount, color = '') => ({radius, amount, rough: .35, softness: .5, bankWidth: .5, beachFlatness: .5, shelves: .25, shallowMode: 'passage', cracks: 0, color});

// A bake's stored result: {rect, planes: Int8Array x5 over the rect, colors:
// [[r,g,b] x3] (0..1), hash, settings, stats}. rect is in grid cells, inclusive.
export const resultWidth = result => result.rect.x1 - result.rect.x0 + 1;

// Replay's only job: copy the stored planes into the live ones, inside the
// clip a region replay allows (cells outside the bake's rect are untouched).
export function applyResult(result, planes, clip, grid) {
  if (!result) return;
  const r = result.rect, w = resultWidth(result);
  const x0 = Math.max(r.x0, clip.x0), x1 = Math.min(r.x1, clip.x1), y0 = Math.max(r.y0, clip.y0), y1 = Math.min(r.y1, clip.y1);
  if (x0 > x1 || y0 > y1) return;
  for (let k = 0; k < FLOW_PLANES; k++) {
    const src = result.planes[k], dst = planes[FLOW_FIRST + k];
    for (let y = y0; y <= y1; y++) dst.set(src.subarray((y - r.y0) * w + (x0 - r.x0), (y - r.y0) * w + (x1 - r.x0) + 1), y * grid + x0);
  }
}

// Save format: each plane as base64 of its bytes with runs of zero bytes
// collapsed (a zero byte, then the run length as two bytes), since most of a
// bake's planes are empty land.
function runs(plane) {
  const out = [];
  for (let i = 0; i < plane.length;) {
    if (plane[i] !== 0) { out.push(plane[i] & 255); i++; continue; }
    let j = i; while (j < plane.length && plane[j] === 0 && j - i < 65535) j++;
    out.push(0, (j - i) & 255, (j - i) >> 8); i = j;
  }
  return Uint8Array.from(out);
}
function unrun(bytes, length) {
  const out = new Int8Array(length); let at = 0;
  for (let i = 0; i < bytes.length;) {
    if (bytes[i] !== 0) { if (at >= length) throw new Error('The saved flow bake is too long.'); out[at++] = bytes[i] << 24 >> 24; i++; continue; }
    const n = bytes[i + 1] | (bytes[i + 2] << 8); if (at + n > length) throw new Error('The saved flow bake is too long.'); at += n; i += 3;
  }
  if (at !== length) throw new Error('The saved flow bake is too short.');
  return out;
}
const toBase64 = bytes => { let text = ''; for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(text); };
export function encodeResult(result) {
  if (!result) return undefined;
  return {rect: {...result.rect}, colors: result.colors, hash: result.hash, settings: result.settings, stats: result.stats, planes: result.planes.map(p => toBase64(runs(p)))};
}
export function decodeResult(saved, grid) {
  const r = saved?.rect;
  if (!r || ![r.x0, r.y0, r.x1, r.y1].every(Number.isInteger) || r.x0 < 0 || r.y0 < 0 || r.x1 >= grid || r.y1 >= grid || r.x1 < r.x0 || r.y1 < r.y0 || !Array.isArray(saved.planes) || saved.planes.length !== FLOW_PLANES) throw new Error('The saved flow bake is not valid.');
  const length = (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
  const colors = Array.isArray(saved.colors) ? saved.colors.slice(0, 3).map(c => [0, 1, 2].map(i => Math.max(0, Math.min(1, Number(c?.[i]) || 0)))) : [];
  while (colors.length < 3) colors.push([0, 0, 0]);
  return {rect: {x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1}, colors, hash: String(saved.hash ?? ''), settings: saved.settings || {}, stats: saved.stats || {},
    planes: saved.planes.map(text => unrun(Uint8Array.from(atob(text), c => c.charCodeAt(0)), length))};
}
