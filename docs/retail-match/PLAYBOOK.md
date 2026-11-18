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
- **Watch for:**
  - A `--query` reaches World controls only. Stroke options (Steps,
    Gullies, a shape's rock) are refused with a message.
  - A scene's own `query` beats your default, so check the scene file.
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
  2 on come `world.rock.presets` in order. Section 6 of the reference
  prints your world's slots. Change the recipe a window's strokes actually
  use, or the change will not show.
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
- any `extra` materials.

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
    `{"name": "...", "like": "<key>", "color": [r, g, b]}`). Snippets in
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

Light and water colors are set by name: see section 1 of the reference,
"Colors". Try them as `--query 'shallowTone=4a7c8f'` and keep them in the
world file. Measured water colors live in `materials/<world>.json` → `water`.

### 6. Shapes: stroke cards and tool presets (the shape lane)

**Use for:** a class whose share differs from retail (a `share` finding), a
shore band that is too wide, or slopes that are too gentle. Only when
`layout.png` shows the strokes do not follow the retail relief. Fields and
their help are in section 5 of the reference.

- **Watch for:**
  - The windows use library shapes (`landform`, `hill`, `deep`, ...), not
    your world's tools, so changing `world.shapes` presets does not move the
    scores.
  - A stroke's seed is the page seed plus its index times 7919, so
    reordering strokes changes their noise.

## Symptom to lever

Finding keys are `<class>:<metric>`. The classes are `water`, `shore`,
`level`, `slope` and `steep`. The metrics are `share`, `luma`, `color`,
`spread`, `band2`, `band8`, `band32`, `edges` and `lines`. Start with the
first lever listed, and look at the crop before you choose.

| Finding | First levers | Then |
| --- | --- | --- |
| `*:share` | shape lane (strokes), if `layout.png` shows the fixture is off | a proposal (presets, engine) |
| `level:color`, `level:luma` | ground material: its Gradient stops, palette | `groundPatch`, `lushness`, `ambient` |
| `level:band2` (fine grain) | ground material: fine Noise `detail`, dither `amount` | `reliefAmount`, `plainRelief` |
| `level:band8`, `level:band32` | ground material: broad Noise `size`, `layers` | `groundPatch`, `groundPatchSize`, `undulation`, `reliefPatchy` |
| `level:edges`, `level:lines` too few | `banding` (contour lines), `plainRelief`, `lumpRelief` | ground material: Scatter pits or a Cracks noise; `crackSeverity` |
| `slope:color`, `slope:luma` | slope material; `hillLight` | `slopeTexture`, `faceFill`, `creaseShade` |
| `slope:lines` too few | `banding`, `bandSoftness` (contour hatch), `slopeMarks`, `wrinkles` | a rock type's crack keys, for slopes made of that rock |
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
- **Retail is consistent within a world.** If one window wants a change and
  the rest refuse it, the change is fitting a fixture, not the world.

## When a control moves nothing

If a control moves nothing on a window, find out why before you report it.
You may read any code; you may not change it.

1. **Check its gates.** Look in the reference's "needs" column, and in
   `sculpt-control-schema.js` (`worldControlRequirement`,
   `shapeControlAvailable`), for a control another one gates.
2. **Find where it is drawn.** `grep -n "<key>" sculpt-renderer.js` gives
   the uniform's name. Then grep `engine-*.wgsl` for that uniform, and read
   the condition around it. For example, contour bands (`banding`) are drawn
   in `engine-bake.wgsl` `contourBands`. They fade out on slopes steeper
   than `bandFade`, and they take each rock type's own `banding`.
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
- **Fighting a scene's own `query`:** it wins over `knobDefaults`.
- **Calling a control dead** when it was gated by another one at 0, such as
  `soilRim` for Bare soil.
