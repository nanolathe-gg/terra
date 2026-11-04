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

The brief orders these as P1 to P23; "Start here" cards are marked first.

| Card | What | Status |
| --- | --- | --- |
| P1 | Gullies: the stripe filter on hill, mountain and landform strokes | start here |
| P16 | One loose-material scatter (Supply, Size, Sorting) in the bake; fix talus sorting, which runs backwards in `debrisStones()` | start here |
| P13 | The column walk: differential erosion through the rock column (hogbacks, cuestas, fins, pinnacles) | start here |
| P10 | One parametric rock model in the bake; rock types as presets; Age, Stain, Frost | start here |
| P9 | Palette: eight Knoll candidates in the lookup cube | start here |
| P12 | Multi-scale cavity and convexity on the cavity control | start here |
| P18 | Ripples with defects and sand shadows | start here |
| P22 | V, U and terraced valleys as landform presets; painted repose | start here |
| P4 | The draw: the surface once per pixel, not about 47 times | measure first |
| P11 | Exact sun and sky horizons by line sweep | measure first |
| P23 | Prefix checkpoints for drags; warm-0 Time previews | measure first |
| P14 | Scarp retreat on plateau strokes: mesas and buttes | measure first |
| P5 | Several erosion iterations per dispatch in workgroup memory | measure first |
| P6 | `override` constants for per-world gates | measure first |
| P2 | Rills in the bake, steered by the fall-line map | experiment |
| P3 | Derivative-damped lumps, fractional octaves, tilted terraces | experiment |
| P15 | Apron hummocks, knolls and slumps around a shape | experiment |
| P17 | Talus cones and fans as shapes, with sorting rules | experiment |
| P20 | Multi-scale thermal in the Time pass | experiment |
| P21 | An exact drainage plane by Euler tour, stored whole-map | experiment |
| P7 | Carried velocity and MacCormack sediment in the pipe model | experiment |
| P8 | A coarse stream-power pass for map-scale ranges | later, needs a ruling |
| P19 | Dunes by Werner's model as a deterministic gather | later, needs a ruling |

Decisions the brief asks the owner for:

- **D1:** how a modern, realistic preset is judged beside a retail one.
- **D2:** a stored whole-map drainage pass.
- **D3:** the merges that remove controls.
- **D4:** pipelines specialized by data.
