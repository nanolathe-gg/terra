// Save links: the editor's side of the save-link service (services.json "maps"; deploy/worker/ in production, internal/site/server.go in development).
// Pure functions, no page state, so node can test them.

export const ID_RE = /^[a-z2-7]{16}$/;

// The text that is shared: the save with sorted keys and without fields that only say "default" (`hidden: false`, undefined values), so a
// stroke gives the same bytes whether it was drawn or loaded from a link, and sharing a loaded map again gives the same link.
const canon = (v, key) => Array.isArray(v) ? v.map(x => canon(x)) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().filter(k => v[k] !== undefined && !(k === 'hidden' && v[k] === false)).map(k => [k, canon(v[k], k)])) : v;
export const shareText = save => JSON.stringify(canon(save));

let crcTable = null;
export function crc32(bytes) {
  if (!crcTable) crcTable = Uint32Array.from({length: 256}, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// The same text gives the same bytes, so the same map gives the same link. The gzip header is fixed (no time, no name, unknown OS); the
// browser's own gzip writes an OS byte that can differ between platforms, so only the deflate stream comes from CompressionStream.
export async function gzipText(text) {
  const raw = new TextEncoder().encode(text);
  const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const body = new Uint8Array(await new Response(stream).arrayBuffer());
  const out = new Uint8Array(10 + body.length + 8), view = new DataView(out.buffer);
  out.set([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 255]);
  out.set(body, 10);
  view.setUint32(10 + body.length, crc32(raw), true);
  view.setUint32(14 + body.length, raw.length >>> 0, true);
  return out;
}

// The link to a saved map: the page's own address (a static build's versioned folder is replaced by the site root, whose index opens the
// current build and keeps the query) with ?map=<id>.
export function shareUrl(href, id) {
  const url = new URL(href);
  url.search = ''; url.hash = '';
  url.pathname = url.pathname.replace(/\/b\/[0-9a-f]{10}\/[^/]*$/, '/').replace(/\/index\.html$/, '/');
  url.searchParams.set('map', id);
  return url.toString();
}
export function mapIdFromSearch(search) {
  const id = new URLSearchParams(search).get('map');
  return id === null ? null : id;
}
export function withoutMap(href) {
  const url = new URL(href);
  url.searchParams.delete('map');
  return url.toString();
}

export function mapsService(services) {
  const maps = services?.maps;
  if (!maps || maps.available === false) return {url: '', reason: maps?.reason || 'This host has no save-link service.'};
  return {url: String(maps.url || '').replace(/\/+$/, ''), reason: ''};
}

async function detail(response) {
  try { return (await response.json()).error || ''; } catch (_) { return ''; }
}
export async function postMap(base, gz, fetcher = fetch) {
  let response;
  try { response = await fetcher(base, {method: 'POST', body: gz, headers: {'Content-Type': 'application/octet-stream'}}); }
  catch (_) { throw new Error('The save-link service could not be reached. Check your connection and try again.'); }
  if (!response.ok) {
    const why = await detail(response);
    throw new Error(response.status === 413 ? 'This map is too large to share as a link. Use Save to keep it as a file.' : `The save-link service refused this map${why ? ': ' + why.replace(/\.+$/, '') : ` (error ${response.status})`}.`);
  }
  const {id} = await response.json();
  if (!ID_RE.test(id || '')) throw new Error('The save-link service sent an answer this editor does not understand.');
  return id;
}
export async function getMap(base, id, fetcher = fetch) {
  if (!ID_RE.test(id)) throw new Error('This link is not a valid map link. Your current map was left as it was.');
  let response;
  try { response = await fetcher(`${base}/${id}`); }
  catch (_) { throw new Error('The save-link service could not be reached, so the shared map was not opened. Your current map was left as it was.'); }
  if (response.status === 404) throw new Error('No saved map has this link. Check that the whole link was copied. Your current map was left as it was.');
  if (!response.ok) throw new Error(`The save-link service could not open this map (error ${response.status}). Your current map was left as it was.`);
  try { return await response.json(); }
  catch (_) { throw new Error('The shared map is damaged and could not be read. Your current map was left as it was.'); }
}

