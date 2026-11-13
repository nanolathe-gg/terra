# LP2 progress

Implementation is on `live-preview/review`; main is untouched. This is a
partial card, not LP2 acceptance. The review server is
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
  window keeps the same final hash after level switches and another ROI;
  input/final-field texture identity is retained. Three levels remain,
  ending at 282.7 MiB of 512. A small ownership check verifies exact-once
  release and protects active sets.

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
memory exhaustion. Other large allocations and lost-device recovery are
still unfinished. Existing per-buffer/texture limits still constrain the
renderer; an adapter limit does not reveal a total memory budget.

An exploratory generic shader probe compiled both rock-mask sets in 6.6 s.
At level 4 on one 1728×1024 cliff window, two alternating generic/specialized
pairs have identical RGBA hashes; GPU pass totals are 60–65 ms generic and
58–59 ms specialized. Driver load at start was 57–63%, so these are loaded
exploratory observations, not qualified latency results or a settled
pipeline choice. Startup cost needs a quiet measurement before choosing
between the generic set and the plan's prewarming fallback. No generic
pipeline code has been added to the editor.

Still unfinished: the pipeline choice/no-compile gate; remaining large
allocation and lost-device recovery; the page budget's preview reserve;
focused Rain/Face steepness interaction verification; seam/color-bias
review; qualified alternating latency/final-cost measurements; and broader
combined pixel/export checks. The 200/400 ms, 10% final-cost and exact-pixel
gates are unchanged. The owner asked to keep checks simple and fast, so
broader checks remain deferred.

Safari runtime validation is explicitly deferred by the owner after its
protected-setting authentication prompt. Remote automation remains off;
developer-feature visibility was restored to off and Settings was closed.
No Safari, iMac or iPad runtime memory facts are claimed.
