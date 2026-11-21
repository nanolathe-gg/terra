# Surface layers: where each material shows

A world's **surface** is an ordered list of layers, bottom to top, over its
ground. It decides which material shows at each pixel: soil, grass, moss,
sand, snow, scree, rock. The model lives in `sculpt-material-model.js`, the
rule evaluator in `engine-common.wgsl` (`surfaceWindows`, `surfaceScore`),
the draw in `engine-frag.wgsl`, plant placement in `engine-bake.wgsl`
(`plantMask`), and the panel in `sculpt-surface-panel.js`.

## The model

| Part | What it is |
| --- | --- |
| Material | What it draws: a library material (the map's copy, shared by every layer that draws it), or, for a built-in, its role material or its rock type's rock. |
| Coverage | (stored as `amount`) The share of its area it covers, 0 to 1. Each covered pixel is at full strength (TA's look), laid by its edge's pattern. |
| Spread | (`spread`, -1 to 1) Moves every limit of the rule together, so "more of this" widens where it may show. Packed into the rule rows (`spreadRule`), so 0 packs the rule as written. |
| Rule | Where it may show. **Windows**: up to four facts, each with a from–to range and a fade, all of which must hold. **Score**: up to four weighted facts, summed, past one threshold with a fade (steep *plus* convex). Or none: everywhere. |
| Edge | How it meets what is below: width (1 a soft mix, near 0 one material a pixel), noise and its size (speckle at 1 px, patches above), and height contrast (the taller material wins at the edge). |

**Facts** are what the engine measures at a point (`SURFACE_FACTS`): slope,
height above the sea and the plain, wear, deposit, wetness, moisture, soil
depth, sunlight, top (lump or hollow), convexity, the rock, debris and sand
shares, which way the ground faces (north and east, signed), how sheltered
it is, and distance to water. The last two look around the pixel, so the
draw computes them only where a rule reads them (`SURFACE_LOOKS`). A fact is
engine code; a rule over facts is world data. Adding a fact is how the model
grows.

**Effects stay engine features**, applied at fixed points: lighting, cast
and crease shade, wet darkening, cracks, boulders, chips, the rock skin,
crystals, surf foam and water. They change how a surface looks; they do not
choose a material.

## Built-ins and material layers

- **Built-in layers** are the surfaces the engine places itself (rock,
  highland ground, base band, slope cover, beach, bare soil, sand, debris
  fines, moss, snow and others), in fixed stages (`SURFACE_STAGE_NAMES`). A
  rule on a built-in limits its own share. Each built-in row lists the World
  settings that place it (`BUILTIN_PLACED_BY`), with a link to each.
- **Built-ins draw materials (phase 4).** Every engine surface draws a
  material: soil, the base band, moss, snow and sand draw the world's
  `@soil`, `@band`, `@moss`, `@snow` and `@sand` (`world.materials`); highland
  ground, slope cover, beach and debris fines draw their role materials; rock,
  crown rock, painted rock and chips draw each rock type's rock. A built-in in
  `SURFACE_DRAWABLE` may name another library material
  (`{"builtin": "sand", "material": "desert-sand"}`), laid by the built-in's
  own share.
- **Material layers** draw a library material by Coverage times their rule.
  Presets include snow above a height, moss in damp shade, scree on steep
  ground, dry ground on sunny slopes, mud in wet hollows, flowers in wet
  ground, and low ground by the water.
- **Plants grow on layers.** A material layer may grow one kind of plant
  (grass tufts, meadow tufts, moss cushions, shrubs) at a Plant density where
  it shows, or grow plants alone. Lushness and a stroke's Local vegetation
  scale them. Built-ins neither grow nor cover plants.
- **Tones, not separate colors.** Rock beds (strata) are tones of the rock
  material, and shallow water is a tone of the water material
  (`shallowTone`), so recoloring the material moves them with it. A
  material's Color (`recolorMaterial`) shifts all its color steps at once.

## Where the list lives

Each world ships a stack in `materials/<world>.json` (`world.surface`), or
uses the shared default (`materials/defaults.json`, `surface`). A new map
starts from it, and the map saves its own whole: a revision of the built-in
stack never changes a map already made. A material copy whose layer no
longer draws it leaves the map unless a stroke or rock type uses it
(`surfaceMaterials` in `sculpt-materials.js`).

## The editor

World › Surface lists the layers top first, in three sections: drawing in
this world, only where painted, and cannot draw yet (each idle layer with its
reason and a link to the setting that turns it on, `SURFACE_NEEDS`). A row
opens to its material, Coverage, Spread, rule and edge.

- **Seeing it:** pointing at a row stripes the map, magenta where the layer
  shows and cyan where a later layer covers it. Rows can be hidden or
  soloed; export ignores that. Pointing at a condition shows its fact over
  the map in gray, magenta where it holds, with a histogram.
- **Pick** (key I) lists the layers that drew a pixel, with their coverage,
  materials and facts. **Show here** and **Not here** move the smallest rule
  limit that makes a layer appear or disappear there (`ruleToShow`,
  `ruleToHide`), as one undo step, or say why no limit can.

## Limits

- At most 32 layers (`SURFACE_MAX`). Their rows live in the material
  table's first 151 rows (two per layer plus one per rule row), with the
  flags and head rows at 151 and 152.
- Materials share the map's 23 slots and the material cache's budget
  ([MATERIALS.md](MATERIALS.md)).
- Plants know only the facts the bake has (slope to top), not the shares or
  convexity, and their density is one value per 4-pixel cell.

## Open questions for the owner

- Per-world edge settings wait for the next biome tuning round.
- Highland ground, base band and the rock face keep their World rows rather
  than becoming rules, because their share also sets art relief and caps the
  beds outside the layer stages.
- Judge by eye: Crystal's flatter tops, the plant presets, and the low ground
  preset's material and reach.
