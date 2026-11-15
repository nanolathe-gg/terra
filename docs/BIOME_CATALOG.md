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
| Archipelago | pass | pass | flat and water sections |
| Lush | pass; jungle highland faint (after this round's retune; it failed before) | pass | flat, water and canopy crops |
| Moon | pass | no retail water to compare (Moon maps have no sea) | flat section |
| Moon mare | pass after this round's retune: median 75 as retail's; olive flecks 1.6% (retail 1.8%); gray shares 59/75/91/107/123/139 at 27/36/19/4/7/5% (retail 19/31/23/13/6/2%). The seam it showed was the palette dither restarting at the repeat's edge, now fixed for every material | | a dark mare crop |

## Cross-biome gaps, ranked by how much of the retail set they cover

| Gap | Biomes | Generic control that would close it | Status |
| --- | --- | --- | --- |
| Radial ribs from a click: starburst legs, spatter-vent teeth, collapse stars | Moon (9 maps), Lava (9), Red (4) | Spurs on a crater section | **Done** this round: spurs off a clicked crater now draw. Collapse stars on cut shapes still draw nothing |
| Dense contour hatch on grass and rock slopes (6-12 px wobbly lines); risers ~6 px where retail's are 1-2 | Green (8+), Lava (12), Red, Moon, Lush, Desert | Thin risers: steps with a high flat share (ledge 90) draw 2-3 px lines | **Done**: Lava's shields and knolls (ledge 90); Green's slope hatch from contour bands 1.3 units apart |
| Scatter for click shapes: craterlet fields, knoll fields, boulders, rubble, islets | Moon (9), Green (5), Ice (9), Archipelago, Lush | Copies: a count, spread, size and size variation on any landform | **Done** this round: Craterlet field, Knoll field, Boulder field, Islet scatter use it |
| Irregular shore lobes and spits; `fingers` makes a regular comb | Lava (8), Archipelago (8), Green, Red, Crystal | Lobe variety: clustered lobes, a few long and wide | **Done** in part (Lush uses it); the lobes' sides stay straight, and a raised bank's relief is still missing |
| Rock art on level tops and walkable grades (rock follows slope today) | Lava, Red, Desert, Green, Moon | Rock exposure by noise or per shape, art only so heights stay level (per-shape Rock crown) | Missing |
| Lumpy, ragged aprons and concentric skirt rings at a landform's foot | Desert (every feature), Red, Moon | Talus lumps; the Mesa's banded climbable slope | **Done**: Desert's Mesa draws concentric banded rings round its foot (retail's outer fringe is a little lumpier); Dark outcrop uses Talus lumps |
| Soft gully profile: retail has 6-10 rounded valleys where ours cuts 15-25 crisp rills (steepest step 53 against 29-31, measured) | Archipelago (10), Green, Lush, Lava, Red | Fewer, shallower gullies on the presets (Rock mound gullies 35: p95 step 26, was 33). A Gully softness control was tried and reverted: it changed curvature 15% but not visibly at 1x | Partial |
| Rings that break into arcs (atolls, crater rims, calderas) | Archipelago (9), Moon, Lava, Red | Gaps: breaks in what a shape raises, round a click or along a path | **Done** this round (Crater mound, Ring crater use it) |
| Coast shelf at an absolute depth; a deep stroke's bank surfaces as land unless it overlaps a wide shelf | Archipelago (14), Crystal (7), Ice (13), Green | A shelf depth below the sea; a deep bank that starts below the sea | Missing |
| Soft-edged ground strokes: maria fade over ~100 px in 200-600 px lobes; a stroke lays a material only where it changes the height (a rise under 3 claims nothing, measured) | Moon (6), Lush swamps (9) | Ground edge: the material ends in scalloped lobes | **Done** in part: lobed edges; a fade in tone is out of reach of a per-cell material, and a claim still needs a small rise |
| Inner crest ridges inside outcrops and massifs | Crystal (7), Green, Moon, Lava | Crystal facets that follow the envelope's own ridges (spurs on the envelope were tried: the facet field replaces their relief, so they barely show) | Missing |
| A second, lighter shallow tone (a -9 lagoon renders as a -25 shoal) | Archipelago, every water world | A shallow-water tone ramp by depth | Missing |
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
| Ragged frost coasts | Deep water (plates 8 px on land, 40 px in water; uneven lobes) | close (plain snow and a ragged edge with inlets, as retail's; retail's darker mottled shelf and melt holes are still missing: depth ramp, bed relief, bed tint and the rock shelf were tried and only tint a thin band, so a lumpy submerged ledge with floating chunks needs engine work) |

### Crystal (10 maps)

| Feature | Tool, rock type | Status |
| --- | --- | --- |
| Outcrops: large ~900 px rising 124-145, medium 370-460 px rising 120-150, small 250-350 px | Crystal outcrop, Crystals, Crystal knob | close (domes where retail's outlines are lobed and carry inner crests) |
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
| Halos and shoals pale blue: (43,101,144) against retail (45,104,148) | world water depths 38 and 52 | good |

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
