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
// (engine-frag.wgsl surfaceStage). A layer is a built-in (one of the draw's own surfaces: its color and share are the draw's, and its stage, the
// place among the effects that read the color below, is the built-in's) or a material layer (`material`: a library key, drawn from the map's
// copy that carries the layer's id as worldLayer; `stage` one of SURFACE_STAGE_NAMES, default land). Either may have a rule over the site's
// facts: `where` (up to four windows {fact, from, to, fade}, all of which must hold) or `score` ({terms: [{fact, weight}], from, fade}).
// The world's list sets their order within a stage, an Amount and an edge. Rows from row 0, sorted by stage: (built-in slot or -1, Amount,
// material slot or -1, rule rows), (width, noise, noise size, salt), then the rule's (kind, score from, score fade, 0) and its terms;
// SURFACE_FLAGS_ROW x is 1 when a layer reads facts or draws a material; a rule head's w is the layer's
// height contrast (edge.height: the taller of its material and the ground below wins at its edge), so a layer with one and no rule has an empty one; SURFACE_HEAD_ROW's four rows the stages' (first row, count) pairs.
export const SURFACE_STAGES = 8, SURFACE_MAX = 32, SURFACE_HEAD_ROW = 152, SURFACE_FLAGS_ROW = 151, SURFACE_RULE_TERMS = 4;
// Built-ins: [stage, slot in its stage]. Stages: 0 after the ground, 1 after the low-ground tint, 2 after the cover classes, 3 after the
// margin join, 4 after the beds, 5 after the patches and the rock skin, 6 after the bake's stones and cracks, 7 after the crystals and hill light.
export const SURFACE_BUILTINS = {
  highland: [0, 0], slopeCover: [1, 0], soil: [2, 0], rock: [2, 1], beach: [2, 2], crown: [3, 0], baseBand: [4, 0],
  regrownMoss: [5, 0], fines: [5, 1], paintedRock: [5, 2], paintedSnow: [5, 3], paintedMoss: [5, 4], sandDust: [5, 5], sand: [5, 6],
  chips: [6, 0], iceCrest: [7, 0], iceCap: [7, 1],
};
// The built-ins that may draw a library material (phase 4): those the engine colors itself. The others already draw a material set in the
// Materials panel (highland ground, slope cover, beach and debris fines take the world's role materials) or each rock type's rock (rock,
// crown rock, painted rock, chips); a material for them here would be a second, partial way to set those (CLAUDE.md rule 9).
export const SURFACE_DRAWABLE = ['soil', 'baseBand', 'regrownMoss', 'paintedSnow', 'paintedMoss', 'sandDust', 'sand', 'iceCrest', 'iceCap'];
// Built-ins whose strength is a World setting of their own (World › Surface's Built-in settings): no Amount. Highland ground's share also sets
// the ground's art relief and caps the beds outside the layer stages, so it takes no rule or edge either: those would move its color alone.
export const SURFACE_OWN_AMOUNT = ['highland', 'baseBand'], SURFACE_FIXED = ['highland'];
export const SURFACE_STAGE_NAMES = ['ground', 'slope', 'land', 'crown', 'band', 'loose', 'chips', 'snow'];
// Facts a rule reads (engine-frag.wgsl surfaceFacts), in their order there. The shares exist from their own stage on.
export const SURFACE_FACTS = ['slope', 'aboveSea', 'abovePlain', 'wear', 'deposit', 'wetness', 'moisture', 'soilDepth', 'light', 'top', 'convexity',
  'rockShare', 'debrisShare', 'sandShare'];
// A layer's salt for its edge noise, from its id (or its built-in), so adding a layer does not reshuffle another's speckle.
const layerSalt = key => { let h = 17; for (const c of String(key)) h = (h * 31 + c.charCodeAt(0)) % 9973; return 17 + h; };
export const layerKey = layer => layer?.id ?? layer?.builtin ?? '';
// A material layer is any layer that is not a built-in; a built-in may also draw a material (`material`, docs/SURFACE_LAYERS.md phase 4)
// in place of the engine's own color, keeping its own share. Either binds the map's copy that carries its key (layerKey) as worldLayer.
export const isMaterialLayer = layer => layer?.builtin == null;
// `slotOf(key)`: the map's slot of the world's copy of library material `key` (its worldLayer; -1 when the map lacks it). `hidden`: the keys (layerKey) of
// layers the Surface section hides while an artist designs (a view, never saved or exported): they draw nothing.
export function surfaceRows(surface, slotOf = () => -1, hidden = null) {
  const list = Array.isArray(surface) ? surface : [];
  if (list.length > SURFACE_MAX) throw Error(`A world's surface holds at most ${SURFACE_MAX} layers.`);
  let facts = false;
  const layers = list.map((layer, i) => {
    const material = isMaterialLayer(layer), draws = layer?.material != null, at = material ? null : SURFACE_BUILTINS[layer?.builtin];
    if (!material && !at) throw Error(`Surface layer ${i + 1}: unknown built-in "${layer?.builtin}".`);
    if (material && !draws) throw Error(`Surface layer ${i + 1}: a layer is a built-in or draws a material.`);
    if (material && !layer.id) throw Error(`Surface layer ${i + 1}: a material layer needs an id.`);
    if (draws && !material && !SURFACE_DRAWABLE.includes(layer.builtin)) throw Error(`Surface layer ${i + 1}: ${layer.builtin} draws a material set in the Materials panel or Rock types, not a material of its own.`);
    if (material && SURFACE_BUILTINS[layer.id]) throw Error(`Surface layer ${i + 1}: "${layer.id}" is a built-in's name; a material layer needs another id.`);
    const stage = material ? SURFACE_STAGE_NAMES.indexOf(layer.stage ?? 'land') : at[0];
    if (stage < 0) throw Error(`Surface layer ${i + 1}: unknown stage "${layer.stage}".`);
    const edge = layer.edge || {}, number = (v, fallback) => Number.isFinite(Number(v)) ? Number(v) : fallback, fact = name => {
      const k = SURFACE_FACTS.indexOf(name); if (k < 0) throw Error(`Surface layer ${i + 1}: unknown fact "${name}".`); return k;
    };
    let rule = [];
    const fixed = !material && SURFACE_FIXED.includes(layer.builtin);
    if (fixed) { /* no rule, edge or Amount: its World settings place it */ }
    else if (layer.score) rule = [[2, number(layer.score.from, .5), Math.max(number(layer.score.fade, .05), 1e-4), 0], ...(layer.score.terms || []).slice(0, SURFACE_RULE_TERMS).map(t => [fact(t.fact), number(t.weight, 1), 0, 0])];
    else if (layer.where?.length) rule = [[1, 0, 0, 0], ...layer.where.slice(0, SURFACE_RULE_TERMS).map(w => [fact(w.fact), number(w.from, -1e9), number(w.to, 1e9), Math.max(number(w.fade, .05), 1e-4)])];
    // Height contrast (edge.height, a layer that draws a material): the rule head's w; a layer without a rule gets an empty windows rule.
    const height = Math.max(0, Math.min(1, number(edge.height, 0)));
    if (height > 0 && draws) { if (!rule.length) rule = [[1, 0, 0, 0]]; rule[0][3] = height; }
    if (rule.length > 1 || layer.score || draws) facts = true;
    const slot = draws ? slotOf(layer.material) : -1;   // the world's copy of its library material, shared by every layer that draws it
    const amount = hidden?.has(layerKey(layer)) ? 0 : !material && SURFACE_OWN_AMOUNT.includes(layer.builtin) ? 1 : number(layer.amount, 1);
    return {index: i, stage, rows: [[material ? -1 : at[1], amount, slot, rule.length], fixed ? [1, 0, 8, layerSalt(layerKey(layer))] : [number(edge.width, 1), number(edge.noise, 0), number(edge.noiseSize, 8), layerSalt(layerKey(layer))], ...rule]};
  });
  // Stable by stage: the list's order within a stage is kept.
  const sorted = layers.map((l, i) => [l, i]).sort((a, b) => a[0].stage - b[0].stage || a[1] - b[1]).map(([l]) => l);
  const rows = [], heads = Array.from({length: SURFACE_STAGES}, () => [0, 0]), layerRows = new Array(layers.length);
  for (const l of sorted) { if (!heads[l.stage][1]) heads[l.stage][0] = rows.length; heads[l.stage][1]++; layerRows[l.index] = rows.length; rows.push(...l.rows); }
  if (rows.length > SURFACE_FLAGS_ROW) throw Error(`A world's surface needs ${rows.length} rows; the draw holds ${SURFACE_FLAGS_ROW}. Use fewer layers or simpler rules.`);
  return {rows, flags: [facts ? 1 : 0, 0, 0, 0], head: [0, 2, 4, 6].map(k => [...heads[k], ...heads[k + 1]]), layerRows};
}
// A surface read from a save, a world file or this browser's world store: only the fields a layer has, numbers checked, and the draw's
// row limits (surfaceRows throws on anything it cannot draw). Returns a fresh list.
const SURFACE_ID = /^[A-Za-z0-9_-]{1,40}$/;
export function copySurface(value) {
  if (!Array.isArray(value)) throw Error('A surface is a list of layers.');
  const finite = v => Number.isFinite(Number(v)) ? Number(v) : undefined, clean = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  const ids = new Set();
  const list = value.map((l, i) => {
    if (!l || typeof l !== 'object') throw Error(`Surface layer ${i + 1} is not a layer.`);
    const name = typeof l.name === 'string' ? l.name.slice(0, 80) : undefined;
    const edge = l.edge && typeof l.edge === 'object' ? clean({width: finite(l.edge.width), noise: finite(l.edge.noise), noiseSize: finite(l.edge.noiseSize), height: finite(l.edge.height)}) : undefined;
    const where = Array.isArray(l.where) ? l.where.slice(0, SURFACE_RULE_TERMS).map(w => clean({fact: String(w?.fact), from: finite(w?.from), to: finite(w?.to), fade: finite(w?.fade)})) : undefined;
    const score = l.score && typeof l.score === 'object' ? clean({from: finite(l.score.from), fade: finite(l.score.fade), terms: (Array.isArray(l.score.terms) ? l.score.terms : []).slice(0, SURFACE_RULE_TERMS).map(t => clean({fact: String(t?.fact), weight: finite(t?.weight)}))}) : undefined;
    const base = clean({name, amount: finite(l.amount), edge, ...(where?.length ? {where} : {}), ...(score ? {score} : {})});
    if (l.builtin == null) {
      if (typeof l.material !== 'string' || !SURFACE_ID.test(String(l.id)) || ids.has(l.id) || Object.hasOwn(SURFACE_BUILTINS, l.id)) throw Error(`Surface layer ${i + 1} needs a material and an id of its own.`);
      ids.add(l.id);
      return clean({id: l.id, ...base, material: l.material.slice(0, 80), stage: typeof l.stage === 'string' ? l.stage : undefined});
    }
    // A built-in that draws a material binds by its built-in's name, so one built-in a list draws a material at most once. A built-in keeps
    // only the fields it has: Highland ground and Base band no Amount, Highland ground no rule or edge (SURFACE_OWN_AMOUNT, SURFACE_FIXED).
    const builtin = String(l.builtin), own = clean({...base, amount: SURFACE_OWN_AMOUNT.includes(builtin) ? undefined : base.amount});
    if (SURFACE_FIXED.includes(builtin)) { delete own.where; delete own.score; delete own.edge; }
    if (l.material != null) {
      if (typeof l.material !== 'string' || ids.has(builtin)) throw Error(`Surface layer ${i + 1}: a built-in draws one material, once in a list.`);
      if (!SURFACE_DRAWABLE.includes(builtin)) throw Error(`Surface layer ${i + 1}: ${builtin} draws a material set in the Materials panel or Rock types, not a material of its own.`);
      ids.add(builtin);
      return {builtin, ...own, material: l.material.slice(0, 80)};
    }
    return {builtin, ...own};
  });
  surfaceRows(list);
  return list;
}
