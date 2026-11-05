// A CPU reference for the drainage plane (engine-drainage.wgsl), written as differently as it can be: receivers by the same rule, then areas by
// accumulating down the receivers in order of falling height (a receiver is always strictly lower), with no Euler tour and no pointer jumping.
// Used by repro/drainage.mjs and repro/drainage.test.mjs only; the editor has no CPU copy.
export const NONE = 0xffffffff;
const f = Math.fround, INV_SQRT2 = f(0.70710677);
const OFF = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

export function receivers(heights, width, sea = -1e30) {
  const recv = new Uint32Array(width * width).fill(NONE);
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, h = heights[i];
    if (!(h > f(sea))) continue;
    let best = 0, to = NONE;
    for (let k = 0; k < 8; k++) {
      const qx = x + OFF[k][0], qy = y + OFF[k][1];
      if (qx < 0 || qy < 0 || qx >= width || qy >= width) continue;
      const drop = f(h - heights[qy * width + qx]), score = k & 1 ? f(drop * INV_SQRT2) : drop;
      if (score > best) { best = score; to = qy * width + qx; }
    }
    recv[i] = to;
  }
  return recv;
}

export function drainageReference(heights, width, sea = -1e30) {
  const n = width * width, recv = receivers(heights, width, sea), area = new Uint32Array(n).fill(1);
  const order = Array.from({length: n}, (_, i) => i).sort((a, b) => heights[b] - heights[a] || a - b);
  for (const i of order) if (recv[i] !== NONE) area[recv[i]] += area[i];
  return {area, recv};
}
