// Card H3: materials/green.json as the rows material-model.wgsl reads (see its header for the layout).
export const MM_ROWS = 39;
export function materialRows(table, overrides = null) {
  const rows = [];
  for (const name of table.order) {
    const m = table.measured[name], f = table.model[name], a = f.amps;
    rows.push([a[0], a[1], a[2], a[3]], [a[4], a[5], a[6], f.stretch], [f.tintMix, f.tintScale, 0, 0]);
    for (const c of m.ramp) rows.push([c[0], c[1], c[2], 0]);
    for (const c of m.tint) rows.push([c[0], c[1], c[2], 0]);
    for (let k = 0; k < 4; k++) rows.push([0, 1, 2, 3].map(i => f.zq[Math.min(k * 4 + i, 12)]));
  }
  const q = table.placement, r = q.rock, s = q.soil, f = q.face;
  rows.push([r.slope, r.formSlope, r.convexity, r.convexityRange], [r.noiseG, r.noiseR, r.weather, r.tap], [r.start, r.full, 0, 0],
    [s.slopeGate, s.heightGate, s.fadeFrom, s.fadeTo], [q.lowBank.from, q.lowBank.to, 0, 0], [q.route.from, q.route.to, 0, 0],
    [f.slopeFrom, f.slopeTo, f.edgeNoise, 0], [f.shareFrom, f.shareTo, 0, 0], [f.roughness, f.lumpTop, f.fineNoise, f.broadNoise],
    [f.gully, f.order, f.paintedRock, 0]);
  // Shared artist controls override the placement rows, never the measured
  // material statistics. Without overrides this remains the original table.
  const scalar=(key,row,col)=>{const value=Number(overrides?.get(key));if(overrides?.has(key)&&Number.isFinite(value))rows[row][col]=value;};
  const base=table.order.length*MM_ROWS;
  scalar('faceEdge',base+6,2);scalar('gullyRock',base+9,0);scalar('rockOrder',base+9,1);
  for(const [key,row] of [['faceSlope',base+6],['rockShare',base+7],['faceScore',base+8]]){
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
