// Save links: a Cloudflare Worker over an R2 bucket. No dependencies, no secrets in this file.
//
//   POST   /maps        body: the gzipped save (Terraform's `sketch()` JSON)   ->  {"id": "..."}
//   GET    /maps/<id>   the stored save; a browser fetch() gets the JSON (Content-Encoding: gzip)
//   DELETE /maps/<id>   owner only: `Authorization: Bearer <ADMIN_TOKEN>`
//
// The id is the first 16 base32 characters (80 bits) of the SHA-256 of the gzipped bytes, so one body is one link and a
// link never changes. A leading /api is accepted too (the local server in sculpt.py serves /api/maps), so a client uses
// one path in development and in production. Objects are stored as `maps/<id>.json.gz`; other prefixes (for example a
// later `publish/` with an expiry rule on the bucket) are left alone.
//
// Bindings and variables (wrangler.toml / `wrangler secret put ADMIN_TOKEN`):
//   MAPS             R2 bucket binding (required)
//   ADMIN_TOKEN      secret for DELETE; without it, DELETE is switched off
//   ALLOWED_ORIGINS  comma-separated origins allowed by CORS (default https://terra.nanolathe.gg)
//   ALLOW_LOCALHOST  "0" to refuse localhost origins (default: allowed, for development)

export const MAX_COMPRESSED = 1024 * 1024;      // 1 MiB of gzip
export const MAX_UNCOMPRESSED = 16 * 1024 * 1024; // a real save is 40-105 KB of JSON; this stops gzip bombs
export const FORMAT = 'nanolathe-terrain-sculpt';
const ID_RE = /^[a-z2-7]{16}$/;
const DEFAULT_ORIGINS = 'https://terra.nanolathe.gg';

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers}});

class Refusal extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Read a stream into one array, refusing as soon as it passes `limit` bytes.
async function readLimited(stream, limit, tooBig) {
  const parts = [];
  let size = 0;
  if (!stream) return new Uint8Array(0);
  const reader = stream.getReader();
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel().catch(() => {}); throw new Refusal(413, tooBig); }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.byteLength; }
  return out;
}

const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
export async function mapId(bytes) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  let bits = 0, value = 0, out = '';
  for (const byte of hash) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5 && out.length < 16) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
    value &= (1 << bits) - 1;
    if (out.length === 16) break;
  }
  return out;
}

// The gzipped body must gunzip within the cap to a Terraform save: the checks the editor's loader makes on its shape.
export async function checkSave(gz) {
  if (gz.length < 2 || gz[0] !== 0x1f || gz[1] !== 0x8b) throw new Refusal(400, 'The body is not gzip data. Send the save compressed with gzip.');
  let text;
  try {
    const stream = new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'));
    text = new TextDecoder('utf-8', {fatal: true}).decode(await readLimited(stream, MAX_UNCOMPRESSED, 'The save is too large once uncompressed (limit 16 MB).'));
  } catch (err) {
    if (err instanceof Refusal) throw err;
    throw new Refusal(400, 'The gzip data is damaged or does not hold UTF-8 text.');
  }
  let save;
  try { save = JSON.parse(text); } catch { throw new Refusal(400, 'The save is not valid JSON.'); }
  if (!save || typeof save !== 'object' || Array.isArray(save) || save.format !== FORMAT) throw new Refusal(400, 'This is not a Terraform save: its format must be ' + FORMAT + '.');
  if (!Number.isInteger(save.version) || save.version < 1) throw new Refusal(400, 'This is not a Terraform save: it has no version number.');
  if (!Array.isArray(save.nodes) || save.nodes.some(n => !n || typeof n !== 'object')) throw new Refusal(400, 'This is not a Terraform save: nodes must be a list of stroke objects.');
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return {};
  const allowed = String(env.ALLOWED_ORIGINS ?? DEFAULT_ORIGINS).split(',').map(s => s.trim()).filter(Boolean);
  let ok = allowed.includes(origin);
  if (!ok && env.ALLOW_LOCALHOST !== '0') {
    try { const u = new URL(origin); ok = u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'); } catch { /* not an origin */ }
  }
  if (!ok) return {Vary: 'Origin'};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

// Compare the secret without leaking its length or first mismatch through timing.
async function sameSecret(given, secret) {
  const digest = async s => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  const [a, b] = await Promise.all([digest(given), digest(secret)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function route(request, env) {
  const url = new URL(request.url);
  let path = url.pathname.replace(/^\/api(?=\/maps)/, '');
  const match = /^\/maps(?:\/([^/]*))?$/.exec(path);
  if (!match) throw new Refusal(404, 'Not found.');
  const id = match[1];
  const key = id => `maps/${id}.json.gz`;

  if (request.method === 'POST' && id === undefined) {
    const declared = Number(request.headers.get('Content-Length'));
    if (declared > MAX_COMPRESSED) throw new Refusal(413, 'The save is too large (limit 1 MB compressed).');
    const gz = await readLimited(request.body, MAX_COMPRESSED, 'The save is too large (limit 1 MB compressed).');
    await checkSave(gz);
    const newId = await mapId(gz);
    // The same bytes are the same link: skip the write when it is already there.
    if (!(await env.MAPS.head(key(newId)))) {
      await env.MAPS.put(key(newId), gz, {httpMetadata: {contentType: 'application/json', contentEncoding: 'gzip'}, customMetadata: {created: new Date().toISOString()}});
    }
    return json({id: newId});
  }
  if ((request.method === 'GET' || request.method === 'HEAD') && id !== undefined) {
    if (!ID_RE.test(id)) throw new Refusal(404, 'No saved map has this id.');
    const object = await env.MAPS.get(key(id));
    if (!object) throw new Refusal(404, 'No saved map has this id.');
    // The stored bytes are already gzip: encodeBody 'manual' stops the Workers runtime from compressing them a second
    // time because of the Content-Encoding header (a browser would then decode one layer and get gzip, not JSON).
    return new Response(request.method === 'HEAD' ? null : object.body, {encodeBody: 'manual', headers: {
      'Content-Type': 'application/json', 'Content-Encoding': 'gzip',
      'Cache-Control': 'public, max-age=31536000, immutable', ETag: `"${id}"`,
    }});
  }
  if (request.method === 'DELETE' && id !== undefined) {
    if (!env.ADMIN_TOKEN) throw new Refusal(403, 'Deleting is not enabled on this server.');
    const m = /^Bearer (.+)$/.exec(request.headers.get('Authorization') || '');
    if (!m || !(await sameSecret(m[1], env.ADMIN_TOKEN))) throw new Refusal(401, 'The admin token is missing or wrong.');
    if (!ID_RE.test(id)) throw new Refusal(404, 'No saved map has this id.');
    await env.MAPS.delete(key(id));
    return json({deleted: id});
  }
  throw new Refusal(405, 'Method not allowed.');
}

export async function handle(request, env) {
  const cors = corsHeaders(request, env);
  if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors});
  let response;
  try { response = await route(request, env); }
  catch (err) {
    if (!(err instanceof Refusal)) { console.error(err); response = json({error: 'The server could not handle this request.'}, 500); }
    else response = json({error: err.message}, err.status);
  }
  // Add CORS to the response itself: rebuilding it would drop encodeBody 'manual' and gzip a stored save twice.
  for (const [k, v] of Object.entries(cors)) response.headers.set(k, v);
  return response;
}

export default {fetch: handle};
