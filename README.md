# Terraform

An experimental terrain and map editor for Total Annihilation. The editor is
written in Go, runs at `/sculpt` in a WebGPU browser, and exports `.ufo` map
archives. The same Go terrain engine and WGSL shaders also render and export
maps natively without a browser. On macOS the native engine uses Metal.

Agents: read [AGENTS.md](AGENTS.md). Use American English in user-visible text.

## Run the editor

You need Go 1.27.1 or later and a browser that supports WebGPU in dedicated
workers. Chrome is the tested browser. Feature sprites and map export also need
a Total Annihilation installation, read by default from `~/TotalAnnihilation`.
The editor never writes there. Terrain materials are committed numerical tables
and do not need retail images at runtime.

```sh
./run.sh
```

Open [the editor](http://127.0.0.1:8891/sculpt). The script builds both Go WASM
programs and the native export/content helpers, then starts a Go server bound to
localhost. The first content scan can take a minute or two. Runtime Python and
application JavaScript implementations have been removed; the small scripts in
`web/` only start the Go runtimes.

Give each checkout its own port and assets directory:

```sh
ASSETS_ROOT=/private/tmp/terraform-my-work PORT=8892 ./run.sh
```

Repeat `--game-root DIR` to select other content roots in mount order. A private
prepared assets bundle can use `./run.sh --prepared --game-root DIR`; see
[BUNDLE.md](BUNDLE.md). `--export-tool PATH` and `--feature-tool PATH` select
existing helpers. Re-run `run.sh` after Go edits to rebuild WASM. Shader, material,
HTML and CSS changes are read from this checkout.

## Use the editor

The existing terrain brushes, curve forms and knot editor, rock columns,
materials, lighting, weathering, path branches, selection transforms, undo,
map objects, local autosave, file saves and server documents share one editor.
A world is material data and presets for the same GPU pipeline.

**Playable map** creates a blank canvas from 1–40 units per axis. Each unit is
512 playable pixels. A 4×4 map has 130×136 cells including its outer strips and
2080×2176 art pixels. Yellow outlines the playable rectangle; orange marks the
height-dependent edge strips. Fit, pixel zooms and the minimap navigate the
map. View PNG exports the visible viewport.

A stroke, move, rotation, scale or height drag commits one undo step. Escape
cancels a gesture. **Simplify strokes** retains endpoints and bends within three
terrain pixels; **Add path** preserves shared branch vertices. Undo restores
terrain, objects, map settings and columns while preserving brush preferences.

**Weathered view** changes the editing preview. Fit uses a coarse authored
preview; canonical zooms and export use the native terrain lattice. Turning off
Weathered view does not disable weathering in map export. The separate Weather
control sets whether the scene itself is weathered.

The feature catalog derives from installed maps and TDF/GAF content. Place or
erase features, paint or lasso a fill region, or flood connected land. Fills
use fresh GPU heights in the background worker, usage-weighted choices, density,
clustering, footprints and margins. Starts are numbered 1–10. Map objects,
starts and OTA settings are included in save files, documents and undo. Zhon's
features and export remain disabled until a retail planet is chosen.

**Export .ufo** streams tile-aligned PNG chunks and height bytes to the native
Go exporter. It validates the TNT/OTA/archive before publishing the `.ufo` and
indexed PNG under `<assets-root>/exports/`, with download links in the editor.
Cancel removes that job's temporary files. More than 65,536 distinct tiles is
refused. Installed map names and existing exports cannot be overwritten.
See [the export contract](export/README.md).

**Save to server** stores the recipe under `<assets-root>/documents/`;
**Reload document** restores the document's world, dimensions and sea level.
Sketch files are the portable alternative. Save files contain the stroke graph,
material choices and map objects, not a second CPU terrain implementation.

## Native Go / Metal export

Save a recipe from the editor, then run the same renderer without opening a
browser. After `run.sh` has built the helpers:

```sh
go run ./cmd/terraform \
  --assets-root /private/tmp/terraform-wgpu-run/assets \
  --prepared \
  --scene repro/recipes/native-hill.json \
  --out /private/tmp/terraform-native-smoke
```

Use a fresh output directory because export refuses existing map names. The
command prints the actual GPU adapter/backend and produces a `.ufo`, indexed
PNG and `heights.json`. Replace `--scene` with your saved recipe. Omit
`--prepared` when catalogs need to be extracted from installed content. A
standalone native window UI is not included; the browser UI is shared across
platforms, and native Go provides headless rendering/export.

## Architecture and checks

`internal/model` contains graph, curve, material and feature rules;
`internal/terrain` owns the shared wgpu pipeline; `internal/editor` implements
the DOM UI in Go WASM; `internal/editorworker` owns a separate WASM runtime in a
dedicated browser Worker. Goroutines inside WASM are not used as a substitute
for browser threads. Rendering, terrain preparation, weathering, feature fills
and PNG encoding run in the worker. Requests replace stale queued work, yield
between bounded tiles and transfer result buffers back to the UI. Export uses
one chunk at a time with upload backpressure.

GPU caches and the UI tile cache have byte budgets. Maps with at most 1168
working samples per side use global weather; larger maps use 512-cell weather
cores and a 128-cell solver apron. These match the previous engine's actual
geometry. Ordinary rendering keeps fields on the GPU; picking and feature
placement request heights without reading all 31 authored planes.

`gogpu/wgpu` is pinned with a small browser error-scope patch; see
[third_party/wgpu/PATCHES.md](third_party/wgpu/PATCHES.md). `gogpu/ui` was evaluated
but its native drawing dependencies do not currently compile for browser WASM,
so the existing HTML/CSS interface is driven by Go instead.

```sh
go test ./...
go test -race ./internal/model ./internal/server ./cmd/terraform
TERRAFORM_GPU_TEST=1 go test -count=1 ./internal/terrain
sh repro/gate.sh
```

Node runs browser checks; Python with `requirements.txt` is only needed for
retail measurement and image comparison tools. See [repro/README.md](repro/README.md)
for scene, regional replay, brush, export, curve and performance commands.
The [Go spike report](docs/GO_WGPU_SPIKE.md) records validation and remaining
limits. Historical experiments remain in `BACKLOG.md` and `EXPERIMENTS.md`;
their old implementation paths are not current setup instructions.
