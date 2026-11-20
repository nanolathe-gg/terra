// Retail match harness: check a world's files before a trial renders, with messages that say what to fix.
//   node repro/match_validate.mjs <world> [--query 'key=v&key=v'] [--configs DIR] [--base-commit SHA]
// Reads this checkout's materials/<world>.json, materials/textures.json and materials/defaults.json, and checks what a matching agent edits:
//  - JSON that parses (with the line of the error);
//  - world.knobDefaults: each key a World control, a rock setting or a known engine default, and inside its range;
//  - world.materials and every material a layer, rock type or tool names: present in textures.json, and a graph the editor accepts
//    (sculpt-materials.js copyMaterial, the same check the material editor runs) or a `like` copy of one;
//  - world.surface: a list the editor accepts (sculpt-material-model.js copySurface), with known facts, stages and materials;
//  - world.rock: recipes whose knobs are rock settings, presets that name a recipe;
//  - with --query, each key a setting the page reads, inside its range (and which scenes' own value it overrides);
//  - the world's scenes (repro/scenes/<world>-<n>.json, the map lane): a query that sets only the map's ground relief (or keys the scene
//    had at the base commit), strokes whose rockPreset and groundPreset name slots the map has (repro/match_world.mjs), known card keys.
// Exit 1 on an error, 0 with warnings. repro/match.sh runs it before every trial.
import {execFileSync} from 'node:child_process';
import {readdirSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2), take = flag => { const at = argv.indexOf(flag); return at >= 0 ? argv.splice(at, 2)[1] ?? '' : ''; };
const query = take('--query'), configs = take('--configs'), baseCommit = take('--base-commit');
const world = argv[0];
if (!world) { console.error('usage: node repro/match_validate.mjs <world> [--query \'key=v&key=v\']'); process.exit(2); }
const errors = [], warnings = [];
function load(file) {
  const text = readFileSync(join(repo, file), 'utf8');
  try { return JSON.parse(text); } catch (e) {
    const at = Number(/position (\d+)/.exec(e.message)?.[1]);
    const line = Number.isFinite(at) ? text.slice(0, at).split('\n').length : '?';
    console.error(`${file}: not valid JSON near line ${line}: ${e.message}`); process.exit(1);
  }
}
const table = load(`materials/${world}.json`), textures = load('materials/textures.json'), defaults = load('materials/defaults.json');
const [{KNOBS}, mats, model, rock] = await Promise.all([import('../sculpt-knobs.js'), import('../sculpt-materials.js'), import('../sculpt-material-model.js'), import('../sculpt-rock-presets.js')]);
const w = table.world ?? {};
const ranges = new Map(KNOBS.flatMap(([, list]) => list.map(([k, , min, max]) => [k, [min, max]])));
const rockKeys = new Set(rock.ROCK_KEYS);
// Keys a world may default that are not World panel rows: the shared defaults and the other worlds' own (engine settings with no row).
const known = new Set([...Object.keys(defaults.knobs ?? {}), ...ranges.keys(), ...rockKeys]);
for (const f of readdirSync(join(repo, 'materials')).filter(f => f.endsWith('.json') && f !== `${world}.json`))
  try { Object.keys(JSON.parse(readFileSync(join(repo, 'materials', f), 'utf8')).world?.knobDefaults ?? {}).forEach(k => known.add(k)); } catch {}

function checkKnobs(knobs, where) {
  for (const [k, v] of Object.entries(knobs ?? {})) {
    if (!known.has(k)) { warnings.push(`${where}.${k}: not a World control or known setting (typo?); it will likely do nothing. See section 1 of the reference.`); continue; }
    if (typeof v !== 'number' || !Number.isFinite(v)) { if (typeof v !== 'string') errors.push(`${where}.${k}: ${JSON.stringify(v)} is not a number.`); continue; }
    const r = ranges.get(k);
    if (r && (v < r[0] || v > r[1])) errors.push(`${where}.${k} = ${v} is outside its range ${r[0]} to ${r[1]}.`);
  }
}
checkKnobs(w.knobDefaults, `materials/${world}.json world.knobDefaults`);

const checked = new Set();
function checkMaterial(key, where) {
  if (typeof key !== 'string') return;
  if (key.startsWith('@')) { if (!(w.materials ?? {})[key.slice(1)]) warnings.push(`${where}: ${key} names a role this world has no material for (world.materials.${key.slice(1)}); the layer draws its fallback.`); return; }
  if (checked.has(key)) return; checked.add(key);
  const m = textures[key];
  if (!m && !mats.LIBRARY?.[key]) { errors.push(`${where}: material "${key}" is not in materials/textures.json.`); return; }
  if (!m) return;
  if (m.like) { if (!textures[m.like]) errors.push(`textures.json ${key}: like "${m.like}", which is not in textures.json.`); return checkMaterial(m.like, `textures.json ${key}.like`); }
  try { mats.copyMaterial(m); } catch (e) { errors.push(`textures.json ${key}: ${e.message}`); }
  for (const n of m.nodes ?? []) if (!mats.NODES[n.type]) errors.push(`textures.json ${key}: node ${n.id} has type "${n.type}", not one of ${mats.NODE_TYPES.join(', ')}.`);
}
for (const [role, key] of Object.entries(w.materials ?? {})) if (role !== 'extra') checkMaterial(key, `world.materials.${role}`);
for (const key of Object.values(w.materials?.extra ?? {})) checkMaterial(key, 'world.materials.extra');

if (w.surface !== undefined) {
  try { model.copySurface(w.surface); } catch (e) { errors.push(`world.surface: ${e.message}`); }
  (Array.isArray(w.surface) ? w.surface : []).forEach((l, i) => {
    const at = `world.surface[${i}] (${l?.name ?? l?.id ?? l?.builtin})`;
    for (const t of [...(l?.where ?? []), ...(l?.score?.terms ?? [])]) if (!model.SURFACE_FACTS.includes(t.fact)) errors.push(`${at}: fact "${t.fact}" is not one of ${model.SURFACE_FACTS.join(', ')}.`);
    if (l?.stage && !model.SURFACE_STAGE_NAMES.includes(l.stage)) errors.push(`${at}: stage "${l.stage}" is not one of ${model.SURFACE_STAGE_NAMES.join(', ')}.`);
    if (l?.builtin && !(l.builtin in model.SURFACE_BUILTINS)) errors.push(`${at}: builtin "${l.builtin}" is not one of ${Object.keys(model.SURFACE_BUILTINS).join(', ')}.`);
    if (l?.material) checkMaterial(l.material, at);
  });
}

const recipes = w.rock?.recipes ?? {};
for (const [k, r] of Object.entries(recipes)) {
  if (k !== k.toLowerCase()) errors.push(`world.rock.recipes.${k}: recipe keys are lowercase.`);
  for (const key of Object.keys(r.knobs ?? {})) if (!rockKeys.has(key)) warnings.push(`world.rock.recipes.${k}.knobs.${key}: not a rock setting; a rock type ignores it (section 4 of the reference).`);
  checkKnobs(Object.fromEntries(Object.entries(r.knobs ?? {}).filter(([key]) => rockKeys.has(key))), `world.rock.recipes.${k}.knobs`);
  if (r.material) checkMaterial(r.material, `world.rock.recipes.${k}.material`);
}
for (const p of w.rock?.presets ?? []) if (!recipes[p] && !rock.STARTING_RECIPES[p]) errors.push(`world.rock.presets: "${p}" is not a recipe of this world or a starting one.`);
for (const t of w.tools ?? []) {
  if (t.material) checkMaterial(t.material, `world.tools ${t.id}.material`);
  if (t.rock && !recipes[t.rock] && !rock.STARTING_RECIPES[t.rock]) errors.push(`world.tools ${t.id}: rock "${t.rock}" is not a recipe of this world or a starting one.`);
}

// A trial's --query: a key the page does not read renders the base unchanged, which would pass for a control that does nothing.
const colorKeys = new Set(['sunColor', 'skyColor']);   // the light colors the address reads (sculpt-scene.js hexColors)
for (const [k, v] of new URLSearchParams(query)) {
  if (colorKeys.has(k)) { if (!/^[0-9a-f]{6}$/i.test(v)) errors.push(`--query ${k}=${v}: a color is six hex digits (rrggbb).`); continue; }
  if (k === 'sea' || k === 'plain') continue;   // a map's own heights (MAP_HEIGHTS below)
  if (!known.has(k)) { errors.push(`--query ${k}: not a World control or known setting, so it would change nothing. See section 1 of the reference.`); continue; }
  const r = ranges.get(k), x = Number(v);
  if (!Number.isFinite(x)) errors.push(`--query ${k}=${v}: not a number.`);
  else if (r && (x < r[0] || x > r[1])) errors.push(`--query ${k}=${v} is outside its range ${r[0]} to ${r[1]}.`);
}

// The map lane: each window's scene.
const UNDULATION = new Set(['undulation', 'undulationScale', 'undulationCover', 'undulationArt']);   // the map's ground node (sculpt-knobs.js UNDULATION)
// A map's own sea level and plain height above it (Map pane; sculpt-map.js configureMap): a low-floored retail map uses the game's 0-255.
const MAP_HEIGHTS = new Set(['sea', 'plain']);
const [{SHAPE_FIELDS, LANDFORM_KEYS, SECTION_KEYS}, {worldSlots, materialUse}] = await Promise.all([import('../sculpt-scene.js'), import('./match_world.mjs')]);
const {config, rocks, materials, missed} = await worldSlots(world, configs);
if (missed.length) warnings.push(`world.rock: no room in the map's materials for the rock material of ${missed.join(', ')}; ${missed.length > 1 ? 'they show' : 'it shows'} the world's rock material (REFERENCE.md, "Rock slots")`);
const {toolDefaults, DRAWN_KINDS} = await import('../sculpt-scene.js');
const cardKeys = new Set([...SHAPE_FIELDS.map(f => f[0]), ...LANDFORM_KEYS, ...SECTION_KEYS, 'curve', 'along', 'seed', 'preset']);
const defaultsOf = kind => { try { return toolDefaults(config, kind); } catch { return {}; } };
for (const kind of [...(DRAWN_KINDS ?? []), ...(config.tools ?? []).map(t => t.id)]) Object.keys(defaultsOf(kind)).forEach(k => cardKeys.add(k));
const rockSlots = new Set([-1, 0, ...rocks.map(r => r.slot)]);
const pinned = new Map();   // a query key -> the scenes that set it
const scenes = readdirSync(join(repo, 'repro', 'scenes')).filter(f => new RegExp(`^${world}-[0-9]\\.json$`).test(f)).sort();
for (const f of scenes) {
  const sc = load(`repro/scenes/${f}`), at = `repro/scenes/${f}`;
  let before = '';
  if (baseCommit) try { before = JSON.parse(execFileSync('git', ['-C', repo, 'show', `${baseCommit}:repro/scenes/${f}`], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']})).query ?? ''; } catch {}
  const had = new Set(new URLSearchParams(before).keys());
  for (const [k, v] of new URLSearchParams(sc.query ?? '')) {
    if (!pinned.has(k)) pinned.set(k, []); pinned.get(k).push(`${f.replace('.json', '')} ${v}`);
    if (MAP_HEIGHTS.has(k)) { if (!(Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 255)) errors.push(`${at} query ${k}=${v}: a whole number 0-255.`); continue; }
    if (!known.has(k)) { errors.push(`${at} query ${k}: not a setting the page reads.`); continue; }
    if (!UNDULATION.has(k) && !had.has(k)) errors.push(`${at} query ${k}: a scene's query sets only the map's own ground relief (${[...UNDULATION].join(', ')}). ${k} is the world's: set it in world.knobDefaults, or give this map a rock type or ground of its own (README.md, "The map lane").`);
    const r = ranges.get(k), x = Number(v);
    if (r && Number.isFinite(x) && (x < r[0] || x > r[1])) errors.push(`${at} query ${k}=${v} is outside its range ${r[0]} to ${r[1]}.`);
  }
  (sc.strokes ?? []).forEach(([kind, , opt], i) => {
    const c = opt?.card ?? {}, where = `${at} stroke ${i} (${kind})`;
    for (const k of Object.keys(c)) if (!cardKeys.has(k)) warnings.push(`${where}: card key ${k} is not a stroke field (typo?). See section 5 of the reference.`);
    if (c.rockPreset !== undefined && !rockSlots.has(c.rockPreset)) errors.push(`${where}: rockPreset ${c.rockPreset} is not a rock slot of this map (${[...rockSlots].join(', ')}; section 7 of the reference).`);
    if (c.groundPreset !== undefined && c.groundPreset !== -1 && c.groundPreset !== 0) {
      const m = materials.find(m => m.slot === c.groundPreset);
      if (!m || m.worldWater) errors.push(`${where}: groundPreset ${c.groundPreset} is not a ground material slot (section 7 of the reference).`);
      else if (m.worldGround) errors.push(`${where}: groundPreset ${c.groundPreset} is the world's ground; choose it as 0.`);
      // Slots are positions: a new surface layer's material or role takes a slot ahead of world.materials.extra and moves every later one
      // (round 6's trial-032 turned green-5's ground into sand). A map lays an extra ground or a rock type's, rarely a role's or a layer's.
      else if (/^role |surface layer/.test(materialUse(m))) warnings.push(`${where}: groundPreset ${c.groundPreset} now lays \`${m.source ?? m.name}\`, ${materialUse(m)}. If you added a surface layer or role material, the extra slots moved: renumber the scenes (section 7 of the reference).`);
    }
  });
}
// A rock type edited since the base that more than one map or a tool draws: round 2 tuned Green's shared greenstone for green-5 alone,
// which also changed the Knob, Cup knoll and Rock fin tools. A change for one map belongs in a new rock type.
if (baseCommit) {
  let before = {};
  try { before = JSON.parse(execFileSync('git', ['-C', repo, 'show', `${baseCommit}:materials/${world}.json`], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']})).world?.rock?.recipes ?? {}; } catch {}
  const slotOf = new Map(rocks.map(r => [r.key, r.slot]));
  for (const [key, recipe] of Object.entries(recipes)) {
    if (!before[key] || JSON.stringify(before[key]) === JSON.stringify(recipe)) continue;
    const tools = (w.tools ?? []).filter(t => t.rock === key).map(t => t.label ?? t.id);
    const users = scenes.filter(f => (load(`repro/scenes/${f}`).strokes ?? []).some(([, , o]) => o?.card?.rockPreset === slotOf.get(key))).map(f => f.replace('.json', ''));
    if (tools.length || users.length > 1)
      warnings.push(`world.rock.recipes.${key} changed since the base, and it is shared: ${[tools.length ? `the ${tools.join(', ')} tool${tools.length > 1 ? 's' : ''}` : '', users.length ? `windows ${users.join(', ')}` : ''].filter(Boolean).join(' and ')} draw it. This is a world change: judge it on every window it reaches and the tools. For one map's look, add a new rock type instead (append it to world.rock.presets) and give that map's strokes its slot.`);
  }
}
for (const k of Object.keys(w.knobDefaults ?? {})) if ((pinned.get(k)?.length ?? 0) === scenes.length && scenes.length)
  warnings.push(`world.knobDefaults.${k}: every window's scene sets its own ${k} (its query), so this world default reaches none of them. It is a map setting: change it per window in the scene's query (the map lane).`);
for (const [k] of new URLSearchParams(query)) if (pinned.has(k)) console.log(`note: --query ${k} overrides the scenes' own value (${pinned.get(k).join(', ')}) in every window it renders.`);

for (const m of warnings) console.log(`warning: ${m}`);
for (const m of errors) console.log(`error: ${m}`);
console.log(`match_validate: ${world}: ${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(errors.length ? 1 : 0);
