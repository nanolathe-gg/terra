# Development assets bundle

A private bundle of the retail-derived files a cloud environment needs to
run the editor. It is for our own work only: never commit it and never
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

Run the server in prepared mode. It loads the saved map catalogue instead of
the retail sources and maps:

```sh
R=/private/tmp/nanolathe-map-editor
go build -o $R/map-export ./export
python3 sculpt.py --port 8801 --assets-root $R --game-root $R/content --prepared
REPRO_CROPS=$R/repro PYTHON=python3 sh repro/all.sh $R/repro-out/base http://127.0.0.1:8801 9450
```

Worlds come from `materials/<world>.json` and `sculpt.py` in every mode, so a
world needs no bundle. Renders under a different GPU or a
software WebGPU adapter may differ slightly from the Mac reference renders,
so render a fresh baseline before comparing.
