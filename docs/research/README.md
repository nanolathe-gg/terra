# Prior-art research (2026-11-04)

Research notes for the owner and the next implementation agent. Nothing here
is part of the editor: the two pages are standalone WebGPU prototypes, and
no card below has landed. The full brief, with figures, licenses and the
hand-off prompt, is the artifact "Terraform Prior-Art Review":
<https://claude.ai/artifact/61EeARxFRnFAFRHPGgTrtE> (private to the owner until
shared).

## The pages

- `gully-filter.html`: one mountain built like `engine-shape.wgsl` kind 4 (a
  swept curve, the engine's `vnoise` lumps, a jagged crest), then a
  slope-aligned stripe filter that cuts branching gullies. It is original code,
  written from the published idea; port it freely. Do not copy runevision's
  erosion filter or Phacelle code (MPL-2.0) or clayjohn's and Fewes'
  `erosion()` (CC BY-NC-SA).
- `stream-power.html`: the same, plus a coarse stream-power pass
  (E = K A^m S) before the filter.

Serve this folder (`python3 -m http.server`) and open a page in a WebGPU
browser. The query string sets the variants and numbers; each page's header
comment lists them. The defaults reproduce the figures in the brief.

## What the prototype measured

On SwiftShader (a CPU rasterizer, so only ratios carry over), over 640 x 448 px:

- The filter moves the 16-px corner heights on the mountain by a median of 5
  height units, with a p90 of 17 and a maximum of 28.
- It keeps the cells whose four corners lie within 10 units of each other
  (the `gentleLand` test): 177 before, 176 after.
- It costs about 3 times the stroke evaluation.
- Two runs with the same settings render the same terrain pixels.

By eye:

- Steering by the stroke's own fall line is what makes it work. Steering by
  the gradient of the lumpy height makes the gullies curl into loops.
- A 2 x 2 normalised stripe sum with a folded profile (sharp crests, round
  floors) beats a cosine profile and a 3 x 3 sum.

## Round 2: the lab

`lab/` is a standalone WebGPU page for trying terrain ideas fast (see
`lab/README.md`). It holds 22 experiments: round 1's mountain, and four
families from round 2:

- `lf-`: landforms from the rock column;
- `rk-`: rock faces, weathering and light;
- `ld-`: loose material;
- `er-`: erosion, resolution independence and incremental editing.

`palette-mix.py` measures the engine's palette pair against Knoll
candidates. `lab/compare-heights.mjs` compares saved height fields.

## Cards

The owner ruled on the brief's four questions on 2026-11-04 (decisions 25-28
in `docs/TERRAIN_ENGINE.md`): a modern Green variant first, one stored
whole-map drainage pass, the merges with their removals, and this order:
generic shared tools, then speed, then the rest.

| Card | What | Group |
| --- | --- | --- |
| P24 | Modern Green: a `modern` variant of Green (`WORLD_VARIANTS`), plus scenes green-modern-1..3; every look card sets its numbers there | 1, first |
| P16 | One loose-material scatter (Supply, Size, Sorting) in the bake, replacing five generators; fix talus sorting (`debrisStones()` runs backwards); remove the old rows | 1 |
| P1 | Gullies: the stripe filter on hill, mountain and landform strokes; remove the `spur*` rows, `heightVar`, `crestJag` | 1 |
| P13 | The column walk: differential erosion through the rock column (hogbacks, cuestas, fins, pinnacles) | 1 |
| P10 | One parametric rock model in the bake; rock types as presets; Age, Stain, Frost; remove the block rows it replaces | 1 |
| P21 | A stored, exact drainage plane by Euler tour, whole-map (decision 26) | 1 |
| P20 | Multi-scale thermal in the Time pass | 1 |
| P9 | Palette: eight Knoll candidates in the lookup cube | 1 |
| P12 | Multi-scale cavity and convexity on the cavity control | 1 |
| P4 | The draw: the surface once per pixel, not about 47 times | 2, speed |
| P11 | Exact sun and sky horizons by line sweep | 2, speed |
| P23 | Prefix checkpoints for drags; warm-0 Time previews | 2, speed |
| P5 | Several erosion iterations per dispatch in workgroup memory | 2, speed |
| P6 | `override` constants for per-world gates (fine, decision 28) | 2, speed |
| P17 | Talus cones and fans as shapes, with sorting rules | 3 |
| P18 | Ripples with defects and sand shadows | 3 |
| P22 | V, U and terraced valleys as landform presets; painted repose | 3 |
| P14 | Scarp retreat on plateau strokes: mesas and buttes | 3 |
| P15 | Apron hummocks, knolls and slumps around a shape | 3 |
| P2 | Rills in the bake, steered by the fall-line map | 3 |
| P3 | Derivative-damped lumps, fractional octaves, tilted terraces | 3 |
| P7 | Carried velocity and MacCormack sediment in the pipe model | 3 |
| P8 | A coarse stream-power pass for map-scale ranges (waits, decision 26) | 3 |
| P19 | Dunes by Werner's model as a deterministic gather (waits, decision 26) | 3 |
