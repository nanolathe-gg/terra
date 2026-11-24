# Terra design

This page explains what Terra is for, why it is built the way it is, and
how its parts fit together. It is the one place for the project's goals,
philosophy and technical decisions. The working rules that follow from them
are in [AGENTS.md](../AGENTS.md), numbered; code and tests cite those numbers.
This page says why, and does not repeat the rules.

Status (2026-11-21): an unreleased, experimental editor under active
development. Nothing here is a compatibility promise except the exported
`.ufo` file.

## Goal

Terra is a terrain and map editor for **Total Annihilation** (TA) that
runs in the browser on WebGPU. An artist sketches landforms, rivers, coasts
and rock with a few strokes. The GPU then grows realistic, weathered ground
from them at TA's pixel scale and in its 256-color palette. The artist places
features and start positions and exports a playable `.ufo` map.

- **For map artists.** Every control is something an artist would set on
  purpose for a different look. Built-in worlds are starting points, not
  limits: any map's look can be retuned, copied or applied to another map.
- **Generated, not copied.** All ground art, materials and feature sprites
  are procedural. No retail art is shipped or read at run time, and the
  editor needs no installed game.
- **Realistic first.** The current standard is real terrain: eroded cliffs,
  scree, sand where water drops it, grit and stones that read at 1x. Matching
  the original game's worlds comes back later, once each feature has proper
  controls (owner, 2026-11-09).
- **A good RTS map.** This is a game map, not a landscape render. Most ground
  must stay flat and buildable in the height map. Relief on level ground is
  art only. Roughness in the heights belongs near walls, rims and feet, and
  must fade believably into flat ground (owner, 2026-11-10). What blocks units
  should look blocked, and the passability view lets an artist confirm it.

TA is the only output for now. The engine keeps a clean boundary so it could
later become a general terrain generator with TA as one output, including
true-color output (owner, 2026-10-28 and 2026-11-16).

## Principles

Each principle below is one of the owner's decisions. The rule that enforces
it is in brackets.

- **One engine, one render path** [rule 7]. Every world runs the same GPU
  pipeline. A world is data, and code branches on features, never on a
  world's name. There is no CPU copy of GPU work and no flag that keeps an
  old path alive. *"I do not want to worry about back compat or drag two
  render paths along with us"* (2026-10-30). When something is replaced, the
  old thing is deleted.
- **One editor** [rule 8]. `/` is the editor. Every tool joins its tool list,
  undo, save file and export. It is a static site with no server-only paths.
- **Everything parametric; presets are numbers** [rule 9]. There is one
  parametric model per stage, and modifiers on top. A preset, whether a
  world's or a tool's, is only values for existing controls. There is never a
  choice between a preset shape and a parametric one (2026-10-30).
- **Every control earns its place** [rule 9]. Each control is continuous and
  visibly matters at 1x across the range an artist would use. Implementation
  constants stay in code. Any world can turn on any engine feature: a
  disabled row names the row that enables it, so there are no "this world has
  no X" dead ends (2026-11-07).
- **TA's scale** [rule 11]. *"We aren't 10,000 feet up in a jet where details
  are washed out. I want to see pixelated grit, boulders, rocks, gravel,
  sand, gouges, scratches"* (2026-10-29). One art pixel is the unit. Only
  16-pixel cell heights reach the game; everything finer is art.
- **True color inside, the palette at the end** (2026-11-16). The engine
  works in true color. A final output stage reduces the picture to the TA
  palette with ordered dithering. Nothing upstream assumes the palette.
- **The same look, not the same bits** [rule 12]. Small GPU arithmetic
  differences between machines are fine. On one machine, the same scene
  renders and exports the same bytes, and a regional render matches a whole
  render exactly. Results never depend on how the map was cut into tiles.
- **The owner's eye decides the look** [rule 10]. Statistics and impact
  reports are diagnostic aids. Fix the shape before the color.
- **Fast enough to feel live** (2026-11-11). Artists need near-instant
  feedback while editing, and only what is on screen is urgent. Off-screen
  tiles and the final export can take longer.
- **Few gates** (2026-11-09). *"We already have too many tests."* Run the
  checks that can catch a failure caused by your change; measurement tools
  are scripts run on demand ([AGENTS.md, Checks](../AGENTS.md#checks)).

## Owner decisions in force

Decisions about scope and behavior that are not obvious from the principles.
Dates are when the owner made them.

**Output and compatibility**
- The `.ufo` exported on one machine is the authoritative map that players
  use. Saves and share links are editable sources. They may render
  differently after an algorithm change, and there are no migrations before
  release (2026-11-09).
- Standard TA export only for now. True color and other Nanolathe output
  improvements are deferred (2026-11-09).

**Maps and worlds** (2026-11-19)
- A map holds its whole world: every setting, color, material, surface layer,
  rock type and tool. Retuning a built-in world never changes a saved map,
  and nothing about a world is kept in the browser apart from a map.
- **Start a map** lists the built-in maps as templates. Creating a map copies
  the template's look and brush cards. Files and links open with the data they
  carry. **New map with this look** starts a blank map from an open map.
- **Apply look from…** copies any of seven parts (Ground, Water, Rock types,
  Surface layers, Light & weather, Tools, Features) from another map.
- World values carry no "changed" marks. Strokes keep their own `edited`
  lists.
- Each map's saved brushes supply the Land and Water tool lists. A stroke
  whose brush is removed keeps its settings and becomes a generic landform.
  Artists can save a new tool from the selected shape (2026-11-11).

**Shapes**
- One curve describes every shape: height against distance from the drawn
  line, with lean and facing as a separate axis. Hills, cliffs, peaks,
  plateaus and mesas are presets of it (2026-10-31).
- A landform's crest is an absolute elevation: **Raise to**, **Cut to** or
  **Flatten to** (2026-11-02). Every shape button now draws a landform. The
  old Plateau, Hill, Mountain, Ramp, water, Crater and Crystal tools were
  folded into it (November 3 and 6). Fissure stays its own tool.
- Hills and mountains look different by default. Hills are low and smooth,
  with little exposed rock, and most units can cross them. Mountains are
  high, with cliffs, exposed rock and peaks, and they block most units
  (2026-11-05).
- Shores: no rock coasts by default (paint rock on a shore instead), a varied
  sand-to-grass edge, and Surf graded across its whole range (2026-11-05).

**Materials**
- A world's surface textures are materials: node graphs edited only in the
  material editor. A graph's node settings are its author's tools. Its
  published controls are what a map maker adjusts (2026-11-14 and
  2026-11-15). See [MATERIALS.md](MATERIALS.md).
- The editor shows only the material itself. It holds no reference pictures
  and no comparison tools.

**Scope**
- Artists start from a blank map. Starter content can come later (2026-11-09).
- Out of scope for now: symmetry and fairness tools, the Metal and Urban
  worlds, and iPad and touch support (2026-11-09).
- The benchmark for interactive editing is a 16x16 map, but map size is not
  limited. The tile budget is first-class: a map holds at most 65,536
  distinct 32-pixel tiles, and export merges the most alike tiles beyond
  that (2026-11-09).
- Target devices have 4-8 GB of memory. The default GPU budget is 2048 MiB
  (2026-11-11).

**Public assets** (2026-11-09)
- Palettes may be committed: `materials/palette.json` is engine data. All
  other artwork must be newly generated by the project. Tables of
  statistics measured from retail art (means, ranges, curves) may be
  committed. Retail pictures, crops and maps stay outside the repository.

## Architecture

```
Shape  →  Ground  →  Time  →  Surface  →  Light  →  Output
strokes   rock      erosion   layers of   one lit    palette, tiles,
          column,   and       material    surface    TNT heights,
          voxels    weather   and plants             features, .ufo
```

Every stage is defined in world units, so it can run at any resolution and
on any rectangle of the map. A stage that reads its neighbors declares its
reach, and tiles carry aprons wide enough for it. That is what makes
regional renders match whole renders.

### Runtime

- **The page** is plain ES modules (`sculpt*.js`) and WGSL shaders
  (`engine-*.wgsl`), with the layout in `index.html`. There is no bundler and
  no framework.
- **The Go command** (`cmd/terra`, `internal/site`) serves the source for
  development and builds the static site. It assembles each world's
  generated config from the committed JSON in `materials/` and `site.json`.
- **Export** is the Go exporter in `export/`, compiled to WebAssembly and run
  in a worker in the page. Nothing is uploaded.
- **Share links** go to a small Cloudflare Worker with R2 storage
  ([deploy/worker](../deploy/worker/README.md)). The development server
  stands in for it locally.
- **Hosting** is GitHub Pages (`.github/workflows/pages.yml`) at
  terra.nanolathe.gg once the repository is public.

### Shape: strokes to heights

A map's source is its list of strokes, not pixels. Almost every stroke is a
**landform**: a path, possibly branched, with a crest elevation, a
cross-section curve (front, back, lean, facing), a height-along-the-path
curve, and modifiers (outline, gullies, talus, terraces, facets, ejecta,
surf). Toolbar buttons are presets of it (`sculpt-tools.js`,
`sculpt-shape-presets.js`, and each world's tool list). Rivers, craters,
water and crystal fields are landform settings, not separate kinds. Paint,
sand, grass, smooth and erase strokes override locally.

GPU compute passes (`engine-shape.wgsl`, driven by `sculpt-gpu-fields.js`)
evaluate the strokes into the authored height and masks. This is the only
height the game's TNT file sees, sampled at 16-pixel cell corners. Large
maps run in pages, regions of the map evaluated with aprons.

### Ground: what material is where

The **rock column** (`sculpt-column.js`) is a stack of beds, each with a
thickness, hardness and rock type. Dip and folds tilt and warp it. Rock types
are world data (`world.rock`) with geological starting points
(`sculpt-rock-presets.js`), and each type shows a rock material.

Close up, the ground is a transient **voxel solid** (`engine-volume.wgsl`,
`sculpt-volume.js`) built near the surface. Broken blocks, courses, hard and
soft beds, pits and runnels displace it, so steep walls change their
silhouette. Local weathering passes round edges and let soft beds retreat. A
fixed camera ray marches it for normals, near shadows and cavities. The solid
lives only on the GPU and changes the art, never the gameplay heights.

### Time: weathering

Erosion, deposition, talus and wetness run as GPU passes
(`engine-erosion.wgsl` and `engine-weather.wgsl` through `sculpt-erosion.js`,
and rock runoff and debris through `engine-rock-weather.wgsl`). Maps of up to
1168 samples a side run in one pass. Larger maps run in pages, each with an
apron wide enough that the result does not depend on how the map is cut
(`TIME_APRON` in `sculpt-gpu-fields.js`). The results are data
maps (wear, deposit, wetness and others) that later stages read.

### Surface: layers and materials

A world's **surface** is an ordered list of layers over its ground. Each
layer draws a material, at a coverage, where its rule over measured facts
holds (slope, height, wetness, sunlight, convexity, and others), with an
edge that sets how it meets the layer below. Plants grow on layers. See
[SURFACE_LAYERS.md](SURFACE_LAYERS.md).

**Materials** are typed node graphs (`sculpt-materials.js`,
`engine-ground.wgsl`, library in `materials/textures.json`). Each graph makes
a repeating texture of unlit color, art height and shine. Textures are
generated on the GPU and cached (`sculpt-material-cache.js`), so the draw
only samples them. See [MATERIALS.md](MATERIALS.md).

### Light and output

The draw (`engine-bake.wgsl`, `engine-frag.wgsl`) lights one surface: the
authored height, the weathering changes and every material's relief, with
close and far shadow and cavity and broad occlusion. The output stage
(`engine-output.wgsl`) reduces the picture to the palette with Knoll pattern
dithering keyed to art pixels. A per-palette candidate table built on the
GPU keeps that cheap. Error diffusion was rejected because it re-patterns
whole tiles on every small edit.

### Rendering and responsiveness

The canvas (`sculpt-canvas.js`, `sculpt-chunk-renderer.js`,
`sculpt-renderer.js`) bakes 512-pixel chunks and shows 256-pixel tiles.
Visible tiles render first, at a coarse preview level while a stroke is held
and at final detail after release. Off-screen tiles come later. Tiles cache
under a checksum of everything they read (`inputDigest`; the guard in
`sculpt-digest-guard.js`), so unchanged tiles are reused. GPU and heap use
are accounted against budgets (`sculpt-memory.js`), and a level that does not
fit falls back to a coarser one. Export always waits for the final level.

### Maps, saves and sharing

A map save (`sculpt-save.js`) is one JSON document: the world snapshot
(settings, colors, materials, surface layers, rock column and rock types,
tools), the strokes, features, starts and game settings. The working copy
autosaves to IndexedDB, one entry per map (`sculpt-maps.js`). **Share link**
gzips the save and posts it to the Worker. **Download file** writes the same
JSON. Undo history and render caches are session state and are not saved.

### Features, starts and passability

Trees, rocks and other features are generated per map, sprites and burn
animations included (`sculpt-feature-gen.js`, `sculpt-feature-set.js`). See
[FEATURE_RECIPES.md](FEATURE_RECIPES.md). Fills place them by brush, lasso or
flood, on dry, gentle ground only. Starts, metal and game settings
(wind, tidal, gravity and others) go into the OTA file. The passability view
colors ground by unit movement class from the 16-pixel heights
([PASSABILITY.md](PASSABILITY.md)).

### Export

The exporter ([export/README.md](../export/README.md)) receives the art one
tile-aligned PNG at a time. It deduplicates 32-pixel tiles, merges the most
alike ones past 65,536, writes TNT heights from the quantized 16-pixel
corners, the minimap, features and the OTA, and checks the archive before
offering it. Large exports spill to the browser's private file system rather
than holding the whole image in memory.

## Code map

| Area | Files |
| --- | --- |
| Editor shell and state | `index.html`, `sculpt.js`, `sculpt-ui.js`, `sculpt-workspace.*`, `sculpt-ui.css` |
| Strokes and tools | `sculpt-scene.js`, `sculpt-tools.js`, `sculpt-shape-presets.js`, `sculpt-paths.js`, `sculpt-river.js`, `sculpt-selection.js` |
| World settings | `sculpt-knobs.js`, `sculpt-control-schema.js`, `sculpt-world-kit.js`, `materials/*.json`, `site.json` |
| GPU fields and weathering | `sculpt-gpu-fields.js`, `sculpt-erosion.js`, `sculpt-rock-weather.js`, `engine-shape.wgsl`, `engine-erosion.wgsl`, `engine-weather.wgsl`, `engine-rock-weather.wgsl`, `engine-feed.wgsl` |
| Rock and voxels | `sculpt-column.js`, `sculpt-rock-presets.js`, `sculpt-volume.js`, `engine-volume.wgsl` |
| Materials and surface | `sculpt-materials.js`, `sculpt-material-*.js`, `sculpt-surface-panel.js`, `engine-ground*.wgsl` |
| Draw and output | `sculpt-renderer.js`, `sculpt-chunk-renderer.js`, `sculpt-canvas.js`, `engine-bake.wgsl`, `engine-frag.wgsl`, `engine-common.wgsl`, `engine-output.wgsl` |
| Maps and sharing | `sculpt-save.js`, `sculpt-maps.js`, `sculpt-share.js`, `deploy/worker/` |
| Features and gameplay | `sculpt-feature*.js`, `sculpt-features.js`, `sculpt-passability*.js` |
| Export | `sculpt-export*.js`, `export/` |
| Site and tools | `cmd/`, `internal/`, `repro/` (checks), `measure/` (analysis) |

## Roadmap and open questions

These are not commitments. The owner sets the order.

- **Before the repository goes public:**
  - Check the provenance of every committed table that came from looking at
    retail art. Record each table's generator, and make sure nothing stored
    as pixels or palette indices is a close copy of retail art.
  - Decide what happens to the private `dev-assets-20261028` prerelease of
    retail-derived files, which was left in place at the owner's request
    ([PREVIEW_ASSETS.md](PREVIEW_ASSETS.md)).
  - Make sure the Go module dependency (`github.com/nanolathe-gg/nanolathe`)
    is public.
- **Realism:** shore forms (shoreface, bars, dunes, wave-cut platforms),
  water's look (held on `prototype/water`), and tuning worlds other than
  Green.
- **Responsiveness:** cold shader compiles, final-render deadlines on large
  maps, and Safari validation.
- **Retail:** a return to matching the original worlds is parked, not
  dropped. Its tools and windows are kept ([retail-match](retail-match/README.md),
  [RETAIL_ROUND.md](RETAIL_ROUND.md)).
- **Held prototypes**, each kept on its branch until it meets its bar:
  `prototype/column-walk` (bed walking that beats off by eye),
  `prototype/scarp` (few wide canyons with benches), `prototype/slumps`
  (lobes that read at 1x), `prototype/talus-fans` (fans with height),
  `prototype/peaks` (spurs that don't read as stubs).

## History

The project began as Nanolathe's `tools/map-editor` and brought its history
along. The planning docs, work cards (A-H, P1-P32 and later), reviews,
performance reports and experiment ledgers that guided it were consolidated
into this page on 2026-11-21. Code comments still cite card names such as
H12, P17 or lfimpact. To read the original records, check out commit
`3ee2584d`, where they live in `BACKLOG.md` and `docs/`. The experiment
ledger is kept, parked with the retail docs, in
[retail-match/EXPERIMENTS.md](retail-match/EXPERIMENTS.md).
