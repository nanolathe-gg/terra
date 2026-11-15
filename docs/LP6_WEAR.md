# LP6 continuous wear rounds, November 13

This review unit follows the [closed-gate and march work](LP6_VOXEL.md) on
`live-preview/lp6`. It changes the numerical Weathering response and is
**for the owner's visual review before landing**, as R8 requires. The
[measurements](LP6_WEAR_METRICS.json) retain the page and small-window results.

## Change

Weathering now fades in successive rounds instead of always paying for four.
For value `t` from 0 to 1, round `i` has strength `clamp(4*t-i, 0, 1)`.
A fractional final round reaches full strength before the next starts, so
there is no hard visual switch at a quarter. The total requested strength
is still `4*t`; its distribution over the nonlinear rounds changes. At 0
and 1 the result matches the preceding build exactly in the checked crop.
Each round's diffusion coefficient stays within the existing stability bound.

The CPU schedules the maximum required by all addressable active rock slots;
the shader applies each point's own material strength. Mixed recipes may
therefore keep more rounds than one material needs. Near-surface filtering
remains the existing six-voxel band; this does not yet compact a surface-only
wear dispatch list.

Four 256-byte-aligned uniform regions hold immutable round settings in one
buffer. Each pass binds its own offset, and the final draw selects the
correct ping-pong buffer for odd as well as even counts. This adds **960
tracked bytes** and **zero compute pipelines**. Writing one uniform repeatedly
before submitting the encoder would make all passes read the last setting;
the separate regions prevent that bug.

## Measurements

Same page protocol as the voxel report: Chrome 157, own servers and distinct
CDP ports, warm-up discarded per fresh server, `ps` checked, three quiet GPU
samples at or below 20%, sequential alternating builds. Explicit 512 MiB,
map16, 1728×1024 terrain, translated authored strokes at (2048,2300).
One release sample per run; these pairs are scoped evidence, not a claim
that every scene is faster.

| Fixture | View final before / after | Focus final before / after | Wear GPU ms before / after |
| --- | ---: | ---: | ---: |
| Modern Green 2 | 3596.9 / 3616.3 | 602.1 / 589.2 | 468.2 / 364.8 |
| Green 2 | 4845.1 / 4761.2 | 1689.1 / 1675.0 | 286.6 / 77.6 |

**Measured:** wear GPU work falls **22.1% / 72.9%** across each release
phase (including the background ring). Visible whole-view latency is flat
on Modern Green (+0.5%) and **1.7% lower on Green 2** in this pair. Voxel
construction and Time still dominate, and both focus deadlines remain an
open issue overall. Native Dawn 512×256 window medians read **175.8 → 171.5,
72.1 → 64.1, 78.4 → 80.0, 111.4 → 105.3 ms** for Modern Green 2, Green 2,
Red 3 and Green 7. These are diagnostics under a 1024-MiB renderer budget,
not Chrome latency or a universal gain.

## Quick correctness and visual review

Fresh final replays match both candidate page views exactly: **zero of
1,769,472 pixels differ**. Four window repeats are exact; Green 2's strict
128/256-pixel tile comparison remains zero. Sampled gameplay-height hashes
are unchanged. Error logs are empty. The seven gate/stage unit tests and
JavaScript syntax check pass.

One 128×128 cliff crop checks 0, a small positive value, both sides of .25,
.5 and .75, and 1. The dispatch count is 0/1/2/3/4 as expected. Appending a
round at each boundary changes zero pixels for a .00001 increase; approaching
from below changes at most four pixels, with mean RGB difference at most
.0024 of 255. Zero to .00001 changes five pixels (mean .0034). This is
consistent with a continuous model sampled into half floats and pixels;
it is not a mathematical guarantee of pixel continuity. The odd-round crop
also repeats and matches a different tile size exactly. Delayed count delivery,
predicted allocation and forced overflow retain the same preview image,
with no unvalidated presentation.

**Measured art change:** the four default windows change 17,725, 7,568,
6,199 and 430 pixels, respectively, of 131,072 each. Most changed cliff pixels
move by more than eight channel levels. **By eye:** their 1× sheets show a
very similar overall look with different fine cliff detail. This is not
byte-preserving and awaits the owner's eye. No control sweep, realism run,
large export or broad integration suite was run.

An earlier zero-exposure/zero-strength early-return trial kept all four
images exact but showed no consistent native-window gain; it was discarded.
The retained round-count trial has a modest whole-view benefit, much smaller
than its isolated wear saving. The results do not add to earlier units'
percentages. The later [tile-size decision](LP6_TILES.md) retains 256-pixel view tiles;
shell compaction and final readback work remain open. LP5 has not started. No new benchmark enters `repro/check.sh`.
