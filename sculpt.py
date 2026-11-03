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
    'sculpt.html', 'sculpt.js', 'sculpt-ui.js', 'sculpt-control-schema.js', 'sculpt-ui.css', 'sculpt-selection.js', 'sculpt-paths.js', 'sculpt-renderer.js', 'sculpt-vert.wgsl',
    'engine-frag.wgsl', 'engine-bake.wgsl', 'engine-common.wgsl', 'engine-materials.wgsl', 'engine-palette.wgsl', 'engine-weather.wgsl',
    'engine-erosion.wgsl', 'sculpt-material-model.js', 'sculpt-column.js', 'sculpt-noise.js', 'sculpt-erosion.js', 'engine-shape.wgsl', 'engine-feed.wgsl', 'sculpt-gpu-fields.js', 'sculpt-shape-presets.js', 'sculpt-map.js', 'sculpt-export.js', 'sculpt-features.js', 'sculpt-canvas.js', 'sculpt-preview.js', 'sculpt-change-map.js', 'sculpt-chunk-renderer.js',)}


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
    faceVariation=.8, lean=0, facing=0, outlineVar=1, widthVar=1, heightVar=1, faceFill=.18, slopeTexture=.3, faceEdge=.8, gullyRock=.5, moss=0, crevice=0,
    boulders=0, boulderSize=9, boulderFoot=.5, boulderCluster=.6, boulderMoss=.35, boulderRound=0,
    debris=0, debrisReach=48, debrisSize=6, debrisSort=.8, repose=.6,
    sand=0, wind=20, sandDust=.5, sandGrass=.6,
    sandLight=.25, sandGrain=.8, ripple=7, rippleHeight=1.4,
    crackSeverity=.6, crackSpacing=40, crackMajor=.8, crackMinor=.75, crackHairline=.6,
    crackBlocks=.6, crackWidth=1, crackNetwork=.35, crackDark=.75,
    # Rock structure (card E3): rockOrder 0 is the scattered rock; the rest only matter above it, and the cracks of ordered rock are lit relief, not ink.
    rockOrder=0, bedSpacing=12, bedVary=.5, bedDip=0, bedDipDir=90, bedLedge=.5,
    jointDepth=2, grooveSpacing=36, grooveAngle=0, grooveRun=120, bedHeight=0, rockFrom=.6,
    craterlets=3, craterEjecta=0, worms=0, rockCrown=0, apron=0,
    crystalForm=0, crystalStep=16, crystalSides=6, crystalSize=24, crystalCount=10, crystalTop=.2, crystalLean=.25,
    crystalVariation=.5, crystalTiers=0,
    # Berg form (card E5; only read when a Crystals stroke sets crystalForm 2): faces in units per px, jitter, broken corners, roughness in units, top tilt in units per px and its direction in degrees.
    crystalAlign=0, bergFace=.9, bergJitter=.5, bergBreak=3, bergRough=6, bergTilt=.1, bergTiltDir=90, bergFlat=.25,
    shorePlates=0, plateWaterPx=64, plateLandPx=96, plateSize=28, plateGap=2, plateHeight=3, plateMaterial=1,
    crystalGrain=0, crystalFace=1, crystalInk=0, crystalTone=1, crystalSeam=0,
    # Ice (card E5): shade keeps its blue (0 grey, as every world was).
    shadeBlue=0,
    # Ice frost band (card E5): its cells skip the wet-band darkening (0: every world as before).
    frostWet=0, frostNeedles=.5,
    banding=0, bandSoftness=.35, bandWater=0, sandBanding=0, sandBandSpacing=2,
    strata=0, strataContrast=.6, strataGrain=1,
    fingers=0, bankPx=0,
    # Coast pass (card E4): fingers on the joined coast and flat shore layers cut as heights
    # (layerPx px a layer, riser 0 shares the bank's rise out, ledge and irregularity in shares).
    shoreLayers=0, layerPx=12, layerRiser=0, layerLedge=.75, layerRough=.5, layerStyle=0, shoreEdge=0, beachWidth=.6, shallowDepth=24, deepDepth=60, waterSoft=32, crispShore=1, bankRock=.25,
    dither=2, landDither=.25, paletteMix=0, microRock=1,
    # Form (repro round): ledges on steep faces, darker faces, jagged bands.
    faceStreak=0, faceStreakFrom=.3, faceDark=0, bandJag=0, bandFade=.75,
    # Dry banks below the plain lit as level ground, with no bands or wet band (Archipelago's beaches).
    flatBank=0,
    # Cross-section (card C1): the face width in px (0: a share of the brush) and the terraces on the curve (sculpt-shape-presets.js).
    facePx=0, terraces=0, ledge=.6, terraceJitter=.35, breakup=0,
    # Landform (card H27): the crest's height (absolute, in height units) and how it combines (0 raise to, 1 cut to, 2 flatten to); the variation along and
    # across the path (wander px, width as a share, height in units, the wavelength px, and the weights at the foot and from the middle up of the section).
    elevation=100, combine=0, routeSmooth=0, wander=24, widthVary=.2, heightVary=3, varySize=140, varyFoot=1, varyMiddle=1,
    # Painted masks (card C5): the Paint brush's first choice, and the landforms'
    # Paint inside option (channel 0 is off), with its strength.
    paintChannel=1, maskChannel=0, maskAmount=1,
    # Water looks (card E1). The three stroke options are 0 (the world's own),
    # 1 or 2; the world knobs default to the earlier noise water, a ramp from
    # shallow to deep colour, and level ground with no painted lumps beyond
    # plainRelief's.
    waterShore=0, waterDeep=0, waterBed=0, bedLit=0, bedTint=.85, bedBright=1, bedContrast=1, hillLight=1, ringFade=0, bedRelief=0, deepEdge=0, lumpRelief=4,
    # Line features (card C4): everything off by default; spur and rim details only matter once spurs, sectors or gaps are set.
    spurCount=0, spurLength=120, spurSpread=.4, spurWidth=.8, spurTaper=.6, spurHeight=.7, spurForks=0, spurBulb=0, crestJag=0, crestVary=0, crestTaper=0,
    rimSectors=0, rimUnequal=.6, rimGaps=0, rimGapWidth=70,
    # Local style (card C5 stage 2): change about the world's own value, 0 none.
    styleRelief=0, styleCracks=0, styleBanding=0, styleFace=0, styleErosion=0, styleDeposits=0, styleVegetation=0, styleExposure=0,
    # Crater rim height as a share of its depth (card C4); .34 is the rim every crater had.
    rimHeight=.34,
    # Placed fissures (card C4 stage 2): only the Fissure tool reads them.
    fissureWidth=5, fissureJag=.5, fissureBranches=3, fissureBranchLen=90, fissureBranchSpread=.5, fissureTaper=.6,
    fissureNetwork=0, fissureCell=70, fissureCrack=.4, fissureDark=.6,
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
# E7 (Crystal): every knob's default is the earlier output.
KNOB_DEFAULTS.update(crystalFacet=0, crystalSizeVar=0, crystalSmooth=0, craterFacets=0, crystalShallow=0, crystalShallowPx=10)
# G7 (Crystal): craters with smaller, softer facets (0: the earlier output).
KNOB_DEFAULTS.update(crystalCraterPx=0, crystalCraterStep=3, crystalCraterSkin=0, crystalCraterWeb=0, crystalCraterWebPx=14, crystalCraterWobble=0,
                     crystalCraterGap=0, crystalCraterTone=0, crystalCraterLight=1)
# G7 (Crystal): finer shore slabs and fainter seams (the defaults are the earlier output).
KNOB_DEFAULTS.update(crystalShoreSeam=.5, crystalSeamEnd=.74, crystalShallowInk=.55)
# H20b (Crystal): the share of shore slabs that break into a fine mesh inside their own outline (0: the earlier output).
KNOB_DEFAULTS.update(plateVary=0)
# E8 (Painted Desert): ragged feet (outline shift, px) and bumpy aprons (height units); 0 is every world as it was.
KNOB_DEFAULTS.update(baseVary=0, baseBump=0)
# E8: the grey band at the foot of the raised ground (strength; its height window above the plain, how far the window
# drifts, and the share of its length that is missing).
KNOB_DEFAULTS.update(baseBand=0, baseBandLow=4, baseBandHigh=6.5, baseBandWander=1, baseBandGaps=.45)
# G4 (Painted Desert): level ground in the pale cap zone kept as one sheet of the cool bed (strength).
KNOB_DEFAULTS.update(desertCapFlat=0)
# E9 (Green rock faces): every default is the earlier look; Green's own values are in WORLD_KNOBS.
KNOB_DEFAULTS.update(rockMoss=1, rockDetail=1, shineOutside=1, faceRelief=1,
                     gullyDepth=0, gullyWidth=14, gullyShade=0, ribTilt=0,
                     bedPunch=0,
                     facetTilt=0, facetCoarse=0)
# E11 (shallow water round 2): every default is the earlier look. shelfWander (depth units) moves
# the hard step's depth with broad noise so the band's width and outline vary along the shore;
# bedFlat lights the lit bed by its own relief only (no slope shading across the shelf).
KNOB_DEFAULTS.update(shelfWander=0, bedFlat=0)
# E11 Red: crackedStep is the step's depth under a cracked-bed stroke (0: the world's own);
# bedDots / bedDotCell draw dark dots in the lit bed.
KNOB_DEFAULTS.update(crackedStep=0, bedDots=0, bedDotCell=14)
# E11 Archipelago: ringContrast / ringCount / ringSize draw contour lines in the red fringe that
# follow the hill's outline (contrast 0 = none, lines from the inner to the outer edge, reach
# against the ring texture's own).
KNOB_DEFAULTS.update(ringContrast=0, ringCount=7, ringSize=1, stepSoftPx=1)
# E10 (Lava): finger size; layer width variation (0 even layers) and the circle size in px of circular
# layers. Every default is the earlier output.
KNOB_DEFAULTS.update(fingerSize=1, layerVary=0, layerCircle=26)
# E10 (Lava): a hill built of stacked round lobes (0 lobes: the plain hill) cut into this many equal steps.
# E10 (Lava), shader knobs: a dark crease at the foot of each bank step, and the slope from which the shine applies.
KNOB_DEFAULTS.update(layerCrease=0, shineSlopeGate=0)
# G5 (Lava): contour layers spread in width (0 none).
KNOB_DEFAULTS.update(lavaSpread=0, lavaCircleVary=0)
# G5 (Lava), hill rock: crust strength (0: none), pillow and chip size in px, hanging veins, the share of the fall-line relief it replaces, and the dusk on shaded rock.
KNOB_DEFAULTS.update(lavaCrust=0, lavaPillow=34, lavaChip=5.5, lavaVeins=0, lavaCalm=.6, lavaDusk=0)
# E6: shine roughness only on raised ground and slopes (0: everywhere), and the headroom that lets
# a glint read on near-white ice (0: the lobe only adds light).
KNOB_DEFAULTS.update(shineGate=0, shineHeadroom=0)
# E6, Moon: pits on raised ground and slopes (0: none; the earlier look is wrinkles .8, worms .4, cracks .35 with no pits).
KNOB_DEFAULTS.update(pockmark=0, pockSize=5)
# G8, Moon: lit cups (0: none; the pockmark dots above are separate). Size is the spacing across the glint axis in px, depth the wall steepness.
KNOB_DEFAULTS.update(moonCups=0, moonCupSize=5.5, moonCupDepth=1.4)
# G8, Moon: stringy light and dark strokes down steep faces (0: none), their steepness and the darkening of faces turned from the sun.
KNOB_DEFAULTS.update(moonRibs=0, moonRibDepth=1, moonRibDark=0)
# G8, Moon: thin dark folds that follow the form across lit and moderate slopes (0: none), and the height between their contours.
KNOB_DEFAULTS.update(moonFolds=0, moonFoldSpacing=.9)
# G8, Moon: how far a hill's whole outline strays in lobes, as a share of its radius (a shape option; 0: the smooth outline).
KNOB_DEFAULTS.update(moonLobes=0)
# E6, Ice mountains: monotone slate faces (0: rock and snow interleaved) and the rock art's contrast (1: as drawn).
KNOB_DEFAULTS.update(iceSlate=0, mineralDetail=1, iceCrystal=0, iceCrest=0)
# G6, Ice blocks and mesas (retail ice-3, Polar Range): rounded light, snow on the flat tops, fibres down the faces, a hatched apron (0: none of them).
KNOB_DEFAULTS.update(iceSoft=0, iceSnow=0, iceFall=0, iceApron=0)
# G6, Ice frost band: fine hairlines in the band (0: none).
KNOB_DEFAULTS.update(iceFrost=0)
# G6, Ice: angular facets on hills and mountains (share of the mountain broken into facets; facet width in px). Off by default everywhere.
KNOB_DEFAULTS.update(iceFacets=0, iceFacetSize=36)
# G1 (shallow water round 3): shoalBump is the slope of the lit bumps the shallow bed carries
# (0: none, the earlier bed), shoalBumpPx their size in screen px.
KNOB_DEFAULTS.update(shoalBump=0, shoalBumpPx=6)
# G1: shoalRag is how far (px) pixel notches move the shallow-to-deep step, independent of the
# bed's slope (0: the step's earlier jitter, which a gentle shelf scales to nothing).
KNOB_DEFAULTS.update(shoalRag=0)
# G1: shoalStairs is how far (px) runs of 1-3 px move a hard waterline, whatever the bank's slope
# (0: the earlier jitter, whose notch grows with how gently the bank shelves).
KNOB_DEFAULTS.update(shoalStairs=0)
# G1: shoalShoreSoft is the width (px) of the dithered blend at the waterline the world draws (a
# stroke's own Hard or Faded choice is not touched; 0: a clean hard line).
KNOB_DEFAULTS.update(shoalShoreSoft=0)
# G1: shoalGrain lets this share of the ground tile's colour grain (its deviation from the tile's
# mean, lit as the bed) through the tint (0: the tint replaces it, the earlier bed).
KNOB_DEFAULTS.update(shoalGrain=0)
# E6, Ice frost band: melt pockets (share of cells at the coast, and how far inland they reach as a share of the band; .17 and .65 are E5's).
KNOB_DEFAULTS.update(frostGaps=.17, frostGapReach=.65, frostGapSize=11, frostGapDepth=3)
# G3 (Archipelago rings): the fringe's lines as offset copies of the hill's outline (ringShift px, 0: the earlier concentric
# lines; ringCount copies), drifting towards ringShiftDir degrees clockwise from east with ringScatter of a half turn of
# wander, and ringWobble px of waver in each outline (lobes ringLobe px across).
KNOB_DEFAULTS.update(ringShift=0, ringShiftDir=315, ringScatter=.5, ringWobble=3, ringLobe=22)
# G3: the stack fades into the sand: ringFill (pale tint, stepping lighter outward), ringPatch over
# ringPatchSize px (the reach varies along the outline). 0: as the concentric look.
KNOB_DEFAULTS.update(ringFill=0, ringPatch=0, ringPatchSize=120)
# G3: ringTone 1 draws the copies' lines in retail's rose, paler outward (0: the earlier crimson).
KNOB_DEFAULTS.update(ringTone=0)
# G2 (rock faces follow the slope): 0 keeps the fixed screen directions of every world; 1 runs beds along the
# contours of the ground and joints, gullies and facets down its fall line. The reaches are the
# height smoothing radii (px) of the local and of the wide fall line, cliffFlat the wide slope under which
# the structure fades into plain broken rock, cliffDomain the patch size of the joint lattice.
KNOB_DEFAULTS.update(cliffFollow=0, cliffReach=20, cliffWide=56, cliffFlat=.04, cliffRise=0, cliffBed=.5, cliffStagger=0, cliffFine=0, cliffDomain=90)
# H1 (lit relief): shade the ground behind a 1-6 px ledge, and darken crevices and crack floors (0: off).
KNOB_DEFAULTS.update(closeShadow=0, cavity=0)
# H2, H16 (rock column): a world with a `column` block in its table reads each bed's thickness and hardness from it (sections of
# beds that repeat upward, materials/<world>.json) in place of the hash; columnContrast scales how much harder the hard beds are (ledge height and,
# with erosion 1, wear). The GPU Time pass uses erosionAge iterations, erosionRain times the base rain, talusAngle the repose of loose debris (degrees).
# H4 item 4 (engine 1): rock blocks cut from the column's beds by joints (engine-bake.wgsl blockField); blocks 0 is none.
KNOB_DEFAULTS.update(blocks=0, blockRow=4, blockWidth=7, blockTilt=.5, blockStep=.8, blockSeam=.5, blockChip=1.2)
# H4b (engine 1): blocks on hill rock, outside the structured face (0: none).
KNOB_DEFAULTS.update(hillBlocks=0)
# H5 (Green's engine): the Time pass's marks. 3a is retail's (terraceBreak, terraceCalm, wetSwath, outcrop);
# 3b is beyond retail and stays 0 for Green (rillDepth, rillSpacing, stoneDensity, stoneSize; `sand` and ripple already exist).
KNOB_DEFAULTS.update(terraceBreak=0, terraceCalm=0, wetSwath=0, outcrop=0, rillDepth=0, rillSpacing=8, stoneDensity=0, stoneSize=5)
KNOB_DEFAULTS.update(columnContrast=1, erosion=0, erosionAge=200, erosionRain=1, talusAngle=40)
# H8: a world's engine preset. Every world runs the Time pass (erosion 1). The eight worlds that
# had no rain erosion take the pass with rain off and the envelope of the droplet worker's own budget (the worker's .35 of the pass's
# BUDGET 3, sculpt-erosion.js): its maps are made, its height moves no further than the worker's did.
# H4: the knobs Green's engine (engine 1) sets over WORLD_KNOBS. engine 0 keeps WORLD_KNOBS alone, so it draws as merge-h3 does.
# Blocks replace most of the facets and Green's long joints on the face (the blocks have their own joints), and the gullies
# are eased so the courses and joints read; measured on green-2's face in NOTES.md (H4).
# H17: terraceBreak 1.4 -> 0. Its phase wander broke green-2's slope into a dense blotchy mass; at 0 the band lines follow
# the contours as retail's flowing lines do (viewed at 1x; green-1 and green-3 do not change). banding .8 -> .5 (WORLD_KNOBS)
# lightens and thins those lines toward retail's soft dashes.
LIGHT_PASS = dict(erosion=1, erosionRain=0, erosionEnvelope=.12)
ENGINE_KNOBS = {
    'green': dict(blocks=1, blockRow=3.2, blockWidth=5.76, blockTilt=.8, blockStep=1.5, blockSeam=1.6, blockChip=1.2,
                  facetTilt=.3, facetCoarse=0, cliffFine=.2, jointDepth=0, gullyDepth=4,
                  rockMoss=.4, hillBlocks=.5,
                  terraceBreak=0, terraceCalm=0, wetSwath=.35, outcrop=0),
    **{world: LIGHT_PASS for world in ('red', 'archipelago', 'moon', 'zhon', 'lava', 'desert', 'crystal', 'ice')},
}
# Per-world overrides of KNOB_DEFAULTS (authored presets; shallowDepth and
# deepDepth come from each world's measured water ramp).
WORLD_KNOBS = {
    # Crack darkness calibrated on retail (measure/crack_lines.py, strong
    # and long line densities on slopes): Green's lines were ~2.5x retail's.
    # crackDark also darkens band lines, so the band row's line strength (materials/green.json) keeps their darkness.
    'green': dict(banding=.5, crackDark=.4,
                  # Repro round (3 windows, 12-map census, measure by slope
                  # and facing): faces keep fall-line ribs much more than
                  # any retail map; slopes turned from the sun are too light.
                  faceStreak=1, faceDark=.35,
                  # Great Divide's terraces are short dashes stacked like
                  # scales, not long smooth lines (thin dark lines per
                  # pixel 0.124 against retail's 0.235; bandJag 1 gives 0.158).
                  bandJag=1,
                  # Card E3 (retail green-2's big rock face): coherent level beds cut
                  # by long joints leaning ~20 degrees (row period 8-12 px whatever the
                  # slope; thin-line direction shares vertical/horizontal .29/.27 against
                  # ours .47/.13 before), cracks as lit relief rather than ink. Beds and joints
                  # only on painted rock (rockFrom 1.6): the hills of green-1 and green-3 carry
                  # sparse patches and keep their own relief.
                  rockOrder=1, rockFrom=1.6, bedSpacing=5, bedHeight=1, bedVary=.9,
                  bedLedge=.4, grooveAngle=-20, jointDepth=3,
                  # Water (card E1). Retail Green's shallows are the lit bed under a
                  # blue tint (mean (73,110,240), luma s.d. 11 against deep 1.5) and end
                  # in a hard step: colour by depth is flat to ~30 and gone by ~44 in
                  # both windows (retail depth 32-40: R 53, 40-48: R 39, the 16-px height
                  # grid upsampled), so the step sits at 40 (H24: the midpoint, 42) and nothing fades.
                  bedLit=1, bedTint=1, bedContrast=.45, bedRelief=1, deepEdge=1,
                  # Ground (card E1): retail's plain is flat (dry heights 9 +- 1) with lit
                  # lumps only in patches, which the Paint brush's Ground lumps makes. On
                  # level pixels (24 px from other heights) the s.d. of 15-px-blurred luma
                  # was 3.84 / 3.16 in green-1 / green-3 against retail's 1.74 / 1.61;
                  # no undulation gives 2.85 / 2.69 (the rest is the tiles and hill feet).
                  # The undulation knobs and Level-ground lumps still work.
                  undulation=0, plainRelief=0,
                  # E9 (Green rock faces): retail's big face is carved (leaning gullies and ribs, so stripes of it
                  # light or shade as a whole), layered in long ledges that bend with it,
                  # and crumpled into angular facets that glint; grass keeps to its edges. Measured on green-2's
                  # face (measure/rock_face.py): luma s.d. 19.8 -> 26.3 (retail 27.2), share over luma 90
                  # .040 -> .071 (.074), blurred-luma s.d. 7.5 -> 10.5 (10.8). Every knob's default is the
                  # earlier look: rockMoss 1, rockDetail 1, gullyDepth 0, ribTilt 0,
                  # bedPunch 0, facetTilt 0, shineOutside 1 and bedLedge .55.
                  rockMoss=.15, rockDetail=.5,
                  gullyDepth=8, grooveRun=90, gullyShade=1.2, ribTilt=.2,
                  bedPunch=1,
                  facetTilt=1, facetCoarse=.5, cliffFine=.7,
                  shineRock=.32, shineRockSharp=14, shineRockRough=.18, shineRockScale=5, shineWhite=1, shineOutside=.3,
                  # E11 (round 7 report: "too smooth", "matches the shoreline too closely",
                  # "blurry parts"): the step is a true threshold that wanders ~24 depth units over
                  # 140 px; the bed is lit by its own relief (green-3's blur was the shelf's slope
                  # shading the pale bed over 100+ px) and carries crisp mid-scale lumps (luma s.d.
                  # after a 5-px blur 2.8-3.9 -> 5.6, retail 5.6 / 7.5 in green-1 / green-3).
                  shelfWander=24, bedFlat=1,
                  # G1 (round 8 review: "reads as noise while retail reads as lit bumpy terrain"): the
                  # palette dither's white noise went; lit bumps of 5 px take
                  # its place. After a 9-px blur the bed's lit / dark shares and clump sizes are
                  # retail's (green-1 .19 / .22 and 8.6 / 13.7 px against .20 / .20 and 9.1 / 14.4).
                  shoalBump=1.8, shoalBumpPx=5,
                  # G1: the shallow-to-deep outline is notched by up to 5 px (retail's runs 3-8 px).
                  shoalRag=5,
                  # G1: the hard waterline steps in 1-3 px runs (retail's), up to 2 px off the depth contour.
                  shoalStairs=2,
                  # G2: the owner's round 8 note on the rock face: beds and joints follow the hillside they are cut in, not the
                  # screen. Beds are the contours of the ground (smoothed over 40 px, 30% of the way from the grid's own
                  # heights), 6.5 height units apart (bedSpacing, was 28 against a tilt of 2 that made rows level on the screen:
                  # 7-13 px on a face of slope .5-1), their ledges 16 high (cliffRise); joints, gullies and
                  # facets run down the fall line. bedDip is 0 now, and the beds follow the ribs and gullies at 1 (was 2.5) because a bed is a quarter as
                  # thick, so the ribs would fold it fourfold.
                  cliffFollow=1, cliffReach=40, cliffBed=.3, cliffRise=8,
                  # G2: the vertical bands break up: each bed's joints at their own offset (up to .35 of a spacing).
                  cliffStagger=.35,
                  # H1 (lit relief): ledges shade the ground 1-6 px behind them and crevices lose ambient light, so the
                  # beds are lower than G2's (cliffRise 16 -> 8, bedLedge .6 -> .4, the ledge lip 3 -> 2): taller ledges now shade
                  # the whole face. green-2 face (x 20-880, y 650-870) mean luma / s.d. / share under 30 / p90 gradient:
                  # retail 45.8 / 27.2 / .245 / 17.6, G2 46.9 / 23.3 / .143 / 14.8, here 44.7 / 26.4 / .247 / 17.6.
                  closeShadow=.8, cavity=.6,
                  # H2 (rock column): its `column` table (materials/green.json) has eight beds repeating every 47 height units (a hash
                  # bed averaged 5): thin hard beds that stand as ledges between thicker soft ones, so the hard ones read as lines and the
                  # soft ones as the space between.
                  # H2 (erosion): the GPU shallow-water Time pass.
                  erosion=1, ),
    # Card E3 (red-3): slope cracks lighter and finer than the ink web: lit relief
    # grooves (ordered rock) .5 px wide on 28-px blocks at depth .3, and thin long
    # joints (30 px apart, 3 deep) in place of the scattered chunks; no beds (retail
    # Red's faces show none).
    'red': dict(crackSeverity=.3, crackDark=.35, crackWidth=.5, banding=.3,
                reliefAmount=.2, slopeTexture=0, microRock=0,
                crackSpacing=28, rockOrder=1, bedLedge=0,
                jointDepth=3, grooveSpacing=30, grooveAngle=-10, grooveRun=160,
                # G2: joints run down the fall line of the ground they are cut in (grooveAngle is the lean from it), and painted
                # rock on level ground fades into plain broken rock. Red has no beds.
                cliffFollow=1, cliffReach=40,
                # Red's shallows (card E1) are lit terrain too, tinted purple and ending in a
                # hard stop: red-2's lake is the plain ground tinted lilac (mode 2, the
                # default); a stroke may set the cracked bed (red-3's shelf, mode 1).
                bedLit=1, bedTint=1, bedContrast=.65, bedBright=1.1, bedRelief=1, deepEdge=1,
                # E11 (round 7 report: "darker dots", "cracks too soft", "edge against the deep
                # water seems shaded"). Retail's lilac lake has dark dots of 3-4 px every 12-20 px
                # (dark components >= 3 px average 6.5-11 px, ours 4.3-6.7); the step is a true
                # threshold. Under a cracked-bed stroke (red-3's shelf) it sits at depth 14, where
                # retail's lilac share falls from .91 (0-6) / .66 (6-12) to .27 (12-18) / .17;
                # the lake (red-2) is lilac to its full depth 24 and keeps the world's 22. The
                # cracked bed is cut as rocky ground and keeps its crevices through the tint
                # (luma s.d. 14.0 in retail, 16.7 here, 4-5 before).
                shelfWander=6, bedFlat=.6,
                crackedStep=14, bedDots=.18, bedDotCell=15,
                # G1: lit bumps of 8 px, and no palette dither (see Green).
                shoalBump=2, shoalBumpPx=8,
                # G1 (round 8: "the transition from shallow to deep needs a pixel-ragged edge, right now it is
                # too smooth"): the step's jitter was the bed's gradient times a constant, nothing on the
                # shelf's gentle slope; the notches are now px displacements, up to 9 px as retail's teeth.
                shoalRag=9,
                # G1: retail's lilac lake keeps pink and salmon pixels of the ground under it; .3 of the tile's
                # colour grain shows through the tint (.9 reads as glitter; .5 raised the pixel-scale energy
                # past the lake's before value, .25 kept it).
                shoalGrain=.3),
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
    # fade over 30-40 px); a stroke may set a hard step, which sits at the midpoint, depth 18 (20 before H24).
    'archipelago': dict(crackSeverity=.4, crackMajor=.6, banding=.5, crackDark=.3, flatBank=1,
                        undulation=0, shadeDepth=.3,
                        # Hills and the mineral ring (card E1): mound pixels averaged (90, 80, 65)
                        # against retail's (102, 92, 76) in windows 2 and 3, with 15% of them under
                        # luma 45 (retail 5-6%). Hill cover x1.25 and a third of the directional
                        # shading give (103, 92, 76) and 7% dark. The ring is the curved 'Nested
                        # rings' texture, narrower (spread .35), lighter (.7, variation .5) and
                        # fading over a longer reach.
                        hillLight=1.25, ringFade=1,
                        bedLit=1, bedTint=1, bedContrast=.8, bedBright=1, bedRelief=1,
                        # E11 (round 7 report: "weird black/dark lines around the hills" and "more
                        # noticeable circle features in the red fringe"): the dark lines were the
                        # first band risers on the hill's foot (banding 0 removes them, crack knobs do
                        # not), so band lines start 8 units above the base; retail's fringe is 8-12
                        # thin wavy crimson lines 2-4 px apart hugging the hill's outline, which the
                        # contour pass draws from the mineral field's falloff (so they follow the
                        # outline, not the screen). Reef bars carry retail's dappled texture
                        # (luma s.d. after a 3-px blur 8.4 against ours 3.0 before).
                        stepSoftPx=14, shelfWander=6,
                        # G1: the reef bars are soft blotches (retail: 8-16 px energy 1.8 against 1.3 at 4-8 px;
                        # 4.5-px bumps at 3 read as chunky cobbles): faint lit bumps of 9 px, a few dots, and no
                        # palette dither (3-px-blurred luma s.d. retail 7.6, before 4.7, now 5.8; see Green).
                        # H18 part 2: a mottle of the bed's brightness printed noisy blotches on the bars where retail's are
                        # smooth and soft (archipelago-1 alone: 1.6 mean |diff|, 4.2% of blocks); none reads closer there.
                        bedDots=.1, bedDotCell=9, shoalBump=1.5, shoalBumpPx=9,
                        # G1: a hard step's outline is notched by up to 4 px (its 14-px ramp softens them).
                        shoalRag=4,
                        # G1 (round 8: "the default should still have a small blur on the edge"): the world's own
                        # waterline is a 4-px dithered blend of sand and water pixels (retail's is 2-4 px
                        # of scattered sand in the water's edge); a stroke's Hard and Faded still draw their own.
                        shoalShoreSoft=4,
                        # G3: the fringe as stacked offset copies of the hill's outline, not concentric lines
                        # (round 8: retail's step outward in several copies, each offset from the last). The
                        # reach is a wider outer level than the concentric lines' (ringSize .3). The earlier
                        # look is ringShift 0 with ringContrast .55, ringCount 12 and ringSize .3.
                        ringShift=13, ringShiftDir=315, ringScatter=.5, ringWobble=9, ringLobe=20,
                        ringContrast=.95, ringCount=22, ringSize=.6,
                        # G3 fade: outer lines fainter, a pale lime skirt stepping lighter outward, and a
                        # reach that varies along the outline (retail's halo is wide on some sides of a hill
                        # and a few px on others). ringTone 1: retail's rose lines, paler outward.
                        ringFill=.45, ringPatch=.8, ringPatchSize=160, ringTone=1),
    # Painted Desert, measured on the retail map (measure/desert_*.py): beds
    # alternate every ~6 units; dark lines are shaded risers on 0.4% of lit
    # slopes, not cracks; the plain carries no lighting (luma vs gradient
    # R^2 0.000), so no undulation, lumps or occlusion; no drifts. Mesa
    # flanks: a narrow cap and wide even faces (cross-sections of the retail
    # mesa in repro/scenes/desert.json). Sunlit faces are no brighter than
    # the level (retail W/SW faces 0.99-1.00 of level luma; a 1.13 cap gave
    # 1.07-1.14), so no highlight above level.
    # Its beds are all alike (columnContrast 0): they stand one ledge high, and the Time pass reads no hardness.
    'desert': dict(lightCap=1, paletteMix=1, strata=1, strataContrast=1, columnContrast=0, banding=.4,
                   # H19: the lit relief on a wall in Desert's strata reads as black scribbles at 1; .3 to .5 read as rock on repro/walls/desert.json.
                   faceRelief=.4,
                   strataGrain=.25, crackSeverity=0, crackMajor=.2, crackMinor=.1, crackHairline=0, crackBlocks=.1,
                   sand=0, undulation=0, plainRelief=0, flatOcclusion=0, reliefAmount=.15, gentleRelief=.2, gullyRock=0,
                   # Card E3: tall mountains keep their strata and gain lit ledges (beds the strata's
                   # 6 height units thick, level on the height so they ring each butte), long
                   # joints, and black shadow sides: retail's buttes are dark on the side turned
                   # from the sun, where ours shaded to a soft grey. No fill light and little
                   # ambient (faceFill 0, ambient .3) darken those faces; faceDark would not, as
                   # the strata colours replace the face material.
                   rockOrder=1, rockFrom=.45, bedHeight=1, bedSpacing=6, bedDip=0, bedVary=.4, bedLedge=1,
                   jointDepth=3, grooveSpacing=30, faceFill=0, ambient=.3,
                   # G2: joints run down the fall line (its beds are height contours already, kept on the grid's own heights
                   # so the lit ledges stay with the strata colours: cliffBed 0).
                   cliffFollow=1, cliffReach=40, cliffBed=0,
                   # E8: retail's aprons and mesa feet are ragged (cells 16 px wide, edges 10-20 px off a smooth
                   # lobe) and bumpy (heights vary 7-12 across an apron whose mean rise is ~8).
                   baseVary=36, baseBump=3.5, baseBand=1,
                   # G4: level ground in the pale cap zone is one sheet, as in retail (cap orange 10-12% against ours' 22%).
                   desertCapFlat=1),
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
    # Card E6: retail's hills and crater walls are one rough, pitted surface from crest to
    # foot with no cracks, so crackSeverity, worms and wrinkles are 0 (they were .35, .4 and
    # .8: the Moon variant 'cracked' restores that look) and the pits are drawn by pockmark.
    'moon': dict(crackSeverity=0, crackMajor=.5, crackMinor=.5, crackBlocks=.4, craterlets=6, craterEjecta=.7,
                 worms=0, undulation=4, plainRelief=.6, banding=0, crackDark=.6,
                 sunTilt=0, faceFill=0, ambient=.25,
                 # H19: at 1 the lit relief on a shaded wall reads as hard plates, at .5 as rock (repro/walls/moon.json).
                 faceRelief=.5,
                 # Card B3: the isolated marks (slopeMarks .4) read as specks and, lined up
                 # on a narrow wall, as a toothed lip; retail's slopes are crazed with
                 # connected wrinkles and pits, so the joined wrinkles replace them.
                 slopeMarks=0, wrinkles=0,
                 # G8: the band lines (banding .3 before) drew the straight hair-like scratches the owner
                 # sees on our slopes, before and after E6 (diagnostic: banding 0 alone removes them; shine
                 # grain, cracks, worms, ejecta and the slope art leave them in). The variants 'pitted' and
                 # 'cracked' restore them.
                 # G8: pits are lit cups (moonCups) from the retail comparison, not E6's dots (pockmark, now the
                 # Moon variant 'pitted'): small, on shaded steep faces, few on lit ground, none on tops.
                 moonCups=1, moonCupSize=6.5,
                 # G8: steep faces turned from the sun are near black and stringy (strokes 1-2 px wide, 5-12 px
                 # long, leaning with the glint axis): relief the sun shades, with a little less light overall.
                 moonRibs=1, moonRibDepth=.9, moonRibDark=.15,
                 # G8: lit slopes carry thin dark folds that follow the form (contours of the sculpted
                 # height, warped); .55 of the amount that read as a contour map.
                 moonFolds=.55,
                 # G8: retail's hills and walls fold: lumpy, lobed outlines (a shape option; the scenes' own
                 # strokes carry none, so this is the world's default for hills and mountains).
                 moonLobes=.5,
                 # E6: pits about 4 x 6 px every 7.5 px on every raised or sloped surface, and a
                 # faint sheen with a fine round grain there (the plain keeps its own grain).
                 pockmark=0, pockSize=7.5, shineGate=1, shineWhite=1, shineStretch=3,
                 shineGround=0, shineGroundSharp=12, shineGroundRough=.12, shineGroundScale=3,
                 shineSlope=.06, shineSlopeSharp=30, shineSlopeRough=.12, shineSlopeScale=3,
                 shineRock=.06, shineRockSharp=30, shineRockRough=.12, shineRockScale=3),
    # Zhon: no sand ring round hills on grass; sand is painted (Sand cover)
    # and hills set in sand get sandy feet.
    # Painted sand keeps a raised bar sand to its crown (the river sections'
    # sand bars rise ~100 units from the bed with no rock).
    'zhon': dict(crackSeverity=.4, crackMajor=.6, boulderRound=1, boulderMoss=0, rockCrown=1, apron=0, sandBanding=1,
                 beachWidth=.6, banding=.3, crackDark=.45, sandCrown=1),
    # Lava: one dark, low-chroma brown ground with no cracks, sand or
    # boulders on the level; striated dark cliffs; a molten sea with no
    # colour-by-depth ramp, so no depth averaging (authored from the
    # sections, measured by measure/). Its bank ridges are
    # irregular, not banded (section measurement), so no contour bands.
    # Bank lines measured on the section-built retail maps (measure/lava_*):
    # ground-spaced dark lines from slope 0.15 up; ground-coloured faces;
    # rim, outline and lip at the coast. Worms gave way to the lines.
    'lava': dict(undulation=4, plainRelief=.6, crackSeverity=.4, crackNetwork=0, crackHairline=0, crackBlocks=.3,
                 beachWidth=0, waterSoft=0, bankRock=0, banding=0,
                 fingers=1, worms=0, shoreEdge=1, slopeTexture=0,
                 # Dry banks ~60 px wide whatever the lake's size (measure/lava_coasts.py bank).
                 bankPx=60,
                 # Card E4: retail's bank is 6-9 flat layers stepping down to the lava, 12-16 px a
                 # layer and ~100 px inland (lava-1 zoom), cut as heights the sun lights (a lit top,
                 # a shaded riser) in place of dark band lines (Banding 0 above).
                 shoreLayers=11, layerPx=9, layerLedge=.8, layerRough=.7,
                 # Fingers are low tongues of the lowest layer on the joined coast (retail lava-1: 25-35 px thumbs, blunt tips).
                 # Less ambient light, so the shaded risers read as retail's near-black lines.
                 ambient=.3,
                 # Card E4: hills and mountains are rough rock, not smooth cones crossed by black
                 # hairlines. Cracks stay but lose their ink (.95 -> .35); the relief is finer and
                 # lumpier (scale 28 -> 20, amount .5 -> .9, lumps .7 -> .9) and Moon's joined wrinkles
                 # and pits (card B3) roughen the slopes. Shine is card E2's, not set here.
                 crackDark=.35, reliefAmount=.9, reliefScale=20, reliefLumps=.9, wrinkles=.6,
                 # E10: lava-1's layers are many and uneven (11 of ~9 px, widths and risers vary along the shore,
                 # each riser wanders on its own), with a dark crease at every step foot whichever way it faces;
                 # fingers are small, flat tongues (their size is a per-stroke option);
                 # hills and banks are shiny rough rock, the plain stays matte (shine gated by slope).
                 layerVary=.8, layerCrease=.7, fingerSize=.65,
                 # G5: retail's layers wander, loop and pinch (contour layers: 1.2 layers of two-dimensional wander, width spread .7),
                 # its circles differ in size and spacing, and its step lines fade and break along their length.
                 lavaSpread=.7, lavaCircleVary=1,
                 # G5: hill rock as retail's crust, pillows and chips with creases and hanging veins, the fall-line relief it
                 # replaces, treads tilted toward the crown, and the tall hills' far sides near black.
                 lavaCrust=1, lavaPillow=40, lavaChip=5.5, lavaVeins=.8, lavaCalm=1, lavaDusk=.8,
                 shineSlopeGate=.7, shineWhite=.3, shineStretch=3,
                 shineGround=.15, shineGroundSharp=24, shineGroundRough=.6, shineGroundScale=8,
                 shineRock=.2, shineRockSharp=60, shineRockRough=.7, shineRockScale=8),
    # shadeDepth stays 1 on Lava: directional shading varies by map and
    # window (luma on the east-west height gradient: 6-9 per unit slope on
    # the lake maps, 14-18 on the hilly ones). 0.4 matched a Kill the Middle
    # window (retail 7.6, ours 9.3) but pushed Red Hot Lava and Two Hills
    # windows further away (retail 14.6 and 16.9; ours 12.9 and 12.3 at 1).
    # Crystal: dead-level violet ground (the flat sections sit at one height
    # or within 82-87), crater walls and rough ridges crazed by a near-black
    # polygonal crack web, plates rather than rills by eye, and no sand or
    # beach (authored from the sections). Its column fields are a separate
    # brush, not these knobs. The web's plates on the rough ridges measure
    # 14.7 px across at the median (max caliper 20; measure/
    # crystal_geometry.py), so the block size sits at the knob's 16-px floor.
    # Its Crystals brush makes column mounds: Voronoi columns with ~15 px
    # tops stepped ~16 units (measure/crystal_geometry.py).
    'crystal': dict(undulation=4, plainRelief=.6, crackSeverity=.7, crackNetwork=1,
                    crackBlocks=.8, crackHairline=.3, crackDark=.9, crackSpacing=16, beachWidth=0,
                    crystalForm=1, crystalSize=32, crystalStep=16, crystalVariation=.35, crystalTiers=1,
                    crystalGrain=1, crystalFace=1.1, crystalInk=1, crystalTone=1.16, crystalSeam=1,
                    plateMaterial=1, plateWaterPx=90, plateLandPx=48, plateSize=28,
                    # Shine (card E2): retail Crystal is much shinier. Silver-lilac streaks run along
                    # the ground's grain on facets that face the sun's side; tops and the rock and
                    # slope plates round them take a sharp lobe over strong grain, and the level
                    # plain stays matte. Highlights are neutral (retail's brightest entries on the
                    # mounds are grey 155/171/187 and pinkish 187,147,195, not the blue lilac).
                    # E7 retune after the facets: a broader lobe (sharp 100 -> 70) with less gloss
                    # (.4/.3/.25 -> .3/.22/.18) and a lighter top (crystalTone 1.08 -> 1.16) puts more
                    # of the mound at luma 80-130, where retail's tops sit, without lifting the tail.
                    shineCrystal=.3, shineCrystalSharp=70, shineCrystalRough=1, shineCrystalScale=8,
                    shineRock=.22, shineRockSharp=70, shineRockRough=1, shineRockScale=8,
                    shineSlope=.18, shineSlopeSharp=70, shineSlopeRough=1, shineSlopeScale=8,
                    shineStretch=3, shineWhite=1,
                    # E7: crumpled multi-facet column tops.
                    crystalFacet=.7,
                    # E7: three column widths mixed over a mound, the small ones at the crest.
                    crystalSizeVar=.7,
                    # E7: some columns stay smooth hill between the crystals.
                    crystalSmooth=.35,
                    # E7: craters tiled with crystal facets.
                    craterFacets=1,
                    # E7: shallow water carries a mosaic of small crystal cells; the shore slabs
                    # shrink from 20 to 14 px (retail's band is a fine mesh, plates 12-80 px).
                    crystalShallow=1, crystalShallowPx=8,
                    # G7: craters read as holes under a thin wandering web (retail crystal-1: smooth lit and
                    # shaded walls, cells 12-20 px, hairline to 2 px lines, many left out): small facets with a
                    # 1-unit step, one skin mark, the web drawn by the shader, and the sun's light and shade
                    # pushed 1.6 times harder on the wall. H21: the west wall read too dark and busy;
                    # ordinary contrast and a fainter web keep the planes visible (crystal-1).
                    crystalCraterPx=16, crystalCraterStep=1, crystalCraterSkin=1,
                    crystalCraterWeb=.35, crystalCraterWebPx=18, crystalCraterWobble=4, crystalCraterGap=.25,
                    crystalCraterTone=.12, crystalCraterLight=1,
                    # G7/H20b: the shore slabs draw at 28 px, under thinner seams (.56, ending at .68).
                    # G7 asked for finer cells (crystal-3's band reads 8-14 px); retail's plates read larger
                    # elsewhere (30-50 px on crystal-2, 15-30 on crystal-3), and the owner ruled for 28 ("For
                    # crystal go ahead with 28, but maybe we also allow some variability"), so the plates draw
                    # at plateSize as given.
                    crystalShoreSeam=.56, crystalSeamEnd=.68,
                    # H20b: in patches a slab breaks into a fine mesh inside its outline (retail: crystal-3's band
                    # beside larger plates, small cells among the big ones on crystal-1's mound).
                    plateVary=.5,
                    # G7: the shallow mosaic's cells 8 px (were 10) under fainter seams (.45, were .55).
                    crystalShallowInk=.45),
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
    # sections).
    # Its Crystals brush makes ice blocks: four-sided, flat-topped (top ~0.45
    # of the base), sides ~0.7 units/px, no lean (measure/ice_features.py).
    'ice': dict(undulation=4, plainRelief=.6, crackSeverity=0, crackMajor=.4, crackMinor=.3, crackHairline=.2,
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
                shorePlates=1, plateMaterial=2, plateWaterPx=140, plateLandPx=220, plateSize=44, plateGap=5, plateHeight=4, frostWet=1,
                # Card E6: retail's common ice mountain (Etorrep Glacier, Polar Range) is one monotone,
                # very rough, shiny slate-blue ice lit strongly: every face is the rock art (contrast
                # .55) from the first slope to the crest, with a fine grain 2.5 px wide (stretch 2)
                # that glints, no cracks, little lumpy relief, the shade kept blue and a lower ambient so
                # the light and shade read strongly. Earlier look (snow and slate interleaved, cracks):
                # the Ice variant 'snow'; retail's other type (ice-1) is the variant 'crystal'.
                iceSlate=1, mineralDetail=.3, shadeBlue=.25, reliefAmount=.22, reliefScale=14, reliefLumps=.3,
                lightCap=1.25, ambient=.3, shineWhite=1, shineStretch=2,
                shineRock=.22, shineRockSharp=50, shineRockRough=.5, shineRockScale=2.5,
                # Card E6, frost band against retail ice-1 (x330-430, 32-132 px inland): luma s.d. 52
                # against 42 and blue gaps in .22 of the pixels against .05, so finer needles in more
                # patches and small melt pockets, half again as many.
                frostNeedles=.8, frostGaps=.1, frostGapReach=.7, frostGapSize=7,
                # Card G6: retail's blocks (ice-3, Polar Range) are soft, snow-capped slate: the light reads the
                # height blurred over ~13 px so crests are rounded and there are no hard creases, the flat top is
                # snow, the faces are smooth slate crossed by fine fibres down the slope (rock art contrast .3,
                # no glint dashes), and dark hatched drifts spill past the foot into the snow.
                iceSoft=.85, iceSnow=1, iceFall=1, iceApron=1,
                # Card G6: the frost band's fine lines (retail: crisp dark-blue hairlines 3-5 px apart in parallel runs).
                iceFrost=.7),
}


# Variants (card C5 stage 3): named presets laid over a world's own, for the
# places where one retail family splits into distinct looks. A variant is knob
# values on top of WORLD_KNOBS, plus optionally world colours ('colors') and
# other config keys ('config'). A world's own preset is its
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
                     knobs=dict(banding=.35, faceStreak=0, faceDark=.3, crackSeverity=.45, crackBlocks=.3, crackDark=.55,
                                reliefAmount=.5, microRock=.7)),
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
        # crystalFace, crystalTone and crystalGrain reach only Ice's default
        # Crystals stroke (form 0): without them its shaded side goes near black (H22).
        'bergs': dict(label='Icy Bergs: blue blocks',
                      colors=dict(crystal='#8ea6ee', ground='#9db5fa', slope='#a5bef9', rock='#9ab2f4'),
                      # No slope cover, face rock or exposed rock: their dark slate and granite
                      # read as teal specks on a bright berg, where retail's faces are one
                      # rough blue-white grain (ground pattern contrast 2 gave it; card G6 lowered it to 1.3 and the
                      # relief to .35 / .4: the owner found ice-2 too rough, and its 3x3 high-pass was 17.5 against retail's 11.7, now 13).
                      # A short wet band keeps the waterline from a dark fringe.
                      material=dict(slopeStart=3.0, slopeFull=4.0, wetBand=2.0, rockSlope=9.0),
                      knobs=dict(crystalFace=2.2, crystalTone=.92, crystalGrain=.4, crackSeverity=0, shadeBlue=.9, lightCap=1.4, ambient=.32, groundContrast=1.3, microRock=0,
                                 # Card G6: the world's soft slate block look is not the berg's.
                                 iceSoft=0, iceSnow=0, iceFall=0, iceApron=0,
                                 # Card E6: the world's monotone mountains (slate faces, glints, soft relief) are not the berg's look.
                                 iceSlate=0, mineralDetail=1, reliefAmount=.35, reliefScale=28, reliefLumps=.4, shineWhite=.35, shineStretch=1, shineHeadroom=0,
                                 shineRock=0, shineRockSharp=24, shineRockRough=0, shineRockScale=6)),
        # Crystal mountains (card E6, retail ice-1): slate ruled with straight dark strokes in
        # domains, snow-white lumps standing on the raised ground, soft relief, no glint.
        'crystal': dict(label='Crystal mountains: straight strokes',
                        knobs=dict(iceCrystal=1, iceCrest=.3, iceSoft=0, iceSnow=0, iceFall=0, iceApron=0, mineralDetail=.55, shineRock=0, shineRockRough=0, shineHeadroom=0, shineStretch=1, shineWhite=.35)),
        # Snow and slate (the mountains before card E6): white snow cover and dark slate interleaved,
        # carved cracks, no sheen.
        'snow': dict(label='Snow and slate: cracked mountains',
                     knobs=dict(iceSlate=0, mineralDetail=1, iceSoft=0, iceSnow=0, iceFall=0, iceApron=0, crackSeverity=.2, shadeBlue=0, reliefAmount=.5, reliefScale=28, reliefLumps=.7,
                                lightCap=1.13, ambient=.42, shineWhite=.35, shineStretch=1, shineHeadroom=0,
                                shineRock=0, shineRockSharp=24, shineRockRough=0, shineRockScale=6)),
        # Polar Range and Etorrep Glacier (dark steel-blue shaded faces on white
        # snow) are not here: the dark faces come from the block's own shading,
        # which the colour knobs only reach through the tops (a darker crystal
        # colour darkened the top, not the sides). See NOTES, stage 3.
    },
    'moon': {
        # Pitted (card E6): one pitted surface from crest to foot, dots 4 x 6 px at one density over all raised
        # ground, a trace of sheen, no cracks. The default's lit cups (G8) replace it.
        'pitted': dict(label='Pitted: E6 dots on all raised ground', knobs=dict(pockmark=1, moonCups=0, moonRibs=0, moonFolds=0, moonLobes=0, banding=.3)),
        # Cracked slopes (the look before card E6): smooth hill tops, wormy and crazed sides,
        # carved cracks, no pits and no sheen.
        'cracked': dict(label='Cracked slopes: smooth tops',
                        knobs=dict(crackSeverity=.35, worms=.4, wrinkles=.8, pockmark=0, moonCups=0, moonRibs=0, moonFolds=0, moonLobes=0, banding=.3, shineGate=0, shineWhite=.35, shineStretch=1,
                                   shineGround=0, shineGroundSharp=24, shineGroundRough=0, shineGroundScale=6,
                                   shineSlope=0, shineSlopeSharp=24, shineSlopeRough=0, shineSlopeScale=6,
                                   shineRock=0, shineRockSharp=24, shineRockRough=0, shineRockScale=6)),
    },
    'zhon': {
        # The river family (card B4): the reproduction windows' sections are
        # river sections, whose water is brown at the shore and dark olive in
        # the deeps, not the coast's grey-green and teal. Its two water
        # materials (riverWater, riverShallow) and its material and water
        # numbers are the `river` block of materials/zhon.json.
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
        'triad': dict(label='Desert Triad: gray buttes',
                      knobs=dict(bedSpacing=4, faceDark=.4, banding=.9, crackSeverity=.5, crackMajor=.7,
                                 crackMinor=.15, crackBlocks=.15,
                                 # Card E8: retail's shaded flanks go black (desert-2's buttes: 1.0% of the window
                                 # under luma 25, 2.3% under 40; ours bottomed at 42 with ambient .3, 0% and
                                 # 0.4%). Ambient .12 gives 0% and 1.0%.
                                 ambient=.12)),
    # Its beds are the `triad` row of the column block in materials/desert.json. Card E8: retail's grey buttes carry
    # rust-pink lines (slot 4, (175,111,90), the nearest slot to the measured (149,88,86)) 15 units apart (median over the
    # lit flanks above 60, 14 px) and ~4.4 units wide, not 4 apart.
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
        # Swap in the world's river water (its material and water numbers, which name the river's two water materials).
        for key, value in copy.deepcopy(config['river']).items():
            out[key] = {**out.get(key, {}), **value}
    out['baseColors'] = dict(config.get('colors', {}))
    out['colors'] = {**config.get('colors', {}), **v.get('colors', {})}
    if v.get('material'):
        out['material'] = {**out.get('material', {}), **v['material']}
    out.update(copy.deepcopy(v.get('config', {})))
    out['variant'] = variant
    return out


# Every world is described by one committed table, materials/<world>.json (measured and fitted by measure/): the materials its layers are
# made from, its `material` and `water` numbers, its page defaults and base height (`world`), and, for Zhon, its river variant. Nothing
# here reads an image or a retail source, so a server needs no assets folder to draw a world.
MATERIAL_TABLES = {'green': '/materials/green.json', 'moon': '/materials/moon.json', 'desert': '/materials/desert.json', 'zhon': '/materials/zhon.json', 'lava': '/materials/lava.json', 'ice': '/materials/ice.json', 'red': '/materials/red.json', 'crystal': '/materials/crystal.json', 'archipelago': '/materials/archipelago.json'}
SOURCES.update({table.lstrip('/'): HERE / table.lstrip('/') for table in MATERIAL_TABLES.values()})
SOURCES['materials/palette.json'] = HERE / 'materials' / 'palette.json'


def world_knobs(biome, config):
    """Set the page's knob defaults: KNOB_DEFAULTS, the world's water depths,
    then its WORLD_KNOBS entry."""
    knobs = {**KNOB_DEFAULTS, 'shallowDepth': config['material'].get('shallowDepth', 2),
             'deepDepth': config['material'].get('deepDepth', 42), **WORLD_KNOBS.get(biome, {})}
    config['defaults'].update({k: str(v) for k, v in knobs.items()})
    config['engineDefaults'] = {k: str(v) for k, v in ENGINE_KNOBS.get(biome, {}).items()}
    config['knobs'] = sorted(knobs)
    return config


def export_defaults(biome):
    """The map export's per-world defaults (retail planet, sea level, OTA climate medians), committed in the world's table."""
    return json.loads((HERE / MATERIAL_TABLES[biome].lstrip('/')).read_text())['world']['export']


def biome_config(biome):
    """One world's page configuration, built from its table."""
    table = json.loads((HERE / MATERIAL_TABLES[biome].lstrip('/')).read_text())
    world = copy.deepcopy(table['world'])
    world.pop('export', None)   # the page's world catalogue (EXPORT_DEFAULTS), not the page's config
    config = {'biome': BIOME_NAMES[biome], 'biomeId': biome, 'size': 1024, 'grid': 512, 'seaLevel': 0, 'baseHeight': world.pop('baseHeight', 24),
              'materialTable': MATERIAL_TABLES[biome], 'layers': table['order'],   # the materials the table makes: which optional stages (body, beach, ring) the world has
              'material': table['material'], 'water': table['water'], **world}
    if 'river' in table:
        config['river'] = table['river']   # the river variant's material and water numbers (WORLD_VARIANTS)
    return world_knobs(biome, config)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8767)
    parser.add_argument('--biomes', default='green,red,archipelago,moon,zhon,lava,desert,crystal,ice',
                        help='comma-separated biomes to serve; the first is the default')
    parser.add_argument('--assets-root', type=Path, default=Path('/private/tmp/nanolathe-map-editor'),
                        help='where exports, saved documents and the map and feature catalogues live; the worlds themselves need nothing here')
    parser.add_argument('--export-tool', type=Path, help='Card D map exporter binary (default <assets-root>/map-export)')
    parser.add_argument('--feature-tool', type=Path, help='Card D feature catalogue binary (default <assets-root>/bin/map-features)')
    parser.add_argument('--game-root', action='append', type=Path, help='content root for exports; repeat in mount order')
    parser.add_argument('--prepared', action='store_true', help='read the saved map-catalog.json and feature catalogues in the assets root instead of the retail sources (BUNDLE.md); worlds never read retail sources')
    args = parser.parse_args()
    from sculpt_export import MapExport
    from sculpt_document import MapDocument
    map_export = MapExport(args.assets_root, args.export_tool or args.assets_root / 'map-export', args.game_root or [Path.home() / 'TotalAnnihilation'], args.feature_tool or args.assets_root / 'bin' / 'map-features', args.prepared)
    map_document = MapDocument(args.assets_root / 'documents')
    biomes = [b for b in args.biomes.split(',') if b in BIOME_NAMES]
    configs = {b: biome_config(b) for b in biomes}
    # What the page reads of the map catalogue is committed with the worlds; only an export reads the installed content.
    catalogue = {'worlds': {b: export_defaults(b) for b in biomes}}
    feature_tool = args.feature_tool or args.assets_root / 'bin' / 'map-features'
    # A world has features to offer when its catalogue is saved (prepared) or the helper that makes it is built.
    features_installed = lambda world: (args.assets_root / 'features' / world / 'catalog.json').is_file() or (not args.prepared and feature_tool.is_file())
    # Any world may take another's ground pattern (World panel); the
    # pattern's mean is replaced by the world's ground colour.
    # A table world with no tile data (a quilted plain generated as a layer) has no pattern to lend; every other world does.
    patterns = {b: {'name': BIOME_NAMES[b], 'groundTable': configs[b]['materialTable']} for b in biomes
                if 'ground' in json.loads((HERE / configs[b]['materialTable'].lstrip('/')).read_text())}
    for config in configs.values():
        config['biomes'] = {b: BIOME_NAMES[b] for b in biomes}
        config['groundPatterns'] = patterns
        config['variants'] = {k: v['label'] for k, v in WORLD_VARIANTS.get(config['biomeId'], {}).items()}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            path = urlsplit(self.path).path
            if path == '/map-catalog.json':
                map_export.reply(self, catalogue)
                return
            parts = path.split('/')
            if len(parts) == 4 and parts[1] == 'map-features' and parts[3] == 'catalog.json' and not features_installed(parts[2]):
                # A server without the installed content has no feature set to offer: an empty catalogue, with the reason.
                map_export.reply(self, {'world': parts[2], 'features': [], 'unavailable': 'This server has no feature catalogue installed, so no features can be placed; start positions remain editable.'})
                return
            try:
                if map_document.get(self, self.path) or map_export.get(self, self.path):
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
                if file is None or not file.is_file():
                    self.send_error(404)
                    return
                body = file.read_bytes()
                if file.suffix == '.html': content_type = 'text/html; charset=utf-8'
                if file.suffix == '.js': content_type = 'text/javascript; charset=utf-8'
                if file.suffix == '.css': content_type = 'text/css; charset=utf-8'
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
                if not map_export.post(self, self.path):
                    self.send_error(404)
            except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as err:
                map_export.reply(self, {'error': str(err)}, 400)

        def do_PUT(self):
            try:
                if not map_document.put(self, self.path):
                    self.send_error(404)
            except (OSError, ValueError, KeyError, TypeError) as err:
                map_export.reply(self, {'error': str(err)}, 400)

        def do_DELETE(self):
            try:
                if not map_document.delete(self, self.path) and not map_export.delete(self, self.path):
                    self.send_error(404)
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
        map_export.close()
        server.server_close()


if __name__ == '__main__':
    main()
