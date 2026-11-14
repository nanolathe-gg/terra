# Procedural ground and water authoring

One material serves world ground, painted ground, landform ground, and water.
World defaults remain unchanged. The full-screen material editor shares the
map's renderer, undo history, save file, embedded world settings, and export.

## Minimal graph editor

Open **World → Ground → Open material editor**, or **Water & shores → Edit
material**. Choose a preset on the left. The graph occupies the center; the live
preview and selected node's controls stay together on the right. All numerical
controls use Terraform's shared scrubs, including drag, Shift-drag, arrows, and
Enter/double-click to type.

- Select a node to edit it. **Add node** supplies generators, coordinate
  distortion, remapping, gradients, generic combines, constants, and outputs.
- Drag an output dot to an input dot to connect nodes. Source menus in the
  inspector provide the same operation without pointer dragging. Coordinates,
  grayscale fields, and colors are distinct types; incompatible inputs and
  cycles are rejected with an explanation.
- Drag a node to position it. Drag empty space to pan; scroll to zoom. **Fit**
  frames the graph and **Arrange** lays it out from sources to outputs.
- **Enabled** bypasses an operation; disabled generators produce zero. Coordinate
  transforms pass their coordinates through. Disabled outputs contribute nothing.
- **Delete** removes the node and its connections. Disconnected numeric inputs
  use zero; an absent blend mask uses one. Undo restores the node and its wires.
- **Selected node** in the preview menu shows a grayscale field or color result
  using the same renderer. Final shading, continuous color, palette color,
  height, roughness, and wetness remain available. Preview terrain is optional.
- **Reset to preset** restores the complete authored graph and palette. It keeps
  the material name and assignments and is one reversible map edit.

Node layout lives in the existing material recipe. Moving a node never changes
its sources, changes its seed, or requests a material preview render. Connections
use stable IDs; a topological sort determines evaluation order. The visible
canvas is not the execution order. Keyboard users can select nodes using the
node menu and connect them using their source menus.

A layer groups a material graph with its existing amount, compositing mode,
mask, and channel contributions. Layers still compose first to last. Layer
visibility, drag ordering, duplication, deletion, and terrain/procedural masks
remain available. Each layer holds at most 40 nodes. Each material channel has
one enabled output per layer; multiple independent fields can feed that output.
This first editor deliberately has no nested node groups, function expressions,
subgraph library, or cross-layer wires.

## Fields, colors, and outputs

Noise, grain, and dots produce grayscale fields. Dots are a generator, not a
layer operation. Remap shapes a field's range and contrast. Combine uses generic
replace, add, multiply, subtract, minimum, maximum, blend, or screen arithmetic.
Its second-input offset supports centered noise. A grayscale field can mask or
scale a color field. Gradients support two, three, or sixteen colors, with a
brightness range up to twice white for multiplicative color factors.

A field can feed more than one branch: map clods to a beige gradient and also
connect them to height. Coloring can occur before or after a combine. Height
outputs change art relief, not gameplay heights. Roughness, wetness, and gloss
are optional output channels. Lighting evaluates the resulting surface; palette
reduction and diffusion follow the composed color.

The six older relief starters retain their bundled **Surface primitives** source,
using the layer's existing relief controls. Its components can be extracted in
those graphs. The initial Add node menu focuses on the generators used by the
four reviewed materials; more specialized primitives can follow the Desert test.

## Four reviewed recipes

| Preset | Construction |
| --- | --- |
| Rust mottling | Distorted noise + centered fine grain → remap → rust gradient; dots → multiplier gradient; multiply colors |
| Cloudy green | Distorted clouds → remap → green gradient; fine grain → tint gradient; multiply colors |
| Blue streaked water | Directional noise → remap → blue gradient; fine grain → tint gradient; multiply colors |
| Violet rippled water | Directional mottling → remap → violet gradient; fine tint multiplication; blend bright color through a dot mask |

Each has an explicit height output at scale zero, preserving its flat reviewed
appearance. Raising its scale uses the same structure as color. The graphs
contain 9–12 nodes, without dormant alternative dot-color branches. All preset
content is numeric procedural data; no retail pixels, traced shapes, or masks
are loaded or committed.

Existing map materials are not silently replaced. Add a starter or use **Reset
to preset** to get the rebuilt graph. The removed special-purpose layer effects
are discarded when reading old recipes; no compatibility renderer remains.

## Engine and cache

`sculpt-material-steps.js` validates and compiles typed nodes. `sculpt-material-graph.js`
draws the graph; `sculpt-material-step-panel.js` edits it using the site's controls.
`engine-ground.wgsl` evaluates the program once per repeated material texel.
Scalar sampling boundaries retain the preceding renderer's truncating half-float
precision before color mapping. Finished RGB and height are cached in
`rgba32float`; finish and mask values use `rgba16float`. Terrain and water read
these same caches, without interpreting a graph at each terrain sample.

The fixed 128 MiB material-cache budget is unchanged. Each layer uses 24 bytes
per repeat pixel, plus 4 bytes per pixel per material for palette output. One
reviewed preset at its 1024-pixel repeat uses 28 MiB, versus 40–52 MiB for the
previous component-layer version. Four single-layer presets fit (112 MiB).
Additional layers and larger repeats consume more memory; assignment checks
explain when a recipe exceeds the budget. Program-table storage and temporary
diffusion buffers are tracked separately by the renderer's overall budget.

Opening the material editor suspends terrain scheduling. The preview coalesces
changes to one active job and the latest pending recipe. Drafts defer diffusion;
after 240 ms without input, the final job restores palette treatment. No CPU
texture implementation or preview-specific material shader is used.

## Focused validation

Measured against the captured pre-change four-preset output:

- **0 of 4,194,304** full-repeat palette pixels changed. The focused 128×128
  continuous-color and shaded images also have **0** changed byte pixels.
- Green and Blue water retain identical floating-point colors. Red and Violet
  have 30 and 174 changed float components respectively, with a maximum absolute
  difference below 0.000054 (less than 0.014 of an 8-bit channel unit).
- The small ground/water export remains byte-identical: 1,255,440 bytes,
  1,142 distinct tiles, SHA-256
  `b425819e7b9b862cc3e95507aaa37d798e1924f58c328e413c9c0563f17ff1cb`.
- Focused unit checks cover typed connections, cycles, ordering, independent
  graph copies, save/clipboard round trips, bounds, and layout-only edits.
- Browser checks cover the four presets, node preview, noise/gradient/height
  edits, pointer movement and connection rejection, deletion, undo/reset,
  graph layout saving, and mobile containment.

`repro/preset-components.mjs --capture` records a procedural baseline outside
Git; run without that flag after the change to compare. `repro/material-steps-ui.mjs`
requires explicit server and CDP ports. These checks do not import retail art.
No full suite or broad scene/control sweep was run.

Preview publication remains required before landing: regenerate and publish
through the normal preview-assets workflow. The rendering fingerprint was not
bypassed. No world defaults were replaced, and the branch has not been merged.
