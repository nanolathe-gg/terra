# Procedural ground and water authoring

One material recipe serves world ground, painted ground, landform ground, and
water. World defaults remain unchanged. The full-screen material editor shares
the map's renderer, undo history, save file, embedded world settings, and export.

## Artist workflow

1. Open **World → Ground → Open material editor**, or **Water & shores → Edit
   material**. Choose a starting material. The editor fills the screen, with
   materials/layers on the left, a 512-pixel sample in the center, and controls
   for the selected layer on the right. Small screens stack these columns.
2. Layers compose in list order, first to last. Add a cloudy color, cellular
   patch, scattered pits, ridges, water streaks, or fine grain. Select its row
   to edit it; drag the grip to reorder. Earlier/Later buttons provide keyboard
   and touch alternatives. Uncheck a layer to hide it without discarding its
   settings. Duplicate and Delete operate on the selected layer. Keep at least
   one layer; a material supports up to eight, subject to the cache budget.
3. Color and relief layers have an amount, color blend (Normal, Multiply,
   Screen, Add), and separate color, relief, and surface amounts. Negative relief cuts pits;
   positive relief raises the art. It does not change gameplay heights.
   Seed moves the periodic pattern. Patch and distortion sizes use art pixels.
4. Choose Everywhere, a procedural mask, a terrain height range, or a terrain
   slope range. Procedural masks share the periodic clouds/cells/spots/ridges/
   waves/grain tools, with size, detail, distortion, seed, range, and inversion.
   Height uses authored terrain units; slope uses degrees. Range softness and
   mask amount blend continuously. Masks belong to their layer, with no links
   or references to other layers.
5. Use Pattern, Distortion, Filter, Color & blend, and Bump & finish to refine
   that layer. Color and relief generators can use the existing noise, fine
   grain, marks, and relief primitives. The four reviewed texture presets expose
   separate pattern, grain, dot (where used), and relief layers. Grain and dot
   adjustments inherit their preceding color generator’s pattern; their own
   controls remain editable. Unrelated tabs and color inputs are hidden.
   Advanced groups remain collapsible. All numerical controls use the
   editor's shared scrubs: drag, Shift-drag, arrows, and Enter/double-click to type.
6. Preview final shading, continuous color, palette color, relief, roughness,
   or wetness. Expand Preview terrain to vary height/slope and inspect masks.
   These viewing settings are not saved as material parameters. The sample
   crosses the repeat seam. Water starts over a submerged bed; ground starts
   at the world's base height.
7. Palette treatment applies once to the composed material, not separately to
   each layer. Use up to 32 game palette colors, diffusion spread, tone response,
   and channel sensitivity. Continuous RGB colors remain available before this
   output step. A blank output palette uses the first layer's relief ramp.
8. **Reset to preset** restores the chosen preset's generators, colors, finish,
   palette, and initial layer stack. It preserves the material's name, slot,
   and ground/water assignments. The starting preset is remembered for built-in
   materials and their copies; imported recipes can choose a reset preset.
   Reset is one shared undo step, so Undo recovers the entire edited stack.
9. Done or Escape closes the editor and returns focus to its opener. Assign the
   material to world ground/water, paint with it, or choose it on a landform.
   Save the map normally. Layers, visibility, masks, order, and source preset
   travel with map saves, world copies, and recipe copy/paste.

## Rendering and responsiveness

Opening the dialog suspends the terrain canvas scheduler and cancels its pending
bake. An already submitted GPU operation can finish; no new viewport jobs are
scheduled while the dialog is open. Edits still update the map and invalidate
its retained terrain. Closing resumes rendering with the latest recipe.

The material sample uses the normal GPU renderer. During input it coalesces to
one active job and the latest pending recipe. Drafts defer palette diffusion;
after 240 ms without new input, a final job restores the selected palette
settings. The preview labels drafts. No separate CPU texture renderer or preview
shader implements a second material model. The previous invisible contact-strip
render was removed, so every preview job contributes to the displayed sample.

`sculpt-material-layers.js` defines layer settings and stack operations.
`sculpt-ground-presets.js` validates recipes; the root carries the first layer
and material-wide palette settings, with subsequent layers in `layers`.
This is one recipe format, without nested stacks or arbitrary graph references.
`sculpt-ground-cache.js` packs the layer table and caches each layer's periodic
height/color fields and procedural mask. Color/finish edits retain shape fields.
Uniform uploads and generation occur in the paced render cycle, not every input.

`engine-ground.wgsl` and `engine-texture.wgsl` generate the same procedural fields
for each layer. `engine-common.wgsl` composes color, additive relief, and surface
finish for both terrain and water. Surface layers blend gloss, sharpness,
roughness, roughness scale, and wetness through their pattern. Ground uses the
normal surface lighting; water adds relief and finish to its pigment while
retaining the world's shore/depth/absorption model. Neutral starter water gloss
preserves the earlier appearance. Projection bounds include the stacked relief.

For terrain-independent materials, canonical GPU diffusion covers the full repeat
in 128-row wavefront batches. It never restarts at a tile or export chunk. Terrain
masks vary with the map, so their final colors reuse the unmasked repeat's diffusion
residual and are re-quantized after terrain-dependent composition. This is a
coordinate-stable approximation, not whole-map error diffusion. It avoids a
texture-wide dither switch when a terrain mask moves slightly above zero.
Diffusion errors do not wrap across the repeat boundary; inspect the seam.
GPU float arithmetic is not promised to match offline float64 studies.

The 128 MiB texture cache budgets 12 bytes per repeat pixel per layer (8 for fields,
4 for a procedural mask), plus 4 bytes per pixel per material for final palette
color. At a 1024-pixel repeat, one eight-layer material uses 100 MiB; eight
single-layer materials use 128 MiB. A 2048-pixel repeat fits one two-layer material
or two single-layer materials. The editor rejects assignments that exceed the
budget, with an explanation. Layer-table storage is additionally tracked in the renderer's memory accounting;
diffusion also uses transient error rows (about 2 MiB at a 1024-pixel repeat).

## Presets and Bryce reference

The four texture starters carry numerical recipes from the approved ground and
accepted water studies: Rust mottling, Cloudy green, Blue streaked water, and
Violet rippled water. They contain no retail pixels, traced shapes, or image masks.
Their stacks are:

| Preset | Layers, in composition order |
| --- | --- |
| Rust mottling | Rust mottling → Fine grain → Dark dots → Relief |
| Cloudy green | Cloudy mottling → Fine grain → Relief |
| Blue streaked water | Water streaks → Fine grain → Relief |
| Violet rippled water | Ripple mottling → Fine grain → Bright flecks → Relief |

The relief layers start flat, matching the reviewed recipes. Green and Blue
have no dot layer because their original recipes have no dots. The six older
relief presets are unchanged. Existing map recipes are not rewritten; add a
preset or use **Reset to preset** to get its component stack.

This decomposition revealed two different grain operations: Rust adds fine
detail before its color ramp; the other three multiply the existing pigment by
a grain tint, which can brighten as well as darken. Dots apply their color or
multiplier after grain. These are explicit **Layer operation** choices alongside
ordinary Color and relief generators, rather than duplicated pattern knobs.
Adjustments inherit the nearest preceding color generator’s scale, distortion,
filtering, colors, and seed, including later edits to those values. They expose
only their own grain or dot controls and colors. Reordering an adjustment changes
which generator it follows; an adjustment before any generator is inactive and
explains how to enable it. Masks and amount still belong to each layer. There
are no user-managed references or graph connections. Detail corrections are
relative to that generator, not an arbitrary chain of pre-ramp field operations.

At a 1024-pixel repeat the three-layer presets use 40 MiB of texture cache and
the four-layer presets use 52 MiB. The existing 128 MiB cache limit is unchanged.
This extra memory is a tradeoff to revisit if artists need many layered materials
assigned simultaneously.

The integrated renderer's lighting can differ from offline review tools; those
studies do not establish pixel-identical rendering in every world.

The procedural tools were informed by MetaCreations' [Bryce 4 User Guide, texture
chapter](https://www.scribd.com/document/512436170/Bryce4), a 1999 primary source.
Exact 1997 parity is unverified. Standard octaves add half-frequency,
double-amplitude layers, with fractional octave weights. The supplied template
archive identifies itself as Bryce 7.1. The editor generalizes those ideas into
periodic 2D layers rather than claiming complete Bryce emulation or 3D mapping.

## Focused validation on this branch

Measured:

- Decomposing the four reviewed presets changes **0** continuous floating-point
  color components and **0 of 4,194,304** full-repeat palette pixels. The focused
  128×128 color and shaded views also match exactly. The comparison reads the
  earlier numeric recipes from commit `37b25a98`; it contains no retail art.
- A focused browser check verifies all four component stacks, inherited scale,
  independently visible grain, exact Undo restoration, reset, and save/reload,
  with no console errors or changed world assignments.

- Nine focused model/save tests pass, including adjustment inheritance, layer ordering, ownership,
  palette preservation, invalid nested stacks, and cache limits.
- The browser check passes full-screen sizing, native pointer drag reordering,
  visibility, add/duplicate/delete, shared Undo/Redo, reset-to-preset and undo,
  channel previews, save/reload, Escape, and a 390-pixel mobile layout.
- Terrain GPU submissions while editing: **0**. Closing resumes rendering.
- A 120-pointer-move scrub test reaches **3** outstanding GPU submissions at
  peak, with no device or console errors. The final value is 0.95 in both the
  control and renderer; the final preview includes palette treatment.
- GPU checks cover layer order/blend, zero and hidden layers, procedural and
  terrain masks, signed relief, channel views, water finish, and palette output.
  Pool repetition and regional replay are exact. A 0.00001 layer amount changes
  1 of 16,384 pixels by more than one channel byte, attributable to projected
  relief. Starting a terrain mask at 0.00001 changes **0** pixels in its test.
- The small ground/water export remains byte-identical to the pre-stack result:
  SHA-256 `b425819e7b9b862cc3e95507aaa37d798e1924f58c328e413c9c0563f17ff1cb`,
  1,255,440 archive bytes and 1,142 unique tiles. Its 120 immediate recipe edits
  submit **0** GPU commands; same-build art and archive replay are exact.

By eye, the full-screen layout keeps the layer list, sample, and controls visible
on desktop, and stacks cleanly on mobile. This is interface review, not new
owner approval of a material appearance.

No full suite, broad scene sweep, or broad control-impact sweep was run. Before
publication/landing, regenerate and publish the authored preview bundle through
the repository's normal workflow: the rendering-input fingerprint has changed.
No preview lock was bypassed. No world defaults were replaced or branch merged.
