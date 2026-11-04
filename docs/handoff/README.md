# Handoff: retire the specialized terrain tools in favor of Landform

2026-11-04. Started in a cloud session; stopped before any code change so it
can run locally on Metal. **Nothing in the editor has been changed.** This
folder holds the plan, the inventory, and two one-time scripts. Delete the
folder when the work lands.

## The request (owner)

1. Plateau, Hill (rounded ridge), Mountain (peaked ridge), Ramp, Deep water
   and Shallow water are now made with the **Landform** tool. Remove their
   tools and code paths, and re-author everything that uses them with
   landform strokes.
2. Remove **Raise / lower** (`offset`) entirely. The old hidden `lower` kind
   goes with it (it has no button, but it is in `HELP`, and `moon-1` uses it).
3. **Crater and Crystals stay** as they are.
4. Then sweep the codebase and shaders for dead code, and adjust the UI so no
   control is dead.
5. Commit to main and report what changed.

Kept: `landform`, `crater`, `crystal`, `fissure`, `smooth`, `erase`, `sand`,
`grass`, `paint`, and the `ground` node. Removed: `plateau`, `hill`,
`mountain`, `ramp`, `deep`, `shallow`, `offset`, `lower`.

## Measured in the cloud session

- Unit tests on main: **44 pass** (`node --test repro/*.test.mjs`).
- One full `repro/render.mjs` of `green-1` on SwiftShader: **566 s**, zero
  console errors, zero tile mismatch. The Time pass alone took 141 s. At that
  speed the scene, regional and smoke checks would take most of a day, which
  is why this moves to a local machine.
- `prefix.mjs` (below): about **100 s per stroke** on SwiftShader. Locally it
  should take seconds.
- `convert.mjs` dry run on five scenes, with no prefix heights: it runs, and
  `green-1`'s two deep strokes come out the same as the reviewed retail-window
  fit (`diameter 300, wander 40.8, widthVary 26.8`, and `620 / 52.7 / 16.75`).

## Inventory: what uses the retired kinds

Fixtures (stroke counts):

| Set | Retired strokes |
| --- | --- |
| `repro/scenes` (27 maintained) | hill 69, deep 51, shallow 31, plateau 10, mountain 9, offset 9, lower 1 |
| `repro/shape-scenes` (33) | deep 27, hill 24, plateau 19, offset 11, mountain 9, shallow 5, ramp 4, lower 2 |
| `repro/demo` (28) | hill 22, plateau 16, mountain 14, deep 12, shallow 2, offset 2 |
| `repro/comparisons` (62) | hill 38, deep 9, plateau 8, mountain 9, shallow 1, ramp 1 (mostly the `*-dedicated.json` halves) |
| `repro/walls` (9) | plateau 9 |

Code, by file (search the kind names in quotes to find every site):

- **`sculpt.html`**: the tool buttons, and the brush-panel rows that only
  water used: `bank-control`, `beach-control`, `shelves-control`,
  `shallow-mode-control`. Check the "Legacy surface settings" text that
  mentions ramps.
- **`sculpt-ui.js`**: icon paths and colors; the tool grouping (the `Shape`
  list, the variants row with `mountain` / `shallow`, the `Ridge form` and
  `Water action` families); `basicIds`; and the `make(...)` list that moves
  `shelves` / `beach-flatness`.
- **`sculpt.js`** (around 77 sites): `HELP`; the default `tool='plateau'`;
  `TOOL_PRESETS` (retired kinds' entries); `TOOL_FIELDS` (`shelves`,
  `bankWidth`, `beachFlatness`); `BASE_KINDS`; `RIDGE_KEYS` / `ridgeOn`;
  `MASK_SHAPES`; `SHAPE_FIELDS` kinds lists; `amountRange`; `toolDefaults`
  (cracks table, the offset amount); `rememberTool` / `showTool`
  (`shallowMode`); `updateControls` (amount and roughness labels, the fixed
  list, the shelves/bank/beach/shallow-mode/softness/cracks visibility, the
  shallow-passage help text); `hasCoastPass`; `NODE_NAMES`; `strokeParams`;
  `nodeBounds` (reach table, `BASE_KINDS`, `moonLobes`, deep/shallow/offset
  terms); `regionalReadApron`; `regionalDirtyRect` (plateau and ramp point
  reads); `currentStrokeOptions`; `scriptedScene` card keys; the Shift-drag
  height lift (it skips deep/shallow/ramp/erase); the `draw-new` fallback to
  `'plateau'`; `strokeWaterPicks` (its water kinds).
- **`sculpt-gpu-fields.js`**: `KIND`; `MASK_SHAPES`; `BASE_KINDS` and
  `outlineUniforms` (`baseVary`, `moonLobes`); `ridgeOn` / `ridgePieces` (keep
  `spurPieces` and `ridgeRoots`, which landform and crater use); the
  shouldered-hill path in `prepareNode`; the ramp path; water / `naturalWater`
  / `bankScale` / `naturalPlateau`; `facetMode` 2 (mountain `iceFacets`); the
  crack-amount kind list; and the `NODE_FIELDS` uniforms only those paths set.
  The WGSL `Node` struct is generated from `NODE_FIELDS`, so remove a uniform
  from the list and from the shader together.
- **`engine-shape.wgsl`**: `stamp` handles paint 0, erase 1, deep 2, shallow
  3, mountain 4, hill 5. `stampN` handles plateau 6, offset 7, lower 8, sand
  9, grass 10, smooth 11. `stampRamp` is 12. After the change `stamp` keeps
  paint, erase and the crater's spur pieces (see the first gotcha), and
  `stampN` keeps sand, grass and smooth. `stampRamp` goes, and so does the
  ramp's and the plateau's use of `PT` point reads. Craters still read a
  point. Delete each `kind ==` branch that goes, and every helper
  (`outlineShift`, `baseBump`, the shelf/core noise and so on) that is left
  with no caller.
- **`sculpt-shape-presets.js`**: `SECTION_KINDS` becomes `['landform']`.
  `FORMS.hill`, `mountain`, `dome` and `terrace`, `FORM_NAMES`, the
  non-landform branches of `formChoices` and `defaultForm`, `isShouldered`,
  `hillWidths`, and the `deep` / `hill` / `dome` / `mountain` / `lower`
  entries of the variability tables all go. Keep `FORMS.plateau` (SMOOTH):
  `strokeCurve` still gives it to erase, paint, sand, grass and smooth as
  their default curve. Keep the `family` lean and variability for those
  brushes. `cliff` reads softness; for a landform that is its hidden 50.
- **`sculpt-control-schema.js`** (`shapeControlAvailable`): drop the
  plateau/offset/hill/mountain branches, the non-landform `facing` rule and
  `iceFacetSize`.
- **`sculpt.py`**: `KNOB_DEFAULTS` and `WORLD_KNOBS` keys of removed shape
  options (see the controls list). The `measure/*.py` hits for
  `'deep'`/`'shallow'`/`'ramp'` are water-material table names, not tools.
  Leave them.
- **Tests and tools**: `repro/control-schema.test.mjs` (28 sites),
  `knots.test.mjs` (16), `paths.test.mjs` (3), `curveedit.mjs`, `smoke.mjs`
  (the `TOOLS` list, the `['hill','landform']` loop, `--shore`), `perf.mjs`
  (default `--tool hill`; use landform), `zoom.mjs`, `shapecheck.mjs`,
  `measure/world_controls.mjs` (17), `shape_controls.mjs`,
  `section_check.mjs`, `geology_controls.mjs`, `lava_strokes.mjs`,
  `capture/capture.mjs`. Run `repro/gate.sh` too: its identifier list must
  not grow.
- **Docs**: `repro/README.md` (its example scene uses `mountain`), and
  `docs/LANDFORM_RETIREMENT.md` / `LANDFORM_SHORES.md` (record that the
  retirement happened). Leave the historical cards in `BACKLOG.md` and
  `EXPERIMENTS.md` alone.

## Gotchas found

1. **Crater spurs use the mountain path.** `prepareNode` (end of the crater
   branch, about line 452) adds a satellite node with `kind: 'mountain'`,
   `pieces` and `hole`. It is drawn by `stamp` kind 4's ridge-piece path.
   Keep that path as a crater-only internal stamp (rename it, keep the code
   it runs), or craters with spurs break. `moon-*` uses crater spurs, and
   `crestJag` / `crestVary` stay because they shape those spurs.
2. **World presets hang features on the retired kinds** (`WORLD_KNOBS` in
   `sculpt.py`):
   - Ice: `shorePlates 1`, `plateMaterial 2`, `frostNeedles .8`. Every Ice
     water stroke gets plates by default.
   - Lava: `fingers 1`, `shoreLayers 11`, `bankPx 60`, `lavaSpread .7`,
     `layerVary .8`, `fingerSize .65`.
   - Desert: `baseVary 36`, `baseBump 3.5`.
   - Moon: `moonLobes .5`.

   Landform already runs the shared coast pass. `coastSetup` does not gate
   plates by kind, but the plate rows' `SHAPE_FIELDS` kinds leave out
   landform. So a landform does not store `shorePlates`, and on Ice it quietly
   picks up the world default through `nodeShapeParams`. **Add `landform` to
   the `shorePlates` / `plate*` / `frostNeedles` / `plateVary` /
   `crystalShoreSeam` kinds** before converting Ice and Crystal water.
   `moonLobes`, `baseVary` and `baseBump` are outline effects of the retired
   kinds only. Delete them, and if Moon and Desert need the look, give those
   worlds landform presets (wander / Variation size / Height variation).
   `LANDFORM_DEFAULTS` pins `fingers 0` and `shoreLayers 0`, so Lava's
   defaults never reached landforms anyway.
3. **`iceFacets` is mountain-only** (`facetMode` 2; the `facetSnap` pass is
   shared with crater facets). No maintained scene uses it;
   `demo/ice-facets.json` and `shape-scenes/ice-facets.json` do. Decide
   whether to port it (three small edits: the `facetMode` kind check, its
   kinds list, `regionalReadApron`) or delete it. **Owner decision.**
4. **Relative heights.** Hill, mountain, offset and lower add to the ground
   cell by cell, and plateau rises from its start height. Landform targets
   one elevation. Archipelago and Zhon islands are hills drawn over deep
   water, and Desert has plateaus stacked on plateaus, so converting on "the
   plain" is wrong for many strokes. `prefix.mjs` samples the real ground
   before each stroke, and `convert.mjs` turns a ground that varies along a
   path into the landform's along curve.
5. **Sea level.** Maps default to sea 75 here, and fixtures that pin sea 0
   put `sea=0` in their query. `convert.mjs` writes every converted stroke
   with **Height reference: Sea level**, so the scene keeps its shape at any
   sea.
6. **Seeds follow stroke order.** `scriptedScene` seeds stroke *i* with
   `seed + 7919·i`. The converter keeps each stroke at its index. Do not drop
   or insert strokes while converting.
7. **`toolDefaults('landform')` brings presets in.** On Desert it is the mesa
   (6 steps). The converter pins every landform setting explicitly.
8. **Ramp semantics.** A converted ramp becomes Flatten to the higher end,
   with an along curve sampled from both endpoints and Smooth route 100. It no
   longer re-joins its endpoints after earlier edits (the documented
   height-reference gap). There are no ramps in the maintained scenes, only
   in shape-scenes and comparisons. **Owner to accept.**
9. Ramp, deep, shallow, erase and landform hide the Rise slider. After the
   change, the slider applies to crater, crystal, fissure, smooth and the
   cover brushes only.

## Controls that die with the kinds

Remove each from `SHAPE_FIELDS`, the HTML and `strokeParams`, its
`KNOB_DEFAULTS` entry, and its uniform and shader code. Confirm with
`measure/world_controls.mjs` and `shape_controls.mjs` afterwards.

- Water only: Bank width, Beach flatness, Automatic shallows (`shelves`),
  Shallow action (`shallowMode`), Dry bank (`bankPx`).
- Outline and lumps of the retired kinds: `outlineVar` (landform already
  hides it), `widthVar`, `heightVar`, `moonLobes`, `baseVary`, `baseBump`.
- `facePx`: `SECTION_KINDS` only, and landform hides it.
- `faceVariation`: its kinds include `erase`. Check whether erase visibly
  uses it before deleting it.
- Rows landform reaches only through Steps (`landformSteps`): the
  `shoreLayers`, `layerLedge`, `layerRough` and `layerStyle` rows. Remove the
  rows and keep the internal parameters the coast pass reads.
- `iceFacets` and `iceFacetSize`, unless ported (gotcha 3).
- Labels: "Coast freedom", "Shoulder freedom", "Edge freedom" for plateau,
  "Lower by", "Height change".

Kept: crater's `crestJag` / `crestVary`, spurs (landform and crater),
`crestTaper`, lean / facing (landform), steps, the coast fields, the water
looks, the masks and styles (`MASK_SHAPES` becomes crater + landform), cracks,
and softness for crater, erase and the cover brushes.

## Recommended sequence (one commit per idea)

1. **Baseline on main**: `repro/all.sh` into `before/`, then
   `node repro/regional.mjs`, `node repro/smoke.mjs` (and `--page8`), the unit
   tests and `sh repro/gate.sh`.
2. **Sample prefix heights** on main (below). Run them on a clean main
   checkout before anything changes.
3. **Shore plates on landform** (gotcha 2), and decide on `iceFacets`. These
   are small and additive. Render the untouched scenes to confirm they match
   byte for byte.
4. **Re-author the fixtures** with `convert.mjs`:
   - Fold `repro/comparisons/landform-shores/retail-windows/*` (the reviewed
     water fits for Green, Archipelago and Lava) into the maintained scenes:
     use their water strokes and convert the rest.
   - Delete the `*-dedicated.json` comparison halves; they can no longer
     render.
   - Render and judge on the retail sheets across all three windows of each
     world (at most three cycles per world). Commit:
     "Re-author maintained scenes with landform".
5. **Remove the kinds**: UI, JS, GPU entry points, shader branches, Python
   knobs, tests. Commit. Untouched-by-design scenes (crater-, crystal-,
   paint-only windows) must stay byte-identical after this step. Most windows
   changed in step 4.
6. **Dead-code sweep**: uniforms no longer set, WGSL functions with no
   caller, knobs with no reader, CSS for removed controls, `NODE_NAMES` for
   `raster` / `compact` / `flowbake` if nothing creates those any more.
   Commit.
7. All checks again, plus `perf.mjs` alternating (landform on the drag path).
   Merge main, rerun, land.

## The scripts

Both run against a checkout of **main before the retirement**, served on its
own port. Both use the Chrome path `render.mjs` uses.

```bash
python sculpt.py --port <server> --assets-root $R/agent-<card> --prepared &
```

```bash
node docs/handoff/prefix.mjs http://127.0.0.1:<server> <cdp> $R/agent-<card>/prefix.json repro/scenes/*.json repro/shape-scenes/*.json repro/demo/*.json repro/walls/*.json repro/comparisons/landform/*.json repro/comparisons/landform-shores/*.json
```

```bash
node docs/handoff/convert.mjs . http://127.0.0.1:<server> $R/agent-<card>/prefix.json repro/scenes/*.json repro/shape-scenes/*.json repro/demo/*.json repro/walls/*.json
```

- `prefix.mjs` is resumable: scenes already in the output file are skipped.
  It disables weathering and plays the scene up to each relative stroke on a
  2x2 map, so points beyond 2048 px clamp.
- `convert.mjs` rewrites the files in place and prints a line per file. With
  `-` instead of a prefix file it assumes the plain, which is wrong for
  islands and stacked plateaus. Its output keeps one stroke per line, but it
  normalizes spacing, so most converted files will show whole-file diffs.

The fit `convert.mjs` uses. The water rows reproduce the reviewed
retail-window fixtures; the land rows follow the matched pairs in
`repro/comparisons/landform`. All of them are first fits to judge on the
retail sheets, not a measured match:

| Old kind | Landform |
| --- | --- |
| deep | Sea level, −55, Cut to. Diameter × bank scale `2^((bankWidth−.5)·1.3)`. Smoothstep over 90% of the half width. Wander `.34·rough·D`, width variation `67·rough`%, Variation size 210. Shore layers become Steps follow Shoreline (Circular for layer style 1) with their count, ledge and irregularity. Fingers, plates and water looks are copied. |
| shallow | Sea level, −7. Flatten to (area) or Raise to (passage). Same bank scale and section. Wander `.08·rough·D`, no width variation. |
| hill | Raise to the sampled ground + Rise. A shouldered hill keeps its knots (face `[0,0],[⅓,.02],[⅔,.34],[1,1]`, smooth back) with lean = back/face from softness. A ridge-option hill uses `lfHill`. Wander `.34·rough·D`, width variation `57·rough`%, height variation `.6·rough·Rise`. |
| mountain | As hill, with the mountain power-law knots at its softness. Wander `.08·rough·D`, height variation `.1·rough·Rise`. |
| plateau | Raise to the start height + Rise, with the approved `lfPlateau` front and back, or `mesa` where the stroke had it. Wander `90·(D/300)·(rough/.4)`, width variation `35·rough/.4`%, Variation size 140, foot 115, middle 145. Steps are copied. |
| offset / lower | As plateau (lower: `lfHill`), Raise to or Cut to by the sign. A ground that varies along the path becomes the along curve. |
| ramp | Flatten to the higher endpoint, along curve between the endpoint shares, Smooth route 100, a plateau-like section. |

Spurs, crest taper, masks and styles, cracks and the coast fields are
copied. Each stroke keeps its points, options and index.

## Open decisions for the owner

1. `iceFacets`: port it to landform, or delete it.
2. Accept the new ramp semantics (gotcha 8).
3. Whether Moon and Desert need landform presets to keep their lobed and
   ragged outlines once `moonLobes` / `baseVary` are gone.
4. Whether the Landform tool should offer water and ramp starting presets.
   This needs a new control, which is outside this task, so it is only a
   proposal.
