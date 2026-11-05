// Cards H3 and H14: materials/<world>.json as the rows engine-materials.wgsl reads (see its header for the layout).
export const MM_ROWS = 63;
// The first placement row of the draw's uniform table (engine-frag.wgsl MM_PLACE, engine-common.wgsl materialTable): ten rows after it.
export const PLACEMENT_ROW = 156;
// The rows after them: a world's ground-cover table (engine-frag.wgsl MM_COVER), 4 + 5 * 7 of them, the plants' row and the four flower palette rows. A table without `groundCover` gives zeros: the feature is off.
export const COVER_ROW = PLACEMENT_ROW + 10;
export const COVER_ROWS = 44;
// Card P31: how far past the pixels it covers a plant's scatter reads: a shrub's candidate (cell 16, jitter .85) up to 23 px away, the mask's height taps 8 px past that, and 15 px of apron.
export const PLANT_REACH = 46;
// The rows engine-materials.wgsl makes the layers from: MM_ROWS per layer, in the table's order. A material named twice in the order
// (a layer that shares its image with an earlier one) takes the same rows and its own layer's noise.
export function materialRows(table) {
  const rows = [];
  for (const name of table.order) {
    const m = table.measured[name], f = table.model[name], a = f.amps;
    rows.push([a[0], a[1], a[2], a[3]], [a[4], a[5], a[6], f.stretch], [f.tintMix, f.tintScale, f.dither ?? 0, 0]);
    for (const c of m.ramp) rows.push([c[0], c[1], c[2], 0]);
    for (const c of m.tint) rows.push([c[0], c[1], c[2], 0]);
    for (let k = 0; k < 4; k++) rows.push([0, 1, 2, 3].map(i => f.zq[Math.min(k * 4 + i, 12)]));
    rows.push(...litRows(f.lit));
    // H14d rows 46-61: the colours a dithered material reduces to (rgb, w = 1 in use); zeros when it is not dithered.
    for (let k = 0; k < 16; k++) rows.push(m.vocab?.[k] ? [...m.vocab[k], 1] : [0, 0, 0, 0]);
    // Row 62: the dither's dot lattice (dotCell px, dotShare, dotRadius px, dotDepth z); all zero is none.
    rows.push([f.dotCell ?? 0, f.dotShare ?? 0, f.dotRadius ?? 0, f.dotDepth ?? 0]);
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
    [x('cellVary'), x('streakBand'), x('skew'), x('strokeCore')], [x('strokeSize'), x('strokeShare'), x('strokeRadius'), x('strokeDepth')]];
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

// Card P30: the rows of a `groundCover` block (the layout is engine-frag.wgsl's, above MM_COVER). Colours are sRGB 0..255, windows are
// [from, full, full until, gone by] on moisture, soil depth and light; strength and lush are a class's weight and its exponent on Lushness.
export function groundCoverRows(cover, overrides = null, colors = {}) {
  const rows = Array.from({length: COVER_ROWS}, () => [0, 0, 0, 0]);
  if (!cover) return rows;
  const scale=key=>{const n=Number(overrides?.get(key));return overrides?.has(key)&&Number.isFinite(n)?Math.max(0,n):1;};
  const rgb = c => c.map(v => v / 255);
  rows[0] = [1, cover.wet[0], cover.wet[1], cover.dry];
  rows[1] = [cover.soil.slope[0], cover.soil.slope[1], cover.soil.convex, cover.soil.deposit];
  rows[2] = [cover.patch, cover.moisture.perSwath, cover.moisture.swathRef, cover.moisture.shade];
  rows[3] = [...rgb(cover.ground), 0];
  cover.classes.forEach((k, i) => {
    const b = 4 + 5 * i;
    rows[b] = [...rgb(k.rgb), k.grain];
    rows[b + 1] = [k.strength * (i ? scale('vegetationCover') : 1), k.lush, 0, 0];
    rows[b + 2] = k.moisture; rows[b + 3] = k.soil; rows[b + 4] = k.light;
  });
  // Card P31: the plants (tufts, cushions, shrubs, flowers) the bake's loose scatter adds on the classes that grow them; no block, none.
  // Row 39's w is the flowers' density (dots per 2 x 2 px block at the best of their ground); rows 40 to 43 their palette (rgb, weight; at most four).
  if (cover.plants) rows[39] = [cover.plants.tuft * scale('plantRelief'), cover.plants.shrub * scale('plantRelief'), cover.plants.shrubs * scale('vegetationCover'), (cover.plants.flowers?.density ?? 0) * scale('flowerDensity')];
  (cover.plants?.flowers?.palette ?? []).slice(0, 4).forEach((k, i) => { rows[40 + i] = [...(colors['flower'+(i+1)] ?? rgb(k.slice(0,3))), k[3]]; });
  return rows;
}
