# Procedural ground and water authoring

One material serves world ground, painted ground, landform ground, and water.
World defaults remain unchanged. The full-screen material editor shares the
map's renderer, undo history, save file, embedded world settings, and export.

## Minimal graph editor

Open **Materials** in the global toolbar. The World and Water panels also
link to the same editor. Choose a preset on the left. The graph occupies the center; the live
preview and selected node's controls stay together on the right. All numerical
controls use Terraform's shared scrubs, including drag, Shift-drag, arrows, and
Enter/double-click to type.

- Select a node to edit it. **Add node** supplies generators, coordinate
  distortion, remapping, gradients, generic combines, constants, and outputs.
- Drag an output dot to an input dot to connect nodes. Source menus in the
  inspector provide the same operation without pointer dragging. Coordinates,
  grayscale fields, and colors are distinct types; incompatible inputs and
  cycles are rejected with an explanation. Click a connected input dot to
  disconnect it, or click **×** beside its source menu. Undo restores the wire.
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

Each material is exactly one graph, with at most 40 nodes and one enabled
output per channel. Blend and mask fields with Combine nodes inside that graph.
There is no layer list, layer data, layer masking pass, or stack compositor.
This first editor deliberately has no nested node groups, function expressions,
or subgraph library.

## Fields, colors, and outputs

One **Noise** node offers **Fractal**, **Fine grain**, and **Pixel random**
types. The controls change with the selected type. Dots also produce a grayscale
field; color and blending remain ordinary graph operations. Remap shapes a field's range and contrast. Combine uses generic
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
using the material's existing relief controls. Its components can be extracted in
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
to preset** to get the rebuilt graph. Removed layer settings and obsolete standalone grain/pixel nodes are dropped
when reading old recipes; dangling connections are cleared. No compatibility
renderer remains. Reset to preset restores the current reviewed construction.

## Engine and cache

`sculpt-material-steps.js` validates and compiles typed nodes. `sculpt-material-graph.js`
draws the graph; `sculpt-material-step-panel.js` edits it using the site's controls.
`engine-ground.wgsl` evaluates the graph once per repeated material texel. The
compiler emits straight-line GPU operations instead of interpreting two dynamic
40-element arrays at every pixel. Pipelines are cached by graph topology and
operation; numeric settings remain uniforms. Preview, terrain, and export use
the same compiler and shader operations.
Scalar sampling boundaries retain the preceding renderer's truncating half-float
precision before color mapping. Finished RGB and height are cached in
`rgba32float`; surface finish uses `rgba16float`. Terrain and water read
these same caches, without interpreting a graph at each terrain sample.

The fixed 128 MiB material-cache budget is unchanged. Each graph uses 28 bytes
per repeat pixel: color/height, surface finish, and palette output. A material at
its 1024-pixel repeat uses 28 MiB; four fit (112 MiB). Program-table storage and
temporary diffusion buffers count toward the renderer's overall budget.

Opening the material editor suspends terrain scheduling, including reloads and
weather work. The preview coalesces changes to one active job and the latest
pending recipe. Its 256×256 sample displays art at 1×. Drafts render immediately;
120 ms after input settles, palette diffusion finishes the same sample. Palette
settings no longer regenerate the procedural fields. Readback and tile counting
happen only for the finished sample. The full repeat remains available for exact
periodicity and consistent diffusion; no CPU texture engine or special preview
shader is introduced.

Measured on the same machine with one before/after run, excluding the first
edit of each preset: live previews improved from **316–368 ms to 32–40 ms**;
finished dithered previews improved from **639–716 ms** (Blue water 625–634 ms)
to **176–234 ms**. These are small-swatch authoring measurements, not terrain
performance claims. By eye, the four before/after palette samples retain their
appearance. The largest palette-frequency delta is 0.027 percentage points.
The small 1,255,440-byte export replays exactly (1,142 distinct tiles); its hash
changes because some individual dither pixels moved.

A new topology still has a first-use GPU compilation cost. Numeric slider edits
reuse its pipeline. `repro/material-preview-perf.mjs --server <url> --port <cdp>
--out <dir>` measures first and finished preview latency for four small edits of
each reviewed preset, with the first edit reported separately from warm edits.

## Focused validation

Focused checks cover typed connections, cycle rejection, independent graph
copies, save/clipboard round trips, bounds, removed options, and layout-only
edits. Browser checks exercise global access, all four presets, noise-type
switching, both disconnect interactions, node previews, color/height editing,
undo/reset, graph layout saving, and mobile containment. Terrain submits no GPU
work while the modal is open, including a map reload.

The full-repeat continuous colors and sampled shaded output are compared against
the previous procedural baseline. Recompiling GPU arithmetic changes some
individual palette diffusion decisions near ties. The comparison reports these
changed pixels and the RGB/palette distribution separately; it does not claim
bit-identical dither output. Export must remain deterministic on replay.

`repro/preset-components.mjs --capture` records a procedural baseline outside
Git; run without that flag after the change to compare. `repro/material-steps-ui.mjs`
requires explicit server and CDP ports. These checks do not import retail art.
No full suite or broad scene/control sweep was run.

Preview publication remains required before landing: regenerate and publish
through the normal preview-assets workflow. The rendering fingerprint was not
bypassed. No world defaults were replaced, and the branch has not been merged.
