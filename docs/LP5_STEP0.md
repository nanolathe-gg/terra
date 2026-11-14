# LP5 full-precision color split, step 0, November 13

**The sampled equality proof passes.** A warm color-only rerun equals a full
rebake by this split build in all eight small scene cases, including the
optional-feature cases. This is an experiment on `live-preview/lp6`, after
91a596ce, in the existing review worktree at the owner's request. Main remains
3aff1d1c. No visible-tile record cache or scheduler routing is implemented.
[Compact evidence](LP5_STEP0_METRICS.json) contains hashes, timings, resource
ledgers, the complete reachable texture-read inventory and the page endpoints.

## What is split

Every full draw now runs geometry E followed by color F. E uses the existing
solid and writes one full-precision storage record per raster pixel. F reads
that record and the existing cached 2D inputs. Its pipeline layout has an
**empty voxel bind group**: no reachable F branch can read the authored voxel
surface, guides, brick map, coarse cells or solid density. The probe destroys
all of those buffers/textures before each warm rerun, rather than merely
reusing an already-populated volume binding. There is no alternate old draw
path, prototype switch, new UI or saved state.

`recolor()` is a current-tile diagnostic API. It checks the computed stage
map against the geometry snapshot, rejects earlier-stage edits, preserves
the GPU-written chunk flags, and serializes against another render job.
Preparing another chunk invalidates the record. Evicted resources are checked
before reuse. This does not yet provide a cache key covering arbitrary edits
or an artist-facing fast color interaction.

## Geometry and solid reads

This inventories the old fragment's solid reads and the values E retains:

| Read | Retained value / precision |
| --- | --- |
| `voxelHit(screen)` | hit Y and Z as f32; X reconstructed by the original ray's exact `round(screenX*256)/256` expression |
| `voxelNormal(hit)` | three f32 normal components, before color-specific adjustments |
| `voxelAuthored(p)` | both f32 `gSoft` components, sampled at the original 1/64-pixel rounded point |
| `voxelFaceSlope(hit.xy)` | one f32 slope at the original unrounded hit; also used by `voxelSkin`/hardness and column gathering |
| `voxelRain(hit,normal)` | f32 rain exposure |
| `voxelShadow(hit,normal)` | f32 local sun visibility |
| `voxelOcclusion(hit,normal)` | f32 local sky visibility |
| `voxelCavity(hit,normal)` | f32 cavity value |
| `occlusion(p,h)` | f32 height/surface occlusion |
| `visibility(p,max(h,sea))` | f32 cast-shadow visibility |

The remaining geometry reads in F deliberately use retained **2D** inputs:
`baseHeight`, `surfaceHeight`, surface/broad/wide gradients, `bakedFields`
and nearest fields, route protection, paint/style/rock-slot masks, material
and weather fields, Time maps, rim/shore/soft-bank fields and rock source/
debris fields. `sunChord` and `shadowBlocker` still sample these cached
heights/surface fields when absorption or shadow tint is enabled. Placement,
water, shores, ice and procedural skin/bed/mineral functions call the same
helpers. The `voxel*` functions still reachable by F are procedural math,
2D mask/height reads, or the stored slope accessor, not solid sampling.

The direct texture readers, including indirect callers, are `fragmentMain`,
`rockSlotAt`, `terrainNoise`, `baseHeight`, `bakedFields`,
`bakedFieldsNearest`, `materialFieldAt`, `weatherAt`, `paintCoverage`,
`rockFieldAt`, `landPlace`, `voxelRelief`, `timeMap2`, `timeMap3`, `genColor`,
`groundTile`, `drawMineralMargins`, `joinSedimentTransition`, `debrisSlotAt`,
`palettePattern` and `paletteColor`. The JSON lists every operation and
resource; `rockFieldAt(t,...)` receives rock weather/source/rim textures.

Retained bindings are group 0's uniforms (including recipe/placement tables,
frame coordinates, availability and seven GPU-written flags), height, noise,
weather/material/Time array, baked fields, masks, rock weather/source/rim and
two samplers; group 1's ground, palette and generated materials; and group 3's
record plus frame dimensions. The routes upload and loose mask are not read
by F, but the prototype conservatively leaves their allocations in place.
No CPU copy of GPU terrain work is added.

## Record memory

Fourteen scalar f32 values use **56 bytes per raster pixel**, without vec3
padding or quantization. A one-pixel apron on all sides preserves derivative
helper pixels, including odd tile edges. A native 128×128 tile records
**946,400 bytes** (0.903 MiB); its temporary 4-byte raster attachment adds
67,600 bytes. Frame dimensions use 16 shared bytes. The chunk estimate counts
the 60 bytes per apron pixel and checks texture and storage-binding limits;
zoom-level refusal uses the existing memory fallback. Actual allocations
are in the renderer ledger and are discarded by its ordinary eviction.

**Calculated:** 1728×1024 visible pixels alone require **94.5 MiB** of
records, above the plan's 57–85 MiB estimate. Retaining all 35 current
256-pixel tiles intersecting the measured (2048,2300) view would require
**124.4 MiB**, including their off-screen portions and aprons, before any C
inputs. This cache has not been built. The sampled Modern Green tile keeps
40.8 MiB of ledger resources after destroying D; 34.2 MiB is known bound
height/weather/mask/surface/rock/material/uniform input. These are prototype
lifetimes, not a proposed per-tile C atlas. Noise, palette and generated
material allocations and driver overhead are additional shared costs not
fully represented in that existing ledger. Budget integration and dropping
records before useful page inputs remain build work.

## Native equality and cost

Dawn/Metal, map16, 128×128 native crops. Ambient changes to 0.51; Green 7's
water-only crop instead changes the existing deep color to (0.9,0.12,0.07),
because ambient changes zero pixels there. Features-on sets whole/large
blocks, fresh/rind, wetness, lamina, absorption, colored shadows, cavity and
close shadows before baking. The Green 7 crop exercises water, not a visible
rock face. These four fixtures do not cover all worlds or all stage-F rows.

| Scene | Features | Warm API ms | Warm GPU ms | Full rebuild ms | Warm/full differing pixels | Split/main differing pixels |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| green-modern-2 | defaults | 1.31 | 0.39 | 33.91 | 0 | 3502 / 16,384 |
| green-modern-2 | on | 1.21 | 0.39 | 36.81 | 0 | 3587 / 16,384 |
| green-2 | defaults | 1.15 | 0.20 | 23.16 | 0 | 5192 / 16,384 |
| green-2 | on | 1.01 | 0.33 | 28.61 | 0 | 6754 / 16,384 |
| red-3 | defaults | 1.08 | 0.39 | 16.10 | 0 | 350 / 16,384 |
| red-3 | on | 1.01 | 0.26 | 14.58 | 0 | 214 / 16,384 |
| green-7 | defaults | 0.89 | 0.20 | 19.08 | 0 | 0 / 16,384 |
| green-7 | on | 1.01 | 0.33 | 25.06 | 0 | 0 / 16,384 |

Every split/parent crop is also exactly equal: **zero new split drift** in
these samples. The main differences above already exist in the retained LP6
work. The external `terraform-lp6/lp5-step0-1x.png` review sheet shows main,
pre-LP5 and split at 1x. **By eye:** the last two columns match; the earlier
LP6 Green face changes remain visible and still need the owner's review.
Warm GPU timestamps have 0.065536-ms quantization; these small kernel numbers
must not be treated as precise whole-view predictions.

A closed wetness gate crossing (0 → 0.7) also equals a full split rebake
exactly. A mixed world/slot-2 recipe crop, 131×129, matches at **zero differing
pixels** with 64- and 256-pixel tiling. The same probe rejects a rock-shape
edit rather than using stale geometry. No pixel tolerance was increased.

## Browser checks and scoped performance

Chrome 157, own servers, distinct CDP ports, earlier discarded server
warmups; `ps` checked and three consecutive driver GPU samples ≤20% before
each measured session. One sequential baseline/split pair, map16 translated
Modern Green 2, terrain **1728×1024 at (2048,2300)**, 2048 MiB requested and
effective. Both runs use the same 40-move real mouse stroke. This pair checks
full-render cost, not color routing. Times are ms, p50 / p95 where sampled.

| Endpoint | Before split | Split |
| --- | ---: | ---: |
| First stroke tile | 56.1 / 119.2 | 52.3 / 143.5 |
| Pointer tile / first changed pixels | 72.0 / 168.8 | 68.1 / 149.7 |
| Whole current view | 72.2 / 168.8 | 68.2 / 149.7 |
| Release → focus final (one sample) | 620.7 | 564.7 |
| Release → view final (one sample) | 2864.4 | 2780.2 |
| Release peak GPU ledger MiB | 809.0 | 836.1 |
| Load peak GPU ledger MiB | 763.6 | 871.5 |
| Release longest queue wait | 74.8 | 74.2 |
| Release longest submission | 72.7 | 72.4 |

**Measured:** no final slowdown in this pair (2.9% lower view-final time),
but first-tile p95 gets worse and memory rises. This is not a repeatable
speedup or complete LP5 acceptance. rAF p95 stays 16.7–16.8 ms, with a
33.3-ms split release maximum; no long task exceeds 50 ms. Release bitmap
copy p95 is 0.2 → 0.1 ms; no new specialized set or actual pipeline call
occurs during release. One new specialized bake set occurs during each
drag. Startup has two extra geometry pipelines by inspection; the differing
warm driver caches make these boot times unsuitable for a cold-compilation
claim. Complete per-phase pipeline records and off-screen/mixed GPU timings
are in the compact JSON.

The split page's final view equals a fresh replay: **0 / 1,769,472 pixels**
differ. A separate **scripted current-tile API** probe in Chrome changes
2,435 pixels, submits only `cached terrain color`, and equals a full rebake
at zero differing pixels after destroying D. Its API wall time is **1.2 ms**
for the native 128×128 tile. It is neither a mouse-driven slider result nor
proof of the 150-ms final-quality whole-view target.

Twenty-two focused stage, gate, renderer and memory/preview-plan unit tests,
syntax checks and the targeted native/browser probes pass. Error logs are
empty. Export encoding, every-world/control sweeps, low-memory cache stress,
and the full LP0 matrix remain on demand; no cache/routing implementation is
being accepted from these small probes. No benchmark enters `repro/check.sh`.

## Stage-F rows and stopping point

LP1's historical ten-world map contains **130 exclusively stage-F World
rows out of 249**, plus one mixed C/F row that must not skip C. The names
below are taken directly from that map, not inferred from the ambient probe.
They are a routing candidate inventory, not a claim that all 130 were
validated by this experiment. The current computed shader map remains
conservative across gates; no name-based row whitelist is added.

`groundTiles`, `groundContrast`, `groundPatch`, `groundPatchSize`, `lowTint`, `lowReach`, `lowGrain`, `flatShadow`

`flatOcclusion`, `lightCap`, `shadeDepth`, `ambient`, `creaseShade`, `soilRim`, `wetGround`, `hillLight`

`ringFade`, `faceFill`, `rockCrown`, `slopeTexture`, `moss`, `slopeMarks`, `shineStretch`, `shineWhite`

`shineGround`, `shineGroundSharp`, `shineGroundRough`, `shineGroundScale`, `shineSlope`, `shineSlopeSharp`, `shineSlopeRough`, `shineSlopeScale`

`shineRock`, `shineRockSharp`, `shineRockRough`, `shineRockScale`, `shineOutside`, `shineSand`, `shineSandSharp`, `shineSandRough`

`shineSandScale`, `shineCrystal`, `shineCrystalSharp`, `shineCrystalRough`, `shineCrystalScale`, `sandDust`, `sandGrass`, `sandLight`

`sandGrain`, `crackDark`, `bandWater`, `strata`, `strataContrast`, `strataGrain`, `shallowDepth`, `deepDepth`

`waterSoft`, `crispShore`, `deepEdge`, `bedTint`, `bedBright`, `bedContrast`, `shoreEdge`, `bankRock`

`paletteMix`, `dither`, `landDither`, `baseBand`, `baseBandLow`, `baseBandHigh`, `baseBandWander`, `baseBandGaps`

`desertCapFlat`, `faceRock`, `faceGrass`, `runoffStain`, `absorbDepth`, `shadowTint`, `faceShade`, `faceTone`

`faceFresh`, `faceRind`, `faceRindDepth`, `faceRindTone`, `faceRindWarmth`, `faceRindRough`, `faceMineral`, `faceStrata`

`faceWet`, `stepSoftPx`, `shelfWander`, `bedFlat`, `shoalRag`, `shoalStairs`, `shoalShoreSoft`, `ringContrast`

`ringCount`, `ringSize`, `ringShift`, `ringShiftDir`, `ringScatter`, `ringWobble`, `ringLobe`, `ringFill`

`ringPatch`, `ringPatchSize`, `ringTone`, `lavaDusk`, `layerCrease`, `shineSlopeGate`, `shineGate`, `shineHeadroom`

`pockmark`, `pockSize`, `moonCups`, `moonCupSize`, `moonCupDepth`, `cupStretch`, `moonRibs`, `moonRibDepth`

`moonRibDark`, `moonFolds`, `moonFoldSpacing`, `iceCrystal`, `gougeWeb`, `iceCrest`, `iceSnow`, `iceFall`

`iceApron`, `iceFrost`.

Step 0 stops here as the plan specifies. Remaining LP5 build work is a
budgeted visible-tile record and C-input lifetime design, record-first
eviction, complete invalidation keys, stage-F control routing at scheduler
priority 3, mouse-driven final-quality whole-view timing, and scoped export
art/equality verification. The split is retained for review on the same
branch; main, preview publication and deployment are unchanged.

Reproduce the small native checks on demand:

```sh
node repro/color-split.mjs --server http://127.0.0.1:<yours> --out /private/tmp/lp5
# Only odd edges, mixed recipes and the geometry-edit guard:
node repro/color-split.mjs --server http://127.0.0.1:<yours> --out /private/tmp/lp5 --edges-only
```
