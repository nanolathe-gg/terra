# H21 Impacts, part 1

Baseline: main `28e623d` (H19 and the three earlier handoffs landed). Inventory reads `sculpt.py` KNOB_DEFAULTS, WORLD_KNOBS, WORLD_VARIANTS, ENGINE_KNOBS; `sculpt.js` SHAPE_FIELDS and scriptedScene; the GPU preparation, bake and draw readers. No Impacts key occurs in ENGINE_KNOBS. Numbers below are engine units; a card's displayed percentages/tenths are converted before use. Unlisted worlds inherit the default. `=` denotes an explicit world entry equal to the default, not evidence of activity.

## Inventory

| Control | Default; explicit worlds / variants | Actual reader and result | Overlap / gate |
|---|---|---|---|
| craterlets | 3; Moon 6 | sculpt.js craterletSpot/regional bounds; sculpt-gpu-fields.js prepareNode generates satellites | Repeats crater stamps, with satellites' facets and recursive children disabled |
| craterEjecta | 0; Moon .7 | prepareNode ejecta → engine-shape.wgsl craterStamp | Throw-out outside rim; distinct from satellites |
| rimHeight | .34 | prepareNode rimH → craterStamp; rim spurs' height | Rim share of depth, not bowl depth |
| rimSectors | 0 | craterRim → rimFactors/craterStamp | Lopsided sectors; geometry, not surface folds |
| rimUnequal | .6 | craterRim sector radii/heights | Only meaningful with sectors |
| rimGaps | 0 | craterRim → rimFactors | Missing rim arcs, distinct from fissure cuts |
| rimGapWidth | 70 | craterRim gap half-width | Only meaningful with gaps |
| craterFacets | 0; Crystal 1 | prepareNode facetMode → facet job in engine-shape.wgsl | Shares plane-fitting pipeline with iceFacets (Bodies); do not fold crystal cells/slabs into Impacts |
| crystalCraterPx | 0; Crystal 16 | prepareNode facet width | 0 means radius-derived size; craterFacets gate |
| crystalCraterStep | 3; Crystal 1 | facet job fcStep | Facet height offsets; same pipeline as Ice, different parameters |
| crystalCraterSkin | 0; Crystal 1 | facet job fcSkin; fragment craterSkin | Marks crater with .74 crystal-field value; distinguishes it from columns/slabs/seams |
| crystalCraterWeb | 0; Crystal 1 | sculpt-renderer.js draw uniforms → engine-frag.wgsl craterWeb | Thin Voronoi seam on crater skin; crystal cells are Bodies' separate field |
| crystalCraterWebPx | 14; Crystal 18 | craterWeb | Cell size, skin/web gate |
| crystalCraterWobble | 0; Crystal 4 | craterWeb | Warps web position, not crater geometry |
| crystalCraterGap | 0; Crystal .25 | craterWeb / crater skin shading | Seam width, skin/web gate |
| crystalCraterTone | 0; Crystal .12 | craterWeb / crater skin shading | Per-cell brightness, skin gate |
| crystalCraterLight | 1; Crystal 1.6 | fragment crater skin shading | Crater brightness, skin gate |
| pockmark | 0; Moon =0; Moon pitted 1, cracked =0 | draw uniforms → pockPits; fragmentMain | Dark elliptical pits on landforms; shares lattice idea with cups/slope marks, not their lighting |
| pockSize | 5; Moon 7.5 | pockPits | Pit spacing/size; pockmark gate |
| moonCups | 0; Moon 1; pitted/cracked 0 | draw uniforms → moonCups; fragmentMain | Lit bowl normal/cavity; overlaps pockmarks in placement, preserves bright cup walls |
| moonCupSize | 5.5; Moon 6.5 | moonCups | Cell spacing / bowl radius; cups gate |
| moonCupDepth | 1.4 | moonCups | Bowl gradient; cups gate |
| moonRibs | 0; Moon 1; pitted/cracked 0 | draw uniforms → moonRibs; fragmentMain | Fine stretched derivative-noise relief on shaded slopes |
| moonRibDepth | 1; Moon .9 | fragmentMain normal perturbation | Relief depth; ribs gate |
| moonRibDark | 0; Moon .15 | fragmentMain ribs multiplier | Extra shade-facing darkening; ribs gate |
| moonFolds | 0; Moon .55; pitted/cracked 0 | draw uniforms → moonFolds; fragmentMain | Height-contour lines on gentle slopes, not rib noise |
| moonFoldSpacing | .9 | moonFolds | Separation of two contour bundles; folds gate |
| moonLobes | 0; Moon .5; pitted/cracked 0 | outlineUniforms → outlineShift; sculpt.js and GPU bounds | Whole hill/mountain outline; shares outlineShift with baseVary already, distinct profile/wavelengths |
| worms | 0; Moon/Lava =0; Moon cracked .4 | bake uniforms → engine-bake.wgsl bake, wormDark | Two noise-ridge height/trough terms; Impacts owns H17 stray; surface mark, not an authored fissure |
| wrinkles | 0; Moon =0, Lava .6; Moon cracked .8 | draw uniforms → wrinkleLines; fragmentMain | Joined contour wrinkles/pits; Impacts owns H17 stray; cubic noise vs ribs' quintic derivative noise |
| slopeMarks | 0; Moon =0 | draw uniforms → slopeMark; fragmentMain | Jittered ellipse, dark centre/light flanks; Impacts owns H17 stray |

All 31 keys remain. Twelve have shape-card controls: craterlets, craterEjecta, the five rim controls, craterFacets, the three crystalCrater geometry/skin controls, moonLobes. The nine crystalCrater controls are inventoried despite not starting with `crater`, because they implement the crater's skin. Shared spur/crest controls belong to Shapes; crackSeverity and fissure authoring belong to Fractures. Crystal cells, frost, ice slabs and iceFacets belong to Bodies (H20).

The engine paths are feature/kind gated, never world-ID gated. `moon*`, `crystal*` and comments naming a world are legacy identifiers, not runtime planet selection. A geometry control's query affects new tool defaults; an authored card wins, and scriptedScene's top-level options win over that card. The sweep must follow that order and touch the appropriate strokes.

## What draws on moon-2

`repro/scenes/moon-2.json` contains 17 strokes, none a fissure. The central deep crater (520,500; diameter 100, depth 90) requests seven long spurs, crestJag .6 and crestVary .5, but no satellites or ejecta. It sits on the large low hill at (505,545). Other craters have their own satellite counts. The baseline Moon enables cups 1, ribs 1, folds .55, lobes .5 and H19 faceRelief .5. It has crackSeverity 0, worms 0, wrinkles 0 and pockmark 0. Thus radial ridges belong to crater spurs, while cup/rib/fold marks are surface detail; neither is a long authored fissure. H17's crackSeverity .35 experiment altered surface cracks, not the missing scene strokes. That distinction must survive part 2.

## Same-idea groups and proposed merge

1. **Surface relief lighting (selected):** cups and ribs duplicate cast-shadow visibility, original diffuse light, perturbed diffuse light and the ambient/diffuse ratio. Shine uses the identical visibility term. Consolidate the shared arithmetic in fragmentMain while preserving each feature's gates, clamps and cavity/tone terms. This is the largest exact common expression group in the in-scope draw blocks; verify all 27 pixel buffers, plus a deliberately changed Moon control as the nonzero comparator.
2. Pockmarks, cups and slopeMarks each traverse a 3×3 jittered lattice, but their hashes, coordinate frames, density gates, bowl profiles and lighting differ. A generic kernel would need alternate paths/parameters and would not shorten this work. Keep pending owner decisions; not a justification to remove a look.
3. Wrinkles/ribs/worms/folds share the broad intent of regolith marks but use different coordinates and interpolation (cubic vs quintic derivatives; height contours vs world/pixel noise). Combining them moves pixels; outside this exact merge.
4. moonLobes/baseVary already share outlineShift. baseVary has priority, is capped at .15 radius, uses fixed 55/21 px wavelengths and foot-only support; moonLobes reaches .5 radius with radius-scaled three-octave noise across the face. baseBump only raises the lower face. Reproduce H15's 22/2.5 substitution before a keep/combine ruling.
5. Crater facets and Ice facets already share the facet job; crater skin's web and Bodies' crystal cells have different field ownership and gates. No new parallel path or cross-card edit.

## Evidence and checks

Results are appended by the following commits. Assets: `/private/tmp/nanolathe-map-editor/agent-H21`; reproducible numeric reports only are committed, never retail images or height arrays.
