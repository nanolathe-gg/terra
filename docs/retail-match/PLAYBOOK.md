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

A material's palette list names entries of `materials/palette.json`'s
`indexed` list (256 entries, the game's index order), not its `colours`
(242): round 10's first clump material named the wrong colors.

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
  - A layer that draws a material takes a material slot ahead of
    `world.materials.extra`, so every extra ground moves up one and the
    scenes' `groundPreset` numbers must follow (round 9 renumbered
    green-5's paint from 12 to 14). The validator warns when a stroke's
    slot now lays a layer's or role's material.
  - A layer's material relief is not lit (only the ground's is). To make a
    layer read as lit lumps, bake the light into its color with a Light
    node in the material's graph (round 9's `green-lumps`, a billow through
    a Light node).
  - A layer's `slope` fact reads the art's height, which rolls with the
    map's `undulationArt`. A world layer on gentle grades therefore also
    draws on any plain whose art rolls; a map that should stay clean sets
    a low `undulationArt` (round 9: green-3 at .2).

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
  - **Painted styles and overrides:** a `paint` stroke's `paintChannel`
    scales a world result under the brush: Relief, Cracks and Banding
    (styles, 8-13), Ground lumps (16/17), and the signed overrides of
    Time and the surface (18-25: Relaxation, Deposits, Vegetation, Rock
    exposure). REFERENCE.md lists them. Paint one where the retail map
    plainly differs from the world's result, and keep the stroke clear of
    what it should not touch: round 7's Relaxation: less on green-1's
    coastal plain calmed Time's creases there (kept), but over the whole
    window it reached the hills (trial-030), and Vegetation: more on
    green-5 greened the ridge's rock (trial-033).
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
    0.3 kept the heights and smoothed the picture).
  - **Sea and plain:** the query's `sea` and `plain` (the plain's height
    above the sea): green-4's low-floored map uses `sea=0&plain=9`.
  - **Water:** the query's `shallowDepth`, `deepDepth`, `bedTint`,
    `bedBright`, `bedContrast`, `bedCracks`, `bedRelief`, `bedFlat` and
    `wetBand`, where this map's
    water or damp bank plainly differs from the world's (red-2's river stays
    light to depth 24, red-3's sea darkens from depth 8). Probe the world
    value first: a map's own value needs a by-eye reason in the report.

  The validator refuses any other key in a scene's query: World controls
  are the world's.
- **Try:** edit the scene, then `sh repro/match.sh <world> --window
  <world>-<n> --note "..."`, which renders only that window (about 20 s). A
  map setting can be probed first: `--probe undulation=3,6,10 --window
  <world>-<n>`.
- **Watch for:**
  - A scene stroke starts from the world's numbers for the shape it names
    (`world.shapes.hill` for a `hill` stroke), then its `card` on top. So a
    shape preset moves a window only when it is the preset of a kind that
    window's strokes name and sets a key their cards leave out. The windows
    use library shapes (`landform`, `hill`, `deep`, ...); a world's own
    shapes (those with a `from`, such as Green's `massif`) are never named
    by a scene. Round 4's trial-063 changed `massif` and nothing moved.
    REFERENCE.md lists each window's stroke kinds.
  - A stroke does not take the tool's `rock`. An unset `rockPreset` is -1,
    rock beneath, which on open ground is the world's own rock.
  - A stroke's seed is the page seed plus its index times 7919, so
    reordering strokes changes their noise. Edit strokes in place.
  - Moving the strokes themselves (their points, `diameter`, `elevation`)
    is the shape lane: only where `layout.png` shows they do not follow the
    retail relief (README.md, "The shape lane").

## Symptom to lever

Finding keys are `<class>:<metric>`. The classes are:

- `deep`: water 32 or more height units below the sea;
- `shelf`: shallower water, the light shelf along a coast or reef;
- `shore`: dry land within 40 px of water;
- `flat`: dry land under slope .03 (plains, level tops);
- `gentle`: slope .03 to .08 (the grades a plain rises on);
- `slope`: .08 to .5;
- `steep`: .5 and over.

The metrics are `share`, `luma`, `dark`, `light`, `color`, `spread`,
`band2`, `band8`, `band32`, `edges` and `lines`. `dark` and `light` are the
class's 1st and 99th luma percentiles: ours reaching darker or brighter
than retail by more than a palette step means pixels retail rarely draws
there. A mean or an edge count can reward those. Round 4's green-5 grass
matched retail's edge count with specks darker than nearly every retail
pixel on that plain (1.33% of ours below luma 35, 0.09% of retail's), and round 3's water flecks looked brighter than retail's
water by eye. Check `dark` and `light` before you keep a texture change.

Water and level ground are split so a change cannot score on the wrong
part. A change aimed at the shelf must move `shelf`; if it moves `deep`
instead, it painted the open water (round 3's flecked water did this). Lines
aimed at a hatched grade must move `gentle`; if they move `flat`, they cross
a plain retail leaves clean.

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
| `flat:color`, `flat:luma` | ground material: its Gradient stops, palette | `groundPatch`, `lushness`, `ambient` |
| `flat:band2` (fine grain) | ground material: fine Noise `detail`, dither `amount` | `reliefAmount`, `plainRelief` |
| `flat:band8`, `flat:band32` | ground material: broad Noise `size`, `layers` | `groundPatch`, `groundPatchSize`, `undulation`, `reliefPatchy` |
| `gentle:lines`, `gentle:edges` too few (a hatched grade) | `banding`, `bandLevel` (check `flat` did not gain lines retail lacks) | ground material: Scatter pits or a Cracks noise |
| `flat:edges`, `flat:lines` too few | ground material: a wider 1 px palette spread in its dither (retail Green's plain is dark green to bright teal flecks, not black dots); Scatter specks of 1 px or more that stay inside retail's `dark` (round 4's specks went below it); Cracks noise; `plainRelief`, `lumpRelief` | `bandLevel`, only where retail's plain carries lines by eye |
| `*:dark` (ours darker) or `*:light` (ours brighter) | whatever the trial last added: specks, flecks, dither or a material's Gradient ends | the palette list the material reduces to |
| `flat:edges` too many (regular dimples) | the map's `undulationArt` (art only, the heights keep rolling), `undulation`, `undulationScale` (section 6) | ground material's broad Noise |
| `slope:color`, `slope:luma` | slope material; `hillLight` | `slopeTexture`, `faceFill`, `creaseShade` |
| `slope:lines` too few | `banding`, `bandSoftness` (contour hatch), `slopeMarks`, `wrinkles`; on terraced ground a rock type's `stepCrease` (a dark line at each step foot on raised ground; green-5's ridgestone carries 1) | the map lane: the window's strokes with Steps and a rock type of their own (section 6) |
| One window's slopes or rock unlike the others' | the map lane: a rock type for that map, its strokes' Steps, `cracks`, `gullies` | a ground of its own |
| `slope:edges` too many | `reliefAmount`, `worms`, `gentleRelief` | the slope material's fine Noise |
| `steep:color` grayer, or greener than retail | rock material (the rock type's `material`, else the world's `rock`): its mean color is the face's color, and its own hue variation shows at only a third (`rockGrain`). A material's `color` key recolors its whole graph and palette to that color: drop or change it in a copy of a rock material, or the copy draws the old rock's color (round 5's moss rock did); `faceGrass`; surface rock rule | `faceTone`, `faceRindTone` |
| `steep:luma` | `faceShade`, `shadeDepth`, `ambient`, `lightCap` | rock material Gradient |
| `steep:edges` too many (busy faces) | rock type: `rockFace` (depth), `faceBlockSize` up, `faceJoint` down, `faceSecondary` down | `faceWear`, `faceMass` |
| `steep:lines` too few (retail's dark cracks) | rock type: `crackSeverity`, `crackMajor`, `crackNetwork`, `crackDark`; `faceScratch`, `faceCrease`; `stepCrease` where the face is stepped | `layerCrease` (banks only), `creaseShade` |
| Rock faces without retail's fine down-slope streaks or ribs (a knob, a buttressed ridge) | rock type: `faceScratch` ("Scratches and water grooves") with `faceScratchSize` (spacing), `faceScratchLength` and `faceScratchAngle` 0 (down the face), before a proposal | `gullies` on the map's strokes for the spurs; a rock material with vertical streaks |
| `steep:band8` too low | rock type: `faceBed`, `faceLedge`, `faceLamina`, `faceTone` | rock material pattern |
| `shore:luma` darker than retail (a dark bank or coast) | `wetBand`, the damp band's height above the water (rock stays damp four times as high; Red's 13 darkened red-3's coast near black, and 1 cleared every shore finding there) | a dry-bank surface layer on `toWater` |
| `shore:color`, `shore:luma` | beach (a `beach` role material, `beachWidth`), `lowReach`, `lowGrain`, `shoreEdge` | `wetSwath`, `wetGround`, `crispShore`, a surface layer on `toWater` |
| `deep:color`, `deep:luma` | water material; `deepDepth` | colors |
| `shelf:color`, `shelf:luma` | `shallowDepth`, `deepDepth`, `bedTint`, `bedBright`, `shallowTone`; a world's material table sets the depths' defaults (Red renders 2 and 42; REFERENCE.md shows the value the page gets). Where one map's water differs (a river light to depth 24, a sea dark from depth 8), its scene's query may set its own (section 6) | water material |
| `shelf:edges` too few (retail's specks and streaks on the shelf) | `bedContrast` (carries the bed's grain into the shelf tint; Green sets 0.7, and 1.0 took green-1's shelf edges from 0.08x to 0.53x retail), with `bedFlat`, `bedRelief`, `shoalRag`; the shallow-water surface layer. These are world-wide: green-3's and green-7's shelves overshoot at `bedContrast` .85 (round 5). For one map, try the rock type under its water: green-3's own rock type moved its shelf edges .003 to .005 (round 5, trial-054) | the water material, but its grain reaches only the deep water (the shelf is tinted by the water's mean color, `engine-frag.wgsl` `litBed`) |
| `deep:edges` or `shelf:edges` too many | `bedRelief`, `bedFlat`, `waterSoft`, `shoalRag` | water material's fine Noise |
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
