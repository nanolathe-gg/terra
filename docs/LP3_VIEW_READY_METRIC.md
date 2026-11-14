# LP3 view readiness measurement, November 14

Whole-current input timing now uses the serial and Time epoch of actual
painted regions on native-metadata builds. It no longer waits for the
whole-map export-ready flag after a valid coarse view has already appeared.
No latency target, pixel-change check, coverage threshold or weather epoch
requirement changes. Older builds without native epochs keep the ready flag.

A small-map Rain trace painted the complete view with serial 47 and the
requested Time epoch 36 at **54.2 ms** after its last input, while whole-map
export readiness delayed the reported endpoint to **438.4 ms**. The existing
per-pixel freshness predicate already accepted that image; only the extra
global gate held whole-view timing back. The first-changed endpoint was
unaffected. Input and final-quality analyses now use the same readiness rule;
pause/release-to-final and no-input load readiness retain their existing gates.

Reanalysis of the same immutable trace changes continuous Rain whole-current
p95 **438.4 → 114.6 ms**, with no new render. The comparison build without a
coarse small-map source stays **1843.8 ms**. Other source trials and their
original/corrected distributions are [retained here](LP3_VIEW_READY_METRICS.json).
These are a metric correction, not a new runtime speedup claim.

Eight CPU coverage cases pass in 36 ms. The new case accepts correct native
epochs while export is pending, rejects a newer requested Time epoch, and
keeps legacy builds blocked without readiness. Existing stale-overpaint,
missing-strip, Fit-backdrop and final-quality checks remain exact.
