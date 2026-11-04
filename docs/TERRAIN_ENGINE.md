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
      allows. H21 part 1 retains it: fresh trials lose face folds; the foot
      controls have different support and scale ([evidence](audit/IMPACTS.md#moonlobes-ruling-keep)).
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
21. **The study view is retired.** Asked whether to keep the 1024-px
    study (a second editor mode that previewed strokes with the JS engine
    and drew from CPU copies), the owner chose to retire it: the editor
    always works on a map, `/sculpt` opens a default map, and the test
    scenes render as a window on a map. One stroke path, one draw path.

22. **Retail is the gold standard.** *"remember the retail shots are the gold
    standard, and if our noise or other things change before/after but don't
    substantially move us away from retail then it's fine. We still have some
    refinement to do to perfectly match retail. You have freedom to make some
    changes and have the outputs change while still trying to work toward the
    retail biome looks."* (2026-10-31)
    - A card is judged against each world's retail windows. A difference from
      the last merge says what moved, not whether it is acceptable.
    - A card may change its output when that keeps or improves the match to
      retail, without asking. Steps that only move code keep 0.00 as their check.
    - The retail palette is fine in the repo as a table
      (`materials/palette.json`).

23. **One curve for every shape.** *"Can't a single slope curve plus e.g.
    radius-to-height curve controlling the distance from the drawn line at a given
    height a feature goes represent everything from small smooth hills to large
    cliffs to peak covered mountains to large flat plateaus? Then we can add sliders
    for variability in various dimensions, add things like stratification, etc and
    get all kinds of unique features. Craters and crystals obviously stay separate,
    but this should cover a lot of the geology shouldn't it? ... I guess for the
    asymmetrical nature we would need another control as that's a totally separate
    axis."* Then, on the plan: *"Okay go ahead with that"* (2026-10-31).
    - A slope curve and a radius-to-height curve are one curve seen two ways, so
      there is one: height at each distance from the line. Hills, cliffs, peaks,
      plateaus and mesas are presets of it, and a preset is only its numbers.
    - Lean and facing are the separate axis. Variability and strata go on top.
    - This replaces fitting numbers to today's cross-section. Decision 16 stands;
      this is how Shape meets it.

24. **Landform: one path tool, fixed elevations.** After trying the landform
    playground (a throwaway prototype on `prototype/unified-landform`): *"I
    agree we need one engine, one editor, replacing/simplifying controls,
    etc. I would do this as a new tool until we are confident it could later
    replace the existing plateau/hill/etc tool. For the decision: fixed
    elevations with raise-to, cut-to, and flatten-to modes sound good."*
    (2026-11-02)
    - A landform's crest is an absolute elevation. The landform raises the
      ground to it, cuts the ground to it, or flattens the ground to it.
    - It is a new tool beside plateau, hill and mountain until it can replace
      them. Then their controls go (card H27 lists which).

## Decisions (owner, 2026-11-04, on the terrain research brief)

The brief (`docs/research/README.md`, cards P1-P24) proposed a more modern,
realistic look in the same palette and asked four questions (D1-D4).

25. **A modern Green, first and alone (D1).** *"For now let's just add a
    modern green planet and see how that goes. We can add other modern
    biomes later."*
    - Green gets a `modern` variant (`WORLD_VARIANTS['green']`), on the one
      engine: only numbers, colours and config, like every variant.
    - The modern variant is judged on green-1..3 for palette, scale and
      readability at 1x, and by eye for realism. The checklist:
      - drainage that branches;
      - rock that breaks along its beds and joints;
      - debris where gravity and water leave it;
      - light that agrees from any sun.
    - Retail presets keep rule 10: a change keeps their bytes or moves them
      toward retail. No other world gets a modern variant yet.
26. **One stored whole-map drainage pass (D2).** *"yes"*: a coarse
    whole-map drainage plane (exact area by Euler tour, card P21). It
    follows the flow-bake pattern: a hash of its inputs, a stale badge,
    stored planes that regional replay copies. Dunes and stream power (P19,
    P8) stay out until a modern world asks for them.
27. **The merges that remove controls, with the removals (D3).** *"Yes we
    should do it, including the removals"*:
    - Gullies replaces the eight `spur*` rows, `heightVar` and `crestJag`
      (P1).
    - Supply, Size and Sorting replace the boulder, debris, stone and scree
      rows (P16).
    - The rock model's Size, Age and Open joints replace `blockWidth`,
      `blockRow`, `blockChip`, `blockSeam` and `jointDepth` (P10).
    - Each card removes what it replaces once every world's preset is
      re-expressed in the new rows and the retail windows hold. An old save
      loads without the removed keys (rule 7).
28. **Pipelines specialized by data are fine (D4), and the order of work.**
    *"They are probably fine. Prefer generic shared tools first, then speed,
    then whatever after that."*
    - `override` constants that specialize one shader source by a world's
      fixed numbers count as one render path (P6).
    - Cards go in this order:
      1. generic shared tools: one mechanism that many looks and worlds use;
      2. then speed;
      3. then the rest.

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
  Above final, the editor's zoom bakes at the screen's pixels (a level of
  .5 up to 200% and .25 beyond): the material grain and the dithers advance
  one texel per drawn pixel, so the pattern comes out smaller with the same
  grain, and everything else (marks, shapes, heights) stays in world units.
  The relief fields stop at 2x, and a level bakes only what is seen. A level
  whose view does not fit the GPU budget falls back to the next coarser one.
  Which ground pixels land where differs per level; a retained image at
  another level is replaced, so 100% is always the 1x picture. Export never
  asks for a detail level.
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

From decisions 13-21, in three phases.

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
5. **H12 and H12b, merged (phase 1 complete):** delete engine 0, the JS shape engine, the CPU
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
   | Geology | one main control, the rock column with options: beds, strata and bands as its settings; rings stay a stack and lava layers go to Shores (decision 16, H16) | Green, Red, Desert, Archipelago, Lava | `bed*`, `band*`, `strata*`, `ring*`, `layer*`, `shelf*`, `step*` |
   | Fractures | cracks, joints, facets, blocks and gullies | all | `crack*`, `joint*`, `facet*`, `block*`, `gully*` |
   | Shores | shallows, shoals, beaches, banks, coast fingers and shore plates: H10's coast distance field for what asks distance, depth or height for the rest (H18) | Green, Red, Archipelago, Lava, Crystal, Ice, Zhon | `shoal*`, `plate*`, `shore*`, `beach*`, `finger*`, `bank*`; the JS coast pass |
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
deleted before the owner rules. `docs/audit/controls.csv` is the evidence
for each control as of c4b1b80; it goes stale as cards delete knobs.

| Candidate | Found by | Why |
| --- | --- | --- |
| The CPU sand model (`sculpt-sand.js`) | H8 | No world uses it. **Delete (H12)** |
| The River and Source tools and the flow bake | owner | No retail world uses them. **Drop (owner, decision 19; H12)** |
| URL-only shape experiments: edges not natural, forms not shouldered, `replay=full`, restrained coast | H9 | No world or scene reaches them. **Delete (owner, decision 17; H12)** |
| `hillLobes` | H9 | Only one Lava scene uses it; the cross-section's terraces do the same. **Drop (owner, decision 17; H12)** |
| `sandReach`, `windStrength`, `sandPatchy`, `sandTail`; the fringe texture selector; broad crevice darkening | audit (`docs/audit/TOOL_AUDIT.md`) | Disconnected or ineffective, or left off since experiment 4. Hidden from the UI. **Owner merged the audit, 2026-10-31.** Their keys go in the pass below, with no compatibility reading (decision 18). **Dropped (H22)** |
| Dab fingers and the ribs path | H10 | Unused; the coast fingers do the same. **Dropped (owner, decision 20; H10)** |
| Plate material 0 (plain floes) | H10 | Unused; slabs and frost replaced it. **Dropped (owner, decision 20; H10)** |
| Coast layer style 2 (mounds) | H10 | Unused. **Dropped (owner, decision 20; H10)** |
| Hill facets | H10 | Unused; hills do not write the plane facets read. **Dropped (owner, decision 20; H10)** |
| `moonLobes` with `baseVary` and `baseBump` | H9 | The same outline noise; one shared GPU function now. **Merge if the look allows (owner, decision 17).** H15 tried it and the result was mixed; the Impacts card settles it |
| Shape mask writes, and per-stroke water mask choices | H9 | Near-duplicates of the Paint tool and the World panel's water options |
| Each kind's classic curve | decision 16 | **Replaced by one curve (owner, decision 23; H15)** |
| Pick-one variants (`experiment`, `variant`) | decision 16 | Each becomes a parameter or goes |
| `talusAngle` (Green), `columnContrast` (green-3) | H5 | Under 5% of their class at the defaults |
| The Ground pattern list and `groundTiles` | H14d, H14e | Nine worlds to six: Red, Crystal and Archipelago have quilted plains and no tiles to lend |
| The `rim` URL knob; the bridge's fringe, ring, beach and body knobs | H14e | No longer name an image; the Shores, Bodies and Geology cards may settle them first |
| Keys in each table's `world.defaults` that nothing registers: `noise`, `rock`, `fingerBlunt`, `hillLobes`, `lavaTread` and others | H14e | Carried verbatim from the old configs; not audited |
| The `shine*` knobs | H14e | All in `KNOB_DEFAULTS` or `WORLD_KNOBS`; none moved to a table |
| The eight `spur*` rows, `heightVar`, `crestJag` | research P1 | Gullies grows spurs and crest breaks from the fall line. **Replace (owner, decision 27)** once every preset is re-expressed |
| The boulder, debris, stone and scree size and density rows (`boulderSize`, `boulderFoot`, `boulderCluster`, `debrisSize`, `debrisReach`, the scree and stone rows) | research P16 | One scatter: Supply, Size, Sorting. **Replace (owner, decision 27)** |
| `blockWidth`, `blockRow`, `blockChip`, `blockSeam`, `jointDepth` | research P10 | The rock model's Size, Age and Open joints. **Replace (owner, decision 27)** |

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
- **Hold or lower the engine's counts (H8 on).** Each Done list reports
  them against this table (terraform 843b7fc, when the slice was
  accepted). A count may grow only as JS code moves onto the GPU; then the card lists
  the JS it replaces for the retire card.

  | The engine path | 843b7fc |
  | --- | --- |
  | Engine shader lines: frag, bake, common | 1,963, 1,439 and 769 |
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
| H12 | One path: delete engine 0, the JS shape engine, the CPU workers, the switches and fallbacks, `hillLobes`, the URL-only experiments and the river bake | Merged bfabbab (groups 2-8) and e08ebd7 (H12b) |
| H12b | Retire the study (decision 21): scenes render on a map, `/sculpt` opens a map; delete the study, the JS shape engine and the CPU draw; errors surface; the simplification report | Merged e08ebd7 (Lava and Ice 8×8 over the 512 MB GPU budget open) |
| H9 | Every shape option on the GPU that is a pass of its own; Desert's scenes on the GPU path | Merged a7c2256 (deep cross-section and the map-canvas gaps are H8b; `hillLobes` on JS) |
| Features | Shape, Geology, Fractures, Shores, Bodies, Impacts: one card each, for every world that uses it, on the one path. Materials is H14, Shape is H15 | Each written when the one before lands |
| Combine or drop | Every remaining control against decision 16 and the impact rule, from the candidates list and the lists on cards H16, H17 and H18, all on one sheet: `docs/audit/COMBINE_OR_DROP.md` | The sheet is ready; Bodies and Impacts add their rows, then the owner rules |
| H13 | GPU memory on 8×8 maps: Lava and Ice within the default budget | Merged fa83b11 |
| H14 | Materials: every world's images become numbers, with water, noise and the palette; the Python preparation goes | Complete: part 1 merged 1fcaafd (the inventory, Moon); H14b to H14e did the rest |
| H14b | Materials as lit height fields: one generator with facets, seams, veins and any stretch angle | Merged fe068a1 (Crystal and Archipelago swatches failed; H14c) |
| H14c | The three swatch fixes (slabs, fine streaks, strokes), then the seven other worlds on their tables | Merged 703148c: Moon's rock, Ice, Lava, Zhon and Desert moved; Red, Crystal and Archipelago on images |
| H14d | The art's dither (hue is error-diffused per pixel), then Red, Crystal and Archipelago | Merged b136359: all nine worlds on tables |
| H14e | Water, noise and the palette as numbers; the image bridge and the Python preparation go; a server with no world images draws every world | Merged c33bec2: a fresh clone on stock Python draws all nine worlds; `fractures.png`, ours, is the one image left |
| H15 | Shape: one curve for every kind (decision 23), with lean, facing and shared variability; each world's forms measured from retail | **Done.** One curve table for every kind, knots and forms, lean and facing, variability sliders, a curve editor. Measured retail's slopes (`measure/fit_forms.py`) and kept no world form: its heights are too coarse to set one, so the shared forms stand |
| H16 | Geology: one rock column, with every world's bands, strata, rings and layers as its settings (decision 16) | **Done.** One `column` block per world for beds and strata (Green's rock, Desert's colours and ledges on one coordinate, `triad` a row of the block), and a step and line strength for its contour bands. 83 knobs to 77, three tables to one. Windows the same as main, nothing newly outside retail. Rings stay a stack, layers go to Shores (a departure from decision 16's wording). The dead and weak controls, with numbers, are listed on the card for combine-or-drop |
| H17 | Fractures: one groove function and one cell function for cracks, joints, gullies, scratches, facets and blocks, then the marks toward retail | **Done.** One `groove` for joints, gullies and scratches (a family owns its half-width and salt beyond its sliders), one `cells` search for facets and blocks; `fractures.png` draws nothing and goes on the owner's list; green-2's slope closer by two numbers, and five other marks need code, not numbers |
| H18 | Shores: the bridge's beach on the engine's path, who asks how far the water is, then the marks toward retail | **Done.** Most shore marks ask depth or height, not distance, so one coast read was dropped: H10's field serves what asks distance, and a second flood for Zhon's beach and Lava's rim would add code. The four bridge blocks are gone; Archipelago's bars closer by one number; four other targets need code or a colour table |
| H19 | Face relief: lit rock on walls the camera stretches, from the owner's prototype, on one path with one control | **Done.** The rock's height gradient is cached at startup and lit in screen pixels on walls that face the viewer, with the fine normal, crack code and cavity giving way there. One knob, `faceRelief`, Desert .4 and Moon .5. Crowns, gentle slopes and painted level tops keep main's look |
| H20 | Bodies: one cell search for crystal, ice and lava where they ask one question, the bridge's two blocks, then the marks toward retail | **Done.** One `markCells` in the draw, `cells` with a third distance in the bake, shared lattice code in the shape stage: 5,038 to 4,976 lines, no pixel moved. The two bridge blocks are gone. Ice-1's band reads closer and Crystal's mosaic ends in a fringe; ice-3's block and lava-3's hills need a table or code, and Crystal's cell size is the owner's call. 21 knob states are on the combine-or-drop sheet |
| H20b | Crystal plates: 28 px, with some variety | **Done.** `plateSize` 28 (the owner's ruling), `crystalShoreScale` out of Crystal's settings, and a stroke option `plateVary` (Crystal .5): wet plates break into a fine mesh in patches, +11 shader lines. 0 is every world and every saved map as before. Crystal-3's band reads closer; three `stats.py` cells go newly outside retail, from the 28 px; the hairline seam needs code |
| H21 | Impacts: craters, cups, ribs, folds and pockmarks on one path, and `moonLobes` settled | **Done.** 31 controls measured, `moonLobes` stays, the marks share one visibility term. Crystal-1's crater web and contrast read closer by two values; Moon and Red retain their settings. 14 Impacts rows on the combine-or-drop sheet, with the unreachable targets below |
| H22 | Combine or drop: the nine removals the owner approved | **Done.** The four retired sand settings, the thirteen leftover table defaults, `crystalShoreScale`, the Fractures slider with its image and texture binding, `bedFlow`, bed mottle, Lava's bank lines and rock scratches: 18 keys out of `KNOB_DEFAULTS` (406 to 388), 146 shader lines out and 27 in (the joint and bed branches became one), 214 lines of `make_fractures.py` and a 140 KB image gone. 24 of the 27 windows byte for byte; Green's scratches moved green-2 .43 mean abs diff and green-1 and -3 under .01, and the panel names why a setting is idle where a removal left it so. Ice's three Icy Bergs values stayed: they draw on Ice's default Crystals stroke |
| H22b | Every control does something, or says why not | **Done.** `measure/world_controls.mjs` moves every enabled world row, stroke option and visible page slider low to high in each of the nine worlds on fixtures that hold the features, and reads the most any channel moves and the pixels changed; a row the panel disables is swept again with its parents set. First sweep: 1,680 enabled world rows and 2,464 stroke rows, 932 readings of exactly 0. Sorted: shine lobes and grains, ordered rock (the `cliff*`, `rockFrom`, facet and bed-relief rows), strata and the colour bands, the lit bed and the hard step and its chain, Palette dither and the crease are idle until a named control is on, so each now says so in `worldControlRequirement` (a parent that is itself idle names its own reason) with node tests; the fringe, the beach, tiled ground, sand slopes and faces of one material follow facts of the world's material, and the hard step and lit bed also a water stroke's own choice, that the panel passes in (`worldPanelValues`, and `p.world` for stroke rows); `facing` needs Lean on kinds with no lean of their own. The painted fixture shows the rows a painted or per-stroke path keeps alive (the stones, the cracks, the cracked bed, the frost pockets). Nothing was dead. `overrideOn` was missing from the chunk renderer's flags, so the Deposits, Vegetation and Exposure planes were never read; set now, those Style rows and paint choices draw. `uFaceEdge` and `uGullyRock`, set and never read, left the renderer and the struct. 27 scenes byte for byte, the nine walls equal to main's. **A disabled row that moves fails the tool**: it caught `repose`, and `lavaDusk`'s gate, which was on main before the card; the review's join of the first sweep to the last and its read of the shaders found the others. **55 readings stay on the tool's `OPEN` list** (17 world keys, 6 stroke keys), each with its card: H24 41, H23 11, Small leftovers 3. The tool is a check for any card that touches a control (BACKLOG ground rule 11); a full sweep is 22 minutes with three browsers. |
| H23 | Rock: the merge trials | **Done.** Tier 1, no pixel moved except two on green-2: one groove gap constant, one `grooveSpacing`, `grooveAngle`, `grooveRun` for joints and gullies (no world cuts both), constants for `crackJagged`, `crackLit`, `blockGrit` and `facetSkew`, `bedBend` dropped, `bedLip` derived from `bedLedge`. Tier 2, judged against retail with `stats.py` and the sheets: `crackReach` and `crackLength` constants, `crackStyle` follows `rockOrder`, the facets cut at the blocks' size, step and crease (four rows out); `crackWidth` tried and kept. `desertCapFlat` needs a two-bed section where one bed fills over 88 percent of the cycle (`capBed`). The Lava crust's height takes a stroke's Style: relief strength, so that row moves on every hill. `lean`, `facing`, `faceVariation` and `styleFace` on a deep stroke were live all along: a Face width fills a small stroke's reach, and a deep stroke on flat ground has no steep face; a wide stroke fixture in the sweep shows them. Every rock reading is off the tool's `OPEN` list, which holds 42: H24 39, Small leftovers 3. `KNOB_DEFAULTS` 388 to 370; eight scenes move, 19 are byte for byte. |
| H24 | Water and coast: the merge trials | **Done.** Tier 1, no pixel moved: `shoalDither` is derived from the step, `bandFoot` is eight times `flatBank`, `fingerSpread` is the constant .5; a stroke's Hard edge now draws the one threshold step, so `hardDeepStep` and `stepSharp` go and `deepEdge` is a 0/1 choice. Tier 2, judged against retail with `stats.py` and the sheets: `bedCrackSlope`, `crackedContrast`, `ringTaper`, `fingerAmount`, `fingerHeight` (the old tongue goes), `lavaCreaseVary`, `lavaMeander` and `shelfScale` (140, Green's) are constants, and `deepEdgeDepth` goes (the step sits at the midpoint of the two depths); only those last two move a scene. `shoalShoreSoft`, `stepSoftPx`, `shelfWander`, `layerLedge` and `layerRough` tried and kept; one amplitude for the lit-bed marks not tried (it would merge kept rulings). The water rows say what draws them: with one water colour or a third that follows the depth the step shows only on a lit bed or crystal shallows (`waterTones`, which a picked water colour makes 2); the ramp rows need the step off or a Faded edge (`rampWater`); `crackedStep` needs a Cracked bed stroke (`crackedBed`). The tool's `OPEN` holds only Small leftovers' three readings. `KNOB_DEFAULTS` 370 to 357; five scenes move (green-1, green-3, red-2, red-3, archipelago-1), 22 are byte for byte. |
| H25 | Small leftovers: the dead paths, the last readings, the bridge | **Done.** The flow bake's readers go (`flowSample`, `flowStreaks`, `flowWater`, `flowBank`, `sedimentMix`, `uFlowOn` and the chunk renderer's flag, the five `flow*` keys of every table, `flowColors`): 14 files, 164 lines out. Tinted water goes (`water=tinted`, `uNativeShallows`, `waterTinted`); the Colors panel's Shallow water and Deep water rows were not dead and stay: a picked color makes the water two flat tones, so `waterTones` is 2, the bed's rows say a color replaces the lit bed (`waterColored`), and the color row syncs the panels. The three last readings are settled and the tool's `OPEN` list is gone: Archipelago's `slopeTexture` is replaced by the sediment transition at 100 percent Material weathering (`slopeReplaced`); Red's four slope shine rows need Sampled slope texture above 0 or faces of rock and moss, and a slope group with no share no longer wakes the pass. `engine-bridge.wgsl` is gone: `drawMineralMargins` and `joinSedimentTransition` are in `engine-frag.wgsl`. The mask planes' layout stays (Small leftovers). The tool now reads the water rows under a picked color. No scene or wall moved. |
| H25b | A fed tile's lattice takes its height from the region | **Done.** `renderChunk` fell back to the lattice's width for its height, so `baseHeight` clamped a fed tile's rows at its width: rows past it were one row repeated. Older than the 256 px view tiles, which brought the limit up the screen; a 512 px tile's fell near the window's bottom, where the renders carried it (lava-3's false cracks). One token, and `repro/render.mjs` now fails any render that depends on the tile size. 22 of 27 scenes move, in the clamped rows only; the tile size leaves 21 single pixels over 27 scenes. |
| H26 | Natural zoom: grain at drawn pixels, the editor's zoom bakes at its level | **Done.** Above 100% the editor bakes its final image at the screen's pixels (.5 to 200%, .25 beyond); `grainPixel` moves the grain and dithers one texel per drawn pixel and marks keep their world size; the relief fields stop at 2x; a level whose view does not fit the budget falls back with no banner, and a level bakes only what is seen; 400% joins the zoom select. 27 scenes and 9 walls byte equal at 1x; `repro/zoom.mjs` guards the levels, the seams, the return to 100% and the bakes a view costs. Export is unchanged. |
| H27 | Landform: a path tool with a whole cross-section, a height along the path and variation weighted by place, on the one engine (decision 24) | **Done.** `landform` (KIND 16) with its own entry `stampLandform`: the path is the crest, the section is main's curve on both sides (front, back, lean, facing), the crest stands at an absolute `elevation` that Raise to, Cut to or Flatten to combine with the ground, a second curve (`along`) sets its height along the path, and wander, width and height variation are position noise weighted by the place on the section (foot and from the middle up; the crest's own weight was folded, under 5%). Terraces gain `breakup` for every section kind, and a landform takes the ridge's spurs. The draw and the bake did not change: no uniform in `engine-common.wgsl`, no branch in `engine-frag.wgsl` or `engine-bake.wgsl`, no CPU height evaluation. One Landform button; one whole-section canvas for every section kind (both sides, Link sides, Mirror, a lean handle, ghost sections read from the map), and the along canvas. 27 scenes byte for byte; `regional.mjs` 0 on them and on the fixture. |
| Small leftovers | What Shores could not reach from numbers (H18; the owner's call): a shelf in the heights for Archipelago's halo and a rule keeping the bank's face material off its waterline, a band gate telling a coast bank from a crater rim on Green, a thinner crack line for Red's bed and a dark band on its bank, a colour table for Ice's shelf, thinner lines on Lava's layer risers. What Fractures could not reach from numbers (H17; the owner's call): block cells aligned to the beds and a harder lower edge on Green's rock, a patch gate for long fissures on Green's rims, `cracks()` on level ground for Red's mud polygons, the structured face on Ice for its fibres; a weather cap of 14 pages (H13); Lava's terrace softness; a looser ripple on Ice's and Red's water; a lit fit for Red's and Crystal's dithered shallows and Zhon's river water; the noise on the GPU, if 40 ms matters; what Bodies could not reach from numbers (H20; the owner's call): ice-3's block (a soft, sooty outline with a lit blue left face and pits: needs a colour table for the faces and code for a ragged outline and the top's pits), lava-3's hills (heaped terraces with dark creases: needs code, the radial hair is not Bodies'), the lower rim of ice-1's coast (retail's frost is a finer tooth than the smoother band that closing the ponds leaves, and its darker offshore shelf is Shores' table), crystal's seams on crystal-2 and -3 (H20b: retail's are hairlines, the slab layer's thinnest line is 2 px on its 2-px field, so a hairline needs a seam drawn by the shader from the cell geometry), and the few straight-sided ponds left at the coast of ice-1; what Impacts could not reach from numbers (H21; the owner's call): Moon's broad uphill folds and rounded radial/upper formations (relief aligned uphill, rounded crests and variable widths; cups, ribs and contour folds do not draw this), moon-2's missing sinuous fissures (authored paths with width/depth), crystal-1's broad lit crater planes and hard rim boundaries (facet/rim construction and the skin boundary; turning the web off also restores enclosing ink, and one pixel also changes in non-crater crystal-2), and Red's stronger broken crater rims (refine authored radius/depth, rough outlines and local rim cuts before changing global defaults). See [Impacts part 2](audit/IMPACTS-2.md); no shore cell size changed; the mask planes' layout (planes 18-24 are unused, but the shape engine's buffers hold seven words a cell in `engine-shape.wgsl`, `engine-feed.wgsl` and `sculpt-gpu-fields.js`, `MASK_KEYS` is in two files and the memory estimates count its keys: ending the layout at plane 17 and shrinking the texture array from seven layers to five is a change to all of those); the Colors panel's Rock, Sand and Beach base colors (`rockBase`, `sandBase`, `beachBase`), live like its water rows and untraced; any gloss wakes the shine pass, and `shineTerm`'s `lit` then shifts the light wherever `normal` differs from the top-down grain normal, with no material weight behind it (H25 stopped this for a slope group with no share; `shineSand` on Red still reads 353 px on red-2 for that reason, and stays enabled because sand can be laid there) | After combine-or-drop |
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
