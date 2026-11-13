# LP2 progress

Implementation is on `live-preview/review`; main is untouched. This is a
partial card, not LP2 acceptance. Main is merged through `222ace7a`
(accepted navigation/curve UI); the older qualified comparisons remain
against their recorded `99d976c5` baseline. New comparisons must use current
main. The review server is
http://127.0.0.1:8903/sculpt.

World/preset knob rows, World colors, preset rock/bed/absorption colors,
Surface sliders and clay/light share one animation-frame input queue.
Address, World storage, control sync and checkpoint wait for release or
250 ms without input. Handoffs apply pending values before reading recipes.
Applied surface options remain stable until the batch runs. Independent
preset color fields merge without replacing another pending color.

Measured basic checks: a 43-event mixed World/color/Surface burst and a
42-event mixed preset-color burst each make one renderer update, with no
immediate render or storage work. Preset edits keep their local dirty
rectangle and unchanged Time key. Eleven knob checks pass in about 50 ms.
The prior 130 exact world-uniform comparisons remain the writer proof.

View blocks now replace the per-tile quarter plan. A pure estimate chooses
aligned balanced-grid partitions over visible stale ground. Immutable
block canvases sit over older finals, clipped around current/newer final
tiles. Coarse comes first, quarter after about 100 ms, and focused final
tiles after release or about 250 ms. Recent World inputs count as active
for page preparation; a pause permits refinement while a row remains held.
Off-screen tiles wait for visible finals and about a second without input.
Cold page preparation can grow residency: that triggers a new plan before
working allocation, preserving visible final images. `idle()` includes
visible refinement delays. Obsolete coarse images are pruned.

Measured focused page checks:

- A map4 cliff session renders coarse blocks and returns one 256×256 final
  window to exactly its cold-bake RGBA hash after slider input. This is one
  window, not an all-scene pixel claim.
- On `green-modern-2`/map16, 1728×1024 at 512 MiB, the native observer binds
  and observes whole-current coverage for 180/180 inputs: 40 stroke moves,
  32 resume moves and three 36-value slider workloads. Coarse, quarter and
  final pictures appear. Console errors and long tasks: zero. Accounted
  GPU peak: 510.7 MiB. Cold work still builds two pipeline sets across the
  run. Its timings were unqualified and discarded; the original load
  sample is excluded because load binding was subsequently corrected.
- A deliberately held Time result on map4 exposes its old B revision as
  old; map16 keeps the new weather feed pending. Both expose the new
  revision after completion, with zero console errors. The bench rejects
  old weather and Fit backdrops at detail zoom even if an image has a new
  serial. Paged Rain now says weather is pending until the current feed
  arrives; export retains on-demand page computation.
- Exact lattice texture sets are shared across levels. A nonflat 256×256
  window keeps the same level-1 authored hash after level switches and another ROI;
  input/final-field texture identity is retained. Three levels remain,
  ending at 282.7 MiB of 512. A small ownership check verifies exact-once
  release and protects active sets.

The earlier working-set helper did not explicitly wait for Time. Its
`d846…` hash is an authored-surface result, not proof of a weathered final.
An explicit post-merge audit waits for `canExport()`: the weathered window
is `6f1687a4…`, authored is `d846dcf5…`, and restoring weathered returns
exactly to `6f1687a4…`, with zero console errors. The current level-switch
and different-ROI check also restores the weathered hash exactly. The
benchmark's final settle already includes weather readiness; these helper
hashes are not timing results.

Current-main integration has 33 focused CPU/static checks passing in
0.58 s and all eight benchmark source hooks parsing, including rejection
of a missing hook. A held-render check confirms a queued World row keeps
main's row/global progress markers and clears them after explicit release
and final presentation, with one application/commit and zero console
errors. No broader post-merge gate is claimed. The comparison server on
8902 now serves main `222ace7a`; fresh-server benchmark warm-ups still
precede any future accepted timings.

The default is now 2048 MiB, or 1024 with an available device-memory
signal of 4 or less. An explicit artist budget wins until it fails.
Working textures use allocation error scopes; a failure releases preview
resources, lowers the budget and replans. The existing editor preference
object holds the settled notch and a trial note; no storage key or control
was added. Focus preserves this state. The existing memory line explains
a reduction. A repeated address remembers a budget it failed at.

Measured memory checks in Chrome: default 2048; a forced working-set
failure at 768 lowers to 512 with no banner. On map16 the visible coarse
view changes from one block to two, then reaches final, with zero console
errors. A simulated interrupted 2048 trial starts at 1536 and clears its
note after drawing. Four small policy checks pass in about 41 ms, and five
static-site checks pass in 0.63 s. This uses a forced failure, not actual
memory exhaustion. Voxel metadata/density pairs and Time working buffers now use scopes too.
A focused forced Time failure during a held view bake waits before freeing
textures, destroys the partial buffer exactly once, and retries at 1536
without a banner or console error. Its final cliff window equals a cold
bake. Page targets, other bake allocations and lost-device recovery remain
unfinished. Existing per-buffer/texture limits still constrain the
renderer; an adapter limit does not reveal a total memory budget.

A block-boundary check found a coarse sampling defect: field aprons started
at their local integer origins, so an origin of 307 sampled a different
four-pixel phase from an origin of 0. Field bounds now round outward to the
level's global lattice in both estimates and allocation. Final/finer bounds
return the original object; no final sampling formula changed. On the
1024×768 cliff window, whole versus two level-4 blocks goes from 19,147 of
49,152 changed preview pixels to zero, directly checked at both 2048 and
512 MiB. Changing budget alone moves zero. Its final SHA-256 remains
`0a01ddb05d8e78f679c26fd6809a573349d10f194ae29e3136888e8d8c2743f2`,
including tiled finals at 512. Page ring stays 4. Console errors: zero.
This is a numerical boundary proof, not an artist look approval.

Measured preview bias against final, RGB byte units, window (0, 256),
1024×768: `green-modern-2` on map16, the other two on map4. The chroma
magnitude is the Euclidean norm of mean RGB bias after removing its mean,
as in the earlier interaction color report. These are three sampled
windows, not the older report's fixtures or a before/after speed claim.

| Scene | Quarter chroma bias | Coarse chroma bias | Coarse mean RGB bias |
| --- | ---: | ---: | --- |
| green-modern-2 | 2.144 | 4.223 | +2.052, +4.782, −1.183 |
| red-3 | 0.116 | 0.717 | +2.278, +2.067, +1.313 |
| desert-2 | 0.093 | 0.125 | +0.727, +0.640, +0.550 |

Green has the largest sampled hue shift. The existing preview raster is
kept; no color tuning or reduced ray count rides along. Broader look and
fidelity checks remain deferred.

An exploratory generic shader probe compiled both rock-mask sets in 6.6 s.
At level 4 on one 1728×1024 cliff window, two alternating generic/specialized
pairs have identical RGBA hashes; GPU pass totals are 60–65 ms generic and
58–59 ms specialized. Driver load at start was 57–63%, so these are loaded
exploratory observations, not qualified latency results or a settled
pipeline choice. Startup cost still needs a quiet measurement. The plan now requires the
generic set to be ready before input: pointer-down prewarming alone cannot
guarantee readiness for an immediately following value change.

Still unfinished: the full no-compile interaction gate; remaining large
allocation and lost-device recovery; the page budget's preview reserve;
focused Rain/Face steepness interaction verification; artist look
review; qualified alternating latency/final-cost measurements; and broader
combined pixel/export checks. The 200/400 ms, 10% final-cost and exact-pixel
gates are unchanged. The owner asked to keep checks simple and fast, so
broader checks remain deferred.

Safari runtime validation is explicitly deferred by the owner after its
protected-setting authentication prompt. Remote automation remains off;
developer-feature visibility was restored to off and Settings was closed.
No Safari, iMac or iPad runtime memory facts are claimed.

A focused overlap check found one remaining shared-uniform upload in Time.
Starting a tiny valid Time request while a 256×256 cliff draw awaited voxel
readback changed 51,128 pixels; restoring the input restored the reference.
Time already reads its private uniform snapshot, so the shared upload is
removed. The same injected overlap now changes zero pixels, with reference,
interrupted and restored SHA-256 all
`6f1687a412b9a7128c826d1906e5b267a5928f3d72b3f4e8c0ee727ed8899901`.
Both focused runs have zero console errors. This is a forced scheduling
check, not a latency measurement; it also removes one redundant upload per
Time request. No shader or Time pass order changed.

Both voxel and rock-weather backend pipeline sets (rock masks 0 and 15)
are now ready before editor input. A startup probe sees both sets with zero
console errors. Main draw/bake gate specialization remains unfinished.

Generic draw/bake/loose pipelines now compile from the original uniform-gated
shader sources during startup, for masks 0 and 15. A preview uses a cached
specialization or retries with generic gates without compiling. A final
miss releases the renderer while its specialization builds, then schedules
again; export and direct readers retain their awaited specialized path.
No shader or final specialization source changed. One focused cold-cache
check reports zero sets built during either preview, including a second
preview while final compilation is deliberately held, and an idle renderer
between them. Its final SHA-256 equals the reference `6f1687a4…8899901`.
Both generic masks are ready, with zero console errors. This warm-driver
startup took 145 ms; it is not a cold-start or qualified timing result.
Benchmark anchors parse on both builds and the missing-anchor negative
control fails as intended; 18 small CPU checks pass in 54 ms.

A short real-mouse map16 check delivered eight distinct Face steepness
inputs and eight Rain inputs. Both finish current finals with zero console
errors; Rain correctly says weathering is pending while held. Neither
560-ms gesture produced a completed block before release. This does **not**
pass the held-update gate: whole-map shape invalidation was dropping every cached weather page, so
Face steepness rebuilt Time before it could preview. The attempted change
to block cancellation did not improve this and was removed.

Held whole-map shape edits now retain each weather allocation with its whole
core marked invalid, using the existing gather behavior for local strokes.
It therefore shows the current authored shape and zero weather corrections
in that core; release/pause recomputes the stale weather. Outside a gesture,
whole-map invalidation still drops weather. Repeating the same eight-value
real-mouse Face steepness check changes held preview counts from 0 to 8,
with current finals afterward and zero console errors. Rain's eight-value
continuous check still shows pending weather, without a held picture; its
pause and broader acceptance remain open. No final shader changes.

The same short real-mouse Rain check with one 1,000-ms held pause produces
two completed preview blocks; five held observations see a block from this
edit. Continuous updates correctly retain the pending-weather text until a
current pass completes. After release, the final 256×256 window equals a
cold sketch reload byte for byte, SHA-256
`670e9222c1e82a0830a921e566f098c32da6b0676fa400a66899a6f209d0251d`.
Console errors: zero. This is a basic correctness result, not a qualified
latency or final-cost claim.

Two focused alternating pairs at the same 2048 MiB budget now measure current
main versus this branch on large Green/map16. Whole-view stroke p95 is
96–105 ms versus about 7.6 s, and continuous rock p95 is 74–75 ms versus
about 6.6 s. Release finals improve about 45–52%. First changed pixels
still miss 50 ms. See [LP2_TIMINGS.md](LP2_TIMINGS.md) for all three tile
latencies, changed pixels, final cost, load, resume, pipeline and memory
numbers and the remaining scope. LP2 acceptance remains open.

Overnight hardening adds a guarded restart for device loss and unscoped
out-of-memory events. It saves through the existing working-copy path,
records the failed notch, and reloads at exactly one lower notch. It does
not reload an editable recipe when local saving fails; the existing error
path remains available then and at the 512-MiB floor. A manually typed
budget now updates the existing `gpuMB` address parameter, so reload retains
the artist's choice. The initial crash note starts before renderer setup
and clears after the first final view has exercised the refinement sets.

Measured forced checks: actual destruction of this check's owned device,
reported as an unexpected loss, recovers 768 → 512 MiB both while idle and
while voxel readback is active. All nine terrain nodes and a pending Ambient
value survive. A synthetic native unscoped OOM event takes the same saved
restart path with its allocation-failure reason. All three checks finish
without a banner or console error. These are forced recovery checks, not
real OOM stress measurements or Safari/iPad validation. Five policy tests
pass in 40 ms, including exactly one step on reload and refusal at the
floor. No storage key or control was added.

Overnight final-cost correction: the scripted Colors workload has no change
event at its end, so its last anchor measures a quiet pause. The full flat
Green/map16 pairs found Colors final 22–27% slower than main by phase
medians. The endpoint is unchanged. With weather already current, a
current coarse picture now advances to final after 100 ms of quiet,
skipping the redundant quarter pass. Pending authoring keeps the 250-ms
fallback. Two focused alternating Colors pairs at 2048 MiB give continuous
final 1460/1475 ms versus main 1327/1352 ms (+9.6% by medians), and pause
final +7.2%. Both complete viewport cold replays have zero changed pixels
of 1,769,472. These focused runs have a different control history from the
full matrix and are not pooled with it. The full matrix will be repeated.

A separate final-tile task-yield trial is reverted: its continuous Colors
median moved by 17.6 ms, smaller than main's 21.6-ms spread in that batch.
No additional gain is established. Both trial cold replays were exact and
rAF p95 stayed 16.8 ms with no long tasks, but the shipping path keeps its
existing frame yield.

Self-review restricts the 100-ms ready-final shortcut to C–F inputs. A paged
map's export-ready flag does not certify each weather page; shape and Time
inputs therefore keep the previous fallback. This prevents early final
quality from being mistaken for completed weathering during a short pause.
The full matrix collected before this restriction is diagnostic only.

The post-pause diagnostic now records WebGPU error-scope wait time, the
first final attempt after the anchor, and native input stages. Flat Green
Colors is stage F; its first final attempt starts 72–89 ms after the last
anchor. Error-scope waits total about 70–72 ms across 56 final attempts
(including the off-screen margin observed after the visible endpoint).
They are not the whole final-cost penalty. The complete viewport still
matches its cold replay exactly. This is diagnostic, not an alternating
acceptance batch.

Final specialization now starts after a coarse picture has answered the input, using the gate key captured by that draw. It does not block the generic preview. In a focused Green 7/map16 large-view diagnostic, the cold-gate final took 1405 ms, the whole-view p95 was 81 ms, no long tasks or console errors appeared, and all 1,769,472 final pixels matched a cold replay. This diagnostic is not the alternating acceptance matrix. Eight focused renderer/memory checks and all benchmark hooks pass.


## Overnight landing decision, November 13

The broader native-preview candidate `fe03c540` did not pass its unchanged
final-cost guard. Two alternating pairs against main `222ace7a`, Green 7 /
map16 / 1728×1024 at 2048 MiB, give cold-gate release-to-final medians of
1216.10 ms on main and 1340.25 ms on review: **+10.21%**, against the 10%
limit. Main’s own spread is 50.6 ms. No threshold or endpoint was relaxed.
The full LP2 matrix stopped at that fixture; it is not an acceptance run.

Incremental presentation now paints only a new current final tile when the
camera is unchanged; stale completions retain full composition. Empty
allocation scopes are skipped for reused textures, while real allocations
and the forced failure remain scoped. A 75-ms final-overlap trial did not
establish a gain and was reverted to 50 ms. Final progress yields an input
task with GPU backpressure retained. These adjustments substantially reduce
the earlier 22–27% Colors regression, but they do not establish LP2 acceptance.
The complete final viewport still matches cold replay: zero changed pixels
in both 1,769,472-pixel comparisons.

The near-instant preview gains remain on this branch. The overnight landing
checkpoint contains the completed LP0c, LP4 step 1 and LP1 work, plus current
main’s UI and the private-Time-buffer correction. It is verified separately;
the unaccepted LP2/LP3 implementation is not part of that checkpoint.
Safari validation remains explicitly deferred.

The completed-card checkpoint landed on local main as `6d1b2b3a` after
221 unit tests, the clean landing tier, the unchanged strict tile-size
check, full-view cold replay and all three native/Wasm export comparisons.
Only the six approved RGB pixels move; all 34 height files are identical.
This review branch contains that main checkpoint as an ancestor while
preserving the native implementation unchanged. The completed comparison
server is http://127.0.0.1:8902/sculpt and the native review server remains
http://127.0.0.1:8903/sculpt.
