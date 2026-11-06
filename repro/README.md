# Reproductions

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
   and the shape options such as elevation, combine, craterlets or
   crystalSize), starting from the world's defaults (a landform starts as the
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
`WORLD_VARIANTS` (`sculpt.py`) and chosen in the World panel's Variant drop-down. A
scene names one in its `query`: `"query": "variant=evad"` (green: Evad River and
Barrier Reef rounded hills with irregular, broken slopes; ice: `bergs`; desert: `triad`). With no variant a scene
renders the world's own preset exactly; green-1, green-3, ice-2 and desert-2 opt in.

Ice's shore (card E5): the Water button's preset in Ice turns on frost-crystal shore plates (plate
material 2: needles in parallel runs, straight seams, thinning toward deep water; the
floe shelf of plate material 0 was dropped with the JS shape engine). The berg form of the
Crystals brush (`crystalForm: 2`, with `bergFace`, `bergJitter`, `bergBreak`, `bergRough`,
`bergTilt`, `bergTiltDir`, `bergFlat` and `crystalAlign`) builds ice-2's bergs and
ice-3's box; `variant=bergs` gives the bergs their blue ice.

Ice blocks, frost lines and facets (card G6): the Ice world's raised ground is lit by its blurred height and
snow-capped, its faces carry smooth fibres down the slope and its foot a hatched apron (`iceSoft`, `iceSnow`,
`iceFall`, `iceApron`; ice-3 is the window; the variants `snow`, `crystal` and `bergs` set them to 0). The frost
band carries fine blue hairlines (`iceFrost`). A raised landform takes an optional **Angular facets** share
(`iceFacets`, 0 off, with `iceFacetSize` px; not with shore features): part of it is tiled into tilted planes fitted to its own
surface, partly buried, in its own material. `demo/ice-facets.json` is the ice-1 ridge with facets 70, size 44.
