# Development assets bundle

A private bundle of the retail-derived files a cloud environment needs to
run optional retail measurement and comparison tools. It is for our own work only: never commit it and never
publish it to users. Unpack it to an assets root, for example
`/private/tmp/nanolathe-map-editor`:

- `assets-<world>/`: each world's prepared images and `config.json`, the measuring source of `measure/` (the server no longer reads them);
- `features/<world>/`: a few metal deposits, trees and rocks per world, with
  their sprites;
- `map-catalog.json`: the saved world catalogue (palette, climate and sea
  level medians, installed map names);
- `content/`: a small game-content root with the retail palette and the
  feature TDFs for those features;
- `repro/`: the retail crops that `repro/all.sh` compares against.

The editor itself needs none of this bundle. Its Go development server and
static build use only committed JSON data and source files:

```sh
go run ./cmd/terra --port <yours> --assets-root /private/tmp/terra-agent
```

For an explicit retail comparison, set `REPRO_CROPS` to the bundle's `repro/`
and run the standalone `repro/all.sh` workflow. That workflow still uses Python
for crop sheets. Never use the owner's port 8801 from an agent session.

World data lives in `materials/<world>.json`; common defaults live in
`materials/defaults.json`. Renders under a different GPU or a software WebGPU
adapter may differ slightly from the Mac references, so render a fresh
baseline for an explicit comparison.
