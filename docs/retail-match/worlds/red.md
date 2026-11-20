# Red Planet: dossier

## Windows

`repro/scenes/red-<n>.json`; retail data in `$R/repro-r7/red-<n>/`.

| Window | Retail map | What it tests | Before round 1 |
| --- | --- | --- | --- |
| red-1 | red planet (2560,896) | a rolling plain with a big shallow basin, a crescent and a mesa, ponds and craterlets | shape .21, look .38 |
| red-2 | red river (2560,2880) | a lake with a finely terraced bank, rough cracked upland in the NW corner, one knob | shape .32, look .27 |
| red-3 | gods of war (256,576) | a coast: rough rock bank, lavender shelf, deep water: **held out** | shape .14, look 1.49 |

Means of the tuning windows at the base (main 50328b75): shape .27, look .33.

### Which rock each window's strokes use

No stroke sets `rockPreset`, so every window draws the world's own rock
(slot 0, the rock keys in `knobDefaults`). `darkknob` (slot 2) and `rubble`
(slot 3) reach no window until a scene names them. red-2 paints Rock
(channel 1, amount 80) over its knob; red-3 paints Rock in five strokes.
Re-check with `grep -o '"rockPreset": [-0-9]*' repro/scenes/red-<n>.json`.

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

## Start here

1. Shape: red-1's flat share (45% against 19%). Find where retail's gentle
   cells are in its heights (a plain-wide roll, wide aprons, or byte steps)
   before moving strokes; the scene's `undulation` is a map setting.
2. red-2's knob: diameter 300 against retail's 180-220 px foot; its steep
   share is low.
3. Then the look: the hard black lines on steep ground, the plain's
   blotches, the shelf's crack web, the dark shore band.
