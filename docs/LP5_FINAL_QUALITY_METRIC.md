# LP5 final-quality input coverage, November 14

The color budget row in `repro/perf.mjs --report` now uses native-quality
painted coverage. It previously credited any current level, so a fast coarse
preview could appear to pass LP5's 150-ms final-quality target.

`latencyFinalQuality` and `samples.finalQuality` are added without changing
`latency` (first tile), `latencyChanged`, `latencyPointer`, `latencyAll` (any
level), or pause/release final measurements. Analysis runs after capture;
there is no new timed hook or GPU work. Historical raw results can be
reanalyzed through the same helper when they contain inputs, view and painted
coverage events. Missing or unfinished observations remain censored.

A qualifying coverage partition contains only level ≤1 images current for
the input under LP0's existing revision/Time predicate. A coarse overpaint
removes native coverage beneath it. An image that is dirty for a later edit
can still answer an older input if its actual painted revision is sufficient.
This endpoint is for the plan's 100%-zoom benchmark view.

**Measured from the existing compact-input page trace:** the pooled ambient
color row changes from an apparent **4.0 / 8.2 ms PASS** at any level to
**603.9 / 1522.7 ms FAIL** at final quality, both with 72/72 observations.
Release-final remains **87.7 / 123.4 ms**. No new performance session was
needed. The report no longer treats the coarse endpoint as LP5 acceptance.

Seven focused coverage tests pass in 61 ms, including native coverage,
coarse overpaint, unfinished input and newer weather requirements. Shader,
editor and preview-asset inputs are unchanged by this benchmark-only unit.
