// Saved maps (owner, 2026-11-17): every map in this browser is its own entry, so two tabs never overwrite each other.
// - A tab edits one map. Its id sits in the tab's sessionStorage (a refresh keeps it) and the tab holds a Web Lock named for it while it is
//   open, so another tab can tell the map is in use.
// - A new tab reopens the map edited last unless another tab has it; then the editor shows its picker (Maps).
// - Opening a file or a share link, New map, and a world switch (a copy in the new world) add an entry: nothing is replaced.
// - The editor's own reloads (another world, a new map, an opened file) leave what the next page needs with the tab (`next`), read once as
//   if it were in the address. The share fragment belongs to the current map and is cleared when switching maps.
// Bodies live in IndexedDB: a map recipe with its world is about 150 KB, and localStorage holds a few MB per site.
import {copyPictures} from './sculpt-thumbnails.js';
const DB = 'terraform-maps', BODIES = 'maps', META = 'meta';
export const TAB_KEY = 'terraform-tab-v1';
// The single working copy and "previous map" slot of earlier builds: imported once into an empty list so no map is lost.
export const LEGACY_KEYS = ['terraform-working-map-v1', 'terraform-previous-map-v1'];
const LOCK = 'terraform-map:';
// Address switches for the checks and diagnostics. The editor's own reloads keep these and drop every other parameter. A world switch
// carries `scratch` with the tab (sculpt.js goToWorld: a scratch page stays one); a scratch page that opens a map saves from then on.
export const DEV_SWITCHES = ['gpuMB', 'heapMB', 'gpuPages', 'digestGuard', 'levels', 'levelsOverlay', 'weatheredView', 'noJoin', 'timeApron', 'pageRing'];
// Parameters that name a map to start (a world, a size, a sea level): with one present a tab without a map starts one instead of the picker.
export const MAP_SWITCHES = ['biome', 'world', 'mapX', 'mapY', 'sea', 'newMap'];

export const newMapId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const count = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Math.round(Number(value)) : 0;
// What the picker shows of a map, kept beside its body so listing never reads the bodies.
export function mapMeta(id, s, updated = Date.now()) {
  return {
    id, updated,
    name: String(s?.mapData?.name || '').trim().slice(0, 128) || 'Untitled map',
    biome: typeof s?.biome === 'string' ? s.biome : '',
    world: typeof s?.world === 'string' ? s.world : (typeof s?.biome === 'string' ? s.biome : ''),
    unitsX: count(s?.map?.unitsX), unitsY: count(s?.map?.unitsY),
    strokes: Array.isArray(s?.nodes) ? s.nodes.filter(n => n && n.kind !== 'ground').length : 0,
    // Its picture from above (sculpt-thumbnails.js), so the list shows it without reading the body.
    ...(copyPictures(s?.pictures)?.map ? {picture: s.pictures.map.image} : {}),
  };
}
export const byRecent = list => [...list].sort((a, b) => (b.updated || 0) - (a.updated || 0) || String(a.id).localeCompare(String(b.id)));
// The map a tab without one reopens: the one edited last, unless an open tab holds it (then none, and the picker asks).
export function mapToReopen(list, inUse) {
  const last = byRecent(list)[0];
  return last && !inUse.has(last.id) ? last.id : null;
}
// The address the editor reloads to: this page with only the diagnostic switches.
export function cleanAddress(href) {
  const url = new URL(href);
  for (const key of [...url.searchParams.keys()]) if (!DEV_SWITCHES.includes(key)) url.searchParams.delete(key);
  url.hash = '';
  return url.toString();
}
export const startsMap = params => MAP_SWITCHES.some(key => params.has(key));

export function readTab(storage) {
  try {
    const t = JSON.parse(storage?.getItem(TAB_KEY) || 'null');
    return {map: typeof t?.map === 'string' ? t.map : null, next: t?.next && typeof t.next === 'object' && !Array.isArray(t.next) ? t.next : null};
  } catch (_) { return {map: null, next: null}; }
}
export function writeTab(storage, tab) {
  try { storage.setItem(TAB_KEY, JSON.stringify({map: tab.map ?? null, ...(tab.next ? {next: tab.next} : {})})); return true; } catch (_) { return false; }
}

// Holds the map's lock until the page closes or the answer (a function) is called; null when another tab holds it. Without Web Locks every
// map counts as free.
export function holdMap(id, locks = globalThis.navigator?.locks) {
  const free = () => {};
  if (!locks?.request) return Promise.resolve(free);
  return new Promise(resolve => {
    locks.request(LOCK + id, {ifAvailable: true}, lock => {
      if (!lock) { resolve(null); return undefined; }
      return new Promise(release => resolve(release));
    }).catch(() => resolve(free));
  });
}
export async function mapsInUse(locks = globalThis.navigator?.locks) {
  try {
    const state = await locks?.query?.();
    return new Set((state?.held || []).map(l => String(l.name)).filter(name => name.startsWith(LOCK)).map(name => name.slice(LOCK.length)));
  } catch (_) { return new Set(); }
}

export function openMapStore(indexedDB = globalThis.indexedDB) {
  if (!indexedDB) throw new Error('This browser keeps no saved maps (IndexedDB is unavailable).');
  let db = null;
  const open = () => db ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains(BODIES)) d.createObjectStore(BODIES); if (!d.objectStoreNames.contains(META)) d.createObjectStore(META, {keyPath: 'id'}); };
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); r.onblocked = () => reject(new Error('Saved maps are blocked by another tab of an older build. Close it and reload.'));
  });
  // One transaction; `fn` issues its requests at once and returns the one whose result the call answers.
  const run = async (stores, mode, fn) => {
    const t = (await open()).transaction(stores, mode), r = fn(t);
    return new Promise((resolve, reject) => { t.oncomplete = () => resolve(r?.result); t.onerror = t.onabort = () => reject(t.error || new Error('The saved map could not be written.')); });
  };
  return {
    list: () => run([META], 'readonly', t => t.objectStore(META).getAll()).then(list => list || []),
    get: id => run([BODIES], 'readonly', t => t.objectStore(BODIES).get(id)).then(body => body ?? null),
    put: (id, sketch, meta = mapMeta(id, sketch)) => run([BODIES, META], 'readwrite', t => { t.objectStore(BODIES).put(sketch, id); t.objectStore(META).put({...meta, id}); }),
    remove: id => run([BODIES, META], 'readwrite', t => { t.objectStore(BODIES).delete(id); t.objectStore(META).delete(id); }),
  };
}
// The working copy and previous slot of an earlier build, moved into an empty list (newest first) and removed from localStorage.
export async function importLegacyMaps(store, storage, now = Date.now()) {
  if ((await store.list()).length) return 0;
  let moved = 0;
  for (const [i, key] of LEGACY_KEYS.entries()) {
    let s = null; try { s = JSON.parse(storage?.getItem(key) || 'null'); } catch (_) {}
    if (s?.format === 'nanolathe-terrain-sculpt' && Array.isArray(s.nodes)) { const id = newMapId(); await store.put(id, s, mapMeta(id, s, now - i)); moved++; }
    try { storage?.removeItem(key); } catch (_) {}
  }
  return moved;
}
