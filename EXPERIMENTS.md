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
| 14 | Procedural base ground: a fixed set of unique 32-px tiles placed randomly on the TNT tile grid. Pixels draw from a 64-quantile colour ramp measured on retail flat grass | ground, groundTiles, groundClump | Retail flat grass is nearly uncorrelated per pixel (lag-1 0.05, lag-2 0.135); flat stats 73.8/13.1/1.6/61.4 against retail 73.7/12.9/1.1/60.9 | Kept: 16 tiles by default. This answers the user's TNT tile-budget requirement and removes the off-grid forensic tell |
| 15 | Shapes as editable nodes (kind, path, parameters, own seed), replayed in order, with a snapshot before each node; Move tool; Shapes list | (editing) | Examples render identically to before; move, height edit and two undos are pixel-exact; the v4 recipe reloads pixel-exact | Kept |
| 16 | Crater brush: bowl below the ground struck, raised rim, apron fading to nothing at 1.8 radii; dry floor (paint water for a crater lake); drag for elongated | crater: diameter, depth, roughness, softness | Click, drag and on-plateau craters; first version left a ring step and flooded the floor | Kept |
| 17 | **Blind round 2**: build d460f375e, seeds 5113/6271, new retail windows; two reviewers told to judge by eye only | | A: AUC 1.00 (8/10 caught, 0 false); B: AUC 0.89 (4/10, 0 false) | Regression. The grass split the sets perfectly: row 14's per-pixel ground was red-speckled, retail olive. Visual tells: soft cast shadows on level grass; smooth shaded back slopes read as blurred smears; even hairline cracks with spaced blobs; narrow rock ridges as lump chains |
| 18 | Sand from weathering: rock faces shed grains; water carries them downhill and drops them where slopes ease, in pits and at shores; wind hops them downwind into lee shelter (continuous Werner 1995 slab model). Colour from the biome's rock texture, lightened | sand, sandReach, windStrength, wind, sandLight, sandGrain | A/B with water only, water plus wind, strong opposite wind | Kept, off by default; replaces row 7's geometric sand rules (user direction) |
| 19 | Ground tiles from a causal neighbour model of retail flat grass (left, upper-left, upper and upper-right contexts with backoff), 16 tiles, offline | groundTiles | Side by side at 2x with retail and the lab texture: olive, matching grain. A fitted pairwise model (Gibbs) fell into checkerboard phases | Kept; replaces row 14 |
| 20 | No cast shadows on level ground, less occlusion there; low relief on gentle slopes; fractures 65 to 40 | flatShadow, flatOcclusion, gentleRelief, fractures | Round-2 tells | Kept; needs round 3 |
| 21 | **Blind round 3**: build a67dbef73, seeds 7307/8419, new retail windows, two reviewers judging by eye | | A: AUC 0.41 (1/10 caught, 4/10 retail called generated); B: AUC 0.72 (0/10 caught, 1/10 false). Pooled: 1/20 generated caught, 5/20 retail called generated | At chance by eye. B's ranking edge: cliff bands of even width along smooth arcs, and the same example layout at two seeds (a test-set flaw; use distinct layouts) |
| 22 | Ground undulation node: broad, low noise on dry ground in patches, never on protected crests, ramps or passages; first in the shape list | undulation, undulationScale, undulationCover | Dry-land slope shares with heights rounded to whole units: level 70% to 39% (retail 48%), 0.03-0.08 4% to 31% (retail 20%), 0.08-0.2 4% to 8% (retail 12%) | Kept: 10 / 200 px / 0.45 |

Open tells and gaps:

- Form: our scenes have about eight times retail's share of very steep
  ground, and retail hills are broader cones (Phase 1 node kinds).
- The steepest faces carry 56% rock against retail's 77%.
- Faces and slopes still use the lab's sampled moss and rock textures.
  Only level ground is procedural so far.
- Retail flat grass has a little more mid-scale mottling than the tiles.
- Narrow low steps render as chains of rock lumps (round 2, img08).
- Cliff bands keep an even width along smooth arcs (round 3, reviewer B):
  shoulder and face width need variation along the outline.
