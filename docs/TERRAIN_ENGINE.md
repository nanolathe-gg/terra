# Terrain engine: ground, time, surface and light (design)

Agreed with the owner on 2026-10-28, and updated on 2026-10-29. It refines
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

## Decisions (owner, 2026-10-29)

After a day of designing with the editor, the owner found too many knobs,
many of which do little, and no way to override a world-wide setting for one
feature.

4. **Priority.** *"I think what I want most is everything on the GPU, a
   simplified/unified geology/surface/erosion/texture model that can still
   mimic retail terrain features, and fast progressive rendering. Those are
   by far the most important to simplify and get right."*
5. **Per-feature overrides.** A feature can override the world's settings
   around it. The owner's example: keep erosion's sand deposits around one
   feature, and lessen them around a second.
6. **Later:**
   - Artists define new base textures for a world procedurally: a world's
     base tiles made from parameters they set, not only from measured
     retail statistics. *"for now let's focus on what we have and getting
     everything on the GPU and simplified."*
   - Go and `gogpu/wgpu` wait.
   - So do the knob audit and replacing `sculpt.py`'s server.
   - The UI pass comes last.

## Decisions (owner, 2026-10-29, after H3)

7. **One vertical slice first.** *"for the purpose of proving this out we
   should do one vertical slice: green planet entirely on the GPU with the
   new mechanism."*
8. **Startup textures.** The material textures are generated at startup on
   the GPU, so the draw costs no more than sampling an image.
9. **Per-shape overrides stay as they are.** The owner has ideas that may
   change them later.
10. **Simplification waits.** *"Don't worry about simplification of the
    shader or knobs for now - if this is a problem then just use a new
    shader for the new green planet work, then we can more directly
    compare."*

11. **Scale and impact.** *"remember the scale of Nanolathe/TA because
    that is our target. We aren't 10,000 feet up in a jet where details
    are washed out. I want to see pixelated grit, boulders, rocks, gravel,
    sand, gouges, scratches, etc. The controls and sliders we keep on the
    simplified GPU simulation to control the base geology, rock types,
    weathering, etc needs to be impactful and not just change a couple
    pixels at the base of a hill that nobody would notice."*

## Decisions (owner, 2026-10-30)

12. **The Green slice is accepted.**
13. **Port first, retire after.** *"Let's continue porting the other
    worlds to the GPU before we retire things."* Every world moves onto the
    engine before the old path is deleted. One retire card at the end
    deletes it. This replaces "delete its old branches in the same card"
    for the ports.
14. **One workflow, branched by feature.** *"I prefer a single workflow,
    branching based on features not worlds/biomes, and to keep branches
    simple if possible. Whatever can be shared should be."*
    - Every world runs the same engine, one pipeline from shape to light.
    - A world is data: a preset that turns features on and sets their
      numbers.
    - Code branches on a feature or on material data, never on a world.
      Nothing in the engine asks which world it is drawing.
    - Cards are cut by feature, not by world. Each lands for every world
      that uses its feature.
15. **The end goal is still simplification.** A feature card replaces the
    worlds' separate versions of a look with one shared model and
    per-world numbers. It must hold or lower the engine's counts
    ([Rules](#rules-for-the-cards)), even while the old path waits for the
    retire card.
16. **Everything parametric; presets are only numbers.** *"I want to keep
    the parametric and procedural controls for shape, adjustments,
    weathering, etc and ideally every preset is just using those, so we no
    longer pick between the preset or parametric shape, everything is just
    parametric with modifiers like lobes, distortion, base enhancements,
    etc. One engine, one main geology control with options, slope and
    shape controls, etc."*
    - **Shape:** one parametric cross-section for every kind. Each kind's
      own curve (today's "classic", `profile` 0) becomes a preset of it,
      and the classic-or-parametric choice goes. Modifiers apply on top:
      outline (lobes, distortion), crest (jag, vary, taper, spurs), base
      (bumps, apron) and surface marks.
    - **Geology:** one main control, the rock column, with options (beds,
      hardness, dip, folds). Every world's bands, strata, rings and layers
      are settings of it.
    - **Slope and weathering:** the Surface and Time controls, parametric.
    - **A preset** (a world's or a tool's) is only values for these
      controls. Pick-one variants (the `experiment` and `variant` settings:
      forms, edges, surface, transition, material and others) become
      parameters or go.
    - **When:** during the GPU move where that is easier (Shape after H9,
      Geology in place of the layered-rock card); the rest in the
      [combine-or-drop pass](#combine-or-drop) after the retire card.
17. **Answers, and GPU differences are fine.**
    - `hillLobes` is dropped in favour of the cross-section's terraces.
    - The URL-only shape experiments are deleted.
    - `moonLobes` merges into `baseVary` and `baseBump`, if the look
      allows.
    - *"As for slight differences on the GPU version, I think that's
      totally fine. We want a similar look, tiny changes in height or
      shape or shading due to the GPU math are acceptable."*
18. **One GPU path, as soon as possible.** *"Then ASAP I would like to
    have everything use the GPU in the UI so we can delete all the CPU
    work and get on one single path that we can then optimize and move
    forward with. I do not want to worry about back compat or drag two
    render paths along with us. This is still an early stage project."*
    - Everything the UI computes runs on the GPU: shape, weathering,
      rivers and the draw.
    - Then one card deletes the CPU paths, keeping no compatibility:
      engine 0, the JS shape engine, the CPU workers, and the switches
      and fallbacks. An old save that uses a dropped option draws without
      it.
    - This brings the retire card forward, ahead of the feature cards,
      which then work on the one path.
    - The TA output's packaging (TNT, tiles, the archive) is file
      writing, not the UI. It stays as it is until an output card.
19. **The river bake is dropped.** *"Honestly we could drop the river bake
    feature for now, it's not used by any retail map biome."* The River
    and Source tools and the flow bake go in H12 instead of moving to the
    GPU.
20. **Five unused shape options are dropped.** *"drop dab fingers with
    their rib shapes, plain floe plates and mound coast layers, and keep
    mountain facets"*; *"hill facets: sure drop it"*. No scene or preset
    used them. Fingers always join the coast, plates are slabs or frost,
    coast layers are steps or scallops, and facets apply to craters and
    mountains. Their controls went in H10; their JS goes in H12.

## The Green slice

Green gets its own engine: new shaders and GPU passes for every stage,
beside the shared code. A knob, `engine`, chooses old or new, so the two
can be compared on the same scenes against retail.

1. **H4, the engine shaders.**
   - A new draw and bake for Green: material textures made at startup on
     the GPU from `materials/green.json`, the rocks from numbers too, and
     rock blocks from the column.
   - Green's water comes across unchanged.
2. **H5, weather on the GPU everywhere.**
   - Erosion must show at TA's scale: rills and gullies, debris fans,
     scree and boulders at the feet of cliffs, and sand where water drops
     it. Its controls (age, rain, hardness contrast, repose) must change
     the picture visibly at 1×.
   - The apron and sand move into the GPU pass.
   - Green never runs the CPU worker.
   - H5 covers the study and maps up to 1168 samples, where one whole-map
     pass covers the map. **H5b** takes larger maps: coarse over the whole
     map, then fine tiles, with stored planes (H2b).
3. **H6, shape on the GPU.** Green's brushes (hill, mountain, plateau,
   deep, shallow, erase, paint and the ground node) are evaluated by
   compute passes, beside the JS engine.
4. **H7, progressive rendering on the slice.** Measure where the time
   goes first. Then build the levels: overview, quarter and final.

The owner accepted the slice on 2026-10-30 (decision 12). It is now the
engine for every world ([Migration](#migration)), and the retire rule waits
for the last port (decision 13).

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
- TNT heights read the height after the agents, at 16-px corners, as they
  read today's weathered height. Material relief never reaches them.

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
- **Features override too.** A feature can carry the same overrides, which
  apply around it with a soft edge. For example, sand deposits can be kept
  around one hill and lessened around another. Painting and features write
  the same override fields.
- **Data map views.** Any data map can be overlaid. Hovering names the
  material that won and the rule that placed it. `diagnosticView` grows
  into this.
- **A fixed stage order** with a stack inside each stage, not a free node
  graph. The JSON recipe is the power-user surface.

## Migration

From decisions 13-20, in three phases.

**Phase 1: one GPU path (decision 18).**
1. **H8, merged:** every world draws with the engine and runs the GPU Time
   pass. Where a world's materials are not yet numbers, the engine reads
   its prepared images through the bridge until the Materials card.
2. **H9, merged:** every shape option that is a pass of its own runs on
   the GPU.
3. **H8b, merged:** the GPU shape on in every world's preset, so every world's
   maps are paged and fed.
4. **H10, merged:** the coast pass, water fingers,
   bank and shore plates, crystal columns and bergs, and mountain and
   crater facets. A similar look is enough (decision 17), so a GPU-shaped
   model may replace the JS algorithm: a coast distance field by jump
   flooding, for example.
5. **H12, one path:** delete engine 0, the JS shape engine, the CPU
   workers, and the switches and fallbacks. Also delete `hillLobes`, the
   URL-only experiments, the CPU sand model, and the River and Source
   tools with the flow bake (decision 19). This is the retire card,
   brought forward.

**Phase 2: features on the one path.**

1. **Features, one card each,** each landing for every world that uses it:

   | Feature | What it makes | Worlds | Separate versions today |
   | --- | --- | --- | --- |
   | Materials | each material's colour, grain, relief and shine as numbers; no run-time images | all but Green | the Python preparation per world; `shine*` |
   | Shape | one parametric cross-section for every kind, each kind's curve a preset of it, with outline, crest, base and surface modifiers (decision 16) | all | each kind's classic curve; `profile` 0 or 1; `hillLobes`, `moonLobes`, `baseVary` |
   | Geology | one main control, the rock column with options: beds, strata, bands, rings and lava layers as its settings (decision 16) | Green, Red, Desert, Archipelago, Lava | `bed*`, `band*`, `strata*`, `ring*`, `layer*`, `shelf*`, `step*` |
   | Fractures | cracks, joints, facets, blocks, gullies and scratches | all | `crack*`, `joint*`, `facet*`, `block*`, `gully*`, `scratch*` |
   | Shores | shallows, shoals, beaches, banks, coast fingers and shore plates, from one coast distance field on the GPU | Green, Red, Archipelago, Lava, Crystal, Ice, Zhon | `shoal*`, `plate*`, `shore*`, `beach*`, `finger*`, `bank*`; the JS coast pass |
   | Bodies | painted bodies of one material: crystal mounds and columns, ice slabs and shelves, lava flows | Crystal, Ice, Lava | `crystal*`, `ice*`, `frost*`, `lava*` |
   | Impacts | craters, cups, ribs, folds and pockmarks in regolith | Moon; craters in Red and Crystal | `moon*`, `crater*`, `pock*` |

   Materials comes first, since every other feature draws with them, and
   Shape follows H9. The rest follow by how many worlds they serve. Two features may share a
   card when they share most of their code.
2. **The Python material preparation** goes with the Materials card,
   once every world's materials are numbers.

**Phase 3:** the [combine-or-drop pass](#combine-or-drop).

- **Judging a world.** A world that moves is judged on its three retail
  windows (BACKLOG rule 5), by eye and by `repro/stats.py`, never only
  against its old render. Zhon has no retail windows; it is judged by eye.
- **Mask planes.** There are 25 planes in 7 RGBA layers today; 14-19 and
  25+ are free. The data maps need more. Growing the layer count is a
  bounded change, but it costs memory per chunk on 40×40 maps.

## Combine or drop

After the retire card, one pass goes through every control that is left
and combines or drops what decision 16 and the impact rule leave
redundant. The cards add candidates here as they find them; nothing is
deleted before the owner rules.

| Candidate | Found by | Why |
| --- | --- | --- |
| The CPU sand model (`sculpt-sand.js`) | H8 | No world uses it. **Delete (H12)** |
| The River and Source tools and the flow bake | owner | No retail world uses them. **Drop (owner, decision 19; H12)** |
| URL-only shape experiments: edges not natural, forms not shouldered, `replay=full`, restrained coast | H9 | No world or scene reaches them. **Delete (owner, decision 17; H12)** |
| `hillLobes` | H9 | Only one Lava scene uses it; the cross-section's terraces do the same. **Drop (owner, decision 17; H12)** |
| Dab fingers and the ribs path | H10 | Unused; the coast fingers do the same. **Dropped (owner, decision 20; H10)** |
| Plate material 0 (plain floes) | H10 | Unused; slabs and frost replaced it. **Dropped (owner, decision 20; H10)** |
| Coast layer style 2 (mounds) | H10 | Unused. **Dropped (owner, decision 20; H10)** |
| Hill facets | H10 | Unused; hills do not write the plane facets read. **Dropped (owner, decision 20; H10)** |
| `moonLobes` with `baseVary` and `baseBump` | H9 | The same outline noise; one shared GPU function now. **Merge if the look allows (owner, decision 17; Shape)** |
| Shape mask writes, and per-stroke water mask choices | H9 | Near-duplicates of the Paint tool and the World panel's water options |
| Each kind's classic curve | decision 16 | Becomes a preset of the cross-section (Shape) |
| Pick-one variants (`experiment`, `variant`) | decision 16 | Each becomes a parameter or goes |
| `talusAngle` (Green), `columnContrast` (green-3) | H5 | Under 5% of their class at the defaults |

## Rules for the cards

These hold for every H card from H3 on. For the Green slice (H4-H7) the
owner set simplification aside (decision 10). The slice kept the shared
code untouched and reported its own size for comparison. For the ports
(H8 on), deletion waits for the retire card (decision 13), but sharing
does not (decisions 14 and 15).

- **The same look, not the same bits (decision 17).** A GPU port is
  judged by eye at 1× and 2× and by `stats.py` against retail. Tiny
  differences in height, shape or shading from GPU arithmetic are fine.
  Determinism still matters: `regional.mjs` must find 0, and the same
  scene must export the same bytes on the same machine.
- **Share, don't copy (H8 on).** A card adds one shared model, with each
  world's numbers in its preset. It never adds a knob family for one world
  or a branch on a world. The renderer chooses by what data a world has,
  never by its name. **The gate,** on code with comments stripped, over
  `engine-*.wgsl`, `sculpt-gpu-fields.js`, `sculpt-erosion.js`,
  `sculpt-chunk-renderer.js` and the engine path of `sculpt-renderer.js`:
  - no `biome`, `biomeId` or `worldId`, and no world's name as a string;
  - no new knob, uniform or function named after a world. The
    world-named ones that already exist (`moonCups`, `iceHatch`,
    `crystalShallow` and the like) are listed, each with the feature
    card that renames or replaces it, and the list may only shrink.

  (`worldSize` and `worldGrid` are the map's extent, not a planet.)
- **Bridges are separate and counted.** Old per-world code that a world
  needs on the engine until its feature card lands lives in
  `engine-bridge.wgsl`, gated by the uniforms it already has. Each block
  names the card that replaces it. The counts table reports the bridge's
  lines on their own line, and the feature cards drain it to nothing.
- **Hold or lower the engine's counts (H8 on).** Each Done list reports
  them against this table (terraform 843b7fc, when the slice was
  accepted). A count may grow only through a bridge the card names and a
  later card removes, or as JS code moves onto the GPU; then the card lists
  the JS it replaces for the retire card.

  | The engine path | 843b7fc |
  | --- | --- |
  | Engine shader lines: frag, bake, common | 1,963, 1,439 and 769 |
  | Bridge lines (`engine-bridge.wgsl`) and bridged images | none |
  | GPU pass lines: shape, erosion, feed, materials, weather | 808, 249, 252, 127 and 85 |
  | Uniforms the engine reads | 351 |
  | Knobs: total, and set by worlds on the engine | 430, and 90 (Green) |
  | Worlds on the engine | 1 of 9 |
  | Retail-derived images read at run time | water only (Green) |
  | Worlds that run a CPU worker on the engine path | none |
  | Reasons a shape falls back to JS | 15 (H6c's Still open) |
- **Retire what you replace (the retire card).** It is not done until it
  has deleted what the model replaced: branches, uniforms, knobs and
  Python steps. The three-window check must pass after the deletion.
  Gating new work behind a knob and keeping the old path is how the editor
  reached 400 knobs.
- **Report how much simpler it got overall.** Put it in the Done list,
  beside the retail numbers, against this baseline (terraform 467c744):

  | Measure | Today |
  | --- | --- |
  | Shader lines (frag, bake, common) | 2,070, 1,247 and 648 |
  | Uniforms | 350 |
  | Knobs (set by Green) | 400 (79) |
  | CPU workers: weathering, sand and flow (JS lines) | 1,359 |
  | Python material preparation (lines) | 3,044 |
- **State the resolution.** Each pass says what sample spacing and tile size
  it runs at, and shows it working at a quarter of final resolution and at
  final. A pass that works at only one resolution blocks progressive
  rendering.
- **Detail at TA's scale** (decision 11). The target is close up: one
  art pixel is the unit. Each stage's output must show at 1× in the
  places retail shows it:
  - rock: chipped block edges, gouges and scratches;
  - loose ground: gravel and grit at a pixel or two, stones and boulders
    a few pixels across;
  - deposits: sand and scree where water and gravity leave them.

  Judge at 1× and 2× against retail. Statistics that match while the
  picture looks smooth or washed out is a failure.
- **Every kept control must matter.** For each control a card adds or keeps
  on the slice:
  - render green-1..3 at the lowest and the highest value an artist would
    set: not "off", because switching anything on passes;
  - run `measure/impact.py`: the share of its target class (plain, grass
    slope, rock face, or its own area) whose 16-px blocks change in mean
    luma, luma s.d. or colour, beside a noise floor. Per-pixel differences
    are not the measure: a small height change moves the same texture a
    pixel over, which changes most pixels while the picture looks the same
    (H5);
  - add its 1× crop sheet;
  - measure on the build being shipped, with its defaults.

  A main control under 5% of its class across its range, or not clearly
  above the floor, is a finding: make it stronger, or remove it. H2's erosion moved 1.8% of green-2's samples
  by more than a height unit, and H3's deposits override on a landform
  moved 0.55% of the pixels around it. That is what this rule is for.
- **Overrides from the start.** Every agent rate and placement rule is
  multiplied by its override field, which is 1 wherever nothing overrides
  it. The controls that set it per feature can come with the UI pass.

## Cards

The cards are in [BACKLOG.md](../BACKLOG.md#cards-h-the-terrain-engine).
Each is written in full when the one before it lands.

| Card | What it does | Status |
| --- | --- | --- |
| H1 | Lit relief: close shadows, cavity occlusion, stepped beds, review sun (Green) | Merged 988af93 |
| H2 | The rock column, plus GPU erosion on the 1024-px study (Green) | Merged fef3abb |
| H3 | One material model on the GPU (Green), with override fields | Merged 1c7f10d |
| H4 | The Green engine: its own shaders, startup material textures, rocks from numbers, rock blocks (absorbs H3b) | Merged 494bcf1 |
| H5 | Green's weather on the GPU at TA's scale: data maps, marks at 1 px, controls that matter (study and maps up to 1168 samples) | Merged ca0c310 |
| H5b | Large maps on the GPU, end to end: shape fields, Time pass and chunk feed in pages over 1168 samples, export on 8×8 | Merged af9207e |
| H4b | Rock blocks on hill rock (Green), judged with H5's outcrops | Merged cb57320 |
| H6 | Green's shape on the GPU: whole-map fields by compute passes, behind `gpuShape`, read through a CPU copy | Merged 48818aa |
| H6b | Chunks and the Time pass fed from the GPU fields: no CPU copy or per-chunk upload on the hot path | Merged 1fec3ce |
| H6c | The remaining shapes on the GPU: plateau first, then every palette kind; point reads by evaluation | Merged b6dc0a1 (cheap options still on JS) |
| H7 | Progressive rendering on the Green slice: measure, order the work, quarter and final levels, final pixels unchanged | Merged 1fffe4f (quarter levels and drag p95 open) |
| H7b | Quarter levels on the GPU-fed map canvas: a scaled bake, quarter while dragging and first on load, final unchanged | Merged 31e995e (latency p95 50 ms, target 30 missed) |
| H8 | One engine for every world: presets as data; the Time pass, feed, levels and pages for all; images bridged until Materials | Merged 92c1b63 (GPU shape for the other eight is H8b) |
| H8b | GPU shape for every world: why `gpuShape` moves zhon-1, archipelago-3 and red-1, and H9's map-canvas gaps; then on in every preset (pages, feed and the material field everywhere) | Merged 2be97b1 (the material field on the fed path open) |
| H10 | The last shapes on the GPU: coast pass, fingers, bank and plates, crystal columns and bergs, facets (a similar look) | Merged eb99479 (Lava's terraces a little softer; the ring clamp is H12) |
| H12 | One path: delete engine 0, the JS shape engine, the CPU workers, the switches and fallbacks, `hillLobes`, the URL-only experiments and the river bake | Next |
| H9 | Every shape option on the GPU that is a pass of its own; Desert's scenes on the GPU path | Merged a7c2256 (deep cross-section and the map-canvas gaps are H8b; `hillLobes` on JS) |
| Features | Materials, Shape, Geology, Fractures, Shores, Bodies, Impacts: one card each, for every world that uses it, on the one path | Not yet written |
| Combine or drop | Every remaining control against decision 16 and the impact rule, from the candidates list | After Retire |
| Later | The knob audit, a Go server in place of `sculpt.py`, a `gogpu/wgpu` trial, then the UI pass | Waiting |

**H3, one material model (Green):**
- **Owner, 2026-10-29:** *"work with the existing images. I'm not exactly
  sure what it's doing, but we should codify the retail information in some
  way that no longer requires it when running to keep things simple and
  allow for easy cloud development."*
- **So:** at run time the editor reads only our code and committed numbers.
  - The prepared images under `assets-*` are where the numbers are
    measured from. A measuring script stays a dev tool.
  - The material textures are made on the GPU from the numbers.
  - The owner's provenance rule from the map generator (2026-10-24):
    tables measured from retail art are fine to keep; retail pixels and
    maps are never a run-time input, and never go in git.
  - The map generator's lesson from that work: brightness plus noise never
    matched retail's palette art, but neighbour models of palette indices,
    measured per material, did. Such a model runs in raster order, so on
    the GPU it needs another form, or a different model.
- **A material** is:
  - its colour, from measured numbers: a ramp and its grain;
  - its relief generator;
  - its shine.
- **One placement function** picks and blends the materials. It reads the
  data maps (slope, height above the plain and the sea, curvature, aspect,
  flow, wear, deposit, talus) and the paint.
- **It replaces:**
  - Green's branches in `sculpt-frag.wgsl`;
  - its relief generators in `relief-bake.wgsl`;
  - its Python material preparation;
  - the material field the worker still computes on the CPU.
- **Rock relief:** H2's item 4, crisp blocks, becomes H3b. H2 showed that
  the 2-px erosion grid cannot resolve Green's beds, so the face's look
  comes from the rock's relief generator, reading the column.
- **Override fields:** one per main control. H2's erosion reads its own.
- **Where a material can't yet be made from numbers** (for example the
  plain's exact retail tiles), say which, measure the gap, and keep it
  reading its prepared image until it can.

**H6, shape on the GPU** (was H4):
- Compute passes evaluate the strokes, beside the JS engine and behind a
  switch.
- It goes brush by brush, starting with the kinds Green's windows use:
  hill, mountain, deep, erase, paint and the ground node. The JS engine
  stays the reference for the rest.
- **The guard.** Changing the arithmetic moves every render it touches.
  The switch is on only for the scenes being ported, so the other windows
  still match exactly.
- **Regional exactness** needs its own GPU check: a window replayed against
  the whole map, on one machine. Otherwise the guarantee is dropped
  deliberately, and recorded as dropped.
- **H6b** (merged 1fec3ce): chunk bakes and the Time pass read the GPU
  fields' buffers in place, through compute passes. The CPU copy now
  serves the overview, the outline, features, picking and export, and is
  not read during a gesture. The per-chunk upload is gone: drag p95 is
  16.7 ms, and chunks are final about 0.6 s after load or release.

**H7, progressive rendering** (was H5):
- **Measure first,** on a 4×4 map: where the time goes between shape
  replay, weather, the bake and the draw. Card D measured a scroll p95 of
  about 117 ms and about 2 s of refinement after release. If weather
  dominates, H5 comes first anyway.
- **Then:**
  - the three levels (overview, quarter, final);
  - coarse passes over the whole map;
  - visible tiles first;
  - the fast path while dragging.

## Constraints

- **Palette.** TA acceptance is judged on the indexed export, not the RGB
  preview. Fine relief helps, because it dithers naturally.
- **Tile budget.** A 16×16 map has 257×260 = 66,820 tile slots, more than
  the 65,536 a TNT can index. Richer detail makes nearly every tile unique.
  Phase 4 decides how tiles are reused. It does not block small maps.
- **Prototype rules.** There are no tests and no Go gates. Retail-derived
  files stay outside git.
