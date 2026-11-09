# Rock weathering review

Branch `rock-weathering`, extending `rock-controls` at `fd93442e` (main base
`13d74571`). Preview: `http://127.0.0.1:8906/sculpt`. Not landed on main.

## Result by eye

The authored cliff now has a visible apron of mineral fines and loose blocks,
with smaller material toward the toe. Sheltered feet accumulate more than
walls. Connected runoff ribbons cut and darken the rock, with wet highlights
following the same field. Clay view shows actual relief in the channels,
bedding, stones and accumulated bed. The overall shapes and lighting read
closer to the supplied references, but this is not a claim of matching their
hyperrealism. Richer fracture-controlled source blocks, multiple deposit ages,
and source-bed-specific sediment colors remain worthwhile follow-ups.

The existing editor gains eight continuous controls and exposes the existing
stone sorting parameter. They use the same world settings, history, presets,
map recipe, autosave, share payload and exporter. No new page or renderer.
Green's generated base texture and default weathering amounts are preserved.
Select Layered sandstone in World → Rock & cliffs to try the active settings.

## Measured controls and integration

`repro/rock-weathering.mjs` renders an authored 512×512 cliff at 1x. The class
is the 41,107 pixels changed by enabling runoff and debris. Range sweeps change:

| Control | Weathered class changed |
| --- | ---: |
| Runoff exposure | 43.7% |
| Catchment variation size | 31.4% |
| Channel concentration | 25.0% |
| Channel incision | 29.8% |
| Mineral staining | 28.7% |
| Cliff debris accumulation | 76.3% |
| Rockfall reach | 74.8% |
| Accumulated bed thickness | 58.2% |
| Size sorting | 28.9% |
| Existing loose-stone size | 34.9% |

Every row exceeds 5%. All five geological presets and the fourteen existing
rock geometry/PBR controls also pass with the new weathering enabled. At zero versus 0.0001, amplitude sweeps change mean maximum
RGB-channel difference by 0.0001–0.0752 of 255. Different 128/256-pixel render
partitions at 96 MiB give **0 different pixels**. Gameplay heights have **0
changes**. Flat ground without a higher source has **0 changed pixels** from
debris. Sparser scatter changes 29.8% of the weathered class; Deposits less
changes 76.5%, confirming the existing paint tools control the new material.

The world control sweep passes all nine new/exposed rows with no unexplained
zero and no row moving while disabled. Shape and Green geology sweeps pass.
The browser check covers all nine slider undos, preset Undo/Redo, exact
save/load and autosave/reload pixels, invalid-load atomicity and parent gates.
The final quick tier passes: 163 unit/static-site tests, world-name gate,
34 scene comparisons, regional replay and voxel regressions. Compared with the
previous branch, 32/34 default images are byte-identical; Green-2 changes two
pixels and Green-modern-2 one, from floating-point shader evaluation. Against
main, the earlier rock controls plus this change leave 31/34 images exact:
Green-2 changes two pixels, Green-4 thirteen and Green-modern-2 three. All 34
gameplay-height files are byte-identical to main. The retail scores below do
not change. Authored hover previews were regenerated (14 tools, 147 frames);
two PNGs have pixel-rounding changes.

With sandstone runoff/debris enabled, a 4×4 landform map exports twice to
identical bytes. Native and WebAssembly UFO/PNG hashes match: 25 rendered
chunks, 3,698 unique tiles, no merging. No console errors.

## Measured performance

Two alternating Chrome runs per build, identical authored 4×4 scene and active
runoff/debris query, 1208×841 visible map pixels at 1x, default weather enabled:

| Build | Drag frame p95 | Final after release |
| --- | --- | --- |
| Previous rock controls | 16.7 / 16.8 ms | 1.47 / 1.64 s |
| Runoff and debris | 16.7 / 16.8 ms | 2.23 / 1.52 s |

Both maintain about 60 FPS during the scripted drag. Mean release time is
1.56 → 1.87 s (+20%); the first weathering run is slower, so the range is
reported rather than treating the faster run as a guarantee. Full refinement
is asynchronous after the drag. This is not a claim that full-quality voxel
reconstruction runs at 60 FPS.

## Measured preservation

Green retail window shape/look gaps before → after (lower is closer):

| Window | Shape | Look |
| --- | --- | --- |
| Green-1 | 0.24 → 0.24 | 0.12 → 0.12 |
| Green-2 | 0.16 → 0.16 | 0.18 → 0.18 |
| Green-3 | 0.10 → 0.10 | 0.09 → 0.09 |
| Green-4 | 0.59 → 0.59 | 0.29 → 0.29 |
| Green-5 | 0.18 → 0.18 | 0.60 → 0.60 |
| Green-6 | 0.23 → 0.23 | 0.10 → 0.10 |
| Green-7 | 0.19 → 0.19 | 0.11 → 0.11 |
| Mean | 0.24 → 0.24 | 0.21 → 0.21 |

Modern Green's height realism remains 8.12/15 statistics within the real range
on average over 17 windows. Six gate pass counts remain: closed basins 17,
fabric 15, hilltop roundness 8, Hack exponent 5, hollows 17, valleys 17. All
23 existing failures are unchanged. Maximum slope p90 remains 0.742. This
iteration changes surface art, so it does not fix those terrain-height gates.

Artifacts and logs: `/private/tmp/terraform-rock-weathering`. The transport
field inspection is test-only. No retail art or reference images are committed.
