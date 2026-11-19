# Green Planet: dossier

## Windows

`repro/scenes/green-<n>.json`; retail data in `$R/repro-r7/green-<n>/`.

| Window | Retail map | What it tests | Before round 1 | Main after round 2's port |
| --- | --- | --- | --- | --- |
| green-1 | pc games' evad river delta | broken hills (rock type `evad`) by the sea | shape .22, look .10 | shape .22, look .09 |
| green-2 | great divide | long gentle grass slopes, a ridge | shape .16, look .20 | shape .16, look .20 |
| green-3 | the barrier reef | islands and reef shallows | shape .08, look .09 | shape .08, look .10 |
| green-4 | the pass | a rocky massif with grass in its folds | shape .63, look .23 | shape .63, look .23 |
| green-5 | plains and passes | a terraced ridge on a rolling plain (`hill` strokes with Steps, rock `ridgestone`) | shape .18, look .70 | shape .12, look .35 |
| green-6 | wretched ridges | two ridges | shape .24, look .10 | shape .24, look .10 |
| green-7 | two continents | open water and coast: **held out** | shape .19, look .12 | shape .19, look .12 |

Means of the tuning windows: shape .25, look .24 before round 1; shape .24,
look .18 on main after round 2's port (measured 2026-11-18, one render of
all seven windows).

### Which rock each window's strokes use

A rock type changes only the windows whose strokes use its slot (PLAYBOOK.md,
"Rock types"). From the scenes' `rockPreset`:

| Window | Rock slot used | Rock type |
| --- | --- | --- |
| green-1 | 2 | `evad` |
| green-3 | 2 | `evad` |
| green-5 | 5 | `ridgestone` (Terraced greenstone, round 2) |
| green-2, green-4, green-6, green-7 | none set (0) | the world's own rock (the rock keys in `knobDefaults`) |

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

- Green's slope hatch comes from contour bands 1.3 units apart: `banding`
  .6, no jag (`bandJag` 0). Bands do draw on green-5's ridge flanks, but
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

## Start here (round 3)

Round 2 (branch `match-green-3`, 81 of 300 trials, report in
`$R/match/terraform-wt-match-green-3/green/REPORT.md`) was reviewed and
partly ported to main on 2026-11-18:

- **Ported:** the `evad` recipe as cracks and patches in grass, then
  weathered faces (green-1 look .10 to .09; green-3's busy faces calmer, and
  the pale waterline rim mostly gone). Green-5's map: five `hill` strokes
  with Steps (`terraces` 8, `ledge` 30, `terraceJitter` 80, `breakup` 60) on
  a new rock type `ridgestone` (slot 5, round 2's greenstone tuning), and
  its query `undulation=14&undulationArt=0.3`.
- **Changed in the port:** round 2 tuned the shared `greenstone`, which the
  Knob, Cup knoll and Rock fin tools draw; the port moved that tuning into
  `ridgestone` and left `greenstone` as it was. Round 2 kept `undulation`
  14 at full art (look .31), which drew crumpled hummocks on green-5's plain
  that retail's plain does not have; the port keeps the height relief and
  shows 0.3 of it in the art (look .35, shape .12 either way; at 0.6 the
  look is .33). The owner judges that look in the editor.
- **Not ported:** green-6's `greenridge` rock (look .10 to .09). At 1x
  retail's ridges are dark rock with blocky vertical buttresses and a clean
  foot; `greenridge` drew fine horizontal strata, lighter, with a brown
  debris halo at the foot that retail does not have.

Round 2's proposals:

1. **Contour hatch on near-level ground (6.1): built, and mostly not
   Green's gap.** `bandLevel` is now a strength of its own (0 to 2) on slopes
   0.004 to 0.09, gone before the slope class, so it no longer crowds the
   slopes (measured 2026-11-18 on all seven windows: at 2, green-2's slope
   lines .00443 to .00452, where the old reach control took them to .00586;
   at 0 the picture is unchanged). But by eye retail Green's level ground is
   mostly clean. The "level" lines retail has sit on the gentle parts of
   green-2's hatched slope and on green-5's ridge flanks. At 2, green-5's
   look fell .35 to .24 by drawing squiggles across its plain that retail
   does not have: do not keep that. **Green-2's real gap is line
   character:** retail's hatch is thin, faint, even wavy lines about 5 px
   apart across the whole slope (spacing 1.3 fits it); ours are bold black
   dashes in clumps (slope lines .0044 against .0019). Two tries that did
   not fix it (scratch, green-2 alone): band step 3.7 (look .17 but blobby
   ledges, not a hatch) and a lighter line, `world.column.bands` [1.3, 0.4]
   (.27). Next: `bandJag`, `bandSoftness`, `terraceBreak`, and the rock
   type green-2's strokes use; if none gives an even fine hatch, propose a
   control for the bands' dash breakup (fixed noise in `contourBands`).
2. **Thin dark lines on terraced faces (6.2): untested.** It asked to
   "expose" `bandFade`, which the world's data can already set (now listed
   in section 1 of the reference, with the other data-only settings). Probe
   `bandFade` and `terraceCalm` first.
3. **Shallow-water texture (6.3), a noise-warped surface fact for the
   rock/grass mosaic (6.4), a contour-following material node (6.5), a
   shore texture stage (6.6):** each cites trials; none was checked against
   the code yet.

Leads for round 3:

- green-6 still wants dark, blocky, vertically jointed ridges with no
  debris apron: a rock type of its own along those lines.
- green-4's mosaic of rock and grass: round 2's `greenfold` tries (trials
  024 and 075) are the starting point.
- green-2's and green-5's level-ground lines: wait for proposal 1, or try
  `bandFade` and a rock type with its own `banding` on the gentle strokes.

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
