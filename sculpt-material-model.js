// Cards H3 and H14: materials/<world>.json as the rows engine-materials.wgsl reads (see its header for the layout).
export const MM_ROWS = 46;
// The first placement row of the draw's uniform table (engine-frag.wgsl MM_PLACE, engine-common.wgsl materialTable): ten rows after it.
export const PLACEMENT_ROW = 156;
// The rows engine-materials.wgsl makes the layers from: MM_ROWS per layer, in the table's order. A material named twice in the order
// (a layer that shares its image with an earlier one) takes the same rows and its own layer's noise.
export function materialRows(table) {
  const rows = [];
  for (const name of table.order) {
    const m = table.measured[name], f = table.model[name], a = f.amps;
    rows.push([a[0], a[1], a[2], a[3]], [a[4], a[5], a[6], f.stretch], [f.tintMix, f.tintScale, 0, 0]);
    for (const c of m.ramp) rows.push([c[0], c[1], c[2], 0]);
    for (const c of m.tint) rows.push([c[0], c[1], c[2], 0]);
    for (let k = 0; k < 4; k++) rows.push([0, 1, 2, 3].map(i => f.zq[Math.min(k * 4 + i, 12)]));
    rows.push(...litRows(f.lit));
  }
  return rows;
}
// H14b: the seven rows of a material's lit height field (engine-materials.wgsl header). All zero, or no `lit` block, is the unlit model.
// light is the azimuth in turns (0 = light from +x, increasing towards +y, which is down the screen); veinRGB is 0..255.
function litRows(lit) {
  if (!lit) return [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  const x = k => lit[k] ?? 0, rgb = lit.veinRGB ?? [0, 0, 0];
  return [[x('relief'), x('light') * 2 * Math.PI, x('shear'), x('heightShare')], [x('ridged'), x('cell'), x('tilt'), x('tone')],
    [x('seamWidth'), x('seamDepth'), x('veinWidth'), x('veinSpacing')], [rgb[0], rgb[1], rgb[2], x('veinShare')], [x('warp'), x('cone'), x('seamVary'), x('seamGap')],
    [x('cellVary'), 0, 0, 0], [0, 0, 0, 0]];
}
// A table with a `placement` block (Green's) gives the draw's ten placement rows; the shared artist controls override them, never the
// measured material statistics. Without overrides this remains the original table.
export function tablePlacementRows(table, overrides = null) {
  const q = table.placement, r = q.rock, s = q.soil, f = q.face;
  const rows = [[r.slope, r.formSlope, r.convexity, r.convexityRange], [r.noiseG, r.noiseR, r.weather, r.tap], [r.start, r.full, 0, 0],
    [s.slopeGate, s.heightGate, s.fadeFrom, s.fadeTo], [q.lowBank.from, q.lowBank.to, 0, 0], [q.route.from, q.route.to, 0, 0],
    [f.slopeFrom, f.slopeTo, f.edgeNoise, 0], [f.shareFrom, f.shareTo, 0, 0], [f.roughness, f.lumpTop, f.fineNoise, f.broadNoise],
    [f.gully, f.order, f.paintedRock, 0]];
  const scalar=(key,row,col)=>{const value=Number(overrides?.get(key));if(overrides?.has(key)&&Number.isFinite(value))rows[row][col]=value;};
  scalar('faceEdge',6,2);scalar('gullyRock',9,0);scalar('rockOrder',9,1);
  for(const [key,row] of [['faceSlope',6],['rockShare',7],['faceScore',8]]){
    if(!overrides?.has(key))continue;
    const values=String(overrides.get(key)).split(',').map(Number),count=key==='faceScore'?4:2;
    if(values.length===count&&values.every(Number.isFinite))values.forEach((v,i)=>rows[row][i]=v);
  }
  return rows;
}

// A global bed-spacing edit scales each authored zone by the same ratio;
// zero zone widths continue to defer to the global spacing.
export function strataZoneWidths(config,value){
  const reference=Math.max(.5,Number(config.presetDefaults?.strataSpacing??config.defaults?.strataSpacing??10));
  const current=value==null||value===''?reference:Number(value),scale=Number.isFinite(current)?Math.max(.5,current)/reference:1;
  return (config.strataZoneSpacing||[]).slice(0,6).map(x=>x>0?x*scale:0);
}
