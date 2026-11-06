# Save-link Worker

Permanent, content-addressed share links for Terraform saves. A Cloudflare Worker (`worker.js`, no dependencies) over an
R2 bucket, on the free tier at a workers.dev address. Wrangler is run with `npx`; nothing is added to the repo.

## Deploy (once)

```sh
cd deploy/worker
cp wrangler.toml.example wrangler.toml     # edit ALLOWED_ORIGINS if the site's address differs
npx wrangler login
npx wrangler r2 bucket create terraform-maps
npx wrangler secret put ADMIN_TOKEN        # paste a long random string (for example `openssl rand -hex 32`); needed only for DELETE
npx wrangler deploy
```

`deploy` prints the address, `https://terraform-savelinks.<your-subdomain>.workers.dev`. R2 needs a payment method on the
account even though the free tier (10 GB, 1 M writes and 10 M reads a month) covers this use.

Try it:

```sh
gzip -c save.json | curl -s -X POST --data-binary @- -H 'Content-Type: application/octet-stream' https://<worker>/maps   # {"id":"..."}
curl -s https://<worker>/maps/<id> | head -c 200
```

## API

| Request | Result |
| --- | --- |
| `POST /maps`, body is the gzipped save | `{"id": "<16 base32 chars>"}`. Refused with `{"error": "..."}`: 413 over 1 MB compressed or 16 MB uncompressed, 400 if not gzip, not JSON, or not a Terraform save (`format` `nanolathe-terrain-sculpt`, integer `version`, `nodes` list) |
| `GET /maps/<id>` | the stored bytes with `Content-Encoding: gzip`, `Content-Type: application/json`, `Cache-Control: public, max-age=31536000, immutable`; 404 for an unknown id |
| `DELETE /maps/<id>` with `Authorization: Bearer <ADMIN_TOKEN>` | `{"deleted": id}`; 401 without the token, 403 if no `ADMIN_TOKEN` is set |
| `OPTIONS` | CORS preflight |

The id is the first 16 base32 characters of the SHA-256 of the gzipped bytes. The same bytes give the same link and one
write. Note the id depends on the gzip bytes, not the JSON: a client that wants the same map to give the same link must
compress deterministically (for example a fixed gzip header with no timestamp). A leading `/api` is accepted so the
local `sculpt.py` server (`/api/maps`) and production share one client path.

CORS allows `ALLOWED_ORIGINS` (comma separated) and, unless `ALLOW_LOCALHOST` is `0`, `http://localhost` and
`http://127.0.0.1` on any port.

## Taking a link down

```sh
curl -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" https://<worker>/maps/<id>
```

Browsers and Cloudflare's edge may keep serving the old copy for up to a year (the cache header is immutable); purge the
URL in the Cloudflare dashboard if it matters.

## Notes

- Objects live under `maps/`. A later "publish" of exported `.ufo` files can use another prefix (for example `publish/`)
  with an R2 lifecycle rule for the 90-day expiry; nothing here touches other prefixes.
- No rate limiting is built in. If abuse appears, add a Cloudflare rate-limiting rule on `POST /maps` in the dashboard.
- Tests: `node --test repro/worker.test.mjs` (an in-memory R2 stand-in, no Cloudflare needed).
