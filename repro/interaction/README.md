# Drawing, editing and fit-view performance

This browser harness exercises the app's real pointer and input handlers. It lives outside the normal app and adds no production instrumentation or dependencies. The host binds to loopback only and accepts PNG/JSON evidence under its output directory. It deliberately has no retail feature catalogue or export action; use `sculpt.py` for reviewing the app normally.

Start two hosts from this directory's worktree, with a clean baseline checkout or archive and the candidate source:

```
python repro/interaction/server.py --source /path/to/baseline --port 8906 --out /tmp/interaction-before
python repro/interaction/server.py --source /path/to/candidate --port 8907 --out /tmp/interaction-after
```

Open `http://127.0.0.1:8906/interaction/index.html` and its port-8907 counterpart in the same WebGPU-capable browser. Run them serially so GPU work does not contaminate timings. Keep the browser foregrounded. The iframe is fixed at 1280×900. Use a new label for each trial.

`/interaction/strokes.html` checks freehand simplification through the real pointer
handlers on 1×1 (whole-map) and 5×5 (paged) maps: point reduction, endpoints,
attached and disconnected paths, cancellation, click stamps, Undo / Redo, graph
round-trip, and keeping raw points when disabled or supplied by a script.

- **Run interactions:** Fit, 90 drawing inputs, 90 drag inputs, 60 slider inputs, and 60 path-point inputs. One input is sent per animation frame. Each phase waits for final visible refinement, saves timing and GPU-pass records, and captures the result. Synthetic pointer capture is bypassed for that test pointer only. This measures application handling, not hardware-to-display input latency.
- **Draw at fit:** Nine large shapes distributed across the map, then a 90-point stroke at Fit. Try 40×40. It tests full-map editing without requesting a full-resolution image of the entire world.
- **Check cache & fit:** Add a distant shape, record visible rebakes, edit a nearby shape, then compare the retained view with a forced invalidation. For maps up to 8×8 it also assembles a full-resolution downsampled reference for judging Fit.
- **Check refinement stability:** Render a scene, run refinement again without editing, and compare both images. This catches display-order dependencies in refinement inputs.
- **Test dirty fields:** Candidate-only GPU fixture. Verify identical buffers produce no dirty tiles; change the second height plane, third packed map, fourth material channel, and the last edge tile; verify disabled maps force a reset.
- **Check tile output:** Compare bounded relief dispatch with full padded dispatch at three tile positions and scales 1, 2 and 8. Evict resources between captures so previous texture contents cannot hide missing computation. Covers odd dimensions and map edges; use 40×40 to exercise paged fields.
- **Check retained view:** Verify hovering causes no terrain paints, then return through Fit, 1×, scrolling and resize and compare the resulting pixels exactly.
- **Check move trails:** Move a plateau and hill away from their previous position while refinement is paused. Capture the old position, live preview, authored-only preview, canceled move and committed result. Compare a patch at the old base, distant terrain and cancellation. Run 4×4 and 8×8 to cover whole-map and paged refinement. `drag-trails-results.json` records Green and Red checks and the settled-output comparison against `0a20bdc`.
- **Capture scene:** Select each of the 27 committed scenes in turn. Full-resolution 1024×1024 captures of the selected retail-comparison scene, plus a fixed 128×128 authored-height sample lattice. The helper rejects empty captures and waits for iframe navigation before accessing the new device.

Compare the reference captures with:

```
python repro/interaction/compare.py --before /tmp/interaction-before/LABEL/references --after /tmp/interaction-after/LABEL/references --out /tmp/fidelity.json
```

The performance prototype intentionally fixes the Green refinement initialization bug described in `REPORT.md`. Comparing initial captures therefore reports three Green differences. **Check refinement stability** reproduces the same differences in the unmodified baseline and verifies that its second result exactly matches the candidate; repeating refinement in the candidate changes zero pixels. Keep both initial and repeated baseline captures when reviewing this correction.

A `present` event includes cached redraws and **must not be reported as fresh-terrain FPS**. Use `freshPresents` / `freshTilesPerSecond`, which count the first paint of each new ImageBitmap before the iframe's release marker. They are fresh tile deliveries to the viewport, not whole-viewport FPS or physical display timing. `bake-end` now records CPU render submission, so it is not a completion metric when snapshot preparation overlaps GPU execution. `frameP95` measures animation-frame intervals across the phase, including settling; `activeFrameP95` restricts them to active input. GPU timings use timestamp queries when supported. See `speed-results.json` for repeated close-view trials against `80aad36`, full-map Fit results and output checks.

The instrumentation deliberately destroys the old iframe's GPU device during fixture replacement. Abort errors from pending reads at that teardown are excluded from the fixture's unhandled-rejection reporting; unexpected errors during a live fixture remain visible.


Use **Compare preview colors** to capture identical settled terrain at final and preview resolution, then capture a translated shape during input at both resolutions and after refinement. The five PNGs are saved under `<label>/<scene>/`. Compare color means at matching coverage; a lower-resolution image is not expected to match every final pixel. See `color-results.json` for the follow-up measurements against `153fd4b`.
