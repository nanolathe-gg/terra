# Terraform redesign plan

Proposal of 2026-11-09, written against main `7d90fda9`. It is kept on main
as a working document so that every agent edits one copy (branch
`plan/redesign` is where it was written; `plan/redesign-decisions` is
merged into it and retired). Being on main does not make a card approved:
a card is a contract once what it says must be shown has been shown and
the owner agrees. Section 7 records the owner's answers and takes
precedence over earlier recommendations in this proposal. [AGENTS.md](../AGENTS.md) governs repository work, subject to the
owner's explicit instructions; section 8 lists proposed rule amendments.

This revision records product decisions and their direct consequences for
the cards. It does not approve every technical design, estimate, or finding
in the original proposal.

A second revision of the same day folds in the adversarial review (Codex;
its hand-off is `docs/REDESIGN_CLAUDE_HANDOFF.md` on
`prototype/redesign-foundations`). Seven of its thirteen points (1, 2, 3,
5, 10, 11 and 12) were checked against the code and the evidence files and
hold; the other six are design judgments this revision accepts; none was
found wrong. Wrong statements are corrected where they stood, and each
affected card says what must be shown before it becomes an implementation
contract.

A later revision of the same night records the owner's decision to work on
realistic terrain first and to stop tuning toward retail until later
(section 7, "Latest answers"). Section 5 opens with it, and the goals table
of section 2 is changed to match. Sections 1, 3 and 4 were written before
that decision. Their retail measurements stand as measurements. The cards
that tune a world toward retail (R0 item 1, R2 and R4) are parked, not
deleted: the retail scenes, boards and scripts are kept for the return.

The owner's brief for this review: an artist-driven, hyper-realistic,
parametric terrain tool with a fixed camera; near-real-time feedback with
iterative refinement; able to mimic the retail worlds and to go beyond them;
easy to use; everything open to question.

## How to read this

- Every claim is tagged **[measured]** (a number, and where it came from),
  **[read]** (in the code or a document, with the file), **[by eye]** or
  **[inferred]**. Product requirements agreed by the owner are tagged
  **[owner decision]**; they are not performance measurements.
- Evidence that cannot be committed (anything showing retail art, and the
  throwaway prototypes) lives outside the repository under
  `~/terraform-assets/agent-rd-*/`. Each folder is named where it is used,
  and appendix A indexes them.
- Section 1 is the verdict. Section 4 is the design, as hand-off cards.
  Section 7 records the owner's decisions and the remaining validation work.

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
   takes 13-23% off a cliff window with nothing visible by eye (it is not
   byte-identical: section 3.4b); skipping the wear passes at today's weak
   settings takes another 15-18% and cannot be seen, but it moves pixels
   and so needs the owner's look. The rest is the cost of the builds
   tested, not a proven floor: the solid is kept because it works and
   replacing it is out of scope now, and the question reopens if a
   controlled comparison (same light, same materials) or the device
   budgets say so (sections 3.4, 3.4b; R8).
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
7. **The owner judges the look.** Prepare visual comparisons, including
   retail's heights through the engine beside retail's art (R0, R1).
   LLM visual review comes first; the owner has final say. Pixel statistics
   support the review and do not decide artistic acceptance.

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
  32 px tiles and painted light. Standard TA export is the current target;
  Nanolathe extensions, including true color, are deferred (section 7,
  decision 4).

**How confident this plan is, goal by goal.** Asked directly by the owner
on 2026-11-09: would carrying out this plan give a usable, fast,
artist-friendly editor with hyper-real output that matches retail and
makes new worlds? Not with high confidence as one sentence. After the
review most cards are experiments with a stated test, so the confidence
is in finding out cheaply, not yet in the outcome. Rated only on what has
been shown:

| Goal | Confidence | Shown | Not shown | Cheapest test |
| --- | --- | --- | --- | --- |
| Usable, artist-friendly | Medium | The problems are measured (234 World rows over 12 screens; a shared map loses its world) and the fixes are ordinary work (R9a, R11) | No artist has used it; the tablet has never opened it; dials (R9b) are a proposal | The iPad's first run of today's editor; one R9a slice in the owner's hands |
| Fast | Medium on the desktop; first 16x16 runs measured, tablet unknown | Rain first weathered pixels fell from 6.24-6.36 s to 1.64-2.46 s; two 16x16 runs give pointer p95 76.3-78.5 ms and release-to-final 2.223-2.260 s **[measured, sections 2 and 3.5]** | The 50 ms drag and 1 s release budgets are unmet; Face steepness sometimes adds a pass; held-slider preview and color-only redraw remain unbuilt | Repeat at the target 1440p workload; R5 step 0; the iPad first run |
| Hyper-real | High for cliff faces and ground detail; low for the form of mountains and hills | Cliffs, by the owner's eye, and why they work (sideways displacement) | No approach tested gave mountains a viewer would take for real; the format's 242 colors and 32 px tiles stay | R3's time-boxed trial on the shape fixtures |
| Matches retail | Low to medium | Light is close already (equal on Green; 1.3-1.65x strong elsewhere, a tuning matter) | No demonstrated route to "could be a retail section": five rock rewrites did not move it, a relief term helped Red and failed Lava and Moon, three world folders are unopened, and the prototype sheets are development data from a Python model, not the engine | Two retail sections' heights through the engine now exist as pairs for the owner's eye (`~/terraform-assets/agent-s0-heights/demo/`, with Lava corrected to sea 23 in `~/terraform-assets/agent-codex-handoff/lava-l030-sea23/`); a whole world on R0's bench is next |
| New and alien worlds | Medium | Every world already runs from data on one engine, and controls are continuous | The Lava look the owner liked came from the Python look model, not the engine; no invented world has yet been built in the editor from controls alone | Port the "Cells" relief kind (R4) and build one invented world |

If the form trial and the retail test both fail, what the plan still
delivers is a responsive editor with an honest panel, maps that carry
their look, good cliffs and standard export, whose mountains look like
today's and whose retail worlds are in the family rather than
indistinguishable. That is worth building; it is not the whole brief.

**The cards at a glance** (section 4.3 has each in full; section 5 the
order):

| Card | Change | Size | Main effect |
| --- | --- | --- | --- |
| R0 | Four benches (retail look, shape, latency, task cost) and a new-worlds sheet | M | Visual evidence for LLM review and the owner's final judgment |
| R1 | Height-image op | S | Enables R0; import from other tools |
| R2 | Light and placement as fitted numbers, with the light fit as a tripwire | S-M | Red, Lava and Moon's over-strong shading and Green's light rock brought to retail's numbers |
| R3 | Skeleton structure in Mountain and Hill | L, research | Form: spurs branch, valleys join |
| R4 | Relief kinds, under three rules: for retail worlds on the bench, and for new worlds by eye | M per world | "Recognizably TA" below 64 px; new looks such as cell and crackle ground |
| R5 | Stage caches; every control owns a stage | L | Color, shine, light-strength and palette controls at about 10 ms a megapixel |
| R6 | Scheduler: batch tiles, no readback, cancel between stages | M | Lower latency on every path |
| R7 | Preview level for every control; generic pipeline; preview raster | S | No 0.9 s stalls; all rows preview live |
| R8 | The solid: thin shell, wear where it shows, march fix | M-L | 13-23% off a cliff window with nothing visible by eye; about a third with the wear change (inferred, to be measured together) |
| R8b | Erosion per landform | M until its result is shown equal to the whole-map pass | Up to 0.4-0.9 s off each edit |
| R9 | Controls: honest panel, then dials at three scopes, then blend and variations | M | From 234 rows to about 60 on the surface |
| R10 | First-class tile accounting and reusable level ground; stamps deferred | M | Measure tile pressure on the 16x16 target and reduce merging |
| R11 | The map carries its world; export ignores view options | S | Sharing works |
| R12 | Budgets for memory, latency and visible controls; shader size as a review signal | S | The panel stops growing; one look change at a time |
| R13 | Provenance audit of committed art data, before the repository is public | S | Nothing retail-derived is published by accident |

## 2. Goals, and the test each one gets

Each goal needs evidence that says whether a change served it. Visual
quality is judged first through LLM visual comparisons and finally by the
owner; pixel statistics are supporting diagnostics. Correctness and
performance retain their measured checks. Section 4, card R0, builds the
checks that do not exist yet.

| Goal (from the brief) | Test | Exists today? |
| --- | --- | --- |
| Artists control the terrain; easy to use | Six standard tasks (section 3.5), including finger input on iPad; visible-control count and task costs | No |
| Feedback is fast, refinement is progressive | Latency budgets per kind of interaction (below), measured by `repro/perf.mjs` | Partly: stroke drags only |
| Hyper-real look; erosion may be approximated | The owner's eye on unpaired boards against the seven reference pictures: `~/src/geoform/references/gaea-prowess1.webp`, `~/src/geoform/references/gaea-rocktools.webp`, `~/src/geoform/references/gaea-rocky.webp`, `~/src/geoform/references/gaea-sand5.webp`, `~/src/geoform/references/gaea-sandstone.webp`, `~/src/geoform/references/gaea-surface1.webp`, and `~/src/geoform/references/gaea-surface3.webp`; `measure/realism.py` remains a tripwire only **[owner decision, 2026-11-09 night]**. This goal is now the main line: one form at a time on the ledger of section 5, its shape judged first in clay under a low sun **[owner decision on the priority, 2026-11-09 late night; the ledger is the method proposed for it]** | Tripwire exists; reference boards exist (`$R/agent-judge/references/`); ledger v0 handed off |
| Recognizably Total Annihilation | Not tuned toward for now **[owner decision, 2026-11-09 late night]**: "we'll circle back later once we have more realism and proper controls for each feature that created it." Until then the game's frame is what holds: the fixed view, 1x, the palette and the height cells (rules 11 and 12). A final test is proposed, not yet the owner's: an artist makes a retail world from the controls alone, on a sheet the owner reviews | The retail scenes, the boards (`$R/agent-judge/`) and `repro/retail.sh` are kept for the return |
| Many biomes and planets, including ones that follow no real planet | Invented worlds built from controls alone, with no code change, on a sheet the owner reviews (R0) | No |
| Large flat areas, a 2.5D RTS | Passability and buildable-area views; plains unmoved by any refinement | Yes (`repro/passability.mjs`) |
| Export loads and plays | `repro/export-bytes.mjs`; first-class tile accounting, with 16x16 as the interactive target | Partly: no tile budget |

**Target devices and workload [owner decision].** The owner's MacBook Pro
and 11-inch iPad Air (M3, 2025), using fingers on the iPad. Apple Pencil
support is deferred. Optimize interactive editing for 16x16 maps; this is
not a new map-size or export limit. Windows testing can follow through user
feedback; the owner has no Windows test machine.

**Proposed latency budgets.** Every number recorded so far comes from one
Apple M3 Pro. These are candidate targets, not demonstrated support on the
iPad; the first 16x16 desktop measurements below do not meet every
budget. Record browser/OS, viewport, device pixel ratio,
and actual render resolution for each device. The 1440p rows below describe
the desktop benchmark; choose and measure the iPad's render resolution on
the device while preserving the same final export quality.

| Interaction | Budget (p95) | Today |
| --- | --- | --- |
| Stroke drag: pointer to picture | 50 ms at preview level | 16x16 p95 78.5 / 76.3 ms **[measured, two runs below]** |
| Color, finish or light slider drag | 50 ms, full quality at 1440p | 0.6 s to a first change, 0.9-1.1 s settled **[measured, section 3.5]**: every cached image re-bakes at final level |
| Any other World slider drag | 100 ms at preview level | Rain first weathered pixels 1.64-2.46 s, Face steepness 1.79-2.63 s after the one-Time-pass fix **[measured, section 3.5]**; World slider preview remains unfinished |
| Release to final visible art, 16x16 map | 1.0 s (proposed) | 2.223 / 2.260 s **[measured, two runs below]** |
| First picture after load | 1.0 s | 16x16: first paint 14.3 / 15.0 ms after applying the scene in an open editor, final visible art 2.884 / 2.780 s **[measured, below; first paint is not final art]** |
| Export | no budget; progress and cancel | 3.7 s for 4x4 **[measured, docs/VOXEL_REVIEW.md]**; 16x16: 43-217 s for the export phase under Node and Dawn, one run each (Moon 43-70 s, Lava 103-127 s, Green 202-217 s) **[measured, docs/REDESIGN_TILE_BASELINE.md]**. Sixteen times the 4x4 figure would be about 59 s, so Moon is in line and Green is three to four times over; the harness differs from the 4x4 run's |

**How a budget is measured.** One number per interaction lets a build pass
by updating one small tile while the rest of the view is stale. Each row
above is reported as three: input to the first changed pixels, input to a
current preview over the whole view, and release to final art. Each is
taken cold and warm, during a continuous drag and across rapid reversals,
as a p95 over enough interactions to mean something (not a median of
five), with the device, OS, browser, viewport, device pixel ratio and
render resolution written beside it. The two 16x16 runs below are a first
finding, not a new check or a full budget acceptance trial. The iPad is
still unmeasured; section 3's earlier figures use 1,024 px windows and
4x4 maps. Time, export and memory costs may still reorder section 5.

**First 16x16 latency and memory, 2026-11-09 [measured].** Local main
`61119aba`, `repro/perf.mjs map16`, `repro/scenes/green-2.json`, no export,
two sequential runs. Apple M3 Pro, 18 GiB unified memory, macOS 26.6.2,
headless Chrome 157.0.8103.39 with Metal. Chrome window 1600 x 1200;
viewport 1600 x 1113 at device pixel ratio 1 (captured separately with the
same launch settings); the measured terrain view is 1208 x 841 art pixels
at 1x. Budgets: GPU 512 MiB, heap 1536 MiB. No other terrain benchmark
was active; ordinary desktop applications remained open, so background
GPU use was not isolated. Evidence:
`~/terraform-assets/agent-codex-handoff/perf16/`.

| Metric | Run 1 | Run 2 |
| --- | ---: | ---: |
| Editor boot wait (ms) | 295 | 447 |
| First picture after scene application (ms) | 14.3 | 15.0 |
| Harness weather-ready marker (ms) | 13.4 | 14.1 |
| Last load Time pass completed after scene application (ms) | 2037.6 | 1912.4 |
| Final visible art after scene application (ms) | 2884.4 | 2779.9 |
| Stroke pointer latency p50 (ms) | 65.9 | 30.6 |
| Stroke pointer latency p95 (ms) | 78.5 | 76.3 |
| Release to final visible art (ms) | 2223.3 | 2260.1 |
| Load Time passes, summed wall time (4 passes; ms) | 1364.4 | 1378.4 |
| Release Time passes, summed wall time (4 passes; ms) | 1350.5 | 1367.6 |
| Peak reported GPU bytes | 342483744 | 342549280 |
| Peak reported JS heap bytes | 52582686 | 55614994 |

All 70 pointer moves were measured in each run; no visible tile lacked a
final bake after load or release, and both consoles were empty. The large
p50 spread is retained, not averaged away. On this paged map the early
weather marker says "ready on demand": it is not the completion of the
weather passes **[read, `repro/perf.mjs` and `sculpt.js`]**. The four load
passes took at most 368.5 / 368.6 ms each, and the four release passes at
most 353.4 / 357.9 ms each **[measured]**. These are view-driven page
passes, not one whole-map pass. GPU bytes are the editor's sampled
allocation accounting, and heap bytes are sampled `usedJSHeapSize`, not
process RSS or a hardware allocation peak **[read, `sculpt-canvas.js`]**.
The 50 ms p95 drag and 1 s release budgets are not met **[measured]**.

**The iPad before any iPad design.** Open today's editor on the tablet and
record whether it starts, the adapter's limits, the first-picture time and
what a finger can and cannot do. Two things to arrange first: WebGPU is
only offered to pages in a secure context, so a development server reached
over the local network by plain HTTP will not get it (the tablet needs an
HTTPS address); and Safari is believed to ship WebGPU from iPadOS 26, which
is not verified here.

## 3. Findings

### 3.1 The retail look, measured

A throwaway model (`~/terraform-assets/agent-rd-look/`, report and
`scripts/model.py`) turns a retail section's 16 px height image into 1x art:
upsample, place materials by height and slope, light with sun, sky and cast
shadow, project obliquely, add fine detail in screen space, snap to the
palette. It was tuned on half of each world's sections and judged on 36
others (six worlds, six each). Those 36 are development data, not a clean
held-out set: the method was changed after three of them were viewed, and
two are byte-identical to tuning sections (card R0 has the detail).
Sheets: `out/sheets/*_1x.png` (retail | model).

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
  it about twice as much whatever it faces, on six windows of seven (the
  first draft said seven; on Green 7 the sign reverses, +.004 against our
  -.091, and retail's own fit there is poor: R² .11, azimuth +95°).
  That is the dark, patchy rock of section 3.2 seen as a number, and it is
  the same complaint the project has recorded since 2026-10-28.
- **Three Green windows (4, 5, 6) do have a lower gain than retail**; they
  are the cliff and plateau windows whose traced shapes differ most.
- **Confounds:** our scenes are hand-traced, so shapes differ (Lava's p90
  slope is .79 against retail's .42); our rock is a different tone, and
  tone that follows slope feeds both numbers; retail's light is not one
  direction on Red and Lava-1.
- **What the fit cannot say.** Luminance against slope mixes light,
  material tone, material placement and occlusion. The fit shows where the
  pictures differ; it does not say which term to change (R2).
- **Registration: corners, and the fitting helpers are half a cell off.**
  The fitting helper places height sample `i` at the cell's center,
  `16i + 7.5` px (`agent-rd-look/scripts/lib.py:37`), and so does
  `repro/retail_crop.py:30-32`. The format and our exporter place it at
  the cell's corner, `16i` **[read, nanolathe
  research/formats/tnt.md:101; sculpt-map.js:45-49]**. The height-image
  card measured it along x, where the oblique view does not move the art:
  retail art sits over its bytes at a shift of about 0 px, not 7.5, on
  Moon (8 of 8 sections; mean R² .807 at the corner against .743 at the
  center) and on Red (6 of 6 fitted). Green's coast sections are mixed (4
  of 8) and Lava's isles gave no peak **[measured by that card, not
  re-run here: `~/terraform-assets/agent-s0-heights/registration/`; 4 px
  steps, about ±4 px by its own calibration; vertical not measured]**.
  What the half cell does to this section's fitted numbers is still not
  measured (a shift test on 144 sections had no power: on Green's 71 the
  median R² was .222 at both offsets). Follow-up, before a fit is quoted
  again: move both helpers to corners and refit.

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
  alone.** The thin shell is the only saving that cannot be seen (13-23%):
  identical by eye at 1x on four scenes, with 0.02-6.8% of cliff pixels
  moved by more than 8/255, and 0.11% once main's march aliasing is fixed
  **[measured, agent-rd-voxel/REPORT-2.md]**. It is not byte-identical
  (the first draft said "lossless"), so its fixtures move and the owner
  looks. Skipping
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

**The last two fit no measured stage**: the shape pass is about 25 ms and
the whole-map Time pass 0.4-0.9 s (section 3.4). **Diagnosed on
2026-11-09** on branch `s0/slider-response` **[measured by that card's
agent, with timelines; `~/terraform-assets/agent-s0-sliders/diagnosis.txt`;
not re-run here]**:
- *One whole-map Time pass per input event.* Every `input` event of a drag
  on such a row submits its own pass (`setKnob` -> `queueWeather`), a
  submitted pass cannot be stopped, and they run one after another at
  0.76-0.86 s each. Eight events gave eight passes and a first painted tile
  at 6.3 s; a longer drag painted nothing for more than 15 s. Each pass
  holds about 156 MiB until it ends.
- *The canvas hold works as written.* It releases when the weather lands;
  its 8 s cap only bounds how long the first defect hides the map.
- *No interaction level for a World slider.* On rows that run no pass
  (ambient light, rock relief depth) the first tile repaints in about
  30 ms, but every input clears the whole cache twice and restarts at the
  center tile at final quality, so the rest of the view waits for release:
  whole view 640 ms after the first input.

**Landed locally, 2026-11-09.** Only the one-Time-pass fix (`cc71df74`,
integration `61119aba`) landed. A pass in flight finishes; only the newest
waiting request may submit next **[read]**. Two alternating main/fix pairs,
each with cold and warm drags through eight values, on the M3 Pro and
Chrome 157 (1440 x 900, device pixel ratio 1, 1048 x 628 terrain view at
1x, Green's default 2336 px map with one Hill; no concurrent terrain
benchmark observed, ordinary desktop apps open), gave:

| Row | Before: first weathered pixels / passes | After: first weathered pixels / passes |
| --- | --- | --- |
| Rain | 6.244-6.362 s / 8 | 1.640-2.460 s / 2-3 |
| Face steepness | 1.758-1.876 s / 2 | 1.791-2.626 s / 2-3 |

**[Measured]** Rain's queue is shorter; Face steepness is slower in three
of four paired drags, by 0.702-0.834 s, when it runs a third pass. The fix
does not finish slider responsiveness. The 18 final-state cases (drags,
scripted values, keys, a click and paged maps) match the pre-fix reference
pixels, levels, export gate and undo counts. The land tier passed, with
0 of 34 scenes changed. General `perf.mjs map4` in two alternating pairs:
pointer p50 68.5 / 64.8 ms before, 61.1 / 61.7 ms after; release-to-final
1.666 / 1.745 s before, 1.658 / 1.639 s after **[measured]**. Evidence:
`~/terraform-assets/agent-codex-handoff/sliders/` and `perf-slider/`.

**Unfinished.** `10477351` (held-slider preview) did not land. It postpones
Rain's Time pass until release, so the held Rain preview contains old
weather **[read]**; its earlier agent also reported no tile baked during
short paged Rain/Face drags **[measured by that agent, not rerun here]**.
Next: make held previews show current input, including paged maps, and
avoid the extra Face steepness pass before proposing that commit again.

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

**Owner clarification (2026-11-09).** Retail matching remains a goal, and
invented worlds remain in scope. LLM visual comparisons precede the owner's
final judgment; pixel statistics carry less weight. Existing required
checks still run, but a numeric look score does not override the owner.

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
- **Tile uniqueness is a real limit on detail, and it binds later than the
  first draft said.** Nine complete 16x16 exports, none merged
  **[measured, docs/REDESIGN_TILE_BASELINE.md on
  `prototype/redesign-foundations`]**:

  | Distinct tiles of 66,820 slots | Green | Lava | Moon |
  | --- | --- | --- | --- |
  | No strokes | 39,252 | 1,021 | 37,214 |
  | Six landforms | 40,590 | 4,530 | 38,714 |
  | 25 strokes on a grid | 57,373 | 47,700 | 62,137 |

  That is 59-93% unique on Green and Moon and on every dense layout
  (71-93%), against retail's 5-10%; Lava's plain ground repeats, and its
  light layouts (1.5-6.8%) are inside retail's range; earlier counts were Green 4x4 at 3,668 of 4,420 and Red 16x16 at
  60,072 of 66,820 **[measured, docs/VOXEL_TOOLS_REVIEW.md]**. A map of
  n x n units has (16n+1) x (16n+4) slots: 58,804 at 15x15, which cannot
  reach the cap of 65,536, and 66,820 at 16x16, which reaches it only above
  98% unique. At the dense layouts' shares, Moon (93%) would merge at
  17x17 (75,348 slots) and Green (86%) at 18x18 **[calculated from
  sculpt-map.js and the table]**. The first draft's "merging
  starts near 15x15" was wrong. The nearest of the nine is dense Moon,
  3,399 tiles under the cap. In Nanolathe a 65,536-tile map costs
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
look model and the same 36 sections
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
  in isolation, so it chunks trivially. Its reference code is MPL-2.0.
  AGENTS.md allows no new dependencies and the project keeps its own code
  MIT, so the plan assumes our own implementation from the description;
  that is a project choice, not a legal bar.
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

**Change.** Build the checks from section 2 that do not exist. Visual
sheets support LLM review and the owner's final artistic judgment;
correctness and performance checks retain their explicit pass criteria.

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
     each world into a tuning set and a review set. **Split by group, not by
     name.** The prototype split by sorted name within a kind, its author
     changed the method after seeing three held-out renders
     (`agent-rd-look/REPORT.md`, disclosure), and two pairs of sections
     with identical art and heights sit on both sides of that split: lava
     `flats/low-lava` and `isle/l-isle-lava`; moon `flat/lunarflgr256x`
     and `flat/lunarflat256x` **[measured: decoded-pixel hashes]**. So the
     prototype's 36 sheets are development data, not a held-out result. For
     the bench: hash art and heights, group identical and overlapping
     sections (and sections cut from one map, where that can be told),
     split by group, and freeze a review set that nobody tunes on. Anything
     a builder has looked at while tuning moves to the tuning set.
   - For each review-set section: load its heights with the height-image op
     (R1), render with the world's look and no strokes, write
     `ours.png` beside a copy of `retail.png` under `$R/bench/<commit>/`.
   - Output: one contact sheet per world at 1x showing the retail reference
     and before/after renders with consistent framing. An LLM first reviews
     the visible differences and remaining gaps; the owner has final say.
     Randomized comparisons can assist review, but identification accuracy
     is not an acceptance gate and 50% is not a product target.
   - **How the LLM review is run.** Agent judging has failed here before:
     seven blind rounds ended near chance, an overnight score was gamed
     (section 3.6), and in this review a by-eye call that "our broad light
     is too weak" was overturned by the fit (section 3.1b). So: the
     reviewer is not the agent that made the change and is not told which
     render is the newer; every sheet has the same framing (retail
     reference, before, after, at 1x); the review lists located
     differences ("rock on the north face is lighter than the reference")
     and not a verdict or a score; and a claim about light or tone is
     checked with a controlled render or the fit before anyone acts on it.
   - The existing `repro/stats.py` statistics run on the same pairs as a
     tripwire: a card that moves a statistic out of the retail band must say
     why.
   - This separates the look from stroke tracing. Dataset independence,
     coordinate registration, and coverage still need validation; the bench
     does not make an artistic judgment infallible.
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
   scene. These are internal evaluation fixtures, not a starter-map or
   example-library deliverable. It is the test of "many biomes and planets":
   a relief kind or a control that makes one of these striking has earned
   its place even if
   it matches nothing retail. The owner's eye is the only score.

**Interactivity.** None directly; (3) makes regressions visible.
**Quality.** None directly; (1) and (2) make progress visible.
**Accepted when** each bench runs as a script on demand (none is added to
the check tiers: section 7, later answers), LLM visual
reviews are available, and the owner has reviewed the starting retail and
shape sheets. Numerical summaries are diagnostics, not artistic sign-off.
**Risks.** Heights at 16 px under-determine the art, so `ours` will never
match pixel for pixel; the bench asks "could this be a retail section?", not
"is it this section?". Keep each review sheet manageable (about 12
comparisons), without treating that count as statistical proof.

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

**Built (2026-11-09, `s0/height-image`, on local main).** It differs from
the design above in four ways:

- The fields are the node's own, not under `params`: in `sculpt.js`,
  `params` means a brush card, which the panel would write into.
- The surface is a Catmull-Rom cubic made straight within 5/32 of a cell
  of each sample (`HM_COLLAR`). The fields' lattice is about 2.0009 px, so
  no lattice cell sits on a 16 px corner and the export reads a corner as
  a mix of four cells; with the collar 0 of 17,680 export corners differ
  from the image's bytes, with the plain cubic 641 do **[measured by the
  card, Node on Dawn]**.
- The node also writes a two-cell margin past its outer samples, where the
  edge samples repeat (without it the last row and column cannot export
  exactly). `flatten` eases back into the ground across that margin and
  `replace` does not; over the samples they are the same.
- One added field, `bits` (8 or 16).

Acceptance is met with no Time pass: two retail sections give back 1,024
of 1,024 bytes each, and `repro/regional.mjs` finds no mismatch on
`repro/shape-scenes/heights-bumps.json`. With the Time pass on, 149 bytes
of the Green section move by up to 3 and 95 of the Lava section by up to
4 **[measured by the card]**: R0 must say whether its renders run with it.

**Landing verification [measured].** The 8x8 paged image gives 0 bad
corners out of 4,096 before and after undo through the export's own read
path; its debug samples also match in this run. Export self-check passes,
console empty. The land tier reports 0 of 34 scenes changed; native and
WebAssembly exports match for Green 4x4, Lava 8x8 and Red 16x16. Two
alternating main/branch `perf.mjs map4` pairs (M3 Pro, Chrome 157, ordinary
desktop apps open, no concurrent terrain benchmark observed): pointer p50
68.5 / 68.7 ms before and 66.3 / 66.1 ms after; release-to-final
1.641 / 1.675 s before and 1.678 / 1.685 s after. No meaningful slowdown
was observed in these pairs. Evidence: `~/terraform-assets/agent-codex-handoff/`.

The Lava `l030` pair was rerendered with sea 23, plain 47, and cropped at
(256, 280), as `demo/prepare.py --pairs` does **[measured]**. It is in
`~/terraform-assets/agent-codex-handoff/lava-l030-sea23/pair.png` (retail
left, generated right), awaiting the owner's judgment; no look score is
assigned here.

Not built, each a proposal:

- The import entry. The kind is reachable from scene files and the debug
  console only; nothing in the panel makes, moves or scales one.
- A plain set apart from the sea in `repro/render.mjs` (a world's plain is
  its sea plus a fixed step), which R0's bench needs.
- Storage for an image too large for a share link: an incompressible or
  16-bit image of the largest size passes the Worker's 1 MiB.

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
- **Procedure**: fit on the tuning set, judge on the review-set sheets of
  R0, one world at a time, Green first; LLMs compare the images before the
  owner gives the final visual judgment.
- **Before a fitted number becomes a shader change.** The fit mixes light,
  tone, placement and occlusion (section 3.1b), so first render three
  controlled pairs on retail's heights with the registration settled:
  light only (one neutral material), rock tone only, and material placement
  only. A term is changed when its own pair shows the difference. The six
  rows of the table above are diagnostics; none becomes a control unless
  it passes rule 9 as something an artist would set on purpose.
- **Not proposed after all:** cached sun-shadow and sky-occlusion planes.
  The first draft wanted them for longer, darker shadows; the measurement
  says ours are already longer-reaching and darker than needed, and the
  draw is 8-20% of a window, so there is little to save.

**Interactivity.** With R5, the Light dials are stage F and preview live.
**Quality.** A calibration, not a new model. It should bring Red, Lava and
Moon's shading down to retail's and Green's rock down to its tone; by
itself it will not make any world read as retail (section 3.1's verdict).
**Accepted when** LLM visual comparison is complete and the owner accepts
the world's look against retail. Report the three fit ratios and explain
disagreements; the earlier proposed 15% band is a diagnostic, not a veto on
the owner's artistic judgment.
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
R2 aim to improve the visible look.
**Accepted when** an LLM has compared the images, the owner accepts the
retail improvement or the intended invented-world look, and the flat-ground
and tile checks pass. Pixel statistics support that review.
**Risks.** Tuning can still overfit the review examples. Keep one world in
flight at a time and preserve broader visual comparisons.

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
| E. Geometry buffer | per output pixel: hit height, normal, sun shadow, sky occlusion, cavity, rain exposure | screen tiles | C, D; sun direction, whose shadow probes read the solid, so a sun edit also rebuilds D for the visible tiles |
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
  **This record is a proposal, not a contract.** Quantized normals and
  8-bit terms can cross a palette threshold, so byte-identical output is
  not established for it. And the color pass reads more than these fields
  today: surface and broad gradients, the authored volume, weather, masks
  and material fields (the review's reading of `engine-frag.wgsl`, near
  line 1493; not re-checked here). Step 0 below settles both.
- **Color (F).** The material and light parts of today's `fragmentMain`
  with the ray march and the four probes removed; it reads E. This is the
  pass a color slider reruns.
- **Stage map.** `sculpt-control-schema.js` gains a `stage` per control.
  It is not hand-kept: `repro/stage-map.mjs` moves each control and records
  the earliest stage whose cache changes, writes `stage-map.json`, and
  fails when a control's declared stage is later than the measured one.
  `canvas.clear()` takes a stage.
- **Order of work** (section 3.4's breakdown gives the values; section 5
  follows this order):
  0. *One experiment before the design is fixed.* List every input the
     color pass reads and how long each lives. Keep them at full precision
     for the visible tiles, rerun the color pass alone for one warm color
     edit, and compare the bytes with a full rebuild, on default scenes and
     with the optional features turned on. Report memory and the three
     latency numbers of section 2. Declare dependencies conservatively
     (when unsure, the earlier stage) and tighten them only against that
     full-rebuild comparison; moving controls on a set of scenes cannot
     prove a stage map complete, because a dependency can sleep until
     another feature wakes it. Only then choose the record and the atlas.
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
     geometry changes or the sun moves; it stays transient, and a sun edit
     pays for it.

**Interactivity.** With C and E kept, a control whose first stage is F
costs the color pass: 9-11 ms per megapixel instead of 345-1,181 ms a
window **[measured stage times; the rerun itself is not built]**. That
would be about 35-40 ms for a 1440p view **[inferred from an isolated
pass: it leaves out cache reads and writes, scheduling and presentation,
which step 0 measures]**. **Which rows are stage F is for the stage map to measure.**
Colors, shine, light strengths and the palette are; rock exposure is
probably not (it gates the solid), and vegetation cover only partly
(plants are baked as relief). Rock-structure controls (86 World rows)
still rebuild the solid for visible tiles; R8 trims that.
**Quality.** None by itself (steps 1 and 2 must be byte-identical). It makes
tuning a look by hand, the owner's chosen method, far faster.
**Accepted when** step 0's color-only rerun matches a full rebuild byte
for byte, or its differences are shown and accepted; all scenes are
byte-identical after steps 1 and 2; the
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
- **Bound stale work.** Batching raises throughput and can make the first
  changed tile later. Submit at most one frame's work ahead per stage, and
  drop queued work that a newer input has replaced.
- **Measure the main thread before moving to a worker.** The Go prototype
  cut nearby-tile p95 from 274-280 ms to 36-41 ms with a dedicated GPU
  worker (section 3.6), which suggests main-thread work dominates. The
  Long Tasks API reports only tasks over 50 ms, so the latency bench
  records frame intervals during a drag as well as long-task counts. If
  frames over 16 ms that trace to main-thread work remain after
  R5 and R6, move the engine into a worker with an `OffscreenCanvas` (the
  scene builder in `sculpt-scene.js` is already free of the DOM); if not,
  do not.

**Interactivity.** Lower latency on every path; fewer wasted renders while
dragging. **Quality.** None.
**Accepted when** pixels are unchanged, input to first changed pixels
does not get worse, and the latency bench improves on release-to-final and
on nearby-tile p95 by a stated number.
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

**Four review units, not one.** March correctness (the aliasing fix),
allocation that skips closed gates, the thin shell, and the wear change
are separate commits with separate sheets. The first two are expected to
be exact or within a few pixels; the shell and the wear change are
approximations that the owner accepts by eye. The wear proposal (wear on
the bricks that hold the surface, with a pass count that follows
Weathering) is a different experiment from the one measured (all wear
skipped), so its saving and its continuity are measured again. Savings
measured one at a time do not add; the combined build is timed before any
total is quoted.

**Design, in order of cost.**
1. **Free now** (each measured in section 3.4): skip brick allocation
   where every gate is closed (3-15 pixels change, identical by eye;
   about six lines in
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
3. **A thin shell (BAND), compacted.** Section 3.4b: identical by eye on
   four scenes and not byte-identical (0.02-6.8% of cliff pixels move by
   more than 8/255; 0.11% once the march is fixed), 13-23% of a cliff
   window, nothing at the preview level. Its 27 probes of the field are
   not a proven bound for every thin feature and setting, so it is judged
   on sheets across the rock controls' ranges, not only at defaults. Port the
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

**Interactivity.** Steps 1-3 together may take roughly a third off a cliff
window (1,131 ms to about 700 on green-4 **[inferred from stage times
measured one at a time; not measured together]**),
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

#### R8b. Erosion once per edit: make it visible or make it cheap (M until shown equal)

**Change.** The whole-map Time pass costs 416-875 ms after every settled
edit and its controls move 0.7-1.9% of their class on Green (section 3.3).
Until R4 replaces what it is for, run it only on the landforms an edit
touched, and drop the unread drainage pass. In the grid prototype each
landform with its skirt was an independent domain, because level plain is
fixed base level (section 3.8); whether the engine's own pass has that
property is the first thing to check. The pass already dispatches over
active tiles only, so part of this saving may exist; measure before
building. The 5 s and 8.4 s waits of section 3.5 were one pass per input event, not
this pass's own cost. With requests coalesced, the final requested pass
still costs about 0.8 s on a 2,336 px map, and a drag can run 2-3 passes
(section 3.5). What it costs on a 16x16 map,
with 12.5 times the cells, is now measured for the view in section 2:
four paged passes sum to 1.350 / 1.368 s after release, with final visible
art at 2.223 / 2.260 s **[measured]**. This is not a whole-map Time pass;
measure the edit's affected pages before estimating this card's saving.
**Accepted when** release-to-final falls by the measured Time cost on a
map where one landform of ten is edited, and the report states the largest
height difference from the whole-map pass (the goal is none beyond
rounding) on each of these: overlapping landforms, a later cut through an
earlier rise, a landform at a shore, and deposits that cross from one
landform's skirt into another's. One isolated landform passing is not
enough: strokes compose in order and material moves across boundaries. If
the results differ, recompute the connected region an edit can reach
instead of one landform, or leave the pass whole.

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

**Device requirement [owner decision].** The core editing workflow must
work with fingers on the 11-inch M3 iPad Air as well as on the MacBook Pro.
Review the panel, curves, canvas gestures, and passability overlay on the
actual tablet. Essential actions cannot depend solely on hover or keyboard
modifiers. Apple Pencil behavior is not part of this milestone.

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

*Step 9b: dials.* A proposal to pilot, not a contract. Before any of it is
built, write down: which wins when two dials drive one row; how a pin, a
world value, a landform offset and paint combine, and in what order; what
a painted or per-landform value does to a row that is global by nature
(one that sets topology for the whole map); what the panel shows when a
pin makes a dial do nothing; and how all of it is saved. Then pilot three
or four dials in one section.
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
- **Blend between two worlds or two presets.** Numbers interpolate; seeds,
  material choices, categories and rock columns of different structure do
  not. Blending is offered between presets of the same structure (a
  world's retail and modern presets), with the rule for each kind of field
  stated: numbers linearly, colors in OKLab, everything else taken from
  the nearer end.
  One slider, "toward ...", gives the 1997-to-modern dial for a world (its
  retail preset against its modern one) and a quick way to find a look
  between two others.
- **A variations strip**: the selected landform at six seeds, or six values
  of one dial, rendered at the preview level into the dock; click to keep.
  Six seeds are six geometry rebuilds, which R5 does not make cheap; six
  values of a color or finish dial are. Measure the strip before offering
  the seed form.

**Interactivity.** Fewer rows to find; with R5 and R7 every dial previews
live. **Quality.** Indirect: an artist can reach a look the engine already
supports.
**Accepted when** the task-cost bench shows (b) and (d) with no scrolling
past more than 20 rows; the owner can complete the core tasks on the MacBook
Pro and with fingers on the iPad; the World tab's surface is under 60
controls; and the 5% sweep passes for every dial at both ends, on each
world's own scenes. First-time-user observations follow the initial UI
revamp and retail-biome improvements; they do not block those improvements.
**Risks.** A dial hides which row did the work; the pin and "drives 6
settings" text are the remedy. Dial curves need an owner per world: ship one
generic set and let worlds override. The owner plans to show individuals
the editor after the initial UI revamp and retail-biome improvements
(section 7, decision 9); use their feedback to refine later UI work.

#### R10. A tile budget, and detail that repeats by design (M)

**Change.** Treat distinct tiles as a budget the artist can see, and make
level ground reuse tiles the way retail's does.

**Why.** Green and Moon maps, and dense maps on any world, use 59-93%
unique tiles against retail's 5-10% (Lava's plain ground already repeats).
At the 16x16 target nothing merges today, but a dense Moon map sits 3,399
tiles under the cap, a Green or Moon map with no strokes spends
37,000-39,000 tiles on ground alone, a dense Moon map would merge at
17x17, and at the cap Nanolathe holds over a gigabyte of atlas
(section 3.7).

**Design.**
- **Show the number (first, and by itself).** The status bar and the Export
  pane show the map's distinct tiles against two lines: retail's practice
  (about 11,500) and the cap (65,536). Scaling up a count from the tiles on
  screen can be badly wrong, because the artist looks at the part being
  edited; the number shown is a whole-map count, exact after an export or
  a background pass and labeled as an estimate until then.
  `measure/tile-baseline.mjs` is the reference.
- **Level ground from a pool.** Extend today's 1,024 px ground repeat: on
  cells the lattice marks level, every per-pixel term (grain, dither phase,
  speckle, flowers, small stones) is periodic in 32 px and chosen from a
  per-world pool of K variants by a hash of the tile, with K a world number
  (retail-like at 16, richer at 256). Terms that vary slowly (undulation
  shading, wetness) are quantized to a few levels on level ground so equal
  inputs give equal tiles. Slopes keep unique detail.
  Not shown yet: that variants chosen per tile meet at their edges, and
  that light, weather and shadow from nearby landforms do not make tiles
  of one variant differ. Test both before the pool is promised to cut the
  count.
- **Deferred:** reusable stamp libraries, starter maps, and example
  collections. Artists start from a blank map for now (section 7,
  decision 7); tile accounting and reuse must not depend on these features.
- **Deferred with Nanolathe:** 2x art sheets and true-color extensions.
  Standard TA export is the current output contract (decision 4).

**Interactivity.** Tile-pressure feedback belongs in the current editing
and export workflow. **Quality.** The aim is to reduce lossy merging on
16x16 maps while retaining the intended look; measure that result rather
than assuming any reuse scheme guarantees it.
**Accepted when** the count is shown and matches an export exactly. For
the pool, a target the owner has not yet agreed: a 16x16 Green map with a
fifth of its area as landforms under 30,000 distinct tiles (a Green map
with no strokes is 39,252 today, so this means changing level ground
itself), with no visible repeat at 1x or at Fit **[by eye]**. With stamps
deferred (decision 7), the pool is the only reuse mechanism in scope now;
copy and paste of paths aligned to the tile grid is the later second one.
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
- `exportChunks` passes fixed draw options, and the palette switch is
  forced as well: it is read from `renderer.variant`, not from the draw
  options (`sculpt-renderer.js:821`).
- The working copy already has a `world` key holding the world's id as a
  string (`sculpt.js:1122`); the new block needs its own name or a
  deliberate change of that key.
- Differences are stored against defaults that are identified (a hash of
  the world's file), or the block holds the resolved values; a save must
  not change meaning when a world's file changes under it without saying
  so.
- Three changes, three commits: what a map owns (save, load, share, undo);
  export's independence from the view; one home for the defaults.
- This card edits `sketch()` and `setKnob` in `sculpt.js`, which
  `s0/slider-response` and `s0/height-image` also touch: it starts after
  those are reviewed.

**Accepted when** a share link opened in a clean browser profile renders
the same bytes as the author's page, on a map with ten non-default World
rows and two changed colors, using the same engine build on the same
machine; the same holds in a profile that already has a different saved
world of the same name; undo and redo restore World rows; and the exported
bytes are equal with Clay on or off, the palette view on or off, and a
light view selected. This checks complete source state, not cross-GPU or future-build
export identity. The `.ufo` exported on one machine is authoritative for
play; the recipe remains editable source (section 7, decisions 3 and 8).


#### R12. Budgets and the order of rewrites (S; a rule, not code)

**Change.** Budgets for what the product must hold to, review signals for
code size, and one rule about sequence.

**Why.** Dead controls regrow after each audit; the shaders, uniforms and
knobs "did not get simpler" when the engine replaced engine 0 one for one
(BACKLOG.md:6015-6030); and three rock or render rewrites landed in one week
without a test that could tell them apart (section 3.6).

**Design.**
- **Hard budgets**: memory, the latency rows of section 2, device limits
  (both target devices), and controls on the surface (per panel and
  total). A card may exceed one only with the owner's word.
- **Review signals, not gates**: shader lines (8,579 today) and uniforms
  (323). Each card reports how it moved them. A line ceiling would reward
  dense code over clear code, so a rise is a question for the reviewer,
  not a failure (the owner did not approve numerical code-size ceilings:
  decision 13).
- **One look change at a time per stage**, each judged on R0's sheets
  before the next starts.
- **A proposal for a new render primitive or a new simulation** must first
  show, on R0's benches and outside the editor, a result the current one
  cannot reach. The five-renderer comparison of 2026-11-08 measured speed
  and statistics that could not tell the builds apart; it never showed the
  two candidates with the same light and materials.

#### R13. Provenance audit before the repository is public (S)

**Change.** Check every committed table and image that came from looking at
retail art, and record for each how it was made.

**Why.** Decision 12: palettes may be public; everything else must be newly
generated. Two things committed today were flagged in the first draft and
have not been checked: the 16 ground tiles stored as palette indices (do
they come from a model, or is any a close copy of a retail tile?), and the
color ramps described as "measured from retail by luma octile". A palette
index image is still an image.

**Design.** For each item: its generator and inputs, whether it can be
regenerated from code alone, and a nearest-match search against the retail
sections for anything stored as pixels. An item that is a close copy is
replaced by a generated one. Statistics measured from retail (means,
ranges, curves) stay, as rule 10 allows.

**Accepted when** the list is complete, each item names its generator, and
the owner has seen any near match. This blocks making the repository
public; it does not block any other card.

## 5. Order of work

**Realism first [owner decision, 2026-11-09 late night].** "Let's focus
significant work on realistic high quality terrain generation and not focus
on matching retail, then we'll circle back later once we have more realism
and proper controls for each feature that created it." This replaces the
order recorded earlier the same night (retail first, then the hyper-real
look). Track B below is the main line. Track A (speed) and Track C (the
artist, including the iPad) still wait. Work that tunes a world toward
retail is parked: nothing retail is deleted, and no change is turned down
because it moves a retail score.

**Why [evidence, section 7 "Latest answers"].** The retail work had no
signal to steer by: the owner could not order six past builds against
retail, no computed judge passed its tests, and the old look distance fell
over a night of rounds in which the owner saw no improvement. The work the
owner did see move the picture was the voxel solid and the rock built in
it.

**The main line: a ledger of forms [method proposed by Claude; the owner's
decision is the direction, not this method, which is unproven until its
first rounds].**
- *The frame does not move*: the fixed view, 1x, the palette, one height
  byte per 16 px cell, level ground to build on and ramps to climb, the
  exported `.ufo`, fast editing with a slower bake the artist starts
  **[owner decision, 2026-11-09 night: "a bake pass that takes minutes or
  longer" is acceptable "as long as general editing is fast and the artist
  can choose when to spend that bake time"]**. Every sheet goes through the
  palette stage, so the format is tested on every round.
- *The ledger* has one row for each form real terrain has and ours may
  lack, in the words of the owner's "Look" requirements
  (`~/src/geoform/REQUIREMENTS.md`): a ledge that ends and splits, a loose
  slope at a cliff's foot, separate stones, a gully, and the soft ground
  between them. A row holds a reference, our render of it in clay at 1x
  under a low sun, a status (absent, present but wrong, present), the one
  mechanism that would make it, the controls that mechanism gives the
  artist, and the owner's yes or no. Ledger v0 is below.
- *A round* is one row, one mechanism and one sheet. Shape is judged
  before material and material before color. The judge is the owner's eye;
  a second agent that did not make the change lists located differences.
  No score stands in for either.
- *Stop rule, for each row*: five rounds the owner has reviewed, or two in
  a row the owner finds no closer. The row is then marked as stopped, with
  what the engine could not express and the sheet that shows it, and the
  work moves to another row. A stopped row is not deleted and may be
  reopened by a later mechanism.
- *Research* runs beside it: for each row, how other terrain tools and
  published methods make that form, with sources. Ideas only; no code,
  graph, texture or asset is copied.
- *Controls* come from the rows: each mechanism brings its own, a rock
  type or a world is a set of numbers for them (rule 9), and an invented
  world is those numbers taken outside what Earth allows.
- *Not yet settled*: more references in our own view, since the first
  seven pictures look across at cliffs and ours looks down (an eighth,
  seen from above, is recorded below); and references for soft ground,
  which none of them shows and which is most of a map. The scale and the
  drawn cliff line are answered below.

**Ledger v0 [Codex, 2026-11-09 and 10; `$R/agent-realism/ledger/`].**
Rendered at `e4b66fc0` with normal budgets, on round 1's tile and
`repro/fixtures/fracture-coast.json`, in clay under an 18 degree sun. The
status is a second agent's reading **[by eye]** of those two scenes, not
the owner's judgment, and "present" means visible there, not accepted.
The owner's column is blank for every row.

| Row | Form | Status in the two scenes |
| --- | --- | --- |
| 1 | Beds that stand out as ledges which end, split and step out, and do not ring the landform's outline | present but wrong: short lips with shadows, but the band follows the mound's edge |
| 2 | An overhang, and the shadow under it | present but wrong: a small lip only |
| 3 | Cracks at more than one size that cut a face into blocks | present (the fracture hierarchy of `7d096380`) |
| 4 | Blocks that have come away and lie below the face they left | absent |
| 5 | A loose slope at the foot of a cliff: one angle, coarser lower down | present but wrong: an apron of even ribs |
| 6 | Sand or fines that fill the lows and bury the foot of the rock | present but wrong |
| 7 | Separate stones a few pixels across, of mixed sizes, each with its own shadow | present |
| 8 | Gullies cut down a slope that join downhill | absent |
| 9 | Ripples or drifts in loose sand that turn with the ground and do not keep one spacing | present but wrong: one spacing |
| 10 | Quiet smooth surfaces between the busy ones | present in clay; in color the grain covers it |
| 11 | Level ground with relief of its own with grain at zero | present but wrong: repeated lobes; round 1's flat ground was that scene's setting |
| 12 | Soil or plant cover that breaks at rock and thins on slopes | present but wrong; one fixture |
| 13 | A shore: wet edge, beach, shallow shelf | present but wrong; one fixture with no beach painted |
| 14 | Forms of 16 to 128 px that the rock decides: buttresses, alcoves and benches in the cliff line itself | candidate row added by Claude; unjudged |
| 15 | Rock away from the steep band: outcrops and pavement on gentle ground, rock through thin cover | candidate row added by Claude; unjudged |

**Where the rock sits today [read, `engine-volume.wgsl`, `voxelDensity`;
measured by Codex in step 0].** The solid is the authored surface sampled
at a point moved along its normal, and the structure inside that offset is
multiplied by a gate that opens with the authored slope or with painted
rock (`rockFaceGate`). So the rock is a skin on the stroke's surface, and
the stroke decides where the cliff is. Along the rim of step 0's base
scene the solid sits a median 3.6 px from the authored surface, 11.1 px at
the 95th percentile and 16.3 px at the most, and mostly inward: the
farthest it steps out is 6.6 px. With bed thickness and block size at four
times the preset and `rockFace` doubled, which is past the sliders, those
figures are 6.9, 14.5 and 21.1 px, and 10.5 px outward. The exported
heights are sampled from the weathered lattice and not from the solid
(appendix B), so a ledge that moves a cliff line by more than about one
16 px cell must be in the heights (rule 11).

**Step 0: what today's settings reach [Codex, 2026-11-10,
`$R/agent-realism/step0/`; Claude's review and probe,
`$R/claude-handoff-2026-11-09/gullies-probe/`].** No engine code. Round
1's tile with natural ground on and `ripple` at .5, and a second fixture
with a shore and plant cover, in clay and through the palette at 1x.

- *The skin at larger sizes* **[by eye, second agent]**: fewer and larger
  slab faces, and the band still follows the stroke's outline.
- *Time* **[measured, Codex]**: age 800, four times the default, with rain
  at the top of its range moves no height byte by more than 7 units and
  draws no joining gullies. Time already wears soft beds faster than hard
  ones (`columnContrast`, `engine-common.wgsl:354`,
  `engine-erosion.wgsl:57`) **[read]**. So far, then: round 1 raised the
  rock lattice, runoff rounds, voxel spacing, wear rounds, shadow steps
  and sampling, step 0 raised Time's age and rain, and neither added a
  form. Still untested: Shape's 2 px lattice, Time's own lattice and the
  16 px spacing of its drainage.
- *The heights* **[measured by Claude from the saved height bytes; the
  plateau is the 587 cells within 2 units of its top, 501 of them flat]**:

  | Landform settings | Height bytes moved (most) | Plateau cells moved by more than 2 units | Flat plateau cells |
  | --- | --- | --- | --- |
  | 4 steps, step variation 70, breakup 80 | 384 (20) | 0 | 500 |
  | the same steps, wander 35 px, width variation 25%, age 800 ("restrained") | 1,173 (58) | 57 | 477 |
  | wander 80 px, width variation 60% | 1,489 (86) | 134 | 364 |
  | Gullies 60, Gully size 50 | 572 (28) | 0 | 501 |
  | Gullies 100, Gully size 80 | 680 (71) | 0 | 501 |
  | Gullies 60, Gully size 50, plateau and ramp raised from 170 to 230 (against the same scene without Gullies) | 629 (33) | 0 of 562 | 481 of 481 |
  | Talus reach 80 alone | 0 | 0 | 501 |
  | Gullies 60, Gully size 50, Talus reach 80 | 999 (85) | 320 | 107 |

  Codex's report says the restrained settings keep the plateau; it tested
  a 160 px window in the middle. Its sheets did not try Gullies, Gully size
  or Talus reach (`sculpt-scene.js:157-159`); the last four rows are
  Claude's probe.
- **[by eye, Claude; the owner has not judged these]** Steps and the
  restrained settings leave the front wall the same picture as the base: a
  band of chips along the rim, and no bench one can point to. Wander at
  80 px breaks the outline into round lobes and islands, each ringed by its
  own ledges. Gullies cuts the front wall across into spurs and V-gullies
  and leaves the top alone, and with the top at 230 the spurs run longer.
  Next to the reference they are too regular: evenly spaced, parallel and
  of one length, with nothing at their mouths, and they show on the front
  wall only. The ramp was not measured in this probe. Talus reach moves no
  height without Gullies, and with them it carves up the plateau top: a
  defect, or a control that only suits a ridge.
- *Steps and beds do not meet* **[read, `engine-shape.wgsl:157-183`]**: in
  Profile mode, the one step 0 used, a landform's steps are terraces at
  even fractions of its height, moved and broken by noise, and they do not
  read the rock column. The skin's beds do (`voxelBed`,
  `engine-common.wgsl:918`). So a ledge in the art is not a step in the
  heights. The two Shoreline modes (`stepReference`, with a layer width in
  pixels and a riser height) were not read or rendered.
- *Rock paint* **[by eye, Claude]**: on gentle ground it digs a pit down
  to the water and raises no outcrop; on the plateau top it changes the
  color only.
- *Defects in the base scene's clay* **[by eye, Claude; image pixels of
  `tile-base`]**: rows of 2 px dashes on some faces (x840-920, y370-450),
  a star of straight creases where the ramp meets the ground (x700-740,
  y560-600) and straight-edged scarps at the foot (x220-440, y650). In
  other panels, pinholes through the solid to the water (`tile-steps`
  x190, y575; `tile-all4` x625, y890).

**An eighth reference, seen from above [owner, 2026-11-10].**
`$R/references/topdown-escarpment.jpg`: "another hyper-realistic render,
from a mostly top down view." It is the first reference in our own view.
By Claude's eye its cliff is cut across, by spurs and by gullies that
branch and join, with debris fans at their mouths, boulders below and
smooth fines in the lows; bedding shows only faintly. For this picture
that puts rows 8 and 14, then 4 and 5, ahead of row 1.

**Night of 2026-11-10 [Claude, reviewed by Claude alone; the owner has
judged none of it].** The
owner, going to bed: "keep autonomously improving the quality of the
terrain". `CODEX_HANDOFF_ROUND2.md` was taken over and not run by Codex.
Private files are in `$R/agent-night/`; the before and after sheet is
`$R/claude-handoff-2026-11-09/night-before-after.png`.

Landed on local main, each after the land tier:

- `8e97e409` *Talus reach no longer buries a plateau's top* **[measured]**.
  The cone's line rises inward and met a level top a second time; the cone
  now ends before that. Talus reach 20, 80 and 200 change none of the 587
  level cells, and the mountain preset keeps every height byte.
- `a7d4e800` *Gullies vary along a wall and head back into its rim*
  **[measured]**. Depth runs from 0.2 to 1.85 of the setting along a wall,
  and the widest gullies cut notches into the level ground above a brow.
  At Gullies 60 the notches move 33 of 582 level cells by more than 2
  units and flat cells go from 486 to 448; the ramp's 66 corridor cells
  keep every height byte. Three of 34 scenes move (modern Green); the
  realism report and the drag numbers are in the commit. Those drag
  numbers compare this commit only: the Talus reach fix's extra march was
  not timed on its own.
- `81c30738` the hover previews, regenerated.

Tried and not landed:

- *Gullies and scree as the plateau preset's default.* 27 of 34 check
  scenes move **[measured]**, because a scene's landform stroke starts as
  the plateau and takes its preset for every key the card leaves out
  **[read, `toolDefaults`, `sculpt-scene.js:248`]**. It is a default look for every
  world: it waits for the owner, and those scenes would be pinned first.
- *Scree as fans below the gully mouths.* One try: on a ridge it drew a
  fringe of spikes **[by eye]**. It needs broad cones, and a mask for
  loose ground so that the rock skin leaves scree smooth.

Found and not fixed:

- *Time cuts little however long it runs* **[measured]**. With rain at 2
  and its depth budget raised to 24 (`erosionEnvelope`; the value reaches
  the pass), age 800 moves the same 567 height bytes (most 7) as with the
  default budget, and age 3,200 moves 823 (most 14) in 11 s and draws no
  gullies. So the budget is not what holds it. The cause was not found.
- *The rows of 2 px dashes are loose stones on their lattice* **[measured
  by switching rock terms off one at a time]**. They go with
  `debrisAmount=0` and with no other term, and with the deposit's depth at
  0 the same patch is a regular grid of small round stones. Debris raises
  the stone share to as much as .98 (`lsMaskCompute`, `engine-bake.wgsl`)
  **[read]**.
- *Research* (`$R/claude-handoff-2026-11-09/research-terrain-tools.md`, a
  sub-agent's reading; it lists what it could not open). TerraForge3D
  (MIT) has droplet erosion and nothing for these gaps. The idea worth a
  round: stream-power incision with one randomly chosen lower neighbor
  per cell, and debris flow that drops its load as fans (Jain, Benes and
  Cordonnier 2024). Ideas only.

**Next [proposed by Claude].** The owner looks at the sheet and says
whether the notched rim and the varied gullies are the right direction.
Then, one at a time: loose ground as a mask, with scree in broad fans; the
plateau preset's default; and a way for Time to cut by discharge. Two
candidates for row 1 still wait: Codex's (a new support field for beds,
shared by the heights and the solid) and a cheaper one of Claude's (the
landform's steps read the same column as the skin, so that a ledge is a
step).

**Scale: none fixed; a working one may be used [owner decision,
2026-11-10].** Codex proposes 4 art pixels to a meter
from the sizes of the game's models (an ARM Commander 41.5 units tall, a
Kbot Lab on 6 by 6 cells) **[measured by Codex from the stock unit files;
the choice of 4 is its inference]**. A height unit is half a pixel, so at
that scale the whole 255-unit range is 32 m and the relief of the two
retail sections measured in this review (45 and 76 units) is under 6 m and
under 10 m **[arithmetic]**, while the owner's reference pictures read as
larger country. Asked, the owner accepted choosing and reducing a
reference by the size of its features in pixels, and added: "if a scale
can help feel free to use it and we can tweak if needed." So a card may
state a working scale where it helps; none is a rule.

**Geology moves the drawn line [owner decision, 2026-11-10].** Asked
whether the geology may move the cliff line an artist drew: "Yes, and it
should because we are drawing parametric curves and real terrain has
natural variation." The question was put with a recommendation that the
yes answers: within a band the artist sets, with level building ground
and ramps held fixed. How wide that band is by default, and how the fast
editor shows the moved line before a bake, are for the row 1 proposal to
say. Because the line moves, row 1 cannot live in the skin alone: what
moves a cliff must reach the heights (rule 11).

Three tracks, coordinated where they share files and interfaces. Keep
small commits grouped into bounded review milestones. LLM visual
comparisons precede the owner's final judgment on look changes; performance
and correctness retain measured checks. The technical sequencing below is
still a proposal pending the adversarial review's corrections.

**Current scope [owner decision, as changed by the later answers of section
7].** Realistic terrain and rock, with a control for each feature that
makes it. The UI, responsiveness, the iPad and retail-biome artwork wait;
16x16 on the MacBook Pro remains the size to edit at. Tile accounting is a first-class constraint: establish its
16x16 baseline with the other benches and surface it early, rather than
waiting for blend, variations, or stamps. Symmetry, fairness tools, starter
content, Metal, Urban, and extended output formats are deferred.

**Landed on local main, 2026-11-09 evening (not pushed).** The dead-code
table of section 6 (`s0/dead-paths`), R1 (`s0/height-image`, `1a68158d`),
and the one-Time-pass part of `s0/slider-response` (`cc71df74`, integrated
as `61119aba`). The held-slider preview remains unfinished (section 3.5).

**In flight.** On `prototype/redesign-foundations`, the shape fixtures and sheets
(`repro/shape-bench.mjs`), the 16x16 tile baseline
(`measure/tile-baseline.mjs`) and a design study for R9a. The four shape
fixtures there use their own paths, so the prototype sheets of section 3.8
are not directly comparable with them: R3's trial reruns on the committed
fixtures.

**Step 0: the ground to stand on.** (No duration is claimed: the first
draft's "about a week" did not survive the review; R11, R0 and R7 each
hold several separate changes.)

| Card | Size | Why first |
| --- | --- | --- |
| Section 6's dead-code table only | S | Everything after is easier with 21 dead branches gone; byte-identical |
| Slider response (section 3.5): one-Time-pass fix landed; current held previews and the extra Face steepness pass remain | S | Rain improved; other slider waits remain measured |
| R11 the map carries its world; export ignores view options | S | A correctness bug in sharing, and R0's scenes need it; after the two branches that share its files |
| The iPad's first run of today's editor (section 2) | S, the owner's hands | Every tablet decision depends on what it finds |
| R1 height-image op | S | R0 needs it |
| R0 the shape bench and the new-worlds sheet; its retail look bench (item 1) is parked | M | A look change is judged on the ledger's sheets (the main line, above) |
| R7 preview level for every control; generic pipeline | S | Makes every later tuning session faster |
| R8 step 1 (closed-gate bricks, march fix); step 2 (wear where it shows) once the owner has seen its sheet | S | Step 2 is 15-18% of every window for a few lines, but it moves every rock fixture |

Gate: ledger v0 is in front of the owner; the latency table and 16x16 tile
baseline print.
Keep desktop measurements distinct from the iPad results.

**Track A: speed.** The first 16x16 latency measurements are in section 2;
confirm them on the target display workload -> R5 step 0 (the one-edit
cache experiment) -> R5 step 1 (the surface kept, as an atlas) -> R5 steps 2 and 3 (split geometry
from color; the stage map) -> R8's units one at a time -> R6 (scheduler)
-> R8b (erosion per landform, once shown equal) -> R8 step 4 (the owner's
call on a brickless solid).
Gate: assess section 2's candidate latency budgets on the 16x16 workload,
with desktop results at 1440p and separately documented iPad conditions.
Actual iPad testing is required before claiming support.

**Track B: the picture (the main line).** One form at a time on the
ledger above, each judged in clay first and by the owner's eye. Shape
still comes before color (rule 10). R3 (structure in ridge-like landforms)
is not a retail card: it becomes a candidate for the ledger's rows about
large forms, and before it promises handles it still states what happens
when a path point is added, removed or reversed, when a seed changes after
a spur was moved by hand, and when strokes overlap. R2 (light and placement
fitted to retail) and R4 (relief kinds on the retail bench) are parked
until the return to retail.
Gate per row: the owner's yes on its sheet. Pixel statistics do not
override that judgment.
R2's shader changes and R5's split both rewrite `fragmentMain`: land R5's
split first if both are ready. The tracks are not independent: they share
the shaders, the control schema, the save state and the fixtures, so one
integrator orders their landings.

**Track C: the artist.** Begin the UI revamp with R9a and validate finger
editing on iPad. Coordinate the initial UI and retail-biome improvements
before the owner shows individuals the editor (section 7, decision 9).
R9b and R9c remain proposals to refine through that work and subsequent
feedback. R10 tile accounting begins early alongside these tracks; stamps
and starter content are not prerequisites or current deliverables.
Gate: the task-cost bench and owner review on both target devices; record
first-time-user observations once the owner begins showing the editor.

R12's budgets apply throughout.

## 6. What to delete

The first draft called all of these one deletion card. They are not: only
the first table is dead code **[read, audit section 10]**.

**Dead code: one card (S), landed on local main 2026-11-09** (branch
`s0/dead-paths`: 101 lines added, 375 removed). 0 of 34 scenes changed;
three exported maps have the same `.ufo` and PNG hashes as the build
before; four alternating runs of `repro/perf.mjs` show no difference
beyond the run-to-run spread on a shared GPU (stroke-drag pointer latency
p50 67 and 73 ms before, 71 and 73 ms after) **[measured]**.

| Delete | Why |
| --- | --- |
| The non-chunked renderer path: `TerrainRenderer.create`, every `#else` of the 21 `CHUNK` tests, `sample`/`pick` on the renderer | No caller |
| The 'preview' draw quality | No editor or check requests it; R7 replaces the idea with a real level |
| The duplicated `MASK_KEYS` constant | One definition, imported |
| Stale names: `terrain-sculpt-v3.json`, `sculpt-common.wgsl` in messages, the JS-engine header of `engine-shape.wgsl` | Mislead the next reader |

Three removals went a step past "no caller": each was reachable from the
debug console only (the 'preview' quality; `sculptDebug.bakeMs()` before
the first chunk, which now throws; the 1x1 placeholder textures). Left
undecided by that card: the pass timers (a side branch,
`s0/dead-paths-no-timers`, removes them and would take
`repro/perf.mjs:122-123` with it), merging `TerrainRenderer` into
`ChunkTerrainRenderer` now that only one is constructed, and two `quality`
arguments the renderer no longer reads (`sculpt-canvas.js:151,162`).

**Not dead: each its own change, with its callers, its replacement and its
check.**

| Change | What it needs first |
| --- | --- |
| The CPU twin of the Time blend (`sculpt-scene.js:379-390`) | It is live: the export's corner heights and the page's height sample read it (`weatheredHeights`, `sculpt-map.js`). Replacing it needs a GPU readback that returns the same height bytes on every scene, then the removal |
| The drainage plane and its nine entry points | The audit found no reader; confirm, then remove with the buffer layouts it changes. If R3 or R4 needs flow, it is rebuilt for that reader |
| Mask planes 8, 9 and 20-24 | Believed unused, yet copied to the CPU and into a 7-layer texture per chunk: a layout change, checked on every scene |
| One of the two shader preprocessors | Two rule sets for the same job; a refactor with the shader checks |
| Amount, Roughness and Softness on landform cards; the shift-drag Amount gesture | Not read by the landform pass; a control removal, with the control sweeps |
| `isRiver` / `isBraided` tests on the form's name | Behavior keyed on a name becomes numbers (river span, belt) on any landform: a behavior change, judged on its scenes |

After R9: every control the 5% sweep finds dead once the surface controls
drive it (expected: a large share of the 237 World rows become reachable
only through "Advanced", and those that no preset or artist moves in a
release cycle are removed).

## 7. Owner decisions and remaining validation

### Owner decisions (2026-11-09)

All thirteen answers below are **[owner decision]**, recorded after the
adversarial review. They settle product scope; they do not constitute
approval of every proposed mechanism or estimate in sections 3-6.

1. **Visual authority.** The owner judges the look and has final say. LLM
   visual comparisons precede that review; pixel statistics matter less.
   Retail resemblance and the quality of invented worlds are visual
   judgments, not decisions made by an aggregate score.
2. **Devices and interaction.** Target the owner's MacBook Pro and an
   11-inch iPad Air with M3 (2025). Finger input is the iPad requirement;
   Apple Pencil support can wait. The owner has no Windows machine, so
   Windows validation will depend on later user feedback. Existing timings
   were recorded on an M3 Pro; actual tablet measurements are still needed.
3. **Authoritative map.** The `.ufo` exported on one machine is the file
   distributed for play. Its height map is fixed; players use that same
   exported map rather than independently regenerating it. Save files and
   share links are editable source containing world information, artist
   paths, settings, and related data. They do not guarantee identical
   exports across machines or future implementations.
4. **Output scope.** Standard TA export for now. Possible Nanolathe
   improvements, including true color, are deferred.
5. **Gameplay readability.** What blocks units should look blocked whenever
   possible. Artists use the passability overlay to confirm and adjust
   terrain while building maps. No mismatch lint: "we don't need a
   mismatch lint. We already have too many tests" (owner, later the same
   day).
6. **Fairness.** Symmetry and fairness tools are out of scope for now.
   Focus on generated artwork quality; artists can address balance if they
   care about it.
7. **Starting point.** Artists start with a blank map. Starter presets,
   examples, and reusable content libraries can be added later. Existing
   Landform and material presets remain part of the authoring controls;
   this decision does not remove them. Internal benchmark scenes are not
   starter content. Stamps, when their time comes, are copy and paste of
   paths, with the copy aligned to the tile grid so that its output uses
   the same tiles as the original; not a focus now (owner, later the same
   day).
8. **Compatibility.** The exported `.ufo` is the enduring game contract.
   Terraform and Nanolathe implementations and editable-source behavior can
   change. A saved artist path may render differently after an algorithm
   update; that is acceptable for now. Do not add a promise of historical
   recipe rendering, old-build hosting, or upgrade comparison UI.
9. **Outside users.** The owner will show individuals the editor as soon as
   practical, after the initial UI revamp and retail-biome improvements.
   Their observations will inform subsequent work; outside-user testing
   is not a prerequisite to making those initial improvements.
10. **World scope.** Metal and Urban are deferred. Get the core terrain
    editor working well before expanding scope.
11. **Tile budget and map size.** Tile budget is first-class. Optimize
    interactive editing for **16x16 maps**. This selects a benchmark and
    authoring target, not a new limit on map creation or export. Include
    tile accounting in early measurements and the editing/export workflow.
12. **Public assets.** Palettes may be committed publicly. Other artwork
    must be newly generated by the project; do not commit retail artwork
    files or encode copies of retail artwork as data. Retail references
    used for evaluation remain outside the repository. No additional
    exception for retail-derived artwork is authorized here.
13. **Reviewable work.** Use small commits grouped into bounded milestones,
    limit concurrent changes to the same visual stage, and retain evidence
    sheets and decision records. A larger commit is not itself a better
    review unit. The proposed R12 numerical ceilings still need review.

### Later answers (2026-11-09, evening)

- **No new gates.** "We already have too many tests." Benches and
  measuring tools in this plan are scripts run on demand by the card that
  needs them. Nothing here adds a check to `repro/check.sh`, and a card
  that can retire a check should say so.
- **One plan.** This document, edited from `plan/redesign` and kept on
  main, is the copy every agent works from.
- **Land soon.** Reviewed work that passes its checks lands on main
  promptly, so branches stop drifting apart. Pushing main remains the
  owner's step.

### Later answers (2026-11-09, night)

- **The picture comes first [owner decision].** "I really want to focus
  on two things: 1. Mimic retail worlds 2. Hyper realistic output with
  artist knobs to create amazing real and alien worlds. Everything else
  is secondary. If our output is not good then speed doesn't matter.
  Device support doesn't matter."
- **The iPad waits [owner decision].** "The iPad isn't going to move the
  needle and we can add support later."
- **Judge the biome, not an individual section [owner decision].** "The
  retail heightmaps images are extremely low resolution and don't match
  the height information exactly that was used in the original 3d software
  to make the retail terrain. I don't think we can rely on it. It feels
  like a fool's errand to try and recreate them individually. It might be
  better to build a system that can judge how close our output looks to
  the sections for that biome as a whole, so not judging individual pixels
  or individual terrain shapes, but the design language, pixel detail,
  etc. I just don't know how to do that."
- **Hyper-real references [owner decision].** The owner supplied seven
  pictures, "some quite close, but you get the idea":
  `~/src/geoform/references/gaea-prowess1.webp`,
  `~/src/geoform/references/gaea-rocktools.webp`,
  `~/src/geoform/references/gaea-rocky.webp`,
  `~/src/geoform/references/gaea-sand5.webp`,
  `~/src/geoform/references/gaea-sandstone.webp`,
  `~/src/geoform/references/gaea-surface1.webp`, and
  `~/src/geoform/references/gaea-surface3.webp`. The owner's eye on boards
  against these pictures is the visual test; terrain statistics remain
  tripwires. The pictures and boards stay outside the repository.

### Latest answers (2026-11-09, late night)

- **Realism first; retail later [owner decision].** "Of all the things
  I've tried lately the only thing moving the needle in the right
  direction feels like adopting voxels and working on 3d rock types and
  textures, adding in things like real 3d cracks and gullies, erosion,
  debris, etc. It's not perfect but it feels like it is getting us closer
  to realistic rock and terrain." And, asked whether retail stops being
  what the engine is tuned against: "Yes, let's focus significant work on
  realistic high quality terrain generation and not focus on matching
  retail, then we'll circle back later once we have more realism and
  proper controls for each feature that created it." This supersedes the
  order in "The picture comes first" above and parks "Judge the biome, not
  an individual section".
- **The six builds could not be ordered [owner judgment].** On six blinded
  past builds of Desert beside retail: "I've looked at them all and I'm
  honestly not sure how to rank them. They are all a good bit off in
  different ways." And: "painted desert is kind of a unique map. It would
  be far better to use green planet, red planet, lava, etc."
- **No computed judge passed [measured, Codex, `$R/agent-judge/REPORT.md`].**
  The old look score, extended to unpaired sets, met the floor and ceiling
  test in 40 of 44 cells and a texture-statistics candidate in 31 of 44;
  every cell the new one passed, the old one passed too, so the tests
  could not tell them apart. No scene of Green or Lava was unchanged
  across the six builds. The old paired look distance fell from `24d1ef70`
  to `f01cddfb` (Desert .437 to .404, Lava .136 to .117; lower is closer),
  the night of rounds after which the owner saw no improvement.
- **What the first realism sheets show [`$R/agent-realism/`].** Both were
  rendered at `27bebfb8`, before the fracture hierarchy (`7d096380`,
  `ff5e25b3`) joined main.
  - In clay under a 12 to 18 degree sun the cliff's ledges are lit
    geometry **[by eye, a second agent]**. They ring the mound's outline
    and do not end, split or overhang; the cliff's foot is even ribs, not
    sand, scree and separate stones **[by eye, the same]**.
  - Round 1 raised the rock lattice (4 px to 2), runoff rounds (16 to 32),
    voxel spacing (1 px to .5), wear rounds (4 to 8), near-shadow steps
    (48 to 96) and sampling (two a side). Shape and Time stayed at their
    2 px lattice and 200 rounds. The tile went from .558 s to 3.318 s
    **[measured, Codex: M3 Pro, warmed, one 1,024 px tile]**, and no new
    shelf, slab or debris form appeared **[by eye, a second agent]**. So
    for the rock, voxel and draw stages, raised budgets with no new
    mechanism did not add forms. (The budgets are coupled to the physical
    response, Codex notes, so this was not a pure test of precision.)
    Shape and Time at larger budgets are untested.
  - No height byte moved in round 1. That follows from holding Shape and
    Time fixed, and says nothing about a bake that changes them.
  - The ribs at the foot have a period of 6.5 to 7.4 px in both builds
    **[measured, Claude: strongest Fourier peak in three 96 px windows of
    the two clay renders]**, so they do not come from the flow lattice
    that round 1 halved. They are the sand ripples (`sandRipples` in
    `engine-bake.wgsl`, the scene's `ripple` at 7): setting `ripple` to 0
    removes 98.9 to 100 percent of the power in the 5 to 10 px band in
    those windows **[measured, Codex, ledger v0]**.

### Answers of 2026-11-10

- **Rule 10 adopted [owner decision].** "Yes land it." `AGENTS.md` rule
  10 now puts real terrain first and parks retail tuning.
- **Geology moves the drawn line [owner decision].** "Yes, and it should
  because we are drawing parametric curves and real terrain has natural
  variation." (Section 5 has the question as it was put.)
- **No fixed scale [owner decision].** References are chosen by the size
  of their features in pixels; "if a scale can help feel free to use it
  and we can tweak if needed."

### Remaining validation, not unanswered product choices

- Record browser/OS versions, viewport, device pixel ratio, and render
  resolution when testing the MacBook Pro and iPad. Benchmark the 16x16
  workload and test the core tools and passability overlay with fingers.
  The iPadOS version was not supplied; capture it during device testing.
- Reconcile the technical concerns from the adversarial review before
  handing off the affected cards: benchmark independence and registration;
  cache precision, dependencies, and lifetimes; end-to-end latency;
  approximate versus exact solid optimizations; erosion-domain boundaries;
  dial precedence; and tile reuse/seam behavior.
- Keep R11's complete-source-state checks separate from future-version or
  cross-GPU reproducibility. The latter is not the source-file contract.
- Run today's editor on the iPad before designing for it (section 2), and
  arrange an HTTPS address for the tablet to reach.
- Extend the first 16x16 latency and memory runs (section 2) to the target
  1440p workload and the iPad. Export took 43-217 s headless at that size
  against 3.7 s at 4x4; whether the artist needs progress, cancel or a
  faster path there is undecided.
- Tile reuse beyond pooled ground waits for copy and paste of paths
  (decision 7). Until then, watch the count: with stamps deferred and the tile
  budget is first-class (R10): dense Moon is 3,399 tiles under the cap.
- Run the provenance audit (R13) before the repository is public.
- Keep LLM review honest (R0): a separate reviewer, fixed framing, located
  differences, and a controlled check behind any claim about light or tone.

### Trade-offs that will not go away

| Tension | Where this plan stands |
| --- | --- |
| **Realism, control, speed: pick two.** Long simulation gives realism and takes control and time; pure functions give control and speed and look synthetic | Control and speed, with realism from structure the artist can see and move (R3), and simulation only inside a landform's own domain (R4) |
| **Global processes against tile independence.** Drainage is global; tiles must not be | Vector structure is global and tiny; raster work is local to a landform. Rivers across plains stay explicit strokes |
| **A preview that is fast against a preview that is true.** A coarse preview can teach the artist the wrong picture | Previews are the same model at a coarser grid (principle 5), with a check that the generic and final pipelines agree (R7) |
| **A true 3D solid against a height field.** | See R8 |
| **Hyper-real against 256 colors.** Dither hides banding and multiplies unique tiles | Standard TA export and the palette stay; tile budget is first-class; full color is deferred |
| **Power against a short panel.** Rule 9 wants a control for everything an artist would shape | Few controls on the surface, every number one click away, and both tiers held to the 5% rule (R9) |
| **One engine for every world against looks that are not terrain.** Crystal, Ice and Metal keep pulling world-named terms into the shader | A trait becomes a generic term any world can turn up from zero, or it stays out (principle 3) |
| **Matching 1997 against looking natural.** Retail's marks follow no fall line; natural terrain's do | No single number runs between them (section 3.8c). A world's retail preset and its modern preset are two settings of the same relief kinds, and R9c's blend moves between them |
| **Art detail against game truth.** Sixteen-pixel heights cannot carry what the art shows | Large blocking features belong in the shape; artists confirm and adjust with the passability overlay |

## 8. Rules this plan would amend

- **Rule 9**, add: "A panel shows at most about ten controls before
  Advanced. Every control declares the stage it first affects, and the
  stage map is checked."
- **Rule 10**, change its head and first two points to say that real
  terrain is the standard for now and retail is returned to later, in the
  owner's words of 2026-11-09 late night (section 7). Its points on shape
  before color, on tables measured from retail, on retail never being read
  at run time and on generated art staying procedural are kept as they
  are. **Adopted on 2026-11-10**: this is `AGENTS.md` as it now stands.
- **Rule 12**, add: "Export does not depend on view options. A map carries
  its world. Same-build, same-machine determinism remains a check; editable
  source does not promise the same export across GPUs or future builds.
  The exported `.ufo` is the game contract."
- **Checks table**: the `repro/retail.sh` row is parked with rule 10 (the
  script stays); nothing is added in its place. **Adopted on 2026-11-10.** The benches of R0 and the stage-map tool are
  scripts a card runs when it needs them; the owner's steer is fewer tests,
  not more (section 7, later answers).

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
| `agent-judge/` | `REPORT.md`; six past builds' renders kept in `builds/`; frozen tuning and review sets (`SPLIT.md`); unpaired boards by kind of ground (`today/`); the six-build boards (`ranking/`); the judge trial (`trial/`); the seven reference pictures reduced and put through the palette (`references/`) |
| `agent-realism/` | `step1-green/` (the budget table and the six-panel sheet), `round1/` (raised budgets on one tile, with its prototype patch) |
| `claude-handoff-2026-11-09/` | The hand-off files between Claude and Codex, among them `CODEX_HANDOFF_REALISM.md` and `CODEX_HANDOFF_LEDGER.md` |

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
