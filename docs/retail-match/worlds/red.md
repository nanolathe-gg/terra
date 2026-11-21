# Red Planet: dossier

## Windows

`repro/scenes/red-<n>.json`; retail data in `$R/repro-r7/red-<n>/`.

| Window | Retail map | What it tests | Before round 1 |
| --- | --- | --- | --- |
| red-1 | red planet (2560,896) | a rolling plain with a big shallow basin, a crescent and a mesa, ponds and craterlets | shape .21, look .38 |
| red-2 | red river (2560,2880) | a lake with a finely terraced bank, rough cracked upland in the NW corner, one knob | shape .32, look .27 |
| red-3 | gods of war (256,576) | a coast: rough rock bank, lavender shelf, deep water (held out in rounds 1-2; tunes from round 3) | shape .14, look 1.49 |
| red-4 | red triangle (6656,2048) | a sea coast: the NW corner of the triangle's eastern island; low banks (a 0-8 terrace in the N and NW, a gentle ramp in the S), a lavender shelf about 100-250 px wide, deep water in the N corners, plain at 30 behind: **held out** (added round 3) | shape .10, look .75 (round 3's holdout-002, the fixture as committed) |

Means of the tuning windows at the base (main 50328b75): shape .27, look .33.

### Which rock each window's strokes use

| Window | Rock slot used | Rock type |
| --- | --- | --- |
| red-1 | 4 on every stroke (round 2) | `softface` (faceRock 0, rockFaceFrom .5): no rock shown, face construction only from slope .5 |
| red-2 | 2 on the knob stroke (round 1); 5 on the NW corner rise (round 3); the rest unset | `darkknob` (crust -.3, rockFace 2, faceTone .05, faceScratch 3 down the face); `chunks` (crackSeverity 1, facets 1.5, spacing 48, crackFrom .12, faceRock 0) |
| red-3 | none set | the world's own rock (draws `red-bank` since round 4) |
| red-4 | none set | the world's own rock |

`rubble` (slot 3) reaches no window. red-2 paints Rock (channel 1, amount
80) over its knob and lays `red-crumple` (material slot 14, channel 26) over
its NW upland; red-3 paints Rock in five strokes. Re-check with
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

## Start here (round 5)

Round 4 (branch `match-red-4`, 81 of 300 trials; report in the round's final
message, notes in `$R/match/terraform-wt-match-red-4/red/NOTES.md`, fitting
scripts named there) started at main e22c27d1: trial-000 mean shape .13, look
.22 (red-1 .11/.07, red-2 .14/.09, red-3 .14/.50), held-out red-4 .10/.50.
It ended at trial-081: shape .12, look .09 (red-1 .11/.07, red-2 .14/.06,
red-3 .12/.15); red-4 .10/.33 (holdout-005). Kept:

- the world rock draws a new coast-bank material, `red-bank` (rust ground,
  3.5 px lumps and 52 px cells lit from the west, thin dark cell borders),
  in place of red-rock's dark 8-64 px blotches; darkknob draws it too (its
  knob reads even and fine). red-rock is now unused by Red's role table;
- `red-crumple` draws thin dark cracks between lighter plates (red-2's
  upland);
- red-3's sea rebuilt with a sloped floor (`fixture:`), fitted to the retail
  heights by coordinate descent; plain 30, undulation 5;
- red-3's own water: deepDepth 24 (the hard step sits at the mean of
  shallowDepth and deepDepth, depth 13, where retail's water turns from light
  to dark measured on its heights), bedBright 1.0.

Leads:

1. **Sea-coast water as the world's.** red-3's own water (then deepDepth 30,
   bedBright 1.0) takes held-out red-4 from .33 to .22 (holdout-004,
   diagnostic only; deepDepth 24 not checked there). As world defaults it costs red-1 .01 and red-2 .07
   (trial-050) unless red-2 sets bedBright 1.1 in its query and red-1 keeps
   18/1.1. The reviewer's call: one sea look for the world, ponds and rivers
   as maps' own water.
2. **Deep water's 32 px patches** (red-3 .37 at trial-081, retail .87). Read in
   code, not proved by a trial: with deepEdge 1 the step comes from
   `sharpDeepStep` (engine-frag.wgsl), which reads the bed depth only, so the
   depth mottle (`colorDepth` noise) never reaches it. deepEdge 0 (trial-025)
   raised deep patches .30 to .47 but blurred the shelf edge (shelf edges .018
   to .004, retail .014). The patches also rise with the step's depth (.30 at
   deepDepth 18, .37 at 24, .56 at 30; cause not traced). A surface layer
   cannot reach it: deep water draws the water material's pigment, not the
   bed (`water = mix(absorbed, deepWater, deep)`); red-water's broad mix did
   little (trial-026).
3. **Red-3's bank** still reads darker and blotchier than retail's broad,
   lit, lumpy rough ground with thin polygon cracks (crop trial-049
   red-3/slope.png). Tried: wider Rock paint (060: gentle edges .10x to
   .56x, flat edges 2.4x), Ground lumps paint on the bank (062: look .16 to
   .14, slope edges 1.7x to 2x), red-crumple ground there (074: flat edges
   4.9x), red-bank's light amounts (038/039), rockFace (027-029), world
   cracks (058). Retail's bank roughness is in the heights: on cells within
   8 of water, rough_8px .74 against ours .22 (inland .23 against .08). A
   stroke option for cell-scale height roughness would be the lever.
4. **Red-2's fixture**: retail's plain sits 35 above the river (crop.json),
   ours 24. plain=35 alone breaks the banks and knob (trial-057: shape .21);
   a refit of the lake strokes at plain 24 against scaled heights did not
   help (069). Rebuild the lake with plain 35 and its strokes together.
5. **Red-2's bank** of fine concentric lines: contour band spacing (063,
   064), banding (055/056), no Steps (068) and routeSmooth (010/011) do not
   draw it.
6. **The knob** still lacks a lit crest and a dark east lee: faceFill (066,
   067) and darkknob rockFace 1 (077) made red-2 worse.
7. Edge direction on red-3: the north-facing waterlines and the SW bay's
   narrow shelf step add horizontal edges (`hzone.py` in the round's
   scratch notes); the plain's share stays the palette dither's.

## Start here (round 4, done)

Round 3 (branch `match-red-3`, 66 of 300 trials; report in the round's final
message, notes in `$R/match/terraform-wt-match-red-3/red/NOTES.md`) first
added red-4, a sea coast from red triangle, as the held-out window, so red-3
now tunes (owner, 2026-11-20). The base mean (trial-000, red-1..3) was shape
.13, look .34; trial-045 ends at shape .13, look .22 (red-1 .11/.07, red-2
.14/.09, red-3 .14/.50). Held-out red-4 went from .75 (holdout-002, the
fixture as committed) to .50 (holdout-005). Kept: deep water from depth 18
(material table), crispShore .5, wetBand 2, lightCap 1, darkknob calmer with
grooves down the face, and red-2's broken NW upland (the `chunks` rock type,
the `red-crumple` ground, a low lumpy corner rise).

Leads:

1. **Red-3's shelf is a fixture gap**: ours covers 25% of the window, retail
   15%, and its coast lies up to 80 px landward of retail's (trial-019
   layout.png). Narrower sea strokes cleared shelf:share but flattened the sea
   floor (shape .14 to .18, trial-023); a refit with red-4's coast fitter
   swung the shelf/deep split (NOTES.md). Rebuild red-3's sea with a sloped
   floor: retail drops to -55 within 100 px in the north, and keeps a wide
   0 to -20 shelf in the SE (x 560-860, y 640-760). The shelf color levers
   (bedBright, deepDepth below 18) only gray the band or break it into
   islands (trial-022, trial-006).
2. **Red-3's (and red-4's) coast bank** is retail's rough ground with fine
   vertical streaks and a dark polygon crack network; ours is painted world
   rock in dark blotches (red-3 slope.png). Chunks rock with cracks on its
   strokes, less Rock paint, red-rough paint (trial-048..050) and a world
   surface layer of red-crumple on sloped ground near water (trial-066: red-2's
   smooth bank took it, .09 to .13) did not draw it. Next: a bank material with
   down-slope streaks and cracks, as a layer that red-2's river bank escapes
   (a rule on the sea's depth, or each map's own amount). Not yet tried with
   red-3 tuning: shoreRock, shoreShelf and bankRock (rounds 1 and 2 tried them
   before any coast window tuned); try them first.
3. **Edge orientation** is most of red-3's look (.50): retail's land edges
   run vertical (lit from due west: 3248 vertical against 263 horizontal on
   red-3's inland), ours mixed (1880 against 1191). Banding, faceTone, shineRock,
   the rock's bedding (faceLamina, faceLedge, faceBed) and reliefAmount .5-.65
   do not move it (trial-009..012, 040, 056..060). Water Waves direction 0
   gains .02 on red-3 but draws vertical streaks where retail's run diagonal
   (trial-061). The review traced it (renders of red-3 on Node/Dawn, edges
   counted on land more than 40 px from water, the score's 1 px blur):
   - The relief's own light is directional: in Clay, 3060 vertical against
     1067 horizontal; with reliefAmount and plainRelief 0 almost no edges
     are left (92/0). A review sun (`sun=90`) turns the counts round
     (1094/3213), so the relief has no direction of its own.
   - Not the cause: lightCap, flatShadow, flatOcclusion, cavity (0 already),
     reliefLumps, reliefWarp, lumpRelief, gentleRelief, plainRelief, the
     materials' own dither, red-plain's spots.
   - **Our palette dither alone draws about 800 horizontal edges** on red-3's
     plain: with red-plain one flat color and the relief off, 816 horizontal
     against 853 vertical are left. Retail's plain uses the same four palette
     colors at the same pixel contrast (pixel-scale luma s.d. 11.4, ours
     11.3), but its dither runs in rows, so its edges run vertical. The
     output dither is the owner's (palette output stage, decision 25): no
     data lever changes this share, so don't chase edge_horizontal on level
     ground.
   - The reachable part is the coast bank (lead 2): its dark blotches are
     round cells, edges in every direction, where retail's bank is streaked.
4. **Red-2's upland** reads as broken lit lumps now, but darker and busier
   than retail's lighter plates with thin dark cracks (crops/r2-up2-036.png).
   Stepped versions drew dark risers (trial-029..031). Shore plates draw gray
   slabs (trial-038).
5. **Red-2's bank**: retail's is a wide smooth band of fine concentric lines;
   ours is narrow and broad-terraced. Finer Steps, calmer heightVary and
   cracks 0 do not help (trial-046, 053, 054; stroke cracks are gated by
   world crackSeverity 0).
6. **Deep water's 32 px patches** are too few (red-4 .48 against 1.14,
   red-3 .53 against .87); red-water's broad noise, its Patch size at 40 and
   waterSoft move nothing (trial-051, 052, 064). deepDepth 18 created this
   finding (red-3 deep 32 px 1.42 to .56). The review measured red-4's water
   more than 60 px from land: ours already matches retail there (32 px .21
   against .18, 8 px .47 against .47), and red-water's broad mix .35 at size
   40 does reach it (.21 to .31). So the gap is in the deep class next to
   the shelf, where retail mottles softly and ours steps to the deep color:
   at deepDepth 42 the depth mottle (engine-frag.wgsl, the shallow-to-deep
   ramp) drew those patches. Try a wider ramp (shallowDepth lower against
   deepDepth 18) before the material.
7. **The knob** (darkknob) is even now but lacks retail's lit crest and dark
   east lee (red-2 steep.png); the Knob tool draws it and was not viewed.
8. Relief .8 holds: .5 takes red-1 from .07 to .20 (trial-059), .65 to .11
   (trial-060).
9. Not tried: routeSmooth and coastRamp for red-2's smooth river edge.

## Start here (round 3, done)

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
2. **Red-2's NW upland** (replaced by the owner's read, 2026-11-20: rough,
   cracked terrain stepping down in lit chunks toward a smooth river edge;
   round 3 lead 4). Round 2's framing: (largest finding, gentle edges 0.00x): retail's
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
