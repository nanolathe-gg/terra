# LP5 exact color-mask packing, November 13

**Keep the packed representation.** This follow-up to e09f88ae stays on
`live-preview/lp6`; main remains 580d0fbb. Color retains twelve mask channels
in **three RGBA8 SNORM layers instead of seven**, with unchanged dimensions
and filtering coordinates. The sampled render/export art and filtered
signed-channel values are exact. [Compact evidence](LP5_MASKS_METRICS.json)
preserves both builds' page endpoints, censoring, pipeline calls, GPU work,
queue/submission waits, memory, and the focused correctness results.

## Representation and working memory

The color shader reads these logical channels:

| Packed layer | Channels from the original masks |
| --- | --- |
| 0 | Rock, snow/ice, wet ground, moss (planes 0–3) |
| 1 | Relief style, deep-water edge, deposits override, vegetation override (5, 10, 15, 16) |
| 2 | Exposure override, surf, river bed, rock preset (17–20) |

The common logical-mask accessors reconstruct the original values for F.
Geometry, Time and surface baking still read the full authored masks. A
source dependency check rejects new F reads of omitted channels or raw masks.
There is one staged render path, no world-name branch, artist control or
retained alternative shader. No precision reduction or coordinate change is
introduced. SNORM -128 and -127 both sample as -1; packing may canonicalize
that storage byte while preserving the sampled value exactly.

E completes all pieces before F. Since F has no solid binding, D's buffers
are released before packing. The pack runs in place in the working mask
texture after geometry has finished reading it. The next full chunk always
refeeds the working textures, as the existing capacity-only workspace does.
A retained record gets a copy of just the packed three-layer prefix; its
height, weather, surface and rock inputs still transfer ownership. A small
zero array satisfies F's unused raw-mask binding; the dependency check makes
an accidental raw read fail.

A bounded staging buffer uses as few row bands as the available solid
reservation/storage-binding limit allows. Bands and copies share one encoder;
there is no CPU readback or queue wait per band. Odd widths use the required
256-byte copy-row padding. All scratch/settings objects and compact copies
are tracked. The estimate uses **max(D, pack staging)**, because those phases
release their working buffers before the other allocates. A retention copy
checks actual room before allocation.

An initial version allocated a full packed texture and staging buffer beside
D. It was pixel-correct and faster on the default-budget color probe, but
broke the existing low-sun fixture's 128-MiB startup trial. It was rejected,
not excused by raising the test budget. The phased in-place version passes
the original fixture. Sharing entirely empty masks was also tried first;
all eight sampled color-input arrays contained paint, so that strategy did
not address this workload and its source was discarded.

## Memory and scope

**Measured:** the two retained native tiles in each fixture use:

| Fixture | Previous MiB | Packed MiB | Reduction |
| --- | ---: | ---: | ---: |
| Modern Green 2 | 70.09 | 54.09 | 22.8% |
| Green 2 | 41.86 | 33.86 | 19.1% |
| Red 3 | 70.15 | 54.15 | 22.8% |
| Green 7 | 41.86 | 33.86 | 19.1% |

The mask array itself shrinks **57.1%** (28 → 12 bytes per input texel).
With the same optional quota, the large page retains **18 records instead
of 13**, 38.5% more. Total retained cache bytes are 765.8 versus 762.7 MiB:
the saved space admits more records rather than lowering the chosen quota.
This is still partial coverage of the 35 visible native tiles. No cache is
retained at 512 MiB and below, as in the previous unit.

## Focused browser pair

Chrome 157, map16 Modern Green 2, terrain **1728×1024 at (0,300)**,
2048 MiB requested/effective. Own servers/CDP ports, fresh-server warmups
discarded, `ps` checked, three consecutive GPU-driver samples ≤20% before
runs. Sequential alternating builds; one final implementation/baseline pair
after correcting working memory. Each real mouse drag delivers 36 values.
Times are ms, p50 / p95; release is the final anchor, not the maximum of
mid-pause and release samples.

| Workload / endpoint | Previous cache | Packed masks |
| --- | ---: | ---: |
| Ambient continuous: first changed pixels | 3.2 / 55.2 | 3.6 / 44.5 |
| Ambient continuous: whole current, any level | 3.2 / 104.7 | 3.6 / 77.1 |
| Ambient continuous: release → final | 965.8 | 795.2 |
| Ambient pause: first changed pixels | 3.6 / 99.9 | 3.7 / 106.2 |
| Ambient pause: whole current, any level | 3.6 / 116.6 | 3.7 / 121.0 |
| Ambient pause: release → final | 1005.7 | 761.9 |
| Crease shade cold gate: first changed pixels | 3.2 / 44.1 | 3.6 / 65.4 |
| Crease shade cold gate: whole current, any level | 3.2 / 92.7 | 3.6 / 115.5 |
| Crease shade cold gate: release → final | 981.2 | 797.7 |

**Measured:** release-final wait is 17.7% shorter for continuous ambient,
24.2% for paused ambient, and 18.7% for the cold gate in this pair. Both
pause anchors complete in each build (no censored final). First-change p95
meets 50 ms for the continuous workload but worsens for paused and cold-gate
workloads. The **150-ms final-quality whole-view** target remains unmet;
a quick coarse answer is not that endpoint.

Load final is 2581.4 → 2615.9 ms (+1.3%). Load peak GPU ledger falls
1400.6 → 1352.2 MiB; continuous peak is effectively flat, 1445.6 → 1448.7,
and paused peak falls 1462.0 → 1449.9. These are application-accounted
bytes, not physical VRAM; existing untracked shared/driver costs remain.
rAF p95 is 16.7–16.8 ms and there is no long task over 50 ms. Continuous
queue/submission maxima are 54.2/52.2 → 55.9/51.6 ms. The new packing work
is **4.65 ms total across 18 passes**, at most 0.33 ms per pass, in that phase.
No new specialized set is compiled. Both builds make 35 existing compute
pipeline API calls in the continuous phase; the compact JSON keeps those
calls rather than equating zero specialized sets with zero pipeline work.
The new packing pipeline is prebuilt before input. No cold-compile claim is
made from this pair.

All first-tile, changed-pixel, pointer-tile and whole-current distributions
are retained separately. Pointer-tile samples are empty for sliders. The
JSON also keeps handler/callee, bitmap-copy and wholly-outside/mixed GPU
measurements. No broad LP0 matrix was run.

## Quick correctness

- Eight interleaved retained tiles on the four feature-enabled fixtures
  equal full rebakes exactly, and their hashes equal e09f88ae. No added
  split/packing drift in those samples. Earlier-stage edits still reject
  cached F reuse and pinned retirement still releases safely.
- A 5×35 signed mask fixture forces two in-place packing bands. All **240
  compared channel values** match the original texture's filtered samples
  exactly, including -128/-127, zero, positive extremes, clamped edges,
  subpixel UVs and samples on either side of the band boundary.
- The mixed world/slot-2 fixture, 131×129 pixels, matches at zero differing
  pixels between 64- and 256-pixel tiles, including its original low-sun
  128-MiB startup trial.
- Green 2 and Red 3 **128×128 export-art crops** equal the previous build
  byte for byte. Export archives/encoding were not changed or swept.
- Both default-budget candidate viewports equal fresh recipe replays:
  **0 / 1,769,472 pixels** differ, hash
  `9f6febf8d783d870ed2205f223fad4183e39b9a4c195ce0927acc166ffc12024`.
- The standard 512-MiB large-view startup also matches fresh replay exactly,
  retains zero color records, and peaks at **472.3 MiB** of GPU ledger.
  A separate wide-view Sun=25° case refuses the fixed 128-MiB export/chunk
  trial in **both e09f88ae and this build**. That existing refusal is
  recorded as a failed check, not presented as a pass or changed tolerance.
- Twenty-three focused CPU tests, including the packed-mask dependency
  guard, and syntax checks pass. GPU errors are empty in the passing probes.

The tiny packing proof is `repro/color-mask-pack.mjs`; the retained-tile
proof is `repro/color-cache.mjs`. Both require an explicit own server and an
output folder outside the repository. No dependencies or quick-runner
entries are added. Full-world/control sweeps and full export archives stay
on demand. Raw outputs are deleted after compact evidence is recorded.

## Next

The paused-input trace exposes an avoidable miss: the coarse block's color
record is discarded when the final view finishes. Resuming a drag then
rebuilds that block's geometry. Keep that record within the existing quota
as the next separate unit, then measure its input tail. Further C-input
sharing and final-quality whole-view acceptance remain open. Main is
unchanged; this source change requires fresh previews before any future push.
