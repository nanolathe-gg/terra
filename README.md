# Terraform

A browser (WebGPU) terrain and map editor for Total Annihilation, an
experimental prototype. It exports `.ufo` map archives. It began as
Nanolathe's `tools/map-editor`, and its history came with it.

Agents: read [AGENTS.md](AGENTS.md) before changing anything.

Use American English for all user-visible text, including labels, help, status
messages, preset descriptions, and export errors (for example, color, center,
gray, and canceled).

To develop or build the editor, you need Go 1.27.1 or later and a browser
with WebGPU. Node runs the checks. Python and the scientific packages in
`requirements.txt` are optional tools for terrain analysis and retail research;
they are not needed to serve, build, generate configs or export maps. The
editor needs no installed game content or private assets.

Install the preview pre-push check once after cloning:

```sh
go run ./cmd/previews install-hook
```

Generated preview PNGs live in a pinned GitHub Release bundle. The Go server
and static builder download them automatically when absent; a private repo
needs `gh auth login` or `GH_TOKEN`. Fast unit tests need no preview download.
See [preview publishing and freshness checks](docs/PREVIEW_ASSETS.md).

Run the development server from the repository:

```sh
go run ./cmd/terraform --port 8801 --assets-root /private/tmp/terraform-editor
```

Port 8801 is the owner's editor; agents use their own free ports and assets
roots as described in AGENTS.md. `--assets-root` stores local save links only.
A compiled tool also works: `go build -o /private/tmp/terraform ./cmd/terraform`,
then `/private/tmp/terraform --root /path/to/terraform --port <yours>`.

Source files are read on every request with caching disabled. Generated
configs reload their JSON inputs on each request too: edit HTML, JavaScript,
CSS, shaders, world tables, defaults, variants or the source manifest and
refresh the page. No server restart is needed. Exporter Go changes rebuild
WebAssembly on its next request. Changes to the server's Go code require a
restart (rerun `go run`).

Shared knob defaults and ground cover live in `materials/defaults.json`.
Each world's `world.knobDefaults`, `world.engineDefaults` and `world.variants`
in `materials/<world>.json` hold its authored presets. `site.json` declares
the worlds, recipe ordering and shipped source files. The Go tool in
`internal/site/` assembles all nine worlds from this data. All terrain and
features are generated in the browser; `.ufo` export uses the Go exporter
compiled to WebAssembly. The Go packages are pinned in `go.mod`.

Open <http://127.0.0.1:8801/>. **Playable map** creates a blank map
canvas. Choose 1–40 units on each axis and a sea level, initially the
upper median TNT sea level of its retail world. Each unit is 512 playable
pixels. A 4×4 map contains 130×136 cells, including the outer strips, and
2080×2176 art pixels. Yellow outlines the playable rectangle; orange marks
the height-dependent edge strips. Fit, 1×, 0.5× and the minimap navigator use a viewport-sized canvas. Export view PNG captures only the current view.

The authored-field regression check uses an isolated headless Chrome:

```sh
cd terraform
node repro/regional.mjs repro/scenes/lava-1.json --server http://127.0.0.1:8801 --port 9640
```

It waits for the scene and any flow bake, then compares every authored field
from whole replay with four 2×2 regional reads. Its JSON report includes every
plane's mismatch count, maximum difference and first mismatch; any mismatch
or editor error exits nonzero. The selected CDP port must be free. Weather
and projected GPU art retain the separate image/replay guards in `repro/all.sh`.

The original 1024px study remains available. Draw a map with the existing
terrain brushes, then use the feature tools. Water brush depths and material
height thresholds are relative to sea. Choose a positive sea level for deep
water: TNT heights are unsigned bytes.

The feature catalog is assembled from the committed world tables. Sprites,
shadows and burn animations are generated in the page; no installed TDF/GAF
content is read. Zhon export remains disabled until the owner chooses a planet.

Place and erase features on cells. Fills offer trees, foliage or rocks over
a brush, lasso or connected flood region, with usage-weighted selection,
density, noise clustering, footprint spacing, a seed and margins around
starts and deposits. Fills require every covered cell to be dry and its four
corner heights to differ by at most 10, following `gentleLand`. Features use
a separate overlay; they never become terrain pixels.

Starts are numbered 1–10 and exported in pixel coordinates. The OTA settings
panel edits name, description, wind, tidal, solar, gravity, surface metal,
Moho metal and lava world. Climate starts at the world's retail medians.
Map objects and settings join the terrain in Save sketch / Load sketch and
Undo / Redo; feature/settings undo does not rerun terrain refinement.

**Export .ufo** warns when corner heights need clamping to 0–255. Art uses
the full-detail displayed field, clamped to the TNT byte range. Only TNT
attributes use quantized 16px corners. Art is projected from height zero;
the preview remains base-relative. The nearest-pixel shift is chosen once
for the entire image, including half-pixel ties. Export captures tile-aligned
PNG chunks, adds no noise, and deduplicates identical indexed tiles. The
minimap averages RGB within each block before its nearest-palette lookup.

The export runs in the page, on the Go development server and on the static site alike: the
exporter (`export/`, built for WebAssembly) runs in a worker and offers the
finished archive and indexed PNG as downloads; nothing is saved on the server.
Each archive contains `maps/<name>.ota` and `maps/<name>.tnt`. The exporter
decodes and checks the TNT cells, feature anchors/fringe, tiles, minimap, OTA
settings/starts and archive before offering it. The page has no list of the
maps installed on a player's machine, so it does not refuse their names.
See [the export format contract](export/README.md).

Full-size maps keep the stroke graph as their source. Field prefix tiles replay
with each brush's read apron; long connected coasts query earlier tiles without
expanding one connected bounding box. Lava shore layers reduce their whole
stroke bounds tile by tile, retaining the global bite lattice while processing
only each requested region. Brush aprons include base variation, hill lobes,
facet-crater seed reads and the finger/shore/frost reach. Visible chunks and one surrounding margin
are baked on demand. Scrolling redraws cached images immediately, using Fit
tiles or the coarse height preview wherever detail is missing. It keeps moving
while terrain generation is busy. Newly visible 256-pixel tiles begin rendering
during scrolling, showing authored detail first, then the final weathered result,
before filling the surrounding cache. Each completed tile appears immediately.
Background overview sampling, CPU copies, and save scans yield while visible
detail is missing. Small camera movements retain useful in-flight tiles;
tiles that leave the view are canceled before further work is queued.
Overview and the navigator also use a coarse 128×128 height preview. A stroke, move, rotation, scale or
height drag previews while held and commits one undo step; Escape cancels it.

**Weathered view**, next to Rendered / Clay, is on by default. Turn it off to
edit the authored terrain without waiting for weathering, then turn it on for
spot checks. The browser remembers the preference; `weatheredView=0` in the URL
also selects the fast view. This only changes the zoomed-in display and picking.
The map recipe, weathering settings, and canonical export rendering stay the
same. Fit remains a coarse authored preview in either mode.

**Simplify strokes** (on by default in Draw) reduces a freehand path when you
release the pointer, keeping its endpoints and bends within 3 terrain pixels of
the sampled path. This leaves fewer points in **Edit path**. It also applies to
**Add path**, keeping an attached branch's shared root and existing paths intact.
Turn it off to keep every sampled point. Simplification is part of the stroke's
single Undo / Redo step; loaded sketches and scripted scenes keep their points.

River and Source strokes keep one cached flow-bake node. Its input heights
are read in bounded prefix tiles before that node, while its stale hash still
covers the entire bake region. Regional replay copies only the stored planes
overlapping its window; eviction and export never simulate the flow again.
One whole bake job and its five output planes must fit the page budget; an
overlarge job is refused before its inputs or worker are allocated.

The GPU and page heap budgets default to 512 MiB and 1 GiB, with controls in
**Map view and memory** (`gpuMB` / `heapMB` in the URL). The device requests
default WebGPU limits. Mask storage counts its actual layer count: currently 25 planes in 7 RGBA
layers. Flow occupies planes 20–24; 14–19 and 25+ remain unused. Every selected
GPU budget uses the same canonical bake size chosen at the 128 MiB floor; lower
budgets evict and re-bake more images. Changing chunk geometry can move isolated
palette decisions because the GPU rounds interpolation differently. The remaining
Ice frost decision is documented with raw field and float probes in NOTES.md.

Maps with at most 1168 samples on their working side keep the existing global
weather solver. Larger maps use fixed 256-cell weather cores, 64-cell blend
overlap and another 128-cell solver apron. Tile seeds depend only on the map seed
and tile coordinates, so cache size and renderer chunk boundaries do not change
the result. Weather is lazy in the view; exports await it for both art and TNT
corner heights. Field, weather and upload reservations share the page budget.

**Share link** gzips the save (a fixed header, so the same map is the same link), posts it to the
save-link service (`maps` in `services.json`: `/api/maps` here, the Worker in `deploy/worker/` for the
static build) and shows `?map=<id>`. Opening such a link keeps your own map in one "previous map"
slot and offers to restore it. The working copy autosaves in the browser; **Save** and **Load**
write and read a file.

Export streams one tile-aligned PNG at a time to the exporter's worker. It
keeps hashes, tile indices and attributes in memory, spills tile bytes past its
budget to the browser's Origin Private File System, and writes the indexed PNG
and archive there without a full-map image buffer. Cancel stops the worker and
offers no partial archive; its files are removed. A map with more than 65,536
distinct tiles has its most alike tiles merged (`export/merge.go`).

## Optional interaction and audit hosts

The research browser hosts also use Go and wrap the normal development
handler. From the repository, use your own free port and output directory:

```sh
go run ./cmd/repro-host --mode interaction --port <yours> --out /private/tmp/terraform-interaction
go run ./cmd/repro-host --mode audit --port <yours> --out /private/tmp/terraform-audit
```

Open `/interaction/index.html` or `/audit/index.html`. The editor iframe stays
at `/`. Hooks are confined to the selected host and query flag; they are not
part of the normal editor or static build. See the
[interaction harness](repro/interaction/README.md) and
[audit host](repro/audit/README.md) for source/evidence options. Python remains
in the standalone analysis and report tools.

## The static site

`go run ./cmd/terraform --build-site <dir>` writes `<dir>/index.html` (the
editor itself) and `<dir>/b/<version>/` with the HTML, scripts, styles,
shaders, world tables, downloaded previews, generated JSON configs and WebAssembly
exporter. It prints the versioned directory. That directory's name hashes all
shipped bytes, so a deploy does not mix new scripts with cached old shaders.
The root page uses a versioned asset base and keeps query strings, fragments
and share links at `/`; it does not redirect to another page.
Any static HTTP host can serve the output; the deployed site needs no Go or
Python runtime.

`go run ./cmd/terraform --dump-configs <dir>` emits just `config/*.json` and
`services.json`, for headless rendering and measurements. It does not compile
the exporter. `--maps-url URL` or `TERRAFORM_MAPS_URL` selects the static site's
save-link Worker; development uses the local `api/maps` service.

`.github/workflows/pages.yml` runs the fast checks, then builds with Go and
validates that same artifact before deploying to GitHub Pages. For local
verification, see [the focused check commands](repro/README.md).
