// Card H3: materials/green.json as the rows material-model.wgsl reads (see its header for the layout).
export const MM_ROWS = 35;
export function materialRows(table) {
  const rows = [];
  for (const name of table.order) {
    const m = table.measured[name], f = table.model[name], a = f.amps;
    rows.push([a[0], a[1], a[2], a[3]], [a[4], a[5], a[6], f.stretch], [f.tintMix, f.tintScale, 0, 0]);
    for (const c of m.ramp) rows.push([c[0], c[1], c[2], 0]);
    for (const c of m.tint) rows.push([c[0], c[1], c[2], 0]);
  }
  return rows;
}
