# Procedural ground and water authoring

One material serves world ground, painted ground, landform ground, and water.
World defaults remain unchanged. The full-screen material editor shares the
map's renderer, undo history, save file, embedded world settings, and export.

## Minimal graph editor

Open **Materials** in the global toolbar. The World and Water panels also
link to the same editor. The compact material selector stays at the top;
**Manage material** holds presets, naming, copy/paste, and reset. The graph gets
the main workspace, node settings scroll on the right, and the final texture
and selected-node output remain visible together in a fixed preview dock. All numerical
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
  frames the graph and **Arrange** groups related branches from sources to
  outputs. Long edges reserve space during layout. Orthogonal wires route
  through free gutters around cards; selecting a node highlights its connections.
- **Enabled** bypasses an operation; disabled generators produce zero. Coordinate
  transforms pass their coordinates through. Disabled outputs contribute nothing.
- **Delete** removes the node and its connections. Disconnected numeric inputs
  use zero; an absent blend mask uses one. Undo restores the node and its wires.
- The final texture never switches to a node diagnostic. The second preview
  follows the selected node: grayscale fields, RGB gradients/combines, or height
  with zero at mid-gray. Coordinates warp a reference cellular pattern. These
  are temporary ordinary graphs rendered by the same GPU operations, not saved
  recipes or new node types. **Preview setup** holds the sample height and slope.
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
40-element arrays at every pixel. It calls each operation directly, keeping
unused generator branches out of the reachable shader; this also avoids Metal
compiler failures observed when switching node previews. Pipelines are cached by graph topology and
operation; numeric settings remain uniforms. Preview, terrain, and export use
the same compiler and shader operations.
Scalar sampling boundaries retain the preceding renderer's truncating half-float
precision before color mapping. Finished RGB and height are cached in
`rgba32float`; surface finish uses `rgba16float`. Terrain and water read
these same caches, without interpreting a graph at each terrain sample.

Graph materials now repeat every **512 pixels**, as requested. This is separate
from the pre-existing world's ground period: those world settings and original
textures are unchanged. Generation derives its period from its output texture;
terrain, water, and diffusion sample that same period.

Each graph uses 28 bytes per repeat pixel: color/height, surface finish, and
palette output. The 512×512 repeat costs **7 MiB** per material, down from 28 MiB
at 1024. It has at most **256 distinct 32×32 tile positions** at one flat height
and lighting condition, versus 1,024 at 1024. Changed lighting, relief and edges
can create additional exported tiles. Seven assigned graphs fit in 49 MiB;
the fixed 128 MiB material-cache budget remains unchanged. Program storage and
temporary diffusion buffers also count toward the overall renderer budget.

512 is a cost/repetition tradeoff, not a resolution reduction: one texel is still
one art pixel. A shorter repeat changes procedural lattice wrapping and palette
diffusion, so the new textures are not expected to match the old 1024 repeat
byte for byte. The graph recipes, colors, and authored pattern scales stay the
same; fewer unique tile positions repeat sooner.

Opening the material editor suspends terrain scheduling, including reloads and
weather work. Final and node swatches share one renderer and serialize their
jobs. Each swatch retains only its latest pending recipe. Selecting a node does
not request a new final image. Desktop swatches are 256×256 at 1×; narrow layouts
scale both down while keeping both visible and letting the inspector scroll.

Drafts render immediately; 120 ms after input settles, palette diffusion
finishes the final sample. Node previews skip diffusion and tile counting.
Palette-only edits retain generated fields. No CPU texture engine or special
preview shader is introduced.

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

`repro/material-design.test.mjs` checks independent preview recipes, deterministic
layout, unobstructed routes across the four reviewed graphs, and 7 MiB cache
accounting. `repro/material-repeat.mjs` checks the 512px horizontal and vertical
repeat, regional equivalence, and retention of the world's original 1024px
period on a small authored fixture. It probes the material sampler directly;
projected terrain pixels can sample different surface hit points and are not a
texture-period test. Regional rendering is checked separately.

This pass: 16 focused unit tests passed; all four material samplers and regional
renders matched exactly; the browser interaction check reported no errors and
zero terrain submissions while open. The small export replay was byte-exact
(1,256,464 bytes, 1,143 unique tiles), with zero GPU errors. Its 120-input edit
burst submitted no GPU work before a draw. Desktop/mobile layout was inspected
by eye; no broad performance or scene suite was run.

`repro/preset-components.mjs --capture` records a procedural baseline outside
Git; compare only baselines with the same repeat dimensions. `repro/material-steps-ui.mjs`
requires explicit server and CDP ports. These checks do not import retail art.
No full suite or broad scene/control sweep was run.

Preview publication remains required before landing: regenerate and publish
through the normal preview-assets workflow. The rendering fingerprint was not
bypassed. No world defaults were replaced, and the branch has not been merged.

## Desert study and additional algorithms

**Manage material → Add preset → Desert clods (study)** is an unassigned starting
material. It does not replace a world's ground. Its twelve-node graph shares a
rounded clod field between a sand-to-beige gradient and the height output, then
adds fine grain and sparse dark spots through ordinary combines. Height is real
art relief, so changing its output scale changes lighting; it is not a painted
highlight. The four previously reviewed recipes are unchanged.

The existing Noise node now also offers:

- **Cellular bumps:** scattered smooth radial kernels. Spacing controls the
  distance between centers; radius is relative to spacing. Scatter breaks the
  grid, variation changes individual radii/heights, and profile shapes the
  shoulders. Neighboring octave lattices blend for continuous size edits. The
  result stays in 0–1 and can drive masks, color, or height.
- **Ridged:** absolute-value ridges from periodic noise, with size, finer detail
  octaves, detail strength, and sharpness. Fractional octave weights preserve
  continuous edits. It also outputs 0–1.

Transform coordinates now has an **Algorithm** selector: the existing
**Turbulence** and **Curl flow**. Curl flow follows the perpendicular gradient of
a periodic scalar potential, using midpoint steps to bend coordinates along
curved paths. Amount zero is the identity. It retains the existing size, octave,
and axis controls. The approach is informed by [Bridson, Hourihan, and
Nordenstam's curl-noise paper](https://www.cs.ubc.ca/~rbridson/docs/bridson-siggraph2007-curlnoise.pdf);
this is a modern coordinate-distortion tool, not a reconstruction of a specific
Bryce algorithm. All three additions run in the normal graph compiler, terrain
renderer, preview, and export, with the same 512px period.

By eye, the Desert study has identifiable clods, gaps, fine grain, and lit
relief. It still needs owner review and color/spacing refinement against the
reference; it is not an approved retail match. The second pass reduces packed,
rock-like relief and opens the gaps. No retail images are shipped.

Focused checks: `repro/material-desert.test.mjs` covers graph round trips and
algorithm compilation; `repro/material-steps-ui.mjs --desert --server <url>
--port <cdp> --out <dir>` checks both noise choices, curl, relief, exact Undo,
preview rendering, and suspended terrain. The existing small GPU and export
checks accept `repro/material-repeat.mjs --preset desert-clods` and
`repro/texture-export.mjs --ground desert-clods` to scope them to this study.
