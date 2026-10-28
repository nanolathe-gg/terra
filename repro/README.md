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
`-lake` (and `-lake-red`, `-shallow`), `-desert-apron` and `-lip`. They are
rendered one at a time with `render.mjs` (`all.sh` only runs `scenes/`), and
set the new shape options in `options.card` in the units of their sliders
(`faceCurve` -100..100, shares as percent, widths in px).
