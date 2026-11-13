# Live preview review branch

All implementation work is on **`live-preview/review`**, in
`~/src/terraform-wt-live-preview-review`. Main is untouched; the owner reviews
before any merge. The isolated review server is **http://127.0.0.1:8903/sculpt**.

- [LP0 bench](LP0_REPORT.md): original browser baseline and limitations.
- [LP0c](LP0c_REPORT.md): fixed view tiles and deterministic regional UVs;
  the owner accepted the six measured sampling changes.
- [LP0b proof](LP0b_REPORT.md): historical throwaway prototype. Its code stays
  outside this branch; its separate review server remains on port 8900.
- [LP4 step 1](LP4_STEP1_REPORT.md): interruptible Time requests, exact Time
  output proof and alternating timings. Later LP4 work remains unfinished.
- [LP1](LP1_REPORT.md): native dirty model, complete computed World-row table,
  focused correctness and combined-branch slider timings.
- LP2: next, whole-view blocks and coalesced input. The combined branch's
  rock first-feedback p95 is still 257 ms; the faster whole-view final is
  not sufficient. Safari memory validation remains pending.

Checks stay focused on perf and basic correctness at the owner's request.
The reports distinguish earlier completed sweeps from deferred combined-tree
gates. No new benchmark runs were added to `repro/check.sh`.
