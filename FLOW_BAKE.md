# Flow bake: rivers, sediment and erosion (design, not built)

This is a one-page design for the owner. It starts from Zhon but is not
limited to it.

## What Zhon's retail art shows

The three Zhon sections in `repro/scenes/zhon-*` show a braided river:

- dark teal channels;
- maroon sediment entering from upstream and mixing into the teal as it
  goes;
- light sand bars shaped like lenses, stretched along the current, each
  with a soft shallow halo;
- streaks that follow the flow;
- banks tinted red where the sediment reaches them.

Ours has the bars as raised lumps, mottled water, red only in patches, and
no sense of a current.

The owner wants room for unique art: coloured sand deposits of any hue,
water that carries and mixes them downstream, light sand islands, a tool
for flow direction and strength, and rain and erosion applied only where
painted.

## The idea: a baked step, cached

The owner accepts that this step can be slower to edit than everything
else. Every other tool stays fast.

- **Inputs** are cheap and authored. They are ordinary nodes in the shape
  graph, replayed like everything else:
  - **River strokes** set the current's direction, with a strength and a
    width.
  - **Source dabs** set a sediment colour and an amount, either chosen or
    random within a range of hues.
  - An optional **rain mask** selects where erosion runs.
- **The bake** is one node with a region: the box around its inputs plus
  a margin.
  - It runs in a worker, like today's sand transport (`sculpt-sand.js`),
    which already carries grains downhill and drops them where the ground
    flattens.
  - It runs when the owner presses Bake, or optionally when the editor is
    idle.
  - Its result is cached under a hash of everything it reads inside its
    region.
  - An edit that changes that hash marks the bake stale. The old result
    stays on screen with a "stale" badge until the next bake.
- **Outputs** are stored planes:
  - flow direction and speed;
  - sediment concentration;
  - a height change, from bars and erosion.

  Replay reads these planes, so the editor's region-by-region redraw stays
  exact without re-running the simulation. Strokes made after the bake
  apply on top of it, so the owner can still hand-tune a bar.
- **Textures.** The editor uses all 16 sampled textures, so the planes
  become extra layers of the existing mask texture array, which is still
  one binding.

## The simulation, in three stages

1. **Current and colour.** Heights do not change in this stage.
   - Build a flow field over the water in the region. It blends the river
     strokes with the downhill direction of the bed, then projects to
     divergence-free so that water parts around islands.
   - Carry up to three sediment colours along the field until they settle
     into a steady state, mixing as they go.
   - The shader tints the water by concentration, draws streaks along the
     flow scaled by speed, and tints banks where sediment touches the
     shore.
2. **Bars.** Where the current slows (inside bends, behind islands and at
   channel splits), sediment settles and raises the bed into streamlined
   sand bars with shallow halos. Bars drawn by hand become streamlined to
   the current.
3. **Rain and erosion,** only inside the painted mask. Droplet erosion
   carves gullies and drops fans at their mouths. This also serves
   Desert, Red and Archipelago.

## Performance

- The bake's cost scales with its region. Map-sized rivers bake on a
  coarser grid (8 px) and are upsampled; flows are smooth, so nothing is
  lost.
- The map export (card D) reads the cached planes. It never simulates, so
  an export is always the same for the same bakes.

## Plan

Each stage is a card judged on zhon-1..3. A card for stage 1 alone would
show whether the look is right before heights get involved. The same
bake later gives Lava flow streaks, Green and Archipelago silt, and
Desert dry washes.

## Decisions (owner, 2026-10-28)

1. **Sediment colours** use a free colour picker. It suggests colours (for
   example from the world's palette) and remembers colours used before.
2. **Stages:** stage 1 changes colour only. Bars and erosion come in
   stages 2 and 3.
3. **Baking:** an explicit Bake button with a stale badge. Baking when
   the editor is idle is an option.

## As built, stage 1 (card F1)

Stage 1 is in: the River and Source tools, the Bake button with its stale
badge and the idle option, and shading in the water path. What the code
settled where this page left it open:

- **Nodes.** `river` and `source` write nothing; one `flowbake` node stores
  the bake's output (five Int8 planes over its rect, the sediment colours,
  the hash) and replay copies the planes in. The bake reads the heights
  *before its own node*, so strokes after it do not feed it.
- **Planes.** Mask planes 20-24 (layers 5-6): the current's x and y (the
  direction times the square root of the speed), then the concentration of
  up to three sediments; on land within the bank reach the sediment planes
  carry the stain fading from the shore, which tints banks. Planes 25-27 are
  free for stage 2's height change.
- **Hash.** Region, every river and source (points, widths, amounts,
  colours), the bake settings, the sea level and the region's heights.
- **Solver.** `sculpt-flow.js`: a wish field from the strokes and the bed, a
  staggered-grid pressure projection (land a wall, the region's edge open),
  then advection, mixing and settling per colour to a steady state, on a
  coarse grid for large regions (6 px cells for a full 1024 px map, about
  0.9 s).
- **Not yet:** more than three colours (the fourth joins the nearest), the
  rain mask, stages 2 and 3, chunked baking for maps larger than the grid.

Per-scene bake times and memory, the export's reading list and the open
items are in the card's NOTES.md.
