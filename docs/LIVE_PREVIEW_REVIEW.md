# Live preview review branch

All implementation work is on **`live-preview/review`**, in
`~/src/terraform-wt-live-preview-review`. Main is untouched; the owner reviews
before any merge to main. Main's accepted UI changes through `222ace7a`
are integrated on this branch. The isolated review server is **http://127.0.0.1:8903/sculpt**.

- [LP0 bench](LP0_REPORT.md): original browser baseline and limitations.
- [LP0c](LP0c_REPORT.md): fixed view tiles and deterministic regional UVs;
  the owner accepted the six measured sampling changes.
- [LP0b proof](LP0b_REPORT.md): historical throwaway prototype. Its code stays
  outside this branch; its separate review server remains on port 8900.
- [LP4 step 1](LP4_STEP1_REPORT.md): interruptible Time requests, exact Time
  output proof and alternating timings. Later LP4 work remains unfinished.
- [LP1](LP1_REPORT.md): native dirty model, complete computed World-row table,
  focused correctness and combined-branch slider timings.
- [LP2 progress](LP2_PROGRESS.md): frame batching, native view blocks,
  pause/release refinement, exact working texture reuse, Time freshness and
  adaptive working-memory recovery are implemented with focused checks.
  A global coarse field lattice removes the measured block-boundary mismatch
  while preserving the captured final hash; three preview-bias samples are
  reported.
  The default is 2048 MiB; a forced paged failure recovers at 512 in two
  blocks. The no-compile gate, remaining allocation recovery and qualified
  latency/final-cost measurements remain unfinished. Safari validation is
  explicitly deferred. No LP2 acceptance or new qualified speedup is claimed.

Checks stay focused on perf and basic correctness at the owner's request.
The reports distinguish earlier completed sweeps from deferred combined-tree
gates. No new benchmark runs were added to `repro/check.sh`.

The latest focused same-budget comparison is [LP2_TIMINGS.md](LP2_TIMINGS.md):
large Green/map16 whole-view stroke p95 is 96–105 ms versus about 7.6 s on
current main. It is one measured fixture, not full LP2 acceptance.

LP3 step 1 is in [LP3_PROGRESS.md](LP3_PROGRESS.md): exact preview inputs
halve the sampled input allocation and allow one large coarse block at
512 MiB on map4 and explicitly checked paged map16. Sampled final windows remain exact; preview differences are
reported separately. Its focused comparison is in [LP3_TIMINGS.md](LP3_TIMINGS.md): whole-view
stroke p95 is 95–98 ms; wider acceptance remains open.

The owner authorized autonomous landing on main overnight, with a summary
due by 7:30 AM Pacific on November 13. The candidate will be checked and
reviewed before merging; unfinished experiments remain outside main.
