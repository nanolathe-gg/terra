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
   | D | 8840 | 9640 | `$R/agent-D/out` | `--worlds none` |

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
   leaks into that world; gate it. The `false` test does not always bring
   the baseline back (C5 met this). If it doesn't, move the new shader
   code into gated branches and bisect until every other scene matches
   exactly.

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

*Done (Codex, merged 2026-10-28, 25e64434d):*
- opt-in per-stroke shore plates (`shorePlates` and five size options;
  Ice Scream uses them);
- Crystal column tops flattened (`crystalTiers`) and widened to 32 px;
- Crystal's material controls switched on;
- rigid crystal transforms;
- a column-mound example.

*Still open:*
- Ice block shapes (every attempt rejected);
- Crystal interlocking shore slabs (rejected; C2);
- Crystal's black gaps between columns are heavier than retail's thin
  outlines;
- Ice's plate band is narrower and more regular than retail's floe field.

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

*Done (Sonnet, merged 2026-10-28, f452f2a12):*
- Archipelago: flat beaches with no lip or dashes, no blue pinholes or
  sand specks, softer mounds;
- Green: broken, branching relief instead of combs (`evad` variant),
  and more broken terraces on Great Divide.

*Still open:*
- Archipelago mounds are darker than retail (15% dark pixels vs 5-13%);
- Archipelago's pale shallow band is thinner than retail's;
- Great Divide's terrace density is .158 vs retail's .235.

*Fixed (4325b958c):* `debrisStones()` admitted a stone wherever a cell's
hash was exactly 0, even with debris 0, leaving stray specks in every
world. The test is now `>=`, and Archipelago's `cleanStones` workaround
is gone.

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

*Done (Sonnet, merged 2026-10-28, 899f8064a; lava-1 fingers restored
in 98686e5ca):*
- Lava bank lines are wider apart, wander and break off
  (`bandRelief`/`bandWander`/`bandGaps`);
- Lava finger tips are blunt and attached (`fingerBlunt`);
- lava-1's crease came from a 9-unit hill stroke, not `bankPx`, and is
  gone;
- Moon has joined wrinkles and pits (`wrinkles`) in place of slope
  marks.

*Still open:*
- overlapping fingered water strokes flood each other into wedges
  (lava-1); fingers should apply to the union coast;
- Lava lines are still more concentric than retail's slabs;
- Moon walls are lighter than retail's near-black pits;
- `slopeMarks` is dormant in every world; remove it or keep it as an
  opt-in.

*Read:* `crater` and `shoulderedHill` and `fingerShift` and the `bankPx`
remapping in `sculpt.js`; `slopeMark` in `sculpt-frag.wgsl`; the worm
relief and `lavaLines` in `relief-bake.wgsl`; the Moon and Lava entries
in `sculpt.py`.

### B4. Red, Painted Desert and Zhon

*Done (Sonnet, merged 2026-10-28, 085b8417e):*
- Red: red-3 gets a shelf and a painted dark rock platform; Red's
  shallow water is closer to retail (depth 3-6 colour error 71 -> 31 on
  red-2, 30 -> 17 on red-3); red-2's bank is layered and its landform a
  dome.
- Zhon: a `river` variant (brown shallows, olive deeps) and broader,
  gentler bars.
- Desert: unchanged. Three apron approaches were rejected.

*Still open:*
- red-3's drop to deep water is 2-3x too steep, and there is a pale
  patch in its open sea;
- Red-1's cracked shoulders;
- ragged Desert aprons, weathered buttes and rubble halos;
- Zhon's blotchy water, merging bars and blue rock at bar ends.

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

*Stage 2 is done (merged 2026-10-28, d9f24351c):*
- Painted Desert's plateau preset uses the profile; the desert scenes and
  red-2's layered bank use it too.
- Green-2 and Archipelago were tried and reverted. Green-2's grey rock
  face is a material gap: retail's dark/rock share on the face rows is
  0.80, ours 0.48. Archipelago's lip and dashes are material (B2).

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

*Crystal preset is done (Sonnet, merged 2026-10-28, cdb03a477):*
- shore plates gain a Plate material option (0 ice floes, B1's look; 1 rock
  slabs) and also work on offset strokes; Crystal's world preset makes
  Shore plates give slabs (20 px, 90 px into the water, 48 px onto land);
- slabs interlock in a Voronoi web with thin seams; on land they stand up
  to Plate height above their seams, under water they are a shallow ledge
  that the new `crystalSeam` water term paints paler, with dark seams;
- crystal-1 (offset pond), crystal-2 (four edge strokes) and crystal-3
  (left shore) opt in; Crystal's riser faces are dark violet instead of
  black (`crystalFace` 1.1).

*Still open:* band width and land-side width are set, but plate size spread,
tilt jitter, edge light and shade and the lava crust and sand materials are
not; there is no Red preset (Red's slabs are broad dry shelves, not this
web); crystal-3's water seams are darker and denser than retail's, crystal-2's
field reaches the window edges where retail's deep water is plain, and slabs
are too regular. The mound flanks' risers (the envelope's staircase between
32-px columns) are still wider than retail's 2-4 px lines: B1's rank 9.

### C3. Numbers sheet (no image input needed)

*Done (OpenCode, merged 2026-10-28, 399412fd3):*
- `repro/stats.py <all.sh out> --out <dir>`, with `--selftest`;
- 24 family windows per world;
- about 150 s for all 27 scenes.

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

*Stage 1 is done (merged 2026-10-28, 1c23b37c5):*
- spurs on hill, mountain and crater strokes;
- crest irregularity, width and height variation, and end tapers;
- crater rim sectors and gaps;
- moon-2 and moon-3 use them.

*Stage 2 is done (merged 2026-10-28, a3385d2d7):*
- a Fissure tool: line mode with forking branches, and a network mode for
  Red's polygonal platforms;
- crater Rim height;
- Spur forks and Bulbous spur tips;
- lava-3's tall hill is a lobed mound.

Fissures cut the heights, raise the crack field and paint the wet mask.
Red's network and Desert's cuts read well. Green's are lost on rock, and
nothing renders thinner than about 4 px. A shader fissure term would
need a texture slot; the draw is at the 16 limit.

*Still open:*
- spurs are even rays, where retail's are bulbous lobes with forks;
- broken rims are softer than retail's;
- Red ridges look twiggy;
- live drawing shows no spurs until release.

**Census evidence** (C0 rank 4: Red, Moon, Lava; rank 6: Green, Red,
Desert, Ice):
- *Ridges:* connected branches, crests of varying width and height,
  tapering spurs, convincing junctions.
- *Craters:* broad unequal rim sectors and deliberate gaps.
- *Fissures:* author-placed long cuts with a start, a path and branches,
  coarser than the procedural crack field, which stays.

The census did not establish channels with bars or braids; leave them out.

**Stages** (stop for review after each):
1. Branching ridges and spurs, and broken crater rims.
2. Placed fissures.

### C5. Painted masks and world variants

**Stages** (stop for review after each):
*Stages 1-2 are done (merged 2026-10-28, 4b7abd719 and 915f9ad6d):*
- mask planes for rock, snow, wet, moss and scatter;
- style planes for relief, cracks, banding and face rock;
- a Paint masks brush and per-shape options;
- the draw is back at 16 textures;
- green-2's face is now a wide dark rock band.

*Round 3 is done (merged 2026-10-28, 46e09f51b):*
- region replay is exact for nodes that sample their own height point
  (plateau, crater, ramp; it was off by up to 40.7);
- mask edges follow the relief;
- world variants: green `evad`, ice `bergs`, desert `triad`;
- green-1, green-3, ice-2 and desert-2 opt in.

*Still open:*
- no Polar Range variant: its dark block faces need a shading change;
- an unknown `variant=` gives a generic error;
- face-rock style does nothing on Red;
- moss in Red, Desert and Lava looks like rubble.

Green-2 needs a grey rock face (C1 stage 2 finding). Use it as a stage 1
or stage 2 demo.

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

## Card D: a real map editor (full-size maps, features, export to .ufo)

Turn the editor into one that makes a playable map: a full-size canvas you
can scroll, the existing terrain tools, features of the world (metal
deposits, trees, a tree fill), start positions and the OTA settings, and an
export to `<name>.ufo` (an HPI archive holding `maps/<name>.ota` and
`maps/<name>.tnt`) that the player drops into the Total Annihilation folder.
The exported map must load in Nanolathe and, within the limits below, in
retail `TotalA.exe`; nobody can automate retail here, so the owner tests
that by hand.

Work in four phases, in order. After each phase commit, update
`$R/agent-D/NOTES.md` and **stop for the owner's review**; continue only
when told to. At the start of each phase, merge `terrain-editor` into your
branch (merge, never rebase): the owner keeps tuning the worlds on
`terrain-editor` while you work.

**Files.** `tools/map-editor/**` only. Put new code in new files
(`sculpt-map.js` for the large canvas and features, `sculpt-export.js`
for the export UI, and Go programs under `tools/map-editor/export/` and
`tools/map-editor/features/`). Add only small hooks to `sculpt.js`,
`sculpt-renderer.js` and `sculpt.py`. Do not edit `internal/`, `formats/`,
`vfs/` or `cmd/`; import what you need from them.
- `mapgen`'s minimap builder is unexported and `mapgenFeatures` lives in
  package main: reimplement them in your tool, with a comment naming the
  rule you followed. Do not export anything from `internal/mapgen`.
- Build and vet only your packages
  (`go build ./tools/map-editor/... && go vet ./tools/map-editor/...`).
  Add no `_test.go` files. The Go gates still do not apply.

**Guard.** `repro/compare.py ... --worlds none` after every change: export,
features and chunking must not move a pixel in any window. Rule 3's
compiler-drift test applies. The one planned exception is tile-reuse step
(b) in phase 4.

**What already exists (reuse it).**
- `formats.EncodeTNT` (`formats/tnt_write.go`) writes a canonical `0x2000`
  terrain file that `formats.LoadTNT` reads back.
- `formats.EncodeTDF` writes TDF text. `internal/mapgen/ota.go` shows a
  complete skirmish OTA: climate, one `Network 1` schema, `StartPosN`
  specials.
- `vfs.WriteArchive` (`vfs/hpi_write.go`) writes an HPI with the copyright
  trailer that retail's mount validator requires.
- `cmd/nanolathe/mapgen_world.go` shows how to read a world from the
  player's content:
  - its maps' climate medians;
  - which features its maps use, and how often;
  - `mapgenFeatures` sorting them into deposit, trees, foliage and rocks.
- `internal/mapgen/resources.go` places deposits and vegetation (see
  `gentleLand`, `placeVegetation`).
- `nanolathe --map "<name>" --shot out.png --renderer=classic` composes
  a battle frame headlessly. Add a second game root (repeat `--root`;
  later roots win) that holds only your exported `.ufo`, and **never
  write into `~/TotalAnnihilation`**.
- Formats: [fmt tnt] (`research/formats/tnt.md`: attribute map, anchor
  cells and `0xFFFE` fringe, minimap sizing and its `0x64` fill),
  [fmt ota], [fmt hpi], [fmt pal].

### Phase 1: export the canvas you have

- **Geometry.** A map of `U x V` OTA units (512 px each) is
  `U*32+2` by `V*32+8` cells of 16 px. The play area is
  `Width*16-32` by `Height*16-128` px. This follows the generator
  (`docs/DESIGN_MAP_GENERATOR.md`).
  - The canvas must cover every cell, including the strips the engine
    voids (`[03 R-TERR-01 §2]`). Outline the play area in the view.
  - Generalise the canvas to non-square sizes up to the 8192-px texture
    limit, which is about 4x4 units. Today's 1024-px canvas is only 2x2.
- **Heights.** Sample at the 16-px cell corners, clamp to 0..255 with a
  warning, and write the editor's sea level as the header byte.
- **Projection: verify it, don't assume it.**
  - The engine draws world row `y` of a point at height `h` on screen row
    `y - h/2`, measured from height 0 (search doc 03 for
    `zPixels - height/2`). The editor's view uses
    `y - (visible - base)/2`. The exported art must follow the engine.
  - **Pass:** a classic-renderer `--shot` of the exported map with units
    staged on a hilltop and at the shore shows them standing on the art,
    not floating or sunk. `docs/ARCHITECTURE.md` lists the `--shot-*`
    flags.
- **Tiles and palette.**
  - Cut the final image into 32x32 tiles and map each colour to a
    palette index. Use an exact lookup if the palette stage already emits
    palette RGB, otherwise the nearest colour.
  - Export must add no position-keyed noise. Deduplicate exact tiles.
  - Report the unique tile count and the slot count.
- **Minimap.** 252 px on the long side, with the used sub-rectangle and
  fill exactly as [fmt tnt] "Minimap" states.
- **OTA.** Follow `internal/mapgen/ota.go`. Climate defaults to the
  world's retail medians.
  - The name and description must be free of TDF-reserved characters.
  - Refuse a name that an installed map already uses: the picker would
    hide one of them.
- **Archive.** Write `<name>.ufo` to `$R/agent-D/exports/` and offer it
  as a download.
  - Read [fmt hpi] on compression methods before you choose
    `Compress`; stored (method 0) is always safe.
- **Self-check, built into the command.** Decode what you wrote:
  - `LoadTNT` must match cell for cell, tile for tile;
  - `vfs.NewArchive` must list both files;
  - the OTA must parse.
- **Worlds.** Map each editor world to the OTA `planet` its retail maps
  use: read the OTAs of the maps in `repro/scenes`, and don't guess
  spellings. Zhon has no retail planet or feature set: its export stays
  disabled until the owner picks one.
- **Pass:**
  - a 4x4-unit map with a hill, a lake and two starts (phase 2 adds the
    start tool; for now a fixed pair is fine) loads in a classic `--shot`;
  - the shot's terrain matches the exported indexed image (write a diff
    image, not just a claim);
  - the guard holds.

### Phase 2: features, starts and map settings

- **Feature catalogue.** A Go helper writes each world's catalogue to
  `$R/agent-D/features/<world>/`. These files are retail-derived, so never
  commit them. It holds:
  - name, footprint, metal, energy, blocking, reclaimable;
  - how often the world's retail maps use the feature;
  - a first-frame PNG and its offsets from the feature's GAF (`seqname`,
    and `seqnameshad` for the shadow).
- **Drawing features.** The editor draws feature sprites over the
  terrain at their cell's projected position. Tile art never contains
  sprites: the engine draws them.
- **Tools.**
  - Place and erase single features, snapped to cells, and refuse
    overlapping footprints.
  - A tree fill over a brush, lasso or flood region, with these
    controls:
    - density;
    - clustering, from noise;
    - spacing by footprint;
    - corner difference of 10 or less, and dry land only, as `gentleLand`
      requires;
    - a mix weighted by retail usage;
    - a seed;
    - a margin around starts and deposits.
  - Foliage and rocks use the same fill.
- **Metal deposits.** Follow `mapgenFeatures`: use the world's most-used
  *drawn*, indestructible metal feature. The Metal world has none; its
  ground is the metal.
- **Encoding.** Write each feature's record index in the anchor cell
  (top-left) and `0xFFFE` in the rest of its footprint ([fmt tnt]). Every
  name must exist in the world's feature TDFs: retail exits on a missing
  record.
- **Starts.** 1 to 10 start positions, written as `StartPosN` specials
  with `XPos`/`ZPos` in pixels ([fmt ota]); `numplayers` follows the
  count.
- **Settings.** An OTA panel: name, description, wind, tidal, solar,
  gravity, surface metal, Moho metal, lava world. Defaults come from the
  world's retail medians.
- **Pass:**
  - a 4x4-unit Green map with a forest, four deposits and four starts
    loads in `--shot`;
  - trees and deposits appear where the editor put them;
  - a unit can be staged on a start;
  - the guard holds.

### Phase 3: full-size maps and scrolling

- **Target.** Up to 40x40 units, non-square allowed. That is 1282x1288
  cells, about 20,500 px a side; retail's largest map, Seven Islands, is
  1280x1280 cells. Provide scrolling, a minimap navigator and at least
  1x, 0.5x and overview zoom.
- **The hard part.**
  - The renderer bakes the whole canvas into textures sized `this.size`
    square. At this size that cannot work, so bake in chunks, with an
    apron wide enough for every neighbourhood pass (normals, blurs,
    shadows, relief).
  - Keep chunks resident only while needed.
  - Shapes already replay per region; keep regional replay exact
    (`sculptDebug.replayAll()` mismatch 0).
  - The editor already uses all 16 sampled textures, so chunking must
    not add one.
- **Document.** Save on the server: the stroke graph, sparse painted
  mask chunks, features, starts and OTA settings. Saving and reloading
  gives the same map.
- **Exactness tests.**
  - The existing 1024-px canvas baked as 2x2 chunks must be
    pixel-identical to the whole bake.
  - The guard must hold.
- **Measure:**
  - memory and time at 16x16 and 40x40 units;
  - stroke latency on screen;
  - full export time, with a progress bar.
- **Out of scope.** Do not start worker-based multi-core replay (see
  "After the cards"), but leave the shape engine callable per chunk so
  that it can come later.
- If this phase fails its exactness tests after two rounds, stop and
  report. The owner will reassign it.

### Phase 4: tile budget

Each unique tile costs 1 KB, and retail maps reuse tiles heavily: base
ground repeats, while hills, shores and cliffs are unique. A census of the
275 canonical maps in the reference install found:

- **All maps:** median 3,218 unique tiles. The most seen is 11,561
  (`Lava & Two Hills`), and a `u16` tile index is the format's hard limit.
- **Large maps** (at least 500x500 cells; 53 of them): median 5,078
  unique tiles, with about 5% of tile slots unique.

Unique tiles per world, p50 / p90:

| World | p50 | p90 |
| --- | ---: | ---: |
| Green | 2,870 | 4,883 |
| Red | 2,959 | 4,869 |
| Lava | 2,967 | 7,816 |
| Archipelago | 2,667 | 7,389 |
| Ice | 5,230 | 7,051 |
| Crystal | 4,434 | 9,698 |
| Lunar | 3,110 | 4,388 |
| Desert | 2,822 | 3,252 |

Our art is noise everywhere, so without work nearly every slot is unique.
A 20x20-unit map has about 100,000 slots.

- **Budget.** A knob defaulting to 6,000 tiles. Retail mode has a hard
  ceiling of 11,500, the largest count known to work; a Nanolathe-only
  export may go higher. Show the count live in the export panel.
- **Steps, in order:**
  - **(a) Measure.** On a 16x16-unit map, find and list every reason two
    level-ground tiles differ:
    - dither keyed to absolute position;
    - the ground pattern's phase against the 32-px tile grid after
      projection;
    - undulation shading;
    - weathering;
    - anything else you find.
  - **(b) Make base ground repeat exactly.** Align the `groundTiles`
    pattern to the TNT tile grid in screen space, key dither to the
    tile-local position, and choose variants by a tile hash.
    - This changes pixels in every world, so it will fail the guard by
      design.
    - Put it behind an export-only switch first, and measure how far
      the export differs from the view.
    - The owner decides, after looking at the sheets, whether it
      becomes the default. Do not decide this yourself.
  - **(c) Merge near-duplicates under the budget.**
    - Use an error that weights edge pixels, so merges do not open
      seams.
    - Never merge tiles that hold a cliff edge, a shore or a feature
      footprint's ground.
    - Prefer merging into base-ground tiles.
  - **(d) Report:**
    - a curve of unique count against merge threshold;
    - a before and after contact sheet at 1x;
    - the count for one map per world at 16x16 units.
- **Stop condition.** If the budget can only be met with visible loss,
  report that. Do not flatten the look to hit the number.

## After the cards

The owner reviews each branch: reads the diff, checks the gating, re-runs
`compare.py`, and looks at the review sheets. The branches are then merged
one at a time. Next come a blind round (`repro/blind/build_round.py`, with
reviewers judging by eye) and the report. Later, worker-based multi-core
shape replay extracts the shape engine from `sculpt.js`. It waits until
the visual cards have landed, because every card edits that file.
