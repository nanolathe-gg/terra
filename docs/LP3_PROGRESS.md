# LP3 progress, 2026-11-12

Step 1 is implemented on `live-preview/review`: preview lattice input
textures use their exact dimensions, with matching estimates and planner
probes. Coarse and quarter blocks still share an input set. Final and
export input dimensions retain their existing padding. No shader or
sampling formula changed.

Measured basic check, Green Modern 2/map16, 1728×1024 window at (0,256):
input textures shrink from 2048×1024 to 1071×955, or 104 MiB to 50.7 MiB
(51% less). The generic pipeline comparison explicitly clears both caches
so it compares the same pipeline kind, for rock masks 0 and 15. Changing
input dimensions moves 8 of 110,592 coarse preview pixels and 3 of 442,368
quarter pixels in each case. The largest mean RGB change is 0.00017 byte.
Whole versus split coarse blocks differs at 8 isolated pixels, zero in
the five-pixel boundary strip. These small preview differences are
consistent with normalized-coordinate filter precision **[inferred]**;
they are reported, not called byte-identical. The earlier exact preview
hash diagnostic failed as reported. The final zero-pixel requirement and
its tests are unchanged.

Both sampled final 256×256 windows have zero changed pixels, SHA-256:

- World rock: `6f1687a412b9a7128c826d1906e5b267a5928f3d72b3f4e8c0ee727ed8899901`.
- Recipe-enabled backend: `d186b28f91fd0377855b4b2a02f9c14b53120aaad34f921df9e4ce4507ec9af2`.

A basic 512-MiB check at the benchmark view (0,300), 1728×1024, makes one
coarse block (its globally aligned rectangle is 1728×1088). Its input is
1071×987. The accounted terrain peak is 490.8 MiB, with no banner and zero
console errors. This is a block-count/memory proof, not a timing run.
Benchmark anchors and the missing-anchor negative control still pass.

Qualified speed measurements for this step are next. LP2's focused
same-budget reference is [LP2_TIMINGS.md](LP2_TIMINGS.md); its remaining
memory and broader acceptance gates remain open. Later LP3 steps are not
implemented. Broader correctness runs remain deferred at the owner's
request.
