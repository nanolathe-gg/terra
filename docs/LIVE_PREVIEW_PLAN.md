# Live preview plan: an editor that answers at once

Written 2026-11-11 against main `f3e126cd`, for an implementer agent. It
replaces "Track A: speed" in [REDESIGN_PLAN.md](REDESIGN_PLAN.md) section 5
and reorders that plan's cards R5 to R8b (section 7 below says how). It is a
plan: nothing in it is built.

**The owner's brief (2026-11-11):** "We need to increase the perceived
rendering speed and interactive responsiveness of Terraform. Artists need it
to feel fast (near instant) while making and editing maps and they need
close to realtime previews of the final result. The final render/export can
take longer." And, when declining `prototype/progressive-light` on
2026-11-10: "this probably needs a redesign ... with better tracking of what
is dirty and how to quickly render live previews." And on memory, while
this plan was being written: "we should target devices with at least 4-8GB
of RAM available (e.g. iPad, iMac, Macbook Pro are what I have to test), so
we aren't married to the 512MiB budget, feel free to expand it when it makes
sense."

## How to read this

- Claims are tagged **[measured]** (a number and its conditions), **[read]**
  (in the code, with the file), **[recorded]** (an earlier branch's or
  document's own record), **[by eye]** or **[inferred]**.
- My timings are two or three runs under Node on Dawn, on a GPU another
  agent's renders were sharing. Trust the ratios, not the absolute
  milliseconds. Card LP0 measures everything again in the page.
- Scripts, raw outputs and pictures are outside the repository in
  `~/terraform-assets/agent-live-preview/` (`timing.mjs`, `paged.mjs`,
  `levels.mjs`, `knobdiff.mjs`, `knobcost.mjs`, `levels/`).
- "Level" is the image's pixel size in art pixels, as `sculpt-canvas.js`
  uses it: 1 is final at 100% zoom, 2 is today's quarter image (half the
  width and height), 4 is a sixteenth.

## 1. Summary

**What is slow is not the pipeline's speed but its unit of work.** Every
interactive picture today is made of 256 px tiles, each of which runs the
whole pipeline over about eight times its own area, waits on a GPU readback,
and is copied through two canvases. One megapixel as sixteen quarter tiles
costs 460 to 1,230 ms; the same megapixel as one quarter pass costs 100 to
290 ms, and one level coarser 40 to 90 ms **[measured, section 3.2]**. World
sliders do not get even the quarter tiles: each input re-bakes the view at
final quality, one tile at a time, and each new input throws the plan away
**[read, section 3.1]**.

**The design, in five sentences.**
1. Every input is answered first by a coarse picture of everything it
   changed in the view, made in one pass (or the fewest passes the memory
   budget allows), by the same pipeline at a coarser level.
2. Quality then climbs a ladder (sixteenth, quarter, final) while input is
   quiet, nearest the place the artist last pointed first, and any new input
   takes the GPU back within one bounded unit of work.
3. What is dirty is tracked by stage and by rectangle, derived from what an
   edit actually changed (the uniform values, the lattice rectangle), not
   declared by hand, so nothing above the first changed stage is redone.
4. Colors, shine, light strengths and palette then rerun only the color
   stage, at final quality, from a kept record of each visible tile's
   geometry.
5. The final picture and the export never depend on which previews ran.

**Expected effect** (targets; LP0 to LP3 confirm them in the page):

| Interaction, 16x16 map, cliff view of about 1.8 megapixels | Today | After LP2 | After LP3 | After LP5 |
| --- | --- | --- | --- | --- |
| Stroke drag: input to every changed part of the view current | 0.6 to 1.1 s for the whole view as quarter tiles **[measured]** | 0.1 s (one pass measured at 59 to 110 ms under Node) | under 0.1 s | |
| Rock, surface or sun slider: input to whole view current | about 2.2 to 2.5 s (28 final tiles at 78 to 90 ms) **[inferred from measured tiles]**; 1.6 to 2.6 s **[recorded]** | 0.1 s at the coarse level | under 0.1 s | |
| Color, shine or light-strength slider | 0.6 to 1.1 s **[recorded]** | 0.1 s at the coarse level | | 0.15 s at final quality **[inferred]** |
| First gate crossing of a session | 0.7 to 1.3 s stall **[recorded]** | no stall | | |
| Longest GPU submission that input must wait behind | a Time pass, 0.3 to 2.1 s **[measured]** | | 0.1 s (LP4) | |
| Release to final, whole view | 2.2 s **[recorded]** | within 10% of today | | less (LP6) |

**Memory.** The terrain budget's default rises from 512 MiB to 2,048 MiB
(the owner, above). That alone lets the whole view be one preview pass on a
16x16 map today; at 512 MiB it must be four (section 3.3). Nothing in this
plan needs more than about 2 GiB, and more would not make it faster
(section 8).

**Order:** LP0 bench, LP1 dirty model, LP2 preview blocks for every
interaction (with no compile and no long task on the input path), LP3
cheaper blocks, LP4 bounded GPU work, LP5 color-only rerun, LP6 faster
final. LP2 is the go/no-go: if the page does not show at least three times
better whole-view latency than main, stop and report.

## 2. Goal and budgets

**Device and workload [owner decisions, REDESIGN_PLAN section 2 and
2026-11-11].** Devices with at least 4 to 8 GB of memory available; the
owner tests on a MacBook Pro (Apple M3 Pro, 18 GiB; every number here is
from it), an iMac and an iPad. A 16x16 map at 100% zoom. The terrain budget
is a setting, default 2,048 MiB after LP2; the design must still work, in
more blocks, at 512 MiB, which is what a device with 4 GB may allow one page
(not measured: what Safari on the iPad grants is still unknown). Measure on `repro/perf.mjs map16` with
the view the earlier baseline used (1208 x 841 art pixels) and with a large
one (1728 x 1024, `--viewport`), on three scenes: `green-modern-2` (cliffs,
granite, whole blocks), `red-3` (the costliest world on main) and `green-7`
(flat).

**Budgets (p95 unless said).** Each is three numbers, as REDESIGN_PLAN
section 2 asks: input to first changed pixels, input to the whole view
current at any level, and pause or release to final.

| | First changed pixels | Whole view current | Final |
| --- | --- | --- | --- |
| Stroke, move, shape-card slider | 50 ms | 100 ms, coarse level | focus tile 0.6 s after a pause; view within 10% of today, then LP6 |
| World, rock or surface slider | 50 ms | 100 ms, coarse level | same |
| Color, shine, light strength, palette | 50 ms | 150 ms at final quality (LP5) | same picture |
| Time controls (Rain, Deposit supply) while held | 100 ms | at the coarse Time pass's rate (LP3), else each completed pass | same |
| Pan or zoom onto ground with no image | 50 ms | 100 ms, coarse level | as today |
| First picture after load | | 1.0 s, coarse level | final no more than 10% later than today |

And four that hold everywhere:
- **No GPU submission longer than 100 ms** while the editor accepts input
  (50 ms for a preview unit).
- **No main-thread task over 50 ms** during a drag; a slider's `input`
  handler under 4 ms.
- **No pipeline compile** between an input and its preview.
- **Early pictures may cost the final at most 10%** (the limit card H7b used
  when it rejected quarter-first on load: final came 15% later
  **[recorded, BACKLOG.md:4582]**).

Export has no budget; it keeps its progress and cancel.

## 3. Findings

### 3.1 What each interaction does today [read]

- **Stroke, move, shape-card slider.** `interacting()` is true
  (`sculpt-canvas.js:38`; `previewActive` is `stroke||moving||controlsEditing`,
  `sculpt.js:921`). The plan asks for a quarter image of each visible 256 px
  tile (`sculpt-canvas.js:293`), the tile nearest the pointer first, then the
  oldest stale one; one tile bakes at a time.
- **World and rock sliders** (247 rows). Each `input` event runs `setKnob`
  (`sculpt.js:1816`): `history.replaceState`, `applyKnob`, `saveWorlds` (a
  localStorage write), `syncWorldControls`, then the whole image cache is
  marked dirty twice, once by the wrapped `applyKnobs`
  (`sculpt-canvas.js:64`) and once by `markViewChanged`. `interacting()` is
  false, so the plan is final-level tiles (`sculpt-canvas.js:299`), and every
  new event changes `epoch` and cuts the plan after at most one tile
  (`sculpt-canvas.js:303`). The view is a patchwork until the pointer stops,
  then needs every visible tile at final.
- **Colors** take the same path through `setColors`
  (`sculpt-canvas.js:65`).
- **Release.** The Time pass is one GPU submission of all its iterations
  (`sculpt-erosion.js:108-128`) that nothing can stop; final tiles hold for
  it for up to 8 s (`sculpt-canvas.js:262-265`).
- **A gate crossing** (a slider leaving 0) throws `SpecializationMiss` and
  compiles three pipelines before anything draws
  (`sculpt-renderer.js:489-546`): 0.7 to 1.3 s the first time
  **[recorded, card P6]**.
- **One tile** (`sculpt-chunk-renderer.js:331`, `sculpt-volume.js:65`):
  gather the lattice into four textures; bake the relief over the tile plus
  an apron of about 200 px on each side; classify the voxel bricks; **wait
  for a mapped readback of the brick count**; build the solid; four wear
  passes; march and shade; copy the WebGPU canvas into a 2D canvas; make an
  `ImageBitmap`; draw it. Nothing but the bitmap is kept.

### 3.2 Where a megapixel goes, by unit of work [measured]

Main `f3e126cd`, Node on Dawn (Metal), 4x4 map, the 1,024 px window at the
map's corner, renderer budget raised to 1 GiB so that nothing splits. Wall
milliseconds for the window with the queue drained; two runs; the sum of GPU
pass times from timestamp queries beside them.

| `green-modern-2` | Level | Wall, two runs | GPU passes | Bricks |
| --- | --- | ---: | ---: | ---: |
| 16 tiles of 256 (the view's tiles today) | 1 | 1,786 / 2,162 | 1,565 | 435,164 |
| 4 tiles of 512 | 1 | 949 / 952 | 840 | 298,598 |
| 1 pass of 1,024 | 1 | 884 / 929 | 846 | 298,598 |
| 16 tiles of 256 (today's preview) | 2 | 461 / 727 | 293 | 63,717 |
| 4 tiles of 512 | 2 | 228 / 230 | 174 | 40,683 |
| 1 pass of 1,024 | 2 | 149 / 158 | 136 | 30,911 |
| 16 tiles of 256 | 4 | 228 / 273 | 88 | 11,435 |
| 1 pass of 1,024 | 4 | 40 / 43 | 31 | 5,221 |

| Wall ms, two runs | `desert-2` | `red-3` | `green-7` (flat) |
| --- | ---: | ---: | ---: |
| 16 x 256 at level 1 | 1,081 / 1,128 | 1,133 / 1,351 | 1,695 / 2,186 |
| 4 x 512 at level 1 | 471 / 525 | 526 / 600 | 846 / 962 |
| 16 x 256 at level 2 (today's preview) | 566 / 634 | 526 / 1,233 | 1,077 / 1,151 |
| 1 x 1,024 at level 2 | 99 / 106 | 217 / 287 | 209 / 252 |
| 1 x 1,024 at level 4 | 30 / 42 | 83 / 89 | 56 / 81 |
| A 1,728 x 1,024 view in one pass, level 2 | 172 to 238 | 276 to 351 | 269 to 344 |
| The same view in one pass, level 4 | 58 to 70 | 67 to 117 | 69 to 89 |

What the tables say:
1. **A quarter megapixel in 256 px tiles costs 3 to 5 times one pass**, and
   a sixteenth 5 to 6 times. At these levels the GPU work is small (31 to
   136 ms); the rest is per-tile overhead: the apron (16 tiles build 2 to 2.2
   times the bricks of one pass and bake 6 times the relief), the readback
   wait, allocation and bind groups. Wall minus GPU is 10 to 27 ms a tile.
2. **At final the solid is the cost**: in the one-pass row, build 579 ms
   (68%), wear 134 (16%), march and shade 83 (10%), relief bake 21. This
   agrees with REDESIGN_PLAN section 3.4, on today's heavier rock.
3. **At level 2 the draw is 42% of the GPU time** (57 of 136 ms), because
   the preview shades a full-resolution raster and averages it down
   (`rasterScale`, `sculpt-chunk-renderer.js:168`). That raster is there on
   purpose: it took the preview's color bias from 4.14 to 0.41 on Green and
   8.00 to 0.026 on Red **[recorded, commit `80aad369`]**. Do not remove it
   without measuring that bias again.
4. **One whole-map Time pass**: 316 to 2,134 ms across the four scenes under
   this load (416 to 875 ms alone **[recorded]**), about 156 MiB while it
   runs **[recorded]**, in one submission.

### 3.3 The same on a 16x16 map, by memory budget [measured]

A 16x16 map is paged, and the page lets one bake use what the budget leaves
beside the page fields. `paged.mjs` plays `green-modern-2` at (2048, 2048)
on a 16x16 map and reserves what the page reserves. Wall milliseconds,
three runs each.

| 1,728 x 1,024 view, 16x16 map | 512 MiB | 1,024 MiB | 1,536 MiB |
| --- | ---: | ---: | ---: |
| One pass, level 4 | **refused**: needs 697 MB | 59 / 74 / 102 | 69 / 76 / 110 |
| One pass, level 2 | **refused**: needs 721 MB | 208 / 224 / 276 | 228 / 249 / 289 |
| 4 blocks of 864 x 512, level 4 | 192 / 198 / 209 | | |
| 4 blocks of 864 x 512, level 2 | 383 / 393 / 405 | | |
| 28 tiles of 256, level 2 (today's preview) | 827 / 851 / 1,132 | 769 / 787 / 798 | 632 / 652 / 868 |
| One final 256 tile | 78 to 90 | 82 to 92 | 76 to 85 |
| One final 512 tile | 386 to 476, in 4 pieces | 252 to 264, one piece | 285 to 305, one piece |

Memory in those runs: the page fields 240 to 313 MiB; the renderer's peak
276 MiB for the coarse view pass, 392 for the quarter view pass, 295 for an
unsplit final 512 tile, 151 for a final 256 tile.

1. **With 1 GiB or more, the whole view is one pass today: about ten times
   faster than today's quarter tiles at the coarse level**, and about three
   times at the quarter level, with no engine change.
2. **At 512 MiB it does not fit, and the reason is not the level.** The
   lattice textures a pass reads do not shrink with the level, and they are
   padded to powers of two: 208 MiB for the view (a lattice of 1,278 x
   1,036 cells stored as 2,048 x 2,048 at 48 bytes a cell; `estimate()`,
   `sculpt-chunk-renderer.js:126`). Blocks that do fit still beat tiles by 4
   to 5 times at level 4 and 2 to 2.5 times at level 2. So the unit of
   preview work is "the largest block that fits": the budget decides how
   many blocks a view is, never whether previews work.
3. **A final 512 tile needs the memory too**: at 512 MiB the solid splits it
   into four pieces, each with its own halo, and it gains nothing over four
   256 tiles; at 1 GiB it is one piece.

### 3.4 What the levels look like [by eye]

`~/terraform-assets/agent-live-preview/levels/<scene>/sheet.png`: final,
level 2 and level 4 of the same crop, drawn as the page draws them at 100%.
Level 2 reads as the same picture, softer. Level 4 is blocks of 4 x 4 art
pixels: landforms, cliffs, shadows and the broad colors read, grit and
joints do not, and Desert's sand comes out pinker and noisier than final
(the average of palette colors is not a palette color). Level 4 answers
"where and how big"; it cannot answer "is this grit right". That is why the
ladder must reach final quickly where the artist is looking, and why the
look of the coarse level is the owner's call (section 8).

### 3.5 What a control changes [measured]

- `applyKnobs()` takes 0.23 ms (median of 50) and `setColors()` 0.11 ms: the
  renderer's side of a slider event is free. The rest of `setKnob` runs in
  the DOM and is not measured yet (LP0).
- The uniform block has 346 fields in 14,640 bytes. Stepping one World row
  and comparing the block before and after names the fields it moved
  (`ambient` moves `ambient` and nothing else). Of the 247 rows: 100 move a
  uniform when `applyKnobs` runs; 111 only once `bakeFields` writes its
  share (`sculpt-renderer.js:1085`); 36 move none through either. Those 36
  act through other channels: the shape context (undulation, face
  steepness, coast ramp, frost gaps), the Time pass (Rain), the sun (set in
  `draw`), plant cover, and rows whose feature is switched off (a shine
  row's sharpness while its gloss is 0).

So "what did this input change" can be computed, once every world-level
uniform is written in one place.

### 3.6 What earlier branches showed [recorded]

| Branch | What it did | What to take from it |
| --- | --- | --- |
| `prototype/progressive-light` (declined) | Kept main's cache and dirty flags. Each dirty tile still ran feed, bake, classify, readback, build and wear; only then did the **shading** refine in strides 8, 4, 2, 1. Its light record was per-piece scratch, so a light edit still rebuilt the solid. It also changed the lighting model, moved 56% of pixels and came out pink. First fresh tile 336 to 431 ms; release to final 1.5 to about 3.7 s. | Refine the expensive stage or nothing shows early. Never bundle a look change with a speed change. Fill the view, not a piece. |
| `s0/slider-response`, tip `10477351` (not landed) | A pointer held on a World slider counted as an interaction: quarter tiles. Ambient's whole view fell from 624 to 1,499 ms to 258 to 261 ms. | Not landed because a held Rain slider showed the old weather, a paged map baked no tile during Rain and Face drags, and there was no clean timing. LP2 must pass exactly those cases. |
| `cc71df74` (landed) | One Time pass at a time; of the waiting requests only the newest runs. | Keep. LP4 adds slices, so the one in flight can stop. |
| `perf/shape-interaction` (landed) | Stale images stay up and are marked dirty; a tile is dirty by its input footprint; `changedWeatherTiles` compares Time results on the GPU and re-bakes only changed tiles; oldest dirty tile first. | The rectangle half of the dirty model exists. Build on it. "A fresh tile completion is not a whole-viewport frame" is its own stated limit. |
| P6, `prototype/specialize` (landed) | Gates as pipeline constants: 24 to 28% off the terrain pass; a cold crossing stalls 0.7 to 1.3 s; 1 to 12 px of compiler drift in 7 scenes. | A preview must not wait for a compile. Final pictures must keep the specialized pipelines (the drift). |
| H7b (landed) | Quarter tiles while dragging. Quarter-first on load put final 15% later and was rejected. | The 10% limit of section 2. |
| `prototype/go-wgpu` (parked) | A GPU worker with coalesced requests: the pointer's tile p95 fell from 279 to 40 ms while the first tile anywhere went from 16 to 33 ms. | Ordering and dropping superseded work did that at least as much as the worker. Measure the main thread before proposing a worker. |
| `rd/voxel` (not for main) | Thin shell: 13 to 23% off a cliff window, identical by eye. Brickless: faster at final, 75 to 115% slower at the preview level. | LP6. And: "coarse bricks for preview beside a brickless final would be a second render path". This plan's previews are the one brick path at a coarser step. |
| Height-field rays, cached height mesh | 10 to 20% on the mesh renderer, nothing visible in the editor. | Do not repeat. |

## 4. Design

### 4.1 Principles

1. **Answer first, refine after.** An input's first picture covers
   everything it changed in the view. A fresh tile is not an answer.
2. **A preview is the pipeline at a coarser level over a larger rectangle.**
   Same shaders, same stages, same bricks, a larger step. No second
   renderer, no preview-only shading (rule 7; REDESIGN_PLAN principle 5).
3. **A preview predicts the final.** Ground, cliffs, water and shadows land
   where the final puts them; only fineness differs.
4. **Dirt is computed, by stage and rectangle.** An edit is turned into "the
   first stage it touches, where" by comparing state, not by a table
   somebody keeps.
5. **Input owns the GPU.** No unit of submitted work is longer than the
   budget, and queued work an input has replaced is dropped.
6. **Final is final.** The final picture of a tile is a function of the
   scene alone: not of the previews shown, the order of work, or what was
   cached (rule 12). Export never reads a preview or a kept record.
7. **No look change rides along.** Every card through LP4 leaves every check
   scene byte-identical (`--worlds none`).

### 4.2 The dirty model

**Stages**, as REDESIGN_PLAN section 4.2 names them: A shape (the lattice),
B Time (the lattice), C surface (relief bake, loose-stone mask, rock
runoff), D solid (voxel build and wear), E geometry (march, normal, shadow,
occlusion), F color (materials, light composition, water, palette).

**State.** One counter, `serial`, goes up on every change of any kind. Two
records say what changed:
- the **lattice log** that exists (`changeLog`, `sculpt-canvas.js:80`): a
  rectangle per shape edit, plus the tiles `changedWeatherTiles` reports
  when a Time pass lands;
- a **world revision per stage** (`rev.B` to `rev.F`), bumped when a
  world-level input of that stage changes.

**How a world change finds its stage.** Not by hand:
1. *One writer.* Move every world-level uniform write into one function,
   `syncWorld(options)`, called by `applyKnobs`, `setColors`, `setRocks`,
   `setColumn` and whenever the draw options change. Today they are written
   in three places (`applyKnobs`; `bakeFields`, 111 rows; `draw`, the sun and
   a few more), so a comparison at input time misses most of them. After
   this, `bakeFields` and `draw` write only per-chunk values (`uChunk*`,
   `uLooseGrid`, the painted flags). This is a refactor that must leave
   every scene byte-identical.
2. *Compare.* After `syncWorld`, compare the uniform block with its last
   copy; the layout (`renderer.layout.fields`) names the changed fields.
3. *Field to stage.* Built once at startup from the shader sources the page
   already parses for gates (`sculpt-gates.js`): for each uniform member,
   the entry points whose code reaches it through the call graph. Reached by
   the relief bake, loose mask or runoff passes: C. By a `voxel*` compute
   pass: D. By the fragment's geometry functions (`voxelHit`, `voxelNormal`,
   `occlusion`, `visibility`, `engine-frag.wgsl:1458-1541`): E. Only by the
   rest of the fragment: F. A field's stage is the earliest of these. A
   static reference is a superset of a real dependency, so the map errs
   toward redoing too much, never too little.
4. *Other channels are declared, and default to the earliest stage.* A
   short explicit list for inputs that are not uniforms: the shape context
   (A), the Time knobs (B), material textures and the placement table (F),
   the reach of `reaches()` (C: it moves every tile's input). Anything not
   on the list and not a uniform invalidates from A.
5. *No change, no work.* An input that moves no field and no declared
   channel schedules nothing. Today it re-bakes the view.

**Rectangles for world changes.** A change inside one rock preset's rows of
the rock table dirties only the union of the strokes that use that preset
(plus the bake's reach), not the map. Everything else world-level is the
whole map.

**What a kept thing records.** Every final tile image, geometry record (LP5)
and preview block records the `serial` its inputs were taken at, the `rev`
of each stage, its input rectangle (as today), its level and whether it read
weather. From that: it is *current* if nothing since touches it, else *stale
from stage s*.

**Which image the artist sees**, per visible tile, bottom to top:
1. the tile's final image if it has one, stale or not;
2. any preview block over it whose `serial` is greater than that final's
   (coarse, then quarter), clipped to the tiles for which that holds;
3. the tile's final image again if it is current.

So unchanged ground stays crisp, changed ground shows the newest preview,
and a final replaces the preview when it arrives. The one call the rest of
the editor makes is `canvas.changed({stage, rect})`; `clear()` and the
wrapped `applyKnobs` and `setColors` go.

### 4.3 The preview ladder

Levels follow the view's final level `L` (`detailLevel()`: 1 up to 100%
zoom, .5 to 200%, .25 beyond): **coarse** is `4L`, **quarter** is `2L`,
final is `L`. The overview ("Fit") path is left as it is.

**A preview block** is one `renderChunk` over a rectangle of the view at a
preview level:
- The area to cover is the visible part of what is stale: the whole view for
  a world change; for a lattice edit, the change's rectangle grown by the
  renderer's reach.
- It is cut into the fewest blocks whose `renderer.estimate()` fits the
  room a bake has today. Blocks start on a 64 px world grid, so a block's
  pixels land on the same places whatever the scroll offset.
- Making room for a preview never evicts a final image that is in view.
- Each level in use keeps its own working textures. Today one set is
  reallocated whenever the size or level of a bake changes
  (`allocationKey`, `sculpt-chunk-renderer.js:177`), which alternating
  previews and finals would do on every step. The lattice input textures,
  the largest part, are the same lattice at every level and are shared.
- A block's image is kept in a 2D canvas of its own (the copy `renderChunk`
  already makes), not an `ImageBitmap`: one synchronous copy, no await.
- The per-tile quarter path is **removed**, not kept beside this: the
  `want: 2` plans, the cold-tile `authoredPreview` path and the pointer-turn
  logic that served them (`sculpt-canvas.js:274-301`). Rule 7: no flag
  keeps the old path.

**When each level runs.**
- *Coarse*: at once, for every input and for ground that scrolls into view
  with no image. Newest input wins: one block in flight, and a queued block
  an input has replaced is dropped. During a canvas gesture the block under
  the pointer goes first.
- *Quarter*: when no input has arrived for about 100 ms and the coarse
  picture is current. Also right at release, while the Time pass runs.
- *Final*: when no input has arrived for about 250 ms, or on release;
  visible tiles in order of distance from the **focus point** (where the
  pointer last was over the canvas; the view's center if it has not been),
  then the ring outside the view as today. A pointer still held on a slider
  does not prevent this: a pause is a request to see the result.

The two delays are implementation constants (rule 9), tuned on the bench.

**Every interaction uses it**: strokes, moves, shape cards, section curves,
World and rock rows, colors, surface sliders, undo and redo, pan and zoom,
and load.

### 4.4 The scheduler

One queue, one unit on the GPU at a time, highest first:
1. the shape evaluation an edit needs (as today);
2. coarse blocks;
3. color-only reruns (LP5);
4. quarter blocks;
5. Time pass slices (LP4);
6. final tiles, one voxel piece at a time;
7. background work as today (feature fitting, passability, the overview).

An input bumps `serial`; the unit in flight finishes (it is bounded), and
everything queued below the input's needs is planned again. A final tile
checks for staleness between its pieces and stops.

### 4.5 Input handling

- A slider's `input` handler stores the newest value and updates its number.
  **One application per animation frame** runs `applyKnob`, `syncWorld`,
  the comparison and `canvas.changed`.
- The address bar, `saveWorlds`, `syncWorldControls`, `persistLater` and
  the undo checkpoint run on `change` (release), or after about 250 ms
  without input. LP0 measures each first; only what costs more than 2 ms an
  event needs moving.
- A held Time control never queues a pass per input (as `cc71df74`); LP3 and
  LP4 say what it shows meanwhile.

### 4.6 Pipelines

- **A generic set.** Build, at startup and in the background, one set of
  draw, bake and loose pipelines in which every gate is the uniform
  comparison it was written as (no constants). It is the same shader source,
  so it is the same render path.
- **Previews** use the specialized set when it is cached and the generic set
  when it is not, and never wait. **Finals** always use the specialized set
  (generic and specialized differ by 1 to 12 px of compiler drift), which
  compiles in the background while previews show.
- The voxel passes specialize only on `rockMask` (0 or 15); build both at
  startup.

### 4.7 The color-only rerun

Split the fragment into two entry points over the same functions:
**geometry** (the march, the normal, shadow, occlusion and every other read
of the solid) writing a per-pixel record, and **color** (everything else)
reading it. A final tile is always geometry then color, so there is still
one path; a change whose first stage is F reruns color alone for the visible
tiles, at final quality.

- The record is kept for visible final tiles only and is the first thing
  evicted. At full precision it is 32 to 48 bytes a pixel: 57 to 85 MiB for
  a 1.8 megapixel view **[computed]**.
- The color stage still needs the tile's lattice textures and relief bake,
  which are not kept. Recomputing them is cheap next to the solid: feed and
  bake are 23 of 846 ms in section 3.2's one-pass row. Keep the record;
  recompute those; run them for the view in blocks, as previews do.
- Expected cost: feed and bake plus a color pass, of the order of 60 to
  150 ms for the view **[inferred: the color share of the draw was 9 to
  11 ms a megapixel in REDESIGN_PLAN section 3.4 and has not been measured
  since]**.
- Sun height and turn are stage E, and E's shadows read the solid, so they
  stay on the ladder.

### 4.8 What this plan does not do

No second renderer and no preview-only shading. No brickless solid. No
worker unless LP0 and LP4 show main-thread frames the budget cannot absorb.
No new buttons, panels or controls (rule 3; section 8 lists two proposals).
No change to any final pixel through LP4. No retail tuning. No new entries
in `repro/check.sh`: the benches here are scripts run on demand (the
owner, 2026-11-09: "we already have too many tests").

## 5. The cards

Sizes: S about a day, M a few days, L a week or more. Each card lands by
itself, on its own branch, after the land tier passes.

### LP0. The bench (S; first)

**Change.** Extend `repro/perf.mjs`; no editor code.
- New phases, driven by real mouse events on the page's own controls:
  `slider` (one row each of: a rock row, `knob-faceBlockSize`; a surface
  row, `knob-reliefAmount`; a light row, `knob-ambient`; the sun,
  `knob-sunHeight`; Rain; one Colors picker), each as a continuous drag
  through at least 30 values, a drag that leaves 0 (a gate crossing, cold),
  and a drag with a pause in the middle; `resume` (a stroke begun 100 ms
  after a release, while the Time pass and finals are in flight); and the
  existing `drag`, `release`, `scroll`, `load`.
- For each: the three numbers of section 2 (the existing `latency`,
  `latencyPointer` and `latencyAll` fields are the first, the pointer's
  tile, and the whole area; report all three, never one), frame intervals,
  long tasks, the handler's own time per event split by callee
  (`replaceState`, `saveWorlds`, `applyKnobs`, `syncWorldControls`), the
  longest single wait on the GPU queue, pipelines compiled during the phase
  (`specStats`), `bitmap copy` time, peak memory.
- Run it on `map16` and `map4`, three scenes, two view sizes.

**Accepted when** the table of section 2 prints for main with every cell
filled, from alternating runs on a quiet machine (check
`ps -Ao pcpu,command -r` first; discard one warm-up per server), and the
report says which budget cells main already meets.
**Risk.** The first run against a fresh server measures nothing
(known); CDP ports must not be reused across checks (known).

### LP1. The dirty model (M)

**Change.** Section 4.2, with no change in what is drawn.
1. `syncWorld`: one writer for world-level uniforms. Byte-identical scenes.
2. The comparison, the field-to-stage map from the shader call graph, the
   declared channels, `serial` and `rev`.
3. `canvas.changed({stage, rect})` replaces `clear()`, the wrapped
   `applyKnobs` and `setColors`, and `markViewChanged`'s second
   invalidation. Entries record `serial`, `rev`, input rectangle, level.
4. An input that changes nothing schedules nothing; a rock preset's rows
   dirty only its strokes' ground.
5. A debug read-out for the bench and for review: `sculptDebug.dirty()`
   returns, for the last input, the changed fields, the stage, the
   rectangle and the count of tiles made stale. No UI.

**Files.** `sculpt-renderer.js` (`applyKnobs`, `bakeFields`, `draw`,
`setColors`, `setRocks`, `setColumn`), `sculpt-chunk-renderer.js`,
`sculpt-gates.js` (the call-graph scan beside the gate scan),
`sculpt-canvas.js`, `sculpt.js` (`setKnob`, `setPresetKnob`,
`markViewChanged`), `repro/headless.mjs` if it calls what moved.

**Accepted when** the land tier passes with `--worlds none`; each of the 36
rows of section 3.5 that move no uniform is either on the declared list or
shown to schedule nothing; and the report lists every World row's computed
stage and rectangle. The stage map cannot be proved in this card, because no
cache below the final image exists yet for a stage to skip: until LP5 the
editor acts only on "nothing changed", "this rectangle" and "everything".
LP5's step 0 is where the map is proved against full re-bakes.
**Risks.** `syncWorld` must write the same values the three writers wrote,
in every state (a fed chunk's painted flags are written by the GPU and must
stay out of the comparison, `sculpt-chunk-renderer.js:254-289`). Count
changed pixels on every check scene and report the number, even when it is
0.

### LP2. Preview blocks for every interaction (L; the go/no-go)

**Change.** Sections 4.3 to 4.6, with today's lattice input.
0. The terrain budget's default goes to 2,048 MiB (`gpuMB`,
   `sculpt-canvas.js:35`; the panel's field keeps its 128 to 4,096 range),
   and `pagedBudget`'s minimum grows by the preview's working set, so the
   pages never take the room a view pass needs. At that default the view is
   one block (section 3.3); the planner still cuts blocks, for smaller
   budgets and larger views.
1. The block planner, the kept block canvases, the painter's three layers,
   a working set per level.
2. The ladder's timing and the focus point.
3. Every interaction on it, World rows and colors included. Remove the
   per-tile quarter path.
4. One application per frame for slider input; persistence on release.
5. The generic pipeline set; previews never wait.
6. Load and pan: a coarse block for ground with no image.

**Files.** `sculpt-canvas.js` (most of `frame`, `bake`, `paint`,
`presentView`, `schedule`), `sculpt-chunk-renderer.js` (blocks that are not
tile-sized; the room a preview may take), `sculpt-renderer.js` (the generic
set), `sculpt.js` (`setKnob`, the row handlers, `previewActive`),
`sculpt-gates.js`.

**Accepted when**, on LP0's bench, alternating with main:
- whole-view-current p95 for a stroke drag and for a rock slider is at
  least **three times** better than main on `map16` at the new default
  (section 3.3 predicts about 10), and at least twice at 512 MiB, where the
  view is four blocks; if not, stop and report;
- no phase compiles a pipeline between an input and its preview, and no
  long task appears in any drag;
- the three cases `10477351` failed pass: a held Rain slider does not show a
  picture that ignores the edit as current (it shows the new value's
  picture or says the weather is pending, as the state text does today); a
  paged map updates during Rain and Face steepness drags; clean alternating
  timings exist;
- release-to-final and load-to-final are within 10% of main;
- final pixels: the land tier passes with `--worlds none`, and the view's
  final tiles after a scripted session of drags and slider moves equal a
  cold bake of the same scene byte for byte (a bench step, not a new check);
- the color bias of each preview level against final, by the measure
  `repro/interaction` used for `80aad369`, is reported for Green, Red and
  Desert.
**Risks.** The block seam: blocks and tiles each read their own apron, so
there must be none; look at a block boundary on a cliff at 512 MiB. Memory:
the report gives peak terrain memory at the default on `map16` (expected
about 1.0 to 1.3 GiB with a 1.8 megapixel view: fields 313 MiB, the three
levels' working sets with shared inputs about 755, canvases and caches about
115 **[computed from section 3.3's peaks]**), and the smallest budget at
which the page still previews.

### LP3. Cheaper blocks (M)

**Change.** Shrink a preview pass's fixed cost and working set: for the
100 ms row where LP2 misses it, for views larger than 1.8 megapixels (an
iMac's), and so that a device held to 512 MiB (perhaps the iPad) still gets
the view in one block. Measure after each step; stop when section 2's rows
are met.
1. **Exact-size inputs for preview passes.** A preview target is sized to
   the view and reused, so it needs no power-of-two padding: 208 MiB to
   about 63 for section 3.3's view **[computed]**.
2. **The lattice at the level's spacing.** A coarse block reads a lattice at
   4 px, a quarter of the cells again. Two routes exist in the code; measure
   both and keep one: decimating the resident pages (`decimate`,
   `sculpt-gpu-fields.js:804`, as the paged coarse lattice does), or
   evaluating the shape graph at the level's spacing (`createShapeEngine`
   with `spacing` and `refSpacing`, as `sculpt-preview.js` does for Fit).
   The engine doc requires every stage to run at a quarter of final
   resolution (TERRAIN_ENGINE.md:603), so this is the design, not a
   shortcut.
3. **The Time pass on that lattice**, for a held Time control and for the
   release wait: the paged Time runner already runs a window with an apron
   (`pagedTime`). At a sixteenth of the cells a pass should take tens of
   milliseconds **[inferred]**. If its picture misleads (compare it with the
   final pass on Rain at 0, 1 and 2), drop this step: a held Time control
   then updates as each real pass completes.
4. **No readback at preview levels.** Give the brick pool the last
   refresh's count times 1.5 (the count is a few thousand at the coarse
   level), read the overflow flag without waiting, and redo the block with
   the exact count if it overflowed.
5. **The raster.** Try one ray per image pixel at the coarse level only, and
   keep it only if the color bias stays within what the owner accepts on
   the toggle page; `80aad369` added the 2 x 2 raster to fix exactly that.

**Accepted when** whole-view-current p95 meets 100 ms for strokes and World
rows at the default budget, a 1,728 x 1,024 view on `map16` is one coarse
block at 512 MiB, and everything LP2 accepted still holds. **Risk.** A lattice at another spacing
moves thin features (a 2 px ridge); the preview must still put cliffs and
shores where the final does: overlay the coarse preview's height contours on
the final's for the three scenes and report the largest offset.

### LP4. Bounded GPU work (M)

**Change.**
1. **The Time pass in slices.** The same passes in the same order, a few
   iterations a submission (sized so a slice is under 50 ms), yielding to
   higher work between slices and stopping when a newer request exists.
   Same bytes as one submission.
2. **Finals stop between pieces.** A stale check before each voxel piece's
   build; split the build, the wear and the draw into separate submissions
   if one piece exceeds 100 ms.
3. **Pieces sized by time**, not only by memory: from the last pieces'
   measured milliseconds per pixel.

**Accepted when** the bench's `resume` phase shows the first preview of a
new stroke within the budget plus 100 ms at p95 while a Time pass and finals
are in flight (main: it waits for the whole pass); Time results are
byte-identical to main's; release-to-final within 10% of main.

### LP5. The color-only rerun (L; an experiment first)

**Step 0, the experiment (S-M), on a prototype branch.** List every read of
the solid and of geometry in `fragmentMain` and what the color half needs
from each. Write the record at full precision; split the entry point; for
one warm color edit rerun color alone and compare with a full re-bake **by
the same split build**, byte for byte, on the check scenes with their
optional features on. Report: the bytes; the pixels the split build moves
against main (expect compiler drift, to be judged on a sheet); the color
pass's time; the record's memory; and, from LP1's map, how many World rows
and which are stage F. Then stop and report.
**Build (M-L)** only if step 0's rerun equals the full re-bake: land the
split (scenes move by the reported drift, the owner looks), keep records for
visible tiles, route stage-F changes to priority 3 of the scheduler, add the
record to `pagedBudget`'s minimum.
**Accepted when** the color row of section 2 is met, a stage-F edit's result
equals a full re-bake byte for byte on every check scene, and export bytes
are unchanged apart from the split's reported drift.
**Risks.** The record's memory (57 to 85 MiB) is counted in the budget and
dropped first when a smaller budget is set. A dependency that sleeps until a feature wakes it:
the map is static and conservative, and step 0 runs with the features on.

### LP6. A faster final (M-L, in units; after the above)

Unchanged from REDESIGN_PLAN's R8, R8b and R6, with this plan's findings:
- R8's four units, one at a time, each with its sheet: closed-gate bricks
  and the march fix; wear where it shows; the thin shell (which also stores
  fewer bricks, the precondition for the next point).
- **Final tile size, first, because it is nearly free once LP4 can stop a
  tile between pieces.** Sixteen 256 px tiles build 1.45 times the bricks
  and 2.6 to 6 times the relief bake of four 512 px tiles, and a window took
  1.9 to 2.3 times as long on four scenes (section 3.2, nothing split). At
  the new default a final 512 tile on a 16x16 map is one piece (section
  3.3). The view's final tiles go from 256 to 512 px if the bench confirms
  the gain on `map16` and the first final tile after a pause still meets its
  0.6 s. The picture does not depend on the tile size beyond the 16 pixels
  `repro/render.mjs` already allows; the scenes' own tile size is unchanged.
- No readback at final (R6's fixed pool).
- The surface atlas (R5 step 1) only if the relief bake still matters after
  the tile size is settled.
- R8b (the Time pass per landform) stays as written: only once shown equal.

### Not a card: a worker

Only if, after LP2 and LP4, the bench still shows frames over 16 ms that
trace to main-thread work during a drag.

## 6. Rules for the implementer

- AGENTS.md applies in full: a worktree and a branch per card, your own
  server, CDP port and assets root, never the owner's 8801.
- Every card changes the drag or bake path, so every report gives
  `repro/perf.mjs` numbers for both builds from alternating runs
  (AGENTS.md, checks table), plus LP0's phases.
- Through LP4 the land tier runs with `--worlds none`. A moved pixel is a
  defect to find, not a sheet to judge.
- A query switch to compare old and new behavior may exist on a branch
  while a card is built; it does not land (rule 7).
- Report each claim as measured (with the number and the machine's load) or
  by eye, and say what is unfinished (rule 5).
- `ui-redesign` and `editor/world-tool-lists` are live branches that edit
  `sculpt.js` and `sculpt.html`. LP1 and LP2 touch `setKnob` and the row
  handlers: merge main often, and tell the owner before a card that
  rewrites those handlers.

## 7. What this replaces in REDESIGN_PLAN

| There | Here |
| --- | --- |
| Section 2's latency budgets | Section 2 |
| R7 (a preview level for every control; generic pipeline; the preview raster) | LP2 and LP3, with the unit changed from a tile to a view block; the raster change kept only if the color bias allows |
| R6 (batch tiles, no readback, cancel between stages, bound stale work) | LP3 step 4 (previews), LP4 (bounds), LP6 (finals). Batching final tiles is dropped: the preview answers first |
| R5 (stage caches; every control owns a stage) | LP1 (the stage map, computed instead of measured by `repro/stage-map.mjs`), LP5 (step 0, then the split). The surface atlas moves to LP6 |
| R8, R8b | LP6, unchanged |
| "Track A" order (R5 step 0, atlas, split, R8, R6) | LP0 to LP6: the preview unit first, because it serves every control, and the stage caches after |

If this plan is accepted, REDESIGN_PLAN's section 5 should point here; this
branch does not edit it.

## 8. For the owner

**Decisions wanted.**
1. **The look of the coarse level.** A sixteenth is blocky and, on Desert,
   pinker and noisier than final (section 3.4). Is that acceptable for the
   first tenth of a second, with the quarter level about 100 ms behind it?
   The alternative is the quarter level as the first answer, at 2 to 3
   times the cost.
2. **Refinement starts by itself** after a pause (about 250 ms), nearest
   the last pointed place first. The alternative, a bake the artist starts,
   needs a control (below).
3. **Speed work was parked behind realism** (2026-11-09). This brief reads
   as unparking it; LP0 to LP2 can run beside realism work because they
   move no pixel, but they do rewrite the canvas scheduler that every
   realism branch renders through.

**Memory: settled by the owner on 2026-11-11, and the answer to "do we
need even more".** The default goes to 2,048 MiB in LP2. What the memory
buys, measured in section 3.3: the view as one preview pass (about ten
times today's preview, against four to five times in blocks at 512 MiB), an
unsplit final 512 tile, and a working set per level. Expected use on a
16x16 map with a 1.8 megapixel view is 1.0 to 1.3 GiB, and about 1.6 to
2 GiB for an iMac-sized view of 2.9 megapixels **[computed]**. More than
that is not asked for, because what stays slow after this plan is GPU time
building the solid, not memory. Two things more memory could buy, neither
recommended: keeping the solid of the whole view between edits (0.5 to
1 GiB on cliffs) would make only the two sun rows live at final quality;
and holding a 16x16 map unpaged (about 1.2 GiB of fields and 2.2 GiB while
a Time pass runs **[computed from the per-cell sizes in
`sculpt-gpu-fields.js` and `sculpt.js`]**) would remove page waits while
panning, which is not what makes editing feel slow. Unknown and owed: what
Safari on the iPad actually grants a page.

**Proposed, not in any card** (rule 3: each is a new control):
- *A proof spot.* Pin a place that is kept at final quality during every
  drag, so grit, joints and color can be judged live in a 256 to 512 px
  window while the rest of the view is coarse. This is the "subset" of the
  owner's bake remark.
- *"Render the view" and a pause toggle* for automatic refinement, for long
  sessions on a hot machine.

## Appendix: how the numbers were made

- `timing.mjs <scene> [--only '256@1,1024@4'] [VIEW=1728x1024@4]`: opens
  the scene through `repro/headless.mjs`, runs the Time pass, raises the
  renderer budget to 1 GiB, renders the window as tiles of each size at each
  level with the page's own `renderChunk`, and sums GPU pass times from
  timestamp queries added to every pass (as `repro/perf.mjs` does).
- `paged.mjs <scene>` (`MAP=16 GPU=512`): the same on a paged map with the
  reserve the page computes (`steadyGPU` as `sculpt-canvas.js:61` builds it:
  the fields, the 64 MiB Fit reserve, the canvases), blocks and whole views.
- `levels.mjs <scene> <out>`: final, level 2 and level 4 of one window as
  the page shows them.
- `knobdiff.mjs`, `knobcost.mjs`: section 3.5.
- Not measured here, and owed by LP0: anything in Chrome; the DOM side of a
  slider event; today's World-slider latency on main `f3e126cd` (the figures
  quoted are from `7d90fda9` and from per-tile times); the color pass alone.
