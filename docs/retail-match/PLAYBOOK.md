# Retail match playbook: levers, when to use each, and what has worked

Read [README.md](README.md) first. Every key named here is listed, with its
range and your world's current value, in `<out>/REFERENCE.md`. Check it
before you set anything. If this page and the reference disagree, the
reference is right.

## How a picture is made

Each pixel goes through the same pipeline in every world:

1. **Shape**: the strokes and the world's presets raise and cut the heights.
2. **Ground**: the world's ground material on level land, the low ground near
   the sea, and the water material below it.
3. **Time**: rain wears channels and lays deposits, which the materials'
   `worn` and `deposit` colors show.
4. **Surface**: the surface layers decide which material shows at each
   pixel: slope cover, rock, soil, beach, sand, snow, moss, your own layers.
   Rock draws each rock type's rock material and relief.
5. **Effects**: cracks, contour bands, loose stones, chips, crystals and
   foam draw over the surface.
6. **Light**: the sun, ambient light, cast shadow and crease shade.
7. **Palette**: every material is reduced to TA's 256 colors with its own
   dither.

A difference is usually caused at one of these steps. Fix it there. A darker
material will not fix a missing crease shade, and an ambient change will not
fix the wrong material.

## The levers

### 1. World controls (`world.knobDefaults`)

**Use for:** light, relief, effects, rock face construction (the world's own
rock), water depth and tone, and how much of a built-in surface shows.

- **Try:** `sh repro/match.sh <world> --probe key=a,b,c --note "..."` (one
  trial per value, nothing edited), or `--query 'a=1&b=2'` with a trial.
- **Keep:** write the value into `materials/<world>.json` →
  `world.knobDefaults`, then run a trial without `--query` to confirm it.
- **Data-only settings:** some engine numbers have no panel row (the bands'
  upper slope `bandFade`, `bandJag`, `terraceCalm`, ...). Section 1 of the
  reference lists them; set them the same way. Round 2 proposed "exposing"
  `bandFade` without probing it.
- **Watch for:**
  - A `--query` reaches World controls only. Stroke options (Steps,
    Gullies, a shape's rock) are refused with a message.
  - A `--query` beats a scene's own `query`, but `world.knobDefaults` does
    not: a value every scene sets in its query never reaches the windows
    from `knobDefaults`. The validator warns when that happens. Green's
    scenes all set `undulation`, which is a map setting (section 6).
  - Probes are cheap. Sweep three values across the range first, then
    narrow it down.

### 2. Rock types (`world.rock.recipes`)

**Use for:** how rock looks wherever a stroke made of that rock shows it:
block size, joints, beds, cracks, contour bands, crust, pitting, scratches,
grass on ledges and the rock's material. Most retail cliffs are a rock type
problem.

- **Where:** each recipe is `{label, material?, knobs: {...}}`. Its knobs are
  the World controls marked "rock" in the reference.
- **Which rock a window uses:** a stroke's `rockPreset` is a slot: 0 is the
  world's own rock (the rock keys in `knobDefaults`), 1 is `soil`, and from
  2 on come `world.rock.presets` in order. Section 7 of the reference
  prints your world's slots and what each window's strokes use. Change the
  recipe a window's strokes actually use, or the change will not show.
- **A rock type per kind of map:** retail maps of one world differ (green-1's
  broken hills, green-5's stepped ridge). Add a recipe for the look one map
  needs, append its key to `world.rock.presets` (never insert: that moves
  every later slot), and give that window's strokes its slot (section 6).
  Do not retune a rock type the world's tools or other windows draw for one
  map's sake: round 2 tuned `greenstone` for green-5 and changed the Knob,
  Cup knoll and Rock fin tools with it. The validator warns when a shared
  rock type changed since the base.
- **Watch for:** recipe keys are lowercase. A recipe's knobs override the
  world's rock keys only for that rock.

### 3. Materials (`materials/textures.json`)

**Use for:** what a surface is made of: its color, grain, pattern and
small-scale art relief. Each world names a material per role in
`world.materials`:

- `ground`: level land;
- `water`;
- `rock`: the world's own rock;
- `slope`: grassy or covered slopes;
- `debris`: cliff fall;
- `soil`, `snow`, `moss`, `sand`, `band`;
- `crystal`;
- `extra`: a list of more materials (textures.json keys) a stroke may lay
  as its ground. Each takes the next free material slot (section 7 of the
  reference), so a map can have a ground of its own (section 6).

A rock type may name its own rock material.

- **Shape:** a material is a node graph: Noise, Scatter and Warp make
  patterns, Levels and Combine shape them, Gradient colors them, and the
  Material node takes color, height (art relief), shine, and worn and
  deposit colors. Then a palette and a dither reduce it to TA's colors.
  Section 2 of the reference has every node, kind, parameter and its help.
- **Approaches that work:**
  - **Color off, texture fine:** move the Gradient's stops. Keep their order
    and spacing, and shift them toward retail's mean color. The crop's
    findings give retail's mean as `#rrggbb`. Remember the palette: the
    result snaps to TA's colors, so check the crop rather than the number.
  - **Too smooth or too noisy at 2 px:** change the fine Noise's `detail`
    and `size`, the Scatter's `spacing` and `coverage`, or the dither's
    `amount` (palette grain). Retail's ground grain is mostly dither and 1-2
    px specks.
  - **Patches wrong at 32 px:** use the broad Noise's `size` and `layers`,
    or a Combine's `amount`.
  - **Pattern direction (streaks, ripples, scratches):** use Waves with
    `direction`, Warp kind `push`, Blur kind `directional`, or a Scatter's
    `elongation`.
  - **Start from a near material:** copy a material from another world that
    already looks closer (`like` copies a graph and recolors it:
    `{"name": "...", "like": "<key>", "color": "#rrggbb"}`). Snippets in
    `materials/snippets.json` are tested starting graphs.
- **Watch for:**
  - `textures.json` is shared by every world. Edit only materials no other
    world uses, `like` copies included, or copy one to a new `<world>-...`
    key and point your world at it.
  - A graph has at most 40 nodes.
  - The validator runs the editor's own material check, so it reports a
    broken connection before anything renders.

### 4. Surface layers (`world.surface`)

**Use for:** where a material shows: rock only on the steepest faces, moss
in damp hollows, sand near water, snow above a height, bare soil where cover
thins.

- **Where:** the world's ordered layer list, bottom to top. Without
  `world.surface` your world draws the shared default stack (section 6 of
  the reference prints it). To change it, copy the whole default stack into
  `world.surface`, then edit it. `@soil` style names are resolved to your
  world's role materials when the config is built, so you may keep them.
- **A rule is one of two kinds:**
  - **Windows:** up to four `{fact, from, to, fade}` terms, all of which
    must hold;
  - **Score:** `{from, fade, terms: [{fact, weight}]}`, the weighted sum
    past a threshold: "steep *plus* convex".
- **The edge** sets how the layer meets what is below it: `width` (1 a soft
  mix, near 0 one material per pixel), `noise` and `noiseSize` (speckle at
  1, patches above), and `height` (the taller material wins at the edge).
- **Facts:** steepness (`slope`, 0-20), height above the sea or the plain,
  `wear` and `deposit` (from Time), `wetness`, `moisture`, `soilDepth`,
  `light`, `top` (lumps and hollows), `convexity`, the shares of rock,
  debris and sand, which way the ground faces (`north`, `east`),
  `sheltered`, and `toWater` (px to the sea).
- **Approaches that work:**
  - **Material in the wrong place:** change the rule, not the material.
  - **A hard edge where retail blends** (or the reverse): change the edge
    `width` and `noise`.
  - **Retail shows a material we do not have** (a mineral margin, a second
    grass): add a material layer with your own `id`, a material and a rule.
- **Watch for:**
  - Built-ins that draw a role material or rock take no `material` of their
    own. The validator says which built-ins may.
  - Some built-ins draw nothing until a World control is above 0. The
    reference's "needs" column lists which: Bare soil needs `soilRim`,
    Crown rock a rock type's `rockCrown`, and so on.

### 5. Colors

- **The light's colors:** try `--query 'sunColor=ffd9a8&skyColor=8fb0ff'`
  (six hex digits each). Where a world keeps its own sun and sky color is
  not settled for this harness. If one helps, report the value; do not
  persist it.
- **Shallow water's tone:** `water.shallowTone` in `materials/<world>.json`,
  three numbers that shift the water material's mean. The other measured
  water colors live in the same `water` block.

### 6. Maps: a window's own choices (the map lane)

Each window is one retail map, and retail maps of one world differ: one is
broken hills, another a stepped ridge, a third flat plain. A map artist makes
those choices per map, from the world's kit. The map lane makes the same
choices in a window's scene (`repro/scenes/<world>-<n>.json`). Section 7 of
the reference prints the slots and what each scene uses now.

**Use for:** a gap that only some windows have, when a world-wide change
helps one window and hurts another.

- **The choices a map makes:**
  - **Rock type:** a stroke card's `rockPreset` (a rock slot). Add a recipe
    to the world first if none fits (section 2).
  - **Ground:** a stroke card's `groundPreset` (a material slot) on a
    `landform` or `paint` stroke. Add the material to
    `world.materials.extra` first (section 3). A `paint` stroke with a large
    `diameter` lays it over a plain. Tested on green-5 (a stroke appended to
    its scene's `strokes`, with slot 12 from section 7 of the reference):
    `["paint", [[60, 300], [380, 320]], {"card": {"diameter": 300,
    "amount": 100, "groundPreset": 12}}]`. Append new strokes at the end:
    an inserted one shifts the seeds of every stroke after it.
  - **Shape options:** Steps (`terraces`, `ledge`, `terraceJitter`,
    `breakup`), `gullies`, `cracks`, `talus`, the section `curve` and the
    rest of section 5 of the reference.
  - **Ground relief:** the scene's `query` keys `undulation`,
    `undulationScale`, `undulationCover` and `undulationArt`: the map's
    rolling ground, which the game's heights keep. Our plains are flatter
    than retail's on several Green windows. `undulationArt` sets how much
    of that relief the art shows: lower it when the heights should roll but
    the picture shows lumps retail does not (round 2's green-5 at
    `undulation` 14 drew crumpled hummocks on its plain; `undulationArt`
    0.3 kept the heights and smoothed the picture). The validator refuses
    any other key in a scene's query: World controls are the world's.
- **Try:** edit the scene, then `sh repro/match.sh <world> --window
  <world>-<n> --note "..."`, which renders only that window (about 20 s). A
  map setting can be probed first: `--probe undulation=3,6,10 --window
  <world>-<n>`.
- **Watch for:**
  - A scene stroke takes its tool's shape preset (`world.shapes`), but not
    the tool's `rock`. An unset `rockPreset` is -1, rock beneath, which on
    open ground is the world's own rock.
  - The windows mostly use library shapes (`landform`, `hill`, `deep`, ...),
    not your world's tools, so changing `world.shapes` presets moves few
    scores.
  - A stroke's seed is the page seed plus its index times 7919, so
    reordering strokes changes their noise. Edit strokes in place.
  - Moving the strokes themselves (their points, `diameter`, `elevation`)
    is the shape lane: only where `layout.png` shows they do not follow the
    retail relief (README.md, "The shape lane").

## Symptom to lever

Finding keys are `<class>:<metric>`. The classes are `water`, `shore`,
`level`, `slope` and `steep`. The metrics are `share`, `luma`, `color`,
`spread`, `band2`, `band8`, `band32`, `edges` and `lines`.

**These rows are starting guesses from how the engine is built, not
measurements.** The pilot already found two that did not hold on Green:

- `banding` moved green-2 but not green-5's hills;
- `slopeMarks` helped green-5 and hurt green-1.

Probe before you trust a row, and look at the crop before you choose. After
a probe, the printout's "moved vs base" line shows what the control actually
moved, class by class, beside retail's value.

| Finding | First levers | Then |
| --- | --- | --- |
| `*:share` | shape lane (strokes), if `layout.png` shows the fixture is off | a proposal (presets, engine) |
| `level:color`, `level:luma` | ground material: its Gradient stops, palette | `groundPatch`, `lushness`, `ambient` |
| `level:band2` (fine grain) | ground material: fine Noise `detail`, dither `amount` | `reliefAmount`, `plainRelief` |
| `level:band8`, `level:band32` | ground material: broad Noise `size`, `layers` | `groundPatch`, `groundPatchSize`, `undulation`, `reliefPatchy` |
| `level:edges`, `level:lines` too few | `bandLevel` (lines on near-level ground, its own strength; check by eye that retail has them there, not on a slope beside it), `banding`; the map's `undulation` (section 6) | ground material: Scatter pits or a Cracks noise; `plainRelief`, `lumpRelief` |
| `level:edges` too many (regular dimples) | the map's `undulation`, `undulationScale` (section 6) | ground material's broad Noise |
| `slope:color`, `slope:luma` | slope material; `hillLight` | `slopeTexture`, `faceFill`, `creaseShade` |
| `slope:lines` too few | `banding`, `bandSoftness` (contour hatch), `slopeMarks`, `wrinkles` | the map lane: the window's strokes with Steps and a rock type of their own (section 6) |
| One window's slopes or rock unlike the others' | the map lane: a rock type for that map, its strokes' Steps, `cracks`, `gullies` | a ground of its own |
| `slope:edges` too many | `reliefAmount`, `worms`, `gentleRelief` | the slope material's fine Noise |
| `steep:color` grayer, or greener than retail | rock material (the rock type's `material`, else the world's `rock`); `faceGrass`; surface rock rule | `faceTone`, `faceRindTone` |
| `steep:luma` | `faceShade`, `shadeDepth`, `ambient`, `lightCap` | rock material Gradient |
| `steep:edges` too many (busy faces) | rock type: `rockFace` (depth), `faceBlockSize` up, `faceJoint` down, `faceSecondary` down | `faceWear`, `faceMass` |
| `steep:lines` too few (retail's dark cracks) | rock type: `crackSeverity`, `crackMajor`, `crackNetwork`, `crackDark`; `faceScratch`, `faceCrease` | `layerCrease`, `creaseShade` |
| `steep:band8` too low | rock type: `faceBed`, `faceLedge`, `faceLamina`, `faceTone` | rock material pattern |
| `shore:color`, `shore:luma` | beach (a `beach` role material, `beachWidth`), `lowReach`, `lowGrain`, `shoreEdge` | `wetSwath`, `wetGround`, `crispShore`, a surface layer on `toWater` |
| `water:color`, `water:luma` | water material; `shallowDepth`, `deepDepth`, `bedTint`, `bedBright` | colors (`shallowTone`) |
| `water:edges` too many | `bedRelief`, `bedFlat`, `waterSoft`, `shoalRag` | water material's fine Noise |
| Everything a touch dark or flat | `ambient`, `lightCap`, `sunHeight` | `shadeDepth`, `flatOcclusion` |

## Strategy that has worked

- **Go one world at a time, and one step at a time.** The light first, since
  it moves every class. Then the ground material, which is most of the
  window. Then rock, then shores and water.
- **Change one thing per trial,** except when two levers clearly belong
  together (a material and the layer that places it).
- **Use probes to find out what a control does on your world,** not just to
  pick a value. A control that moves nothing is worth noting in the report:
  it may be gated off (the reference's "needs" column), or it may not
  matter at 1x.
- **The base gaps are not all yours to close.** If a window's `share`
  findings are large, its look scores mean less. Say so, and weigh the other
  windows more.
- **A world's look is shared; a map's choices are not.** Light, materials
  and the world's own rock are one answer for every window: if one window
  wants a world change and the rest refuse it, look for the map choice
  instead (section 6). In round 1, `wrinkles`, `plainRelief` and
  `undulation` each helped green-5 and hurt green-1. Stepped hills of
  escarpment rock on green-5 alone took its look from .70 to .56 without
  touching the others.
- **Use every kind of lever.** Probes are cheap, so a round drifts into
  turning World controls. Round 1 spent 27 of 41 trials on probes and never
  edited a material graph. Before a report says a texture or color gap
  cannot be closed, it must show tries with a material and a surface layer
  (and, for a single window, the map lane). `--log` counts the trials per
  kind of lever.

## When a control moves nothing

If a control moves nothing on a window, find out why before you report it.
You may read any code; you may not change it.

1. **Check its gates.** Look in the reference's "needs" column, and in
   `sculpt-control-schema.js` (`worldControlRequirement`,
   `shapeControlAvailable`), for a control another one gates.
2. **Find where it is drawn.** `grep -n "<key>" sculpt-renderer.js` gives
   the uniform's name. Then grep `engine-*.wgsl` for that uniform, and read
   the condition around it. For example, contour bands (`banding`) are drawn
   in `engine-bake.wgsl` `contourBands`. They start at slope 0.07 (below
   that, `bandLevel` sets their strength), fade out on slopes steeper than
   `bandFade`, and take each rock type's own `banding`.
3. **Write down what you found.** "Gated by X at 0", or "fades out above
   slope Y, where this window's hills are" is a finding. A proposal built on
   it is specific.

## Editing the files

- `materials/*.json` files have uneven whitespace: some blocks have blank
  lines between keys. Edit the exact text, and keep the rest as it is. Do
  not rewrite a whole file through a JSON serializer, because its diff then
  becomes unreadable for review.
- After an edit, `git diff` shows exactly what the next trial renders. A
  trial whose diff and query match the previous trial prints a warning,
  because your edit probably did not save.

## Mistakes past rounds made

- **Tuning a control the window does not use:** for example, a rock type's
  keys when the strokes use slot 0. Check `rockPreset`.
- **Editing a shared material** and changing four other worlds without
  knowing it.
- **Trusting one score:** a gray that matches mean brightness, or boulders
  that add "edges".
- **Judging a thumbnail:** cell sizes and grain only read at 1x.
- **Fighting a scene's own `query`:** it wins over `knobDefaults`. Round 1
  spent three trials on `undulation` that way. It is a map setting: change
  it in the scene.
- **Reading a finding that is a measuring artifact:** a coast drawn off its
  height cells once put water pixels in retail's shore mask, which read as a
  "bluer wet shore" of 15 CIELAB. The class split now drops pixels nearer
  the other side's color, but open the crop before you chase a color.
- **Calling a control dead** when it was gated by another one at 0, such as
  `soilRim` for Bare soil.
