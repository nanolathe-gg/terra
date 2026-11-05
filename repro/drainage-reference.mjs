// A CPU reference for the drainage plane (engine-drainage.wgsl), written as differently as it can be. The GPU relaxes to fixed points; this computes the same
// ones directly:
//   F  the filled height, by priority flood (Dijkstra for the lowest climb to an outlet: a cell at or under the sea, or on the lattice's edge)
//   D  the steps to an exit (an outlet, an edge cell, or a cell with a strictly lower F neighbor) through neighbors of the same F, by breadth first search
//   receivers by the same rule as the shader (steepest descent on F, else the same-F neighbor with the least D, first direction on a tie)
//   areas by walking every cell down its receivers to the root, in order of (F, D, index) from the highest, with no Euler tour and no pointer jumping.
// Used by repro/drainage.mjs and repro/drainage.test.mjs only; the editor has no CPU copy.
export const NONE = 0xffffffff;
const f = Math.fround, INV_SQRT2 = f(0.70710677);
const OFF = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const zero = h => h === 0 ? 0 : h;

class Heap {   // a binary min-heap of [key, index]
  constructor() { this.a = []; }
  push(key, i) { const a = this.a; a.push([key, i]); let c = a.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (a[p][0] <= a[c][0]) break; [a[p], a[c]] = [a[c], a[p]]; c = p; } }
  pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let c = 0; for (;;) { let m = c; for (const k of [2 * c + 1, 2 * c + 2]) if (k < a.length && a[k][0] < a[m][0]) m = k; if (m === c) break; [a[m], a[c]] = [a[c], a[m]]; c = m; } } return top; }
  get size() { return this.a.length; }
}

export function filled(heights, width, sea = -1e30) {
  const n = width * width, F = new Float32Array(n).fill(Infinity), done = new Uint8Array(n), heap = new Heap(), edge = (x, y) => x === 0 || y === 0 || x === width - 1 || y === width - 1;
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) { const i = y * width + x; if (!(heights[i] > f(sea)) || edge(x, y)) { F[i] = zero(heights[i]); heap.push(F[i], i); } }
  while (heap.size) {
    const [level, i] = heap.pop(); if (done[i]) continue; done[i] = 1;
    const x = i % width, y = (i - x) / width;
    for (const [dx, dy] of OFF) {
      const qx = x + dx, qy = y + dy; if (qx < 0 || qy < 0 || qx >= width || qy >= width) continue;
      const q = qy * width + qx; if (done[q]) continue;
      const to = Math.max(zero(heights[q]), level);
      if (to < F[q]) { F[q] = to; heap.push(to, q); }
    }
  }
  return F;
}

export function exitDistance(heights, F, width, sea = -1e30) {
  const n = width * width, D = new Uint32Array(n).fill(NONE), queue = [];
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    let exit = !(heights[i] > f(sea)) || x === 0 || y === 0 || x === width - 1 || y === width - 1;
    for (const [dx, dy] of OFF) { const qx = x + dx, qy = y + dy; if (qx >= 0 && qy >= 0 && qx < width && qy < width && F[qy * width + qx] < F[i]) exit = true; }
    if (exit) { D[i] = 0; queue.push(i); }
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head], x = i % width, y = (i - x) / width;
    for (const [dx, dy] of OFF) {
      const qx = x + dx, qy = y + dy; if (qx < 0 || qy < 0 || qx >= width || qy >= width) continue;
      const q = qy * width + qx;
      if (D[q] === NONE && F[q] === F[i]) { D[q] = D[i] + 1; queue.push(q); }
    }
  }
  return D;
}

export function receivers(heights, width, sea = -1e30, F = filled(heights, width, sea), D = exitDistance(heights, F, width, sea)) {
  const recv = new Uint32Array(width * width).fill(NONE);
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (!(heights[i] > f(sea))) continue;
    let best = 0, to = NONE;
    for (let k = 0; k < 8; k++) {
      const qx = x + OFF[k][0], qy = y + OFF[k][1];
      if (qx < 0 || qy < 0 || qx >= width || qy >= width) continue;
      const q = qy * width + qx;
      if (!(F[q] < F[i])) continue;
      const drop = f(F[i] - F[q]), score = k & 1 ? f(drop * INV_SQRT2) : drop;
      if (score > best) { best = score; to = q; }
    }
    if (to === NONE) {
      let least = D[i];
      for (let k = 0; k < 8; k++) {
        const qx = x + OFF[k][0], qy = y + OFF[k][1];
        if (qx < 0 || qy < 0 || qx >= width || qy >= width) continue;
        const q = qy * width + qx;
        if (F[q] === F[i] && D[q] < least) { least = D[q]; to = q; }
      }
    }
    recv[i] = to;
  }
  return recv;
}

export function drainageReference(heights, width, sea = -1e30) {
  const n = width * width, F = filled(heights, width, sea), D = exitDistance(heights, F, width, sea), recv = receivers(heights, width, sea, F, D), area = new Uint32Array(n).fill(1);
  // Every receiver is lower in (F, D): the cells in falling order of that pair hand their area down once each.
  const order = Array.from({length: n}, (_, i) => i).sort((a, b) => F[b] - F[a] || D[b] - D[a] || a - b);
  for (const i of order) if (recv[i] !== NONE) area[recv[i]] += area[i];
  return {area, recv, F, D};
}
