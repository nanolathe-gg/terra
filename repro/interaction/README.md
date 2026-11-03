# Historical interaction evidence

This directory preserves the reports and numerical results from the earlier
JavaScript interaction experiment. Its injected browser pages and Python test
server were removed when the application moved to Go. The historical reports
describe that implementation; their old launch commands do not apply now.

Use the Go server and current checks in [../README.md](../README.md).
`repro/perf.mjs` exercises actual pointer interactions and records animation
frames, changed terrain deliveries, load, release and scrolling. Run baseline
and candidate alternately without simultaneous GPU workloads. Fresh terrain
deliveries and animation frames are separate measurements; neither measures
physical input-to-display latency.

The retained image comparison tool can still compare historical capture sets:

```sh
python repro/interaction/compare.py --before /tmp/interaction-before/LABEL/references --after /tmp/interaction-after/LABEL/references --out /tmp/fidelity.json
```
