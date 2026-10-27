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
| 23 | Sand edge: three blur passes and a wide grain-jittered coverage ramp | sandEdge | User: abrupt transition | Kept |
| 24 | Faster moves: region replay of the old and new footprints (each node computed with a margin that is restored), hill replay straight to the settled ridge (pixel-identical), preview bake while dragging | (automatic) | Drag frame time 62 ms to 18 ms (hills) and 48 ms (mixed) | Kept; the mixed scene is still bound by brush evaluation |
| 25 | Biomes: one server prepares Green, Red and Archipelago; World selector; per-biome water ramp | biome | Red and Archipelago beside their lab baselines | Kept |
| 26 | Craters from retail Moon sections: lobed outlines, sector-broken rims, off-centre lumpy bowls, uneven aprons, satellite craterlets | craterlets, crater roughness 60 | Moon dark and misc section sheets; before/after | Kept |
| 27 | Hill cracks: each shape has a Cracks amount (share of crack seeds that open; hills 40%, mountains 50% by default). Lines are traced down the steepest descent with meander, taper and branching, then carved and darkened in the bake | cracks (per shape), crackSeverity, crackSpacing, crackLength | Retail Greenhaven hill. A noise zero-crossing version gave faint or worm-like lines and was dropped | Kept |
| 28 | Plateau face width varies along the outline (broad noise on the shoulder) | faceVariation | Round-3 tell: even-width cliff bands | Kept at 0.8 |
| 29 | **Blind round 4**: build 563d63976, seeds 9137/9871, each seed cropped from a different half (no repeated layouts) | | A: AUC 0.93 (8/10 caught, 1 false); B: AUC 0.96 (6/10, 0 false) | Regression vs round 3. Tells: features on dead-flat featureless plains (retail plains carry faint lit lumps); an evenly dark smooth band down ramp shoulders; soft rounded waterlines with a pale fringe; beaded rock on low steps; geometric water outlines (authored example layouts) |
| 30 | Bug: surfaceHeight returned early on near-level ground (slope < 0.1) before adding baked relief, so gentle-slope relief and any flat-ground detail never rendered. Fixed | | Lumps visible after the fix | Fixed |
| 31 | Level-ground lumps (appearance only), crisp notched waterline, less rock on low banks, ramp shoulders take relief and rock (only the graded surface is protected) | plainRelief 1.2, crispShore, bankRock 0.25 | Round-4 tells, side by side with retail img01/img03; slope stats unchanged except level-ground gray 1.5% to 2.7% (retail 1.1%) | Kept; needs round 5 |
| 32 | **Blind round 5**: build f2ed349b3, seeds 10457/11939, crops from different halves | | A: AUC 0.20 (0/10 caught, 6/10 retail called generated); B: AUC 0.18 (0/10, 6/10) | Inverted. By eye the sets can't be told apart, but the reviewers read retail's Bryce-rendered contour banding (terrace lines, rings round lakes) and lumpy plains as 'generated'. Ours lacks that banding, a systematic difference. One real tell: a speck of water inside rock on a coast |
| 33 | Drag speed: dab() read two URL knobs per cell; read once per dab | | Six example scenes hash-identical; lake drag 300 to 83 ms (Green mixed), 215 to 45 ms (Archipelago islands); same shape and scene cost the same in every biome (~17 ms) | Kept; TODO for the rest (swept dabs, worker) |
| 34 | Edit preview keeps biome materials: a quick material field (same sources and soft cover, arrivals spread by blur) stands in for the transport while editing | | Archipelago drag: hills stayed dark instead of turning pale; channels r 0.99-1.0, arrivals r 0.6 with matched mean; 12 ms | Kept |
| 35 | Shape frames: each shape's brush noise is read through its frame, so moved, rotated and scaled shapes keep their outline; Move handles, Shift+drag height, , . [ ] PageUp/Down, Delete; Raise / lower area tool | | Frameless shapes hash-identical; region replay equals full replay (max diff 0) after rotate, move and scale | Kept |
| 36 | Crack engine: anisotropic warped cellular network at texel resolution in the full bake (edges kept by hash, rills or plates by orientation, taper), carved as a narrow V; sparse long fissures; styles. Replaces traced 512-grid lines and the fracture texture in fall-line mode | crackSeverity, crackWidth, crackSpacing, crackLength, crackJagged, crackNetwork, crackReach, crackDark, fissures, fissureSpacing | Retail River Delta hill and sections green43/green51 at 2x; Gaea surface shots; diagnostic view=cracks | Kept |
| 37 | Sand transport: runout length grows as slope eases and varies by place; grains keep heading on level ground; uneven shedding and gusts. Output sandiness with a wide fines tail; shader dusting, then grains, then cover; hollows fill first | sandPatchy, sandTail, sandDust | Before/after at sand 1.5, Green mixed and Red hills: band round each foot became uneven tongues and piles fading over 20-30 px | Kept |
| 38 | **Blind round 6**: build dacc0b1b9 (cracks and sand, before the fissure-thinning tweak), seeds 12601/13877, crops from different halves, one duplicate inlet crop replaced | | A: AUC 0.28 (2/10 caught, 3/10 retail called generated); B: AUC 0.86 (only 1/10 at 60+, but 8/10 generated at 50+ and 8/10 retail at 45 or less) | A inverted; B ranked the sets apart on two form tells, both accurate: (1) a steep north-facing plateau face projects to a 1-2 px dark line (img01, 07, 14, 16); (2) ridges and cliff bands of even width with regularly repeating rock ribs (img08, 19, 05). Rendering img08 and img09 with the retired fracture crevices restored looks the same, so (2) comes from the fall-line ribs on even-width bands, not from retiring the crevices. A flagged faint straight wrinkles on gentle grass (img05), probably fissures before the thinning tweak. Also geometric water from the authored coasts layout (img10). A regression from round 5 for B |
| 39 | Crack engine v2: three nested cellular levels (majors stretched down the slope; minors on a lattice turned per block so they end against majors; hairline crazing), blocks as tilted planes that step on rocky ground and replace most ribs there; 1 px dark core with sun-facing lit wall baked per light; per-shape Cracks sets intensity | crackSpacing (block size), crackMajor, crackMinor, crackHairline, crackBlocks, crackLit, plus earlier knobs | Retail green51 rock and River Delta hill at 2x and 4x: faces now break into lit angular facets; crest slopes carry branching majors with short minors | Kept; user to judge |
| 40 | Sand reaches up the foot (grains rest on lower slopes; shed above slope ~1), and grass regrows over sand in patches with tufted edges | sandGrass | Mountain foot before/after: the floating grass ring between rock and sand is gone | Kept |
| 41 | UI: Shape panel (tools, brush card that says whether it edits the next stroke or a selected shape) and World panel (whole-map settings in collapsible groups) | | Screenshot | Kept |
| 42 | Worlds: per-world remembered knobs and base colours (texture grain moved to a new mean); New world, export/import, restore built-in | world colours | 'Snowfield' test world from Green | Kept |
| 43 | Beach band for worlds with a beach texture (third layer of the transition array; all 16 units in use) | beachWidth | Awaits Zhon | Kept |

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
- Archipelago crater floors drop below the biome's beach height and take the bright beach material.
- Blind sets sample authored example layouts; geometric water outlines are partly the examples' own brush strokes.
- Retail slopes show contour banding from their height-banded renders; ours has none (round 5). A banding knob is the user's call (asked 2026-10-27, no answer yet).
- Specks of water inside coastal rock (round 5, coasts scene).
- A steep north-facing plateau face projects to a 1-2 px dark line (round 6,
  both reviewers): north faces need a wider, gentler profile, as retail's do.
- Ridges and cliff bands of even width with regularly repeating rock ribs
  (round 6, reviewer B): vary band width and rib spacing along a face.
- Dragging a map-wide lake is still about 80 ms a frame (TODO in sculpt.js).
