# LP1: dirty-state model, 2026-11-12

**Status.** Implemented on the unified `live-preview/review` branch, together
with LP0c and LP4 step 1. Nothing landed on main. Focused page/CPU checks
pass; the broader scene/land gate is deferred under the owner's instruction
to keep checks simple and fast. This report does not claim that deferred gate
passed on the combined tree.

**Change [read].** `syncWorld` is the one writer for CPU-owned world
uniforms. Draw and bake retain only chunk availability and GPU-written
paint flags. Its byte comparison names changes using the real uniform
layout, including individual rock slots. A scan of actual preprocessed
WGSL follows reachable functions from the surface, solid, geometry, color
and Time entry points. It keeps static dependencies behind gates rather
than trying to infer the runtime branch. The current page computes **344**
field dependencies. Stage labels are conservative; no stage cache is skipped
in this card, and LP5's experiment must prove those later skips.

One native `serial` records changes, with `rev.B` through `rev.F` for
world-stage changes and a rectangle log for local lattice/preset work.
Final entries carry their serial, world revisions, shape revision, input
rectangle and level. `canvas.changed({stage,rect})` replaces setter wrappers,
`clear()` and the second invalidation from `markViewChanged`.
`sculptDebug.dirty()` returns the last input's fields, channels, stage,
rectangle and count of newly stale tiles. No UI was added.

**Other dependencies [read].** The explicit JavaScript channels are:

| Dependency | Earliest stage | Why |
| --- | --- | --- |
| Shape context and the ground node's settings | A | Changes the authored lattice |
| Time parameters, material-field parameters and weather enablement | B | Changes the Time lattice/maps |
| World column values read by Time | B | Copied world uniform input to Time |
| `ChunkTerrainRenderer.reaches()` | C | Changes each chunk's input and projection apron |
| Loose-mask supply, plants and maximum stone size | C | Chooses whether/how the loose pass runs |
| Runoff, debris, rim and shore gates | C | Chooses rock-weather work |
| Active rock slots | C | Changes the recipe mask and maximum reaches |
| Wear iteration count | D | Chooses voxel wear passes |
| Material textures | F, page reload | Existing ground/beach texture selection |
| Material placement table | F | Written and compared as `materialTable` |

The Time scan found nine column fields absent from the plan's original
C–F scan: `bedDip`, `bedDipDir`, `columnBeds`, `columnContrast`,
`columnCount`, `columnFirst`, `columnOrigin`, `columnSections` and
`columnWander`. The runner and scan reuse the same preprocessed sources.
Time's key includes only slot zero and the world's portion of the shared
column pools: editing a preset column cannot restart Time. Preset changes
invalidate the union of their strokes, grown by the renderer's actual bake
reach; the bounds include old and new positions/recipes. All other World
changes use the map. A no-op advances no counter and schedules no render.

**Rows [measured on CPU].** [Every World row](LP1_WORLD_ROWS.md) has its
computed stage(s), declared channels and rectangle policy. The table covers
all **247/247** historical row names from plan baseline `f3e126cd`, plus
`absorbDepth` and `shadowTint` added on current main: **249 rows × 10 worlds**.
These are one-step probes at each world's defaults, including disabled
rows. They make no GPU submissions. They account for the historical 36
unexplained rows as part of that full set; none is omitted from the table.
At modern Green's defaults, 238 rows move a uniform, eight use only declared
shape/Time channels, and three schedule no work: Undulation size, share and
art while no ground-undulation node exists. On the other nine sampled
world defaults, plant relief and flower density also leave the closed
plant model unchanged. Gates opened by other values can change those results.

**Basic correctness [measured].**

- **130/130** CPU uniform blocks match the earlier three writers exactly:
  ten worlds × initial state, five representative knob changes, colors,
  a preset, three draw-option states and two chunk-availability states.
  A repeated synchronization writes no world fields. All ten preset-column
  cases preserve Time's world-column key.
- **10/10** targeted unit checks pass in 61 ms. They cover shader call
  reachability, gated and nested uniform reads, per-chunk exclusions and
  the shared knob operation and the conservative unknown-input fallback. Injected main/review modules parse and their
  anchors pass; a missing Time-submit hook fails closed.
- In Chrome, four unchanged World rows advance **zero** serials, create
  **zero** bakes and stale **zero** tiles. An ambient change advances exactly
  **one** serial and reports stage F.
- A nonflat 128×128 Green-modern-2 window changes under a light adjustment
  and restores the identical SHA-256 when its value is restored. Console
  errors: **0**.
- On map16 with two distant preset strokes, the near recipe edit dirties
  a **1176×1394** input region, keeps the Time key unchanged and advances
  once. Repeating its value advances **zero** and reports zero stale tiles.
  Console errors: **0**.

These are focused checks, not an all-scene pixel count. LP0c's report gives
its six owner-approved sampling differences; LP4's independent report gives
its earlier 0/34 scene result. Neither substitutes for a combined scene
sweep. No extra pixel drift is claimed without that deferred measurement.

**Performance [measured].** [Two alternating pairs](LP1_TIMINGS.md) compare
main `99d976c5` with combined build `3d4c88b7`, at 1728×1024 terrain /
512 MiB. All **720/720** row inputs reach whole current, including all
**360/360** review inputs bound to native serials/revisions. No drag long
tasks or console errors were observed. Rock continuous whole-current p95
is **6194.9/6477.2 → 3912.5/3923.0 ms**; its release-to-final median is
**4607.2 → 2179.7 ms**. This is combined-branch performance, not an isolated
speed claim for LP1. The continuous rock drag's changed-pixel p95 regresses
from **43.8/45.1 → 256.8/257.1 ms**, exceeding main's spread. The larger
tiles finish the whole view sooner but delay early feedback. Whole-view
preview blocks in LP2 are still required; no live-preview budget is claimed.
The cold gate still compiles a pipeline set in both builds.

The three undulation rows that change no tracked input were also checked in
Chrome with distinct new values: **zero** serials, stale tiles and later
bakes, including after a 350 ms pause. Enabling undulation makes its size
row report stage A, a negative control. Chrome reports `deviceMemory=8`,
accepts an out-of-memory error scope around a **16-byte** buffer, and resolves
`device.lost` with reason `destroyed` when that probe device is destroyed.
This did not force real memory exhaustion. Safari's built-in driver reports
remote automation disabled; no Safari preference was changed. Its runtime
memory probe and the later hardware checks remain pending.

Small results are retained under `~/terraform-assets/agent-live-preview-review/`.
The scripts remain on demand; `repro/check.sh` is unchanged. Intensive scene,
export, control-sweep and land runs wait for the later review/check window.
