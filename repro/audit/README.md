# Optional audit host

Run from the repository, using your own port and output directory:

```sh
go run ./cmd/repro-host --mode audit --source . --port 8895 \
  --out /private/tmp/terraform-audit/results
```

Open `/audit/index.html`. The host wraps the normal Go development handler;
source/config edits reload on requests. Only editor pages requesting `?audit`
activate the audit API. The normal development server and static build contain
no audit instrumentation.

`--evidence DIR` selects `inventory.json` and the `baseline/` source files;
`--assets DIR` selects read-only `assets-<world>/` reference files;
`--report DIR` optionally serves a report at `/audit-report/`. Evidence and asset roots default
to the historical private paths under `/private/tmp/terraform-tool-audit`; a
report is served only when `--report` is supplied.
The output directory is exposed at `/results/`. PNG/JSON evidence posts stay
under that directory and are limited to 32 MB. No retail evidence is committed.

`--source` chooses the editor checkout; `--tools` chooses the checkout containing
`repro/audit/` (both default to the working directory). Python analysis and report
scripts remain optional standalone research tools.
