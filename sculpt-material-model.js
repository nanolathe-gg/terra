// materials/<world>.json as the draw's table rows: its placement and its ground cover (the surfaces' looks are materials, sculpt-materials.js).
// The first placement row of the draw's uniform table (engine-frag.wgsl MM_PLACE, engine-common.wgsl materialTable): six rows after it.
export const PLACEMENT_ROW = 156;
// The rows after them (engine-common.wgsl MM_COVER): the world's site rows and the plants' (coverRows).
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

// The rows from MM_COVER (engine-common.wgsl): the world's site rows (`site`, materials/defaults.json: the numbers the Moisture and Soil depth
// facts read), then the plants': row 3 (tuft height, shrub height, shrub density, entries) with the heights times Vegetation relief, then one
// row an entry (surfaceRows' plants: the layer's first row, its kind, its amount). A world without `site` gives zeros.
export function coverRows(site = null, plants = [], relief = 1) {
  const rows = Array.from({length: COVER_ROWS}, () => [0, 0, 0, 0]);
  if (site) {
    rows[0] = [0, site.wet[0], site.wet[1], site.dry];
    rows[1] = [site.soil.slope[0], site.soil.slope[1], site.soil.convex, site.soil.deposit];
    rows[2] = [0, site.moisture.perSwath, site.moisture.swathRef, site.moisture.shade];
    if (plants.length) {
      const k = Number.isFinite(Number(relief)) ? Math.max(0, Number(relief)) : 1;
      rows[3] = [site.plants.tuft * k, site.plants.shrub * k, site.plants.shrubs, plants.length];
      plants.slice(0, PLANT_MAX).forEach((p, i) => { rows[4 + i] = [p.row, p.kind, p.amount, 0]; });
    }
  }
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
// What each built-in needs to draw anything at all, as the draw gates it (engine-frag.wgsl, the masks each surfaceStage call is given, and the
// uniforms sculpt-renderer.js sets them from). World › Surface lists a built-in under "Cannot draw" while one of these fails, and under "Only
// where painted" when it draws only where Surface paint has painted. A need: `control`, a World setting that must be above 0 (a rock type's
// setting counts for the world's rock and every rock type in use on the map, as the draw reads each pixel's own); `unless`, a world fact
// (sculpt-knobs.js worldPanelValues) under which that need does not hold; `role`, a map material in that role (sculpt-materials.js MAP_ROLES)
// that the draw has no fallback for; `layer`, a surface the world draws (config.layers: its own beach, or one another world lends); `painted`,
// the mask Surface paint lays. An empty list claims nothing: the sand's sources and the chips' weathering are not read here, and a false
// "cannot draw" is worse than none.
export const SURFACE_NEEDS = {
  highland: [{role: 'worldHigh'}, {control: 'highland'}],   // highShare: 0 with no highland material (u.highGround < 0) or Strength 0
  slopeCover: [{control: 'slopeTexture', unless: 'slopeSand'}],   // its mask times Sampled slope texture, unless the world's slopes are sand
  soil: [{control: 'soilRim'}],   // the thinning cover's soil, only when u.soilRim > 0
  rock: [],
  beach: [{layer: 'beach'}],   // u.beach: the world's layers hold a beach; without its role material it falls back to the slope's or the ground's
  crown: [{control: 'rockCrown'}],   // a rock type's rockCrown > 0
  baseBand: [{control: 'baseBand'}, {control: 'strata'}, {column: true}],   // u.baseBand > 0 on bedded rock (a rock type's strata > 0, and a column)
  regrownMoss: [{control: 'debrisAmount'}], fines: [{control: 'debrisAmount'}],   // u.debrisAny: the largest debrisAmount of the rocks in use
  paintedRock: [{painted: 'rock'}], paintedSnow: [{painted: 'snow'}], paintedMoss: [{painted: 'moss'}],   // inside u.paintOn: the painted masks
  sandDust: [{control: 'sandDust'}],   // sand's dusting, times u.sandDust
  sand: [],
  chips: [],
  iceCrest: [{control: 'iceCrest'}],   // a rock type's iceCrest > 0
  iceCap: [{control: 'iceSnow'}],   // a rock type's iceSnow > 0 (Snow on level caps)
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
// Plants a material layer may grow where it shows (its `plants`: {kind, amount}), placed by the bake (engine-bake.wgsl plantMask): grass tufts,
// meadow tufts, moss cushions and shrubs. A map's layers grow at most PLANT_MAX kinds of plants between them.
export const PLANT_KINDS = ['grass', 'meadow', 'moss', 'shrubs'];
export const PLANT_LABELS = {grass: 'Grass tufts', meadow: 'Meadow tufts', moss: 'Moss cushions', shrubs: 'Shrubs'};
export const PLANT_MAX = 8;
// The facts the bake knows where it places plants (the shares of rock, debris and sand and the convexity exist only in the color pass).
export const PLANT_FACTS = ['slope', 'aboveSea', 'abovePlain', 'wear', 'deposit', 'wetness', 'moisture', 'soilDepth', 'light', 'top'];
// A stored list (this browser's world store, a save's world settings) made before the engine's surfaces drew materials: each engine
// surface without one takes the world's (its own list, `base`), so it does not draw nothing.
export const withSurfaceMaterials = (list, base) => list.map(l => l?.builtin != null && SURFACE_DRAWABLE.includes(l.builtin) && l.material == null
  ? {...l, ...(base?.find(b => b.builtin === l.builtin)?.material != null ? {material: base.find(b => b.builtin === l.builtin).material} : {})} : l);
// `slotOf(key)`: the map's slot of the world's copy of library material `key` (its worldLayer; -1 when the map lacks it). `hidden`: the keys (layerKey) of
// layers the Surface section hides while an artist designs (a view, never saved or exported): they draw nothing.
export function surfaceRows(surface, slotOf = () => -1, hidden = null) {
  const list = Array.isArray(surface) ? surface : [];
  if (list.length > SURFACE_MAX) throw Error(`A world's surface holds at most ${SURFACE_MAX} layers.`);
  let facts = false;
  const layers = list.map((layer, i) => {
    const material = isMaterialLayer(layer), draws = layer?.material != null, at = material ? null : SURFACE_BUILTINS[layer?.builtin];
    if (!material && !at) throw Error(`Surface layer ${i + 1}: unknown built-in "${layer?.builtin}".`);
    if (material && !draws && !layer.plants) throw Error(`Surface layer ${i + 1}: a layer is a built-in, draws a material or grows plants.`);
    if (material && !layer.id) throw Error(`Surface layer ${i + 1}: a material layer needs an id.`);
    if (draws && !material && !SURFACE_DRAWABLE.includes(layer.builtin)) throw Error(`Surface layer ${i + 1}: ${layer.builtin} draws a material set in the Materials panel or Rock types, not a material of its own.`);
    if (material && SURFACE_BUILTINS[layer.id]) throw Error(`Surface layer ${i + 1}: "${layer.id}" is a built-in's name; a material layer needs another id.`);
    if (layer?.plants != null && (!material || !PLANT_KINDS.includes(layer.plants.kind))) throw Error(`Surface layer ${i + 1}: plants grow on a material layer, as one of ${PLANT_KINDS.join(', ')}.`);
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
    // The world's copy of its library material, shared by every layer that draws it; -2 where the layer must draw a material and the map
    // has none for it (a material layer, or a built-in the engine no longer colors: SURFACE_DRAWABLE): it draws nothing.
    const bound = draws ? slotOf(layer.material) : -1;
    // -3: a material layer that draws no material and grows plants (the color pass skips it; the bake grows its plants).
    const packed = bound >= 0 ? bound : material && !draws ? -3 : draws || (!material && SURFACE_DRAWABLE.includes(layer.builtin)) ? -2 : -1;
    const amount = hidden?.has(layerKey(layer)) ? 0 : !material && SURFACE_OWN_AMOUNT.includes(layer.builtin) ? 1 : number(layer.amount, 1);
    return {index: i, stage, rows: [[material ? -1 : at[1], amount, packed, rule.length], fixed ? [1, 0, 8, layerSalt(layerKey(layer))] : [number(edge.width, 1), number(edge.noise, 0), number(edge.noiseSize, 8), layerSalt(layerKey(layer))], ...rule]};
  });
  // Stable by stage: the list's order within a stage is kept.
  const sorted = layers.map((l, i) => [l, i]).sort((a, b) => a[0].stage - b[0].stage || a[1] - b[1]).map(([l]) => l);
  const rows = [], heads = Array.from({length: SURFACE_STAGES}, () => [0, 0]), layerRows = new Array(layers.length);
  for (const l of sorted) { if (!heads[l.stage][1]) heads[l.stage][0] = rows.length; heads[l.stage][1]++; layerRows[l.index] = rows.length; rows.push(...l.rows); }
  if (rows.length > SURFACE_FLAGS_ROW) throw Error(`A world's surface needs ${rows.length} rows; the draw holds ${SURFACE_FLAGS_ROW}. Use fewer layers or simpler rules.`);
  // The layers that grow plants, by their first row (the bake walks the layers in draw order and adds each one's plants where it shows).
  const plants = list.flatMap((layer, i) => layer?.plants?.amount > 0 ? [{row: layerRows[i], kind: PLANT_KINDS.indexOf(layer.plants.kind), amount: Math.min(1, Number(layer.plants.amount))}] : []);
  if (plants.length > PLANT_MAX) throw Error(`A world's surface grows plants on at most ${PLANT_MAX} layers.`);
  return {rows, flags: [facts ? 1 : 0, 0, 0, 0], head: [0, 2, 4, 6].map(k => [...heads[k], ...heads[k + 1]]), layerRows, plants};
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
      const plants = l.plants && typeof l.plants === 'object' && PLANT_KINDS.includes(l.plants.kind) && finite(l.plants.amount) > 0 ? {kind: l.plants.kind, amount: Math.min(1, finite(l.plants.amount))} : undefined;
      if ((typeof l.material !== 'string' && !(l.material == null && plants)) || !SURFACE_ID.test(String(l.id)) || ids.has(l.id) || Object.hasOwn(SURFACE_BUILTINS, l.id)) throw Error(`Surface layer ${i + 1} needs a material or plants, and an id of its own.`);
      ids.add(l.id);
      return clean({id: l.id, ...base, material: typeof l.material === 'string' ? l.material.slice(0, 80) : undefined, stage: typeof l.stage === 'string' ? l.stage : undefined, plants});
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
