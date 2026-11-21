# Green Planet: dossier

## Windows

`repro/scenes/green-<n>.json`; retail data in `$R/repro-r7/green-<n>/`.

| Window | Retail map | What it tests | Before round 1 | After round 11's port | After round 12's port |
| --- | --- | --- | --- | --- | --- |
| green-1 | pc games' evad river delta | broken hills (rock type `evad`) on a rolling plain by the sea | shape .22, look .10 | shape .135, look .054 | shape .146, look .054 |
| green-2 | great divide | long gentle grass slopes, a ridge | shape .16, look .20 | shape .128, look .159 | shape .128, look .139 |
| green-3 | the barrier reef | islands (rock type `reefstone`) and reef shallows | shape .08, look .09 | shape .08, look .091 | shape .08, look .071 |
| green-4 | the pass | a rocky massif with grass in its folds (rock type `passrock`) | shape .63, look .23 | shape .39, look .169 | shape .146, look .201 |
| green-5 | plains and passes | a terraced ridge on a rolling plain (`hill` strokes with Steps, rock `ridgestone`) | shape .18, look .70 | shape .126, look .209 | shape .12, look .206 |
| green-6 | wretched ridges | two ridges of dark blocky rock (rock `ridgeblock`) | shape .24, look .10 | shape .18, look .083 | shape .18, look .083 |
| green-7 | two continents | open water and coast: **held out** | shape .19, look .12 | shape .19, look .102 | shape .19, look .102 |

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
after round 8's port; shape .18, look .133 after round 9's (held-out .102); shape .174, look .128
after round 10's. One render of all seven windows each.

### Which rock each window's strokes use

A rock type changes only the windows whose strokes use its slot (PLAYBOOK.md,
"Rock types"). From the scenes' `rockPreset`:

| Window | Rock slot used | Rock type |
| --- | --- | --- |
| green-1 | 2 | `evad` |
| green-3 | 8 (five land strokes), 2 (three water strokes) | `reefstone` (round 6), `evad` |
| green-4 | 7 | `passrock` (round 6; material `green-passrock`; faceBed 8, blocks 6, no gloss since round 11), with ground `green-clump` (slot 15; groundEdge 30 since round 16) |
| green-5 | 5 | `ridgestone` (Terraced greenstone, round 2; stepCrease 1 and deeper cracks, 2026-11-19; round 16: material `green-passrock` (shared with passrock), faceGrass .15, moonFolds 0) |
| green-6 | 6 | `ridgeblock` (Blocky ridge, round 3; material `green-darkrock`) |
| green-2 | 9 (ridge stroke) | `divide` (round 12: bandLevel 2, bandFill 1; round 16: faceMass 0) |
| green-7 | none set (0) | the world's own rock (the rock keys in `knobDefaults`) |

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

## Start here (round 17)

Round 16 (branch `match-green-17`, 90 of 300 trials; report in its final
message, notes and evidence pictures in
`$R/match/terraform-wt-match-green-17/green/NOTES.md` and `evidence/`).
Measured, trial-090 against trial-000: mean shape .104 (unchanged), look
.111 to .090; held-out green-7 unchanged at .19/.102 (holdout-004), but none
of the keeps reaches it (its hills use rock slot 0 and no keep touched the
world's own rock or its list), so "unchanged" means not reached.

- **Green-5 (.198 to .078, four commits on ridgestone):** moonFolds 0 (the
  world's folds at spacing .5 run closer than a pixel on its flanks and only
  smudge them darker; trial-006), faceGrass .15 (the ridge is bare gray
  rock; trial-013), the pale massif rock `green-passrock` (trial-014;
  without it the final state scores .150, trial-073), faceLayers back at 1.5
  after a dip to .2 (trials 015/016). Net ridgestone change: material,
  faceGrass .45 to .15, moonFolds 0. Cleared steep:color, steep:light,
  slope:edges, slope:lines; gentle:light and slope:light (lit grass at 164,
  128 luma) are new.
- **Green-2 (.124 to .117):** divide faceMass 0 (trial-024): finer, darker
  crevices on the painted face; steep:lines cleared.
- **Green-4 (.149 to .148):** its strokes' groundEdge 30 (trial-085) ends
  the clump ground before the plain, so the speck apron at the massif's foot
  is gone (flat edges equal retail's).
- **Measured, not kept:** world moonFolds 0 (green-5 -.05, green-2 +.08:
  trial-005); worms .3 (green-2 .117 to .0995, every other window worse:
  trial-040); gentlelumps amount 0/.5 (green-7's gentle edges clear, but its
  look rises on edge-orientation shares: trials 028/069, holdout-002/003);
  divide faceLayers 1.6 (green-2 .0996 but the score is non-monotonic in
  faceLayers, .117/.0996/.137 at 1/1.6/2, and slope lines shrink only 2.05x
  to 1.70x: trials 051/052).

Leads:

1. **Green-4 (.148, worst):** every passrock knob tried sits at a local
   optimum (faceStrata, faceRock/faceGrass, faceLedge, faceWet, a darker
   material: trials 017-019, 036, 059-062). Its window luma 56 against 62
   and the missing pure-black shadows (retail 8% at 0,0,0) point at the
   light, which is the owner's.
2. **Palette:** retail's grass dithers 168 (36%) with 72 (21%); ours draws
   169 (13%) that retail barely uses, because the output stage re-dithers the
   lit color over the whole art palette (engine-output.wgsl), so a
   material's palette list does not pick output indices (trial-037).
3. **Green-2's slope:** the soil terraces (faceLayers) make the 8 px lumps
   and also break the contour lines; without them the lines run 3x retail
   (trial-049), and banding low enough to lighten them removes them
   (trial-084).
4. **Green-5 step lines** and **green-6's shadowed faces** still wait on the
   engine (round 15's notes; a convexity layer draws blobs, not lines:
   trial-032).

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
