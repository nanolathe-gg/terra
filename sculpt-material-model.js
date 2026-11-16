// materials/<world>.json as the draw's table rows: its placement and its ground cover (the surfaces' looks are materials, sculpt-materials.js).
// The first placement row of the draw's uniform table (engine-frag.wgsl MM_PLACE, engine-common.wgsl materialTable): six rows after it.
export const PLACEMENT_ROW = 156;
// The rows after them: a world's ground-cover table (engine-frag.wgsl MM_COVER), 4 + 5 * 7 of them, the plants' row and the four flower palette rows. A table without `groundCover` gives zeros: the feature is off.
export const COVER_ROWS = 44;
// Card P31: how far past the pixels it covers a plant's scatter reads: a shrub's candidate (cell 16, jitter .85) up to 23 px away, the mask's height taps 8 px past that, and 15 px of apron.
export const PLANT_REACH = 46;
// Card tilepool: the period level ground repeats with, in world px: the table's material.groundPool, rounded to a multiple of 512 so the
// 512-px noise texture repeats with it (1024 where a table sets none). A level plain's 32-px tiles come from (period / 32)^2 at most.
export const groundPool = material => Math.max(512, Math.round((Number(material?.groundPool) || 1024) / 512) * 512);
// A table with a `placement` block (Green's) gives the draw's six placement rows: where rock shows off the rock face (engine-frag.wgsl landPlace).
export function tablePlacementRows(table) {
  const q = table.placement, r = q.rock, s = q.soil;
  return [[r.slope, r.formSlope, r.convexity, r.convexityRange], [r.noiseG, r.noiseR, r.weather, r.tap], [r.start, r.full, 0, 0],
    [s.slopeGate, s.heightGate, s.fadeFrom, s.fadeTo], [q.lowBank.from, q.lowBank.to, 0, 0], [q.route.from, q.route.to, 0, 0]];
}

// Card P30: a world's ground cover is on where its table has Vegetation cover above 0 (every world has a table; materials/defaults.json groundCover).
// A row the variant does not set counts as 1 (the table as written); a value that is not a number, likewise.
const coverScale=(variant,key)=>{const n=Number(variant?.get?.(key));return variant?.has?.(key)&&Number.isFinite(n)?Math.max(0,n):1;};
export const groundCoverOn=(cover,variant)=>Boolean(cover)&&coverScale(variant,'vegetationCover')>0;
// The Vegetation color (Colors panel): every class but bare soil (`bare`) moves by the change that takes the table's `color` to the pick: the hue turned,
// the saturation shifted and the lightness scaled, so the classes keep their steps (as the Features panel's Leaf color moves a tree's ramps).
function toHSL([r,g,b]){const mx=Math.max(r,g,b),mn=Math.min(r,g,b),l=(mx+mn)/2,d=mx-mn;if(d<1e-6)return [0,0,l];const s=d/(1-Math.abs(2*l-1)),h=mx===r?((g-b)/d+6)%6:mx===g?(b-r)/d+2:(r-g)/d+4;return [h*60,s,l];}
function fromHSL([h,s,l]){const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs((h/60)%2-1)),m=l-c/2,k=Math.floor((((h%360)+360)%360)/60);const [r,g,b]=[[c,x,0],[x,c,0],[0,c,x],[0,x,c],[x,0,c],[c,0,x]][k];return [r+m,g+m,b+m];}
const clamp01=v=>Math.max(0,Math.min(1,v));
export function recolorRGB(c,from,to){
  const [hf,sf,lf]=toHSL(from),[ht,st,lt]=toHSL(to),[h,s,l]=toHSL(c);
  return fromHSL([((h+ht-hf)%360+360)%360,clamp01(s+st-sf),clamp01(l*Math.max(.35,Math.min(2.5,lt/Math.max(lf,.01))))]);
}
// The rows of a `groundCover` block (the layout is engine-frag.wgsl's, above MM_COVER). Colours are sRGB 0..255, windows are [from, full, full
// until, gone by] on moisture, soil depth and light; strength and lush are a class's weight and its exponent on Lushness. A table with no `ground` of its own takes
// the world's ground material's mean color as its reference, and so does a class with no `rgb` (the default table's bare soil): the draw
// reads that mean on the GPU (rows[3].a and a class's second row's z say so), so `ground` here is only what a host without one shows. Off (Vegetation cover 0, or no table), every row is 0.
export function groundCoverRows(cover, overrides = null, colors = {}, ground = [.5, .5, .5]) {
  const rows = Array.from({length: COVER_ROWS}, () => [0, 0, 0, 0]);
  if (!groundCoverOn(cover, overrides)) return rows;
  const scale = key => coverScale(overrides, key);
  const rgb = c => c.map(v => v / 255), reference = cover.ground ? rgb(cover.ground) : ground;
  const plant = colors.vegetation && cover.color ? c => recolorRGB(c, rgb(cover.color), colors.vegetation) : c => c;
  rows[0] = [1, cover.wet[0], cover.wet[1], cover.dry];
  rows[1] = [cover.soil.slope[0], cover.soil.slope[1], cover.soil.convex, cover.soil.deposit];
  rows[2] = [cover.patch, cover.moisture.perSwath, cover.moisture.swathRef, cover.moisture.shade];
  rows[3] = [...reference, cover.ground ? 1 : 0];
  cover.classes.forEach((k, i) => {
    const b = 4 + 5 * i, own = k.rgb ? rgb(k.rgb) : ground;
    rows[b] = [...(k.bare ? own : plant(own)), k.grain];
    rows[b + 1] = [k.strength * (i ? scale('vegetationCover') : 1), k.lush, k.rgb ? 0 : 1, 0];
    rows[b + 2] = k.moisture; rows[b + 3] = k.soil; rows[b + 4] = k.light;
  });
  // Card P31: the plants (tufts, cushions, shrubs, flowers) the bake's loose scatter adds on the classes that grow them; no block, none.
  // Row 39's w is the flowers' density (dots per 2 x 2 px block at the best of their ground); rows 40 to 43 their palette (rgb, weight; at most four).
  if (cover.plants) rows[39] = [cover.plants.tuft * scale('plantRelief'), cover.plants.shrub * scale('plantRelief'), cover.plants.shrubs * scale('vegetationCover'), (cover.plants.flowers?.density ?? 0) * scale('flowerDensity')];
  (cover.plants?.flowers?.palette ?? []).slice(0, 4).forEach((k, i) => { rows[40 + i] = [...(colors['flower'+(i+1)] ?? rgb(k.slice(0,3))), k[3]]; });
  return rows;
}
