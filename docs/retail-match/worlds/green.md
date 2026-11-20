# Green Planet: dossier

## Windows

`repro/scenes/green-<n>.json`; retail data in `$R/repro-r7/green-<n>/`.

| Window | Retail map | What it tests | Before round 1 | After round 2's port | After round 3's port | After round 4's port | After round 5's port |
| --- | --- | --- | --- | --- | --- | --- | --- |
| green-1 | pc games' evad river delta | broken hills (rock type `evad`) by the sea | shape .22, look .10 | shape .22, look .09 | shape .22, look .08 | shape .22, look .08 | shape .22, look .08 |
| green-2 | great divide | long gentle grass slopes, a ridge | shape .16, look .20 | shape .16, look .20 | shape .16, look .17 | shape .16, look .19 | shape .16, look .19 |
| green-3 | the barrier reef | islands and reef shallows | shape .08, look .09 | shape .08, look .10 | shape .08, look .10 | shape .08, look .11 | shape .08, look .11 |
| green-4 | the pass | a rocky massif with grass in its folds | shape .63, look .23 | shape .63, look .23 | shape .63, look .23 | shape .63, look .24 | shape .63, look .24 |
| green-5 | plains and passes | a terraced ridge on a rolling plain (`hill` strokes with Steps, rock `ridgestone`) | shape .18, look .70 | shape .12, look .35 | shape .12, look .35 | shape .12, look .36 | shape .12, look .34 |
| green-6 | wretched ridges | two ridges of dark blocky rock (rock `ridgeblock`) | shape .24, look .10 | shape .24, look .10 | shape .24, look .08 | shape .24, look .08 | shape .18, look .08 |
| green-7 | two continents | open water and coast: **held out** | shape .19, look .12 | shape .19, look .12 | shape .19, look .12 | shape .19, look .12 | shape .19, look .12 |

Means of the tuning windows: shape .25, look .24 before round 1; shape .24,
look .18 after round 2's port; shape .24, look .17 after round 3's port
(measured 2026-11-18); shape .24, look .18 after round 4's port (measured
2026-11-19, with main's shader changes of that day: wet rock at a cliff's
foot, boulders in the shallows. Those moved green-2 .17 to .19, its gentle
lines 0.46x to 0.28x retail, and green-3, green-4 and green-5 by .01.
Green-1's port shows in its `flat:edges`, not its look); shape .23, look
.17 after round 5's port (measured 2026-11-19). One render of all seven
windows each.

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

## Start here (round 6)

Round 5 (branch `match-green-6`, 87 of 300 trials, report in
`$R/match/terraform-wt-match-green-6/green/REPORT.md`) was reviewed and
partly ported to main on 2026-11-19. Earlier rounds' starts are in git
history (this section's earlier versions).

- **Ported:** green-5's own grass with soft 1.4 px specks
  (`green-groundgrain` in `world.materials.extra`, six paint strokes on
  slot 12; measured: flat edges 0.02x to 0.24x retail, darkest 1% at
  retail's 42, look .36 to .34). Green-6's plain at `undulation=0` (flat
  share 44% to 69%, retail 70%; shape .24 to .18; by eye level like
  retail's).
- **Not ported:** the 7 px light-and-dark mottle under green-5's specks
  (round 5's 9ece2247). Look .34 to .32 and flat edges 0.35x, but its 8 px
  texture overshoots retail (1.70 vs 1.45) and its tone spread moves away
  (15.7 vs 13.9); by eye it adds 7-15 px blotches where retail's soft
  blotches are 30-60 px.

The harness now shows each rock type's material, by slot and key, and how
full the map's material table and cache are (REFERENCE.md, "Rock slots");
the validator and the headless render warn when a rock type's material did
not fit.

The largest findings at the start of round 6 (measured, the port's base
render, `$R/match/terraform-wt-port-green-r5/green/trial-000`):

- green-1 `shelf:edges` 0.09x and `gentle:edges` 0.11x retail (lead 2).
- green-5 `gentle:edges` 0.11x and `flat:edges` 0.24x: closer, still short.
  Retail's gentle ground has lumpy wrinkles with light rims.
- green-5 `slope:lines` 0.21x: the terrace risers (lead 7).
- green-3 `gentle:band32` 2.75x and `steep:edges` 2.48x (lead 3).
- green-2 `gentle:lines` 0.28x and `slope:share` 50% against 39% (a shape
  gap: its fixture is too sloped).
- green-4 `steep:color` grayer by 14 (lead 1); its shape .63 needs a shape
  round (round 5: split the massif into retail's separate blocks).
- green-6 `steep:light` 107 against retail's 123 (lead 4).

Leads (round 5's proposals, checked):

1. **The mosaic (its C and G):** G is wrong, and so is the evidence for
   C. Its moss material bound to slot 15 of 23, with 60 of 128 MiB of
   cache used (measured with the headless code path). But the material
   kept the gray rock's `"color": "#79787b"`, and a `color` key recolors
   the whole graph and palette to that color (`recolorMaterial`). Measured
   in the port review: trial-040's state renders green-4's face #2b3026
   (look .21); without the `color` key the same material turns the face
   dark green, #1c2712 (look .29, because that graph was pure dark moss);
   by eye the whole face goes green. So hue reaches a face. Untested:
   whether gray rock with green clumps survives `rockGrain`, which mixes a
   material's own hue variation in at a third around its mean. Start here:
   a two-tone rock material for a green-4 rock type (gray rock, vivid 5-20
   px clumps, no `color` key) before any engine proposal.
2. **The shelf (A):** world `bedContrast` overshoots green-3's and green-7's
   shelves. Green-1 and green-3 share rock slot 2 (`evad`), and a rock type
   under the water reaches the shelf (green-3's own rock type, trial-054:
   shelf edges .003 to .005). Try a green-1 rock type before an engine
   change. Strokes already carry one water choice of their own
   (`waterDeep`, Shallow-to-deep edge), which is the precedent if one is
   still needed.
3. **green-3's faces (E):** its own smooth rock type (trial-054) gave
   round 5's best look gain on any window, .11 to .093, and was dropped for
   shelf edges of .0047, barely over the .004 floor. Retry it, with
   `undulationArt` for its grades.
4. **green-6's lit block caps (F):** ridgeblock `faceFresh` .8 with
   `faceShade` .6 cleared the brightness and line findings at +.01 look
   (trial-053); `faceShade` .6 alone improved its look .081 to .075
   (trial-047) and was dropped.
5. **Bright grass flecks:** ours' brightest 1% reach luma 114 on green-3's
   shore, slope and steep and on green-7's plain, retail's 100. Round 5
   only raised `lightCap`; lowering it, or the grass Gradient's top stop,
   is untried.
6. **Retail's plain dither carries hue** (by eye): reddish-brown and teal
   pixels among the greens. Ours varies in brightness only.
7. **Riser lines (B):** holds over three rounds. **Gentle-grade hatch (D):**
   holds on data; `bandLevel`'s slope range starting at .004 is a shader
   constant a round cannot change.

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
