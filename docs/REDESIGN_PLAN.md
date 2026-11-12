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
  world: it waits for the owner, and those scenes would be pinned first. (Landed the next day; see below.)
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

**Day of 2026-11-10: bays replace the rim notches, and the plateau's
default [landed on local main by Claude; reviewed by Claude with an
advisor model; the owner has not seen the bays].** The owner, shown the
night's sheet: the notched rim and varied gullies are the right direction
("Yes"), and plateaus get gullies and scree by default with the scenes
pinned ("Yes").

- *The notches the owner approved are gone, replaced by bays.* Raising
  Gullies on a default plateau showed parallel grooves in level ground
  round any dimple in its top (Ice, Moon) **[by eye]**. The cause: the
  notch term looked ahead along the fall line with the looking cell's own
  outline noise, so a bulge of the outline read as a drop that was not
  there **[read, then confirmed by switching the term off]**. Now, in
  bays one wavelength apart, the whole face is read farther out along the
  fall line, so the wall stands back by up to 0.45 wavelength and keeps
  its own section; buttresses between stay on the drawn line. A bay has
  one depth down its fall line and only a side steeper than the repose
  has bays. To go back to notches, revert `8664f993` and `d6f622ba`.
- *Measured, the sandstone tile at Gullies 60 against Gullies 0:* 44 of
  587 level plateau cells move by more than 2 units; flat cells 501 to
  448 (the notches: 449); cells vehicles can use on the top 556 to 502
  (the notches: 531); the ramp's 99 corridor cells keep every byte.
  Gullies 0 is byte-identical; Gullies 5 moves no level cell by more than
  2 units.
- *Modern Green (its mountains have gullies):* statistics in the real
  range 7.94 to 7.94 of 15; gate failures 21 to 22. The first version of
  the bays made closed basins (28 failures); the two limits above came
  from that report.
- *The Plateau button's preset is Gullies 50, Gully size 50, Talus reach
  25.* A scene or fixture that names the bare kind, `"landform"`, does
  not take it: it gets the model's defaults and the world's plateau
  numbers, so the 34 scenes and the fixtures drawn inside the checks keep
  what they were (0 of the 31 scenes outside modern Green move). **Other
  agents: a scene's `"landform"` is no longer what the button draws; name
  `"plateau"` for that.** No check scene shows the new default; the hover
  preview does.
- *Scree and KBots* **[measured over the exported height cells: can
  KBots reach the top of a default plateau, 70 units, with no ramp]**. On
  one outline in six worlds, Talus reach 60 and 80 opened five walls that
  were closed, and 25 and 40 opened none. At the preset, over five worlds
  and four outlines, KBots reach the top on 8 of 20 walls, all of them
  walls they already climbed without gullies (11 of 20); vehicles on
  none. So the default has little scree. Whether scree that KBots can
  climb is wanted is the owner's call.
- *Drag* (map16, alternating builds): frames 16.7 ms at the median and
  the 95th percentile on both; shape passes 0.91 to 0.96 ms each for a
  plateau, 1.07 to 1.08 for a mountain.

- *Scree marks its own ground* (`03b1d44f`). A talus cone was drawn as
  rock: the skin covered it with the face's beds, blocks and ring lines.
  Where the talus lies over a cell the landform pass now writes the two
  planes a Paint stroke writes: relief toward weaker (plane 5) and
  scatter toward denser (plane 4). No new mask or control, and paint over
  the landform still has the last word. Height bytes are identical with
  and without **[measured]**, so passability and the realism report do
  not move; 0 of 34 check scenes change, because none uses Talus reach;
  the mountain's drag is 1.09 ms a shape pass on both builds. **[by eye,
  Claude]** The apron is smooth loose ground with scattered stones and
  the rock stands above it as ribs; narrow scree chutes between ribs
  have crisp edges in places.

**The comparison loop [owner's direction, 2026-11-10].** "We should do a
visual comparison with our reference images to determine what is the most
impactful missing feature for that hyper realistic look and work on that
next, then do it again." Also: "Bays vs notches not sure yet, kbots can
climb scree based on slope like normal." So scree is not tuned to keep
KBots off a wall.

- *Round 1: scale, profile and rock recipe, no engine change* **[by eye,
  Claude, on a like-for-like fixture: a 760 px, 165 unit cliff with a bent
  outline]**. With Desert's sloping plateau section (`mesa`) the engine
  already gives a broad wall of ravines and spurs with long shadows, and
  with the rock detail off the form is clean. Three defaults hide that:
  the Plateau button's size (300 px, 70 units); its sheer section
  (`lfPlateau`: Green and Moon stay a thin wall at 160 units); and the
  engine-default rock (11 px blocks, heavy pitting; Green 7 px), which
  reads as pebbles, where the engine's own recipes (granite, sandstone,
  gneiss) read far closer to the reference. A straight test path made
  every ravine parallel; a bent one does not. The ravine mechanism
  proposed earlier was dropped. Which recipe each world takes and what
  the Plateau button draws are looks, for the owner.
- *Round 2: the cliff's foot.* The reference's lower third is fans and
  boulders; ours was a bare skirt, because the talus apron needs a face
  steeper than the repose. Landed: a wide landform keeps its fall line to
  the foot (`4f980260`: gullies and talus stopped 320 px from the path,
  where a weight fell under a fixed threshold; 1 of 34 scenes moves,
  green-modern-2; modern Green's statistics in the real range 7.94 to
  7.88, gate failures 22 to 25, all in that scene, where the hill's long
  back now carries the rills it was set to have); and ravines lay an
  apron of fans below a wall whatever its slope (`d96dbf06`: from where
  the ravines open to a toe the reach beyond the foot, smooth lobes a
  wavelength across; on the fixture 1,147 of 17,680 height bytes rise, by
  33 units at most; closed-basin cells 3,257 to 3,268). The fan's height
  comes in with the reach, and talus stays off a route an earlier stroke
  laid (`1513a649`; a ramp drawn first had scree across its foot). Regional
  replay finds no mismatch on three scenes with fans. At the Plateau
  preset, over five worlds and four outlines, vehicles are kept off all 20
  walls and KBots reach the top on 9. Drag: frames 16.7 ms on both builds;
  a mountain's shape pass 1.08 to 1.11 ms.
- *Known, not fixed.* On a small plateau with strong Wander, Talus reach
  60 and over makes a lumpy apron, so the Plateau default stays at 25.
  The fan's outer edge shows as a line where the stones stop. The
  Gullies' stripes have phase jumps (their forks); the bays read the same
  stripes and may step there.

**The owner's decisions for round 3 [2026-11-10].** Bays, not notches
("Yes let's keep bays": over 12 walls the two let the same units up; the
notches read as a comb of slits into the level top). "Granite on green and
sandstone on desert sounds reasonable", as the rock of the modern variants.
The Plateau button draws larger and on a sloping section ("Sure"). And two
rules for the loop:

- *Flat ground to build on.* "This is for an RTS game that needs
  significant flat space (no default should have level ground undulation
  or noise that goes into the heightmap for example, artwork is fine). We
  can have some additional rough rock, slabs, boulders, etc near the edges
  but the majority of the plateau or area around the plateau/mountain/etc
  should be flat to allow for building. We need a middle ground here
  between hyper-realism and gameplay and importantly the transition from
  realism to flatter ground should be believable."
- *All the references.* "Let's not lose sight of the other reference
  images as they have interesting rock texture and sand features we should
  also be striving for." Each round looks at all eight pictures.

What that changed **[measured unless marked]**:

- *Level ground is flat in the heights by default* (`5ff7acf3`).
  Undulation height is 0 in every world (it was 1.5 to 14 in eight of
  nine), and the Plateau button's top has no Height variation. The plain
  is 100% level cells in all nine worlds (Desert was 5%, Lava 9%, Green
  66%). The art loses the soft mottle the undulation lit, on 3 to 13% of
  pixels **[by eye: no world loses its look]**. The retail scenes pin
  their old values, so 0 of 34 check scenes move. There is no art-only
  undulation; if the mottle is missed, that is a control to propose.
- *The Plateau button* (`394af087`): 800 px across and 130 high. Its
  wall is the outer 105 px of each side: a debris slope to 0.36 of the
  rise at the repose, a caprock cliff and a rounded brow, the same on
  both sides (the old plateau's back was a fifth wider; on this section
  that took the level top from 57-66% of the footprint to 53-64% on a
  click). Over nine
  worlds and three outlines the level top is 57 to 66% of the footprint
  on a click and 66 to 77% on a drag, 48 to 68% of the footprint seats a
  level 64 px pad, and no vehicle or KBot reaches the top of any of the
  27 walls (a way up is a ramp, drawn). Gully size went from 50 to 20: it
  is a share of the half width, so on a wide plateau 50 set 180 px
  between gullies, whose ridges stood 40 units over the top. Desert's
  plateau keeps its strata and outline and takes this size and section:
  that replaces the 400 px mesa the owner accepted in the landform
  review (its top was 21% of its footprint and KBots climbed it), so it
  is the owner's call to confirm.
- *Rock recipes in the modern variants* (`01fdcc95`). A variant names a
  recipe and the page lays its numbers over the world's when the file
  loads, so they live in one place. Modern Green is Rounded granite, beds
  and all: statistics in the real range 7.88 to 8.47 of 15, gate failures
  25 to 21 (hilltop roundness passes 5 to 9 of 17 windows). The recipe
  sets 49 of Green's rock numbers, not only its blocks: rock on every
  steep face (.9 to 1), runoff (0 to .65) and cliff debris (0 to 1.1)
  among them. On green-modern-1..3 that moves 6 to 13% of the height
  cells by 1.3 units on average (9 at most); cells too steep for vehicles
  go from 1.6, 4.4 and 1.9% of the land to 1.8, 4.5 and 2.0%; the water
  cells are the same. **[by eye]** The hills show larger pale outcrops and
  more loose stone round their feet; the coast stays grass to water. The
  page and Node render green-modern-1 to the same bytes, and the Rock
  recipe list shows Rounded granite. Desert gets a `modern` variant (a new
  entry in its list) with Layered sandstone's 52 numbers over its own
  beds. Both are the owner's to judge on the sheets before they land.
- *Known, not fixed.* A gully's ridge still stands over a plateau's top
  (13 to 38 cells, up to 30 units): the gullies cut and raise about the
  drawn surface alike, where a real one only cuts. On Desert a level top
  takes the color of the bed at its height, so at some heights it is
  patches of two beds (Elevation 100: gray with salmon blots), and the
  sandstone recipe's own thin beds do that at the button's 130.
  Archipelago's plateau wall shows no bare rock.

**Round 3: the gap list over all eight pictures [by eye, Claude,
2026-11-10; fixtures are the Plateau and Mountain buttons and a gullied
hill, in the nearest recipe and existing World controls].** Level ground
stayed 100% level in the heights in all ten fixtures **[measured]**.

| Reference | What it has | What we draw now | Gap |
| --- | --- | --- | --- |
| Top-down escarpment; `surface3`; `sand5`; `prowess1` | Rock that fades into flat ground: bedrock pavement and slabs at the rim, rubble and boulders thinning away from the foot | A level top and plain of one tone up to a hard line at the cliff; a few stones at the foot | No rim or foot zone. **The pick**, because it is the owner's own rule: rough near the edge, flat and believable beyond |
| `sand5`; `rocktools` (2nd panel) | Sand drifted against rock and pooled in hollows, with ripples | No drift readable at 1x: with the Time pass on (Desert's engine preset already sets Erosion 1, which is why 1 and 0 in the address gave the same bytes), Sand supply 1.3 and 2 moved 0.7% and 1.0% of the pixels **[measured]**. The Sand brush was not tried | Sand that gathers by itself in the lee and the hollows |
| `sand5` | Tilted beds standing as hogbacks | Bed tilt .4 paints stripes across a level top | Level ground takes the bed's color at its height: stripes when tilted, patches of two beds at some heights. A level top needs one cover |
| `prowess1`; `sandstone` | Clean cliff bands with a debris slope under each; readable beds and joints | A wall whose rock reads as busy speckle at 1x; one debris slope | Rock detail too fine and too contrasty for 1x; cliff and slope do not repeat up a wall |
| `rocky` | A boulder field: piled angular blocks 20 to 60 px | Breccia with Supply 1 at 16 px: a handful of stones | Stones do not pile or cover |
| `surface1` | Rills that branch and join down a slope | On a round hill at Gullies 100 the rills run out from the top like spokes | No branching on a cone |
| `rocktools` (1st, 4th, 5th panels) | Plates, folded swirls, spalled crust | Not judged: Moon's, Lava's and Red's faces are near black, so no recipe reads there | Fixtures to redo on Desert and modern Green; those worlds' face light is its own question |

**Round 3, built: bare rock at rims [Claude, 2026-11-10; the owner: "keep
going with your pick"].** Soil is thin at the edge of a drop. A new World
control, Bare rock at rims (px) in Rock relief, bares level ground within
its reach of a cliff's edge: wholly at the edge, then in patches, then only
as low slabs under the ground cover.

- *One system.* The rock weather pass, which already looks up from each
  cell for the cliff that sheds debris onto it, now also looks down for
  the drop (`engine-rock-weather.wgsl` `rockDeposit`; it writes into a
  texture the pass has finished with, so it takes no memory). The result enters the painted-rock gate (`rimRockAt`), so the
  rock is the voxel solid's own, in the world's recipe, with its joints,
  beds, wear and colors; there is no second rock model. The solid gives a
  rim half a face's relief, so level ground stays low.
- *Where it acts.* On ground level to within .08 units a px (none over
  .25), above a fall of 8 units that is a cliff's (.9 to 1.6 units a px)
  and lands dry. A first version also bared hill shoulders and a stretch
  of Green's coast; with these limits green-modern-1..3 move 0.06 to
  0.25% of their pixels.
- *Measured, the Plateau button on modern Green and Desert:* no height
  byte moves at reach 40, 60 or 80. Of the level top's pixels within
  64 px of the wall, 10 and 13% change at reach 40, 15 and 19% at 60,
  20 and 24% at 80; the plain changes 0.25% or less. Regional replay: no
  mismatch. Speed, same scene on both builds, second run of each: load
  2,045 against 2,079 ms, release 1,896 against 1,898 ms, drag frames
  16.7 ms on both. One plateau adds 19 distinct 32 px tiles of 1,075 on
  Desert.
- *Defaults.* 0 in every world's own preset; 60 in modern Green and
  modern Desert. **[by eye]** Green's turf stops 20 to 45 px short of the
  edge on a ragged line and granite shows; Desert shows salmon and cream
  slabs round its rim.
- *Other shapes* **[by eye, one fixture in each modern world]**: a ramp
  up the plateau stays clean; a shallow valley, a crater and a valley
  full of water get no rim; a steep dry canyon cut into the top gets a
  band of slabs on both sides, and no pits. A far paint stroke changes no
  pixel of a rim **[measured]**.
- *Not done.* The foot. Cliff debris reaches the plain but fades within
  about 32 px on Green and barely shows on Desert, and three systems lay
  it (see the weathering note below): which one carries the foot zone is
  the owner's call. A drop into water has no rim. Found on the way, not
  from this change: modern Green renders 6 pixels differently at 128 px
  and 256 px tiles.

**Weathering: what runs today [read, Claude with a second agent,
2026-11-10; the owner asked whether one system does it].** It is not one
system. Four run in a stack, each on the output of the one before:

| | Where its controls are | What it works on | Reaches the game's heights |
| --- | --- | --- | --- |
| Shape: a landform's Gullies and Talus reach | the tool's own panel | the 2D height field | yes |
| The Time pass: water erosion and slumping | the Weathering box in the top bar; Rain and Sand supply in the World panel | the 2D height field | yes |
| Rock weather: runoff and cliff debris | World, Rock runoff and Rock debris | a 2D lattice of 4 px cells, read from the heights | no, art |
| The voxel solid: blocks, beds, spall, wear, crust | World, the other Rock groups | voxels on the surface | no, art |

- The Weathering box switches the Time pass alone. The World panel's rock
  controls are the last two rows, and only the last is voxels. They are
  not copies of the Time pass: the solid sits on the height the Time pass
  left, and rock weather reads its flow.
- *The same job in more than one place.* Debris at a cliff's foot comes
  from Shape's talus (heights), from the Time pass's talus map (stones
  placed from it, `engine-bake.wgsl` `lsMaskCompute`) and from rock
  weather's debris (`engine-rock-weather.wgsl` `rockDeposit`), each with
  its own repose rule. Channels
  down a face come from Shape's gullies, the Time pass, the bake's rills
  and ribs, Runoff's cut and the solid's grooves. Edges are rounded by the
  Time pass in the heights and by Weathering (rounded edges) in the
  voxels. Sand comes from the Time pass, the Sand brush and the beach.
- *Dead weight.* A drainage plane was computed whenever the Time pass ran
  and nothing read it (`drainageAt` had no caller). The
  material field lives behind a hidden panel and is on in Archipelago
  only. The solid runs its four wear passes when wear is 0. Erosion, its
  age and the talus angle have no row in the panel.
- *How sure.* Claude checked in the code: what the Weathering box gates,
  the unread drainage plane, the hidden panel, the four wear passes and
  the three sources of foot debris. The lists of channels and of sand are
  the second agent's reading, not rechecked.
- **Done, at the owner's word ("Yes", 2026-11-10):** the drainage plane is
  removed (the last commit holding it is `4e5a9455`; the regional check
  now compares the pages' coarse lattice with the whole map's heights
  directly), and the solid runs no wear rounds when wear or rock depth is
  0 (the same bytes). Rock weather also runs no flow rounds when Runoff
  exposure is 0 (the same bytes).
- **Done, at the owner's word ("That's fine, let's do it", 2026-11-10):**
  one system lays debris at a cliff's foot in the art. Shape's talus keeps
  the heights; cliff debris is rock weather's; the Time pass's talus no
  longer places stones. The stone mask finds a foot from the heights
  (gentle ground with a rise of 2 to 5 units within 14 px), with no pass,
  texture or margin added: 13 of 34 scenes change, 0.05 to 0.68% of their
  pixels **[measured]**, the same picture by eye. A first try put the
  measure in rock weather's pass and failed the voxel check (105 MB of
  96), and a second reached out to Rockfall reach from the stone pass and
  failed it too (98 MB: a bake margin over about 92 px doubles the
  check's input texture, which is sized in powers of two).
- *Left for the owner.* After this nothing reads the Time pass's talus
  map; it is still computed and packed. With rock weather on, the bake
  margin is 180 px. For a 256 px chunk of modern Green that takes the
  field input's grid from 507 to 517 wide, over a power of two, and its
  memory from 26 to 52 MB **[measured with the renderer's own estimate]**:
  a margin of 170 px or less, or a finer size than powers of two, would
  save it. Not changed. The rim's reach (on main) swells and thins from 0
  to 1.2 of the control, not from 0.6 as intended: the noise it uses runs
  from -1 to 1. Not changed; the look was judged as it is.

**Round 3, built: the foot zone [Claude, 2026-11-10].** Cliff debris now
also lies out from the toe of rising ground, on gentle ground, thinning to
nothing at Rockfall reach with a ragged far edge, in the color and block
size of the beds standing over it (`engine-rock-weather.wgsl`
`rockDeposit`). Before, debris ended where the debris slope did, and
Cliff debris 2 with reach 96 did not reach the plain. No control is
added: Cliff debris accumulation and Rockfall reach set it.

- *Measured.* A Plateau on modern Green and on modern Desert: 6.2% and
  4.8% of a 1216 x 1024 window's pixels change, all within the reach of
  the wall; exported heights are the same bytes. Modern Green's three
  scenes change 1.9 to 2.6% of their pixels, and their heights are the
  same bytes, so the realism report cannot move. Load and release times
  are unchanged on modern Green and on Green's own preset (two alternating
  pairs each, before the hill gate below). Land tier,
  `rock-controls-ui` and `export-bytes` pass with the gate in.
- *A hill has no foot.* The owner's hills carry little to no bare rock
  (2026-11-05). The foot counts only below a rise whose steepest step is
  .6 to .9 units a px or more: a wall, a mountain or a debris slope. On
  modern Green a hill's ring of debris goes and a mountain's stays
  (pixels changed against main on a fixture of two hills, a mountain and
  a lake: 5.2% without the gate, 2.7% with it). Modern Desert's hills are
  rock-walled and steeper, and keep a skirt. A lake's bank gets none.
- *By eye.* A skirt of the wall's own rock with blocks at its foot on
  Green; fainter on Desert, where debris and sand are near in tone. The
  owner has not judged it.
- *Not done.* The blocks are the stone scatter's (see boulders, below).
  The control sweeps were not run.

**Round 4: what the engine still lacks, in order [by eye unless marked,
Claude, 2026-11-10; the owner asked for this].** Twelve fixtures on the
branch with the rim and foot zones in, all on modern Desert or modern
Green (round 3's Moon, Lava and Red fixtures lit their faces near black):
a Plateau in nine recipes and with existing controls only (the 800 px
Plateau swallowed the fixture's Mountain and Hill, so those two were
judged from a second fixture, in each world's own rock only). Judged at
1x and at half scale against all eight pictures. Ordered by how much of the picture each one spoils, the shape
before the color, and the owner's two rules.

| | What is missing | Which pictures | What ours does | Heights or art |
| --- | --- | --- | --- | --- |
| 1 | Rock faces with a hierarchy: planes and ledges 30 to 150 px across first, fine detail under them, one color family per rock | all seven rock pictures | a face breaks up every 5 to 15 px at full contrast, in many hues at once (pink, cream, gray, mint on one Desert wall); no plane is larger than a block | art |
| 1a | A defect inside 1: a lattice of dots 4 px apart on steep faces, in the relief itself (first recorded here as 2 px), with a comb of vertical lines and a staircase along diagonal edges | none (it is ours) | the lattice is fixed (below); the comb and staircase remain. Before the fix, 3.05% of clay pixels on modern Desert's Plateau and 3.06% on modern Green's were in a 2 x 2 alternation over 60 of 255, against 0.55% and 1.35% with Rock relief depth 0 **[measured; Green's stippled ground is the 1.35]**; after it 2.23% and 2.72% | art |
| 2 | Beds that run along a wall: a hard bed stands as a cliff, a soft one lies back as a slope, and the pair repeats, traceable for the wall's whole length | `prowess1`, `sand5`, `sandstone`, `surface3` | at the Plateau's Gullies 60, gullies cut the wall into equal fins and no ledge runs more than one fin; at Gullies 15 beds and stepped ledges do run along the wall (one render), so part of this is the preset; Terraces 10 with Ledge 100 changed little | both: a bench 16 px or wider belongs in the heights |
| 3 | Level ground with a surface: tone and cover that change over 50 to 300 px (damp basins, dust, pavement, wash lines, stones thinning), the heights left flat | the top-down plain, `sand5`'s floor, `prowess1`'s foreground | Desert's plain is one tone of 1 px speckle and a level top is one flat tone, in both modern variants as they ship (a recipe that also replaces the world's beds paints blobs of bed colors on a top; modern Desert avoids that by keeping its own beds) | art only (the owner's rule) |
| 4 | Sand that drifts: smooth sheets pooling in hollows and at a wall's foot, burying ledges, with ripples that vary | `sand5`, `rocktools` (second panel) | Sand supply 2 changes 0.86% of pixels **[measured]** unless the Time pass's rain is on (off in the presets), and then lays thin streaks; the Sand brush paints a hard-edged patch of even ripples; Desert's sand is darker than its ground | art; rain moves the heights |
| 5 | Boulders: blocks 20 to 60 px with lit faces, piled and of every size down to gravel | `rocky`, `prowess1`, `sand5` | the largest stone class has a 16 px radius; stones are dark flat blobs set apart, and on Desert not the color of the wall they fell from | art |
| 6 | Rills that branch: a tree of channels on a soft slope, joining downhill | `surface1` | gullies and runoff grooves run side by side down the fall line and do not join | both |
| 7 | A wall that varies along its length: massive buttresses, deep alcoves and plain stretches | the top-down picture, `sandstone` | one gully rhythm all the way round; bays exist but every stretch between them is alike; no control varies Gullies along one wall (the two looks in row 2 cannot share a wall) | heights |
| 8 | Folded and swirled beds | `rocktools` (fourth panel) | beds are flat or evenly tilted | art |

- *Known defects, not ranked above.* Gully ridges stand up to 30 units
  over a plateau's level top (the gully size is a share of the landform,
  not of the wall). Archipelago's wall shows no bare rock. A drop into
  water has no rim. Modern Green renders 6 pixels differently at 128 px
  and 256 px tiles.
- *The owner's call, not ranked.* Every reference is lit low and raking,
  with long cast shadows and dark ravines, and much of their depth is
  that. Ours are lit from higher with short shadows.
- *How sure.* Rows 1a and the sand number are measured; the rest is by
  eye from one Plateau path in each recipe, so a row may be partly
  settings (as round 2's gap was, and as row 2 partly is). Only rows 2
  and 7 were tried against existing controls. Row 1's many hues are
  partly Desert's own strata colors, which are data. Rows 5 and 6 were
  not tried against controls. The order of 1 and 3 is arguable: 1 is
  first because seven of the eight pictures are rock and it is what reads
  worst at 1x; 3 covers the most ground on a real map.

**Round 4, built: row 1a's lattice [Claude, 2026-11-10; the owner: "start
on the checker defect"].** The voxel guide gives each voxel the direction
its rock is displaced along: its own normal, or a steeper face's within
16 px. It searched the surface at the voxel's own position plus multiples
of 4 px, so neighbors read disjoint candidates and picked different
faces, and every steep face carried a 4 px lattice of dots. A pass now
reduces 4 px blocks on the global lattice to their steepest normal and
every voxel searches the same blocks (`engine-volume.wgsl`
`voxelGuideBlocks`, `voxelGuideBuild`). A face's hold on the ground
around it also fades from 2 px to nothing at 16 px: ending in one step,
it drew rings round small steep spots once the lattice no longer hid it.

- *How it was found* **[measured]**. No single rock term makes it (each
  set to 0 in turn on breccia: 2.76 to 3.44% against 3.44%, and 4.31% with
  wear at 0, which smooths it); it grows with Rock relief depth; searching every cell within 16 px removes it.
- *Measured.* The checker share equals that reference search's on four
  fixtures before the fade (2.46% against 2.45, 7.78 against 7.94, 2.55
  against 2.47, 2.95 against 2.91; main 3.44, 9.21, 3.38, 3.38) and is
  2.39, 8.15, 2.35 and 3.22 with it; by eye the lattice is gone and the
  forms match the reference, with softer brows. Pixel for pixel it is not the
  reference (about 40% of clay pixels differ, 3 to 8% by more than 24).
  33 of 34 scenes change, heights the same bytes in all; the voxel check
  holds 0 pixels between budgets with 1.6% fewer bricks and 84.6 MB
  against 85.1 of 96; load and release times are unchanged on modern
  Green and on Green's own preset (two alternating pairs, before the
  fade). Land tier and `export-bytes` pass.
- *Not done.* The comb and the staircase remain with the reference search
  too: another cause, not yet found. Tried on schist and breccia, one
  render each **[by eye and the share]**: reading the guide between cells
  changes nothing (8.15% both); a graded close shadow changes nothing;
  Shadow and crevice depth 0 removes some dark specks (6.60%); a solid
  built on the heights without the baked ground grain is 3.61%, so much
  of what the share counts on Green is that grain carried into the
  solid. On Ice a few small soft marks remain
  where the rings were. Voxel steps of 2 and 4 px (the previews) run
  without error but were not looked at. The share is a rough measure: it
  also counts sharp real edges, so it fell by a quarter while the picture
  changed much more. On the branch `realism/checker`; the owner has not
  judged it.

**Row 1a closed; the comb is row 1 [Claude, 2026-11-10].** One-pixel
lines at least 6 px long are 20 to 40 times commoner running down the
screen than across it (0.13% against 0.003% of clay pixels on breccia)
**[measured]**. They are real structure: a vertical joint, or the side of
a very narrow block, projects to a vertical line on screen whichever way
the wall faces. Averaging the lighting normal over three rays across a
pixel changed nothing (0.131 to 0.128%) at three times the draw time. So
the comb is blocks and joints too fine to read, which is row 1.

**Row 1, first experiments [Claude, 2026-11-10; clay, granite on modern
Green, 512 px windows].**

- *Numbers alone do not give planes.* With every fine term off (creases,
  grit, scratches, lamination, spall, breaks, runoff cut), the wall is a
  smooth drape with crack lines: the blocks are 34 and 85 px across and
  their offsets 2 to 4 units, so no block stands as a form. Three times
  the offsets (out of the control's range, set in the shader for the
  test) changes little. Under the solid, the authored wall is one slope
  with ribs down the fall line.
- *A prototype that does: whole blocks.* A block is rock when its middle
  lies under the authored surface and air when over it; the solid's skin
  is then the flat faces between a rock block and an air block. It costs
  two more reads of the surface per voxel and no further block search.
  By eye it gives lit planes 30 to 120 px across. With the blocks'
  middles scattered less (box-like blocks) granite stacks into jointed
  blocks, and Desert's low wide blocks stack into ledges along the beds,
  which is row 2 as well. Rough still: stripes on some facets, large
  blocks reach past the solid's brick apron, and at blend 0 it is not
  yet today's bytes.
- *Not built.* The prototype is kept outside the repository and was
  shown to the owner as a toggle page. It needs the owner's eye, and a
  decision on controls: an amount and a block regularity, as new controls
  or carried by Block offsets and tilts.

**World Creator, read at the owner's request [a subagent's reading,
2026-11-10, not rechecked].** Its documentation names the same piece
("Rock Blocks" with Planarity and Bevel, "Fracture" with Joint Spacing
and Secondary Joints, a "Detail Equalizer"). For the other rows it
offers: one grayscale pattern field per surface mapped through a color
ramp (row 3); pigment carried downhill by runoff and dropped where
slopes flatten (rows 3 and 6); sand as a separate body laid by a
wind-shelter mask (row 4); debris colored by its source (row 5). Its
product page's hero picture is kept as a ninth reference, outside the
repository.

**Whole blocks, built [owner decision, 2026-11-10: "I love the whole
block look, and each example is useful. Adopt it and drive it from new
controls for the amount, size, variation, orientation, etc."; built by
Claude on branch `realism/whole-blocks`, not landed].**

- *The model.* A block is rock when its middle lies under the authored
  surface and air when it lies over it, one answer for the whole block
  (`engine-common.wgsl` `voxelBlockMiddle`, `engine-volume.wgsl`
  `voxelBlockIn`, `voxelWhole`); the faces between a rock block and an air
  block are the rock's skin.
- *Controls (Rock blocks).* Whole blocks and Whole large blocks, each the
  share of blocks that are whole (0 to 1), and Block regularity (0
  scattered as before, 1 a grid). Size, proportions, tilt, orientation and
  size variation stay with the six controls that already set them for the
  same lattice; the owner's list named new controls for these, and this is
  the one place the build departs from it (rule 9: a new control does not
  duplicate one beside it). The owner can overrule.
- *What failed first [by eye].* Moving the surface per block along the
  guide's normal (a continuous standoff) gave a comb of vertical lines:
  27 px of travel multiplies the guide's per-voxel noise. Any cut that
  followed the guide did the same. So where blocks may stand is cut from
  the authored surface 12 px around the voxel: not above the land behind
  a face, not below the ground before it.
- *Limits kept.* Blocks stay inside the bricks already reserved (measured:
  49,919 bricks on green-4 with or without them). A block's middle is read
  at most 40 px from a voxel, so a large block is trimmed and is less whole
  than a small one [by eye]. A block's top is level with the land behind
  it: no rock stands on a plateau.
- *Measured.* At 0, 33 of 34 scenes byte-identical and one pixel in
  desert-1 (compiler rounding). Share of the raised class moved from 0 to
  1, per world's three scenes: Whole blocks 19.2/20.2/17.7% (Green),
  4.3/9.6/8.2% (Desert), 8.3/30.3/0% (Red); Whole large blocks
  27.2/19.3/32.7, 5.4/11.7/9.4, 18.6/49.8/0; Block regularity 2.9/6.7/3.0,
  5.3/7.6/7.2, 2.2/11.4/0. Modern Green with the granite recipe at 0.85:
  final picture 2462 and 2410 ms against 2270 and 2274 on main, 41 chunk
  paints a second while dragging against 45.
- *Recipes [proposed by Claude; the owner decides].* Sandstone 0.8 with
  regularity 0.55, granite 0.85 with 0.15, basalt 1 with 0.7, limestone
  0.6 with 0.45, gneiss 0.5 small and 0.5 large with 0.3, breccia 1. Shale,
  schist and conglomerate stay at 0: slabs 2 to 3 units thick read as
  texture, not planes.
- *Checked after the build [measured].* The realism report on
  green-modern-1 to 3 is the same before and after (heights identical).
  With Whole blocks at 1, Block regularity 0 to 0.55 moves 43.7% of a
  granite fixture's clay pixels. `repro/zoom.mjs` on green-modern-2 fails
  its d4 check on main too (26 pixels over a limit of 16; 30 on the
  branch). The first `repro/perf.mjs` run against a fresh server measures
  nothing on either build. On a modern Green hill at 0.85 grass still
  covers the mound, which is lumpier with darker pockets [by eye].
- *Open.* A zoomed-out view (voxel steps 2 and 4) not looked at. Fine relief (pits, grit,
  joints) does not show on a block's faces, only color does. Small and
  large together leave the draped face where the two disagree. Faint
  banding on some slanted faces at 3x. On a hill the blocks make a tor,
  against the owner's hills design, so hills want a lower amount than
  cliffs (no control for that yet).

**World Creator's five, adopted [owner decision, 2026-11-10: "Also yes we
should adopt those from world creator"; built by Claude on the same
branch, not landed].**

- *Rock blocks: detail and bevel.* A whole block's faces now carry the
  blocks' offsets and tilts, pits, grit and grooves at half strength, up
  to 1 px, so two rock blocks side by side meet at a visible step. The
  existing Weathering control bevels whole blocks (0 to 1 moves 26.1% of a
  granite fixture's clay pixels). No new control.
- *Debris colored by its source.* A stone in a cliff's debris takes the
  bed's color as the debris around it does (6.2% of a modern Desert
  fixture's pixels). No new control.
- *Sand by wind shelter.* New control Wind drifts (Sand, default 0): sand
  in the lee of rises along the wind, a share of the supply. 0 to 1.5
  moves 9.9 and 10.1% of pixels on a Green and a Desert cliff fixture, but
  only 0.4% on green-1 and 3.9% on desert-1, which have few rises: it
  needs cliffs to matter.
- *Pattern field for level ground.* New controls Ground patches and Patch
  size (Ground, default 0): one gray field read through a five-step ramp,
  damp to dusty. Color only. The owner, the same day: "for Nanolathe/TA we
  need tileable flats, so random variation should be optional or work
  with the tile engine somehow", so the field repeats with the ground's
  pool. Distinct 32 px tiles of 4,096 on a bare 2048 px plain: classic
  Green 1,019 without, 1,024 with (4,090 before it was pooled); modern
  Desert 839 and 1,650. The cost is a pattern that repeats every pool
  period [by eye, at overview]. The field is noise only; it does not yet
  follow wetness, hollows or cliffs, and its colors are derived, with no
  color control.
- *Pigment carried by runoff: tried, not committed.* Wash carried with the
  flow and dropped where the slope eases changed 2% of pixels and
  repeated what the debris's pale fines already show. The patch is kept
  outside the repository. A colored stain on the rock face itself would
  show more and needs a color control.
- *Checked after [measured].* Heights are byte-identical with Ground
  patches at 1 and with Wind drifts at 1.5 (four fixtures). Modern
  Desert's bare plain is itself only 97.0% equal to itself one pool
  period over, and 96.7% with patches: the patches repeat as the ground
  does, and Desert's tile count doubles because its ground did not fully
  repeat to begin with. Pooled patches still move 30.6% of a modern Green
  scene. Wind drifts across tile sizes 256, 128 and 64: 2 clay and 3 color
  pixels differ, and 3 and 3 with sand on and no drifts, so the drifts add
  none. Not rerun since the last five code commits: hover previews, export
  bytes, draw time; no export has counted tiles with patches on.
- *Before landing [measured, 2026-11-10; the owner: "All of these look
  great. Land it and restart on 8801"].* `repro/check.sh land`, export
  bytes and the rock panel check pass; four hover previews regenerate
  changed. `repro/perf.mjs map16`, branch against main, two runs each
  after a warm-up: modern Green (whole blocks at 0.85) final on load 2314
  and 2247 ms against 2250 and 2178, 42.7 and 40.8 chunk paints a second
  while dragging against 47.1 and 47.2, final after release 1790 and 1940
  ms against 1666 and 1641; classic Green 2763 and 2732 against 2760 and
  2765, 54.4 and 54.3 against 56.0 and 55.6, 2418 and 2400 against 2332
  and 2360.
- *Checks.* `repro/check.sh land` passes on the branch with all of this:
  the three modern Green scenes move (21.5, 50.0, 23.6%), and
  archipelago-3, crystal-2 and desert-1 differ from main in a few pixels
  with every new control at 0 (count not taken for the first two).

**The debris's edge [built on `realism/debris-growth`, 2026-11-10; not
landed].** The owner, of a map's cliff foot: "the rock is good, the debris
is good, but the transition from debris/gravel/sand into grass and moss is
a little too regular. In nature the grass and moss would unevenly or based
on waterfall and flow grow into various areas."

- *Cause [measured].* The apron is rock weather's deposit (with Cliff
  debris at 0 it is gone; Sand at 0 changes nothing). It was mixed into the
  ground as a linear tint of a field kept in 4 px cells, so its edge was a
  soft contour of the deposit's thickness.
- *What changed (`engine-frag.wgsl` `debrisLie`, `debrisRegrown`).* The
  ground's color reads the deposit at a point moved per pixel (14 px over
  tens of px, 6 px at 9 px, a pixel or two), and the ground takes the
  debris back where it is thinner than the growth needs: by stretch of the
  apron, by clump, by tuft, and more where rock weather's runoff leaves it
  damp. Damp regrowth is part moss. What is left covers the ground as
  gravel does. The existing vegetation value scales the growth. No new
  control. Stones, relief and heights are untouched.
- *Measured.* 3 of 34 scenes change (green-modern-1/2/3: 6.3, 10.8, 7.7%).
  A granite mesa fixture on classic Green: 17.6% of pixels, `heights.bin`
  and the clay render byte-identical; tile sizes 128, 256 and 512 give 0
  differing pixels (main: 1). On that fixture runoff reaches 24% of the
  debris's pixels (16% of the thin debris), so most of the unevenness is
  the patterns, not the water. Debris covers less than it did: 11.5% of
  that fixture's picture as haze, 9.2% now (thin debris 14.2% to 10.5%);
  moss is mixed into 3.2% of the picture. Barren worlds with the same
  recipe, by eye: Moon (14.4% of pixels change) and Lava (15.3%) read as a
  ragged edge with no stray tint; Desert (6.8%) is too dark to judge.
  `repro/check.sh land` and export bytes
  pass; the hover previews regenerate unchanged. Draw time on modern
  Green (`repro/perf.mjs map16`, runs noisy that night): the cleanest pair
  2285 ms against main's 2276 to the final picture on load, 43.8 against
  44.8 chunk paints a second while dragging, 1808 against 1776 ms after
  release; two more branch runs 3020 and 2288 ms, 43.5 and 41.6, 1844 and
  1768; two more main runs 4471 and 2390 ms, 16.2 and 38.1, 2446 and 2582.
- *By eye.* The haze and its brown fringe are gone; grass clumps stand
  inside the debris and gravel patches lie outside it. Thin debris is more
  solid where it remains.
- *Open [proposed by Claude].* A control for the growth's strength apart
  from the world's vegetation; growth that follows the water further
  (rock weather routes runoff only 64 px); the same edge for sand and for
  rock meeting grass, which still fade as before.

**Rock at shores [built on `realism/shore-rock`, 2026-11-10; not landed].**
The owner, of Red's cracked rock platforms running into shallow water:
"this should just be the red planet look on coasts without the need for
manual fissures, so we should make sure the world controls allow this. I
really want one model for shores and shallow water, using voxels, lit the
same, so they are coherent and realistic."

- *What was already there [measured by rendering].* The solid supplies the
  seabed (the ray drops straight down at the waterline), rock under water
  shows its real shaded color through the tint, and the recipe's Joint
  depth, Joint opening width and Secondary joints cut level painted rock
  and carry on under water. The Fissure tool's network layout and the
  per-stroke Cracked bed look also give the picture, by hand.
- *What was missing.* Rock on a level shore without painting. Built: two
  world controls, Rock at shores (px inland) and Rock shelf under water
  (px out), a field in rock weather's rim texture that counts as painted
  rock on both sides of the waterline; a tenth recipe, Jointed siltstone (a
  tessellated pavement); and a modern Red variant that uses both.
- *Measured.* 0 of 34 scenes change with the controls at 0; quick tier
  passes. Modern against classic Red on a 512 px test shore: 26.0% of
  pixels, heights byte-identical, 0 pixels differ across tile sizes 128,
  256, 512. Sweep, pixels changed of 1,048,576: Rock at shores 56,178
  (red-1), 10,628 (archipelago-1), 85,113 (green-1); Rock shelf 14,005,
  116,642, 45,071: whole-picture shares, not rule 9's class share. Not
  run: the land tier, export bytes and tile count, hover previews, draw
  time, a budget-split case in `repro/voxel.mjs`, the zoomed-out view.
- *By eye.* Blocks 40 to 50 px with dark open joints from the shore under
  the shallows. Red's rock is darker than its ground, so the platform reads
  darker than the retail look. Modern Red's cliffs take the recipe too and
  come out darker and rougher. Red's own rock numbers at a face's full
  relief dig ragged trenches on level ground (painted rock on classic Red
  has the same fault).
- *Limits.* The reach stops at 96 px (bake margin 180); the rock is whole
  for about 60 px each side. Debris on Red takes the world's sand color and
  reads olive; the recipe sheds none.
- *The owner's answers [2026-11-10] and what followed.* "Land it, but we
  need controls for the landform tool to select between e.g. rough open
  shores and inland lakes"; "Classic red should adopt it, but make sure it
  has the inner lake look vs the outer cracks look"; "we should have one
  bed model with proper lighting in all biomes, we just need to figure out
  how to represent the red planet lake bed". Built: a water stroke's Shore
  choice (World default or Soft bank; Soft bank also keeps that water's
  banks soil, not rock face); Red itself takes the recipe and the two
  controls at 96, its Shallow tool starts at Soft bank, and the modern Red
  variant is gone. Before landing [measured]: land tier passes with red-1,
  red-2 and red-3 moved 11.2, 10.0 and 27.1%; export bytes pass, the
  red-16 map at 50,094 distinct tiles (49,406 before) and 84.8 s to
  export (67.5); hover previews regenerate unchanged. Draw time on red-3
  (`repro/perf.mjs map16`, one clean pair, the other runs disturbed):
  2360 ms to the final picture on load against 1530, 31.2 chunk paints a
  second while dragging against 56.9 (39.7 on a second run), 2109 ms after
  release against 1220: Red now runs rock weather and a recipe's relief,
  as modern Green does. Not run: the stroke option's sweep row, the
  zoomed-out view, a budget-split case in `repro/voxel.mjs`.
- *Stage 2, one bed model [proposed by Claude, not built].* Soft ground
  under water still uses its own formula, and noise water, the cracked
  bed, bed bumps, dots, grain and notches are separate cases. Today only
  Archipelago and Red light the bed at all (`bedLit` 1); every other
  world's shallows are flat noise art. One model: the bed is always the
  land pipeline's shaded color, water is absorption by depth. Rule 7
  allows no switch, so it removes options and moves every water world.

**Overnight run, item 1: walls [Claude, 2026-11-10 to 11; the owner:
"let's do 1, 2, 3, 4, 5 in order, one at a time. Autonomous overnight
run"].** Branch `realism/wall-variety`, not landed. Rows 2 and 7 of
round 4.

- *What the comb was* **[measured by switching things off on the 760 px
  mesa fixture]**. With Gullies 0 the fins are still there; with Wander 0
  the wall is a plain ramp. The row of like fins is the outline's Wander,
  one wavelength of noise, more than the Gullies. The erosion pass at age
  0 changes little.
- *Variation along the wall* (stroke option, Variation group, default 0).
  Long waves under the outline's teeth, teeth that come and go, gully
  depth from none to 2.4 times, a longer sideways warp. At 0 the bytes
  are main's. At 100: 59.6% of the fixture's picture, 2,838 of 17,680
  height cells by a mean of 10.2 units; the stock Plateau 35.0% and 1,546
  cells **[measured]**. The bays keep their even rhythm: every way of
  varying them moved 220 to 300 pixels with the option at 0.
- *Hard beds* and *Soft beds lie back* (own group, default off). A
  staircase on the lift after the Gullies, as a share of the section's
  own crest; heights only. Hard beds 3: 46.3% of the fixture's picture,
  1,555 cells by a mean of 6.7; 2 of the 1,605 cells at the top's level
  move, by at most 3 units; the stock Plateau with 2 beds 15.9% and 914
  cells; the stock Mountain with 4 beds 27.6% and 483 **[measured]**.
- *By eye.* Beds read clearly on a sloping section in Green's own rock:
  rock bands with grass on the benches. On the stock Plateau's sheer
  face they are faint, and on the Mountain, where the whole wall is
  rock, almost nothing shows: a bench needs a second material to read,
  which is item 3. The erosion pass wears the benches (a flat bench of
  139 units came out at 151 to 154 with the pass on **[measured]**).
- *Tried and dropped.* Marking the soft beds as loose ground (the talus
  mark): plane 5 is the vegetation plane pushed negative, so it removed
  the grass that makes a bench read.
- *Open.* (1) Steps and Hard beds sit side by side: the owner rules
  whether both stay (the page has the pair). (2) No button preset uses
  either option yet; a preset change is the owner's. (3) Bays do not
  vary. (4) Beds on a cut (a canyon wall) are not built. (5) The level
  of a band follows the crest, so it tilts where the crest tapers.
- Page (private): https://claude.ai/artifact/878Vv6rGcfQ8vkdESsUJSU

**Overnight run, item 2: boulders [Claude, 2026-11-11; the owner: "Walls
and boulders look good, land all of it"].** Row 5 of round 4.

- *Boulders under walls* (world control, Loose stone, 0 to 1, default 0
  in every world). The runout blocks' population gains a supply on ground
  under a wall (a rise of 18 to 40 units within 40 px, or 26 to 57 within
  80) and where rock weather laid debris; its median grows toward 34 px;
  one more size class (a 32 px radius); a large angular fragment is a
  block with a tilted top and a broken corner, standing on the ground.
  Art only: exported heights are identical **[measured, four fixtures]**.
- *Measured.* At 1: 5.5% of the mesa fixture's picture (4.2% at 0.5),
  4.8% of the stock Plateau, 6.9% of the Desert mesa. On the stock
  Mountain on modern Green: 1.67% at 0.05, 9.02% at 0.25, 16.32% at 0.5,
  19.61% at 1. `measure/world_controls.mjs`: 2.4% of green-1's whole
  picture and 2.2% of desert-1's; those windows have little ground under
  walls, and the share of that class alone is not computed.
- *Fixed before landing.* The first build changed every large fragment's
  shape as soon as the control left 0 (11.75% of the Mountain's picture
  at 0.05). Fragments now turn into blocks one by one, all of them from
  0.5 up.
- *Open.* (1) No world adopts it yet: the modern Green adoption is a
  commit on `realism/soil-edges`, the owner's call. (2) A recipe with
  rounded fragments gives few angular blocks. (3) Blocks take one rock
  color; no fresh break face.
- Page (private): https://claude.ai/artifact/LMov1KXL2dBW49fqd4K1pH

**Stage 2, one bed model [built on `realism/one-bed` by a Sonnet agent, 2026-11-10 to 11; landed 2026-11-11 on the owner's "One bed model: land it"].**
Reviewed by Claude from its own renders (page, private:
https://claude.ai/artifact/9mbveQn7284r2KrfnmR64J). Known defects the
owner saw before landing, still open: Crystal's shallows get a hard
jagged step with dark outlines; Zhon gets dark halos round its islands;
red-3's rock under water is much darker than the pale shelf outside it;
`bedRelief` moves under 5% of the shallows on Green and Archipelago
(rule 9); the depth tint switches on whole at any hard step above 0.
After merging main `1583c995`: land tier passes but for the save
Worker's timing test under load (passes alone, 183 of 183); 31 of 34
scenes differ, 23 of them by 0.1% or more, heights identical; export bytes same on all three maps, red-16
at 50,166 tiles and about 100 s against 78 s on main (one run each).
The owner agreed to remove the noise water, the cracked bed, the lit bed
bumps, the bed dots and the bed grain.

- *Built.* The bed under water is always the lit bed: `bedLit`, the stroke
  option Shallow water look (`waterBed`, mask planes 11 and 13, the bake's
  cracked-bed crack cut), `crackedStep`, `shoalBump`, `shoalBumpPx`,
  `bedDots`, `bedDotCell` and `shoalGrain` are gone from the shader,
  uniforms, knobs, schema, scene fields, UI, gpu planes, `sculpt.py`, scene
  JSON and tests. `bedRelief` is the one control for the bed's lumps: three
  scales (9, 19, 41 px), added after the silt burial, defaulting to 1 for every
  world (Red 2.2, Green .6, Archipelago 2). The chunk renderer's relief
  reach still counts it: dropping it moved Green's dry pictures. Under a hard step the tint
  deepens toward the deep colour with depth (a constant, 30% at the step).
- *Found.* Lumps never reached Red's lake interior: `surfaceHeight` returned
  the bare height below -12, so the solid the sun lights had no relief there.
  The draw now reads the baked relief at any depth. The tint and the step
  read the authored bed depth, so art lumps do not move the water's colour.
- *Soft ground [measured by looking].* The land pipeline's colour below the
  sea is the world's cover: grass and moss on Green and modern Green, with
  grey rock flecks; sand with a dark grey mottle on Archipelago. Using it
  would put grass under lakes, so the soft bed stays the world's bare ground
  (`levelGround`) under the pipeline's own shading (sun, cavity, cast shadow),
  and the voxel rock keeps the pipeline's colour (`rockBedShare`). No change.
- *Measured.* Heights of all 34 scenes byte-identical to the base. Scenes
  moved (of the quick tier): see the commit messages; the largest are
  crystal-2 24.5%, red-3 22.3%, red-2 15.1%, zhon 10 to 14%. Land tier
  passes. Tiles: green-4 2,325 (2,325 before), lava-8 14,498 (14,442), red-16
  50,166 (50,094). Bed lumps over 5% of the shallows class: Red passes (2.2 to
  1 moves 12.8, 8.3, 2.7%; 2.2 to 0 moves 38.3, 23.8, 12.4%); Green and
  Archipelago stay under (under 1%): their bed light is damped by
  `bedContrast` .45 and `shadeDepth` .3.
- *Left alone.* The step and its outline, `bedFlat`, the tint controls, the
  waterline, foam, the Shore option, Rock at shores. `crackedStep` went
  because only the cracked bed read it.

**Overnight run, item 3: material edges [Claude, 2026-11-11; landed on
the owner's "material edges with frayed edges look good, land it"].** Rows
3 and 6 of round 4, and the owner's concern that sand at cliff feet
greens over.

- *Bare soil where cover thins* (world control, Vegetation, 0 to 1,
  default 0). Where grass meets rock the cover ends at a ragged line
  (two sizes of noise) instead of a blend, and a seam of bare earth
  shows just outside it, on the ground and off the faces. At 1: 6.0% of
  the mesa fixture's picture (4.5% at 0.6), 3.8% of the stock Plateau,
  2.4% of the stock Mountain; `measure/world_controls.mjs` 1.9% of
  green-1's whole picture **[measured]**. Subtle by eye.
- *Sandy debris holds.* Debris regrowth reads the debris's sand share:
  sandy debris resists regrowth up to three times as long. No control.
  Modern Green's mesa fixture moves 7.0% and its stock Mountain 10.0%;
  tan pixels on the mesa 3.43% to 4.29% **[measured]**. Classic Green
  lays no debris, so it should not move: to be confirmed by the land
  tier.
- *Modern Green adopts* Bare soil 0.7 and Boulders 0.5, in its own
  commit. With the sand change: 24.0% of the modern mesa fixture and
  22.4% of the stock Mountain; exported heights identical **[measured]**.
- *Open.* (1) The Mountain's apron may now be too continuous a tan band
  (by eye). (2) Both new controls' whole-picture shares are under 5% on
  the check windows. (3) The realism report was not rerun: the three
  modern Green scenes' heights are identical to main's.
- *Frayed edges* **[the owner: "some additional variability or pixel
  fray would be good so it seems less floaty above the grass"]**. With
  Bare soil above 0 the line between cover and rock is jittered per art
  pixel, on the ground and on faces; the earth seam is laid per pixel
  and comes and goes along an edge (53 and 17 px); sandy debris' hold
  against regrowth is jittered per pixel. Mesa 6.1%, stock Plateau 3.7%,
  sand kept alone 7.2% and 10.2% **[measured]**. Bare soil at 0.05 moves
  0.8% of the wet fixture: no step.
- *Checks at landing* (with item 4, on main `d508f29a`): land tier,
  only the three modern Green scenes move (7.9%, 15.7%, 8.0%), heights
  identical; export bytes same on all three maps; the features check
  passes on a fresh browser port (see item 4). Sweeps over every world: Bare
  soil 0.1% to 2.3% of the whole check picture, under 5% everywhere.
- Page (private): https://claude.ai/artifact/DMV5TKvvA37ufvmT2qz81g

**Overnight run, item 4: wetness [Claude, 2026-11-11; the owner: "keep
going with wetness and light", then "Wet ground: land it"].** Landed
with item 3.

- *Wet ground* (world control, Vegetation group, 0 to 1, default 0 in
  every world). Where water lies the ground is wet: the first 2.6 units
  above a waterline, hollows and channel floors the Time pass wets, the
  runoff rock weather traces. A wet patch ends at a ragged drying front.
  Wet, bare ground loses up to 45% of its brightness and gains
  saturation, living cover a third of that, and the shine term's water
  film covers it. Applied after every material layer; art only.
- *Measured.* At 0 the wet fixture is main's (0 pixels, color and
  clay), and the quick tier moves 0 of 34 scenes. At 1: 8.3% of the
  modern Green fixture (mesa, lake, river), 7.8% of the Red fixture, 5.1%
  classic Green, 3.1% Desert. `measure/world_controls.mjs`: 2.0% of
  green-1, 4.3% of red-1, 2 pixels of desert-1 (no water, no runoff).
- *By eye.* Wet rims on river bars and dark seeps down gullies read
  clearly on modern Green; at a lake's rock shore it is a thin dark
  line. The film's gloss is hard to see top-down.
- *Open.* (1) No world adopts it. (2) The world's old damp band
  (`wetBand`, a 17% tone up to 13 units above the water on Green) still
  draws under it; the two could be one. (3) Rock's own Wetness is a rock
  recipe's number; one Wetness for ground and rock would be simpler.
  (4) Sweeps over every world: 0.0% to 4.3% of the whole check picture
  (Red 4.3%, Green and Zhon 2.0%), under 5% everywhere; at 0.05 it moves
  1.3% of the wet fixture, at 1 8.3%. (5) `repro/features.mjs` failed at
  its line 147 on this branch and on main `d508f29a` alike while run on
  CDP port 9681, which `repro/perf.mjs` had used just before; on a fresh
  port (9711) it passes on the landed main `601c88d5`. Stale browser
  state on the port, not the code: give each Chrome check a port no
  other check has used.
- *Perf at landing* (`repro/perf.mjs map4`, alternating builds, a
  warm-up discarded). Walls and boulders, green-modern-2, three runs
  each: load to final 2009, 2182, 2155 ms before and 2107, 2083, 2132
  after; drag latency p50 28.5, 28.9, 31.6 against 29.4, 35.1, 29.0. The
  bed, edges and wetness, red-2, two clean runs each (a third was
  disturbed on both builds): load to final 1219, 1312 before and 1269,
  1328 after; drag latency p50 24.4, 25.7 against 25.1, 25.9; chunk
  paints a second 56.4, 52.7 against 55.6, 54.1. No difference beyond
  the runs' own spread. The red-16 export took about 78 s before the
  bed and 86 to 102 s after (single runs on a loaded machine).
- Page (private): https://claude.ai/artifact/V3kFA7sJ7im78yfCTv2AKP

**Overnight run, item 5: light [Claude, 2026-11-11; tried, dropped on the
owner's "let's drop the light branch"].** A world control moved the
shade multiply from the display-encoded colour to linear light, and Red
adopted it. The premise was wrong: with a power-law encoding, shade
applied in linear light at matched depth is today's picture exactly, so
the control only offered a lighter shade curve, which Ambient light and
Directional shading kept already give. Measured on the Red fixture
(luma: mean, darkest fifth): main 56.7, 28.7; linear light at ambient
.42: 59.7, 37.7; at ambient .10: 58.4, 33.4. Every shade strength was
tuned by eye against the display-space multiply, so all of them lifted
at once. The branch `realism/light` is deleted; nothing of it is on
main. Do not rebuild it.

**Bed defects, Red's rock, Green's bed lumps [Claude, 2026-11-11; the
owner: "continue with Crystal and zhon bed defects, red rocks color and
joints, and then bed lumps on green"; landed together 2026-11-11 on the
owner's "1. Keep and accept the re-roll 2. This is fine. Land it and
restart 8801"].**

- *Rock under water is lit as the bed round it* (`realism/bed-defects`).
  Crystal's outline and Zhon's rings were two terms together, found by
  single-term prototypes: the soft bed took the land's broad shade (the
  slope, its cast shadow, its occlusion), and submerged rock kept the
  land's whole shade besides, measured against the level ground's
  brightness with a dark side six times deeper than the soft bed's. Now
  the bed's light is its brightness against its own material's (the
  rock's own colour for rock), rock and soft ground share one dark side,
  and `bedFlat` reaches the rock (its joints, crevices and close shadows
  stay). Crystal and Zhon take `bedFlat` .8. Measured (share of each
  check picture, heights identical in all 34): engine alone red-3 15.2%,
  green-modern-3 2.1%, crystal-2 1.9%, zhon-1 1.6%, red-2 0.03%; with
  the adoption crystal-2 14.0%, zhon-2 9.4%, zhon-1 9.3%, zhon-3 5.9%,
  crystal-1 4.8%, crystal-3 3.7%. By eye: the outline is gone but for
  two short lines at the top of crystal-2; the rings are gone but for a
  thin dark waterline; red-3's platform is as pale as its shelf with
  fainter joints, as in the owner's picture of a cracked Red shore;
  Zhon's coast variant keeps its look.
- *Red's rock* (`realism/red-rock`). Measured on the owner's picture:
  rock mean RGB (78,43,35) to (85,46,37), hue 10 to 11 degrees, median
  luma 51 to 58; ours (71,38,40) hue 356 at red-3's shore and (76,39,36)
  hue 5 on red-1's mesa. Rendered without the palette step the rock is
  hue 12: the game's palette has no dark orange-brown, retail art mixes
  maroon and olive pixels for it, and the rock's damped hue grain landed
  on the maroon entries. Only numbers of Red's recipe (Jointed
  siltstone) change: Color variation between blocks .12 to .5, crust
  lightness .2 to .35, crust oxidation .15 to .3, wetness .2 to 0, joint
  opening width 3 to 1.5, joint depth 3 to 2. (Shadow and crevice depth
  went to .55 with them at first and came back to .7: alone it changes
  0.8 to 2.8% of Red's pixels and none of these measures.) After:
  (81,44,38) hue 9, median 51.5 at the shore; (88,48,40) hue 10, median
  61 on the mesa. Moves red-1 9.3%, red-2 7.4%, red-3 21.0% on top of
  the bed change; no other world. On red-2, the owner-approved lakes:
  4.4% of the lake's interior pixels move (rock on the lumps' flanks; no
  change by eye), and the terrace rings round the lake keep 11.2% dark
  pixels (luma under 40) against 12.5%, which no single number of the
  recipe accounts for (the owner: "This is fine"). Open, by eye: lit faces carry a few olive-yellow
  pixels, Color variation sits at its slider's maximum, and the rock
  within a few units of the water is still bluer than the rest (the
  waterline's blend). Tried and not used: Mix palette pairs (rock hue 5,
  but it flattens the ground), more land dither (no gain).
- *Green's bed lumps* (`realism/green-bed-lumps`). Under 1% of the
  shallows before (rule 9). Only Green's numbers change: `bedFlat` .4 to
  1 (the bed's own light is not scaled by the world's directional share
  of .3), `bedContrast` .45 to .7, `bedRelief` .6 to 2. Measured: Bed
  lumps 0 to 3 moves 5.8% of green-3's shallows and 8.8% of
  green-modern-3's (pixels moving more than 8 levels);
  `measure/world_controls.mjs` on green-1: Bed lumps 19,543 px, Bed lit
  by its own relief 34,170, Bed light 71,703. Moves green-7 9.9%,
  green-modern-1 4.4%, green-modern-3 4.3%, green-3 3.5%, green-1 3.5%.
  Open: teal palette pixels in the shallows grow (green-3 0.6% to 1.0%
  of the water, green-modern-3 2.1% to 3.3%, green-modern-1 2.5% to
  5.1%). Not tuned: Archipelago's lumps, still under 5%.
- *Open: the relief allowance counts Bed lumps.* The chunk renderer's
  projection apron (`reaches()`) adds 1.6 x `bedRelief`, though lumps
  lie under the water plane, and the pictures are sensitive to the
  apron: with Green's lumps at 2, dry Green scenes re-roll pixels on
  steep faces (green-2 10.0%, mean luma 62.867 to 62.869, no change by
  eye; green-5 1.3%, green-4 1.0%, green-6 0.4%). No value is free:
  green-2 moves 6.7% at .8, 8.2% at 1, 9.5% at 1.5. This is the coupling
  removed for Boulders. Offered: lumps at 2 with the re-roll; drop the
  term from the allowance (every world re-rolls once, and the control
  never touches dry ground again); or leave Green's lumps at .6. The
  owner: "Keep and accept the re-roll". Why a picture depends on the
  apron at all is not found.
- *Checks at landing* (2026-11-11, final tip, a quiet machine). The
  land tier passes (unit, gate, scenes, regional, voxels, smoke,
  features, passability, shape repeat; own server, CDP port 9771); 28 of
  34 scenes differ from main `6c58fb9f`, heights identical in all.
  Export bytes: exit 0, same on all three maps (green-4 2,325 tiles in
  3.1 s, lava-8 14,498 in 20.7 s, red-16 50,099 in 89.3 s; main had
  50,166 in 86 to 102 s). The three items were checked and landed
  together, with the previews regenerated for all three.
- *Perf at landing* (`repro/perf.mjs map4`, green-modern-3, alternating
  builds, a warm-up discarded, three runs each). Load to final 1564,
  1576, 1597 ms on main and 1668, 1775, 1623 on the tip (about 7%
  slower); release to final 1320, 1306, 1315 against 1361, 1357, 1347
  (3%); drag latency p50 26.1, 26.1, 25.7 against 26.7, 25.8, 26.6;
  chunk paints a second 53.2, 54.0, 53.4 against 53.3, 53.4, 52.7. The
  drag is unchanged; a load costs a little more (Green's larger apron
  and the rock's bed light). An earlier run under another agent's
  sweeps showed both builds at seven times these numbers and is void.
- Not run: `measure/realism.py` (heights identical), the geology sweep.
- Page (private): https://claude.ai/artifact/6rEmDd2kPD3MAnYNwHjiZG

**Round 5: what is still missing, from both sets of pictures [Claude,
2026-11-11; the owner: "re-evaluate from our hyper-realistic reference
images and decide what items in priority order are still missing", and
"go back to the TA biome reference images and determine if anything in
them cannot be represented properly in our current engine"].** By eye
unless marked. The nine hyper-real pictures against 21 fixtures rendered
from main `010c0579` (the 760 px mesa with every wall option, the
Mountain button with them, boulders, sand, wet ground, nine recipes with
whole blocks on modern Green, sandstone on modern Desert). The retail
windows against the 30 check scenes of the same commit, surveyed by a
separate agent that was not told what the engine can do, and checked by
Claude on one pair of each world. Ordered by how much of a picture each
spoils and in how many pictures, the shape before the color, under the
owner's rules (level ground flat in the heights; flats that tile).

| | What is missing | Hyper-real pictures | Retail windows | What the engine does today | Kind |
| --- | --- | --- | --- | --- | --- |
| 1 | The sun's height as a world's own number, and a shadow that reaches level ground | all nine are lit low and raking, with long shadows and dark ravines | Green's steep faces go to black (pixels under luma 20: 16.0% of green-4 against 3.1%, the agent's measure; 98% of them lie on cells steeper than 0.3, so they are shaded faces, not shadows on the plain **[measured]**); hills are modeled by one broad shade band in six worlds | the sun stands 45 degrees up in every world; only the page's review parameter turns it, and exports ignore that. Tried: 25 degrees on the modern Green wall moves 60.9% of the picture and fills the ravines; behind a ridge at 25 degrees Cast shadow on level ground at 1 moves 4.9% and darkens about 30 px of grass faintly, where the ridge's height calls for about 200 **[measured; the length by eye]**. Unlike the dropped linear-light branch this changes the light's direction, not the shade curve, and at 45 degrees no picture moves | a missing control; the shadow's reach is engine work (a wider apron, so perf and a re-roll) |
| 2 | Rock by stroke: how much, and which recipe | a map with more than one kind of geology | Red's smooth hills beside a cracked shelf of 15 to 25 px cells; Crystal's 30 to 70 px plates beside a fine mesh; Green's soft domes with small outcrops beside cliffs | one recipe for a world, on every face. Tried on red-1's two hills: Cracks 0, Smooth route 100 and Local vegetation 100 each leave the jointed blocks on the faces (Smooth route clears the top only); Soft bank is for water strokes; the hills go smooth only with rock off for the whole world | missing |
| 3 | Color: a color family for each recipe, first; then shade that keeps the world's hue, and no stray palette entries | `sandstone`, `sand5`, `rocky`: each rock its own family, bands that follow the beds | shade goes neutral where retail keeps the hue (Ice gray for blue and lilac, Lava olive-black for maroon-black; the agent's measure) | a recipe has beds and no colors, and a world has one picked rock color, so all nine recipes draw the same gray on modern Green; modern Desert's wall is a dither of pink, olive and gray with striped patches (as on 2026-11-10: not a regression); four palette entries retail never uses make 10.1% of moon-1, 1.9% of archipelago-2 and 1.2% of ice-1 **[measured]**; Red's maroon was the palette too (fixed by hand in its recipe) | recipe colors missing; the rest defects |
| 4 | Level ground with a surface, in the art only and in tiles that repeat | tone and cover changing over 50 to 300 px: dust, wash lines, stones thinning from a wall (round 4, row 3) | Desert's ring stones (20 to 25 in a 256 px square, the agent's count in one crop); Crystal's half-buried slabs; Moon's wrinkles and small craters every 40 to 80 px | a plain is one texture; stones lie near walls only; Wet ground reaches the waterline only | missing |
| 5 | Drainage that branches and joins | the top-down picture, `surface1`, `rocktools` (third panel) (round 4, row 6) | Archipelago's domes carry 5 to 10 creases from the crest, in the heights | gullies run side by side down the fall line; a dome's contours are ovals (the Archipelago scenes do not use Gullies: not tried) | missing, in the heights |
| 6 | Fine lines in regular bundles | thin continuous beds (`surface1`, `surface3`, `sandstone`) | contour lines every 5 to 8 px on Green's slopes, Red's bank terraces, Moon's ridges, Desert's 10 to 15 clean bands | lines break into scribbles and stairs; thin-bedded recipes (shale, schist) dissolve into noise at 1x; Desert's bands lie under black joint lines and blotches of bed color | defects in what exists |
| 7 | Sand as a sheet: drifts and dunes with ripples that vary, ledges buried, a beach | `sand5`, the beach picture (round 4, row 4) | Zhon's smooth sand bars with ripple lines | patches with even ripples; shelter in a wall's lee since round 4 | missing |
| 8 | Tall landforms on the classic worlds | the pictures' walls are 150 units and more | none are this tall | the 244-unit mesa on classic Desert draws maroon and near black (mean RGB 51,35,31), as round 3 found on Moon, Lava and Red | defect |
| 9 | Water zones that do not follow depth | the top-down picture's damp basins | Zhon's maroon and olive zones in one river; mottled shoals | one ramp of color by depth through a third color at most. Not tried: Zhon's zones may be that ramp and the strokes (the check scenes run the river variant, and the coast variant has teal deeps); Ice's submerged shelf and Archipelago's halo are depth bands a Shallow stroke gives | perhaps missing; rank after a trial |
| 10 | Green's shore | the beach picture's clean waterline | a smooth coast | 1.25 to 1.28 times its smoothed length against retail's 1.06 to 1.08, with 39 to 141 detached specks of water against 11 to 24 (the agent's measure). The stepped waterline (2 px) and the scene's undulation are settings taken from retail earlier; not tried at 0 | a setting until tried |

- *Representable today, so not engine work* (a preset or a scene's
  strokes; retail tuning stays parked, rule 10). Tried: a hill as a soft
  tone-shaded dome instead of a ring of cracks (green-1 and red-1 with
  rock and cracks off), though its shade stays shallower than retail's
  until row 1. Not tried, from knowing the controls: Zhon's teal water
  and green cover (table colors), Ice's shade hue (data), mountains as
  sloping massifs (the Mountain tool), Archipelago's fringe as fine arcs,
  Crystal's mounds as one cracked surface, Lava's lobed hills, Moon's
  soft shade.
- *Closed since round 4.* Rows 1 and 1a (a hierarchy of blocks; the
  lattice), 2 and 7 (beds and variation along a wall), 5 (boulders), and
  part of 3 and 4 (bare soil, wet ground, sand in a wall's lee). In clay
  the nine recipes now differ as the pictures' rocks do; the color pass
  hides it (rows 1 and 3).
- *How sure.* Rows 1 and 2 were tried here and the palette entries
  measured. Rows 4, 5, 7 and 9 are "missing" from knowing the engine,
  not from a failed attempt. The agent's numbers were checked only for the
  palette entries. Retail scenes are a few strokes each, so shape
  differences there are mostly the strokes and are not counted.

**Round 5, the owner's rulings and the first landing [owner decisions,
2026-11-11; landed on local main the same day].** On the ten rows: 1 "Add a
control and have it update the shadows"; 2 "a biome defining multiple rock
presets, and a stroke chooses a preset", edits to a preset reach every
stroke that uses it, and "an easy way to copy recipes"; 3 every preset "can
have its own colors, shape, style, vegetation"; 4 prototypes welcome but
"tileable and within the 65K tile limit", after the rest; 5 "if it's cheap
enough and the result looks good"; 6 "Fix it, make sure it's
configurable"; 7 "a whole sand system", lower priority; 8 "Fix it"; 9 and
10 not now. Claude orchestrates Opus agents, reviews and lands.

- *Sun height (row 1) [landed].* `sunHeight`, Lighting, 20 to 75 degrees.
  Each world's default is the height its fixed light had (45.2, Desert
  47.8, Moon 48.7), so the uniforms are the same to the bit. Exports and the
  generated features read it; `?sun=` keeps only its azimuth. The cast
  shadow's march goes on past its twelfth sample (203.6 px) while a sample
  tests under 240 units above the pixel, reading the authored height, in
  steps 6 units apart; only the height grid's apron grows, and at a
  world's own sun there are no new samples. A cast shadow takes the whole
  direct sun (it took 32% of it, a constant with no reason given), so at
  25 degrees shadowed grass reads luma 31-34 against 74 in the open (was
  58-62) **[measured by the agent on the north-south ridge fixture]**.
  Below 20 degrees the grid a chunk needs passes the 128 MB budget, and
  relief more than 200-240 units above the ground it shades has its shadow
  cut short.
- *Why pictures depended on the apron [found and fixed].* The voxel rays
  started at the relief allowance (`vs.high + 40`), which every relief
  term moves, and the march can step past thin rock, so another start
  found another face. They now start from the authored maximum plus 104.
  One-time re-roll: green-2 7.9%, green-5 1.0%, green-4 0.8%, the rest
  0.3% or less; the same rock by eye **[measured by the agent; green-2
  looked at by Claude]**. This closes the open item of the last landing:
  a term that only moves the allowance now moves no pixel.
- *The palette lookup [landed].* Slots 0-9 and 246-254 of the game's
  palette are Windows' static colours; the lookup drew with four of them
  and the 30 retail windows use none (slot 255, white, they do, and it
  stays). Moon moves 8.0-9.8%, Archipelago 0.9-2.0%, the rest under 1%
  **[measured]**; the Moon plain's tone is unchanged by eye.
- *Tall landforms near black (row 8) [not an engine defect; proposals
  only].* One shading term at a time on a 244-unit mesa **[measured by
  the agent, palette off]**: no single term is the cause. Lava's rock is
  near black before any light (luma 24-26). Moon's faces turned from the
  sun get its ambient of .25 and no fill. Desert's maroon wall came from
  the round-5 fixture's own one-bed column: with Desert's own column the
  wall is tan (luma 69.5), though its darkest fifth sits on the palette
  subset's floor of 31, which has no dark maroon. Red is readable. Open
  for the owner: Moon faceFill .35 (moves 4.6% of moon-1), five dark
  maroons added to Desert's palette entries (0.16% of desert-1), and fill
  light keyed on the light that reaches a face (a sun-facing face inside
  a cast shadow gets neither sun nor fill today).
- *Branching drainage (row 5) [tried, not landed].* Branch
  `realism/drainage`, one prototype commit: a Branching option beside
  Gully size. Real Y junctions read in a heights-only map but leave pits
  and seams where fall lines converge (domes, bends); the seamless version
  only crowds gullies together. On a rock wall the block relief hides
  either. With rock relief at 0 the same wall reads as smooth spurs and
  shadowed ravines, so drainage is worth a second look once a stroke can
  pick a smooth preset.
- *Checks at this landing.* On the merged tip: the land tier passes
  (CDP 9771; 34 of 34 scenes move: moon 8.1-9.8%, green-2 8.1%, green-4
  7.2%, crystal-2 4.7%, archipelago 1.0-2.1%, the rest 1.6% or less);
  `repro/export-bytes.mjs` exit 0, the same bytes on the three maps
  (green-4 2,325 tiles, lava-8 14,498, red-16 50,102; the agent's counts
  at 25 degrees with Cast shadow on level ground 1: 2,400, 14,963 and
  50,593). `repro/perf.mjs` map4 on green-modern-3, alternating main and
  the tip with other agents on the GPU (load average 6 to 10, so only the
  calmest pair is worth reading): load to final 1820 ms main, 1744 tip;
  release to final 1310 and 1430; drag latency p50 36 and 28 ms **[measured
  under load; a quiet run is owed]**. Hover previews regenerated.

- *Rock recipes in a table (rows 2 and 3, step B1) [landed 2026-11-11,
  no picture changes].* The 72 rock numbers are `struct Rock`, held 16
  times in the uniforms, and every point reads the slot its rock belongs
  to (`useRock`, mask plane 20 holds slot + 1). Slot 0 is the world's
  flat rock numbers, so every address, save, scene and tool means what it
  did. With slot 0 alone every read compiles to a fixed offset and every
  rock test stays a pipeline gate (`rockMask` 0): 0 of 34 scenes move.
  Passes that gather take the source's recipe; aprons and switches take
  the maximum over the rocks in use; the Time pass keeps slot 0's beds
  (per-recipe hardness is not built). Nothing in the page sets a second
  slot yet. *Accepted:* when a map first uses a second rock the pipelines
  that read any slot compile differently, and 6.7% of green-modern-2's
  pixels step by a palette entry where everything is still slot 0
  (heights identical, the same by eye, the same bytes every time)
  **[measured by the agent, `repro/rock-slots.mjs`]**; the mechanism in
  Metal's compile was not found. A hand-painted half of basalt beside
  granite changes nothing more than 105 px past the line **[measured]**.
  *Checks:* land tier passes on the tip merged with main (`features`
  needed a fresh browser profile, the known flake); export bytes exit 0
  **[agent]**; `repro/perf.mjs` map4 on green-modern-3, alternating, load
  average 6 to 7: load to final 1535/1579/1522 ms main, 1557/1840/1673
  tip (the first chunk's encode holds an 80 ms compile in two of three
  runs); release to final 1349/1532/1310 and 1324/1490/1322; drag latency
  p50 25.7/27.3/25.7 and 26.4/27.4/26.2 **[measured]**.
- *Sun height, the owed timing [measured on a quieter machine, load
  average 4 to 6].* 010c0579 against the landing: load to final
  1686/1548/1666 ms and 1531/1521/1674; release 1313/1333/1306 and
  1315/1314/1326; drag latency p50 26.0/25.7/25.3 and 25.1/26.0/25.6.
  At Sun height 25 with Cast shadow on level ground 1: load 1523 and
  1505, release 1304 and 1315.

- *Desert's plain repeats with its pool [landed 2026-11-11; found by the
  ground-material design agent, cause and fix by Claude].* The gate that
  says where a world's beds begin read the bed coordinate, whose tilt and
  wander are world-space noise, so the first bed's colour crossed onto the
  plain in patches that do not repeat. It now reads the height above the
  column's origin; the beds themselves still wander. A bare plain, a
  2048-px window, classic and modern Desert: pixels unlike the pixel one
  period (1024 px) away 0.50-0.82% to 0; tiles equal to the tile one
  period down 84.4% to 100%; distinct tiles 839 to 210 **[measured]**.
  desert-1..3 move 4.0-4.9% (the rose patches on the plain go; feet and
  walls the same **[by eye]**); 31 scenes identical. Land tier passes,
  export bytes exit 0 (the same three hashes).
- *Level ground that does not repeat yet [measured, not fixed; the owner's
  rule is tileable flats].* On a level cap 80 units up, tile pairs one
  period apart that are equal: Desert 20% (the wandering beds colour the
  cap; 100% with Bed strength 0), Red 30%, Lava 0% (their relief on the
  cap differs too: 11% and 0% in the clay view). Modern Green's plain on
  an 8x8 map: 16,384 distinct tiles of 16,384, with 9.3% of pixels unlike
  the pixel 2048 px away; cause not isolated. The eight classic worlds'
  base plains repeat exactly. An 8x8 map holds 17,028 tiles, so this bites
  only above that size.

- *Rock presets, the artist's model (rows 2 and 3, B2) [landed 2026-11-11;
  built by an Opus agent, reviewed and checked by Claude].* A map holds
  the world's own rock (slot 0) and up to 15 presets, each a name, rock
  numbers and beds. Every world ships Smooth soil (the world's rock with
  Rock relief, its share of steep faces, debris, runoff and soil terraces
  at 0, ledges grass: red-1's clay high-pass 1.56 to 0.69 **[measured by
  the agent]**); modern Green also lists Jointed basalt and Pitted
  limestone, modern Desert Thin shale and Conglomerate. A landform's Rock
  option chooses one (Rock beneath, the default, claims nothing); the shape
  claims mask plane 20 wherever it moves the ground, with its talus and
  shore fingers, so the later shape wins; Erase clears the claim all or
  nothing. The World pane's Rock & cliffs has the list with Add from a
  starting recipe, Duplicate, Rename, Delete (its shapes go to Rock
  beneath in the same undo step) and Copy/Paste recipe as JSON. Editing a
  preset uploads the table and re-bakes; the shape is not evaluated again.
  Saves, undo, scenes, share links and export carry it; an old save loads
  as before. The contact between two rocks is read through 4 px of noise,
  with no blend; it does not read as a seam **[by eye, agent and
  Claude]**. *Checks on the tip merged with main:* land tier passes, 0 of
  34 scenes changed; `repro/rock-slots.mjs`,
  `repro/rock-presets-scene.mjs` (an edited preset moved 6.8% of its
  window and no pixel farther than 125 px from cells it claims; the same
  export twice) and `repro/rock-presets-ui.mjs` (Chrome: add, pick, edit,
  undo, redo, save and load, copy and paste, delete) exit 0; export bytes
  exit 0 with the same tile counts. `repro/perf.mjs` map4 on
  green-modern-3, alternating, load average 4 to 5 (another agent
  rendering): load to final 1729/2316/2382 ms main and 2322/2414/2211
  tip; release 2076/1975/1763 and 2155/1955/1866; drag latency p50
  41.7/45.8/36.8 and 41.6/48.2/38.8: no change outside the noise
  **[measured under load]**. *Not landed, for the owner:* the Hill button
  choosing Smooth soil (branch `realism/rock-presets`, 13cf404c): green-5
  moves 21%, any map with a hill then runs the general pipelines, and the
  button names slot 1 by number. *Open:* colors per preset (B3; Thin
  shale's first bed paints a gray band at a Desert foot), per-recipe
  hardness in the Time pass, a hover picture for the Rock option.

- *A rock preset's own colors (row 3, B3) [landed 2026-11-11; built by
  an Opus agent, reviewed and checked by Claude].* The rock color and the
  five bed-slot colors moved into the recipe table (`rockColors`, eight
  rows a slot; rows 6 and 7 are free for the light through a rock the
  owner approved prototyping next). A preset carries `colors` (null: the
  world's) and a stable `key` (its starting recipe's, for a world's shape
  tools to name it by); the World pane shows a Rock color and five bed
  colors with the palette entry each draws as. The ten starting recipes
  have colors on one ramp of the game's palette each. Debris fines take
  their source rock's tint. A preset's beds start no lower than the
  world's second section (`bedsFrom`), so they no longer paint the plain
  at a stroke's foot; the tiles away from the stroke still repeat
  **[measured by the agent: 928 of 928]**. *Checks on the tip:* land tier
  passes, 0 of 34 scenes changed; the three rock checks exit 0 (a recolor
  moved 26.5% of its window and no pixel outside the preset's reach);
  export bytes exit 0, the same tile counts; no hover preview moved.
  `repro/perf.mjs` map4 on green-modern-3, two alternating sets with the
  order swapped, load average 4 to 8: whichever build ran first in a pair
  read slower (drag latency p50 31-36 ms against 25-27), and in the
  quietest pair main and the tip read load to final 1611 and 1544 ms,
  release 1299 and 1378, drag latency p50 24.7 and 25.4: no change outside
  the noise **[measured under load]**. *Open, the owner's eye:* on Desert
  the recipes read poorly (shale and conglomerate both olive-khaki,
  sandstone rose and mustard): Desert draws with 52 palette entries, with
  no dark blue-gray and no single tan ramp (its own tan is a dither of
  rose and ochre). Either Desert's presets keep the world's colors or tan
  beds may mix two ramps. Recipes carry no Strata, so a preset's bed
  colors show only where Strata is above 0 (never on modern Green).
- *Rule 8 [owner decision, 2026-11-11].* Every biome defines its own shape
  tools (an icon and landform defaults, the rock preset among them); a
  biome without a matching shape shows a stroke as the generic landform
  tool; an artist can save a new tool from the selected shape. The
  toolbar's shape buttons are therefore built from data, the one exception
  to layout in the markup (AGENTS.md).

- *Thin beds as fine lines (row 6) [landed 2026-11-11; built by an Opus
  agent, reviewed and checked by Claude].* The owner: "Fix it, make sure
  it's configurable." The cause was three sizes under what a face can
  draw: beds thinner than 2 px on their slope, blocks 1.8 units tall
  (Thin shale) and fine layers closer than the voxel step, each aliasing
  into rows of dashes. Now a bed whose drawn size, t(1 + 2/slope) height
  units, is under 4 is gathered with its section's other thin beds
  (`columnGather`) and their lost ledges are drawn as fine regular layers
  6 units apart (`voxelFine`); blocks are never under 3.5 units tall; the
  fine layers run on across whole blocks, cut only by joints; Layer tint
  shades them. No new control: Fine layer spacing is now true height
  units, 6 to 16 (it had a dead range under 6), Fine layer relief and
  Variation between repeated beds do visibly more, and four layered
  recipes (shale, schist, sandstone, gneiss) have new numbers. A finite
  rock number outside its control's range now loads at the range's end
  (`copyRockSettings`), so maps saved with spacing 3 open. *Checks on the
  tip:* land tier passes; 6 of 34 scenes changed, all classic Green
  (green-4 2.98%, green-6 0.57%, the rest under 400 pixels; the hill keeps
  its blocks and contour lines by eye); export bytes and the four rock
  checks exit 0 (Block height moves 88.6% of the rock class, Fine layer
  relief 77.0%, Fine layer spacing 75.5%, **measured by the agent**); 22
  hover previews moved 0 to 4.3% and are regenerated. `repro/perf.mjs`
  map4, main and tip alternating under load (load average 5 to 13): the
  agent's tip took 19% longer to the final picture after a stroke on
  green-modern-3 (1987 and 2129 ms against 1673 and 1798); answering a
  thick bed before the gathering loop (Claude's commit, renders
  byte-identical, so the Chrome checks ran one commit early) brought it
  to 1385 against 1391 in the quietest pair, drag latency p50 26.0 and
  26.0 **[measured under load]**. *Open:* modern Desert's bands still sit
  under joint lines and blotches (a smaller gain there, by eye); sandstone
  and gneiss gain little at 1x.

- *Biome-defined shape tools, the plumbing (T1) [landed 2026-11-11; built
  by an Opus agent, reviewed and checked by Claude].* The owner: "let
  every biome define its own shapes", a stroke of a tool the new biome
  lacks becomes "a generic landform tool", and "there should be a way to
  define new tools from the currently selected shape." The shape library
  stays in code (`LANDFORM_SHAPES`); each world's table now holds its
  numbers for the shapes (`world.shapes`, the old `TOOL_PRESETS` moved
  verbatim: 20 configs by 21 entries by 9 presets hash the same) and its
  toolbar (`world.tools`: id, label, icon, color, group, shape, an
  optional rock preset key). Scenes name shapes, never tool ids. The page
  builds only the shape buttons; a fixed Landform button is first and
  Fissure ends the Shape group. A stroke names its tool (`node.tool`); one
  whose tool the toolbar lacks shows as Landform and keeps every number
  for good (`kept`), through later biome switches too. Save as tool
  (name, icon, color) adds a map tool that draws with the selected
  shape's settings, curves and rock; map tools live in the save, undo,
  share links and a scene's `tools`; Delete leaves the strokes alone.
  *Checks on the tip, merged with main:* land tier passes, 0 of 34 scenes
  changed; `repro/tools-ui.mjs` (new), workspace, curveedit,
  rock-presets-ui, site test and export bytes exit 0; one new hover
  picture (the Landform button's) and no other preview moved. The drag
  and bake path is untouched. *Open:* every world still ships the same
  thirteen tools (T2: each world's own list, Hill on Smooth soil by key,
  shown to the owner as a table first); hiding Tool preset options for a
  world without a shape is untested until a world lacks one;
  `repro/share.mjs` fails one check ("share, open, share again: same
  link") on main too, from `mapData.featureSet` normalizing on load;
  proposals not built: rename, reorder and edit a map tool, export a
  map's tools into world data, `tools-ui.mjs` in the land tier.

- *Translucent rock (row 3, B4) [landed 2026-11-12; built by an Opus
  agent, reviewed and checked by Claude].* The owner approved a
  prototype of about three numbers per rock recipe, then ruled on its
  pictures: "Yes on absorption and shadow tint as options", and for
  defaults "Probably some, but nowhere near 1. I'd want a subtle effect
  to start", then "0.2 for ice" and "keep the step at 0.05 and make the
  crystal default 0.1". Two rock numbers, 0 as before on every other
  world: **Color deepens with thickness** (`absorbDepth`: the rock's
  chord along the sun's line, read from the heights over 24 steps, moves
  the color toward the preset's Absorption color, row 6 of `rockColors`,
  or its own hue) and **Colored cast shadow** (`shadowTint`: a cast
  shadow lets part of the sun through in that hue, less the thicker the
  occluder). Light through thin rock was built and removed: under 1% of
  the picture at a world's own sun, since the faces it lights are turned
  from the camera. On Crystal and Ice the rock table draws only 2 to 7%
  of the look (the crystal color and the ground cover draw the rest), so
  both act as a filter on whatever drew the pixel a rock slot claims.
  *Checks on the tip:* with every default 0, land tier passes and 0 of
  34 scenes change; the rock checks, `rock-controls-gpu` and export bytes
  exit 0; no hover preview moved. With the defaults, land tier passes
  and 6 of 34 change: ice-1 17.8% of pixels (mean difference 2.5
  levels), ice-2 10.0%, ice-3 13.2%, crystal-1 7.2%, crystal-2 6.9%,
  crystal-3 3.2% **[measured]**; berg bodies and crystal masses a little
  deeper, plains unchanged by eye. The 5% rule **[measured by the
  agent]**: absorption moves 19.9% and 24.3% of crystal-1's and ice-1's
  windows at 1; the shadow moves 77.5% of the ice blocks' cast shadow on
  level ground at Sun height 25. `repro/perf.mjs` map4, alternating:
  opaque maps the same as main (drag latency p50, tip against main:
  ice-2 21.8 to 22.3 ms against 21.4 to 22.0, green-modern-3 26.5 against
  26.4); with the defaults, crystal-1 21.0 to 21.4 against 20.7 to 21.2
  and ice-2's quiet pair 22.2 against 20.9, with the final picture after
  a stroke at 855 ms against 826; later ice-2 pairs ran twice as slow on
  both builds while
  another agent used the GPU **[measured, partly under load]**. An
  absorbing slot costs 24 height reads a pixel in the draw; the bake is
  untouched. *Limits, stated in the help:* the filter tints grass on an
  absorbing rock's ledges (keeping vegetation out would take the effect
  from Ice and Crystal, whose tops count as cover); raised ground under a
  stroke counts as rock; the close voxel shadow is not tinted; at their
  own sun Ice and Crystal cast no shadow on level ground, so Colored
  cast shadow shows there only with Cast shadow on level ground.

**Next [proposed by Claude].** Fine relief on a block's faces; a longer
reach for large blocks if the owner wants them more whole (costs memory);
then rows 2 to 8.

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
