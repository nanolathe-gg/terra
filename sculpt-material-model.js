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
// A world's surface layers (docs/SURFACE_LAYERS.md; config.surface, from world.surface or materials/defaults.json) as the draw's rows
// (engine-frag.wgsl surfaceStage). A built-in layer is one of the draw's own surfaces: its color and its share are the draw's, and its stage
// (the effects that run between stages fix where a layer can go) and its place in that stage are the built-in's. The world's list sets their
// order within a stage, their Amount and their edge. Rows: SURFACE_HEAD_ROW.. the stages' [first layer, count] pairs, then two rows a
// layer from row 0, sorted by stage: (stage slot, amount, 0, 0) and (width, noise, noise size, 0).
export const SURFACE_STAGES = 8, SURFACE_LAYER_ROWS = 2, SURFACE_MAX = 24, SURFACE_HEAD_ROW = 152;
// Built-ins: [stage, slot in its stage]. Stages: 0 after the ground, 1 after the low-ground tint, 2 after the cover classes, 3 after the
// margin join, 4 after the beds, 5 after the patches and the rock skin, 6 after the bake's stones and cracks, 7 after the crystals and hill light.
export const SURFACE_BUILTINS = {
  highland: [0, 0], slopeCover: [1, 0], soil: [2, 0], rock: [2, 1], beach: [2, 2], crown: [3, 0], baseBand: [4, 0],
  regrownMoss: [5, 0], fines: [5, 1], paintedRock: [5, 2], paintedSnow: [5, 3], paintedMoss: [5, 4], sandDust: [5, 5], sand: [5, 6],
  chips: [6, 0], iceCrest: [7, 0], iceCap: [7, 1],
};
export function surfaceRows(surface) {
  const list = Array.isArray(surface) ? surface : [];
  if (list.length > SURFACE_MAX) throw Error(`A world's surface holds at most ${SURFACE_MAX} layers.`);
  const layers = list.map((layer, i) => {
    const at = SURFACE_BUILTINS[layer?.builtin];
    if (!at) throw Error(`Surface layer ${i + 1}: unknown built-in "${layer?.builtin}".`);
    const edge = layer.edge || {}, number = (v, fallback) => Number.isFinite(Number(v)) ? Number(v) : fallback;
    return {stage: at[0], rows: [[at[1], number(layer.amount, 1), 0, 0], [number(edge.width, 1), number(edge.noise, 0), number(edge.noiseSize, 8), 0]]};
  });
  // Stable by stage: the list's order within a stage is kept.
  const sorted = layers.map((l, i) => [l, i]).sort((a, b) => a[0].stage - b[0].stage || a[1] - b[1]).map(([l]) => l);
  const head = Array.from({length: SURFACE_STAGES}, (_, s) => { const first = sorted.findIndex(l => l.stage === s); return [first < 0 ? 0 : first, sorted.filter(l => l.stage === s).length]; });
  return {rows: sorted.flatMap(l => l.rows), head: [0, 2, 4, 6].map(k => [...head[k], ...head[k + 1]])};
}
