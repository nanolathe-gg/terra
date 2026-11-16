# Materials: the world's surface textures

A world's ground and its deep water are **materials**, and so are the other
surfaces it names a material for: highland ground, rock, slope cover, debris,
beach sand and mineral margins. Every rock type shows a rock material. A material is one node
graph that makes a repeating texture: unlit color, an art height the sun
lights, and shine, reduced to a set of the game's 256 colors. The material
editor is the only way to set these textures (owner, 2026-11-14); the old
generator (fixed tiles, quilted plains, water grain layers) is gone.

- Model and rules: [`sculpt-materials.js`](../sculpt-materials.js)
- What each node computes: [`engine-ground.wgsl`](../engine-ground.wgsl)
- The shipped library: [`materials/textures.json`](../materials/textures.json)
- GPU cache: [`sculpt-material-cache.js`](../sculpt-material-cache.js)
- Editor: [`sculpt-material-editor.js`](../sculpt-material-editor.js),
  [`sculpt-material-graph.js`](../sculpt-material-graph.js),
  [`sculpt-material-preview.js`](../sculpt-material-preview.js)

## Two tiers

A material's **graph** is its source: nodes, wires and every node's settings.
Its author works there. The **controls it publishes** (a label over one node
setting, or over a gradient's colors) are what a map maker adjusts in the
Controls pane without opening the graph. Rule 9 governs the published
controls; node settings are the author's tools.

## Where materials live

- **The library** (`materials/textures.json`) holds the shipped materials by
  key. A world names its two in its table: `world.materials: {ground, water}`
  in `materials/<world>.json`.
- **The world owns its ground and its water** (owner, 2026-11-14). They are
  world settings like its sliders: where you change one, the world keeps it
  in this browser and every map drawn in that world shows it. One the world
  never changed stays the library's, so a library revision reaches it.
  "Restore built-in settings" returns both to the library's. What the world
  keeps is marked with the library material it replaces, so a library
  material keeps its own edit.
- **A map** holds up to fifteen materials in slots 1 to 15: the world's two,
  the materials for the surfaces its world names, its rock types' rock
  materials, and its own for landforms and the Paint brush (a stroke's Ground
  choice: `-1` the ground beneath, `0` the world's ground, else a slot; shown
  as chips with each material's color). A new landform starts on the ground
  beneath; the Paint brush's Material starts on the world's ground. A
  map opened in a world takes that world's two, in the slots the map already
  gave those roles; its own materials stay.
- **Saves, undo and share links** carry the map's list, and the world
  settings a save embeds carry the world's two. Opening a save whose world
  draws as this browser's changes nothing in the world; one whose world
  differs (sliders, colors, surface or kept materials) opens as a world of
  its own, named for the map, and leaves yours unchanged. World › Use for my
  <world> adopts it and keeps the one it replaces as "<world> before <map>".
- **A world of your own** (World, New) and a world file carry the two.
- **Highland ground.** A world may also name a highland material
  (`world.materials.high`): a new map adds it with the role *highland
  ground*, and level raised ground takes it in place of the world's ground
  by its rise above the plain (World rows Highland ground, from and fade;
  0 strength draws as before). On level tops it wins over the column's
  beds; rock faces still draw over it. A world may also list materials its
  tools lay down (`world.materials.extra`); a new map adds them too.
- **The world's other surfaces** are roles a material holds, one each:
  highland ground (`high`), rock (`rock`), slope cover (`slope`), debris
  (`debris`), beach sand (`beach`) and mineral margins (`fringe`, `body`,
  `ring`), named in `world.materials`. A new map adds the world's; Manage,
  *Also the world's*, gives a material a role or takes it away. A map
  reopened in its world keeps the roles its artist cleared; a map carried
  into another world takes that world's surfaces, and a library material
  still unedited in a role follows the world. A surface without a material
  draws from another (the slope cover, else the ground). The highland
  ground joins any map with room, and so does a beach another world lends,
  since it is chosen after the map was made.
- **Rock.** The world's rock material is what every rock face shows under
  its rock type's color: its color's variation as grain, its Height as the
  grit the sun lights at 1x, its Shine. A rock type may name another
  (Rock types, Surface). The starting recipes each bring a library rock
  material (`rock-granite`, `-sandstone`, `-basalt`, `-limestone`,
  `-shale`): adding a preset, or a new map's world rock types, adds it
  while the map has room.
- **Worn and Deposit.** Where Time's water wore ground away or laid
  sediment down, a ground material shows its Worn or Deposit color instead
  of its Color, from the erosion level its *From* setting names, as much as
  its *Amount*. Each connected one is a layer of its own in the cache.
- A save with no materials (or an earlier format's `grounds`) loads with the
  world's own two. There is no migration.

An exported `.ufo` holds only pixels and heights: materials are baked into
its art like everything else.

## Nodes

Three types flow along wires: **coordinates** (where a pattern is read),
**gray** (one number a texel) and **color**. Gray and color mix freely in
Combine, and a gray input wired to a color reads its brightness: a Gradient
with gray stops is a curve for a height or mask. Every pattern wraps at the
512-px repeat.

| Node | Makes | Use |
| --- | --- | --- |
| Noise | gray | One algorithm a type: Smooth, Perlin (gradient noise), Billow, Cells (Voronoi), Cracks, Facets, Waves (directional: sixteen true directions from turns by small integer vectors, which keep the repeat; between two, a blend), Ridged, Pixel. Size in px, Fine detail, Broad layers, Seed. Cells, Cracks and Facets read one lattice of scattered points: Cells is bright in each cell's middle, Cracks is the distance to the nearest cell border (dark on the crack; Levels gamma rounds it into cobbles) and Facets is one flat value a cell. Their Jitter is how far each point strays (0 a square grid, .8 by default); Hex rows (1) shifts every other row half a cell, on an even row count about 1.15 times the columns, so at Jitter 0 the cells are hexagons within a few percent of regular (basalt tops, honeycomb, scale plates). Cracks at two sizes are two Noise nodes joined by Combine, Darker. |
| Scatter | gray | Shapes on a jittered lattice: dots, pits, clods, glints. Elongation narrows each across its length into a streak (scratches, gouges, blade marks), inside its radius and no thinner than about a pixel; Direction is measured as a Waves noise's is, so the same number lies parallel to its streaks, and Direction variation turns each its own way (0 aligned, 1 any way). Rim hollows each shape from a dome (0) into a bowl with a raised rim (1): craterlets, water-spot rings, pebble rims. A Density input thins them where it is dark. |
| Warp | coordinates | Bends what a Noise or Scatter reads: Turbulence or Curl flow, or Push (moves it along one Direction), or Snap (moves each position to its cell's point, on the Cells lattice with Jitter and Hex rows, so a pattern read through it is flat per cell yet keeps its broad shape; Jitter 0 gives square blocks). A By input scales the move, none where it is black: ripples shifted per Facet, bands broken along a mask. |
| Levels | gray | Stretches between Low and High, with Gamma and Invert. Bands folds the result into mirrored repeats, 1 (unchanged) to 16, continuously: agate rings, contour lines, wood and marble banding. Terracing turns the result into even Steps (2 to 16), from smooth (0) to flat shelves with sharp risers (1). Shows a histogram of its input. |
| Combine | gray or color | Mix, Add, Multiply, Subtract, Darker, Lighter, Screen, through an optional Mask. Layer offset `.5` centers a noise. |
| Height blend | gray or color | The layer shows where its height stands above the base's. |
| Gradient | color | 2 to 8 stops. A stop brighter than 1 lightens when the result multiplies another color. |
| Color adjust | color | Turns a color's hue and scales its saturation and brightness (0 leaves each); an optional Mask scales all three, so half a mask is half the turn (gradual hue sweeps, iridescence), not a blend of two colors: varies every layer at once. The material's palette limits what shows; after a large change, Pick from the material. |
| Blur | gray or color | Softens its input over Radius px (0 leaves it exactly), wrapping at the repeat; the Directional type smears along one line (its Direction measured as a Waves noise's, so the same number lies parallel to its streaks): soft halos from hard masks, dirt filling cracks, smoother heights. Gives what it reads. |
| Slope blur | gray or color | Smears its Input along its Slope's downhill direction by Distance px (uphill when negative; 0 leaves it exactly), averaging along the way; level parts of the Slope stay put. Melted or eroded rock, wind-swept sand, runnels. |
| Stamp | gray or color | Copies of its Shape over its Base: each a disc of Radius px cut from the Shape (from its middle at Variety 0, from anywhere at 1), turned and sized its own way on a jittered lattice; the topmost copy wins where two overlap, Outline roughness breaks each copy's circle into an irregular outline, Hardness sharpens their edges, a Density input thins them and a Warp on Coordinates bends their outlines. Coverage 0 leaves the Base exactly. For a color and a height that match, duplicate the node and change its inputs. |
| Light | gray | A height's slope toward a light: tints color like a lit bump. |
| Cavity | gray | Hollows (below .5) and crests (above) of a height. |
| Constant | gray or color | One value (Gray) or one color (Color), everywhere. A Color has the gradient's color fields for its one stop and publishes like a gradient's colors. |
| Material | | The one output: Color, Height (Relief scales it, in px) and Shine, plus optional Worn and Deposit colors (below). |

Keep the set small: a new node type must do what no combination of these can.
Height is art relief only; gameplay heights never change.

A graph has at most 40 nodes. Light and Cavity evaluate their input again at
four neighbors, so a material may use four of them, two in a chain. A
material may use four Blur, Slope blur and Stamp nodes in all (each needs
an input over the whole repeat).

## The palette

The game draws in 256 colors. A material lists up to 32 of them; after the
graph makes its continuous color, error diffusion over the whole repeat
reduces it to that list (`engine-ground-dither.wgsl`). Author colors
continuously in gradients and let the reduction make the palette grain. With
no list the color stays continuous and the map's final palette step picks
each pixel's color.

Two machines may place dither dots differently (rule 12).

## The editor

**Materials** in the top bar opens it; the World pane's Ground and Water
sections open it on that material. The map stops rendering while it is open.

- The graph fills the screen. Each card shows what its node makes.
- Add a node from its menu: it lists every node and type by name, and a search
  also matches the names other editors use (Perlin, Voronoi, Worley, fBm,
  terrace, posterize, HSL, displace, tile sampler, bomber, motion blur ...).
- **Starting points** (Start · … in the same menu, `materials/snippets.json`):
  twelve named looks, each two to five wired nodes with their numbers, that
  join the graph being edited at the pointer, selected and ready to tune or
  wire to the Material node. Unlike Manage's add from the library (a whole
  material), a starting point joins the open graph, and its nodes count
  toward the 40-node limit (its menu entry says how many). A few leave an
  input open for you to wire: a height (Moss in hollows) or a base color.
- Drag from an output dot to an input to connect; drag a wire off an input or
  click the input to disconnect. Dropped in the open, a wire offers the nodes
  that take it. Right-click, double-click or Tab adds a node at the pointer.
- Shift-click selects several; Frame puts them in a labeled frame. Delete
  removes, Ctrl/Cmd+D duplicates, F fits. Nodes move only when you move them
  or press Arrange.
- The preview shows the whole repeat under the world's sun (Tile), three
  repeats each way (Repeat), or a shore, a plain and a hill (On terrain); 2×
  magnifies, Node shows the selected node alone.
- **Controls**: the published settings. In the Node pane, ◆ beside a setting
  publishes it; a gradient publishes its colors. A control has its own range
  inside the node setting's: a newly published scale (a size in px) starts
  with a quarter to four times its value, and Edit controls sets a control's
  name and range or removes it.
  The World pane shows the same controls for the world's ground (Ground,
  Pattern) and water (Water & shores), live on the map, beside a chip of the
  material's color. The map is the preview there; the pane starts no second
  renderer.
- **Palette**: click a game color to put it in or out; *Pick from the
  material* chooses the colors nearest what the graph makes.
- **Manage**: rename, use as the world's ground or water, duplicate, delete,
  copy and paste (as text), New seed, Reset to library, add from the library
  or blank.

The editor holds no reference pictures and no comparison tools.

## Engine

`compileMaterial` orders the nodes and writes each as an instruction;
`programSource` turns the graph's shape into straight-line WGSL, one call a
node. A pipeline is built once per shape; node numbers sit in a storage
buffer, so a dragged control regenerates the repeat without compiling.
Light and Cavity read their height through a generated function that
evaluates only that branch at another point.

A Blur or Slope blur needs its input at every texel at once, so the graph
runs in stages (`stagePlan`): before a material's pass, each such node's
inputs are computed over the whole repeat into a scratch layer, then its pass
writes that node's layer (a Blur across then down: Gaussian, sigma half the
Radius, wrapping; a Slope blur 24 steps down its slope, kept in the stage's
alpha, averaging its input; a Stamp's Shape copied as it is, to be cut into
discs where the Stamp is read), and every later
pass (another Blur's stage, the material's pass, the node thumbnails) reads
the layer instead of the branch behind it. The stage textures
(`rgba32float`, four layers and two scratch layers, 24 MiB at 512 px) are
made the first time a material in use has a staged node, shared by all
materials (each material's stages run just before its own pass), counted in
the material cache's budget while held, and freed once no material in use
needs them. The
material's pass evaluates only the nodes its Material node reaches.

Each material in use has a layer of the cached repeat (512 px: color and
height in `rgba32float`, shine, the palette-reduced color) and one texel of
its mean color, about 7 MiB, and one more layer for each Worn or Deposit
color it draws. The budget is 128 MiB; past it, the editor keeps the
materials it has and the status line says so. The terrain shader reads these by world
position, so a level plain costs at most 256 distinct 32-px tiles.
Regeneration runs inside the draw cycle, so a fast drag never queues more
than one run a frame.

The world's own settings for level ground (low-ground tint, the vegetation
cover table, ground patches) apply over the world's ground material; a
material a stroke chose keeps its own look.

One way for each part of the look. Deep water has no color in World, Colors:
the water material is its color. Two older settings still act beside a
material and are candidates to fold into it once the owner has judged the
look: Ground bumps (`plainRelief`, lit noise on level land, above 0 in seven
worlds) beside a material's Height, and Shine, Ground gloss (`shineGround`,
above 0 on Lava) beside a material's Shine.

## Status of the shipped materials (2026-11-14)

| World | Ground | Water |
| --- | --- | --- |
| Red | owner-approved | good for now (owner) |
| Green | owner-approved | owner-approved |
| Lava, Desert, Crystal, Ice, Lush, Moon, Archipelago | patch-swapped against retail | patch-swapped against retail |
| Lush highland | patch-swapped, first pass | |
| Ice bergs ground (laid by the Ice floe tool) | first pass by eye | Ice's |
| Zhon | first pass by eye | first pass by eye |

"Patch-swapped" means two 1x1, two 4x4 and one 8x8 patches of 32-px tiles
of our export art (lit, palette-reduced) were inserted into a retail flat
or sea crop and could not be found by eye at 1x, or only faintly (Crystal,
Ice and Lush highland ground). Desert water and Moon water have no retail
sea: Desert's follows the Wet Desert planet's, Moon's is a guess. None of
these has the owner's review yet.

## Checks

- `node --test repro/materials.test.mjs`: the node model, the compiled
  program, the map's material list and its save round trips (in `quick`).
- `repro/check.sh engine`: regional replay and repeat determinism render
  through materials.
- `repro/check.sh export` and `node repro/export-bytes.mjs`: exported bytes.
- `repro/check.sh browser --server <yours> --port <cdp>`: the editor's smoke.
