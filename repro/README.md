# Reproductions and checks

The current editor is served by the Go application. Start an isolated server with
`ASSETS_ROOT=<prepared-assets> PORT=8801 ./run.sh --prepared` (which builds both WASM programs and the helpers).
Use a separate assets root, server port, Chrome debugging port, and output directory
for each worktree. The browser tests use headless Chrome with WebGPU; they do not
start or stop another worktree's server. Run commands from the repository root.

```sh
go test ./...
node repro/render.mjs repro/scenes/green-1.json /tmp/terraform-green --server http://127.0.0.1:8801 --port 9450
node repro/regional.mjs repro/scenes/green-1.json --server http://127.0.0.1:8801 --port 9450
node repro/smoke.mjs --server http://127.0.0.1:8801 --port 9450
node repro/smoke.mjs --server http://127.0.0.1:8801 --port 9450 --page8
node repro/curveedit.mjs --server http://127.0.0.1:8801 --port 9450 --out /tmp/terraform-curves
node repro/shapecheck.mjs repro/scenes/green-1.json --server http://127.0.0.1:8801 --port 9450 --out /tmp/terraform-shapes
node repro/zoom.mjs repro/scenes/green-1.json --server http://127.0.0.1:8801 --port 9450
node measure/shape_controls.mjs --server http://127.0.0.1:8801 --port 9450 --out /tmp/terraform-shape-controls
node measure/world_controls.mjs --server http://127.0.0.1:8801 --port 9450 --out /tmp/terraform-world-controls
```

`measure/section_check.mjs` compares the authored GPU height field with the Go
curve model; `measure/swatch.mjs` uses the Go material model. The zoom test
checks split tiles, restored 1x pixels, idle stability, and replay; it does not
currently exercise allocator refusal or budget fallback. `measure/geology_controls.mjs` measures class-specific impact using current Go
world configuration and the recorded neutral and per-world baseline values.
Historical audit and interaction reports describe past evidence.

## Retail scenes

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
    "strokes": [["mountain", [[0,700],[400,700],[960,680]], {"card": {"diameter": 240, "amount": 90}}]]}
   ```

   Each stroke is `[kind, points, options]`; `options.card` overrides brush
   card values in card units (diameter, amount, roughness, softness,
   bankWidth, beachFlatness, shelves, cracks and the shape options such as
   craterlets or crystalSize), starting from the world's defaults. `query`
   adds URL knobs, and `ground: false` leaves out the undulation node.

4. Render and compare:

   ```
   node repro/render.mjs repro/scenes/<world>.json <dir> --server http://127.0.0.1:8801 --port 9450
   python repro/pair.py <dir>
   ```

   `pair.png` is retail | ours at full size; `layout.png` compares the height
   reliefs, to check the strokes follow the retail layout before judging
   materials.

`demo/` holds scenes for tools that have no retail crop (the cross-section
control, card C1): `profile-plateau`, `-escarpment`, `-hill-mountain`,
`-terraced-dome`, `-lake` (and `-lake-red`, `-lake-terraced`, `-shallow`), `-desert-apron` and `-lip`. They are
rendered one at a time with `render.mjs` (`all.sh` only runs `scenes/`), and
set the new shape options in `options.card` in the units of their sliders
(`faceCurve` -100..100, shares as percent, widths in px).

`demo/masks-*.json` (card C5, painted masks): `masks-green` (rock patches on a hill,
moss, a wet band by a lake), `masks-desert` (a rocky mesa through the plateau's
Paint inside option, next to a plain one), `masks-ice` (snow and rock paint, and a
mountain painted snow through its own footprint) and `masks-moon` (a boulder field
painted denser on the left; the World sliders stay at 0, since denser paint supplies
its own stones). A paint stroke is `["paint", points, {"card": {"paintChannel": n, ...}}]`
with `paintChannel` 1 rock, 2 snow or ice, 3 wet ground, 4 moss, 5 denser scatter,
6 sparser scatter, 7 erase all masks; a landform paints its own footprint with
`maskChannel` (0 off, 1..6 as above) and `maskAmount` (percent).

The line-feature demos (card C4) are `ridge-moon` (a lopsided ring with rim
sectors, an open crescent with a rim gap, a crater with radiating spurs and a
tapering, jagged crescent ridge with spurs), `ridge-red` (branching rugged
mountain ridges) and `ridge-lava` (low winding hill ridges and a radiating
lump); their options are Spurs, Crest irregularity, Crest width and height
variation, Crest taper, Rim sectors and Rim gaps.

Local style (card C5 stage 2): `paintChannel` 8/9 relief stronger/weaker, 10/11
cracks more/fewer, 12/13 banding more/less, 14/15 face rock more/less (Strength
is how far); a landform sets the same about its own footprint with `styleRelief`,
`styleCracks`, `styleBanding` and `styleFace` (percent, -100..100, 0 none).
`demo/masks-style.json` shows each on a Green hill and a plateau pair.

The fissure demos (card C4 stage 2) are `fissure-desert` (jagged cuts with
branches across a mesa's cap and face), `fissure-ice` (one branching crevasse
through a snow shore), `fissure-green` (cuts across a hill with its own painted
rock) and `fissure-red` (a polygonal fracture network on a low platform; Mode 1).

Variants (card C5 stage 3): a world may offer named presets over its own, listed in
the Go server's variant tables and chosen in the World panel's Variant drop-down. A
scene names one in its `query`: `"query": "variant=evad"` (green: Evad River and
Barrier Reef rounded hills with irregular, broken slopes; ice: `bergs`; desert: `triad`). With no variant a scene
renders the world's own preset exactly; green-1, green-3, ice-2 and desert-2 opt in.

Ice's shore (card E5): a deep stroke in Ice makes frost crystals by default (plate
material 2: needles in parallel runs, straight seams, thinning toward deep water; the
floe shelf of plate material 0 was dropped with the JS shape engine). The berg form of the
Crystals brush (`crystalForm: 2`, with `bergFace`, `bergJitter`, `bergBreak`, `bergRough`,
`bergTilt`, `bergTiltDir`, `bergFlat` and `crystalAlign`) builds ice-2's bergs and
ice-3's box; `variant=bergs` gives the bergs their blue ice.

Ice blocks, frost lines and facets (card G6): the Ice world's raised ground is lit by its blurred height and
snow-capped, its faces carry smooth fibres down the slope and its foot a hatched apron (`iceSoft`, `iceSnow`,
`iceFall`, `iceApron`; ice-3 is the window; the variants `snow`, `crystal` and `bergs` set them to 0). The frost
band carries fine blue hairlines (`iceFrost`). Hills and mountains take an optional **Angular facets** share
(`iceFacets`, 0 off, with `iceFacetSize` px): part of the mountain is tiled into tilted planes fitted to its own
surface, partly buried, in its own material. `demo/ice-facets.json` is the ice-1 mountain with facets 70, size 44.
