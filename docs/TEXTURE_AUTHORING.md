# Procedural ground and water authoring

The editor uses one numeric material recipe for base ground, painted ground,
landform ground, and water. Built-in world assignments remain unchanged.

## Artist workflow

1. Open **World → Ground → Pattern → Open material editor**. The separate
   dialog has a 512-pixel preview and Noise, Phase, Filter, Color & blend,
   Bump & finish, and Palette tabs. Choose a starter from **Add preset**.
   The four new starters are Rust mottling, Cloudy green, Blue streaked water,
   and Violet rippled water. Duplicate a starter to make a new material.
2. Edit the recipe and its live sample. Start with pattern size, broad mottling,
   distortion, and colors; then tune fine grain and marks. Sliders use the
   editor's shared scrub controls: drag, Shift-drag for fine adjustment, arrow
   keys, and double-click or Enter to type a value. Pattern blend mixes
   the procedural pigment with the existing relief-family colors. The sample
   crosses the repeat seam and reports distinct 32-pixel tiles. **Done** or
   Escape closes the dialog; edits apply live. The dialog uses the map's own
   Undo and Redo, with no separate save or history.
3. Choose the material as the world's ground, use it in the ground paint brush,
   or select it on a landform. For water, choose it under **Water & shores**;
   **Edit material** opens the same recipe editor. Water keeps the world's depth,
   shore, absorption, and lighting controls.
4. Save the map normally. Recipes and assignments participate in undo/redo,
   reload, embedded world settings, share saves, and export. The existing world
   duplicate/export workflow carries the recipes into a new world. Recipe
   copy/paste shares its numeric settings without changing assignments.

## What the controls do

- **Noise:** value and gradient noise, linear interpolation, turbulence, cellular
  structure, stretched ripples, crest emphasis, scale, direction, and secondary
  detail. Noise octaves add progressively broader layers at twice the amplitude;
  fractional octaves fade the next layer in continuously.
- **Phase:** warp the pattern, layer phase octaves, balance displacement between
  axes, and mix a separately scaled broad mottle. Axis balance −1 affects X,
  zero affects both axes, and +1 affects Y.
- **Filter:** adjust the value range and power, invert values, mix in a hard clip,
  or apply sine shaping with an editable frequency. The filtered result feeds
  color and pattern bump.
- **Pattern colors:** three continuous RGB stops and their range, balance, and
  softness. These are not snapped to the game's palette while authoring.
- **Fine grain:** independent fine structure and multiplicative color variation.
- **Marks:** scattered spots or noise masks, coverage, spacing, scatter, hardness,
  variation, and concentration in light areas. Blend a mark color or multiply a
  tint into the underlying pigment.
- **Relief:** pattern height, fine relief, and pit depth. Existing bump, plate,
  scratch, pebble, cushion, and ripple families add their relief. Relief changes
  rendered shading, not gameplay heights. Ground finish settings apply when the
  recipe is used as ground; water retains its existing surface model.
- **Palette grain:** a small palette and error diffusion, including a continuous
  blend between Floyd–Steinberg and the lighter three-neighbor distribution.
  Tone response and channel sensitivity control nearest-color selection.
  Palette hex entries snap to the game's palette; a blank list uses the relief
  ramp. Palette grain at zero keeps the continuous pigment.

The four starters carry numbers from the approved ground studies and accepted
water studies (`prototype/ground-calibration`, including Red water review 8 at
`07712345`). They contain no retail pixels, masks, or traced shapes. The shared
GPU implementation and normal world lighting can differ from the offline study
renderers; acceptance of those studies is not a claim of pixel-identical porting.
Final in-editor appearance remains subject to visual review.

## Bryce reference and scope

The organization follows the Noise / Phase / Filter and color/bump workflow
in MetaCreations' [Bryce 4 User Guide, texture chapter](https://www.scribd.com/document/512436170/Bryce4).
That is a 1999 primary source, not verified documentation of every 1997 option.
Its Standard octave mode adds half-frequency, double-amplitude layers; the
new octave controls follow that convention rather than adding finer noise.
The supplied template archive identifies itself as Bryce 7.1, so it is useful
for recipes but does not establish which controls existed in 1997.

This is a Bryce-inspired, periodic 2D material editor. It does not claim exact
Bryce noise algorithms, all 3D mapping modes, or arbitrary routing among three
independent DTE components. Existing base/fine/mark composition remains editable.
The new controls have neutral defaults, preserving existing preset values.

## Implementation

`sculpt-texture-model.js` defines the numeric controls and color validation;
`materials/texture-presets.json` supplies the starter values. Static controls
live in `index.html` and use the existing Ground controller and preview.

`engine-texture.wgsl` produces periodic height, pigment, mark, and fine fields.
Both ground and water read these through the normal renderer. Colors remain RGB
through recipe composition. Optional material palette reduction is cached;
normal world shading and the existing final export palette treatment still run.
There is no offline image dependency or second CPU material renderer.

Palette diffusion runs over the full repeat, using 128-row GPU wavefront batches.
It does not restart for a viewport, export chunk, or individual 32-pixel tile.
This provides deterministic regional rendering and exact repeat addressing.
Diffusion errors do not wrap toroidally across the repeat boundary; use the seam
preview to judge a recipe. GPU float arithmetic is not promised to match the
prototype's CPU arithmetic byte for byte.

The shared cache has eight slots (seven map recipes plus the world slot), within
128 MiB. Stored fields and palette output cost 12 bytes per repeat pixel per active
material. A 1024-pixel pool fits eight slots; a 2048-pixel pool fits two. Diffusion
also uses transient row-error storage, about 2 MiB at 1024 pixels. Color edits
retain shape fields and refresh the palette output when needed. Slider input
updates only the latest recipe and cache layout. The paced draw cycle performs
field generation and diffusion after the previous chunk completes, so rapid
input cannot accumulate a full-repeat GPU job for every pointer movement.

## Focused validation

Measured on the implementation branch:

- Popup check: opening from ground and water, stage tabs, shared Undo/Redo,
  typed and dragged scrub values, save/reload, Escape with focus return, and
  a 390-pixel layout pass without console errors. The sample now contains
  256 tiles in a 512-pixel square.
- Eight new control checks on a 128-pixel procedural rust patch with phase
  amplitude 4: 35.9–95.7% of pixels change by at least 3/255 in one channel.
  This is a focused impact check, not a broad world-control sweep.
- Neutral new controls preserve the small export fixture SHA-256
  `b425819e7b9b862cc3e95507aaa37d798e1924f58c328e413c9c0563f17ff1cb`.

- Sustained 120-move scrub regression: the original input path reached 78
  unfinished GPU submissions and lost the device. After moving generation into
  the paced draw cycle, peak outstanding submissions were 6, no device or console
  errors occurred, and the final slider value matched the rendered recipe.
- Six focused model/save tests pass.
- Ground UI check: paint and landform selection, editing, undo/redo, save/reload,
  and the live preview pass.
- Texture UI check: shared scrub typing, arrow keys, pointer dragging, disabled
  explanations, continuous colors, ground/water assignments, undo/redo,
  embedded world settings, save/reload, deletion, and the 256-tile live preview pass without
  browser console errors.
- Green ground, Green water, and Violet water checks: 1024-pixel repetition and
  four-quadrant regional rendering are byte-identical; cached colors belong to
  each recipe's palette; no GPU errors. Green ground uses 25 colors in this
  generated repeat, Green water 5, and Violet water 15.
- The small export fixture checks visible water color edits, retained shape
  fields for color-only changes, water relief, and exact replay of indexed art
  and exported archive bytes. Detailed results are outside Git under
  `/private/tmp/texture-authoring-export/report.json`.

By eye, the live Ground panel displays the recipe colors correctly and the Green
sample has coherent mottling with fine grain. This is not a new owner approval of
all integrated presets.

No full suite or broad control-impact sweep was run, per the requested fast
iteration scope. The static build test stops at the stale-preview guard because
rendering inputs changed. Before publication/landing, regenerate the authored
hover/world thumbnails, publish the preview bundle through the repository's
normal workflow, and run the applicable landing and control-impact checks.
No preview lock was bypassed and no world defaults were replaced.
