// Card H3: materials/green.json as the rows material-model.wgsl reads (see its header for the layout).
export const MM_ROWS = 35;
export function materialRows(table) {
  const rows = [];
  for (const name of table.order) {
    const m = table.measured[name], f = table.model[name], a = f.amps;
    rows.push([a[0], a[1], a[2], a[3]], [a[4], a[5], a[6], f.stretch], [f.tintMix, f.tintScale, m.palette ? 1 : 0, 0]);
    for (const c of m.palette || m.ramp) rows.push([c[0], c[1], c[2], c[3] ?? 0]);
    for (const c of m.tint) rows.push([c[0], c[1], c[2], 0]);
  }
  const q = table.placement, r = q.rock, s = q.soil, f = q.face;
  rows.push([r.slope, r.formSlope, r.convexity, r.convexityRange], [r.noiseG, r.noiseR, r.weather, r.tap], [r.start, r.full, 0, 0],
    [s.slopeGate, s.heightGate, s.fadeFrom, s.fadeTo], [q.lowBank.from, q.lowBank.to, 0, 0], [q.route.from, q.route.to, 0, 0],
    [f.slopeFrom, f.slopeTo, f.edgeNoise, 0], [f.shareFrom, f.shareTo, 0, 0], [f.roughness, f.lumpTop, f.fineNoise, f.broadNoise],
    [f.gully, f.order, f.paintedRock, 0]);
  return rows;
}
