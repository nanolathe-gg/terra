# Green Planet: dossier

## Windows

`repro/scenes/green-<n>.json`; retail data in `$R/repro-r7/green-<n>/`.

| Window | Retail map | What it tests | Before round 1 | After round 5's port | After round 6's port |
| --- | --- | --- | --- | --- | --- |
| green-1 | pc games' evad river delta | broken hills (rock type `evad`) on a rolling plain by the sea | shape .22, look .10 | shape .22, look .08 | shape .13, look .07 |
| green-2 | great divide | long gentle grass slopes, a ridge | shape .16, look .20 | shape .16, look .19 | shape .16, look .19 |
| green-3 | the barrier reef | islands (rock type `reefstone`) and reef shallows | shape .08, look .09 | shape .08, look .11 | shape .08, look .09 |
| green-4 | the pass | a rocky massif with grass in its folds (rock type `passrock`) | shape .63, look .23 | shape .63, look .24 | shape .37, look .24 |
| green-5 | plains and passes | a terraced ridge on a rolling plain (`hill` strokes with Steps, rock `ridgestone`) | shape .18, look .70 | shape .12, look .34 | shape .12, look .34 |
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
round 6's port (measured 2026-11-19). One render of all seven windows each.

### Which rock each window's strokes use

A rock type changes only the windows whose strokes use its slot (PLAYBOOK.md,
"Rock types"). From the scenes' `rockPreset`:

| Window | Rock slot used | Rock type |
| --- | --- | --- |
| green-1 | 2 | `evad` |
| green-3 | 8 (five land strokes), 2 (three water strokes) | `reefstone` (round 6), `evad` |
| green-4 | 7 | `passrock` (round 6; material `green-passrock`) |
| green-5 | 5 | `ridgestone` (Terraced greenstone, round 2) |
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

## Start here (round 7)

Round 6 (branch `match-green-7`, 94 of 300 trials, run by a background
agent that ran out of working memory; report in
`$R/match/terraform-wt-match-green-7/green/REPORT.md`, notes in `NOTES.md`
beside it) was reviewed and partly ported to main on 2026-11-19. Earlier
rounds' starts are in git history (this section's earlier versions).

- **Ported:**
  - Green-4's nine landform cards on the lfMountain section, gullies 50,
    cracks 20, with a new rock type `passrock` (slot 7: faceRock .55,
    faceGrass .8, material `green-passrock`). Shape .63 to .37 (measured);
    by eye a rock-and-grass mosaic like retail's instead of grassy mesas
    between gray bands.
  - Green-3's land strokes on a smooth rock type `reefstone` (slot 8),
    cracks 20; its water strokes keep `evad`. Look .106 to .094 (round 6's
    trial-023).
  - Green-1's rolling plain, `undulation=10` with its lump paint at 30.
    Shape .22 to .13, look unchanged (.08). The review then set its
    `undulationArt` to 0 (.3 drew an even pale dimple texture over the
    whole plain): look .080 to .068 (port trial-005).
- **Not ported:**
  - Green-5's `green-groundlumps` (its speck grass with lit 5 px relief).
    Look .339 to .332, but its 8 px texture and tone spread move away from
    retail (1.57 against 1.45; 16.2 against 13.9), and by eye it is coarser
    and brighter than retail's fine, even plain. Round 5's mottle was held
    for the same reason.
  - Green-1's `green-shelfbed` (light streaks on the shelf). Its brightest
    1% matched retail's 154.5 but the look did not move (.0800 to .0801),
    and at 1x the streaks barely show. It cost a material slot.

The harness now names the material each window's `groundPreset` lays
(REFERENCE.md, section 7) and warns when a stroke's ground slot lays a role
or surface-layer material: a new surface layer's material takes a slot
ahead of `world.materials.extra` and moves every later one (round 6's
trial-032 turned green-5's plain into sand). The brief tells an agent that
cannot write REPORT.md to put the report in its final message.

The largest findings at the start of round 7 (measured, the port's base
render, `$R/match/terraform-wt-port-green-r6/green/trial-000`):

- green-1 `gentle:edges` 0.08x and `gentle:band32` 2.49x; `shelf:edges`
  0.19x and `shelf:light` 134 against 154; `slope:share` 21% against 14%.
- green-2 `gentle:lines` 0.28x and `slope:share` 50% against 39%.
- green-3 `gentle:band32` 2.72x and `shore:edges` 0.40x.
- green-4 `steep:lines` 1.81x and `steep:light` 123 against 114: bright
  diagonal striations across the faces that retail lacks (by eye, the
  port's green-4 steep crop). Its shape gap is now steepness: slope over 2
  on 15% of cells against retail's 22%.
- green-5 `gentle:edges` 0.11x, `flat:edges` 0.24x, `slope:lines` 0.21x.
- green-6 `steep:light` 107 against 123.

Leads:

1. **Green-1's creases.** Its rolling heights are lit, so the plain shows
   long dark creases that retail's flat-drawn art does not (by eye, the
   port's green-1 flat crop). `undulationArt` 0 leaves them (port
   trial-001), so they come from lighting the heights, not the art share.
   Look for a control that softens light on low relief (relief and light
   settings in REFERENCE.md), or say what is missing.
2. **Green-4's striations and clumps.** passrock's faces carry bright
   diagonal streaks. Round 6's diagnostics (095/096) showed a card's own
   ground reaches the face grass: `green-ledgegrass` (like green-ground
   #5a9c2c) matched retail's clump color (39,93,23 against 38,92,17) but
   lines rose to 4.9x. Try it with passrock's joints and scratches lower.
   Its shape gap is the next shape step: retail's massifs are steeper, and
   its middle massif is wider.
3. **The two-tone moss rock is closed.** Without the `color` key (round 6's
   049, 075) clumps read as a green tint, not discrete clumps: `rockGrain`
   keeps a third of a material's hue around its mean. A face's discrete
   green comes from faceRock and faceGrass, which passrock uses.
4. **Gentle-grade lumps (round 6's first proposal).** Confirmed in the
   code: a surface layer's material relief only shifts the layer's edge
   (engine-frag.wgsl, the rule's `lift`); only a painted ground's relief is
   lit (`groundHeightFor` reads the painted slot). A painted relief ground
   reaches grades but also the plain (round 6's 057, 092).
5. **Gentle-grade hatch (its second proposal).** A contour line's strength
   is the rock type's `banding`, scaled by Banding paint, times the slope
   gate, and `bandLevel` is that gate on near-level ground. Green-2 already
   paints Banding more (channel 12, amount 100), yet a small world
   `bandLevel` barely moves its gentle lines: .28x retail to .33x at .3
   and .22x at .6 (port trials 003/004). The data cannot reach it; the
   proposal (a per-map or per-rock `bandLevel`) holds.
6. **Riser lines** on green-5 hold for a fourth round.
7. **Untried:** green-3's shore rings (shore edges .40x); the plain's
   palette mix (retail's two main entries are 168 at 39% and 72 at 22%;
   ours puts 13% on 169, which retail uses for 1%); green-6's caps
   (round 5's trial-047, faceShade .6, improved its look and was dropped).

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
