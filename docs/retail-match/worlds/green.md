# Green Planet: dossier

## Windows

`repro/scenes/green-<n>.json`; retail data in `$R/repro-r7/green-<n>/`.

| Window | Retail map | What it tests | Before round 1 | After round 6's port | After round 7's port |
| --- | --- | --- | --- | --- | --- |
| green-1 | pc games' evad river delta | broken hills (rock type `evad`) on a rolling plain by the sea | shape .22, look .10 | shape .13, look .07 | shape .135, look .067 |
| green-2 | great divide | long gentle grass slopes, a ridge | shape .16, look .20 | shape .16, look .19 | shape .16, look .19 |
| green-3 | the barrier reef | islands (rock type `reefstone`) and reef shallows | shape .08, look .09 | shape .08, look .09 | shape .08, look .09 |
| green-4 | the pass | a rocky massif with grass in its folds (rock type `passrock`) | shape .63, look .23 | shape .37, look .24 | shape .37, look .24 |
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
round 6's port (measured 2026-11-19); shape .18, look .17 after round 7's
port (green-1 alone moved; measured 2026-11-19). One render of all seven windows each.

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

## Start here (round 8)

Round 7 (branch `match-green-8`, 42 of 300 trials, a background agent that
stopped early to keep room for its report; report in
`$R/match/terraform-wt-match-green-8/green/REPORT.md`, notes in `NOTES.md`
beside it) was reviewed and partly ported to main on 2026-11-19. Earlier
rounds' starts are in git history.

- **Ported:** green-1 paints Relaxation: less (channel 19, the erosion-rate
  override) at 60 along its coastal plain, clear of the hills. Measured
  without the tufts layer below (port trials 001 against 000): look .0681
  to .0673, shape .128 to .135, shore:dark cleared. By eye the plain's lit
  creases are fewer and fainter.
- **Not ported:** a world surface layer of grass tufts on gentle grades
  (round 7's fd575509, amount .4, slope .03-.1). Every window's look fell a
  little (mean .1701 to .1663, held-out .1207 to .1183), but at 1x it is
  close to invisible: a faint 1-2 px grain on green-1, a slightly darker
  speckle on green-5 (trial-027 and trial-041 gentle crops). It also pushes
  green-3's and green-7's clean grades away from retail (gentle edges
  .0012 to .0039 and .0003 to .0032, retail .0005 and .0003). Retail's
  10-20 px lit lumps are still missing.

The harness now lists every paint channel (REFERENCE.md, section 7, "Paint
channels") and names each window's paint strokes by channel. PLAYBOOK.md's
map lane covers painted styles and overrides (channels 8-25), with round 7's
cautions.

Checked in the review:
- **Green-1's creases** are Time cutting the rolling undulation: Time is
  seeded from the game height with the undulation (engine-feed.wgsl
  `seedMain`), and its change is added to the art before the art subtracts
  the undulation it hides (lines 169-172). Round 7's proposal (the art takes
  Time's change in the undulation at the `undulationArt` share) is engine
  work for the owner, not a round.
- **Palette 169 on every plain** (10-12% against retail's under 3%): a
  material's palette list limits only its unlit colors; the output stage
  (engine-output.wgsl) reduces the lit color to the whole palette, by the
  owner's design (TERRAIN_ENGINE.md decision 25). Round 7's proposal stands
  as a question for the owner.

Data gains are shrinking: the mean look went .174 to .170 over rounds 6
and 7, and most of round 7's findings were engine limits. **The shape lane
has the clearest gaps left; start there:**

1. **Green-5's west limb** is steeper and narrower than retail's: retail's
   contours spread over about 180 px, ours over about 80 px (round 7,
   trial-000 `scenes/green-5/layout.png`). Move or widen its strokes.
2. **Green-4's massifs** are less steep than retail's (slope over 2 on 15%
   of cells against 22%), and its middle massif is narrower (round 6).
3. **Green-2's slope share** is 50% against retail's 39% (its fixture is
   too sloped); a concave back section fixed the shape but moved the hatch
   out of the gentle class (round 6's 046). Try the strokes' width and
   spacing instead.
4. **Green-4's clumps and striations:** a clump material with retail's
   clump mean and no bright tail, built as its own graph (not a `like`
   recolor), is untried. Every brighter clump ground so far raised the
   brightest 1% and the thin lines (round 7's 013-015).
5. **Gentle-grade lumps differ about 20x between maps** (retail gentle
   edges: green-5 .0274, green-1 .0103, green-3 .0005, green-7 .0003), so
   they are a map choice, not a world layer. A lit-relief ground painted on
   one map's grades reaches them (round 6's 057 and 092) but also its plain.
6. **Untried:** `erosionRain` above 1; green-6's caps (round 5's trial-047,
   faceShade .6); green-3's shore rings (its shore is 1% of the window);
   green-1's shelf streaks.

Engine proposals carried for the owner: Time's cut at the art share (above);
a material's palette on level ground (above); vegetation overrides that
spare rock (round 7); `bandLevel` per rock type (rounds 6-7); riser lines on
stroke terraces (four rounds).

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
