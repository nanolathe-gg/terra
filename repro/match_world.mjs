// Retail match harness: a world's map slots as the editor builds them, for the reference and the validator.
// A scene's stroke names its rock type and its ground material by slot number (rockPreset, groundPreset). The slots are positions in the
// lists the editor makes from the world's data (sculpt-rock-presets.js worldRocks, sculpt-materials.js withWorldMaterials, as
// repro/headless.mjs openScene builds them), so they move when the world's lists change: read them from here, not from memory.
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {dumpConfigs} from './headless.mjs';

// The world's built config (go run ./cmd/terra --dump-configs, the same Go code the server runs) and its map lists.
export async function worldSlots(world, configs = '') {
  const dir = configs || dumpConfigs();
  const [mats, rock] = await Promise.all([import('../sculpt-materials.js'), import('../sculpt-rock-presets.js')]);
  const config = rock.applyWorldRock(JSON.parse(readFileSync(join(dir, 'config', `${world}.json`), 'utf8')));
  let materials = mats.withWorldMaterials(null, config), rocks = rock.worldRocks(config);
  const given = rock.giveRockMaterials(rocks, materials, rocks.map(r => r.slot), config);
  ({rocks, materials} = given);
  // How full the map's material table and the GPU material cache are: a rock type's material is added only while both have room.
  const layers = materials.reduce((n, m) => n + 1 + mats.materialStates(m).length, 0);
  const cache = mats.materialCacheUsage(layers, undefined, materials.some(mats.materialStaged));
  return {config, rocks, materials, missed: given.missed, room: {slots: materials.length, maxSlots: mats.MATERIAL_SLOTS - 1, cacheMiB: cache.bytes / 2 ** 20, budgetMiB: cache.budget / 2 ** 20}};
}

// What a material slot is for, in a few words.
export function materialUse(m) {
  if (m.worldGround) return 'the world\'s ground (a stroke chooses it as 0)';
  if (m.worldWater) return 'the world\'s water (not a ground choice)';
  const role = Object.keys(m).find(k => /^world[A-Z]/.test(k) && m[k] === true && k !== 'worldLayer');
  if (role) return `role ${role.slice(5).toLowerCase()}`;
  if (m.worldLayer) return `a surface layer's (${m.worldLayer})`;
  return 'a ground a stroke may lay (world.materials.extra or a rock type\'s)';
}
