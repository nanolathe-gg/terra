# Green Planet: dossier

## Windows

`repro/scenes/green-<n>.json`; retail data in `$R/repro-r7/green-<n>/`.

| Window | Retail map | What it tests | Base (trial-000) |
| --- | --- | --- | --- |
| green-1 | pc games' evad river delta | broken hills (rock type `evad`) by the sea | shape .22, look .10 |
| green-2 | great divide | long gentle grass slopes, a ridge | shape .16, look .20 |
| green-3 | the barrier reef | islands and reef shallows | shape .08, look .09 |
| green-4 | the pass | a rocky massif with grass in its folds | shape .63, look .23 |
| green-5 | plains and passes | grassy hills (library `hill` strokes) | shape .18, look .70 |
| green-6 | wretched ridges | two ridges | shape .24, look .10 |
| green-7 | two continents | open water and coast: **held out** | (run `--holdout`) |

Mean of the tuning windows at the base: shape .25, look .24 (measured,
trial-000 on main 2f1bbeaf).

### Which rock each window's strokes use

A rock type changes only the windows whose strokes use its slot (PLAYBOOK.md,
"Rock types"). From the scenes' `rockPreset`:

| Window | Rock slot used | Rock type |
| --- | --- | --- |
| green-1 | 2 | `evad` |
| green-3 | 2 | `evad` |
| green-2, green-4, green-5, green-6, green-7 | none set (0) | the world's own rock (the rock keys in `knobDefaults`) |

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
  green-5 slope `lines` retail .0043, ours .0002).
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
  edges (measured: green-3 water `edges` retail .005, ours .017).

## Known from earlier rounds (docs/BIOME_CATALOG.md, "Green Planet")

- Green's slope hatch comes from contour bands 1.3 units apart: `banding`
  .6, no jag (`bandJag` 0). Bands do draw on green-5's ridge flanks, but
  faintly (measured 2026-11-18: doubling `banding` changed 8.5% of green-5's
  pixels, all on the flanks), and never on its plain, because they start at
  slope 0.07. `bandLevel` (new) moves that start down. A rock type carries
  its own `banding`, so a map's strokes can have stronger bands than the
  world's own rock.
- Lighting on Green was set by the owner (2026-11-15) and stays unless a
  change is clearly better on every window.
- No rock coasts on Green. Shores are a natural sand-grass edge.
- Hills must stay grassy. Rock on a hill is cracks and patches, not a cap.

## Start here (round 2)

Round 1 (branch `match-green-2`, 42 trials, report in
`$R/match/terraform-wt-match-green-2/green/REPORT.md`) kept two changes that
did not land on main, and wrote six proposals. On review, three proposals
held and three came from the harness, which is now fixed:

- **`undulation` is a map setting.** Every Green scene sets `undulation=3`
  in its query, so the world's value never reached a window, and round 1's
  `--query undulation` probes were silently ignored. `--query` now wins, and
  the map lane lets one window change its own. Measured on green-5 alone:
  `undulation` 6 and 10 took its level share from 57% to 52% and 48%
  (retail 43%) and its look from .70 to .68 and .66. Green-1's plain is the
  opposite: busier than retail (level edges ours .0072, retail .0017, the
  dimples of `undulation=3` at 48 px), so it may want less.
- **The "bluer wet shore" was a measuring artifact** (water pixels in
  retail's shore mask: 12.8% on green-3). Without them the two shores match
  within 2 units of each channel. Ignore round 1's proposal 6.3 color half.
- **Round 1's `stepSoftPx` 5 keep** cleared `water:edges` only by dropping
  under a floor that has since been lowered: not a clear. Re-judge it.

Leads, strongest first:

1. **Re-apply the `evad` recipe** from round 1's commit e64ec6dd (the
   pilot's trial-004): `faceRock` .35, `faceGrass` .8, `crackMajor` 1. Its
   rock reads as cracks and patches in grass on green-1 and green-3, as
   retail's does (by eye, twice). Then tune it.
2. **Green-5 as a stepped ridge** (the map lane). Measured 2026-11-18 on
   green-5 alone: its five `hill` strokes with `terraces` 8, `ledge` 30,
   `terraceJitter` 80, `breakup` 60 took its look from .70 to .56 with
   `rockPreset` 4 (escarpment) and .59 with 3 (greenstone); by eye the
   greenstone's gray strata read closer. Retail's ridge is a broad gray rock
   belt with ragged dark grass ledges around it; ours gets the gray belt
   but not yet the ledges in the grass. Try a rock
   type of its own for that ridge (stronger `banding`, `faceLayers`), and
   the map's `undulation`.
3. **`bandLevel`** (new, 0 to 1). Measured on all windows at 1: green-3 .09
   to .08, green-5 .70 to .68, green-2 .20 to .31 (its slopes already carry
   too many lines, and more reach them). Try it with a lower `banding` or
   `bandFade`, and look at green-2's and green-3's level crops.
4. **Green-4's rock mosaic** was never tried with a rock type: its strokes
   use the world's own rock. Give them one (map lane) before calling it an
   engine gap.
5. **Green's ground material and slope material** were never edited in
   round 1. The plains read brighter and more contrasty than retail's soft
   olive on green-1 (by eye).

Still open as engine questions (round 1's proposals that held): retail's
ragged grass ledges beyond a ridge's rock (6.5, partly reachable with Steps
above), and bands on near-level ground (6.1, now `bandLevel`).

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
