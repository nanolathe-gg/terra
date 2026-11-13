# Checks and reproductions

For everyday development, run `repro/check.sh` (fast Node unit tests and the
world-name gate), or a relevant test directly, such as
`node --test repro/paths.test.mjs`. The default needs no Python, Go, GPU,
browser, generated configs or retail assets. Integration tests have explicit
`.config`, `.build`, `.export`, `.features`, `.assets` or `.gpu` filename suffixes and run on demand:

```sh
repro/check.sh quick --test repro/paths.test.mjs
repro/check.sh browser --server http://127.0.0.1:<yours> --port <cdp> --worlds green
repro/check.sh engine --scene repro/shape-scenes/green-landform.json
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

## Optional retail reproductions

The following workflow is retained for a future return to retail matching.
It is not part of routine checks and does not gate realism work.

Rebuild a 1024-px window of a retail map with the editor's brushes, then put
the two side by side. The scene files are stroke lists, so they are ours;
the retail crops stay outside git.

1. Export the world's retail maps once (planet names as the OTA spells
   them: `Green Planet`, `Red Planet`, `Archipelago`, `Lunar`, `Lava`,
   `Desert`, `Crystal`, `Ice`):

   ```
   cd /private/tmp/nanolathe-neural-campaign-corpus
   go run ./tools/neural-terrain/export -planet Lunar -include-campaign -out /private/tmp/nanolathe-map-editor/retail-moon
   ```

2. Cut a window, or take a section (Zhon has no retail maps; its four
   1024-px "low savannah rivers" sections stand in):

   ```
   python repro/retail_crop.py map <export>/<map-dir> <x> <y> <dir>
   python repro/retail_crop.py section <art.png> <heights.png> <dir>
   ```

   `relief.png` shows the heights above sea in world coordinates (contours
   every 8 units, heavy every 32, white shoreline, grid labels every 128 px).
   Strokes are placed in the same coordinates; the editor's sea is 0 and its
   dry base is the world's `baseHeight` (24, or 8 for Archipelago and Zhon).

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
   repository (`TERRAFORM_WEBGPU` names its `node_modules`, default
   `/private/tmp/nanolathe-map-editor/node-webgpu/node_modules`). The
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

`demo/` holds scenes for tools that have no retail crop (the cross-section
control, card C1): `profile-plateau`, `-escarpment`, `-hill-mountain`,
`-terraced-dome`, `-lake` (and `-lake-red`, `-lake-terraced`, `-shallow`), `-desert-apron` and `-lip`. They are
rendered one at a time with `render.mjs` (`all.sh` only runs `scenes/`), and
set the new shape options in `options.card` in the units of their sliders
(`faceCurve` -100..100, shares as percent, widths in px).

`demo/masks-*.json` (card C5, painted masks): `masks-green` (rock patches on a hill,
moss, a wet band by a lake), `masks-ice` (snow and rock paint) and `masks-moon` (a
boulder field painted denser on the left; the World sliders stay at 0, since denser
paint supplies its own stones). `masks-desert` (two mesas and a hill) is the
landform-only companion. A paint stroke is
`["paint", points, {"card": {"paintChannel": n, ...}}]` with `paintChannel` 1 rock,
2 snow or ice, 3 wet ground, 4 moss, 5 denser scatter and 6 sparser scatter; 7
erases all masks and style.

The line-feature demos (card C4) are `ridge-moon` (Crater-button craters, one
with radiating spurs, and a tapering crescent ridge with spurs), `ridge-red`
(branching rugged mountain ridges) and `ridge-lava` (low winding hill ridges
and a radiating lump); their options are Spurs and Crest taper. (The crater's
rim sectors, rim gaps and crest variation were retired with the Crater tool on
November 6, docs/LANDFORM_RETIREMENT.md.)

Local style (card C5 stage 2): `paintChannel` 8/9 relief stronger/weaker, 10/11
cracks more/fewer, 12/13 banding more/less, 14/15 face rock more/less (Strength
is how far). A landform keeps one of them for its own footprint, Local vegetation
(`styleVegetation`, percent, -100..100, 0 none). `demo/masks-style.json` shows the
paint channels on a Green hill and a plateau pair.

The fissure demos (card C4 stage 2) are `fissure-desert` (jagged cuts with
branches across a mesa's cap and face), `fissure-ice` (one branching crevasse
through a snow shore), `fissure-green` (cuts across a hill with its own painted
rock) and `fissure-red` (a polygonal fracture network on a low platform; Mode 1).

Variants (card C5 stage 3): a world may offer named presets over its own, listed in
`world.variants` in `materials/<world>.json` and chosen in the World panel's Variant drop-down. A
scene names one in its `query`: `"query": "variant=evad"` (green: Evad River and
Barrier Reef rounded hills with irregular, broken slopes; ice: `bergs`; desert: `triad`). With no variant a scene
renders the world's own preset exactly; green-1, green-3, ice-2 and desert-2 opt in.

Ice's shore (card E5): the Water button's preset in Ice turns on frost-crystal shore plates (plate
material 2: needles in parallel runs, straight seams, thinning toward deep water; the
floe shelf of plate material 0 was dropped with the JS shape engine). ice-2's bergs and ice-3's box
are landforms with Facets (Facet shape Prisms, one prism a click, Surface Rock, Face roughness,
Corner cuts and Outline jitter; ice-2's flat top tilts with its section below Level tops 100), as
the Crystals button draws them in Ice; `variant=bergs` gives the bergs their blue ice.

Ice blocks, frost lines and facets (card G6): the Ice world's raised ground is lit by its blurred height and
snow-capped, its faces carry smooth fibres down the slope and its foot a hatched apron (`iceSoft`, `iceSnow`,
`iceFall`, `iceApron`; ice-3 is the window; the variants `snow`, `crystal` and `bergs` set them to 0). The frost
band carries fine blue hairlines (`iceFrost`). A landform takes optional **Facets** (`iceFacets`, 0 off, with
`iceFacetSize` px, `facetForm` angular facets, stepped columns or prisms, `crystalStep` and `facetSurface`; not with shore
features): at Facet shape Angular facets and Surface Rock part of it is tiled into tilted planes fitted to its own
surface, partly buried, in its own material. `demo/ice-facets.json` is the ice-1 ridge with facets 70, size 44.
