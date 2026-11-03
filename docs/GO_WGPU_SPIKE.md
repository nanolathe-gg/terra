# Go / wgpu port spike

Worktree: `/Users/daniel/src/terraform-wt-go-wgpu`  
Branch: `prototype/go-wgpu`  
Original comparison baseline: `92df846a9fa076021b9f740d04883ee906259b13`  
Concurrent main merged: `dfee4b49cba5473003da7ed3448ba486b3fedad7` (Landform), via `db956cb`

This branch replaces the Python server and JavaScript editor implementation
with Go. The browser retains the existing HTML/CSS UI, driven by Go WASM. A
separate Go WASM Worker runs the shared wgpu terrain pipeline. The native Go
CLI uses that same pipeline to export without a browser. The branch has not
been merged into main.

## Try it

The current session's test server is at <http://127.0.0.1:8891/sculpt> while
its process is running. To rebuild and start another instance from this worktree:

```sh
cd /Users/daniel/src/terraform-wt-go-wgpu
ASSETS_ROOT=/private/tmp/terraform-wgpu-run/assets PORT=8892 ./run.sh --prepared
```

The prepared assets root uses private installed-content catalogs; no retail
pixels or maps are committed. For a fresh root, omit `--prepared`; the helpers
read the installation at `~/TotalAnnihilation` without writing there.

For a native Metal export after building the helpers:

```sh
go run ./cmd/terraform \
  --assets-root /private/tmp/terraform-wgpu-run/assets --prepared \
  --scene repro/recipes/native-hill.json \
  --out /private/tmp/terraform-native-morning
```

Use a fresh output directory. The command prints the actual adapter/backend
and writes the archive, indexed PNG and height data. A recipe saved from the
browser can replace the included synthetic hill fixture.

## What changed

- `internal/model`: deterministic paths, curves, controls, material data,
  features and graph rules, with Go regression tests.
- `internal/terrain`: one shared wgpu shape → ground → time → surface → light
  pipeline using the existing WGSL and material tables.
- `internal/editor`: Go DOM events, canvas overlays, controls, selection,
  history, persistence, documents and export coordination.
- `internal/editorworker`: separate browser runtime for terrain preparation,
  GPU rendering/weathering, feature fills and PNG encoding. Latest requests
  replace queued stale work; bounded tasks yield and can be canceled. GPU ImageBitmaps
  transfer back to the UI for ordinary views; RGBA byte readback is reserved
  for captures and exports. Picking heights and other small data transfer
  separately. Image admission acknowledgments and GPU fences
  bound outstanding work; export waits for each chunk upload before producing
  another.
- `internal/server` and `cmd/terraform`: Go HTTP/configuration/documents/export
  service and native renderer. The server binds to localhost.
- `web/`: minimal runtime bootstraps. Go's generated WASM support script and
  built WASM files are ignored, rebuilt by `run.sh`, and served compressed. Final stripped UI and worker binaries are
  7,731,027 and 14,828,252 bytes; gzip sizes are 2,036,561 and 3,802,839 bytes.

```mermaid
flowchart LR
  UI[Browser: Go UI] <-->|Jobs and results| Worker[Dedicated browser Worker: Go terrain]
  Worker --> WebGPU
  CLI[Native Go CLI] --> Metal
  Engine[Shared Go engine and WGSL] -.compiled into.-> Worker
  Engine -.compiled into.-> CLI
  UI -->|Streamed export chunks| Server[Go HTTP server and exporter]
  CLI --> Exporter[Go exporter]
```

The two browser runtimes have separate event loops. Goroutines within either
WASM runtime are cooperative work, not a substitute for a background browser
thread. DOM/input stays in the UI runtime; expensive terrain work stays in the
Worker. The native entry point opens no browser.

Ordinary rendering keeps authored fields, weather, and display pixels on the GPU.
The worker presents through an OffscreenCanvas and transfers an ImageBitmap,
without mapping RGBA into WASM memory. Typed graph snapshots and sequence-checked
changed-suffix messages avoid repeatedly serializing unchanged strokes. Prepared
shape nodes and unaffected GPU pages are reused. Height-only
queries omit color/relief targets and do not read all 31 authored planes. GPU
page caches and UI tiles have byte budgets. Picking heights have coverage tracked
independently of displayed images, so cached-image revisits can refresh evicted
height data without rebaking the images. Large maps preserve main's actual
512-cell weather cores and 128-cell apron. Small maps preserve the global
weather solver. No CPU terrain renderer or alternate old implementation is
retained.

The old runtime Python, application JavaScript and obsolete injected-browser
harnesses were removed. Node remains for browser automation. Python remains
for active offline retail/image analysis, such as comparison sheets.

Main advanced during the run with the Landform integration. Its new shader,
paired front/back section curves, along-path height curve, elevation/combine
modes, spurs, variation controls and terrace breakup are included in the Go port.
The whole-section editor and map section marker follow that integration.

## Dependency decisions

[`gogpu/wgpu`](https://github.com/gogpu/wgpu) is pinned to v0.34.7,
`a7b9b6e85d5d3765b443f2870249d37c31066fe4`. Its production source is vendored with
browser error scopes and uncaptured-error forwarding implemented; the upstream
methods were stubs. [PATCHES.md](../third_party/wgpu/PATCHES.md) records the
changes and native texture-tracker workaround. Native macOS explicitly selects
Metal and fails if unavailable.

[`gogpu/ui`](https://github.com/gogpu/ui) was evaluated but not adopted. Its
current native drawing dependencies (evaluated at
`4d78f0d03a87c5c48bb66d3dc34f625de43067d0`) do not compile for `GOOS=js GOARCH=wasm`.
Keeping the existing HTML/CSS layout under Go preserves the primary browser UI.
A standalone native window UI is not included; native Go rendering/export is.

## Measured verification

All numbers below are measured on this Apple M3 Pro machine unless explicitly
labeled otherwise. These are spike measurements, not claims about other GPUs.

| Check | Result |
| --- | --- |
| Original browser vs Go browser, 27 retail comparison scenes | 0 changed RGBA pixels across all 27 1024×1024 renders (28,311,552 pixels). `compare.py --worlds none` passes. |
| Repeat render | 0 mismatch pixels in every final scene; no browser console errors. |
| Authored field parity, same Chrome | All 27 scenes × 31 planes at 513×513 match the original exactly, including masks. |
| New Landform scenes | Three scenes match current main: 0 changed RGBA pixels, all 31 planes at 513×513 exact, regional/repeat mismatch 0. |
| Regional replay | Whole/repeated/four-region authored replay has 0 mismatches across all 27 scenes. |
| Brushes and undo | 144/144 cases pass across nine worlds (16 brushes including Landform); 8×8 Green passes paged draw/undo, and all 16 brushes pass on a 40×40 Green map. |
| Curve editing | 92/92 checks pass across Green and Desert, including legacy and Landform forms, bilateral/along curves, selected edits, undo and GPU parity after autosave/reload. |
| Browser export | All eight exportable worlds pass at 4×4; Green 8×8 exports 17,436,672 art pixels with 0 clamped height cells. Zhon remains intentionally unavailable. |
| Memory controls | At GPU/heap 128 MiB, a 256×256 render changes 0 pixels; cache 8,704,208 bytes ≤32 MiB. A 96 MiB image job is refused against 64 MiB worker space; restoring budgets changes 0 bytes. |
| Large-map zoom | 8×8 zoom/restoration passes; edited 256×256-cell regional replay compares 3,211,264 packed bytes with 0 differences. |
| Native Metal | Hardware suite passes, including nine material worlds, cached weather, regional seams and height-only rendering. |
| Native browser-free export | Adapter reports `Apple M3 Pro (Metal)`; two runs produce identical `.ufo`, indexed PNG and `heights.json` bytes. |
| Native platforms | CLI cross-compiles without CGO for macOS amd64, Linux amd64/arm64 and Windows amd64; runtime tested only on this Mac. |
| Go tests | Full suite and model/budget/queue/server/CLI race checks pass. Native and WASM-specific `go vet` pass. |
| World-name gate | Production Go terrain engine and WGSL pass. |

The final Landform CLI export also reports `Apple M3 Pro (Metal)` and is in
`/private/tmp/terraform-go-opt/native-landform-final`. Native Hill repeat evidence is in
`/private/tmp/terraform-go-opt/native-final-a` and `native-final-b`.
SHA-256 of the archive is
`9960e78a5a4b1b30e9bdd4cb77ab44ff7245919d9dc695171556c7936a984d49`;
the indexed PNG is
`ff3d0e888325ff15007b23bb3cf15da08ab77936edaed4ead1f25af9d9401fef`.

The original scene evidence is under `/private/tmp/terraform-wgpu-run/before`.
The optimized final-source rerun is `/private/tmp/terraform-go-opt/final-scenes`,
with `final-scenes.log`, `final-scene-comparison.log` and the exact RGBA counts
in `final-pixel-comparison.json` alongside it. Final
native hardware, race and vet logs are also in `/private/tmp/terraform-go-opt`.
The earlier broad controls/export/curve evidence remains under
`/private/tmp/terraform-wgpu-run`; those suites were not all repeated after every
optimization. These private artifacts are intentionally outside git.

## Independent review

An independent reviewer examined export lifecycle, native recipe validation,
feature placement, canvas/path gestures, history, autosave and cleanup. Fixes
include canonical geometry validation before GPU allocation; synchronized
helper stderr and shutdown; isolated job directories and crash cleanup; fresh
worker heights for fills; shared path anchors and frozen screen-space selection
drags; undo scoped to document edits; preservation of failed autosaves; and
persistence of view/seed preferences.

The review also added deterministic yielding during large feature sorts and a
one-hour idle reaper for abandoned export jobs. Active uploads/helper exchanges
are protected from expiry. Race tests cover cleanup, refresh and shutdown;
feature ranking retains the prior 1,810-placement output exactly. Cross-review
of the new Landform UI corrected default-curve serialization and the tool icon.
Authored ghost samples include offscreen terrain: 443 points are returned, and
four independent GPU interpolation checks differ by 0.0.

Browser export cancellation passed during start, chunk upload and finish. Each
returned cancellation, restored the editor, left zero temporary jobs and had
zero console errors. The observed checks took 1.03–1.26 seconds including a
one-second cleanup observation. Dedicated tests cover the paths, feature draw
ordering, curve reload and export cancellation.

The long audit exposed a cancellation deadlock: a passive Landform ghost job
could replace an awaited capture without replying. Foreground RPCs now block
passive sampling, and every canceled/dropped awaited job gets a terminal reply.
RPC images are never marked as viewport tiles. A browser regression holds a
capture for 800ms: it completes, no ghost request interrupts it, both explicit
cancellations are acknowledged, and the console has 0 errors.

The optimization review also examined graph-delta sequencing, cache invalidation,
height-only picking, bitmap admission, canceled-job fences and GPU ownership.
Findings were fixed: graph baselines update before coalescing; picking coverage
is independent of images; transferred images are admitted before another
allocation; canceled work is fenced even before its first bitmap; cache ownership
lasts through submitted uses; Time/material scratch waits match the original.
The final independent code review reported no unresolved findings. A separate
report review checked timing values/counts, source revisions and binary sizes;
its data-transfer wording correction is included. These reviews do not certify
total physical GPU memory or untested platforms.

## Controls and performance

The completed nine-world audit has 4,638 rows and 0 unexplained findings,
0 hidden-but-moving controls, 0 restoration leaks and 0 console errors. It
includes 1,145 enabled-world checks, 691 gated-world checks, 2,727 stroke checks,
13 surface-slider checks, 53 checks with distinguishing colors, and nine final
restoration checks. Of the gated rows, 189 could not be measured because no ordinary knob combination clears their gate;
these are not claimed as measured zero-impact results.

Green and Red's original full reports predate the fixes below. The qualified
aggregate replaces only the affected rows with targeted retests of the final
code and removes a hidden legacy slider that main also excludes. The other
seven worlds have complete passing runs. Raw reports and exact replacement
provenance remain in
`/private/tmp/terraform-wgpu-run/control-final/resolved-summary.json` and
`resolved-world-controls.json`. Full-frame 1024×1024 control diagnostics use
1024 MiB GPU and 2048 MiB heap budgets; ordinary editing and export were tested
at their default 512 MiB GPU budget. The stricter renderer guards correctly
refused diagnostic workloads exceeding that default.

The shape-control sweep passes; all nine new Landform controls move 32.4–82.3%
of 16-pixel blocks on the authored Green fixture, above the 5% threshold. This
impact fixture is separate from the three retail windows.
The sweep found and fixed a hidden slope-shine activation bug; the targeted Red
retest has 0 unexplained controls. It also caught and fixed Undulation failing
to create the initial ground stroke; the final focused test changes 233,828 pixels
and restores the scene with 0 leaked pixels. New ground also uses the displayed
scale/coverage instead of main's fixed 160/.5 creation values. Undo/redo
synchronizes only those three ground controls with the restored stroke graph;
the custom 8/296/.25 fixture restores identical authored GPU bytes.

The initial port had a substantial terrain-feedback regression. The subsequent
optimization and corrected direct comparison are documented in
[GO_WGPU_PERFORMANCE.md](GO_WGPU_PERFORMANCE.md). The earlier timing table has
been removed because it predates GPU bitmap presentation, typed graph reuse,
Worker delta transport, matched drag quality, and the corrected measurement of
actual new bitmap presentation. Its figures should not be used to assess the
current branch.

An erosion dispatch optimization preserves shader results while replacing 1,200
pass/group creations with one compute pass and four reusable bind groups. On a
200-age, 33×33 fixture, alternating runs measured unbatched 257.1/254.6/258.4ms
versus batched 30.8/25.5/25.1ms (10.1× median improvement). This microbenchmark
is separate from complete editor interaction performance.

A same-recipe browser/native comparison has exactly matching 1,360 height
cells. Indexed art differs in 5/348,160 pixels for Hill and 41/348,160 pixels
for Landform. A separate unsnapped Hill diagnostic differs in 78 pixels / 82
channels, at most 1/255 per channel; this is consistent with compiler rounding.
Browser TNT bytes repeat exactly; native archive, PNG and heights repeat
exactly. Cross-backend bit identity is not claimed. Artifacts are under
`/private/tmp/terraform-parity-review`.

By eye, the whole-section/along editors, ghost curves, map marker and restored
Landform icon match the current interface. A manual draw in the final Go editor
produced the expected raised, textured landform. The screenshot is
`/private/tmp/terraform-landform-review.png`.

Runtime verification is limited to Chrome WebGPU and native Metal on this Mac.
Cross-compilation is not runtime validation. Native and browser floating-point
intermediates can differ slightly across GPU backends; determinism is verified
within the same machine/backend, not promised across all hardware. A full
40×40 map export and every other browser/OS combination have not been measured.
