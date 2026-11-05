# Artist workspace: external review brief

Status: ready for review on a local prototype branch; **not approved to land**.
No push, pull request, or merge to main is part of this handoff.

- Branch: `prototype/artist-workspace`
- Worktree: `/Users/daniel/src/terraform-wt-artist-workspace`
- Preview: **http://127.0.0.1:8921/sculpt** in Chrome on this Mac
- Captured main baseline: `e3985e68`, merged into this branch as `9cf89d6e`
- Implementation commits: `392d2fc6` (workspace), `d16fd68` (animation),
  `9ef300e` (interaction fixes)
- Validation helpers: `6e3184a` (inactive-tab coverage), `e82d79f`
  (equal-viewport benchmark)
- Review the UI-only change with
  `git diff e3985e68...prototype/artist-workspace`.
  Main advanced during this review; this brief's comparisons refer to the
  captured baseline, not an assertion that the branch tracks the latest main.

## Problem and resulting behavior

The artist's map and shape curves now have the main workspace. All 21 tools
are one click away in an 88 px icon rail, with a navigator below the rail and
two wide curves beside it. The 168 px bottom dock stops at the full-height
right inspector. Curve boxes are 104 px tall, including borders.

Tool, World, Map and Shapes tabs reuse the existing inspector. Export and
Settings open their existing panels from the top bar. Seed and reroll share
one row; per-shape seed variation defaults to on and lives in Settings.

Numeric controls combine label, fill, value and text entry:

- Drag to adjust; Shift makes subsequent movement finer without a value jump.
- Click to type; Enter commits, Escape cancels, and Tab commits and advances.
- Arrow keys, Page Up/Down, Home and End adjust without nudging a selected shape.
- Disabled controls stay disabled and show the prerequisite that enables them.
- Confirming an unchanged value leaves weathering and export ready.

The curve editors retain mouse editing and omit per-point numeric fields.
The top bar exposes map weathering, tile grid, zoom in/out, 1x and Fit. The
grid marks 16 px height cells, with heavier 128 px lines; it is a flat
coordinate overlay and never enters exported art. Focus mode hides the dock
as well as the side panels.

This is the existing `/sculpt` editor, GPU pipeline, recipe format, undo stack
and export. There is no alternate terrain renderer or new dependency.

## Hover examples

There are rendered examples for 14 terrain tools and 13 shape controls.
Controls animate through intermediate values at approximately 10% intervals,
then reverse through those frames. Integer controls use every valid count.
Each frame lasts 160 ms, with 480 ms pauses at the endpoints. Reduced-motion
mode shows a static endpoint pair.

Measured: 136 control frames, stored as 13 PNG sprite atlases, plus 14 tool
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

## Validation

Measured against the captured baseline:

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
- **Release performance:** profile the slower release-to-final samples above
  and resolve or explain the difference before landing.
- **Touch and stylus:** tablet-width layout was tested in desktop Chrome.
  Physical tablet pointer and pen behavior still need hands-on review.
- **Help coverage:** extend the representative examples and improve the
  non-terrain illustrations before calling the help library complete.
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
node repro/perf.mjs map4 --scene repro/scenes/green-modern-1.json \
  --server http://127.0.0.1:8921 --port 9921 --no-export --viewport 1000x800 \
  --out /private/tmp/nanolathe-map-editor/agent-artist-workspace/perf-repeat
```

Use the dedicated ports and external output directories listed in the logs
when repeating the longer scene, smoke, control and performance checks. Use
a fresh output directory for each audit run. Repeat baseline timing on a
separate server at the captured commit, alternating with the prototype.
