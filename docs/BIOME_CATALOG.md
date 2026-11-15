# Retail biome catalog: features, tools, rock types and gaps

A catalog of the terrain features that recur across each retail biome's maps, the Terra tool and rock type that draw each one, and the
generic controls still missing. Written 2026-11-15 from a pass over 156 retail maps (162 with Wet Desert): Green 37, Red 17, Lava 19, Painted
Desert 3 (plus Wet Desert 6), Ice 22, Crystal 10, Archipelago 14, Moon 12, Lush 22. Sizes and heights were measured from the maps' TA heights (one byte per 16 px
cell). Every look and status is by eye: from 1x pairs of each tool beside retail crops, then every world's tools rendered again through the
editor's own cards (its presets, rock types and ground materials) and compared with those statuses. The retail pictures, crops and pairs stay
outside the repository.

Status means: **good** (reads as retail at 1x), **close** (same design language, details differ), **poor** (recognizable but wrong in
an important way), **missing** (no tool draws it).

World variants are gone. The sub-looks they held are now rock types, which a world defines in `world.rock.recipes` and a tool names by key.
A rock type now carries cracks, contour bands, and the Moon and Ice surfaces as well as rock-face numbers. A tool can also name the ground
material it lays down (`material`; the world lists it in `world.materials.extra`).

## Ground and water: the patch swap

Each world's flat ground and deep water, as the export draws them, were checked on this branch (2026-11-15, rerun after the dither fix) by the patch swap: two 1x1,
two 4x4 and one 8x8 contiguous 32 px tiles of ours pasted into a 512 px retail crop of flat ground or open water. **Pass** means the patches
could not be found by eye at 1x; **faint** means they could be found only by looking for them.

| World | Ground | Water | Reference |
| --- | --- | --- | --- |
| Green Planet | pass | pass | flat and water sections |
| Red Planet | pass | pass | flat and water sections |
| Lava | pass | pass (lava) | flat and lava sections |
| Painted Desert | pass | pass | flat crop; water from Wet Desert, as no Painted Desert map has any |
| Ice | pass after this round's retune (palette shares now within a few points of retail's; before, the 8x8 read bluer) | faint | flat and water crops |
| Crystal | pass after this round's retune (median (91,59,111) against retail's (91,59,107)); its streaks are a little more regular | pass | flat and water crops |
| Archipelago | faint after the fix of 2026-11-15 (measured: mean color off by 1.1, 32 px block spread 1.41 against retail's 0.75; at sea+2 it had failed with 13.9 and 2.69, because the damp band read the art relief's dips). Damp band 1 (none above sea + 1); our sand keeps a faint diagonal ripple and grain 20.8 against 17.0 | pass | flat and water sections |
| Lush | pass; jungle highland faint (after this round's retune; it failed before) | pass | flat, water and canopy crops |
| Moon | pass | no retail water to compare (Moon maps have no sea) | flat section |
| Moon mare | pass after this round's retune: median 75 as retail's; olive flecks 1.6% (retail 1.8%); gray shares 59/75/91/107/123/139 at 27/36/19/4/7/5% (retail 19/31/23/13/6/2%). The seam it showed was the palette dither restarting at the repeat's edge, now fixed for every material | | a dark mare crop |

## Scores (2026-11-15)

### Patch swap, measured

Each world's flat ground and open water (export art, 512 px) against its retail reference: the largest channel's mean color difference,
fine grain (luminance minus a 4x blur, standard deviation) and 32 px block spread (standard deviation of block means), ours / retail
(`~/terraform-assets/agent-biome-match/tools/swapstats.py`). Pass: color within 4, grain ratio 0.8-1.25, block spread ratio 0.5-2 or within
0.5. These thresholds were set after the fact, from the one failure visible in a swap sheet (Archipelago at sea+2: 13.9 and 2.69 / 0.75).

| World | Ground: color, grain, spread | Water: color, grain, spread | Result |
| --- | --- | --- | --- |
| Green | 3.6, 13.5/12.7, 0.91/0.76 | 0.9, 10.8/9.0, 0.44/0.31 | pass |
| Red | 0.5, 11.3/11.7, 1.45/1.19 | 0.3, 8.9/7.5, 0.22/0.18 | pass |
| Lava | 0.6, 11.2/11.2, 1.34/0.86 | 1.9, 17.2/14.7, 1.61/1.30 | pass |
| Desert | 1.2, 33.8/35.8, 3.14/5.12 | 1.3, 5.3/6.2, 0.12/0.10 | pass |
| Ice | 1.8, 10.2/10.5, 0.90/0.72 | 2.0, 11.2/9.0, 0.46/0.31 | pass (water grain at 1.24) |
| Crystal | 3.9, 18.3/17.9, 2.42/4.16 | 1.6, 7.5/7.3, 0.17/0.57 | pass |
| Archipelago | 1.1, 20.8/17.0, 1.41/0.75 | 2.9, 12.2/11.3, 0.54/0.43 | pass, barely (ground grain 1.22, spread 1.88) |
| Lush | 0.9, 8.8/8.6, 0.47/0.53 | 1.8, 7.5/6.1, 0.26/0.41 | pass (water grain at 1.23) |
| Moon | 3.4, 16.1/15.5, 1.11/1.15 | no retail water | pass |

### Retail windows: round start against today

`repro/retail.sh <world> --base <run>` on the 28 retail windows (`repro/scenes/<world>-<n>.json`; Lush has none), run on a68b2954 (main
before this goal) and on 022d00dc. Shape and look are mean gaps in units of the retail family's p10-p90 band (lower is closer); "in band"
counts the metrics inside that band. **The windows draw library shapes only, so this measures each world's look (ground, light, rock
surfaces, water, world numbers), not the new tools or rock types.**

| World | Shape, start -> today | Look, start -> today | Metrics in band, start -> today |
| --- | --- | --- | --- |
| Red | 0.19 -> 0.23 | 2.06 -> 0.49 | 60 -> 57 of 72 |
| Green (7 windows) | 0.24 -> 0.24 | 0.24 -> 0.23 | 139 -> 139 of 171 |
| Lava | 0.12 -> 0.12 | 1.01 -> 0.15 | 60 -> 67 of 75 |
| Painted Desert | 0.35 -> 0.35 | 1.05 -> 0.97 | 40 -> 39 of 69 |
| Ice | 0.15 -> 0.15 | 0.48 -> 0.11 | 67 -> 65 of 75 |
| Crystal | 0.14 -> 0.14 | 0.51 -> 0.21 | 62 -> 69 of 75 |
| Archipelago | 0.17 -> 0.22 | 1.18 -> 0.79 | 61 -> 51 of 72 |
| Moon | 0.24 -> 0.25 | 1.15 -> 0.32 | 32 -> 54 of 66 |
| All | | | 521 -> 541 of 675 |

"In band" misleads where a window's own retail value lies outside the family band (Archipelago window 2's retail brightness is 170.9,
above the band's 164.3; ours went from 83.3 to 178.5, closer but out of band). The measure to read is closeness to each window's own retail
value: the metrics within a quarter band of it, and the median distance in band units
(`~/terraform-assets/agent-biome-match/tools/benchclose.py <base> <now> <world>...`):

| World | Close to its own retail, start -> today | Median distance, start -> today |
| --- | --- | --- |
| Moon | 27 -> 41 of 72 | 0.52 -> 0.21 |
| Ice | 45 -> 64 of 75 | 0.16 -> 0.10 |
| Archipelago | 34 -> 44 of 75 | 0.30 -> 0.16 |
| Lava | 58 -> 66 of 75 | 0.14 -> 0.11 |
| Crystal | 50 -> 57 of 75 | 0.15 -> 0.10 |
| Red | 45 -> 50 of 75 | 0.17 -> 0.17 |
| Green (7 windows) | 117 -> 115 of 171 | 0.13 -> 0.13 |
| Painted Desert | 29 -> 26 of 72 | 0.34 -> 0.38 |
| All | 405 -> 463 of 690 | |

Seven worlds moved toward retail or held; **Painted Desert moved slightly away** and is the furthest. Its flat sand matches retail (edge
directions 0.19 / 0.35 against 0.19 / 0.33), so the gap is on the mesas: too many thin dark lines (0.050 against 0.019 in window 1), too
much 2 px band energy, edges leaning vertical where retail's lean horizontal, and a pale cap twice retail's share in window 1 (0.152 against
0.069). Highland from 55 or 70 and banding 0.5 (with strata contrast 0.6) were scored and did not move closeness (26-27 of 72); its shape
score, the worst of the eight at 0.35, did not change in the round. Archipelago keeps thin dark lines at 3-7x retail's.

### Blind A/B, one judge (2026-11-15)

Six pairs of 256 px patches per world, cut at the same place from three retail windows and our renders of them, sides randomized; a fresh
model judge with no context picked the original in each pair (sheets and key in `/private/tmp/claude-501/abx*`, outside the repository).
Indistinguishable is 3 of 6; 0-1 or 5-6 means the judge separates them.

| World | Original picked | Judge's main cue |
| --- | --- | --- |
| Green, Lava, Ice, Moon | 3 of 6 each | not separated (chance) |
| Red | 1 of 6 | hard pixel shore edges against Voronoi crack patterns |
| Painted Desert | 1 of 6 | small crater circles, sharp banding, pixel artifacts |
| Crystal | 1 of 6 | clean Voronoi polygons (taken, wrongly, for the imitation) |
| Archipelago | 1 of 6 | crisp drawn contour lines against blurry blobs |
| All | 16 of 48 (by chance 16 or fewer: p = 0.015) | |

The judge separated Red, Desert, Crystal and Archipelago in 5 of 6 pairs each, but took ours for the original, and all 11 of its
confident picks were wrong. So these four still differ from retail in a consistent way a viewer can see; Green, Lava, Ice and Moon did not.
One judge and six pairs a world is a small test: repeat it with more pairs or the owner's eye before treating a world as matched.

Red after the Cracked bed (the same six pairs, a fresh judge): 4 of 6, but the judge answered B for every pair, so the result is a side
bias and says nothing. On the windows, Cracked bed 0.55 at 42 px moved red-3's look gap from 0.99 to 0.88 and Red's mean from 0.49 to 0.44;
closeness held at 50 of 75 (median distance 0.17 -> 0.16).

## Cross-biome gaps, ranked by how much of the retail set they cover

| Gap | Biomes | Generic control that would close it | Status |
| --- | --- | --- | --- |
| Radial ribs from a click: starburst legs, spatter-vent teeth, collapse stars | Moon (9 maps), Lava (9), Red (4) | Spurs on a crater section | **Done** this round: spurs off a clicked crater now draw. Collapse stars on cut shapes still draw nothing |
| Dense contour hatch on grass and rock slopes (6-12 px wobbly lines); risers ~6 px where retail's are 1-2 | Green (8+), Lava (12), Red, Moon, Lush, Desert | Thin risers: steps with a high flat share (ledge 90) draw 2-3 px lines | **Done**: Lava's shields and knolls (ledge 90); Green's slope hatch from contour bands 1.3 units apart |
| Scatter for click shapes: craterlet fields, knoll fields, boulders, rubble, islets | Moon (9), Green (5), Ice (9), Archipelago, Lush | Copies: a count, spread, size and size variation on any landform | **Done** this round: Craterlet field, Knoll field, Boulder field, Islet scatter use it |
| Irregular shore lobes and spits; `fingers` makes a regular comb | Lava (8), Archipelago (8), Green, Red, Crystal | Lobe variety: clustered lobes, a few long and wide | **Done** in part (Lush uses it); the lobes' sides stay straight, and a raised bank's relief is still missing |
| Rock art on level tops and walkable grades (rock follows slope today) | Lava, Red, Desert, Green, Moon | Rock crown: a rock type's rock art over level tops above the plain, art only so heights stay level | **Done** (Lava's Dark dome and Crumpled flow rock types use it); other worlds' rock types can set it |
| Lumpy, ragged aprons and concentric skirt rings at a landform's foot | Desert (every feature), Red, Moon | Talus lumps; the Mesa's banded climbable slope | **Done**: Desert's Mesa draws concentric banded rings round its foot (retail's outer fringe is a little lumpier); Dark outcrop uses Talus lumps |
| Soft gully profile: retail has 6-10 rounded valleys where ours cuts 15-25 crisp rills (steepest step 53 against 29-31, measured) | Archipelago (10), Green, Lush, Lava, Red | Fewer, shallower gullies on the presets (Rock mound gullies 35: p95 step 26, was 33). A Gully softness control was tried and reverted: it changed curvature 15% but not visibly at 1x | Partial |
| Rings that break into arcs (atolls, crater rims, calderas) | Archipelago (9), Moon, Lava, Red | Gaps: breaks in what a shape raises, round a click or along a path | **Done** this round (Crater mound, Ring crater use it) |
| Coast shelf at an absolute depth; a deep stroke's bank surfaces as land unless it overlaps a wide shelf | Archipelago (14), Crystal (7), Ice (13), Green | A Shallow stroke at the shelf's depth drawn along the bank of a Deep stroke (its own width in px, Height variation for lumps); the world's shallow and deep depths set the band's tone. A shelf in the Deep curve was tried: its width is a share of the radius (16 px at 200 px) | **Done** for Ice (Coast shelf tool); the other worlds can draw it with Shallow |
| Soft-edged ground strokes: maria fade over ~100 px in 200-600 px lobes; a stroke lays a material only where it changes the height (a rise under 3 claims nothing, measured) | Moon (6), Lush swamps (9) | Ground edge: the material ends in scalloped lobes | **Done** in part: lobed edges; a fade in tone is out of reach of a per-cell material, and a claim still needs a small rise |
| Inner crest ridges inside outcrops and massifs | Crystal (7), Green, Moon, Lava | Shape data, no engine change: column facets already follow the envelope (a seed reads its height and slope). Two overlapping outcrop drags, or one short bent drag, leave an inner ridge and hollow like retail's. A click's spurs start at the center under the rim, so they barely show. Height variation 120 over 220 px gives the bare mound its inner relief. Known artifact: thin column spikes on the outer wall at a sharp path bend (far seeds of the next segment); a distance cutoff only shrank them | Close (by drawing) |
| A second, lighter shallow tone (a -9 lagoon renders as a -25 shoal) | Archipelago, every water world | World water numbers, no engine change: a brighter bed (Tinted bed brightness) and a shallow-to-deep ramp that starts near the surface (Shallow until depth 4) | **Done** for Archipelago (measured: lagoon (63,123,163) as retail's, shoal (47,106,149) against (45,104,148), deep (31,82,126) against (30,80,124)) |
| River channel depth and bank shelf (the River bed reaches only 18 under the sea) | Lush (14), Lava | Channel depth | **Done** this round (Lush River: 90 px at 220%) |
| Per-shape crystal surface (tone, shine, web) and per-shape snow on caps | Crystal, Ice | Move gougeWeb, the crystal shine rows and Snow on caps into rock types | Partial: iceSnow is per rock type now |
| Needle hatching and crack stars along cliff and terrace edges | Ice (8), Moon, Red, Lava | The ice crystal strokes on a rock type (Ice's Scarp ice) | **Done** for Ice's cliff and terrace (fine dark needles on the wall; retail's cross more and spill onto the snow); three-pronged crack stars and other worlds' edges still missing |
| Elongated prisms (only square blocks today) | Ice (2), Desert, Crystal, Lava | Prism stretch | **Done** this round (Ice block at 220%) |
| Banded slopes that large KBots can climb under a pale caprock | Desert | Mesa section | **Done** (owner, 2026-11-15: climbable, as retail; 0 of 72 rays blocked, retail 3) |

## Per biome

### Green Planet (37 maps)

| Feature | Tool, rock type | Status |
| --- | --- | --- |
| Knoll fields (5 maps) | Knoll field (Copies 8) | close |
| Small round knolls and knobs, dark on their lee | Knoll, Knob (Greenstone), Cup knoll | close (lee from sun 28 and ambient 0.3: darkest 5% of a knob went from luminance 33 to 27, retail 27-42) |
| Crescent hills | Crescent | close (blocks vehicles on 33% of cells, retail 17-23%) |
| Long escarpments and terraced massifs | Escarpment, Terraced massif (Dark escarpment) | close for the massif (irregular terraces) and the escarpment (a dark rock band with grass clumps, as retail's ridges; a lower rock threshold was tried and smeared rock and soil over its foot) |
| Rock fins | Rock fin (Greenstone) | close |
| Broken, branching slopes (Evad River) | Broken hill (Broken slopes rock type, the old evad variant) | close |
| Contour striations on slopes | contour bands 1.3 units apart (strength 0.6, no jag) | close (fine dense lines on slopes, as retail's; our slopes underneath are lumpier) |
| Rivers, lakes, islands | Deep, Shallow, River | close |

### Red Planet (17 maps)

| Feature | Tool, rock type | Status |
| --- | --- | --- |
| Knobs rising 80-91 over the plain, about 180 px (red_river's "pit rows") | Knob (Dark knob rock) | close |
| Crescents | Crescent (Dark knob rock) | close |
| Low rough hills with a dark lee | Hill, under Face steepness 1, Sampled slope texture 0.4, no world cracks, sun from the west (sun tilt 0), laminae 0.5 | close (smooth rises with streaky shading; retail's are a little lumpier) |
| Ring craters about 1450 px with a rubble rim | Ring crater (Rubble rim rock: polygonal cracks; Cracks 70) | close (a cracked rubble band on the rim, as retail's) |
| Basins with a level floor at sea+1 in rough, crumpled high ground (Yerrot) | Basin, with Rough ground (lays the Rough red ground material) round it | close (the rough ground's luminance spread matches retail's, p10/50/90 35/61/88; retail's crumples carry more relief) |
| Ponds | Pond | close |
| Craterlets | Craterlet (floor at -19, dry) | close (a dry bowl; retail's walls are more streaked) |

### Lava (19 maps, stamped from the tile kit)

| Feature | Tool, rock type | Status |
| --- | --- | --- |
| Small smooth lava pools | Lava pool | good |
| Rimmed pits with lava in their floor | Lava pit | close |
| Spatter vents with radial teeth | Spatter vent (spurs) | close |
| Lumpy stepped knolls | Knoll | close |
| Low flat lava shields (walkable, steps 17.5 per cell) | Lava shield (ledge 90: thin riser lines) | close |
| Crescent pools and lava slots between raised banks | Lava trough | close |
| Big dark rounded dome blocks | Dome block (Dark dome rock, Rock crown 1, knuckle spurs) | close (a rounded, lumpy dark mass) |
| Long knotted ridges (lava_alley); flat-topped cliffed ridges (rock_alley) | Lava ridge (a lumpy mountain mass with bulbous spurs, Talus lumps); Plateau for the flat kind | close (knotted and dark; retail's crowns are a bit more lit) |
| Fringed lava coasts | Lava lake (Inlet share 85: tapering lava inlets into the land) | close (retail's inlets branch more) |
| Rimmed plateaus (calderas) | Rimmed plateau (a section with a lip 12% over its flat top) | close |
| Lava rivers | Lava river (170 px with the lava lake's stepped, jagged banks) | close |

### Painted Desert (3 maps; Wet Desert's 6 in crops)

| Feature | Tool, rock type | Status |
| --- | --- | --- |
| Mesas and buttes with pale caps and banded steps | Mesa, Butte, Gray mesa (Pale caprock as Highland ground from a rise of 40) | good: caps are pale caprock at any height, the steps keep their bands |
| Banded knobs on caps | Cap knob | close |
| Dark crescent outcrops | Dark outcrop (Dark outcrop rock) | close |
| Desert Triad's tall gray mesas, domes and cones | Gray mesa (245), Gray dome (125), Cones (65), on the Gray caprock rock type (the old triad variant) | close |
| Ragged aprons and skirt rings | Mesa (banded slope), Talus lumps | close |
| Hoodoos | Hoodoos | no retail counterpart (an invented look) |
| Water (no Painted Desert map has any) | Wet Desert's blues: deep (19,63,103), the band within 10 of the sea (47,107,145) | a measured guess |

### Ice (22 maps)

| Feature | Tool, rock type | Status |
| --- | --- | --- |
| Ice floes and frozen ponds | Ice floe (Glacier ice, lays the Icy Bergs ground), Frozen pond | good |
| Ice pyramids and small mesas | Ice pyramid (Crystal ice), Ice butte | good |
| Ice cliffs (170) and terraces (85), closed to every unit | Ice cliff, Ice terrace (Scarp ice: needle-hatched walls) | close |
| Icebergs, ice blocks, glacier fronts | Iceberg, Ice block (Glacier ice), Glacier front (Snow and slate) | close |
| Rubble clumps and boulders | Frost rubble, Boulder, Boulder field (Frost rubble; Copies 10) | close |
| Snow drifts | Snow drift | close |
| Ragged frost coasts | Deep water (plates 8 px on land, 40 px in water; uneven lobes), then Coast shelf along its edge (from Shallow: 260 px, 25 under the sea, Height variation 20 over 50 px); Ice water shallow to 30, deep from 45 (past its third colour's depth of 10, so the third colour sits at the waterline and the lit bed shows between 10 and 30: the shelf's mottling; ordered stops, 22/34/46 and 4/10/45, were tried and lose it or draw teal rims) | close (a darker, mottled shelf band with lit lumps and loose chunks off a ragged, needle-hatched edge, as retail's yrdac and exp1ac12, by eye; no engine change. At -7 Ice draws a shelf as frozen plates, so the shelf sits at -25. A faint seam shows where the shelf stroke replaces the bank. Melt holes are still missing: Copies on a 40 px Frozen pond scatter holes, but their steep banks draw dark rims where retail's are clean blue dots 8-15 px (tried, not adopted). The coast was rated on a 200 px Deep stroke: a 700 px one grows 150 px peninsulas where retail's inlets are 30-80 px) |

### Crystal (10 maps)

| Feature | Tool, rock type | Status |
| --- | --- | --- |
| Outcrops: large ~900 px rising 124-145, medium 370-460 px rising 120-150, small 250-350 px | Crystal outcrop, Crystals, Crystal knob | close (lobed by Height variation; inner crests by overlapping drags) |
| Low lit crystal crusts | Crystal crust (Lit crystal crust rock: web 0.3) | close (lighter plates under a thin web; retail's web is bolder and its crust shows ridged streaks) |
| Shards on the plain | Crystal shards | close |
| Coasts with a slab shelf 8-10 under the sea | Shallow with shore plates | close |
| Islets ringed by slabs | Islet | good |
| Submerged reefs | Shallow water below the sea, with Crystal's mosaic in all shallows | close (slab mosaic on the reef, as retail's) |

### Archipelago (14 maps)

| Feature | Tool, rock type | Status |
| --- | --- | --- |
| Flat sand islands at sea+2 with a pale halo | Island (the plain now stands at sea+2 as retail's, owner 2026-11-15) | close |
| Sandbars, shoals, islet chains | Sandbar, Shoal, Islet scatter (Copies 8) | close |
| Atolls | Atoll (a wider ring split by 7 Gaps) | close (chunky sand islands with shallow gaps; the lagoon stays deep where retail's is pale) |
| Dark rock mounds with radial ridges | Rock mound, Rock knob, Crater mound (Mound rock) | close (ridges are crisp rills) |
| Halos, shoals and lagoons: shoal (43,101,144) against retail (45,104,148); a -9 lagoon or Reef (60,120,161) against (63,123,163); halo (55,115,157) against (54,113,155), all measured | world water: shallow until 4, deep from 52, tinted bed brightness 1.18 (was 38 and 52, bed 1, when the lagoon took the shoal's tone) | close (Island's halo is an even band with a distinct edge since its shelf went flat with a steep outer drop: (54,114,157), 34% of the water in a 400 px crop, against retail's 29%) |

### Moon (12 maps)

| Feature | Tool, rock type | Status |
| --- | --- | --- |
| Craters of every size: fresh, terraced, pocked, small, large | Fresh, Terraced, Pocked (Pocked rubble), Small, Large crater (Streaked crater wall) | close |
| Starburst craters | Starburst crater (spurs) | close |
| Domes with a shaded far side | Dome (sun 34, ambient 0.3) | close |
| Lobed mesas, wrinkle ridges, flow lobes | Lobed mesa, Wrinkle ridge, Flow lobe | close |
| Dark maria at the plain's height (0-unit step on 6 of 6 maps) | Mare (lays the Moon mare material) | close (edge hard where retail fades over ~100 px) |
| Crater walls in dark gray shade, not black | world shade depth 0.6 with sun 34 | close |
| Ring craterlets scattered on the plain | Craterlet field (Copies 14) | close |

### Lush (22 maps)

| Feature | Tool, rock type | Status |
| --- | --- | --- |
| Jungle plateaus (rise 150-175) with dark cliffs | Jungle plateau (Jungle cliff), Highland ground from 115 | close |
| Grass mesas (rise 60-106) | Grass mesa | close |
| Jungle ridges | Jungle ridge (lays the jungle material) | close |
| Cuestas and coastal bluffs | Cuesta, Coastal bluff | close (back slopes ~3x the cliff side, retail ~10x) |
| Rocky knolls | Rock knoll (Bare tan rock) | close |
| Rivers with wide pale braided shallows | River (90 px, Channel depth 220%), Braided river | close (a dark channel inside pale margins) |
| Swamp thickets (9 maps) | Swamp thicket (lays the Swamp thicket material, Ground edge 30) | close (water glints ~22% of pixels against ~16% in a retail crop; retail's are a little larger and brighter) |

## Owner's decisions (2026-11-15)

- Painted Desert mesas climbable like retail's banded slopes.
- The lighting changes on Green, Red and Moon stay.
- Archipelago's plain stands at sea+2, as retail's sand.
- Zhon's brown river water stays dropped.
