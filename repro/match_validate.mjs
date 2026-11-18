// Retail match harness: check a world's files before a trial renders, with messages that say what to fix.
//   node repro/match_validate.mjs <world>
// Reads this checkout's materials/<world>.json, materials/textures.json and materials/defaults.json, and checks what a matching agent edits:
//  - JSON that parses (with the line of the error);
//  - world.knobDefaults: each key a World control, a rock setting or a known engine default, and inside its range;
//  - world.materials and every material a layer, rock type or tool names: present in textures.json, and a graph the editor accepts
//    (sculpt-materials.js copyMaterial, the same check the material editor runs) or a `like` copy of one;
//  - world.surface: a list the editor accepts (sculpt-material-model.js copySurface), with known facts, stages and materials;
//  - world.rock: recipes whose knobs are rock settings, presets that name a recipe.
// Exit 1 on an error, 0 with warnings. repro/match.sh runs it before every trial.
import {readdirSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const world = process.argv[2];
if (!world) { console.error('usage: node repro/match_validate.mjs <world>'); process.exit(2); }
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

for (const m of warnings) console.log(`warning: ${m}`);
for (const m of errors) console.log(`error: ${m}`);
console.log(`match_validate: ${world}: ${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(errors.length ? 1 : 0);
