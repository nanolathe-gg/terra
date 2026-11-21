# Red Planet: dossier

## Windows

`repro/scenes/red-<n>.json`; retail data in `$R/repro-r7/red-<n>/`.

| Window | Retail map | What it tests | Before round 1 |
| --- | --- | --- | --- |
| red-1 | red planet (2560,896) | a rolling plain with a big shallow basin, a crescent and a mesa, ponds and craterlets | shape .21, look .38 |
| red-2 | red river (2560,2880) | a lake with a finely terraced bank, rough cracked upland in the NW corner, one knob | shape .32, look .27 |
| red-3 | gods of war (256,576) | a coast: rough rock bank, lavender shelf, deep water (held out in rounds 1-2; tunes from round 3) | shape .14, look 1.49 |
| red-4 | red triangle (6656,2048) | a sea coast: the NW corner of the triangle's eastern island; low banks (a 0-8 terrace in the N and NW, a gentle ramp in the S), a lavender shelf about 100-250 px wide, deep water in the N corners, plain at 30 behind: **held out** (added round 3) | see round 3's holdout-000 |

Means of the tuning windows at the base (main 50328b75): shape .27, look .33.

### Which rock each window's strokes use

| Window | Rock slot used | Rock type |
| --- | --- | --- |
| red-1 | 4 on every stroke (round 2) | `softface` (faceRock 0, rockFaceFrom .5): no rock shown, face construction only from slope .5 |
| red-2 | 2 on the knob stroke (round 1); the rest unset | `darkknob` (crust -.3, rockFace 2, the world's rock material) |
| red-3 | none set | the world's own rock |
| red-4 | none set | the world's own rock |

`rubble` (slot 3) reaches no window. red-2 paints Rock (channel 1, amount
80) over its knob; red-3 paints Rock in five strokes. Re-check with
`grep -o '"rockPreset": [-0-9]*' repro/scenes/red-<n>.json`.

## What Red's retail looks like at 1x

By eye, from the base crops in `<out>/trial-000/classes/crops/` and the
pairs.

- **Plain (flat):** even rust (mean luma 74) with fine red/orange dither and
  dark 1-3 px specks spaced about 10-15 px. Very little broad mottling
  (`flat:band32` retail .68-.78, ours 1.0-1.1): ours draws darker and lighter
  blotches of 20-40 px (red-1 and red-2 `flat.png`).
- **Gentle ground:** red-1's retail plain rolls: 14% of the window is at
  slope .03-.08 against our 3%, and only 19% is flat against our 45%. In
  red-2 the gentle class is the NW upland: rough, crumpled ground cut by a
  polygon network of dark cracks, cells about 30-50 px, with the darkest
  specks of the window (luma 20; `gentle.png`). Ours is smooth plain there.
- **Slopes:** lumpy, finely crumpled relief lit from the west; on red-2's
  lake bank, many fine concentric lines 3-6 px apart (`slope.png`). Ours
  draws a few broad jittered terraces and long dark lines.
- **Steep (rims, crescents, knobs):** broad, rounded, dark and streaked;
  fine vertical ribs down a knob, a dark lee, a small lit crest. No black
  crack lines and nothing brighter than luma 88. Ours draws thin rings with
  hard dark lines (red-1) and a blotchy dark-and-light knob (red-2), with
  pixels up to luma 108.
- **Shores:** red-1 has almost none. red-2's bank is mid brown (luma 67);
  ours is darker (56). red-3 (held out) shows the coast: a broad,
  mid-brown, rough rock bank. Ours lays a near-black wet band (shore luma
  24 against 52).
- **Water:** the shelf is a light lavender with dark purple spots (the
  plain's specks seen through it), no crack network. Ours draws a polygon
  crack web on the shelf (`bedCracks`), and red-3's shelf is too bright (92
  against 65) where red-2's is a little dark (90 against 100).

## Known before round 1 (docs/BIOME_CATALOG.md "Red Planet";
`$R/agent-biome-match/out/catalog/red/catalog.md`)

- Retail Red is lit from due west; `sunTilt` 0 is set for that. The
  owner kept Red's lighting changes (2026-11-15).
- Knobs rise 80-94 over a 180-220 px foot, dark (median luma 38) with
  vertical streaks; the catalog found no streak texture for rock faces.
- Ring-crater rims are a broad rubble band; ours a thin crack line.
- `shoreRock` 96 gives the sea coasts a rock bank but grows a dark halo
  round ponds; retail ponds have a thin ringed bank.
- Crack-network patches (cells 30-50 px, rise under 12) recur on waiting,
  spider, king of the hill and red river.
- Retail's plain sits at 85 with the sea 5-38 below it.

## Start here (round 3)

Round 2 (branch `match-red-2`, 122 of 300 trials; report in the round's
final message, notes in `$R/match/terraform-wt-match-red-2/red/NOTES.md`)
took the mean from shape .14, look .17 (trial-000) to shape .13, look .09
(trial-120: red-1 .11/.10, red-2 .14/.08); held-out red-3 .86 to .83
(holdout-006). Kept: `wetBand` 4 in knobDefaults; red-2's own water
(deepDepth 100, bedCracks 0); red-1's strokes on a new rock type
`softface` (slot 4: faceRock 0, rockFaceFrom .5); red-1's plain rolls
more (undulation 8, cover .75). Held at review: darkknob drawing
`red-knob`, a rock material of vertical ribs (red-2 .10 to .08, trial-091):
its waves run straight down the screen on every face of the dome, top and
east-west flanks included, so the knob reads as a barcode where retail's
is a fine even texture (`<out>/crops/r2knob4.png`); and it would draw
those stripes on every Knob and Crescent tool. Its graph is in the round's
trial-091 candidate.diff. A world faceRock 0 and then Smooth soil on
red-1 were kept and replaced: Red's real cliffs are fluted rock
(`$R/agent-biome-match/out/catalog/red/crops/cliff-ashap_plateau.png`),
and soil made red-1's steep edges 15x retail.

Leads:

1. **Red-1's faces** on softface still draw 5.2x retail's steep edges,
   and the lit side reaches luma 108 against 88 (trial-120). The face
   construction's start trades edges for score: from slope .2 the window
   reads .19 at 2.6x, .35 .13 at 2.9x, .5 .10 at 5.2x, .8 .12 at 9.9x;
   Smooth soil .12 at 15.5x (trial-113, 118, 117, 119, 111). Darker
   red-slope tops clear steep:light but cost red-2 .03 (trial-122).
   Relief .8 stays the owner's call (relief .5: trial-083).
2. **Red-2's NW upland** (largest finding, gentle edges 0.00x): retail's
   upland is pitted 2-8 units in 30-50 px polygon cells. A material of
   lit 40 px cells with soft dark borders (`red-crumple`, diff in the
   round's folder) draws the network by eye (trial-071), but our heights
   there stay level, so the gentle class never forms; a cut landform
   with heightVary pits the heights but reads crumbly (trial-041/042/073).
3. **Red-2's bank**: shore edges 6.2x and slope edges 3.4x retail; the
   relief draws them (relief .5 halves slope edges, trial-083). Waterline
   controls, shoreRock, bankRock, the dry bank's edge and soil on the bank
   strokes moved little (trial-060..065, 082, 105, 106).
4. **Red-3's sea shelf** reads 92 against 65, its share 25% against 15%.
   World deepDepth 26 (red-2 keeps its own 100) takes red-3 .83 to .80
   and red-1 .12 to .11 (trial-104, holdout-005), but was judged mainly
   on the held-out window and not kept. No tuning window has a sea.
5. **Red-3's coast rock** is blotchy near-black: world rock faceTone .5
   (its maximum). faceTone .15 calms red-2's knobs by eye at the same
   score (trial-107; darkknob .1 in trial-092), not kept (its finding
   moved under a third). Red-3's thin dark pixels (236) are dark rock
   specks poking into the shelf along its north coast, not the damp band.
6. **wetBand**: 4 suits the tuning windows; red-3 prefers 1 (holdout-002
   .81 against .83). At 1-2, red-2 gains about 40 thin dark pixels: the
   shadow seam at its island knob's waterline, which crosses the line
   threshold as the bank lightens (trial-049). crispShore .5 removes it
   on red-2 but costs red-1 (trial-053..055).
7. **The dry-bank layers** still earn their place at wetBand 4 and 1
   (trial-056/057).
8. Red-2's strokes follow the retail water footprint to within a stroke
   width; moving the second bank stroke east made the look worse
   (trial-099/100). The stroke `cracks` field is live but gated by world
   crackSeverity 0.

9. **Relief on red-1's faces:** Relief weaker paint (channel 9) at 100 over
   the crescent, mesa and basin rims clears steep:edges (5.2x to under 2x)
   but raises red-1's look .10 to .13 (reviewer's diagnostic, 2026-11-20); at
   50, steep edges 2x and the same look. So the edge count is not what holds
   the look; the lit side (108 against 88) and the 32 px patches are.
10. **The knob's ribs** (held, above): try a finer, fainter texture that
   does not run one screen direction, or faceScratch (grooves follow the
   face), and keep the knob's lit top plain.

Reviewer's notes from round 2 still to settle: relief .8 (owner's call),
and red-1's softface (by eye its crescent and mesa read softer and closer to retail, trial-120 pair).

## Start here (round 2, done)

Round 1 (branch `match-red`, 88 of 300 trials; report in
`$R/match/terraform-wt-match-red/red/REPORT.md` or the round's final
message) took the mean from shape .27, look .33 to shape .14, look .17
(trial-084); held-out red-3 1.49 to 1.20 (holdout-003). Kept: red-1's
ground roll, red-2's steeper knob on darkknob, calmer red-rock, a
shallower world rock face, stronger ground relief, weaker plain bumps,
Red's own ground `red-plain`, a world surface list with a dry bank by the
water, and red-1's own wider dry bank.

Leads:

1. **The damp band** is now a World control, `wetBand` (Water & shores;
   Red's material table sets 13). It darkens ground up to 13 units above
   the sea and rock up to 52: red-3's near-black coast and red-2's dark
   bank. At 1, every red-3 shore finding clears (reviewer's holdout
   diagnostic). Choose its value on red-1 and red-2, check red-3, then
   re-trial without the two dry-bank layers, which worked around it.
2. **Relief .8** scores best but puts red-1's steep edges at 6x retail
   and red-2's bank edges at 3.4x; .5 halves them and costs .026 of mean
   look (trial-088).
3. **Red-2's NW upland** (its largest finding): retail's plain is pitted
   2-8 units with soft polygon cracks. Fissure networks draw thin dark
   lines the look score punishes; lumps paint lands in the flat class.
4. **Water by map:** red-2's river stays light to depth 24, red-3's sea
   darkens from depth 8. Red renders shallowDepth 2 and deepDepth 42 (its
   material table; round 1's REFERENCE.md wrongly showed 24 and 60), and
   deepDepth 90 takes red-2 .13 to .11. A scene may now set its own water
   keys (README, map lane). The shelf's crack web (`bedCracks`) is absent in
   retail but removing it costs red-1's ponds: a per-map choice now.
5. Red-1's flat share is still 29% against 19%.
6. **Red-2's river outline** (reviewer, by eye, trial-084 pair): retail's
   river curves down to the west edge as a channel with banks in fine
   concentric steps; ours is a square pool with a few broad dark terraces.
   Check its water strokes against layout.png first (shape lane).
7. **Rock streaks:** retail's knobs have fine down-slope streaks;
   `faceScratch` (with Size, Length, Angle 0) draws grooves down a face and
   was only tried at 0 (round 1's 021).
8. **Red's tools after round 1** (not viewed): the world rock face is .8 now,
   but darkknob keeps 2, and red-1's crescent on darkknob drew hard black
   lines retail lacks (trial-072). The Knob and Crescent tools draw darkknob.

Scores: one metric now counts at most 3 family band widths (harness,
2026-11-20); red-3's base look reads .86 instead of 1.20, most of it from
230 thin dark pixels at the waterline.

Reviewer's note (2026-11-20): relief .8 was ported as kept. At .5 the
steep crop is a little smoother, but neither matches retail's smooth,
finely ribbed rims, and the whole-window edge balance is closer at .8
(red-1 horizontal edges .195 against .22 at .5; retail .119).
