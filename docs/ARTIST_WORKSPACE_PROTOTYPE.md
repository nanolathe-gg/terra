# Artist workspace: external review brief

Status: ready for review on a local prototype branch; **not approved to land**.
No push, pull request, or merge to main is part of this handoff.

- Branch: `prototype/artist-workspace`
- Worktree: `/Users/daniel/src/terraform-wt-artist-workspace`
- Preview: **http://127.0.0.1:8921/sculpt** in Chrome on this Mac
- Current captured main: `1f97728c`, merged as `fc77abf8`
- Integration fixes: `bb372d6b` (live Surf updates), `ffd241a1` (hover help)
- Implementation commits: `392d2fc6` (workspace), `d16fd68` (animation),
  `9ef300e` (interaction fixes)
- Validation helpers: `6e3184a` (inactive-tab coverage), `e82d79f`
  (equal-viewport benchmark), `1b8c5301` (variant and color audits)
- Saved-world variant fix: `b8b0f7a7`
- Review the prototype change with
  `git diff 1f97728c...prototype/artist-workspace`.
  Comparisons refer to the captured commits below; main may advance again.

## November 5 World controls and interaction follow-up

The branch also includes main's ground-cover slope-texture correction. World
settings are flat and open by default, with Colors & base pattern first. The
length-curve inspection line now follows a captured pointer drag. Compact
sliders set a value on single click and enter numeric editing on double click;
a pending click commits before Undo or a different control takes focus.

Ground & vegetation now holds Ground detail (including **Ground bumps**, the
existing `plainRelief`) and Vegetation & flowers. The latter keeps Lushness
and Moisture together with three new material-scale controls: Vegetation
cover, Vegetation relief, and Flower density. Cover also scales shrub density.
All three default to 1, the current material preset. Unsupported materials
explain why their controls are disabled. Zero values leave sections open.

Colors & base pattern exposes Flower 1–4 only when the material supplies those
palette entries. The swatches preserve species weights and use the existing
world-color save path. World presets now retain their material variant: importing
a Modern preset while viewing original Green restores Modern and its vegetation.
Older world files without a variant keep their previous loading behavior.
There are 196 world knob IDs (193 preserved plus 3), and four conditional swatches.

Measured:

- All 30 default scene PNGs match the pre-control build `fc77abf8` byte for byte;
  pixel comparison reports zero changes. No new realism claim follows from
  exposing controls at unchanged defaults.
- All 64 unit tests pass, including material-table isolation, neutral defaults,
  color weights, and feature dependencies. The world-name gate passes with no
  new engine identifiers.
- The focused Modern audit covers 11 new/relocated world rows, four flower
  swatches, both light colors and the existing water-color case: no unexplained
  zeros, hidden live effects, leaked settings or console errors. Separate
  vegetation-off and unsupported-material sweeps also pass.
- The workspace pointer regression passes, including click/double-click,
  immediate Undo, captured curve-marker drag, hover ping-pong and tablet layout.
  `repro/ground-cover.mjs` verifies live material rows, dependency restoration,
  zero without collapse, color retention after unrelated edits and reload,
  import from original Green, and color reset. No console errors.
- Modern regional replay reports zero mismatches across all 32 fields.
- All 19 drawing tools add and undo in all nine worlds; all eight exportable
  worlds export. The 8×8 Green check uses five pages and restores its initial
  shape count. All 22 shape-control cases pass.
- A final repeat of all three Modern defaults after folding shrub density
  into Cover also matches the original PNG hashes.
- Two alternating 1000×800 performance pairs against `fc77abf8`: drag-frame
  p95 is 16.7 ms before and 16.7–16.8 ms after; pointer-to-picture p95 is
  67.6–71.3 ms before and 71.0–80.1 ms after; release-to-final is 488.9–993.3 ms
  before and 575.1–653.7 ms after. No censored samples or console errors.
  These noisy pairs do not establish a speedup or equivalence for all workflows.

Nonzero usable-range impact on Modern's three reference windows, measured by
`measure/impact.py` in 16 px blocks of level ground at 1×:

| Control / comparison | Window 1 | Window 2 | Window 3 | Shift noise floor |
| --- | ---: | ---: | ---: | ---: |
| Vegetation cover, 0.25 → 2 | 47.4% | 43.5% | 44.0% | 4.1–5.6% |
| Vegetation relief, 0.25 → 2 | 56.6% | 53.8% | 59.8% | 4.5–5.5% |
| Flower density, 0.25 → 4 | 53.7% | 50.0% | 52.9% | 1.3–3.1% |
| All flower colors, preset → blue | 21.0% | 17.3% | 19.9% | 3.5–4.9% |

Each swatch independently changes 554–2,534 pixels in the first scene. The color
block percentages above are for all four together, not each swatch individually.
A trial separate Shrub density slider changed only 1.2–4.4% of grass-slope blocks,
below its 4.6–8.1% shift floor. It was removed and folded into Vegetation cover.
By eye, the kept controls alter the grass/soil balance, plant surface relief and
flower patches at 1×; the additional swatches fit the existing color rows.

Evidence under the assets root: `out/cover-controls-before`,
`out/cover-controls-after`, `cover-controls-complete`, `cover-controls-gated`,
`cover-controls-unsupported`, `cover-ui-final`, `cover-workspace`, `cover-impact`, `cover-impact-final`, `cover-shape-controls`, `cover-smoke`, and `cover-perf`. Logs are `/private/tmp/artist-cover-*.log`.
The review and landing limitations below still apply.

## November 5 integration with main

The branch includes main's revised hill and mountain defaults, Talus runout,
Surf beaches, Stain, rock lichen, river point bars, flowers and GPU pipeline
specialization. These use the existing tools and world controls.

One missing connection was fixed: changing the rock column, bed tilt or tilt
direction left existing Surf beach heights stale until a fresh replay. These
edits now replay the shape pass when a visible beach uses the column. Column
contrast follows the same dependency. Undo and the recipe format are unchanged.

Measured against `1325313b`:

- All 30 scene PNGs match SHA-256; pixel comparison reports zero changes.
  All scene replays report mismatch 0 and no console errors.
- All 60 unit tests and the world-name gate pass.
- The new `repro/surf-column.mjs` samples 59,175 authored heights. Hardness,
  tilt and direction edits change the live beach by maxima of 6.91, 6.88 and
  6.84 height units, respectively, and match a fresh replay exactly. Column
  undo, redo and recipe reload also match exactly. Before the fix, hardness
  and tilt edits had no live effect and left differences up to 6.91 units.
  Repeating the same regression with weathering enabled also passes.
- Surf regional replay has zero mismatches across all 32 fields.
- All 19 drawing tools add and undo in all nine worlds; all eight supported
  worlds export. The 8x8 Green test uses five pages and returns to its original
  shape count after undo.
- The workspace interaction regression passes, including hover reversal,
  reduced motion, control gating and 1024x768 layout. A focused browser check
  confirms the new hill/mountain heights, Surf access, Stain gating, and compact
  editing/help for Stain, vegetation tint and Lushness. No console errors.
- The shape audit exercises all 22 cases, including Surf; mean height changes
  range from 0.18 to 27.68 units. These are not percentages or proof of the 5%
  artistic-impact target. The full world-control audit was not repeated after
  this merge; the older findings below remain review items.
- Two alternating equal-viewport (1000x800) performance pairs on
  `green-modern-1`: drag-frame p95 is 16.7–16.8 ms on both builds;
  pointer-to-picture p95 is 67.6–68.3 ms on main and 69.1–69.2 ms here;
  release-to-final is 487.0–520.1 ms on main and 481.8–530.2 ms here.
  All runs exit 0 with no console errors. One of 70 pointer samples is censored
  in the second prototype run. The earlier large release slowdown did not recur;
  two pairs do not establish performance equivalence across workflows.

By eye: refreshed hill and mountain examples show their different silhouettes;
the 11-frame Surf sequence progresses through the new beach behavior. The
tablet-width layout keeps the navigator at the far left and curves clear of
the inspector. The render guard is unchanged relative to main, so this merge
makes no additional terrain-realism claim.

Current evidence under the assets root: `out/integration-main`,
`out/integration-after`, `integration-ui`, `integration-surf-column-fixed`,
`integration-surf-weather`, `integration-controls-open`, `integration-smoke`,
`integration-shape-controls`, and `integration-perf`. Detailed logs are
`/private/tmp/artist-integration-*.log`.

## Problem and resulting behavior

The artist's map and shape curves now have the main workspace. All 21 tools
are one click away in an 88 px icon rail, with a navigator below the rail and
two wide curves beside it. The 168 px bottom dock stops at the full-height
right inspector. Curve boxes are 104 px tall, including borders.

Tool, World, Map and Shapes tabs reuse the existing inspector. Export and
Settings open their existing panels from the top bar. Seed and reroll share
one row; per-shape seed variation defaults to on and lives in Settings.

The World tab starts with Colors & base pattern, with the ground-pattern
picker above the material colors. The five flat knob sections follow:
Ground & vegetation, Rock & cliffs, Water & shores, Materials & texture, and
Lighting. All World sections open by default for scrolling, including Surface
detail, the rock column and preset management. Section headers still collapse
manually. Related settings stay together; there is no separate Common section.
Resetting strokes lives with preset management. Short labels retain their
explanations in hover help.

Measured in the layout pass, before adding vegetation controls: all 193 knob IDs remained, and the nine formerly Common settings are
back in their topic sections. All nine visible World sections start open. At
1024x768 the ground-pattern picker is visible at y=276–307 px. Its selection
survives the existing reload behavior, and manual collapse survives search.
The focused control audit passes all nine relocated world rows with no
unexplained zero effects or console errors. All 60 unit tests pass. Evidence
is in `world-open-fixed` and `world-open-controls-fixed` under the assets root.

The preceding flattening pass verified the 193-setting inventory in all nine
worlds, passed Green's full 333-row impact sweep and the 22-case shape audit,
and checked desktop/tablet layouts by eye. Those results are in `world-flat-*`;
the earlier impact findings in other worlds remain open below.

Numeric controls combine label, fill, value and text entry:

- Drag to adjust; Shift makes subsequent movement finer without a value jump.
- Click a position on the bar to set its value; double-click to type.
  Enter commits, Escape cancels, and Tab commits and advances. A 300 ms
  single-click delay distinguishes text entry; clicking elsewhere flushes the
  pending change before selection or undo can change its target.
- Arrow keys, Page Up/Down, Home and End adjust without nudging a selected shape.
- Disabled controls stay disabled and show the prerequisite that enables them.
- Confirming an unchanged value leaves weathering and export ready.
- Setting an effect to zero or switching it off keeps its section open;
  the section header controls manual collapse. Enabling an effect opens its
  settings. Measured in the browser: zero and off both preserve `open=true`,
  manual collapse sets `open=false`, and the workspace checks and all 60 unit
  tests pass after this refinement.

Measured in `interaction-handoff/workspace.json`: a click sets the indicated
value and one undo restores it; double-click opens text entry without changing
the value first. Immediate Undo consumes a pending click with no later edit.
Drag, Shift, keyboard adjustment, typed commit/cancel, no-op and Tab checks pass
with no browser console errors.

The curve editors retain mouse editing and omit per-point numeric fields.
Click or drag away from knots in Length vs. height to move the selected
section marker continuously. Knot dragging still edits heights. Measured with
pointer input: inspection follows the pointer to 80% of the path, clamps to
the endpoint outside the canvas, stops on release, and leaves all shape data
unchanged (`interaction-handoff/workspace.json`).
The top bar exposes map weathering, tile grid, zoom in/out, 1x and Fit. The
grid marks 16 px height cells, with heavier 128 px lines; it is a flat
coordinate overlay and never enters exported art. Focus mode hides the dock
as well as the side panels.

This is the existing `/sculpt` editor, GPU pipeline, recipe format, undo stack
and export. There is no alternate terrain renderer or new dependency.

## Hover examples

There are rendered examples for 14 terrain tools and 14 shape controls.
Controls animate through intermediate values at approximately 10% intervals,
then reverse through those frames. Integer controls use every valid count.
Each frame lasts 160 ms, with 480 ms pauses at the endpoints. Reduced-motion
mode shows a static endpoint pair.

Measured: 147 control frames, stored as 14 PNG sprite atlases, plus 14 tool
PNGs. Every sequence uses one authored shape and seed in Green Planet.
Playback uses these images only while help is visible; it does not render
terrain during hover. A manifest prevents missing-asset requests in a fresh
normal-server checkout. Without generated assets, tool help uses illustrations
and controls keep text help.

Remaining controls have text help; non-terrain tool illustrations are still
schematic. This is representative coverage, not a finished help library.
The same illustrative fixtures are shown across worlds and tools, so they
explain a setting rather than predict the currently selected shape exactly.

Generate assets outside Git, using the real renderer:

```sh
node repro/ui-previews.mjs --server http://127.0.0.1:8921 --port 9927 \
  --out /private/tmp/nanolathe-map-editor/agent-artist-workspace/ui-previews
```

The generator uses authored fixtures, not retail scenes or crops. Its output
and all review images stay in the temporary assets root.

## Review route

1. Draw a hill, plateau and ramp. Check tool recognition and one-click access.
2. Edit both curves; confirm that their width and shallow height feel useful.
3. Scrub, type and keyboard-adjust height and variation. Toggle Shift mid-drag.
4. Reroll the seed and undo it; verify that curves and settings survive.
5. Hover a tool and Brush diameter or Gullies. Watch the intermediate values,
   reversal and endpoint pauses; repeat with reduced motion enabled.
6. Use the navigator, zoom, grid and weathering, then enter and exit Focus.
7. Find a gated World setting, read its reason, and enable its prerequisite.
8. Save, reload and export a map. Review at desktop and large-tablet widths.

Review attention should go to compact-control event handling in
`sculpt-workspace.js`, tooltip lifecycle in `sculpt-help.js`, the disabled
control selector in `sculpt-ui.js`, and curve/grid integration in
`sculpt.js` and `sculpt-canvas.js`.

## Earlier review evidence (`e3985e68`)

The following records the original review before the November 5 merge.
Current integration measurements are above; the older full control audit is
retained to make its outstanding findings visible.

Measured against `e3985e68`:

- All 30 scene PNGs match byte for byte (SHA-256).
  `repro/compare.py --worlds none`: zero changed pixels in every scene.
  Every scene reports replay mismatch 0 and no console errors.
- All 57 unit tests pass. The world-name gate passes with no new identifiers.
- Regional replay of `green-modern-1`: zero mismatches across all 32 planes.
- All 19 drawing tools add and undo in all nine worlds. All eight supported
  worlds export; Zhon remains disabled by design. The 8x8 Green check uses
  five pages, adds two shapes and returns to the original count after undo.
- The focused shape audit measures all 21 cases changing terrain, with mean
  height changes of 3.43–27.68 units and no console errors. These are height
  units, not percentages or proof of the 5% artistic-impact target.
- Browser interaction regression passes with no console errors. It covers
  drawing, numeric drag and one-step undo, typed commit/cancel/no-op, Tab focus,
  Shift during drag, keyboard adjustment, both curve editors, reroll and undo,
  recipe round trip, navigation, grid, weathering, Focus, hover reversal,
  reduced motion, Escape without deselection, and disabled-control gating.
- At 1440x900: map 1048x628; curve interiors 459/460x102.
  At 1024x768: map width 656; curve interiors 269/270x102; no top-bar overflow.
  Navigator left edge is 0; dock right edge and inspector left edge are both 744.

- Full nine-world control audit: 2,992 reported rows, including 1,069 enabled
  world rows, 695 gated rows, 1,139 stroke rows and 10 surface sliders.
  Three supplemental surface checks cover Green, Red and Zhon after fixing
  the inactive-tab coverage gap. No console errors or controls moving while
  reported disabled. The full audit exits 1 for the three findings below.

The full control sweep found no-effect cases for Crystal `crackedStep` and
Desert/Ice `looseSize`. Identical focused audits produce the same metrics on
the captured main build and this branch, including a context-dependent zero
for Crystal `looseSize`. The focused runs exit 1 with no console errors.
These pre-existing failures and the
full-versus-focused discrepancy need investigation; this brief does not waive
the control-impact gate or claim that all landing checks pass.

Performance, measured with `green-modern-1`, two alternating baseline/prototype
pairs at native sizes and two pairs with both map viewports fixed to 1000x800:

| Layout / metric | Captured main | Prototype |
| --- | --- | --- |
| Native drag frame interval p95 | 16.7–16.8 ms | 16.7–16.8 ms |
| Native pointer-to-picture p95 | 327.4–328.7 ms | 327.4–328.4 ms |
| Native release to final picture | 596.9–619.7 ms | 606.3–676.8 ms |
| Equal viewport drag frame interval p95 | 16.7–16.8 ms | 16.7 ms |
| Equal viewport pointer-to-picture p95 | 68.9–69.4 ms | 67.2–68.0 ms |
| Equal viewport release to final picture | 488.8–595.4 ms | 660.3–1049.6 ms |

All eight runs exit 0 without console errors. Drag timing is close in these
samples, but release completion is slower and variable on the prototype. This
is an unresolved performance finding, not a claim of equivalence. The samples
are small and cover canvas dragging, not every inspector interaction. The
committed `repro/perf.mjs --viewport 1000x800` option makes the controlled
comparison repeatable; it records the actual viewport dimensions in its JSON.

By eye: the inspected desktop and tablet-width screenshots retain a clear map
area, a shallow curve dock and a dense inspector. The hover atlas shows gradual
terrain changes. Retail/before/after and layout contact sheets were inspected;
the unchanged renders preserve the baseline's existing visual strengths and
deficiencies. No new terrain realism claim is made.

Evidence root:
`/private/tmp/nanolathe-map-editor/agent-artist-workspace`.

- `out/review-baseline`, `out/review-after`, `out/review-sheets`: scene evidence
- `review-ui/workspace.json`, `review-ui/hover.png`, `review-ui/tablet.png`
- `ui-previews/manifest.json`: rendered example inventory
- `review-world-controls/world-controls.json`, `review-surface-controls/`:
  full audit and supplemental coverage
- `review-baseline-controls/`, `review-focused-controls/`,
  `review-baseline-ice/`, `review-focused-ice/`: paired finding reproductions
- `review-shape-controls/`, `review-smoke/`, `review-perf/`: remaining evidence
- Detailed logs: `/private/tmp/artist-review-*.log`

## Unfinished work and landing requirements

- **Legacy per-shape overrides:** material, style and water-appearance groups
  are hidden from the inspector, but old recipe values and renderer support
  remain. Surf and the dedicated surface-paint tool remain available. Removing
  saved overrides needs an explicit compatibility change and scene review;
  silently retaining invisible overrides is not the finished simplification.
  This must be resolved before landing.
- **Artist review:** assess tool recognition, control density, curve ergonomics
  and whether the illustrative sequences explain the settings clearly.
- **Control-impact findings:** resolve the no-effect controls and audit-context
  discrepancy above before treating the control gate as green. This UI pass
  preserves terrain behavior; it does not strengthen or remove those controls.
- **Release performance:** the older slowdown did not recur in the post-merge
  pairs above. Recheck the final reviewed build before landing; the current
  samples cover canvas dragging, not every inspector interaction.
- **Touch and stylus:** tablet-width layout was tested in desktop Chrome.
  Physical tablet pointer and pen behavior still need hands-on review.
- **Help coverage:** the new vegetation controls have descriptive text help;
  their rendered animations are not yet in the representative library. Extend
  those examples and improve the non-terrain illustrations before calling the
  help library complete.
- **Integration:** merge the then-current main into this branch and repeat all
  required landing checks after review fixes. The branch is intentionally local.

## Local server and repeatable checks

Assets root: `/private/tmp/nanolathe-map-editor/agent-artist-workspace`.
It links the prepared `features` and `map-catalog.json` catalogues.
The prototype server's PID is recorded in `server.pid` in that root.
Do not start a second server on an occupied port.

```sh
/Users/daniel/src/terraform/.venv/bin/python sculpt.py --port 8921 \
  --assets-root /private/tmp/nanolathe-map-editor/agent-artist-workspace \
  --prepared --export-tool /private/tmp/nanolathe-map-editor/map-export \
  --feature-tool /private/tmp/nanolathe-map-editor/bin/map-features

node --test repro/*.test.mjs
sh repro/gate.sh
node repro/workspace.mjs --server http://127.0.0.1:8921 --port 9927 \
  --out /private/tmp/nanolathe-map-editor/agent-artist-workspace/review-ui
node repro/ground-cover.mjs --server http://127.0.0.1:8921 --port 9927 \
  --out /private/tmp/nanolathe-map-editor/agent-artist-workspace/cover-repeat
node repro/surf-column.mjs --server http://127.0.0.1:8921 --port 9926 \
  --out /private/tmp/nanolathe-map-editor/agent-artist-workspace/surf-repeat
node repro/perf.mjs map4 --scene repro/scenes/green-modern-1.json \
  --server http://127.0.0.1:8921 --port 9921 --no-export --viewport 1000x800 \
  --out /private/tmp/nanolathe-map-editor/agent-artist-workspace/perf-repeat
```

Use the dedicated ports and external output directories listed in the logs
when repeating the longer scene, smoke, control and performance checks. Use
a fresh output directory for each audit run. Repeat baseline timing on a
separate server at the captured commit, alternating with the prototype.
