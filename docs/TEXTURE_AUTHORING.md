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
  outputs. Connections use smooth Bezier curves. Inputs sit near their first
  consumer, branches align with input ports, and outputs stay beside their
  producing branch. Long links reserve layout space; a final placement pass
  moves obstructing cards aside where possible. Selecting a node highlights
  its connections. Existing manual positions are preserved until **Arrange**.
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
layout, nonoverlapping cards, forward dependencies, nearby branch inputs,
input-port ordering, and 7 MiB cache accounting. Layout checks include the
four reviewed graphs and the Desert study. `repro/material-repeat.mjs` checks the 512px horizontal and vertical
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
material. It does not replace a world's ground. Its twenty-one-node graph shares a
varied clod field between a sand-to-beige gradient and the height output, then
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

### Desert retail comparison pass

Compared the study with an existing 256×256 retail flat-ground reference at
native scale and with a 0.8px Gaussian diagnostic to expose structure beneath
dithering. Review images and candidate recipes stay outside Git in
`/private/tmp/desert-retail-review/`; none are runtime inputs.

By eye, the starting study was too golden, with large, soft, regularly spaced
highlights. Three small candidate rounds led to smaller, sharper clods, stronger
fine gradient-noise relief, cooler tan colors, and more distinct dark grains.
The final adjustment softened the excessive dark spots from the third round.
The 32-color output selection uses palette entries measured in the reference;
only palette numbers are saved, never pixels or spatial patterns. The graph's
construction and algorithms are unchanged.

On this sample, retail's mean RGB is 170.0/144.4/121.3 and luminance standard
deviation is 39.1. The initial study measured 179.3/147.0/108.7 and 28.9;
the revision measures 170.7/145.8/123.5 and 38.4. These are diagnostics, not an
artistic acceptance gate. By eye, generated highlights remain more uniform;
retail still has sharper, darker narrow crevices. This is still a study, pending
owner review, and does not change world defaults or the four approved presets.

Validation for this numbers-only pass: two focused recipe/palette unit tests
and the Desert browser check passed, including live algorithm edits, relief,
exact Undo, and zero terrain submissions while the editor is open. Candidate
renders and the final browser check reported no GPU errors. No full suite or
new export/performance sweep was run.


### Desert highlight and crevice pass

The next study adds ordinary graph branches, with no new engine operations:
fractal noise modulates the clod field around a neutral multiplier to vary the
highlight sizes/heights without dimming every top. A ridged field is remapped
to a narrow crease mask and subtracted from the combined relief. Crevices are
lit height cuts; the tested interior-color multiplier was discarded because it
made the surface muddy. Fine relief is slightly smaller, and the brightest
grain/beige colors are restrained. The resulting graph has 17 editable nodes.

By eye, highlights are less regular and crevice shadows are deeper. The surface
still looks somewhat coarser than retail, so this remains a study rather than an
accepted replacement. At 1× on the same 256px sample, mean RGB is
168.0/142.9/121.0 (retail 170.0/144.4/121.3), luminance standard deviation is
38.8 (retail 39.1), and its fifth-percentile luminance is 75.0, down from 85.8
and matching retail's 75.0. Softened-grain contrast is still higher: 20.5 versus
18.4. These diagnostics do not establish visual equivalence.

Review artifacts live in `/private/tmp/desert-crevice-review/`, outside Git.
Two recipe/palette unit tests, the scoped Desert browser check (including exact
Undo and zero terrain submissions while open), and the small material repeat
check passed. The 512px raw color, palette color, and relief repeat exactly;
regional rendering also matches. No full suite or new export sweep was run.
The four approved presets and world defaults remain unchanged.


### Desert five-block swap pass

Reviewed six small rounds (22 candidates) using the requested two 1×1, two 4×4,
and one 8×8 tile inserts on one contiguous 768×768 retail flat-ground sheet.
Tiles are 32px. Each candidate was rendered at the actual 512px material period,
then pasted directly: no edge feathering, recoloring, or resizing. A retail-to-
retail control uses the same layout. Review images, recipes, and exact crop/swap
coordinates remain outside Git in `/private/tmp/desert-swap-review/`.

By eye, the initial larger inserts were conspicuous: coarse, connected clods
and gray grain made rectangular patches. The saved revision reduces clod spacing
from 4.8 to 3.2, uses pixel noise for fine relief, reduces the scale/depth of
creases, and separates pigment grain from height grain. One additional ordinary
Noise node gives pigment slight directional coherence; its gradient and multiply
controls set the warm/cool grain. Sand colors compensate for the changed relief.
All 18 nodes use existing operations. Dithering and palette selection are unchanged.

The single-tile swaps blend better by eye, and larger inserts are less coarse,
but the 4×4 and 8×8 blocks remain identifiable. Fine color/grain structure still
needs work; this is not an indistinguishable or owner-approved match. Stronger
color/directional grain produced pink-green streaks, reduced dithering did not
help, and an extra three-node mineral-color branch added little visible benefit,
so those candidates were discarded.

Measured on the full rendered candidate, mean RGB is 169.7/144.4/121.8 versus
170.0/144.5/121.4 for the retail sheet; luminance standard deviation is 39.9 versus
39.0. With a 0.8px Gaussian diagnostic it is 19.4 versus 18.5. Close aggregate
statistics do not establish visual equivalence, as the larger swaps demonstrate.

The four reviewed presets and world defaults remain unchanged. No retail pixels
or spatial masks are runtime inputs or committed assets.

Validation: two focused unit tests passed (about 52ms); the scoped Desert browser
check passed with exact Undo, zero terrain submissions while open, and no GPU
errors. The small GPU check confirmed exact 512px color/height repetition and
regional replay. The saved preset's 512px render matched the chosen candidate
byte for byte. No full suite was run.


### Desert follow-up: rejected trials and remaining structure

After the owner found the swaps still easy to see, tested 20 additional recipe
variants and four renderer diagnostics (review folders `round7`–`round13` in
`/private/tmp/desert-swap-review/`). These were 512px renders using the same
five-block layout. None reliably concealed the larger blocks by eye, so this
pass does not change the saved study, other presets, world defaults, or shaders.

- Reducing relief and increasing pigment contrast made brown/white speckling;
  warmer gradients moved the whole patch orange without fixing the structure.
- Neutral dark grains, blended through a dot mask instead of multiplying the
  existing pigment, improved that particular detail by eye but made the patch
  darker and more contrasty. A separate mineral tint introduced blue/orange
  flecks, rather than retail's more restrained variation.
- Sharing the fine field between color and relief, reducing clod spacing again,
  and remapping grain height with powers 0.5, 2, and 3 did not remove the visible
  blocks. Some became too smooth; others retained coarse beige/pink clusters.
- An offline diagnostic applied the recipe's palette diffusion after lighting
  (9/17 right, 6/17 down, 2/17 down-left), instead of relying on the final nearest
  palette lookup. It did not resolve the mismatch. This is an analysis artifact,
  not a second runtime renderer or a proposed shader change.
- Reusing the existing water bump shading in an isolated preview, without any
  persisted assignment, also failed to reproduce the grain. It is not proof of
  equivalence between water and ground lighting, and is not a proposed workaround.

By eye, the next structural target is retail's tight light/dark grain pairs and
neutral dark flecks, rather than additional broad noise or global color shifts.
As supporting diagnostics, horizontal luminance correlation at offsets 2 and 3
pixels is approximately -0.169/-0.038 in the retail sheet, versus -0.093/-0.113
in the saved study: the negative correlation extends farther in our render.
This suggests examining the scale/profile of lit grain before another color
pass; it does not identify a unique height field or establish a renderer bug.
Do not turn these diagnostics into a pixel-statistics texture generator.

All 24 GPU renders completed with no reported GPU errors. No product code changed,
so no unit, export, or full-suite rerun was needed. The rejected recipes and retail
comparison images remain outside Git; `followup-review.png` shows the saved study
and one rejected neutral-grain candidate at native scale and 2× magnification.


### Desert local-color reconstruction pass

The owner's orange-versus-red observation prompted a comparison beneath the
palette alternation. Estimate local color mixtures by separating luminance from
RGB chroma, smoothing luminance at sigma 0.85px and chroma at 1.2px, and combining
them again. Apply the same filter to retail and generated images; also inspect
RGB at sigma 3px and 6px. This is not an exact inverse of dithering or a claim to
recover the original true-color render. A generated render without quantization
provides a check on what the filter removes. All analysis artifacts remain in
`/private/tmp/desert-undither-review/`, outside Git and the product.

By eye, the reference has darker orange patches among lighter gray-beige areas;
the saved study had more uniform pink/tan grain. The similar average RGB values
hid that difference. Twelve candidates tested color direction, spatial scale,
and the relationship between warmth and brightness. The chosen revision removes
the fine grain gradient's pink-green tint and adds three ordinary nodes: fractal
noise, a gray-beige/orange multiplier gradient, and Multiply. The warmer end also
reduces brightness, instead of making every orange patch a highlight. Artists
can edit the field size/detail, both colors, and blend strength. The 21-node graph
keeps the existing clods, relief, palette, and dithering; no new shader operations
or controls were necessary.

Measured on corresponding 512px samples at sigma 3px, the standard deviation of
R-minus-B variation changes from 1.90 to 5.21 (retail 4.64). Its correlation with
G-minus-(R+B)/2 changes from -0.024 to -0.769 (retail -0.829). Mean RGB remains
169.4/144.5/121.9 versus retail 170.0/144.5/121.4. These are supporting diagnostics,
not acceptance criteria. By eye the orange/gray-beige organization is closer;
the large raw tile inserts still expose differences in fine highlights and dark
cuts. The result remains an unapproved study.

The final comparison includes native pixels and estimated local color for
retail, before, and revised textures. The five-block sheet uses the saved 512px
render directly, with the same 1×1, 1×1, 4×4, 4×4, and 8×8 hard-pasted inserts.
Its rendered bytes exactly match the chosen candidate. The four approved presets
and all world defaults remain unchanged; no retail-derived image is committed.

Validation: six focused recipe/layout unit tests passed; the scoped Desert
browser check passed with exact Undo and zero terrain submissions while open.
The small GPU check confirmed exact 512px color/height repeat and regional
replay. Candidate/final renders reported no GPU errors. No full suite was run.


### Desert highlight restraint

After owner feedback that the inserts were slightly brighter and had too many
highlights, compared eight small variants across two rounds. The saved revision
uses a neutral three-stop grain multiplier (0.9, 1.005, 1.08), softening the bright
end without uniformly darkening the material. A modest increase in dot hardness
(0.45 to 0.52) and darker dot multiplier preserve sparse dark grains. The graph,
orange/gray-beige patch branch, relief, palette, and dithering are unchanged.

Measured on the 512px review samples, pixels above luminance 200 fall from 6.59%
to 3.31% (retail 3.39%). The 95th-percentile luminance after a 0.85px Gaussian
filter falls from 176.8 to 173.7 (retail 172.9). Mean RGB changes from
169.4/144.5/121.9 to 168.8/143.8/121.4. These are review diagnostics, not a visual
acceptance gate. By eye the larger inserts are less conspicuous, but fine-texture
differences remain. No claim of indistinguishability or owner approval is made.

The raw five-block swaps were also inspected on a second visually flat retail
crop at (4608, 768), 768×768px, in the same Painted Desert map. The improvement
in highlight balance carries across that crop by eye. Both sheets use direct
pastes with no edge blending. Artifacts and candidate recipes are outside Git in
`/private/tmp/desert-highlight-review/`. All world defaults and the four approved
presets remain unchanged.

Validation: two focused recipe/palette unit tests passed (about 62ms), all eight
candidate renders and the saved-preset render reported no GPU errors, and the
saved render matched the chosen candidate byte for byte. The small GPU check
confirmed exact 512px color/height repeat and regional replay. No full suite ran.
