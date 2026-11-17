# Surface layers: where each material shows

Status: phases 1-3 landed on local main (b89971fd, 2026-11-15); the rest of phase 3, phase 4 as an opt-in and phase 5's height
contrast landed on local main from branch `surface-layers-2` (09c0cc52, 2026-11-16). Round 3 (branch `surface-layers-3`) landed on local main
(2026-11-16): see "Round 3" below. Round 4 (branch `surface-layers-4`: rock and Crystal as materials, 23 material slots) landed on local main (2026-11-16): see "Round 4". Round 5 (branch `surface-layers-5`: the drawn color, strata as tones, Crystal's art) landed on local main (2026-11-16): see "Round 5". Round 6 (branch `surface-layers-6`: vegetation, plants on layers, the cover table retired) landed on local main (2026-11-16): see "Round 6". Not pushed; previews stale. Branch `surface-layers`. The research behind it is the prototype branch
`prototype/surface-stack` (not for landing), summarized below.

## The model

A world's **surface** is an ordered list of layers, bottom to top, over its ground. Each layer is:

| Part | What it is |
| --- | --- |
| Material | What it draws: a library material (the world's copy, shared by every layer that draws it), or, for a built-in that draws a role or a rock type's rock, that material. |
| Coverage | (stored as `amount`) The share of its area it covers, 0 to 1, each covered pixel at full strength (TA's look), by its edge's pattern. |
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

The **Worlds (gate)** column is the phase-1 account. What each built-in layer needs to draw today (a World setting above 0, a role material,
the world's beach, or Surface paint) is data, `SURFACE_NEEDS` in `sculpt-material-model.js`, checked against `engine-frag.wgsl` and
`sculpt-renderer.js`; World › Surface sorts its list by it ("Drawing in this world", "Only where painted", "Cannot draw … yet").

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
   - Branch `ux-round3` (replaces the stage headings): the list is three sections by what draws, from facts read directly
     (`SURFACE_NEEDS`, a layer's Coverage and material): Drawing in this world, Only where painted (Surface paint's rock, snow and
     moss) and Cannot draw in the world yet, each idle layer with its reason and a door to the setting that turns it on. Rows keep
     draw order; a row moves among its stage's layers in its section, landing beside the one it passes. A closed row says where
     the layer lies in words from its rule, with its Coverage as the editor's slider; Add a layer is a gallery of the presets.
   - Not done, on purpose: turning the highland ground and base band into rules. `highShare` also sets the ground's art relief
     and caps the beds outside the layer stages, where facts are not computed, so a rule would split one surface into two
     placements. The rock face's rule belongs to each rock type (Rock types › Exposure & relief), not to the world: a world rule
     would override every rock type's. Moving their rows next to their layers gives the artist one place without that split.
4. **Engine surfaces become materials.** Bare soil, sand, debris fines, snow, moss, slope cover: each its
   own library material per world, so the editor can swap them. Look changes, per world, judged by eye.
   - Round 3 replaced the opt-in: every engine surface draws a material, and the engine's colors for them are gone (see Round 3).
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

## Round 3 (branch `surface-layers-3`, 2026-11-16)

The owner's decisions of 2026-11-16, after testing round 2:
1. One way: everything is a material, no simple colors; a material has a Color an artist sets in one go, or each step.
2. The cover classes become possible with materials: an artist may, say, grow flowers around wet ground.
3. Per-world edges wait for the next full biome tuning round.
4. Layer and role materials stay with the world.
5. The surface list is a world setting (confirmed).
6. Scope of "no simple colors" (asked): the surfaces and the role tints (Colors › Slope cover, Sand, Beach; Rock and Crystal
   too); low ground, strata, vegetation, flowers and shallow water later, one at a time; Sun and Sky stay. If slots run out, the
   material cache may grow to 24 slots.

And their notes on the panel: why a pixel has its color; seeing the effect while editing and where a later layer overrides one;
isolating layers; which material belongs to which layer; full opacity with coverage, not a fade.

Built (each a commit; the measurements are in their messages):
- **Coverage**: Amount is the share of a layer's area it covers at full strength, by the edge's pattern (single pixels at Noise size
  1, patches above), and height contrast moves that threshold. Measured: .3 covers 29.7% (1 px), 31.7% (8 px), 29.9% (22 px); .7
  covers 70%, 66.5%, 65.4% (the pattern is near even, a little under at patch sizes).
- **Design view**: the layer preview is stripes over the finished picture, magenta where the layer shows and cyan where a later layer
  covers it, with a checkbox; each row can be hidden or shown alone (Solo), a view of the page only that an export sets aside.
- **Inspector**: Pick on the map (the Pick tool, key I) and Surface in its card: the color pass records the layers that drew that
  pixel (row, coverage, in order), its color, its ground, its rock type and how much rock shows, and the facts; the panel lists them
  top first with their materials and what of each shows. The Pick card itself names the shape, rock type and materials there.
- **Naming**: each row shows its material; the material editor names the layers a copy draws.
- **World-kept materials**: the world keeps every role material and layer material it changed, as its ground and water.
- **A material's Color** (`recolorMaterial`): moves every color step (the gradients and color constants the color is made of,
  not a Multiply's or Add's layer) by one amount, and its palette with it. In the editor's Controls, the World ground and water
  panes and each Surface row.
- **Shared copies**: a layer binds the world's copy of its library material (its `worldLayer` is the library key), so the three
  snows draw one snow.
- **Engine surfaces draw materials**: soil, the base band, both mosses, painted snow, sand dust, sand and the ice snows draw the
  world's `@soil`, `@band`, `@moss`, `@snow`, `@sand` (world.materials), library entries that are another graph with the world's
  Color (`like`/`color` in textures.json) at the color the engine derived from the GPU's mean of the world's materials: moss is the
  world's slope material darker and sand its debris material (as the engine drew them), soil a red earth, the band a desert grain,
  snow the ice graph at the world's tint; Green's snow is the ice white and its sand the Zhon beach (the owner's picks by eye).
  Per-world sheets (`~/terraform-assets/agent-surface-layers/sheets/worlds-*.png`, main against the branch): painted snow and moss
  change 6 to 12% of the scene, deposited sand 2 to 5% (Ice 12%: its sand is lighter; Zhon 0%). The engine's snow, moss, soil and sand colors are gone, with Moss from ground, Rock grain in
  sand and the Colors panel's Slope cover, Sand and Beach rows. A new map's materials: 10 to 13 of 15 (Archipelago 13, 91 MiB of
  128), so the cache did not grow.
- **Flowers**: a Flowers material (clumps of one species, the cover table's four colors) and a preset, Flowers in wet ground, that
  lays it as single pixels where Wetness passes .35. Wetness comes from the Time pass. On a shore scene with Time, 0.93% of the
  picture took flowers, as 1-px dots of each clump's species, through the palette.

Not done, for the owner:
- **Rock colors.** A rock type's flat color (its own, or the world's Colors › Rock, which every rock type inherits through slot 0's
  row) overrides its material's mean; Green, Lush and Zhon set one, 16 world recipes and 10 presets set their own. Turning them into
  materials gives each colored rock type its own copy of its material (slots: Archipelago has 2 free), so it belongs with the beds'
  colors (strata, deferred) and may need the 24-slot cache. The Surface rows for rock show no Color until then.
- **Crystal** has no material to carry a Color; its row stays.
- **The cover classes** stay as they are (off in every world): flowers are possible as a layer now; tufts and shrubs are placed by
  the bake from the classes, and a layer cannot drive them until the bake evaluates surface rules. Retiring the table waits for that.

## Round 4 (branch `surface-layers-4`, 2026-11-16, landed)

The owner's go-ahead for "the rock, strata and Crystal round", after round 3: rock colors into materials with the 24-slot cache if
needed, Crystal a material, strata with them.

Built (each a commit; the measurements are in their messages):
- **23 materials**: `MATERIAL_SLOTS` 24 (slots 1 to 23), the GPU's ground table 32 entries (`groundMask` 31). Ice would have needed 16.
  Strokes on slots 15 to 23 draw and export their materials. The cache holds only the materials in use, so its 128 MiB budget (about
  18 materials at 7 MiB) limits those, and adding a material still checks the whole list against it.
- **Rock colors are materials' Colors**: a rock is laid flat in its material's mean (slotRock); a colored rock type names a library
  material `like` its old graph at its old color (the ten starting recipes and the worlds' 14 colored types), and Green's, Lush's and
  Zhon's rock materials carry their old Colors › Rock. Each color is tuned on the GPU mean: 26 of 27 within 1 level (Ice's Crystal ice
  falls 24 levels short in blue, its light pixels clipping). The Rock types pane's Rock color sets its material's Color; a rock type
  that shares its material first takes its own copy. Colors › Rock and a rock type's own `rock` color are gone (old saves drop it).
- **Crystal is a material**: the role `worldCrystal` (the world's crystal material, Crystal facets at the world's old color, within 1
  level); the crystals take its mean, the rock material's without one. Colors › Crystal and `crystalRGB` are gone.

A new map's materials: archipelago 15, crystal 12, desert 14, green 12, ice 16, lava 13, lush 14, moon 14, red 12, zhon 12 (of 23).

**Memory.** Each material in use takes about 7 MiB of GPU cache, counted in the terrain budget (every rock type's material is cached;
see Round 5). The browser smoke
(`repro/smoke.mjs`) ran at `gpuMB=512`, below any budget the editor picks itself (2048 MiB, 1024 on devices reporting 4 GB or less):
main's Green passed there with under 12 MiB to spare and its Ice failed, and the branch's Green failed once the escarpment rock type
had a material of its own. At the owner's word ("Smoke at 1024 MiB") it runs at 1024 MiB, where Green and Ice pass. A smaller
material cache (its color and height are 32-bit floats) remains a possible follow-up.

**Strata are not converted** (the owner's choice, below). A rock type's column has five bed colors, read by the color pass (the beds'
bands on faces and raised ground) and by rock weather (the color of debris from each bed). Three ways on:
- **Beds as tones of the rock material** (recommended): each bed is the rock material's Color times a tone; setting the material's
  Color moves every bed with it, and a bed's own color sets its tone, the owner's "set one color at the material level, or each step".
  No slots; rock weather reads the same rows.
- **Beds as materials of their own**: each bed shows a material's art. Up to five materials per bedded rock type: Desert would need
  about 15 more, past 23, and 15 more cache layers.
- **Keep the bed colors** as the column's palette, for now.

## Round 5 (branch `surface-layers-5`, 2026-11-16, landed)

The owner: "yes, do the open remaining items" (round 4's strata, the picker's color, Crystal's art).

Built (each a commit; the measurements are in their messages):
- **The picker shows the drawn color**: the material cache reads each regenerated material's GPU mean back (readMeans); every Color
  picker (Rock types, Surface rows, the material editor, the World pane's ground and water) shows it and moves it to the color picked.
  Measured: Green's rock material draws #747474 (its graph's estimate #79787b); picking #995933 draws #995933. Until a page has drawn,
  a picker shows the graph's estimate. The Surface rows of the rock-typed built-ins show the world's rock material's Color.
- **Strata are tones of the rock material**: a bed is its rock material's mean plus a tone (an [r, g, b] shift, -1 to 1), in the color
  pass and in rock weather; a column's `tones` replace its colors and a rock type's `beds` are tones. Additive, as a material's Color
  moves its steps: Desert's pale beds on its dark rock would have needed gains near 7 as a product. Recoloring a rock type moves every
  bed by the same shift; a bed picker sets only its own tone. Desert's scenes change 0.06% and 0.02% of pixels (isolated dither flips).
- **Crystal shows its material's art**: the tops move toward the crystal material's own art, the sides keep its mean. Crystal's scene
  changes 11.2% of pixels; the tops read a little flatter and more even (the owner's eye decides).
- **Fix: every rock type's and the crystal material cached again.** Round 4's 84344e55 let a stroke's shape settings change the cached
  set, which rebuilt the cache inside a draw and failed the digest sweep. The smoke's 1024 MiB budget makes the saving unnecessary.

## Round 6 (branch `surface-layers-6`, 2026-11-16, landed): vegetation

The owner: "Vegetation round". The seven-class ground cover (off in every world) is retired, and its plants grow on surface layers.

Built (each a commit; the measurements are in their messages):
- **One rule evaluator**: the rule's windows and score live in engine-common.wgsl (surfaceWindows, surfaceScore), read by the color
  pass and the bake. The 27 identity scenes are byte-identical.
- **The cover table is retired**: the class pick and its recolor, the table's flowers (the Flowers material is a layer), Vegetation cover,
  Flower density and the Colors panel's Vegetation and Flower rows. Lushness and a stroke's Local vegetation stay (they move bare rock,
  debris regrowth and wet ground, and now the plants). Byte-identical on the 27 scenes.
- **The Moisture and Soil depth facts read the world's `site` numbers** (wetness thresholds, soil and moisture terms), which the table
  wrote only while it was on, so they were computed from zeros. The 27 scenes are identical (no default layer reads them); with the
  Moss and Dry ground presets on Green the picture changes 2.5% more (dry ground finds sunny slopes and the sunny shore bank).
- **Plants on layers**: a material layer grows one kind (grass tufts, meadow tufts, moss cushions, shrubs) at a Plant density, where it
  shows; a layer may grow plants alone ("None: plants only"). The bake places them (plantMask): the material layers in draw order, the
  same rule on the facts the bake knows (slope to top), each covering the plants under it by its share; Lushness and Local vegetation
  scale them; Vegetation relief their height. Presets: Grass tufts on level ground, Meadow in damp ground, Shrubs in damp hollows, and
  Moss in damp shade grows moss cushions.

Limits: plants know no shares (rock, debris, sand) or convexity, and a built-in layer neither grows nor covers them (the bake does not
see the draw's own surfaces); their density is one value a 4-px cell, not the layer's pixel pattern.

## Round 7 (branch `surface-layers-7`, 2026-11-16, landed): the last simple colors

The owner: "Shallow water, Low ground". The Colors panel's two surface colors become materials, or tones of one; its other rows are
the light's colors.

Built (each a commit; the measurements are in their messages):
- **Low ground's color is a surface layer**: its tint, the Colors panel's Low ground row and the `lowColor` address key go. The Surface
  preset "Low ground by the water" draws a material from the sea up to 5 above it. Ground › Low ground keeps Reach and Grain kept
  (Zhon's lowland keeps its grain). The 27 scenes are byte-identical (no world tinted its low ground).
- **Shallow water is a tone of the water material**: the shallows' tint is the water material's mean plus a tone, and the third color
  (Crystal, Ice, Zhon) too, so recoloring the water moves its shallows. Each world's data holds its tones (water: `shallowTone`,
  `midTone`: the measured color less the water material's drawn mean, static numbers). The Shallow water row shows the tone on the
  water's drawn color and stores a pick as a tone (world colors: `shallowTone`), as the Rock column's beds do; an old hex `shallow` is
  dropped. The 13 water scenes change by 0 to 5 px; computed from the table mean in place of the drawn mean, Archipelago's shallows
  had moved 59,953 px into pale speckle.

Limits: a world's tones are measured against its water material as drawn on this machine (Metal); recoloring the water in the
material editor keeps the tone, which is the intent. Lava's and Moon's tones are their measured -1 to +3 level offsets, kept so
their look does not move.

## Sources (phase 1)

Built-in sources are the surfaces the engine draws today without a material: rock (the rock type's color and
grain), bare soil, debris fines, sand dust, sand, snow, moss, the beach (a role material), slope cover with
its mineral margins, the highland ground, beds, crown rock, ground patches, river-bed gravel.
Phase 4 turns them into materials one by one.

## Limits

- 12 layers in the prototype: a row budget, not a design limit. The shader loops over the layers at every
  pixel and the gates cannot specialize the loop, so phase 1 measures its cost before landing.
- Rows live in the material table's first 151 rows (zeros since the legacy generator went): two a layer plus one per
  rule row; 32 layers at most.

## Open questions for the owner

- Crystal's art (round 5): judge the flatter tops by eye.
- Plants (round 6): judge the presets' tufts, meadow and shrubs by eye; whether built-ins should cover plants.
- Low ground (round 7): the "Low ground by the water" preset draws Red's ground as a band along the shore; judge its material and reach.
- Shallow water (round 7): a picked tone is kept in the world's colors (`shallowTone`); say if it should live elsewhere.
- Converting highland, base band and rock face into rules means their World rows move into the Surface section.
