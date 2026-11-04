# Terrain lab

A standalone WebGPU page for trying terrain ideas fast, outside the editor. An
experiment is one small JS module holding WGSL. The lab evaluates it over a
window, lights it with a modern model (a soft cast shadow, horizon occlusion,
sky light), quantises it to the TA palette (`materials/palette.json`) with
Knoll pattern dithering, and times each pass. Nothing here is part of the
editor; an idea that works gets a card and is ported into the engine.

```sh
node docs/research/lab/run.mjs mountain-gullies --out lab-out
node docs/research/lab/run.mjs mountain-gullies --query "w=384&h=288&dither=1" --v gullies
```

The runner serves the repository root on a free port, opens Chromium with
WebGPU (SwiftShader when there is no GPU), and saves
`<exp>--<variant>.png` for each variant (the canvas's own bytes, so two runs
of the same scene give identical files), `<exp>--sheet.png` for all of them,
and `timings.json`. `--heights` also writes `<exp>--<variant>.f32`, the
heights as row-major f32; `--timeout` sets the seconds an experiment may
take (default 1800). It needs Playwright from the global install; set
`PLAYWRIGHT_MODULE` to its `index.js` otherwise. Timings on SwiftShader are a
CPU rasterizer's: compare variants with each other, never with a real GPU.
Knoll dithering costs about 2 s a 512 x 384 panel there; use `dither=1` while
iterating. To look at a page live, serve the repository root and open
`/docs/research/lab/index.html?exp=<name>`.

## URL options

| Key | Default | Meaning |
| --- | --- | --- |
| `exp` | `mountain-gullies` | the module in `exp/` |
| `w`, `h` | 512, 384 | panel size in pixels |
| `px` | 1 | world px per output pixel: 0.5 renders the same world at 2x, 2 at half |
| `ox`, `oy` | 0 | window origin in world px |
| `world` | the module's | colours from `materials/<world>.json` (measured means) |
| `pal`, `dither` | 1, 2 | TA palette on; dither 0 nearest, 1 two nearest, 2 Knoll pattern |
| `az`, `el` | 315, 38 | sun azimuth clockwise from screen north (315 is the upper left), elevation |
| `zk` | 0.7 | height units to px for lighting |
| `shadow`, `ao` | 1, 1 | the cast shadow and the occlusion |
| `sea` | none | sea level in height units |
| `iters` | the module's | simulation iterations |
| `v` | all | the variants to render, by label |
| `p.<name>` | | override a parameter in every variant |
| `readback` | 0 | 1 keeps each variant's heights on `window.__lab.heights` |

A variant's `lab: {...}` sets any of these keys for that variant only. The
URL wins over both.

## A module

```js
export default {
  title: 'Hoodoos',
  about: 'One line on what it shows.',
  world: 'desert',                 // default colours
  colours: {rock: [150, 90, 60]},  // optional overrides, 0..255 sRGB: ground grass rock loose sand sky sun water
  params: {cell: 24, cap: 0.6},    // every number becomes prm.<name> (f32) in WGSL
  variants: [{label: 'low', note: 'shown in the caption', params: {cap: 0.3}, lab: {px: 0.5}}],
  sim: {iterations: 200, wgsl: '...'},   // optional; see below
  wgsl: `fn heightAt(p: vec2f) -> f32 { ... }`,
};
```

The WGSL the module provides:

- `fn heightAt(p: vec2f) -> f32`: **required.** The height at world point `p`,
  in px, in TA height units (a slope of 1 is one unit per px). It must be a
  pure function of position. `labPx()` is the size of one output pixel in
  world px: fade any detail finer than about 2 pixels (see `fbmBL`) so the
  experiment renders at any resolution.
- `fn matAt(p: vec2f, h: f32) -> vec4f`: optional material weights, stored per
  pixel and passed on as `m`. The default albedo reads them as
  `x` bare rock, `y` loose debris, `z` sand, `w` free.
- `fn albedoAt(p: vec2f, h: f32, n: vec3f, m: vec4f) -> vec3f`: optional
  sRGB albedo, 0..1. The default is `albedoDefault`: ground, grass by slope,
  rock by slope or `m.x`, debris `m.y`, sand `m.z`.
- `fn lightAt(p: vec2f, h: f32, n: vec3f, m: vec4f, x: i32, y: i32) -> vec3f`:
  optional linear RGB before exposure. The default is `lightDefault`. Write
  your own to try another lighting model; `sunShadow`, `occlusion`, `Hw`
  (bilinear height at a world point) and `Hc` (height at a pixel) are there to
  call.

A simulation (`sim`) runs after the heights, as three entry points, each
`@compute @workgroup_size(8, 8)` over the pixels:

- `simInit` writes the first state into `SA[idx(x, y)]` (`vec4f`).
- `simStep` reads `SA` and writes `SB`. The lab swaps the two between
  iterations.
- `simApply` reads the last state from `SA` and writes `H` (and `M` if it
  likes).

Each thread writes only its own pixel and nothing scatters, so the result is
deterministic.

- `labIter()` is the iteration count.
- `labStep()` is this dispatch's iteration, from 0.
- `simApply` must not read a neighbour's `H` while it writes `H`: that is a
  race. Read the state instead.
- The simulation runs over every output pixel; there is no coarse grid of its
  own yet.

The bindings every module can read: `lab` (the uniforms above), `prm` (the
module's parameters), `H` (heights, `f32`), `M` (materials, `vec4f`), `SA`,
`SB`, `idx(x, y)`, `worldOf(x, y)`, `labW()`, `labH()`, `seaLevel()`, and
everything in `lib.wgsl`:

- hashes;
- value and gradient noise with analytic derivatives;
- `fbmd` (derivative-damped fBm) and `fbmBL` (fBm band-limited by the pixel);
- Voronoi with edge distance;
- smooth min and max, box and segment distances;
- tilted strata with bed hardness;
- round 1's `gullies()`.

A module without a default export (`lf-lib.js`, `rk-lib.js`, `ld-common.js`)
is a helper that experiments import; it cannot be run on its own.

## The experiments

| Prefix | Topic | Modules |
| --- | --- | --- |
| (none) | round 1 | `mountain-gullies` |
| `lf-` | landforms from the rock column | `lf-strata` (benches, cuestas, hogbacks, folds), `lf-joints` (slots, fins, pinnacles, beehives), `lf-age` (scarp retreat: mesa, buttes), `lf-dome` (hogback rings), `lf-apron` (hummocks, knolls, slumps) |
| `rk-` | rock faces, weathering, light | `rk-types`, `rk-types2` (eight rock types as presets), `rk-weather` (age, stain, lichen, frost), `rk-light` (line-sweep horizons, cavity, warm and cool, wet), `rk-dither` (palette quantisers) |
| `ld-` | loose material | `ld-shapes` (stone shapes, multi-class scatter), `ld-talus` (cones with fall sorting), `ld-field` (a sorted field), `ld-fan` (alluvial and debris fans), `ld-ripples` (ripples with defects, sand shadows), `ld-dunes` (Werner dunes as a gather simulation) |
| `er-` | erosion, resolution, editing | `er-talus` (multi-scale thermal), `er-fans` (exact drainage by Euler tour, fans), `er-resolve` (one world window at four resolutions), `er-valleys` (V, U and terraced valleys, painted repose), `er-warm` (incremental erosion) |

## Rules

- **Pure functions, integer hashes.** The same scene must give the same bytes
  on the same machine.
- **Our own code only.** Port nothing from MPL, GPL, CC BY-NC-SA or
  unlicensed sources. A published idea is fine to reimplement; say where it
  came from in the module's comment.
- **No retail pixels.** Measured tables already in `materials/` are fine.
- **Keep the shared files shared.** Add helpers to your own module, not to
  `lib.wgsl`, `light.wgsl` or `core.js`, unless you are changing the lab
  itself.
