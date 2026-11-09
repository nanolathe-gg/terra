# Voxel terrain in the editor

The `/sculpt` editor renders every world through a transient voxel solid.
There is no height-mesh rendering option. The existing scene, stroke cards,
Rock column, undo history, world files, and exporter remain the authoring
interface.

## Shape to pixels

1. The existing GPU shape and Time passes evaluate the procedural curves,
   strokes, routes, drainage, transported material, and gameplay heights.
2. The surface bake supplies authored relief, shore detail, sand, plants,
   and paint. `sculpt-volume.js` caches this input on a global lattice.
3. `engine-volume.wgsl` builds signed density near that surface. Broken 3D
   blocks, horizontal courses, the editable column's hard and soft beds,
   pits, and runnels displace the solid along its surface normal. Steep
   walls therefore move sideways and change their silhouette.
4. Four local weathering passes read six neighboring voxels. Soft beds
   retreat faster; diffusion rounds exposed edges. This is a deterministic
   appearance model, not a mass-conserving hydraulic simulation.
5. The fixed-camera ray intersects the density field. Normals, nearby
   shadows, cavities, and rain exposure sample that same solid. Grass
   coverage follows upward-facing, rain-exposed ledges. More distant
   shadows and ambient occlusion use the authored terrain height.
6. Procedural material color, dielectric reflections, water, and the TA
   palette produce the export art. Rock color is sampled in three planes;
   its texture no longer contains a second fixed directional light.

At final 1x, a voxel is one art unit along each world axis. A vertical art
unit projects to half a screen pixel in TA's camera; this is a world-space
lattice, not a separate grid aligned to each screen. Preview and overview
use larger power-of-two voxels through the same pipeline. The final hit is
refined within the trilinearly interpolated field.

## Memory and determinism

Eight-by-eight horizontal columns hold only the vertical bricks near the
surface and the expanded camera volume. Two half-float density samples
share a word. Two density buffers alternate during weathering; the solid
is discarded between streamed pieces and never serialized or copied to
CPU memory. Only the GPU allocation count is read back.

The renderer measures the required brick count before allocating density.
It subdivides the output rectangle when a piece would exceed the terrain
budget. All pieces share integer world coordinates and an apron large
enough for the local dependencies, so partitioning does not introduce a
new random seed or a different surface. Intermediate pieces render into a
persistent texture before presentation, including across asynchronous
allocation readbacks.

`repro/voxel.mjs` checks repeated pixels, equal art under different memory
budgets, visible geometry changes in Clay, and unchanged gameplay heights.
The ordinary regional replay, scene, editor, and export checks still run.

## Existing controls

- **Surface relief and relief paint:** scale both the baked detail and the
  voxel displacement/wear. Zero is the smooth limit of the same solid.
- **Rock exposure paint:** changes natural cliff coverage as well as the
  older slope placement. Explicit Rock paint still supplies its own coverage.
- **Cut banks:** dry terrain below the surrounding plain receives the same
  voxel rock structure as raised cliffs. Flat ground keeps its base texture.
- **Rock face:** Depth, Layer thickness, Layer hardness, Layer run,
  Block relief/size, joint direction, pits, runnels, broad mass, and Grit
  shape the density. Weathering rounds and erodes the solid. The Rock
  column supplies layer hardness and deformation.
- **Grass on ledges:** covers upward-facing parts of the final surface
  when the vertical rain probe finds no roof. Coverage stays patchy.
- **Color and Layer tint:** modify albedo independently of shape.
- **Shine:** Gloss controls reflectance, Reflection sharpness controls
  polish, and Micro roughness/Grain width perturb the reflection normal.
  The specular term uses GGX, correlated Smith visibility, and Schlick
  Fresnel. Existing artistic diffuse lighting and palette mapping remain.
- **Wetness:** darkens porous rock and smooths its reflections. Painted
  wetness uses the same response.

## Boundaries of this integration

The editable source is still procedural curves plus a height lattice.
This is not a persistent, arbitrarily editable 3D voxel map: there is no
cave brush, voxel-file format, or full-volume erosion transport. That is
unnecessary for the current fixed-camera cliff and relief work.

TA still receives one gameplay height byte per 16-pixel cell. The existing
shape and Time passes supply it; voxel rock detail changes the art, not
unit movement. Large traversability changes belong in the shape controls.
The local rain and lighting probes are bounded approximations. Green is
the first tuned profile; the other worlds use the same renderer and keep
their existing data pending their own visual tuning.

## Geological rock controls

In **World → Rock & cliffs**, Geological starting point offers Layered
sandstone, Thin shale, Rounded granite, Jointed basalt, and Pitted limestone.
Each writes the same editable controls and Rock column bed thickness/hardness;
it keeps the chosen colors. These are artistic starting points, not mineral
simulation modes. One Undo restores the whole change.

Shape broad structure first with Joint spacing, Block length / width, Block
height / layer height, Rounded blocks, and Joint depth. Extrusion bias pushes
the structure outward or recesses it. Weathering rounds the solid independently
of how deeply the joints cut. Layer thickness and Hard-layer ledges shape the
coarse bedding; Fine layer relief and spacing add smaller laminations following
the column's deformation. Short grooves read as scratches; long grooves read
as water runnels. Their tilt and spacing are independent. Grit size sets the
scale of the final density detail. All of these deform the sampled 3D solid,
including steep faces.

Rock finish now sits in that same section: color variation, layer tint,
wetness, gloss, reflection sharpness, and micro roughness. Rock and bed colors
remain in the existing Colors and Rock column editors. A geological preset
changes geometry and finish but does not replace the world's ground texture.

Rock settings are numbers in the existing map recipe, autosave, share payload,
world knobs, and history. Each slider gesture is undoable. Preset names are
never sent to the renderer. Old recipes without a rock block retain the current
world settings; removed fields are ignored. Invalid values reject the load
before changing the map. Fine layer spacing, scratch direction/length, block
roundness and grit size explain which parent amount must be raised first.
