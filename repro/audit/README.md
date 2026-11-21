# Optional audit host

Run from the repository, using your own port and output directory:

```sh
go run ./cmd/repro-host --mode audit --source . --port 8895 \
  --out /tmp/terraform-audit/results
```

Open `/audit/index.html`. The host wraps the normal Go development handler;
source/config edits reload on requests. Only editor pages requesting `?audit`
activate the audit API. The normal development server and static build contain
no audit instrumentation.

`--evidence DIR` selects `inventory.json` and the `baseline/` source files;
`--assets DIR` selects read-only `assets-<world>/` reference files;
`--report DIR` optionally serves a report at `/audit-report/`. Evidence and asset roots default
to `/tmp/terraform-tool-audit`, the 2026-10-31 audit's private evidence, which
no longer exists; `inventory.mjs` no longer matches today's `sculpt.js`, so the
audit page needs fresh evidence before it runs. A report is served only when
`--report` is supplied. `measure/world_controls.mjs --chrome` starts this host
for its own sweep.
The output directory is exposed at `/results/`. PNG/JSON evidence posts stay
under that directory and are limited to 32 MB. No retail evidence is committed.

`--source` chooses the editor checkout; `--tools` chooses the checkout containing
`repro/audit/` (both default to the working directory).
