# Green Planet: dossier

## Windows

`repro/scenes/green-<n>.json`; retail data in `$R/repro-r7/green-<n>/`.

| Window | Retail map | What it tests | Before round 1 | After round 2's port | After round 3's port |
| --- | --- | --- | --- | --- | --- |
| green-1 | pc games' evad river delta | broken hills (rock type `evad`) by the sea | shape .22, look .10 | shape .22, look .09 | shape .22, look .08 |
| green-2 | great divide | long gentle grass slopes, a ridge | shape .16, look .20 | shape .16, look .20 | shape .16, look .17 |
| green-3 | the barrier reef | islands and reef shallows | shape .08, look .09 | shape .08, look .10 | shape .08, look .10 |
| green-4 | the pass | a rocky massif with grass in its folds | shape .63, look .23 | shape .63, look .23 | shape .63, look .23 |
| green-5 | plains and passes | a terraced ridge on a rolling plain (`hill` strokes with Steps, rock `ridgestone`) | shape .18, look .70 | shape .12, look .35 | shape .12, look .35 |
| green-6 | wretched ridges | two ridges of dark blocky rock (rock `ridgeblock`) | shape .24, look .10 | shape .24, look .10 | shape .24, look .08 |
| green-7 | two continents | open water and coast: **held out** | shape .19, look .12 | shape .19, look .12 | shape .19, look .12 |

Means of the tuning windows: shape .25, look .24 before round 1; shape .24,
look .18 after round 2's port; shape .24, look .17 after round 3's port
(measured 2026-11-18, one render of all seven windows each).

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

## Start here (round 4)

Round 3 (branch `match-green-4`, 66 of 300 trials, report in
`$R/match/terraform-wt-match-green-4/green/REPORT.md`) was reviewed and
partly ported to main on 2026-11-18. Rounds 1 and 2 are in git history
(this section's earlier versions).

- **Ported:** green-6's own rock type `ridgeblock` (slot 6: 20 px blocks,
  thick beds, deep joints, no debris) with a darker material copy
  `green-darkrock` (look .10 to .08; by eye dark and blocky with a clean
  foot, still less vertical than retail's buttresses). Green-1's query
  `undulationArt=0.3` (look .09 to .08; the dimples are gone).
- **Changed in the port:** round 3 set the contour line darkness to .5,
  which matched the line count but nearly erased the lines and cost green-2
  .03. The port uses .65: green-2 look .20 to .17, slope lines 1.5x retail
  (were 2.35x), no other window moved, held-out green-7 unchanged.
- **Not ported:** the water material change. By eye it put light flecks and
  purple blotches on the open water, which had been a fine diagonal ripple
  like retail's; the shelf it aimed at stayed smooth.

The harness now splits water into `deep` and `shelf`, and level ground into
`flat` (slope under .03) and `gentle` (.03 to .08), so this round's numbers
are not comparable class by class with earlier rounds. The largest findings
at the start of round 4 (measured, the port's base render):

- green-1 `shelf:edges` 0.08x retail: retail's shelf carries dark blue
  specks and streaks, ours a smooth mottle. The deep water is within the
  threshold: a fix must move `shelf`, not `deep`.
- green-1 `flat:edges` 17.6x: by eye our plain's grain is brighter and
  harder than retail's dark, soft grain. The ground material's grain
  contrast, not relief.
- green-5 `gentle:edges` 0.04x and `flat:edges` 0.02x: by eye retail's
  gentle ground near the ridge carries small lumpy wrinkles at 5-15 px with
  light rims, not contour lines; ours has a few long creases. Try
  `wrinkles`, `lumpRelief` and `gentleRelief` before round 3's proposal 6.1.
- green-5 `slope:lines` 0.24x and `steep:lines` 0.35x: the terrace risers'
  dark lines (round 3's 6.2). A wider band step does not draw them
  (measured: slope lines .00108 to .00091 at step 2.6, .00119 at 4), so this
  likely needs a new effect.
- green-3 `shore:edges` 0.35x and green-4 `steep:color` (the rock/grass
  mosaic): round 3 proposed engine work for both without a surface-layer
  trial. Try the surface layers first.
- green-2: the hatch clumps because our slope is lumpy under it; the map's
  `undulation` is not the cause (measured: at 0, or with its art share at
  0, the slope crop renders the same). Look at the strokes' `heightVary`,
  `widthVary` and `varySize`, and at the world's relief controls.

Round 3's proposals, checked:

1. **6.1, lines on gentle grades but not plains:** doubtful for green-5
   (see above). On green-2 retail's hatch starts where the plain turns into
   slope. If it is still wanted, `bandLevel`'s slope range (0.004 to 0.09)
   may simply start too low, which is a retune, not a new control.
2. **6.2, a dark line on terrace risers:** holds (measured above).
3. **6.3 mosaic and 6.4 shore texture:** not evidenced; no surface-layer
   trials.
4. **6.5, the ground's grain:** its Scatter evidence was wrong (see the
   brief's rules of evidence). Retry with dots of 1 px or more.

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
