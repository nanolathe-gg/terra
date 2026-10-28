# Terrain editor backlog for outside agents

This is the work list for agents other than the Claude session that owns
the editor (Codex, OpenCode models). Read the ground rules, then do only
the card you were given. The editor is an experimental prototype: the
repository's Go gates (`tools/check`, `tools/check-retail`), the clean-room
research rules and the test policy in `AGENTS.md` do not apply under
`tools/map-editor/`. Do not run the Go gates.

The visual review behind the cards is Codex's of 2026-10-27:
`/Users/daniel/.codex/visualizations/2026/10/27/01a17fc7-8a8a-72c1-9e20-57d656f2087d/terrain-editor-review/`
(`index.html`, `review.txt`, `code-review/review.txt`, per-world images).
Its pictures predate the 2026-10-27 merge of the five reproduction
branches and the projection fix below, so re-render before judging.

## Ground rules (every card)

1. **Worktree.** Branch from `terrain-editor`, never from `main`, and never
   edit another worktree:

   ```
   cd /Users/daniel/src/nanolathe
   git worktree add ../nanolathe-wt-<card> -b <card> terrain-editor
   ```

2. **Your own server, browser port and assets** (table below). Copy the
   prepared assets once, then serve every world (a missing world silently
   renders as Green, so never pass `--biomes`):

   ```
   R=/private/tmp/nanolathe-map-editor
   mkdir -p $R/agent-<card> && cp -R $R/assets-* $R/agent-<card>/
   cd ../nanolathe-wt-<card>
   /private/tmp/nanolathe-neural-terrain-venv/bin/python tools/map-editor/sculpt.py \
     --port <server> --assets-root $R/agent-<card> > $R/agent-<card>/server.log 2>&1 &
   ```

   Restart your server after editing `sculpt.py` or any `sculpt_*.py`.
   Ports 8766-8812 belong to other sessions, and 8801 is the owner's: never
   use them and never stop a process you did not start. The system
   `python3` has no numpy; use the venv above.

   | Card | Server | Browser (CDP) | Out dir | Guard |
   | --- | --- | --- | --- | --- |
   | A | 8831 | 9631 | `$R/agent-A/out` | `--worlds none` |
   | B1 | 8832 | 9632 | `$R/agent-B1/out` | `--worlds ice,crystal` |
   | B2 | 8833 | 9633 | `$R/agent-B2/out` | `--worlds archipelago,green` |
   | B3 | 8834 | 9634 | `$R/agent-B3/out` | `--worlds moon,lava` |
   | B4 | 8835 | 9635 | `$R/agent-B4/out` | `--worlds red,desert,zhon` |
   | C0 | none | none | `$R/agent-C0` | none (no editor edits) |
   | C1 | 8836 | 9636 | `$R/agent-C1/out` | stage 1 `--worlds none` |
   | C2 | 8837 | 9637 | `$R/agent-C2/out` | each preset's world |
   | C3 | none | none | `$R/agent-C3` | none (`repro/stats.py` only) |
   | C4 | 8838 | 9638 | `$R/agent-C4/out` | `--worlds none` |
   | C5 | 8839 | 9639 | `$R/agent-C5/out` | `--worlds none` |

   Before the baseline, check that every world is really served (until
   card A lands, an unavailable world answers as Green):

   ```
   for w in green red archipelago moon zhon lava desert crystal ice; do
     curl -s "http://127.0.0.1:<server>/sculpt-config.json?biome=$w" | grep -o '"biomeId": *"[a-z]*"'; done
   ```

   Each line must name the world asked for.

3. **Baseline before any edit, guard after every change.** Retail crops are
   in `$R/repro-r7/<scene>`; renders are deterministic, so an untouched
   world must match its baseline exactly:

   ```
   cd tools/map-editor
   PY=/private/tmp/nanolathe-neural-terrain-venv/bin/python
   REPRO_CROPS=$R/repro-r7 sh repro/all.sh $R/agent-<card>/out/before http://127.0.0.1:<server> <cdp>
   # ...change something...
   REPRO_CROPS=$R/repro-r7 sh repro/all.sh $R/agent-<card>/out/after-<n> http://127.0.0.1:<server> <cdp>
   $PY repro/compare.py $R/agent-<card>/out/before $R/agent-<card>/out/after-<n> <guard from the table>
   $PY repro/triptych.py $R/agent-<card>/out/before $R/agent-<card>/out/after-<n> $R/agent-<card>/out/review-<n>
   ```

   `compare.py` must exit 0. Look at `review-<n>/<world>.png` (retail |
   before | after for each window) and each window's `layout.png` before
   you claim anything.

   One known false alarm: a new branch in shared shader code, even one
   that is never taken, can change how the GPU compiler orders float
   arithmetic, and the crack lattice is sensitive enough to move a few
   percent of pixels in other worlds (mean |diff| under 1; seen when the
   `faceStreak` branch was added to `cracks()` in `relief-bake.wgsl`). If
   the guard fails, temporarily replace each new condition with `false`
   and re-render the failing scenes. If they then match `before` exactly,
   the drift is the compiler's: restore the code and record both
   `compare.py` outputs in NOTES.md. If they still differ, your change
   leaks into that world; gate it.

   The retail picture is registered to the editor's projection by the
   window's plain height (`plain` in `crop.json`, by default the median
   dry height). Where raised ground dominates a window, the median is too
   high: desert-3 got 23 against desert-1's 8 on the same map, about 8 px
   of vertical error. If `layout.png` agrees but `pair.png` shows a steady
   vertical offset, re-cut the crop into a new directory with
   `repro/retail_crop.py ... --plain <height>` rather than moving strokes.

4. **Gate new behaviour per world.** Add a knob to `KNOB_DEFAULTS` in
   `sculpt.py` whose default reproduces the old output exactly, and set it
   only in your world's `WORLD_KNOBS` entry. Brush shape options go in
   `SHAPE_FIELDS` (`sculpt.js`) with a default of off. Wire a shape option
   in all four places, or it is silently dropped on replay or save: its
   `SHAPE_FIELDS` entry, the card object `startStroke` builds
   (`options.<key>??shapeValue('<key>')`), `strokeParams`, and a
   `KNOB_DEFAULTS` entry in `sculpt.py` (`worldDefault` reads it). In the shaders,
   append new uniforms to `struct Uniforms` (`sculpt-common.wgsl`) with a
   comment naming the world, pass them in `sculpt-renderer.js`, and put new
   shading in its own function. Never change another world's defaults.

5. **Judge across every window of the world.** Each world has three
   windows from different maps (`repro/scenes/<world>-1..3.json`). Keep a
   change only if it brings ours closer on all of them; retail maps were
   painted by different artists, so a per-map difference is variation, not
   a gap. The goal is "visually close enough" at a glance, not pixel
   equality.

6. **Shape before colour.** If the gap is form (width, profile, outline,
   spacing), change the form; do not recolour to hide it. Do not edit a
   scene to hide a tool gap. A scene may change only to follow the retail
   relief better (`layout.png`), in its own commit saying why.

7. **Never** commit retail-derived files (pictures, heights, crops, renders):
   they stay under `/private/tmp/nanolathe-map-editor/`. Never run
   `rm -rf`; write to fresh directories instead. Add no dependencies and no
   test harnesses. Do not touch `main`.

8. **Iteration cap.** At most three render-look-change cycles per item.
   If an item has not converged by then, record what you learned and move
   on.

9. **Style.** Match the surrounding code: `sculpt.js` is dense, one idea
   per line, and comments say why and cite the measurement or map they come
   from. Read the top of `EXPERIMENTS.md` and the rows for your world first.

10. **Hand-off.** One commit per idea, its message saying what changed,
    why and the measured effect. End with `$R/agent-<card>/NOTES.md`:
    - each change, with its knob and default;
    - the final `compare.py` output;
    - the paths of the final `review-<n>/<world>.png` sheets;
    - one line per claim, tagged **[measured]** (with the number) or
      **[by eye]**;
    - what you tried that did not work, and what is still open.

    Stop there: the owner reviews and merges. Do not merge into
    `terrain-editor` yourself.

## Card A: editor correctness (no visual judgement)

For a model without image input. Every item has a scripted pass
condition. The guard is `compare.py ... --worlds none`: none of these
changes may move a pixel of any scene. Codex's headless reproductions are
in `code-review/reproduce.mjs` and `code-review/evidence.json` of the
review. Point them at your own server and CDP port.

- **A1. Shape-option edits never finish.** Changing a `SHAPE_FIELDS`
  control on a selected shape (craterlets, ejecta, fingers, crystal
  options, mesa flanks, dry bank px, ...) cancels refinement and schedules
  a replay. Nothing then checkpoints or restarts refinement:
  `editSelectedFromControls` and the field handlers sit near `sculpt.js:82`
  and `:1064`, and ordinary sliders show the pattern near `:1542`. Add the
  missing change handling. **Pass:** select a crater, set Ejecta to 20%
  and release. Within 3 s the weather text leaves "Refinement paused while
  editing." and Export is enabled. One Undo restores the crater as it was
  before the edit.
- **A2. Loading a sketch ignores its world.** Save sketch records
  `biome`, `baseHeight` and `seaLevel` (`sculpt.js` near `:1456`). Loading
  (near `:1471`, replay near `:1524`) replays against the current world.
  Switch to the recorded world before replaying (the World selector or the
  `?biome=` reload, whichever the page already uses). If that world is not
  served, refuse with a message and leave the current terrain untouched.
  **Pass:** an Archipelago sketch with one offset-20 shape (corner 8,
  centre 28) loaded while in Green ends in Archipelago with corner 8 and
  centre 28.
- **A3. An unknown world falls back to Green.** `sculpt.py` (near
  `:273-292`) skips unavailable worlds and answers any unknown `biome`
  with the first world. Answer 404 for an unknown or unavailable world.
  The page should show an error, and `repro/render.mjs` should check that
  the loaded config's `biomeId` equals the scene's `biome`, exiting
  non-zero if it does not. **Pass:** `curl -i
  'http://127.0.0.1:8831/sculpt-config.json?biome=nope'` gives 404, a scene
  with `"biome": "nope"` makes `render.mjs` exit non-zero, and all 27
  scenes still render with `compare.py --worlds none` exiting 0.
- **A4. World import drops a disabled colour.** In the world colour
  export/import (`sculpt.js` near `:1645-1704`), `null` means "built-in
  colour turned off", but import keeps only hex strings, so the built-in
  colour comes back. Keep `null` through import. **Pass:** turn a server
  colour off, export the world, reload, import; the colour stays off. Check
  this with a short headless script, not by eye.

Done when A1-A4 pass, the guard holds, and NOTES.md lists each pass
check's output.

## Cards B: biome form and material (needs image input)

Every B card works in the same order:

1. Read the world's section of Codex's `review.txt`, and look at its
   images and at your own `before` sheet.
2. Fix the largest form gap first, then the material.
3. Hold the colours that already match steady. Several worlds' base
   colours are close; the review says which.

Each card lists what to fix in priority order and the code sites to read
first. Dormant knobs from the last round are listed as well. Either make
them do something visible and keep them, or take them out; do not leave
them at a no-op default.

### B1. Ice and Crystal

*Ice:* blocks render as clean polygonal solids with straight rims, flat
bright tops and grey faces.

- Give the blocks irregular outlines, broken or sloping tops, striated
  faces and a break-up from snow to ice, keeping their large readable faces.
- Add a separate floe shelf along the waterline: broken white and blue
  floating ice, with Ice Scream's straight pressure ridges.
- Keep Icy Bergs' blue blocks distinct from Polar Range's darker ones.
- [measured] ice-3: ours has mean RGB 231 (s.d. 27) against retail's
  216 (s.d. 48), so ours is flatter and brighter.

*Crystal:*

- Make column mounds read as distinct stepped tiers, with broad streaked
  tops and flat black sides, not continuous dark walls.
- Make low shore rubble interlocking low slabs, not scattered prisms.
- Add a column-mound example to the world's default scene.

*Also:* make crystal-cluster transforms rigid. In `crystalList`, a frame
rotation turns the faces but not the seeded centre offsets or the lean;
scale changes the cluster radius but not the crystal size. **Pass:** with
seed 2701, radius 100 and count 3, clicked at (512,512), a 90° turn moves
the first centre from (444.771, 577.985) to (446.015, 444.771) (±0.01).

*Dormant:* `crystalGrain/Face/Ink/Tone`, at 0/1/0/1 everywhere.

*Read:* `sculpt.js` `crystalList`, `stampCrystals`, `stampColumns`; the
crystal material in `sculpt-frag.wgsl`; the crystal and ice knobs in
`sculpt.py`; the Ice recipe in `sculpt_section_biome.py`.

### B2. Archipelago and Green

*Runs after C1:* Green's ledges and Archipelago's level beaches need
C1's cross-section. This card covers the rest.

*Archipelago:*

- Give flat sandy shores their own profile, with no raised, shaded,
  striated lip; keep the cliff and bank profile for real banks.
- Make mounds softer olive and brown: less rock and occlusion, keeping
  retail's fine reddish slope lines.
- Remove the isolated blue "wet" pinholes in dry sand (archipelago-2 and
  archipelago-3).

*Green:*

- Make Great Divide's rock face as wide as retail's. [by eye] In
  `$R/repro-out/merged-r7/green-2/pair.png` retail's band is about 2.5
  times as tall as ours. Vary the width along the face.
- Replace the comb-like regular contours on gentle and moderate slopes
  with irregular, branching, broken relief (Evad River Delta, Barrier
  Reef).
- Keep the dense stepped look available for Great Divide without
  imposing it on every hill.

*Dormant:* `bandJag` (0) and `flatBank` (0).

*Read:* hill and plateau profiles and the deep and shallow profiles in
`sculpt.js`; bands and bank relief in `relief-bake.wgsl`; `faceStreak` in
`sculpt-frag.wgsl`; the Green and Archipelago entries in `sculpt.py`.

### B3. Moon and Lava

*Moon:*

- Before touching the palette or light, rebuild the formations' broad
  shoulders, unequal rim sectors and long spurs. Full Moon's radiating
  formation comes out as a small ring; AC20's broken crescent comes out
  as a regular narrow arc.
- Replace the disconnected scratches and toothed crater lips with joined
  wrinkles and pits. Compare `slopeMarks` on and off on matched slopes.

*Lava:*

- The banks are dense parallel nested contours. Change the line topology
  (wider irregular spacing, interruptions, merging branches) before
  changing darkness.
- Make finger tips blunt and attached: no pointed wedges or detached
  islets.
- Give the tall hill a lobed mound, not a swept ridge.
- [by eye] `bankPx` leaves a thin crease along the bank's outer edge, a
  line about 60-100 px out that follows the lake's outline (lava-1, right
  half). Remove it.

*Read:* `crater` and `shoulderedHill` and `fingerShift` and the `bankPx`
remapping in `sculpt.js`; `slopeMark` in `sculpt-frag.wgsl`; the worm
relief and `lavaLines` in `relief-bake.wgsl`; the Moon and Lava entries
in `sculpt.py`.

### B4. Red, Painted Desert and Zhon

*Red:*

- Match shelf depth and width before shallow-water colour: Red River's
  pool is uniformly dark purple where retail has broad layered or rocky
  shelves.
- Recover broad cracked shoulders without bringing back uniform ribs.

*Desert:*

- Give mesas irregular cracked feet and aprons, not smooth orange lobes.
- Weather the upper buttes. Keep Desert Triad's tall grey buttes distinct
  from Painted Desert's broad mesas.
- Keep the strata palette, which already matches.

*Zhon:*

- Make sandbars broader and smoother, and fix the channel bed, before
  any colour.
- Stop blue rock and grass leaking onto the bars.
- Fix the red-brown shallow fringes, which turn grey and teal. Zhon's
  references are three sections of one third-party river family, so
  weigh them lightly.

*Note:* the section-world module reads its catalogs from a Claude session
scratchpad under `/private/tmp/claude-501/`. Do not move or delete it.

*Read:* `mesaFlank` and the plateau profile, `hillSection` and
`shoulderedHill` in `sculpt.js`; strata and `paintSand` in
`relief-bake.wgsl`; `sandBar` and the upper-zone shading in
`sculpt-frag.wgsl`; the water sources in `sculpt_red_materials.py`; the
Zhon water recipe in `sculpt_section_biome.py`.

## Cards C: new tools

Knob tuning cannot draw what the brushes cannot shape. These cards add
tools. They do not rename or fold old knobs: leave `mesaFlank`, `bankPx`,
`beachFlatness`, `northFace`, `shelves` and the rest as they are.

**Census result (C0, 2026-10-27).** 108 windows from 30 retail maps and
six Zhon section families; 62 features; 18 yes, 39 roughly, 5 no. Page:
`/private/tmp/nanolathe-map-editor/agent-C0/census/index.html`;
`census.json` beside it. The missing families, ranked by worlds x
frequency x prominence:

| Rank | Missing family | Card |
| --- | --- | --- |
| 1 | Independent faces, ledges and height profiles | C1 |
| 2 | Local surface patterns and connected relief | C5 (local style), B cards |
| 3 | Flat beaches and compact low-bank profiles | C1 |
| 4 | Branching ridges, spurs and broken rims | C4 |
| 5 | Interlocking shore slabs and broken ice shelves | C2 |
| 6 | Long, branching fissures placed by hand | C4 |
| 7 | Local rock, dark-ground and wet-ground masks | C5 |
| 8 | Irregular cracked mesa and butte aprons | C1 |
| 9 | Varied column-mound and scarp composition | B1 |
| 10 | Compact rounded rock domes | C1 (crown), B4 |

What the census did not find:
- Lava crust plates: 0 of 12 windows, so C2 has no Lava preset.
- Ice pressure ridges and broad floe fields, Zhon bars and braids,
  dunes, true fans and reefs: none clearly established in the samples.
  Build these only if the owner asks.

Order:
- **Now:** C0 and C3. Neither edits the editor.
- **Next:** C1. B2-B4 wait for it, because Green's ledges, Archipelago's
  beaches, Red's shelves and Desert's aprons need it.
- **After B1 lands:** C2, which builds on B1's floe shelf.
- **After C1:** C4 and C5.

### C0. Retail feature census (image input; no editor changes)

Build a catalogue of the landforms and surface features that recur in
retail, per world, with example crops. For each feature, say whether our
tools can make it and what tool or option it would take. It decides which
of C2, C4 and C5 matter most, and what they still miss.

- **Samples.** Take at least 12 windows of 512 px per world, from at least
  4 maps where a world has them (Desert has 2, Moon and Crystal 4). Use
  the exports in `$R/retail-<world>/*/`; for Zhon, the sections. Crop with
  `repro/retail_crop.py` or a small script. Retail pixels stay under
  `/private/tmp`.
- **Features to look for:**
  - *landforms:* ridges, escarpments and terraces, mesas, buttes, spires,
    craters, channels, fans, dunes;
  - *shores:* beach, bank, cliff, shelf, floes, rubble, bars, reefs;
  - *surface:* cracks and fissures, scree, snow, crust, scorch, strata;
  - *scattered small features.*
- **Per feature, record:**
  - its name and the worlds it appears in;
  - how often it appears (windows seen out of windows sampled);
  - 2-3 crops and its size in px;
  - the closest current tool, after trying it in the editor;
  - a verdict: yes, roughly or no;
  - what is missing.
- **Deliverable:** `$R/agent-C0/census/index.html` (like the 2026-10-27
  review page) and `census.json`. No editor commits; a sampling script
  under `repro/` is fine.
- **Done when** every world has its features listed with crops and
  verdicts, and the ten most important missing features across all worlds
  are ranked by worlds x frequency x how much they show.

### C1. Cross-section control (new forms)

**Why.** Each shape kind has one fixed cross-section in `dab()`
(`sculpt.js`):
- plateau: `1 - smooth(shoulder, 1, r)`;
- hill: `(1 - r^2)^2`;
- mountain: `(1 - r^2)^k`;
- water: `1 - smooth(.1, 1, r)`.

So stepped escarpments, talus aprons, raised lips and submerged shelves
cannot be drawn at all.

**What.** Add an optional parametric cross-section to plateau, offset,
hill and mountain, and to the dry bank and bed of deep and shallow
strokes.

**Design:**

- **The switch.** A new shape option, `profile`: 0 keeps the kind's
  current curve, by the exact old code path, and is the default; 1 is
  parametric.
- **Storage.** Every parameter is a `SHAPE_FIELDS` option kept in the
  shape, so it can be edited on a selected shape and is saved in
  sketches. Old sketches lack the options and replay unchanged.
- **Parameters.** Measured inward from the outer edge (the foot), in
  pixels, so a form keeps its size whatever the stroke's radius:
  - `apronPx` and `apronHeight` (the share of the amount reached at the
    apron's top): a gentle concave foot, for talus, skirts and desert
    aprons.
  - `facePx` (0: a share of the radius set by softness) and `faceCurve`
    (-1 concave to +1 convex).
  - `terraces` (0-8), `ledge` (the flat share of each step) and
    `terraceJitter` (how much step heights and widths vary along the
    outline).
  - `lip` (units): a raised rim at the top of the face; negative values
    round the edge off.
  - **The cap** is the rest of the inside: flat for plateau and offset,
    rounded for hill and mountain (`crown`).
- **Deep and shallow strokes.** The same parameters shape the dry bank,
  from the waterline up to the plain. Three more describe a submerged
  shelf before the drop to the bed: `shelfPx`, `shelfDepth` (units below
  sea) and `shelfSteps` (layered shelves, as on Red).
- **Variation along the outline.** Every width is multiplied by the
  existing broad outline noise times `faceVariation`, so faces are not
  even.
- **Terraces.** `ledge` is the flat share of each step. Step the
  unstepped profile `p`:
  `(floor(q) + smooth(ledge, 1, fract(q))) / n`, where
  `q = p * n + terraceJitter * noise(lx, ly)`. It is the contour-band
  idea from `relief-bake.wgsl`, but in the heights.
- **Code layout.** Put the parametric path in one new function (for
  example `crossSection(s, r, ...)`), called from a single new line in
  `dab()`. Do the per-stroke precomputation in one block in
  `startStroke`. Other cards edit the same water path in `dab()`, and this
  keeps the merges additive.
- **Locality.** Every cell's value depends only on its own position. Region
  replay must stay exact: `sculptDebug.replayAll()` reports mismatch 0
  after editing a shape.
- **UI.** Draw a small preview of the cross-section beside the options.

*Stage 1 is done (merged 2026-10-27, 79725791f).* The demo scenes are
in `repro/demo/`. Under `profile` 1, `bankPx`, Beach flatness, Mesa
flanks and Wider north faces are ignored, and a hill is the plain swept
hill. Not converged yet: shelf steps do not show in the water colour,
and Lava fingers no longer sit at the waterline under `profile` 1.

**Stage 1: the engine and UI.**
- The default keeps the old path, so the guard is `--worlds none`.
- Show the forms in scenes that use them: render your own demo scenes
  with `repro/render.mjs` directly (`all.sh` skips scenes that have no
  retail crop).
- Show apron, terraces, lip and shelf on each kind.
- **Stop for review.**

**Stage 2: use it where retail needs it.**
- Use it in green-2 (Great Divide's wide terraced face), desert-1..3
  (aprons and buttes), red-1..3 (layered shelves) and archipelago-1..3
  (level beaches with no lip).
- Also cover the census's compact low banks (rank 3) and rounded rock
  domes (rank 10, through `crown`).
- Set those worlds' `TOOL_PRESETS` and switch those scenes' strokes to
  the profile. Here scene edits are the point: commit them separately.
- Guard: `--worlds green,desert,red,archipelago`.
- **Done when** each touched window's form is closer on its review
  sheet, judged across all of the world's windows, and `replayAll`
  mismatch is 0.

### C2. Shore band (floe shelves and their relatives)

B1 adds Ice's floe shelf. Turn it into a band of broken plates along a
waterline that every world can use. Make it an option on deep and shallow
strokes, or a separate "shore band" brush if that is simpler.

**Parameters:**
- band width in px, separately on the water and land sides;
- plate size and size spread;
- gap width;
- plate height above sea and tilt jitter;
- edge light and shade;
- material: snow or ice, rock slab, lava crust, sand.

**Presets** (census counts out of 12 windows):
- Crystal first (9 of 12): low interlocking slabs. Codex: "low rocky
  shore rubble is replaced by small scattered prisms".
- Red (2 of 12): rocky shelf slabs at banks. Codex: "broad layered or
  rocky bank/shelf structure".
- Ice: B1's floes (1 of 12 windows, but clear in Ice Scream).
- Lava: none (0 of 12).

Start from B1's notes. Guard each preset by its world.

### C3. Numbers sheet (no image input needed)

Write `repro/stats.py`. For every window it computes metrics for retail
and for ours, and for every world the range of the retail family over
many windows. It gives text-only models targets they can check, and it
lets reviews use numbers where images are not needed.

**Height metrics** (from `heights.npy` and `ours-heights.json`):
- a slope histogram;
- steep share (slope above 0.5 and above 1.0);
- water share;
- shore band width: the median distance from the waterline to plain
  height;
- relief roughness at two scales.

**Picture metrics** (from `retail.png` and `ours.png`):
- luma mean and s.d.;
- colour histogram distance in Lab;
- edge density;
- edge orientation shares: horizontal, vertical and diagonal (this tells
  ledges from ribs);
- thin dark line density (black top-hat, 1-3 px);
- band-pass energy at 2, 8 and 32 px.

**Family range.**
- Sample at least 20 seeded windows of 1024 px per world from the retail
  exports (for Zhon, the sections).
- Compute the same metrics and report the 10th-90th percentiles.

**Pitfalls:**
- Section crops (Zhon) have about 31 black rows at the top, where the
  projection shift reaches above the section. Mask all-zero rows in the
  picture metrics.
- The plain height for the shore band is `plain` in `crop.json` for
  retail, and the world's `baseHeight` for ours: 24, or 8 for Archipelago
  and Zhon. `heights.npy` holds heights above sea; `ours-heights.json`
  holds raw heights plus its `sea`, which must be subtracted (as
  `pair.py` does).

**Output.** `stats.json`, and `stats.md` with one table per world:
- the family range;
- each retail window;
- ours, flagged wherever it falls outside the family range.

**Checks:**
- `--selftest` must pass:
  - horizontal stripes read as horizontal;
  - a 1 px dark grid reads as thin lines;
  - a flat image has no edges.
- Runs on `$R/repro-out/merged-r7` in a few minutes and gives the same
  output twice.
- The family ranges contain at least 80% of the retail windows' own
  metrics.

**Files:** `repro/stats.py` only. Server and ports are not needed.

### C4. Line features

New brushes for the long narrow features retail draws as lines (the
examples are from Codex's review; C0 will confirm or extend them):

- **Sharp ridge:** a narrow, nearly straight crest with a jagged top and
  a low, steady height. Examples: Ice pressure ridges, Moon wrinkle
  ridges, dikes.
- **Channel:** a winding cut with banks, optional bars and braids, wet or
  dry. Its meander and its width vary along the path. Examples: Zhon
  rivers and bars, Moon rilles, Desert washes, Red dry beds.
- **Fissure:** paint a crack network along a stroke, instead of relying
  on the world-wide crack field. Examples: ice crevasses, cracks in lava
  crust, rock fissures.
- **Spurs and broken rims:** spurs branching from ridges and crater rims,
  and crater rims with sectors and gaps. Examples: Full Moon's radiating
  formation, AC20's broken crescent.

Each is a new kind or a shape option, depends only on its own cells,
replays exactly by region, and is off by default.

### C5. Painted masks and world variants

**Stages** (stop for review after each):
1. **Masks.** New per-cell channels in the shape graph (`FIELD_KEYS`),
   painted by cover-like brushes, plus a shape option that writes them
   inside a landform's own footprint:
   - material channels: rock, snow or ice, wet or dark ground, moss;
   - a scatter density that multiplies the world's boulder and debris
     density (unpainted keeps today's density).

   Upload them as one texture beside the cover field and mix them in
   the material. Each world's "rock" and "moss" come from its own
   materials, never from new colours.
2. **Local style.** Painted or per-shape multipliers for banding,
   cracks, relief strength and face treatment.
3. **World variants.** Named world variants.

- **Material channels:** paint rock showing through, snow or ice, dark or
  wet ground, and moss. Today only sand and grass can be painted.
- **Scatter density:** paint the density of boulders, debris, pits, small
  craters and slabs. The world sliders become the density wherever
  nothing is painted.
- **Local style:** set banding, cracks, relief and face treatment per
  shape or per painted area, so Great Divide's dense terraces can sit
  beside smooth hills.
- **Variants:** two or three named presets per world, for example
  Painted Desert mesas and Desert Triad buttes, Icy Bergs and Polar
  Range, Great Divide and Evad River.

Every default reproduces today's renders exactly: the guard is
`--worlds none` until a world adopts a feature.

## After the cards

The owner reviews each branch: reads the diff, checks the gating, re-runs
`compare.py`, and looks at the review sheets. The branches are then merged
one at a time. Next come a blind round (`repro/blind/build_round.py`, with
reviewers judging by eye) and the report. Later, worker-based multi-core
shape replay extracts the shape engine from `sculpt.js`. It waits until
the visual cards have landed, because every card edits that file.
