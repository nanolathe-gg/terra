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
| green-4 | 7 | `passrock` (round 6; material `green-passrock`; faceBed 8, blocks 6, no gloss since round 11), with ground `green-clump` (slot 15) |
| green-5 | 5 | `ridgestone` (Terraced greenstone, round 2; stepCrease 1 and deeper cracks, 2026-11-19) |
| green-6 | 6 | `ridgeblock` (Blocky ridge, round 3; material `green-darkrock`) |
| green-2 | 9 (ridge stroke) | `divide` (round 12: bandLevel 2, bandFill 1) |
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

## Start here (round 14)

Round 13 (branch `match-green-14`, 48 of 300 trials; report in
`$R/match/terraform-wt-match-green-14/green/REPORT.md`) was reviewed and
ported on 2026-11-20. Mean shape .134, look .126 to .125; held-out green-7
unchanged (.192/.102).

- **Green-4's ground as clumps on gray rock:** `green-clump` mixes its green
  with dark grays through a 3.5 px Clumps noise and a sharp Levels edge
  (palette + grays 90-94); passrock faceRock .55 to .45. Look .201 to .198,
  steep:lines cleared. By eye (trial-012 steep crop) the solid green slabs
  break into clumps through the rock, as retail's do. Cost: steep luma 50 to
  47 (retail 55); the pale ledge streaks and retail's black east shadows remain.
- **Green-1's coastal pits come from the ground roll, not Time:** they stay
  with erosion=0 (its 023) and go at undulation 5 (024, shape .169). The
  Relaxation: less paint stays. The round's guess, `groundLifted`'s height
  fade (sea+1..sea+8), is ruled out: with the fade removed, green-1 without
  its paint renders byte-identical (reviewer's throwaway edit, 2026-11-20;
  a 3x roll in the same file changed 6.8% of pixels, so it was loaded).
- **Green-5's slope risers are out of reach of data:** every kind of lever
  was tried (rock 031-034, map 030/035, material and layer 036-038, 048);
  slope lines stay .0018 against .0045. A layer's material relief is unlit,
  so lined materials read as smudges (proposal: lit micro-terraces).

Leads:

1. **Green-4's brightness without line noise:** its largest look term is the
   mean brightness (54 against 62). Every brighter material or rock raised
   lines more than it gained (009, 010, 014). Steps 0 shortens the pale
   streaks (004, look .16) but loses the shape; try Steps 2-3 with ledge
   15-30, and a rock material copy without the brightest grays.
2. **Green-6's ribbed faces:** gullies 100 with gullySize 70 follow retail's
   spurs (040: shape .182 to .149) but the face texture costs look .083 to
   .118. Try a ridgeblock material with vertical streaks, then both together.
3. **Green-1's shelf:** green-3's shelf already matches, so the gap is
   green-1's; try a rock type for green-1's water strokes, as green-3's
   reefstone.
4. **Gentle crinkle** (green-5's gentle grade, green-2's lines): a layer
   material that bakes its relief through a Light node, instead of dark lines.
5. Shape presets and the contour-line levers were not reached.
6. **New since round 13** (harness and editor, 2026-11-20): a scene may set
   its map's own water (`shallowDepth`, `deepDepth`, `bedTint`, `bedBright`,
   `bedContrast`, `bedCracks`, `wetBand`; green-1's shelf is the candidate);
   the damp band `wetBand` is a World control; `faceScratch` is the lever
   for green-6's down-slope ribs; one metric counts at most 3 family band
   widths in a score.

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
