#!/usr/bin/env python3
"""Local common-surface terrain experiment; no engine integration."""
import argparse
import copy
import hashlib
import json
import math
import os
import shutil
import subprocess
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


HERE = Path(__file__).resolve().parent
SOURCES = {name: HERE / name for name in (
    'sculpt.html', 'sculpt.js', 'sculpt-ui.js', 'sculpt-workspace.js', 'sculpt-workspace.css', 'sculpt-help.js', 'sculpt-help-examples.js', 'sculpt-control-schema.js', 'sculpt-ui.css', 'sculpt-selection.js', 'sculpt-paths.js', 'sculpt-river.js', 'sculpt-renderer.js', 'sculpt-webgpu.js', 'sculpt-vert.wgsl',
    'sculpt-rock-weather.js', 'engine-rock-weather.wgsl', 'sculpt-volume.js', 'sculpt-rock-presets.js', 'engine-volume.wgsl', 'engine-frag.wgsl', 'engine-bake.wgsl', 'engine-common.wgsl', 'engine-materials.wgsl', 'engine-palette.wgsl', 'engine-weather.wgsl',
    'engine-erosion.wgsl', 'sculpt-material-model.js', 'sculpt-column.js', 'sculpt-noise.js', 'sculpt-gates.js', 'sculpt-erosion.js', 'engine-shape.wgsl', 'engine-feed.wgsl', 'sculpt-gpu-fields.js', 'sculpt-shape-presets.js', 'sculpt-map.js', 'sculpt-export.js', 'sculpt-export-worker.js', 'sculpt-features.js', 'sculpt-feature-set.js', 'sculpt-feature-gen.js', 'sculpt-feature-fire.js', 'sculpt-feature-worker.js', 'sculpt-canvas.js', 'sculpt-passability.js', 'sculpt-passability-view.js', 'sculpt-share.js', 'sculpt-preview.js', 'sculpt-change-map.js', 'sculpt-chunk-renderer.js', 'sculpt-scene.js', 'sculpt-knobs.js',)}


BIOME_NAMES = {'green': 'Green Planet', 'red': 'Red Planet', 'archipelago': 'Archipelago',
               'moon': 'Moon', 'zhon': 'Zhon', 'lava': 'Lava', 'desert': 'Painted Desert',
               'crystal': 'Crystal', 'ice': 'Ice'}


def sun_height(tilt):
    """Sun height's default for a world with this sunTilt: the height above the horizon, in degrees, of the light every world had before it
    was a control, (-.72, .38 x sunTilt, .82) (sculpt-renderer.js sunVector)."""
    return math.atan2(.82, math.hypot(.72, .38 * tilt)) * 180 / math.pi


# Every map-wide knob's default (the World panel). A world preset is these
# plus its own overrides below, so each world has a value for every setting;
# a knob missing here is reported in the page's console.
KNOB_DEFAULTS = dict(
    # Level ground is flat in the game's height map by default (the owner, 2026-11-10: an RTS needs flat ground to build on; relief on level ground is
    # for the art). Undulation height is 0 in every world: raised, it goes into the heights. Each world keeps its own Undulation size and cover for an
    # artist who raises it, and the retail windows (repro/scenes) pin the height they were matched with: green 3, red 2.5, desert 14, moon 6, zhon 1.5,
    # lava 12, crystal 4, ice 4.
    groundTiles=16, groundPattern='', beachFrom='', groundContrast=1, undulation=0, undulationScale=200, undulationCover=.45, undulationArt=1, faceSteep=1,
    # Low ground: its tint (0: none) and its reach above the sea (the Colors panel's Low ground is its color).
    lowTint=0, lowReach=6, lowGrain=1,
    # S4: shade in creases (0: none).
    creaseShade=0,
    reliefScale=28, reliefAmount=.5, reliefLumps=.7, reliefBranch=2, reliefWarp=10, reliefPatchy=1,
    reliefJitter=.8, gentleRelief=.6, plainRelief=1.2, reliefOctaves=5,
    flatShadow=0, flatOcclusion=.4, lightCap=1.13, shadeDepth=1, sunTilt=1, sunHeight=sun_height(1), ambient=.42, slopeMarks=0, wrinkles=0, sandCrown=0,
    faceVariation=.8, lean=0, facing=0, faceFill=.18, slopeTexture=.3, moss=0,
    looseSupply=0, looseSize=6,
    sand=0, wind=20, sandDust=.5, sandGrass=.6,
    sandLight=.25, sandGrain=.8, ripple=7, rippleHeight=1.4,
    crackSeverity=.6, crackSpacing=40, crackMajor=.8, crackMinor=.75, crackHairline=.6,
    crackBlocks=.6, crackWidth=1, crackNetwork=.35, crackDark=.75,
    # The rock column's tilt (its beds, their strata colours and hardness): height per px toward bedDipDir degrees.
    bedDip=0, bedDipDir=90,
    worms=0, rockCrown=0, apron=0,
    # A landform's Facets (sculpt-scene.js SHAPE_FIELDS): Step height in units (5 is the angular facets' earlier fixed step), the prisms' sides, flat top share and
    # variation, Level tops, Align to the path, outline jitter, corner cuts and face roughness in units.
    crystalStep=5, crystalSides=6, crystalTop=.2, crystalVariation=.5, crystalTiers=0,
    crystalAlign=0, bergJitter=.5, bergBreak=3, bergRough=6,
    shorePlates=0, plateWaterPx=64, plateLandPx=96, plateSize=28, plateGap=2, plateHeight=3, plateMaterial=1,
    crystalGrain=0, crystalFace=1, crystalInk=0, crystalTone=1, crystalSeam=0,
    # Ice (card E5): shade keeps its blue (0 grey, as every world was).
    shadeBlue=0,
    # Ice frost band (card E5): its cells skip the wet-band darkening (0: every world as before).
    frostWet=0, frostNeedles=.5,
    banding=0, bandSoftness=.35, bandWater=0, sandBanding=0, sandBandSpacing=2,
    strata=0, strataContrast=.6, strataGrain=1,
    fingers=0,
    # Coast pass (card E4): fingers on the joined coast and a landform's shoreline steps cut as heights
    # (layerPx px a step, riser 0 shares the bank's rise out; the count, flat share and irregularity are the landform's Steps).
    layerPx=12, layerRiser=0, shoreEdge=0, coastRamp=1, beachWidth=.6, shallowDepth=24, deepDepth=60, waterSoft=32, crispShore=1, bankRock=.25,
    dither=2, landDither=.25, paletteMix=0,
    # Form (repro round): ledges on steep faces, jagged bands.
    faceStreak=0, faceStreakFrom=.3, bandJag=0, bandFade=.75,
    # Dry banks below the plain lit as level ground, with no bands or wet band (Archipelago's beaches).
    flatBank=0,
    # Cross-section (card C1): the terraces on a landform's section (sculpt-shape-presets.js).
    terraces=0, ledge=.6, terraceJitter=.35, breakup=0,
    # Landform (card H27): the crest's height (fixed or sea-relative) and how it combines (0 raise to, 1 cut to, 2 flatten to); the variation along and
    # across the path (wander px, width as a share, height in units, the wavelength px, and the weights at the foot and from the middle up of the section).
    heightReference=0, stepReference=0, elevation=100, combine=0, routeSmooth=0, wander=24, widthVary=.2, heightVary=3, gullies=0, gullySize=.4, talus=0, surf=0, varySize=140, varyFoot=1, varyMiddle=1, wallVary=0, beds=0, bedSoft=.6,
    # lfcrater: a landform's impact features (sculpt-scene.js CRATER_KEYS), off by default: ejecta round it and secondaries beyond them;
    # lfimpact2: and the ground buckled beyond the rim of a landform that digs; the secondaries fall from secondaryDistance rim radii (or, on a shape that
    # peaks on its path, foot radii) out to twice that, 1.6 as before the row; the Crater preset sets 1 (sculpt-scene.js LANDFORM_TOOLS.crater).
    ejecta=0, buckling=0, secondaries=0, secondaryDistance=1.6,
    # Painted masks (card C5): the Paint brush's first choice.
    paintChannel=1,
    # Water looks (card E1). The two stroke options are 0 (the world's own),
    # 1 or 2; the world knobs default to a ramp from shallow to deep colour, and
    # level ground with no painted lumps beyond plainRelief's. The bed under
    # shallow water is always the lit ground.
    waterDeep=0, waterShore=0, bedTint=.85, bedBright=1, bedContrast=1, hillLight=1, ringFade=0, bedRelief=1, deepEdge=0, lumpRelief=4,
    # Line features (card C4): everything off by default; spur details only matter once spurs are set.
    spurCount=0, spurLength=120, spurSpread=.4, spurWidth=.8, spurTaper=.6, spurHeight=.7, spurForks=0, spurBulb=0, crestVary=0, crestTaper=0,
    # Local vegetation (card C5 stage 2): change about the world's own cover, 0 none.
    styleVegetation=0,
    # Rock presets (B2): the rock a landform is made of; -1, Rock beneath, keeps the rock already there.
    rockPreset=-1,
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
KNOB_DEFAULTS.update(crystalFacet=0, crystalSizeVar=0, crystalShallow=0, crystalShallowPx=10)
# G7 (Crystal): the thin web the draw lays over a crystal skin (a landform's angular Facets with Surface Crystal; 0: none).
KNOB_DEFAULTS.update(crystalCraterWeb=0, crystalCraterWebPx=14, crystalCraterWobble=0,
                     crystalCraterGap=0, crystalCraterTone=0, crystalCraterLight=1)
# Round 3 (Desert): the share of loose stones drawn as knolls, low rings of ground round a hollow (0: all stones).
KNOB_DEFAULTS.update(looseKnoll=0)
# Boulders: blocks fallen from a wall and lying under it (0: none).
KNOB_DEFAULTS.update(boulders=0)
# Soil where the plant cover thins against rock (0: grass meets rock, and off the faces the two blend).
KNOB_DEFAULTS.update(soilRim=0)
# Wet ground (0..1): ground that water wets is darker, more saturated and glossy (0: as before).
KNOB_DEFAULTS.update(wetGround=0)
# Round 3 (Crystal): a bold web of long dark gouges across raised crystal formations (0: none).
KNOB_DEFAULTS.update(gougeWeb=0)
# G7 (Crystal): finer shore slabs and fainter seams (the defaults are the earlier output).
KNOB_DEFAULTS.update(crystalShoreSeam=.5, crystalSeamEnd=.74, crystalShallowInk=.55)
# H20b (Crystal): the share of shore slabs that break into a fine mesh inside their own outline (0: the earlier output).
KNOB_DEFAULTS.update(plateVary=0)
# E8: the grey band at the foot of the raised ground (strength; its height window above the plain, how far the window
# drifts, and the share of its length that is missing).
KNOB_DEFAULTS.update(baseBand=0, baseBandLow=4, baseBandHigh=6.5, baseBandWander=1, baseBandGaps=.45)
# G4 (Painted Desert): level ground in the pale cap zone kept as one sheet of the cool bed (strength).
KNOB_DEFAULTS.update(desertCapFlat=0)
# E9 (Green rock faces): the share of the rock's glints kept outside painted rock.
KNOB_DEFAULTS.update(shineOutside=1)
# E11 (shallow water round 2): every default is the earlier look. shelfWander (depth units) moves
# the hard step's depth with broad noise so the band's width and outline vary along the shore;
# bedFlat lights the lit bed by its own relief only (no slope shading across the shelf).
KNOB_DEFAULTS.update(shelfWander=0, bedFlat=0)
# E11 Archipelago: ringContrast / ringCount / ringSize draw contour lines in the red fringe that
# follow the hill's outline (contrast 0 = none, lines from the inner to the outer edge, reach
# against the ring texture's own).
KNOB_DEFAULTS.update(ringContrast=0, ringCount=7, ringSize=1, stepSoftPx=1)
# E10 (Lava): finger size; layer width variation (0 even layers) and the circle size in px of circular
# layers. Every default is the earlier output.
KNOB_DEFAULTS.update(fingerSize=1, layerVary=0, layerCircle=26, layerJag=0)
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
# Round 3: cups drawn out into strokes along the glint axis, this many times their length (1: the pits).
KNOB_DEFAULTS.update(cupStretch=1)
# G8, Moon: stringy light and dark strokes down steep faces (0: none), their steepness and the darkening of faces turned from the sun.
KNOB_DEFAULTS.update(moonRibs=0, moonRibDepth=1, moonRibDark=0)
# G8, Moon: thin dark folds that follow the form across lit and moderate slopes (0: none), and the height between their contours.
KNOB_DEFAULTS.update(moonFolds=0, moonFoldSpacing=.9)
# G8, Moon: how far a hill's whole outline strays in lobes, as a share of its radius (a shape option; 0: the smooth outline).
# E6, Ice crystal mountains: straight strokes over the rock faces and snow-white lumps on the raised ground (0: none).
KNOB_DEFAULTS.update(iceCrystal=0, iceCrest=0)
# G6, Ice blocks and mesas (retail ice-3, Polar Range): rounded light, snow on the flat tops, fibres down the faces, a hatched apron (0: none of them).
KNOB_DEFAULTS.update(iceSoft=0, iceSnow=0, iceFall=0, iceApron=0)
# G6, Ice frost band: fine hairlines in the band (0: none).
KNOB_DEFAULTS.update(iceFrost=0)
# G6, Ice: angular facets on hills and mountains (share of the mountain broken into facets; facet width in px). Off by default everywhere.
KNOB_DEFAULTS.update(iceFacets=0, iceFacetSize=36)
# A landform's Facet shape (0 angular facets, 1 stepped columns, 2 prisms) and Surface (0 rock: the shape's own ground; 1 crystal).
KNOB_DEFAULTS.update(facetForm=0, facetSurface=0)
# G1: shoalRag is how far (px) pixel notches move the shallow-to-deep step, independent of the
# bed's slope (0: the step's earlier jitter, which a gentle shelf scales to nothing).
KNOB_DEFAULTS.update(shoalRag=0)
# G1: shoalStairs is how far (px) runs of 1-3 px move a hard waterline, whatever the bank's slope
# (0: the earlier jitter, whose notch grows with how gently the bank shelves).
KNOB_DEFAULTS.update(shoalStairs=0)
# G1: shoalShoreSoft is the width (px) of the dithered blend at the waterline the world draws (a
# stroke's own Hard or Faded choice is not touched; 0: a clean hard line).
KNOB_DEFAULTS.update(shoalShoreSoft=0)
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
# H1 (lit relief): shade the ground behind a 1-6 px ledge, and darken crevices and crack floors (0: off).
KNOB_DEFAULTS.update(closeShadow=0, cavity=0)
# H2, H16 (rock column): a world with a `column` block in its table reads each bed's thickness and hardness from it (sections of
# beds that repeat upward, materials/<world>.json); columnContrast scales how much harder the hard beds are (with erosion 1, their wear).
# The GPU Time pass uses erosionAge iterations, erosionRain times the base rain, talusAngle the repose of loose debris (degrees).
# The voxel rock solid (engine-volume.wgsl): one model for every world. Depth continuously scales its displacement.
KNOB_DEFAULTS.update(rockFace=2, rockFaceFrom=.6, faceRock=.9, faceBed=5.5, faceLedge=2.2, faceRun=90, faceLean=28, faceScratch=2.5, faceScratchSize=7,
                     faceBlock=3, faceBlockSize=11, faceCrease=2.5, faceCreaseSize=6, faceGrit=0, faceGrass=.8, faceWear=.35, faceShade=.85, faceLayers=0, faceMass=1, faceTone=.12, faceStrata=0, faceWet=0)
# H5 (Green's engine): the Time pass's marks. 3a is retail's (terraceBreak, terraceCalm, wetSwath);
# 3b is beyond retail and stays 0 for Green (rillDepth, rillSpacing; `sand` and ripple already exist).
KNOB_DEFAULTS.update(terraceBreak=0, terraceCalm=0, wetSwath=0, lushness=0, rillDepth=0, rillSpacing=8)
# Voxel block proportions, laminations and directional scratches; neutral values preserve the existing solid.
KNOB_DEFAULTS.update(runoff=0, runoffScale=24, runoffConcentration=.65, runoffCut=2, runoffStain=.5, debrisAmount=0, debrisReach=56, debrisDepth=4, rimReach=0, shoreRock=0, shoreShelf=0, stoneSort=.6, stoneRound=0, stoneSlab=.05)
KNOB_DEFAULTS.update(faceJointWidth=1, faceSecondary=.35, faceContinuity=1, faceDetailPatch=0)
# Whole blocks: each block wholly rock or wholly air, so the faces between blocks are the rock's skin (0: today's draped face).
KNOB_DEFAULTS.update(faceWhole=0, faceWholeLarge=0, faceRegular=0)
# Wind drifts: sand laid in the lee of rises along the wind (engine-bake.wgsl sandCover), a share of the Sand supply; 0 none.
KNOB_DEFAULTS.update(sandLee=0)
# Ground patches: level ground in three tones (damp, plain, dusty) in patches of this size (engine-frag.wgsl); 0 one tone.
KNOB_DEFAULTS.update(groundPatch=0, groundPatchSize=200)
KNOB_DEFAULTS.update(faceFresh=0, faceRind=0, faceRindDepth=6, faceRindTone=-.22, faceRindWarmth=.35, faceRindRough=.65)
KNOB_DEFAULTS.update(bedCycleVary=0, faceBedVary=1, faceBreak=0, faceJointTilt=0, faceScaleVary=0, faceFold=0, faceSpall=0, faceClast=0, faceClastSize=12, faceMineral=0)
KNOB_DEFAULTS.update(faceStretch=1, faceBlockHeight=1, faceRound=0, faceJoint=0.35, faceExtrude=0, faceLamina=0, faceLaminaSize=6, faceScratchLength=50, faceScratchAngle=0, faceGritSize=1.3)
# B4: light through a rock, opaque (0) on every world.
KNOB_DEFAULTS.update(lightThrough=0, absorbDepth=0, shadowTint=0)
# Card P30: Vegetation cover 0 is off (every world has a ground-cover table: GROUND_COVER, DEFAULT_GROUND_COVER); modern Green sets 1.
KNOB_DEFAULTS.update(vegetationCover=0, plantRelief=1, flowerDensity=1)
KNOB_DEFAULTS.update(columnContrast=1, erosion=0, erosionAge=200, erosionRain=1, talusAngle=40)
# H8: a world's engine preset. Every world runs the Time pass (erosion 1). The eight worlds that
# had no rain erosion take the pass with rain off and the envelope of the droplet worker's own budget (the worker's .35 of the pass's
# BUDGET 3, sculpt-erosion.js): its maps are made, its height moves no further than the worker's did.
# H4: the knobs Green's engine (engine 1) sets over WORLD_KNOBS. engine 0 keeps WORLD_KNOBS alone, so it draws as merge-h3 does.
# H17: terraceBreak 1.4 -> 0. Its phase wander broke green-2's slope into a dense blotchy mass; at 0 the band lines follow
# the contours as retail's flowing lines do (viewed at 1x; green-1 and green-3 do not change). banding .8 -> .5 (WORLD_KNOBS)
# lightens and thins those lines toward retail's soft dashes.
LIGHT_PASS = dict(erosion=1, erosionRain=0, erosionEnvelope=.12)
ENGINE_KNOBS = {
    'green': dict(terraceBreak=0, terraceCalm=0),
    **{world: LIGHT_PASS for world in ('red', 'archipelago', 'moon', 'zhon', 'lava', 'desert', 'crystal', 'ice')},
}
# Per-world overrides of KNOB_DEFAULTS (authored presets; shallowDepth and
# deepDepth come from each world's measured water ramp).
WORLD_KNOBS = {
    # Crack darkness calibrated on retail (measure/crack_lines.py, strong
    # and long line densities on slopes): Green's lines were ~2.5x retail's.
    # crackDark also darkens band lines, so the band row's line strength (materials/green.json) keeps their darkness.
    # Green dive: the rock face now takes the cracks on its slopes, and what is left reads as pale lips with no floor at .4 (.3 on Evad
    # River); retail's are dark slashes with a grey lip, so Green and Evad River are back at the default .75.
    # Card P16: the Scree slider's talus chips (3-5 px, a few % of the cliff feet's ground) as Supply and Size.
    # Retail round 2: shores drop to the sea more abruptly (retail's shore band 32-45 px; base 51-72). Modern keeps 1.
    'green': dict(coastRamp=.75, looseSupply=.08, looseSize=3.5, banding=0, crackDark=.75, wetSwath=.35,   # Moisture (a panel row, card P30); the Time pass's wet swaths and modern Green's ground cover read it
                  # Repro round (3 windows, 12-map census, measure by slope
                  # and facing): faces keep fall-line ribs much more than
                  # any retail map.
                  faceStreak=1,
                  # Great Divide's terraces are short dashes stacked like
                  # scales, not long smooth lines (thin dark lines per
                  # pixel 0.124 against retail's 0.235; bandJag 1 gives 0.158).
                  bandJag=1,
                  # Voxel Green: fine blocks and shallow, broken horizontal beds.
                  # Macro relief remains an authored input; small cliff detail lives in 3D.
                  rockFace=2, rockFaceFrom=.2, faceBed=2.5, faceBlockSize=7,
                  faceMass=2.6, faceGrass=.4, faceLayers=1, reliefAmount=.25,
                  faceScratch=1, faceCrease=1, faceLedge=1.2, faceWear=.15, faceJoint=.15, faceShade=.65, faceGrit=.5,
                  # Water (card E1). Retail Green's shallows are the lit bed under a
                  # blue tint (mean (73,110,240), luma s.d. 11 against deep 1.5) and end
                  # in a hard step: colour by depth is flat to ~30 and gone by ~44 in
                  # both windows (retail depth 32-40: R 53, 40-48: R 39, the 16-px height
                  # grid upsampled), so the step sits at 40 (H24: the midpoint, 42) and nothing fades.
                  # Bed lumps (realism, 2026-11-11): at bedRelief .6 under bedContrast .45 and bedFlat .4 the lumps moved under 1% of the shallows
                  # (rule 9). The bed carries more of its light through the tint (.7), is lit by its own relief alone (bedFlat 1, below: the
                  # world keeps .3 of the directional shade, and the bed's own light is not scaled by it), and its lumps are 2.
                  bedTint=1, bedContrast=.7, bedRelief=2, deepEdge=1,
                  # Ground (card E1): retail's plain is flat (dry heights 9 +- 1) with lit
                  # lumps only in patches, which the Paint brush's Ground lumps makes. On
                  # level pixels (24 px from other heights) the s.d. of 15-px-blurred luma
                  # was 3.84 / 3.16 in green-1 / green-3 against retail's 1.74 / 1.61;
                  # no undulation gives 2.85 / 2.69 (the rest is the tiles and hill feet).
                  # The undulation knobs and Level-ground lumps still work.
                  # Retail round 1: a fine, partial undulation (3 at 48 px over 40% of the land) gives the plain retail's gentle .08-.15 slopes
                  # (green-1 shape .38 -> .33) without broad light blotches (viewed at 1x).
                  undulationScale=48, undulationCover=.4, plainRelief=0,
                  # Dry dielectric rock: broad reflections, with the actual solid casting shadows.
                  shineRock=.35, shineRockSharp=2, shineRockRough=.18, shineRockScale=5, shineWhite=1, shineOutside=1,
                  # E11 (round 7 report: "too smooth", "matches the shoreline too closely",
                  # "blurry parts"): the step is a true threshold that wanders ~24 depth units over
                  # 140 px; the bed is lit by its own relief (green-3's blur was the shelf's slope
                  # shading the pale bed over 100+ px) and carries crisp mid-scale lumps (luma s.d.
                  # after a 5-px blur 2.8-3.9 -> 5.6, retail 5.6 / 7.5 in green-1 / green-3).
                  # (Green's pictures move with the chunk renderer's relief reach, which counts bedRelief.)
                  shelfWander=24, bedFlat=1,
                  # G1: the shallow-to-deep outline is notched by up to 5 px (retail's runs 3-8 px).
                  shoalRag=5,
                  # G1: the hard waterline steps in 1-3 px runs (retail's), up to 2 px off the depth contour.
                  shoalStairs=2,
                  # H1 (lit relief): ledges shade the ground 1-6 px behind them and crevices lose ambient light.
                  closeShadow=.8, cavity=.6,
                  # H2 (rock column): its `column` table (materials/green.json) has eight beds repeating every 47 height units: thin hard
                  # beds between thicker soft ones, which the Time pass wears at their own rates.
                  # H2 (erosion): the GPU shallow-water Time pass.
                  erosion=1, ),
    # Card E3 (red-3): slope cracks lighter and finer than the ink web: .5 px wide on 28-px blocks at depth .3.
    # Red's plain is level, as Green's is (card E1): the share of a retail window's 16-px cells at its most common height is .36 / .52 /
    # .20 in red-1..3 (Green's .35 / .20 / .44); the default undulation (10) gave .21 / .21 / .18, none gives .67 / .52 / .26. The plain's
    # lumps (plainRelief) keep its soft mottle. A level plain also repeats its tiles (card tilepool).
    # Retail round 1: retail's plain rolls gently (slope .03-.08 share .34 / .07 / .16 in red-1..3, ours .05 / .25 / .04 with none), so a faint
    # undulation (2.5 over 80-px lumps on 60% of the land) replaces the level plain, and the ground pattern is softened to .7 contrast
    # (retail's plain is lighter, less dotted).
    # Rock at shores (the owner, 2026-11-10: Red's cracked rock platforms running into the shallows "should just be the red planet look on
    # coasts without the need for manual fissures", and "Classic red should adopt it, but make sure it has the inner lake look vs the outer
    # cracks look"): the ground within 96 px of a waterline is Red's rock (WORLD_ROCK), on land and on the bed. Red's Shallow tool starts at
    # Soft bank (sculpt-scene.js), so a lake keeps its soft banks and the Deep tool's open water gets the platform.
    'red': dict(shoreRock=96, shoreShelf=96, undulationScale=80, undulationCover=.6, groundContrast=.7, crackSeverity=.3, crackDark=.35, crackWidth=.5, banding=.3,
                reliefAmount=.2, slopeTexture=0,
                # Retail round 2: raised landform faces steeper (retail's rims and mesa walls are crisper than 1).
                faceSteep=1.75,
                crackSpacing=28,
                # Red's shallows (card E1) are lit terrain, tinted purple and ending in a
                # hard stop: red-2's lake is the plain ground tinted lilac; open shores show
                # the shore rock's joints under the water (Rock shelf).
                bedTint=1, bedContrast=.65, bedBright=1.1, bedRelief=2.2, deepEdge=1,
                # E11 (round 7 report: "edge against the deep water seems shaded"): the step is a true
                # threshold; the lake (red-2) is lilac to its full depth 24 and keeps the world's 22.
                shelfWander=6, bedFlat=.6,
                # G1 (round 8: "the transition from shallow to deep needs a pixel-ragged edge, right now it is
                # too smooth"): the step's jitter was the bed's gradient times a constant, nothing on the
                # shelf's gentle slope; the notches are now px displacements, up to 9 px as retail's teeth.
                shoalRag=9),
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
                        shadeDepth=.3,
                        # Retail round 2: shores drop to the sea in 0-16 px (base 58-66), as retail's do.
                        coastRamp=.25,
                        # Hills and the mineral ring (card E1): mound pixels averaged (90, 80, 65)
                        # against retail's (102, 92, 76) in windows 2 and 3, with 15% of them under
                        # luma 45 (retail 5-6%). Hill cover x1.25 and a third of the directional
                        # shading give (103, 92, 76) and 7% dark. The ring is the curved 'Nested
                        # rings' texture, narrower (spread .35), lighter (.7, variation .5) and
                        # fading over a longer reach.
                        hillLight=1, ringFade=1,
                        bedTint=1, bedContrast=.8, bedBright=1, bedRelief=2,
                        # E11 (round 7 report: "weird black/dark lines around the hills" and "more
                        # noticeable circle features in the red fringe"): the dark lines were the
                        # first band risers on the hill's foot (banding 0 removes them, crack knobs do
                        # not), so band lines start 8 units above the base; retail's fringe is 8-12
                        # thin wavy crimson lines 2-4 px apart hugging the hill's outline, which the
                        # contour pass draws from the mineral field's falloff (so they follow the
                        # outline, not the screen). Reef bars carry retail's dappled texture
                        # (luma s.d. after a 3-px blur 8.4 against ours 3.0 before).
                        stepSoftPx=14, shelfWander=6,
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
    'desert': dict(lightCap=1.25, sunTilt=.5, sunHeight=sun_height(.5), paletteMix=1, strata=1, strataContrast=1, columnContrast=0, banding=.4,
                   strataGrain=.25, crackSeverity=0, crackMajor=.2, crackMinor=.1, crackHairline=0, crackBlocks=.1,
                   sand=0, undulationScale=48, undulationCover=1, undulationArt=0, plainRelief=0, flatOcclusion=0, reliefAmount=.15, gentleRelief=.2,
                   # Card E3: black shadow sides: retail's buttes are dark on the side turned
                   # from the sun, where ours shaded to a soft grey. No fill light and little
                   # ambient (faceFill 0, ambient .3) darken those faces.
                   faceFill=0, ambient=.3,
                   # E8: retail's aprons and mesa feet are ragged (cells 16 px wide, edges 10-20 px off a smooth
                   # lobe) and bumpy (heights vary 7-12 across an apron whose mean rise is ~8). The ridge presets carry
                   # this as variation (sculpt.js TOOL_PRESETS).
                   baseBand=1,
                   # G4: level ground in the pale cap zone is one sheet, as in retail (cap orange 10-12% against ours' 22%).
                   desertCapFlat=0),
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
    'moon': dict(looseSupply=.1, looseSize=3.5, crackSeverity=0, crackMajor=.5, crackMinor=.5, crackBlocks=.4,
                 worms=0, plainRelief=.6, banding=0, crackDark=.6,
                 sunTilt=0, sunHeight=sun_height(0), faceFill=0, ambient=.25,
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
                 moonRibs=1, moonRibDepth=.9, moonRibDark=.4,
                 # G8: lit slopes carry thin dark folds that follow the form (contours of the sculpted
                 # height, warped); .55 of the amount that read as a contour map.
                 moonFolds=.55,
                 # G8: retail's hills and walls fold: lumpy, lobed outlines. The ridge presets carry them as
                 # variation (sculpt.js TOOL_PRESETS).
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
    # Undulation 10 -> 1.5: retail's savannah is level (50-57% of dry cells under slope .03; ours 11-22%).
    'zhon': dict(crackSeverity=.4, crackMajor=.6, rockCrown=1, apron=0, sandBanding=1,
                 beachWidth=.6, banding=.3, crackDark=.45, sandCrown=1,
                 lowGrain=.4, lowReach=4,
                 # The bed is lit by its own relief (bedFlat .8): the islands' submerged feet took the land's whole shade and ringed every
                 # island in dark water.
                 bedFlat=.8),
    # Lava: one dark, low-chroma brown ground with no cracks, sand or
    # boulders on the level; striated dark cliffs; a molten sea with no
    # colour-by-depth ramp, so no depth averaging (authored from the
    # sections, measured by measure/). Its bank ridges are
    # irregular, not banded (section measurement), so no contour bands.
    # Bank lines measured on the section-built retail maps (measure/lava_*):
    # ground-spaced dark lines from slope 0.15 up; ground-coloured faces;
    # rim, outline and lip at the coast. Worms gave way to the lines.
    # Retail round 2: the plain's game heights undulate 12 high over 96 px (shape), but its art does not (retail's plain is an even mottle).
    'lava': dict(undulationCover=1, undulationScale=96, undulationArt=0, plainRelief=.6, crackSeverity=.4, crackNetwork=0, crackHairline=0, crackBlocks=.3,
                 beachWidth=0, waterSoft=0, bankRock=0, banding=0,
                 worms=0, shoreEdge=1, slopeTexture=0,
                 # Card E4: retail's bank is 6-9 flat layers stepping down to the lava, 12-16 px a
                 # layer and ~100 px inland (lava-1 zoom), cut as heights the sun lights (a lit top,
                 # a shaded riser) in place of dark band lines (Banding 0 above). The Water presets
                 # carry the count, flat share and irregularity as shoreline Steps (sculpt.js TOOL_PRESETS).
                 layerPx=9,
                 # The Water presets turn Fingers on: low tongues of the lowest layer on the joined coast (retail lava-1: 25-35 px thumbs, blunt tips).
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
                 layerVary=.8, layerCrease=1, fingerSize=.65,
                 # G5: retail's layers wander, loop and pinch (contour layers: 1.2 layers of two-dimensional wander, width spread .7),
                 # its circles differ in size and spacing, and its step lines fade and break along their length.
                 lavaSpread=.7, lavaCircleVary=1,
                 # G5: hill rock as retail's crust, pillows and chips with creases and hanging veins, the fall-line relief it
                 # replaces, treads tilted toward the crown, and the tall hills' far sides near black.
                 lavaCrust=1, lavaPillow=40, lavaChip=5.5, lavaVeins=.4, lavaCalm=1, lavaDusk=.3, faceFill=.35, flatOcclusion=0,
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
    'crystal': dict(gougeWeb=.6, paletteMix=1, plainRelief=.6, crackSeverity=.7, crackNetwork=1,
                    crackBlocks=.8, crackHairline=.3, crackDark=.9, crackSpacing=16, beachWidth=0,
                    crystalStep=16, crystalVariation=.35, crystalTiers=1,
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
                    # E7: shallow water carries a mosaic of small crystal cells; the shore slabs
                    # shrink from 20 to 14 px (retail's band is a fine mesh, plates 12-80 px).
                    crystalShallow=1, crystalShallowPx=8,
                    # G7: craters read as holes under a thin wandering web (retail crystal-1: smooth lit and
                    # shaded walls, cells 12-20 px, hairline to 2 px lines, many left out): small facets with a
                    # 1-unit step, one skin mark, the web drawn by the shader, and the sun's light and shade
                    # pushed 1.6 times harder on the wall. H21: the west wall read too dark and busy;
                    # ordinary contrast and a fainter web keep the planes visible (crystal-1).
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
                    crystalShallowInk=.45,
                    # The bed is lit by its own relief (bedFlat .8): the submerged slabs' drop to the deep took the land's whole shade and
                    # outlined the shelf in black.
                    bedFlat=.8),
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
    'ice': dict(plainRelief=.6, crackSeverity=0, crackMajor=.4, crackMinor=.3, crackHairline=.2,
                crackBlocks=.2, beachWidth=0, bankRock=0, crystalSides=4, crystalTop=.45, crystalVariation=.2,
                # Shore (card E5): frost crystals are the Ice shore. Retail's band is
                # mostly plain white ice with sparse fine straight lines (windows ice-1
                # and Ice Scream), broken by blue gaps that grow more frequent toward
                # deep water: reach 140 px into the water and 220 px inland, needles
                # every 7 px in about half the patches, thinning offshore. Plate
                # height 4 keeps the frost over the water level with the bank behind it
                # (14 made a dark wall there); frostWet 1 keeps the band white instead of
                # the grey the 13-unit wet band gives it. Plate material 0 keeps B1's floes.
                plateMaterial=2, plateWaterPx=140, plateLandPx=220, plateSize=44, plateGap=5, plateHeight=4, frostWet=1,
                # Card E6: retail's common ice mountain (Etorrep Glacier, Polar Range) is one monotone,
                # very rough, shiny slate-blue ice lit strongly: a fine grain 2.5 px wide (stretch 2)
                # that glints, no cracks, little lumpy relief, the shade kept blue and a lower ambient so
                # the light and shade read strongly. Earlier look (cracks): the Ice variant 'snow';
                # retail's other type (ice-1) is the variant 'crystal'.
                shadeBlue=.25, reliefAmount=.22, reliefScale=14, reliefLumps=.3,
                lightCap=1.25, ambient=.3, shineWhite=1, shineStretch=2,
                shineRock=.22, shineRockSharp=50, shineRockRough=.5, shineRockScale=2.5,
                # Card E6, frost band against retail ice-1 (x330-430, 32-132 px inland): luma s.d. 52
                # against 42 and blue gaps in .22 of the pixels against .05, so finer needles in more
                # patches and small melt pockets, half again as many.
                frostNeedles=.8, frostGaps=.1, frostGapReach=.7, frostGapSize=7,
                # Card G6: retail's blocks (ice-3, Polar Range) are soft, snow-capped slate: the light reads the
                # height blurred over ~13 px so crests are rounded and there are no hard creases, the flat top is
                # snow, the faces are smooth slate crossed by fine fibres down the slope (no glint dashes), and dark
                # hatched drifts spill past the foot into the snow.
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
OPEN = [-9, -8, 9, 10]   # a ground-cover window with no limit
# Ground cover (card P30): seven classes placed by moisture, soil and sun, colouring the grass (engine-frag.wgsl groundCover). The table also
# replaces the slope-only ramp: the slope texture's share is the table's thin soil. Windows are [from, full, full until, gone by]; OPEN is no limit.
# Moisture 0 is dry ground and 1 is a channel: wetness (the Time pass's map: the 5th percentile is 0, the median .0-.2, the 90th .4-.7, the 99th
# .8-.9 on green-modern-1..3) runs from `wet[0]` (above the dry half) to `wet[1]` (near its 95th percentile). `color` is the plant colour the
# Colors panel's Vegetation row starts from (turf's); a pick moves every class but bare soil (`bare`) by the change from it (sculpt-material-model.js).
# Modern Green's table, measured on green-modern-1..3: `ground` is the grass colour the class colours were measured against.
GROUND_COVER = dict(
    # Card P31: plants in the bake's loose scatter, by class: tufts on turf and dry grass, clumps on meadow and rush, cushions on moss, shrubs on scrub
    # (the numbers are height scales and the shrub density; where they grow follows the classes, so Lushness; tuft size follows looseSize).
    plants=dict(tuft=4, shrub=2, shrubs=1.5,
                # Card P31: flowers, 1-2 px dots in one-species clumps on meadow and scrub, in sun, more on lush ground (the draw's groundCover). Density is the
                # chance of a dot per 2 x 2 px at the best of its ground; the palette is rgb and a weight (white and yellow common, violet and red rare).
                flowers=dict(density=.15, palette=[[236, 232, 214, 4], [255, 214, 64, 3], [170, 120, 215, 1], [225, 80, 60, 1]])),
    wet=[.25, .9], dry=.4, patch=22, ground=[55, 93, 27], color=[55, 95, 27],
    soil=dict(slope=[.6, 1.6], convex=.5, deposit=.3),
    moisture=dict(perSwath=.5, swathRef=.35, shade=.28),
    classes=[
        dict(name='bare soil', bare=True, rgb=[105, 90, 38], grain=.12, strength=.015, lush=-1, moisture=OPEN, soil=OPEN, light=OPEN),
        dict(name='dry grass', rgb=[114, 109, 64], grain=.10, strength=.65, lush=0, moisture=[-1, 0, .2, .42], soil=[.05, .3, 9, 10], light=[1, 1.35, 9, 10]),
        dict(name='turf', rgb=[55, 95, 27], grain=.07, strength=1, lush=-1, moisture=[-.1, .12, .72, .92], soil=[.08, .3, 9, 10], light=OPEN),
        dict(name='meadow', rgb=[38, 91, 15], grain=.05, strength=1.1, lush=1, moisture=[.5, .7, .92, 1.01], soil=[.4, .75, 9, 10], light=[.55, .9, 9, 10]),
        dict(name='scrub', rgb=[28, 74, 9], grain=.06, strength=1.15, lush=2, moisture=[.55, .75, .9, .99], soil=[.5, .85, 9, 10], light=OPEN),
        dict(name='moss', rgb=[42, 84, 29], grain=.03, strength=.8, lush=0, moisture=[.12, .4, 9, 10], soil=[-9, -8, .6, 1.4], light=[-9, -8, .6, .95]),
        dict(name='wet rush', rgb=[38, 80, 32], grain=.10, strength=1, lush=1, moisture=[.9, .99, 9, 10], soil=[.45, .75, 9, 10], light=OPEN),
    ])
# Every other world's table (Vegetation cover 0 there: off until an artist raises it): modern Green's classes and plants, with no `ground` of
# its own (the classes are measured against the world's own ground colour) and bare soil in that ground colour, so thin cover fades into the
# world's own ground.
DEFAULT_GROUND_COVER = {**{k: v for k, v in GROUND_COVER.items() if k != 'ground'},
                        'classes': [{k: v for k, v in c.items() if not (c.get('bare') and k == 'rgb')} for c in GROUND_COVER['classes']]}
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
                     knobs=dict(banding=0, faceLayers=.2, faceStreak=0, crackSeverity=.45, crackBlocks=.3, crackDark=.75,
                                # Green dive (owner: cracks too thick, dark lines not thin relief): retail's hill cracks are few, long and thin, with a
                                # light lip: fewer minor cracks, no hairlines, majors 80 px apart, .8 px wide and fewer, closer to plates than to rills
                                # (the fall-line rills read as grey streaks), almost no band dashes (banding .35 -> .05); floors at the default .75
                                # (at .3 the cracks drew as pale squiggles once the rock face took the slopes).
                                crackMinor=.2, crackHairline=0, crackSpacing=80, crackWidth=.8, crackMajor=.5, crackNetwork=.8,
                                reliefAmount=.5)),
        # Modern Green (card P24, decision 25): where the realistic look accumulates. It is judged on green-1..3 for
        # palette, scale and readability at 1x, and by eye for realism: drainage that branches, rock that breaks along
        # its beds and joints, debris where gravity and water leave it, light that agrees from any sun. It starts as a
        # copy of Green's own preset; each look card sets its realistic numbers here (scenes green-modern-1..3).
        # Card P12b: Sun color #ffc880 and Sky color #80a0ff (a warm sun against a cool sky; they replace the Shade blue .25 this variant borrowed as a stand-in, so shadeBlue is back at Green's 0).
        # Card P12: Cavity 1.0 (Green's .6; the multi-scale ring reads concave floors dark and convex lips bright under any sun), Shine rock .36 (Green's .32: wet-looking rock glints; .5 overshoots retail's face, mean luma 51 against 45.8).
        # Card P1: landforms cut by branching gullies at 40 (by eye on green-modern-1..3 at 30, 40, 60 and 100: at 40 the
        # round hills carry branching spurs and the long cliff of green-modern-2 broad, uneven valleys; from 60 they also
        # cut the grass slope above the cliff; 30 barely reads at 1x). Card P17: talus cones at 15 px below the gully chutes of the steepest faces
        # (Realism check on green-modern-1..3: 8.41 of 15 statistics in range against 7.82 without, 24 gate failures against 25; 30 gives 8.53, 60 gives 8.76,
        # but from 30 the cones read as hard dark rays on hills that are soft in retail). Card P32: terracettes on steep grass (Joined
        # wrinkles on a grass world).
        # Ground cover (card P30): GROUND_COVER above, with Vegetation cover 1.
        # Card P27: Surf .1 on its water strokes (a wet line and a 1-px foam lace on lakes, no beach) and a sand colour for the beaches
        # higher Surf builds.
        'modern': dict(label='Modern: realistic look (in progress)', colors=dict(sand='#f0d69a', sun='#ffc880', sky='#80a0ff'), knobs=dict(vegetationCover=1, coastRamp=1, gullies=.4, wrinkles=1, surf=.1, looseSupply=.7, looseSize=5, cavity=1.0, shineRock=.36, rimReach=60, soilRim=.7, boulders=.5),
                       # Card P16: loose stone where gravity and water leave it: Supply .7 puts a stony apron round the hills' feet and in gullies,
                       # median 5 px (readable at 1x; Green's retail grit is 3-4); stoneSort .7 sorts it by the process (talus coarsens outward).
                       material=dict(stoneSort=.7, groundPool=2048, groundCover=GROUND_COVER),
                       # Bare rock at rims 60 px (round 3 of the comparison loop): the turf stops 20 to 45 px short of a cliff's edge, on a ragged line,
                       # and the granite shows; the heights do not move.
                       # Its rock is the Rounded granite recipe, beds and all (the owner, 2026-11-10): massive rock in rounded blocks 34 px wide, with
                       # no strata. The recipe's numbers win over the variant's where both set one: Shine rock .4 for .36 and loose stone 7 px for 5.
                       # Its rock presets besides Smooth soil (B2): a jointed wall and a pitted limestone, the two recipes besides granite that a temperate
                       # upland shows (sculpt-rock-presets.js worldRocks); no stroke chooses them unless an artist does.
                       rock=dict(recipe='granite', beds=True, presets=['basalt', 'limestone'])),
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
                      # No slope cover or exposed rock: their dark slate and granite
                      # read as teal specks on a bright berg, where retail's faces are one
                      # rough blue-white grain (ground pattern contrast 2 gave it; card G6 lowered it to 1.3 and the
                      # relief to .35 / .4: the owner found ice-2 too rough, and its 3x3 high-pass was 17.5 against retail's 11.7, now 13).
                      # A short wet band keeps the waterline from a dark fringe.
                      material=dict(slopeStart=3.0, slopeFull=4.0, wetBand=2.0, rockSlope=9.0),
                      knobs=dict(crystalFace=2.2, crystalTone=.92, crystalGrain=.4, crackSeverity=0, shadeBlue=.9, lightCap=1.4, ambient=.32, groundContrast=1.3,
                                 # Card G6: the world's soft slate block look is not the berg's.
                                 iceSoft=0, iceSnow=0, iceFall=0, iceApron=0,
                                 # Card E6: the world's monotone mountains (glints, soft relief) are not the berg's look.
                                 reliefAmount=.35, reliefScale=28, reliefLumps=.4, shineWhite=.35, shineStretch=1, shineHeadroom=0,
                                 shineRock=0, shineRockSharp=24, shineRockRough=0, shineRockScale=6)),
        # Crystal mountains (card E6, retail ice-1): slate ruled with straight dark strokes in
        # domains, snow-white lumps standing on the raised ground, soft relief, no glint.
        'crystal': dict(label='Crystal mountains: straight strokes',
                        knobs=dict(iceCrystal=1, iceCrest=.3, iceSoft=0, iceSnow=0, iceFall=0, iceApron=0, shineRock=0, shineRockRough=0, shineHeadroom=0, shineStretch=1, shineWhite=.35)),
        # Snow and slate (the mountains before card E6): carved cracks, no sheen.
        'snow': dict(label='Snow and slate: cracked mountains',
                     knobs=dict(iceSoft=0, iceSnow=0, iceFall=0, iceApron=0, crackSeverity=.2, shadeBlue=0, reliefAmount=.5, reliefScale=28, reliefLumps=.7,
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
        'pitted': dict(label='Pitted: E6 dots on all raised ground', knobs=dict(pockmark=1, moonCups=0, moonRibs=0, moonFolds=0, banding=.3)),
        # Cracked slopes (the look before card E6): smooth hill tops, wormy and crazed sides,
        # carved cracks, no pits and no sheen.
        'cracked': dict(label='Cracked slopes: smooth tops',
                        knobs=dict(crackSeverity=.35, worms=.4, wrinkles=.8, pockmark=0, moonCups=0, moonRibs=0, moonFolds=0, banding=.3, shineGate=0, shineWhite=.35, shineStretch=1,
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
                      knobs=dict(banding=.9, crackSeverity=.5, crackMajor=.7,
                                 crackMinor=.15, crackBlocks=.15,
                                 # Card E8: retail's shaded flanks go black (desert-2's buttes: 1.0% of the window
                                 # under luma 25, 2.3% under 40; ours bottomed at 42 with ambient .3, 0% and
                                 # 0.4%). Ambient .12 gives 0% and 1.0%.
                                 ambient=.12)),
    # Its beds are the `triad` row of the column block in materials/desert.json. Card E8: retail's grey buttes carry
    # rust-pink lines (slot 4, (175,111,90), the nearest slot to the measured (149,88,86)) 15 units apart (median over the
    # lit flanks above 60, 14 px) and ~4.4 units wide, not 4 apart.
        # Modern Desert: where its realistic look accumulates, as modern Green's does. So far it is Desert with the Layered sandstone recipe's
        # numbers for its rock (the owner, 2026-11-10), over Desert's own beds and their colors: the recipe's three thin beds, 14 units to the
        # cycle, painted a plateau's level top in patches of all three.
        # Bare rock at rims 60 px, as modern Green: the level top's cover gives way to rock before the cliff.
        # Its rock presets besides Smooth soil (B2): thin shale and a rounded conglomerate, the beds a sandstone desert interleaves.
        'modern': dict(label='Modern: realistic look (in progress)', knobs=dict(rimReach=60), rock=dict(recipe='sandstone', beds=False, presets=['shale', 'conglomerate'])),
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
    # A variant's own knobs beat the world's engine preset.
    out['engineDefaults'] = {k: x for k, x in out.get('engineDefaults', {}).items() if k not in v.get('knobs', {})}
    if v.get('river'):
        # Swap in the world's river water (its material and water numbers, which name the river's two water materials).
        for key, value in copy.deepcopy(config['river']).items():
            out[key] = {**out.get(key, {}), **value}
    out['baseColors'] = dict(config.get('colors', {}))
    out['colors'] = {**config.get('colors', {}), **v.get('colors', {})}
    if v.get('material'):
        out['material'] = {**out.get('material', {}), **v['material']}
        for key in ('stoneSort', 'stoneRound', 'stoneSlab', 'bedCycleVary', 'faceBedVary'):
            if key in v['material'] and key not in v.get('knobs', {}):
                out['defaults'][key] = str(v['material'][key])
    out.update(copy.deepcopy(v.get('config', {})))
    if v.get('rock'):
        out['rock'] = dict(v['rock'])   # a rock recipe by name: the page lays its numbers over the world's (sculpt-rock-presets.js applyWorldRock)
    out['variant'] = variant
    return out


# Every world is described by one committed table, materials/<world>.json (measured and fitted by measure/): the materials its layers are
# made from, its `material` and `water` numbers, its page defaults and base height (`world`), and, for Zhon, its river variant. Nothing
# here reads an image or a retail source, so a server needs no assets folder to draw a world.
MATERIAL_TABLES = {world: f'materials/{world}.json' for world in ('green', 'moon', 'desert', 'zhon', 'lava', 'ice', 'red', 'crystal', 'archipelago')}   # paths relative to the page, like every other file it loads
SOURCES.update({table: HERE / table for table in MATERIAL_TABLES.values()})
SOURCES['materials/palette.json'] = HERE / 'materials' / 'palette.json'


# A world's rock recipe by name, as a variant's `rock` is (apply_variant): the page lays the recipe's numbers over the world's own rock
# numbers (sculpt-rock-presets.js applyWorldRock). `beds` False keeps the world's own beds and their colors.
# Red: Jointed siltstone, a pavement of polygonal blocks cut by deep open joints. Red's earlier rock numbers dug ragged trenches where
# level ground was rock at a face's full relief (painted rock, and now rock at shores).
WORLD_ROCK = {'red': dict(recipe='siltstone', beds=False)}


def world_knobs(biome, config):
    """Set the page's knob defaults: KNOB_DEFAULTS, the world's water depths,
    then its WORLD_KNOBS entry."""
    knobs = {**KNOB_DEFAULTS, **{key: config['material'].get(key, default) for key, default in [('stoneSort', .6), ('stoneRound', 0), ('stoneSlab', .05), ('bedCycleVary', 0), ('faceBedVary', 1)]}, 'shallowDepth': config['material'].get('shallowDepth', 2),
             'deepDepth': config['material'].get('deepDepth', 42), **WORLD_KNOBS.get(biome, {})}
    config['defaults'].update({k: str(v) for k, v in knobs.items()})
    config['engineDefaults'] = {k: str(v) for k, v in ENGINE_KNOBS.get(biome, {}).items()}
    config['knobs'] = sorted(knobs)
    return config


def export_defaults(biome):
    """The map export's per-world defaults (retail planet, sea level, OTA climate medians), committed in the world's table."""
    return json.loads((HERE / MATERIAL_TABLES[biome]).read_text())['world']['export']


FEATURE_KINDS = ('tree', 'shrub', 'rock', 'scar')   # sculpt-feature-set.js KINDS that come from a world's table


def biome_config(biome):
    """One world's page configuration, built from its table."""
    table = json.loads((HERE / MATERIAL_TABLES[biome]).read_text())
    world = copy.deepcopy(table['world'])
    world.pop('export', None)   # the page's world catalogue (EXPORT_DEFAULTS), not the page's config
    config = {'biome': BIOME_NAMES[biome], 'biomeId': biome, 'size': 1024, 'grid': 512, 'seaLevel': 0, 'baseHeight': world.pop('baseHeight', 24),
              'materialTable': MATERIAL_TABLES[biome], 'layers': table['order'],   # the materials the table makes: which optional stages (body, beach, ring) the world has
              'material': {'groundCover': copy.deepcopy(DEFAULT_GROUND_COVER), **table['material']}, 'water': table['water'], **world}
    if 'river' in table:
        config['river'] = table['river']   # the river variant's material and water numbers (WORLD_VARIANTS)
    # The generated feature kinds (trees, shrubs, rocks, scars; every world has deposits and vents): the world's own, and Green's for a kind it
    # has none of, so any world can place any kind (lit by its own sun; Green's is the one table measured from retail for all four).
    green = json.loads((HERE / MATERIAL_TABLES['green']).read_text())['features']
    config['features'] = {**{k: v for k, v in green.items() if k in FEATURE_KINDS}, **table.get('features', {})}
    config['featureCatalog'] = feature_catalog()
    if biome in WORLD_ROCK:
        config['rock'] = dict(WORLD_ROCK[biome])
    return world_knobs(biome, config)


def feature_catalog():
    """All recipes, available on every world; no renderer branches on their source."""
    out = []
    for world, path in MATERIAL_TABLES.items():
        for kind, data in json.loads((HERE / path).read_text()).get('features', {}).items():
            if kind not in FEATURE_KINDS and kind not in ('deposit', 'vent'):
                continue
            types = data.get('types') or [{'share': 1, 'params': data.get('params', {}), 'vary': data.get('vary', {})}]
            for index, shape in enumerate(types):
                recipe = {**data, 'count': min(4, data.get('count', 4)), 'types': [{**shape, 'share': 1, 'params': {**data.get('params', {}), **shape.get('params', {})}}]}
                params = recipe['types'][0]['params']
                form = params.get('species') or params.get('type') or ('spire' if params.get('tall', 0) > .4 else kind)
                form = {'deadConifer': 'dead conifer'}.get(form, form)
                cells = f" ({params['cells'].replace('x', '×')})" if params.get('cells') else ''
                name = f"{BIOME_NAMES[world]} · {form} {index + 1}{cells}"
                out.append({'id': f'{world}-{kind}-{index}', 'kind': kind, 'name': name, 'data': recipe})
    return out


def world_configs(biomes):
    """The page's configuration of each world, and the map catalog (what the page reads of it is committed with the worlds; only an
    export reads the installed content)."""
    configs = {b: biome_config(b) for b in biomes}
    # Any world may take another's ground pattern (World panel); the
    # pattern's mean is replaced by the world's ground colour.
    # A table world with no tile data (a quilted plain generated as a layer) has no pattern to lend; every other world does.
    patterns = {b: {'name': BIOME_NAMES[b], 'groundTable': configs[b]['materialTable']} for b in biomes
                if 'ground' in json.loads((HERE / configs[b]['materialTable']).read_text())}
    # Any world without a beach may take another's (World panel, Beach; sculpt-scene.js borrowBeach): the lender's table makes the layer, and its
    # material's beach numbers come with it.
    beaches = {}
    for b in biomes:
        if 'beach' in configs[b]['layers']:
            material = json.loads((HERE / configs[b]['materialTable']).read_text())['material']
            beaches[b] = {'name': BIOME_NAMES[b], 'table': configs[b]['materialTable'],
                          'material': {k: material[k] for k in ('beachWidth', 'beachHeight', 'beachRGB') if k in material}}
    for config in configs.values():
        config['biomes'] = {b: BIOME_NAMES[b] for b in biomes}
        config['groundPatterns'] = patterns
        config['beachSources'] = beaches
        config['variants'] = {k: v['label'] for k, v in WORLD_VARIANTS.get(config['biomeId'], {}).items()}
    return configs, {'worlds': {b: export_defaults(b) for b in biomes}}


# What the page loads from a static host or from this server, by the same relative paths: the world configs (config/<world>.json and
# config/<world>--<variant>.json), the map catalog and services.json (which server-side services exist). Everything else is a source file.


def site_data(biomes, configs, catalogue, services):
    """Every generated file of the site, as {relative path: bytes}: one table the dev server answers from and the static build writes."""
    files = {'services.json': services, 'config/catalog.json': catalogue}
    for b in biomes:
        files[f'config/{b}.json'] = configs[b]
        for variant in WORLD_VARIANTS.get(b, {}):
            files[f'config/{b}--{variant}.json'] = apply_variant(configs[b], b, variant)
    return {name: json.dumps(data).encode() for name, data in files.items()}


MAPS_URL = 'https://terraform-savelinks.danielgtaylor.workers.dev/maps'   # the live save-link Worker's maps endpoint (deploy/worker/)


# The map exporter the page runs (sculpt-export-worker.js): export/ built for WebAssembly from source, and the wasm_exec.js of the Go
# that built it. Nothing built is committed; the static build and the dev server each build it with the installed Go.
EXPORTER_SOURCES = ('export', 'mapdata', 'internal')
GO_MISSING = ('Export needs the map exporter, which this editor builds from its Go sources (export/) with Go. Go was not found on PATH '
              'or in /usr/local/go/bin. Install Go (go.dev/dl) and export again.')


def go_tool():
    """The go command: on PATH, or where the official installer puts it (a plain nohup shell may not have it on PATH)."""
    return shutil.which('go') or next((p for p in ('/usr/local/go/bin/go', '/opt/homebrew/bin/go') if os.access(p, os.X_OK)), None)


def exporter_digest():
    """A hash of everything the exporter is built from: its Go sources and the module files (go.mod names the Go toolchain)."""
    digest = hashlib.sha256()
    for path in sorted([HERE / 'go.mod', HERE / 'go.sum', *(p for d in EXPORTER_SOURCES for p in (HERE / d).rglob('*.go'))]):
        digest.update(str(path.relative_to(HERE)).encode() + b'\0' + path.read_bytes())
    return digest.hexdigest()


def build_exporter():
    """{'map-export.wasm': bytes, 'wasm_exec.js': bytes}, built now; ValueError says why it could not be. -trimpath and -buildvcs=false
    make the bytes depend only on the sources and the toolchain, so the static build's content hash moves only when they do."""
    go = go_tool()
    if not go:
        raise ValueError(GO_MISSING)
    handle, target = tempfile.mkstemp(suffix='.wasm')
    os.close(handle)
    try:
        done = subprocess.run([go, 'build', '-trimpath', '-buildvcs=false', '-ldflags=-s -w', '-o', target, './export'], cwd=HERE,
                              env={**os.environ, 'GOOS': 'js', 'GOARCH': 'wasm'}, capture_output=True, text=True, timeout=900)
        if done.returncode:
            raise ValueError('The map exporter (export/) did not build for WebAssembly: ' + (done.stderr.strip() or f'go build exited {done.returncode}'))
        wasm = Path(target).read_bytes()
    finally:
        os.unlink(target)
    root = Path(subprocess.run([go, 'env', 'GOROOT'], cwd=HERE, capture_output=True, text=True, timeout=300).stdout.strip())
    support = next((p for p in (root / 'lib' / 'wasm' / 'wasm_exec.js', root / 'misc' / 'wasm' / 'wasm_exec.js') if p.is_file()), None)
    if support is None:
        raise ValueError(f'The Go at {go} has no wasm_exec.js under {root}.')
    return {'map-export.wasm': wasm, 'wasm_exec.js': support.read_bytes()}


class Exporter:
    """The dev server's copy of the exporter files: built when the server starts and again on the next request after a Go source
    changes (the digest is checked on every request, so a stale build is never served). A failed build is retried on the next request."""
    def __init__(self):
        self.lock = threading.Lock()
        self.digest = None
        self.files = None

    def get(self, name):
        with self.lock:
            digest = exporter_digest()
            if digest != self.digest:
                self.files = build_exporter()
                self.digest = digest
            return self.files[name]


def build_site(out, biomes, configs, catalogue, maps_url=MAPS_URL):
    """Write the static site: out/index.html (opens the current build) and out/b/<content hash>/ (the page, its sources, the worlds' tables,
    ui-previews/ and the generated files). A build folder never changes once written, so a deploy cannot mix new scripts with cached old shaders."""
    services = {'defaultWorld': biomes[0], 'worlds': biomes, 'maps': {'available': True, 'url': maps_url}}
    files = {name: path.read_bytes() for name, path in SOURCES.items()}
    for leaf in sorted((HERE / 'ui-previews').iterdir()):
        if leaf.suffix in ('.png', '.json'):
            files['ui-previews/' + leaf.name] = leaf.read_bytes()
    files.update(site_data(biomes, configs, catalogue, services))
    files.update(build_exporter())
    digest = hashlib.sha256()
    for name in sorted(files):
        digest.update(name.encode() + b'\0' + hashlib.sha256(files[name]).digest())
    version = digest.hexdigest()[:10]
    target = Path(out) / 'b' / version
    for name, body in files.items():
        (target / name).parent.mkdir(parents=True, exist_ok=True)
        (target / name).write_bytes(body)
    index = ('<!DOCTYPE html>\n<html lang="en-US"><head><meta charset="utf-8"><title>Terraform</title>'
             f'<script>location.replace("b/{version}/sculpt.html"+location.search+location.hash)</script>'
             f'<noscript><meta http-equiv="refresh" content="0;url=b/{version}/sculpt.html"></noscript></head>'
             f'<body><a href="b/{version}/sculpt.html">Open Terraform</a></body></html>\n')
    (Path(out) / 'index.html').write_text(index)
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8767)
    parser.add_argument('--biomes', default='green,red,archipelago,moon,zhon,lava,desert,crystal,ice',
                        help='comma-separated biomes to serve; the first is the default world')
    parser.add_argument('--assets-root', type=Path, default=Path('/private/tmp/nanolathe-map-editor'),
                        help='where save links and the map catalogue live; the worlds themselves need nothing here')
    parser.add_argument('--export-tool', type=Path, help='Card D map exporter binary (default <assets-root>/map-export); only reads the world catalogue from installed content without --prepared (the page exports by itself)')
    parser.add_argument('--game-root', action='append', type=Path, help='content root for exports; repeat in mount order')
    parser.add_argument('--prepared', action='store_true', help='read the saved map-catalog.json in the assets root instead of the retail sources (BUNDLE.md); worlds never read retail sources')
    parser.add_argument('--maps-url', default=os.environ.get('TERRAFORM_MAPS_URL') or MAPS_URL, help='with --build-site: the save-link service the static page uses (default: $TERRAFORM_MAPS_URL, else the live Worker)')
    parser.add_argument('--build-site', type=Path, metavar='DIR', help='write the static site into DIR (index.html and b/<version>/) and exit; serve it with any static host')
    parser.add_argument('--dump-configs', type=Path, metavar='DIR', help='write the generated files the page loads (config/<world>.json, config/catalog.json, services.json) into DIR and exit: the headless renderer (repro/render.mjs) reads them with the checkout\'s sources, with no server')
    args = parser.parse_args()
    biomes = [b for b in args.biomes.split(',') if b in BIOME_NAMES]
    configs, catalogue = world_configs(biomes)
    if args.dump_configs:
        for name, body in site_data(biomes, configs, catalogue, {'defaultWorld': biomes[0], 'worlds': biomes}).items():
            (args.dump_configs / name).parent.mkdir(parents=True, exist_ok=True)
            (args.dump_configs / name).write_bytes(body)
        return
    if args.build_site:
        try:
            print(build_site(args.build_site, biomes, configs, catalogue, args.maps_url))
        except ValueError as err:
            parser.exit(1, f'sculpt.py --build-site: {err}\n')
        return
    from sculpt_export import MapExport
    map_export = MapExport(args.assets_root, args.export_tool or args.assets_root / 'map-export', args.game_root or [Path.home() / 'TotalAnnihilation'], args.prepared)
    from sculpt_maps import SavedMaps
    saved_maps = SavedMaps(args.assets_root)
    services = {'defaultWorld': biomes[0], 'worlds': biomes, 'maps': {'available': True, 'url': 'api/maps'}}
    generated = site_data(biomes, configs, catalogue, services)
    exporter = Exporter()

    def warm():   # build at start, so the first export need not wait for Go
        try:
            exporter.get('wasm_exec.js')
        except (OSError, ValueError, subprocess.SubprocessError) as err:
            print(f'Map exporter not built: {err}', flush=True)
    threading.Thread(target=warm, daemon=True).start()

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if saved_maps.get(self, self.path):
                return
            path = urlsplit(self.path).path
            try:
                if map_export.get(self, self.path):
                    return
            except (OSError, ValueError, subprocess.SubprocessError) as err:
                map_export.reply(self, {'error': str(err)}, 400)
                return
            content_type = 'text/plain; charset=utf-8'
            name = path.strip('/')
            if name in ('map-export.wasm', 'wasm_exec.js'):
                try:
                    body = exporter.get(name)
                except (OSError, ValueError, subprocess.SubprocessError) as err:
                    map_export.reply(self, {'error': str(err)}, 503)
                    return
                content_type = 'application/wasm' if name.endswith('.wasm') else 'text/javascript; charset=utf-8'
            elif name in generated:
                body = generated[name]
                content_type = 'application/json'
            else:
                if name in ('', 'sculpt'):
                    name = 'sculpt.html'
                file = SOURCES.get(name)
                if name.startswith('ui-previews/'):
                    # The committed hover examples (repro/ui-previews.mjs writes them).
                    leaf = name.removeprefix('ui-previews/')
                    if '/' not in leaf and (leaf.endswith('.png') or leaf == 'manifest.json') and all(c.isalnum() or c in '-_.' for c in leaf):
                        file = HERE / 'ui-previews' / leaf
                if file is None or not file.is_file():
                    self.send_error(404)
                    return
                body = file.read_bytes()
                if file.suffix == '.html': content_type = 'text/html; charset=utf-8'
                if file.suffix == '.js': content_type = 'text/javascript; charset=utf-8'
                if file.suffix == '.css': content_type = 'text/css; charset=utf-8'
                if file.suffix == '.png': content_type = 'image/png'
                if file.suffix == '.json': content_type = 'application/json'
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
            if not saved_maps.post(self, self.path):
                self.send_error(404)

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
