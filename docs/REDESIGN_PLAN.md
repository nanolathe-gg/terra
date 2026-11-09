# Terraform redesign plan

Proposal of 2026-11-09, written against main `7d90fda9`. It is on branch
`plan/redesign` and is not landed. [AGENTS.md](../AGENTS.md) still governs
until the owner changes it; section 8 lists the rules this plan would amend.

The owner's brief for this review: an artist-driven, hyper-realistic,
parametric terrain tool with a fixed camera; near-real-time feedback with
iterative refinement; able to mimic the retail worlds and to go beyond them;
easy to use; everything open to question.

## How to read this

- Every claim is tagged **[measured]** (a number, and where it came from),
  **[read]** (in the code or a document, with the file), **[by eye]** or
  **[inferred]**.
- Evidence that cannot be committed (anything showing retail art, and the
  throwaway prototypes) lives outside the repository under
  `~/terraform-assets/agent-rd-*/`. Each folder is named where it is used,
  and appendix A indexes them.
- Section 1 is the verdict. Section 4 is the design, as hand-off cards.
  Section 7 answers "what am I not asking?".

## 1. Verdict

**Keep the engine. Stop changing how it renders. Fix what the artist sees,
waits for and has to find; and build the judge first.**

1. **The foundations are sound.** A recipe as the save, one GPU path, a
   fixed stage order, the Landform tool and its section editor, today's
   Plateau, tile independence, export in the page. Nothing found in this
   review justifies a new renderer, a new representation, a new language or
   a new simulation (section 4.2 lists what was considered and why not).
2. **The picture's gaps are upstream of the renderer.** By eye, in this
   order: the form of ridge-like landforms (today's Mountain is an
   even-width loaf with a comb of gullies; section 3.8b); rock tone and
   placement (measured on Green: steep ground darkens half as much as
   retail's; section 3.1b); and the kind of relief below 64 px, which
   differs from world to world (section 3.8c). Light is not among them:
   measured with one fit on both, our shading is as strong as retail's on
   Green and stronger elsewhere. The project's own record agrees: the builds of the 2026-11-08
   renderer comparison landed the same share of statistics inside retail's
   band, and five rock rewrites left Green's look score at .21-.23
   (section 3.6).
3. **The voxel solid stays, on faces, as art.** The owner's observation
   was tested and holds: sideways displacement is what makes a cliff read
   as broken rock, and no height-field shading reproduces it. Its price is
   64-87% of every window, mostly in building it. A thin-shell build
   takes 13-23% off a cliff window with the solid unchanged; skipping the
   wear passes at today's weak settings takes another 15-18% and cannot be
   seen, but it moves pixels and so needs the owner's look. The rest is
   the cost of the look (sections 3.4, 3.4b; R8).
4. **Responsiveness comes from structure, not from micro-optimizing.**
   Materials and palette are about 10 ms of a 345-1,181 ms window.
   Keeping the baked surface and the geometry of visible tiles, and
   rerunning only color, makes the color, shine, light-strength and
   palette controls live ones (which further rows qualify is for a
   measured stage map to say); giving every control the preview level
   that strokes have, and never compiling a pipeline on the critical
   path, covers the rest (R5, R6, R7).
5. **The control surface is the largest usability problem.** 234 World
   rows over twelve screens, 45 of them another world's, 110 changing
   under 5% of a capture, rock missing from the landform it defines. The fix
   is one short set of dials in the brief's own nouns, at three scopes:
   world, landform, spot (R9).
6. **Two defects to fix whatever else is decided:** a shared map does not
   carry its world's settings, and export follows the view's options (R11).
7. **The judge comes first.** Retail's own heights through the engine,
   beside retail's art, on held-out sections, marked blind by the owner
   (R0, R1). Without it the next round will go the way of the last five.

**What this review could not deliver, said plainly.**
- **A recipe for natural-looking mountains.** Four approaches were
  prototyped (grid erosion, a pointwise erosion filter, a branching
  skeleton, a structure term). The skeleton gives the best ridge form and
  is worth building; none of them produced terrain a viewer would take for
  real. Form is a research track with a judge, not a solved design (R3).
- **One model that slides from 1997 to modern on a single dial.** Light and
  placement do reduce to numbers. Relief does not: retail's kinds of
  structure are different things on different worlds (R4). The prototype
  that showed this also showed the other side of it: a relief control
  that misses retail can make a world nobody has seen, and the owner
  wants those.
- **A cheap solid.** See point 3.
- **The ceiling.** Inside the 1997 format, "hyper-real" means 242 colors,
  32 px tiles and painted light. How far past that Nanolathe goes is the
  owner's decision and it bounds everything here (section 7, question 4).

**The cards at a glance** (section 4.3 has each in full; section 5 the
order):

| Card | Change | Size | Main effect |
| --- | --- | --- | --- |
| R0 | Four benches (retail look, shape, latency, task cost) and a new-worlds sheet | M | A judge that editing a scene cannot game |
| R1 | Height-image op | S | Enables R0; import from other tools |
| R2 | Light and placement as fitted numbers, with the light fit as a tripwire | S-M | Red, Lava and Moon's over-strong shading and Green's light rock brought to retail's numbers |
| R3 | Skeleton structure in Mountain and Hill | L, research | Form: spurs branch, valleys join |
| R4 | Relief kinds, under three rules: for retail worlds on the bench, and for new worlds by eye | M per world | "Recognizably TA" below 64 px; new looks such as cell and crackle ground |
| R5 | Stage caches; every control owns a stage | L | Color, shine, light-strength and palette controls at about 10 ms a megapixel |
| R6 | Scheduler: batch tiles, no readback, cancel between stages | M | Lower latency on every path |
| R7 | Preview level for every control; generic pipeline; preview raster | S | No 0.9 s stalls; all rows preview live |
| R8 | The solid: thin shell, wear where it shows, march fix | M-L | 13-23% off a cliff window with the solid unchanged; about a third with the wear change |
| R8b | Erosion per landform | S | Up to 0.4-0.9 s off each edit |
| R9 | Controls: honest panel, then dials at three scopes, then blend and variations | M | From 234 rows to about 60 on the surface |
| R10 | A tile budget; pooled level ground; stamps | M | Larger maps export without merging |
| R11 | The map carries its world; export ignores view options | S | Sharing works |
| R12 | Budgets for controls, uniforms and shader lines | S | The panel and the shader stop growing |

## 2. Goals, and the test each one gets

A goal without a test is how the project spent five rock rewrites without
moving its retail score (section 3.6). Each goal below names the check that
says whether a change served it. Section 4, card R0, builds the checks that
do not exist yet.

| Goal (from the brief) | Test | Exists today? |
| --- | --- | --- |
| Artists control the terrain; easy to use | Task costs on the live page: clicks, drags and rows scrolled for six standard tasks (section 3.5); the count of controls visible before "Advanced" | No |
| Feedback is fast, refinement is progressive | Latency budgets per kind of interaction (below), measured by `repro/perf.mjs` | Partly: stroke drags only |
| Hyper-real look; erosion may be approximated | A modern benchmark judged by eye on fixed sheets; `measure/realism.py` as a tripwire only | Tripwire only |
| Recognizably Total Annihilation | A retail benchmark: retail's own heights rendered by the engine beside retail's art, on sections never used for tuning | No (needs card R1) |
| Many biomes and planets, including ones that follow no real planet | Invented worlds built from controls alone, with no code change, on a sheet the owner reviews (R0) | No |
| Large flat areas, a 2.5D RTS | Passability and buildable-area views; plains unmoved by any refinement | Yes (`repro/passability.mjs`) |
| Export loads and plays | `repro/export-bytes.mjs`; a tile budget per map size | Partly: no tile budget |

**Proposed latency budgets** (the owner sets the hardware floor; every number
recorded so far comes from one Apple M3 Pro):

| Interaction | Budget (p95) | Today |
| --- | --- | --- |
| Stroke drag: pointer to picture | 50 ms at preview level | 73-75 ms **[measured, docs/VOXEL_REVIEW.md]** |
| Color, finish or light slider drag | 50 ms, full quality at 1440p | 0.6 s to a first change, 0.9-1.1 s settled **[measured, section 3.5]**: every cached image re-bakes at final level |
| Any other World slider drag | 100 ms at preview level | the same, and 5-8 s where the row re-runs the shape or weathering **[measured, section 3.5]**; no preview level exists |
| Release to final visible art, 4x4 map | 1.0 s | 1.4-1.9 s **[measured, docs/*_REVIEW.md]** |
| First picture after load | 1.0 s | 1.7-2.2 s to final **[measured, docs/VOXEL_REVIEW.md]** |
| Export | no budget; progress and cancel | 3.7 s for 4x4 **[measured, docs/VOXEL_REVIEW.md]** |

## 3. Findings

### 3.1 The retail look, measured

A throwaway model (`~/terraform-assets/agent-rd-look/`, report and
`scripts/model.py`) turns a retail section's 16 px height image into 1x art:
upsample, place materials by height and slope, light with sun, sky and cast
shadow, project obliquely, add fine detail in screen space, snap to the
palette. It was tuned on half of each world's sections and judged on 36
held-out ones (six worlds, six each). Sheets: `out/sheets/*_1x.png`
(retail | model).

**Measured from the art-and-heights pairs (tuning half):**

| | Green | Red | Lava | Moon | Archipelago |
| --- | --- | --- | --- | --- | --- |
| Sun azimuth of well-fitted sections (180 = from the west) | -168 | -171 | -178 | 175 | unclear |
| Sun elevation from cast shadows | not measured | 30° | 20-40° | 20° | not measured |
| Share of light from the sky needed to fit both shadows and facing contrast | .55 | .32 | .90 | .87 | .95 |
| Darkening of steep ground whatever its facing (luminance per unit slope) | +.05 | -.04 | -.07 | -.19 | -.12 |
| Luminance the heights explain at 64 px / at 16 px | .60 / .28 | .75 / .19 | .82 / .52 | .97 / .73 | .69 / .37 |
| Rock share from level to steep ground | grass at every slope | 0 to 36% | 1 to 65% | - | sand in a band above water |
| Colors that cover 95% of a world's pixels | 14 | 24 | 19 | 14 | 27 |
| Neighboring pixels with different colors | 68% | 81% | 72% | 71% | 50% |
| Regular height stepping | none | none | none | none | none |

**What this says.**
- **The retail sun is low and its shadows are long, but facing contrast is
  weak.** A single Lambert sun fits only with a large sky share and shadows
  that also remove sky light. Section 3.1b runs the same fit on our renders:
  ours is not weaker.
- **There is no regular height step.** The contour-like lines are irregular
  (only a weak 8-10 px rhythm on camera-facing slopes). "Posterized heights"
  is not the recipe; irregular ledges are.
- **A second light direction (125-150°) recurs in five worlds**, including
  two Moon sections with a fit of .7. Unresolved: a second lighting setup,
  or a confound.
- **Some of the look is a per-map choice, not a world's.** Moon comes in a
  bright and a dark series at the same heights; Red has two ground tones.
- **Metal is man-made geometry**: its art ignores the height shift
  altogether. It is not a look.
- **Below about 64 px the heights stop explaining the art.** Everything
  finer was in the artists' source surface and is not in the game's height
  bytes. It must be generated, and can match retail only in kind.
- **Fine texture must be made per visible pixel** (in screen space or
  triplanar). Made on the ground grid and projected, it streaks on
  camera-facing slopes **[by eye, `out/peek/check_lava.png` against
  `check2_lava.png`]**.

**Verdict [by eye].** The model reaches retail on flat and gently rolling
ground: color, per-pixel grain, coarse shading (Green hills, dark Moon, Lava
flats). It fails wherever retail has structure finer than a height cell:
Lava's crisp faceted ridge networks, Red's sharp hummocks with small hard
shadows, Green's thin cracks and rock patches, Moon's rims. There it gives
soft blobs. Its "modern" setting, with the palette off and finer bumps,
reads as crumpled foil: a photoreal look needs new terms (layered materials
with their own structure, micro-occlusion, sky-tinted shadows), not new
numbers.

So the look model is necessary and cheap (light and placement are a few
dozen numbers a world), and it is not sufficient. The missing ingredient is
the same one the shape prototypes found (section 3.8): **structure between
the pixel and the landform**. Section 3.8c tests one term for it.


### 3.1b The same light fit on our renders

The first draft of this plan (commit `d932c710`) read our hills as flatter
than retail's and
blamed a sun that sits near 45° with far shadows capped at 32% darkening
(`engine-frag.wgsl:57-70`, `sculpt-renderer.js:830-843`). That compared a
measurement of retail with constants read from our shader. So the fit of
section 3.1 was run, unchanged, on both images of each baseline window:
retail's crop with retail's heights, and our render with our heights
reduced to 16 px cells (`~/terraform-assets/agent-rd-look/ours-fit/`,
`fit.py`, `table.txt`).

| Per-world median, retail / ours **[measured]** | Green (7 windows) | Red (3) | Lava (3) | Moon (3) |
| --- | --- | --- | --- | --- |
| Directional gain: luminance per unit slope toward the sun | .074 / .074 | .054 / .089 | .030 / .040 | .163 / .304 |
| Ours over retail, per window | 0.89 | 1.52 | 1.31 | 1.65 |
| Darkening of steep ground whatever it faces | -.091 / -.049 | -.086 / -.084 | -.067 / -.091 | -.306 / -.278 |
| Cast shadow: shadowed over lit luminance on like ground | .76 / .71 | .85 / .76 | .89 / .67 | .83 / .68 |
| Sun elevation from shadows | 30° / 45° | 30° / 30° | 30° / 40° | 20° / 20° |
| Light the heights explain at 64 px | .79 / .77 | .63 / .74 | .87 / .67 | .93 / .98 |

**What this says.**
- **Our broad light is not weaker than retail's.** Directional shading is
  equal on Green and a third to two-thirds *stronger* on Red, Lava and
  Moon, and our cast shadows are darker than retail's on every world. The
  first draft's "broad light" gap is withdrawn.
- **The one place ours is weaker is steep ground on Green**: retail darkens
  it about twice as much whatever it faces, on seven windows of seven.
  That is the dark, patchy rock of section 3.2 seen as a number, and it is
  the same complaint the project has recorded since 2026-10-28.
- **Three Green windows (4, 5, 6) do have a lower gain than retail**; they
  are the cliff and plateau windows whose traced shapes differ most.
- **Confounds:** our scenes are hand-traced, so shapes differ (Lava's p90
  slope is .79 against retail's .42); our rock is a different tone, and
  tone that follows slope feeds both numbers; retail's light is not one
  direction on Red and Lava-1.

This is why the retail bench (R0) feeds retail's own heights to the engine:
it removes the shape confound, and the same fit becomes a tripwire there.

### 3.2 Where today's output differs from retail

**[by eye]**, from each world's retail windows beside the baseline renders of
`7d90fda9` (`~/terraform-assets/baseline/7d90fda9.../out/<scene>/`), and
retail section sheets at 1x.

- **Retail is one look across worlds.** A soft, low-resolution landform with
  fractal lumps; irregular contour-like lines (strongest on Lava); one
  tiling noise ground per world; a low sun from the west with broad shading
  over the whole landform (section 3.1 has the numbers); rock that is dark
  and patchy; very few colors.
- **Ours differs most in three places, in this order.**
  1. *Form.* Our landforms read as a section swept along a path: bands of
     even width that follow the outline, stacked like cut-outs (Green 4,
     Green 6). Retail's are lumpy and irregular at 50-200 px.
  2. *Rock tone and placement.* Ours is light gray and covers whole bands;
     retail's is charcoal and patchy (Green 6). Measured on Green as steep
     ground darkening half as much as retail's (section 3.1b). This has
     been reported at least four times since 2026-10-28 (section 3.6).
  3. *Calm against busy.* Retail's hills carry a few marks on a quiet
     surface, so their broad shading reads at a glance. Ours carry fine
     detail everywhere (Green 1, Green 2). The shading itself is as strong
     as retail's or stronger (section 3.1b); what differs is how much
     competes with it.
- **Closest worlds:** Lava and Red. **Furthest:** Green cliffs, Moon (retail
  has soft, smeared shadow streaks; ours has hard shapes and black
  speckles) and Desert (retail's banded mounds and blobby ground).

None of these three is a property of the render primitive. That agrees with
the project's own record: the builds compared on 2026-11-08 landed the
same share of statistics inside retail's band (Green 77.8%, Moon 61.1%,
Desert 68.1% for mesh, rays, cached surface and voxels alike, though single
statistics moved) **[measured, `~/terraform-assets/render-compare/*-retail.log`]**,
and Green's look score stayed at .21-.23 through five rock rewrites
**[measured, section 3.6]**.

### 3.3 The pipeline today

From a read-only audit of `7d90fda9`
(`~/terraform-assets/agent-rd-pipeline/REPORT.md`, 48 KB, with file and line
for every statement). The facts that drive this plan:

**What is sound and stays.**
- The save is a recipe: an ordered list of strokes, seeds and settings. No
  heights or images are saved. A test scene is 1-29 KB **[measured]**.
- One GPU path from shape to palette; no code branches on a world's name.
- Tile independence is engineered throughout: global lattices, stated
  aprons, a regional replay check.
- Export runs in the page and re-reads its own archive with the game
  engine's loaders.

**What costs the artist time.**
1. **Nothing is cached below the final bitmap.** Each 256 px view tile
   re-derives its relief bake, rock runoff field, loose-stone mask and voxel
   solid from the lattice, over a window about 8x the tile's area, and
   discards them (`sculpt-chunk-renderer.js:83,113-114,203`;
   `sculpt-volume.js:68`) **[read; the 8x is computed from the reach
   constants]**. Neighboring tiles recompute each other's aprons.
2. **Tiles render one at a time**, and each voxel piece waits for a CPU
   readback of its brick count before it can build
   (`sculpt-chunk-renderer.js:332-337`; `sculpt-volume.js:89-90`) **[read]**.
   A chunk in flight cannot be canceled.
3. **A World slider has no preview level.** Every `input` event marks every
   cached image dirty and plans final-level bakes (`sculpt-canvas.js:64`).
   The quarter-resolution level exists only for strokes, moves and
   shape-card edits (`sculpt-canvas.js:38`) **[read]**.
4. **Crossing a gate compiles a pipeline.** 122 override gates over 98
   uniforms specialize the draw and bake shaders; a gate set not yet built
   compiles asynchronously on the critical path, about 0.9 s the first time
   (`sculpt-renderer.js:505-555`; docs/TERRAIN_ENGINE.md P6) **[read]**. Moving
   a slider from 0 to 0.01 is such a crossing.
5. **Release serializes** an unused whole-map drainage pass, the whole-map
   Time pass (200 iterations, about 156 MiB transient on a 4x4 map), a hold
   of up to 8 s for it, then the final bakes (`sculpt.js:1026-1079`;
   `sculpt-canvas.js:262-265`) **[read]**.

**What is wrong regardless of speed.**
6. **Most World settings do not travel with a map.** 168 of the 237 World
   rows, and all Colors, live only in the browser's local storage. A shared
   or downloaded map opens with the recipient's sliders and colors
   (`sculpt.js:1428-1437,1622-1625`; `sculpt-share.js:39`) **[read]**. This
   contradicts "a world is data" for anyone but the author.
7. **Export uses the live view options.** Nothing forces Clay off or the
   palette on for an export (`sculpt.js:265-267`; `sculpt-canvas.js:140`)
   **[read; not exercised]**.
8. **Erosion barely reaches the picture.** Only Green runs rain; the other
   eight worlds run thermal sliding capped near 4 units. Recorded impact of
   the erosion controls on Green is 0.7-1.9% of their class, under the 5%
   rule **[measured, BACKLOG.md:3376-3386]**. The drainage plane computed
   after every edit is read by nothing (`engine-weather.wgsl:44`) **[read]**.
9. **Height has five representations**: the authored lattice (about 2 px),
   the Time blend, minus the ground undulation for art, plus the 1 px relief
   bake, plus the voxel displacement and wear. Game heights stop at the
   second. Reach arithmetic for them is kept by hand in at least seven
   places, and the regional check compares only the first **[read]**.

**Limits of the shape model** (`engine-shape.wgsl`) **[read]**:
- Strokes combine by raise, cut or flatten, in list order. There is no
  smooth union, and no stroke can refer to another.
- A cross-section cannot change along its path; the along-curve scales only
  crest height and groove width.
- Gullies are a stripe pattern steered by the stroke's own fall line, not
  flow. Spurs are roots seeded off the crest, not a hierarchy that valleys
  follow.
- No height image can be imported. The smallest place for one is a list op
  that writes the authored height plane, like the `ground` node.
- On a landform, the card's Amount, Roughness and Softness are not read.

**Size.** 8,579 lines of WGSL in 13 files; 11,524 lines of JS in 39 files;
323 uniforms; 82 compute entry points; 237 World rows in the schema (234
sliders on the live page, section 3.5) and 84 shape fields;
world defaults in three places (`materials/<world>.json`, Python tables in
`sculpt.py`, JS fallbacks) **[measured]**.

**Dead or duplicated** (delete list in section 6): the non-chunked renderer
path and every `#else` of 21 `CHUNK` tests; the 'preview' draw quality that
no caller requests; the drainage plane; seven unused mask planes; a CPU twin
of the Time blend; two shader preprocessors.

### 3.4 The voxel solid: what it buys and what it costs

An ablation on main, in a worktree (`../terraform-wt-rd-voxel`, branch
`rd/voxel`, five commits; switches named by `globalThis.RD_VOXEL`; with all
switches off the four scenes are byte-identical to main). Same light and
materials everywhere; only the named ingredient changes. Node on Dawn, a
1,024 px window in 256 px tiles, medians of five alternated runs. Images:
`~/terraform-assets/agent-rd-voxel/img/` (`native-*.png` sheets, and
`<scene>/<variant>/crops.png`).

**Where a window's time goes [measured; each stage submitted alone]:**

| ms per 1,024 px window | green-4 (40% cliff) | green-2 | desert-2 | green-7 (flat) |
| --- | --- | --- | --- | --- |
| Feed, surface bake | 90 | 99 | 65 | 64 |
| Voxel prepare, guide, classify | 33 | 32 | 31 | 31 |
| **Voxel build** | **679 (57%)** | **413 (53%)** | 69 | 108 |
| **Wear, four passes** | **238 (20%)** | 118 (15%) | 60 | 84 |
| Draw: ray march / probes / materials and palette | 33 / 45 / 11 | 27 / 32 / 11 | 31 / 30 / 9 | 30 / 31 / 10 |
| Whole window | 1,181 | 773 | 345 | 399 |
| Work that exists only because of the solid | 87% | 80% | 64% | 71% |
| Bricks (512 voxels each) | 488,321 | 310,078 | 153,804 | 238,589 |
| Peak tracked memory, MiB | 122 | 98 | 93 | 80 |

Once per edit, not per window: shape fields 25 ms; the Time pass 416-875 ms
**[measured, single runs]**.

**What each ingredient does to the picture:**

| Ablation | Pixels changed on cliffs (over 8/255) | By eye at 1x | Window time |
| --- | --- | --- | --- |
| No wear passes | 52-73% | Not visibly different at the shipped Weathering (.15 Green, .35 Desert); visible at 1 | -13 to -23% |
| Displacement straight up instead of along the normal (the solid becomes a height field) | 59-87% | Clearly worse on all three cliff scenes: broken-block silhouettes become stretched vertical streaks, ledge grass goes, lumps flatten | about the same |
| Voxels twice as coarse | 60-79% | Visibly softer; the finest blocks and grit are lost | -40 to -65% |
| Normals and probes from a height field over the same solid | 50-79% | Streaky, flatter faces | about the same |
| No bricks where every rock and soil gate is closed | 3-15 pixels | Identical | -0 to -3% |
| Also no bricks on broad flats | 0-0.9%, none on cliffs | Identical | -4 to -9% |

**Conclusions.**
1. **The owner's observation holds [by eye, and measured]:** true sideways
   displacement is what makes near-vertical faces read as broken rock. A
   height field, however it is shaded, streaks. A 3D structure stays on
   steep faces.
2. **The cost is in building the solid, not in drawing it.** The march and
   its four probes are 8-20% of a window. The build evaluates the full
   rock function at about 250 voxels for every output pixel on green-4
   (488,321 bricks x 512 over a megapixel) **[computed]**, through a slab
   about 80 units thick around every cliff, to find a surface that is one
   voxel thin.
3. **The wear passes do not earn their cost at the shipped settings.**
4. **Confining the solid to steep ground is not the lever**: flat ground
   holds only 12-40% of bricks, and most bricks sit over gentle slopes.
   What matters is how thick the evaluated shell is.
5. **Two smaller findings:** main's ray march aliases (11% of green-2's
   pixels change with a one-voxel step, as dark speckle in the rock band);
   and turning runoff and debris on costs 30% of a window, almost all of it
   from 28% more bricks, not from their own passes.

### 3.4b Two cheaper ways to build the same solid

Tested on the same branch (commit `cb9c89ed`; timings in
`~/terraform-assets/agent-rd-voxel/time3/`; sheets `img/native-BAND.png`,
`native-IMPLICIT-vs-NOWEAR.png`).

- **BAND, a thin shell.** Each brick first samples the rock function on a
  3 x 3 x 3 lattice and builds its 512 voxels only if the surface can pass
  within 8 voxels; other bricks are filled by interpolation.
- **IMPLICIT, no bricks.** The march, the normal and the probes call the
  rock function at their sample points. No build, wear, classify or
  readback.

| | green-4 | green-2 | desert-2 | green-7 (flat) |
| --- | --- | --- | --- | --- |
| Rock-function evaluations per output pixel: main / BAND / IMPLICIT | 238 / 164 / 110 | 151 / 83 / 84 | 75 / 47 / 92 | 117 / 59 / 92 |
| Window at 1x, ms: main | 1,131 | 695 | 347 | 336 |
| Main without wear | -17% | -15% | - | -18% |
| BAND | -21% | -23% | -9% | -13% |
| IMPLICIT | -33% | -38% | -23% | -9% |
| Window at the preview level: IMPLICIT against main | +115% | +75% | +15% | +7% |
| Cliff pixels changed against main: BAND / IMPLICIT | 0.3% / 67% | 6.8% (all of it main's march aliasing) / 83% | 0.0% / 73% | 1.3% / 40% |
| Peak tracked memory, MiB: main / IMPLICIT | 122 / 34 | 98 / 34 | 93 / 47 | 80 / 34 |

All **[measured]**. **By eye at 1x:** BAND is identical to main on all four
scenes. IMPLICIT keeps the forms, silhouettes and ledge grass, with a
finer, grainier rock, because nothing is interpolated between voxels; on
the green-4 crop it reads to me as more speckled and a little darker than
main. A cheap rock function for the probes made faces visibly darker and
is rejected.

**What this means.**
- **There is no trick that makes the solid cheap and leaves every pixel
  alone.** The thin shell is the only lossless saving (13-23%). Skipping
  the wear passes cannot be seen at the shipped settings but changes
  52-73% of cliff pixels by more than 8/255, so every rock scene's fixture
  moves and the owner must look. Both together remove roughly a third of a
  cliff window **[inferred from the stage times: 682 + 243 ms of build and
  wear become about 478 + 0]**.
- **IMPLICIT is the simpler machine** (no bricks, no readback, no piece
  splitting, a third of the memory) and the faster one at 1x, but it
  changes the rock's grain, needs Weathering restated inside the rock
  function, and is slower at the preview level.
- **That last point exposes a defect in the preview itself:** at the
  quarter level the draw still shades a full-resolution raster
  (`rasterScale = max(1, scale/2)`, `sculpt-chunk-renderer.js:169`), two by
  two rays for each output pixel. Bricks get eight times cheaper there and
  pixels do not.


### 3.5 Controls and workflow

From a live audit of `7d90fda9` at 1,440 x 900 on Green
(`~/terraform-assets/agent-rd-controls/`: `controls.csv` with 452 rows, about
90 screenshots in `shots/`, task logs, and a fresh run of
`measure/world_controls.mjs --worlds green`, which passed).

**What works [by eye].** The layout is sound: tools on the left, the canvas,
an inspector with Tool, World, Map and Shapes tabs, and the section and
length curves docked below. The section editor is the clearest control on
the page (labeled plain and sea lines, draggable points, a lean side and a
steep side). Rendered hover examples for tools are good. A stroke, a rock
starting point and a river each take one to four actions. Every disabled row
says why. The Export pane is short.

**The numbers [measured on the live page].**

| | Count |
| --- | --- |
| Tools | 21 |
| Rows across the stroke cards | 119, of which 31 are hidden until a parent is on |
| A Plateau's card | 39 rows; 1,626 px tall with every group open, in a 787 px inspector |
| World slider rows | 234, plus 78 other inputs |
| World pane height | 9,259 px (11.8 screens); 12,325 px with fine controls |
| World rows under "Rock & cliffs" | 86 |
| World rows disabled on Green | 62 |
| World rows that belong to other worlds' looks, shown on Green | 45 (22 in the default view) |
| World rows that change under 5% / under 1% of Green's captures across their range (a share of the whole capture, not rule 9's share of a class; the class sweep passed) | 110 / 37 |
| World rows with a parent control | 97, up to three levels deep |
| World rows with no hover help of their own | 227 of 234 |
| Matches for "rock" in the World search | 90 |

**Task costs [measured, real pointer events from a fresh load].** These six
are the task-cost bench of R0.

| Task | Clicks | Drags | Scrolled | Outcome |
| --- | --- | --- | --- | --- |
| (a) A hill with rock on one side only | 2 | 2 | 0 | Works, if you know that rock follows slope and that Lean, in a collapsed group, steepens one face. Nothing on the stroke says "rock" |
| (b) Change the rock from sandstone to basalt and darken it | 4 | 0 | 3,400 px past 49 rows | Works. Four different rows could mean "darken" |
| (c) Cut a river valley through a plateau | 1 | 2 | 0 | Works |
| (d) A second world: new colors, more vegetation, rougher rock | 10 | 3 | 11,082 px past 244 rows | Partly. The new Ground color vanishes once Vegetation rises; "rougher" is subtle at 1x |
| (e) An island with a beach | not yet measured | | | |
| (f) Export a 4x4 map | not yet measured | | | |

**Time to see a change [measured, one clean run each; first change /
settled, in seconds].** Hill stroke 2.1 / 2.7. Elevation on a stroke
2.3 / 2.9. Ambient light 0.6 / 1.1. Rock relief depth 0.6 / 0.9. A rock
starting point 0.4 / 1.4. Landform face steepness (re-runs the shape)
5.0 / 5.2. Rain (re-runs weathering) 8.4 / 8.7.

**The last two fit no measured stage.** The shape pass is about 25 ms and
the whole-map Time pass 0.4-0.9 s (section 3.4); 8.4 s is close to the 8 s
the canvas will hold a weathered bake for the Time pass to land
(`sculpt-canvas.js:262-265`). Undiagnosed here; it may be a hold that
expires where it should be released, which would be a small fix worth
seconds on every such row.

**The ten problems, ranked** (evidence in the audit's sections 1-5):

1. The World pane is a 12-screen scroll with search as the only way around.
2. Green shows rows that do nothing visible on Green, so an artist cannot
   tell which rows matter.
3. Rock, the main look of a landform, is not on the landform. Where rock
   shows is a slope rule spread over six World rows.
4. One idea lives in several places: cracks in four, pits in three, steps
   and bands in five, vegetation in nine, shine as five copies of the same
   four rows; two sections are both named "Contour bands"; help texts point
   to panels that no longer exist.
5. Labels speak engine: 15 encode values ("Vegetation cover (0 off)"), 35
   use engine terms ("Micro roughness (grain slope)", "Riser share").
6. Progress is invisible. There is no indicator; the status line sits in a
   closed popover. With changes taking 0.6 to 8.7 s, "still working" and
   "this row does nothing" look the same.
7. One pane writes to three scopes and never says which: most rows to the
   world in this browser (and so to every map that uses it), rock rows to
   both the map and that store, the rock column to the map only.
8. Controls hide each other's effect: Ground color under vegetation; rock
   starting points keep colors, so "sandstone" renders gray; the pre-checked
   Rock color box turns the color off when clicked.
9. Chains of parents send the artist across sections.
10. Names and the panel jump during the core loop: Hill becomes Rounded
    ridge becomes Landform #2; after a stroke the tool switches to Select
    and transform controls push the shape's settings below the fold.

### 3.6 History: what was tried

From `~/terraform-assets/agent-rd-history/REPORT.md` (41 KB, tables A-M with
a reference for every row). The project's whole history is 14 days and 1,929
commits (2026-10-26 to 2026-11-09) **[measured]**.

**Already tried; do not repeat without new evidence.**

| Tried | Result | Reference |
| --- | --- | --- |
| Five renderers on the same scenes (mesh, cached 2 px and 1 px surface, height-field rays, voxels) | Rays 10-20% faster than mesh, voxels 3.0-4.7x slower; the same share of statistics inside retail's band for every build; drag about 60 updates/s for all | `~/terraform-assets/render-compare/` |
| Triplanar shading on height-field rays | 118 ms against 515-808 ms for voxels; Green look gap worse, .212 to .260 | commit `fc03d837` |
| Pixel rills, channels, scarp retreat, slumps, talus fans, column walk (cards P2-P17) | Each rejected or held: "no world improves", "scarps read as cracks", "sea urchin" | docs/TERRAIN_ENGINE.md:841-863 |
| Horizon sweeps for shadows (P11) | Cost what the removed taps saved; closed | docs/TERRAIN_ENGINE.md:847 |
| Flow bake and River/Source tools | Dropped by the owner: no retail world uses them | decision 19 |
| Section forms fitted to retail slopes | "Nothing kept": read further from retail by eye | EXPERIMENTS.md row 166 |
| Seven blind-review rounds | Ended near chance and swung between regression and inversion (AUC .18 to 1.00) | EXPERIMENTS.md rows 12-51 |
| An editor in Go/WebAssembly with a dedicated GPU worker | Nearby-tile p95 36-41 ms against 274-280 ms; never merged | `prototype/go-wgpu` |

**Findings worth keeping.**
- **Retail's slope marks are not drainage.** The dark lines on retail Green
  slopes follow no fall line: 35/31/33% in the three angle bins, where
  random is 33/33/33 **[measured, EXPERIMENTS.md row 141]**.
- **Retail uses few tiles.** At most 11,561 distinct tiles over 275 retail
  maps; about 5% of slots are unique on large maps **[measured]**.
- **The Go worker result** says main-thread contention, not GPU time,
  dominated nearby-tile latency **[inferred from its numbers]**.

**Problems that keep returning** (each with three or more dated reports):
rock that reads wrong (tone, no long courses); scores that improve while the
picture does not, or are gamed; hard dark contour lines; even-width bands and
ribs; latency against final quality; dead controls that regrow after each
audit (417 parameters on 2026-10-31, cut to 357, then about 30 added by the
voxel work).

**Standing decisions this plan keeps:** one engine and one GPU path; presets
are only numbers; no save compatibility before release; one Landform tool;
hills and mountains differ by default; judge by eye, one biome at a time.

**A conflict to settle:** AGENTS.md rule 10 reads retail-first ("judge a
visual change against retail, across all of a world's windows"), while the
owner's rule of 2026-11-08 is hand-tuning with controls over chasing a
retail match. Section 4, cards R0 and R2, propose how both hold.

### 3.7 What the output format allows

From a read of `export/` and of the Nanolathe engine at `~/src/nanolathe`
(appendix B lists the files and lines).

- **The 1997 limits bind Nanolathe too.** Terrain is 32 px paletted tiles,
  at most 65,536 distinct (the tile index is 16 bits), one height byte per
  16 px cell, one global 256-color palette (242 distinct colors) **[read,
  nanolathe/formats/tnt.go; research/formats/tnt.md]**.
- **Nanolathe has no terrain sun, normals or shadows.** All light must be
  painted into the tiles **[read, nanolathe/docs/DESIGN_GPU_RENDERER.md]**.
- **Nanolathe's Enhanced renderer already draws water**: ripples, foam, a
  damp band, reflections, from heights and sea level, with no map data. It
  expects the painted shore to agree with `height < sea` **[read]**.
- **Tile uniqueness is the real limit on detail.** Our worlds measure 83-90%
  unique tiles (Green 4x4: 3,668 of 4,420; Red 16x16: 60,072 of 66,820)
  against retail's 5-10% **[measured, docs/VOXEL_TOOLS_REVIEW.md]**. Lossy
  merging starts near 15x15 units. In Nanolathe a 65,536-tile map costs
  about 303 MB of atlas plus about 1.14 GB for its 2x detail atlas
  **[inferred from the documented cell sizes]**.
- **The palette step is already good.** The draw quantizes with Knoll
  pattern dithering in OKLab or an ordered-noise dither; the exporter
  receives exact palette colors **[read, engine-palette.wgsl]**.
- **Cheapest ways past the format, in order** **[inferred]**: (1) let a map
  ship its own 2x tile sheet (Nanolathe synthesizes one by patch-matching at
  load today, and the editor can already bake at 2x); (2) a render-only
  true-color sidecar for the Enhanced renderer; (3) per-map normal or
  material layers. Finer gameplay heights or a passability mask would change
  the simulation and its lockstep hash: not worth it.
- **Passability:** the editor's view matches the engine's per-cell rule for
  the reference unit classes it uses **[read]**.

### 3.8 Shape prototypes

Four smooth guides (a ridge, a mesa, three hills, a valley through a mesa;
`~/terraform-assets/agent-rd-shared/guides.py`) were given to two families of
model, each built by a separate agent with the same constraints: plains stay
flat, a tile equals the whole, at most eight continuous parameters.

| | Grid simulation, tethered to the guide | Pointwise erosion filter |
| --- | --- | --- |
| Folder | `agent-rd-shape-sim/` | `agent-rd-shape-point/` |
| Model | stream power, deposition, diffusion and talus on 4 px cells, 400 iterations, then a pointwise 1 px step | gradient-aligned stripe cells in 5 octaves, with warp, strata and toe fill |
| `measure/realism.py`, statistics in the real range (of 15), ridge / mesa / hills / valley; bare guides 3.2 / 3.4 / 2.8 / 3.8 | 7.2 / 4.6 / 3.5 / 4.8 **[measured]** | 7.2 / 4.0 / 5.4 / 5.0 **[measured]** |
| Hack's gate (do valleys join?) | passes 2 of 21 windows **[measured]** | passes 2 of 20 **[measured]** |
| Plain pixels moved by more than 0.5 | 0% **[measured]** | 0% **[measured]** |
| Tile equals whole | yes per landform domain; a whole 20,480 px map does not fit at 4 px cells | yes, apron of outline + 63 px, to 4e-11 units **[measured]** |
| Cost | about 0.1-0.15 s per 1,024 px landform on a GPU **[estimated, not measured]** | about 300 taps, 8 noise and 45 stripe kernels a pixel **[counted]** |
| By eye | a comb of evenly spaced, parallel, unbranched gullies; the crest stays the drawn polyline | slopes read as brushed fur; gullies never join |

**Conclusion [by eye, with the Hack gate as support].** Neither family makes
a swept section look natural, and both reports name the same cause: there is
no hierarchy at 50-200 px. On a prismatic slope, real erosion also cuts
parallel rills; branching comes from the larger form (summits, saddles,
spurs, the valleys between them), which a tight tether to a smooth guide
forbids. So the missing piece is not more detail or more simulation. It is
structure in the guide itself. A follow-up prototype tests that
(section 3.8b).

### 3.8b A skeleton before detail, and today's presets on the same paths

**The prototype** (`~/terraform-assets/agent-rd-shape-skeleton/`) grows
vector structure from the drawn path, once per stroke edit: a crest with
summits and saddles, spurs that turn toward the fall line and never climb,
and two orders of sub-spurs that stop mid-slope. Height is the drawn section
applied to a smooth minimum of the distances to those elements (a closed
form per segment, so polylines leave no seams). Seven parameters; at their
low end the result equals the guide to 1e-4 **[measured]**.

| | Result |
| --- | --- |
| Plain pixels moved | none **[measured]** |
| Tile equals whole | exact, with no apron for the skeleton (40 px with detail) **[measured]** |
| The result never rises above the drawn guide | max +0.0001 **[measured]** |
| Crest offset from the drawn path | mean 0.23 px **[measured]** |
| Vector data | ridge 1,089 segments in 160 elements; about 75 segments tested per landform pixel **[measured]** |
| Realism on windows centered on the landform (of 15), ridge / mesa / hills / valley | 12.0 / 8.0 / 9.5 / 8.5, against 10 / 7 / 10.5 / 8.5 for the pointwise filter **[measured]** |
| Hack's gate | still fails on the ridge (0.16-0.30 against a real 0.33-0.51); it rises with branching depth and with detail **[measured]** |
| Stability when a path point moves 10 px | 94-99% of elements survive; 27-30% of landform pixels change by more than a unit **[measured]** |

**The same paths with today's presets** (rendered on `7d90fda9`, modern
Green; sheets in `~/terraform-assets/agent-rd-shared/engine-base/cmp-*.png`:
engine art | engine heights in the plain shade | skeleton with detail).

**[by eye]**
- **Mountain.** Today's preset is a loaf of even width with a comb of
  parallel gullies across it and contour rings at its ends. The skeleton
  version has a scalloped outline, spurs that branch and valleys that join.
  It is clearly the more mountain-like form, and still synthetic: a
  knife-straight crest along the drawn polyline and smooth, faceted lobes.
- **Hill.** Today's preset is a flat-topped pill ringed by concentric
  crack scribbles, with the path showing as a line along its top. The
  skeleton version reads as low hills with swales; a single-click hill is a
  starburst.
- **Plateau.** Today's preset is good: an irregular outline, outliers,
  alcoves, cliffs of varying width. The skeleton version is worse: faceted
  buttresses and Y-headed alcoves that read as crystal, and a quarter of
  the top eaten **[measured: 24.9% moved by more than 2 units]**. Do not
  replace the plateau.

**Conclusion.** Structure before detail is right for ridge-like landforms
(Mountain, Hill) and wrong, as built, for rims. It is a research card with
a clear judge (the shape bench), not a settled design: an hour's prototype
gave the best ridge form of the four approaches and no natural mountain.

### 3.8c One structure term for what the heights do not hold: tested, and no

Sections 3.1 and 3.8 both end at "structure between the pixel and the
landform". The tempting design is one pointwise term for it, with a single
number running from free (retail's marks follow no fall line) to organized
down the slope (natural gullies). A prototype tested exactly that on the
look model and the same held-out sections
(`~/terraform-assets/agent-rd-structure/`: `structure.py`; sheets in
`out/sheets/` as retail | plain look | with structure; sweeps in
`out/sweep/`). The term is octaves of Voronoi or stripe cells, 12-24 px at
the top, gated by local relief, changing the surface before light, shadow
and projection. At zero amplitude it is exactly the plain model
**[measured]**.

| World | Does it make retail's kind of structure? **[by eye; the agent's verdict and mine agree]** | Tripwires against the plain look model **[measured, medians]** |
| --- | --- | --- |
| Red | Yes in kind: small crisp facets with hard shadows where the plain model gives blobs. Too dense | spectrum worse (.36 to .44) |
| Lava | No. A web of short curly cracks, not retail's faceted ridges, lobes and long flow lines | histogram worse (.19 to .38); land 15-20% darker |
| Green | Subtle. Retail's marks there are a material (gray rock slivers and ledges), which a relief term does not place | all three a little better |
| Moon | No. Retail has long contour-parallel streaks; the term gives rubble | about the same |

- **The alignment number does not make gullies.** With cells it combs them
  into dashes. With stripes it gives parallel flutes, not branching, and
  the blend has a near-jump mid-range **[measured: heights move ten times
  more for a step at .5 than at 0]**.
- **Nothing fitted reached 32-64 px.** That band is resolvable by the
  16 px height cells, so where it should affect movement it belongs in the
  shape (rule 11).
- **Flat ground:** exact on flat sections; Lava failed (13-25% of flat-cell
  pixels moved) because the relief gate bled a cell into the plain
  **[measured]**.

**The owner's reading of the Lava sheet (2026-11-09):** it does not match
retail "but looks really neat"; these are sci-fi worlds that need not follow
Earth or any planet we know, and controls like this may let artists make
new worlds. So the term failed as a retail match and passed as a look. It
is kept, as a relief kind of its own (R4).

**Conclusion.** Retail's sub-cell structure differs in kind from world to
world: facets on Red, lobes and flow lines on Lava, streaks on Moon, rock
slivers on Green. One term does not cover them, and no single number runs
from 1997 to natural. The engine's existing approach, a set of generic
relief kinds that a world turns up, is the right shape; what it has lacked
is a judge. Three rules for any relief kind did come out of the prototype,
and all were measured or seen there: it must change the surface before
light and shadow (Red's look *is* the small hard shadows); its detail must
be laid out per visible pixel, in screen or surface coordinates, or it
streaks on camera-facing slopes; and its gate must read real relief, not
height-byte noise, or plains move.


### 3.9 Literature and tools

From `~/terraform-assets/agent-rd-research/REPORT.md`. Items marked
*[search only]* were not opened by the reviewer; verify before relying on
their details.

- **How Cavedog made the terrain is not documented** in any primary source
  the scan could reach. One anonymous fan guide names Bryce; this project's
  own notes call the banding "Bryce contour banding". This plan treats "a
  ray-traced height field with stepped heights and procedural materials" as
  a hypothesis tested against the section pairs (section 3.1), not as
  history. Leads: Clayton Kauzlaric's "TA-ncient History" posts and an
  archived GameSpy article.
- **Pointwise erosion filter:** Rune Skovbo Johansen, "Fast and Gorgeous
  Erosion Filter" (blog.runevision.com, 2026-03-30). Every point is computed
  in isolation, so it chunks trivially. Its reference code is MPL-2.0; an MIT
  repository needs its own implementation from the description.
- **Interactive stream-power erosion:** Schott et al. 2023, "Large-scale
  Terrain Authoring through Interactive Erosion Simulation" (ACM TOG 42(5));
  artists paint uplift. Exact flow routing on a GPU in O(log n) passes: Jain
  et al. 2024, "FastFlow" (CGF 43(7)). Analytical steady states: Tzathas et
  al. 2024 *[search only]*.
- **Structure from primitives:** terrain from ridge and river curves by
  diffusion or by hydrology-based primitives (Hnaidi et al. 2010; Génevaux
  et al. 2013, 2015) *[cited from memory; not in the scan]*; divide trees
  (Argudo et al. 2019, orometry) **[read, measure/realism.py docstring]**.
- **Layered materials:** Peytavie et al. 2009, "Arches" *[search only]*.
- **Generative models:** Terrain Diffusion (Goslin, arXiv:2512.08309) needs
  about 2.2 GB of VRAM and works at about 90 m a pixel: a macro-landform
  source only, and not for a browser tool.
- **Authoring tools** *[search only]*: World Creator is the one users call
  truly real-time (GPU erosion, painted filters, layers); Gaea exposes a
  node graph with switchable preview resolution; Houdini masks every erosion
  parameter.
- **Palette:** Yliluoma's positional dithers and blue-noise thresholds are
  per-pixel and stable under edits; error diffusion is not, across tile
  edges. The engine already uses a positional method.
- **Realism metrics:** no validated metric exists for stylized or game
  terrain; geomorphon shares (the Perceived Terrain Realism Metric) are a
  tripwire, not a target.

## 4. Design

### 4.1 Principles

1. **Tests before engines.** No card that changes the look lands before the
   benchmark that judges it exists (R0).
2. **Structure before detail.** Form at 50-200 px decides whether terrain
   reads as natural. Detail and simulation refine a form; they do not make
   one (section 3.8).
3. **The 1997 look is a setting, not a target of the code.** One model; the
   retail worlds are its numbers. A retail trait the model lacks becomes a
   named, continuous term any world can use (rule 9), never a branch.
4. **Compute once, at the stage that owns it.** Every control belongs to one
   stage. Changing it recomputes that stage and the ones after it, nothing
   before it (R5).
5. **A preview is the same model, coarser.** Every interaction has a preview
   level; a preview may be blurrier than the final picture but must not
   look different in kind.
6. **Few controls on the surface, every number reachable.** An artist meets
   about ten controls per panel; everything else is one click away and still
   earns its place by the 5% rule (R9).
7. **A budget for size.** Controls, uniforms and shader lines have ceilings
   that a card may not raise without removing as much (R12).

### 4.2 The target pipeline

Today's stage order stays. What changes is what each stage owns, what it
caches, and which controls belong to it.

```
Recipe      strokes, the world's numbers, map data             saved; shared (R11)
  |
A Shape     strokes -> authored height and masks                lattice, about 2 px
  |           a landform = path + section + structure (R3)
  |           height images (R1)
B Time      per-landform refinement (R4, R8b)                   lattice
  |           game heights are read here, at 16 px
C Surface   1 px relief, loose ground, structure under 64 px    world tiles (R5)
  |           (R4)
D Solid     3D rock structure on faces; art only (R8)           transient
E Geometry  per pixel: hit, normal, shadow, occlusion           screen tiles (R5)
F Color     materials, placement, light, palette                screen tiles
  |
Outputs     32 px tiles and a tile budget (R10); 16 px heights; features; .ufo
```

| An artist changes | First stage rerun | Feedback |
| --- | --- | --- |
| A color, shine, light strength, palette | F | live, full quality at 1440p |
| Where rock or cover appears | F, D or C, as the stage map measures | live, or preview while dragging |
| Sun height or turn | E | preview while dragging |
| Rock structure (layers, joints, relief) | D | preview while dragging |
| Surface relief, stones, cracks | C | preview while dragging |
| Erosion, structure under 64 px | B or C | preview while dragging |
| A stroke, a section curve, a landform's structure | A | preview while dragging; final on release |

**What is not proposed.**
- *A persistent voxel world*, or any authored 3D: the game is 2.5D
  (section 3.7, R8).
- *A node graph.* A fixed stage order with a stack inside each stage is
  easier to learn and to cache; the recipe is the power-user surface (as
  docs/TERRAIN_ENGINE.md already decided).
- *A learned generator* (diffusion or GAN terrain): gigabytes of weights, a
  runtime the static site does not have, no per-machine determinism, and
  macro-landforms at a scale ten times coarser than a TA map (section 3.9).
- *Long whole-map erosion as the default.* It cannot be tethered to an
  artist's shape without making a comb (section 3.8), and untethered it
  takes the shape away. It remains available the honest way: erode in a
  dedicated tool and import the heights (R1).
- *A move to Go, WebAssembly or native.* The measured costs are in GPU
  passes the editor already owns (section 3.4).
- *Another renderer.* Five were compared a day before this review; the
  picture's gaps are elsewhere (section 3.2).

### 4.3 The cards

Each card gives the change, why, the design in enough detail to hand off, the
expected effect on interactivity and on final quality, how it is accepted,
and what could go wrong. Sizes: S is about a day for one agent, M a few
days, L a week or more with review rounds.

#### R0. The benchmarks (M; first)

**Change.** Build the checks from section 2 that do not exist, and make
them the bar for every later card.

**Why.** Scores have not tracked the picture: Green's look score stayed at
.21-.23 through five rock rewrites, the renderer builds of 2026-11-08 could
not be told apart by it, two
overnight gains were gamed, and seven blind rounds ended near chance
(section 3.6). The three windows per world also mix two things: how well a
scene's author traced retail's layout with strokes, and how the engine
looks. Green 4's shape score of .59 is a statement about tracing.

**Design.**
1. **Retail look bench** (`repro/retail-bench.mjs`, after R1).
   - Input: the retail section pairs under
     `$R/catalogs/sections/worlds/sections/<world>/<kind>/` (art at 1 px,
     heights at one byte per 16 px cell; about 690 pairs for six worlds).
     `$R/catalogs/sections-crystal`, `-ice` and `-zhon` exist and were not
     opened in this review; Desert has no sections and keeps its windows.
   - Each section needs its plain and its sea level: take the sea from the
     world's measured water threshold (section 3.1's model found one per
     world at .92-.97 accuracy) and the plain as the section's modal
     height.
   - A committed list of section *names* (names are not retail pixels) splits
     each world into a tuning half and a held-out half, fixed by a hash of
     the name.
   - For each held-out section: load its heights with the height-image op
     (R1), render with the world's look and no strokes, write
     `ours.png` beside a copy of `retail.png` under `$R/bench/<commit>/`.
   - Output: one contact sheet per world at 1x, pairs in random left/right
     order with the key in a separate file, for the owner to mark "which is
     retail". The number reported is how often the owner (or a blind
     reviewer) is right. 50% is the goal.
   - The existing `repro/stats.py` statistics run on the same pairs as a
     tripwire: a card that moves a statistic out of the retail band must say
     why.
   - This isolates the look (light, materials, the detail the engine adds
     under the 16 px cells) from stroke tracing, and editing a scene cannot
     game it.
   - What it leaves out: anything a stroke writes besides height (crack
     lines, a landform's local vegetation, paint). The bench judges the
     world-level look and refinement; the windows remain for the rest.
2. **Shape bench** (`repro/shape-bench.mjs`).
   - The four guides of section 3.8, as committed scene files using only
     Landform strokes at defaults.
   - Sheets with a fixed plain relief shade (not the world's look) for the
     owner's by-eye verdict: "does this read as a swept section, a comb, or
     terrain?".
   - `measure/realism.py` on windows centered on each landform, as a
     tripwire. Report Hack's gate separately: it is the one that says whether
     valleys join.
3. **Latency bench**: extend `repro/perf.mjs` with slider drags (one control
   of each stage, R5) and print the budget table of section 2 with pass or
   fail per row, on a named reference machine.
4. **Task-cost bench** (`repro/tasks.mjs`): the six scripted tasks of
   section 3.5; it prints clicks, drags and rows scrolled.
5. **New-worlds sheet.** Three or four invented worlds kept as world files
   (numbers only, no code), each rendered on the four guides and one flat
   scene. It is the test of "many biomes and planets": a relief kind or a
   control that makes one of these striking has earned its place even if
   it matches nothing retail. The owner's eye is the only score.

**Interactivity.** None directly; (3) makes regressions visible.
**Quality.** None directly; (1) and (2) make progress visible.
**Accepted when** each bench runs from `repro/check.sh full`, and the owner
has marked one retail sheet per world as the starting score.
**Risks.** Heights at 16 px under-determine the art, so `ours` will never
match pixel for pixel; the bench asks "could this be a retail section?", not
"is it this section?". Blind marking costs the owner minutes per round; keep
sheets to 12 pairs.

#### R1. A height-image op (S)

**Change.** A stroke kind that writes a height image into the authored
height plane.

**Why.** The retail bench needs it; artists who start from a height map made
elsewhere need it; and it is the cleanest test of "is it the shape or the
look?".

**Design.** (Audit section 9.)
- A list op, like `ground`: `kind: 'heights'`, params `{image, width,
  height, cell, x, y, scale, mode}` where `image` is base64 of 8- or 16-bit
  samples at `cell` px spacing (16 by default) and `mode` is raise, cut,
  flatten or replace, as for a landform.
- Evaluated in `engine-shape.wgsl` by a bicubic read in world coordinates
  (pure function of position, so tiles agree), in both the whole-map and
  `PAGES` variants, packed into the read-only `MW` array (binding 6) so the
  shape layout stays within eight storage buffers.
- Everything downstream reads the authored height plane, so Time, art,
  export heights, picking and the coarse lattice need no change.
- Size limit: a 16 px, 8-bit image of a 40x40 map is 1.7 MB raw; cap the op
  at 1,282 x 1,288 samples and warn in the stroke card when a share link
  would exceed the Worker's 1 MiB.
- UI: "Import heights..." in the Landform tool's preset list (no new
  panel), accepting PNG; the card shows the usual Elevation and mode rows.

**Interactivity.** Neutral.
**Quality.** Enables R0; lets artists bring in forms the stroke model
cannot make.
**Accepted when** a retail section's heights, imported and exported with no
other stroke, give back the same height bytes, and `repro/regional.mjs`
finds no mismatch on a scene that uses the op.
**Risks.** Bicubic interpolation of 16 px samples is smooth; that is the
point (the engine's refinement must add the rest).

#### R2. Light and placement as fitted numbers (S-M)

**Change.** Make the light fit of section 3.1 a standing tripwire on the
retail bench, name the light terms as world numbers and Light dials, and
set each retail world's numbers until its fit matches retail's.

**Why.** Section 3.1b. Our light is not too weak, as this plan first
assumed; on Red, Lava and Moon it is a third to two-thirds too strong, with
cast shadows darker than retail's. On Green, steep ground darkens half as
much as retail's, which is rock tone and placement. These are numbers, and
nothing measures them today: `repro/stats.py` has luma and edge statistics
but no fit of light against heights.

**Design.**
- **The tripwire.** Port `ours-fit/fit.py` into the retail bench: per
  section, directional gain, the steep-ground term and shadowed-over-lit,
  for retail and for ours, with the ratio. On the bench both use retail's
  heights, so the shape confound of section 3.1b is gone.
- **Terms** (all continuous, all in the world's file; they are the Light
  dials of R9, and most exist as uniforms today under engine names):

  | Term | Meaning | Where retail's fit points |
  | --- | --- | --- |
  | Sun height | elevation of the sun | 20-30° by world; ours fits 45° on Green and 40° on Lava |
  | Sun turn | azimuth; the TA convention fixes it near west | within 20° of west |
  | Light contrast | how much a slope's facing changes its brightness | down by a third to two-fifths on Red, Lava and Moon |
  | Shadow darkness | how much a cast shadow removes, set apart from contrast | lighter: retail's shadowed ground keeps .83-.89 of its light on Red, Lava and Moon, ours .67-.76 |
  | Steep darkening | darkening of steep ground whatever it faces | about double on Green |
  | Sky share | part of the light that comes from the whole sky | .3 to .95 by world in the prototype's fit |

- **Placement tables**: rock share against slope and height as a short
  curve per world, measured on the tuning half of the sections (Green:
  patches at every slope; Red and Lava: rising to 36% and 65% on steep
  ground); rock's tone; grain amplitude and hue speckle per world.
- **A per-map series**: Moon's bright and dark ground, Red's two tones. A
  map picks one of a world's named series (numbers in the world's file).
- **Procedure**: fit on the tuning half, judge on the held-out sheets of
  R0, one world at a time, Green first; the owner marks the sheets.
- **Not proposed after all:** cached sun-shadow and sky-occlusion planes.
  The first draft wanted them for longer, darker shadows; the measurement
  says ours are already longer-reaching and darker than needed, and the
  draw is 8-20% of a window, so there is little to save.

**Interactivity.** With R5, the Light dials are stage F and preview live.
**Quality.** A calibration, not a new model. It should bring Red, Lava and
Moon's shading down to retail's and Green's rock down to its tone; by
itself it will not make any world read as retail (section 3.1's verdict).
**Accepted when** each world's three fit ratios on the bench are within
about 15% of 1, and the owner's blind score does not fall.
**Risks.** Hand-traced windows will keep disagreeing with the bench where
shapes differ; the bench is the reference. The second light direction seen
in some sections (125-150°) is unexplained; if it is real, Sun turn covers
it.

#### R3. Structure in ridge-like landforms (L; a research card judged on the shape bench)

**Change.** A Mountain or a Hill grows a hierarchy from its drawn path
(summits and saddles, spurs, sub-spurs) before any detail, as part of the
shape pass, so game heights and far shadows see it. Plateaus, water and
valleys keep today's model.

**Why.** Section 3.8b: today's Mountain is an even-width loaf with a comb
of gullies; today's Hill a ringed pill. Two detail models laid on a swept
section could not fix that (section 3.8); a skeleton gave the best ridge
form of four approaches, with every hard constraint holding by
construction. "Even-width bands and ribs" has been reported since
2026-10-27 (section 3.6).

**Design** (from the prototype; `core.py` and `grow.py` there are the
reference).
- **Growth, on the CPU, once per stroke edit** (`prepareNode`): the
  recursive grammar of the prototype, with every random number hashed from
  a hierarchical id (stroke, path segment, side, station, branch), never
  from position or arc length, so dragging a point leaves most of the
  skeleton in place. The result is a segment list in the stroke's `MW`
  rows.
- **Height, on the GPU, per lattice cell**: the closed-form segment
  distance with hyperbolic rounding; a hard minimum within an element; a
  compact smooth minimum across elements; clamp so the result never rises
  above the drawn section; then the section curve. Segments are binned on
  a 32 px grid per stroke; merge 8 px steps into longer segments first
  (about 40 tests a pixel).
- **Controls** (they replace today's Spurs group, and the Wander and
  variation rows where those only wobble a loaf):

  | Control | Does | Note |
  | --- | --- | --- |
  | Dissection | how strongly spurs and valleys stand out; zero is the plain section | the main one |
  | Spur spacing | size and count of spurs | must fade elements in by weight, not by rounding a count |
  | Branching | sub-spurs and their reach | same |
  | Summits | saddle depth along the crest | |
  | Crest wander | the crest leaves the drawn line by up to a stated distance | missing in the prototype; its knife-straight crest is the first thing to fix |
  | Roundness | divides from rounded to creased | |

- **What must change from the prototype before it lands**: the crest must
  wander and round (the drawn path becomes the crest's corridor, not its
  line); Spur spacing and Branching must be continuous (rule 9); facets
  must break up (R4's fall-line detail on top); recursion one level deeper
  where the landform is wide enough.
- **Handles**: show the summits and the first-order spurs (about 35 on a
  600 px ridge) as draggable points when the landform is selected;
  sub-spurs regrow. This is the control over form the brief asks for, and
  it is new: today an artist can only reroll a seed.
- **Rims are a separate, later question**: an alcove-and-buttress grammar
  failed. If plateau rims need more, the candidates are rim retreat with a
  talus profile, or the grid simulation's cliff chutes run inside the
  landform's own domain (section 3.8).

**Interactivity.** Growth is a few milliseconds in JS for one stroke; the
per-cell cost is comparable to today's spur and gully evaluation.
**Quality.** The step that addresses "form" in section 3.2. It changes
game heights, so passability follows the picture.
**Accepted when**, on the shape bench, the owner prefers the new Mountain
and Hill to today's on the plain-shade sheets and in the world's look;
plains do not move; a tile equals the whole; the routes of existing scenes
stay passable; and every control passes the 5% and continuity checks.
**Risks.** This is the least certain card in the plan. Retail's hills are
soft mounds (section 3.1): the 1997 presets want low Dissection. Scenes
that trace retail windows with Mountain strokes will move.

#### R4. Relief kinds, one world at a time, on the bench (M per world)

**Change.** Keep the engine's library of generic relief kinds; do not chase
one unifying term. A kind earns its place in one of two ways: it closes a
gap on the retail bench for a retail world, or it makes a look the owner
wants for a new one. Each kind follows three rules.

**Why.** Section 3.8c: one term failed on Lava and Moon and was the wrong
tool for Green. Section 3.1: below 64 px the heights do not explain the
art, so this layer is where "recognizably TA" is won or lost, and it is
where every previous round worked without a judge (section 3.6).

**Design.**
- **The three rules** (each seen in the prototype): relief changes the
  surface before light, shadow and projection; detail is laid out per
  visible pixel; the gate reads relief on the lattice above a threshold in
  height units, so byte noise and plains stay flat.
- **A kind is a term with at most four controls** (amount, size, a shape
  number, irregularity) and a line output for dark creases, usable by any
  world from zero (rule 9). It lands only with the bench sheet that shows
  what it adds.
- **What the prototypes point at, by world** (to be confirmed on the
  bench, not assumed):

  | World | Missing kind **[by eye]** | Candidate |
  | --- | --- | --- |
  | Green | gray rock slivers and short ledges on slopes; thin cracks | a rock *material* placed on the crests and ledges of the existing relief, with the measured dark tone; not more relief |
  | Red | discrete hummocks with hard small shadows, also on gentle ground | cone cells of about 12 px (`structure.py`, `crease` +1), sparser than the prototype's |
  | Lava | rounded lit lobes with dark outlines; long sinuous flow lines | the existing lobe and layer terms, judged on the bench; a streak-line term |
  | Moon | sweeping contour-parallel streaks; crater-rim rubble | a strong irregular ledge or streak-line term at 4-6 px spacing with its own line output (the prototype's weak ledges had no measurable effect) |

- **Cells, the first kind kept for its own sake.** The prototype's term
  (`agent-rd-structure/structure.py`) with five controls: Amount, Size,
  Crease (cracked cones, round lumps, crisp-rimmed bowls), Irregularity
  (the warp) and Cells-to-flutes. It gives crackle webs, plated and
  hummocked ground and fluted slopes that no retail world has. Port it
  with the fixes its report lists: blend two fields, not two orientations;
  anchor Size so the pattern does not swim under the slider; gate on
  lattice relief so plains stay flat (Lava's did not).
- **Looks that follow no planet are in scope.** The retail bench judges
  the nine retail presets. Every other world is judged by the owner's eye
  on the new-worlds sheet of R0, and "it matches nothing on Earth" is not
  a defect there.
- **For the modern look**, organized detail comes from R3's skeleton with
  the pointwise fall-line filter on top (`agent-rd-shape-point/model.py`),
  as its own kind. Its blend from free to aligned must be a blend of two
  fields, not of two orientations (section 3.8c).
- **If an artist wants real erosion**, the honest route today is R1: erode
  a height map in a dedicated tool and import it. A built-in per-landform
  erosion bake (the grid model of section 3.8 run inside one landform's
  domain, its result stored like the old flow bake) is possible later; it
  needs a looser tether than the prototype's to be worth having, and that
  trades away the drawn shape.

**Interactivity.** Stage C: preview while dragging. **Quality.** This and
R2 are what move the retail score.
**Accepted when**, per world, the owner's blind score on held-out sections
improves over R2 alone, and the flat-ground and tile checks pass.
**Risks.** This is tuning by eye against 1997 art, the work that has
consumed the project so far. The difference now is a judge that cannot be
gamed and one world in flight at a time.

#### R5. Stage caches, and every control owns a stage (L)

**Change.** Split the per-tile render into cached stages, and declare for
every control the first stage it affects. A change recomputes from that
stage on.

**Why.** Today each tile recomputes everything over about 8x its area and
keeps nothing (section 3.3, items 1-3), and every World slider re-bakes the
whole view at final quality. Most rows an artist drags (colors, finish,
light strengths, cover amounts) change nothing about geometry.

**Design.**

| Stage | Holds | Grid | Invalidated by |
| --- | --- | --- | --- |
| A. Lattice | authored fields and masks (as today) | about 2 px, whole map or pages | stroke edits, shape controls |
| B. Time | eroded height and maps (as today) | lattice | A; Time controls |
| C. Surface | the relief bake's four channels; the 4 px runoff and loose-stone fields | world-aligned 256-texel tiles in an atlas | B within the tile's input window; surface controls |
| D. Solid | voxel bricks, transient as today; not cached | per piece | C; rock-structure controls |
| E. Geometry buffer | per output pixel: hit height, normal, sun shadow, sky occlusion, cavity, rain exposure | screen tiles | C, D; sun direction |
| F. Color | materials, light composition, palette: the bitmap that is cached today | screen tiles | E; color, finish, light-strength and palette controls |

- **Surface atlas (C).** One `rgba16float` texture, 4,096 x 4,096 by
  default (256 tiles, 128 MiB; smaller under a lower budget), with a
  tile-to-slot table. The bake writes each world tile once, reading only the
  lattice with the bake's own reach (19-180 px). The draw reads neighbors
  through the table instead of re-baking them, which removes the 8x
  overdraw. Texels outside any resident tile make the draw request that
  tile and retry, as a missing pipeline does today.
- **Geometry buffer (E).** 16 bytes a pixel: height (`r32float`), normal
  (two 16-bit), and six 8-bit terms. At 2,560 x 1,440 that is 59 MiB; at
  3,840 x 2,160, 133 MiB. Kept for visible tiles only; evicted first.
  The light terms are stored unweighted, so shadow strength, occlusion
  strength and sky fill are stage F controls.
- **Color (F).** The material and light parts of today's `fragmentMain`
  with the ray march and the four probes removed; it reads E. This is the
  pass a color slider reruns.
- **Stage map.** `sculpt-control-schema.js` gains a `stage` per control.
  It is not hand-kept: `repro/stage-map.mjs` moves each control and records
  the earliest stage whose cache changes, writes `stage-map.json`, and
  fails when a control's declared stage is later than the measured one.
  `canvas.clear()` takes a stage.
- **Order of work** (section 3.4's breakdown gives the values):
  1. *C as an atlas, kept for visible tiles.* The color pass reads the
     baked surface and the fed lattice textures, and both are discarded
     per tile today, so they must be kept before a color-only rerun is
     possible. A tile's bake window overlaps its neighbors' about eight
     times over (about 4 MiB a tile as it stands), so keeping it means the
     atlas (0.5 MiB a tile). By itself this removes the bake's overdraw:
     48-85 ms a window, 5-15%. Pixels must stay byte-identical.
  2. *Split E from F.* Materials and palette are 9-11 ms of a
     345-1,181 ms window; everything else in the draw and all of the solid
     is geometry. Byte-identical again.
  3. *The stage map and `clear(stage)`.*
  4. *D is not cached.* With E kept, nothing rereads the solid until
     geometry changes; it stays transient.

**Interactivity.** With C and E kept, a control whose first stage is F
costs the color pass: 9-11 ms per megapixel instead of 345-1,181 ms a
window **[measured stage times; the rerun itself is not built]**. That is
about 35-40 ms for a 1440p view, inside the 50 ms budget, and preview
level at 4K. **Which rows are stage F is for the stage map to measure.**
Colors, shine, light strengths and the palette are; rock exposure is
probably not (it gates the solid), and vegetation cover only partly
(plants are baked as relief). Rock-structure controls (86 World rows)
still rebuild the solid for visible tiles; R8 trims that.
**Quality.** None by itself (steps 1 and 2 must be byte-identical). It makes
tuning a look by hand, the owner's chosen method, far faster.
**Accepted when** all scenes are byte-identical after steps 1 and 2; the
latency bench meets the two slider budgets; `repro/stage-map.mjs` passes;
memory at 1440p stays under the 512 MiB default.
**Risks.** Memory: the atlas, the geometry buffer and the bitmaps together
approach the default budget at 4K, so eviction order matters (E first, then
C). Byte-identity across the atlas seam needs the same texel addressing as
today's window; step 1 proves that before anything else moves.

#### R6. The scheduler: several tiles at once, no readback, cancel between stages (M)

**Change.** Remove the three things that make tiles strictly serial.

**Design.**
- **Batch stages across tiles.** With R5, stage C for several tiles is one
  dispatch into the atlas, and E or F for several tiles is one pass with
  scissors. Plan a frame's work as stages, not as whole tiles.
- **No readback on the critical path.** `voxelClassify` already allocates
  brick ranges with an atomic counter. Give the solid a fixed pool sized
  from the budget, clamp in the shader, and read the overflow flag back
  asynchronously: on overflow, split and redo that piece. The common case
  never waits (`sculpt-volume.js:89-94`).
- **Cancel between stages**, not only between chunks
  (`sculpt-canvas.js:137-150`).
- **Measure the main thread before moving to a worker.** The Go prototype
  cut nearby-tile p95 from 274-280 ms to 36-41 ms with a dedicated GPU
  worker (section 3.6), which suggests main-thread work dominates. Add
  long-task counts to the latency bench. If tasks over 16 ms remain after
  R5 and R6, move the engine into a worker with an `OffscreenCanvas` (the
  scene builder in `sculpt-scene.js` is already free of the DOM); if not,
  do not.

**Interactivity.** Lower latency on every path; fewer wasted renders while
dragging. **Quality.** None.
**Accepted when** pixels are unchanged and the latency bench improves on
release-to-final and on nearby-tile p95 by a stated number.
**Risks.** The pool makes memory use fixed rather than exact; the tracked
peak must still be reported honestly.

#### R7. A preview level for every control, and no compile on the critical path (S)

**Change.** Dragging any slider uses the quarter level that strokes already
use; a missing specialized pipeline falls back to a generic one instead of
waiting.

**Design.**
- `interacting()` (`sculpt-canvas.js:38`) covers a pointer held on any
  World, rock or surface control; the final level follows on release.
- **The preview raster follows the level.** At the quarter level the draw
  shades one ray per output pixel while a pointer is held, not two by two
  (`rasterScale`, `sculpt-chunk-renderer.js:169`); the supersampled version
  follows on release. The draw is 71-92 ms a window at 1x and the preview
  window is 263 ms on cliffs **[measured, section 3.4]**; if the preview's
  draw costs the same, as its raster suggests, this is worth about a fifth
  of a preview window **[inferred]**. It is also the precondition for
  judging a brickless solid (R8).
- Build one generic set of pipelines at startup in which each gate is the
  uniform comparison it was written as, tested per pixel, with no
  specialization. It draws the same picture, about a quarter slower
  **[inferred from P6's 24-29% saving]**. On a `SpecializationMiss`, draw
  with the generic set and swap when the specialized one has compiled.
- Add a check that the generic and specialized pipelines agree on every
  scene, and that every continuous control's gate is a no-op just above
  its threshold; today nothing proves either.

**Interactivity.** Removes the 0.9 s stall on a gate crossing and gives all
237 World rows a live preview. **Quality.** The agreement check enforces
rule 9's continuity in code.
**Accepted when** the latency bench meets the 100 ms row, and generic
versus specialized differ by at most the compiler drift already recorded
(1-12 px in 7 scenes).

#### R8. The solid: keep the cliff look, stop paying for the slab (M-L)

**Change.** Keep a true 3D rock structure on faces, as art only. Build it
through a thin shell or not at all, and take the wear passes off the
critical path.

**Why.** Section 3.4. Sideways displacement is what the voxel look is; a
height field cannot give it. But 64-87% of every window's time exists only
because of the solid, 70-77% of a cliff window is the build and the wear,
and the wear is invisible at shipped settings.

**What does not change.** The authored and game heights stay a height
field. A persistent, editable voxel map (caves, an overhang brush, a voxel
save) is not proposed: the game reads one height byte per 16 px, the camera
never sees under an overhang, and it would break the recipe model. The
solid stays transient, built from the surface, for art.

**Design, in order of cost.**
1. **Free now** (each measured in section 3.4): skip brick allocation
   where every gate is closed (lossless, about six lines in
   `voxelClassify`); fix the march aliasing with a one-voxel step near the
   surface, paid for by skipping empty space above each column's top (the
   pair costs the same as today; it changes green-2's rock band, so judge it
   on R0's sheet).
2. **Wear only where it shows.** Run the wear passes on bricks that hold
   the surface, and make their count follow the Weathering value (zero
   passes at zero, by a strength that fades in, so the control stays
   continuous). Saving at today's defaults: 15-18% of a window. The
   picture does not visibly change, but 52-73% of cliff pixels do by more
   than 8/255, so every rock scene's fixture moves: this step lands with
   the owner's eye on its sheet, not as a silent optimization.
3. **A thin shell (BAND), compacted.** Section 3.4b: lossless on the
   solid, 13-23% of a cliff window, nothing at the preview level. Port the
   prototype (`RD_BAND` on `rd/voxel`), store only the kept bricks (about
   20 MiB less on a cliff tile **[estimated]**), and try 4-voxel bricks,
   which were not timed.
4. **Decide on no bricks (IMPLICIT) with the owner's eye, after R7.** It
   is the simpler machine and 9-38% faster at 1x with a third of the
   memory, but it changes the rock's grain. Before it can be judged it
   needs: the preview raster fixed (R7), without which it is slower while
   dragging; Weathering restated inside the rock function (the soft-bed
   retreat is a per-point offset and folds in directly; the rounding
   becomes an edge-rounding width on the block, joint and bed terms); and
   full-quality probes (the cheap version darkens faces). Then put it
   beside the bricks on R0's sheets. If the owner prefers or cannot tell,
   it replaces the brick path outright (rule 7: one path); if not, it is
   closed.

**Interactivity.** Steps 1-3 together take roughly a third off a cliff
window (1,131 ms to about 700 on green-4 **[inferred from stage times]**),
and so off release-to-final and export where cliffs are in view. They do
not make the solid cheap: after them it is still most of a window. What
keeps the artist from paying for it is R5 (it is rebuilt only when
geometry changes) and the preview level (263 ms a window today).
**Quality.** Unchanged by design; the aliasing fix is a small gain.
**Accepted when** the cliff crops of section 3.4 are not visibly different
from main at 1x, `repro/voxel.mjs` still passes (repeat renders, equal art
under different budgets, unchanged gameplay heights), and a cliff window's
time falls by the measured figure.
**Risks.** Zero wear passes at low Weathering must fade in without a step
(rule 9). The honest summary of this card is a trade the owner has already
made: broken-rock faces cost about three times a height-field draw, and
that price can be trimmed, not removed.

#### R8b. Erosion once per edit: make it visible or make it cheap (S)

**Change.** The whole-map Time pass costs 416-875 ms after every settled
edit and its controls move 0.7-1.9% of their class on Green (section 3.3).
Until R4 replaces what it is for, run it only on the landforms an edit
touched, and drop the unread drainage pass. In the grid prototype each
landform with its skirt was an independent domain, because level plain is
fixed base level (section 3.8); whether the engine's own pass has that
property is the first thing to check. The pass already dispatches over
active tiles only, so part of this saving may exist; measure before
building. **First, diagnose the 5 s and 8.4 s waits of section 3.5**: they
are larger than any stage measured and may be a hold, which would be worth
more than this card.
**Accepted when** release-to-final falls by the measured Time cost on a
map where one landform of ten is edited, and the report states the largest
height difference from the whole-map pass (the goal is none beyond
rounding).

#### R9. The control model: world, landform, spot (M, in three steps)

**Change.** One short set of dials in the artist's own words, usable at
three scopes: set it for the world, shift it for a landform, paint it for a
spot. Every existing row stays reachable behind the dial that drives it.

**Why.** Section 3.5: 234 World rows over 12 screens, 45 of them another
world's, 110 changing under 5% of a capture (a tripwire; rule 9's class
sweep passes); rock is not on the landform;
one idea lives in up to nine places. The brief names the dials itself: rock
geology, soil, sand, vegetation, erosion, gravel and boulders. The engine's
own design already said "at most five main controls a panel" and "paint to
override" (docs/TERRAIN_ENGINE.md, Usability); it was not built.

**Design.**

*Step 9a: make today's panel honest and navigable (no new concept).*
- **Show only what this world draws.** A group whose parent is zero and
  whose feature the world's file does not use is not listed; it is offered
  by "Add a look feature..." at the end of its section (the owner's rule
  that any world can enable any feature holds; it stops costing every world
  45 rows).
- **A section index** pinned at the top of the World tab (one section open
  at a time), with Manage worlds first, not 8,269 px down.
- **Merge the duplicates** found in section 3.5: one home for cracks; one
  Shine block with a material picker in place of five copies; one slider
  whose zero is off in place of a switch plus a slider; rename one "Contour
  bands".
- **Artist words on every label**, numbers and units in the hover help, one
  sentence of help per row (227 rows have none), one name per tool from
  toolbar to card to the Shapes list.
- **Progress where the eye is**: a line under the canvas, "Shape ·
  Weathering · Detail 12 of 40", fed by the stages of R5.
- **Fix the traps** of problem 8 (the pre-checked color box, starting
  points that cannot set a color, reasons that point at a hidden slider).
- **After a stroke, stay on its card.** Transform controls go to a row of
  handles on the canvas, not above the settings.

*Step 9b: dials.*
- A **dial** is a 0-100 control with an artist's name. It is data, not
  engine code: `dials: {erosion: {gullies: [[0,0],[100,60]], talus: ...}}`
  in the world's file maps the dial's value to each row it drives by a
  piecewise-linear curve. The engine still sees only rows.
- **About ten dials per world**, in the brief's nouns:

  | Section | Dials on the surface | Drives (examples of today's rows) |
  | --- | --- | --- |
  | Rock | Type (a starting point), Exposure, Relief, Layering, Jointing, Weathering | Rock share and its slope rule; Depth; layer thickness and ledges; block size and joint depth; wear, crust |
  | Ground and soil | Roughness, Patchiness | undulation, ground bumps, pattern contrast |
  | Sand and sediment | Amount, Ripples | deposit supply, aprons, ripple height and length |
  | Vegetation | Cover, Lushness, Flowers | vegetation cover, moss, grass on ledges, flower density |
  | Erosion and debris | Age, Scree, Boulders | structure and gully strength (R3, R4), talus, loose-stone supply, size and sorting |
  | Water and shore | Shallows, Beach, Surf | shelf, beach width, foam |
  | Light | Sun height, Shadow, Sky | sun elevation, cast-shadow darkness, sky share |
  | Finish | Grain, Shine | speckle, dither, gloss |

  Colors stay as swatches beside the section they color.
- **"More..." opens the section's rows.** A row moved by hand shows a pin
  and keeps its own value until unpinned; the dial moves the rest.
- **The same dials at three scopes.** World sets the value. A landform's
  card offers *Rock, Vegetation, Erosion and Debris* as offsets (more or
  less than the world), which answers "rock on this hill". Paint offsets
  the same four locally. This generalizes today's Local vegetation and the
  23 paint channels (owner decision 5, per-feature overrides).
- **Presets are dial values plus pins.** Starting points for rock are the
  same thing at section scope, and may carry colors.

*Step 9c: explore by looking.*
- **Blend between two worlds or two presets.** Because every control is
  continuous and a preset is only numbers, any two presets interpolate.
  One slider, "toward ...", gives the 1997-to-modern dial for a world (its
  retail preset against its modern one) and a quick way to find a look
  between two others.
- **A variations strip**: the selected landform at six seeds, or six values
  of one dial, rendered at the preview level into the dock; click to keep.
  Cheap once R5's stages exist.

**Interactivity.** Fewer rows to find; with R5 and R7 every dial previews
live. **Quality.** Indirect: an artist can reach a look the engine already
supports.
**Accepted when** the task-cost bench shows (b) and (d) with no scrolling
past more than 20 rows; a first-time user completes the six tasks unaided;
the World tab's surface is under 60 controls; the 5% sweep passes for every
dial at both ends, on each world's own scenes.
**Risks.** A dial hides which row did the work; the pin and "drives 6
settings" text are the remedy. Dial curves need an owner per world: ship one
generic set and let worlds override. Step 9b should follow a session with
real map makers (section 7, question 9), not precede it.

#### R10. A tile budget, and detail that repeats by design (M)

**Change.** Treat distinct tiles as a budget the artist can see, and make
level ground reuse tiles the way retail's does.

**Why.** Our maps use 83-90% unique tiles against retail's 5-10%; export
degrades past about 15x15 units; at the cap Nanolathe holds over a gigabyte
of atlas (section 3.7).

**Design.**
- **Show the number.** The status bar and the Export pane show the map's
  estimated distinct tiles (counted on rendered tiles, scaled to the map)
  against two lines: retail's practice (about 11,500) and the cap (65,536).
- **Level ground from a pool.** Extend today's 1,024 px ground repeat: on
  cells the lattice marks level, every per-pixel term (grain, dither phase,
  speckle, flowers, small stones) is periodic in 32 px and chosen from a
  per-world pool of K variants by a hash of the tile, with K a world number
  (retail-like at 16, richer at 256). Terms that vary slowly (undulation
  shading, wetness) are quantized to a few levels on level ground so equal
  inputs give equal tiles. Slopes keep unique detail.
- **Stamps** (section 7, question 7): a group of strokes placed more than
  once at 32 px-aligned offsets, with its noise in its own frame, renders
  the same tiles each time. This is how retail's largest maps stay near 5%.
  First measure it: one landform placed ten times, distinct tiles against
  ten different landforms.
- **Optional, with Nanolathe (question 4):** export a 2x art sheet for the
  engine's detail view in place of its patch-match guess.

**Interactivity.** Neutral. **Quality.** Keeps full-size maps exact instead
of merged; a 2x sheet would be the first step past the 1997 format.
**Accepted when** a 16x16 Green map with 20% of its area as landforms
exports under 30,000 distinct tiles with no merge, and level ground shows
no visible repeat at 1x or at Fit **[by eye]**.
**Risks.** Visible repetition on plains; the pool size is the dial for it.

#### R11. The map carries its world; export ignores view options (S)

**Change.** Save, share link, autosave and undo include every World row
and color that differs from the world's file; export forces Clay off and
the palette on.

**Why.** Section 3.3, items 6 and 7. A shared map currently opens with the
recipient's look.

**Design.**
- `sketch()` gains `world: {knobs, colors}` holding only the differences
  from `materials/<world>.json` (so a default map stays about 3 KB
  gzipped). `setKnob` writes to the document; local storage keeps only
  named presets ("My worlds"), which are copied into a map when applied.
- History entries include the same block; a World row drag is one undo
  step on release.
- Move the Python tables (`KNOB_DEFAULTS`, `WORLD_KNOBS`, `ENGINE_KNOBS`,
  `LIGHT_PASS` in `sculpt.py`) into the materials files, so a world has one
  home.
- `exportChunks` passes fixed draw options.

**Accepted when** a share link opened in a clean browser profile renders
the same bytes as the author's page, on a map with ten non-default World
rows and two changed colors.


#### R12. Budgets and the order of rewrites (S; a rule, not code)

**Change.** Three ceilings, checked by `repro/gate.sh`, and one rule about
sequence.

**Why.** Dead controls regrow after each audit; the shaders, uniforms and
knobs "did not get simpler" when the engine replaced engine 0 one for one
(BACKLOG.md:6015-6030); and three rock or render rewrites landed in one week
without a test that could tell them apart (section 3.6).

**Design.**
- **Ceilings**, set at today's counts and lowered as R9 and section 6 land:
  controls on the surface (per panel and total), uniforms (323), shader
  lines (8,579). A card may raise one only by lowering it as much elsewhere
  in the same card, or with the owner's word.
- **One look change at a time per stage**, each judged on R0's sheets
  before the next starts.
- **A proposal for a new render primitive or a new simulation** must first
  show, on R0's benches and outside the editor, a result the current one
  cannot reach. The five-renderer comparison of 2026-11-08 measured speed
  and statistics that could not tell the builds apart; it never showed the
  two candidates with the same light and materials.

## 5. Order of work

Three tracks. Within a track the order matters; the tracks touch different
files and can run side by side once step 0 is in. Each step ends with the
owner looking at a sheet or a number, not at a score table.

**Step 0: the ground to stand on (about a week).**

| Card | Size | Why first |
| --- | --- | --- |
| Section 6 deletions | S | Everything after is easier with 21 dead branches gone; byte-identical |
| R11 the map carries its world; export ignores view options | S | A correctness bug in sharing, and R0's scenes need it |
| R1 height-image op | S | R0 needs it |
| R0 the benches and the new-worlds sheet | M | Nothing that changes a look lands before its judge exists |
| R7 preview level for every control; generic pipeline | S | Makes every later tuning session faster |
| R8 step 1 (closed-gate bricks, march fix); step 2 (wear where it shows) once the owner has seen its sheet | S | Step 2 is 15-18% of every window for a few lines, but it moves every rock fixture |

Gate: the owner has marked a starting retail sheet per world and a starting
shape sheet; the latency table prints.

**Track A: speed.** R5 step 1 (split geometry from color; the stage map)
-> R8 step 3 (the thin shell) -> R6 (scheduler) -> R8b (erosion per
landform) -> R5 step 2 (surface atlas) -> R8 step 4 (the owner's call on a
brickless solid).
Gate: every row of section 2's latency table passes on the reference
machine at 1440p.

**Track B: the picture.** One world at a time, Green first, each judged on
the retail bench and by eye. R2 (light and placement as fitted numbers) ->
R4 (relief kinds) -> R3 (structure in ridge-like landforms), then the same
for the next world.
Gate per world: the owner's blind score on held-out sections moves toward
50%, and the world's modern preset is approved on the shape bench.
R2's shader changes and R5's split both rewrite `fragmentMain`: land R5
step 1 first if both are ready, since it must be byte-identical.

**Track C: the artist.** R9a (the honest, navigable panel) -> a session
with outside map makers (section 7, question 9) -> R9b (dials at three
scopes) -> R9c (blend, variations) -> R10 (tile budget, stamps).
Gate: the task-cost bench, and a first-time user finishing the six tasks.

R12's budgets apply throughout.

## 6. What to delete

Each is dead or duplicated today **[read, audit section 10]**. Deleting them
is one card (S), with every scene byte-identical.

| Delete | Why |
| --- | --- |
| The non-chunked renderer path: `TerrainRenderer.create`, every `#else` of the 21 `CHUNK` tests, `sample`/`pick` on the renderer | No caller |
| The 'preview' draw quality | No editor or check requests it; R7 replaces the idea with a real level |
| The drainage plane and its nine entry points | Read by nothing; if R3 or R4 needs flow, it is rebuilt for that reader |
| Mask planes 8, 9 and 20-24 | Unused, yet copied to the CPU and into a 7-layer texture per chunk |
| The CPU twin of the Time blend (`sculpt-scene.js:383`) | A CPU copy of GPU work (rule 7); read export heights from the GPU result |
| One of the two shader preprocessors | Two rule sets for the same job |
| Amount, Roughness and Softness on landform cards; the shift-drag Amount gesture | Not read by the landform pass |
| `isRiver` / `isBraided` tests on the form's name | Engine behavior keyed on a name; make it numbers (river span, belt) on any landform |
| Stale names: `terrain-sculpt-v3.json`, `sculpt-common.wgsl` in messages, the JS-engine header of `engine-shape.wgsl` | Mislead the next reader |

After R9: every control the 5% sweep finds dead once the surface controls
drive it (expected: a large share of the 237 World rows become reachable
only through "Advanced", and those that no preset or artist moves in a
release cycle are removed).

## 7. What you are not asking, and the trade-offs

### Questions worth an answer before more engine work

1. **What says "this looks like retail", and who signs it?** Today it is the
   owner's eye on agent-made sheets, after scores failed three ways
   (section 3.6). R0 proposes a blind sheet and a count. Without something
   like it, every later card is judged by whoever built it.
2. **Which machines must run this?** Every recorded number is from one Apple
   M3 Pro. WebGPU is the only path. The default GPU budget is 512 MiB. A
   hardware floor (for example: an integrated GPU from 2020 at 1080p)
   decides whether the solid, the caches of R5 and 4K views are affordable.
3. **Is the published `.ufo` the only thing two players share?** Art and
   heights are deterministic per machine, not across GPUs. Nanolathe's lobby
   hash covers the height map **[read, research/formats/tnt.md:237-239]**, so
   two people who each export the same share link may get maps that do not
   match in multiplayer. The deploy plan already makes the published
   archive the unit; say so in the Export pane, or make export heights
   bit-exact everywhere (integer math on the 16 px lattice).
4. **How far may Nanolathe go beyond the 1997 format?** Inside it,
   "hyper-real" means 242 colors, 32 px tiles and painted light. The
   cheapest step past it is a map-supplied 2x tile sheet; next, a
   true-color sidecar for the Enhanced renderer (section 3.7). The answer
   sets the ceiling for everything in this plan, and whether "modern" worlds
   are worth tuning in full color.
5. **Should what blocks a unit look like it blocks?** Rock faces, boulders
   and gullies are art; movement reads one height byte per 16 px. A cliff
   can look sheer and be drivable, or the reverse. The Passability view
   shows the truth, but nothing warns. A lint that flags cells where the
   art's material says "cliff" and the cell is passable to vehicles (and the
   reverse) would catch it at the source.
6. **Do multiplayer maps need symmetry and fairness tools?** A stroke recipe
   makes mirrored or rotated copies nearly free (replay a group through a
   transform, with its own seed or the same). TA's fixed sun and oblique view
   mean mirrored cliffs will not look mirrored, which is fine for play.
   Start distances, choke points and metal balance are a few graph
   measurements on the passability grid; Nanolathe's map generator already
   has fairness logic to borrow.
7. **Do artists start from nothing?** Cavedog assembled maps from sections.
   A group of strokes saved as a stamp, with seed variations shown as a
   strip to choose from, is the same workflow and the fastest way to a full
   map. The original plan had the variations strip (PLAN_TERRAIN_EDITOR
   section 9); it was never built.
8. **What happens to an artist's map when the engine changes?** Saves are
   recipes, so every look change redraws every map. Before release that is
   policy. After it, the site's versioned build folders (`b/<version>/`)
   make a cheap answer possible: a map opens in the build that made it, and
   upgrading is a button with a before/after. Decide before the first
   outside user.
9. **Who are the artists, and when do they touch it?** Every judgment so far
   is the owner's or an agent's. Three TA map makers doing the six tasks of
   section 3.5 for an hour would reorder this plan more reliably than any
   audit.
10. **Is Metal in scope?** Its sections are man-made structures whose art
    ignores the height shift (section 3.1). It is a tile-and-structure
    generator, a different product from terrain. The same goes for the
    Urban world of the expansion.
11. **Should the tile budget be a first-class constraint?** Our maps use
    83-90% unique tiles; retail's use 5-10%. Past about 15x15 units the
    export degrades, and at the cap Nanolathe holds over a gigabyte of
    atlas. A hyper-real map of full size needs detail that repeats by
    design (R10), or an engine change (question 4).
12. **What is committed when the repository goes public?** Tables measured
    from retail are policy. Worth one more look before publishing: the 16
    ground tiles stored as palette indices (do they come from a model, or
    are any of them close copies?), and every color ramp "measured from
    retail by luma octile".
13. **Is this pace reviewable?** 1,929 commits in 14 days, a 666 KB backlog,
    documents that the next agent is told may be stale. R12's budgets are
    one guard. Another is fewer, larger cards with the owner's eye on a
    sheet at the end of each, which is how the work that stuck (the Landform
    tool, crystals, generated features) was done.

### Trade-offs that will not go away

| Tension | Where this plan stands |
| --- | --- |
| **Realism, control, speed: pick two.** Long simulation gives realism and takes control and time; pure functions give control and speed and look synthetic | Control and speed, with realism from structure the artist can see and move (R3), and simulation only inside a landform's own domain (R4) |
| **Global processes against tile independence.** Drainage is global; tiles must not be | Vector structure is global and tiny; raster work is local to a landform. Rivers across plains stay explicit strokes |
| **A preview that is fast against a preview that is true.** A coarse preview can teach the artist the wrong picture | Previews are the same model at a coarser grid (principle 5), with a check that the generic and final pipelines agree (R7) |
| **A true 3D solid against a height field.** | See R8 |
| **Hyper-real against 256 colors.** Dither hides banding and multiplies unique tiles | The palette step stays; detail that repeats by design keeps tiles down (R10); full color waits on question 4 |
| **Power against a short panel.** Rule 9 wants a control for everything an artist would shape | Few controls on the surface, every number one click away, and both tiers held to the 5% rule (R9) |
| **One engine for every world against looks that are not terrain.** Crystal, Ice and Metal keep pulling world-named terms into the shader | A trait becomes a generic term any world can turn up from zero, or it stays out (principle 3) |
| **Matching 1997 against looking natural.** Retail's marks follow no fall line; natural terrain's do | No single number runs between them (section 3.8c). A world's retail preset and its modern preset are two settings of the same relief kinds, and R9c's blend moves between them |
| **Art detail against game truth.** Sixteen-pixel heights cannot carry what the art shows | A lint, not a fix (question 5); large features must live in the shape |

## 8. Rules this plan would amend

- **Rule 9**, add: "A panel shows at most about ten controls before
  Advanced. Every control declares the stage it first affects, and the
  stage map is checked."
- **Rule 10**, replace "three windows per world" as the bar with: "A look is
  judged on the retail bench (retail's own heights, held-out sections,
  blind sheets), and by the owner's eye. The windows remain as scenes."
- **Rule 12**, add: "Export does not depend on view options. A map carries
  its world."
- **Checks table**, add the benches of R0 and the stage-map check.

## Appendix A. Evidence index

Everything below is outside the repository. Folders under
`~/terraform-assets/` (also reachable as `$R/`):

| Folder | Holds |
| --- | --- |
| `agent-rd-pipeline/REPORT.md` | The pipeline audit: data model, a stage-by-stage table, the interactive path, aprons, sizes, dead code; file and line throughout |
| `agent-rd-history/REPORT.md` | What was tried, tables A-M, with a reference for every row |
| `agent-rd-research/REPORT.md` | Literature and tools, each item tagged opened or search-only |
| `agent-rd-output/REPORT.md` | The export contract and what the Nanolathe engine could accept beyond it; file and line throughout |
| `agent-rd-controls/` | `controls.csv` (452 rows), `controls-summary.json`, about 90 screenshots in `shots/`, task logs, the fresh Green control sweep in `world-controls/` |
| `agent-rd-look/` | `REPORT.md`, `scripts/model.py` (the look model), measurements `m*.json`, held-out sheets in `out/sheets/`, modern and sweep sheets in `out/modern/` |
| `agent-rd-shared/` | `guides.py` (the four guides and the plain shade); `engine-base/` (today's presets on the same paths, and the comparison sheets) |
| `agent-rd-shape-sim/` | Grid simulation: `sim_a.py` (kept), `sim_b.py` (rejected), sheets in `A/` and `B/`, realism tables |
| `agent-rd-shape-point/` | Pointwise filter: `model.py`, `stripes-*-pair.png`, `stripes-sweep.png`, checks and realism tables |
| `agent-rd-shape-skeleton/` | Skeleton: `core.py` (height formula), `grow.py` (grammar), `skel-*-triple.png`, `sweep-*.png`, `eval.txt` |
| `agent-rd-structure/` | The structure term on retail sections (section 3.8c) |
| `agent-rd-voxel/` | Ablation images in `img/`, timings in `time/` and `time2/`, `img/metrics.json` |

Worktrees left in place: `../terraform-wt-rd-voxel` (branch `rd/voxel`, the
ablation switches and timing tools) and `../terraform-wt-rd-controls`
(branch `rd/controls`, nothing committed). Neither is merged or pushed.

Every folder holds a `REPORT.md` (the voxel folder also `REPORT-2.md`, the
thin-shell and brickless follow-up). The shape and structure reports give
each model precisely enough to port; the code beside them is the
reference. `agent-rd-output/REPORT.md` is the export and engine audit
behind section 3.7 and appendix B.

## Appendix B. The output format, with references

`T` is this repository; `N` is `~/src/nanolathe`.

| Fact | Where |
| --- | --- |
| Tiles are 32 x 32 palette indices; the tile map is 16-bit, so at most 65,536 distinct tiles | `T/export/merge.go:11-13`; `N/research/formats/tnt.md:91-93,133`; `N/formats/tnt.go:214-217` |
| Above the cap, a weighted median cut over 8 x 8 block means merges the most alike tiles; single-use tiles merge first | `T/export/merge.go:11-39,127-161` |
| Distinct tiles recorded: Green 4x4 3,668 of 4,420; Lava 8x8 14,715 of 17,028; Red 16x16 60,072 of 66,820 | `T/docs/VOXEL_TOOLS_REVIEW.md:91-93` |
| Retail: median 3,218 distinct tiles over 275 maps, at most 11,561 | `T/BACKLOG.md:1153-1160` |
| One height byte per 16 px cell corner; the editor point-samples the weathered lattice | `T/sculpt-map.js:49-63`; `T/export/main.go:195-203` |
| Art is in screen space: one height unit is half a pixel up | `T/export/README.md:54-55` |
| The draw quantizes: a 32-step color cube, nearest palette color in RGB, or eight Knoll candidates found in OKLab and picked by a 4 x 4 Bayer threshold, or an ordered-noise dither | `T/engine-palette.wgsl:1-8,32-75`; `T/engine-frag.wgsl:89-106,2213-2236` |
| 242 distinct palette colors; only Desert restricts itself (52) | `T/materials/palette.json`; `T/sculpt-renderer.js:183,381` |
| Nanolathe keeps terrain paletted until its last pass; the Enhanced renderer composites in RGBA | `N/internal/platform/gpurender/terrain.go:14-31`; `N/docs/DESIGN_GPU_RENDERER.md:1386-1397` |
| Nanolathe has no terrain sun, normals or shadows; relighting and material masks are out of its scope | `N/docs/DESIGN_GPU_RENDERER.md:7466-7470,6139-6141` |
| Enhanced water (ripples, foam, damp band, reflections) is computed from heights and sea level | `N/docs/DESIGN_GPU_RENDERER.md:6433-6444,6513-6525`; `N/internal/platform/gpurender/water.go:1-60` |
| The 2x detail view uses one 64 x 64 tile per map tile, synthesized by patch-match at load; a map cannot ship its own | `N/docs/DESIGN_GPU_RENDERER.md:3064-3152`; `N/internal/client/detail_art.go:30-33` |
| Loader limits: 8,192 cells a side, 16,777,216 cells, up to 1,048,576 tiles accepted, TNT versions `0x2000` and `0x1020` only | `N/formats/tnt.go:42-47,132-183` |
| The lobby map hash covers the header, the height and attribute map and the feature records | `N/research/formats/tnt.md:237-239` |
| Passability is per cell: slope is the max minus the min of its four corners in height units, against the unit class's limits; water depth gates before slope | `N/internal/movement/profile_footprint.go:46-95` |
| Reference limits: vehicles slope 15; KBots 11 or 32; hover 12; land units wade to depth 12 | `T/docs/PASSABILITY.md:12-27`; `T/sculpt-passability.js:8-14` |
