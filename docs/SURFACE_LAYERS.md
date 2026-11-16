# Surface layers: where each material shows

Status: phases 1-3 landed on local main (b89971fd, 2026-11-15). On branch `surface-layers-2` (2026-11-16, not landed): the rest of
phase 3, phase 4 as an opt-in, and phase 5's height contrast. Branch `surface-layers`. The research behind it is the prototype branch
`prototype/surface-stack` (not for landing), summarized below.

## The model

A world's **surface** is an ordered list of layers, bottom to top, over its ground. Each layer is:

| Part | What it is |
| --- | --- |
| Material | What it draws: a library material (a map's copy), or for now one of the engine's own surfaces (see Sources). |
| Amount | The share of pixels it takes where its rule allows it, 0 to 1. |
| Rule | Where it may show. **Windows**: up to four facts, each with a from–to range and a fade, all of which must hold (multiplied). **Score**: up to four facts with weights, summed, past one threshold with a fade (additive rules: steep *plus* convex). |
| Edge | How it meets what is below: width (1 a soft mix, near 0 one material a pixel), noise and its size (speckle at 1 px, patches above, the rock's own patches for faces), height contrast (the taller material wins at the edge). |

**Facts** are what the engine measures at a point: slope, height above the sea and the plain, wear, deposit,
wetness, moisture, soil depth, sunlight, lump or hollow, vegetation, form slope, convexity, route, sand bar,
weathering, the rock face's share, footing, the rock's patches. A fact is engine code; a rule over facts is
world data. Adding a fact is the way the model grows.

**Effects stay engine features**, applied at fixed points: lighting, cast and crease shade, wet darkening and
the damp band, cracks and crack walls, boulders, chips, the rock skin, crystals, surf foam and wrack, water.
They change how a surface looks where it is; they do not choose a material.

The stack is a **world setting**, like the world's ground and water: each world ships one in
`materials/<world>.json` (`world.surface`), a world of your own carries its own, and every map in a world
draws it. Maps do not override it (a map's own materials stay strokes and rock types).

## What the prototype showed (Node, Green)

- The stack reproduces Green's land cover byte-for-byte (same export, same 2693 tiles) when its layers use
  the engine's own colors and shares.
- The edge model works at any boundary and repeats with the ground's pool (2693 → 2698 tiles).
- Amount means the share of pixels only if the noise is uniform and applied whole (fixed there).
- Windows alone could not express Green's rock rule (31–81% of face pixels differed); a score layer
  reproduces it byte-for-byte. Both rule kinds are needed.
- Green's `landPlace` gentle rock never shows (0.01%): the rock face takes over first. Dead code.
- The old seven-class ground cover is nearly invisible on Green's fixtures (about 25 px).
- Unproven: height contrast (Green grass has no height), GPU cost, the editor, other worlds.

## Inventory: the draw's ground-color steps today (engine-frag.wgsl, in order)

**Mix** steps lay a color over what is below by a share: they can be layers. **Modify** steps compute from
the color below (a tint, a recolor, a darkening): they cannot be byte-identical layers, so they stay effects
at fixed points between layers until a later phase replaces them. **Reads** lists what later steps take
from a step.

| # | Step | Kind | Worlds (gate) | Reads |
| --- | --- | --- | --- | --- |
| 1 | Ground material (own or a stroke's) | base | all | |
| 2 | Highland ground (`highShare`) | mix | Lush, Desert (`high` role) | |
| 3 | Low-ground tint and grain | modify | where `lowTint`/`lowGrain` | |
| 4 | Slope cover, with mineral margins inside (`drawMineralMargins`) | mix | all (`slopeMaterial`); margins on Archipelago | `slopeShare`, `levelGround` (crystals) |
| 5 | Cover classes' recolor (`groundCover`) | modify | worlds with a cover table (default on) | |
| 6 | Bare soil (soil rim) | mix | where `soilRim` > 0 | |
| 7 | Rock: face and `landPlace` | mix | all | `exposed`: beds, patches, fines, swaths, chips, crown |
| 8 | Beach | mix | `beach` role (Zhon; borrowed) | |
| 9 | Margin join (`joinSedimentTransition`) | modify | Archipelago | |
| 10 | Crown rock | mix | Zhon (`rockCrown`) | writes `exposed` |
| 11 | Beds by height (strata) | modify (reads the color's luma) | Desert (`strata`) | |
| 12 | Base band | mix | Desert (`baseBand`) | |
| 13 | Ground patches | modify | where `groundPatch` | |
| 14 | Rock skin (crust, fresh fracture) | modify | all | |
| 15 | Moss on regrown debris | mix | all with debris | |
| 16 | Debris fines | mix | all with debris | writes `exposed` |
| 17 | Painted rock, snow, moss | mix | painted maps | writes `exposed` |
| 18 | Sand dust, then sand (bake cover, river-bed gravel inside) | mix | all with sand | |
| 19 | Boulders (bake stones) | mix | all | |
| 20 | Crack walls and floors | modify | all | |
| 21 | Chips | mix | all | |
| 22 | Weather, wet swaths, damp band, painted wet | modify | all | |
| 23 | Crystal tops and faces, crystal near | modify | Crystal | |
| 24 | Hill light | modify | where `hillLight` | |
| 25 | Ice crest snow, ice cap snow | mix | Ice | |
| 26 | Surf sand, wet sand, wrack, pebbles | mix and modify | maps with Surf | |
| 27 | Desaturation, absorption | modify | some rock types | |

So phase 1's layers are steps 2, 4, 6-8, 10, 12, 15-19, 21, 25 and 26's sand, wrack and pebbles. Steps 3, 5,
9, 11, 13, 14, 20, 22-24 and 27 stay effects at fixed points, which splits the list into **stages**: a layer
belongs to the stage between two effects and can move only within it. Phase 1 needs about eight stages.
Reordering across stages needs each modify step turned into an effect a layer opts into, or into a layer of
its own (phase 5 and later).

## Phases

Each phase lands on its own. Rule 7: a phase becomes every world's behavior or does not land.

1. **One path, same pictures.** The mix steps above, for every world, become built-in layers read from one
   default stack (`materials/defaults.json`, `surface`; a world may override it in `world.surface`): each
   layer's source is the color the engine makes today and its mask the share it computes today, in today's
   order and stages, with today's mixes. No facts are computed yet. Layers bind materials by **role** (the
   beach, highland, slope cover roles), not by library key. The old composition code for those steps goes.
   Checks:
   - byte-identical renders of every world's scenes (every layer exercised: zeroing each changes pixels in
     at least one scene, and the beach, painted rock/snow/moss, crown, margins, ice snow and surf paths each
     have a scene that turns them on) and identical exports beyond Green;
   - engine determinism, the digest guard, the browser smoke on our own port;
   - draw cost: the `perf.mjs` pair and Node per-pass timings against main, before it lands.
   - A custom world, an old world file and a borrowed beach each get a stack.
2. **Facts, rules and material layers** (built). Any layer may have a rule: up to four windows over facts, all of which
   must hold, or a score (weighted facts summed with the edge noise, through one smoothstep). A built-in's rule limits its own
   share; a material layer draws a map material by Amount times its rule. Facts: slope, height above the sea and the plain,
   wear, deposit, wetness, moisture, soil depth, light, top, convexity, and the rock's, debris' and sand's shares (from
   their own stage on). They are computed once a pixel, only when a layer reads them or draws a material. A material layer
   (`{id, name, material: libraryKey, stage, where|score}`) binds to the map's copy of that material, which carries the layer's
   id as `worldLayer` (added to a map as roles are; one binding per material). Material layers above rock take their
   coverage out of the rock share the later effects read.
   - Changed from the first plan: the built-ins keep their shares. Turning the highland ground, base band and rock face
     into rules would duplicate the World rows that set them today (rule 9), so each conversion moves to phase 3, where
     the editor replaces those rows. The rock face's score is exact only with Bare soil 0.
   - Not in phase 2: height contrast (relief is in pixels per material, so it needs normalizing and a fixture).
   - Measured: the shipped stack renders byte-identical to main (28 scenes, every world). Rules, material layers and each
     fact change pixels on a fixture. Computing the facts costs nothing measurable.
3. **The editor** (built). World › Surface lists the layers top first. Each row has its Amount, edge width, edge noise and
   noise size, and its rule's conditions (a fact by its plain name, from, to, fade; up to four). Rows move up and down among
   the layers they are drawn with. A material layer is named, shows its material's chip, opens its material in the
   material editor, and can be removed (on branch `surface-layers-2`: its map copy leaves the map unless a stroke uses it, hidden strokes included; a map loaded or carried into a world gives up any copy bound to a layer that no longer draws it). Add a layer starts one from a preset:
   snow above a height, moss in damp shade, scree on steep ground, dry ground on sunny slopes, mud in wet hollows, or a
   blank material layer. Pointing at or focusing a row previews where that layer lies, in magenta over the dimmed map
   (diagnostic view 13). Restore returns to the world's own surface.
   - The list is a world setting, kept in this browser's world store as the sliders are. Undo, a save's embedded world
     (only when edited), New world and world files carry it.
   - Branch `surface-layers-2`:
     - Rows are one line (chip, name, what differs from the default, raise and lower) that opens to the settings, under a heading
       per stage, so where a layer may move reads from the list.
     - A row's rule is Everywhere, where all conditions hold, or where a score passes (weighted facts, threshold, fade), all
       edited in the row. A new preset uses a score: rock on steep convex edges.
     - A row chooses its library material (a built-in may also keep its own color). Changing it gives up the map's old copy, which
       leaves the map unless a stroke uses it.
     - The Highland ground and Base band World rows (strength, height window) moved from Ground › Pattern and Cliffs & stones ›
       Bands into this section's Built-in settings. Their layer rows show no Amount, which would repeat the strength.
       Highland ground also takes no rule or edge (they would move its color but not the relief and bed cap its share sets);
       a list's stored Amount, rule or edge for them is dropped.
   - Not done, on purpose: turning the highland ground and base band into rules. `highShare` also sets the ground's art relief
     and caps the beds outside the layer stages, where facts are not computed, so a rule would split one surface into two
     placements. The rock face's rule belongs to each rock type (Rock types › Exposure & relief), not to the world: a world rule
     would override every rock type's. Moving their rows next to their layers gives the artist one place without that split.
4. **Engine surfaces become materials.** Bare soil, sand, debris fines, snow, moss, slope cover: each its
   own library material per world, so the editor can swap them. Look changes, per world, judged by eye.
   - Built as an opt-in (branch `surface-layers-2`): an engine-colored built-in (`SURFACE_DRAWABLE`: bare soil, base band, moss on
     regrown debris, painted snow and moss, sand dust, sand, the ice snows) may name a library material (`{"builtin": "sand",
     "material": "zhon-beach"}`); the draw lays that material's pigment by the built-in's own share. It binds the map's copy by
     the built-in's name, so a list draws one material per built-in. Without one, a built-in draws the engine's color, so no
     world's look changed and no world spends cache slots on a surface it does not swap.
   - The other built-ins already draw a material: highland ground, slope cover, beach and debris fines their role materials
     (Materials panel), rock, crown rock, painted rock and chips each rock type's rock (Rock types). A picker on their rows would be
     a second, partial way to set those (Fable's review: the slope cover's margins and the crown would keep the old look), so their
     rows say where their material is set instead.
   - Reconciliation (`sculpt-materials.js surfaceMaterials`, pure and unit-tested): a copy whose layer no longer draws it leaves the
     map unless a stroke (hidden too) or a rock type uses it; it runs on each surface edit and on loading a map, with that map's
     strokes. A bound copy cannot be deleted in Materials, and one made the world's ground or water stops drawing its layer.
   - Look study (2026-11-16, by eye, Green and Ice fixtures): Ice ground reads as snow far better than the engine's grayish painted
     snow; Zhon beach reads as sand better than the engine sand on Green; the Lush materials make moss too teal; soil and regrown
     moss barely change. Pictures in the explainer artifact.
   - Not done: shipping a material per surface per world as the default. That changes every world's look and needs the owner's
     eye, and the budget below.
   Budget: Archipelago already holds 8 role materials of 15 slots; six more is 14, about 103 MiB of 128,
   before Worn/Deposit layers or strokes. Shared materials across worlds, or a larger cache, may be needed.
5. **Edges and cover.** Each world's boundaries get their edge settings (looks, judged). The seven-class
   cover becomes material layers or material states (Dry, Wet, Shaded), and the plants follow the layers.
   - Built (branch `surface-layers-2`): **height contrast**, an edge setting of a layer that draws a material. Where the layer meets
     the ground it covers, the taller art height wins: the layer's share moves by contrast x (its relief - the ground's) / 4,
     inside its edge only (4 share (1 - share)) for windows, and at the threshold for a score. 0 is today's edge. It rides in the
     rule head's w, so a layer with it and no rule gets an empty rule.
   - Not done: per-world edge settings (looks, for the owner) and the cover conversion; see "Cover classes" below.

Later, only if a real biome needs it: a layer's rule opened as nodes in the existing node editor.

### Cover classes (phase 5, measured 2026-11-16)

The seven-class ground cover (`material.groundCover`: bare soil, dry grass, turf, meadow, scrub, moss, wet rush; its recolor,
flowers and plants) is **off in every shipped world**: `vegetationCover` is 0 in `materials/defaults.json` and no world sets it.
Measured: with the cover table removed from every world's config, the 27 identity scenes render byte-identical; with every
class painted pure red on Green, Green's scene is byte-identical too. It draws only when an artist raises Vegetation ›
Vegetation cover.

So converting it has no shipped look to preserve. Two ways on, for the owner:

- **Retire it into layers.** Its classes are windows over moisture, soil depth and light, which are surface facts already; the
  presets cover two of them (moss in damp shade, dry ground on sunny slopes). Each class needs a library material to be a
  layer, and the plants would then follow a layer's coverage (a layer `plants` amount the bake reads), which needs the bake to
  evaluate the surface rows. Removes the recolor step (an effect between stages 1 and 2) and its table.
- **Keep it as the Vegetation effect** it is, opt-in, and leave the plants on the classes.

Not done tonight: either needs the owner's choice, and the first needs class materials judged by eye.

## Sources (phase 1)

Built-in sources are the surfaces the engine draws today without a material: rock (the rock type's color and
grain), bare soil, debris fines, sand dust, sand, snow, moss, the beach (a role material), slope cover with
its mineral margins, the highland ground, low-ground tint, beds, crown rock, ground patches, river-bed gravel.
Phase 4 turns them into materials one by one.

## Limits

- 12 layers in the prototype: a row budget, not a design limit. The shader loops over the layers at every
  pixel and the gates cannot specialize the loop, so phase 1 measures its cost before landing.
- Rows live in the material table's first 151 rows (zeros since the legacy generator went): two a layer plus one per
  rule row; 32 layers at most.

## Open questions for the owner

- The stack as a world setting, not per map: built that way; right?
- Converting highland, base band and rock face into rules means their World rows move into the Surface section.
