#!/usr/bin/env python3
"""Local common-surface terrain experiment; no engine integration."""
import argparse
import copy
import json
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit


HERE = Path(__file__).resolve().parent
SOURCES = {name: HERE / name for name in (
    'sculpt.html', 'sculpt.js', 'sculpt-renderer.js', 'sculpt-vert.wgsl',
    'sculpt-frag.wgsl', 'sculpt-common.wgsl', 'sculpt-weathering.js', 'sculpt-material-weathering.js',
    'relief-bake.wgsl', 'sculpt-sand.js', 'sculpt-map.js', 'sculpt-export.js', 'sculpt-features.js',
    'sculpt-flow.js', 'sculpt-flow-ui.js')}


BIOME_NAMES = {'green': 'Green Planet', 'red': 'Red Planet', 'archipelago': 'Archipelago',
               'moon': 'Moon', 'zhon': 'Zhon', 'lava': 'Lava', 'desert': 'Painted Desert',
               'crystal': 'Crystal', 'ice': 'Ice'}


# Every map-wide knob's default (the World panel). A world preset is these
# plus its own overrides below, so each world has a value for every setting;
# a knob missing here is reported in the page's console.
KNOB_DEFAULTS = dict(
    groundTiles=16, groundPattern='', groundContrast=1, undulation=10, undulationScale=200, undulationCover=.45,
    reliefScale=28, reliefAmount=.5, reliefLumps=.7, reliefBranch=2, reliefWarp=10, reliefPatchy=1,
    reliefJitter=.8, gentleRelief=.6, plainRelief=1.2, reliefOctaves=5,
    flatShadow=0, flatOcclusion=.4, lightCap=1.13, shadeDepth=1, sunTilt=1, ambient=.42, slopeMarks=0, wrinkles=0, sandCrown=0,
    faceVariation=.8, northFace=.7, mesaFlank=0, faceFill=.18, slopeTexture=.3, faceEdge=.8, gullyRock=.5, moss=0, crevice=0,
    boulders=0, boulderSize=9, boulderFoot=.5, boulderCluster=.6, boulderMoss=.35, boulderRound=0,
    debris=0, debrisReach=48, debrisSize=6, debrisSort=.8, repose=.6,
    sand=0, sandReach=.6, windStrength=.5, wind=20, sandPatchy=.7, sandTail=.6, sandDust=.5, sandGrass=.6,
    sandLight=.25, sandGrain=.8, ripple=7, rippleHeight=1.4,
    crackSeverity=.6, crackSpacing=40, crackLength=2, crackMajor=.8, crackMinor=.75, crackHairline=.6,
    crackBlocks=.6, crackWidth=1, crackJagged=.6, crackNetwork=.35, crackReach=.6, crackDark=.75, crackLit=.35,
    # Rock structure (card E3): rockOrder 0 is the scattered rock; the rest only matter above it. crackStyle 0 is ink.
    rockOrder=0, bedSpacing=12, bedVary=.5, bedDip=0, bedDipDir=90, bedLedge=.5, bedLip=1,
    jointSpacing=36, jointAngle=0, jointDepth=2, jointRun=120, jointGaps=.3, crackStyle=0, bedHeight=0, rockFrom=.6,
    craterlets=3, craterEjecta=0, worms=0, rockCrown=0, apron=0,
    crystalForm=0, crystalStep=16, crystalSides=6, crystalSize=24, crystalCount=10, crystalTop=.2, crystalLean=.25,
    crystalVariation=.5, crystalTiers=0,
    # Berg form (card E5; only read when a Crystals stroke sets crystalForm 2): faces in units per px, jitter, broken corners, roughness in units, top tilt in units per px and its direction in degrees.
    crystalAlign=0, bergFace=.9, bergJitter=.5, bergBreak=3, bergRough=6, bergTilt=.1, bergTiltDir=90, bergFlat=.25,
    shorePlates=0, plateWaterPx=64, plateLandPx=96, plateSize=28, plateGap=2, plateHeight=3, plateMaterial=0,
    crystalGrain=0, crystalFace=1, crystalInk=0, crystalTone=1, crystalSeam=0,
    # Ice (card E5): shade keeps its blue (0 grey, as every world was).
    shadeBlue=0,
    # Ice frost band (card E5): its cells skip the wet-band darkening (0: every world as before).
    frostWet=0, frostNeedles=.5,
    banding=0, bandSpacing=3.7, bandSoftness=.35, bandLine=.5, bandWidth=0, bandRelief=0, bandWander=0, bandGaps=0, bandWater=0, sandBanding=0, sandBandSpacing=2,
    strata=0, strataSpacing=10, strataWarp=12, strataContrast=.6, strataGrain=1,
    fingers=0, fingerBlunt=0, bankPx=0,
    # Coast pass (card E4): fingers on the joined coast and flat shore layers cut as heights
    # (layerPx px a layer, riser 0 shares the bank's rise out, ledge and irregularity in shares).
    fingerCoast=0, shoreLayers=0, layerPx=12, layerRiser=0, layerLedge=.75, layerRough=.5, layerStyle=0, shoreEdge=0, bandStyle=0, beachWidth=.6, shallowDepth=24, deepDepth=60, waterSoft=32, crispShore=1, bankRock=.25,
    dither=2, landDither=.25, paletteMix=0, microRock=1,
    # Form (repro round): ledges on steep faces, darker faces, jagged bands.
    faceStreak=0, faceStreakFrom=.3, faceDark=0, bandJag=0, bandFade=.75,
    # Dry banks below the plain lit as level ground, with no bands or wet band (Archipelago's beaches).
    flatBank=0,
    # Cross-section (card C1): profile 0 keeps each brush's own curve; the rest
    # only matter once a stroke sets profile 1 (px, units or shares as labelled).
    profile=0, apronPx=0, apronHeight=.2, facePx=0, faceCurve=0, terraces=0, ledge=.6, terraceJitter=.35,
    lip=0, crown=.5, shelfPx=0, shelfDepth=6, shelfSteps=0,
    # Painted masks (card C5): the Paint brush's first choice, and the landforms'
    # Paint inside option (channel 0 is off), with its strength.
    paintChannel=1, maskChannel=0, maskAmount=1,
    # Water looks (card E1). The three stroke options are 0 (the world's own),
    # 1 or 2; the world knobs default to the earlier noise water, a ramp from
    # shallow to deep colour, and level ground with no painted lumps beyond
    # plainRelief's.
    waterShore=0, waterDeep=0, waterBed=0, bedLit=0, bedTint=.85, bedBright=1, bedContrast=1, hillLight=1, ringFade=0, fringeStyle='veins', bedRelief=0, deepEdge=0, deepEdgeDepth=0, lumpRelief=4,
    # Line features (card C4): everything off by default; spur and rim details only matter once spurs, sectors or gaps are set.
    spurCount=0, spurLength=120, spurSpread=.4, spurWidth=.8, spurTaper=.6, spurHeight=.7, spurForks=0, spurBulb=0, crestJag=0, crestVary=0, crestTaper=0,
    rimSectors=0, rimUnequal=.6, rimGaps=0, rimGapWidth=70,
    # Local style (card C5 stage 2): change about the world's own value, 0 none.
    styleRelief=0, styleCracks=0, styleBanding=0, styleFace=0,
    # Crater rim height as a share of its depth (card C4); .34 is the rim every crater had.
    rimHeight=.34,
    # Placed fissures (card C4 stage 2): only the Fissure tool reads them.
    fissureWidth=5, fissureJag=.5, fissureBranches=3, fissureBranchLen=90, fissureBranchSpread=.5, fissureTaper=.6,
    fissureNetwork=0, fissureCell=70, fissureCrack=.4, fissureDark=.6,
    # F1 (flow bake): how the baked current and sediment are drawn. Nothing reads them in a scene with no bake, so no world's
    # render changes; they are tuned on Zhon's rivers.
    flowTint=1, flowShallow=.85, flowStreak=.5, flowStreakLen=140, flowBank=.9,
)
# Shine and roughness (card E2): per material (ground, slope cover, rock, sand,
# crystal) a gloss (highlight strength), a sharpness (Blinn exponent), a roughness
# (slope amplitude of the micro-normal grain) and its scale in px. Gloss 0 and
# roughness 0 everywhere is today's look exactly; sharpness and scale only matter
# once one of those is set.
# Ranges and palette notes for adopting worlds: NOTES.md of card E2 (gloss 0-2, sharpness
# 20-200, roughness 0-2, scale 3-12 px; highlights quantise to the world's lightest palette
# entries, so judge them on the final output).
SHINE_MATERIALS = ('Ground', 'Slope', 'Rock', 'Sand', 'Crystal')
KNOB_DEFAULTS.update(shineStretch=1, shineWhite=.35)
for _m in SHINE_MATERIALS:
    KNOB_DEFAULTS.update({f'shine{_m}': 0, f'shine{_m}Sharp': 24, f'shine{_m}Rough': 0, f'shine{_m}Scale': 6})
# Per-world overrides of KNOB_DEFAULTS (authored presets; shallowDepth and
# deepDepth come from each world's measured water ramp).
WORLD_KNOBS = {
    # Crack darkness calibrated on retail (measure/crack_lines.py, strong
    # and long line densities on slopes): Green's lines were ~2.5x retail's.
    # crackDark also darkens band lines, so bandLine keeps their darkness.
    'green': dict(banding=.8, bandLine=.84, crackDark=.4,
                  # Repro round (3 windows, 12-map census, measure by slope
                  # and facing): faces keep fall-line ribs much more than
                  # any retail map; slopes turned from the sun are too light.
                  faceStreak=1, faceDark=.35,
                  # Great Divide's terraces are short dashes stacked like
                  # scales, not long smooth lines (thin dark lines per
                  # pixel 0.124 against retail's 0.235; bandJag 1 gives 0.158).
                  bandJag=1,
                  # Card E3 (retail green-2's big rock face): coherent level beds scratched
                  # by long joints leaning ~20 degrees (row period 8-12 px whatever the
                  # slope; thin-line direction shares vertical/horizontal .29/.27 against
                  # ours .47/.13 before), cracks as lit relief rather than ink. Beds and joints
                  # only on painted rock (rockFrom 1.6): the hills of green-1 and green-3 carry
                  # sparse patches and keep their own relief.
                  rockOrder=1, rockFrom=1.6, bedSpacing=28, bedHeight=1, bedDip=2, bedDipDir=270, bedVary=.9,
                  bedLip=1, bedLedge=.55, jointAngle=-20, jointSpacing=48, jointDepth=4.5, jointRun=200, jointGaps=.35,
                  crackStyle=1,
                  # Water (card E1). Retail Green's shallows are the lit bed under a
                  # blue tint (mean (73,110,240), luma s.d. 11 against deep 1.5) and end
                  # in a hard step: colour by depth is flat to ~30 and gone by ~44 in
                  # both windows (retail depth 32-40: R 53, 40-48: R 39, the 16-px height
                  # grid upsampled), so the step sits at 40 and nothing fades.
                  bedLit=1, bedTint=1, bedContrast=.45, bedBright=1, bedRelief=1, deepEdge=1, deepEdgeDepth=40,
                  # Ground (card E1): retail's plain is flat (dry heights 9 +- 1) with lit
                  # lumps only in patches, which the Paint brush's Ground lumps makes. On
                  # level pixels (24 px from other heights) the s.d. of 15-px-blurred luma
                  # was 3.84 / 3.16 in green-1 / green-3 against retail's 1.74 / 1.61;
                  # no undulation gives 2.85 / 2.69 (the rest is the tiles and hill feet).
                  # The undulation knobs and Level-ground lumps still work.
                  undulation=0, plainRelief=0),
    # Card E3 (red-3): slope cracks lighter and finer than the ink web: lit relief
    # grooves (crackStyle 1) .5 px wide on 28-px blocks at depth .3, and thin long
    # joints (30 px apart, 3 deep) in place of the scattered chunks; no beds (retail
    # Red's faces show none).
    'red': dict(crackSeverity=.3, crackReach=.5, crackDark=.35, crackWidth=.5, banding=.3, bandLine=1,
                reliefAmount=.2, slopeTexture=0, microRock=0,
                crackStyle=1, crackSpacing=28, rockOrder=1, bedLip=0, bedLedge=0,
                jointDepth=3, jointSpacing=30, jointAngle=-10, jointRun=160, jointGaps=.4,
                # Red's shallows (card E1) are lit terrain too, tinted purple and ending in a
                # hard stop: red-2's lake is the plain ground tinted lilac (mode 2, the
                # default); a stroke may set the cracked bed (red-3's shelf, mode 1).
                bedLit=1, bedTint=1, bedContrast=.65, bedBright=1.1, bedRelief=1, deepEdge=1),
    # Retail sand runs level to a crisp waterline (hundred isles, canal
    # crossing): flatBank keeps the bank from the shaded lip and the
    # dashed contour lines the 3.7-unit bands drew across it.
    # Retail's plain is dead flat (dry heights 6, 2 and 1 in the three
    # windows, no spread), so no undulation: it dipped the plain to 1.6-2.2
    # above the sea, where the surface's relief crossed the water test and
    # drew blue pinholes in dry sand, and its slopes gave the grey blotches.
    # Mounds (retail: olive-grey, 6-13% of mound pixels darker than luma 45,
    # ours 28-31%): keep half the directional shading, ambient occlusion and
    # cast shadow, and a lighter crack floor (card B2; card E1 below lowers
    # the directional share to 0.3 with a lift of the hill cover).
    # Water (card E1): the shallows are the lit sand bed under a blue tint. Their
    # edge is a fade by default (retail's halo round an island and its reef bars
    # fade over 30-40 px); a stroke may set a hard step, which sits at depth 20.
    'archipelago': dict(crackSeverity=.4, crackMajor=.6, banding=.5, crackDark=.3, bandLine=.68, flatBank=1,
                        undulation=0, shadeDepth=.3,
                        # Hills and the mineral ring (card E1): mound pixels averaged (90, 80, 65)
                        # against retail's (102, 92, 76) in windows 2 and 3, with 15% of them under
                        # luma 45 (retail 5-6%). Hill cover x1.25 and a third of the directional
                        # shading give (103, 92, 76) and 7% dark. The ring is the curved 'Nested
                        # rings' texture, narrower (spread .35), lighter (.7, variation .5) and
                        # fading over a longer reach.
                        hillLight=1.25, ringFade=1, fringeStyle='rings',
                        bedLit=1, bedTint=1, bedContrast=.8, bedBright=1, bedRelief=1, deepEdgeDepth=20),
    # Painted Desert, measured on the retail map (measure/desert_*.py): beds
    # alternate every ~6 units; dark lines are shaded risers on 0.4% of lit
    # slopes, not cracks; the plain carries no lighting (luma vs gradient
    # R^2 0.000), so no undulation, lumps or occlusion; no drifts. Mesa
    # flanks: a narrow cap and wide even faces (cross-sections of the retail
    # mesa in repro/scenes/desert.json). Sunlit faces are no brighter than
    # the level (retail W/SW faces 0.99-1.00 of level luma; a 1.13 cap gave
    # 1.07-1.14), so no highlight above level.
    'desert': dict(mesaFlank=1, lightCap=1, paletteMix=1, strata=1, strataSpacing=6, strataWarp=4, strataContrast=1, banding=.4, bandSpacing=6,
                   bandLine=.2, strataGrain=.25, crackSeverity=0, crackMajor=.2, crackMinor=.1, crackHairline=0, crackBlocks=.1,
                   sand=0, undulation=0, plainRelief=0, flatOcclusion=0, reliefAmount=.15, gentleRelief=.2, gullyRock=0,
                   # Card E3: tall mountains keep their strata and gain lit ledges (beds the strata's
                   # 6 height units thick, level on the height so they ring each butte), long
                   # joints, and black shadow sides: retail's buttes are dark on the side turned
                   # from the sun, where ours shaded to a soft grey. No fill light and little
                   # ambient (faceFill 0, ambient .3) darken those faces; faceDark would not, as
                   # the strata colours replace the face material.
                   rockOrder=1, rockFrom=.45, bedHeight=1, bedSpacing=6, bedDip=0, bedVary=.4, bedLedge=1, bedLip=2,
                   jointDepth=3, jointSpacing=30, jointAngle=0, jointGaps=.4, crackStyle=1, faceFill=0, ambient=.3),
    # Moon slopes were too dark and smeared (retail mean luminance .773 vs
    # ours .708; dark share 19.8% vs 33%): fewer, lighter worm troughs.
    # Lit from due west: brightness regressed on the height gradient puts
    # the light at 174-190 deg on the Lunar sections and all four retail
    # Lunar maps (ours was 152). Little sky: across the 12 retail Lunar maps
    # (median) faces turned from the light sit at 0.82 / 0.57 / 0.36 of level
    # ground by steepness (ours 0.79 / 0.62 / 0.43 at ambient .42 with fill).
    # Crisp dark marks on slopes, measured by measure/slope_marks.py on eight
    # Lunar maps: median ~5.4% of shaded 0.4-0.8 slopes in 1-40 px marks
    # (2.0-7.5% by map), ~1.9% of lit ones; long axis ~25-30 deg off vertical.
    'moon': dict(crackSeverity=.35, crackMajor=.5, crackMinor=.5, crackBlocks=.4, craterlets=6, craterEjecta=.7,
                 worms=.4, undulation=4, plainRelief=.6, banding=.3, crackDark=.6, bandLine=.63,
                 sunTilt=0, faceFill=0, ambient=.25,
                 # Card B3: the isolated marks (slopeMarks .4) read as specks and, lined up
                 # on a narrow wall, as a toothed lip; retail's slopes are crazed with
                 # connected wrinkles and pits, so the joined wrinkles replace them.
                 slopeMarks=0, wrinkles=.8),
    # Zhon: no sand ring round hills on grass; sand is painted (Sand cover)
    # and hills set in sand get sandy feet.
    # Painted sand keeps a raised bar sand to its crown (the river sections'
    # sand bars rise ~100 units from the bed with no rock).
    'zhon': dict(crackSeverity=.4, crackMajor=.6, boulderRound=1, boulderMoss=0, rockCrown=1, apron=0, sandBanding=1,
                 beachWidth=.6, banding=.3, bandLine=.5, crackDark=.45, sandCrown=1),
    # Lava: one dark, low-chroma brown ground with no cracks, sand or
    # boulders on the level; striated dark cliffs; a molten sea with no
    # colour-by-depth ramp, so no depth averaging (authored from the
    # sections, see sculpt_section_biome.py 'lava'). Its bank ridges are
    # irregular, not banded (section measurement), so no contour bands.
    # Bank lines measured on the section-built retail maps (measure/lava_*):
    # ground-spaced dark lines from slope 0.15 up; ground-coloured faces;
    # rim, outline and lip at the coast. Worms gave way to the lines.
    'lava': dict(undulation=4, plainRelief=.6, crackSeverity=.4, crackNetwork=0, crackHairline=0, crackBlocks=.3,
                 beachWidth=0, waterSoft=0, bankRock=0, banding=0, bandStyle=1, bandSpacing=7, bandLine=1,
                 northFace=.7, fingers=1, fingerBlunt=1, worms=0, shoreEdge=1, slopeTexture=0,
                 # Dry banks ~60 px wide whatever the lake's size (measure/lava_coasts.py bank).
                 bankPx=60,
                 # Card E4: retail's bank is 6-9 flat layers stepping down to the lava, 12-16 px a
                 # layer and ~100 px inland (lava-1 zoom), cut as heights the sun lights (a lit top,
                 # a shaded riser) in place of the dark band lines (Banding 0 above; Banding, Band lines and the
                 # B3 knobs stay in the World panel).
                 shoreLayers=6, layerPx=16, layerLedge=.8, layerRough=.7,
                 # Fingers are low tongues of the lowest layer on the joined coast (retail lava-1: 25-35 px thumbs, blunt tips).
                 fingerCoast=1,
                 # Less ambient light, so the shaded risers read as retail's near-black lines.
                 ambient=.3,
                 # Line cores are near black (luma 15-27 in 55-60 ground) and
                 # ~2.5 px wide at half depth (measure/lava_bands.py lines
                 # profiles); the thin 1.6 px V at 0.75 darkness read as faint
                 # grain on the ground's palette noise.
                 bandWidth=2.3,
                 # Card E4: hills and mountains are rough rock, not smooth cones crossed by black
                 # hairlines. Cracks stay but lose their ink (.95 -> .35); the relief is finer and
                 # lumpier (scale 28 -> 20, amount .5 -> .9, lumps .7 -> .9) and Moon's joined wrinkles
                 # and pits (card B3) roughen the slopes. Shine is card E2's, not set here.
                 crackDark=.35, reliefAmount=.9, reliefScale=20, reliefLumps=.9, wrinkles=.6,
                 # Card B3: retail's lines (Kill the Middle, Red Hot Lava, Lava and
                 # Two Hills) are 1-2 px wide and 10-14 px apart, break off, meet and
                 # fork, where ours were 2-3 px wide, 5-6 px apart and nested without end.
                 bandRelief=.4, bandWander=.5, bandGaps=.15),
    # shadeDepth stays 1 on Lava: directional shading varies by map and
    # window (luma on the east-west height gradient: 6-9 per unit slope on
    # the lake maps, 14-18 on the hilly ones). 0.4 matched a Kill the Middle
    # window (retail 7.6, ours 9.3) but pushed Red Hot Lava and Two Hills
    # windows further away (retail 14.6 and 16.9; ours 12.9 and 12.3 at 1).
    # Crystal: dead-level violet ground (the flat sections sit at one height
    # or within 82-87), crater walls and rough ridges crazed by a near-black
    # polygonal crack web, plates rather than rills by eye, and no sand or
    # beach (authored from the sections, see
    # sculpt_section_biome.py 'crystal'). Its column fields are a separate
    # brush, not these knobs. The web's plates on the rough ridges measure
    # 14.7 px across at the median (max caliper 20; measure/
    # crystal_geometry.py), so the block size sits at the knob's 16-px floor.
    # Its Crystals brush makes column mounds: Voronoi columns with ~15 px
    # tops stepped ~16 units (measure/crystal_geometry.py).
    'crystal': dict(undulation=4, plainRelief=.6, crackSeverity=.7, crackNetwork=1, crackLength=1.25,
                    crackBlocks=.8, crackHairline=.3, crackDark=.9, crackSpacing=16, beachWidth=0,
                    crystalForm=1, crystalSize=32, crystalStep=16, crystalVariation=.35, crystalTiers=1,
                    crystalGrain=1, crystalFace=1.1, crystalInk=1, crystalTone=1.08, crystalSeam=1,
                    plateMaterial=1, plateWaterPx=90, plateLandPx=48, plateSize=20,
                    # Shine (card E2): retail Crystal is much shinier. Silver-lilac streaks run along
                    # the ground's grain on facets that face the sun's side; tops and the rock and
                    # slope plates round them take a sharp lobe over strong grain, and the level
                    # plain stays matte. Highlights are neutral (retail's brightest entries on the
                    # mounds are grey 155/171/187 and pinkish 187,147,195, not the blue lilac).
                    shineCrystal=.4, shineCrystalSharp=100, shineCrystalRough=1, shineCrystalScale=8,
                    shineRock=.3, shineRockSharp=100, shineRockRough=1, shineRockScale=8,
                    shineSlope=.25, shineSlopeSharp=100, shineSlopeRough=1, shineSlopeScale=8,
                    shineStretch=3, shineWhite=1),
    # Crystal's shore slabs (card C2): a deep, shallow or offset stroke with Shore
    # plates on takes this preset: rock-slab material, 20-px slabs, a band 90 px
    # into the water and 48 px onto land (retail: plates 12-80 px, bands 40-140 px,
    # 9 of 12 windows). crystalSeam lets the water shader paint the slabs' seams
    # and a paler fill over the submerged ledge.
    # crystalFace 1.1 (card C2): riser faces take dark violet (crystal colour x 0.42)
    # instead of the black B1 left them. In the mound regions of the three
    # Crystal windows 9-14% of retail pixels are black seams and 33-40% sit at
    # luma 12-34 (the faces); with faces at black ours had 25-29% black and 6-12%
    # at 12-34, and the heavy part of the dark (pixels 3 px deep inside a dark
    # blob) was 10-15% against retail's 4-7%.
    # Ice: level snow (flats at exactly 85 and 170), rounded snow mounds whose
    # shaded faces are smooth slate streaks with no crack network, and a
    # pack-ice shelf instead of a beach; its banks into the water are white
    # floes, never the slate of the shaded hill faces (authored from the
    # sections, see sculpt_section_biome.py 'ice').
    # Its Crystals brush makes ice blocks: four-sided, flat-topped (top ~0.45
    # of the base), sides ~0.7 units/px, no lean (measure/ice_features.py).
    'ice': dict(undulation=4, plainRelief=.6, crackSeverity=.2, crackMajor=.4, crackMinor=.3, crackHairline=.2,
                crackBlocks=.2, beachWidth=0, bankRock=0, crystalForm=0, crystalSides=4, crystalTop=.45,
                crystalSize=220, crystalCount=1, crystalLean=0, crystalVariation=.2,
                # Shore (card E5): frost crystals are the Ice shore. Retail's band is
                # mostly plain white ice with sparse fine straight lines (windows ice-1
                # and Ice Scream), broken by blue gaps that grow more frequent toward
                # deep water: reach 140 px into the water and 220 px inland, needles
                # every 7 px in about half the patches, thinning offshore. Plate
                # height 4 keeps the frost over the water level with the bank behind it
                # (14 made a dark wall there); frostWet 1 keeps the band white instead of
                # the grey the 13-unit wet band gives it. Plate material 0 keeps B1's floes.
                shorePlates=1, plateMaterial=2, plateWaterPx=140, plateLandPx=220, plateSize=44, plateGap=7, plateHeight=4, frostWet=1),
}


# Variants (card C5 stage 3): named presets laid over a world's own, for the
# places where one retail family splits into distinct looks. A variant is knob
# values on top of WORLD_KNOBS, plus optionally world colours ('colors') and
# other config keys ('config', e.g. strataZones). A world's own preset is its
# default, so nothing changes unless a variant is chosen (World panel, or
# `variant=<id>` in the page's address). Every knob must be in KNOB_DEFAULTS.
WORLD_VARIANTS = {
    'green': {
        # Evad River Delta and the Barrier Reef: rounded hills with soft
        # shading, no regular terrace combs; grey rock only as a sparse dark rim
        # at the foot (repro windows green-1, green-3, census green-07..12).
        # The default (Great Divide) keeps its dense terraces and rock faces.
        # The slopes' relief is broken and irregular, not smooth: a few faint
        # terrace dashes (banding .35 with the world's bandJag) and dark
        # branching cracks that reach down onto moderate slopes (crack depth
        # .45, floor darkness .55, reach .75), as the retail hills' rims show.
        # Thin dark lines per pixel in green-1 / green-3: retail .0559 / .0449,
        # smooth variant .0445 / .0425, this .0547 / .0504.
        'evad': dict(label='Evad River: broken slopes',
                     knobs=dict(banding=.35, bandLine=.84, faceStreak=0, faceDark=.3, crackSeverity=.45, crackBlocks=.3, crackDark=.55,
                                crackReach=.75, reliefAmount=.5, microRock=.7)),
    },
    'ice': {
        # Icy Bergs: periwinkle-white blocks standing in blue water (repro
        # window ice-2: block mean (177,196,247); the default's (220,225,232)).
        # The Ice blocks are Crystals-brush stamps, so their colour is the
        # world's crystal colour; side faces are that colour times 0.38 times
        # crystalFace.
        # Berg faces and tops (card E5): retail's bergs are blue-tinted all over,
        # tops (125,150,236) darker than the lit faces (177,201,251), so the
        # variant's ground, slope cover and rock take those colours (the berg
        # form carries no crystal mark; it is lit and covered like any slope).
        'bergs': dict(label='Icy Bergs: blue blocks',
                      colors=dict(crystal='#8ea6ee', ground='#9db5fa', slope='#a5bef9', rock='#9ab2f4'),
                      # No slope cover, face rock or exposed rock: their dark slate and granite
                      # read as teal specks on a bright berg, where retail's faces are one
                      # rough blue-white grain (ground pattern contrast 2 gives it).
                      # A short wet band keeps the waterline from a dark fringe.
                      material=dict(slopeStart=3.0, slopeFull=4.0, wetBand=2.0, rockSlope=9.0),
                      knobs=dict(crystalFace=2.2, crystalTone=.92, crystalGrain=.4, crackSeverity=0, shadeBlue=.9, lightCap=1.4, ambient=.32, groundContrast=2, microRock=0)),
        # Polar Range and Etorrep Glacier (dark steel-blue shaded faces on white
        # snow) are not here: the dark faces come from the block's own shading,
        # which the colour knobs only reach through the tops (a darker crystal
        # colour darkened the top, not the sides). See NOTES, stage 3.
    },
    'zhon': {
        # The river family (card B4): the reproduction windows' sections are
        # river sections, whose water is brown at the shore and dark olive in
        # the deeps, not the coast's grey-green and teal. The textures come
        # from the family's other sections (sculpt_section_biome.river_water);
        # 'river' names the config block they are prepared into.
        # The river's colour by depth reaches its deep end by ~40 units, not
        # the coast's 60 (windows zhon-1..3 at 34-44 / 44-56: R 57 / 40), and
        # it varies over a short reach, so the depth average is tighter. Mean
        # RGB error to retail over depth bins, zhon-2: coast water 44.5, river
        # textures on the coast ramp 50.2, with these two knobs 28.2.
        'river': dict(label='River sections: brown water', river=True, knobs=dict(deepDepth=38, waterSoft=16)),
    },
    'desert': {
        # Desert Triad: tall grey buttes with thin reddish bed lines, dark
        # shaded flanks and long dark cracks, beside Painted Desert's broad
        # orange and cream mesas (repro window desert-2).
        'triad': dict(label='Desert Triad: grey buttes',
                      knobs=dict(strataSpacing=4, bedSpacing=4, faceDark=.4, banding=.9, bandSpacing=4, bandLine=.6, crackSeverity=.5, crackMajor=.7,
                                 crackMinor=.15, crackBlocks=.15, crackReach=.5, crackLength=3),
                      config=dict(strataZones=[[1, 0, 1, .25], [14, 2, 0, .22], [60, 2, 0, .2], [95, 1, 2, .35]])),
    },
}
for _world, _variants in WORLD_VARIANTS.items():
    for _id, _v in _variants.items():
        _unknown = set(_v.get('knobs', {})) - set(KNOB_DEFAULTS)
        assert not _unknown, f'variant {_world}/{_id} sets unknown knobs {sorted(_unknown)}'


def apply_variant(config, biome, variant):
    """A copy of one world's config with a variant laid over it, or None for
    an unknown variant."""
    v = WORLD_VARIANTS.get(biome, {}).get(variant)
    if v is None:
        return None
    out = copy.deepcopy(config)
    out['defaults'].update({k: str(x) for k, x in v.get('knobs', {}).items()})
    if v.get('river'):
        # Swap in the world's river water (textures, ramp, mean colours).
        for key, value in copy.deepcopy(config['river']).items():
            out[key] = {**out.get(key, {}), **value}
    out['baseColors'] = dict(config.get('colors', {}))
    out['colors'] = {**config.get('colors', {}), **v.get('colors', {})}
    if v.get('material'):
        out['material'] = {**out.get('material', {}), **v['material']}
    out.update(copy.deepcopy(v.get('config', {})))
    out['variant'] = variant
    return out


# Red's shallow water, lifted toward retail's (card B4). The quilted purple is
# the mean of the coast sections' interiors. Across the three Red windows the
# retail pixels at depths 0-12 average (106, 65, 117) against the texture as
# drawn (91, 53, 109): brighter by 15 in red and 12 in green, and the pools of
# red-2 reach (125, 80, 138). A share of the texture is replaced by a light
# lilac, which lifts the level and keeps the grain and the hue family.
RED_SHALLOW_LIFT = 0.18
RED_SHALLOW_LILAC = (200, 150, 170)


def lighten_red_shallows(config, assets):
    import numpy as np
    from PIL import Image
    src = Path(assets) / 'red-water-shallow.png'
    img = np.asarray(Image.open(src).convert('RGB'), np.float32)
    lit = (img * (1 - RED_SHALLOW_LIFT) + np.asarray(RED_SHALLOW_LILAC, np.float32) * RED_SHALLOW_LIFT).round().astype(np.uint8)
    Image.fromarray(lit).save(Path(assets) / 'red-water-shallow-lit.png')
    config['textures']['waterShallow'] = '/sculpt-assets/red-water-shallow-lit.png'
    mean = lit.reshape(-1, 3).mean(axis=0).tolist()
    config['water'].update(shallowRGB=mean, shallowMeanRGB=mean)


def biome_config(biome, assets):
    """Prepare one biome's materials in its own asset folder and return its
    page configuration, with texture URLs under /sculpt-assets/<biome>/."""
    from sculpt_fractures import make_fracture_field
    if biome in ('moon', 'zhon', 'lava', 'crystal', 'ice'):
        # Measured from a decoded section catalog (sculpt_section_biome.py).
        from sculpt_section_biome import prepare_section_biome
        config = prepare_section_biome(biome, assets)
    elif biome == 'archipelago':
        from sculpt_archipelago_materials import prepare_archipelago_assets
        config = prepare_archipelago_assets(assets)
    elif biome in ('red', 'desert'):
        # Painted Desert is an authored world on Red Planet's materials.
        from sculpt_red_materials import prepare_red_assets, prepare_structured_red_assets
        config = prepare_red_assets(assets)
        structured = prepare_structured_red_assets(assets)
        config['textures']['slopeStructured'] = structured['slope']['texture']
        # This biome's slope and exposed face are one cracked material family.
        config['textures']['rockStructured'] = structured['slope']['texture']
    else:
        from sculpt_materials import prepare_assets, DEFAULT_DATA
        from sculpt_slope_material import make_slope_material
        from sculpt_rock_layers import make_rock_layers
        config = prepare_assets(assets)
        slope = make_slope_material(DEFAULT_DATA, assets)
        config['textures']['slopeGrass'] = '/sculpt-assets/slope-grass.png'
        config['textures']['hillRock'] = '/sculpt-assets/slope-rock.png'
        config['material']['hillRockMeanRGB'] = slope['rockMeanRGB']
        make_rock_layers(DEFAULT_DATA, assets)
        config['textures']['rockWeathered'] = '/sculpt-assets/rock-weathered.png'
        config['textures']['rockFractured'] = '/sculpt-assets/rock-fractured.png'
        from ground_tiles import make_ground_tiles
        make_ground_tiles(assets, DEFAULT_DATA / 'corpus')
        config['textures']['groundTiles'] = '/sculpt-assets/ground-tiles.png'
    make_fracture_field(assets)
    config['textures']['fractures'] = '/sculpt-assets/fractures.png'
    # Palette lookup with two-entry mixes (rows 0-31 are the nearest entry,
    # as before); the shader uses the pair rows when Mix palette pairs is on.
    from palette_pairs import make_pair_lut
    make_pair_lut(assets)
    config['textures']['palette'] = '/sculpt-assets/palette-pairs.png'
    config.update(size=1024, grid=512, baseHeight=24, seaLevel=0, biomeId=biome, biome=BIOME_NAMES[biome])
    # Accepted Green Planet authoring profile. Explicit query values still
    # select older comparisons; plain /sculpt opens the reviewed treatment.
    config['defaults'] = dict(noise='ridged', coverage='form', rock='hill',
        lighting='front', forms='shouldered', surface='slopes', scene='compact',
        weather='broad', transition='soil', material='varied', edges='natural',
        fractures='40', scree='70', shade='separate')
    config['material'].update(materialWeathering=0.0, depositSpread=.65)
    if biome == 'green':
        # Water colour by depth measured on the retail Green coast sections.
        config['material'].update(shallowDepth=24, deepDepth=60)
    if biome in ('red', 'desert'):
        config['defaults'].update(surface='structured', transition='mineral', material='single', fractures='80', scree='0')
        if biome == 'red':
            lighten_red_shallows(config, assets)
        config['material'].update(rockyCoasts=True, surfaceRelief=1.25, fractureDepth=1.25,
                                  slopeStart=.06, slopeFull=.30, slopeFloor=-4.0, slopeDry=5.0)
    elif biome == 'archipelago':
        # Low sandy islands need little rise above water. This is an authored
        # scene default, not an inferred conversion of native section heights.
        config['baseHeight'] = 8
        config['defaults'].update(surface='structured', transition='mineral', material='single',
                                  fractures='20', scree='0', example='islands')
        config['material'].update(rockyCoasts=False, surfaceRelief=.45, fractureDepth=.35,
                                  slopeStart=.08, slopeFull=.35, slopeFloor=6.0, slopeDry=8.0,
                                  slopeOnLowBanks=False, elevatedCover=[0, 30, .92], rampMaterial=1.0,
                                  groundFringe=True, ringAmount=.7, ringSpread=.35, ringVariation=.5,
                                  fringeSignal=[1, -1, 0, 0], fringeRange=[.08, .28], materialWeathering=1.0,
                                  transitionDetail=.65)
    elif biome == 'moon':
        # Craters are the Moon's feature and it has no water. Its slopes keep
        # the light ejecta material down to the level dust (authored profile).
        # Lunar dust is flat between craters: little broad relief, no cracks.
        config['defaults'].update(example='hills', material='single', fractures='0', scree='40')
        config['material'].update(rockyCoasts=False, surfaceRelief=.35, slopeFloor=-4.0, slopeDry=4.0)
    elif biome == 'zhon':
        # Zhon's level ground sits only ~3 height units above its measured
        # shoreline (sea 59, flats 62); 8 leaves the editor's water tools room,
        # as Archipelago's authored base does.
        config['baseHeight'] = 8
        config['defaults'].update(example='islands', material='single', fractures='20', scree='0')
        # Its slope art is sandy (streaked dune slopes): shown where sand
        # lies beneath and on ramps, which are sand in its sections.
        config['material'].update(rockyCoasts=False, slopeStart=.08, slopeFull=.40,
                                  slopeFloor=6.0, slopeDry=9.0, slopeSand=True, rampMaterial=1.0)
    elif biome == 'lava':
        # Lava's land stands ~21 units above its measured shoreline (sea 24,
        # flats 45), close to the default base of 24, which stays. Its coasts
        # interlock land and lava fingers; the ridged slope material runs
        # down the banks to the lava's edge, and the section slope class
        # starts at 3 units per 16-px cell (~.19 per px). Authored profile.
        # Faces between the bank lines keep the ground's colour; the dark
        # striated rock is for cliffs only (measured shaded luma 51/45/38 at
        # slopes 0.4/0.65/1.0). Lava does not wet the ground.
        config['defaults'].update(example='coasts', material='single', fractures='0', scree='0',
                                  faceSlope='1.4,2.2', rockShare='0.1,0.8')
        config['material'].update(rockyCoasts=False, surfaceRelief=.6, slopeStart=.08, slopeFull=.25,
                                  slopeFloor=-4.0, slopeDry=2.0, rockSlope=2.4, wetBand=1.01)
    elif biome == 'crystal':
        # Crystal's land stands 20 units above the sea its retail maps set
        # (land 85, sea 65 on all four), close to the default base of 24,
        # which stays. Its maps are mostly water with column-covered islands
        # and hills. The section slope class starts at 2 units per 16-px
        # cell (~.125 per px) and the crack-webbed bank runs down to the
        # shelf. Authored profile.
        config['defaults'].update(example='columns', material='single', fractures='40', scree='0')
        # Its level ground is streaked on one diagonal (retail crystal
        # cracked: along-streak correlation of high-passed luma .12/.08 at
        # 6/12 px, 60 degrees). The 32-px tile model loses the streaks
        # (.00/.03); the quilted ground texture keeps them (.14/.09).
        config['defaults'].update(ground='texture')
        # Column tops: violet palette entries 220/221 (lit ~luma 60-78),
        # mean (74,58,90) over 3632 measured tops (crystal-geometry.json).
        config['material'].update(rockyCoasts=False, surfaceRelief=.6, slopeStart=.08, slopeFull=.25,
                                  slopeFloor=-4.0, slopeDry=2.0, crystalRGB=[74, 58, 90])
    elif biome == 'ice':
        # Ice's snow stands 20 units above its measured shoreline (sea 65,
        # flats 85; retail maps set 75 and draw the floe shelf below it), so
        # the default base of 24 stays. Snow slopes stay white to the floes;
        # slope class from 3 units per 16-px cell (~.19 per px). Authored
        # profile.
        config['defaults'].update(example='coasts', material='single', fractures='0', scree='0')
        # Ice blocks: snow tops (216,231,253).
        config['material'].update(rockyCoasts=False, surfaceRelief=.6, slopeStart=.1, slopeFull=.3,
                                  slopeFloor=-4.0, slopeDry=4.0, crystalRGB=[205, 220, 245])
    knobs = {**KNOB_DEFAULTS, 'shallowDepth': config['material'].get('shallowDepth', 2),
             'deepDepth': config['material'].get('deepDepth', 42), **WORLD_KNOBS.get(biome, {})}
    config['defaults'].update({k: str(v) for k, v in knobs.items()})
    config['knobs'] = sorted(knobs)
    if biome == 'zhon':
        # Zhon's domes are blue-grey (retail sections: mean (43,57,81), median
        # luminance 52); its rock art renders neutral grey, so the world
        # defaults its rock colour to match.
        config['colors'] = {'rock': '#3d5174'}
    if biome == 'desert':
        # Measured on the retail map. Its tans are 50/50 mixes of two palette
        # entries (orange 20+178, cool 84+65), which nearest-colour cannot
        # make, so the world stays full colour until the palette stage mixes
        # index pairs. Bed colour slots: 1 orange (189,143,105), 2 cool
        # band and cap (190,198,185), 3 upper rock (lit ~(159,152,135)).
        config['strataColors'] = [[189, 143, 105], [190, 198, 185], [150, 144, 128], [175, 111, 90], [120, 112, 100]]
        # Zones by height above the plain: orange with cool bands (share
        # ~0.2 low, ~0.4 by 17), the pale cap from ~56-60 (share 0.95), grey
        # rock with orange lines above ~69 (card E3: rust-pink lines, share .4, so
        # the strata stay readable on the tall buttes instead of one grey).
        config['strataZones'] = [[1, 0, 1, .2], [17, 0, 1, .4], [53, 0, 1, .4], [58, 0, 1, .95], [69, 2, 3, .4]]
        config['defaults']['example'] = 'mesas'
        # The plain: exact-index tiles from the retail map's level ground,
        # when the map has been exported (see ground_tiles.py).
        retail = Path('/private/tmp/nanolathe-map-editor/retail-desert/painted_desert-e2c3dad3')
        if retail.is_dir():
            from ground_tiles import make_ground_tiles
            tiles = make_ground_tiles(assets, retail, name='ground-tiles', per_map=2000, skip=(), above_sea=0, tolerance=2,
                                      max_height=8, max_vocab=32)
            config['textures']['groundTiles'] = '/sculpt-assets/ground-tiles.png'
            # Retail mixes each bed from the same ramps when shaded (orange
            # is mauve 19-22 over yellow 177-181, the cap greys 83-86 with
            # cream 65-67 and mint 50-51); over the whole palette, shading
            # walked the orange onto grey 86 + bright orange 198, which the
            # map never uses. Pairs come only from the entries of the map's
            # raised ground (99%) and its plain tiles.
            from palette_pairs import make_pair_lut, retail_entries
            make_pair_lut(assets, name='palette-pairs-desert.png', entries=retail_entries(retail) + tiles['vocabulary'])
            config['textures']['palette'] = '/sculpt-assets/palette-pairs-desert.png'
    config['assetBase'] = f'/sculpt-assets/{biome}/'
    config['textures'] = {k: v.replace('/sculpt-assets/', config['assetBase'], 1) for k, v in config['textures'].items()}
    if 'river' in config:
        config['river']['textures'] = {k: v.replace('/sculpt-assets/', config['assetBase'], 1) for k, v in config['river']['textures'].items()}
    config['biomes'] = BIOME_NAMES
    return config


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8767)
    parser.add_argument('--biomes', default='green,red,archipelago,moon,zhon,lava,desert,crystal,ice',
                        help='comma-separated biomes to prepare; the first is the default')
    parser.add_argument('--assets-root', type=Path, default=Path('/private/tmp/nanolathe-map-editor'),
                        help='each biome prepares its materials in <root>/assets-<biome>')
    parser.add_argument('--export-tool', type=Path, help='Card D map exporter binary (default <assets-root>/map-export)')
    parser.add_argument('--feature-tool', type=Path, help='Card D feature catalogue binary (default <assets-root>/bin/map-features)')
    parser.add_argument('--game-root', action='append', type=Path, help='content root for exports; repeat in mount order')
    args = parser.parse_args()
    from sculpt_export import MapExport
    map_export = MapExport(args.assets_root, args.export_tool or args.assets_root / 'map-export', args.game_root or [Path.home() / 'TotalAnnihilation'], args.feature_tool or args.assets_root / 'bin' / 'map-features')
    biomes = [b for b in args.biomes.split(',') if b in BIOME_NAMES]
    assets = {b: args.assets_root / f'assets-{b}' for b in biomes}
    configs = {}
    for b in biomes:
        # A world whose source data is missing (e.g. a section catalog) is
        # skipped with a message rather than stopping the server.
        try:
            configs[b] = biome_config(b, assets[b])
        except (FileNotFoundError, OSError, ValueError) as err:
            print(f'skipping world {b}: {err}', flush=True)
    biomes = [b for b in biomes if b in configs]
    # Any world may take another's ground pattern (World panel); the
    # pattern's mean is replaced by the world's ground colour.
    patterns = {b: {'name': BIOME_NAMES[b], 'grass': configs[b]['textures']['grass'],
                    'groundTiles': configs[b]['textures'].get('groundTiles')} for b in biomes}
    for config in configs.values():
        config['biomes'] = {b: BIOME_NAMES[b] for b in biomes}
        config['groundPatterns'] = patterns
        config['variants'] = {k: v['label'] for k, v in WORLD_VARIANTS.get(config['biomeId'], {}).items()}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            path = urlsplit(self.path).path
            try:
                if map_export.get(self, path):
                    return
            except (OSError, ValueError, subprocess.SubprocessError) as err:
                map_export.reply(self, {'error': str(err)}, 400)
                return
            content_type = 'text/plain; charset=utf-8'
            if path == '/sculpt-config.json':
                # An unknown or unavailable world is an error, not a silent
                # fallback to the first world: a labelled render must never
                # be another world's terrain (review A3, 2026-10-27).
                requested = parse_qs(urlsplit(self.path).query).get('biome')
                biome = requested[0] if requested else (biomes[0] if biomes else '')
                config = configs.get(biome)
                if config is None:
                    self.send_error(404, f'unknown or unavailable world: {biome}')
                    return
                # A variant of the world (card C5 stage 3); none is the world's own preset.
                variant = parse_qs(urlsplit(self.path).query).get('variant', [''])[0]
                if variant:
                    config = apply_variant(config, biome, variant)
                    if config is None:
                        self.send_error(404, f'unknown variant {variant} of world {biome}')
                        return
                body = json.dumps(config).encode()
                content_type = 'application/json'
            else:
                name = path.strip('/')
                if name in ('', 'sculpt'):
                    name = 'sculpt.html'
                file = SOURCES.get(name)
                if path.startswith('/sculpt-assets/'):
                    biome, _, leaf = path.removeprefix('/sculpt-assets/').partition('/')
                    if biome in configs:
                        allowed = {v.rsplit('/', 1)[-1] for v in configs[biome]['textures'].values()}
                        allowed.update(v.rsplit('/', 1)[-1] for v in configs[biome].get('river', {}).get('textures', {}).values())
                        allowed.update(('rock-restrained.png', 'rock-structural.png', 'noise-ridged-gaussian.png'))
                        if leaf in allowed:
                            file = assets[biome] / leaf
                if file is None or not file.is_file():
                    self.send_error(404)
                    return
                body = file.read_bytes()
                if file.suffix == '.html': content_type = 'text/html; charset=utf-8'
                if file.suffix == '.js': content_type = 'text/javascript; charset=utf-8'
                if file.suffix == '.png': content_type = 'image/png'
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_POST(self):
            try:
                map_export.post(self, urlsplit(self.path).path)
            except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as err:
                map_export.reply(self, {'error': str(err)}, 400)

        def log_message(self, fmt, *args):
            if args and str(args[1]) not in ('200', '304'):
                super().log_message(fmt, *args)

    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    print(f'Shared-surface sculptor: http://127.0.0.1:{args.port}/sculpt', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
