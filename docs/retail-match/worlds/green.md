# Green Planet: dossier

## Windows

`repro/scenes/green-<n>.json`; retail data in `$R/repro-r7/green-<n>/`.

| Window | Retail map | What it tests | Before round 1 | After round 7's port | After round 8's port (heights clamped) |
| --- | --- | --- | --- | --- | --- |
| green-1 | pc games' evad river delta | broken hills (rock type `evad`) on a rolling plain by the sea | shape .22, look .10 | shape .135, look .067 | shape .135, look .067 |
| green-2 | great divide | long gentle grass slopes, a ridge | shape .16, look .20 | shape .16, look .19 | shape .16, look .19 |
| green-3 | the barrier reef | islands (rock type `reefstone`) and reef shallows | shape .08, look .09 | shape .08, look .09 | shape .08, look .09 |
| green-4 | the pass | a rocky massif with grass in its folds (rock type `passrock`) | shape .63, look .23 | shape .37, look .24 | shape .39, look .19 |
| green-5 | plains and passes | a terraced ridge on a rolling plain (`hill` strokes with Steps, rock `ridgestone`) | shape .18, look .70 | shape .12, look .34 | shape .16, look .24 |
| green-6 | wretched ridges | two ridges of dark blocky rock (rock `ridgeblock`) | shape .24, look .10 | shape .18, look .08 | shape .18, look .08 |
| green-7 | two continents | open water and coast: **held out** | shape .19, look .12 | shape .19, look .12 | shape .19, look .12 |

Earlier columns are in git history.

Means of the tuning windows: shape .25, look .24 before round 1; shape .24,
look .18 after round 2's port; shape .24, look .17 after round 3's port
(measured 2026-11-18); shape .24, look .18 after round 4's port (measured
2026-11-19, with main's shader changes of that day: wet rock at a cliff's
foot, boulders in the shallows. Those moved green-2 .17 to .19, its gentle
lines 0.46x to 0.28x retail, and green-3, green-4 and green-5 by .01.
Green-1's port shows in its `flat:edges`, not its look); shape .23, look
.17 after round 5's port (measured 2026-11-19); shape .18, look .17 after
round 6's port (measured 2026-11-19); shape .18, look .17 after round 7's
port (green-1 alone moved; measured 2026-11-19). From round 8 the shape score
reads our heights clamped to the game's 0-255, which re-based the means to
shape .20, look .16 (main 889ac369, with stepCrease); shape .18, look .14
after round 8's port. One render of all seven windows each.

### Which rock each window's strokes use

A rock type changes only the windows whose strokes use its slot (PLAYBOOK.md,
"Rock types"). From the scenes' `rockPreset`:

| Window | Rock slot used | Rock type |
| --- | --- | --- |
| green-1 | 2 | `evad` |
| green-3 | 8 (five land strokes), 2 (three water strokes) | `reefstone` (round 6), `evad` |
| green-4 | 7 | `passrock` (round 6; material `green-passrock`) |
| green-5 | 5 | `ridgestone` (Terraced greenstone, round 2; stepCrease 1 and deeper cracks, 2026-11-19) |
| green-6 | 6 | `ridgeblock` (Blocky ridge, round 3; material `green-darkrock`) |
| green-2, green-7 | none set (0) | the world's own rock (the rock keys in `knobDefaults`) |

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

## Start here (round 9)

Overnight on 2026-11-19 the editor gained **`stepCrease`**, a rock surface
key: a dark crease at each step foot on raised ground, whichever way it
faces (the bank crease `layerCrease` only reaches banks between the sea and
the plain). Green-5's `ridgestone` carries 1: look .339 to .28 (measured;
by eye dark lines follow the ridge's terrace arcs). Unset, every window
renders byte-identical to before.

Round 8 (branch `match-green-9`, 51 of 300 trials; report in
`$R/match/terraform-wt-match-green-9/green/REPORT.md`) was reviewed and
partly ported, measured on top of `stepCrease` and with clamped heights
(port folder `$R/match/terraform-wt-port-green-r8/green`):

- **Ported:**
  - green-5's broad north hill (fixture): look .278 to .251, shape .164
    to .155. Retail's north limb rises from beyond the window's top edge.
  - ridgestone crackSeverity 1.2, crackDark 1: look .251 to .242. By eye
    the ridge rock is grayer with dark crevices.
  - green-4's steep-walled, broad-topped section with diameters x0.85
    (fixture): shape .461 to .391, look .243 to .186.
- **Not ported:** green-4's two raised-massif fixtures (e0be3e1e,
  8549c984). Their shape gain came from heights above 255, which the game
  clamps (14% of cells; retail 1.6%), and their look rose.

The harness now scores our heights clamped to 0-255, as the export writes
them, and warns when more than 2% of a window's cells stand above 255.
That re-based the shape scores: green-5 .12 to .16, green-4 .37 to .46.

Leads, shape first:

1. **Heights over 255.** At the port's tip green-5 has 29% of its cells
   above 255 and green-4 9%; the export flattens them. Lower or reshape
   those strokes so the peaks fit, and check the warning clears.
2. **Green-4's relief room:** retail's floor is about 1 and its peaks reach
   255; ours stands on Green's plain. A map cannot set its own plain or
   sea height (`baseHeight`, `seaLevel` are world config): a proposal for
   the owner, not a round.
3. **Gentle-grade lumps (green-1, green-5):** a world surface layer drawing
   a lit-relief material on slope .03-.1 is untried. Round 8's 041 material
   (green-groundgrain with billow lumps at relief 1.5) matched green-5's
   gentle edges but overshot the plain; as a layer it would reach grades
   only. Note: a surface layer's material relief is not lit (round 6), so
   check by eye that the layer draws lumps, not a tint. Round 7's tufts
   layer pushed green-3's and green-7's clean grades away from retail.
4. **Green-4's clumps and striations:** a clump material built as its own
   graph is still untried.
5. **Green-6's lit faces:** its brightest 1% stays at 107 against 123
   whatever its rock keys do (round 8's 032-034); trace the cause.
6. **Green-1's shelf specks:** an under-water layer with a speckled
   material is untried.

Engine proposals carried for the owner: a map's own plain and sea height;
Time's cut at the art share; a material's palette on level ground;
vegetation overrides that spare rock; `bandLevel` per rock type; a hatch
spacing floor on gentle grades (round 8).

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
