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

## Cards

| Card | What | Status |
| --- | --- | --- |
| P1 | Gullies: the filter on hill, mountain and landform strokes, steered by the fall line; one stroke row | prototype now |
| P2 | Rills in the bake, steered by the Time pass's fall-line map, in place of fixed-angle gully grooves | experiment |
| P3 | Derivative-damped lumps, fractional octaves and a smooth crease, tilted broken terraces (from ProceduralTerrains, MIT) | experiment |
| P4 | The draw: evaluate the surface once per pixel instead of about 47 times (`surfaceHeight` taps in `engine-frag.wgsl`) | measure first |
| P5 | The Time pass: several erosion iterations per dispatch in workgroup memory, byte-identical | measure first |
| P6 | WGSL `override` constants for per-world gates in the bake and draw, measured with `perf.mjs` | measure first |
| P7 | Carried velocity and MacCormack sediment in the pipe model (LanLou123/Webgl-Erosion, MIT) | experiment |
| P8 | A coarse whole-map stream-power pass for map-scale ranges (H-Schott, MIT; GPU-Gang WGSL port, BSD-3) | later, needs a ruling |
