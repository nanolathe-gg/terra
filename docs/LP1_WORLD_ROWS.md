# LP1 computed World rows, 2026-11-12

Stages: A shape, B Time, C surface, D solid, E geometry, F color. Each row
lists the stages actually observed for one representable step at the ten
world defaults, using the page's computed shader dependency map plus the
declared JavaScript channels. This is not a proof for every gate state;
the current card only uses no-op detection and rectangles. LP5 must prove
stage skipping. See [the report](LP1_REPORT.md).

“Map / preset strokes” means the world-wide row dirties the map; editing
that number on a preset dirties only the union of its strokes plus the
bake reach. The `none` count is worlds whose probe changed no tracked input.
Fields lists use the world's slot 0 and are abbreviated only by removing
that repeated prefix. Full field records are in the external small JSON.

| Row | Computed stage(s) | Declared channels | No-op defaults / 10 | Rectangle | Changed fields |
| --- | --- | --- | ---: | --- | --- |
| `groundTiles` — Unique ground tiles | F | — | 0 | Map | groundTiles |
| `groundContrast` — Pattern contrast | F | — | 0 | Map | groundContrast |
| `groundPatch` — Ground patches (damp and dusty tones) | F | — | 0 | Map | groundPatch |
| `groundPatchSize` — Patch size (px) | F | — | 0 | Map | groundPatchSize |
| `undulation` — Undulation height | A | shape | 0 | Map | — |
| `undulationScale` — Undulation size (px) | none | — | 10 | Map | — |
| `undulationCover` — Undulating share of land | none | — | 10 | Map | — |
| `undulationArt` — Undulation in the art | none | — | 10 | Map | — |
| `faceSteep` — Landform face steepness | A | shape | 0 | Map | — |
| `lowTint` — Tint (Colors: Low ground) | F | — | 0 | Map | lowTint |
| `lowReach` — Reach (height above the sea) | F | — | 0 | Map | lowReach |
| `lowGrain` — Grain kept (low ground and water) | F | — | 0 | Map | lowGrain |
| `reliefScale` — Scale (px) | C | reach | 0 | Map | reliefScale |
| `reliefAmount` — Strength | C | reach | 0 | Map | reliefAmount |
| `reliefLumps` — Lumps | C | — | 0 | Map | reliefLumps |
| `reliefBranch` — Branching | C | — | 0 | Map | reliefBranch |
| `reliefWarp` — Warp (px) | C | — | 0 | Map | reliefWarp |
| `reliefPatchy` — Patchiness | C | reach | 0 | Map | reliefPatchy |
| `reliefJitter` — Rib irregularity | C | — | 0 | Map | reliefJitter |
| `gentleRelief` — Gentle-slope relief | C | — | 0 | Map | gentleRelief |
| `plainRelief` — Ground bumps | C | reach | 0 | Map | plainRelief |
| `lumpRelief` — Painted ground bumps | C | reach | 0 | Map | lumpRelief |
| `reliefOctaves` — Octaves | C | — | 0 | Map | reliefOctaves |
| `worms` — Wormy relief on slopes | C | reach | 0 | Map | worms |
| `flatShadow` — Cast shadow on level ground | F | — | 0 | Map | flatShadow |
| `flatOcclusion` — Occlusion on level ground | F | — | 0 | Map | flatOcclusion |
| `lightCap` — Highlight cap | F | — | 0 | Map | lightCap |
| `shadeDepth` — Directional shading kept | F | — | 0 | Map | shadeDepth |
| `sunTilt` — Light from the south | C | — | 0 | Map | light, sun |
| `sunHeight` — Sun height (degrees above the horizon) | C | — | 0 | Map | light, sun |
| `ambient` — Ambient light | F | — | 0 | Map | ambient |
| `creaseShade` — Shade in creases (gully and valley floors, any facing) | F | — | 0 | Map | creaseShade |
| `vegetationCover` — Vegetation cover (0 off) | C | loose | 0 | Map | materialTable, plantsOn |
| `lushness` — Lushness | C | — | 0 | Map | lushness |
| `soilRim` — Bare soil where cover thins | F | — | 0 | Map | soilRim |
| `erosionRain` — Rain (wets channels and hollows, and wears the ground) | B | time | 0 | Map | — |
| `wetSwath` — Moisture | C | — | 0 | Map | wetSwath |
| `wetGround` — Wet ground: darker and glossy where water lies | F | — | 0 | Map | wetGround, shineOn |
| `plantRelief` — Vegetation relief | C | — | 9 | Map | materialTable |
| `flowerDensity` — Flower density | C | — | 9 | Map | materialTable |
| `hillLight` — Slope-cover brightness | F | — | 0 | Map | hillLight |
| `ringFade` — Fringe fade length | F | — | 0 | Map | ringFade |
| `faceFill` — Fill light on shaded faces | F | — | 0 | Map | faceFill |
| `rockCrown` — Bare rock to the crown | F | — | 0 | Map | rockCrown |
| `sandCrown` — Painted sand to the crown (sand bars) | C | — | 0 | Map | sandCrown |
| `slopeTexture` — Sampled slope texture | F | — | 0 | Map | slopeTexture |
| `moss` — Moss from ground | F | — | 0 | Map | mossFromGround |
| `slopeMarks` — Dark slope marks | F | — | 0 | Map | slopeMarks |
| `wrinkles` — Joined slope wrinkles | C | — | 0 | Map | wrinkles |
| `shineStretch` — Grain streak length (x its width) | F | — | 0 | Map | shineStretch |
| `shineWhite` — Highlight whiteness (0 material hue, 1 white) | F | — | 0 | Map | shineWhite |
| `shineGround` — Gloss (highlight strength) | F | — | 0 | Map | shine, shineOn |
| `shineGroundSharp` — Reflection sharpness (polish) | F | — | 0 | Map | shine |
| `shineGroundRough` — Micro roughness (grain slope) | F | — | 0 | Map | shine, shineOn |
| `shineGroundScale` — Grain width (px) | F | — | 0 | Map | shine |
| `shineSlope` — Gloss (highlight strength) | F | — | 0 | Map | shine, shineOn |
| `shineSlopeSharp` — Reflection sharpness (polish) | F | — | 0 | Map | shine |
| `shineSlopeRough` — Micro roughness (grain slope) | F | — | 0 | Map | shine, shineOn |
| `shineSlopeScale` — Grain width (px) | F | — | 0 | Map | shine |
| `shineRock` — Gloss (highlight strength) | F | — | 0 | Map / preset strokes | shineRock, shineOn |
| `shineRockSharp` — Reflection sharpness (polish) | F | — | 0 | Map / preset strokes | shineRock |
| `shineRockRough` — Micro roughness (grain slope) | F | — | 0 | Map / preset strokes | shineRock, shineOn |
| `shineRockScale` — Grain width (px) | F | — | 0 | Map / preset strokes | shineRock |
| `shineOutside` — Rock glints kept outside painted rock | F | — | 0 | Map | shineOutside |
| `shineSand` — Gloss (highlight strength) | F | — | 0 | Map | shine, shineOn |
| `shineSandSharp` — Reflection sharpness (polish) | F | — | 0 | Map | shine |
| `shineSandRough` — Micro roughness (grain slope) | F | — | 0 | Map | shine, shineOn |
| `shineSandScale` — Grain width (px) | F | — | 0 | Map | shine |
| `shineCrystal` — Gloss (highlight strength) | F | — | 0 | Map | shine, shineOn |
| `shineCrystalSharp` — Reflection sharpness (polish) | F | — | 0 | Map | shine |
| `shineCrystalRough` — Micro roughness (grain slope) | F | — | 0 | Map | shine, shineOn |
| `shineCrystalScale` — Grain width (px) | F | — | 0 | Map | shine |
| `looseSupply` — Supply | C | loose | 0 | Map | looseSupply |
| `looseSize` — Size (median, px) | C | reach, loose | 0 | Map / preset strokes | looseSize |
| `boulders` — Boulders under walls | C | reach, loose | 0 | Map | boulders |
| `stoneSort` — Size sorting | C | — | 0 | Map / preset strokes | stoneSort |
| `stoneRound` — Rounded fragments (share) | C | — | 0 | Map / preset strokes | stoneRound |
| `stoneSlab` — Flat fragments (share) | C | — | 0 | Map / preset strokes | stoneSlab |
| `looseKnoll` — Knolls (share of stones that are ground rings around a hollow) | C | — | 0 | Map | looseKnoll |
| `sand` — Deposit supply | B | time | 0 | Map | sand |
| `sandLee` — Wind drifts (sand in the lee of rises) | C | — | 0 | Map | sandLee |
| `wind` — Wind toward (degrees; ripples and drifts) | C | — | 0 | Map | windAngle |
| `sandDust` — Dusting tint | F | — | 0 | Map | sandDust |
| `sandGrass` — Vegetation through sand | F | — | 0 | Map | sandGrass |
| `sandLight` — Weathered lightness | F | — | 0 | Map | sandLight |
| `sandGrain` — Rock grain in sand | F | — | 0 | Map | sandGrain |
| `ripple` — Ripple length (px) | C | — | 0 | Map | ripple |
| `rippleHeight` — Ripple height | C | reach | 0 | Map | rippleHeight |
| `crackSeverity` — Frost (crack depth; above 1 the fine fractures fill in) | C | reach | 0 | Map | crackSeverity |
| `crackSpacing` — Block size (px) | C | reach | 0 | Map | crackSpacing |
| `crackMajor` — Major cracks | C | — | 0 | Map | crackMajor |
| `crackMinor` — Minor cracks | C | — | 0 | Map | crackMinor |
| `crackHairline` — Hairline crazing | C | — | 0 | Map | crackHairline |
| `crackBlocks` — Facets (block relief) | C | reach | 0 | Map | crackBlocks |
| `crackWidth` — Width (px) | C | — | 0 | Map | crackWidth |
| `crackNetwork` — Majors: rills to plates | C | — | 0 | Map | crackNetwork |
| `crackDark` — Floor darkness | F | — | 0 | Map | crackDark |
| `banding` — Strength | C | reach | 0 | Map | banding |
| `bandSoftness` — Riser share | C | — | 0 | Map | bandSoftness |
| `bandWater` — Rings in water color | F | — | 0 | Map | bandWater |
| `sandBanding` — Streaks on sand and ramps | C | — | 0 | Map | sandBanding |
| `sandBandSpacing` — Streak height step | C | — | 0 | Map | sandBandSpacing |
| `strata` — Layer color coverage (0.5 rock, 1 whole outcrop) | F | — | 0 | Map / preset strokes | strata |
| `strataContrast` — Color strength | F | — | 0 | Map / preset strokes | strataContrast |
| `strataGrain` — Bed grain | F | — | 0 | Map / preset strokes | strataGrain |
| `bedDip` — Bed tilt (height per px; 2 north: level rows) | B | timeColumn | 0 | Map / preset strokes | bedDip |
| `bedDipDir` — Bed tilt toward (deg, 0 east, 90 south) | B | timeColumn | 0 | Map / preset strokes | bedDipDir |
| `coastRamp` — Coast ramp (share of the drawn slope kept) | A | shape | 0 | Map | — |
| `beachWidth` — Beach width (worlds with beaches) | C, F | reach | 0 | Map | beachWidth, beachDistance |
| `apron` — Sand apron round raised rock (px) | C | — | 0 | Map | apron |
| `shallowDepth` — Shallow until depth | F | — | 0 | Map | shallowDepth |
| `deepDepth` — Deep from depth | F | — | 0 | Map | deepDepth |
| `waterSoft` — Color depth averaging (px) | F | — | 0 | Map | waterSoft |
| `crispShore` — Crisp waterline (shore to shallow) | F | — | 0 | Map | crispShore |
| `deepEdge` — Hard shallow-to-deep step (0 ramp) | F | — | 0 | Map | deepEdge |
| `bedTint` — Bed tint strength | F | — | 0 | Map | bedTint |
| `bedBright` — Tinted bed brightness | F | — | 0 | Map | bedBright |
| `bedContrast` — Bed light carried through the tint | F | — | 0 | Map | bedContrast |
| `bedRelief` — Bed lumps (lit relief under shallows) | C | reach | 0 | Map | bedRelief |
| `shoreEdge` — Waterline rim and lip | F | — | 0 | Map | shoreEdge |
| `bankRock` — Rock on low banks | F | — | 0 | Map | bankRock |
| `paletteMix` — Mix palette pairs (0 nearest, 1 pairs) | F | — | 0 | Map | paletteMix |
| `dither` — Dither (water) | F | — | 0 | Map | dither |
| `landDither` — Land dither share | F | — | 0 | Map | landDither |
| `baseBand` — Gray band strength | F | — | 0 | Map | baseBand |
| `baseBandLow` — Window from (height) | F | — | 0 | Map | baseBandLow |
| `baseBandHigh` — Window to (height) | F | — | 0 | Map | baseBandHigh |
| `baseBandWander` — Window drift (height) | F | — | 0 | Map | baseBandWander |
| `baseBandGaps` — Share missing | F | — | 0 | Map | baseBandGaps |
| `desertCapFlat` — Uniform cap color | F | — | 0 | Map | desertCapFlat |
| `rockFace` — Depth | D | — | 0 | Map / preset strokes | rockFace |
| `faceRock` — Rock share of steep faces | F | — | 0 | Map / preset strokes | faceRock |
| `rockFaceFrom` — Starts at slope | C | — | 0 | Map / preset strokes | rockFaceFrom |
| `rimReach` — Bare rock at rims (px) | C | reach, runoff | 0 | Map | rimReach |
| `shoreRock` — Rock at shores (px inland) | C | reach, runoff | 0 | Map | shoreRock |
| `shoreShelf` — Rock shelf under water (px out) | C | reach, runoff | 0 | Map | shoreShelf |
| `faceExtrude` — Extrusion bias: inset to projecting | D | — | 0 | Map / preset strokes | faceExtrude |
| `faceMass` — Broad bulges and alcoves | D | — | 0 | Map / preset strokes | faceMass |
| `faceWhole` — Whole blocks (share of blocks) | D | — | 0 | Map / preset strokes | faceWhole |
| `faceWholeLarge` — Whole large blocks (share of blocks) | D | — | 0 | Map / preset strokes | faceWholeLarge |
| `faceRegular` — Block regularity (0 scattered, 1 a grid) | C | — | 0 | Map / preset strokes | faceRegular |
| `faceBlock` — Block offsets and tilts | D | — | 0 | Map / preset strokes | faceBlock |
| `faceBlockSize` — Joint spacing (px) | C | — | 0 | Map / preset strokes | faceBlockSize |
| `faceStretch` — Block length / width | C | — | 0 | Map / preset strokes | faceStretch |
| `faceBlockHeight` — Block height / layer height (blocks are never under 3.5 units tall) | C | — | 0 | Map / preset strokes | faceBlockHeight |
| `faceJointTilt` — Joint tilt from vertical (deg) | C | — | 0 | Map / preset strokes | faceJointTilt |
| `faceScaleVary` — Block size variation | C | — | 0 | Map / preset strokes | faceScaleVary |
| `faceBreak` — Block release | C | — | 0 | Map / preset strokes | faceBreak |
| `faceRound` — Rounded blocks | C | — | 0 | Map / preset strokes | faceRound |
| `faceJoint` — Joint depth | D | — | 0 | Map / preset strokes | faceJoint |
| `faceJointWidth` — Joint opening width | D | — | 0 | Map / preset strokes | faceJointWidth |
| `faceSecondary` — Secondary fracture depth | D | — | 0 | Map / preset strokes | faceSecondary |
| `faceContinuity` — Fracture continuity | D | — | 0 | Map / preset strokes | faceContinuity |
| `faceLean` — Joint orientation from north-south (deg) | C | — | 0 | Map / preset strokes | faceLean |
| `bedCycleVary` — Variation between repeated beds | C | — | 0 | Map / preset strokes | bedCycleVary |
| `faceBedVary` — Layer waviness | C | — | 0 | Map / preset strokes | faceBedVary |
| `faceBed` — Layer thickness (height) | C | — | 0 | Map / preset strokes | faceBed |
| `faceLedge` — Hard-layer ledges | D | — | 0 | Map / preset strokes | faceLedge |
| `faceRun` — Layer variation length (px) | C | — | 0 | Map / preset strokes | faceRun |
| `faceFold` — Fold amplitude (height) | C | — | 0 | Map / preset strokes | faceFold |
| `faceSpall` — Broken layer edges | D | — | 0 | Map / preset strokes | faceSpall |
| `faceLamina` — Fine layer relief | D | — | 0 | Map / preset strokes | faceLamina |
| `faceLaminaSize` — Fine layer spacing (height units) | D | — | 0 | Map / preset strokes | faceLaminaSize |
| `faceLayers` — Soil-covered terraces | D | — | 0 | Map / preset strokes | faceLayers |
| `faceGrass` — Grass on ledges and flat tops | F | — | 0 | Map / preset strokes | faceGrass |
| `faceWear` — Weathering: rounded edges, open joints | D | — | 0 | Map / preset strokes | faceWear |
| `faceCrease` — Pitting | D | — | 0 | Map / preset strokes | faceCrease |
| `faceCreaseSize` — Pit size (px) | D | — | 0 | Map / preset strokes | faceCreaseSize |
| `faceScratch` — Scratches and water grooves | D | — | 0 | Map / preset strokes | faceScratch |
| `faceScratchSize` — Groove spacing (px) | D | — | 0 | Map / preset strokes | faceScratchSize |
| `faceScratchLength` — Groove length (px) | D | — | 0 | Map / preset strokes | faceScratchLength |
| `faceScratchAngle` — Groove tilt from vertical (deg) | D | — | 0 | Map / preset strokes | faceScratchAngle |
| `faceClast` — Embedded fragment relief | D | — | 0 | Map / preset strokes | faceClast |
| `faceClastSize` — Embedded fragment size (px) | D | — | 0 | Map / preset strokes | faceClastSize |
| `faceDetailPatch` — Fine detail clustering | D | — | 0 | Map / preset strokes | faceDetailPatch |
| `faceGrit` — Grit relief | D | — | 0 | Map / preset strokes | faceGrit |
| `faceGritSize` — Grit size (px) | D | — | 0 | Map / preset strokes | faceGritSize |
| `runoff` — Runoff exposure | C | reach, runoff | 0 | Map / preset strokes | runoff, runoffAny |
| `runoffScale` — Catchment variation size (px) | C | — | 0 | Map / preset strokes | runoffScale |
| `runoffConcentration` — Channel concentration | C | — | 0 | Map / preset strokes | runoffConcentration |
| `runoffCut` — Channel incision | D | — | 0 | Map / preset strokes | runoffCut |
| `runoffStain` — Mineral staining | F | — | 0 | Map / preset strokes | runoffStain |
| `debrisAmount` — Cliff debris accumulation | C | reach, runoff, loose | 0 | Map / preset strokes | debrisAmount, debrisAny |
| `debrisReach` — Rockfall reach (px) | C | — | 0 | Map / preset strokes | debrisReach, debrisReachMax |
| `debrisDepth` — Accumulated bed thickness | C | reach | 0 | Map / preset strokes | debrisDepth |
| `absorbDepth` — Color deepens with thickness | F | — | 0 | Map / preset strokes | absorbDepth |
| `shadowTint` — Colored cast shadow | F | — | 0 | Map / preset strokes | shadowTint, shadowTintAny |
| `faceShade` — Shadow and crevice depth | F | — | 0 | Map / preset strokes | faceShade |
| `faceTone` — Color variation between blocks | F | — | 0 | Map / preset strokes | faceTone |
| `faceFresh` — Fresh fracture contrast | F | — | 0 | Map / preset strokes | faceFresh |
| `faceRind` — Weathered crust coverage | F | — | 0 | Map / preset strokes | faceRind |
| `faceRindDepth` — Weathering penetration (art units) | F | — | 0 | Map / preset strokes | faceRindDepth |
| `faceRindTone` — Crust lightness (dark to bleached) | F | — | 0 | Map / preset strokes | faceRindTone |
| `faceRindWarmth` — Crust oxidation | F | — | 0 | Map / preset strokes | faceRindWarmth |
| `faceRindRough` — Crust finish (0 polished, 1 rough) | F | — | 0 | Map / preset strokes | faceRindRough |
| `faceMineral` — Mineral contrast | F | — | 0 | Map / preset strokes | faceMineral |
| `faceStrata` — Layer tint: lighter and darker | F | — | 0 | Map / preset strokes | faceStrata |
| `faceWet` — Wetness: darker rock, smoother reflections | F | — | 0 | Map / preset strokes | faceWet, shineOn |
| `stepSoftPx` — Threshold edge softness (px) | F | — | 0 | Map | stepSoftPx |
| `shelfWander` — Shelf wander (depth units) | F | — | 0 | Map | shelfWander |
| `bedFlat` — Bed lit by its own relief only | F | — | 0 | Map | bedFlat |
| `shoalRag` — Shallow-to-deep notches (px) | F | — | 0 | Map | shoalRag |
| `shoalStairs` — Hard waterline stairs (px) | F | — | 0 | Map | shoalStairs |
| `shoalShoreSoft` — Waterline blur (px) | F | — | 0 | Map | shoalShoreSoft |
| `ringContrast` — Fringe contour lines: contrast | F | — | 0 | Map | ringContrast |
| `ringCount` — Fringe contour lines: count | F | — | 0 | Map | ringCount |
| `ringSize` — Fringe contour lines: reach | F | — | 0 | Map | ringSize |
| `ringShift` — Offset between copies (px; 0: concentric lines) | F | — | 0 | Map | ringShift |
| `ringShiftDir` — Drift direction (deg clockwise from east) | F | — | 0 | Map | ringShiftDir |
| `ringScatter` — Direction wander (share of a half turn) | F | — | 0 | Map | ringScatter |
| `ringWobble` — Outline waver (px) | F | — | 0 | Map | ringWobble |
| `ringLobe` — Lobe size (px) | F | — | 0 | Map | ringLobe |
| `ringFill` — Pale tint where copies overlap | F | — | 0 | Map | ringFill |
| `ringPatch` — Reach varies along the outline | F | — | 0 | Map | ringPatch |
| `ringPatchSize` — Reach variation size (px) | F | — | 0 | Map | ringPatchSize |
| `ringTone` — Retail rose, paler outward | F | — | 0 | Map | ringTone |
| `lavaCrust` — Pillow crust strength | C | — | 0 | Map | lavaCrust |
| `lavaPillow` — Pillow size (px) | C | — | 0 | Map | lavaPillow |
| `lavaChip` — Chip size (px) | C | — | 0 | Map | lavaChip |
| `lavaVeins` — Veins hanging down the slope | C | — | 0 | Map | lavaVeins |
| `lavaCalm` — Replace fine relief with crust | C | — | 0 | Map | lavaCalm |
| `lavaDusk` — Shade away from light | F | — | 0 | Map | lavaDusk |
| `layerCrease` — Dark crease at each step foot, any facing | F | — | 0 | Map | layerCrease |
| `shineSlopeGate` — Shine only on slopes above (0: everywhere) | F | — | 0 | Map | shineSlopeGate |
| `shineGate` — Roughness only on raised ground and slopes | F | — | 0 | Map | shineGate |
| `shineHeadroom` — Dim the body between glints (near-white surface) | F | — | 0 | Map | shineHeadroom |
| `pockmark` — Dark pits on raised ground and slopes | F | — | 0 | Map | pockmark |
| `pockSize` — Pit spacing (px) | F | — | 0 | Map | pockSize |
| `moonCups` — Slope cups | F | — | 0 | Map | moonCups |
| `moonCupSize` — Cup spacing (px) | F | — | 0 | Map | moonCupSize |
| `moonCupDepth` — Cup depth (wall steepness) | F | — | 0 | Map | moonCupDepth |
| `cupStretch` — Cup stretch into strokes (1: pits) | F | — | 0 | Map | cupStretch |
| `moonRibs` — Slope ribs | F | — | 0 | Map | moonRibs |
| `moonRibDepth` — Stroke steepness | F | — | 0 | Map | moonRibDepth |
| `moonRibDark` — Darker where turned from the sun | F | — | 0 | Map | moonRibDark |
| `moonFolds` — Contour folds | F | — | 0 | Map | moonFolds |
| `moonFoldSpacing` — Fold spacing (height units) | F | — | 0 | Map | moonFoldSpacing |
| `iceCrystal` — Straight face fibres | F | — | 0 | Map | iceCrystal |
| `gougeWeb` — Gouges across crystal formations | F | — | 0 | Map | gougeWeb |
| `iceCrest` — Cap lumps | F | — | 0 | Map | iceCrest |
| `iceSoft` — Rounded lighting | D | — | 0 | Map | iceSoft |
| `iceSnow` — Snow on level caps | F | — | 0 | Map | iceSnow |
| `iceFall` — Slope fibres | F | — | 0 | Map | iceFall |
| `iceApron` — Hatched foot apron | F | — | 0 | Map | iceApron |
| `iceFrost` — Needle hairlines | F | — | 0 | Map | iceFrost |
| `frostGaps` — Melt pockets: share of cells at the coast | A | shape | 0 | Map | — |
| `frostGapReach` — Melt pockets: reach inland (share of the band) | A | shape | 0 | Map | — |
| `frostGapSize` — Melt pockets: size (px) | A | shape | 0 | Map | — |
| `frostGapDepth` — Melt pockets: depth below the sea | A | shape | 0 | Map | — |
