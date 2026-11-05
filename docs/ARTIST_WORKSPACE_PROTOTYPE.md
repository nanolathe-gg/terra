# Artist workspace prototype

Branch: `prototype/artist-workspace`. This is for hands-on review, not landing on main.
Baseline: `278f2466`.

Open **http://127.0.0.1:8921/sculpt** in Chrome on this Mac. The prototype uses
the existing `/sculpt` editor, GPU pipeline, recipe format, undo stack and export.

## Layout and interaction

- All 21 tools are directly available in an 88 px icon rail. Touch pointers use
  a wider rail and 44 px buttons.
- The navigator starts at the far left, below the tools. Both curves occupy the
  rest of the bottom dock and stop at the inspector. The inspector extends to
  the bottom. The dock is 168 px tall including its border; curve boxes are
  104 px tall including their borders.
- Tool, World, Map and Shapes tabs share the right inspector. Export and Settings
  open their existing panels from the top bar.
- Seed and reroll share one row. The existing per-shape seed variation setting
  is in Settings and defaults to on. Reroll preserves authored curves and settings.
- Numeric controls combine label, fill and value. Drag to adjust, hold Shift for
  finer changes, click to type, Enter to commit, Escape to cancel. Arrow keys,
  Page Up/Down, Home and End work without also nudging a selected shape.
- The two curves keep their existing mouse editors. There are no point-height
  input boxes. Section: click to add a point. Along path: double-click to add.
  Drag to move, Shift-click to remove.
- The top bar exposes map weathering, the tile grid, zoom in/out, 1x and Fit.
  The grid marks 16 px height cells in map coordinates, with heavier 128 px lines.
  It is a flat coordinate guide, not a surface-following mesh, and never enters
  exported art. The separate preview-detail preference is in Settings.

## Visual help

Hover or keyboard-focus a tool or numeric control. There are rendered previews
for 14 terrain tools and animated low/high pairs for 13 shape controls, all in
Green Planet with a fixed seed. Reduced-motion mode shows pairs side by side.
Other tool examples use schematic illustrations; remaining controls have text
help. This is representative coverage, not a finished help library.

The 40 generated PNGs live only in the server's assets root. The committed
generator uses authored fixtures and the real editor renderer, with no retail
scene or crop inputs and no separate runtime renderer:

```sh
node repro/ui-previews.mjs --server http://127.0.0.1:8921 --port 9927 \
  --out /private/tmp/nanolathe-map-editor/agent-artist-workspace/ui-previews
```

## Local server

Worktree: `/Users/daniel/src/terraform-wt-artist-workspace`.
Assets: `/private/tmp/nanolathe-map-editor/agent-artist-workspace`.
The assets root links the prepared `features` and `map-catalog.json` from the
existing temporary asset directory. The server PID is recorded in `server.pid`
inside this root. Do not start a second server on an occupied port.

```sh
/Users/daniel/src/terraform/.venv/bin/python sculpt.py --port 8921 \
  --assets-root /private/tmp/nanolathe-map-editor/agent-artist-workspace \
  --prepared --export-tool /private/tmp/nanolathe-map-editor/map-export \
  --feature-tool /private/tmp/nanolathe-map-editor/bin/map-features
```

## Validation

Measured:

- All 30 reproduction PNGs are byte-identical to baseline (SHA-256), with no
  changed pixels in `repro/compare.py --worlds none`.
- Regional replay of `green-modern-1`: zero mismatches across all reported planes.
- All 54 unit tests pass; the world-name gate passes without adding identifiers.
- All 19 drawing tools add and undo correctly in all 9 worlds. All 8 supported
  worlds export; Zhon stays disabled by design. The 8x8 Green smoke check passes.
- Shape-control audit: all 21 measured cases move the terrain, no dead exposed
  controls. Focused Green world audit: 5 enabled world rows, no unexplained zeros
  or console errors. This is not a completed nine-world control sweep.
- `repro/workspace.mjs` exercises actual pointer/keyboard input: drawing, numeric
  scrubbing and one-step undo, typed commit/cancel, keyboard adjustments without
  shape movement, both curve editors, reroll and undo, recipe round trip,
  minimap, zoom, grid, map weathering and loaded hover imagery. No console errors.
- At 1440x900, the map viewport is 1048x628 and the two curve content areas are
  459x102 and 460x102. At 1024x768, the map is 656 px wide and the curves are
  269x102 and 270x102. Navigator left = 0; dock right = inspector left = 744.
- Alternating baseline/prototype performance runs, two of each, report 33.4 ms
  p95 drag frame intervals in both builds. Their native canvas sizes differ.
  A repeat with both viewports fixed at 1000x800 reports pointer-to-picture p95
  of 101.9/102.1 ms before and 104.3/102.7 ms after. Release-to-final-view times
  were 956.8/983.2 ms before and 1307.7/1008.5 ms after; the slower first release
  needs further measurement before landing. Neither comparison logged errors.
  The controlled repeat used a temporary copy of `repro/perf.mjs` with only
  viewport width/height fixed before its load phase; engine instrumentation and
  gestures were unchanged. Results are in `perf/` and `perf-equal/` under the
  assets root. These small samples do not establish performance equivalence.

By eye: the compact inspector shows height and variation settings together at
1440x900, and both tested layouts preserve the shallow dock and a clear map area.
Screenshots and detailed logs are outside the repository in the assets root and
`/private/tmp/artist-*.log`.

## Before considering a landing

- Review the density, tool recognition and curve ergonomics with an artist.
  The 1024x768 layout was checked in desktop Chrome emulation; physical tablet
  touch and stylus behavior still need hands-on review.
- Extend visual-help coverage and improve non-terrain tool illustrations.
- Per-shape material, style and water-appearance overrides are hidden from this
  prototype's inspector. Legacy recipe values and engine support are retained
  so this UI review does not change terrain. Removing those saved values and
  defining the migration is separate unfinished work before landing. Surf and
  the dedicated surface-paint tool remain available.
- Complete the full nine-world control audit and all required landing checks,
  after merging current main into the branch. Nothing has been merged to main.
