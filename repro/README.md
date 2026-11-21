# Checks and reproductions

For everyday development, run `repro/check.sh` (fast Node unit tests and the
world-name gate), or a relevant test directly, such as
`node --test repro/paths.test.mjs`. The default needs no Python, Go, GPU,
browser, generated configs or retail assets. Integration tests have explicit
`.config`, `.build`, `.export`, `.features`, `.assets`, `.digest` or `.gpu` filename suffixes and run on demand:

```sh
repro/check.sh quick --test repro/paths.test.mjs
repro/check.sh browser --server http://127.0.0.1:<yours> --port <cdp> --worlds green
repro/check.sh engine --scene repro/shape-scenes/green-landform.json
repro/check.sh digest
repro/check.sh export
repro/check.sh features
repro/check.sh config
repro/check.sh site
repro/check.sh assets
```

`--list` previews commands; `--out DIR` selects the log directory. The
`engine` group uses three authored fixtures unless you select scenes. The
browser group defaults to one world and skips export and the large-map sweep.
Build, config and exporter checks use Go. The config group also runs the Go
server tests, including live source/config reload and local save links. Engine
checks use Go to emit their configs; no Python is needed for these groups.
Site deployment validates its already-built output instead of building it twice.

Choose checks for the behavior you changed; see [AGENTS.md](../AGENTS.md#checks).
The old `land`/`full` tiers, automatic baseline renders and mandatory visual
sweeps are retired. Do not use `node --test repro/*.test.mjs` for routine
checks: that wildcard includes expensive integration tests.

GPU preview pictures are external release assets. `go run ./cmd/previews
install-hook` installs the CPU-only outgoing-commit freshness/publication gate;
`repro/check.sh assets` verifies the images too. Missing pinned assets are fetched
by the Go editor/build without a GPU. See [the asset workflow](../docs/PREVIEW_ASSETS.md).

The focused map-file handoff check runs on demand:

```sh
node repro/save-load.mjs --server http://127.0.0.1:<yours> --port <cdp> --out <dir>
```

It uses two isolated Chrome profiles on `<cdp>` and `<cdp>+1`, exercises the
actual Save/Load buttons, and compares the recipe and rendered pixels after
loading and refreshing. It is outside the fast unit checks.

Two checks protect what a map keeps (a map holds its whole look; owner,
2026-11-19):

```sh
node repro/map-snapshot.mjs --server http://127.0.0.1:<yours> --port <cdp>
node repro/look.mjs --server http://127.0.0.1:<yours> --port <cdp>
```

`map-snapshot.mjs` retunes parts of Green's data and checks that a saved map
keeps its save and pixels while a new map changes. It edits `materials/*.json`
in the worktree the server serves and restores them; if it is killed, run
`git checkout materials/`. `look.mjs` covers Apply look, New map with this
look and the fork, each against a reload of the saved map.

## Optional retail reproductions

The following workflow is retained for a future return to retail matching.
It is not part of routine checks and does not gate realism work.

Rebuild a 1024-px window of a retail map with the editor's brushes, then put
the two side by side. The scene files are stroke lists, so they are ours;
the retail crops stay outside git.

1. Export the world's retail maps once (planet names as the OTA spells
   them: `Green Planet`, `Red Planet`, `Archipelago`, `Lunar`, `Lava`,
   `Desert`, `Crystal`, `Ice`):

   This uses the retail map exporter from the parent Nanolathe project's
   tools (not in this repository), writing to `$R/retail-<world>`.

2. Cut a window, or take a section:

   ```
   python repro/retail_crop.py map <export>/<map-dir> <x> <y> <dir>
   python repro/retail_crop.py section <art.png> <heights.png> <dir>
   ```

   `relief.png` shows the heights above sea in world coordinates (contours
   every 8 units, heavy every 32, white shoreline, grid labels every 128 px).
   Strokes are placed in the same coordinates; the editor's sea is 0 and its
   dry base is the world's `baseHeight` (24 by default, 8 for Archipelago).

3. Write `scenes/<world>.json`:

   ```
   {"biome": "green", "source": {"map": "great divide", "x": 160, "y": 1504},
    "ground": true, "query": "",
    "strokes": [["landform", [[0,700],[400,700],[960,680]], {"card": {"diameter": 240, "heightReference": 1, "elevation": 114}, "curve": {"form": "lfMountain"}}]]}
   ```

   Each stroke is `[kind, points, options]`; `options.card` overrides brush
   card values in card units (diameter, amount, roughness, softness, cracks
   and the shape options such as elevation, combine, ejecta or
   iceFacetSize), starting from the world's defaults (a landform starts as the
   Plateau button's preset, so pin every setting the scene depends on).
   Plateaus, ridges, ramps and water are landforms; `options.curve` carries
   a landform's section. `query`
   adds URL knobs, and `ground: false` leaves out the undulation node.

4. Render and compare:

   ```
   node repro/render.mjs repro/scenes/<world>.json <dir>
   python repro/pair.py <dir>
   ```

   `render.mjs` runs the editor's engine under Node on Dawn
   (`headless.mjs`: no server, no browser, about a second a scene); it
   needs Dawn's Node binding, npm's `webgpu`, installed outside the
   repository (`TERRAFORM_WEBGPU` names its `node_modules`; see `headless.mjs` for
   the default). The
   pixels and heights are the page's: `--chrome --server <yours> --port
   <cdp>` renders the same scene in headless Chrome and writes the same
   bytes. `--chrome` needs `--server`: no script that runs under Node by
   default falls back to a server of its own.

   The same runner carries the other checks that need only the engine:
   `regional.mjs`, `shapecheck.mjs`, `export-bytes.mjs` (the page's
   WebAssembly exporter in a Node context, `export-node.mjs`, against the
   native one), `measure/shape_controls.mjs`, `measure/world_controls.mjs`
   (the page's knob path, `sculpt-knobs.js`), `measure/tilecount.mjs` and
   `measure/geology_controls.mjs`. Each takes `--chrome` for the page.
   `export-bytes.mjs` and `tilecount.mjs` play the scripted layouts of
   `layouts.mjs`; placed features (`--features`) need `--chrome`, since the
   page paints deposits and vents into the art with a 2D canvas.

   `pair.png` is retail | ours at full size; `layout.png` compares the height
   reliefs, to check the strokes follow the retail layout before judging
   materials.

5. For an explicit before/after investigation, render the selected scenes
   with `render.mjs` and compare the output directories with
   `python repro/compare.py <before> <after> [--worlds green,lava]`.
   `all.sh` remains the retail crop/sheet workflow; no check group invokes it.

6. Compare a world with retail: `repro/retail.sh <world> [--query
   'key=v&key=v'] [--base <an earlier run>]` renders only that world's
   windows (`all.sh` with `REPRO_SCENES`), measures them with `stats.py`,
   and prints one shape and one look score per window (`retail_gap.py`:
   the gap to the window's own retail crop in units of the world's retail
   family band). `retail_knobs.mjs <world>` lists the World rows a query can
   set, and `retail_sources.py` the retail maps and map editor sections on
   this machine. docs/RETAIL_ROUND.md is the round these serve.

## Demo scenes

`demo/` holds scenes for features that have no retail window: cross-section
profiles (`profile-*`), painted masks and local style (`masks-*`), ridges and
spurs (`ridge-*`), fissures (`fissure-*`), Ice facets, sand ripples, bedded
mesas, lean and facing, and per-feature overrides. Render one at a time with
`render.mjs` (`all.sh` only runs `scenes/`). Strokes set shape options in
`options.card`, in the units of their sliders. A paint stroke is
`["paint", points, {"card": {"paintChannel": n}}]`: 1 rock, 2 snow or ice,
3 wet ground, 4 moss, 5 denser and 6 sparser scatter, 7 erases all masks and
style, and 8-15 raise or lower relief, cracks, banding and face rock.
