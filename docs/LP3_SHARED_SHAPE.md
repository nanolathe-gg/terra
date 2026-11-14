# LP3 share immutable shape pipelines, November 14

Shape engines now share layouts and pipelines for the same GPU device and
storage variant. Lattice restarts stop creating **140 / 280 shape compute
pipelines** during sampled continuous/paused Rain phases: the corresponding
cached runs create **zero**. This addresses API creation on the interaction
path; it is not a claim about a pristine driver's shader compilation time.
[Evidence](LP3_SHARED_SHAPE_METRICS.json).

The shader source varies only with the paged-storage define. Grid, spacing,
world heights, sea level and nodes remain request uniforms or buffers. Only
the immutable module/layout/pipeline set is shared; every engine keeps its
own fields, masks, uploads, scratch and request queue. An in-progress build
is shared, a rejected build is removed for retry, and cache lifetime follows
the device through a WeakMap. No new dependency, world branch or render path.

The focused small-map preview candidate (a separate pending unit) measures
Rain first/whole-view p95 of 96 / 109 ms in one run and 109 / 94 ms in the
reverse-order run. The uncached candidate was 116 / 93 ms. Tails are mixed;
the direct measured effect attributed here is eliminating repeated shape
pipeline creation. One canonical changed-refinement pipeline first appears
after the continuous preview; the paused phase creates none.

One authored regional replay reports zero mismatches. Whole-map native Time
height and all three maps retain their four exact hashes when priority work
runs between slices; cancellation submits no obsolete slice and destroys each
owned allocation once. Both large Chrome viewports replay with zero changed
pixels. The earlier separate 512-MiB probe stays below budget and replays
exactly, but its helper inherited map16: it is a paged-map check, not a
small-map check. The [corrected nonpaged probes](LP3_SMALL_MAPS.md) explicitly
assert map4 and its absence of page storage. These checks also exercise engines at different lattice sizes on
one device. Shader source, pass order, output precision and terrain art are
unchanged. No all-world or broad export sweep was run.
