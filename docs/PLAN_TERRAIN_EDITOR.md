# Terrain editor: review of the visual lab and roadmap

Plan for the map editor (user-authorized 2026-10-26). It is an offline
authoring tool: it writes TNT, OTA and HPI content through the existing
writers and adds no gameplay rule, seam or simulation state. Its starting
point is the lab prototype `tools/terrain-visual-lab` on branch
`prototype/terrain-visual-round2` (head e51bbb3a1), mainly the sculpt tool
(`sculpt.*`). That prototype was reviewed on 2026-10-26: its scenes were
captured headless and compared with 1024-px crops of retail Green Planet
maps at 1:1 and 2:1. The figures cited below are on the review page
(private to the maintainer):
https://claude.ai/artifact/RtXmVheWRfPm9om144WJoU

Direction (user, 2026-10-26). Generation is parametric, like Gaea's:
biomes and feature behaviour (cliffs, hills, shores) are defined by
parameters and generated live. TA presets come built in, and artists keep
full freedom. Weathering processes (erosion, debris, rocks, sand, scree)
are configuration knobs. Exported maps may contain retail and community
pixels, but no core capability depends on them. The editor's home is the
browser.

The editor works in full colour. Limiting to TA's palette is an output
stage: on by default in the preview and in export, and switchable. How that
reduction is done is decided by experiment (E1).

The end product is a full map editor for maps of any TA size. You draw and
move pieces, and place metal deposits, trees and start positions. The
visual phases test on small maps, but nothing built in them may assume a
small map (§6.1).

## 1. Verdict

**Keep the foundation.** The sculpt tool already has the right skeleton:

- one displaced surface in TA's oblique projection (h/2 north), with shared
  light, shadow and depth order;
- freehand path brushes on world-anchored noise;
- heights relative to the ground beneath a stroke;
- protected crests, ramp centres and shallow passages;
- a real-time GPU preview (8 ms frames while painting, 13–19 ms full draws)
  followed by background refinement (0.1–0.5 s);
- biomes supplied as configuration;
- diagnostic views and a habit of human checkpoints.

None of this needs replacing.

**The remaining gap is structure, not texture.** Retail slopes are covered in
small lit facets. Rock comes out of the grass in connected streaks down the
fall line, and faces have ledges and clefts. The lab's slopes are smooth
brush profiles with a band of baked retail rock texture laid on top
(Figures 2–3). Fourteen checkpoints of material and lighting tuning have kept
running into the same complaints: a "continuous gray rim", a "dark plateau
flank", a "dark contour" and "dark ramp borders". More tuning of the same
layers will not fix them, because they need geometry the surface does not
have. The Gaea references (Figure 5) show the remedy: every visible detail
is geometry made by a named process (strata, fractures, gullies, talus),
then lit.

**Two structural blockers stand in the way of the goals:**

1. **Strokes bake into one 512² raster.** History is 24 full snapshots.
   Nothing can be re-edited: you can't move a plateau, change its height,
   reroll its seed or change the biome under it. Goals 1, 2, 4 and 6 all
   require a shape graph that is evaluated again after each edit.
2. **Behaviour is hard-coded, not parameterized.** About 30 URL ablation
   flags and many per-biome branches live in one 446-line fragment shader.
   Material coverage is a pile of hand-tuned smoothsteps, and biome
   differences are code paths rather than values. A Gaea-style tool needs
   the opposite: one engine of named processes, and biomes that are data.

**What retail data is for.** Retail sections and maps do three jobs:

- **Calibrate the TA presets.** Their parameter values are measured from
  retail rather than tuned by eye.
- **Serve as the benchmark** in blind review.
- **Optional stamps**, as in the official editor.

The official editor's `.sct` sections suit calibration best. Each one is an
isolated pre-rendered feature whose file holds both its tile art and its
heights (one byte per 16-px cell) [fmt tnt "SCT sections"]. `worlds.hpi`
holds 689 of them, in folders for Archipelago, Green, Lava, Mars, Metal and
Moon. Other archives were not checked. Retail pixels may appear in exports,
but none of the editor's core capabilities depends on them.

**Many more sections exist.** The TA Archive's section packs
(https://ta-archive.com/tools/section-packs/) describe 25,465 sections in
182 worlds, distributed as `.hpi` packs. They include:

- Cavedog's later official section downloads (Acid, Crystal, Slate, Urban,
  Water, among others);
- community worlds and tilesets (for example C_A_P, Evergreen, Zhon, Creon,
  Siberia).

The page states no licence. It credits community sections to their authors
and offers attribution changes or removal on request. These packs serve
three uses (§5.3, §10):

- calibrating more official TA presets;
- sources for community-world presets;
- a test of whether the knobs can express many different worlds.

**Next three steps, ranked:**

1. **Baseline, sections and editor skeleton (medium).**
   - Freeze a read-only baseline capture of the lab at e51bbb3a1.
   - Write the SCT reader and a section catalog for every world.
   - Start a new editor skeleton, built for full maps from its first line,
     with the lab's renderer ported in and the palette stage as a toggle.

   The lab's own branch is left to its owner. §8 Phase 0.
2. **Parameter model and shape graph (medium to large).**
   - Biome presets, feature-kind behaviour and per-shape overrides as one
     schema (§5).
   - Non-destructive shapes that are evaluated again after each edit.
   - Pieces you can move, rotate, duplicate and mirror, with only the
     touched region re-evaluated.
   - Today's Green, Red and Archipelago looks re-expressed as the first
     three presets.
   - A scale smoke test on a blank 12800×7168 map.

   §8 Phase 1.
3. **Processes, one knob group at a time (medium, ongoing).** In order:
   - calibration, then the palette-stage bake-off;
   - slope micro-relief; flow erosion; strata;
   - mask-driven materials and procedural grain;
   - debris and boulders; then sand;
   - then talus, fractures, GPU erosion, swatches and decay.

   Each lands as parameters with a TA calibration, judged with the palette
   on in blind review against retail. §8 Phase 2.

## 2. Evidence

| Figure | What it shows |
| --- | --- |
| 1 | Whole 1024² scenes: Green mixed and intersections, Red intersections, Archipelago islands |
| 2 | Generated Green plateau at 2:1 next to retail Greenhaven and The Pass at 2:1 |
| 3 | The same plateau lit and with lighting removed (`view=material`): rock coverage is a horizontal band of baked texture, and a thin dark crest line survives even with lighting removed |
| 4 | Hill sizes and plateau/ramp joins: hills look like rounded sausages with a few gray specks, and the ramp edge is an ink-like dark curve |
| 5 | Gaea surface references: all of the detail is geometry (strata, fracture networks, dendritic gullies), lit by one sun |
| 6 | Retail Mars hill sections (editor previews): isolated feature stamps whose files also carry heights |

Other observations:

- The canvas is fixed at 1024 px. Retail maps go up to 12800×7168 px
  (Cavedog Links).
- A strip of clear colour shows along the top edge when low ground projects
  south of the canvas edge (Archipelago islands).
- Export is a PNG of the canvas only.

## 3. What is good, and what needs work

| Area | Good | Needs work |
| --- | --- | --- |
| Surface model | One continuous displaced mesh, projection and depth order; one sun | Fine detail is small shader noise (±3–8 units); no multi-scale or slope-shaped relief |
| Authoring | Path brushes, relative plateau levels, curved graded ramps, passage vs area shallows, bank and beach controls | Destructive raster; brush-only shapes (no closed outlines); relative height sampled once at stroke start; no crater, canyon, terrace or flatten-to-level |
| Refinement | Cancellable worker; protection survives weathering; material transport kept apart from height | Droplet pass without flow accumulation gave parallel rills, so it is capped at 0.35 strength; CPU only, 512² only; no talus, debris or sand processes beyond a scree decal |
| Materials | Retail-sampled grass/slope/rock/water at native screen scale; diagnostic views | Coverage is hand-tuned code, not parameters; textures carry their own baked lighting, which ours lights again; 512-px tile repetition; output never quantized; a new biome needs retail art |
| Biomes | Shared tools, per-tool presets, biome supplied by configuration | One biome per canvas; asset preparation hard-codes `/private/tmp` paths; each biome adds shader paths |
| Performance | 8 ms frames while painting; GPU timer queries | Masks are recomputed per fragment; doesn't scale past 1024² |
| Process | Human checkpoints, independent screens, provenance kept outside Git | Results live in README prose; no fixed scene × seed suite; no ranked ledger |

## 4. Constraints the editor must respect

These come from the target format. They shape the design now, even though
export comes later.

1. **Two kinds of height.** TNT stores one height byte per 16-px cell and
   art as 32×32-px tiles [fmt tnt]. Anything finer than 16 px (surface
   relief, fractures, scree, boulders, sand ripples) ships only as painted
   art, never as height. Every knob in §5 is therefore marked as changing
   **authored height** (exported; gameplay sees it) or only **appearance**
   (lit and baked into the tiles).
2. **Full colour inside, one shared palette at output.** TA draws
   everything through one 256-entry palette: terrain tiles, units, the
   interface [fmt pal]. TNT tiles are palette indices. The pipeline
   therefore runs in full colour, and the last stage reduces to the palette.
   That stage is on by default in the preview and export, and an artist can
   turn it off to see the full-colour image. Every TA acceptance is judged
   with the palette on. A new biome may use any colours in the editor; the
   palette view shows what TA output will make of them. The map-features
   work found that mapping brightness to a palette index never matched
   retail, while neighbour statistics did, so the reduction method is an
   experiment (E1), not a detail.
3. **Height range.** The lab allows −90…300 authored units around sea level
   0. TNT heights are bytes, and retail sea level is most often 75 [fmt
   tnt]. If one authored unit equals one TA height unit, which the shared
   h/2 projection suggests but nobody has verified, then with sea level 75
   the usable range is −75…180. The editor needs a per-map sea level and a
   height budget shown while authoring. Sections can settle the unit
   question: register each section's silhouette against its own heights.
4. **Tile budget.** Base ground comes from a limited set of unique
   32-px tiles, randomly distributed on the TNT tile grid (user requirement,
   2026-10-26); generation may be procedural, but the number of unique base
   tiles is a knob. Tile indices are u16 [fmt tnt], so at most 65,536
   unique tiles. A 12800×7168 map has 89,600 tile slots, so a large map
   whose tiles are all unique won't fit; level ground has to reuse a
   periodic plain tile. Whether retail imposes a lower practical limit is
   not established: `TODO(question)` for the export phase.
5. **Gameplay truth comes from the engine.** Buildable flats and passable
   ramps are measured with Nanolathe's own movement classes and
   passability, as `internal/mapgen` already does. The editor must not
   invent slope limits.
6. **Sections are editor data, not runtime data.** Lighting is baked into
   their art, so a stamp can be moved but not rotated, and mirroring
   reverses its light. Records carry bytes beyond the height byte whose
   meaning is not established [fmt tnt]; nothing may depend on them.
7. **The pipeline already exists in parts.** `formats/tnt_write.go`,
   `formats/tdf_write.go`, `vfs/hpi_write.go`, and the feature, metal and
   fairness logic in `internal/mapgen` (docs/DESIGN_MAP_GENERATOR.md).

## 5. The parameter model

This is the core of the editor. Biomes and features are values fed to one
engine of named processes, never code paths.

### 5.1 Three layers

1. **Biome preset.** Global values for a world: materials and their colour
   ramps (full colour), geology, weathering, water and light. Built-in
   TA presets: Green, Red, Archipelago, Lava, Lunar, Metal, and others as
   they are calibrated. An artist can copy and edit any preset, or start a
   new biome from scratch.
2. **Feature behaviour.** Within a biome, each feature kind has its own
   values: cliff, hill, mountain, plateau rim, ramp, crater, canyon,
   beach, bank, coastal cliff, shallows, deep water. This is where "cliffs
   versus hills versus shores" lives. In one biome, a cliff can be layered
   and blocky while a hill stays grassy with gullies.
3. **Shape override.** Any shape node can override any value locally,
   blending out over a falloff. For example: this plateau's faces more
   layered, more boulders at this crater, wind-blown sand on this island's
   east side. A biome can also be painted as a region, so two biomes can
   meet inside one map.

### 5.2 Knob groups

H marks a knob that can change authored (exported) height; A marks a knob
that only changes appearance.

| Group | Knobs | H/A |
| --- | --- | --- |
| Form | Rise; shoulder width; face steepness; crest rounding; asymmetry by facing; outline roughness at several scales; foot spread; ramp grade and easing; crater rim height, width and floor | H |
| Geology | Strata spacing, warp, dip and hardness contrast; fracture sets (count, directions, spacing, depth, irregularity); face style mix (layered, blocky, cracked, smooth) | H coarse, A fine |
| Hydraulic erosion | Rainfall; stream power; channel width and depth; iterations; sediment capacity; alluvial fans at gully mouths | H coarse, A fine |
| Thermal and scree | Angle of repose; talus amount; scree apron reach; grain size | A (H for large aprons) |
| Debris | Source (cliff faces, crests, fractures); release rate; tumble distance down the fall line; size distribution; sorting (coarse near the source, fine farther away); burial in sediment | A |
| Rocks and boulders | Density; size range; clustering; embedding depth; shape (rounded or angular); source (scattered, cliff foot, riverbed, beach); light and shadow from the same sun | A |
| Sand | Sand is weathered from the map's own rock and ground: its colour and grain come from the source materials, and it is carried by water and wind along the terrain to where they deposit it (basins, shelves, beaches, lee sides). Knobs: weathering rate, transport by water and wind, wind direction and strength, ripples (wavelength, amplitude, orientation), dune fields (height, spacing) | A; H for dunes |
| Decay | Edge rounding; crumbling of crests and rims; pitting | A |
| Cover | Vegetation and moss by moisture, slope, aspect and burial; snow or ash on suitable worlds; patchiness | A |
| Materials | A layer stack. Each layer has a full-colour ramp, a grain, a coverage rule and breakup. The grain is procedural (noise type, scale, contrast, flecks and their colours) or taken from a swatch. The coverage rule reads the masks: slope, height above base, curvature, flow, wear, deposit, exposure, wetness, distance to shore. Edge character can be soft, ragged or veined | A |
| Water and shore | Shallow and deep depths and colours; waterline roughness at pixel scale; rim and surf; shelf width and its variation; reefs and islets; beach width and flatness; which elevations admit a rocky coast | H for beds and shelves, A for colour |
| Light | Sun (TA presets fixed); ambient; shadow and occlusion strength | A |
| Palette stage | On/off (on by default); method (nearest, ordered dither, error diffusion, neighbour statistics; E1 picks the default); dither strength; which palette entries terrain may use | A |

**Painted rocks and feature rocks are different things.** The rocks above
are terrain art. Reclaimable rock and tree *features*, which carry metal or
energy, are placed objects in the gameplay layer (Phase 6), using
`internal/mapgen`'s world feature lists. One tool could place both, so a
boulder field gets a few reclaimable rocks inside it, but they stay
separate kinds.

### 5.3 TA presets

A TA preset is a set of values with provenance. They come from calibration
(E0 in §8 Phase 2), measured from that world's sections and maps:

- rise against width;
- shoulder/face asymmetry by facing;
- ramp grades;
- rock share by slope and convexity;
- rim and shelf widths;
- grain and colour statistics in the palette.

Measured tables are allowed, under the policy the user set for the map
generator. A preset is "accepted" when blind review cannot tell its renders
from retail and the user approves it by eye.

The TA Archive packs extend this:

- **Cavedog's later official worlds** (Acid, Crystal, Slate, Urban, Water)
  become further TA presets, calibrated the same way.
- **Community worlds** can become *community presets*, credited to their
  authors, with the pack, author, URL and file hash recorded.

Community presets may ship, with credit (§11).

### 5.4 Artist workflow

- **Preset browser.** Pick a biome, copy it, edit it, save it as a new
  biome.
- **Parameter panels.** Grouped as in §5.2, each knob with a short
  description. Every change updates the view live.
- **Feature-kind tabs.** Edit how cliffs, hills and shores behave in this
  biome.
- **Shape inspector.** Overrides for the selected shape; "reset to biome".
- **Swatch to material.** Grain statistics measured from any image the
  artist supplies, such as a painting, a photo or a crop, and then
  synthesized in full colour. The artist's own example is a source; retail
  art is not required.
- **Palette toggle.** One switch between the TA palette view (the default)
  and full colour, plus a highlight of colours the palette represents
  poorly.

## 6. Target pipeline

The ideas come from Gaea (form → weathering → masks → colour) but the
pipeline is shaped for TA. Each stage caches its output by tile and is
invalidated by dirty region, so progressive refinement falls out of the
staging. The three parameter layers feed every stage.

```
Shape graph (vector, ordered)        plateau, hill, ridge, mountain, crater, ramp,
  │                                   canyon, deep/shallow water, flatten, terrace,
  │                                   optional section stamp, raster sculpt layer;
  │                                   later trees, metal, starts
  ▼
Authored height  (≈2–4 px)           form knobs; evaluated live while dragging
  ▼
Geology + weathering  (GPU, progressive)
  │   strata/fractures → hydraulic (flow, stream power) → thermal talus
  │   → debris release and tumble → sand transport (water-laid, wind-blown)
  │   protected flats, ramps and passages untouched
  ├─► masks: flow, wear, deposit, sand, talus, debris, wetness, exposure, curvature, AO
  ▼
Appearance detail  (1 px, shader)    micro-relief, fracture cuts, scree, boulders,
  │                                   ripples, decay: lit, never exported as height
  ▼
Material layers  (biome data)        coverage from masks; procedural or swatch grain
  ▼
Light (fixed TA sun)  →  full-colour image
  ▼
Palette stage  (on by default)       method chosen by E1; off shows full colour
  ▼
Bake: 32-px tiles + dedupe + 16-px heights + OTA + features → TNT/HPI (existing writers)
```

### 6.1 Built for full maps

The lab draws one 1024² canvas. The largest map in the local retail corpus
is 12800×7168 px (Cavedog Links): 92 million pixels, and about 367 MB as
one RGBA image. That size is the target. The visual phases may test on
small maps, but they follow these rules so a full map is "more tiles", not
a rewrite.

1. **World coordinates everywhere.** Shapes, objects, noise and seeds use
   world pixels (TA units), never canvas pixels. Map size (width and
   height in 32-px tiles) and sea level come from the map record from day
   one. The view is a camera that pans and zooms over the map, independent
   of the canvas.
2. **Fields live in chunks.** Authored height, geology, weathering outputs
   and masks are stored in fixed chunks (for example 512 px, aligned to the
   32-px art tiles and 16-px height cells). The lab's small map is just one
   to four chunks. A chunk is computed lazily, in a worker or on the GPU,
   and dropped when out of view.
3. **Results don't depend on chunking.** Noise and randomness are keyed by
   world position and node seed, never by evaluation or chunk order.
   Evaluating the whole map or chunk by chunk gives the same pixels, so a
   chunk boundary can never show up as a seam.
4. **Every process declares its reach.** A process that reads neighbours
   (blur, talus, debris tumble, shadows) states how far, and chunks are
   computed with that margin. A process with a global dependency must
   declare it and use a coarse global pass followed by local refinement;
   flow accumulation is the main one, since a river drains a whole map. E3
   is designed that way from the start.
5. **Edits invalidate regions.** Each shape node keeps world bounds in a
   spatial index. Moving, resizing or editing a piece re-evaluates only
   chunks under its old and new bounds, plus each process's reach.
6. **Fine detail is computed, not stored.** Only coarse fields (heights at
   about 2–4 px, masks) are kept per chunk. Pixel-scale relief, grain and
   the palette stage are computed in the shader for what is on screen, and
   the full-resolution image exists only while exporting, one chunk at a
   time.
7. **Zoomed-out views use levels of detail.** A whole-map view renders
   coarse chunks with cheap shading, and full detail resolves as you zoom
   in. A minimap comes from the same coarse chunks.
8. **Pieces and objects are first-class.** Drawn pieces can be selected,
   grouped, moved, rotated, scaled, duplicated, mirrored and copied between
   maps. They are lit after evaluation, so any transform is fine; only
   section stamps, whose light is baked, are limited to moving. Metal deposits, trees, reclaimable rocks and start
   positions are objects in a world-space layer beside the shape graph, with
   their own spatial index. TA draws features as sprites over the terrain,
   so objects are previewed as sprites and never baked into the tile art.
9. **The recipe is the map.** A save holds the shape graph, the objects,
   the parameters and the seeds, which is kilobytes even for a huge map.
   Every cache can be rebuilt.
   - A recipe pins the versions of its schema, presets and processes.
   - Re-rendering a recipe under newer versions is an explicit upgrade
     the artist sees, never silent: newer processes do not reproduce old
     pixels.
   - The exported TNT is the artifact of record for a released map.

## 7. Hosting

The user's direction is the browser, for example at `map.nanolathe.gg`.
Suggestions:

- **A static site.** WebGL2 for the live pipeline; move to WebGPU compute
  only if erosion at full map size needs it. No server is needed for
  editing.
- **Go compiled to WASM for export and checks.** The TNT, TDF and HPI
  writers, passability per movement class and `mapgen`'s feature and
  fairness logic run in the page. The editor then reuses the engine's code
  rather than a second implementation.
- **Retail files from the player's install.** Retail-derived inputs
  (palette, sections, any sampled textures) load from the player's own
  install, as the browser build already does with a folder drop. Presets
  and measured tables ship with the site. This is a suggestion consistent
  with current policy, not a decision.
- **A "Play this map" button** that hands the exported map to the browser
  build.

## 8. Phases

Phase 0's three units are independent and can run in parallel. After Phase
0, Phases 1 and 2 can overlap in separate worktrees as long as each unit
owns different files: Phase 1 owns the graph, evaluation and interface;
Phase 2 owns the process workers and shaders.

### Phase 0: Baseline, sections and editor skeleton (medium)

The lab branch `prototype/terrain-visual-round2` is under active
development by another agent. Phase 0 never edits it. Removing its flags
and rewriting its README are left to whoever owns that branch. Phase 0 has
three independent units.

- **Baseline capture (read-only).**
  - Commit the headless capture harness (`tools/map-editor/capture/`) and a
    scene × seed × biome manifest.
  - Capture the lab at its pinned commit e51bbb3a1, with its accepted
    defaults. Store the PNGs, timings and hashes outside Git.
  - These captures are the regression target the editor's TA presets are
    judged against. They replace "reproduce the lab pixel-exact".
- **Section catalog (Go, from `main`).**
  - `formats/sct.go` reads a section following [fmt tnt "SCT sections"]:
    header, tile grid, tile art, and the height byte of each record. The
    other record bytes stay unread (§4.6). The tests use a fixture authored
    in `testdata/`.
  - A catalog command walks `worlds.hpi` and any TA Archive `.hpi` packs,
    with provenance per pack (pack, author, URL, hash).
  - It writes each section as an art PNG, a heights array and a manifest
    entry: world, kind folder, size, rise, hashes. Derived files stay
    outside Git.
  - Contact sheets per world and kind become the feature vocabulary each
    biome's presets must cover.
  - TA Archive files downloaded before 2026-09-30 are broken and must be
    downloaded again. Start with Cavedog's later official worlds; add
    community worlds as Phase 4 needs them.
- **Editor skeleton (`tools/map-editor/`).** A new directory, built for
  full maps from its first line (§6.1 rules 1–3, 6–7):
  - **Map record:** size in whole tiles, sea level, biome.
  - **World coordinates** for everything.
  - **A camera** with pan, zoom and pixel-exact 1×/2×/4×.
  - **Chunked field storage**, with an authored-height field per chunk.
  - **The lab's renderer ported by copy** (`sculpt-renderer.js`, `.vert`,
    `.frag`, `-common.glsl`) and adapted to draw visible chunks. Its
    accepted default branches are kept and its ablation flags dropped. The
    source commit is named in the commit message.
  - **The palette stage** as a toggle, on by default, starting from
    nearest colour (E1 replaces the method).
  - **One configured asset root** instead of `/private/tmp` paths.
  - Brushes and the shape graph arrive in Phase 1, so the skeleton shows a
    map loaded from a simple height source: blank, or a lab v3 sketch
    imported as a raster.

Done when:

- one command captures the lab baseline;
- one command decodes and catalogs every section;
- the skeleton opens a blank 12800×7168 map and a lab sketch, pans and
  zooms across them, and renders with the palette stage on or off.

### Phase 1: Parameter model and shape graph (medium to large)

Phase 1 builds on the skeleton in `tools/map-editor/`.

- **Schema.** The three layers of §5.1 as one versioned JSON schema. The
  shader and workers read values only; no biome names appear in code.
  Re-express today's Green, Red and Archipelago as presets in it. Check
  their renders against the Phase 0 baseline capture on the same scenes,
  within a stated tolerance.
- **Shape graph.** An ordered list of nodes. Each node has geometry (an
  open spline path or a closed outline), parameters and overrides, a seed,
  and a height mode: *absolute*, *relative to the surface below* or
  *relative to an anchor node*. "A hill on a plateau" stays on the plateau
  when the plateau is raised.
- **Evaluation.** Recompute heights from the list, coarse while dragging and
  full on release, re-evaluating only nodes whose bounds overlap the
  change. Undo becomes graph operations. Saves become recipes (kilobytes
  rather than megabytes). A lab v3 sketch loads as a raster base node.
- **Brushes.** Port the lab's accepted brush profiles from e51bbb3a1 as node
  kinds: plateau, shouldered hill, mountain, graded ramp, deep and shallow
  water, smooth and lower. Keep its world-anchored noise and protection
  masks.
- **Shapes.**
  - Closed-outline tools: plateau/mesa, crater/basin, lake, island,
    flatten-to-level.
  - Path tools: hill/ridge, mountain range, canyon/valley, ramp,
    river/channel, shallow passage.
  - A terrace/step tool, and an optional section stamp (placed by
    translation; its border joined by a minimum-error cut through a grass
    collar).
- **Editing.** Select, move control points, edit overrides, reroll a seed,
  hide or solo a node, reorder.
  - Move, rotate, scale, group, duplicate and mirror pieces.
  - Copy and paste pieces between maps.
- **Region re-evaluation.** A spatial index of node bounds, and dirty
  chunks from old and new bounds plus process reach (§6.1 rules 4–5).

Done when:

- every existing example can be rebuilt as a recipe;
- a plateau's height can be edited with the features on top following it;
- moving a piece re-evaluates only the chunks it touched, with no seams;
- a preset can be copied, edited and saved as a new biome with no code
  change;
- the live re-evaluation interval during a drag stays at or under 16 ms on
  the reference scenes;
- **a scale smoke test passes**: open a blank 12800×7168 map, place and
  move shapes anywhere, and pan across it with the cheap preview, staying
  interactive and within a stated memory budget. Full-quality processes
  may still be off at that size.

### Phase 2: Processes and knobs, the quality phase (medium; ongoing)

Each experiment adds or changes a knob group. It is an A/B on identical
recipes and seeds, judged with the palette stage on, under §10. Every
process also follows §6.1:

- It declares its reach.
- It gives identical results chunked or whole, and the tests check this.
- Any global dependency is split into a coarse global pass and local
  refinement.

A process that only works on a small canvas is not accepted, however good
it looks.

The order:

- E0 comes first because it supplies the TA targets.
- E1 comes next because every later judgment is made through the palette
  stage.
- E2–E6 build the core of the surface: relief, erosion, strata, materials,
  grain.
- Then debris and boulders, then sand (the user's order).
- Then the rest.

| # | Experiment | Knob group | Addresses | Gain | Cost |
| --- | --- | --- | --- | --- | --- |
| E0 | Calibrate from sections: measure the §5.3 quantities per world and feature kind, plus a census of the palette entries retail terrain tiles use and retail's dither signature | All (TA presets) | Values chosen by taste | High | S–M |
| E1 | Palette stage bake-off: methods P1–P5 below | Palette stage | Pixel character of all TA output; how new biomes survive the palette | High | S–M |
| E2 | Slope-gated micro-relief oriented along the fall line (multi-octave ridged noise with derivative damping) | Form / detail | Smooth "embossed" slopes | High | S |
| E3 | Flow-accumulation erosion (D8/D∞ drainage, stream-power incision, fans) instead of the droplet pass | Hydraulic | Parallel rills; no dendritic gullies; hill streaks | High | M |
| E4 | Strata with differing hardness inside erosion | Geology | Missing ledges and clefts (retail The Pass, Gaea surface 3) | High | M |
| E5 | Materials from masks: exposure = f(slope, convexity, wear); soil in concavities and on ledges | Materials | Isotropic rock band; dark rim | High | M |
| E6 | Procedural grain per material layer, with colour statistics measured from retail for TA presets | Materials | New biomes need retail art today; double lighting; repetition | High | M |
| E7 | Debris: release from faces and crests, tumble down the fall line, settle at the angle of repose, sort by size, partial burial | Debris | Bare cliff feet; decal-like scree | High | M |
| E8 | Boulders and rocks: lit procedural shapes in the same sun; density, size range, clustering, embedding, sources (scattered, cliff foot, riverbed, beach) | Rocks | No rock objects in the art | Medium–High | S–M |
| E9 | Sand transport: water-laid deposits in basins and on beaches; wind-blown lee drifts and ripples; optional dunes | Sand | Flat uniform sand (Archipelago); no deposition story | Medium–High | M |
| E10 | Thermal relaxation of the whole surface to an angle of repose → talus aprons from geometry | Thermal | Scree as a decal | Medium | S |
| E11 | Oriented fracture sets (2–3 directions per formation, cell-based crack networks) | Geology | Isotropic noise-warped cracks | Medium | S–M |
| E12 | GPU erosion in WebGL2 fragment passes (pipe model, Mei et al. 2007) | Hydraulic | Erosion *while* dragging (goal 2) | Medium | L |
| E13 | Swatch to material: measure grain statistics from an artist's image | Materials | New biomes without retail art | Medium | M |
| E14 | Decay: edge rounding and crumbling of crests | Decay | Knife-edge or ink-line crests | Low–Medium | S |

**E1, the palette stage.** All methods work in a perceptual colour space
(OKLab), restricted by default to the palette entries retail terrain tiles
actually use (from E0's census). Candidates:

| Method | Idea | Strengths | Risks |
| --- | --- | --- | --- |
| P1 Nearest | Each pixel to its nearest entry | Simplest; the baseline | Banding on gradients; flat patches |
| P2 Blue-noise ordered dither | Per-pixel threshold from a fixed blue-noise mask, with a strength knob | Local and deterministic; cheap on the GPU, so it runs live; a local edit changes only local pixels; a mask period that divides the plain-tile period keeps level ground deduplicating | Can look like screen-door noise when strong |
| P3 Bayer ordered dither | The same with a regular matrix | Matches retail if E0 finds a periodic signature | Visible lattice otherwise |
| P4 Error diffusion | Floyd–Steinberg or Sierra Lite, serpentine scan, run per tile | Best fidelity on smooth gradients | Not local: one edit changes pixels downstream; CPU-bound; hurts tile reuse |
| P5 Neighbour statistics | Pick indices from conditional tables measured from retail, conditioned on full-colour value and material | Matched retail pixel character in the map-features work | TA presets only (or a swatch, via E13); tables per material |

Judge on four things:

- **Pixel look:** the user decides, because LLM reviewers miss pixel tells.
- **Stability while editing:** pixels changed outside the edited region.
- **Plain-tile deduplication** on level ground.
- **Cost per frame.**

My recommendation is P2 as the default, because it is the only candidate
that is local, deterministic and live. Strength 0 gives P1. P4 is an export
option if it wins on gradients, and P5 is a TA-preset option if it wins on
character. E0's measurement of retail's own signature comes first, because
it says which of P2, P3 and P5 to match.

**One comparison stays open.** For the TA presets, compare procedural grain
(E6) against the current sampled retail textures on identical geometry.
Procedural becomes the default only when blind review and the user can't
tell it apart from the sampled version. Until then, sampled textures stay
available as an optional texture pack. Either way, every knob works on both.

Done for a TA preset when blind reviewers' found-rate on its slopes,
plateaus and shores is at chance against retail decoys across two fresh
seeds, and the user accepts it by eye. Done for the knob system when a new,
non-TA biome can be built from scratch in the editor with no code change.

### Phase 3: Water and shores (medium)

In the earlier blind rounds, shores were what gave the generated maps away
(85% found, down to 45% after fixes). Carry those lessons over as water and
shore knobs and their TA defaults:

- a notched waterline at pixel scale;
- a partial one-pixel rim driven by exposure;
- shallow-water statistics banded by distance from shore;
- Euclidean, not chamfer, deep edges;
- reefs and islets with shallow rings;
- big lakes rather than ponds.

### Phase 4: More biomes and biome regions (medium)

Calibrate presets in the order the map-generator rounds found to read well:
Green, Red, Lava, Lunar, then Ice, Lush and Archipelago. Worlds with
sections (Archipelago, Green, Lava, Mars, Metal, Moon in `worlds.hpi`;
Acid, Crystal, Slate, Urban, Water and more in the TA Archive's official
downloads) calibrate directly. Others fall back to their maps.

Then add community presets, credited to their authors (§11). Finally, add
painting biome regions within one map, with transitions driven by the same
masks.

### Phase 5: Full-size performance (medium)

The rules of §6.1 are in place from Phases 0–2. This phase makes full-size
maps fast with every process on:

- A worker and GPU chunk scheduler that works on visible chunks first,
  then nearby ones.
- Levels of detail and a minimap.
- Memory budgets with eviction.
- Progressive full-quality weathering across a whole map.
- The scale smoke test repeated with all processes on.

### Phase 6: Objects and gameplay layers (medium)

- **The object layer (§6.1 rule 8).**
  - Place, move and delete metal deposits, trees, reclaimable rocks and
    other features, as sprites from the player's install.
  - Brushes that scatter features by density and masks: trees on gentle
    moist ground, rocks in boulder fields.
  - Start positions.
- **Data from `internal/mapgen`.** The world feature lists, metal readout
  and fairness measurement.
- **Overlays.** Buildability and passability per movement class, computed
  by the engine's own code in WASM.
- **Symmetry tools** for tournament maps.

### Phase 7: Export (medium)

- Bake 32-px tiles: quantize, deduplicate, enforce the tile budget, reuse a
  plain tile on level ground.
- 16-px heights, OTA and features → TNT/TDF → HPI with the existing writers.
- Validate by loading the result in Nanolathe and checking passability
  against the overlays.

## 9. Interface direction

- **Shape-first workflow.** Draw an outline or path → handles appear → edit
  in the inspector → reroll. Brushes remain for local sculpting as a raster
  layer node.
- **Panels.**
  - A layers panel (the shape graph) with visibility, solo, lock and
    reorder.
  - A biome panel holding the §5.2 knob groups.
  - Feature-kind tabs and a shape inspector for overrides.
  - A preset browser.
- **A variations strip.** The selected node or biome rendered at N seeds,
  or at N values of one knob, side by side; click to choose.
- **Views.**
  - Final and Quantized.
  - Clay and Slope.
  - Contours.
  - Each mask on its own: flow, deposit, sand, debris, rock.
  - Buildable/Passable.
  - Retail split.
- **Progressive feedback.** Shape immediately, erosion and deposits over the
  following frames, detail last. A small badge shows which stage the view is
  showing.

## 10. Evaluation protocol

Reuse the method from the map-features rounds rather than inventing one.

- **Suite.** The existing examples plus new crater, canyon, mesa, island
  and dune scenes, × three seeds, × each preset. Captured headless; recipes
  are committed, renders are not.
- **Tier 1, automatic.**
  - Determinism: same recipe → same pixels.
  - Ramp grade and level-crest checks.
  - Protected areas unchanged by weathering.
  - Frame interval while dragging, and refinement time.
- **Tier 2, blind LLM review.**
  - Fresh agents for each round.
  - Single 256-px sections at 100%, quantized.
  - Retail decoys from the same world that do not contain the crop.
    Sections used to calibrate a round are never its decoys.
  - Two or three reviewers per set; score found rate against false-alarm
    rate.
  - One change per round, A/B on identical crops; a fresh seed before
    claiming a result.
  - Known limit: LLM judges catch *layout* tells, not *pixel* tells.
- **Tier 3, human.** A checkpoint page with before/after toggles and
  retail split; the user's verdict goes in the ledger.
- **New-biome check.** A non-TA biome built from knobs alone is reviewed by
  the user for coherence, since it has no retail benchmark.
- **Expressiveness check.** Fit presets to a sample of TA Archive worlds
  that were never used in tuning, then run the same blind review against
  each world's own sections. Worlds the knobs cannot reach show which
  knob is missing. This is the best test of goal 6, artist freedom, short
  of real artists.

## 11. Decisions

Settled 2026-10-26:

- **Retail pixels in exports: allowed.** Sampled textures and section
  stamps stay available as options. Core capabilities do not depend on
  them.
- **Home: the browser** (`map.nanolathe.gg` suggested; §7).
- **Archipelago veins: they look okay.** Keep them; improve them through the
  sand, deposit and material knobs.
- **Parametric generation is the core** (Gaea-like knobs, TA presets, full
  artist freedom). Exemplar transfer from retail art is dropped from the
  plan.
- **Debris, rocks, sand and erosion are configuration knobs** (§5.2).
- **Full colour inside, TA palette at output.** On by default, switchable.
  The method is decided by E1 (TA: Kingdoms went true colour; the editor
  is ready for that).
- **Knob order:** debris and boulders first (E7–E8), then sand (E9).
- **Full maps are the target.** The editor works at any TA map size, with
  movable pieces, metal, trees and start positions. Visual phases test
  small but follow §6.1, and Phase 1 must pass the scale smoke test.

- **Community section packs may be used and redistributed.** The user
  treats the TA Archive packs as shared for TA players and modders to use
  and remix, and assumes permission from all their authors. Credit each
  author and record provenance per pack (pack, author, URL, hash). An
  author's request for removal is still honoured.

Still open, later:

- **True-colour maps in Nanolathe.** TNT tiles are palette indices, so a
  true-colour export would need a map-format extension and renderer
  support. That is a separate engine decision, owned by
  `research/extensions` and the renderer design when it comes up. Until
  then, full colour is a preview and a PNG export.

## 12. Glossary

Terms used throughout this plan:

- **Shape graph.** The ordered list of drawn shapes (plateaus, hills,
  ramps, water and so on) that the editor re-evaluates after every edit.
- **Node.** One entry in the shape graph, or one placed object.
- **Section.** A retail or community `.sct` file: one pre-rendered terrain
  feature with its own heights, as used by the official map editor.
- **Stamp.** A section placed whole into a map.
- **Preset.** A saved set of biome parameter values, for example the TA
  Green preset.
- **Chunk.** A fixed block of map area in which height, masks and
  weathering results are stored and computed.
- **Mask.** A per-pixel map of one property, such as slope, water flow,
  sand deposit or rock exposure, that materials and processes read.
- **Palette stage.** The final step that reduces full colour to TA's
  256-colour palette.
- **Grain.** The fine pixel texture of a material, such as grass speckle or
  rock grit.
- **Dither.** Scattering pixels of nearby palette colours so an area reads
  as a colour the palette lacks.
- **Talus and scree.** Loose rock that collects at the foot of steep
  slopes.
- **Strata.** Rock layers of differing hardness that erode into ledges.
- **Blind review.** Reviewers compare crops without being told which are
  generated and which are retail, and try to pick out the generated ones.
- **TNT, OTA, HPI.** TA's map terrain file, the map's text settings file,
  and the archive file maps ship in.
