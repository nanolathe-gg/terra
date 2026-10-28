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
   `SHAPE_FIELDS` (`sculpt.js`) with a default of off. In the shaders,
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

## After the cards

The owner reviews each branch: reads the diff, checks the gating, re-runs
`compare.py`, and looks at the review sheets. The branches are then merged
one at a time. Next come a blind round (`repro/blind/build_round.py`, with
reviewers judging by eye) and the report. Later, worker-based multi-core
shape replay extracts the shape engine from `sculpt.js`. It waits until
the visual cards have landed, because every card edits that file.
