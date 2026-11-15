# Materials: ground and water textures

A world's ground and its deep water are **materials**. A material is one node
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
  in `materials/<world>.json`. A variant overrides them through its `config`.
- **A map** holds up to seven materials in slots 1 to 7: exactly one is the
  world's ground, one its water, the rest are for landforms and the Paint
  brush (a stroke's Ground choice: `-1` the ground beneath, `0` the world's
  ground, else a slot). They are in the map's save, its undo steps, share
  links, and the world settings it embeds.
- **A world of your own** (World, New) keeps the map's materials, and a world
  file carries them. A new map in that world starts with them.
- A map carried into another world lets go of a ground and water still as the
  library made them and takes the new world's; ones you changed stay.
- A save with no materials (or an earlier format's `grounds`) loads with the
  world's own two. There is no migration.

An exported `.ufo` holds only pixels and heights: materials are baked into
its art like everything else.

## Nodes

Three types flow along wires: **coordinates** (where a pattern is read),
**gray** (one number a texel) and **color**. Gray and color mix freely in
Combine. Every pattern wraps at the 512-px repeat.

| Node | Makes | Use |
| --- | --- | --- |
| Noise | gray | One algorithm a type: Smooth, Gradient, Billow, Cells, Waves (directional), Ridged, Pixel. Size in px, Fine detail, Broad layers, Seed. |
| Scatter | gray | Round shapes on a jittered lattice: dots, pits, clods, glints. A Density input thins them where it is dark. |
| Warp | coordinates | Bends what a Noise or Scatter reads: Turbulence or Curl flow. |
| Levels | gray | Stretches between Low and High, with Gamma and Invert. Shows a histogram of its input. |
| Combine | gray or color | Mix, Add, Multiply, Subtract, Darker, Lighter, Screen, through an optional Mask. Layer offset `.5` centers a noise. |
| Height blend | gray or color | The layer shows where its height stands above the base's. |
| Gradient | color | 2 to 8 stops. A stop brighter than 1 lightens when the result multiplies another color. |
| Light | gray | A height's slope toward a light: tints color like a lit bump. |
| Cavity | gray | Hollows (below .5) and crests (above) of a height. |
| Constant | gray | One value. |
| Material | | The one output: Color, Height (Relief scales it, in px) and Shine. |

Keep the set small: a new node type must do what no combination of these can.
Height is art relief only; gameplay heights never change.

A graph has at most 40 nodes. Light and Cavity evaluate their input again at
four neighbors, so a material may use four of them, two in a chain.

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
  publishes it; a gradient publishes its colors.
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

Each material in use has a layer of the cached repeat (512 px: color and
height in `rgba32float`, shine, the palette-reduced color) and one texel of
its mean color, about 7 MiB. The terrain shader reads these by world
position, so a level plain costs at most 256 distinct 32-px tiles.
Regeneration runs inside the draw cycle, so a fast drag never queues more
than one run a frame.

The world's own settings for level ground (low-ground tint, the vegetation
cover table, ground patches) apply over the world's ground material; a
material a stroke chose keeps its own look.

## Status of the shipped materials (2026-11-14)

| World | Ground | Water |
| --- | --- | --- |
| Red | owner-approved | good for now (owner) |
| Green | owner-approved | owner-approved |
| Desert | study, unfinished | first pass by eye |
| Moon, Zhon, Lava, Ice, Crystal, Archipelago | first pass by eye | first pass by eye |
| Ice, "bergs" variant | first pass by eye | Ice's |

"First pass by eye" means the material was fitted against a render of the
generator it replaces until it read alike at 1x; it is not a claim of a
match, and the owner has not reviewed it.

## Checks

- `node --test repro/materials.test.mjs`: the node model, the compiled
  program, the map's material list and its save round trips (in `quick`).
- `repro/check.sh engine`: regional replay and repeat determinism render
  through materials.
- `repro/check.sh export` and `node repro/export-bytes.mjs`: exported bytes.
- `repro/check.sh browser --server <yours> --port <cdp>`: the editor's smoke.
