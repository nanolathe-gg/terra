# Green Planet: dossier

## Windows

`repro/scenes/green-<n>.json`; retail data in `$R/repro-r7/green-<n>/`.

| Window | Retail map | What it tests | Before round 1 | After round 2's port | After round 3's port | After round 4's port |
| --- | --- | --- | --- | --- | --- | --- |
| green-1 | pc games' evad river delta | broken hills (rock type `evad`) by the sea | shape .22, look .10 | shape .22, look .09 | shape .22, look .08 | shape .22, look .08 |
| green-2 | great divide | long gentle grass slopes, a ridge | shape .16, look .20 | shape .16, look .20 | shape .16, look .17 | shape .16, look .19 |
| green-3 | the barrier reef | islands and reef shallows | shape .08, look .09 | shape .08, look .10 | shape .08, look .10 | shape .08, look .11 |
| green-4 | the pass | a rocky massif with grass in its folds | shape .63, look .23 | shape .63, look .23 | shape .63, look .23 | shape .63, look .24 |
| green-5 | plains and passes | a terraced ridge on a rolling plain (`hill` strokes with Steps, rock `ridgestone`) | shape .18, look .70 | shape .12, look .35 | shape .12, look .35 | shape .12, look .36 |
| green-6 | wretched ridges | two ridges of dark blocky rock (rock `ridgeblock`) | shape .24, look .10 | shape .24, look .10 | shape .24, look .08 | shape .24, look .08 |
| green-7 | two continents | open water and coast: **held out** | shape .19, look .12 | shape .19, look .12 | shape .19, look .12 | shape .19, look .12 |

Means of the tuning windows: shape .25, look .24 before round 1; shape .24,
look .18 after round 2's port; shape .24, look .17 after round 3's port
(measured 2026-11-18); shape .24, look .18 after round 4's port (measured
2026-11-19, with main's shader changes of that day: wet rock at a cliff's
foot, boulders in the shallows. Those moved green-2 .17 to .19, its gentle
lines 0.46x to 0.28x retail, and green-3, green-4 and green-5 by .01.
Green-1's port shows in its `flat:edges`, not its look). One render of all
seven windows each.

### Which rock each window's strokes use

A rock type changes only the windows whose strokes use its slot (PLAYBOOK.md,
"Rock types"). From the scenes' `rockPreset`:

| Window | Rock slot used | Rock type |
| --- | --- | --- |
| green-1 | 2 | `evad` |
| green-3 | 2 | `evad` |
| green-5 | 5 | `ridgestone` (Terraced greenstone, round 2) |
| green-6 | 6 | `ridgeblock` (Blocky ridge, round 3; material `green-darkrock`) |
| green-2, green-4, green-7 | none set (0) | the world's own rock (the rock keys in `knobDefaults`) |

Re-check with `grep -o '"rockPreset": [-0-9]*' repro/scenes/green-<n>.json`
after any shape-lane edit.

## What Green's retail looks like at 1x

These notes are by eye, from the base crops in
`<out>/trial-000/classes/crops/`.

- **Level ground:** dark olive green with fine 1-2 px dither specks, a few
  bright green flecks, and soft darker blotches of 30-60 px. On gentle
  grades it carries wiggly, dark contour lines with gray rock specks along
  them (green-2 level).
- **Slopes:** ragged, stepped terraces. Each step is a jagged dark line, a
  shadowed riser 1-3 px tall, and the grass between steps is lumpy (green-5
  slope). Ours draws smooth grass there with almost no lines (measured:
  green-5 slope `lines` retail .0045, ours .0002).
- **Rock:** gray rock shows as **thin dark cracks and small exposed patches
  inside the grass** on slopes and hill shoulders, never as a solid band.
  Ours lays a solid gray band at the foot of hills (green-1 steep crop). On
  the massif (green-4), retail's rock is a fine mosaic of gray rock and
  green clumps. Ours separates them into large solid regions. Green-4's
  strokes also do not follow retail's relief well (shape .63), so weigh it
  less.
- **Shores:** a narrow, slightly darker band, with no sand on most maps
  (owner's decision: no rock coasts on Green). Near a bay, retail's grass
  carries soft contour rings (green-3 shore crop). An earlier "bluish wet
  band" was water pixels inside retail's shore mask, not the ground.
- **Water:** saturated blue, with a pale shallow shelf and soft
  diagonal-streaked dither. Ours is close, but its water has more small
  edges (measured at the base: green-3 water `edges` retail .0030, ours .0083;
  round 1's two keeps together brought ours to .0023).

## Known from earlier rounds (docs/BIOME_CATALOG.md, "Green Planet")

- Green's slope hatch comes from contour bands 1.3 units apart with a line
  darkness of .65 (`world.column.bands`): `banding` .6, no jag (`bandJag`
  0). Bands do draw on green-5's ridge flanks, but
  faintly (measured 2026-11-18: doubling `banding` changed 8.5% of green-5's
  pixels, all on the flanks), and never on its plain, because they start at
  slope 0.07. `bandLevel` (Lines on level ground) draws them on slopes
  0.004 to 0.09 with a strength of its own, times the slopes'. A rock type carries
  its own `banding`, so a map's strokes can have stronger bands than the
  world's own rock.
- Lighting on Green was set by the owner (2026-11-15) and stays unless a
  change is clearly better on every window.
- No rock coasts on Green. Shores are a natural sand-grass edge.
- Hills must stay grassy. Rock on a hill is cracks and patches, not a cap.

## Start here (round 5)

Round 4 (branch `match-green-5`, 68 of 300 trials, report in
`$R/match/terraform-wt-match-green-5/green/REPORT.md`) was reviewed and
partly ported to main on 2026-11-19. Earlier rounds' starts are in git
history (this section's earlier versions).

- **Ported:** green-1's four painted ground-lump strokes at 45%, not 60%
  (measured: `flat:edges` 17.6x to 6.3x retail, look .08 unchanged; by eye
  the lumps are softer, closer to retail's smooth plain).
- **Not ported:** green-5's own grass with dark specks (`green-groundgrain`
  in `world.materials.extra`, four large paint strokes). It matched retail's
  plain edge count with specks darker than nearly anything retail draws there
  (measured on the flat crop: ours' 1st-percentile luma 32.7, retail's
  47.8; pixels darker than 35 are 1.33% of ours, 0.09% of retail's). By eye
  retail's plain is an even dither with occasional bright teal flecks, not
  black pepper. The round's own finding that lighter specks lose the edge
  count points the other way: retail's edges come from a wider 1 px palette
  spread in the grass dither. Try that, inside retail's `dark` and `light`.

The harness now reports each class's darkest and brightest 1% (`dark`,
`light`; PLAYBOOK.md, "Symptom to lever"), keeps every trial's class crops
(only scene pictures and triptychs are pruned), and explains when a shape
preset can reach a window.

The largest findings at the start of round 5 (measured, the port's base
render after merging main, `$R/match/terraform-wt-port-green-r4-merged/green/trial-000`):

- green-5 `flat:edges` 0.02x and `gentle:edges` 0.04x retail: the plain's
  grain and the gentle wrinkles (above, and item 4 below).
- green-1 `shelf:edges` 0.09x: item 1 below.
- green-1 `gentle:edges` 0.11x: the softer lumps took the gentle ground's
  texture with them (round 4 saw this too). Look for it in the ground or
  a surface layer, not by raising the lumps again.
- green-5 `slope:lines` 0.23x: the terrace risers (item 2).
- green-2 `gentle:lines` 0.28x: its hatch, thinned by main's shader
  changes of 2026-11-19 (was 0.46x the day before).
- green-3 `gentle:band32` 2.75x and `steep:edges` 2.48x: broad patches on
  its gentle ground and busy cliff faces.
- green-4 `steep:color` grayer by 14: the mosaic (item 3).
- green-6 `steep:light`: ours' brightest 1% reach luma 107, retail's 123;
  retail's dark blocks carry lit edges ours lacks.

Round 4's "cannot" claims, checked (section 6 of its report):

1. **6.1, the shelf's fine speckle:** the code holds (the shelf is tinted by
   the water's mean color times the bed's light, so the water material's
   grain reaches only the deep water), but the conclusion does not.
   `bedContrast`, which carries the bed's grain into the shelf tint, was
   never tried. Measured on green-1 (port review): Green's 0.7 gives shelf
   edges .00136 (retail .0162); 0.85 gives .00337; 1.0 (the engine
   default) .00862, 0.53x retail, with look .08 to .09; 1.5 overshoots to
   4.7x. By eye at 1.0 the shelf gains real 1 px grain but is blotchier
   than retail's. Start here: `bedContrast` with `bedFlat` and `bedRelief`.
2. **6.2, dark lines on terrace risers:** holds. Two rounds tried a wider
   band step, `bandLevel`, surface layers and band materials.
3. **6.3, the rock/grass mosaic on green-4:** the stated reason is wrong.
   The round wrote that the rock face ignores its material's graph, but its
   own trial-059 moved the face's mean color from RGB 46,50,42 to 51,53,49
   (measured). What vanished were the green clumps, possibly in the palette
   reduction. Find out where before proposing engine work.
4. **6.4, a hatch on gentle grades:** a cheap test, not a new control:
   `bandLevel`'s slope range starts at .004 in the shader; starting it at
   .03 would keep plains clean. Expect less than the report hopes: by eye
   retail green-2's gentle lines are jagged dark scarps with gray rock along
   them, and green-5's gentle ground has lumpy wrinkles, not dashes.
5. **6.5, shore texture:** plausible; it has surface-layer trials (054, 055).
6. **Shape presets:** round 4 wrote that a shape preset cannot reach the
   windows (trial-063). That trial changed `massif`, which no window draws.
   A scene stroke starts from `world.shapes.<kind>` for the kind it names
   (`hill`, `landform`, `deep`; all empty on Green), so a preset key moves
   every window whose strokes name that kind and leave the key out of
   their card (measured, port review: `world.shapes.hill` `gullies` 40
   moved green-5's shape .12 to .15 and look .35 to .38). It also changes
   that tool's defaults in the editor.

## Pilot notes (2026-11-18)

The harness's first run, by the agent that built it. Its trials are in
`/tmp/nanolathe-map-editor/match/terraform-wt-retail-harness/green/` (`--log` there, or read `ledger.jsonl`). Their pictures are kept
for trial-000, holdout-000 and trial-004.

- **Probe `slopeMarks=0.5,1`** (measured): mean look .24 to .23. green-5
  went .70 to .64 at 1, but green-1 got worse (.10 to .12). Not kept.
- **Probe `banding=0,1.2`** (measured; the base is .6): green-2 went .20 to
  .36 at 0 and .44 at 1.2, so .6 is near right for green-2. green-5 did not
  move at all (.70 at 0, .6 and 1.2). **Contour bands do not reach green-5's
  hill slopes.** Find out why before anything else on green-5 (PLAYBOOK.md,
  "When a control moves nothing").
- **Probe `bandFade=0.3,1.5`** (measured; the default is .75): green-5 went
  .70 to .70 and .69. **The band slope fade is not the cause.** Leads left:
  - `terraceCalm`;
  - which rock the library `hill` strokes use (none set: the world's own
    rock);
  - retail's ragged ledges may be terraces (stroke Steps, a shape lane
    question) rather than painted bands.
- **Cold-test run (a fresh agent, branch `match-green`)**, measured, on top
  of the `evad` edit:
  - `wrinkles=1`: green-5 .70 to .49, clearing `slope:lines`; but green-1
    .10 to .20 (slope lines 538x retail) and green-3 +.04;
  - `wrinkles=0.6`: mean .22 (green-5 .62, green-1 .12);
  - `wrinkles=0.3`: mean .23.
  
  `wrinkles` is world-wide and helps green-5's hills while it scars
  green-1's: it fits one window, not the world. A green-5-only gain points
  at its hill strokes (rock slot 0, the world's own rock) or its shape, not
  at a world control.
- **Control trial** `--query banding=0.6` (Green's own value) rendered
  exactly as the base (trial-007), so the query path itself changes
  nothing.
- **Rock type `evad`** with `faceRock` .35, `faceGrass` .8 and `crackMajor`
  1 (trial-004, measured and by eye): green-1's solid gray rock band at the
  hill foot became cracks and small rock patches in the grass, much closer
  to retail by eye. Compare `trial-000/classes/crops/green-1/steep.png`
  and `trial-004/classes/crops/green-1/steep.png` in the pilot folder. It cleared `steep:band2` and
  `steep:band8` on green-1, but the look scores did not move (.10). It was
  reverted, because the pilot only tests the harness. **It is a strong lead:
  start here, and tune it.**
