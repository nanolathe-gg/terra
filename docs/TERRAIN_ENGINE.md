# Terrain engine: ground, time, surface and light (design)

Agreed with the owner on 2026-10-28. It refines
[PLAN_TERRAIN_EDITOR](PLAN_TERRAIN_EDITOR.md) §5 (the parameter model) and
§6 (the target pipeline). Those sections remain the target. This page says
what changes now, and in what order.

## Decisions (owner, 2026-10-28)

1. **Output.** TA is the only output for now. Later the engine may become a
   general terrain generator, with TA as one output plugin. Keep that
   boundary clean from the start ([Outputs](#outputs)).
2. **Drift.** A world may drift from today's renders when it is ported.
   Neither matches retail fully, and getting closer means changing it. A
   ported world is judged against its three retail windows (BACKLOG rule
   5), not against its old render.
3. **Order.** Card H1 (lit relief) first, then H2 (rock column and erosion).
   Green goes first. The engine must also make ice shelves, crystal mounds
   and shores, not only rock geology, so keep the other worlds in mind.

## Why change

Each look so far was a card of code, matched to retail by measurement:

- `sculpt-frag.wgsl` is 2,032 lines with a branch per world: moon cups, ice
  hatch, and the desert grey band at 4-6.5 above the plain.
- It has 348 uniforms, fed by per-world `WORLD_KNOBS` and per-world
  material scripts.
- `relief-bake.wgsl` adds 1,247 lines of relief.

Measuring was the right way to calibrate. But every new rock type, grass,
sand or snow becomes yet another branch. Two limits also stand out:

- **Relief is only partly lit as geometry.** In baked-relief mode,
  `surfaceHeight` adds the bake's relief, and the projection, normals and
  occlusion all read it. But the cast-shadow taps start 3.4 px out and the
  occlusion taps 8 px out. So a 1-3 px ledge never shades the ground below
  it, and a crevice is only as dark as its normal makes it. Painted Desert
  strata are colour bands by height. Moon pits and ribs, ice hatching and
  slope marks are gradients or ink, not height.
- **Erosion is local.** `sculpt-weathering.js` is a CPU droplet worker.
  Maps over 1168 samples run it in independent 256-cell tiles with a
  128-cell apron, so no drainage reaches further than one apron.

## Five stages

```
Shape  →  Ground  →  Time  →  Surface  →  Light  →  outputs (TA)
strokes   materials  agents   cover and   one lit    palette, tiles,
          at (x,y,z) acting   loose       surface    TNT, features
                     on them  ground
```

### Shape

This is the stroke graph as it is: sections, ridges, fissures, shore
bands, craters, rivers. It makes the authored height, which is the only
height TNT sees.

### Ground: bodies of material

**A material is data:**
- its kind: layered rock, massive rock, ice, crystal, loose, or lava rock;
- a colour ramp and grain;
- its resistance to each agent;
- an angle of repose;
- what it breaks down into;
- a relief generator;
- its shine.

**Ground answers "what material is at (x, y, z)".** It is built from:
- a column of beds, each with a thickness, a material and a hardness;
- tilt by dip and direction;
- warps from folds and faults;
- painted bodies that replace the column inside them: a granite dome, a
  crystal mound, an ice shelf, a basalt flow.

Ground is a pure function of position, so it tiles for free and regional
replay stays exact.

**Relief generators already exist** as bake functions; they move behind
materials:
- beds and joints (`bedRelief`, `jointField`, `cliffFrame`);
- facets, cracks, gullies and scratches;
- Moon cups, ice slabs and floe lines, crystal prisms.

A bed's hardness sets how far its riser stands out.

### Time: agents acting on materials

The agents are water (rain and flow), gravity (talus), frost, wind, waves at
sea level, and heat (lava). Each material says how it responds:

| Look | Ground | Agents and response |
| --- | --- | --- |
| Green mesa with benches | sandstone and shale beds | water and gravity: hard beds stand as cliffs, soft beds retreat to slopes, talus collects under ledges |
| Rocky coast and beach | any rock at sea level | waves: a notch and a wave-cut platform set by hardness; sand settles in quiet bays |
| Ice shelf | an ice body at the shore | waves and frost: a calving face, shelf lines along the shore, bergs |
| Crystal mound | a crystal body | inert to water; frost and gravity shed shards round it |
| Lava field | lava rock | heat: flow lobes, a cooling crust, cracks |
| Moon | regolith over rock | impacts (shape tools) and gravity: pits, slumped rims |

**Every agent follows the flow-bake pattern**
([FLOW_BAKE](../FLOW_BAKE.md)):
- a region with a margin;
- a hash of everything it reads;
- a Bake button and a stale badge;
- stored output planes, which regional replay copies.

Water runs on the GPU as a compute pass. A coarse pass covers the whole map
for drainage, then fine tiles with aprons add the detail.

**Agents write data maps:** flow, wear, deposit, talus, wetness, snow, soil
depth and exposure. The existing workers (droplet weathering, sand, flow)
become agents. The droplet worker stays until the GPU agent is at least as
good.

### Surface

Two families of material lie on the ground:
- **loose:** scree, gravel, sand, soil, mud;
- **cover:** grass, moss, lichen, snow, ash.

**Each has a placement rule over the data maps and paint:**
- slope, height above the plain or the sea, curvature, aspect;
- flow, wear, deposit, wetness, exposure.

Blends compare the materials' own heights, so snow fills cracks first and
grass grows between stones. Loose and cover materials have relief and shine
like the ground. The TA output places features (trees, rocks with metal)
from the same maps.

### Light

**One surface:** authored height, plus the agents' changes, plus every
material's relief.

**Readers:**
- Normals, cast shadow, occlusion, shine and the art projection all read
  this surface.
- TNT heights read only the authored height at 16-px corners. That export
  contract does not change.

**Shadow** has two ranges:
- **close**, 1-6 px, so a ledge shades the ground beneath it;
- **far**, today's taps.

**Occlusion** also has two:
- **cavity**, 1-3 px, for crevices and floors;
- **broad**, today's ring.

**A movable sun, for review only:** if the geometry is right, it looks
right from any sun, while ink gives itself away. The TA output keeps the TA
sun.

## Outputs

**The engine's result is fields at the final level:**
- height;
- material weights;
- data maps;
- lit colour.

**Everything TA-specific belongs to the TA output:**
- the palette stage;
- 16-px corner heights;
- 32-px tiles and their reuse (Card D phase 4);
- the feature catalogue;
- OTA settings;
- the `.ufo` archive.

Later outputs, such as a 16-bit height, data maps, and colour or normal
maps, would read the same fields. Nothing in the engine should assume the
palette.

## Progressive rendering

- **Any resolution.** Every stage is defined in world units, so it runs at
  any resolution. There are three levels:
  - overview, the existing 128×128 preview;
  - preview, a quarter of final resolution;
  - final.
- **While dragging:**
  - Shape updates live.
  - The agents keep their last result under a stale badge.
  - Light takes the fast path (`u.full` already halves the taps).
- **On release, or when idle:**
  1. the coarse whole-map passes run;
  2. the visible tiles refine to final;
  3. then the rest.

  Each tile shows its level.
- **Exactness.** The final level is exact under regional replay
  (`repro/regional.mjs`), because agents store their planes. The preview
  levels are approximate. Export waits for final, so GPU float differences
  between machines never reach an export.

## Usability

- **Panels follow the stages:** Shape, Ground, Time, Surface and Light, then
  Features and Export. To find out why something is where it is, you look at
  the stage that put it there.
- **At most five main controls a panel,** in artist terms:
  - Ground: column preset, hardness contrast, dip;
  - Time: age, rain, wind (direction and strength), frost line;
  - Surface: vegetation, and the list of materials;
  - Light: the review sun, and shadow and occlusion strength.

  Everything else goes behind Advanced, or on a material's own card.
- **Libraries instead of knobs.** Materials and biomes come with swatches
  rendered by the engine. The TA worlds become biome presets holding today's
  tuned values (PLAN §5.3).
- **Paint to override.** Any main control can be painted locally: older
  here, wetter here, granite here. This generalises PLAN §5.1's shape
  override and FLOW_BAKE's rain mask.
- **Data map views.** Any data map can be overlaid. Hovering names the
  material that won and the rule that placed it. `diagnosticView` grows
  into this.
- **A fixed stage order** with a stack inside each stage, not a free node
  graph. The JSON recipe is the power-user surface.

## Migration

- **Build beside the per-world code.** Port one world at a time. Retire a
  world's old branches only when its preset is at least as close to retail
  on all three windows: by eye, and by `repro/stats.py`.
- **Unported worlds** must keep matching their renders exactly under the
  `compare.py` guard, as now.
- **Order of worlds:**
  1. Green;
  2. then probably Red and Desert, which share the layered rock;
  3. Archipelago (shores), Ice (shelves), Crystal (mounds), Lava and Moon.

  Zhon waits for its planet.
- **Mask planes.** There are 25 planes in 7 RGBA layers today; 14-19 and
  25+ are free. The data maps need more. Growing the layer count is a
  bounded change, but it costs memory per chunk on 40×40 maps.

## Cards

The cards are in [BACKLOG.md](../BACKLOG.md#cards-h-the-terrain-engine).

| Card | What it does | Status |
| --- | --- | --- |
| H1 | Lit relief: close shadows, cavity occlusion, stepped beds, review sun (Green) | Merged 988af93 |
| H2 | The rock column, plus GPU water and gravity agents (Green) | Outlined |
| H3 | Material table and placement rules (Green) | Not yet written |
| H4 | Panels, presets, painted overrides, data map views | Not yet written |

## Constraints

- **Palette.** TA acceptance is judged on the indexed export, not the RGB
  preview. Fine relief helps, because it dithers naturally.
- **Tile budget.** A 16×16 map has 257×260 = 66,820 tile slots, more than
  the 65,536 a TNT can index. Richer detail makes nearly every tile unique.
  Phase 4 decides how tiles are reused. It does not block small maps.
- **Prototype rules.** There are no tests and no Go gates. Retail-derived
  files stay outside git.
