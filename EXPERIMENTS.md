# Experiment ledger

One row per experiment, newest last. The renders, crops and keys stay
outside Git (the session scratchpad and /private/tmp/nanolathe-map-editor).
Blind rounds follow docs/PLAN_TERRAIN_EDITOR.md §10.

| # | Change | Knobs | Evidence | Verdict |
| --- | --- | --- | --- | --- |
| 1 | Fall-line relief baked into a fields texture (oriented gully kernels, branching, warp, patchiness) | relief* | A/B sheets on intersections and hills, seed 2701 | Kept: faces gain structure; the first version read as combed stripes |
| 2 | Face material from the detailed surface: moss on lump tops, rock on flanks and in hollows | faceScore, rockShare, faceSlope | Rock share by slope against 71 retail Green hill sections | Kept: rock and brightness by slope track retail except the steepest bin |
| 3 | Foot rim (light grass ring) | rim | A/B | Rejected: reads as a contour ring; parked |
| 4 | Crevice darkening | crevice | A/B | Off: darkens whole faces rather than drawing lines |
| 5 | Nearest-colour palette stage on by default, with ordered dither | palette, dither, landDither | Coast A/B against a retail coast section; flat-grass gray share | Kept: water at 2, land at a quarter |
| 6 | Water colour ramp from retail coast sections (depths 24-60); auto shelves 70% to 25% | shallowDepth, deepDepth | Water colour by depth from 33 retail coast sections | Kept |
| 7 | Boulders, debris and sand | boulders*, debris*, sand* | A/B sheets | Kept as knobs, off by default |
| 8 | Less sampled slope texture on gentle ground | slopeTexture | Hilltop smudges A/B | Kept at 0.3 |
| 9 | Rock in gullies | gullyRock | Round-hill radial streaks | Kept at 0.5 |
| 10 | Water colour from depth averaged over a disc | waterSoft | Deep-core edge A/B | Kept at 32 px |
| 11 | Cheap preview bake while painting | (automatic) | Scripted stroke: 21.7 ms to 16.6 ms between frames | Kept |
| 12 | **Blind round 1**: 10 generated crops (build 616ff965d, seeds 911/4829) and 10 retail crops (one per corpus map); one fresh reviewer | | 4/10 generated caught, 4/10 retail called generated: chance | Decisive tell was forensic (grass tiles off the 32-px grid); it misfired on retail too. Visual tell: evenly spaced "comb" ribs |
| 13 | Random phase and wavelength per relief kernel | reliefJitter | Plateau-face A/B against the retail Wretched Ridges cliff | Kept at 0.8: ribs stay, spacing irregular |

Open tells and gaps:

- Form: our scenes have about eight times retail's share of very steep
  ground, and retail hills are broader cones (Phase 1 node kinds).
- The steepest faces carry 56% rock against retail's 77%.
- Grass quilts repeat retail tiles off the 32-px grid. This is forensic,
  not visible; procedural grain (E6) removes it.
